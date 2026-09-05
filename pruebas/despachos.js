const { chromium } = require('playwright-core');

/* La zona de despachos como recorrido completo: las notas de venta recién
   emitidas se ven ahí mismo, se mandan a reparto de un toque, y al volver se
   dice si fue crédito, contado o devuelta. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Preparar: cliente, producto con stock y un repartidor ──
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
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.selectOption('#prod-presentacion', 'saco').catch(() => {});
  await p.fill('#prod-precio-a', '130');
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

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(800);

  // ── 1) El formulario de la nota: sin Pedido/ref y a crédito de entrada ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  const form = await p.evaluate(() => ({
    ref: !!document.getElementById('nv-referencia'),
    condicion: document.getElementById('nv-condicion').value,
    primeraOpcion: document.getElementById('nv-condicion').options[0].value,
    fpago: document.getElementById('nv-fpago').value,
    fecha: document.getElementById('nv-fecha').value,
  }));
  ok('Ya no existe el campo Pedido / ref.', !form.ref);
  ok('La condición viene puesta en CRÉDITO', form.condicion === 'credito' && form.primeraOpcion === 'credito',
    form.condicion);
  ok('Y la fecha de pago se propone a los días de crédito, no hoy',
    form.fpago > form.fecha, `${form.fecha} → ${form.fpago}`);

  // Se emite la nota
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
  const numeroNota = await p.evaluate(() => document.getElementById('nv-numero-vista')
    ? document.getElementById('nv-numero-vista').textContent
    : document.getElementById('nv-serie').value + '-' + document.getElementById('nv-correlativo').value);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1500);

  // ── 2) La nota espera en el lado izquierdo ──
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  const izq = await p.evaluate(() => {
    const f = document.querySelector('#desp-notas-lista .desp-nota');
    return {
      hay: !!f,
      texto: f ? f.textContent.replace(/\s+/g, ' ').trim() : '',
      numero: f ? f.querySelector('.desp-nota-num').textContent.trim() : '',
      cuenta: document.getElementById('desp-notas-cuenta').textContent.trim(),
      derecha: document.querySelectorAll('#desp-tabla-body tr').length,
      botonApagado: document.getElementById('btn-desp-pasar').disabled,
      rotulo: document.querySelector('.desp-flecha-txt').textContent.trim(),
    };
  });
  ok('La nota emitida espera en el lado de "Por despachar"',
    izq.hay && izq.numero === '1', izq.texto);
  ok('Con su cliente y su monto, y el lado de reparto todavía vacío',
    /BODEGA/.test(izq.texto) && /1.?300/.test(izq.texto) && izq.derecha === 0,
    `${izq.cuenta} · ${izq.derecha} en reparto`);
  ok('La flecha está apagada mientras no marques nada',
    izq.botonApagado && izq.rotulo === 'Mandar a reparto', izq.rotulo);

  // ── 3) Marcarla enciende la flecha, y la flecha abre el despacho ──
  await p.click('#desp-notas-lista input[data-elegir-nota]');
  await p.waitForTimeout(500);
  const marcada = await p.evaluate(() => ({
    encendida: !document.getElementById('btn-desp-pasar').disabled,
    rotulo: document.querySelector('.desp-flecha-txt').textContent.trim(),
    resaltada: !!document.querySelector('.desp-nota.elegida'),
  }));
  ok('Al marcarla se enciende la flecha y dice cuántas van',
    marcada.encendida && /Mandar 1 a reparto/.test(marcada.rotulo) && marcada.resaltada,
    marcada.rotulo);

  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  const prellenado = await p.evaluate(() => ({
    formAbierto: !document.getElementById('desp-vista-form').hidden,
    aviso: document.getElementById('desp-de-nota').hidden ? ''
      : document.getElementById('desp-de-nota').textContent.trim(),
    boleta: document.getElementById('desp-boleta').value,
    monto: document.getElementById('desp-monto').value,
  }));
  ok('La flecha abre el despacho con todo puesto',
    prellenado.formAbierto && Number(prellenado.monto) === 1300 && /0001/.test(prellenado.boleta),
    `${prellenado.boleta} · ${prellenado.monto}`);
  ok('Y avisa de qué nota viene, con el número pelado',
    /nota de venta 1$/.test(prellenado.aviso), prellenado.aviso);

  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1600);
  await p.evaluate(() => document.querySelector('#desp-vista-detalle [data-desp-volver]').click());
  await p.waitForTimeout(700);

  // ── 4) Cruzó de lado ──
  const trasDespachar = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#desp-tabla-body tr')];
    return {
      izquierda: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
      vacioIzq: !document.getElementById('desp-notas-vacio').hidden,
      derecha: filas.length,
      estado: filas[0] ? filas[0].cells[6].textContent.trim() : '',
      repartidores: filas[0] ? filas[0].cells[5].textContent.trim() : '',
      botonApagado: document.getElementById('btn-desp-pasar').disabled,
    };
  });
  ok('La nota se fue del lado izquierdo y apareció en el derecho',
    trasDespachar.izquierda === 0 && trasDespachar.vacioIzq && trasDespachar.derecha === 1,
    `izq ${trasDespachar.izquierda} · der ${trasDespachar.derecha}`);
  ok('Ahí sale en reparto, con su repartidor',
    /reparto/i.test(trasDespachar.estado) && /LUIS/i.test(trasDespachar.repartidores),
    `${trasDespachar.estado} · ${trasDespachar.repartidores}`);
  ok('Y la flecha vuelve a estar apagada', trasDespachar.botonApagado);

  // ── 5) Al volver el reparto: crédito, contado o devuelto ──
  await p.evaluate(() => document.querySelector('#desp-tabla-body tr').click());
  await p.waitForTimeout(900);
  const acciones = await p.evaluate(() => [...document.querySelectorAll('#desp-det-acciones button')]
    .map(x => x.textContent.trim()));
  ok('El despacho en reparto ofrece crédito o devuelto',
    acciones.length === 2 && /crédito/i.test(acciones[0]) && /devuelt/i.test(acciones[1]),
    acciones.join(' | '));
  ok('Y ya no ofrece "se pagó al contado"',
    !acciones.some(a => /contado/i.test(a)), acciones.join(' | '));

  // El camino normal: pasa a crédito. (Lo de "devuelto y anular" se prueba
  // aparte, en su propia suite, porque se lleva la nota y el almacén con él.)
  await p.evaluate(() => document.getElementById('btn-desp-a-credito').click());
  await p.waitForTimeout(900);
  const credito = await p.evaluate(() => ({
    boleta: document.getElementById('f-boleta').value,
    monto: document.getElementById('f-monto').value,
  }));
  ok('Y desde "en reparto" sigue pasando a crédito como siempre',
    /0001/.test(credito.boleta) && Number(credito.monto) === 1300,
    `${credito.boleta} · ${credito.monto}`);
  await p.evaluate(() => document.getElementById('btn-guardar').click());
  await p.waitForTimeout(1500);

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(800);
  const finalDesp = await p.evaluate(() => {
    const f = document.querySelector('#desp-tabla-body tr');
    return f ? f.cells[6].textContent.trim() : '';
  });
  ok('El renglón queda "a crédito" en la misma lista', /crédito/i.test(finalDesp), finalDesp);

  // ── 6) Varias notas de golpe, que es como sale el camión ──
  const otraNota = async (cant) => {
    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(400);
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
    await p.fill('#nv-cantidad', String(cant));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1500);
  };
  await otraNota(2);
  await otraNota(3);
  await otraNota(4);
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  const tres = await p.evaluate(() => document.querySelectorAll('#desp-notas-lista .desp-nota').length);
  ok('Las tres notas nuevas esperan juntas a la izquierda', tres === 3, tres + ' notas');

  await p.evaluate(() => document.querySelectorAll('#desp-notas-lista input[data-elegir-nota]')
    .forEach(c => c.click()));
  await p.waitForTimeout(600);
  const marcadas = await p.evaluate(() => document.querySelector('.desp-flecha-txt').textContent.trim());
  ok('Se pueden marcar las tres', /Mandar 3 a reparto/.test(marcadas), marcadas);

  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  const lote = await p.evaluate(() => ({
    titulo: document.getElementById('desp-form-title').textContent.trim(),
    resumen: document.getElementById('desp-lote-resumen').hidden ? ''
      : document.getElementById('desp-lote-resumen').textContent.replace(/\s+/g, ' ').trim(),
    lineas: document.querySelectorAll('#desp-lote-resumen li').length,
    clienteOculto: document.getElementById('desp-campo-cliente').hidden,
    numerosOculto: document.getElementById('desp-campo-numeros').hidden,
    montoObligatorio: document.getElementById('desp-monto').required,
  }));
  ok('Con varias se abre el despacho en modo lote, sin pedir cliente ni monto',
    /3 notas/.test(lote.titulo) && lote.clienteOculto && lote.numerosOculto
      && lote.montoObligatorio === false, lote.titulo);
  ok('Y enseña qué notas van a salir, con su total',
    lote.lineas === 3 && /Salen 3 notas/.test(lote.resumen), lote.resumen.slice(0, 60));

  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(2200);
  const trasLote = await p.evaluate(() => ({
    izquierda: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
    derecha: document.querySelectorAll('#desp-tabla-body tr').length,
    enLista: !document.getElementById('desp-vista-lista').hidden,
    repartidores: [...document.querySelectorAll('#desp-tabla-body tr')]
      .map(f => f.cells[5].textContent.trim()),
  }));
  ok('Las tres cruzan de una vez y cada una queda con su propio despacho',
    trasLote.izquierda === 0 && trasLote.derecha === 4 && trasLote.enLista,
    `izq ${trasLote.izquierda} · der ${trasLote.derecha}`);
  ok('Todas con el mismo repartidor',
    trasLote.repartidores.every(r => /LUIS/i.test(r)), trasLote.repartidores.join(' | '));

  // ── 7) La hoja impresa y los números ──
  await p.evaluate(() => {
    window.__impreso = '';
    window.open = () => ({ document: { write(h) { window.__impreso = h; }, close() {} }, onload: null, print() {} });
  });
  await p.evaluate(() => document.getElementById('btn-desp-imprimir').click());
  await p.waitForTimeout(900);
  const hoja = await p.evaluate(() => window.__impreso || '');
  const filasHoja = (hoja.match(/<tr>\s*<td/g) || []).length;
  ok('La hoja que llevan los repartidores trae los cuatro despachos',
    filasHoja === 4 && /4 despacho\(s\)/.test(hoja), `${filasHoja} fila(s) en la hoja`);
  ok('Y ahí el número sale entero, con su serie y sus ceros',
    /0001-0000000\d/.test(hoja), (hoja.match(/0001-\d+/) || ['no aparece'])[0]);
  ok('La hoja de despachos pide hoja entera A4, de pie',
    /@page\s*\{\s*size:\s*A4 portrait/.test(hoja), (hoja.match(/size:\s*A4[^;]*/) || ['sin @page'])[0]);

  await p.evaluate(() => { window.__impreso = ''; document.getElementById('nav-ventas').click(); });
  await p.waitForTimeout(900);
  const enNotas = await p.evaluate(() =>
    [...document.querySelectorAll('#nv-body .nv-num')].map(x => x.textContent.trim()));
  ok('La lista de notas de venta los enseña pelados',
    enNotas.length === 4 && enNotas.every(x => /^\d{1,4}$/.test(x)), enNotas.join(' | '));
  await p.evaluate(() => {
    const b3 = document.querySelector('[data-imprimir-nota]');
    if (b3) b3.click();
  });
  await p.waitForTimeout(1200);
  const notaHoja = await p.evaluate(() => window.__impreso || '');
  ok('Pero la nota impresa lleva el número completo',
    /0001-0000000\d/.test(notaHoja), (notaHoja.match(/0001-\d+/) || ['no aparece'])[0]);

  // ── 8) Lo viejo no se esconde: se avisa aparte ──
  // Una nota más, sin despachar, a la que se le atrasa la fecha 20 días.
  await otraNota(1);
  await p.evaluate(async () => {
    const todas = await DB.getAllNotas();
    const n = todas.sort((x, y) => (y.creado || 0) - (x.creado || 0))[0];
    const hace = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    await DB.putNota({ ...n, fecha: hace });
  });
  await p.reload();
  await p.waitForTimeout(1800);
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  const conVieja = await p.evaluate(() => ({
    enLista: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
    aviso: document.getElementById('desp-notas-viejas').hidden ? ''
      : document.getElementById('desp-notas-viejas').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('Una nota de hace 20 días no sale entre las recientes',
    conVieja.enLista === 0, conVieja.enLista + ' en la lista');
  ok('Pero se avisa de que está ahí, sin esconderla',
    /1 nota de hace más de 7 días/.test(conVieja.aviso), conVieja.aviso);

  await p.evaluate(() => document.getElementById('btn-desp-notas-viejas').click());
  await p.waitForTimeout(600);
  const desplegada = await p.evaluate(() => ({
    enLista: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
    aviso: document.getElementById('desp-notas-viejas').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('Y con un toque se muestra para poder despacharla',
    desplegada.enLista === 1 && /Ver solo las recientes/.test(desplegada.aviso),
    desplegada.enLista + ' en la lista');

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
