const { chromium } = require('playwright-core');

/* "Anterior / Siguiente" en la ficha del crédito (modal-info): se mueve por
   número de boleta, igual que en "Modificando nota". */
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

  // Tres notas → tres créditos: boletas 1, 2, 3
  await nota(1);
  await nota(2);
  await nota(3);

  // Abrir el crédito "2" (el del medio)
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  // Se abre por boleta: busca la fila cuyo primer <td> dice "2"
  await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#table-body tr')];
    const fila = filas.find(f => f.querySelector('td').textContent.trim() === '2');
    fila.querySelector('[data-info]').click();
  });
  await p.waitForTimeout(700);

  const alAbrir = await p.evaluate(() => ({
    abierto: document.getElementById('modal-info').open,
    sub: document.getElementById('info-sub').textContent.trim(),
    anteriorDeshabilitado: document.getElementById('btn-info-anterior').disabled,
    siguienteDeshabilitado: document.getElementById('btn-info-siguiente').disabled,
  }));
  ok('La ficha trae "Anterior / Siguiente", ninguno en la punta al abrir la boleta 2',
    alAbrir.abierto && /2/.test(alAbrir.sub) && !alAbrir.anteriorDeshabilitado && !alAbrir.siguienteDeshabilitado,
    JSON.stringify(alAbrir));

  await p.evaluate(() => document.getElementById('btn-info-anterior').click());
  await p.waitForTimeout(500);
  const trasAnterior = await p.evaluate(() => ({
    sub: document.getElementById('info-sub').textContent.trim(),
    anteriorDeshabilitado: document.getElementById('btn-info-anterior').disabled,
  }));
  ok('"Anterior" lleva a la boleta 1 (un número menos), y ahí ya no hay más',
    /Nº 1 /.test(trasAnterior.sub) && trasAnterior.anteriorDeshabilitado, JSON.stringify(trasAnterior));

  await p.evaluate(() => document.getElementById('btn-info-siguiente').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-info-siguiente').click());
  await p.waitForTimeout(500);
  const trasDosSiguiente = await p.evaluate(() => ({
    sub: document.getElementById('info-sub').textContent.trim(),
    siguienteDeshabilitado: document.getElementById('btn-info-siguiente').disabled,
  }));
  ok('Dos "Siguiente" desde la 1 llegan a la boleta 3, la más alta',
    /Nº 3 /.test(trasDosSiguiente.sub) && trasDosSiguiente.siguienteDeshabilitado,
    JSON.stringify(trasDosSiguiente));

  await p.screenshot({ path: 'pruebas/nav-credito.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-info').getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: Math.min(r.height + 16, 700) };
  }) });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
