import { descargarXlsx } from './xlsx-lite.js';

/* ====== Estado global ====== */
let creditos = [];
let clientes = [];        // base de datos de clientes: { id, nombre, zona, direccion, telefono, notas, creado }
let hojas = [];           // hojas de cobranza creadas: { fecha, creada, creadaPor, creadaEn, cerrada, cerradaPor, cerradaEn }
let despachos = [];       // despachos (viajes de reparto): { id, fecha, repartidor, carguero, notas, cerrado, creado, creadoPor, pedidos: [...] }
let repartidores = [];    // lista de repartidores (solo nombres): { id, nombre, activo, creado }
let anulados = [];        // notas de venta anuladas: { id (nº boleta), boleta, motivo, anuladoPor, anuladoEn }
let settings = {
  dias: 30,
  moneda: '$',
  avisos: true,
  atajo1: 15,   // atajo rápido 1: días después de la emisión
  atajo2: 45,   // atajo rápido 2: días después de la emisión
  // Apertura automática de la hoja de cobranza (la define el administrador,
  // vale para todo el equipo). Días: 0=Dom … 6=Sáb.
  hojaAutoActiva: false,
  hojaAutoDias: [1, 2, 3, 4, 5, 6],
  hojaAutoHora: '08:00',
  // El Dashboard lo ve siempre el administrador; a los empleados se lo
  // muestra solo si el administrador activa este ajuste.
  dashboardEmpleados: false,
};
let vencimientoEditadoManual = false;

/* Modo nube (Firebase) */
let modoNube = false;
let fb = null;            // SDK y referencias de Firebase
let unsubSnapshot = null; // cancela la suscripción en tiempo real
let unsubClientes = null; // suscripción en tiempo real de la lista de clientes
let unsubAjustes = null;  // suscripción a la configuración del negocio
let unsubSeguridad = null; // suscripción al código de seguridad
let unsubHojas = null;    // suscripción a las hojas de cobranza creadas
let unsubDespachos = null; // suscripción a los despachos (viajes de reparto)
let unsubRepartidores = null; // suscripción a la lista de repartidores
let unsubAnulados = null;     // suscripción a las notas de venta anuladas
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
const PERMISOS_TODOS = { borrar: true, editar: true, crear: true, pagos: true, cobranza: true, clientes: true, hojaCrear: true, vencimiento: true };
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

/* ====== Despachos de pedidos ======
   Cada despacho es UN pedido / una boleta que sale a reparto: cliente,
   Nº de comprobante, monto, fecha de salida y los repartidores que la llevan.
   Cuando la boleta vuelve firmada, desde el despacho se abre el formulario de
   crédito ya prellenado y ambos quedan enlazados (la foto firmada y las notas
   se guardan en el crédito). También puede marcarse "al contado" o "devuelto".
   Los despachos antiguos tipo "viaje" (con lista .pedidos) ya no se muestran. */
const TIPOS_COMPROBANTE = { boleta: 'Boleta', factura: 'Factura', nota: 'Nota de venta' };
const ESTADOS_DESPACHO = {
  reparto:  { etiqueta: '🚚 En reparto', clase: 'pedido-pendiente' },
  credito:  { etiqueta: '📄 A crédito', clase: 'pedido-credito' },
  pagado:   { etiqueta: '✅ Pagado', clase: 'pedido-pagado' },
  contado:  { etiqueta: '💵 Al contado', clase: 'pedido-contado' },
  devuelto: { etiqueta: '↩️ Devuelto', clase: 'pedido-devuelto' },
};
function estadoDespachoInfo(estado) { return ESTADOS_DESPACHO[estado] || ESTADOS_DESPACHO.reparto; }
function tipoComprobanteLabel(t) { return TIPOS_COMPROBANTE[t] || TIPOS_COMPROBANTE.boleta; }

function despachoPorId(id) { return despachos.find(d => d.id === id) || null; }
/* Un despacho "de pedido" (modelo nuevo) NO tiene lista .pedidos adentro.
   Los despachos-viaje antiguos se filtran para no mostrarse. */
function esDespachoPedido(d) { return d && !Array.isArray(d.pedidos); }
function repartidoresDe(d) { return Array.isArray(d && d.repartidores) ? d.repartidores : []; }
function repartidoresActivos() {
  return repartidores.filter(r => r.activo !== false)
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
}

/* Estado que se MUESTRA de un despacho: si ya se pasó a crédito y ese crédito
   quedó saldado (se pagó al volver al almacén), se marca como "pagado". */
function estadoDespachoEfectivo(d) {
  if (d && d.estado === 'credito' && d.creditoId) {
    const c = creditos.find(x => x.id === d.creditoId);
    if (c && estadoEfectivo(c) === 'pagado') return 'pagado';
  }
  return (d && ESTADOS_DESPACHO[d.estado]) ? d.estado : 'reparto';
}

/* N° de boleta como número, para ordenar de menor a mayor. Los que no tienen
   número (vacío o texto) van al final. */
function boletaNumero(d) {
  const n = parseInt(String((d && d.boleta) || '').replace(/\D/g, ''), 10);
  return isNaN(n) ? Infinity : n;
}

/* Ordena los despachos-pedido por N° de boleta de menor a mayor
   (3969, 3970, 3971…). Si falta uno intermedio, sigue con el siguiente. */
function despachosOrdenados() {
  return despachos.filter(esDespachoPedido).sort((a, b) =>
    boletaNumero(a) - boletaNumero(b)
    || (a.fecha || '').localeCompare(b.fecha || '')
    || (a.creado || 0) - (b.creado || 0));
}

/* Resumen de una lista de despachos: cuántos hay en cada estado y el monto total */
function resumenDespachos(lista) {
  const r = { total: lista.length, reparto: 0, credito: 0, pagado: 0, contado: 0, devuelto: 0, monto: 0 };
  for (const d of lista) {
    const e = estadoDespachoEfectivo(d);
    r[e] = (r[e] || 0) + 1;
    r.monto += Number(d.monto) || 0;
  }
  return r;
}

function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* Un empleado solo puede quitar una "a cuenta" que él mismo registró HOY.
   Las de días anteriores quedan bloqueadas: solo el administrador las toca.
   Si la hoja de cobranza de ese día ya está cerrada, ni el empleado puede
   tocarla: solo el administrador, y usando su código de seguridad. */
