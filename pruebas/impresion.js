const { chromium } = require('playwright-core');
const fs = require('fs');

/* La nota de venta se imprime en media hoja A4 usada en vertical (A5 de pie).
   Se comprueba sobre el HTML que la app manda de verdad a la impresora. */
const MM = 3.779527;                    // 1 mm en píxeles CSS a 96 ppp
const ANCHO_UTIL = 136 * MM;            // 148 − 6 − 6 de márgenes
const ALTO_UTIL = 198 * MM;             // 210 − 6 − 6

(async () => {
  const html = fs.readFileSync('pruebas/nota-impresa.html', 'utf8').replace(/<script>[\s\S]*?<\/script>/, '');
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: Math.round(ANCHO_UTIL), height: Math.round(ALTO_UTIL) } });
  const p = await ctx.newPage();

  // ── 1) El tamaño de hoja que declara ──
  ok('Declara media hoja A4 en vertical', /@page\s*\{[^}]*size:\s*A5\s+portrait/.test(html),
    (html.match(/size:\s*A5[^;]*/) || [])[0]);

  // Para medir se usa una sola copia: las dos juntas suman el doble de alto
  const unaSola = t => {
    const partes = t.split('<div class="copia">');
    return partes.length > 2 ? partes[0] + '<div class="copia">' + partes[1] : t;
  };
  async function medir(docCompleto) {
    const doc = unaSola(docCompleto);
    await p.setContent(doc, { waitUntil: 'load' });
    await p.emulateMedia({ media: 'print' });
    return p.evaluate(() => ({
      ancho: document.body.scrollWidth,
      alto: document.body.scrollHeight,
      lineasNombre: (() => {
        const va = document.querySelector('.datos .izq .fila .va');
        if (!va) return 0;
        const r = va.getBoundingClientRect();
        const linea = parseFloat(getComputedStyle(va.parentElement).lineHeight) || 14;
        return Math.round(r.height / linea);
      })(),
    }));
  }

  // ── 2) La nota corriente (3 productos) ──
  const m = await medir(html);
  ok('No se sale del ancho de la hoja', m.ancho <= Math.round(ANCHO_UTIL) + 1,
    `${(m.ancho / MM).toFixed(0)}mm de 136mm`);
  ok('Entra entera en una sola hoja', m.alto <= ALTO_UTIL,
    `${(m.alto / MM).toFixed(0)}mm de 198mm`);
  ok('El nombre largo del cliente no se parte en más de dos líneas',
    m.lineasNombre <= 2, m.lineasNombre + ' líneas');

  // El PDF de verdad, con el tamaño y las copias que pide el propio documento
  await p.setContent(html, { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: 'pruebas/nota.pdf', preferCSSPageSize: true, printBackground: true });
  const pdf = fs.readFileSync('pruebas/nota.pdf');
  const caja = /\/MediaBox\s*\[([^\]]*)\]/.exec(pdf.toString('latin1'));
  const [, , anchoPt, altoPt] = caja[1].trim().split(/\s+/).map(Number);
  const anchoMm = Math.round(anchoPt / 72 * 25.4), altoMm = Math.round(altoPt / 72 * 25.4);
  ok('La hoja que sale mide 148 × 210 mm y está de pie',
    anchoMm === 148 && altoMm === 210, `${anchoMm} × ${altoMm} mm`);
  const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('Salen DOS copias: una para el negocio y otra para el cliente',
    paginas === 2, paginas + ' hoja(s)');
  ok('Y no arrastra una media hoja en blanco detrás',
    (html.match(/class="copia"/g) || []).length === 2
      && /\.copia:first-child \{ break-after: page/.test(html));

  // ── 3) Lo que ya no debe salir impreso ──
  await p.setContent(unaSola(html), { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  const fuera = await p.evaluate(() => {
    const cab = document.querySelector('.cab-emp');
    const cuerpo = document.querySelectorAll('tbody tr');
    const primera = cuerpo[0], ultima = cuerpo[cuerpo.length - 1];
    const borde = (f, lado) => getComputedStyle(f.cells[0])['border' + lado + 'Width'];
    return {
      cabecera: cab.innerText.replace(/\s+/g, ' ').trim(),
      arriba: Math.round(document.querySelector('.cab').getBoundingClientRect().top),
      etiquetas: [...document.querySelectorAll('.datos .et')].map(e => e.textContent.trim()),
      texto: document.body.innerText,
      filasVacias: document.querySelectorAll('tr.vacia').length,
      filas: cuerpo.length,
      entreProductos: borde(primera, 'Bottom'),
      cierreDelCuadro: borde(ultima, 'Bottom'),
      rayaVertical: borde(primera, 'Left'),
    };
  });
  ok('No sale el nombre del negocio ni el teléfono',
    !/IMPORTADORA|Tlfno/i.test(fuera.cabecera), fuera.cabecera);
  ok('No sale la hora', !fuera.etiquetas.includes('Hora:'), fuera.etiquetas.join(' '));
  ok('No sale "Emitido por…"', !/Emitido por/i.test(fuera.texto));
  ok('No sale la categoría de precio', !/Categor[íi]a de precio/i.test(fuera.texto));
  ok('No hay renglones vacíos', fuera.filasVacias === 0 && fuera.filas === 3,
    `${fuera.filas} productos, ${fuera.filasVacias} vacíos`);
  ok('No hay líneas entre un producto y el siguiente', fuera.entreProductos === '0px',
    fuera.entreProductos);
  ok('Pero el cuadro cierra por abajo y conserva sus rayas verticales',
    fuera.cierreDelCuadro !== '0px' && fuera.rayaVertical !== '0px',
    `abajo ${fuera.cierreDelCuadro} · vertical ${fuera.rayaVertical}`);
  ok('Todo arranca pegado al borde de arriba, sin centrar', fuera.arriba === 0,
    fuera.arriba + 'px del borde');

  // ── 4) Casos límite: un solo producto y una nota larga ──
  const una = unaSola(html);
  const filaEj = (una.match(/<tr>\s*<td class="c-cod">[\s\S]*?<\/tr>/) || [])[0];
  const cuerpo = /<tbody>([\s\S]*?)<\/tbody>/.exec(una)[1];

  const m1 = await medir(una.replace(cuerpo, filaEj));
  ok('Con un solo producto la nota queda corta y entera',
    m1.alto <= ALTO_UTIL && m1.ancho <= Math.round(ANCHO_UTIL) + 1, `${(m1.alto / MM).toFixed(0)}mm`);

  for (const n of [12, 20, 26]) {
    const larga = una.replace(cuerpo, filaEj.repeat(n));
    const mL = await medir(larga);
    await p.pdf({ path: `pruebas/nota-${n}.pdf`, preferCSSPageSize: true, printBackground: true });
    const hojas = (fs.readFileSync(`pruebas/nota-${n}.pdf`).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(`Con ${n} productos no se sale de ancho y usa ${hojas} hoja(s)`,
      mL.ancho <= Math.round(ANCHO_UTIL) + 1, `${(mL.alto / MM).toFixed(0)}mm de alto`);
  }

  // Un nombre larguísimo y sin espacios no debe romper la celda
  const largo = una.replace(/(<td class="c-desc">)[^<]*/,
    '$1ACEITEVEGETALPREMIUMEXTRAVIRGENPRENSADOENFRIOX20BOTELLASDE900MILILITROS');
  const mX = await medir(largo);
  ok('Un nombre de producto larguísimo no rompe el cuadro',
    mX.ancho <= Math.round(ANCHO_UTIL) + 1, `${(mX.ancho / MM).toFixed(0)}mm de 136mm`);
  await p.setContent(largo, { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.screenshot({ path: 'pruebas/nota-largo.png', fullPage: true });

  // ── 6) La columna de bonificación solo sale cuando hace falta ──
  const conBonif = fs.readFileSync('pruebas/nota-bonif.html', 'utf8').replace(/<script>[\s\S]*?<\/script>/, '');
  const cols = t => (unaSola(t).match(/<th[ >]/g) || []).length;
  ok('Una nota sin bonificación no gasta ancho en esa columna', cols(html) === 6, cols(html) + ' columnas');
  ok('Y una con bonificación sí la lleva', cols(conBonif) === 7 && /Dscto\. bonif\./.test(conBonif),
    cols(conBonif) + ' columnas');
  const mB = await medir(conBonif);
  ok('Con la columna de más sigue sin salirse de la hoja',
    mB.ancho <= Math.round(ANCHO_UTIL) + 1 && mB.alto <= ALTO_UTIL,
    `${(mB.ancho / MM).toFixed(0)}mm × ${(mB.alto / MM).toFixed(0)}mm`);
  const lineaRegalada = /BONIF\.[\s\S]*?<td class="c-bon">-([\d,.]+)<\/td>\s*<td class="c-imp">([\d,.]+)<\/td>/.exec(conBonif);
  ok('La línea regalada muestra su descuento y queda en cero',
    !!lineaRegalada && lineaRegalada[2] === '0.00',
    lineaRegalada ? `-${lineaRegalada[1]} → ${lineaRegalada[2]}` : 'no se encontró');

  await b.close();
})();
