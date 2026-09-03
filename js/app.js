import { descargarXlsx } from './xlsx-lite.js';
import { vigilarIconos } from './iconos.js';

/* ====== Estado global ====== */
let creditos = [];
let clientes = [];        // base de datos de clientes: { id, nombre, zona, direccion, telefono, notas, creado }
let hojas = [];           // hojas de cobranza creadas: { fecha, creada, creadaPor, creadaEn, cerrada, cerradaPor, cerradaEn }
let despachos = [];       // despachos (viajes de reparto): { id, fecha, repartidor, carguero, notas, cerrado, creado, creadoPor, pedidos: [...] }
let repartidores = [];    // lista de repartidores (solo nombres): { id, nombre, activo, creado }
let anulados = [];        // notas de venta anuladas: { id (nº boleta), boleta, motivo, anuladoPor, anuladoEn }
let productos = [];       // catálogo: { id, codigo, nombre, presentacion, precioA, precioB, precioC, stockMin, activo, creado }
let kardex = [];          // movimientos de almacén: { id, fecha, productoId, tipo, cantidad, motivo, documento, usuario, creado }
let notas = [];           // notas de venta emitidas: { id, numero, clienteId, items[], total, emitidaPor, creado }
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
  // Cabecera de la nota de venta impresa. El nombre del negocio y su teléfono
  // no van: el papel ya los trae impresos de imprenta.
  empresaDireccion: 'MADRE DE DIOS - TAMBOPATA - TAMBOPATA',
  empresaRuc: '',
};
let vencimientoEditadoManual = false;

/* Modo nube (Firebase) */
let modoNube = false;
/* Se pone en `true` recién cuando de verdad se sabe qué puede ver este
   usuario: en modo local, en cuanto se confirma que es local (ahí no hay
   restricciones); en la nube, en cuanto llega su ficha con sus permisos.
   Antes de eso —cargando el SDK de Firebase, esperando la respuesta de la
   nube tras recargar la página— puede() ya contesta bien, pero solo porque
   trata "todavía no sé" como "no", salvo un caso: mientras el SDK de
   Firebase se está cargando, `modoNube` sigue en `false` y puede() lo lee
   como modo local (todo permitido). Sin esta bandera, un empleado que
   recargara la página tenía ese instante para entrar a un apartado que no
   le tocaba —y quedarse ahí, aunque el botón desapareciera un momento
   después—. Con ella, mostrarSeccion() no abre nada que no sea neutral
   hasta que se sepa de verdad. */
let accesoResuelto = false;
let fb = null;            // SDK y referencias de Firebase
let unsubSnapshot = null; // cancela la suscripción en tiempo real
let unsubClientes = null; // suscripción en tiempo real de la lista de clientes
let unsubAjustes = null;  // suscripción a la configuración del negocio
let unsubSeguridad = null; // suscripción al código de seguridad
let unsubHojas = null;    // suscripción a las hojas de cobranza creadas
let unsubDespachos = null; // suscripción a los despachos (viajes de reparto)
let unsubRepartidores = null; // suscripción a la lista de repartidores
let unsubAnulados = null;     // suscripción a las notas de venta anuladas
let unsubProductos = null;    // suscripción al catálogo de productos
let unsubKardex = null;       // suscripción a los movimientos de almacén
let unsubNotas = null;        // suscripción a las notas de venta
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
/* Un administrador no pasa por puede() —lo tiene todo— pero su ficha se guarda
   con todos los permisos marcados igual, para que se lea bien. Se arma sola a
   partir de la lista, así no vuelve a quedarse corta al aparecer uno nuevo. */
let PERMISOS_TODOS = {};
function esAdmin() { return modoNube && !!(yo && yo.rol === 'admin'); }
/* En modo local hay un solo dueño y manda igual que un administrador (es el
   mismo criterio que ya se usa para quitar una "a cuenta"). */
function mandaComoAdmin() { return !modoNube || esAdmin(); }
/* De qué permiso VIEJO hereda cada permiso nuevo cuando la ficha del usuario
   todavía no lo tiene marcado. Sin esto, al partir los permisos en pedazos más
   finos, todo el equipo se habría quedado sin poder hacer lo que ya hacía. */
const PERMISO_HEREDA_DE = {
  clientes: 'crear',
  clientesBorrar: 'clientes',
  ventas: 'crear',
  ventasEditar: 'ventas',
  ventasAnular: 'ventas',
  preciosEditar: 'ventas',
  cobranzaExportar: 'cobranza',
  despachosCerrar: 'despachos',
  productosEditar: 'productos',
  ingresos: 'productos',
  ajustes: 'productos',
  kardex: 'productos',
};

/* Si ese miembro tiene ese permiso, mirando también de qué hereda. Es lo mismo
   que hace puede(), pero para OTRO usuario: en la pantalla de Usuarios hay que
   enseñar marcado lo que esa persona puede hacer de verdad, no solo lo que
   alguien marcó a mano alguna vez. */
function tienePermiso(miembro, nombre) {
  const permisos = (miembro && miembro.permisos) || {};
  const valor = permisos[nombre];
  if (valor !== undefined) return !!valor;
  const padre = PERMISO_HEREDA_DE[nombre];
  return padre ? tienePermiso(miembro, padre) : false;
}

function puede(nombre) {
  if (!modoNube) return true;         // modo local: un solo dueño, todo permitido
  if (yo && yo.rol === 'admin') return true;
  if (!yo || !yo.permisos) return false;
  const valor = yo.permisos[nombre];
  if (valor !== undefined) return !!valor;
  // Sin marcar: se mira de qué permiso viejo hereda (encadenado, porque
  // "ventasEditar" hereda de "ventas" y "ventas" a su vez de "crear").
  const padre = PERMISO_HEREDA_DE[nombre];
  if (padre) return puede(padre);
  // Los permisos que no heredan de nada se conceden a propósito
  return false;
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
const ZONAS = ['MODELO', '3 DE MAYO', 'CIUDAD', 'MILAGROS', 'CARRETERA', 'PADRE ALDAMIZ', 'ALAMEDA', 'LABERINTO', 'PAMPA'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MAX_ABONOS = 8;

/* Métodos de pago (como tu hoja de cobranza: efectivo / Yape / BCP) */
const METODOS = { efectivo: '💵 Efectivo', yape: '📱 Yape', bcp: '🏦 BCP' };
function metodoDe(a) { return (a && a.metodo && METODOS[a.metodo]) ? a.metodo : 'efectivo'; }
function metodoLabel(m) { return METODOS[m] || METODOS.efectivo; }

function abonosDe(c) { return Array.isArray(c.abonos) ? c.abonos : []; }

/* ====== Categorías de precio ======
   Cada cliente tiene una categoría (A, B o C) y cada producto tiene un precio
   para cada una. Al armar la nota de venta, el precio sale de cruzar las dos. */
const CATEGORIAS = {
  A: { nombre: 'A', detalle: 'Mayorista' },
  B: { nombre: 'B', detalle: 'Intermedio' },
  C: { nombre: 'C', detalle: 'Menudeo' },
};
function categoriaDe(cliente) {
  const c = String((cliente && cliente.categoria) || '').toUpperCase();
  return CATEGORIAS[c] ? c : 'C';   // sin categoría, se cobra el precio de menudeo
}

/* Presentaciones y su abreviatura para la columna U.M. de la nota impresa */
const PRESENTACIONES = {
  balde: { nombre: 'Balde', um: 'BLD' },
  caja: { nombre: 'Caja', um: 'CJA' },
  saco: { nombre: 'Saco', um: 'SAC' },
  paquete: { nombre: 'Paquete', um: 'PQT' },
  unidad: { nombre: 'Unidad', um: 'UND' },
};
function presentacionDe(p) {
  const v = String((p && p.presentacion) || '').toLowerCase();
  return PRESENTACIONES[v] ? v : 'unidad';
}
function umDe(p) { return PRESENTACIONES[presentacionDe(p)].um; }

/* Movimientos del kardex. "salida" resta del stock, "entrada" suma;
   el ajuste sirve para cuadrar con el conteo físico del almacén. */
const TIPOS_KARDEX = {
  entrada: { nombre: 'Entrada', signo: 1, icono: '📥' },
  salida: { nombre: 'Salida', signo: -1, icono: '📤' },
  ajuste: { nombre: 'Ajuste', signo: 1, icono: '⚖️' },
};
const MOTIVOS_KARDEX = {
  compra: 'Compra a proveedor',
  devolucion_cliente: 'Devolución de cliente',
  venta: 'Venta (nota de venta)',
  anulacion: 'Anulación de nota de venta',
  devuelto: 'Devuelto en el reparto',
  merma: 'Merma o producto malogrado',
  traslado: 'Traslado a otro almacén',
  inventario: 'Conteo físico (inventario)',
  otro: 'Otro',
};

/* Quién está usando la app ahora (para dejar constancia en cada "a cuenta").
   Cada persona es su usuario y nada más: es lo que se lee en las notas de
   venta, en el kardex y en las hojas de cobranza. */
function quienSoy() {
  if (!modoNube || !yo) return 'dueño';
  return yo.usuario || 'dueño';
}

/* ¿Esta anotación la hizo el que está usando la app ahora? Se compara con la
   firma ya traducida, así también reconoce lo que quedó anotado con algún
   nombre que se usara antes. */
function esMio(quien) {
  if (!modoNube || !yo || !quien) return false;
  return mostrarComo(quien) === (yo.usuario || '');
}

/* Cómo se enseña una firma guardada. Lo anotado hace meses puede llevar el
   correo entero con el que se entraba entonces, o algún nombre para mostrar
   de cuando el sistema tenía esa opción; aquí se traduce al usuario de esa
   persona, así todo el historial se lee igual sin tocar ni un dato guardado. */
let equipo = {};          // firma antigua → usuario que la hizo
function mostrarComo(quien) {
  const q = String(quien || '').trim();
  return equipo[q] || q;
}

/* El dueño se dio de alta con su correo y después se creó un usuario corto
   para no escribirlo cada vez. Son la MISMA persona, pero lo firmado antes
   lleva el correo y lo de ahora el usuario corto, así que sin esto saldría
   como dos cobradores distintos en la hoja de cobranza y en el kardex.

   No hay nada que elegir: si el dueño entra con un correo y hay UN solo
   administrador más con usuario corto, es él. Si hubiera varios no se
   adivina —se dejan como están—, porque entonces sí podrían ser personas
   distintas de verdad. */
function firmaDelDuenoConSuUsuarioCorto(miembros) {
  const dueno = miembros.find(m => m.uid === ownerUid);
  if (!dueno || !dueno.usuario || !dueno.usuario.includes('@')) return null;
  const cortos = miembros.filter(m => m.uid !== ownerUid && m.rol === 'admin'
    && m.usuario && !m.usuario.includes('@'));
  return cortos.length === 1 ? { correo: dueno.usuario, usuario: cortos[0].usuario } : null;
}

async function cargarEquipo() {
  if (!modoNube || !ownerUid) return;
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'usuarios', ownerUid, 'miembros'));
    const miembros = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const mapa = {};
    miembros.forEach(m => {
      if (!m || !m.usuario) return;
      // Todo lo que alguna vez identificó a esta persona lleva a su usuario:
      // el nombre para mostrar que tuvo y los nombres con los que firmó antes.
      if (m.nombre && m.nombre !== m.usuario) mapa[m.nombre] = m.usuario;
      (m.nombresPrevios || []).forEach(viejo => {
        if (viejo && viejo !== m.usuario) mapa[viejo] = m.usuario;
      });
    });
    const doble = firmaDelDuenoConSuUsuarioCorto(miembros);
    if (doble && !mapa[doble.correo]) mapa[doble.correo] = doble.usuario;
    equipo = mapa;
    // Aprovechando que ya está el equipo delante: si alguna ficha se quedó sin
    // los permisos nuevos, se le escriben. Si no, la nube le rechaza cosas que
    // la app sí le deja hacer.
    escribirPermisosHeredados();
    if (fb.auth.currentUser) {
      guardarAccesoLocal(fb.auth.currentUser.uid, { ownerUid, yo, equipo });
    }
  } catch (e) {
    // Sin conexión se sigue con el mapa que hubiera guardado el dispositivo
  }
}

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
  // Igual que boletaEntera: el último grupo de dígitos, no todos juntos
  return numeroDeComprobante((d && d.boleta) || '') || Infinity;
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
  // Una hoja cerrada no se toca por ningún lado: sacar un cobro también la
  // descuadra. Para corregir algo hay que reabrirla primero.
  if (a && a.fecha && hojaCerrada(a.fecha)) return false;
  if (esAdmin()) return true;
  if (!a || !a.registradoFecha) return false;   // "a cuenta" antigua: solo el admin
  return a.registradoFecha === hoyISO() && esMio(a.registradoPor);
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

/* La fecha en que el cliente quedó en pagar, para la columna de la lista.
   Se avisa igual que el vencimiento (hoy o pasada, en rojo) porque un
   compromiso incumplido es justo lo que hay que salir a cobrar. */
function textoCompromisoTabla(c) {
  if (!c.compromiso) return '<span class="sin-compromiso-celda">—</span>';
  const fecha = formatoFecha(c.compromiso);
  if (saldoDe(c) <= 0) return fecha;
  const dias = diasHastaVencimiento(c.compromiso);
  if (dias < 0) return `<span class="venc-alerta">${fecha}<br><small>(no cumplió)</small></span>`;
  if (dias === 0) return `<span class="venc-alerta">${fecha}<br><small>(¡es hoy!)</small></span>`;
  if (dias <= 5) return `<span class="venc-pronto">${fecha}<br><small>(en ${dias} día${dias === 1 ? '' : 's'})</small></span>`;
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

/* Hora en formato de 12 horas con a. m. / p. m. — "2:32 p. m."
   En 24 horas ("14:32") el equipo tenía que hacer la cuenta mentalmente, y en
   una hoja de cobranza firmada la hora importa: se escribe como se habla. */
function hora12(d) {
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;   // medianoche y mediodía son las 12
  return `${h12}:${mm} ${sufijo}`;
}

/* Reloj de la cabecera. Va con segundos y con a. m. / p. m., igual que el resto
   de las horas de la app, para no tener que traducir del formato de 24 horas. */
function pintarReloj() {
  const hora = document.getElementById('reloj-hora');
  if (!hora) return;
  const ahora = new Date();
  const h = ahora.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;   // medianoche y mediodía son las 12
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  const ss = String(ahora.getSeconds()).padStart(2, '0');
  hora.textContent = `${h12}:${mm}:${ss} ${h < 12 ? 'a. m.' : 'p. m.'}`;

  const fecha = ahora.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('reloj-fecha').textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
}

function arrancarReloj() {
  pintarReloj();
  setInterval(pintarReloj, 1000);
}

/* "29/07/2026 a las 2:32 p. m." — vacío mientras el servidor no confirme la hora */
function fechaHoraDeTimestamp(ts) {
  const d = momentoDe(ts);
  if (!d) return '';
  return `${formatoFecha(fechaDeTimestamp(ts))} a las ${hora12(d)}`;
}

/* Fecha y hora en que se registró una "a cuenta". Si es un pago antiguo
   que no guardó la hora, se muestra solo la fecha. */
function textoRegistrado(a) {
  return a.registrado ? fechaHoraDeTimestamp(a.registrado) : formatoFecha(a.registradoFecha);
}

/* Solo la hora "2:32 p. m." de un timestamp. Vacío si no se guardó la hora. */
function horaDeTimestamp(ts) {
  const d = momentoDe(ts);
  return d ? hora12(d) : '';
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
  if (!confirm(`¿Cerrar la hoja de cobranza del ${formatoFecha(fechaISO)}?\n\n`
    + 'Ya no entrará ni saldrá ningún cobro de ese día. Si hiciera falta, podrás reabrirla con tu código.')) return;
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

/* Vuelve a abrir una hoja ya cerrada. Como estando cerrada no entra nada, esta
   es la única puerta: la abre el administrador con su código y queda anotado
   quién la reabrió, para que no sea un agujero silencioso. */
async function reabrirHojaCobranza(fechaISO) {
  if (!esAdmin()) { toast('🔒 Solo el administrador puede reabrir la hoja'); return; }
  const h = hojaDe(fechaISO);
  if (!h || !h.cerrada) { toast('Esa hoja no está cerrada'); return; }
  if (!confirm(`¿Reabrir la hoja de cobranza del ${formatoFecha(fechaISO)}?\n\n`
    + 'Volverán a poder registrarse cobros de ese día. Acuérdate de cerrarla otra vez.')) return;
  const autorizado = await pedirPin(`Vas a reabrir la hoja de cobranza del ${formatoFecha(fechaISO)}.`, 'reabrir');
  if (!autorizado) { toast('🔒 Cancelado'); return; }
  try {
    await actualizarHojaEnStore(fechaISO, {
      cerrada: false,
      reabiertaPor: quienSoy(),
      reabiertaEn: marcaDeTiempo(),
    });
    const i = hojas.findIndex(x => x.fecha === fechaISO);
    if (i >= 0) hojas[i] = { ...h, cerrada: false, reabiertaPor: quienSoy(), reabiertaEn: null };
    renderCobranza();
    toast(`🔓 Hoja del ${formatoFecha(fechaISO)} reabierta`);
  } catch (e) {
    console.error(e);
    toast('❌ No se pudo reabrir la hoja de cobranza');
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
        cobradoPor: mostrarComo(a.registradoPor) || '',
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
/* Abre un cuadro sin que el teclado del celular salte solo.
   showModal() le da el foco al primer campo que encuentra dentro, y en el
   celular eso hace aparecer el teclado nada más abrir, tapando media pantalla
   antes de que la persona haya decidido qué quiere tocar. Aquí se abre y se le
   quita el foco a ese campo. Los cuadros donde SÍ se quiere escribir de
   entrada (el código de seguridad, el nombre de un cliente nuevo) piden el
   foco a propósito y no pasan por esta función. */
function abrirSinTeclado(dlg) {
  dlg.showModal();
  const activo = document.activeElement;
  if (activo && activo !== dlg && dlg.contains(activo)
      && /^(INPUT|TEXTAREA|SELECT)$/.test(activo.tagName)) {
    // El foco se pasa al propio cuadro (por eso lleva tabindex="-1") en vez de
    // soltarlo del todo: así el recorrido con el tabulador y los lectores de
    // pantalla siguen dentro del formulario, pero sin teclado en pantalla.
    dlg.focus();
  }
}

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
const CLAVES_NEGOCIO = ['dias', 'moneda', 'atajo1', 'atajo2', 'hojaAutoActiva', 'hojaAutoDias', 'hojaAutoHora', 'dashboardEmpleados',
  'empresaDireccion', 'empresaRuc'];

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
function puedeVerDashboard() {
  if (!modoNube || esAdmin()) return true;
  // El administrador decide si el equipo ve el Dashboard, y además cada
  // usuario tiene que tener el permiso: las dos cosas, no una u otra.
  return !!settings.dashboardEmpleados && puede('dashboard');
}

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
/* ms que esperamos a que la nube confirme el acceso al abrir la app. Pasado
   ese tiempo se entra con el acceso guardado en el equipo (ver conLimite). */
const ESPERA_ACCESO = 6000;

/* Traduce el fallo de la nube a algo que se pueda leer y arreglar.
   El más engañoso es 'permission-denied': no es el internet, son las reglas
   de la base de datos, que hay que volver a publicar cada vez que la app
   estrena una sección nueva. Decir "revisa tu conexión" ahí manda a buscar
   el problema donde no está. */
function motivoDeFallo(e) {
  const codigo = String((e && (e.code || e.message)) || '');
  if (/permission-denied|PERMISSION_DENIED|insufficient permissions/i.test(codigo)) {
    return '🔒 La base de datos rechazó el cambio. No es tu internet: faltan publicar las reglas de Firestore (mira el README, "Si sale No se pudo guardar"). Avísale al administrador.';
  }
  if (/unauthenticated/i.test(codigo)) {
    return '🔒 Tu sesión caducó. Cierra sesión y vuelve a entrar.';
  }
  if (/unavailable|deadline|network/i.test(codigo)) {
    return '📴 Sin conexión con la nube ahora mismo. El cambio quedó guardado aquí y subirá solo.';
  }
  return '';
}

/* Mensaje para el usuario: el motivo exacto si se conoce, y si no el genérico */
function avisoDeFallo(e, generico) {
  return motivoDeFallo(e) || generico;
}

function escrituraNube(promesa, queEs) {
  let seguimosSinEsperar = false;
  const vigilada = promesa.then(() => null, e => e);

  // Aviso para el error que llega tarde (ya habíamos seguido adelante)
  vigilada.then(err => {
    if (!err) return;
    console.error(`No se pudo sincronizar ${queEs}:`, err);
    if (seguimosSinEsperar) {
      toast(avisoDeFallo(err, `⚠️ Un cambio no se pudo subir a la nube (${queEs})`));
    }
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

/* ---- Productos, kardex y notas de venta ---- */
async function guardarProductoEnStore(p) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'productos', p.id), p),
      `producto ${p.nombre}`);
  } else {
    await DB.putProducto(p);
  }
}

async function eliminarProductoDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'productos', id)), 'borrado de un producto');
  } else {
    await DB.deleteProducto(id);
  }
}

async function guardarKardexEnStore(m) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'kardex', m.id), m),
      'movimiento de almacén');
  } else {
    await DB.putKardex(m);
  }
}

async function eliminarKardexDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'kardex', id)), 'borrado de un movimiento');
  } else {
    await DB.deleteKardex(id);
  }
}

async function guardarNotaEnStore(n) {
  if (modoNube) {
    await escrituraNube(
      fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'notas', n.id), n),
      `nota de venta ${n.numero}`);
  } else {
    await DB.putNota(n);
  }
}

async function eliminarNotaDeStore(id) {
  if (modoNube) {
    await escrituraNube(
      fb.deleteDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'notas', id)), 'borrado de una nota de venta');
  } else {
    await DB.deleteNota(id);
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

  /* Sin señal —o peor, con una conexión que se queda colgada y no falla ni
     responde— Firebase Auth puede no llegar NUNCA a avisar quién había
     entrado. La app se quedaba entonces esperando para siempre: ni entraba ni
     mostraba la pantalla de acceso, que es justo el "no sucede nada" que se
     ve al quitar el internet. Por eso se le pone un plazo: pasado ese tiempo
     se entra con el acceso guardado en este equipo (que para eso se guarda) y
     se trabaja con los datos del dispositivo. */
  let authRespondio = false;
  authMod.onAuthStateChanged(auth, usuario => {
    authRespondio = true;
    if (usuario) sesionIniciada(usuario);
    else sesionCerrada();
  });
  setTimeout(() => {
    if (authRespondio) return;
    const guardado = ultimoAccesoLocal();
    if (guardado && entrarConAccesoGuardado({ uid: guardado.uid })) return;
    // Sin copia guardada no hay nada que enseñar: al menos que se vea la
    // pantalla de acceso en vez de una app vacía y muda.
    $('#auth-screen').hidden = false;
    banner('📴 Sin conexión con la nube. Conéctate una vez para poder usar la app en este dispositivo.');
  }, ESPERA_ACCESO);
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

/* ====== Copia local de lo que llega de la nube ======
   Firestore ya guarda lo suyo en el dispositivo, pero cuando la conexión se
   queda colgada —hay wifi y el celular cree que hay internet, pero no llega
   nada— tarda en decidirse a servir lo guardado, y mientras tanto la lista
   sale vacía: es el "no cargan los datos" de siempre. Con esta copia la app
   pinta los créditos al instante y la nube los actualiza cuando conteste.
   Se guarda sin la foto grande de la boleta (que sí queda en la caché de
   Firestore): así la copia es liviana y no duplica decenas de megas. */
const DUENO_COPIA = 'creditos-copia-de';
let copiaPendiente = null;
function guardarCopiaLocal(lista) {
  clearTimeout(copiaPendiente);
  copiaPendiente = setTimeout(() => {
    // Sin la foto grande de la boleta: la copia es solo para arrancar rápido
    const liviano = lista.map(({ foto, ...resto }) => resto);
    DB.guardarEspejo(liviano)
      .then(() => { try { localStorage.setItem(DUENO_COPIA, ownerUid || ''); } catch (e) {} })
      .catch(() => { /* sin espacio: manda la nube */ });
  }, 2000);
}

/* Pinta lo que este equipo ya tenía guardado, mientras la nube contesta. Si la
   nube ya contestó (hay créditos en pantalla), no se toca nada. */
async function pintarCopiaLocal() {
  if (!modoNube || creditos.length) return;
  // La copia es de un negocio concreto: si entra otra cuenta, no se enseña
  try { if (localStorage.getItem(DUENO_COPIA) !== ownerUid) return; } catch (e) { return; }
  try {
    const guardados = await DB.getAllEspejo();
    if (guardados.length && !creditos.length) {
      creditos = guardados;
      render();
    }
  } catch (e) { /* no había copia */ }
}

/* El acceso guardado en este equipo, sin saber de qué usuario es. Hace falta
   cuando Firebase Auth ni siquiera llega a decirnos quién había entrado. */
function ultimoAccesoLocal() {
  try {
    for (const clave of Object.keys(localStorage)) {
      if (!clave.startsWith('creditos-acceso-')) continue;
      const datos = JSON.parse(localStorage.getItem(clave));
      if (datos && datos.ownerUid && datos.yo) {
        return { uid: clave.slice('creditos-acceso-'.length), ...datos };
      }
    }
  } catch (e) { /* nada guardado */ }
  return null;
}

/* Al iniciar sesión: averigua el dueño (o lo crea la 1ª vez), lee la membresía
   del usuario y aplica sus permisos. Si no es miembro, deniega el acceso.
   Sin internet se usa la copia guardada en este dispositivo. */
/* Le pone un límite de tiempo a una consulta a la nube. Sin señal, la consulta
   puede tardar bastante en rendirse y mientras tanto la app se queda en
   blanco. Solo se usa cuando este equipo YA tiene guardado el acceso: si se
   agota el tiempo, se entra con esa copia y se sigue trabajando con los datos
   del dispositivo. Sin copia guardada no se limita, para no cortar por corto
   un primer inicio de sesión con conexión lenta. */
function conLimite(promesa, ms) {
  if (!ms) return promesa;
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('sin respuesta de la nube')), ms)),
  ]);
}

async function sesionIniciada(usuario) {
  const limite = leerAccesoLocal(usuario.uid) ? ESPERA_ACCESO : 0;
  try {
    const cfgRef = fb.doc(fb.db, 'config', 'app');
    let cfgSnap = await conLimite(fb.getDoc(cfgRef), limite);

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
    const miDoc = await conLimite(fb.getDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', usuario.uid)), limite);
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
    cargarEquipo();   // los nombres del equipo, para leer las firmas antiguas
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
  equipo = guardado.equipo || {};
  abrirSesionEnPantalla();
  servirDeLoGuardado();
  toast('📴 Sin internet: trabajando con los datos de este dispositivo');
  return true;
}

/* Se entra sin respuesta de la nube, así que se le dice a Firestore que sirva
   YA lo que hay guardado en el dispositivo. Sin esto se queda esperando a una
   conexión que no llega y las listas tardaban más de medio minuto en salir,
   con la app abierta pero vacía. Enseguida se vuelve a habilitar la red en
   segundo plano: cuando la conexión aparezca, se sincroniza y sube lo
   pendiente sin que nadie tenga que hacer nada. */
function servirDeLoGuardado() {
  if (!modoNube || !fb) return;
  datosDesdeCache = true;
  // Sin await: la promesa puede tardar en cumplirse si la conexión quedó
  // colgada, pero el efecto —servir de lo guardado— no depende de eso.
  try { fb.disableNetwork(fb.db).catch(() => {}); } catch (e) { return; }
  actualizarAvisoConexion();
  // Se vuelve a habilitar la red aparte (no encadenado a la promesa anterior,
  // que podría no cumplirse nunca): al aparecer la conexión, sube lo pendiente.
  setTimeout(() => { try { fb.enableNetwork(fb.db).catch(() => {}); } catch (e) {} }, 4000);
}

function abrirSesionEnPantalla() {
  // Ya se sabe qué puede ver: `yo` trae su ficha real (de la nube o, sin
  // internet, la copia que se guardó la última vez que sí contestó).
  accesoResuelto = true;
  $('#auth-screen').hidden = true;
  $('#settings-cuenta').hidden = false;
  $('#cuenta-email').textContent = `${yo.usuario}${esAdmin() ? ' (administrador)' : ''}`;
  mostrarAliasDeAcceso();
  banner(null);
  aplicarPermisos();
  // Recién ahora se sabe si el destino de entrada de verdad le toca: al
  // arrancar, mostrarSeccion() aterrizó en Créditos porque todavía no se
  // sabía nada (ver puedeVerSeccion). Se corrige al que corresponde.
  mostrarSeccion(seccionDeInicio());
  cargarSeguridad();        // copia local mientras llega la de la nube
  suscribirConfigNube();
  suscribirNube();
  pintarCopiaLocal();
}

function sesionCerrada() {
  // Si después entra otro usuario en la misma pestaña (sin recargar), su
  // acceso también tiene que esperar a que se sepa de verdad.
  accesoResuelto = false;
  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
  if (unsubClientes) { unsubClientes(); unsubClientes = null; }
  if (unsubAjustes) { unsubAjustes(); unsubAjustes = null; }
  if (unsubSeguridad) { unsubSeguridad(); unsubSeguridad = null; }
  if (unsubHojas) { unsubHojas(); unsubHojas = null; }
  if (unsubDespachos) { unsubDespachos(); unsubDespachos = null; }
  if (unsubRepartidores) { unsubRepartidores(); unsubRepartidores = null; }
  if (unsubAnulados) { unsubAnulados(); unsubAnulados = null; }
  // Almacén: sin cancelarlos se quedaban escuchando los datos del que se fue,
  // y su catálogo y su stock seguían en pantalla al entrar otro usuario.
  if (unsubProductos) { unsubProductos(); unsubProductos = null; }
  if (unsubKardex) { unsubKardex(); unsubKardex = null; }
  if (unsubNotas) { unsubNotas(); unsubNotas = null; }
  creditos = [];
  clientes = [];
  hojas = [];
  despachos = [];
  repartidores = [];
  anulados = [];
  productos = [];
  kardex = [];
  notas = [];
  equipo = {};
  ownerUid = null;
  yo = null;
  migracionRevisada = false;
  cambiosPendientes = false;
  datosDesdeCache = true;
  avisarConexionServidor = null;
  actualizarAvisoConexion();
  render();
  // Y se repintan las tablas del almacén: si no, sus filas se quedan puestas
  // aunque los datos ya se hayan vaciado.
  renderProductos();
  renderKardex();
  renderIngresos();
  renderVentas();
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
    guardarCopiaLocal(creditos);
    // hasPendingWrites: hay cambios guardados aquí que aún no llegaron al servidor
    cambiosPendientes = snap.metadata.hasPendingWrites;
    marcarOrigenDatos(snap);
    actualizarAvisoConexion();
    render();
    avisoAlAbrir();
    // Las fotos que lleguen nuevas también necesitan su copia chica
    cargarMiniaturas().then(() => { renderListaCreditos(); prepararMiniaturas(); });
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

  if (unsubProductos) unsubProductos();
  unsubProductos = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'productos'), snap => {
    productos = snap.docs.map(d => d.data());
    ordenarProductos();
    if (!$('#view-productos').hidden) renderProductos();
    if (!$('#view-kardex').hidden) renderKardex();
    if (!$('#view-ventas').hidden) renderVentas();
  }, err => {
    console.error('Error al sincronizar los productos:', err);
  });

  if (unsubKardex) unsubKardex();
  unsubKardex = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'kardex'), snap => {
    kardex = snap.docs.map(d => d.data());
    if (!$('#view-kardex').hidden) renderKardex();
    if (!$('#view-productos').hidden) renderProductos();
  }, err => {
    console.error('Error al sincronizar el kardex:', err);
  });

  if (unsubNotas) unsubNotas();
  unsubNotas = fb.onSnapshot(fb.collection(fb.db, 'usuarios', ownerUid, 'notas'), snap => {
    notas = snap.docs.map(d => d.data());
    if (!$('#view-ventas').hidden) renderVentas();
  }, err => {
    console.error('Error al sincronizar las notas de venta:', err);
  });
}

/* Muestra/oculta botones según los permisos del usuario actual */
function aplicarPermisos() {
  $('#btn-dashboard').hidden = !puedeVerDashboard();
  $('#btn-cobranza').hidden = !puede('cobranza');
  $('#btn-despachos').hidden = !puede('despachos');
  $('#btn-ventas').hidden = !puede('ventas');
  $('#btn-productos').hidden = !puede('productos');
  $('#btn-ingresos').hidden = !(puede('ingresos') || puede('ajustes'));
  $('#btn-kardex').hidden = !puede('kardex');
  $('#btn-usuarios').hidden = !esAdmin();
  $('#btn-cliente-nuevo').hidden = !puede('clientes');
  $('#usuario-chip').hidden = !modoNube;
  const nombreUsuario = (yo && yo.usuario) || '';
  $('#hdr-usuario').textContent = nombreUsuario;
  $('#hdr-avatar').textContent = inicialesDe(nombreUsuario);
  sincronizarNavLateral();
  // Un empleado sin acceso al Dashboard no debe quedarse viéndolo tras entrar
  if (seccionActual === 'dashboard' && !puedeVerDashboard()) mostrarSeccion('creditos');
  render(); // redibuja la tabla para aplicar permisos de editar/borrar
}

/* El panel lateral (escritorio) refleja los mismos permisos que la cabecera */
/* ---- Contraer el panel lateral ----
   La preferencia se guarda en el equipo: quien trabaja en una pantalla justa
   lo deja contraído y no tiene que volver a plegarlo cada vez que abre. */
const CLAVE_NAV_PLEGADA = 'creditos-nav-plegada';

function aplicarPlegadoNav(plegada) {
  document.body.classList.toggle('nav-plegada', plegada);
  const btn = $('#btn-plegar-nav');
  if (btn) {
    // Contraído el panel se abre solo al pasar el cursor, así que el botón no
    // "despliega": lo deja fijo abierto. Se dice tal cual.
    btn.title = plegada ? 'Dejar el menú fijo abierto' : 'Contraer el menú';
    btn.setAttribute('aria-label', btn.title);
    const txt = btn.querySelector('.nav-txt');
    if (txt) txt.textContent = plegada ? 'Dejarlo fijo' : 'Contraer menú';
  }
  // En pantalla angosta el ☰ no habla del panel contraído sino del cajón:
  // ahí el estado lo lleva abrirCajonNav().
  const menu = $('#btn-menu');
  if (menu && !enPantallaAngosta()) menu.setAttribute('aria-expanded', String(!plegada));
  // Las tablas se miden solas contra el ancho disponible, que acaba de cambiar
  if (typeof ajustarTablasFijas === 'function') requestAnimationFrame(ajustarTablasFijas);
}

