// Generates the Knitting Taxonomy demo set: fibres, yarns and samples, one JSON file per record (material_bank
// ADR-0001). Every sample has status "demo" and every value status "generated", method "generator": nothing here was
// measured. Fibre names are real generic fibres; yarn names are neutral ("demo yarn 012").
// The values follow simple rules so they hang together (loop length from the gauge, wales and courses from the
// loop length after Munden's dry-relaxed constants, mass from loops × loop length × yarn count, the rest from mass,
// thickness and fibre mix) plus noise. They are not predictions for any real fabric.
// Deterministic: the same seed writes the same files.
//   node scripts/taxonomy-demo.mjs   → src/taxonomy/data/demo/ (300 samples, public)
//                                      research/private_tests/taxonomy/set.json (1000 samples, git-ignored)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vocab = n => JSON.parse(readFileSync(join(ROOT, 'src/taxonomy/vocab', `${n}.json`), 'utf8')).terms;
const STRUCTURES = vocab('structure'), PROPS = vocab('property');
const DATA_AS_OF = '2026-11-02', V = '0.2.0';

function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const id = (p, n) => `${p}_${String(n).padStart(4, '0')}`;
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const shuffle = (R, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const day = (start, add) => new Date(Date.parse(start) + add * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- fibres: real generic fibres (FBR_0000 = unknown)
const FIBERS = [
  ['unknown', 'unknown', 'unknown'], ['cotton', 'cellulose', 'natural'], ['linen', 'cellulose', 'natural'],
  ['hemp', 'cellulose', 'natural'], ['wool', 'protein', 'natural'], ['merino', 'protein', 'natural'],
  ['alpaca', 'protein', 'natural'], ['mohair', 'protein', 'natural'], ['cashmere', 'protein', 'natural'],
  ['silk', 'protein', 'natural'], ['viscose', 'cellulose', 'regenerated'], ['lyocell', 'cellulose', 'regenerated'],
  ['modal', 'cellulose', 'regenerated'], ['cupro', 'cellulose', 'regenerated'], ['polyamide 6', 'polyamide', 'synthetic'],
  ['polyamide 66', 'polyamide', 'synthetic'], ['polyester', 'polyester', 'synthetic'], ['recycled polyester', 'polyester', 'synthetic'],
  ['acrylic', 'polyacrylonitrile', 'synthetic'], ['polypropylene', 'polyolefin', 'synthetic'], ['elastane', 'elastane', 'synthetic'],
].map(([fiber_name, fiber_type, fiber_origin], i) => ({ schema_version: V, fiber_id: id('FBR', i), fiber_name, fiber_type, fiber_origin }));
const FB = new Map(FIBERS.map(f => [f.fiber_name, f]));

// ---------------------------------------------------------------- yarn recipes: [weight, [fibre, %]...]
const RECIPES = [
  [6, ['cotton', 100]], [2, ['linen', 100]], [1, ['hemp', 100]], [4, ['wool', 100]], [6, ['merino', 100]],
  [2, ['alpaca', 100]], [1, ['cashmere', 100]], [1, ['silk', 100]], [1, ['mohair', 100]], [3, ['viscose', 100]],
  [3, ['lyocell', 100]], [2, ['modal', 100]], [1, ['cupro', 100]], [3, ['polyamide 6', 100]], [1, ['polyamide 66', 100]],
  [3, ['polyester', 100]], [2, ['recycled polyester', 100]], [2, ['acrylic', 100]], [1, ['polypropylene', 100]],
  [2, ['elastane', 100]],
  [4, ['cotton', 95], ['elastane', 5]], [2, ['cotton', 92], ['elastane', 8]], [4, ['merino', 80], ['polyamide 6', 20]],
  [2, ['merino', 70], ['polyamide 6', 30]], [2, ['wool', 70], ['polyamide 6', 30]], [2, ['viscose', 95], ['elastane', 5]],
  [2, ['cotton', 55], ['linen', 45]], [2, ['cotton', 60], ['polyester', 40]], [1, ['cotton', 50], ['polyester', 50]],
  [1, ['mohair', 72], ['silk', 28]], [2, ['alpaca', 50], ['merino', 50]], [2, ['lyocell', 50], ['cotton', 50]],
  [1, ['acrylic', 70], ['wool', 30]], [3, ['polyamide 6', 85], ['elastane', 15]], [2, ['polyamide 6', 80], ['elastane', 20]],
  [1, ['modal', 50], ['cotton', 50]], [1, ['cashmere', 30], ['merino', 70]], [1, ['viscose', 80], ['polyamide 6', 20]],
  [1, ['hemp', 55], ['cotton', 45]], [1, ['merino', 70], ['silk', 30]], [1, ['cotton', 48], ['modal', 47], ['elastane', 5]],
  [1, ['wool', 50], ['viscose', 30], ['polyamide 66', 20]],
  [1, ['unknown', 100]], [1, ['merino', 80], ['unknown', 20]], [1, ['cotton', 60], ['unknown', 40]],
];
const share = (yarn, names) => yarn.composition.reduce((s, c) => s + (names.includes(FIBERS[+c.fiber_id.slice(4)].fiber_name) ? c.percentage_value : 0), 0) / 100;

function makeYarns(R, n) {
  const total = RECIPES.reduce((s, r) => s + r[0], 0), pick = () => { let x = R() * total; for (const r of RECIPES) if ((x -= r[0]) < 0) return r; return RECIPES[0]; };
  let d = 0;
  return Array.from({ length: n }, (_, i) => {
    const r = i < RECIPES.length ? RECIPES[i] : pick();
    d += Math.floor(R() * 4);
    return { schema_version: V, yarn_id: id('YRN', i + 1), yarn_name: `demo yarn ${String(i + 1).padStart(3, '0')}`, date_added: day('2025-06-02', d),
      composition: r.slice(1).map(([name, pct]) => ({ fiber_id: FB.get(name).fiber_id, percentage_value: pct })) };
  });
}

// ---------------------------------------------------------------- structures: how often, and their rules
// kw, kc: wales and courses per cm × loop length (cm), relative to Munden's dry-relaxed plain jersey (kw 3.9, kc 5.0);
// mass: extra yarn (tucks, floats, backing); T: thickness in yarn diameters; sc, sw: stretch at the fixed load (%);
// op: how closed the face is; E: weights of gauges 5, 7, 10, 12, 14.
const RULES = {
  single_jersey: { n: 40, kw: 1, kc: 1, mass: 1, T: 3.2, sc: 60, sw: 45, op: 1, E: [1, 4, 4, 3, 1] },
  plated_jersey: { n: 15, kw: 1, kc: 1, mass: 1.35, T: 3.6, sc: 55, sw: 40, op: 1.1, E: [0, 3, 4, 3, 1] },
  tuck_jersey: { n: 20, kw: 0.85, kc: 1.25, mass: 1.15, T: 3.9, sc: 45, sw: 40, op: 1.05, E: [1, 4, 4, 2, 0] },
  float_jersey: { n: 15, kw: 1.15, kc: 1, mass: 1.1, T: 3.4, sc: 30, sw: 45, op: 1.05, E: [0, 3, 4, 3, 1] },
  eyelet_jersey: { n: 15, kw: 0.95, kc: 1, mass: 0.9, T: 3.2, sc: 65, sw: 50, op: 0.7, E: [1, 4, 3, 2, 0] },
  rib_1x1: { n: 30, kw: 1.7, kc: 1, mass: 1, T: 5.5, sc: 140, sw: 50, op: 1.05, E: [1, 4, 4, 3, 1] },
  rib_2x2: { n: 25, kw: 1.9, kc: 1, mass: 1, T: 6, sc: 160, sw: 50, op: 1, E: [1, 4, 4, 2, 1] },
  half_cardigan: { n: 20, kw: 1.4, kc: 1.2, mass: 1.25, T: 7, sc: 100, sw: 45, op: 1.05, E: [3, 4, 2, 1, 0] },
  full_cardigan: { n: 20, kw: 1.3, kc: 1.3, mass: 1.3, T: 7.8, sc: 90, sw: 40, op: 1.05, E: [3, 4, 2, 1, 0] },
  milano_rib: { n: 15, kw: 1.5, kc: 1.25, mass: 1, T: 5.6, sc: 70, sw: 35, op: 1.1, E: [0, 2, 4, 3, 2] },
  purl_1x1: { n: 20, kw: 1, kc: 1.6, mass: 1, T: 6.5, sc: 50, sw: 110, op: 1, E: [2, 4, 3, 1, 0] },
  interlock: { n: 25, kw: 1.6, kc: 1.05, mass: 1, T: 5, sc: 55, sw: 40, op: 1.15, E: [0, 1, 3, 4, 3] },
  punto_di_roma: { n: 15, kw: 1.55, kc: 1.3, mass: 1, T: 5.5, sc: 45, sw: 30, op: 1.15, E: [0, 1, 3, 4, 2] },
  double_jacquard: { n: 25, kw: 1.5, kc: 1.3, mass: 1.3, T: 6, sc: 40, sw: 30, op: 1.2, E: [0, 2, 4, 4, 2] },
};
const GAUGES = [5, 7, 10, 12, 14];
const FAMILY = Object.fromEntries(STRUCTURES.map(s => [s.id, s.family]));
if (STRUCTURES.some(s => !RULES[s.id])) throw new Error('a structure in vocab/structure.json has no generator rule');
const SYNTH = ['polyamide 6', 'polyamide 66', 'polyester', 'recycled polyester', 'acrylic', 'polypropylene'];
const PROTEIN = ['wool', 'merino', 'alpaca', 'mohair', 'cashmere', 'silk'];
const ROLE_W = { main: 1, plating: 0.6, contrast: 0.5, inlay: 0.12 };
const dp = n => v => round(v, n);
const ROUND = {
  opacity: dp(1), areal_density: dp(0), thickness: dp(2), wale_density: dp(1), course_density: dp(1), stretch_course: dp(0),
  stretch_wale: dp(0), recovery_course: dp(1), recovery_wale: dp(1), bursting_strength: dp(0), tensile_course: dp(0),
  tensile_wale: dp(0), air_permeability: v => Math.round(v / 10) * 10, bending_course: dp(2), bending_wale: dp(2),
  abrasion: v => Math.round(clamp(v, 3000, 60000) / 500) * 500,
};
if (PROPS.some(p => !ROUND[p.id])) throw new Error('a property in vocab/property.json has no generator rule');

function makeSamples(R, n, yarns) {
  const N = (a, b) => a + (b - a) * R(), noise = s => 1 + s * (R() + R() + R() - 1.5) / 1.5;
  const weighted = (list, w) => { const t = w.reduce((a, b) => a + b, 0); let x = R() * t; for (let i = 0; i < list.length; i++) if ((x -= w[i]) < 0) return list[i]; return list[list.length - 1]; };
  // some yarns are favourites: popularity falls off with a shuffled rank, so lineage shows yarns shared by many samples
  const rank = shuffle(R, yarns.map((_, i) => i)), pop = new Map(yarns.map((y, i) => [y, 1 / (rank[i] + 1) ** 0.6]));
  const pickYarn = (ok, not = []) => { const c = yarns.filter(y => ok(y) && !not.includes(y)); return weighted(c, c.map(y => pop.get(y))); };
  const elastic = y => share(y, ['elastane']) > 0, plainElastane = y => share(y, ['elastane']) === 1;
  // structures in the vocabulary's mix, then shuffled into a believable knitting order
  const ids = Object.keys(RULES), mix = ids.map(s => RULES[s].n), total = mix.reduce((a, b) => a + b, 0);
  const order = n === total ? shuffle(R, ids.flatMap(s => Array(RULES[s].n).fill(s))) : Array.from({ length: n }, () => weighted(ids, mix));
  const count = {}, label = Object.fromEntries(STRUCTURES.map(s => [s.id, s.label]));
  const span = (Date.parse(DATA_AS_OF) - Date.parse('2025-09-01')) / 864e5 - 14;     // knitting dates, in ID order
  return order.map((st, i) => {
    const r = RULES[st], fam = FAMILY[st];
    const main = pickYarn(y => !plainElastane(y)), sy = [{ yarn_id: main.yarn_id, yarn_role: 'main' }], used = [main];
    const add = (role, ok) => { const y = pickYarn(ok, used); used.push(y); sy.push({ yarn_id: y.yarn_id, yarn_role: role }); };
    if (st === 'plated_jersey') add('plating', y => !plainElastane(y) && share(y, SYNTH.concat('elastane')) > 0.5);
    if (st === 'double_jacquard') { add('contrast', y => !plainElastane(y)); if (R() < 0.25) add('contrast', y => !plainElastane(y)); }
    else if (R() < 0.1) add('contrast', y => !plainElastane(y));
    if ((fam === 'plain' || fam === 'rib') && R() < 0.12) add('inlay', elastic);
    // the fibre mix, each yarn weighted by how much of the fabric its role makes up
    const wsum = sy.reduce((s, x) => s + ROLE_W[x.yarn_role], 0);
    const mixOf = names => sy.reduce((s, x, k) => s + ROLE_W[x.yarn_role] * share(used[k], names), 0) / wsum;
    const elast = mixOf(['elastane']), synth = mixOf(SYNTH), protein = mixOf(PROTEIN), stiff = mixOf(['linen', 'hemp']);

    const E = weighted(GAUGES, r.E), pitch = 25.4 / E;
    const ll = pitch * N(1.75, 2.15) * (fam === 'rib' && r.mass > 1 ? 1.08 : 1);       // loop length, mm
    const tex = (560 / E) * N(0.8, 1.25);                                               // hidden yarn count, g/km
    const wd = (r.kw * 3.9 * noise(0.06)) / (ll / 10) * (1 + elast * 1.5);             // elastane pulls the fabric in
    const cd = (r.kc * 5.0 * noise(0.06)) / (ll / 10) * (1 + elast * 0.8);
    const ad = wd * cd * 1e4 * (ll / 1000) * (tex / 1000) * r.mass * (sy.some(x => x.yarn_role === 'inlay') ? 1.08 : 1) * noise(0.05);
    const th = 0.04 * Math.sqrt(tex / 1.3) * r.T * noise(0.08);
    const K = Math.sqrt(tex) / ll;                                                      // tightness factor
    const looser = clamp(1.45 - K, -0.5, 0.6);
    const vals = {
      opacity: clamp(100 - 100 * Math.exp(-K * r.op * 1.6) + 3 * (R() - 0.5), 35, 99.5),
      areal_density: ad, thickness: th, wale_density: wd, course_density: cd,
      stretch_course: clamp(r.sc * (1 + looser) * noise(0.15) * (1 + elast), 8, 260),
      stretch_wale: clamp(r.sw * (1 + looser) * noise(0.15) * (1 + elast * 0.6), 8, 220),
      recovery_course: clamp(76 + 8 * R() + 70 * elast + 6 * protein - 4 * stiff, 55, 99.5),
      recovery_wale: clamp(78 + 8 * R() + 60 * elast + 5 * protein - 4 * stiff, 55, 99.5),
      bursting_strength: ad * N(1.2, 1.8) * (1 + 0.4 * synth),
      tensile_course: ad * N(0.4, 0.7) * (fam === 'rib' ? 0.8 : 1) * (1 + 0.5 * synth),
      tensile_wale: ad * N(0.55, 0.9) * (1 + 0.5 * synth),
      air_permeability: 4200 * Math.exp(-K * th * 0.35) * (r.op < 1 ? 1.5 : 1) * noise(0.12),
      bending_course: N(1.2, 1.6) * Math.sqrt(th) * (1 + 0.3 * stiff),
      bending_wale: N(1.3, 1.8) * Math.sqrt(th) * (1 + 0.3 * stiff),
      abrasion: 6000 + 28000 * synth + 20 * ad - 4000 * protein,
    };
    // how complete: a third have everything, most have some gaps, a few only the basics
    const kind = R(), keep = { optical: 0.7, mass_geometry: 0.95, mechanical: 0.75, comfort: 0.5 };
    const performance = {};
    for (const p of PROPS) {
      const on = kind < 0.3 ? true : kind < 0.85 ? R() < keep[p.group] : (p.id === 'areal_density' ? R() < 0.9 : p.id === 'thickness' ? R() < 0.6 : p.group === 'mass_geometry' && R() < 0.4);
      if (!on) continue;
      performance[p.id] = { value: ROUND[p.id](vals[p.id]), unit: p.unit, method: 'generator', status: 'generated' };
    }
    count[st] = (count[st] ?? 0) + 1;
    const rec = { schema_version: V, sample_id: id('SMP', i + 1), sample_name: `${label[st]} ${count[st]}`, sample_date: day('2025-09-01', Math.floor(((i + R()) * span) / n)), data_as_of: DATA_AS_OF, status: 'demo', sample_yarn: sy, structure: st };
    if (R() < 0.9) rec.machine = { status: 'generated', machine_type: 'v-bed flat', gauge: E, loop_length: round(ll, 2), carriage_speed: round(N(0.4, 1.0), 1), needles: 2 * Math.round(N(30, 100)), courses: 10 * Math.round(N(8, 30)) };
    rec.performance = performance;
    return rec;
  });
}

// ---------------------------------------------------------------- write
const write = (file, rec) => writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
const manifest = (seed, n, yarns) => ({
  demo: true, generated_by: 'scripts/taxonomy-demo.mjs', seed, data_as_of: DATA_AS_OF,
  counts: { fibers: FIBERS.length, yarns: yarns.length, samples: n },
  note: 'Every sample here is generated (status demo) and every value is made up (status generated, method generator). Fibre names are real generic fibres; yarn names are neutral placeholders.',
});

function set(seed, n, nYarns) {
  const R = rng(seed), yarns = makeYarns(R, nYarns);
  return { manifest: manifest(seed, n, yarns), fibers: FIBERS, yarns, samples: makeSamples(R, n, yarns) };
}

const pub = set(20261102, 300, 120), dir = join(ROOT, 'src/taxonomy/data/demo');
rmSync(dir, { recursive: true, force: true });
for (const [sub, list, key] of [['fibers', pub.fibers, 'fiber_id'], ['yarns', pub.yarns, 'yarn_id'], ['samples', pub.samples, 'sample_id']]) {
  mkdirSync(join(dir, sub), { recursive: true });
  for (const r of list) write(join(dir, sub, `${r[key]}.json`), r);
}
write(join(dir, 'manifest.json'), pub.manifest);

const test = set(1000, 1000, 250), tdir = join(ROOT, 'research/private_tests/taxonomy');
mkdirSync(tdir, { recursive: true });
writeFileSync(join(tdir, 'set.json'), JSON.stringify(test));
console.log(`demo: ${pub.samples.length} samples, ${pub.yarns.length} yarns, ${pub.fibers.length} fibres → src/taxonomy/data/demo`);
console.log(`test: ${test.samples.length} samples, ${test.yarns.length} yarns → research/private_tests/taxonomy/set.json (private)`);
