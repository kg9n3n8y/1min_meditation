(() => {
  const startButton = document.getElementById('startButton');
  const phaseLabel = document.getElementById('phaseLabel');
  const countdownLabel = document.getElementById('countdownLabel');
  const progressRing = document.getElementById('progressRing');
  const timerCard = document.querySelector('.timer-card');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const sessionButtons = Array.from(document.querySelectorAll('.session-option'));
  const muteToggle = document.getElementById('muteToggle');
  const soundTestBtn = document.getElementById('soundTestBtn');
  const phaseLiveRegion = document.getElementById('phaseLiveRegion');

  const ONE_SECOND_MS = 1000;
  const BASE_PATTERN = [
    { label: '吸う', duration: 4, key: 'inhale' },
    { label: '止める', duration: 8, key: 'hold' },
    { label: '吐く', duration: 8, key: 'exhale' },
  ];
  const SESSION_PRESETS = [
    { id: 'short', label: '20秒', sets: 1 },
    { id: 'standard', label: '1分', sets: 3 },
    { id: 'long', label: '2分', sets: 6 },
  ];

  const audioEngine = createGuideAudio();

  let session = SESSION_PRESETS[1];
  let pattern = buildPattern(session.sets);
  let totalSeconds = getTotalSeconds(pattern);

  let isRunning = false;
  let currentIndex = 0;
  let phaseEndTs = 0;
  let timerRaf = 0;
  let totalStartTs = 0;

  function buildPattern(sets) {
    return Array.from({ length: sets }, () => BASE_PATTERN).flat();
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

  function setSession(sessionId) {
    const next = SESSION_PRESETS.find((preset) => preset.id === sessionId);
    if (!next || next.id === session.id) return;

    const wasRunning = isRunning;
    if (wasRunning) reset();

    session = next;
    pattern = buildPattern(session.sets);
    totalSeconds = getTotalSeconds(pattern);

    countdownLabel.textContent = String(totalSeconds);
    updateProgress(0);
    updatePhaseLabel('タップで開始', false);
    startButton.textContent = 'はじめる';
    startButton.setAttribute('aria-label', 'タイマー開始');

    if (phaseLiveRegion) {
      phaseLiveRegion.textContent = `${session.label}セッションを選択しました`;
    }

    updateSessionButtons();
  }

  function updateSessionButtons() {
    sessionButtons.forEach((btn) => {
      const isActive = btn.dataset.sessionId === session.id;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    });
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
  }

  function finish() {
    tryVibrate([40, 60, 40]);
    audioEngine.playGuide('end');
    isRunning = false;
    cancelAnimationFrame(timerRaf);
    timerRaf = 0;
    updatePhaseLabel('おつかれさま');
    setTimeout(() => {
      alert(`おつかれさま!${session.label}の瞑想が終わったよ。`);
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

  function updateMuteButton() {
    const muted = audioEngine.isMuted();
    if (!muteToggle) return;
    muteToggle.setAttribute('aria-pressed', String(muted));
    muteToggle.textContent = muted ? 'サウンド OFF' : 'サウンド ON';
    muteToggle.setAttribute('aria-label', muted ? '音声ガイドのミュートを解除' : '音声ガイドをミュート');
  }

  function handleMuteToggle() {
    const muted = audioEngine.toggleMuted();
    updateMuteButton();
    if (phaseLiveRegion) {
      phaseLiveRegion.textContent = muted ? 'ガイド音をミュートしました' : 'ガイド音をオンにしました';
    }
  }

  function handleSoundTest() {
    audioEngine.ensureContext().then((ctx) => {
      if (!ctx) {
        if (phaseLiveRegion) {
          phaseLiveRegion.textContent = '音声ガイドを利用できません';
        }
        return;
      }
      if (audioEngine.isMuted()) {
        if (phaseLiveRegion) {
          phaseLiveRegion.textContent = 'ミュート中のため音は再生されません';
        }
        return;
      }
      audioEngine.playTestCue();
      if (phaseLiveRegion) {
        phaseLiveRegion.textContent = 'ガイド音を再生しました';
      }
    }).catch(() => {});
  }

  function handleSessionKeydown(event) {
    const { key } = event;
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' ', 'Enter'].includes(key)) return;
    event.preventDefault();
    const currentBtn = event.currentTarget;
    const index = sessionButtons.indexOf(currentBtn);
    if (index === -1) return;

    if (key === ' ' || key === 'Enter') {
      setSession(currentBtn.dataset.sessionId);
      return;
    }

    const isNext = key === 'ArrowRight' || key === 'ArrowDown';
    const delta = isNext ? 1 : -1;
    const nextIndex = (index + delta + sessionButtons.length) % sessionButtons.length;
    const nextBtn = sessionButtons[nextIndex];
    nextBtn.focus();
    setSession(nextBtn.dataset.sessionId);
  }

  function handleSessionSelect(event) {
    const btn = event.currentTarget;
    setSession(btn.dataset.sessionId);
  }

  updateSessionButtons();
  updateMuteButton();
  countdownLabel.textContent = String(totalSeconds);

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

  sessionButtons.forEach((btn) => {
    btn.addEventListener('click', handleSessionSelect, { passive: true });
    btn.addEventListener('keydown', handleSessionKeydown);
  });

  if (muteToggle) {
    muteToggle.addEventListener('click', (event) => {
      event.preventDefault();
      handleMuteToggle();
    });
  }

  if (soundTestBtn) {
    soundTestBtn.addEventListener('click', (event) => {
      event.preventDefault();
      handleSoundTest();
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister().catch(() => {});
        });
      })
      .catch(() => {});
  }

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).catch(() => {});
      });
    }).catch(() => {});
  }

  function createGuideAudio() {
    let audioCtx = null;
    let isMuted = false;
    let warmedUp = false;

    function getAudioCtx() {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
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
      if (ctx.state === 'suspended') {
        return ctx.resume().then(() => {
          warmup(ctx);
          warmedUp = true;
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
      return Promise.resolve(ctx);
    }

    function playOrin(kind) {
      const ctx = getAudioCtx();
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

    function playClap() {
      const ctx = getAudioCtx();
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
      if (kind === 'end') {
        playClap();
        return;
      }
      playOrin(kind);
    }

    function playTestCue() {
      if (isMuted) return;
      playOrin('start');
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

    return {
      ensureContext,
      playGuide,
      playTestCue,
      toggleMuted,
      setMuted,
      isMuted: muted,
    };
  }
})();
