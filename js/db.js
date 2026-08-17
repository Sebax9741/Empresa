/* Almacenamiento local con IndexedDB.
   Cada crédito: { id, boleta, cliente, clienteId, zona, monto, fecha, vencimiento, estado, notas, foto (dataURL o null), creado }
   Cada cliente: { id, nombre, zona, direccion, telefono, notas, creado } */
const DB = (() => {
  const DB_NAME = 'creditos-db';
  const STORE = 'creditos';
  const STORE_CLI = 'clientes';
  const STORE_DESP = 'despachos';
  const STORE_REP = 'repartidores';
  const STORE_ANUL = 'anulados';
  /* Miniaturas de las fotos de boleta. Se quedan SOLO en este dispositivo (no
     se suben ni se respaldan): son una copia chica que se puede rehacer. */
  const STORE_MINI = 'miniaturas';
  /* Copia de lo que llega de la nube, para poder pintar la lista al instante
     sin esperar a que la conexión conteste. Va aparte del almacén de "modo
     local" para no pisar los datos de quien trabajó sin cuenta. */
  const STORE_ESPEJO = 'espejo';
  /* Catálogo de productos, movimientos de almacén (kardex) y notas de venta */
  const STORE_PROD = 'productos';
  const STORE_KARDEX = 'kardex';
  const STORE_NOTAS = 'notas';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 7);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_CLI)) {
            db.createObjectStore(STORE_CLI, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_DESP)) {
            db.createObjectStore(STORE_DESP, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_REP)) {
            db.createObjectStore(STORE_REP, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_ANUL)) {
            db.createObjectStore(STORE_ANUL, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_MINI)) {
            db.createObjectStore(STORE_MINI, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_ESPEJO)) {
            db.createObjectStore(STORE_ESPEJO, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_PROD)) {
            db.createObjectStore(STORE_PROD, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_KARDEX)) {
            db.createObjectStore(STORE_KARDEX, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_NOTAS)) {
            db.createObjectStore(STORE_NOTAS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
    }));
  }

  function leerTodo(store) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  return {
    getAll() { return leerTodo(STORE); },
    put(credito) { return tx(STORE, 'readwrite', s => s.put(credito)); },
    delete(id) { return tx(STORE, 'readwrite', s => s.delete(id)); },
    clear() { return tx(STORE, 'readwrite', s => s.clear()); },

    getAllClientes() { return leerTodo(STORE_CLI); },
    putCliente(cliente) { return tx(STORE_CLI, 'readwrite', s => s.put(cliente)); },
    deleteCliente(id) { return tx(STORE_CLI, 'readwrite', s => s.delete(id)); },

    getAllDespachos() { return leerTodo(STORE_DESP); },
    putDespacho(d) { return tx(STORE_DESP, 'readwrite', s => s.put(d)); },
    deleteDespacho(id) { return tx(STORE_DESP, 'readwrite', s => s.delete(id)); },

    getAllRepartidores() { return leerTodo(STORE_REP); },
    putRepartidor(r) { return tx(STORE_REP, 'readwrite', s => s.put(r)); },
    deleteRepartidor(id) { return tx(STORE_REP, 'readwrite', s => s.delete(id)); },

    /* Miniaturas: { id (el del crédito), mini (dataURL chico) } */
    getAllMiniaturas() { return leerTodo(STORE_MINI); },
    putMiniatura(m) { return tx(STORE_MINI, 'readwrite', s => s.put(m)); },
    clearMiniaturas() { return tx(STORE_MINI, 'readwrite', s => s.clear()); },

    /* Copia de los créditos de la nube (solo para arrancar rápido sin señal) */
    getAllEspejo() { return leerTodo(STORE_ESPEJO); },
    guardarEspejo(lista) {
      return tx(STORE_ESPEJO, 'readwrite', s => {
        s.clear();
        for (const c of lista) s.put(c);
        return { result: lista.length };
      });
    },

    /* Productos: { id, codigo, nombre, presentacion, precioA, precioB, precioC, stockMin, activo } */
    getAllProductos() { return leerTodo(STORE_PROD); },
    putProducto(p) { return tx(STORE_PROD, 'readwrite', s => s.put(p)); },
    deleteProducto(id) { return tx(STORE_PROD, 'readwrite', s => s.delete(id)); },

    /* Kardex: { id, fecha, productoId, tipo, cantidad, costo, documento, motivo, usuario, creado } */
    getAllKardex() { return leerTodo(STORE_KARDEX); },
    putKardex(m) { return tx(STORE_KARDEX, 'readwrite', s => s.put(m)); },
    deleteKardex(id) { return tx(STORE_KARDEX, 'readwrite', s => s.delete(id)); },

    /* Notas de venta: { id, numero, serie, correlativo, clienteId, items[], total, … } */
    getAllNotas() { return leerTodo(STORE_NOTAS); },
    putNota(n) { return tx(STORE_NOTAS, 'readwrite', s => s.put(n)); },
    deleteNota(id) { return tx(STORE_NOTAS, 'readwrite', s => s.delete(id)); },

    /* Notas de venta anuladas: { id (nº de boleta), boleta, motivo, anuladoPor, anuladoEn } */
    getAllAnulados() { return leerTodo(STORE_ANUL); },
    putAnulado(a) { return tx(STORE_ANUL, 'readwrite', s => s.put(a)); },
    deleteAnulado(id) { return tx(STORE_ANUL, 'readwrite', s => s.delete(id)); },
  };
})();
