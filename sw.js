/* Service worker: permite instalar la app y usarla sin internet */
const CACHE = 'creditos-v95';
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

/* Los iconos en color. Van aparte porque no son críticos: si alguno fallara
   al bajar, la app tiene que instalarse igual (se verían los emojis del
   sistema hasta la próxima vez que haya internet).

   Aquí solo está la versión suelta, que es la que usa casi toda la app, más
   los dos iconos con recuadro de las tarjetas de "Ingreso de productos". El
   resto de la carpeta chip/ no se precarga: si algún día se usa en otro
   sitio, se guarda sola la primera vez que se pida. */
const ICONOS = [
  './icons/emoji/chip/1f4c4.svg',
  './icons/emoji/chip/2696.svg',
  './icons/emoji/1f194.svg',
  './icons/emoji/1f195.svg',
  './icons/emoji/1f389.svg',
  './icons/emoji/1f3e0.svg',
  './icons/emoji/1f3e6.svg',
  './icons/emoji/1f441.svg',
  './icons/emoji/1f44c.svg',
  './icons/emoji/1f451.svg',
  './icons/emoji/1f464.svg',
  './icons/emoji/1f465.svg',
  './icons/emoji/1f4a1.svg',
  './icons/emoji/1f4b0.svg',
  './icons/emoji/1f4b3.svg',
  './icons/emoji/1f4b5.svg',
  './icons/emoji/1f4be.svg',
  './icons/emoji/1f4c4.svg',
  './icons/emoji/1f4c5.svg',
  './icons/emoji/1f4c8.svg',
  './icons/emoji/1f4ca.svg',
  './icons/emoji/1f4cb.svg',
  './icons/emoji/1f4cd.svg',
  './icons/emoji/1f4d2.svg',
  './icons/emoji/1f4dd.svg',
  './icons/emoji/1f4de.svg',
  './icons/emoji/1f4e4.svg',
  './icons/emoji/1f4e5.svg',
  './icons/emoji/1f4e6.svg',
  './icons/emoji/1f4f1.svg',
  './icons/emoji/1f4f4.svg',
  './icons/emoji/1f4f7.svg',
  './icons/emoji/1f504.svg',
  './icons/emoji/1f50d.svg',
  './icons/emoji/1f511.svg',
  './icons/emoji/1f512.svg',
  './icons/emoji/1f513.svg',
  './icons/emoji/1f514.svg',
  './icons/emoji/1f517.svg',
  './icons/emoji/1f522.svg',
  './icons/emoji/1f53d.svg',
  './icons/emoji/1f550.svg',
  './icons/emoji/1f58a.svg',
  './icons/emoji/1f5a8.svg',
  './icons/emoji/1f5bc.svg',
  './icons/emoji/1f5d1.svg',
  './icons/emoji/1f5d3.svg',
  './icons/emoji/1f69a.svg',
  './icons/emoji/1f6aa.svg',
  './icons/emoji/1f6ab.svg',
  './icons/emoji/1f6d2.svg',
  './icons/emoji/1f7e2.svg',
  './icons/emoji/1f91d.svg',
  './icons/emoji/1f9cd.svg',
  './icons/emoji/1f9ee.svg',
  './icons/emoji/1f9f9.svg',
  './icons/emoji/1f9fe.svg',
  './icons/emoji/1fa99.svg',
  './icons/emoji/2139.svg',
  './icons/emoji/21a9.svg',
  './icons/emoji/23f0.svg',
  './icons/emoji/23f3.svg',
  './icons/emoji/2601.svg',
  './icons/emoji/2696.svg',
  './icons/emoji/2699.svg',
  './icons/emoji/26a0.svg',
  './icons/emoji/26f3.svg',
  './icons/emoji/2705.svg',
  './icons/emoji/270d.svg',
  './icons/emoji/270f.svg',
  './icons/emoji/274c.svg',
  './icons/emoji/2795.svg',
  './icons/emoji/2796.svg',
  './icons/emoji/2b06.svg',
  './icons/emoji/2b07.svg',
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE)
      // 'reload' salta la caché del navegador: si no, al instalarse la versión
      // nueva podría guardar los archivos viejos que aún tenía guardados.
      // Los iconos también se piden con 'reload'. Los dibujos cambiaron
      // conservando el nombre del archivo, así que sin esto el navegador
      // habría vuelto a guardar los viejos que aún tenía en su propia caché.
      .then(cache => cache.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' })))
        .then(() => { cache.addAll(ICONOS.map(u => new Request(u, { cache: 'reload' }))).catch(() => {}); }))
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
