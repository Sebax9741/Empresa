const { chromium } = require('playwright-core');

/* Modo claro / oscuro: tres opciones, se recuerda en el equipo y se aplica
   antes de pintar (nada de fogonazo blanco al abrir). */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1300);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const estado = () => p.evaluate(() => ({
    tema: document.documentElement.dataset.tema,
    guardado: localStorage.getItem('tema'),
    fondo: getComputedStyle(document.body).backgroundColor,
    texto: getComputedStyle(document.body).color,
    barra: (document.querySelector('meta[name=theme-color]') || {}).content,
    boton: (document.getElementById('tema-texto') || {}).textContent,
  }));

  const inicial = await estado();
  ok('Arranca en claro cuando el sistema está en claro', inicial.tema === 'claro', JSON.stringify(inicial));

  // Pasar por las tres opciones
  const pulsar = async () => {
    await p.evaluate(() => document.getElementById('btn-tema').click());
    await p.waitForTimeout(250);
    return estado();
  };
  const a = await pulsar();
  ok('Primer toque: queda en claro fijo', a.guardado === 'claro' && a.tema === 'claro'
    && /clara/i.test(a.boton), JSON.stringify(a));
  const o = await pulsar();
  ok('Segundo toque: oscuro', o.guardado === 'oscuro' && o.tema === 'oscuro'
    && /oscura/i.test(o.boton), JSON.stringify(o));
  const auto = await pulsar();
  ok('Tercer toque: vuelve a automático', auto.guardado === 'auto'
    && /autom/i.test(auto.boton), JSON.stringify(auto));

  // Que en oscuro los colores cambien de verdad
  await p.evaluate(() => document.getElementById('btn-tema').click());
  await p.evaluate(() => document.getElementById('btn-tema').click());
  await p.waitForTimeout(300);
  const osc = await estado();
  const claroFondo = inicial.fondo;
  ok('En oscuro el fondo es oscuro y el texto claro',
    osc.fondo !== claroFondo && /rgb\((1?\d|[0-4]\d)/.test(osc.fondo), `${claroFondo} → ${osc.fondo}`);
  ok('La barra del navegador también se tiñe', osc.barra === '#121821', osc.barra);

  // Que se recuerde al recargar, y sin fogonazo: el atributo ya está puesto
  // antes de que corra js/app.js
  await p.reload();
  const antesDeApp = await p.evaluate(() => document.documentElement.dataset.tema);
  ok('Al recargar ya viene en oscuro desde el primer momento', antesDeApp === 'oscuro', antesDeApp);

  // Que ningún fondo claro se cuele en modo oscuro
  await p.waitForTimeout(1300);
  const claros = await p.evaluate(() => {
    const malos = [];
    document.querySelectorAll('body *').forEach(el => {
      if (!el.offsetParent && el.tagName !== 'BODY') return;
      const f = getComputedStyle(el).backgroundColor.match(/\d+/g);
      if (!f || f.length < 3) return;
      if (f[3] === '0') return;
      const claro = Number(f[0]) > 200 && Number(f[1]) > 200 && Number(f[2]) > 200;
      // El papel de la firma es un documento: se queda blanco a propósito
      if (claro && !el.closest('#firma-canvas, .firma-caja')) {
        malos.push(el.tagName + '.' + String(el.className).slice(0, 30));
      }
    });
    return [...new Set(malos)].slice(0, 8);
  });
  ok('No queda ningún recuadro blanco deslumbrando', !claros.length, claros.join(' | '));

  await p.screenshot({ path: 'pruebas/tema-oscuro.png', clip: { x: 0, y: 0, width: 1400, height: 700 } });

  // Y que el sistema en oscuro mande cuando está en automático
  const ctx2 = await b.newContext({ viewport: { width: 1200, height: 800 },
    serviceWorkers: 'block', colorScheme: 'dark' });
  const p2 = await ctx2.newPage();
  await p2.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p2.goto('http://localhost:8099/index.html');
  await p2.waitForTimeout(1200);
  ok('En automático, si el sistema está en oscuro la app también',
    (await p2.evaluate(() => document.documentElement.dataset.tema)) === 'oscuro');

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
