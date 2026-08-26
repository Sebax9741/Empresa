/* Service worker: permite instalar la app y usarla sin internet */
const CACHE = 'creditos-v91';
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

  /* SOLO se atienden los archivos de esta app. Todo lo de otros dominios —en
     especial las llamadas a Firestore— pasa de largo, sin tocarlo.

     Esto era lo que rompía el trabajo sin internet: al atenderlas aquí, en
     cuanto se caía la conexión se les devolvía el index.html en lugar de un
     fallo de red. Firestore recibía una página web con un "200 OK", así que
     nunca se enteraba de que estaba sin señal: se quedaba esperando respuesta
     en vez de pasar a servir los datos guardados en el dispositivo. */
  if (url.origin !== self.location.origin) return;

  const pedido = esArchivoDeLaApp(url)
    ? fetch(url.href, { cache: 'reload', credentials: 'same-origin' })
    : fetch(ev.request);

  ev.respondWith(
    pedido
      .then(resp => {
        // Solo se guardan las respuestas buenas: si no, una página de error
        // podría quedarse guardada en lugar del archivo de verdad.
        if (resp && resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(cache => cache.put(ev.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }).then(resp => {
        if (resp) return resp;
        // Devolver la página solo tiene sentido al ABRIR la app. Para
        // cualquier otra cosa hay que contestar un fallo de red de verdad.
        if (ev.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
