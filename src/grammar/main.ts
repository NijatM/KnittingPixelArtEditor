// Knit Grammar: Learn pages and the editor. Built into #kg the first time the section opens; routed by app.ts
// with the part of the hash after "#grammar" ("learn/needle", "editor/key", …).
//
// The editor has two layers on one canvas: the knit program (operations) and, when the pattern has a grammar,
// the design (signs). Both are edited by the same tools through a GEditor each; with a live grammar, every change
// to the signs rewrites the program (structures.ts). The 3D view (sim3d.ts, loaded on demand) shows the rough
// outcome of the program.
import { SHELL } from './ui';
import { MINIS, PAGES, SOURCES } from './learn';
import { BASIC, PRESETS, TWO, autoName, cloneKey, fromHex, glyphOf, hex, learnPageOf, rgbText, type Action, type Bed, type Key, type Move, type Op, type Step } from './ops';
import { createPattern, dirOf, floatIndex, fromJSON, newId, passOf, resized, toJSON, UNKNOWN, MAX_SIDE, type Pattern, type Structure } from './pattern';
import { GEditor, type GTool, type RepeatMode } from './editor';
import { cellAt, drawOverlay, drawPattern, layout, paintGlyph, Tiles, type ViewOpts } from './render';
import { DEFAULT_LIMITS, runChecks, type Finding, type Limits } from './checks';
import { EXPERIMENTS, MAX_SIGNS, experimentDesign, generate, newDesign, newSign, signKey, structureFrom, structuresFor } from './structures';
import * as io from './io';
import * as lib from './library';
import { mountFigure, type FigureMount } from '../hl';
import { latchNeedle, needleBed, racking, vSection } from './figures';
import { download } from '../export';
import { A_KNIT, A_MISS, A_TUCK, A_XFER, EMPTY, MACHINE_DEFAULTS, parentsOf, run, TUCK, type MachineOpts, type Topo } from './machine';
import { buildYarn, YARN_DEFAULTS, YARN_RANGES, type YarnParams, type YarnSys } from './yarn';
import type { KnitView, Mode } from './view3d';
import type { RelaxJob, RelaxPost } from './knit.worker';
import { $, $$, Bar, check, setCheck, seg, setSeg } from '../ui/controls';

type Step_ = 'experiments' | 'library' | 'pattern' | 'key' | 'grammar' | 'draw' | 'view' | 'check' | 'export';
type Fmt = 'bmp' | 'pdf' | 'txt' | 'png' | 'svg' | 'json';
type Look = 'grammar' | 'yarn';

const FIGS: Record<string, FigureMount> = { needleBed, latchNeedle, racking, vSection };
const STEPS: Step_[] = ['experiments', 'library', 'pattern', 'key', 'grammar', 'draw', 'view', 'check', 'export'];

let root: HTMLElement;
const G = {
  mode: 'learn' as 'learn' | 'editor',
  page: PAGES[0].id,
  step: 'experiments' as Step_,
  p: null as Pattern | null,
  ed: new GEditor(createPattern()),
  /** the design layer, drawn through its own editor as a pattern whose "operations" are the signs */
  dp: null as Pattern | null,
  ded: new GEditor(createPattern()),
  layer: 'ops' as 'ops' | 'signs',
  view: { symbols: true, guides: false, grid: true, numbers: true },
  view3d: false,
  look: 'yarn' as Look,
  /** 3D: machine or fabric, how far the beds are folded, the pass looked at (0 = pass 1) and the action in it
   *  (-1 = the whole pass), the yarn, the machine's unconfirmed rules, the share of the stage the 3D view takes */
  m3: 'fabric' as Mode,
  fold: 0,
  prow: 0,
  pact: -1,
  yarn: { ...YARN_DEFAULTS } as YarnParams,
  mopts: { ...MACHINE_DEFAULTS } as MachineOpts,
  playing: 0,
  k3w: 0.5,
  /** a loop picked in 3D (and its cell), shown in both views */
  pin: null as { cell: number; loop: number } | null,
  zoom: 0,
  limits: { ...DEFAULT_LIMITS } as Limits,
  findings: [] as Finding[],
  marks: null as string | null,
  fmt: 'bmp' as Fmt,
  keys: [] as Key[],
  list: [] as Pattern[],
  rep: 'all' as RepeatMode,
  shift: 0,
  hover: null as { x: number; y: number } | null,
  preview: null as { cells: [number, number][]; v: number } | null,
};
const tiles = new Tiles();
let base: HTMLCanvasElement | null = null, baseDirty = true;
let learnDisposers: (() => void)[] = [];

export const isActive = () => document.body.dataset.section === 'grammar';
const viewOnly = () => matchMedia('(max-width: 820px)').matches;
const log = (t: string) => { $('#kglog', root).textContent = t; };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The layer being drawn on, its pattern and its editor. */
const onSigns = () => G.layer === 'signs' && !!G.dp;
const PL = (): Pattern | null => (onSigns() ? G.dp : G.p);
const ED = (): GEditor => (onSigns() ? G.ded : G.ed);

// ---------------------------------------------------------------- routing
export function init(el: HTMLElement) {
  root = el;
  root.innerHTML = SHELL;
  wire();
  lib.listKeys().then(k => { G.keys = k; }).catch(() => {});
  renderExperiments();
  refreshLibrary().then(async () => {
    const last = await lib.getMeta<string>('last').catch(() => undefined);
    const p = (last && G.list.find(x => x.id === last)) || G.list[0];
    if (p && !G.p) open(p, false);
  });
}

