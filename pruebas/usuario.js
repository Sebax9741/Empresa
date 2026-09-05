const { chromium } = require('playwright-core');

/* Entrar con un usuario corto ("admin") en vez del correo, y que el sistema
   lo muestre como "Admin". Se prueba contra los emuladores de verdad, con las
   reglas de firestore.rules puestas. */
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const CORREO = 'dueño-de-prueba@ejemplo.com';
const CLAVE = 'clave-larga-123';

async function cuentas() {
  const r = await fetch(`${AUTH.replace('/v1', '/v1/projects/demo-creditos')}/accounts:query?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: '{}',
  });
  return ((await r.json()).userInfo || []).map(u => u.email).sort();
}

async function crearCuentaDeCorreo() {
  const r = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }),
  });
  if (!r.ok) throw new Error('no se pudo crear la cuenta: ' + (await r.text()));
}

/* Se parte de emuladores limpios, para que la prueba se pueda repetir */
async function limpiarEmuladores() {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-creditos/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8081/emulator/v1/projects/demo-creditos/databases/(default)/documents',
    { method: 'DELETE' });
}

(async () => {
  await limpiarEmuladores();
  await crearCuentaDeCorreo();

  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());   // "¿Cerrar sesión?" 
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const entrar = async (usuario, clave) => {
    await p.fill('#a-email', usuario);
    await p.fill('#a-pass', clave);
    await p.evaluate(() => document.getElementById('btn-auth-principal').click());
    await p.waitForTimeout(2600);
  };

  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);

  // ── 1) El dueño entra con su correo (alta inicial del negocio) ──
  await entrar(CORREO, CLAVE);
  const dueño = await p.evaluate(() => ({
    dentro: document.getElementById('auth-screen').hidden,
    cabecera: document.getElementById('hdr-usuario').textContent.trim(),
  }));
  ok('El dueño entra con su correo', dueño.dentro, JSON.stringify(dueño));

  // ── 2) Se le ofrece crear un usuario corto ──
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(700);
  const oferta = await p.evaluate(() => ({
    visible: !document.getElementById('cuenta-alias').hidden,
    correo: document.getElementById('cuenta-alias-correo').textContent.trim(),
  }));
  ok('Entrando con correo, la app ofrece crear un usuario corto',
    oferta.visible && oferta.correo.includes('@'), JSON.stringify(oferta));

  const porDefecto = await p.evaluate(() => ({
    usuario: document.getElementById('alias-usuario').value,
    conNombre: !!document.getElementById('alias-nombre'),
    campos: Array.from(document.querySelectorAll('.cuenta-alias-campos input')).map(i => i.id),
  }));
  ok('Viene propuesto el usuario "admin", y solo pide usuario y contraseña',
    porDefecto.usuario === 'admin' && !porDefecto.conNombre
      && porDefecto.campos.join() === 'alias-usuario,alias-pass', JSON.stringify(porDefecto));

  // Una contraseña corta no pasa
  await p.fill('#alias-pass', '123');
  await p.evaluate(() => document.getElementById('btn-alias-crear').click());
  await p.waitForTimeout(900);
  ok('No deja crearlo con una contraseña corta', (await cuentas()).length === 1);

  // ── 3) Se crea el usuario "admin" ──
  await p.fill('#alias-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-alias-crear').click());
  await p.waitForTimeout(3000);
  const altas = await cuentas();
  ok('Queda creada la cuenta de "admin"',
    altas.length === 2 && altas.some(c => c.startsWith('admin@usuarios.')), altas.join(' · '));

  // ── 4) Se sale y se entra con "admin" ──
  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2200);
  ok('Se cerró la sesión', await p.evaluate(() => !document.getElementById('auth-screen').hidden));

  await entrar('admin', CLAVE);
  const comoAdmin = await p.evaluate(() => ({
    dentro: document.getElementById('auth-screen').hidden,
    cabecera: document.getElementById('hdr-usuario').textContent.trim(),
    avatar: document.getElementById('hdr-avatar').textContent.trim(),
  }));
  ok('Entra escribiendo solo "admin", sin el correo', comoAdmin.dentro, JSON.stringify(comoAdmin));
  ok('El sistema lo muestra por su usuario, sin nombre aparte',
    comoAdmin.cabecera === 'admin', comoAdmin.cabecera);

  // ── 5) Manda como administrador y firma con su usuario ──
  const mando = await p.evaluate(() => ({
    usuarios: !document.getElementById('nav-usuarios').hidden,
    productos: !document.getElementById('nav-productos').hidden,
  }));
  ok('Tiene los permisos de administrador', mando.usuarios && mando.productos, JSON.stringify(mando));

  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(800);
  const firma = await p.textContent('#ing-cab-usuario');
  ok('Lo que registra queda firmado con su usuario', firma.trim() === 'admin', firma.trim());

  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(700);
  const yaNoOfrece = await p.evaluate(() => ({
    oferta: document.getElementById('cuenta-alias').hidden,
    cuenta: document.getElementById('cuenta-email').textContent.trim(),
  }));
  ok('Ya no le ofrece crear otro usuario, y su cuenta sale como "admin"',
    yaNoOfrece.oferta && yaNoOfrece.cuenta.startsWith('admin'), JSON.stringify(yaNoOfrece));

  // ── 6) Al cerrar sesión no se queda nada del que se fue ──
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(400);
  await p.fill('#prod-nombre', 'ARROZ DE PRUEBA');
  await p.fill('#prod-precio-a', '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(2200);
  ok('El producto se guarda en la nube', (await p.$$eval('#prod-body tr', r => r.length)) === 1);

  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2400);
  const trasSalir = await p.evaluate(() => ({
    productos: window.__productos === undefined ? null : null,
    filas: document.querySelectorAll('#prod-body tr').length,
  }));
  ok('Al salir no queda el catálogo del anterior en pantalla', trasSalir.filas === 0,
    `${trasSalir.filas} filas`);

  // ── 7) El correo del dueño sigue sirviendo, y ve los mismos datos ──
  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2200);
  await entrar(CORREO, CLAVE);
  ok('El correo del dueño sigue entrando',
    await p.evaluate(() => document.getElementById('auth-screen').hidden));
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(1200);
  ok('Y ve el mismo almacén: son el mismo negocio',
    (await p.$$eval('#prod-body tr', r => r.length)) === 1);
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1400);
  const reparto = await p.evaluate(() => ({
    // El correo del dueño va en su propio bloque, no como un empleado más
    dueno: document.getElementById('usr-dueno').hidden ? '' :
      document.getElementById('usr-dueno-nombre').textContent.trim(),
    equipo: Array.from(document.querySelectorAll('#usuarios-list .usuario-id strong'))
      .map(x => x.textContent.trim()).sort(),
    roles: Array.from(document.querySelectorAll('#usuarios-list .usuario-rol'))
      .map(x => x.textContent.trim()),
  }));
  ok('El correo queda como cuenta de dueño y "admin" como el único del equipo',
    /@/.test(reparto.dueno) && reparto.equipo.join() === 'admin'
      && reparto.roles.every(r => /Administrador/.test(r)),
    `dueño: ${reparto.dueno} · equipo: ${reparto.equipo.join(', ')}`);

  await p.screenshot({ path: 'pruebas/usuario-alias.png', fullPage: false });
  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 6) : 'ninguno');
  await b.close();
})();
