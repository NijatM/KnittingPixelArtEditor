// Clean avatar (first in the gallery): portraits put together from the team's 40 approved characters instead of
// drawn from the photo. scripts/build-avatar-library.py cuts every character into parts — the hair with its head,
// ears, neck and shoulders (and a beard drawn into the jaw), then eyes, brows, nose, mouth, glasses and moustache —
// labelled per pixel at each size the art exists at (25 … 128 px). The photo only chooses: the hair closest in shape,
// glasses and facial hair when it has them, closed eyes or a grin when it shows them. Custom puts the chosen parts
// together, each anchored to the head's own eyes, nose and mouth and fitted to what is around it; prebuilt shows
// one character exactly as drawn.
import { avatarMouth, facialHairKind } from './avatar';
import { pt, type Pt } from './landmarks';
import { eyeOpenness, lensName, type Face } from './stamps';
import { SEG, type Prepared } from './types';

export const CLEAN_SIZES = [25, 50, 72, 80, 96, 128];
export type CleanPart = 'hair' | 'eyes' | 'brows' | 'nose' | 'mouth' | 'glasses' | 'facial';
export const CLEAN_PARTS: CleanPart[] = ['hair', 'eyes', 'brows', 'nose', 'mouth', 'glasses', 'facial'];
type FacePart = Exclude<CleanPart, 'hair'>;

/** Per part: '' = auto (closest to the photo), a character's nickname = that character's part, 'none' = left out. */
export interface CleanLook { mode: 'custom' | 'prebuilt'; character: string; parts: Record<CleanPart, string> }
export const AUTO_CLEAN: CleanLook = { mode: 'custom', character: '', parts: { hair: '', eyes: '', brows: '', nose: '', mouth: '', glasses: '', facial: '' } };

// Pixel labels written by the build script.
const PAPER = 0, HEAD = 1, FACE = 8, HEAD_IN = 9, BEARD = 10;
/** The head's own ink: hair, outline, ears, clothes, and a beard drawn into its jaw. */
const headInk = (v: number) => v === HEAD || v === HEAD_IN || v === BEARD;
const LABEL: Record<FacePart, number> = { brows: 2, eyes: 3, glasses: 4, nose: 5, mouth: 6, facial: 7 };
/** Drawing order: later parts win where they meet earlier ones. */
const ORDER: FacePart[] = ['nose', 'mouth', 'facial', 'eyes', 'brows', 'glasses'];
const SIDED = new Set<FacePart>(['eyes', 'brows', 'glasses']);

interface Anchors { eyes: [Pt, Pt]; nose: Pt; mouth: Pt; axis: number; d: number }
export interface Tags {
  glasses?: { shape: 'round' | 'square'; aspect: number };
  facial: 'none' | 'moustache' | 'goatee' | 'beard';
  headFacial: 'none' | 'goatee' | 'beard';
  eyes: 'open' | 'closed';
  mouth: 'grin' | 'smile' | 'hidden';
}
type HairKey = 'top' | 'width' | 'volume' | 'length' | 'hairline' | 'asym';
export type HairMeasures = Record<HairKey, number>;
export interface Character { nick: string; name: string; number: number; tags: Tags; hair: HairMeasures; L: Uint8Array; at: Anchors }
export interface Library { size: number; chars: Character[]; spread: HairMeasures; cache: Map<string, unknown> }

// ---------------------------------------------------------------- loading
interface ManifestChar { number: number; nick: string; name: string; tags: Tags; hair: HairMeasures }
interface LibraryFile { size: number; chars: { nick: string; labels: string; at: Anchors }[] }
export type FetchJson = (path: string) => Promise<unknown>;

function unrle(s: string, n: number) {
  const out = new Uint8Array(n);
  let i = 0;
  for (const m of s.matchAll(/([a-k])(\d*)/g)) { const k = m[2] ? +m[2] : 1; out.fill(m[1].charCodeAt(0) - 97, i, i + k); i += k; }
  if (i !== n) throw new Error('avatar library: bad label data');
  return out;
}

