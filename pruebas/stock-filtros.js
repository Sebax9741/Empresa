const { chromium } = require('playwright-core');

/* Dos cosas nuevas:
   · el ajuste que decide si se puede vender lo que no hay en el almacén;
   · la barra de búsqueda larga de Clientes, con su botón de filtros.

   Del programa solo `DB` está expuesto, así que para preguntarle a las
   funciones se le pega un puente al final de js/app.js mientras se sirve (es
   un módulo: lo pegado corre dentro de su mismo ámbito). La app publicada no
   lleva nada de esto. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Firebase/.test(m.text())) errs.push('consola: ' + m.text().slice(0, 140)); });
  const avisos = [];
  p.on('dialog', async d => { avisos.push(d.message()); await d.dismiss(); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.route('**/js/app.js', async r => {
    const cuerpo = await (await r.fetch()).text();
    await r.fulfill({ contentType: 'application/javascript', body: cuerpo + `
;window.__pruebas = {
  mostrarSeccion, abrirNuevaNota, armarNota, nvSeleccionarCliente, agregarItemNota,
  productoPorId, stockDe, renderNotaItems,
  get items() { return nvItems; },
  ponerAjuste(v) { settings.stockNegativo = v; },
};` });
  });
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // Un producto con 8 en almacén y un cliente al que venderle
  await p.evaluate(async () => {
    await DB.putProducto({ id: 'p1', creado: Date.now(), activo: true, codigo: 'PR-0001',
      nombre: 'HARINA ITALIANA * 50 KG', presentacion: 'saco', precioBase: 120, escalones: [], flete: 0, stockMin: 0 });
    await DB.putKardex({ id: 'k1', productoId: 'p1', fecha: '2026-09-01', tipo: 'entrada', cantidad: 8,
      motivo: 'compra', documento: 'F1', creado: Date.now() });
    const zonas = ['PAMPA', 'CIUDAD', 'MILAGROS'];
    for (let i = 0; i < 6; i++) {
      await DB.putCliente({ id: 'c' + i, creado: Date.now(), codigo: 'C' + (100 + i),
        nombre: ['ABARROTES PILLPI', 'BODEGA CENTRO', 'ANNY', 'BERTHA', 'CARLA DURAN', 'ALBINA'][i],
        zona: zonas[i % 3], aplicaFlete: i % 2 === 0, limiteCreditos: i === 0 ? 1 : 0 });
    }
    await DB.put({ id: 'cr1', clienteId: 'c0', cliente: 'ABARROTES PILLPI', boleta: '4180',
      monto: 500, vencimiento: '2026-12-01', abonos: [], creado: Date.now() });
  });
  await p.reload();
  await p.waitForTimeout(1500);

  const armar = async cantidad => p.evaluate(q => {
    const T = window.__pruebas;
    T.abrirNuevaNota();
    T.nvSeleccionarCliente('c1');                 // sin límite de créditos
    document.getElementById('nv-producto').value = 'p1';
    document.getElementById('nv-cantidad').value = String(q);
    T.agregarItemNota();
    return { lineas: T.items.length, pedido: T.items.reduce((s, it) => s + it.cantidad, 0) };
  }, cantidad);

  console.log('\n── Con el ajuste puesto en SÍ (como siempre) ──');
  await p.evaluate(() => window.__pruebas.ponerAjuste(true));
  const deMas = await armar(20);
  ok('Deja agregar 20 aunque solo haya 8: avisa, pero no frena',
    deMas.pedido === 20, JSON.stringify(deMas));
  ok('Y la nota se puede guardar', await p.evaluate(() => !!window.__pruebas.armarNota()));
  ok('La línea sale marcada en rojo, para que no pase desapercibido',
    await p.evaluate(() => !!document.querySelector('#nv-items-body .nv-sin-stock')));

  console.log('\n── Con el ajuste en NO ──');
  await p.evaluate(() => window.__pruebas.ponerAjuste(false));
  const frenado = await armar(20);
  ok('No deja agregar 20 si solo hay 8', frenado.lineas === 0, JSON.stringify(frenado));
  const justo = await armar(8);
  ok('Pero los 8 que sí hay entran sin problema', justo.pedido === 8, JSON.stringify(justo));
  const unoMas = await p.evaluate(() => {
    const T = window.__pruebas;
    document.getElementById('nv-producto').value = 'p1';
    document.getElementById('nv-cantidad').value = '1';
    T.agregarItemNota();
    return T.items.reduce((s, it) => s + it.cantidad, 0);
  });
  ok('Y uno más ya no: cuenta lo que YA está en la nota, no solo lo que se agrega',
    unoMas === 8, String(unoMas));

  // La cantidad también se puede escribir a mano en la tabla, saltándose el
  // botón de agregar: ahí es el guardado el que tiene que cerrar la puerta
  const aMano = await p.evaluate(() => {
    const T = window.__pruebas;
    T.items[0].cantidad = 30;
    T.renderNotaItems();
    return { nota: T.armarNota(), rojo: !!document.querySelector('#nv-items-body .nv-sin-stock') };
  });
  ok('Escribiendo la cantidad a mano tampoco se cuela: al guardar se para',
    aMano.nota === null, String(aMano.nota));
  ok('Y se explica cuánto se pide y cuánto hay',
    avisos.some(m => /se piden 30 y hay 8/.test(m)), avisos[avisos.length - 1] || '(sin aviso)');
  ok('La línea también se marca en rojo', aMano.rojo);

  console.log('\n── El ajuste vive en Configuración, y lo pone el dueño ──');
  // Por el botón de verdad, no por la puerta de atrás: es ese botón el que
  // decide qué apartados de Configuración se enseñan según quién entró
  await p.evaluate(() => document.getElementById('btn-settings').click());
  await p.waitForTimeout(600);
  const enAjustes = await p.evaluate(() => {
    const grupo = document.getElementById('settings-almacen');
    const cb = document.getElementById('s-stock-negativo');
    if (!grupo || !cb) return null;
    const r = grupo.getBoundingClientRect();
    return { visible: !grupo.hidden, alto: Math.round(r.height), texto: grupo.textContent.replace(/\s+/g, ' ').trim() };
  });
  ok('Está el apartado de Almacén con su casilla', !!enAjustes && enAjustes.visible, JSON.stringify(enAjustes && enAjustes.visible));
  ok('Y explica qué pasa al desmarcarla',
    !!enAjustes && /no admite más de lo que hay contado/i.test(enAjustes.texto),
    (enAjustes ? enAjustes.texto : '').slice(0, 100));

  console.log('\n── La barra de búsqueda de Clientes ──');
  await p.evaluate(() => window.__pruebas.mostrarSeccion('clientes'));
  await p.waitForTimeout(600);
  const barra = await p.evaluate(() => {
    const caja = document.querySelector('.buscador-largo');
    const campo = document.getElementById('cli-buscar');
    const boton = document.getElementById('btn-cli-filtros');
    const r = caja.getBoundingClientRect();
    const vista = document.getElementById('view-clientes').getBoundingClientRect();
    // Que se vea de verdad en ese punto, no solo que exista en el DOM
    const enPunto = el => {
      const c = el.getBoundingClientRect();
      const x = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
      return !!x && (x === el || el.contains(x) || x.contains(el));
    };
    return {
      ancho: Math.round(r.width),
      anchoVista: Math.round(vista.width),
      lupa: !!caja.querySelector('.buscador-lupa svg.ico-linea'),
      botonConIcono: !!boton.querySelector('svg.ico-linea'),
      campoDentro: caja.contains(campo),
      seVe: enPunto(campo) && enPunto(boton),
    };
  });
  ok('Ocupa la línea entera, no una esquina',
    barra.ancho > barra.anchoVista * 0.85, `${barra.ancho}px de ${barra.anchoVista}px`);
  ok('Con la lupa dentro y el botón de filtros al final',
    barra.lupa && barra.botonConIcono && barra.campoDentro, JSON.stringify(barra));
  ok('Y los dos se ven de verdad, no tapados por nada', barra.seVe);

  const cuantos = () => p.evaluate(() => document.querySelectorAll('.cliente-item').length);
  ok('Salen los 6 clientes', await cuantos() === 6, String(await cuantos()));

  await p.evaluate(() => document.getElementById('btn-cli-filtros').click());
  await p.waitForTimeout(400);
  ok('El botón abre los filtros', await p.evaluate(() => !document.getElementById('cli-filtros').hidden));
  // Salen en el orden del catálogo de zonas, no en el orden en que se
  // registraron los clientes: así la lista está siempre igual
  const zonasFiltro = await p.evaluate(() =>
    [...document.querySelectorAll('#cli-filtro-zona option')].map(o => o.value).join(','));
  ok('Y las zonas del desplegable son solo las que de verdad tienen clientes',
    zonasFiltro === ',CIUDAD,MILAGROS,PAMPA', zonasFiltro);

  await p.selectOption('#cli-filtro-zona', 'PAMPA');
  await p.waitForTimeout(400);
  ok('Filtrando por PAMPA quedan 2', await cuantos() === 2, String(await cuantos()));
  ok('Y el contador dice cuántos de cuántos',
    /2 de 6/.test(await p.evaluate(() => document.getElementById('cli-contador').textContent)),
    await p.evaluate(() => document.getElementById('cli-contador').textContent));
  ok('El botón de filtros queda encendido: una lista recortada tiene que explicarse',
    await p.evaluate(() => document.getElementById('btn-cli-filtros').classList.contains('activo')));

  await p.selectOption('#cli-filtro-zona', '');
  await p.selectOption('#cli-filtro-cond', 'flete');
  await p.waitForTimeout(400);
  ok('Filtrando por "paga flete" quedan 3', await cuantos() === 3, String(await cuantos()));
  await p.selectOption('#cli-filtro-cond', 'tope');
  await p.waitForTimeout(400);
  ok('Y por "llegó a su límite", solo el que lo alcanzó', await cuantos() === 1, String(await cuantos()));

  await p.evaluate(() => document.getElementById('btn-cli-filtros-limpiar').click());
  await p.waitForTimeout(400);
  ok('Quitar filtros los devuelve todos', await cuantos() === 6, String(await cuantos()));

  await p.fill('#cli-buscar', 'bodega');
  await p.waitForTimeout(400);
  ok('Y el buscador sigue funcionando igual', await cuantos() === 1, String(await cuantos()));

  await p.screenshot({ path: 'pruebas/clientes-barra.png', clip: { x: 0, y: 0, width: 1500, height: 520 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
