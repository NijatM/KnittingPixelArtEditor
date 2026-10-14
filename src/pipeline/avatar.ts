// Avatar style (first in the gallery): the team's clean knitted-portrait look. A paper face with a one-cell
// contour, solid hair with a few paper cuts, solid clothes, and every feature drawn as a small designed shape
// from the face points at the target grid: pupils, lids or dashes, continuous glasses rims, brows, a nose mark,
// a mouth that keeps its teeth, moustache and goatee as their own shapes. Skin shading never decides a cell,
// so a shadowed cheek can't turn into a black patch.
import { JAW, OVAL, bounds, pt, pts, type Pt } from './landmarks';
import { dropSmall, percentile, polygon, polyline, type Mask } from './raster';
import {
  BROWS, NOSE, dist, drawStamps, eyeOpenness, eyeWidth, lensName, mouthOpenness, mouthWidth, type Face, type StampKind,
} from './stamps';
import { SEG, type Look, type Prepared } from './types';

export interface AvatarLayers {
  ink: Mask;     // hair, clothes, contours (before features)
  sock: Mask;    // forced paper
  feats: Mask;   // forced ink, protected
  bg: Mask; person: Mask; hair: Mask; skin: Mask; clothes: Mask; sil: Mask; halo: Mask;
}

// ---------------------------------------------------------------- regions from the work image
/** Share of each cell's work pixels per region. Accessories count as skin on the face, as clothes elsewhere. */
function coverage(p: Prepared) {
  const { W, H, work: { f, w, seg, gray } } = p, n = W * H, hair = new Float32Array(n), skin = new Float32Array(n), clothes = new Float32Array(n);
  const body = new Float32Array(n), bodyTone = new Float32Array(n);
  const o = p.lm ? bounds(pts(p.lm, OVAL)) : null, mx = o ? (o.x1 - o.x0) * 0.15 : 0, my = o ? (o.y1 - o.y0) * 0.1 : 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const onFace = !!o && x >= o.x0 - mx && x <= o.x1 + mx && y >= o.y0 - my && y <= o.y1 + my;
      let h = 0, s = 0, c = 0, b = 0, bt = 0;
      for (let j = 0; j < f; j++)
        for (let i = 0; i < f; i++) {
          const q = (y * f + j) * w + x * f + i, v = seg[q];
          if (v === SEG.HAIR) h++;
          else if (v === SEG.FACE || v === SEG.BODY || (v === SEG.OTHER && onFace)) { s++; if (v === SEG.BODY) { b++; bt += gray[q]; } }
          else if (v === SEG.CLOTHES || v === SEG.OTHER) c++;
        }
      const k = y * W + x, a = f * f;
      hair[k] = h / a; skin[k] = s / a; clothes[k] = c / a; body[k] = b / a; bodyTone[k] = b ? bt / b : 255;
    }
  return { hair, skin, clothes, body, bodyTone };
}

/** Set cells of `m` gain the 4-connected holes of at most `max` cells that don't reach the grid edge. */
function fillHoles(m: Mask, W: number, H: number, max: number): Mask {
  const out = m.slice(), seen = new Uint8Array(W * H), comp: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (m[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1; comp.length = 0;
    let edge = false;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      comp.push(i);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && !m[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    if (!edge && comp.length <= max) for (const i of comp) out[i] = 1;
  }
  return out;
}

/** Cells of `inside` with a 4-neighbour in `outside`: a thin (8-connected) contour. */
function edge4(inside: Mask, outside: Mask, W: number, H: number): Mask {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (inside[i] && ((x > 0 && outside[i - 1]) || (x < W - 1 && outside[i + 1]) || (y > 0 && outside[i - W]) || (y < H - 1 && outside[i + W]))) out[i] = 1;
    }
  return out;
}

// ---------------------------------------------------------------- hair
/** Dark hair: one solid mass with a few paper cuts where the photo's hair is brightest (inside, never on the edge). */
function solidHair(p: Prepared, hair: Mask, share: number): Mask {
  const { W, H } = p, ink = hair.slice();
  if (share <= 0) return ink;
  const t = percentile(p.ps, hair, 100 - share), cut = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!hair[i] || p.ps[i] < t) continue;
      let inner = true;
      for (let dy = -1; dy <= 1 && inner; dy++) for (let dx = -1; dx <= 1; dx++) if (!hair[i + dy * W + dx]) { inner = false; break; }
      if (inner) cut[i] = 1;
    }
  const keep = dropSmall(cut, W, H, 2);
  for (let i = 0; i < ink.length; i++) if (keep[i]) ink[i] = 0;
  return ink;
}

