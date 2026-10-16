// Processing worker: holds the photo, caches the prepared frame, renders styles on request.
// Two instances run this file: one for the instant styles, one for the ML lines style, so a slow model
// run never holds up the sliders. The clean avatar needs no photo (it is put together from the team's art; the
// photo only picks the parts), so it also renders before one is loaded.
import { cleanAvatar, cleanSize, loadLibrary, photoMatch, type CleanInfo, type Match } from './pipeline/clean';
import { lineMap, type LineMap } from './pipeline/ml';
import { prepare } from './pipeline/prep';
import { renderStyles } from './pipeline/styles';
import type { Look, Prepared, RenderRequest, RenderResult, Source, StyleId, StyleResult } from './pipeline/types';

/** Option previews: the request's (first) style once per look. */
export interface VariantsRequest { id: number; req: RenderRequest; looks: Look[] }
export type ToWorker = { type: 'source'; source: Source | null } | { type: 'render'; req: RenderRequest } | { type: 'variants'; v: VariantsRequest };
export type FromWorker =
  | { type: 'result'; res: RenderResult }
  | { type: 'variants'; id: number; W: number; H: number; cells: Uint8Array[] }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; text: string };

let src: Source | null = null;
let cache: { key: string; prep: Prepared } | null = null;
let lines: { key: string; map: LineMap } | null = null;
let match: { prep: Prepared; glasses: boolean; m: Match } | null = null;

const reply = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });
const fetchJson = (path: string) => fetch(new URL(path, new URL(import.meta.env.BASE_URL, location.origin))).then(r => {
  if (!r.ok) throw new Error(`could not load ${path}`);
  return r.json();
});

/** The prepared frame (cached per crop + grid) and, for ML lines, the line map (cached per crop + width). */
async function inputs(req: RenderRequest) {
  if (!src) return { prep: null, prepMs: 0, modelMs: 0 };
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

/** The clean avatar for a look (the photo's measures are kept per prepared frame). */
async function clean(req: RenderRequest, look: Look, prep: Prepared | null): Promise<{ r: StyleResult; info: CleanInfo }> {
  const t0 = performance.now(), lib = await loadLibrary(cleanSize(req.W, req.H), fetchJson), glasses = look.features.glasses;
  if (prep && (match?.prep !== prep || match.glasses !== glasses)) match = { prep, glasses, m: photoMatch(prep, glasses) };
  const { ink, info } = cleanAvatar(lib, look.clean, prep ? match!.m : null, req.W, req.H);
  let n = 0;
  const cells = ink.map(v => { n += v; return 1 - v; });
  return { r: { style: 'clean', cells, ms: performance.now() - t0, ink: n / ink.length }, info };
}

async function renderAll(req: RenderRequest, look: Look) {
  const { prep, map, prepMs, modelMs } = await inputs(req);
  const others = prep ? req.styles.filter((s): s is Exclude<StyleId, 'clean'> => s !== 'clean') : [];
  const results = prep ? renderStyles(prep, others, look, map) : [];
  for (const r of results) if (r.style === 'ml') r.ms += modelMs;
  let info: CleanInfo | null = null;
  if (req.styles.includes('clean')) { const c = await clean(req, look, prep); results.unshift(c.r); info = c.info; }
  return { prep, prepMs, results, info };
}

async function render(req: RenderRequest) {
  const { prep, prepMs, results, info } = await renderAll(req, req.look);
  reply({ type: 'result', res: { id: req.id, W: req.W, H: req.H, prepMs, hairLum: prep?.hairLum ?? -1, lenses: prep?.lenses ?? null, results, clean: info } },
    results.map(r => r.cells.buffer));
}

async function variants({ id, req, looks }: VariantsRequest) {
  const cells: Uint8Array[] = [];
  for (const look of looks) cells.push((await renderAll(req, look)).results[0].cells);
  reply({ type: 'variants', id, W: req.W, H: req.H, cells }, cells.map(c => c.buffer));
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data, fail = (id: number) => (err: unknown) => reply({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  if (m.type === 'source') { src = m.source; cache = null; lines = null; match = null; return; }
  if (m.type === 'variants') { variants(m.v).catch(fail(-m.v.id)); return; }
  render(m.req).catch(fail(m.req.id));
};
