(() => {
  const startButton = document.getElementById('startButton');
  const phaseLabel = document.getElementById('phaseLabel');
  const countdownLabel = document.getElementById('countdownLabel');
  const progressRing = document.getElementById('progressRing');

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

  function updateProgress(totalElapsedSec) {
    const progressDeg = Math.min(360, (totalElapsedSec / totalSeconds) * 360);
    progressRing.style.background = `conic-gradient(var(--accent) ${progressDeg}deg, rgba(255,255,255,0.08) ${progressDeg}deg)`;
  }

  // ====== WebAudio 合成音（おりん風/手拍子）======
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function playOrin(kind) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.connect(ctx.destination);

    // フェーズ別に音程を切り替え（吸う=高め、止める=中間、吐く=低め）
    let baseHz;
    if (kind === 'inhale' || kind === 'start') baseHz = 1100; // 高め
    else if (kind === 'hold') baseHz = 950;                    // 中間
    else if (kind === 'exhale') baseHz = 820;                  // 低め
    else baseHz = 950;                                        // デフォルト

    // 余韻・音量は一定（開始も切替も同質感で）
    const tail = 3.2;  // 秒
    const peak = 0.30; // 音量感

    // 打撃ノイズ（励起）
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
    strike.gain.setValueAtTime(peak * 0.7, now);
    strike.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    noise.connect(hp).connect(strike).connect(master);

    // モーダル共振（不整比の帯域通過）
    const modalBus = ctx.createGain();
    modalBus.gain.value = 1.0;
    const outEQ = ctx.createBiquadFilter();
    outEQ.type = 'highshelf';
    outEQ.frequency.value = 3500;
    outEQ.gain.value = 3; // きらめき付与
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
      g.gain.setValueAtTime(peak * m.g, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + m.d);
      excite.connect(bp).connect(g).connect(modalBus);
    });

    // 加算合成の倍音群（微妙にデチューン＆減衰）
    const partials = [
      { r: 1.0, g: 0.35, d: tail * 1.0 },
      { r: 2.01, g: 0.22, d: tail * 0.9 },
      { r: 2.74, g: 0.15, d: tail * 0.8 },
      { r: 3.76, g: 0.10, d: tail * 0.7 }
    ];
    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const cents = (Math.random() * 6 - 3); // ±3cents
      const detune = Math.pow(2, cents / 1200);
      const startF = baseHz * p.r * detune;
      const endF = startF * 0.985; // わずかなピッチダウン
      osc.frequency.setValueAtTime(startF, now);
      osc.frequency.exponentialRampToValueAtTime(endF, now + p.d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(p.g * peak, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
      osc.connect(g).connect(master);
      osc.start(now + 0.002);
      osc.stop(now + p.d + 0.05);
    });

    // 初期反射（短ディレイ）で部屋鳴り風
    try {
      const early = ctx.createDelay(0.2);
      early.delayTime.value = 0.028;
      const eGain = ctx.createGain();
      eGain.gain.value = 0.25;
      master.connect(early).connect(eGain).connect(ctx.destination);
    } catch (_) {}

    // マスターのフェード
    master.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, now + tail + 0.35);

    // 再生
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

    // 手拍子っぽい短いノイズ＋帯域整形
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
    body.gain.setValueAtTime(0.9, now);
    body.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    src.connect(hp).connect(lp).connect(body).connect(master);
    master.gain.exponentialRampToValueAtTime(0.63, now + 0.005); // 70%
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    // ダブルクラップ風に軽いエコー
    try {
      const delay = ctx.createDelay(0.3);
      delay.delayTime.value = 0.06;
      const g = ctx.createGain();
      g.gain.value = 0.4;
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
    try {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') { ctx.resume(); }
    } catch (_) {}
    // 最初のフェーズは吸うなので高めの音程
    playGuide('inhale');
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
    alert('おつかれさま！1分の瞑想が終わったよ。');
    reset();
  }

  function tryVibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  function onButtonClick() {
    if (isRunning) {
      reset();
    } else {
      start();
    }
  }

  startButton.addEventListener('click', onButtonClick, { passive: true });

  // PWA: Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();


