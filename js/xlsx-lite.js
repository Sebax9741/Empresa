/* Generador .xlsx mínimo, sin librerías externas (el CDN está bloqueado).
   Crea un ZIP (método "store", sin compresión) con los XML que exige Excel.
   Uso:  descargarXlsx('archivo.xlsx', 'Hoja', filas)
   filas = arreglo de filas; cada fila = arreglo de celdas.
   Celda número -> se escribe como número; cualquier otra cosa -> texto. */

// --- CRC32 (necesario para las entradas del ZIP) ---
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

function hojaXml(filas) {
  let cuerpo = '';
  filas.forEach((fila, r) => {
    let celdas = '';
    fila.forEach((val, c) => {
      const ref = letraCol(c) + (r + 1);
      const esNum = typeof val === 'number' && isFinite(val);
      if (val === '' || val === null || val === undefined) {
        // celda vacía: no se escribe
      } else if (esNum) {
        celdas += `<c r="${ref}"><v>${val}</v></c>`;
      } else {
        celdas += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`;
      }
    });
    cuerpo += `<row r="${r + 1}">${celdas}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cuerpo}</sheetData></worksheet>`;
}

export function archivosXlsx(nombreHoja, filas) {
  const hoja = escXml(nombreHoja).slice(0, 31) || 'Hoja1';
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': hojaXml(filas),
  };
}

// --- Construcción del ZIP (store, sin compresión) ---
export function crearZip(archivos) {
  const locales = [];
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

    // encabezado local
    const local = concat([
      numLE(0x04034b50, 4), numLE(20, 2), numLE(0x0800, 2), numLE(0, 2),
      numLE(0, 2), numLE(0, 2), numLE(crc, 4), numLE(tam, 4), numLE(tam, 4),
      numLE(nombreBytes.length, 2), numLE(0, 2), nombreBytes, datos,
    ]);
    partes.push(local);
    locales.push(local);

    // registro central
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

  const fin = concat([
    numLE(0x06054b50, 4), numLE(0, 2), numLE(0, 2),
    numLE(centrales.length, 2), numLE(centrales.length, 2),
    numLE(centralTam, 4), numLE(centralInicio, 4), numLE(0, 2),
  ]);
  partes.push(fin);

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

export function descargarXlsx(nombreArchivo, nombreHoja, filas) {
  const blob = crearZip(archivosXlsx(nombreHoja, filas));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : nombreArchivo + '.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}
