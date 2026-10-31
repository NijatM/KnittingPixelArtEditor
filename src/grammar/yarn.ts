// The yarn: continuous yarn paths built from the machine's loops (machine.ts), for the 3D views. Pure data.
//
// Every loop is drawn as five points: up its first leg to where it passes the loops it was drawn through, across its
// head (which wraps around the legs of the loop that later knitted through it), and down its other leg; then a sinker
// point on the way to the next loop of its yarn, and float or turn points where the yarn passes needles it doesn't
// work. Where a loop's legs pass its parents' heads there is one crossing node, shared by the loop's leg and every
// parent's head: each strand sits at its own offset along the crossing's normal (the new loop's legs on the side it
// was pulled through to: in front on the front bed, behind on the back bed; the parents' heads behind them in stack
// order). Crossings can't change order or pass through each other, because the order is the construction itself.
//
// The same points serve both views: laid out as the machine leaves them (needle pitch across, a fixed course height
// up, held loops on their needles' hooks) for construction playback, and relaxed (relax.ts) for the fabric.
// Units: one needle pitch.
import { NEVER, needlesAt, parentsOf, stackKey, type Topo } from './machine';

export interface YarnParams {
  /** yarn thickness, in needle pitches */
  d: number;
  /** yarn per stitch (loop + sinker), in needle pitches */
  loop: number;
  /** bending stiffness, 0…1 */
  stiff: number;
}
export const YARN_DEFAULTS: YarnParams = { d: 0.28, loop: 3, stiff: 0.5 };
export const YARN_RANGES = { d: [0.12, 0.45], loop: [1.8, 5], stiff: [0, 1] } as const;

/** Course height of the machine layout, before relaxing. */
export const courseOf = (prm: YarnParams) => Math.max(2.2 * prm.d, 0.22 * prm.loop);
const HALF = 0.2; // half the distance between a loop's legs, laid out

export interface YarnSys {
  t: Topo;
  prm: YarnParams;
  c0: number;
  /** nodes */
  nn: number;
  init: Float32Array;            // nn * 3: the machine layout (released, pulled straight)
  bL: Int32Array; bR: Int32Array; hL: Int32Array; hR: Int32Array; top: Int32Array; sink: Int32Array;
  m: Uint8Array;                 // strands around each loop's legs: its parents
  /** points along the yarns: node + offset along a loop's crossing normal */
  np: number;
  ptNode: Int32Array; ptSite: Int32Array; ptOff: Float32Array;
  /** loop * 2 + 1 for a loop's body (legs and head), loop * 2 for what follows it (sinker, floats, turn) */
  ptTag: Float32Array;
  yarnStart: Int32Array;         // first point of each yarn, guides + 1 entries
  loopPt: Int32Array;            // each loop's first body point; its body is loopPt .. loopPt + 4
  nextPt: Int32Array;            // the point after each loop's sinker, -1 at the yarn's end
  /** constraints (relax.ts) */
  lenStart: Int32Array; lenPts: Int32Array;                 // a loop's yarn: body, sinker and the next point
  segA: Int32Array; segB: Int32Array; segMax: Float32Array;  // floats and turns: the yarn can't get longer
  bend: Int32Array;                                          // consecutive point triples
  cA: Int32Array; cB: Int32Array; cMin: Float32Array;         // nodes that can't come closer
  fNode: Int32Array; fSite: Int32Array; fSide: Int8Array;     // a float stays on the gap side of the loop in the hook it passes
  xA: Int32Array; xB: Int32Array; xMax: Float32Array;         // edges: nodes that can't get further apart (cast-on, bind-off)
}

