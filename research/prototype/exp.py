"""Compare photo -> binary pixel-portrait pipelines. Research prototype only."""
import sys, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

M = 'models/'
LEYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
REYE = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
LLID = [33, 246, 161, 160, 159, 158, 157, 173, 133]
RLID = [263, 466, 388, 387, 386, 385, 384, 398, 362]
LBROW = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70]
RBROW = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300]
LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
MOUTH_LINE = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
        152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
JAW = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234]
NOSTRILS = [(98, 2), (327, 2)]


def landmarks(rgb):
    det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=M + 'face_landmarker.task'), num_faces=1))
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    h, w = rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in r.face_landmarks[0]])


def segment(rgb):
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=M + 'selfie_multiclass.tflite'), output_category_mask=True))
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    return np.squeeze(r.category_mask.numpy_view()).copy()  # 0 bg,1 hair,2 body,3 face,4 clothes,5 other


def frame(rgb, lm, aspect):
    """Head-and-shoulders crop around the face; aspect = H/W."""
    x0, y0 = lm[OVAL].min(0); x1, y1 = lm[OVAL].max(0)
    fw, fh = x1 - x0, y1 - y0
    cx = (x0 + x1) / 2
    W = fw * 2.3; H = W * aspect
    top = y0 - fh * 0.55
    box = np.array([cx - W / 2, top, cx + W / 2, top + H])
    h, w = rgb.shape[:2]
    pad = int(max(0, -box[0], -box[1], box[2] - w, box[3] - h)) + 2
    big = cv2.copyMakeBorder(rgb, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    b = (box + pad).astype(int)
    return big[b[1]:b[3], b[0]:b[2]], lm - [box[0], box[1]]


# ---------- binarizers ----------
def otsu(g):
    t, _ = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU); return (g > t)


def error_diffuse(g, kernel):
    f = g.astype(np.float32) / 255; h, w = f.shape; out = np.zeros_like(f, bool)
    for y in range(h):
        for x in range(w):
            o = f[y, x] >= 0.5; out[y, x] = o; e = f[y, x] - o
            for dx, dy, wgt in kernel:
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h: f[yy, xx] += e * wgt
    return out

FS = [(1, 0, 7/16), (-1, 1, 3/16), (0, 1, 5/16), (1, 1, 1/16)]
ATK = [(1, 0, 1/8), (2, 0, 1/8), (-1, 1, 1/8), (0, 1, 1/8), (1, 1, 1/8), (0, 2, 1/8)]
B4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32
B2 = np.array([[0, 2], [3, 1]]) / 4 + 1 / 8


