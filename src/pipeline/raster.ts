// Grid rasterisation and small image ops (ports of the OpenCV / PIL calls in research/prototype).
// Masks are Uint8Array of W*H with 0/1. Coordinates are continuous: cell (x, y) covers [x, x+1) × [y, y+1).
import type { Pt } from './landmarks';

export type Mask = Uint8Array;

function setPx(m: Mask, W: number, H: number, x: number, y: number) {
  if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
}

/** 1-cell-wide line between the cells containing a and b (Bresenham). */
export function line(m: Mask, W: number, H: number, a: Pt, b: Pt) {
  let x0 = Math.floor(a[0]), y0 = Math.floor(a[1]);
  const x1 = Math.floor(b[0]), y1 = Math.floor(b[1]);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(m, W, H, x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function polyline(m: Mask, W: number, H: number, p: Pt[], closed = false) {
  for (let i = 0; i + 1 < p.length; i++) line(m, W, H, p[i], p[i + 1]);
  if (closed && p.length > 2) line(m, W, H, p[p.length - 1], p[0]);
}

/** Filled polygon: cells whose centre is inside (even-odd), plus the outline — like PIL's polygon fill. */
export function polygon(m: Mask, W: number, H: number, p: Pt[]) {
  const { length: n } = p;
  if (n < 3) return polyline(m, W, H, p);
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of p) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const ys = Math.max(0, Math.floor(ymin)), ye = Math.min(H - 1, Math.ceil(ymax));
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + (cy - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) m[y * W + x] = 1;
    }
  }
  polyline(m, W, H, p, true);
}

export function disk(m: Mask, W: number, H: number, cx: number, cy: number, r: number) {
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) m[y * W + x] = 1;
}

/** Cells of `inside` that touch (8-neighbourhood) a cell of `outside`. Image edges don't count. */
export function boundary(inside: Mask, outside: Mask, W: number, H: number): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      search: for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && outside[yy * W + xx]) { out[y * W + x] = 1; break search; }
        }
    }
  return out;
}

/** 3×3 dilation (cells within one step, diagonals included). */
export function dilate(m: Mask, W: number, H: number): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = 1;
        }
    }
  return out;
}

/** Remove 8-connected groups of set cells smaller than `min` (speckle), keeping lines and shapes. */
export function dropSmall(m: Mask, W: number, H: number, min: number): Mask {
  const out = m.slice(), seen = new Uint8Array(W * H), stack: number[] = [], group: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue;
    stack.push(s); seen[s] = 1; group.length = 0;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      group.push(i);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * W + xx;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && m[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
    }
    if (group.length < min) for (const i of group) out[i] = 0;
  }
  return out;
}

/** Orphan cleanup: flip cells that disagree with >= 7 of their 8 neighbours (edges replicated). */
export function clean(ink: Mask, W: number, H: number, passes: number, protect?: Mask): Mask {
  let cur = ink.slice();
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (protect && protect[i]) continue;
        let differ = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
            if (cur[yy * W + xx] !== cur[i]) differ++;
          }
        if (differ >= 7) next[i] = cur[i] ? 0 : 1;
      }
    cur = next;
  }
  return cur;
}

/** numpy.percentile (linear interpolation) of the values where mask is set. */
export function percentile(v: Float32Array, mask: Mask, q: number): number {
  const sel: number[] = [];
  for (let i = 0; i < v.length; i++) if (mask[i]) sel.push(v[i]);
  if (!sel.length) return 128;
  sel.sort((a, b) => a - b);
  const pos = Math.min(1, Math.max(0, q / 100)) * (sel.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sel[lo] + (sel[hi] - sel[lo]) * (pos - lo);
}

export const count = (m: Mask) => m.reduce((a, v) => a + v, 0);
