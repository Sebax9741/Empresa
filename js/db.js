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
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 4);
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

    /* Notas de venta anuladas: { id (nº de boleta), boleta, motivo, anuladoPor, anuladoEn } */
    getAllAnulados() { return leerTodo(STORE_ANUL); },
    putAnulado(a) { return tx(STORE_ANUL, 'readwrite', s => s.put(a)); },
    deleteAnulado(id) { return tx(STORE_ANUL, 'readwrite', s => s.delete(id)); },
  };
})();
