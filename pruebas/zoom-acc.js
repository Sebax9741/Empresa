const { chromium } = require('playwright-core');

/* Los emojis del sistema pasan a ser iconos en color propios de la app. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block', deviceScaleFactor: 4 });
  const p = await ctx.newPage();
  const errs = [], fallos404 = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('response', r => { if (r.status() >= 400 && /icons\/emoji/.test(r.url())) fallos404.push(r.url().split('/').pop()); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1800);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const quedanEmojis = () => p.evaluate(() => {
    // Se busca emoji suelto en el texto visible, saltando lo que no admite imágenes
    const malos = [];
    const paseo = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const salta = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP', 'TITLE']);
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2139}\u{23F0}-\u{23FF}]️?/u;
    while (paseo.nextNode()) {
      const n = paseo.currentNode, pa = n.parentElement;
      if (!pa || salta.has(pa.tagName) || !pa.offsetParent && pa.tagName !== 'BODY') continue;
      const m = n.nodeValue.match(re);
      // Los símbolos tipográficos (─ ═ ▸ ✕ ✓ → ◀) no son emojis y se quedan
      if (m && !/[─-◿←-⇿✓✕☰]/.test(m[0])) {
        malos.push(m[0] + ' en <' + pa.tagName.toLowerCase() + '> ' + n.nodeValue.trim().slice(0, 40));
      }
    }
    return malos;
  });

  // ── 1) Al arrancar ──
  const n0 = await p.$$eval('img.emo', i => i.length);
  ok('La página arranca con los emojis ya cambiados por iconos', n0 > 20, n0 + ' iconos');
  const sueltos = await quedanEmojis();
  ok('No queda ningún emoji del sistema a la vista', sueltos.length === 0, sueltos.slice(0, 4).join(' | '));

  // ── 2) Los iconos existen de verdad ──
  const rotos = await p.$$eval('img.emo', imgs =>
    imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
  ok('Todos los iconos cargan', rotos.length === 0 && fallos404.length === 0,
    [...new Set([...rotos, ...fallos404])].slice(0, 5).join(', '));

  const medida = await p.$$eval('img.emo', imgs => {
    // Se mide uno que esté a la vista: los de las secciones ocultas miden 0
    const v = imgs.find(i => i.getBoundingClientRect().width > 0);
    const r = v ? v.getBoundingClientRect() : { width: 0, height: 0 };
    return { ancho: Math.round(r.width), alto: Math.round(r.height), visibles: imgs.filter(i => i.getBoundingClientRect().width > 0).length };
  });
  ok('Tienen tamaño de letra, no de sello', medida.ancho >= 12 && medida.ancho <= 34,
    `${medida.ancho}×${medida.alto}px · ${medida.visibles} a la vista`);

  // ── 3) Los botones de información y editar ──
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(400);
  await p.fill('#cli-nombre', 'Teresa');
  await p.selectOption('#cli-zona', 'MILAGROS');
  await p.selectOption('#cli-categoria', 'B');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(900);
  // Un crédito ya no se crea a mano: nace de una nota de venta que sale a
  // reparto y vuelve firmada. Así que hay que recorrer el camino entero.
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(400);
  await p.fill('#prod-nombre', 'HARINA X50KG');
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(700);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(350);
  await p.fill('#ing-cantidad', '60');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(350);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1000);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(800);
  await p.fill('#nv-cliente-buscar', 'Teresa');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(350);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(350);
  await p.fill('#nv-cantidad', '10');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(450);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1500);

  await p.evaluate(() => document.getElementById('nav-despachos').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('btn-desp-repartidores').click());
  await p.waitForTimeout(500);
  await p.fill('#rep-nombre', 'LUIS PEREZ');
  await p.evaluate(() => document.querySelector('#rep-form button[type=submit]').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#desp-notas-lista [data-elegir-nota]').click());
  await p.waitForTimeout(450);
  await p.evaluate(() => document.getElementById('btn-desp-pasar').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const c = document.querySelector('#desp-repartidores-check input');
    if (c) c.click();
    document.querySelector('#desp-form button[type=submit]').click();
  });
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const fila = document.querySelector('.desp-fila, .despacho-card');
    if (fila) fila.click();
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const btn = document.getElementById('btn-desp-a-credito');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.getElementById('btn-guardar').click());
  await p.waitForTimeout(1600);
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(700);

  const acciones = await p.evaluate(() => {
    const fila = document.querySelector('.row-actions');
    const de = sel => {
      const b = fila.querySelector(sel);
      if (!b) return null;
      const img = b.querySelector('img.emo');
      return img ? { src: img.getAttribute('src'), ancho: Math.round(img.getBoundingClientRect().width) } : 'sin icono';
    };
    return { info: de('[data-info]'), editar: de('[data-editar]'), borrar: de('[data-borrar]') };
  });
  ok('El botón de información lleva su icono en color',
    acciones.info && acciones.info.src && /2139/.test(acciones.info.src), JSON.stringify(acciones.info));
  ok('El de editar también', acciones.editar && /270f/.test(acciones.editar.src || ''), JSON.stringify(acciones.editar));
  ok('Y el de quitar', acciones.borrar && /1f5d1/.test(acciones.borrar.src || ''), JSON.stringify(acciones.borrar));
  ok('En esos botones el icono va más grande',
    acciones.info.ancho >= 18, acciones.info.ancho + 'px');

  // ── 4) Lo que se dibuja después también se cambia ──
  await p.evaluate(() => document.querySelector('[data-info]').click());
  await p.waitForTimeout(900);
  const enFicha = await p.$$eval('#modal-info img.emo', i => i.length);
  ok('La ficha que se abre después también sale con iconos', enFicha > 0, enFicha + ' iconos');
  const sueltos2 = await quedanEmojis();
  ok('Y ahí tampoco queda ningún emoji suelto', sueltos2.length === 0, sueltos2.slice(0, 3).join(' | '));
  await p.screenshot({ path: 'pruebas/iconos-ficha.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-info').getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  }) });
  await p.evaluate(() => document.getElementById('btn-info-cerrar').click());
  await p.waitForTimeout(500);

  // ── 5) Los avisos del navegador NO llevan imágenes (no se pueden) ──
  const enSelect = await p.evaluate(() =>
    (document.querySelector('#f-pago-metodo option') || {}).textContent || '');
  ok('En las listas desplegables el emoji se queda como texto (ahí no cabe una imagen)',
    /[\u{1F000}-\u{1FAFF}]/u.test(enSelect), enSelect.trim());

  // ── 6) No se dispara un repaso sin fin ──
  const vueltas = await p.evaluate(async () => {
    let n = 0;
    const o = new MutationObserver(ms => { n += ms.length; });
    o.observe(document.body, { childList: true, subtree: true, characterData: true });
    await new Promise(r => setTimeout(r, 2500));
    o.disconnect();
    return n;
  });
  ok('La página no se queda repasándose a sí misma', vueltas < 60, vueltas + ' cambios en 2,5 s');

  await p.screenshot({ path: 'pruebas/iconos-lista.png', clip: { x: 0, y: 0, width: 1500, height: 620 } });
  { const a = await p.$('.row-actions'); if (a) await a.screenshot({ path: 'pruebas/z-acciones.png' }); }

  // ── 7) Las dos versiones del juego, cada una en su sitio ──
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(700);
  const modos = await p.$$eval('.ing-modo-ico img.emo', is => is.map(i => ({
    src: i.getAttribute('src'), px: Math.round(i.getBoundingClientRect().width), chip: i.classList.contains('emo-chip') })));
  ok('Las tarjetas de modo llevan el icono con su recuadro de color',
    modos.length === 2 && modos.every(m => m.src.includes('/chip/') && m.chip),
    modos.map(m => m.src.split('/').pop()).join(' + '));
  ok('Y ahí el icono va en grande, como símbolo de la tarjeta',
    modos.every(m => m.px >= 34), modos.map(m => m.px + 'px').join(' + '));
  const rotosChip = await p.$$eval('.ing-modo-ico img.emo', is => is.filter(i => i.complete && !i.naturalWidth).length);
  ok('Los iconos con recuadro cargan de verdad', rotosChip === 0);

  await p.evaluate(() => document.getElementById('nav-dashboard').click());
  await p.waitForTimeout(700);
  const kpis = await p.$$eval('.kpi-ico img.emo', is => is.map(i => ({
    chip: i.getAttribute('src').includes('/chip/'), px: Math.round(i.getBoundingClientRect().width) })));
  ok('Las tarjetas del Dashboard llevan el icono suelto (el recuadro ya lo pone la tarjeta)',
    kpis.length > 0 && kpis.every(k => !k.chip), kpis.length + ' tarjetas');
  ok('Y dentro de su recuadro el icono se ve, no nada en la caja',
    kpis.every(k => k.px === 22), [...new Set(kpis.map(k => k.px))].join('/') + 'px');

  // En ningún otro sitio debe colarse la versión con recuadro
  const chipSueltos = await p.evaluate(() => [...document.querySelectorAll('img.emo')]
    .filter(i => i.getAttribute('src').includes('/chip/') && !i.closest('.ing-modo-ico'))
    .map(i => i.getAttribute('src')));
  ok('La versión con recuadro no se cuela en ningún otro sitio', chipSueltos.length === 0, chipSueltos.slice(0, 3).join(' | '));

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