def ordered(g, B):
    h, w = g.shape; t = np.tile(B, (h // len(B) + 1, w // len(B) + 1))[:h, :w]
    return g / 255 > t


def levels(g, k=5):
    """Quantize to k tones and fill each with a fixed 2x2 pattern (0/25/50/75/100%)."""
    q = np.round(g / 255 * (k - 1)) / (k - 1)
    return ordered(q * 255, B2)


def clean(b, protect=None, passes=2):
    """Remove orphans: flip pixels that disagree with >=7 of 8 neighbours."""
    b = b.copy()
    for _ in range(passes):
        n = cv2.filter2D(b.astype(np.float32), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_REPLICATE) - b
        flip = (b & (n <= 1)) | (~b & (n >= 7))
        if protect is not None: flip &= ~protect
        b ^= flip
    return b


# ---------- hi-res prep ----------
def prep(rgb, seg=None, bg_white=True):
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    g = cv2.bilateralFilter(g, 9, 40, 9)
    g = cv2.createCLAHE(2.0, (8, 8)).apply(g)
    if seg is not None and bg_white: g[seg == 0] = 255
    return g


def xdog(g, sigma=1.2, k=1.6, p=20, eps=0.6, phi=12):
    f = g.astype(np.float32) / 255
    a = cv2.GaussianBlur(f, (0, 0), sigma); b = cv2.GaussianBlur(f, (0, 0), sigma * k)
    d = (1 + p) * a - p * b
    return np.where(d >= eps, 1, 1 + np.tanh(phi * (d - eps)))


def coverage_down(white, W, H, ink=0.3):
    """Cell black if >= ink fraction of its area is black."""
    black = 1 - cv2.resize(white.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA)
    return black < ink


def poly_mask(shape, pts_list, close=True, width=0):
    im = Image.new('L', (shape[1], shape[0]), 0); d = ImageDraw.Draw(im)
    for pts in pts_list:
        p = [tuple(x) for x in pts]
        if close: d.polygon(p, fill=255)
        else: d.line(p, fill=255, width=width, joint='curve')
    return np.array(im) > 0


def feature_layer(lm, W, H, sx, sy, iris=True):
    """Rasterize features straight onto the stitch grid (black=True)."""
    s = np.array([sx, sy]); g = lambda idx: lm[idx] * s
    f = np.zeros((H, W), bool)
    f |= poly_mask((H, W), [g(LBROW), g(RBROW)])
    f |= poly_mask((H, W), [g(LLID), g(RLID)], close=False, width=1)
    if iris and len(lm) > 470:
        for c in (468, 473):
            x, y = lm[c] * s; f[int(np.clip(y, 0, H - 1)), int(np.clip(x, 0, W - 1))] = True
            r = np.linalg.norm(lm[c + 1] - lm[c + 3]) * sx / 2
            if r > 0.9: f |= poly_mask((H, W), [[(x + r * np.cos(t), y + r * np.sin(t)) for t in np.linspace(0, 6.28, 12)]])
    f |= poly_mask((H, W), [g(MOUTH_LINE)], close=False, width=1)
    for a, b in NOSTRILS:
        x, y = (lm[a] * 0.6 + lm[b] * 0.4) * s; f[int(y), int(x)] = True
    return f


def outline(region, W, H):
    k = np.ones((3, 3), np.uint8)
    r = region.astype(np.uint8)
    return (cv2.dilate(r, k) - r).astype(bool)


# ---------- pipelines (True = white) ----------
def run(rgb, W, aspect=1.25):
    lm = landmarks(rgb)
    crop, lmc = frame(rgb, lm, aspect)
    hi = cv2.resize(crop, (W * 10, int(W * aspect) * 10), interpolation=cv2.INTER_AREA)
    lmh = lmc * (hi.shape[1] / crop.shape[1])
    H = int(W * aspect)
    seg = segment(hi)
    gray = cv2.cvtColor(hi, cv2.COLOR_RGB2GRAY)
    small = cv2.resize(gray, (W, H), interpolation=cv2.INTER_AREA)
    pg = prep(hi, seg)
    psmall = cv2.resize(pg, (W, H), interpolation=cv2.INTER_AREA)
    segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST)
    sx = W / hi.shape[1]; sy = H / hi.shape[0]
    feats = feature_layer(lmh, W, H, sx, sy)
    out = {}
    out['1 naive: area+Otsu'] = otsu(small)
    out['2 naive: Floyd-Steinberg'] = error_diffuse(small, FS)
    out['3 prep+Atkinson'] = error_diffuse(psmall, ATK)
    out['4 prep+Bayer4'] = ordered(psmall, B4)
    out['5 poster: prep+Otsu+clean'] = clean(otsu(psmall))
    xd = xdog(pg)
    out['6 XDoG lines->coverage'] = clean(coverage_down(xd > 0.5, W, H, ink=0.22))

    # 7 semantic hybrid: regions get rules, features drawn from landmarks
    face = (segs == 3) | (segs == 2)
    tone = psmall.astype(np.float32)
    fz = tone[face]
    if fz.size:  # normalize skin so its median sits light, shadows go to patterns
        lo, md = np.percentile(fz, 5), np.percentile(fz, 50)
        tone[face] = np.clip(255 * (0.82 + 0.82 * (tone[face] - md) / max(md - lo, 1)), 0, 255)
    h7 = levels(tone, 5)
    h7[segs == 0] = True                       # background white
    h7[segs == 1] = ordered(np.clip(psmall * 0.5, 0, 255), B2)[segs == 1]  # hair: dark w/ highlights
    h7[segs == 4] = levels(np.clip(psmall * 0.7, 0, 255), 3)[segs == 4]    # clothes darker
    h7[feats] = False
    person = segs != 0
    h7[outline(~person, W, H) & person] = False  # silhouette outline
    jaw = poly_mask((H, W), [lmh[JAW] * [sx, sy]], close=False, width=1)
    h7[jaw & face] = False
    out['7 semantic hybrid'] = h7

    # 8 poster + landmark features (graphic, no dithering)
    p8 = clean(otsu(psmall) | (segs == 0), protect=feats)
    p8[feats] = False
    p8[outline(~person, W, H) & person] = False
    out['8 poster + landmark feats'] = p8
    return out, crop


def sheet(results, crop, W, path, cell=6):
    H = next(iter(results.values())).shape[0]
    tiles = []
    ref = Image.fromarray(crop).resize((W * cell, H * cell))
    tiles.append(('0 source crop', ref))
    for k, v in results.items():
        im = Image.fromarray((v * 255).astype(np.uint8)).resize((W * cell, H * cell), Image.NEAREST)
        tiles.append((k, im))
    cols = 3; rows = (len(tiles) + cols - 1) // cols; tw, th = W * cell, H * cell + 22
    S = Image.new('RGB', (cols * (tw + 10) + 10, rows * (th + 10) + 10), (200, 60, 60))
    d = ImageDraw.Draw(S)
    try: font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 15)
    except Exception: font = None
    for i, (name, im) in enumerate(tiles):
        x = 10 + (i % cols) * (tw + 10); y = 10 + (i // cols) * (th + 10)
        S.paste(im.convert('RGB'), (x, y + 22)); d.text((x, y + 2), name, fill='white', font=font)
    S.save(path)


if __name__ == '__main__':
    src, W, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rgb = np.array(Image.open(src).convert('RGB'))
    if rgb.shape[1] > 1600:
        f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    res, crop = run(rgb, W)
    sheet(res, crop, W, path, cell=max(3, 360 // W))
    print('ok', path)
