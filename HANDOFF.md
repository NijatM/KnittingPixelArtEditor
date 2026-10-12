# Session handoff

Start the next session by reading, in this order: **HANDOFF.md → SPEC.md → design/DESIGN.md**, then `README.md` for the code map and `RESEARCH.md` only if needed.

Suggested first prompt next time:
> Read HANDOFF.md, SPEC.md and design/DESIGN.md, then continue with the next open item of the plan.

## Progress — Day 1 done (2026-10-11), part of Day 2 pulled forward

Built (Vite 8 + TypeScript 7, `npm run dev` / `build` / `preview`; Node 26 installed with Homebrew):

- Repo `github.com/NijatM/KnittingPixelArtEditor` (public), first commit pushed 2026-10-11; Pages deploy succeeded → **https://nijatm.github.io/KnittingPixelArtEditor/**. `.gitignore` keeps `TestPortraits/`, `research/private_*`, `public/mediapipe/` (copied WASM) out.
- GitHub Actions Pages workflow, Vite `base: '/KnittingPixelArtEditor/'`. Pages source is "GitHub Actions" (already set).
- App shell from the mockup CSS, IBM Plex Mono self-hosted, dark/light theme (remembered), `?` help, phone layout.
- Import: file picker, drag & drop anywhere, paste; EXIF orientation; ≤ 1600 px.
- MediaPipe face landmarks + multiclass segmentation, self-hosted, **CPU delegate** (GPU took ~14 s on the first photo).
- Frame view: photo + frame overlay, drag to move, scroll to resize, ratio 1:1 / 4:5 / 3:4 / 2:3 / free, framing + vertical sliders, reset.
- Grid: 32–128 quick sizes, width/height, lock to ratio, cell aspect.
- Worker pipeline (prep cached per crop+grid) with styles **A, B, C, D** (C and D were Day 2), region density sliders, cleanup, feature toggles, white/black background, glasses detection, 2-colour pickers, PNG export (1 px per stitch).
- `MODELS.md` (all shipped models verified), `LICENSE` (MIT), `README.md`.

Changed from the plan after testing on `TestPortraits/` (SPEC updated):
- Glasses: eyes are still redrawn and the frames are drawn as an outline (skipping the redraw made clear lenses look like sunglasses).
- Auto frame tightens up to 25 % so it ends at the photo's bottom edge (no blank band under the shoulders).

Verified headless (Playwright + Chromium in the scratchpad, production build): all 5 team photos render all 4 styles; glasses found on Nijat_V1 (8 %) and Nijat_V3 (31 %) only; sizes 32/128, ratios, sliders, PNG export (exactly 2 colours, 64×80), light theme, phone layout, a photo without a face; dev server; no page errors. ~1.3 s from photo to gallery on the first photo, ~0.7 s after. Test scripts kept (git-ignored) in `research/private_tests/`.

Second batch (2026-10-11, after the first deploy):
- Glasses are now **drawn from the eye landmarks** (rounded lens per eye + bridge, lens interior cleared, frame cells touching a brow dropped). The segmenter only finds the dark top bar of clear frames, so it is used for detection only. Fixes the "sunglasses" bars the user saw at 51 wide.
- Empty / frame view: the styles|pixels toggle no longer lights "pixels".
- **Backgrounds** pattern and photo (+ density) — Day 2 done.
- **Style E** (Day 3): `opensketch_style` → ONNX via `scripts/convert-informative-drawings.py`, second worker, WebGPU or CPU, line weight slider, progress + error state in the E tile. E is the cleanest style for harsh side light (Nijat_V3); it still turns moustaches into blobs (known).
- Offline tuning loop: `?debug` URL keeps detection data on `window.__kpaeDebug`; `research/private_tests/dump.mjs` saves it, `harness.ts` (bundled with rolldown) renders any style / setting / mask overlay in Node without a browser.

Third batch (2026-10-11) — Day 4 and Day 6 done (Day 5 stamps still open):
- **Editor** (`src/editor.ts`): pencil / erase / fill / line, brush 1–6, ink/paper, mirror around the face centre, undo/redo (200 steps), clear, live / Bake, edits kept across slider + style changes and rescaled on grid changes, zoom (stepper, + / − / 0, ⌘+scroll) with scrolling, keyboard shortcuts, touch drawing on phones; gallery thumbnails show your edits on every style.
- **Export** (`src/export.ts`): PNG, BMP with bit depth 1 / 4 / 8 / 24 (depths too small for the palette disabled), SVG (row runs merged into one path per colour, cell aspect respected). Verified pixel-identical to the PNG.
- **Autosave** (`src/store.ts`): IndexedDB, last project only; reload restores photo, detection, settings, edits and bake exactly; "forget this project" in Export.
- Regression scripts for all of it in `research/private_tests/` (editor, exports + `check_exports.py`, autosave, phone).

