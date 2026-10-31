// Relaxing the fabric once it comes off the machine: free, no gravity, nothing holding it. The yarn points
// (yarn.ts) move until these hold together as well as they can:
//   · every stitch keeps its length of yarn (loop + sinker), set by the loop length;
//   · the yarn resists bending, by the stiffness;
//   · floats and turns can't get longer than the machine laid them;
//   · strands can't come closer than the yarn's thickness where they lie side by side (a loop's two legs, and two
//     neighbouring crossings with the heads wrapped around their legs: more loops in a head take more room);
//   · a float stays on the gap side of the loops it passes;
//   · the program has no cast-on or bind-off: pass 1's loops are held together as if cast on, and the loops left on
//     the needles as if bound off (each no further from its neighbour than the needles it was made on).
// Where loops interlock, the crossing order is fixed by construction (yarn.ts), so yarns can't pass through each
// other there. Nothing else is known about contact: yarns elsewhere may overlap, friction is not modelled, and
// nothing is calibrated to a real yarn or machine. Shapes such as curling, gathering or bulging are not written in
// anywhere; whatever appears comes from these rules.
import { normals, type YarnSys } from './yarn';

/** The most a single rule moves a point in one sweep (needle pitches). */
const CAP = 0.25;

export interface Relax {
  pos: Float32Array; nrm: Float32Array; iter: number; moved: number;
  /** Chebyshev acceleration (Wang 2015, "A Chebyshev semi-iterative approach for accelerating projective and
   *  position-based dynamics"): the two previous positions and the current weight */
  prev: Float32Array; prev2: Float32Array; omega: number;
  /** sweep the acceleration last restarted at, and the rules' total error after the last sweep */
  since: number; err: number;
}

/** Estimated spectral radius of one sweep, and under-relaxation, for the acceleration. */
export const TUNE = { rho: 0.98, gamma: 0.9 };
const WARMUP = 8;

export function relaxStart(s: YarnSys, warm?: Float32Array): Relax {
  const pos = warm && warm.length === s.nn * 3 ? warm.slice() : s.init.slice();
  const nrm = new Float32Array(s.t.n * 3);
  normals(s, pos, nrm);
  return { pos, nrm, iter: 0, moved: Infinity, prev: pos.slice(), prev2: pos.slice(), omega: 1, since: 0, err: Infinity };
}