/** Shows the part of the section a hash names: "learn/<page>[/<anchor>]" or "editor/<step>". */
export function route(sub: string) {
  const [area, a, b] = sub.replace(/#/g, '/').split('/').filter(Boolean);
  if (area === 'editor') {
    G.mode = 'editor';
    if (STEPS.includes(a as Step_)) {
      G.step = a as Step_;
      if (G.step === 'grammar' && G.dp) G.layer = 'signs';
      if (G.step === 'key') { G.layer = 'ops'; if (G.p) renderKey(); }
    }
  } else if (area === 'learn' || !area) {
    if (!area && G.list.length && !sub) { G.mode = 'editor'; }
    else { G.mode = 'learn'; if (a && PAGES.some(p => p.id === a)) G.page = a; }
  }
  root.dataset.mode = G.mode;
  if (G.mode === 'learn') renderLearn(G.page, b);
  else { disposeLearn(); consumeHandoff(); }
  refresh();
  requestAnimationFrame(() => { layoutStage(); baseDirty = true; draw(); if (G.view3d) show3D(); });
}

const goLearn = (page: string) => { location.hash = `#grammar/learn/${page}`; };
const goEditor = (step: Step_ = G.step) => { location.hash = `#grammar/editor/${step}`; };

// ---------------------------------------------------------------- learn
function disposeLearn() { learnDisposers.forEach(d => d()); learnDisposers = []; }

function renderLearn(id: string, anchor?: string) {
  disposeLearn();
  const page = PAGES.find(p => p.id === id) ?? PAGES[0], i = PAGES.indexOf(page);
  const art = $('#kglearn', root);
  const used = page.sources.map(s => SOURCES.findIndex(x => x.id === s)).filter(n => n >= 0).sort((a, b) => a - b);
  const prev = PAGES[i - 1], next = PAGES[i + 1];
  art.innerHTML = `
    <div class="kicker">${page.kicker}${page.draft ? ' <span class="badge">draft · awaiting review</span>' : ''}</div>
    <h1 class="title">${page.title}</h1>
    <div class="dash"></div>
    ${page.html}
    ${used.length ? `<div class="subhead">SOURCES<i></i></div><ol class="sources small">${used.map(n => `<li value="${n + 1}">${srcText(n)}</li>`).join('')}</ol>` : ''}
    <div class="pager">${prev ? `<a href="#grammar/learn/${prev.id}">‹ ${prev.nav}</a>` : '<span></span>'}${next ? `<a href="#grammar/learn/${next.id}">${next.nav} ›</a>` : `<a href="#grammar/editor/experiments">try the experiments ›</a>`}</div>`;
  $$('[data-sources]', art).forEach(ol => (ol.innerHTML = SOURCES.map((_, n) => `<li value="${n + 1}" id="src-${SOURCES[n].id}">${srcText(n)}</li>`).join('')));
  $$<HTMLElement>('figure[data-fig]', art).forEach(f => {
    const stage = document.createElement('div'), read = document.createElement('div');
    stage.className = 'figstage'; read.className = 'readout';
    f.prepend(stage, read);
    const m = mountFigure(stage, FIGS[f.dataset.fig!], { label: f.dataset.label ?? '', onRead: t => (read.textContent = t) });
    learnDisposers.push(() => m.destroy());
  });
  $$<HTMLElement>('figure[data-swatch]', art).forEach(f => mountSwatchFigure(f));
  $$<HTMLElement>('[data-keytable]', art).forEach(el => (el.innerHTML = keyTable(PRESETS.find(k => k.id === el.dataset.keytable)!)));
  $$<HTMLCanvasElement>('[data-keytable] canvas[data-op]', art).forEach(c => paintOpTile(c, (PRESETS.find(k => k.id === c.closest<HTMLElement>('[data-keytable]')!.dataset.keytable)!).ops[+c.dataset.op!], 26));
  $$<HTMLElement>('[data-mini]', art).forEach(el => renderMini(el, el.dataset.mini!));
  $$<HTMLElement>('[data-glyphs]', art).forEach(el => renderGlyphs(el));
  art.scrollTop = 0;
  if (anchor) requestAnimationFrame(() => art.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start' }));
}

function srcText(n: number) {
  const s = SOURCES[n];
  return esc(s.text) + (s.url ? ` <a href="${s.url}" target="_blank" rel="noopener">${s.url.replace(/^https?:\/\//, '')}</a>` : '');
}

function mountSwatchFigure(f: HTMLElement) {
  const box = document.createElement('div'), cap = document.createElement('figcaption'), bar = document.createElement('div');
  box.className = 'swbox'; box.innerHTML = '<div class="ph">3D swatch · loading</div>';
  bar.className = 'inline swbar';
  f.append(box, bar, cap);
  let alive = true, handle: import('./swatch3d').SwatchHandle | null = null;
  learnDisposers.push(() => { alive = false; handle?.destroy(); });
  import('./swatch3d').then(({ SWATCHES, mountSwatch }) => {
    if (!alive) return;
    const spec = SWATCHES[f.dataset.swatch!];
    box.innerHTML = '';
    cap.textContent = `${spec.caption}. The marked loop is lit. Computed by the same model as the editor's 3D view: which loop passes through which is exact under its rules, the relaxed shape is an uncalibrated estimate. Drag to turn it.`;
    try {
      const view = document.createElement('div'); view.className = 'swview'; box.append(view);
      handle = mountSwatch(view, spec);
      bar.innerHTML = '<span class="seg"><button data-sm="machine">machine</button><button data-sm="fabric" class="on">fabric</button></span><span class="stepper"><button data-sp="-1" aria-label="previous pass">‹</button><span class="swpass"></span><button data-sp="1" aria-label="next pass">›</button></span><button class="btn" data-sf>turn over</button>';
      const label = bar.querySelector<HTMLElement>('.swpass')!;
      label.textContent = handle.step(0);
      seg(bar.querySelector<HTMLElement>('.seg')!, b => handle?.mode(b.dataset.sm as Mode));
      bar.querySelectorAll<HTMLButtonElement>('[data-sp]').forEach(b => (b.onclick = () => { if (handle) label.textContent = handle.step(+b.dataset.sp!); }));
      bar.querySelector<HTMLButtonElement>('[data-sf]')!.onclick = () => handle?.flip();
    } catch { box.innerHTML = '<div class="ph">3D needs WebGL, which this browser has turned off</div>'; }
  }).catch(() => { box.innerHTML = '<div class="ph">could not load the 3D view</div>'; });
}

function keyTable(k: Key) {
  return `<table class="keytable"><thead><tr><th></th><th>colour</th><th>RGB</th><th>operation</th></tr></thead><tbody>${k.ops.map((o, i) =>
    `<tr><td><canvas data-op="${i}" width="26" height="26"></canvas></td><td>${o.colour}</td><td class="num">${rgbText(o.rgb)}</td><td><a href="#grammar/learn/${learnPageOf(o).replace('#', '/')}">${esc(o.name)}</a>${o.provisional ? ' <span class="badge">provisional</span>' : ''}${o.note ? ` <span class="dim">· ${esc(o.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>
    <div class="small dim keycredit">${esc(k.credit ?? '')}${(k.notes ?? []).map(n => `<br>${esc(n)}`).join('')}</div>`;
}

function paintOpTile(c: HTMLCanvasElement, op: Op, size: number) {
  const dpr = devicePixelRatio || 1;
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = hex(op.rgb); ctx.fillRect(0, 0, c.width, c.height);
  if (op.letter) {
    ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(c.width * 0.6)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(op.letter, c.width / 2, c.height * 0.54);
  } else paintGlyph(ctx, glyphOf(op), 0, 0, c.width, '#000');
}

function miniPattern(id: string): Pattern {
  const m = MINIS[id], rows = m.rows.map(r => r.split(' ')), key = m.two ? TWO : BASIC;
  const p = createPattern({ name: m.name, w: rows[0].length, h: rows.length, key });
  rows.forEach((r, y) => r.forEach((opId, x) => (p.cells[y * p.w + x] = Math.max(0, key.ops.findIndex(o => o.id === opId)))));
  return p;
}

/** What one pass does, needle by needle, with repeats run together: "1–4 knit front · 5 tuck front …". */
function passText(p: Pattern, y: number) {
  const runs: string[] = [];
  for (let x = 0; x < p.w;) {
    const v = p.cells[y * p.w + x];
    let e = x + 1;
    while (e < p.w && p.cells[y * p.w + e] === v) e++;
    runs.push(`${e - x > 1 ? `${x + 1}–${e}` : x + 1} ${v < UNKNOWN ? p.key.ops[v].name : 'unknown'}`);
    x = e;
  }
  return runs.join(' · ');
}

function renderMini(el: HTMLElement, id: string) {
  const m = MINIS[id], p = miniPattern(id), v: ViewOpts = { cs: 13, symbols: true, guides: !!m.guides, grid: true, numbers: true }, L = layout(p, v), dpr = devicePixelRatio || 1;
  el.classList.add('kmini');
  el.innerHTML = `<canvas></canvas>${m.step ? '<div class="passread small"><div class="stepper"><button data-pass="-1" aria-label="previous pass">‹</button><span></span><button data-pass="1" aria-label="next pass">›</button></div><span class="fg"></span></div>' : ''}<div class="minibar"><span class="dim small">${esc(p.name)} · ${p.w} × ${p.h}${m.two ? ' · two yarn guides' : ''}</span><button class="btn" data-openmini>open in editor ›</button></div>`;
  const c = el.querySelector('canvas')!;
  c.width = L.W * dpr; c.height = L.H * dpr; c.style.width = `${L.W}px`; c.style.height = `${L.H}px`;
  const ctx = c.getContext('2d')!;
  let pass = 1;
  const paint = () => {
    drawPattern(ctx, p, v, tiles, dpr);
    if (!m.step) return;
    const y = p.h - pass;
    drawOverlay(ctx, p, v, dpr, { sel: { x: 0, y, w: p.w, h: 1 } });
    el.querySelector('.passread .stepper span')!.textContent = `pass ${pass} ${dirOf(p, y) === 1 ? '→' : '←'}`;
    el.querySelector('.passread > .fg')!.textContent = passText(p, y);
  };
  paint();
  el.querySelectorAll<HTMLButtonElement>('[data-pass]').forEach(b => (b.onclick = () => { pass = Math.max(1, Math.min(p.h, pass + +b.dataset.pass!)); paint(); }));
  el.querySelector<HTMLButtonElement>('[data-openmini]')!.onclick = async () => { p.id = newId(); await lib.putPattern(p); await refreshLibrary(); open(p); goEditor('draw'); log(`> "${p.name}" copied into your library`); };
}

/** The symbol legend: tiles of chosen 4.S52 basic operations, each with what its symbol's part means. */
function renderGlyphs(el: HTMLElement) {
  const items = el.dataset.glyphs!.split(',').map(s => { const i = s.indexOf(':'); return { id: s.slice(0, i), text: s.slice(i + 1) }; });
  el.className = 'glyphs';
  el.innerHTML = items.map((it, k) => `<div class="glyph"><canvas data-g="${k}"></canvas><span class="small">${esc(it.text)}</span></div>`).join('');
  items.forEach((it, k) => {
    const op = BASIC.ops.find(o => o.id === it.id);
    if (op) paintOpTile(el.querySelector<HTMLCanvasElement>(`canvas[data-g="${k}"]`)!, op, 39);
  });
}

// ---------------------------------------------------------------- patterns
async function refreshLibrary() {
  G.list = await lib.listPatterns().catch(() => []);
  renderLibrary();
}

function open(p: Pattern, announce = true) {
  G.p = p; G.ed.load(p); G.zoom = 0; G.marks = null; G.hover = null; G.preview = null; G.pin = null; G.prow = p.h - 1; G.pact = -1; stopPlay();
  G.dp = null; syncDesign();
  if (!G.dp) G.layer = 'ops';
  tiles.bump(); baseDirty = true;
  lib.setMeta('last', p.id).catch(() => {});
  recheck();
  syncPattern();
  renderExperiments();
  refresh();
  draw();
  if (G.view3d) show3D();
  if (announce) log(`> opened "${p.name}" · ${p.w} × ${p.h} · ${p.key.mode === 2 ? 'two yarn guides' : 'one yarn guide'}${p.design ? ' · with a grammar' : ''}`);
}

async function newPattern(mode: 1 | 2, from?: Partial<Pattern>) {
  const n = G.list.length + 1;
  const p = Object.assign(createPattern({ name: `pattern ${n}`, key: mode === 2 ? TWO : BASIC }), from ?? {});
  await lib.putPattern(p);
  await refreshLibrary();
  open(p);
  return p;
}

/** Keeps the design layer's stand-in pattern in step with the open pattern's design. */
function syncDesign() {
  const p = G.p, d = p?.design;
  if (!p || !d) { G.dp = null; if (G.layer === 'signs') G.layer = 'ops'; return; }
  const key = signKey(d.signs);
  if (G.dp && G.dp.id === p.id && G.dp.cells === d.cells && G.dp.w === p.w && G.dp.h === p.h) { G.dp.key = key; return; }
  G.dp = { ...p, key, cells: d.cells, unknown: [], design: undefined };
  const op = Math.min(G.ded.op, d.signs.length - 1);
  G.ded.load(G.dp);
  Object.assign(G.ded, { tool: G.ed.tool, mirror: G.ed.mirror, every: G.ed.every, op: Math.max(0, op) });
}

let saveT = 0;
function scheduleSave() {
  clearTimeout(saveT);
  $('#kgsaved', root).textContent = 'saving…';
  saveT = window.setTimeout(async () => {
    if (!G.p) return;
    try { await lib.putPattern(G.p); $('#kgsaved', root).textContent = 'saved in this browser'; renderLibrary(); }
    catch { $('#kgsaved', root).textContent = 'not saved (storage blocked)'; }
  }, 400);
}

let checkT = 0;
function recheck() { if (G.p) G.findings = runChecks(G.p, G.limits); renderChecks(); }
function changed() {
  baseDirty = true;
  clearTimeout(checkT);
  checkT = window.setTimeout(() => { recheck(); refresh(); draw(); renderGrammarCounts(); if (G.step === 'key') renderKey(); }, 120);
  scheduleSave();
  refresh();
  draw();
  if (G.pin) { G.pin = null; view?.setMark(-1); }
  schedule3D();
}

/** The program as the signs ask for it (one undo step on the knit layer). */
function regen() {
  const p = G.p; if (!p?.design) return;
  G.ed.begin(); p.cells.set(generate(p)); G.ed.end();
}
/** Before an edit on the design layer: one history for both layers, so remember the state here. */
const beforeEdit = () => { if (onSigns()) G.ed.checkpoint(); };
/** After a stroke or action on the current layer. A design edit rewrites the program (if live) and becomes one
 *  undo step together with it. */
function edited() {
  if (onSigns()) {
    const p = G.p!;
    if (p.design?.live) p.cells.set(generate(p));
    G.ed.commit();
    changed();
    return;
  }
  const d = G.p?.design;
  if (d?.live) { d.live = false; renderGrammar(); log('> drawn on the knit layer by hand · live grammar is off so your edits stay (12 grammar to regenerate)'); }
  changed();
}

// ---------------------------------------------------------------- canvas
const ZMIN = 2, ZMAX = 56;
function stageArea() {
  const v = $('#kgview', root), tb = $('#kgtoolbar', root).offsetHeight, sb = $('#kgstatus', root).offsetHeight + (G.view3d ? $('#kgplay', root).offsetHeight : 0);
  return { w: Math.max(80, v.clientWidth - 40), h: Math.max(80, v.clientHeight - tb - sb - 24), tb, sb: $('#kgstatus', root).offsetHeight };
}
function fitCs() {
  if (!G.p) return 10;
  const a = stageArea(), sub = G.view.guides && G.p.key.mode === 2 && !onSigns() ? 2 : 1;
  const cs = Math.floor(Math.min((a.w - 56) / G.p.w, (a.h - 32) / (G.p.h * sub)));
  return Math.max(ZMIN, Math.min(40, cs));
}
const cs = () => G.zoom || fitCs();
const viewOpts = (): ViewOpts => ({ cs: cs(), symbols: G.view.symbols, guides: G.view.guides && G.p?.key.mode === 2 && !onSigns(), grid: G.view.grid, numbers: G.view.numbers });

function draw() {
  if (!root || !G.p || G.mode !== 'editor') return;
  const a = stageArea();
  const v3 = $('#kg3dview', root), play = $('#kgplay', root), ph = G.view3d ? play.offsetHeight : 0;
  v3.style.paddingTop = `${a.tb}px`; v3.style.paddingBottom = `${a.sb + ph}px`;
  $('.v3dbar', v3).style.bottom = `${a.sb + ph}px`; $('.v3dnote', v3).style.top = `${a.tb}px`;
  play.style.bottom = `${a.sb}px`;
  $('#kgsplit', root).style.top = `${a.tb}px`; $('#kgsplit', root).style.bottom = `${a.sb + ph}px`;
  if (G.view3d && root.dataset.split !== '1') return;
  const P = PL()!, cv = $<HTMLCanvasElement>('#kgcv', root), v = viewOpts(), L = layout(P, v), dpr = devicePixelRatio || 1;
  const W = Math.round(L.W * dpr), H = Math.round(L.H * dpr);
  if (!base || base.width !== W || base.height !== H) { base = document.createElement('canvas'); base.width = W; base.height = H; baseDirty = true; }
  if (baseDirty) { drawPattern(base.getContext('2d')!, P, v, tiles, dpr); baseDirty = false; }
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = `${L.W}px`; cv.style.height = `${L.H}px`; }
  $('#kgview', root).style.paddingTop = `${a.tb + 12}px`;
  $('#kgview', root).style.paddingBottom = `${a.sb + ph + 12}px`;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const marks = G.marks && !onSigns() ? new Set(G.findings.find(f => f.id === G.marks)?.cells ?? []) : null;
  const pass3 = G.view3d && topo && topo.h === P.h ? P.h - 1 - G.prow : null, pin = G.view3d && G.pin && topo && P.w === topo.w ? { x: G.pin.cell % P.w, y: Math.floor(G.pin.cell / P.w) } : null;
  drawOverlay(ctx, P, v, dpr, { hover: G.hover, sel: ED().sel, preview: G.preview, marks, row: pass3, pin });
  $('#kgzoom', root).textContent = G.zoom ? `${G.zoom}px` : 'fit';
}

function cellOf(e: PointerEvent) {
  const P = PL();
  if (!P) return null;
  const r = $<HTMLCanvasElement>('#kgcv', root).getBoundingClientRect();
  return cellAt(P, viewOpts(), e.clientX - r.left, e.clientY - r.top);
}

function zoomBy(d: number) {
  if (d === 0) G.zoom = 0;
  else { const now = cs(); G.zoom = Math.max(ZMIN, Math.min(ZMAX, d > 0 ? Math.ceil(now * 1.25) : Math.floor(now / 1.25))); }
  baseDirty = true; draw();
}

function readout(c: { x: number; y: number } | null) {
  const el = $('#kgread', root), p = G.p;
  if (!p || !c) { el.textContent = p ? `${p.w} needles × ${p.h} passes · ${p.key.name}${p.design ? ` · grammar of ${p.design.signs.length} signs` : ''}` : ''; return; }
  const i = c.y * p.w + c.x, v = p.cells[i], op = v < UNKNOWN ? p.key.ops[v] : null, rgb = op ? op.rgb : p.unknown[v - UNKNOWN];
  const sign = p.design?.signs[p.design.cells[i]];
  el.textContent = `pass ${passOf(p, c.y)} ${dirOf(p, c.y) === 1 ? '→' : '←'} · needle ${c.x + 1} · ${sign && onSigns() ? `sign ${sign.letter} "${sign.name}" → ` : ''}${op ? op.name : 'unknown colour'} ${rgbText(rgb)}`;
}

function wireCanvas() {
  const cv = $<HTMLCanvasElement>('#kgcv', root);
  let down: { x: number; y: number } | null = null, last: { x: number; y: number } | null = null, mode: 'paint' | 'run' | 'select' | 'move' | null = null;
  const inSel = (c: { x: number; y: number }) => { const s = ED().sel; return !!s && c.x >= s.x && c.y >= s.y && c.x < s.x + s.w && c.y < s.y + s.h; };
  cv.addEventListener('pointerdown', e => {
    if (!G.p || e.button > 0) return;
    if (viewOnly()) { log('> view only on phones · edit on a tablet or computer'); return; }
    const c = cellOf(e), ed = ED();
    if (!c) { if (ed.tool === 'motif') { ed.select(null); refresh(); draw(); } return; }
    cv.setPointerCapture(e.pointerId);
    down = c; last = c;
    const t = ed.tool;
    if (e.altKey || t === 'pick') { pickAt(c); mode = null; return; }
    beforeEdit();
    if (t === 'needle') { ed.begin(); ed.set(c.x, c.y); mode = 'paint'; }
    else if (t === 'pass') { ed.begin(); ed.pass(c.y); mode = 'paint'; }
    else if (t === 'wale') { ed.begin(); ed.wale(c.x); mode = 'paint'; }
    else if (t === 'flood') { ed.begin(); ed.flood(c.x, c.y); if (ed.end()) edited(); mode = null; return; }
    else if (t === 'run') { mode = 'run'; G.preview = { cells: [[c.x, c.y]], v: ed.op }; }
    else if (t === 'motif') { if (inSel(c)) mode = 'move'; else { mode = 'select'; ed.select({ x: c.x, y: c.y, w: 1, h: 1 }); } }
    baseDirty = mode === 'paint';
    draw();
  });
  cv.addEventListener('pointermove', e => {
    const c = cellOf(e), ed = ED();
    if (c?.x !== G.hover?.x || c?.y !== G.hover?.y) { G.hover = c; readout(c); if (G.view3d && !G.pin) view?.setMark(c ? c.y * G.p!.w + c.x : -1); }
    if (down && c && mode) {
      if (mode === 'paint' && last && (c.x !== last.x || c.y !== last.y)) {
        const t = ed.tool;
        if (t === 'needle') ed.run(last.x, last.y, c.x, c.y);
        else if (t === 'pass') ed.pass(c.y);
        else if (t === 'wale') ed.wale(c.x);
        baseDirty = true;
      } else if (mode === 'run') G.preview = { cells: GEditor.runCells(down.x, down.y, c.x, c.y), v: ed.op };
      else if (mode === 'select') ed.select({ x: Math.min(down.x, c.x), y: Math.min(down.y, c.y), w: Math.abs(c.x - down.x) + 1, h: Math.abs(c.y - down.y) + 1 });
      else if (mode === 'move') { ed.moveTo(c.x - down.x, c.y - down.y); baseDirty = true; }
      last = c;
    }
    draw();
  });
  const end = (e: PointerEvent) => {
    if (!down) return;
    const c = cellOf(e) ?? last, ed = ED();
    if (mode === 'paint') { if (ed.end()) edited(); }
    else if (mode === 'run' && c) { ed.begin(); ed.run(down.x, down.y, c.x, c.y); G.preview = null; if (ed.end()) edited(); }
    else if (mode === 'move') { ed.drop(); edited(); }
    else if (mode === 'select') refresh();
    down = null; last = null; mode = null; G.preview = null;
    draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!down) { G.hover = null; readout(null); if (G.view3d && !G.pin) view?.setMark(-1); draw(); } });
  $('#kgview', root).addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
}

