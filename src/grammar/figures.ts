// Hairline figures for the landing page and Learn: isometric line drawings that answer the pointer, built on the
// vendored hairline kernel and its ten rules (one bright stroke as the only highlight, no words inside, springs for
// "where", tweens for "which", a designed rest).
import { HL, type FigureMount } from '../hl';

const {
  Cam, clamp, facing, fit, hull, mk, open, place, poly, prism, proj, rings, rrect, seg, unproj,
  spring, stepS, tween, tset, tval, tdone, register, pointer, disposer, solid, put, flatDot,
} = HL;

type Pt = [number, number];
type P3 = (x: number, y: number, z: number) => Pt;

/** A rounded plate lying on a slope: from y = ya (height za) to y = yb (height zb), x0…x1 wide, t thick. */
function slab(P: P3, x0: number, x1: number, ya: number, yb: number, za: number, zb: number, t: number, r: number, b = 0) {
  const L = Math.hypot(yb - ya, zb - za), at = (u: number, v: number, dz: number): Pt => P(u, ya + (v / L) * (yb - ya), za + (v / L) * (zb - za) + dz);
  const ring = rrect(x0, 0, x1, L, r) as { u: number; v: number }[];
  const top = ring.map(q => at(q.u, q.v, 0)), bottom = ring.map(q => at(q.u, q.v, -t));
  const crease = b > 0 ? poly((rrect(x0 + b, b, x1 - b, L - b, Math.max(0.3, r - b)) as { u: number; v: number }[]).map(q => at(q.u, q.v, 0))) : '';
  return { sil: poly(hull(top.concat(bottom))), crease };
}

// ---------------------------------------------------------------- needle bed: the carriage lifts the needles under it
/** Two needle beds meeting at the top like an upside-down V, a row of needles on each, and the carriage riding above.
 *  The pointer moves the carriage; its cams push the needles under it up the slope, past the gap. */
