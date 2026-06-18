import { useEffect, useRef } from 'preact/hooks';

export function useAudioLifecycle(audioEngine, audioUnlock, isRunningRef) {
  const pendingAudioRefresh = useRef(false);
  const refreshInFlight = useRef(null);

  useEffect(() => {
    function flushAudioRefresh(options = {}) {
      const { force = false } = options;
      if (!force) {
        if (!pendingAudioRefresh.current) return false;
        if (isRunningRef.current) return false;
        if (document.visibilityState && document.visibilityState === 'hidden') {
          return false;
        }
      } else if (!pendingAudioRefresh.current && !refreshInFlight.current) {
        return false;
      }
      if (refreshInFlight.current) {
        pendingAudioRefresh.current = false;
        return false;
      }
      pendingAudioRefresh.current = false;
      const refreshPromise = audioEngine.refreshOutput().catch(() => null);
      refreshInFlight.current = refreshPromise.finally(() => {
        audioUnlock.markLocked();
        refreshInFlight.current = null;
        if (pendingAudioRefresh.current) {
          flushAudioRefresh();
        }
      });
      return true;
    }

    function scheduleAudioRefresh() {
      pendingAudioRefresh.current = true;
      flushAudioRefresh();
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        audioUnlock.markLocked();
        scheduleAudioRefresh();
        return;
      }
      audioEngine.resumeIfNeeded().catch(() => {});
      flushAudioRefresh();
    };

    const onFocus = () => {
      audioEngine.resumeIfNeeded().catch(() => {});
      flushAudioRefresh();
    };

    const onPageShow = (event) => {
      if (event.persisted) {
        scheduleAudioRefresh();
      } else {
        audioEngine.resumeIfNeeded().catch(() => {});
      }
      flushAudioRefresh();
    };

    const onPageHide = () => {
      audioUnlock.markLocked();
      scheduleAudioRefresh();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);

    let deviceChangeHandler;
    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      deviceChangeHandler = () => scheduleAudioRefresh();
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      if (deviceChangeHandler) {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
      }
    };
  }, [audioEngine, audioUnlock, isRunningRef]);
}
