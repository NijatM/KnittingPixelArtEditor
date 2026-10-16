import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import { detect, loadDetectors } from './detect';
import { Editor, type Behind, type Tool } from './editor';
import { download, encodeBmp, encodePng, encodeSvg, depthFits, smallestDepth, type BmpDepth } from './export';
import * as store from './store';
import { AUTO_FRAME, computeCrop, headBox, type FrameParams, type Head } from './frame';
import { decodeImage, loadImage, photoCanvas, wireImport } from './importer';
import { pixelArtOf, type PixelArt } from './pixelart';
import { GLASSES_MIN_SHARE, glassesShare } from './pipeline/glasses';
import { OVAL, pts } from './pipeline/landmarks';
import { avatarAuto } from './pipeline/avatar';
import { AUTO_CLEAN, CLEAN_PARTS, CLEAN_SIZES, cleanSize, type CleanInfo, type CleanPart } from './pipeline/clean';
import { AUTO_STAMPS, STAMPS, STAMP_KINDS, autoVariant, hitBoxes, stampName, type Face, type StampKind } from './pipeline/stamps';
import { SEG, type Crop, type Features, type Lens, type Look, type RenderResult, type StyleId, type StyleResult } from './pipeline/types';
import { $, $$, Bar, check, seg, setCheck, setSeg } from './ui/controls';
import type { FromWorker, ToWorker } from './worker';

// ---------------------------------------------------------------- constants
// Gallery order; the letter shown for a style is its place in this list.
const STYLES: { k: StyleId; key: string; t: string; d: string }[] = [
  { k: 'clean', key: 'clean', t: 'Clean avatar', d: 'the team\'s characters · parts closest to you' },
  { k: 'avatar', key: 'image-driven', t: 'Image-driven avatar', d: 'traced from the photo · drawn features' },
  { k: 'poster', key: 'poster', t: 'Region poster', d: 'bold shapes, each region cut separately' },
  { k: 'line', key: 'line', t: 'Line portrait', d: 'open skin, drawn contours' },
  { k: 'tone', key: '4-tone', t: 'Tone patterns', d: 'paper · 50 · 75 · ink' },
  { k: 'tonal', key: 'tonal', t: 'Atkinson tonal', d: 'dithered shading, features kept' },
  { k: 'ml', key: 'ml lines', t: 'ML lines', d: 'Informative Drawings (MIT) · drawn by a model' },
];
const INSTANT: StyleId[] = ['clean', 'avatar', 'poster', 'line', 'tone', 'tonal'];
const LATER = [
  { t: 'U²-Net portrait', d: 'non-commercial model', ph: '176 MB · not loaded', tag: 'v2' },
];
const letter = (i: number) => String.fromCharCode(65 + i);
/** Saved projects from before the avatar style named styles by their old letters ('avatar' is now the image-driven avatar). */
const OLD_IDS: Record<string, StyleId> = { A: 'poster', B: 'line', C: 'tone', D: 'tonal', E: 'ml' };
const RATIOS: Record<string, [number, number]> = { '1:1': [1, 1], '4:5': [4, 5], '3:4': [3, 4], '2:3': [2, 3] };
// Binary black and white: what the editor shows is what the files hold (1-bit PNG / BMP of pure #000 and #fff).
const DEFAULT_PAL = ['#000000', '#ffffff'];
/** The earlier screen-tinted default; projects saved with it move to pure black and white. */
const OLD_PAL = ['#0b0b0b', '#f4f4f4'];
const DEFAULT_FEATURES: Features = { eyes: true, brows: true, mouth: true, nostrils: true, jaw: true, silhouette: true, glasses: false };
const REGION_NAMES: [number, string][] = [[SEG.HAIR, 'hair'], [SEG.FACE, 'skin'], [SEG.CLOTHES, 'clothes'], [SEG.OTHER, 'accessories']];

// ?debug keeps a copy of the photo + detection on window.__kpaeDebug for offline tuning (research/private_tests).
const DEBUG = new URLSearchParams(location.search).has('debug');

type Step = 'photo' | 'frame' | 'grid' | 'style' | 'regions' | 'features' | 'background' | 'draw' | 'stamps' | 'colours' | 'export';
type View = 'empty' | 'styles' | 'pixels' | 'frame';

interface Photo {
  // pixels: an imported pixel image, edited as it is (no detection, no styles); blank: no photo, the clean avatar only
  kind: 'photo' | 'pixels' | 'blank';
  id: number;      // ties autosaved settings to this photo
  name: string;
  canvas: HTMLCanvasElement;
  lm: Float32Array | null;
  head: Head | null; // hair + face extent, for the auto frame
  regions: string[];
  glasses: number; // share of accessories in the eye box, -1 if unknown
  ms: number;
}

// ---------------------------------------------------------------- state
const S = {
  photo: null as Photo | null,
  frame: { ...AUTO_FRAME } as FrameParams,
  ratio: '1:1',
  W: 50,
  H: 50,
  lock: true,
  cellAspect: 1,
  look: { skin: 0.5, evenLight: 0.8, hair: 0.5, clothes: 0.5, cleanup: 2, lineWeight: 1, hairMode: 'auto', background: 'white', bgDensity: 0.25, features: { ...DEFAULT_FEATURES }, stamps: { ...AUTO_STAMPS }, clean: structuredClone(AUTO_CLEAN) } as Look,
  style: 'clean' as StyleId,
  pal: [...DEFAULT_PAL],
  step: 'photo' as Step,
  pixelsOverStyles: false, // the toolbar toggle can show pixels while on the style step
  res: new Map<StyleId, Rendered>(), // latest result per style, each with its own grid size
  prepMs: 0,
  hairLum: -1,                         // measured hair lightness of the current frame (from the worker)
  lenses: null as Lens[] | null,       // glasses lenses measured in the current frame (from the worker)
  clean: null as CleanInfo | null,     // what the clean avatar picked and offers (from the worker)
  mlNote: '',                          // what ML lines is doing while it has no result yet
  zoom: 0,
  grid: false,
  ed: new Editor(),
  fmt: 'png' as 'png' | 'bmp' | 'svg',
  depth: 1 as BmpDepth,
};

const aspect = () => S.H / (S.W * S.cellAspect); // physical frame height / width
const crop = (): Crop | null => S.photo && computeCrop(S.photo.canvas.width, S.photo.canvas.height, S.photo.lm, aspect(), S.frame, S.photo.head);
const styleInfo = (k: StyleId) => STYLES.find(s => s.k === k)!;

/** The selected style's result when it matches the edit grid (results can lag a grid change briefly). */
function editable() {
  const r = S.res.get(S.style);
  return r && r.W === S.ed.W && r.H === S.ed.H ? r : null;
}
/** The editor's final composite (edits, lifted pixels, over the frozen or live base): exactly what export writes. */
function final(): { cells: Uint8Array; W: number; H: number } | null {
  const r = editable();
  if (r) return { cells: S.ed.composite(r.cells), W: r.W, H: r.H };
  return S.ed.baked ? { cells: S.ed.composite(S.ed.baked), W: S.ed.W, H: S.ed.H } : null;
}
/** What the grid shows: the final composite, or the style alone for the moment it lags a grid change. */
function shown(): { cells: Uint8Array; W: number; H: number } | null {
  const f = final();
  if (f) return f;
  const any = S.res.get(S.style);
  return any ? { cells: any.cells, W: any.W, H: any.H } : null;
}
/** Face points in grid coordinates for the current frame (stamps' auto choice, hit boxes). */
function gridFace(): Face | null {
  const c = crop(), lm = S.photo?.lm;
  if (!c || !lm) return null;
  const g = new Float32Array(lm.length), sx = S.W / c.w, sy = S.H / c.h;
  for (let i = 0; i < lm.length; i += 2) { g[i] = (lm[i] - c.x) * sx; g[i + 1] = (lm[i + 1] - c.y) * sy; }
  const lenses = S.lenses && S.res.get(S.style)?.W === S.W ? S.lenses : null;
  return { lm: g, W: S.W, H: S.H, lenses };
}
const FEATURE_OF: Record<StampKind, keyof Features> = { eyes: 'eyes', brows: 'brows', mouth: 'mouth', nose: 'nostrils', glasses: 'glasses' };

/** The shape "auto" draws: the avatar picks its own, the other styles one per face and size ('' = none). */
const autoName = (kind: StampKind, face: Face) =>
  (S.style === 'avatar' ? avatarAuto(kind, face, S.look.features.glasses) : autoVariant(kind, face)) || 'none';

/** Where a feature stands in its stepper: 0 auto, 1..n a variant, n + 1 off (the switch in 05 Features). */
function stampPos(kind: StampKind) {
  const n = STAMPS[kind].length;
  return !S.look.features[FEATURE_OF[kind]] ? n + 1 : S.look.stamps[kind] ? STAMPS[kind].findIndex(v => v.name === S.look.stamps[kind]) + 1 : 0;
}