export const needleBed: FigureMount = ({ stage, svg, read }, value) => {
  const bag = disposer();
  // a steeper camera than hairline's 2:1 view, so the back bed (sloping away) still shows its face
  const N = 12, PITCH = 9, X0 = -6, X1 = N * PITCH + 6, GAP0 = 40, GAP1 = 46, D = 30, K = 0.35, T = 4;
  const C = Cam(45, 0.66, 2.3);
  fit(C, [[X0, GAP0 - D, -D * K - T], [X1, GAP1 + D, -D * K - T], [X1, GAP0 - D, -D * K], [X0, GAP1 + D, -D * K], [X0, 43, 30], [X1, 43, 30]], 200, 160);
  const P = proj(C), front = facing(C);
  let reach = value;

  const g = mk('g', {}, svg);
  const bed = (back: boolean) => { const s = solid(g); put(s, back ? slab(P, X0, X1, GAP0, GAP0 - D, 0, -D * K, T, 4, 1.4) : slab(P, X0, X1, GAP1, GAP1 + D, 0, -D * K, T, 4, 1.4)); return s; };
  interface Needle { x: number; back: boolean; sp: ReturnType<typeof spring>; el: ReturnType<typeof solid>; hook: SVGPathElement; drawn: number }
  const needles: Needle[] = [];
  const row = (back: boolean) => { for (let i = 0; i < N; i++) { const el = solid(g); needles.push({ x: i * PITCH + PITCH / 2, back, sp: spring(0, { eps: 0.02 }), el, hook: mk('path', { class: 'nf' }, el.g), drawn: NaN }); } };
  bed(true); row(true); bed(false); row(false);

  // the carriage floats above, its cam zone dropped onto the gap as dashed guides
  const guides = mk('path', { class: 'nf dash' }, g);
  const yarn = mk('path', { class: 'nf' }, g);
  const carrier = solid(g), car = solid(g);
  const REST = 3.5 * PITCH, cx = spring(REST, { eps: 0.05 }), CW = 14, CZ = 24;

  // A needle is a thin plate on its bed's slope. s = distance from the gap edge, measured along y into the bed
  // (negative: past the edge, above the top of the V); the bed surface sits at z = -K·s.
  function drawNeedle(n: Needle) {
    const lift = n.sp.x;
    if (lift === n.drawn) return;
    n.drawn = lift;
    const len = 20, sTip = 3 - lift * 11, w = 0.9, dz = 1, edge = n.back ? GAP0 : GAP1, away = n.back ? -1 : 1;
    const at = (s: number): [number, number] => [edge + away * s, -K * s + dz];
    const [yTip, zTip] = at(sTip), [yTail, zTail] = at(sTip + len);
    put(n.el, slab(P, n.x - w, n.x + w, yTip, yTail, zTip, zTail, 1.2, 0.8));
    // the hook: a small curl at the tip, standing up and turning toward the gap
    n.hook.setAttribute('d', open([P(n.x, yTip, zTip), P(n.x, yTip - away * 0.6, zTip + 2.4), P(n.x, yTip - away * 2, zTip + 2.2)]));
    n.el.sil.classList.toggle('hi', lift > 0.85);
  }

  function drawCarriage() {
    const x = cx.x;
    const [ring, inner] = rings(x - CW, GAP0 - D + 4, x + CW, GAP1 + D - 4, 5, 1.6);
    put(car, prism(P, front, ring, inner, CZ, CZ + 6));
    const [cr, ci] = rings(x - CW - 7, GAP0 + 1, x - CW - 3, GAP0 + 5, 1.2, 0.5);
    put(carrier, prism(P, front, cr, ci, CZ - 9, CZ));
    guides.setAttribute('d', [x - CW, x + CW].map(gx => seg(P(gx, (GAP0 + GAP1) / 2, CZ), P(gx, (GAP0 + GAP1) / 2, 0))).join(''));
    yarn.setAttribute('d', open([P(x - CW - 5, GAP0 + 3, CZ - 9), P(x - 6, (GAP0 + GAP1) / 2, 3), P(x + 4, (GAP0 + GAP1) / 2, 2.6)]));
  }

  const cam = (d: number) => { const zone = PITCH * (0.9 + reach * 1.6); return d < zone * 0.6 ? 1 : d < zone ? 1 - (d - zone * 0.6) / (zone * 0.4) : 0; };
  const B = register(stage, (dt: number) => {
    let m = stepS(cx, dt);
    for (const n of needles) { n.sp.t = cam(Math.abs(n.x - cx.x)); if (stepS(n.sp, dt)) m = true; drawNeedle(n); }
    drawCarriage();
    return m;
  });
  bag.add(B.unregister);
  const say = () => { const i = clamp(Math.round((cx.t - PITCH / 2) / PITCH), 0, N - 1); read.textContent = `n ${String(i + 1).padStart(2, '0')} · both beds`; };
  bag.add(pointer(stage, {
    move: (p: Pt) => { const [x] = unproj(C, p[0], p[1], 0); cx.t = clamp(x, 0, N * PITCH); say(); B.wake(); },
    leave: () => { cx.t = REST; read.textContent = 'rest'; B.wake(); },
  }));
  read.textContent = 'rest';
  bag.add(() => svg.replaceChildren());
  return { set: (v: number) => { reach = v; B.wake(); }, destroy: bag.dispose };
};

// ---------------------------------------------------------------- latch needle: one knitting cycle under the pointer
/** One latch needle in its trick, the old loop held at the edge of the bed and the new yarn across the top. The
 *  pointer's height raises the needle: to tuck height the old loop opens the latch; to clearing height it slides
 *  below the latch. Coming down, the hook takes the yarn, the old loop closes the latch and is knocked over. */