function pickAt(c: { x: number; y: number }) {
  const P = PL()!, v = P.cells[c.y * P.w + c.x];
  if (v >= UNKNOWN) { log('> that cell has a colour outside the key'); return; }
  setOp(v);
}

// ---------------------------------------------------------------- actions
function setTool(t: GTool) { for (const e of [G.ed, G.ded]) { e.tool = t; if (t !== 'motif') e.select(null); } refresh(); draw(); }
function setOp(i: number) { const P = PL(); if (!P) return; ED().op = Math.max(0, Math.min(P.key.ops.length - 1, i)); refresh(); renderGrammarSel(); }
function setMirror(on: boolean) { G.ed.mirror = G.ded.mirror = on; refresh(); }
function setLayer(l: 'ops' | 'signs') {
  if (l === 'signs' && !G.p?.design) { log('> this pattern has no grammar yet · start one in 12 grammar'); goEditor('grammar'); return; }
  G.layer = l; G.hover = null; baseDirty = true; refresh(); renderGrammarSel(); draw();
  log(l === 'signs' ? '> drawing signs: the design layer · the knit program follows the signs' : '> drawing on the knit program itself');
}

function selAct(a: string) {
  const ed = ED();
  if (a === 'drop') { ed.select(null); refresh(); draw(); return; }
  if (!ed.sel) { log('> select a motif first (S, then drag a rectangle)'); return; }
  beforeEdit();
  if (a === 'flip-h') ed.flip('h');
  else if (a === 'flip-v') ed.flip('v');
  else if (a === 'fill') ed.fillSel();
  else if (a === 'clear') ed.clearSel();
  else if (a === 'repeat') { ed.repeat(G.rep, G.shift); log(`> motif ${ed.sel.w} × ${ed.sel.h} repeated ${G.rep === 'all' ? 'everywhere' : G.rep}${G.shift ? `, shifted ${G.shift} per repeat` : ''}`); }
  edited();
}

/** One history for both layers: undo / redo always go through the knit layer's editor, whose snapshots include
 *  the design. */
function afterHistory() { tiles.bump(); syncDesign(); syncPattern(); changed(); }
function undo() { if (G.ed.undo()) afterHistory(); }
function redo() { if (G.ed.redo()) afterHistory(); }

function resizeTo(w: number, h: number) {
  const p = G.p; if (!p) return;
  w = Math.max(1, Math.min(MAX_SIDE, Math.round(w))); h = Math.max(1, Math.min(MAX_SIDE, Math.round(h)));
  if (w === p.w && h === p.h) return;
  G.ed.whole(() => {
    const dcells = p.design && resized(p, w, h, 0, p.design.cells), cells = resized(p, w, h, floatIndex(p.key));
    p.cells = cells; p.w = w; p.h = h;
    if (p.design) { p.design.cells = dcells!; if (p.design.live) p.cells = generate(p); }
  });
  G.zoom = 0; syncDesign(); changed(); syncPattern();
  log(`> resized to ${w} × ${h} · pass 1 and needle 1 stay put`);
}

// ---------------------------------------------------------------- the grammar
function startGrammar() {
  const p = G.p; if (!p) return;
  const go = () => {
    G.ed.whole(() => { p.design = newDesign(p); p.cells = generate(p); });
    syncDesign(); G.layer = 'signs'; G.ded.op = 1;
    renderGrammar(); changed();
    log('> grammar started · sign A everywhere · draw with sign B to make a region');
  };
  const uniform = p.cells.every(v => v === p.cells[0]);
  if (uniform) { go(); return; }
  ask('12 · GRAMMAR', 'Start a grammar here?', '<p>The knit program will be written from the signs: everything is sign A (single jersey) to begin with, so your current program is replaced. Undo brings it back.</p>', 'start').then(ok => ok && go());
}

/** Changes the meaning of the signs as one undo step, then rewrites the program if live. */
function changeGrammar(apply: () => void, what: string) {
  const p = G.p; if (!p?.design) return;
  G.ed.whole(() => { apply(); if (p.design?.live) p.cells = generate(p); });
  tiles.bump(); syncDesign(); renderGrammar(); changed();
  if (what) log(`> ${what}`);
}

const NEXT_FILL: Record<1 | 2, string[]> = { 1: ['jersey', 'rib11', 'honeycomb', 'garter', 'hold', 'reverse', 'eyelet', 'slip'], 2: ['dk-a', 'dk-b', 'birdseye', 'tuck2', 'hold2', 'yg1only', 'dk-a', 'dk-b'] };

