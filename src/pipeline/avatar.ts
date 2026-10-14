// Avatar style (first in the gallery): the team's clean knitted-portrait look. A paper face with a one-cell
// contour, solid hair with a few paper cuts, solid clothes, and every feature drawn as a small designed shape
// from the face points at the target grid: pupils, lids or dashes, continuous glasses rims, brows, a nose mark,
// a mouth that keeps its teeth, moustache and goatee as their own shapes. Skin shading never decides a cell,
// so a shadowed cheek can't turn into a black patch.
import { JAW, OVAL, bounds, pt, pts, type Pt } from './landmarks';
import { dropSmall, line, percentile, polygon, polyline, type Mask } from './raster';
import {
  BROWS, EYES, LIPS_INNER_LO, LIPS_INNER_UP, LIPS_OUTER, NOSE, STAMPS, dist, eyeSocket, eyeWidth, lens, mid, mouthOpenness,
  mouthWidth, type Face, type Out, type StampKind,
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
const eyeOpenness = (f: Face) => EYES.reduce((s, e) => s + dist(pt(f.lm, e.up[4]), pt(f.lm, e.lo[4])) / Math.max(dist(pt(f.lm, e.o), pt(f.lm, e.i)), 1e-6), 0) / 2;
const set = (m: Mask, f: Face, x: number, y: number) => { if (x >= 0 && y >= 0 && x < f.W && y < f.H) m[y * f.W + x] = 1; };
/** A square of side s whose centre is nearest to c. */
const square = (m: Mask, f: Face, c: Pt, s: number) => {
  const x0 = Math.round(c[0] - s / 2), y0 = Math.round(c[1] - s / 2);
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) set(m, f, x0 + dx, y0 + dy);
};
const pupilSize = (ew: number) => (ew < 3 ? 1 : ew < 8 ? 2 : 3);

export type AvatarEyes = 'pupils' | 'lids' | 'dashes';
/** What auto picks: dashes for narrowed (smiling) eyes, pupils behind glasses, otherwise lid line + pupil. */
export function avatarEyes(f: Face, glasses: boolean): AvatarEyes {
  return eyeOpenness(f) < 0.2 ? 'dashes' : glasses || eyeWidth(f) < 4 ? 'pupils' : 'lids';
}

function drawEyes(f: Face, kind: AvatarEyes, o: Out) {
  eyeSocket(f, o);
  const ew = eyeWidth(f), s = pupilSize(ew);
  for (const e of EYES) {
    const c = pt(f.lm, e.c), out = pt(f.lm, e.o), inn = pt(f.lm, e.i);
    if (kind === 'dashes') {
      const y = (pt(f.lm, e.up[4])[1] + pt(f.lm, e.lo[4])[1]) / 2, a = mid(out, inn, 0.12), b = mid(out, inn, 0.88);
      line(o.ink, f.W, f.H, [a[0], y], [b[0], y]);
      continue;
    }
    if (kind === 'lids') polyline(o.ink, f.W, f.H, pts(f.lm, e.up.slice(1, -1)));
    square(o.ink, f, c, s);
  }
}

/** Glasses: continuous one-cell rims a bit larger than the eyes, cleared lenses, a bridge and short temple arms. */
function drawGlasses(f: Face, skin: Mask, o: Out) {
  const n = f.W * f.H, rim = new Uint8Array(n), fill = new Uint8Array(n), inner: Pt[] = [];
  const d = dist(pt(f.lm, EYES[0].c), pt(f.lm, EYES[1].c)); // lenses nearly meet at the bridge, like real frames
  for (const e of EYES) {
    const [ox, oy] = pt(f.lm, e.o), [ix, iy] = pt(f.lm, e.i), ew = Math.hypot(ix - ox, iy - oy) || 1;
    const u: Pt = [(ix - ox) / ew, (iy - oy) / ew];
    let v: Pt = [-u[1], u[0]]; if (v[1] < 0) v = [-v[0], -v[1]];
    const a = d * 0.41, b = d * 0.37, c: Pt = [(ox + ix) / 2 + v[0] * 0.3, (oy + iy) / 2 + v[1] * 0.3];
    const ring = lens(c, u, v, a, b, 0.35);
    polygon(fill, f.W, f.H, ring);
    polyline(rim, f.W, f.H, ring, true);
    inner.push([c[0] + u[0] * a - v[0] * b * 0.35, c[1] + u[1] * a - v[1] * b * 0.35]);
    // temple arm: from the outer edge, level with the lens top third, outwards across the skin to the face edge
    const sx = c[0] - u[0] * a, y = Math.floor(c[1] - b * 0.45), dir = -Math.sign(u[0]) || 1;
    for (let x = Math.floor(sx) + dir, k = 0; k < Math.ceil(ew * 1.2); x += dir, k++) {
      if (x < 0 || x >= f.W || !skin[y * f.W + x]) break;
      rim[y * f.W + x] = 1;
    }
  }
  if (Math.abs(inner[1][0] - inner[0][0]) >= 1.5) line(rim, f.W, f.H, inner[0], inner[1]); // bridge, when the lenses don't touch
  for (let k = 0; k < n; k++) {
    if (fill[k] && !rim[k]) o.clear[k] = 1;
    if (rim[k]) o.ink[k] = 1;
  }
}

