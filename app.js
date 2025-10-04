/* app.js (iOS PWA 2回目起動で無反応になる問題の修正版)
   主要変更点
   - bfcache 復帰 (pageshow.persisted) と PWA 再起動を検知して状態を再初期化
   - AudioContext が復帰時に resume できない/closed になるSafari対策として再生成
   - 「一度限り(once:true)」のunlock用 pointerdown リスナーを復帰時に再付与
   - iOS PWA では alert を出さず非同期処理をブロックしない
*/

(() => {
  // ---- ユーティリティ & 環境判定 ----
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|od|ad)/.test(ua);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator && navigator.standalone);

  const ONE_SECOND_MS = 1000;
  const AUDIO_RESUME_TIMEOUT_MS = 450;
  const PRIMING_WAIT_LIMIT_MS = 500;

  // ---- 状態変数（bfcache復帰でも生き残る可能性があるので pageshow で都度リセットする）----
  let dom = {
    startButton: null,
    phaseLabel: null,
    countdownLabel: null,
    progressRing: null,
    timerCard: null,
    copyUrlBtn: null,
  };

  let isRunning = false;
  let currentIndex = 0;
  let phaseEndTs = 0;
  let timerRaf = 0;
  let totalStartTs = 0;

  let audioCtx = null;
  let audioUnlocked = false;
  let htmlSilentAudio = null;

  // タイマー・シーケンス
  const sets = 3;
  const basePattern = [
    { label: "吸う", duration: 4, key: "inhale" },
    { label: "止める", duration: 8, key: "hold" },
    { label: "吐く", duration: 8, key: "exhale" },
  ];
  const pattern = Array.from({ length: sets }).flatMap(() => basePattern);
  const totalSeconds = pattern.reduce((s, p) => s + p.duration, 0);

  // ---- AudioContext 管理 ----
  function createAudioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (isIOS) {
      try {
        return new Ctx({ sampleRate: 48000, latencyHint: "interactive" });
      } catch (_) {
        try {
          return new Ctx();
        } catch {
          return null;
        }
      }
    }
    try {
      return new Ctx();
    } catch {
      return null;
    }
  }

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = createAudioCtx();
      bindStateChangeForAudioCtx(audioCtx);
    }
    return audioCtx;
  }

  function bindStateChangeForAudioCtx(ctx) {
    if (!ctx) return;
    // Safariで復帰時にsuspended/実質deadになるのを検知
    ctx.onstatechange = async () => {
      if (!ctx) return;
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch (_) {
          // 再開に失敗したら作り直しフラグ
          tryCloseAudioCtx();
          audioCtx = null;
          audioUnlocked = false;
        }
      } else if (ctx.state === "closed") {
        audioCtx = null;
        audioUnlocked = false;
      }
    };
  }

  function tryCloseAudioCtx() {
    if (audioCtx) {
      try {
        // iOSで close() が例外になるケースがあるため try/catch
        audioCtx.close && audioCtx.close();
      } catch (_) {}
    }
  }

  // ---- オーディオ解錠（unlock） ----
  function ensureHtmlSilentAudio() {
    if (htmlSilentAudio) return htmlSilentAudio;
    // 0.1秒の超短無音WAV
    const SILENT_WAV_100MS =
      "data:audio/wav;base64," +
      "UklGRgQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAAA";
    const a = new Audio(SILENT_WAV_100MS);
    a.muted = true;
    a.loop = false;
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    htmlSilentAudio = a;
    return a;
  }

  function playSilentTick(ctx, durSec = 0.06) {
    try {
      const frames = Math.max(1, Math.floor(ctx.sampleRate * durSec));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = 0.001;
      src.connect(g).connect(ctx.destination);
      const t0 = ctx.currentTime;
      src.start(t0);
      src.stop(t0 + durSec);
    } catch (_) {}
  }

  function waitWithTimeout(promise, timeoutMs) {
    if (!promise || typeof promise.then !== "function") {
      return Promise.resolve(true);
    }
    let finished = false;
    return new Promise((resolve) => {
      const finish = (result) => {
        if (finished) return;
        finished = true;
        resolve(result);
      };
      promise.then(
        () => finish(true),
        () => finish(false)
      );
      setTimeout(() => finish(false), timeoutMs);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function attemptResume(ctx, timeoutMs = AUDIO_RESUME_TIMEOUT_MS) {
    if (!ctx || typeof ctx.resume !== "function") return false;
    try {
      return await waitWithTimeout(ctx.resume(), timeoutMs);
    } catch (_) {
      return false;
    }
  }

  async function ensureCtxRunning(ctx, timeoutMs = AUDIO_RESUME_TIMEOUT_MS) {
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    const resumed = await attemptResume(ctx, timeoutMs);
    return resumed || ctx.state === "running";
  }

  function rebuildAudioCtx() {
    tryCloseAudioCtx();
    audioCtx = createAudioCtx();
    bindStateChangeForAudioCtx(audioCtx);
    audioUnlocked = false;
    return audioCtx;
  }

  async function unlockAudioRoute(
    ctx = getAudioCtx(),
    { timeoutMs = AUDIO_RESUME_TIMEOUT_MS, skipResume = false } = {}
  ) {
    const targetCtx = ctx || getAudioCtx();
    if (!targetCtx) {
      audioUnlocked = false;
      return false;
    }

    const running =
      skipResume && targetCtx.state === "running"
        ? true
        : await ensureCtxRunning(targetCtx, timeoutMs);

    if (!running) {
      audioUnlocked = false;
      return false;
    }

    playSilentTick(targetCtx);

    try {
      const el = ensureHtmlSilentAudio();
      const playResult = typeof el.play === "function" ? el.play() : null;
      await waitWithTimeout(playResult, timeoutMs);
      el.pause();
      el.currentTime = 0;
    } catch (_) {}

    audioUnlocked = true;
    return true;
  }

  // ---- サウンド合成 ----
  function playOrin(kind) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.connect(ctx.destination);

    let baseHz;
    if (kind === "inhale" || kind === "start") baseHz = 1100;
    else if (kind === "hold") baseHz = 950;
    else if (kind === "exhale") baseHz = 820;
    else baseHz = 950;

    const tail = 3.2;
    const peak = 0.45;

    // strike noise
    const burstDur = 0.012;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * burstDur),
      ctx.sampleRate
    );
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++)
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ch.length * 0.65));
    noise.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    const strike = ctx.createGain();
    strike.gain.setValueAtTime(peak * 0.7 * 1.5, now);
    strike.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    noise.connect(hp).connect(strike).connect(master);

    const modalBus = ctx.createGain();
    modalBus.gain.value = 1.0;
    const outEQ = ctx.createBiquadFilter();
    outEQ.type = "highshelf";
    outEQ.frequency.value = 3500;
    outEQ.gain.value = 3;
    modalBus.connect(outEQ).connect(master);

    const modes = [
      { r: 0.99, q: 25, g: 1.0, d: tail },
      { r: 2.01, q: 28, g: 0.55, d: tail * 0.9 },
      { r: 2.32, q: 26, g: 0.42, d: tail * 0.85 },
      { r: 2.74, q: 24, g: 0.36, d: tail * 0.8 },
      { r: 3.76, q: 22, g: 0.28, d: tail * 0.7 },
      { r: 4.07, q: 20, g: 0.22, d: tail * 0.6 },
      { r: 6.80, q: 18, g: 0.15, d: tail * 0.5 },
    ];

    const excite = ctx.createBufferSource();
    excite.buffer = buf;
    modes.forEach((m) => {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
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
      { r: 3.76, g: 0.1, d: tail * 0.7 },
    ];
    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const cents = Math.random() * 6 - 3;
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
    for (let i = 0; i < ch.length; i++)
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ch.length * 0.6));
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 800;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
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
    if (kind === "end") return playClap();
    return playOrin(kind);
  }

  // ---- UI & タイマー ----
  function updateProgress(totalElapsedSec) {
    const progressDeg = Math.min(360, (totalElapsedSec / totalSeconds) * 360);
    dom.progressRing.style.background = `conic-gradient(var(--accent) ${progressDeg}deg, rgba(255,255,255,0.08) ${progressDeg}deg)`;
  }

  function formatSec(sec) {
    return Math.max(0, Math.ceil(sec)).toString();
  }

  function loop() {
    const now = performance.now();
    const totalElapsedSec = (now - totalStartTs) / ONE_SECOND_MS;
    updateProgress(totalElapsedSec);

    const remainingCurrent = (phaseEndTs - now) / ONE_SECOND_MS;
    dom.countdownLabel.textContent = formatSec(remainingCurrent);

    if (remainingCurrent <= 0) {
      currentIndex += 1;
      if (currentIndex >= pattern.length) {
        finish();
        return;
      }
      const nextPhase = pattern[currentIndex];
      dom.phaseLabel.textContent = `${nextPhase.label}`;
      phaseEndTs = now + nextPhase.duration * ONE_SECOND_MS;
      playGuide(nextPhase.key);
    }

    timerRaf = requestAnimationFrame(loop);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    dom.startButton.textContent = "停止";
    dom.startButton.setAttribute("aria-label", "タイマー停止");
    currentIndex = 0;
    totalStartTs = performance.now();
    const first = pattern[currentIndex];
    dom.phaseLabel.textContent = `${first.label}`;
    phaseEndTs = totalStartTs + first.duration * ONE_SECOND_MS;
    dom.countdownLabel.textContent = String(first.duration);
    updateProgress(0);
    timerRaf = requestAnimationFrame(loop);
    tryVibrate(30);
    playGuide("inhale");
  }

  function reset() {
    isRunning = false;
    cancelAnimationFrame(timerRaf);
    dom.startButton.textContent = "はじめる";
    dom.startButton.setAttribute("aria-label", "タイマー開始");
    dom.phaseLabel.textContent = "タップで開始";
    dom.countdownLabel.textContent = String(totalSeconds);
    dom.progressRing.style.background =
      "conic-gradient(var(--accent) 0deg, rgba(255,255,255,0.08) 0deg)";
  }

  function finish() {
    tryVibrate([40, 60, 40]);
    playGuide("end");
    // iOS PWAでは alert が復帰時の挙動を壊すことがあるため回避
    if (!(isIOS && isStandalone)) {
      setTimeout(() => {
        alert("おつかれさま! 1分の瞑想が終わったよ。");
      }, 500);
    }
    setTimeout(reset, 500);
  }

  function tryVibrate(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }

  // ---- ユーザー操作/解錠フロー ----
  async function onUserGesturePriming() {
    // AudioContextが死んでいる/閉じている可能性を考慮して再作成
    if (!audioCtx || audioCtx.state === "closed") {
      rebuildAudioCtx();
    }

    let ctx = audioCtx;
    if (!ctx) return;

    let running = await ensureCtxRunning(ctx);
    if (!running) {
      ctx = rebuildAudioCtx();
      if (!ctx) return;
      running = await ensureCtxRunning(ctx);
      if (!running) return;
    }

    if (!audioUnlocked) {
      await unlockAudioRoute(ctx, { skipResume: true });
    } else {
      await ensureCtxRunning(ctx);
    }
  }

  async function onButtonClick(e) {
    // 念のため
    e && e.stopPropagation();
    const primingPromise = onUserGesturePriming();
    primingPromise.catch(() => {});
    await Promise.race([primingPromise, delay(PRIMING_WAIT_LIMIT_MS)]);

    let ctx = getAudioCtx();
    if (ctx && ctx.state !== "running") {
      const running = await ensureCtxRunning(ctx);
      if (!running) {
        ctx = rebuildAudioCtx();
        if (ctx) {
          await unlockAudioRoute(ctx);
        }
      }
    }

    ctx = getAudioCtx();
    if (ctx && ctx.state === "running") {
      playSilentTick(ctx);
    }

    if (isRunning) {
      reset();
    } else {
      start();
    }
  }

  // ---- 復帰/離脱ハンドリング（bfcache & PWA） ----
  function attachOneShotPointerUnlock() {
    // 復帰のたびに once リスナーを再付与
    window.addEventListener("pointerdown", onUserGesturePriming, {
      passive: true,
      once: true,
    });
  }

  function onPageShow(e) {
    // bfcache からの復帰 or PWA再起動
    // いずれでもオーディオ経路・UIを健全化
    if (e && e.persisted) {
      // bfcache復帰時：古い状態が残るので明示的に初期化
      hardReinitState();
    } else if (isIOS && isStandalone) {
      // PWAはOS側復元でもJS状態が不整合になりやすいので毎回クリーンに
      softReinitState();
    }
    // 解錠用 once リスナーを毎回付け直し
    attachOneShotPointerUnlock();
  }

  function onPageHide() {
    // 次回復帰時のためにクリーンアップ（bfcache行きでも問題なし）
    cancelAnimationFrame(timerRaf);
    isRunning = false;
    // 既存AudioContextは次回のために破棄（Safariでの「再開不能」個体差対策）
    tryCloseAudioCtx();
    audioCtx = null;
    audioUnlocked = false;
  }

  function onVisibilityChange() {
    if (!document.hidden) {
      // 画面復帰時に再解錠トライ
      unlockAudioRoute();
    }
  }

  // ---- 初期化 & 再初期化 ----
  function queryDom() {
    dom.startButton = document.getElementById("startButton");
    dom.phaseLabel = document.getElementById("phaseLabel");
    dom.countdownLabel = document.getElementById("countdownLabel");
    dom.progressRing = document.getElementById("progressRing");
    dom.timerCard = document.querySelector(".timer-card");
    dom.copyUrlBtn = document.getElementById("copyUrlBtn");
  }

  function bindUI() {
    // 既存のハンドラ多重付与を防ぐため一度解除してから付与
    if (dom.startButton) {
      dom.startButton.removeEventListener("click", onButtonClick);
      dom.startButton.addEventListener("click", onButtonClick, { passive: true });
    }
    if (dom.timerCard) {
      dom.timerCard.removeEventListener("click", onButtonClick);
      dom.timerCard.addEventListener("click", onButtonClick, { passive: true });

      dom.timerCard.tabIndex = 0;
      dom.timerCard.setAttribute("role", "button");
      dom.timerCard.setAttribute("aria-label", "タイマーの開始と停止");

      // keydown は多重付与防止のため一度解除
      const keyHandler = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onButtonClick(e);
        }
      };
      dom.timerCard.removeEventListener("keydown", keyHandler);
      dom.timerCard.addEventListener("keydown", keyHandler);
    }

    if (dom.copyUrlBtn) {
      const copyHandler = async () => {
        const url = "https://kg9n3n8y.github.io/1min_meditation/";
        try {
          await navigator.clipboard.writeText(url);
          dom.copyUrlBtn.textContent = "コピーしたよ!";
          setTimeout(() => {
            dom.copyUrlBtn.textContent = "URLをコピー";
          }, 1500);
        } catch (_) {
          const ta = document.createElement("textarea");
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
          } catch (_) {}
          document.body.removeChild(ta);
          dom.copyUrlBtn.textContent = "コピーしたよ!";
          setTimeout(() => {
            dom.copyUrlBtn.textContent = "URLをコピー";
          }, 1500);
        }
      };
      dom.copyUrlBtn.removeEventListener("click", copyHandler);
      dom.copyUrlBtn.addEventListener("click", copyHandler, { passive: true });
    }
  }

  function initVisual() {
    // 初期表示を常に整える
    reset();
  }

  function softReinitState() {
    // DOMはそのままに、Audio/ランタイム状態のみ整える
    cancelAnimationFrame(timerRaf);
    isRunning = false;
    audioUnlocked = false;
    tryCloseAudioCtx();
    audioCtx = null;
    initVisual();
  }

  function hardReinitState() {
    // DOM参照も取り直し、イベント再バインド
    queryDom();
    bindUI();
    softReinitState();
  }

  function bootstrap() {
    queryDom();
    bindUI();
    initVisual();

    // PWA: Service Worker Registration
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }

    // ライフサイクル
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 起動直後の解錠 once を付与
    attachOneShotPointerUnlock();
  }

  // DOM 準備後に起動
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
