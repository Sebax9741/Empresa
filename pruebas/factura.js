const { chromium } = require('playwright-core');

/* Corregir una factura que YA entró al almacén. Hasta ahora solo se podía
   anular entera y volver a escribirla; una cantidad mal anotada obligaba a
   rehacer todo el comprobante. Lo que se comprueba aquí es que se abre en el
   mismo formulario, que pide el código, y —lo importante— que el stock queda
   recalculado: ni de más ni de menos. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' });
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

  const responderPin = async codigo => {
    if (!await p.evaluate(() => document.getElementById('modal-pin').open)) return false;
    await p.fill('#pin-input', codigo);
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
    await p.waitForTimeout(900);
    return true;
  };
  const stock = async nombre => p.evaluate(n => {
    document.getElementById('nav-productos').click();
    const fila = [...document.querySelectorAll('#prod-body tr')].find(t => t.textContent.includes(n));
    return fila ? fila.querySelectorAll('td')[6].textContent.trim().replace(' ⚠️', '') : '';
  }, nombre);
  const irAIngresos = async () => {
    await p.evaluate(() => document.getElementById('nav-ingresos').click());
    await p.waitForTimeout(700);
  };
  const agregarLinea = async (busca, cantidad) => {
    await p.fill('#ing-buscar', busca);
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(350);
    await p.fill('#ing-cantidad', String(cantidad));
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(400);
  };

  // Código de seguridad
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(600);
  await p.fill('#s-pin-nuevo', '1234');
  await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
  await p.waitForTimeout(900);

  // Dos productos
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(500);
  for (const [n, a] of [['HARINA ITALIANA X50KG', '128'], ['ACEITE PRIMOR BALDE 20L', '210']]) {
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(400);
    await p.fill('#prod-nombre', n);
    for (const l of ['a', 'b', 'c']) await p.fill(`#prod-precio-${l}`, a);
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(700);
  }

  // Una factura con un solo producto
  await irAIngresos();
  await agregarLinea('HARINA', 40);
  await p.fill('#ing-doc-numero', 'F001-9001');
  await p.fill('#ing-proveedor', 'Distribuidora Ramos');
  await p.fill('#ing-nota', 'llegó completo');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1300);
  ok('(preparación) la factura entró y cargó el stock', await stock('HARINA') === '40');

  // ── 1) El botón de corregir ──
  await irAIngresos();
  const botones = await p.evaluate(() => ({
    editar: !!document.querySelector('[data-editar-lote]'),
    borrar: !!document.querySelector('[data-borrar-lote]'),
  }));
  ok('Cada factura ofrece corregirla, además de anularla',
    botones.editar && botones.borrar, JSON.stringify(botones));

  // ── 2) Pide el código, como anularla ──
  await p.evaluate(() => document.querySelector('[data-editar-lote]').click());
  await p.waitForTimeout(800);
  const pin = await p.evaluate(() => ({
    abierto: document.getElementById('modal-pin').open,
    motivo: document.getElementById('pin-motivo').textContent.trim(),
  }));
  ok('Corregir una factura pide el código de seguridad', pin.abierto, pin.motivo.slice(0, 70));

  await responderPin('9999');
  ok('Con el código equivocado no se abre para corregir',
    await p.evaluate(() => document.getElementById('ing-editando').hidden));

  // ── 3) Con el código bueno, la factura se abre tal cual estaba ──
  await p.evaluate(() => document.querySelector('[data-editar-lote]').click());
  await p.waitForTimeout(700);
  await responderPin('1234');
  const cargada = await p.evaluate(() => ({
    aviso: !document.getElementById('ing-editando').hidden,
    tipo: document.getElementById('ing-doc-tipo').value,
    numero: document.getElementById('ing-doc-numero').value,
    proveedor: document.getElementById('ing-proveedor').value,
    nota: document.getElementById('ing-nota').value,
    lineas: document.querySelectorAll('#ing-lista-body tr').length,
    cantidad: (document.querySelector('[data-ing-cant]') || {}).value,
    boton: document.getElementById('btn-ing-guardar').textContent.trim(),
  }));
  ok('Se abre en el mismo formulario, con todo lo que tenía',
    cargada.tipo === 'factura' && cargada.numero === 'F001-9001'
      && cargada.proveedor === 'Distribuidora Ramos' && cargada.nota === 'llegó completo'
      && cargada.lineas === 1 && cargada.cantidad === '40',
    JSON.stringify(cargada));
  ok('Y avisa de que se está corrigiendo, no registrando algo nuevo',
    cargada.aviso && /Guardar cambios/.test(cargada.boton), cargada.boton);

  // ── 4) Se corrige: menos cantidad, un producto más y otro número ──
  await p.evaluate(() => {
    const c = document.querySelector('[data-ing-cant]');
    c.value = '25';
    c.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  await agregarLinea('ACEITE', 10);
  await p.fill('#ing-doc-numero', 'F001-9002');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1600);

  ok('La cantidad corregida se refleja en el stock', await stock('HARINA') === '25',
    `salió ${await stock('HARINA')}, esperado 25`);
  ok('Y el producto agregado entra con su stock', await stock('ACEITE') === '10',
    `salió ${await stock('ACEITE')}, esperado 10`);

  await irAIngresos();
  const historial = await p.evaluate(() => {
    const grupos = [...document.querySelectorAll('.ing-grupo')];
    return {
      cuantos: grupos.length,
      titulo: grupos[0] ? grupos[0].querySelector('strong').textContent.trim() : '',
      productos: grupos[0] ? grupos[0].querySelectorAll('.ing-grupo-tabla tr').length : 0,
    };
  });
  ok('Sigue siendo UNA factura, no dos: se corrigió, no se duplicó',
    historial.cuantos === 1 && historial.productos === 2,
    `${historial.cuantos} registro(s) · ${historial.productos} producto(s)`);
  ok('Con el número de documento ya corregido',
    /F001-9002/.test(historial.titulo), historial.titulo);

  const formLimpio = await p.evaluate(() => ({
    aviso: document.getElementById('ing-editando').hidden,
    boton: document.getElementById('btn-ing-guardar').textContent.trim(),
    lineas: document.querySelectorAll('#ing-lista-body tr').length,
  }));
  ok('Al guardar, el formulario vuelve a estar listo para una factura nueva',
    formLimpio.aviso && /Agregar stock/.test(formLimpio.boton) && formLimpio.lineas === 0,
    JSON.stringify(formLimpio));

  // ── 5) Quitar un producto de la factura lo saca del almacén ──
  await p.evaluate(() => document.querySelector('[data-editar-lote]').click());
  await p.waitForTimeout(700);
  await responderPin('1234');
  await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#ing-lista-body tr')];
    const fila = filas.find(t => t.textContent.includes('ACEITE')) || filas[1];
    fila.querySelector('[data-ing-quitar]').click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1600);
  ok('Quitar un producto de la factura le devuelve su stock a cero',
    await stock('ACEITE') === '0', `salió ${await stock('ACEITE')}`);
  ok('Y el que se queda no se toca', await stock('HARINA') === '25');

  // ── 6) Cancelar deja las cosas como estaban ──
  await irAIngresos();
  await p.evaluate(() => document.querySelector('[data-editar-lote]').click());
  await p.waitForTimeout(700);
  await responderPin('1234');
  await p.evaluate(() => {
    const c = document.querySelector('[data-ing-cant]');
    c.value = '999';
    c.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-ing-cancelar-edicion').click());
  await p.waitForTimeout(800);
  const trasCancelar = await p.evaluate(() => ({
    aviso: document.getElementById('ing-editando').hidden,
    lineas: document.querySelectorAll('#ing-lista-body tr').length,
  }));
  ok('Cancelar sale de la corrección sin guardar nada',
    trasCancelar.aviso && trasCancelar.lineas === 0, JSON.stringify(trasCancelar));
  ok('Y el stock se queda como estaba', await stock('HARINA') === '25',
    `salió ${await stock('HARINA')}`);

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
