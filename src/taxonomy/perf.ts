// The Performance view: a property map. Each sample is a mini spine (5 × 14 px) with its yarn bands, placed by two
// chosen properties (AXES: areal density across, course stretch up, until changed in the bar). Its outline gives
// the status of the less certain of its two values: measured solid, estimated thin, generated dashed (so every
// demo mark is dashed). A sample missing a value sits in a margin strip: no y value under the x axis (at its x),
// no x value left of the y axis (at its y), neither in the corner where the strips meet. A new axis slides the
// marks to their new places. Drawn on a canvas (view.ts), only when something changes.
import type { DB, Property, Rec } from './data';
import { bands, hatch, palette, surface, type Dir, type View, type ViewEvents } from './view';

/** The two properties on the axes; main.ts shows both among the band's key values. */
export const AXES = { x: 'areal_density', y: 'stretch_course' };
export interface Perf extends View { /** AXES changed */ axes(): void }

const MW = 5, MH = 14, SLIDE = 520, FADE = 0.25;
/** room round the plot: the y labels and the left strip; the x labels, the x name and the bottom strip */
const PAD = { l: 96, r: 28, t: 34, b: 70 };
const RANK: Record<string, number> = { generated: 0, estimated: 1, measured: 2 };
const STATUS = ['generated', 'estimated', 'measured'];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** about n round steps (1, 2 or 5 × 10^k) covering lo..hi */
function steps(lo: number, hi: number, n = 6) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB') : String(v));