const HAIR_KEYS: HairKey[] = ['top', 'width', 'volume', 'length', 'hairline', 'asym'];
const libs = new Map<number, Promise<Library>>();
/** The library at one size, loaded once (paths are relative to the site root: avatars/…). */
export function loadLibrary(size: number, fetchJson: FetchJson): Promise<Library> {
  let p = libs.get(size);
  if (!p) {
    p = Promise.all([fetchJson('avatars/manifest.json'), fetchJson(`avatars/library-${size}.json`)]).then(([m, l]) => {
      const man = (m as { chars: ManifestChar[] }).chars, lib = l as LibraryFile;
      const chars = lib.chars.map((c, i) => ({ ...man[i], L: unrle(c.labels, size * size), at: c.at }));
      const spread = Object.fromEntries(HAIR_KEYS.map(k => {
        const v = man.map(c => c.hair[k]), mean = v.reduce((a, b) => a + b, 0) / v.length;
        return [k, Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1];
      })) as HairMeasures;
      return { size, chars, spread, cache: new Map() };
    });
    p.catch(() => libs.delete(size)); // a failed load may be retried
    libs.set(size, p);
  }
  return p;
}

/** The largest size the art exists at that fits the grid (the smallest when none does). */
export const cleanSize = (W: number, H: number) => [...CLEAN_SIZES].reverse().find(s => s <= Math.min(W, H)) ?? CLEAN_SIZES[0];

// ---------------------------------------------------------------- parts
/** A part's cells in its own character; facial hair also carries the beard drawn into that character's jaw (bx, by). */
interface Part { src: Character; xs: number[]; ys: number[]; bx: number[]; by: number[] }

function partOf(lib: Library, c: Character, kind: FacePart): Part | null {
  const key = `part:${c.nick}:${kind}`;
  if (!lib.cache.has(key)) {
    const s = lib.size, xs: number[] = [], ys: number[] = [], bx: number[] = [], by: number[] = [];
    // a beard travels only with a drawn mouth, which places it (#29's mouth is hidden in it)
    const beard = kind === 'facial' && c.L.includes(LABEL.mouth);
    for (let i = 0; i < c.L.length; i++) {
      if (c.L[i] === LABEL[kind]) { xs.push(i % s); ys.push((i / s) | 0); }
      else if (beard && c.L[i] === BEARD) { bx.push(i % s); by.push((i / s) | 0); }
    }
    lib.cache.set(key, xs.length || bx.length ? { src: c, xs, ys, bx, by } : null);
  }
  return lib.cache.get(key) as Part | null;
}
const hasBeard = (lib: Library, c: Character) => !!partOf(lib, c, 'facial')?.bx.length;

const eyeY = (a: Anchors) => (a.eyes[0][1] + a.eyes[1][1]) / 2;

/**
 * Where a part of B lands on head A: sided parts follow each eye (the two sides moved mirror-wise, so a symmetric
 * part stays symmetric), the nose follows the nose, mouth and moustache follow the mouth.
 */
function shifts(kind: FacePart, A: Anchors, B: Anchors): { dl: number; dr: number; dy: number } {
  if (SIDED.has(kind)) {
    const dl = Math.round(A.eyes[0][0] - B.eyes[0][0]);
    return { dl, dr: Math.round(2 * (A.axis - B.axis)) - dl, dy: Math.round(eyeY(A) - eyeY(B)) };
  }
  const a = kind === 'nose' ? A.nose : A.mouth, b = kind === 'nose' ? B.nose : B.mouth, dx = Math.round(a[0] - b[0]);
  return { dl: dx, dr: dx, dy: Math.round(a[1] - b[1]) };
}

/** Is cell i of head A somewhere a part may be drawn (inside the face)? */
const inFace = (A: Character, i: number) => A.L[i] >= 2;

