// The framed sample in 3D (three.js, MIT): the printed frame and, behind its window, the structure's yarn model.
// Models come from scripts/taxonomy-models.ts (relaxed once with the Knit Grammar yarn engine) and are loaded the
// first time a sample of that structure is shown. Each yarn is a tube in its origin colour; a yarn of several
// origins is drawn with a twisted stripe split by their shares, like a plied yarn (a drawing, not physics).
import * as THREE from 'three';

/** Frame sizes in mm, roughly the printed frame: 50 × 54, a 41 mm square window centred on 0, 3 mm thick; a back
 *  plate behind the sample (a placeholder until the real frame's drawing exists). */
export const FRAME = { w: 50, h: 54, win: 41, top: 4, t: 3, back: 1.2 };
const X0 = -FRAME.w / 2, Y1 = FRAME.win / 2 + FRAME.top, Y0 = Y1 - FRAME.h;
/** the frame's middle (the window is centred on 0, the bottom border is wider) */
export const FRAME_MID = (Y0 + Y1) / 2;
const FRAME_COLOUR = '#eceae5';

interface ModelFile {
  structure: string; note: string; same_as?: string;
  relax?: { status: string }; radius_mm?: number; depth_mm?: number;
  yarns?: { guide: number; runs: string[] }[];
}
export interface Model { structure: string; note: string; status: string; depth: number; yarns: THREE.BufferGeometry[] }

const files = import.meta.glob<ModelFile>('./data/models/*.json', { import: 'default' });
const cache = new Map<string, Promise<Model | null>>();

/** A structure's model (null when it has none); geometry is built once and shared by every sample. */
export function loadModel(structure: string): Promise<Model | null> {
  let p = cache.get(structure);
  if (!p) {
    p = (async () => {
      const f = await files[`./data/models/${structure}.json`]?.();
      if (!f) return null;
      const g = f.same_as ? await loadModel(f.same_as) : null;
      if (f.same_as) return g && { ...g, structure, note: f.note };
      return { structure, note: f.note, status: f.relax?.status ?? '', depth: f.depth_mm ?? 3, yarns: f.yarns!.map(y => tubes(y.runs, f.radius_mm!)) };
    })();
    cache.set(structure, p);
  }
  return p;
}

const decode = (b64: string) => {
  const s = atob(b64), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new Int16Array(b.buffer);
};

/** Tubes along a yarn's runs (each smoothed through its points), with u running round the tube and along it as a
 *  helix, so a striped texture twists like plies. */
function tubes(runs: string[], r: number, sides = 8, sub = 3): THREE.BufferGeometry {
  const pitch = 9 * r, pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3();
  for (const run of runs) {
    const v = decode(run), pts: THREE.Vector3[] = [];
    for (let i = 0; i < v.length; i += 3) pts.push(new THREE.Vector3(v[i] / 100, v[i + 1] / 100, v[i + 2] / 100));
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints((pts.length - 1) * sub);
    const base = pos.length / 3;
    let s = 0;
    for (let i = 0; i < path.length; i++) {
      T.subVectors(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
      if (i === 0) N.set(Math.abs(T.z) > 0.9 ? 1 : 0, 0, Math.abs(T.z) > 0.9 ? 0 : 1);
      N.addScaledVector(T, -N.dot(T));   // carried along without twisting
      if (N.lengthSq() < 1e-10) N.set(-T.y, T.x, 0);
      N.normalize();
      B.crossVectors(T, N);
      if (i) s += path[i].distanceTo(path[i - 1]);
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
        pos.push(path[i].x + d.x * r, path[i].y + d.y * r, path[i].z + d.z * r);
        nrm.push(d.x, d.y, d.z);
        uv.push(j / sides + s / pitch, 0.5);
      }
      if (i) for (let j = 0; j < sides; j++) {
        const a = base + (i - 1) * (sides + 1) + j, b = a + sides + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A yarn's colour round its tube: each origin's share of the circumference; unknown fibres hatched grey. */
export function stripe(shares: { origin: string; pct: number }[], colours: Map<string, string>): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * 4), total = shares.reduce((s, q) => s + q.pct, 0) || 1, c = new THREE.Color();
  let at = 0;
  shares.forEach((q, k) => {
    const end = k === shares.length - 1 ? n : Math.round(at + (n * q.pct) / total);
    for (let i = at; i < end; i++) {
      c.set(q.origin === 'unknown' ? (i % 2 ? '#4a4a4a' : '#6e6e6e') : colours.get(q.origin) ?? '#6e6e6e');
      data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], i * 4);
    }
    at = end;
  });
  const t = new THREE.DataTexture(data, n, 1);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A small repeating texture of grey flecks, like the speckled filament the frames are printed in. */
function speckle(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = FRAME_COLOUR; g.fillRect(0, 0, 256, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const v = 110 + Math.floor(rnd() * 90);
    g.fillStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.5})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 1.4, 1 + rnd() * 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 24, 1 / 24); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let frameGeo: THREE.ExtrudeGeometry | null = null, backGeo: THREE.ExtrudeGeometry | null = null, frameMat: THREE.MeshStandardMaterial | null = null;
function outline() {
  const r = 1.2, sh = new THREE.Shape();
  sh.moveTo(X0 + r, Y0); sh.lineTo(-X0 - r, Y0); sh.quadraticCurveTo(-X0, Y0, -X0, Y0 + r);
  sh.lineTo(-X0, Y1 - r); sh.quadraticCurveTo(-X0, Y1, -X0 - r, Y1); sh.lineTo(X0 + r, Y1);
  sh.quadraticCurveTo(X0, Y1, X0, Y1 - r); sh.lineTo(X0, Y0 + r); sh.quadraticCurveTo(X0, Y0, X0 + r, Y0);
  return sh;
}
const plate = (sh: THREE.Shape, t: number) => {
  const g = new THREE.ExtrudeGeometry(sh, { depth: t - 0.8, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, 0.4);
  return g;
};
/** The printed frame: rounded outline, square window; its front at z = t, its back at 0. Shared by all frames. */
export function frameMesh(): THREE.Mesh {
  if (!frameGeo) {
    const sh = outline(), hole = new THREE.Path(), h = FRAME.win / 2;
    hole.moveTo(-h, -h); hole.lineTo(-h, h); hole.lineTo(h, h); hole.lineTo(h, -h); hole.lineTo(-h, -h);
    sh.holes.push(hole);
    frameGeo = plate(sh, FRAME.t);
    frameMat = new THREE.MeshStandardMaterial({ map: speckle(), roughness: 0.78, metalness: 0 });
  }
  return new THREE.Mesh(frameGeo, frameMat!);
}
/** The back plate: the same outline, no window; its front at z = back, its back at 0. */
export function backMesh(): THREE.Mesh {
  frameMesh();
  backGeo ??= plate(outline(), FRAME.back);
  return new THREE.Mesh(backGeo, frameMat!);
}
