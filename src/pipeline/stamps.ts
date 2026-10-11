// Procedural feature stamps (SPEC: parametric eyes, brows, mouths, noses, glasses; auto-placed from the face
// points, tap to swap). Each variant draws onto `clear` (cells forced to paper) and `ink` (cells forced to ink)
// in grid coordinates, sized from the face points, so a 32-wide eye and a 128-wide eye come out different.
// A hand-drawn set can join later as another variant that blits a bitmap at the same anchor.
import { pt, pts, type Pt } from './landmarks';
import { dilate, disk, line, polygon, polyline, type Mask } from './raster';

export type StampKind = 'eyes' | 'brows' | 'mouth' | 'nose' | 'glasses';
export const STAMP_KINDS: StampKind[] = ['eyes', 'brows', 'mouth', 'nose', 'glasses'];
/** Chosen variant per feature: 0 = auto, otherwise 1-based index into STAMPS[kind]. */
export type Stamps = Record<StampKind, number>;
export const AUTO_STAMPS: Stamps = { eyes: 0, brows: 0, mouth: 0, nose: 0, glasses: 0 };

export interface Face {
  lm: Float32Array; // face points in grid coordinates
  W: number;
  H: number;
}
interface Out { clear: Mask; ink: Mask; brow: Mask }

// ---------------------------------------------------------------- geometry (MediaPipe face mesh indices)
// Per eye: [outer corner, inner corner, upper lid (outer → inner), lower lid (outer → inner), iris centre, iris ring a, b]
const EYES = [
  { o: 33, i: 133, up: [33, 246, 161, 160, 159, 158, 157, 173, 133], lo: [33, 7, 163, 144, 145, 153, 154, 155, 133], c: 468, a: 469, b: 471 },
  { o: 263, i: 362, up: [263, 466, 388, 387, 386, 385, 384, 398, 362], lo: [263, 249, 390, 373, 374, 380, 381, 382, 362], c: 473, a: 474, b: 476 },
];
// Per brow: lower edge (outer → inner) and upper edge (outer → inner).
const BROWS = [
  { lo: [46, 53, 52, 65, 55], up: [70, 63, 105, 66, 107] },
  { lo: [276, 283, 282, 295, 285], up: [300, 293, 334, 296, 336] },
];
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_INNER_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIPS_INNER_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const NOSE = { tip: 1, base: 2, bridge: 6, l: 98, r: 327 };

const mid = (a: Pt, b: Pt, t = 0.5): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const eyeWidth = (f: Face) => EYES.reduce((s, e) => s + dist(pt(f.lm, e.o), pt(f.lm, e.i)), 0) / 2;
const mouthWidth = (f: Face) => dist(pt(f.lm, 61), pt(f.lm, 291));
/** Inner-lip gap relative to mouth width: > ~0.08 is an open mouth (smile with teeth). */
export const mouthOpenness = (f: Face) => dist(pt(f.lm, 13), pt(f.lm, 14)) / Math.max(mouthWidth(f), 1e-6);

function eyeSocket(f: Face, o: Out) {
  for (const e of EYES) {
    const c = [...e.up, ...e.lo.slice(1, -1).reverse()], p = pts(f.lm, c);
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
    polygon(o.clear, f.W, f.H, p.map(([x, y]): Pt => [cx + (x - cx) * 1.35, cy + (y - cy) * 1.35 * 1.6]));
  }
}
const irisRadius = (f: Face, e: (typeof EYES)[number]) => dist(pt(f.lm, e.a), pt(f.lm, e.b)) / 2;

// ---------------------------------------------------------------- variants
type Draw = (f: Face, o: Out) => void;
interface Variant { name: string; draw: Draw }

