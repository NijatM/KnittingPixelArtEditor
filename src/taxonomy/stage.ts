// The 3D layer over the Knitting Taxonomy section: one transparent three.js canvas over the whole window, in CSS
// pixels. When a sample becomes current its mark in the open view (a spine, a lineage tick, a map mark) hides and
// its frame appears in the mark's place, edge on, pulls out, turns face on and flies to the preview; the one before
// flies back and its mark shows again. In the preview the frame can be turned by dragging (double-click: back to
// the resting turn). The same sample arriving again (its tag laid on again) flies back and in once more; in the
// kiosk the frame at rest swings slowly from side to side.
import * as THREE from 'three';
import type { DB, Rec } from './data';
import { backMesh, FRAME, FRAME_MID, frameMesh, loadModel, stripe } from './model';
import type { View } from './view';

/** Where frames leave from and land: the open view's marks. */
export type Source = Pick<View, 'face' | 'setAway'>;

const OUT_MS = 480, BACK_MS = 420, FOV = 20;
/** the resting turn in the preview: a little to the side, so it reads as a solid */
const REST = { x: 0.14, y: -0.36 };
/** how far a frame rises out of the row before it flies (px) */
const PULL = 70;
/** the kiosk's swing at rest: how far either way (rad) and one full swing (ms) */
const SWAY = 0.55, SWAY_MS = 12000;
/** the photo's place: the window, just behind the frame */
const PHOTO_Z = -0.3;

export type Face = 'model' | 'photo';
export interface Stage {
  /** Makes `r` the sample in the preview (null: none); `instant` puts it there without the flight (a tag on load). */
  show(r: Rec | null, instant?: boolean): void;
  /** The photo or the model in the window, for a sample that has a photo. */
  face(f: Face): void;
  /** Another view opened: frames now leave from and land on its marks. */
  source(s: Source): void;
  /** The sample in the preview flies back to its mark and in again. */
  again(): void;
  /** The frame at rest swings slowly from side to side (the kiosk), or keeps still. */
  swing(on: boolean): void;
  destroy(): void;
}

interface Pose { x: number; y: number; s: [number, number, number]; rx: number; ry: number }
interface Piece {
  rec: Rec; obj: THREE.Group; inner: THREE.Group; yarn: THREE.Group; photo: THREE.Mesh | null;
  depth: number; dir: 'out' | 'back' | 'rest'; from: Pose; t0: number; ms: number;
  dispose: (() => void)[];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mounts the layer into `root`; `view` is the preview's box (also where dragging turns the frame). Returns null
 *  without WebGL. */
export function mountStage(root: HTMLElement, view: HTMLElement, db: DB, marks: Source): Stage | null {
  let renderer: THREE.WebGLRenderer;
  const canvas = document.createElement('canvas');
  canvas.className = 'txgl';
  canvas.setAttribute('aria-hidden', 'true');
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  root.appendChild(canvas);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(FOV, 1, 1, 10);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(400, 600, 900); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-500, -200, -800); scene.add(rim);
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  // the camera sees the plane z = 0 at one unit per CSS pixel, x right and y up from the window's top left
  function size() {
    const w = innerWidth, h = innerHeight, d = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.near = d / 4; cam.far = d * 4;
    cam.position.set(w / 2, -h / 2, d); cam.lookAt(w / 2, -h / 2, 0);
    cam.updateProjectionMatrix();
    kick();
  }

