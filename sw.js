/* Service worker: permite instalar la app y usarla sin internet */
const CACHE = 'creditos-v28';
const ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/firebase-config.js',
  './js/notifications.js',
  './js/vendor/firebase.js',
  './js/xlsx-lite.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Estrategia: red primero (para recibir actualizaciones), caché si no hay internet */
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(cache => cache.put(ev.request, copia));
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true })
        .then(resp => resp || caches.match('./index.html')))
  );
});
