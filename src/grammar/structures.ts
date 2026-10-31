// Shape grammar for knitting: a design layer of signs, each sign knitted as a structure (a small tile of
// operations), with an optional structure for its outline. Generating turns the signs into the knit program.
// Also the experiments: ready-made designs that show a behaviour in the 3D view.
import type { Key, Op, RGB } from './ops';
import { defaultFill, type Design, type Pattern, type Sign, type Structure } from './pattern';

/** rows bottom (pass 1) first, as you read a knitting chart; stored top first like the image */
const S = (id: string, name: string, bottomUp: string[], note: string): Structure => {
  const rows = bottomUp.map(r => r.split(' ')).reverse();
  return { id, name, w: rows[0].length, h: rows.length, rows, note };
};

/** Structures in the 4.S52 basic key (one yarn guide). A needle that changes bed between passes needs its loop
 *  transferred first, which is why seed and garter use "knit and transfer". */
export const STRUCTURES_1: Structure[] = [
  S('jersey', 'single jersey', ['kf'], 'every needle knits on the front bed'),
  S('reverse', 'reverse jersey', ['kb'], 'every needle knits on the back bed'),
  S('rib11', '1 × 1 rib', ['kf kb'], 'front and back needles alternate; pulls in across'),
  S('rib22', '2 × 2 rib', ['kf kf kb kb'], 'pairs of front and back needles'),
  S('garter', 'garter (purl)', ['kfxb', 'kbxf'], 'each course changes bed by a transfer; ridges, pulls in along'),
  S('seed', 'seed', ['kfxb kbxf', 'kbxf kfxb'], 'face and back stitches alternate both ways'),
  S('tubular', 'tubular', ['kf', 'kb'], 'front and back beds in turn: two layers joined at the edges'),
  S('tuckmoss', 'tuck moss', ['kf tf', 'tf kf'], 'every other stitch tucks, offset each pass: thick, wide, puckered'),
  S('honeycomb', 'tuck honeycomb',['kf kf kf kf', 'tf kf kf kf', 'tf kf kf kf', 'kf kf kf kf', 'kf kf tf kf', 'kf kf tf kf'], 'double tucks, offset: raised cells; wider and shorter'),
  S('slip', 'float stripes', ['kf kf kf kf', 'kf fl fl kf'], 'floats behind every other pass; pulls in'),
  S('eyelet', 'eyelets', ['kf kf kf kf', 'kf kfxr kf kf', 'kf kf kf kf', 'kf kf kf kf'], 'a loop moved right leaves an empty needle: a hole'),
  S('hold', 'hold (short rows)', ['fl'], 'the needles knit nothing here; the rest grows longer'),
];

/** Structures in the 4.S52 two-guide key. */
export const STRUCTURES_2: Structure[] = [
  S('dk-a', 'double knit, YG1 face', ['k2f'], 'YG1 on the front bed, YG2 on the back'),
  S('dk-b', 'double knit, YG2 face', ['k2b'], 'YG2 on the front bed, YG1 on the back'),
  S('birdseye', 'mixed (birdseye)', ['k2f k2b', 'k2b k2f'], 'the two yarns alternate on the face'),
  S('tuck2', 'tuck pair', ['t2f'], 'both guides tuck, one on each bed'),
  S('yg1only', 'YG1 alone', ['g2'], 'YG1 knits the front, YG2 floats (provisional colour)'),
  S('hold2', 'hold (both float)', ['fl2'], 'nothing knits here'),
];

export const structuresFor = (p: Pattern): Structure[] => [...(p.key.mode === 2 ? STRUCTURES_2 : STRUCTURES_1), ...(p.design?.custom ?? [])];

/** Colours and letters of the design layer: chosen to read as "signs", not as operations. */
const SIGN_COLOURS: RGB[] = [[232, 226, 214], [242, 193, 78], [90, 169, 230], [232, 93, 117], [123, 211, 137], [178, 141, 255], [255, 159, 104], [78, 205, 196]];
export const MAX_SIGNS = SIGN_COLOURS.length;
export const newSign = (i: number, fill: string, name?: string): Sign => ({ name: name ?? `sign ${String.fromCharCode(65 + i)}`, letter: String.fromCharCode(65 + i), rgb: SIGN_COLOURS[i % SIGN_COLOURS.length], fill, edge: null });

