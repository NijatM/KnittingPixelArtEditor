import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import { detect, loadDetectors } from './detect';
import { AUTO_FRAME, computeCrop, type FrameParams } from './frame';
import { decodeImage, wireImport } from './importer';
import { GLASSES_MIN_SHARE, glassesShare } from './pipeline/glasses';
import { OVAL, pts } from './pipeline/landmarks';
import { SEG, type Crop, type Features, type Look, type RenderResult, type StyleId, type StyleResult } from './pipeline/types';
import { $, $$, Bar, check, seg, setCheck, setSeg } from './ui/controls';
import type { FromWorker, ToWorker } from './worker';

// ---------------------------------------------------------------- constants
const STYLES: { k: StyleId; key: string; t: string; d: string }[] = [
  { k: 'A', key: 'poster', t: 'Region poster', d: 'bold shapes, each region cut separately' },
  { k: 'B', key: 'line', t: 'Line portrait', d: 'open skin, drawn contours' },
  { k: 'C', key: '4-tone', t: 'Tone patterns', d: 'paper · 50 · 75 · ink' },
  { k: 'D', key: 'tonal', t: 'Atkinson tonal', d: 'dithered shading, features kept' },
];
const LATER = [
  { k: 'E', t: 'ML lines', d: 'Informative Drawings (MIT)', ph: 'not built yet', tag: 'next' },
  { k: 'F', t: 'U²-Net portrait', d: 'non-commercial model', ph: '176 MB · not loaded', tag: 'v2' },
];
const RATIOS: Record<string, [number, number]> = { '1:1': [1, 1], '4:5': [4, 5], '3:4': [3, 4], '2:3': [2, 3] };
const DEFAULT_PAL = ['#0b0b0b', '#f4f4f4'];
const DEFAULT_FEATURES: Features = { eyes: true, brows: true, mouth: true, nostrils: true, jaw: true, silhouette: true, glasses: false };
const REGION_NAMES: [number, string][] = [[SEG.HAIR, 'hair'], [SEG.FACE, 'skin'], [SEG.CLOTHES, 'clothes'], [SEG.OTHER, 'accessories']];

type Step = 'photo' | 'frame' | 'grid' | 'style' | 'regions' | 'features' | 'background' | 'draw' | 'stamps' | 'colours' | 'export';
type View = 'empty' | 'styles' | 'pixels' | 'frame';

interface Photo {
  name: string;
  canvas: HTMLCanvasElement;
  lm: Float32Array | null;
  regions: string[];
  glasses: number; // share of accessories in the eye box, -1 if unknown
  ms: number;
}

// ---------------------------------------------------------------- state
const S = {
  photo: null as Photo | null,
  frame: { ...AUTO_FRAME } as FrameParams,
  ratio: '4:5',
  W: 64,
  H: 80,
  lock: true,
  cellAspect: 1,
  look: { skin: 0.5, hair: 0.5, clothes: 0.5, cleanup: 2, background: 'white', features: { ...DEFAULT_FEATURES } } as Look,
  style: 'B' as StyleId,
  pal: [...DEFAULT_PAL],
  step: 'photo' as Step,
  pixelsOverStyles: false, // the toolbar toggle can show pixels while on the style step
  out: null as null | { W: number; H: number; prepMs: number; byStyle: Map<StyleId, StyleResult> },
  zoom: 0,
  grid: false,
};

const aspect = () => S.H / (S.W * S.cellAspect); // physical frame height / width
const crop = (): Crop | null => S.photo && computeCrop(S.photo.canvas.width, S.photo.canvas.height, S.photo.lm, aspect(), S.frame);
const styleInfo = (k: StyleId) => STYLES.find(s => s.k === k)!;

// ---------------------------------------------------------------- worker (latest request wins)
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const post = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
let busy = false, queued = false, reqId = 0, raf = 0, detectorsReady = false;

