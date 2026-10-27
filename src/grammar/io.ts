// Knit grammar files. In: BMP / PNG read pixel by pixel (no colour management) and matched to a key; project JSON.
// Out: 24-bit BMP with the key's exact RGB, the grammar key as TXT and PDF, a symbol chart as PNG and SVG.
import { encodeBmp } from '../export';
import { GLYPH, glyphOf, hex, rgbText, stepGlyph, type Key, type RGB } from './ops';
import { createPattern, floatIndex, MAX_SIDE, passOf, UNKNOWN, type Pattern } from './pattern';
import { drawPattern, layout, paintGlyph, Tiles, type ViewOpts } from './render';

// ---------------------------------------------------------------- reading images
export interface Pixels { w: number; h: number; data: Uint8ClampedArray }

/** Decodes an image file without colour management, so the RGB values are the file's own. */
export async function readPixels(file: Blob): Promise<Pixels> {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** An image enlarged by a whole factor (every colour run a multiple of k, aligned) shrinks back to one pixel per cell. */
export function unscale(px: Pixels): Pixels {
  const { w, h, data } = px, at = (x: number, y: number) => (y * w + x) * 4;
  const same = (a: number, b: number) => data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2];
  let k = 0;
  for (let y = 0; y < h && k !== 1; y++) { let run = 1; for (let x = 1; x <= w; x++) { if (x < w && same(at(x, y), at(x - 1, y))) run++; else { k = gcd(k, run); run = 1; } } }
  for (let x = 0; x < w && k !== 1; x++) { let run = 1; for (let y = 1; y <= h; y++) { if (y < h && same(at(x, y), at(x, y - 1))) run++; else { k = gcd(k, run); run = 1; } } }
  if (k <= 1 || w % k || h % k) return px;
  const W = w / k, H = h / k, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(data.subarray(at(x * k, y * k), at(x * k, y * k) + 4), (y * W + x) * 4);
  return { w: W, h: H, data: out };
}

export interface MatchRow { rgb: RGB; count: number; op: number; dist: number } // op = -1: unknown
export interface Matched { cells: Uint8Array; unknown: RGB[]; rows: MatchRow[]; exact: number; snapped: number; unread: number }

const SNAP = 48; // largest RGB distance that still reads as a key colour