function renderGrammar() {
  const box = root && $('#kggram', root);
  if (!box) return;
  const p = G.p;
  if (!p) { box.innerHTML = '<div class="empty small">Open a pattern or an experiment first.</div>'; return; }
  const d = p.design;
  if (!d) {
    box.innerHTML = `<div class="note">This pattern has no grammar yet. A grammar is a layer of <b class="hi">signs</b>: paint regions with signs, say what structure each sign is knitted as, and the knit program is written for you.</div>
      <div class="inline"><button class="btn primary" id="kgstartgram">start a grammar</button><button class="btn" data-kstepgo="experiments">see one at work (08)</button></div>`;
    return;
  }
  const structs = structuresFor(p);
  const opts = (sel: string | null, none: boolean) => (none ? `<option value=""${sel ? '' : ' selected'}>none</option>` : '') + structs.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  box.innerHTML = `
    <div class="row"><label>live</label><div class="val"><button class="check${d.live ? ' on' : ''}" id="kglive"><span class="box">${d.live ? '[x]' : '[ ]'}</span> rewrite the program as signs change</button></div></div>
    <div class="inline"><button class="btn" id="kgregen">generate now</button><button class="btn" id="kgdropgram">remove the grammar</button></div>
    <div class="subhead">SIGNS<i></i></div>
    <div class="oplist">${d.signs.map((s, i) => `<div class="oprow signrow" data-sign="${i}">
      <button class="optile" data-picksign="${i}" title="draw with ${esc(s.name)} (${i + 1})"><canvas data-signtile="${i}"></canvas></button>
      <div class="opmain"><input class="txt opname" data-signname="${i}" value="${esc(s.name)}" aria-label="name of sign ${s.letter}">
        <div class="srow"><span class="dim small">knit as</span><select class="txt" data-signfill="${i}" aria-label="structure of sign ${s.letter}">${opts(s.fill, false)}</select></div>
        <div class="srow"><span class="dim small">outline</span><select class="txt" data-signedge="${i}" aria-label="outline of sign ${s.letter}">${opts(s.edge, true)}</select></div>
        <div class="small dim" data-signcount="${i}"></div></div>
      <div class="opside"><span class="sw" style="background:${hex(s.rgb)}"><input type="color" data-signcolour="${i}" value="${hex(s.rgb)}" aria-label="colour of sign ${s.letter}"></span>${d.signs.length > 1 ? `<button class="btn x" data-delsign="${i}" title="remove this sign">×</button>` : ''}</div>
    </div>`).join('')}</div>
    ${d.signs.length < MAX_SIGNS ? '<div class="inline"><button class="btn" id="kgaddsign">add a sign</button></div>' : ''}
    <div class="subhead">STRUCTURES<i></i></div>
    <div class="structs">${structs.map(s => `<div class="struct"><canvas data-structtile="${s.id}"></canvas><div class="smain"><div class="fg">${esc(s.name)}</div><div class="small dim">${esc(s.note ?? '')}</div></div>${s.id.startsWith('own-') ? `<button class="btn x" data-delstruct="${s.id}" title="remove this structure">×</button>` : ''}</div>`).join('')}</div>
    <div class="inline"><button class="btn" id="kgsavestruct">save the selected motif as a structure</button></div>`;
  const signs = signKey(d.signs);
  $$<HTMLCanvasElement>('canvas[data-signtile]', box).forEach(c => paintOpTile(c, signs.ops[+c.dataset.signtile!], 30));
  $$<HTMLCanvasElement>('canvas[data-structtile]', box).forEach(c => paintStructure(c, structs.find(s => s.id === c.dataset.structtile)!, p));
  renderGrammarSel();
  renderGrammarCounts();
}

function renderGrammarSel() { $$('[data-sign]', root).forEach(r => r.classList.toggle('on', onSigns() && +r.dataset.sign! === G.ded.op)); }
function renderGrammarCounts() {
  const d = G.p?.design; if (!d) return;
  const n = new Array(d.signs.length).fill(0);
  for (const v of d.cells) n[v]++;
  $$<HTMLElement>('[data-signcount]', root).forEach(el => (el.textContent = `${n[+el.dataset.signcount!] ?? 0} cells`));
}

/** A structure's tile repeated a few times, with symbols. */
function paintStructure(c: HTMLCanvasElement, s: Structure, p: Pattern) {
  const w = s.w * Math.max(1, Math.ceil(6 / s.w)), h = s.h * Math.max(1, Math.ceil(4 / s.h));
  const q = createPattern({ w: Math.min(w, 12), h: Math.min(h, 8), key: p.key });
  for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) {
    const id = s.rows[(s.h - 1 - ((q.h - 1 - y) % s.h))][x % s.w], i = q.key.ops.findIndex(o => o.id === id);
    q.cells[y * q.w + x] = i < 0 ? 0 : i;
  }
  const v: ViewOpts = { cs: 10, symbols: true, guides: false, grid: true, numbers: false }, L = layout(q, v), dpr = devicePixelRatio || 1;
  c.width = L.W * dpr; c.height = L.H * dpr; c.style.width = `${L.W}px`; c.style.height = `${L.H}px`;
  drawPattern(c.getContext('2d')!, q, v, tiles, dpr);
}

async function saveStructure() {
  const p = G.p, sel = G.ed.sel;
  if (!p?.design) { log('> start a grammar first'); return; }
  if (!sel) { log('> switch to the knit layer, select a motif (S), then save it'); return; }
  const n = p.design.custom.length + 1;
  const ok = await ask('12 · GRAMMAR', 'Save as a structure', `<p>The selected ${sel.w} × ${sel.h} motif becomes a structure: it repeats from needle 1 and pass 1 wherever a sign is knitted as it.</p><div class="row"><label>name</label><input class="txt" id="kgstructname" value="my structure ${n}"></div>`, 'save');
  if (!ok) return;
  const name = ($<HTMLInputElement>('#kgstructname', root).value.trim() || `my structure ${n}`);
  changeGrammar(() => p.design!.custom.push(structureFrom(p, sel, name)), `"${name}" saved · give it to a sign in 12 grammar`);
}

// ---------------------------------------------------------------- experiments
function renderExperiments() {
  const box = root && $('#kgexps', root);
  if (!box) return;
  const cur = G.p?.exp;
  box.innerHTML = EXPERIMENTS.map((e, i) => `<div class="exp${e.id === cur ? ' on' : ''}">
    <button class="exphead" data-startexp="${e.id}"><span class="lnum">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(e.title)}</span><span class="dim small">${esc(e.line)}${e.mode === 2 ? ' · two guides' : ''}</span></button>
    ${e.id === cur ? `<div class="expbody small"><p>${esc(e.look)}</p><div class="dim">TRY</div><ul>${e.tries.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="inline"><button class="btn" data-startexp="${e.id}" data-fresh="1">start again</button><button class="btn" data-kstepgo="grammar">12 grammar ›</button><button class="btn" data-v3go="${G.view3d ? 0 : 1}">${G.view3d ? 'see the program' : 'see it in 3D'}</button></div></div>` : ''}
  </div>`).join('');
}

async function startExperiment(id: string, fresh: boolean) {
  const e = EXPERIMENTS.find(x => x.id === id); if (!e) return;
  if (!fresh && G.p?.exp === id) return;
  const p = createPattern({ name: `test · ${e.title.toLowerCase()}`, w: e.w, h: e.h, key: e.mode === 2 ? TWO : BASIC });
  p.design = experimentDesign(e, p); p.cells = generate(p); p.exp = e.id; p.note = e.look;
  await lib.putPattern(p); await refreshLibrary();
  G.layer = 'signs'; G.view3d = true; G.m3 = 'fabric';
  open(p, false);
  layoutStage();
  G.layer = 'signs'; G.ded.op = Math.min(1, p.design.signs.length - 1);
  refresh(); renderGrammarSel();
  goEditor('experiments');
  log(`> experiment "${e.title}" · drawn with signs, shown in 3D · switch to 2D to draw`);
}

// ---------------------------------------------------------------- 3D
const MAX_3D = 300 * 300;
let view: KnitView | null = null, viewLoading: Promise<void> | null = null, v3T = 0;
let topo: Topo | null = null, topoCells: Uint8Array | null = null, topoKey = '', sys: YarnSys | null = null, sysKey = '';
let worker: Worker | null = null, jobId = 0, relaxStatus = '';
const status3 = (t: string) => { const el = root && $('#kg3dstatus', root); if (el) el.textContent = t; };

async function ensureView() {
  if (view) return;
  viewLoading ??= import('./view3d').then(m => {
    view = new m.KnitView($('#kg3dbox', root), {
      onPick: (loop, click) => pick3D(loop, click),
    });
    view.setLook(G.look); view.setFold(G.fold);
    if (import.meta.env.DEV) (window as unknown as { __kgview?: KnitView }).__kgview = view;
  }).catch(() => { status3('could not load the 3D view (WebGL off?)'); });
  await viewLoading;
}

function relaxWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./knit.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<RelaxPost>) => {
    const r = e.data;
    if (r.id !== jobId || !view || !sys) return;
    view.setFabric(r.pos, r.nrm);
    relaxStatus = r.done
      ? `relaxed in ${(r.ms / 1000).toFixed(1)} s (${r.iter} sweeps${r.iter >= r.max ? ', stopped at the limit' : ''}) · ${sizeText(r.pos)} · uncalibrated estimate, free, no gravity`
      : `relaxing · ${r.iter} / ${r.max} sweeps · ${(r.ms / 1000).toFixed(1)} s · ${r.sweepMs.toFixed(1)} ms a sweep`;
    if (G.m3 === 'fabric') status3(relaxStatus);
  };
  return worker;
}

/** The relaxed fabric's extent in needle pitches, next to what it was knitted on. */
function sizeText(pts: Float32Array) {
  const t = topo!;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < pts.length; k += 3) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]); }
  return `about ${(x1 - x0).toFixed(0)} × ${(y1 - y0).toFixed(0)} pitches across and up (${t.w} needles, ${t.h} passes)`;
}

/** Runs the program (from the first changed pass), builds its yarn, shows it and starts relaxing it. Nothing is
 *  rebuilt when neither the program nor the yarn changed, unless `fresh` asks to relax again from the start. */
async function show3D(fresh = false) {
  if (!G.view3d || G.mode !== 'editor' || !G.p) return;
  await ensureView();
  const p = G.p;
  if (!view || !p) return;
  if (p.w * p.h > MAX_3D) { status3(`3D shows patterns up to ${MAX_3D.toLocaleString()} cells (300 × 300); this one has ${(p.w * p.h).toLocaleString()}`); return; }
  const meaning = p.key.ops.map(o => `${o.steps.map(st => st.action + st.bed).join('+')}${o.move}`).join(',');
  const key = `${p.id}|${p.w}|${p.h}|${p.firstDir}|${G.mopts.timing}|${G.mopts.travel}|${meaning}`;
  const t0 = performance.now();
  const before = topoKey === key ? topo : null;
  topo = run(p, G.mopts, before && topoCells ? { topo: before, cells: topoCells } : undefined);
  topoCells = p.cells.slice(); topoKey = key;
  const tRun = performance.now() - t0;
  const yk = `${G.yarn.d}|${G.yarn.loop}|${G.yarn.stiff}`, programChanged = topo !== before, yarnChanged = sysKey !== yk;
  if (!programChanged && !yarnChanged && !fresh && sys) { view.setPalette(p.key); stepView(); return; }
  const t1 = performance.now();
  sys = buildYarn(topo, G.yarn); sysKey = yk;
  view.setData(sys, p.key, true);
  const tBuild = performance.now() - t1;
  G.prow = Math.max(0, Math.min(topo.h - 1, G.prow));
  stepView();
  // relax in the worker; when only the yarn changed, from the last result
  jobId++;
  const job: RelaxJob = { id: jobId, topo, prm: { ...G.yarn }, warm: !programChanged && !fresh };
  relaxWorker().postMessage(job);
  relaxStatus = 'relaxing…';
  if (G.m3 === 'fabric') status3(relaxStatus);
  (window as unknown as { __kg3d?: object }).__kg3d = { run: tRun, build: tBuild, loops: topo.n, actions: topo.na, points: sys.np, at: performance.now() };
}
function schedule3D(delay = 250) { if (!G.view3d) return; clearTimeout(v3T); v3T = window.setTimeout(() => show3D(), delay); }
function setView3D(on: boolean) {
  G.view3d = on; if (!on) stopPlay();
  refresh(); renderExperiments(); layoutStage();
  if (on) show3D(); else { baseDirty = true; draw(); }
}

/** The actions of a pass that do something (misses are skipped when stepping). */
function doing(r: number) {
  const t = topo!, out: number[] = [];
  for (let a = t.rowAct[r]; a < t.rowAct[r + 1]; a++) if (t.aType[a] !== A_MISS) out.push(a);
  return out;
}
/** The last action done at the scrubber's position. */
function actNow() { const t = topo!; if (G.pact < 0) return t.rowAct[G.prow + 1] - 1; const d = doing(G.prow); return d[Math.min(G.pact, d.length - 1)] ?? t.rowAct[G.prow + 1] - 1; }

