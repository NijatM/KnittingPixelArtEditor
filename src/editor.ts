// Hand edits on their own layer over the regenerable base (SPEC: per cell 0 = auto, k + 1 = forced colour k).
// Tools, mirror, selection (move / flip / mirror copy), undo/redo, live / bake. No DOM here; main.ts feeds it cells
// and pointer positions.
export type Tool = 'pencil' | 'erase' | 'fill' | 'line' | 'select';
/** What a moved selection leaves behind: the colour around it, or paper. */
export type Behind = 'around' | 'paper';
export interface Rect { x: number; y: number; w: number; h: number }

interface Snapshot { W: number; H: number; edits: Uint8Array; baked: Uint8Array | null }

const MAX_UNDO = 200;

/** Cells on the line between two cells (Bresenham). */
function* cellsOnLine(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Rescale a cell layer to a new grid. Each new cell looks at the old cells it covers and takes the most common
 * non-zero value, so thin drawn lines survive shrinking; growing repeats cells (nearest).
 */
function rescale(src: Uint8Array, W: number, H: number, nW: number, nH: number) {
  const out = new Uint8Array(nW * nH), votes = new Map<number, number>();
  for (let y = 0; y < nH; y++)
    for (let x = 0; x < nW; x++) {
      const x0 = Math.floor(x * W / nW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / nW));
      const y0 = Math.floor(y * H / nH), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / nH));
      votes.clear();
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) { const v = src[sy * W + sx]; if (v) votes.set(v, (votes.get(v) ?? 0) + 1); }
      let best = 0, n = 0;
      for (const [v, c] of votes) if (c > n) { best = v; n = c; }
      out[y * nW + x] = best;
    }
  return out;
}

export class Editor {
  W = 0;
  H = 0;
  edits: Uint8Array = new Uint8Array(0);
  /** Frozen base (live off): the style output, or style + edits after Bake. null = base follows the style. */
  baked: Uint8Array | null = null;
  tool: Tool = 'pencil';
  ink = 0;            // palette index the pencil, fill and line draw with
  brush = 1;          // square brush side in cells
  mirror = false;
  axis = 0;           // mirror axis as a continuous x (cell x covers [x, x + 1))
  /** Line tool: cells of the line being dragged, shown but not yet committed. */
  preview: Uint8Array | null = null;
  /** Selected cells; follows the lifted pixels while they move (it may then hang over the grid edge). */
  sel: Rect | null = null;
  behind: Behind = 'around';

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private last: [number, number] | null = null;
  private start: [number, number] | null = null;
  /** Lifted pixels (palette indices, sel.w × sel.h) floating over the grid until they are dropped. */
  private float: Uint8Array | null = null;
  private anchor: [number, number] | null = null; // select tool: corner of the rectangle being dragged out
  private grab: [number, number] | null = null;   // select tool: pointer offset inside the selection being moved
  private grabBase: Uint8Array | null = null;     // base to lift from once the pointer really moves

