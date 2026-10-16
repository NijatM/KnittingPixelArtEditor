import type { CleanInfo, CleanLook } from './clean';
import type { Pt } from './landmarks';
import type { Stamps } from './stamps';

/** A measured glasses lens: centre, half width / height, and whether its top / bottom corners are rounded. */
export interface Lens { c: Pt; a: number; b: number; roundTop: boolean; roundBottom: boolean }

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
  ps: Float32Array;   // prepared tone 0..255 per cell, background whitened
  bgps: Float32Array; // same tone with the background kept (for the "photo" background)
  segs: Uint8Array;   // SEG category per cell
  acc: Uint8Array;    // 1 where ≥ 25 % of the cell is "others / accessories" (glasses frames, …)
  lines: Float32Array; // share of the cell on a dark strand line (hair "texture" mode)
  ridge: Float32Array; // mean brightness above the surroundings (narrow − wide blur) per cell: highlights between curls
  hairLum: number;    // median hair luminance 0..255 in the frame, -1 if there is no hair
  facialHair: number; // share of the lower face clearly darker than the cheeks (moustache / beard ≈ 0.6+)
  lm: Float32Array | null; // face points in grid coordinates
  /** Glasses lenses measured from the frames' regions (grid coordinates), when the rims show all round; else null. */
  lenses: Lens[] | null;
  /** The work image (f × f pixels per cell): plain and contrast-enhanced grey + regions, for styles that measure below a cell. */
  work: { f: number; w: number; h: number; gray: Uint8Array; tone: Uint8Array; seg: Uint8Array };
  ms: number;
}

/** Gallery order is set in main.ts; the letters shown there follow that order. */
export type StyleId = 'clean' | 'avatar' | 'poster' | 'line' | 'tone' | 'tonal' | 'ml';

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
  evenLight: number;  // 0..1: how much of a side light's left–right imbalance on the skin is removed
  hair: number;
  clothes: number;
  cleanup: number;
  lineWeight: number; // ML lines: 1 = tuned, higher = more cells become line
  hairMode: 'auto' | 'solid' | 'tone' | 'texture'; // auto = each style's own hair
  features: Features;
  stamps: Stamps;     // feature part per kind ('' = auto), for the styles drawn from the photo
  clean: CleanLook;   // clean avatar: custom or prebuilt, and the part picked per kind
  background: 'white' | 'black' | 'pattern' | 'photo';
  bgDensity: number; // pattern / photo background: share of ink, 0..1
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

export interface RenderResult {
  id: number; W: number; H: number; prepMs: number; hairLum: number; lenses: Lens[] | null; results: StyleResult[];
  clean: CleanInfo | null; // what the clean avatar picked and offers (when it was rendered)
}
