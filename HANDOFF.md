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

Sixth batch (2026-10-12) — side light tuned: **even light** slider under SKIN (default 0.80, `src/pipeline/light.ts`). Removes only the left–right antisymmetric part of the skin tone (bands across the face midline, medians), stepped at the midline so no seam appears beside the nose. Nijat_V3's shadowed cheek no longer goes solid in A/C/D; the frontally lit photos change by only 24–41 cells at 64 wide and keep their beards.

Seventh batch (2026-10-12) — moustache / beard blobs: facial-hair cue in prep (work resolution, so the same at every grid size: bearded Nijat V1/V2 ≈ 0.67, others 0.31–0.41, threshold 0.5). With facial hair: 1-cell paper gaps above/below the mouth and under the nose base (`separate()` in stamps.ts), and E stamps the mouth. Nose, moustache, mouth and beard now read as separate shapes in A–E; clean-shaven photos are unchanged by construction.

Eighth batch (2026-10-14) — **select tool** (`src/editor.ts`, asked for by the user): rectangle select (S, ⌘A all), drag inside / arrow keys (⇧ = 5) to move, H / V flip, **mirror copy** across the face centre, Esc / Enter deselect. The cells a move leaves behind take the colour around the selection ("around", default) or paper (Draw panel "left behind"), not ink. Lifted pixels float until dropped, so what they pass over survives; a move, its drags and flips are one undo step; autosave writes the lifted pixels as if dropped. With select on, the toolbar swaps ink/paper + mirror for flip ↔ · flip ↕ · mirror copy; the Draw panel's tool seg sits on its own line (five tools don't fit next to a label). Test: `research/private_tests/select.mjs` (passes on Nijat_V1, Nijat_V3, Mariana_V1); editor / editor2 / autosave / phone / stamps scripts still pass.

Ninth batch (2026-10-14) — **clean avatar style**, now first and the default (`src/pipeline/avatar.ts`). The user found none of A–E matched the team's look and pointed at four hand-finished 50×50 portraits made with another agent (in their Downloads: `Nijat_portrait-50x50_binary.bmp`, `Mariana_portrait_50x50_V2_binary.bmp`, `Valerio_…`, `Ilkyaz_…`; not in the repo). Their look: paper face + one-cell contour, solid hair with a few cuts (curly hair as strands), solid clothes, features as icons (2×2 pupils / lid + pupil / dashes, big continuous rims, two-row moustache bar, small goatee, open smile with paper teeth). The avatar rebuilds that automatically from MediaPipe points + regions; thresholds were set on the test photos (see SPEC pipeline step 5A). Compared side by side at 50×50: Nijat_V1 ≈ the reference (rims, pupils, moustache, goatee dot); Mariana_V1 close (strand hair, lid eyes, open smile); Mariana_V2 (frizzy hair on a busy background) stays noisy. No photos of Valerio / Ilkyaz were available. Also: style ids are now names (`avatar`, `poster`, `line`, `tone`, `tonal`, `ml`), the letters shown follow the gallery order (old saved letters are mapped), quick size 48 → 50, `Prepared.work` keeps the work image (grey, CLAHE tone, regions) for styles that measure below a cell. The other agent's longer plan (movable guides instead of detected points, per-component layers and locks, a resolution comparison view, portable project files) is **not** built.

Tenth batch (2026-10-14) — **binary exports**: default palette is pure `#000000` / `#ffffff` (the old tinted default in saved projects is mapped), PNG is now written by `encodePng` as a 1-bit indexed, opaque file (was an 8-bit RGBA canvas PNG), and every export takes the editor's final composite (`final()` in main.ts) or refuses while the style lags a grid change. Verified with `research/private_tests/binary_export.mjs` + `check_binary.py` (chunk CRCs, 1-bit, palette, no tRNS, BMP header fields, pixel identity with the editor canvas — with a lifted selection, grid lines and zoom on — for black / white, custom and swapped palettes). Headers match the team's reference BMP byte for byte except the DPI field (72 vs 96).