/** Part B placed on head A, clipped to A's face; glasses get their bridge and arms refitted. Returns the mask and the share kept. */
function place(lib: Library, part: Part, kind: FacePart, A: Character): { m: Uint8Array; kept: number } {
  const s = lib.size, B = part.src, m = new Uint8Array(s * s);
  if (B === A) { for (let k = 0; k < part.xs.length; k++) m[part.ys[k] * s + part.xs[k]] = 1; return { m, kept: 1 }; }
  const { dl, dr, dy } = shifts(kind, A.at, B.at);
  // A beard goes on whole, around the mouth: it is the jaw's outline where it covers it.
  for (let k = 0; k < part.bx.length; k++) {
    const x = part.bx[k] + dl, y = part.by[k] + dy;
    if (x >= 0 && y >= 0 && x < s && y < s) m[y * s + x] = 1;
  }
  if (!part.xs.length) return { m, kept: 1 };
  let kept = 0;
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= s || y >= s) return false;
    const i = y * s + x;
    if (A.L[i] === PAPER) return false;
    if (inFace(A, i)) m[i] = 1;
    return true;
  };
  for (let k = 0; k < part.xs.length; k++) {
    const x = part.xs[k], y = part.ys[k];
    // the middle column of a sided part (a glasses bridge) goes with both sides; the gap is filled below
    const l = x <= B.at.axis, r = x >= B.at.axis;
    let ok = false;
    if (l) ok = put(x + dl, y + dy) || ok;
    if (r) ok = put(x + dr, y + dy) || ok;
    kept += +ok;
  }
  if (kind === 'glasses') {
    const ys = new Set(part.ys);
    for (const y of ys) {
      const row = part.xs.filter((_, k) => part.ys[k] === y), yy = y + dy;
      if (yy < 0 || yy >= s) continue;
      // Bridge: a row that crosses the middle in B crosses it in A too.
      if (row.some(x => Math.abs(x - B.at.axis) <= 0.5)) {
        let lx = -1, rx = s;
        for (let x = 0; x < s; x++) if (m[yy * s + x]) { if (x <= A.at.axis) lx = x; else if (rx === s) rx = x; }
        if (lx >= 0 && rx < s && rx - lx <= A.at.d) for (let x = lx + 1; x < rx; x++) if (inFace(A, yy * s + x)) m[yy * s + x] = 1;
      }
      // Arms: a row that reached B's face edge reaches A's (out to the outline, if it is near).
      for (const [dir, edgeX] of [[-1, Math.min(...row)], [1, Math.max(...row)]] as const) {
        const bx = edgeX + dir;
        if (bx < 0 || bx >= s || B.L[y * s + bx] >= 2) continue; // B's arm stopped inside the face: nothing to reach
        let x = -1;
        for (let k = 0; k < s; k++) if (m[yy * s + k]) { if (dir < 0) { x = k; break; } else x = k; }
        if (x < 0) continue;
        const path: number[] = [];
        for (let xx = x + dir; xx >= 0 && xx < s && path.length <= A.at.d * 0.5; xx += dir) {
          const i = yy * s + xx;
          if (headInk(A.L[i])) { for (const j of path) m[j] = 1; break; }
          if (!inFace(A, i)) break;
          path.push(i);
        }
      }
    }
  }
  return { m, kept: kept / part.xs.length };
}

/** A part fits a head when the faces are of similar size and almost all of it lands inside the face. */
function fits(lib: Library, part: Part, kind: FacePart, A: Character) {
  if (part.src === A) return true;
  const key = `fit:${kind}:${part.src.nick}:${A.nick}`;
  if (!lib.cache.has(key)) {
    const r = part.src.at.d / A.at.d;
    lib.cache.set(key, r >= 0.78 && r <= 1.28 && place(lib, part, kind, A).kept >= 0.92);
  }
  return lib.cache.get(key) as boolean;
}

/** Look-alike parts at this size count once: groups of characters whose part is the same, or nearly (≤ 4 % of it). */
function groups(lib: Library, kind: FacePart): Character[][] {
  const key = `groups:${kind}`;
  if (!lib.cache.has(key)) {
    const out: { sig: Set<string>; n: number; members: Character[] }[] = [];
    for (const c of lib.chars) {
      const p = partOf(lib, c, kind);
      if (!p) continue;
      const sig = new Set<string>();
      for (let k = 0; k < p.xs.length; k++) {
        const x = p.xs[k], y = p.ys[k];
        const ref = !SIDED.has(kind) ? (kind === 'nose' ? c.at.nose : c.at.mouth) : x <= c.at.axis ? c.at.eyes[0] : c.at.eyes[1];
        sig.add(`${Math.round(x - ref[0])},${Math.round(y - ref[1])}${SIDED.has(kind) ? (x <= c.at.axis ? 'l' : 'r') : ''}`);
      }
      for (let k = 0; k < p.bx.length; k++) sig.add(`${Math.round(p.bx[k] - c.at.mouth[0])},${Math.round(p.by[k] - c.at.mouth[1])}b`);
      const g = out.find(o => {
        let diff = 0;
        for (const v of sig) diff += +!o.sig.has(v);
        for (const v of o.sig) diff += +!sig.has(v);
        return diff <= Math.max(1, Math.floor(0.04 * Math.max(sig.size, o.n)));
      });
      if (g) g.members.push(c); else out.push({ sig, n: sig.size, members: [c] });
    }
    lib.cache.set(key, out.map(o => o.members));
  }
  return lib.cache.get(key) as Character[][];
}

