// Styles A–D (research/prototype/exp2.py run2). Work in ink masks (1 = ink), return palette indices.
import { featureMasks, type FeatureMasks } from './features';
import { boundary, clean, percentile, type Mask } from './raster';
import { SEG, type Look, type Prepared, type StyleId, type StyleResult } from './types';

interface Regions { bg: Mask; person: Mask; hair: Mask; skin: Mask; clothes: Mask; sil: Mask }

function regions(p: Prepared, fm: FeatureMasks): Regions {
  const n = p.W * p.H, bg = new Uint8Array(n), person = new Uint8Array(n), hair = new Uint8Array(n),
    skin = new Uint8Array(n), clothes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = p.segs[i];
    bg[i] = +(s === SEG.BG); person[i] = +(s !== SEG.BG); hair[i] = +(s === SEG.HAIR);
    skin[i] = +(s === SEG.BODY || s === SEG.FACE || !!fm.lens[i]); clothes[i] = +((s === SEG.CLOTHES || s === SEG.OTHER) && !fm.lens[i]);
  }
  return { bg, person, hair, skin, clothes, sil: boundary(person, bg, p.W, p.H) };
}

/** Density slider → percentile: 0 → 0 (all paper), 0.5 → the style's tuned value, 1 → 100 (all ink). */
const densityToQ = (d: number, q0: number) => (d <= 0.5 ? q0 * d / 0.5 : q0 + (100 - q0) * (d - 0.5) / 0.5);

/** Cells of `region` at or below the region's q-th tone percentile become ink, the rest paper. */
function cut(ink: Mask, p: Prepared, region: Mask, q: number, strict = false) {
  const t = q <= 0 ? -Infinity : percentile(p.ps, region, q);
  for (let i = 0; i < ink.length; i++)
    if (region[i]) ink[i] = +(strict ? p.ps[i] < t : p.ps[i] <= t);
}

/** Sockets → paper, features → ink, silhouette, background. */
function finish(ink: Mask, fm: FeatureMasks, r: Regions, look: Look) {
  for (let i = 0; i < ink.length; i++) {
    if (fm.sock[i]) ink[i] = 0;
    if (fm.feats[i]) ink[i] = 1;
    if (look.background === 'black') { if (r.bg[i]) ink[i] = 1; }
    else if (look.features.silhouette && r.sil[i]) ink[i] = 1;
  }
  return ink;
}

/** Region-normalised tone used by C and D, shifted by each region's density. */
function normTone(p: Prepared, r: Regions, look: Look) {
  const t = p.ps.slice();
  const spec: [Mask, number, number, number][] = [[r.skin, 3, 70, look.skin], [r.hair, 2, 98, look.hair], [r.clothes, 2, 90, look.clothes]];
  for (const [reg, qlo, qhi, d] of spec) {
    const lo = percentile(p.ps, reg, qlo), hi = percentile(p.ps, reg, qhi), shift = (0.5 - d) * 255;
    for (let i = 0; i < t.length; i++)
      if (reg[i]) t[i] = Math.min(255, Math.max(0, Math.min(1, Math.max(0, (p.ps[i] - lo) / Math.max(hi - lo, 1))) * 255 + shift));
  }
  return t;
}

function styleA(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, ink = new Uint8Array(W * H);
  cut(ink, p, r.skin, densityToQ(look.skin, 22));
  cut(ink, p, r.hair, densityToQ(look.hair, 88));
  cut(ink, p, r.clothes, densityToQ(look.clothes, 55));
  const protect = new Uint8Array(W * H);
  for (let i = 0; i < protect.length; i++) protect[i] = fm.feats[i] | fm.sock[i];
  return finish(clean(ink, W, H, look.cleanup, protect), fm, r, look);
}

function styleB(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const ink = styleA(p, r, fm, look);
  cut(ink, p, r.skin, densityToQ(look.skin, 8), true); // skin stays open except its darkest shadows
  for (let i = 0; i < ink.length; i++) if (fm.jaw[i] && r.skin[i]) ink[i] = 1;
  return finish(ink, fm, r, look);
}

// 2×2 ordered patterns for the four tone levels: ink, 75 % ink, 50 % ink, paper.
const PATTERN = (lvl: number, x: number, y: number) =>
  lvl === 0 ? 1 : lvl === 3 ? 0 : lvl === 1 ? +!(x % 2 === 0 && y % 2 === 0) : +((x + y) % 2 === 1);

function styleC(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, t = normTone(p, r, look), lvl = new Uint8Array(W * H);
  for (let i = 0; i < lvl.length; i++) lvl[i] = r.bg[i] ? 3 : Math.round(t[i] / 255 * 3);
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
  return finish(ink, fm, r, look);
}

function styleD(p: Prepared, r: Regions, fm: FeatureMasks, look: Look) {
  const { W, H } = p, t = normTone(p, r, look), f = new Float32Array(W * H), ink = new Uint8Array(W * H);
  for (let i = 0; i < f.length; i++) f[i] = r.bg[i] ? 1 : t[i] / 255;
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
  return finish(ink, fm, r, look);
}

const RENDER = { A: styleA, B: styleB, C: styleC, D: styleD };

export function renderStyles(p: Prepared, styles: StyleId[], look: Look): StyleResult[] {
  const fm = featureMasks(p, look.features), r = regions(p, fm);
  return styles.map(style => {
    const t0 = performance.now(), ink = RENDER[style](p, r, fm, look), cells = new Uint8Array(ink.length);
    let n = 0;
    for (let i = 0; i < ink.length; i++) { cells[i] = ink[i] ? 0 : 1; n += ink[i]; }
    return { style, cells, ms: performance.now() - t0, ink: n / ink.length };
  });
}
