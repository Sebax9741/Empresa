const { chromium } = require('playwright-core');

/* El ingreso por factura debe leerse como un comprobante: un solo recuadro,
   con cabecera viva, detalle numerado y pie con totales. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1300);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // Producto para tener con qué llenar el detalle
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  for (const [n, a] of [['HARINA ITALIANA X50KG', '128'], ['ACEITE PRIMOR BALDE 20L', '210']]) {
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(350);
    await p.fill('#prod-nombre', n);
    await p.fill('#prod-precio-a', a);
    await p.fill('#prod-precio-b', a);
    await p.fill('#prod-precio-c', a);
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(600);
  }

  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);

  // ── 1) Un solo recuadro ──
  const recuadros = await p.evaluate(() => ({
    docs: document.querySelectorAll('#ing-vista-factura .doc').length,
    bloques: document.querySelectorAll('#ing-vista-factura .nv-bloque').length,
    partes: Array.from(document.querySelectorAll('#ing-vista-factura .doc-parte-tit'))
      .map(t => t.textContent.trim()),
  }));
  ok('El ingreso por factura es UN solo recuadro',
    recuadros.docs === 1 && recuadros.bloques === 0, JSON.stringify(recuadros));

  const piezas = await p.evaluate(() => {
    const d = document.querySelector('#ing-vista-factura .doc');
    return {
      cab: !!d.querySelector('.doc-cab'),
      pie: !!d.querySelector('.doc-pie'),
      // La cabecera y el pie tocan los bordes del recuadro: es una hoja, no cajas apiladas
      anchoCab: Math.round(d.querySelector('.doc-cab').getBoundingClientRect().width),
      anchoDoc: Math.round(d.getBoundingClientRect().width),
    };
  });
  // (el recuadro mide 2px más: es su propio borde)
  ok('Tiene cabecera y pie de comprobante, a todo el ancho',
    piezas.cab && piezas.pie && piezas.anchoDoc - piezas.anchoCab <= 2, JSON.stringify(piezas));

  // ── 2) La cabecera se llena sola con lo que se escribe ──
  await p.fill('#ing-proveedor', 'Distribuidora Ramos S.A.C.');
  await p.fill('#ing-doc-numero', 'F001-1234');
  await p.waitForTimeout(300);
  const cab = await p.evaluate(() => ({
    doc: document.getElementById('ing-cab-doc').textContent.trim(),
    prov: document.getElementById('ing-cab-proveedor').textContent.trim(),
    fecha: document.getElementById('ing-cab-fecha').textContent.trim(),
    usuario: document.getElementById('ing-cab-usuario').textContent.trim(),
  }));
  ok('La cabecera repite el documento que se está escribiendo',
    cab.doc === 'Factura F001-1234' && /Ramos/.test(cab.prov), JSON.stringify(cab));
  ok('La cabecera muestra fecha y quién registra', !!cab.fecha && cab.fecha !== '—' && !!cab.usuario,
    `${cab.fecha} · ${cab.usuario}`);

  await p.selectOption('#ing-doc-tipo', 'sin');
  await p.waitForTimeout(250);
  ok('Si no hay documento, la cabecera lo dice',
    (await p.textContent('#ing-cab-doc')).trim() === 'Sin documento');
  await p.selectOption('#ing-doc-tipo', 'factura');
  await p.waitForTimeout(200);

  // ── 3) El detalle va numerado como en una boleta ──
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(350);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.fill('#ing-cantidad', '40');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-buscar', 'ACEITE');
  await p.waitForTimeout(350);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.fill('#ing-cantidad', '15');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);

  const items = await p.$$eval('#ing-lista-body tr', rs => rs.map(r => r.cells[0].textContent.trim()));
  ok('Cada línea del detalle lleva su número de ítem',
    items.join(',') === '1,2', items.join(','));
  ok('La cabecera cuenta los productos cargados',
    (await p.textContent('#ing-cab-items')).trim() === '2');

  const pie = await p.evaluate(() => {
    const f = document.querySelector('#ing-vista-factura .doc-pie');
    const r = f.querySelector('.ing-resumen').getBoundingClientRect();
    const bs = f.querySelector('.doc-pie-botones').getBoundingClientRect();
    return {
      totales: [document.getElementById('ing-res-productos').textContent,
        document.getElementById('ing-res-unidades').textContent].join('/'),
      // Totales a la izquierda, botones a la derecha, como el pie de una factura
      separados: r.right < bs.left,
    };
  });
  ok('El pie lleva los totales a un lado y los botones al otro',
    pie.totales === '2/55' && pie.separados, JSON.stringify(pie));

  await p.screenshot({ path: 'pruebas/doc-ingreso.png', clip: await p.evaluate(() => {
    const r = document.querySelector('#ing-vista-factura .doc').getBoundingClientRect();
    return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 };
  }) });

  // ── 4) Sigue guardando bien ──
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);
  const tras = await p.evaluate(async () => ({
    kardex: (await DB.getAllKardex()).length,
    grupos: document.querySelectorAll('.ing-grupo').length,
    lista: document.querySelectorAll('#ing-lista-body tr').length,
    cabDoc: document.getElementById('ing-cab-doc').textContent.trim(),
  }));
  ok('Guarda los dos productos en un solo ingreso',
    tras.kardex === 2 && tras.grupos === 1, JSON.stringify(tras));
  ok('Al guardar, el comprobante queda en blanco para el siguiente',
    tras.lista === 0 && tras.cabDoc === 'Factura —', JSON.stringify(tras));

  // ── 5) En pantalla angosta no se desborda ──
  await p.setViewportSize({ width: 820, height: 1000 });
  await p.waitForTimeout(500);
  const angosto = await p.evaluate(() => {
    const d = document.querySelector('#ing-vista-factura .doc');
    return { doc: Math.round(d.getBoundingClientRect().width), body: document.body.clientWidth,
      cols: getComputedStyle(document.querySelector('.doc-campos')).gridTemplateColumns.split(' ').length };
  });
  ok('En pantalla angosta el recuadro no se sale ni encima campos',
    angosto.doc <= angosto.body && angosto.cols === 1, JSON.stringify(angosto));

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
