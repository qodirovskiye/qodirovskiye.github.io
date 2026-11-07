const DATABASE = 'qmax-private-reports';
let connection;
function open() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Local report storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('Another QMax tab is blocking local report storage. Close it and try again.')); };
  });
  return connection;
}
async function transaction(mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', mode);
    const request = operation(tx.objectStore('reports'));
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Local storage could not complete.'));
    tx.onabort = () => reject(tx.error || new Error('Local storage was interrupted.'));
  });
}
export const saveReport = report => transaction('readwrite', store => store.put(report));
export const getReport = id => transaction('readonly', store => store.get(id));
export const deleteReport = id => transaction('readwrite', store => store.delete(id));
export const listReports = async () => (await transaction('readonly', store => store.getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
