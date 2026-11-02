// The Samples view's shelf: every sample as a spine standing on a board, drawn with the hairline kernel. The camera
// looks straight at the shelf (azimuth 0), so every spine has the same shape: one path for all of them, moved into
// place with a CSS transform. That keeps the vertical IDs sharp and the rows level, and lets a re-sort slide the
// spines to their new places. A spine shows its sample ID, a mark for the structure family and one band per yarn
// in its origin colours (a blend split by share, unknown fibres hatched). Hit tests use the layout, not the DOM.
import { HL } from '../hl';
import { groups, type DB, type Rec, type SortKey } from './data';

const { Cam, proj, facing, prism, rings, mk } = HL;

const SW = 16, GAP = 1, PITCH = SW + GAP, GROUP_GAP = 20, MARGIN = 24, DEPTH = 20, K = 0.36, BOARD = 12, LIFT_ROOM = 18, ROW_GAP = 10;
const ZF = Math.sqrt(1 - K * K), BAND = 4.5, BAND_GAP = 1.5, BAND_FOOT = 6, LABEL_CHAR = 6.6; // px per label letter, 9 px with spacing
const UNDER = (DEPTH + 5) * K - DEPTH * K + BOARD; // board front, below a spine's foot

/** Hairline marks for the four families, 12 × 8 px: a knit V, two rib wales, two purl ridges, interlocked Vs. */
const MARKS: Record<string, string> = {
  plain: 'M2 0L6 7L10 0',
  rib: 'M3.5 0V8M8.5 0V8',
  purl: 'M2 2H10M2 6H10',
  interlock: 'M2 0L6 3.5L10 0M2 4.5L6 8L10 4.5',
  unknown: 'M2 4H10',
};

export type Dir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';
export interface Shelf {
  layout(by: SortKey, animate: boolean): void;
  resize(): void;
  setLifted(id: string | null): void;
  setCurrent(id: string | null): void;
  setPinned(id: string | null): void;
  setMatches(ids: Set<string> | null): void;
  neighbour(id: string | null, d: Dir): Rec | null;
  /** Shelf order (the sort switch's), first to last. */
  order(): Rec[];
  /** The spine element, for scrolling it into view and screen-reader focus. */
  el(id: string): SVGGElement | null;
  /** The spine's front face on screen: where its 3D frame (stage.ts) leaves from and lands. */
  face(id: string): DOMRect | null;
  /** Hides a spine while its frame is out (stage.ts). */
  setAway(id: string, away: boolean): void;
  destroy(): void;
}

interface Spine { rec: Rec; g: SVGGElement; sil: SVGPathElement; cr: SVGPathElement; mark: SVGPathElement; id: SVGTextElement; bands: SVGGElement; nb: number }

