// Knitting Taxonomy: knitted samples in frames, each with an NFC tag that holds its address (#taxonomy/SMP_0001).
// Loaded by app.ts the first time the section opens. Three views of the same samples, toggled in the bar: Samples,
// a shelf of spines (shelf.ts); Lineage, fibres → yarns → samples → structures (lineage.ts); Performance, a map of
// two properties (perf.ts). In each, pointing at a sample lifts it; resting on it for DWELL ms makes it the current
// sample, shown in the band below; a click pins it there (the address follows); a second click or Esc unpins. A
// finger dragging over the marks only lifts them; letting go pins the one under it, and a tap is a click. The
// current sample's frame flies from its mark to the preview in 3D (stage.ts). Search and keys work in every view.
// Phones (style.css, under 760 px): the preview stays at the top, the summary and the full record below it, then the
// view.
// A sample's address arriving while it is already pinned (its tag laid on again) flies its frame in once more.
// Tags reach the page three ways: an address opened (a phone, the desk reader setting this tab's address); on
// Android Chrome, Web NFC behind the "scan tags here" button; in the kiosk (?kiosk, served by
// tools/nfc/taxonomy_reader.py), the reader's events. The kiosk opens the full record beside a large preview by
// itself, swings the frame slowly, needs no hover, and puts the sample back when it is lifted off the reader.
import { EXPERIMENTS } from '../grammar/structures';
import { sampleUrl, tagPayload, TAG_DATA_BYTES } from './core.js';
import type { Term } from './core';
import { fibreLine, fmtValue, load, vocab, type DB, type Rec, type SortKey, type YarnUse } from './data';
import { mountShelf, type Shelf } from './shelf';
import { mountLineage } from './lineage';
import { AXES, mountPerf, type Perf } from './perf';
import type { Dir, View, ViewEvents } from './view';
import { loadModel, type Model } from './model';
import { mountStage, type Face, type Stage } from './stage';

const DWELL = 120, LEAVE = 450;
const KIOSK = new URLSearchParams(location.search).has('kiosk');
/** no mouse to point with (phones, tablets): the hint in the empty band says tap */
const TOUCH = matchMedia('(hover: none)').matches;
/** a finger moved further than this (px) between down and up dragged; less is a tap, left to the click */
const TAP = 4;
/** the phone layout (style.css): one page scroll, the preview held at the top */
const PHONE = matchMedia('(max-width: 760px)');
/** The band's key values: areal density and thickness, then the Performance view's two axes, each once. */
const keyValues = () => ['areal_density', 'thickness', AXES.x, AXES.y].filter((v, i, a) => a.indexOf(v) === i);
type ViewName = 'samples' | 'lineage' | 'performance';
const BOX: Record<ViewName, string> = { samples: '.txshelf', lineage: '.txlin', performance: '.txperf' };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const termOf = (n: string) => { const m = new Map(vocab(n).map(t => [t.id, t])); return (id: string) => m.get(id); };
const ROLE = termOf('yarn_role'), METHOD = termOf('method'), STATUS = termOf('record_status'), GROUP = vocab('property_group'), MACHINE = vocab('machine');

let root: HTMLElement, db: DB, shelf: Shelf, box: HTMLElement, find: HTMLInputElement, view: ViewName = 'samples';
const views: Partial<Record<ViewName, View>> = {};
const v = () => views[view]!;
let sort: SortKey = 'id', current: Rec | null = null, pinned = false, overBand = false, drawer = false, missing = '';
let dwell = 0, leaveT = 0, matches: Rec[] | null = null;
/** the sample the pointer is on; a finger on the screen (where it went down); clicks ignored until then (ms) */
let lifted: Rec | null = null, finger: { x: number; y: number } | null = null, quiet = 0;
/** kiosk: the sample the reader showed ('' none), and whether the reader is connected */
let tagged = '', reader = false;
let stage: Stage | null = null, face: Face = 'model', first = true, instant = false;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