const eyes: Variant[] = [
  { name: 'traced', draw: (f, o) => { // lid line + iris, as drawn from the photo
    eyeSocket(f, o);
    for (const e of EYES) {
      polyline(o.ink, f.W, f.H, pts(f.lm, e.up));
      const [x, y] = pt(f.lm, e.c);
      disk(o.ink, f.W, f.H, x, y, Math.max(irisRadius(f, e), 0.75));
    }
  } },
  { name: 'dots', draw: (f, o) => { // pixel-art pupils only
    eyeSocket(f, o);
    for (const e of EYES) { const [x, y] = pt(f.lm, e.c); disk(o.ink, f.W, f.H, x, y, Math.max(0.6, Math.min(2.2, irisRadius(f, e) * 0.85))); }
  } },
  { name: 'almond', draw: (f, o) => { // whole eye outline + pupil
    eyeSocket(f, o);
    for (const e of EYES) {
      polyline(o.ink, f.W, f.H, [...pts(f.lm, e.up), ...pts(f.lm, e.lo).reverse()], true);
      const [x, y] = pt(f.lm, e.c); disk(o.ink, f.W, f.H, x, y, Math.max(0.6, irisRadius(f, e) * 0.7));
    }
  } },
  { name: 'liner', draw: (f, o) => { // bold upper lid (two rows) + iris
    eyeSocket(f, o);
    for (const e of EYES) {
      const up = pts(f.lm, e.up);
      polyline(o.ink, f.W, f.H, up);
      polyline(o.ink, f.W, f.H, up.map(([x, y]): Pt => [x, y - 1]));
      const [x, y] = pt(f.lm, e.c); disk(o.ink, f.W, f.H, x, y, Math.max(irisRadius(f, e), 0.75));
    }
  } },
  { name: 'closed', draw: (f, o) => { // happy closed eyes: the upper lid arc, lowered to the eye's middle
    eyeSocket(f, o);
    for (const e of EYES) {
      const up = pts(f.lm, e.up), lo = pts(f.lm, e.lo);
      polyline(o.ink, f.W, f.H, up.map((p, k) => mid(p, lo[k], 0.45)));
    }
  } },
];

function browCentre(f: Face, b: (typeof BROWS)[number], lift = 0): Pt[] {
  const lo = pts(f.lm, b.lo), up = pts(f.lm, b.up);
  return lo.map((p, k) => { const m = mid(p, up[k]); return [m[0], m[1] - lift * Math.sin(Math.PI * Math.min(1, (k + 0.5) / 3.2))]; });
}
const browPolygon = (f: Face, b: (typeof BROWS)[number]) => [...pts(f.lm, b.lo), ...pts(f.lm, b.up).reverse()];

const brows: Variant[] = [
  { name: 'traced', draw: (f, o) => { for (const b of BROWS) polygon(o.brow, f.W, f.H, browPolygon(f, b)); } },
  { name: 'thin', draw: (f, o) => { for (const b of BROWS) polyline(o.brow, f.W, f.H, browCentre(f, b)); } },
  { name: 'bold', draw: (f, o) => {
    for (const b of BROWS) { const p = browPolygon(f, b); polygon(o.brow, f.W, f.H, p); polygon(o.brow, f.W, f.H, p.map(([x, y]): Pt => [x, y - 1])); }
  } },
  { name: 'arched', draw: (f, o) => { for (const b of BROWS) polyline(o.brow, f.W, f.H, browCentre(f, b, Math.max(0.8, eyeWidth(f) * 0.18))); } },
];

const lipsOuter = (f: Face) => pts(f.lm, LIPS_OUTER);
/** Designed mouths replace the photo's lips: clear them first. */
const clearLips = (f: Face, o: Out) => polygon(o.clear, f.W, f.H, lipsOuter(f));
const lipsInner = (f: Face) => [...pts(f.lm, LIPS_INNER_UP), ...pts(f.lm, LIPS_INNER_LO).slice(1, -1).reverse()];

const mouth: Variant[] = [
  { name: 'traced', draw: (f, o) => polyline(o.ink, f.W, f.H, pts(f.lm, LIPS_INNER_UP)) },
  { name: 'smile', draw: (f, o) => { // a U from corner to corner
    clearLips(f, o);
    const l = pt(f.lm, 61), r = pt(f.lm, 291), c = mid(pt(f.lm, 13), pt(f.lm, 14));
    const depth = Math.max(0.8, mouthWidth(f) * 0.12), p: Pt[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, base = mid(l, r, t);
      p.push([base[0], base[1] - 0.4 + (c[1] - (l[1] + r[1]) / 2 + depth) * Math.sin(Math.PI * t)]);
    }
    polyline(o.ink, f.W, f.H, p);
  } },
  { name: 'open', draw: (f, o) => { // lips as a ring around paper teeth
    const outer = new Uint8Array(f.W * f.H), inner = new Uint8Array(f.W * f.H);
    polygon(outer, f.W, f.H, lipsOuter(f));
    polygon(inner, f.W, f.H, lipsInner(f));
    for (let i = 0; i < outer.length; i++) { o.clear[i] |= outer[i]; if (outer[i] && !inner[i]) o.ink[i] = 1; }
  } },
  { name: 'lips', draw: (f, o) => { // filled lips, a paper line between them
    const outer = new Uint8Array(f.W * f.H), gap = new Uint8Array(f.W * f.H);
    polygon(outer, f.W, f.H, lipsOuter(f));
    polyline(gap, f.W, f.H, pts(f.lm, LIPS_INNER_UP));
    for (let i = 0; i < outer.length; i++) { o.clear[i] |= outer[i]; if (outer[i] && !gap[i]) o.ink[i] = 1; }
  } },
  { name: 'dash', draw: (f, o) => { clearLips(f, o); const l = pt(f.lm, 78), r = pt(f.lm, 308); line(o.ink, f.W, f.H, mid(l, r, 0.12), mid(l, r, 0.88)); } },
  { name: 'small', draw: (f, o) => { clearLips(f, o); const l = pt(f.lm, 78), r = pt(f.lm, 308); line(o.ink, f.W, f.H, mid(l, r, 0.32), mid(l, r, 0.68)); } },
];