/** Set a feature to auto (''), a variant by name, or off (null). */
function setStamp(kind: StampKind, name: string | null) {
  S.look.features[FEATURE_OF[kind]] = name !== null;
  if (name !== null) S.look.stamps[kind] = name;
  const face = gridFace();
  log(`> ${kind} · ${name === null ? 'off' : name || `auto · ${face ? autoName(kind, face) : '—'}`}`);
  syncControls(); lookChanged();
}

// ---------------------------------------------------------------- part options (08 Parts)
// The photo styles' parts (eyes, brows, mouth, nose, glasses, drawn from the face points) and the clean avatar's
// (hair … facial hair, from the team's characters) share one options box, opened under a row.
let openKind: StampKind | null = null, openPart: CleanPart | null = null, previewTimer = 0;
/** auto, every offered variant, off (null). */
const optionNames = (kind: StampKind): (string | null)[] => ['', ...STAMPS[kind].map(v => v.name), null];
/** Clean avatar: auto, then every option for this head (character nicknames, 'none'). */
const partNames = (kind: CleanPart): string[] => ['', ...(S.clean?.options[kind] ?? [])];
const isClean = () => S.style === 'clean';

/** The part of the grid an option preview shows: eyes, brows and glasses together; the mouth with its surroundings. */
function optionCrop(kind: StampKind, f: Face) {
  const b = hitBoxes(f), r = kind === 'mouth' ? [b.mouth.x0 - 3, b.nose.y0, b.mouth.x1 + 3, b.mouth.y1 + 4]
    : kind === 'nose' ? [b.nose.x0 - 4, b.nose.y0 - 3, b.nose.x1 + 4, b.mouth.y1 + 1]
    : [b.glasses.x0 - 1, b.brows.y0 - 2, b.glasses.x1 + 1, b.glasses.y1 + 1];
  return clampBox(r);
}
const clampBox = (r: number[]) => {
  const x0 = Math.max(0, Math.floor(r[0])), y0 = Math.max(0, Math.floor(r[1]));
  return { x0, y0, x1: Math.min(S.W, Math.ceil(r[2])), y1: Math.min(S.H, Math.ceil(r[3])) };
};

/** Clean avatar: where each part sits on the grid (from the head's anchors), for tapping and the previews. */
function cleanBoxes(info: CleanInfo) {
  const a = info.at, d = a.d, ey = (a.eyes[0][1] + a.eyes[1][1]) / 2, [l, r] = [a.eyes[0][0], a.eyes[1][0]];
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  return {
    brows: box(l - 0.55 * d, ey - 0.85 * d, r + 0.55 * d + 1, ey - 0.3 * d),
    eyes: box(l - 0.4 * d, ey - 0.3 * d, r + 0.4 * d + 1, ey + 0.3 * d + 1),
    glasses: box(l - 0.75 * d, ey - 0.45 * d, r + 0.75 * d + 1, ey + 0.5 * d + 1),
    nose: box(a.nose[0] - 0.3 * d, ey + 0.3 * d, a.nose[0] + 0.3 * d + 1, a.nose[1] + 0.25 * d + 1),
    mouth: box(a.mouth[0] - 0.55 * d, a.mouth[1] - 0.25 * d, a.mouth[0] + 0.55 * d + 1, a.mouth[1] + 0.3 * d + 1),
    facial: box(a.mouth[0] - 0.95 * d, a.mouth[1] - 0.55 * d, a.mouth[0] + 0.95 * d + 1, a.mouth[1] + 1.3 * d),
    face: box(l - 0.95 * d, ey - 1.0 * d, r + 0.95 * d + 1, a.mouth[1] + 0.75 * d),
  };
}

/** Which clean avatar part a tap on cell (x, y) means: the smallest box it falls in, else the hair around them. */
function cleanPartAt(x: number, y: number): CleanPart | null {
  const info = S.clean;
  if (!info) return null;
  const b = cleanBoxes(info), cx = x + 0.5, cy = y + 0.5, inside = (k: keyof typeof b) => cx >= b[k].x0 && cx <= b[k].x1 && cy >= b[k].y0 && cy <= b[k].y1;
  const hit = (['brows', 'eyes', 'nose', 'mouth', 'glasses', 'facial'] as const).find(inside);
  if (hit) return hit;
  return x >= info.x0 && y >= info.y0 && x < info.x0 + info.size && y < info.y0 + info.size ? 'hair' : null;
}

/** Highlight the option in use. */
function markOptions() {
  const box = $('#stampopts');
  $$('[data-stamp]').forEach(r => { const on = r.dataset.stamp === openKind; r.classList.toggle('open', on); $('[data-opts]', r).setAttribute('aria-expanded', String(on)); });
  $$('[data-part]').forEach(r => { const on = r.dataset.part === openPart; r.classList.toggle('open', on); $('[data-opts]', r).setAttribute('aria-expanded', String(on)); });
  if (box.hidden) return;
  if (box.dataset.kind?.startsWith('part:') && openPart) {
    const cur = cleanValue(openPart), names = partNames(openPart);
    $$('.opt', box).forEach((b, i) => b.classList.toggle('on', names[i] === cur));
  } else if (openKind) {
    const cur = S.look.features[FEATURE_OF[openKind]] ? S.look.stamps[openKind] : null;
    $$('.opt', box).forEach((b, i) => b.classList.toggle('on', optionNames(openKind!)[i] === cur));
  }
}

/** Paint option previews (cells of the whole grid) cropped to box c. */
function paintPreviews(box: HTMLElement, cells: Uint8Array[], W: number, c: { x0: number; y0: number; x1: number; y1: number }) {
  $$<HTMLCanvasElement>('.opt canvas', box).forEach((cv, i) => {
    if (!cells[i]) return;
    const w = c.x1 - c.x0, h = c.y1 - c.y0, crop = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) crop.set(cells[i].subarray((c.y0 + y) * W + c.x0, (c.y0 + y) * W + c.x1), y * w);
    paintCells(cv, crop, w, h);
    cv.style.aspectRatio = `${w * S.cellAspect} / ${h}`;
  });
}

/** Show the open row's options under it and render their previews (after the latest render settles). */
function renderOptions() {
  const box = $('#stampopts');
  if (isClean()) { renderPartOptions(box); return; }
  const kind = openKind, face = gridFace();
  if (!kind || !face || pixels()) { box.hidden = true; markOptions(); return; }
  const names = optionNames(kind);
  $(`[data-stamp=${kind}]`).insertAdjacentElement('afterend', box);
  if (box.dataset.kind !== kind) {
    box.dataset.kind = kind;
    box.innerHTML = names.map(n => `<button class="opt" title="${kind} · ${n === '' ? 'auto' : n ?? 'off'}"><canvas width="1" height="1"></canvas><span>${n === '' ? 'auto' : n ?? 'off'}</span></button>`).join('');
    $$<HTMLButtonElement>('.opt', box).forEach((b, i) => (b.onclick = () => setStamp(kind, names[i])));
  }
  box.hidden = false;
  markOptions();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    const c = optionCrop(kind, face), looks = names.map(name => {
      const look = structuredClone(S.look);
      look.features[FEATURE_OF[kind]] = name !== null;
      look.stamps[kind] = name ?? '';
      return look;
    });
    (S.style === 'ml' ? ml : instant).variants(S.style, looks, r => {
      if (openKind !== kind || r.W !== S.W || r.H !== S.H || isClean()) return;
      paintPreviews(box, r.cells, r.W, c);
    });
  }, 150);
}

/** Clean avatar options: every hair (the whole avatar) or every fitting face part (the face) on your current mix. */
function renderPartOptions(box: HTMLElement) {
  const kind = openPart, info = S.clean;
  if (!kind || !info || pixels()) { box.hidden = true; markOptions(); return; }
  const names = partNames(kind), key = `part:${kind}:${names.join(',')}`;
  $(`[data-part=${kind}]`).insertAdjacentElement('afterend', box);
  if (box.dataset.kind !== key) {
    box.dataset.kind = key;
    const label = (n: string) => (n === '' ? `auto · ${info.auto[kind]}` : n);
    box.innerHTML = names.map(n => `<button class="opt" title="${kind} · ${label(n)}"><canvas width="1" height="1"></canvas><span>${n === '' ? 'auto' : n}</span></button>`).join('');
    $$<HTMLButtonElement>('.opt', box).forEach((b, i) => (b.onclick = () => setPart(kind, names[i])));
  }
  box.hidden = false;
  markOptions();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    const f = cleanBoxes(info).face, c = kind === 'hair' ? clampBox([info.x0, info.y0, info.x0 + info.size, info.y0 + info.size]) : clampBox([f.x0, f.y0, f.x1, f.y1]);
    const looks = names.map(n => ({ ...structuredClone(S.look), clean: cleanWith(kind, n) }));
    instant.variants('clean', looks, r => {
      if (openPart !== kind || r.W !== S.W || r.H !== S.H || !isClean()) return;
      paintPreviews(box, r.cells, r.W, c);
    });
  }, 150);
}

