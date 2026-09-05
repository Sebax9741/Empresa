const { chromium } = require('playwright-core');
/* En el teléfono el panel es un cajón: arriba solo lo esencial. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
    deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1800);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);
  const visible = sel => p.evaluate(s => {
    const e = document.querySelector(s);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);

  // ── 1) La cabecera solo lleva lo esencial ──
  const botonesSeccion = await p.$$eval('.header-actions .btn-icon',
    bs => bs.filter(b => b.getBoundingClientRect().width > 0).length);
  ok('Arriba ya no está la fila de apartados', botonesSeccion === 0, botonesSeccion + ' visibles');
  ok('Sí está el botón ☰', await visible('#btn-menu'));
  ok('Y la hora', await visible('#reloj'));
  await p.evaluate(() => {
    // La cuenta solo aparece en modo nube: se muestra para poder comprobarla
    document.getElementById('usuario-chip').hidden = false;
  });
  ok('Y el usuario con su "Cerrar sesión"',
    await visible('#btn-cuenta') && await visible('#btn-logout-header'));
  const altura = await p.evaluate(() => Math.round(document.querySelector('.app-header').getBoundingClientRect().height));
  ok('La cabecera ocupa poco y va en una sola línea', altura <= 72, altura + 'px de alto');
  await p.screenshot({ path: 'pruebas/cel-cabecera.png', clip: { x: 0, y: 0, width: 390, height: 240 } });

  // ── 2) El cajón empieza escondido ──
  ok('El panel arranca escondido', !(await visible('#nav-lateral')));
  ok('Y el velo también', !(await visible('#nav-velo')));

  // ── 3) El ☰ lo despliega ──
  await p.click('#btn-menu');
  await p.waitForTimeout(500);
  ok('El ☰ despliega el panel', await visible('#nav-lateral'));
  ok('Con el velo detrás', await visible('#nav-velo'));
  const caja = await p.evaluate(() => {
    const r = document.getElementById('nav-lateral').getBoundingClientRect();
    return { x: Math.round(r.x), ancho: Math.round(r.width) };
  });
  ok('Entra desde el borde izquierdo y deja ver algo de la página',
    caja.x === 0 && caja.ancho < 390, `${caja.ancho}px de ancho`);
  const barra = await p.evaluate(() => {
    const c = document.querySelector('.app-header').getBoundingClientRect();
    const n = document.getElementById('nav-lateral').getBoundingClientRect();
    return { finBarra: Math.round(c.bottom), inicioCajon: Math.round(n.top) };
  });
  ok('El cajón empieza debajo de la barra, que se queda a la vista',
    barra.inicioCajon >= barra.finBarra - 1, `barra hasta ${barra.finBarra}px · cajón desde ${barra.inicioCajon}px`);
  ok('Y el ☰ sigue accesible con el cajón abierto', await visible('#btn-menu'));
  const grupos = await p.$$eval('.nav-grupo:not([hidden]) .nav-titulo', ts => ts.map(t => t.textContent.trim()));
  ok('Los apartados salen agrupados, como en la computadora', grupos.length >= 3, grupos.join(' · '));
  await p.screenshot({ path: 'pruebas/cel-cajon.png' });

  // ── 4) Elegir un apartado lo abre y cierra el cajón ──
  await p.click('#nav-kardex');
  await p.waitForTimeout(600);
  ok('Al elegir un apartado, se abre', await visible('#view-kardex'));
  ok('Y el cajón se cierra solo', !(await visible('#nav-lateral')));
  ok('El destino queda marcado como activo',
    await p.$eval('#nav-kardex', e => e.classList.contains('activo')));
  await p.screenshot({ path: 'pruebas/cel-seccion.png', clip: { x: 0, y: 0, width: 390, height: 500 } });

  // ── 5) Las otras formas de cerrarlo ──
  await p.click('#btn-menu'); await p.waitForTimeout(450);
  await p.click('#nav-velo', { position: { x: 360, y: 700 } }); await p.waitForTimeout(450);
  ok('Tocando fuera se cierra', !(await visible('#nav-lateral')));
  await p.click('#btn-menu'); await p.waitForTimeout(450);
  await p.click('#btn-nav-cerrar'); await p.waitForTimeout(450);
  ok('Con la ✕ también', !(await visible('#nav-lateral')));
  await p.click('#btn-menu'); await p.waitForTimeout(450);
  await p.keyboard.press('Escape'); await p.waitForTimeout(450);
  ok('Y con Escape', !(await visible('#nav-lateral')));

  // ── 6) El ☰ vuelve a cerrarlo ──
  await p.click('#btn-menu'); await p.waitForTimeout(450);
  await p.click('#btn-menu'); await p.waitForTimeout(450);
  ok('El mismo ☰ lo cierra', !(await visible('#nav-lateral')));

  // ── 7) Al ensanchar la ventana el panel vuelve a estar fijo ──
  await p.click('#btn-menu'); await p.waitForTimeout(400);
  await p.setViewportSize({ width: 1400, height: 900 });
  await p.waitForTimeout(600);
  ok('En pantalla ancha el panel vuelve a estar siempre a la vista', await visible('#nav-lateral'));
  ok('Y el velo no se queda encima', !(await visible('#nav-velo')));
  const empuja = await p.evaluate(() => parseInt(getComputedStyle(document.body).paddingLeft, 10));
  ok('El contenido vuelve a correrse para dejarle sitio', empuja > 60, empuja + 'px');

  // ── 8) Otros tamaños: teléfono chico y tablet vertical ──
  // Ya no hay ningún botón "＋" que sumarle a la barra: crear un crédito
  // suelto no existe, nace de la nota de venta. La cabecera queda igual de
  // simple en todas las secciones, así que se mide en Créditos porque es
  // donde se estaba mirando, sin que sea ya un caso más apretado que otro.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#btn-menu'); await p.waitForTimeout(400);
  await p.click('#nav-inicio'); await p.waitForTimeout(600);
  for (const [an, al, nombre] of [[320, 700, 'teléfono muy angosto'], [360, 780, 'teléfono chico'], [768, 1024, 'tablet vertical']]) {
    await p.setViewportSize({ width: an, height: al });
    await p.waitForTimeout(500);
    const desborda = await p.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const filas = await p.evaluate(() => Math.round(document.querySelector('.app-header').getBoundingClientRect().height));
    ok(`En ${nombre} la cabecera no se sale ni se parte`, !desborda && filas <= 72, `${an}px · ${filas}px de alto`);
    await p.click('#btn-menu'); await p.waitForTimeout(450);
    const ancho = await p.evaluate(() => Math.round(document.getElementById('nav-lateral').getBoundingClientRect().width));
    ok(`Y el cajón sigue dejando ver la página detrás`, ancho < an, `${ancho}px de ${an}px`);
    await p.click('#btn-menu'); await p.waitForTimeout(400);
    await p.screenshot({ path: `pruebas/cel-${an}.png`, clip: { x: 0, y: 0, width: an, height: 140 } });
  }

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 4) : 'ninguno');
  await b.close();
})();
