// The Lineage view: the collection as four layers, fibres → yarns → samples → structures, joined by hairlines.
// Fibres stand by origin and structures in the vocabulary's order (by family); yarns and samples are ordered
// between them so that lines cross as little as they can (layered barycentre sweeps, the ordering with the fewest
// crossings kept), which puts samples sharing yarns side by side. The sample row is a fisheye: ~4 px ticks at
// rest, widened under the pointer (or round the current sample) to ~16 px with their IDs while the rest squeeze.
// Pointing at anything lights its whole chain by brightness, never by hue; the rest fades to 25 %. Drawn on a
// canvas (view.ts), only when something changes.
import { fibreLine, type DB, type Rec } from './data';
import { bands, hatch, palette, surface, type View, type ViewEvents } from './view';

/** side margin, the gutter with the layer names, the lens's widest tick and its half-width (in ticks) */
const M = 24, GUT = 88, LENS = 16, R = 7;
/** a phone: narrower margin and layer-name column */
const NARROW = 560, M_N = 12, GUT_N = 64;
const TICK_H = 26, ID_H = 56, NODE_H = 6, FADE = 0.25, TAU = 70;
const ORIGINS = ['natural', 'regenerated', 'synthetic', 'unknown'];
const NAMES = ['FIBRES', 'YARNS', 'SAMPLES', 'STRUCTURES'];

interface Node {
  layer: number; key: string; label: string; ups: Node[]; downs: Node[]; pos: number; x: number; w: number;
  /** where each line meets this node, as a share of its width, ordered like the nodes at the other end */
  ports: Map<Node, number>;
  rec?: Rec; fill?: string; shares?: { origin: string; pct: number }[]; more?: string;
}

const bump = (t: number) => (Math.abs(t) >= 1 ? 0 : (1 + Math.cos(Math.PI * t)) / 2);

