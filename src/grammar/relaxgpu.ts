// The relaxation of relax.ts on the GPU (WebGPU), for big fabrics: the same energy term by term, the same L-BFGS
// with the same history, line search and step cap, and the same pairs of yarn segments. relax.ts is the reference.
// This one works in single precision, so it settles to the same kind of shape, not bit for bit the same one:
//   · the line search compares energy differences, each term's change worked out on its own (its old value and its
//     new one), so rounding in a sum of millions of terms doesn't decide which step is taken;
//   · node positions are fixed point (2^-21 of a pitch, up to ±1024 pitches): GPU compilers may reorder float
//     arithmetic, which would turn "difference of two nearby coordinates" into rounding at the coordinates' size;
//     integer differences are exact,
//     so every float left in the energy is small (differences and offsets);
//   · each loop's length is summed in fixed point, each segment rounded on its own, so its stretch is exact and a
//     step that moves nothing changes nothing (compilers may fuse a difference of two lengths into one rounding);
//   · where a step's energy change is below what single precision resolves, the slope along the step decides
//     instead (Hager & Zhang's approximate Wolfe condition), down to steps of one fixed-point unit;
//   · gradients are summed with atomic adds, so their last bits vary from run to run, and so does where it settles
//     (a 30 × 30 jersey: energy 636.0–636.4 against the CPU's 634.9; the CPU continued from one lowers it by 0.015);
//   · the pairs of segments close enough to touch are found on the GPU, with the same hashed grid (each pair once,
//     in the cell holding the low corner of the two boxes' overlap), rebuilt when any point has moved half the margin.
// Falls back to relax.ts (returns null) where WebGPU or the limits it needs aren't there.
import type { YarnSys } from './yarn';
import { K, bendOf, EPS2, MARGIN, HIST } from './relax';

const WG = 64, RW = 256, NONE = 0xffffffff, FIX = 2 ** 21;
const ST = GPUBufferUsage.STORAGE, CS = GPUBufferUsage.COPY_SRC, CD = GPUBufferUsage.COPY_DST;

export interface GpuRelax {
  iter: number; moved: number; force: number;
  /** energy change since the start, summed from the steps' changes; and the energy now, summed in single precision */
  dE: number; energy: number;
  /** steps taken on the slope test because their energy change was below what single precision resolves */
  approx: number;
  /** pair-list rebuilds so far, and the current number of pairs */
  rebuilds: number; pairs: number;
  /** no step lowers the energy, even along the gradient: as settled as single precision can tell */
  stuck: boolean;
  /** takes up to n steps; returns the largest move of a node among them (0 once stuck) */
  steps(n: number): Promise<number>;
  read(): Promise<{ pos: Float32Array; nrm: Float32Array }>;
  /** the positions exactly (fixed point to double; single precision rounds them above 8 pitches), for checks */
  exact(): Promise<Float64Array>;
  /** the gradient at the current state (for checks against relax.ts) */
  gradient(): Promise<Float32Array>;
  /** the energy change the line search would see for a step a along −gradient, and the positions there (checks) */
  probe(a: number): Promise<{ dE: number; pos: Float64Array; terms: Record<string, number> }>;
  destroy(): void;
}

type Kind = 'r' | 'rw' | 'a' | 'u';
type Bind = [name: string, kind: Kind, elem?: 'f32' | 'u32' | 'i32'];
interface Kern { name: string; binds: Bind[]; body: string; wg?: number }

// thread → item, for 1-D work dispatched as up to 32768 × n workgroups
const LIN = `fn lin(w: vec3u, n: vec3u, l: u32, s: u32) -> u32 { return (w.x + w.y * n.x) * s + l; }`;

