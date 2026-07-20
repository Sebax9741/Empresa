/* Almacenamiento local con IndexedDB.
   Cada crédito: { id, boleta, cliente, monto, fecha, vencimiento, estado, notas, foto (dataURL o null), creado } */
const DB = (() => {
  const DB_NAME = 'creditos-db';
  const STORE = 'creditos';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
    }));
  }

  return {
    getAll() {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }));
    },
    put(credito) { return tx('readwrite', s => s.put(credito)); },
    delete(id) { return tx('readwrite', s => s.delete(id)); },
    clear() { return tx('readwrite', s => s.clear()); },
  };
})();
