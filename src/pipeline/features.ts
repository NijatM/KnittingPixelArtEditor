// Feature layer drawn from face points straight onto the grid (exp.py feature_layer, exp2.py designed_eyes/socket_mask).
import { IRIS_CENTRES, JAW, LBROW, LEYE, LLID, MOUTH_LINE, NOSTRILS, OVAL, RBROW, REYE, RLID, bounds, pt, pts, type Pt } from './landmarks';
import { dilate, disk, line, polygon, polyline, type Mask } from './raster';
import type { Features, Prepared } from './types';

export interface FeatureMasks {
  sock: Mask;    // cleared to paper before features are drawn: eye sockets, clear lenses
  feats: Mask;   // drawn features, always ink and protected from cleanup
  jaw: Mask;
  faceAcc: Mask; // "accessories" cells on the face (glasses arms, frames): thresholded as skin, not clothes
}

// Eye corners: [outer, inner] per eye.
const CORNERS: [number, number][] = [[33, 133], [263, 362]];

/** Rounded rectangle around c, axes u (along the eye, towards the nose) and v (down). */
function lensOutline(c: Pt, u: Pt, v: Pt, a: number, b: number): Pt[] {
  const r = Math.min(a, b) * 0.55, out: Pt[] = [];
  const corners: [number, number, number][] = [[a - r, b - r, 0], [-(a - r), b - r, 90], [-(a - r), -(b - r), 180], [a - r, -(b - r), 270]];
  for (const [ox, oy, start] of corners)
    for (let k = 0; k <= 3; k++) {
      const t = (start + k * 30) * Math.PI / 180, lx = ox + r * Math.cos(t), ly = oy + r * Math.sin(t);
      out.push([c[0] + u[0] * lx + v[0] * ly, c[1] + u[1] * lx + v[1] * ly]);
    }
  return out;
}

/**
 * Glasses frames drawn from the eye corners (the segmenter only finds the dark top bar of clear frames, so it is
 * used for detection only). Lens interiors are cleared; frame cells touching a brow are dropped so the brow stays
 * readable at small grid sizes.
 */
function drawGlasses(lm: Float32Array, W: number, H: number, brow: Mask, sock: Mask, feats: Mask, clearLens: boolean) {
  const n = W * H, rim = new Uint8Array(n), fill = new Uint8Array(n), inner: Pt[] = [];
  for (const [o, i] of CORNERS) {
    const [ox, oy] = pt(lm, o), [ix, iy] = pt(lm, i), eyeW = Math.hypot(ix - ox, iy - oy) || 1;
    const u: Pt = [(ix - ox) / eyeW, (iy - oy) / eyeW];
    let v: Pt = [-u[1], u[0]]; if (v[1] < 0) v = [-v[0], -v[1]];
    const a = eyeW * 0.82, b = eyeW * 0.58;
    const c: Pt = [(ox + ix) / 2 + v[0] * b * 0.2, (oy + iy) / 2 + v[1] * b * 0.2];
    const ring = lensOutline(c, u, v, a, b);
    polygon(fill, W, H, ring);
    polyline(rim, W, H, ring, true);
    inner.push([c[0] + u[0] * a - v[0] * b * 0.3, c[1] + u[1] * a - v[1] * b * 0.3]);
  }
  line(rim, W, H, inner[0], inner[1]); // bridge
  const nearBrow = dilate(brow, W, H);
  for (let k = 0; k < n; k++) {
    if (clearLens && fill[k] && !rim[k]) sock[k] = 1;
    if (rim[k] && !nearBrow[k]) feats[k] = 1;
  }
}

export function featureMasks(p: Prepared, f: Features): FeatureMasks {
  const { W, H, lm } = p, n = W * H;
  const sock = new Uint8Array(n), feats = new Uint8Array(n), jaw = new Uint8Array(n), faceAcc = new Uint8Array(n);
  if (!lm) return { sock, feats, jaw, faceAcc };

  // Accessories inside the (slightly enlarged) face box belong to the face.
  const o = bounds(pts(lm, OVAL)), mx = (o.x1 - o.x0) * 0.15, my = (o.y1 - o.y0) * 0.1;
  for (let y = Math.max(0, Math.floor(o.y0 - my)); y <= Math.min(H - 1, Math.ceil(o.y1 + my)); y++)
    for (let x = Math.max(0, Math.floor(o.x0 - mx)); x <= Math.min(W - 1, Math.ceil(o.x1 + mx)); x++) faceAcc[y * W + x] = p.acc[y * W + x];

  const brow = new Uint8Array(n);
  polygon(brow, W, H, pts(lm, LBROW));
  polygon(brow, W, H, pts(lm, RBROW));

  if (f.eyes)
    for (const idx of [LEYE, REYE]) {
      const e = pts(lm, idx), cx = e.reduce((a, q) => a + q[0], 0) / e.length, cy = e.reduce((a, q) => a + q[1], 0) / e.length;
      polygon(sock, W, H, e.map(([x, y]): Pt => [cx + (x - cx) * 1.35, cy + (y - cy) * 1.35 * 1.6]));
    }
  if (f.glasses) drawGlasses(lm, W, H, f.brows ? brow : new Uint8Array(n), sock, feats, f.eyes);
  if (f.eyes) {
    polyline(feats, W, H, pts(lm, LLID));
    polyline(feats, W, H, pts(lm, RLID));
    for (const c of IRIS_CENTRES) {
      const [x, y] = pt(lm, c), [ax, ay] = pt(lm, c + 1), [bx, by] = pt(lm, c + 3);
      disk(feats, W, H, x, y, Math.max(Math.hypot(ax - bx, ay - by) / 2, 0.75));
    }
  }
  if (f.brows) for (let k = 0; k < n; k++) feats[k] |= brow[k];
  if (f.mouth) polyline(feats, W, H, pts(lm, MOUTH_LINE));
  if (f.nostrils)
    for (const [a, b] of NOSTRILS) {
      const x = Math.floor(lm[2 * a] * 0.6 + lm[2 * b] * 0.4), y = Math.floor(lm[2 * a + 1] * 0.6 + lm[2 * b + 1] * 0.4);
      if (x >= 0 && y >= 0 && x < W && y < H) feats[y * W + x] = 1;
    }
  if (f.jaw) polyline(jaw, W, H, pts(lm, JAW));
  return { sock, feats, jaw, faceAcc };
}
