import { BASE_PATTERN } from './config.js';

export function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function buildPattern(inhaleSec, holdSec, exhaleSec, sets) {
  return Array.from({ length: sets }, () => (
    BASE_PATTERN.map(({ label, key, calcDuration }) => ({
      label,
      key,
      duration: calcDuration(inhaleSec, holdSec, exhaleSec),
    }))
  )).flat();
}

export function getTotalSeconds(phases) {
  return phases.reduce((sum, phase) => sum + phase.duration, 0);
}
