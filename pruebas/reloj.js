const { chromium } = require('playwright-core');

/* El reloj va en la cabecera, junto a la cuenta, y no se mueve al cambiar
   de sección. La cabecera ya no lleva título ni emoji. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Ya no hay título ni emoji en la barra superior ──
  const cab = await p.evaluate(() => ({
    titulo: document.querySelectorAll('.app-header h1').length,
    texto: document.querySelector('.header-inner').textContent,
  }));
  ok('La barra superior ya no lleva "Control de Créditos"',
    cab.titulo === 0 && !/Control de Cr/i.test(cab.texto), JSON.stringify(cab.titulo));
  ok('Y no queda el emoji 💳 en la cabecera', !cab.texto.includes('💳'));

  // ── El reloj está en la cabecera, al lado de la cuenta ──
  const sitio = await p.evaluate(() => {
    const reloj = document.getElementById('reloj');
    const r = reloj.getBoundingClientRect();
    const nuevo = document.getElementById('btn-new').getBoundingClientRect();
    return {
      enCabecera: !!reloj.closest('.app-header'),
      // pegado a la cuenta: el reloj es lo que va justo antes del chip de usuario
      antesDeLaCuenta: reloj.nextElementSibling && reloj.nextElementSibling.id === 'usuario-chip',
      pegadoAlBorde: window.innerWidth - r.right < 40,
      trasNuevoCredito: r.left >= nuevo.right - 1,
      centrado: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 80,
    };
  });
  ok('El reloj vive en la barra superior', sitio.enCabecera);
  ok('Va al lado del botón de la cuenta, no al centro',
    sitio.antesDeLaCuenta && sitio.trasNuevoCredito && !sitio.centrado, JSON.stringify(sitio));

  // El botón "＋ Nuevo crédito" solo sale en Créditos: no debe correr el reloj
  const conBoton = await p.evaluate(() => {
    document.getElementById('nav-inicio').click();
    document.getElementById('btn-new').hidden = false;   // como en la nube, con permiso de crear
    const r = document.getElementById('reloj').getBoundingClientRect();
    const n = document.getElementById('btn-new').getBoundingClientRect();
    return { reloj: Math.round(r.left), boton: Math.round(n.width) };
  });
  await p.evaluate(() => document.getElementById('nav-dashboard').click());
  await p.waitForTimeout(300);
  const sinBoton = await p.evaluate(() =>
    Math.round(document.getElementById('reloj').getBoundingClientRect().left));
  ok('Aparecer "＋ Nuevo crédito" no corre el reloj',
    conBoton.reloj === sinBoton && conBoton.boton > 50,
    `con botón ${conBoton.reloj}px = sin botón ${sinBoton}px (botón de ${conBoton.boton}px)`);

  // ── Marca la hora y avanza ──
  const t1 = await p.textContent('#reloj-hora');
  const fecha = await p.textContent('#reloj-fecha');
  ok('Muestra la hora con segundos y a. m. / p. m.',
    /^\d{1,2}:\d{2}:\d{2} [ap]\. m\.$/.test(t1.trim()), t1.trim());
  ok('Muestra el día y la fecha en español',
    /^[A-ZÁÉÍÓÚ][a-zá-ú]+, \d{1,2} de [a-zá-ú]+$/.test(fecha.trim()), fecha.trim());
  await p.waitForTimeout(2200);
  const t2 = await p.textContent('#reloj-hora');
  ok('El reloj avanza solo', t1.trim() !== t2.trim(), `${t1.trim()} → ${t2.trim()}`);

  // ── No se mueve al cambiar de sección ──
  const posiciones = {};
  for (const [nombre, id] of [['dashboard', 'nav-dashboard'], ['créditos', 'nav-inicio'],
    ['productos', 'nav-productos'], ['ingresos', 'nav-ingresos'], ['kardex', 'nav-kardex'],
    ['clientes', 'nav-clientes']]) {
    await p.evaluate(i => document.getElementById(i).click(), id);
    await p.waitForTimeout(350);
    posiciones[nombre] = await p.evaluate(() => {
      const r = document.getElementById('reloj').getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)}`;
    });
  }
  const unicas = new Set(Object.values(posiciones));
  ok('Queda en el mismo lugar en todas las secciones', unicas.size === 1,
    [...unicas].join(' | ') + ` (${Object.keys(posiciones).length} secciones)`);

  // ── Al contraer el panel sigue en su sitio (la cabecera no depende del panel) ──
  await p.evaluate(() => document.getElementById('btn-plegar-nav').click());
  await p.waitForTimeout(600);
  const trasPlegar = await p.evaluate(() => {
    const r = document.getElementById('reloj').getBoundingClientRect();
    return { visible: r.width > 0, texto: document.getElementById('reloj-hora').textContent.trim() };
  });
  ok('Sigue visible con el panel contraído', trasPlegar.visible, trasPlegar.texto);
  await p.evaluate(() => document.getElementById('btn-plegar-nav').click());
  await p.waitForTimeout(500);

  await p.screenshot({ path: 'pruebas/reloj-cabecera.png', clip: await p.evaluate(() => {
    const r = document.querySelector('.app-header').getBoundingClientRect();
    return { x: 0, y: 0, width: window.innerWidth, height: Math.round(r.height) + 4 };
  }) });

  // ── En celular la cabecera no se rompe ──
  await p.setViewportSize({ width: 400, height: 850 });
  await p.waitForTimeout(500);
  const movil = await p.evaluate(() => {
    const r = document.getElementById('reloj').getBoundingClientRect();
    return { visible: r.width > 0, cabe: r.right <= document.body.clientWidth + 1,
      fecha: getComputedStyle(document.getElementById('reloj-fecha')).display };
  });
  ok('En celular se ve la hora y no se sale de la pantalla',
    movil.visible && movil.cabe && movil.fecha === 'none', JSON.stringify(movil));
  await p.screenshot({ path: 'pruebas/reloj-movil.png', clip: { x: 0, y: 0, width: 400, height: 130 } });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
