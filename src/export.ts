// File exports, 1 cell = 1 pixel / unit. Cells are palette indices; the palette holds "#rrggbb" colours.
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
