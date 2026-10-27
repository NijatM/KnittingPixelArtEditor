// Knit Grammar: Learn pages and the editor. Built into #kg the first time the section opens; routed by app.ts
// with the part of the hash after "#grammar" ("learn/needle", "editor/key", …).
import { SHELL } from './ui';
import { MINIS, PAGES, SOURCES } from './learn';
import { BASIC, PRESETS, TWO, autoName, cloneKey, fromHex, glyphOf, hex, learnPageOf, rgbText, type Action, type Bed, type Key, type Move, type Op, type Step } from './ops';
import { createPattern, dirOf, floatIndex, fromJSON, newId, passOf, resized, toJSON, UNKNOWN, MAX_SIDE, type Pattern } from './pattern';
import { GEditor, type GTool, type RepeatMode } from './editor';
import { cellAt, drawOverlay, drawPattern, layout, paintGlyph, Tiles, type ViewOpts } from './render';
import { DEFAULT_LIMITS, runChecks, type Finding, type Limits } from './checks';
import * as io from './io';
import * as lib from './library';
import { mountFigure, type FigureMount } from '../hl';
import { latchNeedle, needleBed, racking } from './figures';
import { download } from '../export';
import { $, $$, check, setCheck, seg, setSeg } from '../ui/controls';

type Step_ = 'library' | 'pattern' | 'key' | 'draw' | 'view' | 'check' | 'export';
type Fmt = 'bmp' | 'pdf' | 'txt' | 'png' | 'svg' | 'json';

const FIGS: Record<string, FigureMount> = { needleBed, latchNeedle, racking };
const STEPS: Step_[] = ['library', 'pattern', 'key', 'draw', 'view', 'check', 'export'];

