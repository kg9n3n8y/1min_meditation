export function setupAudioUnlockController(engine) {
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

export async function withAudioUnlock(audioEngine, audioUnlock, action) {
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