/** Open (or close) a feature's options. */
function openOptions(kind: StampKind, toggle = true) {
  openKind = toggle && openKind === kind ? null : kind;
  renderOptions();
}
function openPartOptions(kind: CleanPart, toggle = true) {
  openPart = toggle && openPart === kind ? null : kind;
  renderOptions();
}

/** Step a stamp: auto → 1 … n → off → auto. */
function cycleStamp(kind: StampKind, dir: number) {
  const n = STAMPS[kind].length, next = (stampPos(kind) + dir + n + 2) % (n + 2);
  setStamp(kind, next === n + 1 ? null : next === 0 ? '' : STAMPS[kind][next - 1].name);
}

// ---------------------------------------------------------------- clean avatar: mode, characters, parts
/** The 40 characters (nickname, name), from the library's manifest. */
let characters: { nick: string; name: string; number: number }[] = [];
const avatarUrl = (nick: string, size: number) => `${import.meta.env.BASE_URL}avatars/${nick}/${size}.png`;

/** A part's value as the panel shows it: what is set ('' auto), or in prebuilt the character's own. */
const cleanValue = (kind: CleanPart) => (S.look.clean.mode === 'prebuilt' ? S.clean?.parts[kind] ?? '' : S.look.clean.parts[kind]);

/** The clean look with one part set; from prebuilt it turns custom, starting from that character's own parts. */
function cleanWith(kind: CleanPart, name: string) {
  const c = S.look.clean, parts = c.mode === 'prebuilt' && S.clean ? { ...S.clean.parts } : { ...c.parts };
  parts[kind] = name;
  return { mode: 'custom' as const, character: c.character, parts };
}

function setPart(kind: CleanPart, name: string) {
  const was = S.look.clean.mode;
  S.look.clean = cleanWith(kind, name);
  log(`> ${kind} · ${name === '' ? `auto · ${S.clean?.auto[kind] ?? '—'}` : name}${was === 'prebuilt' ? ' · now custom, starting from the character' : ''}`);
  syncControls(); lookChanged();
}

/** Step a part through auto, then every option for this head. */
function cyclePart(kind: CleanPart, dir: number) {
  const names = partNames(kind), cur = names.indexOf(cleanValue(kind));
  setPart(kind, names[((cur < 0 ? 0 : cur) + dir + names.length) % names.length]);
}

function setCleanMode(mode: 'custom' | 'prebuilt') {
  S.look.clean = { ...S.look.clean, mode };
  log(mode === 'prebuilt' ? `> prebuilt · ${S.look.clean.character || `closest · ${S.clean?.closest ?? '—'}`}` : '> custom · parts closest to the photo, change any of them in 08 parts');
  syncControls(); lookChanged();
}

/** Prebuilt: show a character (by nickname, '' = the closest), or step from the one shown. */
function setCharacter(nick: string) {
  S.look.clean = { ...S.look.clean, mode: 'prebuilt', character: nick };
  const c = characters.find(c => c.nick === nick);
  log(`> prebuilt · ${c ? `${String(c.number).padStart(2, '0')} ${c.name.toLowerCase()}` : `closest · ${S.clean?.closest ?? '—'}`}`);
  syncControls(); lookChanged();
}
function stepCharacter(dir: number) {
  const cur = S.look.clean.mode === 'prebuilt' ? S.look.clean.character || S.clean?.character : S.clean?.head;
  const i = Math.max(0, characters.findIndex(c => c.nick === cur));
  if (characters.length) setCharacter(characters[(i + dir + characters.length) % characters.length].nick);
}

/** The character picker: every character at the grid's size; the one in use (or the closest) marked. */
function paintCharacters() {
  const box = $('#charopts'), size = cleanSize(S.W, S.H);
  if (box.dataset.size !== String(size) || box.childElementCount !== characters.length + 1) {
    box.dataset.size = String(size);
    box.innerHTML = `<button class="opt" data-nick=""><span class="auto">auto</span><span>closest</span></button>`
      + characters.map(c => `<button class="opt" data-nick="${c.nick}" title="${String(c.number).padStart(2, '0')} · ${c.name}"><img alt="" src="${avatarUrl(c.nick, size)}"><span>${c.nick}</span></button>`).join('');
    $$<HTMLButtonElement>('.opt', box).forEach(b => (b.onclick = () => setCharacter(b.dataset.nick!)));
  }
  const pre = S.look.clean.mode === 'prebuilt';
  $$<HTMLButtonElement>('.opt', box).forEach(b => {
    b.classList.toggle('on', pre && b.dataset.nick === S.look.clean.character);
    b.classList.toggle('near', b.dataset.nick === S.clean?.closest && !!S.photo && S.photo.kind === 'photo');
  });
}

/** Mirror axis: the face centre (between the outer eye corners, or the clean avatar's eyes), snapped to half a cell; the grid centre otherwise. */
function updateAxis() {
  if (isClean() && S.clean && S.res.get('clean')?.W === S.W && S.res.get('clean')?.H === S.H) { S.ed.axis = Math.round((S.clean.at.axis + 0.5) * 2) / 2; return; }
  const c = crop(), lm = S.photo?.lm;
  const x = c && lm ? ((lm[2 * 33] + lm[2 * 263]) / 2 - c.x) * S.W / c.w : S.W / 2;
  S.ed.axis = Math.round(Math.min(S.W, Math.max(0, x)) * 2) / 2;
}

// ---------------------------------------------------------------- workers (latest request wins)
/** One processing worker: at most one request in flight, the newest waiting one replaces older ones. */
class Renderer {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private busy = false;
  private queued = false;
  private nextId = 1;
  private firstValid = 1; // results from requests sent before the current photo are dropped

  private previews = new Map<number, (r: { W: number; H: number; cells: Uint8Array[] }) => void>();
  private nextPreview = 1;

  constructor(private styles: StyleId[], onResult: (r: RenderResult) => void, onProgress: (t: string) => void, onError: (m: string) => void = () => {}) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') { if (m.id >= this.firstValid) onProgress(m.text); return; }
      // Option previews answer on their own (error ids are negative) and never hold up the renders.
      if (m.type === 'variants') { this.previews.get(m.id)?.(m); this.previews.delete(m.id); return; }
      if (m.type === 'error' && m.id < 0) { this.previews.delete(-m.id); return; }
      this.busy = false;
      if (m.type === 'error') { log(`> style ${this.styles.join('')} failed: ${m.message}`); onError(m.message); }
      else if (m.res.id >= this.firstValid) onResult(m.res);
      if (this.queued) { this.queued = false; this.render(); }
    };
    this.worker.onerror = e => { this.busy = false; log(`> worker error: ${e.message}`); };
  }

  source(m: ToWorker, transfer: Transferable[] = []) {
    this.firstValid = this.nextId;
    this.worker.postMessage(m, transfer);
  }

  render() {
    const c = crop();
    if (!c) return;
    if (this.busy) { this.queued = true; return; }
    this.busy = true;
    const req = { id: this.nextId++, crop: c, W: S.W, H: S.H, styles: this.styles, look: structuredClone(S.look) };
    this.worker.postMessage({ type: 'render', req } satisfies ToWorker);
  }

  /** Render `style` once per look (one per option); the worker queues it behind any render in flight. */
  variants(style: StyleId, looks: Look[], done: (r: { W: number; H: number; cells: Uint8Array[] }) => void) {
    const c = crop();
    if (!c) return;
    const id = this.nextPreview++;
    this.previews.set(id, done);
    const req = { id: 0, crop: c, W: S.W, H: S.H, styles: [style], look: looks[0] };
    this.worker.postMessage({ type: 'variants', v: { id, req, looks } } satisfies ToWorker);
  }
}

type Rendered = StyleResult & { W: number; H: number };
let raf = 0, detectorsReady = false;

/** An imported pixel image is open: no styles render, the image is the base. */
const pixels = () => S.photo?.kind === 'pixels';
/** No photo: started from a character, only the clean avatar renders. */
const blank = () => S.photo?.kind === 'blank';
// Steps that only change how a photo is turned into pixels (without a photo, style and parts still pick a character).
const PHOTO_STEPS: Step[] = ['frame', 'style', 'regions', 'features', 'background', 'stamps'];
const NEEDS_PHOTO: Step[] = ['frame', 'regions', 'features', 'background'];

function applyResult(res: RenderResult) {
  if (pixels()) return; // a render from the photo before the pixel image
  if (res.prepMs) S.prepMs = res.prepMs;
  S.hairLum = res.hairLum;
  S.lenses = res.lenses;
  if (res.clean) S.clean = res.clean;
  for (const r of res.results) S.res.set(r.style, { ...r, W: res.W, H: res.H });
  if (res.clean) updateAxis();
  if (res.results.some(r => r.style === 'ml')) S.mlNote = '';
  paintGallery();
  refresh();
  if ((openKind || openPart) && S.step === 'stamps' && res.results.some(r => r.style === S.style)) renderOptions();
  if (res.clean) { paintCharacters(); refresh(); }
}
const instant = new Renderer(INSTANT, applyResult, () => {});
const ml = new Renderer(['ml'], applyResult, t => { S.mlNote = t; paintGallery(); refresh(); }, // shown in the ML tile + status
  () => { if (!S.res.has('ml')) { S.mlNote = 'could not load the line model'; paintGallery(); } });

