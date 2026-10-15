// Procedural feature stamps (SPEC: designed eyes, brows, mouths, noses, glasses; auto-placed from the face points,
// picked by name). Each variant draws onto `clear` (cells forced to paper) and `ink` (cells forced to ink) in grid
// coordinates, sized from the face points, so a 32-wide eye and a 128-wide eye come out different. The library was
// built as ~15 candidates per feature and culled by eye on the team's photos (see SPEC "Stamps").
import { pt, pts, type Pt } from './landmarks';
import { dilate, disk, line, polygon, polyline, type Mask } from './raster';
import type { Lens } from './types';

export type StampKind = 'eyes' | 'brows' | 'mouth' | 'nose' | 'glasses';
export const STAMP_KINDS: StampKind[] = ['eyes', 'brows', 'mouth', 'nose', 'glasses'];
/** Chosen variant per feature by name; '' = auto (the style decides). */
export type Stamps = Record<StampKind, string>;
export const AUTO_STAMPS: Stamps = { eyes: '', brows: '', mouth: '', nose: '', glasses: '' };

export interface Face {
  lm: Float32Array;     // face points in grid coordinates
  W: number;
  H: number;
  lenses?: Lens[] | null; // measured glasses lenses (grid coordinates), if the frames show all round
  skin?: Mask;          // where temple arms may run (avatar); without it they stop after a short way
}
export interface Out { clear: Mask; ink: Mask; brow: Mask }

// ---------------------------------------------------------------- geometry (MediaPipe face mesh indices)
// Per eye: [outer corner, inner corner, upper lid (outer → inner), lower lid (outer → inner), iris centre, iris ring a, b]
export const EYES = [
  { o: 33, i: 133, up: [33, 246, 161, 160, 159, 158, 157, 173, 133], lo: [33, 7, 163, 144, 145, 153, 154, 155, 133], c: 468, a: 469, b: 471 },
  { o: 263, i: 362, up: [263, 466, 388, 387, 386, 385, 384, 398, 362], lo: [263, 249, 390, 373, 374, 380, 381, 382, 362], c: 473, a: 474, b: 476 },
];
// Per brow: lower edge (outer → inner) and upper edge (outer → inner).
export const BROWS = [
  { lo: [46, 53, 52, 65, 55], up: [70, 63, 105, 66, 107] },
  { lo: [276, 283, 282, 295, 285], up: [300, 293, 334, 296, 336] },
];
export const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const LIPS_INNER_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
export const LIPS_INNER_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
export const NOSE = { tip: 1, base: 2, bridge: 6, l: 98, r: 327 };

