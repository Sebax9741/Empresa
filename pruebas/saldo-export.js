const { chromium } = require('playwright-core');

/* Exportar "Saldo a una fecha" a PDF (impresión) y a Excel. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 },
    serviceWorkers: 'block', acceptDownloads: true })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1200);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'HARINA X50KG');
  await p.fill('#prod-precio-a', '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(600);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-cantidad', '20');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);

  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-kdx-vista-saldo').click());
  await p.waitForTimeout(500);

  const botones = await p.evaluate(() => ({
    imprimirVisible: !document.getElementById('kdx-saldo-exportar').hidden,
    textoImprimir: document.getElementById('btn-kdx-saldo-imprimir').textContent.trim(),
    textoExcel: document.getElementById('btn-kdx-saldo-excel').textContent.trim(),
  }));
  ok('Hay botones de Imprimir/PDF y Excel en el panel de saldo',
    botones.imprimirVisible && /PDF/.test(botones.textoImprimir) && /Excel/.test(botones.textoExcel),
    JSON.stringify(botones));

  // ── Imprimir / PDF: abre una ventana con la tabla, sin gastar diálogo real ──
  let popup = null;
  p.on('popup', pg => { popup = pg; });
  await p.evaluate(() => document.getElementById('btn-kdx-saldo-imprimir').click());
  await p.waitForTimeout(700);
  const contenidoImpreso = popup ? await popup.evaluate(() => ({
    titulo: document.title,
    filas: document.querySelectorAll('tbody tr').length,
    dice: document.body.textContent,
  })) : null;
  ok('El botón "Imprimir / PDF" abre la hoja con la tabla del saldo',
    contenidoImpreso && /Saldo/.test(contenidoImpreso.titulo) && contenidoImpreso.filas === 1
      && /HARINA X50KG/.test(contenidoImpreso.dice) && /\b20\b/.test(contenidoImpreso.dice),
    JSON.stringify(contenidoImpreso && { titulo: contenidoImpreso.titulo, filas: contenidoImpreso.filas }));
  if (popup) await popup.close();

  // ── Excel: dispara una descarga con el nombre esperado ──
  const [descarga] = await Promise.all([
    p.waitForEvent('download'),
    p.evaluate(() => document.getElementById('btn-kdx-saldo-excel').click()),
  ]);
  const nombre = descarga.suggestedFilename();
  ok('El botón "Excel" descarga un .xlsx con el nombre esperado',
    /^saldo-almacen-\d{4}-\d{2}-\d{2}\.xlsx$/.test(nombre), nombre);

  await p.evaluate(() => document.getElementById('nav-kardex').click());
  await new Promise(r => setTimeout(r, 700));
  await p.evaluate(() => document.getElementById('btn-kdx-vista-saldo').click());
  await new Promise(r => setTimeout(r, 500));
  await p.screenshot({ path: 'pruebas/saldo-export.png', clip: { x: 0, y: 60, width: 1500, height: 420 } });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
