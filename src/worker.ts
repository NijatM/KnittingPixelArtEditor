// Processing worker: holds the photo, caches the prepared frame, renders styles on request.
// Two instances run this file: one for the instant styles, one for the ML lines style, so a slow model
// run never holds up the sliders.
import { lineMap, type LineMap } from './pipeline/ml';
import { prepare } from './pipeline/prep';
import { renderStyles } from './pipeline/styles';
import type { StampKind } from './pipeline/stamps';
import type { Prepared, RenderRequest, RenderResult, Source } from './pipeline/types';

/** Option previews: the request's style once per stamp name for one feature (null = the feature off). */
export interface VariantsRequest { id: number; req: RenderRequest; kind: StampKind; names: (string | null)[] }
export type ToWorker = { type: 'source'; source: Source } | { type: 'render'; req: RenderRequest } | { type: 'variants'; v: VariantsRequest };
export type FromWorker =
  | { type: 'result'; res: RenderResult }
  | { type: 'variants'; id: number; W: number; H: number; cells: Uint8Array[] }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; text: string };

let src: Source | null = null;
let cache: { key: string; prep: Prepared } | null = null;
let lines: { key: string; map: LineMap } | null = null;

const reply = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });

/** The prepared frame (cached per crop + grid) and, for ML lines, the line map (cached per crop + width). */
async function inputs(req: RenderRequest) {
  if (!src) throw new Error('no photo loaded');
  const key = JSON.stringify([req.crop, req.W, req.H]);
  let prepMs = 0, modelMs = 0, map: LineMap | undefined;
  if (cache?.key !== key) { cache = { key, prep: prepare(src, req.crop, req.W, req.H) }; prepMs = cache.prep.ms; }
  if (req.styles.includes('ml')) {
    const keepBg = req.look.background === 'photo', lkey = JSON.stringify([req.crop, req.W, keepBg]);
    if (lines?.key !== lkey) {
      const m = await lineMap(src, req.crop, req.W, keepBg, text => reply({ type: 'progress', id: req.id, text }));
      lines = { key: lkey, map: m }; modelMs = m.ms;
    }
    map = lines.map;
  }
  return { prep: cache.prep, map, prepMs, modelMs };
}

async function render(req: RenderRequest) {
  const { prep, map, prepMs, modelMs } = await inputs(req);
  const results = renderStyles(prep, req.styles, req.look, map);
  for (const r of results) if (r.style === 'ml') r.ms += modelMs;
  reply({ type: 'result', res: { id: req.id, W: req.W, H: req.H, prepMs, hairLum: prep.hairLum, lenses: prep.lenses, results } }, results.map(r => r.cells.buffer));
}

async function variants({ id, req, kind, names }: VariantsRequest) {
  const { prep, map } = await inputs(req), key = ({ eyes: 'eyes', brows: 'brows', mouth: 'mouth', nose: 'nostrils', glasses: 'glasses' } as const)[kind];
  const cells = names.map(name => {
    const look = { ...req.look, features: { ...req.look.features, [key]: name !== null }, stamps: { ...req.look.stamps, [kind]: name ?? '' } };
    return renderStyles(prep, req.styles, look, map)[0].cells;
  });
  reply({ type: 'variants', id, W: req.W, H: req.H, cells }, cells.map(c => c.buffer));
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data, fail = (id: number) => (err: unknown) => reply({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  if (m.type === 'source') { src = m.source; cache = null; lines = null; return; }
  if (m.type === 'variants') { variants(m.v).catch(fail(-m.v.id)); return; }
  render(m.req).catch(fail(m.req.id));
};
