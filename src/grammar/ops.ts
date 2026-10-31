// Knit grammar: what a cell means. A cell is one needle in one carriage pass; its colour names an operation.
// Operations are composed from a small vocabulary (action × bed × transfer, or one step per yarn guide), so every
// key, preset or custom, keeps its machine meaning, its symbol and its link to Learn.

export type Bed = 'front' | 'back';
export type Action = 'knit' | 'tuck' | 'float';
/** A transfer after the stitch: to the opposite bed, or one needle left / right. */
export type Move = 'none' | 'across' | 'left' | 'right';
export type RGB = [number, number, number];

/** What one yarn guide does at one needle in one pass. A float has no bed. */
export interface Step { action: Action; bed: Bed }

export interface Op {
  id: string;
  name: string;
  /** The colour's name in the key it came from ("dark_blue"), for the TXT / PDF key. */
  colour: string;
  rgb: RGB;
  /** One step per yarn guide: [step] in a one-guide key, [yg1, yg2] in a two-guide key. */
  steps: Step[];
  move: Move;
  /** Value not yet confirmed (shown as "provisional" wherever the op is listed). */
  provisional?: boolean;
  note?: string;
  /** Design signs (shape grammar) are drawn as a letter instead of an operation symbol. */
  letter?: string;
}

export interface Key {
  id: string;
  name: string;
  mode: 1 | 2;
  ops: Op[];
  preset?: boolean;
  credit?: string;
  notes?: string[];
}

export const CREDIT = 'Colour key from Computational Textiles (MIT 4.S52/6.S895, Spring 2026), Mariana Popescu.';

const K = (bed: Bed): Step => ({ action: 'knit', bed });
const T = (bed: Bed): Step => ({ action: 'tuck', bed });
const F: Step = { action: 'float', bed: 'front' };
const other = (b: Bed): Bed => (b === 'front' ? 'back' : 'front');

/** One-guide class key: the basic convention and basic transfers. */
export const BASIC: Key = {
  id: '4s52-basic', name: '4.S52 basic key', mode: 1, preset: true, credit: CREDIT,
  notes: [
    'Dark = front bed, light = back bed, white = float.',
    'light_green is read as knit back + transfer left: the source lists it as front, which would repeat dark_green and break the light = back rule.',
  ],
  ops: [
    { id: 'fl', name: 'float', colour: 'white', rgb: [255, 255, 255], steps: [F], move: 'none', note: 'back or front' },
    { id: 'kf', name: 'knit front', colour: 'dark_blue', rgb: [0, 0, 255], steps: [K('front')], move: 'none' },
    { id: 'kb', name: 'knit back', colour: 'light_blue', rgb: [35, 160, 240], steps: [K('back')], move: 'none' },
    { id: 'tf', name: 'tuck front', colour: 'dark_purple', rgb: [170, 80, 245], steps: [T('front')], move: 'none' },
    { id: 'tb', name: 'tuck back', colour: 'light_purple', rgb: [210, 150, 250], steps: [T('back')], move: 'none' },
    { id: 'kfxb', name: 'knit front, transfer to back', colour: 'dark_yellow', rgb: [250, 200, 0], steps: [K('front')], move: 'across' },
    { id: 'kbxf', name: 'knit back, transfer to front', colour: 'light_yellow', rgb: [250, 225, 125], steps: [K('back')], move: 'across' },
    { id: 'kfxr', name: 'knit front, transfer right', colour: 'dark_orange', rgb: [245, 115, 5], steps: [K('front')], move: 'right' },
    { id: 'kfxl', name: 'knit front, transfer left', colour: 'dark_green', rgb: [0, 115, 45], steps: [K('front')], move: 'left' },
    { id: 'kbxr', name: 'knit back, transfer right', colour: 'light_orange', rgb: [250, 180, 115], steps: [K('back')], move: 'right' },
    { id: 'kbxl', name: 'knit back, transfer left', colour: 'light_green', rgb: [115, 230, 130], steps: [K('back')], move: 'left', note: 'source says front; read as back' },
  ],
};