function scheduleRender() {
  if (!raf && !pixels()) raf = requestAnimationFrame(() => { raf = 0; instant.render(); if (!blank()) ml.render(); });
}

// ---------------------------------------------------------------- photo
async function loadPhoto(file: File) {
  const name = file.name || 'pasted image';
  log(`> reading ${name}`);
  let img: HTMLImageElement;
  try { img = await loadImage(file); }
  catch { log('> could not read this image · try a JPG, PNG or BMP'); return; }
  // Already pixel art (a few flat colours on a grid, maybe enlarged)? Open it as it is.
  const art = pixelArtOf(img);
  if (art) {
    startPixels(Date.now(), name, art, null);
    const [sx, sy] = art.scale, enlarged = sx !== 1 || sy !== 1;
    log(`> pixel art · ${art.W}×${art.H} cells${enlarged ? ` (${+sx.toFixed(2)}${sy !== sx ? `×${+sy.toFixed(2)}` : ''} px each)` : ''} · ${art.colours > 2 ? `${art.colours} colours split into ink and paper` : '2 colours'} · opened for editing`);
    return;
  }
  const canvas = photoCanvas(img);

  log(detectorsReady ? '> finding the face…' : '> loading the face models (first photo only)…');
  let det: Awaited<ReturnType<typeof detect>>;
  try { det = await detect(canvas); }
  catch (err) { det = { lm: null, seg: null, ms: 0 }; log(`> face models failed to load (${err instanceof Error ? err.message : err}) · using the photo as is`); }
  startPhoto(Date.now(), name, canvas, det, null);
  log(det.lm
    ? `> face found in ${Math.round(det.ms)} ms${S.photo!.glasses >= GLASSES_MIN_SHARE ? ' · glasses found, drawn as frames' : ''}`
    : '> no face found · framing the whole photo, features off');
}

/** Put a photo + its detection into the app: fresh (restore = null) or reopened from the autosave. */
function startPhoto(id: number, name: string, canvas: HTMLCanvasElement, det: { lm: Float32Array | null; seg: Uint8Array | null; ms: number }, restore: store.SavedState | null, fromStore = false) {
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
  if (DEBUG) Object.assign(window, { __kpaeDebug: { w, h, rgba: rgba.slice(), seg: det.seg?.slice() ?? null, lm: det.lm } });
  S.photo = { kind: 'photo', id, name, canvas, lm: det.lm, head: det.lm && det.seg ? headBox(det.seg, w, h, det.lm) : null, regions, glasses, ms: det.ms };
  S.res.clear();
  S.lenses = null;
  S.clean = null;
  S.mlNote = '';
  S.hairLum = -1;
  if (restore) {
    applySettings(restore.settings);
    S.ed.restore(restore.edits.W, restore.edits.H, restore.edits.cells, restore.edits.baked);
    S.ed.fit(S.W, S.H);
  } else {
    S.frame = { ...AUTO_FRAME };
    S.look.clean = structuredClone(AUTO_CLEAN); // a new person: the clean avatar matches them afresh
    S.look.features = { ...S.look.features, glasses: glasses >= GLASSES_MIN_SHARE };
    S.ed.reset(S.W, S.H);
  }
  if (!fromStore) {
    const seg = det.seg?.slice() ?? null;
    canvas.toBlob(png => {
      if (png && !resetting) store.savePhoto({ id, name, png, lm: det.lm, seg, regions, glasses, ms: det.ms }).then(() => scheduleSave(), storeFailed);
    }, 'image/png');
  }
  updateAxis();
  ml.source({ type: 'source', source: { w, h, rgba: rgba.slice(), seg: det.seg?.slice() ?? null, lm: det.lm } });
  instant.source({ type: 'source', source: { w, h, rgba, seg: det.seg, lm: det.lm } }, [rgba.buffer, ...(det.seg ? [det.seg.buffer] : [])]);

  ($('#exportname') as HTMLInputElement).value = exportBase();
  drawThumb();
  syncControls();
  paintGallery();
  setStep('style');
  scheduleRender();
}

/** Frame ratio name for a physical width : height, or free. */
const ratioOf = (w: number, h: number) => Object.entries(RATIOS).find(([, [a, b]]) => Math.abs(w * b - h * a) < 1e-6)?.[0] ?? 'free';

/** Open a pixel image as it is: its cells become the frozen base, ready to edit; its colours become the palette. */
function startPixels(id: number, name: string, art: PixelArt, restore: store.SavedState | null, fromStore = false) {
  const canvas = document.createElement('canvas');
  paintCells(canvas, art.cells, art.W, art.H, art.palette);
  S.photo = { kind: 'pixels', id, name, canvas, lm: null, head: null, regions: [], glasses: -1, ms: 0 };
  S.res.clear();
  S.lenses = null;
  S.clean = null;
  S.mlNote = '';
  S.hairLum = -1;
  if (restore) {
    applySettings(restore.settings);
    const e = restore.edits;
    S.ed.restore(e.W, e.H, e.cells, e.baked ?? art.cells);
    S.ed.fit(S.W, S.H);
  } else {
    Object.assign(S, { W: art.W, H: art.H, cellAspect: art.cellAspect, pal: [...art.palette], ratio: ratioOf(art.W * art.cellAspect, art.H) });
    S.ed.restore(art.W, art.H, new Uint8Array(art.W * art.H), art.cells);
  }
  if (!fromStore)
    canvas.toBlob(png => {
      if (png && !resetting) store.savePhoto({ kind: 'pixels', id, name, png, lm: null, seg: null, regions: [], glasses: -1, ms: 0 }).then(() => scheduleSave(), storeFailed);
    }, 'image/png');
  updateAxis();
  ($('#exportname') as HTMLInputElement).value = exportBase();
  drawThumb();
  syncControls();
  paintGallery();
  setStep('draw');
}

/**
 * Start without a photo: the clean avatar alone, prebuilt, from the first character (or the saved project's). The
 * steps that need a photo are dimmed; dropping a photo later starts a normal project.
 */
function startBlank(id: number, restore: store.SavedState | null, fromStore = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  S.photo = { kind: 'blank', id, name: 'character', canvas, lm: null, head: null, regions: [], glasses: -1, ms: 0 };
  S.res.clear();
  S.lenses = null;
  S.clean = null;
  S.mlNote = '';
  S.hairLum = -1;
  if (restore) {
    applySettings(restore.settings);
    S.ed.restore(restore.edits.W, restore.edits.H, restore.edits.cells, restore.edits.baked);
    S.ed.fit(S.W, S.H);
  } else {
    S.style = 'clean';
    S.look.clean = { ...structuredClone(AUTO_CLEAN), mode: 'prebuilt', character: characters[0]?.nick ?? 'sidepart' };
    S.look.features = { ...S.look.features, glasses: false };
    if (!CLEAN_SIZES.includes(S.W) || S.W !== S.H) Object.assign(S, { W: 50, H: 50, ratio: '1:1' });
    S.ed.reset(S.W, S.H);
  }
  if (!fromStore)
    canvas.toBlob(png => {
      if (png && !resetting) store.savePhoto({ kind: 'blank', id, name: 'character', png, lm: null, seg: null, regions: [], glasses: -1, ms: 0 }).then(() => scheduleSave(), storeFailed);
    }, 'image/png');
  ml.source({ type: 'source', source: null });
  instant.source({ type: 'source', source: null });
  ($('#exportname') as HTMLInputElement).value = exportBase();
  drawThumb();
  syncControls();
  paintGallery();
  setStep('style');
  scheduleRender();
}

// ---------------------------------------------------------------- autosave (IndexedDB, last project only)
const settings = () => ({ frame: S.frame, ratio: S.ratio, W: S.W, H: S.H, lock: S.lock, cellAspect: S.cellAspect, look: S.look, style: S.style, pal: S.pal, fmt: S.fmt, depth: S.depth });
function applySettings(v: Record<string, unknown>) {
  const s = v as ReturnType<typeof settings>;
  const clean = (s.look as Partial<Look> | undefined)?.clean;
  const pal = s.pal.map(c => { const k = OLD_PAL.indexOf(c); return k >= 0 && s.pal.every(q => OLD_PAL.includes(q)) ? DEFAULT_PAL[k] : c; });
  Object.assign(S, { frame: { ...AUTO_FRAME, ...s.frame }, ratio: s.ratio, W: s.W, H: s.H, lock: s.lock, cellAspect: s.cellAspect, style: OLD_IDS[s.style] ?? s.style, pal, fmt: s.fmt ?? 'png', depth: s.depth ?? 1 });
  S.look = { ...S.look, ...s.look, features: { ...S.look.features, ...s.look.features },
    clean: { ...AUTO_CLEAN, ...clean, parts: { ...AUTO_CLEAN.parts, ...clean?.parts } } };
  // Stamps are kept by name (older projects saved list positions).
  S.look.stamps = Object.fromEntries(STAMP_KINDS.map(k => [k, stampName(k, (s.look.stamps as Record<string, unknown> | undefined)?.[k])])) as Look['stamps'];
}
let saveTimer = 0, storeWarned = false;
function storeFailed() {
  if (!storeWarned) log('> autosave is not available in this browser · export to keep your work');
  storeWarned = true;
}
let resetting = false; // set once a reset is confirmed: nothing may be saved again before the reload
function scheduleSave() {
  if (!S.photo || resetting) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!S.photo) return;
    store.saveState({
      version: 1, photoId: S.photo.id, savedAt: Date.now(), settings: structuredClone(settings()),
      edits: { W: S.ed.W, H: S.ed.H, cells: S.ed.flatEdits(), baked: S.ed.baked?.slice() ?? null },
    }).then(() => { $$('[data-bind=saved]').forEach(e => (e.textContent = `Saved in this browser at ${new Date().toTimeString().slice(0, 5)}. Only the last project is kept.`)); }, storeFailed);
  }, 600);
}