export const mid = (a: Pt, b: Pt, t = 0.5): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const eyeWidth = (f: Face) => EYES.reduce((s, e) => s + dist(pt(f.lm, e.o), pt(f.lm, e.i)), 0) / 2;
export const eyeDistance = (f: Face) => dist(pt(f.lm, EYES[0].c), pt(f.lm, EYES[1].c));
export const mouthWidth = (f: Face) => dist(pt(f.lm, 61), pt(f.lm, 291));
/** Inner-lip gap relative to mouth width: > ~0.08 is an open mouth (smile with teeth). */
export const mouthOpenness = (f: Face) => dist(pt(f.lm, 13), pt(f.lm, 14)) / Math.max(mouthWidth(f), 1e-6);
/** Lid gap relative to eye width: < 0.2 reads as narrowed (smiling) eyes. */
export const eyeOpenness = (f: Face) => EYES.reduce((s, e) => s + dist(pt(f.lm, e.up[4]), pt(f.lm, e.lo[4])) / Math.max(dist(pt(f.lm, e.o), pt(f.lm, e.i)), 1e-6), 0) / 2;
const mouthY = (f: Face) => (pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2;

const set = (m: Mask, f: Face, x: number, y: number) => { if (x >= 0 && y >= 0 && x < f.W && y < f.H) m[y * f.W + x] = 1; };
/** A w × h block of cells whose centre is nearest to c. */
const block = (m: Mask, f: Face, c: Pt, w: number, h = w) => {
  const x0 = Math.round(c[0] - w / 2), y0 = Math.round(c[1] - h / 2);
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(m, f, x0 + dx, y0 + dy);
  return [x0, y0] as const;
};
const shift = (p: Pt[], dx: number, dy: number) => p.map(([x, y]): Pt => [x + dx, y + dy]);
/** A curve between a and b bowing by `bow` cells (positive = down) in the middle. */
const arc = (a: Pt, b: Pt, bow: number, n = 12): Pt[] => Array.from({ length: n + 1 }, (_, k) => { const t = k / n, p = mid(a, b, t); return [p[0], p[1] + bow * Math.sin(Math.PI * t)]; });

// ---------------------------------------------------------------- variants
type Draw = (f: Face, o: Out) => void;
/**
 * hidden: drawn by a style's "auto" (photo-traced shapes) but not offered in the panel.
 * oneSided: a design that differs left and right on purpose (a wink, an "L" nose) — never mirrored.
 */
export interface Variant { name: string; draw: Draw; hidden?: boolean; oneSided?: boolean }
const v = (name: string, draw: Draw, hidden = false): Variant => ({ name, draw, hidden });
const one = (x: Variant): Variant => ({ ...x, oneSided: true });

// eyes ---------------------------------------------------------------------------------------------
export function eyeSocket(f: Face, o: Out) {
  for (const e of EYES) {
    const c = [...e.up, ...e.lo.slice(1, -1).reverse()], p = pts(f.lm, c);
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
    polygon(o.clear, f.W, f.H, p.map(([x, y]): Pt => [cx + (x - cx) * 1.35, cy + (y - cy) * 1.35 * 1.6]));
  }
}
const irisRadius = (f: Face, e: (typeof EYES)[number]) => dist(pt(f.lm, e.a), pt(f.lm, e.b)) / 2;
/** Pupil side in cells: 1 for tiny eyes, 2 from about 50 wide, 3 on big grids. */
export const pupilSize = (f: Face) => { const ew = eyeWidth(f); return ew < 3 ? 1 : ew < 8 ? 2 : 3; };
const eyeLine = (f: Face, e: (typeof EYES)[number]) => (pt(f.lm, e.up[4])[1] + pt(f.lm, e.lo[4])[1]) / 2;
/** Clear both sockets, then draw each eye. */
const eachEye = (draw: (f: Face, o: Out, e: (typeof EYES)[number], left: boolean) => void): Draw => (f, o) => {
  eyeSocket(f, o);
  EYES.forEach((e, k) => draw(f, o, e, k === 0));
};
const lid = (f: Face, e: (typeof EYES)[number]) => pts(f.lm, e.up.slice(1, -1));

const eyes: Variant[] = [
  v('pupils', eachEye((f, o, e) => { block(o.ink, f, pt(f.lm, e.c), pupilSize(f)); })),
  v('dots', eachEye((f, o, e) => { const [x, y] = pt(f.lm, e.c); disk(o.ink, f.W, f.H, x, y, Math.max(0.6, Math.min(2.2, irisRadius(f, e) * 0.85))); })),
  v('small', eachEye((f, o, e) => { block(o.ink, f, pt(f.lm, e.c), Math.max(1, pupilSize(f) - 1)); })),
  v('lids', eachEye((f, o, e) => { polyline(o.ink, f.W, f.H, lid(f, e)); block(o.ink, f, pt(f.lm, e.c), pupilSize(f)); })),
  v('lashes', eachEye((f, o, e) => { // lid, pupil and a flick at the outer corner
    const l = lid(f, e); polyline(o.ink, f.W, f.H, l); block(o.ink, f, pt(f.lm, e.c), pupilSize(f));
    const [x, y] = pt(f.lm, e.o), dx = Math.sign(x - pt(f.lm, e.i)[0]);
    line(o.ink, f.W, f.H, l[0], [x + dx * 0.6, y - 1.2]);
  })),
  v('almond', eachEye((f, o, e) => { // the team's eye: a crease, a lid row corner to corner, under it the corners and the pupil
    const [x, y] = pt(f.lm, e.c), ox = pt(f.lm, e.o)[0], ix = pt(f.lm, e.i)[0], s = pupilSize(f);
    const x0 = Math.round(Math.min(ox, ix)), x1 = Math.round(Math.max(ox, ix)) - 1, top = Math.round(y - 0.5) - 1;
    for (let cx = x0; cx <= x1; cx++) set(o.ink, f, cx, top);
    block(o.ink, f, [x, top - 0.5], Math.max(2, s), 1);
    set(o.ink, f, x0, top + 1); set(o.ink, f, x1, top + 1);
    block(o.ink, f, [x, top + 1 + s / 2], s, s > 1 ? s - 1 : 1);
  })),
  v('dashes', eachEye((f, o, e) => { const a = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.12), b = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.88), y = eyeLine(f, e); line(o.ink, f.W, f.H, [a[0], y], [b[0], y]); })),
  v('happy', eachEye((f, o, e) => { // closed, smiling: ∩
    const y = eyeLine(f, e) + 0.4, a = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.08), b = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.92);
    polyline(o.ink, f.W, f.H, arc([a[0], y], [b[0], y], -Math.max(0.9, eyeWidth(f) * 0.22)));
  })),
  v('sleepy', eachEye((f, o, e) => { // closed, relaxed: ∪
    const y = eyeLine(f, e) - 0.3, a = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.08), b = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.92);
    polyline(o.ink, f.W, f.H, arc([a[0], y], [b[0], y], Math.max(0.9, eyeWidth(f) * 0.2)));
  })),
  v('soft lids', eachEye((f, o, e) => { polyline(o.ink, f.W, f.H, lid(f, e)); block(o.ink, f, pt(f.lm, e.c), Math.max(1, pupilSize(f) - 1)); })),
  v('bar', eachEye((f, o, e) => { const s = pupilSize(f); block(o.ink, f, pt(f.lm, e.c), s + 1, Math.max(1, s - 1)); })),
  v('winged', eachEye((f, o, e) => { // closed, with a lash flick at the outer corner
    const a = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.12), b = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.88), y = eyeLine(f, e), dx = Math.sign(a[0] - b[0]);
    line(o.ink, f.W, f.H, [a[0], y], [b[0], y]); line(o.ink, f.W, f.H, [a[0] + dx, y - 1], [a[0] + dx, y - 1]);
  })),
  one(v('glance left', eachEye((f, o, e) => { const [x, y] = pt(f.lm, e.c); block(o.ink, f, [x - Math.max(1, eyeWidth(f) * 0.2), y], pupilSize(f)); }))),
  one(v('glance right', eachEye((f, o, e) => { const [x, y] = pt(f.lm, e.c); block(o.ink, f, [x + Math.max(1, eyeWidth(f) * 0.2), y], pupilSize(f)); }))),
  one(v('wink', eachEye((f, o, e, left) => { // the picture's left eye open, the right one closed and smiling
    if (left) { block(o.ink, f, pt(f.lm, e.c), pupilSize(f)); return; }
    const y = eyeLine(f, e) + 0.4, a = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.08), b = mid(pt(f.lm, e.o), pt(f.lm, e.i), 0.92);
    polyline(o.ink, f.W, f.H, arc([a[0], y], [b[0], y], -Math.max(0.9, eyeWidth(f) * 0.22)));
  }))),
  v('traced', eachEye((f, o, e) => { polyline(o.ink, f.W, f.H, pts(f.lm, e.up)); const [x, y] = pt(f.lm, e.c); disk(o.ink, f.W, f.H, x, y, Math.max(irisRadius(f, e), 0.75)); }), true),
];

