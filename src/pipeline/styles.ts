// Styles A–D (research/prototype/exp2.py run2). Work in ink masks (1 = ink), return palette indices.
import { featureMasks, type FeatureMasks } from './features';
import type { LineMap } from './ml';
import { areaResize } from './prep';
import { boundary, clean, dropSmall, percentile, type Mask } from './raster';
import { SEG, type Look, type Prepared, type StyleId, type StyleResult } from './types';

interface Regions { bg: Mask; person: Mask; hair: Mask; skin: Mask; clothes: Mask; sil: Mask; halo: Mask }

function regions(p: Prepared, fm: FeatureMasks): Regions {
  const n = p.W * p.H, bg = new Uint8Array(n), person = new Uint8Array(n), hair = new Uint8Array(n),
    skin = new Uint8Array(n), clothes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = p.segs[i];
    bg[i] = +(s === SEG.BG); person[i] = +(s !== SEG.BG); hair[i] = +(s === SEG.HAIR);
    skin[i] = +(s === SEG.BODY || s === SEG.FACE || !!fm.faceAcc[i]); clothes[i] = +((s === SEG.CLOTHES || s === SEG.OTHER) && !fm.faceAcc[i]);
  }
  return { bg, person, hair, skin, clothes, sil: boundary(person, bg, p.W, p.H), halo: boundary(bg, person, p.W, p.H) };
}

/** Density slider → percentile: 0 → 0 (all paper), 0.5 → the style's tuned value, 1 → 100 (all ink). */
const densityToQ = (d: number, q0: number) => (d <= 0.5 ? q0 * d / 0.5 : q0 + (100 - q0) * (d - 0.5) / 0.5);

/** Cells of `region` at or below the region's q-th tone percentile become ink, the rest paper. */
function cut(ink: Mask, tone: Float32Array, region: Mask, q: number, strict = false) {
  const t = q <= 0 ? -Infinity : percentile(tone, region, q);
  for (let i = 0; i < ink.length; i++)
    if (region[i]) ink[i] = +(strict ? tone[i] < t : tone[i] <= t);
}

// Tone span below which a "photo" background counts as flat (0..255).
const BG_MIN_SPAN = 64;

// 4×4 Bayer order: the background pattern inks the cells whose rank is below density × 16 (evenly spread dots).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Sockets → paper, features → ink, then the background. The outline keeps person and background apart:
 * an ink line on the person against white, a paper gap on the background side for black / pattern / photo.
 */
function finish(ink: Mask, fm: FeatureMasks, r: Regions, look: Look, W: number) {
  const bg = look.background, outline = look.features.silhouette;
  for (let i = 0; i < ink.length; i++) {
    if (fm.sock[i]) ink[i] = 0;
    if (fm.feats[i]) ink[i] = 1;
    if (r.bg[i]) {
      if (bg === 'white') ink[i] = 0;
      else if (bg === 'black') ink[i] = 1;
      else if (bg === 'pattern') ink[i] = +(BAYER4[((i / W | 0) % 4) * 4 + (i % W) % 4] < look.bgDensity * 16);
      if (outline && bg !== 'white' && r.halo[i]) ink[i] = 0;
    } else if (outline && bg !== 'black' && r.sil[i]) ink[i] = 1;
  }
  return ink;
}

/** Region-normalised tone used by C and D, shifted by each region's density (and the background, for "photo"). */
function normTone(p: Prepared, r: Regions, look: Look) {
  const t = p.ps.slice();
  const spec: [Mask, Float32Array, number, number, number, number][] = [
    [r.skin, p.ps, 3, 70, look.skin, 0], [r.hair, p.ps, 2, 98, look.hair, HAIR_TONE_LIFT * hairLight(p)], [r.clothes, p.ps, 2, 90, look.clothes, 0]];
  if (look.background === 'photo') spec.push([r.bg, p.bgps, 2, 98, look.bgDensity, 0]);
  for (const [reg, tone, qlo, qhi, d, lift] of spec) {
    // A near-flat background (plain wall) must not be stretched into full-range noise.
    const lo = percentile(tone, reg, qlo), hi = percentile(tone, reg, qhi), shift = (0.5 - d) * 255 + lift;
    const span = Math.max(hi - lo, reg === r.bg ? BG_MIN_SPAN : 1);
    for (let i = 0; i < t.length; i++)
      if (reg[i]) t[i] = Math.min(255, Math.max(0, Math.min(1, Math.max(0, (tone[i] - hi + span) / span)) * 255 + shift));
  }
  return t;
}

