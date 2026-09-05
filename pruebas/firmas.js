const { chromium } = require('playwright-core');
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8081/v1/projects/demo-creditos/databases/(default)/documents';
const CORREO = 'astropapa@ejemplo.com', CLAVE = 'clave-larga-123';

/* Cada persona es su usuario, sin nombre aparte. Lo anotado antes —cuando el
   sistema sí tenía nombres para mostrar— debe seguir leyéndose, traducido al
   usuario de quien lo hizo. */
(async () => {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-creditos/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8081/emulator/v1/projects/demo-creditos/databases/(default)/documents', { method: 'DELETE' });
  await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }) });

  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const ses = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }) })).json();
  const uid = ses.localId, tok = ses.idToken;
  const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };

  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await p.fill('#a-email', CORREO); await p.fill('#a-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-auth-principal').click());
  await p.waitForTimeout(3400);

  // ── 1) Lo que se firma ahora ──
  ok('La cabecera muestra el usuario con el que se entró',
    (await p.textContent('#hdr-usuario')).trim() === CORREO, await p.textContent('#hdr-usuario'));

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1600);
  await p.evaluate(() => document.getElementById('btn-hoja-crear').click());
  await p.waitForTimeout(2800);
  const leerDetalle = () => p.evaluate(() =>
    document.getElementById('cob-estado-detalle').textContent.replace(/\s+/g, ' ').trim());
  const hoy = await leerDetalle();
  ok('La hoja de hoy queda firmada con el usuario', new RegExp('Abierta por ' + CORREO).test(hoy), hoy.slice(0, 80));

  // ── 2) Ya no se puede poner un nombre aparte ──
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1600);
  const sinNombres = await p.evaluate(() => ({
    campoAlta: !!document.getElementById('u-nombre'),
    renombrarDueno: !!document.getElementById('btn-dueno-renombrar'),
    renombrarMiembro: !!document.querySelector('[data-renombrar]'),
    dueno: document.getElementById('usr-dueno-nombre').textContent.trim(),
  }));
  ok('No hay campo de nombre, ni botón de renombrar en ninguna ficha',
    !sinNombres.campoAlta && !sinNombres.renombrarDueno && !sinNombres.renombrarMiembro,
    JSON.stringify(sinNombres));
  ok('Al dueño se le identifica por su usuario', sinNombres.dueno === CORREO, sinNombres.dueno);

  // ── 3) El historial de antes sigue leyéndose ──
  // Se simula la ficha que dejó la versión anterior: un nombre para mostrar y
  // otro con el que firmó antes de cambiárselo.
  await fetch(`${FS}/usuarios/${uid}/miembros/${uid}`
    + '?updateMask.fieldPaths=nombre&updateMask.fieldPaths=nombresPrevios', {
    method: 'PATCH', headers: cab,
    body: JSON.stringify({ fields: {
      nombre: { stringValue: 'Admin' },
      nombresPrevios: { arrayValue: { values: [{ stringValue: 'Administrador' }] } },
    } }),
  });

  // Dos hojas viejas: una firmada con el nombre y otra con el nombre anterior
  const dia = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const hojaVieja = async (fecha, firma) => fetch(`${FS}/usuarios/${uid}/hojas/${fecha}`, {
    method: 'PATCH', headers: cab,
    body: JSON.stringify({ fields: {
      fecha: { stringValue: fecha },
      creada: { integerValue: String(Date.now()) },
      creadaPor: { stringValue: firma },
      creadaEn: { timestampValue: new Date().toISOString() },
      cerrada: { booleanValue: false },
    } }),
  });
  await hojaVieja(dia(1), 'Admin');
  await hojaVieja(dia(2), 'Administrador');
  await hojaVieja(dia(3), 'pedro-que-ya-no-esta');

  await p.reload();
  await p.waitForTimeout(3600);
  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(2000);
  const verDia = async f => {
    await p.evaluate(x => { const s = document.getElementById('cob-fecha'); s.value = x;
      s.dispatchEvent(new Event('change', { bubbles: true })); }, f);
    await p.waitForTimeout(1400);
    return leerDetalle();
  };
  const conNombre = await verDia(dia(1));
  ok('Lo firmado con el nombre para mostrar de antes se lee como su usuario',
    new RegExp('Abierta por ' + CORREO).test(conNombre) && !/Admin\b/.test(conNombre), conNombre.slice(0, 80));

  const conPrevio = await verDia(dia(2));
  ok('Y lo firmado con un nombre todavía más viejo, también',
    new RegExp('Abierta por ' + CORREO).test(conPrevio) && !/Administrador/.test(conPrevio), conPrevio.slice(0, 80));

  const ajena = await verDia(dia(3));
  ok('Una firma de alguien que ya no está se deja tal cual',
    /pedro-que-ya-no-esta/.test(ajena), ajena.slice(0, 80));

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 5) : 'ninguno');
  await b.close();
})();