/** The options for a part on head A, as nicknames: hair = every character; a face part = one per look-alike group that fits. */
export function partOptions(lib: Library, kind: CleanPart, A: Character): string[] {
  if (kind === 'hair') return lib.chars.map(c => c.nick);
  const out: string[] = [];
  const bearded = hasBeard(lib, A); // a head with its own beard takes moustaches only
  for (const g of groups(lib, kind)) {
    const own = g.includes(A) ? A : null;
    const rep = own ?? g.find(c => fits(lib, partOf(lib, c, kind)!, kind, A) && !(bearded && kind === 'facial' && hasBeard(lib, c)));
    if (rep) out.push(rep.nick);
  }
  if (kind !== 'eyes') out.push('none');
  return out;
}

/** A face part by nickname on head A: the head's own one when it looks alike; null = none. */
function resolve(lib: Library, kind: FacePart, nick: string, A: Character): Part | null {
  if (nick === 'none') return null;
  const c = lib.chars.find(c => c.nick === nick);
  if (!c) return null;
  const g = groups(lib, kind).find(g => g.includes(c));
  return partOf(lib, g?.includes(A) ? A : c, kind);
}

// ---------------------------------------------------------------- composing
const near8 = (m: Uint8Array, s: number, x: number, y: number) => {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < s && yy < s && m[yy * s + xx]) return true;
    }
  return false;
};

/** Ink mask (1 = ink) of head A with the chosen face parts. */
export function compose(lib: Library, A: Character, pick: Partial<Record<FacePart, Part | null>>): Uint8Array {
  const s = lib.size, n = s * s, ink = new Uint8Array(n), hair = new Uint8Array(n);
  for (let i = 0; i < n; i++) hair[i] = ink[i] = +headInk(A.L[i]);
  const layer: Partial<Record<FacePart, Uint8Array>> = {}, src = (k: FacePart) => pick[k]?.src;
  for (const kind of ORDER) { const p = pick[kind]; if (p) layer[kind] = place(lib, p, kind, A).m; }
  const { eyes, brows, glasses, mouth, facial, nose } = layer;
  const each = (m: Uint8Array, f: (x: number, y: number, i: number) => void) => { for (let i = 0; i < n; i++) if (m[i]) f(i % s, (i / s) | 0, i); };
  // Fitting parts from different characters to each other (pairs drawn together are left as drawn).
  if (eyes && glasses && src('eyes') !== src('glasses')) each(eyes, (x, y, i) => { if (near8(glasses, s, x, y)) eyes[i] = 0; });
  if (brows && src('brows') !== A) each(brows, (x, y, i) => { if (near8(hair, s, x, y)) brows[i] = 0; }); // a gap to the hair
  if (brows && glasses && src('brows') !== src('glasses')) {
    // Brows sit above the frame: lifted a row or two if they would cut into it, otherwise trimmed.
    const top = new Int32Array(s).fill(s);
    each(glasses, (x, y) => { top[x] = Math.min(top[x], y); });
    const hits = (k: number) => { let c = 0; each(brows, (x, y) => { c += +(y - k >= top[x] - 1 || (x > 0 && y - k >= top[x - 1] - 1) || (x < s - 1 && y - k >= top[x + 1] - 1)); }); return c; };
    const most = Math.max(1, Math.round(s / 40));
    let k = 0;
    while (k < most && hits(k)) k++;
    const lifted = new Uint8Array(n);
    each(brows, (x, y) => { const yy = y - k; if (yy >= 0 && yy < top[x] - 1 && inFace(A, yy * s + x) && !near8(hair, s, x, yy)) lifted[yy * s + x] = 1; });
    layer.brows = lifted;
  }
  // Facial hair keeps a paper cell around a mouth from elsewhere (a transplanted beard, and the head's own).
  if (mouth && facial && src('mouth') !== src('facial')) each(facial, (x, y, i) => { if (near8(mouth, s, x, y)) facial[i] = 0; });
  if (mouth && src('mouth') !== A) for (let i = 0; i < n; i++) if (A.L[i] === BEARD && near8(mouth, s, i % s, (i / s) | 0)) ink[i] = 0;
  if (nose) for (const other of [glasses, mouth, facial]) if (other) each(nose, (x, y, i) => { if (src('nose') !== A && near8(other, s, x, y)) nose[i] = 0; });
  for (const kind of ORDER) { const m = layer[kind]; if (m) for (let i = 0; i < n; i++) ink[i] |= m[i]; }
  return ink;
}

