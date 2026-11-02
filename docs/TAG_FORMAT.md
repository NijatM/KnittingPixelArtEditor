# Knitting Taxonomy: NFC tag format, version 1

Each framed sample carries an NTAG216 tag (NFC Forum Type 2). The tag holds one NDEF message with two records:

1. **URI record** (well-known type `U`) with the sample's address, for example
   `https://nijatm.github.io/KnittingPixelArtEditor/#taxonomy/SMP_0001`. It comes first, so a phone opens the
   address when it touches the tag.
2. **MIME record** `application/json`: the sample's main facts in compact JSON with short keys, so a reader with no
   network still gets them. Units and methods are not written; they are fixed by this document.

Space: the data area is 872 bytes (capability container byte 2 = `0x6D`, × 8). The NDEF TLV takes 5 of them, which
leaves 867 bytes for the message. The URI record alone takes 63. The 300 demo samples need 348 to 724 bytes in all
(median 544), so none is cut; `scripts/taxonomy-check.mjs` checks this before every build.

## Fill order

Parts are written in this order. The writer stops at the first part that does not fit; the address always leads to
the full record.

1. record: `v`, `id`, `n`, `d`, `a`, `s`
2. structure: `st`
3. yarns and their derived yarn_type: `y`
4. composition: `c`
5. performance values, one by one: areal density, thickness, then the order of the table below: `p`
6. machine settings: `m`

`src/taxonomy/core.js` (`tagPayload`) builds the record in this order; the site and the scripts use it.

## Keys

| key | field | value |
|---|---|---|
| `v` | format version | `1`. Changes only when a key changes meaning; new keys may be added without it. Readers ignore keys they do not know. |
| `id` | sample_id | `SMP_` and four digits |
| `n` | sample_name | text |
| `d` | sample_date | `YYYY-MM-DD`, the day it was knitted |
| `a` | data_as_of | `YYYY-MM-DD`, the day the record last changed. If the site's record is newer, the tag is out of date. |
| `s` | status | `demo`, `draft`, `reviewed` or `final` (`src/taxonomy/vocab/record_status.json`) |
| `st` | structure | an id from `src/taxonomy/vocab/structure.json` |
| `y` | yarns | `[[yarn_id, yarn_role, yarn_type], …]`. yarn_role from `vocab/yarn_role.json`; yarn_type derived as in material_bank ADR-0004: `natural`, `regenerated`, `synthetic`, `blend` or `unknown` |
| `c` | composition | one list per yarn, in the order of `y`: `[[fibre name, percent], …]` |
| `p` | performance | `{key: [value, status]}`, keys and units below |
| `m` | machine settings | `{key: value, …, "s": status}`, keys and units below |

### Performance (`p`)

| key | property | unit |
|---|---|---|
| `op` | opacity | % |
| `ad` | areal_density | g/m² |
| `th` | thickness | mm |
| `wd` | wale_density | wales/cm |
| `cd` | course_density | courses/cm |
| `sc` | stretch_course | % at the fixed load |
| `sw` | stretch_wale | % at the fixed load |
| `rc` | recovery_course | % |
| `rw` | recovery_wale | % |
| `bs` | bursting_strength | kPa |
| `tc` | tensile_course | N (50 mm strip) |
| `tw` | tensile_wale | N (50 mm strip) |
| `ap` | air_permeability | mm/s |
| `bc` | bending_course | cm (bending length) |
| `bw` | bending_wale | cm (bending length) |
| `ab` | abrasion | cycles |

Definitions and candidate methods: `src/taxonomy/vocab/property.json` and `method.json`.

### Status of a value

| key | status | meaning |
|---|---|---|
| `m` | measured | measured on this sample (machine settings: recorded at the machine) |
| `e` | estimated | worked out from other values or a model |
| `g` | generated | made up for the demo |

### Machine settings (`m`)

| key | setting | unit |
|---|---|---|
| `mt` | machine_type | text |
| `g` | gauge | E (needles per inch) |
| `ll` | loop_length | mm |
| `cs` | carriage_speed | m/s |
| `nw` | needles | needles in work |
| `nc` | courses | courses |
| `pg` | program | text (file name) |

## Example

A demo sample (every value generated), 642 of 872 bytes with the address:

```json
{"v":1,"id":"SMP_0007","n":"2×2 rib 1","d":"2025-09-09","a":"2026-11-02","s":"demo","st":"rib_2x2",
 "y":[["YRN_0057","main","natural"],["YRN_0044","contrast","unknown"]],
 "c":[[["cashmere",100]],[["merino",80],["unknown",20]]],
 "p":{"ad":[342,"g"],"th":[1.42,"g"],"op":[88.8,"g"],"wd":[13.7,"g"],"cd":[9.4,"g"],"sc":[190,"g"],"sw":[56,"g"],
      "rc":[83,"g"],"rw":[89.1,"g"],"bs":[516,"g"],"tc":[137,"g"],"tw":[266,"g"],"ap":[2310,"g"],"bc":[1.47,"g"],
      "bw":[1.76,"g"],"ab":[9000,"g"]},
 "m":{"s":"g","mt":"v-bed flat","g":10,"ll":5.31,"cs":1,"nw":110,"nc":240}}
```

(Line breaks added here; the tag holds it on one line.)

## Protection

None yet. Once real samples are tagged, writing will need a password (NTAG `PWD_AUTH`, the key kept outside the
repository), and a finished sample's tag may be locked for good.

The field names follow the material_bank v0.2 conventions (Tailored Materiality Group); the short keys are ours.