export function mountShelf(box: HTMLElement, db: DB, on: { hover(r: Rec | null): void; click(r: Rec): void }): Shelf {
  HL.inject(document);
  box.setAttribute('data-hairline', 'tx');
  box.setAttribute('data-hairline-theme', 'dark');
  const svg = mk('svg', { class: 'txsvg', 'aria-hidden': 'true' }, box) as SVGSVGElement;
  const defs = mk('defs', {}, svg);
  const unknown = db.colours.get('unknown') ?? '#6e6e6e';
  const hatch = mk('pattern', { id: 'tx-hatch', patternUnits: 'userSpaceOnUse', width: 3, height: 3, patternTransform: 'rotate(45)' }, defs);
  mk('rect', { width: 3, height: 3, style: `fill:${unknown};opacity:.35` }, hatch);
  mk('rect', { width: 1.3, height: 3, style: `fill:${unknown}` }, hatch);
  const boards = mk('g', {}, svg), labels = mk('g', { class: 'glabels' }, svg), spinesG = mk('g', {}, svg);
  const pin = mk('ellipse', { class: 'dot pinmark', rx: 2.2, ry: 2.2 }, null) as SVGEllipseElement;

  const C = Cam(0, K, 1);
  C.oy = -DEPTH * K; // a spine's front foot at (0, 0)
  const P = proj(C), front = facing(C);

  const spines = new Map<string, Spine>();
  for (const rec of db.recs) {
    const g = mk('g', { class: 'sp', id: `sp-${rec.s.sample_id}` }, spinesG) as SVGGElement;
    const lift = mk('g', { class: 'lift' }, g);
    const sil = mk('path', { class: 'sil' }, lift), cr = mk('path', { class: 'nf lo' }, lift);
    const bands = mk('g', {}, lift) as SVGGElement;
    rec.yarns.forEach((u, j) => {
      const y = -(BAND_FOOT + (j + 1) * BAND + j * BAND_GAP);
      let x = 2;
      const total = u.shares.reduce((s, q) => s + q.pct, 0) || 1;
      for (const q of u.shares) {
        const w = ((SW - 4) * q.pct) / total;
        mk('rect', { x: x.toFixed(2), y, width: w.toFixed(2), height: BAND, style: `fill:${q.origin === 'unknown' ? 'url(#tx-hatch)' : db.colours.get(q.origin)}` }, bands);
        x += w;
      }
    });
    const mark = mk('path', { class: 'nf mark', d: MARKS[rec.family] ?? MARKS.unknown }, lift);
    const id = mk('text', { class: 'sid' }, lift) as SVGTextElement;
    id.textContent = rec.s.sample_id;
    spines.set(rec.s.sample_id, { rec, g, sil, cr, mark, id, bands, nb: rec.yarns.length });
  }

  // ---------------------------------------------------------------- layout
  let by: SortKey = 'id', ord: Rec[] = db.recs.slice(), rowH = 0, xoff = 0, top = 6, pinY = 0;
  let rows: { y: number; foot: number; items: { x: number; rec: Rec }[] }[] = [];

  function flow(avail: number) {
    const pos = new Map<string, { x: number; row: number }>(), labs: { row: number; x: number; text: string }[] = [];
    let x = 0, row = 0, widest = 0;
    const order: Rec[] = [];
    groups(db, by).forEach((gr, gi) => {
      if (gi > 0 && x > 0) x += GROUP_GAP - GAP;
      const text = gr.label ? `${gr.label} · ${gr.recs.length}` : '';
      gr.recs.forEach((r, k) => {
        // a group starts on the next row when its label would run past the end of this one
        const need = k === 0 && text ? Math.max(SW, text.length * LABEL_CHAR) : SW;
        if (x > 0 && x + need > avail) { widest = Math.max(widest, x - GAP); x = 0; row++; }
        if (k === 0 && text) labs.push({ row, x, text });
        pos.set(r.s.sample_id, { x, row });
        order.push(r);
        x += PITCH;
      });
    });
    widest = Math.max(widest, x - GAP);
    return { pos, labs, nrows: db.recs.length ? row + 1 : 0, widest, order };
  }

  function layout(next: SortKey, animate: boolean) {
    by = next;
    svg.classList.toggle('still', !animate);
    const W = box.clientWidth, H = box.clientHeight, f = flow(Math.max(SW, W - 2 * MARGIN));
    ord = f.order;
    const fixed = LIFT_ROOM + DEPTH * K + UNDER + ROW_GAP;
    const FH = Math.max(96, Math.min(150, Math.floor((H - 2 * top) / Math.max(1, f.nrows) - fixed)));
    rowH = fixed + FH;
    pinY = -(FH + DEPTH * K) - 7; // just above the top of a spine
    pin.setAttribute('cy', String(pinY));
    xoff = Math.round((W - f.widest) / 2);
    svg.setAttribute('viewBox', `0 0 ${W} ${Math.max(H, f.nrows * rowH + 2 * top)}`);
    svg.style.height = `${Math.max(H, f.nrows * rowH + 2 * top)}px`;
    // one spine shape for all of them
    const [ring, inner] = rings(0, 0, SW, DEPTH, 1.6, 0.8), sh = prism(P, front, ring, inner, 0, FH / ZF);
    rows = Array.from({ length: f.nrows }, (_, i) => { const y = top + i * rowH; return { y, foot: y + LIFT_ROOM + DEPTH * K + FH, items: [] }; });
    for (const sp of spines.values()) {
      const p = f.pos.get(sp.rec.s.sample_id)!, row = rows[p.row];
      row.items.push({ x: p.x, rec: sp.rec });
      sp.g.style.transform = `translate(${xoff + p.x}px, ${row.foot}px)`;
      sp.sil.setAttribute('d', sh.sil);
      sp.cr.setAttribute('d', sh.crease);
      sp.mark.setAttribute('transform', `translate(2 ${-FH + 7})`);
      const above = BAND_FOOT + sp.nb * (BAND + BAND_GAP) + 4;
      sp.id.setAttribute('transform', `translate(${SW / 2} ${-above}) rotate(-90)`);
      sp.g.setAttribute('role', 'option');
    }
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
    boards.replaceChildren();
    for (const r of rows) {
      const [br, bi] = rings(-8, -3, f.widest + 8, DEPTH + 5, 2, 1), s = prism(P, front, br, bi, -BOARD / ZF, 0);
      const g = mk('g', { transform: `translate(${xoff} ${r.foot})` }, boards);
      mk('path', { class: 'sil', d: s.sil }, g);
      mk('path', { class: 'nf lo', d: s.crease }, g);
    }
    labels.replaceChildren();
    for (const l of f.labs) {
      const t = mk('text', { class: 'glabel', x: xoff + l.x, y: rows[l.row].foot + UNDER - 3.5 }, labels);
      t.textContent = l.text;
    }
    if (!animate) requestAnimationFrame(() => svg.classList.remove('still'));
  }

  // ---------------------------------------------------------------- pointer
  function hit(e: PointerEvent | MouseEvent): Rec | null {
    const b = svg.getBoundingClientRect(), px = e.clientX - b.left - xoff, py = e.clientY - b.top;
    const row = rows.find(r => py >= r.y && py <= r.foot + UNDER);
    if (!row) return null;
    let lo = 0, hi = row.items.length - 1, at = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (row.items[m].x <= px) { at = m; lo = m + 1; } else hi = m - 1; }
    return at >= 0 && px < row.items[at].x + PITCH ? row.items[at].rec : null;
  }
  let under: Rec | null = null;
  const move = (e: PointerEvent) => { const r = hit(e); if (r !== under) { under = r; on.hover(r); } };
  const leave = () => { if (under) { under = null; on.hover(null); } };
  const click = (e: MouseEvent) => { const r = hit(e); if (r) on.click(r); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('click', click);

  // ---------------------------------------------------------------- state classes
  const mark = (cls: string) => { let cur: string | null = null; return (id: string | null) => { if (cur) spines.get(cur)?.g.classList.remove(cls); cur = id; if (id) spines.get(id)?.g.classList.add(cls); }; };
  const lifted = mark('up'), current = mark('cur'), pinned = mark('pin');

  return {
    layout,
    resize: () => layout(by, false),
    setLifted: lifted,
    setCurrent: current,
    setPinned(id) {
      pinned(id);
      for (const sp of spines.values()) sp.g.setAttribute('aria-selected', String(sp.rec.s.sample_id === id));
      const sp = id ? spines.get(id) : null;
      if (sp) { pin.setAttribute('cx', String(SW / 2)); pin.setAttribute('cy', String(pinY)); sp.g.firstElementChild!.append(pin); }
      else pin.remove();
    },
    setMatches(ids) { for (const [k, sp] of spines) sp.g.classList.toggle('dim', !!ids && !ids.has(k)); },
    neighbour(id, d) {
      if (!ord.length) return null;
      if (d === 'home') return ord[0];
      if (d === 'end') return ord[ord.length - 1];
      const i = id ? ord.findIndex(r => r.s.sample_id === id) : -1;
      if (i < 0) return ord[0];
      if (d === 'left' || d === 'right') return ord[Math.max(0, Math.min(ord.length - 1, i + (d === 'left' ? -1 : 1)))];
      const ri = rows.findIndex(r => r.items.some(it => it.rec === ord[i])), row = rows[ri + (d === 'up' ? -1 : 1)];
      if (!row) return ord[i];
      const x = rows[ri].items.find(it => it.rec === ord[i])!.x;
      return row.items.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)).rec;
    },
    order: () => ord,
    el: id => spines.get(id)?.g ?? null,
    face: id => {
      const b = spines.get(id)?.sil.getBoundingClientRect();
      return b?.width ? new DOMRect(b.x, b.y + DEPTH * K, b.width, b.height - DEPTH * K) : null;
    },
    setAway: (id, away) => spines.get(id)?.g.classList.toggle('away', away),
    destroy() { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerleave', leave); svg.removeEventListener('click', click); svg.remove(); },
  };
}
