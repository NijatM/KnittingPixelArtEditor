// Draws a pattern: cell colours, operation symbols, the guides view (each two-guide pass split into a YG1 and a YG2
// row), grid, pass / needle numbers and pass directions. Used by the editor canvas and the chart export.
import { GLYPH, glyphOf, hex, stepGlyph, type Op } from './ops';
import { cellRGB, dirOf, passOf, UNKNOWN, type Pattern } from './pattern';
import type { Rect } from './editor';

export interface ViewOpts {
  cs: number;           // cell size in px
  symbols: boolean;
  guides: boolean;      // two-guide patterns: one row per yarn guide
  grid: boolean;
  numbers: boolean;
}

export interface Overlay {
  hover?: { x: number; y: number } | null;
  sel?: Rect | null;
  preview?: { cells: [number, number][]; v: number } | null;
  marks?: Set<number> | null; // cell indices flagged by a check
}

export interface Layout { ml: number; mt: number; mr: number; mb: number; rowH: number; sub: number; W: number; H: number }

const SYMBOL_MIN = 10;

export function layout(p: Pattern, v: ViewOpts): Layout {
  const sub = v.guides && p.key.mode === 2 ? 2 : 1, rowH = v.cs * sub;
  const num = v.numbers && v.cs >= 4;
  const ml = num ? 46 : 8, mb = num ? 22 : 8, mt = 8, mr = 8;
  return { ml, mt, mr, mb, rowH, sub, W: ml + p.w * v.cs + mr, H: mt + p.h * rowH + mb };
}

/** The cell under a point in canvas px (CSS), or null. */
export function cellAt(p: Pattern, v: ViewOpts, px: number, py: number) {
  const L = layout(p, v);
  const x = Math.floor((px - L.ml) / v.cs), y = Math.floor((py - L.mt) / L.rowH);
  return x >= 0 && y >= 0 && x < p.w && y < p.h ? { x, y } : null;
}

/** Paints a glyph's '#' cells in `ink` inside the square (x, y, s). */
export function paintGlyph(ctx: CanvasRenderingContext2D, g: string[], x: number, y: number, s: number, ink: string) {
  ctx.fillStyle = ink;
  const u = s / GLYPH;
  for (let gy = 0; gy < GLYPH; gy++) {
    const row = g[gy];
    for (let gx = 0; gx < GLYPH;) {
      if (row[gx] !== '#') { gx++; continue; }
      let e = gx + 1;
      while (e < GLYPH && row[e] === '#') e++;
      const x0 = Math.round(x + gx * u), x1 = Math.round(x + e * u), y0 = Math.round(y + gy * u), y1 = Math.round(y + (gy + 1) * u);
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      gx = e;
    }
  }
}

/** Cached cell tiles: colour + symbol at one size. */
export class Tiles {
  private cache = new Map<string, HTMLCanvasElement>();
  version = 0;
  bump() { this.version++; this.cache.clear(); }

  tile(op: Op | null, rgb: string, cs: number, glyph: string[] | null, dpr: number): HTMLCanvasElement {
    const k = `${rgb}|${glyph ? glyph.join('') : ''}|${cs}|${dpr}`;
    let c = this.cache.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    const s = Math.max(1, Math.round(cs * dpr));
    c.width = c.height = s;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = rgb; ctx.fillRect(0, 0, s, s);
    if (glyph) paintGlyph(ctx, glyph, 0, 0, s, '#000');
    if (!op) { // an unknown colour: hatched, so it can't be mistaken for an operation
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = Math.max(1, s / 12);
      for (let t = -s; t < s; t += Math.max(3, s / 4)) { ctx.beginPath(); ctx.moveTo(t, s); ctx.lineTo(t + s, 0); ctx.stroke(); }
    }
    this.cache.set(k, c);
    return c;
  }
}

export const THEME = { line: '#3a3a3a', dim: '#8a8a8a', faint: '#4a4a4a', hi: '#f4f4f4', warn: '#d09a4e', bg: '#0b0b0b' };
export type Theme = typeof THEME;

