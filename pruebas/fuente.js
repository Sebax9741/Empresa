const { chromium } = require('playwright-core');

/* Que la tipografía cargue de verdad (no el respaldo del sistema) y que los
   acentos y la ñ se vean bien. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  const fallos = [];
  p.on('requestfailed', r => { if (/woff2/.test(r.url())) fallos.push(r.url()); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const cargadas = await p.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
  });
  ok('La tipografía queda cargada', cargadas.some(f => /Figtree/.test(f) && /loaded/.test(f)),
    JSON.stringify(cargadas));
  ok('Ningún archivo de fuente falló', !fallos.length, fallos.join(' '));
  ok('El cuerpo la está usando',
    /Figtree/.test(await p.evaluate(() => getComputedStyle(document.body).fontFamily)));

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
