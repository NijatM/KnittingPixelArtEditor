# Models

Every model file shipped in `public/models/`, where it comes from, and its license.

## Informative Drawings — `opensketch_style` (preset E · ML lines)

| | |
|---|---|
| Paper | Chan, Durand, Isola — *Learning to generate line drawings that convey geometry and semantics*, CVPR 2022 |
| Source | Author's release: https://github.com/carolineec/informative-drawings → `model.zip` (Google Drive link in its README) → `model/opensketch_style/netG_A_latest.pth` |
| License | **MIT**, Copyright (c) 2022 Caroline Chan — same text in the source repo and in ControlNet's `annotator/lineart/LICENSE` |
| Training drawings | OpenSketch dataset (Gryaditskaya et al. 2019), distributed under **CC0** |
| SHA-256 (.pth) | `30a534781061f34e83bb9406b4335da4ff2616c95d22a585c1245aa8363e74e0` |
| Shipped as | ONNX converted from the .pth (conversion is a modification, which MIT allows) |
| Obligation | Keep the MIT copyright + permission notice next to the ONNX file (e.g. `public/models/informative-drawings/LICENSE`) |

Provenance check (2026-10-10): ControlNet's "lineart" annotators on `huggingface.co/lllyasviel/Annotators` (tagged only "License: other") are byte-identical re-uploads of the author's checkpoints — `sk_model2.pth` ("coarse", used in the experiments) = `opensketch_style`, `sk_model.pth` ("realistic") = `anime_style` (`c686ced2…0d90f0c6`). We take the file from the author's release, so the mirror's unclear tag doesn't apply.

## MediaPipe — Face Landmarker + Selfie Multiclass segmentation (face points, regions, glasses cue)

Shipped in `public/models/mediapipe/` with the Apache 2.0 text as `LICENSE` next to them. Checked 2026-10-11 against Google's model cards.

| File | Source | License | SHA-256 |
|---|---|---|---|
| `face_landmarker.task` (3.8 MB; bundles BlazeFace short-range, Face Mesh V2, Blendshapes V2) | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task | Apache 2.0 (all three model cards) | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `selfie_multiclass_256x256.tflite` (16.4 MB) | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite | Apache 2.0 (model card "Multiclass Segmentation", May 2023) | `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0` |

Model cards: `https://storage.googleapis.com/mediapipe-assets/` → *Model Card MediaPipe Face Mesh V2.pdf*, *MediaPipe BlazeFace Model Card (Short Range).pdf*, *Model Card Blendshape V2.pdf*, *Model Card Multiclass Segmentation.pdf*. Their out-of-scope uses are surveillance, identity recognition and life-critical decisions — stylising a portrait on the person's own device is within intended use.

Runtime: `@mediapipe/tasks-vision` (npm, Apache 2.0); its WASM files are copied from `node_modules` into `public/mediapipe/wasm/` at dev/build time (`scripts/copy-mediapipe-wasm.mjs`), so nothing loads from a CDN.

## Other third-party code and assets

| What | License |
|---|---|
| IBM Plex Mono via `@fontsource/ibm-plex-mono` (bundled, self-hosted) | SIL Open Font License 1.1 |
| Vite (build) · TypeScript (build) | MIT · Apache 2.0 |
