// Checks the Knitting Taxonomy records: each against its schema (src/taxonomy/schema, the subset of JSON Schema those
// files use), then across records as material_bank v0.2 does (IDs match file names, composition sums to 99–101,
// no fibre twice, every fiber_id and yarn_id exists), then against our vocabularies (structure, roles, property ids,
// units, methods, statuses; a demo record has only generated values), and fits every sample's tag
// (docs/TAG_FORMAT.md). No dependencies. Runs before every build; exits 1 on any error.
//   node scripts/taxonomy-check.mjs        the public demo set, and the private test set when it is there
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tagPayload, TAG_DATA_BYTES } from '../src/taxonomy/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const schema = n => read(`src/taxonomy/schema/${n}.schema.json`);
const vocab = n => read(`src/taxonomy/vocab/${n}.json`).terms;
const SCHEMAS = { fiber: schema('fiber'), yarn: schema('yarn'), sample: schema('sample') };
const VOC = Object.fromEntries(['structure', 'yarn_role', 'property', 'method', 'machine', 'value_status', 'record_status', 'fiber_type', 'fiber_origin', 'property_group', 'origin_colour'].map(n => [n, vocab(n)]));
const ids = n => new Set(VOC[n].map(t => t.id));

// ---------------------------------------------------------------- the schema subset
const typeOk = (t, v) => t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
  : t === 'array' ? Array.isArray(v) : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === t;
function check(s, v, at, root, err) {
  if (s.$ref) s = s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
  if ('const' in s && v !== s.const) err(`${at}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) err(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(', ')}`);
  if (s.type && !typeOk(s.type, v)) return err(`${at}: must be ${s.type}`);
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) err(`${at}: too short`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) err(`${at}: "${v}" does not match ${s.pattern}`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) err(`${at}: below ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) err(`${at}: above ${s.maximum}`);
    if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) err(`${at}: must be above ${s.exclusiveMinimum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) err(`${at}: needs at least ${s.minItems}`);
    if (s.items) v.forEach((x, i) => check(s.items, x, `${at}[${i}]`, root, err));
  }
  if (typeOk('object', v)) {
    for (const k of s.required ?? []) if (!(k in v)) err(`${at}: ${k} is missing`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) check(s.properties[k], x, `${at}.${k}`, root, err);
      else if (s.additionalProperties === false) err(`${at}: ${k} is not allowed`);
      else if (typeof s.additionalProperties === 'object') check(s.additionalProperties, x, `${at}.${k}`, root, err);
    }
  }
}
const realDate = d => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;

