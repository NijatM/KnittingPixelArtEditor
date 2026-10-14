// Pixel-art import: is the picture already pixel art — a few flat colours on a grid, at its own size or enlarged
// by whole or uneven pixel blocks? Then it opens as cells to edit instead of going through the photo styles.
// Photos fail the colour count within their first rows, so the check costs next to nothing for them.

export interface PixelArt {
  W: number;
  H: number;
  cells: Uint8Array;  // 0 = ink (the darker colours), 1 = paper
  palette: string[];  // [ink, paper] as "#rrggbb", taken from the image
  colours: number;    // distinct colours in the file (more than two are split into ink and paper by lightness)
  cellAspect: number; // cell width / height in the file (1 unless it was enlarged unevenly)
  scale: [number, number]; // file pixels per cell
}

export const MAX_COLOURS = 16;
const MAX_W = 250, MAX_H = 300, MIN_SIDE = 4, MAX_FILE_SIDE = 4096; // editor grid limits; bigger files are photos
const TRANSPARENT = 1 << 24; // alpha < 128, read as paper

const keyAt = (d: Uint8ClampedArray, o: number) => (d[o + 3] < 128 ? TRANSPARENT : (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
const lum = (k: number) => (k === TRANSPARENT ? 255 : 0.299 * (k >> 16) + 0.587 * ((k >> 8) & 255) + 0.114 * (k & 255));
const hex = (k: number) => (k === TRANSPARENT ? '#ffffff' : '#' + k.toString(16).padStart(6, '0'));

/** First pixel of each cell along an axis. */
type Axis = number[];
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const blocks = (n: number, k: number): Axis => Array.from({ length: n / k }, (_, i) => i * k);

/** Whole-pixel block size along an axis: the gcd of its length and every colour-change position. */
function blockSize(n: number, edges: Uint8Array) {
  let g = n;
  for (let e = 1; e < n && g > 1; e++) if (edges[e]) g = gcd(g, e);
  return g;
}

/**
 * An enlargement by uneven blocks (n pixels from N cells, N not dividing n): the smallest N whose cell edges,
 * rounded one way for the whole axis, include every colour change. null if none fits the editor.
 */
function uneven(n: number, edges: Uint8Array, max: number): Axis | null {
  const at: number[] = [];
  for (let e = 1; e < n; e++) if (edges[e]) at.push(e);
  for (let N = MIN_SIDE; N <= Math.min(n, max); N++)
    for (const r of [Math.floor, Math.round, Math.ceil]) {
      const starts = Array.from({ length: N }, (_, i) => r(i * n / N)), set = new Set(starts);
      if (at.every(e => set.has(e))) return starts;
    }
  return null;
}

/** Cell index of every pixel along an axis. */
function cellMap(n: number, starts: Axis): Int32Array {
  const m = new Int32Array(n);
  for (let x = 0, c = 0; x < n; x++) { while (c + 1 < starts.length && starts[c + 1] <= x) c++; m[x] = c; }
  return m;
}

/** Ink / paper per colour: the darker side of the best lightness split (Otsu over the few colours) is ink. */
function split(count: Map<number, number>) {
  const cols = [...count].sort((a, b) => lum(a[0]) - lum(b[0])), total = cols.reduce((s, c) => s + c[1], 0);
  let best = 1, bestVar = -1, w0 = 0, m0 = 0;
  const mAll = cols.reduce((s, [k, c]) => s + lum(k) * c, 0);
  for (let i = 1; i < cols.length; i++) {
    w0 += cols[i - 1][1]; m0 += lum(cols[i - 1][0]) * cols[i - 1][1];
    const w1 = total - w0, v = w0 * w1 * (m0 / w0 - (mAll - m0) / w1) ** 2;
    if (v > bestVar) { bestVar = v; best = i; }
  }
  const side = new Map<number, number>(cols.map(([k], i) => [k, i < best ? 0 : 1]));
  const most = (s: number) => cols.filter(([k]) => side.get(k) === s).sort((a, b) => b[1] - a[1])[0][0];
  return { side, palette: [hex(most(0)), hex(most(1))] };
}

/** Reads the image at its own size and returns it as cells, or null when it looks like a photo. */
export function pixelArtOf(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }): PixelArt | null {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_FILE_SIDE || h > MAX_FILE_SIDE) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  // Colours, read in bands so a photo stops after a few rows.
  const count = new Map<number, number>();
  for (let y0 = 0; y0 < h; y0 += 64) {
    const band = ctx.getImageData(0, y0, w, Math.min(64, h - y0)).data;
    for (let o = 0; o < band.length; o += 4) {
      const k = keyAt(band, o), n = count.get(k);
      if (n === undefined) { if (count.size >= MAX_COLOURS) return null; count.set(k, 1); } else count.set(k, n + 1);
    }
  }
  if (count.size < 2) return null;
  const d = ctx.getImageData(0, 0, w, h).data, key = new Uint32Array(w * h);
  for (let i = 0; i < key.length; i++) key[i] = keyAt(d, i * 4);
  // Grid: where colours change along rows and columns.
  const ex = new Uint8Array(w), ey = new Uint8Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) if (key[y * w + x] !== key[y * w + x - 1]) ex[x] = 1;
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) if (key[y * w + x] !== key[(y - 1) * w + x]) { ey[y] = 1; break; }
  // A file that fits the editor opens pixel for pixel (or by an exact enlargement shared by both axes, e.g. a 100 px
  // export of a 50 × 50); a bigger one must be an enlargement, by whole blocks or, failing that, uneven ones.
  const gx = blockSize(w, ex), gy = blockSize(h, ey);
  let xs: Axis | null, ys: Axis | null;
  if (w <= MAX_W && h <= MAX_H) {
    let k = gcd(gx, gy);
    if (w / k < 8 || h / k < 8) k = 1; // a few big flat shapes: keep the file's own pixels
    xs = blocks(w, k); ys = blocks(h, k);
  } else if (w / gx <= MAX_W && h / gy <= MAX_H) { xs = blocks(w, gx); ys = blocks(h, gy); }
  else { xs = uneven(w, ex, MAX_W); ys = uneven(h, ey, MAX_H); }
  if (!xs || !ys) return null;
  const W = xs.length, H = ys.length, mx = cellMap(w, xs), my = cellMap(h, ys);
  const middle = (a: Axis, n: number, i: number) => Math.floor((a[i] + (i + 1 < a.length ? a[i + 1] : n) - 1) / 2);
  // Each cell takes its middle pixel; the picture redrawn from the cells must match the file (≤ 1 % off).
  const ck = new Uint32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) ck[j * W + i] = key[middle(ys, h, j) * w + middle(xs, w, i)];
  let off = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) off += +(key[y * w + x] !== ck[my[y] * W + mx[x]]);
  if (off > w * h * 0.01) return null;
  const { side, palette } = split(count), cells = Uint8Array.from(ck, k => side.get(k)!);
  return { W, H, cells, palette, colours: count.size, cellAspect: +((w / W) / (h / H)).toFixed(2), scale: [w / W, h / H] };
}
