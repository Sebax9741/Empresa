const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 120)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1200);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // Crear 3 productos para tener catálogo
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  const crear = async (nombre, pres, a) => {
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(350);
    await p.fill('#prod-nombre', nombre);
    await p.selectOption('#prod-presentacion', pres);
    await p.fill('#prod-precio-a', String(a));
    await p.fill('#prod-precio-b', String(a + 3));
    await p.fill('#prod-precio-c', String(a + 6));
    await p.fill('#prod-stockmin', '5');
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(500);
  };
  await crear('HARINA ITALIANA X50KG', 'saco', 128);
  await crear('ACEITE PRIMOR X 1L', 'balde', 96);
  await crear('LAVA VAJILLA LESLY LIMON', 'caja', 68);

  // ── 1) Hora con a. m. / p. m. ──
  const horas = await p.evaluate(() => {
    const manana = new Date(2026, 7, 22, 9, 35).getTime();
    const tarde = new Date(2026, 7, 22, 14, 5).getTime();
    const medianoche = new Date(2026, 7, 22, 0, 10).getTime();
    const mediodia = new Date(2026, 7, 22, 12, 30).getTime();
    return [manana, tarde, medianoche, mediodia].map(t => window.__hora ? '' : '');
  });
  // Se comprueba a través de la interfaz: la hoja de cobranza usa fechaHoraDeTimestamp
  await p.evaluate(async () => {
    await DB.put({ id: 'c1', boleta: '900', cliente: 'PRUEBA', zona: 'CIUDAD', monto: 100,
      fecha: '2026-08-22', vencimiento: '2026-09-22', estado: 'parcial', creado: Date.now(),
      abonos: [{ monto: 50, fecha: '2026-08-22', metodo: 'efectivo', registradoPor: 'juan',
        registradoFecha: '2026-08-22', registrado: new Date(2026, 7, 22, 14, 5).getTime() }] });
  });
  await p.reload();
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(500);
  await p.fill('#cob-fecha', '2026-08-22');
  await p.waitForTimeout(500);
  const horaCobranza = await p.$$eval('#cob-body tr', r => r.length ? r[0].cells[8].textContent.trim() : '');
  ok('La hoja de cobranza muestra la hora con p. m.', /p\. m\./.test(horaCobranza), horaCobranza);

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-info="c1"]').click());
  await p.waitForTimeout(600);
  const fichaTexto = await p.evaluate(() => document.getElementById('info-abonos').textContent.replace(/\s+/g, ' '));
  ok('La constancia del pago también lleva p. m.', /a las 2:05 p\. m\./.test(fichaTexto),
    (fichaTexto.match(/a las [^·]*/) || [''])[0].trim());
  await p.evaluate(() => document.getElementById('modal-info').close());
  await p.waitForTimeout(300);

  // ── 2) Buscador por nombre en el ingreso ──
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(500);
  const modoInicial = await p.evaluate(() => ({
    factura: !document.getElementById('ing-vista-factura').hidden,
    activo: document.getElementById('ing-modo-factura').classList.contains('activo'),
  }));
  ok('Abre en modo "por factura"', modoInicial.factura && modoInicial.activo);

  await p.fill('#ing-buscar', 'har');
  await p.waitForTimeout(400);
  const sug = await p.$$eval('#ing-sugerencias [data-ing-elegir]', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok('Al escribir el nombre aparecen los productos debajo', sug.length === 1 && /HARINA/.test(sug[0]), sug.join(' | '));
  ok('Cada sugerencia muestra código, U.M. y stock', /PR-0001/.test(sug[0]) && /SAC/.test(sug[0]) && /stock 0/.test(sug[0]));

  // ── 3) Agregar varios productos a la lista de una factura ──
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-cantidad', '50');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);

  await p.fill('#ing-buscar', 'aceite');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(250);
  await p.fill('#ing-cantidad', '30');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);

  await p.fill('#ing-buscar', 'lava');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(250);
  await p.fill('#ing-cantidad', '12');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);

  const lista = await p.$$eval('#ing-lista-body tr', r => r.map(x => ({
    cod: x.cells[0].textContent.trim(),
    nombre: x.cells[1].textContent.trim(),
    um: x.cells[2].textContent.trim(),
    cant: x.cells[3].querySelector('input').value,
    actual: x.cells[4].textContent.trim(),
    result: x.cells[5].textContent.trim(),
  })));
  ok('Los tres productos quedan en la lista', lista.length === 3, JSON.stringify(lista.map(l => `${l.nombre} x${l.cant}`)));
  ok('Cada línea muestra el stock que quedará',
    lista[0].actual === '0' && lista[0].result === '50' && lista[1].result === '30' && lista[2].result === '12');

  const resumen = await p.evaluate(() => ({
    prods: document.getElementById('ing-res-productos').textContent,
    unidades: document.getElementById('ing-res-unidades').textContent,
  }));
  ok('El resumen suma productos y unidades', resumen.prods === '3' && resumen.unidades === '92', JSON.stringify(resumen));

  // Un producto repetido debe sumarse, no duplicar la línea
  await p.fill('#ing-buscar', 'har');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(250);
  await p.fill('#ing-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);
  const trasRepetir = await p.$$eval('#ing-lista-body tr', r => ({
    filas: r.length, harina: r[0].cells[3].querySelector('input').value }));
  ok('Repetir un producto suma a su línea, no la duplica',
    trasRepetir.filas === 3 && trasRepetir.harina === '60', JSON.stringify(trasRepetir));

  await p.screenshot({ path: 'pruebas/ing-factura-lista.png' });

  // ── 4) El botón "Agregar stock" registra todo de una vez ──
  await p.fill('#ing-proveedor', 'Distribuidora Ramos S.A.C.');
  await p.selectOption('#ing-doc-tipo', 'factura');
  await p.fill('#ing-doc-numero', 'F001-8821');
  await p.fill('#ing-nota', 'Llegó en camión, 1 saco roto');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);

  const aviso = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden ? t.textContent.trim() : '';
  });
  ok('Confirma cuántos productos y unidades entraron', /3 productos, 102 unidades/.test(aviso), aviso);

  const listaVacia = await p.$$eval('#ing-lista-body tr', r => r.length);
  ok('La lista se vacía tras agregar el stock', listaVacia === 0);

  // ── 5) El historial agrupa la factura ──
  const grupos = await p.$$eval('.ing-grupo', g => g.map(x => ({
    titulo: x.querySelector('.ing-grupo-tit strong').textContent.trim(),
    meta: x.querySelector('.ing-grupo-meta').textContent.replace(/\s+/g, ' ').trim(),
    chip: x.querySelector('.chip').textContent.replace(/\s+/g, ' ').trim(),
    filas: x.querySelectorAll('.ing-grupo-tabla tr').length,
  })));
  ok('El historial muestra la factura como UNA entrada', grupos.length === 1, JSON.stringify(grupos[0]));
  ok('Con el proveedor y el nº de factura en el título',
    /Factura F001-8821/.test(grupos[0].titulo) && /Distribuidora Ramos/.test(grupos[0].titulo), grupos[0].titulo);
  ok('Y sus 3 productos debajo', grupos[0].filas === 3);
  ok('Con el total de la carga', /3 productos · 102 unidades/.test(grupos[0].chip), grupos[0].chip);
  await p.screenshot({ path: 'pruebas/ing-historial-agrupado.png' });

  // ── 6) El stock de los productos subió ──
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(500);
  const stocks = await p.$$eval('#prod-body tr', r => r.map(x => x.cells[1].textContent.trim() + '=' + x.cells[6].textContent.trim()));
  ok('El stock de cada producto quedó actualizado',
    stocks.some(s => /HARINA.*=60/.test(s)) && stocks.some(s => /ACEITE.*=30/.test(s)) && stocks.some(s => /LAVA.*=12/.test(s)),
    stocks.join(' | '));

  // ── 7) Modo ajuste, con su propio buscador ──
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('ing-modo-ajuste').click());
  await p.waitForTimeout(300);
  const modoAjuste = await p.evaluate(() => ({
    ajuste: !document.getElementById('ing-vista-ajuste').hidden,
    factura: document.getElementById('ing-vista-factura').hidden,
  }));
  ok('El modo "ajuste o salida" se puede elegir', modoAjuste.ajuste && modoAjuste.factura);

  await p.fill('#aj-buscar', 'aceite');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-aj-elegir]').click());
  await p.waitForTimeout(300);
  await p.fill('#aj-cantidad', '28');
  await p.waitForTimeout(300);
  const prev = await p.evaluate(() => ({
    actual: document.getElementById('aj-stock-actual').textContent,
    result: document.getElementById('aj-stock-resultante').textContent,
  }));
  ok('En el conteo físico, "quedará en" es lo contado (28, no 58)',
    prev.actual === '30' && prev.result === '28', JSON.stringify(prev));
  await p.evaluate(() => document.querySelector('#ing-form-ajuste button[type=submit]').click());
  await p.waitForTimeout(900);
  const stockFinal = await p.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('.ing-grupo'));
    return filas.length;
  });
  ok('El ajuste queda como su propio registro en el historial', stockFinal === 2, 'grupos: ' + stockFinal);
  await p.screenshot({ path: 'pruebas/ing-modo-ajuste.png' });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