function stepView() {
  if (!view || !topo) return;
  view.setStep(G.prow, actNow());
  if (G.m3 === 'machine') status3(machineText()); else status3(relaxStatus);
  renderPlay();
  baseDirty = false; draw();
}

function machineText() {
  const t = topo!, a = actNow(), r = G.prow;
  let onNeedles = 0;
  for (let i = t.rowLoop[0]; i < t.n; i++) if (t.act[i] <= a && t.childAct[i] > a) onNeedles++;
  return `pass ${r + 1} of ${t.h} · ${onNeedles} loops on the needles · transfers ${G.mopts.timing === 'after-row' ? 'after the pass' : 'at each needle'}${t.guides > 1 ? ` · two guides: ${G.mopts.travel === 'same-stroke' ? 'one stroke' : 'a stroke each'}` : ''} (to confirm)`;
}

function setRow(r: number) { if (!topo) return; G.prow = Math.max(0, Math.min(topo.h - 1, r)); G.pact = -1; stepView(); }
function stepAct(d: number) {
  if (!topo) return;
  const list = doing(G.prow);
  if (G.pact < 0) { if (d > 0) { G.pact = 0; } else if (G.prow > 0) { G.prow--; G.pact = doing(G.prow).length - 1; } }
  else { G.pact += d; if (G.pact >= list.length) { G.pact = -1; } else if (G.pact < 0) { if (G.prow > 0) { G.prow--; G.pact = -1; } else G.pact = 0; } }
  stepView();
}
function stopPlay() { if (G.playing) { clearInterval(G.playing); G.playing = 0; renderPlay(); } }
function togglePlay() {
  if (G.playing) { stopPlay(); return; }
  if (!topo) return;
  if (G.prow >= topo.h - 1) G.prow = -1;
  G.playing = window.setInterval(() => { if (!topo || G.prow >= topo.h - 1) { stopPlay(); return; } setRow(G.prow + 1); }, G.m3 === 'machine' ? 260 : 160);
  setRow(G.prow + 1);
}

let scrub: Bar | null = null;
function renderPlay() {
  const t = topo; if (!t || !root) return;
  $('#kgpassn', root).textContent = `pass ${G.prow + 1} ${t.strokeDir[t.aStroke[t.rowAct[G.prow]]] === 1 ? '→' : '←'}`;
  if (!scrub || scrubMax !== t.h) { scrubMax = t.h; scrub = new Bar($('#kgscrub', root), { min: 1, max: Math.max(2, t.h), step: 1, value: G.prow + 1, fmt: v => String(v), onInput: v => { stopPlay(); setRow(v - 1); } }); }
  scrub.set(G.prow + 1);
  const list = doing(G.prow);
  $('#kgactn', root).textContent = G.pact < 0 ? 'whole pass' : `action ${G.pact + 1} / ${list.length}`;
  $('#kgacttext', root).textContent = G.pact < 0 ? passText(G.p!, G.p!.h - 1 - G.prow) : actText(list[Math.min(G.pact, list.length - 1)]);
  $('#kgplaybtn', root).textContent = G.playing ? 'pause' : 'play';
}
let scrubMax = 0;

const bedText = (b: number) => (b === 1 ? 'front' : 'back');
function actText(a: number) {
  const t = topo!, p = G.p!, x = t.aNeedle[a], op = p.key.ops[p.cells[t.aCell[a]]], g = t.guides > 1 ? `YG${t.aGuide[a] + 1} · ` : '';
  if (t.aType[a] === A_XFER) { const n = t.aMovStart[a + 1] - t.aMovStart[a]; return `needle ${x + 1} ${bedText(t.aBed[a])} → needle ${t.aTo[a] + 1} ${bedText(t.aToBed[a])} · transfer moves ${n} loop${n === 1 ? '' : 's'}${n ? '' : ' (none there)'} · ${op?.name ?? ''}`; }
  const i = t.aLoop[a], k = parentsOf(t, i).length;
  if (t.aType[a] === A_KNIT) return `${g}needle ${x + 1} ${bedText(t.aBed[a])} · knit · ${t.kind[i] === EMPTY ? 'on an empty needle: nothing to draw through' : `a new loop through ${k} loop${k === 1 ? '' : 's'}, which ${k === 1 ? 'it lets' : 'it let'} go`} · ${op?.name ?? ''}`;
  if (t.aType[a] === A_TUCK) return `${g}needle ${x + 1} ${bedText(t.aBed[a])} · tuck · a new loop held with the ones there · ${op?.name ?? ''}`;
  return '';
}

/** What a loop is, for the readout. */
function loopText(i: number) {
  const t = topo!, p = G.p!, op = t.op[i] >= 0 ? p.key.ops[t.op[i]] : null, k = parentsOf(t, i).length, c = t.child[i];
  const sign = p.design?.signs[p.design.cells[t.cell[i]]];
  const made = t.kind[i] === TUCK ? 'tucked' : t.kind[i] === EMPTY ? (t.row[i] === 0 ? 'cast on' : 'knitted on an empty needle') : `knitted through ${k} loop${k === 1 ? '' : 's'}`;
  const moved = t.endNeedle[i] !== t.needle[i] || t.endBed[i] !== t.bed[i] ? ` · moved to needle ${t.endNeedle[i] + 1} ${bedText(t.endBed[i])}` : '';
  return `loop · pass ${t.row[i] + 1} · needle ${t.needle[i] + 1} ${bedText(t.bed[i])}${t.guides > 1 ? ` · YG${t.guide[i] + 1}` : ''} · ${made}${moved} · ${c >= 0 ? `knitted through in pass ${t.row[c] + 1}` : 'still on its needle at the end'} · ${sign ? `sign ${sign.letter} → ` : ''}${op ? op.name : 'unknown colour'}`;
}

function pick3D(loop: number | null, click: boolean) {
  if (!topo || !G.p) return;
  if (click) {
    G.pin = loop === null ? null : { cell: topo.cell[loop], loop };
    view?.setMark(G.pin ? G.pin.cell : -1, G.pin ? G.pin.loop : -1);
    if (G.pin) { log(`> ${loopText(G.pin.loop)}`); G.prow = topo.row[G.pin.loop]; G.pact = -1; stepView(); }
    draw();
    return;
  }
  $('#kgread', root).textContent = loop === null ? '' : loopText(loop);
  if (!G.pin) view?.setMark(-1, loop ?? -1);
}

/** The stage shared between the chart and 3D. */
function layoutStage() {
  if (!root) return;
  const st = $('#kgstage', root), split = G.view3d && st.clientWidth >= 860;
  root.dataset.split = split ? '1' : '0';
  root.style.setProperty('--k3w', `${Math.round(st.clientWidth * G.k3w)}px`);
  baseDirty = true;
}

// ---------------------------------------------------------------- import / export
async function importFile(f: File) {
  try {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      const p = fromJSON(await f.text());
      await lib.putPattern(p); await refreshLibrary(); open(p); goEditor('draw');
      return;
    }
    const px = io.unscale(await io.readPixels(f));
    const keys = [...(G.p ? [G.p.key] : []), BASIC, TWO, ...G.keys];
    const key = io.bestKey(px, keys);
    const { p, m } = io.patternFromPixels(px, key, f.name.replace(/\.[^.]+$/, ''));
    await lib.putPattern(p); await refreshLibrary(); open(p); goEditor('draw');
    const lines = m.rows.filter(r => r.op < 0 || r.dist > 0);
    log(`> read ${f.name} as ${key.name}: ${m.exact} exact · ${m.snapped} snapped · ${m.unread} unknown`);
    if (lines.length) {
      const body = `<p>Read through <b>${esc(key.name)}</b>. These colours aren't exactly in the key:</p><table class="keytable small"><tbody>${lines.slice(0, 24).map(r =>
        `<tr><td><span class="chip" style="background:${hex(r.rgb)}"></span></td><td class="num">${rgbText(r.rgb)}</td><td class="num">${r.count} px</td><td>${r.op >= 0 ? `→ ${esc(key.ops[r.op].name)} ${rgbText(key.ops[r.op].rgb)}` : '<span class="warnc">kept, flagged as unknown</span>'}</td></tr>`).join('')}</tbody></table>${lines.length > 24 ? `<p class="dim">… and ${lines.length - 24} more.</p>` : ''}<p class="dim">Snapped colours were close to one key colour and clearly nearer to it than to any other. Unknown cells are written back as they were; find them in 15 check.</p>`;
      await ask('IMPORT', 'Colours read', body, 'ok', false);
    }
  } catch (err) { log(`> could not open ${f.name}: ${(err as Error).message}`); }
}

function fileName(ext: string) { return `${($<HTMLInputElement>('#kgexname', root).value.trim() || G.p?.name || 'pattern').replace(/[\\/:*?"<>|]+/g, '_')}${ext}`; }

async function exportAs(fmt: Fmt) {
  const p = G.p; if (!p) return;
  if (fmt === 'bmp') download(io.bmpOf(p), fileName('.bmp'));
  else if (fmt === 'pdf') download(io.keyPdf(p), fileName('_key.pdf'));
  else if (fmt === 'txt') download(new Blob([io.keyTxt(p)], { type: 'text/plain' }), fileName('_key.txt'));
  else if (fmt === 'png') download(await io.chartPng(p, G.view.guides), fileName('_chart.png'));
  else if (fmt === 'svg') download(io.chartSvg(p, G.view.guides), fileName('_chart.svg'));
  else download(new Blob([toJSON(p)], { type: 'application/json' }), fileName('.json'));
  log(`> exported ${fmt.toUpperCase()}`);
}

// ---------------------------------------------------------------- portrait → knit grammar
function consumeHandoff() {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem('kpae.toGrammar'); sessionStorage.removeItem('kpae.toGrammar'); } catch { /* storage off */ }
  if (!raw) return;
  const h = JSON.parse(raw) as { name: string; w: number; h: number; cells: string };
  const cells = Uint8Array.from(atob(h.cells), c => c.charCodeAt(0));
  // one guide: a texture of two operations; two guides: the portrait in two yarns (double knit, Learn 04)
  const DEFAULTS: Record<1 | 2, [string, string]> = { 1: ['kf', 'kb'], 2: ['k2f', 'k2b'] };
  let mode: 1 | 2 = 1;
  const keyOf = () => (mode === 2 ? TWO : BASIC);
  const fill = (dlg: HTMLElement) => {
    const k = keyOf(), opts = k.ops.map((o, i) => `<option value="${i}">${esc(o.name)}</option>`).join('');
    for (const [id, opId] of [['#kgbr-ink', DEFAULTS[mode][0]], ['#kgbr-paper', DEFAULTS[mode][1]]] as const) {
      const sel = $<HTMLSelectElement>(id, dlg);
      sel.innerHTML = opts; sel.value = String(k.ops.findIndex(o => o.id === opId));
    }
    $('#kgbr-note', dlg).textContent = mode === 2
      ? 'Two yarn guides: dark blue puts YG1 on the face, light blue YG2, so the portrait shows in two yarns (double knitting, see Learn 04).'
      : 'One yarn guide: the portrait becomes a texture, for example knit front against knit back.';
  };
  const body = `<p>The portrait is ${h.w} × ${h.h}: one stitch per needle and pass. Choose the key and what its two colours do.</p>
    <div class="row"><label>yarn guides</label><div class="seg" id="kgbr-mode"><button data-m="1" class="on">one</button><button data-m="2">two</button></div></div>
    <div class="row"><label>ink</label><select class="txt" id="kgbr-ink"></select></div>
    <div class="row"><label>paper</label><select class="txt" id="kgbr-paper"></select></div>
    <p class="small dim" id="kgbr-note"></p>`;
  ask('PORTRAIT → KNIT GRAMMAR', 'Map the two colours', body, 'make pattern', true, dlg => {
    fill(dlg);
    seg($('#kgbr-mode', dlg), b => { mode = +b.dataset.m! as 1 | 2; fill(dlg); });
  }).then(async ok => {
    if (!ok) return;
    const k = keyOf(), ink = +$<HTMLSelectElement>('#kgbr-ink', root).value, paper = +$<HTMLSelectElement>('#kgbr-paper', root).value;
    const p = await newPattern(mode, { name: h.name, w: h.w, h: h.h, cells: cells.map(v => (v === 0 ? ink : paper)) });
    log(`> "${p.name}" made from the portrait: ink → ${k.ops[ink].name}, paper → ${k.ops[paper].name}`);
    goEditor('draw');
  });
}

