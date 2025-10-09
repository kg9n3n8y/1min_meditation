(() => {
  const startButton = document.getElementById('startButton');
  const phaseLabel = document.getElementById('phaseLabel');
  const countdownLabel = document.getElementById('countdownLabel');
  const progressRing = document.getElementById('progressRing');
  const timerCard = document.querySelector('.timer-card');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const resetConfigBtn = document.getElementById('resetConfigBtn');
  const inhaleSlider = document.getElementById('inhaleSlider');
  const holdSlider = document.getElementById('holdSlider');
  const exhaleSlider = document.getElementById('exhaleSlider');
  const cycleSlider = document.getElementById('cycleSlider');
  const inhaleSecondsValue = document.getElementById('inhaleSecondsValue');
  const holdSecondsValue = document.getElementById('holdSecondsValue');
  const exhaleSecondsValue = document.getElementById('exhaleSecondsValue');
  const cycleCountValue = document.getElementById('cycleCountValue');
  const phaseLiveRegion = document.getElementById('phaseLiveRegion');

  const ONE_SECOND_MS = 1000;
  const BASE_PATTERN = [
    { label: '吸う', key: 'inhale', calcDuration: (inhaleSec) => inhaleSec },
    { label: '止める', key: 'hold', calcDuration: (_, holdSec) => holdSec },
    { label: '吐く', key: 'exhale', calcDuration: (_, __, exhaleSec) => exhaleSec },
  ];
  const DEFAULT_INHALE_SECONDS = 4;
  const DEFAULT_HOLD_SECONDS = 8;
  const DEFAULT_EXHALE_SECONDS = 8;
  const DEFAULT_CYCLE_COUNT = 3;
  const INHALE_MIN_SECONDS = 2;
  const INHALE_MAX_SECONDS = 8;
  const HOLD_MIN_SECONDS = 0;
  const HOLD_MAX_SECONDS = 8;
  const EXHALE_MIN_SECONDS = 4;
  const EXHALE_MAX_SECONDS = 16;
  const CYCLE_MIN_COUNT = 1;
  const CYCLE_MAX_COUNT = 9;
  const COUNTDOWN_SECONDS = 3;
  const CONFIG_STORAGE_KEY = 'breathingConfig:v1';
  const storage = (() => {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  })();

  function loadStoredConfig() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveStoredConfig(config) {
    if (!storage) return;
    try {
      storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (_) {}
  }

  function applyStoredConfigToSliders(config) {
    if (!config) return;
    const nextInhale = clampNumber(config.inhaleSeconds, INHALE_MIN_SECONDS, INHALE_MAX_SECONDS, DEFAULT_INHALE_SECONDS);
    const nextHold = clampNumber(config.holdSeconds, HOLD_MIN_SECONDS, HOLD_MAX_SECONDS, DEFAULT_HOLD_SECONDS);
    const nextExhale = clampNumber(config.exhaleSeconds, EXHALE_MIN_SECONDS, EXHALE_MAX_SECONDS, DEFAULT_EXHALE_SECONDS);
    const nextCycle = clampNumber(config.cycleCount, CYCLE_MIN_COUNT, CYCLE_MAX_COUNT, DEFAULT_CYCLE_COUNT);
    if (inhaleSlider && Number.isFinite(nextInhale)) {
      inhaleSlider.value = String(nextInhale);
    }
    if (holdSlider && Number.isFinite(nextHold)) {
      holdSlider.value = String(nextHold);
    }
    if (exhaleSlider && Number.isFinite(nextExhale)) {
      exhaleSlider.value = String(nextExhale);
    }
    if (cycleSlider && Number.isFinite(nextCycle)) {
      cycleSlider.value = String(nextCycle);
    }
  }

  function applyDefaultConfigToSliders() {
    if (inhaleSlider) {
      inhaleSlider.value = String(DEFAULT_INHALE_SECONDS);
    }
    if (holdSlider) {
      holdSlider.value = String(DEFAULT_HOLD_SECONDS);
    }
    if (exhaleSlider) {
      exhaleSlider.value = String(DEFAULT_EXHALE_SECONDS);
    }
    if (cycleSlider) {
      cycleSlider.value = String(DEFAULT_CYCLE_COUNT);
    }
  }

  applyStoredConfigToSliders(loadStoredConfig());

  const audioEngine = createGuideAudio();
  const audioUnlock = setupAudioUnlockController(audioEngine);
  audioEngine.ensureContext().then(() => {
    setTimeout(() => {
      audioEngine.poke().catch(() => {});
    }, 0);
  }).catch(() => {});

  let inhaleSeconds = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS, INHALE_MIN_SECONDS, INHALE_MAX_SECONDS);
  let holdSeconds = getSliderValue(holdSlider, DEFAULT_HOLD_SECONDS, HOLD_MIN_SECONDS, HOLD_MAX_SECONDS);
  let exhaleSeconds = getSliderValue(exhaleSlider, DEFAULT_EXHALE_SECONDS, EXHALE_MIN_SECONDS, EXHALE_MAX_SECONDS);
  let cycleCount = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT, CYCLE_MIN_COUNT, CYCLE_MAX_COUNT);
  let pattern = buildPattern(inhaleSeconds, holdSeconds, exhaleSeconds, cycleCount);
  let totalSeconds = getTotalSeconds(pattern);

  let isRunning = false;
  let isCountdown = false;
  let currentIndex = 0;
  let phaseEndTs = 0;
  let timerRaf = 0;
  let totalStartTs = 0;
  let countdownStartTs = 0;
  let countdownRaf = 0;
  let pendingAudioRefresh = false;
  let refreshInFlight = null;

  function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function getSliderValue(slider, fallback, min, max) {
    if (!slider) return fallback;
    const raw = Number(slider.value);
    return clampNumber(raw, min, max, fallback);
  }

  function buildPattern(inhaleSec, holdSec, exhaleSec, sets) {
    return Array.from({ length: sets }, () => (
      BASE_PATTERN.map(({ label, key, calcDuration }) => ({
        label,
        key,
        duration: calcDuration(inhaleSec, holdSec, exhaleSec),
      }))
    )).flat();
  }

  function getTotalSeconds(phases) {
    return phases.reduce((sum, phase) => sum + phase.duration, 0);
  }

  function updateProgress(totalElapsedSec) {
    const progressDeg = totalSeconds ? Math.min(360, (totalElapsedSec / totalSeconds) * 360) : 0;
    progressRing.style.background = `conic-gradient(var(--accent) ${progressDeg}deg, rgba(255,255,255,0.08) ${progressDeg}deg)`;
  }

  function updatePhaseLabel(text, shouldAnnounce = true) {
    phaseLabel.textContent = text;
    if (shouldAnnounce && phaseLiveRegion) {
      phaseLiveRegion.textContent = `${text}のフェーズ`;
    }
  }

  function updateConfigDisplay() {
    if (inhaleSlider) {
      inhaleSlider.value = String(inhaleSeconds);
      inhaleSlider.setAttribute('aria-valuenow', String(inhaleSeconds));
      inhaleSlider.setAttribute('aria-valuetext', `${inhaleSeconds}秒`);
    }
    if (holdSlider) {
      holdSlider.value = String(holdSeconds);
      holdSlider.setAttribute('aria-valuenow', String(holdSeconds));
      holdSlider.setAttribute('aria-valuetext', `${holdSeconds}秒`);
    }
    if (exhaleSlider) {
      exhaleSlider.value = String(exhaleSeconds);
      exhaleSlider.setAttribute('aria-valuenow', String(exhaleSeconds));
      exhaleSlider.setAttribute('aria-valuetext', `${exhaleSeconds}秒`);
    }
    if (cycleSlider) {
      cycleSlider.value = String(cycleCount);
      cycleSlider.setAttribute('aria-valuenow', String(cycleCount));
      cycleSlider.setAttribute('aria-valuetext', `${cycleCount}回`);
    }
    if (inhaleSecondsValue) {
      inhaleSecondsValue.textContent = String(inhaleSeconds);
    }
    if (holdSecondsValue) {
      holdSecondsValue.textContent = String(holdSeconds);
    }
    if (exhaleSecondsValue) {
      exhaleSecondsValue.textContent = String(exhaleSeconds);
    }
    if (cycleCountValue) {
      cycleCountValue.textContent = String(cycleCount);
    }
  }

  function applyConfig(options = {}) {
    const { persist = true } = options;
    inhaleSeconds = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS, INHALE_MIN_SECONDS, INHALE_MAX_SECONDS);
    holdSeconds = getSliderValue(holdSlider, DEFAULT_HOLD_SECONDS, HOLD_MIN_SECONDS, HOLD_MAX_SECONDS);
    exhaleSeconds = getSliderValue(exhaleSlider, DEFAULT_EXHALE_SECONDS, EXHALE_MIN_SECONDS, EXHALE_MAX_SECONDS);
    cycleCount = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT, CYCLE_MIN_COUNT, CYCLE_MAX_COUNT);
    pattern = buildPattern(inhaleSeconds, holdSeconds, exhaleSeconds, cycleCount);
    totalSeconds = getTotalSeconds(pattern);
    reset();
    updateConfigDisplay();
    if (persist) {
      persistCurrentConfig();
    }
  }

  function announceConfig() {
    if (!phaseLiveRegion) return;
    phaseLiveRegion.textContent = `吸う${inhaleSeconds}秒、止める${holdSeconds}秒、吐く${exhaleSeconds}秒、${cycleCount}回のサイクルを設定しました`;
  }

  function startCountdown() {
    if (isRunning || isCountdown) return;
    isCountdown = true;
    startButton.textContent = '停止';
    startButton.setAttribute('aria-label', 'タイマー停止');
    updatePhaseLabel('まず吐いて');
    countdownLabel.textContent = String(COUNTDOWN_SECONDS);
    updateProgress(0);
    countdownStartTs = performance.now();
    countdownRaf = requestAnimationFrame(countdownLoop);
    audioEngine.playGuide('countdown');
  }

  function stopCountdown() {
    if (!isCountdown) return;
    isCountdown = false;
    cancelAnimationFrame(countdownRaf);
    countdownRaf = 0;
    countdownStartTs = 0;
  }

  function countdownLoop(now) {
    if (!isCountdown) return;
    const elapsedSec = (now - countdownStartTs) / ONE_SECOND_MS;
    const remaining = COUNTDOWN_SECONDS - elapsedSec;
    if (remaining <= 0) {
      stopCountdown();
      beginSession(now);
      return;
    }
    countdownLabel.textContent = String(Math.max(1, Math.ceil(remaining)));
    countdownRaf = requestAnimationFrame(countdownLoop);
  }

  function beginSession(startTimestamp = performance.now()) {
    if (isRunning) return;
    flushAudioRefresh({ force: true });
    isRunning = true;
    // ここでは unlock の Promise を待たず、可能なら同期的に初回ガイド音を鳴らす
    // （pointerdown で resume 済みであれば iOS でも通る）

    startButton.textContent = '停止';
    startButton.setAttribute('aria-label', 'タイマー停止');
    currentIndex = 0;
    totalStartTs = startTimestamp;
    const first = pattern[currentIndex];
    updatePhaseLabel(first.label);
    phaseEndTs = totalStartTs + first.duration * ONE_SECOND_MS;
    countdownLabel.textContent = String(first.duration);
    updateProgress(0);
    timerRaf = requestAnimationFrame(loop);
    tryVibrate(30);

    const initialGuide = audioEngine.playGuide('inhale');
    const ensureInitialGuide = () => {
      audioUnlock.unlock().then((ctx) => {
        if (ctx && isRunning && currentIndex === 0) {
          audioEngine.playGuide('inhale');
        }
      }).catch(() => {});
    };
    if (initialGuide && typeof initialGuide.then === 'function') {
      initialGuide.then((played) => {
        if (!played) {
          ensureInitialGuide();
        }
      }).catch(() => {
        ensureInitialGuide();
      });
    } else {
      ensureInitialGuide();
    }
  }

  function reset() {
    stopCountdown();
    isRunning = false;
    cancelAnimationFrame(timerRaf);
    timerRaf = 0;
    currentIndex = 0;
    phaseEndTs = 0;
    totalStartTs = 0;
    startButton.textContent = 'はじめる';
    startButton.setAttribute('aria-label', 'タイマー開始');
    updatePhaseLabel('タップで開始', false);
    countdownLabel.textContent = String(totalSeconds);
    updateProgress(0);
    flushAudioRefresh({ force: true });
  }

  function finish() {
    tryVibrate([40, 60, 40]);
    audioEngine.playGuide('end');
    isRunning = false;
    cancelAnimationFrame(timerRaf);
    timerRaf = 0;
    updatePhaseLabel('おつかれさま');
    setTimeout(() => {
      alert('おつかれさま! 瞑想が終わったよ。');
      reset();
    }, 500);
  }

  function formatSec(sec) {
    return Math.max(0, Math.ceil(sec)).toString();
  }

  function loop() {
    const now = performance.now();
    const totalElapsedSec = (now - totalStartTs) / ONE_SECOND_MS;
    updateProgress(totalElapsedSec);

    const remainingCurrent = (phaseEndTs - now) / ONE_SECOND_MS;
    countdownLabel.textContent = formatSec(remainingCurrent);

    if (remainingCurrent <= 0) {
      currentIndex += 1;
      if (currentIndex >= pattern.length) {
        finish();
        return;
      }
      const nextPhase = pattern[currentIndex];
      updatePhaseLabel(nextPhase.label);
      phaseEndTs = now + nextPhase.duration * ONE_SECOND_MS;
      const shouldPlayGuide = !(nextPhase.key === 'hold' && nextPhase.duration === 0);
      if (shouldPlayGuide) {
        audioEngine.playGuide(nextPhase.key);
      }
    }

    timerRaf = requestAnimationFrame(loop);
  }

  function onButtonClick() {
    if (isRunning || isCountdown) {
      reset();
    } else {
      startCountdown();
    }
  }

  function tryVibrate(patternInput) {
    if (navigator.vibrate) {
      try { navigator.vibrate(patternInput); } catch (_) {}
    }
  }

  function persistCurrentConfig() {
    saveStoredConfig({
      inhaleSeconds,
      holdSeconds,
      exhaleSeconds,
      cycleCount,
    });
  }

  applyConfig();

  // --- ユーザー操作ハンドラ: 最初のタップで同期的に poke() して解錠を強化 ---
  async function withAudioUnlock(action) {
    const pokePromise = audioEngine.poke();
    audioUnlock.unlock();
    try {
      await pokePromise;
    } catch (_) {}
    return action();
  }

  startButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    await withAudioUnlock(onButtonClick);
  }, { passive: true });
  timerCard.addEventListener('click', async () => {
    await withAudioUnlock(onButtonClick);
  }, { passive: true });
  timerCard.tabIndex = 0;
  timerCard.setAttribute('role', 'button');
  timerCard.setAttribute('aria-label', 'タイマーの開始と停止');
  timerCard.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      await withAudioUnlock(onButtonClick);
    }
  });

  if (inhaleSlider) {
    inhaleSlider.addEventListener('input', () => {
      applyConfig({ persist: false });
    });
    inhaleSlider.addEventListener('change', () => {
      const next = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS, INHALE_MIN_SECONDS, INHALE_MAX_SECONDS);
      if (next !== inhaleSeconds) {
        applyConfig();
      } else {
        persistCurrentConfig();
      }
      announceConfig();
    });
  }

  if (holdSlider) {
    holdSlider.addEventListener('input', () => {
      applyConfig({ persist: false });
    });
    holdSlider.addEventListener('change', () => {
      const next = getSliderValue(holdSlider, DEFAULT_HOLD_SECONDS, HOLD_MIN_SECONDS, HOLD_MAX_SECONDS);
      if (next !== holdSeconds) {
        applyConfig();
      } else {
        persistCurrentConfig();
      }
      announceConfig();
    });
  }

  if (exhaleSlider) {
    exhaleSlider.addEventListener('input', () => {
      applyConfig({ persist: false });
    });
    exhaleSlider.addEventListener('change', () => {
      const next = getSliderValue(exhaleSlider, DEFAULT_EXHALE_SECONDS, EXHALE_MIN_SECONDS, EXHALE_MAX_SECONDS);
      if (next !== exhaleSeconds) {
        applyConfig();
      } else {
        persistCurrentConfig();
      }
      announceConfig();
    });
  }

  if (cycleSlider) {
    cycleSlider.addEventListener('input', () => {
      applyConfig({ persist: false });
    });
    cycleSlider.addEventListener('change', () => {
      const next = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT, CYCLE_MIN_COUNT, CYCLE_MAX_COUNT);
      if (next !== cycleCount) {
        applyConfig();
      } else {
        persistCurrentConfig();
      }
      announceConfig();
    });
  }

  if (resetConfigBtn) {
    resetConfigBtn.addEventListener('click', () => {
      applyDefaultConfigToSliders();
      applyConfig();
      announceConfig();
    }, { passive: true });
  }

  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', async () => {
      const url = 'https://kg9n3n8y.github.io/1min_meditation/';
      try {
        await navigator.clipboard.writeText(url);
        copyUrlBtn.textContent = 'コピーしたよ!';
        setTimeout(() => { copyUrlBtn.textContent = 'URLをコピー'; }, 1500);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        copyUrlBtn.textContent = 'コピーしたよ!';
        setTimeout(() => { copyUrlBtn.textContent = 'URLをコピー'; }, 1500);
      }
    }, { passive: true });
  }


  function createGuideAudio() {
    const AUDIO_FILES = {
      inhale: 'audio/inhale.mp3',
      hold: 'audio/hold.mp3',
      exhale: 'audio/exhale.mp3',
      end: 'audio/end.mp3',
      countdown: 'audio/muon.mp3',
    };

    const audioElements = {};
    let isMuted = false;
    let unlocked = false;

    const FAKE_CONTEXT = {
      state: 'running',
      resume: () => Promise.resolve(FAKE_CONTEXT),
    };

    function ensureElement(kind) {
      const url = AUDIO_FILES[kind];
      if (!url) return null;
      if (!audioElements[kind]) {
        const element = new Audio();
        element.src = url;
        element.preload = 'auto';
        element.playsInline = true;
        element.setAttribute('playsinline', '');
        element.setAttribute('webkit-playsinline', '');
        element.load();
        element.muted = isMuted;
        element.addEventListener('ended', () => {
          try {
            element.currentTime = 0;
          } catch (_) {}
        });
        audioElements[kind] = element;
      }
      return audioElements[kind];
    }

    function ensureAllElements() {
      Object.keys(AUDIO_FILES).forEach(ensureElement);
    }

    function ensureContext() {
      ensureAllElements();
      return Promise.resolve(FAKE_CONTEXT);
    }

    function withElement(kind, callback) {
      const element = ensureElement(kind);
      if (!element) return null;
      return callback(element);
    }

    function attemptPlay(element, callbacks = {}) {
      if (!element) return Promise.resolve(false);
      const { onSuccess, onFailure } = callbacks;

      const handleFailure = (error) => {
        if (error && error.name !== 'AbortError') {
          console.warn('Audio play blocked:', error);
        }
        if (typeof onFailure === 'function') {
          try { onFailure(error); } catch (callbackError) {
            console.error('Audio onFailure callback failed:', callbackError);
          }
        }
        return false;
      };

      const handleSuccess = () => {
        unlocked = true;
        if (typeof onSuccess === 'function') {
          try { onSuccess(); } catch (callbackError) {
            console.error('Audio onSuccess callback failed:', callbackError);
          }
        }
        return true;
      };

      try {
        const playResult = element.play();
        if (playResult && typeof playResult.then === 'function') {
          return playResult.then(handleSuccess).catch((error) => handleFailure(error));
        }
        return Promise.resolve(handleSuccess());
      } catch (error) {
        console.warn('Audio play failed:', error);
        return Promise.resolve(handleFailure(error));
      }
    }

    function playGuide(kind) {
      if (isMuted) return Promise.resolve(false);
      const result = withElement(kind, (element) => {
        element.muted = isMuted; // poke() の一時的なミュート状態を確実に戻す
        try {
          element.currentTime = 0;
        } catch (_) {}
        return attemptPlay(element);
      });
      return result || Promise.resolve(false);
    }

    function toggleMuted() {
      setMuted(!isMuted);
      return isMuted;
    }

    function setMuted(value) {
      isMuted = Boolean(value);
      Object.keys(audioElements).forEach((key) => {
        const element = audioElements[key];
        if (!element) return;
        element.muted = isMuted;
        if (isMuted) {
          try { element.pause(); } catch (_) {}
          try { element.currentTime = 0; } catch (_) {}
        }
      });
      return isMuted;
    }

    function muted() {
      return isMuted;
    }

    function refreshOutput() {
      Object.keys(audioElements).forEach((key) => {
        const element = audioElements[key];
        if (!element) return;
        try { element.pause(); } catch (_) {}
        delete audioElements[key];
      });
      unlocked = false;
      return ensureContext();
    }

    function resumeIfNeeded() {
      ensureAllElements();
      return Promise.resolve(FAKE_CONTEXT);
    }

    function poke() {
      ensureAllElements();
      const attempts = Object.keys(audioElements).map((key) => {
        const element = audioElements[key];
        if (!element) return Promise.resolve(false);
        const restoreMuted = element.muted;
        element.muted = true;
        return attemptPlay(element, {
          onSuccess: () => {
            try { element.pause(); } catch (_) {}
            try { element.currentTime = 0; } catch (_) {}
          },
        }).finally(() => {
          element.muted = restoreMuted;
        });
      });
      return Promise.all(attempts).then((results) => results.some(Boolean));
    }

    function isRunningSync() {
      return unlocked;
    }

    return {
      ensureContext,
      playGuide,
      toggleMuted,
      setMuted,
      isMuted: muted,
      refreshOutput,
      resumeIfNeeded,
      poke,
      isRunningSync,
    };
  }

  function setupAudioUnlockController(engine) {
    let unlocked = false;
    let pendingUnlock = null;
    let listenersAttached = false;

    const gestureConfigs = [
      { target: document, type: 'pointerdown', options: { passive: true, capture: true } },
      { target: document, type: 'pointerup', options: { passive: true, capture: true } },
      { target: document, type: 'touchstart', options: { passive: true, capture: true } },
      { target: document, type: 'touchend', options: { passive: true, capture: true } },
      { target: document, type: 'mousedown', options: { passive: true, capture: true } },
      { target: document, type: 'mouseup', options: { passive: true, capture: true } },
      { target: document, type: 'click', options: { passive: true, capture: true } },
      { target: document, type: 'keydown', options: { capture: true } },
    ];

    function shouldHandle(event) {
      if (event.type !== 'keydown') return true;
      if (event.repeat) return false;
      const key = event.key;
      return key === 'Enter' || key === ' ' || key === 'Spacebar';
    }

    function attachListeners() {
      if (listenersAttached) return;
      gestureConfigs.forEach(({ target, type, options }) => {
        target.addEventListener(type, onGesture, options);
      });
      listenersAttached = true;
    }

    function detachListeners() {
      if (!listenersAttached) return;
      gestureConfigs.forEach(({ target, type, options }) => {
        target.removeEventListener(type, onGesture, options);
      });
      listenersAttached = false;
    }

    function unlock() {
      if (unlocked) {
        return engine.ensureContext();
      }
      if (!pendingUnlock) {
        pendingUnlock = engine.ensureContext().then((ctx) => {
          if (ctx && ctx.state === 'running') {
            unlocked = true;
            detachListeners();
          }
          return ctx;
        }).catch(() => null).finally(() => {
          if (!unlocked) {
            pendingUnlock = null;
          }
        });
      }
      return pendingUnlock;
    }

    function onGesture(event) {
      if (!shouldHandle(event)) return;
      // 同期 poke で解錠成功率を底上げ
      try { engine.poke(); } catch (_) {}
      unlock();
    }

    attachListeners();

    return {
      unlock,
      markLocked() {
        if (!unlocked) return;
        unlocked = false;
        pendingUnlock = null;
        attachListeners();
      },
    };
  }

  function flushAudioRefresh(options = {}) {
    const { force = false } = options;
    if (!force) {
      if (!pendingAudioRefresh) return false;
      if (isRunning) return false;
      if (document.visibilityState && document.visibilityState === 'hidden') {
        return false;
      }
    } else if (!pendingAudioRefresh && !refreshInFlight) {
      return false;
    }
    if (refreshInFlight) {
      pendingAudioRefresh = false;
      return false;
    }
    pendingAudioRefresh = false;
    const refreshPromise = audioEngine.refreshOutput().catch(() => null);
    refreshInFlight = refreshPromise.finally(() => {
      audioUnlock.markLocked();
      refreshInFlight = null;
      if (pendingAudioRefresh) {
        flushAudioRefresh();
      }
    });
    return true;
  }

  function scheduleAudioRefresh() {
    pendingAudioRefresh = true;
    flushAudioRefresh();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      audioUnlock.markLocked();
      scheduleAudioRefresh();
      return;
    }
    audioEngine.resumeIfNeeded().catch(() => {});
    flushAudioRefresh();
  });

  window.addEventListener('focus', () => {
    audioEngine.resumeIfNeeded().catch(() => {});
    flushAudioRefresh();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      scheduleAudioRefresh();
    } else {
      audioEngine.resumeIfNeeded().catch(() => {});
    }
    flushAudioRefresh();
  });

  window.addEventListener('pagehide', () => {
    audioUnlock.markLocked();
    scheduleAudioRefresh();
  });

  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      scheduleAudioRefresh();
    });
  }
})();
