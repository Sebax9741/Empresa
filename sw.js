/* Service worker: permite instalar la app y usarla sin internet */
const CACHE = 'creditos-v73';
const ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './css/fonts/PlusJakartaSans-Variable.woff2',
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
    caches.open(CACHE)
      // 'reload' salta la caché del navegador: si no, al instalarse la versión
      // nueva podría guardar los archivos viejos que aún tenía guardados.
      .then(cache => cache.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Los archivos que forman la app (página, guiones y estilos). A estos se les
   pide siempre la versión del servidor saltando la caché del navegador: sin
   eso, un cambio recién publicado podía tardar hasta una hora en verse en el
   celular aunque se recargara, porque el navegador reusaba su copia guardada. */
function esArchivoDeLaApp(url) {
  return url.origin === self.location.origin
    && /(\.(html|js|css|webmanifest)|\/)$/.test(url.pathname);
}

/* Estrategia: red primero (para recibir actualizaciones), caché si no hay internet */
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  const url = new URL(ev.request.url);
  const pedido = esArchivoDeLaApp(url)
    ? fetch(url.href, { cache: 'reload', credentials: 'same-origin' })
    : fetch(ev.request);
  ev.respondWith(
    pedido
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(cache => cache.put(ev.request, copia));
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true })
        .then(resp => resp || caches.match('./index.html')))
  );
});