/** Starts the relaxation on the GPU, from the machine layout or a previous result; null when it can't run there. */
export async function gpuRelaxStart(s: YarnSys, warm?: Float32Array): Promise<GpuRelax | null> {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return null;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize,
    },
  }).catch(() => null);
  if (!device) return null;
  const dev: GPUDevice = device;

  const t = s.t, NL = t.n, NN = s.nn, NP = s.np, d = s.prm.d, L3 = NN * 3;
  // ---- static topology
  const seg: number[] = [];
  for (let g = 0; g + 1 < s.yarnStart.length; g++) for (let p = s.yarnStart[g]; p + 1 < s.yarnStart[g + 1]; p++) seg.push(p);
  const NS = seg.length, NF = s.segA.length, NB = s.bend.length / 3, NE = s.xA.length, NG = s.fNode.length;
  const LN = new Uint32Array(NL * 4);
  for (let i = 0; i < NL; i++) { LN[i * 4] = s.bL[i]; LN[i * 4 + 1] = s.bR[i]; LN[i * 4 + 2] = s.hL[i]; LN[i * 4 + 3] = s.hR[i]; }
  const LT = new Float32Array(NL);
  for (let i = 0; i < NL; i++) LT[i] = s.nextPt[i] >= 0 ? s.prm.loop : s.prm.loop * 5 / 6;
  const csr = (n: number, items: number, key: (k: number) => number, val: (k: number) => number) => {
    const start = new Uint32Array(n + 1);
    for (let k = 0; k < items; k++) { const c = key(k); if (c >= 0) start[c + 1]++; }
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const fill = start.slice(0, n), out = new Uint32Array(Math.max(1, start[n]));
    for (let k = 0; k < items; k++) { const c = key(k); if (c >= 0) out[fill[c]++] = val(k); }
    return [start, out];
  };
  // lookups packed as one buffer each: n + 1 start offsets (counted from the items), then the items
  const packed = ([start, items]: Uint32Array[]) => { const o = new Uint32Array(start.length + items.length); o.set(start); o.set(items, start.length); return o; };
  const NPC = packed(csr(NN, NP, p => s.ptNode[p], p => p)), SPC = packed(csr(NL, NP, p => (s.ptOff[p] !== 0 ? s.ptSite[p] : -1), p => p));
  const NLC = packed(csr(NN, NL * 4, r => LN[r], r => r));
  // each point: its node, the loop whose normal it moves along, and how far (bits of an f32)
  const PI = new Uint32Array(NP * 3), offBits = new Uint32Array(Float32Array.from(s.ptOff).buffer);
  for (let p = 0; p < NP; p++) { PI[p * 3] = s.ptNode[p]; PI[p * 3 + 1] = s.ptSite[p]; PI[p * 3 + 2] = offBits[p]; }
  const FAB = new Uint32Array(NF * 2);
  for (let c = 0; c < NF; c++) { FAB[c * 2] = s.segA[c]; FAB[c * 2 + 1] = s.segB[c]; }
  const GI = new Uint32Array(NG * 3);
  for (let c = 0; c < NG; c++) { GI[c * 3] = s.fNode[c]; GI[c * 3 + 1] = s.fSite[c]; GI[c * 3 + 2] = s.fSide[c] > 0 ? 1 : 0; }

  const all: GPUBuffer[] = [];
  const mk = (bytes: number, usage = ST | CS | CD) => { const b = dev.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage }); all.push(b); return b; };
  const from = (a: Uint32Array | Float32Array) => { const b = mk(a.byteLength); if (a.byteLength) dev.queue.writeBuffer(b, 0, a); return b; };
  const U = (a: ArrayLike<number>) => Uint32Array.from(a), F = (a: ArrayLike<number>) => Float32Array.from(a);
  const B: Record<string, GPUBuffer> = {
    LN: from(LN), LT: from(LT), PI: from(PI), SEG: from(U(seg)), LC: from(packed([U(s.lenStart), U(s.lenPts)])), FAB: from(FAB), FM: from(F(s.segMax)),
    BT: from(U(s.bend)), EA: from(U(s.xA)), EB: from(U(s.xB)), EM: from(F(s.xMax)), GI: from(GI), NPC: from(NPC), SPC: from(SPC), NLC: from(NLC),
  };
  // ---- state
  const xs = warm && warm.length === L3 ? warm : s.init, x0 = new Int32Array(L3);
  for (let j = 0; j < L3; j++) x0[j] = Math.round(xs[j] * FIX);
  const X2 = [mk(L3 * 4), mk(L3 * 4)], G2 = [mk(L3 * 4), mk(L3 * 4)], P2 = [mk(NP * 16), mk(NP * 16)], N2 = [mk(NL * 12), mk(NL * 12)];
  dev.queue.writeBuffer(X2[0], 0, x0);
  const slot = Math.ceil(L3 * 4 / 256) * 256; // history slots start on a binding-offset boundary
  Object.assign(B, {
    Q: mk(L3 * 4), SH: mk(slot * HIST), YH: mk(slot * HIST), PTS: mk(NP * 12), AT: mk(NP * 12), GP: mk(NP * 12), GA: mk(L3 * 4 + NL * 12),
    LG: mk(NL * 48), SC: mk(64 * 4), CNT: mk(16 * 4), IND: mk(16 * 4, ST | CD | GPUBufferUsage.INDIRECT),
  });
  const NPD = Math.ceil(L3 / RW);
  B.PD = mk(NPD * 4); B.PM = mk(NPD * 4);
  const readBuf = [0, 1].map(() => dev.createBuffer({ size: 64 * 4 + 16 * 4, usage: GPUBufferUsage.MAP_READ | CD }));
  // capacities that can grow: pairs, grid entries (and the hashed grid sized from them)
  let PCAP = NS * 8, ECAP = NS * 12;

  let pipes = new Map<string, { pipe: GPUComputePipeline; kern: Kern }>();
  let NPE = 0, OFF: Record<string, number> = {};
  const groups = new Map<string, GPUBindGroup>();
  const uni = new Map<string, GPUBuffer>();
  const uniOf = (v: number[]) => {
    const k = v.join(',');
    let b = uni.get(k);
    if (!b) { b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | CD }); dev.queue.writeBuffer(b, 0, Uint32Array.from([...v, 0, 0, 0, 0].slice(0, 4))); uni.set(k, b); all.push(b); }
    return b;
  };

  function sizedBuffers() {
    for (const k of ['PAB', 'ENT', 'HEAD', 'PE']) if (B[k]) B[k].destroy();
    let H = 1;
    while (H < ECAP) H <<= 1;
    const parts = { contact: Math.ceil(PCAP / WG), len: Math.ceil(NL / WG), flt: Math.ceil(NF / WG), minsp: Math.ceil(NS / WG), bend: Math.ceil(NB / WG), edge: Math.ceil(NE / WG), gap: Math.ceil(NG / WG) };
    OFF = {}; NPE = 0;
    for (const [k, v] of Object.entries(parts)) { OFF[k] = NPE; NPE += v; }
    B.PAB = mk(PCAP * 8); B.ENT = mk(ECAP * 12); B.HEAD = mk(H * 4); B.PE = mk(NPE * 8);
    groups.clear();
    pipes = new Map(kernels().map(k => [k.name, { kern: k, pipe: dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: wgsl(k, H) }), entryPoint: 'main' } }) }]));
  }

  // ---- WGSL
  const kb = bendOf(s.prm.stiff), R = (d + MARGIN) / 2, CELL = Math.max(0.45, 2 * R), CAP = 0.5 * d;
  const f = (v: number) => { const r = String(v); return /[.e]/.test(r) ? r : r + '.0'; };
  function wgsl(k: Kern, H: number) {
    const decl = k.binds.map(([n, kind, e = 'f32'], i) => kind === 'u' ? `@group(0) @binding(${i}) var<uniform> ${n}: vec4u;`
      : `@group(0) @binding(${i}) var<storage, ${kind === 'r' ? 'read' : 'read_write'}> ${n}: array<${kind === 'a' ? 'atomic<u32>' : e}>;`).join('\n');
    const helpers = k.binds.map(([n, kind, e = 'f32']) => {
      // float add by exchange: take the sum out (leaving 0), add, put it back; a value found there meanwhile is another
      // thread's part sum, taken along into the next round. Not atomicCompareExchangeWeak: Safari 27.2 turns every use
      // of it into Metal that doesn't compile ("field may not be qualified with an address space"). Sums are only read
      // by later dispatches, never while they're being added to.
      if (kind === 'a') return `fn add_${n}(i: u32, v: f32) { if (v == 0.0) { return; } var s = v; loop { s += bitcast<f32>(atomicExchange(&${n}[i], 0u)); let p = atomicExchange(&${n}[i], bitcast<u32>(s)); if (p == 0u) { break; } s = bitcast<f32>(p); } }
fn get_${n}(i: u32) -> f32 { return bitcast<f32>(atomicLoad(&${n}[i])); }
fn v3_${n}(i: u32) -> vec3f { return vec3f(get_${n}(i * 3u), get_${n}(i * 3u + 1u), get_${n}(i * 3u + 2u)); }
fn add3_${n}(i: u32, v: vec3f) { add_${n}(i * 3u, v.x); add_${n}(i * 3u + 1u, v.y); add_${n}(i * 3u + 2u, v.z); }`;
      if (kind !== 'u' && e === 'i32') return `fn d_${n}(a: u32, b: u32) -> vec3f { return vec3f(f32(${n}[a * 3u] - ${n}[b * 3u]), f32(${n}[a * 3u + 1u] - ${n}[b * 3u + 1u]), f32(${n}[a * 3u + 2u] - ${n}[b * 3u + 2u])) * IFIX; }
fn p_${n}(a: u32) -> vec3f { return vec3f(f32(${n}[a * 3u]), f32(${n}[a * 3u + 1u]), f32(${n}[a * 3u + 2u])) * IFIX; }`;
      if (kind !== 'u' && e === 'f32') return `fn v3_${n}(i: u32) -> vec3f { return vec3f(${n}[i * 3u], ${n}[i * 3u + 1u], ${n}[i * 3u + 2u]); }`
        + (kind === 'rw' ? `\nfn set3_${n}(i: u32, v: vec3f) { ${n}[i * 3u] = v.x; ${n}[i * 3u + 1u] = v.y; ${n}[i * 3u + 2u] = v.z; }` : '');
      return '';
    }).join('\n');
    const consts = `const NL = ${NL}u; const NN = ${NN}u; const NP = ${NP}u; const NS = ${NS}u; const NF = ${NF}u; const NB = ${NB}u; const NE = ${NE}u; const NG = ${NG}u;
const L3 = ${L3}u; const NPD = ${NPD}u; const NPE = ${NPE}u; const PCAP = ${PCAP}u; const ECAP = ${ECAP}u; const HM = ${H - 1}u;
const D = ${f(d)}; const KH = ${f(K.hard)}; const KL = ${f(K.len)}; const KB = ${f(kb)}; const EPS2 = ${f(EPS2)}; const R = ${f(R)}; const CELL = ${f(CELL)};
const LIM = ${f((MARGIN / 2) ** 2)}; const CAP = ${f(CAP)}; const NONE = ${NONE}u; const FIX = ${f(FIX)}; const IFIX = ${f(1 / FIX)}; const LQ = 67108864.0;`;
    const red = `var<workgroup> red: array<vec2f, ${k.wg ?? WG}>;
fn reduce_to(l: u32, v: vec2f, base: u32, g: u32, n: u32) {
  red[l] = v; workgroupBarrier();
  for (var s = ${(k.wg ?? WG) / 2}u; s > 0u; s >>= 1u) { if (l < s) { red[l] += red[l + s]; } workgroupBarrier(); }
  if (l == 0u && g * ${k.wg ?? WG}u < n) { PE[base + g] = red[0].x; PE[NPE + base + g] = red[0].y; }
}`;
    return `${consts}\n${decl}\n${LIN}\n${helpers}\n${k.binds.some(b => b[0] === 'PE') ? red : ''}\n${k.body}`;
  }
  const head = (wg = WG) => `@compute @workgroup_size(${wg}) fn main(@builtin(workgroup_id) w: vec3u, @builtin(num_workgroups) nw: vec3u, @builtin(local_invocation_index) l: u32)`;
  // energy-term kernels end with the workgroup's sums of the terms' changes (de) and new values (en), into its slots of PE
  const term = (name: string, binds: Bind[], count: string, off: string, body: string): Kern => ({
    name, binds: [...binds, ['PE', 'rw']], body: `${head()} {
  let i = lin(w, nw, l, ${WG}u);
  var de = 0.0; var en = 0.0;
  if (i < ${count}) {
${body}
  }
  reduce_to(l, vec2f(de, en), ${off}, w.x + w.y * nw.x, ${count});
}`,
  });
  // closest points of two segments, as relax.ts (Ericson, Real-Time Collision Detection, 5.1.9), from the vectors u, v
  // along them and r between their starts. In single precision the interior solution is poorly placed for nearly
  // parallel segments (yarn lying side by side, or along one yarn), and where the true closest pair is at an end
  // that error goes straight into the distance; so the distance is the least of the interior pair and each end
  // against the other segment (the same exact distance, found stably), with a·e − b² as |u × v|²
  const closest = `struct CP { v: vec3f, s: f32, t: f32 }
fn better(c: CP, v: vec3f, s: f32, t: f32) -> CP { if (dot(v, v) < dot(c.v, c.v)) { return CP(v, s, t); } return c; }
fn closest(u: vec3f, v: vec3f, r: vec3f) -> CP {
  let a = dot(u, u); let e = dot(v, v); let f = dot(v, r);
  var s = 0.0; var t = 0.0;
  if (a <= 1e-12) { if (e > 1e-12) { t = clamp(f / e, 0.0, 1.0); } }
  else {
    let c = dot(u, r);
    if (e <= 1e-12) { s = clamp(-c / a, 0.0, 1.0); }
    else {
      let b = dot(u, v); let n = cross(u, v); let den = dot(n, n);
      if (den > 1e-12) { s = clamp(dot(cross(n, v), r) / den, 0.0, 1.0); }
      t = (b * s + f) / e;
      if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); } else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
    }
  }
  var best = CP(r + s * u - t * v, s, t);
  if (a > 1e-12 && e > 1e-12) {
    let t0 = clamp(f / e, 0.0, 1.0); best = better(best, r - t0 * v, 0.0, t0);
    let w1 = r + u; let t1 = clamp(dot(w1, v) / e, 0.0, 1.0); best = better(best, w1 - t1 * v, 1.0, t1);
    let s0 = clamp(-dot(r, u) / a, 0.0, 1.0); best = better(best, r + s0 * u, s0, 0.0);
    let w2 = r - v; let s1 = clamp(-dot(w2, u) / a, 0.0, 1.0); best = better(best, w2 + s1 * u, s1, 1.0);
  }
  return best;
}`;
  // vectors between points from node differences plus offset differences: differences of nearby coordinates are exact,
  // so distances between points are as precise as the points are close, not as precise as their coordinates are large
  const rel = `fn nodeN(p: u32) -> u32 { return bitcast<u32>(OFN[p * 4u + 3u]); }
fn dN(p: u32, q: u32) -> vec3f { return d_XN(nodeN(p), nodeN(q)) + (vec3f(OFN[p * 4u], OFN[p * 4u + 1u], OFN[p * 4u + 2u]) - vec3f(OFN[q * 4u], OFN[q * 4u + 1u], OFN[q * 4u + 2u])); }
fn dO(p: u32, q: u32) -> vec3f { return d_X(nodeN(p), nodeN(q)) + (vec3f(OFNO[p * 4u], OFNO[p * 4u + 1u], OFNO[p * 4u + 2u]) - vec3f(OFNO[q * 4u], OFNO[q * 4u + 1u], OFNO[q * 4u + 2u])); }`;
  const pack = `fn cellOf(p: vec3f) -> vec3i { return vec3i(floor(p / CELL)); }
fn pack(c: vec3i) -> u32 { return ((u32(c.x) & 2047u) << 21u) | ((u32(c.y) & 2047u) << 10u) | (u32(c.z) & 1023u); }
fn hashc(k: u32) -> u32 { var h = k * 2654435761u; h ^= h >> 15u; h *= 2246822519u; h ^= h >> 13u; return h & HM; }`;
  // the angle between two segments, to about 1e-7: WGSL's atan2 may be off by thousands of ulps, enough to drown the
  // energy changes the line search compares; this one is the series for atan after reducing to |u| ≤ tan(π/12)
  const bendE = `fn atanr(u: f32) -> f32 { let v = u * u; return u * (1.0 + v * (-0.333333333 + v * (0.2 + v * (-0.142857143 + v * (0.111111111 + v * -0.0909090909))))); }
fn atan1(t: f32) -> f32 { let a = abs(t); var r = atanr(a); if (a > 0.2679491924) { r = 0.5235987756 + atanr((a * 1.7320508076 - 1.0) / (1.7320508076 + a)); } return select(r, -r, t < 0.0); }
fn angle(y: f32, x: f32) -> f32 { // atan2 for y ≥ 0
  if (x >= y) { if (x <= 0.0) { return 0.0; } return atan1(y / x); }
  if (x > -y) { return 1.5707963268 - atan1(x / y); }
  return 3.1415926536 + atan1(y / x);
}
fn bendE(e1: vec3f, e2: vec3f) -> f32 {
  let q1 = dot(e1, e1); let q2 = dot(e2, e2);
  if (q1 < 1e-18 || q2 < 1e-18) { return 0.0; }
  let th = angle(length(cross(e1, e2)), dot(e1, e2)); return KB * th * th / ((sqrt(q1) + sqrt(q2)) / 2.0);
}`;
  // the fold-back barrier (relax.ts); WGSL has no infinity, so where two points meet the energy is just huge
  const fold = `fn fold(l: f32) -> f32 {
  if (l >= D / 4.0) { return 0.0; }
  if (l <= 0.0) { return 1e30; }
  let u = l / (D / 4.0); return -KH * D * D / 16.0 * (1.0 - u) * (1.0 - u) * log(u);
}`;
  const dims = `fn dims(o: u32, n: u32, s: u32) { let g = (n + s - 1u) / s; IND[o] = min(g, 32768u); IND[o + 1u] = max(1u, (g + 32767u) / 32768u); IND[o + 2u] = 1u; if (g == 0u) { IND[o] = 0u; } }`;

  function kernels(): Kern[] {
    const list: Kern[] = [
      // each loop's crossing normal, from its legs and head
      { name: 'normals', binds: [['XN', 'r', 'i32'], ['LN', 'r', 'u32'], ['NRM', 'rw']], body: `${head()} {
  let i = lin(w, nw, l, ${WG}u); if (i >= NL) { return; }
  let a = LN[i * 4u]; let b = LN[i * 4u + 1u]; let c = LN[i * 4u + 2u]; let f = LN[i * 4u + 3u];
  let v = cross(d_XN(b, a) + d_XN(f, c), d_XN(c, a) + d_XN(f, b)); set3_NRM(i, v / sqrt(dot(v, v) + EPS2));
}` },
      // points: a node moved along its crossing's normal; flags a rebuild when one has moved half the margin
      { name: 'points', binds: [['XN', 'r', 'i32'], ['NRM', 'r'], ['PI', 'r', 'u32'], ['PTS', 'rw'], ['OFN', 'rw'], ['AT', 'r'], ['CNT', 'a']], body: `${head()} {
  let p = lin(w, nw, l, ${WG}u); if (p >= NP) { return; }
  let node = PI[p * 3u]; let o = v3_NRM(PI[p * 3u + 1u]) * bitcast<f32>(PI[p * 3u + 2u]);
  OFN[p * 4u] = o.x; OFN[p * 4u + 1u] = o.y; OFN[p * 4u + 2u] = o.z; OFN[p * 4u + 3u] = bitcast<f32>(node);
  let v = p_XN(node) + o; set3_PTS(p, v);
  let m = v - v3_AT(p); if (dot(m, m) > LIM) { atomicStore(&CNT[4], 1u); }
}` },
      { name: 'prep', binds: [['CNT', 'a'], ['IND', 'rw', 'u32']], body: `${dims}
@compute @workgroup_size(1) fn main() {
  atomicStore(&CNT[5], 0u);
  if (atomicLoad(&CNT[4]) == 1u) {
    atomicStore(&CNT[4], 0u); atomicStore(&CNT[8], 1u); atomicStore(&CNT[0], 0u); atomicStore(&CNT[1], 0u); atomicAdd(&CNT[6], 1u);
    dims(0u, NS, ${WG}u); dims(3u, HM + 1u, ${WG}u);
  } else { atomicStore(&CNT[8], 0u); dims(0u, 0u, ${WG}u); dims(3u, 0u, ${WG}u); }
}` },
      { name: 'headclear', binds: [['HEAD', 'rw', 'u32']], body: `${head()} { let i = lin(w, nw, l, ${WG}u); if (i <= HM) { HEAD[i] = NONE; } }` },
      // every segment into each grid cell its box (grown by half the thickness and margin) touches
      { name: 'insert', binds: [['PTS', 'r'], ['SEG', 'r', 'u32'], ['ENT', 'rw', 'u32'], ['HEAD', 'a'], ['CNT', 'a'], ['AT', 'rw']], body: `${pack}
${head()} {
  let q = lin(w, nw, l, ${WG}u); if (q >= NS) { return; }
  let p = SEG[q]; let A = v3_PTS(p); let Bp = v3_PTS(p + 1u);
  set3_AT(p, A); set3_AT(p + 1u, Bp);
  let c0 = cellOf(min(A, Bp) - vec3f(R)); let c1 = cellOf(max(A, Bp) + vec3f(R));
  for (var i = c0.x; i <= c1.x; i++) { for (var j = c0.y; j <= c1.y; j++) { for (var k = c0.z; k <= c1.z; k++) {
    let e = atomicAdd(&CNT[1], 1u);
    if (e >= ECAP) { atomicStore(&CNT[3], 1u); continue; }
    let c = pack(vec3i(i, j, k));
    ENT[e * 3u] = q; ENT[e * 3u + 1u] = c; ENT[e * 3u + 2u] = atomicExchange(&HEAD[hashc(c)], e);
  } } }
}` },
      { name: 'entprep', binds: [['CNT', 'a'], ['IND', 'rw', 'u32']], body: `${dims}
@compute @workgroup_size(1) fn main() { if (atomicLoad(&CNT[8]) == 1u) { dims(6u, min(atomicLoad(&CNT[1]), ECAP), ${WG}u); } else { dims(6u, 0u, ${WG}u); } }` },
      // pairs: two entries in the same cell, not neighbours along a yarn, boxes overlapping, kept only in the cell
      // holding the low corner of the overlap (so each pair once), found from the entry of the lower segment
      { name: 'pairs', binds: [['ENT', 'r', 'u32'], ['HEAD', 'a'], ['SEG', 'r', 'u32'], ['PTS', 'r'], ['PAB', 'rw', 'u32'], ['CNT', 'a']], body: `${pack}
${head()} {
  let e = lin(w, nw, l, ${WG}u); if (e >= min(atomicLoad(&CNT[1]), ECAP)) { return; }
  let qa = ENT[e * 3u]; let c = ENT[e * 3u + 1u]; let sa = SEG[qa];
  let a0 = v3_PTS(sa); let a1 = v3_PTS(sa + 1u); let alo = min(a0, a1) - vec3f(R); let ahi = max(a0, a1) + vec3f(R);
  var x = atomicLoad(&HEAD[hashc(c)]);
  loop {
    if (x == NONE) { break; }
    let qb = ENT[x * 3u]; let sb = SEG[qb];
    if (ENT[x * 3u + 1u] == c && sb > sa + 1u) {
      let b0 = v3_PTS(sb); let b1 = v3_PTS(sb + 1u); let lo = max(alo, min(b0, b1) - vec3f(R)); let hi = min(ahi, max(b0, b1) + vec3f(R));
      if (all(lo <= hi) && pack(cellOf(lo)) == c) {
        let n = atomicAdd(&CNT[0], 1u);
        if (n < PCAP) { PAB[n * 2u] = sa; PAB[n * 2u + 1u] = sb; } else { atomicStore(&CNT[2], 1u); }
      }
    }
    x = ENT[x * 3u + 2u];
  }
}` },
      { name: 'pairprep', binds: [['CNT', 'a'], ['IND', 'rw', 'u32']], body: `${dims}
@compute @workgroup_size(1) fn main() { let n = min(atomicLoad(&CNT[0]), PCAP); atomicStore(&CNT[9], n); dims(9u, n, ${WG}u); }` },
      // yarn can't pass through yarn
      term('contact', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['OFN', 'r'], ['OFNO', 'r'], ['PAB', 'r', 'u32'], ['CNT', 'a'], ['GP', 'a']], 'atomicLoad(&CNT[9])', 'OFFC', `
    let p0 = PAB[i * 2u]; let q0 = PAB[i * 2u + 1u];
    let cn = closest(dN(p0 + 1u, p0), dN(q0 + 1u, q0), dN(p0, q0));
    let co = closest(dO(p0 + 1u, p0), dO(q0 + 1u, q0), dO(p0, q0));
    let ln = length(cn.v); let lo = length(co.v);
    let Cn = select(0.0, D - ln, ln < D); let Co = select(0.0, D - lo, lo < D);
    de = 0.5 * KH * (Cn - Co) * (Cn + Co); en = 0.5 * KH * Cn * Cn;
    if (Cn > 0.0 && ln >= 1e-9) {
      let g = (-KH * Cn / ln) * cn.v;
      add3_GP(p0, (1.0 - cn.s) * g); add3_GP(p0 + 1u, cn.s * g); add3_GP(q0, -(1.0 - cn.t) * g); add3_GP(q0 + 1u, -cn.t * g);
    }`),
      // every stitch keeps its length of yarn
      term('len', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['OFN', 'r'], ['OFNO', 'r'], ['LC', 'r', 'u32'], ['LT', 'r'], ['GP', 'a']], 'NL', 'OFFL', `
    let a = LC[i]; let b = LC[i + 1u];
    // the stretch, old and new, as fixed-point sums of the segments' lengths each rounded on its own (2^-26 of a
    // pitch): a float sum rounds at the loop's whole length, and the compiler may fuse a difference of two lengths
    // into one rounding, so equal positions wouldn't give exactly no change
    let t = i32(round(LT[i] * LQ)); var qn = -t; var qo = -t;
    for (var j = a; j + 1u < b; j++) {
      let p = LC[NL + 1u + j]; let q = LC[NL + 2u + j];
      qn += i32(round(length(dN(q, p)) * LQ)); qo += i32(round(length(dO(q, p)) * LQ));
    }
    let Cn = f32(qn) / LQ; let Co = f32(qo) / LQ;
    de = 0.5 * KL * (f32(qn - qo) / LQ) * (Cn + Co); en = 0.5 * KL * Cn * Cn;
    let fl = KL * Cn;
    for (var j = a; j + 1u < b; j++) {
      let p = LC[NL + 1u + j]; let q = LC[NL + 2u + j];
      let v = dN(q, p); var ll = length(v); if (ll == 0.0) { ll = 1e-12; }
      add3_GP(q, (fl / ll) * v); add3_GP(p, -(fl / ll) * v);
    }`),
      // floats and turns: no longer than laid
      term('flt', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['OFN', 'r'], ['OFNO', 'r'], ['FAB', 'r', 'u32'], ['FM', 'r'], ['GP', 'a']], 'NF', 'OFFF', `
    let fa = FAB[i * 2u]; let fb = FAB[i * 2u + 1u];
    let v = dN(fb, fa); let ln = length(v); let lo = length(dO(fb, fa));
    let Cn = max(0.0, ln - FM[i]); let Co = max(0.0, lo - FM[i]);
    de = 0.5 * KH * (Cn - Co) * (Cn + Co); en = 0.5 * KH * Cn * Cn;
    if (Cn > 0.0) { let h = KH * Cn / ln; add3_GP(fb, h * v); add3_GP(fa, -h * v); }`),
      // yarn doesn't fold back on itself: consecutive points at least half a thickness apart, and the barrier
      term('minsp', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['OFN', 'r'], ['OFNO', 'r'], ['SEG', 'r', 'u32'], ['GP', 'a']], 'NS', 'OFFM', `
    let p = SEG[i]; let v = dN(p + 1u, p); let ln = length(v); let lo = length(dO(p + 1u, p));
    let Cn = select(0.0, D / 2.0 - ln, ln < D / 2.0); let Co = select(0.0, D / 2.0 - lo, lo < D / 2.0);
    let bn = fold(ln);
    de = 0.5 * KH * (Cn - Co) * (Cn + Co) + (bn - fold(lo)); en = 0.5 * KH * Cn * Cn + bn;
    if (Cn > 0.0 && ln > 0.0) {
      var k = KH * Cn / ln;
      if (ln < D / 4.0) { let u = ln / (D / 4.0); k -= KH * D / 4.0 * (2.0 * (1.0 - u) * log(u) - (1.0 - u) * (1.0 - u) / u) / ln; }
      add3_GP(p, k * v); add3_GP(p + 1u, -k * v);
    }`),
      // bending: θ² / l at every point along a yarn, θ the angle between its two segments, l their mean length
      term('bend', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['OFN', 'r'], ['OFNO', 'r'], ['BT', 'r', 'u32'], ['GP', 'a']], 'NB', 'OFFB', `
    let ia = BT[i * 3u]; let im = BT[i * 3u + 1u]; let ib = BT[i * 3u + 2u];
    let e1 = dN(im, ia); let e2 = dN(ib, im);
    en = bendE(e1, e2); de = en - bendE(dO(im, ia), dO(ib, im));
    let q1 = dot(e1, e1); let q2 = dot(e2, e2);
    if (q1 >= 1e-18 && q2 >= 1e-18) {
      let l1 = sqrt(q1); let l2 = sqrt(q2); let lm = (l1 + l2) / 2.0; let c = cross(e1, e2); let cl = length(c);
      let th = angle(cl, dot(e1, e2));
      let r = -KB * th * th / (lm * lm) / 2.0;
      var g1 = (r / l1) * e1; var g2 = (r / l2) * e2;
      if (cl >= 1e-12) { let bb = c / cl; g1 -= cross(bb, e1) * (2.0 * KB * th / lm / q1); g2 += cross(bb, e2) * (2.0 * KB * th / lm / q2); }
      add3_GP(ia, -g1); add3_GP(im, g1 - g2); add3_GP(ib, g2);
    }`),
      // edges held as if cast on and bound off
      term('edge', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['EA', 'r', 'u32'], ['EB', 'r', 'u32'], ['EM', 'r'], ['GA', 'a']], 'NE', 'OFFE', `
    let v = d_XN(EB[i], EA[i]); let ln = length(v); let lo = length(d_X(EB[i], EA[i]));
    let Cn = max(0.0, ln - EM[i]); let Co = max(0.0, lo - EM[i]);
    de = 0.5 * KH * (Cn - Co) * (Cn + Co); en = 0.5 * KH * Cn * Cn;
    if (Cn > 0.0) { let h = KH * Cn / ln; add3_GA(EB[i], h * v); add3_GA(EA[i], -h * v); }`),
      // a float stays on the gap side of the loop in the hook it passes
      term('gap', [['XN', 'r', 'i32'], ['X', 'r', 'i32'], ['NRM', 'r'], ['NRMO', 'r'], ['LN', 'r', 'u32'], ['GI', 'r', 'u32'], ['GA', 'a']], 'NG', 'OFFG', `
    let fn0 = GI[i * 3u]; let h = GI[i * 3u + 1u]; let sd = select(-1.0, 1.0, GI[i * 3u + 2u] == 1u); let a = LN[h * 4u]; let b = LN[h * 4u + 1u];
    let rn = (d_XN(fn0, a) + d_XN(fn0, b)) / 2.0; let ro = (d_X(fn0, a) + d_X(fn0, b)) / 2.0;
    let n = v3_NRM(h);
    let Cn = max(0.0, dot(rn, n) * sd + D * 0.5); let Co = max(0.0, dot(ro, v3_NRMO(h)) * sd + D * 0.5);
    de = 0.5 * KH * (Cn - Co) * (Cn + Co); en = 0.5 * KH * Cn * Cn;
    if (Cn > 0.0) { let k = KH * Cn * sd; add3_GA(fn0, k * n); add3_GA(a, -0.5 * k * n); add3_GA(b, -0.5 * k * n); add3_GA(NN + h, k * rn); }`),
      // points back to their loops' normals, normals back to the loops' four nodes
      { name: 'loopback', binds: [['GP', 'a'], ['GA', 'a'], ['SPC', 'r', 'u32'], ['PI', 'r', 'u32'], ['NRM', 'r'], ['XN', 'r', 'i32'], ['LN', 'r', 'u32'], ['LG', 'rw']], body: `${head()} {
  let i = lin(w, nw, l, ${WG}u); if (i >= NL) { return; }
  var G = v3_GA(NN + i);
  for (var k = SPC[i]; k < SPC[i + 1u]; k++) { let p = SPC[NL + 1u + k]; G += v3_GP(p) * bitcast<f32>(PI[p * 3u + 2u]); }
  let a = LN[i * 4u]; let b = LN[i * 4u + 1u]; let c = LN[i * 4u + 2u]; let f = LN[i * 4u + 3u];
  let ac = d_XN(b, a) + d_XN(f, c); let up = d_XN(c, a) + d_XN(f, b); let v = cross(ac, up);
  let n = v3_NRM(i); let V = (G - dot(G, n) * n) / sqrt(dot(v, v) + EPS2);
  let A = cross(up, V); let Uu = cross(V, ac);
  set3_LG(i * 4u, -A - Uu); set3_LG(i * 4u + 1u, A - Uu); set3_LG(i * 4u + 2u, -A + Uu); set3_LG(i * 4u + 3u, A + Uu);
}` },
      { name: 'gather', binds: [['GP', 'a'], ['GA', 'a'], ['NPC', 'r', 'u32'], ['NLC', 'r', 'u32'], ['LG', 'r'], ['GN', 'rw'], ['CNT', 'a']], body: `${head()} {
  let n = lin(w, nw, l, ${WG}u); if (n >= NN) { return; }
  var g = v3_GA(n);
  for (var k = NPC[n]; k < NPC[n + 1u]; k++) { g += v3_GP(NPC[NN + 1u + k]); }
  for (var k = NLC[n]; k < NLC[n + 1u]; k++) { g += v3_LG(NLC[NN + 1u + k]); }
  set3_GN(n, g);
  atomicMax(&CNT[5], bitcast<u32>(max(abs(g.x), max(abs(g.y), abs(g.z)))));
}` },
      { name: 'reduceE', wg: RW, binds: [['PE', 'rw'], ['SC', 'rw']], body: `var<workgroup> rs: array<vec2f, ${RW}>;
@compute @workgroup_size(${RW}) fn main(@builtin(local_invocation_index) l: u32) {
  var v = vec2f(0.0); for (var i = l; i < NPE; i += ${RW}u) { v += vec2f(PE[i], PE[NPE + i]); }
  rs[l] = v; workgroupBarrier();
  for (var s = ${RW / 2}u; s > 0u; s >>= 1u) { if (l < s) { rs[l] += rs[l + s]; } workgroupBarrier(); }
  if (l == 0u) { SC[0] = rs[0].x; SC[4] = rs[0].y; }
}` },
      // ---- L-BFGS, on vectors of all node coordinates
      { name: 'neg', binds: [['G', 'r'], ['Q', 'rw']], body: `${head()} { let i = lin(w, nw, l, ${WG}u); if (i < L3) { Q[i] = -G[i]; } }` },
      { name: 'dotp', wg: RW, binds: [['A', 'r'], ['B2', 'r'], ['PD', 'rw']], body: `var<workgroup> rs: array<f32, ${RW}>;
@compute @workgroup_size(${RW}) fn main(@builtin(workgroup_id) w: vec3u, @builtin(num_workgroups) nw: vec3u, @builtin(local_invocation_index) l: u32) {
  let g = w.x + w.y * nw.x; let i = g * ${RW}u + l;
  rs[l] = select(0.0, A[i] * B2[i], i < L3); workgroupBarrier();
  for (var s = ${RW / 2}u; s > 0u; s >>= 1u) { if (l < s) { rs[l] += rs[l + s]; } workgroupBarrier(); }
  if (l == 0u) { PD[g] = rs[0]; }
}` },
      // P.x: 0 SC[P.y] = sum · 1 alpha_i = rho_i sum · 2 alpha_i - rho_i sum · 3 sy · 4 yy → rho_i, gamma
      { name: 'dotf', wg: RW, binds: [['PD', 'r'], ['SC', 'rw'], ['P', 'u']], body: `var<workgroup> rs: array<f32, ${RW}>;
@compute @workgroup_size(${RW}) fn main(@builtin(local_invocation_index) l: u32) {
  var v = 0.0; for (var i = l; i < NPD; i += ${RW}u) { v += PD[i]; }
  rs[l] = v; workgroupBarrier();
  for (var s = ${RW / 2}u; s > 0u; s >>= 1u) { if (l < s) { rs[l] += rs[l + s]; } workgroupBarrier(); }
  if (l == 0u) {
    let sum = rs[0]; let i = P.y;
    if (P.x == 0u) { SC[i] = sum; }
    else if (P.x == 1u) { SC[20u + i] = SC[10u + i] * sum; }
    else if (P.x == 2u) { SC[30u + i] = SC[20u + i] - SC[10u + i] * sum; }
    else if (P.x == 3u) { SC[7] = sum; }
    else { let sy = SC[7]; if (sy > 1e-12) { SC[10u + i] = 1.0 / sy; SC[6] = sy / sum; } else { SC[10u + i] = 0.0; } }
  }
}` },
      { name: 'axpy', binds: [['Q', 'rw'], ['A', 'r'], ['SC', 'r'], ['P', 'u']], body: `${head()} {
  let i = lin(w, nw, l, ${WG}u); if (i >= L3) { return; }
  let c = SC[P.x]; if (P.y == 1u) { Q[i] += c * A[i]; } else { Q[i] -= c * A[i]; }
}` },
      { name: 'scale', binds: [['Q', 'rw'], ['SC', 'r']], body: `${head()} { let i = lin(w, nw, l, ${WG}u); if (i < L3) { Q[i] *= SC[6]; } }` },
      { name: 'dmax', wg: RW, binds: [['Q', 'r'], ['G', 'r'], ['PD', 'rw'], ['PM', 'rw']], body: `var<workgroup> rs: array<f32, ${RW}>; var<workgroup> rm: array<f32, ${RW}>;
@compute @workgroup_size(${RW}) fn main(@builtin(workgroup_id) w: vec3u, @builtin(num_workgroups) nw: vec3u, @builtin(local_invocation_index) l: u32) {
  let g = w.x + w.y * nw.x; let i = g * ${RW}u + l;
  rs[l] = select(0.0, Q[i] * G[i], i < L3); rm[l] = select(0.0, abs(Q[i]), i < L3); workgroupBarrier();
  for (var s = ${RW / 2}u; s > 0u; s >>= 1u) { if (l < s) { rs[l] += rs[l + s]; rm[l] = max(rm[l], rm[l + s]); } workgroupBarrier(); }
  if (l == 0u) { PD[g] = rs[0]; PM[g] = rm[0]; }
}` },
      // dg = q·g, the largest |q|, the first step (capped); P.x 1: first pass, flags a direction that isn't downhill
      { name: 'dmaxf', wg: RW, binds: [['PD', 'r'], ['PM', 'r'], ['SC', 'rw'], ['P', 'u']], body: `var<workgroup> rs: array<f32, ${RW}>; var<workgroup> rm: array<f32, ${RW}>;
@compute @workgroup_size(${RW}) fn main(@builtin(local_invocation_index) l: u32) {
  var v = 0.0; var m = 0.0; for (var i = l; i < NPD; i += ${RW}u) { v += PD[i]; m = max(m, PM[i]); }
  rs[l] = v; rm[l] = m; workgroupBarrier();
  for (var s = ${RW / 2}u; s > 0u; s >>= 1u) { if (l < s) { rs[l] += rs[l + s]; rm[l] = max(rm[l], rm[l + s]); } workgroupBarrier(); }
  if (l == 0u) {
    let dg = rs[0]; let big = rm[0];
    SC[1] = dg; SC[2] = big; SC[3] = select(1.0, CAP / big, big > CAP);
    let bad = select(1.0, 0.0, dg < 0.0);
    if (P.x == 1u) { SC[8] = bad; SC[9] = bad; } else { SC[8] = 0.0; }
  }
}` },
      { name: 'fallback', binds: [['G', 'r'], ['Q', 'rw'], ['SC', 'r']], body: `${head()} { let i = lin(w, nw, l, ${WG}u); if (i < L3 && SC[8] == 1.0) { Q[i] = -G[i] * 1e-3; } }` },
      { name: 'trial', binds: [['X', 'r', 'i32'], ['Q', 'r'], ['XN', 'rw', 'i32'], ['SC', 'r']], body: `${head()} { let i = lin(w, nw, l, ${WG}u); if (i < L3) { XN[i] = X[i] + i32(round(SC[3] * SC[5] * Q[i] * FIX)); } }` },
      { name: 'hist', binds: [['X', 'r', 'i32'], ['XN', 'r', 'i32'], ['G', 'r'], ['GN', 'r'], ['SS', 'rw'], ['YY', 'rw']], body: `${head()} {
  let i = lin(w, nw, l, ${WG}u); if (i < L3) { SS[i] = f32(XN[i] - X[i]) * IFIX; YY[i] = GN[i] - G[i]; }
}` },
    ];
    return list.map(k => ({ ...k, body: k.body.replace(/OFF([A-Z])/g, (_, c: string) => `${OFF[{ C: 'contact', L: 'len', F: 'flt', M: 'minsp', B: 'bend', E: 'edge', G: 'gap' }[c]!]}u`) }))
      .map(k => ({ ...k, body: (k.name === 'contact' ? closest + '\n' : k.name === 'bend' ? bendE + '\n' : k.name === 'minsp' ? fold + '\n' : '') + (k.binds.some(b => b[0] === 'OFNO') ? rel + '\n' : '') + k.body }));
  }

  // ---- encoding
  let par = 0;
  const phys = (name: string, extra: Record<string, GPUBufferBinding>): GPUBufferBinding => {
    if (extra[name]) return extra[name];
    switch (name) {
      case 'X': return { buffer: X2[par] }; case 'XN': return { buffer: X2[1 - par] };
      case 'G': return { buffer: G2[par] }; case 'GN': return { buffer: G2[1 - par] };
      case 'OFNO': return { buffer: P2[par] }; case 'OFN': return { buffer: P2[1 - par] };
      case 'NRMO': return { buffer: N2[par] }; case 'NRM': return { buffer: N2[1 - par] };
    }
    return { buffer: B[name] };
  };
  const hslot = (H: GPUBuffer, i: number): GPUBufferBinding => ({ buffer: H, offset: i * slot, size: L3 * 4 });
  function run(enc: GPUCommandEncoder, name: string, threads: number | [GPUBuffer, number], extra: Record<string, GPUBufferBinding> = {}, key = '') {
    const p = pipes.get(name)!;
    const gk = `${name}|${par}|${key}`;
    let bg = groups.get(gk);
    if (!bg) {
      bg = dev.createBindGroup({ layout: p.pipe.getBindGroupLayout(0), entries: p.kern.binds.map(([n, kind], i) => ({ binding: i, resource: kind === 'u' ? { buffer: extra[n].buffer } : phys(n, extra) })) });
      groups.set(gk, bg);
    }
    const pass = enc.beginComputePass();
    pass.setPipeline(p.pipe); pass.setBindGroup(0, bg);
    if (Array.isArray(threads)) pass.dispatchWorkgroupsIndirect(threads[0], threads[1]);
    else { const wg = p.kern.wg ?? WG, g = Math.ceil(threads / wg); if (g > 0) pass.dispatchWorkgroups(Math.min(g, 32768), Math.ceil(g / 32768)); }
    pass.end();
  }
  function evalAt(enc: GPUCommandEncoder) {
    enc.clearBuffer(B.GP); enc.clearBuffer(B.GA); enc.clearBuffer(B.PE);
    run(enc, 'normals', NL); run(enc, 'points', NP); run(enc, 'prep', 1);
    run(enc, 'headclear', [B.IND, 12]); run(enc, 'insert', [B.IND, 0]); run(enc, 'entprep', 1); run(enc, 'pairs', [B.IND, 24]);
    run(enc, 'pairprep', 1); run(enc, 'contact', [B.IND, 36]);
    run(enc, 'len', NL); run(enc, 'flt', NF); run(enc, 'minsp', NS); run(enc, 'bend', NB); run(enc, 'edge', NE); run(enc, 'gap', NG);
    run(enc, 'loopback', NL); run(enc, 'gather', NN); run(enc, 'reduceE', RW);
  }
  let rb = 0;
  async function readScalars(enc: GPUCommandEncoder) {
    const r = readBuf[rb]; rb ^= 1;
    enc.copyBufferToBuffer(B.SC, 0, r, 0, 64 * 4); enc.copyBufferToBuffer(B.CNT, 0, r, 64 * 4, 16 * 4);
    dev.queue.submit([enc.finish()]);
    await r.mapAsync(GPUMapMode.READ);
    const a = r.getMappedRange(), out = { sc: new Float32Array(a.slice(0, 64 * 4)), cnt: new Uint32Array(a.slice(64 * 4, 80 * 4)) };
    r.unmap();
    return out;
  }
  const setScalar = (i: number, v: number) => dev.queue.writeBuffer(B.SC, i * 4, Float32Array.of(v));
  async function grow(cnt: Uint32Array) { // a buffer overflowed: grow it, rebuild the pairs
    if (cnt[2]) PCAP = Math.ceil(Math.max(PCAP * 1.5, cnt[0] * 1.2));
    if (cnt[3]) ECAP = Math.ceil(Math.max(ECAP * 1.5, cnt[1] * 1.2));
    sizedBuffers();
    dev.queue.writeBuffer(B.CNT, 0, new Uint32Array(16).fill(0));
    dev.queue.writeBuffer(B.CNT, 4 * 4, Uint32Array.of(1));
  }

  // a kernel this browser can't compile would leave every point at 0: fall back to the CPU instead
  dev.pushErrorScope('validation'); dev.pushErrorScope('internal');
  sizedBuffers();
  const bad = (await dev.popErrorScope()) ?? (await dev.popErrorScope());
  if (bad) { console.warn('3D: the GPU relax could not be built here, relaxing on the CPU:', bad.message.split('\n').find(l => /error/.test(l)) ?? bad.message.slice(0, 200)); for (const b of all) b.destroy(); dev.destroy(); return null; }
  dev.queue.writeBuffer(B.CNT, 4 * 4, Uint32Array.of(1)); // first evaluation builds the pairs
  // the state at the start: evaluate at x (as a trial equal to it), then take it as the accepted point
  for (;;) {
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(X2[par], 0, X2[1 - par], 0, L3 * 4);
    evalAt(enc);
    const { cnt } = await readScalars(enc);
    if (cnt[2] || cnt[3]) { await grow(cnt); continue; }
    break;
  }
  par ^= 1;
  setScalar(6, 1e-3);

  let k = 0, stopped = false;
  const st: GpuRelax = {
    iter: 0, moved: Infinity, force: Infinity, dE: 0, energy: NaN, approx: 0, rebuilds: 0, pairs: 0, stuck: false,
    async steps(n: number) {
      let most = 0;
      for (let it = 0; it < n && !stopped; it++) {
        // direction: the L-BFGS two-loop recursion
        const enc = dev.createCommandEncoder(), h = Math.min(k, HIST), ix = (t2: number) => (k - 1 - t2) % HIST;
        if (k === 0) setScalar(6, 1e-3);
        run(enc, 'neg', L3);
        for (let t2 = 0; t2 < h; t2++) {
          const i = ix(t2);
          run(enc, 'dotp', L3, { A: hslot(B.SH, i), B2: { buffer: B.Q } }, `S${i}`); run(enc, 'dotf', 1, { P: { buffer: uniOf([1, i]) } }, `1,${i}`);
          run(enc, 'axpy', L3, { A: hslot(B.YH, i), P: { buffer: uniOf([20 + i, 0]) } }, `Y${i}`);
        }
        run(enc, 'scale', L3);
        for (let t2 = h - 1; t2 >= 0; t2--) {
          const i = ix(t2);
          run(enc, 'dotp', L3, { A: hslot(B.YH, i), B2: { buffer: B.Q } }, `Y${i}`); run(enc, 'dotf', 1, { P: { buffer: uniOf([2, i]) } }, `2,${i}`);
          run(enc, 'axpy', L3, { A: hslot(B.SH, i), P: { buffer: uniOf([30 + i, 1]) } }, `S${i}`);
        }
        run(enc, 'dmax', L3); run(enc, 'dmaxf', 1, { P: { buffer: uniOf([1]) } }, '1'); run(enc, 'fallback', L3);
        run(enc, 'dmax', L3); run(enc, 'dmaxf', 1, { P: { buffer: uniOf([0]) } }, '0');
        dev.queue.submit([enc.finish()]);
        // backtracking line search from the full step, capped
        let ok = false, a = 1, sc: Float32Array = new Float32Array(64), cnt: Uint32Array = new Uint32Array(16), fell = false;
        for (let tries = 0; tries < 30 && !ok; tries++) {
          setScalar(5, 0.5 ** tries);
          const e2 = dev.createCommandEncoder();
          run(e2, 'trial', L3); evalAt(e2);
          run(e2, 'dotp', L3, { A: { buffer: B.Q }, B2: { buffer: G2[1 - par] } }, 'QG'); run(e2, 'dotf', 1, { P: { buffer: uniOf([0, 40]) } }, '0,40');
          ({ sc, cnt } = await readScalars(e2));
          if (cnt[2] || cnt[3]) { await grow(cnt); tries--; continue; }
          if (tries === 0 && sc[9] === 1) fell = true;
          a = sc[3] * 0.5 ** tries;
          if (sc[0] <= 1e-4 * a * sc[1]) ok = true;
          // where the energy change is within single precision's reach of nothing, the slope decides instead (Hager &
          // Zhang's approximate Wolfe condition): the slope along the step, at its end, hasn't risen past 0.8 of its
          // start mirrored, so the change estimated from the two slopes is at least a tenth of the first-order drop
          // (and must move a node by at least one fixed-point unit: a step rounded to nothing changes nothing)
          else if (Math.abs(sc[0]) <= 1e-7 * sc[4] && sc[40] <= -0.8 * sc[1] && a * sc[2] * FIX >= 1) { ok = true; st.approx++; }
        }
        st.rebuilds = cnt[6]; st.pairs = cnt[9];
        if (fell) k = 0;
        if (!ok) { // no step lowers the energy along this direction: forget the history; stuck even from the gradient: done
          st.iter++;
          if (k === 0) { st.moved = 0; st.stuck = stopped = true; break; }
          k = 0; continue;
        }
        const i = k % HIST, e3 = dev.createCommandEncoder();
        run(e3, 'hist', L3, { SS: hslot(B.SH, i), YY: hslot(B.YH, i) }, `${i}`);
        run(e3, 'dotp', L3, { A: hslot(B.SH, i), B2: hslot(B.YH, i) }, `SY${i}`); run(e3, 'dotf', 1, { P: { buffer: uniOf([3, i]) } }, `3,${i}`);
        run(e3, 'dotp', L3, { A: hslot(B.YH, i), B2: hslot(B.YH, i) }, `YY${i}`); run(e3, 'dotf', 1, { P: { buffer: uniOf([4, i]) } }, `4,${i}`);
        dev.queue.submit([e3.finish()]);
        k++; par ^= 1;
        st.dE += sc[0]; st.energy = sc[4]; st.moved = a * sc[2]; st.force = new Float32Array(Uint32Array.of(cnt[5]).buffer)[0]; st.iter++;
        most = Math.max(most, st.moved);
      }
      return most;
    },
    async read() {
      const r = dev.createBuffer({ size: L3 * 4 + NL * 12, usage: GPUBufferUsage.MAP_READ | CD }), enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(X2[par], 0, r, 0, L3 * 4); enc.copyBufferToBuffer(N2[par], 0, r, L3 * 4, NL * 12);
      dev.queue.submit([enc.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const m = r.getMappedRange(), xi = new Int32Array(m.slice(0, L3 * 4)), nrm = new Float32Array(m.slice(L3 * 4)), pos = new Float32Array(L3);
      for (let j = 0; j < L3; j++) pos[j] = xi[j] / FIX;
      r.unmap(); r.destroy();
      return { pos, nrm };
    },
    async exact() {
      const r = dev.createBuffer({ size: L3 * 4, usage: GPUBufferUsage.MAP_READ | CD }), enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(X2[par], 0, r, 0, L3 * 4); dev.queue.submit([enc.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const xi = new Int32Array(r.getMappedRange().slice(0)); r.unmap(); r.destroy();
      return Float64Array.from(xi, v => v / FIX);
    },
    async gradient() {
      const r = dev.createBuffer({ size: L3 * 4, usage: GPUBufferUsage.MAP_READ | CD }), enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(G2[par], 0, r, 0, L3 * 4); dev.queue.submit([enc.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const g = new Float32Array(r.getMappedRange().slice(0)); r.unmap(); r.destroy();
      return g;
    },
    async probe(a: number) {
      const enc = dev.createCommandEncoder();
      run(enc, 'neg', L3); dev.queue.submit([enc.finish()]);
      setScalar(3, 1); setScalar(5, a);
      const e2 = dev.createCommandEncoder(); run(e2, 'trial', L3); evalAt(e2);
      const { sc } = await readScalars(e2);
      const r = dev.createBuffer({ size: L3 * 4, usage: GPUBufferUsage.MAP_READ | CD }), e3 = dev.createCommandEncoder();
      e3.copyBufferToBuffer(X2[1 - par], 0, r, 0, L3 * 4); dev.queue.submit([e3.finish()]);
      await r.mapAsync(GPUMapMode.READ); const xi = new Int32Array(r.getMappedRange().slice(0)); r.unmap(); r.destroy();
      const pos = Float64Array.from(xi, v => v / FIX);
      const pe = dev.createBuffer({ size: NPE * 4, usage: GPUBufferUsage.MAP_READ | CD }), e4 = dev.createCommandEncoder();
      e4.copyBufferToBuffer(B.PE, 0, pe, 0, NPE * 4); dev.queue.submit([e4.finish()]);
      await pe.mapAsync(GPUMapMode.READ); const P = new Float32Array(pe.getMappedRange().slice(0)); pe.unmap(); pe.destroy();
      const names = Object.keys(OFF), terms: Record<string, number> = {};
      names.forEach((n, k) => { let v = 0; for (let j = OFF[n]; j < (k + 1 < names.length ? OFF[names[k + 1]] : NPE); j++) v += P[j]; terms[n] = v; });
      return { dE: sc[0], pos, terms };
    },
    destroy() { stopped = true; for (const b of all) b.destroy(); for (const b of readBuf) b.destroy(); dev.destroy(); },
  };
  return st;
}