function alternarNav() {
  const plegada = !document.body.classList.contains('nav-plegada');
  localStorage.setItem(CLAVE_NAV_PLEGADA, plegada ? '1' : '0');
  aplicarPlegadoNav(plegada);
  // Al terminar la transición el ancho ya es el definitivo: se vuelve a medir
  setTimeout(ajustarTablasFijas, 280);
}

/* ---- El panel como cajón (teléfono y tablet vertical) ----
   En PC el panel está siempre a la vista y el ☰ lo contrae. En una pantalla
   estrecha no cabe, así que el mismo botón lo abre y lo cierra. */
function enPantallaAngosta() {
  return window.matchMedia('(max-width: 999px)').matches;
}

/* El cajón arranca justo debajo de la barra de arriba, para que el ☰ siga a la
   vista y cierre con el mismo toque con el que abrió. El alto de esa barra no
   es fijo —depende de lo que quepa en cada pantalla—, así que se mide y se
   deja en una variable de CSS. */
function medirCabecera() {
  const cab = document.querySelector('.app-header');
  if (!cab) return;
  document.documentElement.style.setProperty('--alto-cabecera', Math.round(cab.getBoundingClientRect().height) + 'px');
}

function abrirCajonNav(abrir) {
  document.body.classList.toggle('nav-abierta', abrir);
  const menu = $('#btn-menu');
  if (menu) menu.setAttribute('aria-expanded', String(abrir));
  // Con el cajón cerrado sus destinos no deben poder alcanzarse con el
  // tabulador, que los recorrería fuera de la pantalla.
  const panel = $('#nav-lateral');
  if (panel) panel.setAttribute('aria-hidden', String(!abrir));
}

function cerrarCajonNav() {
  if (document.body.classList.contains('nav-abierta')) abrirCajonNav(false);
}

function alternarMenu() {
  if (enPantallaAngosta()) abrirCajonNav(!document.body.classList.contains('nav-abierta'));
  else alternarNav();
}

function sincronizarNavLateral() {
  const items = {
    'nav-dashboard': puedeVerDashboard(),
    'nav-ventas': puede('ventas'),
    'nav-productos': puede('productos'),
    'nav-ingresos': puede('ingresos') || puede('ajustes'),
    'nav-kardex': puede('kardex'),
    'nav-despachos': puede('despachos'),
    'nav-clientes': true,
    'nav-cobranza': puede('cobranza'),
    'nav-usuarios': esAdmin(),
  };
  for (const [id, visible] of Object.entries(items)) {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  }
  // Un grupo sin ningún destino visible dejaría su subtítulo colgando solo
  // (le pasa al empleado que no gestiona almacén): se oculta entero.
  document.querySelectorAll('.nav-grupo').forEach(grupo => {
    grupo.hidden = !grupo.querySelector('.nav-item:not([hidden])');
  });
}

/* ====== Router de apartados (cada uno es una sección de página, no un modal) ====== */
const SECCIONES = ['dashboard', 'creditos', 'ventas', 'productos', 'ingresos', 'kardex', 'despachos', 'clientes', 'cobranza', 'usuarios', 'settings'];
let seccionActual = 'dashboard';

/* Qué hace falta para entrar a cada apartado. No es solo para decidir qué
   botón mostrar en el menú: es el candado de VERDAD, el que revisa
   mostrarSeccion() antes de abrir nada.

   Por qué hace falta un candado aparte del menú: nada más entrar (o al
   recargar la página) el menú todavía no sabe qué le toca a este usuario
   —esos permisos llegan de la nube un instante después—, así que durante
   ese instante el menú puede mostrar apartados de más. Si mostrarSeccion()
   se fiara de que "si el botón está a la vista, se puede entrar", alcanzaba
   con tocarlo en ese instante para quedarse dentro aunque el botón
   desapareciera después. puede() ya contesta bien desde el primer momento
   (dice que no a todo salvo lo abierto a cualquiera mientras no se sepa más),
   así que apoyándose en eso el candado no depende de que el menú haya
   alcanzado a dibujarse. */
function puedeVerSeccion(nombre) {
  // Mientras no se sepa de verdad qué puede ver este usuario, solo lo
  // neutral: ni "todo" (podría ser un empleado) ni "nada" (se vería vacía
  // la app un instante hasta para el dueño). Créditos es lo único que
  // cualquier miembro ve siempre, así que es un destino seguro para esperar.
  if (!accesoResuelto) return nombre === 'creditos';
  switch (nombre) {
    case 'dashboard': return puedeVerDashboard();
    case 'ventas': return puede('ventas');
    case 'productos': return puede('productos');
    case 'ingresos': return puede('ingresos') || puede('ajustes');
    case 'kardex': return puede('kardex');
    case 'despachos': return puede('despachos');
    case 'cobranza': return puede('cobranza');
    case 'usuarios': return esAdmin();
    default: return true;   // creditos, clientes, settings: cualquier miembro
  }
}

function mostrarSeccion(nombre) {
  if (!SECCIONES.includes(nombre)) nombre = 'creditos';
  if (!puedeVerSeccion(nombre)) nombre = 'creditos';
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
  // Resaltar el destino activo en el panel lateral y en la cabecera
  const navId = nombre === 'creditos' ? 'nav-inicio' : 'nav-' + nombre;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('activo', b.id === navId));
  const btnId = { dashboard: 'btn-dashboard', creditos: 'btn-creditos', ventas: 'btn-ventas', productos: 'btn-productos', ingresos: 'btn-ingresos', kardex: 'btn-kardex', despachos: 'btn-despachos', clientes: 'btn-clientes', cobranza: 'btn-cobranza', usuarios: 'btn-usuarios', settings: 'btn-settings' }[nombre];
  document.querySelectorAll('.header-actions .btn-icon').forEach(b => b.classList.toggle('activo', b.id === btnId));
  window.scrollTo(0, 0);
  // Las tablas solo se pueden medir cuando su sección ya está visible
  if (['creditos', 'cobranza', 'productos', 'ingresos', 'kardex', 'ventas'].includes(nombre)) {
    requestAnimationFrame(ajustarTablasFijas);
  }
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
/* ══════════ Permisos, agrupados por sección ══════════
   Un permiso suelto no dice gran cosa; lo que se pregunta al dar de alta a
   alguien es "¿qué puede hacer en Notas de venta?". Así que van por sección,
   en el mismo orden en que están en el menú.

   Los que ya existían conservan su clave (crear, editar, pagos…): cambiarlas
   habría dejado sin permisos a todo el equipo. Los nuevos, más finos, heredan
   del viejo que los cubría (ver PERMISO_HEREDA_DE). */
const PERMISOS_SECCIONES = [
  ['📊 Dashboard', [
    ['dashboard', 'Ver el Dashboard'],
  ]],
  ['💳 Créditos', [
    ['crear', 'Crear créditos'],
    ['editar', 'Editar créditos'],
    ['pagos', 'Registrar cobros'],
    ['borrar', 'Borrar créditos'],
  ]],
  ['🧾 Hoja de cobranza', [
    ['cobranza', 'Ver la hoja de cobranza'],
    ['hojaCrear', 'Crear la hoja del día'],
    ['cobranzaExportar', 'Imprimir y exportar a Excel'],
  ]],
  ['🧑‍🤝‍🧑 Clientes', [
    ['clientes', 'Registrar y editar clientes'],
    ['clientesBorrar', 'Borrar clientes'],
  ]],
  ['🧮 Notas de venta', [
    ['ventas', 'Emitir notas de venta'],
    ['preciosEditar', 'Modificar precios al vender'],
    ['ventasEditar', 'Modificar notas ya emitidas'],
    ['ventasAnular', 'Anular notas de venta'],
  ]],
  ['📦 Despachos', [
    ['despachos', 'Armar despachos de reparto'],
    ['despachosCerrar', 'Cerrar el reparto (crédito o devuelto)'],
  ]],
  ['🛒 Productos', [
    ['productos', 'Ver el catálogo'],
    ['productosEditar', 'Crear y editar productos'],
  ]],
  ['📥 Ingreso de productos', [
    ['ingresos', 'Registrar mercadería que llega'],
    ['ajustes', 'Corregir stock, mermas y traslados'],
  ]],
  ['📒 Kardex', [
    ['kardex', 'Ver e imprimir el kardex'],
  ]],
];

/* La misma lista, en plano. Es lo que usan el alta y el guardado. */
const PERMISOS_LISTA = PERMISOS_SECCIONES.flatMap(([, permisos]) => permisos);
PERMISOS_TODOS = Object.fromEntries(PERMISOS_LISTA.map(([k]) => [k, true]));

// Nota: el permiso 'vencimiento' ya no se ofrece. Cambiar la fecha de
// vencimiento es solo del administrador; los empleados anotan la fecha de
// compromiso de pago, que no altera el vencimiento real del crédito.
// Borrar productos, anular movimientos del kardex y eliminar notas de venta
// tampoco se ofrecen: son del administrador y piden su código de seguridad.

/* Los permisos que se marcan al dar de alta salen de PERMISOS_LISTA, no de una
   copia escrita a mano en el HTML: así no vuelve a pasar que la lista del alta
   se quede corta cuando aparece un permiso nuevo. */
/* Lo que trae marcado un empleado nuevo: su trabajo del día a día. Lo que
   toca el almacén, borra cosas o cierra el reparto se concede a propósito.
   Cuando un permiso viejo venía marcado, los más finos que salieron de él
   vienen marcados también: si no, dar de alta a alguien le quitaría cosas que
   antes podía hacer. */
const PERMISOS_POR_DEFECTO = ['dashboard', 'crear', 'editar', 'pagos',
  'cobranza', 'cobranzaExportar', 'clientes', 'ventas', 'ventasEditar'];

/* Las casillas del alta, agrupadas por sección igual que en cada ficha */
function pintarPermisosDelAlta() {
  const caja = $('#u-perms-nuevo');
  if (!caja || caja.childElementCount) return;
  caja.innerHTML = PERMISOS_SECCIONES.map(([seccion, permisos]) => `
    <fieldset class="u-seccion">
      <legend>${escapeHtml(seccion)}</legend>
      ${permisos.map(([k, etiqueta]) => `
        <label class="u-perm"><input type="checkbox" id="u-perm-${k}"
          ${PERMISOS_POR_DEFECTO.includes(k) ? 'checked' : ''}>
          <span>${escapeHtml(etiqueta)}</span></label>`).join('')}
    </fieldset>`).join('');
}

/* Un administrador los tiene todos, así que las casillas sueltas sobran.
   Se mira la casilla en vez de recordarlo aparte: tras un reset del formulario
   el estado vuelve a cuadrar solo. */
function sincronizarPermisosDelAlta() {
  const detalle = $('#u-permisos-detalle');
  if (detalle) detalle.hidden = $('#u-admin').checked;
}

async function abrirUsuarios() {
  if (!esAdmin()) return;
  pintarPermisosDelAlta();
  await renderUsuarios();
  $('#u-form-nuevo').reset();
  sincronizarPermisosDelAlta();
  mostrarSeccion('usuarios');
}

async function renderUsuarios() {
  const cont = $('#usuarios-list');
  cont.innerHTML = '<p class="abonos-vacio">Cargando…</p>';
  // Antes de pintar: que lo que se enseñe marcado sea lo que hay escrito
  await escribirPermisosHeredados();
  let docs = [];
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'usuarios', ownerUid, 'miembros'));
    docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (e) {
    cont.innerHTML = '<p class="abonos-vacio">No se pudo cargar la lista.</p>';
    return;
  }
  // La cuenta del dueño se muestra aparte: no es un empleado al que dar o
  // quitar permisos, es con la que se dio de alta el negocio.
  const dueno = docs.find(m => m.uid === ownerUid);
  const cajaDueno = $('#usr-dueno');
  if (cajaDueno) {
    cajaDueno.hidden = !dueno;
    if (dueno) $('#usr-dueno-nombre').textContent = dueno.usuario || 'administrador';
  }
  const equipo = docs.filter(m => m.uid !== ownerUid);
  equipo.sort((a, b) => (a.rol === 'admin' ? -1 : 1) - (b.rol === 'admin' ? -1 : 1)
    || String(a.usuario || '').localeCompare(String(b.usuario || '')));
  $('#usuarios-vacio').hidden = !!equipo.length;

  cont.innerHTML = equipo.map(m => {
    const esJefe = m.rol === 'admin';
    // A un administrador no se le marcan permisos uno a uno: los tiene todos,
    // y las casillas hacían creer que alguno le faltaba.
    const permisosHtml = esJefe
      ? '<p class="usuario-todos">Todos los permisos</p>'
      : `<div class="usuario-perms">${PERMISOS_SECCIONES.map(([seccion, permisos]) => `
        <fieldset class="u-seccion">
          <legend>${escapeHtml(seccion)}</legend>
          ${permisos.map(([k, etiqueta]) => `
            <label class="u-perm"><input type="checkbox" data-perm="${k}" data-uid="${m.uid}"
              ${tienePermiso(m, k) ? 'checked' : ''}><span>${escapeHtml(etiqueta)}</span></label>`).join('')}
        </fieldset>`).join('')}</div>`;
    return `
      <article class="usuario-item${esJefe ? ' usuario-item-admin' : ''}">
        <div class="usuario-cab">
          <div class="usuario-id">
            <strong>${escapeHtml(m.usuario || '(sin usuario)')}</strong>
          </div>
          <span class="usuario-rol">${esJefe ? '👑 Administrador' : '👤 Empleado'}</span>
        </div>
        <div class="usuario-acciones">
          <button type="button" class="btn btn-secondary btn-small" data-resetear-clave="${m.uid}"
            data-usuario-nombre="${escapeHtml(m.usuario || '')}"
            title="Poner una contraseña nueva sin necesitar la anterior">🔑 Restablecer clave</button>
          <button type="button" class="btn btn-danger btn-small" data-borrar-usuario="${m.uid}">Quitar</button>
        </div>
        ${permisosHtml}
      </article>`;
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
  const pass = $('#u-pass').value;
  const rolAdmin = $('#u-admin').checked;
  if (!usuario || pass.length < 6) { toast('⚠️ Usuario y contraseña (mín. 6) son obligatorios'); return; }
  if (usuario.includes('@') || /\s/.test(usuario)) { toast('⚠️ El usuario no debe tener espacios ni @'); return; }

  const permisos = {};
  for (const [k] of PERMISOS_LISTA) {
    const casilla = $(`#u-perm-${k}`);
    permisos[k] = rolAdmin || !!(casilla && casilla.checked);
  }

  const boton = $('#btn-u-crear');
  boton.disabled = true;
  try {
    const uid = await crearUsuarioAuthSecundaria(usuarioAEmail(usuario), pass);
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', uid), {
      usuario, rol: rolAdmin ? 'admin' : 'empleado', permisos, creado: Date.now(),
    });
    toast(`✅ Usuario "${usuario}" creado`);
    $('#u-form-nuevo').reset();
    sincronizarPermisosDelAlta();
    await renderUsuarios();
  } catch (e) {
    console.error(e);
    toast(e.code === 'auth/email-already-in-use' ? '⚠️ Ese usuario ya existe' : '❌ No se pudo crear el usuario');
  } finally {
    boton.disabled = false;
  }
}

/* ====== Que la ficha diga lo que la nube va a obedecer ======
   La app deduce los permisos nuevos de los viejos: a quien podía "Emitir notas
   de venta" antes de que existiera "Modificar notas ya emitidas" se le da por
   heredado, para que nadie pierda de golpe algo que ya hacía. Pero las reglas
   de Firestore no deducen nada: miran la ficha y, si la clave no está, dicen
   que no. Resultado: la app le enseñaba el botón y la nube le rechazaba el
   cambio ("La base de datos rechazó el cambio"), que es de las cosas más
   desesperantes que le pueden pasar a alguien que solo quiere trabajar.

   Se arregla por donde toca: escribiendo en la ficha lo que hoy se deduce. A
   partir de ahí ficha, pantalla y nube dicen exactamente lo mismo. Es una
   escritura por empleado y una sola vez; luego no vuelve a hacer nada. */
async function escribirPermisosHeredados() {
  if (!modoNube || !esAdmin()) return 0;
  let arreglados = 0;
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'usuarios', ownerUid, 'miembros'));
    for (const d of snap.docs) {
      const m = { uid: d.id, ...d.data() };
      if (m.rol === 'admin') continue;          // los tiene todos por su rol
      const guardados = m.permisos || {};
      const faltan = PERMISOS_LISTA.filter(([k]) => guardados[k] === undefined);
      if (!faltan.length) continue;
      // Lo que la app venía dando por heredado, ahora por escrito
      const permisos = Object.fromEntries(
        PERMISOS_LISTA.map(([k]) => [k, tienePermiso(m, k)]));
      await fb.updateDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', m.uid), { permisos });
      arreglados++;
    }
  } catch (e) {
    console.error('No se pudieron poner por escrito los permisos heredados:', e);
  }
  if (arreglados) console.info(`Permisos puestos por escrito en ${arreglados} ficha(s)`);
  return arreglados;
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

/* Entrar con un usuario corto en vez del correo.
   Firebase solo sabe iniciar sesión con un correo, así que el usuario que se
   escribe se convierte en uno interno ("admin" → admin@usuarios…). El correo
   de verdad con el que se dio de alta el negocio no se puede renombrar desde
   aquí, así que en su lugar se crea una segunda cuenta de administrador sobre
   los MISMOS datos: el dueño del negocio no cambia, solo la forma de entrar. */
function mostrarAliasDeAcceso() {
  const caja = $('#cuenta-alias');
  if (!caja) return;
  // Solo tiene sentido para el administrador que aún entra con un correo
  const conCorreo = !!(yo && yo.usuario && yo.usuario.includes('@'));
  caja.hidden = !(esAdmin() && conCorreo);
  if (!caja.hidden) $('#cuenta-alias-correo').textContent = yo.usuario;
}

