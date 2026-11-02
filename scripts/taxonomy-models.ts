// Yarn models for the Knitting Taxonomy frames, one per structure in the vocabulary: each structure's program is
// knitted as a piece larger than the frame's window, relaxed with the Knit Grammar yarn engine (machine.ts →
// yarn.ts → relax.ts, the same model as the editor and Learn), and the yarn behind the window is kept. Run once,
// not on every build (a piece takes up to a few minutes on the CPU):
//   npm run taxonomy:models [structure ...]
// Writes src/taxonomy/data/models/<structure>.json. A model shows the structure, never a particular sample.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { BASIC, TWO, type Key } from '../src/grammar/ops';
import { createPattern } from '../src/grammar/pattern';
import { run } from '../src/grammar/machine';
import { buildYarn, pointsOf, YARN_DEFAULTS } from '../src/grammar/yarn';
import { relaxBudget, relaxStart, relaxSteps } from '../src/grammar/relax';

const ROOT = process.cwd() + '/';   // npm runs scripts at the package root
const OUT = `${ROOT}src/taxonomy/data/models/`;

/** A program: its key, its tile (rows bottom up, op ids by needle) and the piece it is knitted in (needles × passes). */
interface Program { key: Key; tile: string[]; w: number; h: number; note: string; /** drawn with this structure's model */ same?: string }
const P = (tile: string[], w: number, h: number, note: string, key = BASIC): Program => ({ key, tile, w, h, note });
// Tiles from Knit Grammar's structures (structures.ts) where it has one, so a model matches what the editor knits.
// The one-cell program puts one bed's needle in each cell: a rib's cells alternate front and back needles.
const PROGRAMS: Record<string, Program> = {
  single_jersey: P(['kf'], 22, 26, 'single jersey: every needle knits on the front bed'),
  plated_jersey: { ...P(['kf'], 22, 26, 'plating (two yarns in one loop) is not in the yarn model: shown as its ground, single jersey, in the main yarn'), same: 'single_jersey' },
  tuck_jersey: P(['kf tf', 'tf kf'], 22, 30, 'Knit Grammar\'s tuck moss: every other stitch tucks, offset each pass'),
  float_jersey: P(['kf kf kf kf', 'kf fl fl kf'], 24, 30, 'Knit Grammar\'s float stripes: two needles miss in every other pass'),
  eyelet_jersey: P(['kf kf kf kf', 'kf kfxr kf kf', 'kf kf kf kf', 'kf kf kf kf'], 24, 28, 'Knit Grammar\'s eyelets: a loop moved one needle right leaves an empty needle'),
  rib_1x1: P(['kf kb'], 30, 26, '1 × 1 rib: front and back needles alternate'),
  rib_2x2: P(['kf kf kb kb'], 32, 26, '2 × 2 rib: pairs of front and back needles'),
  half_cardigan: P(['kf kb', 'kf tb'], 30, 30, 'half cardigan: a rib pass, then a pass where the back needles tuck'),
  full_cardigan: P(['kf tb', 'tf kb'], 30, 30, 'full cardigan: the back needles tuck in one pass, the front needles in the next'),
  milano_rib: P(['kf kb', 'kf fl', 'fl kb'], 30, 30, 'milano rib: a rib pass, then the front needles alone, then the back needles alone'),
  purl_1x1: P(['kfxb', 'kbxf'], 22, 36, 'Knit Grammar\'s garter: each pass knits and moves its loops to the other bed'),
  interlock: P(['kf kb', 'kb kf'], 30, 30, 'interlock: each pass knits alternate needles on both beds; the next pass the others'),
  punto_di_roma: P(['kf kb', 'kb kf', 'kf kf', 'kb kb'], 30, 32, 'punto di Roma: two interlock passes, then the front needles alone, then the back needles alone'),
  double_jacquard: P(['k2f k2f k2f k2f k2b k2b k2b k2b'], 32, 32, 'double knit with two yarn guides, checks of 4 × 4: on the face the first yarn, then the second', TWO),
};
// the check's rows: 4 passes of one order, 4 of the other
PROGRAMS.double_jacquard.tile = [...Array(4).fill('k2f k2f k2f k2f k2b k2b k2b k2b'), ...Array(4).fill('k2b k2b k2b k2b k2f k2f k2f k2f')];

/** The frame (taxonomy/stage.ts): a 41 mm window centred on 0. Yarn is kept to 2.5 mm under the border all round. */
const WIN = 41, CROP = WIN / 2 + 2.5;
/** passes and needles at each side of the piece left out when sizing: they curl; ZOOM: the window shows the
 *  middle 1 / ZOOM of the rest, so a stitch is big enough to read in the section's small preview */
const EDGE = 4, ZOOM = 1.5;
const WINDOW = 50, MAX_STEPS = 60000, FORCE_OK = 1;
/** needles and passes at each side held flat by the frame */
const HOLD = 2;

