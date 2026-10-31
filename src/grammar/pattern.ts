// A knit grammar pattern: W needles × H passes. Cells are stored like an image, row 0 on top; the bottom row is
// pass 1, the first pass knitted. A cell holds an operation index into the pattern's key, or UNKNOWN + k for a
// colour an import couldn't read (kept as it was, in pattern.unknown[k]).
import { BASIC, cloneKey, type Key, type RGB } from './ops';

export const UNKNOWN = 128;
export const MAX_SIDE = 600;

export interface Pattern {
  v: 1;
  id: string;
  name: string;
  w: number;
  h: number;
  key: Key;
  cells: Uint8Array;
  unknown: RGB[];
  /** Direction of pass 1: 1 = left to right, -1 = right to left. Passes alternate from there. */
  firstDir: 1 | -1;
  /** What the pattern is meant to do (the intention written next to the key). */
  note?: string;
  /** The pattern's own shape grammar: a layer of signs, each knitted as a structure (see structures.ts). */
  design?: Design;
  /** The experiment this pattern was started from, if any. */
  exp?: string;
  created: number;
  updated: number;
}

/** A structure: a small tile of operations (op ids), rows top (last pass) to bottom, repeated from needle 1 and
 *  pass 1 so that neighbouring regions mesh. */
export interface Structure { id: string; name: string; w: number; h: number; rows: string[][]; note?: string }
/** A sign: a name and a colour on the design layer, the structure it is knitted as, and the structure of its
 *  outline (cells touching another sign), or none. */
export interface Sign { name: string; letter: string; rgb: RGB; fill: string; edge: string | null }
export interface Design { cells: Uint8Array; signs: Sign[]; custom: Structure[]; live: boolean }

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** The index of the key's "nothing happens here" operation (float / both float), or 0. */
export function floatIndex(key: Key) {
  const i = key.ops.findIndex(o => o.move === 'none' && o.steps.every(s => s.action === 'float'));
  return i < 0 ? 0 : i;
}

export function createPattern(o: { name?: string; w?: number; h?: number; key?: Key; fill?: number } = {}): Pattern {
  const key = o.key ? cloneKey(o.key) : cloneKey(BASIC);
  key.preset = (o.key ?? BASIC).preset; // a pattern keeps a copy of its key; presets stay marked as such
  const w = o.w ?? 50, h = o.h ?? 50, now = Date.now();
  const fill = o.fill ?? defaultFill(key);
  return { v: 1, id: newId(), name: o.name ?? 'untitled', w, h, key, cells: new Uint8Array(w * h).fill(fill), unknown: [], firstDir: 1, created: now, updated: now };
}

/** New patterns start as plain jersey on the front bed when the key has it, otherwise as floats. */
export function defaultFill(key: Key) {
  const i = key.ops.findIndex(o => o.move === 'none' && o.steps.length === 1 && o.steps[0].action === 'knit' && o.steps[0].bed === 'front');
  return i >= 0 ? i : floatIndex(key);
}

/** Pass number (1 = first knitted) of image row y. */
export const passOf = (p: Pattern, y: number) => p.h - y;
/** Direction of image row y: 1 = left to right. */
export const dirOf = (p: Pattern, y: number) => ((p.h - 1 - y) % 2 === 0 ? p.firstDir : -p.firstDir) as 1 | -1;

/** Resize keeping the bottom-left corner (pass 1, needle 1) in place; new cells get `fill`. */
export function resized(p: Pattern, w: number, h: number, fill: number, cells = p.cells): Uint8Array {
  const out = new Uint8Array(w * h).fill(fill);
  for (let y = 0; y < h; y++) {
    const sy = p.h - h + y; // same distance from the bottom
    if (sy < 0 || sy >= p.h) continue;
    for (let x = 0; x < Math.min(w, p.w); x++) out[y * w + x] = cells[sy * p.w + x];
  }
  return out;
}

/** The RGB a cell is written as. */
export const cellRGB = (p: Pattern, v: number): RGB => (v >= UNKNOWN ? p.unknown[v - UNKNOWN] ?? [255, 0, 255] : p.key.ops[v]?.rgb ?? [255, 0, 255]);

// ---------------------------------------------------------------- project file (JSON)
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function toJSON(p: Pattern): string {
  return JSON.stringify({
    format: 'knit-grammar-pattern', version: 1,
    name: p.name, needles: p.w, passes: p.h, firstPass: p.firstDir === 1 ? 'left-to-right' : 'right-to-left',
    yarnGuides: p.key.mode,
    key: { name: p.key.name, id: p.key.id, mode: p.key.mode, credit: p.key.credit, notes: p.key.notes, ops: p.key.ops },
    unknownColours: p.unknown,
    note: p.note ?? '',
    rowsTopToBottom: 'cells are op indices, row 0 = last pass (as in the image)',
    cells: b64(p.cells),
    design: p.design && { signs: p.design.signs, structures: p.design.custom, live: p.design.live, cells: b64(p.design.cells) },
  }, null, 1);
}

export function fromJSON(text: string): Pattern {
  const j = JSON.parse(text);
  if (j?.format !== 'knit-grammar-pattern') throw new Error('not a knit grammar project file');
  const w = j.needles | 0, h = j.passes | 0;
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) throw new Error('size out of range');
  const cells = unb64(j.cells);
  if (cells.length !== w * h) throw new Error('cells don\'t match the size');
  const key: Key = { id: j.key.id ?? 'custom', name: j.key.name ?? 'imported key', mode: j.key.mode === 2 ? 2 : 1, ops: j.key.ops, credit: j.key.credit, notes: j.key.notes };
  const now = Date.now();
  const d = j.design, dcells = d ? unb64(d.cells) : null;
  const design: Design | undefined = d && dcells && dcells.length === w * h ? { cells: dcells, signs: d.signs ?? [], custom: d.structures ?? [], live: !!d.live } : undefined;
  return { v: 1, id: newId(), name: j.name ?? 'imported', w, h, key, cells, unknown: j.unknownColours ?? [], firstDir: j.firstPass === 'right-to-left' ? -1 : 1, note: j.note ?? '', design, created: now, updated: now };
}
