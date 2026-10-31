// The machine: runs a knit grammar program on a V-bed and records what it makes. Pure data: no DOM, no 3D.
//
// Each chart row is one pass of the carriage. At every needle, in the order the carriage meets them, each yarn guide
// does its step: knit (a new loop drawn through the loops the needle holds, which it then lets go), tuck (a new loop
// added to the ones it holds) or miss (the yarn passes by; the needle keeps its loops). Knitting an empty needle
// makes a loop with nothing through it (the cast-on in pass 1, a hole later). Transfers then move all of a needle's
// loops to the facing needle on the other bed, or one needle left or right on the same bed (the machine transfers
// to the other bed, racks one needle and transfers back; those moves are implicit here). Loops moved onto a needle
// that already holds loops are stacked on top of them. A yarn guide turns at the last needle it works in a pass.
//
// Two things the class key doesn't say are switches until the lab's BMP → Steiger script confirms them: when a row's
// transfers happen (after the whole row has knitted, or right after each needle), and how two yarn guides travel (in
// one stroke, YG1's system first, or one stroke each).
//
// Recorded: every loop (when and where it was made, by which cell, operation and yarn guide), the loops it was drawn
// through (bottom of the needle's stack first), the loop that later knitted through it, each yarn guide's loops in
// yarn order, every action in machine order (transfers with the loops they moved), and the needles' loops at the
// start of every row: checkpoints for playback and for replaying from an edited row.
import { UNKNOWN, type Pattern } from './pattern';
import type { Op, Step } from './ops';

export type Timing = 'after-row' | 'per-needle';
export type Travel = 'same-stroke' | 'two-strokes';
export interface MachineOpts { timing: Timing; travel: Travel }
export const MACHINE_DEFAULTS: MachineOpts = { timing: 'after-row', travel: 'same-stroke' };

/** Loop kinds. */
export const KNIT = 0, EMPTY = 1, TUCK = 2;
/** Action types. */
export const A_KNIT = 0, A_TUCK = 1, A_MISS = 2, A_XFER = 3;
/** "Never": the act of a child that doesn't exist. */
export const NEVER = 0x3fffffff;

export interface Topo {
  w: number; h: number; guides: number; opts: MachineOpts;
  /** loops, by id (ids follow the order the loops were made) */
  n: number;
  row: Int32Array;       // chart row it was made in (0 = pass 1)
  stroke: Int32Array;
  act: Int32Array;       // the action that made it
  needle: Int32Array;    // needle it was made on
  bed: Int8Array;        // 1 front, -1 back
  kind: Uint8Array;      // KNIT / EMPTY / TUCK
  guide: Uint8Array;
  cell: Int32Array;      // the chart cell (image index y * w + x)
  op: Int16Array;        // operation index in the key, -1 for an unknown colour
  child: Int32Array;     // the loop knitted through it, -1 if none (still on a needle at the end)
  childAct: Int32Array;  // the action that knitted through it, NEVER if none
  layer: Uint8Array;     // its place in its child's stack (1 = bottom), 0 if none
  endNeedle: Int32Array; // where it was when knitted through, or at the end
  endBed: Int8Array;
  pStart: Int32Array;    // parents (loops it was drawn through), bottom of the stack first: pList[pStart[i]..pStart[i+1])
  pList: Int32Array;
  next: Int32Array;      // the next loop on its yarn, -1 at the yarn's end
  prev: Int32Array;
  /** each yarn guide's loops in yarn order */
  yarn: Int32Array[];
  /** actions, in machine order */
  na: number;
  aType: Uint8Array; aRow: Int32Array; aStroke: Int32Array; aNeedle: Int32Array; aBed: Int8Array;
  aTo: Int32Array; aToBed: Int8Array; aLoop: Int32Array; aCell: Int32Array; aGuide: Uint8Array;
  aMovStart: Int32Array; aMovList: Int32Array;   // loops a transfer moved
  /** first action / first loop of each row (h + 1 entries), strokes */
  rowAct: Int32Array; rowLoop: Int32Array;
  strokes: number; strokeDir: Int8Array; strokeRow: Int32Array; strokeGuide: Int8Array; // -1 = all guides
  /** checkpoints: the loops on every needle at the start of each row */
  cpStart: Int32Array;   // h + 1 entries into the stack lists
  cpBed: Int8Array; cpNeedle: Int32Array; cpLoopStart: Int32Array; cpLoops: Int32Array;
  /** cells read as a miss because their colour isn't in the key */
  unknownCells: number;
  /** cells whose transfer leaves the pattern's needles */
  offEdge: number;
}