export function mountLineage(box: HTMLElement, db: DB, on: ViewEvents): View {
  const s = surface(box), ctx = s.ctx;
  box.setAttribute('data-hairline-theme', 'dark');
  const pal = palette(box), unknown = hatch(ctx, db.colours.get('unknown') ?? '#6e6e6e');

  // ---------------------------------------------------------------- the graph
  const nodes = new Map<string, Node>(), edges: [Node, Node][] = [];
  const node = (layer: number, key: string, label: string, o: Partial<Node> = {}) => {
    let n = nodes.get(`${layer}${key}`);
    if (!n) nodes.set(`${layer}${key}`, (n = { layer, key, label, ups: [], downs: [], pos: 0, x: 0, w: 0, ports: new Map(), ...o }));
    return n;
  };
  const link = (a: Node, b: Node) => { if (!a.downs.includes(b)) { a.downs.push(b); b.ups.push(a); edges.push([a, b]); } };
  const S = db.recs.map(r => node(2, r.s.sample_id, r.s.sample_id, { rec: r }));
  db.recs.forEach((r, i) => {
    for (const u of r.yarns) {
      const yn = node(1, u.yarn.yarn_id, u.yarn.yarn_id, { shares: u.shares, more: fibreLine(db, u.yarn) });
      if (!yn.ups.length) for (const c of u.yarn.composition) {
        const f = db.fibers.get(c.fiber_id);
        link(node(0, c.fiber_id, f?.fiber_name ?? c.fiber_id, { fill: f?.fiber_origin ?? 'unknown', more: f ? `${f.fiber_type} · ${f.fiber_origin}` : '' }), yn);
      }
      link(yn, S[i]);
    }
    link(S[i], node(3, r.structure.id, r.structure.label));
  });
  const layer = (l: number) => [...nodes.values()].filter(n => n.layer === l);
  const F = layer(0), Y = layer(1), T = layer(3);
  for (const t of T) t.more = `${t.downs.length} sample${t.downs.length === 1 ? '' : 's'}`;

  // ---------------------------------------------------------------- order
  const number = (L: Node[]) => L.forEach((n, i) => (n.pos = i));
  F.sort((a, b) => ORIGINS.indexOf(a.fill!) - ORIGINS.indexOf(b.fill!) || a.label.localeCompare(b.label));
  T.sort((a, b) => (db.structures.findIndex(t => t.id === a.key) + 1 || 999) - (db.structures.findIndex(t => t.id === b.key) + 1 || 999));
  number(F); number(T); number(S);
  const mean = (ns: Node[], n: number) => (ns.length ? ns.reduce((s, m) => s + m.pos, 0) / ns.length / Math.max(1, n - 1) : -1);
  const by = (L: Node[], key: (n: Node) => number) => {
    const k = new Map(L.map(n => [n, key(n)]));
    L.sort((a, b) => (k.get(a)! < 0 || k.get(b)! < 0 ? 0 : k.get(a)! - k.get(b)!) || a.pos - b.pos);
    number(L);
  };
  // crossings between two layers: lines sorted by their upper end, inversions of their lower end
  const crossings = (lines: [Node, Node][], n: number) => {
    const l = lines.map(([a, b]) => [a.pos, b.pos]).sort((p, q) => p[0] - q[0] || p[1] - q[1]), tree = new Int32Array(n + 1);
    let c = 0;
    for (let i = l.length - 1; i >= 0; i--) {
      for (let j = l[i][1]; j > 0; j -= j & -j) c += tree[j];
      for (let j = l[i][1] + 1; j <= n; j += j & -j) tree[j]++;
    }
    return c;
  };
  const between = [0, 1, 2].map(l => edges.filter(([a]) => a.layer === l));
  const total = () => crossings(between[0], Y.length) + crossings(between[1], S.length) + crossings(between[2], T.length);
  by(Y, n => mean(n.ups, F.length));
  let best = Infinity, keep: [Node[], Node[]] = [Y.slice(), S.slice()];
  for (let it = 0; it < 12; it++) {
    by(S, n => mean(n.ups, Y.length)); by(Y, n => mean(n.downs, S.length));
    by(Y, n => mean(n.ups, F.length)); by(S, n => mean(n.ups, Y.length));
    const c = total();
    if (c < best) { best = c; keep = [Y.slice(), S.slice()]; }
  }
  Y.splice(0, Y.length, ...keep[0]); S.splice(0, S.length, ...keep[1]);
  number(Y); number(S);
  for (const n of nodes.values()) for (const side of [n.ups, n.downs]) side.slice().sort((a, b) => a.pos - b.pos).forEach((m, k, a) => n.ports.set(m, (k + 0.5) / a.length));
  const ord = S.map(n => n.rec!), index = new Map(ord.map((r, i) => [r.s.sample_id, i]));

  // ---------------------------------------------------------------- geometry
  const N = S.length, xs = new Float64Array(N), ws = new Float64Array(N);
  let x0 = 0, wr = 0, yF = 0, yY = 0, yS = 0, yT = 0, m = M;
  function place() {
    const narrow = s.W < NARROW;
    m = narrow ? M_N : M; x0 = m + (narrow ? GUT_N : GUT); wr = Math.max(100, s.W - x0 - m);
    yF = 34; yT = s.H - 34 - NODE_H;
    const room = Math.max(60, yT - yF - 2 * NODE_H - TICK_H);
    yY = yF + NODE_H + room * 0.26; yS = yY + NODE_H + room * 0.42;
    for (const [L, most, share] of [[F, 40, 0.6], [Y, 14, 1], [T, 64, 0.7]] as [Node[], number, number][]) {
      const slot = wr / Math.max(1, L.length);
      for (const n of L) { n.w = Math.max(1, Math.min(most, share === 1 ? slot - 2 : slot * share)); n.x = x0 + slot * (n.pos + 0.5) - n.w / 2; }
    }
  }
  // the lens: strength a (0..1) centred at c (in ticks); its ticks widen to L, the others share what is left
  let amp = 0, ampT = 0, c = 0, px: number | null = null;
  const lens = (cc: number, a: number) => {
    const L = Math.max(LENS, wr / Math.max(1, N)), lo = Math.max(0, Math.floor(cc - R)), hi = Math.min(N, Math.ceil(cc + R));
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += a * bump((j + 0.5 - cc) / R);
    return { L, lo, hi, b: Math.max(0.2, (wr - L * sum) / Math.max(1e-6, N - sum)) };
  };
  /** where index t (fractional) lands, for a lens centred at cc */
  const xAt = (t: number, cc: number, a: number) => {
    const { L, lo, hi, b } = lens(cc, a), k = Math.max(0, Math.min(N - 1, Math.floor(t)));
    let x = x0 + b * k;
    for (let j = lo; j < Math.min(k, hi); j++) x += (L - b) * a * bump((j + 0.5 - cc) / R);
    return x + (t - k) * (b + (L - b) * a * bump((k + 0.5 - cc) / R));
  };
  /** the lens centre that puts itself under the pointer */
  const under = (p: number) => {
    let lo = 0, hi = N;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (xAt(m, m, amp) < p) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  function ticks() {
    const { L, b } = lens(c, amp);
    let x = x0;
    for (let i = 0; i < N; i++) { const w = b + (L - b) * amp * bump((i + 0.5 - c) / R); xs[i] = x; ws[i] = w; x += w; }
  }
  const left = (n: Node) => (n.layer === 2 ? xs[n.pos] : n.x), width = (n: Node) => (n.layer === 2 ? ws[n.pos] : n.w);
  const top = (n: Node) => [yF, yY, yS, yT][n.layer], foot = (n: Node) => top(n) + (n.layer === 2 ? TICK_H : NODE_H);
  const port = (n: Node, m: Node) => left(n) + width(n) * (n.ports.get(m) ?? 0.5);
  const gapOf = (w: number) => (w > 3 ? 1 : 0);

  // ---------------------------------------------------------------- state
  let visible = false, raf = 0, last = 0, mx: number | null = null, my = 0;
  let hoverNode: Node | null = null, hoverRec: Rec | null = null, lifted = -1, cur = -1, pinned = -1;
  let matches: Set<string> | null = null, lit: Set<Node> | null = null, litDirty = true;
  const away = new Set<string>();

  function chain(n: Node, out: Set<Node>) {
    out.add(n);
    const up = (m: Node) => { for (const u of m.ups) if (!out.has(u)) { out.add(u); up(u); } };
    const down = (m: Node) => { for (const d of m.downs) if (!out.has(d)) { out.add(d); down(d); } };
    up(n); down(n);
  }
  function light() {
    litDirty = false;
    // what the pointer is on; else the search's matches; else the current sample
    const focus = hoverNode ?? (matches || cur < 0 ? null : S[cur]);
    lit = null;
    if (focus) chain(focus, (lit = new Set()));
    else if (matches) { lit = new Set(); for (const n of S) if (matches.has(n.key)) chain(n, lit); }
  }

  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };
  function frame(now: number) {
    raf = 0;
    const k = 1 - Math.exp(-(last ? Math.min(64, now - last) : 16) / TAU);
    last = now;
    amp += (ampT - amp) * k;
    if (Math.abs(ampT - amp) < 0.003) amp = ampT;
    let moving = amp !== ampT;
    if (px != null) c = under(px);
    else if (cur >= 0) { c += (amp < 0.05 ? 1 : k) * (cur + 0.5 - c); if (Math.abs(cur + 0.5 - c) < 0.01) c = cur + 0.5; else moving = true; }
    ticks();
    if (mx != null) hovered(hit(mx, my));
    if (litDirty) light();
    draw();
    if (moving) kick(); else last = 0;
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    ctx.clearRect(0, 0, s.W, s.H);
    const bright = (n: Node) => !lit || lit.has(n), seen = (n: Node) => bright(n) && (n.layer !== 2 || !matches || matches.has(n.key));
    // lines: the faded ones, then the lit chain over them
    ctx.lineWidth = 1;
    const stroke = (list: [Node, Node][], colour: string, alpha: number) => {
      ctx.globalAlpha = alpha; ctx.strokeStyle = colour; ctx.beginPath();
      for (const [a, b] of list) {
        const x1 = port(a, b), y1 = foot(a), x2 = port(b, a), y2 = top(b), m = (y1 + y2) / 2;
        ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1, m, x2, m, x2, y2);
      }
      ctx.stroke();
    };
    if (lit) { stroke(edges.filter(([a, b]) => !(lit!.has(a) && lit!.has(b))), pal.mid, FADE); stroke(edges.filter(([a, b]) => lit!.has(a) && lit!.has(b)), pal.hi, 1); }
    else stroke(edges, pal.mid, 1);
    // fibres and yarns: bars in their origin colours
    for (const n of F) { ctx.globalAlpha = seen(n) ? 1 : FADE; ctx.fillStyle = n.fill === 'unknown' ? unknown : db.colours.get(n.fill!) ?? '#6e6e6e'; ctx.fillRect(n.x, yF, n.w, NODE_H); }
    for (const n of Y) {
      ctx.globalAlpha = seen(n) ? 1 : FADE;
      const t = n.shares!.reduce((s, q) => s + q.pct, 0) || 1;
      let x = n.x;
      for (const q of n.shares!) { const w = (n.w * q.pct) / t; ctx.fillStyle = q.origin === 'unknown' ? unknown : db.colours.get(q.origin) ?? '#6e6e6e'; ctx.fillRect(x, yY, w, NODE_H); x += w; }
    }
    // samples: ticks with their yarn bands
    for (let i = 0; i < N; i++) {
      const n = S[i];
      if (away.has(n.key)) continue;
      const g = gapOf(ws[i]), up = i === lifted || i === cur ? 4 : 0;
      ctx.globalAlpha = seen(n) ? 1 : FADE;
      bands(ctx, db, unknown, n.rec!, xs[i] + g / 2, yS - up, Math.max(0.6, ws[i] - g), TICK_H);
    }
    // structures: hairline boxes
    ctx.lineWidth = 1;
    for (const n of T) { ctx.globalAlpha = seen(n) ? 1 : FADE; ctx.strokeStyle = n === hoverNode || (lit && lit.has(n)) ? pal.hi : pal.edge; ctx.strokeRect(Math.round(n.x) + 0.5, yT + 0.5, Math.round(n.w) - 1, NODE_H - 1); }
    ctx.globalAlpha = 1;
    // the current and the pointed-at sample: outlined; the pinned one: a dot above
    for (const i of new Set([cur, lifted])) if (i >= 0 && !away.has(S[i].key)) {
      const g = gapOf(ws[i]);
      ctx.strokeStyle = pal.hi; ctx.strokeRect(xs[i] + g / 2 - 0.5, yS - 4.5, Math.max(0.6, ws[i] - g) + 1, TICK_H + 1);
    }
    if (pinned >= 0) { ctx.fillStyle = pal.hi; ctx.beginPath(); ctx.arc(xs[pinned] + ws[pinned] / 2, yS + TICK_H + 9, 2.2, 0, 7); ctx.fill(); }
    labels(bright);
  }

  function labels(bright: (n: Node) => boolean) {
    ctx.textBaseline = 'middle';
    // sample IDs, read upwards above the ticks wide enough for them, on the page's ground so lines pass behind
    ctx.font = `500 9.5px ${pal.font}`;
    for (let i = 0; i < N; i++) if (ws[i] >= 11) {
      const n = S[i], cx = xs[i] + ws[i] / 2, tw = ctx.measureText(n.key).width, up = i === lifted || i === cur ? 4 : 0;
      ctx.fillStyle = pal.bg; ctx.fillRect(cx - 5.5, yS - up - 6 - tw, 11, tw + 4);
      ctx.save(); ctx.translate(cx, yS - up - 4); ctx.rotate(-Math.PI / 2);
      ctx.globalAlpha = bright(n) && (!matches || matches.has(n.key)) ? 1 : FADE;
      ctx.fillStyle = i === cur || i === lifted ? pal.bright : pal.text; ctx.fillText(n.key, 0, 0.5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // fibre, yarn and structure names: two staggered rows, a name only where it has room (the pointed-at node and
    // the lit chain's first)
    ctx.font = `10px ${pal.font}`;
    const row = (L: Node[], ys: number[], show: (n: Node) => boolean) => {
      const taken: [number, number][][] = ys.map(() => []);
      const list = L.filter(show).sort((a, b) => +(b === hoverNode) - +(a === hoverNode) || +(lit?.has(b) ?? 0) - +(lit?.has(a) ?? 0) || a.pos - b.pos);
      for (const n of list) {
        const text = n === hoverNode && n.more ? `${n.label} · ${n.more}` : n.label, tw = ctx.measureText(text).width;
        const x = Math.max(x0, Math.min(s.W - m - tw, n.x + n.w / 2 - tw / 2));
        const pref = n.pos % ys.length, r = [pref, ...ys.keys()].find(k => taken[k].every(([a, b]) => x + tw + 6 < a || x > b + 6));
        if (r == null) continue;
        taken[r].push([x, x + tw]);
        ctx.fillStyle = pal.bg; ctx.fillRect(x - 2, ys[r] - 6, tw + 4, 12);
        ctx.fillStyle = n === hoverNode || (lit && lit.has(n)) ? pal.bright : pal.text;
        ctx.globalAlpha = bright(n) ? 1 : FADE;
        ctx.fillText(text, x, ys[r]);
        ctx.globalAlpha = 1;
      }
    };
    row(F, [yF - 8, yF - 20], () => true);
    const litYarns = lit ? Y.filter(n => lit!.has(n)).length : 0;
    row(Y, [yY - 8, yY - 20], n => n === hoverNode || (!!lit && lit.has(n) && litYarns <= 24));
    row(T, [yT + NODE_H + 11, yT + NODE_H + 23], () => true);
    // the layer names in the gutter
    ctx.font = `9px ${pal.font}`;
    [F.length, Y.length, N, T.length].forEach((n, l) => {
      const y = [yF + NODE_H / 2, yY + NODE_H / 2, yS + TICK_H / 2, yT + NODE_H / 2][l];
      ctx.fillStyle = pal.text; ctx.fillText(NAMES[l], m, y - 5);
      ctx.fillStyle = pal.edge; ctx.fillText(String(n), m, y + 7);
    });
  }

  // ---------------------------------------------------------------- pointer
  function hit(x: number, y: number): Node | null {
    const near = (L: Node[]) => {
      if (!L.length) return null;
      const slot = wr / L.length, i = Math.floor((x - x0) / slot);
      return i >= 0 && i < L.length ? L[i] : null;
    };
    if (y >= yF - 26 && y <= yF + NODE_H + 4) return near(F);
    if (y >= yY - 14 && y <= yY + NODE_H + 4) return near(Y);
    if (y >= yS - ID_H && y <= yS + TICK_H + 12) {
      let lo = 0, hi = N - 1, at = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m] <= x) { at = m; lo = m + 1; } else hi = m - 1; }
      return at >= 0 && x < xs[at] + ws[at] ? S[at] : null;
    }
    if (y >= yT - 4 && y <= yT + NODE_H + 28) return near(T);
    return null;
  }
  function hovered(n: Node | null) {
    if (n === hoverNode) return;
    hoverNode = n; litDirty = true;
    box.style.cursor = n?.rec ? 'pointer' : '';
    const r = n?.rec ?? null;
    if (r !== hoverRec) { hoverRec = r; on.hover(r); }
  }
  const move = (e: PointerEvent) => {
    const b = s.cv.getBoundingClientRect();
    mx = e.clientX - b.left; my = e.clientY - b.top;
    const inLens = my >= yS - ID_H - 40 && my <= yS + TICK_H + 40;
    px = inLens ? mx : null;
    ampT = inLens || cur >= 0 ? 1 : 0;
    kick();
  };
  const leave = () => { mx = null; px = null; ampT = cur >= 0 ? 1 : 0; hovered(null); kick(); };
  // a finger lights its chain as it goes down; a tap sends no move before its click, so the click finds its own mark
  const down = (e: PointerEvent) => { if (e.pointerType !== 'mouse') move(e); };
  const click = (e: MouseEvent) => {
    const b = s.cv.getBoundingClientRect(), n = hoverNode ?? hit(e.clientX - b.left, e.clientY - b.top);
    if (n?.rec) on.click(n.rec);
  };
  s.cv.addEventListener('pointerdown', down);
  s.cv.addEventListener('pointermove', move);
  s.cv.addEventListener('pointerleave', leave);
  s.cv.addEventListener('click', click);

  const at = (id: string | null) => (id == null ? -1 : index.get(id) ?? -1);
  const redraw = () => { litDirty = true; kick(); };
  return {
    show(v) {
      visible = v;
      if (!v) { cancelAnimationFrame(raf); raf = 0; last = 0; mx = null; px = null; hoverNode = null; hoverRec = null; return; }
      if (s.fit()) { place(); if (cur >= 0) { c = cur + 0.5; amp = ampT = 1; } ticks(); redraw(); }
    },
    resize() { if (visible && s.fit()) { place(); ticks(); redraw(); } },
    setLifted(id) { lifted = at(id); kick(); },
    setCurrent(id) {
      cur = at(id);
      ampT = px != null || cur >= 0 ? 1 : 0;
      redraw();
    },
    setPinned(id) { pinned = at(id); kick(); },
    setMatches(ids) { matches = ids; redraw(); },
    neighbour(id, d) {
      if (!N) return null;
      if (d === 'home') return ord[0];
      if (d === 'end') return ord[N - 1];
      const i = at(id);
      if (i < 0) return ord[0];
      return d === 'left' ? ord[Math.max(0, i - 1)] : d === 'right' ? ord[Math.min(N - 1, i + 1)] : null;
    },
    order: () => ord,
    reveal() { /* the whole collection is on screen */ },
    face(id) {
      const i = at(id);
      if (!visible || i < 0) return null;
      const g = gapOf(ws[i]);
      return s.screen(xs[i] + g / 2, yS, Math.max(1, ws[i] - g), TICK_H);
    },
    setAway(id, a) { if (a) away.add(id); else away.delete(id); kick(); },
    destroy() { cancelAnimationFrame(raf); s.cv.removeEventListener('pointerdown', down); s.cv.removeEventListener('pointermove', move); s.cv.removeEventListener('pointerleave', leave); s.cv.removeEventListener('click', click); s.cv.remove(); },
  };
}
