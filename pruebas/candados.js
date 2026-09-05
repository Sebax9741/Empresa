const { chromium } = require('playwright-core');

/* Lo que pide el código de seguridad y lo que no, el kardex con sus filtros y
   su stock por día, y la hoja de cobranza cerrada, que no deja entrar nada. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  const dialogos = [];
  let respuesta = 'motivo de prueba';
  p.on('dialog', d => {
    dialogos.push({ tipo: d.type(), texto: d.message().replace(/\s+/g, ' ').slice(0, 120) });
    if (d.type() === 'prompt') d.accept(respuesta); else d.accept();
  });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // El código de seguridad se pide en un cuadro propio de la app, no en un
  // prompt del navegador: hay que escribirlo ahí y aceptar.
  const hayPin = () => p.evaluate(() => document.getElementById('modal-pin').open);
  const responderPin = async codigo => {
    if (!await hayPin()) return false;
    await p.fill('#pin-input', codigo);
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
    await p.waitForTimeout(900);
    // Si el código estaba mal, el cuadro sigue abierto: se cancela
    if (await hayPin()) {
      await p.evaluate(() => document.getElementById('btn-pin-cancelar').click());
      await p.waitForTimeout(500);
    }
    return true;
  };

  // ── Preparar: un código de seguridad de verdad, cliente y producto ──
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(700);
  await p.fill('#s-pin-nuevo', '2468');
  await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
  await p.waitForTimeout(900);
  const conPin = await p.evaluate(() => document.getElementById('pin-estado').textContent.trim());
  ok('Queda puesto un código de seguridad', /activ/i.test(conPin), conPin.slice(0, 60));

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
  await p.waitForTimeout(700);

  // ── 1) En Productos ya no está el 📥, y editar pide el código ──
  const accionesProd = await p.evaluate(() => {
    const f = document.querySelector('#prod-body tr');
    return {
      ingreso: !!f.querySelector('[data-ingreso-producto]'),
      botones: [...f.querySelectorAll('.col-acc button')].map(x => x.title),
    };
  });
  ok('Fuera el botón de registrar ingreso desde Productos',
    !accionesProd.ingreso && accionesProd.botones.length === 2, accionesProd.botones.join(' | '));

  await p.evaluate(() => document.querySelector('[data-editar-producto]').click());
  await p.waitForTimeout(700);
  const pidioPin = await hayPin();
  await responderPin('9999');            // código equivocado
  const conClaveMala = await p.evaluate(() => document.getElementById('modal-producto').open);
  ok('Editar un producto pide el código, y con uno malo no abre',
    pidioPin && !conClaveMala, `pidió: ${pidioPin} · abrió: ${conClaveMala}`);

  await p.evaluate(() => document.querySelector('[data-editar-producto]').click());
  await p.waitForTimeout(700);
  await responderPin('2468');            // el bueno
  const conClaveBuena = await p.evaluate(() => document.getElementById('modal-producto').open);
  ok('Con el código bueno sí abre', conClaveBuena);
  await p.evaluate(() => document.getElementById('btn-prod-cancelar').click());
  await p.waitForTimeout(400);

  // Mercadería, desde su sección
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);

  // ── 2) Anular no pide clave; eliminar sí ──
  const venta = async n => {
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
    await p.fill('#nv-cantidad', String(n));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1600);
  };
  await venta(10);
  await venta(5);

  dialogos.length = 0;
  respuesta = 'se equivocó el pedido';
  await p.evaluate(() => document.querySelectorAll('#nv-body tr [data-anular-nota]')[0].click());
  await p.waitForTimeout(1800);
  const anulacion = await p.evaluate(() => document.querySelectorAll('#nv-body tr.nv-fila-anulada').length);
  ok('Anular NO pide el código: solo el motivo y ya está',
    anulacion === 1 && !(await hayPin()), 'anuladas: ' + anulacion);

  await p.evaluate(() => {
    const f = [...document.querySelectorAll('#nv-body tr')].find(x => !x.classList.contains('nv-fila-anulada'));
    f.querySelector('[data-eliminar-nota]').click();
  });
  await p.waitForTimeout(900);
  const eliminarPide = await hayPin();
  await responderPin('1111');            // código malo
  const trasIntentar = await p.evaluate(() => document.querySelectorAll('#nv-body tr').length);
  ok('Eliminar SÍ pide el código, y con uno malo no borra',
    eliminarPide && trasIntentar === 2, `pidió: ${eliminarPide} · quedan ${trasIntentar}`);

  await p.evaluate(() => {
    const f = [...document.querySelectorAll('#nv-body tr')].find(x => !x.classList.contains('nv-fila-anulada'));
    f.querySelector('[data-eliminar-nota]').click();
  });
  await p.waitForTimeout(900);
  await responderPin('2468');
  await p.waitForTimeout(1200);
  const trasEliminar = await p.evaluate(() => document.querySelectorAll('#nv-body tr').length);
  ok('Con el código bueno se elimina de verdad', trasEliminar === 1, trasEliminar + ' notas');

  // ── 3) El kardex: filtros y stock por día ──
  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(900);
  const filtros = await p.evaluate(() => ({
    motivo: !!document.getElementById('kdx-fil-motivo'),
    usuario: !!document.getElementById('kdx-fil-usuario'),
    texto: !!document.getElementById('kdx-fil-texto'),
    mes: !!document.getElementById('btn-kdx-mes'),
    motivos: [...document.querySelectorAll('#kdx-fil-motivo option')].map(o => o.textContent.trim()),
  }));
  ok('El kardex tiene filtros de motivo, quién lo hizo, texto y "este mes"',
    filtros.motivo && filtros.usuario && filtros.texto && filtros.mes,
    JSON.stringify({ ...filtros, motivos: filtros.motivos.length }));
  ok('Y los motivos que ofrece son los que de verdad se usaron',
    filtros.motivos.length > 1 && filtros.motivos.some(t => /Venta/i.test(t)),
    filtros.motivos.join(', '));

  const todos = await p.evaluate(() => document.querySelectorAll('#kdx-body tr').length);
  await p.selectOption('#kdx-fil-motivo', 'venta');
  await p.waitForTimeout(600);
  const soloVentas = await p.evaluate(() => ({
    filas: document.querySelectorAll('#kdx-body tr').length,
    textos: [...document.querySelectorAll('#kdx-body tr')].map(f => f.textContent),
  }));
  ok('Filtrar por motivo deja solo lo de ese motivo',
    soloVentas.filas < todos && soloVentas.textos.every(t => /Venta/i.test(t)),
    `${todos} → ${soloVentas.filas}`);

  await p.evaluate(() => document.getElementById('btn-kdx-limpiar').click());
  await p.waitForTimeout(500);
  await p.fill('#kdx-fil-texto', 'HARINA');
  await p.waitForTimeout(700);
  const porTexto = await p.evaluate(() => document.querySelectorAll('#kdx-body tr').length);
  ok('El buscador de texto encuentra por producto', porTexto === todos, porTexto + ' filas');
  await p.fill('#kdx-fil-texto', 'zzz-no-existe');
  await p.waitForTimeout(700);
  const sinNada = await p.evaluate(() => document.querySelectorAll('#kdx-body tr').length);
  ok('Y no encuentra lo que no está', sinNada === 0, sinNada + ' filas');
  await p.evaluate(() => document.getElementById('btn-kdx-limpiar').click());
  await p.waitForTimeout(500);

  // Stock por día
  await p.evaluate(() => document.getElementById('btn-kdx-vista-dias').click());
  await p.waitForTimeout(600);
  const sinProducto = await p.evaluate(() => ({
    aviso: !document.getElementById('kdx-dias-aviso').hidden,
    tabla: !document.querySelector('.kdx-dias-wrap').hidden,
  }));
  ok('Sin producto elegido, la vista por día pide que elijas uno',
    sinProducto.aviso && !sinProducto.tabla, JSON.stringify(sinProducto));

  await p.evaluate(() => {
    const sel = document.getElementById('kdx-fil-producto');
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(700);
  const porDia = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#kdx-dias-body tr')];
    return {
      dias: filas.length,
      primera: filas[0] ? [...filas[0].cells].map(c => c.textContent.trim()) : [],
      stockProducto: (() => {
        document.getElementById('nav-productos').click();
        const iStock = [...document.querySelectorAll('#prod-tabla thead th')]
          .findIndex(th => /stock/i.test(th.textContent));
        const f = document.querySelector('#prod-body tr');
        return f ? f.cells[iStock].textContent.trim() : '';
      })(),
    };
  });
  ok('Con el producto elegido sale el cierre de cada día',
    porDia.dias === 1, porDia.dias + ' día(s) · ' + porDia.primera.join(' | '));
  ok('Y el stock al cerrar el día es el stock de verdad del producto',
    porDia.primera[4] === porDia.stockProducto,
    `día: ${porDia.primera[4]} · almacén: ${porDia.stockProducto}`);

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
