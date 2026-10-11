# PixelPortraitMaker — Research Notes

Goal: browser tool (GitHub Pages) that turns a photo portrait into a **binary (2-color) stitch grid** for knitting, with size selection, preliminary conversion methods, and live pixel editing.

---

## 1. Why "downscale → threshold" fails on portraits

| Problem | Cause | Consequence |
|---|---|---|
| Features vanish | Box/bilinear downscale averages eyes/mouth into mid-gray | Threshold drops them or turns them into blobs |
| Lighting dominates | Global threshold follows illumination, not form | Half the face goes black under side light |
| Noise / "sand" | Dithering preserves tone via scattered pixels | Unreadable at knit scale; no clean shapes |
| Distortion | Knit stitches are wider than tall | A square-pixel image knits out stretched vertically |
| Unknittable runs | Large solid areas | Long floats (hand stranded) |

The fix is a **pipeline that does the stylization at high resolution, downsamples with a feature-aware method, then cleans up under knitting constraints**, and gives the human final control.

---

## 2. Pixel-art conversion research (photo → cohesive low-res)

- **Pixelated Image Abstraction** (Gerstner et al., NPAR 2012). SLIC-like superpixels + palette jointly optimized; beats nearest/cubic in user study. https://pixl.cs.princeton.edu/pubs/Gerstner_2012_PIA/index.php · user-constraints version: https://cragl.cs.gmu.edu/pixelate/journal.html
- **Content-Adaptive Image Downscaling** (Kopf, Shamir, Peers, SIGGRAPH Asia 2013). Per-output-pixel kernels (bilateral space+color) optimized with EM so thin lines stay *sharp and connected*. https://johanneskopf.de/publications/downscaling (has pseudocode PDF)
- **Deep Unsupervised Pixelization** (Han et al., SIGGRAPH Asia 2018). GridNet/PixelNet/DepixelNet, code on GitHub. https://github.com/csqiangwen/Deep-Unsupervised-Pixelization
- **Pyxelate** (Python). HOG-inspired downsampling driven by gradient orientation + Bayesian Gaussian Mixture palette; its probabilities allow "gentle" dithering. Good reference for a cheap edge-aware downsample. https://github.com/sedthh/pyxelate (mirror: https://enterprise.gitee.com/sharetech_lee/pyxelate)
- **Pixel-art craft rules**: avoid orphan pixels, doubles (uneven line width), jaggies (inconsistent stair steps). "Adopt Pixels"-style denoise = majority-of-neighbours recolor. https://www.wayline.io/learn/pixel-art/1 · https://astropulse.itch.io/adopt-pixels

## 3. Photo → black & white *stylization* (do this at high res)

- **XDoG** (Winnemöller et al. 2012). DoG + soft threshold; one filter gives line art, woodcut, two-tone shading. Cheap, fully client-side, very tunable. https://users.cs.northwestern.edu/~sco590/winnemoeller-cag2012.pdf
- **Informative Drawings** (Chan, Durand, Isola — MIT, CVPR 2022). Unpaired photo→line drawing with depth + CLIP losses; there is a Gradio demo and the generator is small enough to try in ONNX Runtime Web. https://arxiv.org/abs/2203.12691
- **Unpaired Portrait Drawing** (Yi et al., CVPR 2020) / APDrawingGAN: face-specific B&W drawings with local discriminators on eyes/nose/lips. https://openaccess.thecvf.com/content_CVPR_2020/papers/Yi_Unpaired_Portrait_Drawing_Generation_via_Asymmetric_Cycle_Mapping_CVPR_2020_paper.pdf
- Preprocessing that matters for faces: background removal, edge-preserving smoothing (bilateral / Kuwahara) to kill skin texture, local contrast (CLAHE), channel mix (red channel flattens skin), gamma/levels.

## 4. Binarization options

| Method | Character | Knit suitability |
|---|---|---|
| Global threshold (manual / **Otsu**) | Clean graphic shapes, loses gradients | Best readability, long runs |
| Adaptive (**Sauvola**/Niblack, integral image → O(N)) | Follows local contrast, ignores lighting | Good for faces; can get noisy in flat areas |
| Error diffusion (**Floyd–Steinberg**, **Atkinson**, Jarvis, Stucki, Sierra) | Tone via scattered dots; Atkinson keeps highlights clean (diffuses only 3/4 of error) | Short floats, but "sandy"; Atkinson is the friendliest |
| Ordered (**Bayer**), clustered-dot, blue-noise | Regular texture / halftone look | Bayer reads as a pattern, can be a deliberate aesthetic |
| Hybrid | Threshold/lines on features + dither on gradients via mask | Most promising for portraits |

Refs: https://beyondloom.com/blog/dither.html · https://www.dynamsoft.com/codepool/adaptive-thresholding-javascript.html · Doxa (Otsu/Sauvola, JS bindings) · Dither It (MIT-licensed browser ditherer).

