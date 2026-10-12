// "Even light": remove the left–right imbalance a side light puts on the skin, keep everything symmetric.
// Side light makes one half of the face darker than the other; beards, chin shadow and cheek modelling are
// roughly mirror-symmetric. So: measure skin tone in bands across the face (perpendicular to the face's
// midline, medians so eyes and mouth don't count), take only the antisymmetric part, subtract it.
import { OVAL, bounds, pt, pts } from './landmarks';
import type { Mask } from './raster';

const BAND = 0.2;   // band width in half-face widths
const BANDS = 6;    // per side: |u| from 0 to 1.2, outer cells use the last band

function median(v: number[]) {
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Skin tone with the side-light imbalance removed (strength 0 = as photographed, 1 = fully balanced). */
export function evenLight(ps: Float32Array, skin: Mask, lm: Float32Array | null, W: number, H: number, strength: number): Float32Array {
  if (!lm || strength <= 0) return ps;
  const top = pt(lm, 10), chin = pt(lm, 152), o = bounds(pts(lm, OVAL));
  const len = Math.hypot(chin[0] - top[0], chin[1] - top[1]) || 1, half = (o.x1 - o.x0) / 2 || 1;
  const nx = -(chin[1] - top[1]) / len, ny = (chin[0] - top[0]) / len; // unit normal to the midline
  const u = new Float32Array(W * H), bins: number[][][] = [[], []].map(() => Array.from({ length: BANDS }, () => []));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!skin[i]) continue;
      u[i] = ((x + 0.5 - top[0]) * nx + (y + 0.5 - top[1]) * ny) / half;
      bins[u[i] < 0 ? 0 : 1][Math.min(BANDS - 1, Math.floor(Math.abs(u[i]) / BAND))].push(ps[i]);
    }
  // Antisymmetric part per band: half the difference between the two sides; bands with too few cells inherit.
  const A = new Float32Array(BANDS);
  for (let k = 0; k < BANDS; k++) {
    const a = bins[1][k].length >= 3 ? median(bins[1][k]) : NaN, b = bins[0][k].length >= 3 ? median(bins[0][k]) : NaN;
    A[k] = Number.isNaN(a) || Number.isNaN(b) ? (k ? A[k - 1] : 0) : (a - b) / 2;
  }
  const out = ps.slice();
  for (let i = 0; i < out.length; i++) {
    if (!skin[i]) continue;
    // Interpolate between band centres. A side light's shadow starts sharply at the nose ridge, so the
    // correction steps at the midline (fading it to 0 there leaves a dark seam beside the nose).
    const f = Math.abs(u[i]) / BAND - 0.5, k = Math.max(0, Math.min(BANDS - 1, Math.floor(f))), t = Math.max(0, Math.min(1, f - k));
    const a = f < 0 ? A[0] : A[k] + (A[Math.min(BANDS - 1, k + 1)] - A[k]) * t;
    out[i] = Math.min(255, Math.max(0, ps[i] - strength * Math.sign(u[i]) * a));
  }
  return out;
}
