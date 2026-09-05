const { chromium } = require('playwright-core');
/* El formulario de nota de venta: apretado, con serie por zona y bonificaciones. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
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

  // Clientes en tres zonas distintas, una por serie
  const clientes = [
    ['DISTRIBUIDORA CIUDAD SAC', 'CIUDAD', 'A'],
    ['BODEGA LABERINTO', 'LABERINTO', 'B'],
    ['MINIMARKET PAMPA', 'PAMPA', 'C'],
  ];
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  for (const [nom, zona, cat] of clientes) {
    await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
    await p.waitForTimeout(350);
    await p.fill('#cli-nombre', nom);
    await p.selectOption('#cli-zona', zona);
    await p.selectOption('#cli-categoria', cat);
    await p.fill('#cli-direccion', 'AV. ERNESTO RIVERO 546 - ' + zona);
    await p.fill('#cli-ruc', '20529068806');
    await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
    await p.waitForTimeout(700);
  }

  // Tres productos con stock
  const prods = [['HARINA ITALIANA X50KG', 'saco', '130'],
    ['AZUCAR SAN AURELIO X 50KG', 'saco', '125'],
    ['ACEITE SOYA 20BOTX900ML', 'caja', '120']];
  for (let i = 4; i <= 15; i++) prods.push([`PRODUCTO DE PRUEBA ${i}`, 'unidad', '50']);
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  for (const [nom, pres, precio] of prods) {
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(300);
    await p.fill('#prod-nombre', nom);
    await p.selectOption('#prod-presentacion', pres).catch(() => {});
    for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, precio);
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(550);
  }
  // Toda la mercadería entra de una vez desde 📥 Ingreso de productos
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  for (const [nom] of prods) {
    await p.fill('#ing-buscar', nom.split(' ')[0]);
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(350);
    await p.fill('#ing-cantidad', '60');
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(400);
  }
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);

  // ── El formulario ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);

  const cabe = async () => p.evaluate(() => {
    const f = document.getElementById('nv-vista-form');
    const d = document.documentElement;
    return { alto: Math.round(f.getBoundingClientRect().height),
      ventana: window.innerHeight,
      pagina: d.scrollHeight, visible: d.clientHeight,
      banner: Math.round((document.querySelector('.banner') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      scroll: d.scrollHeight - d.clientHeight };
  });
  const vacio = await cabe();
  ok('El formulario vacío cabe sin bajar con la rueda', vacio.scroll <= 0,
    `${vacio.alto}px de contenido · ${vacio.ventana}px de ventana`);

  // ── Serie según la zona ──
  const serie = async () => p.evaluate(() => ({
    serie: document.getElementById('nv-serie').value,
    correlativo: document.getElementById('nv-correlativo').textContent,
    pista: document.getElementById('nv-serie-pista').textContent,
  }));
  const elegir = async nombre => {
    await p.fill('#nv-cliente-buscar', nombre);
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(500);
  };
  await elegir('DISTRIBUIDORA CIUDAD');
  let s = await serie();
  ok('CIUDAD usa la serie 0001', s.serie === '0001', JSON.stringify(s));
  await elegir('BODEGA LABERINTO');
  s = await serie();
  ok('LABERINTO usa la serie 0002', s.serie === '0002', JSON.stringify(s));
  await elegir('MINIMARKET PAMPA');
  s = await serie();
  ok('PAMPA usa la serie 0003', s.serie === '0003', JSON.stringify(s));

  // Y se puede cambiar a mano
  await p.selectOption('#nv-serie', '0001');
  await p.waitForTimeout(300);
  s = await serie();
  ok('La serie se puede cambiar a mano', s.serie === '0001' && /mano/i.test(s.pista), JSON.stringify(s));

  // ── Categoría, zona y ubicación a la vista ──
  await elegir('DISTRIBUIDORA CIUDAD');
  const ficha = await p.evaluate(() => ({
    cat: document.getElementById('nv-ficha-cat').textContent.trim(),
    zona: document.getElementById('nv-fc-zona').textContent.trim(),
    dir: document.getElementById('nv-fc-direccion').textContent.trim(),
    visible: !document.getElementById('nv-ficha').hidden,
  }));
  ok('Muestra la categoría de precio, la zona y la ubicación',
    ficha.visible && ficha.cat === 'A' && ficha.zona === 'CIUDAD' && /RIVERO/.test(ficha.dir),
    JSON.stringify(ficha));

  // ── El producto se busca escribiendo ──
  await p.fill('#nv-buscar-producto', 'soya aceite');
  await p.waitForTimeout(450);
  const sugerencias = await p.evaluate(() => ({
    visible: !document.getElementById('nv-prod-sugerencias').hidden,
    lista: Array.from(document.querySelectorAll('[data-nv-prod] .combo-nombre')).map(x => x.textContent.trim()),
  }));
  ok('Escribiendo el producto salen las coincidencias debajo',
    sugerencias.visible && sugerencias.lista.length > 0, sugerencias.lista.join(' | '));
  ok('Encuentra aunque las palabras vayan en otro orden',
    /ACEITE SOYA/.test(sugerencias.lista[0] || ''), sugerencias.lista[0]);

  await p.fill('#nv-buscar-producto', 'azucar');
  await p.waitForTimeout(400);
  const primero = await p.evaluate(() =>
    (document.querySelector('[data-nv-prod] .combo-nombre') || {}).textContent.trim());
  ok('Lo más parecido sale primero', /^AZUCAR/.test(primero || ''), primero);

  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(300);
  const traselegir = await p.evaluate(() => ({
    texto: document.getElementById('nv-buscar-producto').value,
    id: document.getElementById('nv-producto').value,
    abierto: !document.getElementById('nv-prod-sugerencias').hidden,
  }));
  ok('Al elegirlo queda escrito y la lista se cierra',
    /^AZUCAR/.test(traselegir.texto) && !!traselegir.id && !traselegir.abierto,
    JSON.stringify(traselegir));

  // ── Productos y bonificación ──
  const porNombre = async (texto, cant) => {
    await p.fill('#nv-buscar-producto', texto);
    await p.waitForTimeout(380);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(220);
    await p.fill('#nv-cantidad', String(cant));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(320);
  };
  await porNombre('HARINA ITALIANA', 10);
  await porNombre('AZUCAR SAN AURELIO', 15);
  await porNombre('ACEITE SOYA', 2);
  const trasAgregar = await p.evaluate(() => ({
    texto: document.getElementById('nv-buscar-producto').value,
    id: document.getElementById('nv-producto').value,
  }));
  ok('Tras agregar, el buscador queda limpio para el siguiente',
    trasAgregar.texto === '' && trasAgregar.id === '', JSON.stringify(trasAgregar));
  const antes = await p.evaluate(() => ({
    sub: document.getElementById('nv-subtotal').textContent,
    total: document.getElementById('nv-total').textContent,
    filas: document.querySelectorAll('#nv-items-body tr').length,
  }));
  ok('Se agregan los tres productos', antes.filas === 3, JSON.stringify(antes));

  // La tercera línea pasa a bonificación
  await p.evaluate(() => document.querySelectorAll('[data-nv-bonif]')[2].click());
  await p.waitForTimeout(400);
  const conBonif = await p.evaluate(() => {
    const f = document.querySelectorAll('#nv-items-body tr')[2];
    return {
      esBonif: f.classList.contains('nv-fila-bonif'),
      importe: f.querySelector('.nv-importe').textContent,
      dscto: f.querySelector('.nv-dscto').textContent,
      neto: f.querySelector('.nv-neto').textContent,
      sub: document.getElementById('nv-subtotal').textContent,
      bonif: document.getElementById('nv-bonif').textContent,
      total: document.getElementById('nv-total').textContent,
    };
  });
  ok('La línea marcada como bonificación conserva su precio a la vista',
    conBonif.esBonif && conBonif.importe === '240.00', JSON.stringify(conBonif));
  ok('Y se descuenta por el mismo importe, así que la línea queda en cero',
    conBonif.dscto === '−240.00' && conBonif.neto === '0.00', `${conBonif.dscto} → ${conBonif.neto}`);
  ok('El subtotal la sigue contando y el total ya no la cobra',
    conBonif.sub === antes.sub && conBonif.bonif === '−240.00'
      && Number(conBonif.total.replace(/,/g, '')) === Number(antes.total.replace(/,/g, '')) - 240,
    `${antes.total} → ${conBonif.total}`);

  // Se puede deshacer
  await p.evaluate(() => document.querySelectorAll('[data-nv-bonif]')[2].click());
  await p.waitForTimeout(350);
  const vuelta = await p.evaluate(() => document.getElementById('nv-total').textContent);
  ok('Se puede volver a cobrarla', vuelta === antes.total, `${vuelta}`);
  await p.evaluate(() => document.querySelectorAll('[data-nv-bonif]')[2].click());
  await p.waitForTimeout(350);

  console.log('   [partes]', await p.evaluate(() => {
    const h = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
    return { cab: h('.nv-cab'), cliente: h('#nv-vista-form .nv-panel:not(.nv-panel-items)'),
      agregar: h('.nv-ag'), pie: h('.nv-pie'), fila: h('#nv-items-body tr'),
      form: h('#nv-vista-form'), tope: getComputedStyle(document.getElementById('nv-vista-form')).getPropertyValue('--nv-alto') };
  }));
  const holgado = await p.evaluate(() => {
    const w = document.querySelector('.nv-items-wrap');
    return { scrollHeight: w.scrollHeight, clientHeight: w.clientHeight };
  });
  ok('Con pocas líneas el cuadro NO se aprieta: se ven todas',
    holgado.scrollHeight <= holgado.clientHeight + 1,
    `${holgado.scrollHeight}px de contenido en ${holgado.clientHeight}px`);

  const lleno = await cabe();
  ok('Con tres productos sigue cabiendo sin bajar con la rueda', lleno.scroll <= 0,
    `formulario ${lleno.alto}px · página ${lleno.pagina}px en ${lleno.visible}px · sobra ${lleno.scroll}px (aviso local: ${lleno.banner}px)`);
  await p.screenshot({ path: 'pruebas/nv-form.png' });

  // ── Una nota larga tampoco desplaza la página ──
  for (let i = 4; i <= 15; i++) await porNombre(`PRODUCTO DE PRUEBA ${i}`, 1);
  const larga = await cabe();
  const cuadro = await p.evaluate(() => {
    const w = document.querySelector('.nv-items-wrap');
    const pie = document.querySelector('.nv-pie').getBoundingClientRect();
    return { filas: document.querySelectorAll('#nv-items-body tr').length,
      seDesplaza: w.scrollHeight > w.clientHeight + 1,
      pieALaVista: pie.bottom <= window.innerHeight + 1 };
  });
  ok('Con una nota larga la página sigue sin desplazarse', larga.scroll <= 0,
    `${cuadro.filas} líneas · sobra ${larga.scroll}px`);
  ok('Lo que se desplaza es el cuadro de productos, no la página', cuadro.seDesplaza);
  ok('Y el total sigue a la vista sin bajar', cuadro.pieALaVista);
  await p.screenshot({ path: 'pruebas/nv-form-larga.png' });
  // Se dejan solo las tres primeras para lo que sigue
  await p.evaluate(() => {
    const quitar = document.querySelectorAll('[data-nv-quitar]');
    for (let i = quitar.length - 1; i >= 3; i--) quitar[i].click();
  });
  await p.waitForTimeout(600);

  // ── Se guarda con su serie y su bonificación ──
  // La serie va en la cabecera del formulario; la lista solo enseña el número
  // pelado, así que se mira dónde está cada cosa.
  const serieAlGuardar = await p.evaluate(() => document.getElementById('nv-serie').value);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1600);
  const guardada = await p.evaluate(() => {
    const fila = document.querySelector('#nv-body tr');
    return { numero: fila.querySelector('.nv-num').textContent.trim(),
      total: fila.querySelectorAll('.col-num')[1].textContent.trim() };
  });
  ok('Queda guardada con la serie de su zona', serieAlGuardar === '0001', serieAlGuardar);
  ok('Y en la lista el número sale pelado, sin serie ni ceros',
    /^\d{1,4}$/.test(guardada.numero), JSON.stringify(guardada));

  // ── En el teléfono el formulario se recorre entero, sin cuadros apretados ──
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(700);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
  const cel = await p.evaluate(() => {
    const f = document.getElementById('nv-vista-form');
    const w = document.querySelector('.nv-items-wrap');
    const d = document.documentElement;
    return { tope: getComputedStyle(f).maxHeight,
      desbordaAncho: d.scrollWidth > d.clientWidth + 1,
      cuadroApretado: w ? w.scrollHeight > w.clientHeight + 1 : false };
  });
  ok('En el teléfono el formulario no se ata a la ventana',
    cel.tope === 'none' && !cel.cuadroApretado, JSON.stringify(cel));
  ok('Y no se sale de ancho', !cel.desbordaAncho);
  await p.screenshot({ path: 'pruebas/nv-form-celular.png', clip: { x: 0, y: 0, width: 390, height: 844 } });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