/** The pattern itself: cells, symbols, grid, numbers. Overlays are drawn on top by drawOverlay. */
export function drawPattern(ctx: CanvasRenderingContext2D, p: Pattern, v: ViewOpts, tiles: Tiles, dpr: number, theme: Theme = THEME) {
  const L = layout(p, v), cs = v.cs;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, L.W, L.H);
  ctx.imageSmoothingEnabled = false;
  const sym = v.symbols && cs >= SYMBOL_MIN;
  const guides = L.sub === 2;
  if (!sym && !guides) {
    // plain colours: one pixel per cell, scaled up (fast at any size); unknown colours are hatched on top
    const img = new ImageData(p.w, p.h);
    for (let i = 0; i < p.cells.length; i++) { const c = cellRGB(p, p.cells[i]); img.data.set([c[0], c[1], c[2], 255], i * 4); }
    const off = document.createElement('canvas');
    off.width = p.w; off.height = p.h;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(off, L.ml, L.mt, p.w * cs, p.h * L.rowH);
    if (cs >= 4) for (let i = 0; i < p.cells.length; i++) if (p.cells[i] >= UNKNOWN) {
      const t = tiles.tile(null, hex(cellRGB(p, p.cells[i])), cs, null, dpr);
      ctx.drawImage(t, L.ml + (i % p.w) * cs, L.mt + ((i / p.w) | 0) * L.rowH, cs, L.rowH);
    }
  } else {
    const glyphs = p.key.ops.map(op => glyphOf(op));
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const val = p.cells[y * p.w + x], op = val < UNKNOWN ? p.key.ops[val] : null;
      const col = hex(cellRGB(p, val)), X = L.ml + x * cs, Y = L.mt + y * L.rowH;
      if (guides && op) {
        for (let g = 0; g < 2; g++) ctx.drawImage(tiles.tile(op, col, cs, sym ? stepGlyph(op.steps[g]) : null, dpr), X, Y + g * cs, cs, cs);
      } else ctx.drawImage(tiles.tile(op, col, cs, sym && op ? glyphs[val] : null, dpr), X, Y, cs, L.rowH);
    }
  }
  const x0 = L.ml, y0 = L.mt, x1 = L.ml + p.w * cs, y1 = L.mt + p.h * L.rowH;
  // grid: thin lines every cell, stronger every 10; in the guides view a line splits each pass
  if (v.grid && cs >= 5) {
    ctx.lineWidth = 1 / dpr;
    for (const major of [false, true]) { // counted from needle 1 and pass 1, like the numbers
      ctx.strokeStyle = major ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.22)';
      ctx.beginPath();
      for (let x = 0; x <= p.w; x++) { if ((x % 10 === 0) !== major) continue; const X = x0 + x * cs; ctx.moveTo(X, y0); ctx.lineTo(X, y1); }
      for (let y = 0; y <= p.h; y++) { if (((p.h - y) % 10 === 0) !== major) continue; const Y = y0 + y * L.rowH; ctx.moveTo(x0, Y); ctx.lineTo(x1, Y); }
      if (guides && !major) for (let y = 0; y < p.h; y++) { const Y = y0 + y * L.rowH + cs; ctx.moveTo(x0, Y); ctx.lineTo(x1, Y); }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = theme.line; ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1);
  if (v.numbers && cs >= 4) drawNumbers(ctx, p, v, L, theme);
  ctx.restore();
}

/** Hover, run preview, selection and check marks, over a drawn pattern. */
export function drawOverlay(ctx: CanvasRenderingContext2D, p: Pattern, v: ViewOpts, dpr: number, o: Overlay, theme: Theme = THEME) {
  const L = layout(p, v), cs = v.cs, x0 = L.ml, y0 = L.mt, y1 = L.mt + p.h * L.rowH;
  ctx.save();
  ctx.scale(dpr, dpr);
  if (o.marks?.size) {
    ctx.strokeStyle = theme.warn; ctx.lineWidth = Math.max(1, Math.min(2, cs / 8));
    for (const i of o.marks) { const x = i % p.w, y = (i / p.w) | 0; ctx.strokeRect(x0 + x * cs + 0.5, y0 + y * L.rowH + 0.5, Math.max(1, cs - 1), Math.max(1, L.rowH - 1)); }
  }
  if (o.preview) {
    const op = p.key.ops[o.preview.v];
    if (op) {
      ctx.globalAlpha = 0.8; ctx.fillStyle = hex(op.rgb);
      for (const [x, y] of o.preview.cells) if (x >= 0 && y >= 0 && x < p.w && y < p.h) ctx.fillRect(x0 + x * cs, y0 + y * L.rowH, cs, L.rowH);
      ctx.globalAlpha = 1;
    }
  }
  if (o.hover) {
    const { x, y } = o.hover;
    ctx.strokeStyle = theme.hi; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + x * cs - 0.5, y0 + y * L.rowH - 0.5, cs + 1, L.rowH + 1);
    if (cs >= 3) { // the pass and needle under the pointer, marked on the edges
      ctx.fillStyle = theme.hi;
      ctx.fillRect(x0 - 4, y0 + y * L.rowH, 2, L.rowH);
      ctx.fillRect(x0 + x * cs, y1 + 2, cs, 2);
    }
  }
  if (o.sel) {
    const s = o.sel, X = x0 + s.x * cs, Y = y0 + s.y * L.rowH, W = s.w * cs, H = s.h * L.rowH;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000'; ctx.lineDashOffset = 0; ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 4; ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawNumbers(ctx: CanvasRenderingContext2D, p: Pattern, v: ViewOpts, L: Layout, theme: { dim: string; faint: string }) {
  const cs = v.cs, step = L.rowH >= 16 ? 1 : L.rowH >= 8 ? 5 : 10, nstep = cs >= 22 ? 1 : cs >= 9 ? 5 : 10;
  ctx.font = `${Math.min(11, Math.max(8, L.rowH * 0.7))}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  for (let y = 0; y < p.h; y++) {
    const pass = passOf(p, y), cy = L.mt + y * L.rowH + L.rowH / 2;
    if (pass === 1 || pass % step === 0) { ctx.fillStyle = theme.dim; ctx.textAlign = 'right'; ctx.fillText(String(pass), L.ml - 16, cy); }
    if (L.rowH >= 7) { // pass direction: a small arrow head
      const d = dirOf(p, y), ax = L.ml - 9, s = Math.min(3.5, L.rowH * 0.3);
      ctx.fillStyle = pass === 1 ? theme.dim : theme.faint;
      ctx.beginPath(); ctx.moveTo(ax + d * s, cy); ctx.lineTo(ax - d * s, cy - s); ctx.lineTo(ax - d * s, cy + s); ctx.closePath(); ctx.fill();
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = theme.dim;
  ctx.font = `${Math.min(11, Math.max(8, cs * 0.7))}px "IBM Plex Mono", ui-monospace, monospace`;
  const yb = L.mt + p.h * L.rowH + 6;
  for (let x = 0; x < p.w; x++) {
    const n = x + 1;
    if (n === 1 || n % nstep === 0) ctx.fillText(String(n), L.ml + x * cs + cs / 2, yb);
  }
}