function drawThumb() {
  const t = $('#thumb') as HTMLCanvasElement, p = S.photo;
  if (!p || p.kind === 'blank') { t.hidden = true; return; }
  const s = 160 / Math.max(p.canvas.width, p.canvas.height);
  t.width = Math.round(p.canvas.width * s); t.height = Math.round(p.canvas.height * s);
  const ctx = t.getContext('2d')!;
  ctx.imageSmoothingEnabled = p.kind === 'photo'; // pixel images stay crisp
  ctx.drawImage(p.canvas, 0, 0, t.width, t.height);
  t.hidden = false;
}

const exportBase = () => `${(blank() ? `avatar_${S.look.clean.mode === 'prebuilt' && S.look.clean.character || 'custom'}` : S.photo?.name ?? 'portrait').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')}_${S.W}x${S.H}`;

// ---------------------------------------------------------------- painting
const hexRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function paintCells(canvas: HTMLCanvasElement, cells: Uint8Array, W: number, H: number, pal = S.pal) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!, img = ctx.createImageData(W, H), p = pal.map(hexRgb);
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
  const cv = $('#cv') as HTMLCanvasElement, r = shown();
  if (!r) { cv.width = cv.height = 0; return; }
  const { W, H } = r, a = S.cellAspect, box = stageBox(), o = overlaid();
  const ed = $('#editor');
  ed.style.paddingTop = `${(o ? $('#toolbar').offsetHeight : 0) + 24}px`;
  ed.style.paddingBottom = `${(o ? $('#statusbar').offsetHeight : 0) + 24}px`;
  const fit = Math.max(1, Math.floor(Math.min(box.w / (W * a), box.h / H)));
  const ch = Math.max(1, fit + S.zoom * Math.max(1, Math.round(fit / 4))), cw = Math.max(1, Math.round(ch * a));
  const off = document.createElement('canvas');
  paintCells(off, r.cells, W, H);
  cv.width = W * cw; cv.height = H * ch;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, W * cw, H * ch);
  const face = S.step === 'stamps' && !isClean() ? gridFace() : null, info = S.step === 'stamps' && isClean() ? S.clean : null;
  if (face || info) { // tappable features
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ok').trim();
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    const boxes = face ? hitBoxes(face) : cleanBoxes(info!);
    for (const k of ['eyes', 'brows', 'mouth', 'nose'] as const) {
      const b = boxes[k];
      ctx.strokeRect(Math.round(b.x0 * cw) + 0.5, Math.round(b.y0 * ch) + 0.5, Math.round((b.x1 - b.x0) * cw), Math.round((b.y1 - b.y0) * ch));
    }
    ctx.setLineDash([]);
  }
  if (S.grid && ch >= 5) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line2').trim();
    for (let x = 0; x <= W; x++) { ctx.globalAlpha = x % 10 ? 0.35 : 0.9; ctx.fillRect(x * cw, 0, 1, H * ch); }
    for (let y = 0; y <= H; y++) { ctx.globalAlpha = y % 10 ? 0.35 : 0.9; ctx.fillRect(0, y * ch, W * cw, 1); }
    ctx.globalAlpha = 1;
  }
  const sel = S.ed.sel;
  if (sel) { // paper line with ink dashes: visible on both colours
    const rect = [sel.x * cw + 0.5, sel.y * ch + 0.5, sel.w * cw - 1, sel.h * ch - 1] as const;
    ctx.lineWidth = 1;
    ctx.strokeStyle = S.pal[1]; ctx.strokeRect(...rect);
    ctx.strokeStyle = S.pal[0]; ctx.setLineDash([4, 4]); ctx.strokeRect(...rect); ctx.setLineDash([]);
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
  for (const [i, s] of STYLES.entries()) {
    const t = document.createElement('button');
    t.className = 'tile'; t.dataset.style = s.k;
    t.innerHTML = `<span class="n"><span>style ${letter(i)}</span><span data-ms></span></span><div class="ph wait">rendering…</div><canvas hidden></canvas><span class="t">${s.t}</span><span class="d">${s.d}</span>`;
    t.onclick = () => pickStyle(s.k, true);
    g.appendChild(t);
  }
  for (const [i, s] of LATER.entries()) {
    const d = document.createElement('div');
    d.className = 'tile is-draft';
    d.innerHTML = `<span class="n"><span>style ${letter(STYLES.length + i)}</span><span>${s.tag}</span></span><div class="ph">${s.ph}</div><span class="t">${s.t}</span><span class="d">${s.d}</span>`;
    g.appendChild(d);
  }
  const l = $('#stylelist'); l.innerHTML = '';
  for (const [i, s] of STYLES.entries()) {
    const r = document.createElement('div');
    r.className = 'lrow'; r.dataset.style = s.k; r.tabIndex = 0;
    r.innerHTML = `<span class="lnum">${letter(i)}</span><span class="left">${s.t}</span><span class="right" data-ms></span>`;
    r.onclick = () => pickStyle(s.k, false);
    l.appendChild(r);
  }
  for (const [i, s] of LATER.entries()) {
    const r = document.createElement('div');
    r.className = 'lrow faint';
    r.innerHTML = `<span class="lnum">${letter(STYLES.length + i)}</span><span class="left">${s.t}</span><span class="right">${s.tag}</span>`;
    l.appendChild(r);
  }
}