// brows ----------------------------------------------------------------------------------------------
/** Centre line of a brow, outer → inner. */
const browCentre = (f: Face, b: (typeof BROWS)[number]) => { const up = pts(f.lm, b.up); return pts(f.lm, b.lo).map((p, k) => mid(p, up[k])); };
const browPolygon = (f: Face, b: (typeof BROWS)[number]) => [...pts(f.lm, b.lo), ...pts(f.lm, b.up).reverse()];
/** Draw each brow from its centre line: shape it, then one or two rows (bold adds the row above). */
const eachBrow = (shape: (c: Pt[], f: Face) => Pt[], bold = false): Draw => (f, o) => {
  for (const b of BROWS) {
    const p = shape(browCentre(f, b), f);
    polyline(o.brow, f.W, f.H, p);
    if (bold) polyline(o.brow, f.W, f.H, shift(p, 0, -1));
  }
};
const ends = (c: Pt[]): Pt[] => [c[0], c[c.length - 1]];
const arched = (c: Pt[], f: Face) => { const h = Math.max(0.8, eyeWidth(f) * 0.18); return c.map(([x, y], k): Pt => [x, y - h * Math.sin(Math.PI * Math.min(1, (k + 0.5) / 3.2))]); };

const brows: Variant[] = [
  v('thin', eachBrow(c => c)),
  v('bold', eachBrow(c => c, true)),
  v('arched', eachBrow(arched)),
  v('short', eachBrow(c => c.slice(2))),
  v('raised', eachBrow(c => shift(c, 0, -1))),
  v('tapered', (f, o) => { // two rows on the inner half, one on the outer
    for (const b of BROWS) { const c = browCentre(f, b); polyline(o.brow, f.W, f.H, c); polyline(o.brow, f.W, f.H, shift(c.slice(2), 0, -1)); }
  }),
  v('high arched', eachBrow((c, f) => shift(arched(c, f), 0, -1))),
  v('raised straight', eachBrow(c => shift(ends(c), 0, -1))),
  v('raised bold', eachBrow(c => shift(c, 0, -1), true)),
  v('short raised', eachBrow(c => shift(c.slice(2), 0, -1))),
  v('long', eachBrow(c => { const [o, i] = ends(c); return [mid(o, i, -0.15), ...c, mid(o, i, 1.1)]; })),
  v('traced', (f, o) => { for (const b of BROWS) polygon(o.brow, f.W, f.H, browPolygon(f, b)); }, true),
];

// mouth ----------------------------------------------------------------------------------------------
const lipsOuter = (f: Face) => pts(f.lm, LIPS_OUTER);
/** Designed mouths replace the photo's lips: clear them first. */
const clearLips = (f: Face, o: Out) => polygon(o.clear, f.W, f.H, lipsOuter(f));
const corners = (f: Face) => [pt(f.lm, 61), pt(f.lm, 291)] as const;
/** Corner to corner (t0 … t1 of the width) on the mouth line, bowing `bow` cells (positive = smile). */
const mouthCurve = (f: Face, t0: number, t1: number, bow: number): Pt[] => {
  const [l, r] = corners(f), y = mouthY(f), a = mid(l, r, t0), b = mid(l, r, t1);
  return arc([a[0], y - (bow > 0 ? 0.35 : -0.35)], [b[0], y - (bow > 0 ? 0.35 : -0.35)], bow);
};
const mouthDraw = (draw: (f: Face, o: Out) => void): Draw => (f, o) => { clearLips(f, o); draw(f, o); };
const smileDepth = (f: Face, k: number) => Math.max(0.8, mouthWidth(f) * k);

