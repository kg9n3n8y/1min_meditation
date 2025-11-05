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
  const HOLD_MAX_SECONDS = 10;
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
    if (!isRunning) {
      return;
    }
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

    if (!isRunning) {
      return;
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
    let pokePromise;
    try {
      const maybePoke = audioEngine.poke();
      pokePromise = (maybePoke && typeof maybePoke.then === 'function')
        ? maybePoke
        : Promise.resolve(maybePoke);
    } catch (_) {
      pokePromise = Promise.resolve(false);
    }
    const unlockPromise = audioUnlock.unlock().catch(() => null);

    // 音声コンテキストをできるだけ操作前に復帰させたいが、無限待機は避ける
    try {
      await Promise.race([
        unlockPromise,
        new Promise((resolve) => { setTimeout(resolve, 140); }),
      ]);
    } catch (_) {}

    let actionError;
    let actionResult;
    try {
      actionResult = action();
      if (actionResult && typeof actionResult.then === 'function') {
        await actionResult;
      }
    } catch (error) {
      actionError = error;
    }

    try {
      // iOS PWA の復帰直後に poke() が解決しないケースがあるためタイムアウトを設ける
      await Promise.race([
        pokePromise,
        new Promise((resolve) => { setTimeout(resolve, 180); }),
      ]);
    } catch (_) {}

    if (actionError) {
      throw actionError;
    }
    return actionResult;
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
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const SOUND_PRESETS = {
      inhale: {
        baseFrequency: 760,
        partials: [0.5, 1, 2.4, 3.35, 4.5],
        partialGains: [0.88, 1, 0.46, 0.32, 0.2],
        partialDelays: [0, 0, 0, 0, 0],
        duration: 4.1,
        attack: 0.02,
        release: 3.4,
        gain: 0.63,
        filter: { type: 'bandpass', frequency: 1100, Q: 9.5 },
        detuneSpread: 1.0,
        strike: { duration: 0.16, gain: 0.38, frequency: 2100, Q: 4.5, type: 'bandpass' },
        modulation: { frequency: 0.3, depth: 0.06, delay: 0.6, type: 'sine' },
      },
      hold: {
        baseFrequency: 560,
        partials: [0.5, 1, 2.15, 2.92, 4.1],
        partialGains: [0.86, 1, 0.44, 0.3, 0.18],
        partialDelays: [0, 0, 0, 0, 0],
        duration: 3.9,
        attack: 0.024,
        release: 3.2,
        gain: 0.58,
        filter: { type: 'bandpass', frequency: 850, Q: 8.8 },
        detuneSpread: 0.7,
        strike: { duration: 0.15, gain: 0.32, frequency: 1750, Q: 3.8, type: 'bandpass' },
        modulation: { frequency: 0.26, depth: 0.06, delay: 0.8, type: 'sine' },
      },
      exhale: {
        baseFrequency: 420,
        partials: [0.5, 1, 2.05, 2.78, 3.95, 5.3],
        partialGains: [0.84, 1, 0.5, 0.32, 0.2, 0.12],
        partialDelays: [0, 0, 0, 0, 0, 0],
        duration: 5.0,
        attack: 0.022,
        release: 4.4,
        gain: 0.68,
        filter: { type: 'bandpass', frequency: 720, Q: 9.2 },
        detuneSpread: 0.9,
        strike: { duration: 0.18, gain: 0.34, frequency: 1600, Q: 4.2, type: 'bandpass' },
        modulation: { frequency: 0.24, depth: 0.08, delay: 0.9, type: 'sine' },
      },
      end: {
        baseFrequency: 700,
        partials: [0.5, 1, 2.15, 2.88, 4.05, 5.6],
        partialGains: [0.92, 1, 0.54, 0.36, 0.24, 0.15],
        partialDelays: [0, 0, 0, 0, 0, 0],
        duration: 6.2,
        attack: 0.022,
        release: 5.4,
        gain: 0.75,
        filter: { type: 'bandpass', frequency: 1020, Q: 10 },
        detuneSpread: 1.0,
        strike: { duration: 0.2, gain: 0.4, frequency: 2100, Q: 4.8, type: 'bandpass' },
        modulation: { frequency: 0.22, depth: 0.09, delay: 0.95, type: 'sine' },
      },
      countdown: {
        baseFrequency: 680,
        partials: [0.5, 1, 2.2, 3.05],
        partialGains: [0.8, 1, 0.46, 0.28],
        partialDelays: [0, 0, 0, 0],
        duration: 2.6,
        attack: 0.018,
        release: 2.0,
        gain: 0.52,
        filter: { type: 'bandpass', frequency: 900, Q: 8.5 },
        detuneSpread: 0.7,
        strike: { duration: 0.14, gain: 0.3, frequency: 1750, Q: 3.6, type: 'bandpass' },
        modulation: { frequency: 0.3, depth: 0.06, delay: 0.6, type: 'sine' },
      },
    };

    let context = null;
    let masterGain = null;
    let isMuted = false;
    let unlocked = false;

    function ensureMasterGain(ctx) {
      if (!masterGain) {
        masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(isMuted ? 0 : 1, ctx.currentTime);
        masterGain.connect(ctx.destination);
      }
      return masterGain;
    }

    function ensureContext() {
      if (!AudioContextCtor) {
        return Promise.reject(new Error('Web Audio API is not available.'));
      }
      if (context && context.state === 'closed') {
        context = null;
        masterGain = null;
      }
      if (!context) {
        try {
          context = new AudioContextCtor();
        } catch (error) {
          return Promise.reject(error);
        }
        ensureMasterGain(context);
      }
      if (context.state === 'running') {
        unlocked = true;
        return Promise.resolve(context);
      }
      return context.resume().then(() => {
        unlocked = context.state === 'running';
        return context;
      }).catch(() => context);
    }

    function scheduleTone(ctx, preset) {
      if (!preset) return false;
      const now = ctx.currentTime;
      ensureMasterGain(ctx);

      const attack = Math.max(0.003, Number.isFinite(preset.attack) ? preset.attack : 0.01);
      const release = Math.max(0.08, Number.isFinite(preset.release) ? preset.release : 0.4);
      const duration = Math.max(attack + release, Number.isFinite(preset.duration) ? preset.duration : 1.2);
      const peakGain = Math.min(1, Math.max(0.05, Number.isFinite(preset.gain) ? preset.gain : 0.6));

      const envelopeGain = ctx.createGain();
      const cleanupCallbacks = [];
      envelopeGain.gain.cancelScheduledValues(now);
      envelopeGain.gain.setValueAtTime(0.0001, now);
      envelopeGain.gain.linearRampToValueAtTime(peakGain, now + attack);
      envelopeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      cleanupCallbacks.push(() => {
        try { envelopeGain.disconnect(); } catch (_) {}
      });

      let destinationNode = masterGain;
      let filterNode = null;
      if (preset.filter && typeof preset.filter === 'object') {
        filterNode = ctx.createBiquadFilter();
        filterNode.type = preset.filter.type || 'bandpass';
        const filterFreq = Number.isFinite(preset.filter.frequency)
          ? preset.filter.frequency
          : (Number.isFinite(preset.baseFrequency) ? preset.baseFrequency * 2 : 1200);
        filterNode.frequency.setValueAtTime(filterFreq, now);
        if (Number.isFinite(preset.filter.Q)) {
          filterNode.Q.setValueAtTime(preset.filter.Q, now);
        }
        if (Number.isFinite(preset.filter.gain)) {
          filterNode.gain.setValueAtTime(preset.filter.gain, now);
        }
        destinationNode = filterNode;
        cleanupCallbacks.push(() => {
          try { filterNode.disconnect(); } catch (_) {}
        });
      }

      if (preset.modulation && typeof preset.modulation === 'object') {
        const modulationConfig = preset.modulation;
        const modulationGain = ctx.createGain();
        modulationGain.gain.setValueAtTime(1, now);
        const depthGain = ctx.createGain();
        const modulationDepth = Math.max(0, Math.min(0.8, Number.isFinite(modulationConfig.depth) ? modulationConfig.depth : 0.25));
        depthGain.gain.setValueAtTime(modulationDepth, now);
        const lfo = ctx.createOscillator();
        lfo.type = modulationConfig.type || 'sine';
        const modulationFrequency = Math.max(0.05, Number.isFinite(modulationConfig.frequency) ? modulationConfig.frequency : 0.6);
        lfo.frequency.setValueAtTime(modulationFrequency, now);
        const modulationDelay = Math.max(0, Number.isFinite(modulationConfig.delay) ? modulationConfig.delay : 0);
        const modulationStopTime = now + duration + 1.2;

        depthGain.connect(modulationGain.gain);
        lfo.connect(depthGain);
        envelopeGain.connect(modulationGain);
        modulationGain.connect(destinationNode);

        const modulationStartTime = now + modulationDelay;
        lfo.start(modulationStartTime);
        lfo.stop(modulationStopTime);

        lfo.addEventListener('ended', () => {
          try { lfo.disconnect(); } catch (_) {}
          try { depthGain.disconnect(); } catch (_) {}
        });
        cleanupCallbacks.push(() => {
          try { modulationGain.disconnect(); } catch (_) {}
        });
      } else {
        envelopeGain.connect(destinationNode);
      }

      if (filterNode) {
        filterNode.connect(masterGain);
      }

      const partials = Array.isArray(preset.partials) && preset.partials.length
        ? preset.partials
        : [1];
      const baseFrequency = Number.isFinite(preset.baseFrequency)
        ? preset.baseFrequency
        : (Number.isFinite(preset.frequency) ? preset.frequency : 660);
      const partialGains = Array.isArray(preset.partialGains) ? preset.partialGains : [];
      const partialDelays = Array.isArray(preset.partialDelays) ? preset.partialDelays : [];
      const detuneSpread = Number.isFinite(preset.detuneSpread) ? preset.detuneSpread : 0;

      let strikeDuration = 0;
      if (preset.strike && typeof preset.strike === 'object') {
        const strikeConfig = preset.strike;
        const strikeGain = ctx.createGain();
        const strikeFilter = ctx.createBiquadFilter();
        strikeFilter.type = strikeConfig.type || 'highpass';
        const strikeFreq = Number.isFinite(strikeConfig.frequency) ? strikeConfig.frequency : 2000;
        strikeFilter.frequency.setValueAtTime(strikeFreq, now);
        if (Number.isFinite(strikeConfig.Q)) {
          strikeFilter.Q.setValueAtTime(strikeConfig.Q, now);
        }
        strikeGain.gain.setValueAtTime(0.0001, now);
        const strikePeakGain = Math.max(0.05, Math.min(1, Number.isFinite(strikeConfig.gain) ? strikeConfig.gain : 0.8));
        const resolvedStrikeDuration = Math.max(0.05, Number.isFinite(strikeConfig.duration) ? strikeConfig.duration : 0.1);
        strikeDuration = resolvedStrikeDuration;
        strikeGain.gain.linearRampToValueAtTime(strikePeakGain, now + 0.005);
        strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + resolvedStrikeDuration);

        const channelLength = Math.max(1, Math.ceil(ctx.sampleRate * resolvedStrikeDuration));
        const noiseBuffer = ctx.createBuffer(1, channelLength, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < channelLength; i += 1) {
          noiseData[i] = (Math.random() * 2) - 1;
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = false;

        noiseSource.connect(strikeFilter);
        strikeFilter.connect(strikeGain);
        const strikeTarget = filterNode || masterGain;
        strikeGain.connect(strikeTarget);

        noiseSource.start(now);
        noiseSource.stop(now + resolvedStrikeDuration + 0.05);

        noiseSource.addEventListener('ended', () => {
          try { noiseSource.disconnect(); } catch (_) {}
          try { strikeFilter.disconnect(); } catch (_) {}
          try { strikeGain.disconnect(); } catch (_) {}
        });
      }

      const cleanupDelayMs = Math.ceil((duration + strikeDuration + 1.2) * 1000);

      partials.forEach((multiplier, index) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();

        const delay = Number.isFinite(partialDelays[index]) ? Math.max(0, partialDelays[index]) : 0;
        const startTime = now + delay;
        const partialDuration = Math.max(0.4, duration - delay);
        const detune = detuneSpread
          ? detuneSpread * (index - ((partials.length - 1) / 2))
          : 0;

        const partialGainValue = Math.max(
          0.0001,
          Number.isFinite(partialGains[index])
            ? partialGains[index]
            : (1 / Math.pow(index + 1.1, 1.35))
        );

        osc.type = preset.oscillatorType || 'sine';
        osc.frequency.setValueAtTime(baseFrequency * multiplier, startTime);
        if (detune) {
          osc.detune.setValueAtTime(detune, startTime);
        }

        oscGain.gain.setValueAtTime(partialGainValue, startTime);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, startTime + partialDuration);

        osc.connect(oscGain);
        oscGain.connect(envelopeGain);

        osc.start(startTime);
        osc.stop(startTime + partialDuration + 0.1);

        osc.addEventListener('ended', () => {
          try { osc.disconnect(); } catch (_) {}
          try { oscGain.disconnect(); } catch (_) {}
        });
      });

      const timerHost = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
        ? window
        : globalThis;
      timerHost.setTimeout(() => {
        cleanupCallbacks.forEach((callback) => {
          try { callback(); } catch (_) {}
        });
      }, cleanupDelayMs);

      return true;
    }

    function playGuide(kind) {
      if (isMuted) return Promise.resolve(false);
      const preset = SOUND_PRESETS[kind];
      if (!preset) return Promise.resolve(false);

      return ensureContext().then((ctx) => {
        if (!ctx) return false;
        const needsResume = ctx.state === 'suspended' || ctx.state === 'interrupted';
        const ensureRunning = needsResume
          ? ctx.resume().catch(() => ctx)
          : Promise.resolve(ctx);
        return ensureRunning.then((activeCtx) => {
          if (!activeCtx || activeCtx.state !== 'running') {
            return false;
          }
          const played = scheduleTone(activeCtx, preset);
          if (played) {
            unlocked = true;
          }
          return played;
        });
      }).catch((error) => {
        console.warn('Audio play failed:', error);
        return false;
      });
    }

    function toggleMuted() {
      setMuted(!isMuted);
      return isMuted;
    }

    function setMuted(value) {
      isMuted = Boolean(value);
      if (masterGain && context && context.state !== 'closed') {
        const targetGain = isMuted ? 0 : 1;
        masterGain.gain.setTargetAtTime(targetGain, context.currentTime, 0.02);
      }
      return isMuted;
    }

    function muted() {
      return isMuted;
    }

    function refreshOutput() {
      if (!context) {
        return ensureContext();
      }
      const oldContext = context;
      context = null;
      masterGain = null;
      unlocked = false;
      return oldContext.close().catch(() => null).then(() => ensureContext()).catch(() => null);
    }

    function resumeIfNeeded() {
      if (!context) {
        return ensureContext().catch(() => null);
      }
      if (context.state === 'running') {
        unlocked = true;
        return Promise.resolve(context);
      }
      return context.resume().then(() => {
        unlocked = context.state === 'running';
        return context;
      }).catch(() => context);
    }

    function poke() {
      return ensureContext().then((ctx) => {
        if (!ctx) return false;
        ensureMasterGain(ctx);
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const now = ctx.currentTime;

        gainNode.gain.setValueAtTime(0, now);

        oscillator.frequency.setValueAtTime(440, now);
        oscillator.connect(gainNode);
        gainNode.connect(masterGain);

        oscillator.start(now);
        oscillator.stop(now + 0.05);

        return new Promise((resolve) => {
          oscillator.addEventListener('ended', () => {
            try { oscillator.disconnect(); } catch (_) {}
            try { gainNode.disconnect(); } catch (_) {}
            unlocked = unlocked || ctx.state === 'running';
            resolve(ctx.state === 'running');
          });
        });
      }).catch(() => false);
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
