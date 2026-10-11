// Crop → work image (≈10× grid) → grey, bilateral, CLAHE → grid-resolution tone + regions.
// Mirrors research/prototype/exp.py prep() / exp2.py run2(), with cv2 behaviour reimplemented.
import { SEG, type Crop, type Prepared, type Source } from './types';

/** Work-image scale: 10× the grid like the prototype, fewer for big grids so a frame stays < ~1000 px wide. */
export const workScale = (W: number) => Math.max(4, Math.min(10, Math.floor(1000 / W)));

/** Area-weight table for one axis: output cell i covers [o + i*s, o + (i+1)*s) of source pixels 0..n-1. */
export function axisWeights(o: number, s: number, outN: number, n: number) {
  const start = new Int32Array(outN), len = new Int32Array(outN), inside = new Float32Array(outN), w: number[] = [];
  const offs = new Int32Array(outN);
  for (let i = 0; i < outN; i++) {
    const a = o + i * s, b = a + s;
    const p0 = Math.max(0, Math.floor(a)), p1 = Math.min(n - 1, Math.ceil(b) - 1);
    start[i] = p0; offs[i] = w.length;
    let tot = 0;
    for (let p = p0; p <= p1; p++) {
      const cw = Math.max(0, Math.min(b, p + 1) - Math.max(a, p));
      w.push(cw); tot += cw;
    }
    len[i] = Math.max(0, p1 - p0 + 1);
    inside[i] = tot / s;
  }
  return { start, len, offs, inside, w: Float32Array.from(w) };
}

/** Area-resize a single-channel image (any factor). */
export function areaResize(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const X = axisWeights(0, sw / dw, dw, sw), Y = axisWeights(0, sh / dh, dh, sh);
  const tmp = new Float32Array(sh * dw), out = new Float32Array(dw * dh);
  for (let y = 0; y < sh; y++)
    for (let i = 0; i < dw; i++) {
      let s = 0;
      for (let k = 0; k < X.len[i]; k++) s += src[y * sw + X.start[i] + k] * X.w[X.offs[i] + k];
      tmp[y * dw + i] = s / (sw / dw);
    }
  for (let j = 0; j < dh; j++)
    for (let i = 0; i < dw; i++) {
      let s = 0;
      for (let k = 0; k < Y.len[j]; k++) s += tmp[(Y.start[j] + k) * dw + i] * Y.w[Y.offs[j] + k];
      out[j * dw + i] = s / (sh / dh);
    }
  return out;
}

/** Area-resample the crop of the RGBA source to ww×wh RGB; cells mostly outside the photo are flagged. */
export function resampleCrop(src: Source, c: Crop, ww: number, wh: number) {
  const X = axisWeights(c.x, c.w / ww, ww, src.w), Y = axisWeights(c.y, c.h / wh, wh, src.h);
  const rgb = new Float32Array(ww * wh * 3), outside = new Uint8Array(ww * wh);
  // Horizontal pass on every source row the crop touches.
  const y0 = Math.max(0, Math.floor(c.y)), y1 = Math.min(src.h - 1, Math.ceil(c.y + c.h));
  const rows = Math.max(0, y1 - y0 + 1), tmp = new Float32Array(rows * ww * 3), d = src.rgba;
  for (let r = 0; r < rows; r++) {
    const sy = y0 + r;
    for (let i = 0; i < ww; i++) {
      let R = 0, G = 0, B = 0;
      for (let k = 0; k < X.len[i]; k++) {
        const wt = X.w[X.offs[i] + k], p = (sy * src.w + X.start[i] + k) * 4;
        R += d[p] * wt; G += d[p + 1] * wt; B += d[p + 2] * wt;
      }
      const t = (r * ww + i) * 3; tmp[t] = R; tmp[t + 1] = G; tmp[t + 2] = B;
    }
  }
  // Vertical pass, normalised by the covered area.
  for (let j = 0; j < wh; j++)
    for (let i = 0; i < ww; i++) {
      const o = j * ww + i, cover = X.inside[i] * Y.inside[j];
      if (cover < 0.5) { outside[o] = 1; rgb[o * 3] = rgb[o * 3 + 1] = rgb[o * 3 + 2] = 255; continue; }
      let R = 0, G = 0, B = 0, tw = 0;
      for (let k = 0; k < Y.len[j]; k++) {
        const r = Y.start[j] + k - y0; if (r < 0 || r >= rows) continue;
        const wt = Y.w[Y.offs[j] + k], t = (r * ww + i) * 3;
        R += tmp[t] * wt; G += tmp[t + 1] * wt; B += tmp[t + 2] * wt; tw += wt;
      }
      const norm = tw * (c.w / ww) * X.inside[i];
      rgb[o * 3] = R / norm; rgb[o * 3 + 1] = G / norm; rgb[o * 3 + 2] = B / norm;
    }
  return { rgb, outside };
}

