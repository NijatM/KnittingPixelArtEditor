// A framed sample in 3D for the Knitting Taxonomy page (three.js, MIT): a white printed frame, square window and a
// wider bottom border, with a plain jersey behind it. A drawing to turn around, not the yarn model (yarn.ts): the
// jersey is rows of V-shaped yarn legs laid on a backing, the same picture as taxonomy.ts's flat drawing.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface FrameHandle { destroy(): void }

// sizes in mm, roughly the printed frame: 50 × 54, a 41 mm square window, 3 mm thick; the window is centred on 0
const W = 50, H = 54, WIN = 41, TOP = 4, T = 3;
const X0 = -W / 2, Y1 = WIN / 2 + TOP, Y0 = Y1 - H;
// the jersey: wale and course spacing, how far it reaches behind the frame
const DX = 2.6, DY = 2.0, FAB = 47;
const FRAME = '#eceae5', YARN = '#e48a6e', BACKING = '#9c4a37';

/** A small repeating texture of grey flecks, like the speckled filament the frames are printed in. */
function speckle(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = FRAME; g.fillRect(0, 0, 256, 256);
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

function frameMesh(): THREE.Mesh {
  const r = 1.2, sh = new THREE.Shape();
  sh.moveTo(X0 + r, Y0); sh.lineTo(-X0 - r, Y0); sh.quadraticCurveTo(-X0, Y0, -X0, Y0 + r);
  sh.lineTo(-X0, Y1 - r); sh.quadraticCurveTo(-X0, Y1, -X0 - r, Y1); sh.lineTo(X0 + r, Y1);
  sh.quadraticCurveTo(X0, Y1, X0, Y1 - r); sh.lineTo(X0, Y0 + r); sh.quadraticCurveTo(X0, Y0, X0 + r, Y0);
  const hole = new THREE.Path(), h = WIN / 2;
  hole.moveTo(-h, -h); hole.lineTo(-h, h); hole.lineTo(h, h); hole.lineTo(h, -h); hole.lineTo(-h, -h);
  sh.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: T - 0.8, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, 0.4);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: speckle(), roughness: 0.78, metalness: 0 }));
}

/** Jersey seen from its face: every stitch shows two legs leaning into a V, one row above the other. */
function jersey(): THREE.Group {
  const g = new THREE.Group();
  const leg = new THREE.CubicBezierCurve3(new THREE.Vector3(-1.08, 1.35, -0.25), new THREE.Vector3(-1.05, 0.4, 0.55), new THREE.Vector3(-0.45, -0.75, 0.5), new THREE.Vector3(-0.05, -1.25, 0.05));
  const geo = new THREE.TubeGeometry(leg, 10, 0.36, 6, false);
  const cols = Math.ceil(FAB / DX), rows = Math.ceil(FAB / DY);
  const legs = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: YARN, roughness: 0.85, side: THREE.DoubleSide }), cols * rows * 2);
  const m = new THREE.Matrix4(), flip = new THREE.Matrix4().makeScale(-1, 1, 1);
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * DX, y = (r - (rows - 1) / 2) * DY;
    m.makeTranslation(x, y, 0); legs.setMatrixAt(k++, m);
    m.makeTranslation(x, y, 0).multiply(flip); legs.setMatrixAt(k++, m);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(cols * DX, rows * DY), new THREE.MeshStandardMaterial({ color: BACKING, roughness: 1, side: THREE.DoubleSide }));
  back.position.z = -0.7;   // behind the legs, which reach 0.6 back
  g.add(back, legs);
  g.position.z = -0.9;   // just behind the frame
  return g;
}

/** Mounts the framed sample into `el`; drag to turn it. Throws if WebGL is unavailable. */
export function mountFrame(el: HTMLElement): FrameHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 1000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(40, 60, 90); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-50, -20, -80); scene.add(rim);
  const centre = new THREE.Vector3(0, (Y0 + Y1) / 2, T / 2);
  scene.add(frameMesh(), jersey());
  const dist = (H / 2) * 1.25 / Math.tan(THREE.MathUtils.degToRad(15));
  cam.position.copy(centre).add(new THREE.Vector3(0.42, 0.2, 1).normalize().multiplyScalar(dist));
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.copy(centre); controls.enableZoom = false; controls.enablePan = false; controls.update();
  let raf = 0;
  const render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderer.render(scene, cam); }); };
  controls.addEventListener('change', render);
  const size = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); render(); };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  return {
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const m = o.material as THREE.MeshStandardMaterial; m.map?.dispose(); m.dispose(); } });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
