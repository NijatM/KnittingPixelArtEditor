// Relaxes the fabric off the main thread: on the GPU (relaxgpu.ts) where WebGPU is available, else on the CPU
// (relax.ts; same model). A new job replaces the one running (its results are dropped); progress is posted a few
// times a second so the shape can be watched settling.
import type { Topo } from './machine';
import { buildYarn, type YarnParams } from './yarn';
import { relaxBudget, relaxStart, relaxSteps } from './relax';
import { gpuRelaxStart } from './relaxgpu';

export interface RelaxJob { id: number; topo: Topo; prm: YarnParams; /** start from the last result (same program) */ warm: boolean }
export interface RelaxPost {
  id: number; pos: Float32Array; nrm: Float32Array; iter: number; max: number; moved: number; done: boolean; ms: number; stepMs: number;
  /** where it ran; whether it stopped at the step or time limit before settling */
  on: 'GPU' | 'CPU'; limited: boolean;
}

/** The GPU's budget: enough steps to settle a small fabric (a 30 × 30 jersey takes about 28000), within a time cap. */
const GPU_STEPS = 30000, GPU_MS = 120000;

let current = 0;
let last: { topo: Topo; pos: Float32Array } | null = null;
const send = (msg: RelaxPost) => (self as unknown as Worker).postMessage(msg, [msg.pos.buffer, msg.nrm.buffer]);

self.onmessage = async (e: MessageEvent<RelaxJob>) => {
  const { id, topo, prm, warm } = e.data;
  current = id;
  const t0 = performance.now();
  const s = buildYarn(topo, prm), from = warm && last && last.topo.n === topo.n ? last.pos : undefined, settled = relaxBudget(s).settled;
  let chunk = 4, posted = t0, stepMs = 0;
  const g = await gpuRelaxStart(s, from).catch(() => null);
  if (current !== id) { g?.destroy(); return; }
  if (g) {
    const post = async (done: boolean, limited = false) => {
      const { pos, nrm } = await g.read();
      if (done) last = { topo, pos: pos.slice() };
      send({ id, pos, nrm, iter: g.iter, max: GPU_STEPS, moved: g.moved, done, ms: performance.now() - t0, stepMs, on: 'GPU', limited });
    };
    try {
      await post(false);
      while (g.iter < GPU_STEPS && performance.now() - t0 < GPU_MS) {
        const a = performance.now(), before = g.iter;
        await g.steps(chunk);
        stepMs = (performance.now() - a) / Math.max(1, g.iter - before);
        chunk = Math.max(1, Math.min(200, Math.round(45 / Math.max(0.01, stepMs))));
        if (current !== id) return;
        if (g.moved < settled) break;
        if (performance.now() - posted > 220) { posted = performance.now(); await post(false); }
      }
      if (current === id) await post(true, g.moved >= settled);
    } finally { g.destroy(); }
    return;
  }
  const st = relaxStart(s, from), budget = relaxBudget(s);
  const post = (done: boolean) => {
    const pos = st.pos.slice(), nrm = st.nrm.slice();
    send({ id, pos, nrm, iter: st.iter, max: budget.max, moved: st.moved, done, ms: performance.now() - t0, stepMs, on: 'CPU', limited: done && st.moved >= budget.settled });
  };
  post(false);
  while (st.iter < budget.max) {
    const a = performance.now();
    relaxSteps(s, st, chunk);
    stepMs = (performance.now() - a) / chunk;
    chunk = Math.max(1, Math.min(200, Math.round(45 / Math.max(0.01, stepMs)))); // about 45 ms of work between checks
    await new Promise(r => setTimeout(r, 0));
    if (current !== id) return; // replaced
    if (st.moved < budget.settled) break;
    if (performance.now() - posted > 220) { posted = performance.now(); post(false); }
  }
  last = { topo, pos: st.pos };
  post(true);
};
