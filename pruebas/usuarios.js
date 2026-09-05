const { chromium } = require('playwright-core');
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const CORREO = 'astro@ejemplo.com', CLAVE = 'clave-larga-123';

/* Usuarios y accesos: alta ordenada a dos columnas, el dueño aparte del
   equipo, y los empleados sin poder borrar clientes. */
(async () => {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-creditos/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8081/emulator/v1/projects/demo-creditos/databases/(default)/documents', { method: 'DELETE' });
  await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE, returnSecureToken: true }) });

  const b = await chromium.launch({ executablePath: require('./navegador') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
  p.on('dialog', d => d.accept());
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);
  const entrar = async (u, c) => {
    await p.fill('#a-email', u); await p.fill('#a-pass', c);
    await p.evaluate(() => document.getElementById('btn-auth-principal').click());
    await p.waitForTimeout(3000);
  };

  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await entrar(CORREO, CLAVE);
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1600);

  // ── 1) La sección va a dos columnas en PC ──
  const layout = await p.evaluate(() => {
    const alta = document.querySelector('.usr-alta').getBoundingClientRect();
    const col = document.querySelector('.usr-col').getBoundingClientRect();
    return { columnas: getComputedStyle(document.querySelector('.usr-layout')).gridTemplateColumns.split(' ').length,
      ladoALado: alta.right <= col.left + 2, ancho: Math.round(alta.width + col.width) };
  });
  ok('El alta y el equipo van lado a lado en la pantalla de PC',
    layout.columnas === 2 && layout.ladoALado, JSON.stringify(layout));

  const permisos = await p.evaluate(() => ({
    casillas: document.querySelectorAll('#u-perms-nuevo .u-perm').length,
    secciones: Array.from(document.querySelectorAll('#u-perms-nuevo .u-seccion legend')).map(l => l.textContent.trim()),
    cols: getComputedStyle(document.getElementById('u-perms-nuevo')).gridTemplateColumns.split(' ').length,
    textos: Array.from(document.querySelectorAll('#u-perms-nuevo .u-perm span')).map(s => s.textContent.trim()),
  }));
  ok('Los permisos del alta van agrupados por sección, en columnas',
    permisos.secciones.length >= 8 && permisos.casillas > 12 && permisos.cols >= 2,
    `${permisos.secciones.length} secciones · ${permisos.casillas} permisos · ${permisos.cols} columnas`);
  ok('Hay una sección por cada parte del sistema',
    permisos.secciones.some(t => /Dashboard/.test(t)) && permisos.secciones.some(t => /Notas de venta/.test(t))
      && permisos.secciones.some(t => /Kardex/.test(t)) && permisos.secciones.some(t => /Despachos/.test(t)),
    permisos.secciones.join(' · '));
  ok('Y ya no ofrece el permiso viejo de vencimiento',
    !permisos.textos.some(t => /vencimiento/i.test(t)));

  // El alta ya no pregunta cómo mostrar a la persona
  const campos = await p.$$eval('#u-form-nuevo .usr-campos input',
    ins => ins.map(i => i.id));
  ok('El alta solo pide usuario y contraseña',
    campos.length === 2 && campos.includes('u-usuario') && campos.includes('u-pass'), campos.join(' + '));
  ok('Ya no existe el campo del nombre para mostrar',
    !(await p.$('#u-nombre')) && !(await p.$('#alias-nombre')));

  // ── 2) El dueño va aparte del equipo ──
  const dueno = await p.evaluate(() => ({
    visible: !document.getElementById('usr-dueno').hidden,
    nombre: document.getElementById('usr-dueno-nombre').textContent.trim(),
    conRenombrar: !!document.getElementById('btn-dueno-renombrar'),
    enEquipo: document.querySelectorAll('#usuarios-list .usuario-item').length,
    vacio: !document.getElementById('usuarios-vacio').hidden,
  }));
  ok('La cuenta del dueño se muestra aparte, no como un empleado más',
    dueno.visible && dueno.enEquipo === 0 && dueno.vacio, JSON.stringify(dueno));
  ok('Y ya no ofrece cambiarle el nombre: se la identifica por su usuario',
    !dueno.conRenombrar && dueno.nombre.includes('@'), dueno.nombre);

  await p.screenshot({ path: 'pruebas/usuarios-vacio.png', clip: { x: 0, y: 0, width: 1500, height: 760 } });

  // ── 3) Crear un empleado funciona (antes reventaba) ──
  await p.fill('#u-usuario', 'juan');
  await p.fill('#u-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-u-crear').click());
  await p.waitForTimeout(3200);
  const tras = await p.evaluate(() => ({
    equipo: document.querySelectorAll('#usuarios-list .usuario-item').length,
    usuario: (document.querySelector('.usuario-id strong') || {}).textContent,
    alias: !!document.querySelector('.usuario-alias'),
    perms: document.querySelectorAll('#usuarios-list .u-perm').length,
  }));
  ok('Se puede crear un empleado', tras.equipo === 1, JSON.stringify(tras));
  ok('La ficha muestra el usuario, y ya no un nombre aparte',
    tras.usuario === 'juan' && !tras.alias, String(tras.usuario));
  ok('Con todos sus permisos marcables, por sección', tras.perms > 12, String(tras.perms));

  // Un administrador del equipo no lleva casillas, lleva "todos los permisos"
  await p.fill('#u-usuario', 'admin');
  await p.fill('#u-pass', CLAVE);
  await p.evaluate(() => document.getElementById('u-admin').click());
  await p.evaluate(() => document.getElementById('btn-u-crear').click());
  await p.waitForTimeout(3200);
  const conAdmin = await p.evaluate(() => {
    const fichas = Array.from(document.querySelectorAll('#usuarios-list .usuario-item'));
    const f = fichas.find(x => x.querySelector('.usuario-id strong').textContent.trim() === 'admin');
    return { total: fichas.length, casillas: f ? f.querySelectorAll('.u-perm').length : -1,
      texto: f ? (f.querySelector('.usuario-todos') || {}).textContent : '' };
  });
  ok('A un administrador no se le marcan permisos sueltos: los tiene todos',
    conAdmin.total === 2 && conAdmin.casillas === 0 && /Todos los permisos/.test(conAdmin.texto || ''),
    JSON.stringify(conAdmin));

  // Tras crear un administrador, el alta vuelve a mostrar los permisos
  const trasCrearAdmin = await p.evaluate(() => ({
    marcado: document.getElementById('u-admin').checked,
    permisosALaVista: !document.getElementById('u-permisos-detalle').hidden,
  }));
  ok('Tras crear un administrador, el alta vuelve a ofrecer los permisos',
    !trasCrearAdmin.marcado && trasCrearAdmin.permisosALaVista, JSON.stringify(trasCrearAdmin));

  // Y al marcar "Administrador" se ocultan, que ya no hacen falta
  await p.evaluate(() => document.getElementById('u-admin').click());
  await p.waitForTimeout(250);
  ok('Al marcar "Administrador" las casillas sueltas se esconden',
    await p.evaluate(() => document.getElementById('u-permisos-detalle').hidden));
  await p.evaluate(() => document.getElementById('u-admin').click());
  await p.waitForTimeout(250);

  await p.screenshot({ path: 'pruebas/usuarios-lleno.png', clip: { x: 0, y: 0, width: 1500, height: 860 } });

  // ── 4) Clientes: el empleado no puede borrar ──
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(400);
  await p.fill('#cli-nombre', 'CLIENTE DE PRUEBA');
  await p.selectOption('#cli-zona', 'PADRE ALDAMIZ');
  await p.selectOption('#cli-categoria', 'B');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(2000);
  ok('El administrador sí ve el botón de borrar cliente',
    (await p.$$eval('[data-borrar-cliente]', b => b.length)) === 1);

  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2400);
  await entrar('juan', CLAVE);
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(1600);
  const empleado = await p.evaluate(() => ({
    filas: document.querySelectorAll('.cliente-item, [data-editar-cliente]').length,
    borrar: document.querySelectorAll('[data-borrar-cliente]').length,
    editar: document.querySelectorAll('[data-editar-cliente]').length,
  }));
  ok('El empleado NO ve el botón de borrar cliente',
    empleado.borrar === 0 && empleado.editar === 1, JSON.stringify(empleado));

  // Y si lo intenta a la fuerza saltándose la pantalla, la base de datos lo
  // rechaza igual: es la regla la que manda, no el botón escondido.
  const FS = 'http://127.0.0.1:8081/v1/projects/demo-creditos/databases/(default)/documents';
  const entrarPorREST = async (correo, clave) => {
    const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-key`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave, returnSecureToken: true }) });
    return r.json();
  };
  const dueñoTok = await entrarPorREST(CORREO, CLAVE);
  const juanTok = await entrarPorREST('juan@usuarios.empresa-ab.app', CLAVE);
  const lista = await (await fetch(`${FS}/usuarios/${dueñoTok.localId}/clientes`,
    { headers: { Authorization: 'Bearer ' + dueñoTok.idToken } })).json();
  const ruta = lista.documents[0].name.split('/documents/')[1];
  const borrarCon = async tok => (await fetch(`${FS}/${ruta}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } })).status;

  const comoEmpleado = await borrarCon(juanTok.idToken);
  ok('La base de datos rechaza que el empleado borre un cliente',
    comoEmpleado === 403, 'HTTP ' + comoEmpleado);
  const comoAdmin = await borrarCon(dueñoTok.idToken);
  ok('Y sí deja borrarlo al administrador', comoAdmin === 200, 'HTTP ' + comoAdmin);

  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(800);
  ok('El empleado no entra a Usuarios',
    await p.evaluate(() => document.getElementById('view-usuarios').hidden));

  console.log('\nerrores de JS:', errs.length ? errs.slice(0, 6) : 'ninguno');
  await b.close();
})();
