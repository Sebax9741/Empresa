const { chromium } = require('playwright-core');

/* Notas de venta y Créditos son la misma venta: el crédito es lo que se le
   añade después (los cobros, la boleta firmada, el compromiso). Por eso la
   nota trae su crédito de nacimiento.
   El enlace va en UNA dirección: borrar la nota se lleva su crédito, pero
   borrar el crédito NO borra la nota, que es el comprobante.
   De paso: una línea ya puesta como bonificación no se traga lo que se agrega
   después cobrando, y la foto de la boleta se puede poner desde la ficha. */
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
  const irA = async (id, ms = 900) => {
    await p.evaluate(x => document.getElementById(x).click(), id);
    await p.waitForTimeout(ms);
  };
  const enCreditos = () => p.evaluate(() =>
    [...document.querySelectorAll('#table-body tr')].map(t => t.querySelector('td').textContent.trim()));
  const enNotas = () => p.evaluate(() =>
    [...document.querySelectorAll('#nv-body tr')].map(t => t.querySelector('.nv-num').textContent.trim()));

  // Catálogo, stock y cliente
  await irA('nav-productos', 600);
  for (const [n, pr] of [['HARINA ITALIANA X50KG', '100'], ['ACEITE ISASOL 6*3 LT', '130']]) {
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(450);
    await p.fill('#prod-nombre', n);
    for (const l of ['a', 'b', 'c']) await p.fill(`#prod-precio-${l}`, pr);
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(750);
  }
  await irA('nav-ingresos', 700);
  for (const nom of ['HARINA', 'ACEITE']) {
    await p.fill('#ing-buscar', nom);
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(350);
    await p.fill('#ing-cantidad', '100');
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(350);
  }
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1400);
  await irA('nav-clientes', 700);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(500);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1200);

  const elegirCliente = async () => {
    await p.fill('#nv-cliente-buscar', 'BODEGA');
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(400);
  };
  const agregar = async (busca, cant) => {
    await p.fill('#nv-buscar-producto', busca);
    await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', String(cant));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(450);
  };

  // ── 1) La bonificación no se traga lo que se agrega después cobrando ──
  await irA('nav-ventas', 900);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(900);
  await elegirCliente();
  await agregar('ACEITE', 3);
  await p.evaluate(() => document.querySelector('[data-nv-bonif]').click());
  await p.waitForTimeout(500);
  await agregar('ACEITE', 5);
  const lineas = await p.evaluate(() => [...document.querySelectorAll('#nv-items-body tr')].map(t => ({
    bonif: t.classList.contains('nv-fila-bonif'),
    cant: (t.querySelector('[data-nv-cant]') || {}).value,
  })));
  ok('Con 3 ya de regalo, los 5 que se cobran van en su propio renglón',
    lineas.length === 2 && lineas[0].bonif && lineas[0].cant === '3'
      && !lineas[1].bonif && lineas[1].cant === '5',
    JSON.stringify(lineas));
  const totales = await p.evaluate(() => ({
    bonif: document.getElementById('nv-bonif').textContent.trim(),
    total: document.getElementById('nv-total').textContent.trim(),
  }));
  ok('Y las cuentas salen: se regalan 3 y se cobran 5',
    /390/.test(totales.bonif) && /650/.test(totales.total), JSON.stringify(totales));

  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);

  // ── 2) La nota aparece sola en Créditos ──
  const notas1 = await enNotas();
  await irA('nav-inicio', 1100);
  const creditos1 = await enCreditos();
  ok('Al emitir la nota, su crédito aparece solo en Créditos',
    creditos1.length === 1 && creditos1[0] === notas1[0],
    `notas: ${notas1.join(', ')} · créditos: ${creditos1.join(', ')}`);

  const ficha = await p.evaluate(() => {
    document.querySelector('#table-body [data-info]').click();
    return new Promise(r => setTimeout(() => r({
      total: document.getElementById('info-total').textContent.trim(),
      debe: document.getElementById('info-debe').textContent.trim(),
    }), 900));
  });
  ok('Con el importe de la nota y todo por cobrar',
    /650/.test(ficha.total) && /650/.test(ficha.debe), JSON.stringify(ficha));

  // ── 3) La foto de la boleta se puede poner desde la ficha ──
  const hayFoto = await p.evaluate(() => ({
    acciones: !document.getElementById('info-foto-acciones').hidden,
    aviso: !document.getElementById('info-sin-foto').hidden,
  }));
  ok('La ficha ofrece tomar foto o elegir imagen sin salir de ahí',
    hayFoto.acciones && hayFoto.aviso, JSON.stringify(hayFoto));
  await p.evaluate(() => document.getElementById('btn-info-cerrar').click());
  await p.waitForTimeout(600);

  // ── 4) Modificar la nota le pasa el importe nuevo al crédito ──
  await irA('nav-ventas', 1000);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(1200);
  await p.fill('[data-nv-cant="1"]', '2');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(2000);
  await irA('nav-inicio', 1100);
  const trasEditar = await p.evaluate(() => {
    const f = document.querySelector('#table-body tr');
    return f ? f.querySelectorAll('td')[3].textContent.trim() : '';
  });
  ok('Corregir la nota corrige también su crédito', /260/.test(trasEditar), trasEditar);

  // ── 5) Borrar el CRÉDITO no borra la nota: es información añadida ──
  await irA('nav-settings', 800);
  await p.fill('#s-pin-nuevo', '1234');
  await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
  await p.waitForTimeout(1000);
  await irA('nav-inicio', 1000);
  await p.evaluate(() => document.querySelector('#table-body [data-borrar]').click());
  await p.waitForTimeout(800);
  if (await p.evaluate(() => document.getElementById('modal-pin').open)) {
    await p.fill('#pin-input', '1234');
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
  }
  await p.waitForTimeout(1600);
  ok('El crédito se va', (await enCreditos()).length === 0);
  await irA('nav-ventas', 1000);
  const notasTrasBorrarCredito = await enNotas();
  ok('Pero la nota de venta sigue ahí: el crédito era lo añadido',
    notasTrasBorrarCredito.length === 1, notasTrasBorrarCredito.join(', '));

  // ── 6) Una venta AL CONTADO también va a Créditos, ya pagada ──
  await irA('nav-ventas', 900);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(900);
  await elegirCliente();
  await p.selectOption('#nv-condicion', 'contado');
  await p.waitForTimeout(400);
  await agregar('HARINA', 2);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);

  await irA('nav-inicio', 1100);
  const contado = await p.evaluate(() => {
    const f = document.querySelector('#table-body tr');
    const celdas = [...f.querySelectorAll('td')].map(t => t.textContent.trim());
    return { total: celdas[3], debe: celdas[4], estado: (f.querySelector('.badge, .estado, [class*=estado]') || {}).textContent || f.textContent };
  });
  ok('La venta al contado también aparece en Créditos', !!contado.total, contado.total);
  ok('Y aparece como pagada, sin nada que cobrar',
    /pagado/i.test(contado.estado) && !/200/.test(contado.debe), `debe: ${contado.debe}`);

  // Y una venta ya pagada no se modifica: cambiarle el importe dejaría el
  // dinero recibido sin cuadrar con lo que dice la venta
  await irA('nav-ventas', 1100);
  const pagadaEnLista = await p.evaluate(() => {
    const f = [...document.querySelectorAll('#nv-body tr')]
      .find(t => /Pagado/i.test(t.textContent));
    return f ? { hay: true, editar: !!f.querySelector('[data-editar-nota]') } : { hay: false };
  });
  ok('Una nota pagada ya no ofrece modificarla',
    pagadaEnLista.hay && !pagadaEnLista.editar, JSON.stringify(pagadaEnLista));

  // No se cuela en la hoja de cobranza: ahí va lo que se sale a cobrar
  await irA('nav-cobranza', 1400);
  const enCobranza = await p.evaluate(() =>
    document.querySelectorAll('#cob-body tr').length);
  ok('Pero NO se cuela en la hoja de cobranza del día', enCobranza === 0, `${enCobranza} fila(s)`);

  // Y sigue esperando en el tablero: está pagada, pero hay que llevarla
  await irA('nav-despachos', 1200);
  const enTablero = await p.evaluate(() =>
    document.querySelectorAll('#desp-notas-lista .desp-nota').length);
  ok('Sigue en "Por despachar": pagada no es entregada', enTablero >= 1, `${enTablero} esperando`);

  // ── 7) Ni números raros ni créditos duplicados ──
  // El comprobante entero es "0001-00004225": juntando TODOS sus dígitos sale
  // 100004225, que no es ninguna boleta. Si se cuela ese número, la app cree
  // que faltan cien mil notas por crear y las inventa como filas "hueco".
  await irA('nav-inicio', 1200);
  const numeros = await enCreditos();
  ok('Los números salen pelados, sin la serie pegada delante',
    numeros.every(n => /^\d{1,6}$/.test(n)), numeros.join(', '));
  ok('Y no se inventan notas que falten', await p.evaluate(() => {
    const av = document.getElementById('faltantes-aviso');
    return !av || av.hidden;
  }));
  ok('Cada boleta aparece una sola vez: no hay créditos duplicados',
    new Set(numeros).size === numeros.length, numeros.join(', '));

  // Y el caso de verdad: un crédito de los de antes, sin nota (así está todo
  // el historial que ya existía). Al emitir la nota que le faltaba, se enlazan
  // — no se le crea un SEGUNDO crédito a la misma boleta.
  // Un crédito viejo sin nota, de los de antes de esta arquitectura. Ya no
  // hay botón para darlo de alta a mano: se simula el dato histórico directo
  // en el almacén local.
  await p.evaluate(async () => {
    await DB.put({
      id: 'viejo-9001', boleta: '9001', cliente: 'BODEGA LA ESQUINA', clienteId: '',
      zona: 'CIUDAD', monto: 750, fecha: '2026-01-01', vencimiento: '2026-02-01',
      abonos: [], estado: 'pendiente', creado: Date.now(),
    });
  });
  await p.reload();
  await p.waitForTimeout(1500);
  await irA('nav-inicio', 1000);
  const antesDeRepetir = (await enCreditos()).length;
  ok('(preparación) hay un crédito viejo sin su nota', (await enCreditos()).includes('9001'));

  await irA('nav-ventas', 900);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(900);
  await p.fill('#nv-correlativo', '9001');
  await p.waitForTimeout(600);
  await elegirCliente();
  await agregar('HARINA', 1);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(2200);
  await irA('nav-inicio', 1200);
  const trasRepetir = await enCreditos();
  ok('Emitir la nota que faltaba la enlaza, no duplica el crédito',
    trasRepetir.length === antesDeRepetir
      && trasRepetir.filter(n => n === '9001').length === 1,
    `${antesDeRepetir} → ${trasRepetir.length}: ${trasRepetir.join(', ')}`);

  // ── 8) Borrar la NOTA sí se lleva su crédito ──
  await irA('nav-inicio', 1100);
  const antesDeLaNueva = (await enCreditos()).length;
  await irA('nav-ventas', 900);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(900);
  await elegirCliente();
  await agregar('HARINA', 4);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);
  await irA('nav-inicio', 1100);
  const conLaNueva = (await enCreditos()).length;
  ok('(preparación) la nota nueva trae su crédito', conLaNueva === antesDeLaNueva + 1,
    `${antesDeLaNueva} → ${conLaNueva}`);

  await irA('nav-ventas', 1000);
  await p.evaluate(() => {
    const fila = [...document.querySelectorAll('#nv-body tr')]
      .find(t => !t.classList.contains('nv-fila-anulada') && t.querySelector('[data-eliminar-nota]'));
    fila.querySelector('[data-eliminar-nota]').click();
  });
  await p.waitForTimeout(900);
  if (await p.evaluate(() => document.getElementById('modal-pin').open)) {
    await p.fill('#pin-input', '1234');
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
  }
  await p.waitForTimeout(2000);
  await irA('nav-inicio', 1100);
  ok('Al eliminar la nota, su crédito se va con ella',
    (await enCreditos()).length === antesDeLaNueva, (await enCreditos()).join(', '));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