export const latchNeedle: FigureMount = ({ stage, svg, read }) => {
  const bag = disposer();
  const C = Cam(45, 0.5, 6);
  // heights above the bed's top edge: the old loop is held at L; the yarn is fed at FEED
  const L = 5, FEED = 17, HOOK = 5, HR = 2.2, PIVOT = -8, LATCH = 8, TUCK = 14, CLEAR = 24, KNOCK = -4;
  fit(C, [[-26, 0, FEED], [26, 0, FEED], [-10, -7, -5], [10, 7, -5], [0, 0, CLEAR + 2 + HOOK + 1]], 200, 164);
  const P = proj(C), front = facing(C);
  const g = mk('g', {}, svg);

  // the bed: a plate with the trick (slot) the needle slides in; its top edge holds the fabric
  const [br, bi] = rings(-10, -7, 10, 7, 3, 1.2);
  const bedEl = solid(g); put(bedEl, prism(P, front, br, bi, -5, 0));
  mk('path', { d: poly(rrect(-1.8, -7, 1.8, 2.4, 0.9).map((q: { u: number; v: number }) => P(q.u, q.v, 0))), class: 'nf lo' }, g);

  const loopBack = mk('path', { class: 'nf' }, g);
  const tuckBack = mk('path', { class: 'nf' }, g);
  const stem = solid(g);
  const hook = mk('path', { class: 'nf sil' }, g), latch = mk('path', { class: 'nf sil' }, g);
  const yarn = mk('path', { class: 'nf' }, g);
  const loopFront = mk('path', { class: 'nf' }, g), tuckFront = mk('path', { class: 'nf' }, g);
  const pivot = flatDot(g, C, 0.35, 'dot m');

  const h = spring(0, { eps: 0.02 });
  let cleared = false, armed = false, fed = false, tucked = 0, knocked = 0, state = 'rest', held = false;
  const lat = spring(0.5, { eps: 0.01 }); // 0 = closed (up onto the hook), 1 = open (hanging down)

  /** A loop round the needle at height z, split into its far and near halves so the needle passes between them. */
  const ring = (z: number, rx: number, ry: number, x = 0) => {
    const far: Pt[] = [], near: Pt[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2, q = { u: x + rx * Math.cos(a), v: ry * Math.sin(a), nu: Math.cos(a), nv: Math.sin(a) };
      (front(q) ? near : far).push(P(q.u, q.v, z));
    }
    return { far: open(far), near: open(near) };
  };

  function draw() {
    const H = h.x, top = H + HOOK - HR;
    // the stem, from where it leaves the trick up to the hook (the rest of the needle, with its butt, is inside the bed)
    const [sr, si] = rings(-1.2, -1.2, 1.2, 1.2, 1, 0.35);
    put(stem, prism(P, front, sr, si, 0, Math.max(0.2, top)));
    // the hook: over the top and down again on the -x side
    const hk: Pt[] = [];
    for (let k = 0; k <= 14; k++) { const a = (k / 14) * Math.PI; hk.push(P(-HR + HR * Math.cos(a), 0, top + HR * Math.sin(a))); }
    hk.push(P(-2 * HR, 0, top - 2.2));
    hook.setAttribute('d', top > -1 ? open(hk) : '');
    // the latch: closed = reaching up to the hook's tip, open = hanging down along the stem
    const a = (123 - lat.x * 183) * Math.PI / 180, px = 1.2, pz = H + PIVOT;
    latch.setAttribute('d', pz > 0 ? open([P(px, 0, pz), P(px + LATCH * Math.cos(a), 0, Math.max(0, pz + LATCH * Math.sin(a)))]) : '');
    if (pz > 0) place(pivot, P(px, 0, pz)); else place(pivot, [-99, -99]);
    // the old loop stays at the bed's edge; the needle moves through it
    const old = ring(L, 4.4, 3.2, -0.8);
    loopBack.setAttribute('d', old.far); loopFront.setAttribute('d', old.near);
    // tuck loops ride in the hook
    if (tucked) { const t = ring(top - 0.6, 2.6, 2, -HR); tuckBack.setAttribute('d', t.far); tuckFront.setAttribute('d', t.near); }
    else { tuckBack.setAttribute('d', ''); tuckFront.setAttribute('d', ''); }
    // the new yarn: straight across, or caught by the hook and drawn down with it
    yarn.setAttribute('d', fed ? open([P(-26, 0, FEED), P(-HR, 0, Math.min(FEED, top - 0.4)), P(26, 0, FEED)]) : seg(P(-26, 0, FEED), P(26, 0, FEED)));
    hook.classList.toggle('hi', fed); latch.classList.toggle('hi', !fed && lat.x > 0.8);
  }

  function events() {
    const H = h.x, rel = L - H; // where the old loop sits on the needle
    if (rel < PIVOT - LATCH * 0.9) cleared = true;
    lat.t = rel < PIVOT ? 1 : rel > PIVOT + 1 && fed ? 0 : lat.t;
    if (H + HOOK > FEED + 1) armed = true;
    if (armed && !fed && H + HOOK < FEED) fed = true;
    let s = H > CLEAR - 1 ? 'clearing height' : H > TUCK - 1 ? 'tuck height' : fed ? 'yarn in the hook' : 'rest';
    if (fed && H < KNOCK + 0.5) { // knock-over, or a tuck when the old loop never cleared
      if (cleared) { knocked++; tucked = 0; s = `knock-over · ${knocked}`; }
      else { tucked++; s = 'tuck held'; }
      fed = false; cleared = false; armed = false; held = true;
    } else if (held) { if (H > 1) held = false; else s = state; } // the event's name stays until the needle rises again
    if (s !== state) { state = s; read.textContent = s; }
  }

  const B = register(stage, (dt: number) => {
    let m = stepS(h, dt);
    if (stepS(lat, dt)) m = true;
    events();
    draw();
    return m;
  });
  bag.add(B.unregister);
  bag.add(pointer(stage, {
    move: (p: Pt) => { h.t = clamp(CLEAR + 2 - ((p[1] - 60) / 200) * (CLEAR + 2 - KNOCK + 1), KNOCK - 1, CLEAR + 2); B.wake(); },
    leave: () => { h.t = 0; B.wake(); },
  }));
  read.textContent = 'rest';
  bag.add(() => svg.replaceChildren());
  return { set: () => {}, destroy: bag.dispose };
};