const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(1, Math.round(ms))} ms`);

function paintGallery() {
  for (const t of $$('#ggrid .tile[data-style]')) {
    const k = t.dataset.style as StyleId, r = S.res.get(k), cv = $('canvas', t) as HTMLCanvasElement, ph = $('.ph', t);
    t.classList.toggle('sel', k === S.style);
    ph.hidden = !!r; cv.hidden = !r;
    $('[data-ms]', t).textContent = r ? fmtMs(r.ms) : '';
    if (r) {
      const cells = r.W === S.ed.W && r.H === S.ed.H ? S.ed.overlay(r.cells) : r.cells;
      paintCells(cv, cells, r.W, r.H); cv.style.aspectRatio = `${r.W * S.cellAspect} / ${r.H}`;
    }
    ph.style.aspectRatio = `${S.W * S.cellAspect} / ${S.H}`;
    ph.textContent = !S.photo ? 'no photo yet' : blank() && k !== 'clean' ? 'needs a photo' : k === 'ml' && S.mlNote ? S.mlNote : 'rendering…';
  }
  for (const r of $$('#stylelist .lrow[data-style]')) {
    const k = r.dataset.style as StyleId, res = S.res.get(k);
    r.classList.toggle('sel', k === S.style);
    $('[data-ms]', r).textContent = res ? fmtMs(res.ms) : '';
  }
}

function pickStyle(k: StyleId, openPixels: boolean) {
  if (blank() && k !== 'clean') { log('> this style is drawn from a photo · drop one in, or stay with the clean avatar'); return; }
  S.style = k;
  log(S.ed.live ? `> style ${k} · ${styleInfo(k).t.toLowerCase()}${S.ed.count ? ' · edits kept' : ''}` : '> the base is baked · tick live to follow the style again');
  if (openPixels) { S.pixelsOverStyles = true; }
  if (k === 'clean' && (!CLEAN_SIZES.includes(S.W) || S.W !== S.H)) {
    setGrid(snapClean(S.W), null);
    log(`> clean avatar · grid ${S.W}×${S.H}, a size the characters are drawn at`);
  }
  syncControls(); paintGallery(); refresh();
  if (openKind || openPart) renderOptions(); // the previews show the style picked
}

/** The clean avatar's size nearest to n (the sizes the team's art is drawn at). */
const snapClean = (n: number) => CLEAN_SIZES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

// ---------------------------------------------------------------- steps, views, chrome
function currentView(): View {
  if (!S.photo) return 'empty';
  if (pixels()) return 'pixels';
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
  if (step === 'stamps' && (openKind || openPart)) renderOptions();
}

function log(t: string) {
  $('#log').textContent = t;
}

function refresh() {
  const view = currentView();
  $('#stage').dataset.view = view;
  setSeg($('#viewseg'), b => b.dataset.view === view); // neither is lit on the empty or frame view
  if (view === 'pixels') drawEditor();
  if (view === 'frame') drawFrame();

  // nav values
  const bind = (k: string, v: string) => $$(`[data-bind=${k}]`).forEach(e => (e.textContent = v));
  const moved = S.frame.ox || S.frame.oy;
  bind('photo', blank() ? 'none · a character' : S.photo ? S.photo.name : '—');
  bind('frame', `${moved ? 'moved' : S.frame.framing === 0.5 ? 'auto' : S.frame.framing < 0.5 ? 'tight' : 'wide'} · ${S.ratio}`);
  bind('gridsize', `${S.W}×${S.H}`);
  bind('cells', `${(S.W * S.H).toLocaleString('en')} cells`);
  const skin = S.look.skin.toFixed(2).replace(/^0/, '');
  bind('regions', S.look.hairMode === 'auto' ? `skin ${skin}` : `${skin} · ${S.look.hairMode}`);
  const L = S.hairLum;
  bind('hairlum', !S.photo ? '—' : L < 0 ? 'no hair found' : `${L < 70 ? 'dark' : L < 110 ? 'medium' : L < 150 ? 'light' : 'very light'} · ${Math.round(L / 2.55)}% lightness`);
  const g = S.photo?.glasses ?? -1;
  bind('glasses', g < 0 ? '—' : g >= GLASSES_MIN_SHARE ? `detected · ${Math.round(g * 100)}% of eye area` : `not detected · ${Math.round(g * 100)}% of eye area`);
  const f = S.look.features, found = g >= GLASSES_MIN_SHARE;
  bind('features', Object.entries(f).every(([k, v]) => (k === 'glasses' ? v === found : v)) ? 'auto' : 'custom');
  bind('background', S.look.background);
  bind('fmt', S.fmt === 'bmp' ? `bmp ${S.depth}-bit` : S.fmt);
  const face = gridFace();
  let picked = 0;
  for (const kind of STAMP_KINDS) {
    const n = STAMPS[kind].length, v = S.look.stamps[kind], on = S.look.features[FEATURE_OF[kind]];
    if (on && v) picked++;
    $(`[data-stamp=${kind}] .stepper span`).textContent = !on ? 'off'
      : v ? `${stampPos(kind)}/${n} · ${v}`
      : `auto · ${face ? autoName(kind, face) : '—'}${S.style === 'ml' && (kind === 'mouth' || kind === 'nose') ? ' (ML: model)' : ''}`;
  }
  const cl = S.look.clean, set = CLEAN_PARTS.filter(k => cl.parts[k]).length;
  bind('stamps', isClean() ? (cl.mode === 'prebuilt' ? `prebuilt · ${cl.character || S.clean?.character || 'closest'}` : set ? `${set} picked` : 'auto') : picked ? `${picked} picked` : 'auto');
  bind('stylename', isClean() ? `clean · ${cl.mode}` : styleInfo(S.style).key);
  // clean avatar parts: auto · what it picked, or position / count · nickname
  for (const kind of CLEAN_PARTS) {
    const names = partNames(kind), v = cleanValue(kind), i = names.indexOf(v);
    $(`[data-part=${kind}] .stepper span`).textContent = !S.clean ? '—'
      : v === '' ? `auto · ${S.clean.auto[kind]}` : i > 0 ? `${i}/${names.length - 1} · ${v}` : v;
  }
  $$('.stamprow').forEach(e => (e.hidden = isClean()));
  $$('.partrow').forEach(e => (e.hidden = !isClean()));
  $('#cleanbox').hidden = !isClean();
  const shownChar = cl.mode === 'prebuilt' ? cl.character || S.clean?.character : S.clean?.head, ci = characters.findIndex(c => c.nick === shownChar);
  bind('character', ci < 0 ? '—' : `${cl.mode === 'prebuilt' && !cl.character ? 'closest · ' : ''}${ci + 1}/${characters.length} · ${characters[ci].nick}`);
  setSeg($('#cleanmode'), b => b.dataset.mode === cl.mode);
  paintCharacters();
  markOptions();
  $('#glasses-note').textContent = g < 0 ? '' : found ? '· found' : '· none found';
  $$('#nav .lrow').forEach(r => r.classList.toggle('faint', (!S.photo && r.dataset.step !== 'photo') || (pixels() && PHOTO_STEPS.includes(r.dataset.step as Step))
    || (blank() && NEEDS_PHOTO.includes(r.dataset.step as Step))));
  $$('.pixnote').forEach(e => (e.hidden = !pixels()));
  $$('.blanknote').forEach(e => (e.hidden = !blank()));

  // swatches
  $$('[data-sw]').forEach(e => (e.style.background = S.pal[+e.dataset.sw!]));
  $$<HTMLInputElement>('[data-pal]').forEach(e => (e.value = S.pal[+e.dataset.pal!]));
  $$<HTMLInputElement>('[data-hex]').forEach(e => { if (document.activeElement !== e) e.value = S.pal[+e.dataset.hex!]; });

  // editor
  const ed = S.ed, n = ed.count;
  bind('edits', n ? plural(n, 'edit') : '—');
  bind('editsdetail', n ? `${plural(n, 'cell')} · ${ed.countOf(0)} ink · ${ed.countOf(1)} paper` : 'none yet');
  bind('basestate', pixels() ? 'the imported image · edits go on top' : ed.live ? 'live · follows the style and sliders' : 'baked · frozen until live is ticked');
  bind('axis', `${S.photo?.lm ? 'face centre' : 'grid centre'} · x ${ed.axis}`);
  bind('brush', String(ed.brush));
  bind('sel', ed.sel ? `${ed.sel.w}×${ed.sel.h} at ${ed.sel.x}, ${ed.sel.y}${ed.floating ? ' · lifted' : ''}` : 'none · drag with select');
  $$<HTMLButtonElement>('[data-sel]').forEach(b => (b.disabled = !ed.sel));
  setSeg($('#behindseg'), b => b.dataset.behind === ed.behind);
  $$('.tb-draw').forEach(e => (e.hidden = ed.tool === 'select'));
  $$('.tb-select').forEach(e => (e.hidden = ed.tool !== 'select'));
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ed.tool));
  $$('[data-ink]').forEach(b => b.classList.toggle('on', +b.dataset.ink! === ed.ink));
  $$('.mirrorcheck').forEach(b => setCheck(b, ed.mirror));
  setCheck($('#livecheck'), ed.live);
  ($('#undo') as HTMLButtonElement).disabled = !ed.canUndo;
  ($('#redo') as HTMLButtonElement).disabled = !ed.canRedo;
  $('#zoomval').textContent = S.zoom ? (S.zoom > 0 ? '+' : '') + S.zoom : 'fit';
  setSeg($('#fmtseg'), b => b.dataset.fmt === S.fmt);
  $$<HTMLButtonElement>('#depthseg button').forEach(b => { b.disabled = !depthFits(+b.dataset.depth! as BmpDepth, S.pal.length); });
  setSeg($('#depthseg'), b => +b.dataset.depth! === S.depth);
  $('#bmprow').hidden = S.fmt !== 'bmp';
  $('#exportbtn').textContent = `export ${S.fmt}`;
  scheduleSave();

  // status
  const r = S.res.get(S.style), sh = shown();
  let ink = 0;
  if (sh) for (const v of sh.cells) ink += +(v === 0);
  const cellsInk = (c: { W: number; H: number }) => `${c.W}×${c.H} · ${(c.W * c.H).toLocaleString('en')} cells · ${Math.round(ink / (c.W * c.H) * 100)}% ink · ${plural(n, 'edit')}`;
  $('#status').textContent = blank() && sh
    ? `no photo · clean avatar · ${S.look.clean.mode} · ${sh.W}×${sh.H} · ${Math.round(ink / (sh.W * sh.H) * 100)}% ink · ${plural(n, 'edit')}`
    : pixels() && sh
    ? `imported · ${S.photo!.name} · ${cellsInk(sh)}`
    : r && sh
    ? `${ed.live ? 'base' : 'baked'} · ${styleInfo(S.style).t.toLowerCase()} · ${sh.W}×${sh.H} · ${(sh.W * sh.H).toLocaleString('en')} cells · ${Math.round(ink / (sh.W * sh.H) * 100)}% ink · ${plural(n, 'edit')} · ${fmtMs(r.ms + (r.style === 'ml' ? 0 : S.prepMs))}`
    : `${S.photo ? (S.style === 'ml' && S.mlNote ? S.mlNote : 'rendering') : 'no photo'} · ${S.W}×${S.H} · ${(S.W * S.H).toLocaleString('en')} cells`;
}

// ---------------------------------------------------------------- controls
const fmt2 = (v: number) => v.toFixed(2);
const bars = {
  framing: new Bar($('#bar-framing'), { min: 0, max: 1, value: 0.5, fmt: v => (v < 0.34 ? 'tight' : v > 0.66 ? 'wide' : 'medium'), onInput: v => { S.frame.framing = v; frameChanged(); } }),
  vertical: new Bar($('#bar-vertical'), { min: -1, max: 1, value: 0, fmt: fmt2, onInput: v => { S.frame.oy = v; frameChanged(); } }),
  w: new Bar($('#bar-w'), { min: 16, max: 250, value: 64, step: 1, fmt: v => `${v} st`, onInput: v => setGrid(v, null) }),
  h: new Bar($('#bar-h'), { min: 16, max: 300, value: 80, step: 1, fmt: v => `${v} st`, onInput: v => setGrid(null, v) }),
  cell: new Bar($('#bar-cell'), { min: 0.5, max: 1.5, value: 1, step: 0.01, fmt: fmt2, onInput: v => { S.cellAspect = v; setGrid(S.W, null); } }),
  lineWeight: new Bar($('#bar-lineweight'), { min: 0.5, max: 2, value: 1, step: 0.05, fmt: v => `${v.toFixed(2)}×`, onInput: v => { S.look.lineWeight = v; lookChanged(); } }),
  cleanup: new Bar($('#bar-cleanup'), { min: 0, max: 4, value: 2, step: 1, fmt: v => String(v), onInput: v => { S.look.cleanup = v; lookChanged(); } }),
  skin: new Bar($('#bar-skin'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.skin = v; lookChanged(); } }),
  light: new Bar($('#bar-light'), { min: 0, max: 1, value: 0.8, step: 0.05, fmt: fmt2, onInput: v => { S.look.evenLight = v; lookChanged(); } }),
  hair: new Bar($('#bar-hair'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.hair = v; lookChanged(); } }),
  clothes: new Bar($('#bar-clothes'), { min: 0, max: 1, value: 0.5, step: 0.01, fmt: fmt2, onInput: v => { S.look.clothes = v; lookChanged(); } }),
  bg: new Bar($('#bar-bg'), { min: 0, max: 1, value: 0.25, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, onInput: v => { S.look.bgDensity = v; lookChanged(); } }),
};

function frameChanged() { updateAxis(); refresh(); scheduleRender(); }
function lookChanged() { refresh(); scheduleRender(); }

/** Change width and/or height; with the lock on, the other side follows the frame ratio. */
function setGrid(W: number | null, H: number | null) {
  if (isClean()) { // the clean avatar comes in the sizes the art is drawn at, square
    const n = snapClean(W ?? H ?? S.W);
    W = n; H = null;
    S.ratio = '1:1';
    S.H = n;
  }
  const r = RATIOS[S.ratio], locked = S.lock && r;
  if (W != null) { S.W = W; if (locked) S.H = Math.max(16, Math.min(300, Math.round(W * S.cellAspect * r[1] / r[0]))); }
  if (H != null) { S.H = H; if (locked) S.W = Math.max(16, Math.min(250, Math.round(H * r[0] / (r[1] * S.cellAspect)))); }
  ($('#exportname') as HTMLInputElement).value = exportBase();
  const had = S.ed.count, old = `${S.ed.W}×${S.ed.H}`;
  S.ed.fit(S.W, S.H);
  if ((had || pixels()) && old !== `${S.W}×${S.H}`) log(`> ${pixels() ? 'image' : 'edits'} scaled from ${old} to ${S.W}×${S.H}`);
  updateAxis();
  syncControls(); refresh(); scheduleRender();
}

function syncControls() {
  bars.framing.set(S.frame.framing); bars.vertical.set(S.frame.oy);
  bars.w.set(S.W); bars.h.set(S.H); bars.cell.set(S.cellAspect); bars.cleanup.set(S.look.cleanup); bars.lineWeight.set(S.look.lineWeight);
  bars.skin.set(S.look.skin); bars.light.set(S.look.evenLight); bars.hair.set(S.look.hair); bars.clothes.set(S.look.clothes); bars.bg.set(S.look.bgDensity);
  $('#bgdensity-row').classList.toggle('off', S.look.background === 'white' || S.look.background === 'black');
  setSeg($('#ratioseg'), b => b.dataset.ratio === S.ratio);
  setSeg($('#sizeseg'), b => +b.textContent! === S.W);
  setSeg($('#bgseg'), b => b.dataset.bg === S.look.background);
  setSeg($('#hairseg'), b => b.dataset.hair === S.look.hairMode);
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
seg($('#hairseg'), b => { S.look.hairMode = b.dataset.hair as Look['hairMode']; log(`> hair · ${S.look.hairMode}`); lookChanged(); });
seg($('#bgseg'), b => { S.look.background = b.dataset.bg as Look['background']; syncControls(); lookChanged(); });
check($('#lockcheck'), on => { S.lock = on; if (on) setGrid(S.W, null); });
$$('[data-feature]').forEach(b => check(b, on => { S.look.features[b.dataset.feature as keyof Features] = on; syncControls(); lookChanged(); }));
check($('#gridcheck'), on => { S.grid = on; refresh(); });
$('#frame-reset').onclick = () => { S.frame = { ...AUTO_FRAME }; syncControls(); frameChanged(); };

$$('#nav .lrow[data-step]').forEach(r => {
  r.onclick = () => setStep(r.dataset.step as Step);
  r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(r.dataset.step as Step); } };
});
$$<HTMLButtonElement>('#viewseg button').forEach(b => (b.onclick = () => {
  if (b.dataset.view === 'styles') { if (S.step !== 'style') setStep('style'); else { S.pixelsOverStyles = false; refresh(); } }
  else if (S.step === 'style') { S.pixelsOverStyles = true; refresh(); }
  else if (S.step === 'frame') setStep('grid');
}));
const zoomBy = (d: number) => { S.zoom = d ? Math.max(-3, Math.min(12, S.zoom + d)) : 0; refresh(); };
$$<HTMLButtonElement>('[data-zoom]').forEach(b => (b.onclick = () => zoomBy(+b.dataset.zoom!)));
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

// export: the final composite only, 1 px (or SVG unit) per cell, opaque palette colours, no margin or overlays
$('#exportbtn').onclick = () => {
  const r = final();
  if (!r) { log(S.photo ? '> this style is still rendering' : '> nothing to export yet · load a portrait first'); return; }
  const name = (($('#exportname') as HTMLInputElement).value.trim() || exportBase()).replace(/\.(png|bmp|svg)$/i, '') + '.' + S.fmt;
  const done = (b: Blob, what: string) => { download(b, name); log(`> exported ${name} · ${what}`); };
  if (S.fmt === 'bmp') {
    const depth = depthFits(S.depth, S.pal.length) ? S.depth : smallestDepth(S.pal.length);
    done(encodeBmp(r.cells, r.W, r.H, S.pal, depth), `${r.W}×${r.H} px, ${depth}-bit, 1 px per stitch`);
  } else if (S.fmt === 'svg') {
    done(encodeSvg(r.cells, r.W, r.H, S.pal, S.cellAspect), `${r.W}×${r.H} cells as paths`);
  } else {
    done(encodePng(r.cells, r.W, r.H, S.pal), `${r.W}×${r.H} px, ${S.pal.length <= 2 ? '1-bit' : 'indexed'}, 1 px per stitch`);
  }
};
seg($('#fmtseg'), b => { S.fmt = b.dataset.fmt as typeof S.fmt; refresh(); });
seg($('#depthseg'), b => { S.depth = +b.dataset.depth! as BmpDepth; refresh(); });
// Reset (11 reset in the nav, "forget this project" in export): asks first, then forgets the saved project and
// reloads, so every setting starts from its default. The theme is a browser preference and stays.
{
  const dlg = $('#resetdlg') as HTMLDialogElement, ask = () => { if (!dlg.open) dlg.showModal(); };
  $('#forget').onclick = ask;
  $('#resetrow').onclick = ask;
  $('#resetrow').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ask(); } };
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close('cancel'); }); // a click on the backdrop
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'reset') return;
    resetting = true; clearTimeout(saveTimer);
    log('> resetting…');
    store.forget().catch(() => {}).finally(() => location.reload());
  });
}

// ---------------------------------------------------------------- editor: tools, pointer, keys
const editorChanged = () => { refresh(); paintGallery(); };
/** The base the editor draws over: the selected style's result, or the frozen base while that one renders. */
const editBase = () => editable()?.cells ?? S.ed.baked;
const setTool = (t: Tool) => { if (t !== 'select' && S.ed.sel) { S.ed.deselect(); paintGallery(); } S.ed.tool = t; refresh(); };
const setInk = (k: number) => { S.ed.ink = k; refresh(); };
const setMirror = (on: boolean) => { S.ed.mirror = on; refresh(); };
const undo = () => { S.ed.undo(); editorChanged(); };
const redo = () => { S.ed.redo(); editorChanged(); };
const bake = () => {
  const base = editBase();
  if (!base) { log('> nothing to bake yet'); return; }
  S.ed.bake(base);
  log(pixels() ? '> edits baked into the image' : `> baked ${styleInfo(S.style).t.toLowerCase()} + edits into plain pixels · tick live to follow the style again`);
  editorChanged();
};
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
$$('[data-ink]').forEach(b => b.addEventListener('click', () => setInk(+b.dataset.ink!)));
$$('.mirrorcheck').forEach(b => b.addEventListener('click', () => setMirror(!S.ed.mirror)));
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$$('[data-act=bake]').forEach(b => (b.onclick = bake));
$('#livecheck').onclick = () => {
  if (pixels()) { log('> an imported pixel image has no style to follow · load a photo for live styles'); return; }
  const r = editable();
  if (!r) return;
  S.ed.setLive(!S.ed.live, r.cells);
  log(S.ed.live ? '> live · the base follows the style and sliders again' : '> base frozen · sliders no longer change it');
  editorChanged();
};
$('#clearedits').onclick = () => { S.ed.clear(); editorChanged(); };

// selection: flip, mirror copy, nudge, select all
const selAct = (act: string) => {
  const base = editBase();
  if (!base) return;
  if (!S.ed.sel) { log('> select an area first · drag with select (S), ⌘A selects everything'); return; }
  if (act === 'flip-h' || act === 'flip-v') S.ed.flip(act === 'flip-h' ? 'h' : 'v', base);
  else if (act === 'mirror') { S.ed.mirrorCopy(base); log(`> flipped copy on the other side of the ${S.photo?.lm ? 'face' : 'grid'} centre · drag to place it`); }
  else if (act === 'drop') S.ed.deselect();
  if (act !== 'drop') S.ed.tool = 'select';
  editorChanged();
};
const selectAll = () => { if (!editBase()) return; S.ed.selectAll(); S.ed.tool = 'select'; editorChanged(); };
$$<HTMLButtonElement>('[data-sel]').forEach(b => b.addEventListener('click', () => selAct(b.dataset.sel!)));
seg($('#behindseg'), b => { S.ed.behind = b.dataset.behind as Behind; refresh(); });
$$<HTMLButtonElement>('[data-cycle]').forEach(b => (b.onclick = () => cycleStamp(b.closest<HTMLElement>('[data-stamp]')!.dataset.stamp as StampKind, +b.dataset.cycle!)));
$$<HTMLButtonElement>('[data-stamp] [data-opts]').forEach(b => (b.onclick = () => openOptions(b.closest<HTMLElement>('[data-stamp]')!.dataset.stamp as StampKind)));
$$<HTMLButtonElement>('[data-pcycle]').forEach(b => (b.onclick = () => cyclePart(b.closest<HTMLElement>('[data-part]')!.dataset.part as CleanPart, +b.dataset.pcycle!)));
$$<HTMLButtonElement>('[data-part] [data-opts]').forEach(b => (b.onclick = () => openPartOptions(b.closest<HTMLElement>('[data-part]')!.dataset.part as CleanPart)));
seg($('#cleanmode'), b => setCleanMode(b.dataset.mode as 'custom' | 'prebuilt'));
$$<HTMLButtonElement>('[data-char]').forEach(b => (b.onclick = () => stepCharacter(+b.dataset.char!)));
$('#stamps-auto').onclick = () => {
  if (isClean()) {
    S.look.clean = structuredClone(AUTO_CLEAN);
    log('> all parts on auto · closest to the photo'); syncControls(); lookChanged();
    return;
  }
  S.look.stamps = { ...AUTO_STAMPS };
  for (const k of STAMP_KINDS) if (k !== 'glasses') S.look.features[FEATURE_OF[k]] = true;
  S.look.features.glasses = (S.photo?.glasses ?? -1) >= GLASSES_MIN_SHARE;
  log('> all stamps on auto'); syncControls(); lookChanged();
};
$$<HTMLButtonElement>('[data-brush]').forEach(b => (b.onclick = () => { S.ed.brush = Math.max(1, Math.min(6, S.ed.brush + +b.dataset.brush!)); refresh(); }));
{
  const cv = $('#cv') as HTMLCanvasElement;
  const cellAt = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * S.ed.W), Math.floor((e.clientY - r.top) / r.height * S.ed.H)];
  };
  cv.addEventListener('pointerdown', e => {
    if (S.step === 'stamps' && !pixels() && isClean()) { // tap a part to see its options
      const kind = cleanPartAt(...cellAt(e));
      if (kind) { openPartOptions(kind, false); log(`> ${kind} · pick an option in the panel`); }
      return;
    }
    if (S.step === 'stamps' && !pixels()) { // tap a feature to cycle its stamp
      const face = gridFace(), [x, y] = cellAt(e);
      if (!face) return;
      const boxes = hitBoxes(face), cx = x + 0.5, cy = y + 0.5;
      const inside = (k: StampKind) => { const b = boxes[k]; return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1; };
      const kind = (['brows', 'nose', 'mouth', 'eyes'] as StampKind[]).find(inside) ?? (inside('glasses') ? 'glasses' : null);
      if (kind) { openOptions(kind, false); log(`> ${kind} · pick an option in the panel`); }
      return;
    }
    const base = editBase();
    if (!base || e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    S.ed.down(...cellAt(e), base);
    drawEditor();
  });
  cv.addEventListener('pointermove', e => {
    if (S.ed.drawing) { S.ed.move(...cellAt(e)); drawEditor(); return; }
    cv.style.cursor = S.ed.tool === 'select' && S.step !== 'stamps' && S.ed.inside(...cellAt(e)) ? 'move' : '';
  });
  const end = () => { if (S.ed.drawing) { S.ed.up(); editorChanged(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  $('#editor').addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel / two fingers scroll the zoomed grid
    e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}
window.addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, .bar, dialog') || e.altKey) return; // typing, sliders and the reset dialog keep their keys
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a' && currentView() === 'pixels') { e.preventDefault(); selectAll(); return; }
  if (mod) return;
  const arrow = ({ arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] } as Record<string, number[]>)[k];
  const base = editBase();
  if (arrow && S.ed.sel && base) { // nudge the selection one cell (five with shift)
    e.preventDefault();
    const n = e.shiftKey ? 5 : 1;
    S.ed.nudge(arrow[0] * n, arrow[1] * n, base); editorChanged(); return;
  }
  const act: Record<string, () => void> = {
    b: () => setTool('pencil'), e: () => setTool('erase'), g: () => setTool('fill'), l: () => setTool('line'), s: () => setTool('select'),
    h: () => selAct('flip-h'), v: () => selAct('flip-v'), escape: () => selAct('drop'), enter: () => selAct('drop'),
    x: () => setInk(1 - S.ed.ink), m: () => setMirror(!S.ed.mirror), '+': () => zoomBy(1), '=': () => zoomBy(1), '-': () => zoomBy(-1), '0': () => zoomBy(0),
  };
  if ((k === 'escape' || k === 'enter') && !S.ed.sel) return;
  if (act[k]) { e.preventDefault(); act[k](); }
});

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
$$('[data-blank]').forEach(b => (b.onclick = () => { startBlank(Date.now(), null); log('> no photo · prebuilt characters · step through them in 03 style, or drop a photo for a match'); }));
wireImport(fileInput, f => void loadPhoto(f), over => document.body.classList.toggle('dragover', over));
window.addEventListener('resize', () => refresh());
setInterval(() => ($('#clock').textContent = new Date().toTimeString().slice(0, 8)), 1000);

buildGallery();
// The characters' nicknames and names, for the clean avatar's picker.
fetch(`${import.meta.env.BASE_URL}avatars/manifest.json`).then(r => r.json()).then((m: { chars: typeof characters }) => {
  characters = m.chars.map(({ nick, name, number }) => ({ nick, name, number }));
  refresh();
}).catch(() => log('> could not load the clean avatar characters'));
for (const s of PHOTO_STEPS) // shown while a pixel image is open
  $(`.panel[data-panel=${s}] .dash`).insertAdjacentHTML('afterend', '<div class="warn small pixnote" hidden>An imported pixel image is open: this step turns photos into pixels and doesn\'t change it. Edit it in 07 draw.</div>');
for (const s of NEEDS_PHOTO) // shown while there is no photo (started from a character)
  $(`.panel[data-panel=${s}] .dash`).insertAdjacentHTML('afterend', '<div class="warn small blanknote" hidden>No photo yet: this step works on a photo. Drop one in to match the clean avatar to it.</div>');
syncControls();
setStep('photo');
paintGallery();
// Reopen the last project, if this browser kept one.
store.load().then(async saved => {
  if (!saved || S.photo) return;
  const p = saved.photo;
  if (p.kind === 'blank') startBlank(p.id, saved.state, true);
  else if (p.kind === 'pixels') {
    const art = pixelArtOf(await loadImage(p.png));
    if (!art) return;
    startPixels(p.id, p.name, art, saved.state, true);
  } else startPhoto(p.id, p.name, await decodeImage(p.png), { lm: p.lm, seg: p.seg, ms: p.ms }, saved.state, true);
  const when = saved.state ? new Date(saved.state.savedAt) : null;
  log(`> reopened the last session${when ? ` (saved ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${when.toTimeString().slice(0, 5)})` : ''}`);
}).catch(() => {});
// Warm the face models while the page is idle, so the first photo is quick.
(window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(() => { loadDetectors().then(() => (detectorsReady = true), () => {}); });