function scheduleRender() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}
function render() {
  const c = crop();
  if (!c) return;
  if (busy) { queued = true; return; }
  busy = true;
  post({ type: 'render', req: { id: ++reqId, crop: c, W: S.W, H: S.H, styles: STYLES.map(s => s.k), look: structuredClone(S.look) } });
}
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  busy = false;
  const m = e.data;
  if (m.type === 'error') log(`> render failed: ${m.message}`);
  else applyResult(m.res);
  if (queued) { queued = false; render(); }
};
worker.onerror = e => { busy = false; log(`> worker error: ${e.message}`); };

function applyResult(res: RenderResult) {
  S.out = { W: res.W, H: res.H, prepMs: res.prepMs || S.out?.prepMs || 0, byStyle: new Map(res.results.map(r => [r.style, r])) };
  paintGallery();
  refresh();
}

// ---------------------------------------------------------------- photo
async function loadPhoto(file: File) {
  const name = file.name || 'pasted image';
  log(`> reading ${name}`);
  let canvas: HTMLCanvasElement;
  try { canvas = await decodeImage(file); }
  catch { log('> could not read this image · try a JPG or PNG'); return; }

  log(detectorsReady ? '> finding the face…' : '> loading the face models (first photo only)…');
  let det: Awaited<ReturnType<typeof detect>>;
  try { det = await detect(canvas); }
  catch (err) { det = { lm: null, seg: null, ms: 0 }; log(`> face models failed to load (${err instanceof Error ? err.message : err}) · using the photo as is`); }

  const { width: w, height: h } = canvas;
  const rgba = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const glasses = det.lm && det.seg ? glassesShare(det.seg, w, h, det.lm) : -1;
  const regions: string[] = [];
  if (det.seg) {
    const n = new Int32Array(6);
    for (const v of det.seg) n[v]++;
    n[SEG.FACE] += n[SEG.BODY];
    for (const [k, label] of REGION_NAMES) if (n[k] > w * h * 0.003) regions.push(label);
  }
  S.photo = { name, canvas, lm: det.lm, regions, glasses, ms: det.ms };
  S.frame = { ...AUTO_FRAME };
  S.look.features = { ...S.look.features, glasses: glasses >= GLASSES_MIN_SHARE };
  S.out = null;
  post({ type: 'source', source: { w, h, rgba, seg: det.seg, lm: det.lm } }, [rgba.buffer, ...(det.seg ? [det.seg.buffer] : [])]);

  ($('#exportname') as HTMLInputElement).value = exportBase();
  drawThumb();
  syncControls();
  paintGallery();
  setStep('style');
  log(det.lm
    ? `> face found in ${Math.round(det.ms)} ms${glasses >= GLASSES_MIN_SHARE ? ' · glasses found, drawn as frames' : ''}`
    : '> no face found · framing the whole photo, features off');
  render();
}

function drawThumb() {
  const t = $('#thumb') as HTMLCanvasElement, p = S.photo;
  if (!p) { t.hidden = true; return; }
  const s = 160 / Math.max(p.canvas.width, p.canvas.height);
  t.width = Math.round(p.canvas.width * s); t.height = Math.round(p.canvas.height * s);
  t.getContext('2d')!.drawImage(p.canvas, 0, 0, t.width, t.height);
  t.hidden = false;
}

const exportBase = () => `${(S.photo?.name ?? 'portrait').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')}_${S.W}x${S.H}`;

// ---------------------------------------------------------------- painting
const hexRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function paintCells(canvas: HTMLCanvasElement, cells: Uint8Array, W: number, H: number) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!, img = ctx.createImageData(W, H), p = S.pal.map(hexRgb);
  for (let i = 0; i < W * H; i++) { const c = p[cells[i]]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}