function puedeQuitarAbono(a) {
  if (!modoNube) return true;              // modo local: un solo dueño
  if (esAdmin()) return true;
  if (a && a.fecha && hojaCerrada(a.fecha)) return false;
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

/* ====== Hojas de cobranza: crear / cerrar ======
   La hoja de un día no existe sola: alguien con permiso tiene que crearla
   (normalmente el empleado, al empezar su día). Al terminar el día, el
   administrador la cierra: desde ahí ya no se puede agregar ni quitar
   ningún cobro de esa fecha sin su código de seguridad.
   En modo local (un solo dueño) esto no aplica: todo está permitido siempre. */
function hojaDe(fechaISO) {
  return hojas.find(h => h.fecha === fechaISO) || null;
}
function hojaExiste(fechaISO) {
  if (!modoNube) return true;
  return !!hojaDe(fechaISO);
}
function hojaCerrada(fechaISO) {
  if (!modoNube) return false;
  const h = hojaDe(fechaISO);
  return !!(h && h.cerrada);
}
/* La hora de apertura y de cierre la pone el SERVIDOR de Firebase, no el
   dispositivo: así no sirve de nada cambiar la hora del celular o la tablet.
   Mientras el dato viaja a la nube, Firestore la devuelve vacía; en cuanto
   el servidor confirma, la suscripción trae la hora real.
   En modo local (un solo dueño) se usa la del equipo, que es la única que hay. */
function marcaDeTiempo() {
  return (modoNube && fb) ? fb.serverTimestamp() : Date.now();
}

function momentoDe(ts) {
  if (!ts) return null;                                  // aún sin confirmar el servidor
  if (typeof ts.toDate === 'function') return ts.toDate();   // Timestamp de Firestore
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (typeof ts === 'number') return new Date(ts);        // hojas antiguas (hora del equipo)
  return null;
}

function fechaDeTimestamp(ts) {
  const d = momentoDe(ts);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* "29/07/2026 a las 14:32" — vacío mientras el servidor no confirme la hora */
function fechaHoraDeTimestamp(ts) {
  const d = momentoDe(ts);
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatoFecha(fechaDeTimestamp(ts))} a las ${hh}:${mm}`;
}

/* Fecha y hora en que se registró una "a cuenta". Si es un pago antiguo
   que no guardó la hora, se muestra solo la fecha. */
function textoRegistrado(a) {
  return a.registrado ? fechaHoraDeTimestamp(a.registrado) : formatoFecha(a.registradoFecha);
}

/* Solo la hora "14:32" de un timestamp. Vacío si no se guardó la hora. */
function horaDeTimestamp(ts) {
  const d = momentoDe(ts);
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function crearHojaCobranza(fechaISO) {
  if (!puede('hojaCrear')) { toast('🔒 No tienes permiso para crear la hoja de cobranza'); return; }
  if (hojaDe(fechaISO)) { toast('Esa hoja ya existe'); return; }
  const hoja = {
    fecha: fechaISO,
    creada: true,
    creadaPor: quienSoy(),
    creadaEn: marcaDeTiempo(),        // hora del servidor, no del dispositivo
    cerrada: false,
    cerradaPor: null,
    cerradaEn: null,
  };
  try {
    await guardarHojaEnStore(hoja);
    // Copia local sin la hora: la suscripción la reemplaza con la del servidor
    const local = { ...hoja, creadaEn: null };
    const i = hojas.findIndex(h => h.fecha === fechaISO);
    if (i >= 0) hojas[i] = local; else hojas.push(local);
    renderCobranza();
    toast(`✅ Hoja de cobranza del ${formatoFecha(fechaISO)} creada`);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo crear la hoja de cobranza');
  }
}

/* Si la hoja de cobranza de esa fecha todavía no existe, la abre sola en el
   momento en que alguien (administrador o empleado) registra el primer cobro
   del día: nadie tiene que crearla a mano antes de poder cobrar. Queda
   constancia de quién la abrió, igual que si la hubiera creado a propósito
   (las reglas de Firestore ya permiten que cualquier miembro del equipo cree
   la hoja del día). Devuelve true si al terminar la hoja ya existe. */
async function asegurarHojaAbierta(fechaISO, quien = quienSoy(), cuando = null) {
  if (!modoNube) return true;               // en modo local la hoja siempre "existe"
  if (hojaExiste(fechaISO)) return true;

  // Antes de escribir se confirma contra la base: si otro dispositivo ya la
  // abrió (o el administrador ya la cerró) y este equipo todavía no lo sabe,
  // no se pisa lo que ya existe. Con mala señal la consulta se abandona
  // enseguida y se sigue con la copia local: cobrar nunca se queda esperando.
  try {
    const snap = await Promise.race([
      fb.getDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'hojas', fechaISO)),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('sin respuesta')), ESPERA_NUBE)),
    ]);
    if (snap.exists()) {
      const yaEsta = { fecha: fechaISO, ...snap.data() };
      const j = hojas.findIndex(h => h.fecha === fechaISO);
      if (j >= 0) hojas[j] = yaEsta; else hojas.push(yaEsta);
      return true;
    }
  } catch (e) {
    console.warn('No se pudo comprobar la hoja en la nube (se sigue sin conexión):', e);
  }

  const hoja = {
    fecha: fechaISO,
    creada: true,
    creadaPor: quien,
    // Hora del servidor cuando la abre el cobro del momento; cuando se está
    // recuperando un día viejo, la hora real del primer cobro de ese día.
    creadaEn: cuando || marcaDeTiempo(),
    cerrada: false,
    cerradaPor: null,
    cerradaEn: null,
  };
  if (cuando) hoja.desdePrimerCobro = true;
  try {
    await guardarHojaEnStore(hoja);
    // Copia local: la suscripción la reemplaza con lo que confirme el servidor
    const local = { ...hoja, creadaEn: cuando || null };
    const i = hojas.findIndex(h => h.fecha === fechaISO);
    if (i >= 0) hojas[i] = local; else hojas.push(local);
    return true;
  } catch (e) {
    console.error('No se pudo abrir automáticamente la hoja de cobranza:', e);
    return false;
  }
}

/* Días que ya se intentaron recuperar en esta sesión (para no reintentar la
   escritura en cada redibujado de la vista). */
const hojasRecuperadas = new Set();

/* Recupera la hoja de un día que SÍ tuvo cobros pero quedó sin abrir (cobros
   registrados antes de que existiera la apertura automática, o una apertura
   que no llegó a subir). La abre a nombre de quien hizo el primer cobro de
   ese día y con la hora de ese cobro. */
function recuperarHojaDeDiaConCobros(fechaISO, filas) {
  if (!modoNube || !fechaISO || !filas.length) return;
  if (hojaExiste(fechaISO) || hojasRecuperadas.has(fechaISO)) return;
  const primero = filas.find(f => f.cobradoPor) || filas[0];
  if (!primero) return;
  hojasRecuperadas.add(fechaISO);
  asegurarHojaAbierta(fechaISO, primero.cobradoPor || 'sin registrar', primero.registrado || null)
    // Se vuelve a dibujar sí o sí: la hoja recién recuperada (o la que ya
    // estaba en la nube) tiene que verse sin que el usuario haga nada.
    .then(ok => { if (ok) renderCobranza(); })
    .catch(e => console.error('No se pudo recuperar la hoja del día:', e));
}

/* ¿Toca abrir hoy la hoja automáticamente, según lo que definió el admin? */
function debeAbrirHojaHoy() {
  if (!settings.hojaAutoActiva) return false;
  const dias = Array.isArray(settings.hojaAutoDias) ? settings.hojaAutoDias : [];
  const ahora = new Date();
  if (!dias.includes(ahora.getDay())) return false;   // 0=Dom … 6=Sáb
  const [hh, mm] = String(settings.hojaAutoHora || '08:00').split(':').map(Number);
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const minutosConfig = (hh || 0) * 60 + (mm || 0);
  return minutosAhora >= minutosConfig;
}

/* Abre la hoja de hoy sin pedir permiso (la autoriza la config del admin).
   La dispara cualquier dispositivo del equipo; el primero que cumpla la crea
   y los demás la reciben por la sincronización. */
async function revisarAperturaAutomatica() {
  if (!modoNube) return;                 // en modo local la hoja siempre "existe"
  if (!debeAbrirHojaHoy()) return;
  const hoy = hoyISO();
  if (hojaDe(hoy)) return;               // ya está creada (abierta o cerrada)
  const hoja = {
    fecha: hoy,
    creada: true,
    creadaPor: '⏰ apertura automática',
    creadaEn: marcaDeTiempo(),           // hora del servidor
    cerrada: false,
    cerradaPor: null,
    cerradaEn: null,
    auto: true,
  };
  try {
    await guardarHojaEnStore(hoja);
    const local = { ...hoja, creadaEn: null };
    const i = hojas.findIndex(h => h.fecha === hoy);
    if (i >= 0) hojas[i] = local; else hojas.push(local);
    if (!$('#view-cobranza').hidden) renderCobranza();
  } catch (e) {
    console.error('No se pudo abrir la hoja automáticamente:', e);
  }
}

async function cerrarHojaCobranza(fechaISO) {
  if (!esAdmin()) { toast('🔒 Solo el administrador puede cerrar la hoja de cobranza'); return; }
  const h = hojaDe(fechaISO);
  if (!h) { toast('Esta hoja todavía no se ha creado'); return; }
  if (h.cerrada) { toast('Esta hoja ya está cerrada'); return; }
  if (!confirm(`¿Cerrar la hoja de cobranza del ${formatoFecha(fechaISO)}?\nYa no se podrá agregar ni quitar cobros de ese día sin tu código de seguridad.`)) return;
  try {
    await actualizarHojaEnStore(fechaISO, {
      cerrada: true,
      cerradaPor: quienSoy(),
      cerradaEn: marcaDeTiempo(),        // hora del servidor, no del dispositivo
    });
    // Copia local sin la hora: la suscripción la reemplaza con la del servidor
    const i = hojas.findIndex(x => x.fecha === fechaISO);
    if (i >= 0) hojas[i] = { ...h, cerrada: true, cerradaPor: quienSoy(), cerradaEn: null };
    renderCobranza();
    toast(`🔒 Hoja de cobranza del ${formatoFecha(fechaISO)} cerrada`);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo cerrar la hoja de cobranza');
  }
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

/* Reparte los cobros del día por usuario: cuánto cobró cada uno en efectivo,
   Yape y BCP, y su total. Se ordena de mayor a menor total; los cobros sin
   usuario (créditos antiguos) se agrupan al final como "sin registrar". */
function cobrosPorUsuario(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const quien = f.cobradoPor || '(sin registrar)';
    const u = mapa.get(quien) || { usuario: quien, efectivo: 0, yape: 0, bcp: 0, total: 0 };
    u[f.metodo] = (u[f.metodo] || 0) + f.monto;
    u.total += f.monto;
    mapa.set(quien, u);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total
    || a.usuario.localeCompare(b.usuario, 'es'));
}

/* Todos los días que tienen cobros, del más reciente al más antiguo.
   Incluye también las hojas ya creadas aunque todavía no tengan cobros. */
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
  for (const h of hojas) {
    if (!dias.has(h.fecha)) dias.set(h.fecha, { fecha: h.fecha, pagos: 0, total: 0 });
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
  // Los formularios se abren con showModal(): el navegador los pinta en su
  // "capa superior", por encima de todo lo demás. Si el aviso se queda en el
  // <body> queda TAPADO por el formulario y el usuario no ve el motivo por el
  // que no se pudo guardar. Por eso se mete dentro del cuadro abierto.
  const abierto = document.querySelector('dialog[open]');
  const destino = abierto || document.body;
  if (el.parentElement !== destino) destino.appendChild(el);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function banner(msg) {
  const el = $('#banner');
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.hidden = true; }
}

/* ====== Aviso de conexión ======
   La app funciona igual sin internet: Firestore guarda todo en el dispositivo
   y lo sube solo al reconectar. Este aviso es para que el empleado sepa en
   qué estado está y no piense que se perdió su trabajo. */
let cambiosPendientes = false;   // hay cambios guardados aquí que aún no subieron
let datosDesdeCache = true;      // true = todavía no hay conexión viva con el servidor
let avisarConexionServidor = null;  // se llama en cuanto llegan datos del servidor

/* Los datos llegan del servidor (no de la copia local): hay conexión de verdad */
function marcarOrigenDatos(snap) {
  datosDesdeCache = snap.metadata.fromCache;
  if (!datosDesdeCache) {
    // Queda constancia de la última vez que este equipo se puso al día
    try { localStorage.setItem('creditos-ultima-sync', String(Date.now())); } catch (e) { /* sin espacio */ }
    if (avisarConexionServidor) avisarConexionServidor();
  }
}

function ultimaSincronizacion() {
  const v = Number(localStorage.getItem('creditos-ultima-sync'));
  return v > 0 ? v : null;
}

function actualizarAvisoConexion() {
  const el = $('#banner-conexion');
  if (!modoNube) { el.hidden = true; return; }
  const texto = $('#banner-conexion-texto');
  const sinInternet = navigator.onLine === false;
  if (sinInternet) {
    texto.textContent = cambiosPendientes
      ? '📴 Sin internet — puedes seguir trabajando; hay cambios guardados aquí que se subirán solos al volver la conexión'
      : '📴 Sin internet — puedes seguir trabajando normalmente; todo se guarda en este dispositivo';
    el.className = 'banner banner-conexion banner-sin-internet';
    el.hidden = false;
  } else if (cambiosPendientes) {
    texto.textContent = '🔄 Subiendo a la nube los cambios hechos sin internet…';
    el.className = 'banner banner-conexion banner-subiendo';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/* ====== Sincronizar ahora ======
   No "refresca" datos (los cambios ya llegan solos y al instante): lo que hace
   es cortar y rehacer la conexión con la nube. Sirve para el caso real de la
   calle en que la tablet cree que tiene internet pero la conexión quedó
   muerta, y los cambios se quedan esperando sin motivo. */
const LIMITE_SINCRONIZAR = 8000;   // ms que damos para que reaccione

/* Espera a que lleguen datos del servidor (no de la copia local) */
function esperarConexionServidor(limite) {
  if (!datosDesdeCache) return Promise.resolve(true);
  return new Promise(resolve => {
    const reloj = setTimeout(() => { avisarConexionServidor = null; resolve(false); }, limite);
    avisarConexionServidor = () => { clearTimeout(reloj); avisarConexionServidor = null; resolve(true); };
  });
}

/* ====== ¿Está la tablet lista para trabajar sin internet? ======
   Sirve para comprobarlo ANTES de salir a la calle, sin tener que adivinar.
   Cada punto es una de las cosas que la app necesita tener guardadas aquí. */
function renderEstadoOffline() {
  const caja = $('#settings-offline');
  if (!modoNube) { caja.hidden = true; return; }
  caja.hidden = false;

  const hayAcceso = !!(fb && fb.auth && fb.auth.currentUser && leerAccesoLocal(fb.auth.currentUser.uid));
  const sync = ultimaSincronizacion();
  const puntos = [
    {
      ok: hayAcceso,
      si: 'Puedes entrar a la app sin internet',
      no: 'Falta entrar una vez CON internet para poder entrar luego sin señal',
    },
    {
      ok: creditos.length > 0,
      si: `${creditos.length} crédito(s) guardados en esta tablet`,
      no: 'No hay créditos guardados en esta tablet',
    },
    {
      ok: clientes.length > 0,
      si: `${clientes.length} cliente(s) guardados en esta tablet`,
      no: 'No hay clientes guardados en esta tablet',
    },
    {
      ok: !!sync,
      si: `Última vez al día con la nube: ${sync ? fechaHoraDeTimestamp(sync) : ''}`,
      no: 'Todavía no se ha puesto al día con la nube',
    },
  ];

  $('#offline-lista').innerHTML = puntos.map(p =>
    `<li class="${p.ok ? 'offline-ok' : 'offline-falta'}">${p.ok ? '✅' : '⚠️'} ${escapeHtml(p.ok ? p.si : p.no)}</li>`).join('');
}

/* Fuerza ponerse al día y vuelve a comprobar el estado */
async function prepararOffline() {
  const boton = $('#btn-preparar-offline');
  boton.disabled = true;
  boton.textContent = '⏳ Comprobando…';
  try {
    if (navigator.onLine === false) {
      toast('📴 Necesitas internet para preparar la tablet. Conéctate y vuelve a intentarlo.');
      return;
    }
    await fb.disableNetwork(fb.db);
    datosDesdeCache = true;
    await fb.enableNetwork(fb.db);
    const conectado = await esperarConexionServidor(LIMITE_SINCRONIZAR);
    // Deja también guardado el acceso, por si se inició sesión con una versión anterior
    if (fb.auth.currentUser && ownerUid && yo) guardarAccesoLocal(fb.auth.currentUser.uid, { ownerUid, yo });
    renderEstadoOffline();
    toast(conectado
      ? '✅ Tablet lista para trabajar sin internet'
      : '⚠️ No se pudo hablar con la nube. Revisa tu conexión y vuelve a intentarlo.');
  } catch (e) {
    console.error('No se pudo preparar el uso sin internet:', e);
    toast('⚠️ No se pudo comprobar. Revisa tu conexión.');
  } finally {
    boton.disabled = false;
    boton.textContent = '🔄 Comprobar y preparar para usar sin internet';
  }
}

async function sincronizarAhora() {
  if (!modoNube) return;
  const boton = $('#btn-sincronizar');
  boton.disabled = true;
  boton.textContent = '⏳ Sincronizando…';
  try {
    // Cortar y rehacer la conexión: despierta una conexión que quedó colgada
    await fb.disableNetwork(fb.db);
    datosDesdeCache = true;
    await fb.enableNetwork(fb.db);

    const conectado = await esperarConexionServidor(LIMITE_SINCRONIZAR);
    if (!conectado) {
      toast('⏳ Aún sin conexión: tus cambios están guardados y se subirán solos');
      return;
    }
    // Ya hay conexión: esperar a que terminen de subir los cambios pendientes
    const subidos = await Promise.race([
      fb.waitForPendingWrites(fb.db).then(() => true),
      new Promise(r => setTimeout(() => r(false), LIMITE_SINCRONIZAR)),
    ]);
    toast(subidos
      ? '✅ Todo sincronizado'
      : '⏳ Conectado, pero aún faltan cambios por subir: se subirán solos');
  } catch (e) {
    console.error('No se pudo sincronizar:', e);
    toast('⏳ No se pudo sincronizar ahora: tus cambios están guardados aquí');
  } finally {
    boton.disabled = false;
    boton.textContent = '🔄 Sincronizar ahora';
    actualizarAvisoConexion();
  }
}

/* ====== Configuración ======
   Los ajustes del negocio (días de crédito, moneda y atajos) viven en la
   nube: los pone el administrador y valen para todos los dispositivos y
   todos los usuarios. Además quedan copiados en este dispositivo, para
   que la app funcione igual sin internet.
   El aviso de vencimiento es de cada dispositivo, así que no se sube. */
const CLAVES_NEGOCIO = ['dias', 'moneda', 'atajo1', 'atajo2', 'hojaAutoActiva', 'hojaAutoDias', 'hojaAutoHora', 'dashboardEmpleados'];

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
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'ajustes'), datos), 'la configuración');
  }
}

/* Aplica los ajustes que llegan de la nube */
function aplicarAjustesNube(datos) {
  if (!datos) return;
  let cambio = false;
  for (const k of CLAVES_NEGOCIO) {
    if (datos[k] === undefined) continue;
    // Comparación por valor (los arrays/objetos no se comparan por referencia)
    const distinto = JSON.stringify(datos[k]) !== JSON.stringify(settings[k]);
    if (distinto) { settings[k] = datos[k]; cambio = true; }
  }
  if (!cambio) return;
  localStorage.setItem('creditos-settings', JSON.stringify(settings));
  actualizarAtajosVenc();
  render();
  // Si el admin acaba de activar/ajustar la apertura automática, revísala ya
  revisarAperturaAutomatica();
  if (!$('#view-settings').hidden) renderConfigHojaAuto();
  sincronizarNavLateral();
  // Si el administrador acaba de quitarle el Dashboard a los empleados y un
  // empleado lo tiene abierto en este momento, se lo saca de ahí.
  if (seccionActual === 'dashboard' && !puedeVerDashboard()) mostrarSeccion('creditos');
}

/* El Dashboard lo ve siempre el administrador (o el dueño en modo local, sin
   equipo); a los empleados se lo muestra solo si el admin activó el ajuste. */
function puedeVerDashboard() { return !modoNube || esAdmin() || !!settings.dashboardEmpleados; }

/* Apartado con el que abre la app. En computadora arranca en el Dashboard
   (resumen general); en celular arranca directo en los créditos, que es lo que
   se usa en la calle: el Dashboard queda a un toque, pero es lo secundario.
   Se usa el mismo corte que el panel lateral (1000px). */
function esPantallaDeCelular() {
  return window.matchMedia('(max-width: 999px)').matches;
}
function seccionDeInicio() {
  return (esPantallaDeCelular() || !puedeVerDashboard()) ? 'creditos' : 'dashboard';
}

/* Días de la semana para la apertura automática (Lun primero; 0=Dom … 6=Sáb) */
const DIAS_SEMANA = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']];

/* Dibuja el bloque de apertura automática en Configuración (solo admin) */
function renderConfigHojaAuto() {
  const bloque = $('#settings-hoja-auto');
  if (!bloque) return;
  bloque.hidden = !esAdmin();            // solo el administrador la configura
  if (bloque.hidden) return;
  $('#s-hoja-auto').checked = !!settings.hojaAutoActiva;
  $('#s-hoja-auto-detalle').hidden = !settings.hojaAutoActiva;
  $('#s-hoja-hora').value = settings.hojaAutoHora || '08:00';
  const activos = new Set(Array.isArray(settings.hojaAutoDias) ? settings.hojaAutoDias : []);
  $('#s-hoja-dias').innerHTML = DIAS_SEMANA.map(([n, etq]) => `
    <label class="hoja-dia${activos.has(n) ? ' activo' : ''}">
      <input type="checkbox" value="${n}" ${activos.has(n) ? 'checked' : ''}>
      <span>${etq}</span>
    </label>`).join('');
}

/* ====== Almacenamiento: nube o local ====== */
function configNubeValida() {
  const cfg = window.FIREBASE_CONFIG;
  return EMULADOR || (cfg && cfg.apiKey && !String(cfg.apiKey).startsWith('PEGA'));
}

/* ====== Escribir en la nube sin depender del internet ======
   Firestore guarda cada cambio en el dispositivo AL INSTANTE y lo sube solo
   cuando vuelve la conexión. Su promesa, en cambio, únicamente se cumple
   cuando el servidor confirma: si esperáramos siempre a eso, sin internet la
   app se quedaría colgada aunque el dato ya esté a salvo.
   Por eso esperamos la confirmación solo un momento; si no llega, seguimos
   adelante. Si más tarde el servidor rechaza el cambio (por ejemplo por
   permisos), se avisa en ese momento. */
const ESPERA_NUBE = 1500;   // ms que esperamos la confirmación del servidor

function escrituraNube(promesa, queEs) {
  let seguimosSinEsperar = false;
  const vigilada = promesa.then(() => null, e => e);

  // Aviso para el error que llega tarde (ya habíamos seguido adelante)
  vigilada.then(err => {
    if (!err) return;
    console.error(`No se pudo sincronizar ${queEs}:`, err);
    if (seguimosSinEsperar) toast(`⚠️ Un cambio no se pudo subir a la nube (${queEs})`);
  });

  return new Promise((resolve, reject) => {
    const reloj = setTimeout(() => { seguimosSinEsperar = true; resolve(); }, ESPERA_NUBE);
    vigilada.then(err => {
      if (seguimosSinEsperar) return;   // ya seguimos: del aviso se encarga el handler de arriba
      clearTimeout(reloj);
      if (err) reject(err); else resolve();
    });
  });
}

async function guardarEnStore(credito) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'creditos', credito.id), credito),
      `crédito ${credito.boleta}`);
  } else {
    await DB.put(credito);
  }
}

async function eliminarDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'creditos', id)), 'borrado de un crédito');
  } else {
    await DB.delete(id);
  }
}

async function guardarClienteEnStore(cliente) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'clientes', cliente.id), cliente),
      `cliente ${cliente.nombre}`);
  } else {
    await DB.putCliente(cliente);
  }
}

/* Las hojas de cobranza (creada/cerrada) solo existen como concepto en modo
   nube: en modo local hay un solo dueño y todo está permitido siempre. */
async function guardarHojaEnStore(hoja) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'hojas', hoja.fecha), hoja),
      `hoja del ${formatoFecha(hoja.fecha)}`);
  }
}

/* Cambia solo los campos indicados: así no se pisa la hora de apertura que
   ya puso el servidor (que este dispositivo puede no tener todavía). */
async function actualizarHojaEnStore(fechaISO, cambios) {
  if (modoNube) {
    await escrituraNube(
      fb.updateDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'hojas', fechaISO), cambios),
      `hoja del ${formatoFecha(fechaISO)}`);
  }
}

async function eliminarClienteDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'clientes', id)), 'borrado de un cliente');
  } else {
    await DB.deleteCliente(id);
  }
}

async function guardarDespachoEnStore(d) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'despachos', d.id), d),
      `despacho del ${formatoFecha(d.fecha)}`);
  } else {
    await DB.putDespacho(d);
  }
}

async function eliminarDespachoDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'despachos', id)), 'borrado de un despacho');
  } else {
    await DB.deleteDespacho(id);
  }
}

async function guardarRepartidorEnStore(r) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'repartidores', r.id), r),
      `repartidor ${r.nombre}`);
  } else {
    await DB.putRepartidor(r);
  }
}

/* Notas de venta anuladas (no llegaron a ser crédito) */
async function guardarAnuladoEnStore(a) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'anulados', a.id), a),
      `anulación de la nota ${a.boleta}`);
  } else {
    await DB.putAnulado(a);
  }
}

async function eliminarAnuladoDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'anulados', id)),
      'anulación quitada');
  } else {
    await DB.deleteAnulado(id);
  }
}

async function eliminarRepartidorDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'repartidores', id)), 'borrado de un repartidor');
  } else {
    await DB.deleteRepartidor(id);
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
  /* Caché local persistente: la app funciona sin internet y sincroniza al volver la conexión.
     Se usa "una sola pestaña" (no "múltiples pestañas"): esta app es una única
     instancia (el APK, o una pestaña de navegador), nunca varias pestañas
     compartiendo el mismo caché. Con "múltiples pestañas", si Android mata la
     app de golpe (común al quitar el internet o pasar a segundo plano) el
     caché puede quedar con el "turno" de otra pestaña que ya no existe, y al
     reabrir no logra servir los datos guardados. forceOwnership resuelve
     justamente eso: esta instancia siempre toma el control del caché. */
  const db = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({
      tabManager: fsMod.persistentSingleTabManager({ forceOwnership: true }),
    }),
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
    serverTimestamp: fsMod.serverTimestamp,
    disableNetwork: fsMod.disableNetwork,
    enableNetwork: fsMod.enableNetwork,
    waitForPendingWrites: fsMod.waitForPendingWrites,
    getAuth: authMod.getAuth,
    signIn: authMod.signInWithEmailAndPassword,
    registrar: authMod.createUserWithEmailAndPassword,
    updatePassword: authMod.updatePassword,
    salir: authMod.signOut,
    connectAuthEmulator: authMod.connectAuthEmulator,
    connectFirestoreEmulator: fsMod.connectFirestoreEmulator,
    getFunctions: sdk.getFunctions,
    httpsCallable: sdk.httpsCallable,
    connectFunctionsEmulator: sdk.connectFunctionsEmulator,
  };
  modoNube = true;

  authMod.onAuthStateChanged(auth, usuario => {
    if (usuario) sesionIniciada(usuario);
    else sesionCerrada();
  });
}

/* Copia del acceso en este dispositivo, para poder entrar sin internet.
   Solo guarda quién es el dueño y qué permisos tiene este usuario: son los
   mismos datos que la nube ya le había entregado a este equipo. */
function guardarAccesoLocal(uid, datos) {
  try { localStorage.setItem(`creditos-acceso-${uid}`, JSON.stringify(datos)); }
  catch (e) { /* sin espacio: se seguirá pidiendo a la nube */ }
}
function leerAccesoLocal(uid) {
  try { return JSON.parse(localStorage.getItem(`creditos-acceso-${uid}`)) || null; }
  catch (e) { return null; }
}

/* Al iniciar sesión: averigua el dueño (o lo crea la 1ª vez), lee la membresía
   del usuario y aplica sus permisos. Si no es miembro, deniega el acceso.
   Sin internet se usa la copia guardada en este dispositivo. */
async function sesionIniciada(usuario) {
  try {
    const cfgRef = fb.doc(fb.db, 'config', 'app');
    let cfgSnap = await fb.getDoc(cfgRef);

    if (!cfgSnap.exists()) {
      // Ojo: sin internet, "no existe" puede significar solo que este equipo
      // todavía no lo tiene. Dar de alta a un dueño aquí convertiría en
      // administrador a cualquiera que abra la app sin conexión, así que el
      // alta inicial solo se hace con una respuesta confirmada del servidor.
      if (cfgSnap.metadata.fromCache) {
        if (entrarConAccesoGuardado(usuario)) return;
        banner('📴 Sin internet y sin datos guardados en este dispositivo. Conéctate una vez para poder usar la app aquí.');
        return;
      }
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
      // Sin internet y sin la ficha en este equipo: no se puede afirmar que
      // haya perdido el acceso, así que no se le cierra la sesión.
      if (miDoc.metadata.fromCache) {
        if (entrarConAccesoGuardado(usuario)) return;
        banner('📴 Sin internet y sin datos guardados en este dispositivo. Conéctate una vez para poder usar la app aquí.');
        return;
      }
      // Autenticado pero sin permiso: no es miembro del negocio
      await fb.salir(fb.auth);
      $('#auth-error').textContent = 'Tu usuario no tiene acceso. Pídele al administrador que te dé de alta.';
      $('#auth-error').hidden = false;
      return;
    }
    yo = miDoc.data();
    guardarAccesoLocal(usuario.uid, { ownerUid, yo });   // para poder entrar sin internet
  } catch (e) {
    console.error('Error al iniciar sesión:', e);
    // Sin internet, la copia de este dispositivo permite seguir trabajando
    if (entrarConAccesoGuardado(usuario)) return;
    banner('⚠️ No se pudo verificar tu acceso. Revisa las reglas de Firestore o tu conexión.');
    return;
  }

  abrirSesionEnPantalla();
}

/* Entra con la copia guardada en el dispositivo (modo sin internet).
   Devuelve false si este equipo todavía no tiene esa copia. */
function entrarConAccesoGuardado(usuario) {
  const guardado = leerAccesoLocal(usuario.uid);
  if (!guardado || !guardado.ownerUid || !guardado.yo) return false;
  ownerUid = guardado.ownerUid;
  yo = guardado.yo;
  abrirSesionEnPantalla();
  toast('📴 Sin internet: trabajando con los datos de este dispositivo');
  return true;
}

function abrirSesionEnPantalla() {
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
  if (unsubHojas) { unsubHojas(); unsubHojas = null; }
  if (unsubDespachos) { unsubDespachos(); unsubDespachos = null; }
  if (unsubRepartidores) { unsubRepartidores(); unsubRepartidores = null; }
  if (unsubAnulados) { unsubAnulados(); unsubAnulados = null; }
  creditos = [];
  clientes = [];
  hojas = [];
  despachos = [];
  repartidores = [];
  anulados = [];
  ownerUid = null;
  yo = null;
  migracionRevisada = false;
  cambiosPendientes = false;
  datosDesdeCache = true;
  avisarConexionServidor = null;
  actualizarAvisoConexion();
  render();
  $('#settings-cuenta').hidden = true;
  $('#usuario-chip').hidden = true;
  $('#auth-screen').hidden = false;
}

async function cerrarSesion() {
  if (confirm('¿Cerrar sesión?')) {
    mostrarSeccion('creditos');
    await fb.salir(fb.auth);
  }
}

function suscribirNube() {
  if (unsubSnapshot) unsubSnapshot();
  const coleccion = fb.collection(fb.db, 'usuarios', ownerUid, 'creditos');
  // includeMetadataChanges: sin esto Firestore solo avisa cuando cambian los
  // datos, y nunca sabríamos que un cambio ya terminó de subir ni que se
  // recuperó la conexión (el aviso de "subiendo…" se quedaría pegado).
  unsubSnapshot = fb.onSnapshot(coleccion, { includeMetadataChanges: true }, snap => {
    creditos = snap.docs.map(d => d.data());
    // hasPendingWrites: hay cambios guardados aquí que aún no llegaron al servidor
    cambiosPendientes = snap.metadata.hasPendingWrites;
    marcarOrigenDatos(snap);
    actualizarAvisoConexion();
    render();
    avisoAlAbrir();
    if (esAdmin()) ofrecerMigracionLocal(ownerUid);
  }, err => {
    console.error('Error de sincronización:', err);
    // Sin internet esto es normal: no hay que asustar con un error
    if (navigator.onLine === false) { actualizarAvisoConexion(); return; }
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

  if (unsubHojas) unsubHojas();
  unsubHojas = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'hojas'), snap => {
    hojas = snap.docs.map(d => d.data());
    if (!$('#view-cobranza').hidden) renderCobranza();
    revisarAperturaAutomatica();
  }, err => {
    console.error('Error al sincronizar las hojas de cobranza:', err);
  });

  if (unsubDespachos) unsubDespachos();
  unsubDespachos = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'despachos'), snap => {
    despachos = snap.docs.map(d => d.data());
    if (!$('#view-despachos').hidden) renderDespachos();
  }, err => {
    console.error('Error al sincronizar los despachos:', err);
  });

  if (unsubRepartidores) unsubRepartidores();
  unsubRepartidores = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'repartidores'), snap => {
    repartidores = snap.docs.map(d => d.data());
    if (!$('#view-despachos').hidden) renderDespachos();
  }, err => {
    console.error('Error al sincronizar los repartidores:', err);
  });

  if (unsubAnulados) unsubAnulados();
  unsubAnulados = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'anulados'), snap => {
    anulados = snap.docs.map(d => d.data());
    render();
  }, err => {
    console.error('Error al sincronizar las notas anuladas:', err);
  });
}

/* Muestra/oculta botones según los permisos del usuario actual */
function aplicarPermisos() {
  $('#btn-new').hidden = !puede('crear');
  $('#btn-dashboard').hidden = !puedeVerDashboard();
  $('#btn-cobranza').hidden = !puede('cobranza');
  $('#btn-despachos').hidden = !puede('despachos');
  $('#btn-usuarios').hidden = !esAdmin();
  $('#btn-cliente-nuevo').hidden = !puede('clientes');
  $('#usuario-chip').hidden = !modoNube;
  const nombreUsuario = (yo && (yo.nombre || yo.usuario)) || '';
  $('#hdr-usuario').textContent = nombreUsuario;
  $('#hdr-avatar').textContent = inicialesDe(nombreUsuario);
  sincronizarNavLateral();
  // Un empleado sin acceso al Dashboard no debe quedarse viéndolo tras entrar
  if (seccionActual === 'dashboard' && !puedeVerDashboard()) mostrarSeccion('creditos');
  render(); // redibuja la tabla para aplicar permisos de editar/borrar
}

/* El panel lateral (escritorio) refleja los mismos permisos que la cabecera */
function sincronizarNavLateral() {
  const items = {
    'nav-dashboard': puedeVerDashboard(),
    'nav-despachos': puede('despachos'),
    'nav-clientes': true,
    'nav-cobranza': puede('cobranza'),
    'nav-usuarios': esAdmin(),
  };
  for (const [id, visible] of Object.entries(items)) {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  }
}

/* ====== Router de apartados (cada uno es una sección de página, no un modal) ====== */
const SECCIONES = ['dashboard', 'creditos', 'despachos', 'clientes', 'cobranza', 'usuarios', 'settings'];
let seccionActual = 'dashboard';

function mostrarSeccion(nombre) {
  if (!SECCIONES.includes(nombre)) nombre = 'creditos';
  // El Dashboard es solo para el administrador, salvo que lo habilite para
  // el equipo (⚙️ Configuración → Dashboard)
  if (nombre === 'dashboard' && !puedeVerDashboard()) nombre = 'creditos';
  seccionActual = nombre;
  SECCIONES.forEach(s => {
    const el = $('#view-' + s);
    if (el) el.hidden = (s !== nombre);
  });
  if (nombre === 'dashboard') renderDashboard();
  else ocultarTooltipGrafico();  // no dejar el tooltip flotando al salir del Dashboard
  // Entrada suave al cambiar de sección
  const vista = $('#view-' + nombre);
  if (vista && !prefiereMenosMovimiento()) {
    vista.classList.remove('entrando');
    void vista.offsetWidth;          // reinicia la animación
    vista.classList.add('entrando');
  }
  // El botón "＋ Nuevo crédito" solo aplica en Créditos
  const btnNew = $('#btn-new');
  if (btnNew) btnNew.hidden = (nombre !== 'creditos') || !puede('crear');
  // Resaltar el destino activo en el panel lateral y en la cabecera
  const navId = nombre === 'creditos' ? 'nav-inicio' : 'nav-' + nombre;
  if (nombre === 'dashboard' && btnNew) btnNew.hidden = true;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('activo', b.id === navId));
  const btnId = { dashboard: 'btn-dashboard', creditos: 'btn-creditos', despachos: 'btn-despachos', clientes: 'btn-clientes', cobranza: 'btn-cobranza', usuarios: 'btn-usuarios', settings: 'btn-settings' }[nombre];
  document.querySelectorAll('.header-actions .btn-icon').forEach(b => b.classList.toggle('activo', b.id === btnId));
  window.scrollTo(0, 0);
  // La tabla solo se puede medir cuando su sección ya está visible
  // Las tablas solo se pueden medir cuando su sección ya está visible
  if (nombre === 'creditos' || nombre === 'cobranza') requestAnimationFrame(ajustarTablasFijas);
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
  ['hojaCrear', 'Crear la hoja de cobranza del día'],
  ['despachos', 'Armar despachos de reparto'],
];
// Nota: el permiso 'vencimiento' ya no se ofrece. Cambiar la fecha de
// vencimiento es solo del administrador; los empleados anotan la fecha de
// compromiso de pago, que no altera el vencimiento real del crédito.

async function abrirUsuarios() {
  if (!esAdmin()) return;
  await renderUsuarios();
  $('#u-form-nuevo').reset();
  mostrarSeccion('usuarios');
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
          ${esDueno ? '' : `<button type="button" class="btn btn-secondary btn-small" data-resetear-clave="${m.uid}" data-usuario-nombre="${escapeHtml(m.usuario || '')}" title="Poner una contraseña nueva sin necesitar la anterior">🔑 Restablecer clave</button>
          <button type="button" class="btn btn-danger btn-small" data-borrar-usuario="${m.uid}">Quitar</button>`}
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

/* Restablece la contraseña de un empleado sin necesitar la anterior.
   Solo el SDK de administrador de Firebase puede tocar la contraseña de
   otra cuenta, así que esto pasa por una Cloud Function (requiere plan
   Blaze activado y la función desplegada; ver README). */
async function restablecerContrasenaEmpleado(uid, nombreUsuario) {
  if (!esAdmin()) return;
  const nueva = prompt(`Nueva contraseña para "${nombreUsuario}" (mínimo 6 caracteres):`);
  if (nueva === null) return;
  if (nueva.length < 6) { toast('⚠️ Debe tener al menos 6 caracteres'); return; }
  try {
    const funciones = fb.getFunctions(fb.app);
    if (EMULADOR) fb.connectFunctionsEmulator(funciones, '127.0.0.1', 5001);
    const llamar = fb.httpsCallable(funciones, 'restablecerContrasenaEmpleado');
    await llamar({ ownerUid, memberUid: uid, nuevaContrasena: nueva });
    toast(`✅ Contraseña de "${nombreUsuario}" actualizada`);
  } catch (e) {
    console.error(e);
    if (e.code === 'functions/not-found' || e.code === 'functions/internal') {
      toast('❌ La función en la nube todavía no está lista (ver README: activar Blaze y desplegar)');
    } else if (e.code === 'functions/permission-denied') {
      toast('🔒 No tienes permiso para hacer esto');
    } else {
      toast('❌ No se pudo cambiar la contraseña');
    }
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

/* N° de boleta como entero (ignora ceros/letras), o null si no es numérico. */
function boletaEntera(c) {
  const n = parseInt(String((c && c.boleta) || '').replace(/\D/g, ''), 10);
  return isNaN(n) ? null : n;
}

/* Números de boleta salteados (las notas de venta que faltan crear).
   Solo se muestran los huecos CORTOS: hasta 7 números seguidos. Un salto más
   largo (por ejemplo del 3562 al 3589) es un tramo que no corresponde a esta
   secuencia y llenaría la pantalla, así que no se muestra. */
const MAX_FALTANTES = 400;
const MAX_SALTO_FALTANTE = 7;
function listaFaltantes() {
  const nums = [...new Set(creditos.map(boletaEntera).filter(n => n != null))].sort((a, b) => a - b);
  if (nums.length < 2) return [];
  const faltantes = [];
  for (let i = 1; i < nums.length; i++) {
    const prev = nums[i - 1], cur = nums[i];
    const salto = cur - prev - 1;                 // cuántos números faltan en medio
    if (salto < 1 || salto > MAX_SALTO_FALTANTE) continue;   // sin hueco o tramo largo
    for (let n = prev + 1; n < cur; n++) {
      faltantes.push(n);
      if (faltantes.length > MAX_FALTANTES) return faltantes;
    }
  }
  return faltantes;
}

/* Anulaciones: una nota de venta que no llegó a ser crédito porque se anuló */
function anuladoDe(boleta) {
  return anulados.find(a => String(a.boleta) === String(boleta)) || null;
}

/* Marca una nota de venta como anulada, con el motivo escrito por el usuario */
async function anularBoleta(boleta) {
  if (!puede('crear') && !puede('editar')) { toast('🔒 No tienes permiso para anular notas de venta'); return; }
  const previo = anuladoDe(boleta);
  const motivo = prompt(
    `Anular la nota de venta Nº ${boleta}\n\n¿Por qué se anuló? (queda registrado)`,
    previo ? (previo.motivo || '') : '');
  if (motivo === null) return;                       // canceló
  const texto = motivo.trim();
  if (!texto) { toast('⚠️ Escribe el motivo de la anulación'); return; }

  const registro = {
    id: String(boleta),
    boleta: String(boleta),
    motivo: texto,
    anuladoPor: quienSoy(),
    anuladoEn: marcaDeTiempo(),
  };
  try {
    await guardarAnuladoEnStore(registro);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar la anulación. Revisa tu conexión.');
    return;
  }
  const i = anulados.findIndex(a => String(a.boleta) === String(boleta));
  if (i >= 0) anulados[i] = registro; else anulados.push(registro);
  render();
  toast(`🚫 Nota de venta Nº ${boleta} anulada`);
}

/* Deshace la anulación (la nota vuelve a figurar como pendiente de crear) */
async function quitarAnulacion(boleta) {
  if (!puede('crear') && !puede('editar')) { toast('🔒 No tienes permiso'); return; }
  if (!confirm(`¿Quitar la anulación de la nota Nº ${boleta}?\n\nVolverá a aparecer como pendiente de crear.`)) return;
  try {
    await eliminarAnuladoDeStore(String(boleta));
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo quitar la anulación');
    return;
  }
  anulados = anulados.filter(a => String(a.boleta) !== String(boleta));
  render();
  toast('↩️ Anulación quitada');
}

/* Mezcla las filas "hueco" con la lista de créditos, ordenadas por N° de boleta,
   para que se vea la correlatividad de las notas de venta. */
function inyectarFaltantes(lista, dir) {
  const faltantes = listaFaltantes().map(n => ({ __faltante: true, boleta: String(n) }));
  if (!faltantes.length) return lista;
  const mult = dir === 'desc' ? -1 : 1;
  return [...lista, ...faltantes].sort((a, b) => {
    const na = boletaEntera(a), nb = boletaEntera(b);
    if (na == null || nb == null) return 0;
    return (na - nb) * mult;
  });
}

/* Aviso siempre visible: cuántas notas de venta faltan crear (en cualquier
   orden). Al tocarlo, ordena por N° de boleta y muestra las filas "hueco". */
function renderAvisoFaltantes() {
  const el = $('#faltantes-aviso');
  if (!el) return;
  // Las que ya se anularon no cuentan como pendientes
  const falt = listaFaltantes().filter(n => !anuladoDe(n));
  if (!falt.length) { el.hidden = true; return; }
  el.hidden = false;
  const muestra = falt.slice(0, 10).join(', ') + (falt.length > 10 ? '…' : '');
  $('#faltantes-texto').textContent =
    `⛳ Falta${falt.length === 1 ? '' : 'n'} ${falt.length} nota${falt.length === 1 ? '' : 's'} de venta por crear: ${muestra}`;
}

/* Deja la vista lista para revisar los huecos: sin filtros ni búsqueda y
   ordenada por N° de boleta ascendente. */
function revisarFaltantes() {
  $('#search').value = '';
  ['fil-estado', 'fil-zona', 'fil-mes'].forEach(clase =>
    document.querySelectorAll('.' + clase + ':checked').forEach(el => { el.checked = false; }));
  $('#fil-desde').value = '';
  $('#fil-hasta').value = '';
  $('#sort-by').value = 'boleta-asc';
  render();
  const tabla = $('.table-wrap');
  if (tabla) tabla.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      case 'despacho': va = a.fechaDespacho || ''; vb = b.fechaDespacho || ''; break;
      // "creado": orden por el momento real en que se registró el crédito
      case 'creado': va = a.creado || 0; vb = b.creado || 0; break;
      case 'vencimiento': default: va = a.vencimiento; vb = b.vencimiento; break;
    }
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    // Desempate estable: a igualdad, el creado más reciente primero
    return (b.creado || 0) - (a.creado || 0);
  });

  // Filas "hueco": cuando se ordena por N° de boleta y no hay filtros ni
  // búsqueda, se muestran las notas de venta que faltan crear (los números
  // salteados) como filas vacías, para no perder la correlatividad.
  const sinFiltros = !busqueda && !estados.length && !zonas.length && !meses.length && !desde && !hasta;
  if (campo === 'boleta' && sinFiltros) lista = inyectarFaltantes(lista, dir);

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
  renderAvisoFaltantes();
  if (!$('#view-dashboard').hidden) renderDashboard();
  // Si un crédito enlazado se pagó, el estado del despacho pasa a "pagado":
  // mantén la vista de despachos al día si está abierta.
  if (!$('#view-despachos').hidden) renderDespachos();
  $('#empty-state').hidden = creditos.length > 0;
  ajustarTablasFijas();
  sincronizarAvisos();
}

/* La fila de títulos de las tablas se queda pegada al borde de arriba de la
   pantalla, justo debajo de la cabecera de la app. Como esa cabecera cambia de
   alto según el ancho (el título se acorta, los botones se reacomodan), su
   alto se mide y se guarda en --alto-cabecera para que el CSS lo use. */
function ajustarTablasFijas() {
  const cabecera = document.querySelector('.app-header');
  if (cabecera) {
    document.documentElement.style.setProperty('--alto-cabecera', `${Math.round(cabecera.getBoundingClientRect().height)}px`);
  }
  ajustarCorrimiento('.table-wrap');      // Créditos
  ajustarCorrimiento('.cob-tabla-wrap');  // Hoja de cobranza
}

/* Con el corrimiento lateral puesto, el recuadro pasa a ser su propia zona de
   desplazamiento y los títulos ya no se pueden pegar a la pantalla. Por eso
   antes de llegar a eso se prueba a apretar la tabla, de menos a más, y se
   deja el primer aprieto con el que entra entera:

     nivel 1 → letra y relleno más justos, sin perder ninguna columna
     nivel 2 → en Créditos se va la foto de la boleta (se sigue viendo en la
               ficha ℹ️); en la hoja se estrechan cliente y "cobró"
     nivel 3 → en Créditos se van también las fechas de emisión y despacho

   Solo si ni con el nivel 3 entra se le devuelve el corrimiento lateral. Se
   mide en vez de mirar el ancho de la pantalla porque el sitio de verdad
   depende también del panel lateral: en una pantalla de 1024px el panel se
   lleva casi 300px y a la tabla le quedan 730. */
const APRIETOS = 3;
function ajustarCorrimiento(selector) {
  const wrap = document.querySelector(selector);
  if (!wrap || wrap.offsetParent === null) return;   // oculta (celular u otra sección)
  const tabla = wrap.querySelector('table');
  if (!tabla) return;
  wrap.classList.remove('tabla-corre', 'compacta-1', 'compacta-2', 'compacta-3');
  for (let n = 0; n <= APRIETOS; n++) {
    if (n > 0) wrap.classList.add('compacta-' + n);
    if (tabla.scrollWidth <= wrap.clientWidth + 1) return;   // así ya entra
  }
  wrap.classList.add('tabla-corre');
}

/* Total que deben y cantidad de créditos según lo que está filtrado ahora mismo */
function renderResumenFiltro(lista) {
  const reales = lista.filter(c => !c.__faltante);   // sin las filas "hueco"
  let debe = 0;
  for (const c of reales) debe += saldoDe(c);
  $('#filtro-resumen-cantidad').textContent = String(reales.length);
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
    // Fila "hueco": una nota de venta cuyo número falta crear todavía.
    if (c.__faltante) {
      const anul = anuladoDe(c.boleta);
      const puedeAnular = puede('crear') || puede('editar');
      // Nota de venta anulada: fila tachada, con el motivo a la vista
      if (anul) {
        const quien = anul.anuladoPor
          ? `${escapeHtml(anul.anuladoPor)}${fechaHoraDeTimestamp(anul.anuladoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(anul.anuladoEn)) : ''}`
          : '';
        return `
        <tr class="credito-anulado" title="Nota de venta anulada">
          <td><strong>${escapeHtml(c.boleta)}</strong></td>
          <td colspan="10">
            <div class="fila-especial">
              <span class="badge badge-anulado">🚫 Anulado</span>
              <span class="anulado-motivo">📝 ${escapeHtml(anul.motivo || '')}</span>
              ${quien ? `<span class="anulado-quien">🖊️ ${quien}</span>` : ''}
              ${puedeAnular ? `<span class="row-actions">
                 <button class="btn btn-secondary btn-small" data-anular="${escapeHtml(c.boleta)}" title="Cambiar el motivo">✏️</button>
                 <button class="btn btn-secondary btn-small" data-desanular="${escapeHtml(c.boleta)}" title="Quitar la anulación">↩️</button>
               </span>` : ''}
            </div>
          </td>
        </tr>`;
      }
      return `
      <tr class="credito-faltante" title="Falta crear esta nota de venta">
        <td><strong>${escapeHtml(c.boleta)}</strong></td>
        <td colspan="10">
          <div class="fila-especial">
            <span class="badge badge-faltante">⛳ Falta</span>
            <span class="faltante-msg">— nota de venta sin crear —</span>
            <span class="row-actions">
              ${puede('crear') ? `<button class="btn btn-secondary btn-small" data-crear-boleta="${escapeHtml(c.boleta)}" title="Crear esta nota de venta">➕ Crear</button>` : ''}
              ${puedeAnular ? `<button class="btn btn-secondary btn-small" data-anular="${escapeHtml(c.boleta)}" title="Marcar esta nota como anulada">🚫 Anulado</button>` : ''}
            </span>
          </div>
        </td>
      </tr>`;
    }
    const saldo = saldoDe(c);
    return `
    <tr>
      <td><strong>${escapeHtml(c.boleta)}</strong></td>
      <td>${escapeHtml(c.cliente)}</td>
      <td>${c.zona ? escapeHtml(c.zona) : '—'}</td>
      <td class="col-num">${formatoMonto(c.monto)}</td>
      <td class="col-num ${saldo > 0 ? 'saldo-pend' : 'saldo-ok'}">${saldo > 0 ? formatoMonto(saldo) : '✓'}</td>
      <td class="col-emision">${c.fecha ? formatoFecha(c.fecha) : '—'}</td>
      <td class="col-despacho">${c.fechaDespacho ? formatoFecha(c.fechaDespacho) : '—'}</td>
      <td>${textoVencimiento(c)}</td>
      <td>${badgeEstado(c)}</td>
      <td class="col-foto">${celdaFoto(c)}</td>
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
      ? ` — registrado por ${a.registradoPor} el ${textoRegistrado(a)}`
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
    if (c.__faltante) {
      const anul = anuladoDe(c.boleta);
      const puedeAnular = puede('crear') || puede('editar');
      if (anul) {
        const quien = anul.anuladoPor
          ? `${escapeHtml(anul.anuladoPor)}${fechaHoraDeTimestamp(anul.anuladoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(anul.anuladoEn)) : ''}`
          : '';
        return `
        <article class="card card-anulado">
          <div class="card-main">
            <p class="card-title">Boleta Nº ${escapeHtml(c.boleta)}</p>
            <p class="card-sub anulado-motivo">📝 ${escapeHtml(anul.motivo || '')}</p>
            ${quien ? `<p class="card-sub anulado-quien">🖊️ ${quien}</p>` : ''}
          </div>
          <div class="card-side"><span class="badge badge-anulado">🚫 Anulado</span></div>
          ${puedeAnular ? `<div class="card-actions">
            <button class="btn btn-secondary btn-small" data-anular="${escapeHtml(c.boleta)}">✏️ Motivo</button>
            <button class="btn btn-secondary btn-small" data-desanular="${escapeHtml(c.boleta)}">↩️ Quitar</button>
          </div>` : ''}
        </article>`;
      }
      return `
      <article class="card card-faltante">
        <div class="card-main">
          <p class="card-title">Boleta Nº ${escapeHtml(c.boleta)}</p>
          <p class="card-sub faltante-msg">— nota de venta sin crear —</p>
        </div>
        <div class="card-side"><span class="badge badge-faltante">⛳ Falta</span></div>
        <div class="card-actions">
          ${puede('crear') ? `<button class="btn btn-secondary btn-small" data-crear-boleta="${escapeHtml(c.boleta)}">➕ Crear</button>` : ''}
          ${puedeAnular ? `<button class="btn btn-secondary btn-small" data-anular="${escapeHtml(c.boleta)}">🚫 Anulado</button>` : ''}
        </div>
      </article>`;
    }
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
        <p class="card-sub">Boleta Nº ${escapeHtml(c.boleta)} · Emisión ${formatoFecha(c.fecha)}${c.fechaDespacho ? ` · Despacho ${formatoFecha(c.fechaDespacho)}` : ''}</p>
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

/* Iniciales para el avatar del usuario (hasta 2 letras) */
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return '?';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
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

/* Abre el recuadro de firma. Devuelve la imagen, o null si se cancela.
   En modo cobro, el botón de confirmar dice "Registrar cobro" (al firmar se
   guarda la firma y se registra el cobro de una sola vez). */
function abrirFirma(modoCobro = false) {
  const dlg = $('#modal-firma');
  $('#btn-firma-ok').textContent = modoCobro ? '✅ Registrar cobro' : 'Guardar firma';
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
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'config', 'seguridad'), seguridad),
      'el código de seguridad');
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
  $('#cli-buscar').value = '';
  const permitido = puede('clientes');
  $('#btn-cli-registrar').hidden = !permitido;
  $('#btn-cli-importar').hidden = !permitido;
  $('#btn-cli-codigos').hidden = !permitido || !clientes.some(c => !String(c.codigo || '').trim());
  renderClientes();
  mostrarSeccion('clientes');
}

