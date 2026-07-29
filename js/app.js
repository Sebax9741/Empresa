import { descargarXlsx } from './xlsx-lite.js';

/* ====== Estado global ====== */
let creditos = [];
let clientes = [];        // base de datos de clientes: { id, nombre, zona, direccion, telefono, notas, creado }
let settings = {
  dias: 30,
  moneda: '$',
  avisos: true,
  atajo1: 15,   // atajo rápido 1: días después de la emisión
  atajo2: 45,   // atajo rápido 2: días después de la emisión
};
let vencimientoEditadoManual = false;

/* Modo nube (Firebase) */
let modoNube = false;
let fb = null;            // SDK y referencias de Firebase
let unsubSnapshot = null; // cancela la suscripción en tiempo real
let unsubClientes = null; // suscripción en tiempo real de la lista de clientes
let unsubAjustes = null;  // suscripción a la configuración del negocio
let unsubSeguridad = null; // suscripción al código de seguridad
let migracionRevisada = false;
let ownerUid = null;      // dónde viven los datos del negocio (dueño)
let yo = null;            // membresía del usuario actual: { usuario, nombre, rol, permisos }

/* Dominio interno para convertir "usuario" en un correo que entiende Firebase */
const DOMINIO_USUARIOS = 'usuarios.empresa-ab.app';
function usuarioAEmail(entrada) {
  const v = String(entrada).trim();
  return v.includes('@') ? v.toLowerCase() : `${v.toLowerCase()}@${DOMINIO_USUARIOS}`;
}

/* Permisos del usuario actual */
const PERMISOS_TODOS = { borrar: true, editar: true, crear: true, pagos: true, cobranza: true, clientes: true };
function esAdmin() { return modoNube && !!(yo && yo.rol === 'admin'); }
function puede(nombre) {
  if (!modoNube) return true;         // modo local: un solo dueño, todo permitido
  if (yo && yo.rol === 'admin') return true;
  if (!yo || !yo.permisos) return false;
  const valor = yo.permisos[nombre];
  // Usuarios creados antes de que existiera el permiso "clientes": se rigen por "crear"
  if (valor === undefined && nombre === 'clientes') return !!yo.permisos.crear;
  return !!valor;
}

const EMULADOR = new URLSearchParams(location.search).has('emulador');

/* ====== Utilidades ====== */
const $ = sel => document.querySelector(sel);

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(y, m - 1, d + Number(dias));
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function formatoFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatoMonto(n) {
  const num = Number(n) || 0;
  return `${settings.moneda} ${num.toLocaleString('es', { maximumFractionDigits: 2 })}`;
}

function diasHastaVencimiento(vencimientoISO) {
  const [y, m, d] = vencimientoISO.split('-').map(Number);
  const venc = new Date(y, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((venc - hoy) / 86400000);
}

/* ====== Zonas, meses y abonos "a cuenta" ====== */
const ZONAS = ['MODELO', '3 DE MAYO', 'CIUDAD', 'MILAGROS', 'CARRETERA', 'PADRE ALDAMIZ', 'ALAMEDA'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MAX_ABONOS = 8;

/* Métodos de pago (como tu hoja de cobranza: efectivo / Yape / BCP) */
const METODOS = { efectivo: '💵 Efectivo', yape: '📱 Yape', bcp: '🏦 BCP' };
function metodoDe(a) { return (a && a.metodo && METODOS[a.metodo]) ? a.metodo : 'efectivo'; }
function metodoLabel(m) { return METODOS[m] || METODOS.efectivo; }

function abonosDe(c) { return Array.isArray(c.abonos) ? c.abonos : []; }

/* Quién está usando la app ahora (para dejar constancia en cada "a cuenta") */
function quienSoy() { return (modoNube && yo && yo.usuario) ? yo.usuario : 'dueño'; }

/* Un empleado solo puede quitar una "a cuenta" que él mismo registró HOY.
   Las de días anteriores quedan bloqueadas: solo el administrador las toca. */
function puedeQuitarAbono(a) {
  if (!modoNube) return true;              // modo local: un solo dueño
  if (esAdmin()) return true;
  if (!a || !a.registradoFecha) return false;   // "a cuenta" antigua: solo el admin
  return a.registradoFecha === hoyISO() && a.registradoPor === quienSoy();
}

/* Marca las "a cuenta" cuya fecha de pago no coincide con el día en que
   se registraron (sirve para detectar fechas puestas a mano) */
function abonoConFechaCambiada(a) {
  return !!(a && a.registradoFecha && a.fecha && a.registradoFecha !== a.fecha);
}
function totalAbonado(c) { return abonosDe(c).reduce((s, a) => s + (Number(a.monto) || 0), 0); }

/* Saldo pendiente = monto total − suma de abonos.
   Compatible con créditos antiguos (sin abonos) que ya estaban en 'pagado'. */
function saldoDe(c) {
  const monto = Number(c.monto) || 0;
  if (abonosDe(c).length) return Math.max(0, monto - totalAbonado(c));
  if (c.estado === 'pagado') return 0;
  return monto;
}

/* Estado automático según los abonos: pagado / parcial / pendiente */
function estadoCalculado(c) {
  if (saldoDe(c) <= 0) return 'pagado';
  return totalAbonado(c) > 0 ? 'parcial' : 'pendiente';
}

/* El estado que se muestra: si aún debe y ya pasó la fecha → vencido */
function estadoEfectivo(c) {
  if (saldoDe(c) <= 0) return 'pagado';
  if (diasHastaVencimiento(c.vencimiento) < 0) return 'vencido';
  return totalAbonado(c) > 0 ? 'parcial' : 'pendiente';
}

const ETIQUETAS_ESTADO = {
  pendiente: '🕐 Pendiente',
  parcial: '🪙 Pago parcial',
  pagado: '✅ Pagado',
  vencido: '⚠️ Vencido',
};

function badgeEstado(c) {
  const e = estadoEfectivo(c);
  return `<span class="badge badge-${e}">${ETIQUETAS_ESTADO[e]}</span>`;
}

function textoVencimiento(c) {
  const dias = diasHastaVencimiento(c.vencimiento);
  const fecha = formatoFecha(c.vencimiento);
  if (saldoDe(c) <= 0) return fecha;
  if (dias < 0) return `<span class="venc-alerta">${fecha} (venció hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'})</span>`;
  if (dias === 0) return `<span class="venc-alerta">${fecha} (¡vence hoy!)</span>`;
  if (dias <= 5) return `<span class="venc-pronto">${fecha} (en ${dias} día${dias === 1 ? '' : 's'})</span>`;
  return fecha;
}

/* Arma la hoja de cobranza de un día: todos los pagos "a cuenta" con esa fecha,
   de todas las boletas, con sus totales por método (efectivo / Yape / BCP). */
/* La hoja de cobranza de un día: todos los pagos "a cuenta" hechos esa
   fecha, sin importar de qué crédito vengan. Cada fila dice a qué crédito
   (boleta) y a qué cliente pertenece, cómo pagó y quién lo cobró. */
function hojaCobranza(lista, fechaISO, codigoHoja = '') {
  const filas = [];
  const totales = { efectivo: 0, yape: 0, bcp: 0, total: 0 };
  for (const c of lista) {
    abonosDe(c).forEach((a, indice) => {
      if (a.fecha !== fechaISO) return;
      const monto = Number(a.monto) || 0;
      const metodo = metodoDe(a);
      filas.push({
        creditoId: c.id,
        indice,
        codigo: codigoDeCredito(c),
        boleta: c.boleta,
        cliente: c.cliente,
        zona: c.zona || '',
        monto,
        metodo,
        totalCredito: Number(c.monto) || 0,
        saldo: saldoDe(c),
        cobradoPor: a.registradoPor || '',
        firma: a.firma || '',
        registrado: a.registrado || 0,
        fechaEmision: c.fecha,
        fechaDespacho: c.fechaDespacho,
      });
      totales[metodo] += monto;
      totales.total += monto;
    });
  }
  // En el orden en que se fueron cobrando durante el día
  filas.sort((x, y) => (x.registrado - y.registrado)
    || String(x.boleta).localeCompare(String(y.boleta), undefined, { numeric: true }));
  return { filas, totales, codigoHoja };
}

/* Todos los días que tienen cobros, del más reciente al más antiguo */
function diasConCobros(lista) {
  const dias = new Map();
  for (const c of lista) {
    for (const a of abonosDe(c)) {
      if (!a.fecha) continue;
      const d = dias.get(a.fecha) || { fecha: a.fecha, pagos: 0, total: 0 };
      d.pagos++;
      d.total += Number(a.monto) || 0;
      dias.set(a.fecha, d);
    }
  }
  const resultado = [...dias.values()].sort((x, y) => y.fecha.localeCompare(x.fecha));
  // Asignar código HC a cada día (HC001, HC002, etc.)
  resultado.forEach((d, idx) => {
    d.codigo = 'HC' + String(idx + 1).padStart(3, '0');
  });
  return resultado;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function banner(msg) {
  const el = $('#banner');
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.hidden = true; }
}

/* ====== Configuración ======
   Los ajustes del negocio (días de crédito, moneda y atajos) viven en la
   nube: los pone el administrador y valen para todos los dispositivos y
   todos los usuarios. Además quedan copiados en este dispositivo, para
   que la app funcione igual sin internet.
   El aviso de vencimiento es de cada dispositivo, así que no se sube. */
const CLAVES_NEGOCIO = ['dias', 'moneda', 'atajo1', 'atajo2'];

function cargarSettings() {
  try {
    const guardado = JSON.parse(localStorage.getItem('creditos-settings'));
    if (guardado) settings = { ...settings, ...guardado };
  } catch (e) { /* usar valores por defecto */ }
}

/* Guarda en el dispositivo y, si eres administrador, también en la nube */
async function guardarSettings() {
  localStorage.setItem('creditos-settings', JSON.stringify(settings));
  if (modoNube && esAdmin()) {
    const datos = {};
    for (const k of CLAVES_NEGOCIO) datos[k] = settings[k];
    datos.actualizado = Date.now();
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'ajustes'), datos);
  }
}

/* Aplica los ajustes que llegan de la nube */
function aplicarAjustesNube(datos) {
  if (!datos) return;
  let cambio = false;
  for (const k of CLAVES_NEGOCIO) {
    if (datos[k] !== undefined && datos[k] !== settings[k]) { settings[k] = datos[k]; cambio = true; }
  }
  if (!cambio) return;
  localStorage.setItem('creditos-settings', JSON.stringify(settings));
  actualizarAtajosVenc();
  render();
}

/* ====== Almacenamiento: nube o local ====== */
function configNubeValida() {
  const cfg = window.FIREBASE_CONFIG;
  return EMULADOR || (cfg && cfg.apiKey && !String(cfg.apiKey).startsWith('PEGA'));
}

async function guardarEnStore(credito) {
  if (modoNube) {
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'creditos', credito.id), credito);
  } else {
    await DB.put(credito);
  }
}

async function eliminarDeStore(id) {
  if (modoNube) {
    await fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'creditos', id));
  } else {
    await DB.delete(id);
  }
}

async function guardarClienteEnStore(cliente) {
  if (modoNube) {
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'clientes', cliente.id), cliente);
  } else {
    await DB.putCliente(cliente);
  }
}

async function eliminarClienteDeStore(id) {
  if (modoNube) {
    await fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'clientes', id));
  } else {
    await DB.deleteCliente(id);
  }
}

/* ====== Firebase (modo nube) ====== */
async function iniciarNube() {
  /* SDK empaquetado dentro de la app: funciona sin CDN y sin internet al arrancar */
  const sdk = await import('./vendor/firebase.js');
  const appMod = sdk, authMod = sdk, fsMod = sdk;

  const cfg = EMULADOR
    ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-creditos' }
    : window.FIREBASE_CONFIG;

  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  /* Caché local persistente: la app funciona sin internet y sincroniza al volver la conexión */
  const db = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
  });

  if (EMULADOR) {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8081);
  }

  fb = {
    app, auth, db, cfg,
    initializeApp: appMod.initializeApp,
    deleteApp: appMod.deleteApp,
    collection: fsMod.collection,
    doc: fsMod.doc,
    getDoc: fsMod.getDoc,
    getDocs: fsMod.getDocs,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
    deleteDoc: fsMod.deleteDoc,
    onSnapshot: fsMod.onSnapshot,
    getAuth: authMod.getAuth,
    signIn: authMod.signInWithEmailAndPassword,
    registrar: authMod.createUserWithEmailAndPassword,
    updatePassword: authMod.updatePassword,
    salir: authMod.signOut,
    connectAuthEmulator: authMod.connectAuthEmulator,
    connectFirestoreEmulator: fsMod.connectFirestoreEmulator,
  };
  modoNube = true;

  authMod.onAuthStateChanged(auth, usuario => {
    if (usuario) sesionIniciada(usuario);
    else sesionCerrada();
  });
}

/* Al iniciar sesión: averigua el dueño (o lo crea la 1ª vez), lee la membresía
   del usuario y aplica sus permisos. Si no es miembro, deniega el acceso. */
async function sesionIniciada(usuario) {
  try {
    const cfgRef = fb.doc(fb.db, 'config', 'app');
    let cfgSnap = await fb.getDoc(cfgRef);

    if (!cfgSnap.exists()) {
      // Primer usuario que entra = dueño/administrador (bootstrap)
      await fb.setDoc(cfgRef, { ownerUid: usuario.uid, creado: Date.now() });
      await fb.setDoc(fb.doc(fb.db, 'usuarios', usuario.uid, 'miembros', usuario.uid), {
        usuario: usuario.email || 'administrador',
        nombre: 'Administrador',
        rol: 'admin',
        permisos: { ...PERMISOS_TODOS },
        creado: Date.now(),
      });
      cfgSnap = await fb.getDoc(cfgRef);
    }

    ownerUid = cfgSnap.data().ownerUid;
    const miDoc = await fb.getDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', usuario.uid));
    if (!miDoc.exists()) {
      // Autenticado pero sin permiso: no es miembro del negocio
      await fb.salir(fb.auth);
      $('#auth-error').textContent = 'Tu usuario no tiene acceso. Pídele al administrador que te dé de alta.';
      $('#auth-error').hidden = false;
      return;
    }
    yo = miDoc.data();
  } catch (e) {
    console.error('Error al iniciar sesión:', e);
    banner('⚠️ No se pudo verificar tu acceso. Revisa las reglas de Firestore o tu conexión.');
    return;
  }

  $('#auth-screen').hidden = true;
  $('#settings-cuenta').hidden = false;
  $('#cuenta-email').textContent = `${yo.usuario}${esAdmin() ? ' (administrador)' : ''}`;
  banner(null);
  aplicarPermisos();
  cargarSeguridad();        // copia local mientras llega la de la nube
  suscribirConfigNube();
  suscribirNube();
}

