const { chromium } = require('playwright-core');

/* Dos cosas:
   · La ficha del crédito enseña también la HORA a la que se emitió la boleta,
     que la sabe la nota de venta de la que salió.
   · Un botón 👁️ en las acciones de la nota que la enseña tal como se va a
     imprimir, sin imprimirla, para poder revisarla a detalle. */
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 140)); });
  p.on('dialog', d => d.accept());
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = { apiKey: "PEGA_AQUI_TU_API_KEY" };' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1500);
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  // ── Preparar: negocio, cliente, producto y mercadería ──
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(600);
  await p.fill('#s-emp-direccion', 'AV. FITZCARRALD 123 - PUERTO MALDONADO');
  await p.fill('#s-emp-ruc', '20601234567');
  await p.evaluate(() => document.querySelector('#settings-form button[type=submit]').click());
  await p.waitForTimeout(800);

  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(350);
  await p.fill('#cli-nombre', 'DINA RESTAURANTE');
  await p.fill('#cli-direccion', 'JR. LORETO 456').catch(() => {});
  await p.selectOption('#cli-zona', '3 DE MAYO');
  await p.selectOption('#cli-categoria', 'C');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(800);

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(350);
  await p.fill('#prod-nombre', 'ACEITE SOYA 20BOTX900ML');
  for (const c of ['a', 'b', 'c']) await p.fill(`#prod-precio-${c}`, '182');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(700);

  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(700);
  await p.fill('#ing-buscar', 'ACEITE');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(300);
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1200);

  // ── Una nota de venta de 8 cajas ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(800);
  await p.fill('#nv-cliente-buscar', 'DINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(400);
  await p.fill('#nv-buscar-producto', 'ACEITE');
  await p.waitForTimeout(450);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(300);
  await p.fill('#nv-cantidad', '8');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  const horaDelForm = await p.evaluate(() => document.getElementById('nv-hora').textContent.trim());
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(1800);

  // ── 1) La ficha del crédito enseña la hora de emisión ──
  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#table-body [data-info]').click());
  await p.waitForTimeout(900);
  const sub = await p.evaluate(() => document.getElementById('info-sub').textContent.trim());
  ok('La ficha dice la boleta, el día Y la hora de emisión',
    /Boleta Nº/.test(sub) && /Emitido el \d{2}\/\d{2}\/\d{4} a las /.test(sub), sub);
  ok('Y esa hora es la que quedó guardada en la nota',
    horaDelForm !== '' && sub.includes(horaDelForm), `nota: ${horaDelForm} · ficha: ${sub}`);
  await p.screenshot({ path: 'pruebas/vista-ficha.png', clip: await p.evaluate(() => {
    const r = document.getElementById('modal-info').getBoundingClientRect();
    return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 300) };
  }) });
  await p.evaluate(() => document.getElementById('modal-info').close());
  await p.waitForTimeout(400);

  // ── 2) El botón 👁️ enseña la nota como se imprimirá ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(700);
  const hayBoton = await p.evaluate(() => {
    const b = document.querySelector('[data-ver-nota]');
    return b ? { texto: b.textContent.trim(), titulo: b.title } : null;
  });
  ok('En las acciones de la nota hay un botón para verla',
    !!hayBoton && /imprimir/i.test(hayBoton.titulo), JSON.stringify(hayBoton));

  // Si abriera una ventana para imprimir, esto lo cazaría: NO debe abrir ninguna
  let ventanas = 0;
  ctx.on('page', () => { ventanas++; });
  await p.evaluate(() => document.querySelector('[data-ver-nota]').click());
  await p.waitForTimeout(1500);
  ok('Se abre en su propio cuadro y NO manda nada a la impresora',
    await p.evaluate(() => document.getElementById('modal-vista-nota').open) && ventanas === 0,
    `ventanas nuevas: ${ventanas}`);

  const cab = await p.evaluate(() => ({
    titulo: document.getElementById('vista-nota-titulo').textContent.trim(),
    sub: document.getElementById('vista-nota-sub').textContent.trim(),
  }));
  ok('Dice de qué nota se trata', /Nota de venta \d+/.test(cab.titulo) && /DINA/i.test(cab.sub),
    `${cab.titulo} · ${cab.sub}`);

  // Lo de dentro es el papel de verdad: mismo documento que va a la impresora
  const dentro = await p.evaluate(() => {
    const d = document.getElementById('vista-nota-marco').contentDocument;
    return {
      copias: d.querySelectorAll('.copia').length,
      cliente: d.querySelector('.datos .izq .va').textContent.trim(),
      productos: d.querySelectorAll('tbody tr').length,
      total: d.querySelector('.tot-fila:last-child .va').textContent.trim(),
      ruc: d.body.textContent.includes('20601234567'),
      direccion: d.body.textContent.includes('FITZCARRALD'),
      // Ancho real de la hoja: 148 mm ≈ 559 px
      anchoHoja: Math.round(d.querySelector('.copia').getBoundingClientRect().width),
    };
  });
  ok('Se enseña UNA sola hoja, no la copia repetida', dentro.copias === 1, dentro.copias + ' copias');
  ok('Con el cliente, sus productos y su total', /DINA/i.test(dentro.cliente)
    && dentro.productos === 1 && /1,?456/.test(dentro.total),
    `${dentro.cliente} · ${dentro.productos} ítem · ${dentro.total}`);
  ok('Y con la dirección y el RUC del negocio, como en el comprobante',
    dentro.ruc && dentro.direccion, JSON.stringify({ ruc: dentro.ruc, dir: dentro.direccion }));
  ok('La hoja mide sus 148 mm de ancho de verdad (A5 de pie)',
    Math.abs(dentro.anchoHoja - 559) < 12, dentro.anchoHoja + 'px');

  // Que sean dos copias se dice con palabras, que es donde no estorba
  const aviso = await p.evaluate(() =>
    document.querySelector('.vista-nota-aviso').textContent.replace(/\s+/g, ' ').trim());
  ok('Y se avisa de que al imprimir salen dos copias',
    /dos copias/i.test(aviso) && /negocio/i.test(aviso) && /cliente/i.test(aviso), aviso);

  // ── UNA barra de desplazamiento, no tres ──
  const barras = await p.evaluate(() => {
    const caja = document.getElementById('vista-nota-hojas');
    const d = document.getElementById('vista-nota-marco').contentDocument;
    const marco = document.getElementById('vista-nota-marco');
    return {
      cajaDeLado: caja.scrollWidth > caja.clientWidth + 1,
      cajaDeLargo: caja.scrollHeight > caja.clientHeight + 1,
      // El documento de dentro no se desplaza NUNCA: lo mueve el cuadro
      marcoDeLado: d.documentElement.scrollWidth > marco.clientWidth + 1,
      marcoDeLargo: d.documentElement.scrollHeight > marco.clientHeight + 1,
      overflow: getComputedStyle(d.documentElement).overflow,
    };
  });
  ok('Dentro del marco no se desplaza nada: ni de lado ni de largo',
    !barras.marcoDeLado && !barras.marcoDeLargo && barras.overflow === 'hidden',
    JSON.stringify(barras));
  ok('Y el cuadro tampoco se arrastra de lado: la hoja se reduce hasta caber',
    !barras.cajaDeLado, JSON.stringify(barras));

  // La hoja encaja de ancho dentro del cuadro
  const encaje = await p.evaluate(() => {
    const caja = document.getElementById('vista-nota-hojas');
    const lienzo = document.getElementById('vista-nota-lienzo');
    return { caja: Math.round(caja.clientWidth), lienzo: Math.round(lienzo.getBoundingClientRect().width) };
  });
  ok('La hoja encaja de ancho, sin tener que arrastrarla de lado',
    encaje.lienzo <= encaje.caja, JSON.stringify(encaje));
  await p.screenshot({ path: 'pruebas/vista-nota.png' });

  // El sitio de la barra de largo se reserva SIEMPRE. En los navegadores cuya
  // barra ocupa ancho de verdad (Chrome en Windows) asomaba DESPUÉS de colocar
  // la hoja, se comía ~15 px del cuadro y le recortaba el borde derecho. Este
  // navegador de pruebas usa barras que flotan por encima y no lo reproduce,
  // así que lo que se comprueba es que la regla esté puesta.
  const gutter = await p.evaluate(() =>
    getComputedStyle(document.getElementById('vista-nota-hojas')).scrollbarGutter);
  ok('El sitio de la barra queda reservado, para que el ancho no cambie a media colocación',
    gutter === 'stable', gutter);

  // Y al cambiar el ancho del cuadro, la hoja se vuelve a encajar sola
  await p.setViewportSize({ width: 900, height: 950 });
  await p.waitForTimeout(600);
  const trasEncoger = await p.evaluate(() => {
    const caja = document.getElementById('vista-nota-hojas');
    const lienzo = document.getElementById('vista-nota-lienzo');
    return { caja: Math.round(caja.clientWidth), lienzo: Math.round(lienzo.getBoundingClientRect().width),
      deLado: caja.scrollWidth > caja.clientWidth + 1 };
  });
  ok('Al estrechar la ventana la hoja se vuelve a encajar, sin asomar de lado',
    !trasEncoger.deLado && trasEncoger.lienzo <= trasEncoger.caja, JSON.stringify(trasEncoger));
  await p.setViewportSize({ width: 1500, height: 950 });
  await p.waitForTimeout(500);

  // ── Lo que va a la IMPRESORA sí lleva las dos copias, con su salto ──
  // Se le cambia window.open por uno de mentira para quedarse con el HTML que
  // se le manda a la impresora, sin abrir nada ni imprimir nada.
  const impreso = await p.evaluate(() => new Promise(resolve => {
    const original = window.open;
    let html = '';
    window.open = () => ({
      document: { write: t => { html += t; }, close: () => { window.open = original; resolve(html); } },
    });
    document.getElementById('btn-vista-imprimir').click();
    setTimeout(() => { window.open = original; resolve(html); }, 1500);
  }));
  const papel = await p.evaluate(html => {
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;left:-9999px;width:700px;height:500px';
    document.body.appendChild(marco);
    return new Promise(resolve => {
      marco.addEventListener('load', () => {
        const d = marco.contentDocument;
        const copias = [...d.querySelectorAll('.copia')];
        const rompe = el => {
          const s = getComputedStyle(el);
          return s.breakAfter === 'page' || s.pageBreakAfter === 'always';
        };
        const r = { copias: copias.length,
          primera: copias[0] ? rompe(copias[0]) : false,
          segunda: copias[1] ? rompe(copias[1]) : false,
          iguales: copias.length === 2 && copias[0].textContent.trim() === copias[1].textContent.trim() };
        marco.remove();
        resolve(r);
      }, { once: true });
      marco.srcdoc = html;
    });
  }, impreso);
  ok('Al imprimir sí van las DOS copias, y dicen lo mismo',
    papel.copias === 2 && papel.iguales, JSON.stringify(papel));
  ok('Con el salto de página tras la primera, no tras la segunda',
    papel.primera && !papel.segunda, JSON.stringify(papel));

  await p.evaluate(() => document.getElementById('btn-vista-cerrar').click());
  await p.waitForTimeout(400);
  ok('Se cierra con su botón', !await p.evaluate(() => document.getElementById('modal-vista-nota').open));

  // ── 3) En una pantalla de teléfono se reduce para que quepa, sin recortarla ──
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-ver-nota]').click());
  await p.waitForTimeout(1600);
  const enCelular = await p.evaluate(() => {
    const caja = document.getElementById('vista-nota-hojas');
    const lienzo = document.getElementById('vista-nota-lienzo');
    const d = document.getElementById('vista-nota-marco').contentDocument;
    return { caja: Math.round(caja.clientWidth), lienzo: Math.round(lienzo.getBoundingClientRect().width),
      copias: d.querySelectorAll('.copia').length,
      hojaReal: Math.round(d.querySelector('.copia').getBoundingClientRect().width),
      sobraAncho: caja.scrollWidth > caja.clientWidth + 2 };
  });
  ok('En el celular se reduce para que quepa entera, sin recortarla',
    !enCelular.sobraAncho && enCelular.lienzo <= enCelular.caja && enCelular.copias === 1
      && enCelular.hojaReal === 559,
    JSON.stringify(enCelular));
  await p.screenshot({ path: 'pruebas/vista-nota-celular.png' });

  console.log(errs.length ? `\nerrores de JS: ${errs.slice(0, 3).join(' | ')}` : '\nerrores de JS: ninguno');
  await b.close();
})();