/** Two-guide class key: each cell holds what both yarn guides do at that needle in the same pass. */
export const TWO: Key = {
  id: '4s52-two', name: '4.S52 two yarn guides', mode: 2, preset: true, credit: CREDIT,
  notes: [
    'The shade says which bed yarn guide 1 is on; yarn guide 2 works the other bed.',
    'Brown and gold are provisional until the lab\'s script confirms them (recovered from a screenshot as #996600 and #CC9900).',
  ],
  ops: [
    { id: 'fl2', name: 'both float', colour: 'white', rgb: [255, 255, 255], steps: [F, F], move: 'none' },
    { id: 'k2f', name: 'YG1 knit front · YG2 knit back', colour: 'dark_blue', rgb: [0, 0, 255], steps: [K('front'), K('back')], move: 'none' },
    { id: 'k2b', name: 'YG1 knit back · YG2 knit front', colour: 'light_blue', rgb: [35, 160, 240], steps: [K('back'), K('front')], move: 'none' },
    { id: 't2f', name: 'YG1 tuck front · YG2 tuck back', colour: 'dark_purple', rgb: [170, 80, 245], steps: [T('front'), T('back')], move: 'none' },
    { id: 't2b', name: 'YG1 tuck back · YG2 tuck front', colour: 'light_purple', rgb: [210, 150, 250], steps: [T('back'), T('front')], move: 'none' },
    { id: 'g2', name: 'YG1 knit front · YG2 float', colour: 'gold', rgb: [204, 153, 0], steps: [K('front'), F], move: 'none', provisional: true },
    { id: 'b2', name: 'YG1 float · YG2 knit back', colour: 'brown', rgb: [153, 102, 0], steps: [F, K('back')], move: 'none', provisional: true },
  ],
};

export const PRESETS: Key[] = [BASIC, TWO];

// ---------------------------------------------------------------- symbols
// 13 × 13 glyphs, redrawn cell for cell from the class's symbol key. The bed line runs across row 6; a loop above it is
// on the back bed, below it on the front bed. Every other symbol is composed from the parts of these.
type Glyph = string[];
const CLASS: Record<string, Glyph> = {
  kb: ['.............', '.............', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '..###...###..', '.............', '.............', '.............', '.............', '.............', '.............'],
  tb: ['.............', '.............', '.............', '......#......', '.....#.#.....', '....#...#....', '..##.....##..', '.............', '.............', '.............', '.............', '.............', '.............'],
  fl: ['.............', '.............', '.............', '.............', '.............', '.............', '..#########..', '.............', '.............', '.............', '.............', '.............', '.............'],
  kbxf: ['.............', '.............', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '..###...###..', '......#......', '....#.#.#....', '.....#.#.....', '......#......', '.............', '.............'],
  kbxl: ['.............', '.............', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '..###...###..', '....###.#....', '....##..#....', '....#.#.#....', '.......##....', '.............', '.............'],
  kbxr: ['.............', '.............', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '..###...###..', '....#.###....', '....#..##....', '....#.#.#....', '....##.......', '.............', '.............'],
  kf: ['.............', '.............', '.............', '.............', '.............', '.............', '..###...###..', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '.............', '.............'],
  tf: ['.............', '.............', '.............', '.............', '.............', '.............', '..##.....##..', '....#...#....', '.....#.#.....', '......#......', '.............', '.............', '.............'],
  kfxb: ['.............', '.............', '......#......', '.....#.#.....', '....#.#.#....', '......#......', '..###...###..', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '.............', '.............'],
  kfxl: ['.............', '.............', '..#..##......', '..#.#..#.....', '..##....#....', '..####...#...', '..###...###..', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '.............', '.............'],
  kfxr: ['.............', '.............', '......##..#..', '.....#..#.#..', '....#....##..', '...#...####..', '..###...###..', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '.............', '.............'],
  k2b: ['.............', '.............', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '..###...###..', '.............', '......#......', '.....#.#.....', '......#......', '.............', '.............'],
  k2f: ['.............', '.............', '.............', '......#......', '.....#.#.....', '......#......', '..###...###..', '.....###.....', '....#...#....', '....#...#....', '.....###.....', '.............', '.............'],
  t2: ['.............', '.............', '......#......', '.....#.#.....', '....#...#....', '..##.....##..', '.............', '..##.....##..', '....#...#....', '.....#.#.....', '......#......', '.............', '.............'],
  fl2: ['.............', '.............', '.............', '.............', '.............', '..#########..', '.............', '..#########..', '.............', '.............', '.............', '.............', '.............'],
};

export const GLYPH = 13;
const EMPTY: Glyph = Array(GLYPH).fill('.'.repeat(GLYPH));
const or = (...gs: Glyph[]): Glyph => EMPTY.map((_, y) => [...EMPTY[y]].map((_, x) => (gs.some(g => g[y][x] === '#') ? '#' : '.')).join(''));
const minus = (a: Glyph, b: Glyph): Glyph => a.map((r, y) => [...r].map((c, x) => (c === '#' && b[y][x] !== '#' ? '#' : '.')).join(''));
const rows = (g: Glyph, from: number, to: number): Glyph => g.map((r, y) => (y >= from && y <= to ? r : EMPTY[y]));
const line = (y: number): Glyph => EMPTY.map((r, i) => (i === y ? '..#########..' : r));