/** Open mouth: an oval ring corner to corner, as tall as the lips are apart but at least three rows (paper teeth inside). */
function openMouth(f: Face, o: Out) {
  const [l, r] = corners(f), c = mid(l, r), a = mouthWidth(f) / 2, b = Math.max(1.3, dist(pt(f.lm, 13), pt(f.lm, 14)) / 2 + 0.6);
  const cy = mouthY(f), shape: Pt[] = [], fill = new Uint8Array(f.W * f.H);
  for (let k = 0; k < 24; k++) { const t = k * Math.PI / 12; shape.push([c[0] + a * Math.cos(t), cy + b * Math.sin(t)]); }
  polygon(fill, f.W, f.H, shape);
  for (let i = 0; i < fill.length; i++) if (fill[i]) o.clear[i] = 1;
  polyline(o.ink, f.W, f.H, shape, true);
}
/** D-shaped grin: a straight top from corner to corner, a round bottom; paper inside (teeth) or ink (laugh). */
function grin(f: Face, o: Out, filled: boolean) {
  const [l, r] = corners(f), y = mouthY(f) - 0.5, depth = Math.max(1.6, mouthWidth(f) * 0.3);
  const shape = [...arc([l[0], y], [r[0], y], depth, 16)], m = new Uint8Array(f.W * f.H);
  polygon(m, f.W, f.H, shape);
  if (!filled) { polyline(o.ink, f.W, f.H, shape, true); return; }
  for (let i = 0; i < m.length; i++) if (m[i]) o.ink[i] = 1;
  const top = Math.round(y) + 1; // a row of teeth under the top line
  for (let x = Math.round(l[0]) + 1; x <= Math.round(r[0]) - 2; x++) if (m[top * f.W + x]) { o.ink[top * f.W + x] = 0; o.clear[top * f.W + x] = 1; }
}

const mouth: Variant[] = [
  v('line', mouthDraw((f, o) => { const [l, r] = corners(f), y = mouthY(f); line(o.ink, f.W, f.H, [mid(l, r, 0.1)[0], y], [mid(l, r, 0.9)[0], y]); })),
  v('short', mouthDraw((f, o) => { const [l, r] = corners(f), y = mouthY(f); line(o.ink, f.W, f.H, [mid(l, r, 0.3)[0], y], [mid(l, r, 0.7)[0], y]); })),
  v('smile', mouthDraw((f, o) => polyline(o.ink, f.W, f.H, mouthCurve(f, 0, 1, smileDepth(f, 0.1))))),
  v('wide smile', mouthDraw((f, o) => polyline(o.ink, f.W, f.H, mouthCurve(f, -0.08, 1.08, smileDepth(f, 0.2))))),
  v('small smile', mouthDraw((f, o) => polyline(o.ink, f.W, f.H, mouthCurve(f, 0.2, 0.8, smileDepth(f, 0.07))))),
  v('corners', mouthDraw((f, o) => { // straight, the corners turned up a cell
    const [l, r] = corners(f), y = mouthY(f), a = mid(l, r, 0.18)[0], b = mid(l, r, 0.82)[0];
    line(o.ink, f.W, f.H, [a, y], [b, y]); line(o.ink, f.W, f.H, [a - 1, y - 1], [a - 1, y - 1]); line(o.ink, f.W, f.H, [b + 1, y - 1], [b + 1, y - 1]);
  })),
  v('open', mouthDraw(openMouth)),
  v('grin', mouthDraw((f, o) => grin(f, o, false))),
  v('laugh', mouthDraw((f, o) => grin(f, o, true))),
  one(v('smirk', mouthDraw((f, o) => { const [l, r] = corners(f), y = mouthY(f); polyline(o.ink, f.W, f.H, [[mid(l, r, 0.15)[0], y], [mid(l, r, 0.65)[0], y], [mid(l, r, 0.92)[0], y - 1.2]]); }))),
  v('flat smile', mouthDraw((f, o) => { // straight in the middle, the last fifth curving up
    const [l, r] = corners(f), y = mouthY(f), a = mid(l, r, 0.08)[0], b = mid(l, r, 0.92)[0], w = b - a;
    polyline(o.ink, f.W, f.H, [[a, y - 1], [a + w * 0.18, y], [b - w * 0.18, y], [b, y - 1]]);
  })),
  v('big grin', mouthDraw((f, o) => { // a wider, deeper D
    const [l, r] = corners(f), y = mouthY(f) - 0.6, shape = arc([l[0] - 0.8, y], [r[0] + 0.8, y], Math.max(2, mouthWidth(f) * 0.38), 16);
    polyline(o.ink, f.W, f.H, shape, true);
  })),
  v('w', mouthDraw((f, o) => { // cat mouth
    const [l, r] = corners(f), y = mouthY(f) - 0.4, d = Math.max(0.9, mouthWidth(f) * 0.1);
    polyline(o.ink, f.W, f.H, [[mid(l, r, 0.15)[0], y], [mid(l, r, 0.33)[0], y + d], [mid(l, r, 0.5)[0], y], [mid(l, r, 0.67)[0], y + d], [mid(l, r, 0.85)[0], y]]);
  })),
  v('traced', (f, o) => polyline(o.ink, f.W, f.H, pts(f.lm, LIPS_INNER_UP)), true),
];

