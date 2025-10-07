(() => {
  const startButton = document.getElementById('startButton');
  const phaseLabel = document.getElementById('phaseLabel');
  const countdownLabel = document.getElementById('countdownLabel');
  const progressRing = document.getElementById('progressRing');
  const timerCard = document.querySelector('.timer-card');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const inhaleSlider = document.getElementById('inhaleSlider');
  const cycleSlider = document.getElementById('cycleSlider');
  const inhaleSecondsValue = document.getElementById('inhaleSecondsValue');
  const cycleCountValue = document.getElementById('cycleCountValue');
  const breathingGuideText = document.getElementById('breathingGuideText');
  const phaseLiveRegion = document.getElementById('phaseLiveRegion');

  const ONE_SECOND_MS = 1000;
  const BASE_PATTERN = [
    { label: '吸う', key: 'inhale', multiplier: 1 },
    { label: '止める', key: 'hold', multiplier: 2 },
    { label: '吐く', key: 'exhale', multiplier: 2 },
  ];
  const DEFAULT_INHALE_SECONDS = 4;
  const DEFAULT_CYCLE_COUNT = 3;
  const SLIDER_MIN = 1;
  const SLIDER_MAX = 9;

  const audioEngine = createGuideAudio();

  let inhaleSeconds = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS);
  let cycleCount = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT);
  let pattern = buildPattern(inhaleSeconds, cycleCount);
  let totalSeconds = getTotalSeconds(pattern);

  let isRunning = false;
  let currentIndex = 0;
  let phaseEndTs = 0;
  let timerRaf = 0;
  let totalStartTs = 0;
  let pendingAudioRefresh = false;

  function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function getSliderValue(slider, fallback) {
    if (!slider) return fallback;
    const raw = Number(slider.value);
    return clampNumber(raw, SLIDER_MIN, SLIDER_MAX, fallback);
  }

  function buildPattern(inhaleSec, sets) {
    return Array.from({ length: sets }, () => (
      BASE_PATTERN.map(({ label, key, multiplier }) => ({
        label,
        key,
        duration: inhaleSec * multiplier,
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
    if (cycleSlider) {
      cycleSlider.value = String(cycleCount);
      cycleSlider.setAttribute('aria-valuenow', String(cycleCount));
      cycleSlider.setAttribute('aria-valuetext', `${cycleCount}回`);
    }
    if (inhaleSecondsValue) {
      inhaleSecondsValue.textContent = String(inhaleSeconds);
    }
    if (cycleCountValue) {
      cycleCountValue.textContent = String(cycleCount);
    }
    if (breathingGuideText) {
      const holdSec = inhaleSeconds * 2;
      const exhaleSec = inhaleSeconds * 2;
      breathingGuideText.textContent = `吸う ${inhaleSeconds}秒 → 止める ${holdSec}秒 → 吐く ${exhaleSec}秒 × ${cycleCount}回`;
    }
  }

  function applyConfig() {
    inhaleSeconds = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS);
    cycleCount = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT);
    pattern = buildPattern(inhaleSeconds, cycleCount);
    totalSeconds = getTotalSeconds(pattern);
    reset();
    updateConfigDisplay();
  }

  function announceConfig() {
    if (!phaseLiveRegion) return;
    const holdSec = inhaleSeconds * 2;
    const exhaleSec = inhaleSeconds * 2;
    phaseLiveRegion.textContent = `吸う${inhaleSeconds}秒、止める${holdSec}秒、吐く${exhaleSec}秒、${cycleCount}回のサイクルを設定しました`;
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    const ctxPromise = audioEngine.ensureContext();
    startButton.textContent = '停止';
    startButton.setAttribute('aria-label', 'タイマー停止');
    currentIndex = 0;
    totalStartTs = performance.now();
    const first = pattern[currentIndex];
    updatePhaseLabel(first.label);
    phaseEndTs = totalStartTs + first.duration * ONE_SECOND_MS;
    countdownLabel.textContent = String(first.duration);
    updateProgress(0);
    timerRaf = requestAnimationFrame(loop);
    tryVibrate(30);
    ctxPromise.then((ctx) => {
      if (ctx) audioEngine.playGuide('inhale');
    }).catch(() => {});
  }

  function reset() {
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
    if (pendingAudioRefresh) {
      audioEngine.refreshOutput().catch(() => {});
      pendingAudioRefresh = false;
    }
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
      audioEngine.playGuide(nextPhase.key);
    }

    timerRaf = requestAnimationFrame(loop);
  }

  function onButtonClick() {
    if (isRunning) {
      reset();
    } else {
      start();
    }
  }

  function tryVibrate(patternInput) {
    if (navigator.vibrate) {
      try { navigator.vibrate(patternInput); } catch (_) {}
    }
  }

  applyConfig();

  startButton.addEventListener('click', (e) => { e.stopPropagation(); onButtonClick(); }, { passive: true });
  timerCard.addEventListener('click', onButtonClick, { passive: true });
  timerCard.tabIndex = 0;
  timerCard.setAttribute('role', 'button');
  timerCard.setAttribute('aria-label', 'タイマーの開始と停止');
  timerCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onButtonClick();
    }
  });

  if (inhaleSlider) {
    inhaleSlider.addEventListener('input', () => {
      applyConfig();
    });
    inhaleSlider.addEventListener('change', () => {
      const next = getSliderValue(inhaleSlider, DEFAULT_INHALE_SECONDS);
      if (next !== inhaleSeconds) {
        applyConfig();
      }
      announceConfig();
    });
  }

  if (cycleSlider) {
    cycleSlider.addEventListener('input', () => {
      applyConfig();
    });
    cycleSlider.addEventListener('change', () => {
      const next = getSliderValue(cycleSlider, DEFAULT_CYCLE_COUNT);
      if (next !== cycleCount) {
        applyConfig();
      }
      announceConfig();
    });
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


  const warmupOnInteraction = () => {
    audioEngine.ensureContext().catch(() => {});
  };

  ['pointerdown', 'touchstart'].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      warmupOnInteraction();
    }, { once: true, passive: true });
  });

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const swUrl = './service-worker.js';
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl).catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    });
  }

  registerServiceWorker();

  function createGuideAudio() {
    let audioCtx = null;
    let isMuted = false;
    let warmedUp = false;
    let resumePending = false;

    function instantiateAudioContext() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        return new Ctx({ latencyHint: 'interactive' });
      } catch (_) {
        try {
          return new Ctx();
        } catch (error) {
          console.error('Failed to create AudioContext:', error);
          return null;
        }
      }
    }

    function bindLifecycleHooks(ctx) {
      if (!ctx || typeof ctx.addEventListener !== 'function') return;
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'interrupted') {
          resumePending = true;
        } else if (ctx.state === 'running') {
          resumePending = false;
        } else if (ctx.state === 'suspended' && !document.hidden) {
          ctx.resume().catch(() => {});
        }
      });
    }

    function getAudioCtx() {
      if (!audioCtx) {
        audioCtx = instantiateAudioContext();
        if (audioCtx) {
          bindLifecycleHooks(audioCtx);
        }
      }
      return audioCtx;
    }

    function warmup(ctx) {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain).connect(ctx.destination);
        const now = ctx.currentTime;
        osc.start(now);
        osc.stop(now + 0.01);
      } catch (error) {
        console.error('Failed to warm up AudioContext:', error);
      }
    }

    function ensureContext() {
      const ctx = getAudioCtx();
      if (!ctx) return Promise.resolve(null);
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        return ctx.resume().then(() => {
          warmup(ctx);
          warmedUp = true;
          resumePending = false;
          return ctx;
        }).catch((error) => {
          console.error('Failed to resume AudioContext:', error);
          return null;
        });
      }
      if (!warmedUp) {
        warmup(ctx);
        warmedUp = true;
      }
      resumePending = false;
      return Promise.resolve(ctx);
    }

    function withContext(callback) {
      return ensureContext().then((ctx) => {
        if (!ctx || isMuted) return null;
        return callback(ctx);
      });
    }

    function playOrin(ctx, kind) {
      if (!ctx || isMuted) return;

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.connect(ctx.destination);

      let baseHz;
      if (kind === 'inhale' || kind === 'start') baseHz = 1100;
      else if (kind === 'hold') baseHz = 950;
      else if (kind === 'exhale') baseHz = 820;
      else baseHz = 950;

      const tail = 3.2;
      const peak = 0.45;

      const burstDur = 0.012;
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * burstDur), ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ch.length * 0.65));
      noise.buffer = buf;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 300;
      const strike = ctx.createGain();
      strike.gain.setValueAtTime(peak * 0.7 * 1.5, now);
      strike.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      noise.connect(hp).connect(strike).connect(master);

      const modalBus = ctx.createGain();
      modalBus.gain.value = 1.0;
      const outEQ = ctx.createBiquadFilter();
      outEQ.type = 'highshelf';
      outEQ.frequency.value = 3500;
      outEQ.gain.value = 3;
      modalBus.connect(outEQ).connect(master);

      const modes = [
        { r: 0.99, q: 25, g: 1.00, d: tail },
        { r: 2.01, q: 28, g: 0.55, d: tail * 0.9 },
        { r: 2.32, q: 26, g: 0.42, d: tail * 0.85 },
        { r: 2.74, q: 24, g: 0.36, d: tail * 0.8 },
        { r: 3.76, q: 22, g: 0.28, d: tail * 0.7 },
        { r: 4.07, q: 20, g: 0.22, d: tail * 0.6 },
        { r: 6.80, q: 18, g: 0.15, d: tail * 0.5 }
      ];

      const excite = ctx.createBufferSource();
      excite.buffer = buf;
      modes.forEach((m) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = baseHz * m.r;
        bp.Q.value = m.q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak * m.g * 1.5, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + m.d);
        excite.connect(bp).connect(g).connect(modalBus);
      });

      const partials = [
        { r: 1.0, g: 0.35, d: tail * 1.0 },
        { r: 2.01, g: 0.22, d: tail * 0.9 },
        { r: 2.74, g: 0.15, d: tail * 0.8 },
        { r: 3.76, g: 0.10, d: tail * 0.7 }
      ];
      partials.forEach((p) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const cents = (Math.random() * 6 - 3);
        const detune = Math.pow(2, cents / 1200);
        const startF = baseHz * p.r * detune;
        const endF = startF * 0.985;
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.exponentialRampToValueAtTime(endF, now + p.d);
        const g = ctx.createGain();
        g.gain.setValueAtTime(p.g * peak * 1.5, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
        osc.connect(g).connect(master);
        osc.start(now + 0.002);
        osc.stop(now + p.d + 0.05);
      });

      try {
        const early = ctx.createDelay(0.2);
        early.delayTime.value = 0.028;
        const eGain = ctx.createGain();
        eGain.gain.value = 0.25;
        master.connect(early).connect(eGain).connect(ctx.destination);
      } catch (_) {}

      master.gain.exponentialRampToValueAtTime(peak * 1.5, now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + tail + 0.35);

      noise.start(now);
      noise.stop(now + burstDur);
      excite.start(now);
      excite.stop(now + 0.05);
    }

    function playClap(ctx) {
      if (!ctx || isMuted) return;

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.connect(ctx.destination);

      const dur = 0.12;
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ch.length * 0.6));
      src.buffer = buf;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 800;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;

      const body = ctx.createGain();
      body.gain.setValueAtTime(0.9 * 1.5, now);
      body.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      src.connect(hp).connect(lp).connect(body).connect(master);
      master.gain.exponentialRampToValueAtTime(0.63 * 1.5, now + 0.005);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      try {
        const delay = ctx.createDelay(0.3);
        delay.delayTime.value = 0.06;
        const g = ctx.createGain();
        g.gain.value = 0.4 * 1.5;
        body.connect(delay).connect(g).connect(master);
      } catch (_) {}

      src.start(now);
      src.stop(now + dur);
    }

    function playGuide(kind) {
      withContext((ctx) => {
        if (kind === 'end') {
          playClap(ctx);
        } else {
          playOrin(ctx, kind);
        }
        return null;
      });
    }

    function toggleMuted() {
      isMuted = !isMuted;
      return isMuted;
    }

    function setMuted(value) {
      isMuted = Boolean(value);
      return isMuted;
    }

    function muted() {
      return isMuted;
    }

    function refreshOutput() {
      const ctx = audioCtx;
      if (!ctx) return ensureContext();
      audioCtx = null;
      warmedUp = false;
      resumePending = false;
      if (typeof ctx.close === 'function') {
        return ctx.close().catch((error) => {
          console.error('Failed to close AudioContext:', error);
        }).finally(() => ensureContext());
      }
      return ensureContext();
    }

    function resumeIfNeeded() {
      if (resumePending) {
        return ensureContext();
      }
      if (audioCtx && audioCtx.state === 'suspended' && !document.hidden) {
        return ensureContext();
      }
      return Promise.resolve(audioCtx || null);
    }

    return {
      ensureContext,
      playGuide,
      toggleMuted,
      setMuted,
      isMuted: muted,
      refreshOutput,
      resumeIfNeeded,
    };
  }

  function scheduleAudioRefresh() {
    if (isRunning) {
      pendingAudioRefresh = true;
      return;
    }
    audioEngine.refreshOutput().catch(() => {});
    pendingAudioRefresh = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      audioEngine.resumeIfNeeded().catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    audioEngine.resumeIfNeeded().catch(() => {});
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      scheduleAudioRefresh();
    } else {
      audioEngine.resumeIfNeeded().catch(() => {});
    }
  });

  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      scheduleAudioRefresh();
    });
  }
})();