// ---------------------------------------------------------------- dialog
function ask(kicker: string, title: string, bodyHtml: string, okText: string, cancel = true, prep?: (dlg: HTMLElement) => void): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('#kgdlg', root);
  $('#kgdlgkicker', dlg).textContent = kicker;
  $('#kgdlgtitle', dlg).textContent = title;
  $('#kgdlgbody', dlg).innerHTML = bodyHtml;
  $('#kgdlgok', dlg).textContent = okText;
  ($('button[value=cancel]', dlg) as HTMLButtonElement).hidden = !cancel;
  prep?.(dlg);
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(res => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
}

// ---------------------------------------------------------------- panels
function renderLibrary() {
  const box = root && $('#kglib', root);
  if (!box) return;
  box.innerHTML = G.list.length ? G.list.map(p => `<div class="lrow${p.id === G.p?.id ? ' sel' : ''}" data-pid="${p.id}" tabindex="0"><span class="lnum">${p.key.mode === 2 ? '2YG' : '1YG'}${p.design ? ' G' : '  '}</span><span class="left">${esc(p.name)}</span><span class="right">${p.w}×${p.h}</span></div>`).join('')
    : '<div class="empty small">No patterns yet. Start one, open a BMP, or try an experiment.</div>';
}

function syncPattern() {
  const p = G.p; if (!p) return;
  $<HTMLInputElement>('#kgname', root).value = p.name;
  $<HTMLInputElement>('#kgw', root).value = String(p.w);
  $<HTMLInputElement>('#kgh', root).value = String(p.h);
  $<HTMLTextAreaElement>('#kgnote', root).value = p.note ?? '';
  $<HTMLInputElement>('#kgexname', root).value = p.name;
  renderKey();
  renderGrammar();
}

function renderKey() {
  const p = G.p; if (!p) return;
  const k = p.key, used = io.usage(p);
  $('#kgkeynote', root).innerHTML = `<b class="hi">${esc(k.name)}</b> · ${k.mode === 2 ? 'two yarn guides' : 'one yarn guide'} · ${k.preset ? 'class preset, read-only' : 'custom key'}`;
  $('#kgops', root).innerHTML = k.ops.map((o, i) => `
    <div class="oprow${i === G.ed.op ? ' on' : ''}" data-op="${i}">
      <button class="optile" data-pickop="${i}" title="draw with ${esc(o.name)} (${i + 1 <= 9 ? i + 1 : ''})"><canvas data-tile="${i}"></canvas></button>
      <div class="opmain">${k.preset ? `<button class="opname" data-pickop="${i}">${esc(o.name)}</button>` : `<input class="txt opname" data-rename="${i}" value="${esc(o.name)}" aria-label="operation name">`}
        <div class="small dim">${o.colour} ${rgbText(o.rgb)} · ${used.get(i) ?? 0} cells${o.provisional ? ' · <span class="warnc">provisional</span>' : ''}</div></div>
      <div class="opside">${k.preset ? '' : `<span class="sw" style="background:${hex(o.rgb)}"><input type="color" data-recolour="${i}" value="${hex(o.rgb)}" aria-label="colour of ${esc(o.name)}"></span><button class="btn x" data-delop="${i}" title="remove this operation">×</button>`}<a class="dim" href="#grammar/learn/${learnPageOf(o).replace('#', '/')}" title="learn about it">?</a></div>
    </div>`).join('');
  $$<HTMLCanvasElement>('canvas[data-tile]', root).forEach(c => paintOpTile(c, k.ops[+c.dataset.tile!], 24));
  $('#kgcredit', root).innerHTML = [k.credit, ...(k.notes ?? [])].filter(Boolean).map(t => esc(t!)).join('<br>');
  $('#kgcustom', root).innerHTML = k.preset
    ? '<div class="inline"><button class="btn" id="kgcopykey">make a custom copy</button></div>'
    : `<div class="subhead">ADD AN OPERATION<i></i></div>${k.mode === 1
      ? `<div class="row"><label>action</label><div class="seg" id="kgb-a"><button data-v="knit" class="on">knit</button><button data-v="tuck">tuck</button><button data-v="float">float</button></div></div>
         <div class="row"><label>bed</label><div class="seg" id="kgb-b"><button data-v="front" class="on">front</button><button data-v="back">back</button></div></div>
         <div class="row"><label>then</label><div class="seg" id="kgb-m"><button data-v="none" class="on">nothing</button><button data-v="across">to other bed</button><button data-v="left">left</button><button data-v="right">right</button></div></div>`
      : `<div class="row"><label>YG1</label><div class="seg" id="kgb-a"><button data-v="knit" class="on">knit</button><button data-v="tuck">tuck</button><button data-v="float">float</button></div></div>
         <div class="row"><label>YG1 bed</label><div class="seg" id="kgb-b"><button data-v="front" class="on">front</button><button data-v="back">back</button></div></div>
         <div class="row"><label>YG2 (other bed)</label><div class="seg" id="kgb-a2"><button data-v="knit">knit</button><button data-v="tuck" class="on">tuck</button><button data-v="float">float</button></div></div>`}
      <div class="row"><label>colour</label><div class="val swrow"><span class="sw" style="background:#7a5cff"><input type="color" id="kgb-c" value="#7a5cff" aria-label="new operation colour"></span><span class="dim small" id="kgb-name"></span></div></div>
      <div class="inline"><button class="btn primary" id="kgb-add">add operation</button></div>
      <div class="inline"><button class="btn" id="kgsavekey">save key for other patterns</button></div>`;
  $$<HTMLElement>('#kgcustom .seg', root).forEach(s => seg(s, () => builderName()));
  builderName();
  $('#kgkeys', root).innerHTML = [...PRESETS, ...G.keys].map(kk => `<div class="lrow${kk.id === k.id ? ' sel' : ''}" data-readas="${kk.id}" tabindex="0"><span class="lnum">${kk.mode === 2 ? '2YG' : '1YG'}</span><span class="left">${esc(kk.name)}</span><span class="right">${kk.preset ? 'preset' : 'custom'}</span></div>`).join('');
}

function builderSteps(): { steps: Step[]; move: Move } | null {
  const v = (id: string) => $(`#${id} button.on`, root)?.dataset.v;
  const a = v('kgb-a') as Action, b = v('kgb-b') as Bed;
  if (!a) return null;
  if (G.p!.key.mode === 1) return { steps: [{ action: a, bed: b }], move: (v('kgb-m') ?? 'none') as Move };
  const a2 = v('kgb-a2') as Action;
  return { steps: [{ action: a, bed: b }, { action: a2, bed: b === 'front' ? 'back' : 'front' }], move: 'none' };
}
function builderName() { const s = G.p && !G.p.key.preset && builderSteps(); const el = root && $('#kgb-name', root); if (el) el.textContent = s ? autoName(s.steps, s.move) : ''; }

function renderChecks() {
  const box = root && $('#kgfind', root);
  if (!box) return;
  for (const k of ['float', 'held', 'tucks'] as const) $(`[data-kbind="lim-${k}"]`, root).textContent = String(G.limits[k]);
  box.innerHTML = !G.p ? '' : G.findings.length ? G.findings.map(f => `<div class="finding"><div class="inline"><b class="warnc">${esc(f.title)}</b><span class="dim small">${f.cells.length} cells</span><button class="check${G.marks === f.id ? ' on' : ''}" data-mark="${f.id}"><span class="box">${G.marks === f.id ? '[x]' : '[ ]'}</span> show</button></div><div class="small dim">${esc(f.text)}</div></div>`).join('')
    : '<div class="okline small">Nothing to flag with these limits.</div>';
}

// ---------------------------------------------------------------- refresh
function refresh() {
  if (!root) return;
  const p = G.p, ed = ED(), P = PL();
  root.dataset.mode = G.mode;
  root.dataset.v3 = G.view3d ? '1' : '0';
  root.classList.toggle('noproject', !p);
  setSeg($('#kgmode', root), b => b.dataset.mode === G.mode);
  $$('[data-learn]', root).forEach(r => r.classList.toggle('sel', G.mode === 'learn' && r.dataset.learn === G.page));
  $$('[data-kstep]', root).forEach(r => r.classList.toggle('sel', G.mode === 'editor' && r.dataset.kstep === G.step));
  $$('[data-kpanel]', root).forEach(s => s.classList.toggle('on', s.dataset.kpanel === G.step));
  const bind = (k: string, t: string) => $$(`[data-kbind="${k}"]`, root).forEach(e => (e.textContent = t));
  bind('experiments', p?.exp ? EXPERIMENTS.find(e => e.id === p.exp)?.title.toLowerCase() ?? '' : String(EXPERIMENTS.length));
  bind('library', String(G.list.length || ''));
  bind('pattern', p ? `${p.w} × ${p.h}` : '—');
  bind('key', p ? (p.key.preset ? (p.key.mode === 2 ? 'two guides' : 'basic') : 'custom') : '');
  bind('grammar', p?.design ? `${p.design.signs.length} signs${p.design.live ? '' : ' · manual'}` : '—');
  bind('draw', `${ed.tool}${G.dp ? ` · ${onSigns() ? 'signs' : 'knit'}` : ''}`);
  bind('layer', onSigns() ? 'signs: the design' : 'knit: the program');
  bind('view', G.view3d ? `3D · ${G.m3}` : [G.view.symbols && 'symbols', G.view.guides && p?.key.mode === 2 && 'guides'].filter(Boolean).join(' + ') || 'colour');
  bind('check', p ? (G.findings.length ? `${G.findings.length} flag${G.findings.length > 1 ? 's' : ''}` : 'ok') : '');
  bind('export', G.fmt);
  bind('mode', p ? (p.key.mode === 2 ? 'two (fixed for this pattern)' : 'one (fixed for this pattern)') : '—');
  const op = P?.key.ops[ed.op];
  bind('opname', op ? (op.letter ? `sign ${op.letter} · ${op.name}` : `${op.name} ${rgbText(op.rgb)}`) : '—');
  bind('sel', ed.sel ? `${ed.sel.w} × ${ed.sel.h} at needle ${ed.sel.x + 1}, pass ${p ? passOf(p, ed.sel.y + ed.sel.h - 1) : ''}` : 'none');
  const chip = $('#kgop', root);
  if (op) { ($('.sw', chip) as HTMLElement).style.background = hex(op.rgb); $('.t', chip).textContent = op.letter ? `${op.letter} · ${op.name}` : op.name; }
  setSeg($('#kglayer', root), b => b.dataset.layer === (onSigns() ? 'signs' : 'ops'));
  $<HTMLButtonElement>('#kglayer [data-layer=signs]', root).classList.toggle('faintbtn', !G.dp);
  for (const id of ['#kg3dseg', '#kg3dseg2']) setSeg($(id, root), b => +b.dataset.v3! === +G.view3d);
  for (const id of ['#kglook', '#kglook2']) setSeg($(id, root), b => b.dataset.look === G.look);
  for (const id of ['#kgm3d', '#kgm3d2']) setSeg($(id, root), b => b.dataset.m3 === G.m3);
  setSeg($('#kgtiming', root), b => b.dataset.timing === G.mopts.timing);
  setSeg($('#kgtravel', root), b => b.dataset.travel === G.mopts.travel);
  root.dataset.m3 = G.m3;
  $$('[data-ktool]', root).forEach(b => b.classList.toggle('on', b.dataset.ktool === ed.tool));
  $$('.tb-motif', root).forEach(e => (e.hidden = ed.tool !== 'motif'));
  for (const id of ['#kgmirror', '#kgmirror2']) setCheck($(id, root), ed.mirror);
  for (const id of ['#kgsym', '#kgsym2']) setCheck($(id, root), G.view.symbols);
  for (const id of ['#kggrid', '#kggrid2']) setCheck($(id, root), G.view.grid);
  setCheck($('#kgguides', root), G.view.guides);
  ($('#kgguides', root) as HTMLButtonElement).disabled = p?.key.mode !== 2;
  setCheck($('#kgnums', root), G.view.numbers);
  setSeg($('#kgevery', root), b => +b.dataset.every! === ed.every);
  setSeg($('#kgrepmode', root), b => b.dataset.rep === G.rep);
  setSeg($('#kgfmt', root), b => b.dataset.fmt === G.fmt);
  if (p) setSeg($('#kgdir', root), b => +b.dataset.dir! === p.firstDir);
  $('#kgshift', root).textContent = String(G.shift);
  ($('#kgundo', root) as HTMLButtonElement).disabled = !G.ed.canUndo;
  ($('#kgredo', root) as HTMLButtonElement).disabled = !G.ed.canRedo;
  $$('.oprow[data-op]', root).forEach(r => r.classList.toggle('on', !onSigns() && +r.dataset.op! === G.ed.op));
  if (!G.hover) readout(null);
}