function model(id: string) {
  const pr = PROGRAMS[id];
  if (pr.same) {
    writeFileSync(`${OUT}${id}.json`, JSON.stringify({ structure: id, same_as: pr.same, note: pr.note }, null, 1) + '\n');
    return `${id}: drawn with ${pr.same}'s model`;
  }
  const p = createPattern({ w: pr.w, h: pr.h, key: pr.key });
  const rows = pr.tile.map(r => r.split(' '));
  for (let pass = 0; pass < pr.h; pass++) for (let x = 0; x < pr.w; x++) {
    const r = rows[pass % rows.length], op = pr.key.ops.findIndex(o => o.id === r[x % r.length]);
    if (op < 0) throw new Error(`${id}: no op ${r[x % r.length]}`);
    p.cells[(pr.h - 1 - pass) * pr.w + x] = op;
  }
  const t = run(p), s = buildYarn(t, YARN_DEFAULTS), settled = relaxBudget(s).settled;
  // the frame holds the piece's outer needles and passes flat: their depth stays where the machine left it (the
  // solver leaves those coordinates out), while they are free to move across and up, so the piece can draw in
  const held: number[] = [];
  for (let i = 0; i < s.nn; i++) {
    const n = Math.round(s.init[i * 3]), pass = Math.round(s.init[i * 3 + 1] / s.c0);
    if (n < HOLD || n >= pr.w - HOLD || pass < HOLD || pass >= pr.h - HOLD) held.push(i * 3 + 2);
  }
  const t0 = Date.now(), st = relaxStart(s, undefined, Int32Array.from(held));
  // settled as in knit.worker.ts: no node moved more than relaxBudget's distance in any of the last WINDOW steps
  let most = 0, since = 0, calm = false;
  while (st.iter < MAX_STEPS) {
    most = Math.max(most, relaxSteps(s, st, 1));
    if (st.moved === 0) { calm = true; break; }
    if (st.iter - since >= WINDOW) { if (most < settled) { calm = true; break; } most = 0; since = st.iter; }
  }
  const steps = st.iter, force = st.force;
  const status = !calm ? 'stopped at the step limit' : force <= FORCE_OK ? 'settled' : 'jammed';
  const pts = pointsOf(s, st.pos, st.nrm);
  const loopOf = (q: number) => Math.floor(s.ptTag[q] / 2);
  // the loops away from the edges set the size: their extent fills the window plus the border's 2.5 mm
  const inner = (q: number) => { const c = t.cell[loopOf(q)], x = c % pr.w, pass = pr.h - 1 - Math.floor(c / pr.w); return x >= EDGE && x < pr.w - EDGE && pass >= EDGE && pass < pr.h - EDGE; };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let q = 0; q < s.np; q++) if (inner(q)) { x0 = Math.min(x0, pts[q * 3]); x1 = Math.max(x1, pts[q * 3]); y0 = Math.min(y0, pts[q * 3 + 1]); y1 = Math.max(y1, pts[q * 3 + 1]); }
  const scale = (ZOOM * 2 * CROP) / Math.min(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const at = (q: number) => [(pts[q * 3] - cx) * scale, (pts[q * 3 + 1] - cy) * scale, pts[q * 3 + 2] * scale];
  const inside = ([x, y]: number[]) => Math.abs(x) <= CROP && Math.abs(y) <= CROP;
  // each yarn's points inside the crop, split into runs where it leaves
  const yarns: number[][][][] = [];
  for (let g = 0; g + 1 < s.yarnStart.length; g++) {
    const runs: number[][][] = [];
    let cur: number[][] = [];
    for (let q = s.yarnStart[g]; q < s.yarnStart[g + 1]; q++) {
      const v = at(q);
      if (inside(v)) cur.push(v); else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    yarns.push(runs);
  }
  // behind the frame: the front of the yarn 0.3 mm behind its back face (z = 0)
  const r = (YARN_DEFAULTS.d / 2) * scale;
  let zTop = -Infinity, zLow = Infinity;
  for (const runs of yarns) for (const run of runs) for (const v of run) { zTop = Math.max(zTop, v[2]); zLow = Math.min(zLow, v[2]); }
  const dz = -0.3 - r - zTop;
  const enc = (run: number[][]) => Buffer.from(new Int16Array(run.flatMap(v => [Math.round(v[0] * 100), Math.round(v[1] * 100), Math.round((v[2] + dz) * 100)])).buffer).toString('base64');
  const out = {
    structure: id,
    program: { key: pr.key.id, tile: pr.tile, needles: pr.w, passes: pr.h },
    note: pr.note,
    yarn_parameters: YARN_DEFAULTS,
    relax: { steps, held_flat: `${HOLD} needles and passes at each side`, status, force: +force.toPrecision(3), seconds: Math.round((Date.now() - t0) / 1000) },
    mm_per_unit: +scale.toFixed(4),
    radius_mm: +r.toFixed(3),
    depth_mm: +(zTop - zLow + 2 * r).toFixed(2),
    units: 'points in 0.01 mm, x across, y up the passes, z towards the face; Int16 little-endian, base64',
    yarns: yarns.map((runs, guide) => ({ guide, runs: runs.map(enc) })),
  };
  writeFileSync(`${OUT}${id}.json`, JSON.stringify(out, null, 1) + '\n');
  return `${id}: ${status}, ${steps} steps, ${out.relax.seconds} s, force ${out.relax.force}, ${(scale).toFixed(2)} mm/unit, ${yarns.map(r => r.length).join('+')} runs`;
}

if (isMainThread) {
  const vocab = JSON.parse(readFileSync(`${ROOT}src/taxonomy/vocab/structure.json`, 'utf8')).terms.map((t: { id: string }) => t.id) as string[];
  const missing = vocab.filter(id => !PROGRAMS[id]);
  if (missing.length) { console.error('no program for', missing.join(', ')); process.exit(1); }
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : vocab;
  mkdirSync(OUT, { recursive: true });
  const queue = [...ids];
  const lanes = Math.max(1, Math.min(queue.length, cpus().length - 1));
  await Promise.all([...Array(lanes)].map(async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const line = await new Promise<string>((ok, no) => {
        const w = new Worker(new URL(import.meta.url), { workerData: id });
        w.once('message', ok); w.once('error', no);
      });
      console.log(line);
    }
  }));
} else parentPort!.postMessage(model(workerData as string));