export function mountPerf(box: HTMLElement, db: DB, on: ViewEvents): Perf {
  const s = surface(box), ctx = s.ctx;
  box.setAttribute('data-hairline-theme', 'dark');
  const pal = palette(box), unknown = hatch(ctx, db.colours.get('unknown') ?? '#6e6e6e');
  const recs = db.recs, N = recs.length, index = new Map(recs.map((r, i) => [r.s.sample_id, i]));
  const prop = (id: string) => db.properties.find(p => p.id === id) as Property;

  // ---------------------------------------------------------------- places
  const from = new Float64Array(N * 2), to = new Float64Array(N * 2), xy = new Float64Array(N * 2), rank = new Int8Array(N);
  let ord: Rec[] = [], t0 = 0, sx = (v: number) => v, sy = (v: number) => v, ticksX: number[] = [], ticksY: number[] = [];
  let px0 = 0, px1 = 0, py0 = 0, py1 = 0, stripY = 0, stripX = 0, missing = { x: 0, y: 0, both: 0 };
  function place(slide: boolean) {
    px0 = PAD.l; px1 = Math.max(px0 + 100, s.W - PAD.r); py0 = PAD.t; py1 = Math.max(py0 + 80, s.H - PAD.b);
    stripY = py1 + 52; stripX = 30;
    const vx = recs.map(r => r.s.performance?.[AXES.x]), vy = recs.map(r => r.s.performance?.[AXES.y]);
    const scale = (vals: (number | undefined)[], a: number, b: number): [(v: number) => number, number[]] => {
      const v = vals.filter((x): x is number => x != null);
      let lo = Math.min(...v), hi = Math.max(...v);
      if (!v.length) { lo = 0; hi = 1; } else if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.04;
      lo -= pad; hi += pad;
      return [(x: number) => a + ((x - lo) / (hi - lo)) * (b - a), steps(lo, hi)];
    };
    [sx, ticksX] = scale(vx.map(v => v?.value), px0 + MW, px1 - MW);
    [sy, ticksY] = scale(vy.map(v => v?.value), py1 - MH / 2, py0 + MH / 2);
    if (slide) from.set(xy);
    missing = { x: 0, y: 0, both: 0 };
    recs.forEach((_, i) => {
      const a = vx[i], b = vy[i];
      rank[i] = Math.min(a ? RANK[a.status] ?? 0 : 2, b ? RANK[b.status] ?? 0 : 2);
      to[i * 2] = a ? sx(a.value) : b ? stripX : stripX - (missing.both % 3) * 8;
      to[i * 2 + 1] = b ? sy(b.value) : stripY;
      if (!a && !b) missing.both++; else if (!a) missing.x++; else if (!b) missing.y++;
    });
    // left to right across the plot, then the strips
    const where = (i: number) => (vx[i] && vy[i] ? 0 : vx[i] ? 1 : vy[i] ? 2 : 3);
    ord = recs.map((_, i) => i).sort((i, j) => where(i) - where(j) || (where(i) === 2 ? to[j * 2 + 1] - to[i * 2 + 1] : to[i * 2] - to[j * 2]) || to[j * 2 + 1] - to[i * 2 + 1] || i - j).map(i => recs[i]);
    t0 = slide && !matchMedia('(prefers-reduced-motion: reduce)').matches ? performance.now() : 0;
    if (!t0) xy.set(to);
  }

  // ---------------------------------------------------------------- state
  let visible = false, raf = 0, mx: number | null = null, my = 0, hoverRec: Rec | null = null;
  let lifted = -1, cur = -1, pinned = -1, matches: Set<string> | null = null;
  const away = new Set<string>();
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };
  function frame(now: number) {
    raf = 0;
    const t = t0 ? Math.min(1, (now - t0) / SLIDE) : 1, e = ease(t);
    for (let k = 0; k < N * 2; k++) xy[k] = from[k] + (to[k] - from[k]) * e;
    if (t >= 1) t0 = 0;
    if (mx != null) hovered(hit(mx, my));
    draw();
    if (t0) kick();
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    ctx.clearRect(0, 0, s.W, s.H);
    ctx.font = `10px ${pal.font}`;
    ctx.lineWidth = 1;
    // grid, axes and their values
    ctx.strokeStyle = pal.lo; ctx.beginPath();
    for (const v of ticksX) { const x = Math.round(sx(v)) + 0.5; if (x >= px0 && x <= px1) { ctx.moveTo(x, py0); ctx.lineTo(x, py1); } }
    for (const v of ticksY) { const y = Math.round(sy(v)) + 0.5; if (y >= py0 && y <= py1) { ctx.moveTo(px0, y); ctx.lineTo(px1, y); } }
    ctx.stroke();
    ctx.strokeStyle = pal.edge; ctx.beginPath(); ctx.moveTo(px0 + 0.5, py0); ctx.lineTo(px0 + 0.5, py1 + 0.5); ctx.lineTo(px1, py1 + 0.5); ctx.stroke();
    ctx.fillStyle = pal.text; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (const v of ticksX) { const x = sx(v); if (x >= px0 && x <= px1) ctx.fillText(num(v), x, py1 + 6); }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const v of ticksY) { const y = sy(v); if (y >= py0 && y <= py1) ctx.fillText(num(v), px0 - 8, y); }
    const X = prop(AXES.x), Y = prop(AXES.y);
    ctx.fillStyle = pal.bright;
    ctx.fillText(`${X.label} (${X.unit}) →`, px1, py1 + 30);
    ctx.textAlign = 'left';
    ctx.fillText(`↑ ${Y.label} (${Y.unit})`, px0, py0 - 16);
    // the strips
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    if (missing.y) ctx.fillText(`no ${Y.label}: ${missing.y}`, px0, py1 + 30);
    if (missing.x) ctx.fillText(`no ${X.label}: ${missing.x}`, 6, py0 - 3);
    if (missing.both) ctx.fillText(`neither: ${missing.both}`, 6, stripY + 13);
    ctx.strokeStyle = pal.lo; ctx.setLineDash([1, 3]); ctx.beginPath();
    ctx.moveTo(px0, stripY + 0.5); ctx.lineTo(px1, stripY + 0.5); ctx.moveTo(stripX + 0.5, py0); ctx.lineTo(stripX + 0.5, py1);
    ctx.stroke(); ctx.setLineDash([]);
    // the legend
    ctx.textAlign = 'right';
    let lx = px1;
    for (const st of STATUS.slice().reverse()) {
      ctx.fillStyle = pal.text; ctx.fillText(st, lx, py0 - 16);
      lx -= ctx.measureText(st).width + 6 + MW;
      outline(lx, py0 - 16 - MH / 2, RANK[st], pal.edge);
      lx -= 14;
    }
    ctx.fillText('status of the less certain value:', lx, py0 - 16);
    // the marks: faded ones first, the lifted and current ones last
    const top = new Set([lifted, cur]);
    for (const faded of [true, false]) for (let i = 0; i < N; i++) {
      const r = recs[i];
      if (away.has(r.s.sample_id) || top.has(i) || faded !== (!!matches && !matches.has(r.s.sample_id))) continue;
      mark(i, faded ? FADE : 1, pal.edge);
    }
    for (const i of top) if (i >= 0 && !away.has(recs[i].s.sample_id)) mark(i, 1, pal.hi, true);
    if (pinned >= 0 && !away.has(recs[pinned].s.sample_id)) { ctx.fillStyle = pal.hi; ctx.beginPath(); ctx.arc(xy[pinned * 2], xy[pinned * 2 + 1] - MH / 2 - 5, 2.2, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function outline(x: number, y: number, rk: number, colour: string) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = rk === 1 ? 0.6 : rk === 2 ? 1.2 : 1;
    ctx.setLineDash(rk === 0 ? [2, 2] : []);
    ctx.strokeRect(x - 0.5, y - 0.5, MW + 1, MH + 1);
    ctx.setLineDash([]); ctx.lineWidth = 1;
  }
  function mark(i: number, alpha: number, colour: string, named = false) {
    const x = xy[i * 2] - MW / 2, y = xy[i * 2 + 1] - MH / 2, r = recs[i];
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.bg; ctx.fillRect(x - 1, y - 1, MW + 2, MH + 2);
    bands(ctx, db, unknown, r, x, y, MW, MH);
    outline(x, y, rank[i], colour);
    if (named) {
      ctx.font = `500 9.5px ${pal.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(r.s.sample_id).width;
      ctx.fillStyle = pal.bg; ctx.fillRect(x + MW + 4, y + MH / 2 - 6, tw + 4, 12);
      ctx.fillStyle = pal.bright; ctx.fillText(r.s.sample_id, x + MW + 6, y + MH / 2);
      ctx.font = `10px ${pal.font}`;
    }
  }

  // ---------------------------------------------------------------- pointer
  function hit(x: number, y: number): Rec | null {
    let best = -1, d = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = Math.abs(xy[i * 2] - x), dy = Math.abs(xy[i * 2 + 1] - y);
      if (dx > MW / 2 + 2 || dy > MH / 2 + 2) continue;
      const e = dx * dx + dy * dy - (i === cur || i === lifted ? 1e3 : 0);
      if (e < d) { d = e; best = i; }
    }
    return best >= 0 ? recs[best] : null;
  }
  function hovered(r: Rec | null) {
    if (r === hoverRec) return;
    hoverRec = r;
    box.style.cursor = r ? 'pointer' : '';
    on.hover(r);
  }
  const move = (e: PointerEvent) => { const b = s.cv.getBoundingClientRect(); mx = e.clientX - b.left; my = e.clientY - b.top; hovered(hit(mx, my)); };
  const leave = () => { mx = null; hovered(null); };
  const click = () => { if (hoverRec) on.click(hoverRec); };
  s.cv.addEventListener('pointermove', move);
  s.cv.addEventListener('pointerleave', leave);
  s.cv.addEventListener('click', click);

  const at = (id: string | null) => (id == null ? -1 : index.get(id) ?? -1);
  return {
    show(v) {
      visible = v;
      if (!v) { cancelAnimationFrame(raf); raf = 0; mx = null; hoverRec = null; return; }
      if (s.fit()) { place(false); kick(); }
    },
    resize() { if (visible && s.fit()) { place(false); kick(); } },
    axes() { if (visible) { place(true); kick(); } else if (s.W) place(false); },
    setLifted(id) { lifted = at(id); kick(); },
    setCurrent(id) { cur = at(id); kick(); },
    setPinned(id) { pinned = at(id); kick(); },
    setMatches(ids) { matches = ids; kick(); },
    neighbour(id, d: Dir) {
      if (!N) return null;
      if (d === 'home') return ord[0];
      if (d === 'end') return ord[N - 1];
      const i = at(id);
      if (i < 0) return ord[0];
      if (d === 'left' || d === 'right') { const k = ord.indexOf(recs[i]); return ord[Math.max(0, Math.min(N - 1, k + (d === 'left' ? -1 : 1)))]; }
      // up and down: the nearest mark that way, sideways distance counting double
      const sgn = d === 'up' ? -1 : 1, x = xy[i * 2], y = xy[i * 2 + 1];
      let best = -1, cost = Infinity;
      for (let j = 0; j < N; j++) {
        const dy = (xy[j * 2 + 1] - y) * sgn, c = dy + 2 * Math.abs(xy[j * 2] - x);
        if (j !== i && dy > 0.5 && c < cost) { cost = c; best = j; }
      }
      return best >= 0 ? recs[best] : recs[i];
    },
    order: () => ord,
    reveal() { /* the whole map is on screen */ },
    face(id) {
      const i = at(id);
      return visible && i >= 0 ? s.screen(xy[i * 2] - MW / 2, xy[i * 2 + 1] - MH / 2, MW, MH) : null;
    },
    setAway(id, a) { if (a) away.add(id); else away.delete(id); kick(); },
    destroy() { cancelAnimationFrame(raf); s.cv.removeEventListener('pointermove', move); s.cv.removeEventListener('pointerleave', leave); s.cv.removeEventListener('click', click); s.cv.remove(); },
  };
}
