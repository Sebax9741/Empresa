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

/* El estado que se muestra: si está pendiente/parcial y ya pasó la fecha → vencido */
function estadoEfectivo(c) {
  if (c.estado === 'pagado') return 'pagado';
  if (diasHastaVencimiento(c.vencimiento) < 0) return 'vencido';
  return c.estado;
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
  if (c.estado === 'pagado') return fecha;
  if (dias < 0) return `<span class="venc-alerta">${fecha} (venció hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'})</span>`;
  if (dias === 0) return `<span class="venc-alerta">${fecha} (¡vence hoy!)</span>`;
  if (dias <= 5) return `<span class="venc-pronto">${fecha} (en ${dias} día${dias === 1 ? '' : 's'})</span>`;
  return fecha;
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
function creditosVisibles() {
  const busqueda = $('#search').value.trim().toLowerCase();
  const filtroEstado = $('#filter-estado').value;
  const [campo, dir] = $('#sort-by').value.split('-');

  let lista = creditos.filter(c => {
    if (busqueda && !c.cliente.toLowerCase().includes(busqueda) && !c.boleta.toLowerCase().includes(busqueda)) return false;
    if (filtroEstado && estadoEfectivo(c) !== filtroEstado) return false;
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
      case 'monto': va = Number(a.monto); vb = Number(b.monto); break;
      case 'fecha': va = a.fecha; vb = b.fecha; break;
      case 'vencimiento': default: va = a.vencimiento; vb = b.vencimiento; break;
    }
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  });

  return lista;
}

/* ====== Render ====== */
function render() {
  const lista = creditosVisibles();
  renderResumen();
  renderTabla(lista);
  renderTarjetas(lista);
  renderFlechas();
  actualizarDatalist();
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
    const monto = Number(c.monto) || 0;
    if (e === 'pagado') {
      cobrado += monto;
    } else {
      porCobrar += monto;
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
  tbody.innerHTML = lista.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.boleta)}</strong></td>
      <td>${escapeHtml(c.cliente)}</td>
      <td class="col-num">${formatoMonto(c.monto)}</td>
      <td>${formatoFecha(c.fecha)}</td>
      <td>${textoVencimiento(c)}</td>
      <td>${badgeEstado(c)}</td>
      <td>${celdaFoto(c)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-editar="${c.id}">✏️</button>
          <button class="btn btn-danger btn-small" data-borrar="${c.id}">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderTarjetas(lista) {
  const cont = $('#cards');
  cont.innerHTML = lista.map(c => `
    <article class="card">
      <div class="card-main">
        <p class="card-title">${escapeHtml(c.cliente)}</p>
        <p class="card-sub">Boleta Nº ${escapeHtml(c.boleta)} · ${formatoFecha(c.fecha)}</p>
        <p class="card-monto">${formatoMonto(c.monto)}</p>
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

function abrirFormulario(credito = null) {
  $('#credit-form').reset();
  fotoActual = null;
  vencimientoEditadoManual = false;
  $('#foto-preview-wrap').hidden = true;

  if (credito) {
    $('#form-title').textContent = `Editar crédito — Boleta ${credito.boleta}`;
    $('#f-id').value = credito.id;
    $('#f-boleta').value = credito.boleta;
    $('#f-cliente').value = credito.cliente;
    $('#f-monto').value = credito.monto;
    $('#f-fecha').value = credito.fecha;
    $('#f-vencimiento').value = credito.vencimiento;
    $('#f-estado').value = credito.estado;
    $('#f-notas').value = credito.notas || '';
    vencimientoEditadoManual = true; // no recalcular al editar
    if (credito.foto) {
      fotoActual = credito.foto;
      mostrarPreview(credito.foto);
    }
  } else {
    $('#form-title').textContent = 'Nuevo crédito';
    $('#f-id').value = '';
    $('#f-fecha').value = hoyISO();
    $('#f-vencimiento').value = sumarDias(hoyISO(), settings.dias);
  }
  modalForm.showModal();
}

function mostrarPreview(dataURL) {
  $('#foto-preview').src = dataURL;
  $('#foto-preview-wrap').hidden = false;
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

/* Comprime la imagen. Reduce el tamaño hasta caber en un documento
   de Firestore (límite 1 MB), probando calidades cada vez menores. */
function procesarImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const intentos = [[1280, 0.8], [1024, 0.7], [800, 0.55], [640, 0.4], [480, 0.3]];
      let resultado = null;
      for (const [maxLado, calidad] of intentos) {
        resultado = comprimirImagen(img, maxLado, calidad);
        if (resultado.length < 700000) break;
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
  const credito = {
    id,
    boleta,
    cliente: $('#f-cliente').value.trim(),
    monto: Number($('#f-monto').value),
    fecha: $('#f-fecha').value,
    vencimiento: $('#f-vencimiento').value,
    estado: $('#f-estado').value,
    notas: $('#f-notas').value.trim(),
    foto: fotoActual,
    creado: existente ? existente.creado : Date.now(),
  };

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

/* ====== Eventos ====== */
function inicializarEventos() {
  $('#btn-new').addEventListener('click', () => abrirFormulario());
  $('#btn-cancelar').addEventListener('click', () => modalForm.close());
  $('#credit-form').addEventListener('submit', guardarCredito);

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

  // Búsqueda, filtro y orden
  $('#search').addEventListener('input', render);
  $('#filter-estado').addEventListener('change', render);
  $('#sort-by').addEventListener('change', render);

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

  // Acciones en filas y tarjetas (delegación)
  document.body.addEventListener('click', ev => {
    const editar = ev.target.closest('[data-editar]');
    const borrar = ev.target.closest('[data-borrar]');
    const verFoto = ev.target.closest('[data-ver-foto]');
    if (editar) {
      const c = creditos.find(x => x.id === editar.dataset.editar);
      if (c) abrirFormulario(c);
    } else if (borrar) {
      borrarCredito(borrar.dataset.borrar);
    } else if (verFoto) {
      const c = creditos.find(x => x.id === verFoto.dataset.verFoto);
      if (c && c.foto) {
        $('#imagen-grande').src = c.foto;
        $('#modal-imagen').showModal();
      }
    }
  });
  $('#btn-cerrar-imagen').addEventListener('click', () => $('#modal-imagen').close());

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