const SHELL = `
<header class="txbar">
  <div class="txname"><a href="#" class="homelink">Nijat Mahamaliyev</a><span class="dim small">Tailored Materiality Research</span></div>
  <div class="seg secseg" aria-label="section"><a href="#portrait">portrait</a><a href="#grammar">grammar</a><a href="#taxonomy" class="on" aria-current="page">taxonomy</a></div>
  <div class="seg txviews" role="group" aria-label="view"><button data-view="samples" class="on" aria-pressed="true">samples</button><button data-view="lineage" aria-pressed="false">lineage</button><button data-view="performance" aria-pressed="false">performance</button></div>
  <i class="txbreak" hidden></i>
  <input class="txfind" type="search" placeholder="find: ID, fibre, yarn, structure…" aria-label="find samples" spellcheck="false" autocomplete="off">
  <span class="txcount small dim" aria-live="polite"></span>
  <div class="seg txsort" role="group" aria-label="order"><span class="small dim">order</span><button data-sort="id" class="on">ID</button><button data-sort="structure">structure</button><button data-sort="origin">origin</button></div>
  <div class="txaxes" role="group" aria-label="axes" hidden><label class="small dim">x <select data-axis="x"></select></label><label class="small dim">y <select data-axis="y"></select></label></div>
  <span class="txlive" aria-live="polite"></span>
  <span class="txnfc" hidden><button class="btn" data-nfc aria-pressed="false">scan tags here</button><span class="small dim" aria-live="polite"></span></span>
</header>
<div class="txnotice small" hidden></div>
<div class="txmain">
  <div class="txshelf" tabindex="0" role="listbox" aria-label="samples"></div>
  <div class="txlin" tabindex="0" role="group" aria-label="lineage: fibres, yarns, samples and structures; arrow keys move along the samples" hidden></div>
  <div class="txperf" tabindex="0" role="group" aria-label="performance map; arrow keys move between samples" hidden></div>
  <div class="txbig" hidden></div>
  <section class="txdrawer" aria-label="full record" hidden></section>
</div>
<footer class="txband">
  <div class="txleft"></div>
  <div class="txpreview"><div class="txview"></div><div class="txcap small"></div></div>
  <div class="txright"></div>
</footer>
<div class="txkline" aria-live="polite" hidden></div>`;

