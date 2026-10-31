// Knit grammar editor model: the tools and undo/redo over a pattern's cells. No DOM here.
import { floatIndex, type Design, type Pattern } from './pattern';
import type { Key, RGB } from './ops';

export type GTool = 'needle' | 'run' | 'flood' | 'pass' | 'wale' | 'motif' | 'pick';
export interface Rect { x: number; y: number; w: number; h: number }
export type RepeatMode = 'across' | 'up' | 'all';

interface Snapshot { w: number; h: number; cells: Uint8Array; unknown: RGB[]; key: Key; design?: Design }
type Change =
  | { kind: 'cells'; idx: Uint32Array; before: Uint8Array; after: Uint8Array; sel: Rect | null }
  | { kind: 'whole'; before: Snapshot; after: Snapshot };

const MAX_UNDO = 200;

export class GEditor {
  tool: GTool = 'needle';
  op = 1;
  mirror = false;
  /** Pass / wale fills repeat every n rows / columns from the one clicked (0 = only that one). */
  every = 0;
  sel: Rect | null = null;
  private undos: Change[] = [];
  private redos: Change[] = [];
  private before: Uint8Array | null = null;
  private beforeSel: Rect | null = null;
  private lift: { cells: Uint8Array; base: Uint8Array; from: Rect } | null = null;

  constructor(public p: Pattern) {}

  load(p: Pattern) { this.p = p; this.undos = []; this.redos = []; this.sel = null; this.lift = null; this.before = null; this.op = Math.min(this.op, p.key.ops.length - 1); }

  get canUndo() { return this.undos.length > 0; }
  get canRedo() { return this.redos.length > 0; }
  get behind() { return floatIndex(this.p.key); }

  // ---------------------------------------------------------------- strokes
  begin() { if (!this.before) { this.before = this.p.cells.slice(); this.beforeSel = this.sel && { ...this.sel }; } }
  /** Ends the stroke; returns whether anything changed. */
  end(): boolean {
    const b = this.before;
    this.before = null; this.lift = null;
    if (!b) return false;
    const idx: number[] = [];
    const c = this.p.cells;
    for (let i = 0; i < c.length; i++) if (c[i] !== b[i]) idx.push(i);
    if (!idx.length) return false;
    const I = Uint32Array.from(idx);
    this.push({ kind: 'cells', idx: I, before: Uint8Array.from(I, i => b[i]), after: Uint8Array.from(I, i => c[i]), sel: this.beforeSel });
    return true;
  }

  private push(ch: Change) {
    this.undos.push(ch);
    if (this.undos.length > MAX_UNDO) this.undos.shift();
    this.redos = [];
    this.p.updated = Date.now();
  }

  private inside(x: number, y: number) { return x >= 0 && y >= 0 && x < this.p.w && y < this.p.h; }

  set(x: number, y: number, v = this.op) {
    if (!this.inside(x, y)) return;
    this.p.cells[y * this.p.w + x] = v;
    if (this.mirror) this.p.cells[y * this.p.w + (this.p.w - 1 - x)] = v;
  }

  get(x: number, y: number) { return this.inside(x, y) ? this.p.cells[y * this.p.w + x] : -1; }