  get live() { return !this.baked; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get floating() { return this.float !== null; }
  get count() { let n = 0; for (const v of this.edits) n += +(v > 0); return n; }
  countOf(k: number) { let n = 0; for (const v of this.edits) n += +(v === k + 1); return n; }

  /** Match a new grid size; existing edits (and a frozen base) are scaled to it. */
  fit(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.deselect();
    this.edits = this.W ? rescale(this.edits, this.W, this.H, W, H) : new Uint8Array(W * H);
    if (this.baked) this.baked = rescale(this.baked, this.W, this.H, W, H);
    this.W = W; this.H = H; this.preview = null;
  }

  /** Reopen saved edits (autosave). */
  restore(W: number, H: number, edits: Uint8Array, baked: Uint8Array | null) {
    this.reset(W, H);
    this.edits = edits.slice();
    this.baked = baked?.slice() ?? null;
  }

  /** Forget everything (new photo). */
  reset(W: number, H: number) {
    this.W = W; this.H = H; this.edits = new Uint8Array(W * H); this.baked = null; this.preview = null;
    this.sel = null; this.float = null;
    this.undoStack = []; this.redoStack = [];
  }

  /** What the grid shows: edits (and the line preview) over the frozen base or the given style base, lifted pixels on top. */
  composite(base: Uint8Array): Uint8Array {
    const b = this.baked ?? base, out = new Uint8Array(b.length);
    for (let i = 0; i < out.length; i++) out[i] = this.preview?.[i] ? this.ink : this.edits[i] ? this.edits[i] - 1 : b[i];
    this.eachFloat((i, v) => (out[i] = v));
    return out;
  }

  /** Edits over a style base, ignoring the frozen base (gallery thumbnails). */
  overlay(base: Uint8Array): Uint8Array {
    const out = base.slice();
    for (let i = 0; i < out.length; i++) if (this.edits[i]) out[i] = this.edits[i] - 1;
    this.eachFloat((i, v) => (out[i] = v));
    return out;
  }

  /** The edits layer with lifted pixels put down (autosave). */
  flatEdits(): Uint8Array {
    const out = this.edits.slice();
    this.eachFloat((i, v) => (out[i] = v + 1));
    return out;
  }

  inside(x: number, y: number) {
    const s = this.sel;
    return !!s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  }

  // ------------------------------------------------------------ pointer
  down(x: number, y: number, base: Uint8Array) {
    if (this.tool === 'select') { this.pick(x, y, base); return; }
    this.deselect();
    this.snapshot();
    this.last = [x, y];
    if (this.tool === 'fill') this.fill(x, y, this.composite(base));
    else if (this.tool === 'line') { this.start = [x, y]; this.previewLine(x, y); }
    else this.stamp(x, y);
  }

  move(x: number, y: number) {
    if (!this.last) return;
    if (this.tool === 'select') this.drag(x, y);
    else if (this.tool === 'line') this.previewLine(x, y);
    else if (this.tool !== 'fill') for (const [cx, cy] of cellsOnLine(this.last[0], this.last[1], x, y)) this.stamp(cx, cy);
    this.last = [x, y];
  }

  up() {
    if (this.tool === 'line' && this.preview)
      for (let i = 0; i < this.preview.length; i++) if (this.preview[i]) this.edits[i] = this.ink + 1;
    if (this.anchor && this.sel?.w === 1 && this.sel.h === 1) this.sel = null; // a click outside the selection deselects
    this.preview = null; this.last = null; this.start = null; this.anchor = null; this.grab = null; this.grabBase = null;
  }

  get drawing() { return this.last !== null; }

  // ------------------------------------------------------------ selection
  selectAll() { this.deselect(); this.sel = { x: 0, y: 0, w: this.W, h: this.H }; }

  /** Put lifted pixels down as edits and forget the selection. */
  deselect() { this.drop(); this.sel = null; }

  /** Move the selection by whole cells (arrow keys). */
  nudge(dx: number, dy: number, base: Uint8Array) {
    if (!this.sel) return;
    if (!this.float) this.lift(base);
    this.sel.x += dx; this.sel.y += dy;
  }

  /** Flip the selected pixels left–right (h) or upside down (v) where they are. */
  flip(dir: 'h' | 'v', base: Uint8Array) {
    if (!this.sel) return;
    if (!this.float) this.lift(base);
    const { w, h } = this.sel, f = this.float!, out = new Uint8Array(f.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[y * w + x] = dir === 'h' ? f[y * w + w - 1 - x] : f[(h - 1 - y) * w + x];
    this.float = out;
  }

  /** A flipped copy of the selection on the other side of the mirror axis; it floats there until dropped. */
  mirrorCopy(base: Uint8Array) {
    this.drop();
    const s = this.sel;
    if (!s) return;
    const shown = this.composite(base), f = new Uint8Array(s.w * s.h);
    this.snapshot();
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) f[y * s.w + x] = shown[(s.y + y) * this.W + s.x + s.w - 1 - x];
    this.sel = { ...s, x: Math.round(2 * this.axis) - s.x - s.w };
    this.float = f;
  }

  // ------------------------------------------------------------ commands
  clear() { this.deselect(); if (this.count) { this.snapshot(); this.edits.fill(0); } }

  /** Flatten style + edits into a frozen base; edits start empty again. */
  bake(base: Uint8Array) {
    this.deselect();
    this.snapshot();
    this.baked = this.composite(base);
    this.edits.fill(0);
  }

  /** Live on: the base follows the style again. Live off: freeze the current style output (edits stay separate). */
  setLive(on: boolean, base: Uint8Array) {
    if (on === this.live) return;
    this.drop();
    this.snapshot();
    this.baked = on ? null : base.slice();
  }

  // Lifted pixels are dropped first, so a move (lift → drags → flips → drop) is one undo step and redo brings it back.
  undo() { this.drop(); this.step(this.undoStack, this.redoStack); }
  redo() { this.drop(); this.step(this.redoStack, this.undoStack); }

  // ------------------------------------------------------------ internals
  private mirrorX(x: number) { return Math.floor(2 * this.axis - x - 0.5); }

  private set(x: number, y: number, v: number) {
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.edits[y * this.W + x] = v;
  }

  private stamp(x: number, y: number) {
    const v = this.tool === 'erase' ? 0 : this.ink + 1, b = this.brush, o = Math.floor((b - 1) / 2);
    for (let dy = 0; dy < b; dy++)
      for (let dx = 0; dx < b; dx++) {
        const cx = x - o + dx, cy = y - o + dy;
        this.set(cx, cy, v);
        if (this.mirror) this.set(this.mirrorX(cx), cy, v);
      }
  }

  /** Select tool, pointer down: grab the selection to move it, or start a new rectangle. */
  private pick(x: number, y: number, base: Uint8Array) {
    this.last = [x, y];
    if (this.inside(x, y)) { this.grab = [x - this.sel!.x, y - this.sel!.y]; this.grabBase = base; return; }
    this.deselect();
    this.anchor = [x, y];
    this.sel = { x, y, w: 1, h: 1 };
  }

  private drag(x: number, y: number) {
    if (this.grab) {
      if (x === this.last![0] && y === this.last![1]) return;
      if (!this.float) this.lift(this.grabBase!); // lifted on the first real move, so a click changes nothing
      this.sel!.x = x - this.grab[0]; this.sel!.y = y - this.grab[1];
    } else if (this.anchor) {
      const [ax, ay] = this.anchor, cx = Math.max(0, Math.min(this.W - 1, x)), cy = Math.max(0, Math.min(this.H - 1, y));
      this.sel = { x: Math.min(ax, cx), y: Math.min(ay, cy), w: Math.abs(cx - ax) + 1, h: Math.abs(cy - ay) + 1 };
    }
  }

  /** Pick the selected pixels up; the cells they leave get the colour around the selection (or paper), not ink. */
  private lift(base: Uint8Array) {
    const s = this.sel!, { W } = this, shown = this.composite(base), f = new Uint8Array(s.w * s.h);
    this.snapshot();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) f[y * s.w + x] = shown[(s.y + y) * W + s.x + x];
    const hole = (this.behind === 'paper' ? 1 : this.around(shown, s)) + 1;
    for (let y = 0; y < s.h; y++) this.edits.fill(hole, (s.y + y) * W + s.x, (s.y + y) * W + s.x + s.w);
    this.float = f;
  }

