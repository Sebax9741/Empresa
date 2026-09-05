const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 120)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1300);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── 1) Panel lateral: grupos, subtítulos e iconos de trazo ──
  const grupos = await p.$$eval('.nav-grupo', gs => gs.filter(g => !g.hidden).map(g => ({
    titulo: g.querySelector('.nav-titulo').textContent.trim(),
    items: Array.from(g.querySelectorAll('.nav-item')).filter(i => !i.hidden).map(i => i.textContent.trim()),
  })));
  ok('Los destinos van agrupados con subtítulo', grupos.length === 4,
    grupos.map(g => `${g.titulo}(${g.items.length})`).join(' · '));
  console.log('    ', JSON.stringify(grupos, null, 0).slice(0, 300));

  const iconos = await p.$$eval('.nav-item .nav-ico', ic => ({
    total: ic.length,
    svg: ic.every(i => i.tagName.toLowerCase() === 'svg'),
    trazo: ic.every(i => getComputedStyle(i).stroke !== 'none' && getComputedStyle(i).fill === 'none'),
  }));
  ok('Los iconos son SVG de trazo, sin color propio', iconos.svg && iconos.trazo,
    `${iconos.total} iconos`);

  // ── 2) El panel arranca contraído y se abre al acercar el cursor ──
  const medir = () => p.evaluate(() => ({
    nav: Math.round(document.getElementById('nav-lateral').getBoundingClientRect().width),
    body: Math.round(parseFloat(getComputedStyle(document.body).paddingLeft)),
    textos: Array.from(document.querySelectorAll('.nav-txt'))
      .filter(t => Number(getComputedStyle(t).opacity) > 0.5).length,
  }));
  const antes = await medir();
  ok('El panel arranca contraído: solo el rail de iconos',
    antes.nav < 80 && antes.textos === 0, JSON.stringify(antes));
  ok('Y el área de trabajo empieza tan ancha como puede', antes.body === antes.nav,
    `padding ${antes.body}px = ancho ${antes.nav}px`);
  await p.screenshot({ path: 'pruebas/nav-contraido.png' });

  // Acercar el cursor lo abre, POR ENCIMA: la página no se mueve
  await p.hover('#nav-lateral');
  await p.waitForTimeout(600);
  const abierto = await medir();
  ok('Al acercar el cursor se abre y se leen las secciones',
    abierto.nav > 240 && abierto.textos >= 9, JSON.stringify(abierto));
  ok('Pero la página NO se mueve: se abre por encima', abierto.body === antes.body,
    `padding sigue en ${abierto.body}px`);
  await p.screenshot({ path: 'pruebas/nav-al-pasar.png' });

  // Y al retirarlo vuelve a su sitio
  await p.mouse.move(1200, 500);
  await p.waitForTimeout(600);
  const retirado = await medir();
  ok('Al retirar el cursor se vuelve a cerrar solo',
    retirado.nav < 80 && retirado.textos === 0, JSON.stringify(retirado));

  const transicion = await p.evaluate(() => ({
    nav: getComputedStyle(document.getElementById('nav-lateral')).transitionProperty,
    txt: getComputedStyle(document.querySelector('.nav-txt')).transitionProperty,
  }));
  ok('El cambio es fluido: ancho y texto van con transición',
    /width/.test(transicion.nav) && /opacity/.test(transicion.txt), JSON.stringify(transicion));

  // Quien lo quiera fijo abierto, lo fija; y se recuerda
  await p.evaluate(() => document.getElementById('btn-plegar-nav').click());
  await p.waitForTimeout(500);
  const fijado = await medir();
  ok('Se puede dejar fijo abierto, y entonces sí ensancha el panel',
    fijado.nav > 240 && fijado.body === fijado.nav, JSON.stringify(fijado));
  await p.reload();
  await p.waitForTimeout(1300);
  const trasRecargar = await p.evaluate(() => !document.body.classList.contains('nav-plegada'));
  ok('Recuerda que lo dejaste fijo', trasRecargar);
  await p.evaluate(() => document.getElementById('btn-plegar-nav').click());
  await p.waitForTimeout(500);

  // El ☰ de la cabecera hace lo mismo
  await p.evaluate(() => document.getElementById('btn-menu').click());
  await p.waitForTimeout(450);
  const trasMenu = await p.evaluate(() => ({
    plegada: document.body.classList.contains('nav-plegada'),
    ancho: Math.round(document.getElementById('nav-lateral').getBoundingClientRect().width),
  }));
  ok('El botón ☰ de la cabecera lo despliega', !trasMenu.plegada && trasMenu.ancho > 240, JSON.stringify(trasMenu));

  // ── 3) Borrado de movimientos: admin + clave ──
  // Se pone un código de seguridad, como el que ya usa la app
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const c = document.getElementById('s-pin-nuevo');
    if (c) c.value = '1234';
  });
  const hayPin = await p.evaluate(() => !!document.getElementById('s-pin-nuevo'));
  if (hayPin) {
    await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
    await p.waitForTimeout(900);
  }
  ok('Se pudo configurar el código de seguridad', hayPin);

  // Producto + ingreso por factura
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(400);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.fill('#prod-precio-a', '128');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(700);

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
  await p.fill('#ing-doc-numero', 'F001-9001');
  await p.fill('#ing-proveedor', 'Distribuidora Ramos');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1100);

  const hayBotonBorrar = await p.evaluate(() => !!document.querySelector('[data-borrar-lote]'));
  ok('El administrador ve el botón para anular el ingreso', hayBotonBorrar);

  // Al anular: primero confirma, luego pide la clave
  p.on('dialog', d => d.accept());
  await p.evaluate(() => document.querySelector('[data-borrar-lote]').click());
  await p.waitForTimeout(800);
  const pinAbierto = await p.evaluate(() => {
    const d = document.getElementById('modal-pin');
    return { abierto: d.open, motivo: document.getElementById('pin-motivo').textContent.trim() };
  });
  ok('Anular un ingreso pide el código de seguridad', pinAbierto.abierto, pinAbierto.motivo.slice(0, 70));

  // Con la clave incorrecta no se borra
  await p.fill('#pin-input', '9999');
  await p.evaluate(() => document.getElementById('btn-pin-ok').click());
  await p.waitForTimeout(700);
  const sigueAhi = await p.evaluate(async () => (await DB.getAllKardex()).length);
  ok('Con el código equivocado NO se borra', sigueAhi === 1, `movimientos: ${sigueAhi}`);

  // Con la clave correcta sí
  await p.fill('#pin-input', '1234');
  await p.evaluate(() => document.getElementById('btn-pin-ok').click());
  await p.waitForTimeout(1200);
  const trasBorrar = await p.evaluate(async () => ({
    kardex: (await DB.getAllKardex()).length,
    grupos: document.querySelectorAll('.ing-grupo').length,
  }));
  ok('Con el código correcto se anula el ingreso completo',
    trasBorrar.kardex === 0 && trasBorrar.grupos === 0, JSON.stringify(trasBorrar));

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(500);
  // La columna se busca por su título y no por su número: contarlas a mano es
  // lo que rompió esta prueba al añadir la del flete.
  const stock = await p.evaluate(() => {
    const cabeceras = [...document.querySelectorAll('#prod-tabla thead th')];
    const i = cabeceras.findIndex(th => /stock/i.test(th.textContent));
    const fila = document.querySelector('#prod-body tr');
    return fila && i >= 0 ? fila.cells[i].textContent.trim() : '';
  });
  ok('El stock vuelve a 0 al anular', /^0/.test(stock), stock);

  await p.screenshot({ path: 'pruebas/nav-grupos.png' });
  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
