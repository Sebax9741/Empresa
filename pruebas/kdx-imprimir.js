const { chromium } = require('playwright-core');

/* El "🖨️ Imprimir" de la cabecera de Kardex solo aplica a Movimientos y
   Stock por día; en "Saldo a una fecha" se esconde (esa vista ya trae su
   propio Imprimir/PDF y Excel). */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1200);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(700);

  const visible = () => p.evaluate(() => !document.getElementById('btn-kardex-imprimir').hidden);

  ok('Se ve en "Movimientos"', await visible());

  await p.evaluate(() => document.getElementById('btn-kdx-vista-dias').click());
  await p.waitForTimeout(400);
  ok('Se ve en "Stock por día"', await visible());

  await p.evaluate(() => document.getElementById('btn-kdx-vista-saldo').click());
  await p.waitForTimeout(400);
  ok('Se esconde en "Saldo a una fecha"', !(await visible()));

  await p.evaluate(() => document.getElementById('btn-kdx-vista-mov').click());
  await p.waitForTimeout(400);
  ok('Y vuelve a verse al regresar a "Movimientos"', await visible());

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
