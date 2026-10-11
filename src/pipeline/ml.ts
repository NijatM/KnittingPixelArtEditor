// Style E line map: Informative Drawings opensketch_style (Chan, Durand, Isola, CVPR 2022; MIT) via ONNX Runtime Web.
// Runs in its own worker. WebGPU when the browser has it, otherwise the smaller CPU (WASM) build.
import type * as Ort from 'onnxruntime-web';
import { resampleCrop, sampleSeg } from './prep';
import { SEG, type Crop, type Source } from './types';

const BASE = import.meta.env.BASE_URL;

interface Session { ort: typeof Ort; session: Ort.InferenceSession; backend: 'webgpu' | 'wasm' }
let loading: Promise<Session> | null = null;

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try { return !!(gpu && await gpu.requestAdapter()); } catch { return false; }
}

export function loadLineModel(progress: (t: string) => void): Promise<Session> {
  if (loading) return loading;
  loading = (async () => {
    const webgpu = await hasWebGPU();
    progress(`loading the line model (${webgpu ? 'WebGPU' : 'CPU'}) · first time only`);
    const ort: typeof Ort = webgpu ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    // The bundled builds carry their own JS glue; Vite ships the matching .wasm next to them (no wasmPaths).
    ort.env.wasm.numThreads = 1; // GitHub Pages isn't cross-origin isolated, so no shared-memory threads
    const model = await (await fetch(`${BASE}models/informative-drawings/opensketch_style.onnx`)).arrayBuffer();
    const session = await ort.InferenceSession.create(model, { executionProviders: webgpu ? ['webgpu', 'wasm'] : ['wasm'] });
    return { ort, session, backend: webgpu ? 'webgpu' as const : 'wasm' as const };
  })();
  loading.catch(() => { loading = null; }); // a failed load is retried on the next render
  return loading;
}

/** Model input width ≈ 7 × grid width (multiple of 32, 256–768): line weight then scales with the grid. */
export const modelWidth = (W: number) => Math.min(768, Math.max(256, Math.round(W * 7 / 32) * 32));

export interface LineMap { ink: Float32Array; w: number; h: number; ms: number; backend: string }

/** Ink coverage 0..1 at model resolution. The background is whitened unless it is kept ("photo" background). */
export async function lineMap(src: Source, crop: Crop, W: number, keepBg: boolean, progress: (t: string) => void): Promise<LineMap> {
  const { ort, session, backend } = await loadLineModel(progress);
  const t0 = performance.now();
  const w = modelWidth(W), h = Math.max(32, Math.round(w * crop.h / crop.w / 4) * 4), n = w * h;
  const { rgb, outside } = resampleCrop(src, crop, w, h);
  const seg = sampleSeg(src, crop, w, h, outside);
  const blank = (i: number) => outside[i] || (!keepBg && seg[i] === SEG.BG);
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) x[c * n + i] = blank(i) ? 1 : rgb[i * 3 + c] / 255;
  const out = await session.run({ image: new ort.Tensor('float32', x, [1, 3, h, w]) });
  const lines = (await out.lines.getData()) as Float32Array; // 1 = paper, 0 = ink
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) ink[i] = blank(i) ? 0 : 1 - lines[i];
  return { ink, w, h, ms: performance.now() - t0, backend };
}