// ---------------------------------------------------------------- wiring
function wire() {
  wireCanvas();
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const learn = t.closest<HTMLElement>('[data-learn]'); if (learn) { goLearn(learn.dataset.learn!); return; }
    const st = t.closest<HTMLElement>('[data-kstep]'); if (st) { goEditor(st.dataset.kstep as Step_); return; }
    const sg = t.closest<HTMLElement>('[data-kstepgo]'); if (sg) { goEditor(sg.dataset.kstepgo as Step_); return; }
    const pid = t.closest<HTMLElement>('[data-pid]'); if (pid) { const p = G.list.find(x => x.id === pid.dataset.pid); if (p) { open(p); goEditor('draw'); } return; }
    const ex = t.closest<HTMLElement>('[data-startexp]'); if (ex) { startExperiment(ex.dataset.startexp!, !!ex.dataset.fresh); return; }
    const v3go = t.closest<HTMLElement>('[data-v3go]'); if (v3go) { setView3D(v3go.dataset.v3go === '1'); return; }
    const pick = t.closest<HTMLElement>('[data-pickop]'); if (pick) { G.layer = 'ops'; setOp(+pick.dataset.pickop!); baseDirty = true; draw(); return; }
    const psign = t.closest<HTMLElement>('[data-picksign]'); if (psign) { G.layer = 'signs'; G.ded.op = +psign.dataset.picksign!; baseDirty = true; refresh(); renderGrammarSel(); draw(); return; }
    const del = t.closest<HTMLElement>('[data-delop]'); if (del) { deleteOp(+del.dataset.delop!); return; }
    const dsign = t.closest<HTMLElement>('[data-delsign]'); if (dsign) { deleteSign(+dsign.dataset.delsign!); return; }
    const dstruct = t.closest<HTMLElement>('[data-delstruct]'); if (dstruct) { deleteStructure(dstruct.dataset.delstruct!); return; }
    const ra = t.closest<HTMLElement>('[data-readas]'); if (ra) { readAs(ra.dataset.readas!); return; }
    const mk = t.closest<HTMLElement>('[data-mark]'); if (mk) { G.marks = G.marks === mk.dataset.mark ? null : mk.dataset.mark!; renderChecks(); if (G.marks) { G.layer = 'ops'; if (G.view3d) setView3D(false); goEditor('check'); } draw(); return; }
    const nw = t.closest<HTMLElement>('[data-knew]'); if (nw) { newPattern(+nw.dataset.knew! as 1 | 2).then(() => goEditor('draw')); return; }
    if (t.closest('[data-kopen]')) { $<HTMLInputElement>('#kgfile', root).click(); return; }
    if (t.closest('#kgcopykey')) { copyKey(); return; }
    if (t.closest('#kgb-add')) { addOp(); return; }
    if (t.closest('#kgsavekey')) { saveKey(); return; }
    if (t.closest('#kgstartgram')) { startGrammar(); return; }
    if (t.closest('#kglive')) { const d = G.p?.design; if (d) { d.live = !d.live; if (d.live) regen(); renderGrammar(); changed(); log(d.live ? '> live: the program follows the signs again' : '> live off: the program keeps your hand edits'); } return; }
    if (t.closest('#kgregen')) { if (G.p?.design) { regen(); changed(); log('> program rewritten from the signs'); } return; }
    if (t.closest('#kgdropgram')) { dropGrammar(); return; }
    if (t.closest('#kgaddsign')) { addSign(); return; }
    if (t.closest('#kgsavestruct')) { saveStructure(); return; }
    if (t.closest('.homelink')) { e.preventDefault(); location.hash = ''; }
  });
  root.addEventListener('keydown', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.lrow'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement, d = G.p?.design;
    if (t.dataset.recolour && G.p) { G.p.key.ops[+t.dataset.recolour].rgb = fromHex(t.value); (t.parentElement as HTMLElement).style.background = t.value; tiles.bump(); changed(); renderKeySoon(); view?.setPalette(G.p.key); }
    else if (t.id === 'kgb-c') (t.parentElement as HTMLElement).style.background = t.value;
    else if (t.dataset.rename && G.p) { G.p.key.ops[+t.dataset.rename].name = t.value; scheduleSave(); refresh(); }
    else if (t.dataset.signname && d) { d.signs[+t.dataset.signname].name = t.value; syncDesign(); scheduleSave(); refresh(); }
    else if (t.dataset.signcolour && d) {
      d.signs[+t.dataset.signcolour].rgb = fromHex(t.value); (t.parentElement as HTMLElement).style.background = t.value;
      syncDesign(); tiles.bump(); baseDirty = true; scheduleSave(); draw();
      const c = $<HTMLCanvasElement>(`canvas[data-signtile="${t.dataset.signcolour}"]`, root); if (c && G.dp) paintOpTile(c, G.dp.key.ops[+t.dataset.signcolour], 30);
    }
  });
  root.addEventListener('change', e => {
    const t = e.target as HTMLSelectElement, d = G.p?.design;
    if (!d) return;
    if (t.dataset.signfill) { const s = d.signs[+t.dataset.signfill], v = t.value; changeGrammar(() => { s.fill = v; }, `sign ${s.letter} is knitted as ${structuresFor(G.p!).find(x => x.id === v)?.name}`); }
    else if (t.dataset.signedge !== undefined && t.dataset.signedge !== '') { const s = d.signs[+t.dataset.signedge], v = t.value || null; changeGrammar(() => { s.edge = v; }, v ? `sign ${s.letter}'s outline is ${structuresFor(G.p!).find(x => x.id === v)?.name}` : `sign ${s.letter} has no outline`); }
  });
  seg($('#kgmode', root), b => (b.dataset.mode === 'learn' ? goLearn(G.page) : goEditor()));
  seg($('#kglayer', root), b => setLayer(b.dataset.layer as 'ops' | 'signs'));
  for (const id of ['#kg3dseg', '#kg3dseg2']) seg($(id, root), b => setView3D(b.dataset.v3 === '1'));
  for (const id of ['#kglook', '#kglook2']) seg($(id, root), b => { G.look = b.dataset.look as Look; refresh(); view?.setLook(G.look); });
  for (const id of ['#kgm3d', '#kgm3d2']) seg($(id, root), b => { G.m3 = b.dataset.m3 as Mode; refresh(); view?.setMode(G.m3); stepView(); });
  $('#kgrelax', root).addEventListener('click', () => show3D(true));
  $('#kgflip', root).addEventListener('click', () => view?.flip());
  new Bar($('#kgfold', root), { min: 0, max: 1, step: 0.01, value: G.fold, fmt: () => '', onInput: v => { G.fold = v; view?.setFold(v); } });
  const yarnBars: [string, keyof YarnParams, number][] = [['#bar-thick', 'd', 0.01], ['#bar-loop', 'loop', 0.1], ['#bar-stiff', 'stiff', 0.05]];
  for (const [id, k, step] of yarnBars) new Bar($(id, root), { min: YARN_RANGES[k][0], max: YARN_RANGES[k][1], step, value: G.yarn[k], fmt: v => (k === 'stiff' ? v.toFixed(2) : `${v.toFixed(2)} pitch`), onInput: v => { G.yarn[k] = v; schedule3D(350); } });
  seg($('#kgtiming', root), b => { G.mopts = { ...G.mopts, timing: b.dataset.timing as MachineOpts['timing'] }; refresh(); schedule3D(0); log(`> transfers ${G.mopts.timing === 'after-row' ? 'after the whole pass has knitted' : 'right after each needle'} (to confirm with the lab's script)`); });
  seg($('#kgtravel', root), b => { G.mopts = { ...G.mopts, travel: b.dataset.travel as MachineOpts['travel'] }; refresh(); schedule3D(0); log(`> two guides: ${G.mopts.travel === 'same-stroke' ? 'one carriage stroke, YG1 first' : 'one stroke each, each guide alternating its own direction'} (to confirm)`); });
  $$<HTMLButtonElement>('[data-pstep]', root).forEach(b => b.addEventListener('click', () => { stopPlay(); setRow(G.prow + +b.dataset.pstep!); }));
  $$<HTMLButtonElement>('[data-astep]', root).forEach(b => b.addEventListener('click', () => { stopPlay(); stepAct(+b.dataset.astep!); }));
  $('#kgplaybtn', root).addEventListener('click', togglePlay);
  // the divider between the chart and 3D
  const sp = $('#kgsplit', root);
  sp.addEventListener('pointerdown', e => {
    sp.setPointerCapture(e.pointerId);
    const st = $('#kgstage', root).getBoundingClientRect();
    const mv = (ev: PointerEvent) => { G.k3w = Math.max(0.25, Math.min(0.75, (st.right - ev.clientX) / st.width)); layoutStage(); draw(); };
    const up = () => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); };
    sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
  });
  $$('[data-ktool]', root).forEach(b => b.addEventListener('click', () => setTool(b.dataset.ktool as GTool)));
  $('#kgop', root).addEventListener('click', () => goEditor(onSigns() ? 'grammar' : 'key'));
  for (const id of ['#kgsym', '#kgsym2']) check($(id, root), on => { G.view.symbols = on; baseDirty = true; refresh(); draw(); });
  for (const id of ['#kggrid', '#kggrid2']) check($(id, root), on => { G.view.grid = on; baseDirty = true; refresh(); draw(); });
  for (const id of ['#kgmirror', '#kgmirror2']) check($(id, root), on => setMirror(on));
  check($('#kgguides', root), on => { G.view.guides = on; G.zoom = 0; baseDirty = true; refresh(); draw(); });
  check($('#kgnums', root), on => { G.view.numbers = on; baseDirty = true; refresh(); draw(); });
  $$<HTMLButtonElement>('[data-kzoom]', root).forEach(b => b.addEventListener('click', () => zoomBy(+b.dataset.kzoom!)));
  $$<HTMLButtonElement>('[data-ksel]', root).forEach(b => b.addEventListener('click', () => selAct(b.dataset.ksel!)));
  seg($('#kgevery', root), b => { G.ed.every = G.ded.every = +b.dataset.every!; refresh(); });
  seg($('#kgrepmode', root), b => { G.rep = b.dataset.rep as RepeatMode; });
  $$<HTMLButtonElement>('[data-kshift]', root).forEach(b => b.addEventListener('click', () => { G.shift = Math.max(-32, Math.min(32, G.shift + +b.dataset.kshift!)); refresh(); }));
  $$<HTMLButtonElement>('[data-klim]', root).forEach(b => b.addEventListener('click', () => {
    const [k, d] = b.dataset.klim!.split(':') as [keyof Limits, string];
    G.limits[k] = Math.max(1, Math.min(99, G.limits[k] + +d)); recheck(); refresh(); draw();
  }));
  seg($('#kgfmt', root), b => { G.fmt = b.dataset.fmt as Fmt; refresh(); });
  $('#kgexport', root).addEventListener('click', () => exportAs(G.fmt));
  $('#kgbundle', root).addEventListener('click', async () => { await exportAs('bmp'); await exportAs('pdf'); await exportAs('txt'); log('> exported BMP + key PDF + key TXT'); });
  $('#kgundo', root).addEventListener('click', undo);
  $('#kgredo', root).addEventListener('click', redo);
  $('#kghelp', root).addEventListener('click', e => { const on = document.body.classList.toggle('help'); (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on)); });
  // pattern panel
  $<HTMLInputElement>('#kgname', root).addEventListener('change', e => { if (!G.p) return; G.p.name = (e.target as HTMLInputElement).value.trim() || 'untitled'; $<HTMLInputElement>('#kgexname', root).value = G.p.name; scheduleSave(); });
  $<HTMLTextAreaElement>('#kgnote', root).addEventListener('input', e => { if (!G.p) return; G.p.note = (e.target as HTMLTextAreaElement).value; scheduleSave(); });
  $('#kgresize', root).addEventListener('click', () => resizeTo(+$<HTMLInputElement>('#kgw', root).value, +$<HTMLInputElement>('#kgh', root).value));
  seg($('#kgsizes', root), b => { const n = +b.textContent!; resizeTo(n, n); setSeg($('#kgsizes', root), () => false); });
  seg($('#kgdir', root), b => { if (!G.p) return; G.p.firstDir = +b.dataset.dir! as 1 | -1; baseDirty = true; scheduleSave(); draw(); });
  // library
  $('#kgdup', root).addEventListener('click', async () => { if (!G.p) return; const p = structuredClone(G.p); p.id = newId(); p.name += ' copy'; p.created = p.updated = Date.now(); await lib.putPattern(p); await refreshLibrary(); open(p); });
  $('#kgdel', root).addEventListener('click', async () => {
    const p = G.p; if (!p) return;
    if (!(await ask('09 · LIBRARY', `Delete "${p.name}"?`, '<p>It is removed from this browser. Export it first if you want to keep it.</p>', 'delete'))) return;
    await lib.deletePattern(p.id); G.p = null; G.dp = null; await refreshLibrary();
    if (G.list[0]) open(G.list[0]); else { refresh(); draw(); renderGrammar(); renderExperiments(); }
    log(`> deleted "${p.name}"`);
  });
  const file = $<HTMLInputElement>('#kgfile', root);
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) importFile(f); file.value = ''; });
  // drop files anywhere while the editor is open
  window.addEventListener('dragover', e => { if (isActive() && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { if (!isActive() || !e.dataTransfer?.files.length) return; e.preventDefault(); importFile(e.dataTransfer.files[0]); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (isActive()) { layoutStage(); baseDirty = true; draw(); } });
}

let keyT = 0;
function renderKeySoon() { clearTimeout(keyT); keyT = window.setTimeout(renderKey, 250); }

function onKey(e: KeyboardEvent) {
  if (!isActive() || G.mode !== 'editor' || !G.p) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, dialog') || e.altKey) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), ed = ED();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); setTool('motif'); ed.selectAll(); refresh(); draw(); return; }
  if (mod) return;
  if (k === 'tab' && G.dp) { e.preventDefault(); setLayer(onSigns() ? 'ops' : 'signs'); return; }
  const arrow = ({ arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] } as Record<string, number[]>)[k];
  if (arrow && ed.sel) { e.preventDefault(); const n = e.shiftKey ? 5 : 1; beforeEdit(); ed.nudge(arrow[0] * n, arrow[1] * n); edited(); return; }
  if (/^[1-9]$/.test(k)) { setOp(+k - 1); return; }
  const act: Record<string, () => void> = {
    n: () => setTool('needle'), l: () => setTool('run'), g: () => setTool('flood'), p: () => setTool('pass'), w: () => setTool('wale'), s: () => setTool('motif'), i: () => setTool('pick'),
    m: () => setMirror(!ed.mirror), h: () => selAct('flip-h'), v: () => selAct('flip-v'), r: () => selAct('repeat'), d: () => setView3D(!G.view3d),
    ',': () => { if (G.view3d) { stopPlay(); setRow(G.prow - 1); } }, '.': () => { if (G.view3d) { stopPlay(); setRow(G.prow + 1); } },
    '<': () => { if (G.view3d) { stopPlay(); stepAct(-1); } }, '>': () => { if (G.view3d) { stopPlay(); stepAct(1); } },
    delete: () => selAct('clear'), backspace: () => selAct('clear'), escape: () => selAct('drop'),
    '[': () => setOp(ed.op - 1), ']': () => setOp(ed.op + 1), '+': () => zoomBy(1), '=': () => zoomBy(1), '-': () => zoomBy(-1), '0': () => zoomBy(0),
  };
  if ((k === 'escape' || k === 'delete' || k === 'backspace') && !ed.sel) return;
  if (act[k]) { e.preventDefault(); act[k](); }
}