  /** Most common colour on the ring of cells just outside a rectangle; paper on a tie or with no ring. */
  private around(shown: Uint8Array, s: Rect) {
    const n = new Map<number, number>(), { W, H } = this;
    const add = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < H) { const v = shown[y * W + x]; n.set(v, (n.get(v) ?? 0) + 1); } };
    for (let x = s.x - 1; x <= s.x + s.w; x++) { add(x, s.y - 1); add(x, s.y + s.h); }
    for (let y = s.y; y < s.y + s.h; y++) { add(s.x - 1, y); add(s.x + s.w, y); }
    let best = 1, most = n.get(1) ?? 0;
    for (const [v, c] of n) if (c > most) { best = v; most = c; }
    return best;
  }

  /** Write lifted pixels into the edits (cells off the grid are lost); the selection shrinks to the grid. */
  private drop() {
    if (!this.float) return;
    this.eachFloat((i, v) => (this.edits[i] = v + 1));
    this.float = null;
    const s = this.sel!, x0 = Math.max(0, s.x), y0 = Math.max(0, s.y);
    const x1 = Math.min(this.W, s.x + s.w), y1 = Math.min(this.H, s.y + s.h);
    this.sel = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** Visit the lifted pixels that lie on the grid: (cell index, palette index). */
  private eachFloat(f: (i: number, v: number) => void) {
    const s = this.sel, fl = this.float;
    if (!s || !fl) return;
    for (let y = Math.max(0, -s.y); y < Math.min(s.h, this.H - s.y); y++)
      for (let x = Math.max(0, -s.x); x < Math.min(s.w, this.W - s.x); x++) f((s.y + y) * this.W + s.x + x, fl[y * s.w + x]);
  }

  private previewLine(x: number, y: number) {
    const p = new Uint8Array(this.W * this.H), [x0, y0] = this.start!;
    const put = (cx: number, cy: number) => { if (cx >= 0 && cy >= 0 && cx < this.W && cy < this.H) p[cy * this.W + cx] = 1; };
    for (const [cx, cy] of cellsOnLine(x0, y0, x, y)) {
      put(cx, cy);
      if (this.mirror) put(this.mirrorX(cx), cy);
    }
    this.preview = p;
  }

  /** 4-connected flood fill of the clicked colour region (and its mirror) with the ink colour. */
  private fill(x: number, y: number, shown: Uint8Array) {
    const { W, H } = this, seen = new Uint8Array(W * H);
    const flood = (sx: number, sy: number) => {
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
      const target = shown[sy * W + sx];
      if (target === this.ink) return;
      const stack = [sy * W + sx];
      while (stack.length) {
        const i = stack.pop()!;
        if (seen[i] || shown[i] !== target) continue;
        seen[i] = 1; this.edits[i] = this.ink + 1;
        const cx = i % W, cy = (i / W) | 0;
        if (cx > 0) stack.push(i - 1);
        if (cx < W - 1) stack.push(i + 1);
        if (cy > 0) stack.push(i - W);
        if (cy < H - 1) stack.push(i + W);
      }
    };
    flood(x, y);
    if (this.mirror) flood(this.mirrorX(x), y);
  }

  private snapshot() {
    this.undoStack.push({ W: this.W, H: this.H, edits: this.edits.slice(), baked: this.baked?.slice() ?? null });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private step(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop();
    if (!s) return;
    to.push({ W: this.W, H: this.H, edits: this.edits.slice(), baked: this.baked?.slice() ?? null });
    if (s.W !== this.W || s.H !== this.H) {
      s.edits = rescale(s.edits, s.W, s.H, this.W, this.H);
      if (s.baked) s.baked = rescale(s.baked, s.W, s.H, this.W, this.H);
    }
    this.edits = s.edits; this.baked = s.baked; this.preview = null; this.sel = null;
  }
}