export const browThickness = (f: Face) => BROWS.reduce((s, b) => s + b.lo.reduce((t, k, j) => t + dist(pt(f.lm, k), pt(f.lm, b.up[j])), 0) / b.lo.length, 0) / 2;

/** Two rows where the real brow is about two cells thick, one row otherwise; they give way to glasses rims. */
function drawBrows(f: Face, bold: boolean, o: Out) {
  for (const b of BROWS) {
    const lo = pts(f.lm, b.lo), up = pts(f.lm, b.up), centre = lo.map((q, k) => mid(q, up[k]));
    polyline(o.brow, f.W, f.H, centre);
    if (bold) polyline(o.brow, f.W, f.H, centre.map(([x, y]): Pt => [x, y - 1]));
  }
}

export type AvatarMouth = 'open' | 'smile' | 'line';
export function avatarMouth(f: Face): AvatarMouth {
  const mw = mouthWidth(f), l = pt(f.lm, 61), r = pt(f.lm, 291), cy = (pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2;
  if (mw >= 5 && mouthOpenness(f) > 0.1) return 'open';
  return (cy - (l[1] + r[1]) / 2) / mw > 0.05 ? 'smile' : 'line';
}

function drawMouth(f: Face, kind: AvatarMouth, o: Out) {
  const outer = pts(f.lm, LIPS_OUTER), l = pt(f.lm, 61), r = pt(f.lm, 291), cy = (pt(f.lm, 13)[1] + pt(f.lm, 14)[1]) / 2;
  polygon(o.clear, f.W, f.H, outer);
  if (kind === 'open') { // lips around paper teeth; the teeth keep at least one full row
    const ring = new Uint8Array(f.W * f.H), teeth = new Uint8Array(f.W * f.H), up = pts(f.lm, LIPS_INNER_UP), lo = pts(f.lm, LIPS_INNER_LO);
    const gap = Math.max(0, 1.3 - (cy - pt(f.lm, 13)[1]) * 2) / 2;
    polygon(ring, f.W, f.H, outer);
    polygon(teeth, f.W, f.H, [...up.map(([x, y]): Pt => [x, y - gap]), ...lo.slice(1, -1).reverse().map(([x, y]): Pt => [x, y + gap])]);
    for (let i = 0; i < ring.length; i++) if (ring[i] && !teeth[i]) o.ink[i] = 1;
    return;
  }
  if (kind === 'line') { line(o.ink, f.W, f.H, [mid(l, r, 0.1)[0], cy], [mid(l, r, 0.9)[0], cy]); return; }
  const depth = Math.max(0.8, mouthWidth(f) * 0.14), p: Pt[] = [];
  for (let k = 0; k <= 12; k++) { const t = k / 12, b = mid(l, r, t); p.push([b[0], b[1] - 0.3 + (cy - (l[1] + r[1]) / 2 + depth * 0.6) * Math.sin(Math.PI * t)]); }
  polyline(o.ink, f.W, f.H, p);
}

/** Small nose: one side of the nose and its base (an "L"), only where there is room for it. */
function drawNose(f: Face, o: Out) {
  if (eyeWidth(f) < 3.5) return;
  const b = pt(f.lm, NOSE.bridge), t = pt(f.lm, NOSE.tip), l = pt(f.lm, NOSE.l), s = pt(f.lm, NOSE.base);
  const x = mid(l, t, 0.35)[0], foot: Pt = [x, s[1] - 0.3];
  line(o.ink, f.W, f.H, [x, mid(b, t, 0.55)[1]], foot);
  line(o.ink, f.W, f.H, foot, [mid(foot, s, 0.7)[0], foot[1]]);
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

/** What "auto" draws for a feature in this style (Stamps panel). */
export function avatarAuto(kind: StampKind, f: Face, glasses: boolean): string {
  switch (kind) {
    case 'eyes': return avatarEyes(f, glasses);
    case 'brows': return browThickness(f) >= 1.6 ? 'bold' : 'thin';
    case 'mouth': return avatarMouth(f);
    case 'nose': return glasses || eyeWidth(f) < 3.5 ? 'none' : 'side';
    case 'glasses': return 'frames';
  }
}

// ---------------------------------------------------------------- the style
export function avatarLayers(p: Prepared, look: Look): AvatarLayers {
  const { W, H } = p, n = W * H, cov = coverage(p);
  // Regions: hair takes a cell from 40 % (thin strands survive), the rest goes to the largest share.
  let hair: Mask = new Uint8Array(n);
  const skin = new Uint8Array(n), clothes = new Uint8Array(n), bg = new Uint8Array(n);
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
  hair = fillHoles(dropSmall(hair, W, H, 4), W, H, 3);
  for (let i = 0; i < n; i++) if (hair[i]) { skin[i] = clothes[i] = bg[i] = 0; } else if (!skin[i] && !clothes[i]) bg[i] = 1;
  const person = Uint8Array.from(bg, v => 1 - v);

  // Hair: dark hair solid with a few cuts, light hair as outline + strands (or the hair mode picked by hand).
  const light = p.hairLum >= 95, mode = look.hairMode === 'auto' ? (light ? 'texture' : 'solid') : look.hairMode;
  const hairInk = mode === 'texture' ? strandHair(p, hair, look.hair, look.cleanup) : solidHair(p, hair, mode === 'tone' ? 18 : Math.max(0, (0.5 - look.hair) * 20 + 4));
  // Clothes: solid at the default density; lower density keeps only their darker part.
  const ink = new Uint8Array(n), ct = look.clothes >= 0.5 ? Infinity : percentile(p.ps, clothes, look.clothes * 200);
  for (let i = 0; i < n; i++) ink[i] = hairInk[i] | +(clothes[i] && p.ps[i] <= ct);
  // Shading only above the default skin density.
  if (look.skin > 0.5) { const t = percentile(p.ps, skin, (look.skin - 0.5) * 60); for (let i = 0; i < n; i++) if (skin[i] && p.ps[i] <= t) ink[i] = 1; }

  const sock = new Uint8Array(n), feats = new Uint8Array(n);
  // The person's contour is a thin (4-neighbour) line, drawn by the shared finish like the other styles' outline.
  const r = { ink, sock, feats, bg, person, hair, skin, clothes, sil: edge4(person, bg, W, H), halo: edge4(bg, person, W, H) };
  const lm = p.lm;
  if (!lm) return r;

  const f: Face = { lm, W, H }, F = look.features, chosen = look.stamps;
  if (F.jaw) { const jaw = new Uint8Array(n); polyline(jaw, W, H, pts(lm, JAW)); for (let i = 0; i < n; i++) if (jaw[i] && skin[i]) ink[i] = 1; }

  const ref = cheekTone(p, lm);
  // Calibrated on the test photos: bearded ≥ 0.91 / 0.53, clean-shaven and lips alone ≤ 0.64 / 0.11.
  const hasMoustache = darkShare(p, moustache(f), ref) >= 0.8, hasGoatee = darkShare(p, goatee(f), ref) >= 0.4;
  const browDark = browThickness(f) >= 1.6;

  const o: Out = { clear: sock, ink: feats, brow: new Uint8Array(n) };
  const user = (kind: StampKind) => (chosen[kind] > 0 ? STAMPS[kind][Math.min(chosen[kind], STAMPS[kind].length) - 1].draw : null);
  const pick = (kind: StampKind, own: () => void) => { const u = user(kind); if (u) u(f, o); else own(); };

  if (F.brows) pick('brows', () => drawBrows(f, browDark, o));
  if (F.eyes) pick('eyes', () => drawEyes(f, avatarEyes(f, F.glasses), o));
  const mouthInk = new Uint8Array(n), mo: Out = { clear: sock, ink: mouthInk, brow: o.brow };
  const mouthKind = avatarMouth(f), closedUnder = hasMoustache && mouthKind === 'line' && !user('mouth');
  if (F.mouth) { const u = user('mouth'); if (u) u(f, mo); else if (!closedUnder) drawMouth(f, mouthKind, mo); }
  if (F.nostrils) pick('nose', () => { if (!F.glasses) drawNose(f, o); }); // behind glasses the bridge says enough
  // Facial hair as its own shapes, kept one paper cell away from the mouth.
  const fh = new Uint8Array(n);
  if (hasMoustache) fillRows(fh, f, moustacheBar(f, closedUnder));
  if (hasGoatee) {
    let lip = Math.floor(pt(lm, 14)[1]);
    for (let i = 0; i < n; i++) if (mouthInk[i] || fh[i]) lip = Math.max(lip, Math.floor(i / W));
    fillRows(fh, f, goateeRows(f, lip));
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mouthInk[i]) continue;
      for (const yy of [y - 1, y + 1]) if (yy >= 0 && yy < H && !mouthInk[yy * W + x]) { fh[yy * W + x] = 0; sock[yy * W + x] = 1; }
    }
  for (let i = 0; i < n; i++) { feats[i] |= fh[i] | mouthInk[i]; if (fh[i]) sock[i] = 0; }
  // Glasses last among the shapes: rims stay continuous, brows touching a rim give way.
  if (F.glasses) {
    const u = user('glasses');
    const g: Out = { clear: new Uint8Array(n), ink: new Uint8Array(n), brow: new Uint8Array(n) };
    if (u) u(f, g); else drawGlasses(f, skin, g);
    const near = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.ink[y * W + x]) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) set(near, f, x + dx, y + dy);
    // A brow that loses most of itself to the rim is dropped whole rather than left as stubs.
    let had = 0, kept = 0;
    for (let i = 0; i < n; i++) if (o.brow[i]) { had++; kept += +!near[i]; }
    for (let i = 0; i < n; i++) { if (near[i] || kept < had * 0.6) o.brow[i] = 0; if (g.clear[i] && !feats[i]) sock[i] = 1; if (g.ink[i]) feats[i] = 1; }
  }
  for (let i = 0; i < n; i++) feats[i] |= o.brow[i];
  return r;
}