// ---------------------------------------------------------------- grammar editing
function addSign() {
  const p = G.p, d = p?.design; if (!p || !d || d.signs.length >= MAX_SIGNS) return;
  const i = d.signs.length, fill = NEXT_FILL[p.key.mode][i] ?? NEXT_FILL[p.key.mode][0];
  changeGrammar(() => d.signs.push(newSign(i, fill)), `sign ${String.fromCharCode(65 + i)} added · draw with it on the signs layer`);
  G.layer = 'signs'; G.ded.op = i; refresh(); renderGrammarSel(); baseDirty = true; draw();
}

async function deleteSign(i: number) {
  const p = G.p, d = p?.design; if (!p || !d || d.signs.length <= 1) return;
  const n = d.cells.reduce((s, v) => s + (v === i ? 1 : 0), 0);
  if (n && !(await ask('12 · GRAMMAR', `Remove sign ${d.signs[i].letter}?`, `<p>${n} cells use it; they become sign ${d.signs[i === 0 ? 1 : 0].letter}.</p>`, 'remove'))) return;
  changeGrammar(() => {
    d.cells = d.cells.map(v => (v === i ? 0 : v > i ? v - 1 : v)); // its cells go to the first remaining sign
    d.signs.splice(i, 1);
    d.signs.forEach((s, k) => (s.letter = String.fromCharCode(65 + k)));
  }, 'sign removed');
}

async function deleteStructure(id: string) {
  const p = G.p, d = p?.design; if (!p || !d) return;
  const fallback = structuresFor(p)[0].id;
  changeGrammar(() => {
    d.custom = d.custom.filter(s => s.id !== id);
    d.signs.forEach(s => { if (s.fill === id) s.fill = fallback; if (s.edge === id) s.edge = null; });
  }, 'structure removed');
}

async function dropGrammar() {
  const p = G.p; if (!p?.design) return;
  if (!(await ask('12 · GRAMMAR', 'Remove the grammar?', '<p>The signs go; the knit program stays as it is now. Undo brings the grammar back.</p>', 'remove'))) return;
  G.ed.whole(() => { delete p.design; });
  syncDesign(); G.layer = 'ops'; renderGrammar(); changed();
}

// ---------------------------------------------------------------- key editing
function copyKey() {
  const p = G.p; if (!p) return;
  G.ed.whole(() => { p.key = { ...cloneKey(p.key), id: `custom-${newId()}`, name: `my key (from ${p.key.name})`, preset: undefined }; });
  tiles.bump(); syncPattern(); changed();
  log('> the pattern has its own key now · rename, recolour or add operations');
}

function addOp() {
  const p = G.p, s = builderSteps(); if (!p || !s) return;
  const rgb = fromHex($<HTMLInputElement>('#kgb-c', root).value);
  if (p.key.ops.some(o => o.rgb.every((v, i) => v === rgb[i]))) { log('> another operation already has that colour · pick a different one'); return; }
  const op: Op = { id: `op-${newId()}`, name: autoName(s.steps, s.move), colour: hex(rgb), rgb, steps: s.steps, move: s.move };
  G.ed.whole(() => p.key.ops.push(op));
  syncPattern(); changed();
  G.layer = 'ops'; setOp(p.key.ops.length - 1);
}

async function deleteOp(i: number) {
  const p = G.p; if (!p || p.key.ops.length <= 1) return;
  const n = io.usage(p).get(i) ?? 0, fl = floatIndex(p.key);
  if (n && !(await ask('11 · KEY', `Remove "${p.key.ops[i].name}"?`, `<p>${n} cells use it; they become ${esc(p.key.ops[fl === i ? 0 : fl].name)}.</p>`, 'remove'))) return;
  G.ed.whole(() => {
    const to = fl === i ? 0 : fl;
    p.cells = p.cells.map(v => (v === i ? to : v)).map(v => (v < UNKNOWN && v > i ? v - 1 : v));
    p.key.ops.splice(i, 1);
  });
  tiles.bump(); syncPattern(); changed();
}

async function saveKey() {
  const p = G.p; if (!p || p.key.preset) return;
  const k = structuredClone(p.key);
  await lib.putKey(k);
  G.keys = await lib.listKeys();
  renderKey();
  log(`> "${k.name}" saved · use it from "read as" in any pattern`);
}

async function readAs(id: string) {
  const p = G.p; if (!p) return;
  const k = [...PRESETS, ...G.keys].find(x => x.id === id);
  if (!k || k.id === p.key.id) return;
  const r = io.rekey(p, k), lost = r.cells.filter(v => v >= UNKNOWN).length;
  const modeNote = k.mode !== p.key.mode ? `<p class="warnc">This changes the pattern from ${p.key.mode === 2 ? 'two yarn guides to one' : 'one yarn guide to two'}: the same colours will mean different operations.</p>` : '';
  if (!(await ask('11 · KEY', `Read as "${k.name}"?`, `${modeNote}<p>${lost ? `${lost} cells have colours this key doesn't have; they are kept and flagged as unknown.` : 'Every colour of the pattern is in this key.'}</p>`, 'read as'))) return;
  G.ed.whole(() => { p.key = k.preset ? { ...cloneKey(k), preset: true } : structuredClone(k); p.cells = r.cells; p.unknown = r.unknown; });
  tiles.bump(); G.view.guides = G.view.guides && p.key.mode === 2; syncDesign(); syncPattern(); changed();
}

export { STEPS };