/** Matches every colour to the key: exact, or the nearest key colour when it is close and clearly nearer than the next. */
export function matchKey(px: Pixels, key: Key): Matched {
  const counts = new Map<number, number>();
  for (let i = 0; i < px.w * px.h; i++) { const c = (px.data[i * 4] << 16) | (px.data[i * 4 + 1] << 8) | px.data[i * 4 + 2]; counts.set(c, (counts.get(c) ?? 0) + 1); }
  const map = new Map<number, number>(), unknown: RGB[] = [], rows: MatchRow[] = [];
  let exact = 0, snapped = 0, unread = 0;
  for (const [c, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const rgb: RGB = [c >> 16, (c >> 8) & 255, c & 255];
    const d = key.ops.map((o, i) => ({ i, d: Math.hypot(o.rgb[0] - rgb[0], o.rgb[1] - rgb[1], o.rgb[2] - rgb[2]) })).sort((a, b) => a.d - b.d);
    const [a, b] = d;
    let op = -1;
    if (a && a.d === 0) { op = a.i; exact += count; }
    else if (a && a.d <= SNAP && (!b || a.d < b.d / 2)) { op = a.i; snapped += count; }
    else if (unknown.length < 127) { unknown.push(rgb); unread += count; }
    else { op = floatIndex(key); unread += count; } // more than 127 stray colours: the rest read as float
    map.set(c, op >= 0 ? op : UNKNOWN + unknown.length - 1);
    rows.push({ rgb, count, op, dist: a ? Math.round(a.d) : 0 });
  }
  const cells = new Uint8Array(px.w * px.h);
  for (let i = 0; i < cells.length; i++) cells[i] = map.get((px.data[i * 4] << 16) | (px.data[i * 4 + 1] << 8) | px.data[i * 4 + 2])!;
  return { cells, unknown, rows, exact, snapped, unread };
}

/** Picks the key that reads the most pixels; ties go to the first key given (the current one). */
export function bestKey(px: Pixels, keys: Key[]): Key {
  let best = keys[0], score = -1;
  for (const k of keys) { const m = matchKey(px, k), s = m.exact * 2 + m.snapped; if (s > score) { score = s; best = k; } }
  return best;
}

export function patternFromPixels(px: Pixels, key: Key, name: string): { p: Pattern; m: Matched } {
  if (px.w > MAX_SIDE || px.h > MAX_SIDE) throw new Error(`the image is ${px.w} × ${px.h}; patterns go up to ${MAX_SIDE} × ${MAX_SIDE}`);
  const m = matchKey(px, key);
  const p = createPattern({ name, w: px.w, h: px.h, key });
  p.cells = m.cells; p.unknown = m.unknown;
  return { p, m };
}

/** Re-reads a pattern through another key by colour: same RGB, same cell; colours the new key lacks become unknown. */
export function rekey(p: Pattern, key: Key): { cells: Uint8Array; unknown: RGB[] } {
  const px: Pixels = { w: p.w, h: p.h, data: new Uint8ClampedArray(p.w * p.h * 4) };
  for (let i = 0; i < p.cells.length; i++) {
    const v = p.cells[i], c = v >= UNKNOWN ? p.unknown[v - UNKNOWN] : p.key.ops[v].rgb;
    px.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  const m = matchKey(px, key);
  return { cells: m.cells, unknown: m.unknown };
}

// ---------------------------------------------------------------- writing
/** The palette a file is written with: the key's operations, then any unknown colours, compacted to what is used. */
function palette(p: Pattern) {
  const used = new Map<number, number>(), pal: string[] = [];
  const cells = new Uint8Array(p.cells.length);
  p.cells.forEach((v, i) => {
    if (!used.has(v)) { used.set(v, pal.length); pal.push(hex(v >= UNKNOWN ? p.unknown[v - UNKNOWN] : p.key.ops[v].rgb)); }
    cells[i] = used.get(v)!;
  });
  return { pal, cells };
}

/** 24-bit BMP: one pixel per needle and pass, bottom row = pass 1, the key's exact RGB. */
export function bmpOf(p: Pattern): Blob {
  const { pal, cells } = palette(p);
  return encodeBmp(cells, p.w, p.h, pal, 24);
}

export function usage(p: Pattern) {
  const n = new Map<number, number>();
  for (const v of p.cells) n.set(v, (n.get(v) ?? 0) + 1);
  return n;
}

const dirText = (p: Pattern) => (p.firstDir === 1 ? 'left to right' : 'right to left');

export function keyTxt(p: Pattern): string {
  const n = usage(p), k = p.key;
  const lines = [
    `Grammar key: ${p.name}`,
    `${p.w} needles x ${p.h} passes, ${k.mode === 2 ? 'two yarn guides' : 'one yarn guide'}, pass 1 knits ${dirText(p)}; passes alternate.`,
    `One pixel = one needle in one pass. The bottom row of the BMP is pass 1.`,
    `Key: ${k.name}${k.preset ? '' : ' (custom)'}`,
    ...(k.credit ? [k.credit] : []),
    ...(k.notes ?? []).map(t => `- ${t}`),
    '',
    pad('colour', 16) + pad('RGB', 18) + pad('cells', 8) + 'operation',
    ...k.ops.map((o, i) => pad(o.colour, 16) + pad(rgbText(o.rgb), 18) + pad(String(n.get(i) ?? 0), 8) + o.name + (o.provisional ? ' (provisional)' : '')),
    ...p.unknown.map((c, i) => (n.get(UNKNOWN + i) ? pad('unknown', 16) + pad(rgbText(c), 18) + pad(String(n.get(UNKNOWN + i)), 8) + 'not in the key' : '')).filter(Boolean),
  ];
  if (p.note?.trim()) lines.push('', 'Intention:', p.note.trim());
  return lines.join('\n') + '\n';
}
const pad = (s: string, n: number) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));

// ---------------------------------------------------------------- PDF (one or more A4 pages, Helvetica, vector swatches)
const latin1 = (s: string) => s.replace(/[→]/g, '->').replace(/[←]/g, '<-').replace(/[×]/g, 'x').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const esc = (s: string) => latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Word-wraps text for Helvetica at `size` into lines at most `width` points wide (approximate widths). */
function wrap(text: string, size: number, width: number) {
  const max = Math.floor(width / (size * 0.5)), out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) { if ((line + ' ' + w).trim().length > max) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
    out.push(line);
  }
  return out;
}

