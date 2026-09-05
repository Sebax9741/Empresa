const { chromium } = require('playwright-core');

/* El recorrido completo: nota de venta → despacho → crédito, con el número
   siguiendo al talonario de papel. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  let respuestaPin = null;
  p.on('dialog', d => {
    if (d.type() === 'prompt' && respuestaPin !== null) d.accept(respuestaPin);
    else d.accept();
  });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Preparar: cliente, producto con stock y un crédito viejo con boleta 4180 ──
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(350);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.selectOption('#cli-categoria', 'A');
  await p.fill('#cli-direccion', 'JR. LIMA 123');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(700);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.selectOption('#prod-presentacion', 'saco').catch(() => {});
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '130');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);
  // La mercadería entra por su sección: el botón 📥 de Productos ya no existe
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);
  const stockInicial = await p.evaluate(() => {
    document.getElementById('nav-productos').click();
    return null;
  });
  await p.waitForTimeout(500);

  // Un repartidor, que el despacho exige al menos uno
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(800);

  // Un crédito viejo, con la última boleta del talonario de papel — de los de
  // antes de que las notas trajeran su propio crédito al nacer. Ya no hay
  // botón para darlo de alta a mano, así que se simula el dato histórico
  // directo en el almacén local (que es justo lo que representa: un
  // registro que ya estaba ahí, no uno que alguien tecleó hoy).
  await p.evaluate(async () => {
    await DB.put({
      id: 'viejo-4180', boleta: '4180', cliente: 'BODEGA LA ESQUINA', clienteId: '',
      zona: 'CIUDAD', monto: 900, fecha: '2026-01-01', vencimiento: '2026-02-01',
      abonos: [], estado: 'pendiente', creado: Date.now(),
    });
  });
  await p.reload();
  await p.waitForTimeout(1500);

  // ── 1) El correlativo arranca donde quedó el papel ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  const arranque = await p.evaluate(() => ({
    serie: document.getElementById('nv-serie').value,
    correlativo: document.getElementById('nv-correlativo').value,
  }));
  ok('La primera nota sigue al último número de boleta (4180 → 4181)',
    arranque.correlativo === '4181', JSON.stringify(arranque));

  // ── 2) El correlativo se puede escribir ──
  await p.fill('#nv-correlativo', '4180');
  await p.waitForTimeout(400);
  const avisoCredito = await p.textContent('#nv-num-aviso');
  ok('Si el número es el de una boleta ya registrada, avisa que quedarán enlazados',
    /enlazad/i.test(avisoCredito), avisoCredito.trim());
  await p.fill('#nv-correlativo', '4181');
  await p.waitForTimeout(350);

  // ── 3) Se emite la nota ──
  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(450);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(250);
  await p.fill('#nv-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1500);

  const enLista = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return { numero: f.querySelector('.nv-num').textContent.trim(),
      estado: (f.querySelector('.ped-chip') || {}).textContent.trim(),
      // Mandar a reparto ya no se hace desde aquí: se hace desde el tablero
      // de Despachos, marcando la nota y dándole a la flecha.
      despachar: !!f.querySelector('[data-despachar-nota]') };
  });
  ok('Queda guardada con su número y sale "por despachar"',
    enLista.numero === '4181' && /despachar/i.test(enLista.estado) && !enLista.despachar,
    JSON.stringify(enLista));

  // ── 4) De la nota al despacho, desde el tablero ──
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('[data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  const formDesp = await p.evaluate(() => {
    const fila = et => {
      const f = [...document.querySelectorAll('#desp-datos-nota .desp-det-fila')]
        .find(x => x.querySelector('span').textContent.includes(et));
      return f ? f.querySelector('strong').textContent.trim() : '';
    };
    return {
      aviso: (document.getElementById('desp-de-nota').hidden ? '' :
        document.getElementById('desp-de-nota').textContent.trim()),
      boleta: document.getElementById('desp-boleta').value,
      monto: document.getElementById('desp-monto').value,
      cliente: fila('Cliente'),
      // Los datos que vienen de la nota se enseñan, ya no se escriben
      camposOcultos: document.getElementById('desp-campo-cliente').hidden
        && document.getElementById('desp-campo-numeros').hidden
        && document.getElementById('desp-campo-fechas').hidden,
    };
  });
  ok('El despacho se abre con los datos de la nota, para leerlos y no tocarlos',
    /nota de venta 4181$/.test(formDesp.aviso) && formDesp.boleta === '0001-00004181'
      && Number(formDesp.monto) === 1300 && /BODEGA/.test(formDesp.cliente)
      && formDesp.camposOcultos,
    JSON.stringify(formDesp));

  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1300);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  const trasDespachar = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return { estado: (f.querySelector('.ped-chip') || {}).textContent.trim(),
      // El 🔗 de antes ahora es el ℹ️: enseña la nota entera en solo lectura,
      // y desde ahí se llega al despacho o al crédito
      info: !!f.querySelector('[data-nota-info]') };
  });
  ok('La nota pasa a "en reparto" y ofrece ver su información',
    /reparto/i.test(trasDespachar.estado) && trasDespachar.info, JSON.stringify(trasDespachar));

  // ── 5) Del despacho al crédito ──
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    const fila = document.querySelector('.desp-fila, .despacho-card');
    if (fila) fila.click();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const b = document.getElementById('btn-desp-a-credito');
    if (b) b.click();
  });
  await p.waitForTimeout(900);
  const prellenado = await p.evaluate(() => ({
    boleta: document.getElementById('f-boleta').value,
    monto: document.getElementById('f-monto').value,
  }));
  ok('El crédito se abre prellenado con la boleta de la nota',
    prellenado.boleta === '0001-00004181' && Number(prellenado.monto) === 1300,
    JSON.stringify(prellenado));
  await p.evaluate(() => document.getElementById('btn-guardar').click());
  await p.waitForTimeout(1500);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  const trasCredito = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return (f.querySelector('.ped-chip') || {}).textContent.trim();
  });
  ok('Y la nota queda marcada "a crédito"', /crédito/i.test(trasCredito), trasCredito);

  const enlazado = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    f.querySelector('[data-seguir-nota]').click();
    return null;
  });
  await p.waitForTimeout(900);
  const fichaAbierta = await p.evaluate(() => {
    const m = document.getElementById('modal-info');
    return { abierta: m && m.open, texto: m ? m.textContent.replace(/\s+/g, ' ').slice(0, 120) : '' };
  });
  ok('El botón 🔗 abre el crédito que salió de esa nota',
    fichaAbierta.abierta && /4181/.test(fichaAbierta.texto), fichaAbierta.texto.slice(0, 70));
  await p.evaluate(() => { const b = document.getElementById('btn-info-cerrar'); if (b) b.click(); });
  await p.waitForTimeout(400);

  // ── 6) La nota que ya es crédito NO se borra: se anula ──
  const sinBorrar = await p.evaluate(() => ({
    borrar: !!document.querySelector('[data-borrar-nota]'),
    anular: !!document.querySelector('[data-anular-nota]'),
    editar: !!document.querySelector('[data-editar-nota]'),
  }));
  ok('Ya no hay botón de borrar: hay anular y editar',
    !sinBorrar.borrar && sinBorrar.anular && sinBorrar.editar, JSON.stringify(sinBorrar));

  // ── 7) Anular una nota devuelve el stock y la deja de constancia ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(450);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(250);
  await p.fill('#nv-cantidad', '7');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1600);

  const numeroSegunda = await p.evaluate(() =>
    document.querySelector('#nv-body tr .nv-num').textContent.trim());
  ok('La segunda nota toma el número siguiente', numeroSegunda === '4182', numeroSegunda);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(700);
  // El stock es la 7.ª columna: código, nombre, U.M., precio A, B, C, stock
  const leerStock = () => p.evaluate(() =>
    Number(document.querySelector('#prod-body tr td:nth-child(7)').textContent.trim()));
  const antesDeAnular = await leerStock();

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  // El mismo texto sirve para las dos preguntas: el motivo de la anulación y,
  // como no hay código de seguridad configurado, pedirPin lo deja pasar igual.
  respuestaPin = 'se equivocaron de cliente';
  await p.evaluate(() => document.querySelector('#nv-body tr [data-anular-nota]').click());
  await p.waitForTimeout(2000);
  const trasAnular = await p.evaluate(() => ({
    cuantas: document.querySelectorAll('#nv-body tr').length,
    anuladas: document.querySelectorAll('#nv-body tr.nv-fila-anulada').length,
  }));
  ok('La nota anulada no se borra: sigue ahí, marcada',
    trasAnular.cuantas === 2 && trasAnular.anuladas === 1, JSON.stringify(trasAnular));

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(700);
  const trasAnularStock = await leerStock();
  ok('Y su mercadería vuelve al almacén (los 7 sacos)',
    trasAnularStock === antesDeAnular + 7, `${antesDeAnular} → ${trasAnularStock} sacos`);

  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(700);
  const kdx = await p.evaluate(() => Array.from(document.querySelectorAll('#kdx-body tr'))
    .map(f => f.textContent.replace(/\s+/g, ' ')));
  ok('La anulación queda anotada en el kardex, no se borra la salida',
    kdx.some(t => /Anulación/i.test(t)) && kdx.some(t => /4182/.test(t)),
    kdx.length + ' movimientos');

  // ── 8) Los movimientos de salida ya se pueden anular ──
  const conBoton = await p.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('#kdx-body tr'));
    const venta = filas.find(f => /venta/i.test(f.textContent));
    return { hayVenta: !!venta, tieneBoton: !!(venta && venta.querySelector('[data-borrar-kardex]')) };
  });
  ok('Una salida por venta ya lleva su botón de anular',
    conBoton.hayVenta && conBoton.tieneBoton, JSON.stringify(conBoton));

  const antesKdx = kdx.length;
  await p.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('#kdx-body tr'));
    const venta = filas.find(f => /venta/i.test(f.textContent));
    if (venta) venta.querySelector('[data-borrar-kardex]').click();
  });
  await p.waitForTimeout(1500);
  const despuesKdx = await p.$$eval('#kdx-body tr', f => f.length);
  ok('Y se anula de verdad', despuesKdx === antesKdx - 1, `${antesKdx} → ${despuesKdx}`);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'pruebas/flujo-notas.png', clip: { x: 0, y: 0, width: 1500, height: 460 } });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