// ---------------------------------------------------------------- the photo
export interface Match {
  hair: HairMeasures | null;
  glasses: boolean;
  lens: { shape: 'round' | 'square'; aspect: number } | null;
  facial: Tags['facial'];
  eyes: Tags['eyes'];
  mouth: 'grin' | 'smile' | 'line';
}

/** The same hair measures the build script takes from the art, from the photo's regions (work image). */
function photoHair(p: Prepared): HairMeasures | null {
  const lm = p.lm, { f, w, h, seg } = p.work;
  if (!lm) return null;
  const mid = (a: number, b: number): Pt => [(pt(lm, a)[0] + pt(lm, b)[0]) / 2 * f, (pt(lm, a)[1] + pt(lm, b)[1]) / 2 * f];
  const e1 = mid(33, 133), e2 = mid(362, 263), d = Math.hypot(e2[0] - e1[0], e2[1] - e1[1]);
  if (d < 4) return null;
  const ax = (e1[0] + e2[0]) / 2, ey = (e1[1] + e2[1]) / 2, my = (pt(lm, 13)[1] + pt(lm, 14)[1]) / 2 * f;
  let top = ey, wx0 = Infinity, wx1 = -Infinity, vol = 0, side = 0, sideHair = 0, line = ey, left = 0, right = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = seg[y * w + x], hairy = v === SEG.HAIR, head = hairy || v === SEG.FACE, dx = Math.abs(x - ax);
      if (head && dx < 0.6 * d) top = Math.min(top, y);
      if ((head || v === SEG.BODY) && Math.abs(y - ey) <= 0.2 * d) { wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); }
      if (hairy && y < ey) { vol++; if (x < ax) left++; else right++; }
      if (dx >= 0.95 * d && dx <= 1.6 * d && y >= my - 0.2 * d && y <= my + 0.8 * d) { side++; sideHair += +hairy; }
      if (v === SEG.FACE && dx <= 0.25 * d) line = Math.min(line, y);
    }
  if (!vol && top === ey) return null;
  return {
    top: (ey - top) / d, width: wx1 > wx0 ? (wx1 - wx0 + 1) / d : 2.8, volume: vol / d ** 2, length: side ? sideHair / side : 0,
    hairline: (ey - line) / d, asym: (right - left) / Math.max(1, left + right),
  };
}

/** What the clean avatar takes from the photo. */
export function photoMatch(p: Prepared, glasses: boolean): Match {
  const lm = p.lm, f: Face | null = lm ? { lm, W: p.W, H: p.H } : null;
  const ln = p.lenses ? lensName(p.lenses) : null, l = p.lenses?.[0], mouth = f ? avatarMouth(f) : 'smile';
  return {
    hair: photoHair(p),
    glasses,
    lens: ln && l ? { shape: ln === 'square' || ln === 'rounded' ? 'square' : 'round', aspect: l.a / l.b } : null,
    facial: facialHairKind(p),
    eyes: f && eyeOpenness(f) < 0.2 ? 'closed' : 'open',
    mouth: mouth === 'open' ? 'grin' : mouth,
  };
}

// Hair measure weights (in spreads across the 40 characters): volume and length tell the most apart.
const HAIR_W: HairMeasures = { top: 0.8, width: 1, volume: 1.5, length: 1.5, hairline: 0.4, asym: 0.6 };