export async function init(el: HTMLElement) {
  root = el;
  root.innerHTML = SHELL;
  root.classList.toggle('kiosk', KIOSK);
  find = $<HTMLInputElement>('.txfind');
  // the kiosk's preview: large, beside the full record
  if (KIOSK) { $('.txbig').hidden = false; $('.txkline').hidden = false; $('.txbig').appendChild($('.txpreview')); }
  db = await load();
  box = $('.txshelf');
  shelf = mountShelf(box, db, events);
  views.samples = shelf;
  stage = mountStage(root, $('.txview'), db, shelf, KIOSK ? matchMedia('not all') : PHONE);
  stage?.swing(KIOSK);
  if (KIOSK) listen();
  if ('NDEFReader' in window && !KIOSK) $('.txnfc').hidden = false;
  const opts = GROUP.map(g => `<optgroup label="${esc(g.label)}">${db.properties.filter(p => p.group === g.id).map(p => `<option value="${p.id}">${esc(p.label)} (${esc(p.unit)})</option>`).join('')}</optgroup>`).join('');
  root.querySelectorAll<HTMLSelectElement>('[data-axis]').forEach(sel => {
    sel.innerHTML = opts;
    const k = sel.dataset.axis as 'x' | 'y';
    sel.value = AXES[k];
    sel.addEventListener('change', () => { AXES[k] = sel.value; (views.performance as Perf | undefined)?.axes(); render(); });
  });
  const n = db.recs.length;
  if (db.demo) { const t = $('.txnotice'); t.hidden = false; t.innerHTML = `<b>Demo data.</b> ${n} generated samples: every value is made up (status <i>generated</i>), none is a real sample. Real samples will replace them.`; }
  count();
  requestAnimationFrame(() => shelf.layout(sort, false));
  const ro = new ResizeObserver(() => { if ($(BOX[view]).clientWidth) v().resize(); });
  for (const b of Object.values(BOX)) ro.observe($(b));
  // a frame later: folding inside the observer would change the size it just reported (a resize-observer loop)
  new ResizeObserver(() => requestAnimationFrame(fold)).observe($('.txbar'));

  // a finger lifts what it passes over (hover() does not dwell then); letting go after a drag pins the one under it,
  // and the click the browser may send after that is ignored. A tap is left to the click (a second tap unpins).
  root.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') finger = { x: e.clientX, y: e.clientY }; }, true);
  root.addEventListener('pointerup', e => {
    const f = finger;
    finger = null;
    if (!f || Math.hypot(e.clientX - f.x, e.clientY - f.y) <= TAP || !lifted || !(e.target as Element).closest(BOX[view])) return;
    pin(lifted);
    quiet = performance.now() + 700;
  }, true);
  root.addEventListener('pointercancel', () => { finger = null; }, true); // the browser took the drag for a scroll

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('[data-sort]');
    if (s) { sort = s.dataset.sort as SortKey; root.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('on', b === s)); shelf.layout(sort, true); search(find.value); return; }
    const w = t.closest<HTMLElement>('[data-view]');
    if (w) { setView(w.dataset.view as ViewName); return; }
    if (t.closest('[data-pin]')) { if (current) pin(current); return; }
    // the button goes with the sample: from the keyboard, focus goes back to the view
    if (t.closest('[data-unpin]')) { closeSample(); if (!e.detail) $(BOX[view]).focus({ preventScroll: true }); return; }
    if (t.closest('[data-full]')) { openDrawer(!drawer); return; }
    if (t.closest('[data-close]')) { if (KIOSK) unpin(); else openDrawer(false); return; }
    if (t.closest('[data-nfc]')) { void scanTags(); return; }
    const f = t.closest<HTMLElement>('[data-face]');
    if (f) { face = f.dataset.face as Face; stage?.face(face); render(); return; }
  });
  const band = $('.txband');
  band.addEventListener('pointerenter', () => { overBand = true; clearTimeout(leaveT); });
  band.addEventListener('pointerleave', () => { overBand = false; if (!pinned) leaveT = window.setTimeout(() => { if (!pinned && !overBand) show(null); }, LEAVE); });

  find.addEventListener('input', () => search(find.value));
  find.addEventListener('keydown', e => {
    if (e.key === 'Enter' && matches?.length) { pin(matches[0]); reveal(matches[0]); }
    if (e.key === 'Escape') { find.value = ''; search(''); }
  });
  for (const b of Object.values(BOX)) $(b).addEventListener('keydown', keys);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.body.dataset.section !== 'taxonomy' || e.target === find) return;
    if (drawer && !KIOSK) openDrawer(false); else if (pinned) unpin();
  });
  render();
}

/** "SMP_0042" pins that sample (a tag, a link, the reader at the desk); "" leaves the shelf as it is. */
export function route(sub: string) {
  if (!db) return;
  const id = sub.split('/')[0];
  missing = '';
  // the address the page opened with: its sample is already in the preview, no flight
  instant = first;
  first = false;
  if (/^SMP_\d{4}$/.test(id) && arrive(id)) return;
  instant = false;
  render();
}

/** A sample's address arrived (a tag, a link, the reader): it is pinned; already pinned, its frame flies in again.
 *  No such sample: the address stays as asked and the band says so. */
function arrive(id: string) {
  const r = db.byId.get(id);
  if (r && pinned && current === r) { stage?.again(); reveal(r); history.replaceState(null, '', `#taxonomy/${id}`); return true; }
  if (r) { reveal(r); pin(r); return true; }
  missing = id;
  pinned = false;
  v().setPinned(null);
  show(null);
  if (!location.hash.startsWith(`#taxonomy/${id}`)) history.replaceState(null, '', `#taxonomy/${id}`);
  return false;
}