class Grow<T extends Int32Array | Float32Array> {
  n = 0;
  constructor(public a: T) {}
  push(v: number) {
    if (this.n === this.a.length) { const b = new (this.a.constructor as { new(n: number): T })(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  out(): T { return this.a.slice(0, this.n) as T; }
}
const gi = (n = 1024) => new Grow(new Int32Array(n));
const gf = (n = 1024) => new Grow(new Float32Array(n));

export function buildYarn(t: Topo, prm: YarnParams): YarnSys {
  const N = t.n, d = prm.d, c0 = courseOf(prm), zs = 0.6 * d;
  const bL = new Int32Array(N), bR = new Int32Array(N), hL = new Int32Array(N), hR = new Int32Array(N), top = new Int32Array(N), sink = new Int32Array(N);
  const m = new Uint8Array(N);
  let nn = 0;
  for (let i = 0; i < N; i++) { bL[i] = nn++; bR[i] = nn++; top[i] = nn++; sink[i] = nn++; m[i] = t.pStart[i + 1] - t.pStart[i]; }
  for (let i = 0; i < N; i++) {
    const c = t.child[i];
    if (c >= 0) { hL[i] = bL[c]; hR[i] = bR[c]; } else { hL[i] = nn++; hR[i] = nn++; }
  }
  const extra = gf(4096); // positions of the float / turn nodes, made below (nodes nn..)
  const firstExtra = nn;
  const init = new Float32Array((nn + 64) * 3);
  const zOf = (bed: number) => bed * zs;
  const setNode = (a: Float32Array, k: number, x: number, y: number, z: number) => { a[k * 3] = x; a[k * 3 + 1] = y; a[k * 3 + 2] = z; };
  for (let i = 0; i < N; i++) {
    const x = t.needle[i], y = t.row[i] * c0, z = zOf(t.bed[i]);
    setNode(init, bL[i], x - HALF, y, z); setNode(init, bR[i], x + HALF, y, z);
    if (t.child[i] < 0) { const xe = t.endNeedle[i]; setNode(init, hL[i], xe - HALF * 1.1, y + c0, zOf(t.endBed[i])); setNode(init, hR[i], xe + HALF * 1.1, y + c0, zOf(t.endBed[i])); }
  }
  for (let i = 0; i < N; i++) {
    const c = t.child[i];
    if (c >= 0) { // above the crossing it wraps, behind the child's legs
      const sc = t.bed[c];
      setNode(init, top[i], t.needle[c], t.row[c] * c0 + 0.42 * c0, zOf(sc) - sc * d * (0.5 + t.layer[i]));
    } else setNode(init, top[i], t.endNeedle[i], (t.row[i] + 1) * c0 + 0.4 * c0, zOf(t.endBed[i]));
  }

  // the loops on each needle at the start of each row, for floats (which loops a float passes)
  const heldCache = new Map<number, Map<number, number[]>>();
  const heldAt = (r: number) => {
    let h = heldCache.get(r);
    if (h) return h;
    h = new Map();
    const end = r < t.h ? t.cpStart[r + 1] : t.cpLoopStart.length - 1;
    for (let s = t.cpStart[r]; s < end; s++) h.set(stackKey(t.cpBed[s], t.cpNeedle[s]), Array.from(t.cpLoops.subarray(t.cpLoopStart[s], t.cpLoopStart[s + 1])));
    heldCache.set(r, h);
    return h;
  };
  const nodeAt = (k: number): [number, number, number] => (k < firstExtra ? [init[k * 3], init[k * 3 + 1], init[k * 3 + 2]] : [extra.a[(k - firstExtra) * 3], extra.a[(k - firstExtra) * 3 + 1], extra.a[(k - firstExtra) * 3 + 2]]);

  // points
  const pNode = gi(N * 8), pSite = gi(N * 8), pOff = gf(N * 8), pTag = gf(N * 8);
  const loopPt = new Int32Array(N), nextPt = new Int32Array(N).fill(-1);
  const yarnStart = new Int32Array(t.yarn.length + 1);
  const fN = gi(), fS = gi(), fSd = gi();
  const segA = gi(), segB = gi(), segMax = gf();
  const cA = gi(), cB = gi(), cMin = gf();
  const pt = (node: number, site: number, off: number, tag: number) => { pNode.push(node); pSite.push(site); pOff.push(off); pTag.push(tag); return pNode.n - 1; };
  const extraNode = (x: number, y: number, z: number) => { extra.push(x); extra.push(y); extra.push(z); return nn++; };
  const legOff = (i: number) => t.bed[i] * (m[i] / 2) * d;
  const headOff = (i: number) => { const c = t.child[i]; return c < 0 ? 0 : t.bed[c] * (m[c] / 2 - t.layer[i]) * d; };

  for (let g = 0; g < t.yarn.length; g++) {
    yarnStart[g] = pNode.n;
    const ys = t.yarn[g];
    for (let k = 0; k < ys.length; k++) {
      const i = ys[k], dir = t.strokeDir[t.stroke[i]], site = t.child[i] >= 0 ? t.child[i] : i;
      const body = i * 2 + 1, after = i * 2;
      // body, in the direction the yarn travels
      loopPt[i] = pNode.n;
      const [b0, h0, h1, b1] = dir === 1 ? [bL[i], hL[i], hR[i], bR[i]] : [bR[i], hR[i], hL[i], bL[i]];
      pt(b0, i, legOff(i), body); pt(h0, site, headOff(i), body); pt(top[i], i, 0, body); pt(h1, site, headOff(i), body); pt(b1, i, legOff(i), body);
      // sinker
      const j = k + 1 < ys.length ? ys[k + 1] : -1;
      const x = t.needle[i], y = t.row[i] * c0;
      setNode(init, sink[i], x + dir * 0.5, y - 0.35 * c0, zOf(t.bed[i]) - t.bed[i] * d);
      pt(sink[i], i, 0, after);
      if (j < 0) continue;
      // to the next loop: floats over the needles in between, and a turn where the stroke changes
      const xj = t.needle[j], sameStroke = t.stroke[j] === t.stroke[i], rj = t.row[j];
      const floatAt = (fx: number, row: number) => {
        const held = heldAt(row), F = held.get(stackKey(1, fx)) ?? [], B = held.get(stackKey(-1, fx)) ?? [];
        const z = F.length && B.length ? 0 : F.length ? zOf(1) - d : B.length ? zOf(-1) + d : 0;
        const node = extraNode(fx, row * c0 - 0.15 * c0, z);
        // the loop in each bed's hook (the newest on the needle) is the one the float passes
        if (F.length) { fN.push(node); fS.push(F[F.length - 1]); fSd.push(1); }
        if (B.length) { fN.push(node); fS.push(B[B.length - 1]); fSd.push(-1); }
        return pt(node, i, 0, after);
      };
      const prevPt = () => pNode.n - 1;
      // floats keep the length the needles gave them; turns at least what the layout gives them
      const link = (a: number, b: number, max: number, nb = pNode.a[b]) => {
        const pa = nodeAt(pNode.a[a]), pb = nodeAt(nb);
        segA.push(a); segB.push(b); segMax.push(Math.max(max, Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])));
      };
      let last = prevPt(), lastX = x + dir * 0.5;
      const floatsTo = (from: number, to: number, row: number) => { // needles strictly between, in travel order
        const s = Math.sign(to - from);
        for (let fx = from + s; s && fx !== to; fx += s) { const p = floatAt(fx, row); link(last, p, Math.abs(fx - lastX) + 0.05); last = p; lastX = fx; }
      };
      if (sameStroke) floatsTo(x, xj, t.row[i]);
      else {
        const turnX = dir === 1 ? Math.max(x, xj) + 0.6 : Math.min(x, xj) - 0.6;
        const ahead = dir === 1 ? xj > x : xj < x;
        if (ahead) floatsTo(x, xj, t.row[i]);
        const ty = (t.row[i] + rj) / 2 * c0 + 0.1 * c0;
        const turn = pt(extraNode(turnX, ty, (zOf(t.bed[i]) + zOf(t.bed[j])) / 2), i, 0, after);
        link(last, turn, Math.hypot(turnX - lastX, ty - (t.row[i] * c0 - 0.15 * c0)) + 0.1 + Math.max(0, rj - t.row[i] - 1) * c0);
        last = turn; lastX = turnX;
        if (!ahead) floatsTo(Math.round(turnX - dir * 0.6), xj, rj);
      }
      nextPt[i] = pNode.n; // the next loop's first point comes next
      // the last float / turn to the next loop's first point (not made yet: its node)
      if (last !== loopPt[i] + 5) link(last, pNode.n, Math.abs(xj - lastX) + 0.05, t.strokeDir[t.stroke[j]] === 1 ? bL[j] : bR[j]);
    }
    yarnStart[g + 1] = pNode.n;
  }
  // contacts: a loop's two legs; neighbouring loops of one course, with what is wrapped around their legs; and up a
  // wale, a loop's crossing and its child's, with the head and the legs stacked between them
  for (let i = 0; i < N; i++) {
    cA.push(bL[i]); cB.push(bR[i]); cMin.push(d);
    const c = t.child[i];
    if (c >= 0) { const gap = d * (1 + 0.5 * (m[i] + m[c])); cA.push(bL[i]); cB.push(bL[c]); cMin.push(gap); cA.push(bR[i]); cB.push(bR[c]); cMin.push(gap); }
    if (t.child[i] < 0) { cA.push(hL[i]); cB.push(hR[i]); cMin.push(d); }
    const j = t.next[i];
    if (j >= 0 && t.stroke[j] === t.stroke[i] && Math.abs(t.needle[j] - t.needle[i]) === 1) {
      const right = t.needle[j] > t.needle[i];
      cA.push(right ? bR[i] : bL[i]); cB.push(right ? bL[j] : bR[j]); cMin.push(d * (1 + m[i] + m[j]));
    }
  }
  // the edges the program doesn't make: pass 1's loops are held as if cast on, and the loops left on the needles as if
  // bound off, each linked to its neighbour on the same bed no further apart than the needles they were on
  const xA = gi(), xB = gi(), xMax = gf();
  const chain = (ids: number[], at: (i: number) => number, left: (i: number) => number, right: (i: number) => number) => {
    ids.sort((a, b) => at(a) - at(b));
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ids[k], b = ids[k + 1], gap = at(b) - at(a);
      if (gap > 2) continue; // not neighbours: the edge is open there
      xA.push(right(a)); xB.push(left(b)); xMax.push(Math.max(gap, 0.5) * 0.75 + d);
    }
  };
  for (let i = 0; i < N && t.row[i] === 0; i++) { xA.push(bL[i]); xB.push(bR[i]); xMax.push(2 * HALF + d); } // each cast-on loop's legs
  for (const bed of [1, -1]) {
    chain([...Array(N).keys()].filter(i => t.row[i] === 0 && t.bed[i] === bed), i => t.needle[i], i => bL[i], i => bR[i]);
    chain([...Array(N).keys()].filter(i => t.child[i] < 0 && t.endBed[i] === bed), i => t.endNeedle[i] + t.row[i] * 1e-6, i => hL[i], i => hR[i]);
  }
  // loop lengths: body, sinker and the step to the next point; bending: every triple along a yarn
  const lenStart = gi(N + 1), lenPts = gi(N * 7), bend = gi(N * 18);
  for (let i = 0; i < N; i++) {
    lenStart.push(lenPts.n);
    for (let q = 0; q < 6; q++) lenPts.push(loopPt[i] + q);
    if (nextPt[i] >= 0) lenPts.push(loopPt[i] + 6);
  }
  lenStart.push(lenPts.n);
  for (let g = 0; g < t.yarn.length; g++) for (let q = yarnStart[g] + 1; q < yarnStart[g + 1] - 1; q++) { bend.push(q - 1); bend.push(q); bend.push(q + 1); }

