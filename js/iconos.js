/* ═══════════ Iconos en color, iguales en todos los equipos ═══════════
   Los emojis los dibuja cada sistema a su manera: el mismo 🧾 se ve de una
   forma en Windows, de otra en Android y de otra en el iPhone, y algunos ni
   se ven. Aquí se cambian por los iconos de Fluent Emoji (Microsoft), estilo
   Color —los mismos que trae Windows—, que viajan con la app.

   No hace falta tocar ni una de las pantallas: se recorre el texto ya escrito
   y cada emoji se sustituye por su imagen. Lo que nunca llega al HTML —los
   avisos del navegador, lo que se imprime, lo que se exporta a Excel— se
   queda con el emoji de siempre, que es lo correcto ahí.

   Los dibujos son de github.com/microsoft/fluentui-emoji (licencia MIT). */

const ICONOS = {
  '🧑‍🤝‍🧑': '1f465',
  '⚠️': '26a0',
  '🗑️': '1f5d1',
  '✏️': '270f',
  '✍️': '270d',
  '⚙️': '2699',
  '🖊️': '1f58a',
  '🖨️': '1f5a8',
  '⬇️': '2b07',
  '↩️': '21a9',
  '⚖️': '2696',
  '⬆️': '2b06',
  '👁️': '1f441',
  '🖼️': '1f5bc',
  '☁️': '2601',
  '🗓️': '1f5d3',
  'ℹ️': '2139',
  '🔒': '1f512',
  '✅': '2705',
  '❌': '274c',
  '➕': '2795',
  '📥': '1f4e5',
  '💵': '1f4b5',
  '📴': '1f4f4',
  '📱': '1f4f1',
  '💾': '1f4be',
  '🧾': '1f9fe',
  '🕐': '1f550',
  '🏦': '1f3e6',
  '🧍': '1f9cd',
  '📋': '1f4cb',
  '📄': '1f4c4',
  '🧮': '1f9ee',
  '🛒': '1f6d2',
  '📦': '1f4e6',
  '🔄': '1f504',
  '⏳': '23f3',
  '🚫': '1f6ab',
  '🔍': '1f50d',
  '📤': '1f4e4',
  '📝': '1f4dd',
  '📍': '1f4cd',
  '📒': '1f4d2',
  '👤': '1f464',
  '🪙': '1fa99',
  '💰': '1f4b0',
  '🔔': '1f514',
  '⛳': '26f3',
  '🏠': '1f3e0',
  '📞': '1f4de',
  '📅': '1f4c5',
  '📊': '1f4ca',
  '👥': '1f465',
  '📷': '1f4f7',
  '🔓': '1f513',
  '➖': '2796',
  '🔑': '1f511',
  '🚪': '1f6aa',
  '🚚': '1f69a',
  '👌': '1f44c',
  '🤝': '1f91d',
  '🔗': '1f517',
  '💡': '1f4a1',
  '🔽': '1f53d',
  '🆕': '1f195',
  '🧹': '1f9f9',
  '🔢': '1f522',
  '💳': '1f4b3',
  '⏰': '23f0',
  '👑': '1f451',
  '🆔': '1f194',
  '📈': '1f4c8',
  '🎉': '1f389',
  '🟢': '1f7e2',
};

/* El juego viene en dos versiones: el dibujo suelto y el mismo dibujo dentro
   de un recuadro redondeado de color. Casi toda la app usa el suelto, porque
   sus iconos van pegados al texto y a esa altura el recuadro se come el
   dibujo. El recuadro se reserva para donde el icono va solo, en grande y
   haciendo de símbolo de una tarjeta: ahí sí luce.

   Las tarjetas del Dashboard NO están aquí a propósito: ya se dibujan su
   propio recuadro en CSS, teñido del color de cada indicador (rojo para los
   vencidos, verde para lo cobrado). Meterles el recuadro del icono pondría
   un recuadro dentro de otro y, peor, traería un segundo color que se pelea
   con el de la tarjeta. */
const CON_RECUADRO = '.ing-modo-ico';

/* Dentro de estas etiquetas una imagen no pinta nada (o rompe): las listas
   desplegables solo admiten texto, y los campos escribibles no se tocan. */
const SIN_ICONOS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT',
  'OPTION', 'OPTGROUP', 'CODE', 'PRE', 'CANVAS', 'TITLE']);

/* Se ordenan de más largo a más corto para que una secuencia de varios
   símbolos (👨‍👩‍👦) gane a cada símbolo suelto. */
function escapar(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* Algunos emojis se escriben con el "selector de color" (️) y otros sin él:
   se aceptan las dos formas y llevan al mismo dibujo. */
for (const clave of Object.keys(ICONOS)) {
  const pelado = clave.replace(/\uFE0F/g, '');
  if (pelado && pelado !== clave && !ICONOS[pelado]) ICONOS[pelado] = ICONOS[clave];
}
const CLAVES = Object.keys(ICONOS).sort((a, b) => b.length - a.length);
const PATRON = new RegExp('(' + CLAVES.map(escapar).join('|') + ')\uFE0F?', 'g');

function imagenDe(emoji, padre) {
  const conRecuadro = !!(padre && padre.closest(CON_RECUADRO));
  const img = document.createElement('img');
  img.className = conRecuadro ? 'emo emo-chip' : 'emo';
  img.src = `icons/emoji/${conRecuadro ? 'chip/' : ''}${ICONOS[emoji]}.svg`;
  img.alt = emoji;          // el lector de pantalla sigue diciendo lo mismo
  img.draggable = false;
  return img;
}

/* Cambia los emojis por sus iconos dentro de un trozo de la página */
export function iconizar(raiz) {
  const base = raiz || document.body;
  if (!base || !base.nodeType) return;
  const pendientes = [];
  const paseo = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
    acceptNode(nodo) {
      const padre = nodo.parentElement;
      if (!padre || SIN_ICONOS.has(padre.tagName)) return NodeFilter.FILTER_REJECT;
      PATRON.lastIndex = 0;
      if (!PATRON.test(nodo.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (padre.closest('[data-sin-iconos]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (paseo.nextNode()) pendientes.push(paseo.currentNode);

  for (const nodo of pendientes) {
    const padre = nodo.parentElement;
    const trozos = document.createDocumentFragment();
    let desde = 0;
    PATRON.lastIndex = 0;
    let m;
    while ((m = PATRON.exec(nodo.nodeValue)) !== null) {
      if (m.index > desde) trozos.appendChild(document.createTextNode(nodo.nodeValue.slice(desde, m.index)));
      trozos.appendChild(imagenDe(m[1], padre));
      desde = m.index + m[0].length;
    }
    if (desde < nodo.nodeValue.length) trozos.appendChild(document.createTextNode(nodo.nodeValue.slice(desde)));
    nodo.parentNode.replaceChild(trozos, nodo);
  }
}

/* Las pantallas se vuelven a dibujar todo el rato (cada cobro, cada filtro),
   así que en vez de acordarse de llamar a la mano en cada sitio, se vigila la
   página y se repasa lo que va apareciendo. */
let repasoPedido = false;
export function vigilarIconos() {
  const observador = new MutationObserver(() => {
    if (repasoPedido) return;
    repasoPedido = true;
    requestAnimationFrame(() => {
      repasoPedido = false;
      repasar();
    });
  });
  function repasar() {
    iconizar(document.body);
    // Los cambios que acaba de hacer esta función se descartan: si no, se
    // estaría repasando la página a sí misma una y otra vez.
    observador.takeRecords();
  }
  repasar();
  observador.observe(document.body, { childList: true, subtree: true, characterData: true });
}
