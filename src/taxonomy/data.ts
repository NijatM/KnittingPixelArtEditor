// The records Knitting Taxonomy shows, with the vocabularies and the indexes the views need. The demo set
// (src/taxonomy/data/demo, written by scripts/taxonomy-demo.mjs) is bundled into this section's chunk only.
// SHOW_DEMO is the one switch that removes every demo record. In development, ?taxset=test loads the private
// 1000-sample test set instead (research/private_tests, never built or published).
import type { Fiber, Origin, Sample, Term, Yarn, YarnType } from './core';
import { sampleOrigin, yarnShares, yarnType } from './core.js';

/** false removes the generated demo samples, yarns and fibres from the site. */
export const SHOW_DEMO = true;

const VOCAB = import.meta.glob<{ terms: Term[] }>('./vocab/*.json', { eager: true, import: 'default' });
export const vocab = (n: string) => VOCAB[`./vocab/${n}.json`].terms;

export interface Structure extends Term { family: string; pattern: string | null }
export interface Property extends Term { group: string; unit: string; direction: string | null; tag_key: string; methods: string[] }
export interface YarnUse { yarn: Yarn; role: string; type: YarnType; shares: { origin: Origin; pct: number }[] }
export interface Rec {
  s: Sample; i: number; structure: Structure; family: string; origin: YarnType; yarns: YarnUse[];
  /** lower-case words the search box matches against */
  words: string;
}
export interface DB {
  demo: boolean; fibers: Map<string, Fiber>; yarns: Map<string, Yarn>; recs: Rec[]; byId: Map<string, Rec>;
  structures: Structure[]; families: string[]; properties: Property[]; colours: Map<string, string>;
}

const FAMILIES = ['plain', 'rib', 'purl', 'interlock'];

function build(fibers: Fiber[], yarns: Yarn[], samples: Sample[], demo: boolean): DB {
  const F = new Map(fibers.map(f => [f.fiber_id, f])), Y = new Map(yarns.map(y => [y.yarn_id, y]));
  const structures = vocab('structure') as Structure[], S = new Map(structures.map(s => [s.id, s]));
  const unknownStructure: Structure = { id: 'unknown', label: 'unknown structure', definition: '', status: '', family: 'unknown', pattern: null };
  const recs = samples.slice().sort((a, b) => a.sample_id.localeCompare(b.sample_id)).map((s, i): Rec => {
    const structure = S.get(s.structure) ?? unknownStructure;
    const uses = s.sample_yarn.flatMap(sy => { const y = Y.get(sy.yarn_id); return y ? [{ yarn: y, role: sy.yarn_role, type: yarnType(y, F), shares: yarnShares(y, F) }] : []; });
    const origin = sampleOrigin(s, Y, F);
    const fibreNames = uses.flatMap(u => u.yarn.composition.map(c => F.get(c.fiber_id)?.fiber_name ?? ''));
    const words = [s.sample_id, s.sample_name, structure.id, structure.label, structure.family, origin, ...uses.flatMap(u => [u.yarn.yarn_id, u.yarn.yarn_name, u.type]), ...fibreNames].join(' ').toLowerCase().replace(/_/g, ' ');
    return { s, i, structure, family: structure.family, origin, yarns: uses, words };
  });
  return {
    demo, fibers: F, yarns: Y, recs, byId: new Map(recs.map(r => [r.s.sample_id, r])), structures,
    families: FAMILIES, properties: vocab('property') as Property[],
    colours: new Map(vocab('origin_colour').map(t => [t.id, String(t.srgb)])),
  };
}

function demoSet() {
  if (!SHOW_DEMO) return { fibers: [], yarns: [], samples: [] };
  const all = <T>(g: Record<string, T>) => Object.values(g);
  return {
    fibers: all(import.meta.glob<Fiber>('./data/demo/fibers/*.json', { eager: true, import: 'default' })),
    yarns: all(import.meta.glob<Yarn>('./data/demo/yarns/*.json', { eager: true, import: 'default' })),
    samples: all(import.meta.glob<Sample>('./data/demo/samples/*.json', { eager: true, import: 'default' })),
  };
}

export async function load(): Promise<DB> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('taxset') === 'test') {
    const r = await fetch(`${import.meta.env.BASE_URL}research/private_tests/taxonomy/set.json`).catch(() => null);
    if (r?.ok) { const t = await r.json(); return build(t.fibers, t.yarns, t.samples, true); }
    console.warn('[taxonomy] no private test set; run node scripts/taxonomy-demo.mjs');
  }
  const d = demoSet();
  return build(d.fibers, d.yarns, d.samples, SHOW_DEMO);
}

// ---------------------------------------------------------------- grouping (the shelf's sort switch)
export type SortKey = 'id' | 'structure' | 'origin';
const ORIGIN_ORDER: YarnType[] = ['natural', 'regenerated', 'synthetic', 'blend', 'unknown'];

/** The records in shelf order, cut into labelled groups (one group, no label, when sorting by ID). */
export function groups(db: DB, by: SortKey): { label: string; recs: Rec[] }[] {
  if (by === 'id') return [{ label: '', recs: db.recs }];
  const keyOf = (r: Rec) => (by === 'structure' ? r.family : r.origin);
  const order: string[] = by === 'structure' ? [...db.families, 'unknown'] : ORIGIN_ORDER;
  const sub = (r: Rec) => (by === 'structure' ? db.structures.indexOf(r.structure) : 0);
  return order.map(k => ({ label: by === 'structure' ? `${k} family` : k, recs: db.recs.filter(r => keyOf(r) === k).sort((a, b) => sub(a) - sub(b) || a.i - b.i) })).filter(g => g.recs.length);
}

// ---------------------------------------------------------------- formatting
export const pad = (n: number) => String(n).padStart(2, '0');
export function fmtValue(v: number, unit: string) {
  const n = Math.abs(v) >= 1000 ? v.toLocaleString('en-GB') : String(v);
  return unit === '%' ? `${n} %` : `${n} ${unit}`;
}
export const fibreLine = (db: DB, y: Yarn) => y.composition.map(c => `${db.fibers.get(c.fiber_id)?.fiber_name ?? 'unknown'} ${c.percentage_value}`).join(' · ');