export function newDesign(p: Pattern): Design {
  const two = p.key.mode === 2;
  return { cells: new Uint8Array(p.w * p.h), signs: [newSign(0, two ? 'dk-a' : 'jersey'), newSign(1, two ? 'dk-b' : 'rib11')], custom: [], live: true };
}

/** The design layer drawn through the editor as if it were a pattern: one "operation" per sign. */
export function signKey(signs: Sign[]): Key {
  return { id: 'signs', name: 'signs', mode: 1, ops: signs.map((s, i): Op => ({ id: `sign${i}`, name: s.name, colour: s.letter, rgb: s.rgb, steps: [{ action: 'float', bed: 'front' }], move: 'none', letter: s.letter })) };
}

/** A cell lies on its region's outline when a neighbour (left, right, above, below) has another sign. */
function isEdge(d: Design, w: number, h: number, x: number, y: number) {
  const s = d.cells[y * w + x];
  return (x > 0 && d.cells[y * w + x - 1] !== s) || (x < w - 1 && d.cells[y * w + x + 1] !== s) || (y > 0 && d.cells[(y - 1) * w + x] !== s) || (y < h - 1 && d.cells[(y + 1) * w + x] !== s);
}

/** The knit program the signs ask for: each cell takes its structure's operation at that needle and pass. */
export function generate(p: Pattern): Uint8Array {
  const d = p.design!, out = new Uint8Array(p.w * p.h), def = defaultFill(p.key);
  const byId = new Map(structuresFor(p).map(s => [s.id, s]));
  const resolved = new Map<string, number[][]>();
  const tile = (id: string | null) => {
    if (!id) return null;
    let t = resolved.get(id);
    if (!t) {
      const s = byId.get(id);
      if (!s) return null;
      t = s.rows.map(r => r.map(opId => { const i = p.key.ops.findIndex(o => o.id === opId); return i < 0 ? def : i; }));
      resolved.set(id, t);
    }
    return t;
  };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const i = y * p.w + x, sign = d.signs[d.cells[i]];
    const t = sign && ((sign.edge && isEdge(d, p.w, p.h, x, y) && tile(sign.edge)) || tile(sign.fill));
    if (!t) { out[i] = def; continue; }
    const th = t.length, tw = t[0].length, pass = p.h - 1 - y; // repeats start at needle 1, pass 1
    out[i] = t[th - 1 - (pass % th)][x % tw];
  }
  return out;
}

/** A structure from a rectangle of the knit program (rows top first). */
export function structureFrom(p: Pattern, r: { x: number; y: number; w: number; h: number }, name: string): Structure {
  const rows: string[][] = [];
  for (let y = 0; y < r.h; y++) rows.push(Array.from({ length: r.w }, (_, x) => p.key.ops[p.cells[(r.y + y) * p.w + r.x + x]]?.id ?? p.key.ops[0].id));
  return { id: `own-${Date.now().toString(36)}`, name, w: r.w, h: r.h, rows, note: 'your own: ' + [...new Set(rows.flat())].map(id => p.key.ops.find(o => o.id === id)?.name ?? id).slice(0, 3).join(', ') };
}


// ---------------------------------------------------------------- experiments
export interface Experiment {
  id: string;
  title: string;
  line: string;
  mode: 1 | 2;
  w: number;
  h: number;
  /** [fill, edge, name] per sign */
  signs: [string, string | null, string][];
  /** sign index at needle x (0 = left) and pass (0 = pass 1) */
  draw: (x: number, pass: number, w: number, h: number) => number;
  look: string;
  tries: string[];
}

