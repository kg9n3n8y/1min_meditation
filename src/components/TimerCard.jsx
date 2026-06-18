import { withAudioUnlock } from '../lib/audioUnlock.js';

export function TimerCard({
  phaseLabel,
  countdownLabel,
  progressDeg,
  isActive,
  onToggle,
  audioEngine,
  audioUnlock,
}) {
  const handleToggle = async () => {
    await withAudioUnlock(audioEngine, audioUnlock, onToggle);
  };

  const handleKeyDown = async (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      await withAudioUnlock(audioEngine, audioUnlock, onToggle);
    }
  };

  return (
    <div
      class="timer-card"
      role="button"
      tabIndex={0}
      aria-label="タイマーの開始と停止"
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
    >
      <div
        class="progress-ring"
        aria-hidden="true"
        style={{
          background: `conic-gradient(var(--accent) ${progressDeg}deg, rgba(255,255,255,0.08) ${progressDeg}deg)`,
        }}
      />
      <div class="timer-content">
        <div class="phase">{phaseLabel}</div>
        <div class="countdown">{countdownLabel}</div>
        <button
          type="button"
          class="primary-btn"
          aria-label={isActive ? 'タイマー停止' : 'タイマー開始'}
          onClick={async (event) => {
            event.stopPropagation();
            await handleToggle();
          }}
        >
          {isActive ? '停止' : 'はじめる'}
        </button>
      </div>
    </div>
  );
}