async function crearMiUsuarioDeAcceso() {
  if (!esAdmin()) { toast('🔒 Solo el administrador'); return; }
  const usuario = $('#alias-usuario').value.trim().toLowerCase();
  const pass = $('#alias-pass').value;
  if (!usuario) { toast('⚠️ Escribe el usuario con el que quieres entrar'); $('#alias-usuario').focus(); return; }
  if (usuario.includes('@') || /\s/.test(usuario)) {
    toast('⚠️ El usuario no debe tener espacios ni @'); $('#alias-usuario').focus(); return;
  }
  if (pass.length < 6) { toast('⚠️ La contraseña debe tener al menos 6 caracteres'); $('#alias-pass').focus(); return; }

  const boton = $('#btn-alias-crear');
  boton.disabled = true;
  try {
    const uid = await crearUsuarioAuthSecundaria(usuarioAEmail(usuario), pass);
    await fb.setDoc(fb.doc(fb.db, 'usuarios', ownerUid, 'miembros', uid), {
      usuario,
      rol: 'admin',
      permisos: { ...PERMISOS_TODOS },
      // Es la MISMA persona que ya venía entrando con el correo. Queda anotado
      // aquí para que lo firmado antes con el correo se lea con el usuario
      // nuevo: si no, en la hoja de cobranza saldría como dos cobradores.
      nombresPrevios: [yo.usuario],
      creado: Date.now(),
    });
    await cargarEquipo();
    $('#alias-pass').value = '';
    toast(`✅ Listo. Cierra sesión y entra con "${usuario}"`);
  } catch (e) {
    console.error(e);
    toast(e.code === 'auth/email-already-in-use'
      ? `⚠️ El usuario "${usuario}" ya existe. Prueba con otro.`
      : avisoDeFallo(e, '❌ No se pudo crear el usuario'));
  } finally {
    boton.disabled = false;
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
/* El número de la boleta, como número. Ojo: NO vale juntar todos los dígitos.
   Un comprobante entero es "0001-00004225", y juntándolos sale 100004225, que
   no es ninguna boleta: es la serie pegada al número. Hay que quedarse con el
   último grupo de dígitos, que es lo que hace numeroDeComprobante, y así da
   igual que la boleta esté guardada pelada ("4225") o entera. */
function boletaEntera(c) {
  const n = numeroDeComprobante((c && c.boleta) || '');
  return n || null;
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

/* Anulaciones: una nota de venta anulada.
   Se compara por el NÚMERO, no por el texto: la anulación puede estar guardada
   con el número entero de la nota ("0001-00004182") y la fila de al lado
   enseñarlo pelado ("4182"). Comparando textos no se reconocerían. */
function anuladoDe(boleta) {
  const n = numeroDeComprobante(boleta);
  return anulados.find(a => String(a.boleta) === String(boleta)
    || (n && numeroDeComprobante(a.boleta) === n)) || null;
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
    toast(avisoDeFallo(e, '❌ No se pudo guardar la anulación. Revisa tu conexión.'));
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
  // Si la anulación vino de anular una nota de venta, esto no se puede
  // deshacer desde aquí: la mercadería ya volvió al almacén y el crédito ya
  // no existe. Quitar solo la marca dejaría las tres cosas en desacuerdo.
  const registro = anuladoDe(boleta);
  if (registro && registro.notaId) {
    alert(`La boleta Nº ${numeroCorto(boleta)} se anuló desde su nota de venta: la mercadería ya volvió `
      + 'al almacén y el crédito ya no existe.\n\nSi la venta se hizo de verdad, emite una nota nueva.');
    return;
  }
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
   para que se vea la correlatividad de las notas de venta.

   Van dos clases de fila añadida: los NÚMEROS SALTEADOS (notas que faltan por
   crear) y las notas que se ANULARON. Estas últimas no son un hueco —el
   documento existió y se anuló—, así que se muestran aunque su número no caiga
   entre dos boletas registradas: si no, anular la última nota la haría
   desaparecer de Créditos sin dejar rastro. */
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

/* Las notas ANULADAS de las que ya no queda crédito. Se añaden siempre, se
   esté ordenando como se esté ordenando: no son un hueco de la numeración
   —el documento existió y se anuló— y si dependieran del orden por boleta,
   anular una nota la haría desaparecer de Créditos sin dejar rastro. */
function inyectarNotasAnuladas(lista) {
  const yaEstan = new Set(lista.map(c => boletaEntera(c)).filter(n => n != null));
  const filas = anulados
    .filter(a => a.notaId && numeroDeComprobante(a.boleta) && !yaEstan.has(numeroDeComprobante(a.boleta)))
    .sort((a, b) => numeroDeComprobante(b.boleta) - numeroDeComprobante(a.boleta))
    .map(a => ({ __faltante: true, boleta: String(numeroDeComprobante(a.boleta)) }));
  return filas.length ? [...filas, ...lista] : lista;
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
      // Sin compromiso anotado va al final, no al principio
      case 'compromiso': va = a.compromiso || '9999-12-31'; vb = b.compromiso || '9999-12-31'; break;
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
  if (sinFiltros) lista = inyectarNotasAnuladas(lista);

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
  renderListaCreditos(lista);
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
  ajustarCorrimiento('.prod-tabla-wrap'); // Productos
  ajustarCorrimiento('.ing-lista-wrap');  // Ingreso de productos
  ajustarCorrimiento('.kdx-tabla-wrap');  // Kardex
  ajustarCorrimiento('.nv-tabla-wrap');   // Notas de venta
}

/* Con el corrimiento lateral puesto, el recuadro pasa a ser su propia zona de
   desplazamiento y los títulos ya no se pueden pegar a la pantalla. Por eso
   antes de llegar a eso se prueba a apretar la tabla, de menos a más, y se
   deja el primer aprieto con el que entra entera:

     nivel 1 → letra y relleno más justos, sin perder ninguna columna
     nivel 2 → en Créditos se va la foto de la boleta (se sigue viendo en la
               ficha ℹ️); en la hoja se estrechan cliente y "cobró"
     nivel 3 → en Créditos se van también las fechas de emisión y despacho
     nivel 4 → letra más chica en toda la tabla, antes que quitar otra columna

   Solo si ni con el nivel 4 entra se le devuelve el corrimiento lateral. Se
   mide en vez de mirar el ancho de la pantalla porque el sitio de verdad
   depende también del panel lateral: en una pantalla de 1024px el panel se
   lleva casi 300px y a la tabla le quedan 730. */
const APRIETOS = 4;
function ajustarCorrimiento(selector) {
  const wrap = document.querySelector(selector);
  if (!wrap || wrap.offsetParent === null) return;   // oculta (celular u otra sección)
  const tabla = wrap.querySelector('table');
  if (!tabla) return;
  wrap.classList.remove('tabla-corre', 'compacta-1', 'compacta-2', 'compacta-3', 'compacta-4');
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

/* ====== Miniaturas de las fotos de boleta ======
   La foto se guarda grande a propósito (hay que poder leer la boleta) y pesa
   hasta 760 KB. Puesta tal cual en la lista, el navegador la descomprime
   ENTERA en memoria —unos 17 MB cada una, aunque se vea de 44px— y con
   muchas fotos la tablet se queda sin memoria y la app se cierra sola. Por
   eso la lista usa una copia chica (~5 KB) y la foto grande solo se abre al
   tocarla. Las de los créditos viejos se hacen una vez y quedan guardadas en
   este dispositivo. */
const miniaturas = new Map();

function miniDe(c) { return c.fotoMini || miniaturas.get(c.id) || null; }

function hacerMiniatura(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { try { resolve(comprimirImagen(img, 160, 0.6)); } catch (e) { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

let miniaturasCargadas = false;
async function cargarMiniaturas() {
  if (miniaturasCargadas) return;
  miniaturasCargadas = true;
  try {
    for (const m of await DB.getAllMiniaturas()) miniaturas.set(m.id, m.mini);
  } catch (e) { /* si no se pueden leer, se vuelven a hacer */ }
}

/* Deja respirar a la pantalla entre una miniatura y la siguiente, para que la
   app siga respondiendo mientras se ponen al día */
function respiro() {
  return new Promise(r => {
    if (window.requestIdleCallback) requestIdleCallback(() => r(), { timeout: 300 });
    else setTimeout(r, 16);
  });
}

let haciendoMiniaturas = false;
async function prepararMiniaturas() {
  if (haciendoMiniaturas) return;
  haciendoMiniaturas = true;
  try {
    let hechas = 0;
    for (const c of creditos) {
      if (!c.foto || miniDe(c)) continue;
      const mini = await hacerMiniatura(c.foto);
      if (!mini) continue;
      miniaturas.set(c.id, mini);
      DB.putMiniatura({ id: c.id, mini }).catch(() => {});
      hechas++;
      await respiro();
      if (hechas % 10 === 0) renderListaCreditos();   // se van viendo al momento
    }
    if (hechas) renderListaCreditos();
  } finally {
    haciendoMiniaturas = false;
  }
}

/* En la lista va la copia chica; "loading=lazy" hace que el navegador solo
   cargue las que se están viendo, y "decoding=async" que no frene el dibujo */
function celdaFoto(c) {
  return c.foto
    ? `<img src="${miniDe(c) || c.foto}" class="thumb" alt="Boleta ${c.boleta}" data-ver-foto="${c.id}" loading="lazy" decoding="async">`
    : `<span class="no-photo">Sin foto</span>`;
}

/* ====== La lista de créditos, por tandas ======
   Con 300 créditos, dibujar la lista entera en cada cambio deja a la tablet
   pensando casi un segundo y el desplazamiento se siente pegajoso. Se dibuja
   una tanda y el resto entra solo al llegar abajo.
   Además se dibuja SOLO la forma que se está viendo: en celular las tarjetas,
   en pantalla ancha la tabla. Antes se dibujaban las dos —el doble de trabajo
   y las fotos cargadas dos veces— para esconder la mitad con CSS. */
const TANDA = 60;
let filasVisibles = TANDA;
let ultimaLista = [];
const esVistaTarjetas = window.matchMedia('(max-width: 760px)');

let hayListaDibujada = false;
function renderListaCreditos(lista) {
  if (lista) { ultimaLista = lista; hayListaDibujada = true; }
  else if (!hayListaDibujada) return;   // todavía no hubo un render() completo
  const trozo = ultimaLista.slice(0, filasVisibles);
  if (esVistaTarjetas.matches) {
    renderTarjetas(trozo);
    $('#table-body').innerHTML = '';
  } else {
    renderTabla(trozo);
    $('#cards').innerHTML = '';
  }
  const faltan = ultimaLista.length - trozo.length;
  const aviso = $('#mas-filas');
  if (aviso) {
    aviso.hidden = faltan <= 0;
    $('#mas-filas-cuenta').textContent = faltan > 0 ? `Quedan ${faltan}` : '';
  }
}

/* Al buscar, filtrar u ordenar se vuelve a empezar por arriba */
function renderDesdeArriba() {
  filasVisibles = TANDA;
  render();
}

function verMasFilas() {
  if (filasVisibles >= ultimaLista.length) return;
  filasVisibles += TANDA;
  renderListaCreditos();
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
          ? `${escapeHtml(mostrarComo(anul.anuladoPor))}${fechaHoraDeTimestamp(anul.anuladoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(anul.anuladoEn)) : ''}`
          : '';
        return `
        <tr class="credito-anulado" title="Nota de venta anulada">
          <td><strong>${escapeHtml(numeroCorto(c.boleta))}</strong></td>
          <td colspan="11">
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
        <td><strong>${escapeHtml(numeroCorto(c.boleta))}</strong></td>
        <td colspan="11">
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
      <td><strong>${escapeHtml(numeroCorto(c.boleta))}</strong></td>
      <td>${escapeHtml(c.cliente)}</td>
      <td>${c.zona ? escapeHtml(c.zona) : '—'}</td>
      <td class="col-num">${formatoMonto(c.monto)}</td>
      <td class="col-num ${saldo > 0 ? 'saldo-pend' : 'saldo-ok'}">${saldo > 0 ? formatoMonto(saldo) : '✓'}</td>
      <td class="col-emision">${c.fecha ? formatoFecha(c.fecha) : '—'}</td>
      <td class="col-despacho">${c.fechaDespacho ? formatoFecha(c.fechaDespacho) : '—'}</td>
      <td>${textoVencimiento(c)}</td>
      <td class="col-compromiso">${textoCompromisoTabla(c)}</td>
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
      ? ` — registrado por ${mostrarComo(a.registradoPor)} el ${textoRegistrado(a)}`
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
          ? `${escapeHtml(mostrarComo(anul.anuladoPor))}${fechaHoraDeTimestamp(anul.anuladoEn) ? ' · ' + escapeHtml(fechaHoraDeTimestamp(anul.anuladoEn)) : ''}`
          : '';
        return `
        <article class="card card-anulado">
          <div class="card-main">
            <p class="card-title">Boleta Nº ${escapeHtml(numeroCorto(c.boleta))}</p>
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
          <p class="card-title">Boleta Nº ${escapeHtml(numeroCorto(c.boleta))}</p>
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
        <p class="card-sub">Boleta Nº ${escapeHtml(numeroCorto(c.boleta))} · Emisión ${formatoFecha(c.fecha)}${c.fechaDespacho ? ` · Despacho ${formatoFecha(c.fechaDespacho)}` : ''}</p>
        ${c.zona ? `<span class="card-zona">📍 ${escapeHtml(c.zona)}</span>` : ''}
        <p class="card-monto">${formatoMonto(c.monto)}</p>
        ${lineas}
        ${abonosResumenHtml(c)}
        <p class="card-venc">Vence: ${textoVencimiento(c)}</p>
        ${c.compromiso ? `<p class="card-venc">Quedó en pagar: ${textoCompromisoTabla(c)}</p>` : ''}
      </div>
      <div class="card-side">
        ${badgeEstado(c)}
        ${c.foto ? celdaFoto(c) : ''}
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
/* `accion` es lo que va a pasar si se confirma: se escribe en el botón, para
   que nunca diga "borrar" cuando lo que se va a hacer es corregir algo. */
function pedirPin(motivo, accion = 'borrar') {
  if (!pinConfigurado()) return Promise.resolve(true);
  const dlg = $('#modal-pin');
  const caja = $('#pin-input');
  const error = $('#pin-error');
  $('#pin-motivo').textContent = motivo;
  $('#btn-pin-ok').textContent = `Confirmar y ${accion}`;
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
  // Sin categoría elegida se cobra el precio de menudeo: nunca se cobra de
  // menos por descuido, y si el cliente es mayorista se le cambia a mano.
  $('#cli-categoria').value = 'C';
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
        || normalizarNombre(c.ruc).includes(buscado)
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
      c.ruc ? `🆔 ${escapeHtml(c.ruc)}` : '',
      c.direccion ? `🏠 ${escapeHtml(c.direccion)}` : '',
      c.telefono ? `📞 ${escapeHtml(c.telefono)}` : '',
      c.notas ? escapeHtml(c.notas) : '',
    ].filter(Boolean).join(' · ');
    const cat = categoriaDe(c);
    return `
      <div class="cliente-item">
        <div class="cliente-datos">
          ${c.codigo ? `<span class="cliente-codigo">${escapeHtml(c.codigo)}</span>` : ''}
          <strong>${escapeHtml(c.nombre)}</strong>
          <span class="cliente-cat cat-${cat}" title="Categoría de precio: ${CATEGORIAS[cat].detalle}">${cat}</span>
          <span class="cliente-zona">${c.zona ? escapeHtml(c.zona) : 'sin zona'}</span>
          <span class="cliente-meta">${nPedidos} crédito${nPedidos === 1 ? '' : 's'}${extra ? ' · ' + extra : ''}</span>
        </div>
        ${permitido ? `
        <div class="cliente-acciones">
          <button type="button" class="btn btn-secondary btn-small" data-editar-cliente="${escapeHtml(c.id)}">✏️</button>
          ${mandaComoAdmin() || puede('clientesBorrar') ? `<button type="button" class="btn btn-danger btn-small" data-borrar-cliente="${escapeHtml(c.id)}">🗑️</button>` : ''}
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
  $('#cli-categoria').value = categoriaDe(cli);
  $('#cli-ruc').value = cli.ruc || '';
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
    // Categoría de precio: decide qué precio del producto se cobra en la nota
    categoria: $('#cli-categoria').value || 'C',
    ruc: $('#cli-ruc').value.trim(),
    direccion: $('#cli-direccion').value.trim(),
    telefono: $('#cli-telefono').value.trim(),
    notas: $('#cli-notas').value.trim(),
    creado: anterior ? anterior.creado : Date.now(),
  };

  try {
    await guardarClienteEnStore(cliente);
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo guardar el cliente. Revisa tu conexión.'));
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
    else if (!$('#view-ventas').hidden && !$('#nv-vista-form').hidden) nvSeleccionarCliente(cliente.id);
  }
  render();
  toast(anterior
    ? `✅ Cliente actualizado${actualizados ? ` (${actualizados} crédito(s) al día)` : ''}`
    : `✅ Cliente "${nombre}" registrado`);
}

async function borrarCliente(id) {
  // Registrar y corregir clientes lo hace el empleado; borrarlos se lleva por
  // delante su ficha y su historial, así que va con permiso aparte.
  if (!mandaComoAdmin() && !puede('clientesBorrar')) {
    toast('🔒 No tienes permiso para borrar clientes'); return;
  }
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
  abrirSinTeclado($('#modal-info'));
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
    ? `<span class="venc-constancia">🖊️ ${escapeHtml(mostrarComo(c.vencimientoCambiadoPor))}${
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
    ? `<span class="venc-constancia">🖊️ ${escapeHtml(mostrarComo(c.compromisoPor))}${
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
  // La hora de emisión la sabe la NOTA, que es donde se emitió la boleta; el
  // crédito solo guarda el día. Un crédito dado de alta a mano desde una boleta
  // de papel no tiene nota detrás y por tanto no tiene hora: ahí se queda solo
  // la fecha, en vez de poner la hora en que alguien lo tecleó, que sería otra
  // cosa distinta con el mismo nombre.
  const notaDelCredito = c.notaId ? notas.find(x => x.id === c.notaId) : null;
  const horaEmision = notaDelCredito ? (notaDelCredito.hora || '') : '';
  $('#info-sub').textContent = `Boleta Nº ${numeroCorto(c.boleta)} · Emitido el ${formatoFecha(c.fecha)}`
    + (horaEmision ? ` a las ${horaEmision}` : '');
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
            ${abonoConFechaCambiada(a) ? '⚠️' : '🖊️'} Registrado por ${escapeHtml(mostrarComo(a.registradoPor))} · ${textoRegistrado(a)}</span>` : ''}
          ${a.modificadoPor ? `<span class="info-abono-meta abono-modificado">
            ✏️ Modificado por ${escapeHtml(mostrarComo(a.modificadoPor))} · ${fechaHoraDeTimestamp(a.modificadoEn)}</span>` : ''}
        </div>
        ${a.firma
          ? `<img src="${a.firma}" class="firma-mini" alt="Firma" data-ver-firma="${i}" title="Ver la firma">`
          : '<span class="sin-firma" title="Este pago no tiene firma">sin firma</span>'}
      </div>`).join('')
    : '<p class="abonos-vacio">Todavía no hay pagos a cuenta.</p>';

  $('#info-foto-wrap').hidden = !c.foto;
  if (c.foto) $('#info-foto').src = c.foto;
  // La boleta firmada casi siempre llega después, al cobrar: se puede poner
  // desde aquí sin tener que abrir el crédito para editarlo.
  $('#info-sin-foto').hidden = !!c.foto;
  $('#info-foto-acciones').hidden = !puede('editar');

  // El apartado de cobro solo para quien tenga permiso de registrar pagos
  const puedeCobrar = puede('pagos') && debe > 0 && abonos.length < MAX_ABONOS;
  $('#info-cobro').hidden = !puedeCobrar;
  if (puedeCobrar) {
    // La fecha del cobro la puede corregir el administrador (por ejemplo, para
    // registrar un cobro de ayer que no se alcanzó a anotar). Para el resto
    // sigue siendo siempre hoy y bloqueada: así nadie puede colocar un cobro
    // en otro día para saltarse una hoja de cobranza ya cerrada.
    const admin = mandaComoAdmin();
    $('#cobro-fecha').value = hoyISO();
    $('#cobro-fecha').disabled = !admin;
    $('#cobro-fecha').max = hoyISO();        // nunca a futuro
    $('#cobro-fecha-nota').textContent = admin
      ? '(puedes cambiarla; queda constancia del día real)'
      : '(hoy, no se puede cambiar)';
    $('#btn-cobro-todo').textContent = `Saldar todo lo que debe (${formatoMonto(debe)})`;

    // La hoja de cobranza de hoy no hace falta crearla a mano: se abre sola
    // con el primer cobro del día (quede quien sea que cobre). Solo si ya
    // está cerrada se bloquea el cobro (salvo al administrador).
    const hoy = hoyISO();
    const bloqueo = $('#info-cobro-bloqueo');
    let bloqueado = false;
    if (hojaExiste(hoy) && hojaCerrada(hoy)) {
      bloqueado = true;
      bloqueo.textContent = esAdmin()
        ? '🔒 La hoja de cobranza de hoy está cerrada. Para registrar un cobro hay que reabrirla desde 🧾 Hoja de cobranza.'
        : '🔒 La hoja de cobranza de hoy ya está cerrada. Pídele al administrador que la reabra.';
    }
    bloqueo.hidden = !bloqueado;
    $('#info-cobro-form').hidden = bloqueado;
  }

  // Un crédito ya pagado no lleva cobro, y muchos no llevan foto. Sin avisar de
  // eso, la ficha reservaba igual sus columnas y quedaban huecos en blanco: se
  // le dice cuántas zonas hay de verdad para que se repartan el ancho.
  const ficha = $('#modal-info');
  ficha.classList.toggle('sin-foto', !c.foto);
  ficha.classList.toggle('sin-cobro', !puedeCobrar);
}

/* Con qué fecha se registra el cobro. Solo el administrador puede cambiarla;
   para todos los demás el campo está bloqueado y vale hoy. Nunca a futuro. */
function fechaDelCobro() {
  const hoy = hoyISO();
  if (!mandaComoAdmin()) return hoy;
  const elegida = $('#cobro-fecha').value;
  if (!elegida || elegida > hoy) return hoy;
  return elegida;
}

/* Motivo por el que NO se puede registrar el cobro ahora mismo, o null si
   todo está listo. Se usa antes de pedir la firma (para no hacer firmar en
   vano) y también como control final al registrar. */
function problemaParaCobrar(c) {
  if (!c) return '⚠️ No se encontró el crédito';
  if (!puede('pagos')) return '🔒 No tienes permiso para registrar pagos';
  const dia = fechaDelCobro();
  // Si la hoja de ese día todavía no existe, no bloquea: se abre sola al cobrar.
  // Cerrada es cerrada: no entra nada, ni siquiera con el código. Si de verdad
  // falta un cobro de ese día, el administrador reabre la hoja y queda anotado.
  if (hojaCerrada(dia)) return '🔒 La hoja de cobranza de ese día está cerrada';
  const monto = Number($('#cobro-monto').value);
  const debe = saldoDe(c);
  if (!monto || monto <= 0) return '⚠️ Escribe el monto cobrado';
  if (monto > debe + 0.005) return `⚠️ El cliente solo debe ${formatoMonto(debe)}`;
  if (abonosDe(c).length >= MAX_ABONOS) return `⚠️ Este crédito ya tiene ${MAX_ABONOS} pagos a cuenta`;
  return null;
}

/* Bloquea/desbloquea el monto, el método y la fecha. Se bloquean cuando el
   cliente ya firmó, para que no se puedan cambiar después de la firma. */
function bloquearCamposCobro(bloq) {
  $('#cobro-monto').disabled = bloq;
  $('#cobro-metodo').disabled = bloq;
  $('#btn-cobro-todo').disabled = bloq;
  // Al desbloquear, la fecha vuelve a quedar disponible solo para el admin
  $('#cobro-fecha').disabled = bloq || !mandaComoAdmin();
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

  // El cobro entra en la hoja del día que dice la fecha (normalmente hoy; el
  // administrador puede haberla corregido). Si esa hoja todavía no existe, se
  // abre sola con este cobro; si ya está cerrada, hace falta el código.
  const dia = fechaDelCobro();
  if (!hojaExiste(dia)) {
    const abierta = await asegurarHojaAbierta(dia);
    if (!abierta) { toast(`❌ No se pudo abrir la hoja de cobranza del ${formatoFecha(dia)}. Intenta de nuevo.`); return; }
  }
  if (hojaCerrada(dia)) {
    alert(`La hoja de cobranza del ${formatoFecha(dia)} está cerrada.\n\n`
      + 'No entra ningún cobro más en ese día. Si de verdad falta uno, el administrador '
      + 'puede reabrir la hoja desde 🧾 Hoja de cobranza y volver a cerrarla después.');
    return;
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
      fecha: dia,                      // el día al que se le carga el cobro
      metodo: $('#cobro-metodo').value,
      registradoPor: quienSoy(),
      // Constancia: el día y la hora REALES en que se registró. Si no coinciden
      // con la fecha del cobro, la ficha lo marca con un ⚠️.
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
    toast(avisoDeFallo(e, '❌ No se pudo registrar el cobro. Revisa tu conexión.'));
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

/* Desde qué fecha se cuentan los días de crédito. Manda la fecha de DESPACHO:
   el crédito empieza a correr cuando la mercadería sale, no cuando se emitió
   el papel. Si el crédito todavía no tiene despacho anotado, se cuenta desde
   la emisión, que es lo único que hay. */
function baseVencimiento() {
  return $('#f-fecha-despacho').value || $('#f-fecha').value || hoyISO();
}

/* Recalcula el vencimiento salvo que alguien lo haya escrito a mano */
function recalcularVencimiento() {
  if (vencimientoEditadoManual) return;
  $('#f-vencimiento').value = sumarDias(baseVencimiento(), settings.dias);
}

/* Aplica un atajo: vencimiento = fecha de despacho (o emisión) + X días */
function aplicarAtajoVenc(dias) {
  const base = baseVencimiento();
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
  abonoEditando = null;
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
    $('#form-title').textContent = `Editar crédito — Boleta ${numeroCorto(credito.boleta)}`;
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
      // Sin estos dos, al reabrir el crédito se perdía la constancia de quién
      // había corregido el pago (esta lista se guarda tal cual al grabar).
      modificadoPor: a.modificadoPor || '',
      modificadoEn: a.modificadoEn || 0,
      firma: a.firma || '',
    }));
    /* Al volver el reparto se abre el crédito que la nota ya había creado.
       Si todavía no tiene ningún cobro, lo que toca ahora es anotar la primera
       entrega, así que se enseña "pago inicial" en vez de la lista de cobros
       vacía. Es el mismo hueco de siempre, solo que el crédito ya existía. */
    const desdeReparto = !!despachoOrigen && !abonosActuales.length;
    $('#field-pago-inicial').hidden = !desdeReparto;
    $('#abonos-box').hidden = desdeReparto;
    if (desdeReparto) {
      $('#f-pago-inicial').value = '';
      $('#f-pago-metodo').value = 'efectivo';
    }
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
    // El nro de boleta, el cliente, la fecha de emisión y la de despacho son
    // datos de la NOTA (la misma venta): el crédito es solo lo que se le
    // añade después. Editarlos aquí dejaría a la nota y a su crédito diciendo
    // cosas distintas, así que en TODA edición de un crédito ya existente
    // quedan bloqueados, vengan o no de un despacho.
    ['f-boleta', 'f-cliente-buscar', 'f-fecha', 'f-fecha-despacho'].forEach(id => { $('#' + id).disabled = true; });
    $('#btn-cliente-nuevo').disabled = true;
    // Abierto desde el reparto: lo de arriba viene de la nota y no se toca
    if (despachoOrigen) {
      $('#form-title').textContent = `Crédito de la boleta ${numeroCorto(credito.boleta)} (desde despacho)`;
      ['f-boleta', 'f-cliente-buscar', 'f-zona', 'f-monto', 'f-fecha', 'f-fecha-despacho', 'f-vencimiento']
        .forEach(id => { $('#' + id).disabled = true; });
      $('#btn-cliente-nuevo').disabled = true;
      $('#btn-atajo-1').disabled = true;
      $('#btn-atajo-2').disabled = true;
    }
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
      if (prefill.fechaEmision) $('#f-fecha').value = prefill.fechaEmision;
      // Los días de crédito se cuentan desde el despacho (ver baseVencimiento)
      recalcularVencimiento();
    }
    /* Lo que viene del despacho se enseña, no se reescribe: la boleta, el
       cliente, el monto y las fechas ya vienen decididos por la nota y por el
       reparto. Aquí solo se añade lo del cobro —el pago inicial, cómo pagó, la
       nota y la foto de la boleta firmada—. Si algo de arriba está mal, se
       corrige donde nació, no aquí: si no, el crédito acabaría diciendo una
       cosa y su nota otra. */
    const desdeDespacho = !!(prefill && prefill.desdeDespacho);
    ['f-boleta', 'f-cliente-buscar', 'f-monto', 'f-fecha', 'f-fecha-despacho', 'f-vencimiento']
      .forEach(id => { const el = $('#' + id); if (el) el.disabled = desdeDespacho; });
    $('#btn-cliente-nuevo').disabled = desdeDespacho;
    $('#btn-atajo-1').disabled = desdeDespacho;
    $('#btn-atajo-2').disabled = desdeDespacho;
    if (desdeDespacho) $('#f-zona').disabled = true;
  }
  abrirSinTeclado(modalForm);
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
let abonoEditando = null;   // índice del abono que se está editando ahora

function puedeEditarAbono() {
  return !modoNube || esAdmin();
}

function iniciarEdicionAbono(indice) {
  if (!puedeEditarAbono()) { toast('🔒 Solo el administrador puede editar los pagos a cuenta'); return; }
  abonoEditando = indice;
  renderAbonos();
}

function cancelarEdicionAbono() {
  abonoEditando = null;
  renderAbonos();
}

async function confirmarEdicionAbono(indice) {
  const a = abonosActuales[indice];
  if (!a) { cancelarEdicionAbono(); return; }
  const nuevaFecha = $(`#abono-fecha-edit-${indice}`).value;
  const nuevoMonto = Number($(`#abono-monto-edit-${indice}`).value);
  const nuevoMetodo = $(`#abono-metodo-edit-${indice}`).value;

  if (!nuevaFecha) { toast('⚠️ El pago necesita una fecha'); return; }
  if (!nuevoMonto || nuevoMonto <= 0) { toast('⚠️ El monto tiene que ser mayor que cero'); return; }

  const fechaVieja = a.fecha;
  const cambios = [];
  if (nuevaFecha !== fechaVieja) cambios.push('fecha');
  if (nuevoMonto !== Number(a.monto)) cambios.push('monto');
  if (nuevoMetodo !== metodoDe(a)) cambios.push('método');
  if (!cambios.length) { cancelarEdicionAbono(); return; }

  // Si la hoja de donde sale o la de donde entra ya está cerrada, hace falta
  // el código: ese cobro ya está contado en el cierre de ese día.
  if ((fechaVieja && hojaCerrada(fechaVieja)) || hojaCerrada(nuevaFecha)) {
    const detalle = cambios.includes('fecha')
      ? `del ${fechaVieja ? formatoFecha(fechaVieja) : 'sin fecha'} al ${formatoFecha(nuevaFecha)}`
      : `del ${formatoFecha(nuevaFecha)}`;
    const autorizado = await pedirPin(
      `Vas a cambiar ${cambios.join(' y ')} de la ACUENTA ${indice + 1} ${detalle}. Esa hoja de cobranza ya está cerrada.`,
      'cambiar');
    if (!autorizado) { toast('🔒 Cambio cancelado'); cancelarEdicionAbono(); return; }
  }

  abonosActuales[indice] = {
    ...a,
    fecha: nuevaFecha,
    monto: nuevoMonto,
    metodo: nuevoMetodo,
    // Constancia de la corrección: quién la hizo y en qué momento real. Lo de
    // "registrado por" no se toca nunca: sigue diciendo quién cobró.
    // Se usa Date.now() y no la hora del servidor porque Firestore no admite
    // su marca de tiempo dentro de una lista (los abonos van en una).
    modificadoPor: quienSoy(),
    modificadoEn: Date.now(),
  };
  abonoEditando = null;
  renderAbonos();
  toast('✅ Pago a cuenta actualizado');
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
      // Constancia de la corrección, si alguien tocó este pago después
      const modificado = a.modificadoPor
        ? `<span class="abono-constancia abono-modificado">✏️ Modificado por ${escapeHtml(a.modificadoPor)}
             el ${fechaHoraDeTimestamp(a.modificadoEn)}</span>`
        : '';
      const puedeQuitar = puedeQuitarAbono(a);
      const metodoActual = metodoDe(a);
      const opcionesMetodo = ['efectivo', 'yape', 'bcp']
        .map(m => `<option value="${m}"${m === metodoActual ? ' selected' : ''}>${metodoLabel(m)}</option>`).join('');
      const fechaHtml = abonoEditando === i
        ? `<span class="abono-editor">
             <label>Fecha
               <input type="date" id="abono-fecha-edit-${i}" class="input input-mini" value="${a.fecha || ''}" max="${hoyISO()}">
             </label>
             <label>Monto
               <input type="number" id="abono-monto-edit-${i}" class="input input-mini" min="0" step="any" inputmode="decimal" value="${Number(a.monto) || 0}">
             </label>
             <label>Pago
               <select id="abono-metodo-edit-${i}" class="input input-mini">${opcionesMetodo}</select>
             </label>
             <button type="button" data-confirmar-abono="${i}" title="Guardar los cambios">✓</button>
             <button type="button" data-cancelar-abono="${i}" title="Cancelar">✕</button>
           </span>`
        : `<span class="abono-fecha">${a.fecha ? formatoFecha(a.fecha) : 'sin fecha'} · ${metodoLabel(metodoActual)}${
            puedeEditarAbono()
              ? ` <button type="button" class="btn-fecha-editar" data-editar-abono="${i}" title="Editar este pago (fecha, monto y método)">✏️</button>`
              : ''}</span>`;
      return `
      <div class="abono-item">
        <span class="abono-datos">ACUENTA ${i + 1}: <strong>${formatoMonto(a.monto)}</strong>
          ${fechaHtml}
          ${constancia}
          ${modificado}</span>
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
  abonoEditando = null;
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
    alert(`La hoja de cobranza del ${formatoFecha(fecha)} está cerrada.\n\n`
      + 'No entra ningún pago más en ese día. Si de verdad falta uno, el administrador '
      + 'puede reabrir la hoja desde 🧾 Hoja de cobranza y volver a cerrarla después.');
    return;
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

/* Poner o cambiar la foto de la boleta desde la ficha del crédito, sin pasar
   por el formulario de edición: es donde se está cuando llega la boleta
   firmada, al cobrar. */
async function manejarFotoDesdeFicha(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const c = creditos.find(x => x.id === infoCreditoId);
  if (!c) return;
  if (!puede('editar')) { toast('🔒 No tienes permiso para editar créditos'); return; }
  let foto;
  try {
    foto = await procesarImagen(file);
  } catch (e) {
    toast('❌ No se pudo procesar la imagen');
    return;
  }
  const mini = await hacerMiniatura(foto);
  const actualizado = { ...c, foto, fotoMini: mini };
  try {
    await guardarEnStore(actualizado);
  } catch (e) {
    console.error(e);
    const pesada = foto.length > 700000;
    toast(pesada
      ? '❌ La foto pesa demasiado. Toma otra más de cerca.'
      : avisoDeFallo(e, '❌ No se pudo guardar la foto. Revisa tu conexión.'));
    return;
  }
  const i = creditos.findIndex(x => x.id === c.id);
  if (i >= 0) creditos[i] = actualizado;
  if (mini) { miniaturas.set(c.id, mini); DB.putMiniatura({ id: c.id, mini }).catch(() => {}); }
  render();
  renderInfo();
  toast('📷 Foto de la boleta guardada');
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
          <span class="dash-fila-meta">Nº ${escapeHtml(numeroCorto(a.c.boleta))} · ${escapeHtml(a.texto)}</span>
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
  const btnReabrir = $('#btn-hoja-reabrir');
  btnCrear.hidden = true;
  btnCerrar.hidden = true;
  if (btnReabrir) btnReabrir.hidden = true;

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
    if (btnReabrir) btnReabrir.hidden = !esAdmin();
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
    `🕐 Abierta por ${mostrarComo(h.creadaPor) || '—'} ${abierta ? 'el ' + abierta : '(hora pendiente de confirmar)'}${origen}`,
  ];
  const cerrada = fechaHoraDeTimestamp(h.cerradaEn);
  if (h.cerrada) {
    lineas.push(`🔒 Cerrada por ${mostrarComo(h.cerradaPor) || '—'} ${cerrada ? 'el ' + cerrada : '(hora pendiente de confirmar)'}`);
  }
  // Si alguna vez se reabrió, queda dicho: es la única puerta que tiene
  if (h.reabiertaPor) {
    const reab = fechaHoraDeTimestamp(h.reabiertaEn);
    lineas.push(`🔓 Reabierta por ${mostrarComo(h.reabiertaPor)} ${reab ? 'el ' + reab : ''}`);
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
            <td class="cob-usuario-nom">${escapeHtml(mostrarComo(u.usuario))}</td>
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
      <td><strong>${escapeHtml(numeroCorto(f.boleta))}</strong></td>
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
    ? `Abierta por ${mostrarComo(hojaDia.creadaPor) || '—'}${fechaHoraDeTimestamp(hojaDia.creadaEn) ? ' el ' + fechaHoraDeTimestamp(hojaDia.creadaEn) : ''}`
    : 'Hoja no creada';
  const lineaCierre = hojaDia && hojaDia.cerrada
    ? `Cerrada por ${mostrarComo(hojaDia.cerradaPor) || '—'}${fechaHoraDeTimestamp(hojaDia.cerradaEn) ? ' el ' + fechaHoraDeTimestamp(hojaDia.cerradaEn) : ''}`
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
    ? `<p class="sub">🕐 Abierta por ${escapeHtml(mostrarComo(hojaDia.creadaPor) || '—')}${horaAbierta ? ' el ' + escapeHtml(horaAbierta) : ''}
       <br>🔒 ${hojaDia.cerrada
          ? `Cerrada por ${escapeHtml(mostrarComo(hojaDia.cerradaPor) || '—')}${horaCerrada ? ' el ' + escapeHtml(horaCerrada) : ''}`
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
      /* Hoja entera, de pie. El margen lo pone la impresora, así que el
         cuerpo no lleva relleno: si no, se sumarían los dos y la tabla se
         quedaría sin ancho y se iría a una segunda hoja. */
      @page { size: A4 portrait; margin: 10mm; }
      body{font-family:system-ui,sans-serif;margin:0;padding:0;color:#111}
      h1{font-size:16px;margin:0 0 3px} .sub{color:#555;margin:0 0 10px;font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}
      th{background:#f0f0f0}
      tr{break-inside:avoid}
      .tot{margin-top:12px;font-size:13px} .tot div{margin:2px 0}
      .tot strong{display:inline-block;min-width:110px}
      .tit2{font-size:14px;margin:12px 0 5px}
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
      <td>${escapeHtml(mostrarComo(u.usuario))}</td>
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
const notasElegidas = new Set(); // notas marcadas para mandar a reparto
let verNotasViejas = false;      // mostrar también las pendientes de hace tiempo

/* Cuánto tiempo se considera que una nota es "reciente". Lo normal aquí es
   emitir la nota y despacharla el mismo día o a la mañana siguiente, así que
   una semana da margen de sobra para un fin de semana largo o un feriado sin
   que el panel se convierta en un cementerio.

   Lo que pase de ahí NO se esconde: se avisa aparte y se puede desplegar, que
   una nota sin despachar de hace diez días es justo la que hay que ver. */
const DIAS_NOTA_RECIENTE = 7;

/* Las notas emitidas que todavía no salieron a reparto, de la más nueva a la
   más vieja. `todas` incluye las que ya pasaron de la semana. */
function notasSinDespachar(todas = false) {
  const desde = sumarDias(hoyISO(), -DIAS_NOTA_RECIENTE);
  return notasPorDespachar()
    .filter(n => todas || (n.fecha || '') >= desde)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')
      || numeroDeComprobante(b.numero) - numeroDeComprobante(a.numero));
}

function notasSinDespacharViejas() {
  const desde = sumarDias(hoyISO(), -DIAS_NOTA_RECIENTE);
  return notasPorDespachar().filter(n => (n.fecha || '') < desde);
}

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

/* Los despachos que se muestran ahora mismo: todos, o los del día elegido. */
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

/* El lado izquierdo: las notas emitidas que todavía esperan salir. Se marcan
   con su casilla y la flecha las pasa al otro lado. */
function renderNotasPorDespachar() {
  const lista = notasSinDespachar(verNotasViejas);
  const viejas = notasSinDespacharViejas();
  // Una nota marcada que mientras tanto ya se despachó deja de estar marcada
  const vivas = new Set(lista.map(n => n.id));
  for (const id of [...notasElegidas]) if (!vivas.has(id)) notasElegidas.delete(id);

  $('#desp-notas-vacio').hidden = lista.length > 0;
  $('#desp-notas-cuenta').textContent = lista.length
    ? `${lista.length} nota${lista.length === 1 ? '' : 's'} · ${formatoMonto(lista.reduce((s, n) => s + (Number(n.total) || 0), 0))}`
    : '';

  $('#desp-notas-lista').innerHTML = lista.map(n => `
    <label class="desp-nota${notasElegidas.has(n.id) ? ' elegida' : ''}">
      <input type="checkbox" data-elegir-nota="${escapeHtml(n.id)}" ${notasElegidas.has(n.id) ? 'checked' : ''}>
      <span class="desp-nota-cuerpo">
        <span class="desp-nota-linea">
          <strong class="desp-nota-num">${escapeHtml(numeroCorto(n.numero))}</strong>
          <span class="desp-nota-cli">${escapeHtml(n.clienteNombre || '(sin cliente)')}</span>
        </span>
        <span class="desp-nota-linea desp-nota-meta">
          <span>${formatoMonto(Number(n.total) || 0)}</span>
          ${n.zona ? `<span>📍 ${escapeHtml(n.zona)}</span>` : ''}
          <span>📅 ${formatoFecha(n.fecha)}</span>
        </span>
      </span>
    </label>`).join('');

  // Las que llevan más de una semana esperando no se esconden: se avisan
  const aviso = $('#desp-notas-viejas');
  aviso.hidden = !viejas.length;
  if (viejas.length) {
    aviso.innerHTML = verNotasViejas
      ? `⚠️ ${viejas.length} de estas llevan más de ${DIAS_NOTA_RECIENTE} días sin salir.
         <button type="button" class="btn-enlace" id="btn-desp-notas-viejas">Ver solo las recientes</button>`
      : `⚠️ Hay ${viejas.length} nota${viejas.length === 1 ? '' : 's'} de hace más de ${DIAS_NOTA_RECIENTE} días sin despachar.
         <button type="button" class="btn-enlace" id="btn-desp-notas-viejas">Mostrarlas</button>`;
  }

  actualizarBotonPasar();
}

/* La flecha: encendida solo si hay algo marcado, y diciendo cuánto va. Va
   aparte porque marcar una casilla NO puede redibujar la lista entera: al
   reemplazar el HTML se perderían las demás casillas a medio marcar (y el
   sitio por el que ibas leyendo). */
function actualizarBotonPasar() {
  const boton = $('#btn-desp-pasar');
  boton.disabled = notasElegidas.size === 0;
  boton.querySelector('.desp-flecha-txt').textContent = notasElegidas.size
    ? `Mandar ${notasElegidas.size} a reparto`
    : 'Mandar a reparto';
}

/* ====== Devolver a "Por despachar" ======
   Un despacho que salió por error se deshace quitándolo: sin despacho, su nota
   vuelve sola al lado izquierdo (el estado se deduce, no se guarda en dos
   sitios). Solo vale para lo que sigue en reparto: lo que ya volvió y se
   cerró se deshace desde su ficha, donde se ve qué se le hizo. */
let modoSeleccionDespachos = false;
const despachosElegidos = new Set();

function ponerModoSeleccionDespachos(activo) {
  modoSeleccionDespachos = activo;
  despachosElegidos.clear();
  $('#desp-devolver').hidden = !activo;
  $('#btn-desp-seleccionar').textContent = activo ? '✖️ Cancelar' : '☑️ Seleccionar';
  renderListaDespachos();
}

/* Marcar una casilla NO redibuja la tabla: se perderían las demás a medio
   marcar. Solo se pone al día el botón. */
function actualizarBotonDevolver() {
  const boton = $('#btn-desp-devolver');
  boton.disabled = despachosElegidos.size === 0;
  $('#desp-devolver-cuenta').textContent = despachosElegidos.size
    ? `${despachosElegidos.size} marcado(s)`
    : 'Marca los que quieras devolver a “Por despachar”.';
}

async function devolverDespachosAPendiente(ids) {
  if (!puede('despachos')) { toast('🔒 No tienes permiso para tocar los despachos'); return; }
  const suyos = ids.map(id => despachoPorId(id))
    .filter(d => d && estadoDespachoEfectivo(d) === 'reparto');
  if (!suyos.length) { toast('⚠️ No hay nada marcado que se pueda devolver'); return; }
  if (!confirm(`¿Devolver ${suyos.length} pedido(s) a “Por despachar”?\n\n`
    + 'Se deshace su salida a reparto y sus notas vuelven a la lista de la izquierda.\n'
    + 'La mercadería no se toca: la nota sigue siendo la misma.')) return;

  const hechos = [];
  for (const d of suyos) {
    try {
      await eliminarDespachoDeStore(d.id);
      hechos.push(d.id);
    } catch (e) {
      console.error('No se pudo devolver el despacho', d.id, e);
    }
  }
  despachos = despachos.filter(x => !hechos.includes(x.id));
  if (!hechos.length) { toast('❌ No se pudo devolver. Revisa tu conexión.'); return; }
  toast(hechos.length === suyos.length
    ? `◀ ${hechos.length} pedido(s) de vuelta en “Por despachar”`
    : `⚠️ Volvieron ${hechos.length} de ${suyos.length}. Revisa tu conexión.`);
  ponerModoSeleccionDespachos(false);
}

function renderListaDespachos() {
  renderNotasPorDespachar();
  const lista = despachosDelDia();
  $('#desp-vacio').hidden = despachos.filter(esDespachoPedido).length > 0;

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

  // Tabla (escritorio): N° comprobante, cliente, monto, fecha, zona, repartidores y estado
  $('.desp-col-check').hidden = !modoSeleccionDespachos;
  $('#desp-tabla-body').innerHTML = lista.map(d => {
    const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
    const reps = repartidoresDe(d);
    // Solo se puede devolver lo que sigue en reparto: uno ya cerrado se
    // deshace desde su ficha, que es donde se ve qué se le hizo.
    const devolvible = modoSeleccionDespachos && estadoDespachoEfectivo(d) === 'reparto';
    return `
      <tr class="desp-fila ${info.clase}${modoSeleccionDespachos ? ' desp-fila-eligiendo' : ''}"
          ${modoSeleccionDespachos ? '' : `data-abrir-despacho="${d.id}"`}
          title="${escapeHtml(info.etiqueta)}${modoSeleccionDespachos ? '' : ' — ver detalle'}">
        ${modoSeleccionDespachos ? `<td class="desp-col-check">${devolvible
          ? `<input type="checkbox" data-elegir-despacho="${d.id}" ${despachosElegidos.has(d.id) ? 'checked' : ''}>`
          : ''}</td>` : ''}
        <td><strong>${escapeHtml(d.boleta ? numeroCorto(d.boleta) : '—')}</strong></td>
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
          <span>🧾 N° ${escapeHtml(d.boleta ? numeroCorto(d.boleta) : '—')}</span>
          <span>💵 ${formatoMonto(Number(d.monto) || 0)}</span>
          <span>📅 ${formatoFecha(d.fecha)}</span>
          ${d.zona ? `<span>📍 ${escapeHtml(d.zona)}</span>` : ''}
        </div>
        ${reps.length ? `<div class="despacho-card-rep">🧍 ${reps.map(escapeHtml).join(', ')}</div>` : ''}
      </button>`;
  }).join('');

  // Una marca que se quedó de un día que ya no se está mirando no cuenta
  const visibles = new Set(lista.map(d => d.id));
  for (const id of [...despachosElegidos]) if (!visibles.has(id)) despachosElegidos.delete(id);
  actualizarBotonDevolver();
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

/* Genera la hoja de despachos del día (o de todos) lista para imprimir. Es la
   hoja que se llevan los repartidores: solo lleva lo que salió de verdad. */
function imprimirDespachos() {
  const lista = despachosDelDia();
  const res = resumenDespachos(lista);
  const titulo = despachoFiltroFecha ? `del ${formatoFecha(despachoFiltroFecha)}` : '(todos)';
  const filasHtml = lista.map(d => {
    const info = estadoDespachoInfo(estadoDespachoEfectivo(d));
    const reps = repartidoresDe(d);
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
      @page { size: A4 portrait; margin: 10mm; }
      body{font-family:system-ui,sans-serif;margin:0;padding:0;color:#111}
      h1{font-size:16px;margin:0 0 3px} .sub{color:#555;margin:0 0 10px;font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}
      th{background:#f0f0f0}
      tr{break-inside:avoid}
      .tot{margin-top:12px;font-size:13px} .tot div{margin:2px 0}
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

/* Enseña u oculta los campos que en un despacho de varias notas los pone cada
   nota. `lote` es la lista de ids, o null para el despacho de siempre. */
function ponerModoLote(lote) {
  const enLote = !!lote;
  // Primero se limpia lo de "una sola nota" (que también toca estos campos) y
  // solo después se aplica lo del lote: al revés, lo de la nota volvería a
  // marcar como obligatorios campos que aquí ni se ven, y guardar fallaría sin
  // decir por qué —el navegador no puede señalar un campo escondido—.
  ponerDatosDeLaNota(null);
  ['desp-campo-cliente', 'desp-campo-numeros', 'desp-campo-emision']
    .forEach(id => { $('#' + id).hidden = enLote; });
  $('#desp-campo-fechas').hidden = false;   // la fecha de salida siempre se elige
  // Un campo oculto que siga siendo obligatorio impide guardar sin decir por qué
  $('#desp-monto').required = !enLote;
  $('#desp-emision').required = !enLote;
  $('#desp-fecha').required = true;
  const caja = $('#desp-lote-resumen');
  caja.hidden = !enLote;
  if (!enLote) return;
  const suyas = lote.map(id => notas.find(n => n.id === id)).filter(Boolean);
  const total = suyas.reduce((s, n) => s + (Number(n.total) || 0), 0);
  caja.innerHTML = `
    <p class="desp-lote-tit">Salen ${suyas.length} notas · ${formatoMonto(total)}</p>
    <ul class="desp-lote-lista">${suyas.map(n => `
      <li><strong>${escapeHtml(numeroCorto(n.numero))}</strong>
        <span>${escapeHtml(n.clienteNombre || '(sin cliente)')}</span>
        <span class="desp-lote-monto">${formatoMonto(Number(n.total) || 0)}</span></li>`).join('')}</ul>`;
}

/* `desdeNota` llega cuando el despacho nace de una nota de venta ya emitida:
   trae el cliente, la zona, el número y el monto ya puestos. */
function abrirFormDespacho(despacho = null, desdeNota = null) {
  const base = despacho || desdeNota;
  const lote = (desdeNota && Array.isArray(desdeNota.lote)) ? desdeNota.lote : null;
  $('#desp-form').reset();
  $('#desp-id').value = despacho ? despacho.id : '';
  $('#desp-nota-id').value = (base && base.notaId) || '';
  $('#desp-lote').value = lote ? lote.join(',') : '';
  $('#desp-form-title').textContent = lote
    ? `Mandar ${lote.length} notas a reparto`
    : (despacho ? 'Editar despacho' : 'Nuevo despacho');
  // En lote, el cliente, el número y el monto los pone cada nota: se ocultan
  // esos campos (y se les quita el "required", que si no bloquean el guardado
  // por pedir algo que ni se ve) y se enseña la lista de lo que va a salir.
  ponerModoLote(lote);
  if (lote) {
    $('#desp-fecha').value = hoyISO();
    renderRepartidoresCheck([]);
    mostrarVistaDespacho('form');
    return;
  }
  // Cliente: si el despacho ya tiene uno registrado, lo dejamos elegido;
  // si era texto libre, lo mostramos como "libre:".
  let valorCli = '';
  if (base) {
    if (base.clienteId && clientePorId(base.clienteId)) valorCli = base.clienteId;
    else if (base.cliente) valorCli = `libre:${base.cliente}`;
  }
  llenarComboClienteDespacho(valorCli);
  $('#btn-desp-cliente-nuevo').hidden = !puede('clientes');
  $('#desp-boleta').value = base ? (base.boleta || '') : '';
  $('#desp-monto').value = base ? (base.monto || '') : '';
  $('#desp-emision').value = base ? (base.emision || base.fecha || hoyISO()) : hoyISO();
  $('#desp-fecha').value = despacho ? (despacho.fecha || hoyISO()) : hoyISO();
  $('#desp-notas').value = despacho ? (despacho.notas || '') : '';
  // Aviso de que viene de una nota, para que se vea de dónde salieron los datos
  const nota = base && base.notaId ? notas.find(n => n.id === base.notaId) : null;
  const aviso = $('#desp-de-nota');
  if (aviso) {
    aviso.hidden = !nota;
    if (nota) aviso.innerHTML = `🧮 Sale de la nota de venta <strong>${escapeHtml(numeroCorto(nota.numero))}</strong>`;
  }
  // Lo que sale de la nota se enseña, no se escribe: lo que se elige aquí es
  // quién la lleva y poco más.
  ponerDatosDeLaNota(nota);
  renderRepartidoresCheck(despacho ? repartidoresDe(despacho) : []);
  mostrarVistaDespacho('form');
  if (!nota) $('#desp-cliente-buscar').focus();
}

/* Con una nota detrás, sus datos se enseñan en un recuadro y sus campos se
   esconden. Los valores siguen puestos en los campos (escondidos) porque son
   los que se guardan; lo único que desaparece es la posibilidad de cambiarlos
   aquí, que solo servía para descuadrar el despacho respecto de su nota. */
function ponerDatosDeLaNota(nota) {
  const caja = $('#desp-datos-nota');
  if (!caja) return;
  ['desp-campo-cliente', 'desp-campo-numeros', 'desp-campo-fechas']
    .forEach(id => { const el = $('#' + id); if (el) el.hidden = !!nota; });
  $('#desp-monto').required = !nota;
  $('#desp-emision').required = !nota;
  $('#desp-fecha').required = !nota;
  caja.hidden = !nota;
  if (!nota) return;
  const fila = (et, valor) =>
    `<div class="desp-det-fila"><span>${et}</span><strong>${valor}</strong></div>`;
  caja.innerHTML = [
    fila('👤 Cliente', escapeHtml(nota.clienteNombre || '(sin cliente)')),
    fila('🧾 Nota de venta', escapeHtml(numeroCorto(nota.numero))),
    fila('💵 Monto', formatoMonto(Number(nota.total) || 0)),
    nota.zona ? fila('📍 Zona', escapeHtml(nota.zona)) : '',
    fila('🗓️ Emisión', formatoFecha(nota.fecha)),
    fila('📦 Despacho', formatoFecha($('#desp-fecha').value)),
  ].filter(Boolean).join('');
}

/* Varias notas de una vez: mismo repartidor y misma fecha, pero cada nota se
   queda con su propio despacho, porque cada una tiene su cliente y su boleta
   y después vuelve por su cuenta (una a crédito, otra al contado…). */
async function guardarLoteDeDespachos(ids) {
  const reps = repartidoresSeleccionados();
  if (!reps.length) { toast('⚠️ Elige al menos un repartidor'); return; }
  const fecha = $('#desp-fecha').value || hoyISO();
  const nota = $('#desp-notas').value.trim();
  const suyas = ids.map(id => notas.find(n => n.id === id))
    .filter(n => n && !despachoDeNota(n.id));
  if (!suyas.length) { toast('⚠️ Esas notas ya están en un despacho'); return; }

  const nuevos = suyas.map(n => ({
    id: nuevoId(),
    fecha,
    emision: n.fecha || hoyISO(),
    cliente: n.clienteNombre || '',
    clienteId: n.clienteId || '',
    zona: n.zona || '',
    tipoComprobante: 'nota',
    notaId: n.id,
    boleta: n.numero || '',
    monto: Number(n.total) || 0,
    repartidores: reps,
    notas: nota,
    estado: 'reparto',
    creditoId: '',
    creado: Date.now(),
    creadoPor: quienSoy(),
    registrado: Date.now(),
  }));
  // Se guardan de uno en uno: si falla a la mitad, los que ya salieron quedan
  // bien guardados y se avisa de cuántos faltaron, en vez de perderlo todo.
  const hechos = [];
  for (const d of nuevos) {
    try {
      await guardarDespachoEnStore(d);
      despachos.push(d);
      hechos.push(d);
    } catch (e) {
      console.error('No se pudo guardar el despacho de la nota', d.boleta, e);
    }
  }
  hechos.forEach(d => notasElegidas.delete(d.notaId));
  if (!hechos.length) { toast('❌ No se pudo guardar. Revisa tu conexión.'); return; }
  toast(hechos.length === nuevos.length
    ? `🚚 ${hechos.length} notas mandadas a reparto`
    : `⚠️ Salieron ${hechos.length} de ${nuevos.length}. Revisa tu conexión e inténtalo con el resto.`);
  // El día del despacho es el que hay que estar mirando para verlas llegar
  despachoFiltroFecha = fecha;
  mostrarVistaDespacho('lista');
  renderListaDespachos();
  renderVentas();
}

async function guardarDespachoForm(ev) {
  ev.preventDefault();
  if (!puede('despachos')) return;
  const lote = $('#desp-lote').value ? $('#desp-lote').value.split(',').filter(Boolean) : null;
  if (lote) { await guardarLoteDeDespachos(lote); return; }
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
    notaId: $('#desp-nota-id').value || (existente ? (existente.notaId || '') : ''),
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
    toast(avisoDeFallo(e, '❌ No se pudo guardar el despacho. Revisa tu conexión.'));
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
    ? `${tipoComprobanteLabel(d.tipoComprobante)} N° ${escapeHtml(numeroCorto(d.boleta))}`
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
    <div class="desp-det-fila desp-det-meta"><span>Registrado por</span><strong>${escapeHtml(mostrarComo(d.creadoPor) || '—')}${d.registrado ? ' · ' + (horaDeTimestamp(d.registrado) || '') : ''}</strong></div>`;

  // Cuando el reparto vuelve hay tres desenlaces: la boleta vuelve firmada y
  // se convierte en crédito, el cliente pagó en el momento (contado), o la
  // mercadería se devolvió. Todos se pueden deshacer volviendo a "en reparto".
  let acciones = '';
  if (d.estado === 'credito' && d.creditoId) {
    acciones = `
      <button type="button" class="btn btn-primary btn-block" id="btn-desp-ver-credito">📄 Ver crédito enlazado</button>`;
  } else if (d.estado === 'contado' || d.estado === 'devuelto') {
    // Si al devolverlo se anuló su nota, esto no se deshace desde aquí: la
    // nota quedó anulada de constancia y su mercadería ya volvió al almacén.
    const suNota = d.notaId ? notas.find(n => n.id === d.notaId) : null;
    acciones = (suNota && suNota.anulada)
      ? `<p class="desp-det-cerrado">🚫 La nota ${escapeHtml(numeroCorto(suNota.numero))} quedó
           <strong>anulada</strong> y su mercadería volvió al almacén.
           Para volver a venderla, emite una nota nueva.</p>`
      : `<button type="button" class="btn btn-secondary btn-block" data-desp-estado="reparto">↩️ Volver a “en reparto”</button>`;
  } else {
    acciones = `
      <button type="button" class="btn btn-primary btn-block" id="btn-desp-a-credito">📄 Volvió firmada → crear crédito</button>
      <button type="button" class="btn btn-danger btn-block" id="btn-desp-devuelto-anular">↩️ Devuelto y anular</button>`;
  }
  $('#desp-det-acciones').innerHTML = acciones;

  // Mientras está en la calle no se toca: el papel lo tiene el repartidor y la
  // mercadería va con él. Lo que ya volvió sí se puede corregir.
  $('#btn-desp-editar').hidden = estadoDespachoEfectivo(d) === 'reparto' || !puede('despachos');
}

/* Cambia el estado del despacho abierto (al contado / devuelto / en reparto) */
async function cambiarEstadoDespacho(estado) {
  if (!puede('despachosCerrar')) { toast('🔒 No tienes permiso para cerrar repartos'); return; }
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

/* El pedido volvió sin entregarse: la mercadería está otra vez en el almacén y
   la nota no llegó a ser una venta. Las dos cosas van juntas —por eso es un
   solo botón— y quedan a la vista:
     · el despacho se marca DEVUELTO (no se borra: salió, y eso pasó)
     · la nota se marca ANULADA, con su motivo
     · lo que salió del almacén vuelve, con motivo "devuelto" en el kardex
   El kardex apunta una ENTRADA porque la mercadería regresó: deshace la salida
   que hizo la venta y el stock queda como antes de la nota. La salida original
   no se borra, para que el historial siga contando lo que de verdad pasó. */
async function devolverYAnular() {
  if (!puede('despachosCerrar')) { toast('🔒 No tienes permiso para cerrar repartos'); return; }
  const d = despachoPorId(despachoActivoId);
  if (!d) return;
  const n = d.notaId ? notas.find(x => x.id === d.notaId) : null;
  const salidas = n ? kardex.filter(m => m.notaId === n.id && m.motivo === 'venta') : [];

  if (n && !puede('ventasAnular')) {
    toast('🔒 Marcar como devuelto anula su nota, y no tienes ese permiso');
    return;
  }
  // Su crédito se va con ella: no se entregó nada, así que no hay nada que
  // cobrar. Si ya tuviera cobros, el dinero está en una hoja de cobranza y
  // esto no se puede deshacer desde aquí.
  const c = n ? creditoDeNota(n) : null;
  if (c && abonosDe(c).length) {
    alert(`No se puede dar por devuelto: su crédito (boleta ${numeroCorto(c.boleta)}) `
      + `ya tiene ${abonosDe(c).length} cobro(s) registrado(s).\n\nQuita primero esos cobros.`);
    return;
  }
  const detalle = salidas.length
    ? `\n\nVuelven al almacén ${salidas.length} producto(s), anotados como "devuelto".` : '';
  const conNota = n ? `\nLa nota ${numeroCorto(n.numero)} queda anulada, de constancia.` : '';
  const conCredito = c ? `\nSe borrará su crédito: no hay nada que cobrar.` : '';
  if (!confirm(`¿Marcar como devuelto el pedido de ${d.cliente || 'este cliente'}`
    + `${d.boleta ? ` (boleta ${numeroCorto(d.boleta)})` : ''}?${conNota}${conCredito}${detalle}`)) return;

  const marca = { motivo: 'Devuelto en el reparto', por: quienSoy(), en: marcaDeTiempo() };
  try {
    // 1) El despacho queda marcado, no se borra: salió, y eso pasó
    const actualizado = { ...d, estado: 'devuelto', creditoId: '' };
    await guardarDespachoEnStore(actualizado);
    const idx = despachos.findIndex(x => x.id === d.id);
    if (idx >= 0) despachos[idx] = actualizado;

    if (n) {
      // 2) La nota queda anulada, con su motivo
      const anulada = { ...n, anulada: marca };
      await guardarNotaEnStore(anulada);
      const i = notas.findIndex(x => x.id === n.id);
      if (i >= 0) notas[i] = anulada;
      // 3) La mercadería vuelve
      await Promise.all(salidas.map(m => registrarMovimiento({
        productoId: m.productoId, fecha: hoyISO(), tipo: 'entrada', cantidad: Math.abs(m.cantidad),
        motivo: 'devuelto', documento: `Devolución nota ${numeroCorto(n.numero)}`, notaId: n.id,
        nota: marca.motivo,
      })));
      // 4) Su crédito desaparece: no se entregó nada que cobrar
      if (c) {
        await eliminarDeStore(c.id);
        creditos = creditos.filter(x => x.id !== c.id);
      }
      // 5) Y su número queda anotado como anulado
      await guardarAnuladoEnStore({
        id: String(n.numero), boleta: String(n.numero), motivo: marca.motivo,
        notaId: n.id, anuladoPor: marca.por, anuladoEn: marca.en,
      });
    }
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo marcar como devuelto. Revisa tu conexión.'));
    return;
  }
  renderDetalleDespacho();
  renderVentas();
  renderProductos();
  renderKardex();
  render();
  toast(n
    ? `↩️ Devuelto y nota ${numeroCorto(n.numero)} anulada`
    : '↩️ Marcado como devuelto');
}

/* Abre el formulario de crédito ya prellenado con los datos del despacho.
   Al guardar el crédito, el despacho queda marcado "a crédito" y enlazado
   (la foto de la boleta firmada y las notas se guardan en el crédito). */
function crearCreditoDesdeDespacho(id) {
  const d = despachoPorId(id);
  if (!d) return;
  // La nota ya trajo su crédito al nacer, así que casi siempre no hay que
  // crear nada: se abre el que hay para completarlo con lo que llega ahora
  // —el pago inicial, la boleta firmada, alguna nota— y al guardar queda
  // enlazado con el despacho. Crear otro dejaría dos créditos por una venta.
  const n = d.notaId ? notas.find(x => x.id === d.notaId) : null;
  const yaHay = n ? creditoDeNota(n) : null;
  if (yaHay) {
    if (!puede('editar')) { toast('🔒 No tienes permiso para editar créditos'); return; }
    despachoOrigen = d.id;
    abrirFormulario(yaHay);
    return;
  }
  if (!puede('crear')) { toast('🔒 No tienes permiso para crear créditos'); return; }
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
    // El crédito se queda con la nota de la que salió todo: así el recorrido
    // nota → despacho → crédito se puede recorrer desde cualquier punto.
    if (d.notaId && !credito.notaId) {
      await guardarEnStore({ ...credito, notaId: d.notaId });
      const j = creditos.findIndex(c => c.id === credito.id);
      if (j >= 0) creditos[j] = { ...creditos[j], notaId: d.notaId };
    }
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
    if (!confirm(`El despacho es de "${d.cliente}" y el crédito Nº ${numeroCorto(credito.boleta)} es de "${credito.cliente}".\n\n¿Enlazarlos de todos modos?`)) return;
  }
  await vincularDespachoConCredito(origen, credito);
  despachoOrigen = null;
  limpiarErrorFormulario();
  modalForm.close();
  render();   // ya refresca la vista de despachos si está abierta
  toast(`🔗 Despacho enlazado con el crédito Nº ${numeroCorto(credito.boleta)}`);
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

  // Abonos: al editar vienen de la sección; al crear —y al abrirlo desde el
  // reparto, que es lo mismo pero sobre el crédito que ya existía— del "pago
  // inicial" opcional.
  const primeraEntrega = () => {
    const pagoInicial = Number($('#f-pago-inicial').value) || 0;
    return pagoInicial > 0 ? [{
      monto: pagoInicial,
      fecha,
      metodo: $('#f-pago-metodo').value,
      // Constancia automática: quién lo registró, en qué día y a qué hora
      registradoPor: quienSoy(),
      registradoFecha: hoyISO(),
      registrado: Date.now(),
    }] : [];
  };
  let abonos;
  if (existente) {
    abonos = abonosActuales.length ? abonosActuales.slice()
      : (despachoOrigen ? primeraEntrega() : []);
  } else {
    abonos = primeraEntrega();
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
    // Copia chica para las listas: sin ella, cada fila cargaría la foto entera
    fotoMini: fotoActual
      ? (existente && existente.foto === fotoActual
          ? (existente.fotoMini || miniDe(existente) || await hacerMiniatura(fotoActual))
          : await hacerMiniatura(fotoActual))
      : null,
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

  // Si se abrió desde un despacho, quedan enlazados y el reparto pasa a "a
  // crédito". Vale igual si el crédito ya existía —que es lo normal ahora,
  // porque lo trajo la nota—: lo que marca el cierre del reparto es esto.
  const origen = despachoOrigen;
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
  if (!confirm(`¿Borrar el crédito de la boleta Nº ${numeroCorto(c.boleta)} (${c.cliente})?\nEsta acción no se puede deshacer.`)) return;
  const autorizado = await pedirPin(`Vas a borrar el crédito de la boleta Nº ${numeroCorto(c.boleta)} (${c.cliente}).`);
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
  const datos = { version: 4, exportado: new Date().toISOString(), settings,
    creditos, clientes, despachos, repartidores, productos, kardex, notas };
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
    // Catálogo, almacén y notas de venta (respaldos de la versión 4 en adelante)
    if (Array.isArray(datos.productos)) {
      for (const p of datos.productos) {
        await guardarProductoEnStore(p);
        if (!modoNube) {
          const i = productos.findIndex(x => x.id === p.id);
          if (i >= 0) productos[i] = p; else productos.push(p);
        }
      }
      ordenarProductos();
    }
    if (Array.isArray(datos.kardex)) {
      for (const m of datos.kardex) {
        await guardarKardexEnStore(m);
        if (!modoNube) {
          const i = kardex.findIndex(x => x.id === m.id);
          if (i >= 0) kardex[i] = m; else kardex.push(m);
        }
      }
    }
    if (Array.isArray(datos.notas)) {
      for (const n of datos.notas) {
        await guardarNotaEnStore(n);
        if (!modoNube) {
          const i = notas.findIndex(x => x.id === n.id);
          if (i >= 0) notas[i] = n; else notas.push(n);
        }
      }
    }
    if (Array.isArray(datos.productos) || Array.isArray(datos.kardex) || Array.isArray(datos.notas)) {
      llenarSelectoresProducto();
      renderProductos();
      renderKardex();
      renderVentas();
    }
    if (datos.settings) { settings = { ...settings, ...datos.settings }; await guardarSettings().catch(() => {}); }
    render();
    toast('⬆️ Respaldo importado correctamente');
  } catch (e) {
    console.error(e);
    toast('❌ El archivo no es un respaldo válido');
  }
}

/* ══════════════════════ Productos ══════════════════════ */

function ordenarProductos() {
  productos.sort((a, b) =>
    String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es', { numeric: true }));
}

function productoPorId(id) { return productos.find(p => p.id === id) || null; }
function productosActivos() { return productos.filter(p => p.activo !== false); }

/* Códigos de producto: PR-0001, PR-0002… */
function siguienteCodigoProducto() {
  let mayor = 0;
  for (const p of productos) {
    const n = Number(String(p.codigo || '').replace(/\D/g, ''));
    if (Number.isFinite(n)) mayor = Math.max(mayor, n);
  }
  return 'PR-' + String(mayor + 1).padStart(4, '0');
}

function codigoProductoRepetido(codigo, exceptoId) {
  const clave = String(codigo).trim().toUpperCase();
  return productos.find(p => String(p.codigo || '').trim().toUpperCase() === clave && p.id !== exceptoId) || null;
}

/* El precio que le toca a un cliente según su categoría */
function precioDe(producto, categoria) {
  if (!producto) return 0;
  const campo = { A: 'precioA', B: 'precioB', C: 'precioC' }[categoria] || 'precioC';
  return Number(producto[campo]) || 0;
}

function soles(n) {
  return (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---- Stock: siempre se calcula del kardex, que es la única fuente de verdad ---- */
function cantidadConSigno(m) {
  const t = TIPOS_KARDEX[m.tipo] || TIPOS_KARDEX.entrada;
  // En un ajuste ya se guardó la diferencia contra el stock (puede ser negativa)
  return t.signo * (Number(m.cantidad) || 0);
}

function stockDe(productoId) {
  let s = 0;
  for (const m of kardex) if (m.productoId === productoId) s += cantidadConSigno(m);
  return s;
}

function kardexOrdenado() {
  return kardex.slice().sort((a, b) => {
    if ((a.fecha || '') !== (b.fecha || '')) return (a.fecha || '') < (b.fecha || '') ? -1 : 1;
    return (a.creado || 0) - (b.creado || 0);
  });
}

/* Cada movimiento con el saldo que dejó ese producto: es la columna que hace
   que un kardex sirva de verdad (se puede auditar fila por fila). */
function kardexConSaldo() {
  const saldos = new Map();
  return kardexOrdenado().map(m => {
    const previo = saldos.get(m.productoId) || 0;
    const saldo = previo + cantidadConSigno(m);
    saldos.set(m.productoId, saldo);
    return { ...m, saldo, previo };
  });
}

function abrirProductos() {
  $('#prod-buscar').value = '';
  $('#btn-prod-nuevo').hidden = !puede('productosEditar');
  renderProductos();
  mostrarSeccion('productos');
}

function renderProductos() {
  const cuerpo = $('#prod-body');
  if (!cuerpo) return;
  const buscado = normalizarNombre($('#prod-buscar') ? $('#prod-buscar').value : '');
  const lista = buscado
    ? productos.filter(p => normalizarNombre(p.nombre).includes(buscado)
        || normalizarNombre(p.codigo).includes(buscado))
    : productos;

  const bajos = productos.filter(p => p.activo !== false && stockDe(p.id) <= (Number(p.stockMin) || 0));
  $('#prod-chips').innerHTML = [
    `<span class="chip">🛒 ${productos.length} producto${productos.length === 1 ? '' : 's'}</span>`,
    `<span class="chip">✅ ${productosActivos().length} activo${productosActivos().length === 1 ? '' : 's'}</span>`,
    bajos.length ? `<span class="chip chip-alerta">⚠️ ${bajos.length} con stock bajo</span>` : '',
  ].filter(Boolean).join('');

  $('#prod-vacio').hidden = !!lista.length;
  $('.prod-tabla-wrap').hidden = !lista.length;
  if (!lista.length) {
    $('#prod-vacio').textContent = productos.length
      ? 'Ningún producto coincide con la búsqueda.'
      : 'Todavía no tienes productos. Usa “➕ Nuevo producto” para crear el primero.';
    cuerpo.innerHTML = '';
    return;
  }

  // El catálogo se ve con "productos"; tocarlo pide "productosEditar"
  const permitido = puede('productosEditar');
  cuerpo.innerHTML = lista.map(p => {
    const stock = stockDe(p.id);
    const min = Number(p.stockMin) || 0;
    const bajo = p.activo !== false && stock <= min;
    return `<tr class="${p.activo === false ? 'prod-inactivo' : ''}">
      <td class="col-cod"><code>${escapeHtml(p.codigo || '—')}</code></td>
      <td class="prod-nombre">${escapeHtml(p.nombre)}${p.activo === false ? ' <span class="prod-etq">inactivo</span>' : ''}</td>
      <td class="col-um">${PRESENTACIONES[presentacionDe(p)].nombre} <small>${umDe(p)}</small></td>
      <td class="col-num">${soles(p.precioA)}</td>
      <td class="col-num">${soles(p.precioB)}</td>
      <td class="col-num">${soles(p.precioC)}</td>
      <td class="col-num ${bajo ? 'prod-stock-bajo' : ''}" title="${bajo ? `Stock mínimo: ${min}` : ''}">${stock}${bajo ? ' ⚠️' : ''}</td>
      <td class="col-acc">${permitido ? `
        <button type="button" class="btn btn-secondary btn-small" data-editar-producto="${escapeHtml(p.id)}" title="Editar (pide tu código)">✏️</button>
        <button type="button" class="btn btn-danger btn-small" data-borrar-producto="${escapeHtml(p.id)}" title="Borrar (pide tu código)">🗑️</button>` : ''}</td>
    </tr>`;
  }).join('');
}

/* Cambiar un producto que ya existe mueve precios y unidades de todo lo que
   se venda a partir de ahora, así que pide el código de seguridad. Crear uno
   nuevo no: todavía no afecta a nada. */
async function editarProductoConClave(id) {
  const p = productoPorId(id);
  if (!p) return;
  if (!puede('productosEditar')) { toast('🔒 No tienes permiso para editar productos'); return; }
  const autorizado = await pedirPin(`Vas a modificar el producto "${p.nombre}".`, 'modificar');
  if (!autorizado) { toast('🔒 Modificación cancelada'); return; }
  abrirFormProducto(p);
}

function abrirFormProducto(producto = null) {
  if (!puede('productosEditar')) { toast('🔒 No tienes permiso para gestionar productos'); return; }
  $('#prod-form').reset();
  $('#prod-id').value = producto ? producto.id : '';
  $('#prod-codigo').value = producto ? (producto.codigo || '') : siguienteCodigoProducto();
  $('#prod-nombre').value = producto ? producto.nombre : '';
  $('#prod-presentacion').value = producto ? presentacionDe(producto) : 'unidad';
  $('#prod-stockmin').value = producto ? (Number(producto.stockMin) || 0) : 0;
  $('#prod-precio-a').value = producto ? (producto.precioA ?? '') : '';
  $('#prod-precio-b').value = producto ? (producto.precioB ?? '') : '';
  $('#prod-precio-c').value = producto ? (producto.precioC ?? '') : '';
  $('#prod-activo').checked = producto ? producto.activo !== false : true;
  // El stock nunca se pone aquí: nace en cero y se carga desde
  // 📥 Ingreso de productos, para que nunca haya un stock que nadie pueda explicar.
  $('#prod-ayuda-stock').hidden = !!producto;
  $('#prod-form-title').textContent = producto ? `Editar producto — ${producto.nombre}` : 'Nuevo producto';
  abrirSinTeclado($('#modal-producto'));
}

async function guardarProductoForm(ev) {
  ev.preventDefault();
  if (!puede('productos')) { toast('🔒 No tienes permiso para gestionar productos'); return; }

  const id = $('#prod-id').value;
  const anterior = id ? productoPorId(id) : null;
  const nombre = $('#prod-nombre').value.trim().toUpperCase();
  if (!nombre) { toast('⚠️ Escribe el nombre del producto'); return; }

  let codigo = $('#prod-codigo').value.trim().toUpperCase();
  if (!codigo) codigo = (anterior && anterior.codigo) || siguienteCodigoProducto();
  const repetido = codigoProductoRepetido(codigo, id);
  if (repetido) { toast(`⚠️ El código ${codigo} ya es de "${repetido.nombre}"`); return; }

  const precios = ['a', 'b', 'c'].map(l => Number($(`#prod-precio-${l}`).value));
  if (precios.some(p => !Number.isFinite(p) || p < 0)) { toast('⚠️ Revisa los tres precios'); return; }

  const producto = {
    id: id || nuevoId(),
    codigo,
    nombre,
    presentacion: $('#prod-presentacion').value,
    precioA: precios[0], precioB: precios[1], precioC: precios[2],
    stockMin: Number($('#prod-stockmin').value) || 0,
    activo: $('#prod-activo').checked,
    creado: anterior ? anterior.creado : Date.now(),
    creadoPor: anterior ? (anterior.creadoPor || '') : quienSoy(),
  };
  if (anterior) { producto.modificadoPor = quienSoy(); producto.modificadoEn = Date.now(); }

  try {
    await guardarProductoEnStore(producto);
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo guardar el producto. Revisa tu conexión.'));
    return;
  }

  const i = productos.findIndex(p => p.id === producto.id);
  if (i >= 0) productos[i] = producto; else productos.push(producto);
  ordenarProductos();

  $('#modal-producto').close();
  renderProductos();
  llenarSelectoresProducto();
  toast(anterior
    ? '✅ Producto actualizado'
    : `✅ Producto "${nombre}" creado. Ahora ve a 📥 Ingreso de productos para cargarle stock.`);
}

async function borrarProducto(id) {
  if (!puede('productosEditar')) { toast('🔒 No tienes permiso para borrar productos'); return; }
  const p = productoPorId(id);
  if (!p) return;
  const movimientos = kardex.filter(m => m.productoId === id).length;
  const enNotas = notas.filter(n => (n.items || []).some(it => it.productoId === id)).length;
  if (movimientos || enNotas) {
    alert(`No se puede borrar "${p.nombre}" porque tiene ${movimientos} movimiento(s) de almacén` +
      `${enNotas ? ` y sale en ${enNotas} nota(s) de venta` : ''}.\n\n` +
      'Si ya no lo vendes, edítalo y desmarca “Producto activo”: deja de aparecer al vender, pero su historial se conserva.');
    return;
  }
  if (!confirm(`¿Borrar el producto "${p.nombre}"?`)) return;
  const autorizado = await pedirPin(`Vas a borrar el producto "${p.nombre}".`);
  if (!autorizado) { toast('🔒 Borrado cancelado'); return; }
  try {
    await eliminarProductoDeStore(id);
  } catch (e) {
    toast('❌ No se pudo borrar. Revisa tu conexión.');
    return;
  }
  productos = productos.filter(x => x.id !== id);
  renderProductos();
  llenarSelectoresProducto();
  toast('🗑️ Producto borrado');
}

/* ══════════════════════ Kardex de almacén ══════════════════════ */

let kdxFiltros = { producto: '', tipo: '', motivo: '', usuario: '', texto: '', desde: '', hasta: '' };
let kdxVista = 'movimientos';    // 'movimientos' | 'dias' | 'saldo'

/* ---- "Saldo a una fecha": el estado vive aparte de kdxFiltros ----
   Es otra pregunta ("cuánto queda") que la de los movimientos ("qué pasó"),
   así que no comparte sus filtros: una fecha sola (no un rango) y, en vez de
   un producto a la vez, todos o los que elijas. */
let kdxSaldoFecha = '';                 // se pone a hoy la primera vez que se abre Kardex
let kdxSaldoTodos = true;
const kdxSaldoSeleccion = new Set();    // ids de producto, solo cuando NO son "todos"

function abrirKardex() {
  llenarSelectoresProducto();
  llenarFiltrosKardex();
  // Se pone a hoy la PRIMERA vez nada más: si el usuario ya eligió una fecha
  // y sale y vuelve a entrar, se la respeta —es lo que estaba mirando—.
  if (!kdxSaldoFecha) {
    kdxSaldoFecha = hoyISO();
    $('#kdx-saldo-fecha').value = kdxSaldoFecha;
  }
  renderKardex();
  mostrarSeccion('kardex');
}

/* Los desplegables de motivo y de usuario se arman con lo que hay de verdad en
   el kardex: ofrecer motivos que nadie usó solo estorba. */
function llenarFiltrosKardex() {
  const selMotivo = $('#kdx-fil-motivo');
  if (selMotivo) {
    const usados = [...new Set(kardex.map(m => m.motivo).filter(Boolean))]
      .sort((a, b) => (MOTIVOS_KARDEX[a] || a).localeCompare(MOTIVOS_KARDEX[b] || b, 'es'));
    const antes = selMotivo.value;
    selMotivo.innerHTML = '<option value="">Todos los motivos</option>'
      + usados.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(MOTIVOS_KARDEX[k] || k)}</option>`).join('');
    selMotivo.value = antes;
  }
  const selUsuario = $('#kdx-fil-usuario');
  if (selUsuario) {
    const gente = [...new Set(kardex.map(m => mostrarComo(m.usuario)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    const antes = selUsuario.value;
    selUsuario.innerHTML = '<option value="">Todos</option>'
      + gente.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    selUsuario.value = antes;
  }
}

function llenarSelectoresProducto() {
  const opciones = p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.codigo || '')} · ${escapeHtml(p.nombre)}</option>`;
  const filtro = $('#kdx-fil-producto');
  if (filtro) {
    const antes = filtro.value;
    filtro.innerHTML = '<option value="">Todos los productos</option>' + productos.map(opciones).join('');
    filtro.value = antes;
  }
  // La nota de venta no aparece aquí: no lleva desplegable, se escribe el
  // nombre y salen las coincidencias debajo (como en el ingreso).
  llenarMotivos($('#aj-tipo') ? $('#aj-tipo').value : 'ajuste');
}

/* Los motivos que tienen sentido cambian según lo que pasó: no se le ofrece
   "merma" a una entrada ni "compra a proveedor" a una salida. */
const MOTIVOS_POR_TIPO = {
  entrada: ['compra', 'devolucion_cliente', 'otro'],
  salida: ['merma', 'traslado', 'otro'],
  ajuste: ['inventario'],
};
function llenarMotivos(tipo) {
  const sel = $('#aj-motivo');
  if (!sel) return;
  const antes = sel.value;
  const claves = MOTIVOS_POR_TIPO[tipo] || MOTIVOS_POR_TIPO.entrada;
  sel.innerHTML = claves.map(k => `<option value="${k}">${MOTIVOS_KARDEX[k]}</option>`).join('');
  if (claves.includes(antes)) sel.value = antes;
}

function movimientosFiltrados() {
  const buscado = normalizarNombre(kdxFiltros.texto || '');
  return kardexConSaldo().filter(m => {
    if (kdxFiltros.producto && m.productoId !== kdxFiltros.producto) return false;
    if (kdxFiltros.tipo && m.tipo !== kdxFiltros.tipo) return false;
    if (kdxFiltros.motivo && m.motivo !== kdxFiltros.motivo) return false;
    if (kdxFiltros.usuario && mostrarComo(m.usuario) !== kdxFiltros.usuario) return false;
    if (kdxFiltros.desde && (m.fecha || '') < kdxFiltros.desde) return false;
    if (kdxFiltros.hasta && (m.fecha || '') > kdxFiltros.hasta) return false;
    if (buscado) {
      const p = productoPorId(m.productoId);
      const donde = [m.documento, m.nota, m.proveedor, p && p.nombre, p && p.codigo]
        .filter(Boolean).map(normalizarNombre).join(' ');
      if (!donde.includes(buscado)) return false;
    }
    return true;
  }).reverse();   // lo más reciente arriba
}

/* En cuánto quedó el stock de un producto al cerrar cada día.
   El saldo NO se recalcula sobre lo filtrado: se toma el que arrastra el
   kardex completo. Si no, mirar "solo agosto" daría un stock que empieza en
   cero y ningún número cuadraría con el almacén de verdad. */
function stockPorDia(productoId) {
  if (!productoId) return [];
  const dias = new Map();
  for (const m of kardexConSaldo()) {
    if (m.productoId !== productoId) continue;
    const f = m.fecha || '';
    if (!f) continue;
    const c = cantidadConSigno(m);
    const d = dias.get(f) || { fecha: f, entradas: 0, salidas: 0, movimientos: 0, saldo: 0 };
    if (c >= 0) d.entradas += c; else d.salidas += -c;
    d.movimientos += 1;
    d.saldo = m.saldo;          // el último del día manda: así cierra el día
    dias.set(f, d);
  }
  let lista = [...dias.values()];
  // El rango de fechas sí recorta lo que se enseña, pero después de calcular
  if (kdxFiltros.desde) lista = lista.filter(d => d.fecha >= kdxFiltros.desde);
  if (kdxFiltros.hasta) lista = lista.filter(d => d.fecha <= kdxFiltros.hasta);
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/* El saldo de CADA producto tal como quedó tras su último movimiento en esa
   fecha o antes. Igual que en stockPorDia, sale del kardex COMPLETO, nunca de
   lo filtrado arriba —que además es de otra pestaña y no aplica aquí—. Un
   producto sin ningún movimiento hasta ese día tenía 0, así de sencillo. */
function stockAFecha(fechaISO) {
  const saldos = new Map();
  for (const m of kardexConSaldo()) {
    if ((m.fecha || '') > fechaISO) continue;
    // kardexConSaldo ya viene en orden cronológico: el último que se procese
    // para cada producto es su último movimiento hasta esa fecha, y su saldo
    // es el que queda.
    saldos.set(m.productoId, m.saldo);
  }
  return saldos;
}

function renderKardex() {
  const cuerpo = $('#kdx-body');
  if (!cuerpo) return;
  llenarFiltrosKardex();

  // "Saldo a una fecha" es otra pregunta que las dos vistas de movimientos
  // ("qué pasó" contra "cuánto queda"): no usa los filtros de arriba —una
  // fecha sola, no un rango; el producto se elige en su propio panel—, así
  // que se resuelve aparte y no comparte nada más de esta función.
  const filtrosArriba = $('.kdx-filtros');
  if (filtrosArriba) filtrosArriba.hidden = kdxVista === 'saldo';
  $('.kdx-saldo-wrap').hidden = kdxVista !== 'saldo';
  if (kdxVista === 'saldo') {
    $('#kdx-chips').innerHTML = '';
    $('#kdx-alerta').hidden = true;
    $('.kdx-tabla-wrap').hidden = true;
    $('.kdx-dias-wrap').hidden = true;
    $('#kdx-dias-aviso').hidden = true;
    $('#kdx-vacio').hidden = true;
    renderSaldoAFecha();
    return;
  }

  const lista = movimientosFiltrados();

  let entradas = 0, salidas = 0;
  for (const m of lista) {
    const c = cantidadConSigno(m);
    if (c >= 0) entradas += c; else salidas += -c;
  }
  const prodFiltrado = kdxFiltros.producto ? productoPorId(kdxFiltros.producto) : null;
  $('#kdx-chips').innerHTML = [
    `<span class="chip">📄 ${lista.length} movimiento${lista.length === 1 ? '' : 's'}</span>`,
    `<span class="chip chip-entrada">📥 Entradas: ${entradas}</span>`,
    `<span class="chip chip-salida">📤 Salidas: ${salidas}</span>`,
    prodFiltrado
      ? `<span class="chip chip-saldo">📦 Stock actual de ${escapeHtml(prodFiltrado.nombre)}: <strong>${stockDe(prodFiltrado.id)}</strong></span>`
      : '',
  ].filter(Boolean).join('');

  // Aviso de productos por debajo de su stock mínimo
  const bajos = productosActivos().filter(p => stockDe(p.id) <= (Number(p.stockMin) || 0));
  const alerta = $('#kdx-alerta');
  alerta.hidden = !bajos.length;
  if (bajos.length) {
    alerta.innerHTML = `⚠️ <strong>Stock bajo:</strong> ` + bajos.slice(0, 8).map(p =>
      `${escapeHtml(p.nombre)} <b>(${stockDe(p.id)})</b>`).join(' · ') +
      (bajos.length > 8 ? ` y ${bajos.length - 8} más` : '');
  }

  // La vista por día solo tiene sentido con un producto elegido: el "stock al
  // cerrar el día" de todo el almacén junto no significa nada.
  const porDia = kdxVista === 'dias';
  const dias = porDia ? stockPorDia(kdxFiltros.producto) : [];
  $('.kdx-dias-wrap').hidden = !(porDia && dias.length);
  $('#kdx-dias-aviso').hidden = !(porDia && !kdxFiltros.producto);
  $('.kdx-tabla-wrap').hidden = porDia || !lista.length;
  $('#kdx-vacio').hidden = porDia
    ? !(kdxFiltros.producto && !dias.length)
    : !!lista.length;
  if (porDia) {
    $('#kdx-dias-body').innerHTML = dias.map(d => `<tr>
      <td class="kdx-fecha">${formatoFecha(d.fecha)}</td>
      <td class="col-num kdx-entrada">${d.entradas || ''}</td>
      <td class="col-num kdx-salida">${d.salidas || ''}</td>
      <td class="col-num">${d.movimientos}</td>
      <td class="col-num kdx-saldo"><strong>${d.saldo}</strong></td>
    </tr>`).join('');
    return;
  }
  if (!lista.length) { cuerpo.innerHTML = ''; return; }

  const permitido = puede('kardex');
  cuerpo.innerHTML = lista.map(m => {
    const p = productoPorId(m.productoId);
    const c = cantidadConSigno(m);
    const t = TIPOS_KARDEX[m.tipo] || TIPOS_KARDEX.entrada;
    return `<tr>
      <td class="kdx-fecha">${formatoFecha(m.fecha)}<small>${horaDeTimestamp(m.creado) || ''}</small></td>
      <td class="col-cod"><code>${escapeHtml(p ? p.codigo : '—')}</code></td>
      <td>${escapeHtml(p ? p.nombre : 'producto borrado')}</td>
      <td><span class="kdx-tipo kdx-${m.tipo}">${t.icono} ${t.nombre}</span></td>
      <td>${escapeHtml(MOTIVOS_KARDEX[m.motivo] || '—')}${m.nota ? `<small>${escapeHtml(m.nota)}</small>` : ''}</td>
      <td>${escapeHtml(m.documento || '—')}</td>
      <td class="col-num kdx-entrada">${c > 0 ? c : ''}</td>
      <td class="col-num kdx-salida">${c < 0 ? -c : ''}</td>
      <td class="col-num kdx-saldo">${m.saldo}</td>
      <td>${escapeHtml(mostrarComo(m.usuario) || '—')}</td>
      <td class="col-acc">${mandaComoAdmin()
        ? `<button type="button" class="btn btn-danger btn-small" data-borrar-kardex="${escapeHtml(m.id)}" title="Anular movimiento (pide tu código)">🗑️</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderSaldoAFecha() {
  const fecha = kdxSaldoFecha || hoyISO();
  const saldos = stockAFecha(fecha);
  // Van TODOS los productos, activos e inactivos: uno que ya no se vende
  // puede seguir teniendo mercadería de sobra en el almacén, y este es
  // justamente el reporte para encontrarla. Se marca "inactivo" para que no
  // se confunda con lo que sí se puede vender hoy.
  const universo = kdxSaldoTodos
    ? productos
    : productos.filter(p => kdxSaldoSeleccion.has(p.id));
  const filas = universo.map(p => ({ p, saldo: saldos.has(p.id) ? saldos.get(p.id) : 0 }));

  $('#kdx-saldo-elegir').hidden = kdxSaldoTodos;
  if (!kdxSaldoTodos) renderSaldoProductosLista();

  // Sin "todos" y sin ningún producto marcado no hay nada que enseñar: se lo
  // dice en vez de mostrar una tabla vacía sin explicar por qué.
  const sinNadaQueElegir = !kdxSaldoTodos && !kdxSaldoSeleccion.size;
  $('.kdx-saldo-tabla-wrap').hidden = sinNadaQueElegir;
  $('#kdx-saldo-vacio').hidden = !sinNadaQueElegir;
  if (sinNadaQueElegir) { $('#kdx-saldo-chips').innerHTML = ''; return; }

  const total = filas.reduce((s, f) => s + f.saldo, 0);
  $('#kdx-saldo-chips').innerHTML = [
    `<span class="chip">📦 ${filas.length} producto${filas.length === 1 ? '' : 's'}</span>`,
    `<span class="chip chip-saldo">Unidades en total: <strong>${total}</strong></span>`,
  ].join('');

  $('#kdx-saldo-body').innerHTML = filas.map(({ p, saldo }) => {
    // El mínimo es el de HOY, configurado en el producto: no hay una versión
    // de "cuál era el mínimo en esa fecha", así que se avisa con el de ahora.
    const min = Number(p.stockMin) || 0;
    const bajo = saldo <= min;
    return `<tr class="${p.activo === false ? 'prod-inactivo' : ''}">
      <td class="col-cod"><code>${escapeHtml(p.codigo || '—')}</code></td>
      <td>${escapeHtml(p.nombre)}${p.activo === false ? ' <span class="prod-etq">inactivo</span>' : ''}</td>
      <td class="col-num ${bajo ? 'prod-stock-bajo' : ''}" title="${bajo ? `Stock mínimo de hoy: ${min}` : ''}">${saldo}${bajo ? ' ⚠️' : ''}</td>
    </tr>`;
  }).join('');
}

/* La lista de productos para elegir a mano, filtrada por lo que se busca.
   La selección vive en kdxSaldoSeleccion y no se toca al filtrar: buscar
   "aceite", marcar uno y luego borrar la búsqueda no debe perderlo. */
function renderSaldoProductosLista() {
  const buscado = normalizarNombre($('#kdx-saldo-buscar').value || '');
  const lista = buscado
    ? productos.filter(p => normalizarNombre(p.nombre).includes(buscado)
        || normalizarNombre(p.codigo).includes(buscado))
    : productos;
  $('#kdx-saldo-lista').innerHTML = lista.length ? lista.map(p => `
    <label class="kdx-saldo-item">
      <input type="checkbox" class="kdx-saldo-check" value="${escapeHtml(p.id)}" ${kdxSaldoSeleccion.has(p.id) ? 'checked' : ''}>
      <span>${escapeHtml(p.codigo || '')} · ${escapeHtml(p.nombre)}${p.activo === false ? ' <small>(inactivo)</small>' : ''}</span>
    </label>`).join('')
    : '<p class="kdx-saldo-sin">Ningún producto coincide con la búsqueda.</p>';
}

/* Guarda un movimiento. En un ajuste, `cantidad` es lo CONTADO en el almacén y
   aquí se convierte en la diferencia contra el stock que tenía el sistema. */
async function registrarMovimiento({ productoId, fecha, tipo, cantidad, motivo, documento,
  nota, notaId, loteId, proveedor }) {
  let cant = Number(cantidad) || 0;
  if (tipo === 'ajuste') cant = cant - stockDe(productoId);
  const mov = {
    id: nuevoId(),
    productoId,
    fecha: fecha || hoyISO(),
    tipo,
    cantidad: cant,
    motivo: motivo || 'otro',
    documento: documento || '',
    nota: nota || '',
    notaId: notaId || '',
    // Todos los productos que llegaron en la misma factura comparten lote:
    // así el historial los muestra juntos en vez de como filas sueltas.
    loteId: loteId || '',
    proveedor: proveedor || '',
    usuario: quienSoy(),
    creado: Date.now(),
  };
  await guardarKardexEnStore(mov);
  if (!modoNube) kardex.push(mov);
  return mov;
}

/* ══════════════════════ Ingreso de productos ══════════════════════
   Sección aparte, no un modal: es donde entra la mercadería nueva y donde se
   cuadra el conteo físico. El producto en sí (🛒 Productos) es solo catálogo
   y precios; el stock siempre nace en cero y se carga desde aquí, para que
   nunca haya una cifra de almacén que nadie pueda explicar de dónde salió.

   Dos formas de trabajar, porque son dos situaciones distintas:
     · Por factura → llega un camión con una sola factura y muchos productos.
       Se arma la lista entera y se agrega todo el stock de una vez.
     · Ajuste o salida → un solo producto: conteo físico, merma o traslado. */

const DOCS_INGRESO = { factura: 'Factura', guia: 'Guía de remisión', boleta: 'Boleta', sin: 'Sin documento' };

let ingModo = 'factura';        // 'factura' | 'ajuste'
let ingLista = [];              // [{ productoId, cantidad }] de la factura en curso
let ingEditando = '';           // loteId de la factura que se está corrigiendo ('' = una nueva)
let ingComboIndice = -1;
let ajComboIndice = -1;

function abrirIngresos(productoId = '') {
  llenarSelectoresProducto();
  if (!ingLista.length) resetIngresoFactura();
  resetAjusteForm();
  if (productoId) {
    // Viene del botón 📥 de un producto: queda listo para escribir la cantidad
    ingModo = 'factura';
    elegirProductoIngreso(productoId);
  }
  aplicarModoIngreso();
  renderIngresos();
  mostrarSeccion('ingresos');
  if (productoId) $('#ing-cantidad').focus();
}

function aplicarModoIngreso() {
  $('#ing-vista-factura').hidden = ingModo !== 'factura';
  $('#ing-vista-ajuste').hidden = ingModo !== 'ajuste';
  $('#ing-modo-factura').classList.toggle('activo', ingModo === 'factura');
  $('#ing-modo-ajuste').classList.toggle('activo', ingModo === 'ajuste');
  $('#ing-modo-factura').setAttribute('aria-selected', String(ingModo === 'factura'));
  $('#ing-modo-ajuste').setAttribute('aria-selected', String(ingModo === 'ajuste'));
}

/* ---- Buscador de productos: se escribe el nombre y van saliendo debajo ----
   Es el mismo gesto que ya se usa para buscar clientes al armar una nota, y
   con un catálogo largo un desplegable se vuelve inservible. */
/* Se ordena por parecido, no por el orden del catálogo: escribiendo "aceite"
   lo primero que sale es el que se llama así, no el décimo que lo lleva en
   medio del nombre. Con varias palabras basta que estén todas, en cualquier
   orden: "soya aceite" encuentra "ACEITE SOYA 20BOTX900ML". */
function productosQueCoinciden(texto, soloActivos = false) {
  const clave = normalizarNombre(texto);
  if (!clave) return [];
  const palabras = clave.split(/\s+/).filter(Boolean);
  const lista = soloActivos ? productosActivos() : productos;
  const puntuados = [];
  for (const p of lista) {
    const nombre = normalizarNombre(p.nombre);
    const codigo = normalizarNombre(p.codigo);
    let puntos = 0;
    if (codigo && codigo === clave) puntos = 100;          // el código exacto manda
    else if (nombre === clave) puntos = 95;
    else if (nombre.startsWith(clave)) puntos = 80;        // empieza como se escribió
    else if (codigo && codigo.includes(clave)) puntos = 70;
    else if (nombre.includes(clave)) puntos = 60;
    else if (palabras.length > 1 && palabras.every(w => nombre.includes(w))) puntos = 50;
    if (!puntos) continue;
    puntuados.push({ p, puntos, largo: nombre.length });
  }
  // A igual parecido, primero el nombre más corto: suele ser el que se buscaba
  puntuados.sort((a, b) => b.puntos - a.puntos || a.largo - b.largo
    || String(a.p.nombre).localeCompare(String(b.p.nombre), 'es'));
  return puntuados.slice(0, 8).map(x => x.p);
}

function pintarSugerenciasProducto(cajaId, atributo, texto, soloActivos = false) {
  const caja = $(cajaId);
  if (!caja) return;
  if (!normalizarNombre(texto)) { caja.hidden = true; caja.innerHTML = ''; return; }
  const encontrados = productosQueCoinciden(texto, soloActivos);
  if (!encontrados.length) {
    caja.innerHTML = '<div class="combo-vacio">Ningún producto coincide</div>';
    caja.hidden = false;
    return;
  }
  caja.innerHTML = encontrados.map((p, i) => {
    const stock = stockDe(p.id);
    const bajo = stock <= (Number(p.stockMin) || 0);
    return `<button type="button" class="combo-item" ${atributo}="${escapeHtml(p.id)}" data-i="${i}">
      <span class="combo-nombre">${escapeHtml(p.nombre)}</span>
      <small><code>${escapeHtml(p.codigo || '')}</code> · ${PRESENTACIONES[presentacionDe(p)].um}
        · stock <b class="${bajo ? 'prod-stock-bajo' : ''}">${stock}</b></small>
    </button>`;
  }).join('');
  caja.hidden = false;
}

function cerrarSugerenciasProducto(cajaId) {
  const caja = $(cajaId);
  if (caja) { caja.hidden = true; caja.innerHTML = ''; }
}

/* Mueve el resaltado con las flechas del teclado y devuelve el elegido con Enter */
function navegarSugerencias(ev, cajaId, atributo, indiceActual, alElegir) {
  const items = Array.from($(cajaId).querySelectorAll(`[${atributo}]`));
  if (!items.length) return indiceActual;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const siguiente = (indiceActual + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((b, i) => b.classList.toggle('activo', i === siguiente));
    return siguiente;
  }
  if (ev.key === 'Enter' && indiceActual >= 0) {
    ev.preventDefault();
    alElegir(items[indiceActual].getAttribute(atributo));
    return -1;
  }
  if (ev.key === 'Escape') { cerrarSugerenciasProducto(cajaId); return -1; }
  return indiceActual;
}

/* ---- Modo factura: armar la lista ---- */
function elegirProductoIngreso(id) {
  const p = productoPorId(id);
  if (!p) return;
  $('#ing-producto').value = id;
  $('#ing-buscar').value = p.nombre;
  cerrarSugerenciasProducto('#ing-sugerencias');
  ingComboIndice = -1;
}

function resetIngresoFactura() {
  ingLista = [];
  ingEditando = '';
  $('#ing-proveedor').value = '';
  $('#ing-doc-tipo').value = 'factura';
  $('#ing-doc-numero').value = '';
  $('#ing-fecha').value = hoyISO();
  $('#ing-nota').value = '';
  limpiarBuscadorIngreso();
  aplicarModoEdicionIngreso();
  renderListaIngreso();
}

/* ---- Corregir una factura que ya entró ----
   Una factura mal anotada —una cantidad de más, un número de documento
   equivocado, un producto que no era— no se puede dejar como está: el stock
   sale de sumar el kardex, así que el error se arrastra a todo el almacén.
   Antes solo se podía anular entera y volver a escribirla. Ahora se abre en
   este mismo formulario, se corrige y se guarda; los movimientos se ajustan y
   el stock se recalcula solo. Pide el código, como anularla. */

/* El documento se guarda ya armado ("Factura F001-1234 · Proveedor"). Para
   volver a llenar el formulario hay que deshacer esa costura. */
function partirDocumento(texto) {
  const primero = String(texto || '').split(' · ')[0].trim();
  for (const [clave, nombre] of Object.entries(DOCS_INGRESO)) {
    if (clave === 'sin') continue;
    if (primero === nombre) return { tipo: clave, numero: '' };
    if (primero.startsWith(nombre + ' ')) {
      return { tipo: clave, numero: primero.slice(nombre.length + 1).trim() };
    }
  }
  return { tipo: 'sin', numero: '' };
}

function aplicarModoEdicionIngreso() {
  const aviso = $('#ing-editando');
  if (!aviso) return;
  const editando = !!ingEditando;
  aviso.hidden = !editando;
  $('#btn-ing-cancelar-edicion').hidden = !editando;
  $('#btn-ing-limpiar').hidden = editando;   // vaciar la lista aquí solo confunde
  $('#btn-ing-guardar').textContent = editando ? '💾 Guardar cambios' : 'Agregar stock';
  if (editando) {
    const doc = $('#ing-cab-doc').textContent;
    aviso.textContent = `✏️ Estás corrigiendo un ingreso que ya entró (${doc}). `
      + 'Al guardar, el stock de cada producto se recalcula solo.';
  }
}

async function editarLoteIngreso(loteId) {
  if (!mandaComoAdmin()) { toast('🔒 Solo el administrador puede corregir ingresos'); return; }
  const delLote = kardex.filter(m => (m.loteId || m.id) === loteId);
  if (!delLote.length) return;
  // Solo las entradas por factura. Un ajuste guarda la DIFERENCIA contra el
  // stock de aquel día, no lo contado: reabrirlo aquí daría otra cosa.
  if (delLote.some(m => m.tipo !== 'entrada')) {
    toast('⚠️ Solo se corrigen los ingresos por factura. Un ajuste o una salida se anula y se vuelve a hacer.');
    return;
  }
  const doc = delLote[0].documento || 'este ingreso';
  const autorizado = await pedirPin(`Vas a corregir ${doc}: ${delLote.length} producto(s).`, 'corregir');
  if (!autorizado) { toast('🔒 Corrección cancelada'); return; }

  ingModo = 'factura';
  aplicarModoIngreso();

  const { tipo, numero } = partirDocumento(delLote[0].documento);
  $('#ing-doc-tipo').value = tipo;
  $('#ing-doc-numero').value = numero;
  $('#ing-proveedor').value = delLote[0].proveedor || '';
  $('#ing-fecha').value = delLote[0].fecha || hoyISO();
  $('#ing-nota').value = delLote[0].nota || '';
  ingLista = delLote.map(m => ({ productoId: m.productoId, cantidad: Math.abs(Number(m.cantidad) || 0) }));
  ingEditando = loteId;

  limpiarBuscadorIngreso();
  renderListaIngreso();
  actualizarCabeceraIngreso();
  aplicarModoEdicionIngreso();
  $('#ing-doc-numero').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarEdicionIngreso() {
  resetIngresoFactura();
  toast('Corrección cancelada');
}

/* Guarda la factura corregida: se ajusta lo que cambió, entra lo que se
   agregó y se va lo que se quitó. Los movimientos que siguen conservan su id
   y su hora original, para que el historial no parezca escrito hoy. */
async function guardarCambiosDeLote() {
  const delLote = kardex.filter(m => (m.loteId || m.id) === ingEditando);
  if (!delLote.length) { toast('⚠️ Ese ingreso ya no está'); resetIngresoFactura(); return; }

  const tipoDoc = $('#ing-doc-tipo').value;
  const numero = $('#ing-doc-numero').value.trim();
  const proveedor = $('#ing-proveedor').value.trim();
  const documento = [
    tipoDoc !== 'sin' ? `${DOCS_INGRESO[tipoDoc]}${numero ? ' ' + numero : ''}` : '',
    proveedor,
  ].filter(Boolean).join(' · ');
  const fecha = $('#ing-fecha').value || hoyISO();
  const nota = $('#ing-nota').value.trim();
  const marca = { modificadoPor: quienSoy(), modificadoEn: Date.now() };

  const porProducto = new Map(delLote.map(m => [m.productoId, m]));
  const guardados = [], borrados = [];
  const boton = $('#btn-ing-guardar');
  boton.disabled = true;
  try {
    for (const l of ingLista) {
      const previo = porProducto.get(l.productoId);
      const cantidad = Number(l.cantidad) || 0;
      const mov = previo
        ? { ...previo, cantidad, fecha, documento, nota, proveedor, ...marca }
        // Producto agregado a la factura: entra en el mismo lote
        : { id: nuevoId(), productoId: l.productoId, fecha, tipo: 'entrada', cantidad,
            motivo: 'compra', documento, nota, notaId: '', loteId: ingEditando, proveedor,
            usuario: quienSoy(), creado: Date.now(), ...marca };
      await guardarKardexEnStore(mov);
      guardados.push(mov);
      if (previo) porProducto.delete(l.productoId);
    }
    // Lo que quedó en el mapa es lo que ya no está en la factura
    for (const sobra of porProducto.values()) {
      await eliminarKardexDeStore(sobra.id);
      borrados.push(sobra.id);
    }
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudieron guardar los cambios. Revisa tu conexión.'));
    boton.disabled = false;
    return;
  }
  boton.disabled = false;

  // En modo local no hay quien avise de los cambios: se ponen a mano
  kardex = kardex.filter(m => !borrados.includes(m.id));
  for (const m of guardados) {
    const i = kardex.findIndex(x => x.id === m.id);
    if (i >= 0) kardex[i] = m; else kardex.push(m);
  }

  resetIngresoFactura();
  renderIngresos();
  renderProductos();
  renderKardex();
  toast('✅ Ingreso corregido y stock recalculado');
}

/* La cabecera del recuadro repite, en grande, lo que se va escribiendo abajo:
   el documento, el proveedor y la fecha. Sirve de comprobación de un vistazo,
   igual que mirar el encabezado de la factura de papel. */
function actualizarCabeceraIngreso() {
  const cab = $('#ing-cab-doc');
  if (!cab) return;
  const tipo = $('#ing-doc-tipo').value;
  const numero = $('#ing-doc-numero').value.trim();
  cab.textContent = tipo === 'sin'
    ? 'Sin documento'
    : `${DOCS_INGRESO[tipo]} ${numero || '—'}`;

  const proveedor = $('#ing-proveedor').value.trim();
  $('#ing-cab-proveedor').textContent = proveedor || 'Sin proveedor';
  $('#ing-cab-fecha').textContent = formatoFecha($('#ing-fecha').value) || '—';
  $('#ing-cab-usuario').textContent = quienSoy();
  $('#ing-cab-items').textContent = ingLista.length;
}

function limpiarBuscadorIngreso() {
  $('#ing-buscar').value = '';
  $('#ing-producto').value = '';
  $('#ing-cantidad').value = '';
  cerrarSugerenciasProducto('#ing-sugerencias');
}

function agregarALista() {
  const id = $('#ing-producto').value;
  if (!id) { toast('⚠️ Busca y elige el producto'); $('#ing-buscar').focus(); return; }
  const cantidad = Number($('#ing-cantidad').value);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    toast('⚠️ Escribe cuántas unidades entran'); $('#ing-cantidad').focus(); return;
  }
  // Si el producto ya está en la lista se suma, en vez de duplicar la línea
  const yaEsta = ingLista.find(l => l.productoId === id);
  if (yaEsta) yaEsta.cantidad += cantidad;
  else ingLista.push({ productoId: id, cantidad });

  limpiarBuscadorIngreso();
  renderListaIngreso();
  $('#ing-buscar').focus();
}

function renderListaIngreso() {
  const cuerpo = $('#ing-lista-body');
  if (!cuerpo) return;
  $('#ing-lista-vacia').hidden = !!ingLista.length;
  $('.ing-lista-wrap').hidden = !ingLista.length;
  $('#ing-resumen').hidden = !ingLista.length;
  $('#btn-ing-guardar').disabled = !ingLista.length;

  cuerpo.innerHTML = ingLista.map((l, i) => {
    const p = productoPorId(l.productoId);
    const actual = stockDe(l.productoId);
    return `<tr>
      <td class="col-item">${i + 1}</td>
      <td class="col-cod"><code>${escapeHtml(p ? p.codigo : '—')}</code></td>
      <td class="prod-nombre">${escapeHtml(p ? p.nombre : 'producto borrado')}</td>
      <td class="col-um">${p ? umDe(p) : ''}</td>
      <td class="col-num">
        <input type="number" class="input input-mini" data-ing-cant="${i}" min="0.01" step="1" value="${l.cantidad}">
      </td>
      <td class="col-num">${actual}</td>
      <td class="col-num ing-resultante">${actual + l.cantidad}</td>
      <td class="col-acc"><button type="button" class="doc-quitar" data-ing-quitar="${i}"
        title="Quitar del detalle" aria-label="Quitar del detalle">✕</button></td>
    </tr>`;
  }).join('');

  $('#ing-res-productos').textContent = ingLista.length;
  $('#ing-res-unidades').textContent = ingLista.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  actualizarCabeceraIngreso();
}

/* Guarda toda la lista de una vez. Cada producto es su propio movimiento de
   kardex (así el saldo de cada uno cuadra fila por fila), pero todos comparten
   el mismo documento y el mismo lote, para poder verlos juntos después. */
async function guardarIngresoFactura() {
  if (!puede('productos')) { toast('🔒 No tienes permiso para registrar ingresos'); return; }
  if (!ingLista.length) { toast('⚠️ Agrega al menos un producto a la lista'); return; }
  // Si se abrió una factura para corregirla, no se registra nada nuevo
  if (ingEditando) { await guardarCambiosDeLote(); return; }

  const tipoDoc = $('#ing-doc-tipo').value;
  const numero = $('#ing-doc-numero').value.trim();
  const proveedor = $('#ing-proveedor').value.trim();
  const documento = [
    tipoDoc !== 'sin' ? `${DOCS_INGRESO[tipoDoc]}${numero ? ' ' + numero : ''}` : '',
    proveedor,
  ].filter(Boolean).join(' · ');
  const fecha = $('#ing-fecha').value || hoyISO();
  const nota = $('#ing-nota').value.trim();
  const loteId = nuevoId();

  const boton = $('#btn-ing-guardar');
  boton.disabled = true;
  try {
    await Promise.all(ingLista.map(l => registrarMovimiento({
      productoId: l.productoId,
      fecha,
      tipo: 'entrada',
      cantidad: Number(l.cantidad) || 0,
      motivo: 'compra',
      documento,
      nota,
      loteId,
      proveedor,
    })));
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo agregar el stock. Revisa tu conexión.'));
    boton.disabled = false;
    return;
  }
  const unidades = ingLista.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  const cuantos = ingLista.length;
  resetIngresoFactura();
  renderIngresos();
  renderProductos();
  renderKardex();
  toast(`✅ Stock agregado: ${cuantos} producto${cuantos === 1 ? '' : 's'}, ${unidades} unidad${unidades === 1 ? '' : 'es'}`);
}

/* ---- Modo ajuste: un solo producto ---- */
function elegirProductoAjuste(id) {
  const p = productoPorId(id);
  if (!p) return;
  $('#aj-producto').value = id;
  $('#aj-buscar').value = p.nombre;
  cerrarSugerenciasProducto('#aj-sugerencias');
  ajComboIndice = -1;
  actualizarPreviewAjuste();
}

function resetAjusteForm() {
  const f = $('#ing-form-ajuste');
  if (f) f.reset();
  $('#aj-fecha').value = hoyISO();
  $('#aj-producto').value = '';
  $('#aj-buscar').value = '';
  $('#aj-tipo').value = 'ajuste';
  llenarMotivos('ajuste');
  $('#aj-ayuda-ajuste').hidden = false;
  $('#aj-preview').hidden = true;
  cerrarSugerenciasProducto('#aj-sugerencias');
}

/* Antes de guardar nada, se ve cuánto hay ahora y cuánto va a quedar */
function actualizarPreviewAjuste() {
  const id = $('#aj-producto').value;
  const caja = $('#aj-preview');
  if (!id) { caja.hidden = true; return; }
  const stockActual = stockDe(id);
  const tipo = $('#aj-tipo').value;
  const cantidad = Number($('#aj-cantidad').value) || 0;
  // En un ajuste, la cantidad escrita ES el conteo final, no lo que se suma
  const resultante = tipo === 'ajuste' ? cantidad
    : tipo === 'salida' ? stockActual - cantidad
    : stockActual + cantidad;
  $('#aj-stock-actual').textContent = stockActual;
  $('#aj-stock-resultante').textContent = resultante;
  $('#aj-stock-resultante').closest('.ing-preview-resultado')
    .classList.toggle('ing-preview-negativo', resultante < 0);
  caja.hidden = false;
}

async function guardarAjusteForm(ev) {
  ev.preventDefault();
  if (!puede('productos')) { toast('🔒 No tienes permiso para registrar movimientos'); return; }
  const productoId = $('#aj-producto').value;
  if (!productoId) { toast('⚠️ Busca y elige el producto'); $('#aj-buscar').focus(); return; }
  const tipo = $('#aj-tipo').value;
  const cantidad = Number($('#aj-cantidad').value);
  if (!Number.isFinite(cantidad) || (tipo !== 'ajuste' && cantidad <= 0)) {
    toast('⚠️ Escribe una cantidad válida'); return;
  }
  if (tipo === 'ajuste' && cantidad < 0) { toast('⚠️ El conteo físico no puede ser negativo'); return; }

  const p = productoPorId(productoId);
  // No se deja el stock en negativo sin avisar: casi siempre es un error de tipeo
  if (tipo === 'salida' && cantidad > stockDe(productoId)) {
    if (!confirm(`Solo hay ${stockDe(productoId)} de "${p.nombre}" y estás sacando ${cantidad}.\n\n` +
      '¿Registrar igual y dejar el stock en negativo?')) return;
  }

  try {
    await registrarMovimiento({
      productoId,
      fecha: $('#aj-fecha').value || hoyISO(),
      tipo,
      cantidad,
      motivo: $('#aj-motivo').value,
      documento: '',
      nota: $('#aj-nota').value.trim(),
    });
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo registrar el movimiento. Revisa tu conexión.'));
    return;
  }
  toast(`✅ Listo. Stock de ${p ? p.nombre : 'este producto'}: ${stockDe(productoId)}`);
  resetAjusteForm();
  renderIngresos();
  renderProductos();
  renderKardex();
}

/* ---- Historial ----
   Se agrupa por lote: un camión con su factura se ve como UNA entrada con sus
   productos debajo, no como diez filas sueltas que hay que ir juntando a ojo. */
function movimientosIngresados() {
  return kardexConSaldo().filter(m => m.motivo !== 'venta').reverse();
}

function gruposDeIngreso() {
  const grupos = [];
  const porLote = new Map();
  for (const m of movimientosIngresados()) {
    const clave = m.loteId || m.id;   // sin lote, cada movimiento es su propio grupo
    if (!porLote.has(clave)) {
      const g = { clave, fecha: m.fecha, creado: m.creado, documento: m.documento || '',
        proveedor: m.proveedor || '', nota: m.nota || '', usuario: m.usuario || '',
        tipo: m.tipo, motivo: m.motivo, movimientos: [] };
      porLote.set(clave, g);
      grupos.push(g);
    }
    porLote.get(clave).movimientos.push(m);
  }
  return grupos;
}

function renderIngresos() {
  const cont = $('#ing-historial');
  if (!cont) return;
  actualizarCabeceraIngreso();
  const grupos = gruposDeIngreso().slice(0, 40);

  const hoy = hoyISO();
  const deHoy = grupos.filter(g => g.fecha === hoy);
  const unidadesHoy = deHoy.reduce((s, g) =>
    s + g.movimientos.reduce((t, m) => t + Math.max(0, cantidadConSigno(m)), 0), 0);
  $('#ing-chips').innerHTML = [
    `<span class="chip">📄 ${grupos.length} registro${grupos.length === 1 ? '' : 's'}</span>`,
    `<span class="chip chip-entrada">📅 Hoy: ${deHoy.length} · ${unidadesHoy} unidades</span>`,
  ].join('');

  $('#ing-vacio').hidden = !!grupos.length;
  if (!grupos.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = grupos.map(g => {
    const t = TIPOS_KARDEX[g.tipo] || TIPOS_KARDEX.entrada;
    const unidades = g.movimientos.reduce((s, m) => s + Math.abs(cantidadConSigno(m)), 0);
    const esLote = g.movimientos.length > 1;
    const titulo = g.documento
      ? escapeHtml(g.documento)
      : `${t.icono} ${escapeHtml(MOTIVOS_KARDEX[g.motivo] || t.nombre)}`;
    return `<div class="ing-grupo">
      <div class="ing-grupo-cab">
        <div class="ing-grupo-tit">
          <strong>${titulo}</strong>
          <span class="ing-grupo-meta">${formatoFecha(g.fecha)} · ${horaDeTimestamp(g.creado) || ''}
            · ${escapeHtml(g.usuario || '—')}</span>
        </div>
        <div class="ing-grupo-acciones">
          <span class="chip ${g.tipo === 'entrada' ? 'chip-entrada' : 'chip-salida'}">
            ${esLote ? `${g.movimientos.length} productos · ` : ''}${unidades} unidad${unidades === 1 ? '' : 'es'}
          </span>
          ${mandaComoAdmin() && g.tipo === 'entrada'
            ? `<button type="button" class="btn btn-secondary btn-small" data-editar-lote="${escapeHtml(g.clave)}"
                 title="Corregir este ingreso (pide tu código)">✏️</button>`
            : ''}
          ${mandaComoAdmin()
            ? `<button type="button" class="btn btn-danger btn-small" data-borrar-lote="${escapeHtml(g.clave)}"
                 title="Anular este ingreso (pide tu código)">🗑️</button>`
            : ''}
        </div>
      </div>
      ${g.nota ? `<p class="ing-grupo-nota">📝 ${escapeHtml(g.nota)}</p>` : ''}
      <table class="ing-grupo-tabla">
        <tbody>${g.movimientos.map(m => {
          const p = productoPorId(m.productoId);
          const c = cantidadConSigno(m);
          return `<tr>
            <td class="col-cod"><code>${escapeHtml(p ? p.codigo : '—')}</code></td>
            <td>${escapeHtml(p ? p.nombre : 'producto borrado')}</td>
            <td class="col-num ${c >= 0 ? 'kdx-entrada' : 'kdx-salida'}">${c > 0 ? '+' : ''}${c}</td>
            <td class="col-num kdx-saldo" title="Stock que quedó">${m.saldo}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
}

/* Anular un movimiento de almacén cambia el stock hacia atrás, así que es
   cosa del administrador y se pide el mismo código de seguridad que para
   borrar un crédito o una "a cuenta". */
async function borrarMovimiento(id) {
  if (!mandaComoAdmin()) { toast('🔒 Solo el administrador puede anular movimientos'); return; }
  const m = kardex.find(x => x.id === id);
  if (!m) return;
  const p = productoPorId(m.productoId);
  const nombre = p ? p.nombre : 'producto';
  const c = cantidadConSigno(m);
  // Las salidas por venta pertenecen a una nota. Se pueden anular, pero hay
  // que decirlo: la nota se queda sin su descuento de almacén y las dos hojas
  // dejan de cuadrar. Lo normal es borrar la nota entera.
  const suNota = m.notaId ? notas.find(n => n.id === m.notaId) : null;
  const aviso = suNota
    ? `\n\n⚠️ Esta salida es de la nota ${numeroCorto(suNota.numero)}, que seguirá existiendo.\n` +
      `Si lo que quieres es anular la venta, borra la nota: así se devuelve todo de una vez.`
    : '';
  if (!confirm(`¿Anular este movimiento de "${nombre}"?\n\n` +
    `${c >= 0 ? 'Entrada' : 'Salida'} de ${Math.abs(c)} · ${formatoFecha(m.fecha)}\n` +
    `El stock quedará en ${stockDe(m.productoId) - c}.${aviso}`)) return;

  const autorizado = await pedirPin(
    `Vas a anular un movimiento de almacén de "${nombre}" (${c >= 0 ? '+' : ''}${c}).`, 'anular');
  if (!autorizado) { toast('🔒 Anulación cancelada'); return; }

  try {
    await eliminarKardexDeStore(id);
  } catch (e) {
    toast(avisoDeFallo(e, '❌ No se pudo anular. Revisa tu conexión.'));
    return;
  }
  kardex = kardex.filter(x => x.id !== id);
  renderKardex();
  renderProductos();
  renderIngresos();
  toast('🗑️ Movimiento anulado');
}

/* Anula de una vez todos los productos que entraron con la misma factura */
async function borrarLoteIngreso(loteId) {
  if (!mandaComoAdmin()) { toast('🔒 Solo el administrador puede anular ingresos'); return; }
  const delLote = kardex.filter(m => (m.loteId || m.id) === loteId);
  if (!delLote.length) return;
  const unidades = delLote.reduce((s, m) => s + Math.abs(cantidadConSigno(m)), 0);
  const doc = delLote[0].documento || 'este ingreso';

  if (!confirm(`¿Anular ${doc}?\n\n` +
    `Se van a deshacer ${delLote.length} movimiento(s), ${unidades} unidad(es).\n` +
    'El stock de cada producto se recalcula solo.')) return;

  const autorizado = await pedirPin(`Vas a anular ${doc}: ${delLote.length} producto(s), ${unidades} unidad(es).`, 'anular');
  if (!autorizado) { toast('🔒 Anulación cancelada'); return; }

  try {
    await Promise.all(delLote.map(m => eliminarKardexDeStore(m.id)));
  } catch (e) {
    toast(avisoDeFallo(e, '❌ No se pudo anular. Revisa tu conexión.'));
    return;
  }
  const ids = new Set(delLote.map(m => m.id));
  kardex = kardex.filter(m => !ids.has(m.id));
  renderIngresos();
  renderProductos();
  renderKardex();
  toast(`🗑️ Ingreso anulado (${delLote.length} producto(s))`);
}

function imprimirKardex() {
  const lista = movimientosFiltrados().slice().reverse();   // del más antiguo al más nuevo
  const p = kdxFiltros.producto ? productoPorId(kdxFiltros.producto) : null;
  const rango = [kdxFiltros.desde ? `desde ${formatoFecha(kdxFiltros.desde)}` : '',
    kdxFiltros.hasta ? `hasta ${formatoFecha(kdxFiltros.hasta)}` : ''].filter(Boolean).join(' ');
  const filas = lista.map(m => {
    const prod = productoPorId(m.productoId);
    const c = cantidadConSigno(m);
    return `<tr><td>${formatoFecha(m.fecha)}</td><td>${escapeHtml(prod ? prod.codigo : '—')}</td>
      <td>${escapeHtml(prod ? prod.nombre : '—')}</td>
      <td>${escapeHtml((TIPOS_KARDEX[m.tipo] || {}).nombre || '')}</td>
      <td>${escapeHtml(MOTIVOS_KARDEX[m.motivo] || '')}</td>
      <td>${escapeHtml(m.documento || '')}</td>
      <td style="text-align:right">${c > 0 ? c : ''}</td>
      <td style="text-align:right">${c < 0 ? -c : ''}</td>
      <td style="text-align:right"><b>${m.saldo}</b></td>
      <td>${escapeHtml(mostrarComo(m.usuario) || '')}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Kardex</title>
    <style>@page { size: A4 portrait; margin: 10mm; }
      body{font-family:system-ui,sans-serif;margin:0;padding:0;color:#111}
      h1{font-size:16px;margin:0 0 3px}.sub{color:#555;margin:0 0 10px;font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}th{background:#eee}
      tr{break-inside:avoid}
    </style></head><body>
    <h1>📒 Kardex de almacén</h1>
    <p class="sub">${p ? escapeHtml(p.nombre) : 'Todos los productos'} ${escapeHtml(rango)} — ${lista.length} movimiento(s)
    ${p ? `<br>Stock actual: <b>${stockDe(p.id)}</b>` : ''}</p>
    <table><thead><tr><th>Fecha</th><th>Código</th><th>Producto</th><th>Movimiento</th><th>Motivo</th>
    <th>Documento</th><th style="text-align:right">Entrada</th><th style="text-align:right">Salida</th>
    <th style="text-align:right">Saldo</th><th>Registró</th></tr></thead>
    <tbody>${filas || '<tr><td colspan="10" style="text-align:center">Sin movimientos</td></tr>'}</tbody></table>
    <script>window.onload=function(){window.print();}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('⚠️ Permite las ventanas emergentes para imprimir'); return; }
  w.document.write(html); w.document.close();
}

/* ══════════════════════ Importe en letras ══════════════════════ */

const LETRAS_UNIDAD = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const LETRAS_DECENA = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const LETRAS_CENTENA = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function letrasHasta999(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const centena = Math.floor(n / 100), resto = n % 100;
  let txt = centena ? LETRAS_CENTENA[centena] : '';
  if (resto) {
    const r = resto < 30
      ? LETRAS_UNIDAD[resto]
      : LETRAS_DECENA[Math.floor(resto / 10)] + (resto % 10 ? ' Y ' + LETRAS_UNIDAD[resto % 10] : '');
    txt = txt ? `${txt} ${r}` : r;
  }
  return txt;
}

function letrasEnteras(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${letrasEnteras(millones)} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${letrasHasta999(miles)} MIL`);
  if (resto) partes.push(letrasHasta999(resto));
  return partes.join(' ');
}

/* "324.00" → "TRESCIENTOS VEINTICUATRO CON 00/100 SOLES" */
function montoEnLetras(monto) {
  const centavosTotales = Math.round((Number(monto) || 0) * 100);
  const enteros = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;
  // "UNO" y "VEINTIUNO" se apocopan delante del nombre de la moneda
  const txt = letrasEnteras(enteros)
    .replace(/VEINTIUNO$/, 'VEINTIÚN')
    .replace(/(^|\s)UNO$/, '$1UN');
  return `${txt} CON ${String(centavos).padStart(2, '0')}/100 SOLES`;
}

/* ══════════════════════ Notas de venta ══════════════════════ */

/* Cada zona de reparto tiene su propia serie de comprobantes. La serie sale
   sola al elegir el cliente, pero se puede cambiar a mano: a veces se atiende
   en el mostrador a alguien de otra zona. */
const SERIES = ['0001', '0002', '0003'];
const SERIE_POR_ZONA = {
  'CIUDAD': '0001', 'MODELO': '0001', 'CARRETERA': '0001', '3 DE MAYO': '0001',
  'MILAGROS': '0001', 'PADRE ALDAMIZ': '0001', 'ALAMEDA': '0001',
  'LABERINTO': '0002',
  'PAMPA': '0003',
};
const SERIE_POR_DEFECTO = '0001';

function serieDeZona(zona) {
  return SERIE_POR_ZONA[String(zona || '').trim().toUpperCase()] || SERIE_POR_DEFECTO;
}

let nvItems = [];          // líneas de la nota que se está armando
let nvClienteId = '';
let nvNumero = '';
let nvCreadoEn = 0;        // hora en que se empezó la nota
let nvEditandoId = '';     // id de la nota que se está modificando ('' = nueva)
let nvComboIndice = -1;

/* El número que lleva un comprobante, venga de una nota ("0001-00004181") o
   de la boleta anotada a mano en un crédito ("4137"). */
function numeroDeComprobante(texto) {
  const m = /(\d+)\s*$/.exec(String(texto || '').trim());
  return m ? Number(m[1]) : 0;
}

/* Cómo se ENSEÑA ese número en la pantalla: pelado, sin la serie ni los ceros
   de relleno ("0001-00004182" → "4182"), que es como se habla de él en el
   negocio. Lo guardado y lo que sale impreso conservan el número entero, que
   es el que vale como documento. Si el texto no acaba en dígitos (una boleta
   escrita a mano rara) se deja tal cual, para no esconder lo que hay. */
function numeroCorto(texto) {
  const n = numeroDeComprobante(texto);
  return n ? String(n) : String(texto || '');
}

/* El correlativo es UNO SOLO para todo el negocio: la serie dice de qué zona
   salió la nota, pero el número nunca se repite entre series. Arranca donde
   quedó el talonario de papel, así que se mira también el número de boleta de
   los créditos ya registrados. */
function siguienteCorrelativo() {
  let mayor = 0;
  for (const n of notas) mayor = Math.max(mayor, numeroDeComprobante(n.numero));
  for (const c of creditos) mayor = Math.max(mayor, numeroDeComprobante(c.boleta));
  return mayor + 1;
}

function armarNumeroNota(serie, correlativo) {
  const s = SERIES.includes(serie) ? serie : SERIE_POR_DEFECTO;
  return `${s}-${String(Math.max(1, Number(correlativo) || 1)).padStart(8, '0')}`;
}

/* Pinta serie y correlativo en la cabecera. El correlativo se puede escribir:
   hace falta para dar de alta las notas que faltan de boletas ya emitidas. */
function nvPonerNumero(serie, correlativo) {
  const sel = $('#nv-serie');
  if (sel) sel.value = SERIES.includes(serie) ? serie : SERIE_POR_DEFECTO;
  const cor = $('#nv-correlativo');
  if (cor) cor.value = correlativo || siguienteCorrelativo();
  nvNumero = armarNumeroNota(nvSerieElegida(), cor ? cor.value : correlativo);
  nvAvisarNumero();
}

function nvSerieElegida() {
  const sel = $('#nv-serie');
  return sel && SERIES.includes(sel.value) ? sel.value : SERIE_POR_DEFECTO;
}

function nvCorrelativoEscrito() {
  const cor = $('#nv-correlativo');
  return Math.max(1, Number(cor && cor.value) || 0);
}

/* Quién más está usando ese número: otra nota (no se puede) o un crédito ya
   registrado (sí se puede, y es justo lo que se busca al dar de alta una nota
   que faltaba: las dos quedan enlazadas). */
function quienUsaElNumero(correlativo, exceptoNotaId) {
  const n = Number(correlativo);
  const nota = notas.find(x => x.id !== exceptoNotaId && numeroDeComprobante(x.numero) === n);
  if (nota) return { tipo: 'nota', nota };
  // El crédito que salió de esta misma nota tampoco "usa" el número: ya son
  // el mismo papel. Avisar de que "quedarán enlazados" los que ya lo están
  // solo confunde a quien está corrigiendo una nota.
  const credito = creditos.find(c => numeroDeComprobante(c.boleta) === n
    && !(exceptoNotaId && c.notaId === exceptoNotaId));
  if (credito) return { tipo: 'credito', credito };
  return null;
}

/* Aviso bajo el número, mientras se escribe */
function nvAvisarNumero() {
  const pista = $('#nv-num-aviso');
  if (!pista) return;
  // Al modificar, la nota no choca consigo misma: es su propio número
  const usa = quienUsaElNumero(nvCorrelativoEscrito(), nvEditandoId);
  if (!usa) { pista.textContent = ''; pista.className = 'nv-num-aviso'; return; }
  if (usa.tipo === 'nota') {
    pista.textContent = `⚠️ Ese número ya es de la nota ${numeroCorto(usa.nota.numero)}`;
    pista.className = 'nv-num-aviso nv-num-choca';
  } else {
    pista.textContent = `🔗 Es la boleta del crédito de ${usa.credito.cliente || 'un cliente'}: quedarán enlazados`;
    pista.className = 'nv-num-aviso nv-num-enlaza';
  }
}

function notasOrdenadas() {
  return notas.slice().sort((a, b) => (b.creado || 0) - (a.creado || 0));
}

/* ---- El recorrido de una nota: se vende, se despacha, se cobra ----
   El enlace se guarda siempre en el papel que viene DESPUÉS (el despacho
   apunta a su nota, el crédito a la suya), y el estado se deduce mirando
   quién la apunta. Así no hay dos sitios que puedan quedar en desacuerdo. */
function despachoDeNota(notaId) {
  return despachos.find(d => esDespachoPedido(d) && d.notaId === notaId) || null;
}

function creditoDeNota(nota) {
  if (!nota) return null;
  const porId = creditos.find(c => c.notaId === nota.id);
  if (porId) return porId;
  // Un crédito creado desde el despacho de esta nota también cuenta
  const d = despachoDeNota(nota.id);
  if (d && d.creditoId) return creditos.find(c => c.id === d.creditoId) || null;
  // El que la nota apunte directamente (nota dada de alta sobre una boleta vieja)
  const porApunte = nota.creditoId && creditos.find(c => c.id === nota.creditoId);
  if (porApunte) return porApunte;
  // Y, en último término, por el NÚMERO: una nota y su crédito llevan el mismo
  // número de boleta aunque nadie los haya enlazado todavía. Sin esto, una
  // nota emitida sobre una boleta que ya estaba registrada no reconocería su
  // crédito y se le crearía otro: dos créditos por una sola venta.
  const n = numeroDeComprobante(nota.numero);
  return (n && creditos.find(c => numeroDeComprobante(c.boleta) === n)) || null;
}

const ESTADOS_NOTA = {
  anulada:   { etiqueta: '🚫 Anulada', clase: 'pedido-devuelto' },
  pendiente: { etiqueta: '🕐 Por despachar', clase: 'pedido-pendiente' },
  reparto:   { etiqueta: '🚚 En reparto', clase: 'pedido-contado' },
  credito:   { etiqueta: '📄 A crédito', clase: 'pedido-credito' },
  pagado:    { etiqueta: '✅ Pagado', clase: 'pedido-pagado' },
};

/* Ahora cada nota nace con su crédito (ver "Cada nota de venta es también un
   crédito"), así que la existencia del crédito ya no dice en qué punto va: lo
   dice el reparto. El orden es: si ya está cobrada del todo, pagada; si salió,
   lo que diga su despacho; y si no ha salido, por despachar. */
/* Pagada de verdad, con dinero de por medio. No cuenta una nota que sale en
   cero porque se regaló entera: ahí no se cobró nada, así que corregirla no
   descuadra ningún cobro y no hay razón para trabarla. */
function notaCobrada(nota) {
  if (estadoDeNota(nota) !== 'pagado') return false;
  const c = creditoDeNota(nota);
  return !!c && (Number(c.monto) || 0) > 0;
}

/* La misma condición que decide si sale el lápiz ✏️ en la lista, en un solo
   sitio: la usan tanto la lista como "anterior / siguiente" al modificar,
   para no arriesgarse a que un día digan cosas distintas. */
function notaSePuedeEditar(n) {
  if (!n) return false;
  const estado = estadoDeNota(n);
  return estado !== 'anulada' && estado !== 'reparto' && estado !== 'credito'
    && !notaCobrada(n) && puede('ventasEditar');
}

function estadoDeNota(nota) {
  // Una nota anulada ya no sigue el recorrido: se queda ahí, de constancia
  if (nota && nota.anulada) return 'anulada';
  const credito = creditoDeNota(nota);
  if (credito && estadoEfectivo(credito) === 'pagado') return 'pagado';
  const d = despachoDeNota(nota.id);
  if (d) return d.estado === 'credito' ? 'credito' : 'reparto';
  return 'pendiente';
}

/* ====== Cada nota de venta es también un crédito ======
   💳 Créditos no es una lista aparte de 🧮 Notas de venta: es la MISMA venta
   con lo que se le añade después —los cobros, la boleta firmada, el
   compromiso de pago—. Por eso la nota trae su crédito de nacimiento, en vez
   de obligar a escribir a mano lo que la nota ya dice.

   El enlace va en UNA sola dirección, y es a propósito: borrar la nota se
   lleva su crédito (esa venta no existió), pero borrar el crédito NO borra la
   nota, porque el crédito es lo añadido y la nota es el comprobante que se le
   entregó al cliente. */
async function crearCreditoDeLaNota(nota) {
  if (!nota) return null;
  if (creditoDeNota(nota)) return null;          // ya lo tiene (o se enlazó)
  // Una venta al contado se cobró en el acto: su crédito nace ya pagado, sin
  // ningún "a cuenta" inventado. No hace falta: un crédito sin abonos pero
  // marcado como pagado ya vale cero (ver saldoDe). Y así ese dinero no se
  // cuela en la hoja de cobranza del día, que es para lo que se sale a cobrar.
  const alContado = nota.condicion === 'contado';
  const cli = nota.clienteId ? clientePorId(nota.clienteId) : null;
  const credito = {
    id: nuevoId(),
    boleta: nota.numero || '',
    cliente: nota.clienteNombre || (cli ? cli.nombre : ''),
    clienteId: nota.clienteId || '',
    zona: nota.zona || (cli ? cli.zona : ''),
    monto: Number(nota.total) || 0,
    fecha: nota.fecha || hoyISO(),
    fechaDespacho: null,
    vencimiento: nota.fechaPago || sumarDias(nota.fecha || hoyISO(), settings.dias),
    abonos: [],
    notas: '',
    foto: null,
    fotoMini: null,
    notaId: nota.id,
    creado: Date.now(),
    compromiso: null,
    compromisoPor: null,
    compromisoEn: null,
  };
  credito.estado = alContado ? 'pagado' : estadoCalculado(credito);
  try {
    await guardarEnStore(credito);
    if (!creditos.some(c => c.id === credito.id)) creditos.push(credito);
    return credito;
  } catch (e) {
    console.error('No se pudo crear el crédito de la nota', nota.numero, e);
    return null;
  }
}

/* Lo que espera en el tablero es lo que TODAVÍA NO HA SALIDO, y eso no
   depende de si está cobrada: una venta al contado ya está pagada y aun así
   hay que llevársela al cliente. Por eso se mira el despacho y no la etiqueta
   —que responde a otra pregunta: en qué punto va la venta—. */
function notasPorDespachar() {
  return notasOrdenadas().filter(n => !n.anulada && !despachoDeNota(n.id));
}

function abrirVentas() {
  $('#btn-nv-nueva').hidden = !puede('ventas');
  mostrarVistaVenta('lista');
  renderVentas();
  mostrarSeccion('ventas');
}

function mostrarVistaVenta(cual) {
  $('#nv-vista-lista').hidden = cual !== 'lista';
  $('#nv-vista-form').hidden = cual !== 'form';
  if (cual === 'form') requestAnimationFrame(nvAjustarAlto);
}

/* Cuánto alto le queda al formulario. Se mide desde dónde empieza hasta el
   borde de la ventana, así que se acomoda solo aunque arriba aparezca el
   aviso de "modo local" o cambie el alto de la cabecera. */
function nvAjustarAlto() {
  const f = $('#nv-vista-form');
  if (!f || f.hidden) return;
  // En pantalla angosta el formulario se recorre entero: no se le pone tope
  if (enPantallaAngosta()) { f.style.removeProperty('--nv-alto'); return; }
  const arriba = f.getBoundingClientRect().top;
  const libre = Math.max(280, Math.round(window.innerHeight - arriba - 24));
  f.style.setProperty('--nv-alto', libre + 'px');
}

function renderVentas() {
  const cuerpo = $('#nv-body');
  if (!cuerpo) return;
  const buscado = normalizarNombre($('#nv-buscar') ? $('#nv-buscar').value : '');
  const todas = notasOrdenadas();
  const lista = buscado
    ? todas.filter(n => normalizarNombre(n.numero).includes(buscado)
        || normalizarNombre(n.clienteNombre).includes(buscado))
    : todas;

  // Lo anulado no es venta: no cuenta en el total del día ni en el de notas
  const hoy = hoyISO();
  const vivas = todas.filter(n => !n.anulada);
  const anuladasHoy = todas.filter(n => n.anulada && n.fecha === hoy).length;
  const deHoy = vivas.filter(n => n.fecha === hoy);
  const totalHoy = deHoy.reduce((s, n) => s + (Number(n.total) || 0), 0);
  $('#nv-chips').innerHTML = [
    `<span class="chip">🧮 ${vivas.length} nota${vivas.length === 1 ? '' : 's'}</span>`,
    `<span class="chip chip-entrada">📅 Hoy: ${deHoy.length} · S/ ${soles(totalHoy)}</span>`,
    anuladasHoy ? `<span class="chip chip-salida">🚫 ${anuladasHoy} anulada${anuladasHoy === 1 ? '' : 's'} hoy</span>` : '',
  ].filter(Boolean).join('');

  $('#nv-vacio').hidden = !!lista.length;
  $('.nv-tabla-wrap').hidden = !lista.length;
  if (!lista.length) {
    $('#nv-vacio').textContent = todas.length
      ? 'Ninguna nota coincide con la búsqueda.'
      : 'Todavía no has emitido notas de venta.';
    cuerpo.innerHTML = '';
    return;
  }

  cuerpo.innerHTML = lista.map(n => {
    const cat = String(n.categoria || 'C').toUpperCase();
    const estado = estadoDeNota(n);
    const est = ESTADOS_NOTA[estado] || ESTADOS_NOTA.pendiente;
    const anulada = estado === 'anulada';
    const motivo = anulada && n.anulada.motivo
      ? `<small class="nv-anul-motivo">📝 ${escapeHtml(n.anulada.motivo)}</small>` : '';
    return `<tr class="${anulada ? 'nv-fila-anulada' : ''}">
      <td class="nv-num"><strong>${escapeHtml(numeroCorto(n.numero))}</strong></td>
      <td>${formatoFecha(n.fecha)}<small>${escapeHtml(n.hora || '')}</small></td>
      <td>${escapeHtml(n.clienteNombre || '—')}${motivo}</td>
      <td class="col-um"><span class="cliente-cat cat-${cat}">${cat}</span></td>
      <td>${escapeHtml(n.zona || '—')}</td>
      <td><span class="ped-chip ${est.clase}">${est.etiqueta}</span></td>
      <td class="col-num">${(n.items || []).length}</td>
      <td class="col-num"><strong>${soles(n.total)}</strong></td>
      <td>${escapeHtml(mostrarComo(anulada ? n.anulada.por : n.emitidaPor) || '—')}</td>
      <td class="col-acc">
        ${notaSePuedeEditar(n) ? `<button type="button" class="btn btn-secondary btn-small" data-editar-nota="${escapeHtml(n.id)}" title="Modificar la nota">✏️</button>` : ''}
        ${!anulada && estado !== 'pendiente' ? `<button type="button" class="btn btn-secondary btn-small" data-seguir-nota="${escapeHtml(n.id)}" title="Ver su despacho o su crédito">🔗</button>` : ''}
        <button type="button" class="btn btn-secondary btn-small" data-ver-nota="${escapeHtml(n.id)}" title="Verla tal como se imprimirá, sin imprimir">👁️</button>
        <button type="button" class="btn btn-secondary btn-small" data-imprimir-nota="${escapeHtml(n.id)}" title="Imprimir">🖨️</button>
        ${!anulada && puede('ventasAnular') ? `<button type="button" class="btn btn-danger btn-small" data-anular-nota="${escapeHtml(n.id)}" title="Anular: la nota se queda de constancia">🚫</button>` : ''}
        ${mandaComoAdmin() ? `<button type="button" class="btn btn-danger btn-small" data-eliminar-nota="${escapeHtml(n.id)}" title="Eliminar del todo (pide tu código)">🗑️</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

/* A crédito la fecha de pago se propone según los días configurados; al
   contado se cobra el mismo día. */
function nvProponerFechaPago() {
  const dias = $('#nv-condicion').value === 'credito' ? Number(settings.dias) || 30 : 0;
  $('#nv-fpago').value = sumarDias($('#nv-fecha').value || hoyISO(), dias);
}

/* Abre una nota ya emitida para modificarla. La nota conserva su id, su
   número y su hora: es la MISMA nota, corregida, no una copia. */
function abrirNotaParaEditar(notaId) {
  if (!puede('ventasEditar')) { toast('🔒 No tienes permiso para modificar notas de venta'); return; }
  const n = notas.find(x => x.id === notaId);
  if (!n) return;
  if (n.anulada) { toast('🚫 Esa nota está anulada: ya no se puede modificar'); return; }
  // Salió con el repartidor: el papel ya no está aquí y la mercadería tampoco.
  // Cambiarla ahora dejaría la nota diciendo una cosa y el reparto otra.
  if (estadoDeNota(n) === 'reparto') {
    toast('🚚 Esa nota ya salió a reparto: no se puede modificar hasta que vuelva');
    return;
  }
  // La boleta volvió firmada y ya es un crédito: cambiar la nota ahora
  // dejaría al crédito diciendo un importe que la nota ya no dice.
  if (estadoDeNota(n) === 'credito') {
    toast('📄 Esa nota ya está a crédito: no se puede modificar. Corrige el crédito si hace falta.');
    return;
  }
  // Ya está cobrada: cambiarle el importe ahora dejaría el dinero recibido
  // sin cuadrar con lo que dice la venta.
  if (notaCobrada(n)) {
    toast('✅ Esa nota ya está pagada: no se puede modificar');
    return;
  }
  // Si ya se cobró algo, el importe no puede moverse por debajo del cobro
  const c = creditoDeNota(n);
  if (c && abonosDe(c).length) {
    alert(`No se puede modificar la nota ${numeroCorto(n.numero)}: su crédito ya tiene cobros registrados.\n\n`
      + 'Corrige primero el crédito.');
    return;
  }
  abrirNuevaNota(n, n.id);
}

function abrirNuevaNota(base = null, editandoId = '') {
  if (!puede('ventas')) { toast('🔒 No tienes permiso para emitir notas de venta'); return; }
  if (!productosActivos().length) {
    toast('⚠️ Primero crea productos en la sección 🛒 Productos');
    return;
  }
  llenarSelectoresProducto();
  nvEditandoId = editandoId;
  nvItems = base ? (base.items || []).map(it => ({ ...it })) : [];
  nvCreadoEn = editandoId && base.creado ? base.creado : Date.now();
  if (editandoId) nvPonerNumero(base.serie || serieDeZona(base.zona), numeroDeComprobante(base.numero));
  else nvPonerNumero(base ? serieDeZona(base.zona) : SERIE_POR_DEFECTO, siguienteCorrelativo());
  $('#nv-form-titulo').textContent = editandoId ? 'Modificando nota' : 'Nota de venta';
  $('#nv-fecha').value = editandoId ? (base.fecha || hoyISO()) : hoyISO();
  $('#nv-hora').textContent = editandoId ? (base.hora || '') : horaDeTimestamp(nvCreadoEn);
  $('#nv-vendedor').textContent = quienSoy();
  // Casi todo sale a crédito, así que esa es la opción que viene puesta
  $('#nv-condicion').value = base ? (base.condicion || 'credito') : 'credito';
  nvProponerFechaPago();
  $('#nv-descuento').value = 0;
  // Tocar el precio a mano es un permiso aparte: a quien no lo tenga ni se le
  // ofrece, y vende siempre con el precio de la categoría del cliente.
  $('#nv-permitir-precios').checked = false;
  $('.nv-permiso').hidden = !puede('preciosEditar');
  /* La serie, el número y la fecha de emisión son el talonario: cambiarlos a
     mano sirve para dar de alta una boleta que faltaba, y eso lo decide el
     administrador. Al vendedor se le enseñan —tiene que ver con qué número
     está vendiendo— pero no los toca: el correlativo va solo. */
  const mandaEl = mandaComoAdmin();
  $('#nv-serie').disabled = !mandaEl;
  $('#nv-correlativo').readOnly = !mandaEl;
  $('#nv-fecha').disabled = !mandaEl;
  // La pista de abajo la lleva la zona del cliente, así que lo de "esto no lo
  // tocas tú" va donde se toca: en el propio campo.
  const porQue = mandaEl ? '' : 'Solo el administrador puede cambiarlo';
  $('#nv-serie').title = porQue;
  $('#nv-correlativo').title = porQue || 'Se puede cambiar para dar de alta una boleta que falta';
  $('#nv-fecha').title = porQue;
  $('#nv-cantidad').value = '';
  limpiarBuscadorNota();
  nvSeleccionarCliente(base ? (base.clienteId || '') : '');
  actualizarNavEntreNotas();
  mostrarVistaVenta('form');
  renderNotaItems();
  window.scrollTo(0, 0);
}

/* ---- Buscador de cliente de la nota ---- */
function nvRenderSugerencias(texto) {
  const caja = $('#nv-cliente-sugerencias');
  const clave = normalizarNombre(texto);
  if (!clave) { caja.hidden = true; caja.innerHTML = ''; return; }
  const encontrados = clientes.filter(c =>
    normalizarNombre(c.nombre).includes(clave) || normalizarNombre(c.codigo).includes(clave)).slice(0, 8);
  if (!encontrados.length) {
    caja.innerHTML = '<div class="combo-vacio">Ningún cliente coincide</div>';
    caja.hidden = false;
    return;
  }
  nvComboIndice = -1;
  caja.innerHTML = encontrados.map((c, i) => {
    const cat = categoriaDe(c);
    return `<button type="button" class="combo-item" data-nv-cliente="${escapeHtml(c.id)}" data-i="${i}">
      <span class="cliente-cat cat-${cat}">${cat}</span>
      <span class="combo-nombre">${escapeHtml(c.nombre)}</span>
      <small>${escapeHtml(c.codigo || '')} ${c.zona ? '· ' + escapeHtml(c.zona) : ''}</small>
    </button>`;
  }).join('');
  caja.hidden = false;
}

function nvCerrarSugerencias() {
  const caja = $('#nv-cliente-sugerencias');
  if (caja) { caja.hidden = true; caja.innerHTML = ''; }
  nvComboIndice = -1;
}

function nvSeleccionarCliente(id) {
  nvClienteId = id || '';
  $('#nv-cliente-id').value = nvClienteId;
  nvCerrarSugerencias();
  const cli = nvClienteId ? clientePorId(nvClienteId) : null;
  $('#nv-cliente-buscar').value = cli ? cli.nombre : '';
  $('#nv-ficha').hidden = !cli;
  $('#nv-sin-cliente').hidden = !!cli;
  if (cli) {
    const cat = categoriaDe(cli);
    const insignia = $('#nv-ficha-cat');
    insignia.textContent = cat;
    insignia.className = `nv-cat cat-${cat}`;
    insignia.title = `Categoría de precio ${cat} · ${CATEGORIAS[cat].detalle}`;
    $('#nv-fc-nombre').textContent = cli.nombre;
    $('#nv-fc-codigo').textContent = cli.codigo || '—';
    $('#nv-fc-zona').textContent = cli.zona || '—';
    $('#nv-fc-ruc').textContent = cli.ruc || '—';
    $('#nv-fc-direccion').textContent = cli.direccion || '—';
    $('#nv-fc-telefono').textContent = cli.telefono || '—';
    const deuda = creditosDeCliente(cli.id).reduce((s, c) => s + saldoDe(c), 0);
    $('#nv-fc-deuda').textContent = deuda > 0 ? formatoMonto(deuda) : 'sin deuda';
    $('#nv-fc-deuda').className = deuda > 0 ? 'nv-deuda' : '';
    // La serie va con la zona del cliente. Se cambia sola aquí; si el usuario
    // la toca después, manda lo que él eligió.
    nvPonerNumero(serieDeZona(cli.zona), nvCorrelativoEscrito());
    $('#nv-serie-pista').textContent = `Serie de ${cli.zona || 'la zona'}`;
  } else {
    $('#nv-serie-pista').textContent = 'La serie se elige sola según la zona';
  }
  // Al cambiar de cliente cambia la categoría: se repone el precio de lista de
  // las líneas que nadie tocó a mano (las editadas se respetan).
  reponerPreciosDeLista();
  renderNotaItems();
}

function categoriaActual() {
  const cli = nvClienteId ? clientePorId(nvClienteId) : null;
  return cli ? categoriaDe(cli) : 'C';
}

function reponerPreciosDeLista() {
  const cat = categoriaActual();
  for (const it of nvItems) {
    if (it.precioEditado) continue;
    const p = productoPorId(it.productoId);
    if (p) it.precio = precioDe(p, cat);
  }
}

/* ---- Buscador de productos de la nota ---- */
let nvProdIndice = -1;

function elegirProductoNota(id) {
  const p = productoPorId(id);
  if (!p) return;
  $('#nv-producto').value = id;
  $('#nv-buscar-producto').value = p.nombre;
  cerrarSugerenciasProducto('#nv-prod-sugerencias');
  nvProdIndice = -1;
}

function limpiarBuscadorNota() {
  $('#nv-buscar-producto').value = '';
  $('#nv-producto').value = '';
  cerrarSugerenciasProducto('#nv-prod-sugerencias');
  nvProdIndice = -1;
}

function agregarItemNota() {
  const id = $('#nv-producto').value;
  if (!id) {
    toast('⚠️ Busca y elige el producto');
    $('#nv-buscar-producto').focus();
    return;
  }
  // Aquí se venden sacos, cajas y baldes: nada se parte por la mitad, así que
  // la cantidad es siempre un número entero.
  const escrito = $('#nv-cantidad').value.trim();
  const cantidad = escrito === '' ? NaN : Number(escrito);
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    toast(Number.isFinite(cantidad) && cantidad > 0
      ? '⚠️ La cantidad tiene que ser un número entero'
      : '⚠️ Escribe cuántos van');
    $('#nv-cantidad').focus();
    return;
  }
  const p = productoPorId(id);
  if (!p) return;

  // Si el producto ya está en la nota, se suma a la línea que ya existe. Con
  // una excepción: una línea que ya está de BONIFICACIÓN no se toca. Si se
  // regalaron 3 y ahora se venden 5 cobrando, son dos cosas distintas y van en
  // dos renglones; si no, los 5 se colarían dentro del regalo.
  const yaEsta = nvItems.find(it => it.productoId === id && !it.bonificacion);
  if (yaEsta) {
    yaEsta.cantidad = (Number(yaEsta.cantidad) || 0) + cantidad;
  } else {
    nvItems.push({
      productoId: p.id,
      codigo: p.codigo,
      descripcion: p.nombre,
      um: umDe(p),
      cantidad,
      precio: precioDe(p, categoriaActual()),
      precioEditado: false,
    });
  }
  limpiarBuscadorNota();
  $('#nv-cantidad').value = '';
  $('#nv-buscar-producto').focus();   // el siguiente producto se escribe seguido
  renderNotaItems();
}

/* Lo que vale una línea. Una bonificación se cobra y se descuenta por el
   mismo importe: el producto queda con su precio a la vista —para que se sepa
   qué se está regalando— y el neto de la línea es cero. */
function cuentaDeLinea(it) {
  const importe = (Number(it.cantidad) || 0) * (Number(it.precio) || 0);
  const dsctoBonif = it.bonificacion ? importe : 0;
  return { importe, dsctoBonif, neto: importe - dsctoBonif };
}

function renderNotaItems() {
  const cuerpo = $('#nv-items-body');
  if (!cuerpo) return;
  const editable = $('#nv-permitir-precios').checked && puede('preciosEditar');
  $('#nv-items-vacio').hidden = !!nvItems.length;
  $('.nv-items-wrap').hidden = !nvItems.length;

  cuerpo.innerHTML = nvItems.map((it, i) => {
    const { importe, dsctoBonif, neto } = cuentaDeLinea(it);
    const p = productoPorId(it.productoId);
    const stock = p ? stockDe(p.id) : 0;
    const falta = p && (Number(it.cantidad) || 0) > stock;
    return `<tr class="${it.bonificacion ? 'nv-fila-bonif' : ''}">
      <td class="col-n">${i + 1}</td>
      <td class="col-cod"><code>${escapeHtml(it.codigo || '—')}</code></td>
      <td>${escapeHtml(it.descripcion || '')}
        ${it.bonificacion ? '<span class="nv-etq-bonif">Bonificación</span>' : ''}
        ${falta ? `<small class="nv-sin-stock">⚠️ solo hay ${stock} en almacén</small>` : ''}
        ${it.precioEditado ? '<small class="nv-precio-tocado">precio modificado a mano</small>' : ''}</td>
      <td class="col-num">
        <input type="number" class="input input-mini" data-nv-cant="${i}" min="1" step="1" inputmode="numeric" value="${it.cantidad}">
      </td>
      <td class="col-um">${escapeHtml(it.um || '')}</td>
      <td class="col-num">
        <input type="number" class="input input-mini" data-nv-precio="${i}" min="0" step="0.01"
          value="${Number(it.precio).toFixed(2)}" ${editable ? '' : 'readonly'}>
      </td>
      <td class="col-num nv-importe">${soles(importe)}</td>
      <td class="col-num nv-dscto">${dsctoBonif ? '−' + soles(dsctoBonif) : '—'}</td>
      <td class="col-num nv-neto"><strong>${soles(neto)}</strong></td>
      <td class="col-acc">
        <button type="button" class="btn btn-secondary btn-small" data-nv-bonif="${i}"
          title="${it.bonificacion ? 'Volver a cobrarla' : 'Convertir en bonificación (se regala)'}"
          aria-pressed="${it.bonificacion ? 'true' : 'false'}">🎁</button>
        <button type="button" class="btn btn-danger btn-small" data-nv-quitar="${i}" title="Quitar">✕</button>
      </td>
    </tr>`;
  }).join('');

  recalcularTotalesNota();
}

function recalcularTotalesNota() {
  let subtotal = 0, bonificacion = 0;
  for (const it of nvItems) {
    const c = cuentaDeLinea(it);
    subtotal += c.importe;
    bonificacion += c.dsctoBonif;
  }
  const cobrable = subtotal - bonificacion;
  let descuento = Number($('#nv-descuento').value) || 0;
  if (descuento < 0) descuento = 0;
  if (descuento > cobrable) descuento = cobrable;
  const total = cobrable - descuento;
  $('#nv-subtotal').textContent = soles(subtotal);
  $('#nv-bonif').textContent = bonificacion ? '−' + soles(bonificacion) : soles(0);
  $('#nv-bonif').parentElement.hidden = !bonificacion;
  $('#nv-total').textContent = soles(total);
  $('#nv-letras').textContent = nvItems.length ? montoEnLetras(total) : '—';
  return { subtotal, bonificacion, descuento, total };
}

function armarNota() {
  const cli = nvClienteId ? clientePorId(nvClienteId) : null;
  if (!cli) { toast('⚠️ Elige el cliente de la nota'); $('#nv-cliente-buscar').focus(); return null; }
  if (!nvItems.length) { toast('⚠️ Agrega al menos un producto'); return null; }
  const { subtotal, bonificacion, descuento, total } = recalcularTotalesNota();
  const previa = nvEditandoId ? notas.find(x => x.id === nvEditandoId) : null;
  return {
    id: nvEditandoId || nuevoId(),
    numero: armarNumeroNota(nvSerieElegida(), nvCorrelativoEscrito()),
    serie: nvSerieElegida(),
    fecha: $('#nv-fecha').value || hoyISO(),
    hora: horaDeTimestamp(nvCreadoEn),
    clienteId: cli.id,
    clienteNombre: cli.nombre,
    clienteCodigo: cli.codigo || '',
    clienteRuc: cli.ruc || '',
    clienteDireccion: cli.direccion || '',
    clienteTelefono: cli.telefono || '',
    categoria: categoriaDe(cli),
    zona: cli.zona || '',
    condicion: $('#nv-condicion').value,
    fechaPago: $('#nv-fpago').value || '',
    preciosModificados: $('#nv-permitir-precios').checked && nvItems.some(it => it.precioEditado),
    items: nvItems.map(it => {
      const { importe, dsctoBonif, neto } = cuentaDeLinea(it);
      return {
        productoId: it.productoId, codigo: it.codigo, descripcion: it.descripcion, um: it.um,
        cantidad: Number(it.cantidad) || 0, precio: Number(it.precio) || 0,
        importe, bonificacion: !!it.bonificacion, dsctoBonif, neto,
        precioEditado: !!it.precioEditado,
      };
    }),
    subtotal, bonificacion, descuento, total,
    enLetras: montoEnLetras(total),
    // Al modificar, la nota sigue siendo de quien la emitió: se anota aparte
    // quién la tocó y cuándo, para que no se pierda de vista.
    emitidaPor: previa ? (previa.emitidaPor || quienSoy()) : quienSoy(),
    creditoId: previa ? (previa.creditoId || '') : '',
    modificadaPor: previa ? quienSoy() : '',
    modificadaEn: previa ? marcaDeTiempo() : null,
    creado: nvCreadoEn || Date.now(),
  };
}

async function guardarNota(imprimir) {
  if (!puede('ventas')) { toast('🔒 No tienes permiso para emitir notas de venta'); return; }
  const nota = armarNota();
  if (!nota) return;
  const editando = !!nvEditandoId;

  // Dos notas no pueden llevar el mismo número. Se comprueba al grabar y no
  // al escribir, porque entre medias otro pudo emitir una desde su tablet.
  const correlativo = numeroDeComprobante(nota.numero);
  const usa = quienUsaElNumero(correlativo, nota.id);
  if (usa && usa.tipo === 'nota') {
    const libre = siguienteCorrelativo();
    if (!confirm(`El número ${correlativo} ya es de la nota ${numeroCorto(usa.nota.numero)}.\n\n` +
      `¿Usar el ${libre}, que está libre?`)) { $('#nv-correlativo').focus(); return; }
    nota.numero = armarNumeroNota(nota.serie, libre);
  }
  // Si el número es el de una boleta ya registrada como crédito, es que se
  // está dando de alta la nota que faltaba: quedan enlazadas.
  const creditoDelMismoNumero = usa && usa.tipo === 'credito' ? usa.credito : null;
  if (creditoDelMismoNumero) nota.creditoId = creditoDelMismoNumero.id;

  const btnG = $('#btn-nv-guardar'), btnI = $('#btn-nv-guardar-imprimir');
  btnG.disabled = btnI.disabled = true;
  try {
    await guardarNotaEnStore(nota);
    if (!modoNube) {
      const i = notas.findIndex(x => x.id === nota.id);
      if (i >= 0) notas[i] = nota; else notas.push(nota);
    }
    // Al modificar se retiran del kardex las salidas viejas y se anotan las
    // nuevas: es más simple y más seguro que ir línea por línea calculando
    // diferencias, y el stock queda exactamente en lo que dice la nota.
    if (editando) {
      const viejas = kardex.filter(m => m.notaId === nota.id && m.motivo === 'venta');
      await Promise.all(viejas.map(m => eliminarKardexDeStore(m.id)));
      kardex = kardex.filter(m => !(m.notaId === nota.id && m.motivo === 'venta'));
    }
    // Cada producto vendido sale del almacén, con la nota como documento.
    // Van a la vez: si fueran de una en una, con la nube cada línea esperaría
    // su confirmación y una nota de ocho productos tardaría una eternidad.
    await Promise.all(nota.items.map(it => registrarMovimiento({
      productoId: it.productoId, fecha: nota.fecha, tipo: 'salida', cantidad: it.cantidad,
      motivo: 'venta', documento: `Nota ${nota.numero}`, notaId: nota.id,
    })));
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo guardar la nota. Revisa tu conexión.'));
    btnG.disabled = btnI.disabled = false;
    return;
  }
  btnG.disabled = btnI.disabled = false;

  // El enlace se anota también en el crédito, para que se vea desde los dos lados
  if (creditoDelMismoNumero) {
    try {
      await guardarEnStore({ ...creditoDelMismoNumero, notaId: nota.id });
      const i = creditos.findIndex(c => c.id === creditoDelMismoNumero.id);
      if (i >= 0) creditos[i] = { ...creditos[i], notaId: nota.id };
    } catch (e) { console.error('No se pudo enlazar la nota con el crédito:', e); }
  }

  // Si la nota ya tenía despacho o crédito, se les pasa el importe nuevo: si
  // no, quedarían diciendo lo que la nota decía antes de corregirla.
  if (editando) await ponerAlDiaLoQueCuelgaDeLaNota(nota);
  // Y si es nueva, su crédito nace con ella: la venta ya está hecha y lo que
  // falta —cobrarla— se lleva en 💳 Créditos.
  else await crearCreditoDeLaNota(nota);

  toast(editando
    ? `✏️ Nota ${numeroCorto(nota.numero)} modificada`
    : (creditoDelMismoNumero
      ? `✅ Nota ${numeroCorto(nota.numero)} guardada y enlazada con su crédito`
      : `✅ Nota de venta ${numeroCorto(nota.numero)} guardada`));
  if (imprimir) imprimirNota(nota);
  nvEditandoId = '';
  nvItems = [];
  nvClienteId = '';
  mostrarVistaVenta('lista');
  renderVentas();
  renderProductos();
  renderKardex();
  render();
}

/* Después de corregir una nota, su despacho y su crédito tienen que decir lo
   mismo que ella: el cliente, el número y el importe. */
async function ponerAlDiaLoQueCuelgaDeLaNota(nota) {
  const d = despachoDeNota(nota.id);
  if (d) {
    const actualizado = { ...d, cliente: nota.clienteNombre || '', clienteId: nota.clienteId || '',
      zona: nota.zona || '', boleta: nota.numero || '', monto: Number(nota.total) || 0,
      emision: nota.fecha || d.emision };
    try {
      await guardarDespachoEnStore(actualizado);
      const i = despachos.findIndex(x => x.id === d.id);
      if (i >= 0) despachos[i] = actualizado;
    } catch (e) { console.error('No se pudo poner al día el despacho:', e); }
  }
  const c = creditoDeNota(nota);
  // Un crédito con cobros no se toca: ahí ya no manda la nota (y modificar
  // una nota así ni siquiera se permite).
  if (c && !abonosDe(c).length) {
    const actualizado = { ...c, boleta: nota.numero || c.boleta, cliente: nota.clienteNombre || c.cliente,
      zona: nota.zona || c.zona, monto: Number(nota.total) || 0 };
    // Si se corrigió la condición, el crédito la sigue: lo que era al contado
    // pasa a estar por cobrar, y al revés. Solo mientras no tenga cobros; con
    // dinero de por medio manda lo cobrado, no lo que diga la nota.
    actualizado.estado = nota.condicion === 'contado' ? 'pagado' : estadoCalculado({ ...actualizado, estado: '' });
    try {
      await guardarEnStore(actualizado);
      const i = creditos.findIndex(x => x.id === c.id);
      if (i >= 0) creditos[i] = actualizado;
    } catch (e) { console.error('No se pudo poner al día el crédito:', e); }
  }
}

/* ---- De la nota al reparto ----
   Abre el formulario de despacho con lo que ya dice la nota: cliente, zona,
   número y monto. Lo único que queda por poner es quién la lleva y cuándo. */
function despacharNota(notaId) {
  if (!puede('despachos')) { toast('🔒 No tienes permiso para armar despachos'); return; }
  const n = notas.find(x => x.id === notaId);
  if (!n) return;
  if (despachoDeNota(notaId)) { toast('⚠️ Esa nota ya está en un despacho'); return; }
  // Si ya se está en Despachos no se toca el día que se esté mirando
  if ($('#view-despachos').hidden) abrirDespachos();
  abrirFormDespacho(null, {
    notaId: n.id,
    clienteId: n.clienteId || '',
    cliente: n.clienteNombre || '',
    zona: n.zona || '',
    boleta: n.numero || '',
    monto: Number(n.total) || 0,
    emision: n.fecha || hoyISO(),
  });
}

/* La flecha del tablero. Con una sola nota se abre el despacho de siempre, ya
   prellenado. Con varias se abre en modo lote: se pregunta una sola vez quién
   las lleva y qué día, y al guardar sale un despacho por cada nota —que es
   como va de verdad, un camión con seis boletas distintas. */
function mandarNotasAReparto(ids) {
  if (!puede('despachos')) { toast('🔒 No tienes permiso para armar despachos'); return; }
  const pendientes = ids.filter(id => !despachoDeNota(id));
  if (!pendientes.length) { toast('⚠️ Esas notas ya están en un despacho'); return; }
  if (pendientes.length === 1) { despacharNota(pendientes[0]); return; }
  if ($('#view-despachos').hidden) abrirDespachos();
  abrirFormDespacho(null, { lote: pendientes });
}

/* Lleva al papel siguiente: al crédito si ya lo tiene, si no al despacho */
function seguirNota(notaId) {
  const n = notas.find(x => x.id === notaId);
  if (!n) return;
  const c = creditoDeNota(n);
  if (c) { abrirInfo(c); return; }
  const d = despachoDeNota(notaId);
  if (d) { abrirDespachos(); abrirDetalleDespacho(d.id); return; }
  toast('Esa nota todavía no salió a reparto');
}

/* ---- "Anterior / Siguiente" al modificar una nota ----
   Se mueve por NUMERACIÓN, no por fecha de creación: "Anterior" es el
   número de boleta anterior (uno menos), "Siguiente" el que sigue (uno más)
   — como pasar las hojas de un talonario. Las que no tienen un número
   comprensible (casos raros, sin dígitos) quedan al final, sin estorbar.
   Si la vecina YA NO se puede editar —salió a reparto, ya es un crédito,
   quedó pagada o anulada— no tiene sentido abrirla en modo edición: en su
   lugar se enseña su despacho o su crédito, igual que el botón 🔗. */
function notasPorNumero() {
  return notas.slice().sort((a, b) => {
    const na = numeroDeComprobante(a.numero) || Infinity;
    const nb = numeroDeComprobante(b.numero) || Infinity;
    return na - nb;
  });
}

function irANotaAdyacente(paso) {
  const lista = notasPorNumero();
  const i = lista.findIndex(n => n.id === nvEditandoId);
  if (i < 0) return;
  const destino = lista[i + paso];
  if (!destino) {
    toast(paso < 0 ? '⏹️ Ya estás en el número más bajo' : '⏹️ Ya estás en el número más alto');
    return;
  }
  if (notaSePuedeEditar(destino)) { abrirNotaParaEditar(destino.id); return; }
  if (destino.anulada) {
    toast(`🚫 La nota ${numeroCorto(destino.numero)} está anulada: no se puede editar`);
    return;
  }
  if (creditoDeNota(destino) || despachoDeNota(destino.id)) { seguirNota(destino.id); return; }
  toast(`🔒 La nota ${numeroCorto(destino.numero)} no se puede editar`);
}

/* Muestra u oculta "Anterior / Siguiente", y los apaga en la punta de la
   numeración: no tiene caso ofrecer un paso que no lleva a ninguna parte. */
function actualizarNavEntreNotas() {
  const nav = $('#nv-cab-nav');
  if (!nav) return;
  const editando = !!nvEditandoId;
  nav.hidden = !editando;
  if (!editando) return;
  const lista = notasPorNumero();
  const i = lista.findIndex(n => n.id === nvEditandoId);
  $('#btn-nv-anterior').disabled = i <= 0;
  $('#btn-nv-siguiente').disabled = i < 0 || i >= lista.length - 1;
}

/* ---- Anular una nota ----
   Una nota emitida NO se borra: el papel existe y el número está usado, así
   que se queda de constancia marcada como anulada. Lo que sí se deshace es
   todo lo que colgaba de ella: la mercadería vuelve al almacén con su propio
   apunte en el kardex, su despacho desaparece del reparto y su crédito deja
   de existir, quedando la boleta registrada como anulada en Créditos.

   No pide el código: anular deja rastro de todo —la nota se queda, el kardex
   anota la devolución y la boleta figura anulada en Créditos—, así que un
   error se ve y se arregla emitiendo otra nota. Lo que sí pide código es
   ELIMINAR, que es lo que no deja rastro. */
async function anularNota(notaId) {
  if (!puede('ventasAnular')) { toast('🔒 No tienes permiso para anular notas de venta'); return; }
  const n = notas.find(x => x.id === notaId);
  if (!n) return;
  if (n.anulada) { toast('🚫 Esa nota ya está anulada'); return; }

  const d = despachoDeNota(notaId);
  const c = creditoDeNota(n);
  // El dinero ya cobrado está en la hoja de cobranza de su día: hacerlo
  // desaparecer desde aquí descuadraría esa hoja sin que nadie se entere.
  if (c && abonosDe(c).length) {
    alert(`No se puede anular la nota ${numeroCorto(n.numero)}: su crédito (boleta ${numeroCorto(c.boleta)}) `
      + `ya tiene ${abonosDe(c).length} cobro(s) registrado(s).\n\n`
      + 'Quita primero esos cobros, o corrige el crédito a mano.');
    return;
  }

  const motivo = prompt(`Anular la nota de venta ${numeroCorto(n.numero)}\n\n`
    + `${n.clienteNombre || 'Sin cliente'} · ${soles(n.total)}\n\n`
    + '¿Por qué se anula? (queda registrado)', '');
  if (motivo === null) return;
  const texto = motivo.trim();
  if (!texto) { toast('⚠️ Escribe el motivo de la anulación'); return; }

  const salidas = kardex.filter(m => m.notaId === notaId && m.motivo === 'venta');
  const detalle = salidas.length
    ? `\n\nVolverán al almacén ${salidas.length} producto(s), con su apunte en el kardex.` : '';
  const conDespacho = d ? '\nSe quitará de la zona de despachos.' : '';
  const conCredito = c ? `\nSe borrará su crédito (boleta ${numeroCorto(c.boleta)}) y quedará como anulado.` : '';
  if (!confirm(`¿Anular la nota ${numeroCorto(n.numero)}?${detalle}${conDespacho}${conCredito}\n\n`
    + 'La nota se queda registrada como anulada; no se borra.')) return;

  const marca = { motivo: texto, por: quienSoy(), en: marcaDeTiempo() };
  const anulada = { ...n, anulada: marca };
  try {
    // 1) La nota queda marcada, sin perderse
    await guardarNotaEnStore(anulada);
    // 2) La mercadería vuelve, y se ve por qué volvió
    await Promise.all(salidas.map(m => registrarMovimiento({
      productoId: m.productoId, fecha: hoyISO(), tipo: 'entrada', cantidad: Math.abs(m.cantidad),
      motivo: 'anulacion', documento: `Anulación nota ${numeroCorto(n.numero)}`, notaId: n.id,
      nota: texto,
    })));
    // 3) Deja de estar en reparto
    if (d) await eliminarDespachoDeStore(d.id);
    // 4) Su crédito desaparece, pero la boleta queda anotada como anulada
    if (c) await eliminarDeStore(c.id);
    await guardarAnuladoEnStore({
      id: String(n.numero),
      boleta: String(n.numero),
      motivo: texto,
      notaId: n.id,
      anuladoPor: quienSoy(),
      anuladoEn: marca.en,
    });
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo anular la nota. Revisa tu conexión.'));
    return;
  }

  const i = notas.findIndex(x => x.id === n.id);
  if (i >= 0) notas[i] = anulada;
  if (d) despachos = despachos.filter(x => x.id !== d.id);
  if (c) creditos = creditos.filter(x => x.id !== c.id);
  if (!anulados.some(a => String(a.boleta) === String(n.numero))) {
    anulados.push({ id: String(n.numero), boleta: String(n.numero), motivo: texto,
      notaId: n.id, anuladoPor: quienSoy(), anuladoEn: marca.en });
  }

  toast(`🚫 Nota ${numeroCorto(n.numero)} anulada${salidas.length ? ' y stock devuelto' : ''}`);
  renderVentas();
  renderProductos();
  renderKardex();
  renderListaDespachos();
  render();
}

/* ---- Eliminar una nota ----
   Esto sí borra: la nota desaparece y no queda rastro de que existió, así que
   es solo del administrador y pide el código de seguridad. Deshace lo mismo
   que anular —el stock vuelve, el despacho se va, el crédito desaparece— pero
   sin dejar constancia. Para lo de todos los días está ANULAR.

   Si el crédito ya tenía cobros, ANTES no se dejaba: había que ir a la ficha,
   quitar los cobros uno por uno y recién volver aquí. Ahora se borra todo de
   una sola vez, porque la nota y su crédito son la misma venta y no tiene
   sentido desarmarla a pedazos. Lo que no cambia es el aviso: se dice cuántos
   cobros son, por cuánto y de qué día, y encima se pide el código. */
async function eliminarNota(notaId) {
  if (!mandaComoAdmin()) { toast('🔒 Solo el administrador puede eliminar notas'); return; }
  const n = notas.find(x => x.id === notaId);
  if (!n) return;

  const d = despachoDeNota(notaId);
  const c = creditoDeNota(n);
  const cobros = c ? abonosDe(c) : [];

  const salidas = kardex.filter(m => m.notaId === notaId);
  const detalle = salidas.length
    ? `\n\nSe borrarán sus ${salidas.length} apunte(s) de almacén y el stock volverá como estaba.` : '';
  const conDespacho = d ? '\nSe quitará de la zona de despachos.' : '';
  const conCredito = c ? `\nSe borrará su crédito (boleta ${numeroCorto(c.boleta)}).` : '';
  // La hoja de cobranza de cada día se arma con los abonos de los créditos: al
  // irse el crédito, ese dinero deja de figurar en la hoja de su día y el total
  // de ese día baja. No se puede avisar en general, hay que decir qué hojas
  // quedan distintas, así que se nombran los días.
  const diasCobrados = [...new Set(cobros.map(a => a.fecha).filter(Boolean))].sort();
  const enDias = diasCobrados.length
    ? ` del ${diasCobrados.map(formatoFecha).join(', ')}` : '';
  const conCobros = cobros.length
    ? `\n\n⚠️ ATENCIÓN: ese crédito ya tiene ${cobros.length} cobro(s)${enDias} `
      + `por ${soles(totalAbonado(c))}.\nSe borran también, y la hoja de cobranza `
      + `de ${diasCobrados.length === 1 ? 'ese día' : 'esos días'} dejará de contarlos.`
    : '';
  if (!confirm(`¿ELIMINAR del todo la nota ${numeroCorto(n.numero)}?${detalle}${conDespacho}${conCredito}${conCobros}\n\n`
    + 'No quedará constancia de que existió. Si lo que quieres es dejar registro, usa 🚫 Anular.')) return;

  const porElDinero = cobros.length
    ? ` Se van con ella ${soles(totalAbonado(c))} ya cobrados.` : '';
  const autorizado = await pedirPin(
    `Vas a ELIMINAR la nota ${numeroCorto(n.numero)}. No quedará rastro.${porElDinero}`, 'eliminar');
  if (!autorizado) { toast('🔒 Eliminación cancelada'); return; }

  try {
    await Promise.all(salidas.map(m => eliminarKardexDeStore(m.id)));
    if (d) await eliminarDespachoDeStore(d.id);
    if (c) await eliminarDeStore(c.id);
    // Si estaba anulada, su marca en Créditos también se va con ella
    if (anuladoDe(n.numero)) await eliminarAnuladoDeStore(String(n.numero));
    await eliminarNotaDeStore(notaId);
  } catch (e) {
    console.error(e);
    toast(avisoDeFallo(e, '❌ No se pudo eliminar la nota. Revisa tu conexión.'));
    return;
  }

  kardex = kardex.filter(m => m.notaId !== notaId);
  notas = notas.filter(x => x.id !== notaId);
  if (d) despachos = despachos.filter(x => x.id !== d.id);
  if (c) creditos = creditos.filter(x => x.id !== c.id);
  anulados = anulados.filter(a => numeroDeComprobante(a.boleta) !== numeroDeComprobante(n.numero));

  toast(`🗑️ Nota ${numeroCorto(n.numero)} eliminada`
    + (cobros.length ? ` con su crédito y ${cobros.length} cobro(s)` : ''));
  renderVentas();
  renderProductos();
  renderKardex();
  renderListaDespachos();
  render();
}

/* ══════════ Impresión: media hoja A4 (A5 apaisado) ══════════
   El papel y la vista previa salen del MISMO documento. Si fueran dos, con el
   tiempo acabarían diciendo cosas distintas y la vista previa dejaría de servir
   para lo único que sirve: comprobar antes de gastar papel.

   Lo único que cambia entre los dos:
     · el papel lleva DOS copias (negocio y cliente); la vista previa, una
       sola. Ver la misma nota dos veces no enseña nada nuevo: que salen dos
       copias se dice arriba, con palabras.
     · en pantalla se dibuja la hoja (fondo blanco, su tamaño exacto). */
function documentoDeNota(nota, autoImprimir, unaSolaCopia) {
  const emp = settings;
  // La columna del descuento por bonificación solo aparece si hay alguna: en
  // una nota normal sería una columna de guiones comiéndose el ancho.
  const hayBonif = (nota.items || []).some(it => it.bonificacion);
  const filas = (nota.items || []).map(it => `<tr>
      <td class="c-cod">${escapeHtml(it.codigo || '')}</td>
      <td class="c-cant">${it.cantidad}</td>
      <td class="c-um">${escapeHtml(it.um || '')}</td>
      <td class="c-desc">${escapeHtml(it.descripcion || '')}${it.bonificacion ? ' <b>(BONIF.)</b>' : ''}</td>
      <td class="c-pu">${soles(it.precio)}</td>
      ${hayBonif ? `<td class="c-bon">${it.dsctoBonif ? '-' + soles(it.dsctoBonif) : ''}</td>` : ''}
      <td class="c-imp">${soles(it.bonificacion ? 0 : it.importe)}</td>
    </tr>`).join('');

  // En el papel salen SIEMPRE dos copias iguales: una se queda en el negocio y
  // la otra se la lleva el cliente. Se arma el bloque una vez y se repite, para
  // que no puedan acabar diciendo cosas distintas. La primera lleva su propia
  // clase para el salto de página; si el salto colgara de ":first-child" y algo
  // se colara delante, las dos saldrían seguidas y la segunda a media hoja.
  const copia = bloqueDeNota(nota, emp, hayBonif, filas);
  const cuerpo = unaSolaCopia
    ? copia
    : bloqueDeNota(nota, emp, hayBonif, filas, 'copia-primera') + copia;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <title>Nota de venta ${escapeHtml(nota.numero)}</title>
  <style>
    /* Media hoja A4 usada en vertical: eso es un A5 de pie (148 × 210 mm).
       Estaba puesto en horizontal, así que salía la nota tumbada respecto al
       papel y había que girar la hoja para leerla. */
    @page { size: A5 portrait; margin: 6mm; }
    * { box-sizing: border-box; }
    /* La nota arranca pegada al borde de arriba. Sin esto el navegador reparte
       el sobrante y la deja flotando a media hoja. */
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; }
    /* Cabecera: dirección del negocio a la izquierda, el número en su recuadro */
    .cab { display: flex; align-items: flex-start; gap: 3mm; padding: 0 0 1.5mm; }
    .cab-emp { flex: 1; padding-top: .5mm; }
    .cab-emp .lin { font-size: 7pt; }
    .cab-num { border: 1px solid #000; text-align: center; padding: 1.2mm 2mm; min-width: 40mm; }
    .cab-num .tit { font-weight: bold; font-size: 9pt; letter-spacing: .2px; }
    .cab-num .num { font-weight: bold; font-size: 9pt; }
    /* Datos del cliente y del comprobante, en dos columnas dentro de un recuadro.
       Las etiquetas van justas: en 136mm de ancho, cada milímetro que se lleva
       la etiqueta se lo quita al nombre del cliente, que es largo y se partía
       en cuatro líneas. */
    .datos { display: flex; border: 1px solid #000; }
    .datos > div { padding: 1.2mm 1.5mm; }
    .datos .izq { flex: 1.3; border-right: 1px solid #000; min-width: 0; }
    .datos .der { flex: 1; min-width: 0; }
    .fila { display: flex; gap: 1.5mm; line-height: 1.45; }
    .fila .et { width: 16mm; flex: none; }
    .der .fila .et { width: 15mm; }
    /* Segunda etiqueta de la misma línea (F.Pago, Tlfno): pegada a su valor */
    .der .fila .et2 { width: auto; }
    .fila .va { font-weight: bold; }
    .der .fila .va { flex: none; }
    /* Cuadro de productos */
    table { width: 100%; border-collapse: collapse; margin-top: 1.5mm; table-layout: fixed; }
    /* Solo rayas de pie a cabeza: los productos van uno debajo de otro sin
       línea que los separe, como en el talonario. La raya de abajo la pone el
       último producto, para que el cuadro cierre. */
    th, td { border-left: 1px solid #000; border-right: 1px solid #000; padding: .7mm 1.2mm; font-size: 7.5pt; }
    th { font-weight: normal; text-align: left; border-top: 1px solid #000; border-bottom: 1px solid #000; }
    tbody tr:last-child td { border-bottom: 1px solid #000; }
    /* Las medidas suman 69mm de los 136mm imprimibles: los 67 que quedan son
       para la descripción, que es la que necesita el sitio. */
    .c-cod { width: 14mm; } .c-cant { width: 10mm; text-align: right; }
    .c-um { width: 10mm; } .c-pu { width: 16mm; text-align: right; }
    .c-bon { width: 17mm; text-align: right; }
    .c-imp { width: 19mm; text-align: right; }
    .c-desc { word-break: break-word; }
    /* Pie: importe en letras a la izquierda, totales a la derecha */
    .pie { display: flex; gap: 2mm; align-items: flex-start; }
    .letras { flex: 1; border: 1px solid #000; border-top: none; padding: 1mm 1.2mm; font-size: 7.5pt; min-width: 0; }
    .totales { width: 45mm; flex: none; }
    .tot-fila { display: flex; border: 1px solid #000; border-top: none; }
    .tot-fila .et { flex: 1; text-align: center; border-right: 1px solid #000; padding: .7mm; background: #eee; }
    .tot-fila .va { width: 20mm; text-align: right; padding: .7mm 1.2mm; font-weight: bold; }
    /* Salen dos copias iguales, una para el negocio y otra para el cliente.
       El salto va después de la PRIMERA, no después de cada una: si no, la
       segunda arrastraría una media hoja en blanco detrás. */
    .copia-primera { break-after: page; page-break-after: always; }

    /* ── Solo en pantalla ──
       En el papel la hoja YA es de 148 × 210 mm y el margen lo pone la
       impresora. En pantalla no hay hoja, así que se dibuja: la copia se
       recorta a ese tamaño exacto, con sus 6 mm de margen. Lo que se ve aquí
       es milímetro a milímetro lo que va a salir.
       Nada se desplaza AQUÍ DENTRO: quien mueve la hoja es el cuadro de la
       app, que la mide y la encaja. Si esto también se desplazara saldrían
       tres barras —dos de este documento y una del cuadro— para una sola
       hoja. */
    @media screen {
      html, body { overflow: hidden; background: #fff; }
      .copia { width: 148mm; min-height: 210mm; padding: 6mm; margin: 0; background: #fff; }
    }
  </style></head><body>${cuerpo}
  ${autoImprimir ? '<script>window.onload=function(){window.print();}<\/script>' : ''}
  </body></html>`;
  return html;
}

function imprimirNota(nota) {
  const w = window.open('', '_blank');
  if (!w) { toast('⚠️ Permite las ventanas emergentes para imprimir'); return; }
  w.document.write(documentoDeNota(nota, true, false));
  w.document.close();
}

/* ---- Ver la nota tal como se va a imprimir ----
   No imprime: enseña el papel en pantalla para poder revisarlo con calma —que
   no falte un producto, que el cliente y la dirección estén bien, que quepa en
   la hoja— antes de gastarlo. Va dentro de un marco aparte (un <iframe>) a
   propósito: así el documento de la nota se dibuja con SUS estilos de papel,
   sin que los de la app se le mezclen. Y como es el mismo documento que va a
   la impresora, lo que se ve es lo que sale.

   Se enseña UNA hoja. En el papel salen dos copias iguales —negocio y
   cliente—, pero repetir la misma nota en pantalla no deja ver nada nuevo: se
   dice con palabras arriba y se acabó. */
let notaEnVista = null;

function verNotaImpresa(nota) {
  if (!nota) return;
  notaEnVista = nota;
  $('#vista-nota-titulo').textContent = `Nota de venta ${numeroCorto(nota.numero)}`;
  $('#vista-nota-sub').textContent = [
    nota.clienteNombre || 'Sin cliente',
    formatoFecha(nota.fecha) + (nota.hora ? ` · ${nota.hora}` : ''),
    soles(nota.total),
  ].join(' · ');
  const marco = $('#vista-nota-marco');
  marco.addEventListener('load', ajustarVistaNota, { once: true });
  marco.srcdoc = documentoDeNota(nota, false, true);
  $('#modal-vista-nota').showModal();
}

/* La hoja mide lo que mide —148 mm de ancho— y una pantalla de teléfono no da
   para tanto. En vez de encoger la nota (que dejaría de ser fiel), se enseña
   entera y se reduce de tamaño lo justo para que quepa de ancho, como quien
   aleja el papel para verlo completo.

   Se mide LA HOJA, no el documento: el documento redondea hacia arriba y se
   quedaba un pelo más ancho que la hoja, lo justo para sacarle al marco su
   propia barra de desplazamiento —y con ella, la de abajo—. Tres barras para
   una sola hoja. Aquí se toma el ancho exacto de la hoja (con decimales) y se
   redondea hacia arriba una sola vez. */
function ajustarVistaNota() {
  const marco = $('#vista-nota-marco');
  const lienzo = $('#vista-nota-lienzo');
  const caja = $('#vista-nota-hojas');
  const doc = marco && marco.contentDocument;
  const hoja = doc && doc.querySelector('.copia');
  if (!hoja) return;
  const medida = hoja.getBoundingClientRect();
  const ancho = Math.ceil(medida.width);
  const alto = Math.ceil(medida.height);
  marco.style.width = ancho + 'px';
  marco.style.height = alto + 'px';

  // Dos pasadas, y hacen falta las dos: al colocar la hoja aparece la barra de
  // desplazamiento de largo, que se come unos 15 px de ancho del cuadro. Si se
  // midiera una sola vez, la hoja quedaría calculada con el ancho de ANTES de
  // que apareciera la barra y se le recortaría el borde derecho. Así que se
  // coloca, se vuelve a medir, y si el cuadro cambió de ancho se rehace.
  // (En los navegadores cuya barra flota por encima no cambia nada: la segunda
  // pasada mide lo mismo y no toca nada.)
  const colocar = () => {
    const disponible = Math.max(1, caja.clientWidth - 2);
    const escala = Math.min(1, disponible / ancho);
    marco.style.transform = `scale(${escala})`;
    lienzo.style.width = Math.floor(ancho * escala) + 'px';
    lienzo.style.height = Math.ceil(alto * escala) + 'px';
    return caja.clientWidth;
  };
  const antes = colocar();
  if (caja.clientWidth !== antes) colocar();
}
/* Una copia de la nota: es lo que va en cada media hoja. */
function bloqueDeNota(nota, emp, hayBonif, filas, extraClase = '') {
  return `
    <div class="copia${extraClase ? ' ' + extraClase : ''}">
    <div class="cab">
      <div class="cab-emp">
        <div class="lin">${escapeHtml(emp.empresaDireccion || '')}</div>
        ${emp.empresaRuc ? `<div class="lin">RUC: ${escapeHtml(emp.empresaRuc)}</div>` : ''}
      </div>
      <div class="cab-num">
        <div class="tit">NOTA DE VENTA</div>
        <div class="num">${escapeHtml(nota.numero)}</div>
      </div>
    </div>

    <div class="datos">
      <div class="izq">
        <div class="fila"><span class="et">Señor(es):</span><span class="va">${escapeHtml(nota.clienteNombre || '')}</span></div>
        <div class="fila"><span class="et">Dirección:</span><span class="va">${escapeHtml(nota.clienteDireccion || '')}</span></div>
        <div class="fila"><span class="et">RUC:</span><span class="va">${escapeHtml(nota.clienteRuc || '')}</span></div>
        <div class="fila"><span class="et">Código:</span><span class="va">${escapeHtml(nota.clienteCodigo || '')}</span></div>
        <div class="fila"><span class="et">Zona:</span><span class="va">${escapeHtml(nota.zona || '')}</span></div>
      </div>
      <div class="der">
        <div class="fila"><span class="et">F.Emisión:</span><span class="va">${formatoFecha(nota.fecha)}</span></div>
        <div class="fila"><span class="et">Condición:</span><span class="va">${nota.condicion === 'credito' ? 'CRÉDITO' : 'CONTADO'}</span>
          <span class="et et2">F.Pago:</span><span class="va">${nota.fechaPago ? formatoFecha(nota.fechaPago) : ''}</span></div>
        ${nota.referencia ? `<div class="fila"><span class="et">Ped:</span><span class="va">${escapeHtml(nota.referencia)}</span></div>` : ''}
        <div class="fila"><span class="et">Tlfno:</span><span class="va">${escapeHtml(nota.clienteTelefono || '')}</span></div>
        <div class="fila"><span class="et">Vendedor:</span><span class="va">${escapeHtml(mostrarComo(nota.emitidaPor).toUpperCase())}</span></div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c-cod">Código</th><th class="c-cant">Cant.</th><th class="c-um">U.M.</th>
        <th class="c-desc">Descripción</th><th class="c-pu">P.U.</th>
        ${hayBonif ? '<th class="c-bon">Dscto. bonif.</th>' : ''}<th class="c-imp">Importe</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>

    <div class="pie">
      <div class="letras">Son: ${escapeHtml(nota.enLetras || '')}</div>
      <div class="totales">
        <div class="tot-fila"><span class="et">Total Dscto</span><span class="va">${soles(nota.descuento)}</span></div>
        <div class="tot-fila"><span class="et">Total a Pagar</span><span class="va">${soles(nota.total)}</span></div>
      </div>
    </div>
    </div>`;
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
  llenarSelectoresProducto();
}

/* ====== Eventos ====== */
function inicializarEventos() {
  poblarSelectores();

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

  // Vencimiento automático: fecha de despacho + días configurados (si aún no
  // hay despacho, desde la emisión), salvo que el usuario lo haya escrito.
  $('#f-fecha').addEventListener('change', recalcularVencimiento);
  $('#f-fecha-despacho').addEventListener('change', recalcularVencimiento);
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
  $('#info-foto-camara').addEventListener('change', ev => manejarFotoDesdeFicha(ev.target));
  $('#info-foto-archivo').addEventListener('change', ev => manejarFotoDesdeFicha(ev.target));
  $('#btn-quitar-foto').addEventListener('click', () => {
    fotoActual = null;
    $('#foto-preview-wrap').hidden = true;
  });

  // Búsqueda y orden. La búsqueda espera a que se deje de escribir: redibujar
  // la lista entera en cada tecla es lo que hacía que se sintiera trabada.
  let esperaBusqueda = null;
  $('#search').addEventListener('input', () => {
    clearTimeout(esperaBusqueda);
    esperaBusqueda = setTimeout(renderDesdeArriba, 200);
  });
  $('#sort-by').addEventListener('change', renderDesdeArriba);

  // La siguiente tanda de créditos entra al llegar abajo (o tocando el botón)
  $('#btn-mas-filas').addEventListener('click', verMasFilas);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entradas => {
      if (entradas.some(e => e.isIntersecting)) verMasFilas();
    }, { rootMargin: '400px' }).observe($('#mas-filas'));
  }
  // Al pasar de tarjetas a tabla (o al girar la tablet) se dibuja la otra forma
  const alCambiarForma = () => renderListaCreditos();
  if (esVistaTarjetas.addEventListener) esVistaTarjetas.addEventListener('change', alCambiarForma);
  else esVistaTarjetas.addListener(alCambiarForma);

  // Panel de filtros (estado + zona + mes + rango de fechas, todos combinados)
  $('#btn-filtrar').addEventListener('click', ev => {
    ev.stopPropagation();
    $('#filtro-panel').hidden = !$('#filtro-panel').hidden;
  });
  $('#filtro-panel').addEventListener('click', ev => ev.stopPropagation());
  $('#filtro-panel').addEventListener('change', renderDesdeArriba);
  $('#btn-filtro-cerrar').addEventListener('click', () => { $('#filtro-panel').hidden = true; });
  $('#btn-filtro-limpiar').addEventListener('click', () => {
    document.querySelectorAll('.fil-estado, .fil-zona, .fil-mes').forEach(cb => { cb.checked = false; });
    $('#fil-desde').value = '';
    $('#fil-hasta').value = '';
    renderDesdeArriba();
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
      renderDesdeArriba();
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
    const editarAbono = ev.target.closest('[data-editar-abono]');
    const confirmarAbono = ev.target.closest('[data-confirmar-abono]');
    const cancelarAbono = ev.target.closest('[data-cancelar-abono]');
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
    } else if (editarAbono) {
      iniciarEdicionAbono(Number(editarAbono.dataset.editarAbono));
    } else if (confirmarAbono) {
      confirmarEdicionAbono(Number(confirmarAbono.dataset.confirmarAbono));
    } else if (cancelarAbono) {
      cancelarEdicionAbono();
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

  // ────────── Productos ──────────
  $('#btn-productos').addEventListener('click', abrirProductos);
  $('#nav-productos').addEventListener('click', abrirProductos);
  $('#btn-prod-nuevo').addEventListener('click', () => abrirFormProducto());
  $('#btn-prod-cancelar').addEventListener('click', () => $('#modal-producto').close());
  $('#prod-form').addEventListener('submit', guardarProductoForm);
  $('#prod-buscar').addEventListener('input', renderProductos);
  $('#prod-body').addEventListener('click', ev => {
    const editar = ev.target.closest('[data-editar-producto]');
    const borrar = ev.target.closest('[data-borrar-producto]');
    if (editar) editarProductoConClave(editar.dataset.editarProducto);
    else if (borrar) borrarProducto(borrar.dataset.borrarProducto);
  });

  // ────────── Ingreso de productos ──────────
  $('#btn-ingresos').addEventListener('click', () => abrirIngresos());
  $('#nav-ingresos').addEventListener('click', () => abrirIngresos());
  $('#ing-modo-factura').addEventListener('click', () => { ingModo = 'factura'; aplicarModoIngreso(); });
  $('#ing-modo-ajuste').addEventListener('click', () => { ingModo = 'ajuste'; aplicarModoIngreso(); });

  // Buscador de productos del ingreso por factura
  $('#ing-buscar').addEventListener('input', ev => {
    $('#ing-producto').value = '';
    ingComboIndice = -1;
    pintarSugerenciasProducto('#ing-sugerencias', 'data-ing-elegir', ev.target.value);
  });
  $('#ing-buscar').addEventListener('keydown', ev => {
    ingComboIndice = navegarSugerencias(ev, '#ing-sugerencias', 'data-ing-elegir',
      ingComboIndice, elegirProductoIngreso);
  });
  $('#ing-sugerencias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-ing-elegir]');
    if (b) { elegirProductoIngreso(b.dataset.ingElegir); $('#ing-cantidad').focus(); }
  });
  // La cabecera del comprobante se va llenando conforme se escribe
  ['#ing-proveedor', '#ing-doc-tipo', '#ing-doc-numero', '#ing-fecha'].forEach(sel => {
    $(sel).addEventListener('input', actualizarCabeceraIngreso);
  });
  $('#btn-ing-agregar').addEventListener('click', agregarALista);
  $('#ing-cantidad').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); agregarALista(); }
  });
  $('#ing-lista-body').addEventListener('input', ev => {
    const cant = ev.target.closest('[data-ing-cant]');
    if (!cant) return;
    const l = ingLista[Number(cant.dataset.ingCant)];
    if (l) { l.cantidad = Number(cant.value) || 0; renderListaIngreso(); }
  });
  $('#ing-lista-body').addEventListener('click', ev => {
    const quitar = ev.target.closest('[data-ing-quitar]');
    if (quitar) { ingLista.splice(Number(quitar.dataset.ingQuitar), 1); renderListaIngreso(); }
  });
  $('#btn-ing-limpiar').addEventListener('click', () => {
    if (ingLista.length && !confirm('¿Vaciar la lista de productos?')) return;
    resetIngresoFactura();
  });
  $('#btn-ing-guardar').addEventListener('click', guardarIngresoFactura);
  $('#btn-ing-cancelar-edicion').addEventListener('click', cancelarEdicionIngreso);
  $('#ing-historial').addEventListener('click', ev => {
    const editar = ev.target.closest('[data-editar-lote]');
    if (editar) { editarLoteIngreso(editar.dataset.editarLote); return; }
    const borrar = ev.target.closest('[data-borrar-lote]');
    if (borrar) borrarLoteIngreso(borrar.dataset.borrarLote);
  });

  // Buscador y formulario del ajuste / salida
  $('#aj-buscar').addEventListener('input', ev => {
    $('#aj-producto').value = '';
    ajComboIndice = -1;
    $('#aj-preview').hidden = true;
    pintarSugerenciasProducto('#aj-sugerencias', 'data-aj-elegir', ev.target.value);
  });
  $('#aj-buscar').addEventListener('keydown', ev => {
    ajComboIndice = navegarSugerencias(ev, '#aj-sugerencias', 'data-aj-elegir',
      ajComboIndice, elegirProductoAjuste);
  });
  $('#aj-sugerencias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-aj-elegir]');
    if (b) { elegirProductoAjuste(b.dataset.ajElegir); $('#aj-cantidad').focus(); }
  });
  $('#ing-form-ajuste').addEventListener('submit', guardarAjusteForm);
  $('#aj-cantidad').addEventListener('input', actualizarPreviewAjuste);
  $('#aj-tipo').addEventListener('change', () => {
    const tipo = $('#aj-tipo').value;
    $('#aj-ayuda-ajuste').hidden = tipo !== 'ajuste';
    llenarMotivos(tipo);
    actualizarPreviewAjuste();
  });
  // Al hacer clic fuera, los desplegables de sugerencias se cierran
  document.addEventListener('click', ev => {
    if (!ev.target.closest('#ing-buscar') && !ev.target.closest('#ing-sugerencias')) {
      cerrarSugerenciasProducto('#ing-sugerencias');
    }
    if (!ev.target.closest('#aj-buscar') && !ev.target.closest('#aj-sugerencias')) {
      cerrarSugerenciasProducto('#aj-sugerencias');
    }
    if (!ev.target.closest('#nv-buscar-producto') && !ev.target.closest('#nv-prod-sugerencias')) {
      cerrarSugerenciasProducto('#nv-prod-sugerencias');
    }
  });

  // ────────── Kardex ──────────
  $('#btn-kardex').addEventListener('click', abrirKardex);
  $('#nav-kardex').addEventListener('click', abrirKardex);
  $('#btn-kardex-imprimir').addEventListener('click', imprimirKardex);
  const CAMPOS_KDX = [['#kdx-fil-producto', 'producto'], ['#kdx-fil-tipo', 'tipo'],
    ['#kdx-fil-motivo', 'motivo'], ['#kdx-fil-usuario', 'usuario'],
    ['#kdx-fil-desde', 'desde'], ['#kdx-fil-hasta', 'hasta'], ['#kdx-fil-texto', 'texto']];
  for (const [id, campo] of CAMPOS_KDX) {
    // El buscador de texto responde mientras se escribe; los demás, al cambiar
    const evento = id === '#kdx-fil-texto' ? 'input' : 'change';
    $(id).addEventListener(evento, () => { kdxFiltros[campo] = $(id).value; renderKardex(); });
  }
  $('#btn-kdx-limpiar').addEventListener('click', () => {
    kdxFiltros = { producto: '', tipo: '', motivo: '', usuario: '', texto: '', desde: '', hasta: '' };
    CAMPOS_KDX.forEach(([id]) => { $(id).value = ''; });
    renderKardex();
  });
  // Atajo: del día 1 de este mes hasta hoy, que es el corte que más se mira
  $('#btn-kdx-mes').addEventListener('click', () => {
    const hoy = hoyISO();
    kdxFiltros.desde = hoy.slice(0, 8) + '01';
    kdxFiltros.hasta = hoy;
    $('#kdx-fil-desde').value = kdxFiltros.desde;
    $('#kdx-fil-hasta').value = kdxFiltros.hasta;
    renderKardex();
  });
  // Las tres formas de mirar el kardex
  const BOTONES_VISTA_KDX = ['#btn-kdx-vista-mov', '#btn-kdx-vista-dias', '#btn-kdx-vista-saldo'];
  for (const [id, vista] of [['#btn-kdx-vista-mov', 'movimientos'], ['#btn-kdx-vista-dias', 'dias'],
    ['#btn-kdx-vista-saldo', 'saldo']]) {
    $(id).addEventListener('click', () => {
      kdxVista = vista;
      BOTONES_VISTA_KDX.forEach(sel => {
        const activo = sel === id;
        $(sel).classList.toggle('activo', activo);
        $(sel).setAttribute('aria-selected', String(activo));
      });
      renderKardex();
    });
  }
  $('#kdx-body').addEventListener('click', ev => {
    const borrar = ev.target.closest('[data-borrar-kardex]');
    if (borrar) borrarMovimiento(borrar.dataset.borrarKardex);
  });

  // ── Saldo a una fecha ──
  $('#kdx-saldo-fecha').addEventListener('change', () => {
    kdxSaldoFecha = $('#kdx-saldo-fecha').value || hoyISO();
    renderKardex();
  });
  $('#kdx-saldo-todos').addEventListener('change', () => {
    kdxSaldoTodos = $('#kdx-saldo-todos').checked;
    renderKardex();
  });
  $('#kdx-saldo-buscar').addEventListener('input', renderSaldoProductosLista);
  $('#kdx-saldo-lista').addEventListener('change', ev => {
    const casilla = ev.target.closest('.kdx-saldo-check');
    if (!casilla) return;
    if (casilla.checked) kdxSaldoSeleccion.add(casilla.value);
    else kdxSaldoSeleccion.delete(casilla.value);
    renderKardex();
  });

  // ────────── Notas de venta ──────────
  $('#btn-ventas').addEventListener('click', abrirVentas);
  $('#nav-ventas').addEventListener('click', abrirVentas);
  $('#btn-nv-nueva').addEventListener('click', () => abrirNuevaNota());
  $('#nv-buscar').addEventListener('input', renderVentas);
  $('#btn-nv-volver').addEventListener('click', () => { mostrarVistaVenta('lista'); renderVentas(); });
  $('#btn-nv-anterior').addEventListener('click', () => irANotaAdyacente(-1));
  $('#btn-nv-siguiente').addEventListener('click', () => irANotaAdyacente(1));
  $('#btn-nv-cancelar').addEventListener('click', () => {
    if (nvItems.length && !confirm('¿Descartar esta nota de venta?')) return;
    nvEditandoId = ''; nvItems = []; nvClienteId = '';
    mostrarVistaVenta('lista'); renderVentas();
  });
  $('#nv-body').addEventListener('click', ev => {
    const editar = ev.target.closest('[data-editar-nota]');
    const imprimir = ev.target.closest('[data-imprimir-nota]');
    const ver = ev.target.closest('[data-ver-nota]');
    const seguir = ev.target.closest('[data-seguir-nota]');
    const anular = ev.target.closest('[data-anular-nota]');
    const eliminar = ev.target.closest('[data-eliminar-nota]');
    if (editar) { abrirNotaParaEditar(editar.dataset.editarNota); return; }
    if (seguir) { seguirNota(seguir.dataset.seguirNota); return; }
    if (anular) { anularNota(anular.dataset.anularNota); return; }
    if (eliminar) { eliminarNota(eliminar.dataset.eliminarNota); return; }
    if (ver) { verNotaImpresa(notas.find(x => x.id === ver.dataset.verNota)); return; }
    if (imprimir) {
      const n = notas.find(x => x.id === imprimir.dataset.imprimirNota);
      if (n) imprimirNota(n);
    }
  });

  // Vista previa de la nota: cerrar, imprimir desde ahí y volver a encajarla
  // si la ventana cambia de tamaño (girar el teléfono, por ejemplo)
  $('#btn-vista-cerrar').addEventListener('click', () => $('#modal-vista-nota').close());
  $('#btn-vista-imprimir').addEventListener('click', () => {
    if (notaEnVista) imprimirNota(notaEnVista);
  });
  window.addEventListener('resize', () => {
    if ($('#modal-vista-nota').open) ajustarVistaNota();
  });

  // Buscador de cliente de la nota
  $('#nv-cliente-buscar').addEventListener('input', ev => {
    $('#nv-cliente-id').value = '';
    nvRenderSugerencias(ev.target.value);
  });
  $('#nv-cliente-buscar').addEventListener('keydown', ev => {
    const items = Array.from($('#nv-cliente-sugerencias').querySelectorAll('[data-nv-cliente]'));
    if (!items.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      nvComboIndice = (nvComboIndice + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('activo', i === nvComboIndice));
    } else if (ev.key === 'Enter' && nvComboIndice >= 0) {
      ev.preventDefault();
      nvSeleccionarCliente(items[nvComboIndice].dataset.nvCliente);
    } else if (ev.key === 'Escape') {
      nvCerrarSugerencias();
    }
  });
  $('#nv-cliente-sugerencias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-nv-cliente]');
    if (b) nvSeleccionarCliente(b.dataset.nvCliente);
  });
  document.addEventListener('click', ev => {
    if (!ev.target.closest('.nv-cli-buscar')) nvCerrarSugerencias();
  });
  $('#btn-nv-cliente-nuevo').addEventListener('click', abrirModalClienteForm);

  // Productos de la nota: se escribe el nombre y salen las coincidencias
  $('#nv-buscar-producto').addEventListener('input', ev => {
    $('#nv-producto').value = '';
    nvProdIndice = -1;
    pintarSugerenciasProducto('#nv-prod-sugerencias', 'data-nv-prod', ev.target.value, true);
  });
  $('#nv-buscar-producto').addEventListener('keydown', ev => {
    nvProdIndice = navegarSugerencias(ev, '#nv-prod-sugerencias', 'data-nv-prod',
      nvProdIndice, id => { elegirProductoNota(id); $('#nv-cantidad').focus(); });
  });
  // Al volver al campo con algo escrito se vuelven a ofrecer las coincidencias
  $('#nv-buscar-producto').addEventListener('focus', ev => {
    if (!$('#nv-producto').value && ev.target.value) {
      pintarSugerenciasProducto('#nv-prod-sugerencias', 'data-nv-prod', ev.target.value, true);
    }
  });
  $('#nv-prod-sugerencias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-nv-prod]');
    if (b) { elegirProductoNota(b.dataset.nvProd); $('#nv-cantidad').focus(); }
  });
  $('#btn-nv-agregar').addEventListener('click', agregarItemNota);
  $('#nv-cantidad').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); agregarItemNota(); }
  });
  $('#nv-permitir-precios').addEventListener('change', ev => {
    if (ev.target.checked && !puede('preciosEditar')) {
      ev.target.checked = false;
      toast('🔒 No tienes permiso para modificar precios');
      return;
    }
    if (!ev.target.checked) {
      // Al volver a bloquear los precios se restauran los de la lista, para que
      // no quede una nota con un precio suelto que nadie recuerda haber puesto
      for (const it of nvItems) it.precioEditado = false;
      reponerPreciosDeLista();
    }
    renderNotaItems();
  });
  $('#nv-items-body').addEventListener('input', ev => {
    const cant = ev.target.closest('[data-nv-cant]');
    const precio = ev.target.closest('[data-nv-precio]');
    if (cant) {
      const it = nvItems[Number(cant.dataset.nvCant)];
      // Sin decimales: no se vende medio saco. Se recorta al entero de abajo
      // en vez de rechazarlo, para no pelearse con quien está escribiendo.
      if (it) { it.cantidad = Math.max(0, Math.floor(Number(cant.value) || 0)); renderNotaItems(); }
    } else if (precio) {
      const it = nvItems[Number(precio.dataset.nvPrecio)];
      if (!it) return;
      const nuevo = Number(precio.value) || 0;
      const p = productoPorId(it.productoId);
      it.precio = nuevo;
      it.precioEditado = !!p && nuevo !== precioDe(p, categoriaActual());
      // Se recalcula solo el total: redibujar entero quitaría el foco del campo
      recalcularTotalesNota();
      const fila = precio.closest('tr');
      if (!fila) return;
      const { importe, dsctoBonif, neto } = cuentaDeLinea(it);
      fila.querySelector('.nv-importe').textContent = soles(importe);
      fila.querySelector('.nv-dscto').textContent = dsctoBonif ? '−' + soles(dsctoBonif) : '—';
      fila.querySelector('.nv-neto').innerHTML = `<strong>${soles(neto)}</strong>`;
      // El aviso de "precio modificado a mano" también se pone aquí, por lo mismo
      const desc = fila.querySelector('td:nth-child(3)');
      let aviso = desc.querySelector('.nv-precio-tocado');
      if (it.precioEditado && !aviso) {
        aviso = document.createElement('small');
        aviso.className = 'nv-precio-tocado';
        aviso.textContent = 'precio modificado a mano';
        desc.appendChild(aviso);
      } else if (!it.precioEditado && aviso) {
        aviso.remove();
      }
    }
  });
  $('#nv-items-body').addEventListener('click', ev => {
    const quitar = ev.target.closest('[data-nv-quitar]');
    if (quitar) { nvItems.splice(Number(quitar.dataset.nvQuitar), 1); renderNotaItems(); return; }
    const bonif = ev.target.closest('[data-nv-bonif]');
    if (bonif) {
      const it = nvItems[Number(bonif.dataset.nvBonif)];
      if (it) { it.bonificacion = !it.bonificacion; renderNotaItems(); }
    }
  });
  $('#nv-descuento').addEventListener('input', recalcularTotalesNota);
  // La serie se propone según la zona, pero manda lo que elija el usuario
  $('#nv-serie').addEventListener('change', () => {
    nvPonerNumero(nvSerieElegida(), nvCorrelativoEscrito());
    $('#nv-serie-pista').textContent = 'Serie elegida a mano';
  });
  $('#nv-correlativo').addEventListener('input', () => {
    nvNumero = armarNumeroNota(nvSerieElegida(), nvCorrelativoEscrito());
    nvAvisarNumero();
  });
  $('#nv-condicion').addEventListener('change', nvProponerFechaPago);
  $('#btn-nv-guardar').addEventListener('click', () => guardarNota(false));
  $('#btn-nv-guardar-imprimir').addEventListener('click', () => guardarNota(true));

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
  $('#btn-hoja-reabrir').addEventListener('click', () => reabrirHojaCobranza($('#cob-fecha').value || hoyISO()));

  // ====== Despachos ======
  $('#btn-despachos').addEventListener('click', abrirDespachos);
  $('#btn-desp-cerrar').addEventListener('click', () => mostrarSeccion('creditos'));
  $('#btn-desp-repartidores').addEventListener('click', abrirRepartidores);
  $('#desp-form').addEventListener('submit', guardarDespachoForm);
  $('#btn-desp-editar').addEventListener('click', () => {
    const d = despachoPorId(despachoActivoId);
    if (d) abrirFormDespacho(d);
  });
  // Marcar pedidos para devolverlos a "Por despachar"
  $('#btn-desp-seleccionar').addEventListener('click',
    () => ponerModoSeleccionDespachos(!modoSeleccionDespachos));
  $('#btn-desp-devolver').addEventListener('click',
    () => devolverDespachosAPendiente([...despachosElegidos]));
  $('#desp-tabla-body').addEventListener('change', ev => {
    const cb = ev.target.closest('[data-elegir-despacho]');
    if (!cb) return;
    const id = cb.dataset.elegirDespacho;
    if (cb.checked) despachosElegidos.add(id); else despachosElegidos.delete(id);
    cb.closest('tr').classList.toggle('elegida', cb.checked);
    actualizarBotonDevolver();
  });
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
    if (fila) { abrirDetalleDespacho(fila.dataset.abrirDespacho); return; }
    // Panel de la izquierda: marcar notas y desplegar las viejas
    if (ev.target.closest('#btn-desp-notas-viejas')) {
      verNotasViejas = !verNotasViejas;
      renderNotasPorDespachar();
    }
  });
  $('#desp-notas-lista').addEventListener('change', ev => {
    const casilla = ev.target.closest('[data-elegir-nota]');
    if (!casilla) return;
    if (casilla.checked) notasElegidas.add(casilla.dataset.elegirNota);
    else notasElegidas.delete(casilla.dataset.elegirNota);
    const fila = casilla.closest('.desp-nota');
    if (fila) fila.classList.toggle('elegida', casilla.checked);
    actualizarBotonPasar();
  });
  $('#btn-desp-pasar').addEventListener('click', () => mandarNotasAReparto([...notasElegidas]));

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
    if (ev.target.closest('#btn-desp-devuelto-anular')) { devolverYAnular(); return; }
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
  $('#nav-despachos').addEventListener('click', abrirDespachos);
  $('#nav-clientes').addEventListener('click', abrirClientes);
  $('#nav-cobranza').addEventListener('click', () => { if (puede('cobranza')) abrirCobranza(); });
  $('#nav-usuarios').addEventListener('click', () => { if (esAdmin()) abrirUsuarios(); });
  $('#nav-settings').addEventListener('click', () => $('#btn-settings').click());

  arrancarReloj();
  vigilarIconos();   // los emojis pasan a ser iconos en color, iguales en todo equipo

  // Contraer / desplegar el panel lateral
  // Contraído de fábrica: el panel es un rail de iconos que se abre solo al
  // acercar el cursor, y así la pantalla de trabajo empieza siendo lo ancha
  // que puede ser. Quien prefiera tenerlo fijo lo despliega y se recuerda.
  aplicarPlegadoNav(localStorage.getItem(CLAVE_NAV_PLEGADA) !== '0');
  // Mismo motivo que en los destinos: si el botón se queda con el foco, el
  // panel recién contraído no se vuelve a recoger al retirar el cursor.
  $('#btn-plegar-nav').addEventListener('click', ev => {
    alternarNav();
    if (ev.detail > 0) ev.currentTarget.blur();
  });
  $('#btn-menu').addEventListener('click', alternarMenu);

  // El cajón del teléfono se cierra al elegir un apartado, al tocar fuera,
  // con la ✕ o con Escape. Se escucha en el panel entero en vez de en cada
  // destino: así los que se añadan luego quedan cubiertos solos.
  abrirCajonNav(false);
  medirCabecera();
  // La barra cambia de alto sola (al entrar aparece la cuenta, en Créditos
  // aparece "＋ Nuevo crédito"), así que se vigila en vez de medirla a mano
  // desde cada sitio que la toca.
  if (window.ResizeObserver) new ResizeObserver(medirCabecera).observe(document.querySelector('.app-header'));
  else window.addEventListener('resize', medirCabecera);
  // El formulario de la nota se reajusta con la ventana y con el aviso de arriba
  window.addEventListener('resize', nvAjustarAlto);
  $('#nav-velo').addEventListener('click', cerrarCajonNav);
  $('#btn-nav-cerrar').addEventListener('click', cerrarCajonNav);
  $('#nav-lateral').addEventListener('click', ev => {
    const destino = ev.target.closest('.nav-item');
    if (!destino) return;
    cerrarCajonNav();
    // Contraído, el panel se abre al acercar el cursor Y con el tabulador
    // (:focus-within). Al elegir un apartado CON EL RATÓN el botón se quedaba
    // con el foco puesto, así que el panel seguía desplegado aunque el cursor
    // ya estuviera en medio de la pantalla, y solo se recogía al hacer clic en
    // otro sitio. Con el ratón se suelta el foco en cuanto se elige: el panel
    // se recoge solo al retirar el cursor, que es lo que se espera.
    // ev.detail es 0 cuando el clic vino del teclado (Enter o barra sobre el
    // botón); ahí el foco NO se suelta, porque es lo que guía a quien navega
    // con el tabulador y sin él se perdería el sitio.
    if (ev.detail > 0) destino.blur();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') cerrarCajonNav();
  });
  // Si se gira el teléfono o se agranda la ventana hasta el tamaño de PC, el
  // cajón deja de tener sentido: el panel vuelve a estar siempre a la vista.
  window.matchMedia('(max-width: 999px)').addEventListener('change', ev => {
    if (!ev.matches) cerrarCajonNav();
  });

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
    $('#s-emp-direccion').value = settings.empresaDireccion || '';
    $('#s-emp-ruc').value = settings.empresaRuc || '';
    const soloAdmin = modoNube && !esAdmin();
    ['s-dias', 's-moneda', 's-atajo1', 's-atajo2', 's-emp-direccion', 's-emp-ruc',
    ].forEach(id => { $('#' + id).disabled = soloAdmin; });
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
    // Cabecera de la nota de venta impresa
    settings.empresaDireccion = $('#s-emp-direccion').value.trim();
    settings.empresaRuc = $('#s-emp-ruc').value.trim();
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
  // El administrador puede poner el cobro en otro día, pero no en uno cuya
  // hoja ya está cerrada: se le avisa al momento (no hay que esperar a firmar
  // para enterarse) y se le devuelve a hoy. Si hoy TAMBIÉN está cerrada, se le
  // ofrece reabrirla ahí mismo —con su código, como cualquier reapertura—
  // para no mandarlo a buscar el botón en otra pantalla.
  $('#cobro-fecha').addEventListener('change', async () => {
    const hoy = hoyISO();
    const elegida = $('#cobro-fecha').value;
    if (elegida && elegida !== hoy && hojaCerrada(elegida)) {
      alert(`La hoja de cobranza del ${formatoFecha(elegida)} ya está cerrada.\n\n`
        + 'Se pondrá la fecha de hoy.');
      $('#cobro-fecha').value = hoy;
      if (hojaCerrada(hoy)) await reabrirHojaCobranza(hoy);
      renderInfo();
    }
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
  $('#btn-alias-crear').addEventListener('click', crearMiUsuarioDeAcceso);

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
  $('#u-admin').addEventListener('change', () => sincronizarPermisosDelAlta());
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
  // Modo local confirmado: un solo dueño, sin restricciones que esperar.
  accesoResuelto = true;
  try {
    creditos = await DB.getAll();
    clientes = await DB.getAllClientes();
    despachos = await DB.getAllDespachos();
    repartidores = await DB.getAllRepartidores();
    anulados = await DB.getAllAnulados();
    productos = await DB.getAllProductos();
    kardex = await DB.getAllKardex();
    notas = await DB.getAllNotas();
    ordenarClientes();
    ordenarProductos();
  } catch (e) {
    toast('❌ No se pudo abrir la base de datos local');
    creditos = [];
    clientes = [];
    despachos = [];
    repartidores = [];
    anulados = [];
    productos = [];
    kardex = [];
    notas = [];
  }
  cargarSeguridad();
  llenarSelectClientes();
  renderClientes();
  llenarSelectoresProducto();
  await cargarMiniaturas();
  render();
  // Recién ahora se sabe que es local (sin restricciones): se corrige el
  // destino de entrada, que al arrancar había aterrizado en Créditos por no
  // saberlo todavía (ver puedeVerSeccion).
  mostrarSeccion(seccionDeInicio());
  avisoAlAbrir();
  // Las que falten se van haciendo en segundo plano, sin frenar la app
  prepararMiniaturas();
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