/** Nearest sample of the source segmentation at each work pixel centre; outside the photo = background. */
export function sampleSeg(src: Source, c: Crop, ww: number, wh: number, outside: Uint8Array) {
  const out = new Uint8Array(ww * wh);
  if (!src.seg) { for (let i = 0; i < out.length; i++) out[i] = outside[i] ? SEG.BG : SEG.FACE; return out; }
  const sx = c.w / ww, sy = c.h / wh;
  for (let j = 0; j < wh; j++) {
    const y = Math.floor(c.y + (j + 0.5) * sy);
    for (let i = 0; i < ww; i++) {
      const x = Math.floor(c.x + (i + 0.5) * sx), o = j * ww + i;
      out[o] = outside[o] || x < 0 || y < 0 || x >= src.w || y >= src.h ? SEG.BG : src.seg[y * src.w + x];
    }
  }
  return out;
}

const reflect101 = (i: number, n: number) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);

/** cv2.bilateralFilter(g, d=9, sigmaColor=40, sigmaSpace=9): circular window, BORDER_REFLECT_101. */
export function bilateral(g: Uint8Array, w: number, h: number, d = 9, sc = 40, ss = 9): Uint8Array {
  const r = Math.floor(d / 2), offs: number[] = [], sw: number[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const rr = dx * dx + dy * dy; if (rr > r * r) continue;
      offs.push(dx, dy); sw.push(Math.exp(-rr / (2 * ss * ss)));
    }
  const cw = new Float32Array(256);
  for (let i = 0; i < 256; i++) cw[i] = Math.exp(-(i * i) / (2 * sc * sc));
  const out = new Uint8Array(w * h), n = sw.length;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v0 = g[y * w + x], inner = x >= r && y >= r && x < w - r && y < h - r;
      let s = 0, ws = 0;
      for (let k = 0; k < n; k++) {
        const xx = inner ? x + offs[2 * k] : reflect101(x + offs[2 * k], w);
        const yy = inner ? y + offs[2 * k + 1] : reflect101(y + offs[2 * k + 1], h);
        const v = g[yy * w + xx], wt = sw[k] * cw[Math.abs(v - v0)];
        s += v * wt; ws += wt;
      }
      out[y * w + x] = Math.round(s / ws);
    }
  return out;
}

