// The landing page's hairline figure for Knitting Taxonomy: a shelf of sample spines; the one under the pointer
// lifts out of the row (the section's hover). Light: no records are loaded for it.
import { HL, type FigureMount } from '../hl';

const { Cam, clamp, facing, fit, mk, prism, proj, rings, seg, spring, stepS, register, pointer, disposer, solid, put } = HL;

/** Thirteen spines of slightly different heights standing on a board. The pointer picks the spine above it: it
 *  rises and takes the one bright edge; the others stay down. Two dim lines on each spine stand for its yarn bands. */
export const bookShelf: FigureMount = ({ stage, svg, read }) => {
  const bag = disposer();
  const N = 13, PITCH = 7, W = 5.6, D = 20, LIFT = 11;
  const H = [34, 30, 38, 33, 36, 29, 37, 35, 31, 38, 32, 36, 34];
  const C = Cam(24, 0.5, 3.1);
  fit(C, [[-6, -3, -4], [N * PITCH + 6, D + 3, -4], [-6, -3, 38 + LIFT], [N * PITCH + 6, D + 3, 38 + LIFT]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk('g', {}, svg);
  const [br, bi] = rings(-6, -3, N * PITCH + 6, D + 3, 2, 1);
  put(solid(g), prism(P, front, br, bi, -4, 0));

  interface Spine { x: number; h: number; sp: ReturnType<typeof spring>; el: ReturnType<typeof solid>; bands: SVGPathElement; drawn: number }
  // left to right is back to front from this side, so later spines paint over the side faces of earlier ones
  const spines: Spine[] = H.map((h, i) => {
    const el = solid(g);
    return { x: i * PITCH + 0.7, h, sp: spring(0, { eps: 0.02 }), el, bands: mk('path', { class: 'nf lo' }, el.g), drawn: NaN };
  });
  const [ring, inner] = rings(0, 0, W, D, 0.9, 0.5);
  const shift = (r: { u: number; v: number }[], dx: number) => r.map(q => ({ ...q, u: q.u + dx }));
  function draw(s: Spine) {
    const z = s.sp.x * LIFT;
    if (z === s.drawn) return;
    s.drawn = z;
    put(s.el, prism(P, front, shift(ring, s.x), shift(inner, s.x), z, z + s.h));
    s.bands.setAttribute('d', [4, 7].map(b => seg(P(s.x, D, z + b), P(s.x + W, D, z + b))).join(''));
    s.el.sil.classList.toggle('hi', s.sp.x > 0.6);
  }

  let at = -1;
  const B = register(stage, (dt: number) => {
    let m = false;
    spines.forEach((s, i) => { s.sp.t = i === at ? 1 : 0; if (stepS(s.sp, dt)) m = true; draw(s); });
    return m;
  });
  bag.add(B.unregister);
  // the pointer's x on screen, taken back to the middle of the spines' depth, picks the spine
  const pick = (sx: number) => { const X = (sx - C.ox) / C.S, x = (X + (D / 2) * Math.sin(C.az)) / Math.cos(C.az); return Math.floor(x / PITCH); };
  bag.add(pointer(stage, {
    move: (p: [number, number]) => {
      const i = pick(p[0]);
      at = i >= 0 && i < N ? i : -1;
      read.textContent = at < 0 ? 'rest' : `SMP_${String(clamp(at + 1, 1, N)).padStart(4, '0')} · lifted`;
      B.wake();
    },
    leave: () => { at = -1; read.textContent = 'rest'; B.wake(); },
  }));
  read.textContent = 'rest';
  bag.add(() => svg.replaceChildren());
  return { set: () => B.wake(), destroy: bag.dispose };
};
