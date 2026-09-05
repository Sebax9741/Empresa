const { chromium } = require('playwright-core');

/* El Dashboard es solo para mirar: no lleva botones de acción. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
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

  await p.evaluate(() => document.getElementById('nav-dashboard').click());
  await p.waitForTimeout(500);

  const cab = await p.evaluate(() => {
    const d = document.querySelector('#view-dashboard .dash-cab');
    return {
      botones: d.querySelectorAll('button').length,
      viejos: ['btn-dash-nuevo', 'btn-dash-cobranza'].filter(i => document.getElementById(i)),
      texto: d.textContent.replace(/\s+/g, ' ').trim(),
      titulo: !!d.querySelector('.dash-titulo'),
    };
  });
  ok('La cabecera del Dashboard ya no lleva botones',
    cab.botones === 0 && cab.viejos.length === 0, JSON.stringify(cab.viejos));
  ok('No queda "Nuevo crédito" ni "Hoja de hoy" en el Dashboard',
    !/Nuevo crédito/i.test(cab.texto) && !/Hoja de hoy/i.test(cab.texto), cab.texto);
  // Se comprueba que haya una fecha, sin atarla a un día concreto
  ok('El título y la fecha siguen en su sitio',
    cab.titulo && /\d{1,2} de [a-zá-ú]+ de \d{4}/.test(cab.texto), cab.texto);

  // Los KPIs y los paneles no se tocaron
  const cuerpo = await p.evaluate(() => ({
    kpis: document.querySelectorAll('#dash-kpis .kpi, #dash-kpis > *').length,
    paneles: document.querySelectorAll('#view-dashboard .panel').length,
  }));
  ok('Los indicadores y los paneles del Dashboard siguen ahí',
    cuerpo.kpis >= 6 && cuerpo.paneles >= 2, JSON.stringify(cuerpo));

  // Se sigue pudiendo crear un crédito desde Créditos
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(450);
  const enCreditos = await p.evaluate(() => {
    const b = document.getElementById('btn-new');
    return { visible: !b.hidden, ancho: Math.round(b.getBoundingClientRect().width) };
  });
  ok('En Créditos el botón "＋ Nuevo crédito" sigue disponible',
    enCreditos.visible && enCreditos.ancho > 50, JSON.stringify(enCreditos));

  // Y la hoja de cobranza desde su apartado
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(500);
  ok('La hoja de cobranza se sigue abriendo desde su apartado',
    !(await p.evaluate(() => document.getElementById('view-cobranza').hidden)));

  await p.evaluate(() => document.getElementById('nav-dashboard').click());
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'pruebas/dash-sin-botones.png', clip: { x: 0, y: 0, width: 1500, height: 330 } });

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