export function keyPdf(p: Pattern): Blob {
  const n = usage(p), k = p.key, pages: string[] = [];
  let s = '', y = 800;
  const text = (x: number, yy: number, t: string, size = 9, bold = false, grey = 0) => { s += `BT ${grey} g /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${esc(t)}) Tj ET\n`; };
  const newPage = () => { pages.push(s); s = ''; y = 800; };
  text(48, y, `Grammar key: ${p.name}`, 16, true); y -= 22;
  text(48, y, `${p.w} needles x ${p.h} passes, ${k.mode === 2 ? 'two yarn guides' : 'one yarn guide'}, pass 1 knits ${dirText(p)}; passes alternate.`); y -= 13;
  text(48, y, 'One pixel = one needle in one pass. The bottom row of the BMP is pass 1.'); y -= 13;
  text(48, y, `Key: ${k.name}${k.preset ? '' : ' (custom)'}`); y -= 13;
  if (k.credit) { text(48, y, k.credit, 8, false, 0.35); y -= 12; }
  for (const t of k.notes ?? []) for (const l of wrap(t, 8, 500)) { text(48, y, l, 8, false, 0.35); y -= 11; }
  y -= 12;
  text(48, y, 'COLOUR', 7, true, 0.35); text(118, y, 'NAME', 7, true, 0.35); text(214, y, 'RGB', 7, true, 0.35); text(300, y, 'CELLS', 7, true, 0.35); text(344, y, 'OPERATION', 7, true, 0.35); y -= 8;
  const rowsOut: { rgb: RGB; glyph: string[] | null; name: string; colour: string; count: number; prov?: boolean }[] = [
    ...k.ops.map((o, i) => ({ rgb: o.rgb, glyph: glyphOf(o), name: o.name, colour: o.colour, count: n.get(i) ?? 0, prov: o.provisional })),
    ...p.unknown.map((c, i) => ({ rgb: c, glyph: null, name: 'not in the key', colour: 'unknown', count: n.get(UNKNOWN + i) ?? 0 })).filter(r => r.count),
  ];
  for (const r of rowsOut) {
    if (y < 70) newPage();
    const sz = 26, x0 = 48, y0 = y - sz;
    s += `${(r.rgb[0] / 255).toFixed(3)} ${(r.rgb[1] / 255).toFixed(3)} ${(r.rgb[2] / 255).toFixed(3)} rg ${x0} ${y0} ${sz} ${sz} re f\n`;
    s += `0.6 G 0.5 w ${x0} ${y0} ${sz} ${sz} re S\n`;
    if (r.glyph) { // the symbol, one square per glyph cell
      s += '0 g\n';
      const u = sz / GLYPH;
      r.glyph.forEach((row, gy) => [...row].forEach((c, gx) => { if (c === '#') s += `${(x0 + gx * u).toFixed(2)} ${(y0 + (GLYPH - 1 - gy) * u).toFixed(2)} ${u.toFixed(2)} ${u.toFixed(2)} re f\n`; }));
    }
    text(118, y0 + 10, r.colour, 9); text(214, y0 + 10, rgbText(r.rgb), 9); text(300, y0 + 10, String(r.count), 9, false, r.count ? 0 : 0.55);
    text(344, y0 + 10, r.name + (r.prov ? ' (provisional)' : ''), 9);
    y -= sz + 6;
  }
  if (p.note?.trim()) {
    y -= 10; if (y < 100) newPage();
    text(48, y, 'Intention', 11, true); y -= 15;
    for (const l of wrap(p.note.trim(), 9.5, 500)) { if (y < 50) newPage(); text(48, y, l, 9.5); y -= 13; }
  }
  pages.push(s);
  return pdf(pages);
}