/** Designed noses replace the photo's nose shadow: clear from below the bridge to the base, alar to alar. */
function clearNose(f: Face, o: Out) {
  const b = pt(f.lm, NOSE.bridge), t = pt(f.lm, NOSE.tip), l = pt(f.lm, NOSE.l), r = pt(f.lm, NOSE.r), s = pt(f.lm, NOSE.base);
  const top = mid(b, t, 0.35)[1], bottom = Math.max(s[1], l[1], r[1]) + 0.5;
  polygon(o.clear, f.W, f.H, [[l[0], top], [r[0], top], [r[0], bottom], [l[0], bottom]]);
}

const nose: Variant[] = [
  { name: 'nostrils', draw: (f, o) => {
    for (const s of [NOSE.l, NOSE.r]) {
      const [x, y] = mid(pt(f.lm, s), pt(f.lm, NOSE.base), 0.4);
      if (x >= 0 && y >= 0 && x < f.W && y < f.H) o.ink[Math.floor(y) * f.W + Math.floor(x)] = 1;
    }
  } },
  { name: 'base', draw: (f, o) => { // a short line under the tip
    clearNose(f, o);
    const l = pt(f.lm, NOSE.l), r = pt(f.lm, NOSE.r), y = pt(f.lm, NOSE.base)[1];
    line(o.ink, f.W, f.H, [mid(l, r, 0.25)[0], y], [mid(l, r, 0.75)[0], y]);
  } },
  { name: 'side', draw: (f, o) => { // classic pixel-art "L": one side of the nose and its base
    clearNose(f, o);
    const b = pt(f.lm, NOSE.bridge), t = pt(f.lm, NOSE.tip), l = pt(f.lm, NOSE.l), s = pt(f.lm, NOSE.base);
    const x = mid(l, t, 0.45)[0], top: Pt = [x, mid(b, t, 0.45)[1]], foot: Pt = [x, s[1]];
    line(o.ink, f.W, f.H, top, foot);
    line(o.ink, f.W, f.H, foot, [mid(foot, s, 0.8)[0], s[1]]);
  } },
  { name: 'dot', draw: (f, o) => {
    clearNose(f, o);
    const [x, y] = pt(f.lm, NOSE.base);
    if (x >= 0 && y >= 0 && x < f.W && y < f.H) o.ink[Math.floor(y) * f.W + Math.floor(x)] = 1;
  } },
];

/** Lens outline around c with axes u (along the eye, towards the nose) and v (down); roundness 0 = square, 1 = oval. */
function lens(c: Pt, u: Pt, v: Pt, a: number, b: number, roundness: number): Pt[] {
  const r = Math.min(a, b) * roundness, out: Pt[] = [];
  const corners: [number, number, number][] = [[a - r, b - r, 0], [-(a - r), b - r, 90], [-(a - r), -(b - r), 180], [a - r, -(b - r), 270]];
  for (const [ox, oy, start] of corners)
    for (let k = 0; k <= 3; k++) {
      const t = (start + k * 30) * Math.PI / 180, lx = ox + r * Math.cos(t), ly = oy + r * Math.sin(t);
      out.push([c[0] + u[0] * lx + v[0] * ly, c[1] + u[1] * lx + v[1] * ly]);
    }
  return out;
}

