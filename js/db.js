/* Almacenamiento local con IndexedDB.
   Cada crédito: { id, boleta, cliente, clienteId, zona, monto, fecha, vencimiento, estado, notas, foto (dataURL o null), creado }
   Cada cliente: { id, nombre, zona, telefono, notas, creado } */
const DB = (() => {
  const DB_NAME = 'creditos-db';
  const STORE = 'creditos';
  const STORE_CLI = 'clientes';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_CLI)) {
            db.createObjectStore(STORE_CLI, { keyPath: 'id' });
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
  };
})();
