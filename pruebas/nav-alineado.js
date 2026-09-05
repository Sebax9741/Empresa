const { chromium } = require('playwright-core');

/* "Anterior / Siguiente" tiene que caer en el MISMO sitio, se pueda editar la
   nota o se esté viendo en solo lectura (donde además sale el atajo al
   crédito o al despacho, ahora debajo de "Volver a la lista"). */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1200);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(350);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(700);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'HARINA X50KG');
  await p.fill('#prod-precio-a', '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-cantidad', '50');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);

  const nota = async cantidad => {
    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(700);
    await p.fill('#nv-cliente-buscar', 'BODEGA');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-buscar-producto', 'HARINA');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', String(cantidad));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1300);
  };
  await nota(1);
  await nota(2);

  // Una de las dos se va a reparto: esa ya solo se puede ver
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('#desp-notas-lista [data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1400);

  const medir = () => p.evaluate(() => {
    const r = id => { const c = document.getElementById(id).getBoundingClientRect();
      return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width) }; };
    const seguir = document.getElementById('btn-nv-solo-seguir');
    return { anterior: r('btn-nv-anterior'), siguiente: r('btn-nv-siguiente'), volver: r('btn-nv-volver'),
      seguirVisible: !seguir.hidden, seguir: seguir.hidden ? null : r('btn-nv-solo-seguir'),
      seguirTexto: seguir.textContent.trim() };
  });

  // ── Editando ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(800);
  const editando = await medir();
  await p.evaluate(() => document.getElementById('btn-nv-cancelar').click());
  await p.waitForTimeout(600);

  // ── Solo lectura ──
  await p.evaluate(() => document.querySelector('[data-nota-info]').click());
  await p.waitForTimeout(800);
  const leyendo = await medir();

  ok('"Anterior" cae en el mismo sitio y mide lo mismo en los dos casos',
    editando.anterior.x === leyendo.anterior.x && editando.anterior.w === leyendo.anterior.w,
    JSON.stringify({ editando: editando.anterior, leyendo: leyendo.anterior }));
  ok('"Siguiente" también',
    editando.siguiente.x === leyendo.siguiente.x && editando.siguiente.w === leyendo.siguiente.w,
    JSON.stringify({ editando: editando.siguiente, leyendo: leyendo.siguiente }));
  ok('"Volver a la lista" no se movió',
    editando.volver.x === leyendo.volver.x && editando.volver.w === leyendo.volver.w,
    JSON.stringify({ editando: editando.volver, leyendo: leyendo.volver }));
  ok('El atajo al crédito/despacho está DEBAJO de "Volver a la lista" y del mismo ancho',
    leyendo.seguirVisible && leyendo.seguir.y > leyendo.volver.y
      && leyendo.seguir.x === leyendo.volver.x && leyendo.seguir.w === leyendo.volver.w,
    JSON.stringify({ volver: leyendo.volver, seguir: leyendo.seguir, texto: leyendo.seguirTexto }));

  await p.screenshot({ path: 'pruebas/nav-alineado-lectura.png', clip: { x: 0, y: 0, width: 1500, height: 260 } });
  await p.evaluate(() => document.getElementById('btn-nv-cancelar').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'pruebas/nav-alineado-edicion.png', clip: { x: 0, y: 0, width: 1500, height: 260 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