// ---------------------------------------------------------------- one set
function checkSet(name, set, files) {
  const errors = [], err = (m) => errors.push(m);
  const fibers = new Map(), yarns = new Map();
  const each = (kind, list, key) => {
    const seen = new Set();
    for (const r of list) {
      const at = `${kind} ${r?.[key] ?? '?'}`;
      check(SCHEMAS[kind], r, at, SCHEMAS[kind], err);
      if (seen.has(r[key])) err(`${at}: ID used twice`);
      seen.add(r[key]);
      if (files && files.get(r) !== `${r[key]}.json`) err(`${at}: file name ${files.get(r)} does not match the ID`);
    }
  };
  each('fiber', set.fibers, 'fiber_id'); each('yarn', set.yarns, 'yarn_id'); each('sample', set.samples, 'sample_id');
  set.fibers.forEach(f => fibers.set(f.fiber_id, f));
  set.yarns.forEach(y => yarns.set(y.yarn_id, y));
  if (fibers.get('FBR_0000')?.fiber_origin !== 'unknown') err('fiber FBR_0000 must be the unknown fibre');

  for (const y of set.yarns) {
    const at = `yarn ${y.yarn_id}`, sum = y.composition.reduce((s, c) => s + c.percentage_value, 0);
    if (sum < 99 || sum > 101) err(`${at}: composition sums to ${sum}, not 99–101`);
    const fs = y.composition.map(c => c.fiber_id);
    if (new Set(fs).size !== fs.length) err(`${at}: a fibre appears twice`);
    for (const f of fs) if (!fibers.has(f)) err(`${at}: fibre ${f} does not exist`);
    if (!realDate(y.date_added)) err(`${at}: date_added ${y.date_added} is not a date`);
  }

  const STRUCT = ids('structure'), ROLE = ids('yarn_role'), METHOD = ids('method'), PROP = new Map(VOC.property.map(p => [p.id, p]));
  const MACH = new Map(VOC.machine.map(m => [m.id, m]));
  for (const s of set.samples) {
    const at = `sample ${s.sample_id}`, demo = s.status === 'demo';
    for (const k of ['sample_date', 'data_as_of']) if (!realDate(s[k])) err(`${at}: ${k} ${s[k]} is not a date`);
    if (s.data_as_of < s.sample_date) err(`${at}: data_as_of is before sample_date`);
    if (!STRUCT.has(s.structure)) err(`${at}: structure ${s.structure} is not in vocab/structure.json`);
    const ys = s.sample_yarn.map(x => x.yarn_id);
    if (new Set(ys).size !== ys.length) err(`${at}: a yarn appears twice`);
    for (const x of s.sample_yarn) {
      if (!yarns.has(x.yarn_id)) err(`${at}: yarn ${x.yarn_id} does not exist`);
      if (!ROLE.has(x.yarn_role)) err(`${at}: role ${x.yarn_role} is not in vocab/yarn_role.json`);
    }
    if (!s.sample_yarn.some(x => x.yarn_role === 'main')) err(`${at}: no main yarn`);
    for (const [k, v] of Object.entries(s.performance ?? {})) {
      const p = PROP.get(k);
      if (!p) { err(`${at}: property ${k} is not in vocab/property.json`); continue; }
      if (v.unit !== p.unit) err(`${at}: ${k} unit ${v.unit}, the vocabulary says ${p.unit}`);
      if (!METHOD.has(v.method)) err(`${at}: ${k} method ${v.method} is not in vocab/method.json`);
      if (demo && (v.status !== 'generated' || v.method !== 'generator')) err(`${at}: a demo record with a ${v.status} ${k}`);
      if (!demo && v.method === 'generator') err(`${at}: ${k} comes from the demo generator but the record is not a demo`);
    }
    if (s.machine) {
      for (const k of Object.keys(s.machine)) if (k !== 'status' && !MACH.has(k)) err(`${at}: machine.${k} is not in vocab/machine.json`);
      if (demo && s.machine.status !== 'generated') err(`${at}: a demo record with ${s.machine.status} machine settings`);
    }
  }

  // the tag: everything up to the composition must fit; report what the rest leaves off
  const statusKey = Object.fromEntries(VOC.value_status.map(t => [t.id, t.tag_key]));
  const ctx = { fibers, yarns, properties: VOC.property, machine: VOC.machine, statusKey };
  let max = 0, cutAny = 0;
  const cuts = {};
  for (const s of errors.length ? [] : set.samples) {
    const t = tagPayload(s, ctx);
    max = Math.max(max, t.bytes);
    if (t.cut.length) { cutAny++; t.cut.forEach(c => (cuts[c] = (cuts[c] ?? 0) + 1)); }
    if (t.cut.some(c => ['record', 'structure', 'yarns', 'composition'].includes(c))) err(`sample ${s.sample_id}: the tag cannot hold its record, structure, yarns and composition`);
  }
  console.log(`${name}: ${set.fibers.length} fibres, ${set.yarns.length} yarns, ${set.samples.length} samples · ${errors.length ? `${errors.length} errors` : 'ok'}` +
    (errors.length ? '' : ` · tags up to ${max} of ${TAG_DATA_BYTES} B${cutAny ? `, ${cutAny} cut (${Object.entries(cuts).map(([k, n]) => `${k} ${n}`).join(', ')})` : ', none cut'}`));
  errors.slice(0, 40).forEach(e => console.log(`  ${e}`));
  if (errors.length > 40) console.log(`  … ${errors.length - 40} more`);
  return errors.length;
}

// ---------------------------------------------------------------- the vocabularies themselves, and the tag format doc
function checkVocab() {
  const errors = [];
  for (const [n, terms] of Object.entries(VOC)) {
    const seen = new Set();
    for (const t of terms) { if (seen.has(t.id)) errors.push(`vocab ${n}: ${t.id} twice`); seen.add(t.id); }
  }
  const GROUP = ids('property_group'), METHOD = ids('method');
  for (const p of VOC.property) {
    if (!GROUP.has(p.group)) errors.push(`vocab property ${p.id}: group ${p.group} unknown`);
    for (const m of p.methods) if (!METHOD.has(m)) errors.push(`vocab property ${p.id}: method ${m} unknown`);
  }
  const keys = [...VOC.property, ...VOC.machine].map(t => t.tag_key);
  if (new Set(keys).size !== keys.length) errors.push('vocab: a tag_key is used twice');
  const doc = readFileSync(join(ROOT, 'docs/TAG_FORMAT.md'), 'utf8');
  for (const t of [...VOC.property, ...VOC.machine, ...VOC.value_status]) if (!doc.includes(`| \`${t.tag_key}\` | ${t.id} |`)) errors.push(`docs/TAG_FORMAT.md: no row for ${t.tag_key} (${t.id})`);
  const ORIG = ids('fiber_origin');
  for (const c of VOC.origin_colour) if (!ORIG.has(c.id)) errors.push(`vocab origin_colour: ${c.id} is not an origin`);
  console.log(`vocabularies: ${Object.keys(VOC).length} · ${errors.length ? `${errors.length} errors` : 'ok'}`);
  errors.forEach(e => console.log(`  ${e}`));
  return errors.length;
}

function loadDir(dir) {
  const files = new Map(), list = sub => readdirSync(join(ROOT, dir, sub)).filter(f => f.endsWith('.json')).sort().map(f => {
    const r = JSON.parse(readFileSync(join(ROOT, dir, sub, f), 'utf8'));
    files.set(r, f);
    return r;
  });
  return { set: { fibers: list('fibers'), yarns: list('yarns'), samples: list('samples') }, files };
}

let bad = checkVocab();
const demo = 'src/taxonomy/data/demo';
if (existsSync(join(ROOT, demo))) { const { set, files } = loadDir(demo); bad += checkSet('demo set', set, files); }
const test = 'research/private_tests/taxonomy/set.json';
if (existsSync(join(ROOT, test))) bad += checkSet('private test set', read(test), null);
process.exit(bad ? 1 : 0);