const overlaid = () => getComputedStyle($('#toolbar')).position === 'absolute'; // false on phones
function stageBox() {
  const v = $('#view').getBoundingClientRect(), o = overlaid();
  const top = (o ? $('#toolbar').offsetHeight : 0) + 24, bot = (o ? $('#statusbar').offsetHeight : 0) + 24;
  return { w: v.width - 48, h: v.height - top - bot, shift: o ? $('#toolbar').offsetHeight - $('#statusbar').offsetHeight : 0 };
}

function drawEditor() {
  const cv = $('#cv') as HTMLCanvasElement, r = S.out?.byStyle.get(S.style);
  if (!S.out || !r) { cv.width = cv.height = 0; return; }
  const { W, H } = S.out, a = S.cellAspect, box = stageBox();
  const fit = Math.max(1, Math.floor(Math.min(box.w / (W * a), box.h / H)));
  const ch = Math.max(1, fit + S.zoom * 2), cw = Math.max(1, Math.round(ch * a));
  const off = document.createElement('canvas');
  paintCells(off, r.cells, W, H);
  cv.width = W * cw; cv.height = H * ch;
  cv.style.marginTop = `${box.shift}px`;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, W * cw, H * ch);
  if (S.grid && ch >= 5) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line2').trim();
    for (let x = 0; x <= W; x++) { ctx.globalAlpha = x % 10 ? 0.35 : 0.9; ctx.fillRect(x * cw, 0, 1, H * ch); }
    for (let y = 0; y <= H; y++) { ctx.globalAlpha = y % 10 ? 0.35 : 0.9; ctx.fillRect(0, y * ch, W * cw, 1); }
    ctx.globalAlpha = 1;
  }
  $('#zoomval').textContent = S.zoom ? (S.zoom > 0 ? '+' : '') + S.zoom : 'fit';
}

// Frame view: the photo, the frame on top, everything outside it dimmed.
let frameMap = { s: 1, ox: 0, oy: 0 }; // source px → canvas px
function drawFrame() {
  const cv = $('#fcv') as HTMLCanvasElement, p = S.photo, c = crop();
  if (!p || !c) return;
  const box = stageBox(), dpr = window.devicePixelRatio || 1;
  const x0 = Math.min(0, c.x), y0 = Math.min(0, c.y), x1 = Math.max(p.canvas.width, c.x + c.w), y1 = Math.max(p.canvas.height, c.y + c.h);
  const s = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  const cw = Math.round((x1 - x0) * s), ch = Math.round((y1 - y0) * s);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv.style.width = `${cw}px`; cv.style.height = `${ch}px`; cv.style.marginTop = `${box.shift}px`;
  frameMap = { s, ox: -x0 * s, oy: -y0 * s };
  const ctx = cv.getContext('2d')!, css = getComputedStyle(document.documentElement), X = (v: number) => v * s - x0 * s, Y = (v: number) => v * s - y0 * s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(p.canvas, X(0), Y(0), p.canvas.width * s, p.canvas.height * s);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.rect(X(c.x), Y(c.y), c.w * s, c.h * s); ctx.fill('evenodd');
  ctx.setLineDash([4, 4]); ctx.strokeStyle = css.getPropertyValue('--line2').trim(); ctx.lineWidth = 1;
  ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, p.canvas.width * s - 1, p.canvas.height * s - 1);
  ctx.setLineDash([]);
  if (p.lm) {
    ctx.strokeStyle = css.getPropertyValue('--ok').trim(); ctx.globalAlpha = 0.7;
    ctx.beginPath(); pts(p.lm, OVAL).forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = css.getPropertyValue('--hi').trim();
  ctx.strokeRect(Math.round(X(c.x)) + 0.5, Math.round(Y(c.y)) + 0.5, Math.round(c.w * s), Math.round(c.h * s));
}

