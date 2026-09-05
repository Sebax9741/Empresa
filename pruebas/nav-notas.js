const { chromium } = require('playwright-core');

/* "Anterior / Siguiente" al modificar una nota de venta: se mueve por
   NÚMERO de boleta, no por fecha de creación. "Anterior" = un número menos,
   "Siguiente" = un número más. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  const avisos = [];
  p.on('dialog', d => { avisos.push(d.message()); d.accept(); });
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

  // Tres notas: 1 (más vieja), 2, 3 (más nueva)
  await nota(1);
  await nota(2);
  await nota(3);

  // ── El botón no aparece al CREAR, solo al MODIFICAR ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  ok('Al crear una nota nueva, no sale "Anterior / Siguiente"',
    await p.evaluate(() => document.getElementById('nv-cab-nav').hidden));
  await p.evaluate(() => document.getElementById('btn-nv-cancelar').click());
  await p.waitForTimeout(400);

  // ── Abrir la del medio (la nota "2") para editar ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  const filas = await p.evaluate(() => [...document.querySelectorAll('#nv-body tr')]
    .map(f => f.querySelector('.nv-num strong').textContent.trim()));
  const numMedio = filas[1];   // recientes primero: [3, 2, 1] → el del medio es "2"
  await p.evaluate(n => {
    const fila = [...document.querySelectorAll('#nv-body tr')].find(f => f.querySelector('.nv-num strong').textContent.trim() === n);
    fila.querySelector('[data-editar-nota]').click();
  }, numMedio);
  await p.waitForTimeout(700);

  const alAbrir = await p.evaluate(() => ({
    visible: !document.getElementById('nv-cab-nav').hidden,
    anteriorDeshabilitado: document.getElementById('btn-nv-anterior').disabled,
    siguienteDeshabilitado: document.getElementById('btn-nv-siguiente').disabled,
    numero: document.getElementById('nv-correlativo').value,
  }));
  ok('Al modificar, aparece "Anterior / Siguiente" y ninguno está en la punta',
    alAbrir.visible && !alAbrir.anteriorDeshabilitado && !alAbrir.siguienteDeshabilitado,
    JSON.stringify(alAbrir));

  // ── "Anterior" lleva al número más bajo (la "1") ──
  await p.evaluate(() => document.getElementById('btn-nv-anterior').click());
  await p.waitForTimeout(700);
  const trasAnterior = await p.evaluate(() => ({
    numero: document.getElementById('nv-correlativo').value,
    anteriorDeshabilitado: document.getElementById('btn-nv-anterior').disabled,
  }));
  ok('"Anterior" abre el número más bajo, y ahí "Anterior" ya no tiene a dónde ir',
    trasAnterior.numero === filas[2] && trasAnterior.anteriorDeshabilitado, JSON.stringify(trasAnterior));

  // Un paso más allá: avisa, no rompe nada
  await p.evaluate(() => document.getElementById('btn-nv-anterior').click());
  await p.waitForTimeout(300);
  ok('Y si igual se presiona, solo avisa (sigue en la misma nota)',
    /más bajo/i.test(avisos.join(' ')) || (await p.evaluate(() => document.getElementById('nv-correlativo').value)) === filas[2]);

  // ── "Siguiente" dos veces: vuelve a la "2" y sigue hasta la "3" ──
  await p.evaluate(() => document.getElementById('btn-nv-siguiente').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-nv-siguiente').click());
  await p.waitForTimeout(700);
  const trasDosSiguiente = await p.evaluate(() => ({
    numero: document.getElementById('nv-correlativo').value,
    siguienteDeshabilitado: document.getElementById('btn-nv-siguiente').disabled,
  }));
  ok('Dos "Siguiente" desde la del medio llegan al número más alto, y ahí ya no hay más',
    trasDosSiguiente.numero === filas[0] && trasDosSiguiente.siguienteDeshabilitado,
    JSON.stringify(trasDosSiguiente));

  // ── Ahora el caso pedido: la vecina NO se puede editar → enseña su despacho ──
  // Se manda la nota "2" (la del medio) a reparto.
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(700);
  await p.evaluate(n => {
    const fila = [...document.querySelectorAll('#desp-notas-lista .desp-nota')]
      .find(f => f.querySelector('.desp-nota-num').textContent.trim() === n);
    if (fila) fila.querySelector('[data-elegir-nota]').click();
  }, numMedio);
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1400);


  // Volver a modificar la nota "3" (número más alto) y presionar "Anterior" → llega a la "2", que ya está en reparto
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  const estadoNota2 = await p.evaluate(n => {
    const fila = [...document.querySelectorAll('#nv-body tr')].find(f => f.querySelector('.nv-num strong').textContent.trim() === n);
    return fila ? fila.querySelector('.ped-chip').textContent.trim() : 'NO ENCONTRADA';
  }, numMedio);
  await p.evaluate(n => {
    const fila = [...document.querySelectorAll('#nv-body tr')].find(f => f.querySelector('.nv-num strong').textContent.trim() === n);
    fila.querySelector('[data-editar-nota]').click();
  }, filas[0]);
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-nv-anterior').click());
  await p.waitForTimeout(900);

  // La nota "2" ya está en reparto, así que no se abre para editar: en vez
  // de eso se enseña su información en solo lectura, con Anterior/Siguiente
  // disponibles ahí también para seguir moviéndose.
  const trasVecinaNoEditable = await p.evaluate(() => ({
    titulo: document.getElementById('nv-form-titulo').textContent.trim(),
    navVisible: !document.getElementById('nv-cab-nav').hidden,
    guardarOculto: document.getElementById('btn-nv-guardar').hidden,
  }));
  ok('Si la vecina ya no se puede editar, se abre su información en solo lectura, con Anterior/Siguiente',
    /solo lectura/i.test(trasVecinaNoEditable.titulo) && trasVecinaNoEditable.navVisible
      && trasVecinaNoEditable.guardarOculto,
    JSON.stringify(trasVecinaNoEditable));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
