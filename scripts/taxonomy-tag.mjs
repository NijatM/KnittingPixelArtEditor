// What goes on a sample's NFC tag (docs/TAG_FORMAT.md), built from the records by core.js, the same code the site
// uses. tools/nfc/taxonomy_reader.py calls this to write a tag ("write SMP_0001"). One JSON line per sample:
// {id, url, bytes, cut, tlv}; tlv is the hex of the NDEF TLV as it goes into the tag's data area from page 4.
//   node scripts/taxonomy-tag.mjs SMP_0001 [SMP_0002 …] [--base https://…/]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ndefMessage, tagPayload, tlv } from '../src/taxonomy/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/taxonomy/data');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const vocab = n => read(join(ROOT, 'src/taxonomy/vocab', `${n}.json`)).terms;

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const base = at >= 0 ? args.splice(at, 2)[1] : undefined;
if (!args.length || args.some(a => !/^SMP_\d{4}$/.test(a))) {
  console.error('usage: node scripts/taxonomy-tag.mjs SMP_0001 [SMP_0002 …] [--base https://…/]');
  process.exit(2);
}

// every record set under src/taxonomy/data (today only demo/), as the site bundles them
const fibers = new Map(), yarns = new Map(), samples = new Map();
for (const set of readdirSync(DATA)) {
  if (!existsSync(join(DATA, set, 'samples'))) continue;
  const each = (sub, f) => readdirSync(join(DATA, set, sub)).filter(n => n.endsWith('.json')).forEach(n => f(read(join(DATA, set, sub, n))));
  each('fibers', r => fibers.set(r.fiber_id, r));
  each('yarns', r => yarns.set(r.yarn_id, r));
  each('samples', r => samples.set(r.sample_id, r));
}
const statusKey = Object.fromEntries(vocab('value_status').map(t => [t.id, t.tag_key]));
const ctx = { fibers, yarns, properties: vocab('property'), machine: vocab('machine'), statusKey };

let bad = 0;
for (const id of args) {
  const s = samples.get(id);
  if (!s) { console.error(`${id}: no such sample in src/taxonomy/data`); bad++; continue; }
  const t = tagPayload(s, ctx, base);
  const hex = Buffer.from(tlv(ndefMessage(t.url, t.json))).toString('hex');
  console.log(JSON.stringify({ id, url: t.url, bytes: t.bytes, cut: t.cut, tlv: hex }));
}
process.exit(bad ? 1 : 0);
