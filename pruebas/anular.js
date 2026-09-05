const { chromium } = require('playwright-core');

/* Modificar y anular notas de venta. Una nota anulada no se borra: se queda de
   constancia, la mercadería vuelve al almacén con su apunte en el kardex, sale
   de la zona de despachos y su boleta figura como anulada en Créditos. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  let respuesta = '';
  p.on('dialog', d => {
    if (d.type() === 'prompt') d.accept(respuesta);
    else d.accept();
  });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Preparar ──
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

  const stock = () => p.evaluate(async () => {
    document.getElementById('nav-productos').click();
    await new Promise(r => setTimeout(r, 400));
    // La columna de stock se busca por su título y no por su número: contarlas
    // a mano es lo que las rompió al añadir la del flete.
    const iStock = [...document.querySelectorAll('#prod-tabla thead th')]
      .findIndex(th => /stock/i.test(th.textContent));
    const f = document.querySelector('#prod-body tr');
    return f ? f.cells[iStock].textContent.trim() : '';
  });

  // ── 1) Cantidad: 0 de entrada y solo enteros ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  const campoCant = await p.evaluate(() => {
    const c = document.getElementById('nv-cantidad');
    return { valor: c.value, paso: c.step, minimo: c.min };
  });
  ok('La cantidad viene vacía: no propone ninguna',
    campoCant.valor === '' && campoCant.paso === '1', JSON.stringify(campoCant));

  await p.fill('#nv-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(450);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(250);
  await p.fill('#nv-cantidad', '2.5');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(600);
  const conDecimal = await p.evaluate(() => document.querySelectorAll('#nv-items-body tr').length);
  ok('Una cantidad con decimales no se acepta', conDecimal === 0, conDecimal + ' líneas');

  await p.fill('#nv-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  const trasAgregar = await p.evaluate(() => ({
    lineas: document.querySelectorAll('#nv-items-body tr').length,
    cantidadVuelveA: document.getElementById('nv-cantidad').value,
  }));
  ok('Con un entero sí entra, y el campo vuelve a quedar vacío',
    trasAgregar.lineas === 1 && trasAgregar.cantidadVuelveA === '', JSON.stringify(trasAgregar));

  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1600);
  const stockTrasVenta = await stock();
  ok('La venta descuenta del almacén', stockTrasVenta === '90', stockTrasVenta);

  // ── 2) Ya no está el botón de "usar como base" ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  const botones = await p.evaluate(() => ({
    copiar: !!document.querySelector('[data-copiar-nota]'),
    borrar: !!document.querySelector('[data-borrar-nota]'),
    editar: !!document.querySelector('[data-editar-nota]'),
    anular: !!document.querySelector('[data-anular-nota]'),
  }));
  ok('Fuera "usar como base" y fuera "borrar"; entran editar y anular',
    !botones.copiar && !botones.borrar && botones.editar && botones.anular, JSON.stringify(botones));

  // ── 3) Modificar la nota reajusta el almacén ──
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(900);
  const enEdicion = await p.evaluate(() => ({
    titulo: document.getElementById('nv-form-titulo').textContent.trim(),
    correlativo: document.getElementById('nv-correlativo').value,
    lineas: document.querySelectorAll('#nv-items-body tr').length,
    cliente: document.getElementById('nv-cliente-buscar').value,
  }));
  ok('La nota se abre para modificarla, con lo suyo dentro y su mismo número',
    /Modificando/i.test(enEdicion.titulo) && enEdicion.lineas === 1 && /BODEGA/.test(enEdicion.cliente),
    `${enEdicion.titulo} · n.º ${enEdicion.correlativo}`);

  // Su propio número no es un choque: es suyo. Antes se avisaba a sí misma
  // de que "ese número ya es de la nota 4214" estando en la nota 4214.
  const avisoNumero = await p.evaluate(() =>
    document.getElementById('nv-num-aviso').textContent.trim());
  ok('Y no se avisa a sí misma de que su número ya está usado',
    !/ya es de la nota/i.test(avisoNumero), avisoNumero || 'sin aviso');

  await p.fill('[data-nv-cant="0"]', '4');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);
  const trasEditar = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#nv-body tr')];
    return { cuantas: filas.length, total: filas[0].querySelectorAll('.col-num')[1].textContent.trim() };
  });
  ok('Se guarda sobre la misma nota, no crea otra',
    trasEditar.cuantas === 1 && /520/.test(trasEditar.total),
    `${trasEditar.cuantas} nota(s) · ${trasEditar.total}`);
  const stockTrasEditar = await stock();
  ok('Y el almacén queda con lo que dice la nota corregida',
    stockTrasEditar === '96', stockTrasEditar + ' (esperado 96)');

  // ── 4) Anular: se va de despachos, vuelve el stock y queda constancia ──
  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#desp-notas-lista input[data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1800);
  await p.evaluate(() => document.querySelector('#desp-vista-detalle [data-desp-volver]').click());
  await p.waitForTimeout(800);
  const antesDeAnular = await p.evaluate(() => document.querySelectorAll('#desp-tabla-body tr').length);
  ok('La nota está en reparto antes de anularla', antesDeAnular === 1, antesDeAnular + ' en reparto');

  const sinContado = await p.evaluate(() => {
    document.querySelector('#desp-tabla-body tr').click();
    return null;
  });
  await p.waitForTimeout(800);
  const acciones = await p.evaluate(() => [...document.querySelectorAll('#desp-det-acciones button')]
    .map(x => x.textContent.trim()));
  ok('El despacho ya no ofrece "se pagó al contado"',
    acciones.length === 2 && !acciones.some(a => /contado/i.test(a)), acciones.join(' | '));
  await p.evaluate(() => document.querySelector('#desp-vista-detalle [data-desp-volver]').click());
  await p.waitForTimeout(600);

  respuesta = 'El cliente devolvió todo';
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-anular-nota]').click());
  await p.waitForTimeout(2200);

  const anulada = await p.evaluate(() => {
    const f = document.querySelector('#nv-body tr');
    return {
      cuantas: document.querySelectorAll('#nv-body tr').length,
      tachada: f.classList.contains('nv-fila-anulada'),
      estado: f.querySelector('.ped-chip').textContent.trim(),
      motivo: (f.querySelector('.nv-anul-motivo') || {}).textContent || '',
      acciones: [...f.querySelectorAll('.col-acc button')].map(x => x.title || x.textContent.trim()),
    };
  });
  ok('La nota NO se borra: sigue en la lista, marcada como anulada',
    anulada.cuantas === 1 && anulada.tachada && /Anulada/.test(anulada.estado), anulada.estado);
  ok('Con el motivo a la vista', /devolvió todo/.test(anulada.motivo), anulada.motivo.trim());
  // Mirarla e imprimirla sí se puede —anulada y todo, es un papel que existió—
  // y el administrador la puede eliminar. Lo que ya no: modificarla, seguirla
  // a un despacho o volver a anularla.
  const acc = anulada.acciones.join(' | ');
  ok('Y ya no se puede modificar, despachar ni volver a anular',
    !/Modificar/i.test(acc) && !/despacho o su crédito/i.test(acc) && !/Anular/i.test(acc)
      && /se imprimirá/i.test(acc) && /Imprimir/i.test(acc) && /Eliminar/i.test(acc), acc);

  const stockTrasAnular = await stock();
  ok('La mercadería vuelve al almacén', stockTrasAnular === '100', stockTrasAnular + ' (esperado 100)');

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  const enDespachos = await p.evaluate(() => ({
    reparto: document.querySelectorAll('#desp-tabla-body tr').length,
    porDespachar: document.querySelectorAll('#desp-notas-lista .desp-nota').length,
  }));
  ok('Se quita de la zona de despachos, y tampoco vuelve a "por despachar"',
    enDespachos.reparto === 0 && enDespachos.porDespachar === 0, JSON.stringify(enDespachos));

  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(900);
  const enKardex = await p.evaluate(() => {
    const f = document.querySelector('#kdx-body tr');
    return f ? f.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('La anulación queda anotada en el kardex, como entrada',
    /Anulación/i.test(enKardex) && /Entrada/i.test(enKardex), enKardex.slice(0, 90));

  // ── 5) Una nota que ya llegó a crédito: al anularla queda anulada allí ──
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
  await p.fill('#nv-cantidad', '5');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1600);

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#desp-notas-lista input[data-elegir-nota]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1800);
  await p.evaluate(() => document.getElementById('btn-desp-a-credito').click());
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.getElementById('btn-guardar').click());
  await p.waitForTimeout(1800);

  const numeroConCredito = await p.evaluate(() => {
    document.getElementById('nav-ventas').click();
    return null;
  });
  await p.waitForTimeout(700);
  const antes = await p.evaluate(() => {
    const f = [...document.querySelectorAll('#nv-body tr')].find(x => !x.classList.contains('nv-fila-anulada'));
    return { numero: f.querySelector('.nv-num').textContent.trim(),
      estado: f.querySelector('.ped-chip').textContent.trim() };
  });
  ok('La segunda nota llegó a crédito', /crédito/i.test(antes.estado), `${antes.numero} · ${antes.estado}`);

  respuesta = 'Se equivocó el pedido';
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('#nv-body tr')].find(x => !x.classList.contains('nv-fila-anulada'));
    f.querySelector('[data-anular-nota]').click();
  });
  await p.waitForTimeout(2400);

  const trasAnularConCredito = await p.evaluate(() => ({
    anuladas: document.querySelectorAll('#nv-body tr.nv-fila-anulada').length,
  }));
  ok('Anulada también la que tenía crédito',
    trasAnularConCredito.anuladas === 2, trasAnularConCredito.anuladas + ' anuladas');

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(1200);
  const enCreditos = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#table-body tr')];
    const anul = filas.find(f => /Anulado/.test(f.textContent));
    return {
      total: filas.length,
      anulada: !!anul,
      texto: anul ? anul.textContent.replace(/\s+/g, ' ').trim() : '',
      quitarOfrecido: anul ? !!anul.querySelector('[data-desanular]') : false,
    };
  });
  ok('En Créditos su boleta figura como anulada, con el motivo',
    enCreditos.anulada && /equivocó el pedido/.test(enCreditos.texto), enCreditos.texto.slice(0, 80));

  const stockFinal = await stock();
  ok('Y su mercadería también volvió', stockFinal === '100', stockFinal + ' (esperado 100)');

  // ── 6) Las hojas de trabajo se imprimen en hoja entera A4 ──
  await p.evaluate(() => {
    window.__impreso = '';
    window.open = () => ({ document: { write(h) { window.__impreso = h; }, close() {} }, onload: null, print() {} });
  });
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('btn-cob-imprimir').click());
  await p.waitForTimeout(900);
  const hojaCob = await p.evaluate(() => window.__impreso || '');
  ok('La hoja de cobranza pide A4 de pie',
    /@page\s*\{\s*size:\s*A4 portrait/.test(hojaCob),
    (hojaCob.match(/size:\s*A4[^;]*/) || ['sin @page'])[0]);

  await p.evaluate(() => { window.__impreso = ''; document.getElementById('nav-kardex').click(); });
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('btn-kardex-imprimir').click());
  await p.waitForTimeout(900);
  const hojaKdx = await p.evaluate(() => window.__impreso || '');
  ok('Y el kardex también', /@page\s*\{\s*size:\s*A4 portrait/.test(hojaKdx),
    (hojaKdx.match(/size:\s*A4[^;]*/) || ['sin @page'])[0]);

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