// ---------------------------------------------------------------- racking: the back bed shifts, needles line up anew
/** The two beds seen from above, needles facing across the gap. The pointer's left–right position racks the back
 *  bed by whole needles; the dashed guide shows where a loop on the bright front needle would transfer to. */
export const racking: FigureMount = ({ stage, svg, read }) => {
  const bag = disposer();
  const N = 7, PITCH = 12, MID = 3, MAXR = 2;
  const C = Cam(45, 0.5, 2.5);
  fit(C, [[-MAXR * PITCH - 6, -4, 0], [(N + MAXR) * PITCH + 6, 40, 0], [-MAXR * PITCH, 40, 0], [(N + MAXR) * PITCH, -4, 0], [N * PITCH / 2, 18, 8]], 200, 160);
  const P = proj(C), front = facing(C);
  const g = mk('g', {}, svg);
  const backG = mk('g', {}, g);
  const guide = mk('path', { class: 'nf dash' }, g);
  const frontG = mk('g', {}, g);
  const rack = tween(0);
  const backBed = solid(backG), frontBed = solid(frontG);
  const backN = Array.from({ length: N + 2 * MAXR }, () => solid(backG));
  const frontN = Array.from({ length: N }, () => solid(frontG));
  const loop = mk('ellipse', { class: 'nf hi' }, frontG);
  const [fr, fi] = rings(-4, 26, N * PITCH + 4, 40, 4, 1.4);
  put(frontBed, prism(P, front, fr, fi, -3, 0));
  frontN.forEach((n, i) => { const x = i * PITCH + PITCH / 2, [r, ri] = rings(x - 1.4, 22, x + 1.4, 34, 1, 0.4); put(n, prism(P, front, r, ri, 0, 1.6)); n.sil.classList.toggle('hi', i === MID); });
  const lp = P(MID * PITCH + PITCH / 2, 23.5, 2.4);
  loop.setAttribute('cx', String(lp[0])); loop.setAttribute('cy', String(lp[1])); loop.setAttribute('rx', '5'); loop.setAttribute('ry', '2.6');
  let drawn = NaN;
  function drawBack(r: number) {
    if (r === drawn) return;
    drawn = r;
    const dx = r * PITCH;
    const [br, bi] = rings(-4 - MAXR * PITCH + dx, -4, (N + MAXR) * PITCH + 4 + dx, 10, 4, 1.4);
    put(backBed, prism(P, front, br, bi, -3, 0));
    backN.forEach((n, k) => { const x = (k - MAXR) * PITCH + PITCH / 2 + dx, [rr, ri] = rings(x - 1.4, -2, x + 1.4, 12, 1, 0.4); put(n, prism(P, front, rr, ri, 0, 1.6)); });
    // the back needle facing the bright front needle
    const fx = MID * PITCH + PITCH / 2;
    guide.setAttribute('d', seg(P(fx, 22, 1.6), P(fx, 12, 1.6)));
  }
  const B = register(stage, (_dt: number, now: number) => { drawBack(tval(rack, now)); return !tdone(rack, now); });
  bag.add(B.unregister);
  let R = 0;
  const say = () => { const f = MID + 1, b = f - R; read.textContent = `rack ${R > 0 ? '+' : ''}${R} · f${f} → b${b}`; };
  function setRack(r: number) { if (r === R) return; R = r; tset(rack, r, performance.now(), 0); say(); B.wake(); }
  bag.add(pointer(stage, {
    move: (p: Pt) => { const [x] = unproj(C, p[0], p[1], 0); setRack(clamp(Math.round((x - (N * PITCH) / 2) / (PITCH * 1.4)), -MAXR, MAXR)); },
    leave: () => setRack(0),
  }));
  say();
  bag.add(() => svg.replaceChildren());
  return { set: () => {}, destroy: bag.dispose };
};

