// The 3D view of the machine's yarn (three.js, MIT). Two views of one model (machine.ts → yarn.ts):
//   machine: the needle beds with the loops on their hooks, the carriers, transfers, and the fabric made so far
//            hanging below, laid out as the take-down pulls it (not relaxed); steps through the program's actions;
//   fabric:  the same yarn relaxed off the machine (relax.ts, in a worker), with a pass highlighted.
// The yarn is drawn as tubes: every span between two yarn points is one instance, and the vertex shader follows
// the spline through the points around it, so detail can change with zoom without rebuilding anything.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Key } from './ops';
import { A_XFER, NEVER } from './machine';
import { detailCentres, detailFill, detailLayout, flatNormals, framesOf, heldPoints, machineFrame, pointsOf, type Detail, type YarnSys } from './yarn';

export type Mode = 'machine' | 'fabric';
export type Look = 'grammar' | 'yarn';
export const YARN_COLOURS = ['#ddd7cc', '#c4553b', '#7fb0d8', '#9ccf7a'];

const TEXW = 1024;
const CHUNK = 1 << 16;

// ---------------------------------------------------------------- shader
const VERT = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uPts;
uniform sampler2D uFrm;
uniform sampler2D uMeta;
uniform sampler2D uMeta2;
uniform sampler2D uPal;
uniform vec3 uYarn[4];
uniform float uR;
uniform int uMode;      // 0 machine (fabric made so far), 1 relaxed fabric, 2 machine (held loops, drawn as they are)
uniform float uAct;     // the last action done
uniform float uRow;     // the pass being looked at
uniform float uCell;    // a chart cell to show (-1 none)
uniform float uLoop;    // a loop to show (-1 none)
uniform float uCurLoop; // the loop the current action made (-1 none)
uniform float uLook;    // 0 operation colours, 1 yarn colours
uniform float uNOps;
attribute float aSpan;
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vGlow;

vec4 at(sampler2D s, int i) { return texelFetch(s, ivec2(i % ${TEXW}, i / ${TEXW}), 0); }