/** The sample a tag's address opens, as app.ts routes it (also the first tag's old address), or ''. */
function sampleIn(url: string) {
  const m = /#taxonomy\/(SMP_\d{4})(?:\/|$)/.exec(url), old = /#grammar\/learn\/taxonomy(?:\/frame-(\d+))?$/.exec(url);
  return m ? m[1] : old ? `SMP_${(old[1] ?? '1').padStart(4, '0')}` : '';
}

// ---------------------------------------------------------------- tags on Android (Web NFC) and the kiosk's reader
interface NfcRecord { recordType: string; data?: DataView }
interface NfcReader extends EventTarget { scan(): Promise<void>; onreading: ((e: Event & { message: { records: NfcRecord[] } }) => void) | null; onreadingerror: (() => void) | null }
let scanning = false;
async function scanTags() {
  const Reader = (window as unknown as { NDEFReader?: new () => NfcReader }).NDEFReader, btn = $('[data-nfc]'), say = (t: string) => ($('.txnfc .small').textContent = t);
  if (!Reader || scanning) return;
  try {
    const nfc = new Reader();
    await nfc.scan();
    scanning = true;
    btn.textContent = 'scanning tags'; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
    say('hold a tag to the back of the phone');
    nfc.onreading = e => {
      const url = e.message.records.filter(r => r.recordType === 'url' && r.data).map(r => new TextDecoder().decode(r.data))[0] ?? '';
      const id = sampleIn(url);
      say(id ? '' : 'not a sample tag');
      if (id) { arrive(id); render(); }
    };
    nfc.onreadingerror = () => say('could not read the tag: hold it still');
  } catch (err) { say(`NFC: ${(err as Error).message || 'not allowed'}`); }
}

function listen() {
  const es = new EventSource('reader');
  es.addEventListener('open', () => { reader = true; kline(); });
  es.addEventListener('error', () => { reader = false; kline(); });
  es.addEventListener('show', e => {
    const id = (e as MessageEvent<string>).data;
    tagged = id;
    arrive(id);
    render();
  });
  es.addEventListener('reload', () => location.reload()); // typed in the kiosk's terminal (reload, build)
  es.addEventListener('clear', () => {
    if (tagged && current?.s.sample_id === tagged) unpin();
    tagged = missing = '';
    kline();
  });
}
function kline() {
  if (!KIOSK) return;
  $('.txkline').textContent = !reader ? 'Reader not connected.'
    : missing ? `${missing}: no sample with this ID here.`
    : tagged && current?.s.sample_id === tagged ? 'Lift the sample off the reader to put it back.'
    : tagged ? 'Lift the sample off the reader before placing the next.'
    : 'Place a sample on the reader.';
}

