const { chromium } = require('playwright-core');

/* El botón ℹ️ (antes 🔗) de Notas de venta: enseña la misma pantalla que
   "Modificando nota", pero congelada — nada que tocar, nada que guardar. */
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

  // Cliente + producto + repartidor
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
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-cantidad', '20');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(700);

  // Una nota de 5 unidades
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
  await p.fill('#nv-cantidad', '5');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1500);

  // ── 1) En "Por despachar" no hay botón ℹ️ (nada aún que seguir) ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  const sinInfoAun = await p.evaluate(() => !document.querySelector('[data-nota-info]'));
  ok('Antes de despachar, todavía no sale el botón ℹ️', sinInfoAun);

  // Mandarla a reparto
  await p.evaluate(() => document.getElementById('nav-despachos').click());
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

  // ── 2) Ahora sí sale ℹ️ y ya no sale 🔗 ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  const botones = await p.evaluate(() => ({
    hayInfo: !!document.querySelector('[data-nota-info]'),
    haySeguir: !!document.querySelector('[data-seguir-nota]'),
    tituloBoton: document.querySelector('[data-nota-info]').title,
  }));
  ok('En reparto sale el botón ℹ️, y ya no queda ningún 🔗 en la lista',
    botones.hayInfo && !botones.haySeguir, JSON.stringify(botones));

  // ── 3) Al abrirlo: misma pantalla que "Modificando", pero congelada ──
  await p.evaluate(() => document.querySelector('[data-nota-info]').click());
  await p.waitForTimeout(700);
  const vista = await p.evaluate(() => ({
    formVisible: !document.getElementById('nv-vista-form').hidden,
    titulo: document.getElementById('nv-form-titulo').textContent.trim(),
    cliente: document.getElementById('nv-cliente-buscar').value,
    clienteDisabled: document.getElementById('nv-cliente-buscar').disabled,
    condicionDisabled: document.getElementById('nv-condicion').disabled,
    hayAgregar: !document.getElementById('btn-nv-agregar').hidden,
    hayGuardar: !document.getElementById('btn-nv-guardar').hidden,
    hayGuardarImprimir: !document.getElementById('btn-nv-guardar-imprimir').hidden,
    navAnteriorVisible: !document.getElementById('nv-cab-nav').hidden,
    filaTexto: document.querySelector('#nv-items-body tr').textContent.replace(/\s+/g, ' ').trim(),
    hayInputEnFila: !!document.querySelector('#nv-items-body input'),
    hayBotonQuitar: !!document.querySelector('[data-nv-quitar]'),
    seguirVisible: !document.getElementById('btn-nv-solo-seguir').hidden,
    cerrarTexto: document.getElementById('btn-nv-cancelar').textContent.trim(),
  }));
  ok('Se abre la misma pantalla ("solo lectura" en el título) con los datos de la nota',
    vista.formVisible && /solo lectura/i.test(vista.titulo) && /BODEGA/i.test(vista.cliente),
    JSON.stringify({ titulo: vista.titulo, cliente: vista.cliente }));
  ok('Todo bloqueado: cliente y condición deshabilitados, sin agregar ni guardar',
    vista.clienteDisabled && vista.condicionDisabled && !vista.hayAgregar && !vista.hayGuardar
      && !vista.hayGuardarImprimir,
    JSON.stringify(vista));
  // Anterior/Siguiente sí se queda: desde aquí se sigue pasando de una nota a
  // la vecina (a modificarla si se puede, o a su información si no).
  ok('Anterior/Siguiente sigue disponible para pasar a la nota vecina',
    vista.navAnteriorVisible, JSON.stringify({ navAnteriorVisible: vista.navAnteriorVisible }));
  ok('La fila del producto se ve, pero sin cuadros para escribir ni botón de quitar',
    /HARINA X50KG/.test(vista.filaTexto) && !vista.hayInputEnFila && !vista.hayBotonQuitar,
    vista.filaTexto);
  ok('Y como esta nota SÍ tiene despacho, aparece el atajo para verlo',
    vista.seguirVisible, JSON.stringify(vista));
  ok('El botón para salir dice "Cerrar", no "Cancelar"', /Cerrar/i.test(vista.cerrarTexto), vista.cerrarTexto);

  // Cerrar no debe pedir confirmación (no se tocó nada)
  await p.evaluate(() => document.getElementById('btn-nv-cancelar').click());
  await p.waitForTimeout(500);
  const cerrado = await p.evaluate(() => !document.getElementById('nv-vista-lista').hidden);
  ok('"Cerrar" vuelve a la lista sin pedir confirmación (no había nada que descartar)', cerrado);

  await p.evaluate(() => document.querySelector('[data-nota-info]').click());
  await new Promise(r => setTimeout(r, 700));
  await p.screenshot({ path: 'pruebas/nota-info.png', clip: { x: 0, y: 0, width: 1500, height: 700 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
