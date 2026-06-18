import { SLIDER_CONFIG } from '../lib/config.js';

const CONFIG_FIELDS = {
  inhale: 'inhaleSeconds',
  hold: 'holdSeconds',
  exhale: 'exhaleSeconds',
  cycle: 'cycleCount',
};

export function ConfigSliders({ config, disabled, onInput, onCommit }) {
  return (
    <section class="app-controls" aria-label="タイマー設定">
      {SLIDER_CONFIG.map((slider) => {
        const field = CONFIG_FIELDS[slider.id];
        const value = config[field];
        const inputId = `${slider.id}Slider`;

        return (
          <div class="slider-group" key={slider.id}>
            <label class="slider-label" for={inputId}>
              {slider.label}:
              {' '}
              <span>{value}</span>
              {slider.unit}
            </label>
            <input
              id={inputId}
              class="slider"
              type="range"
              min={slider.min}
              max={slider.max}
              step="1"
              value={value}
              disabled={disabled}
              aria-valuemin={slider.min}
              aria-valuemax={slider.max}
              aria-valuenow={value}
              aria-valuetext={`${value}${slider.unit}`}
              onInput={(event) => onInput(field, Number(event.currentTarget.value))}
              onChange={() => onCommit(field)}
            />
          </div>
        );
      })}
    </section>
  );
}
