# KnittingPixelArtEditor

Photo portraits into knittable pixel art. A free, browser-only editor: drop in a portrait, pick one of several
two-colour styles rendered from your photo, then refine it. The photo never leaves your device — face detection
(MediaPipe) and all image processing run locally.

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
| Face points (478) + hair / skin / clothes / accessories regions, once per photo | `src/detect.ts` (MediaPipe, CPU) |
| Auto-framing from the face oval, tight↔wide, drag | `src/frame.ts` |
| Crop → work image (≈10× grid) → grey, bilateral, CLAHE → grid tone + regions | `src/pipeline/prep.ts` |
| Drawn features: eyes, brows, mouth, nostrils, jaw, glasses frames | `src/pipeline/features.ts` |
| Styles A region poster · B line portrait · C tone patterns · D Atkinson tonal · E ML lines | `src/pipeline/styles.ts` |
| Style E line model (Informative Drawings, ONNX Runtime Web, WebGPU or CPU) | `src/pipeline/ml.ts`, `scripts/convert-informative-drawings.py` |
| Processing off the main thread in two workers (A–D instant, E model); prep and line map cached | `src/worker.ts` |
| Edits layer, pencil / erase / fill / line, mirror, undo, live / bake | `src/editor.ts` |
| PNG · BMP (1/4/8/24-bit) · SVG export | `src/export.ts` |
| Autosave of the last project (IndexedDB) | `src/store.ts` |
| UI (nav / stage / inspector) | `index.html`, `src/main.ts`, `src/style.css`, `src/ui/` |

Planning and research: `SPEC.md`, `design/DESIGN.md`, `RESEARCH.md`, `HANDOFF.md`.

## License

Code: MIT (`LICENSE`). Models and other third-party files keep their own licenses — see `MODELS.md`.