// ---------------------------------------------------------------- hair (SPEC: mode solid / tone / texture + density)
type HairMode = Exclude<Look['hairMode'], 'auto'>;
const HAIR_TONE_LIFT = 90; // how much lighter (of 255) the tone of very light hair is drawn

/** 0 for black hair … 1 for very light hair, from the measured median luminance (60 → 0, 170 → 1). */
const hairLight = (p: Prepared) => (p.hairLum < 0 ? 0 : Math.min(1, Math.max(0, (p.hairLum - 60) / 110)));

/** Hair cells that disagree with ≥ 6 of their hair neighbours flip: lone flecks merge into the mass. */
function smoothHair(ink: Mask, r: Regions, W: number, H: number): Mask {
  const out = ink.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!r.hair[i]) continue;
      let n = 0, differ = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && r.hair[yy * W + xx]) { n++; differ += +(ink[yy * W + xx] !== ink[i]); }
        }
      if (n >= 5 && differ >= 6) out[i] = ink[i] ? 0 : 1;
    }
  return out;
}

const HAIR: Record<HairMode, (p: Prepared, r: Regions, look: Look) => Mask> = {
  /** One mass with its larger highlights; light hair gets far less ink at the same density. */
  solid: (p, r, look) => {
    const ink = new Uint8Array(p.W * p.H);
    cut(ink, p.ps, r.hair, densityToQ(look.hair, 88 - 50 * hairLight(p)));
    return smoothHair(ink, r, p.W, p.H);
  },
  /** Four pattern levels (ink · 75 % · 50 % · paper) in coherent zones; light hair stays light. */
  tone: (p, r, look) => {
    const { W, H } = p, lo = percentile(p.ps, r.hair, 2), hi = percentile(p.ps, r.hair, 98);
    const shift = (0.5 - look.hair) * 255 + HAIR_TONE_LIFT * hairLight(p), lvl = new Uint8Array(W * H), ink = new Uint8Array(W * H);
    for (let i = 0; i < lvl.length; i++)
      if (r.hair[i]) lvl[i] = Math.round(Math.min(255, Math.max(0, (p.ps[i] - lo) / Math.max(hi - lo, 1) * 255 + shift)) / 255 * 3);
    const votes = new Int32Array(4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!r.hair[y * W + x]) continue;
        votes.fill(0);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && r.hair[yy * W + xx]) votes[lvl[yy * W + xx]]++;
          }
        let best = 0; for (let k = 1; k < 4; k++) if (votes[k] > votes[best]) best = k;
        ink[y * W + x] = PATTERN(best, x, y);
      }
    return ink;
  },
  /** The hair's outline, its strand lines and its darkest shadows — curls stay curls. */
  texture: (p, r, look) => {
    const { W, H } = p, n = W * H, ink = new Uint8Array(n);
    const notHair = Uint8Array.from(r.hair, v => 1 - v), rim = boundary(r.hair, notHair, W, H);
    cut(ink, p.ps, r.hair, densityToQ(look.hair, 10));
    const t = 0.32 - 0.26 * look.hair; // density 0.5 → lines covering ≥ 19 % of a cell
    for (let i = 0; i < n; i++) if (r.hair[i] && !rim[i] && p.lines[i] > t) ink[i] = 1;
    const strands = dropSmall(ink, W, H, 3); // strands are long; lone specks are photo noise
    for (let i = 0; i < n; i++) strands[i] = r.hair[i] ? strands[i] | rim[i] : 0;
    return strands;
  },
};

/** Replace the hair cells with the chosen mode; in "auto" the style uses `own` (or keeps its hair when null). */
function applyHair(ink: Mask, p: Prepared, r: Regions, look: Look, own: HairMode | null) {
  const mode = look.hairMode === 'auto' ? own : look.hairMode;
  if (!mode) return;
  const h = HAIR[mode](p, r, look);
  for (let i = 0; i < ink.length; i++) if (r.hair[i]) ink[i] = h[i];
}

