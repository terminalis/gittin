type StoreName = 'documents' | 'preferences' | 'sources' | 'versions' | 'version-bodies';
let opening: Promise<IDBDatabase> | undefined;
export function database(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gittin-local', 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore('documents', { keyPath: 'id' });
          db.createObjectStore('preferences');
        }
        if (event.oldVersion < 2) {
          db.createObjectStore('sources', { keyPath: 'id' });
          db.createObjectStore('versions', { keyPath: 'id' }).createIndex('key', 'key');
          db.createObjectStore('version-bodies', { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(Error('Local storage is blocked by another Gittin window. Close it and retry.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }).catch(error => {
      opening = undefined;
      throw error;
    });
  return opening;
}
/** Run one readwrite transaction; resolves when it commits. */
export async function change(stores: StoreName[], work: (tx: IDBTransaction) => void): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error('A local storage change was aborted.'));
    tx.onerror = () => {};
    work(tx);
  });
}
async function read<T>(store: StoreName, request: (objects: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), done = request(tx.objectStore(store));
    tx.oncomplete = () => resolve(done.result);
    tx.onabort = () => reject(tx.error ?? Error('Local read was aborted.'));
    tx.onerror = () => {};
  });
}
export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return read(store, objects => objects.get(key));
}
export function getAll<T>(store: StoreName): Promise<T[]> {
  return read(store, objects => objects.getAll());
}