## 5. Knitting constraints (these drive the algorithm)

- **Stitch aspect ratio**: stitches are wider than tall. DK ≈ 22 sts × 30 rows / 4" → 0.73. Stitch Fiddle defaults knitting to 18/24. Kniterate workflow uses ~120% vertical (200 wide → 240 tall). Must be a setting and the editor must draw rectangular cells. https://www.stitchfiddle.com/en/help/1pej-wc93j/import-picture
- **Technique decides what's legal**:
  - *Hand stranded / Fair Isle*: floats ≤ ~5 sts (≈1"/2.5cm); large solid regions are a problem → need a max-run constraint.
  - *Double knitting*: no floats, reversible negative image; each chart cell = a stitch pair.
  - *Intarsia*: no floats but every color block = bobbin → dithering is impossible.
  - *Machine jacquard* (Brother+AYAB, Kniterate, Stoll/Shima): floats handled by backing (birdseye, ladderback, minimal…); birdseye changes row compression.
- **Machine limits**: AYAB on Brother KH-9xx up to ~200 needles wide; Kniterate max 252 sts; image must be 1 px = 1 stitch PNG. https://alessandrina.com/2018/03/31/a-brother-910-ayab-diary/ · https://class.textile-academy.org/2026/annabel-fournier/development/03-Tutorial/
- **knitout-image-processing** (CMU): image → knitout with backing styles default/birdseye/minimal/secure. https://github.com/gabrielle-ohlson/knitout-image-processing
- Kniterate tutorial recommends Dithermark for dithering + GIMP for pixel fixing — exactly the gap this tool fills.

## 6. Browser building blocks

- **MediaPipe Tasks Vision** (WASM, client-side): Image Segmenter (selfie → remove/flatten background), Face Landmarker (478 pts → auto-crop, eye/mouth/brow masks to protect features). https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- **ONNX Runtime Web** for optional ML line-drawing model.
- Canvas 2D for the grid editor; Web Worker for processing so sliders stay live; no server → works on GitHub Pages and keeps photos private.
- OpenCV.js is heavy (multi-MB); most filters here (blur, DoG, Sauvola, dithers, morphology) are small enough to hand-write.

## 6b. Feature-extraction models (browser-capable)

| Model | What it gives | Size | Notes |
|---|---|---|---|
| MediaPipe **Face Landmarker** | 478 3D points: eye/iris, brow, lip, nose, face-oval contours | 3.7 MB | WASM, client-side |
| MediaPipe **Selfie Multiclass** | per-pixel: background / hair / body-skin / face-skin / clothes / accessories | 16 MB | 256×256 input — coarse edges, fine for stitch grids |
| BiSeNet face parsing (CelebAMask-HQ) | 19 classes incl. separate eyes, brows, lips, nose, ears, glasses | ~50 MB fp32 | ONNX via Transformers.js (Xenova) |
| Informative Drawings (MIT) | photo → artistic line drawing | ONNX, not yet sized | optional "line" baseline |

Stylization papers worth porting: Kang et al. **Coherent Line Drawing / FDoG** (edge-tangent-flow lines, much more continuous than plain DoG); Winnemöller et al. 2006 **Real-time video abstraction** (bilateral + luminance quantization + DoG = toon look).

## 6c. Experiments (2026-10-09) — `research/round1`, `research/round2`, scripts in `research/prototype`

Test images: two public-domain US-government portraits, rendered 48 and 96 stitches wide at a 1:1.25 frame.

Round 1 — generic pipelines:
1. **Naive area-downscale + Otsu / Floyd–Steinberg is unusable**: background noise, lighting decides what goes black, FS turns everything to sand.
2. **Background removal (segmentation → white) is the single biggest win.**
3. Bilateral + CLAHE prep then Otsu ("poster") reads well, but eye sockets become black "sunglasses" and smiles become blobs.
4. XDoG→coverage works but lines thicken into blobs at 48 wide.
5. Fixed checkerboard on hair looks mechanical.

Round 2 — region-aware + landmark features:
- **Region-adaptive thresholds** (separate cut for skin, hair, clothes from their own percentiles) keep faces readable on any skin tone and lighting. Trade-off: it normalizes skin tone away — a design decision, not a technical one.
- **Clearing the eye socket and redrawing eyes from landmarks** (lid line + iris) fixes the sunglasses effect and is the biggest "cohesion" gain.
- **"B line portrait"** (skin left open, jaw/face line from landmarks, hair+clothes solid) is the cleanest and most pixel-art-like at 48 wide.
- **Mode-filtering the tone-level map before pattern fill** turns per-pixel noise into coherent pattern zones; still looks mechanical on hair.
- **Atkinson on region-normalized tone + protected features** is the best tonal option at 96 wide.
- Open problem: the mouth. A single lip line loses smiles/teeth; mouth needs its own designed treatment (open/closed detection from inner-lip distance).
- **Size regime matters**: at ~48 wide, features must be *drawn* (designed glyphs); at ~96+ they can be *derived* from tone.

Round 3 — ML line model, Informative Drawings (`research/round3_ml`):
- Two checkpoints, 17.2 MB each (ControlNet "lineart" annotators `sk_model.pth` realistic, `sk_model2.pth` coarse): https://huggingface.co/lllyasviel/Annotators
  - Provenance checked 2026-10-10 by SHA-256: these are the author's own checkpoints from the MIT-licensed https://github.com/carolineec/informative-drawings release — `sk_model.pth` = `anime_style`, `sk_model2.pth` = `opensketch_style`. Details in `MODELS.md`.
- **Realistic lines are too thin** — they break apart when collapsed to stitches.
- **Coarse lines + region fills (hair/clothes thresholded) is the best result so far**: continuous contours, and it captures the smile/mouth that landmark drawing missed. Best at 96; at 48 the mouth shrinks to a dash (line weight should scale with grid size).

Round 4 — U²-Net portrait (APDrawing-trained, **non-commercial**, 176 MB ONNX) (`research/round4_u2net`):
- At 96 wide: expressive eye/smile lines, comparable to ID-coarse; at 48 it collapses into blobs (trained on tight head crops).
- 176 MB is over GitHub's 100 MB per-file limit → must be fetched at runtime from a model host (e.g. Hugging Face) or quantized.
Round 5 — ID-coarse cost vs model input size (`research/round5_speed`; native PyTorch, 4 CPU threads on a Mac laptop; browser WASM will be slower, WebGPU faster):

| Model input | Time | Look at 40 wide | Look at 64 wide |
|---|---|---|---|
| 512×640 | ~2–4 s | thin, smile breaks | best |
| 320×400 | ~1.5 s | **best** (smile reads) | good, slightly heavy |
| 256×320 | ~0.3 s | bold, readable | too heavy (sunglasses again) |

→ **Rule: model input ≈ 6–8 × grid width, clamped 256–768.** This makes line weight scale with the grid and keeps small grids phone-fast.

- Other non-commercial portrait-drawing candidates not yet tested (weights on Google Drive): APDrawingGAN++ (https://github.com/yiranran/APDrawingGAN2), QMUPD 3-style (https://github.com/aawm/QMUPD).

Round 6 — team test portraits, 64 wide (`research/private_round6_team`, git-ignored; photos in `TestPortraits/`, git-ignored):
- **No single preset wins on every face** → the gallery-of-presets UX is justified.
  - Region poster (A) and line portrait (B) are the most robust across all 5.
  - 4-tone patterns (C) render beards/stubble best (as texture).
  - ML lines (I/F) are great for clean-shaven faces and keep glasses, but turn moustache/beard and eye shadow into blobs.
  - Atkinson (D) gets noisy on curly hair.
- **Framing bug**: tightly-cropped photos make the auto-frame run past the image edge; edge-replicate padding creates vertical streaks in the clothes. Fix: pixels outside the source = background class.
- **Glasses are detectable for free**: MediaPipe multiclass "others/accessories" covers 8% and 30% of the eye box in the two glasses photos and 0% in the three without. Rule: accessories > ~3% of eye box → glasses → don't clear eye sockets, draw the accessory mask outline.
- **Hair is the next quality bottleneck**: one hair threshold renders voluminous curly/light hair as a black mass with flecks, losing colour and texture. Hair needs its own density/mode control.
- **Beards** are classified as face-skin; they read OK in A (solid jaw) and C (texture), badly in ML lines.

## 7. Candidate pipeline

1. **Import & frame** — crop/rotate, optional face auto-framing.
2. **Background** — segment person; background → solid color / keep.
3. **Tone prep (hi-res)** — grayscale/channel mix, levels/gamma, CLAHE, edge-preserving smooth.
4. **Stylize (hi-res)** — none / XDoG lines / ML line drawing / two-tone.
5. **Resample to stitch grid** — W stitches, H from photo aspect ÷ stitch aspect; method: area, edge-aware (Kopf/Pyxelate-like), or coverage-of-binary.
6. **Binarize** — threshold / Otsu / Sauvola / dithers / hybrid with feature mask.
7. **Cleanup** — orphan removal, hole fill, line width normalization, optional symmetry, **max-float enforcement**.
8. **Edit live** — pencil/erase/fill/line/mirror, locked feature layer, original overlay, undo/redo.
9. **Preview** — true stitch aspect, "knit" stitch rendering, viewing-distance blur, float heatmap, stats (rows, sts, longest float).
10. **Export** — 1px=1st PNG (AYAB/Kniterate), printable chart (row/col numbers), JSON project.
