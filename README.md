# KnittingPixelArtEditor

Two tools for machine knitting, chosen on the first page:

- **Knitting Pixel Portrait** (`#portrait`): turn a portrait into two-colour pixel art for knitting. One cell is one stitch.
- **Knit Grammar** (`#grammar`): learn how a V-bed flat knitting machine works, and write knit programs as bitmaps:
  one pixel is one needle, one row is one carriage pass, each colour is an operation.

It is free and runs entirely in the browser. Your photos and patterns never leave your device: face detection
(MediaPipe) and all image processing happen locally.

Nijat Mahamaliyev · Tailored Materiality Research

## Knitting Pixel Portrait

- **Start from a photo**: drop, paste or choose one. The face is found, framed and turned into every style at once.
- **Start without a photo**: pick one of the team's 40 characters.
- **Open pixel art**: PNG or BMP files open as editable cells, at their own size or enlarged.
- **Change the parts**: hair, eyes, brows, nose, mouth, glasses and facial hair, each with a preview of every option.
- **Edit by hand**: pencil, erase, fill, line, select (move, flip, mirror copy), mirror drawing, undo, bake.
- **Export**: PNG (1-bit), BMP (1/4/8/24-bit) or SVG. The file holds exactly what the editor shows: one pixel
  per stitch, no margin.
- **Autosave**: the last project is kept in the browser, and 11 reset starts over.
- **Send to Knit Grammar**: the finished portrait becomes a knit pattern; you choose what ink and paper do.

## Knit Grammar

- **Learn**: the V-bed machine, the latch needle's knitting cycle, the operations (knit, tuck, float, transfer,
  racking), reading the grammar, two yarn guides, structures and shaping. Interactive line figures and small 3D
  yarn swatches; every page lists its sources. Pages are drafts until reviewed.
- **Editor**: paint operations, not colours. Tools: needle, run, flood, pass, wale, motif (select, move, flip,
  repeat with a shift), pick, mirror, undo. Views: colours, symbols, and a guides view that splits each
  two-guide pass into a YG1 and a YG2 row. Pass numbers and directions, needle numbers.
- **Shape grammar**: paint regions with signs (A, B, C … on a design layer), give each sign a structure (rib,
  garter, tuck moss, eyelets, hold for short rows, double knit …) and an optional outline structure, and the knit
  program is written from the signs as you draw. Any motif you draw can be saved as a new structure.
- **Experiments**: eight ready-made tests (accordion, bubble, cup, ridges, pleats, window, two-yarn picture, your
  own grammar), each with what to look for and what to try.
- **3D yarn**: the program run on a model V-bed, next to the chart. The machine tracks every needle's loops on both
  beds, the yarn guides, knits, tucks, misses and transfers, which loop is drawn through which, and each guide's
  continuous yarn. *Machine* steps through it pass by pass or action by action (needle beds flat or folded into
  the V, held loops on their hooks, transfers as arrows, the fabric made so far). *Fabric* shows the same yarn
  relaxed off the machine, in a background worker: an uncalibrated estimate (yarn length per stitch, bending,
  floats that can't stretch, strands that can't overlap side by side). Picking a stitch in 3D marks its cell, and
  hovering a cell lights its loops. Two rules the class key doesn't state (when transfers happen, how two guides
  travel) are switches marked "to confirm".
- **Keys**: the class presets (one and two yarn guides; colour key from Computational Textiles, MIT 4.S52/6.S895,
  Spring 2026, Mariana Popescu) and custom keys built from known operations.
- **Open**: BMP / PNG (near colours snap to the key and are listed; others stay and are flagged) and project files.
- **Check**: unknown colours, transfers off the edge, long floats, long-held loops, stacked tucks (limits you set).
- **Export**: 24-bit BMP with the key's exact colours, the grammar key as PDF and TXT, a symbol chart as PNG and
  SVG, and a project file. Patterns are kept in a library in the browser.

## Styles

| | Style | What it does |
|---|---|---|
| A | **Clean avatar** (default) | Built from the team's 40 characters, not traced from the photo. *Custom* uses the hair closest to yours and that character's face, swapping in glasses, facial hair, closed eyes or a grin when your photo shows them. *Prebuilt* shows one character exactly as drawn. Sizes: 25, 50, 72, 80, 96 or 128 stitches square. |
| B | Image-driven avatar | Traced from the photo: paper face, solid hair, drawn features. |
| C | Region poster | Bold shapes, each region cut separately. |
| D | Line portrait | Open skin, drawn contours. |
| E | Tone patterns | Paper, 50 %, 75 % and ink. |
| F | Atkinson tonal | Dithered shading, features kept. |
| G | ML lines | Lines drawn by a model (Informative Drawings, MIT licence; a 15 MB download on first use). |

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/KnittingPixelArtEditor/
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ the way GitHub Pages will
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`).

The clean avatar's library in `public/avatars/` is generated from the folder of 40 characters, which stays
outside the repo. To rebuild it (needs numpy, scipy and Pillow):

```sh
python3 scripts/build-avatar-library.py <portrait-40-multi-resolution folder>
```

## Code map

| What | Where |
|---|---|
| Import, pixel-art detection | `src/importer.ts`, `src/pixelart.ts` |
| Face points and regions (MediaPipe) | `src/detect.ts` |
| Framing | `src/frame.ts` |
| Photo preparation (crop, tone, regions) | `src/pipeline/prep.ts` |
| Clean avatar: part library, matching, composing | `scripts/build-avatar-library.py`, `public/avatars/`, `src/pipeline/clean.ts` |
| Image-driven avatar and the photo styles | `src/pipeline/avatar.ts`, `src/pipeline/styles.ts`, `src/pipeline/stamps.ts`, `src/pipeline/ml.ts` |
| Rendering off the main thread | `src/worker.ts` |
| Editor | `src/editor.ts` |
| Export | `src/export.ts` |
| Autosave | `src/store.ts` |
| Interface | `index.html`, `src/main.ts`, `src/style.css`, `src/ui/` |
| Chooser and routing | `src/app.ts` |
| Knit Grammar: operations, keys, symbols | `src/grammar/ops.ts` |
| Knit Grammar: patterns, editor, rendering, checks | `src/grammar/pattern.ts`, `editor.ts`, `render.ts`, `checks.ts` |
| Knit Grammar: files and library | `src/grammar/io.ts`, `src/grammar/library.ts` |
| Knit Grammar: shape grammar, structures, experiments | `src/grammar/structures.ts` |
| Knit Grammar: machine, yarn, relaxation, 3D view | `src/grammar/machine.ts`, `yarn.ts`, `relax.ts`, `knit.worker.ts`, `view3d.ts` |
| Knit Grammar: Learn pages, figures, 3D swatches | `src/grammar/learn.ts`, `figures.ts`, `swatch3d.ts`, `src/hl.ts` |
| Knit Grammar: interface | `src/grammar/ui.ts`, `src/grammar/main.ts` |

Planning notes: `SPEC.md`, `design/DESIGN.md`, `HANDOFF.md`, `RESEARCH.md`.

## License

Code: MIT (`LICENSE`). Models and other third-party files keep their own licenses — see `MODELS.md`.
The line figures use the hairline kernel by Lucas Marques (MIT, vendored in `src/vendor/hairline/` with its
license); the 3D views use three.js (MIT).

## AI usage

Made by NijatM with Claude Code CLI (version 2.1.289), using the Claude Opus 5.5 model at xhigh effort.
