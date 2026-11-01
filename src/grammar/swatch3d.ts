// Small 3D yarn swatches for Learn. Each is a few passes of a tiny program, read bottom up (k = knit front, p = knit
// back, t = tuck front, m = miss, x = knit front then transfer to back), run through the same model as the editor's
// 3D view: the machine (machine.ts), its yarn (yarn.ts) and the relaxed fabric (relax.ts, in the worker). What Learn
// shows is what the editor computes.
// A swatch this small is all edge: relaxed on its own it rolls up. So it is knitted in the middle of a larger piece,
// its first and last passes continued below and above it and its sides continued with its ground stitch, and the
// piece around it is dimmed: the swatch is seen as it sits inside a fabric.
import { BASIC } from './ops';
import { createPattern } from './pattern';
import { run, type Topo } from './machine';
import { buildYarn, YARN_DEFAULTS } from './yarn';
import { KnitView, type Mode } from './view3d';
import type { RelaxJob, RelaxPost } from './knit.worker';

/** rows: the passes, bottom up; marks: [needle, pass] of the loop to light; ground: the stitches either side of it,
 * repeated outwards from its first needle */
export interface SwatchSpec { rows: string[]; marks: [number, number][]; caption: string; ground: string }

export const SWATCHES: Record<string, SwatchSpec> = {
  knit: { rows: ['kkkkk', 'kkkkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], ground: 'k', caption: 'single jersey: every needle knits on the front bed; the marked loop is one knit stitch' },
  purl: { rows: ['ppppp', 'ppppp', 'ppppp', 'ppppp'], marks: [[2, 1]], ground: 'p', caption: 'knit on the back bed: seen from the front, every loop shows its head (the purl side)' },
  tuck: { rows: ['kkkkk', 'kktkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], ground: 'k', caption: 'a tuck: the marked loop is caught by the needle without the old loop being let go; the next knit goes through both' },
  float: { rows: ['kkkkk', 'kkmkk', 'kkkkk', 'kkkkk'], marks: [[2, 0]], ground: 'k', caption: 'a miss: the yarn floats past the middle needle in pass 2; its loop from pass 1 (marked) is held until pass 3' },
  transfer: { rows: ['kkkkk', 'kkxkk', 'kkpkk', 'kkpkk'], marks: [[2, 1]], ground: 'k', caption: 'knit front, then transfer to back: the marked loop moves to the back bed, and from pass 3 that needle knits on the back bed' },
  rib: { rows: ['kpkpk', 'kpkpk', 'kpkpk', 'kpkpk'], marks: [[1, 1]], ground: 'kp', caption: '1 × 1 rib: front and back needles alternate in every pass' },
};

const LETTER: Record<string, string> = { k: 'kf', p: 'kb', t: 'tf', m: 'fl', x: 'kfxb' };
/** the piece around a swatch: needles either side, passes below and above */
export const SIDE = 5, BELOW = 4, ABOVE = 4;

export interface SwatchHandle { flip(): void; mode(m: Mode): void; step(d: number): string; destroy(): void }
export interface SwatchCallbacks {
  /** the mode the view shows by itself: the machine while the fabric relaxes, then the fabric */
  onMode?: (m: Mode) => void;
  onStatus?: (t: string) => void;
}

/** The swatch's program in the middle of its larger piece. */
export function swatchTopo(spec: SwatchSpec): Topo {
  const h = spec.rows.length, w = spec.rows[0].length, W = w + 2 * SIDE, H = h + BELOW + ABOVE, g = spec.ground.length;
  const p = createPattern({ w: W, h: H, key: BASIC });
  for (let pass = 0; pass < H; pass++) for (let x = 0; x < W; x++) {
    const sx = x - SIDE, c = sx >= 0 && sx < w ? spec.rows[Math.max(0, Math.min(h - 1, pass - BELOW))][sx] : spec.ground[((sx % g) + g) % g];
    p.cells[(H - 1 - pass) * W + x] = BASIC.ops.findIndex(o => o.id === LETTER[c]);
  }
  return run(p);
}

// Swatches relax side by side in a few workers of their own (the editor's replaces its job when a new one comes; a
// fabric this small relaxes on the CPU, one core each), and each result is kept while the page is open.
const POOL = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
const idle: Worker[] = [], waiting: (() => void)[] = [], relaxed = new Map<SwatchSpec, RelaxPost>();
let running = 0, ids = 0;
const next = () => waiting.shift()?.();

function relax(spec: SwatchSpec, topo: Topo, onPost: (r: RelaxPost) => void, wanted: () => boolean) {
  const go = () => {
    if (!wanted()) return next();
    let w = idle.pop();
    try { w ??= new Worker(new URL('./knit.worker.ts', import.meta.url), { type: 'module' }); }
    catch { return next(); }
    const id = ++ids, ww = w;
    running++;
    const finish = (keep: boolean) => { running--; if (keep) idle.push(ww); else ww.terminate(); next(); };
    w.onmessage = (e: MessageEvent<RelaxPost>) => {
      if (e.data.id !== id) return;
      if (e.data.done) relaxed.set(spec, e.data);
      onPost(e.data);
      if (e.data.done) finish(true);
    };
    w.onerror = () => finish(false);
    const job: RelaxJob = { id, topo, prm: YARN_DEFAULTS, warm: false };
    w.postMessage(job);
  };
  if (running < POOL) go(); else waiting.push(go);
}

/** Mounts a swatch into `el`: the machine view while it relaxes, then the fabric. Throws if WebGL is unavailable. */
export function mountSwatch(el: HTMLElement, spec: SwatchSpec, cb: SwatchCallbacks = {}): SwatchHandle {
  const h = spec.rows.length, w = spec.rows[0].length;
  const t = swatchTopo(spec), s = buildYarn(t, YARN_DEFAULTS);
  const view = new KnitView(el, {}, true);
  view.setData(s, BASIC);
  view.setLook('yarn');
  view.setWindow(SIDE, SIDE + w - 1, BELOW, BELOW + h - 1);
  const [mx, mp] = spec.marks[0];
  view.setMark((t.h - 1 - (BELOW + mp)) * t.w + SIDE + mx);
  let row = BELOW + h - 1, alive = true, chosen = false;
  const show = () => { view.setStep(row, t.rowAct[row + 1] - 1); return `pass ${row - BELOW + 1} of ${h}`; };
  const done = relaxed.get(spec);
  if (done) view.setFabric(done.pos, done.nrm);
  else {
    view.setMode('machine'); cb.onMode?.('machine');
    cb.onStatus?.('relaxing…');
    relax(spec, t, r => {
      if (!alive) return;
      view.setFabric(r.pos, r.nrm);
      if (!r.done) { cb.onStatus?.(`relaxing · ${(r.ms / 1000).toFixed(0)} s`); return; }
      cb.onStatus?.(r.limited ? 'stopped at the step limit, not settled' : r.jammed ? 'jammed, not settled' : '');
      if (!chosen) { view.setMode('fabric'); show(); cb.onMode?.('fabric'); }
    }, () => alive);
  }
  show();
  return {
    flip: () => view.flip(),
    mode: m => { chosen = true; view.setMode(m); show(); },
    step: d => { row = Math.max(BELOW, Math.min(BELOW + h - 1, row + d)); return show(); },
    destroy: () => { alive = false; view.destroy(); },
  };
}
