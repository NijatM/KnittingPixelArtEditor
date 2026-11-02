// Relaxing the fabric once it comes off the machine: free, no gravity, nothing holding it. The yarn (yarn.ts) takes
// the shape with the least energy it can reach, where the energy is:
//   · bending: the yarn resists curving, by the stiffness (curvature squared along the yarn: at each point the square
//     of the angle there, over the length of yarn around it, as for a discrete elastic rod);
//   · and, as stiff penalties for what the yarn can't do:
//     every stitch keeps its length of yarn (loop + sinker), set by the loop length;
//     floats and turns can't get longer than the machine laid them;
//     yarn can't pass through yarn: no two stretches of yarn come closer than the yarn's thickness, anywhere;
//     and it can't fold back on itself: consecutive points along it stay half a thickness apart;
//     a float stays on the gap side of the loops it passes;
//     the program has no cast-on or bind-off: pass 1's loops are held together as if cast on, and the loops left on
//     the needles as if bound off (each no further from its neighbour than the needles it was made on);
//   · and a barrier where consecutive points come within a quarter of the thickness: its energy grows without limit
//     as they meet (Li et al., Incremental Potential Contact, 2020). The fold-back penalty alone can be overcome: a
//     loop held over passes, pulled long, squeezed a stretch of yarn to nothing, where the bending (over the length
//     of yarn) is undefined and the relaxing went no further. Yarn that doesn't come that close doesn't feel it.
// The order of strands where loops interlock is fixed by construction (yarn.ts). Friction is not modelled, and
// nothing is calibrated to a real yarn or machine. Shapes such as curling, gathering or bulging are not written in
// anywhere; whatever appears comes from these rules.
//
// The energy is minimised with L-BFGS (Nocedal & Wright, Numerical Optimization, ch. 7) and a backtracking line
// search, with the exact gradient. No point moves more than half the yarn's thickness in one step, so yarn can't
// jump through yarn.
import type { YarnSys } from './yarn';

/** Penalty stiffnesses, and the bending scale. Uncalibrated. */
export const K = { len: 200, hard: 200 };
export const bendOf = (stiff: number) => (0.04 + 0.4 * stiff * stiff) / 6;
/** Regularises the normal of a loop squeezed flat. */
export const EPS2 = 1e-3;
/** Extra reach of the yarn-on-yarn pairs list; the list is rebuilt when any point has moved half of it. */
export const MARGIN = 0.2;
/** L-BFGS history. */
export const HIST = 5;

interface Work {
  pts: Float64Array; gp: Float64Array; nrm: Float64Array; vl: Float64Array; gn: Float64Array;
  /** yarn segments (their first points), pairs of segments close enough to touch, and the points they were found at */
  seg: Int32Array; pa: Int32Array; pb: Int32Array; npair: number; at: Float64Array | null; box: Float64Array;
}

export interface Relax {
  /** node positions and loop normals, for drawing */
  pos: Float32Array; nrm: Float32Array;
  iter: number;
  /** the farthest any node moved in the last step; the energy; the largest force */
  moved: number; energy: number; force: number;
  x: Float64Array; g: Float64Array; xn: Float64Array; gNew: Float64Array; dir: Float64Array;
  S: Float32Array[]; Y: Float32Array[]; rho: Float64Array; k: number;
  w: Work;
  /** coordinates that stay where they started (node * 3 + axis): their force is set to 0, so no step moves them */
  fixed?: Int32Array;
}

const pin = (st: Relax, g: Float64Array) => { if (st.fixed) for (const j of st.fixed) g[j] = 0; };

function work(s: YarnSys): Work {
  const seg: number[] = [];
  for (let g = 0; g + 1 < s.yarnStart.length; g++) for (let p = s.yarnStart[g]; p + 1 < s.yarnStart[g + 1]; p++) seg.push(p);
  return {
    pts: new Float64Array(s.np * 3), gp: new Float64Array(s.np * 3), nrm: new Float64Array(s.t.n * 3), vl: new Float64Array(s.t.n), gn: new Float64Array(s.t.n * 3),
    seg: Int32Array.from(seg), pa: new Int32Array(1024), pb: new Int32Array(1024), npair: 0, at: null, box: new Float64Array(seg.length * 6),
  };
}

