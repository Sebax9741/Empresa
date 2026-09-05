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

  const tipo = await p.evaluate(() => {
    const estilo = selector => getComputedStyle(document.querySelector(selector));
    return {
      fuente: estilo('#view-dashboard').fontFamily,
      interCargada: document.fonts.check('14px Inter'),
      titulo: estilo('.dash-titulo').fontSize,
      indicador: estilo('.kpi-et').fontSize,
      panel: estilo('.panel-titulo').fontSize,
      mayusculas: estilo('.kpi-et').textTransform,
    };
  });
  ok('La escala tipográfica del Dashboard sigue la jerarquía de Shopify',
    tipo.fuente.startsWith('Inter') && tipo.interCargada && tipo.titulo === '24px' && tipo.indicador === '13px' && tipo.panel === '14px' && tipo.mayusculas === 'none',
    JSON.stringify(tipo));

  const primeraKpi = await p.locator('#dash-kpis .kpi').first().boundingBox();
  await p.mouse.move(primeraKpi.x + primeraKpi.width / 2, primeraKpi.y + primeraKpi.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(80);
  const durantePresion = await p.locator('#dash-kpis .kpi').first().evaluate(el => getComputedStyle(el).transform);
  await p.mouse.up();
  const pulsoCompleto = await p.locator('#dash-kpis .kpi').first().evaluate(el => ({
    clase: el.classList.contains('dash-pulsado'),
    animacion: getComputedStyle(el).animationName,
  }));
  // Se aparta del panel lateral: en el borde izquierdo se abriría encima del
  // Dashboard y la captura dejaría de mostrar lo que esta prueba documenta.
  await p.mouse.move(1498, 500);
  await p.waitForTimeout(360);
  const despuesPresion = await p.locator('#dash-kpis .kpi').first().evaluate(el => getComputedStyle(el).transform);
  ok('Los indicadores muestran el pulso completo y vuelven a su sitio',
    durantePresion !== 'none' && pulsoCompleto.clase && pulsoCompleto.animacion === 'pulsarDashboard' && despuesPresion === 'none',
    JSON.stringify({ durantePresion, pulsoCompleto, despuesPresion }));

  // La navegación a Créditos sigue intacta. El crédito ya no se crea suelto:
  // nace al guardar una nota de venta, por eso aquí no se busca aquel botón.
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(450);
  const enCreditos = await p.evaluate(() => {
    const vista = document.getElementById('view-creditos');
    return { visible: !!vista && !vista.hidden };
  });
  ok('El apartado "Créditos y Pagados" sigue abriendo',
    enCreditos.visible, JSON.stringify(enCreditos));

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
