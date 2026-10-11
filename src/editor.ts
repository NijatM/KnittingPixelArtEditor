// Hand edits on their own layer over the regenerable base (SPEC: per cell 0 = auto, k + 1 = forced colour k).
// Tools, mirror, undo/redo, live / bake. No DOM here; main.ts feeds it cells and pointer positions.
export type Tool = 'pencil' | 'erase' | 'fill' | 'line';

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

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private last: [number, number] | null = null;
  private start: [number, number] | null = null;

  get live() { return !this.baked; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get count() { let n = 0; for (const v of this.edits) n += +(v > 0); return n; }
  countOf(k: number) { let n = 0; for (const v of this.edits) n += +(v === k + 1); return n; }

  /** Match a new grid size; existing edits (and a frozen base) are scaled to it. */
  fit(W: number, H: number) {
    if (W === this.W && H === this.H) return;
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
    this.undoStack = []; this.redoStack = [];
  }

  /** What the grid shows: edits (and the line preview) over the frozen base or the given style base. */
  composite(base: Uint8Array): Uint8Array {
    const b = this.baked ?? base, out = new Uint8Array(b.length);
    for (let i = 0; i < out.length; i++) out[i] = this.preview?.[i] ? this.ink : this.edits[i] ? this.edits[i] - 1 : b[i];
    return out;
  }

  /** Edits over a style base, ignoring the frozen base (gallery thumbnails). */
  overlay(base: Uint8Array): Uint8Array {
    const out = base.slice();
    for (let i = 0; i < out.length; i++) if (this.edits[i]) out[i] = this.edits[i] - 1;
    return out;
  }

  // ------------------------------------------------------------ pointer
  down(x: number, y: number, base: Uint8Array) {
    this.snapshot();
    this.last = [x, y];
    if (this.tool === 'fill') this.fill(x, y, this.composite(base));
    else if (this.tool === 'line') { this.start = [x, y]; this.previewLine(x, y); }
    else this.stamp(x, y);
  }

  move(x: number, y: number) {
    if (!this.last) return;
    if (this.tool === 'line') this.previewLine(x, y);
    else if (this.tool !== 'fill') for (const [cx, cy] of cellsOnLine(this.last[0], this.last[1], x, y)) this.stamp(cx, cy);
    this.last = [x, y];
  }

  up() {
    if (this.tool === 'line' && this.preview)
      for (let i = 0; i < this.preview.length; i++) if (this.preview[i]) this.edits[i] = this.ink + 1;
    this.preview = null; this.last = null; this.start = null;
  }

  get drawing() { return this.last !== null; }

  // ------------------------------------------------------------ commands
  clear() { if (this.count) { this.snapshot(); this.edits.fill(0); } }

  /** Flatten style + edits into a frozen base; edits start empty again. */
  bake(base: Uint8Array) {
    this.snapshot();
    this.baked = this.composite(base);
    this.edits.fill(0);
  }

  /** Live on: the base follows the style again. Live off: freeze the current style output (edits stay separate). */
  setLive(on: boolean, base: Uint8Array) {
    if (on === this.live) return;
    this.snapshot();
    this.baked = on ? null : base.slice();
  }

  undo() { this.step(this.undoStack, this.redoStack); }
  redo() { this.step(this.redoStack, this.undoStack); }

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
    this.edits = s.edits; this.baked = s.baked; this.preview = null;
  }
}