/** Light or curly hair: the hair's outline plus its darker strands (cells darker than their neighbourhood). */
function strandHair(p: Prepared, hair: Mask, density: number, cleanup: number): Mask {
  const { W, H } = p, ink = new Uint8Array(W * H), rim = edge4(hair, Uint8Array.from(hair, v => 1 - v), W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!hair[i]) continue;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && hair[yy * W + xx]) { s += p.ps[yy * W + xx]; n++; }
        }
      if (p.ps[i] < s / n + (density - 0.5) * 60 + 12) ink[i] = 1; // ≈ 60 % ink at the default, like the team's curls
    }
  // Lone paper specks inside the mass become ink; ink specks go (under 3 cells at the default cleanup).
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (hair[i] && !ink[i] && ink[i - 1] && ink[i + 1] && ink[i - W] && ink[i + W]) ink[i] = 1;
    }
  const strands = dropSmall(ink, W, H, 1 + cleanup);
  for (let i = 0; i < ink.length; i++) strands[i] = hair[i] ? strands[i] | rim[i] : 0;
  return strands;
}

// ---------------------------------------------------------------- measurements on the work image
/** Median work-image tone (or plain grey) of the cheek skin between the eyes and the nose base: the reference for "dark". */
function cheekTone(p: Prepared, g: Float32Array, tone = p.work.tone): number {
  const { f, w, h, seg } = p.work, eyeY = (pt(g, 33)[1] + pt(g, 263)[1]) / 2 * f, baseY = pt(g, NOSE.base)[1] * f;
  const o = bounds(pts(g, OVAL)), v: number[] = [];
  for (let y = Math.max(0, Math.floor(eyeY + (baseY - eyeY) * 0.3)); y < Math.min(h, baseY); y++)
    for (let x = Math.max(0, Math.floor(o.x0 * f)); x < Math.min(w, o.x1 * f); x++)
      if (seg[y * w + x] === SEG.FACE) v.push(tone[y * w + x]);
  if (!v.length) return 160;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

/** Share of the face pixels inside a grid-space polygon that are clearly darker than the cheeks. */
function darkShare(p: Prepared, poly: Pt[], ref: number, margin = 30): number {
  const { f, w, h, tone, seg } = p.work, m = new Uint8Array(w * h);
  polygon(m, w, h, poly.map(([x, y]): Pt => [x * f, y * f]));
  let n = 0, d = 0;
  for (let i = 0; i < m.length; i++)
    if (m[i] && (seg[i] === SEG.FACE || seg[i] === SEG.BODY || seg[i] === SEG.HAIR)) { n++; d += +(tone[i] < ref - margin); }
  return n < 8 ? 0 : d / n;
}

// ---------------------------------------------------------------- features
const set = (m: Mask, f: Face, x: number, y: number) => { if (x >= 0 && y >= 0 && x < f.W && y < f.H) m[y * f.W + x] = 1; };
export const browThickness = (f: Face) => BROWS.reduce((s, b) => s + b.lo.reduce((t, k, j) => t + dist(pt(f.lm, k), pt(f.lm, b.up[j])), 0) / b.lo.length, 0) / 2;

/** open (lips apart) · smile (corners above the middle) · line. */
export function avatarMouth(f: Face): 'open' | 'smile' | 'line' {
  const mw = mouthWidth(f), l = pt(f.lm, 61), r = pt(f.lm, 291), cy = (pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2;
  if (mw >= 5 && mouthOpenness(f) > 0.1) return 'open';
  return (cy - (l[1] + r[1]) / 2) / mw > 0.05 ? 'smile' : 'line';
}

/**
 * What "auto" draws in this style ('' = nothing): dashes for narrowed (smiling) eyes, pupils behind glasses or on
 * small faces, otherwise lid + pupil; two-row brows only where the real brow is that thick; the mouth's shape;
 * a small nose except behind glasses; glasses shaped like the measured lenses.
 */
export function avatarAuto(kind: StampKind, f: Face, glasses: boolean): string {
  switch (kind) {
    case 'eyes': return eyeOpenness(f) < 0.2 ? 'dashes' : glasses || eyeWidth(f) < 4 ? 'pupils' : 'lids';
    case 'brows': return browThickness(f) >= 1.6 ? 'bold' : 'thin';
    case 'mouth': { const m = avatarMouth(f); return m === 'open' ? 'grin' : m; } // an open smile: a D with paper teeth
    case 'nose': return glasses || eyeWidth(f) < 3.5 ? '' : 'L';
    case 'glasses': return lensName(f.lenses);
  }
}

/** Moustache zone, nose base → mouth line (measured for darkness). */
function moustache(f: Face): Pt[] {
  const l = pt(f.lm, 61), r = pt(f.lm, 291), top = pt(f.lm, NOSE.base)[1] + 0.7, w = mouthWidth(f);
  const y1 = Math.max((pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2 + 0.3, top + 1.6);
  return [[l[0] - w * 0.02, y1], [l[0] + w * 0.16, top], [r[0] - w * 0.16, top], [r[0] + w * 0.02, y1]];
}

/** Rows of cells [y, x0, x1] (inclusive). */
type Rows = [number, number, number][];
const fillRows = (m: Mask, f: Face, rows: Rows) => { for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x++) set(m, f, x, y); };

/**
 * Moustache bar: about a fifth of the mouth width tall (two rows at 50 wide), corner to corner at the bottom, inset
 * on top. It ends on the mouth line when the mouth is closed (it is the mouth then), above the upper lip otherwise.
 */
function moustacheBar(f: Face, closed: boolean): Rows {
  const l = pt(f.lm, 61), r = pt(f.lm, 291), w = mouthWidth(f), cy = (pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2;
  const bottom = Math.floor(closed ? cy : pt(f.lm, 0)[1] - 0.5), top = Math.max(Math.floor(pt(f.lm, NOSE.base)[1]) + 2, bottom - Math.max(1, Math.round(w * 0.22)) + 1);
  const rows: Rows = [];
  for (let y = top; y <= bottom; y++) {
    const inset = bottom > top ? w * 0.14 * (bottom - y) / (bottom - top) : 0;
    rows.push([y, Math.round(l[0] + inset), Math.round(r[0] - 1 + 0.5 - inset)]);
  }
  return rows;
}

/** Goatee: one paper row under the lip, then a patch about a third of the mouth wide, narrowing by a cell per row. */
function goateeRows(f: Face, lipBottom: number): Rows {
  const c = pt(f.lm, 17), chin = pt(f.lm, 152), w = mouthWidth(f), rows: Rows = [];
  const top = lipBottom + 2, last = Math.min(Math.floor(chin[1]) - 2, top + Math.max(0, Math.round(w * 0.2) - 1));
  let half = Math.max(1, Math.round(w * 0.16));
  for (let y = top; y <= last && half >= 0.5; y++, half -= 0.5) rows.push([y, Math.round(c[0] - half), Math.round(c[0] + half) - 1]);
  return rows;
}

/** Goatee zone, lower lip → chin, about half the mouth wide (measured for darkness). */
function goatee(f: Face): Pt[] {
  const c = pt(f.lm, 17), chin = pt(f.lm, 152), w = mouthWidth(f), top = c[1] + 0.9, bot = Math.max(top + 1, chin[1] - 0.6);
  return [[c[0] - w * 0.28, top], [c[0] + w * 0.28, top], [c[0] + w * 0.08, bot], [c[0] - w * 0.08, bot]];
}

// ---------------------------------------------------------------- the style
const neighbours = (m: Mask, W: number, H: number, x: number, y: number) => {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H) n += m[yy * W + xx];
    }
  return n;
};

/** One pass along `m`'s border with `other`: spurs (≤ 2 of 8 neighbours in m) go, notches (≥ 6) fill. */
function smoothEdge(m: Mask, other: Mask, W: number, H: number): Mask {
  const out = m.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = neighbours(m, W, H, x, y);
      if (m[i] && k <= 2 && neighbours(other, W, H, x, y)) out[i] = 0;
      else if (other[i] && k >= 6) out[i] = 1;
    }
  return out;
}