/* Abre el formulario de cliente (modal) para registrar uno nuevo */
function abrirModalClienteForm() {
  if (!puede('clientes')) { toast('🔒 No tienes permiso para registrar clientes'); return; }
  limpiarFormCliente();
  $('#modal-cliente-form').showModal();
  $('#cli-nombre').focus();
}

function limpiarFormCliente() {
  $('#cli-form').reset();
  $('#cli-id').value = '';
  $('#cli-codigo').value = siguienteCodigoCliente();
  $('#cli-form-title').textContent = 'Registrar cliente';
  $('#btn-cli-guardar').textContent = '💾 Guardar cliente';
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
  $('#modal-cliente-form').showModal();
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

  $('#modal-cliente-form').close();
  limpiarFormCliente();
  renderClientes();
  llenarSelectClientes($('#f-cliente').value);
  // Si registraste el cliente nuevo mientras armabas un crédito o un despacho,
  // queda elegido automáticamente en el formulario correspondiente.
  if (!anterior) {
    if ($('#modal-form').open) seleccionarCliente(cliente.id);
    else if (!$('#view-despachos').hidden && !$('#desp-vista-form').hidden) seleccionarClienteDesp(cliente.id);
  }
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
let editandoVencimiento = false;
let editandoCompromiso = false;

function abrirInfo(credito) {
  infoCreditoId = credito.id;
  firmaPendiente = null;
  editandoVencimiento = false;
  editandoCompromiso = false;
  $('#cobro-monto').value = '';
  $('#cobro-metodo').value = 'efectivo';
  $('#firma-preview-wrap').hidden = true;
  $('#btn-firma').textContent = '✍️ Firmar y registrar cobro';
  bloquearCamposCobro(false);
  $('#btn-registrar-cobro').hidden = true;   // el cobro se registra al firmar; este queda de respaldo
  renderInfo();
  $('#modal-info').showModal();
}

/* Fila "Vence" de la ficha: con permiso, se puede cambiar la fecha ahí
   mismo (sin entrar al formulario completo de edición). Queda constancia
   de quién y cuándo la cambió por última vez. */
/* La fecha de vencimiento es SOLO del administrador: los empleados anotan la
   fecha de compromiso de pago, que no altera el vencimiento real del crédito.
   (En modo local hay un solo dueño, que puede todo.) */
function puedeCambiarVencimiento() { return !modoNube || esAdmin(); }

function filaVencimiento(c) {
  const puedeCambiar = puedeCambiarVencimiento();
  const constancia = c.vencimientoCambiadoPor
    ? `<span class="venc-constancia">🖊️ ${escapeHtml(c.vencimientoCambiadoPor)}${
        fechaHoraDeTimestamp(c.vencimientoCambiadoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(c.vencimientoCambiadoEn)) : ''}</span>`
    : '';

  if (editandoVencimiento) {
    return `<span class="venc-edit">
      <input type="date" id="venc-edit-input" class="input input-mini" value="${c.vencimiento || ''}">
      <button type="button" data-confirmar-venc title="Guardar">✓</button>
      <button type="button" data-cancelar-venc title="Cancelar">✕</button>
    </span>`;
  }
  return `${textoVencimiento(c)}${puedeCambiar
    ? ` <button type="button" class="btn-fecha-editar" data-editar-venc title="Cambiar la fecha de vencimiento">✏️</button>`
    : ''}${constancia}`;
}

/* Fila "Compromiso de pago": la fecha en que el cliente quedó en pagar lo que
   falta. La pone quien cobra (no cambia el vencimiento real del crédito), y
   queda constancia de quién la anotó y cuándo. */
function puedeCambiarCompromiso() { return puede('pagos') || puede('editar'); }

function textoCompromiso(c) {
  if (!c.compromiso) return '<span class="compromiso-vacio">— sin compromiso —</span>';
  const dias = diasHastaVencimiento(c.compromiso);
  let detalle = '';
  if (saldoDe(c) <= 0) detalle = '';
  else if (dias < 0) detalle = ` <span class="venc-alerta">(incumplido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'})</span>`;
  else if (dias === 0) detalle = ' <span class="venc-pronto">(hoy)</span>';
  else detalle = ` <span class="venc-pronto">(en ${dias} día${dias === 1 ? '' : 's'})</span>`;
  return `<strong>${formatoFecha(c.compromiso)}</strong>${detalle}`;
}

function filaCompromiso(c) {
  const constancia = c.compromisoPor
    ? `<span class="venc-constancia">🖊️ ${escapeHtml(c.compromisoPor)}${
        fechaHoraDeTimestamp(c.compromisoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(c.compromisoEn)) : ''}</span>`
    : '';
  if (editandoCompromiso) {
    return `<span class="venc-edit">
      <input type="date" id="compromiso-edit-input" class="input input-mini" value="${c.compromiso || hoyISO()}">
      <button type="button" data-confirmar-compromiso title="Guardar">✓</button>
      <button type="button" data-cancelar-compromiso title="Cancelar">✕</button>
      ${c.compromiso ? '<button type="button" data-quitar-compromiso title="Quitar el compromiso">🗑️</button>' : ''}
    </span>`;
  }
  return `${textoCompromiso(c)}${puedeCambiarCompromiso()
    ? ` <button type="button" class="btn-fecha-editar" data-editar-compromiso title="Anotar la fecha en que quedó en pagar">✏️</button>`
    : ''}${constancia}`;
}

function iniciarEdicionCompromiso() {
  if (!puedeCambiarCompromiso()) { toast('🔒 No tienes permiso para anotar el compromiso de pago'); return; }
  editandoCompromiso = true;
  renderInfo();
}

function cancelarEdicionCompromiso() {
  editandoCompromiso = false;
  renderInfo();
}

async function guardarCompromiso(nuevaFecha) {
  const c = creditos.find(x => x.id === infoCreditoId);
  if (!c) { cancelarEdicionCompromiso(); return; }
  if ((nuevaFecha || '') === (c.compromiso || '')) { cancelarEdicionCompromiso(); return; }

  const actualizado = { ...c, compromiso: nuevaFecha || null };
  if (nuevaFecha) {
    actualizado.compromisoPor = quienSoy();
    actualizado.compromisoEn = marcaDeTiempo();
  } else {
    actualizado.compromisoPor = null;
    actualizado.compromisoEn = null;
  }
  try {
    await guardarEnStore(actualizado);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar el compromiso de pago');
    return;
  }
  const i = creditos.findIndex(x => x.id === c.id);
  if (i >= 0) creditos[i] = actualizado;
  editandoCompromiso = false;
  render();
  renderInfo();
  toast(nuevaFecha ? '🤝 Compromiso de pago anotado' : '🗑️ Compromiso de pago quitado');
}

function iniciarEdicionVencimiento() {
  if (!puedeCambiarVencimiento()) {
    toast('🔒 Solo el administrador cambia el vencimiento. Usa “Compromiso” para anotar cuándo pagará.');
    return;
  }
  editandoVencimiento = true;
  renderInfo();
}

function cancelarEdicionVencimiento() {
  editandoVencimiento = false;
  renderInfo();
}

async function confirmarEdicionVencimiento() {
  const c = creditos.find(x => x.id === infoCreditoId);
  const nuevaFecha = $('#venc-edit-input').value;
  if (!c || !nuevaFecha) { cancelarEdicionVencimiento(); return; }
  if (nuevaFecha === c.vencimiento) { cancelarEdicionVencimiento(); return; }

  const actualizado = {
    ...c,
    vencimiento: nuevaFecha,
    vencimientoCambiadoPor: quienSoy(),
    vencimientoCambiadoEn: marcaDeTiempo(),
  };
  try {
    await guardarEnStore(actualizado);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar el vencimiento');
    return;
  }
  const i = creditos.findIndex(x => x.id === c.id);
  if (i >= 0) creditos[i] = actualizado;
  editandoVencimiento = false;
  render();
  renderInfo();
  toast('✅ Vencimiento actualizado');
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
    ['Vence', filaVencimiento(c)],
    ['Compromiso', filaCompromiso(c)],
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
            ${abonoConFechaCambiada(a) ? '⚠️' : '🖊️'} ${escapeHtml(a.registradoPor)} · ${textoRegistrado(a)}</span>` : ''}
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

    // La hoja de cobranza de hoy no hace falta crearla a mano: se abre sola
    // con el primer cobro del día (quede quien sea que cobre). Solo si ya
    // está cerrada se bloquea el cobro (salvo al administrador).
    const hoy = hoyISO();
    const bloqueo = $('#info-cobro-bloqueo');
    let bloqueado = false;
    if (hojaExiste(hoy) && hojaCerrada(hoy) && !esAdmin()) {
      bloqueado = true;
      bloqueo.textContent = '🔒 La hoja de cobranza de hoy ya está cerrada.';
    }
    bloqueo.hidden = !bloqueado;
    $('#info-cobro-form').hidden = bloqueado;
  }
}

/* Motivo por el que NO se puede registrar el cobro ahora mismo, o null si
   todo está listo. Se usa antes de pedir la firma (para no hacer firmar en
   vano) y también como control final al registrar. */
function problemaParaCobrar(c) {
  if (!c) return '⚠️ No se encontró el crédito';
  if (!puede('pagos')) return '🔒 No tienes permiso para registrar pagos';
  const hoy = hoyISO();
  // Si la hoja de hoy todavía no existe, no bloquea: se abre sola al cobrar.
  if (hojaCerrada(hoy) && !esAdmin()) return '🔒 La hoja de cobranza de hoy ya está cerrada';
  const monto = Number($('#cobro-monto').value);
  const debe = saldoDe(c);
  if (!monto || monto <= 0) return '⚠️ Escribe el monto cobrado';
  if (monto > debe + 0.005) return `⚠️ El cliente solo debe ${formatoMonto(debe)}`;
  if (abonosDe(c).length >= MAX_ABONOS) return `⚠️ Este crédito ya tiene ${MAX_ABONOS} pagos a cuenta`;
  return null;
}

/* Bloquea/desbloquea el monto y el método (la fecha ya está fija). Se bloquean
   cuando el cliente ya firmó, para que no se puedan cambiar después. */
function bloquearCamposCobro(bloq) {
  $('#cobro-monto').disabled = bloq;
  $('#cobro-metodo').disabled = bloq;
  $('#btn-cobro-todo').disabled = bloq;
}

async function pedirFirmaCobro() {
  const c = creditos.find(x => x.id === infoCreditoId);
  // Validar TODO antes de pedir la firma: no hacer firmar al cliente en vano
  const problema = problemaParaCobrar(c);
  if (problema) { toast(problema); return; }
  const firma = await abrirFirma(true);   // botón "✅ Registrar cobro"
  if (!firma) return;                      // el cliente/empleado canceló
  firmaPendiente = firma;
  $('#firma-preview').src = firma;
  $('#firma-preview-wrap').hidden = false;
  $('#btn-firma').textContent = '✍️ Repetir firma';
  bloquearCamposCobro(true);               // ya firmó: no se puede cambiar monto ni método
  await registrarCobro();                  // guarda la firma y registra el cobro
}

async function registrarCobro() {
  const c = creditos.find(x => x.id === infoCreditoId);
  if (!c) return;
  if (!puede('pagos')) { toast('🔒 No tienes permiso para registrar pagos'); return; }

  // Si la hoja de cobranza de hoy todavía no existe, se abre sola con este
  // cobro (quien sea que lo registre queda como quien la abrió).
  const hoy = hoyISO();
  if (!hojaExiste(hoy)) {
    const abierta = await asegurarHojaAbierta(hoy);
    if (!abierta) { toast('❌ No se pudo abrir la hoja de cobranza de hoy. Intenta de nuevo.'); return; }
  }
  if (hojaCerrada(hoy)) {
    if (!esAdmin()) { toast('🔒 La hoja de cobranza de hoy ya está cerrada'); return; }
    const autorizado = await pedirPin('La hoja de cobranza de hoy ya está cerrada. Escribe tu código para registrar este cobro de todos modos.');
    if (!autorizado) { toast('🔒 Cobro cancelado'); return; }
  }

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
    // La firma quedó guardada: se muestra el botón para reintentar sin volver
    // a firmar (con el monto/método ya bloqueados, no se pueden cambiar).
    boton.hidden = false;
    return;
  }
  boton.disabled = false;
  boton.hidden = true;

  const i = creditos.findIndex(x => x.id === c.id);
  if (i >= 0) creditos[i] = actualizado;

  firmaPendiente = null;
  $('#cobro-monto').value = '';
  $('#cobro-metodo').value = 'efectivo';
  $('#firma-preview-wrap').hidden = true;
  $('#btn-firma').textContent = '✍️ Firmar y registrar cobro';
  bloquearCamposCobro(false);   // listo el cobro: se desbloquea para el siguiente
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

function abrirFormulario(credito = null, prefill = null) {
  // Editar créditos es solo del administrador: los demás ven la ficha
  if (credito && !puede('editar')) { abrirInfo(credito); return; }
  if (!credito && !puede('crear')) { toast('🔒 No tienes permiso para crear créditos'); return; }
  if (credito) prefill = null;   // el prellenado solo aplica a créditos nuevos
  $('#credit-form').reset();
  limpiarErrorFormulario();
  fotoActual = null;
  abonosActuales = [];
  abonoFechaEditando = null;
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
  let valorCliente = '', zonaInicial = '';
  if (credito) {
    const cli = (credito.clienteId && clientePorId(credito.clienteId)) || clientePorNombre(credito.cliente);
    valorCliente = cli ? cli.id : `libre:${credito.cliente}`;
    zonaInicial = credito.zona || '';
  } else if (prefill) {
    if (prefill.clienteId && clientePorId(prefill.clienteId)) valorCliente = prefill.clienteId;
    else if (prefill.clienteNombre) valorCliente = `libre:${prefill.clienteNombre}`;
    zonaInicial = prefill.zona || '';
  }
  llenarSelectClientes(valorCliente);
  $('#f-zona').value = zonaInicial;
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
    // El vencimiento solo lo cambia el administrador, aunque el empleado
    // tenga permiso de editar el resto del crédito
    const vencEditable = soloEditarCampos && puedeCambiarVencimiento();
    $('#f-vencimiento').disabled = !vencEditable;
    $('#btn-atajo-1').disabled = !vencEditable;
    $('#btn-atajo-2').disabled = !vencEditable;
    $('#btn-cliente-nuevo').disabled = !soloEditarCampos;
    $('#foto-acciones-wrap').style.display = soloEditarCampos ? '' : 'none';
    // Vuelve a bloquear la zona si el cliente elegido ya la define
    if (soloEditarCampos) aplicarClienteSeleccionado();
  } else {
    $('#form-title').textContent = (prefill && prefill.desdeDespacho) ? 'Nuevo crédito (desde despacho)' : 'Nuevo crédito';
    $('#f-id').value = '';
    $('#f-fecha').value = hoyISO();
    $('#f-vencimiento').value = sumarDias(hoyISO(), settings.dias);
    // Al crear: mostrar "pago inicial" y ocultar abonos
    $('#field-pago-inicial').hidden = false;
    $('#abonos-box').hidden = true;
    if (prefill) {
      $('#f-boleta').value = prefill.boleta || '';
      if (prefill.monto) $('#f-monto').value = prefill.monto;
      $('#f-fecha-despacho').value = prefill.fechaDespacho || '';
      // La fecha de emisión del despacho se usa como fecha del crédito
      if (prefill.fechaEmision) {
        $('#f-fecha').value = prefill.fechaEmision;
        $('#f-vencimiento').value = sumarDias(prefill.fechaEmision, settings.dias);
      }
    }
  }
  modalForm.showModal();
}

/* Quita una "a cuenta", pidiendo antes el código de seguridad */
async function quitarAbonoConCodigo(indice) {
  const a = abonosActuales[indice];
  if (!a) return;
  if (!puedeQuitarAbono(a)) {
    toast(a.fecha && hojaCerrada(a.fecha)
      ? '🔒 La hoja de cobranza de ese día ya está cerrada'
      : '🔒 Solo el administrador puede quitar pagos de otros días');
    return;
  }
  const cerrada = a.fecha && hojaCerrada(a.fecha);
  const motivo = cerrada
    ? `Vas a borrar la ACUENTA ${indice + 1} de ${formatoMonto(a.monto)} (${formatoFecha(a.fecha)}). La hoja de ese día ya está cerrada.`
    : `Vas a borrar la ACUENTA ${indice + 1} de ${formatoMonto(a.monto)} (${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'}).`;
  const autorizado = await pedirPin(motivo);
  if (!autorizado) { toast('🔒 Borrado cancelado'); return; }
  abonosActuales.splice(indice, 1);
  renderAbonos();
}

/* Editar la fecha de un pago "a cuenta" ya registrado: solo el administrador
   (en modo local, el único dueño, siempre puede). Si la hoja de origen o la
   de destino ya está cerrada, se pide el código de seguridad. */
let abonoFechaEditando = null;   // índice del abono cuya fecha se está editando ahora

function puedeEditarFechaAbono() {
  return !modoNube || esAdmin();
}

function iniciarEdicionFechaAbono(indice) {
  if (!puedeEditarFechaAbono()) { toast('🔒 Solo el administrador puede editar la fecha'); return; }
  abonoFechaEditando = indice;
  renderAbonos();
}

function cancelarEdicionFechaAbono() {
  abonoFechaEditando = null;
  renderAbonos();
}

async function confirmarEdicionFechaAbono(indice) {
  const a = abonosActuales[indice];
  const nuevaFecha = $(`#abono-fecha-edit-${indice}`).value;
  if (!a || !nuevaFecha) { cancelarEdicionFechaAbono(); return; }
  if (nuevaFecha === a.fecha) { cancelarEdicionFechaAbono(); return; }

  const fechaVieja = a.fecha;
  // Si la hoja de origen o la de destino ya está cerrada, hace falta el código
  if ((fechaVieja && hojaCerrada(fechaVieja)) || hojaCerrada(nuevaFecha)) {
    const autorizado = await pedirPin(
      `Vas a cambiar la fecha de la ACUENTA ${indice + 1} del ${fechaVieja ? formatoFecha(fechaVieja) : 'sin fecha'} al ${formatoFecha(nuevaFecha)}. Una de esas hojas ya está cerrada.`);
    if (!autorizado) { toast('🔒 Cambio cancelado'); cancelarEdicionFechaAbono(); return; }
  }

  abonosActuales[indice] = { ...a, fecha: nuevaFecha };
  abonoFechaEditando = null;
  renderAbonos();
  toast('✅ Fecha actualizada');
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
             el ${textoRegistrado(a)}</span>`
        : '';
      const puedeQuitar = puedeQuitarAbono(a);
      const fechaHtml = abonoFechaEditando === i
        ? `<span class="abono-fecha-edit">
             <input type="date" id="abono-fecha-edit-${i}" class="input input-mini" value="${a.fecha || ''}">
             <button type="button" data-confirmar-fecha="${i}" title="Guardar fecha">✓</button>
             <button type="button" data-cancelar-fecha="${i}" title="Cancelar">✕</button>
           </span>`
        : `<span class="abono-fecha">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'} · ${metodoLabel(metodoDe(a))}${
            puedeEditarFechaAbono()
              ? ` <button type="button" class="btn-fecha-editar" data-editar-fecha="${i}" title="Editar la fecha">✏️</button>`
              : ''}</span>`;
      return `
      <div class="abono-item">
        <span class="abono-datos">ACUENTA ${i + 1}: <strong>${formatoMonto(a.monto)}</strong>
          ${fechaHtml}
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
  abonoFechaEditando = null;
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

async function confirmarNuevoAbono() {
  const monto = Number($('#abono-monto').value);
  if (!monto || monto <= 0) { toast('⚠️ Escribe un monto válido para el pago'); return; }
  const fecha = $('#abono-fecha').value || hoyISO();

  // Si la hoja de cobranza de esa fecha todavía no existe, se abre sola.
  if (!hojaExiste(fecha)) {
    const abierta = await asegurarHojaAbierta(fecha);
    if (!abierta) { toast(`❌ No se pudo abrir la hoja de cobranza del ${formatoFecha(fecha)}. Intenta de nuevo.`); return; }
  }
  if (hojaCerrada(fecha)) {
    if (!esAdmin()) { toast('🔒 Esa hoja de cobranza ya está cerrada'); return; }
    const autorizado = await pedirPin(`La hoja de cobranza del ${formatoFecha(fecha)} ya está cerrada. Escribe tu código para agregar este pago de todos modos.`);
    if (!autorizado) { toast('🔒 Cancelado'); return; }
  }

  abonosActuales.push({
    monto,
    fecha,
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
  visorCreditoActual = null;
  visorImagenActual = null;
  $('#btn-rotar-imagen').hidden = true;
  $('#btn-guardar-rotacion').hidden = true;
  $('#imagen-grande').src = dataUrl;
  const enlace = $('#btn-descargar-imagen');
  enlace.href = dataUrl;
  enlace.download = String(nombreArchivo).replace(/[^\w.-]/g, '_');
  reiniciarZoomImagen();
  $('#modal-imagen').showModal();
}

/* ====== Zoom del visor de fotos ======
   Pellizcar con dos dedos para acercar/alejar, arrastrar para moverse y
   doble toque para acercar/alejar de golpe. En computadora: Ctrl + rueda. */
const ZOOM_MAX = 6;
let zoomEscala = 1, zoomX = 0, zoomY = 0;
const zoomPunteros = new Map();
let zoomDistIni = 0, zoomEscalaIni = 1, zoomXIni = 0, zoomYIni = 0;
let zoomCentroIni = null, zoomArrastreIni = null, zoomUltimoToque = 0;

function aplicarZoomImagen() {
  const img = $('#imagen-grande');
  if (!img) return;
  // No dejar que la foto se escape de la pantalla al arrastrarla
  const caja = img.getBoundingClientRect();
  const anchoBase = caja.width / zoomEscala, altoBase = caja.height / zoomEscala;
  const maxX = Math.max(0, (anchoBase * zoomEscala - anchoBase) / 2);
  const maxY = Math.max(0, (altoBase * zoomEscala - altoBase) / 2);
  zoomX = Math.min(maxX, Math.max(-maxX, zoomX));
  zoomY = Math.min(maxY, Math.max(-maxY, zoomY));
  img.style.transform = `translate(${zoomX}px, ${zoomY}px) scale(${zoomEscala})`;
  img.classList.toggle('con-zoom', zoomEscala > 1);
}

function reiniciarZoomImagen() {
  zoomEscala = 1; zoomX = 0; zoomY = 0;
  zoomPunteros.clear();
  aplicarZoomImagen();
}

/* Acerca/aleja manteniendo fijo el punto de la foto que se está tocando */
function zoomHacia(nuevaEscala, puntoX, puntoY) {
  const img = $('#imagen-grande');
  if (!img) return;
  const caja = img.getBoundingClientRect();
  const centroX = caja.left + caja.width / 2;
  const centroY = caja.top + caja.height / 2;
  const escala = Math.min(ZOOM_MAX, Math.max(1, nuevaEscala));
  const factor = escala / zoomEscala;
  zoomX = puntoX - centroX - (puntoX - centroX - zoomX) * factor;
  zoomY = puntoY - centroY - (puntoY - centroY - zoomY) * factor;
  zoomEscala = escala;
  if (zoomEscala === 1) { zoomX = 0; zoomY = 0; }
  aplicarZoomImagen();
}

function distanciaPunteros() {
  const [a, b] = [...zoomPunteros.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function centroPunteros() {
  const [a, b] = [...zoomPunteros.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function prepararZoomImagen() {
  const zona = $('#imagen-scroll');
  const img = $('#imagen-grande');
  if (!zona || !img) return;

  zona.addEventListener('pointerdown', ev => {
    // Si el navegador no deja capturar el puntero, seguimos igual: lo importante
    // es registrar el dedo para el pellizco.
    try { zona.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ }
    zoomPunteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (zoomPunteros.size === 2) {
      zoomDistIni = distanciaPunteros();
      zoomEscalaIni = zoomEscala;
      zoomCentroIni = centroPunteros();
      zoomXIni = zoomX; zoomYIni = zoomY;
      zoomArrastreIni = null;
    } else if (zoomPunteros.size === 1) {
      zoomArrastreIni = { x: ev.clientX, y: ev.clientY, zx: zoomX, zy: zoomY };
      // Doble toque: acercar o volver al tamaño normal
      const ahora = Date.now();
      if (ahora - zoomUltimoToque < 300) {
        zoomHacia(zoomEscala > 1 ? 1 : 2.5, ev.clientX, ev.clientY);
        zoomUltimoToque = 0;
      } else {
        zoomUltimoToque = ahora;
      }
    }
  });

  zona.addEventListener('pointermove', ev => {
    if (!zoomPunteros.has(ev.pointerId)) return;
    zoomPunteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (zoomPunteros.size === 2 && zoomDistIni > 0) {
      ev.preventDefault();
      const escala = Math.min(ZOOM_MAX, Math.max(1, zoomEscalaIni * (distanciaPunteros() / zoomDistIni)));
      const centro = centroPunteros();
      const caja = img.getBoundingClientRect();
      const cx = caja.left + caja.width / 2, cy = caja.top + caja.height / 2;
      const factor = escala / zoomEscalaIni;
      // Mantiene bajo los dedos el punto donde empezó el pellizco y sigue su arrastre
      zoomX = zoomCentroIni.x - cx - (zoomCentroIni.x - cx - zoomXIni) * factor + (centro.x - zoomCentroIni.x);
      zoomY = zoomCentroIni.y - cy - (zoomCentroIni.y - cy - zoomYIni) * factor + (centro.y - zoomCentroIni.y);
      zoomEscala = escala;
      if (zoomEscala === 1) { zoomX = 0; zoomY = 0; }
      aplicarZoomImagen();
    } else if (zoomPunteros.size === 1 && zoomEscala > 1 && zoomArrastreIni) {
      ev.preventDefault();
      zoomX = zoomArrastreIni.zx + (ev.clientX - zoomArrastreIni.x);
      zoomY = zoomArrastreIni.zy + (ev.clientY - zoomArrastreIni.y);
      aplicarZoomImagen();
    }
  });

  const soltar = ev => {
    zoomPunteros.delete(ev.pointerId);
    if (zoomPunteros.size < 2) zoomDistIni = 0;
    if (zoomPunteros.size === 0) zoomArrastreIni = null;
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => zona.addEventListener(t, soltar));

  // Computadora: Ctrl + rueda (o gesto del trackpad)
  zona.addEventListener('wheel', ev => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    zoomHacia(zoomEscala * (ev.deltaY < 0 ? 1.15 : 0.87), ev.clientX, ev.clientY);
  }, { passive: false });
}

/* Foto de la boleta: permite rotar (sentido antihorario) y guardar el cambio */
let visorCreditoActual = null;   // crédito cuya foto se está viendo (null = otra imagen, ej. firma)
let visorImagenActual = null;    // dataURL actual mostrada (con la rotación pendiente, si hay)

function abrirVisorImagen(credito) {
  const nombre = String(credito.boleta || 'foto').replace(/[^\w.-]/g, '_');
  mostrarImagenGrande(credito.foto, `boleta-${nombre}.jpg`);
  if (puede('editar')) {
    visorCreditoActual = credito;
    visorImagenActual = credito.foto;
    $('#btn-rotar-imagen').hidden = false;
    $('#btn-guardar-rotacion').hidden = false;
    $('#btn-guardar-rotacion').disabled = true;
  }
}

/* Rota la imagen que se está viendo 90° en sentido antihorario */
function rotarImagenVisor() {
  if (!visorImagenActual) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.height;
    canvas.height = img.width;
    const ctx = canvas.getContext('2d');
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    visorImagenActual = canvas.toDataURL('image/jpeg', 0.92);
    $('#imagen-grande').src = visorImagenActual;
    $('#btn-descargar-imagen').href = visorImagenActual;
    $('#btn-guardar-rotacion').disabled = false;
    reiniciarZoomImagen();
  };
  img.src = visorImagenActual;
}

/* Guarda la foto rotada en el crédito */
async function guardarRotacionImagen() {
  if (!visorCreditoActual || !visorImagenActual) return;
  const boton = $('#btn-guardar-rotacion');
  boton.disabled = true;
  try {
    const actualizado = { ...visorCreditoActual, foto: visorImagenActual };
    await guardarEnStore(actualizado);
    const idx = creditos.findIndex(c => c.id === actualizado.id);
    if (idx >= 0) creditos[idx] = actualizado;
    visorCreditoActual = actualizado;
    render();
    toast('✅ Foto guardada');
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar la foto');
    boton.disabled = false;
  }
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

/* ====== Dashboard ======
   Gráficos hechos a mano con SVG: sin librerías externas, así la app sigue
   funcionando sin internet y pesa lo mismo. */
function prefiereMenosMovimiento() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const COLORES_GRAFICO = ['#e0714a', '#2a9d8f', '#e9b949', '#3b7dd8', '#8b6fc4', '#5c6b7f', '#d1483a'];

/* Monto corto para los ejes: 1.2k, 15k, 1.3M */
function montoCorto(n) {
  const v = Math.abs(n);
  if (v >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* Curva suave (Catmull-Rom convertida a Bézier) que pasa por todos los puntos */
function curvaSuave(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/* Gráfico de área: cuánto se cobró cada mes */
function graficoArea(datos) {
  if (!datos.length || datos.every(d => !d.valor)) return '<p class="chart-vacio">Todavía no hay cobros registrados.</p>';
  const An = 720, Al = 240, mIzq = 52, mDer = 12, mSup = 14, mInf = 30;
  const anchoUtil = An - mIzq - mDer, altoUtil = Al - mSup - mInf;
  const max = Math.max(...datos.map(d => d.valor)) * 1.15 || 1;
  const paso = datos.length > 1 ? anchoUtil / (datos.length - 1) : 0;
  const pts = datos.map((d, i) => ({
    x: +(mIzq + i * paso).toFixed(1),
    y: +(mSup + altoUtil - (d.valor / max) * altoUtil).toFixed(1),
  }));
  const linea = curvaSuave(pts);
  const area = `${linea} L ${pts[pts.length - 1].x} ${mSup + altoUtil} L ${pts[0].x} ${mSup + altoUtil} Z`;
  // Rejilla horizontal con sus valores
  const guias = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = +(mSup + altoUtil - f * altoUtil).toFixed(1);
    return `<line x1="${mIzq}" y1="${y}" x2="${An - mDer}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
            <text x="${mIzq - 8}" y="${y + 4}" text-anchor="end" class="eje">${montoCorto(max * f)}</text>`;
  }).join('');
  const etiquetas = datos.map((d, i) =>
    `<text x="${pts[i].x}" y="${Al - 8}" text-anchor="middle" class="eje">${escapeHtml(d.etiqueta)}</text>`).join('');
  const puntos = datos.map((d, i) => `
    <g class="punto" data-tip-color="${COLORES_GRAFICO[0]}" data-tip-label="${escapeHtml(d.etiqueta)}" data-tip-value="${escapeHtml(formatoMonto(d.valor))}">
      <circle cx="${pts[i].x}" cy="${pts[i].y}" r="4.5" fill="#fff" stroke="var(--primary)" stroke-width="2.5"/>
    </g>`).join('');
  return `<svg viewBox="0 0 ${An} ${Al}" role="img" aria-label="Cobranza por mes">
    <defs>
      <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${guias}
    <path d="${area}" fill="url(#gradArea)" class="area-relleno"/>
    <path d="${linea}" fill="none" stroke="var(--primary)" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" class="area-linea"/>
    ${puntos}${etiquetas}
  </svg>`;
}

/* Gráfico de dona con leyenda */
function graficoDona(datos, textoCentro) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  if (!total) return '<p class="chart-vacio">Sin datos para mostrar.</p>';
  const R = 78, r = 50, cx = 100, cy = 100;
  let ang = -Math.PI / 2;   // empieza arriba
  const arcos = datos.map((d, i) => {
    const porcion = d.valor / total;
    const fin = ang + porcion * Math.PI * 2;
    const grande = porcion > 0.5 ? 1 : 0;
    const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
    const x2 = cx + R * Math.cos(fin), y2 = cy + R * Math.sin(fin);
    const x3 = cx + r * Math.cos(fin), y3 = cy + r * Math.sin(fin);
    const x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
    // Una sola porción: se dibuja el anillo completo
    const d2 = porcion >= 0.999
      ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy}
         M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`
      : `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${grande} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}
         L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${r} ${r} 0 ${grande} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
    // Vector unitario hacia el punto medio de la porción: al pasar el cursor
    // encima (solo en PC), la porción se desplaza un poco hacia afuera del anillo.
    const medio = (ang + fin) / 2;
    const ux = Math.cos(medio).toFixed(3), uy = Math.sin(medio).toFixed(3);
    ang = fin;
    const color = COLORES_GRAFICO[i % COLORES_GRAFICO.length];
    const valorTexto = `${formatoMonto(d.valor)} · ${Math.round(porcion * 100)}%`;
    return `<path d="${d2}" fill="${color}" class="porcion" style="--i:${i}; --ux:${ux}; --uy:${uy}"
      data-tip-color="${color}" data-tip-label="${escapeHtml(d.etiqueta)}" data-tip-value="${escapeHtml(valorTexto)}"></path>`;
  }).join('');
  const leyenda = datos.map((d, i) => `
    <span class="leyenda-item">
      <span class="leyenda-punto" style="background:${COLORES_GRAFICO[i % COLORES_GRAFICO.length]}"></span>
      ${escapeHtml(d.etiqueta)} <span class="leyenda-val">${formatoMonto(d.valor)}</span>
    </span>`).join('');
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Distribución">
      ${arcos}
      <text x="100" y="94" text-anchor="middle" class="dona-et">TOTAL</text>
      <text x="100" y="118" text-anchor="middle" class="dona-val">${escapeHtml(textoCentro)}</text>
    </svg>
    <div class="leyenda">${leyenda}</div>`;
}

/* Barras horizontales */
function graficoBarras(datos, formato = formatoMonto) {
  if (!datos.length || datos.every(d => !d.valor)) return '<p class="chart-vacio">Sin datos para mostrar.</p>';
  const max = Math.max(...datos.map(d => d.valor)) || 1;
  return `<div class="barras">${datos.map((d, i) => {
    const color = d.color || COLORES_GRAFICO[i % COLORES_GRAFICO.length];
    return `
    <div class="barra-fila" data-tip-color="${color}" data-tip-label="${escapeHtml(d.etiqueta)}" data-tip-value="${escapeHtml(formato(d.valor))}">
      <span class="barra-et">${escapeHtml(d.etiqueta)}</span>
      <span class="barra-pista">
        <span class="barra-valor" style="--w:${(d.valor / max * 100).toFixed(1)}%; --c:${color}; --i:${i}"></span>
      </span>
      <span class="barra-num">${formato(d.valor)}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ---- Menú del usuario (Mi perfil / Configuración) ---- */
function alternarMenuUsuario() {
  const abierto = !$('#usuario-menu').hidden;
  if (abierto) cerrarMenuUsuario(); else abrirMenuUsuario();
}
function abrirMenuUsuario() {
  $('#usuario-menu').hidden = false;
  $('#btn-cuenta').setAttribute('aria-expanded', 'true');
}
function cerrarMenuUsuario() {
  $('#usuario-menu').hidden = true;
  $('#btn-cuenta').setAttribute('aria-expanded', 'false');
}

/* ---- Tooltip de los gráficos del Dashboard (dona, barras, línea) ----
   Un solo cuadro flotante que sigue al cursor. Los elementos que lo activan
   llevan data-tip-color/label/value; se delega desde #view-dashboard porque
   los gráficos se vuelven a dibujar (innerHTML) en cada actualización. */
function mostrarTooltipGrafico(ev, color, label, valor) {
  const tt = $('#chart-tooltip');
  if (!tt) return;
  $('#chart-tooltip-titulo').textContent = label;
  $('#chart-tooltip-color').style.background = color || 'var(--primary)';
  $('#chart-tooltip-valor').textContent = valor;
  tt.hidden = false;
  posicionarTooltipGrafico(ev);
}
function posicionarTooltipGrafico(ev) {
  const tt = $('#chart-tooltip');
  if (!tt || tt.hidden) return;
  const pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  const r = tt.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}
function ocultarTooltipGrafico() {
  const tt = $('#chart-tooltip');
  if (tt) tt.hidden = true;
}

/* ---- Datos del dashboard ---- */
function datosCobranzaPorMes(meses = 6) {
  const hoy = new Date();
  const serie = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    serie.push({ clave, etiqueta: MESES_CORTOS[d.getMonth()], valor: 0 });
  }
  const indice = new Map(serie.map(s => [s.clave, s]));
  for (const c of creditos) {
    for (const a of abonosDe(c)) {
      if (!a.fecha) continue;
      const s = indice.get(String(a.fecha).slice(0, 7));
      if (s) s.valor += Number(a.monto) || 0;
    }
  }
  return serie;
}

function datosDeudaPorZona() {
  const mapa = new Map();
  for (const c of creditos) {
    const saldo = saldoDe(c);
    if (saldo <= 0) continue;
    const z = c.zona || 'Sin zona';
    mapa.set(z, (mapa.get(z) || 0) + saldo);
  }
  return [...mapa.entries()]
    .map(([etiqueta, valor]) => ({ etiqueta, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);
}

function datosEstados() {
  const cuenta = { pendiente: 0, parcial: 0, vencido: 0, pagado: 0 };
  for (const c of creditos) cuenta[estadoEfectivo(c)] = (cuenta[estadoEfectivo(c)] || 0) + 1;
  return [
    { etiqueta: '🕐 Pendientes', valor: cuenta.pendiente, color: '#3b7dd8' },
    { etiqueta: '🪙 Pago parcial', valor: cuenta.parcial, color: '#e9b949' },
    { etiqueta: '⚠️ Vencidos', valor: cuenta.vencido, color: '#d1483a' },
    { etiqueta: '✅ Pagados', valor: cuenta.pagado, color: '#2a9d8f' },
  ];
}

function datosMetodosPago(dias = 30) {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const limite = desde.toISOString().slice(0, 10);
  const tot = { efectivo: 0, yape: 0, bcp: 0 };
  for (const c of creditos) {
    for (const a of abonosDe(c)) {
      if (!a.fecha || a.fecha < limite) continue;
      tot[metodoDe(a)] = (tot[metodoDe(a)] || 0) + (Number(a.monto) || 0);
    }
  }
  return [
    { etiqueta: '💵 Efectivo', valor: tot.efectivo, color: '#2a9d8f' },
    { etiqueta: '📱 Yape', valor: tot.yape, color: '#8b6fc4' },
    { etiqueta: '🏦 BCP', valor: tot.bcp, color: '#3b7dd8' },
  ];
}

/* Créditos que necesitan atención: vencidos y compromisos incumplidos o de hoy */
function datosAtencion() {
  const hoy = hoyISO();
  return creditos
    .filter(c => saldoDe(c) > 0)
    .map(c => {
      const dv = diasHastaVencimiento(c.vencimiento);
      if (c.compromiso && c.compromiso <= hoy) {
        const dc = diasHastaVencimiento(c.compromiso);
        return { c, orden: dc, tipo: 'compromiso',
          texto: dc === 0 ? 'Prometió pagar hoy' : `Prometió pagar hace ${Math.abs(dc)} día${Math.abs(dc) === 1 ? '' : 's'}` };
      }
      if (dv < 0) return { c, orden: dv, tipo: 'vencido', texto: `Venció hace ${Math.abs(dv)} día${Math.abs(dv) === 1 ? '' : 's'}` };
      if (dv === 0) return { c, orden: 0, tipo: 'hoy', texto: 'Vence hoy' };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden)
    .slice(0, 6);
}

/* Últimos cobros registrados, del más reciente al más antiguo */
function datosActividad() {
  const lista = [];
  for (const c of creditos) {
    abonosDe(c).forEach(a => lista.push({
      credito: c, monto: Number(a.monto) || 0, fecha: a.fecha,
      metodo: metodoDe(a), quien: a.registradoPor || '', cuando: a.registrado || 0,
    }));
  }
  return lista.sort((x, y) => (y.cuando - x.cuando) || String(y.fecha).localeCompare(String(x.fecha))).slice(0, 6);
}

/* ---- Dibujado del dashboard ---- */
function renderDashboard() {
  if ($('#view-dashboard').hidden) return;

  const hoy = new Date();
  $('#dash-fecha').textContent = `Resumen general del negocio · ${hoy.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}`;

  // --- Indicadores ---
  let porCobrar = 0, vencidos = 0, cobrado = 0, activos = 0, cobradoHoy = 0;
  const iso = hoyISO();
  for (const c of creditos) {
    const e = estadoEfectivo(c);
    if (abonosDe(c).length) cobrado += totalAbonado(c);
    else if (e === 'pagado') cobrado += Number(c.monto) || 0;
    for (const a of abonosDe(c)) if (a.fecha === iso) cobradoHoy += Number(a.monto) || 0;
    if (e !== 'pagado') { porCobrar += saldoDe(c); activos++; if (e === 'vencido') vencidos++; }
  }
  const despHoy = despachos.filter(d => esDespachoPedido(d) && d.fecha === iso).length;

  const kpis = [
    { et: 'Por cobrar', val: formatoMonto(porCobrar), pie: 'saldo pendiente', ico: '💰', color: 'var(--primary)', bg: 'var(--primary-light)' },
    { et: 'Cobrado hoy', val: formatoMonto(cobradoHoy), pie: 'ingresos del día', ico: '📈', color: 'var(--accent)', bg: 'var(--accent-light)' },
    { et: 'Vencidos', val: String(vencidos), pie: 'requieren atención', ico: '⚠️', color: 'var(--danger)', bg: 'var(--danger-light)' },
    { et: 'Créditos activos', val: String(activos), pie: 'en seguimiento', ico: '📋', color: 'var(--azul)', bg: '#e6efFB' },
    { et: 'Cobrado total', val: formatoMonto(cobrado), pie: 'histórico', ico: '✅', color: 'var(--accent)', bg: 'var(--accent-light)' },
    { et: 'Despachos hoy', val: String(despHoy), pie: 'salieron a reparto', ico: '📦', color: 'var(--amber)', bg: 'var(--amber-light)' },
  ];
  $('#dash-kpis').innerHTML = kpis.map((k, i) => `
    <article class="kpi" style="--kpi:${k.color}; --kpi-bg:${k.bg}; --i:${i}">
      <div>
        <span class="kpi-et">${k.et}</span>
        <span class="kpi-val">${escapeHtml(k.val)}</span>
        <span class="kpi-pie">${k.pie}</span>
      </div>
      <span class="kpi-ico">${k.ico}</span>
    </article>`).join('');

  // --- Gráficos ---
  const serie = datosCobranzaPorMes(6);
  $('#dash-chart-cobranza').innerHTML = graficoArea(serie);
  const totalSerie = serie.reduce((s, d) => s + d.valor, 0);
  $('#dash-cobranza-chip').textContent = `Total: ${formatoMonto(totalSerie)}`;

  const zonas = datosDeudaPorZona();
  $('#dash-chart-zonas').innerHTML = graficoDona(zonas, montoCorto(zonas.reduce((s, d) => s + d.valor, 0)));

  $('#dash-chart-estados').innerHTML = graficoBarras(datosEstados(), n => String(n));
  $('#dash-chart-metodos').innerHTML = graficoBarras(datosMetodosPago(30));

  // --- Requieren atención ---
  const atencion = datosAtencion();
  $('#dash-atencion').innerHTML = atencion.length
    ? atencion.map(a => `
      <button type="button" class="dash-fila" data-info="${escapeHtml(a.c.id)}">
        <span class="dash-fila-ico">${a.tipo === 'compromiso' ? '🤝' : a.tipo === 'hoy' ? '🔔' : '⚠️'}</span>
        <span class="dash-fila-txt">
          <span class="dash-fila-nom">${escapeHtml(a.c.cliente)}</span>
          <span class="dash-fila-meta">Nº ${escapeHtml(a.c.boleta)} · ${escapeHtml(a.texto)}</span>
        </span>
        <span class="dash-fila-monto" style="color:var(--danger)">${formatoMonto(saldoDe(a.c))}</span>
      </button>`).join('')
    : '<p class="dash-vacio">🎉 Nada pendiente de atención.</p>';

  // --- Últimos cobros ---
  const act = datosActividad();
  $('#dash-actividad').innerHTML = act.length
    ? act.map(a => `
      <button type="button" class="dash-fila" data-info="${escapeHtml(a.credito.id)}">
        <span class="dash-fila-ico">${metodoLabel(a.metodo).slice(0, 2)}</span>
        <span class="dash-fila-txt">
          <span class="dash-fila-nom">${escapeHtml(a.credito.cliente)}</span>
          <span class="dash-fila-meta">${a.fecha ? formatoFecha(a.fecha) : '—'}${a.quien ? ' · ' + escapeHtml(a.quien) : ''}</span>
        </span>
        <span class="dash-fila-monto" style="color:var(--accent)">${formatoMonto(a.monto)}</span>
      </button>`).join('')
    : '<p class="dash-vacio">Todavía no hay cobros registrados.</p>';
}

/* ====== Hoja de cobranza (modal) ====== */
function abrirCobranza() {
  revisarAperturaAutomatica();
  if (!$('#cob-fecha').value) $('#cob-fecha').value = hoyISO();
  renderCobranza();
  mostrarSeccion('cobranza');
}

/* Muestra si la hoja del día está creada, abierta o cerrada, y los
   botones para crearla (según permiso) o cerrarla (solo administrador). */
function renderEstadoHoja(fecha, filas = []) {
  const cont = $('#cob-estado');
  if (!modoNube) { cont.hidden = true; return; }
  cont.hidden = false;

  // Un día con cobros no puede quedar como "sin abrir": se recupera a nombre
  // de quien hizo el primer cobro (vuelve a dibujar cuando lo consigue).
  recuperarHojaDeDiaConCobros(fecha, filas);

  const badge = $('#cob-estado-badge');
  const btnCrear = $('#btn-hoja-crear');
  const btnCerrar = $('#btn-hoja-cerrar');
  btnCrear.hidden = true;
  btnCerrar.hidden = true;

  const detalle = $('#cob-estado-detalle');
  const h = hojaDe(fecha);
  if (!h) {
    badge.textContent = '⚠️ Esta hoja aún no se ha creado';
    badge.className = 'cob-estado-badge cob-estado-sin-crear';
    btnCrear.hidden = !puede('hojaCrear');
    detalle.textContent = '';
    detalle.hidden = true;
    return;
  }

  if (h.cerrada) {
    badge.textContent = '🔒 Cerrada';
    badge.className = 'cob-estado-badge cob-estado-cerrada';
  } else {
    badge.textContent = '🟢 Abierta';
    badge.className = 'cob-estado-badge cob-estado-abierta';
    btnCerrar.hidden = !esAdmin();
  }

  // Horas de apertura y cierre: siempre las del servidor, salvo la hoja que se
  // recuperó de un día viejo (ahí la hora es la del primer cobro registrado).
  const abierta = fechaHoraDeTimestamp(h.creadaEn);
  const origen = h.desdePrimerCobro ? ' (con el primer cobro del día)' : '';
  const lineas = [
    `🕐 Abierta por ${h.creadaPor || '—'} ${abierta ? 'el ' + abierta : '(hora pendiente de confirmar)'}${origen}`,
  ];
  const cerrada = fechaHoraDeTimestamp(h.cerradaEn);
  if (h.cerrada) {
    lineas.push(`🔒 Cerrada por ${h.cerradaPor || '—'} ${cerrada ? 'el ' + cerrada : '(hora pendiente de confirmar)'}`);
  }
  detalle.innerHTML = lineas.map(t => `<span>${escapeHtml(t)}</span>`).join('');
  detalle.hidden = false;
}

function renderCobranza() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const dias = diasConCobros(creditos);
  const diaInfo = dias.find(d => d.fecha === fecha) || { codigo: 'HC—' };
  const { filas, totales } = hojaCobranza(creditos, fecha, diaInfo.codigo);
  renderEstadoHoja(fecha, filas);

  // Cuadro de cobranza por usuario: una fila por quien cobró ese día
  // (efectivo / Yape / BCP / total) y la fila final con los totales.
  const porUsuario = cobrosPorUsuario(filas);
  $('#cob-totales').innerHTML = porUsuario.length ? `
    <table class="cob-usuarios">
      <thead>
        <tr>
          <th>Usuario</th>
          <th class="col-num">💵 Efectivo</th>
          <th class="col-num">📱 Yape</th>
          <th class="col-num">🏦 BCP</th>
          <th class="col-num">Total del día</th>
        </tr>
      </thead>
      <tbody>
        ${porUsuario.map(u => `
          <tr>
            <td class="cob-usuario-nom">${escapeHtml(u.usuario)}</td>
            <td class="col-num">${formatoMonto(u.efectivo)}</td>
            <td class="col-num">${formatoMonto(u.yape)}</td>
            <td class="col-num">${formatoMonto(u.bcp)}</td>
            <td class="col-num"><strong>${formatoMonto(u.total)}</strong></td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td class="col-num">${formatoMonto(totales.efectivo)}</td>
          <td class="col-num">${formatoMonto(totales.yape)}</td>
          <td class="col-num">${formatoMonto(totales.bcp)}</td>
          <td class="col-num cob-ganancias">${formatoMonto(totales.total)}</td>
        </tr>
      </tfoot>
    </table>` : '';

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
      <td>${horaDeTimestamp(f.registrado) || '—'}</td>
      <td>${f.firma
        ? `<img src="${f.firma}" class="firma-mini" alt="Firma" data-ver-firma-cob="${escapeHtml(f.creditoId)}|${f.indice}" title="Ver la firma">`
        : '<span class="sin-firma">—</span>'}</td>
    </tr>`).join('');

  $('#cob-vacio').hidden = filas.length > 0;
  $('#cob-tabla').hidden = filas.length === 0;
  ajustarCorrimiento('.cob-tabla-wrap');   // ¿entra a lo ancho con estos datos?

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

  // Constancia de apertura y cierre (horas puestas por el servidor)
  const hojaDia = hojaDe(fecha);
  const lineaApertura = hojaDia
    ? `Abierta por ${hojaDia.creadaPor || '—'}${fechaHoraDeTimestamp(hojaDia.creadaEn) ? ' el ' + fechaHoraDeTimestamp(hojaDia.creadaEn) : ''}`
    : 'Hoja no creada';
  const lineaCierre = hojaDia && hojaDia.cerrada
    ? `Cerrada por ${hojaDia.cerradaPor || '—'}${fechaHoraDeTimestamp(hojaDia.cerradaEn) ? ' el ' + fechaHoraDeTimestamp(hojaDia.cerradaEn) : ''}`
    : 'Sin cerrar';

  const filasXlsx = [
    [{ v: 'HOJA DE COBRANZA', s: titulo }],
    [{ v: formatoFecha(fecha), s: subtit }],
    [{ v: `🕐 ${lineaApertura}`, s: subtit }],
    [{ v: `🔒 ${lineaCierre}`, s: subtit }],
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
      { v: 'Pago', s: th }, { v: 'Cobró', s: thIzq }, { v: 'Hora', s: th },
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
      { v: horaDeTimestamp(f.registrado) || '—', s: { align: 'center', border: true, bg: z ? CEBRA : undefined } },
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
    { v: '', s: { border: true } }, { v: '', s: { border: true } }, { v: '', s: { border: true } },
  ]);

  descargarXlsx(`cobranza-${fecha}.xlsx`, {
    nombre: 'Cobranza',
    cols: [10, 26, 15, 11, 12, 12, 13, 16, 14, 14, 8],
    merges: ['A1:K1', 'A2:K2', 'A3:K3', 'A4:K4'],
    filas: filasXlsx,
  });
  toast('⬇️ Hoja de cobranza exportada (.xlsx)');
}

function imprimirCobranza() {
  const fecha = $('#cob-fecha').value || hoyISO();
  const { filas, totales } = hojaCobranza(creditos, fecha);
  // Constancia de apertura y cierre (horas puestas por el servidor)
  const hojaDia = hojaDe(fecha);
  const horaAbierta = hojaDia ? fechaHoraDeTimestamp(hojaDia.creadaEn) : '';
  const horaCerrada = hojaDia ? fechaHoraDeTimestamp(hojaDia.cerradaEn) : '';
  const constanciaHtml = hojaDia
    ? `<p class="sub">🕐 Abierta por ${escapeHtml(hojaDia.creadaPor || '—')}${horaAbierta ? ' el ' + escapeHtml(horaAbierta) : ''}
       <br>🔒 ${hojaDia.cerrada
          ? `Cerrada por ${escapeHtml(hojaDia.cerradaPor || '—')}${horaCerrada ? ' el ' + escapeHtml(horaCerrada) : ''}`
          : 'Sin cerrar'}</p>`
    : '<p class="sub">⚠️ Esta hoja no fue creada</p>';
  const filasHtml = filas.map(f => `<tr>
      <td>${escapeHtml(f.codigo || '—')}</td><td>${escapeHtml(f.cliente)}</td>
      <td>${escapeHtml(f.zona || '—')}</td><td>${escapeHtml(f.boleta)}</td>
      <td>${f.fechaEmision ? formatoFecha(f.fechaEmision) : '—'}</td>
      <td>${f.fechaDespacho ? formatoFecha(f.fechaDespacho) : '—'}</td>
      <td style="text-align:right">${formatoMonto(f.monto)}</td>
      <td style="text-align:right">${f.saldo > 0 ? formatoMonto(f.saldo) : 'saldado'}</td>
      <td>${metodoLabel(f.metodo)}</td><td>${escapeHtml(f.cobradoPor || '—')}</td>
      <td>${horaDeTimestamp(f.registrado) || '—'}</td>
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
      .tit2{font-size:15px;margin:18px 0 6px}
      .usuarios{width:auto;min-width:60%} .usuarios tfoot td{background:#f0f0f0}
    </style></head><body>
    <h1>🧾 Hoja de cobranza</h1>
    <p class="sub">Fecha: ${formatoFecha(fecha)} — ${filas.length} cobro(s)</p>
    ${constanciaHtml}
    <table><thead><tr><th>Código</th><th>Cliente</th><th>Zona</th><th>Boleta</th>
    <th>Fecha emisión</th><th>Fecha despacho</th>
    <th style="text-align:right">Cobrado</th><th style="text-align:right">Queda debiendo</th>
    <th>Pago</th><th>Cobró</th><th>Hora</th><th>Firma</th></tr></thead>
    <tbody>${filasHtml || '<tr><td colspan="12" style="text-align:center">Sin cobros este día</td></tr>'}</tbody></table>
    <h2 class="tit2">💰 Cobranza por usuario</h2>
    <table class="usuarios"><thead><tr><th>Usuario</th>
      <th style="text-align:right">Efectivo</th><th style="text-align:right">Yape</th>
      <th style="text-align:right">BCP</th><th style="text-align:right">Total del día</th></tr></thead>
    <tbody>${cobrosPorUsuario(filas).map(u => `<tr>
      <td>${escapeHtml(u.usuario)}</td>
      <td style="text-align:right">${formatoMonto(u.efectivo)}</td>
      <td style="text-align:right">${formatoMonto(u.yape)}</td>
      <td style="text-align:right">${formatoMonto(u.bcp)}</td>
      <td style="text-align:right"><b>${formatoMonto(u.total)}</b></td></tr>`).join('')
      || '<tr><td colspan="5" style="text-align:center">Sin cobros este día</td></tr>'}</tbody>
    <tfoot><tr>
      <td><b>Total</b></td>
      <td style="text-align:right"><b>${formatoMonto(totales.efectivo)}</b></td>
      <td style="text-align:right"><b>${formatoMonto(totales.yape)}</b></td>
      <td style="text-align:right"><b>${formatoMonto(totales.bcp)}</b></td>
      <td style="text-align:right"><b>${formatoMonto(totales.total)}</b></td>
    </tr></tfoot></table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('⚠️ Permite las ventanas emergentes para imprimir'); return; }
  w.document.write(html);
  w.document.close();
}

/* ====== Despachos de pedidos ====== */
let despachoActivoId = null;   // despacho abierto en la vista de detalle
let despachoOrigen = null;     // id del despacho que se está pasando a crédito
let despachoFiltroFecha = null; // día seleccionado para filtrar (null = ver todos)

/* Días que tienen al menos un despacho, del más reciente al más antiguo,
   con la cantidad y el monto de ese día (para el navegador y el desplegable). */
function diasConDespachos() {
  const mapa = new Map();
  for (const d of despachos.filter(esDespachoPedido)) {
    const f = d.fecha || '';
    if (!f) continue;
    const acc = mapa.get(f) || { fecha: f, cantidad: 0, monto: 0 };
    acc.cantidad += 1;
    acc.monto += Number(d.monto) || 0;
    mapa.set(f, acc);
  }
  return [...mapa.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/* Despachos que se muestran ahora mismo: todos, o solo los del día elegido. */
function despachosDelDia() {
  const lista = despachosOrdenados();
  if (!despachoFiltroFecha) return lista;
  return lista.filter(d => (d.fecha || '') === despachoFiltroFecha);
}

const VISTAS_DESPACHO = ['lista', 'form', 'detalle', 'repartidores'];
function mostrarVistaDespacho(nombre) {
  VISTAS_DESPACHO.forEach(v => {
    const el = $('#desp-vista-' + v);
    if (el) el.hidden = (v !== nombre);
  });
}

function abrirDespachos() {
  if (!puede('despachos')) { toast('🔒 No tienes permiso para armar despachos'); return; }
  despachoFiltroFecha = hoyISO();   // al entrar se ven los despachos de hoy
  mostrarVistaDespacho('lista');
  renderListaDespachos();
  mostrarSeccion('despachos');
}

/* Vuelve a dibujar la vista de despachos que esté abierta (al llegar datos de la nube) */
function renderDespachos() {
  if (!$('#desp-vista-lista').hidden) renderListaDespachos();
  else if (!$('#desp-vista-detalle').hidden) renderDetalleDespacho();
  else if (!$('#desp-vista-repartidores').hidden) renderRepartidores();
}

function chipDespachos(res) {
  const partes = [];
  if (res.reparto) partes.push(`<span class="ped-chip pedido-pendiente">${res.reparto} en reparto</span>`);
  if (res.credito) partes.push(`<span class="ped-chip pedido-credito">${res.credito} a crédito</span>`);
  if (res.pagado) partes.push(`<span class="ped-chip pedido-pagado">${res.pagado} pagado${res.pagado === 1 ? '' : 's'}</span>`);
  if (res.contado) partes.push(`<span class="ped-chip pedido-contado">${res.contado} al contado</span>`);
  if (res.devuelto) partes.push(`<span class="ped-chip pedido-devuelto">${res.devuelto} devuelto</span>`);
  return partes.join(' ');
}

function renderListaDespachos() {
  const lista = despachosDelDia();
  const hayDespachos = despachos.filter(esDespachoPedido).length > 0;
  $('#desp-vacio').hidden = hayDespachos;

  // Navegador de días (fecha, ◀ ▶, desplegable, Hoy, Ver todos)
  renderNavDespachos();

  // Resumen del día / de todos: estados + cantidad + monto
  const res = resumenDespachos(lista);
  const rotulo = despachoFiltroFecha
    ? `Día ${formatoFecha(despachoFiltroFecha)}`
    : 'Todos los despachos';
  $('#desp-resumen').innerHTML = lista.length
    ? `<div class="desp-chips">${chipDespachos(res)}</div>
       <div class="desp-resumen-monto">${rotulo} · ${lista.length} despacho${lista.length === 1 ? '' : 's'} · ${formatoMonto(res.monto)}</div>`
    : `<div class="desp-resumen-monto">${rotulo} · sin despachos</div>`;

  // Tabla (escritorio): N° boleta, cliente, monto, fecha, zona, repartidores y estado
  $('#desp-tabla-body').innerHTML = lista.map(d => {
    const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
    const reps = repartidoresDe(d);
    return `
      <tr class="desp-fila ${info.clase}" data-abrir-despacho="${d.id}" title="${escapeHtml(info.etiqueta)} — ver detalle">
        <td><strong>${escapeHtml(d.boleta || '—')}</strong></td>
        <td>${escapeHtml(d.cliente || '(sin cliente)')}</td>
        <td class="col-num">${formatoMonto(Number(d.monto) || 0)}</td>
        <td>${formatoFecha(d.fecha)}</td>
        <td>${d.zona ? escapeHtml(d.zona) : '—'}</td>
        <td>${reps.length ? reps.map(escapeHtml).join(', ') : '—'}</td>
        <td><span class="ped-chip ${info.clase}">${info.etiqueta}</span></td>
      </tr>`;
  }).join('');

  // Tarjetas (celular): misma información en formato compacto
  $('#despachos-list').innerHTML = lista.map(d => {
    const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
    const reps = repartidoresDe(d);
    return `
      <button type="button" class="despacho-card ${info.clase}" data-abrir-despacho="${d.id}">
        <div class="despacho-card-cab">
          <strong>${escapeHtml(d.cliente || '(sin cliente)')}</strong>
          <span class="ped-chip ${info.clase}">${info.etiqueta}</span>
        </div>
        <div class="despacho-card-datos">
          <span>🧾 N° ${escapeHtml(d.boleta || '—')}</span>
          <span>💵 ${formatoMonto(Number(d.monto) || 0)}</span>
          <span>📅 ${formatoFecha(d.fecha)}</span>
          ${d.zona ? `<span>📍 ${escapeHtml(d.zona)}</span>` : ''}
        </div>
        ${reps.length ? `<div class="despacho-card-rep">🧍 ${reps.map(escapeHtml).join(', ')}</div>` : ''}
      </button>`;
  }).join('');
}

/* Llena el desplegable de días con despachos y sincroniza el campo de fecha */
function renderNavDespachos() {
  const dias = diasConDespachos();
  const sel = $('#desp-dias');
  const opcTodos = `<option value="">Ver todos — ${dias.reduce((s, d) => s + d.cantidad, 0)} despacho(s)</option>`;
  const opciones = dias.map(d =>
    `<option value="${d.fecha}">${formatoFecha(d.fecha)} — ${d.cantidad} despacho(s) · ${formatoMonto(d.monto)}</option>`).join('');
  // Si el día elegido no tiene despachos (p. ej. hoy sin nada), igual lo mostramos
  const hayFecha = !despachoFiltroFecha || dias.some(d => d.fecha === despachoFiltroFecha);
  const extra = hayFecha ? '' : `<option value="${despachoFiltroFecha}">${formatoFecha(despachoFiltroFecha)} — sin despachos</option>`;
  sel.innerHTML = opcTodos + extra + opciones;
  sel.value = despachoFiltroFecha || '';
  $('#desp-fecha-filtro').value = despachoFiltroFecha || '';
}

/* Salta al día anterior/siguiente que tenga despachos */
function saltarDiaDespacho(direccion) {
  const dias = diasConDespachos().map(d => d.fecha);   // del más nuevo al más viejo
  if (!dias.length) { toast('Todavía no hay despachos registrados'); return; }
  const desde = despachoFiltroFecha || hoyISO();
  const anteriores = dias.filter(d => d < desde);
  const siguientes = dias.filter(d => d > desde);
  const destino = direccion < 0 ? anteriores[0] : siguientes[siguientes.length - 1];
  if (!destino) { toast(direccion < 0 ? 'No hay días anteriores con despachos' : 'No hay días siguientes con despachos'); return; }
  despachoFiltroFecha = destino;
  renderListaDespachos();
}

/* Genera la hoja de despachos del día (o de todos) lista para imprimir */
function imprimirDespachos() {
  const lista = despachosDelDia();
  const res = resumenDespachos(lista);
  const titulo = despachoFiltroFecha ? `del ${formatoFecha(despachoFiltroFecha)}` : '(todos)';
  const filasHtml = lista.map(d => {
    const reps = repartidoresDe(d);
    const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
    return `<tr>
      <td>${escapeHtml(d.cliente || '—')}</td>
      <td>${escapeHtml(d.boleta || '—')}</td>
      <td style="text-align:right">${formatoMonto(Number(d.monto) || 0)}</td>
      <td>${formatoFecha(d.fecha)}</td>
      <td>${escapeHtml(d.zona || '—')}</td>
      <td>${reps.length ? escapeHtml(reps.join(', ')) : '—'}</td>
      <td>${escapeHtml(info.etiqueta)}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Despachos ${titulo}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:20px;color:#111}
      h1{font-size:18px;margin:0 0 4px} .sub{color:#555;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f0f0f0}
      .tot{margin-top:16px;font-size:14px} .tot div{margin:2px 0}
      .tot strong{display:inline-block;min-width:150px}
    </style></head><body>
    <h1>🚚 Hoja de despachos</h1>
    <p class="sub">${despachoFiltroFecha ? 'Fecha: ' + formatoFecha(despachoFiltroFecha) : 'Todos los despachos'} — ${lista.length} despacho(s)</p>
    <table><thead><tr><th>Cliente</th><th>N° Boleta</th><th style="text-align:right">Monto</th>
    <th>Fecha</th><th>Zona</th><th>Repartidores</th><th>Estado</th></tr></thead>
    <tbody>${filasHtml || '<tr><td colspan="7" style="text-align:center">Sin despachos</td></tr>'}</tbody></table>
    <div class="tot">
      <div><strong>Total de despachos:</strong> ${lista.length}</div>
      <div><strong>Monto total:</strong> ${formatoMonto(res.monto)}</div>
      <div><strong>En reparto:</strong> ${res.reparto} · <strong style="min-width:0">A crédito:</strong> ${res.credito} · <strong style="min-width:0">Pagados:</strong> ${res.pagado}</div>
    </div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('⚠️ Permite las ventanas emergentes para imprimir'); return; }
  w.document.write(html);
  w.document.close();
}

/* ---- Buscador de clientes del formulario de despachos ----
   Igual que en créditos: se escribe y va sugiriendo; el id del cliente
   elegido queda en el campo oculto #desp-cliente. */
let comboIndiceDesp = -1;

function llenarComboClienteDespacho(valorSeleccionado = '') {
  const oculto = $('#desp-cliente');
  const caja = $('#desp-cliente-buscar');
  if (!oculto || !caja) return;
  let valor = valorSeleccionado || '';
  if (valor && !String(valor).startsWith('libre:') && !clientePorId(valor)) valor = '';
  oculto.value = valor;
  caja.value = textoCliente(valor);
  caja.placeholder = clientes.length
    ? 'Escribe el nombre del cliente…'
    : 'Aún no hay clientes: toca “➕ Nuevo”';
  cerrarSugerenciasDesp();
  aplicarClienteDespacho();
}

function renderSugerenciasDesp(texto) {
  const lista = $('#desp-cliente-sugerencias');
  if (!lista) return;
  const encontrados = clientesQueCoinciden(texto);
  comboIndiceDesp = -1;
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
  $('#desp-cliente-buscar').setAttribute('aria-expanded', 'true');
}

function cerrarSugerenciasDesp() {
  const lista = $('#desp-cliente-sugerencias');
  if (!lista) return;
  lista.hidden = true;
  comboIndiceDesp = -1;
  const caja = $('#desp-cliente-buscar');
  if (caja) caja.setAttribute('aria-expanded', 'false');
}

function seleccionarClienteDesp(id) {
  $('#desp-cliente').value = id;
  $('#desp-cliente-buscar').value = textoCliente(id);
  cerrarSugerenciasDesp();
  aplicarClienteDespacho();
}

/* Muestra la zona/datos del cliente elegido como ayuda (el despacho la toma de él) */
function aplicarClienteDespacho() {
  const ayuda = $('#desp-cliente-ayuda');
  if (!ayuda) return;
  const valor = $('#desp-cliente').value;
  const cli = valor && !valor.startsWith('libre:') ? clientePorId(valor) : null;
  if (cli) {
    ayuda.textContent = [
      cli.zona ? `📍 ${cli.zona}` : '',
      cli.direccion ? `🏠 ${cli.direccion}` : '',
      cli.telefono ? `📞 ${cli.telefono}` : '',
    ].filter(Boolean).join(' · ');
  } else {
    ayuda.textContent = valor.startsWith('libre:')
      ? 'Este cliente aún no está registrado. Regístralo para guardar su zona.'
      : '';
  }
}

/* Casillas de repartidores en el formulario (se pueden elegir varios) */
function renderRepartidoresCheck(seleccion = []) {
  const cont = $('#desp-repartidores-check');
  const activos = repartidoresActivos();
  if (!activos.length) {
    cont.innerHTML = '<p class="desp-vacio-mini">Aún no hay repartidores. Toca “➕” para agregar el primero.</p>';
    return;
  }
  const sel = new Set(seleccion);
  cont.innerHTML = activos.map(r => `
    <label class="desp-rep-check${sel.has(r.nombre) ? ' activo' : ''}">
      <input type="checkbox" value="${escapeHtml(r.nombre)}" ${sel.has(r.nombre) ? 'checked' : ''}>
      <span>🧍 ${escapeHtml(r.nombre)}</span>
    </label>`).join('');
}

function repartidoresSeleccionados() {
  return Array.from(document.querySelectorAll('#desp-repartidores-check input[type="checkbox"]:checked'))
    .map(c => c.value);
}

function abrirFormDespacho(despacho = null) {
  $('#desp-form').reset();
  $('#desp-id').value = despacho ? despacho.id : '';
  $('#desp-form-title').textContent = despacho ? 'Editar despacho' : 'Nuevo despacho';
  // Cliente: si el despacho ya tiene uno registrado, lo dejamos elegido;
  // si era texto libre, lo mostramos como "libre:".
  let valorCli = '';
  if (despacho) {
    if (despacho.clienteId && clientePorId(despacho.clienteId)) valorCli = despacho.clienteId;
    else if (despacho.cliente) valorCli = `libre:${despacho.cliente}`;
  }
  llenarComboClienteDespacho(valorCli);
  $('#btn-desp-cliente-nuevo').hidden = !puede('clientes');
  $('#desp-boleta').value = despacho ? (despacho.boleta || '') : '';
  $('#desp-monto').value = despacho ? (despacho.monto || '') : '';
  $('#desp-emision').value = despacho ? (despacho.emision || despacho.fecha || hoyISO()) : hoyISO();
  $('#desp-fecha').value = despacho ? (despacho.fecha || hoyISO()) : hoyISO();
  $('#desp-notas').value = despacho ? (despacho.notas || '') : '';
  renderRepartidoresCheck(despacho ? repartidoresDe(despacho) : []);
  mostrarVistaDespacho('form');
  $('#desp-cliente-buscar').focus();
}

async function guardarDespachoForm(ev) {
  ev.preventDefault();
  if (!puede('despachos')) return;
  // Cliente: del combo (id oculto); si escribió sin elegir, se resuelve por
  // nombre exacto y, si no existe, se guarda como texto libre.
  let clienteNombre = '', clienteId = '', zonaCli = '';
  const valorCli = $('#desp-cliente').value;
  if (valorCli && !valorCli.startsWith('libre:')) {
    const cli = clientePorId(valorCli);
    if (cli) { clienteNombre = cli.nombre; clienteId = cli.id; zonaCli = cli.zona || ''; }
  }
  if (!clienteNombre) {
    const texto = $('#desp-cliente-buscar').value.trim();
    if (!texto) { toast('⚠️ Escribe o elige el cliente'); return; }
    const exacto = clientePorNombre(texto);
    if (exacto) { clienteNombre = exacto.nombre; clienteId = exacto.id; zonaCli = exacto.zona || ''; }
    else clienteNombre = texto;
  }
  const reps = repartidoresSeleccionados();
  if (!reps.length) { toast('⚠️ Elige al menos un repartidor'); return; }
  const id = $('#desp-id').value || nuevoId();
  const existente = despachoPorId(id);
  const despacho = {
    id,
    fecha: $('#desp-fecha').value || hoyISO(),
    emision: $('#desp-emision').value || hoyISO(),
    cliente: clienteNombre,
    clienteId,
    zona: clienteId ? zonaCli : ((existente && existente.zona) || ''),
    tipoComprobante: 'nota',
    boleta: $('#desp-boleta').value.trim(),
    monto: Number($('#desp-monto').value) || 0,
    repartidores: reps,
    notas: $('#desp-notas').value.trim(),
    estado: existente ? (existente.estado || 'reparto') : 'reparto',
    creditoId: existente ? (existente.creditoId || '') : '',
    creado: existente ? existente.creado : Date.now(),
    creadoPor: existente ? existente.creadoPor : quienSoy(),
    registrado: existente ? (existente.registrado || existente.creado || Date.now()) : Date.now(),
  };
  try {
    await guardarDespachoEnStore(despacho);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo guardar el despacho. Revisa tu conexión.');
    return;
  }
  const idx = despachos.findIndex(d => d.id === id);
  if (idx >= 0) despachos[idx] = despacho; else despachos.push(despacho);
  despachoActivoId = id;
  toast(existente ? '✅ Despacho actualizado' : '✅ Despacho creado');
  abrirDetalleDespacho(id);
}

function abrirDetalleDespacho(id) {
  despachoActivoId = id;
  mostrarVistaDespacho('detalle');
  renderDetalleDespacho();
}

function renderDetalleDespacho() {
  const d = despachoPorId(despachoActivoId);
  if (!d) { mostrarVistaDespacho('lista'); renderListaDespachos(); return; }
  const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
  const reps = repartidoresDe(d);
  const comprobante = d.boleta
    ? `${tipoComprobanteLabel(d.tipoComprobante)} N° ${escapeHtml(d.boleta)}`
    : tipoComprobanteLabel(d.tipoComprobante);
  $('#desp-det-title').textContent = d.cliente || 'Despacho';
  $('#desp-det-info').innerHTML = `
    <div class="desp-det-estado"><span class="ped-chip ${info.clase}">${info.etiqueta}</span></div>
    <div class="desp-det-fila"><span>🧾 Comprobante</span><strong>${comprobante}</strong></div>
    <div class="desp-det-fila"><span>💵 Monto</span><strong>${formatoMonto(Number(d.monto) || 0)}</strong></div>
    <div class="desp-det-fila"><span>🗓️ Emisión</span><strong>${formatoFecha(d.emision || d.fecha)}</strong></div>
    <div class="desp-det-fila"><span>📦 Despacho</span><strong>${formatoFecha(d.fecha)}</strong></div>
    ${d.zona ? `<div class="desp-det-fila"><span>📍 Zona</span><strong>${escapeHtml(d.zona)}</strong></div>` : ''}
    <div class="desp-det-fila"><span>🧍 Repartidores</span><strong>${reps.length ? reps.map(escapeHtml).join(', ') : '—'}</strong></div>
    ${d.notas ? `<div class="desp-det-fila"><span>📝 Nota</span><strong>${escapeHtml(d.notas)}</strong></div>` : ''}
    <div class="desp-det-fila desp-det-meta"><span>Registrado por</span><strong>${escapeHtml(d.creadoPor || '—')}${d.registrado ? ' · ' + (horaDeTimestamp(d.registrado) || '') : ''}</strong></div>`;

  let acciones = '';
  if (d.estado === 'credito' && d.creditoId) {
    acciones = `
      <button type="button" class="btn btn-primary btn-block" id="btn-desp-ver-credito">📄 Ver crédito enlazado</button>
      <button type="button" class="btn btn-secondary btn-block" data-desp-estado="reparto">↩️ Deshacer enlace (volver a “en reparto”)</button>`;
  } else {
    // Solo la acción principal: cuando la boleta vuelve firmada, se convierte
    // en crédito. (Se quitaron "Al contado" y "Devuelto".)
    acciones = `
      <button type="button" class="btn btn-primary btn-block" id="btn-desp-a-credito">📄 Volvió firmada → crear crédito</button>`;
  }
  $('#desp-det-acciones').innerHTML = acciones;
}

/* Cambia el estado del despacho abierto (al contado / devuelto / en reparto) */
async function cambiarEstadoDespacho(estado) {
  const d = despachoPorId(despachoActivoId);
  if (!d) return;
  const actualizado = { ...d, estado };
  if (estado !== 'credito') actualizado.creditoId = '';
  try {
    await guardarDespachoEnStore(actualizado);
  } catch (e) {
    toast('❌ No se pudo guardar. Revisa tu conexión.');
    return;
  }
  const idx = despachos.findIndex(x => x.id === d.id);
  if (idx >= 0) despachos[idx] = actualizado;
  renderDetalleDespacho();
  toast(`✅ Marcado: ${estadoDespachoInfo(estado).etiqueta}`);
}

async function borrarDespachoActual() {
  const d = despachoPorId(despachoActivoId);
  if (!d) return;
  if (!confirm(`¿Borrar el despacho de ${d.cliente || 'este cliente'} (boleta ${d.boleta || '—'})?`)) return;
  try {
    await eliminarDespachoDeStore(d.id);
  } catch (e) {
    toast('❌ No se pudo borrar. Revisa tu conexión.');
    return;
  }
  despachos = despachos.filter(x => x.id !== d.id);
  despachoActivoId = null;
  toast('🗑️ Despacho borrado');
  mostrarVistaDespacho('lista');
  renderListaDespachos();
}

/* Abre el formulario de crédito ya prellenado con los datos del despacho.
   Al guardar el crédito, el despacho queda marcado "a crédito" y enlazado
   (la foto de la boleta firmada y las notas se guardan en el crédito). */
function crearCreditoDesdeDespacho(id) {
  if (!puede('crear')) { toast('🔒 No tienes permiso para crear créditos'); return; }
  const d = despachoPorId(id);
  if (!d) return;
  despachoOrigen = d.id;
  abrirFormulario(null, {
    desdeDespacho: true,
    boleta: d.boleta || '',
    clienteId: d.clienteId || '',
    clienteNombre: d.cliente || '',
    zona: d.zona || '',
    monto: Number(d.monto) || 0,
    fechaEmision: d.emision || d.fecha || '',
    fechaDespacho: d.fecha || '',
  });
}

/* Enlaza el despacho de origen con el crédito recién creado */
async function vincularDespachoConCredito(despachoId, credito) {
  const d = despachoPorId(despachoId);
  if (!d) return;
  const actualizado = { ...d, estado: 'credito', creditoId: credito.id };
  try {
    await guardarDespachoEnStore(actualizado);
    const idx = despachos.findIndex(x => x.id === d.id);
    if (idx >= 0) despachos[idx] = actualizado;
  } catch (e) {
    console.error('No se pudo enlazar el despacho con el crédito:', e);
  }
}

function verCreditoDeDespacho(id) {
  const d = despachoPorId(id);
  const c = d && d.creditoId && creditos.find(x => x.id === d.creditoId);
  if (c) abrirInfo(c);
  else toast('El crédito enlazado ya no existe');
}

/* ====== Repartidores ====== */
function abrirRepartidores() {
  mostrarVistaDespacho('repartidores');
  $('#rep-form').reset();
  renderRepartidores();
}

function renderRepartidores() {
  const cont = $('#repartidores-list');
  const lista = repartidores.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  $('#repartidores-vacio').hidden = lista.length > 0;
  cont.innerHTML = lista.map(r => `
    <div class="repartidor-item">
      <span>🧍 ${escapeHtml(r.nombre)}</span>
      <button type="button" class="btn btn-danger btn-small" data-borrar-repartidor="${r.id}">Quitar</button>
    </div>`).join('');
}

/* Alta de un repartidor. Devuelve el repartidor creado, o null si hubo error
   o el nombre estaba repetido (en ese caso ya se avisó por toast). */
async function crearRepartidor(nombre) {
  nombre = (nombre || '').trim();
  if (!puede('despachos')) return null;
  if (!nombre) { toast('⚠️ Escribe un nombre'); return null; }
  if (repartidores.some(r => (r.nombre || '').toLowerCase() === nombre.toLowerCase())) {
    toast('⚠️ Ese repartidor ya está en la lista'); return null;
  }
  const r = { id: nuevoId(), nombre, activo: true, creado: Date.now() };
  try {
    await guardarRepartidorEnStore(r);
  } catch (e) {
    toast('❌ No se pudo guardar. Revisa tu conexión.');
    return null;
  }
  if (!repartidores.some(x => x.id === r.id)) repartidores.push(r);
  renderRepartidores();
  return r;
}

// Alta desde la vista de gestión de repartidores (formulario propio)
async function agregarRepartidor(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const r = await crearRepartidor($('#rep-nombre').value);
  if (r) { $('#rep-form').reset(); toast('✅ Repartidor agregado'); }
}

// Modal bonito para agregar un repartidor al vuelo desde el formulario de despacho
function abrirModalRepNuevo() {
  if (!puede('despachos')) { toast('🔒 No tienes permiso para armar despachos'); return; }
  $('#rep-nuevo-nombre').value = '';
  $('#modal-rep-nuevo').showModal();
  $('#rep-nuevo-nombre').focus();
}

async function guardarRepNuevoForm(ev) {
  ev.preventDefault();
  // Si estás armando un despacho, recordamos qué repartidores ya tenías marcados
  const enForm = !$('#view-despachos').hidden && !$('#desp-vista-form').hidden;
  const seleccion = enForm ? repartidoresSeleccionados() : null;
  const r = await crearRepartidor($('#rep-nuevo-nombre').value);
  if (!r) return;  // error o repetido: el aviso ya salió, el modal sigue abierto
  $('#modal-rep-nuevo').close();
  toast('✅ Repartidor agregado');
  if (seleccion) {
    if (!seleccion.includes(r.nombre)) seleccion.push(r.nombre);
    renderRepartidoresCheck(seleccion);
  }
}

async function borrarRepartidor(id) {
  const r = repartidores.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Quitar a "${r.nombre}" de la lista de repartidores?`)) return;
  try {
    await eliminarRepartidorDeStore(id);
  } catch (e) {
    toast('❌ No se pudo quitar. Revisa tu conexión.');
    return;
  }
  repartidores = repartidores.filter(x => x.id !== id);
  renderRepartidores();
  toast('🗑️ Repartidor quitado');
}

/* Muestra dentro del formulario el motivo por el que no se pudo guardar y
   lleva la vista hasta ahí (el aviso flotante se va solo en 2,6 s).
   `accion` opcional: { texto, alTocar } agrega un botón para resolverlo. */
function errorFormulario(msg, campoId, accion = null) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = false;
  if (accion) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-small form-error-btn';
    btn.textContent = accion.texto;
    btn.addEventListener('click', accion.alTocar);
    el.appendChild(btn);
  }
  toast(msg);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (campoId) { const c = $('#' + campoId); if (c && !c.disabled) c.focus({ preventScroll: true }); }
}
function limpiarErrorFormulario() {
  const el = $('#form-error');
  if (el) { el.textContent = ''; el.hidden = true; }
}

/* La boleta ya tenía su crédito: se enlaza el despacho con ese crédito que ya
   existe (en vez de crear uno repetido) y el despacho pasa a "a crédito". */
async function vincularDespachoACreditoExistente(credito) {
  const origen = despachoOrigen;
  if (!origen) { toast('⚠️ No hay un despacho por enlazar'); return; }
  const d = despachoPorId(origen);
  if (d && d.cliente && credito.cliente
      && d.cliente.trim().toLowerCase() !== credito.cliente.trim().toLowerCase()) {
    if (!confirm(`El despacho es de "${d.cliente}" y el crédito Nº ${credito.boleta} es de "${credito.cliente}".\n\n¿Enlazarlos de todos modos?`)) return;
  }
  await vincularDespachoConCredito(origen, credito);
  despachoOrigen = null;
  limpiarErrorFormulario();
  modalForm.close();
  render();   // ya refresca la vista de despachos si está abierta
  toast(`🔗 Despacho enlazado con el crédito Nº ${credito.boleta}`);
}

async function guardarCredito(ev) {
  ev.preventDefault();
  limpiarErrorFormulario();

  const id = $('#f-id').value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const boleta = $('#f-boleta').value.trim();

  // Evita boletas duplicadas (excepto al editar la misma). Si el crédito venía
  // de un despacho, ese crédito ya existe: se ofrece enlazarlo en vez de crear
  // uno repetido.
  const duplicado = creditos.find(c => c.boleta.toLowerCase() === boleta.toLowerCase() && c.id !== id);
  if (duplicado) {
    const desdeDespacho = !$('#f-id').value && despachoOrigen;
    errorFormulario(
      `⚠️ Ya existe un crédito con la boleta Nº ${boleta} (cliente: ${duplicado.cliente}).`
        + (desdeDespacho
          ? ' Puedes enlazar este despacho con ese crédito.'
          : ' Cambia el número o abre ese crédito.'),
      'f-boleta',
      desdeDespacho
        ? { texto: '🔗 Vincular con ese crédito', alTocar: () => vincularDespachoACreditoExistente(duplicado) }
        : null);
    return;
  }

  // Cliente: viene de la lista registrada (o, en créditos antiguos, del nombre suelto)
  const valorCliente = $('#f-cliente').value;
  let clienteNombre = '', clienteId = '', zona = $('#f-zona').value;
  if (valorCliente.startsWith('libre:')) {
    clienteNombre = valorCliente.slice(6);
  } else {
    const cli = clientePorId(valorCliente);
    if (!cli) {
      errorFormulario('⚠️ Elige un cliente de la lista (o toca “➕ Nuevo” para registrarlo).', 'f-cliente-buscar');
      return;
    }
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
    abonos = pagoInicial > 0 ? [{
      monto: pagoInicial,
      fecha,
      metodo: $('#f-pago-metodo').value,
      // Constancia automática: quién lo registró, en qué día y a qué hora
      registradoPor: quienSoy(),
      registradoFecha: hoyISO(),
      registrado: Date.now(),
    }] : [];
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
    // Resguardo: si no es el administrador, el vencimiento del crédito que ya
    // existe no se toca (aunque el campo se hubiera desbloqueado a la fuerza)
    vencimiento: (existente && !puedeCambiarVencimiento())
      ? existente.vencimiento
      : $('#f-vencimiento').value,
    abonos,
    notas: $('#f-notas').value.trim(),
    foto: fotoActual,
    creado: existente ? existente.creado : Date.now(),
    // Se conserva el compromiso de pago anotado por quien cobra (editar el
    // crédito no debe borrarlo), junto con su constancia
    compromiso: existente ? (existente.compromiso || null) : null,
    compromisoPor: existente ? (existente.compromisoPor || null) : null,
    compromisoEn: existente ? (existente.compromisoEn || null) : null,
  };
  credito.estado = estadoCalculado(credito);  // pagado / parcial / pendiente automático

  try {
    await guardarEnStore(credito);
  } catch (e) {
    console.error(e);
    // Causa más común: la foto hace que el registro pase del límite de 1 MB
    const pesada = credito.foto && credito.foto.length > 700000;
    errorFormulario(pesada
      ? '❌ No se pudo guardar: la foto es demasiado pesada. Quítala y toma otra más de cerca (o guarda el crédito sin foto).'
      : '❌ No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }

  const idx = creditos.findIndex(c => c.id === id);
  if (idx >= 0) creditos[idx] = credito; else creditos.push(credito);

  // Si el crédito nació de un despacho, enlázalos y márcalo "a crédito"
  const origen = existente ? null : despachoOrigen;
  despachoOrigen = null;
  if (origen) await vincularDespachoConCredito(origen, credito);

  modalForm.close();
  render();
  toast(existente ? '✅ Crédito actualizado' : (origen ? '✅ Crédito creado y despacho enlazado' : '✅ Crédito guardado'));
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
  const datos = { version: 3, exportado: new Date().toISOString(), settings, creditos, clientes, despachos, repartidores };
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
    if (Array.isArray(datos.despachos)) {
      for (const d of datos.despachos) {
        await guardarDespachoEnStore(d);
        if (!modoNube) {
          const i = despachos.findIndex(x => x.id === d.id);
          if (i >= 0) despachos[i] = d; else despachos.push(d);
        }
      }
    }
    if (Array.isArray(datos.repartidores)) {
      for (const r of datos.repartidores) {
        await guardarRepartidorEnStore(r);
        if (!modoNube) {
          const i = repartidores.findIndex(x => x.id === r.id);
          if (i >= 0) repartidores[i] = r; else repartidores.push(r);
        }
      }
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
  // Si se cancela un crédito que venía de un despacho, se descarta el enlace pendiente
  modalForm.addEventListener('close', () => { despachoOrigen = null; });
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
  $('#btn-cliente-nuevo').addEventListener('click', abrirModalClienteForm);
  $('#btn-clientes').addEventListener('click', abrirClientes);
  $('#btn-clientes-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#btn-cli-registrar').addEventListener('click', abrirModalClienteForm);
  $('#cli-form').addEventListener('submit', guardarClienteForm);
  $('#btn-cli-cancelar').addEventListener('click', () => $('#modal-cliente-form').close());
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
    const crearBoleta = ev.target.closest('[data-crear-boleta]');
    const anular = ev.target.closest('[data-anular]');
    const desanular = ev.target.closest('[data-desanular]');
    const verFoto = ev.target.closest('[data-ver-foto]');
    const verFirma = ev.target.closest('[data-ver-firma]');
    const verFotoInfo = ev.target.closest('[data-ver-foto-info]');
    const quitarAbono = ev.target.closest('[data-quitar-abono]');
    const editarFecha = ev.target.closest('[data-editar-fecha]');
    const confirmarFecha = ev.target.closest('[data-confirmar-fecha]');
    const cancelarFecha = ev.target.closest('[data-cancelar-fecha]');
    const editarVenc = ev.target.closest('[data-editar-venc]');
    const confirmarVenc = ev.target.closest('[data-confirmar-venc]');
    const cancelarVenc = ev.target.closest('[data-cancelar-venc]');
    const editarComp = ev.target.closest('[data-editar-compromiso]');
    const confirmarComp = ev.target.closest('[data-confirmar-compromiso]');
    const cancelarComp = ev.target.closest('[data-cancelar-compromiso]');
    const quitarComp = ev.target.closest('[data-quitar-compromiso]');
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
    } else if (ev.target.closest('#faltantes-aviso')) {
      revisarFaltantes();
    } else if (anular) {
      anularBoleta(anular.dataset.anular);
    } else if (desanular) {
      quitarAnulacion(desanular.dataset.desanular);
    } else if (crearBoleta) {
      // Fila "hueco": crear la nota de venta que falta, con el N° ya puesto
      if (puede('crear')) abrirFormulario(null, { boleta: crearBoleta.dataset.crearBoleta });
    } else if (editar) {
      const c = creditos.find(x => x.id === editar.dataset.editar);
      if (c) abrirFormulario(c);
    } else if (borrar) {
      borrarCredito(borrar.dataset.borrar);
    } else if (quitarAbono) {
      quitarAbonoConCodigo(Number(quitarAbono.dataset.quitarAbono));
    } else if (editarFecha) {
      iniciarEdicionFechaAbono(Number(editarFecha.dataset.editarFecha));
    } else if (confirmarFecha) {
      confirmarEdicionFechaAbono(Number(confirmarFecha.dataset.confirmarFecha));
    } else if (cancelarFecha) {
      cancelarEdicionFechaAbono();
    } else if (editarVenc) {
      iniciarEdicionVencimiento();
    } else if (confirmarVenc) {
      confirmarEdicionVencimiento();
    } else if (cancelarVenc) {
      cancelarEdicionVencimiento();
    } else if (editarComp) {
      iniciarEdicionCompromiso();
    } else if (confirmarComp) {
      guardarCompromiso($('#compromiso-edit-input').value);
    } else if (quitarComp) {
      guardarCompromiso('');
    } else if (cancelarComp) {
      cancelarEdicionCompromiso();
    } else if (verFoto) {
      const c = creditos.find(x => x.id === verFoto.dataset.verFoto);
      if (c && c.foto) abrirVisorImagen(c);
    }
  });
  $('#btn-cerrar-imagen').addEventListener('click', () => $('#modal-imagen').close());
  // Zoom del visor: pellizco, doble toque, arrastre y botones ➕ / ➖
  prepararZoomImagen();
  const centroPantalla = () => {
    const c = $('#imagen-scroll').getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  };
  $('#btn-zoom-mas').addEventListener('click', () => {
    const p = centroPantalla(); zoomHacia(zoomEscala * 1.5, p.x, p.y);
  });
  $('#btn-zoom-menos').addEventListener('click', () => {
    const p = centroPantalla(); zoomHacia(zoomEscala / 1.5, p.x, p.y);
  });
  $('#modal-imagen').addEventListener('close', reiniciarZoomImagen);
  $('#btn-rotar-imagen').addEventListener('click', rotarImagenVisor);
  $('#btn-guardar-rotacion').addEventListener('click', guardarRotacionImagen);

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
  $('#btn-cob-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#btn-cob-excel').addEventListener('click', exportarCobranzaExcel);
  $('#btn-cob-imprimir').addEventListener('click', imprimirCobranza);
  $('#btn-hoja-crear').addEventListener('click', () => crearHojaCobranza($('#cob-fecha').value || hoyISO()));
  $('#btn-hoja-cerrar').addEventListener('click', () => cerrarHojaCobranza($('#cob-fecha').value || hoyISO()));

  // ====== Despachos ======
  $('#btn-despachos').addEventListener('click', abrirDespachos);
  $('#btn-desp-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#btn-desp-nuevo').addEventListener('click', () => abrirFormDespacho());
  $('#btn-desp-repartidores').addEventListener('click', abrirRepartidores);
  $('#desp-form').addEventListener('submit', guardarDespachoForm);
  $('#btn-desp-editar').addEventListener('click', () => {
    const d = despachoPorId(despachoActivoId);
    if (d) abrirFormDespacho(d);
  });
  $('#btn-desp-borrar').addEventListener('click', borrarDespachoActual);
  // Agregar un repartidor al vuelo desde el formulario (modal bonito)
  $('#btn-desp-rep-rapido').addEventListener('click', abrirModalRepNuevo);
  $('#form-rep-nuevo').addEventListener('submit', guardarRepNuevoForm);
  $('#btn-rep-nuevo-cancelar').addEventListener('click', () => $('#modal-rep-nuevo').close());

  // Buscador de clientes del formulario de despacho (igual que en créditos)
  const cajaCliDesp = $('#desp-cliente-buscar');
  const listaCliDesp = $('#desp-cliente-sugerencias');
  cajaCliDesp.addEventListener('input', () => renderSugerenciasDesp(cajaCliDesp.value));
  cajaCliDesp.addEventListener('focus', () => renderSugerenciasDesp(cajaCliDesp.value));
  cajaCliDesp.addEventListener('click', () => renderSugerenciasDesp(cajaCliDesp.value));
  listaCliDesp.addEventListener('pointerdown', ev => {
    const op = ev.target.closest('.combo-op');
    if (!op) return;
    ev.preventDefault();
    seleccionarClienteDesp(op.dataset.id);
  });
  cajaCliDesp.addEventListener('keydown', ev => {
    const ops = [...listaCliDesp.querySelectorAll('.combo-op')];
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (listaCliDesp.hidden) { renderSugerenciasDesp(cajaCliDesp.value); return; }
      if (!ops.length) return;
      comboIndiceDesp = ev.key === 'ArrowDown'
        ? (comboIndiceDesp + 1) % ops.length
        : (comboIndiceDesp - 1 + ops.length) % ops.length;
      ops.forEach((o, i) => o.classList.toggle('activa', i === comboIndiceDesp));
      ops[comboIndiceDesp].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      if (!listaCliDesp.hidden) {
        ev.preventDefault();
        if (comboIndiceDesp >= 0 && ops[comboIndiceDesp]) seleccionarClienteDesp(ops[comboIndiceDesp].dataset.id);
        else if (ops.length === 1) seleccionarClienteDesp(ops[0].dataset.id);
        else cerrarSugerenciasDesp();
      }
    } else if (ev.key === 'Escape') {
      if (!listaCliDesp.hidden) { ev.preventDefault(); ev.stopPropagation(); cerrarSugerenciasDesp(); }
    }
  });
  cajaCliDesp.addEventListener('blur', () => {
    cerrarSugerenciasDesp();
    const texto = cajaCliDesp.value.trim();
    const exacto = texto ? clientePorNombre(texto) : null;
    if (!texto) $('#desp-cliente').value = '';
    else if (exacto) $('#desp-cliente').value = exacto.id;
    cajaCliDesp.value = textoCliente($('#desp-cliente').value);
    aplicarClienteDespacho();
  });
  $('#btn-desp-cliente-nuevo').addEventListener('click', abrirModalClienteForm);

  // Repartidores
  $('#rep-form').addEventListener('submit', agregarRepartidor);
  $('#repartidores-list').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-borrar-repartidor]');
    if (btn) borrarRepartidor(btn.dataset.borrarRepartidor);
  });

  // Botones "◀ Volver" de las distintas vistas de la sección de despachos
  $('#view-despachos').addEventListener('click', ev => {
    if (ev.target.closest('[data-desp-volver]')) {
      mostrarVistaDespacho('lista');
      renderListaDespachos();
    }
  });

  // Lista de despachos: abrir uno (funciona en la tabla y en las tarjetas)
  $('#desp-vista-lista').addEventListener('click', ev => {
    const fila = ev.target.closest('[data-abrir-despacho]');
    if (fila) abrirDetalleDespacho(fila.dataset.abrirDespacho);
  });

  // Buscar despachos por día
  $('#desp-fecha-filtro').addEventListener('change', ev => {
    despachoFiltroFecha = ev.target.value || null;
    renderListaDespachos();
  });
  $('#desp-dias').addEventListener('change', ev => {
    despachoFiltroFecha = ev.target.value || null;
    renderListaDespachos();
  });
  $('#btn-desp-dia-ant').addEventListener('click', () => saltarDiaDespacho(-1));
  $('#btn-desp-dia-sig').addEventListener('click', () => saltarDiaDespacho(1));
  $('#btn-desp-hoy').addEventListener('click', () => { despachoFiltroFecha = hoyISO(); renderListaDespachos(); });
  $('#btn-desp-todos').addEventListener('click', () => { despachoFiltroFecha = null; renderListaDespachos(); });
  $('#btn-desp-imprimir').addEventListener('click', imprimirDespachos);

  // Casillas de repartidores del formulario: marcar/desmarcar resalta la fila
  $('#desp-repartidores-check').addEventListener('change', ev => {
    const lbl = ev.target.closest('.desp-rep-check');
    if (lbl) lbl.classList.toggle('activo', ev.target.checked);
  });

  // Acciones del detalle de un despacho (crear/ver crédito, cambiar estado)
  $('#desp-det-acciones').addEventListener('click', ev => {
    const est = ev.target.closest('[data-desp-estado]');
    if (est) { cambiarEstadoDespacho(est.dataset.despEstado); return; }
    if (ev.target.closest('#btn-desp-a-credito')) { crearCreditoDesdeDespacho(despachoActivoId); return; }
    if (ev.target.closest('#btn-desp-ver-credito')) { verCreditoDeDespacho(despachoActivoId); return; }
  });

  // Panel lateral (escritorio): mismos destinos que la cabecera
  $('#nav-inicio').addEventListener('click', () => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    mostrarSeccion('creditos');
  });
  $('#nav-dashboard').addEventListener('click', () => mostrarSeccion('dashboard'));
  // Cabecera (celular): en el teléfono no hay panel lateral, así que Dashboard
  // y Créditos también necesitan su botón arriba para poder ir y volver.
  $('#btn-dashboard').addEventListener('click', () => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    mostrarSeccion('dashboard');
  });
  $('#btn-creditos').addEventListener('click', () => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    mostrarSeccion('creditos');
  });
  $('#btn-dash-nuevo').addEventListener('click', () => abrirFormulario());
  $('#btn-dash-cobranza').addEventListener('click', () => { if (puede('cobranza')) abrirCobranza(); else toast('🔒 No tienes permiso'); });
  $('#nav-despachos').addEventListener('click', abrirDespachos);
  $('#nav-clientes').addEventListener('click', abrirClientes);
  $('#nav-cobranza').addEventListener('click', () => { if (puede('cobranza')) abrirCobranza(); });
  $('#nav-usuarios').addEventListener('click', () => { if (esAdmin()) abrirUsuarios(); });
  $('#nav-settings').addEventListener('click', () => $('#btn-settings').click());

  // Configuración
  $('#btn-settings').addEventListener('click', () => {
    $('#s-dias').value = settings.dias;
    $('#s-moneda').value = settings.moneda;
    $('#s-avisos').checked = settings.avisos !== false;
    $('#s-atajo1').value = settings.atajo1;
    $('#s-atajo2').value = settings.atajo2;
    actualizarEstadoPin();
    renderEstadoOffline();
    renderConfigHojaAuto();
    $('#settings-dashboard').hidden = !esAdmin();
    $('#s-dashboard-empleados').checked = !!settings.dashboardEmpleados;
    // Los ajustes del negocio los define el administrador para todos
    const soloAdmin = modoNube && !esAdmin();
    ['s-dias', 's-moneda', 's-atajo1', 's-atajo2'].forEach(id => { $('#' + id).disabled = soloAdmin; });
    $('#settings-nota-admin').hidden = !soloAdmin;
    mostrarSeccion('settings');
  });
  // Apertura automática: mostrar/ocultar el detalle al activar la casilla
  $('#s-hoja-auto').addEventListener('change', () => {
    $('#s-hoja-auto-detalle').hidden = !$('#s-hoja-auto').checked;
  });
  $('#s-hoja-dias').addEventListener('change', ev => {
    const lbl = ev.target.closest('.hoja-dia');
    if (lbl) lbl.classList.toggle('activo', ev.target.checked);
  });
  $('#btn-preparar-offline').addEventListener('click', prepararOffline);
  $('#btn-settings-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#settings-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    settings.dias = Math.max(1, Number($('#s-dias').value) || 30);
    settings.moneda = $('#s-moneda').value.trim() || '$';
    settings.avisos = $('#s-avisos').checked;
    settings.atajo1 = Math.min(365, Math.max(1, Number($('#s-atajo1').value) || 15));
    settings.atajo2 = Math.min(365, Math.max(1, Number($('#s-atajo2').value) || 45));
    // Apertura automática de la hoja de cobranza (solo el admin la puede tocar)
    if (esAdmin()) {
      settings.hojaAutoActiva = $('#s-hoja-auto').checked;
      settings.hojaAutoDias = Array.from(document.querySelectorAll('#s-hoja-dias input:checked'))
        .map(c => Number(c.value)).sort((a, b) => a - b);
      settings.hojaAutoHora = $('#s-hoja-hora').value || '08:00';
      settings.dashboardEmpleados = $('#s-dashboard-empleados').checked;
    }
    actualizarAtajosVenc();
    mostrarSeccion('creditos');
    render();
    sincronizarNavLateral();
    revisarAperturaAutomatica();
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

  // Menú del usuario: "Mi perfil" y "Configuración"
  $('#btn-cuenta').addEventListener('click', ev => {
    ev.stopPropagation();
    alternarMenuUsuario();
  });
  $('#btn-mi-perfil').addEventListener('click', () => {
    cerrarMenuUsuario();
    mostrarSeccion('settings');
    // "Mi perfil" lleva directo al bloque de la cuenta dentro de Configuración
    requestAnimationFrame(() => {
      const bloque = $('#settings-cuenta');
      if (bloque) bloque.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  $('#btn-mi-config').addEventListener('click', () => {
    cerrarMenuUsuario();
    mostrarSeccion('settings');
  });
  // Cerrar el menú al tocar fuera o con Escape
  document.addEventListener('click', ev => {
    if (!$('#usuario-menu').hidden && !ev.target.closest('.usuario-menu-wrap')) cerrarMenuUsuario();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !$('#usuario-menu').hidden) cerrarMenuUsuario();
  });

  // Tooltip de los gráficos del Dashboard (dona, barras, línea): se delega
  // porque los gráficos se vuelven a dibujar en cada actualización.
  $('#view-dashboard').addEventListener('pointermove', ev => {
    // En celulares/tablets (dedo) no se muestran tooltips: evita que se
    // queden "pegados" en pantalla tras un toque y trabajo innecesario al hacer scroll.
    if (ev.pointerType && ev.pointerType !== 'mouse') { ocultarTooltipGrafico(); return; }
    const el = ev.target.closest('[data-tip-label]');
    if (!el) { ocultarTooltipGrafico(); return; }
    mostrarTooltipGrafico(ev, el.dataset.tipColor, el.dataset.tipLabel, el.dataset.tipValue);
  });
  $('#view-dashboard').addEventListener('pointerleave', ocultarTooltipGrafico);

  // Cuando termina una animación de entrada, se libera: mientras una animación
  // CSS sigue "activa" (aunque ya haya terminado, por el fill-mode), le gana
  // en la cascada a reglas normales como :hover sobre la misma propiedad
  // (transform). Sin esto, las tarjetas con animación de entrada no podrían
  // levantarse al pasar el cursor.
  document.addEventListener('animationend', ev => {
    if (['entrarArriba', 'aparecer', 'brotarDona', 'crecerBarra', 'dibujarLinea'].includes(ev.animationName)) {
      ev.target.style.animation = 'none';
    }
  });

  // Panel de administración de usuarios (solo admin)
  $('#btn-usuarios').addEventListener('click', abrirUsuarios);
  $('#btn-usuarios-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#u-form-nuevo').addEventListener('submit', crearUsuario);
  $('#u-admin').addEventListener('change', ev => { $('#u-permisos-detalle').style.display = ev.target.checked ? 'none' : ''; });
  $('#usuarios-list').addEventListener('change', ev => {
    const cb = ev.target.closest('[data-perm]');
    if (cb) cambiarPermiso(cb.dataset.uid, cb.dataset.perm, cb.checked);
  });
  $('#usuarios-list').addEventListener('click', ev => {
    const btnBorrar = ev.target.closest('[data-borrar-usuario]');
    if (btnBorrar) { borrarUsuario(btnBorrar.dataset.borrarUsuario); return; }
    const btnClave = ev.target.closest('[data-resetear-clave]');
    if (btnClave) restablecerContrasenaEmpleado(btnClave.dataset.resetearClave, btnClave.dataset.usuarioNombre);
  });

  sincronizarNavLateral();
}

/* ====== Inicio ====== */
async function iniciarLocal() {
  try {
    creditos = await DB.getAll();
    clientes = await DB.getAllClientes();
    despachos = await DB.getAllDespachos();
    repartidores = await DB.getAllRepartidores();
    anulados = await DB.getAllAnulados();
    ordenarClientes();
  } catch (e) {
    toast('❌ No se pudo abrir la base de datos local');
    creditos = [];
    clientes = [];
    despachos = [];
    repartidores = [];
    anulados = [];
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
  mostrarSeccion(seccionDeInicio());
  render();

  // Avisa cuando se va y cuando vuelve el internet (la app sigue funcionando igual)
  window.addEventListener('online', actualizarAvisoConexion);
  window.addEventListener('offline', actualizarAvisoConexion);
  // Al cambiar el tamaño de la ventana, la tabla vuelve a llegar hasta abajo
  window.addEventListener('resize', ajustarTablasFijas);
  // Girar la tablet cambia el ancho de golpe: hay que volver a medir
  window.addEventListener('orientationchange', () => setTimeout(ajustarTablasFijas, 250));
  // La tipografía propia llega después del primer dibujo y mueve los anchos:
  // sin volver a medir, la tabla podía quedarse con el corrimiento lateral
  // puesto (y con él, los títulos dejaban de pegarse arriba).
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarTablasFijas);
  $('#btn-sincronizar').addEventListener('click', sincronizarAhora);

  // Apertura automática de la hoja de cobranza: se revisa cada pocos minutos
  // y cada vez que se vuelve a la app, para que abra sola al llegar la hora.
  setInterval(revisarAperturaAutomatica, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarAperturaAutomatica(); });
  window.addEventListener('focus', revisarAperturaAutomatica);

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

  actualizarAvisoConexion();

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
