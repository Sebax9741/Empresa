const { chromium } = require('playwright-core');

/* En el teléfono TAMBIÉN hay que poder trabajar. La tabla de créditos se
   cambia por tarjetas —para eso están—, pero las de Productos, Kardex, Notas
   de venta y la factura en curso no tienen repuesto: si se esconden, en el
   celular no se ve nada de eso. Aquí se comprueba que se ven y que se pueden
   leer desplazándolas de lado. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  // Un teléfono de verdad: 390x844, como el de la mano
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // En el celular se navega por el cajón (☰), no por el panel lateral
  const irA = async (id, ms = 1000) => {
    await p.evaluate(x => document.getElementById(x).click(), id);
    await p.waitForTimeout(ms);
  };
  // ¿Se ve de verdad? (no basta con que exista: puede estar en display:none)
  const seVe = sel => p.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return { hay: false };
    const r = el.getBoundingClientRect();
    return { hay: true, visible: r.width > 0 && r.height > 0,
      filas: el.querySelectorAll('tbody tr').length };
  }, sel);

  // Un producto y su ingreso
  await irA('nav-productos', 800);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(600);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  for (const l of ['a', 'b', 'c']) await p.fill(`#prod-precio-${l}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(900);

  const prod = await seVe('.prod-tabla-wrap');
  ok('En el celular se ve la tabla de Productos', prod.hay && prod.visible && prod.filas === 1,
    JSON.stringify(prod));

  await irA('nav-ingresos', 900);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '40');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(600);
  const ing = await seVe('.ing-lista-wrap');
  ok('Y la lista de la factura que se está armando', ing.hay && ing.visible && ing.filas === 1,
    JSON.stringify(ing));
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1400);

  await irA('nav-kardex', 1200);
  const kdx = await seVe('.kdx-tabla-wrap');
  ok('Se ven los movimientos del Kardex', kdx.hay && kdx.visible && kdx.filas === 1,
    JSON.stringify(kdx));
  const corre = await p.evaluate(() =>
    getComputedStyle(document.querySelector('.kdx-tabla-wrap')).overflowX);
  ok('Y se leen desplazándolas de lado, sin recortar columnas',
    corre === 'auto' || corre === 'scroll', corre);
  await p.screenshot({ path: 'pruebas/cel-kardex.png', fullPage: true });

  // "Stock por día" y "Saldo a una fecha" también se vuelven su propia zona
  // de scroll en el celular (mismo overflow-x que la de arriba), y eso movía
  // la fila de títulos pegada de la pantalla al recuadro: sin el ajuste, la
  // fila de títulos tapaba la primera fila de datos en vez de quedar encima.
  const sinSolape = sel => p.evaluate(s => {
    const th = document.querySelector(s + ' thead th');
    const fila = document.querySelector(s.replace('-tabla', '') + '-body tr')
      || document.querySelector(s + ' tbody tr');
    if (!th || !fila) return null;
    const rt = th.getBoundingClientRect(), rf = fila.getBoundingClientRect();
    return Math.round(rt.bottom) <= Math.round(rf.top) + 1;   // la fila empieza donde acaba el título, no antes
  }, sel);
  await p.evaluate(() => document.getElementById('btn-kdx-vista-dias').click());
  await p.waitForTimeout(400);
  await p.selectOption('#kdx-fil-producto', { index: 1 });
  await p.waitForTimeout(500);
  ok('En "Stock por día" el título no tapa la fila de abajo',
    await sinSolape('#kdx-dias-tabla'));
  await p.evaluate(() => document.getElementById('btn-kdx-vista-saldo').click());
  await p.waitForTimeout(500);
  ok('Y en "Saldo a una fecha" tampoco', await sinSolape('#kdx-saldo-tabla'));
  await p.evaluate(() => document.getElementById('btn-kdx-vista-mov').click());
  await p.waitForTimeout(400);

  // Una nota de venta, para ver su lista
  await irA('nav-clientes', 900);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(600);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1300);
  await irA('nav-ventas', 1000);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(1000);
  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(500);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(400);
  await p.fill('#nv-cantidad', '3');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(600);
  const items = await seVe('.nv-items-wrap');
  ok('Se ven los productos que se van agregando a la nota',
    items.hay && items.visible && items.filas === 1, JSON.stringify(items));
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);

  await irA('nav-ventas', 1000);
  const notas = await seVe('.nv-tabla-wrap');
  ok('Y la lista de notas de venta emitidas',
    notas.hay && notas.visible && notas.filas === 1, JSON.stringify(notas));
  await p.screenshot({ path: 'pruebas/cel-ventas.png', fullPage: true });

  // Créditos SÍ cambia a tarjetas: ahí la tabla sobra
  await irA('nav-inicio', 1200);
  const creditos = await p.evaluate(() => {
    const tabla = document.querySelector('#view-creditos .table-wrap');
    const cards = document.getElementById('cards');
    return {
      tablaOculta: getComputedStyle(tabla).display === 'none',
      tarjetas: cards.querySelectorAll('.credit-card, article').length,
    };
  });
  ok('En Créditos manda la tarjeta, y la tabla se aparta',
    creditos.tablaOculta && creditos.tarjetas === 1, JSON.stringify(creditos));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