/** `n` sweeps over every rule; returns how far the farthest-moving node went in the last sweep. */
export function relaxSteps(s: YarnSys, st: Relax, n: number) {
  const P = st.pos, NR = st.nrm, pn = s.ptNode, ps = s.ptSite, po = s.ptOff;
  const d = s.prm.d, ell = s.prm.loop, kb = 0.04 + 0.4 * s.prm.stiff * s.prm.stiff; // bending stiffness (uncalibrated)
  const lenStart = s.lenStart, lenPts = s.lenPts, N = s.t.n;
  const px = new Float64Array(8), py = new Float64Array(8), pz = new Float64Array(8), gx = new Float64Array(8), gy = new Float64Array(8), gz = new Float64Array(8);
  let moved = 0;
  // a point's position: its node, moved along its crossing's normal
  const X = (p: number) => P[pn[p] * 3] + NR[ps[p] * 3] * po[p];
  const Y = (p: number) => P[pn[p] * 3 + 1] + NR[ps[p] * 3 + 1] * po[p];
  const Z = (p: number) => P[pn[p] * 3 + 2] + NR[ps[p] * 3 + 2] * po[p];
  const move = (p: number, dx: number, dy: number, dz: number) => {
    const k = pn[p] * 3, big = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (big > CAP) { const f = CAP / big; dx *= f; dy *= f; dz *= f; } // no single rule flings a node
    P[k] += dx; P[k + 1] += dy; P[k + 2] += dz;
    const a = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (a > moved) moved = a;
  };
  let before: Float32Array | null = null;
  for (let it = 0; it < n; it++) {
    moved = 0;
    let err = 0;
    if (it === n - 1) before = P.slice();
    normals(s, P, NR);
    // stitch lengths
    for (let i = 0; i < N; i++) {
      const a = lenStart[i], b = lenStart[i + 1], k = b - a;
      let L = 0;
      for (let j = 0; j < k; j++) { const p = lenPts[a + j]; px[j] = X(p); py[j] = Y(p); pz[j] = Z(p); gx[j] = gy[j] = gz[j] = 0; }
      for (let j = 0; j + 1 < k; j++) {
        const dx = px[j + 1] - px[j], dy = py[j + 1] - py[j], dz = pz[j + 1] - pz[j], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        L += l;
        const ux = dx / l, uy = dy / l, uz = dz / l;
        gx[j] -= ux; gy[j] -= uy; gz[j] -= uz; gx[j + 1] += ux; gy[j + 1] += uy; gz[j + 1] += uz;
      }
      const C = L - (k === 7 ? ell : ell * 5 / 6); // a yarn's last loop has no step to a next point
      err += Math.abs(C);
      let den = 0;
      for (let j = 0; j < k; j++) den += gx[j] * gx[j] + gy[j] * gy[j] + gz[j] * gz[j];
      if (den < 1e-12) continue;
      const lam = -C / den;
      for (let j = 0; j < k; j++) move(lenPts[a + j], lam * gx[j], lam * gy[j], lam * gz[j]);
    }
    // floats and turns can't get longer
    for (let c = 0; c < s.segA.length; c++) {
      const a = s.segA[c], b = s.segB[c];
      const dx = X(b) - X(a), dy = Y(b) - Y(a), dz = Z(b) - Z(a), l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l <= s.segMax[c]) continue;
      const f = (l - s.segMax[c]) / l / 2;
      move(a, dx * f, dy * f, dz * f); move(b, -dx * f, -dy * f, -dz * f);
    }
    // bending: each point toward the line through its neighbours (smoothing the yarn's curvature)
    const B = s.bend, w2 = kb * 2 / 3, w1 = kb / 3;
    for (let c = 0; c < B.length; c += 3) {
      const a = B[c], m = B[c + 1], b = B[c + 2];
      const vx = (X(a) + X(b)) / 2 - X(m), vy = (Y(a) + Y(b)) / 2 - Y(m), vz = (Z(a) + Z(b)) / 2 - Z(m);
      move(m, vx * w2, vy * w2, vz * w2); move(a, -vx * w1, -vy * w1, -vz * w1); move(b, -vx * w1, -vy * w1, -vz * w1);
    }
    // yarn doesn't fold back on itself: consecutive points at least half a thickness apart
    for (let g = 0; g + 1 < s.yarnStart.length; g++) for (let p = s.yarnStart[g]; p + 1 < s.yarnStart[g + 1]; p++) {
      const dx = X(p + 1) - X(p), dy = Y(p + 1) - Y(p), dz = Z(p + 1) - Z(p), l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l >= 0.5 * d || l < 1e-9 || pn[p] === pn[p + 1]) continue;
      const f = (0.5 * d - l) / l / 2;
      move(p, -dx * f, -dy * f, -dz * f); move(p + 1, dx * f, dy * f, dz * f);
    }
    // edges held as if cast on and bound off
    for (let c = 0; c < s.xA.length; c++) {
      const a = s.xA[c] * 3, b = s.xB[c] * 3;
      const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz), mx = s.xMax[c];
      if (l <= mx) continue;
      const f = (l - mx) / l / 2;
      P[a] += dx * f; P[a + 1] += dy * f; P[a + 2] += dz * f; P[b] -= dx * f; P[b + 1] -= dy * f; P[b + 2] -= dz * f;
      err += l - mx;
    }
    // strands side by side
    for (let c = 0; c < s.cA.length; c++) {
      const a = s.cA[c] * 3, b = s.cB[c] * 3;
      const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz), mn = s.cMin[c];
      if (l >= mn) continue;
      err += mn - l;
      const ux = l > 1e-9 ? dx / l : 1, uy = l > 1e-9 ? dy / l : 0, uz = l > 1e-9 ? dz / l : 0, f = (mn - l) / 2;
      P[a] -= ux * f; P[a + 1] -= uy * f; P[a + 2] -= uz * f; P[b] += ux * f; P[b + 1] += uy * f; P[b + 2] += uz * f;
      if (f > moved) moved = f;
    }
    // a float stays on the gap side of the loop in the hook it passes: behind a front loop's base crossing, in
    // front of a back loop's
    for (let c = 0; c < s.fNode.length; c++) {
      const f = s.fNode[c] * 3, h = s.fSite[c], sd = s.fSide[c], n = h * 3, a = s.bL[h] * 3, b = s.bR[h] * 3;
      const cx = (P[a] + P[b]) / 2, cy = (P[a + 1] + P[b + 1]) / 2, cz = (P[a + 2] + P[b + 2]) / 2;
      let side = ((P[f] - cx) * NR[n] + (P[f + 1] - cy) * NR[n + 1] + (P[f + 2] - cz) * NR[n + 2]) * sd + d * 0.5;
      if (side <= 0) continue;
      side = Math.min(side, CAP);
      // equal and opposite: the float takes half, the two crossings a quarter each
      const mx = NR[n] * sd * side, my = NR[n + 1] * sd * side, mz = NR[n + 2] * sd * side;
      P[f] -= mx * 0.5; P[f + 1] -= my * 0.5; P[f + 2] -= mz * 0.5;
      P[a] += mx * 0.25; P[a + 1] += my * 0.25; P[a + 2] += mz * 0.25; P[b] += mx * 0.25; P[b + 1] += my * 0.25; P[b + 2] += mz * 0.25;
      if (side > moved) moved = side;
    }
    // accelerate: extrapolate along the last two sweeps (a bad step can't run away: every rule still holds next sweep)
    // restart it whenever the rules' total error grows (adaptive restart: the extrapolation overshot)
    if (err > st.err * 1.01) { st.since = st.iter; st.omega = 1; }
    st.err = err;
    const k = st.iter - st.since;
    st.omega = k < WARMUP ? 1 : k === WARMUP ? 2 / (2 - TUNE.rho * TUNE.rho) : 4 / (4 - TUNE.rho * TUNE.rho * st.omega);
    const q0 = st.prev2, q1 = st.prev;
    if (st.omega > 1) for (let j = 0; j < P.length; j++) { const v = st.omega * (TUNE.gamma * (P[j] - q1[j]) + q1[j] - q0[j]) + q0[j]; q0[j] = q1[j]; q1[j] = v; P[j] = v; }
    else { q0.set(q1); q1.set(P); }
    st.iter++;
  }
  normals(s, P, NR);
  // how far any node actually got in the last sweep (individual rules keep pushing against each other at rest)
  let net = 0;
  if (before) for (let k = 0; k < P.length; k += 3) { const v = Math.abs(P[k] - before[k]) + Math.abs(P[k + 1] - before[k + 1]) + Math.abs(P[k + 2] - before[k + 2]); if (v > net) net = v; }
  st.moved = net;
  return net;
}

/** How many sweeps a fabric of this size gets, and when it counts as settled. */
export const relaxBudget = (s: YarnSys) => ({ max: Math.round(Math.min(2400, Math.max(500, 4 * Math.max(s.t.w, s.t.h * 1.2)))), settled: 2e-4 });
