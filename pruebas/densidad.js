const { chromium } = require('playwright-core');

/* La escala compacta no puede quedarse en una pantalla suelta: se mide cada
   apartado con el mismo navegador a 100 %, sin depender de permisos ni datos. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const base = await p.evaluate(() => ({
    zoom: window.devicePixelRatio,
    raiz: getComputedStyle(document.documentElement).fontSize,
    cuerpo: getComputedStyle(document.body).fontFamily,
    cabeceraDerecha: Math.round(window.innerWidth - document.querySelector('.header-inner').getBoundingClientRect().right),
  }));
  ok('La escala global usa Inter a 14 px y ocupa toda la cabecera',
    base.zoom === 1 && base.raiz === '14px' && base.cuerpo.startsWith('Inter') && base.cabeceraDerecha === 0,
    JSON.stringify(base));

  const apartados = await p.evaluate(() => {
    const ids = [
      'view-dashboard', 'view-creditos', 'view-ventas', 'view-productos', 'view-ingresos',
      'view-kardex', 'view-despachos', 'view-clientes', 'view-cobranza', 'view-usuarios', 'view-settings',
    ];
    const estado = ids.map(id => {
      const vista = document.getElementById(id);
      const ocultos = ids.map(otro => [otro, document.getElementById(otro).hidden]);
      ids.forEach(otro => { document.getElementById(otro).hidden = otro !== id; });
      const caja = vista.getBoundingClientRect();
      const boton = [...vista.querySelectorAll('button')].find(el => getComputedStyle(el).display !== 'none');
      const campo = [...vista.querySelectorAll('input, textarea, select')].find(el => getComputedStyle(el).display !== 'none');
      const resultado = {
        id,
        ancho: Math.round(caja.width),
        izquierda: Math.round(caja.left),
        derecha: Math.round(window.innerWidth - caja.right),
        boton: boton ? parseFloat(getComputedStyle(boton).fontSize) : null,
        campo: campo ? parseFloat(getComputedStyle(campo).fontSize) : null,
      };
      ocultos.forEach(([otro, hidden]) => { document.getElementById(otro).hidden = hidden; });
      return resultado;
    });
    return estado;
  });

  for (const apartado of apartados) {
    const esConfiguracion = apartado.id === 'view-settings';
    const aprovechaAncho = esConfiguracion
      ? apartado.ancho <= 900
      : apartado.derecha <= 15 && apartado.ancho >= 1100;
    const controlesCompactos = (apartado.boton === null || apartado.boton <= 14)
      && (apartado.campo === null || apartado.campo <= 13.5);
    ok(`${apartado.id.replace('view-', '')}: ancho y controles compactos`,
      aprovechaAncho && controlesCompactos, JSON.stringify(apartado));
  }

  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(450);
  await p.screenshot({ path: 'pruebas/densidad-clientes.png', fullPage: false });
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'pruebas/densidad-ventas.png', fullPage: false });

  await p.emulateMedia({ media: 'print' });
  const raizImpresion = await p.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  ok('La impresión conserva su escala anterior', raizImpresion === '16px', raizImpresion);
  await p.emulateMedia({ media: 'screen' });
  await p.setViewportSize({ width: 400, height: 850 });
  const raizCelular = await p.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  ok('El teléfono conserva una escala táctil legible', raizCelular === '16px', raizCelular);

  console.log('\nerrores de JS:', errores.length ? errores.slice(0, 5) : 'ninguno');
  await b.close();
})();