  const all = new Float32Array(nn * 3);
  all.set(init.subarray(0, firstExtra * 3));
  all.set(extra.out(), firstExtra * 3);
  return {
    t, prm, c0, nn, init: all, bL, bR, hL, hR, top, sink, m,
    np: pNode.n, ptNode: pNode.out(), ptSite: pSite.out(), ptOff: pOff.out(), ptTag: pTag.out(), yarnStart, loopPt, nextPt,
    lenStart: lenStart.out(), lenPts: lenPts.out(), segA: segA.out(), segB: segB.out(), segMax: segMax.out(), bend: bend.out(),
    cA: cA.out(), cB: cB.out(), cMin: cMin.out(), fNode: fN.out(), fSite: fS.out(), fSide: Int8Array.from(fSd.out()),
    xA: xA.out(), xB: xB.out(), xMax: xMax.out(),
  };
}

/** Each loop's crossing normal from its legs and head. Falls back to the old value where the loop is degenerate. */
export function normals(s: YarnSys, pos: Float32Array, out: Float32Array) {
  const N = s.t.n;
  for (let i = 0; i < N; i++) {
    const a = s.bL[i] * 3, b = s.bR[i] * 3, c = s.hL[i] * 3, e = s.hR[i] * 3;
    const ax = pos[b] - pos[a] + pos[e] - pos[c], ay = pos[b + 1] - pos[a + 1] + pos[e + 1] - pos[c + 1], az = pos[b + 2] - pos[a + 2] + pos[e + 2] - pos[c + 2];
    const ux = pos[c] + pos[e] - pos[a] - pos[b], uy = pos[c + 1] + pos[e + 1] - pos[a + 1] - pos[b + 1], uz = pos[c + 2] + pos[e + 2] - pos[a + 2] - pos[b + 2];
    let nx = ay * uz - az * uy, ny = az * ux - ax * uz, nz = ax * uy - ay * ux;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { if (out[i * 3] === 0 && out[i * 3 + 1] === 0 && out[i * 3 + 2] === 0) out[i * 3 + 2] = 1; continue; }
    nx /= l; ny /= l; nz /= l;
    out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz;
  }
}

