// Small 3D yarn swatches for Learn. Each is a few passes of a tiny program, read bottom up (k = knit front, p = knit
// back, t = tuck front, m = miss, x = knit front then transfer to back), run through the same model as the editor's
// 3D view: the machine (machine.ts), its yarn (yarn.ts) and the relaxed fabric (relax.ts). What Learn shows is what
// the editor computes.
import { BASIC } from './ops';
import { createPattern } from './pattern';
import { run } from './machine';
import { buildYarn, YARN_DEFAULTS } from './yarn';
import { relaxBudget, relaxStart, relaxSteps } from './relax';
import { KnitView, type Mode } from './view3d';

export interface SwatchSpec { rows: string[]; marks: [number, number][]; caption: string }

export const SWATCHES: Record<string, SwatchSpec> = {
  knit: { rows: ['kkkkk', 'kkkkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], caption: 'single jersey: every needle knits on the front bed; the marked loop is one knit stitch' },
  purl: { rows: ['ppppp', 'ppppp', 'ppppp', 'ppppp'], marks: [[2, 1]], caption: 'knit on the back bed: seen from the front, every loop shows its head (the purl side)' },
  tuck: { rows: ['kkkkk', 'kktkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], caption: 'a tuck: the marked loop is caught by the needle without the old loop being let go; the next knit goes through both' },
  float: { rows: ['kkkkk', 'kkmkk', 'kkkkk', 'kkkkk'], marks: [[2, 0]], caption: 'a miss: the yarn floats past the middle needle in pass 2; its loop from pass 1 (marked) is held until pass 3' },
  transfer: { rows: ['kkkkk', 'kkxkk', 'kkpkk', 'kkpkk'], marks: [[2, 1]], caption: 'knit front, then transfer to back: the marked loop moves to the back bed, and from pass 3 that needle knits on the back bed' },
  rib: { rows: ['kpkpk', 'kpkpk', 'kpkpk', 'kpkpk'], marks: [[1, 1]], caption: '1 × 1 rib: front and back needles alternate in every pass' },
};

const LETTER: Record<string, string> = { k: 'kf', p: 'kb', t: 'tf', m: 'fl', x: 'kfxb' };

export interface SwatchHandle { flip(): void; mode(m: Mode): void; step(d: number): string; destroy(): void }

/** Mounts a swatch into `el`. Throws if WebGL is unavailable. */
export function mountSwatch(el: HTMLElement, spec: SwatchSpec): SwatchHandle {
  const h = spec.rows.length, w = spec.rows[0].length;
  const p = createPattern({ w, h, key: BASIC });
  spec.rows.forEach((r, pass) => [...r].forEach((c, x) => (p.cells[(h - 1 - pass) * w + x] = BASIC.ops.findIndex(o => o.id === LETTER[c]))));
  const t = run(p), s = buildYarn(t, YARN_DEFAULTS), st = relaxStart(s), b = relaxBudget(s);
  while (st.iter < b.max && relaxSteps(s, st, 25) > b.settled) { /* small: relax here */ }
  const view = new KnitView(el, {}, true);
  view.setData(s, BASIC);
  view.setFabric(st.pos, st.nrm);
  view.setLook('yarn');
  const [mx, mp] = spec.marks[0];
  view.setMark((h - 1 - mp) * w + mx);
  let row = h - 1;
  const show = () => { view.setStep(row, t.rowAct[row + 1] - 1); return `pass ${row + 1} of ${h}`; };
  show();
  return {
    flip: () => view.flip(),
    mode: m => { view.setMode(m); show(); },
    step: d => { row = Math.max(0, Math.min(h - 1, row + d)); return show(); },
    destroy: () => view.destroy(),
  };
}
