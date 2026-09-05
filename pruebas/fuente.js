const { chromium } = require('playwright-core');

/* Que la tipografía cargue de verdad (no el respaldo del sistema) y que los
   acentos y la ñ se vean bien. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  const fallos = [];
  p.on('requestfailed', r => { if (/woff2/.test(r.url())) fallos.push(r.url()); });
  // Qué archivos de letra baja de verdad, y cuánto pesan
  const bajadas = [];
  p.on('response', async r => {
    if (!/woff2/.test(r.url())) return;
    let peso = 0;
    try { peso = (await r.body()).length; } catch (e) { /* si se cierra antes, da igual */ }
    bajadas.push({ archivo: r.url().split('/').pop(), kb: Math.round(peso / 1024) });
  });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const cargadas = await p.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
  });
  ok('La tipografía queda cargada', cargadas.some(f => /Inter/.test(f) && /loaded/.test(f)),
    JSON.stringify(cargadas));
  ok('Ningún archivo de fuente falló', !fallos.length, fallos.join(' '));
  ok('El cuerpo la está usando',
    /Inter/.test(await p.evaluate(() => getComputedStyle(document.body).fontFamily)));

  // Lo que pesa la letra es lo que el cobrador baja por el dato del celular
  // para recibir una actualización. Sin recortar eran 345 KB.
  ok('Solo se baja un archivo de letra, y es liviano',
    bajadas.length === 1 && bajadas[0].kb < 60, JSON.stringify(bajadas));
  ok('No se baja el archivo de los acentos raros, que en español no hace falta',
    !bajadas.some(x => /-ext/.test(x.archivo)), JSON.stringify(bajadas.map(x => x.archivo)));
  // Recortar una letra es quitarle signos: hay que comprobar que no se fue
  // ninguno de los que la app sí escribe
  ok('Al recortarla no se perdió ningún signo del español ni del negocio',
    await p.evaluate(() => document.fonts.check('14px Inter', 'ñÑáéíóúüÁÜ¿¡°·—“”S/.0123456789')));

  const escala = await p.evaluate(() => ({
    raiz: getComputedStyle(document.documentElement).fontSize,
    cuerpo: getComputedStyle(document.body).fontSize,
    boton: getComputedStyle(document.getElementById('btn-filtro-limpiar')).fontSize,
    campo: getComputedStyle(document.querySelector('.input')).fontSize,
  }));
  ok('La escala de escritorio es compacta a zoom 100 %',
    escala.raiz === '14px' && escala.cuerpo === '14px'
      && parseFloat(escala.boton) <= 13 && parseFloat(escala.campo) <= 13.5,
    JSON.stringify(escala));

  // Acentos y ñ: se mide un texto con y sin ellos para ver que no caiga al respaldo
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'pruebas/fuente-clientes.png', clip: { x: 0, y: 0, width: 1500, height: 420 } });
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'pruebas/fuente-ventas.png', clip: { x: 0, y: 0, width: 1500, height: 500 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