/** Point positions (np * 3) from node positions and normals. */
export function pointsOf(s: YarnSys, pos: Float32Array, nrm: Float32Array, out: Float32Array = new Float32Array(s.np * 3)) {
  for (let p = 0; p < s.np; p++) {
    const k = s.ptNode[p] * 3, n = s.ptSite[p] * 3, o = s.ptOff[p];
    out[p * 3] = pos[k] + nrm[n] * o; out[p * 3 + 1] = pos[k + 1] + nrm[n + 1] * o; out[p * 3 + 2] = pos[k + 2] + nrm[n + 2] * o;
  }
  return out;
}

/** Normals of the machine layout: every loop faces the front of the machine. */
export function flatNormals(s: YarnSys) { const n = new Float32Array(s.t.n * 3); for (let i = 0; i < s.t.n; i++) n[i * 3 + 2] = 1; return n; }

// ---------------------------------------------------------------- render buffers
/** Points laid out for the tube renderer: each yarn with its first and last point repeated, so every span has a
 *  point before and after it. x, y, z, tag. Spans: indices of each span's first point. */
export interface RenderPts { data: Float32Array; spans: Float32Array; count: number }

export function renderLayout(s: YarnSys) {
  const G = s.yarnStart.length - 1, count = s.np + 2 * G, at = new Int32Array(s.np);
  const spans: number[] = [];
  for (let g = 0; g < G; g++) {
    const a = s.yarnStart[g], b = s.yarnStart[g + 1], base = a + 2 * g + 1;
    for (let p = a; p < b; p++) at[p] = base + (p - a);
    for (let p = a; p + 1 < b; p++) spans.push(base + (p - a));
  }
  return { count, at, spans: Float32Array.from(spans) };
}