// nose -----------------------------------------------------------------------------------------------
const nosePts = (f: Face) => ({ b: pt(f.lm, NOSE.bridge), t: pt(f.lm, NOSE.tip), l: pt(f.lm, NOSE.l), r: pt(f.lm, NOSE.r), s: pt(f.lm, NOSE.base) });
/** One side of the nose and its base, an "L" (side −1 = the picture's left, +1 = right); `top` = how high it starts. */
const ell = (side: number, top = 0.55): Draw => (f, o) => {
  const { b, t, l, r, s } = nosePts(f), x = mid(side < 0 ? l : r, t, 0.35)[0], foot: Pt = [x, s[1] - 0.3];
  line(o.ink, f.W, f.H, [x, Math.min(mid(b, t, top)[1], foot[1] - 1)], foot);
  line(o.ink, f.W, f.H, foot, [mid(foot, s, 0.7)[0], foot[1]]);
};
const nose: Variant[] = [
  one(v('L', ell(-1))),
  one(v('J', ell(1))),
  one(v('short L', ell(-1, 0.85))),
  one(v('short J', ell(1, 0.85))),
  v('dot', (f, o) => { const [x, y] = pt(f.lm, NOSE.base); set(o.ink, f, Math.floor(x), Math.floor(y)); }),
  v('nostrils', (f, o) => { for (const s of [NOSE.l, NOSE.r]) { const [x, y] = mid(pt(f.lm, s), pt(f.lm, NOSE.base), 0.4); set(o.ink, f, Math.floor(x), Math.floor(y)); } }),
  v('base', (f, o) => { const { l, r, s } = nosePts(f); line(o.ink, f.W, f.H, [mid(l, r, 0.3)[0], s[1]], [mid(l, r, 0.7)[0], s[1]]); }),
  v('bridge', (f, o) => { const { b, t, l, s } = nosePts(f), x = mid(l, t, 0.35)[0]; line(o.ink, f.W, f.H, [x, mid(b, t, 0.25)[1]], [x, s[1] - 0.3]); }),
  v('v', (f, o) => { const [x, y] = pt(f.lm, NOSE.base); set(o.ink, f, Math.floor(x) - 1, Math.floor(y) - 1); set(o.ink, f, Math.floor(x), Math.floor(y)); set(o.ink, f, Math.floor(x) + 1, Math.floor(y) - 1); }),
  one(v('slash', (f, o) => { const { t, l, s: b } = nosePts(f); line(o.ink, f.W, f.H, [mid(l, t, 0.5)[0] + 0.5, t[1] - 1.2], [mid(l, t, 0.5)[0] - 0.6, b[1] - 0.2]); })),
  one(v('curve', (f, o) => { // the side of the nostril as a small "("
    const { t, l, s: b } = nosePts(f), x = mid(l, t, 0.45)[0];
    polyline(o.ink, f.W, f.H, [[x + 0.6, t[1] - 1], [x - 0.4, (t[1] + b[1]) / 2], [x + 0.6, b[1] + 0.2]]);
  })),
];

// glasses --------------------------------------------------------------------------------------------
interface LensSpec {
  nTop: number; nBot: number; // superellipse exponents for the upper / lower half: 2 = round, ~10 = square
  aspect: number;             // height / width when the lenses aren't measured
  scale?: number;             // size against the measured (or eye-based) lens
  cat?: number;               // outer top corner swept up (share of the half height)
  drop?: number;              // aviator: outer bottom dropped, inner bottom raised
  flare?: number;             // wayfarer: top wider than the bottom
  heavyTop?: boolean;         // a second row on the top rim
}

/** Lens outline in the eye's frame: x along u (outer −, inner +), y along v (down +). */
function lensShape(s: LensSpec, a: number, b: number): Pt[] {
  const out: Pt[] = [], N = 40;
  for (let k = 0; k < N; k++) {
    const t = 2 * Math.PI * k / N, c = Math.cos(t), sn = Math.sin(t), n = sn < 0 ? s.nTop : s.nBot;
    let x = a * Math.sign(c) * Math.abs(c) ** (2 / n), y = b * Math.sign(sn) * Math.abs(sn) ** (2 / n);
    if (s.flare) x *= 1 - s.flare * y / b;
    if (s.cat && y < 0) y -= s.cat * b * Math.max(0, -x / a) ** 2;
    if (s.drop && y > 0) y += s.drop * b * (-x / a) * (y / b);
    out.push([x, y]);
  }
  return out;
}