function hairDistance(lib: Library, c: Character, m: Match) {
  if (!m.hair) return 0;
  let d = 0;
  for (const k of HAIR_KEYS) d += HAIR_W[k] * ((c.hair[k] - m.hair[k]) / lib.spread[k]) ** 2;
  return Math.sqrt(d);
}

/**
 * How well a head suits the photo: its hair, and a beard drawn into it only where the photo has one (a beard the
 * photo has can be added to any head, so heads without one lose little).
 */
function headScore(lib: Library, c: Character, m: Match) {
  const hf = c.tags.headFacial, pf = m.facial;
  const facial = pf === 'none' ? (hf === 'beard' ? 4 : hf === 'goatee' ? 2 : 0)
    : pf === 'beard' ? (hf === 'beard' ? 0 : 0.6) : pf === 'goatee' ? (hf === 'goatee' ? 0 : hf === 'beard' ? 1 : 0.3) : hf === 'beard' ? 1 : 0;
  // and a little for every part that has to come from elsewhere: a head that already matches stays more of a piece
  const t = c.tags, swaps = (m.glasses && !t.glasses ? 0.6 : !m.glasses && t.glasses ? 0.2 : 0) + (m.eyes !== t.eyes ? 0.3 : 0)
    + ((m.mouth === 'grin') !== (t.mouth === 'grin') ? 0.2 : 0);
  return hairDistance(lib, c, m) + facial + swaps;
}

/** Prebuilt: the whole character closest to the photo. */
function characterScore(lib: Library, c: Character, m: Match) {
  const t = c.tags, ownFacial = t.facial !== 'none';
  return headScore(lib, c, m) + (m.glasses !== !!t.glasses ? 3 : 0) + (m.eyes !== t.eyes ? 0.7 : 0)
    + ((m.mouth === 'grin') !== (t.mouth === 'grin') ? 0.5 : 0) + (m.facial === 'none' ? (ownFacial ? 1.5 : 0) : ownFacial ? 0 : 1);
}

const best = <T>(xs: T[], score: (x: T) => number) => xs.reduce((a, b) => (score(b) < score(a) ? b : a));

/** Auto for each face part on head A: the head's own part, swapped where the photo says otherwise. */
function autoParts(lib: Library, A: Character, m: Match | null): Record<FacePart, string> {
  const own = (k: FacePart) => (partOf(lib, A, k) ? A.nick : 'none');
  const out = { eyes: own('eyes'), brows: own('brows'), nose: own('nose'), mouth: own('mouth'), glasses: own('glasses'), facial: own('facial') };
  if (!m) return out;
  const pick = (k: FacePart, ok: (c: Character) => boolean, score: (c: Character) => number = c => Math.abs(Math.log(c.at.d / A.at.d))) => {
    const opts = partOptions(lib, k, A).filter(n => n !== 'none').map(n => lib.chars.find(c => c.nick === n)!).filter(ok);
    return opts.length ? best(opts, score).nick : null;
  };
  if (!m.glasses) out.glasses = 'none';
  else if (!A.tags.glasses) {
    const lens = m.lens;
    out.glasses = pick('glasses', c => !!c.tags.glasses, c => (lens && c.tags.glasses!.shape !== lens.shape ? 1 : 0) + (lens ? Math.abs(c.tags.glasses!.aspect - lens.aspect) : 0) + Math.abs(Math.log(c.at.d / A.at.d))) ?? 'none';
  }
  // Facial hair: the kind the photo shows (a beard, else a goatee, else a moustache), unless the head has its own.
  if (m.facial === 'none') out.facial = 'none';
  else if (A.tags.headFacial === 'none' && !(A.tags.facial === m.facial && out.facial !== 'none')) {
    const kinds = m.facial === 'beard' ? ['beard', 'goatee', 'moustache'] : m.facial === 'goatee' ? ['goatee', 'moustache'] : ['moustache'];
    // the shortest beard that fits (a photo rarely shows a long one)
    const short = (c: Character) => { const p = partOf(lib, c, 'facial')!; return p.by.length ? (Math.max(...p.by) - Math.min(...p.by)) / c.at.d : 0; };
    out.facial = kinds.reduce<string | null>((got, k) => got ?? pick('facial', c => c.tags.facial === k && (k !== 'beard' || hasBeard(lib, c)), c => short(c) + Math.abs(Math.log(c.at.d / A.at.d))), null) ?? out.facial;
  }
  if (A.tags.eyes !== m.eyes) out.eyes = pick('eyes', c => c.tags.eyes === m.eyes) ?? out.eyes;
  const grin = m.mouth === 'grin';
  if (A.tags.mouth !== 'hidden' && (A.tags.mouth === 'grin') !== grin) out.mouth = pick('mouth', c => (c.tags.mouth === 'grin') === grin) ?? out.mouth;
  return out;
}