/** Fills render points from point positions (np * 3). */
export function fillRender(s: YarnSys, lay: ReturnType<typeof renderLayout>, pts: Float32Array, out: Float32Array = new Float32Array(lay.count * 4)) {
  const G = s.yarnStart.length - 1;
  for (let p = 0; p < s.np; p++) { const r = lay.at[p] * 4; out[r] = pts[p * 3]; out[r + 1] = pts[p * 3 + 1]; out[r + 2] = pts[p * 3 + 2]; out[r + 3] = s.ptTag[p]; }
  for (let g = 0; g < G; g++) {
    const a = s.yarnStart[g], b = s.yarnStart[g + 1];
    if (b <= a) continue;
    const f = lay.at[a] * 4, l = lay.at[b - 1] * 4;
    out.copyWithin(f - 4, f, f + 4); out.copyWithin(l + 4, l, l + 4);
  }
  return out;
}

// ---------------------------------------------------------------- detailed yarn
/** The yarn as drawn: relaxation decides where the crossings are; each loop is then drawn from them, in its own
 *  frame: legs between its crossings, a head that wraps around its child's legs (wider than them, the keyhole
 *  shape), and a sinker that dips behind the fabric to the next loop. Floats and turns are drawn through the points
 *  the relaxation put them at. Render points: x, y, z, tag (loop * 2 + 1 body, loop * 2 after it). */
export interface Detail { count: number; spans: Float32Array; groups: [number, number][]; body: Int32Array; conn: Int32Array }
const BODY = 7;

export function detailLayout(s: YarnSys): Detail {
  const t = s.t, body = new Int32Array(t.n), conn = new Int32Array(t.n), spans: number[] = [], groups: [number, number][] = [];
  let c = 0;
  for (let g = 0; g < t.yarn.length; g++) {
    const ys = t.yarn[g];
    if (!ys.length) continue;
    const start = c++; // repeated first point
    for (const i of ys) {
      body[i] = c; c += BODY;
      const end = t.next[i] >= 0 ? s.loopPt[t.next[i]] : s.yarnStart[g + 1];
      conn[i] = end - (s.loopPt[i] + 5); // the sinker, floats and turn the relaxation has between this loop and the next
      c += conn[i];
    }
    c++; // repeated last point
    for (let k = start + 1; k < c - 2; k++) spans.push(k);
    groups.push([start, c]);
  }
  return { count: c, spans: Float32Array.from(spans), groups, body, conn };
}

