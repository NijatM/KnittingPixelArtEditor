// Knitting Taxonomy: knitted samples in frames, each with an NFC tag that holds its address (#taxonomy/SMP_0001).
// Loaded by app.ts the first time the section opens. The Samples view is a shelf of spines (shelf.ts); Lineage and
// Performance come later. Pointing at a spine lifts it; resting on it for DWELL ms makes it the current sample,
// shown in the band below; a click pins it there (the address follows); a second click or Esc unpins.
import { EXPERIMENTS } from '../grammar/structures';
import { sampleUrl, tagPayload, TAG_DATA_BYTES } from './core.js';
import type { Term } from './core';
import { fibreLine, fmtValue, load, vocab, type DB, type Rec, type SortKey, type YarnUse } from './data';
import { mountShelf, type Dir, type Shelf } from './shelf';

const DWELL = 120, LEAVE = 450;
/** The band's key values: areal density and thickness, then the Performance view's two axes (its defaults until it
 *  exists), each once. */
const KEY_VALUES = ['areal_density', 'thickness', 'areal_density', 'stretch_course'].filter((v, i, a) => a.indexOf(v) === i);

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const termOf = (n: string) => { const m = new Map(vocab(n).map(t => [t.id, t])); return (id: string) => m.get(id); };
const ROLE = termOf('yarn_role'), METHOD = termOf('method'), STATUS = termOf('record_status'), GROUP = vocab('property_group'), MACHINE = vocab('machine');

let root: HTMLElement, db: DB, shelf: Shelf, box: HTMLElement;
let sort: SortKey = 'id', current: Rec | null = null, pinned = false, overBand = false, drawer = false, missing = '';
let dwell = 0, leaveT = 0, matches: Rec[] | null = null;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

const SHELL = `
<header class="txbar">
  <div class="txname"><a href="#" class="homelink">Nijat Mahamaliyev</a><span class="dim small">Tailored Materiality Research</span></div>
  <div class="seg secseg" aria-label="section"><a href="#portrait">portrait</a><a href="#grammar">grammar</a><a href="#taxonomy" class="on" aria-current="page">taxonomy</a></div>
  <div class="seg txviews" role="group" aria-label="view"><button class="on" aria-pressed="true">samples</button><button disabled title="comes in a later step">lineage</button><button disabled title="comes in a later step">performance</button></div>
  <input class="txfind" type="search" placeholder="find: ID, fibre, yarn, structure…" aria-label="find samples" spellcheck="false" autocomplete="off">
  <span class="txcount small dim" aria-live="polite"></span>
  <div class="seg txsort" role="group" aria-label="order"><span class="small dim">order</span><button data-sort="id" class="on">ID</button><button data-sort="structure">structure</button><button data-sort="origin">origin</button></div>
</header>
<div class="txnotice small" hidden></div>
<div class="txmain">
  <div class="txshelf" tabindex="0" role="listbox" aria-label="samples"></div>
  <section class="txdrawer" aria-label="full record" hidden></section>
</div>
<footer class="txband">
  <div class="txleft"></div>
  <div class="txpreview"></div>
  <div class="txright"></div>
</footer>`;

export async function init(el: HTMLElement) {
  root = el;
  root.innerHTML = SHELL;
  db = await load();
  box = $('.txshelf');
  shelf = mountShelf(box, db, { hover, click });
  const n = db.recs.length;
  if (db.demo) { const t = $('.txnotice'); t.hidden = false; t.innerHTML = `<b>Demo data.</b> ${n} generated samples: every value is made up (status <i>generated</i>), none is a real sample. Real samples will replace them.`; }
  count();
  requestAnimationFrame(() => shelf.layout(sort, false));
  new ResizeObserver(() => { if (box.clientWidth) shelf.resize(); }).observe(box);

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('[data-sort]');
    if (s) { sort = s.dataset.sort as SortKey; root.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('on', b === s)); shelf.layout(sort, true); return; }
    if (t.closest('[data-pin]')) { if (current) (pinned ? unpin() : pin(current)); return; }
    if (t.closest('[data-full]')) { openDrawer(!drawer); return; }
    if (t.closest('[data-close]')) { openDrawer(false); return; }
  });
  const band = $('.txband');
  band.addEventListener('pointerenter', () => { overBand = true; clearTimeout(leaveT); });
  band.addEventListener('pointerleave', () => { overBand = false; if (!pinned) leaveT = window.setTimeout(() => { if (!pinned && !overBand) show(null); }, LEAVE); });

  const find = $<HTMLInputElement>('.txfind');
  find.addEventListener('input', () => search(find.value));
  find.addEventListener('keydown', e => {
    if (e.key === 'Enter' && matches?.length) { pin(matches[0]); reveal(matches[0]); }
    if (e.key === 'Escape') { find.value = ''; search(''); }
  });
  box.addEventListener('keydown', e => {
    const dir = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' } as Record<string, Dir>)[e.key];
    if (dir) {
      e.preventDefault();
      const r = shelf.neighbour(current?.s.sample_id ?? null, dir);
      if (r) { shelf.setLifted(r.s.sample_id); if (pinned) pin(r); else show(r); reveal(r); }
    } else if ((e.key === 'Enter' || e.key === ' ') && current) { e.preventDefault(); pinned ? unpin() : pin(current); }
  });
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
  if (/^SMP_\d{4}$/.test(id)) {
    const r = db.byId.get(id);
    if (r) { pin(r); reveal(r); return; }
    missing = id; // keep the address as asked, show that there is no such sample
    pinned = false;
    shelf.setPinned(null);
    show(null);
  }
  render();
}

