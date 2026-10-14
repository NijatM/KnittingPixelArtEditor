// File exports, 1 cell = 1 pixel / unit, nothing else in the file (no margin, grid or labels). Cells are palette
// indices; the palette holds "#rrggbb" colours and every pixel is opaque.
export type BmpDepth = 1 | 4 | 8 | 24;

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/** Indexed depths hold at most 2^depth colours; 24-bit holds any palette. */
export const depthFits = (depth: BmpDepth, colours: number) => depth === 24 || colours <= 2 ** depth;
export const smallestDepth = (colours: number): BmpDepth => ([1, 4, 8] as const).find(d => colours <= 2 ** d) ?? 24;

/** Windows BMP (BITMAPINFOHEADER), bottom-up rows padded to 4 bytes; indexed depths carry the palette. */
export function encodeBmp(cells: Uint8Array, W: number, H: number, palette: string[], depth: BmpDepth): Blob {
  const indexed = depth !== 24, colours = indexed ? palette.length : 0;
  const rowBytes = Math.ceil(W * depth / 32) * 4, pixelOffset = 14 + 40 + colours * 4, size = pixelOffset + rowBytes * H;
  const buf = new ArrayBuffer(size), v = new DataView(buf), u = new Uint8Array(buf);
  // BITMAPFILEHEADER
  u[0] = 0x42; u[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, pixelOffset, true);
  // BITMAPINFOHEADER
  v.setUint32(14, 40, true); v.setInt32(18, W, true); v.setInt32(22, H, true);
  v.setUint16(26, 1, true); v.setUint16(28, depth, true); v.setUint32(30, 0, true);
  v.setUint32(34, rowBytes * H, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 dpi
  v.setUint32(46, colours, true); v.setUint32(50, colours, true);
  palette.slice(0, colours).forEach((h, i) => { const [r, g, b] = rgb(h); u.set([b, g, r, 0], 54 + i * 4); });
  const cols = palette.map(rgb);
  for (let y = 0; y < H; y++) {
    const row = pixelOffset + (H - 1 - y) * rowBytes;
    for (let x = 0; x < W; x++) {
      const k = cells[y * W + x];
      if (depth === 1) u[row + (x >> 3)] |= (k & 1) << (7 - (x & 7));
      else if (depth === 4) u[row + (x >> 1)] |= (k & 15) << (x & 1 ? 0 : 4);
      else if (depth === 8) u[row + x] = k;
      else { const [r, g, b] = cols[k]; u.set([b, g, r], row + x * 3); }
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ---------------------------------------------------------------- PNG
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const c = new Uint8Array(12 + data.length), v = new DataView(c.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(data, 8);
  let crc = ~0;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC[(crc ^ c[i]) & 255] ^ (crc >>> 8);
  v.setUint32(8 + data.length, ~crc >>> 0);
  return c;
}

/** zlib stream of stored (uncompressed) deflate blocks: pixel-art rows are tiny, and it needs no async compressor. */
function zlibStored(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const blocks = Math.max(1, Math.ceil(data.length / 65535)), out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const s = b * 65535, n = Math.min(65535, data.length - s);
    out.set([b === blocks - 1 ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255], o);
    out.set(data.subarray(s, s + n), o + 5);
    o += 5 + n;
  }
  let a = 1, d = 0;
  for (const x of data) { a = (a + x) % 65521; d = (d + a) % 65521; }
  new DataView(out.buffer).setUint32(o, ((d << 16) | a) >>> 0);
  return out;
}

/** Indexed PNG at the smallest bit depth that holds the palette — 1-bit for two colours — opaque (no tRNS). */
export function encodePng(cells: Uint8Array, W: number, H: number, palette: string[]): Blob {
  const depth = ([1, 2, 4, 8] as const).find(d => palette.length <= 2 ** d) ?? 8, rowBytes = Math.ceil(W * depth / 8);
  const raw = new Uint8Array((rowBytes + 1) * H); // each row: filter 0 (none) + packed indices, high bits first
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bit = x * depth;
      raw[y * (rowBytes + 1) + 1 + (bit >> 3)] |= cells[y * W + x] << (8 - depth - (bit & 7));
    }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, W); v.setUint32(4, H); ihdr.set([depth, 3, 0, 0, 0], 8); // colour type 3 = indexed
  const plte = new Uint8Array(palette.flatMap(rgb));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

// ---------------------------------------------------------------- SVG
/** SVG: one path per colour, horizontal runs of cells merged; cell width = cell aspect (w:h), height 1. */
export function encodeSvg(cells: Uint8Array, W: number, H: number, palette: string[], cellAspect: number): Blob {
  const a = +cellAspect.toFixed(4), paths = palette.map(() => [] as string[]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W;) {
      const k = cells[y * W + x];
      let e = x + 1;
      while (e < W && cells[y * W + e] === k) e++;
      paths[k].push(`M${+(x * a).toFixed(4)} ${y}h${+((e - x) * a).toFixed(4)}v1h${-+((e - x) * a).toFixed(4)}z`);
      x = e;
    }
  const body = paths.map((d, k) => (d.length ? `<path fill="${palette[k]}" d="${d.join('')}"/>` : '')).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${+(W * a).toFixed(4)} ${H}" width="${Math.round(W * a * 10)}" height="${H * 10}" shape-rendering="crispEdges">\n${body}\n</svg>\n`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
