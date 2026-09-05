const { chromium } = require('playwright-core');

/* Dos cosas que solo existen en la nube: la hoja de cobranza cerrada —que no
   deja entrar nada, ni al dueño— y los permisos de cada usuario, ahora
   repartidos por sección. Se prueban contra los emuladores de verdad. */
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
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());
  const ok = (t, c, x = '') => console.log(`${c ? '✅' : '❌'} ${t}${x ? ' — ' + x : ''}`);

  const hayPin = () => p.evaluate(() => document.getElementById('modal-pin').open);
  const responderPin = async codigo => {
    if (!await hayPin()) return false;
    await p.fill('#pin-input', codigo);
    await p.evaluate(() => document.getElementById('btn-pin-ok').click());
    await p.waitForTimeout(900);
    return true;
  };

  await p.goto('http://localhost:8099/index.html?emulador');
  await p.waitForTimeout(1800);
  await p.fill('#a-email', CORREO);
  await p.fill('#a-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-auth-principal').click());
  await p.waitForTimeout(3400);
  ok('El dueño entra', await p.evaluate(() => document.getElementById('auth-screen').hidden));

  // Código de seguridad, que hace falta para reabrir
  await p.evaluate(() => document.getElementById('nav-settings').click());
  await p.waitForTimeout(900);
  await p.fill('#s-pin-nuevo', '2468');
  await p.evaluate(() => document.getElementById('btn-pin-guardar').click());
  await p.waitForTimeout(1200);

  // ── 1) Los permisos, agrupados por sección ──
  await p.evaluate(() => document.getElementById('nav-usuarios').click());
  await p.waitForTimeout(1600);
  const alta = await p.evaluate(() => {
    const caja = document.getElementById('u-perms-nuevo');
    return {
      secciones: [...caja.querySelectorAll('.u-seccion legend')].map(l => l.textContent.trim()),
      permisos: caja.querySelectorAll('.u-perm').length,
    };
  });
  ok('El alta ofrece los permisos partidos por sección',
    alta.secciones.length >= 8 && alta.permisos > 12,
    `${alta.secciones.length} secciones · ${alta.permisos} permisos`);
  ok('Y están las secciones del sistema, en su orden',
    /Dashboard/.test(alta.secciones[0]) && alta.secciones.some(t => /Notas de venta/.test(t))
      && alta.secciones.some(t => /Kardex/.test(t)),
    alta.secciones.join(' · '));

  // Se crea un empleado sin permisos de almacén
  await p.fill('#u-usuario', 'juan');
  await p.fill('#u-pass', CLAVE);
  await p.evaluate(() => {
    ['productos', 'productosEditar', 'ingresos', 'ajustes', 'kardex', 'dashboard']
      .forEach(k => { const c = document.getElementById('u-perm-' + k); if (c) c.checked = false; });
    document.getElementById('btn-u-crear').click();
  });
  await p.waitForTimeout(3400);
  const ficha = await p.evaluate(() => {
    const art = document.querySelector('#usuarios-list .usuario-item');
    if (!art) return null;
    return {
      usuario: art.querySelector('strong').textContent.trim(),
      secciones: [...art.querySelectorAll('.u-seccion legend')].map(l => l.textContent.trim()),
      marcados: [...art.querySelectorAll('.u-perm input:checked')].map(i => i.dataset.perm),
    };
  });
  ok('La ficha del empleado enseña los permisos por sección',
    ficha && ficha.usuario === 'juan' && ficha.secciones.length >= 8,
    ficha ? `${ficha.usuario} · ${ficha.secciones.length} secciones` : 'no se creó');
  ok('Sin almacén marcado, pero con lo de ventas que sí le tocaba',
    ficha && !ficha.marcados.includes('kardex') && !ficha.marcados.includes('ingresos')
      && ficha.marcados.includes('ventas') && ficha.marcados.includes('ventasEditar'),
    ficha ? ficha.marcados.join(', ') : '');

  // ── 2) El empleado no ve lo que no le toca ──
  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2600);
  await p.fill('#a-email', 'juan');
  await p.fill('#a-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-auth-principal').click());
  await p.waitForTimeout(3400);
  const menu = await p.evaluate(() => {
    const ver = id => { const el = document.getElementById(id); return el && !el.hidden; };
    return { ventas: ver('nav-ventas'), kardex: ver('nav-kardex'),
      ingresos: ver('nav-ingresos'), productos: ver('nav-productos'), dashboard: ver('nav-dashboard') };
  });
  ok('El empleado ve Notas de venta pero no el almacén ni el Dashboard',
    menu.ventas && !menu.kardex && !menu.ingresos && !menu.productos && !menu.dashboard,
    JSON.stringify(menu));

  await p.evaluate(() => document.getElementById('btn-logout').click());
  await p.waitForTimeout(2600);
  await p.fill('#a-email', CORREO);
  await p.fill('#a-pass', CLAVE);
  await p.evaluate(() => document.getElementById('btn-auth-principal').click());
  await p.waitForTimeout(3400);

  // ── 3) La hoja de cobranza cerrada ──
  await p.evaluate(() => document.getElementById('nav-clientes').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('btn-cli-registrar').click());
  await p.waitForTimeout(600);
  await p.fill('#cli-nombre', 'BODEGA LA ESQUINA');
  await p.selectOption('#cli-zona', 'CIUDAD');
  await p.evaluate(() => document.getElementById('btn-cli-guardar').click());
  await p.waitForTimeout(1400);

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('btn-new').click());
  await p.waitForTimeout(1000);
  await p.fill('#f-boleta', '7001');
  await p.fill('#f-cliente-buscar', 'BODEGA');
  await p.waitForTimeout(700);
  await p.click('#cliente-sugerencias li[data-id]').catch(() => {});
  await p.waitForTimeout(500);
  await p.fill('#f-monto', '900');
  await p.evaluate(() => document.getElementById('btn-guardar').click());
  await p.waitForTimeout(2000);

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1600);
  await p.evaluate(() => { const x = document.getElementById('btn-hoja-crear'); if (x) x.click(); });
  await p.waitForTimeout(2600);
  await p.evaluate(() => document.getElementById('btn-hoja-cerrar').click());
  await p.waitForTimeout(2400);
  const cerrada = await p.evaluate(() => ({
    badge: document.getElementById('cob-estado-badge').textContent.trim(),
    detalle: document.getElementById('cob-estado-detalle').textContent.replace(/\s+/g, ' ').trim(),
    reabrir: !document.getElementById('btn-hoja-reabrir').hidden,
  }));
  ok('La hoja queda cerrada, y lo dice claro',
    /Cerrada/i.test(cerrada.badge) && /no entra ni sale/i.test(cerrada.detalle),
    cerrada.detalle.slice(0, 90));
  ok('Y aparece el botón de reabrirla, que es la única puerta', cerrada.reabrir);

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('#table-body [data-info]').click());
  await p.waitForTimeout(1400);
  const bloqueo = await p.evaluate(() => ({
    aviso: document.getElementById('info-cobro-bloqueo').hidden
      ? '' : document.getElementById('info-cobro-bloqueo').textContent.trim(),
    formOculto: document.getElementById('info-cobro-form').hidden,
  }));
  ok('Con la hoja cerrada NO se puede cobrar, ni siendo el dueño',
    bloqueo.formOculto && /cerrada/i.test(bloqueo.aviso), bloqueo.aviso.slice(0, 90));
  await p.evaluate(() => document.getElementById('btn-info-cerrar').click());
  await p.waitForTimeout(600);

  await p.evaluate(() => document.getElementById('nav-cobranza').click());
  await p.waitForTimeout(1400);
  await p.evaluate(() => document.getElementById('btn-hoja-reabrir').click());
  await p.waitForTimeout(1000);
  await responderPin('2468');
  await p.waitForTimeout(1800);
  const reabierta = await p.evaluate(() => ({
    badge: document.getElementById('cob-estado-badge').textContent.trim(),
    detalle: document.getElementById('cob-estado-detalle').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('El administrador la reabre con su código, y queda anotado quién fue',
    /Abierta/i.test(reabierta.badge) && /Reabierta por/i.test(reabierta.detalle),
    reabierta.detalle.slice(0, 100));

  await p.evaluate(() => document.getElementById('nav-inicio').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('#table-body [data-info]').click());
  await p.waitForTimeout(1400);
  const desbloqueado = await p.evaluate(() => document.getElementById('info-cobro-form').hidden);
  ok('Y con la hoja reabierta se vuelve a poder cobrar', !desbloqueado);

  ok('Sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
})();
