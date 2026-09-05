const { chromium } = require('playwright-core');

/* Regresión: que lo de antes siga funcionando tras rehacer Ingreso de productos
   y cambiar el formato de la hora. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 120)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1200);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // Cliente A + producto con stock, vía la sección de ingresos
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(350);
  await p.fill('#cli-nombre', 'ELVA');
  await p.selectOption('#cli-zona', 'PADRE ALDAMIZ');
  await p.fill('#cli-ruc', '02541654654');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(600);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.selectOption('#prod-presentacion', 'saco');
  await p.fill('#prod-precio-a', '128');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);

  // La mercadería entra por su sección: el botón 📥 de Productos ya no existe
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '40');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);
  ok('El botón 📥 del producto lleva al ingreso con ese producto ya elegido y suma stock',
    (await p.$$eval('.ing-grupo', g => g.length)) === 1);

  // Nota de venta: precio A y descuento de almacén
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(500);
  await p.fill('#nv-cliente-buscar', 'ELVA');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(400);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(300);
  await p.fill('#nv-cantidad', '2');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  const pu = await p.$eval('[data-nv-precio="0"]', i => i.value);
  const total = await p.textContent('#nv-total');
  const letras = await p.textContent('#nv-letras');
  ok('La nota de venta sigue cobrando el precio A', pu === '128.00', 'P.U. ' + pu);
  ok('Total e importe en letras correctos', total === '256.00' && /DOSCIENTOS CINCUENTA Y SEIS/.test(letras),
    `${total} · ${letras}`);
  const hora = await p.textContent('#nv-hora');
  ok('La hora de creación de la nota lleva a. m. / p. m.', /[ap]\. m\./.test(hora), hora);

  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1200);
  const stock = await p.evaluate(async () => {
    const ks = await DB.getAllKardex();
    return ks.reduce((s, m) => s + (m.tipo === 'salida' ? -m.cantidad : m.cantidad), 0);
  });
  ok('La venta descontó del almacén (40 - 2 = 38)', stock === 38, String(stock));

  // El Kardex ve ambos movimientos
  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(500);
  const kdx = await p.$$eval('#kdx-body tr', r => r.length);
  ok('El Kardex muestra la entrada y la salida', kdx === 2, String(kdx));

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