Fourth batch (2026-10-11) — Day 5 done: **stamps** (`src/pipeline/stamps.ts`, replaces the fixed drawing in features.ts). 5 eye, 4 brow, 6 mouth, 4 nose, 4 glasses variants; "auto" per photo + grid size; Stamps panel steppers (auto → variants → off, off = the 05 Features switch), tap-to-cycle in the view with dashed hit boxes, "all auto"; saved with the project. Auto picked the open-mouth stamp for both Mariana photos (open smiles), which fixes the flat-line mouth; the Nijat photos render bit-identically to before. Harness: `research/private_tests/stampsheet.ts` renders every variant per face.

Fifth batch (2026-10-12) — Day 7 hair modes done: Regions panel mode auto · solid · tone · texture, measured hair lightness (Nijat 26–63 = dark, Mariana 103–114 = medium-light). Mariana's hair now reads brown instead of a black mass (≈ 10 points less ink in every style); Nijat's renders change by ≤ 7 cells (a few merged flecks) except D on V3 (dither spreads a tiny lightness change). Texture mode = outline + strand lines, best for curls. All 7 days of the plan are now built.

Next (tuning / polish, no fixed plan left):
1. Strong side light (Nijat_V3: shadowed cheek goes solid in A/C/D) — e.g. even out lighting per face half before the skin cut.
2. Moustache / beard blobs in E (and A at small sizes).
3. Optional: fp16 weights to halve the 15 MB model download; more portraits from the team to tune on.

## Planning session — 2026-10-09

### What happened in that session

