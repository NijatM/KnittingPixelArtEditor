// Small 3D yarn swatches for Learn (three.js, MIT). Each swatch is a few courses of a mini grammar, read bottom up:
// k = knit front, p = knit back, t = tuck front, m = miss (float), x = knit front then transfer to back.
// The yarn path is schematic: a standard loop curve, front / back by the bed, held loops stretched up, floats behind.
// It shows how the operations interlock, not exact yarn mechanics.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SwatchSpec { rows: string[]; marks: [number, number][]; colour: string; caption: string }

export const SWATCHES: Record<string, SwatchSpec> = {
  knit: { rows: ['kkkkk', 'kkkkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], colour: '#0000ff', caption: 'single jersey: every needle knits on the front bed; the marked loop is one knit stitch' },
  purl: { rows: ['ppppp', 'ppppp', 'ppppp', 'ppppp'], marks: [[2, 1]], colour: '#23a0f0', caption: 'knit on the back bed: seen from the front, every loop shows its head (the purl side)' },
  tuck: { rows: ['kkkkk', 'kktkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], colour: '#aa50f5', caption: 'a tuck: the marked yarn is caught by the needle without knocking the old loop over; the loop below is held, stretched over two courses' },
  float: { rows: ['kkkkk', 'kkmkk', 'kkkkk', 'kkkkk'], marks: [[2, 1]], colour: '#8a8a8a', caption: 'a float (miss): the yarn passes behind the needle; the loop below is held over two courses' },
  transfer: { rows: ['kkkkk', 'kkxkk', 'kkpkk', 'kkpkk'], marks: [[2, 1]], colour: '#fac800', caption: 'knit front, then transfer to back: from the next course the needle\'s stitches are knitted on the back bed and show as purl loops' },
  rib: { rows: ['kpkpk', 'kpkpk', 'kpkpk', 'kpkpk'], marks: [[1, 1]], colour: '#23a0f0', caption: '1 × 1 rib: front and back needles alternate in every course' },
};

const PITCH = 1, COURSE = 0.62, LOOP_H = 1.0, A = 1.15, D = 0.17, R = 0.085;

/** Points of one loop in column i, course j: t from 0 to 2π, left to right. */
function loopPoints(i: number, j: number, kind: string, held: number, prev: number, next: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const base = j * COURSE;
  const sgnOf = (k: number) => k; // -1 back loop, 1 front loop
  const sg = kind === 'p' ? -1 : 1;
  for (let s = 0; s <= 24; s++) {
    const t = (s / 24) * Math.PI * 2;
    let x = i * PITCH + (t + A * Math.sin(2 * t)) / (Math.PI * 2) * PITCH, y: number, z: number;
    // blend front / back near the sinker loops when the neighbour is on the other bed
    const edge = t < 0.9 ? (0.9 - t) / 0.9 : t > Math.PI * 2 - 0.9 ? (t - (Math.PI * 2 - 0.9)) / 0.9 : 0;
    const nb = t < Math.PI ? prev : next;
    const sgn = sgnOf(sg) * (1 - edge * 0.5) + sgnOf(nb) * edge * 0.5;
    if (kind === 'm') { // a float: straight across, behind the held loop
      x = i * PITCH + (t / (Math.PI * 2)) * PITCH;
      y = base + 0.18 * LOOP_H;
      z = -D * 1.9;
    } else if (kind === 't') { // a tuck loop: no knock-over, it sits behind the held loop's head
      y = base + (1 - Math.cos(t)) / 2 * LOOP_H * (0.8 + held * COURSE / LOOP_H);
      z = -D * (1.2 + 0.6 * Math.sin(t / 2));
    } else {
      y = base + (1 - Math.cos(t)) / 2 * (LOOP_H + held * COURSE);
      z = -D * Math.cos(2 * t) * sgn;
    }
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

/** Builds the scene objects for a swatch: one tube per loop, the marked ones in the operation's colour. */
function build(spec: SwatchSpec, group: THREE.Group) {
  const rows = spec.rows, n = rows[0].length;
  const yarn = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.75, metalness: 0 });
  const mark = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.colour), roughness: 0.6, emissive: new THREE.Color(spec.colour).multiplyScalar(0.12) });
  const bedOf = (c: string) => (c === 'p' ? -1 : 1);
  // a needle that tucks or misses in course j holds its loop from course j-1: that loop stretches by one course
  const heldAbove = (i: number, j: number) => { let h = 0; for (let k = j + 1; k < rows.length && 'tm'.includes(rows[k][i]); k++) h++; return h; };
  // after a transfer to back, the needle's next stitches are purl
  const kindAt = (i: number, j: number) => { const c = rows[j][i]; return c === 'x' ? 'k' : c; };
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < n; i++) {
      const kind = kindAt(i, j);
      const pts = loopPoints(i, j, kind, kind === 'k' || kind === 'p' ? heldAbove(i, j) : 0, bedOf(kindAt(Math.max(0, i - 1), j)), bedOf(kindAt(Math.min(n - 1, i + 1), j)));
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 48, R, 8, false);
      const marked = spec.marks.some(([mi, mj]) => mi === i && mj === j);
      group.add(new THREE.Mesh(geo, marked ? mark : yarn));
    }
    // the turn at the edge into the next course
    if (j < rows.length - 1) {
      const right = j % 2 === 0, x = right ? n * PITCH : 0, y0 = j * COURSE, y1 = (j + 1) * COURSE;
      const turn = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y0, -D), new THREE.Vector3(x + (right ? 0.25 : -0.25), (y0 + y1) / 2, -D * 0.4), new THREE.Vector3(x, y1, -D)]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(turn, 12, R, 8, false), yarn));
    }
  }
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3());
  group.position.sub(c);
}

/** Mounts a swatch into `el`; renders only when the view changes. Returns a disposer. */
export function mountSwatch(el: HTMLElement, spec: SwatchSpec, onView?: (side: 'front' | 'back') => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x0b0b0b);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  cam.position.set(0.6, 0.4, 9);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-4, -2, -5); scene.add(rim);
  const group = new THREE.Group();
  build(spec, group);
  scene.add(group);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = false; controls.enablePan = false; controls.minDistance = 4; controls.maxDistance = 16;
  const render = () => {
    renderer.render(scene, cam);
    const side = cam.position.z >= 0 ? 'front' : 'back';
    onView?.(side);
  };
  controls.addEventListener('change', render);
  const size = () => { const w = el.clientWidth, h = Math.round(w * 0.62); renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); render(); };
  const ro = new ResizeObserver(size); ro.observe(el);
  size();
  return {
    flip() { cam.position.set(-cam.position.x, cam.position.y, -cam.position.z); controls.update(); render(); },
    destroy() { ro.disconnect(); controls.dispose(); renderer.dispose(); group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); renderer.domElement.remove(); },
  };
}
