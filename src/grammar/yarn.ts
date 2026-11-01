// The yarn: continuous yarn paths built from the machine's loops (machine.ts), for the 3D views. Pure data.
//
// Every loop is a run of points along its yarn: from its foot, where it passes behind the legs of the loops it was
// drawn through, to where it crosses in front of their heads; up its legs, past the foot of the loop later knitted
// through it, to its shoulders; across its head, behind that loop's legs; and down again. Then a sinker on the way to
// the next loop of its yarn, and float or turn points where the yarn passes needles it doesn't work. So each
// interlock is a clasp: the new loop goes over its parent's head and under its legs. At both crossings the strands
// share one node and each sits at its own offset along the crossing's normal (the new loop on the side it was pulled
// through to at the head: in front on the front bed, behind on the back bed; on the other side at the foot; stacked
// parents in stack order). Crossings can't change order, because the order is the construction itself, and
// everywhere else yarn can't pass through yarn (relax.ts).
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
export const YARN_DEFAULTS: YarnParams = { d: 0.16, loop: 4, stiff: 0.5 };
export const YARN_RANGES = { d: [0.08, 0.3], loop: [2.5, 6], stiff: [0, 1] } as const;

/** Course height of the machine layout, before relaxing. */
export const courseOf = (prm: YarnParams) => Math.max(2.2 * prm.d, 0.22 * prm.loop);
const HALF = 0.2; // half the distance between a loop's legs, laid out
const FOOT = 0.1, SHOULDER = 0.22; // feet and shoulders, laid out outside the crossings

export interface YarnSys {
  t: Topo;
  prm: YarnParams;
  c0: number;
  /** nodes */
  nn: number;
  init: Float32Array;            // nn * 3: the machine layout (released, pulled straight)
  /** each loop's crossings with its parents' heads (bL, bR) and their legs (fL, fR: -1 without parents), its
   *  shoulders, top and sinker; its head crossings (hL, hR) are its child's bL, bR (its own nodes without a child) */
  bL: Int32Array; bR: Int32Array; hL: Int32Array; hR: Int32Array; top: Int32Array; sink: Int32Array;
  fL: Int32Array; fR: Int32Array; sL: Int32Array; sR: Int32Array;
  m: Uint8Array;                 // strands around each loop's legs: its parents
  /** points along the yarns: node + offset along a loop's crossing normal */
  np: number;
  ptNode: Int32Array; ptSite: Int32Array; ptOff: Float32Array;
  /** loop * 2 + 1 for a loop's body, loop * 2 for what follows it (sinker, floats, turn) */
  ptTag: Float32Array;
  yarnStart: Int32Array;         // first point of each yarn, guides + 1 entries
  /** each loop's body is points loopPt .. loopEnd - 1 (its sinker is loopEnd); inB, outB: where it crosses its
   *  parents' heads, first and last in the direction its yarn travels */
  loopPt: Int32Array; loopEnd: Int32Array; inB: Int32Array; outB: Int32Array;
  nextPt: Int32Array;            // the point after each loop's sinker, -1 at the yarn's end
  /** constraints (relax.ts) */
  lenStart: Int32Array; lenPts: Int32Array;                 // a loop's yarn: body, sinker and the next point
  segA: Int32Array; segB: Int32Array; segMax: Float32Array;  // floats and turns: the yarn can't get longer
  bend: Int32Array;                                          // consecutive point triples
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
  const fL = new Int32Array(N).fill(-1), fR = new Int32Array(N).fill(-1), sL = new Int32Array(N), sR = new Int32Array(N);
  const m = new Uint8Array(N);
  let nn = 0;
  for (let i = 0; i < N; i++) {
    bL[i] = nn++; bR[i] = nn++; top[i] = nn++; sink[i] = nn++; sL[i] = nn++; sR[i] = nn++;
    m[i] = t.pStart[i + 1] - t.pStart[i];
    if (m[i]) { fL[i] = nn++; fR[i] = nn++; }
  }
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
    if (m[i]) { setNode(init, fL[i], x - HALF - FOOT, y - 0.4 * c0, z); setNode(init, fR[i], x + HALF + FOOT, y - 0.4 * c0, z); }
    const c = t.child[i];
    if (c < 0) { const xe = t.endNeedle[i]; setNode(init, hL[i], xe - HALF * 1.1, y + c0, zOf(t.endBed[i])); setNode(init, hR[i], xe + HALF * 1.1, y + c0, zOf(t.endBed[i])); }
    // shoulders: just below where the head crosses its child's legs, outside them
    const xh = c >= 0 ? t.needle[c] : t.endNeedle[i], yh = c >= 0 ? t.row[c] * c0 : y + c0, zh = c >= 0 ? zOf(t.bed[c]) : zOf(t.endBed[i]);
    setNode(init, sL[i], xh - HALF - SHOULDER, yh - 0.12 * c0, zh); setNode(init, sR[i], xh + HALF + SHOULDER, yh - 0.12 * c0, zh);
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
  const pNode = gi(N * 14), pSite = gi(N * 14), pOff = gf(N * 14), pTag = gf(N * 14);
  const loopPt = new Int32Array(N), loopEnd = new Int32Array(N), inB = new Int32Array(N), outB = new Int32Array(N), nextPt = new Int32Array(N).fill(-1);
  const yarnStart = new Int32Array(t.yarn.length + 1);
  const fN = gi(), fS = gi(), fSd = gi();
  const segA = gi(), segB = gi(), segMax = gf();
  const pt = (node: number, site: number, off: number, tag: number) => { pNode.push(node); pSite.push(site); pOff.push(off); pTag.push(tag); return pNode.n - 1; };
  const extraNode = (x: number, y: number, z: number) => { extra.push(x); extra.push(y); extra.push(z); return nn++; };
  // offsets along the crossing normal. At a loop's base crossing its legs are on the side it was pulled through to,
  // its parents' heads behind them in stack order; at its foot its yarn is on the other side, behind its parents'
  // legs (each interlock is a clasp: over the head, under the leg)
  const legOff = (i: number) => t.bed[i] * (m[i] / 2) * d;
  const footOff = (i: number) => -legOff(i);
  const headOff = (i: number) => { const c = t.child[i]; return c < 0 ? 0 : t.bed[c] * (m[c] / 2 - t.layer[i]) * d; };
  const pLegOff = (i: number) => -headOff(i);