const stitchGlyph = (s: Step): Glyph =>
  s.action === 'float' ? CLASS.fl : s.action === 'knit' ? (s.bed === 'back' ? CLASS.kb : CLASS.kf) : s.bed === 'back' ? CLASS.tb : CLASS.tf;

/** The transfer arrow alone: a class "knit + transfer" symbol minus its knit symbol. */
function arrow(bed: Bed, move: Move): Glyph {
  if (move === 'none') return EMPTY;
  const k = bed === 'back' ? 'kb' : 'kf';
  const id = `${k}x${move === 'across' ? (bed === 'back' ? 'f' : 'b') : move === 'left' ? 'l' : 'r'}`;
  return minus(CLASS[id], CLASS[k]);
}

/** The small mark yarn guide 2 leaves on its side of the bed line (class two-guide symbols). */
function secondMark(s: Step): Glyph {
  if (s.action === 'knit') return s.bed === 'back' ? rows(CLASS.k2f, 0, 5) : rows(CLASS.k2b, 7, 12);
  if (s.action === 'tuck') return s.bed === 'back' ? rows(CLASS.tb, 0, 5) : rows(CLASS.tf, 7, 12);
  return EMPTY;
}

/** The symbol of an operation, as 13 rows of '#' / '.'. Class operations give back the class symbol exactly. */
export function glyphOf(op: Op): Glyph {
  const [a, b] = op.steps;
  if (!b) {
    const bed = a.action === 'float' ? 'front' : a.bed;
    return or(stitchGlyph(a), arrow(bed, op.move));
  }
  if (a.action === 'float' && b.action === 'float') return CLASS.fl2;
  if (a.action === 'tuck' && b.action === 'tuck') return CLASS.t2;
  if (a.action === 'knit' && b.action === 'knit') return a.bed === 'back' ? CLASS.k2b : CLASS.k2f;
  if (b.action === 'float') return or(stitchGlyph(a), line(a.bed === 'back' ? 8 : 4)); // the other guide floats: a second line on the free side
  if (a.action === 'float') return or(stitchGlyph(b), line(b.bed === 'back' ? 8 : 4));
  return or(stitchGlyph(a), secondMark(b));
}

/** The symbol one yarn guide's step would have on its own (the guides view). */
export const stepGlyph = (s: Step): Glyph => stitchGlyph(s);

// ---------------------------------------------------------------- words
const BEDS: Record<Bed, string> = { front: 'front', back: 'back' };
export const stepText = (s: Step) => (s.action === 'float' ? 'float' : `${s.action} ${BEDS[s.bed]}`);
export const moveText = (m: Move, bed: Bed) => (m === 'none' ? '' : m === 'across' ? `transfer to ${other(bed)}` : `transfer ${m}`);

/** A name built from the meaning, for custom operations. */
export function autoName(steps: Step[], move: Move): string {
  if (steps.length === 2) return steps[0].action === 'float' && steps[1].action === 'float' ? 'both float' : `YG1 ${stepText(steps[0])} · YG2 ${stepText(steps[1])}`;
  const s = steps[0];
  if (s.action === 'float') return move === 'none' ? 'float' : `transfer only, ${move === 'across' ? 'to the other bed' : move}`;
  return move === 'none' ? stepText(s) : `${stepText(s)}, ${moveText(move, s.bed)}`;
}

/** Two operations mean the same thing on the machine. */
export function sameMeaning(a: Op, b: Op) {
  if (a.steps.length !== b.steps.length || a.move !== b.move) return false;
  return a.steps.every((s, i) => s.action === b.steps[i].action && (s.action === 'float' || s.bed === b.steps[i].bed));
}

export const hex = (c: RGB) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
export const rgbText = (c: RGB) => `(${c.join(', ')})`;
/** Relative luminance, to pick a symbol colour that reads on the cell. */
export const luma = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/** Learn page that explains an operation's main action. */
export function learnPageOf(op: Op): string {
  if (op.move !== 'none') return 'operations#transfer';
  const acts = new Set(op.steps.map(s => s.action));
  if (op.steps.length === 2) return 'guides';
  return acts.has('tuck') ? 'operations#tuck' : acts.has('float') ? 'operations#float' : 'operations#knit';
}

export const cloneKey = (k: Key): Key => structuredClone({ ...k, preset: undefined });
export const otherBed = other;