// ---------------------------------------------------------------- landing: a plate of stitches with a portrait raised
const FACE = [
  '............',
  '....####....',
  '...######...',
  '...######...',
  '...######...',
  '....####....',
  '.....##.....',
  '..########..',
  '.##########.',
  '.##########.',
  '############',
  '############',
];

/** A plate of 12 × 12 stitches; the ink stitches of a small head-and-shoulders portrait stand raised. Stitches near
 *  the pointer rise further. */
export const stitchPlate: FigureMount = ({ stage, svg, read }, value) => {
  const bag = disposer();
  const N = 12, CELL = 10, FOOT = 8, EXT = N * CELL, HMAX = 26;
  const C = Cam(45, 0.5, 1.5);
  fit(C, [[-6, -6, -4], [EXT + 6, EXT + 6, -4], [EXT + 6, -6, -4], [-6, EXT + 6, -4], [0, 0, HMAX]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk('g', {}, svg);
  const [pr, pi] = rings(-6, -6, EXT + 6, EXT + 6, 8, 2);
  put(solid(g), prism(P, front, pr, pi, -4, 0));
  const R = value * CELL * 5;
  interface Cell { i: number; j: number; h0: number; ring: unknown; inner: unknown; sp: ReturnType<typeof spring>; el: ReturnType<typeof solid>; drawn: number }
  const cells: Cell[] = [];
  for (let s = 0; s <= 2 * (N - 1); s++) for (let i = 0; i < N; i++) {
    const j = s - i;
    if (j < 0 || j >= N) continue;
    const ink = FACE[j][i] === '#', h0 = ink ? 9 : 1.6, x0 = i * CELL + (CELL - FOOT) / 2, y0 = j * CELL + (CELL - FOOT) / 2;
    const [ring, inner] = rings(x0, y0, x0 + FOOT, y0 + FOOT, 1.8, 0.7);
    cells.push({ i, j, h0, ring, inner, sp: spring(h0, { eps: 0.04 }), el: solid(g), drawn: NaN });
  }
  let over: Pt | null = null;
  const B = register(stage, (dt: number) => {
    let m = false;
    for (const c of cells) {
      if (stepS(c.sp, dt)) m = true;
      const hh = Math.max(0.6, c.sp.x);
      if (hh === c.drawn) continue;
      c.drawn = hh;
      put(c.el, prism(P, front, c.ring, c.inner, 0, hh));
      c.el.sil.classList.toggle('hi', hh > HMAX * 0.6);
    }
    return m;
  });
  bag.add(B.unregister);
  function retarget() {
    for (const c of cells) {
      if (!over) { c.sp.t = c.h0; continue; }
      const d = Math.hypot((c.i + 0.5) * CELL - over[0], (c.j + 0.5) * CELL - over[1]) / R;
      c.sp.t = c.h0 + (c.h0 > 2 ? 17 : 6) * Math.max(0.05, 1 - d) * (d < 1 ? 1 : 0);
    }
    if (over) { const i = clamp(Math.floor(over[0] / CELL), 0, N - 1), j = clamp(Math.floor(over[1] / CELL), 0, N - 1); read.textContent = `stitch ${String(i + 1).padStart(2, '0')}·${String(N - j).padStart(2, '0')}`; }
    else read.textContent = 'rest';
    B.wake();
  }
  bag.add(pointer(stage, { move: (p: Pt) => { over = unproj(C, p[0], p[1], 0); retarget(); }, leave: () => { over = null; retarget(); } }));
  read.textContent = 'rest';
  bag.add(() => svg.replaceChildren());
  return { set: () => {}, destroy: bag.dispose };
};