function sesionCerrada() {
  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
  if (unsubClientes) { unsubClientes(); unsubClientes = null; }
  if (unsubAjustes) { unsubAjustes(); unsubAjustes = null; }
  if (unsubSeguridad) { unsubSeguridad(); unsubSeguridad = null; }
  creditos = [];
  clientes = [];
  ownerUid = null;
  yo = null;
  migracionRevisada = false;
  render();
  $('#settings-cuenta').hidden = true;
  $('#btn-logout-header').hidden = true;
  $('#auth-screen').hidden = false;
}

async function cerrarSesion() {
  if (confirm('¿Cerrar sesión?')) {
    $('#modal-settings').close();
    await fb.salir(fb.auth);
  }
}

function suscribirNube() {
  if (unsubSnapshot) unsubSnapshot();
  const coleccion = fb.collection(fb.db, 'usuarios', ownerUid, 'creditos');
  unsubSnapshot = fb.onSnapshot(coleccion, snap => {
    creditos = snap.docs.map(d => d.data());
    render();
    avisoAlAbrir();
    if (esAdmin()) ofrecerMigracionLocal(ownerUid);
  }, err => {
    console.error('Error de sincronización:', err);
    banner('⚠️ Error de sincronización con la nube. Revisa tu conexión o las reglas de Firestore.');
  });

  if (unsubClientes) unsubClientes();
  unsubClientes = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'clientes'), snap => {
    clientes = snap.docs.map(d => d.data());
    ordenarClientes();
    renderClientes();
    llenarSelectClientes($('#f-cliente').value);
  }, err => {
    console.error('Error al sincronizar clientes:', err);
  });
}

/* Muestra/oculta botones según los permisos del usuario actual */
function aplicarPermisos() {
  $('#btn-new').hidden = !puede('crear');
  $('#btn-cobranza').hidden = !puede('cobranza');
  $('#btn-usuarios').hidden = !esAdmin();
  $('#btn-cliente-nuevo').hidden = !puede('clientes');
  $('#btn-logout-header').hidden = false;
  render(); // redibuja la tabla para aplicar permisos de editar/borrar
}

/* Si el dispositivo tenía créditos guardados en modo local, ofrece subirlos a la cuenta */
async function ofrecerMigracionLocal(uid) {
  if (migracionRevisada) return;
  migracionRevisada = true;
  const marca = `creditos-migrado-${uid}`;
  if (localStorage.getItem(marca)) return;
  try {
    const locales = await DB.getAll();
    if (locales.length && creditos.length === 0) {
      if (confirm(`Este dispositivo tiene ${locales.length} crédito(s) guardados en modo local.\n¿Subirlos a tu cuenta en la nube para verlos en todos tus dispositivos?`)) {
        for (const c of locales) {
          await fb.setDoc(fb.doc(fb.db, 'usuarios', uid, 'creditos', c.id), c);
        }
        toast(`☁️ ${locales.length} crédito(s) subidos a la nube`);
      }
    }
    localStorage.setItem(marca, '1');
  } catch (e) { /* sin datos locales */ }
}

/* ====== Autenticación (usuario + contraseña) ====== */
const ERRORES_AUTH = {
  'auth/invalid-email': 'El usuario no es válido.',
  'auth/user-not-found': 'Usuario o contraseña incorrectos.',
  'auth/wrong-password': 'Usuario o contraseña incorrectos.',
  'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/network-request-failed': 'Sin conexión a internet. Inténtalo de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/email-already-in-use': 'Ese usuario ya existe.',
};

function errorAuth(e) {
  const el = $('#auth-error');
  el.textContent = ERRORES_AUTH[e.code] || `Error: ${e.message}`;
  el.hidden = false;
}

async function enviarAuth(ev) {
  ev.preventDefault();
  $('#auth-error').hidden = true;
  const email = usuarioAEmail($('#a-email').value);
  const pass = $('#a-pass').value;
  const boton = $('#btn-auth-principal');
  boton.disabled = true;
  try {
    await fb.signIn(fb.auth, email, pass);
    $('#a-pass').value = '';
  } catch (e) {
    errorAuth(e);
  } finally {
    boton.disabled = false;
  }
}

/* ====== Administración de usuarios (solo admin) ====== */
const PERMISOS_LISTA = [
  ['crear', 'Crear créditos'],
  ['editar', 'Editar créditos'],
  ['pagos', 'Registrar pagos'],
  ['borrar', 'Borrar créditos'],
  ['cobranza', 'Ver/exportar cobranza'],
  ['clientes', 'Registrar/editar clientes'],
];

async function abrirUsuarios() {
  if (!esAdmin()) return;
  await renderUsuarios();
  $('#u-form-nuevo').reset();
  $('#modal-usuarios').showModal();
}

async function renderUsuarios() {
  const cont = $('#usuarios-list');
  cont.innerHTML = '<p class="abonos-vacio">Cargando…</p>';
  let docs = [];
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'usuarios', ownerUid, 'miembros'));
    docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (e) {
    cont.innerHTML = '<p class="abonos-vacio">No se pudo cargar la lista.</p>';
    return;
  }
  docs.sort((a, b) => (a.rol === 'admin' ? -1 : 1) - (b.rol === 'admin' ? -1 : 1));
  cont.innerHTML = docs.map(m => {
    const esDueno = m.uid === ownerUid;
    const permisosHtml = esDueno ? '<em>Todos los permisos</em>' : PERMISOS_LISTA.map(([k, etiqueta]) => `
      <label class="u-perm"><input type="checkbox" data-perm="${k}" data-uid="${m.uid}" ${m.permisos && m.permisos[k] ? 'checked' : ''}> ${etiqueta}</label>`).join('');
    return `
      <div class="usuario-item">
        <div class="usuario-cab">
          <strong>${escapeHtml(m.usuario || '(sin nombre)')}</strong>
          <span class="usuario-rol">${m.rol === 'admin' ? '👑 Administrador' : '👤 Empleado'}</span>
          ${esDueno ? '' : `<button type="button" class="btn btn-danger btn-small" data-borrar-usuario="${m.uid}">Quitar</button>`}
        </div>
        <div class="usuario-perms">${permisosHtml}</div>
      </div>`;
  }).join('');
}

function crearUsuarioAuthSecundaria(email, pass) {
  // Crea el usuario en una app Firebase aparte para NO cerrar la sesión del admin
  const seg = fb.initializeApp(fb.cfg, 'secundaria-' + Date.now());
  const segAuth = fb.getAuth(seg);
  if (EMULADOR) fb.connectAuthEmulator(segAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return fb.registrar(segAuth, email, pass)
    .then(cred => fb.salir(segAuth).then(() => cred.user.uid))
    .finally(() => fb.deleteApp(seg));
}

async function crearUsuario(ev) {
  ev.preventDefault();
  if (!esAdmin()) return;
  const usuario = $('#u-usuario').value.trim().toLowerCase();
  const nombre = $('#u-nombre').value.trim();
  const pass = $('#u-pass').value;
  const rolAdmin = $('#u-admin').checked;
  if (!usuario || pass.length < 6) { toast('⚠️ Usuario y contraseña (mín. 6) son obligatorios'); return; }
  if (usuario.includes('@') || /\s/.test(usuario)) { toast('⚠️ El usuario no debe tener espacios ni @'); return; }

  const permisos = {};
  for (const [k] of PERMISOS_LISTA) permisos[k] = rolAdmin || $(`#u-perm-${k}`).checked;

  const boton = $('#btn-u-crear');
  boton.disabled = true;
  try {
    const uid = await crearUsuarioAuthSecundaria(usuarioAEmail(usuario), pass);
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', uid), {
      usuario, nombre: nombre || usuario, rol: rolAdmin ? 'admin' : 'empleado', permisos, creado: Date.now(),
    });
    toast(`✅ Usuario "${usuario}" creado`);
    $('#u-form-nuevo').reset();
    await renderUsuarios();
  } catch (e) {
    console.error(e);
    toast(e.code === 'auth/email-already-in-use' ? '⚠️ Ese usuario ya existe' : '❌ No se pudo crear el usuario');
  } finally {
    boton.disabled = false;
  }
}

async function cambiarPermiso(uid, perm, valor) {
  try {
    await fb.updateDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', uid), { [`permisos.${perm}`]: valor });
    toast('✅ Permiso actualizado');
  } catch (e) {
    toast('❌ No se pudo actualizar el permiso');
    renderUsuarios();
  }
}

async function borrarUsuario(uid) {
  if (uid === ownerUid) return;
  if (!confirm('¿Quitarle el acceso a este usuario? No podrá volver a entrar.')) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', uid));
    toast('🚪 Acceso retirado');
    await renderUsuarios();
  } catch (e) {
    toast('❌ No se pudo quitar el acceso');
  }
}

async function cambiarMiContrasena() {
  const nueva = prompt('Escribe tu nueva contraseña (mínimo 6 caracteres):');
  if (nueva === null) return;
  if (nueva.length < 6) { toast('⚠️ Debe tener al menos 6 caracteres'); return; }
  try {
    await fb.updatePassword(fb.auth.currentUser, nueva);
    toast('✅ Contraseña cambiada');
  } catch (e) {
    if (e.code === 'auth/requires-recent-login') {
      toast('Por seguridad, cierra sesión y vuelve a entrar para cambiarla.');
    } else {
      toast('❌ No se pudo cambiar la contraseña');
    }
  }
}

/* ====== Filtrado y orden ====== */
function marcados(clase) {
  return [...document.querySelectorAll('.' + clase + ':checked')].map(el => el.value);
}

function creditosVisibles() {
  const busqueda = $('#search').value.trim().toLowerCase();
  const estados = marcados('fil-estado');
  const zonas = marcados('fil-zona');
  const meses = marcados('fil-mes').map(Number);
  const desde = $('#fil-desde').value;
  const hasta = $('#fil-hasta').value;
  const [campo, dir] = $('#sort-by').value.split('-');

  let lista = creditos.filter(c => {
    if (busqueda && !c.cliente.toLowerCase().includes(busqueda) && !String(c.boleta).toLowerCase().includes(busqueda)) return false;
    if (estados.length && !estados.includes(estadoEfectivo(c))) return false;
    if (zonas.length && !zonas.includes(c.zona || '')) return false;
    if (meses.length) {
      const mes = c.fecha ? Number(c.fecha.split('-')[1]) : 0;
      if (!meses.includes(mes)) return false;
    }
    if (desde && (!c.fecha || c.fecha < desde)) return false;
    if (hasta && (!c.fecha || c.fecha > hasta)) return false;
    return true;
  });

  const mult = dir === 'desc' ? -1 : 1;
  lista.sort((a, b) => {
    let va, vb;
    switch (campo) {
      case 'boleta':
        // Ordena numéricamente si ambas boletas son números
        va = a.boleta; vb = b.boleta;
        if (!isNaN(va) && !isNaN(vb)) { va = Number(va); vb = Number(vb); }
        break;
      case 'cliente': va = a.cliente.toLowerCase(); vb = b.cliente.toLowerCase(); break;
      case 'zona': va = (a.zona || '').toLowerCase(); vb = (b.zona || '').toLowerCase(); break;
      case 'monto': va = Number(a.monto); vb = Number(b.monto); break;
      case 'saldo': va = saldoDe(a); vb = saldoDe(b); break;
      case 'fecha': va = a.fecha; vb = b.fecha; break;
      case 'vencimiento': default: va = a.vencimiento; vb = b.vencimiento; break;
    }
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  });

  return lista;
}

/* Cuenta cuántos filtros hay activos y lo muestra en la burbuja del botón "Filtrar". */
function actualizarContadorFiltro() {
  const n = marcados('fil-estado').length + marcados('fil-zona').length + marcados('fil-mes').length
    + ($('#fil-desde').value ? 1 : 0) + ($('#fil-hasta').value ? 1 : 0);
  const bur = $('#filtro-contador');
  bur.textContent = String(n);
  bur.hidden = n === 0;
}

/* ====== Render ====== */
function render() {
  const lista = creditosVisibles();
  renderResumen();
  renderResumenFiltro(lista);
  renderTabla(lista);
  renderTarjetas(lista);
  renderFlechas();
  actualizarContadorFiltro();
  if ($('#modal-info').open) renderInfo();   // la ficha se mantiene al día
  $('#empty-state').hidden = creditos.length > 0;
  sincronizarAvisos();
}

/* Total que deben y cantidad de créditos según lo que está filtrado ahora mismo */
function renderResumenFiltro(lista) {
  let debe = 0;
  for (const c of lista) debe += saldoDe(c);
  $('#filtro-resumen-cantidad').textContent = String(lista.length);
  $('#filtro-resumen-debe').textContent = formatoMonto(debe);
}

/* Programa/actualiza los avisos de vencimiento (Android). Sin efecto en web/iPhone. */
function sincronizarAvisos() {
  if (global_Avisos()) {
    window.Avisos.programar(creditos, { activado: settings.avisos, moneda: settings.moneda });
  }
}
function global_Avisos() {
  return typeof window !== 'undefined' && window.Avisos;
}

