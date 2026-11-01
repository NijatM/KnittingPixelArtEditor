// Relaxes the fabric off the main thread: on the GPU (relaxgpu.ts) where WebGPU is available and the fabric isn't
// small, else on the CPU (relax.ts; same model). A new job replaces the one running (its results are dropped); progress is posted a few
// times a second so the shape can be watched settling.
import type { Topo } from './machine';
import { buildYarn, type YarnParams, type YarnSys } from './yarn';
import { relaxBudget, relaxStart, relaxSteps } from './relax';
import { gpuRelaxStart } from './relaxgpu';

export interface RelaxJob { id: number; topo: Topo; prm: YarnParams; /** start from the last result (same program) */ warm: boolean }
export interface RelaxPost {
  id: number; pos: Float32Array; nrm: Float32Array; iter: number; max: number; moved: number; done: boolean; ms: number; stepMs: number;
  /** where it ran; whether it stopped at the step or time limit before settling */
  on: 'GPU' | 'CPU'; limited: boolean;
  /** the largest force left on a node; jammed: it stopped moving (or crept) with forces still large, so not settled
   * either: somewhere the yarn can't get to rest (e.g. a loop held for many passes, pulled long) */
  force: number; jammed: boolean;
  /** where a jammed fabric's largest force is, in the machine layout: [needle, pass], from 1 */
  at?: [number, number];
}

/** The GPU's budget: enough steps to settle a small fabric (a 30 × 30 jersey stops by itself after 20000–31000),
 * within a time cap; and settled means no node moved more than relaxBudget's distance in any of the last WINDOW steps
 * (one small step alone doesn't: L-BFGS takes small steps between big ones). */
const GPU_STEPS = 60000, GPU_MS = 120000, WINDOW = 50;
/** Below this many nodes the CPU is quicker: a GPU step costs about the same at any small size (~1.5 ms, mostly
 * dispatching), a CPU step grows with the nodes (~0.6 µs each). A small fabric on the CPU gets the GPU's budget. */
const CPU_NODES = 2000;
/** Settled fabrics end with forces of 1e-3 to 2e-2 (jersey 12 and 20, Learn swatches); a jammed one ~1e4. */
const FORCE_OK = 1;

/** The node with the largest force (gradient), placed by where the machine left it: needle across, course up. */
function forceAt(s: YarnSys, g: ArrayLike<number>): [number, number] {
  let most = -1, at = 0;
  for (let i = 0; i < s.nn; i++) { const f = g[i * 3] ** 2 + g[i * 3 + 1] ** 2 + g[i * 3 + 2] ** 2; if (f > most) { most = f; at = i; } }
  return [Math.round(s.init[at * 3]) + 1, Math.round(s.init[at * 3 + 1] / s.c0) + 1];
}

let current = 0;
let last: { topo: Topo; pos: Float32Array } | null = null;
const send = (msg: RelaxPost) => (self as unknown as Worker).postMessage(msg, [msg.pos.buffer, msg.nrm.buffer]);

self.onmessage = async (e: MessageEvent<RelaxJob>) => {
  const { id, topo, prm, warm } = e.data;
  current = id;
  const t0 = performance.now();
  const s = buildYarn(topo, prm), from = warm && last && last.topo.n === topo.n ? last.pos : undefined, settled = relaxBudget(s).settled;
  // progress a few times a second; less often for big fabrics, where reading the state back and redrawing it
  // (300 × 300: ~10 MB and a million-point tube) slowed the steps between to less than half speed
  let chunk = 4, posted = t0, stepMs = 0;
  const every = Math.max(220, s.nn / 500);
  const small = s.nn < CPU_NODES;
  const g = small ? null : await gpuRelaxStart(s, from).catch(() => null);
  if (current !== id) { g?.destroy(); return; }
  if (g) {
    const post = async (done: boolean, limited = false) => {
      const { pos, nrm } = await g.read();
      if (done) last = { topo, pos: pos.slice() };
      const jammed = done && !limited && !(g.force <= FORCE_OK);
      send({ id, pos, nrm, iter: g.iter, max: GPU_STEPS, moved: g.moved, done, ms: performance.now() - t0, stepMs, on: 'GPU', limited, force: g.force, jammed, at: jammed ? forceAt(s, await g.gradient()) : undefined });
    };
    let most = 0, since = g.iter, calm = false;
    try {
      await post(false);
      while (g.iter < GPU_STEPS && performance.now() - t0 < GPU_MS) {
        const a = performance.now(), before = g.iter;
        most = Math.max(most, await g.steps(chunk));
        stepMs = (performance.now() - a) / Math.max(1, g.iter - before);
        chunk = Math.max(1, Math.min(200, Math.round(45 / Math.max(0.01, stepMs))));
        if (current !== id) return;
        if (g.stuck) { calm = true; break; }
        if (g.iter - since >= WINDOW) { if (most < settled) { calm = true; break; } most = 0; since = g.iter; }
        if (performance.now() - posted > every) { posted = performance.now(); await post(false); }
      }
      if (current === id) await post(true, !calm);
    } finally { g.destroy(); }
    return;
  }
  const st = relaxStart(s, from), max = small ? GPU_STEPS : relaxBudget(s).max;
  const post = (done: boolean, limited = false) => {
    const pos = st.pos.slice(), nrm = st.nrm.slice(), jammed = done && !limited && !(st.force <= FORCE_OK);
    send({ id, pos, nrm, iter: st.iter, max, moved: st.moved, done, ms: performance.now() - t0, stepMs, on: 'CPU', limited, force: st.force, jammed, at: jammed ? forceAt(s, st.g) : undefined });
  };
  post(false);
  // settled as on the GPU: no node moved more than the distance in any of the last WINDOW steps
  let most = 0, since = 0, calm = false;
  while (st.iter < max && performance.now() - t0 < GPU_MS) {
    const a = performance.now();
    let k = 0;
    for (; k < chunk && st.moved !== 0; k++) most = Math.max(most, relaxSteps(s, st, 1));
    stepMs = (performance.now() - a) / Math.max(1, k);
    if (st.moved === 0) { calm = true; break; } // stuck: no step lowers the energy, even along the gradient
    chunk = Math.max(1, Math.min(200, Math.round(45 / Math.max(0.01, stepMs)))); // about 45 ms of work between checks
    await new Promise(r => setTimeout(r, 0));
    if (current !== id) return; // replaced
    if (st.iter - since >= WINDOW) { if (most < settled) { calm = true; break; } most = 0; since = st.iter; }
    if (performance.now() - posted > every) { posted = performance.now(); post(false); }
  }
  last = { topo, pos: st.pos };
  post(true, !calm);
};
