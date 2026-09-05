const { chromium } = require('playwright-core');

/* Mientras los datos vienen en camino se enseñan filas de mentira, no el
   aviso de "aún no hay créditos": eso último es una respuesta —y falsa— a una
   pregunta que todavía no se puede contestar. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));

  // Se frena la base local para poder mirar el rato de carga, que si no dura
  // dos parpadeos no se puede comprobar nada.
  // Se hace sirviendo js/db.js con un añadido al final: DB es una constante
  // del propio guion, no una propiedad de window, así que desde fuera no se
  // puede tocar — pero dentro de su mismo archivo sí.
  await p.route('**/js/db.js', async r => {
    const original = await r.fetch();
    const cuerpo = await original.text();
    await r.fulfill({
      contentType: 'application/javascript',
      body: cuerpo + `
;(() => {
  const antes = DB.getAll.bind(DB);
  DB.getAll = async () => { await new Promise(r => setTimeout(r, 2500)); return antes(); };
})();`,
    });
  });

  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(900);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' → ' + x : ''}`);

  const cargando = await p.evaluate(() => ({
    esqueletos: document.querySelectorAll('#table-body .esqueleto').length,
    filas: document.querySelectorAll('#table-body .esqueleto-fila').length,
    vacioVisible: !document.getElementById('empty-state').hidden,
    // ¿de verdad se ve, o está detrás de algo?
    pintado: (() => {
      const e = document.querySelector('#table-body .esqueleto');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const enPunto = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!enPunto && (enPunto === e || e.contains(enPunto) || enPunto.contains(e));
    })(),
    animado: (() => {
      const e = document.querySelector('.esqueleto');
      return e ? getComputedStyle(e).animationName : null;
    })(),
  }));
  ok('Mientras carga se ven filas de esqueleto', cargando.filas >= 5, `${cargando.filas} filas`);
  ok('Y NO se dice "aún no hay créditos", que sería mentira', !cargando.vacioVisible);
  ok('Los esqueletos se ven de verdad, no están tapados', cargando.pintado === true);
  ok('Y tienen su brillo en marcha', cargando.animado === 'esqueletoBrilla', cargando.animado);

  await p.screenshot({ path: 'pruebas/esqueleto-cargando.png', clip: { x: 0, y: 0, width: 1400, height: 620 } });

  // Al terminar la carga se van, y como no hay datos ahora SÍ toca el aviso
  await p.waitForTimeout(2600);
  const listo = await p.evaluate(() => ({
    esqueletos: document.querySelectorAll('.esqueleto').length,
    vacioVisible: !document.getElementById('empty-state').hidden,
    textoVacio: document.getElementById('empty-state').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('Cuando llegan los datos, los esqueletos desaparecen', listo.esqueletos === 0, `${listo.esqueletos} quedan`);
  ok('Y ahí sí se avisa de que no hay nada', listo.vacioVisible);
  ok('El aviso ya no manda a un botón que no existe',
    !/Nuevo crédito/.test(listo.textoVacio) && /nota de venta/i.test(listo.textoVacio),
    listo.textoVacio.slice(0, 80));

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
