const { chromium } = require('playwright-core');

/* Los desplegables ya no los dibuja el sistema: son el menú de la casa. Lo
   que importa es que por debajo sigan siendo el mismo <select> de siempre —
   mismo valor, mismo "change"— para que nada del resto se entere. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1400);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── 1) Todos los desplegables quedaron cambiados ──
  const cuenta = await p.evaluate(() => ({
    selects: document.querySelectorAll('select').length,
    caras: document.querySelectorAll('.sel-cara').length,
    sinCara: [...document.querySelectorAll('select')].filter(s => !s.dataset.menuListo).map(s => s.id),
  }));
  ok('Todos los desplegables de la página tienen su cara nueva',
    cuenta.selects > 0 && cuenta.caras === cuenta.selects && !cuenta.sinCara.length,
    JSON.stringify(cuenta));

  // ── 2) La cara dice lo mismo que el select ──
  const coinciden = await p.evaluate(() => [...document.querySelectorAll('select')].map(s => {
    const o = s.options[s.selectedIndex];
    const cara = document.getElementById(s.id + '-cara');
    const limpia = x => x.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
    return { id: s.id, igual: !o || limpia(cara.querySelector('.sel-cara-txt').textContent) === limpia(o.textContent) };
  }).filter(x => !x.igual));
  ok('Cada cara enseña la opción que está puesta', !coinciden.length, JSON.stringify(coinciden));

  // ── 3) Elegir con el ratón cambia el valor Y dispara "change" ──
  await p.evaluate(() => {
    window.__cambios = [];
    document.getElementById('sort-by').addEventListener('change', e => window.__cambios.push(e.target.value));
  });
  await p.evaluate(() => document.getElementById('sort-by-cara').click());
  await p.waitForTimeout(300);
  const menu = await p.evaluate(() => {
    const m = document.querySelector('.sel-menu');
    return { existe: !!m, opciones: m ? m.querySelectorAll('.menu-item').length : 0,
      elegido: m ? (m.querySelector('.menu-item.elegido') || {}).textContent : null };
  });
  ok('Se abre el menú de la casa con todas las opciones y la actual marcada',
    menu.existe && menu.opciones === 18 && /Recientes/.test(menu.elegido || ''), JSON.stringify(menu));

  await p.evaluate(() => [...document.querySelectorAll('.sel-menu .menu-item')]
    .find(b => /Nro boleta ↑/.test(b.textContent)).click());
  await p.waitForTimeout(400);
  const tras = await p.evaluate(() => ({
    valor: document.getElementById('sort-by').value,
    cara: document.querySelector('#sort-by-cara .sel-cara-txt').textContent,
    cambios: window.__cambios,
    menuCerrado: !document.querySelector('.sel-menu'),
  }));
  ok('Al elegir: cambia el valor, se avisa con "change" y el menú se cierra',
    tras.valor === 'boleta-asc' && /Nro boleta/.test(tras.cara)
      && tras.cambios.includes('boleta-asc') && tras.menuCerrado, JSON.stringify(tras));

  // ── 4) Si el programa le pone un valor a mano, la cara se entera ──
  await p.evaluate(() => { document.getElementById('sort-by').value = 'vencimiento-asc'; });
  await p.waitForTimeout(150);
  ok('Poniendo el valor desde el guion, la cara se actualiza sola',
    /Vencimiento ↑/.test(await p.evaluate(() => document.querySelector('#sort-by-cara .sel-cara-txt').textContent)));

  // ── 5) Un desplegable que se llena después (zonas) ──
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(400);
  const zonas = await p.evaluate(() => ({
    opciones: document.getElementById('cli-zona').options.length,
    cara: document.querySelector('#cli-zona-cara .sel-cara-txt').textContent,
  }));
  ok('Un desplegable que el programa llena después también queda al día',
    zonas.opciones > 1, JSON.stringify(zonas));

  await p.evaluate(() => document.getElementById('cli-zona-cara').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('.sel-menu .menu-item')]
    .find(b => /CIUDAD/.test(b.textContent)).click());
  await p.waitForTimeout(250);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(900);
  const guardado = await p.evaluate(() => {
    const t = document.getElementById('clientes-list').textContent;
    return /BODEGA LA ESQUINA/.test(t) && /CIUDAD/.test(t);
  });
  ok('Un formulario obligatorio se guarda con lo elegido en el menú nuevo', guardado);

  // ── 6) Con el teclado ──
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('sort-by-cara').focus());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const conTeclado = await p.evaluate(() => ({
    valor: document.getElementById('sort-by').value,
    cerrado: !document.querySelector('.sel-menu'),
    foco: document.activeElement.id,
  }));
  ok('Se puede usar solo con el teclado, y el foco vuelve al botón',
    conTeclado.cerrado && conTeclado.foco === 'sort-by-cara', JSON.stringify(conTeclado));

  // ── 7) Bloqueado cuando el select está bloqueado (solo lectura) ──
  await p.evaluate(() => { document.getElementById('sort-by').disabled = true; });
  await p.waitForTimeout(200);
  ok('Si el desplegable se bloquea, su cara también',
    await p.evaluate(() => document.getElementById('sort-by-cara').disabled));
  await p.evaluate(() => { document.getElementById('sort-by').disabled = false; });

  // ── 8) Que se VEA, no solo que exista ──
  // Una ventana <dialog> se dibuja en una capa por encima de todo: un menú
  // colgado del body queda detrás y no se ve, aunque el guion sí lo encuentre.
  // Por eso aquí no basta con mirar el DOM: se pregunta qué hay pintado en ese
  // punto de la pantalla. Se recorren TODOS los desplegables que viven dentro
  // de una ventana, abriéndola a propósito.
  await p.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.sel-menu').forEach(m => m.remove());
  });
  const enVentanas = await p.evaluate(() => [...document.querySelectorAll('select')]
    .filter(s => s.closest('dialog'))
    .map(s => ({ id: s.id, ventana: s.closest('dialog').id })));

  const tapados = [];
  for (const d of enVentanas) {
    const visto = await p.evaluate(({ id, ventana }) => {
      const v = document.getElementById(ventana);
      if (!v.open) v.showModal();
      const cara = document.getElementById(id + '-cara');
      cara.click();
      const m = v.querySelector('.sel-menu') || document.querySelector('.sel-menu');
      if (!m) return { id, motivo: 'no se abrió' };
      const r = m.getBoundingClientRect();
      const encima = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 16));
      const ok = !!encima && m.contains(encima);
      m.remove();
      v.close();
      return ok ? null : { id, motivo: 'tapado por ' + (encima ? encima.tagName + '.' + encima.className : 'nada') };
    }, d);
    if (visto) tapados.push(visto);
  }
  ok(`Dentro de una ventana el menú se ve de verdad (${enVentanas.length} desplegables)`,
    !tapados.length, JSON.stringify(tapados));

  // ── 9) Foto del menú abierto ──
  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('kdx-fil-tipo-cara').click());
  await p.waitForTimeout(350);
  await p.screenshot({ path: 'pruebas/menu-desplegable.png', clip: { x: 0, y: 0, width: 1000, height: 560 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
