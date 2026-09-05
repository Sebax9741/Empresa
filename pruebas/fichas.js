const { chromium } = require('playwright-core');

/* Las dos ventanas grandes en PC: la ficha del crédito se adapta a lo que hay
   (sin foto, ya pagado) sin dejar huecos, y editar un crédito cabe entero. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const nuevoCliente = async (nombre, zona) => {
    await p.evaluate(() => document.getElementById('nav-clientes').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
    await p.waitForTimeout(400);
    await p.fill('#cli-nombre', nombre);
    await p.selectOption('#cli-zona', zona);
    await p.selectOption('#cli-categoria', 'B');
    await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
    await p.waitForTimeout(800);
    await p.evaluate(() => document.getElementById('nav-inicio').click());
    await p.waitForTimeout(500);
  };

  // Ya no hay botón para crear un crédito suelto: nace de una nota de venta.
  // Se crea un producto de un solo uso al precio exacto del monto que pide
  // cada escenario, y una nota de 1 unidad con el número de boleta deseado.
  const crear = async (boleta, cliente, monto) => {
    const prod = `PROD ${boleta}`;
    await p.evaluate(() => document.getElementById('nav-productos').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(350);
    await p.fill('#prod-nombre', prod);
    for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, String(monto));
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(600);
    await p.evaluate(() => document.getElementById('nav-ingresos').click());
    await p.waitForTimeout(600);
    await p.fill('#ing-buscar', prod);
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(300);
    await p.fill('#ing-cantidad', '1');
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(300);
    await p.fill('#ing-doc-numero', 'F' + boleta);
    await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
    await p.waitForTimeout(900);

    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(700);
    await p.fill('#nv-correlativo', boleta);
    await p.waitForTimeout(300);
    await p.fill('#nv-cliente-buscar', cliente);
    await p.waitForTimeout(450);
    await p.evaluate(() => {
      const op = document.querySelector('[data-nv-cliente]');
      if (op) op.click();
    });
    await p.waitForTimeout(300);
    await p.fill('#nv-buscar-producto', prod);
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', '1');
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.getElementById('nav-inicio').click());
    await p.waitForTimeout(500);
  };

  await nuevoCliente('Gisela', '3 DE MAYO');

  // ── 1) Editar un crédito: cabe entero, sin rueda ──
  await crear('4140', 'Gisela', '724');
  await p.evaluate(() => document.querySelector('[data-editar]').click());
  await p.waitForTimeout(700);
  const editar = await p.evaluate(() => {
    const d = document.getElementById('modal-form');
    const cuerpo = document.querySelector('#credit-form .form-cuerpo');
    return {
      ancho: Math.round(d.getBoundingClientRect().width),
      columnas: getComputedStyle(cuerpo).gridTemplateColumns.split(' ').length,
      // Si no hay que desplazarse, el contenido cabe en la ventana
      alto: d.scrollHeight, visible: Math.round(d.clientHeight),
    };
  });
  ok('Editar un crédito se abre ancho y a dos columnas',
    editar.ancho >= 1000 && editar.columnas === 2, JSON.stringify(editar));
  ok('Y cabe entero, sin tener que bajar con la rueda',
    editar.alto <= editar.visible + 2, `contenido ${editar.alto}px en ${editar.visible}px`);
  await p.screenshot({ path: 'pruebas/editar-credito.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-form').getBoundingClientRect();
    return { x: r.x - 6, y: Math.max(0, r.y - 6), width: r.width + 12, height: Math.min(r.height + 12, 1000) };
  }) });
  await p.evaluate(() => document.getElementById('btn-cancelar').click());
  await p.waitForTimeout(500);

  // ── 2) Ficha sin foto y con deuda: dos zonas, no tres ──
  await p.evaluate(() => document.querySelector('[data-info]').click());
  await p.waitForTimeout(700);
  const sinFoto = await p.evaluate(() => {
    const d = document.getElementById('modal-info');
    const zonas = getComputedStyle(document.querySelector('.info-cuerpo')).gridTemplateAreas;
    return { clases: d.className, zonas, ancho: Math.round(d.getBoundingClientRect().width),
      fotoVisible: getComputedStyle(document.querySelector('.info-col-foto')).display !== 'none',
      cobroVisible: getComputedStyle(document.querySelector('.info-col-cobro')).display !== 'none' };
  });
  ok('La ficha usa todo su ancho, no se queda en la ventana estándar',
    sinFoto.ancho >= 900, sinFoto.ancho + 'px');
  ok('Sin foto, la ficha no reserva su columna',
    /sin-foto/.test(sinFoto.clases) && !sinFoto.fotoVisible && sinFoto.cobroVisible
      && /datos cobro/.test(sinFoto.zonas), JSON.stringify(sinFoto));
  await p.screenshot({ path: 'pruebas/ficha-sin-foto.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-info').getBoundingClientRect();
    return { x: r.x - 6, y: Math.max(0, r.y - 6), width: r.width + 12, height: Math.min(r.height + 12, 1000) };
  }) });

  // ── 3) Ya pagado y sin foto: una sola columna y ficha estrecha ──
  await p.fill('#cobro-monto', '724');
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
  await p.waitForTimeout(1500);
  const pagado = await p.evaluate(() => {
    const d = document.getElementById('modal-info');
    return { clases: d.className, ancho: Math.round(d.getBoundingClientRect().width),
      zonas: getComputedStyle(document.querySelector('.info-cuerpo')).gridTemplateAreas,
      estado: (document.getElementById('info-estado') || {}).textContent };
  });
  ok('Ya pagado y sin foto, la ficha se estrecha a una sola columna',
    /sin-cobro/.test(pagado.clases) && /sin-foto/.test(pagado.clases)
      && pagado.ancho <= 600 && /^"?datos"?$/.test(pagado.zonas.trim()),
    JSON.stringify(pagado));
  await p.screenshot({ path: 'pruebas/ficha-pagada.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-info').getBoundingClientRect();
    return { x: r.x - 6, y: Math.max(0, r.y - 6), width: r.width + 12, height: Math.min(r.height + 12, 1000) };
  }) });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
