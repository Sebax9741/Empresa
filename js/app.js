/* ====== Estado global ====== */
let creditos = [];
let settings = {
  dias: 30,
  moneda: '$',
  avisos: true,
};
let vencimientoEditadoManual = false;

/* Modo nube (Firebase) */
let modoNube = false;
let fb = null;            // SDK y referencias de Firebase
let unsubSnapshot = null; // cancela la suscripción en tiempo real
let migracionRevisada = false;

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
function hojaCobranza(lista, fechaISO) {
  const filas = [];
  const totales = { efectivo: 0, yape: 0, bcp: 0, total: 0 };
  for (const c of lista) {
    for (const a of abonosDe(c)) {
      if (a.fecha !== fechaISO) continue;
      const monto = Number(a.monto) || 0;
      const metodo = metodoDe(a);
      filas.push({ boleta: c.boleta, cliente: c.cliente, zona: c.zona || '', monto, metodo });
      totales[metodo] += monto;
      totales.total += monto;
    }
  }
  filas.sort((x, y) => String(x.boleta).localeCompare(String(y.boleta), undefined, { numeric: true }));
  return { filas, totales };
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

/* ====== Configuración ====== */
function cargarSettings() {
  try {
    const guardado = JSON.parse(localStorage.getItem('creditos-settings'));
    if (guardado) settings = { ...settings, ...guardado };
  } catch (e) { /* usar valores por defecto */ }
}

function guardarSettings() {
  localStorage.setItem('creditos-settings', JSON.stringify(settings));
}

/* ====== Almacenamiento: nube o local ====== */
function configNubeValida() {
  const cfg = window.FIREBASE_CONFIG;
  return EMULADOR || (cfg && cfg.apiKey && !String(cfg.apiKey).startsWith('PEGA'));
}

async function guardarEnStore(credito) {
  if (modoNube) {
    const uid = fb.auth.currentUser.uid;
    await fb.setDoc(fb.doc(fb.db, 'usuarios', uid, 'creditos', credito.id), credito);
  } else {
    await DB.put(credito);
  }
}

async function eliminarDeStore(id) {
  if (modoNube) {
    const uid = fb.auth.currentUser.uid;
    await fb.deleteDoc(fb.doc(fb.db, 'usuarios', uid, 'creditos', id));
  } else {
    await DB.delete(id);
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
    auth, db,
    collection: fsMod.collection,
    doc: fsMod.doc,
    setDoc: fsMod.setDoc,
    deleteDoc: fsMod.deleteDoc,
    onSnapshot: fsMod.onSnapshot,
    signIn: authMod.signInWithEmailAndPassword,
    registrar: authMod.createUserWithEmailAndPassword,
    recuperar: authMod.sendPasswordResetEmail,
    salir: authMod.signOut,
  };
  modoNube = true;

  authMod.onAuthStateChanged(auth, usuario => {
    if (usuario) {
      $('#auth-screen').hidden = true;
      $('#settings-cuenta').hidden = false;
      $('#cuenta-email').textContent = usuario.email;
      banner(null);
      suscribirNube(usuario.uid);
    } else {
      if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
      creditos = [];
      migracionRevisada = false;
      render();
      $('#settings-cuenta').hidden = true;
      setModoAuth(false); // vuelve a la pantalla de "Iniciar sesión"
      $('#auth-screen').hidden = false;
    }
  });
}

function suscribirNube(uid) {
  if (unsubSnapshot) unsubSnapshot();
  const coleccion = fb.collection(fb.db, 'usuarios', uid, 'creditos');
  unsubSnapshot = fb.onSnapshot(coleccion, snap => {
    creditos = snap.docs.map(d => d.data());
    render();
    avisoAlAbrir();
    ofrecerMigracionLocal(uid);
  }, err => {
    console.error('Error de sincronización:', err);
    banner('⚠️ Error de sincronización con la nube. Revisa tu conexión o las reglas de Firestore.');
  });
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

/* ====== Autenticación ====== */
let modoRegistro = false;

const ERRORES_AUTH = {
  'auth/invalid-email': 'El correo no es válido.',
  'auth/user-not-found': 'No existe una cuenta con ese correo.',
  'auth/wrong-password': 'Contraseña incorrecta.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Usa "Iniciar sesión".',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/network-request-failed': 'Sin conexión a internet. Inténtalo de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/missing-password': 'Escribe tu contraseña.',
};

function errorAuth(e) {
  const el = $('#auth-error');
  el.textContent = ERRORES_AUTH[e.code] || `Error: ${e.message}`;
  el.hidden = false;
}

function setModoAuth(registro) {
  modoRegistro = registro;
  $('#auth-error').hidden = true;
  $('#btn-auth-principal').textContent = modoRegistro ? 'Crear cuenta' : 'Iniciar sesión';
  $('#auth-subtitle').textContent = modoRegistro
    ? 'Crea tu cuenta (solo necesitas hacerlo una vez)'
    : 'Inicia sesión para ver tus créditos en todos tus dispositivos';
  $('#btn-auth-alternar').textContent = modoRegistro
    ? '¿Ya tienes cuenta? Iniciar sesión'
    : '¿No tienes cuenta? Crear cuenta nueva';
}

async function enviarAuth(ev) {
  ev.preventDefault();
  $('#auth-error').hidden = true;
  const email = $('#a-email').value.trim();
  const pass = $('#a-pass').value;
  const boton = $('#btn-auth-principal');
  boton.disabled = true;
  try {
    if (modoRegistro) {
      await fb.registrar(fb.auth, email, pass);
      toast('✅ Cuenta creada. ¡Bienvenido!');
    } else {
      await fb.signIn(fb.auth, email, pass);
    }
    $('#a-pass').value = '';
  } catch (e) {
    errorAuth(e);
  } finally {
    boton.disabled = false;
  }
}

async function recuperarContrasena() {
  const email = $('#a-email').value.trim();
  if (!email) {
    errorAuth({ code: 'auth/invalid-email' });
    return;
  }
  try {
    await fb.recuperar(fb.auth, email);
    toast(`📧 Te enviamos un correo a ${email} para restablecer tu contraseña`);
  } catch (e) {
    errorAuth(e);
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
  renderTabla(lista);
  renderTarjetas(lista);
  renderFlechas();
  actualizarDatalist();
  actualizarContadorFiltro();
  $('#empty-state').hidden = creditos.length > 0;
  sincronizarAvisos();
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
          <button class="btn btn-secondary btn-small" data-editar="${c.id}">✏️</button>
          <button class="btn btn-danger btn-small" data-borrar="${c.id}">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderTarjetas(lista) {
  const cont = $('#cards');
  cont.innerHTML = lista.map(c => `
    <article class="card">
      <div class="card-main">
        <p class="card-title">${escapeHtml(c.cliente)}</p>
        <p class="card-sub">Boleta Nº ${escapeHtml(c.boleta)} · ${formatoFecha(c.fecha)}</p>
        ${c.zona ? `<span class="card-zona">📍 ${escapeHtml(c.zona)}</span>` : ''}
        <p class="card-monto">${formatoMonto(c.monto)}</p>
        ${saldoDe(c) > 0
          ? `<p class="card-saldo">Saldo: <strong>${formatoMonto(saldoDe(c))}</strong></p>`
          : `<p class="card-saldo">✅ Pagado completo</p>`}
        <p class="card-venc">Vence: ${textoVencimiento(c)}</p>
      </div>
      <div class="card-side">
        ${badgeEstado(c)}
        ${c.foto ? `<img src="${c.foto}" class="thumb" alt="Boleta ${c.boleta}" data-ver-foto="${c.id}">` : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-small" data-editar="${c.id}">✏️ Editar</button>
        <button class="btn btn-danger btn-small" data-borrar="${c.id}">🗑️ Borrar</button>
      </div>
    </article>
  `).join('');
}

function renderFlechas() {
  const [campo, dir] = $('#sort-by').value.split('-');
  document.querySelectorAll('.credit-table th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    arrow.textContent = th.dataset.sort === campo ? (dir === 'asc' ? '▲' : '▼') : '';
  });
}

function actualizarDatalist() {
  const nombres = [...new Set(creditos.map(c => c.cliente))].sort();
  $('#clientes-list').innerHTML = nombres.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ====== Formulario ====== */
const modalForm = $('#modal-form');
let fotoActual = null;
let abonosActuales = [];   // abonos "a cuenta" en edición

function abrirFormulario(credito = null) {
  $('#credit-form').reset();
  fotoActual = null;
  abonosActuales = [];
  vencimientoEditadoManual = false;
  $('#foto-preview-wrap').hidden = true;
  $('#abono-nuevo').hidden = true;
  $('#f-zona').value = credito ? (credito.zona || '') : '';

  if (credito) {
    $('#form-title').textContent = `Editar crédito — Boleta ${credito.boleta}`;
    $('#f-id').value = credito.id;
    $('#f-boleta').value = credito.boleta;
    $('#f-cliente').value = credito.cliente;
    $('#f-monto').value = credito.monto;
    $('#f-fecha').value = credito.fecha;
    $('#f-vencimiento').value = credito.vencimiento;
    $('#f-notas').value = credito.notas || '';
    vencimientoEditadoManual = true; // no recalcular al editar
    if (credito.foto) {
      fotoActual = credito.foto;
      mostrarPreview(credito.foto);
    }
    // Al editar: mostrar abonos y ocultar "pago inicial"
    abonosActuales = abonosDe(credito).map(a => ({ monto: Number(a.monto) || 0, fecha: a.fecha || '', metodo: metodoDe(a) }));
    $('#field-pago-inicial').hidden = true;
    $('#abonos-box').hidden = false;
    renderAbonos();
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

/* Dibuja la lista de abonos "a cuenta" y el saldo pendiente en el formulario. */
function renderAbonos() {
  const cont = $('#abonos-list');
  if (!abonosActuales.length) {
    cont.innerHTML = '<p class="abonos-vacio">Aún no hay pagos a cuenta.</p>';
  } else {
    cont.innerHTML = abonosActuales.map((a, i) => `
      <div class="abono-item">
        <span>ACUENTA ${i + 1}: <strong>${formatoMonto(a.monto)}</strong>
          <span class="abono-fecha">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'} · ${metodoLabel(metodoDe(a))}</span></span>
        <button type="button" data-quitar-abono="${i}" title="Quitar este pago">🗑️</button>
      </div>`).join('');
  }
  const monto = Number($('#f-monto').value) || 0;
  const abonado = abonosActuales.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const saldo = Math.max(0, monto - abonado);
  const el = $('#saldo-valor');
  el.textContent = formatoMonto(saldo);
  el.classList.toggle('saldo-cero', saldo <= 0);

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
  abonosActuales.push({ monto, fecha: $('#abono-fecha').value || hoyISO(), metodo: $('#abono-metodo').value });
  $('#abono-nuevo').hidden = true;
  $('#btn-agregar-abono').hidden = false;
  renderAbonos();
}

function mostrarPreview(dataURL) {
  $('#foto-preview').src = dataURL;
  $('#foto-preview-wrap').hidden = false;
}

/* Abre la foto de la boleta a pantalla completa, con opción de descargar. */
function abrirVisorImagen(credito) {
  $('#imagen-grande').src = credito.foto;
  const enlace = $('#btn-descargar-imagen');
  enlace.href = credito.foto;
  const nombre = String(credito.boleta || 'foto').replace(/[^\w.-]/g, '_');
  enlace.download = `boleta-${nombre}.jpg`;
  $('#modal-imagen').showModal();
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
        if (resultado.length < 900000) break;  // ~660 KB, holgado bajo el límite de 1 MB
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
  const { filas, totales } = hojaCobranza(creditos, fecha);

  $('#cob-totales').innerHTML = `
    <div class="cob-total-card"><span class="et">💵 Efectivo</span><span class="val">${formatoMonto(totales.efectivo)}</span></div>
    <div class="cob-total-card"><span class="et">📱 Yape</span><span class="val">${formatoMonto(totales.yape)}</span></div>
    <div class="cob-total-card"><span class="et">🏦 BCP</span><span class="val">${formatoMonto(totales.bcp)}</span></div>
    <div class="cob-total-card total"><span class="et">Total del día</span><span class="val">${formatoMonto(totales.total)}</span></div>`;

  $('#cob-body').innerHTML = filas.map(f => `
    <tr>
      <td><strong>${escapeHtml(f.boleta)}</strong></td>
      <td>${escapeHtml(f.cliente)}</td>
      <td>${f.zona ? escapeHtml(f.zona) : '—'}</td>
      <td class="col-num">${formatoMonto(f.monto)}</td>
      <td><span class="pago-tag pago-${f.metodo}">${metodoLabel(f.metodo)}</span></td>
    </tr>`).join('');

  $('#cob-vacio').hidden = filas.length > 0;
  $('#cob-tabla').hidden = filas.length === 0;
}

function exportarCobranzaExcel() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const { filas, totales } = hojaCobranza(creditos, fecha);
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const filasCsv = filas.map(f => [f.boleta, f.cliente, f.zona, f.monto, metodoLabel(f.metodo).replace(/[^\wáéíóúÁÉÍÓÚ ]/g, '').trim()].map(esc).join(';'));
  const lineas = [
    `Hoja de cobranza;${formatoFecha(fecha)}`,
    '',
    ['Boleta', 'Cliente', 'Zona', 'Monto', 'Pago'].map(esc).join(';'),
    ...filasCsv,
    '',
    ['', '', 'Efectivo', totales.efectivo].map(esc).join(';'),
    ['', '', 'Yape', totales.yape].map(esc).join(';'),
    ['', '', 'BCP', totales.bcp].map(esc).join(';'),
    ['', '', 'TOTAL', totales.total].map(esc).join(';'),
  ];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cobranza-${fecha}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('⬇️ Hoja de cobranza exportada');
}

function imprimirCobranza() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const { filas, totales } = hojaCobranza(creditos, fecha);
  const filasHtml = filas.map(f => `<tr>
      <td>${escapeHtml(f.boleta)}</td><td>${escapeHtml(f.cliente)}</td>
      <td>${escapeHtml(f.zona || '—')}</td><td style="text-align:right">${formatoMonto(f.monto)}</td>
      <td>${metodoLabel(f.metodo)}</td></tr>`).join('');
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
    <table><thead><tr><th>Boleta</th><th>Cliente</th><th>Zona</th><th style="text-align:right">Monto</th><th>Pago</th></tr></thead>
    <tbody>${filasHtml || '<tr><td colspan="5" style="text-align:center">Sin cobros este día</td></tr>'}</tbody></table>
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
    cliente: $('#f-cliente').value.trim(),
    zona: $('#f-zona').value,
    monto: Number($('#f-monto').value),
    fecha,
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
  if (!confirm(`¿Borrar el crédito de la boleta Nº ${c.boleta} (${c.cliente})?\nEsta acción no se puede deshacer.`)) return;
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
  const datos = { version: 1, exportado: new Date().toISOString(), settings, creditos };
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
    if (datos.settings) { settings = { ...settings, ...datos.settings }; guardarSettings(); }
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
    const editar = ev.target.closest('[data-editar]');
    const borrar = ev.target.closest('[data-borrar]');
    const verFoto = ev.target.closest('[data-ver-foto]');
    const quitarAbono = ev.target.closest('[data-quitar-abono]');
    if (editar) {
      const c = creditos.find(x => x.id === editar.dataset.editar);
      if (c) abrirFormulario(c);
    } else if (borrar) {
      borrarCredito(borrar.dataset.borrar);
    } else if (quitarAbono) {
      abonosActuales.splice(Number(quitarAbono.dataset.quitarAbono), 1);
      renderAbonos();
    } else if (verFoto) {
      const c = creditos.find(x => x.id === verFoto.dataset.verFoto);
      if (c && c.foto) abrirVisorImagen(c);
    }
  });
  $('#btn-cerrar-imagen').addEventListener('click', () => $('#modal-imagen').close());

  // Hoja de cobranza
  $('#btn-cobranza').addEventListener('click', abrirCobranza);
  $('#cob-fecha').addEventListener('change', renderCobranza);
  $('#btn-cob-cerrar').addEventListener('click', () => $('#modal-cobranza').close());
  $('#btn-cob-excel').addEventListener('click', exportarCobranzaExcel);
  $('#btn-cob-imprimir').addEventListener('click', imprimirCobranza);

  // Configuración
  $('#btn-settings').addEventListener('click', () => {
    $('#s-dias').value = settings.dias;
    $('#s-moneda').value = settings.moneda;
    $('#s-avisos').checked = settings.avisos !== false;
    $('#modal-settings').showModal();
  });
  $('#btn-settings-cerrar').addEventListener('click', () => $('#modal-settings').close());
  $('#settings-form').addEventListener('submit', ev => {
    ev.preventDefault();
    settings.dias = Math.max(1, Number($('#s-dias').value) || 30);
    settings.moneda = $('#s-moneda').value.trim() || '$';
    settings.avisos = $('#s-avisos').checked;
    guardarSettings();
    $('#modal-settings').close();
    render();
    toast('✅ Configuración guardada');
  });

  $('#btn-exportar').addEventListener('click', exportarRespaldo);
  $('#input-importar').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    if (file) importarRespaldo(file);
    ev.target.value = '';
  });

  // Autenticación (modo nube)
  $('#auth-form').addEventListener('submit', enviarAuth);
  $('#btn-auth-alternar').addEventListener('click', () => setModoAuth(!modoRegistro));
  $('#btn-auth-olvide').addEventListener('click', recuperarContrasena);
  $('#btn-logout').addEventListener('click', async () => {
    if (confirm('¿Cerrar sesión? Tus datos siguen guardados en la nube.')) {
      $('#modal-settings').close();
      await fb.salir(fb.auth);
    }
  });
}

/* ====== Inicio ====== */
async function iniciarLocal() {
  try {
    creditos = await DB.getAll();
  } catch (e) {
    toast('❌ No se pudo abrir la base de datos local');
    creditos = [];
  }
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
