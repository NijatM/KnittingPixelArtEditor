// Knitting Taxonomy: knitted samples in frames, each with an NFC tag that holds its address (#taxonomy/SMP_0001).
// Loaded by app.ts the first time the section opens. Three views of the same samples, toggled in the bar: Samples,
// a shelf of spines (shelf.ts); Lineage, fibres → yarns → samples → structures (lineage.ts); Performance, a map of
// two properties (perf.ts). In each, pointing at a sample lifts it; resting on it for DWELL ms makes it the current
// sample, shown in the band below; a click pins it there (the address follows); a second click or Esc unpins. The
// current sample's frame flies from its mark to the preview in 3D (stage.ts). Search and keys work in every view.
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
let stage: Stage | null = null, face: Face = 'model', first = true, instant = false;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

const SHELL = `
<header class="txbar">
  <div class="txname"><a href="#" class="homelink">Nijat Mahamaliyev</a><span class="dim small">Tailored Materiality Research</span></div>
  <div class="seg secseg" aria-label="section"><a href="#portrait">portrait</a><a href="#grammar">grammar</a><a href="#taxonomy" class="on" aria-current="page">taxonomy</a></div>
  <div class="seg txviews" role="group" aria-label="view"><button data-view="samples" class="on" aria-pressed="true">samples</button><button data-view="lineage" aria-pressed="false">lineage</button><button data-view="performance" aria-pressed="false">performance</button></div>
  <input class="txfind" type="search" placeholder="find: ID, fibre, yarn, structure…" aria-label="find samples" spellcheck="false" autocomplete="off">
  <span class="txcount small dim" aria-live="polite"></span>
  <div class="seg txsort" role="group" aria-label="order"><span class="small dim">order</span><button data-sort="id" class="on">ID</button><button data-sort="structure">structure</button><button data-sort="origin">origin</button></div>
  <div class="txaxes" role="group" aria-label="axes" hidden><label class="small dim">x <select data-axis="x"></select></label><label class="small dim">y <select data-axis="y"></select></label></div>
  <span class="txlive" aria-live="polite"></span>
</header>
<div class="txnotice small" hidden></div>
<div class="txmain">
  <div class="txshelf" tabindex="0" role="listbox" aria-label="samples"></div>
  <div class="txlin" tabindex="0" role="group" aria-label="lineage: fibres, yarns, samples and structures; arrow keys move along the samples" hidden></div>
  <div class="txperf" tabindex="0" role="group" aria-label="performance map; arrow keys move between samples" hidden></div>
  <section class="txdrawer" aria-label="full record" hidden></section>
</div>
<footer class="txband">
  <div class="txleft"></div>
  <div class="txpreview"><div class="txview"></div><div class="txcap small"></div></div>
  <div class="txright"></div>
</footer>`;

export async function init(el: HTMLElement) {
  root = el;
  root.innerHTML = SHELL;
  find = $<HTMLInputElement>('.txfind');
  db = await load();
  box = $('.txshelf');
  shelf = mountShelf(box, db, events);
  views.samples = shelf;
  stage = mountStage(root, $('.txview'), db, shelf);
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
  new ResizeObserver(() => { if ($(BOX[view]).clientWidth) v().resize(); }).observe($('.txmain'));

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('[data-sort]');
    if (s) { sort = s.dataset.sort as SortKey; root.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('on', b === s)); shelf.layout(sort, true); search(find.value); return; }
    const w = t.closest<HTMLElement>('[data-view]');
    if (w) { setView(w.dataset.view as ViewName); return; }
    if (t.closest('[data-pin]')) { if (current) (pinned ? unpin() : pin(current)); return; }
    if (t.closest('[data-full]')) { openDrawer(!drawer); return; }
    if (t.closest('[data-close]')) { openDrawer(false); return; }
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
    if (drawer) openDrawer(false); else if (pinned) unpin();
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
  if (/^SMP_\d{4}$/.test(id)) {
    const r = db.byId.get(id);
    if (r) { reveal(r); pin(r); return; }
    missing = id; // keep the address as asked, show that there is no such sample
    pinned = false;
    v().setPinned(null);
    show(null);
  }
  instant = false;
  render();
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
  const el = $(BOX[name]);
  el.hidden = false;
  views[name] ??= name === 'lineage' ? mountLineage(el, db, events) : mountPerf(el, db, events);
  v().setCurrent(current?.s.sample_id ?? null);
  v().setPinned(pinned && current ? current.s.sample_id : null);
  v().show(true);
  stage?.source(v());
  search(find.value);
  root.querySelectorAll<HTMLElement>('[data-view]').forEach(b => { const on = b.dataset.view === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('.txsort').hidden = name !== 'samples';
  $('.txaxes').hidden = name !== 'performance';
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
  v().setLifted(r?.s.sample_id ?? null);
  if (pinned) return;
  if (r) dwell = window.setTimeout(() => show(r), DWELL);
  else leaveT = window.setTimeout(() => { if (!pinned && !overBand) show(null); }, LEAVE);
}
function click(r: Rec) {
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
  if (!r && drawer) openDrawer(false);
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
  render();
}
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
  if (drawer) { d.innerHTML = fullRecord(current!); notes(current!); d.hidden = false; requestAnimationFrame(() => d.classList.add('open')); }
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

function render() {
  const r = current, left = $('.txleft'), right = $('.txright');
  root.classList.toggle('pinned', pinned);
  if (!r) {
    left.innerHTML = missing
      ? `<div class="kicker">${esc(missing)}</div><p class="warn">No sample with this ID here.</p>`
      : `<div class="kicker">SAMPLE</div><p class="dim">Point at a sample to see it here; click to keep it. A tag opens its sample directly.</p>`;
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
    <div class="inline"><button class="btn${pinned ? ' on' : ''}" data-pin aria-pressed="${pinned}">${pinned ? 'pinned' : 'pin'}</button><button class="btn" data-full aria-expanded="${drawer}">${drawer ? 'close record' : 'full record ›'}</button></div>`;
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
  <div class="drawhead"><div><div class="kicker">${s.sample_id} ${statusBadge(s.status)}</div><div class="txtitle">${esc(s.sample_name)}</div></div><button class="btn" data-close aria-label="close the full record">close ×</button></div>
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