Eleventh batch (2026-10-14) — **pixel image import** (`src/pixelart.ts`): PNG / BMP pixel art opens as cells, ready to edit, instead of going through detection (before, the team's 50 × 50 BMPs rendered as a white page). Rules in SPEC "Input". Tested on the team's eight portraits in `MIT/TMR/portraits/` (1-bit BMPs, 1-bit palette / grayscale and 8-bit palette PNGs): every one opens 50 × 50 cell-for-cell identical, and PNG / BMP exports without edits are identical to the originals; plus 2× / 7× / 10× / uneven (512 px) enlargements, a 3-colour and a transparent version, an old 500 px 10× export — all exact; JPEG and photos still open as photos (`research/private_tests/pixel_import.mjs`, `samples.mjs`). Editor fixes found on the way: a frozen base (bake / import) shrank with ink not voting, so thin lines turned paper — every colour votes now, ties go to ink; and grid changes rescale the base from its last own-size version (kept through undo), so 50 → 96 → 50 gives back the exact picture.

Twelfth batch (2026-10-14) — **11 reset** under MAKE in the nav: opens a confirmation dialog (`<dialog>`, site look, cancel focused, Esc / backdrop close, yes in the warn colour); "forget this project" in export now opens the same dialog instead of wiping at once. Yes stops autosave, clears IndexedDB and reloads. Editor shortcuts are off inside the dialog. Test: `research/private_tests/reset.mjs`.

Thirteenth batch (2026-10-14) — **clean avatar polish + a curated stamp library with an option picker**, from the user's photo `~/Downloads/IMG_6384.JPG` (Ilkyaz; her reference is in `MIT/TMR/portraits/`; private, not in the repo). Base: a one-cell paper gap where solid hair lies on solid clothes (only along locks, so stray strands don't checker the clothes), hair spurs / notches against the background smoothed, clothes specks (earrings) dropped; glasses lenses measured from the frames' segmentation when it goes all round (her tortoiseshell frames: 10 × 9 cells, flat top, round bottom → auto "pantos"; clear frames aren't measured). Stamps: ~70 candidates rendered on the six faces, awkward ones culled → 61 offered (list in SPEC "Stamps"); kept by **name** now; the avatar draws through the same library (its auto picks names); brows lift above rims instead of vanishing. Panel: option grid per feature, previews rendered by the worker (`variants` message). Tests: `research/private_tests/stamp_options.mjs`; the whole suite passes. Still different from her reference: her hair is drawn with light strands and the framing is tighter.

