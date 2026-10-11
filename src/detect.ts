// MediaPipe face points + hair/skin/clothes regions, once per photo, on the main thread (tasks-vision loads
// its WASM with a script tag). Models and runtime are self-hosted under public/ — nothing leaves the device.
import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
// CPU (XNNPACK), not GPU: on an M2 Pro the GPU delegate spent ~14 s compiling shaders on the first photo,
// CPU answers in ~0.4 s from the first photo on, and behaves the same on every device.
const DELEGATE = 'CPU';

interface Detectors { landmarker: FaceLandmarker; segmenter: ImageSegmenter }
let loading: Promise<Detectors> | null = null;

export function loadDetectors(): Promise<Detectors> {
  return (loading ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const [landmarker, segmenter] = await Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/mediapipe/face_landmarker.task`, delegate: DELEGATE },
        runningMode: 'IMAGE', numFaces: 1,
      }),
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/mediapipe/selfie_multiclass_256x256.tflite`, delegate: DELEGATE },
        runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
      }),
    ]);
    return { landmarker, segmenter };
  })());
}

export interface Detection { lm: Float32Array | null; seg: Uint8Array | null; ms: number }

export async function detect(img: HTMLCanvasElement): Promise<Detection> {
  const { landmarker, segmenter } = await loadDetectors();
  const t0 = performance.now(), w = img.width, h = img.height; // timed after loading: detection only

  let lm: Float32Array | null = null;
  const face = landmarker.detect(img).faceLandmarks[0];
  if (face?.length) {
    lm = new Float32Array(face.length * 2);
    face.forEach((p, i) => { lm![2 * i] = p.x * w; lm![2 * i + 1] = p.y * h; });
  }

  let seg: Uint8Array | null = null;
  const r = segmenter.segment(img);
  const mask = r.categoryMask;
  if (mask) {
    const data = mask.getAsUint8Array();
    seg = mask.width === w && mask.height === h ? data.slice() : resizeNearest(data, mask.width, mask.height, w, h);
  }
  r.close();
  return { lm, seg, ms: performance.now() - t0 };
}

function resizeNearest(d: Uint8Array, sw: number, sh: number, w: number, h: number) {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / h));
    for (let x = 0; x < w; x++) o[y * w + x] = d[sy * sw + Math.min(sw - 1, Math.floor((x + 0.5) * sw / w))];
  }
  return o;
}
