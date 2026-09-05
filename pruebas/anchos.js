const { chromium } = require('playwright-core');

/* Las dos ventanas grandes tienen que caber enteras en la pantalla del PC,
   también cuando el crédito trae foto y pagos a cuenta. */
const PANTALLAS = [
  ['portátil 1467×861', 1467, 861],
  ['monitor 1600×1000', 1600, 1000],
  ['portátil justo 1366×768', 1366, 768],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  for (const [nombre, ancho, alto] of PANTALLAS) {
    console.log(`\n── ${nombre} ──`);
    const ctx = await b.newContext({ viewport: { width: ancho, height: alto }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    await p.route('**/firebase-config.js', r => r.fulfill({
      contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
    await p.goto('http://localhost:8099/index.html');
    await p.waitForTimeout(1400);

    // Cliente + producto + nota (el crédito nace de ahí). Ya no se crea con
    // foto: se le agrega al editar, y ahí mismo queda guardada.
    await p.evaluate(() => document.getElementById('nav-clientes').click());
    await p.waitForTimeout(450);
    await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
    await p.waitForTimeout(350);
    await p.fill('#cli-nombre', 'Teresa');
    await p.selectOption('#cli-zona', 'MILAGROS');
    await p.selectOption('#cli-categoria', 'B');
    await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
    await p.waitForTimeout(800);

    await p.evaluate(() => document.getElementById('nav-productos').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
    await p.waitForTimeout(350);
    await p.fill('#prod-nombre', 'PROD ANCHO');
    for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '2760');
    await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
    await p.waitForTimeout(600);
    await p.evaluate(() => document.getElementById('nav-ingresos').click());
    await p.waitForTimeout(600);
    await p.fill('#ing-buscar', 'PROD ANCHO');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
    await p.waitForTimeout(300);
    await p.fill('#ing-cantidad', '1');
    await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
    await p.waitForTimeout(300);
    await p.fill('#ing-doc-numero', 'F4137');
    await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
    await p.waitForTimeout(900);

    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(700);
    await p.fill('#nv-correlativo', '4137');
    await p.waitForTimeout(300);
    await p.fill('#nv-cliente-buscar', 'Teresa');
    await p.waitForTimeout(450);
    await p.evaluate(() => { const o = document.querySelector('[data-nv-cliente]'); if (o) o.click(); });
    await p.waitForTimeout(300);
    await p.fill('#nv-buscar-producto', 'PROD ANCHO');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', '1');
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.getElementById('nav-inicio').click());
    await p.waitForTimeout(450);

    // ── Editar para ponerle la foto ──
    await p.evaluate(() => document.querySelector('[data-editar]').click());
    await p.waitForTimeout(900);
    await p.setInputFiles('#f-foto-archivo', 'pruebas/boleta.png');
    await p.waitForTimeout(1600);
    const ed = await p.evaluate(() => {
      const d = document.getElementById('modal-form');
      return { ancho: Math.round(d.getBoundingClientRect().width),
        contenido: d.scrollHeight, ventana: Math.round(d.clientHeight),
        foto: Math.round((document.getElementById('foto-preview') || {}).clientHeight || 0) };
    });
    ok('Editar CON foto cabe entero', ed.contenido <= ed.ventana + 2,
      `contenido ${ed.contenido}px en ${ed.ventana}px (ancho ${ed.ancho}, foto ${ed.foto}px)`);
    if (ancho === 1467) await p.screenshot({ path: 'pruebas/editar-con-foto.png', clip: await p.evaluate(() => {
      const r = document.getElementById('modal-form').getBoundingClientRect();
      return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
    }) });
    // Se GUARDA (no se cancela): la foto tiene que quedar puesta para
    // comprobar después, con la ficha de info, que tampoco se aplasta ahí.
    await p.evaluate(() => document.getElementById('btn-guardar').click());
    await p.waitForTimeout(500);

    // ── Ficha con foto y cobro: que no salga aplastada ──
    await p.evaluate(() => document.querySelector('[data-info]').click());
    await p.waitForTimeout(900);
    const fi = await p.evaluate(() => {
      const d = document.getElementById('modal-info');
      const datos = document.querySelector('.info-col-datos').getBoundingClientRect();
      const montos = Array.from(document.querySelectorAll('.info-monto strong'));
      // Un importe partido en dos líneas es la señal de que la columna va apretada
      const partido = montos.some(m => m.getBoundingClientRect().height > 26);
      const venc = document.getElementById('info-datos');
      return { ancho: Math.round(d.getBoundingClientRect().width),
        colDatos: Math.round(datos.width), partido,
        contenido: d.scrollHeight, ventana: Math.round(d.clientHeight),
        altoMonto: Math.round(montos[0] ? montos[0].getBoundingClientRect().height : 0) };
    });
    ok('La ficha no aplasta los importes', !fi.partido,
      `columna de datos ${fi.colDatos}px · importe de ${fi.altoMonto}px de alto`);
    ok('Y la ficha cabe entera', fi.contenido <= fi.ventana + 2,
      `contenido ${fi.contenido}px en ${fi.ventana}px (ancho ${fi.ancho})`);
    if (ancho === 1467) await p.screenshot({ path: 'pruebas/ficha-con-foto.png', clip: await p.evaluate(() => {
      const r = document.getElementById('modal-info').getBoundingClientRect();
      return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
    }) });

    if (errs.length) console.log('   errores de JS:', errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();