// ---------------------------------------------------------------- the style
export interface CleanInfo {
  size: number;
  x0: number; y0: number; // where the art sits in the grid
  mode: CleanLook['mode'];
  character: string;      // prebuilt: the character shown
  closest: string;        // the character closest to the photo
  head: string;
  parts: Record<CleanPart, string>;   // in use
  auto: Record<CleanPart, string>;    // what auto picks with this hair
  options: Record<CleanPart, string[]>;
  at: Anchors;            // the head's anchors (grid coordinates), for tapping a part
}

export interface CleanResult { ink: Uint8Array; info: CleanInfo }

/** The clean avatar at W × H: the art at the largest size that fits, bottom centre, on paper. */
export function cleanAvatar(lib: Library, look: CleanLook, m: Match | null, W: number, H: number): CleanResult {
  const s = lib.size, byNick = (n: string) => lib.chars.find(c => c.nick === n);
  const closest = m ? best(lib.chars, c => characterScore(lib, c, m)) : lib.chars[0];
  let A: Character, pick: Partial<Record<FacePart, Part | null>> = {}, parts: Record<CleanPart, string>, auto: Record<CleanPart, string>;
  const character = look.mode === 'prebuilt' ? byNick(look.character) ?? closest : closest;
  if (look.mode === 'prebuilt') {
    A = character;
    auto = { hair: A.nick, ...autoParts(lib, A, null) };
    parts = { ...auto };
    for (const k of ORDER) pick[k] = partOf(lib, A, k);
  } else {
    const autoHead = m ? best(lib.chars, c => headScore(lib, c, m)) : lib.chars[0];
    A = byNick(look.parts.hair) ?? autoHead;
    auto = { hair: autoHead.nick, ...autoParts(lib, A, m) };
    parts = { hair: A.nick } as Record<CleanPart, string>;
    for (const k of ORDER) {
      const want = look.parts[k] || auto[k], opts = partOptions(lib, k, A), rep = groupRep(lib, k, want, A);
      // a picked part stands for its look-alike group; one that doesn't fit this head falls back to auto
      const nick = want === 'none' || opts.includes(want) ? want : opts.includes(rep) ? rep : auto[k];
      parts[k] = nick;
      pick[k] = resolve(lib, k, nick, A);
    }
  }
  const art = look.mode === 'prebuilt' ? Uint8Array.from(A.L, v => +(v !== PAPER && v !== FACE)) : compose(lib, A, pick);
  const ink = new Uint8Array(W * H), x0 = Math.floor((W - s) / 2), y0 = H - s;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const gx = x + x0, gy = y + y0;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) ink[gy * W + gx] = art[y * s + x];
    }
  const options = Object.fromEntries(CLEAN_PARTS.map(k => [k, partOptions(lib, k, A)])) as Record<CleanPart, string[]>;
  const sh = (p: Pt): Pt => [p[0] + x0, p[1] + y0];
  const at: Anchors = { eyes: [sh(A.at.eyes[0]), sh(A.at.eyes[1])], nose: sh(A.at.nose), mouth: sh(A.at.mouth), axis: A.at.axis + x0, d: A.at.d };
  return { ink, info: { size: s, x0, y0, mode: look.mode, character: character.nick, closest: closest.nick, head: A.nick, parts, auto, options, at } };
}

/** The option standing for `nick`'s look-alike group on head A. */
function groupRep(lib: Library, kind: FacePart, nick: string, A: Character) {
  const opts = partOptions(lib, kind, A), g = groups(lib, kind).find(g => g.some(c => c.nick === nick));
  return g?.map(c => c.nick).find(n => opts.includes(n)) ?? nick;
}
