export function getStorage() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

export function loadJson(storageKey) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function saveJson(storageKey, value) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(value));
  } catch (_) {}
}
