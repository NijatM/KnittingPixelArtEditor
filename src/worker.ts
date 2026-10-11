// Processing worker: holds the photo, caches the prepared frame, renders styles on request.
import { prepare } from './pipeline/prep';
import { renderStyles } from './pipeline/styles';
import type { Prepared, RenderRequest, RenderResult, Source } from './pipeline/types';

export type ToWorker = { type: 'source'; source: Source } | { type: 'render'; req: RenderRequest };
export type FromWorker = { type: 'result'; res: RenderResult } | { type: 'error'; id: number; message: string };

let src: Source | null = null;
let cache: { key: string; prep: Prepared } | null = null;

const reply = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'source') { src = m.source; cache = null; return; }
  const { req } = m;
  try {
    if (!src) throw new Error('no photo loaded');
    const key = JSON.stringify([req.crop, req.W, req.H]);
    let prepMs = 0;
    if (cache?.key !== key) { cache = { key, prep: prepare(src, req.crop, req.W, req.H) }; prepMs = cache.prep.ms; }
    const results = renderStyles(cache.prep, req.styles, req.look);
    reply({ type: 'result', res: { id: req.id, W: req.W, H: req.H, prepMs, results } }, results.map(r => r.cells.buffer));
  } catch (err) {
    reply({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
