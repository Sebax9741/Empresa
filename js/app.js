/* ====== Estado global ====== */
let creditos = [];
let settings = {
  dias: 30,
  moneda: '$',
};
let vencimientoEditadoManual = false;

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

/* Comprime la imagen para que no ocupe demasiado espacio */
function procesarImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const escala = Math.min(MAX / width, MAX / height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
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
    await DB.put(credito);
  } catch (e) {
    toast('❌ Error al guardar. Revisa el espacio disponible.');
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
  await DB.delete(id);
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
    if (!confirm(`El respaldo contiene ${datos.creditos.length} créditos.\n¿Reemplazar TODOS los datos actuales con el respaldo?`)) return;
    await DB.clear();
    for (const c of datos.creditos) await DB.put(c);
    creditos = datos.creditos;
    if (datos.settings) { settings = { ...settings, ...datos.settings }; guardarSettings(); }
    render();
    toast('⬆️ Respaldo importado correctamente');
  } catch (e) {
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
    $('#modal-settings').showModal();
  });
  $('#btn-settings-cerrar').addEventListener('click', () => $('#modal-settings').close());
  $('#settings-form').addEventListener('submit', ev => {
    ev.preventDefault();
    settings.dias = Math.max(1, Number($('#s-dias').value) || 30);
    settings.moneda = $('#s-moneda').value.trim() || '$';
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
}

/* ====== Inicio ====== */
async function iniciar() {
  cargarSettings();
  inicializarEventos();
  try {
    creditos = await DB.getAll();
  } catch (e) {
    toast('❌ No se pudo abrir la base de datos local');
    creditos = [];
  }
  render();

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
