# KnittingPixelArtEditor

Turn a portrait into two-colour pixel art for knitting. One cell is one stitch.

It is a free editor that runs entirely in the browser. Your photo never leaves your device: face detection
(MediaPipe) and all image processing happen locally.

Nijat Mahamaliyev · Tailored Materiality Research

## What you can do

- **Start from a photo**: drop, paste or choose one. The face is found, framed and turned into every style at once.
- **Start without a photo**: pick one of the team's 40 characters.
- **Open pixel art**: PNG or BMP files open as editable cells, at their own size or enlarged.
- **Change the parts**: hair, eyes, brows, nose, mouth, glasses and facial hair, each with a preview of every option.
- **Edit by hand**: pencil, erase, fill, line, select (move, flip, mirror copy), mirror drawing, undo, bake.
- **Export**: PNG (1-bit), BMP (1/4/8/24-bit) or SVG. The file holds exactly what the editor shows: one pixel
  per stitch, no margin.
- **Autosave**: the last project is kept in the browser, and 11 reset starts over.

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

Planning notes: `SPEC.md`, `design/DESIGN.md`, `HANDOFF.md`, `RESEARCH.md`.

## License

Code: MIT (`LICENSE`). Models and other third-party files keep their own licenses — see `MODELS.md`.

## AI usage

Made by NijatM with Claude Code CLI (version 2.1.289), using the Claude Opus 5.5 model at xhigh effort.