void main() {
  int i = int(aSpan);
  vec4 P1 = at(uPts, i), P2 = at(uPts, i + 1);
  vec4 P0 = at(uPts, i - 1), P3 = at(uPts, i + 2);
  float tag = P1.w;
  int loop = int(floor(tag * 0.5 + 0.25));
  bool body = fract(tag * 0.5) > 0.25;
  vec4 m1 = at(uMeta, loop);   // act made, act knitted through, row, cell
  vec4 m2 = at(uMeta2, loop);  // operation, guide, act of the next loop on the yarn, bed
  if (uMode == 0 && !(m1.x <= uAct && (body ? m1.y <= uAct : m2.z <= uAct))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = position.x, a = position.y;
  vec3 p0 = P0.xyz, p1 = P1.xyz, p2 = P2.xyz, p3 = P3.xyz;
  vec3 c1 = -p0 + p2, c2 = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3, c3 = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
  vec3 p = 0.5 * (2.0 * p1 + c1 * u + c2 * u * u + c3 * u * u * u);
  vec3 dp = 0.5 * (c1 + 2.0 * c2 * u + 3.0 * c3 * u * u);
  vec3 T = length(dp) > 1e-6 ? normalize(dp) : normalize(p2 - p1 + vec3(1e-5, 0.0, 0.0));
  // the frame carried along the yarn (yarn.ts framesOf), squared to this tangent
  vec3 F = mix(at(uFrm, i).xyz, at(uFrm, i + 1).xyz, u);
  vec3 N = F - dot(F, T) * T;
  N = length(N) > 1e-5 ? normalize(N) : normalize(cross(T, abs(T.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(T, N);
  vec3 n = cos(a) * N + sin(a) * B;
  vec4 wp = modelMatrix * vec4(p + uR * n, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
  // colour: the operation that made the loop, or its yarn
  int op = int(m2.x + 0.5), g = int(m2.y + 0.5);
  vec3 col = uLook < 0.5 ? (op >= 0 ? texelFetch(uPal, ivec2(op, 0), 0).rgb : vec3(1.0, 0.0, 1.0)) : uYarn[g];
  float glow = 0.0;
  if (uMode == 1) {
    if (m1.z > uRow + 0.5) col *= 0.3;            // passes not knitted yet: dim
    else if (abs(m1.z - uRow) < 0.5) glow = 0.35;  // the pass looked at
  } else {
    if (abs(m1.z - uRow) < 0.5) glow = 0.2;        // this pass's loops
  }
  if (float(loop) == uCurLoop) glow = 0.75;
  if (m1.w == uCell || float(loop) == uLoop) glow = 0.9;
  vCol = col;
  vGlow = glow;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vP;
varying vec3 vCol;
varying float vGlow;
void main() {
  vec3 n = normalize(vN), v = normalize(cameraPosition - vP);
  if (dot(n, v) < 0.0 && !gl_FrontFacing) n = -n; // a ring folded over at a sharp turn: shade it as the outside
  vec3 L1 = normalize(vec3(0.5, 0.9, 1.3)), L2 = normalize(vec3(-0.7, -0.3, -1.1));
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(vec3(0.09), vec3(0.36), hemi);
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  float sp = pow(max(dot(n, normalize(L1 + v)), 0.0), 36.0) * 0.22;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  vec3 c = vCol * (amb + 0.9 * d1 + 0.32 * d2) + sp;
  c = mix(c, vec3(1.0), vGlow * 0.45) + vec3(1.0) * rim * vGlow * 0.5;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** A ring geometry for one span: `rings` steps along it, `sides` around. position = (u, angle, 0). */
function spanGeometry(rings: number, sides: number) {
  const pos: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s < sides; s++) pos.push(r / rings, (s / sides) * Math.PI * 2, 0);
  for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
    const a = r * sides + s, b = r * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const LODS = [spanGeometry(2, 5), spanGeometry(4, 6), spanGeometry(6, 8)];

function dataTex(data: Float32Array, texels: number, prev?: THREE.DataTexture | null) {
  const h = Math.max(1, Math.ceil(texels / TEXW));
  if (prev && prev.image.height === h) { (prev.image.data as Float32Array).set(data.subarray(0, Math.min(data.length, TEXW * h * 4))); prev.needsUpdate = true; return prev; }
  prev?.dispose();
  const buf = new Float32Array(TEXW * h * 4);
  buf.set(data.subarray(0, Math.min(data.length, buf.length)));
  const t = new THREE.DataTexture(buf, TEXW, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Tubes for a set of spans over one points texture, split into chunks so far-away parts can be culled. */
class Tubes {
  group = new THREE.Group();
  private geos: THREE.InstancedBufferGeometry[] = [];
  constructor(mat: THREE.ShaderMaterial, spans: Float32Array, data: Float32Array, lod: number) {
    for (let a = 0; a < spans.length; a += CHUNK) {
      const sp = spans.subarray(a, Math.min(spans.length, a + CHUNK));
      const g = new THREE.InstancedBufferGeometry();
      this.setLod(g, lod);
      g.setAttribute('aSpan', new THREE.InstancedBufferAttribute(sp.slice(), 1));
      g.instanceCount = sp.length;
      g.boundingSphere = sphereOf(sp, data);
      const m = new THREE.Mesh(g, mat);
      this.group.add(m);
      this.geos.push(g);
    }
  }
  private setLod(g: THREE.InstancedBufferGeometry, lod: number) { const b = LODS[lod]; g.setAttribute('position', b.getAttribute('position')); g.setIndex(b.getIndex()); }
  lod(l: number) { this.geos.forEach(g => this.setLod(g, l)); }
  bounds(spans: Float32Array, data: Float32Array) { this.geos.forEach((g, k) => (g.boundingSphere = sphereOf(spans.subarray(k * CHUNK, Math.min(spans.length, (k + 1) * CHUNK)), data))); }
  dispose() { this.geos.forEach(g => { g.deleteAttribute('position'); g.setIndex(null); g.dispose(); }); this.group.removeFromParent(); }
}
function sphereOf(spans: Float32Array, data: Float32Array) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (let k = 0; k < spans.length; k++) { const i = spans[k] * 4; v.set(data[i], data[i + 1], data[i + 2]); if (Number.isFinite(v.x)) box.expandByPoint(v); }
  const s = new THREE.Sphere();
  if (box.isEmpty()) return s;
  box.getBoundingSphere(s); s.radius += 1;
  return s;
}

// ---------------------------------------------------------------- the view
export interface ViewCallbacks {
  onStatus?: (t: string) => void;
  /** a loop under the pointer (hover) or clicked; null when nothing is there */
  onPick?: (loop: number | null, click: boolean) => void;
}

export class KnitView {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.05, 5000);
  private controls: OrbitControls;
  private mat: THREE.ShaderMaterial;
  private matDyn: THREE.ShaderMaterial;
  private labels: HTMLDivElement;
  private ro: ResizeObserver;
  private sys: YarnSys | null = null;
  private lay: Detail | null = null;
  private machinePts: Float32Array | null = null;   // render points of the machine layout
  private machineFab: Float32Array | null = null;   // point positions (np * 3) of the machine layout
  private fabricPts: Float32Array | null = null;
  private texMachine: THREE.DataTexture | null = null;
  private frmMachine: THREE.DataTexture | null = null;
  private frmFabric: THREE.DataTexture | null = null;
  private frmDyn: THREE.DataTexture | null = null;
  private texFabric: THREE.DataTexture | null = null;
  private texDyn: THREE.DataTexture | null = null;
  private texMeta: THREE.DataTexture | null = null;
  private texMeta2: THREE.DataTexture | null = null;
  private texPal: THREE.DataTexture | null = null;
  private tubesMachine: Tubes | null = null;
  private tubesFabric: Tubes | null = null;
  private tubesDyn: Tubes | null = null;
  private extras = new THREE.Group();
  private fabricCentre = new THREE.Vector3();
  private centres: Float32Array | null = null;
  private dynCentres: { loop: number; x: number; y: number; z: number }[] = [];
  private lodNow = 1;
  private framed = '';
  mode: Mode = 'fabric';
  look: Look = 'yarn';
  fold = 0;
  row = 0;
  act = -1;
  private raf = 0;
  private labelEls = new Map<string, HTMLDivElement>();
  private labelAt = new Map<string, THREE.Vector3>();

  constructor(el: HTMLElement, private cb: ViewCallbacks = {}, private compact = false) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setClearColor(0x0b0b0b);
    el.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    this.labels.className = 'k3labels';
    el.appendChild(this.labels);
    const uniforms = () => ({
      uPts: { value: null }, uFrm: { value: null }, uMeta: { value: null }, uMeta2: { value: null }, uPal: { value: null },
      uYarn: { value: YARN_COLOURS.map(c => new THREE.Color(c)) }, uR: { value: 0.14 }, uMode: { value: 1 },
      uAct: { value: -1 }, uRow: { value: 0 }, uCell: { value: -1 }, uLoop: { value: -1 }, uCurLoop: { value: -1 }, uLook: { value: 1 }, uNOps: { value: 1 },
    });
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), side: THREE.DoubleSide });
    this.matDyn = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), side: THREE.DoubleSide });
    this.matDyn.uniforms.uMode.value = 2;
    this.scene.add(this.extras);
    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());
    this.ro = new ResizeObserver(() => this.size());
    this.ro.observe(el);
    this.wirePick();
    this.size();
  }

  // ---------------------------------------------------------------- data
  /** A new program (or new yarn parameters): rebuilds the machine layout; the fabric waits for setFabric. */
  setData(sys: YarnSys, key: Key, keepView = false) {
    this.sys = sys;
    const t = sys.t;
    this.lay = detailLayout(sys);
    // per loop: when it was made and knitted through, its row and cell; its operation, guide, the next loop's act, bed
    const m1 = new Float32Array(t.n * 4), m2 = new Float32Array(t.n * 4);
    for (let i = 0; i < t.n; i++) {
      m1[i * 4] = t.act[i]; m1[i * 4 + 1] = t.childAct[i] >= NEVER ? 1e9 : t.childAct[i]; m1[i * 4 + 2] = t.row[i]; m1[i * 4 + 3] = t.cell[i];
      m2[i * 4] = t.op[i]; m2[i * 4 + 1] = t.guide[i]; m2[i * 4 + 2] = t.next[i] >= 0 ? t.act[t.next[i]] : 1e9; m2[i * 4 + 3] = t.bed[i];
    }
    this.texMeta = dataTex(m1, t.n, this.texMeta && this.texMeta.image.height === Math.max(1, Math.ceil(t.n / TEXW)) ? this.texMeta : null);
    this.texMeta2 = dataTex(m2, t.n, this.texMeta2 && this.texMeta2.image.height === Math.max(1, Math.ceil(t.n / TEXW)) ? this.texMeta2 : null);
    this.setPalette(key);
    // the machine layout
    const flat = flatNormals(sys);
    this.machineFab = pointsOf(sys, sys.init, flat);
    this.machinePts = detailFill(sys, this.lay, sys.init, flat, this.machinePts && this.machinePts.length === this.lay.count * 4 ? this.machinePts : undefined);
    this.texMachine = dataTex(this.machinePts, this.lay.count, this.texMachine);
    this.frmMachine = dataTex(framesOf(this.machinePts, this.lay.groups), this.lay.count, this.frmMachine);
    this.tubesMachine?.dispose();
    this.tubesMachine = new Tubes(this.mat, this.lay.spans, this.machinePts, this.lodNow);
    this.tubesFabric?.dispose(); this.tubesFabric = null;
    this.fabricPts = null;
    for (const m of [this.mat, this.matDyn]) {
      m.uniforms.uMeta.value = this.texMeta; m.uniforms.uMeta2.value = this.texMeta2;
      m.uniforms.uR.value = sys.prm.d / 2;
    }
    const tag = `${t.w}x${t.h}|${this.mode}`;
    if (!keepView || this.framed !== tag) this.framed = '';
    this.show();
  }

  /** New operation colours (same program). */
  setPalette(key: Key) {
    const pal = new Float32Array(Math.max(1, key.ops.length) * 4);
    key.ops.forEach((o, i) => { const c = new THREE.Color().setRGB(o.rgb[0] / 255, o.rgb[1] / 255, o.rgb[2] / 255, THREE.SRGBColorSpace); pal.set([c.r, c.g, c.b, 1], i * 4); });
    this.texPal?.dispose();
    this.texPal = new THREE.DataTexture(pal, Math.max(1, key.ops.length), 1, THREE.RGBAFormat, THREE.FloatType);
    this.texPal.needsUpdate = true;
    for (const m of [this.mat, this.matDyn]) m.uniforms.uPal.value = this.texPal;
    this.render();
  }

  /** Relaxed node positions and loop normals (relax.ts) for the fabric view. */
  setFabric(pos: Float32Array, nrm: Float32Array) {
    const s = this.sys; if (!s || !this.lay || pos.length !== s.nn * 3 || nrm.length !== s.t.n * 3) return;
    this.fabricPts = detailFill(s, this.lay, pos, nrm, this.fabricPts && this.fabricPts.length === this.lay.count * 4 ? this.fabricPts : undefined);
    // centre it
    const box = new THREE.Box3(), v = new THREE.Vector3(), d = this.fabricPts;
    for (let k = 0; k < this.lay.count; k += 5) box.expandByPoint(v.set(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]));
    box.getCenter(this.fabricCentre);
    this.texFabric = dataTex(d, this.lay.count, this.texFabric);
    this.frmFabric = dataTex(framesOf(d, this.lay.groups), this.lay.count, this.frmFabric);
    if (!this.tubesFabric) this.tubesFabric = new Tubes(this.mat, this.lay.spans, d, this.lodNow);
    else this.tubesFabric.bounds(this.lay.spans, d);
    this.centres = detailCentres(s, this.lay, d, this.centres && this.centres.length === s.t.n * 3 ? this.centres : undefined);
    if (this.mode === 'fabric') this.show();
  }

  setMode(m: Mode) { if (m !== this.mode) { this.mode = m; this.framed = ''; this.show(); } }
  setLook(l: Look) { this.look = l; for (const m of [this.mat, this.matDyn]) m.uniforms.uLook.value = l === 'grammar' ? 0 : 1; this.render(); }
  setFold(f: number) { this.fold = f; if (this.mode === 'machine') this.show(); }
  /** The pass looked at (0 = pass 1) and the last action done. */
  setStep(row: number, act: number) {
    this.row = row; this.act = act;
    for (const m of [this.mat, this.matDyn]) { m.uniforms.uRow.value = row; m.uniforms.uAct.value = act; }
    if (this.mode === 'machine') this.show(); else this.render();
  }
  /** Shows a chart cell's loops (-1: none) and one loop (-1: none). */
  setMark(cell: number, loop = -1) { for (const m of [this.mat, this.matDyn]) { m.uniforms.uCell.value = cell; m.uniforms.uLoop.value = loop; } this.render(); }

  // ---------------------------------------------------------------- scene
  private show() {
    const s = this.sys; if (!s) return;
    this.clearExtras();
    this.tubesDyn?.dispose(); this.tubesDyn = null;
    this.tubesMachine?.group.removeFromParent(); this.tubesFabric?.group.removeFromParent();
    if (this.mode === 'fabric') {
      if (this.tubesFabric && this.texFabric) {
        this.mat.uniforms.uMode.value = 1; this.mat.uniforms.uPts.value = this.texFabric; this.mat.uniforms.uFrm.value = this.frmFabric; this.mat.uniforms.uCurLoop.value = -1;
        this.tubesFabric.group.position.copy(this.fabricCentre).multiplyScalar(-1);
        this.scene.add(this.tubesFabric.group);
      }
    } else this.showMachine();
    this.frameIfNeeded();
    this.render();
  }

  private showMachine() {
    const s = this.sys!, t = s.t, fr = machineFrame(s, this.fold, this.row);
    this.mat.uniforms.uMode.value = 0; this.mat.uniforms.uPts.value = this.texMachine; this.mat.uniforms.uFrm.value = this.frmMachine;
    const cur = this.act >= 0 && this.act < t.na ? this.act : -1, curLoop = cur >= 0 ? t.aLoop[cur] : -1;
    this.mat.uniforms.uCurLoop.value = curLoop; this.matDyn.uniforms.uCurLoop.value = curLoop;
    if (this.tubesMachine) { this.tubesMachine.group.position.set(...fr.shift); this.scene.add(this.tubesMachine.group); }
    // held loops on their hooks
    const held = heldPoints(s, this.machineFab!, this.act, fr);
    if (held.spans.length) {
      this.texDyn = dataTex(held.data, held.data.length / 4, this.texDyn);
      this.frmDyn = dataTex(framesOf(held.data, held.groups), held.data.length / 4, this.frmDyn);
      this.matDyn.uniforms.uPts.value = this.texDyn; this.matDyn.uniforms.uFrm.value = this.frmDyn;
      this.tubesDyn = new Tubes(this.matDyn, held.spans, held.data, this.lodNow);
      this.scene.add(this.tubesDyn.group);
    }
    this.dynCentres = [];
    for (let k = 0; k < held.held.length; k++) {
      let x = 0, y = 0, z = 0;
      for (let q = 1; q <= 5; q++) { const i = (k * 7 + q) * 4; x += held.data[i]; y += held.data[i + 1]; z += held.data[i + 2]; }
      this.dynCentres.push({ loop: held.held[k], x: x / 5, y: y / 5, z: z / 5 });
    }
    // needles
    let lo = 0, hi = t.w - 1;
    for (let a = 0; a <= Math.min(this.act, t.na - 1); a++) if (t.aType[a] === A_XFER) { lo = Math.min(lo, t.aTo[a]); hi = Math.max(hi, t.aTo[a]); }
    const lines: number[] = [], butts: number[] = [];
    for (const bed of [1, -1]) {
      const u = fr.along(bed);
      for (let x = lo - 1; x <= hi + 1; x++) {
        const h = fr.hook(bed, x), L = fr.needleLen;
        lines.push(h[0], h[1], h[2], h[0] + u[0] * L, h[1] + u[1] * L, h[2] + u[2] * L);
        butts.push(h[0] - 0.12, h[1] + u[1] * L * 0.85, h[2] + u[2] * L * 0.85, h[0] + 0.12, h[1] + u[1] * L * 0.85, h[2] + u[2] * L * 0.85);
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.extras.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6a6a6a })));
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(butts, 3));
    this.extras.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x3a3a3a })));
    // the needle the current action works, and this row's transfers
    if (cur >= 0) {
      const bed = t.aBed[cur] || 1, h = fr.hook(bed, t.aNeedle[cur]), u = fr.along(bed);
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...h), new THREE.Vector3(h[0] + u[0] * fr.needleLen, h[1] + u[1] * fr.needleLen, h[2] + u[2] * fr.needleLen)]);
      this.extras.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf4f4f4 })));
    }
    const r0 = t.rowAct[Math.min(this.row, t.h - 1)], r1 = t.rowAct[Math.min(this.row + 1, t.h)];
    for (let a = r0; a < r1 && a <= this.act; a++) {
      if (t.aType[a] !== A_XFER) continue;
      const A = new THREE.Vector3(...fr.hook(t.aBed[a], t.aNeedle[a])), B = new THREE.Vector3(...fr.hook(t.aToBed[a], t.aTo[a]));
      const mid = A.clone().add(B).multiplyScalar(0.5);
      mid.z += (this.fold < 0.5 ? 0.9 : 0) ; mid.y += this.fold < 0.5 ? 0.1 : 0.7;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B), pts = curve.getPoints(16);
      const on = a === cur;
      this.extras.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: on ? 0xf4f4f4 : 0xd09a4e })));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 10), new THREE.MeshBasicMaterial({ color: on ? 0xf4f4f4 : 0xd09a4e }));
      const dir = pts[16].clone().sub(pts[14]).normalize();
      head.position.copy(B); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.extras.add(head);
    }
    // carriers
    held.carriers.forEach(([g, x, y, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(YARN_COLOURS[g]) }));
      m.position.set(x, y, z); this.extras.add(m);
      this.label(`yg${g}`, `YG${g + 1}`, new THREE.Vector3(x, y + 0.45, z));
    });
    // labels
    const L = fr.needleLen, lx = lo - 1.5;
    const hb = fr.hook(-1, lx), ub = fr.along(-1), hf = fr.hook(1, lx), uf = fr.along(1);
    this.label('back', 'back bed', new THREE.Vector3(hb[0], hb[1] + ub[1] * L * 0.6, hb[2] + ub[2] * L * 0.6), 'right');
    this.label('front', 'front bed', new THREE.Vector3(hf[0], hf[1] + uf[1] * L * 0.6, hf[2] + uf[2] * L * 0.6), 'right');
    const top = fr.shift[1] + (this.row + 0.2) * s.c0;
    this.label('fabric', this.compact ? 'fabric so far · not relaxed' : 'fabric made so far · pulled down by the take-down · not relaxed', new THREE.Vector3(lo - 1.5, top, 0), 'right');
    const dir = t.strokeDir[t.aStroke[Math.max(0, Math.min(t.na - 1, cur >= 0 ? cur : t.rowAct[Math.min(this.row, t.h - 1)]))]];
    this.label('pass', `pass ${this.row + 1} ${dir === 1 ? '→' : '←'}`, new THREE.Vector3(hi + 1.6, (hf[1] + hb[1]) / 2, (hf[2] + hb[2]) / 2), 'left');
  }

  private clearExtras() {
    this.extras.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.extras.clear();
    this.labelAt.clear();
  }
  private label(id: string, text: string, at: THREE.Vector3, align: 'left' | 'right' | 'center' = 'center') {
    let el = this.labelEls.get(id);
    if (!el) { el = document.createElement('div'); el.className = 'k3label'; this.labels.appendChild(el); this.labelEls.set(id, el); }
    el.textContent = text; el.dataset.align = align;
    this.labelAt.set(id, at);
  }
  private placeLabels() {
    const w = this.el.clientWidth, h = this.el.clientHeight, v = new THREE.Vector3();
    for (const [id, el] of this.labelEls) {
      const at = this.labelAt.get(id);
      if (!at || this.mode !== 'machine') { el.hidden = true; continue; }
      v.copy(at).project(this.cam);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h, lw = el.offsetWidth || 60;
      el.hidden = v.z > 1 || y < 0 || y > h;
      // kept inside the view, so a label is never cut off at the edge
      const left = Math.max(4, Math.min(w - lw - 4, el.dataset.align === 'right' ? x - lw : el.dataset.align === 'left' ? x : x - lw / 2));
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px) translateY(-50%)`;
    }
  }

  private frameIfNeeded() {
    const s = this.sys; if (!s) return;
    const tag = `${s.t.w}x${s.t.h}|${this.mode}`;
    if (this.framed === tag) return;
    if (this.mode === 'fabric' && !this.fabricPts) return;
    this.framed = tag;
    this.frame();
  }

  /** Puts the whole thing in view: the fabric from the front and a little above, the machine from the front. */
  frame() {
    const s = this.sys; if (!s) return;
    const box = new THREE.Box3();
    if (this.mode === 'fabric' && this.fabricPts && this.lay) {
      const v = new THREE.Vector3(), p = this.fabricPts;
      for (let k = 0; k < this.lay.count; k += 3) box.expandByPoint(v.set(p[k * 4], p[k * 4 + 1], p[k * 4 + 2]).sub(this.fabricCentre));
    } else {
      const fr = machineFrame(s, this.fold, this.row);
      box.expandByPoint(new THREE.Vector3(-2, fr.hook(-1, 0)[1] + fr.needleLen * 0.9, 0));
      box.expandByPoint(new THREE.Vector3(s.t.w + 1.5, fr.shift[1] + (this.row - Math.min(this.row, 14)) * s.c0, 0));
    }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const t = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)), dist = Math.max(size.y / 2 / t, size.x / 2 / (t * this.cam.aspect)) * 1.12 + size.z;
    const dir = this.mode === 'fabric' ? new THREE.Vector3(0.18, 0.3, 1) : new THREE.Vector3(0.12, 0.22, 1);
    this.cam.position.copy(c).add(dir.normalize().multiplyScalar(dist));
    this.cam.near = dist / 200; this.cam.far = dist * 30; this.cam.updateProjectionMatrix();
    this.controls.target.copy(c); this.controls.update();
  }

  flip() { const c = this.controls.target, p = this.cam.position; this.cam.position.set(2 * c.x - p.x, p.y, 2 * c.z - p.z); this.controls.update(); this.render(); }

  private size() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.render();
  }

  /** Detail by how big a needle pitch is on screen. */
  private pickLod() {
    const d = this.cam.position.distanceTo(this.controls.target), px = this.el.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * Math.max(1e-3, d));
    const l = px > 46 ? 2 : px > 14 ? 1 : 0;
    if (l !== this.lodNow) { this.lodNow = l; this.tubesMachine?.lod(l); this.tubesFabric?.lod(l); this.tubesDyn?.lod(l); }
  }

  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.pickLod();
      this.renderer.render(this.scene, this.cam);
      this.placeLabels();
    });
  }
  /** Renders now and returns the time it took on the CPU side plus a GPU sync (for measuring). */
  renderNow() { this.pickLod(); const t0 = performance.now(); this.renderer.render(this.scene, this.cam); const gl = this.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t0; }

  // ---------------------------------------------------------------- picking
  private wirePick() {
    const cv = this.renderer.domElement;
    let down: { x: number; y: number } | null = null, last = -2, pend = 0;
    const at = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return this.pick((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', e => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.cb.onPick?.(at(e), true);
      down = null;
    });
    cv.addEventListener('pointermove', e => {
      if (down || pend) return;
      pend = requestAnimationFrame(() => { pend = 0; const l = at(e); if (l !== last) { last = l ?? -1; this.cb.onPick?.(l, false); } });
    });
    cv.addEventListener('pointerleave', () => { if (last !== -1) { last = -1; this.cb.onPick?.(null, false); } });
  }

  /** The loop nearest the camera under a screen point (normalised device coordinates), or null. */
  pick(nx: number, ny: number): number | null {
    const s = this.sys; if (!s) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, ny), this.cam);
    const o = ray.ray.origin, d = ray.ray.direction, r2 = 0.42 * 0.42;
    let best = -1, bestT = Infinity;
    const test = (loop: number, x: number, y: number, z: number) => {
      const vx = x - o.x, vy = y - o.y, vz = z - o.z, tt = vx * d.x + vy * d.y + vz * d.z;
      if (tt <= 0) return;
      const qx = vx - d.x * tt, qy = vy - d.y * tt, qz = vz - d.z * tt;
      if (qx * qx + qy * qy + qz * qz < r2 && tt < bestT) { bestT = tt; best = loop; }
    };
    const t = s.t;
    if (this.mode === 'fabric') {
      const c = this.centres; if (!c) return null;
      const f = this.fabricCentre;
      for (let i = 0; i < t.n; i++) test(i, c[i * 3] - f.x, c[i * 3 + 1] - f.y, c[i * 3 + 2] - f.z);
    } else {
      const fr = machineFrame(s, this.fold, this.row), m = this.machineFab!;
      for (let i = 0; i < t.n; i++) {
        if (t.act[i] > this.act || t.childAct[i] > this.act) continue;
        let x = 0, y = 0, z = 0;
        for (let q = 0; q < 5; q++) { const p = (s.loopPt[i] + q) * 3; x += m[p]; y += m[p + 1]; z += m[p + 2]; }
        test(i, x / 5 + fr.shift[0], y / 5 + fr.shift[1], z / 5 + fr.shift[2]);
      }
      for (const h of this.dynCentres) test(h.loop, h.x, h.y, h.z);
    }
    return best < 0 ? null : best;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect(); this.controls.dispose(); this.clearExtras();
    this.tubesMachine?.dispose(); this.tubesFabric?.dispose(); this.tubesDyn?.dispose();
    [this.texMachine, this.texFabric, this.texDyn, this.frmMachine, this.frmFabric, this.frmDyn, this.texMeta, this.texMeta2, this.texPal].forEach(t => t?.dispose());
    this.mat.dispose(); this.matDyn.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.labels.remove();
  }
}
