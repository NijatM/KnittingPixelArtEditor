/** MediaPipe selfie_multiclass categories. */
export const SEG = { BG: 0, HAIR: 1, BODY: 2, FACE: 3, CLOTHES: 4, OTHER: 5 } as const;

/** The imported photo, downscaled to ≤1600 px, with what MediaPipe found in it. */
export interface Source {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  seg: Uint8Array | null;   // w*h categories, null if segmentation failed
  lm: Float32Array | null;  // 478 face points as [x, y, …] in source pixels, null if no face
}

/** Crop rectangle in source pixels; may extend past the photo (that part counts as background). */
export interface Crop { x: number; y: number; w: number; h: number }

/** Tone and regions at grid resolution, shared by every style. */
export interface Prepared {
  W: number;
  H: number;
  ps: Float32Array;   // prepared tone 0..255 per cell
  segs: Uint8Array;   // SEG category per cell
  acc: Uint8Array;    // 1 where ≥ 25 % of the cell is "others / accessories" (glasses frames, …)
  lm: Float32Array | null; // face points in grid coordinates
  ms: number;
}

export type StyleId = 'A' | 'B' | 'C' | 'D';

export interface Features {
  eyes: boolean;
  brows: boolean;
  mouth: boolean;
  nostrils: boolean;
  jaw: boolean;
  silhouette: boolean;
  glasses: boolean; // outline the accessories region around the eyes as frames
}

/** Look settings shared by all styles. Densities are 0..1; 0.5 is each style's tuned default. */
export interface Look {
  skin: number;
  hair: number;
  clothes: number;
  cleanup: number;
  features: Features;
  background: 'white' | 'black';
}

export interface RenderRequest {
  id: number;
  crop: Crop;
  W: number;
  H: number;
  styles: StyleId[];
  look: Look;
}

/** cells: palette index per cell (0 = ink, 1 = paper). */
export interface StyleResult { style: StyleId; cells: Uint8Array; ms: number; ink: number }

export interface RenderResult { id: number; W: number; H: number; prepMs: number; results: StyleResult[] }
