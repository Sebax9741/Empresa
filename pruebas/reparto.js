const { chromium } = require('playwright-core');

/* El recorrido del reparto, con lo que cambió:
     · mandar a reparto se hace SOLO desde el tablero de Despachos
     · una nota en reparto no se puede modificar (ni desde Notas ni desde el
       despacho): el papel y la mercadería están con el repartidor
     · lo que salió por error se devuelve a "Por despachar" marcándolo
     · y si vuelve sin entregarse, "Devuelto y anular" cierra el pedido, anula
       la nota y devuelve la mercadería al almacén */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
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

  const stock = async () => p.evaluate(() => {
    document.getElementById('nav-productos').click();
    // La columna de stock se busca por su título y no por su número: contarlas
    // a mano es lo que las rompió al añadir la del flete.
    const iStock = [...document.querySelectorAll('#prod-tabla thead th')]
      .findIndex(th => /stock/i.test(th.textContent));
    const fila = document.querySelector('#prod-body tr');
    return fila ? fila.cells[iStock].textContent.trim().replace(' ⚠️', '') : '';
  });
  const irA = async (id, ms = 900) => {
    await p.evaluate(x => document.getElementById(x).click(), id);
    await p.waitForTimeout(ms);
  };

  // Producto con stock, cliente y repartidor
  await irA('nav-productos', 600);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(500);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.fill('#prod-precio-a', '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(800);
  await irA('nav-ingresos', 700);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(350);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(350);
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1300);
  await irA('nav-clientes', 700);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(500);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1200);
  await irA('nav-despachos', 800);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(600);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-desp-volver]').click());
  await p.waitForTimeout(700);

  // Una nota de venta
  const emitir = async cant => {
    await irA('nav-ventas', 900);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(900);
    await p.fill('#nv-cliente-buscar', 'BODEGA');
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(400);
    await p.fill('#nv-buscar-producto', 'HARINA');
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', String(cant));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1500);
  };
  await emitir(10);
  ok('(preparación) la venta descuenta del almacén', await stock() === '90', `stock ${await stock()}`);

  // ── 1) Ya no se manda a reparto desde Notas de venta ──
  await irA('nav-ventas', 1000);
  const enNotas = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return {
      despachar: !!f.querySelector('[data-despachar-nota]'),
      editar: !!f.querySelector('[data-editar-nota]'),
    };
  });
  ok('Notas de venta ya no lleva el botón de mandar a reparto', !enNotas.despachar);
  ok('Y una nota "por despachar" sí se puede modificar', enNotas.editar);

  // ── 2) Se manda desde el tablero, y ahí los datos solo se leen ──
  await irA('nav-despachos', 1000);
  await p.evaluate(() => document.querySelector('[data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  const form = await p.evaluate(() => ({
    ocultos: document.getElementById('desp-campo-cliente').hidden
      && document.getElementById('desp-campo-numeros').hidden
      && document.getElementById('desp-campo-fechas').hidden,
    datos: [...document.querySelectorAll('#desp-datos-nota .desp-det-fila span')]
      .map(s => s.textContent.trim()),
    hayRepartidores: !!document.querySelector('#desp-repartidores-check input'),
    hayNota: !!document.getElementById('desp-notas'),
  }));
  ok('Los datos de la nota se enseñan, no se escriben', form.ocultos);
  ok('Y están todos los que hacían falta',
    ['Cliente', 'Nota de venta', 'Monto', 'Emisión', 'Despacho']
      .every(et => form.datos.some(d => d.includes(et))), form.datos.join(' · '));
  ok('Lo que sí se elige sigue estando: repartidores y nota',
    form.hayRepartidores && form.hayNota);

  await p.evaluate(() => document.querySelector('#desp-repartidores-check input').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('btn-desp-guardar').click());
  await p.waitForTimeout(1500);

  // ── 3) En reparto no se modifica, ni desde Notas ni desde el despacho ──
  await irA('nav-ventas', 1000);
  const enReparto = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return {
      estado: (f.querySelector('.ped-chip') || {}).textContent.trim(),
      editar: !!f.querySelector('[data-editar-nota]'),
    };
  });
  ok('Con la nota en reparto ya no se ofrece modificarla',
    /reparto/i.test(enReparto.estado) && !enReparto.editar, enReparto.estado);

  await irA('nav-despachos', 1000);
  await p.evaluate(() => document.querySelector('[data-abrir-despacho]').click());
  await p.waitForTimeout(900);
  const ficha = await p.evaluate(() => ({
    editar: !document.getElementById('btn-desp-editar').hidden,
    borrar: !!document.getElementById('btn-desp-borrar'),
    acciones: [...document.querySelectorAll('#desp-det-acciones button')].map(x => x.textContent.trim()),
  }));
  ok('En el despacho tampoco: mientras está en la calle no se toca', !ficha.editar);
  ok('Y el botón de borrar el despacho ya no está', !ficha.borrar);
  ok('Las salidas son crédito o "devuelto y anular"',
    ficha.acciones.length === 2 && /crédito/i.test(ficha.acciones[0])
      && /devuelto y anular/i.test(ficha.acciones[1]), ficha.acciones.join(' | '));

  // ── 4) Devolver a "Por despachar" lo que salió por error ──
  await p.evaluate(() => document.querySelector('[data-desp-volver]').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('btn-desp-seleccionar').click());
  await p.waitForTimeout(600);
  ok('El botón de seleccionar saca las casillas',
    await p.evaluate(() => !!document.querySelector('[data-elegir-despacho]')));
  await p.evaluate(() => document.querySelector('[data-elegir-despacho]').click());
  await p.waitForTimeout(400);
  ok('Al marcar uno se enciende el botón de devolver',
    !await p.evaluate(() => document.getElementById('btn-desp-devolver').disabled));
  await p.evaluate(() => document.getElementById('btn-desp-devolver').click());
  await p.waitForTimeout(1500);
  const trasDevolver = await p.evaluate(() => ({
    izquierda: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
    derecha: document.querySelectorAll('#desp-tabla-body tr').length,
  }));
  ok('El pedido vuelve a "Por despachar" y se va del otro lado',
    trasDevolver.izquierda === 1 && trasDevolver.derecha === 0, JSON.stringify(trasDevolver));
  ok('Y la mercadería no se toca: la nota sigue siendo la misma',
    await stock() === '90', `stock ${await stock()}`);

  // ── 5) Devuelto y anular: cierra el pedido y devuelve el almacén ──
  await irA('nav-despachos', 1000);
  await p.evaluate(() => document.querySelector('[data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#desp-repartidores-check input').click());
  await p.waitForTimeout(300);
  // Guardar deja abierta la ficha del despacho, así que ya estamos dentro
  await p.evaluate(() => document.getElementById('btn-desp-guardar').click());
  await p.waitForTimeout(1600);
  await p.evaluate(() => document.getElementById('btn-desp-devuelto-anular').click());
  await p.waitForTimeout(2200);

  const trasAnular = await p.evaluate(() => ({
    chip: (document.querySelector('#desp-det-info .desp-det-estado .ped-chip') || {}).textContent.trim(),
    acciones: [...document.querySelectorAll('#desp-det-acciones button')].map(x => x.textContent.trim()),
    aviso: (document.querySelector('.desp-det-cerrado') || {}).textContent || '',
  }));
  ok('El pedido queda marcado como devuelto', /devuelt/i.test(trasAnular.chip), trasAnular.chip);
  ok('Y no se deshace desde ahí: su nota quedó anulada',
    trasAnular.acciones.length === 0 && /anulada/i.test(trasAnular.aviso),
    trasAnular.aviso.replace(/\s+/g, ' ').trim().slice(0, 90));

  await irA('nav-ventas', 1000);
  ok('La nota figura anulada, no borrada',
    await p.evaluate(() => document.querySelectorAll('.nv-fila-anulada').length) === 1);
  ok('Y la mercadería volvió al almacén', await stock() === '100', `stock ${await stock()}`);

  await irA('nav-kardex', 1200);
  const kdx = await p.evaluate(() => [...document.querySelectorAll('#kdx-body tr')]
    .map(t => t.textContent.replace(/\s+/g, ' ').trim()));
  ok('Y en el kardex entra como devolución, sumando al stock',
    kdx.some(f => /Devuelto en el reparto/i.test(f) && /Entrada/i.test(f)),
    (kdx.find(f => /Devuelto/i.test(f)) || 'no aparece').slice(0, 90));
  ok('Sin borrar la salida que hizo la venta: el historial cuenta lo que pasó',
    kdx.some(f => /Venta \(nota de venta\)/i.test(f)));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