export function detailFill(s: YarnSys, lay: Detail, pos: Float32Array, nrm: Float32Array, out: Float32Array = new Float32Array(lay.count * 4)) {
  const t = s.t, d = s.prm.d, N = t.n;
  const v = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const nv = (i: number) => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
  const add = (a: number[], b: number[], f = 1) => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a: number[], fb: number[]) => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : fb; };
  const put = (k: number, p: number[], tag: number) => { out[k * 4] = p[0]; out[k * 4 + 1] = p[1]; out[k * 4 + 2] = p[2]; out[k * 4 + 3] = tag; };
  // each loop's legs at its own crossings (B), its head at its child's (H), and its frame
  const legs = (i: number) => { const o = t.bed[i] * (s.m[i] / 2) * d, n = nv(i); return [add(v(s.bL[i]), n, o), add(v(s.bR[i]), n, o)]; };
  const upOf = (i: number) => { // up the wale, square to the loop's legs
    const a = sub(v(s.bR[i]), v(s.bL[i])), u = sub(mid(v(s.hL[i]), v(s.hR[i])), mid(v(s.bL[i]), v(s.bR[i]))), au = unit(a, [1, 0, 0]);
    return unit(sub(u, [au[0] * dot(u, au), au[1] * dot(u, au), au[2] * dot(u, au)]), [0, 1, 0]);
  };
  const ups = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = upOf(i); ups[i * 3] = u[0]; ups[i * 3 + 1] = u[1]; ups[i * 3 + 2] = u[2]; }
  const up = (i: number) => [ups[i * 3], ups[i * 3 + 1], ups[i * 3 + 2]];
  const baseC = (i: number) => mid(v(s.bL[i]), v(s.bR[i]));
  const waleOf = (i: number) => { // the distance to the neighbouring loops of its course
    let sum = 0, n = 0;
    for (const j of [t.prev[i], t.next[i]]) if (j >= 0 && t.stroke[j] === t.stroke[i] && Math.abs(t.needle[j] - t.needle[i]) === 1) { sum += len(sub(baseC(j), baseC(i))); n++; }
    return n ? sum / n : 1;
  };
  for (let g = 0; g < t.yarn.length; g++) {
    const ys = t.yarn[g];
    if (!ys.length) continue;
    for (let q = 0; q < ys.length; q++) {
      const i = ys[q], dir = t.strokeDir[t.stroke[i]], tag = i * 2 + 1, k0 = lay.body[i];
      const c = t.child[i], site = c >= 0 ? c : i, sc = c >= 0 ? t.bed[c] : t.bed[i];
      const headOff = c >= 0 ? sc * (s.m[c] / 2 - t.layer[i]) * d : 0, nc = nv(site);
      const [BL, BR] = legs(i);
      const HL = add(v(s.hL[i]), nc, headOff), HR = add(v(s.hR[i]), nc, headOff);
      const Bc = mid(BL, BR), Hc = mid(HL, HR), across = unit(sub(BR, BL), unit(sub(HR, HL), [1, 0, 0]));
      // its legs are narrowest where they pass through its parents' heads (B) and widest on the way up; its head
      // crosses behind its child's legs (H), which are narrow there, and closes over them (the V of jersey)
      const wale = waleOf(i), half = Math.max(len(sub(BR, BL)) / 2 + d, 0.45 * wale), rise = sub(Hc, Bc);
      // the legs stay on the side they were pulled through to until they reach the head
      const ni = nv(i), legFace = t.bed[i] * Math.max(s.m[i] / 2, 0.5) * d - t.bed[i] * (s.m[i] / 2) * d;
      const side = (sgn: number) => add(add(add(Bc, rise, 0.6), across, sgn * half), ni, legFace);
      const uc = c >= 0 ? up(c) : up(i), r = Math.max(len(sub(HR, HL)) / 2, d);
      const apex = add(add(Hc, uc, 0.55 * r + 0.5 * d), nc, -sc * d * 0.5);
      const pts = dir === 1 ? [BL, side(-1), HL, apex, HR, side(1), BR] : [BR, side(1), HR, apex, HL, side(-1), BL];
      pts.forEach((p, k) => put(k0 + k, p, tag));
      // what follows: a sinker dipping behind to the next loop, or the relaxation's floats / turn
      const j = t.next[i], kc = k0 + BODY, nconn = lay.conn[i];
      if (nconn === 1 && j >= 0 && t.stroke[j] === t.stroke[i]) {
        const [bjL, bjR] = legs(j), nextB = t.strokeDir[t.stroke[j]] === 1 ? bjL : bjR, from = pts[BODY - 1];
        const m = mid(from, nextB), rs = Math.max(len(sub(nextB, from)) / 2, d) * 0.75;
        const behind = add(nv(i), nv(j)), sb = -(t.bed[i] + t.bed[j]) * 0.25 * d;
        put(kc, add(add(m, mid(up(i), up(j)), -rs), unit(behind, [0, 0, 1]), sb), i * 2);
      } else for (let k = 0; k < nconn; k++) { const p = s.loopPt[i] + 5 + k, nd = s.ptNode[p]; put(kc + k, add(v(nd), nv(s.ptSite[p]), s.ptOff[p]), i * 2); }
    }
  }
  // the repeated first and last points of each yarn
  for (const [a, b] of lay.groups) { out.copyWithin(a * 4, (a + 1) * 4, (a + 2) * 4); out.copyWithin((b - 1) * 4, (b - 2) * 4, (b - 1) * 4); }
  return out;
}

