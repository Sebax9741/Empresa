const { chromium } = require('playwright-core');

/* Precios por cantidad, cargo de flete y límite de créditos.

   Lo que de verdad se vigila aquí es lo que se prometió: que meter todo esto
   NO mueva un céntimo de lo ya emitido. Una nota vieja tiene que abrirse con
   sus precios, no con los de hoy, y un producto que nadie ha tocado tiene que
   seguir cobrando exactamente lo de siempre.

   Del programa solo `DB` está expuesto, y así se queda. Para poder preguntarle
   a las funciones que deciden un precio se le añade un puente al final de
   js/app.js mientras se sirve —es un módulo, así que lo pegado al final corre
   dentro de su mismo ámbito—. La app que se publica no lleva nada de esto. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Firebase/.test(m.text())) errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.route('**/js/app.js', async r => {
    const cuerpo = await (await r.fetch()).text();
    await r.fulfill({
      contentType: 'application/javascript',
      body: cuerpo + `
;window.__pruebas = {
  precioDeVenta, usaPreciosPorCantidad, escalonQueAplica,
  productoPorId, clientePorId, creditosSinPagarDe, topeDeCreditoAlcanzado,
  abrirNuevaNota, armarNota, nvSeleccionarCliente, abrirFormProducto, mostrarSeccion,
  get notas() { return notas; },
  get nvItems() { return nvItems; },
  meterItem(it) { nvItems.push(it); },
};`,
    });
  });
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Datos de partida: dos productos (uno pasado al modelo nuevo y otro no) y
  //    dos clientes (uno de la pampa, que paga camión, y uno de la ciudad).
  const sembrar = async () => p.evaluate(async () => {
    const base = { creado: Date.now(), activo: true };
    await DB.putProducto({ ...base, id: 'p-nuevo',
      codigo: 'PR-0001', nombre: 'HARINA ITALIANA * 50 KG', presentacion: 'saco',
      precioBase: 127, escalones: [{ desde: 10, precio: 125 }, { desde: 50, precio: 124 }],
      flete: 10, precioA: 125, precioB: 126, precioC: 127, stockMin: 0 });
    await DB.putProducto({ ...base, id: 'p-viejo',
      codigo: 'PR-0002', nombre: 'ACEITE ISASOL *20 LT', presentacion: 'balde',
      precioA: 140, precioB: 142, precioC: 144, stockMin: 0 });
    await DB.putCliente({ ...base, id: 'c-pampa',
      codigo: 'C001', nombre: 'ABARROTES PILLPI', zona: 'PAMPA',
      categoria: 'A', aplicaFlete: true, limiteCreditos: 2 });
    await DB.putCliente({ ...base, id: 'c-ciudad',
      codigo: 'C002', nombre: 'BODEGA CENTRO', zona: 'CIUDAD',
      categoria: 'A', aplicaFlete: false, limiteCreditos: 0 });
  });
  await sembrar();
  await p.reload();
  await p.waitForTimeout(1500);

  /* Se pregunta a las mismas funciones que cobran de verdad en la nota. Probar
     esto a base de clics tapa justo lo que importa: el número. */
  const precio = (prod, cant, cli) => p.evaluate(([pr, q, c]) => {
    const T = window.__pruebas;
    return T.precioDeVenta(T.productoPorId(pr), q, c ? T.clientePorId(c) : null);
  }, [prod, cant, cli]);

  console.log('\n── El precio lo decide la cantidad ──');
  ok('1 saco: precio base', await precio('p-nuevo', 1, 'c-ciudad') === 127,
    String(await precio('p-nuevo', 1, 'c-ciudad')));
  ok('9 sacos: todavía el base, no llega al escalón', await precio('p-nuevo', 9, 'c-ciudad') === 127);
  ok('10 sacos: entra el escalón (justo en el número, no uno más)',
    await precio('p-nuevo', 10, 'c-ciudad') === 125, String(await precio('p-nuevo', 10, 'c-ciudad')));
  ok('30 sacos: sigue en el de 10, que es el último que alcanza',
    await precio('p-nuevo', 30, 'c-ciudad') === 125);
  ok('60 sacos: manda el escalón más alto que alcanza, el de 50',
    await precio('p-nuevo', 60, 'c-ciudad') === 124, String(await precio('p-nuevo', 60, 'c-ciudad')));

  console.log('\n── El flete se le cobra solo a quien toca ──');
  ok('Al de la PAMPA se le suma el camión a cada precio',
    await precio('p-nuevo', 1, 'c-pampa') === 137 && await precio('p-nuevo', 10, 'c-pampa') === 135,
    `1 → ${await precio('p-nuevo', 1, 'c-pampa')} · 10 → ${await precio('p-nuevo', 10, 'c-pampa')}`);
  ok('Al de la CIUDAD no se le cobra el camión', await precio('p-nuevo', 10, 'c-ciudad') === 125);

  console.log('\n── Lo que ya existía no se mueve ──');
  // Ésta es la promesa que se hizo: los productos del catálogo siguen cobrando
  // lo de siempre hasta que alguien los abra y los grabe.
  ok('Un producto sin pasar sigue cobrando por la categoría del cliente, como antes',
    await precio('p-viejo', 1, 'c-pampa') === 140 && await precio('p-viejo', 99, 'c-pampa') === 140,
    `su precio A es 140 → cobra ${await precio('p-viejo', 1, 'c-pampa')}`);
  ok('Y pidiendo mucho tampoco le baja: no tiene escalones que aplicar',
    await precio('p-viejo', 500, 'c-pampa') === 140);
  ok('La app distingue los pasados de los que faltan',
    await p.evaluate(() => window.__pruebas.usaPreciosPorCantidad(window.__pruebas.productoPorId('p-nuevo'))
      && !window.__pruebas.usaPreciosPorCantidad(window.__pruebas.productoPorId('p-viejo'))));

  console.log('\n── Una nota emitida se abre con SUS precios ──');
  // Se guarda una nota con un precio de 100 y el catálogo dice otra cosa. Al
  // volver a abrirla tiene que seguir diciendo 100.
  await p.evaluate(async () => {
    await DB.putNota({
      id: 'n-vieja', numero: 'B001-000001', serie: 'B001', fecha: '2026-01-15', hora: '10:00',
      clienteId: 'c-pampa', clienteNombre: 'ABARROTES PILLPI', zona: 'PAMPA',
      condicion: 'credito', categoria: 'A', creado: Date.now(),
      items: [{ productoId: 'p-nuevo', codigo: 'PR-0001', descripcion: 'HARINA ITALIANA * 50 KG',
        um: 'SAC', cantidad: 20, precio: 100, importe: 2000, bonificacion: false, dsctoBonif: 0, neto: 2000 }],
      subtotal: 2000, bonificacion: 0, descuento: 0, total: 2000, emitidaPor: 'admin',
    });
  });
  await p.reload();
  await p.waitForTimeout(1500);
  const alAbrir = await p.evaluate(() => {
    const T = window.__pruebas;
    const n = T.notas.find(x => x.id === 'n-vieja');
    T.abrirNuevaNota(n, '', true);            // verla, en solo lectura
    return {
      precios: T.nvItems.map(it => it.precio),
      enPantalla: [...document.querySelectorAll('#nv-items-body td')]
        .map(td => td.textContent.trim()).filter(t => /^\d+[.,]\d\d$/.test(t)),
    };
  });
  ok('Al mirarla, sus líneas siguen a 100, no al precio de hoy',
    JSON.stringify(alAbrir.precios) === '[100]', JSON.stringify(alAbrir.precios));
  ok('Y en pantalla también sale 100, no 135', alAbrir.enPantalla.includes('100.00'),
    alAbrir.enPantalla.join(' '));
  ok('Lo guardado en la base tampoco se tocó',
    await p.evaluate(() => window.__pruebas.notas.find(x => x.id === 'n-vieja').items[0].precio) === 100);

  console.log('\n── Límite de créditos ──');
  await p.evaluate(async () => {
    const base = { clienteId: 'c-pampa', cliente: 'ABARROTES PILLPI', monto: 500,
      vencimiento: '2027-01-01', creado: Date.now() };
    await DB.put({ ...base, id: 'cr-1', boleta: '000001', abonos: [] });
    await DB.put({ ...base, id: 'cr-2', boleta: '000002', abonos: [] });
    // Éste ya está pagado: no debe contar contra el tope
    await DB.put({ ...base, id: 'cr-3', boleta: '000003', estado: 'pagado',
      abonos: [{ monto: 500, fecha: '2026-02-01' }] });
  });
  await p.reload();
  await p.waitForTimeout(1500);
  const tope = await p.evaluate(() => {
    const T = window.__pruebas;
    return {
      sinPagar: T.creditosSinPagarDe('c-pampa').length,
      lleno: !!T.topeDeCreditoAlcanzado(T.clientePorId('c-pampa')),
      // Al modificar una nota, su propio crédito no puede contar contra ella
      conExcepcion: !!T.topeDeCreditoAlcanzado(T.clientePorId('c-pampa'), 'cr-1'),
      sinLimite: !!T.topeDeCreditoAlcanzado(T.clientePorId('c-ciudad')),
    };
  });
  ok('Los pagados no cuentan: son 2 sin pagar, no 3', tope.sinPagar === 2, String(tope.sinPagar));
  ok('Con 2 sin pagar y límite 2, está al tope', tope.lleno);
  ok('Modificar una nota no la bloquea por su propio crédito', !tope.conExcepcion);
  ok('Sin límite puesto (0), nunca se bloquea', !tope.sinLimite);

  // Y que el bloqueo llegue de verdad hasta la nota, no solo a la función
  const avisos = [];
  p.on('dialog', async d => { avisos.push(d.message()); await d.dismiss(); });
  const bloqueo = await p.evaluate(() => {
    const T = window.__pruebas;
    T.abrirNuevaNota();
    T.nvSeleccionarCliente('c-pampa');
    document.getElementById('nv-condicion').value = 'credito';
    T.meterItem({ productoId: 'p-nuevo', codigo: 'PR-0001', descripcion: 'X', um: 'SAC',
      cantidad: 1, precio: 137, precioEditado: false });
    return {
      avisoVisible: !document.getElementById('nv-aviso-tope').hidden,
      nota: T.armarNota(),          // null = no deja emitirla
    };
  });
  ok('Al elegirlo, la nota avisa antes de escribir nada', bloqueo.avisoVisible);
  ok('Y no deja armar la nota a crédito', bloqueo.nota === null);
  ok('Diciendo cuántos debe y cuál es su límite',
    avisos.some(m => /2 créditos sin pagar/.test(m) && /límite es 2/.test(m)), avisos[0] || '(ningún aviso)');

  const alContado = await p.evaluate(() => {
    const sel = document.getElementById('nv-condicion');
    sel.value = 'contado';
    sel.dispatchEvent(new Event('change'));
    return { aviso: !document.getElementById('nv-aviso-tope').hidden, nota: !!window.__pruebas.armarNota() };
  });
  ok('Al contado sí se le puede vender: quien paga en el acto no debe más',
    alContado.nota && !alContado.aviso, JSON.stringify(alContado));

  console.log('\n── En pantalla ──');
  await p.evaluate(() => window.__pruebas.mostrarSeccion('clientes'));
  await p.waitForTimeout(600);
  const enLista = await p.evaluate(() => ({
    flete: !!document.querySelector('.cliente-etq-flete'),
    tope: !!document.querySelector('.cliente-etq-tope'),
    // Que se vea de verdad, no solo que exista en el DOM
    pintado: (() => {
      const e = document.querySelector('.cliente-etq-flete');
      if (!e) return false;
      const r = e.getBoundingClientRect();
      const x = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!x && (e === x || e.contains(x));
    })(),
    categoriaVieja: !!document.querySelector('.cliente-cat'),
  }));
  ok('La lista de clientes marca a quien paga flete', enLista.flete && enLista.pintado, JSON.stringify(enLista));
  ok('Y en rojo a quien llegó a su tope', enLista.tope);
  ok('Ya no queda la insignia A/B/C de categoría', !enLista.categoriaVieja);
  await p.screenshot({ path: 'pruebas/precios-clientes.png', clip: { x: 0, y: 0, width: 1500, height: 560 } });

  await p.evaluate(() => window.__pruebas.mostrarSeccion('productos'));
  await p.waitForTimeout(600);
  const enProductos = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#prod-body tr')];
    const texto = f => f ? f.textContent.replace(/\s+/g, ' ').trim() : '';
    return {
      pasado: texto(filas.find(f => /HARINA/.test(f.textContent))),
      sinPasar: !!document.querySelector('.prod-precio-viejo'),
      chipAviso: [...document.querySelectorAll('#prod-chips .chip')].some(c => /sin pasar/.test(c.textContent)),
    };
  });
  ok('El catálogo enseña desde qué cantidad vale cada precio',
    /desde 10/.test(enProductos.pasado) && /desde 50/.test(enProductos.pasado), enProductos.pasado.slice(0, 100));
  ok('Los que faltan por pasar salen apagados y contados arriba',
    enProductos.sinPasar && enProductos.chipAviso, JSON.stringify(enProductos));

  console.log('\n── Y cobrando de verdad, con clics, en la nota ──');
  await p.evaluate(() => window.__pruebas.mostrarSeccion('ventas'));
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  await p.fill('#nv-cliente-buscar', 'PILLPI');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(450);
  // A crédito no le dejaría: este cliente está al tope. Se vende al contado.
  await p.selectOption('#nv-condicion', 'contado');
  await p.waitForTimeout(300);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(250);
  await p.fill('#nv-cantidad', '5');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);

  const leerLinea = () => p.evaluate(() => {
    const f = document.querySelector('#nv-items-body tr');
    return {
      precio: f.querySelector('[data-nv-precio]').value,
      neto: f.querySelector('.nv-neto').textContent.trim(),
      pista: (f.querySelector('.nv-precio-escalon') || {}).textContent || '',
    };
  });
  const cinco = await leerLinea();
  ok('5 sacos al de la pampa: 127 de base + 10 de flete',
    cinco.precio === '137.00', JSON.stringify(cinco));
  ok('Y la línea explica cuánto falta para el siguiente precio',
    /5 más/.test(cinco.pista) && /125\.00/.test(cinco.pista), cinco.pista);

  // Subir la cantidad a 10 tiene que bajar el precio SOLO, en el momento
  await p.fill('#nv-items-body [data-nv-cant="0"]', '10');
  await p.waitForTimeout(500);
  const diez = await leerLinea();
  ok('Al escribir 10, el precio baja solo a 125 + 10 de flete',
    diez.precio === '135.00', JSON.stringify(diez));
  ok('Y el neto se rehace con el precio nuevo', diez.neto === '1,350.00', diez.neto);
  ok('La línea dice por qué cuesta eso', /precio por 10 o más/.test(diez.pista), diez.pista);
  await p.screenshot({ path: 'pruebas/precios-nota.png', clip: { x: 0, y: 0, width: 1500, height: 900 } });

  // Y bajarla otra vez tiene que devolver el precio de antes: el escalón no se
  // queda pegado una vez que se ha alcanzado
  await p.fill('#nv-items-body [data-nv-cant="0"]', '3');
  await p.waitForTimeout(450);
  ok('Y si se baja la cantidad, el precio vuelve a subir',
    (await leerLinea()).precio === '137.00', (await leerLinea()).precio);

  await p.evaluate(() => window.__pruebas.mostrarSeccion('productos'));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__pruebas.abrirFormProducto(window.__pruebas.productoPorId('p-nuevo')));
  await p.waitForTimeout(500);
  const form = await p.evaluate(() => ({
    base: document.getElementById('prod-precio-a').value,
    desdeB: document.getElementById('prod-desde-b').value,
    precioB: document.getElementById('prod-precio-b').value,
    flete: document.getElementById('prod-flete').value,
    simulacion: document.getElementById('prod-simulacion').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('El formulario vuelve a traer la escala tal como se guardó',
    form.base === '127' && form.desdeB === '10' && form.precioB === '125' && form.flete === '10',
    JSON.stringify(form));
  ok('Y enseña con números cómo quedaría cobrado',
    /127\.00/.test(form.simulacion) && /desde 10/.test(form.simulacion) && /137\.00/.test(form.simulacion),
    form.simulacion.slice(0, 130));
  await p.screenshot({ path: 'pruebas/precios-form.png', clip: { x: 0, y: 0, width: 1500, height: 900 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