/** cv2.createCLAHE(clipLimit=2, tileGridSize=8×8).apply(g). */
export function clahe(g: Uint8Array, w: number, h: number, clip = 2, tiles = 8): Uint8Array {
  // cv2 pads to a multiple of the grid (reflect-101) when the size doesn't divide it.
  const tW = (w + (w % tiles ? tiles - (w % tiles) : 0)) / tiles, tH = (h + (h % tiles ? tiles - (h % tiles) : 0)) / tiles;
  const area = tW * tH, limit = Math.max(Math.floor(clip * area / 256), 1), scale = 255 / area;
  const luts = new Uint8Array(tiles * tiles * 256), hist = new Int32Array(256);
  for (let ty = 0; ty < tiles; ty++)
    for (let tx = 0; tx < tiles; tx++) {
      hist.fill(0);
      for (let y = ty * tH; y < (ty + 1) * tH; y++)
        for (let x = tx * tW; x < (tx + 1) * tW; x++) hist[g[reflect101(y, h) * w + reflect101(x, w)]]++;
      let clipped = 0;
      for (let i = 0; i < 256; i++) if (hist[i] > limit) { clipped += hist[i] - limit; hist[i] = limit; }
      const batch = Math.floor(clipped / 256);
      let residual = clipped - batch * 256;
      for (let i = 0; i < 256; i++) hist[i] += batch;
      if (residual) {
        const step = Math.max(Math.floor(256 / residual), 1);
        for (let i = 0; i < 256 && residual > 0; i += step, residual--) hist[i]++;
      }
      let sum = 0;
      const base = (ty * tiles + tx) * 256;
      for (let i = 0; i < 256; i++) { sum += hist[i]; luts[base + i] = Math.min(255, Math.round(sum * scale)); }
    }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const tyf = y / tH - 0.5, ty1r = Math.floor(tyf), ya = tyf - ty1r;
    const ty1 = Math.max(ty1r, 0), ty2 = Math.min(ty1r + 1, tiles - 1);
    for (let x = 0; x < w; x++) {
      const txf = x / tW - 0.5, tx1r = Math.floor(txf), xa = txf - tx1r;
      const tx1 = Math.max(tx1r, 0), tx2 = Math.min(tx1r + 1, tiles - 1), v = g[y * w + x];
      const l = (a: number, b: number) => luts[(a * tiles + b) * 256 + v];
      const res = (l(ty1, tx1) * (1 - xa) + l(ty1, tx2) * xa) * (1 - ya) + (l(ty2, tx1) * (1 - xa) + l(ty2, tx2) * xa) * ya;
      out[y * w + x] = Math.round(res);
    }
  }
  return out;
}

const scaleLm = (lm: Float32Array, c: Crop, sx: number, sy: number) => {
  const o = new Float32Array(lm.length);
  for (let i = 0; i < lm.length; i += 2) { o[i] = (lm[i] - c.x) * sx; o[i + 1] = (lm[i + 1] - c.y) * sy; }
  return o;
};

export function prepare(src: Source, crop: Crop, W: number, H: number): Prepared {
  const t0 = performance.now(), f = workScale(W), ww = W * f, wh = H * f;
  const { rgb, outside } = resampleCrop(src, crop, ww, wh);
  const seg = sampleSeg(src, crop, ww, wh, outside);
  const gray = new Uint8Array(ww * wh);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
  const pg = clahe(bilateral(gray, ww, wh), ww, wh);

  // Grid resolution: tone = block mean (background whitened, and kept), region = block majority.
  const ps = new Float32Array(W * H), bgps = new Float32Array(W * H), segs = new Uint8Array(W * H), acc = new Uint8Array(W * H);
  const votes = new Int32Array(6);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0, sb = 0; votes.fill(0);
      for (let j = 0; j < f; j++)
        for (let i = 0; i < f; i++) {
          const o = (y * f + j) * ww + x * f + i;
          s += seg[o] === SEG.BG ? 255 : pg[o]; sb += pg[o]; votes[seg[o]]++;
        }
      ps[y * W + x] = s / (f * f);
      bgps[y * W + x] = sb / (f * f);
      let best = 0; for (let k = 1; k < 6; k++) if (votes[k] > votes[best]) best = k;
      segs[y * W + x] = best;
      acc[y * W + x] = +(votes[SEG.OTHER] >= 0.25 * f * f);
    }

  const lm = src.lm ? scaleLm(src.lm, crop, W / crop.w, H / crop.h) : null;
  return { W, H, ps, bgps, segs, acc, lm, ms: performance.now() - t0 };
}
