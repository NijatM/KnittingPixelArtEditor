// Feature layer: the stamps (stamps.ts) drawn from the face points, plus the jaw line and accessories on the face.
import { JAW, OVAL, bounds, pts } from './landmarks';
import { polyline, type Mask } from './raster';
import { drawStamps, type StampKind } from './stamps';
import type { Look, Prepared } from './types';

export interface FeatureMasks {
  sock: Mask;    // cleared to paper before features are drawn: eye sockets, clear lenses, open mouths
  feats: Mask;   // drawn features, always ink and protected from cleanup
  jaw: Mask;
  faceAcc: Mask; // "accessories" cells on the face (glasses arms, frames): thresholded as skin, not clothes
}

/** Facial hair cue above this counts as moustache / beard (test photos: bearded ≈ 0.67, others ≤ 0.41). */
export const FACIAL_HAIR_MIN = 0.5;

/** modelFace: ML lines, whose model already draws mouth, nose and jaw — they are stamped only when picked by hand. */
export function featureMasks(p: Prepared, look: Look, opts: { modelFace?: boolean } = {}): FeatureMasks {
  const { W, H, lm } = p, n = W * H, F = look.features;
  const jaw = new Uint8Array(n), faceAcc = new Uint8Array(n);
  if (!lm) return { sock: new Uint8Array(n), feats: new Uint8Array(n), jaw, faceAcc };

  // Accessories inside the (slightly enlarged) face box belong to the face.
  const o = bounds(pts(lm, OVAL)), mx = (o.x1 - o.x0) * 0.15, my = (o.y1 - o.y0) * 0.1;
  for (let y = Math.max(0, Math.floor(o.y0 - my)); y <= Math.min(H - 1, Math.ceil(o.y1 + my)); y++)
    for (let x = Math.max(0, Math.floor(o.x0 - mx)); x <= Math.min(W - 1, Math.ceil(o.x1 + mx)); x++) faceAcc[y * W + x] = p.acc[y * W + x];

  const enabled: Record<StampKind, boolean> = { eyes: F.eyes, brows: F.brows, mouth: F.mouth, nose: F.nostrils, glasses: F.glasses };
  const facialHair = p.facialHair >= FACIAL_HAIR_MIN;
  // E leaves mouth and nose to the model — except the mouth in a moustache / beard, where the model's lines
  // and the hair merge into one blob.
  if (opts.modelFace) { enabled.mouth &&= look.stamps.mouth > 0 || facialHair; enabled.nose &&= look.stamps.nose > 0; }
  const s = drawStamps({ lm, W, H }, enabled, look.stamps, facialHair);
  if (F.jaw && !opts.modelFace) polyline(jaw, W, H, pts(lm, JAW));
  return { sock: s.clear, feats: s.ink, jaw, faceAcc };
}