function styleA(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, ink = new Uint8Array(W * H);
  cut(ink, p.ps, r.skin, densityToQ(look.skin, 22));
  applyHair(ink, p, r, look, 'solid');
  cut(ink, p.ps, r.clothes, densityToQ(look.clothes, 55));
  if (look.background === 'photo') {
    // Ink the darkest share of the background, but only cells clearly darker than its median.
    cut(ink, p.bgps, r.bg, look.bgDensity * 100);
    const mid = percentile(p.bgps, r.bg, 50);
    for (let i = 0; i < ink.length; i++) if (r.bg[i] && p.bgps[i] > mid - BG_MIN_SPAN / 4) ink[i] = 0;
  }
  const protect = new Uint8Array(W * H);
  for (let i = 0; i < protect.length; i++) protect[i] = fm.feats[i] | fm.sock[i];
  return finish(clean(ink, W, H, look.cleanup, protect), fm, r, look, W);
}

function styleB(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const ink = styleA(p, r, fm, look);
  cut(ink, p.ps, r.skin, densityToQ(look.skin, 8), true); // skin stays open except its darkest shadows
  for (let i = 0; i < ink.length; i++) if (fm.jaw[i] && r.skin[i]) ink[i] = 1;
  return finish(ink, fm, r, look, p.W);
}

// 2×2 ordered patterns for the four tone levels: ink, 75 % ink, 50 % ink, paper.
const PATTERN = (lvl: number, x: number, y: number) =>
  lvl === 0 ? 1 : lvl === 3 ? 0 : lvl === 1 ? +!(x % 2 === 0 && y % 2 === 0) : +((x + y) % 2 === 1);

function styleC(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, t = normTone(p, r, look), lvl = new Uint8Array(W * H);
  const photo = look.background === 'photo';
  for (let i = 0; i < lvl.length; i++) lvl[i] = r.bg[i] && !photo ? 3 : Math.round(t[i] / 255 * 3);
  // 3×3 majority of tone levels → coherent pattern zones instead of per-cell noise.
  const ink = new Uint8Array(W * H), votes = new Int32Array(4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      votes.fill(0);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          votes[lvl[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))]]++;
      let best = 0; for (let k = 1; k < 4; k++) if (votes[k] > votes[best]) best = k;
      ink[y * W + x] = PATTERN(best, x, y);
    }
  applyHair(ink, p, r, look, null);
  return finish(ink, fm, r, look, W);
}

function styleD(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, t = normTone(p, r, look), f = new Float32Array(W * H), ink = new Uint8Array(W * H);
  const photo = look.background === 'photo';
  for (let i = 0; i < f.length; i++) f[i] = r.bg[i] && !photo ? 1 : t[i] / 255;
  const spread: [number, number][] = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]; // Atkinson: 6 × 1/8
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, white = f[i] >= 0.5, e = f[i] - (white ? 1 : 0);
      ink[i] = +!white;
      for (const [dx, dy] of spread) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < W && yy < H) f[yy * W + xx] += e / 8;
      }
    }
  applyHair(ink, p, r, look, null);
  return finish(ink, fm, r, look, W);
}

/** E: model lines → cells by coverage, hair / clothes cut by region, eyes / brows / glasses redrawn (exp6.py "F"). */
function styleE(p: Prepared, r: Regions, look: Look, lines: LineMap) {
  const { W, H } = p, cov = areaResize(lines.ink, lines.w, lines.h, W, H), t = (W < 70 ? 0.16 : 0.22) / look.lineWeight;
  let ink = clean(Uint8Array.from(cov, c => +(c > t)), W, H, look.cleanup);
  applyHair(ink, p, r, look, 'solid');
  cut(ink, p.ps, r.clothes, densityToQ(look.clothes, 55));
  // The model draws mouth, nose and jaw itself; eyes, brows and glasses (and any stamp picked by hand) are stamped.
  const fm = featureMasks(p, look, { modelFace: true });
  ink = clean(ink, W, H, look.cleanup, fm.sock);
  return finish(ink, fm, r, look, W);
}

const RENDER = { A: styleA, B: styleB, C: styleC, D: styleD };

/** Renders the given styles; E needs the line map from ml.ts. */
export function renderStyles(p: Prepared, styles: StyleId[], look: Look, lines?: LineMap): StyleResult[] {
  const fm = featureMasks(p, look), r = regions(p, fm);
  return styles.map(style => {
    const t0 = performance.now(), cells = new Uint8Array(p.W * p.H);
    const ink = style === 'E' ? styleE(p, r, look, lines!) : RENDER[style](p, r, fm, look);
    let n = 0;
    for (let i = 0; i < ink.length; i++) { cells[i] = ink[i] ? 0 : 1; n += ink[i]; }
    return { style, cells, ms: performance.now() - t0, ink: n / ink.length };
  });
}
