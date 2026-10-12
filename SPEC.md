# KnittingPixelArtEditor — v1 Spec

Agreed in planning session 2026-10-09. Evidence for every choice is in `RESEARCH.md` and `research/`. UI design: `design/DESIGN.md` + `design/mockup.html`. Session summary: `HANDOFF.md`.

**Goal:** a free, public, browser-only editor that turns a portrait photo into a *cohesive, appealing* 2-color pixel portrait (later knitted), then lets the person refine it by hand.

## Product decisions

| Area | Decision |
|---|---|
| Users | Anyone, public; one person per session; no accounts, no backend |
| Privacy | Photos never leave the device; everything runs client-side |
| Knitting | Deferred. Keep a **cell aspect-ratio** setting (default 1:1) for future gauge |
| Colors | Palette of indexed colors; v1 = **any 2 colors** (default black/white) |
| Input | File picker, drag & drop, paste from clipboard |
| Framing | Auto-frame from face landmarks + tight↔wide slider + free drag/resize crop; pixels outside the photo = background; the auto frame tightens (≤ 25 %) so it ends at the photo's bottom edge instead of above a blank band |
| Frame shape | Quick ratios 1:1, 4:5, 3:4, 2:3 + free W×H |
| Size | Default **64×80**; quick widths 32 / 48 / 64 / 96 / 128; free entry |
| Background | Per portrait: white / black / pattern (Bayer dots, density slider) / photo (the real background drawn in the style, flat walls stay paper); "outline the person" = ink line against white, 1-cell paper gap against the others |
| Start | **Gallery grid**: every preset renders a thumbnail at the chosen size; click one to start |
| Presets | A Region poster · B Line portrait · C 4-tone patterns · D Atkinson tonal · E ML lines (Informative Drawings, `opensketch_style`) |
| Feature extraction | MediaPipe Face Landmarker + Selfie Multiclass segmentation; on detection failure, filter-only presets |
| Skin | Region-normalized by default + **skin density** slider (all region sliders: 0 = paper, 0.5 = each style's tuned balance, 1 = ink) |
| Hair | **Mode** auto / solid / tone / texture + **density** slider. auto = each style's own hair (A/B/E solid, C patterns, D dither); solid = one mass, lone flecks merged; tone = 4 pattern levels in coherent zones; texture = hair outline + strand lines (difference of Gaussians, specks under 3 cells dropped) + darkest shadows. Hair lightness is **measured** (median luminance of the hair pixels): light hair gets less ink at the same density (black hair unchanged) |
| Glasses | Auto-detect (accessories class ≥ 3 % of eye box) → eyes still redrawn **and** frames drawn as a 1-cell outline of the accessories region around the eyes; "glasses frames" toggle. (Changed 2026-10-11: skipping the eye redraw turned clear lenses into black "sunglasses" on the team photos.) |
| Edit model | Hand edits on a separate **edits layer** (per cell: auto / forced color k) over the regenerable base; **Bake** flattens style + edits into a frozen base; "live" off freezes the base without flattening, live on follows the style again (both undoable); a grid-size change rescales the edits (thin lines survive) |
| Tools | Pencil, eraser, flood fill, line, undo/redo, **mirror symmetry** (axis snaps to face centre), **feature stamps** |
| Stamps | **Procedural** (`src/pipeline/stamps.ts`): eyes traced · dots · almond · liner · closed; brows traced · thin · bold · arched; mouth traced · smile · open · lips · dash · small; nose nostrils · base · side · dot; glasses rounded · round · square · browline. **Auto-placed** from landmarks; "auto" picks per photo and size (dot eyes/nose on small grids, open mouth when the inner-lip gap > 8 % of mouth width, frames when glasses are found). Stamps panel steppers (auto → variants → off) and tap a feature in the view (Stamps step) to cycle it. Designed noses/mouths clear the photo's shading first. In style E, mouth/nose stay the model's unless picked. A hand-drawn set can be added as more variants |
| Preview | Clean pixel-art preview only |
| Export | PNG (1 px = 1 cell), BMP (user-chosen bit depth 1 / 4 / 8 / 24; indexed depths carry the palette, depths too small for it are disabled), SVG |
| Autosave | IndexedDB, **last project only** (new photo replaces it): photo as lossless PNG + detection, settings, edits, bake; reopened on load; "forget this project" clears it |
| Devices | Desktop, tablet and phone; single workspace, panels collapse to bottom tabs on phones |
| Offline/PWA | Not now |

## Pipeline (per preset, in a Web Worker)

1. Import → EXIF orientation → downscale to ≤1600 px.
2. Detect landmarks (478 pts) + segmentation (bg / hair / body-skin / face-skin / clothes / accessories).
3. Frame crop → work image at 10× grid resolution → grayscale, bilateral smooth, CLAHE.
4. Region maps at grid res; background → chosen background.
5. Preset render:
   - **A Region poster**: per-region percentile thresholds (skin from slider, hair from hair controls, clothes ~p55), orphan cleanup, silhouette outline.
   - **B Line portrait**: as A but skin left open + jaw line from landmarks.
   - **C 4-tone patterns**: region-normalized tone → 4 levels → 3×3 mode filter → fixed 2×2 patterns (0/25/50/100%).
   - **D Atkinson tonal**: region-normalized tone → Atkinson dither.
   - **E ML lines**: Informative Drawings `opensketch_style` (ONNX) at input ≈ 7 × grid width, clamped 256–768 → ink coverage → grid; hair/clothes by region.
6. Feature layer (A–E): clear eye sockets + draw lid line and iris, brows, mouth, nostrils — unless glasses detected or toggle off.
7. Composite: base → edits layer → display palette.

Known weak spots (tune with `TestPortraits/`): open-smile mouths, beards under E, voluminous curly/light hair, 3/4 views.

## Architecture

- **Vite + TypeScript**, no UI framework; hand-written canvas editor.
- Processing in **Web Workers**: one for the instant styles A–D, a second one for the ML style E so a model run never blocks the sliders. ONNX Runtime Web for the line model: WebGPU build when the browser has WebGPU (~0.3 s per run on an M2 Pro), otherwise the smaller CPU build (~5.5 s single-threaded; Pages isn't cross-origin isolated, so no WASM threads). The line map is cached per crop + grid, so region / line-weight sliders don't re-run the model; `@mediapipe/tasks-vision` WASM runs once per photo on the main thread with the **CPU** delegate (the GPU delegate took ~14 s on the first photo on an M2 Pro; CPU ~0.4 s).
- **All models in the repo** under `public/models/`: face_landmarker (3.7 MB), selfie_multiclass (16 MB), Informative Drawings `opensketch_style` (17 MB fp32 / ~9 MB fp16), taken from the author's own release, not the `lllyasviel/Annotators` mirror.
- Project data: `{version, source photo (downscaled), crop, grid{w,h,cellAspect}, palette[], preset{id, params}, edits: Uint8Array (0=auto, k+1=forced color k), baked}`.
- GitHub Actions builds and deploys to Pages; Vite `base: '/KnittingPixelArtEditor/'`; personal account → `<user>.github.io/KnittingPixelArtEditor`.
- License: **MIT** for code; `MODELS.md` lists each model's own license. Informative Drawings weights verified 2026-10-10: MIT (Caroline Chan), ship its MIT notice next to the ONNX file.
- `TestPortraits/` and `research/private_*` are git-ignored.

## One-week plan (if it slips, **hair modes** go to v1.1 first; density slider stays)

| Day | Deliverable |
|---|---|
| 1 | Scaffold, Pages deploy, import/frame/size, worker pipeline with A + B |
| 2 | Landmarks + segmentation wired; C + D; skin slider; background options; glasses detection |
| 3 | Informative Drawings → ONNX; preset E; gallery with sequential lazy rendering |
| 4 | Editor: zoom/pan, pencil/eraser/fill/line, undo/redo, edits layer, Bake, mirror |
| 5 | Procedural stamps auto-placed + swap; 2-color pickers |
| 6 | PNG/BMP/SVG export, autosave, phone layout |
| 7 | Hair modes, tuning on TestPortraits, polish, deploy |

## v2 backlog

U²-Net portrait / APDrawingGAN++ / QMUPD (non-commercial; quantize under 100 MB, check redistribution terms) · manual landmark placement · full glasses/beard/hat handling (BiSeNet face parsing) · more than 2 colors · knitting: gauge, technique, float limits, machine exports · previews: overlay, squint, actual size · pattern brush · hand-drawn stamp sets · camera input · PWA/offline.