// ---------------------------------------------------------------- gallery + style list
function buildGallery() {
  const g = $('#ggrid'); g.innerHTML = '';
  for (const s of STYLES) {
    const t = document.createElement('button');
    t.className = 'tile'; t.dataset.style = s.k;
    t.innerHTML = `<span class="n"><span>style ${s.k}</span><span data-ms></span></span><div class="ph wait">rendering…</div><canvas hidden></canvas><span class="t">${s.t}</span><span class="d">${s.d}</span>`;
    t.onclick = () => pickStyle(s.k, true);
    g.appendChild(t);
  }
  for (const s of LATER) {
    const d = document.createElement('div');
    d.className = 'tile is-draft';
    d.innerHTML = `<span class="n"><span>style ${s.k}</span><span>${s.tag}</span></span><div class="ph">${s.ph}</div><span class="t">${s.t}</span><span class="d">${s.d}</span>`;
    g.appendChild(d);
  }
  const l = $('#stylelist'); l.innerHTML = '';
  for (const s of STYLES) {
    const r = document.createElement('div');
    r.className = 'lrow'; r.dataset.style = s.k; r.tabIndex = 0;
    r.innerHTML = `<span class="lnum">${s.k}</span><span class="left">${s.t}</span><span class="right" data-ms></span>`;
    r.onclick = () => pickStyle(s.k, false);
    l.appendChild(r);
  }
  for (const s of LATER) {
    const r = document.createElement('div');
    r.className = 'lrow faint';
    r.innerHTML = `<span class="lnum">${s.k}</span><span class="left">${s.t}</span><span class="right">${s.tag}</span>`;
    l.appendChild(r);
  }
}

function paintGallery() {
  const o = S.out;
  for (const t of $$('#ggrid .tile[data-style]')) {
    const k = t.dataset.style as StyleId, r = o?.byStyle.get(k), cv = $('canvas', t) as HTMLCanvasElement, ph = $('.ph', t);
    t.classList.toggle('sel', k === S.style);
    ph.hidden = !!r; cv.hidden = !r;
    $('[data-ms]', t).textContent = r ? `${Math.max(1, Math.round(r.ms))} ms` : '';
    if (r && o) { paintCells(cv, r.cells, o.W, o.H); cv.style.aspectRatio = `${o.W * S.cellAspect} / ${o.H}`; }
    ph.style.aspectRatio = `${S.W * S.cellAspect} / ${S.H}`;
    ph.textContent = S.photo ? 'rendering…' : 'no photo yet';
  }
  for (const r of $$('#stylelist .lrow[data-style]')) {
    const k = r.dataset.style as StyleId, res = o?.byStyle.get(k);
    r.classList.toggle('sel', k === S.style);
    $('[data-ms]', r).textContent = res ? `${Math.max(1, Math.round(res.ms))} ms` : '';
  }
}

function pickStyle(k: StyleId, openPixels: boolean) {
  S.style = k;
  log(`> style ${k} · ${styleInfo(k).t.toLowerCase()}`);
  if (openPixels) { S.pixelsOverStyles = true; }
  paintGallery(); refresh();
}

// ---------------------------------------------------------------- steps, views, chrome
function currentView(): View {
  if (!S.photo) return 'empty';
  if (S.step === 'frame') return 'frame';
  if (S.step === 'style') return S.pixelsOverStyles ? 'pixels' : 'styles';
  return 'pixels';
}

function setStep(step: Step) {
  S.step = step;
  S.pixelsOverStyles = false;
  $$('#nav .lrow').forEach(r => r.classList.toggle('sel', r.dataset.step === step));
  $$('.panel').forEach(p => p.classList.toggle('on', p.dataset.panel === step));
  refresh();
}

function log(t: string) {
  $('#log').textContent = t;
}