let root: HTMLElement;
const G = {
  mode: 'learn' as 'learn' | 'editor',
  page: PAGES[0].id,
  step: 'library' as Step_,
  p: null as Pattern | null,
  ed: new GEditor(createPattern()),
  view: { symbols: true, guides: false, grid: true, numbers: true },
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

// ---------------------------------------------------------------- routing
export function init(el: HTMLElement) {
  root = el;
  root.innerHTML = SHELL;
  wire();
  lib.listKeys().then(k => { G.keys = k; }).catch(() => {});
  refreshLibrary().then(async () => {
    const last = await lib.getMeta<string>('last').catch(() => undefined);
    const p = (last && G.list.find(x => x.id === last)) || G.list[0];
    if (p && !G.p) open(p, false);
  });
}

/** Shows the part of the section a hash names: "learn/<page>[/<anchor>]" or "editor/<step>". */
export function route(sub: string) {
  const [area, a, b] = sub.replace(/#/g, '/').split('/').filter(Boolean);
  if (area === 'editor') { G.mode = 'editor'; if (STEPS.includes(a as Step_)) G.step = a as Step_; }
  else if (area === 'learn' || !area) {
    if (!area && G.list.length && !sub) { G.mode = 'editor'; }
    else { G.mode = 'learn'; if (a && PAGES.some(p => p.id === a)) G.page = a; }
  }
  root.dataset.mode = G.mode;
  if (G.mode === 'learn') renderLearn(G.page, b);
  else { disposeLearn(); consumeHandoff(); }
  refresh();
  requestAnimationFrame(() => { baseDirty = true; draw(); });
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
    <div class="pager">${prev ? `<a href="#grammar/learn/${prev.id}">‹ ${prev.nav}</a>` : '<span></span>'}${next ? `<a href="#grammar/learn/${next.id}">${next.nav} ›</a>` : `<a href="#grammar/editor/library">open the editor ›</a>`}</div>`;
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
  let alive = true, handle: { flip(): void; destroy(): void } | null = null;
  learnDisposers.push(() => { alive = false; handle?.destroy(); });
  import('./swatch3d').then(({ SWATCHES, mountSwatch }) => {
    if (!alive) return;
    const spec = SWATCHES[f.dataset.swatch!];
    box.innerHTML = '';
    cap.textContent = spec.caption;
    const side = document.createElement('span'); side.className = 'dim small';
    try {
      handle = mountSwatch(box, spec, s => (side.textContent = s === 'front' ? 'seen from the front (technical face)' : 'seen from the back'));
      bar.innerHTML = '<button class="btn">turn over</button>';
      bar.append(side);
      bar.querySelector('button')!.onclick = () => handle?.flip();
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
  paintGlyph(ctx, glyphOf(op), 0, 0, c.width, '#000');
}

function miniPattern(id: string): Pattern {
  const m = MINIS[id], rows = m.rows.map(r => r.split(' '));
  const p = createPattern({ name: m.name, w: rows[0].length, h: rows.length, key: BASIC });
  rows.forEach((r, y) => r.forEach((opId, x) => (p.cells[y * p.w + x] = Math.max(0, BASIC.ops.findIndex(o => o.id === opId)))));
  return p;
}

function renderMini(el: HTMLElement, id: string) {
  const p = miniPattern(id), v: ViewOpts = { cs: 13, symbols: true, guides: false, grid: true, numbers: true }, L = layout(p, v), dpr = devicePixelRatio || 1;
  el.classList.add('kmini');
  el.innerHTML = `<canvas></canvas><div class="minibar"><span class="dim small">${esc(p.name)} · ${p.w} × ${p.h}</span><button class="btn">open in editor ›</button></div>`;
  const c = el.querySelector('canvas')!;
  c.width = L.W * dpr; c.height = L.H * dpr; c.style.width = `${L.W}px`; c.style.height = `${L.H}px`;
  drawPattern(c.getContext('2d')!, p, v, tiles, dpr);
  el.querySelector('button')!.onclick = async () => { p.id = newId(); await lib.putPattern(p); await refreshLibrary(); open(p); goEditor('draw'); log(`> "${p.name}" copied into your library`); };
}

// ---------------------------------------------------------------- patterns
async function refreshLibrary() {
  G.list = await lib.listPatterns().catch(() => []);
  renderLibrary();
}

function open(p: Pattern, announce = true) {
  G.p = p; G.ed.load(p); G.zoom = 0; G.marks = null; G.hover = null; G.preview = null;
  tiles.bump(); baseDirty = true;
  lib.setMeta('last', p.id).catch(() => {});
  recheck();
  syncPattern();
  refresh();
  draw();
  if (announce) log(`> opened "${p.name}" · ${p.w} × ${p.h} · ${p.key.mode === 2 ? 'two yarn guides' : 'one yarn guide'}`);
}

async function newPattern(mode: 1 | 2, from?: Partial<Pattern>) {
  const n = G.list.length + 1;
  const p = Object.assign(createPattern({ name: `pattern ${n}`, key: mode === 2 ? TWO : BASIC }), from ?? {});
  await lib.putPattern(p);
  await refreshLibrary();
  open(p);
  return p;
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
  checkT = window.setTimeout(() => { recheck(); refresh(); draw(); }, 120);
  scheduleSave();
  refresh();
  draw();
}

// ---------------------------------------------------------------- canvas
const ZMIN = 2, ZMAX = 56;
function stageArea() {
  const v = $('#kgview', root), tb = $('#kgtoolbar', root).offsetHeight, sb = $('#kgstatus', root).offsetHeight;
  return { w: Math.max(80, v.clientWidth - 40), h: Math.max(80, v.clientHeight - tb - sb - 24), tb, sb };
}
function fitCs() {
  if (!G.p) return 10;
  const a = stageArea(), sub = G.view.guides && G.p.key.mode === 2 ? 2 : 1;
  const cs = Math.floor(Math.min((a.w - 56) / G.p.w, (a.h - 32) / (G.p.h * sub)));
  return Math.max(ZMIN, Math.min(40, cs));
}
const cs = () => G.zoom || fitCs();
const viewOpts = (): ViewOpts => ({ cs: cs(), symbols: G.view.symbols, guides: G.view.guides && G.p?.key.mode === 2, grid: G.view.grid, numbers: G.view.numbers });

function draw() {
  if (!root || !G.p || G.mode !== 'editor') return;
  const cv = $<HTMLCanvasElement>('#kgcv', root), v = viewOpts(), L = layout(G.p, v), dpr = devicePixelRatio || 1;
  const W = Math.round(L.W * dpr), H = Math.round(L.H * dpr);
  if (!base || base.width !== W || base.height !== H) { base = document.createElement('canvas'); base.width = W; base.height = H; baseDirty = true; }
  if (baseDirty) { drawPattern(base.getContext('2d')!, G.p, v, tiles, dpr); baseDirty = false; }
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = `${L.W}px`; cv.style.height = `${L.H}px`; }
  const a = stageArea();
  $('#kgview', root).style.paddingTop = `${a.tb + 12}px`;
  $('#kgview', root).style.paddingBottom = `${a.sb + 12}px`;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const marks = G.marks ? new Set(G.findings.find(f => f.id === G.marks)?.cells ?? []) : null;
  drawOverlay(ctx, G.p, v, dpr, { hover: G.hover, sel: G.ed.sel, preview: G.preview, marks });
  $('#kgzoom', root).textContent = G.zoom ? `${G.zoom}px` : 'fit';
}

function cellOf(e: PointerEvent) {
  if (!G.p) return null;
  const r = $<HTMLCanvasElement>('#kgcv', root).getBoundingClientRect();
  return cellAt(G.p, viewOpts(), e.clientX - r.left, e.clientY - r.top);
}

function zoomBy(d: number) {
  if (d === 0) G.zoom = 0;
  else { const now = cs(); G.zoom = Math.max(ZMIN, Math.min(ZMAX, d > 0 ? Math.ceil(now * 1.25) : Math.floor(now / 1.25))); }
  baseDirty = true; draw();
}

function readout(c: { x: number; y: number } | null) {
  const el = $('#kgread', root);
  if (!G.p || !c) { el.textContent = G.p ? `${G.p.w} needles × ${G.p.h} passes · ${G.p.key.name}` : ''; return; }
  const v = G.p.cells[c.y * G.p.w + c.x], op = v < UNKNOWN ? G.p.key.ops[v] : null, rgb = op ? op.rgb : G.p.unknown[v - UNKNOWN];
  el.textContent = `pass ${passOf(G.p, c.y)} ${dirOf(G.p, c.y) === 1 ? '→' : '←'} · needle ${c.x + 1} · ${op ? op.name : 'unknown colour'} ${rgbText(rgb)}`;
}

function wireCanvas() {
  const cv = $<HTMLCanvasElement>('#kgcv', root);
  let down: { x: number; y: number } | null = null, last: { x: number; y: number } | null = null, mode: 'paint' | 'run' | 'select' | 'move' | null = null;
  const inSel = (c: { x: number; y: number }) => { const s = G.ed.sel; return !!s && c.x >= s.x && c.y >= s.y && c.x < s.x + s.w && c.y < s.y + s.h; };
  cv.addEventListener('pointerdown', e => {
    if (!G.p || e.button > 0) return;
    if (viewOnly()) { log('> view only on phones · edit on a tablet or computer'); return; }
    const c = cellOf(e);
    if (!c) { if (G.ed.tool === 'motif') { G.ed.select(null); refresh(); draw(); } return; }
    cv.setPointerCapture(e.pointerId);
    down = c; last = c;
    const t = G.ed.tool;
    if (e.altKey || t === 'pick') { pickAt(c); mode = null; return; }
    if (t === 'needle') { G.ed.begin(); G.ed.set(c.x, c.y); mode = 'paint'; }
    else if (t === 'pass') { G.ed.begin(); G.ed.pass(c.y); mode = 'paint'; }
    else if (t === 'wale') { G.ed.begin(); G.ed.wale(c.x); mode = 'paint'; }
    else if (t === 'flood') { G.ed.begin(); G.ed.flood(c.x, c.y); G.ed.end(); mode = null; changed(); return; }
    else if (t === 'run') { mode = 'run'; G.preview = { cells: [[c.x, c.y]], v: G.ed.op }; }
    else if (t === 'motif') { if (inSel(c)) mode = 'move'; else { mode = 'select'; G.ed.select({ x: c.x, y: c.y, w: 1, h: 1 }); } }
    baseDirty = mode === 'paint';
    draw();
  });
  cv.addEventListener('pointermove', e => {
    const c = cellOf(e);
    if (c?.x !== G.hover?.x || c?.y !== G.hover?.y) { G.hover = c; readout(c); }
    if (down && c && mode) {
      if (mode === 'paint' && last && (c.x !== last.x || c.y !== last.y)) {
        const t = G.ed.tool;
        if (t === 'needle') G.ed.run(last.x, last.y, c.x, c.y);
        else if (t === 'pass') G.ed.pass(c.y);
        else if (t === 'wale') G.ed.wale(c.x);
        baseDirty = true;
      } else if (mode === 'run') G.preview = { cells: GEditor.runCells(down.x, down.y, c.x, c.y), v: G.ed.op };
      else if (mode === 'select') G.ed.select({ x: Math.min(down.x, c.x), y: Math.min(down.y, c.y), w: Math.abs(c.x - down.x) + 1, h: Math.abs(c.y - down.y) + 1 });
      else if (mode === 'move') { G.ed.moveTo(c.x - down.x, c.y - down.y); baseDirty = true; }
      last = c;
    }
    draw();
  });
  const end = (e: PointerEvent) => {
    if (!down) return;
    const c = cellOf(e) ?? last;
    if (mode === 'paint') { if (G.ed.end()) changed(); }
    else if (mode === 'run' && c) { G.ed.begin(); G.ed.run(down.x, down.y, c.x, c.y); G.preview = null; if (G.ed.end()) changed(); }
    else if (mode === 'move') { G.ed.drop(); changed(); }
    else if (mode === 'select') refresh();
    down = null; last = null; mode = null; G.preview = null;
    draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!down) { G.hover = null; readout(null); draw(); } });
  $('#kgview', root).addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
}

function pickAt(c: { x: number; y: number }) {
  const v = G.p!.cells[c.y * G.p!.w + c.x];
  if (v >= UNKNOWN) { log('> that cell has a colour outside the key'); return; }
  setOp(v);
}

// ---------------------------------------------------------------- actions
function setTool(t: GTool) { G.ed.tool = t; if (t !== 'motif') G.ed.select(null); refresh(); draw(); }
function setOp(i: number) { if (!G.p) return; G.ed.op = Math.max(0, Math.min(G.p.key.ops.length - 1, i)); refresh(); }
function setMirror(on: boolean) { G.ed.mirror = on; refresh(); }

function selAct(a: string) {
  const ed = G.ed;
  if (a === 'drop') { ed.select(null); refresh(); draw(); return; }
  if (!ed.sel) { log('> select a motif first (S, then drag a rectangle)'); return; }
  if (a === 'flip-h') ed.flip('h');
  else if (a === 'flip-v') ed.flip('v');
  else if (a === 'fill') ed.fillSel();
  else if (a === 'clear') ed.clearSel();
  else if (a === 'repeat') { ed.repeat(G.rep, G.shift); log(`> motif ${ed.sel.w} × ${ed.sel.h} repeated ${G.rep === 'all' ? 'everywhere' : G.rep}${G.shift ? `, shifted ${G.shift} per repeat` : ''}`); }
  changed();
}

function undo() { if (G.ed.undo()) { tiles.bump(); syncPattern(); changed(); } }
function redo() { if (G.ed.redo()) { tiles.bump(); syncPattern(); changed(); } }

function resizeTo(w: number, h: number) {
  const p = G.p; if (!p) return;
  w = Math.max(1, Math.min(MAX_SIDE, Math.round(w))); h = Math.max(1, Math.min(MAX_SIDE, Math.round(h)));
  if (w === p.w && h === p.h) return;
  G.ed.whole(() => { p.cells = resized(p, w, h, floatIndex(p.key)); p.w = w; p.h = h; });
  G.zoom = 0; changed(); syncPattern();
  log(`> resized to ${w} × ${h} · pass 1 and needle 1 stay put`);
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
        `<tr><td><span class="chip" style="background:${hex(r.rgb)}"></span></td><td class="num">${rgbText(r.rgb)}</td><td class="num">${r.count} px</td><td>${r.op >= 0 ? `→ ${esc(key.ops[r.op].name)} ${rgbText(key.ops[r.op].rgb)}` : '<span class="warnc">kept, flagged as unknown</span>'}</td></tr>`).join('')}</tbody></table>${lines.length > 24 ? `<p class="dim">… and ${lines.length - 24} more.</p>` : ''}<p class="dim">Snapped colours were close to one key colour and clearly nearer to it than to any other. Unknown cells are written back as they were; find them in 13 check.</p>`;
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
  const opts = BASIC.ops.map((o, i) => `<option value="${i}">${esc(o.name)}</option>`).join('');
  const body = `<p>The portrait is ${h.w} × ${h.h}: one stitch per needle and pass. Choose what its two colours do (4.S52 basic key).</p>
    <div class="row"><label>ink</label><select class="txt" id="kgbr-ink">${opts}</select></div>
    <div class="row"><label>paper</label><select class="txt" id="kgbr-paper">${opts}</select></div>`;
  ask('PORTRAIT → KNIT GRAMMAR', 'Map the two colours', body, 'make pattern', true, dlg => {
    $<HTMLSelectElement>('#kgbr-ink', dlg).value = String(BASIC.ops.findIndex(o => o.id === 'kf'));
    $<HTMLSelectElement>('#kgbr-paper', dlg).value = String(BASIC.ops.findIndex(o => o.id === 'kb'));
  }).then(async ok => {
    if (!ok) return;
    const ink = +$<HTMLSelectElement>('#kgbr-ink', root).value, paper = +$<HTMLSelectElement>('#kgbr-paper', root).value;
    const p = await newPattern(1, { name: h.name, w: h.w, h: h.h, cells: cells.map(v => (v === 0 ? ink : paper)) });
    log(`> "${p.name}" made from the portrait: ink → ${BASIC.ops[ink].name}, paper → ${BASIC.ops[paper].name}`);
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
  box.innerHTML = G.list.length ? G.list.map(p => `<div class="lrow${p.id === G.p?.id ? ' sel' : ''}" data-pid="${p.id}" tabindex="0"><span class="lnum">${p.key.mode === 2 ? '2YG' : '1YG'}</span><span class="left">${esc(p.name)}</span><span class="right">${p.w}×${p.h}</span></div>`).join('')
    : '<div class="empty small">No patterns yet. Start one, or open a BMP.</div>';
}

function syncPattern() {
  const p = G.p; if (!p) return;
  $<HTMLInputElement>('#kgname', root).value = p.name;
  $<HTMLInputElement>('#kgw', root).value = String(p.w);
  $<HTMLInputElement>('#kgh', root).value = String(p.h);
  $<HTMLTextAreaElement>('#kgnote', root).value = p.note ?? '';
  $<HTMLInputElement>('#kgexname', root).value = p.name;
  renderKey();
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
  const p = G.p, ed = G.ed;
  root.dataset.mode = G.mode;
  root.classList.toggle('noproject', !p);
  setSeg($('#kgmode', root), b => b.dataset.mode === G.mode);
  $$('[data-learn]', root).forEach(r => r.classList.toggle('sel', G.mode === 'learn' && r.dataset.learn === G.page));
  $$('[data-kstep]', root).forEach(r => r.classList.toggle('sel', G.mode === 'editor' && r.dataset.kstep === G.step));
  $$('[data-kpanel]', root).forEach(s => s.classList.toggle('on', s.dataset.kpanel === G.step));
  const bind = (k: string, t: string) => $$(`[data-kbind="${k}"]`, root).forEach(e => (e.textContent = t));
  bind('library', String(G.list.length || ''));
  bind('pattern', p ? `${p.w} × ${p.h}` : '—');
  bind('key', p ? (p.key.preset ? (p.key.mode === 2 ? 'two guides' : 'basic') : 'custom') : '');
  bind('draw', ed.tool);
  bind('view', [G.view.symbols && 'symbols', G.view.guides && p?.key.mode === 2 && 'guides'].filter(Boolean).join(' + ') || 'colour');
  bind('check', p ? (G.findings.length ? `${G.findings.length} flag${G.findings.length > 1 ? 's' : ''}` : 'ok') : '');
  bind('export', G.fmt);
  bind('mode', p ? (p.key.mode === 2 ? 'two (fixed for this pattern)' : 'one (fixed for this pattern)') : '—');
  const op = p?.key.ops[ed.op];
  bind('opname', op ? `${op.name} ${rgbText(op.rgb)}` : '—');
  bind('sel', ed.sel ? `${ed.sel.w} × ${ed.sel.h} at needle ${ed.sel.x + 1}, pass ${p ? passOf(p, ed.sel.y + ed.sel.h - 1) : ''}` : 'none');
  const chip = $('#kgop', root);
  if (op) { ($('.sw', chip) as HTMLElement).style.background = hex(op.rgb); $('.t', chip).textContent = op.name; }
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
  ($('#kgundo', root) as HTMLButtonElement).disabled = !ed.canUndo;
  ($('#kgredo', root) as HTMLButtonElement).disabled = !ed.canRedo;
  $$('.oprow', root).forEach(r => r.classList.toggle('on', +r.dataset.op! === ed.op));
  if (!G.hover) readout(null);
}

// ---------------------------------------------------------------- wiring
function wire() {
  wireCanvas();
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const learn = t.closest<HTMLElement>('[data-learn]'); if (learn) { goLearn(learn.dataset.learn!); return; }
    const st = t.closest<HTMLElement>('[data-kstep]'); if (st) { goEditor(st.dataset.kstep as Step_); return; }
    const pid = t.closest<HTMLElement>('[data-pid]'); if (pid) { const p = G.list.find(x => x.id === pid.dataset.pid); if (p) { open(p); goEditor('draw'); } return; }
    const pick = t.closest<HTMLElement>('[data-pickop]'); if (pick) { setOp(+pick.dataset.pickop!); return; }
    const del = t.closest<HTMLElement>('[data-delop]'); if (del) { deleteOp(+del.dataset.delop!); return; }
    const ra = t.closest<HTMLElement>('[data-readas]'); if (ra) { readAs(ra.dataset.readas!); return; }
    const mk = t.closest<HTMLElement>('[data-mark]'); if (mk) { G.marks = G.marks === mk.dataset.mark ? null : mk.dataset.mark!; renderChecks(); if (G.marks) goEditor('check'); draw(); return; }
    const nw = t.closest<HTMLElement>('[data-knew]'); if (nw) { newPattern(+nw.dataset.knew! as 1 | 2).then(() => goEditor('draw')); return; }
    if (t.closest('[data-kopen]')) { $<HTMLInputElement>('#kgfile', root).click(); return; }
    if (t.closest('#kgcopykey')) { copyKey(); return; }
    if (t.closest('#kgb-add')) { addOp(); return; }
    if (t.closest('#kgsavekey')) { saveKey(); return; }
    if (t.closest('.homelink')) { e.preventDefault(); location.hash = ''; }
  });
  root.addEventListener('keydown', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.lrow'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.recolour && G.p) { G.p.key.ops[+t.dataset.recolour].rgb = fromHex(t.value); (t.parentElement as HTMLElement).style.background = t.value; tiles.bump(); changed(); renderKeySoon(); }
    else if (t.id === 'kgb-c') (t.parentElement as HTMLElement).style.background = t.value;
    else if (t.dataset.rename && G.p) { G.p.key.ops[+t.dataset.rename].name = t.value; scheduleSave(); refresh(); }
  });
  seg($('#kgmode', root), b => (b.dataset.mode === 'learn' ? goLearn(G.page) : goEditor()));
  $$('[data-ktool]', root).forEach(b => b.addEventListener('click', () => setTool(b.dataset.ktool as GTool)));
  $('#kgop', root).addEventListener('click', () => goEditor('key'));
  for (const id of ['#kgsym', '#kgsym2']) check($(id, root), on => { G.view.symbols = on; baseDirty = true; refresh(); draw(); });
  for (const id of ['#kggrid', '#kggrid2']) check($(id, root), on => { G.view.grid = on; baseDirty = true; refresh(); draw(); });
  for (const id of ['#kgmirror', '#kgmirror2']) check($(id, root), on => setMirror(on));
  check($('#kgguides', root), on => { G.view.guides = on; G.zoom = 0; baseDirty = true; refresh(); draw(); });
  check($('#kgnums', root), on => { G.view.numbers = on; baseDirty = true; refresh(); draw(); });
  $$<HTMLButtonElement>('[data-kzoom]', root).forEach(b => b.addEventListener('click', () => zoomBy(+b.dataset.kzoom!)));
  $$<HTMLButtonElement>('[data-ksel]', root).forEach(b => b.addEventListener('click', () => selAct(b.dataset.ksel!)));
  seg($('#kgevery', root), b => { G.ed.every = +b.dataset.every!; refresh(); });
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
    if (!(await ask('08 · LIBRARY', `Delete "${p.name}"?`, '<p>It is removed from this browser. Export it first if you want to keep it.</p>', 'delete'))) return;
    await lib.deletePattern(p.id); G.p = null; await refreshLibrary();
    if (G.list[0]) open(G.list[0]); else { refresh(); draw(); }
    log(`> deleted "${p.name}"`);
  });
  const file = $<HTMLInputElement>('#kgfile', root);
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) importFile(f); file.value = ''; });
  // drop files anywhere while the editor is open
  window.addEventListener('dragover', e => { if (isActive() && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { if (!isActive() || !e.dataTransfer?.files.length) return; e.preventDefault(); importFile(e.dataTransfer.files[0]); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (isActive()) { baseDirty = true; draw(); } });
}

let keyT = 0;
function renderKeySoon() { clearTimeout(keyT); keyT = window.setTimeout(renderKey, 250); }

function onKey(e: KeyboardEvent) {
  if (!isActive() || G.mode !== 'editor' || !G.p) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, dialog') || e.altKey) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); setTool('motif'); G.ed.selectAll(); refresh(); draw(); return; }
  if (mod) return;
  const arrow = ({ arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] } as Record<string, number[]>)[k];
  if (arrow && G.ed.sel) { e.preventDefault(); const n = e.shiftKey ? 5 : 1; G.ed.nudge(arrow[0] * n, arrow[1] * n); changed(); return; }
  if (/^[1-9]$/.test(k)) { setOp(+k - 1); return; }
  const act: Record<string, () => void> = {
    n: () => setTool('needle'), l: () => setTool('run'), g: () => setTool('flood'), p: () => setTool('pass'), w: () => setTool('wale'), s: () => setTool('motif'), i: () => setTool('pick'),
    m: () => setMirror(!G.ed.mirror), h: () => selAct('flip-h'), v: () => selAct('flip-v'), r: () => selAct('repeat'),
    delete: () => selAct('clear'), backspace: () => selAct('clear'), escape: () => selAct('drop'),
    '[': () => setOp(G.ed.op - 1), ']': () => setOp(G.ed.op + 1), '+': () => zoomBy(1), '=': () => zoomBy(1), '-': () => zoomBy(-1), '0': () => zoomBy(0),
  };
  if ((k === 'escape' || k === 'delete' || k === 'backspace') && !G.ed.sel) return;
  if (act[k]) { e.preventDefault(); act[k](); }
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
  setOp(p.key.ops.length - 1);
}

async function deleteOp(i: number) {
  const p = G.p; if (!p || p.key.ops.length <= 1) return;
  const n = io.usage(p).get(i) ?? 0, fl = floatIndex(p.key);
  if (n && !(await ask('10 · KEY', `Remove "${p.key.ops[i].name}"?`, `<p>${n} cells use it; they become ${esc(p.key.ops[fl === i ? 0 : fl].name)}.</p>`, 'remove'))) return;
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
  if (!(await ask('10 · KEY', `Read as "${k.name}"?`, `${modeNote}<p>${lost ? `${lost} cells have colours this key doesn't have; they are kept and flagged as unknown.` : 'Every colour of the pattern is in this key.'}</p>`, 'read as'))) return;
  G.ed.whole(() => { p.key = k.preset ? { ...cloneKey(k), preset: true } : structuredClone(k); p.cells = r.cells; p.unknown = r.unknown; });
  tiles.bump(); G.view.guides = G.view.guides && p.key.mode === 2; syncPattern(); changed();
}

export { STEPS };