/** The centre of each loop's body, from detailed points (picking). */
export function detailCentres(s: YarnSys, lay: Detail, data: Float32Array, out: Float32Array = new Float32Array(s.t.n * 3)) {
  for (let i = 0; i < s.t.n; i++) {
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < BODY; q++) { const p = (lay.body[i] + q) * 4; x += data[p]; y += data[p + 1]; z += data[p + 2]; }
    out[i * 3] = x / BODY; out[i * 3 + 1] = y / BODY; out[i * 3 + 2] = z / BODY;
  }
  return out;
}

/** A frame for the tube around each render point, carried along each yarn without twisting (parallel transport),
 *  so the tube's cross-section turns smoothly. `groups` are [start, end) runs of points that form one yarn. */
export function framesOf(data: Float32Array, groups: [number, number][], out: Float32Array = new Float32Array(data.length)) {
  for (const [a, b] of groups) {
    let nx = 0, ny = 0, nz = 1;
    for (let i = a; i < b; i++) {
      const p = Math.max(a, i - 1) * 4, q = Math.min(b - 1, i + 1) * 4;
      let tx = data[q] - data[p], ty = data[q + 1] - data[p + 1], tz = data[q + 2] - data[p + 2];
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-9) { tx /= tl; ty /= tl; tz /= tl; }
      if (i === a) { // start square to the tangent
        if (Math.abs(tz) > 0.9) { nx = 1; ny = 0; nz = 0; } else { nx = 0; ny = 0; nz = 1; }
      }
      const dt = nx * tx + ny * ty + nz * tz;
      nx -= dt * tx; ny -= dt * ty; nz -= dt * tz;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-6) { nx = -ty; ny = tx; nz = 0; l = Math.hypot(nx, ny) || 1; if (l < 1e-6) { nx = 1; l = 1; } }
      nx /= l; ny /= l; nz /= l;
      out[i * 4] = nx; out[i * 4 + 1] = ny; out[i * 4 + 2] = nz; out[i * 4 + 3] = 0;
    }
  }
  return out;
}

/** The runs of render points that form each yarn. */
export function yarnGroups(s: YarnSys, lay: ReturnType<typeof renderLayout>): [number, number][] {
  const out: [number, number][] = [];
  for (let g = 0; g + 1 < s.yarnStart.length; g++) {
    const a = s.yarnStart[g], b = s.yarnStart[g + 1];
    if (b > a) out.push([lay.at[a] - 1, lay.at[b - 1] + 2]);
  }
  return out;
}

/** The centre of each loop's body (for picking and framing). */
export function loopCentres(s: YarnSys, pts: Float32Array, out: Float32Array = new Float32Array(s.t.n * 3)) {
  for (let i = 0; i < s.t.n; i++) {
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < 5; q++) { const p = (s.loopPt[i] + q) * 3; x += pts[p]; y += pts[p + 1]; z += pts[p + 2]; }
    out[i * 3] = x / 5; out[i * 3 + 1] = y / 5; out[i * 3 + 2] = z / 5;
  }
  return out;
}

// ---------------------------------------------------------------- the machine
/** How far the beds are folded: 0 = laid flat facing you (back bed on top), 1 = the real V. */
export interface MachineFrame {
  fold: number;
  /** where a needle's hook is, and the direction from the hook along the needle to its butt */
  hook(bed: number, x: number): [number, number, number];
  along(bed: number): [number, number, number];
  /** added to the fabric's layout (pulled down below the beds) */
  shift: [number, number, number];
  needleLen: number;
}

