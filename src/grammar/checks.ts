// Warnings, never blocking. Limits are rules of thumb the user sets for their yarn and machine.
import { UNKNOWN, type Pattern } from './pattern';
import type { Bed } from './ops';

export interface Limits { float: number; held: number; tucks: number }
export const DEFAULT_LIMITS: Limits = { float: 6, held: 12, tucks: 4 };

export interface Finding { id: string; title: string; text: string; cells: number[] }

export function runChecks(p: Pattern, lim: Limits): Finding[] {
  const { w, h, cells, key } = p, out: Finding[] = [];
  const at = (x: number, y: number) => cells[y * w + x];
  const opAt = (x: number, y: number) => { const v = at(x, y); return v < UNKNOWN ? key.ops[v] : null; };

  const unknown: number[] = [], edge: number[] = [], prov: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const op = opAt(x, y), i = y * w + x;
    if (!op) { unknown.push(i); continue; }
    if ((op.move === 'left' && x === 0) || (op.move === 'right' && x === w - 1)) edge.push(i);
    if (op.provisional) prov.push(i);
  }
  if (unknown.length) out.push({ id: 'unknown', title: 'unknown colours', text: `${unknown.length} cells have a colour that isn't in the key. They are kept and written back as they were; paint over them or change the key.`, cells: unknown });
  if (edge.length) out.push({ id: 'edge', title: 'transfer off the edge', text: `${edge.length} cells move a loop left of needle 1 or right of the last needle, outside the pattern's needles.`, cells: edge });

  // floats: per pass and yarn guide, runs of floats with a stitch of that guide on both sides
  const floats: number[] = [];
  for (let y = 0; y < h; y++) for (let g = 0; g < key.mode; g++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      const op = opAt(x, y), s = op?.steps[g];
      if (!s || s.action === 'float') continue;
      if (last >= 0 && x - last - 1 > lim.float) for (let k = last + 1; k < x; k++) floats.push(y * w + k);
      last = x;
    }
  }
  if (floats.length) out.push({ id: 'float', title: `floats longer than ${lim.float}`, text: `A yarn guide passes more than ${lim.float} needles without a stitch in ${new Set(floats.map(i => (i / w) | 0)).size} passes. Long floats snag; set the limit for your gauge and yarn.`, cells: [...new Set(floats)] });

  // held loops and stacked tucks, per needle and bed, from pass 1 upwards
  const held: number[] = [], tucks: number[] = [];
  for (let x = 0; x < w; x++) for (const bed of ['front', 'back'] as Bed[]) {
    let loop = false, idle: number[] = [], tuckRun: number[] = [];
    for (let y = h - 1; y >= 0; y--) {
      const op = opAt(x, y);
      const mine = op?.steps.filter(s => s.action !== 'float' && s.bed === bed) ?? [];
      const knits = mine.some(s => s.action === 'knit'), tucked = mine.some(s => s.action === 'tuck');
      if (knits) {
        if (idle.length > lim.held) held.push(...idle);
        if (tuckRun.length > lim.tucks) tucks.push(...tuckRun);
        idle = []; tuckRun = []; loop = true;
      } else if (loop || tucked) {
        idle.push(y * w + x);
        if (tucked) tuckRun.push(y * w + x);
        loop = true;
      }
      // a transfer takes the loop off this needle
      if (op && op.move !== 'none' && op.steps.some(s => s.action !== 'float' && s.bed === bed)) { loop = false; idle = []; tuckRun = []; }
    }
    if (idle.length > lim.held) held.push(...idle);
    if (tuckRun.length > lim.tucks) tucks.push(...tuckRun);
  }
  if (tucks.length) out.push({ id: 'tucks', title: `more than ${lim.tucks} tucks stacked`, text: `Some needles collect more than ${lim.tucks} tuck loops before they knit again; the hook may not hold them all.`, cells: [...new Set(tucks)] });
  if (held.length) out.push({ id: 'held', title: `loops held over ${lim.held} passes`, text: `Some needles keep their loop for more than ${lim.held} passes without knitting (tucks and floats). Held loops stretch, as in short rows; set the limit for your yarn.`, cells: [...new Set(held)] });
  if (prov.length) out.push({ id: 'provisional', title: 'provisional colours', text: `${prov.length} cells use a colour that the lab's script hasn't confirmed yet (two-guide brown / gold).`, cells: prov });
  return out;
}
