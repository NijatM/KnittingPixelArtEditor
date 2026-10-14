# KnittingPixelArtEditor — UI Design

The look is borrowed from **nijatmahamaliyev.com / HTMAA site / SubdivisionEngine_BDMH** (`nijatm.github.io/Subdivision-BDMH/css/app.css`): dark, monochrome, IBM Plex Mono, 1px lines, uppercase letter-spaced labels, dashed borders for anything empty or not yet available.

- Live mockup: `design/mockup.html` (open in a browser; clicks are faked but the layout and components are final).
- Screens: `design/screens/` (desktop styles, pixels + grid, light theme, phone).
- The real app should reuse the mockup's CSS almost verbatim.

## Identity copy

| Where | Text |
|---|---|
| Sidebar name | **Nijat Mahamaliyev** |
| Under the name (one sentence) | Photo portraits into knittable pixel art. |
| Lab line | Tailored Materiality Research |
| Terminal prompt (toolbar) | `root@nijat:~$ ./KnittingPixelArtEditor▌` (blinking block cursor) |
| Sidebar footer | `nijatmahamaliyev.com` only — no citation line |
| `<title>` | KnittingPixelArtEditor |
| Favicon | 16px: 2×2 checker of filled and outlined squares on #0b0b0b |

No course name and no week number anywhere.

## Tokens

| Token | Dark | Light |
|---|---|---|
| `--bg` | #0b0b0b | #f4f4f2 |
| `--bg2` | #141414 | #ebebe8 |
| `--bg3` | #1b1b1b | #e2e2df |
| `--line` | #232323 | #d6d6d2 |
| `--line2` | #3a3a3a | #b4b4b0 |
| `--fg` | #d2d2d2 | #2b2b2b |
| `--hi` | #f4f4f4 | #0b0b0b |
| `--dim` | #8a8a8a | #6e6e6c |
| `--faint` | #4a4a4a | #a6a6a2 |
| `--warn` | #d09a4e | #a8661a |
| `--ok` | #8fb58a | #3f7a3a |

Type: IBM Plex Mono 400/500/600 (self-host the TTFs in the app, as SubdivisionEngine does). Body 13px/1.45; labels 11px, letter-spacing .14em, uppercase; panel title 21px/500; name 15px/600. Border radius is always 0.

Portrait palette defaults: ink `#000000`, paper `#ffffff` — binary black and white (user-editable; exports use exactly these, 1-bit).

## Layout

```
┌ nav 268px ─┬──────────── stage ────────────┬ inspector 400px ┐
│ name       │ toolbar  (prompt · ? · theme) │ 03 · START      │
│ sentence   │          (view · tools · ink) │ Style           │
│ lab        ├───────────────────────────────┤ ------------    │
│            │                               │ note            │
│ SOURCE     │   styles view: gallery tiles  │ list / rows     │
│ 00 photo   │   pixels view: canvas editor  │ SUBHEAD ------  │
│ 01 frame   │                               │ label  [bar] v  │
│ 02 grid    │                               │                 │
│ START …    ├───────────────────────────────┤                 │
│ EDIT …     │ statusbar (undo redo live bake│                 │
│ MAKE …     │  status line · log line)      │                 │
│ ---------  │                               │                 │
│ footer     │                               │                 │
└────────────┴───────────────────────────────┴─────────────────┘
```

- `#app` grid `var(--nav) 1fr var(--insp)`, full viewport, body doesn't scroll.
- Toolbar and statusbar float over the stage with an 88% bg + 6px blur (as in SubdivisionEngine).
- ≤1100px: nav 220, inspector 360.
- ≤820px (phones): column flow — header + step chips (no right values, no section labels, no footer) → toolbar → view (64vh) → statusbar → inspector. Bars stop overlaying.

## Navigation = the steps

| # | Section | Step | Right value example | Stage view |
|---|---|---|---|---|
| 00 | SOURCE | photo | astronaut.png | pixels |
| 01 | SOURCE | frame | auto · 4:5 | pixels (crop overlay) |
| 02 | SOURCE | grid | 64×80 | pixels |
| 03 | START | style | line | **styles** (gallery) |
| 04 | START | regions | skin .60 | pixels |
| 05 | START | features | auto | pixels |
| 06 | START | background | white | pixels |
| 07 | EDIT | draw | 18 edits | pixels |
| 08 | EDIT | stamps | auto | pixels |
| 09 | EDIT | colours | two mini swatches | pixels |
| 10 | MAKE | export | png | pixels |