/* "Aviso al abrir la app": muestra una vez cuántos créditos vencen hoy o están vencidos. */
let avisoInicialMostrado = false;
function avisoAlAbrir() {
  if (avisoInicialMostrado) return;
  avisoInicialMostrado = true;
  const hoy = hoyISO();
  let venceHoy = 0, vencidos = 0;
  for (const c of creditos) {
    if (c.estado === 'pagado') continue;
    if (c.vencimiento === hoy) venceHoy++;
    else if (diasHastaVencimiento(c.vencimiento) < 0) vencidos++;
  }
  if (venceHoy + vencidos === 0) return;
  const partes = [];
  if (venceHoy) partes.push(`${venceHoy} vence${venceHoy === 1 ? '' : 'n'} hoy`);
  if (vencidos) partes.push(`${vencidos} vencido${vencidos === 1 ? '' : 's'}`);
  setTimeout(() => toast(`🔔 ${partes.join(' y ')}`), 600);
}

function renderResumen() {
  let porCobrar = 0, vencidos = 0, cobrado = 0, activos = 0;
  for (const c of creditos) {
    const e = estadoEfectivo(c);
    const saldo = saldoDe(c);
    // Dinero cobrado: abonos registrados (+ monto completo de créditos antiguos ya pagados sin abonos)
    if (abonosDe(c).length) cobrado += totalAbonado(c);
    else if (e === 'pagado') cobrado += Number(c.monto) || 0;

    if (e !== 'pagado') {
      porCobrar += saldo;   // lo que falta cobrar
      activos++;
      if (e === 'vencido') vencidos++;
    }
  }
  $('#sum-pendiente').textContent = formatoMonto(porCobrar);
  $('#sum-vencidos').textContent = String(vencidos);
  $('#sum-pagado').textContent = formatoMonto(cobrado);
  $('#sum-activos').textContent = String(activos);
}

function celdaFoto(c) {
  return c.foto
    ? `<img src="${c.foto}" class="thumb" alt="Boleta ${c.boleta}" data-ver-foto="${c.id}">`
    : `<span class="no-photo">Sin foto</span>`;
}