// ---------------------------------------------------------------- state
function hover(r: Rec | null) {
  clearTimeout(dwell);
  clearTimeout(leaveT);
  shelf.setLifted(r?.s.sample_id ?? null);
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
  shelf.setCurrent(r?.s.sample_id ?? null);
  if (r) box.setAttribute('aria-activedescendant', `sp-${r.s.sample_id}`); else box.removeAttribute('aria-activedescendant');
  if (!r && drawer) openDrawer(false);
  render();
}
function pin(r: Rec) {
  clearTimeout(dwell);
  missing = '';
  pinned = true;
  show(r);
  shelf.setPinned(r.s.sample_id);
  history.replaceState(null, '', `#taxonomy/${r.s.sample_id}`);
  render();
}
function unpin() {
  pinned = false;
  shelf.setPinned(null);
  if (location.hash !== '#taxonomy') history.replaceState(null, '', '#taxonomy');
  render();
}
function reveal(r: Rec) { shelf.el(r.s.sample_id)?.scrollIntoView({ block: 'nearest' }); }

function search(q: string) {
  const words = q.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean);
  matches = words.length ? shelf.order().filter(r => words.every(w => r.words.includes(w))) : null;
  shelf.setMatches(matches ? new Set(matches.map(r => r.s.sample_id)) : null);
  count();
}
function count() {
  const n = db.recs.length;
  $('.txcount').textContent = matches ? `${matches.length} of ${n}` : `${n} samples`;
}

function openDrawer(on: boolean) {
  drawer = on && !!current;
  const d = $('.txdrawer');
  if (drawer) { d.innerHTML = fullRecord(current!); d.hidden = false; requestAnimationFrame(() => d.classList.add('open')); }
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
  const r = current, left = $('.txleft'), right = $('.txright'), pv = $('.txpreview');
  root.classList.toggle('pinned', pinned);
  if (!r) {
    left.innerHTML = missing
      ? `<div class="kicker">${esc(missing)}</div><p class="warn">No sample with this ID here.</p>`
      : `<div class="kicker">SAMPLE</div><p class="dim">Point at a spine to see its sample; click to keep it here. A tag opens its sample directly.</p>`;
    right.innerHTML = '';
    pv.innerHTML = frame(null);
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
    <table class="kv"><tbody>${KEY_VALUES.map(id => `<tr><td>${esc(db.properties.find(p => p.id === id)!.label)}</td>${valueCell(r, id)}</tr>`).join('')}</tbody></table>
    <div class="inline"><button class="btn${pinned ? ' on' : ''}" data-pin aria-pressed="${pinned}">${pinned ? 'pinned' : 'pin'}</button><button class="btn" data-full aria-expanded="${drawer}">${drawer ? 'close record' : 'full record ›'}</button></div>`;
  pv.innerHTML = frame(r);
  if (drawer) $('.txdrawer').innerHTML = fullRecord(r);
}

/** Until the 3D frame exists: a flat frame with the family mark in the window. */
function frame(r: Rec | null) {
  const marks: Record<string, string> = { plain: 'M-12 -10L0 10L12 -10', rib: 'M-6 -11V11M6 -11V11', purl: 'M-12 -5H12M-12 5H12', interlock: 'M-12 -11L0 -1L12 -11M-12 1L0 11L12 1', unknown: 'M-12 0H12' };
  return `<svg class="txframe${r ? '' : ' empty'}" viewBox="0 0 160 170" aria-hidden="true">
    <rect x="10" y="6" width="140" height="150" rx="3"/><rect class="win" x="28" y="24" width="104" height="104"/>
    ${r ? `<path class="m" transform="translate(80 76)" d="${marks[r.family] ?? marks.unknown}"/><text x="80" y="146">${r.s.sample_id}</text>` : ''}
  </svg>${r ? '<div class="small faint">3D model of the structure: next build step</div>' : ''}`;
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
