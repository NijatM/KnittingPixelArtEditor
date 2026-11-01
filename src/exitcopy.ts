// A copy of unsaved work, kept in localStorage when the page is hidden or closed. Browsers drop IndexedDB writes
// started while a page unloads (tested in Chrome and Safari), but a localStorage write is synchronous and sticks.
// The next load takes the copy if it's newer than what IndexedDB holds, then deletes it.

export const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const enc = (_k: string, v: unknown) => (v instanceof Uint8Array ? { $u8: b64(v) } : v);
const dec = (_k: string, v: unknown) => (v && typeof v === 'object' && typeof (v as { $u8?: unknown }).$u8 === 'string' ? unb64((v as { $u8: string }).$u8) : v);

export function keep(name: string, v: unknown) {
  try { localStorage.setItem(name, JSON.stringify(v, enc)); } catch { /* storage blocked or full: nothing more can be done on exit */ }
}
export function take<T>(name: string): T | null {
  try { const s = localStorage.getItem(name); return s ? (JSON.parse(s, dec) as T) : null; } catch { return null; }
}
export function drop(name: string) {
  try { localStorage.removeItem(name); } catch { /* storage blocked */ }
}
/** Runs f when the page is hidden (tab or app switch) or unloaded (reload, close, navigation). */
export function onExit(f: () => void) {
  addEventListener('pagehide', f);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') f(); });
}
