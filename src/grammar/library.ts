// The pattern library and custom keys, kept in this browser (IndexedDB). Nothing leaves the device.
import type { Pattern } from './pattern';
import type { Key } from './ops';

const DB = 'knit-grammar';
const PATTERNS = 'patterns', KEYS = 'keys', META = 'meta';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(PATTERNS, { keyPath: 'id' });
      r.result.createObjectStore(KEYS, { keyPath: 'id' });
      r.result.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode), req = run(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const listPatterns = async () => ((await tx<Pattern[]>(PATTERNS, 'readonly', s => s.getAll())) ?? []).sort((a, b) => b.updated - a.updated);
export const getPattern = (id: string) => tx<Pattern>(PATTERNS, 'readonly', s => s.get(id));
export const putPattern = (p: Pattern) => tx(PATTERNS, 'readwrite', s => { s.put(p); });
export const deletePattern = (id: string) => tx(PATTERNS, 'readwrite', s => { s.delete(id); });

export const listKeys = async () => (await tx<Key[]>(KEYS, 'readonly', s => s.getAll())) ?? [];
export const putKey = (k: Key) => tx(KEYS, 'readwrite', s => { s.put(k); });
export const deleteKey = (id: string) => tx(KEYS, 'readwrite', s => { s.delete(id); });

export const getMeta = <T>(k: string) => tx<T>(META, 'readonly', s => s.get(k));
export const setMeta = (k: string, v: unknown) => tx(META, 'readwrite', s => { s.put(v, k); });
