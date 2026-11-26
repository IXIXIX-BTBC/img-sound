// Saved slots (IndexedDB). One slot = photo + trace + settings
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('photo-synth', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('slots')) d.createObjectStore('slots', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); // last loaded image, etc.
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn, store = 'slots') => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
};
export const all = () => tx('readonly', (s) => s.getAll());
export const add = (obj) => tx('readwrite', (s) => s.add(obj));
export const del = (id) => tx('readwrite', (s) => s.delete(id));
// Last loaded image (shown again on the next start)
export const setLast = (blob) => tx('readwrite', (s) => s.put(blob, 'lastImage'), 'meta');
export const getLast = () => tx('readonly', (s) => s.get('lastImage'), 'meta');
// Generic small settings (e.g. the photo list of the color->scale page)
export const setMeta = (key, val) => tx('readwrite', (s) => s.put(val, key), 'meta');
export const getMeta = (key) => tx('readonly', (s) => s.get(key), 'meta');
