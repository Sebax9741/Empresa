const { chromium } = require('playwright-core');

/* Smoke rápido (modo local, sin nube):
   · No queda el botón "＋ Nuevo crédito" en ningún lado.
   · Al editar un crédito ya existente, boleta / cliente / fecha de emisión /
     fecha de despacho quedan bloqueados; el resto sigue editable. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

  ok('El botón "＋ Nuevo crédito" ya no existe', await p.evaluate(() => !document.getElementById('btn-new')));

  // Cliente, producto, ingreso y una nota (que trae su crédito de nacimiento)
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
  await p.fill('#ing-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(800);
  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(350);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(300);
  await p.fill('#nv-cantidad', '5');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1500);

  // Abrir el crédito recién nacido para EDITARLO
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#table-body [data-editar]').click());
  await p.waitForTimeout(700);

  const estado = await p.evaluate(() => ({
    titulo: document.getElementById('form-title').textContent.trim(),
    boleta: document.getElementById('f-boleta').disabled,
    cliente: document.getElementById('f-cliente-buscar').disabled,
    nuevoCliente: document.getElementById('btn-cliente-nuevo').disabled,
    fecha: document.getElementById('f-fecha').disabled,
    fechaDespacho: document.getElementById('f-fecha-despacho').disabled,
    monto: document.getElementById('f-monto').disabled,
    vencimiento: document.getElementById('f-vencimiento').disabled,
    notas: document.getElementById('f-notas').disabled,
  }));
  ok('Al editar: boleta, cliente y sus dos fechas quedan bloqueados',
    estado.boleta && estado.cliente && estado.nuevoCliente && estado.fecha && estado.fechaDespacho,
    JSON.stringify(estado));
  ok('El resto sigue editable (monto, vencimiento, notas)',
    !estado.monto && !estado.vencimiento && !estado.notas, JSON.stringify(estado));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