  let current: Piece | null = null, turn = { x: 0, y: 0 }, raf = 0;
  let after: Rec | null = null, swinging = false, sway = 0, swayT = 0, last = 0;
  const pieces = new Set<Piece>();
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  /** where a piece sits in the view: edge on in its mark (a spine's front face), stretched to it */
  function spinePose(p: Piece): Pose | null {
    const f = marks.face(p.rec.s.sample_id);
    if (!f) return null;
    const sy = f.height / FRAME.h;
    return { x: f.x + f.width / 2, y: f.y + f.height / 2, s: [sy, sy, f.width / p.depth], rx: 0, ry: Math.PI / 2 };
  }
  /** where it rests: face on in the preview, turned a little (plus the reader's turn) */
  function restPose(): Pose {
    const b = view.getBoundingClientRect(), s = Math.min(b.width / (FRAME.w * 1.25), b.height / (FRAME.h * 1.12));
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, s: [s, s, s], rx: REST.x + turn.x, ry: REST.y + turn.y + sway };
  }
  function poseOf(p: Piece): Pose {
    return { x: p.obj.position.x, y: -p.obj.position.y, s: [p.obj.scale.x, p.obj.scale.y, p.obj.scale.z], rx: p.obj.rotation.x, ry: p.obj.rotation.y };
  }
  function put(p: Piece, q: Pose) {
    p.obj.position.set(q.x, -q.y, 0);
    p.obj.scale.set(...q.s);
    p.obj.rotation.set(q.rx, q.ry, 0, 'YXZ');
  }

  function tick(now: number) {
    raf = 0;
    let moving = false;
    const dt = last ? Math.min(100, now - last) : 0;
    last = now;
    if (swinging && current?.dir === 'rest' && !drag && !still.matches) {
      swayT += dt;
      sway = SWAY * Math.sin((swayT / SWAY_MS) * 2 * Math.PI);
      moving = true;
    }
    for (const p of pieces) {
      if (p.dir === 'rest') { put(p, restPose()); continue; }
      const to = p.dir === 'out' ? restPose() : spinePose(p);
      const t = p.ms > 0 ? Math.min(1, (now - p.t0) / p.ms) : 1;
      if (!to || t >= 1) { land(p); continue; }
      moving = true;
      const e = ease(t), r = ease(Math.min(1, t / 0.75)), a = p.from;
      // up out of the row first (or down into it at the end): a curve through a point above the spine
      const top = p.dir === 'out' ? a : to, cx = top.x, cy = top.y - PULL, u = 1 - e;
      put(p, {
        x: u * u * a.x + 2 * u * e * cx + e * e * to.x,
        y: u * u * a.y + 2 * u * e * cy + e * e * to.y,
        s: [0, 1, 2].map(i => a.s[i] * (to.s[i] / a.s[i]) ** e) as [number, number, number],
        rx: mix(a.rx, to.rx, r), ry: mix(a.ry, to.ry, r),
      });
    }
    if (swinging && current?.dir === 'rest' && !drag && !still.matches) moving = true; // landed: the swing starts
    renderer.render(scene, cam);
    if (moving) kick(); else last = 0;
  }
  function land(p: Piece) {
    if (p.dir === 'out') { p.dir = 'rest'; put(p, restPose()); return; }
    // back in the view: its mark shows again
    marks.setAway(p.rec.s.sample_id, false);
    pieces.delete(p);
    scene.remove(p.obj);
    p.dispose.forEach(f => f());
    if (after === p.rec) show(p.rec);
  }
  function fly(p: Piece, dir: 'out' | 'back', instant = false) {
    const from = p.obj.parent ? poseOf(p) : spinePose(p);
    p.dir = dir; p.t0 = performance.now(); p.ms = instant || still.matches || !from ? 0 : dir === 'out' ? OUT_MS : BACK_MS;
    p.from = from ?? restPose();
    if (!p.obj.parent) { scene.add(p.obj); put(p, p.from); }
    kick();
  }

  function make(r: Rec): Piece {
    const obj = new THREE.Group(), inner = new THREE.Group(), yarn = new THREE.Group(), back = backMesh();
    inner.add(frameMesh(), yarn, back);
    obj.add(inner);
    const p: Piece = { rec: r, obj, inner, yarn, photo: null, depth: FRAME.t + 4, dir: 'rest', from: restPose(), t0: 0, ms: 0, dispose: [] };
    // the sample lies between the frame (its back at z = 0) and the back plate; the model's yarn ends 0.3 mm
    // behind the frame. The frame's middle at the pivot: across, up (the bottom border is wider), through its depth.
    const centre = (fabric: number) => {
      const zb = -(fabric + 0.6) - FRAME.back;
      back.position.z = zb;
      p.depth = FRAME.t - zb;
      inner.position.set(0, -FRAME_MID, -(FRAME.t + zb) / 2);
    };
    centre(4);
    loadModel(r.structure.id).then(m => {
      if (!m || !pieces.has(p)) return;
      centre(m.depth);
      // model yarn 1 is the sample's main yarn, yarn 2 (two-guide structures) its contrast yarn
      const main = r.yarns.find(u => u.role === 'main') ?? r.yarns[0], second = r.yarns.find(u => u.role === 'contrast') ?? r.yarns.find(u => u !== main) ?? main;
      m.yarns.forEach((g, i) => {
        const u = i === 0 ? main : second;
        if (!u) return;
        const tex = stripe(u.shares, db.colours), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
        p.dispose.push(() => { tex.dispose(); mat.dispose(); });
        yarn.add(new THREE.Mesh(g, mat));
      });
      kick();
    }).catch(() => { /* the frame stays empty; the caption says so (main.ts) */ });
    if (r.s.photo) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x222222 }), ph = new THREE.Mesh(new THREE.PlaneGeometry(FRAME.win, FRAME.win), mat);
      ph.position.z = PHOTO_Z;
      new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}taxonomy/photos/${r.s.photo}`, tex => {
        // cover the window, cut to its square
        const a = tex.image.width / tex.image.height;
        if (a > 1) { tex.repeat.set(1 / a, 1); tex.offset.set((1 - 1 / a) / 2, 0); } else { tex.repeat.set(1, a); tex.offset.set(0, (1 - a) / 2); }
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
        p.dispose.push(() => tex.dispose());
        kick();
      });
      p.dispose.push(() => { mat.dispose(); ph.geometry.dispose(); });
      inner.add(ph);
      p.photo = ph;
      yarn.visible = false;   // a sample's photo comes first; the model is one click away
    }
    return p;
  }

  function show(r: Rec | null, instant = false) {
    after = null;
    if (current?.rec === r) return;
    if (current) fly(current, 'back');
    current = null;
    if (!r) return;
    turn = { x: 0, y: 0 }; sway = swayT = 0;
    // on its way back still: turn it round
    let p = [...pieces].find(q => q.rec === r);
    if (!p) { p = make(r); pieces.add(p); marks.setAway(r.s.sample_id, true); }
    current = p;
    fly(p, 'out', instant);
  }

  // turning in the preview
  let drag: { x: number; y: number; id: number } | null = null;
  const down = (e: PointerEvent) => { if (!current || e.button) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; view.setPointerCapture(e.pointerId); view.classList.add('turning'); };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    turn.y += (e.clientX - drag.x) * 0.012;
    turn.x = Math.max(-1.3, Math.min(1.3, turn.x + (e.clientY - drag.y) * 0.012));
    drag.x = e.clientX; drag.y = e.clientY;
    kick();
  };
  const up = () => { drag = null; view.classList.remove('turning'); kick(); };
  const reset = () => { turn = { x: 0, y: 0 }; kick(); };
  view.addEventListener('pointerdown', down);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('dblclick', reset);
  addEventListener('resize', size);
  size();

  return {
    show,
    face(f) {
      if (!current?.photo) return;
      current.photo.visible = f === 'photo';
      current.yarn.visible = f === 'model';
      kick();
    },
    source(s) {
      for (const p of pieces) { marks.setAway(p.rec.s.sample_id, false); s.setAway(p.rec.s.sample_id, true); }
      marks = s;
      kick();
    },
    again() {
      const r = current?.rec ?? null;
      show(null);
      after = r;
    },
    swing(on) { swinging = on; kick(); },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      for (const p of pieces) p.dispose.forEach(f => f());
      renderer.dispose(); canvas.remove();
    },
  };
}
