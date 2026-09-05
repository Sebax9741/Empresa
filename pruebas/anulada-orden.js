const { chromium } = require('playwright-core');

/* Una nota anulada tiene su sitio en la lista de créditos, como cualquier
   otra: se ordena por lo mismo que el resto. Antes se amontonaban todas
   arriba del todo, fuera de su numeración, dijera lo que dijera el orden. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  // Anular pregunta el motivo con un prompt del navegador y luego confirma
  p.on('dialog', d => d.accept('CLIENTE YA NO QUIERE EL PEDIDO'));
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "X" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1300);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // Cliente, producto y stock
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(450);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(400);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(750);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(450);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(400);
  await p.fill('#prod-nombre', 'HARINA X50KG');
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(650);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(650);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(320);
  await p.fill('#ing-cantidad', '90');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(320);
  await p.fill('#ing-doc-numero', 'F1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(900);

  const nota = async cantidad => {
    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(480);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(700);
    await p.fill('#nv-cliente-buscar', 'BODEGA');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-buscar-producto', 'HARINA');
    await p.waitForTimeout(450);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(300);
    await p.fill('#nv-cantidad', String(cantidad));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(1300);
  };

  // Cuatro notas seguidas: 1, 2, 3 y 4
  await nota(1); await nota(2); await nota(3); await nota(4);

  // Se anula la TERCERA: ni la más nueva ni la más vieja, para que se note
  // si se va a una punta
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(600);
  const numeros = await p.evaluate(() => [...document.querySelectorAll('#nv-body tr')]
    .map(f => f.querySelector('.nv-num strong').textContent.trim()));
  const anulada = numeros[1];   // recientes primero: [4, 3, 2, 1] → se anula la "3"
  await p.evaluate(n => {
    const fila = [...document.querySelectorAll('#nv-body tr')]
      .find(f => f.querySelector('.nv-num strong').textContent.trim() === n);
    fila.querySelector('[data-anular-nota]').click();
  }, anulada);
  await p.waitForTimeout(1600);

  // ── Cómo queda la lista de créditos, en cada orden ──
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(700);

  const filas = async orden => {
    await p.evaluate(o => {
      document.getElementById('sort-by').value = o;
      document.getElementById('sort-by').dispatchEvent(new Event('change', { bubbles: true }));
    }, orden);
    await p.waitForTimeout(600);
    return p.evaluate(() => [...document.querySelectorAll('.credit-table tbody tr')]
      .map(f => {
        const n = f.querySelector('td');
        return (n ? n.textContent : '').replace(/\D+/g, '');
      }).filter(Boolean));
  };

  const porNumeroAsc = await filas('boleta-asc');
  const iAnulada = porNumeroAsc.indexOf(anulada);
  ok('Por N° de boleta ascendente, la anulada cae en su número',
    iAnulada > 0 && iAnulada < porNumeroAsc.length - 1
      && Number(porNumeroAsc[iAnulada - 1]) < Number(anulada)
      && Number(porNumeroAsc[iAnulada + 1]) > Number(anulada),
    porNumeroAsc.slice(0, 6).join(' · '));

  const porNumeroDesc = await filas('boleta-desc');
  const j = porNumeroDesc.indexOf(anulada);
  ok('Por N° descendente, también en su sitio (no arriba del todo)',
    j > 0 && Number(porNumeroDesc[j - 1]) > Number(anulada)
      && Number(porNumeroDesc[j + 1]) < Number(anulada),
    porNumeroDesc.slice(0, 6).join(' · '));

  const porCreado = await filas('creado-desc');
  const k = porCreado.indexOf(anulada);
  ok('Por fecha de creación (recientes primero), NO se va arriba del todo',
    k > 0, `posición ${k + 1} de ${porCreado.length} · ${porCreado.slice(0, 6).join(' · ')}`);
  ok('Y ahí queda entre la que se creó justo antes y la de justo después',
    porCreado[k - 1] === numeros[0] && porCreado[k + 1] === numeros[2],
    `antes ${porCreado[k - 1]} · anulada ${anulada} · después ${porCreado[k + 1]}`);

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