function refresh() {
  const view = currentView();
  $('#stage').dataset.view = view;
  setSeg($('#viewseg'), b => b.dataset.view === (view === 'styles' ? 'styles' : 'pixels'));
  if (view === 'pixels') drawEditor();
  if (view === 'frame') drawFrame();

  // nav values
  const bind = (k: string, v: string) => $$(`[data-bind=${k}]`).forEach(e => (e.textContent = v));
  const moved = S.frame.ox || S.frame.oy;
  bind('photo', S.photo ? S.photo.name : '—');
  bind('frame', `${moved ? 'moved' : S.frame.framing === 0.5 ? 'auto' : S.frame.framing < 0.5 ? 'tight' : 'wide'} · ${S.ratio}`);
  bind('gridsize', `${S.W}×${S.H}`);
  bind('cells', `${(S.W * S.H).toLocaleString('en')} cells`);
  bind('stylename', styleInfo(S.style).key);
  bind('regions', `skin ${S.look.skin.toFixed(2).replace(/^0/, '')}`);
  const g = S.photo?.glasses ?? -1;
  bind('glasses', g < 0 ? '—' : g >= GLASSES_MIN_SHARE ? `detected · ${Math.round(g * 100)}% of eye area` : `not detected · ${Math.round(g * 100)}% of eye area`);
  const f = S.look.features, found = g >= GLASSES_MIN_SHARE;
  bind('features', Object.entries(f).every(([k, v]) => (k === 'glasses' ? v === found : v)) ? 'auto' : 'custom');
  bind('background', S.look.background);
  $('#glasses-note').textContent = g < 0 ? '' : found ? '· found' : '· none found';
  $$('#nav .lrow').forEach(r => r.classList.toggle('faint', !S.photo && r.dataset.step !== 'photo'));

  // swatches
  $$('[data-sw]').forEach(e => (e.style.background = S.pal[+e.dataset.sw!]));
  $$<HTMLInputElement>('[data-pal]').forEach(e => (e.value = S.pal[+e.dataset.pal!]));
  $$<HTMLInputElement>('[data-hex]').forEach(e => { if (document.activeElement !== e) e.value = S.pal[+e.dataset.hex!]; });

  // status
  const r = S.out?.byStyle.get(S.style);
  $('#status').textContent = r && S.out
    ? `base · ${styleInfo(S.style).t.toLowerCase()} · ${S.out.W}×${S.out.H} · ${(S.out.W * S.out.H).toLocaleString('en')} cells · ${Math.round(r.ink * 100)}% ink · 0 edits · ${Math.round(r.ms + S.out.prepMs)} ms`
    : `${S.photo ? 'rendering' : 'no photo'} · ${S.W}×${S.H} · ${(S.W * S.H).toLocaleString('en')} cells`;
}

// ---------------------------------------------------------------- controls
const fmt2 = (v: number) => v.toFixed(2);
const bars = {
  framing: new Bar($('#bar-framing'), { min: 0, max: 1, value: 0.5, fmt: v => (v < 0.34 ? 'tight' : v > 0.66 ? 'wide' : 'medium'), onInput: v => { S.frame.framing = v; frameChanged(); } }),
  vertical: new Bar($('#bar-vertical'), { min: -1, max: 1, value: 0, fmt: fmt2, onInput: v => { S.frame.oy = v; frameChanged(); } }),
  w: new Bar($('#bar-w'), { min: 16, max: 250, value: 64, step: 1, fmt: v => `${v} st`, onInput: v => setGrid(v, null) }),
  h: new Bar($('#bar-h'), { min: 16, max: 300, value: 80, step: 1, fmt: v => `${v} st`, onInput: v => setGrid(null, v) }),
  cell: new Bar($('#bar-cell'), { min: 0.5, max: 1.5, value: 1, step: 0.01, fmt: fmt2, onInput: v => { S.cellAspect = v; setGrid(S.W, null); } }),
  cleanup: new Bar($('#bar-cleanup'), { min: 0, max: 4, value: 2, step: 1, fmt: v => String(v), onInput: v => { S.look.cleanup = v; lookChanged(); } }),
  skin: new Bar($('#bar-skin'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.skin = v; lookChanged(); } }),
  hair: new Bar($('#bar-hair'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.hair = v; lookChanged(); } }),
  clothes: new Bar($('#bar-clothes'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.clothes = v; lookChanged(); } }),
};

