const { chromium } = require('playwright-core');

/* Dos cosas de esta tanda:
   · La sección de créditos pasa a llamarse "Créditos y Pagados".
   · Kardex trae una tercera pestaña, "Saldo a una fecha": eliges un día y
     enseña el stock de cada producto tal como quedó al cierre de ese día
     (el saldo de su último movimiento hasta esa fecha, o 0 si no tuvo
     ninguno), con la opción de elegir "todos los productos" o marcar solo
     algunos. */
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

  // ── 1) "Créditos y Pagados" ──
  const nombres = await p.evaluate(() => ({
    nav: document.getElementById('nav-inicio').textContent.trim(),
    dataNombre: document.getElementById('nav-inicio').dataset.nombre,
  }));
  ok('El apartado se llama "Créditos y Pagados" en el panel lateral',
    nombres.nav === 'Créditos y Pagados' && nombres.dataNombre === 'Créditos y Pagados',
    JSON.stringify(nombres));

  // ── Preparar: dos productos, con ingresos y una salida en fechas distintas ──
  const producto = async (nombre, precio) => {
    await p.evaluate(() => document.getElementById('nav-productos').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(350);
    await p.fill('#prod-nombre', nombre);
    for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, String(precio));
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(600);
  };
  await producto('ACEITE SOYA 20BOTX900ML', 100);
  await producto('HARINA ITALIANA X50KG', 200);
  await producto('SIN MOVIMIENTOS NUNCA', 50);   // para comprobar que sale en 0

  // Un cuarto producto, INACTIVO: el reporte de almacén tiene que seguir
  // contándolo (puede tener mercadería de sobra aunque ya no se venda)
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'DESCONTINUADO YA NO SE VENDE');
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '20');
  await p.evaluate(() => document.getElementById('prod-activo').click());   // lo destilda
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);

  const ingresar = async (nombreBuscado, cantidad, fecha) => {
    await p.evaluate(() => document.getElementById('nav-ingresos').click());
    await p.waitForTimeout(600);
    await p.fill('#ing-buscar', nombreBuscado);
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(350);
    await p.fill('#ing-cantidad', String(cantidad));
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(300);
    if (fecha) await p.fill('#ing-fecha', fecha).catch(() => {});
    await p.fill('#ing-doc-numero', 'F' + Math.random().toString(36).slice(2, 8));
    await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
    await p.waitForTimeout(900);
  };

  // ACEITE: 100 unidades el día 10, 50 más el día 20 → 150 al día 20, 100 al día 15
  await ingresar('ACEITE', 100, '2026-06-10');
  await ingresar('ACEITE', 50, '2026-06-20');
  // HARINA: solo 30 unidades, el día 12 → nada el día 5, 30 desde el 12 en adelante
  await ingresar('HARINA', 30, '2026-06-12');

  // ── 2) La pestaña existe y se enseña sola ──
  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(700);
  const pestañas = await p.evaluate(() => ({
    hayBoton: !!document.getElementById('btn-kdx-vista-saldo'),
    texto: document.getElementById('btn-kdx-vista-saldo').textContent.trim(),
  }));
  ok('Kardex trae la pestaña "Saldo a una fecha"',
    pestañas.hayBoton && /Saldo a una fecha/.test(pestañas.texto), JSON.stringify(pestañas));

  await p.evaluate(() => document.getElementById('btn-kdx-vista-saldo').click());
  await p.waitForTimeout(500);
  const alEntrar = await p.evaluate(() => ({
    panelVisible: !document.querySelector('.kdx-saldo-wrap').hidden,
    filtrosDeArribaOcultos: document.querySelector('.kdx-filtros').hidden,
    tablaMovimientosOculta: document.querySelector('.kdx-tabla-wrap').hidden,
    tablaDiasOculta: document.querySelector('.kdx-dias-wrap').hidden,
  }));
  ok('Al entrar se ve SOLO el panel de saldo, y los filtros de movimientos se apartan',
    alEntrar.panelVisible && alEntrar.filtrosDeArribaOcultos
      && alEntrar.tablaMovimientosOculta && alEntrar.tablaDiasOculta,
    JSON.stringify(alEntrar));

  // ── 3) Por defecto: hoy, todos los productos ──
  const porDefecto = await p.evaluate(() => ({
    fecha: document.getElementById('kdx-saldo-fecha').value,
    todos: document.getElementById('kdx-saldo-todos').checked,
    elegirOculto: document.getElementById('kdx-saldo-elegir').hidden,
  }));
  const hoy = new Date().toISOString().slice(0, 10);
  ok('Por defecto la fecha es hoy y están marcados "todos los productos"',
    porDefecto.fecha === hoy && porDefecto.todos && porDefecto.elegirOculto, JSON.stringify(porDefecto));

  const filasHoy = await p.evaluate(() => document.querySelectorAll('#kdx-saldo-body tr').length);
  ok('Con "todos" salen los cuatro: los tres activos y el descontinuado también',
    filasHoy === 4, filasHoy + ' filas');
  const inactivo = await p.evaluate(() => {
    const fila = [...document.querySelectorAll('#kdx-saldo-body tr')]
      .find(f => /DESCONTINUADO/.test(f.textContent));
    return fila ? { marcado: fila.classList.contains('prod-inactivo'),
      dice: /inactivo/i.test(fila.textContent) } : null;
  });
  ok('El descontinuado se ve, pero marcado como inactivo (no se confunde con lo vendible)',
    inactivo && inactivo.marcado && inactivo.dice, JSON.stringify(inactivo));
  await p.screenshot({ path: 'pruebas/saldo-todos.png' });

  // ── 4) Elegir una fecha intermedia: recalcula solo ──
  await p.fill('#kdx-saldo-fecha', '2026-06-15');
  await p.evaluate(() => document.getElementById('kdx-saldo-fecha').dispatchEvent(new Event('change')));
  await p.waitForTimeout(500);
  const alDia15 = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#kdx-saldo-body tr')].map(tr => {
      const td = tr.querySelectorAll('td');
      return { producto: td[1].textContent.trim(), stock: td[2].textContent.trim() };
    });
    return filas;
  });
  const aceite15 = alDia15.find(f => /ACEITE/.test(f.producto));
  const harina15 = alDia15.find(f => /HARINA/.test(f.producto));
  const sinMov15 = alDia15.find(f => /SIN MOVIMIENTOS/.test(f.producto));
  ok('Al 15 de junio: el aceite ya tenía sus primeras 100 (el segundo ingreso fue el 20)',
    aceite15 && aceite15.stock.startsWith('100'), JSON.stringify(aceite15));
  ok('Y la harina ya tenía sus 30 (entró el 12)',
    harina15 && harina15.stock.startsWith('30'), JSON.stringify(harina15));
  ok('El producto sin movimientos nunca sale en 0, no se cae de la lista',
    sinMov15 && sinMov15.stock.startsWith('0'), JSON.stringify(sinMov15));

  // ── 5) Una fecha ANTES de cualquier movimiento: todo en 0 ──
  await p.fill('#kdx-saldo-fecha', '2026-06-01');
  await p.evaluate(() => document.getElementById('kdx-saldo-fecha').dispatchEvent(new Event('change')));
  await p.waitForTimeout(500);
  const antesDeTodo = await p.evaluate(() =>
    [...document.querySelectorAll('#kdx-saldo-body td.col-num')].map(td => td.textContent.trim()));
  ok('Antes de cualquier ingreso, el stock de todos era 0',
    antesDeTodo.every(t => t.startsWith('0')), antesDeTodo.join(' | '));

  // ── 6) Elegir productos concretos, no "todos" ──
  await p.fill('#kdx-saldo-fecha', '2026-06-20');
  await p.evaluate(() => document.getElementById('kdx-saldo-fecha').dispatchEvent(new Event('change')));
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('kdx-saldo-todos').click());
  await p.waitForTimeout(400);
  const sinElegirNada = await p.evaluate(() => ({
    elegirVisible: !document.getElementById('kdx-saldo-elegir').hidden,
    avisoVisible: !document.getElementById('kdx-saldo-vacio').hidden,
    tablaOculta: document.querySelector('.kdx-saldo-tabla-wrap').hidden,
  }));
  ok('Al destildar "todos" aparece el buscador, y sin marcar nada se avisa en vez de tabla vacía',
    sinElegirNada.elegirVisible && sinElegirNada.avisoVisible && sinElegirNada.tablaOculta,
    JSON.stringify(sinElegirNada));

  await p.fill('#kdx-saldo-buscar', 'HARINA');
  await p.waitForTimeout(400);
  const listaFiltrada = await p.evaluate(() =>
    [...document.querySelectorAll('.kdx-saldo-item span')].map(s => s.textContent));
  ok('El buscador del selector filtra la lista de productos',
    listaFiltrada.length === 1 && /HARINA/.test(listaFiltrada[0]), listaFiltrada.join(' | '));

  await p.evaluate(() => document.querySelector('.kdx-saldo-check').click());
  await p.waitForTimeout(400);
  const soloHarina = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('#kdx-saldo-body tr')];
    return { cuantas: filas.length,
      texto: filas.map(f => f.textContent.replace(/\s+/g, ' ').trim()) };
  });
  ok('Y la tabla enseña SOLO el producto marcado', soloHarina.cuantas === 1 && /HARINA/.test(soloHarina.texto[0]),
    JSON.stringify(soloHarina));
  await p.screenshot({ path: 'pruebas/saldo-elegidos.png' });

  // La selección se respeta al volver a buscar otra cosa (no se pierde el marcado)
  await p.fill('#kdx-saldo-buscar', '');
  await p.waitForTimeout(400);
  const marcadoSigue = await p.evaluate(() => {
    const cajas = [...document.querySelectorAll('.kdx-saldo-check')];
    return cajas.filter(c => c.checked).length;
  });
  ok('Al limpiar la búsqueda, el producto ya marcado se sigue viendo marcado', marcadoSigue === 1, marcadoSigue + ' marcado(s)');

  // ── 7) Al volver a "todos" desaparece el selector y vuelve a mostrar todo ──
  await p.evaluate(() => document.getElementById('kdx-saldo-todos').click());
  await p.waitForTimeout(400);
  const denuevoTodos = await p.evaluate(() => ({
    elegirOculto: document.getElementById('kdx-saldo-elegir').hidden,
    filas: document.querySelectorAll('#kdx-saldo-body tr').length,
  }));
  ok('Al volver a marcar "todos" se esconde el selector y reaparecen los cuatro',
    denuevoTodos.elegirOculto && denuevoTodos.filas === 4, JSON.stringify(denuevoTodos));

  // ── 8) Las otras dos pestañas siguen intactas ──
  await p.evaluate(() => document.getElementById('btn-kdx-vista-mov').click());
  await p.waitForTimeout(500);
  const vueltaAMovimientos = await p.evaluate(() => ({
    filtrosVisibles: !document.querySelector('.kdx-filtros').hidden,
    tablaVisible: !document.querySelector('.kdx-tabla-wrap').hidden,
    filas: document.querySelectorAll('#kdx-body tr').length,
  }));
  ok('Al volver a "Movimientos" los filtros y la tabla de siempre están de vuelta',
    vueltaAMovimientos.filtrosVisibles && vueltaAMovimientos.tablaVisible && vueltaAMovimientos.filas === 3,
    JSON.stringify(vueltaAMovimientos));

  await p.screenshot({ path: 'pruebas/saldo-fecha.png', fullPage: true });
  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