1. **Research** (web): pixel-art downscaling (Gerstner 2012, Kopf 2013, Deep Unsupervised Pixelization, Pyxelate), B&W stylization (XDoG, FDoG, Winnemöller), portrait line models (Informative Drawings MIT CVPR'22, APDrawing / U²-Net portrait, QMUPD), binarization and dithering, knitting constraints (gauge ratio, floats, AYAB, Kniterate), browser ML (MediaPipe, ONNX Runtime Web). → `RESEARCH.md`
2. **Experiments** (Python prototypes, `research/prototype/`), 6 rounds on public-domain portraits and the team's `TestPortraits/`. Key results:
   - naive downscale + threshold/dither is unusable; **background removal** is the biggest single win;
   - **per-region thresholds** (skin / hair / clothes) keep any face readable;
   - **clear the eye sockets and redraw eyes from landmarks** fixes the "sunglasses" look;
   - **Informative Drawings coarse + region fills** is the best ML style; model input ≈ 7 × grid width (256–768);
   - no single style wins on every face → gallery of styles;
   - glasses are detectable for free (MediaPipe "accessories" class in the eye box);
   - remaining weak spots: open-smile mouths, beards under ML lines, voluminous curly/light hair, 3/4 views; framing bug when the photo is tightly cropped (pad as background, not edge-replicate).
3. **Planning interview (grill-me)** → all decisions below → `SPEC.md`.
4. **UI design** cloned from the HTMAA site / SubdivisionEngine_BDMH → `design/`.

## Decision log (question → answer)

| # | Question | Decision |
|---|---|---|
| 1 | How is it knitted? | Not yet — focus on cohesive pixel art; N-colour palette, 2 colours now |
| 2 | Cell shape setting? | Yes, default 1:1 (future knit gauge) |
| 3 | Which styles? | A region poster, B line portrait, C 4-tone patterns, D Atkinson tonal, + ML portrait models; user picks the start |
| 4 | Non-commercial models? | Allowed (free public tool) |
| 5 | Feature extraction | ML (MediaPipe) + manual fallback (manual → v2) |
| 6 | Grid size | Any; default 64×80; quick 32/48/64/96/128 + free |
| 7 | Skin tone | Region-normalized + skin density slider |
| 8 | Framing | Auto from face + tight↔wide slider + free crop |
| 9 | Background | Per portrait: white / black / pattern / photo |
| 10 | Frame shape | 1:1, 4:5, 3:4, 2:3 + free |
| 11 | Photos | Single-person portraits, glasses/hats/beards possible; anyone; one person per session |
| 12 | Edits vs regeneration | Edits layer over the base + **Bake** to flatten |
| 13 | v1 tools | Pencil, eraser, fill, line, undo/redo, mirror, feature stamps |
| 14 | Choosing a start | Gallery grid of all styles |
| 15 | Devices | Desktop, tablet, phone |
| 16 | Collecting portraits | Each person downloads their own; no backend |
| 17 | Exports | PNG (1 px = 1 cell), BMP (bit depth chosen by the user: 1 / 4 / 8 / 24), SVG |
| 18 | Autosave | In browser, **last project only** |
| 19 | Previews | Clean pixel-art preview only |
| 20 | Stack | Vite + TypeScript, GitHub Actions → Pages |
| 21 | Models | All in repo (U²-Net is 176 MB > GitHub's 100 MB limit → it's v2 anyway) |
| 22 | Timeline | v1 within a week (≈ 2026-10-16); lean, then iterate |
| 23 | Deferred to v2 | U²-Net + heavy NC models, manual landmark fallback, full glasses/beard handling |
| 24 | Input | File picker, drag & drop, paste |
| 25 | Test photos | `TestPortraits/` (private, git-ignored) + public-domain ones |
| 26 | License | MIT |
| 27 | Glasses in v1 | Auto-detect + "redraw eyes" toggle |
| 28 | Hair | Mode (solid / tone / texture) + density slider |
| 29 | Stamps | Procedural, auto-placed from landmarks, tap to swap |
| 30 | Colours | Any 2 colours (default ink #0b0b0b, paper #f4f4f4) |
| 31 | Cut first if late | Hair modes (keep density slider) |
| 32 | UI flow | Single workspace |
| 33 | Repo | Personal GitHub account, name **KnittingPixelArtEditor** → `<user>.github.io/KnittingPixelArtEditor` |
| 34 | Offline / PWA | Not now |
| 35 | App name | KnittingPixelArtEditor |
| 36 | Visual style | Same as nijatmahamaliyev.com / HTMAA site; "Tailored Materiality Research" instead of HTMAA; no week; one short sentence under the name |

## Open items to confirm

Resolved 2026-10-10:

- Sidebar footer: the `after Gerstner et al. (2012)` line was invented by the planning session as filler (the reference site has no such line) → removed; footer is just `nijatmahamaliyev.com`. The PNGs in `design/screens/` still show the old line until they are re-captured.
- "Bitmap" export = `.bmp` with a **user-chosen bit depth** (1 / 4 / 8 / 24), not fixed 1-bit.
- Informative Drawings weights are safe to use → see `MODELS.md`. `sk_model2.pth` is byte-identical to the author's `opensketch_style` checkpoint (MIT, Caroline Chan); training drawings (OpenSketch) are CC0.
- Phones use the reference site's pattern (step chips on top, stage, inspector below) rather than bottom tabs.

## Files

| Path | What |
|---|---|
| `SPEC.md` | v1 spec, architecture, 7-day plan, v2 backlog |
| `design/DESIGN.md` | UI design system, layout, components, panel contents |
| `design/mockup.html` + `mock-data.js` | clickable UI mockup with real 64×80 style outputs (public-domain image) |
| `design/screens/` | mockup screenshots: desktop, light theme, phone |
| `RESEARCH.md` | research + experiment findings with sources |
| `MODELS.md` | every shipped model: source, license, SHA-256 |
| `README.md` | how to run, code map (`src/`, `public/models/`, `scripts/`, `.github/workflows/`) |
| `research/private_tests/` | headless test scripts (Playwright), git-ignored |
| `research/round1…5*/` | comparison sheets (public-domain images) |
| `research/private_round6_team/` | results on team photos (git-ignored) |
| `research/prototype/` | Python prototypes `exp.py … exp6.py` (MediaPipe, OpenCV, PyTorch, onnxruntime) |
| `research/private_session/` | raw transcript of this session (git-ignored) |
| `TestPortraits/` | team test photos (git-ignored) |
| `.gitignore` | ignores TestPortraits, research/private_*, node_modules, dist |

## Day 1 plan (done — see Progress at the top)

1. `git init`, Vite + TypeScript scaffold, `base: '/KnittingPixelArtEditor/'`, GitHub Actions Pages workflow (don't push until you say so).
2. Port the mockup CSS into the app shell (nav / stage / inspector), self-host IBM Plex Mono.
3. Import (file / drag / paste), EXIF orientation, downscale ≤1600 px.
4. Web Worker pipeline skeleton; styles A + B ported from `research/prototype/exp2.py`.
5. Grid size + frame ratio controls; canvas renderer.

## Note on renaming the folder

Claude Code keys sessions and memory by folder path. After renaming `PixelPortraitMaker` → `KnittingPixelArtEditor`, `claude --resume` won't list this session from the new path, and the memory notes stay under the old path. This file, SPEC.md and design/ travel with the project, so a fresh session that reads them has everything it needs.