  for (let g = 0; g < t.yarn.length; g++) {
    yarnStart[g] = pNode.n;
    const ys = t.yarn[g];
    for (let k = 0; k < ys.length; k++) {
      const i = ys[k], dir = t.strokeDir[t.stroke[i]], c = t.child[i], site = c >= 0 ? c : i;
      const body = i * 2 + 1, after = i * 2;
      // body, in the direction the yarn travels
      loopPt[i] = pNode.n;
      const L = dir === 1;
      const [f0, b0, s0, h0, h1, s1, b1, f1] = L ? [fL[i], bL[i], sL[i], hL[i], hR[i], sR[i], bR[i], fR[i]] : [fR[i], bR[i], sR[i], hR[i], hL[i], sL[i], bL[i], fL[i]];
      const cf0 = c >= 0 ? (L ? fL[c] : fR[c]) : -1, cf1 = c >= 0 ? (L ? fR[c] : fL[c]) : -1;
      if (f0 >= 0) pt(f0, i, footOff(i), body);
      inB[i] = pt(b0, i, legOff(i), body);
      if (cf0 >= 0) pt(cf0, c, pLegOff(i), body);
      pt(s0, i, 0, body);
      pt(h0, site, headOff(i), body); pt(top[i], i, 0, body); pt(h1, site, headOff(i), body);
      pt(s1, i, 0, body);
      if (cf1 >= 0) pt(cf1, c, pLegOff(i), body);
      outB[i] = pt(b1, i, legOff(i), body);
      if (f1 >= 0) pt(f1, i, footOff(i), body);
      loopEnd[i] = pNode.n;
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
      const jL = t.strokeDir[t.stroke[j]] === 1, firstOfJ = m[j] ? (jL ? fL[j] : fR[j]) : (jL ? bL[j] : bR[j]);
      if (last !== loopEnd[i]) link(last, pNode.n, Math.abs(xj - lastX) + 0.05, firstOfJ);
    }
    yarnStart[g + 1] = pNode.n;
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
  const lenStart = gi(N + 1), lenPts = gi(N * 14), bend = gi(N * 36);
  for (let i = 0; i < N; i++) {
    lenStart.push(lenPts.n);
    for (let q = loopPt[i]; q <= loopEnd[i]; q++) lenPts.push(q);
    if (nextPt[i] >= 0) lenPts.push(loopEnd[i] + 1);
  }
  lenStart.push(lenPts.n);
  for (let g = 0; g < t.yarn.length; g++) for (let q = yarnStart[g] + 1; q < yarnStart[g + 1] - 1; q++) { bend.push(q - 1); bend.push(q); bend.push(q + 1); }

  const all = new Float32Array(nn * 3);
  all.set(init.subarray(0, firstExtra * 3));
  all.set(extra.out(), firstExtra * 3);
  return {
    t, prm, c0, nn, init: all, bL, bR, hL, hR, top, sink, fL, fR, sL, sR, m,
    np: pNode.n, ptNode: pNode.out(), ptSite: pSite.out(), ptOff: pOff.out(), ptTag: pTag.out(), yarnStart, loopPt, loopEnd, inB, outB, nextPt,
    lenStart: lenStart.out(), lenPts: lenPts.out(), segA: segA.out(), segB: segB.out(), segMax: segMax.out(), bend: bend.out(),
    fNode: fN.out(), fSite: fS.out(), fSide: Int8Array.from(fSd.out()),
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

// ---------------------------------------------------------------- drawn yarn
/** The yarn as drawn: its points, each yarn with its first and last point repeated so every span has a point before
 *  and after it (the tube follows a spline through them). Render points: x, y, z, tag. `groups`: [start, end) runs
 *  that form one yarn; `body`, `bodyEnd`: each loop's body in render points. */
export interface Detail { count: number; spans: Float32Array; groups: [number, number][]; at: Int32Array; body: Int32Array; bodyEnd: Int32Array }

export function detailLayout(s: YarnSys): Detail {
  const G = s.yarnStart.length - 1, at = new Int32Array(s.np), spans: number[] = [], groups: [number, number][] = [];
  let c = 0;
  for (let g = 0; g < G; g++) {
    const a = s.yarnStart[g], b = s.yarnStart[g + 1];
    if (b <= a) continue;
    const start = c++; // repeated first point
    for (let p = a; p < b; p++) at[p] = c++;
    c++; // repeated last point
    for (let k = start + 1; k < c - 2; k++) spans.push(k);
    groups.push([start, c]);
  }
  const body = new Int32Array(s.t.n), bodyEnd = new Int32Array(s.t.n);
  for (let i = 0; i < s.t.n; i++) { body[i] = at[s.loopPt[i]]; bodyEnd[i] = at[s.loopEnd[i] - 1] + 1; }
  return { count: c, spans: Float32Array.from(spans), groups, at, body, bodyEnd };
}

/** Render points from node positions and loop normals. */
export function detailFill(s: YarnSys, lay: Detail, pos: Float32Array, nrm: Float32Array, out: Float32Array = new Float32Array(lay.count * 4)) {
  for (let p = 0; p < s.np; p++) {
    const k = s.ptNode[p] * 3, n = s.ptSite[p] * 3, o = s.ptOff[p], r = lay.at[p] * 4;
    out[r] = pos[k] + nrm[n] * o; out[r + 1] = pos[k + 1] + nrm[n + 1] * o; out[r + 2] = pos[k + 2] + nrm[n + 2] * o; out[r + 3] = s.ptTag[p];
  }
  for (const [a, b] of lay.groups) { out.copyWithin(a * 4, (a + 1) * 4, (a + 2) * 4); out.copyWithin((b - 1) * 4, (b - 2) * 4, (b - 1) * 4); }
  return out;
}

/** The centre of each loop's body (picking). */
export function detailCentres(s: YarnSys, lay: Detail, data: Float32Array, out: Float32Array = new Float32Array(s.t.n * 3)) {
  for (let i = 0; i < s.t.n; i++) {
    let x = 0, y = 0, z = 0;
    const a = lay.body[i], b = lay.bodyEnd[i];
    for (let q = a; q < b; q++) { x += data[q * 4]; y += data[q * 4 + 1]; z += data[q * 4 + 2]; }
    const n = Math.max(1, b - a);
    out[i * 3] = x / n; out[i * 3 + 1] = y / n; out[i * 3 + 2] = z / n;
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

/** Held loops at action k, drawn on their hooks: render points (x, y, z, tag) in groups of 7 (a point before, where
 *  it crosses its parents' heads, three on the hook, where it crosses them again, a point after), and the yarn from each guide's last loop up to its carrier. Fabric points come
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
      const b0 = s.inB[i], b1 = s.outB[i], dir = t.strokeDir[t.stroke[i]], tag = i * 2 + 1;
      const down = 0.16 + layer * s.prm.d * 1.3; // stacked loops sit further down the needle
      const at = (side: number, along: number, lift = 0): [number, number, number] => [hook[0] + side * 0.24, hook[1] + u[1] * along + lift * -u[1], hook[2] + u[2] * along + lift * -u[2]];
      const before = b0 > s.yarnStart[t.guide[i]] ? P(b0 - 1) : P(b0);
      const after = P(b1 + 1);
      const base = out.length / 4;
      push(before, tag);
      push(P(b0), tag);
      push(at(-dir, down), tag);
      push(at(0, down - 0.16, 0.08), tag);
      push(at(dir, down), tag);
      push(P(b1), tag);
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
    const dir = t.strokeDir[t.stroke[last]], e = s.loopEnd[last], x = t.needle[last] + dir * 0.5;
    // the carrier rides in the gap between the hooks (in front of the needles when the beds lie flat)
    const hf = fr.hook(1, x), hb = fr.hook(-1, x), cx = x, cy = (hf[1] + hb[1]) / 2 + 0.9 * fr.fold, cz = (hf[2] + hb[2]) / 2 + 0.6 * (1 - fr.fold);
    const tag = last * 2;
    const base = out.length / 4;
    push(P(e - 1), tag); push(P(e - 1), tag); push(P(e), tag); push([cx, cy - 0.5, cz], tag); push([cx, cy, cz], tag); push([cx, cy, cz], tag);
    for (let q = 1; q <= 3; q++) spans.push(base + q);
    groups.push([base, base + 6]);
    carriers.push([g, cx, cy, cz]);
  }
  return { data: Float32Array.from(out), spans: Float32Array.from(spans), held, carriers, groups };
}

export const isNever = (a: number) => a >= NEVER;
export { parentsOf };