export function avatarLayers(p: Prepared, look: Look): AvatarLayers {
  const { W, H } = p, n = W * H, cov = coverage(p);
  // Regions: hair takes a cell from 40 % (thin strands survive), the rest goes to the largest share.
  let hair: Mask = new Uint8Array(n), clothes: Mask = new Uint8Array(n);
  const skin = new Uint8Array(n), bg = new Uint8Array(n);
  const lm0 = p.lm, chinY = lm0 ? pt(lm0, 152)[1] : Infinity, cheek = lm0 ? cheekTone(p, lm0, p.work.gray) : 0;
  for (let i = 0; i < n; i++) {
    if (cov.hair[i] >= 0.4) { hair[i] = 1; continue; }
    // MediaPipe sometimes calls a black top under the chin "body skin". Far below the cheeks' plain grey (a neck
    // shadow keeps about half of it, at any skin tone) → clothes.
    if (cov.body[i] > cov.skin[i] / 2 && Math.floor(i / W) > chinY + 1 && cov.bodyTone[i] < cheek * 0.35) { cov.clothes[i] += cov.skin[i]; cov.skin[i] = 0; }
    const b = 1 - cov.hair[i] - cov.skin[i] - cov.clothes[i];
    if (cov.skin[i] >= cov.clothes[i] && cov.skin[i] >= b) skin[i] = 1;
    else if (cov.clothes[i] >= b) clothes[i] = 1;
    else bg[i] = 1;
  }
  // Clean silhouettes: hair specks and pin-holes, ragged hair edges against the background, clothes specks
  // (earrings, a strap end) become background.
  hair = fillHoles(dropSmall(hair, W, H, 5), W, H, 3);
  const notHair = () => Uint8Array.from(hair, (v, i) => +(!v && !skin[i] && !clothes[i]));
  hair = smoothEdge(hair, notHair(), W, H);
  clothes = dropSmall(clothes, W, H, 5);
  for (let i = 0; i < n; i++) { if (hair[i]) skin[i] = clothes[i] = 0; bg[i] = +(!hair[i] && !skin[i] && !clothes[i]); }
  const person = Uint8Array.from(bg, v => 1 - v);

  // Hair: dark hair solid with a few cuts, light hair as outline + strands (or the hair mode picked by hand).
  const light = p.hairLum >= 95, mode = look.hairMode === 'auto' ? (light ? 'texture' : 'solid') : look.hairMode;
  const hairInk = mode === 'texture' ? strandHair(p, hair, look.hair, look.cleanup) : solidHair(p, hair, mode === 'tone' ? 18 : Math.max(0, (0.5 - look.hair) * 20 + 4));
  // Clothes: solid at the default density; lower density keeps only their darker part.
  const ink = new Uint8Array(n), ct = look.clothes >= 0.5 ? Infinity : percentile(p.ps, clothes, look.clothes * 200);
  for (let i = 0; i < n; i++) ink[i] = hairInk[i] | +(clothes[i] && p.ps[i] <= ct);
  // Where solid hair lies on solid clothes, a one-cell paper gap on the clothes side keeps the locks readable.
  // Only along locks (hair cells with two or more hair neighbours side by side): lone diagonal strands just merge,
  // instead of breaking the clothes into a checkerboard.
  const at = (x: number, y: number, m: Mask) => x >= 0 && y >= 0 && x < W && y < H && !!m[y * W + x];
  const lock = (x: number, y: number) => at(x, y, hair) && at(x, y, hairInk) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(x + dx, y + dy, hair)).length >= 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (clothes[i] && ink[i] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => lock(x + dx, y + dy))) ink[i] = 0;
    }
  // Shading only above the default skin density.
  if (look.skin > 0.5) { const t = percentile(p.ps, skin, (look.skin - 0.5) * 60); for (let i = 0; i < n; i++) if (skin[i] && p.ps[i] <= t) ink[i] = 1; }

  const sock = new Uint8Array(n), feats = new Uint8Array(n);
  // The person's contour is a thin (4-neighbour) line, drawn by the shared finish like the other styles' outline.
  const r = { ink, sock, feats, bg, person, hair, skin, clothes, sil: edge4(person, bg, W, H), halo: edge4(bg, person, W, H) };
  const lm = p.lm;
  if (!lm) return r;

  const f: Face = { lm, W, H, lenses: p.lenses, skin }, F = look.features;
  if (F.jaw) { const jaw = new Uint8Array(n); polyline(jaw, W, H, pts(lm, JAW)); for (let i = 0; i < n; i++) if (jaw[i] && skin[i]) ink[i] = 1; }

  const ref = cheekTone(p, lm);
  // Calibrated on the test photos: bearded ≥ 0.91 / 0.53, clean-shaven and lips alone ≤ 0.64 / 0.11.
  const hasMoustache = darkShare(p, moustache(f), ref) >= 0.8, hasGoatee = darkShare(p, goatee(f), ref) >= 0.4;
  // A closed mouth under a moustache: the moustache is the mouth.
  const auto = (kind: StampKind) => { const a = avatarAuto(kind, f, F.glasses); return kind === 'mouth' && hasMoustache && a === 'line' ? '' : a; };
  const s = drawStamps(f, { eyes: F.eyes, brows: F.brows, mouth: F.mouth, nose: F.nostrils, glasses: F.glasses }, look.stamps, auto);
  const closedUnder = hasMoustache && !s.mouth.some(Boolean);

  // Facial hair as its own shapes, kept one paper cell away from the mouth.
  const fh = new Uint8Array(n);
  if (hasMoustache) fillRows(fh, f, moustacheBar(f, closedUnder));
  if (hasGoatee) {
    let lip = Math.floor(pt(lm, 14)[1]);
    for (let i = 0; i < n; i++) if (s.mouth[i] || fh[i]) lip = Math.max(lip, Math.floor(i / W));
    fillRows(fh, f, goateeRows(f, lip));
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!s.mouth[y * W + x]) continue;
      for (const yy of [y - 1, y + 1]) if (yy >= 0 && yy < H && !s.mouth[yy * W + x]) { fh[yy * W + x] = 0; s.clear[yy * W + x] = 1; }
    }
  for (let i = 0; i < n; i++) { sock[i] = s.clear[i] & +!fh[i]; feats[i] = s.ink[i] | fh[i]; }
  return r;
}