/** Frames from the eye corners; lens interiors cleared; frame cells touching a brow are dropped. */
function frames(shape: { w: number; h: number; round: number; heavyTop?: boolean }): Draw {
  return (f, o) => {
    const n = f.W * f.H, rim = new Uint8Array(n), fill = new Uint8Array(n), inner: Pt[] = [];
    for (const e of EYES) {
      const [ox, oy] = pt(f.lm, e.o), [ix, iy] = pt(f.lm, e.i), eyeW = Math.hypot(ix - ox, iy - oy) || 1;
      const u: Pt = [(ix - ox) / eyeW, (iy - oy) / eyeW];
      let v: Pt = [-u[1], u[0]]; if (v[1] < 0) v = [-v[0], -v[1]];
      const a = eyeW * shape.w, b = eyeW * shape.h, c: Pt = [(ox + ix) / 2 + v[0] * b * 0.2, (oy + iy) / 2 + v[1] * b * 0.2];
      const ring = lens(c, u, v, a, b, shape.round);
      polygon(fill, f.W, f.H, ring);
      polyline(rim, f.W, f.H, ring, true);
      if (shape.heavyTop) polyline(rim, f.W, f.H, ring.filter(q => (q[1] - c[1]) * v[1] + (q[0] - c[0]) * v[0] < -b * 0.5).map(([x, y]): Pt => [x, y + 1]));
      inner.push([c[0] + u[0] * a - v[0] * b * 0.3, c[1] + u[1] * a - v[1] * b * 0.3]);
    }
    line(rim, f.W, f.H, inner[0], inner[1]); // bridge
    const nearBrow = dilate(o.brow, f.W, f.H);
    for (let k = 0; k < n; k++) {
      if (fill[k] && !rim[k]) o.clear[k] = 1;
      if (rim[k] && !nearBrow[k]) o.ink[k] = 1;
    }
  };
}

const glasses: Variant[] = [
  { name: 'rounded', draw: frames({ w: 0.82, h: 0.58, round: 0.55 }) },
  { name: 'round', draw: frames({ w: 0.72, h: 0.66, round: 1 }) },
  { name: 'square', draw: frames({ w: 0.85, h: 0.55, round: 0.12 }) },
  { name: 'browline', draw: frames({ w: 0.82, h: 0.58, round: 0.4, heavyTop: true }) },
];

export const STAMPS: Record<StampKind, Variant[]> = { eyes, brows, mouth, nose, glasses };

/** The variant "auto" picks for this face at this grid size (1-based). */
export function autoVariant(kind: StampKind, f: Face): number {
  const ew = eyeWidth(f), mw = mouthWidth(f);
  switch (kind) {
    case 'eyes': return ew < 3.2 ? 2 : 1;                  // tiny eyes read better as dots
    case 'brows': return 1;
    case 'mouth': return mw >= 5 && mouthOpenness(f) > 0.08 ? 3 : mw < 5 ? 6 : 1; // open smile · tiny · traced
    case 'nose': return ew < 3.2 ? 4 : 1;
    case 'glasses': return 1;
  }
}

export const resolve = (kind: StampKind, chosen: number, f: Face) => (chosen > 0 ? Math.min(chosen, STAMPS[kind].length) : autoVariant(kind, f));

/** Draw the enabled features; returns cells to clear, to ink, and the brow cells (part of ink). */
export function drawStamps(f: Face, enabled: Record<StampKind, boolean>, chosen: Stamps): Out {
  const n = f.W * f.H, o: Out = { clear: new Uint8Array(n), ink: new Uint8Array(n), brow: new Uint8Array(n) };
  // Brows first: glasses avoid them. Eye sockets are cleared before anything is inked.
  for (const kind of ['brows', 'eyes', 'glasses', 'mouth', 'nose'] as StampKind[]) {
    if (!enabled[kind]) continue;
    const draw = STAMPS[kind][resolve(kind, chosen[kind], f) - 1].draw;
    if (kind === 'glasses' && !enabled.eyes) { // without redrawn eyes, keep the photo's eyes inside the lenses
      const t: Out = { clear: new Uint8Array(n), ink: o.ink, brow: o.brow };
      draw(f, t);
    } else draw(f, o);
  }
  for (let i = 0; i < n; i++) o.ink[i] |= o.brow[i];
  return o;
}

/** Grid box around each feature, for tapping a feature to cycle it. */
export function hitBoxes(f: Face): Record<StampKind, { x0: number; y0: number; x1: number; y1: number }> {
  const box = (p: Pt[], pad: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const ew = eyeWidth(f), eyeP = EYES.flatMap(e => pts(f.lm, [...e.up, ...e.lo]));
  const e = box(eyeP, 0.6);
  return {
    eyes: e,
    brows: box(BROWS.flatMap(b => pts(f.lm, [...b.lo, ...b.up])), 0.8),
    mouth: box(lipsOuter(f), 0.8),
    nose: box(pts(f.lm, [NOSE.tip, NOSE.base, NOSE.l, NOSE.r]), 0.6),
    glasses: { x0: e.x0 - ew * 0.4, y0: e.y0 - ew * 0.3, x1: e.x1 + ew * 0.4, y1: e.y1 + ew * 0.4 },
  };
}
