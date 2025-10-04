(() => {
  const startButton = document.getElementById('startButton');
  const phaseLabel = document.getElementById('phaseLabel');
  const countdownLabel = document.getElementById('countdownLabel');
  const progressRing = document.getElementById('progressRing');
  const timerCard = document.querySelector('.timer-card');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  const ONE_SECOND_MS = 1000;
  const sets = 3;
  const basePattern = [
    { label: '吸う', duration: 4, key: 'inhale' },
    { label: '止める', duration: 8, key: 'hold' },
    { label: '吐く', duration: 8, key: 'exhale' },
  ];
  const pattern = Array.from({ length: sets }).flatMap(() => basePattern);
  const totalSeconds = pattern.reduce((s, p) => s + p.duration, 0);

  let isRunning = false;
  let currentIndex = 0;
  let phaseEndTs = 0;
  let timerRaf = 0;
  let totalStartTs = 0;
  let audioCtx = null;

  // --- iOS/PWA/Bluetooth 対策用フラグ/検出 ---
  const ua = navigator.userAgent || '';
  const isIOS = /iP(hone|od|ad)/.test(ua);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator && window.navigator.standalone);
  let audioUnlocked = false;
  let htmlSilentAudio = null;

  function updateProgress(totalElapsedSec) {
    const progressDeg = Math.min(360, (totalElapsedSec / totalSeconds) * 360);
    progressRing.style.background = `conic-gradient(var(--accent) ${progressDeg}deg, rgba(255,255,255,0.08) ${progressDeg}deg)`;
  }

  // ====== WebAudio 合成音（おりん風/手拍子）======
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        // iOSではBluetooth出力と相性の良い 48kHz を優先して試す
        if (isIOS) {
          try {
            audioCtx = new Ctx({ sampleRate: 48000, latencyHint: 'interactive' });
          } catch (_) {
            audioCtx = new Ctx();
          }
        } else {
          audioCtx = new Ctx();
        }
      }
    }
    return audioCtx;
  }

  // --- 無音バッファ（WebAudio）を短く鳴らしてルートを開く ---
  function playSilentTick(ctx, durSec = 0.06) {
    try {
      const frames = Math.max(1, Math.floor(ctx.sampleRate * durSec));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      // ほぼ無音（-60dB程度）
      g.gain.value = 0.001;
      src.connect(g).connect(ctx.destination);
      const t0 = ctx.currentTime;
      src.start(t0);
      src.stop(t0 + durSec);
    } catch (_) {}
  }

  // --- HTMLAudioの無音データを一瞬だけ再生（iOS PWA + Bluetoothで有効） ---
  function ensureHtmlSilentAudio() {
    if (htmlSilentAudio) return htmlSilentAudio;
    // 0.1秒の無音WAV（8kHz, mono, PCM16）データURI
    // 極小サイズかつ再生互換性が高い
    const SILENT_WAV_100MS =
      'data:audio/wav;base64,' +
      'UklGRgQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAAA'; // 短い無音
    const a = new Audio(SILENT_WAV_100MS);
    a.muted = true;
    a.loop = false;
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    htmlSilentAudio = a;
    return a;
  }

  async function unlockAudioRoute() {
    const ctx = getAudioCtx();
    if (!ctx) return;

    try { await ctx.resume(); } catch (_) {}

    // WebAudio無音チック
    playSilentTick(ctx);

    // HTMLAudioの無音もチョイ鳴らし（PWA + Bluetoothで効く）
    try {
      const el = ensureHtmlSilentAudio();
      await el.play();
      el.pause();
      el.currentTime = 0;
    } catch (_) {}

    audioUnlocked = true;
  }

  // ====== 音の合成 ======
  function playOrin(kind) {
    const ctx = getAudioCtx();
    if (!ctx) return;

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
    if (!ctx) return;

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
    if (kind === 'end') return playClap();
    return playOrin(kind);
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
      phaseLabel.textContent = `${nextPhase.label}`;
      phaseEndTs = now + nextPhase.duration * ONE_SECOND_MS;
      playGuide(nextPhase.key);
    }

    timerRaf = requestAnimationFrame(loop);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    startButton.textContent = '停止';
    startButton.setAttribute('aria-label', 'タイマー停止');
    currentIndex = 0;
    totalStartTs = performance.now();
    const first = pattern[currentIndex];
    phaseLabel.textContent = `${first.label}`;
    phaseEndTs = totalStartTs + first.duration * ONE_SECOND_MS;
    countdownLabel.textContent = String(first.duration);
    updateProgress(0);
    timerRaf = requestAnimationFrame(loop);
    tryVibrate(30);
    playGuide('inhale'); // 最初のフェーズ
  }

  function reset() {
    isRunning = false;
    cancelAnimationFrame(timerRaf);
    startButton.textContent = 'はじめる';
    startButton.setAttribute('aria-label', 'タイマー開始');
    phaseLabel.textContent = 'タップで開始';
    countdownLabel.textContent = String(totalSeconds);
    progressRing.style.background = 'conic-gradient(var(--accent) 0deg, rgba(255,255,255,0.08) 0deg)';
  }

  function finish() {
    tryVibrate([40, 60, 40]);
    playGuide('end');
    setTimeout(() => {
      alert('おつかれさま!1分の瞑想が終わったよ。');
      reset();
    }, 500);
  }

  function tryVibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  async function onUserGesturePriming() {
    // PWA + iOS では必ず解錠を先に
    if (!audioUnlocked) {
      await unlockAudioRoute();
    }
  }

  async function onButtonClick() {
    await onUserGesturePriming();

    const ctx = getAudioCtx();
    if (ctx && ctx.state !== 'running') {
      try { await ctx.resume(); } catch (_) {}
      playSilentTick(ctx);
    }

    if (isRunning) {
      reset();
    } else {
      start();
    }
  }

  // --- ユーザー操作系 ---
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
  // iOSは pointerdown/touchend 直後の処理がもっとも「解錠」しやすい
  window.addEventListener('pointerdown', onUserGesturePriming, { passive: true, once: true });

  // 復帰時の再解錠（PWAでの再開/BT切替後など）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx) {
      unlockAudioRoute();
    }
  });
  window.addEventListener('pageshow', () => {
    if (audioCtx) {
      unlockAudioRoute();
    }
  });

  // クリップボードコピー
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

  // PWA: Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();