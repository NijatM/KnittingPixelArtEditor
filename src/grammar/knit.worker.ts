// Relaxes the fabric off the main thread. A new job replaces the one running (its results are dropped); progress
// is posted a few times a second so the shape can be watched settling.
import type { Topo } from './machine';
import { buildYarn, type YarnParams } from './yarn';
import { relaxBudget, relaxStart, relaxSteps } from './relax';

export interface RelaxJob { id: number; topo: Topo; prm: YarnParams; /** start from the last result (same program) */ warm: boolean }
export interface RelaxPost { id: number; pos: Float32Array; nrm: Float32Array; iter: number; max: number; moved: number; done: boolean; ms: number; sweepMs: number }

let current = 0;
let last: { topo: Topo; pos: Float32Array } | null = null;

self.onmessage = async (e: MessageEvent<RelaxJob>) => {
  const { id, topo, prm, warm } = e.data;
  current = id;
  const t0 = performance.now();
  const s = buildYarn(topo, prm);
  const st = relaxStart(s, warm && last && last.topo.n === topo.n ? last.pos : undefined);
  const budget = relaxBudget(s);
  let chunk = 4, posted = t0, sweepMs = 0;
  const post = (done: boolean) => {
    const pos = st.pos.slice(), nrm = st.nrm.slice();
    const msg: RelaxPost = { id, pos, nrm, iter: st.iter, max: budget.max, moved: st.moved, done, ms: performance.now() - t0, sweepMs };
    (self as unknown as Worker).postMessage(msg, [pos.buffer, nrm.buffer]);
  };
  post(false);
  while (st.iter < budget.max) {
    const a = performance.now();
    relaxSteps(s, st, chunk);
    sweepMs = (performance.now() - a) / chunk;
    chunk = Math.max(1, Math.min(200, Math.round(45 / Math.max(0.01, sweepMs)))); // about 45 ms of work between checks
    await new Promise(r => setTimeout(r, 0));
    if (current !== id) return; // replaced
    if (st.moved < budget.settled) break;
    if (performance.now() - posted > 220) { posted = performance.now(); post(false); }
  }
  last = { topo, pos: st.pos };
  post(true);
};
