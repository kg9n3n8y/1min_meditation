const CACHE_VERSION = 'v1';
const CACHE_NAME = `1min-meditation-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = './index.html';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './thumbnail.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './audio/inhale.mp3',
  './audio/hold.mp3',
  './audio/exhale.mp3',
  './audio/end.mp3',
  './audio/muon.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => (
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const acceptHeader = request.headers.get('accept') || '';
  const isPageRequest = request.mode === 'navigate'
    || request.destination === 'document'
    || acceptHeader.includes('text/html');

  if (isPageRequest) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_FALLBACK, responseClone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(OFFLINE_FALLBACK))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => {});
          return response;
        })
        .catch(() => cached);
    })
  );
});
