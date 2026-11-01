// Autosave in IndexedDB, last project only (SPEC). The photo + detection are written once per photo under
// "photo"; settings and edits are rewritten under "state" after changes. Nothing leaves the browser.
const DB = 'knitting-pixel-art-editor';
const STORE = 'project';

export interface SavedPhoto {
  id: number;            // ties a state record to its photo
  name: string;
  kind?: 'photo' | 'pixels' | 'blank'; // pixels: an imported pixel image, stored at one pixel per cell; blank: no photo (clean avatar only)
  png: Blob;             // the ≤1600 px working photo, lossless, so a reload renders exactly the same
  lm: Float32Array | null;
  seg: Uint8Array | null;
  regions: string[];
  glasses: number;
  ms: number;
}

export interface SavedState {
  version: 1;
  photoId: number;
  savedAt: number;
  settings: Record<string, unknown>; // frame, ratio, grid, look, style, palette (owned by main.ts)
  edits: { W: number; H: number; cells: Uint8Array; baked: Uint8Array | null };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode), req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** The photo as written: its bytes, not a Blob (Safari refuses Blobs in IndexedDB in private windows). Older
 *  saves hold a Blob and still load. */
type StoredPhoto = Omit<SavedPhoto, 'png'> & { png: Blob | ArrayBuffer; type?: string };

export const savePhoto = async (p: SavedPhoto) => {
  const png = await p.png.arrayBuffer();
  return tx('readwrite', s => { s.put({ ...p, png, type: p.png.type } satisfies StoredPhoto, 'photo'); s.delete('state'); });
};
export const saveState = (st: SavedState) => tx('readwrite', s => { s.put(st, 'state'); });
export const forget = () => tx('readwrite', s => { s.clear(); });

export async function load(): Promise<{ photo: SavedPhoto; state: SavedState | null } | null> {
  const raw = await tx<StoredPhoto>('readonly', s => s.get('photo'));
  if (!raw) return null;
  const photo: SavedPhoto = { ...raw, png: raw.png instanceof Blob ? raw.png : new Blob([raw.png], { type: raw.type || 'image/png' }) };
  const state = (await tx<SavedState>('readonly', s => s.get('state'))) ?? null;
  return { photo, state: state && state.version === 1 && state.photoId === photo.id ? state : null };
}