/** Pairs of yarn segments whose boxes, grown by half the thickness and margin, overlap: each segment is entered in
 *  every grid cell its box touches (hashed into buckets, counting-sorted); two entries pair only if they are in the
 *  same cell (cells can share a bucket), and a pair is kept only in the cell holding the low corner of the two boxes'
 *  overlap, so each pair is found exactly once. Neighbours along a yarn share a point and are left out. */
function findPairs(s: YarnSys, w: Work) {
  const P = w.pts, seg = w.seg, ns = seg.length, r = (s.prm.d + MARGIN) / 2, cs = Math.max(0.45, 2 * r), box = w.box;
  let entries = 0;
  for (let q = 0; q < ns; q++) {
    const a = seg[q] * 3, b = a + 3, o = q * 6;
    box[o] = Math.min(P[a], P[b]) - r; box[o + 1] = Math.min(P[a + 1], P[b + 1]) - r; box[o + 2] = Math.min(P[a + 2], P[b + 2]) - r;
    box[o + 3] = Math.max(P[a], P[b]) + r; box[o + 4] = Math.max(P[a + 1], P[b + 1]) + r; box[o + 5] = Math.max(P[a + 2], P[b + 2]) + r;
    entries += (Math.floor(box[o + 3] / cs) - Math.floor(box[o] / cs) + 1) * (Math.floor(box[o + 4] / cs) - Math.floor(box[o + 1] / cs) + 1) * (Math.floor(box[o + 5] / cs) - Math.floor(box[o + 2] / cs) + 1);
  }
  let H = 1;
  while (H < entries * 2) H <<= 1;
  const hash = (i: number, j: number, k: number) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) & (H - 1);
  const start = new Int32Array(H + 1), eh = new Int32Array(entries), es = new Int32Array(entries), ec = new Int32Array(entries * 3);
  let e = 0;
  for (let q = 0; q < ns; q++) {
    const o = q * 6;
    for (let i = Math.floor(box[o] / cs); i <= Math.floor(box[o + 3] / cs); i++) for (let j = Math.floor(box[o + 1] / cs); j <= Math.floor(box[o + 4] / cs); j++) for (let k = Math.floor(box[o + 2] / cs); k <= Math.floor(box[o + 5] / cs); k++) {
      const h = hash(i, j, k); eh[e] = h; es[e] = q; ec[e * 3] = i; ec[e * 3 + 1] = j; ec[e * 3 + 2] = k; e++; start[h + 1]++;
    }
  }
  for (let h = 0; h < H; h++) start[h + 1] += start[h];
  const fill = start.slice(0, H), cell = new Int32Array(entries), ci = new Int32Array(entries * 3);
  for (let x = 0; x < entries; x++) { const y = fill[eh[x]]++; cell[y] = es[x]; ci[y * 3] = ec[x * 3]; ci[y * 3 + 1] = ec[x * 3 + 1]; ci[y * 3 + 2] = ec[x * 3 + 2]; }
  let pa = w.pa, pb = w.pb, n = 0;
  for (let h = 0; h < H; h++) {
    const a1 = start[h + 1];
    for (let x = start[h]; x < a1; x++) {
      const qa = cell[x], A = qa * 6, sa = seg[qa], i = ci[x * 3], j = ci[x * 3 + 1], k = ci[x * 3 + 2];
      for (let y = x + 1; y < a1; y++) {
        const qb = cell[y], B = qb * 6, sb = seg[qb];
        if (sa - sb <= 1 && sb - sa <= 1) continue;
        if (ci[y * 3] !== i || ci[y * 3 + 1] !== j || ci[y * 3 + 2] !== k) continue;
        const lx = Math.max(box[A], box[B]), ly = Math.max(box[A + 1], box[B + 1]), lz = Math.max(box[A + 2], box[B + 2]);
        if (lx > Math.min(box[A + 3], box[B + 3]) || ly > Math.min(box[A + 4], box[B + 4]) || lz > Math.min(box[A + 5], box[B + 5])) continue;
        if (Math.floor(lx / cs) !== i || Math.floor(ly / cs) !== j || Math.floor(lz / cs) !== k) continue;
        if (n === pa.length) { const na = new Int32Array(n * 2), nb = new Int32Array(n * 2); na.set(pa); nb.set(pb); pa = na; pb = nb; }
        pa[n] = sa; pb[n++] = sb;
      }
    }
  }
  w.pa = pa; w.pb = pb; w.npair = n;
  if (w.at && w.at.length === P.length) w.at.set(P); else w.at = P.slice();
}

