import { LEYE, REYE, bounds, pts } from './landmarks';
import { SEG } from './types';

/** Share of MediaPipe's "others / accessories" class in a box around both eyes (0..1). Research: glasses 8–30 %, none 0 %. */
export function glassesShare(seg: Uint8Array, w: number, h: number, lm: Float32Array): number {
  const b = bounds(pts(lm, [...LEYE, ...REYE])), span = b.x1 - b.x0, cy = (b.y0 + b.y1) / 2;
  const x0 = Math.max(0, Math.floor(b.x0 - 0.08 * span)), x1 = Math.min(w - 1, Math.ceil(b.x1 + 0.08 * span));
  const y0 = Math.max(0, Math.floor(cy - 0.22 * span)), y1 = Math.min(h - 1, Math.ceil(cy + 0.22 * span));
  let n = 0, acc = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { n++; if (seg[y * w + x] === SEG.OTHER) acc++; }
  return n ? acc / n : 0;
}

export const GLASSES_MIN_SHARE = 0.03;
