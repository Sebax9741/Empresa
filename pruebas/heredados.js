const { chromium } = require('playwright-core');

/* El caso real que rompía: un empleado dado de alta ANTES de que existieran
   los permisos finos. En su ficha no está la clave "ventasEditar", así que:
     · la app se la da por heredada de "ventas" y le enseña el botón ✏️
     · las reglas miraban la ficha, no la encontraban y decían que no
   Y al guardar saltaba "La base de datos rechazó el cambio", sin que él
   hubiera hecho nada mal.

   Aquí se siembra una ficha vieja DE VERDAD (por la puerta de atrás, sin pasar
   por el formulario nuevo, que es lo que despistó a la prueba anterior) y se
   comprueba que ahora sí puede trabajar; que una casilla desmarcada a
   propósito sigue diciendo NO; y que al entrar el administrador la ficha queda
   con todo por escrito. */
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8081/v1/projects/demo-creditos/databases/(default)/documents';
const CORREO = 'dueno@ejemplo.com', CLAVE = 'clave-larga-123';
const DOMINIO = 'usuarios.empresa-ab.app';

async function limpiar() {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-creditos/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8081/emulator/v1/projects/demo-creditos/databases/(default)/documents',
    { method: 'DELETE' });
}
const alta = (email) => fetch(`${AUTH}/accounts:signUp?key=demo-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: CLAVE, returnSecureToken: true }) }).then(r => r.json());

(async () => {
  await limpiar();
  const dueno = await alta(CORREO);
  const viejo = await alta(`viejo@${DOMINIO}`);      // ficha de antes: sin permisos finos
  const negado = await alta(`negado@${DOMINIO}`);    // con "ventasEditar" desmarcado a propósito
  const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dueno.idToken };
  const uid = dueno.localId;
  const escribir = (ruta, fields) =>
    fetch(`${FS}/usuarios/${uid}/${ruta}`, { method: 'PATCH', headers: cab, body: JSON.stringify({ fields }) });
  const leer = async ruta => {
    const r = await fetch(`${FS}/usuarios/${uid}/${ruta}`, { headers: cab });
    return r.ok ? (await r.json()).fields || {} : null;
  };
  const si = { booleanValue: true }, no = { booleanValue: false };

  await fetch(`${FS}/config/app`, { method: 'PATCH', headers: cab,
    body: JSON.stringify({ fields: { ownerUid: { stringValue: uid }, creado: { integerValue: String(Date.now()) } } }) });
  await escribir(`miembros/${uid}`, {
    usuario: { stringValue: CORREO }, nombre: { stringValue: 'Administrador' },
    rol: { stringValue: 'admin' }, permisos: { mapValue: { fields: {} } },
    creado: { integerValue: String(Date.now()) },
  });
  // La ficha de antes: SOLO los permisos gruesos que existían entonces
  await escribir(`miembros/${viejo.localId}`, {
    usuario: { stringValue: 'viejo' }, rol: { stringValue: 'empleado' },
    permisos: { mapValue: { fields: {
      crear: si, editar: si, pagos: si, cobranza: si, clientes: si, ventas: si,
    } } },
    creado: { integerValue: String(Date.now()) },
  });
  // Y una con la casilla desmarcada aposta: eso es un NO, no un "no está"
  await escribir(`miembros/${negado.localId}`, {
    usuario: { stringValue: 'negado' }, rol: { stringValue: 'empleado' },
    permisos: { mapValue: { fields: {
      crear: si, editar: si, pagos: si, cobranza: si, clientes: si, ventas: si,
      ventasEditar: no,
    } } },
    creado: { integerValue: String(Date.now()) },
  });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept('mal anotada'));
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const entrar = async u => {
    await p.fill('#a-email', u); await p.fill('#a-pass', CLAVE);
    await p.evaluate(() => document.getElementById('btn-auth-principal').click());
    await p.waitForTimeout(3800);
  };
  const salir = async () => {
    await p.evaluate(() => document.getElementById('btn-logout').click());
    await p.waitForTimeout(2600);
  };
  const rechazado = () => p.evaluate(() => {
    const t = document.getElementById('toast');
    return (!t.hidden && /rechazó el cambio/i.test(t.textContent)) ? t.textContent.trim() : '';
  });
  const emitirNota = async cant => {
    await p.evaluate(() => document.getElementById('nav-ventas').click());
    await p.waitForTimeout(1100);
    await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
    await p.waitForTimeout(1100);
    await p.fill('#nv-cliente-buscar', 'JUANA');
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
    await p.waitForTimeout(500);
    await p.fill('#nv-buscar-producto', 'HARINA');
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
    await p.waitForTimeout(400);
    await p.fill('#nv-cantidad', String(cant));
    await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
    await p.waitForTimeout(2600);
  };

  // ── El dueño deja producto, stock y cliente ──
  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await entrar(CORREO);
  ok('El dueño entra', await p.evaluate(() => document.getElementById('auth-screen').hidden));

  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(500);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  for (const l of ['a', 'b', 'c']) await p.fill(`#prod-precio-${l}`, '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(800);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '200');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(500);
  await p.fill('#cli-nombre', 'JUANA HUISA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1400);

  // Al entrar el dueño, las fichas viejas quedan con todo por escrito
  const fichaTras = await leer(`miembros/${viejo.localId}`);
  const claves = Object.keys(((fichaTras || {}).permisos || {}).mapValue.fields || {});
  ok('Al entrar el administrador, la ficha vieja queda con los permisos por escrito',
    claves.includes('ventasEditar') && claves.includes('ventasAnular') && claves.includes('preciosEditar'),
    `${claves.length} permisos escritos`);
  ok('Y lo que se le escribe es lo que ya venía haciendo, ni más ni menos',
    ((fichaTras.permisos.mapValue.fields.ventasEditar || {}).booleanValue === true)
      && ((fichaTras.permisos.mapValue.fields.kardex || {}).booleanValue === false),
    'ventasEditar heredado de ventas · kardex sigue en no');

  const fichaNegado = await leer(`miembros/${negado.localId}`);
  ok('La casilla desmarcada a propósito sigue desmarcada: no se le regala nada',
    (fichaNegado.permisos.mapValue.fields.ventasEditar || {}).booleanValue === false);

  // ── El de la ficha vieja: emite y MODIFICA su nota ──
  await salir();
  await entrar('viejo');
  ok('El empleado de siempre entra', await p.evaluate(() => document.getElementById('auth-screen').hidden));
  await emitirNota(4);
  ok('Emite su nota', !await rechazado()
    && await p.evaluate(() => document.querySelectorAll('#nv-body tr').length) === 1);

  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1100);
  ok('La app le ofrece modificarla', await p.evaluate(() => !!document.querySelector('[data-editar-nota]')));
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(1500);
  await p.fill('[data-nv-cant="0"]', '7');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(3000);
  const avisoCantidad = await rechazado();
  ok('Cambia la cantidad y la nube NO se lo rechaza', !avisoCantidad,
    avisoCantidad || 'sin aviso de rechazo');

  // Y lo mismo pasando una línea a bonificación, que es lo que él hacía
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1100);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-nv-bonif]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(3000);
  const avisoBonif = await rechazado();
  ok('Pasa una línea a bonificación y tampoco se lo rechaza', !avisoBonif,
    avisoBonif || 'sin aviso de rechazo');
  ok('Y la bonificación queda guardada',
    await p.evaluate(() => document.querySelectorAll('#nv-body tr').length) === 1 && !avisoBonif);

  // ── El que lo tiene desmarcado sigue sin poder ──
  await salir();
  await entrar('negado');
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1300);
  ok('A quien se le desmarcó, la app ni le ofrece el botón de modificar',
    await p.evaluate(() => !document.querySelector('[data-editar-nota]')));

  // ── Las reglas tienen que deducir SOLAS, sin esperar a la migración ──
  // Se le devuelve a "viejo" su ficha de antes y entra él directamente, sin
  // que el administrador pase por medio a arreglársela. Si esto pasa, es que
  // las reglas heredan por su cuenta y no dependen de que alguien entre.
  await salir();
  await fetch(`${FS}/usuarios/${uid}/miembros/${viejo.localId}?updateMask.fieldPaths=permisos`, {
    method: 'PATCH', headers: cab,
    body: JSON.stringify({ fields: { permisos: { mapValue: { fields: {
      crear: si, editar: si, pagos: si, cobranza: si, clientes: si, ventas: si,
    } } } } }),
  });
  await entrar('viejo');
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(1500);
  await p.fill('[data-nv-cant="0"]', '9');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(3000);
  const avisoSinMigrar = await rechazado();
  ok('Con la ficha vieja SIN arreglar, las reglas heredan igual y le dejan guardar',
    !avisoSinMigrar, avisoSinMigrar || 'sin aviso de rechazo');

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
