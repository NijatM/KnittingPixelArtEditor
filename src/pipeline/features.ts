// Feature layer drawn from face points straight onto the grid (exp.py feature_layer, exp2.py designed_eyes/socket_mask).
import { IRIS_CENTRES, JAW, LBROW, LEYE, LLID, MOUTH_LINE, NOSTRILS, RBROW, REYE, RLID, bounds, pt, pts, type Pt } from './landmarks';
import { boundary, disk, polygon, polyline, type Mask } from './raster';
import type { Features, Prepared } from './types';

export interface FeatureMasks {
  sock: Mask;  // eye sockets, cleared to paper before the eyes are redrawn
  feats: Mask; // drawn features, always ink and protected from cleanup
  jaw: Mask;
  lens: Mask;  // accessories around the eyes: treated as skin, outlined as frames
}

export function featureMasks(p: Prepared, f: Features): FeatureMasks {
  const { W, H, lm } = p, n = W * H, sock = new Uint8Array(n), feats = new Uint8Array(n), jaw = new Uint8Array(n), lens = new Uint8Array(n);
  if (!lm) return { sock, feats, jaw, lens };

  if (f.glasses) {
    // Frames = 1-cell outline of the accessories region inside a band around both eyes.
    const b = bounds(pts(lm, [...LEYE, ...REYE])), span = b.x1 - b.x0, cy = (b.y0 + b.y1) / 2;
    const x0 = Math.max(0, Math.floor(b.x0 - 0.2 * span)), x1 = Math.min(W - 1, Math.ceil(b.x1 + 0.2 * span));
    const y0 = Math.max(0, Math.floor(cy - 0.4 * span)), y1 = Math.min(H - 1, Math.ceil(cy + 0.35 * span));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lens[y * W + x] = p.acc[y * W + x];
    const rim = boundary(lens, lens.map(v => 1 - v), W, H);
    for (let i = 0; i < n; i++) feats[i] |= rim[i];
  }

  if (f.eyes) {
    for (const idx of [LEYE, REYE]) {
      const e = pts(lm, idx), cx = e.reduce((a, q) => a + q[0], 0) / e.length, cy = e.reduce((a, q) => a + q[1], 0) / e.length;
      polygon(sock, W, H, e.map(([x, y]): Pt => [cx + (x - cx) * 1.35, cy + (y - cy) * 1.35 * 1.6]));
    }
    polyline(feats, W, H, pts(lm, LLID));
    polyline(feats, W, H, pts(lm, RLID));
    for (const c of IRIS_CENTRES) {
      const [x, y] = pt(lm, c), [ax, ay] = pt(lm, c + 1), [bx, by] = pt(lm, c + 3);
      disk(feats, W, H, x, y, Math.max(Math.hypot(ax - bx, ay - by) / 2, 0.75));
    }
  }
  if (f.brows) { polygon(feats, W, H, pts(lm, LBROW)); polygon(feats, W, H, pts(lm, RBROW)); }
  if (f.mouth) polyline(feats, W, H, pts(lm, MOUTH_LINE));
  if (f.nostrils)
    for (const [a, b] of NOSTRILS) {
      const x = Math.floor(lm[2 * a] * 0.6 + lm[2 * b] * 0.4), y = Math.floor(lm[2 * a + 1] * 0.6 + lm[2 * b + 1] * 0.4);
      if (x >= 0 && y >= 0 && x < W && y < H) feats[y * W + x] = 1;
    }
  if (f.jaw) polyline(jaw, W, H, pts(lm, JAW));
  return { sock, feats, jaw, lens };
}