function pdf(pages: string[]): Blob {
  const objs: string[] = [];
  const add = (o: string) => { objs.push(o); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled below
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const content of pages) {
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([Uint8Array.from(out, ch => ch.charCodeAt(0) & 255)], { type: 'application/pdf' });
}

// ---------------------------------------------------------------- symbol chart
const CHART_THEME = { line: '#9a9a9a', dim: '#555555', faint: '#9a9a9a', hi: '#000000', warn: '#c0392b', bg: '#ffffff' };

/** Chart PNG: the pattern with symbols, pass / needle numbers and directions, and a legend of the operations used. */
export async function chartPng(p: Pattern, guides: boolean): Promise<Blob> {
  const cs = Math.max(12, Math.min(28, Math.floor(1800 / Math.max(p.w, p.h)))), v: ViewOpts = { cs, symbols: true, guides, grid: true, numbers: true };
  const L = layout(p, v), used = [...usage(p).keys()].sort((a, b) => a - b), legendH = 28 + used.length * 26;
  const W = Math.max(L.W, 460), H = 34 + L.H + legendH;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000'; ctx.font = '600 14px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'top';
  ctx.fillText(`${p.name} · ${p.w} × ${p.h} · ${p.key.mode === 2 ? 'two yarn guides' : 'one yarn guide'} · ${p.key.name}`, 8, 10);
  ctx.save(); ctx.translate(0, 34);
  drawPattern(ctx, p, v, new Tiles(), 1, CHART_THEME);
  ctx.restore();
  let y = 34 + L.H + 12;
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  for (const val of used) {
    const op = val < UNKNOWN ? p.key.ops[val] : null, rgb = val < UNKNOWN ? op!.rgb : p.unknown[val - UNKNOWN];
    ctx.fillStyle = hex(rgb); ctx.fillRect(8, y, 20, 20);
    ctx.strokeStyle = '#9a9a9a'; ctx.strokeRect(8.5, y + 0.5, 19, 19);
    if (op) paintGlyph(ctx, glyphOf(op), 8, y, 20, '#000');
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
    ctx.fillText(`${op ? op.name : 'not in the key'}  ${rgbText(rgb)}${op?.provisional ? '  provisional' : ''}`, 36, y + 10);
    y += 26;
  }
  return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}

/** Chart SVG: cells as merged runs, symbols as reusable glyphs, numbers as text. */
export function chartSvg(p: Pattern, guides: boolean): Blob {
  const cs = 20, sub = guides && p.key.mode === 2 ? 2 : 1, rowH = cs * sub, ml = 46, mt = 30, W = ml + p.w * cs + 8, H = mt + p.h * rowH + 26;
  const u = cs / GLYPH, defs: string[] = [], used = new Set<string>();
  const glyphPath = (g: string[]) => g.map((row, gy) => [...row].map((ch, gx) => (ch === '#' ? `M${+(gx * u).toFixed(3)} ${+(gy * u).toFixed(3)}h${+u.toFixed(3)}v${+u.toFixed(3)}h${-+u.toFixed(3)}z` : '')).join('')).join('');
  const def = (id: string, g: string[]) => { if (!used.has(id)) { used.add(id); defs.push(`<path id="${id}" d="${glyphPath(g)}"/>`); } return id; };
  const body: string[] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = p.cells[y * p.w + x], op = v < UNKNOWN ? p.key.ops[v] : null, rgb = op ? op.rgb : p.unknown[v - UNKNOWN];
    const X = ml + x * cs, Y = mt + y * rowH;
    body.push(`<rect x="${X}" y="${Y}" width="${cs}" height="${rowH}" fill="${hex(rgb)}"/>`);
    if (!op) continue;
    if (sub === 2) op.steps.forEach((s, g) => body.push(`<use href="#${def(`s${s.action[0]}${s.bed[0]}`, stepGlyph(s))}" x="${X}" y="${Y + g * cs}"/>`));
    else body.push(`<use href="#${def(`o${v}`, glyphOf(op))}" x="${X}" y="${Y}"/>`);
  }
  const grid: string[] = [];
  for (let x = 0; x <= p.w; x++) grid.push(`M${ml + x * cs} ${mt}v${p.h * rowH}`);
  for (let y = 0; y <= p.h; y++) grid.push(`M${ml} ${mt + y * rowH}h${p.w * cs}`);
  const nums: string[] = [];
  for (let y = 0; y < p.h; y++) nums.push(`<text x="${ml - 14}" y="${mt + y * rowH + rowH / 2}" text-anchor="end" dominant-baseline="middle">${passOf(p, y)}</text>`);
  for (let x = 0; x < p.w; x++) if (x === 0 || (x + 1) % 5 === 0) nums.push(`<text x="${ml + x * cs + cs / 2}" y="${mt + p.h * rowH + 14}" text-anchor="middle">${x + 1}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="IBM Plex Mono, monospace" font-size="9" shape-rendering="crispEdges">
<title>${xml(p.name)}: ${p.w} x ${p.h}, ${xml(p.key.name)}</title>
<defs>${defs.join('')}</defs>
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="8" y="18" font-size="12" font-weight="600">${xml(p.name)} · ${p.w} × ${p.h} · ${p.key.mode === 2 ? 'two yarn guides' : 'one yarn guide'} · ${xml(p.key.name)}</text>
<g>${body.join('')}</g>
<path d="${grid.join('')}" stroke="#000" stroke-opacity=".25" stroke-width=".5" fill="none"/>
<g fill="#555">${nums.join('')}</g>
</svg>
`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
