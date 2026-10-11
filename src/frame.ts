// Auto-framing from the face oval (research/prototype/exp.py frame()), plus tight↔wide and drag offsets.
import { OVAL, bounds, pts } from './pipeline/landmarks';
import type { Crop } from './pipeline/types';

export interface FrameParams {
  framing: number; // 0 tight … 0.5 auto … 1 wide
  ox: number;      // offsets in half-frame units, set by dragging / the vertical slider
  oy: number;
}

export const AUTO_FRAME: FrameParams = { framing: 0.5, ox: 0, oy: 0 };

/** aspect = frame height / width (physical, after cell aspect). */
export function computeCrop(w: number, h: number, lm: Float32Array | null, aspect: number, f: FrameParams): Crop {
  let zoom = 2 ** ((f.framing - 0.5) * 1.4);
  let cw: number, cx: number, top: number;
  if (lm) {
    // Head and shoulders: 2.3 face widths across, 0.55 face heights of headroom above the face oval.
    const b = bounds(pts(lm, OVAL)), fw = b.x1 - b.x0, fh = b.y1 - b.y0;
    // If the frame would run past the bottom of the photo, tighten it (to at most 75 %) so the
    // shoulders reach the frame edge instead of ending above a blank band.
    const grow = fw * 2.3 * aspect - fh * 0.55, fitZoom = (h - b.y0) / grow;
    if (grow > 0 && fitZoom > 0 && fitZoom < zoom) zoom = Math.max(zoom * 0.75, fitZoom);
    cw = fw * 2.3 * zoom; cx = (b.x0 + b.x1) / 2; top = b.y0 - fh * 0.55 * zoom;
  } else {
    // No face: the largest centred frame of this shape.
    cw = Math.min(w, h / aspect) * zoom; cx = w / 2; top = (h - cw * aspect) / 2;
  }
  const ch = cw * aspect;
  return { x: cx - cw / 2 + f.ox * cw * 0.5, y: top + f.oy * ch * 0.5, w: cw, h: ch };
}