/** Continuous one-cell rims, cleared lenses, a bridge when they don't touch, short temple arms. */
const frames = (spec: LensSpec): Draw => (f, o) => {
  const n = f.W * f.H, rim = new Uint8Array(n), fill = new Uint8Array(n), d = eyeDistance(f), inner: Pt[] = [];
  EYES.forEach((e, k) => {
    const [ox, oy] = pt(f.lm, e.o), [ix, iy] = pt(f.lm, e.i), ew = Math.hypot(ix - ox, iy - oy) || 1;
    const u: Pt = [(ix - ox) / ew, (iy - oy) / ew];
    let vv: Pt = [-u[1], u[0]]; if (vv[1] < 0) vv = [-vv[0], -vv[1]];
    const m = f.lenses?.[k]; // measured in the same order as EYES (iris 468, 473)
    const sc = spec.scale ?? 1, a = (m ? m.a : d * 0.41) * sc, b = (m ? m.b : d * 0.41 * spec.aspect) * sc;
    const c: Pt = m ? m.c : [(ox + ix) / 2 + vv[0] * 0.3, (oy + iy) / 2 + vv[1] * 0.3];
    const toGrid = (p: Pt[]) => p.map(([x, y]): Pt => [c[0] + u[0] * x + vv[0] * y, c[1] + u[1] * x + vv[1] * y]);
    const shape = lensShape(spec, a, b), ring = toGrid(shape);
    polygon(fill, f.W, f.H, ring);
    polyline(rim, f.W, f.H, ring, true);
    if (spec.heavyTop) polyline(rim, f.W, f.H, toGrid(shape.filter(([, y]) => y < -b * 0.55).sort((p, q) => p[0] - q[0]).map(([x, y]): Pt => [x, y + 1])));
    // bridge end: the innermost rim point in the upper part of the lens
    const top = shape.filter(([, y]) => y < -b * 0.1 && y > -b * 0.75).sort((p, q) => q[0] - p[0])[0] ?? [a, -b * 0.35];
    inner.push(toGrid([top])[0]);
    // temple arm: from the outer edge, level with the lens top third, outwards across the skin (or a short way)
    const start = toGrid([[-a, -b * 0.45]])[0], y = Math.floor(start[1]), dir = -Math.sign(u[0]) || 1, len = Math.ceil(f.skin ? d * 0.6 : d * 0.25);
    for (let x = Math.floor(start[0]) + dir, s = 0; s < len; x += dir, s++) {
      if (x < 0 || x >= f.W || y < 0 || y >= f.H || (f.skin && !f.skin[y * f.W + x])) break;
      rim[y * f.W + x] = 1;
    }
  });
  if (Math.abs(inner[1][0] - inner[0][0]) >= 1.5) line(rim, f.W, f.H, inner[0], inner[1]);
  for (let k = 0; k < n; k++) {
    if (fill[k] && !rim[k]) o.clear[k] = 1;
    if (rim[k]) o.ink[k] = 1;
  }
};

const glasses: Variant[] = [
  v('rounded', frames({ nTop: 4, nBot: 4, aspect: 0.85 })),
  v('round', frames({ nTop: 2.2, nBot: 2.2, aspect: 1 })),
  v('oval', frames({ nTop: 2.2, nBot: 2.2, aspect: 0.72 })),
  v('square', frames({ nTop: 10, nBot: 10, aspect: 0.8 })),
  v('pantos', frames({ nTop: 7, nBot: 2.2, aspect: 0.95 })),
  v('cat-eye', frames({ nTop: 3.5, nBot: 2.6, aspect: 0.75, cat: 0.45 })),
  v('aviator', frames({ nTop: 5, nBot: 2.4, aspect: 0.9, drop: 0.25 })),
  v('wayfarer', frames({ nTop: 8, nBot: 4, aspect: 0.75, flare: 0.12 })),
  v('browline', frames({ nTop: 5, nBot: 3, aspect: 0.8, heavyTop: true })),
  v('small round', frames({ nTop: 2.2, nBot: 2.2, aspect: 1, scale: 0.75 })),
  v('narrow', frames({ nTop: 6, nBot: 4, aspect: 0.55 })),
  v('tall', frames({ nTop: 3, nBot: 2.4, aspect: 1.12 })),
];

const ALL: Record<StampKind, Variant[]> = { eyes, brows, mouth, nose, glasses };
/** What the panel offers per feature (the photo-traced shapes stay internal to the photo styles' auto). */
export const STAMPS: Record<StampKind, Variant[]> = Object.fromEntries(STAMP_KINDS.map(k => [k, ALL[k].filter(x => !x.hidden)])) as Record<StampKind, Variant[]>;
export const variant = (kind: StampKind, name: string) => ALL[kind].find(x => x.name === name) ?? null;

/** Measured lenses → the glasses shape that matches them best. */
export function lensName(lenses: Lens[] | null | undefined): string {
  if (!lenses) return 'rounded';
  const l = lenses[0], round = l.roundTop && l.roundBottom;
  return round ? (l.a > l.b * 1.25 ? 'oval' : 'round') : l.roundBottom ? 'pantos' : l.roundTop ? 'rounded' : 'square';
}

/** What "auto" draws in the photo styles at this face and grid size. */
export function autoVariant(kind: StampKind, f: Face): string {
  const ew = eyeWidth(f), mw = mouthWidth(f);
  switch (kind) {
    case 'eyes': return ew < 3.2 ? 'dots' : 'traced';                   // tiny eyes read better as dots
    case 'brows': return 'traced';
    case 'mouth': return mw >= 5 && mouthOpenness(f) > 0.08 ? 'grin' : mw < 5 ? 'short' : 'traced';
    case 'nose': return ew < 3.2 ? 'dot' : 'nostrils';
    case 'glasses': return lensName(f.lenses);
  }
}

/**
 * Moustache / beard: keep mouth and nose readable inside the facial hair with 1-cell paper gaps — above and
 * below the mouth, and a line just under the nose base (otherwise nose shadow, moustache and mouth merge).
 */
