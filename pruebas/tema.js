const { chromium } = require('playwright-core');

/* Modo claro / oscuro: dos posiciones, arranca SIEMPRE en claro, se recuerda
   en el equipo y se aplica antes de pintar (nada de fogonazo al abrir). */
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
    boton: (document.getElementById('btn-tema') || {}).title,
    // Cómo está dibujado el icono ahora mismo
    rayos: (() => {
      const r = document.querySelector('.tema-rayos');
      if (!r) return null;
      const cs = getComputedStyle(r);
      return { opacidad: Number(cs.opacity), transformado: cs.transform !== 'none' };
    })(),
  }));

  const inicial = await estado();
  ok('Arranca en claro y sin nada guardado todavía',
    inicial.tema === 'claro' && !inicial.guardado, JSON.stringify(inicial));
  ok('El botón está en la barra de arriba, a la vista, sin abrir ningún menú',
    await p.evaluate(() => {
      const b = document.getElementById('btn-tema');
      if (!b || !b.offsetParent) return false;
      const r = b.getBoundingClientRect();
      // Que se vea de verdad en ese punto, no solo que exista
      const encima = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.top < 120 && !!encima && b.contains(encima);
    }));

  // Ir y volver con el botón
  const pulsar = async () => {
    await p.evaluate(() => document.getElementById('btn-tema').click());
    await p.waitForTimeout(250);
    return estado();
  };
  const osc = await pulsar();
  ok('Un toque desde claro: se va a oscuro y queda guardado',
    osc.guardado === 'oscuro' && osc.tema === 'oscuro', JSON.stringify(osc));
  ok('Y el botón ya ofrece el camino de vuelta', /claro/i.test(osc.boton), osc.boton);

  const vuelta = await pulsar();
  ok('Otro toque y vuelve a claro', vuelta.guardado === 'claro' && vuelta.tema === 'claro',
    JSON.stringify(vuelta));

  // ── El icono se transforma, no se cambia por otro ──
  const rayosClaro = vuelta.rayos;
  await p.evaluate(() => document.getElementById('btn-tema').click());
  await p.waitForTimeout(600);
  const osc2 = await estado();
  // Con margen a propósito: se mide mientras el icono se está moviendo, así
  // que pedir un 1 y un 0 exactos sería pedir que la animación no exista
  ok('En claro los rayos del sol se ven, y en oscuro se recogen',
    rayosClaro.opacidad > 0.9 && osc2.rayos.opacidad < 0.1,
    `claro ${rayosClaro.opacidad.toFixed(2)} → oscuro ${osc2.rayos.opacidad.toFixed(2)}`);
  const muerde = await p.evaluate(() => {
    const m = document.querySelector('.tema-muerde');
    return { transform: getComputedStyle(m).transform, transicion: getComputedStyle(m).transitionDuration };
  });
  ok('El mordisco que hace la luna entra de verdad, y con animación',
    /matrix/.test(muerde.transform) && parseFloat(muerde.transicion) > 0, JSON.stringify(muerde));
  ok('Es un solo dibujo que se dobla, no dos que se cambian',
    (await p.evaluate(() => document.querySelectorAll('#btn-tema svg').length)) === 1);
  const claroFondo = inicial.fondo;
  ok('En oscuro el fondo es oscuro y el texto claro',
    osc.fondo !== claroFondo && /rgb\((1?\d|[0-4]\d)/.test(osc.fondo), `${claroFondo} → ${osc.fondo}`);
  ok('La barra del navegador también se tiñe', osc.barra === '#121821', osc.barra);

  // Que se recuerde al recargar, y sin fogonazo: el atributo ya está puesto
  // antes de que corra js/app.js
  await p.reload();
  const antesDeApp = await p.evaluate(() => ({
    tema: document.documentElement.dataset.tema,
    barra: document.querySelector('meta[name=theme-color]').content,
  }));
  ok('Al recargar ya viene en oscuro desde el primer momento',
    antesDeApp.tema === 'oscuro', JSON.stringify(antesDeApp));
  ok('Y la franja del teléfono también, sin esperar a que cargue la app',
    antesDeApp.barra === '#121821', antesDeApp.barra);

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

  // Lo que tenga puesto el equipo NO manda: quien abre la app por primera vez
  // en un teléfono en modo noche tiene que verla clara, como siempre
  const ctx2 = await b.newContext({ viewport: { width: 1200, height: 800 },
    serviceWorkers: 'block', colorScheme: 'dark' });
  const p2 = await ctx2.newPage();
  await p2.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p2.goto('http://localhost:8099/index.html');
  await p2.waitForTimeout(1200);
  const conEquipoOscuro = await p2.evaluate(() => document.documentElement.dataset.tema);
  ok('Con el equipo en modo noche, la app sigue arrancando clara',
    conEquipoOscuro === 'claro', conEquipoOscuro);

  // Y al revés: quien eligió oscuro lo conserva aunque su equipo esté claro
  const ctx3 = await b.newContext({ viewport: { width: 1200, height: 800 },
    serviceWorkers: 'block', colorScheme: 'light' });
  const p3 = await ctx3.newPage();
  await p3.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p3.goto('http://localhost:8099/index.html');
  await p3.evaluate(() => localStorage.setItem('tema', 'oscuro'));
  await p3.reload();
  await p3.waitForTimeout(900);
  const elegidoOscuro = await p3.evaluate(() => document.documentElement.dataset.tema);
  ok('Lo elegido a mano se respeta aunque el equipo esté en claro',
    elegidoOscuro === 'oscuro', elegidoOscuro);

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