function frameChanged() { refresh(); scheduleRender(); }
function lookChanged() { refresh(); scheduleRender(); }

/** Change width and/or height; with the lock on, the other side follows the frame ratio. */
function setGrid(W: number | null, H: number | null) {
  const r = RATIOS[S.ratio], locked = S.lock && r;
  if (W != null) { S.W = W; if (locked) S.H = Math.max(16, Math.min(300, Math.round(W * S.cellAspect * r[1] / r[0]))); }
  if (H != null) { S.H = H; if (locked) S.W = Math.max(16, Math.min(250, Math.round(H * r[0] / (r[1] * S.cellAspect)))); }
  ($('#exportname') as HTMLInputElement).value = exportBase();
  syncControls(); refresh(); scheduleRender();
}

function syncControls() {
  bars.framing.set(S.frame.framing); bars.vertical.set(S.frame.oy);
  bars.w.set(S.W); bars.h.set(S.H); bars.cell.set(S.cellAspect); bars.cleanup.set(S.look.cleanup);
  bars.skin.set(S.look.skin); bars.hair.set(S.look.hair); bars.clothes.set(S.look.clothes);
  setSeg($('#ratioseg'), b => b.dataset.ratio === S.ratio);
  setSeg($('#sizeseg'), b => +b.textContent! === S.W);
  setSeg($('#bgseg'), b => b.dataset.bg === S.look.background);
  setCheck($('#lockcheck'), S.lock && S.ratio !== 'free');
  ($('#lockcheck') as HTMLButtonElement).disabled = S.ratio === 'free';
  $$('[data-feature]').forEach(b => setCheck(b, S.look.features[b.dataset.feature as keyof Features]));
  setCheck($('#gridcheck'), S.grid);
  setSeg($('#theme'), b => b.dataset.themeSet === (document.documentElement.dataset.theme ?? 'dark'));
  const p = S.photo;
  $('#det-face').textContent = !p ? '—' : p.lm ? `found · ${p.lm.length / 2} points` : 'not found';
  $('#det-face').className = `val ${p?.lm ? 'ok' : p ? 'dim' : ''}`;
  $('#det-regions').textContent = p ? (p.regions.join(' · ') || 'none') : '—';
  $('#det-glasses').textContent = !p || p.glasses < 0 ? '—' : p.glasses >= GLASSES_MIN_SHARE ? `yes · ${Math.round(p.glasses * 100)}% of eye area` : 'none';
  $('#det-time').textContent = p ? `> detected in ${Math.round(p.ms)} ms` : '';
}

seg($('#ratioseg'), b => { S.ratio = b.dataset.ratio!; if (S.ratio !== 'free') setGrid(S.W, null); else { syncControls(); refresh(); } });
seg($('#sizeseg'), b => setGrid(+b.textContent!, null));
seg($('#bgseg'), b => { S.look.background = b.dataset.bg as Look['background']; lookChanged(); });
check($('#lockcheck'), on => { S.lock = on; if (on) setGrid(S.W, null); });
$$('[data-feature]').forEach(b => check(b, on => { S.look.features[b.dataset.feature as keyof Features] = on; syncControls(); lookChanged(); }));
check($('#gridcheck'), on => { S.grid = on; refresh(); });
$('#frame-reset').onclick = () => { S.frame = { ...AUTO_FRAME }; syncControls(); frameChanged(); };

