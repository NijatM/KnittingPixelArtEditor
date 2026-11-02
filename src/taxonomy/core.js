// Rules shared by the site and the node scripts (scripts/taxonomy-demo.mjs, scripts/taxonomy-check.mjs): a yarn's
// derived type (material_bank ADR-0004), its origin shares for the colour bands, and the NFC tag's contents
// (docs/TAG_FORMAT.md). Plain JS so node runs it as it is; types in core.d.ts.

export const ORIGINS = ['natural', 'regenerated', 'synthetic', 'unknown'];

const originOf = (fibers, id) => fibers.get(id)?.fiber_origin ?? 'unknown';

/** ADR-0004 over a list of fibre origins: unknown if any is unknown, the origin if there is one, blend otherwise. */
export function typeOf(origins) {
  if (!origins.length || origins.includes('unknown')) return 'unknown';
  return new Set(origins).size === 1 ? origins[0] : 'blend';
}

export const yarnType = (yarn, fibers) => typeOf(yarn.composition.map(c => originOf(fibers, c.fiber_id)));

/** The whole sample by the same rule, over every fibre of every yarn. A missing yarn counts as unknown. */
export const sampleOrigin = (sample, yarns, fibers) =>
  typeOf(sample.sample_yarn.flatMap(sy => yarns.get(sy.yarn_id)?.composition.map(c => originOf(fibers, c.fiber_id)) ?? ['unknown']));

/** A yarn's percentages summed by origin, in ORIGINS order; a blend's band is split by these. */
export function yarnShares(yarn, fibers) {
  const by = new Map();
  for (const c of yarn.composition) { const o = originOf(fibers, c.fiber_id); by.set(o, (by.get(o) ?? 0) + c.percentage_value); }
  return ORIGINS.filter(o => by.has(o)).map(o => ({ origin: o, pct: by.get(o) }));
}

// ---------------------------------------------------------------- the tag
export const TAG_BASE = 'https://nijatm.github.io/KnittingPixelArtEditor/';
/** NTAG216 data area: the capability container says 0x6D × 8 bytes. */
export const TAG_DATA_BYTES = 872;
export const sampleUrl = (id, base = TAG_BASE) => `${base}#taxonomy/${id}`;

const enc = new TextEncoder();
const utf8 = s => enc.encode(s).length;
const URI_PREFIXES = ['https://www.', 'http://www.', 'https://', 'http://'];

/** Bytes of the NDEF message: a URI record (prefix abbreviated) and, when given, one application/json record. */
export function ndefBytes(url, json) {
  const pre = URI_PREFIXES.find(p => url.startsWith(p));
  const uri = 1 + utf8(pre ? url.slice(pre.length) : url);
  let n = 4 + uri + (uri > 255 ? 3 : 0);
  if (json != null) { const b = utf8(json); n += 3 + utf8('application/json') + b + (b > 255 ? 3 : 0); }
  return n;
}
/** The message inside its TLV (type, 1 or 3 length bytes, message, terminator), as it sits in the data area. */
export const tlvBytes = m => 1 + (m < 255 ? 1 : 3) + m + 1;

/** The tag's JSON record, filled part by part in the order of docs/TAG_FORMAT.md; stops at the first part that
 *  would not fit. `cut` names what was left off (the URL still leads to the full record). */
export function tagPayload(sample, t, base = TAG_BASE) {
  const url = sampleUrl(sample.sample_id, base);
  const yarns = sample.sample_yarn.map(sy => ({ sy, y: t.yarns.get(sy.yarn_id) }));
  const first = ['areal_density', 'thickness'];
  const props = [...first.map(id => t.properties.find(p => p.id === id)), ...t.properties.filter(p => !first.includes(p.id))].filter(Boolean);
  const parts = [
    ['record', o => Object.assign(o, { id: sample.sample_id, n: sample.sample_name, d: sample.sample_date, a: sample.data_as_of, s: sample.status })],
    ['structure', o => { o.st = sample.structure; }],
    ['yarns', o => { o.y = yarns.map(({ sy, y }) => [sy.yarn_id, sy.yarn_role, y ? yarnType(y, t.fibers) : 'unknown']); }],
    ['composition', o => { o.c = yarns.map(({ y }) => (y?.composition ?? []).map(c => [t.fibers.get(c.fiber_id)?.fiber_name ?? 'unknown', c.percentage_value])); }],
    ...props.filter(p => sample.performance?.[p.id]).map(p => [p.id, o => {
      const v = sample.performance[p.id];
      (o.p ??= {})[p.tag_key] = [v.value, t.statusKey[v.status]];
    }]),
    ...(sample.machine ? [['machine', o => {
      const m = { s: t.statusKey[sample.machine.status] };
      for (const f of t.machine) if (sample.machine[f.id] != null) m[f.tag_key] = sample.machine[f.id];
      o.m = m;
    }]] : []),
  ];
  let out = { v: 1 }, json = JSON.stringify(out), i = 0;
  for (; i < parts.length; i++) {
    const trial = structuredClone(out);
    parts[i][1](trial);
    const s = JSON.stringify(trial);
    if (tlvBytes(ndefBytes(url, s)) > TAG_DATA_BYTES) break;
    out = trial; json = s;
  }
  return { url, json, bytes: tlvBytes(ndefBytes(url, json)), cut: parts.slice(i).map(p => p[0]) };
}