function separate(f: Face, mouthInk: Mask, o: Out) {
  const { W, H } = f;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!mouthInk[y * W + x]) continue;
      for (const yy of [y - 1, y + 1]) if (yy >= 0 && yy < H && !mouthInk[yy * W + x]) o.clear[yy * W + x] = 1;
    }
  const l = pt(f.lm, NOSE.l), r = pt(f.lm, NOSE.r), y = pt(f.lm, NOSE.base)[1] + 0.75;
  line(o.clear, W, H, [l[0], y], [r[0], y]);
}

export interface Drawn extends Out { mouth: Mask }

// ---------------------------------------------------------------- symmetry (the avatar's clean base)
// Mirror pairs among the feature points: MediaPipe's two halves, listed in the same order on both sides.
const PAIRS: [number, number][] = [
  ...EYES[0].up.map((k, j): [number, number] => [k, EYES[1].up[j]]), ...EYES[0].lo.map((k, j): [number, number] => [k, EYES[1].lo[j]]),
  [468, 473],
  ...BROWS[0].lo.map((k, j): [number, number] => [k, BROWS[1].lo[j]]), ...BROWS[0].up.map((k, j): [number, number] => [k, BROWS[1].up[j]]),
  [61, 291], [146, 375], [91, 321], [181, 405], [84, 314], [37, 267], [39, 269], [40, 270], [185, 409],
  [78, 308], [191, 415], [80, 310], [81, 311], [82, 312], [95, 324], [88, 318], [178, 402], [87, 317], [98, 327],
];
const CENTRE = [0, 13, 14, 17, 1, 2, 6, 152];

/** Eyes at least this wide (cells) in the avatar: small faces get their features drawn larger, like the team's portraits. */
const MIN_EYE = 5;

/**
 * The face made symmetric for drawing: turned upright (eye line level), then every mirror pair of feature points
 * moved to the average of the two sides about a vertical axis through the face, snapped to a half cell so the
 * grid mirrors exactly (cell x ↔ axis2 − 1 − x). On small grids the eyes (with their brows) and the mouth are
 * scaled up about their own centres until the eyes are MIN_EYE cells wide (at most 1.35×), so they read the way
 * the team draws them. Measured lenses are evened out the same way.
 */
export function symmetricFace(f: Face): { face: Face; axis2: number } {
  const lm = Float32Array.from(f.lm), [lx, ly] = pt(f.lm, 468), [rx, ry] = pt(f.lm, 473);
  const ox = (lx + rx) / 2, oy = (ly + ry) / 2, a = -Math.atan2(ry - ly, rx - lx), cos = Math.cos(a), sin = Math.sin(a);
  for (let i = 0; i < lm.length; i += 2) {
    const x = f.lm[i] - ox, y = f.lm[i + 1] - oy;
    lm[i] = ox + x * cos - y * sin; lm[i + 1] = oy + x * sin + y * cos;
  }
  const mx = (k: number) => lm[2 * k];
  const cx = ((mx(468) + mx(473)) / 2 + (mx(61) + mx(291)) / 2) / 2, axis2 = Math.round(2 * cx), c = axis2 / 2;
  for (const [l, r] of PAIRS) {
    const d = (lm[2 * r] - lm[2 * l]) / 2, y = (lm[2 * l + 1] + lm[2 * r + 1]) / 2;
    lm[2 * l] = c - d; lm[2 * r] = c + d; lm[2 * l + 1] = lm[2 * r + 1] = y;
  }
  for (const k of CENTRE) lm[2 * k] = c;
  // Iris rings: round, the average size of the two, around each (now symmetric) centre.
  const ir = (dist(pt(f.lm, 469), pt(f.lm, 471)) + dist(pt(f.lm, 474), pt(f.lm, 476))) / 4;
  for (const [ci, ring] of [[468, [469, 470, 471, 472]], [473, [474, 475, 476, 477]]] as const)
    ring.forEach((k, j) => { const t = j * Math.PI / 2; lm[2 * k] = lm[2 * ci] + ir * Math.cos(t); lm[2 * k + 1] = lm[2 * ci + 1] - ir * Math.sin(t); });
  // Emphasis on small grids.
  const ew = eyeWidth({ ...f, lm }), k = Math.min(1.35, Math.max(1, MIN_EYE / Math.max(ew, 1e-6)));
  if (k > 1) {
    const grow = (idx: number[], [cx0, cy0]: Pt, g: number) => { for (const i of idx) { lm[2 * i] = cx0 + (lm[2 * i] - cx0) * g; lm[2 * i + 1] = cy0 + (lm[2 * i + 1] - cy0) * g; } };
    EYES.forEach((e, j) => grow([...new Set([...e.up, ...e.lo, e.c, e.a, e.b, ...[469, 470, 471, 472].map(i => i + 5 * j), ...BROWS[j].lo, ...BROWS[j].up])], pt(lm, e.c), k));
    const mc = mid(pt(lm, 61), pt(lm, 291));
    grow([...new Set([...LIPS_OUTER, ...LIPS_INNER_UP, ...LIPS_INNER_LO])], mc, Math.min(1.2, k));
  }
  let lenses = f.lenses;
  if (lenses) {
    const [p, q] = lenses, d = (q.c[0] - p.c[0]) / 2, y = (p.c[1] + q.c[1]) / 2, A = (p.a + q.a) / 2, B = (p.b + q.b) / 2;
    lenses = [{ ...p, c: [c - d, y], a: A, b: B }, { ...q, c: [c + d, y], a: A, b: B }];
  }
  return { face: { ...f, lm, lenses }, axis2 };
}

