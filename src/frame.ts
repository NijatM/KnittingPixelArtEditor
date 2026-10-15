// Auto-framing from the face oval and the head's outline (hair included), plus tight↔wide and drag offsets.
import { OVAL, bounds, pts } from './pipeline/landmarks';
import { SEG, type Crop } from './pipeline/types';

export interface FrameParams {
  framing: number; // 0 tight … 0.5 auto … 1 wide
  ox: number;      // offsets in half-frame units, set by dragging / the vertical slider
  oy: number;
}

export const AUTO_FRAME: FrameParams = { framing: 0.5, ox: 0, oy: 0 };

/** The head's extent in the photo: hair + face from the top of the hair to a bit below the chin. */
export interface Head { x0: number; x1: number; top: number }

export function headBox(seg: Uint8Array, w: number, h: number, lm: Float32Array): Head | null {
  const b = bounds(pts(lm, OVAL)), fw = b.x1 - b.x0, fh = b.y1 - b.y0;
  const xa = Math.max(0, Math.floor(b.x0 - 1.5 * fw)), xb = Math.min(w - 1, Math.ceil(b.x1 + 1.5 * fw));
  const head = (x: number, y: number) => { const v = seg[y * w + x]; return v === SEG.HAIR || v === SEG.FACE; };
  let top = -1;
  for (let y = 0; y < Math.min(h, b.y1) && top < 0; y++) {
    let n = 0;
    for (let x = xa; x <= xb; x++) n += +head(x, y);
    if (n > Math.max(3, fw * 0.05)) top = y;
  }
  if (top < 0) return null;
  const yb = Math.min(h - 1, Math.round(b.y1 + 0.3 * fh)), need = Math.max(3, (yb - top) * 0.03), cols: number[] = [];
  for (let x = xa; x <= xb; x++) {
    let n = 0;
    for (let y = top; y <= yb; y++) n += +head(x, y);
    if (n >= need) cols.push(x);
  }
  return cols.length ? { x0: cols[0], x1: cols[cols.length - 1] + 1, top } : null;
}

/**
 * aspect = frame height / width (physical, after cell aspect). Head and shoulders the way the team's portraits are
 * framed: at least 1.9 face widths across, wider when the hair is (the head box fills 90 % of the width), the top
 * of the hair 6 % below the frame's top edge. Without a head box: 0.45 face heights above the face oval.
 */
export function computeCrop(w: number, h: number, lm: Float32Array | null, aspect: number, f: FrameParams, head: Head | null = null): Crop {
  let zoom = 2 ** ((f.framing - 0.5) * 1.4);
  let cw: number, cx: number, top: number;
  if (lm) {
    const b = bounds(pts(lm, OVAL)), fw = b.x1 - b.x0, fh = b.y1 - b.y0;
    const base = Math.max(1.9 * fw, head ? (head.x1 - head.x0) / 0.9 : 0), headTop = head ? head.top : b.y0 - 0.45 * fh;
    cw = base * zoom; cx = (b.x0 + b.x1) / 2; top = headTop - 0.06 * cw * aspect;
    // If the frame would run past the bottom of the photo, tighten it (to at most 75 %) so the
    // shoulders reach the frame edge instead of ending above a blank band.
    if (top + cw * aspect > h) { // fit: top + cw·aspect = h with top = headTop − 0.06·cw·aspect
      cw = Math.max(cw * 0.75, (h - headTop) / (aspect * 0.94));
      top = headTop - 0.06 * cw * aspect;
    }
  } else {
    // No face: the largest centred frame of this shape.
    cw = Math.min(w, h / aspect) * zoom; cx = w / 2; top = (h - cw * aspect) / 2;
  }
  const ch = cw * aspect;
  return { x: cx - cw / 2 + f.ox * cw * 0.5, y: top + f.oy * ch * 0.5, w: cw, h: ch };
}