/** The source bed of a transfer: the bed of the step that knitted, or of the first step. */
function moveBed(op: Op): 1 | -1 {
  const s = op.steps.find(t => t.action !== 'float') ?? op.steps[0];
  return s.bed === 'front' ? 1 : -1;
}

class Grow {
  a: Int32Array;
  n = 0;
  constructor(cap = 1024) { this.a = new Int32Array(cap); }
  push(v: number) { if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  /** the first n values of a typed array, in one copy */
  load(src: ArrayLike<number>, n: number) { if (this.a.length < n) this.a = new Int32Array(Math.max(n, this.a.length * 2)); this.a.set(Array.isArray(src) ? src.slice(0, n) : (src as Int32Array).subarray(0, n)); this.n = n; return this; }
  get(i: number) { return this.a[i]; }
  set(i: number, v: number) { this.a[i] = v; }
  out() { return this.a.slice(0, this.n); }
}

const key = (bed: number, needle: number) => needle * 2 + (bed === 1 ? 0 : 1);

/** Runs the program. Pass the previous result to replay only from the first row that changed (same size, key and
 *  switches); loop and action ids before that row stay the same. */
export function run(p: Pattern, opts: MachineOpts = MACHINE_DEFAULTS, prev?: { topo: Topo; cells: Uint8Array }): Topo {
  const W = p.w, H = p.h, ops = p.key.ops, G = p.key.mode;
  // the first row that differs from the previous run
  let from = 0;
  if (prev && prev.topo.w === W && prev.topo.h === H && prev.topo.guides === G && prev.topo.opts.timing === opts.timing && prev.topo.opts.travel === opts.travel && prev.cells.length === p.cells.length) {
    from = H;
    for (let r = 0; r < H && from === H; r++) {
      const y = H - 1 - r;
      for (let x = 0; x < W; x++) if (prev.cells[y * W + x] !== p.cells[y * W + x]) { from = r; break; }
    }
    if (from === H) return prev.topo;
  }
  const pt = from > 0 ? prev!.topo : null;

  // loops
  const L = { row: new Grow(), stroke: new Grow(), act: new Grow(), needle: new Grow(), bed: new Grow(), kind: new Grow(), guide: new Grow(), cell: new Grow(), op: new Grow(), child: new Grow(), childAct: new Grow(), layer: new Grow(), endNeedle: new Grow(), endBed: new Grow(), pStart: new Grow() };
  const pList = new Grow();
  // actions
  const A = { type: new Grow(), row: new Grow(), stroke: new Grow(), needle: new Grow(), bed: new Grow(), to: new Grow(), toBed: new Grow(), loop: new Grow(), cell: new Grow(), guide: new Grow(), movStart: new Grow() };
  const movList = new Grow();
  const rowAct = new Int32Array(H + 1), rowLoop = new Int32Array(H + 1);
  const strokeDir: number[] = [], strokeRow: number[] = [], strokeGuide: number[] = [];
  const cpStart = new Int32Array(H + 1), cp = { bed: new Grow(), needle: new Grow(), loopStart: new Grow(), loops: new Grow() };
  const yarn: Grow[] = Array.from({ length: G }, () => new Grow());
  // the needles: front and back, from W needles left of needle 1 to W needles right of the last (transfers may leave
  // the pattern's needles; further out is clamped)
  const R = 3 * W, OFF = W;
  const stacks: number[][] = Array.from({ length: 2 * R }, () => []);
  const slot = (bed: number, x: number) => (bed === 1 ? 0 : R) + Math.max(0, Math.min(R - 1, x + OFF));
  let unknownCells = 0, offEdge = 0;

  if (pt) {
    // keep everything made before row `from`, then restore the needles from its checkpoint
    const nl = pt.rowLoop[from], na = pt.rowAct[from];
    L.row.load(pt.row, nl); L.stroke.load(pt.stroke, nl); L.act.load(pt.act, nl); L.needle.load(pt.needle, nl); L.bed.load(pt.bed, nl); L.kind.load(pt.kind, nl);
    L.guide.load(pt.guide, nl); L.cell.load(pt.cell, nl); L.op.load(pt.op, nl); L.child.load(pt.child, nl); L.childAct.load(pt.childAct, nl); L.layer.load(pt.layer, nl);
    L.endNeedle.load(pt.endNeedle, nl); L.endBed.load(pt.endBed, nl); L.pStart.load(pt.pStart, nl);
    for (let i = 0; i < nl; i++) if (pt.childAct[i] >= na) { L.child.set(i, -1); L.childAct.set(i, NEVER); L.layer.set(i, 0); L.endNeedle.set(i, pt.needle[i]); L.endBed.set(i, pt.bed[i]); }
    pList.load(pt.pList, pt.pStart[nl]);
    A.type.load(pt.aType, na); A.row.load(pt.aRow, na); A.stroke.load(pt.aStroke, na); A.needle.load(pt.aNeedle, na); A.bed.load(pt.aBed, na); A.to.load(pt.aTo, na);
    A.toBed.load(pt.aToBed, na); A.loop.load(pt.aLoop, na); A.cell.load(pt.aCell, na); A.guide.load(pt.aGuide, na); A.movStart.load(pt.aMovStart, na);
    movList.load(pt.aMovList, pt.aMovStart[na]);
    rowAct.set(pt.rowAct.subarray(0, from + 1)); rowLoop.set(pt.rowLoop.subarray(0, from + 1));
    for (let s = 0; s < pt.strokes && pt.strokeRow[s] < from; s++) { strokeDir.push(pt.strokeDir[s]); strokeRow.push(pt.strokeRow[s]); strokeGuide.push(pt.strokeGuide[s]); }
    cpStart.set(pt.cpStart.subarray(0, from + 1));
    const ns = pt.cpStart[from];
    cp.bed.load(pt.cpBed, ns); cp.needle.load(pt.cpNeedle, ns); cp.loopStart.load(pt.cpLoopStart, ns); cp.loops.load(pt.cpLoops, pt.cpLoopStart[ns]);
    for (let g = 0; g < G; g++) { const y = pt.yarn[g]; let k = 0; while (k < y.length && y[k] < nl) k++; yarn[g].load(y, k); }
    for (let s = pt.cpStart[from]; s < pt.cpStart[from + 1]; s++) {
      const st = stacks[slot(pt.cpBed[s], pt.cpNeedle[s])];
      for (let k = pt.cpLoopStart[s]; k < pt.cpLoopStart[s + 1]; k++) st.push(pt.cpLoops[k]);
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = p.cells[y * W + x];
    if (v >= UNKNOWN || !ops[v]) unknownCells++;
    else if ((ops[v].move === 'left' && x === 0) || (ops[v].move === 'right' && x === W - 1)) offEdge++;
  }

  const addAct = (type: number, row: number, stroke: number, needle: number, bed: number, to: number, toBed: number, loop: number, cell: number, guide: number) => {
    A.type.push(type); A.row.push(row); A.stroke.push(stroke); A.needle.push(needle); A.bed.push(bed); A.to.push(to); A.toBed.push(toBed);
    A.loop.push(loop); A.cell.push(cell); A.guide.push(guide); A.movStart.push(movList.n);
    return A.type.n - 1;
  };
  const newLoop = (row: number, stroke: number, needle: number, bed: number, kind: number, guide: number, cell: number, op: number) => {
    const id = L.row.n;
    L.row.push(row); L.stroke.push(stroke); L.act.push(A.type.n); L.needle.push(needle); L.bed.push(bed); L.kind.push(kind); L.guide.push(guide);
    L.cell.push(cell); L.op.push(op); L.child.push(-1); L.childAct.push(NEVER); L.layer.push(0); L.endNeedle.push(needle); L.endBed.push(bed);
    L.pStart.push(pList.n);
    yarn[guide].push(id);
    return id;
  };
  const stackOf = (bed: number, needle: number) => stacks[slot(bed, needle)];

  /** One yarn guide's step at one needle. */
  const doStep = (s: Step, g: number, x: number, row: number, stroke: number, cell: number, opIndex: number) => {
    if (s.action === 'float') { addAct(A_MISS, row, stroke, x, 0, x, 0, -1, cell, g); return; }
    const bed = s.bed === 'front' ? 1 : -1, st = stackOf(bed, x);
    if (s.action === 'knit') {
      const id = newLoop(row, stroke, x, bed, st.length ? KNIT : EMPTY, g, cell, opIndex);
      const act = addAct(A_KNIT, row, stroke, x, bed, x, bed, id, cell, g);
      for (let i = 0; i < st.length; i++) { const q = st[i]; pList.push(q); L.child.set(q, id); L.childAct.set(q, act); L.layer.set(q, i + 1); L.endNeedle.set(q, x); L.endBed.set(q, bed); }
      st.length = 0; st.push(id);
    } else {
      const id = newLoop(row, stroke, x, bed, TUCK, g, cell, opIndex);
      addAct(A_TUCK, row, stroke, x, bed, x, bed, id, cell, g);
      st.push(id);
    }
  };

  /** Transfers, all taken off their needles first and then put down, so chains and swaps move as one. */
  const doMoves = (moves: { x: number; bed: number; to: number; toBed: number; cell: number }[], row: number, stroke: number) => {
    const lifted = moves.map(m => { const st = stackOf(m.bed, m.x), l = st.slice(); st.length = 0; return l; });
    moves.forEach((m, i) => {
      const l = lifted[i], dst = stackOf(m.toBed, m.to);
      addAct(A_XFER, row, stroke, m.x, m.bed, m.to, m.toBed, -1, m.cell, 0);
      for (const q of l) { movList.push(q); dst.push(q); }
    });
  };
  /** Every needle's loops now, back bed first, left to right (the order checkpoints are kept in). */
  const checkpoint = (r: number) => {
    cpStart[r] = cp.bed.n;
    for (let b = 0; b < 2; b++) for (let i = 0; i < R; i++) {
      const st = stacks[(b ? 0 : R) + i];
      if (!st.length) continue;
      cp.bed.push(b ? 1 : -1); cp.needle.push(i - OFF); cp.loopStart.push(cp.loops.n);
      for (const q of st) cp.loops.push(q);
    }
  };
  const moveOf = (op: Op, x: number, cell: number) => {
    const bed = moveBed(op);
    return op.move === 'across' ? { x, bed, to: x, toBed: -bed, cell } : { x, bed, to: x + (op.move === 'left' ? -1 : 1), toBed: bed, cell };
  };

  for (let r = from; r < H; r++) {
    rowAct[r] = A.type.n; rowLoop[r] = L.row.n;
    // checkpoint: every needle's loops now
    checkpoint(r);
    const y = H - 1 - r, rowDir = (r % 2 === 0 ? p.firstDir : -p.firstDir) as 1 | -1;
    // the strokes of this row: one for every guide together, or one per guide, each guide alternating on its own
    const strokes: { dir: number; guides: number[] }[] = G === 1 || opts.travel === 'same-stroke'
      ? [{ dir: rowDir, guides: Array.from({ length: G }, (_, g) => g) }]
      : Array.from({ length: G }, (_, g) => ({ dir: g % 2 === 0 ? rowDir : -rowDir, guides: [g] }));
    const pending: { x: number; bed: number; to: number; toBed: number; cell: number }[] = [];
    for (const sk of strokes) {
      const stroke = strokeDir.length;
      strokeDir.push(sk.dir); strokeRow.push(r); strokeGuide.push(sk.guides.length === G ? -1 : sk.guides[0]);
      for (let i = 0; i < W; i++) {
        const x = sk.dir === 1 ? i : W - 1 - i, cell = y * W + x, v = p.cells[cell];
        const op = v < UNKNOWN ? ops[v] : undefined;
        for (const g of sk.guides) {
          const s = op?.steps[g];
          if (!s) { addAct(A_MISS, r, stroke, x, 0, x, 0, -1, cell, g); continue; }
          doStep(s, g, x, r, stroke, cell, v);
        }
        if (op && op.move !== 'none') {
          // the transfer belongs to the guide whose step sets its bed
          const owner = Math.max(0, op.steps.findIndex(t => t.action !== 'float'));
          if (!sk.guides.includes(owner)) continue;
          if (opts.timing === 'per-needle') doMoves([moveOf(op, x, cell)], r, stroke);
          else pending.push(moveOf(op, x, cell));
        }
      }
    }
    if (pending.length) doMoves(pending, r, strokeDir.length - 1);
  }
  rowAct[H] = A.type.n; rowLoop[H] = L.row.n;
  // the last checkpoint: the needles at the end, where the loops still on them ended
  checkpoint(H);
  cp.loopStart.push(cp.loops.n);
  for (let s = cpStart[H]; s < cp.bed.n; s++) for (let k = cp.loopStart.get(s); k < (s + 1 < cp.bed.n ? cp.loopStart.get(s + 1) : cp.loops.n); k++) { L.endNeedle.set(cp.loops.get(k), cp.needle.get(s)); L.endBed.set(cp.loops.get(k), cp.bed.get(s)); }
  L.pStart.push(pList.n);
  A.movStart.push(movList.n);

  const n = L.row.n;
  const yarnOut = yarn.map(g => g.out());
  const next = new Int32Array(n).fill(-1), prevA = new Int32Array(n).fill(-1);
  for (const yl of yarnOut) for (let i = 0; i + 1 < yl.length; i++) { next[yl[i]] = yl[i + 1]; prevA[yl[i + 1]] = yl[i]; }
  return {
    w: W, h: H, guides: G, opts: { ...opts }, n,
    row: L.row.out(), stroke: L.stroke.out(), act: L.act.out(), needle: L.needle.out(), bed: Int8Array.from(L.bed.out()), kind: Uint8Array.from(L.kind.out()),
    guide: Uint8Array.from(L.guide.out()), cell: L.cell.out(), op: Int16Array.from(L.op.out()), child: L.child.out(), childAct: L.childAct.out(),
    layer: Uint8Array.from(L.layer.out()), endNeedle: L.endNeedle.out(), endBed: Int8Array.from(L.endBed.out()), pStart: L.pStart.out(), pList: pList.out(),
    next, prev: prevA, yarn: yarnOut,
    na: A.type.n, aType: Uint8Array.from(A.type.out()), aRow: A.row.out(), aStroke: A.stroke.out(), aNeedle: A.needle.out(), aBed: Int8Array.from(A.bed.out()),
    aTo: A.to.out(), aToBed: Int8Array.from(A.toBed.out()), aLoop: A.loop.out(), aCell: A.cell.out(), aGuide: Uint8Array.from(A.guide.out()),
    aMovStart: A.movStart.out(), aMovList: movList.out(),
    rowAct, rowLoop, strokes: strokeDir.length, strokeDir: Int8Array.from(strokeDir), strokeRow: Int32Array.from(strokeRow), strokeGuide: Int8Array.from(strokeGuide),
    cpStart, cpBed: Int8Array.from(cp.bed.out()), cpNeedle: cp.needle.out(), cpLoopStart: cp.loopStart.out(), cpLoops: cp.loops.out(),
    unknownCells, offEdge,
  };
}

/** The loops on every needle after action `k` (k = rowAct[r] - 1 is the end of row r - 1): stacks keyed by
 *  needle * 2 + (0 front, 1 back), bottom first. Replays from the row's checkpoint. */
export function needlesAt(t: Topo, k: number): Map<number, number[]> {
  const stacks = new Map<number, number[]>();
  let r = 0;
  while (r < t.h && t.rowAct[r + 1] <= k) r++;
  if (k >= t.na) r = t.h;
  const cpEnd = r === t.h ? t.cpLoopStart.length - 1 : t.cpStart[r + 1];
  for (let s = t.cpStart[r]; s < cpEnd; s++) {
    const st: number[] = [];
    for (let q = t.cpLoopStart[s]; q < t.cpLoopStart[s + 1]; q++) st.push(t.cpLoops[q]);
    stacks.set(key(t.cpBed[s], t.cpNeedle[s]), st);
  }
  if (r === t.h) return stacks;
  const get = (bed: number, x: number) => { const kk = key(bed, x); let s = stacks.get(kk); if (!s) { s = []; stacks.set(kk, s); } return s; };
  for (let a = t.rowAct[r]; a <= k && a < t.na; a++) {
    const ty = t.aType[a];
    if (ty === A_KNIT) { const st = get(t.aBed[a], t.aNeedle[a]); st.length = 0; st.push(t.aLoop[a]); }
    else if (ty === A_TUCK) get(t.aBed[a], t.aNeedle[a]).push(t.aLoop[a]);
    else if (ty === A_XFER) {
      const src = get(t.aBed[a], t.aNeedle[a]), dst = get(t.aToBed[a], t.aTo[a]);
      for (let q = t.aMovStart[a]; q < t.aMovStart[a + 1]; q++) { const id = t.aMovList[q], i = src.indexOf(id); if (i >= 0) src.splice(i, 1); dst.push(id); }
    }
  }
  return stacks;
}

export const stackKey = key;
export const parentsOf = (t: Topo, i: number) => t.pList.subarray(t.pStart[i], t.pStart[i + 1]);