Fourteenth batch (2026-10-14) — the user found the clean avatar of Mariana (`~/Downloads/Popescu_Mariana_2025-500x500.jpeg` = `TestPortraits/Mariana_V1.jpeg`) "far from clean" next to her reference. Fixed: (1) **framing** from the head box (whole hairdo in frame, hair top 6 % from the edge; matches the four references' framing within ~0.2 face widths); (2) **hair as locks** split by spaced strand lines (bright-ridge peaks, thinned, long only) instead of thresholded noise; (3) a **symmetric base**: upright, mirrored face; all features but one-sided designs mirrored exactly; small faces drawn with larger eyes / mouth; (4) the **almond** eye (the reference's eye) as auto, thin brows dropped without glasses; (5) facial hair gated on the lower-face cue (the zone alone flipped Mariana_V2 to "moustache" at 32 px and lost Nijat's at 50). Side by side at 50 × 50 Mariana now reads like her reference; the 64 × 80 default too. Remaining difference: the reference's strands curl diagonally, ours follow the photo's ridges.

Fifteenth batch (2026-10-16) — **a new clean avatar from the team's 40 characters**, after a grill-style interview with the user (their answers, in short): the traced avatar stays as **B Image-driven avatar** (id `avatar`; the user also calls it "prelim avatar"); the new **A Clean avatar** (id `clean`, first and default) is put together from a part library cut from the 40 approved characters (`MIT/TMR/portraits/portrait-40-multi-resolution`, six sizes each; the folder stays local). Decisions: library cut from the 40 only, cut "context-aware" (each part knows the cells it inks; swaps refit the surroundings); hair goes with its own head, ears, neck and shoulders; the photo matches hair shape & length, glasses + shape, facial hair, expression; **Custom** (default) = closest hair + that character's face with swaps where the photo differs, every part changeable in 08; **Prebuilt** = one character exactly as drawn, auto = closest, stepper + picker, works without a photo ("start from a character" on the empty screen); changing a part of a prebuilt makes it custom from that character; picker in clean avatar only; "Stamps" renamed **Parts** (08 parts); look-alike parts merged; sizes 25 / 50 / 72 / 80 / 96 / 128 square, default 50 × 50 (the grid snaps while clean is selected); the converted art is public in the repo under short nicknames (`public/avatars/<nick>/<size>.png`).
  Built: `scripts/build-avatar-library.py` (cuts at 128 px — face = the paper pieces inside the face closed over thin lines; glasses = two side-by-side paper pieces ringed by drawn lines; brows above the rim's thickness; the face edge separates hair / outline from features; beards and chin goatees as their own label; four hand fixes; smaller sizes take the weighted label of the 128 px pixels they cover, thin lines winning), `public/avatars/` (240 PNGs, `library-<size>.json` = labels as run-length text + anchors, `manifest.json` = tags + hair measures), `src/pipeline/clean.ts` (loading, parts, placement mirror-wise per eye / at nose / at mouth, glasses bridge and arms refitted, fit = face size within ±25 % and ≥ 92 % lands in the face, look-alike groups, composition rules: eyes clear of the frames, brows off the hair and lifted over frames, a paper cell around the mouth in a moustache or beard; photo measures from the segmentation in eye distances, head score = hair distance + beard + swaps, prebuilt score adds glasses / eyes / mouth / facial hair), `facialHairKind` in avatar.ts, worker renders clean without a photo and previews by looks, UI: Style panel CLEAN AVATAR (mode, character stepper, 40-tile picker, closest dashed), 08 Parts rows hair … facial hair with option grids and tap-to-open, no-photo projects (`kind: 'blank'`, autosaved), size buttons 25 · 50 · 72 · 80 · 96 · 128. Checked: every character rebuilt from its own parts is pixel-identical to the art at all sizes; prebuilt export = the art file; `research/private_tests/clean.mjs` (30 checks) and the older suite (moved to the image-driven avatar at 72 × 90 where they assumed the old 64 × 80 default) pass.
  Known: the art at 25 px is too coarse for collage; beards travel from #5 and #39 only (#29's mouth is hidden in its beard, so nothing places it; #17's beard is thin jaw lines) — auto takes the shortest that fits, and a big face's beard (#5) fits few small heads; parts from small faces (#21, #37, #23) fit few heads; matching was tuned on six photos only.

Sixteenth batch (2026-10-16) — two fixes the user asked for: (1) changing the hair changed every part on auto (auto followed the picked hair's own face) — auto face parts now come from the closest character whatever hair is picked; a part that doesn't fit the picked face becomes the most similar fitting one (same kind: open / closed eyes, grin / smile, moustache / beard; closest size); about 80 % stay exactly. (2) stepper arrows moved with the label length — each label is now as wide as its longest possible text (`ch`, monospace), centred, one width per panel, and the inspector reserves its scrollbar gutter (the panel shifted 19 px when the picker made it scroll). The character stepper reads `auto · afro` (closest) or `2/40 · bob`. `research/private_tests/steppers.mjs` checks both.

Seventeenth batch (2026-10-16) — "nothing moves under the pointer", after the user found the stepper arrows moving (the fix was live; their browser had cached the old build — incognito showed it). Audit of the same problem elsewhere, all fixed: the options box now opens under the last row (opening another row made the clicked row jump), the BMP bit-depth row stays in place dimmed for PNG / SVG (the name field and export button jumped), and grid + zoom come before the tool's own options in the toolbar (they slid when switching to select). Bars were already stable (fixed value column). The hair row is called **hair + head**. `steppers.mjs` checks all of it.

Next (tuning / polish, no fixed plan left):
1. Optional: fp16 weights to halve the 15 MB model download.
2. More portraits from the team to tune on (only 5 test photos so far; 2 bearded, 2 with glasses, 1 side-lit).

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
