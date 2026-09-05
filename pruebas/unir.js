const { chromium } = require('playwright-core');

/* El dueño entra con su correo, después se crea el usuario corto "admin" y
   sigue siendo la MISMA persona. Lo que cobró con el correo y lo que cobra con
   "admin" tiene que sumar en un solo renglón de la hoja de cobranza, no en dos.
   Se prueba contra los emuladores de verdad. */
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8081/v1/projects/demo-creditos/databases/(default)/documents';
const CORREO = 'astropapa@ejemplo.com', CLAVE = 'clave-larga-123';

async function limpiar() {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-creditos/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8081/emulator/v1/projects/demo-creditos/databases/(default)/documents',
    { method: 'DELETE' });
}

(async () => {
  await limpiar();
  await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }) });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const ses = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }) })).json();
  const uid = ses.localId;
  const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ses.idToken };

  const entrar = async (u, c) => {
    await p.fill('#a-email', u); await p.fill('#a-pass', c);
    await p.evaluate(() => document.getElementById('btn-auth-principal').click());
    await p.waitForTimeout(3000);
  };
  // Un crédito con su cobro ya hecho, firmado por quien se diga. Se siembra
  // por la puerta de atrás para no tener que dibujar la firma del cliente.
  const HOY = new Date().toISOString().slice(0, 10);
  const sembrarCobro = (id, boleta, monto, cobro, firma) =>
    fetch(`${FS}/usuarios/${uid}/creditos/${id}`, {
      method: 'PATCH', headers: cab,
      body: JSON.stringify({ fields: {
        id: { stringValue: id },
        boleta: { stringValue: boleta },
        cliente: { stringValue: 'CLIENTE ' + boleta },
        zona: { stringValue: 'CIUDAD' },
        monto: { doubleValue: monto },
        fecha: { stringValue: HOY },
        vencimiento: { stringValue: HOY },
        estado: { stringValue: 'parcial' },
        creado: { integerValue: String(Date.now()) },
        abonos: { arrayValue: { values: [{ mapValue: { fields: {
          monto: { doubleValue: cobro },
          fecha: { stringValue: HOY },
          metodo: { stringValue: 'efectivo' },
          registradoPor: { stringValue: firma },
          registradoFecha: { stringValue: HOY },
          registrado: { integerValue: String(Date.now()) },
        } } }] } },
      } }),
    });

  const filasCobranza = () => p.evaluate(() =>
    [...document.querySelectorAll('#cob-totales .cob-usuarios tbody tr')]
      .map(f => f.cells[0].textContent.trim()));

  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await entrar(CORREO, CLAVE);
  ok('El dueño entra con su correo', await p.evaluate(() => document.getElementById('auth-screen').hidden));

  // ── 1) Un cobro firmado con el correo, de cuando entraba así ──
  await sembrarCobro('c-correo', '9001', 500, 100, CORREO);

  // ── 2) Se crea el usuario corto "admin" ──
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(800);
  await p.fill('#alias-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-alias-crear').click());
  await p.waitForTimeout(3200);

  const fichaAlias = await (await fetch(`${FS}/usuarios/${uid}/miembros`, { headers: cab })).json();
  const alias = (fichaAlias.documents || []).find(d => d.fields.usuario
    && d.fields.usuario.stringValue === 'admin');
  const previos = alias && alias.fields.nombresPrevios
    ? alias.fields.nombresPrevios.arrayValue.values.map(v => v.stringValue) : [];
  ok('Al crear el usuario corto queda anotado que es la misma persona del correo',
    previos.includes(CORREO), previos.join(', ') || 'no quedó anotado');

  // ── 3) Entra como "admin" y cobra otra vez ──
  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2500);
  await entrar('admin', CLAVE);
  ok('Entra como "admin"',
    (await p.textContent('#hdr-usuario')).trim() === 'admin', await p.textContent('#hdr-usuario'));
  // Y un cobro más, ya firmado con el usuario corto
  await sembrarCobro('c-admin', '9002', 800, 200, 'admin');
  await p.reload();
  await p.waitForTimeout(3600);

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(2000);
  const unidas = await filasCobranza();
  ok('Los dos cobros salen bajo un solo cobrador, no como dos personas',
    unidas.length === 1 && unidas[0] === 'admin', unidas.join(' | '));

  // ── 4) El caso que ya estaba roto: un usuario corto creado sin ese enlace ──
  // Se le quita la anotación a mano, como quedó en el negocio de verdad.
  const aliasUid = alias.name.split('/').pop();
  await fetch(`${FS}/usuarios/${uid}/miembros/${aliasUid}?updateMask.fieldPaths=nombresPrevios`, {
    method: 'PATCH', headers: cab, body: JSON.stringify({ fields: {} }) });
  await p.reload();
  await p.waitForTimeout(3600);
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(2000);
  const partidas = await filasCobranza();
  ok('Aun sin la anotación, sigue saliendo un solo cobrador: la app lo deduce',
    partidas.length === 1 && partidas[0] === 'admin', partidas.join(' | '));

  // ── 5) Y se arregla solo, sin que haya que elegir nada ──
  // (El bloque anterior le quitó la anotación; al volver a cargar, la app
  //  deduce sola que el correo del dueño y el único administrador con usuario
  //  corto son la misma persona.)
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(2000);
  const sinCacharros = await p.evaluate(() => ({
    unir: !!document.getElementById('usr-unir'),
    boton: !!document.getElementById('btn-usr-unir'),
    texto: document.getElementById('usr-dueno').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('👥 Usuarios ya no pregunta nada: no hay selector ni botón de unir',
    !sinCacharros.unir && !sinCacharros.boton, JSON.stringify(sinCacharros).slice(0, 80));
  ok('Solo lo explica en la ficha del dueño',
    /misma persona/i.test(sinCacharros.texto), sinCacharros.texto.slice(-90));

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(2000);
  const arregladas = await filasCobranza();
  ok('Y la hoja de cobranza muestra un solo cobrador, sin tocar nada',
    arregladas.length === 1 && arregladas[0] === 'admin', arregladas.join(' | '));

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