const BETA = Math.PI / 4; // each bed slopes down at 45° from the gap (Learn 00)
export function machineFrame(s: YarnSys, fold: number, row: number): MachineFrame {
  const f = Math.max(0, Math.min(1, fold)), e = f * f * (3 - 2 * f);
  const Ln = 2.2, gF = 0.55, gB = 0.75, margin = 0.6;
  const angF = -Math.PI / 2 + e * (Math.PI / 2 - BETA), angB = Math.PI / 2 + e * (Math.PI / 2 + BETA);
  const dirF: [number, number, number] = [0, Math.sin(angF), Math.cos(angF)], dirB: [number, number, number] = [0, Math.sin(angB), Math.cos(angB)];
  const hookF: [number, number] = [-gF * (1 - e) + 0 * e, 0.05 * (1 - e) + 0.35 * e], hookB: [number, number] = [gB * (1 - e), -0.05 * (1 - e) - 0.35 * e];
  const fabTop = (-gF - Ln - margin) * (1 - e) + (-0.9) * e;
  return {
    fold: f, needleLen: Ln,
    hook: (bed, x) => (bed === 1 ? [x, hookF[0], hookF[1]] : [x, hookB[0], hookB[1]]),
    along: bed => (bed === 1 ? dirF : dirB),
    shift: [0, fabTop - (row + 0.6) * s.c0, 0],
    // keep the fabric between the beds when folded
  };
}

/** Held loops at action k, drawn on their hooks: render points (x, y, z, tag) in groups of 7 (a point before, the
 *  five body points, a point after), and the yarn from each guide's last loop up to its carrier. Fabric points come
 *  from `fab` (the machine layout) moved by the frame's shift. */
export function heldPoints(s: YarnSys, fab: Float32Array, k: number, fr: MachineFrame) {
  const t = s.t, stacks = needlesAt(t, k);
  const out: number[] = [], spans: number[] = [], held: number[] = [], carriers: [number, number, number, number][] = [], groups: [number, number][] = [];
  const [sx, sy, sz] = fr.shift;
  const P = (p: number): [number, number, number] => [fab[p * 3] + sx, fab[p * 3 + 1] + sy, fab[p * 3 + 2] + sz];
  const push = (v: [number, number, number], tag: number) => { out.push(v[0], v[1], v[2], tag); };
  for (const [key, st] of stacks) {
    if (!st.length) continue;
    const bed = key & 1 ? -1 : 1, x = Math.floor(key / 2), hook = fr.hook(bed, x), u = fr.along(bed);
    st.forEach((i, layer) => {
      const lp = s.loopPt[i], dir = t.strokeDir[t.stroke[i]], tag = i * 2 + 1;
      const down = 0.16 + layer * s.prm.d * 1.3; // stacked loops sit further down the needle
      const at = (side: number, along: number, lift = 0): [number, number, number] => [hook[0] + side * 0.24, hook[1] + u[1] * along + lift * -u[1], hook[2] + u[2] * along + lift * -u[2]];
      const before = lp > s.yarnStart[t.guide[i]] ? P(lp - 1) : P(lp);
      const after = P(lp + 5);
      const base = out.length / 4;
      push(before, tag);
      push(P(lp), tag);
      push(at(-dir, down), tag);
      push(at(0, down - 0.16, 0.08), tag);
      push(at(dir, down), tag);
      push(P(lp + 4), tag);
      push(after, tag);
      for (let q = 1; q <= 4; q++) spans.push(base + q);
      groups.push([base, base + 7]);
      held.push(i);
    });
  }
  // each guide's yarn from its last loop up to the carrier, which sits at the gap above that needle
  for (let g = 0; g < t.yarn.length; g++) {
    const ys = t.yarn[g];
    let lo = 0, hi = ys.length - 1, last = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.act[ys[mid]] <= k) { last = ys[mid]; lo = mid + 1; } else hi = mid - 1; }
    if (last < 0) continue;
    const dir = t.strokeDir[t.stroke[last]], lp = s.loopPt[last], x = t.needle[last] + dir * 0.5;
    // the carrier rides in the gap between the hooks (in front of the needles when the beds lie flat)
    const hf = fr.hook(1, x), hb = fr.hook(-1, x), cx = x, cy = (hf[1] + hb[1]) / 2 + 0.9 * fr.fold, cz = (hf[2] + hb[2]) / 2 + 0.6 * (1 - fr.fold);
    const tag = last * 2;
    const base = out.length / 4;
    push(P(lp + 4), tag); push(P(lp + 4), tag); push(P(lp + 5), tag); push([cx, cy - 0.5, cz], tag); push([cx, cy, cz], tag); push([cx, cy, cz], tag);
    for (let q = 1; q <= 3; q++) spans.push(base + q);
    groups.push([base, base + 6]);
    carriers.push([g, cx, cy, cz]);
  }
  return { data: Float32Array.from(out), spans: Float32Array.from(spans), held, carriers, groups };
}

export const isNever = (a: number) => a >= NEVER;
export { parentsOf };
