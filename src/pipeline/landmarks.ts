// MediaPipe Face Landmarker indices (478 points; 468–477 are the irises). Same sets as research/prototype/exp.py.
export const LEYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
export const REYE = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
export const LLID = [33, 246, 161, 160, 159, 158, 157, 173, 133];
export const RLID = [263, 466, 388, 387, 386, 385, 384, 398, 362];
export const LBROW = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
export const RBROW = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];
export const MOUTH_LINE = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
export const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const JAW = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234];
export const NOSTRILS: [number, number][] = [[98, 2], [327, 2]];
export const IRIS_CENTRES = [468, 473];

export type Pt = [number, number];

/** Landmarks are stored flat: [x0, y0, x1, y1, …]. */
export const pt = (lm: Float32Array, i: number): Pt => [lm[2 * i], lm[2 * i + 1]];
export const pts = (lm: Float32Array, idx: number[]): Pt[] => idx.map(i => pt(lm, i));

export function bounds(p: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