function renderTabla(lista) {
  const tbody = $('#table-body');
  tbody.innerHTML = lista.map(c => {
    const saldo = saldoDe(c);
    return `
    <tr>
      <td><strong>${escapeHtml(c.boleta)}</strong></td>
      <td>${escapeHtml(c.cliente)}</td>
      <td>${c.zona ? escapeHtml(c.zona) : '—'}</td>
      <td class="col-num">${formatoMonto(c.monto)}</td>
      <td class="col-num ${saldo > 0 ? 'saldo-pend' : 'saldo-ok'}">${saldo > 0 ? formatoMonto(saldo) : '✓'}</td>
      <td>${textoVencimiento(c)}</td>
      <td>${badgeEstado(c)}</td>
      <td>${celdaFoto(c)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-info="${c.id}" title="Ver información">ℹ️</button>
          ${puede('editar') ? `<button class="btn btn-secondary btn-small" data-editar="${c.id}" title="Editar">✏️</button>` : ''}
          ${puede('borrar') ? `<button class="btn btn-danger btn-small" data-borrar="${c.id}" title="Borrar">🗑️</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* Lista de pagos "a cuenta" con su monto y su fecha, para ver el detalle
   sin tener que abrir el crédito */
function abonosResumenHtml(c) {
  const lista = abonosDe(c);
  if (!lista.length) return '';
  const chips = lista.map((a, i) => {
    const quien = a.registradoPor
      ? ` — registrado por ${a.registradoPor} el ${formatoFecha(a.registradoFecha)}`
      : '';
    const ojo = abonoConFechaCambiada(a) ? '<span class="chip-ojo" >⚠️</span>' : '';
    return `
    <span class="abono-chip" title="${escapeHtml(metodoLabel(metodoDe(a)) + quien)}">
      <b>A${i + 1}</b>
      <span class="chip-monto">${formatoMonto(a.monto)}</span>
      <span class="chip-fecha">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'}</span>${ojo}
    </span>`;
  }).join('');
  return `<div class="card-abonos"><span class="card-abonos-tit">A cuenta:</span>${chips}</div>`;
}

function renderTarjetas(lista) {
  const cont = $('#cards');
  cont.innerHTML = lista.map(c => {
    const debe = saldoDe(c);
    const pagado = totalAbonado(c);
    const lineas = debe > 0
      ? `<p class="card-saldo">Debe: <strong>${formatoMonto(debe)}</strong></p>
         ${pagado > 0 ? `<p class="card-pagado">Pagado: <strong>${formatoMonto(pagado)}</strong></p>` : ''}`
      : `<p class="card-saldo card-saldo-ok">✅ Pagado completo${pagado > 0 ? ` · ${formatoMonto(pagado)}` : ''}</p>`;
    return `
    <article class="card">
      <div class="card-main">
        <p class="card-title">${escapeHtml(c.cliente)}</p>
        <p class="card-sub">Boleta Nº ${escapeHtml(c.boleta)} · ${formatoFecha(c.fecha)}</p>
        ${c.zona ? `<span class="card-zona">📍 ${escapeHtml(c.zona)}</span>` : ''}
        <p class="card-monto">${formatoMonto(c.monto)}</p>
        ${lineas}
        ${abonosResumenHtml(c)}
        <p class="card-venc">Vence: ${textoVencimiento(c)}</p>
      </div>
      <div class="card-side">
        ${badgeEstado(c)}
        ${c.foto ? `<img src="${c.foto}" class="thumb" alt="Boleta ${c.boleta}" data-ver-foto="${c.id}">` : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-small" data-info="${c.id}">ℹ️ Información</button>
        ${puede('editar') ? `<button class="btn btn-secondary btn-small" data-editar="${c.id}">✏️ Editar</button>` : ''}
        ${puede('borrar') ? `<button class="btn btn-danger btn-small" data-borrar="${c.id}">🗑️ Borrar</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderFlechas() {
  const [campo, dir] = $('#sort-by').value.split('-');
  document.querySelectorAll('.credit-table th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    arrow.textContent = th.dataset.sort === campo ? (dir === 'asc' ? '▲' : '▼') : '';
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ====== Firma digital del cliente ======
   Pensado para una tablet con lápiz táctil, pero funciona igual con el
   dedo o con el mouse. */
let firmaCtx = null;
let firmaDibujando = false;
let firmaHayTrazo = false;

function prepararCanvasFirma() {
  const canvas = $('#firma-canvas');
  const ancho = Math.max(260, Math.floor(canvas.parentElement.clientWidth) - 2);
  const alto = 200;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(alto * dpr);
  canvas.style.width = ancho + 'px';
  canvas.style.height = alto + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.strokeStyle = '#1f2024';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  firmaCtx = ctx;
  firmaHayTrazo = false;
}

function puntoFirma(ev) {
  const r = $('#firma-canvas').getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

/* Exporta la firma a un tamaño fijo, para que ocupe poco en la base */
function firmaComoImagen() {
  const origen = $('#firma-canvas');
  const salida = document.createElement('canvas');
  salida.width = 600;
  salida.height = 200;
  const ctx = salida.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, salida.width, salida.height);
  ctx.drawImage(origen, 0, 0, salida.width, salida.height);
  return salida.toDataURL('image/png');
}

/* Abre el recuadro de firma. Devuelve la imagen, o null si se cancela. */
function abrirFirma() {
  const dlg = $('#modal-firma');
  dlg.showModal();
  prepararCanvasFirma();
  return new Promise(resolve => {
    const terminar = valor => {
      $('#btn-firma-ok').removeEventListener('click', aceptar);
      $('#btn-firma-cancelar').removeEventListener('click', cancelar);
      $('#btn-firma-borrar').removeEventListener('click', borrar);
      dlg.removeEventListener('cancel', cancelar);
      dlg.close();
      resolve(valor);
    };
    const aceptar = () => {
      if (!firmaHayTrazo) { toast('✍️ El recuadro está vacío: pida la firma'); return; }
      terminar(firmaComoImagen());
    };
    const cancelar = ev => { if (ev) ev.preventDefault(); terminar(null); };
    const borrar = () => prepararCanvasFirma();
    $('#btn-firma-ok').addEventListener('click', aceptar);
    $('#btn-firma-cancelar').addEventListener('click', cancelar);
    $('#btn-firma-borrar').addEventListener('click', borrar);
    dlg.addEventListener('cancel', cancelar);
  });
}

/* ====== Código de seguridad (4 dígitos) ======
   Se pide para borrar un crédito o una "a cuenta". El código NO se guarda
   tal cual: se guarda su huella (SHA-256 con sal), así nadie puede leerlo
   mirando la base de datos. */
let seguridad = { pinHash: '', sal: '' };

function pinConfigurado() { return !!(seguridad && seguridad.pinHash); }

async function huellaPin(pin, sal) {
  const texto = `${sal}:${pin}`;
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Reserva por si el navegador no tiene crypto.subtle (navegadores muy viejos)
  let h = 0;
  for (let i = 0; i < texto.length; i++) { h = ((h << 5) - h + texto.charCodeAt(i)) | 0; }
  return 'simple' + (h >>> 0).toString(16);
}

/* Lee la copia guardada en este dispositivo. En modo nube, la suscripción
   la reemplaza enseguida por la de la nube; si la nube no responde, esta
   copia evita quedarse sin código. */
function cargarSeguridad() {
  try { seguridad = JSON.parse(localStorage.getItem('creditos-seguridad')) || { pinHash: '', sal: '' }; }
  catch (e) { seguridad = { pinHash: '', sal: '' }; }
  actualizarEstadoPin();
}

async function guardarSeguridad() {
  // Primero la copia local: así el código nunca se pierde en este dispositivo
  localStorage.setItem('creditos-seguridad', JSON.stringify(seguridad));
  if (modoNube) {
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'seguridad'), seguridad);
  }
}

/* Escucha la configuración de la nube (ajustes y código) en tiempo real */
function suscribirConfigNube() {
  if (unsubAjustes) unsubAjustes();
  unsubAjustes = fb.onSnapshot(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'ajustes'), snap => {
    if (snap.exists()) aplicarAjustesNube(snap.data());
    else if (esAdmin()) guardarSettings().catch(() => {});   // primera vez: sube los de este equipo
  }, err => {
    console.error('No se pudo leer la configuración:', err);
    avisarConfigSinNube();
  });

  if (unsubSeguridad) unsubSeguridad();
  unsubSeguridad = fb.onSnapshot(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'seguridad'), snap => {
    seguridad = snap.exists() ? snap.data() : { pinHash: '', sal: '' };
    localStorage.setItem('creditos-seguridad', JSON.stringify(seguridad));
    actualizarEstadoPin();
  }, err => {
    console.error('No se pudo leer el código de seguridad:', err);
    cargarSeguridad();          // se usa la copia de este dispositivo
    avisarConfigSinNube();
  });
}

/* Aviso claro cuando faltan las reglas de Firestore por publicar */
function avisarConfigSinNube() {
  banner('⚠️ La configuración y el código de seguridad no se están guardando en la nube. ' +
         'Publica las reglas de Firestore (archivo firestore.rules del repositorio) en Firebase → Firestore → Reglas.');
}

/* Pide el código y devuelve true solo si es correcto.
   Si todavía no hay código configurado, deja pasar. */
function pedirPin(motivo) {
  if (!pinConfigurado()) return Promise.resolve(true);
  const dlg = $('#modal-pin');
  const caja = $('#pin-input');
  const error = $('#pin-error');
  $('#pin-motivo').textContent = motivo;
  caja.value = '';
  error.hidden = true;
  dlg.showModal();
  setTimeout(() => caja.focus(), 50);

  return new Promise(resolve => {
    let intentos = 0;
    const terminar = ok => {
      $('#btn-pin-ok').removeEventListener('click', comprobar);
      $('#btn-pin-cancelar').removeEventListener('click', cancelar);
      caja.removeEventListener('keydown', porTecla);
      dlg.removeEventListener('cancel', cancelar);
      dlg.close();
      resolve(ok);
    };
    const cancelar = ev => { if (ev) ev.preventDefault(); terminar(false); };
    const comprobar = async () => {
      const pin = caja.value.trim();
      if (!/^\d{4}$/.test(pin)) { error.textContent = 'Escribe los 4 dígitos.'; error.hidden = false; return; }
      const huella = await huellaPin(pin, seguridad.sal || '');
      if (huella === seguridad.pinHash) { terminar(true); return; }
      intentos++;
      caja.value = '';
      error.textContent = intentos >= 3
        ? 'Código incorrecto. Si no lo recuerdas, cámbialo desde ⚙️ Configuración (solo el administrador).'
        : 'Código incorrecto.';
      error.hidden = false;
      caja.focus();
    };
    const porTecla = ev => { if (ev.key === 'Enter') { ev.preventDefault(); comprobar(); } };
    $('#btn-pin-ok').addEventListener('click', comprobar);
    $('#btn-pin-cancelar').addEventListener('click', cancelar);
    caja.addEventListener('keydown', porTecla);
    dlg.addEventListener('cancel', cancelar);
  });
}

function actualizarEstadoPin() {
  const caja = $('#settings-seguridad');
  if (!caja) return;
  // Solo el dueño/administrador puede poner o cambiar el código
  caja.hidden = modoNube && !esAdmin();
  const puesto = pinConfigurado();
  $('#pin-estado').textContent = puesto
    ? '✅ Código activo: se pedirá al borrar.'
    : '⚠️ Sin código: por ahora se puede borrar sin pedirlo.';
  $('#pin-estado').classList.toggle('pin-activo', puesto);
  $('#s-pin-actual').hidden = !puesto;
  $('#btn-pin-quitar').hidden = !puesto;
  $('#s-pin-actual').value = '';
  $('#s-pin-nuevo').value = '';
}

async function guardarPin() {
  const nuevo = $('#s-pin-nuevo').value.trim();
  if (!/^\d{4}$/.test(nuevo)) { toast('⚠️ El código debe tener 4 dígitos'); return; }
  if (pinConfigurado()) {
    const actual = $('#s-pin-actual').value.trim();
    const huella = await huellaPin(actual, seguridad.sal || '');
    if (huella !== seguridad.pinHash) { toast('⚠️ El código actual no es correcto'); return; }
  }
  const sal = Math.random().toString(36).slice(2) + Date.now().toString(36);
  seguridad = { pinHash: await huellaPin(nuevo, sal), sal, actualizado: Date.now() };
  try {
    await guardarSeguridad();
    toast('🔒 Código de seguridad guardado');
  } catch (e) {
    // El código ya quedó guardado en este dispositivo; solo falló la nube
    console.error(e);
    avisarConfigSinNube();
    toast('⚠️ Código guardado solo en este dispositivo');
  }
  actualizarEstadoPin();
}

async function quitarPin() {
  const actual = $('#s-pin-actual').value.trim();
  const huella = await huellaPin(actual, seguridad.sal || '');
  if (huella !== seguridad.pinHash) { toast('⚠️ Escribe el código actual para quitarlo'); return; }
  if (!confirm('¿Quitar el código? Se podrá borrar sin pedirlo.')) return;
  seguridad = { pinHash: '', sal: '' };
  try { await guardarSeguridad(); } catch (e) { console.error(e); avisarConfigSinNube(); }
  actualizarEstadoPin();
  toast('🔓 Código quitado');
}

/* ====== Base de datos de clientes ======
   Cada cliente se registra UNA sola vez con su zona. Al crear un crédito se
   elige de la lista, así el mismo cliente siempre queda escrito igual y su
   zona se pone sola. */

/* Compara nombres ignorando mayúsculas, tildes y espacios de más */
function normalizarNombre(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function ordenarClientes() {
  clientes.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

function clientePorId(id) { return clientes.find(c => c.id === id) || null; }

/* Código de cliente: se genera solo (C001, C002…) pero se puede escribir a mano */
function siguienteCodigoCliente() {
  let mayor = 0;
  for (const c of clientes) {
    const m = /^C(\d+)$/i.exec(String(c.codigo || '').trim());
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }
  return 'C' + String(mayor + 1).padStart(3, '0');
}

function codigoRepetido(codigo, exceptoId) {
  const clave = String(codigo).trim().toUpperCase();
  return clientes.find(c => String(c.codigo || '').trim().toUpperCase() === clave && c.id !== exceptoId) || null;
}

/* Devuelve el código del cliente de un crédito (por id o, si es antiguo, por nombre) */
function codigoDeCredito(c) {
  const cli = (c.clienteId && clientePorId(c.clienteId)) || clientePorNombre(c.cliente);
  return cli && cli.codigo ? cli.codigo : '';
}

/* Pone código a los clientes registrados antes de que existiera esta función */
async function generarCodigosFaltantes() {
  if (!puede('clientes')) return;
  const sinCodigo = clientes.filter(c => !String(c.codigo || '').trim());
  if (!sinCodigo.length) { toast('👌 Todos tus clientes ya tienen código'); return; }
  if (!confirm(`Se le pondrá un código automático a ${sinCodigo.length} cliente(s). ¿Continuar?`)) return;

  const boton = $('#btn-cli-codigos');
  boton.disabled = true;
  let hechos = 0;
  try {
    for (const cli of sinCodigo) {
      const actualizado = { ...cli, codigo: siguienteCodigoCliente() };
      await guardarClienteEnStore(actualizado);
      const i = clientes.findIndex(x => x.id === cli.id);
      if (i >= 0) clientes[i] = actualizado;
      hechos++;
    }
  } catch (e) {
    console.error(e);
    toast('❌ Se interrumpió. Revisa tu conexión.');
  }
  boton.disabled = false;
  renderClientes();
  llenarSelectClientes($('#f-cliente').value);
  toast(`✅ ${hechos} cliente(s) con código nuevo`);
}

function clientePorNombre(nombre) {
  const clave = normalizarNombre(nombre);
  return clientes.find(c => normalizarNombre(c.nombre) === clave) || null;
}

function creditosDeCliente(id) { return creditos.filter(c => c.clienteId === id); }

/* ---- Buscador de clientes del formulario de créditos ----
   Se escribe el nombre y va sugiriendo los clientes que coinciden.
   El id del cliente elegido queda guardado en el campo oculto #f-cliente. */
let comboIndice = -1;   // sugerencia resaltada con las flechas del teclado

function textoCliente(valor) {
  if (!valor) return '';
  if (String(valor).startsWith('libre:')) return String(valor).slice(6);
  const c = clientePorId(valor);
  return c ? c.nombre : '';
}

/* Pone (o limpia) el cliente elegido en el formulario */
function llenarSelectClientes(valorSeleccionado = '') {
  const oculto = $('#f-cliente');
  const caja = $('#f-cliente-buscar');
  if (!oculto || !caja) return;
  let valor = valorSeleccionado || '';
  // Si el cliente elegido ya no existe (lo borraron), se limpia
  if (valor && !String(valor).startsWith('libre:') && !clientePorId(valor)) valor = '';
  oculto.value = valor;
  caja.value = textoCliente(valor);
  caja.placeholder = clientes.length
    ? 'Escribe el nombre del cliente…'
    : 'Aún no hay clientes: toca “➕ Nuevo”';
  cerrarSugerencias();
}

/* Busca por nombre (y también por zona o dirección). Los que empiezan
   con lo escrito salen primero. Ignora mayúsculas y tildes. */
function clientesQueCoinciden(texto) {
  const q = normalizarNombre(texto);
  if (!q) return clientes.slice(0, 60);
  const empiezan = [], contienen = [];
  for (const c of clientes) {
    const nombre = normalizarNombre(c.nombre);
    if (nombre.startsWith(q)) empiezan.push(c);
    else if (nombre.includes(q)
      || normalizarNombre(c.codigo).includes(q)
      || normalizarNombre(c.zona).includes(q)
      || normalizarNombre(c.direccion).includes(q)) contienen.push(c);
  }
  return empiezan.concat(contienen).slice(0, 60);
}

/* Marca en negrita la parte del nombre que coincide con lo escrito */
function resaltarCoincidencia(nombre, texto) {
  const q = String(texto || '').trim();
  if (!q) return escapeHtml(nombre);
  const i = nombre.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(nombre);
  return escapeHtml(nombre.slice(0, i))
    + `<mark>${escapeHtml(nombre.slice(i, i + q.length))}</mark>`
    + escapeHtml(nombre.slice(i + q.length));
}

function renderSugerencias(texto) {
  const lista = $('#cliente-sugerencias');
  if (!lista) return;
  const encontrados = clientesQueCoinciden(texto);
  comboIndice = -1;

  if (!clientes.length) {
    lista.innerHTML = '<li class="combo-vacio">Aún no tienes clientes registrados. Toca “➕ Nuevo”.</li>';
  } else if (!encontrados.length) {
    lista.innerHTML = `<li class="combo-vacio">Ningún cliente coincide con “${escapeHtml(texto)}”.</li>`;
  } else {
    lista.innerHTML = encontrados.map(c => `
      <li class="combo-op" role="option" data-id="${escapeHtml(c.id)}">
        <span class="combo-nombre">${c.codigo ? `<b class="combo-codigo">${escapeHtml(c.codigo)}</b> ` : ''}${resaltarCoincidencia(c.nombre, texto)}</span>
        ${c.zona ? `<span class="combo-zona">${escapeHtml(c.zona)}</span>` : ''}
      </li>`).join('');
  }
  lista.hidden = false;
  $('#f-cliente-buscar').setAttribute('aria-expanded', 'true');
}

function cerrarSugerencias() {
  const lista = $('#cliente-sugerencias');
  if (!lista) return;
  lista.hidden = true;
  comboIndice = -1;
  const caja = $('#f-cliente-buscar');
  if (caja) caja.setAttribute('aria-expanded', 'false');
}

function seleccionarCliente(id) {
  $('#f-cliente').value = id;
  $('#f-cliente-buscar').value = textoCliente(id);
  cerrarSugerencias();
  aplicarClienteSeleccionado();
}

/* Al elegir un cliente: pone su zona automáticamente y la bloquea */
function aplicarClienteSeleccionado() {
  const valor = $('#f-cliente').value;
  const zonaSel = $('#f-zona');
  const nota = $('#f-zona-nota');
  const ayuda = $('#f-cliente-ayuda');
  const cli = valor.startsWith('libre:') ? null : clientePorId(valor);

  if (cli) {
    zonaSel.value = cli.zona || '';
    zonaSel.disabled = true;
    nota.textContent = '(automática, según el cliente)';
    ayuda.textContent = [
      cli.direccion ? `🏠 ${cli.direccion}` : '',
      cli.telefono ? `📞 ${cli.telefono}` : '',
      cli.notas || '',
    ].filter(Boolean).join(' · ');
  } else {
    zonaSel.disabled = false;
    nota.textContent = '';
    ayuda.textContent = valor.startsWith('libre:')
      ? 'Este cliente aún no está registrado. Regístralo para que su zona se ponga sola.'
      : '';
  }
}

function abrirClientes() {
  limpiarFormCliente();
  $('#cli-buscar').value = '';
  const permitido = puede('clientes');
  $('#cli-form').hidden = !permitido;
  $('#btn-cli-importar').hidden = !permitido;
  $('#btn-cli-codigos').hidden = !permitido || !clientes.some(c => !String(c.codigo || '').trim());
  renderClientes();
  $('#modal-clientes').showModal();
}

function limpiarFormCliente() {
  $('#cli-form').reset();
  $('#cli-id').value = '';
  $('#cli-codigo').value = siguienteCodigoCliente();
  $('#cli-form-title').textContent = 'Registrar cliente';
  $('#btn-cli-guardar').textContent = '💾 Guardar cliente';
  $('#btn-cli-cancelar').hidden = true;
}

function renderClientes() {
  const cont = $('#clientes-list');
  if (!cont) return;
  const buscado = normalizarNombre($('#cli-buscar') ? $('#cli-buscar').value : '');
  const lista = buscado
    ? clientes.filter(c => normalizarNombre(c.nombre).includes(buscado)
        || normalizarNombre(c.codigo).includes(buscado)
        || normalizarNombre(c.zona).includes(buscado)
        || normalizarNombre(c.direccion).includes(buscado))
    : clientes;

  $('#cli-contador').textContent = clientes.length ? `(${clientes.length})` : '';

  if (!clientes.length) {
    cont.innerHTML = `<p class="abonos-vacio">Todavía no tienes clientes registrados.
      Regístralos arriba, o usa “📥 Importar desde mis créditos” para crearlos automáticamente.</p>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = '<p class="abonos-vacio">Ningún cliente coincide con la búsqueda.</p>';
    return;
  }

  const permitido = puede('clientes');
  cont.innerHTML = lista.map(c => {
    const nPedidos = creditosDeCliente(c.id).length;
    const extra = [
      c.direccion ? `🏠 ${escapeHtml(c.direccion)}` : '',
      c.telefono ? `📞 ${escapeHtml(c.telefono)}` : '',
      c.notas ? escapeHtml(c.notas) : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="cliente-item">
        <div class="cliente-datos">
          ${c.codigo ? `<span class="cliente-codigo">${escapeHtml(c.codigo)}</span>` : ''}
          <strong>${escapeHtml(c.nombre)}</strong>
          <span class="cliente-zona">${c.zona ? escapeHtml(c.zona) : 'sin zona'}</span>
          <span class="cliente-meta">${nPedidos} crédito${nPedidos === 1 ? '' : 's'}${extra ? ' · ' + extra : ''}</span>
        </div>
        ${permitido ? `
        <div class="cliente-acciones">
          <button type="button" class="btn btn-secondary btn-small" data-editar-cliente="${escapeHtml(c.id)}">✏️</button>
          <button type="button" class="btn btn-danger btn-small" data-borrar-cliente="${escapeHtml(c.id)}">🗑️</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

function editarClienteForm(id) {
  const cli = clientePorId(id);
  if (!cli) return;
  $('#cli-id').value = cli.id;
  $('#cli-codigo').value = cli.codigo || '';
  $('#cli-nombre').value = cli.nombre;
  $('#cli-zona').value = cli.zona || '';
  $('#cli-direccion').value = cli.direccion || '';
  $('#cli-telefono').value = cli.telefono || '';
  $('#cli-notas').value = cli.notas || '';
  $('#cli-form-title').textContent = `Editar cliente — ${cli.nombre}`;
  $('#btn-cli-guardar').textContent = '💾 Guardar cambios';
  $('#btn-cli-cancelar').hidden = false;
  $('#cli-nombre').focus();
}

async function guardarClienteForm(ev) {
  ev.preventDefault();
  if (!puede('clientes')) { toast('⚠️ No tienes permiso para registrar clientes'); return; }

  const id = $('#cli-id').value;
  const nombre = $('#cli-nombre').value.trim();
  const zona = $('#cli-zona').value;
  if (!nombre) { toast('⚠️ Escribe el nombre del cliente'); return; }

  // Evita registrar dos veces al mismo cliente (aunque esté escrito distinto)
  const repetido = clientes.find(c => normalizarNombre(c.nombre) === normalizarNombre(nombre) && c.id !== id);
  if (repetido) {
    toast(`⚠️ "${repetido.nombre}" ya está registrado${repetido.zona ? ` en ${repetido.zona}` : ''}`);
    return;
  }

  const anterior = id ? clientePorId(id) : null;

  // Código: el escrito a mano, o uno automático si se deja en blanco
  let codigo = $('#cli-codigo').value.trim().toUpperCase();
  if (!codigo) codigo = (anterior && anterior.codigo) || siguienteCodigoCliente();
  const conEseCodigo = codigoRepetido(codigo, id);
  if (conEseCodigo) { toast(`⚠️ El código ${codigo} ya es de "${conEseCodigo.nombre}"`); return; }

  const cliente = {
    id: id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    codigo,
    nombre,
    zona,
    direccion: $('#cli-direccion').value.trim(),
    telefono: $('#cli-telefono').value.trim(),
    notas: $('#cli-notas').value.trim(),
    creado: anterior ? anterior.creado : Date.now(),
  };

  try {
    await guardarClienteEnStore(cliente);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar el cliente. Revisa tu conexión.');
    return;
  }

  const idx = clientes.findIndex(c => c.id === cliente.id);
  if (idx >= 0) clientes[idx] = cliente; else clientes.push(cliente);
  ordenarClientes();

  // Si cambió el nombre o la zona, se actualizan sus créditos para que todo quede igual
  let actualizados = 0;
  if (anterior && (anterior.nombre !== cliente.nombre || anterior.zona !== cliente.zona)) {
    for (const c of creditosDeCliente(cliente.id)) {
      c.cliente = cliente.nombre;
      c.zona = cliente.zona;
      try { await guardarEnStore(c); actualizados++; } catch (e) { console.error(e); }
    }
  }

  limpiarFormCliente();
  renderClientes();
  llenarSelectClientes($('#f-cliente').value);
  render();
  toast(anterior
    ? `✅ Cliente actualizado${actualizados ? ` (${actualizados} crédito(s) al día)` : ''}`
    : `✅ Cliente "${nombre}" registrado`);
}

async function borrarCliente(id) {
  if (!puede('clientes')) return;
  const cli = clientePorId(id);
  if (!cli) return;
  const usados = creditosDeCliente(id).length;
  if (usados) {
    alert(`No se puede borrar a "${cli.nombre}" porque tiene ${usados} crédito(s) registrados.\n\n` +
          'Si ya no le vendes, puedes dejarlo en la lista: no molesta.');
    return;
  }
  if (!confirm(`¿Borrar al cliente "${cli.nombre}"?`)) return;
  try {
    await eliminarClienteDeStore(id);
  } catch (e) {
    toast('❌ No se pudo borrar. Revisa tu conexión.');
    return;
  }
  clientes = clientes.filter(c => c.id !== id);
  renderClientes();
  llenarSelectClientes();
  toast('🗑️ Cliente borrado');
}

/* Crea la lista de clientes a partir de los créditos que ya tienes.
   Une las variantes del mismo nombre (mayúsculas, tildes, espacios). */
async function importarClientesDesdeCreditos() {
  if (!puede('clientes')) return;

  const grupos = new Map();
  for (const c of creditos) {
    const clave = normalizarNombre(c.cliente);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, { nombres: [], zonas: [], creds: [] });
    const g = grupos.get(clave);
    g.nombres.push(c.cliente);
    if (c.zona) g.zonas.push(c.zona);
    g.creds.push(c);
  }

  const masFrecuente = arr => {
    const cuenta = new Map();
    for (const v of arr) cuenta.set(v, (cuenta.get(v) || 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const nuevos = [];
  for (const [clave, g] of grupos) {
    const existente = clientePorNombre(clave);
    if (existente) {
      // Ya está registrado: solo enlaza sus créditos sueltos
      g.creds.forEach(c => { if (!c.clienteId) nuevos.push({ cliente: existente, creds: [c] }); });
      continue;
    }
    const cliNuevo = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      nombre: masFrecuente(g.nombres),
      codigo: '',
    };
    nuevos.push({
      cliente: {
        ...cliNuevo,
        zona: g.zonas.length ? masFrecuente(g.zonas) : '',
        direccion: '', telefono: '', notas: '', creado: Date.now(),
      },
      creds: g.creds,
      esNuevo: true,
    });
  }

  const aCrear = nuevos.filter(n => n.esNuevo);
  const aEnlazar = nuevos.reduce((s, n) => s + n.creds.length, 0);
  if (!aCrear.length && !aEnlazar) { toast('👌 No hay clientes nuevos que importar'); return; }

  if (!confirm(`Se registrarán ${aCrear.length} cliente(s) a partir de tus créditos y se enlazarán ${aEnlazar} crédito(s).\n\n` +
               'Los nombres escritos distinto (mayúsculas o tildes) se unifican en uno solo. ¿Continuar?')) return;

  const boton = $('#btn-cli-importar');
  boton.disabled = true;
  let creados = 0, enlazados = 0;
  try {
    for (const n of nuevos) {
      if (n.esNuevo) {
        // El código se calcula aquí, ya con los anteriores dentro de la lista
        n.cliente.codigo = siguienteCodigoCliente();
        await guardarClienteEnStore(n.cliente);
        if (!clientePorId(n.cliente.id)) clientes.push(n.cliente);
        creados++;
      }
      for (const c of n.creds) {
        c.clienteId = n.cliente.id;
        c.cliente = n.cliente.nombre;
        if (n.cliente.zona) c.zona = n.cliente.zona;
        await guardarEnStore(c);
        enlazados++;
      }
    }
  } catch (e) {
    console.error(e);
    toast('❌ Se interrumpió la importación. Revisa tu conexión.');
  } finally {
    boton.disabled = false;
  }

  ordenarClientes();
  renderClientes();
  llenarSelectClientes();
  render();
  toast(`✅ ${creados} cliente(s) registrados, ${enlazados} crédito(s) enlazados`);
}

/* ====== Ficha de información del crédito (solo lectura + cobro) ======
   Es la pantalla que usan los empleados en la calle: ven todo el detalle
   del crédito y registran el cobro con la firma del cliente, pero no
   pueden cambiar nada de lo ya registrado. */
let infoCreditoId = null;
let firmaPendiente = null;

function abrirInfo(credito) {
  infoCreditoId = credito.id;
  firmaPendiente = null;
  $('#cobro-monto').value = '';
  $('#cobro-metodo').value = 'efectivo';
  $('#firma-preview-wrap').hidden = true;
  $('#btn-firma').textContent = '✍️ Agregar firma';
  renderInfo();
  $('#modal-info').showModal();
}

function renderInfo() {
  const c = creditos.find(x => x.id === infoCreditoId);
  if (!c) { $('#modal-info').close(); return; }

  const debe = saldoDe(c);
  const pagado = totalAbonado(c);
  const cli = c.clienteId ? clientePorId(c.clienteId) : null;

  $('#info-cliente').textContent = c.cliente;
  $('#info-sub').textContent = `Boleta Nº ${c.boleta} · Emitido el ${formatoFecha(c.fecha)}`;
  $('#info-estado').innerHTML = badgeEstado(c);
  $('#info-total').textContent = formatoMonto(c.monto);
  $('#info-debe').textContent = formatoMonto(debe);
  $('#info-pagado').textContent = formatoMonto(pagado);

  const filas = [
    ['Zona', c.zona || '—'],
    ['Vence', textoVencimiento(c)],
    cli && cli.direccion ? ['Dirección', escapeHtml(cli.direccion)] : null,
    cli && cli.telefono ? ['Teléfono', escapeHtml(cli.telefono)] : null,
    c.notas ? ['Notas', escapeHtml(c.notas)] : null,
  ].filter(Boolean);
  $('#info-datos').innerHTML = filas
    .map(([et, val]) => `<div class="info-fila"><dt>${et}</dt><dd>${val}</dd></div>`).join('');

  // Pagos a cuenta, con su firma si la tienen
  const abonos = abonosDe(c);
  $('#info-abonos').innerHTML = abonos.length
    ? abonos.map((a, i) => `
      <div class="info-abono">
        <div class="info-abono-datos">
          <strong>ACUENTA ${i + 1}: ${formatoMonto(a.monto)}</strong>
          <span class="info-abono-meta">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'} · ${metodoLabel(metodoDe(a))}</span>
          ${a.registradoPor ? `<span class="info-abono-meta${abonoConFechaCambiada(a) ? ' abono-ojo' : ''}">
            ${abonoConFechaCambiada(a) ? '⚠️' : '🖊️'} ${escapeHtml(a.registradoPor)} · ${formatoFecha(a.registradoFecha)}</span>` : ''}
        </div>
        ${a.firma
          ? `<img src="${a.firma}" class="firma-mini" alt="Firma" data-ver-firma="${i}" title="Ver la firma">`
          : '<span class="sin-firma" title="Este pago no tiene firma">sin firma</span>'}
      </div>`).join('')
    : '<p class="abonos-vacio">Todavía no hay pagos a cuenta.</p>';

  $('#info-foto-wrap').hidden = !c.foto;
  if (c.foto) $('#info-foto').src = c.foto;

  // El apartado de cobro solo para quien tenga permiso de registrar pagos
  const puedeCobrar = puede('pagos') && debe > 0 && abonos.length < MAX_ABONOS;
  $('#info-cobro').hidden = !puedeCobrar;
  if (puedeCobrar) {
    $('#cobro-fecha').value = hoyISO();      // siempre hoy y bloqueada
    $('#btn-cobro-todo').textContent = `Saldar todo lo que debe (${formatoMonto(debe)})`;
  }
}

async function pedirFirmaCobro() {
  const firma = await abrirFirma();
  if (!firma) return;
  firmaPendiente = firma;
  $('#firma-preview').src = firma;
  $('#firma-preview-wrap').hidden = false;
  $('#btn-firma').textContent = '✍️ Repetir firma';
}

async function registrarCobro() {
  const c = creditos.find(x => x.id === infoCreditoId);
  if (!c) return;
  if (!puede('pagos')) { toast('🔒 No tienes permiso para registrar pagos'); return; }

  const monto = Number($('#cobro-monto').value);
  const debe = saldoDe(c);
  if (!monto || monto <= 0) { toast('⚠️ Escribe el monto cobrado'); return; }
  if (monto > debe + 0.005) { toast(`⚠️ El cliente solo debe ${formatoMonto(debe)}`); return; }
  if (abonosDe(c).length >= MAX_ABONOS) { toast(`⚠️ Este crédito ya tiene ${MAX_ABONOS} pagos a cuenta`); return; }
  if (!firmaPendiente) { toast('✍️ Falta la firma del cliente'); return; }

  const actualizado = {
    ...c,
    abonos: [...abonosDe(c), {
      monto,
      fecha: hoyISO(),                 // la fecha del cobro es siempre hoy
      metodo: $('#cobro-metodo').value,
      registradoPor: quienSoy(),
      registradoFecha: hoyISO(),
      registrado: Date.now(),
      firma: firmaPendiente,
    }],
  };
  actualizado.estado = estadoCalculado(actualizado);

  const boton = $('#btn-registrar-cobro');
  boton.disabled = true;
  try {
    await guardarEnStore(actualizado);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo registrar el cobro. Revisa tu conexión.');
    boton.disabled = false;
    return;
  }
  boton.disabled = false;

  const i = creditos.findIndex(x => x.id === c.id);
  if (i >= 0) creditos[i] = actualizado;

  firmaPendiente = null;
  $('#cobro-monto').value = '';
  $('#firma-preview-wrap').hidden = true;
  $('#btn-firma').textContent = '✍️ Agregar firma';
  render();
  renderInfo();
  toast(saldoDe(actualizado) <= 0 ? '✅ Crédito saldado por completo' : '✅ Cobro registrado con firma');
}

/* ====== Formulario ====== */
const modalForm = $('#modal-form');
let fotoActual = null;
let abonosActuales = [];   // abonos "a cuenta" en edición

/* Pone las etiquetas de los botones-atajo según la configuración */
function actualizarAtajosVenc() {
  const b1 = $('#btn-atajo-1'), b2 = $('#btn-atajo-2');
  if (b1) b1.textContent = `+${settings.atajo1} días`;
  if (b2) b2.textContent = `+${settings.atajo2} días`;
}

/* Aplica un atajo: vencimiento = fecha de emisión + X días */
function aplicarAtajoVenc(dias) {
  const base = $('#f-fecha').value || hoyISO();
  $('#f-vencimiento').value = sumarDias(base, dias);
  vencimientoEditadoManual = true; // respeta la elección del atajo
}

function abrirFormulario(credito = null) {
  // Editar créditos es solo del administrador: los demás ven la ficha
  if (credito && !puede('editar')) { abrirInfo(credito); return; }
  if (!credito && !puede('crear')) { toast('🔒 No tienes permiso para crear créditos'); return; }
  $('#credit-form').reset();
  fotoActual = null;
  abonosActuales = [];
  vencimientoEditadoManual = false;
  actualizarAtajosVenc();
  $('#btn-atajo-1').disabled = false;
  $('#btn-atajo-2').disabled = false;
  $('#foto-preview-wrap').hidden = true;
  $('#abono-nuevo').hidden = true;
  // Reactiva todos los campos (por si venían bloqueados de una edición anterior)
  ['f-boleta', 'f-cliente-buscar', 'f-zona', 'f-monto', 'f-fecha', 'f-fecha-despacho', 'f-vencimiento', 'f-notas'].forEach(id => { $('#' + id).disabled = false; });
  $('#foto-acciones-wrap').style.display = '';
  $('#btn-cliente-nuevo').hidden = !puede('clientes');
  $('#btn-cliente-nuevo').disabled = false;

  // Selector de clientes: al elegir uno, su zona se pone sola
  let valorCliente = '';
  if (credito) {
    const cli = (credito.clienteId && clientePorId(credito.clienteId)) || clientePorNombre(credito.cliente);
    valorCliente = cli ? cli.id : `libre:${credito.cliente}`;
  }
  llenarSelectClientes(valorCliente);
  $('#f-zona').value = credito ? (credito.zona || '') : '';
  aplicarClienteSeleccionado();

  if (credito) {
    $('#form-title').textContent = `Editar crédito — Boleta ${credito.boleta}`;
    $('#f-id').value = credito.id;
    $('#f-boleta').value = credito.boleta;
    $('#f-monto').value = credito.monto;
    $('#f-fecha').value = credito.fecha;
    $('#f-fecha-despacho').value = credito.fechaDespacho || '';
    $('#f-vencimiento').value = credito.vencimiento;
    $('#f-notas').value = credito.notas || '';
    vencimientoEditadoManual = true; // no recalcular al editar
    if (credito.foto) {
      fotoActual = credito.foto;
      mostrarPreview(credito.foto);
    }
    // Al editar: mostrar abonos y ocultar "pago inicial"
    // Se conserva la constancia (quién y cuándo registró cada pago): es la
    // prueba que permite detectar fechas cambiadas a mano.
    abonosActuales = abonosDe(credito).map(a => ({
      monto: Number(a.monto) || 0,
      fecha: a.fecha || '',
      metodo: metodoDe(a),
      registradoPor: a.registradoPor || '',
      registradoFecha: a.registradoFecha || '',
      registrado: a.registrado || 0,
      firma: a.firma || '',
    }));
    $('#field-pago-inicial').hidden = true;
    $('#abonos-box').hidden = false;
    renderAbonos();
    // Si solo puede registrar pagos (no editar), bloquea los demás campos
    const soloEditarCampos = puede('editar');
    ['f-boleta', 'f-cliente-buscar', 'f-zona', 'f-monto', 'f-fecha', 'f-fecha-despacho', 'f-vencimiento', 'f-notas'].forEach(id => {
      $('#' + id).disabled = !soloEditarCampos;
    });
    $('#btn-atajo-1').disabled = !soloEditarCampos;
    $('#btn-atajo-2').disabled = !soloEditarCampos;
    $('#btn-cliente-nuevo').disabled = !soloEditarCampos;
    $('#foto-acciones-wrap').style.display = soloEditarCampos ? '' : 'none';
    // Vuelve a bloquear la zona si el cliente elegido ya la define
    if (soloEditarCampos) aplicarClienteSeleccionado();
  } else {
    $('#form-title').textContent = 'Nuevo crédito';
    $('#f-id').value = '';
    $('#f-fecha').value = hoyISO();
    $('#f-vencimiento').value = sumarDias(hoyISO(), settings.dias);
    // Al crear: mostrar "pago inicial" y ocultar abonos
    $('#field-pago-inicial').hidden = false;
    $('#abonos-box').hidden = true;
  }
  modalForm.showModal();
}

/* Quita una "a cuenta", pidiendo antes el código de seguridad */
async function quitarAbonoConCodigo(indice) {
  const a = abonosActuales[indice];
  if (!a) return;
  if (!puedeQuitarAbono(a)) {
    toast('🔒 Solo el administrador puede quitar pagos de otros días');
    return;
  }
  const autorizado = await pedirPin(
    `Vas a borrar la ACUENTA ${indice + 1} de ${formatoMonto(a.monto)} (${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'}).`);
  if (!autorizado) { toast('🔒 Borrado cancelado'); return; }
  abonosActuales.splice(indice, 1);
  renderAbonos();
}

/* Dibuja la lista de abonos "a cuenta" y el saldo pendiente en el formulario. */
function renderAbonos() {
  const cont = $('#abonos-list');
  if (!abonosActuales.length) {
    cont.innerHTML = '<p class="abonos-vacio">Aún no hay pagos a cuenta.</p>';
  } else {
    cont.innerHTML = abonosActuales.map((a, i) => {
      const constancia = a.registradoPor
        ? `<span class="abono-constancia${abonoConFechaCambiada(a) ? ' abono-ojo' : ''}">
             ${abonoConFechaCambiada(a) ? '⚠️ ' : '🖊️ '}Registrado por ${escapeHtml(a.registradoPor)}
             el ${formatoFecha(a.registradoFecha)}</span>`
        : '';
      const puedeQuitar = puedeQuitarAbono(a);
      return `
      <div class="abono-item">
        <span class="abono-datos">ACUENTA ${i + 1}: <strong>${formatoMonto(a.monto)}</strong>
          <span class="abono-fecha">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'} · ${metodoLabel(metodoDe(a))}</span>
          ${constancia}</span>
        ${a.firma ? `<img src="${a.firma}" class="firma-mini" alt="Firma" data-ver-firma-form="${i}" title="Ver la firma del cliente">` : ''}
        ${puedeQuitar
          ? `<button type="button" data-quitar-abono="${i}" title="Quitar este pago">🗑️</button>`
          : '<span class="abono-bloqueado" title="Solo el administrador puede quitar los pagos de otros días">🔒</span>'}
      </div>`;
    }).join('');
  }
  const monto = Number($('#f-monto').value) || 0;
  const abonado = abonosActuales.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const saldo = Math.max(0, monto - abonado);
  const el = $('#saldo-valor');
  el.textContent = formatoMonto(saldo);
  el.classList.toggle('saldo-cero', saldo <= 0);
  $('#pagado-valor').textContent = formatoMonto(abonado);

  const tope = abonosActuales.length >= MAX_ABONOS;
  const btn = $('#btn-agregar-abono');
  btn.disabled = tope;
  btn.textContent = tope ? '✓ Máximo 8 pagos a cuenta' : '➕ Agregar a cuenta';
}

function abrirNuevoAbono() {
  const monto = Number($('#f-monto').value) || 0;
  const abonado = abonosActuales.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const saldo = Math.max(0, monto - abonado);
  $('#abono-monto').value = saldo > 0 ? saldo : '';
  $('#abono-fecha').value = hoyISO();
  $('#abono-metodo').value = 'efectivo';
  $('#abono-nuevo').hidden = false;
  $('#btn-agregar-abono').hidden = true;
  $('#abono-monto').focus();
}

function confirmarNuevoAbono() {
  const monto = Number($('#abono-monto').value);
  if (!monto || monto <= 0) { toast('⚠️ Escribe un monto válido para el pago'); return; }
  abonosActuales.push({
    monto,
    fecha: $('#abono-fecha').value || hoyISO(),
    metodo: $('#abono-metodo').value,
    // Constancia automática: quién lo registró y en qué día/hora real
    registradoPor: quienSoy(),
    registradoFecha: hoyISO(),
    registrado: Date.now(),
  });
  $('#abono-nuevo').hidden = true;
  $('#btn-agregar-abono').hidden = false;
  renderAbonos();
}

function mostrarPreview(dataURL) {
  $('#foto-preview').src = dataURL;
  $('#foto-preview-wrap').hidden = false;
}

/* Abre la foto de la boleta a pantalla completa, con opción de descargar. */
function mostrarImagenGrande(dataUrl, nombreArchivo) {
  $('#imagen-grande').src = dataUrl;
  const enlace = $('#btn-descargar-imagen');
  enlace.href = dataUrl;
  enlace.download = String(nombreArchivo).replace(/[^\w.-]/g, '_');
  $('#modal-imagen').showModal();
}

function abrirVisorImagen(credito) {
  const nombre = String(credito.boleta || 'foto').replace(/[^\w.-]/g, '_');
  mostrarImagenGrande(credito.foto, `boleta-${nombre}.jpg`);
}

function comprimirImagen(img, maxLado, calidad) {
  let { width, height } = img;
  if (width > maxLado || height > maxLado) {
    const escala = Math.min(maxLado / width, maxLado / height);
    width = Math.round(width * escala);
    height = Math.round(height * escala);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', calidad);
}

/* Guarda la imagen en alta calidad. Busca la mayor resolución/calidad que
   quepa en un documento de Firestore (límite 1 MB); deja la foto bien
   legible para leer la boleta. */
function procesarImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const intentos = [[2400, 0.92], [2000, 0.9], [2000, 0.82], [1600, 0.8], [1280, 0.75], [1024, 0.65], [800, 0.55]];
      let resultado = null;
      for (const [maxLado, calidad] of intentos) {
        resultado = comprimirImagen(img, maxLado, calidad);
        // Se deja sitio para las firmas de los pagos (hasta 8, ~14 KB cada una)
        // dentro del límite de 1 MB por documento de Firestore
        if (resultado.length < 760000) break;
      }
      resolve(resultado);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function manejarFoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    fotoActual = await procesarImagen(file);
    mostrarPreview(fotoActual);
  } catch (e) {
    toast('❌ No se pudo procesar la imagen');
  }
  input.value = '';
}

/* ====== Hoja de cobranza (modal) ====== */
function abrirCobranza() {
  if (!$('#cob-fecha').value) $('#cob-fecha').value = hoyISO();
  renderCobranza();
  $('#modal-cobranza').showModal();
}

function renderCobranza() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const dias = diasConCobros(creditos);
  const diaInfo = dias.find(d => d.fecha === fecha) || { codigo: 'HC—' };
  const { filas, totales } = hojaCobranza(creditos, fecha, diaInfo.codigo);

  $('#cob-totales').innerHTML = `
    <div class="cob-total-card"><span class="et">💵 Efectivo</span><span class="val">${formatoMonto(totales.efectivo)}</span></div>
    <div class="cob-total-card"><span class="et">📱 Yape</span><span class="val">${formatoMonto(totales.yape)}</span></div>
    <div class="cob-total-card"><span class="et">🏦 BCP</span><span class="val">${formatoMonto(totales.bcp)}</span></div>
    <div class="cob-total-card total"><span class="et">Total del día</span><span class="val">${formatoMonto(totales.total)}</span></div>`;

  $('#cob-body').innerHTML = filas.map(f => `
    <tr class="cob-fila" data-info="${escapeHtml(f.creditoId)}" title="Ver el crédito completo">
      <td><span class="cob-codigo">${f.codigo ? escapeHtml(f.codigo) : '—'}</span></td>
      <td>${escapeHtml(f.cliente)}</td>
      <td>${f.zona ? escapeHtml(f.zona) : '—'}</td>
      <td><strong>${escapeHtml(f.boleta)}</strong></td>
      <td class="col-num"><strong>${formatoMonto(f.monto)}</strong></td>
      <td class="col-num ${f.saldo > 0 ? 'saldo-pend' : 'saldo-ok'}">${f.saldo > 0 ? formatoMonto(f.saldo) : '✓ saldado'}</td>
      <td><span class="pago-tag pago-${f.metodo}">${metodoLabel(f.metodo)}</span></td>
      <td>${f.cobradoPor ? escapeHtml(f.cobradoPor) : '—'}</td>
      <td>${f.firma
        ? `<img src="${f.firma}" class="firma-mini" alt="Firma" data-ver-firma-cob="${escapeHtml(f.creditoId)}|${f.indice}" title="Ver la firma">`
        : '<span class="sin-firma">—</span>'}</td>
    </tr>`).join('');

  $('#cob-vacio').hidden = filas.length > 0;
  $('#cob-tabla').hidden = filas.length === 0;

  // Resumen del día y navegador de días con cobros
  const clientesDistintos = new Set(filas.map(f => f.cliente)).size;
  $('#cob-resumen').textContent = filas.length
    ? `Hoja del ${formatoFecha(fecha)} — ${filas.length} pago(s) de ${clientesDistintos} cliente(s)`
    : `Hoja del ${formatoFecha(fecha)} — sin movimientos`;

  const hayFecha = dias.some(d => d.fecha === fecha);
  const opciones = dias.map(d =>
    `<option value="${d.fecha}">${formatoFecha(d.fecha)} — ${d.pagos} pago(s) · ${formatoMonto(d.total)}</option>`).join('');
  $('#cob-dias').innerHTML =
    (hayFecha ? '' : `<option value="${fecha}">${formatoFecha(fecha)} — sin movimientos</option>`) + opciones;
  $('#cob-dias').value = fecha;
}

/* Salta al día anterior o siguiente que tenga cobros */
function saltarDiaCobranza(direccion) {
  const fecha = $('#cob-fecha').value || hoyISO();
  const dias = diasConCobros(creditos).map(d => d.fecha);   // del más nuevo al más viejo
  if (!dias.length) { toast('Todavía no hay cobros registrados'); return; }
  const anteriores = dias.filter(d => d < fecha);
  const siguientes = dias.filter(d => d > fecha);
  const destino = direccion < 0
    ? (anteriores[0] || null)                       // el más cercano hacia atrás
    : (siguientes[siguientes.length - 1] || null);  // el más cercano hacia adelante
  if (!destino) { toast(direccion < 0 ? 'No hay días anteriores con cobros' : 'No hay días siguientes con cobros'); return; }
  $('#cob-fecha').value = destino;
  renderCobranza();
}

function exportarCobranzaExcel() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const dias = diasConCobros(creditos);
  const diaInfo = dias.find(d => d.fecha === fecha) || { codigo: 'HC—' };
  const { filas, totales } = hojaCobranza(creditos, fecha, diaInfo.codigo);
  const dinero = `"${settings.moneda}"#,##0`;

  // Paleta (coincide con la app y con los colores por método)
  const OLIVA = '6D7350', BLANCO = 'FFFFFF', CARBON = '2B2B2D', GRIS_TXT = '77776E';
  const CEBRA = 'F4F4F0', TOT_BG = 'ECEEDD';
  const MET = {
    efectivo: { bg: 'E2EFE5', txt: '2F6B3F', emoji: '💵', nombre: 'Efectivo' },
    yape:     { bg: 'EDE9FE', txt: '6D28D9', emoji: '📱', nombre: 'Yape' },
    bcp:      { bg: 'DBEAFE', txt: '1D4ED8', emoji: '🏦', nombre: 'BCP' },
  };

  const titulo   = { bold: true, size: 15, color: CARBON, align: 'left' };
  const subtit   = { size: 11, color: GRIS_TXT, align: 'left' };
  const th       = { bold: true, color: BLANCO, bg: OLIVA, align: 'center', border: true };
  const thIzq    = { bold: true, color: BLANCO, bg: OLIVA, align: 'left', border: true };
  const tdTxt    = b => ({ align: 'left', border: true, bg: b ? CEBRA : undefined });
  const tdNum    = b => ({ align: 'right', border: true, fmt: dinero, bg: b ? CEBRA : undefined });
  const tdMet    = m => ({ align: 'center', border: true, bold: true, color: MET[m].txt, bg: MET[m].bg });
  const cardEt   = m => ({ align: 'left', bold: true, color: MET[m].txt, bg: MET[m].bg });
  const cardVal  = m => ({ align: 'right', bold: true, color: MET[m].txt, bg: MET[m].bg, fmt: dinero });
  const totEt    = { bold: true, align: 'right', color: CARBON, bg: TOT_BG, border: true };
  const totVal   = { bold: true, align: 'right', color: CARBON, bg: TOT_BG, border: true, fmt: dinero };

  const filasXlsx = [
    [{ v: 'HOJA DE COBRANZA', s: titulo }],
    [{ v: formatoFecha(fecha), s: subtit }],
    [],
    // Resumen por método (tres tarjetas)
    [
      { v: `${MET.efectivo.emoji} Efectivo`, s: cardEt('efectivo') }, { v: Number(totales.efectivo) || 0, s: cardVal('efectivo') },
      { v: `${MET.yape.emoji} Yape`, s: cardEt('yape') }, { v: Number(totales.yape) || 0, s: cardVal('yape') },
      { v: `${MET.bcp.emoji} BCP`, s: cardEt('bcp') }, { v: Number(totales.bcp) || 0, s: cardVal('bcp') },
    ],
    [],
    // Encabezado de la tabla
    [
      { v: 'Código', s: th }, { v: 'Cliente', s: thIzq }, { v: 'Zona', s: thIzq },
      { v: 'Boleta', s: th }, { v: 'Fecha emisión', s: th }, { v: 'Fecha despacho', s: th },
      { v: 'Cobrado', s: th }, { v: 'Queda debiendo', s: th },
      { v: 'Pago', s: th }, { v: 'Cobró', s: thIzq },
    ],
  ];

  filas.forEach((f, i) => {
    const z = i % 2 === 1; // cebra
    const m = MET[f.metodo] ? f.metodo : 'efectivo';
    filasXlsx.push([
      { v: f.codigo || '—', s: { align: 'center', border: true, bold: true, bg: z ? CEBRA : undefined } },
      { v: f.cliente, s: tdTxt(z) },
      { v: f.zona || '—', s: tdTxt(z) },
      { v: f.boleta, s: { align: 'center', border: true, bg: z ? CEBRA : undefined } },
      { v: f.fechaEmision ? formatoFecha(f.fechaEmision) : '—', s: tdTxt(z) },
      { v: f.fechaDespacho ? formatoFecha(f.fechaDespacho) : '—', s: tdTxt(z) },
      { v: Number(f.monto) || 0, s: tdNum(z) },
      { v: Number(f.saldo) || 0, s: tdNum(z) },
      { v: `${MET[m].emoji} ${MET[m].nombre}`, s: tdMet(m) },
      { v: f.cobradoPor || '—', s: tdTxt(z) },
    ]);
  });

  if (!filas.length) {
    filasXlsx.push([{ v: 'Sin cobros registrados en esta fecha', s: { align: 'left', color: GRIS_TXT } }]);
  }

  // Fila de TOTAL
  filasXlsx.push([
    { v: '', s: { border: true } }, { v: '', s: { border: true } }, { v: '', s: { border: true } },
    { v: '', s: { border: true } }, { v: '', s: { border: true } }, { v: 'TOTAL', s: totEt },
    { v: Number(totales.total) || 0, s: totVal }, { v: '', s: { border: true } },
    { v: '', s: { border: true } }, { v: '', s: { border: true } },
  ]);

  descargarXlsx(`cobranza-${fecha}.xlsx`, {
    nombre: 'Cobranza',
    cols: [10, 26, 15, 11, 12, 12, 13, 16, 14, 14],
    merges: ['A1:J1', 'A2:J2'],
    filas: filasXlsx,
  });
  toast('⬇️ Hoja de cobranza exportada (.xlsx)');
}

function imprimirCobranza() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const { filas, totales } = hojaCobranza(creditos, fecha);
  const filasHtml = filas.map(f => `<tr>
      <td>${escapeHtml(f.codigo || '—')}</td><td>${escapeHtml(f.cliente)}</td>
      <td>${escapeHtml(f.zona || '—')}</td><td>${escapeHtml(f.boleta)}</td>
      <td>${f.fechaEmision ? formatoFecha(f.fechaEmision) : '—'}</td>
      <td>${f.fechaDespacho ? formatoFecha(f.fechaDespacho) : '—'}</td>
      <td style="text-align:right">${formatoMonto(f.monto)}</td>
      <td style="text-align:right">${f.saldo > 0 ? formatoMonto(f.saldo) : 'saldado'}</td>
      <td>${metodoLabel(f.metodo)}</td><td>${escapeHtml(f.cobradoPor || '—')}</td>
      <td>${f.firma ? `<img src="${f.firma}" style="height:34px">` : '—'}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Cobranza ${formatoFecha(fecha)}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:20px;color:#111}
      h1{font-size:18px;margin:0 0 4px} .sub{color:#555;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f0f0f0}
      .tot{margin-top:16px;font-size:14px} .tot div{margin:2px 0}
      .tot strong{display:inline-block;min-width:110px}
    </style></head><body>
    <h1>🧾 Hoja de cobranza</h1>
    <p class="sub">Fecha: ${formatoFecha(fecha)} — ${filas.length} cobro(s)</p>
    <table><thead><tr><th>Código</th><th>Cliente</th><th>Zona</th><th>Boleta</th>
    <th>Fecha emisión</th><th>Fecha despacho</th>
    <th style="text-align:right">Cobrado</th><th style="text-align:right">Queda debiendo</th>
    <th>Pago</th><th>Cobró</th><th>Firma</th></tr></thead>
    <tbody>${filasHtml || '<tr><td colspan="11" style="text-align:center">Sin cobros este día</td></tr>'}</tbody></table>
    <div class="tot">
      <div><strong>💵 Efectivo:</strong> ${formatoMonto(totales.efectivo)}</div>
      <div><strong>📱 Yape:</strong> ${formatoMonto(totales.yape)}</div>
      <div><strong>🏦 BCP:</strong> ${formatoMonto(totales.bcp)}</div>
      <div><strong>Total del día:</strong> ${formatoMonto(totales.total)}</div>
    </div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('⚠️ Permite las ventanas emergentes para imprimir'); return; }
  w.document.write(html);
  w.document.close();
}

async function guardarCredito(ev) {
  ev.preventDefault();

  const id = $('#f-id').value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const boleta = $('#f-boleta').value.trim();

  // Evita boletas duplicadas (excepto al editar la misma)
  const duplicado = creditos.find(c => c.boleta.toLowerCase() === boleta.toLowerCase() && c.id !== id);
  if (duplicado) {
    toast(`⚠️ Ya existe la boleta Nº ${boleta} (${duplicado.cliente})`);
    return;
  }

  // Cliente: viene de la lista registrada (o, en créditos antiguos, del nombre suelto)
  const valorCliente = $('#f-cliente').value;
  let clienteNombre = '', clienteId = '', zona = $('#f-zona').value;
  if (valorCliente.startsWith('libre:')) {
    clienteNombre = valorCliente.slice(6);
  } else {
    const cli = clientePorId(valorCliente);
    if (!cli) { toast('⚠️ Elige un cliente de la lista (o registra uno nuevo)'); return; }
    clienteNombre = cli.nombre;
    clienteId = cli.id;
    zona = cli.zona || '';
  }

  const existente = creditos.find(c => c.id === id);
  const fecha = $('#f-fecha').value;

  // Abonos: al editar vienen de la sección; al crear, del "pago inicial" opcional
  let abonos;
  if (existente) {
    abonos = abonosActuales.slice();
  } else {
    const pagoInicial = Number($('#f-pago-inicial').value) || 0;
    abonos = pagoInicial > 0 ? [{ monto: pagoInicial, fecha, metodo: $('#f-pago-metodo').value }] : [];
  }

  const credito = {
    id,
    boleta,
    cliente: clienteNombre,
    clienteId,
    zona,
    monto: Number($('#f-monto').value),
    fecha,
    fechaDespacho: $('#f-fecha-despacho').value || null,
    vencimiento: $('#f-vencimiento').value,
    abonos,
    notas: $('#f-notas').value.trim(),
    foto: fotoActual,
    creado: existente ? existente.creado : Date.now(),
  };
  credito.estado = estadoCalculado(credito);  // pagado / parcial / pendiente automático

  try {
    await guardarEnStore(credito);
  } catch (e) {
    console.error(e);
    toast('❌ Error al guardar. Revisa tu conexión o el espacio disponible.');
    return;
  }

  const idx = creditos.findIndex(c => c.id === id);
  if (idx >= 0) creditos[idx] = credito; else creditos.push(credito);

  modalForm.close();
  render();
  toast(existente ? '✅ Crédito actualizado' : '✅ Crédito guardado');
}

async function borrarCredito(id) {
  const c = creditos.find(x => x.id === id);
  if (!c) return;
  if (!puede('borrar')) { toast('🔒 No tienes permiso para borrar créditos'); return; }
  if (!confirm(`¿Borrar el crédito de la boleta Nº ${c.boleta} (${c.cliente})?\nEsta acción no se puede deshacer.`)) return;
  const autorizado = await pedirPin(`Vas a borrar el crédito de la boleta Nº ${c.boleta} (${c.cliente}).`);
  if (!autorizado) { toast('🔒 Borrado cancelado'); return; }
  try {
    await eliminarDeStore(id);
  } catch (e) {
    toast('❌ No se pudo borrar. Revisa tu conexión.');
    return;
  }
  creditos = creditos.filter(x => x.id !== id);
  render();
  toast('🗑️ Crédito borrado');
}

/* ====== Respaldo ====== */
function exportarRespaldo() {
  const datos = { version: 2, exportado: new Date().toISOString(), settings, creditos, clientes };
  const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo-creditos-${hoyISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('⬇️ Respaldo exportado');
}

async function importarRespaldo(file) {
  try {
    const texto = await file.text();
    const datos = JSON.parse(texto);
    if (!Array.isArray(datos.creditos)) throw new Error('Formato inválido');
    const destino = modoNube ? 'tu cuenta en la nube' : 'este dispositivo';
    if (!confirm(`El respaldo contiene ${datos.creditos.length} créditos.\n¿Agregarlos a ${destino}? (Los créditos con el mismo ID se sobrescriben)`)) return;
    for (const c of datos.creditos) await guardarEnStore(c);
    if (!modoNube) {
      const ids = new Set(creditos.map(c => c.id));
      for (const c of datos.creditos) {
        if (ids.has(c.id)) creditos[creditos.findIndex(x => x.id === c.id)] = c;
        else creditos.push(c);
      }
    }
    if (Array.isArray(datos.clientes)) {
      for (const cli of datos.clientes) {
        await guardarClienteEnStore(cli);
        if (!modoNube) {
          const i = clientes.findIndex(x => x.id === cli.id);
          if (i >= 0) clientes[i] = cli; else clientes.push(cli);
        }
      }
      ordenarClientes();
      renderClientes();
      llenarSelectClientes();
    }
    if (datos.settings) { settings = { ...settings, ...datos.settings }; await guardarSettings().catch(() => {}); }
    render();
    toast('⬆️ Respaldo importado correctamente');
  } catch (e) {
    console.error(e);
    toast('❌ El archivo no es un respaldo válido');
  }
}

/* Llena el selector de zona del formulario y las casillas de zonas/meses del filtro. */
function poblarSelectores() {
  $('#f-zona').innerHTML = '<option value="">— Sin zona —</option>' +
    ZONAS.map(z => `<option value="${z}">${z}</option>`).join('');
  $('#cli-zona').innerHTML = '<option value="">— Sin zona —</option>' +
    ZONAS.map(z => `<option value="${z}">${z}</option>`).join('');
  $('#filtro-zonas').innerHTML = ZONAS.map(z =>
    `<label><input type="checkbox" class="fil-zona" value="${escapeHtml(z)}"> ${escapeHtml(z)}</label>`).join('');
  $('#filtro-meses').innerHTML = MESES.map((m, i) =>
    `<label><input type="checkbox" class="fil-mes" value="${i + 1}"> ${m}</label>`).join('');
}

/* ====== Eventos ====== */
function inicializarEventos() {
  poblarSelectores();

  $('#btn-new').addEventListener('click', () => abrirFormulario());
  $('#btn-cancelar').addEventListener('click', () => modalForm.close());
  $('#credit-form').addEventListener('submit', guardarCredito);

  // Abonos "a cuenta" (en edición)
  $('#btn-agregar-abono').addEventListener('click', abrirNuevoAbono);
  $('#btn-abono-confirmar').addEventListener('click', confirmarNuevoAbono);
  $('#btn-abono-cancelar').addEventListener('click', () => {
    $('#abono-nuevo').hidden = true;
    $('#btn-agregar-abono').hidden = false;
  });
  $('#f-monto').addEventListener('input', () => { if (!$('#abonos-box').hidden) renderAbonos(); });

  // Vencimiento automático: emisión + días configurados, salvo que el usuario lo haya tocado
  $('#f-fecha').addEventListener('change', () => {
    if (!vencimientoEditadoManual && $('#f-fecha').value) {
      $('#f-vencimiento').value = sumarDias($('#f-fecha').value, settings.dias);
    }
  });
  $('#f-vencimiento').addEventListener('input', () => { vencimientoEditadoManual = true; });

  // Atajos rápidos de vencimiento (X días después de la emisión)
  $('#btn-atajo-1').addEventListener('click', () => aplicarAtajoVenc(settings.atajo1));
  $('#btn-atajo-2').addEventListener('click', () => aplicarAtajoVenc(settings.atajo2));

  // Buscador de clientes: escribes y te sugiere los que coinciden
  const cajaCliente = $('#f-cliente-buscar');
  const listaCliente = $('#cliente-sugerencias');

  // Mientras escribes solo se filtran las sugerencias: el cliente elegido
  // no cambia hasta que tocas uno (o el nombre coincide exacto al salir).
  cajaCliente.addEventListener('input', () => renderSugerencias(cajaCliente.value));
  cajaCliente.addEventListener('focus', () => renderSugerencias(cajaCliente.value));
  cajaCliente.addEventListener('click', () => renderSugerencias(cajaCliente.value));

  // Al tocar una sugerencia (pointerdown evita que el campo pierda el foco antes)
  listaCliente.addEventListener('pointerdown', ev => {
    const op = ev.target.closest('.combo-op');
    if (!op) return;
    ev.preventDefault();
    seleccionarCliente(op.dataset.id);
  });

  cajaCliente.addEventListener('keydown', ev => {
    const ops = [...listaCliente.querySelectorAll('.combo-op')];
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (listaCliente.hidden) { renderSugerencias(cajaCliente.value); return; }
      if (!ops.length) return;
      comboIndice = ev.key === 'ArrowDown'
        ? (comboIndice + 1) % ops.length
        : (comboIndice - 1 + ops.length) % ops.length;
      ops.forEach((o, i) => o.classList.toggle('activa', i === comboIndice));
      ops[comboIndice].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      if (!listaCliente.hidden) {
        ev.preventDefault();            // no guardar el crédito sin querer
        if (comboIndice >= 0 && ops[comboIndice]) seleccionarCliente(ops[comboIndice].dataset.id);
        else if (ops.length === 1) seleccionarCliente(ops[0].dataset.id);
        else cerrarSugerencias();
      }
    } else if (ev.key === 'Escape') {
      if (!listaCliente.hidden) {
        ev.preventDefault();
        ev.stopPropagation();           // cierra la lista, no el formulario
        cerrarSugerencias();
      }
    }
  });

  /* Al salir del campo:
     - vacío            -> se queda sin cliente
     - nombre exacto    -> se elige ese cliente
     - texto cualquiera -> se restaura el cliente que ya estaba elegido */
  cajaCliente.addEventListener('blur', () => {
    cerrarSugerencias();
    const texto = cajaCliente.value.trim();
    const exacto = texto ? clientePorNombre(texto) : null;
    if (!texto) $('#f-cliente').value = '';
    else if (exacto) $('#f-cliente').value = exacto.id;
    cajaCliente.value = textoCliente($('#f-cliente').value);
    aplicarClienteSeleccionado();
  });
  $('#btn-cliente-nuevo').addEventListener('click', () => {
    abrirClientes();
    $('#cli-nombre').focus();
  });
  $('#btn-clientes').addEventListener('click', abrirClientes);
  $('#btn-clientes-cerrar').addEventListener('click', () => $('#modal-clientes').close());
  $('#cli-form').addEventListener('submit', guardarClienteForm);
  $('#btn-cli-cancelar').addEventListener('click', limpiarFormCliente);
  $('#cli-buscar').addEventListener('input', renderClientes);
  $('#btn-cli-importar').addEventListener('click', importarClientesDesdeCreditos);
  $('#clientes-list').addEventListener('click', ev => {
    const editar = ev.target.closest('[data-editar-cliente]');
    if (editar) { editarClienteForm(editar.dataset.editarCliente); return; }
    const borrar = ev.target.closest('[data-borrar-cliente]');
    if (borrar) borrarCliente(borrar.dataset.borrarCliente);
  });

  $('#f-foto-camara').addEventListener('change', ev => manejarFoto(ev.target));
  $('#f-foto-archivo').addEventListener('change', ev => manejarFoto(ev.target));
  $('#btn-quitar-foto').addEventListener('click', () => {
    fotoActual = null;
    $('#foto-preview-wrap').hidden = true;
  });

  // Búsqueda y orden
  $('#search').addEventListener('input', render);
  $('#sort-by').addEventListener('change', render);

  // Panel de filtros (estado + zona + mes + rango de fechas, todos combinados)
  $('#btn-filtrar').addEventListener('click', ev => {
    ev.stopPropagation();
    $('#filtro-panel').hidden = !$('#filtro-panel').hidden;
  });
  $('#filtro-panel').addEventListener('click', ev => ev.stopPropagation());
  $('#filtro-panel').addEventListener('change', render);
  $('#btn-filtro-cerrar').addEventListener('click', () => { $('#filtro-panel').hidden = true; });
  $('#btn-filtro-limpiar').addEventListener('click', () => {
    document.querySelectorAll('.fil-estado, .fil-zona, .fil-mes').forEach(cb => { cb.checked = false; });
    $('#fil-desde').value = '';
    $('#fil-hasta').value = '';
    render();
  });
  // Cerrar el panel al tocar fuera de él
  document.addEventListener('click', () => { $('#filtro-panel').hidden = true; });

  // Ordenar tocando el encabezado de la tabla
  document.querySelectorAll('.credit-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const campo = th.dataset.sort;
      const [campoActual, dirActual] = $('#sort-by').value.split('-');
      const dir = (campoActual === campo && dirActual === 'asc') ? 'desc' : 'asc';
      const opcion = `${campo}-${dir}`;
      if ([...$('#sort-by').options].some(o => o.value === opcion)) {
        $('#sort-by').value = opcion;
      }
      render();
    });
  });

  // Acciones en filas, tarjetas y abonos (delegación)
  document.body.addEventListener('click', ev => {
    const info = ev.target.closest('[data-info]');
    const editar = ev.target.closest('[data-editar]');
    const borrar = ev.target.closest('[data-borrar]');
    const verFoto = ev.target.closest('[data-ver-foto]');
    const verFirma = ev.target.closest('[data-ver-firma]');
    const verFotoInfo = ev.target.closest('[data-ver-foto-info]');
    const quitarAbono = ev.target.closest('[data-quitar-abono]');
    if (info) {
      const c = creditos.find(x => x.id === info.dataset.info);
      if (c) abrirInfo(c);
    } else if (verFirma) {
      const c = creditos.find(x => x.id === infoCreditoId);
      const a = c && abonosDe(c)[Number(verFirma.dataset.verFirma)];
      if (a && a.firma) mostrarImagenGrande(a.firma, `firma-${c.boleta}-${Number(verFirma.dataset.verFirma) + 1}.png`);
    } else if (ev.target.closest('[data-ver-firma-cob]')) {
      ev.stopPropagation();
      const [cid, idx] = ev.target.closest('[data-ver-firma-cob]').dataset.verFirmaCob.split('|');
      const c = creditos.find(x => x.id === cid);
      const a = c && abonosDe(c)[Number(idx)];
      if (a && a.firma) mostrarImagenGrande(a.firma, `firma-${c.boleta}-${Number(idx) + 1}.png`);
    } else if (ev.target.closest('[data-ver-firma-form]')) {
      const idx = Number(ev.target.closest('[data-ver-firma-form]').dataset.verFirmaForm);
      const a = abonosActuales[idx];
      if (a && a.firma) mostrarImagenGrande(a.firma, `firma-${$('#f-boleta').value || 'pago'}-${idx + 1}.png`);
    } else if (verFotoInfo) {
      const c = creditos.find(x => x.id === infoCreditoId);
      if (c && c.foto) abrirVisorImagen(c);
    } else if (editar) {
      const c = creditos.find(x => x.id === editar.dataset.editar);
      if (c) abrirFormulario(c);
    } else if (borrar) {
      borrarCredito(borrar.dataset.borrar);
    } else if (quitarAbono) {
      quitarAbonoConCodigo(Number(quitarAbono.dataset.quitarAbono));
    } else if (verFoto) {
      const c = creditos.find(x => x.id === verFoto.dataset.verFoto);
      if (c && c.foto) abrirVisorImagen(c);
    }
  });
  $('#btn-cerrar-imagen').addEventListener('click', () => $('#modal-imagen').close());

  // Hoja de cobranza
  $('#btn-cobranza').addEventListener('click', abrirCobranza);
  $('#cob-fecha').addEventListener('change', renderCobranza);
  $('#cob-dias').addEventListener('change', () => {
    $('#cob-fecha').value = $('#cob-dias').value;
    renderCobranza();
  });
  $('#btn-cob-anterior').addEventListener('click', () => saltarDiaCobranza(-1));
  $('#btn-cob-siguiente').addEventListener('click', () => saltarDiaCobranza(1));
  $('#btn-cob-hoy').addEventListener('click', () => { $('#cob-fecha').value = hoyISO(); renderCobranza(); });
  $('#btn-cli-codigos').addEventListener('click', generarCodigosFaltantes);
  $('#btn-cob-cerrar').addEventListener('click', () => $('#modal-cobranza').close());
  $('#btn-cob-excel').addEventListener('click', exportarCobranzaExcel);
  $('#btn-cob-imprimir').addEventListener('click', imprimirCobranza);

  // Configuración
  $('#btn-settings').addEventListener('click', () => {
    $('#s-dias').value = settings.dias;
    $('#s-moneda').value = settings.moneda;
    $('#s-avisos').checked = settings.avisos !== false;
    $('#s-atajo1').value = settings.atajo1;
    $('#s-atajo2').value = settings.atajo2;
    actualizarEstadoPin();
    // Los ajustes del negocio los define el administrador para todos
    const soloAdmin = modoNube && !esAdmin();
    ['s-dias', 's-moneda', 's-atajo1', 's-atajo2'].forEach(id => { $('#' + id).disabled = soloAdmin; });
    $('#settings-nota-admin').hidden = !soloAdmin;
    $('#modal-settings').showModal();
  });
  $('#btn-settings-cerrar').addEventListener('click', () => $('#modal-settings').close());
  $('#settings-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    settings.dias = Math.max(1, Number($('#s-dias').value) || 30);
    settings.moneda = $('#s-moneda').value.trim() || '$';
    settings.avisos = $('#s-avisos').checked;
    settings.atajo1 = Math.min(365, Math.max(1, Number($('#s-atajo1').value) || 15));
    settings.atajo2 = Math.min(365, Math.max(1, Number($('#s-atajo2').value) || 45));
    actualizarAtajosVenc();
    $('#modal-settings').close();
    render();
    try {
      await guardarSettings();
      toast('✅ Configuración guardada');
    } catch (e) {
      console.error(e);
      avisarConfigSinNube();
      toast('⚠️ Guardada solo en este dispositivo');
    }
  });

  // Ficha de información y cobro con firma
  $('#btn-info-cerrar').addEventListener('click', () => $('#modal-info').close());
  $('#btn-firma').addEventListener('click', pedirFirmaCobro);
  $('#btn-registrar-cobro').addEventListener('click', registrarCobro);
  $('#btn-cobro-todo').addEventListener('click', () => {
    const c = creditos.find(x => x.id === infoCreditoId);
    if (c) $('#cobro-monto').value = saldoDe(c);
  });

  // Lienzo de la firma: lápiz táctil, dedo o mouse
  const lienzo = $('#firma-canvas');
  lienzo.addEventListener('pointerdown', ev => {
    if (!firmaCtx) return;
    ev.preventDefault();
    lienzo.setPointerCapture(ev.pointerId);
    firmaDibujando = true;
    firmaHayTrazo = true;
    const pt = puntoFirma(ev);
    firmaCtx.beginPath();
    firmaCtx.moveTo(pt.x, pt.y);
    firmaCtx.lineTo(pt.x + 0.1, pt.y);   // un toque suelto también deja marca
    firmaCtx.stroke();
  });
  lienzo.addEventListener('pointermove', ev => {
    if (!firmaDibujando || !firmaCtx) return;
    ev.preventDefault();
    const pt = puntoFirma(ev);
    firmaCtx.lineTo(pt.x, pt.y);
    firmaCtx.stroke();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(tipo =>
    lienzo.addEventListener(tipo, () => { firmaDibujando = false; }));

  // Código de seguridad
  $('#btn-pin-guardar').addEventListener('click', guardarPin);
  $('#btn-pin-quitar').addEventListener('click', quitarPin);

  $('#btn-exportar').addEventListener('click', exportarRespaldo);
  $('#input-importar').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    if (file) importarRespaldo(file);
    ev.target.value = '';
  });

  // Autenticación (modo nube)
  $('#auth-form').addEventListener('submit', enviarAuth);
  $('#btn-logout').addEventListener('click', cerrarSesion);
  $('#btn-logout-header').addEventListener('click', cerrarSesion);
  $('#btn-cambiar-pass').addEventListener('click', cambiarMiContrasena);

  // Panel de administración de usuarios (solo admin)
  $('#btn-usuarios').addEventListener('click', abrirUsuarios);
  $('#btn-usuarios-cerrar').addEventListener('click', () => $('#modal-usuarios').close());
  $('#u-form-nuevo').addEventListener('submit', crearUsuario);
  $('#u-admin').addEventListener('change', ev => { $('#u-permisos-detalle').style.display = ev.target.checked ? 'none' : ''; });
  $('#usuarios-list').addEventListener('change', ev => {
    const cb = ev.target.closest('[data-perm]');
    if (cb) cambiarPermiso(cb.dataset.uid, cb.dataset.perm, cb.checked);
  });
  $('#usuarios-list').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-borrar-usuario]');
    if (btn) borrarUsuario(btn.dataset.borrarUsuario);
  });
}

/* ====== Inicio ====== */
async function iniciarLocal() {
  try {
    creditos = await DB.getAll();
    clientes = await DB.getAllClientes();
    ordenarClientes();
  } catch (e) {
    toast('❌ No se pudo abrir la base de datos local');
    creditos = [];
    clientes = [];
  }
  cargarSeguridad();
  llenarSelectClientes();
  renderClientes();
  render();
  avisoAlAbrir();
}

async function iniciar() {
  cargarSettings();
  inicializarEventos();
  render();

  if (configNubeValida()) {
    try {
      await iniciarNube();
    } catch (e) {
      console.error('No se pudo iniciar Firebase:', e);
      banner('⚠️ Sin conexión con la nube por ahora. Trabajando en modo local en este dispositivo.');
      await iniciarLocal();
    }
  } else {
    banner('📱 Modo local: los datos solo se guardan en este dispositivo. Configura Firebase (ver README) para sincronizar con la nube.');
    await iniciarLocal();
  }

  // Pide almacenamiento persistente para que el navegador no borre los datos
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  // Registra el service worker para funcionar sin internet e instalarse como app
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

iniciar();