Selected row: `bg2` + `> ` prefix. Rows that aren't usable yet (no photo loaded) use `faint`.

## Components (all from the reference CSS)

- **lrow**: `num · label · right value`; used in nav and inspector lists.
- **subhead**: `LABEL ----------` (dashed rule fills the rest).
- **row**: 112px label / control / value.
- **bar** (slider): 22px, `bg2`, fill at 35% `dim`, 2px `hi` mark, value right-aligned tabular; drag anywhere, keyboard focusable.
- **seg**: joined buttons, the active one inverted (`hi` bg, `bg` text).
- **btn**: 1px `line2`; `.primary` = `hi` border + text (bake, export).
- **check**: text toggle `[x] label` / `[ ] label`.
- **stepper**: `‹ value ›`.
- **tile** (gallery): HTMAA week-tile: `STYLE B ··· 88 MS`, pixel thumbnail, title, one-line description; selected = `hi` border; not-available = dashed + faint (e.g. `STYLE G · V2 · U²-Net`).
- **empty / drop**: dashed `line2` box.
- **explain**: hidden help text with a left rule, shown when `?` is on.
- **okline / warn**: green/amber one-liners for detection results.

## Stage

- **styles view**: gallery grid `minmax(190px, 1fr)`, label `STYLES · RENDERED FROM YOUR PHOTO AT 64×80`. Clicking a tile picks the style and opens the pixels view.
- **pixels view**: crisp nearest-neighbour canvas, integer cell size that fits the stage, 1px `line2` outline offset 6px. Optional grid: thin lines every cell, stronger every 10.
- Toolbar line 2: `[styles|pixels]` · `[pencil|erase|fill|line|select]` · `[ink|paper]` · `[x] mirror` · `[ ] grid` · zoom `‹ fit ›`. With select on, `[ink|paper]` and mirror give way to `[flip ↔|flip ↕|mirror copy]`.
- Selection: 1px paper rectangle with ink dashes (visible on both colours), drawn over the cells; `move` cursor inside it.
- Statusbar: `‹ undo` `redo ›` `[x] live` **bake** / `base · line portrait · 64×80 · 5,120 cells · 36% ink · 18 edits · 88 ms` / `> log message   21:50:27`.

## Inspector panels (content per step)

- **00 Photo**: drop zone (dashed, thumbnail, "drop · paste · choose file"); DETECTED rows: face, regions, glasses; okline timing.
- **01 Frame**: RATIO seg 1:1 · 4:5 · 3:4 · 2:3 · free; CROP framing (tight↔wide), vertical; reset to auto.
- **02 Grid**: SIZE seg 32 · 50 · 64 · 96 · 128; width, height bars; `[x] lock to frame ratio`; CELL aspect w:h (1.00).
- **03 Style**: style list A–F (A clean avatar first, + faint G v2) with ms; letters follow the order; PARAMETERS threshold, line weight, cleanup (per style).
- **04 Regions**: SKIN density + even light; HAIR mode seg auto · solid · tone · texture + density + "measured" lightness (dark / medium / light); CLOTHES density.
- **05 Features**: checks redraw eyes (auto), brows, mouth, nostrils, jaw line, silhouette; GLASSES status.
- **06 Background**: seg white · black · pattern · photo; pattern density; `[x] outline the person`.
- **07 Draw**: tool seg (own line), colour, brush stepper, mirror axis; SELECTION size/position, left behind seg around · paper, flip ↔ · flip ↕ · mirror copy · deselect; EDITS summary, clear edits.
- **08 Stamps**: eyes / brows / mouth / nose / glasses steppers (`auto · traced`, `2/5 · dots`, … `off`), "all auto"; in this step a tap in the view cycles the feature under it (dashed hit boxes).
- **09 Colours**: ink and paper swatch + hex field; swap, reset.
- **10 Export**: FILE format seg PNG · BMP · SVG; when BMP, bit depth seg 1 · 4 · 8 · 24 (default: smallest depth that holds the palette; depths too small for it disabled); name field, **export png**; SESSION note + forget this project.

## Voice

Lowercase controls, short terminal-style log lines starting with `> `, units after values (`88 ms`, `64 st`), British "colours" as in the reference.
