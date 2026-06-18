export const ONE_SECOND_MS = 1000;

export const BASE_PATTERN = [
  { label: '吸う', key: 'inhale', calcDuration: (inhaleSec) => inhaleSec },
  { label: '止める', key: 'hold', calcDuration: (_, holdSec) => holdSec },
  { label: '吐く', key: 'exhale', calcDuration: (_, __, exhaleSec) => exhaleSec },
];

export const DEFAULT_INHALE_SECONDS = 4;
export const DEFAULT_HOLD_SECONDS = 8;
export const DEFAULT_EXHALE_SECONDS = 8;
export const DEFAULT_CYCLE_COUNT = 3;

export const INHALE_MIN_SECONDS = 2;
export const INHALE_MAX_SECONDS = 8;
export const HOLD_MIN_SECONDS = 0;
export const HOLD_MAX_SECONDS = 10;
export const EXHALE_MIN_SECONDS = 4;
export const EXHALE_MAX_SECONDS = 16;
export const CYCLE_MIN_COUNT = 1;
export const CYCLE_MAX_COUNT = 9;

export const COUNTDOWN_SECONDS = 3;
export const CONFIG_STORAGE_KEY = 'breathingConfig:v1';
export const INSTALL_BANNER_STORAGE_KEY = 'pwaInstallBanner:v1';
export const PUBLIC_URL = 'https://kg9n3n8y.github.io/1min_meditation/';

export const SLIDER_CONFIG = [
  {
    id: 'inhale',
    label: '吸う秒数',
    unit: '秒',
    min: INHALE_MIN_SECONDS,
    max: INHALE_MAX_SECONDS,
    defaultValue: DEFAULT_INHALE_SECONDS,
  },
  {
    id: 'hold',
    label: '止める秒数',
    unit: '秒',
    min: HOLD_MIN_SECONDS,
    max: HOLD_MAX_SECONDS,
    defaultValue: DEFAULT_HOLD_SECONDS,
  },
  {
    id: 'exhale',
    label: '吐く秒数',
    unit: '秒',
    min: EXHALE_MIN_SECONDS,
    max: EXHALE_MAX_SECONDS,
    defaultValue: DEFAULT_EXHALE_SECONDS,
  },
  {
    id: 'cycle',
    label: 'サイクル回数',
    unit: '回',
    min: CYCLE_MIN_COUNT,
    max: CYCLE_MAX_COUNT,
    defaultValue: DEFAULT_CYCLE_COUNT,
  },
];

export const DEFAULT_CONFIG = {
  inhaleSeconds: DEFAULT_INHALE_SECONDS,
  holdSeconds: DEFAULT_HOLD_SECONDS,
  exhaleSeconds: DEFAULT_EXHALE_SECONDS,
  cycleCount: DEFAULT_CYCLE_COUNT,
};
