// Processing worker: holds the photo, caches the prepared frame, renders styles on request.
// Two instances run this file: one for the instant styles A–D, one for the ML style E, so a slow model
// run never holds up the sliders.
import { lineMap, type LineMap } from './pipeline/ml';
import { prepare } from './pipeline/prep';
import { renderStyles } from './pipeline/styles';
import type { Prepared, RenderRequest, RenderResult, Source } from './pipeline/types';

export type ToWorker = { type: 'source'; source: Source } | { type: 'render'; req: RenderRequest };
export type FromWorker =
  | { type: 'result'; res: RenderResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; text: string };

let src: Source | null = null;
let cache: { key: string; prep: Prepared } | null = null;
let lines: { key: string; map: LineMap } | null = null;

const reply = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });

async function render(req: RenderRequest) {
  if (!src) throw new Error('no photo loaded');
  const key = JSON.stringify([req.crop, req.W, req.H]);
  let prepMs = 0;
  if (cache?.key !== key) { cache = { key, prep: prepare(src, req.crop, req.W, req.H) }; prepMs = cache.prep.ms; }
  let map: LineMap | undefined, modelMs = 0;
  if (req.styles.includes('E')) {
    const keepBg = req.look.background === 'photo', lkey = JSON.stringify([req.crop, req.W, keepBg]);
    if (lines?.key !== lkey) {
      const m = await lineMap(src, req.crop, req.W, keepBg, text => reply({ type: 'progress', id: req.id, text }));
      lines = { key: lkey, map: m }; modelMs = m.ms;
    }
    map = lines.map;
  }
  const results = renderStyles(cache.prep, req.styles, req.look, map);
  for (const r of results) if (r.style === 'E') r.ms += modelMs;
  reply({ type: 'result', res: { id: req.id, W: req.W, H: req.H, prepMs, results } }, results.map(r => r.cells.buffer));
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'source') { src = m.source; cache = null; lines = null; return; }
  render(m.req).catch(err => reply({ type: 'error', id: m.req.id, message: err instanceof Error ? err.message : String(err) }));
};