const disc = (x: number, pass: number, w: number, h: number, r: number) => Math.hypot(x - (w - 1) / 2, pass - (h - 1) / 2) <= r;

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'accordion', title: 'Accordion', line: 'bands of rib between jersey', mode: 1, w: 40, h: 42,
    signs: [['jersey', null, 'jersey'], ['rib11', null, 'rib']],
    draw: (_x, pass) => (Math.floor(pass / 7) % 2 ? 1 : 0),
    look: 'Rib pulls in across its width, jersey does not. The rib bands gather and the fabric between them waves.',
    tries: ['Make the rib bands thinner or wider.', 'Set sign B to 2 × 2 rib and compare.', 'Draw the rib as a diagonal band instead.'],
  },
  {
    id: 'bubble', title: 'Bubble', line: 'a disc of tucks in jersey', mode: 1, w: 40, h: 40,
    signs: [['jersey', null, 'jersey'], ['tuckmoss', null, 'tucks']],
    draw: (x, pass, w, h) => (disc(x, pass, w, h, 11) ? 1 : 0),
    look: 'Tucks make the fabric wider but add less length. The disc wants a different size than the jersey around it, so it has to leave the plane.',
    tries: ['Grow or shrink the disc.', 'Give sign B an outline of float stripes.', 'Draw two discs side by side.'],
  },
  {
    id: 'cup', title: 'Cup', line: 'short rows: the middle knits more', mode: 1, w: 40, h: 40,
    signs: [['jersey', null, 'jersey'], ['hold', null, 'hold']],
    draw: (x, pass, w) => (pass >= 8 && pass <= 31 && Math.abs(x - (w - 1) / 2) > 4 + Math.abs(pass - 19.5) * 1.7 ? 1 : 0),
    look: 'Held needles knit nothing for a while, so they add no length. The middle needles knit every pass and grow longer than the sides: the fabric cups.',
    tries: ['Hold only one side: the fabric turns instead of cupping.', 'Make the held wedges taller.', 'Hold a band across the whole width: what happens?'],
  },
  {
    id: 'ridges', title: 'Ridges', line: 'garter stripes across jersey', mode: 1, w: 40, h: 40,
    signs: [['jersey', null, 'jersey'], ['garter', null, 'garter']],
    draw: (_x, pass) => (pass % 10 >= 6 ? 1 : 0),
    look: 'Garter changes bed every course (knit and transfer), so it pulls in along its length and stands out as ridges.',
    tries: ['Make every stripe garter: how much shorter is it?', 'Use seed stitch for sign B.'],
  },
  {
    id: 'pleats', title: 'Pleats', line: 'wales of reverse stitches', mode: 1, w: 40, h: 36,
    signs: [['jersey', null, 'face'], ['reverse', null, 'back']],
    draw: x => (x % 8 >= 6 ? 1 : 0),
    look: 'Where face stitches meet back stitches in one pass, the two pull opposite ways: the fabric folds along the wales.',
    tries: ['Make the reverse wales wider.', 'Alternate 4 and 4: it becomes a broad rib.'],
  },
  {
    id: 'window', title: 'Window', line: 'a square of eyelets', mode: 1, w: 40, h: 40,
    signs: [['jersey', null, 'jersey'], ['eyelet', 'rib11', 'lace']],
    draw: (x, pass) => (x >= 12 && x < 28 && pass >= 12 && pass < 28 ? 1 : 0),
    look: 'Each loop moved right leaves an empty needle that knits again: a small hole. The window is lace, framed by a rib outline (sign B\'s edge).',
    tries: ['Turn the outline off (edge: none).', 'Make the window a circle.'],
  },
  {
    id: 'picture', title: 'Two-yarn picture', line: 'double knit with two guides', mode: 2, w: 36, h: 36,
    signs: [['dk-a', null, 'YG1 face'], ['dk-b', null, 'YG2 face']],
    draw: (x, pass, w) => { const u = (x - (w - 1) / 2) / 9, v = (pass - 15) / 9; return (u * u + v * v - 1) ** 3 - u * u * v * v * v < 0 ? 1 : 0; },
    look: 'The yarn on the front bed shows on the face: the heart is YG2, the rest YG1, and the back is the reverse. Turn it over in 3D.',
    tries: ['Write your initial with sign B.', 'Set sign A to "mixed (birdseye)".'],
  },
  {
    id: 'own', title: 'Your own grammar', line: 'four signs, a blank sheet', mode: 1, w: 40, h: 40,
    signs: [['jersey', null, 'ground'], ['rib11', null, 'rib'], ['honeycomb', 'slip', 'tucks'], ['hold', null, 'hold']],
    draw: () => 0,
    look: 'Paint regions with signs B, C and D (switch the layer to signs, pick a sign, draw), then change what each sign means in 12 grammar. The program and the 3D view follow.',
    tries: ['Save a motif you drew in the knit program as a new structure.', 'Give a sign an outline of a different structure.'],
  },
];

export function experimentDesign(e: Experiment, p: Pattern): Design {
  const d: Design = { cells: new Uint8Array(p.w * p.h), signs: e.signs.map(([fill, edge, name], i) => ({ ...newSign(i, fill, name), edge })), custom: [], live: true };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) d.cells[y * p.w + x] = e.draw(x, p.h - 1 - y, p.w, p.h);
  return d;
}
