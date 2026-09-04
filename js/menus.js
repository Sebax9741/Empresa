/* ══════════ Menús desplegables al estilo de Claude ══════════
   La lista que abre un <select> por su cuenta la dibuja el sistema operativo:
   sale azul, cuadrada, con otra letra, y distinta en cada computadora. No hay
   CSS que la toque. Así que aquí se cambia por un menú propio —el mismo
   recuadro blanco, esquinas redondeadas y sombra suave que ya usa el chip del
   usuario— para que toda la aplicación abra la misma clase de menú.

   El <select> de verdad NO se quita: se queda en la página, invisible, encima
   de su sitio, y sigue siendo él quien guarda el valor. Por eso el resto del
   programa —que lee .value y escucha "change"— no se entera del cambio, y las
   validaciones de formulario ("este campo es obligatorio") siguen saliendo
   donde corresponde, porque el campo sigue estando ahí para el navegador. */
(() => {
  'use strict';

  const FLECHA = '<svg class="sel-flecha" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const VISTO = '<svg class="menu-visto" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let abierto = null;         // { sel, cara, menu, items, indice }
  let contador = 0;

  /* ── Abrir, moverse y elegir ─────────────────────────────────────────── */

  function colocar() {
    if (!abierto) return;
    const { cara, menu } = abierto;
    const c = cara.getBoundingClientRect();
    const alto = menu.offsetHeight;
    const cabeAbajo = c.bottom + alto + 8 <= window.innerHeight;
    menu.style.minWidth = Math.max(c.width, 170) + 'px';
    menu.style.left = Math.max(8, Math.min(c.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (cabeAbajo ? c.bottom + 6 : Math.max(8, c.top - alto - 6)) + 'px';
  }

  function cerrar(devolverFoco) {
    if (!abierto) return;
    const { cara, menu } = abierto;
    menu.remove();
    cara.setAttribute('aria-expanded', 'false');
    abierto = null;
    if (devolverFoco) cara.focus();
  }

  function marcar(i) {
    if (!abierto) return;
    const { items } = abierto;
    if (!items.length) return;
    i = (i + items.length) % items.length;
    items.forEach(b => b.classList.remove('activo'));
    items[i].classList.add('activo');
    items[i].scrollIntoView({ block: 'nearest' });
    abierto.indice = i;
  }

  function elegir(opcion) {
    const { sel } = abierto;
    cerrar(true);
    if (sel.value === opcion.value && sel.selectedIndex === opcion.index) return;
    sel.value = opcion.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function abrir(sel, cara) {
    if (abierto && abierto.sel === sel) { cerrar(true); return; }
    cerrar(false);
    if (sel.disabled) return;

    const menu = document.createElement('div');
    menu.className = 'menu sel-menu';
    menu.setAttribute('role', 'listbox');
    const items = [];

    const ponerOpcion = o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (o.selected ? ' elegido' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', o.selected ? 'true' : 'false');
      b.innerHTML = `<span class="menu-item-txt"></span>${o.selected ? VISTO : ''}`;
      b.querySelector('.menu-item-txt').textContent = o.textContent.trim() || ' ';
      if (o.disabled) { b.disabled = true; b.classList.add('inerte'); }
      else {
        b.addEventListener('click', () => elegir(o));
        items.push(b);
      }
      menu.appendChild(b);
    };

    [...sel.children].forEach(hijo => {
      if (hijo.tagName === 'OPTGROUP') {
        const t = document.createElement('div');
        t.className = 'menu-titulo';
        t.textContent = hijo.label;
        menu.appendChild(t);
        [...hijo.children].forEach(ponerOpcion);
      } else if (hijo.tagName === 'OPTION') ponerOpcion(hijo);
    });

    if (!menu.children.length) {
      const v = document.createElement('div');
      v.className = 'menu-vacio';
      v.textContent = 'No hay nada que elegir';
      menu.appendChild(v);
    }

    // Una ventana <dialog> abierta se dibuja en una capa aparte, por encima de
    // todo lo demás: un menú colgado del body queda debajo y no se ve, por
    // muchos z-index que se le pongan. Así que si el desplegable vive dentro de
    // una ventana, el menú se cuelga de esa misma ventana.
    (cara.closest('dialog[open]') || document.body).appendChild(menu);
    cara.setAttribute('aria-expanded', 'true');
    abierto = { sel, cara, menu, items, indice: -1 };
    colocar();

    const puesto = items.findIndex(b => b.classList.contains('elegido'));
    marcar(puesto < 0 ? 0 : puesto);
    if (items.length) items[abierto.indice].focus();
  }

  /* ── Teclado: igual que un desplegable de siempre ─────────────────────── */

  function teclasEnMenu(e) {
    if (!abierto || !abierto.menu.contains(e.target)) return;
    const { items, indice } = abierto;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); marcar(indice + 1); items[abierto.indice].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(indice - 1); items[abierto.indice].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); marcar(0); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); marcar(items.length - 1); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') cerrar(true);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Escribir una letra salta a la primera opción que empiece así
      const letra = e.key.toLowerCase();
      const desde = indice + 1;
      const orden = [...items.slice(desde), ...items.slice(0, desde)];
      const halla = orden.find(b => b.textContent.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').startsWith(letra));
      if (halla) { marcar(items.indexOf(halla)); halla.focus(); }
    }
  }

  /* ── Cambiar un <select> por su cara ──────────────────────────────────── */

  function mejorar(sel) {
    if (sel.dataset.menuListo || sel.multiple || sel.size > 1) return;
    sel.dataset.menuListo = '1';

    const caja = document.createElement('span');
    caja.className = 'sel';
    sel.parentNode.insertBefore(caja, sel);
    caja.appendChild(sel);

    const cara = document.createElement('button');
    cara.type = 'button';
    cara.className = 'sel-cara ' + sel.className;
    cara.setAttribute('aria-haspopup', 'listbox');
    cara.setAttribute('aria-expanded', 'false');
    if (!sel.id) sel.id = 'sel-' + (++contador);
    cara.id = sel.id + '-cara';
    const etq = sel.getAttribute('aria-label') || sel.title;
    if (etq) cara.setAttribute('aria-label', etq);
    if (sel.title) cara.title = sel.title;
    cara.innerHTML = `<span class="sel-cara-txt"></span>${FLECHA}`;
    caja.appendChild(cara);
    sel.classList.add('sel-nativo');
    sel.tabIndex = -1;

    const texto = cara.querySelector('.sel-cara-txt');
    const refrescar = () => {
      const o = sel.options[sel.selectedIndex];
      texto.textContent = o ? o.textContent.trim() : '';
      cara.disabled = sel.disabled;
      cara.classList.toggle('sel-vacia', !o || !o.value);
    };
    refrescar();

    cara.addEventListener('click', () => abrir(sel, cara));
    cara.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrir(sel, cara);
      }
    });
    // La etiqueta <label> que envuelve al campo tiene que seguir dando el foco
    const rotulo = sel.closest('label');
    if (rotulo) rotulo.addEventListener('click', e => {
      if (!caja.contains(e.target)) { e.preventDefault(); cara.focus(); }
    });

    sel.addEventListener('change', refrescar);
    // Si el programa lo llena de nuevo o lo bloquea, la cara se entera
    new MutationObserver(refrescar).observe(sel, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'],
    });
    // Y si le asignan un valor a mano (sel.value = ...), también
    ['value', 'selectedIndex'].forEach(prop => {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(sel, prop, {
        configurable: true,
        get() { return d.get.call(this); },
        set(v) { d.set.call(this, v); refrescar(); },
      });
    });
  }

  function mejorarTodos(raiz = document) {
    raiz.querySelectorAll('select:not([data-menu-listo])').forEach(mejorar);
  }

  /* ── Arranque ─────────────────────────────────────────────────────────── */

  const arrancar = () => {
    mejorarTodos();
    // Los campos que nacen después (una fila nueva, una ventana que se llena)
    new MutationObserver(cambios => {
      for (const c of cambios) for (const n of c.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SELECT') mejorar(n);
        else if (n.querySelector) mejorarTodos(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  document.addEventListener('keydown', teclasEnMenu, true);
  document.addEventListener('mousedown', e => {
    if (abierto && !abierto.menu.contains(e.target) && !abierto.cara.contains(e.target)) cerrar(false);
  }, true);
  window.addEventListener('resize', colocar);
  window.addEventListener('scroll', colocar, true);
})();