// ---------------------------------------------------------------- views
const events: ViewEvents = { hover, click };
function setView(name: ViewName) {
  if (name === view) return;
  clearTimeout(dwell);
  v().setLifted(null);
  v().show(false);
  $(BOX[view]).hidden = true;
  view = name;
  // the bar first: the view below lays itself out once, at the height the bar leaves it
  root.querySelectorAll<HTMLElement>('[data-view]').forEach(b => { const on = b.dataset.view === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('.txsort').hidden = name !== 'samples';
  $('.txaxes').hidden = name !== 'performance';
  fold();
  const el = $(BOX[name]);
  el.hidden = false;
  views[name] ??= name === 'lineage' ? mountLineage(el, db, events) : mountPerf(el, db, events);
  v().setCurrent(current?.s.sample_id ?? null);
  v().setPinned(pinned && current ? current.s.sample_id : null);
  v().show(true);
  stage?.source(v());
  search(find.value);
}
/** A bar too long for one line folds into two even ones (sections and views; finding and order) rather than leaving
 * one group on a line of its own. Again with each view, whose items differ: a folded bar keeps its size when they
 * shrink, so the observer alone would leave it folded. */
function fold() {
  const bar = $('.txbar'), brk = $('.txbreak');
  brk.hidden = true;
  const items = [...bar.children].filter(e => !(e as HTMLElement).hidden && !e.matches('.txlive, .txbreak')) as HTMLElement[];
  const mid = (e: HTMLElement) => e.offsetTop + e.offsetHeight / 2; // the bar centres each line's items
  brk.hidden = Math.abs(mid(items[items.length - 1]) - mid(items[0])) < 4;
}
function keys(e: KeyboardEvent) {
  const dir = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' } as Record<string, Dir>)[e.key];
  if (dir) {
    e.preventDefault();
    const r = v().neighbour(current?.s.sample_id ?? null, dir);
    if (r) { v().setLifted(r.s.sample_id); if (pinned) pin(r); else show(r); reveal(r); }
  } else if ((e.key === 'Enter' || e.key === ' ') && current) { e.preventDefault(); pinned ? unpin() : pin(current); }
}

// ---------------------------------------------------------------- state
function hover(r: Rec | null) {
  clearTimeout(dwell);
  clearTimeout(leaveT);
  lifted = r;
  v().setLifted(r?.s.sample_id ?? null);
  // a finger only lifts; the kiosk shows a sample on the reader or a click, never on hover
  if (pinned || KIOSK || finger) return;
  if (r) dwell = window.setTimeout(() => show(r), DWELL);
  else leaveT = window.setTimeout(() => { if (!pinned && !overBand) show(null); }, LEAVE);
}
function click(r: Rec) {
  if (performance.now() < quiet) return;
  if (pinned && current === r) unpin();
  else pin(r);
}
function show(r: Rec | null) {
  if (r === current) return;
  current = r;
  face = r?.s.photo ? 'photo' : 'model';
  stage?.show(r, instant);
  instant = false;
  v().setCurrent(r?.s.sample_id ?? null);
  if (r) box.setAttribute('aria-activedescendant', `sp-${r.s.sample_id}`); else box.removeAttribute('aria-activedescendant');
  // the canvas views have no element per sample: say which one is current
  $('.txlive').textContent = r && view !== 'samples' ? `${r.s.sample_id}, ${r.s.sample_name}` : '';
  if (KIOSK) openDrawer(!!r);
  else if (!r && drawer) openDrawer(false);
  render();
}
function pin(r: Rec) {
  clearTimeout(dwell);
  missing = '';
  pinned = true;
  show(r);
  v().setPinned(r.s.sample_id);
  history.replaceState(null, '', `#taxonomy/${r.s.sample_id}`);
  render();
}
function unpin() {
  pinned = false;
  v().setPinned(null);
  if (location.hash !== '#taxonomy') history.replaceState(null, '', '#taxonomy');
  // nothing pointing at it any more (the kiosk, a finger lifted, the pointer elsewhere): the frame goes back to its mark
  if (KIOSK || (!lifted && !overBand)) show(null);
  render();
}
/** "close sample": out of the preview at once, even with the pointer still on the band (where unpinning keeps it). */
function closeSample() { unpin(); show(null); }
function reveal(r: Rec) { v().reveal(r.s.sample_id); }

function search(q: string) {
  const words = q.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean);
  matches = words.length ? v().order().filter(r => words.every(w => r.words.includes(w))) : null;
  v().setMatches(matches ? new Set(matches.map(r => r.s.sample_id)) : null);
  count();
}
function count() {
  const n = db.recs.length;
  $('.txcount').textContent = matches ? `${matches.length} of ${n}` : `${n} samples`;
}

function openDrawer(on: boolean) {
  drawer = on && !!current;
  const d = $('.txdrawer');
  if (drawer) {
    d.innerHTML = fullRecord(current!); notes(current!); d.hidden = false; requestAnimationFrame(() => d.classList.add('open'));
    // on a phone the record opens in the page, under the summary: bring its head up under the preview (Chrome would
    // otherwise keep the shelf where it was and move the record out of sight above it)
    if (PHONE.matches && !KIOSK) scrollTo({ top: d.getBoundingClientRect().top + scrollY - $('.txpreview').offsetHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  else { d.classList.remove('open'); window.setTimeout(() => { if (!drawer) d.hidden = true; }, 260); }
  render();
}

// ---------------------------------------------------------------- the band and the drawer
function band(u: YarnUse, w = 34, h = 7) {
  let x = 0;
  const total = u.shares.reduce((s, q) => s + q.pct, 0) || 1;
  const rects = u.shares.map(q => { const ww = (w * q.pct) / total, r = `<rect x="${x.toFixed(2)}" width="${ww.toFixed(2)}" height="${h}" style="fill:${q.origin === 'unknown' ? 'url(#tx-hatch)' : db.colours.get(q.origin)}"/>`; x += ww; return r; });
  return `<svg class="band" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${rects.join('')}</svg>`;
}
const statusBadge = (s: string) => `<span class="badge">${esc(s)}</span>`;
const yarnLine = (u: YarnUse) => `<div class="yr">${band(u)}<span>${u.yarn.yarn_id}</span><span class="dim">${esc(u.role)}</span><span class="dim">${esc(fibreLine(db, u.yarn))}</span></div>`;
const valueCell = (r: Rec, id: string) => {
  const v = r.s.performance?.[id];
  return v ? `<td class="num">${esc(fmtValue(v.value, v.unit))}</td><td>${statusBadge(v.status)}</td>` : '<td class="num faint">—</td><td></td>';
};

/** Phones: the summary above the open view changes height with each sample; keep the view where it is on screen, so
 * the sample under a finger stays under it, but never scroll the summary's head under the held preview (Safari has
 * no scroll anchoring; Chrome's is off for #tx, see style.css). */
function render() {
  if (!PHONE.matches || KIOSK) return fill();
  const b = $(BOX[view]), y = b.getBoundingClientRect().top;
  fill();
  const d = Math.min(b.getBoundingClientRect().top - y, Math.max(0, $('.txleft').getBoundingClientRect().top - $('.txpreview').offsetHeight));
  if (d && y < innerHeight) scrollBy(0, d);
}
function fill() {
  const r = current, left = $('.txleft'), right = $('.txright');
  root.classList.toggle('pinned', pinned);
  root.classList.toggle('showing', !!r);
  kline();
  if (!r) {
    left.innerHTML = missing
      ? `<div class="kicker">${esc(missing)}</div><p class="warn">No sample with this ID here.</p>`
      : `<div class="kicker">SAMPLE</div><p class="dim">${TOUCH ? 'Tap a sample to see it here, or drag along them and let go on one.' : 'Point at a sample to see it here; click to keep it.'} A tag opens its sample directly.</p>`;
    right.innerHTML = '';
    preview(null);
    return;
  }
  const s = r.s;
  left.innerHTML = `
    <div class="kicker">${s.sample_id} ${statusBadge(s.status)}</div>
    <div class="txtitle">${esc(s.sample_name)}</div>
    <div class="dim">${esc(r.structure.label)} · ${esc(r.family)} family · ${esc(r.origin)}</div>
    <div class="small faint">knitted ${s.sample_date} · record of ${s.data_as_of}</div>
    <div class="yarns">${r.yarns.map(yarnLine).join('')}</div>`;
  right.innerHTML = `
    <div class="kicker">KEY VALUES</div>
    <table class="kv"><tbody>${keyValues().map(id => `<tr><td>${esc(db.properties.find(p => p.id === id)!.label)}</td>${valueCell(r, id)}</tr>`).join('')}</tbody></table>
    <div class="inline">${pinned ? `<button class="btn" data-unpin aria-label="close sample ${s.sample_id}">close sample ×</button>` : '<button class="btn" data-pin>pin</button>'}<button class="btn" data-full aria-expanded="${drawer}">${drawer ? 'close record ×' : 'full record ›'}</button></div>`;
  preview(r);
  if (drawer) { $('.txdrawer').innerHTML = fullRecord(r); notes(r); }
}

/** The preview's caption; without a sample (or without WebGL) a flat frame in the box instead of the 3D one. */
function preview(r: Rec | null) {
  const view = $('.txview'), cap = $('.txcap');
  view.innerHTML = r && stage ? '' : flat(r);
  if (!r) { cap.innerHTML = ''; return; }
  if (!stage) { cap.innerHTML = '<span class="faint">No 3D view here: WebGL is off or unavailable.</span>'; return; }
  const photo = r.s.photo ? `<div class="seg txface" role="group" aria-label="window"><button data-face="photo" class="${face === 'photo' ? 'on' : ''}">photo</button><button data-face="model" class="${face === 'model' ? 'on' : ''}">model</button></div>` : '';
  cap.innerHTML = face === 'photo'
    ? `${photo}<div class="dim">Photo of this sample.</div>`
    : `${photo}<div class="dim">Model of the structure, not a photo of this sample.</div>${photo ? '' : '<div class="faint">drag to turn</div>'}`;
}

/** What the 3D model shows, in the full record, once its file is loaded. */
function notes(r: Rec) {
  const say = (t: string) => { if (current === r) root.querySelectorAll('[data-mnote]').forEach(n => (n.textContent = t)); };
  loadModel(r.structure.id).then(m => say(modelText(r, m)), () => say('The model could not be loaded: reload the page.'));
}
function modelText(r: Rec, m: Model | null) {
  if (!m) return 'No model of this structure yet.';
  const left = r.yarns.length > m.yarns.length ? ` Only ${m.yarns.length > 1 ? 'its main and contrast yarns are' : 'its main yarn is'} drawn.` : '';
  return `${m.note[0].toUpperCase()}${m.note.slice(1)}. Relaxed with the Knit Grammar yarn engine (${m.status}); the piece's outer two needles and passes are held flat, as in the frame.${left} Each yarn in its origin colour; a blend twisted in stripes by share.`;
}

/** An empty frame, or (no WebGL) a flat one with the family mark in the window. */
function flat(r: Rec | null) {
  const marks: Record<string, string> = { plain: 'M-12 -10L0 10L12 -10', rib: 'M-6 -11V11M6 -11V11', purl: 'M-12 -5H12M-12 5H12', interlock: 'M-12 -11L0 -1L12 -11M-12 1L0 11L12 1', unknown: 'M-12 0H12' };
  return `<svg class="txframe${r ? '' : ' empty'}" viewBox="0 0 160 170" aria-hidden="true">
    <rect x="10" y="6" width="140" height="150" rx="3"/><rect class="win" x="28" y="24" width="104" height="104"/>
    ${r ? `<path class="m" transform="translate(80 76)" d="${marks[r.family] ?? marks.unknown}"/><text x="80" y="146">${r.s.sample_id}</text>` : ''}
  </svg>`;
}

function fullRecord(r: Rec) {
  const s = r.s, st = r.structure, exp = st.pattern ? EXPERIMENTS.find(e => e.id === st.pattern) : null;
  const row = (k: string, v: string) => `<tr><td class="dim">${k}</td><td>${v}</td></tr>`;
  const statusKey = Object.fromEntries(vocab('value_status').map(t => [t.id, String(t.tag_key)]));
  const tag = tagPayload(s, { fibers: db.fibers, yarns: db.yarns, properties: db.properties, machine: MACHINE as (Term & { tag_key: string })[], statusKey });
  const yarns = r.yarns.map(u => `
    <div class="yarnrec">
      <div>${band(u, 48, 8)} <b>${u.yarn.yarn_id}</b> <span class="dim">${esc(u.yarn.yarn_name)} · ${esc(u.role)} · ${u.type}</span></div>
      <div class="small faint">${esc(String(ROLE(u.role)?.definition ?? ''))} Added ${u.yarn.date_added}.</div>
      <table class="kv"><tbody>${u.yarn.composition.map(c => { const f = db.fibers.get(c.fiber_id); return `<tr><td>${esc(f?.fiber_name ?? c.fiber_id)}</td><td class="dim">${esc(f?.fiber_type ?? '')} · ${esc(f?.fiber_origin ?? '')}</td><td class="num">${c.percentage_value} %</td></tr>`; }).join('')}</tbody></table>
    </div>`).join('');
  const perf = GROUP.map(g => `
    <div class="subhead">${esc(g.label.toUpperCase())}<i></i></div>
    <table class="kv"><tbody>${db.properties.filter(p => p.group === g.id).map(p => { const v = s.performance?.[p.id]; return `<tr><td>${esc(p.label)}</td>${valueCell(r, p.id)}<td class="small dim">${v ? esc(String(METHOD(v.method)?.label ?? v.method)) : ''}</td></tr>`; }).join('')}</tbody></table>`).join('');
  const m = s.machine;
  const machine = m ? `<table class="kv"><tbody>${MACHINE.filter(f => m[f.id] != null).map(f => `<tr><td>${esc(f.label)}</td><td class="num">${esc(String(m[f.id]))}${f.unit && f.type !== 'string' ? ` ${esc(String(f.unit))}` : ''}</td></tr>`).join('')}<tr><td></td><td>${statusBadge(m.status)}</td></tr></tbody></table>` : '<p class="faint">No machine settings.</p>';
  return `
  <div class="drawhead"><div><div class="kicker">${s.sample_id} ${statusBadge(s.status)}</div><div class="txtitle">${esc(s.sample_name)}</div></div>${KIOSK ? `<button class="btn" data-close aria-label="close sample ${s.sample_id}">close sample ×</button>` : '<button class="btn" data-close aria-label="close the full record">close record ×</button>'}</div>
  <div class="drawcols">
    <div>
      <div class="subhead">SAMPLE<i></i></div>
      <table class="kv"><tbody>
        ${row('knitted', s.sample_date)}${row('record of', s.data_as_of)}${row('status', `${esc(s.status)} <span class="small faint">${esc(String(STATUS(s.status)?.definition ?? ''))}</span>`)}
        ${row('structure', `${esc(st.label)} <span class="dim">· ${esc(r.family)} family</span>`)}
        ${row('', `<span class="small dim">${esc(st.definition)}</span>`)}
        ${exp ? row('pattern', `<a href="#grammar/editor/experiments">Knit Grammar experiment: ${esc(exp.title)} ›</a>`) : ''}
        ${row('3D model', '<span class="small dim" data-mnote></span>')}
        ${row('origin', `${esc(r.origin)} <span class="small faint">over all its fibres (material_bank ADR-0004)</span>`)}
      </tbody></table>
      <div class="subhead">YARNS<i></i></div>${yarns}
      <div class="subhead">MACHINE<i></i></div>${machine}
      <div class="subhead">TAG<i></i></div>
      <table class="kv"><tbody>${row('address', `<code>${esc(sampleUrl(s.sample_id))}</code>`)}${row('on the tag', `${tag.bytes} of ${TAG_DATA_BYTES} bytes${tag.cut.length ? `; left off: ${esc(tag.cut.join(', '))}` : '; everything fits'}`)}</tbody></table>
    </div>
    <div>${perf}<p class="small faint">Units, methods and statuses: <a href="https://github.com/NijatM/KnittingPixelArtEditor/blob/main/docs/TAG_FORMAT.md" target="_blank" rel="noopener">docs/TAG_FORMAT.md</a>, src/taxonomy/vocab. Field names follow the material_bank v0.2 conventions (Tailored Materiality Group).</p></div>
  </div>`;
}