  /** Cells of a straight run from a to b (Bresenham). */
  static runCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const out: [number, number][] = [];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }

  run(x0: number, y0: number, x1: number, y1: number, v = this.op) { for (const [x, y] of GEditor.runCells(x0, y0, x1, y1)) this.set(x, y, v); }

  flood(x: number, y: number, v = this.op) {
    const { w, h, cells } = this.p, from = this.get(x, y);
    if (from < 0 || from === v) return;
    const stack = [y * w + x], seen = new Uint8Array(w * h);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || cells[i] !== from) continue;
      seen[i] = 1;
      const cx = i % w, cy = (i / w) | 0;
      this.set(cx, cy, v);
      if (cx > 0) stack.push(i - 1);
      if (cx < w - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - w);
      if (cy < h - 1) stack.push(i + w);
    }
  }

  /** The rows a pass fill at y reaches: y alone, or every n-th row through y. */
  everyOf(at: number, size: number) { if (this.every < 2) return [at]; const out = []; for (let i = at % this.every; i < size; i += this.every) out.push(i); return out; }

  pass(y: number, v = this.op) { for (const r of this.everyOf(y, this.p.h)) for (let x = 0; x < this.p.w; x++) this.set(x, r, v); }
  wale(x: number, v = this.op) { for (const c of this.everyOf(x, this.p.w)) for (let y = 0; y < this.p.h; y++) this.set(c, y, v); }

  // ---------------------------------------------------------------- selection (motif)
  select(r: Rect | null) { this.sel = r && this.clip(r); }
  selectAll() { this.sel = { x: 0, y: 0, w: this.p.w, h: this.p.h }; }

  private clip(r: Rect): Rect | null {
    const x0 = Math.max(0, Math.min(r.x, r.x + r.w)), y0 = Math.max(0, Math.min(r.y, r.y + r.h));
    const x1 = Math.min(this.p.w, Math.max(r.x, r.x + r.w)), y1 = Math.min(this.p.h, Math.max(r.y, r.y + r.h));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  private copy(r: Rect, from = this.p.cells) {
    const out = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * r.w + x] = from[(r.y + y) * this.p.w + r.x + x];
    return out;
  }

  private paste(cells: Uint8Array, r: Rect) {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const X = r.x + x, Y = r.y + y;
      if (this.inside(X, Y)) this.p.cells[Y * this.p.w + X] = cells[y * r.w + x];
    }
  }

  /** Moves the selection's cells by (dx, dy) from where the drag started; what it leaves behind becomes float. */
  moveTo(dx: number, dy: number) {
    if (!this.sel) return;
    if (!this.lift) {
      this.begin();
      const base = this.p.cells.slice();
      for (let y = 0; y < this.sel.h; y++) base.fill(this.behind, (this.sel.y + y) * this.p.w + this.sel.x, (this.sel.y + y) * this.p.w + this.sel.x + this.sel.w);
      this.lift = { cells: this.copy(this.sel), base, from: { ...this.sel } };
    }
    const to = { ...this.lift.from, x: this.lift.from.x + dx, y: this.lift.from.y + dy };
    this.p.cells.set(this.lift.base);
    this.paste(this.lift.cells, to);
    this.sel = to;
  }

  /** Ends a move; the selection keeps its new place (clipped to the pattern). */
  drop() { this.end(); if (this.sel) this.sel = this.clip(this.sel); }

  nudge(dx: number, dy: number) { this.moveTo(dx, dy); this.drop(); }

  flip(axis: 'h' | 'v') {
    const r = this.sel; if (!r) return;
    this.begin();
    const c = this.copy(r), out = new Uint8Array(c.length);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++)
      out[y * r.w + x] = c[(axis === 'v' ? r.h - 1 - y : y) * r.w + (axis === 'h' ? r.w - 1 - x : x)];
    this.paste(out, r);
    this.end();
  }

  clearSel() {
    const r = this.sel; if (!r) return;
    this.begin();
    this.paste(new Uint8Array(r.w * r.h).fill(this.behind), r);
    this.end();
  }

  fillSel(v = this.op) {
    const r = this.sel; if (!r) return;
    this.begin();
    this.paste(new Uint8Array(r.w * r.h).fill(v), r);
    this.end();
  }

  /** Tiles the selection's cells: across its rows, up and down its columns, or over everything. Each repeat
   *  further up is shifted by `shift` needles (a half drop when shift = half the motif width). */
  repeat(mode: RepeatMode, shift = 0) {
    const r = this.sel; if (!r) return;
    this.begin();
    const c = this.copy(r), { w, h } = this.p;
    const ys = mode === 'across' ? [0] : range(Math.floor(-r.y / r.h) - 1, Math.ceil((h - r.y) / r.h) + 1);
    for (const j of ys) {
      const off = (((j * -shift) % r.w) + r.w) % r.w; // rows above (j < 0) shift right by `shift`
      const xs = mode === 'up' ? [0] : range(Math.floor(-r.x / r.w) - 2, Math.ceil((w - r.x) / r.w) + 2);
      for (const i of xs) this.paste(c, { x: r.x + i * r.w + (mode === 'up' ? 0 : off), y: r.y + j * r.h, w: r.w, h: r.h });
    }
    this.end();
  }

  // ---------------------------------------------------------------- whole-pattern changes (resize, key)
  private snap(): Snapshot { return { w: this.p.w, h: this.p.h, cells: this.p.cells.slice(), unknown: structuredClone(this.p.unknown), key: structuredClone(this.p.key), design: this.p.design && structuredClone(this.p.design) }; }
  private restore(s: Snapshot) { Object.assign(this.p, { w: s.w, h: s.h, cells: s.cells.slice(), unknown: structuredClone(s.unknown), key: structuredClone(s.key), design: s.design && structuredClone(s.design) }); }

  /** Applies a change to size / cells / key as one undo step. */
  whole(apply: () => void) {
    const before = this.snap();
    apply();
    this.sel = null;
    this.push({ kind: 'whole', before, after: this.snap() });
  }

  /** For changes made elsewhere over time (a stroke on the design layer): remember the state now, and later
   *  commit everything since as one undo step. */
  private pending: Snapshot | null = null;
  checkpoint() { this.pending = this.snap(); }
  commit() { if (!this.pending) return; this.push({ kind: 'whole', before: this.pending, after: this.snap() }); this.pending = null; }

  undo() { const ch = this.undos.pop(); if (!ch) return false; this.apply(ch, true); this.redos.push(ch); return true; }
  redo() { const ch = this.redos.pop(); if (!ch) return false; this.apply(ch, false); this.undos.push(ch); return true; }

  private apply(ch: Change, back: boolean) {
    if (ch.kind === 'whole') { this.restore(back ? ch.before : ch.after); this.sel = null; }
    else {
      const v = back ? ch.before : ch.after;
      ch.idx.forEach((i, k) => (this.p.cells[i] = v[k]));
      if (back) this.sel = ch.sel && { ...ch.sel };
    }
    this.op = Math.min(this.op, this.p.key.ops.length - 1);
    this.p.updated = Date.now();
  }
}

const range = (a: number, b: number) => { const out: number[] = []; for (let i = a; i <= b; i++) out.push(i); return out; };
