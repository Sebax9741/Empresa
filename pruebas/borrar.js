const { chromium } = require('playwright-core');

/* Dos cosas de esta tanda:

   1) ELIMINAR una nota de venta que ya tiene cobros. Antes se plantaba y
      mandaba a quitar los cobros uno por uno desde la ficha del crédito.
      Ahora se lleva todo de una: la nota, su crédito, sus cobros, su despacho
      y sus apuntes de almacén. Lo que no cambia es que avisa —cuántos cobros,
      por cuánto y de qué día— y que pide el código de seguridad.

   2) El panel lateral contraído. Se abre al acercar el cursor; el problema era
      que al ELEGIR un apartado el botón se quedaba con el foco y el panel
      seguía desplegado con el cursor ya en medio de la pantalla, hasta que se
      hacía clic en otro sitio. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  // Se guarda lo que dice cada aviso: la advertencia es parte de lo que se pide
  const avisos = [];
  p.on('dialog', d => { avisos.push(d.message()); d.accept(); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const hayPin = () => p.evaluate(() => document.getElementById('modal-pin').open);
  const responderPin = async codigo => {
    if (!await hayPin()) return false;
    await p.fill('#pin-input', codigo);
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
    await p.waitForTimeout(1200);
    return true;
  };

  // ── Preparar: código de seguridad, cliente, producto y mercadería ──
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(700);
  await p.fill('#s-pin-nuevo', '2468');
  await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
  await p.waitForTimeout(900);

  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(350);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.selectOption('#cli-categoria', 'A');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(800);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(700);

  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(700);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);

  const stock = () => p.evaluate(async () => {
    document.getElementById('nav-productos').click();
    await new Promise(r => setTimeout(r, 450));
    const f = document.querySelector('#prod-body tr');
    return f ? f.querySelector('td:nth-child(7)').textContent.trim() : '';
  });

  // ── Una nota de venta de 10 sacos: S/ 1000 ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(800);
  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(400);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(300);
  await p.fill('#nv-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);

  const cuantasNotas = await p.evaluate(() => document.querySelectorAll('#nv-body tr').length);
  ok('La nota se emite y queda en la lista', cuantasNotas === 1, String(cuantasNotas));
  const stockVendido = await stock();
  ok('Y descuenta del almacén', stockVendido === '90', stockVendido);

  // ── Un cobro a cuenta sobre su crédito: S/ 400 de los 1000 ──
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#table-body [data-info]').click());
  await p.waitForTimeout(900);
  await p.fill('#cobro-monto', '400');
  await p.evaluate(() => document.getElementById('btn-firma').click());
  await p.waitForTimeout(800);
  const caja = await p.evaluate(() => {
    const r = document.getElementById('firma-canvas').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await p.mouse.move(caja.x - 50, caja.y);
  await p.mouse.down();
  await p.mouse.move(caja.x, caja.y + 20);
  await p.mouse.move(caja.x + 50, caja.y - 10);
  await p.mouse.up();
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-firma-ok').click());
  await p.waitForTimeout(1600);
  await p.evaluate(() => {
    const d = document.getElementById('modal-info');
    if (d && d.open) d.close();
  });
  await p.waitForTimeout(400);

  // La hoja de cobranza del día ya cuenta ese dinero
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1000);
  const hojaAntes = await p.evaluate(() =>
    document.getElementById("cob-body").textContent.replace(/\s+/g, ' ').trim());
  ok('La hoja de cobranza del día cuenta ese cobro',
    /400/.test(hojaAntes), hojaAntes.slice(0, 90) || 'hoja vacía');

  // ── 1) Eliminar la nota: avisa de los cobros y NO se planta ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  avisos.length = 0;
  await p.evaluate(() => document.querySelector('[data-eliminar-nota]').click());
  await p.waitForTimeout(900);

  const advertencia = avisos.join(' | ');
  ok('Avisa de cuántos cobros hay y por cuánto', /1 cobro/.test(advertencia) && /400/.test(advertencia),
    advertencia.replace(/\n/g, ' ').slice(0, 150));
  ok('Y de que la hoja de cobranza de ese día dejará de contarlos',
    /hoja de cobranza/i.test(advertencia), advertencia.replace(/\n/g, ' ').slice(0, 150));
  ok('Ya no dice "quita primero esos cobros": ahora deja seguir',
    !/quita primero/i.test(advertencia), advertencia.replace(/\n/g, ' ').slice(0, 90));

  const pidioClave = await hayPin();
  ok('Antes de borrar pide el código de seguridad', pidioClave);
  const motivoPin = await p.evaluate(() => document.getElementById('pin-motivo').textContent.trim());
  ok('Y en el código recuerda el dinero que se va con ella', /400/.test(motivoPin), motivoPin.slice(0, 110));

  await responderPin('2468');

  const despues = await p.evaluate(() => ({
    notas: document.querySelectorAll('#nv-body tr').length,
    vacio: !!document.querySelector('#view-ventas .vacio, #view-ventas .empty'),
  }));
  ok('La nota desaparece de la lista', despues.notas === 0, JSON.stringify(despues));

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  const creditosQuedan = await p.evaluate(() => document.querySelectorAll('#table-body tr').length);
  ok('Su crédito se va con ella, sin tener que borrarlo aparte', creditosQuedan === 0, String(creditosQuedan));

  const stockVuelto = await stock();
  ok('Y la mercadería vuelve al almacén', stockVuelto === '100', stockVuelto);

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1000);
  const hojaDespues = await p.evaluate(() =>
    document.getElementById("cob-body").textContent.replace(/\s+/g, ' ').trim());
  ok('La hoja de cobranza de ese día ya no lo cuenta',
    !/400/.test(hojaDespues), hojaDespues.slice(0, 90) || 'hoja vacía');

  // ── 2) El panel lateral se recoge al retirar el cursor ──
  const anchoNav = () => p.evaluate(() =>
    Math.round(document.getElementById('nav-lateral').getBoundingClientRect().width));
  const plegado = () => p.evaluate(() => document.body.classList.contains('nav-plegada'));

  ok('De fábrica el panel viene contraído', await plegado());
  await p.mouse.move(700, 500);
  await p.waitForTimeout(500);
  const anchoRail = await anchoNav();
  ok('Contraído es un rail de iconos', anchoRail < 100, anchoRail + 'px');

  await p.mouse.move(30, 400);
  await p.waitForTimeout(500);
  const anchoAbierto = await anchoNav();
  ok('Al acercar el cursor se abre', anchoAbierto > 200, anchoAbierto + 'px');

  // Se elige un apartado CON EL RATÓN y el cursor se va al medio de la pantalla
  await p.click('#nav-productos');
  await p.waitForTimeout(500);
  await p.mouse.move(900, 500);
  await p.waitForTimeout(600);
  const anchoTrasElegir = await anchoNav();
  ok('Tras elegir una sección y retirar el cursor, se recoge solo',
    anchoTrasElegir < 100, anchoTrasElegir + 'px');
  const seccion = await p.evaluate(() => !document.getElementById('view-productos').hidden);
  ok('Y la sección elegida sí cambió', seccion);

  // Con el tabulador el foco SÍ lo mantiene abierto: es lo que guía ahí
  await p.evaluate(() => document.getElementById('nav-kardex').focus());
  await p.waitForTimeout(500);
  const anchoConFoco = await anchoNav();
  ok('Con el tabulador, en cambio, se queda abierto para poder leerlo',
    anchoConFoco > 200, anchoConFoco + 'px');
  await p.evaluate(() => document.activeElement.blur());
  await p.waitForTimeout(500);
  ok('Y se recoge al salir de él con el tabulador', (await anchoNav()) < 100);

  await p.screenshot({ path: 'pruebas/nav-recogida.png' });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
