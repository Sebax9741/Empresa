const { chromium } = require('playwright-core');

/* Un vendedor que NO es administrador. La app le deja modificar y anular sus
   notas de venta —tiene los permisos— pero las reglas de Firestore exigían
   ser administrador para tocar una nota, así que al guardar saltaba
   "La base de datos rechazó el cambio". Aquí se comprueba de punta a punta que
   un empleado normal puede hacer su trabajo, y que lo que NO le toca sigue
   estando cerrado. */
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const CORREO = 'dueno@ejemplo.com', CLAVE = 'clave-larga-123';

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

  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept('mal anotada'));
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const entrar = async (u, c) => {
    await p.fill('#a-email', u); await p.fill('#a-pass', c);
    await p.evaluate(() => document.getElementById('btn-auth-principal').click());
    await p.waitForTimeout(3600);
  };
  const salir = async () => {
    await p.evaluate(() => document.getElementById('btn-logout').click());
    await p.waitForTimeout(2600);
  };
  const stock = async nombre => p.evaluate(n => {
    document.getElementById('nav-productos').click();
    // La columna de stock se busca por su título y no por su número: contarlas
    // a mano es lo que las rompió al añadir la del flete.
    const iStock = [...document.querySelectorAll('#prod-tabla thead th')]
      .findIndex(th => /stock/i.test(th.textContent));
    const fila = [...document.querySelectorAll('#prod-body tr')].find(t => t.textContent.includes(n));
    return fila ? fila.cells[iStock].textContent.trim().replace(' ⚠️', '') : '';
  }, nombre);
  // El aviso que salta cuando la base de datos rechaza una escritura
  const rechazado = () => p.evaluate(() => {
    const t = document.getElementById('toast');
    return (!t.hidden && /rechazó el cambio/i.test(t.textContent)) ? t.textContent.trim() : '';
  });

  /* Un puente para poder intentar una escritura a mano contra las reglas de
     verdad. Del programa solo `DB` está expuesto, así que se le pega al final
     de js/app.js mientras se sirve: es un módulo, y lo pegado corre dentro de
     su mismo ámbito. La app que se publica no lleva nada de esto. */
  await p.route('**/js/app.js', async r => {
    const cuerpo = await (await r.fetch()).text();
    await r.fulfill({ contentType: 'application/javascript', body: cuerpo + `
;window.__reglas = {
  async escribirCliente(cambios) {
    const c = { ...clientes[0], ...cambios };
    try {
      await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'clientes', c.id), c);
      return 'aceptado';
    } catch (e) { return 'rechazado: ' + (e.code || e.message); }
  },
  get limiteActual() { return clientes[0] ? (clientes[0].limiteCreditos || 0) : null; },
};` });
  });
  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await entrar(CORREO, CLAVE);
  ok('El dueño entra', await p.evaluate(() => document.getElementById('auth-screen').hidden));

  // Producto, cliente y stock, para tener con qué vender
  await p.evaluate(() => document.getElementById('nav-productos').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('btn-prod-nuevo').click());
  await p.waitForTimeout(500);
  await p.fill('#prod-nombre', 'HARINA ITALIANA X50KG');
  await p.fill('#prod-precio-a', '100');
  await p.evaluate(() => document.querySelector('#prod-form button[type=submit]').click());
  await p.waitForTimeout(900);

  await p.evaluate(() => document.getElementById('nav-ingresos').click());
  await p.waitForTimeout(700);
  await p.fill('#ing-buscar', 'HARINA');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-ing-elegir]').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-cantidad', '100');
  await p.evaluate(() => document.getElementById('btn-ing-agregar').click());
  await p.waitForTimeout(400);
  await p.fill('#ing-doc-numero', 'F001-1');
  await p.evaluate(() => document.getElementById('btn-ing-guardar').click());
  await p.waitForTimeout(1400);

  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(500);
  await p.fill('#cli-nombre', 'JUANA HUISA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1300);

  // ── Un vendedor: emite, modifica y anula notas. Nada de almacén. ──
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1500);
  await p.fill('#u-usuario', 'alexander');
  await p.fill('#u-pass', CLAVE);
  await p.evaluate(() => {
    for (const k of ['productos', 'productosEditar', 'ingresos', 'ajustes', 'kardex', 'borrar', 'despachos']) {
      const c = document.getElementById('u-perm-' + k);
      if (c) c.checked = false;
    }
    for (const k of ['ventas', 'ventasEditar', 'ventasAnular']) {
      const c = document.getElementById('u-perm-' + k);
      if (c) c.checked = true;
    }
    document.getElementById('btn-u-crear').click();
  });
  await p.waitForTimeout(3600);

  const alta = await p.evaluate(() => {
    const caja = document.getElementById('u-perms-nuevo');
    return {
      hayPrecios: !!caja.querySelector('#u-perm-preciosEditar'),
      marcado: (caja.querySelector('#u-perm-preciosEditar') || {}).checked,
    };
  });
  ok('El alta ofrece el permiso de modificar precios', alta.hayPrecios);
  ok('Y no viene puesto: tocar el precio a mano es la excepción', alta.marcado === false);

  await salir();
  await entrar('alexander', CLAVE);
  ok('El vendedor entra', await p.evaluate(() => document.getElementById('auth-screen').hidden));

  // Sin el permiso de precios, la casilla ni se ofrece
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(1200);
  ok('Sin permiso de precios, la casilla 🔓 Modificar precios no aparece',
    await p.evaluate(() => document.querySelector('.nv-permiso').hidden));

  // El talonario lo lleva el administrador: el vendedor ve con qué número
  // está vendiendo, pero no lo cambia (ni la fecha de emisión).
  const cabecera = await p.evaluate(() => ({
    serie: document.getElementById('nv-serie').disabled,
    correlativo: document.getElementById('nv-correlativo').readOnly,
    emision: document.getElementById('nv-fecha').disabled,
    porQue: document.getElementById('nv-correlativo').title,
  }));
  ok('El vendedor no cambia la serie, el número ni la emisión',
    cabecera.serie && cabecera.correlativo && cabecera.emision, JSON.stringify(cabecera));
  ok('Y se le dice por qué al pasar por encima',
    /administrador/i.test(cabecera.porQue), cabecera.porQue);

  // Emite su nota
  await p.fill('#nv-cliente-buscar', 'JUANA');
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-nv-cliente]').click());
  await p.waitForTimeout(600);
  await p.fill('#nv-buscar-producto', 'HARINA');
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('[data-nv-prod]').click());
  await p.waitForTimeout(400);
  await p.fill('#nv-cantidad', '4');
  await p.evaluate(() => document.getElementById('btn-nv-agregar').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(2500);
  ok('Emite su nota de venta sin que la base la rechace',
    !await rechazado() && await p.evaluate(() => document.querySelectorAll('#nv-body tr').length) === 1);
  ok('Y el stock bajó como debe', await stock('HARINA') === '96', `salió ${await stock('HARINA')}`);

  // ── Lo que fallaba: MODIFICAR su propia nota ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.querySelector('[data-editar-nota]').click());
  await p.waitForTimeout(1500);
  await p.fill('[data-nv-cant="0"]', '7');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('btn-nv-guardar').click());
  await p.waitForTimeout(3000);
  const avisoAlEditar = await rechazado();
  ok('Modifica su nota SIN que la base de datos la rechace',
    !avisoAlEditar, avisoAlEditar || 'sin aviso de rechazo');
  ok('Y el stock se recalcula con la cantidad nueva',
    await stock('HARINA') === '93', `salió ${await stock('HARINA')}, esperado 93`);

  // ── Y ANULARLA, que toca nota, kardex, despacho y crédito ──
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.querySelector('[data-anular-nota]').click());
  await p.waitForTimeout(3200);
  const avisoAlAnular = await rechazado();
  ok('Anula su nota SIN que la base de datos la rechace',
    !avisoAlAnular, avisoAlAnular || 'sin aviso de rechazo');
  ok('La nota queda marcada como anulada, no borrada',
    await p.evaluate(() => document.querySelectorAll('.nv-fila-anulada').length) === 1);
  ok('Y la mercadería vuelve al almacén', await stock('HARINA') === '100',
    `salió ${await stock('HARINA')}, esperado 100`);

  // ── Lo que NO le toca sigue cerrado ──
  const menu = await p.evaluate(() => {
    const ver = id => { const el = document.getElementById(id); return el && !el.hidden; };
    return { kardex: ver('nav-kardex'), ingresos: ver('nav-ingresos'), productos: ver('nav-productos') };
  });
  ok('Sigue sin ver el almacén: el permiso nuevo no le abrió otras puertas',
    !menu.kardex && !menu.ingresos && !menu.productos, JSON.stringify(menu));

  // ── Con el permiso puesto, sí puede tocar precios ──
  await salir();
  await entrar(CORREO, CLAVE);
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1800);
  await p.evaluate(() => {
    const art = [...document.querySelectorAll('#usuarios-list .usuario-item')]
      .find(a => a.textContent.includes('alexander'));
    // Los permisos se guardan al marcar la casilla, sin botón aparte
    const cb = art.querySelector('[data-perm="preciosEditar"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(2600);
  await salir();
  await entrar('alexander', CLAVE);
  await p.evaluate(() => document.getElementById('nav-ventas').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('btn-nv-nueva').click());
  await p.waitForTimeout(1200);
  ok('Con el permiso dado, la casilla 🔓 Modificar precios ya aparece',
    !await p.evaluate(() => document.querySelector('.nv-permiso').hidden));

  /* ── El límite de créditos es del dueño, y no solo de boquilla ──
     Cortarle el fiado a un cliente —o levantárselo— lo decide quien manda, no
     el vendedor que está delante del mostrador aguantando la insistencia. La
     app le pone el campo en gris, pero eso es comodidad: lo que de verdad
     tiene que impedirlo son las reglas de la base de datos. Aquí se comprueba
     saltándose la pantalla: se intenta la escritura a pelo. */
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-editar-cliente]').click());
  await p.waitForTimeout(800);
  const campo = await p.evaluate(() => {
    const el = document.getElementById('cli-limite');
    return { soloLectura: el.readOnly, aviso: el.title };
  });
  ok('Al vendedor el campo del límite le sale bloqueado',
    campo.soloLectura && /administrador/i.test(campo.aviso), JSON.stringify(campo));
  await p.evaluate(() => document.getElementById('btn-cli-cancelar').click());
  await p.waitForTimeout(500);

  const intento = await p.evaluate(() => window.__reglas.escribirCliente({ limiteCreditos: 99 }));
  ok('Y si se salta la pantalla, la base de datos se lo rechaza igual',
    /rechazado/.test(intento), intento);
  ok('El límite del cliente queda como estaba',
    await p.evaluate(() => window.__reglas.limiteActual) !== 99,
    String(await p.evaluate(() => window.__reglas.limiteActual)));
  // Y que el rechazo sea POR EL LÍMITE, no porque no pueda tocar clientes:
  // si no, esta comprobación pasaría en verde aunque la regla no existiera.
  const sinTocarElLimite = await p.evaluate(() =>
    window.__reglas.escribirCliente({ telefono: '987 111 222' }));
  ok('Pero lo demás del cliente sí lo puede corregir: la regla cierra el límite, no la ficha',
    sinTocarElLimite === 'aceptado', sinTocarElLimite);

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
