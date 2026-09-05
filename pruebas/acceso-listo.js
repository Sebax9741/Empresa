const { chromium } = require('playwright-core');

/* No hay forma barata de reproducir aquí la ventana real del fallo (se abre
   mientras se está cargando el SDK de Firebase / esperando la respuesta de
   la nube, cosas que en local no pasan). Esto solo vigila que el arreglo
   —accesoResuelto, puedeVerSeccion()— no haya dejado el modo local roto: que
   siga aterrizando en Dashboard y que los botones del menú no se queden
   escondidos para siempre. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1800);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const estado = await p.evaluate(() => ({
    seccionDashboardVisible: !document.getElementById('view-dashboard').hidden,
    navDashboardVisible: !document.getElementById('nav-dashboard').hidden,
    navVentasVisible: !document.getElementById('nav-ventas').hidden,
    navKardexVisible: !document.getElementById('nav-kardex').hidden,
  }));
  ok('En modo local (dueño único), aterriza en Dashboard y no se queda pegado en Créditos',
    estado.seccionDashboardVisible, JSON.stringify(estado));
  ok('Y los botones del menú vuelven a verse (no se quedan escondidos para siempre)',
    estado.navDashboardVisible && estado.navVentasVisible && estado.navKardexVisible,
    JSON.stringify(estado));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
