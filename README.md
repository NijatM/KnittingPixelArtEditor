# KnittingPixelArtEditor

Photo portraits into knittable pixel art. A free, browser-only editor: drop in a portrait, start from a clean avatar
put together from the team's 40 characters (the parts closest to you), or from one of several two-colour styles
rendered from your photo, then refine it. The photo never leaves your device — face detection (MediaPipe) and all
image processing run locally.

Nijat Mahamaliyev · Tailored Materiality Research

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/KnittingPixelArtEditor/
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ the way GitHub Pages will
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`; set the repository's
Pages source to "GitHub Actions" once).

## How it works

| Step | Where |
|---|---|
| Import (file, drag & drop, paste), EXIF orientation, ≤1600 px | `src/importer.ts` |
| Pixel images (PNG / BMP, ≤ 16 flat colours, native or enlarged) open as cells to edit | `src/pixelart.ts` |
| Face points (478) + hair / skin / clothes / accessories regions, once per photo | `src/detect.ts` (MediaPipe, CPU) |
| Auto-framing from the face oval, tight↔wide, drag | `src/frame.ts` |
| Crop → work image (≈10× grid) → grey, bilateral, CLAHE → grid tone + regions | `src/pipeline/prep.ts` |
| Clean avatar: the team's 40 characters cut into parts (hair with head, eyes, brows, nose, mouth, glasses, facial hair) at 25–128 px; custom = parts closest to the photo, prebuilt = a character as drawn | `scripts/build-avatar-library.py` → `public/avatars/`, `src/pipeline/clean.ts` |
| Drawn parts for the photo styles: 61 named shapes for eyes, brows, mouth, nose, glasses (+ jaw line), measured glasses lenses | `src/pipeline/stamps.ts`, `src/pipeline/features.ts`, `src/pipeline/prep.ts` |
| Styles A clean avatar · B image-driven avatar · C region poster · D line portrait · E tone patterns · F Atkinson tonal · G ML lines (ids `clean`, `avatar` … `ml`; the letter is the gallery position) | `src/pipeline/clean.ts`, `src/pipeline/styles.ts`, `src/pipeline/avatar.ts` |
| ML lines model (Informative Drawings, ONNX Runtime Web, WebGPU or CPU) | `src/pipeline/ml.ts`, `scripts/convert-informative-drawings.py` |
| Processing off the main thread in two workers (instant styles, ML lines); prep and line map cached | `src/worker.ts` |
| Edits layer, pencil / erase / fill / line, select (move / flip / mirror copy), mirror, undo, live / bake | `src/editor.ts` |
| PNG (1-bit indexed) · BMP (1/4/8/24-bit) · SVG export of the final composite, opaque, no margin | `src/export.ts` |
| Autosave of the last project (IndexedDB) | `src/store.ts` |
| UI (nav / stage / inspector) | `index.html`, `src/main.ts`, `src/style.css`, `src/ui/` |

Planning and research: `SPEC.md`, `design/DESIGN.md`, `RESEARCH.md`, `HANDOFF.md`.

## License

Code: MIT (`LICENSE`). Models and other third-party files keep their own licenses — see `MODELS.md`.

## AI usage

Made by NijatM with Claude Code CLI (version 2.1.289), using the Claude Opus 5.5 model at xhigh effort.
