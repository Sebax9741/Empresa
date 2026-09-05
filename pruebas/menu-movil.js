const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/firebase-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG={apiKey:"X"};' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  await p.evaluate(() => document.getElementById('sort-by-cara').click());
  await p.waitForTimeout(350);
  const caja = await p.evaluate(() => {
    const m = document.querySelector('.sel-menu');
    const r = m.getBoundingClientRect();
    return { x: Math.round(r.x), der: Math.round(r.right), abajo: Math.round(r.bottom),
      ancho: Math.round(r.width), corre: m.scrollHeight > m.clientHeight };
  });
  ok('En el teléfono el menú entra en la pantalla y no se sale por los lados',
    caja.x >= 0 && caja.der <= 390 && caja.abajo <= 844, JSON.stringify(caja));
  ok('Si es muy largo, se corre por dentro en vez de crecer sin fin', caja.corre, JSON.stringify(caja));
  await p.screenshot({ path: 'pruebas/menu-movil.png' });
  console.log(errs.length ? `errores de JS: ${errs.slice(0, 2).join(' | ')}` : 'errores de JS: ninguno');
  await b.close();
})();
