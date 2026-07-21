/* Generador .xlsx mínimo CON ESTILOS, sin librerías externas (CDN bloqueado).
   Crea un ZIP (método "store") con los XML que exige Excel, incluyendo
   estilos (colores de fondo, negritas, moneda, bordes), anchos de columna
   y celdas combinadas.

   Uso:
     descargarXlsx('archivo.xlsx', {
       nombre: 'Cobranza',
       cols:   [10, 26, 14, 14, 16],           // anchos por columna (opcional)
       merges: ['A1:E1'],                       // combinaciones (opcional)
       filas:  [ [celda, celda, ...], ... ]     // filas
     });

   Cada celda puede ser:
     - un valor simple (número -> número, texto -> texto)
     - { v: valor, s: estilo }   donde estilo = {
           bold, size, color:'RRGGBB', bg:'RRGGBB',
           align:'left'|'center'|'right', border:true,
           fmt:'"S/"#,##0'   // formato numérico personalizado
       } */

// --- CRC32 (para las entradas del ZIP) ---
const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const utf8 = txt => new TextEncoder().encode(txt);

function escXml(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// nombre de columna: 0 -> A, 26 -> AA
function letraCol(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// --- Construcción de estilos (styles.xml) ---
function construirEstilos(filas) {
  const numFmts = []; const numFmtMap = new Map(); let numFmtId = 164;
  const fonts = []; const fontMap = new Map();
  const fills = []; const fillMap = new Map();
  const borders = []; const borderMap = new Map();
  const xfs = []; const xfMap = new Map();

  // Elementos reservados obligatorios
  fills.push('<fill><patternFill patternType="none"/></fill>');
  fills.push('<fill><patternFill patternType="gray125"/></fill>');
  fonts.push('<font><sz val="11"/><name val="Calibri"/></font>');
  borders.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
  xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');

  const idFont = s => {
    const key = `${s.bold ? 1 : 0}|${s.size || 11}|${s.color || ''}`;
    if (fontMap.has(key)) return fontMap.get(key);
    let x = `<font><sz val="${s.size || 11}"/>`;
    if (s.bold) x += '<b/>';
    if (s.color) x += `<color rgb="FF${s.color}"/>`;
    x += '<name val="Calibri"/></font>';
    fonts.push(x); fontMap.set(key, fonts.length - 1); return fonts.length - 1;
  };
  const idFill = bg => {
    if (!bg) return 0;
    if (fillMap.has(bg)) return fillMap.get(bg);
    fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${bg}"/><bgColor indexed="64"/></patternFill></fill>`);
    fillMap.set(bg, fills.length - 1); return fills.length - 1;
  };
  const idBorder = b => {
    if (!b) return 0;
    if (borderMap.has(1)) return borderMap.get(1);
    const l = 'style="thin"><color rgb="FFD9D9D3"/>';
    borders.push(`<border><left ${l}</left><right ${l}</right><top ${l}</top><bottom ${l}</bottom><diagonal/></border>`);
    borderMap.set(1, borders.length - 1); return borders.length - 1;
  };
  const idNumFmt = fmt => {
    if (!fmt) return 0;
    if (numFmtMap.has(fmt)) return numFmtMap.get(fmt);
    const id = numFmtId++;
    numFmts.push(`<numFmt numFmtId="${id}" formatCode="${escXml(fmt)}"/>`);
    numFmtMap.set(fmt, id); return id;
  };
  const idXf = s => {
    if (!s) return 0;
    const f = idFont(s), fi = idFill(s.bg), b = idBorder(s.border), nf = idNumFmt(s.fmt);
    const key = `${nf}|${f}|${fi}|${b}|${s.align || ''}`;
    if (xfMap.has(key)) return xfMap.get(key);
    let x = `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"`;
    x += ' applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">';
    x += `<alignment vertical="center"${s.align ? ` horizontal="${s.align}"` : ''}/></xf>`;
    xfs.push(x); xfMap.set(key, xfs.length - 1); return xfs.length - 1;
  };

  // Convierte cada celda a { v, s(indice numérico) }
  const filasIdx = filas.map(fila => (fila || []).map(cel => {
    if (cel && typeof cel === 'object' && !Array.isArray(cel)) {
      return { v: cel.v, s: idXf(cel.s) };
    }
    return { v: cel, s: 0 };
  }));

  const numFmtsXml = numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '';
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmtsXml}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { stylesXml, filasIdx };
}

function hojaXml(filasIdx, cols, merges) {
  let cuerpo = '';
  filasIdx.forEach((fila, r) => {
    let celdas = '';
    fila.forEach((cel, c) => {
      const ref = letraCol(c) + (r + 1);
      const sAttr = cel.s ? ` s="${cel.s}"` : '';
      const v = cel.v;
      if (v === '' || v === null || v === undefined) {
        if (cel.s) celdas += `<c r="${ref}"${sAttr}/>`;
      } else if (typeof v === 'number' && isFinite(v)) {
        celdas += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      } else {
        celdas += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
      }
    });
    cuerpo += `<row r="${r + 1}">${celdas}</row>`;
  });
  const colsXml = (cols && cols.length)
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const mergeXml = (merges && merges.length)
    ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${cuerpo}</sheetData>${mergeXml}</worksheet>`;
}

export function archivosXlsx(hoja) {
  const nombre = escXml((hoja.nombre || 'Hoja1')).slice(0, 31) || 'Hoja1';
  const { stylesXml, filasIdx } = construirEstilos(hoja.filas || []);
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nombre}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
    'xl/worksheets/sheet1.xml': hojaXml(filasIdx, hoja.cols, hoja.merges),
  };
}

// --- Construcción del ZIP (store, sin compresión) ---
export function crearZip(archivos) {
  const centrales = [];
  let offset = 0;
  const partes = [];

  const numLE = (n, bytes) => {
    const a = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 0xFF;
    return a;
  };

  for (const nombre of Object.keys(archivos)) {
    const nombreBytes = utf8(nombre);
    const datos = utf8(archivos[nombre]);
    const crc = crc32(datos);
    const tam = datos.length;

    const local = concat([
      numLE(0x04034b50, 4), numLE(20, 2), numLE(0x0800, 2), numLE(0, 2),
      numLE(0, 2), numLE(0, 2), numLE(crc, 4), numLE(tam, 4), numLE(tam, 4),
      numLE(nombreBytes.length, 2), numLE(0, 2), nombreBytes, datos,
    ]);
    partes.push(local);

    const central = concat([
      numLE(0x02014b50, 4), numLE(20, 2), numLE(20, 2), numLE(0x0800, 2), numLE(0, 2),
      numLE(0, 2), numLE(0, 2), numLE(crc, 4), numLE(tam, 4), numLE(tam, 4),
      numLE(nombreBytes.length, 2), numLE(0, 2), numLE(0, 2), numLE(0, 2), numLE(0, 2),
      numLE(0, 4), numLE(offset, 4), nombreBytes,
    ]);
    centrales.push(central);
    offset += local.length;
  }

  const centralInicio = offset;
  let centralTam = 0;
  centrales.forEach(c => { partes.push(c); centralTam += c.length; });

  partes.push(concat([
    numLE(0x06054b50, 4), numLE(0, 2), numLE(0, 2),
    numLE(centrales.length, 2), numLE(centrales.length, 2),
    numLE(centralTam, 4), numLE(centralInicio, 4), numLE(0, 2),
  ]));

  return new Blob(partes, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function concat(arrays) {
  let total = 0;
  arrays.forEach(a => { total += a.length; });
  const out = new Uint8Array(total);
  let pos = 0;
  arrays.forEach(a => { out.set(a, pos); pos += a.length; });
  return out;
}

export function descargarXlsx(nombreArchivo, hoja) {
  const blob = crearZip(archivosXlsx(hoja));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : nombreArchivo + '.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}
