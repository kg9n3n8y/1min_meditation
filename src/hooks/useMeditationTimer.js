import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CONFIG_STORAGE_KEY,
  COUNTDOWN_SECONDS,
  DEFAULT_CONFIG,
  ONE_SECOND_MS,
} from '../lib/config.js';
import { buildPattern, clampNumber, getTotalSeconds } from '../lib/pattern.js';
import { loadJson, saveJson } from '../lib/storage.js';

function normalizeConfig(raw) {
  if (!raw) return { ...DEFAULT_CONFIG };
  return {
    inhaleSeconds: clampNumber(raw.inhaleSeconds, 2, 8, DEFAULT_CONFIG.inhaleSeconds),
    holdSeconds: clampNumber(raw.holdSeconds, 0, 10, DEFAULT_CONFIG.holdSeconds),
    exhaleSeconds: clampNumber(raw.exhaleSeconds, 4, 16, DEFAULT_CONFIG.exhaleSeconds),
    cycleCount: clampNumber(raw.cycleCount, 1, 9, DEFAULT_CONFIG.cycleCount),
  };
}

function tryVibrate(patternInput) {
  if (navigator.vibrate) {
    try { navigator.vibrate(patternInput); } catch (_) {}
  }
}

export function useMeditationTimer(audioEngine) {
  const [config, setConfig] = useState(() => normalizeConfig(loadJson(CONFIG_STORAGE_KEY)));
  const [phaseLabel, setPhaseLabel] = useState('タップで開始');
  const [countdownLabel, setCountdownLabel] = useState(() => {
    const pattern = buildPattern(
      config.inhaleSeconds,
      config.holdSeconds,
      config.exhaleSeconds,
      config.cycleCount,
    );
    return String(getTotalSeconds(pattern));
  });
  const [progressDeg, setProgressDeg] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const pattern = useMemo(
    () => buildPattern(config.inhaleSeconds, config.holdSeconds, config.exhaleSeconds, config.cycleCount),
    [config],
  );
  const totalSeconds = useMemo(() => getTotalSeconds(pattern), [pattern]);

  const isRunningRef = useRef(false);
  const isCountdownRef = useRef(false);
  const currentIndexRef = useRef(0);
  const phaseEndTsRef = useRef(0);
  const totalStartTsRef = useRef(0);
  const countdownStartTsRef = useRef(0);
  const timerRafRef = useRef(0);
  const countdownRafRef = useRef(0);
  const patternRef = useRef(pattern);
  const totalSecondsRef = useRef(totalSeconds);
  const audioEngineRef = useRef(audioEngine);

  useEffect(() => {
    patternRef.current = pattern;
    totalSecondsRef.current = totalSeconds;
  }, [pattern, totalSeconds]);

  useEffect(() => {
    audioEngineRef.current = audioEngine;
  }, [audioEngine]);

  const updatePhaseLabel = useCallback((text, shouldAnnounce = true) => {
    setPhaseLabel(text);
    if (shouldAnnounce) {
      setLiveAnnouncement(`${text}のフェーズ`);
    }
  }, []);

  const updateProgress = useCallback((totalElapsedSec) => {
    const progress = totalSecondsRef.current
      ? Math.min(360, (totalElapsedSec / totalSecondsRef.current) * 360)
      : 0;
    setProgressDeg(progress);
  }, []);

  const flushAudioRefresh = useCallback(() => {
    audioEngineRef.current.resumeIfNeeded().catch(() => {});
  }, []);

  const reset = useCallback(() => {
    isCountdownRef.current = false;
    cancelAnimationFrame(countdownRafRef.current);
    countdownRafRef.current = 0;
    countdownStartTsRef.current = 0;

    isRunningRef.current = false;
    setIsActive(false);
    cancelAnimationFrame(timerRafRef.current);
    timerRafRef.current = 0;
    currentIndexRef.current = 0;
    phaseEndTsRef.current = 0;
    totalStartTsRef.current = 0;

    updatePhaseLabel('タップで開始', false);
    setCountdownLabel(String(totalSecondsRef.current));
    updateProgress(0);
    flushAudioRefresh();
  }, [flushAudioRefresh, updatePhaseLabel, updateProgress]);

  const finish = useCallback(() => {
    tryVibrate([40, 60, 40]);
    audioEngineRef.current.playGuide('end');
    isRunningRef.current = false;
    setIsActive(false);
    cancelAnimationFrame(timerRafRef.current);
    timerRafRef.current = 0;
    updatePhaseLabel('おつかれさま');
    setTimeout(() => {
      alert('おつかれさま! 瞑想が終わったよ。');
      reset();
    }, 500);
  }, [reset, updatePhaseLabel]);

  const formatSec = (sec) => Math.max(0, Math.ceil(sec)).toString();

  const loop = useCallback((now) => {
    if (!isRunningRef.current) return;

    const totalElapsedSec = (now - totalStartTsRef.current) / ONE_SECOND_MS;
    updateProgress(totalElapsedSec);

    const remainingCurrent = (phaseEndTsRef.current - now) / ONE_SECOND_MS;
    setCountdownLabel(formatSec(remainingCurrent));

    if (remainingCurrent <= 0) {
      currentIndexRef.current += 1;
      if (currentIndexRef.current >= patternRef.current.length) {
        finish();
        return;
      }
      const nextPhase = patternRef.current[currentIndexRef.current];
      updatePhaseLabel(nextPhase.label);
      phaseEndTsRef.current = now + nextPhase.duration * ONE_SECOND_MS;
      const shouldPlayGuide = !(nextPhase.key === 'hold' && nextPhase.duration === 0);
      if (shouldPlayGuide) {
        audioEngineRef.current.playGuide(nextPhase.key);
      }
    }

    if (!isRunningRef.current) return;
    timerRafRef.current = requestAnimationFrame(loop);
  }, [finish, updatePhaseLabel, updateProgress]);

  const beginSession = useCallback((startTimestamp = performance.now()) => {
    if (isRunningRef.current) return;
    audioEngineRef.current.resumeIfNeeded().catch(() => {});

    isRunningRef.current = true;
    setIsActive(true);
    currentIndexRef.current = 0;
    totalStartTsRef.current = startTimestamp;
    const first = patternRef.current[currentIndexRef.current];
    updatePhaseLabel(first.label);
    phaseEndTsRef.current = totalStartTsRef.current + first.duration * ONE_SECOND_MS;
    setCountdownLabel(String(first.duration));
    updateProgress(0);
    timerRafRef.current = requestAnimationFrame(loop);
    tryVibrate(30);

    const initialGuide = audioEngineRef.current.playGuide('inhale');
    const ensureInitialGuide = () => {
      audioEngineRef.current.playGuide('inhale');
    };
    if (initialGuide && typeof initialGuide.then === 'function') {
      initialGuide.then((played) => {
        if (!played && isRunningRef.current && currentIndexRef.current === 0) {
          ensureInitialGuide();
        }
      }).catch(() => {
        if (isRunningRef.current && currentIndexRef.current === 0) {
          ensureInitialGuide();
        }
      });
    }
  }, [loop, updatePhaseLabel, updateProgress]);

  const countdownLoop = useCallback((now) => {
    if (!isCountdownRef.current) return;
    const elapsedSec = (now - countdownStartTsRef.current) / ONE_SECOND_MS;
    const remaining = COUNTDOWN_SECONDS - elapsedSec;
    if (remaining <= 0) {
      isCountdownRef.current = false;
      cancelAnimationFrame(countdownRafRef.current);
      countdownRafRef.current = 0;
      countdownStartTsRef.current = 0;
      beginSession(now);
      return;
    }
    setCountdownLabel(String(Math.max(1, Math.ceil(remaining))));
    countdownRafRef.current = requestAnimationFrame(countdownLoop);
  }, [beginSession]);

  const startCountdown = useCallback(() => {
    if (isRunningRef.current || isCountdownRef.current) return;
    isCountdownRef.current = true;
    setIsActive(true);
    updatePhaseLabel('まず吐いて');
    setCountdownLabel(String(COUNTDOWN_SECONDS));
    updateProgress(0);
    countdownStartTsRef.current = performance.now();
    countdownRafRef.current = requestAnimationFrame(countdownLoop);
  }, [countdownLoop, updatePhaseLabel, updateProgress]);

  const toggleTimer = useCallback(() => {
    if (isRunningRef.current || isCountdownRef.current) {
      reset();
    } else {
      startCountdown();
    }
  }, [reset, startCountdown]);

  const persistConfig = useCallback((nextConfig) => {
    saveJson(CONFIG_STORAGE_KEY, nextConfig);
  }, []);

  const applyConfig = useCallback((nextConfig, options = {}) => {
    const { persist = true, resetTimer = true } = options;
    setConfig(nextConfig);
    if (persist) {
      persistConfig(nextConfig);
    }
    if (resetTimer) {
      const nextPattern = buildPattern(
        nextConfig.inhaleSeconds,
        nextConfig.holdSeconds,
        nextConfig.exhaleSeconds,
        nextConfig.cycleCount,
      );
      setCountdownLabel(String(getTotalSeconds(nextPattern)));
      reset();
    }
  }, [persistConfig, reset]);

  const updateConfigField = useCallback((field, value, options = {}) => {
    const { persist = true, resetTimer = true } = options;
    setConfig((prev) => {
      const next = { ...prev, [field]: value };
      if (persist) {
        persistConfig(next);
      }
      if (resetTimer) {
        const nextPattern = buildPattern(
          next.inhaleSeconds,
          next.holdSeconds,
          next.exhaleSeconds,
          next.cycleCount,
        );
        setCountdownLabel(String(getTotalSeconds(nextPattern)));
        reset();
      }
      return next;
    });
  }, [persistConfig, reset]);

  const resetConfig = useCallback(() => {
    applyConfig({ ...DEFAULT_CONFIG });
  }, [applyConfig]);

  const announceConfig = useCallback(() => {
    setLiveAnnouncement(
      `吸う${config.inhaleSeconds}秒、止める${config.holdSeconds}秒、吐く${config.exhaleSeconds}秒、${config.cycleCount}回のサイクルを設定しました`,
    );
  }, [config]);

  useEffect(() => () => {
    cancelAnimationFrame(timerRafRef.current);
    cancelAnimationFrame(countdownRafRef.current);
  }, []);

  return {
    config,
    phaseLabel,
    countdownLabel,
    progressDeg,
    isActive,
    liveAnnouncement,
    totalSeconds,
    toggleTimer,
    updateConfigField,
    resetConfig,
    announceConfig,
    isRunningRef,
  };
}
