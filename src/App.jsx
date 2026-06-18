import { useEffect, useMemo } from 'preact/hooks';
import { createGuideAudio } from './lib/audio.js';
import { setupAudioUnlockController } from './lib/audioUnlock.js';
import { useAudioLifecycle } from './hooks/useAudioLifecycle.js';
import { useMeditationTimer } from './hooks/useMeditationTimer.js';
import { ConfigSliders } from './components/ConfigSliders.jsx';
import { Footer } from './components/Footer.jsx';
import { InstallBanner } from './components/InstallBanner.jsx';
import { TimerCard } from './components/TimerCard.jsx';

export function App() {
  const audioEngine = useMemo(() => createGuideAudio(), []);
  const audioUnlock = useMemo(() => setupAudioUnlockController(audioEngine), [audioEngine]);

  const {
    config,
    phaseLabel,
    countdownLabel,
    progressDeg,
    isActive,
    liveAnnouncement,
    toggleTimer,
    updateConfigField,
    resetConfig,
    announceConfig,
    isRunningRef,
  } = useMeditationTimer(audioEngine);

  useAudioLifecycle(audioEngine, audioUnlock, isRunningRef);

  useEffect(() => {
    audioEngine.ensureContext().then(() => {
      setTimeout(() => {
        audioEngine.poke().catch(() => {});
      }, 0);
    }).catch(() => {});
  }, [audioEngine]);

  const handleSliderInput = (field, value) => {
    updateConfigField(field, value, { persist: false, resetTimer: true });
  };

  const handleSliderCommit = (field) => {
    announceConfig();
    updateConfigField(field, config[field], { persist: true, resetTimer: false });
  };

  return (
    <>
      <InstallBanner />

      <main class="app-main">
        <TimerCard
          phaseLabel={phaseLabel}
          countdownLabel={countdownLabel}
          progressDeg={progressDeg}
          isActive={isActive}
          onToggle={toggleTimer}
          audioEngine={audioEngine}
          audioUnlock={audioUnlock}
        />

        <ConfigSliders
          config={config}
          disabled={isActive}
          onInput={handleSliderInput}
          onCommit={handleSliderCommit}
        />

        <div class="control-actions">
          <button
            type="button"
            class="copy-btn"
            aria-label="設定を初期値に戻す"
            disabled={isActive}
            onClick={() => {
              resetConfig();
              announceConfig();
            }}
          >
            設定をリセット
          </button>
        </div>

        <div class="sr-only" aria-live="assertive">{liveAnnouncement}</div>
      </main>

      <Footer />

      <div class="credit">
        <p>ガイド音はWeb Audio APIで合成しています。</p>
      </div>
    </>
  );
}