/** The energy at node positions x, and its gradient into g. */
function energy(s: YarnSys, x: Float64Array, g: Float64Array, w: Work): number {
  const N = s.t.n, d = s.prm.d, ell = s.prm.loop, kb = bendOf(s.prm.stiff), kh = K.hard;
  const { pts, gp, nrm, vl, gn } = w, pn = s.ptNode, ps = s.ptSite, po = s.ptOff;
  g.fill(0); gp.fill(0); gn.fill(0);
  let E = 0;
  // each loop's crossing normal, from its legs and head: n = v / |v|, v = across × up
  for (let i = 0; i < N; i++) {
    const a = s.bL[i] * 3, b = s.bR[i] * 3, c = s.hL[i] * 3, f = s.hR[i] * 3;
    const ax = x[b] - x[a] + x[f] - x[c], ay = x[b + 1] - x[a + 1] + x[f + 1] - x[c + 1], az = x[b + 2] - x[a + 2] + x[f + 2] - x[c + 2];
    const ux = x[c] + x[f] - x[a] - x[b], uy = x[c + 1] + x[f + 1] - x[a + 1] - x[b + 1], uz = x[c + 2] + x[f + 2] - x[a + 2] - x[b + 2];
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux, l = Math.sqrt(vx * vx + vy * vy + vz * vz + EPS2);
    vl[i] = l; nrm[i * 3] = vx / l; nrm[i * 3 + 1] = vy / l; nrm[i * 3 + 2] = vz / l;
  }
  // points: a node moved along its crossing's normal
  for (let p = 0; p < s.np; p++) {
    const k = pn[p] * 3, n = ps[p] * 3, o = po[p], q = p * 3;
    pts[q] = x[k] + nrm[n] * o; pts[q + 1] = x[k + 1] + nrm[n + 1] * o; pts[q + 2] = x[k + 2] + nrm[n + 2] * o;
  }
  // yarn can't pass through yarn
  if (w.at) {
    const A = w.at, lim = (MARGIN / 2) ** 2;
    for (let p = 0; p < pts.length; p += 3) { const dx = pts[p] - A[p], dy = pts[p + 1] - A[p + 1], dz = pts[p + 2] - A[p + 2]; if (dx * dx + dy * dy + dz * dz > lim) { findPairs(s, w); break; } }
  } else findPairs(s, w);
  const d2 = d * d, pa = w.pa, pb = w.pb;
  for (let c = 0; c < w.npair; c++) {
    const p0 = pa[c] * 3, p1 = p0 + 3, q0 = pb[c] * 3, q1 = q0 + 3;
    // closest points of two segments (Ericson, Real-Time Collision Detection, 5.1.9)
    const ux = pts[p1] - pts[p0], uy = pts[p1 + 1] - pts[p0 + 1], uz = pts[p1 + 2] - pts[p0 + 2];
    const vx = pts[q1] - pts[q0], vy = pts[q1 + 1] - pts[q0 + 1], vz = pts[q1 + 2] - pts[q0 + 2];
    const rx = pts[p0] - pts[q0], ry = pts[p0 + 1] - pts[q0 + 1], rz = pts[p0 + 2] - pts[q0 + 2];
    const a = ux * ux + uy * uy + uz * uz, ee = vx * vx + vy * vy + vz * vz, f = vx * rx + vy * ry + vz * rz;
    let sP = 0, tQ = 0;
    if (a <= 1e-12) tQ = ee <= 1e-12 ? 0 : Math.min(1, Math.max(0, f / ee));
    else {
      const cc = ux * rx + uy * ry + uz * rz;
      if (ee <= 1e-12) sP = Math.min(1, Math.max(0, -cc / a));
      else {
        const b = ux * vx + uy * vy + uz * vz, den = a * ee - b * b;
        sP = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - cc * ee) / den)) : 0;
        tQ = (b * sP + f) / ee;
        if (tQ < 0) { tQ = 0; sP = Math.min(1, Math.max(0, -cc / a)); } else if (tQ > 1) { tQ = 1; sP = Math.min(1, Math.max(0, (b - cc) / a)); }
      }
    }
    const dx = rx + sP * ux - tQ * vx, dy = ry + sP * uy - tQ * vy, dz = rz + sP * uz - tQ * vz, l2 = dx * dx + dy * dy + dz * dz;
    if (l2 >= d2) continue;
    const l = Math.sqrt(l2), C = d - l;
    E += 0.5 * kh * C * C;
    if (l < 1e-9) continue;
    const k = -kh * C / l, gx = k * dx, gy = k * dy, gz = k * dz;
    gp[p0] += (1 - sP) * gx; gp[p0 + 1] += (1 - sP) * gy; gp[p0 + 2] += (1 - sP) * gz;
    gp[p1] += sP * gx; gp[p1 + 1] += sP * gy; gp[p1 + 2] += sP * gz;
    gp[q0] -= (1 - tQ) * gx; gp[q0 + 1] -= (1 - tQ) * gy; gp[q0 + 2] -= (1 - tQ) * gz;
    gp[q1] -= tQ * gx; gp[q1 + 1] -= tQ * gy; gp[q1 + 2] -= tQ * gz;
  }
  // stitch lengths (a yarn's last loop has no step to a next point)
  const kl = K.len;
  for (let i = 0; i < N; i++) {
    const a = s.lenStart[i], b = s.lenStart[i + 1];
    let L = 0;
    for (let j = a; j + 1 < b; j++) {
      const p = s.lenPts[j] * 3, q = s.lenPts[j + 1] * 3, dx = pts[q] - pts[p], dy = pts[q + 1] - pts[p + 1], dz = pts[q + 2] - pts[p + 2];
      L += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const C = L - (s.nextPt[i] >= 0 ? ell : ell * 5 / 6);
    E += 0.5 * kl * C * C;
    const f = kl * C;
    for (let j = a; j + 1 < b; j++) {
      const p = s.lenPts[j] * 3, q = s.lenPts[j + 1] * 3, dx = pts[q] - pts[p], dy = pts[q + 1] - pts[p + 1], dz = pts[q + 2] - pts[p + 2];
      const h = f / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12);
      gp[q] += h * dx; gp[q + 1] += h * dy; gp[q + 2] += h * dz; gp[p] -= h * dx; gp[p + 1] -= h * dy; gp[p + 2] -= h * dz;
    }
  }
  // floats and turns: no longer than laid
  for (let c = 0; c < s.segA.length; c++) {
    const p = s.segA[c] * 3, q = s.segB[c] * 3, dx = pts[q] - pts[p], dy = pts[q + 1] - pts[p + 1], dz = pts[q + 2] - pts[p + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const C = l - s.segMax[c];
    if (C <= 0) continue;
    E += 0.5 * kh * C * C;
    const h = kh * C / l;
    gp[q] += h * dx; gp[q + 1] += h * dy; gp[q + 2] += h * dz; gp[p] -= h * dx; gp[p + 1] -= h * dy; gp[p + 2] -= h * dz;
  }
  // yarn doesn't fold back on itself: consecutive points at least half a thickness apart
  const h2 = d / 2, h4 = d / 4, kf = kh * h4 * h4;
  for (let q = 0; q < w.seg.length; q++) {
    const p = w.seg[q] * 3, r = p + 3, dx = pts[r] - pts[p], dy = pts[r + 1] - pts[p + 1], dz = pts[r + 2] - pts[p + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l >= h2) continue;
    if (!(l > 0)) return Infinity; // the barrier: no step gets here
    const C = h2 - l;
    E += 0.5 * kh * C * C;
    let k = kh * C / l;
    if (l < h4) { // the barrier, -(1 - u)² ln u with u = l / h4
      const u = l / h4, lu = Math.log(u);
      E -= kf * (1 - u) * (1 - u) * lu;
      k -= kf / h4 * (2 * (1 - u) * lu - (1 - u) * (1 - u) / u) / l;
    }
    gp[p] += k * dx; gp[p + 1] += k * dy; gp[p + 2] += k * dz; gp[r] -= k * dx; gp[r + 1] -= k * dy; gp[r + 2] -= k * dz;
  }
  // bending: θ² / l at every point along a yarn, θ the angle between its two segments, l their mean length
  const B = s.bend;
  for (let c = 0; c < B.length; c += 3) {
    const a = B[c] * 3, m = B[c + 1] * 3, b = B[c + 2] * 3;
    const e1x = pts[m] - pts[a], e1y = pts[m + 1] - pts[a + 1], e1z = pts[m + 2] - pts[a + 2];
    const e2x = pts[b] - pts[m], e2y = pts[b + 1] - pts[m + 1], e2z = pts[b + 2] - pts[m + 2];
    const q1 = e1x * e1x + e1y * e1y + e1z * e1z, q2 = e2x * e2x + e2y * e2y + e2z * e2z;
    if (q1 < 1e-18 || q2 < 1e-18) continue;
    const l1 = Math.sqrt(q1), l2 = Math.sqrt(q2), lm = (l1 + l2) / 2;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x, cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const th = Math.atan2(cl, e1x * e2x + e1y * e2y + e1z * e2z);
    E += kb * th * th / lm;
    // through the length: -θ²/l² · ½ ê; through the angle: dθ/de1 = -(β × e1)/|e1|², dθ/de2 = (β × e2)/|e2|², β the binormal
    const r = -kb * th * th / (lm * lm) / 2, r1 = r / l1, r2 = r / l2;
    let g1x = r1 * e1x, g1y = r1 * e1y, g1z = r1 * e1z, g2x = r2 * e2x, g2y = r2 * e2y, g2z = r2 * e2z;
    if (cl >= 1e-12) {
      const bx = cx / cl, by = cy / cl, bz = cz / cl, i1 = 2 * kb * th / lm / q1, i2 = 2 * kb * th / lm / q2;
      g1x -= (by * e1z - bz * e1y) * i1; g1y -= (bz * e1x - bx * e1z) * i1; g1z -= (bx * e1y - by * e1x) * i1;
      g2x += (by * e2z - bz * e2y) * i2; g2y += (bz * e2x - bx * e2z) * i2; g2z += (bx * e2y - by * e2x) * i2;
    }
    gp[a] -= g1x; gp[a + 1] -= g1y; gp[a + 2] -= g1z;
    gp[m] += g1x - g2x; gp[m + 1] += g1y - g2y; gp[m + 2] += g1z - g2z;
    gp[b] += g2x; gp[b + 1] += g2y; gp[b + 2] += g2z;
  }
  // edges held as if cast on and bound off
  for (let c = 0; c < s.xA.length; c++) {
    const p = s.xA[c] * 3, q = s.xB[c] * 3, dx = x[q] - x[p], dy = x[q + 1] - x[p + 1], dz = x[q + 2] - x[p + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const C = l - s.xMax[c];
    if (C <= 0) continue;
    E += 0.5 * kh * C * C;
    const h = kh * C / l;
    g[q] += h * dx; g[q + 1] += h * dy; g[q + 2] += h * dz; g[p] -= h * dx; g[p + 1] -= h * dy; g[p + 2] -= h * dz;
  }
  // a float stays on the gap side of the loop in the hook it passes: behind a front loop's crossings, in front of a
  // back loop's
  for (let c = 0; c < s.fNode.length; c++) {
    const f = s.fNode[c] * 3, h = s.fSite[c], sd = s.fSide[c], n = h * 3, a = s.bL[h] * 3, b = s.bR[h] * 3;
    const rx = x[f] - (x[a] + x[b]) / 2, ry = x[f + 1] - (x[a + 1] + x[b + 1]) / 2, rz = x[f + 2] - (x[a + 2] + x[b + 2]) / 2;
    const side = (rx * nrm[n] + ry * nrm[n + 1] + rz * nrm[n + 2]) * sd + d * 0.5;
    if (side <= 0) continue;
    E += 0.5 * kh * side * side;
    const k = kh * side * sd;
    g[f] += k * nrm[n]; g[f + 1] += k * nrm[n + 1]; g[f + 2] += k * nrm[n + 2];
    g[a] -= 0.5 * k * nrm[n]; g[a + 1] -= 0.5 * k * nrm[n + 1]; g[a + 2] -= 0.5 * k * nrm[n + 2];
    g[b] -= 0.5 * k * nrm[n]; g[b + 1] -= 0.5 * k * nrm[n + 1]; g[b + 2] -= 0.5 * k * nrm[n + 2];
    gn[n] += k * rx; gn[n + 1] += k * ry; gn[n + 2] += k * rz;
  }
  // points back to their nodes and normals, normals back to their loops' four nodes
  for (let p = 0; p < s.np; p++) {
    const k = pn[p] * 3, q = p * 3, o = po[p];
    g[k] += gp[q]; g[k + 1] += gp[q + 1]; g[k + 2] += gp[q + 2];
    if (o !== 0) { const n = ps[p] * 3; gn[n] += gp[q] * o; gn[n + 1] += gp[q + 1] * o; gn[n + 2] += gp[q + 2] * o; }
  }
  for (let i = 0; i < N; i++) {
    const n = i * 3, Gx = gn[n], Gy = gn[n + 1], Gz = gn[n + 2];
    if (Gx === 0 && Gy === 0 && Gz === 0) continue;
    const nx = nrm[n], ny = nrm[n + 1], nz = nrm[n + 2], dot = Gx * nx + Gy * ny + Gz * nz, il = 1 / vl[i];
    const Vx = (Gx - dot * nx) * il, Vy = (Gy - dot * ny) * il, Vz = (Gz - dot * nz) * il;
    const a = s.bL[i] * 3, b = s.bR[i] * 3, c = s.hL[i] * 3, f = s.hR[i] * 3;
    const ax = x[b] - x[a] + x[f] - x[c], ay = x[b + 1] - x[a + 1] + x[f + 1] - x[c + 1], az = x[b + 2] - x[a + 2] + x[f + 2] - x[c + 2];
    const ux = x[c] + x[f] - x[a] - x[b], uy = x[c + 1] + x[f + 1] - x[a + 1] - x[b + 1], uz = x[c + 2] + x[f + 2] - x[a + 2] - x[b + 2];
    const Ax = uy * Vz - uz * Vy, Ay = uz * Vx - ux * Vz, Az = ux * Vy - uy * Vx; // through across: u × V
    const Ux = Vy * az - Vz * ay, Uy = Vz * ax - Vx * az, Uz = Vx * ay - Vy * ax; // through up: V × a
    g[b] += Ax - Ux; g[b + 1] += Ay - Uy; g[b + 2] += Az - Uz;
    g[a] += -Ax - Ux; g[a + 1] += -Ay - Uy; g[a + 2] += -Az - Uz;
    g[f] += Ax + Ux; g[f + 1] += Ay + Uy; g[f + 2] += Az + Uz;
    g[c] += -Ax + Ux; g[c + 1] += -Ay + Uy; g[c + 2] += -Az + Uz;
  }
  return E;
}

export function relaxStart(s: YarnSys, warm?: Float32Array, fixed?: Int32Array): Relax {
  const n = s.nn * 3, x = Float64Array.from(warm && warm.length === n ? warm : s.init), g = new Float64Array(n), w = work(s);
  const st: Relax = {
    pos: Float32Array.from(x), nrm: new Float32Array(s.t.n * 3), iter: 0, moved: Infinity, energy: 0, force: Infinity,
    x, g, xn: new Float64Array(n), gNew: new Float64Array(n), dir: new Float64Array(n),
    S: [...Array(HIST)].map(() => new Float32Array(n)), Y: [...Array(HIST)].map(() => new Float32Array(n)), rho: new Float64Array(HIST), k: 0, w, fixed,
  };
  st.energy = energy(s, x, g, w);
  pin(st, g);
  st.nrm.set(w.nrm);
  return st;
}

/** `n` steps; returns how far the farthest-moving node went in the last one. */
export function relaxSteps(s: YarnSys, st: Relax, n: number) {
  const len = st.x.length, al = new Float64Array(HIST), cap = 0.5 * s.prm.d, q = st.dir;
  for (let it = 0; it < n; it++) {
    // direction: the L-BFGS two-loop recursion
    const g = st.g;
    for (let j = 0; j < len; j++) q[j] = -g[j];
    const h = Math.min(st.k, HIST);
    for (let t = 0; t < h; t++) {
      const i = (st.k - 1 - t) % HIST, S = st.S[i], Y = st.Y[i];
      let a = 0;
      for (let j = 0; j < len; j++) a += S[j] * q[j];
      a *= st.rho[i]; al[i] = a;
      for (let j = 0; j < len; j++) q[j] -= a * Y[j];
    }
    let gam = 1e-3;
    if (h > 0) {
      const i = (st.k - 1) % HIST, S = st.S[i], Y = st.Y[i];
      let sy = 0, yy = 0;
      for (let j = 0; j < len; j++) { sy += S[j] * Y[j]; yy += Y[j] * Y[j]; }
      gam = sy / yy;
    }
    for (let j = 0; j < len; j++) q[j] *= gam;
    for (let t = h - 1; t >= 0; t--) {
      const i = (st.k - 1 - t) % HIST, S = st.S[i], Y = st.Y[i];
      let b = 0;
      for (let j = 0; j < len; j++) b += Y[j] * q[j];
      const c = al[i] - b * st.rho[i];
      for (let j = 0; j < len; j++) q[j] += c * S[j];
    }
    let dg = 0, big = 0;
    for (let j = 0; j < len; j++) { dg += q[j] * g[j]; const v = Math.abs(q[j]); if (v > big) big = v; }
    if (!(dg < 0)) { // not downhill: start again from the gradient
      st.k = 0; dg = 0; big = 0;
      for (let j = 0; j < len; j++) { q[j] = -g[j] * 1e-3; dg += q[j] * g[j]; const v = Math.abs(q[j]); if (v > big) big = v; }
    }
    // backtracking line search from the full step, capped
    let a = big > cap ? cap / big : 1, En = st.energy, ok = false;
    for (let tries = 0; tries < 30 && !ok; tries++) {
      for (let j = 0; j < len; j++) st.xn[j] = st.x[j] + a * q[j];
      En = energy(s, st.xn, st.gNew, st.w);
      pin(st, st.gNew);
      if (En <= st.energy + 1e-4 * a * dg) ok = true; else a *= 0.5;
    }
    if (!ok) { // no step lowers the energy along this direction: forget the history; stuck even from the gradient: done
      energy(s, st.x, st.g, st.w);
      pin(st, st.g);
      if (st.k === 0) { st.moved = 0; st.iter++; break; }
      st.k = 0; st.iter++; continue;
    }
    const i = st.k % HIST, S = st.S[i], Y = st.Y[i];
    let sy = 0, mv = 0, fm = 0;
    for (let j = 0; j < len; j++) {
      const sj = st.xn[j] - st.x[j], yj = st.gNew[j] - g[j];
      S[j] = sj; Y[j] = yj; sy += sj * yj;
      const v = Math.abs(sj); if (v > mv) mv = v;
      const f = Math.abs(st.gNew[j]); if (f > fm) fm = f;
    }
    if (sy > 1e-12) { st.rho[i] = 1 / sy; st.k++; }
    const t = st.x; st.x = st.xn; st.xn = t;
    const u = st.g; st.g = st.gNew; st.gNew = u;
    st.energy = En; st.moved = mv; st.force = fm; st.iter++;
  }
  // the last energy evaluation was at st.x (an accepted step, or the re-evaluation after a failed one): its normals
  for (let j = 0; j < len; j++) st.pos[j] = st.x[j];
  st.nrm.set(st.w.nrm);
  return st.moved;
}

/** How many steps a fabric of this size gets, and when it counts as settled (no node moving more than that). */
export const relaxBudget = (s: YarnSys) => ({ max: Math.round(Math.min(4000, Math.max(1500, 6 * Math.max(s.t.w, s.t.h)))), settled: 1e-4 });