/** Copy the left half of a mask onto the right across the axis (cell x ↔ axis2 − 1 − x). */
export function mirrorLeft(m: Mask, W: number, H: number, axis2: number) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const xm = axis2 - 1 - x;
      if (xm > x && xm < W) m[y * W + xm] = m[y * W + x];
      else if (xm > x) continue;
      else if (xm < 0) m[y * W + x] = 0; // right of the axis with no left partner on the grid
    }
}

/**
 * Draw the enabled features: the chosen variant per feature, or what `auto` names ('' = nothing). Each feature
 * draws on its own layer: eyes clear their sockets, glasses their lenses (only when the eyes are redrawn). Glasses
 * rims stay continuous: a brow that would touch a rim moves up (up to three rows) to sit just above it, as in the
 * team's portraits, and is left out only when there is no room. With `axis2`, every feature is mirrored left to
 * right — exactly symmetric — except one-sided designs (a wink, a smirk, an "L" nose), which keep their shape.
 */
export function drawStamps(f: Face, enabled: Record<StampKind, boolean>, chosen: Stamps, auto: (kind: StampKind) => string, facialHair = false, axis2?: number): Drawn {
  const n = f.W * f.H, part: Partial<Record<StampKind, Out>> = {};
  for (const kind of ['brows', 'eyes', 'glasses', 'mouth', 'nose'] as StampKind[]) {
    if (!enabled[kind]) continue;
    const x = variant(kind, chosen[kind]) ?? variant(kind, auto(kind));
    if (!x) continue;
    const o: Out = { clear: new Uint8Array(n), ink: new Uint8Array(n), brow: new Uint8Array(n) };
    x.draw(f, o);
    if (kind === 'glasses' && !enabled.eyes) o.clear.fill(0); // keep the photo's eyes inside the lenses
    part[kind] = o;
  }
  const rims = part.glasses?.ink, brow = part.brows?.brow;
  if (rims && brow) {
    const near = dilate(rims, f.W, f.H), cx = (pt(f.lm, EYES[0].c)[0] + pt(f.lm, EYES[1].c)[0]) / 2;
    for (const left of [true, false]) {
      const cells: number[] = [];
      for (let i = 0; i < n; i++) if (brow[i] && (i % f.W < cx) === left) cells.push(i);
      const lift = [0, 1, 2, 3].find(k => cells.every(i => i - k * f.W >= 0 && !near[i - k * f.W]));
      for (const i of cells) brow[i] = 0;
      if (lift !== undefined) for (const i of cells) brow[i - lift * f.W] = 1;
    }
  }
  if (axis2 !== undefined)
    for (const [kind, o] of Object.entries(part) as [StampKind, Out][])
      if (!(variant(kind, chosen[kind]) ?? variant(kind, auto(kind)))?.oneSided) for (const m of [o.clear, o.ink, o.brow]) mirrorLeft(m, f.W, f.H, axis2);
  const o: Drawn = { clear: new Uint8Array(n), ink: new Uint8Array(n), brow: brow ?? new Uint8Array(n), mouth: part.mouth?.ink ?? new Uint8Array(n) };
  for (const p of Object.values(part)) for (let i = 0; i < n; i++) { o.clear[i] |= p.clear[i]; o.ink[i] |= p.ink[i] | p.brow[i]; }
  if (facialHair) separate(f, o.mouth, o);
  return o;
}

/** Grid box around each feature, for tapping a feature to cycle it and for the option previews. */
export function hitBoxes(f: Face): Record<StampKind, { x0: number; y0: number; x1: number; y1: number }> {
  const box = (p: Pt[], pad: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const d = eyeDistance(f), eyeP = EYES.flatMap(e => pts(f.lm, [...e.up, ...e.lo]));
  const e = box(eyeP, 0.6);
  return {
    eyes: e,
    brows: box(BROWS.flatMap(b => pts(f.lm, [...b.lo, ...b.up])), 0.8),
    mouth: box(lipsOuter(f), 0.8),
    nose: box(pts(f.lm, [NOSE.tip, NOSE.base, NOSE.l, NOSE.r]), 0.6),
    glasses: { x0: e.x0 - d * 0.3, y0: e.y0 - d * 0.3, x1: e.x1 + d * 0.3, y1: e.y1 + d * 0.3 },
  };
}

/** Stamp choices saved before they were kept by name: 1-based indices into the old lists → today's names. */
const OLD_STAMP_NAMES: Record<StampKind, string[]> = {
  eyes: ['traced', 'dots', 'almond', 'liner', 'dashes'], brows: ['traced', 'thin', 'bold', 'arched'],
  mouth: ['traced', 'smile', 'open', 'lips', 'line', 'short'], nose: ['nostrils', 'base', 'L', 'dot'], glasses: ['rounded', 'round', 'square', 'browline'],
};
export const stampName = (kind: StampKind, saved: unknown): string =>
  typeof saved === 'number' ? (saved > 0 ? OLD_STAMP_NAMES[kind][saved - 1] ?? '' : '') : typeof saved === 'string' && variant(kind, saved) ? saved : '';