$$('#nav .lrow').forEach(r => {
  r.onclick = () => setStep(r.dataset.step as Step);
  r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(r.dataset.step as Step); } };
});
$$<HTMLButtonElement>('#viewseg button').forEach(b => (b.onclick = () => {
  if (b.dataset.view === 'styles') { if (S.step !== 'style') setStep('style'); else { S.pixelsOverStyles = false; refresh(); } }
  else if (S.step === 'style') { S.pixelsOverStyles = true; refresh(); }
  else if (S.step === 'frame') setStep('grid');
}));
$$<HTMLButtonElement>('[data-zoom]').forEach(b => (b.onclick = () => { S.zoom = Math.max(-3, Math.min(8, S.zoom + +b.dataset.zoom!)); refresh(); }));
$$<HTMLButtonElement>('#theme button').forEach(b => (b.onclick = () => {
  document.documentElement.dataset.theme = b.dataset.themeSet;
  try { localStorage.setItem('kpae.theme', b.dataset.themeSet!); } catch { /* private mode */ }
  syncControls(); refresh();
}));
$('#helpbtn').onclick = () => { const on = document.body.classList.toggle('help'); $('#helpbtn').classList.toggle('on', on); $('#helpbtn').setAttribute('aria-pressed', String(on)); };

// colours
const setPal = (i: number, v: string) => { S.pal[i] = v; paintGallery(); refresh(); };
$$<HTMLInputElement>('[data-pal]').forEach(i => (i.oninput = () => setPal(+i.dataset.pal!, i.value)));
$$<HTMLInputElement>('[data-hex]').forEach(i => (i.onchange = () => { const v = i.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) setPal(+i.dataset.hex!, v.toLowerCase()); else refresh(); }));
$('#swap').onclick = () => { S.pal.reverse(); paintGallery(); refresh(); };
$('#resetpal').onclick = () => { S.pal = [...DEFAULT_PAL]; paintGallery(); refresh(); };

// export (PNG now; BMP and SVG come with the export step)
$('#exportbtn').onclick = () => {
  const r = S.out?.byStyle.get(S.style);
  if (!r || !S.out) { log('> nothing to export yet · load a portrait first'); return; }
  const c = document.createElement('canvas');
  paintCells(c, r.cells, S.out.W, S.out.H);
  const name = (($('#exportname') as HTMLInputElement).value.trim() || exportBase()).replace(/\.png$/i, '') + '.png';
  c.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`> exported ${name} · ${S.out!.W}×${S.out!.H} px, 1 px per stitch`);
  }, 'image/png');
};

// frame view: drag to move, wheel to resize
{
  const cv = $('#fcv') as HTMLCanvasElement;
  let drag: { x: number; y: number; ox: number; oy: number; c: Crop } | null = null;
  cv.addEventListener('pointerdown', e => {
    const c = crop(); if (!c) return;
    cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
    drag = { x: e.clientX, y: e.clientY, ox: S.frame.ox, oy: S.frame.oy, c };
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    S.frame.ox = drag.ox + (e.clientX - drag.x) / frameMap.s / (drag.c.w * 0.5);
    S.frame.oy = Math.max(-1, Math.min(1, drag.oy + (e.clientY - drag.y) / frameMap.s / (drag.c.h * 0.5)));
    bars.vertical.set(S.frame.oy); frameChanged();
  });
  const end = () => { drag = null; cv.classList.remove('dragging'); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    S.frame.framing = Math.max(0, Math.min(1, S.frame.framing + Math.sign(e.deltaY) * 0.03));
    bars.framing.set(S.frame.framing); frameChanged();
  }, { passive: false });
}

// ---------------------------------------------------------------- boot
const fileInput = $('#file') as HTMLInputElement;
$$('[data-choose]').forEach(b => (b.onclick = () => fileInput.click()));
wireImport(fileInput, f => void loadPhoto(f), over => document.body.classList.toggle('dragover', over));
window.addEventListener('resize', () => refresh());
setInterval(() => ($('#clock').textContent = new Date().toTimeString().slice(0, 8)), 1000);

buildGallery();
syncControls();
setStep('photo');
paintGallery();
// Warm the face models while the page is idle, so the first photo is quick.
(window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(() => { loadDetectors().then(() => (detectorsReady = true), () => {}); });
