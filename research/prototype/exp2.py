"""Round 2: region-aware poster / pattern pipelines with feature override."""
import sys, numpy as np, cv2
from PIL import Image
from scipy import ndimage
from exp import *

def mode_filter(lvl, k, size=3):
    """Majority vote of tone levels -> cohesive pattern zones instead of per-pixel noise."""
    votes = np.stack([ndimage.uniform_filter((lvl == i).astype(np.float32), size) for i in range(k)])
    return votes.argmax(0)

def socket_mask(lm, W, H, sx, sy, grow=1.35):
    """Eye socket polygon (eye contour scaled up around its center)."""
    out = []
    for idx in (LEYE, REYE):
        p = lm[idx] * [sx, sy]; c = p.mean(0); out.append(c + (p - c) * [grow, grow * 1.6])
    return poly_mask((H, W), out)

def designed_eyes(lm, W, H, sx, sy):
    s = np.array([sx, sy]); f = np.zeros((H, W), bool)
    f |= poly_mask((H, W), [lm[LLID] * s, lm[RLID] * s], close=False, width=1)
    for c in (468, 473):
        x, y = lm[c] * s; r = max(np.linalg.norm(lm[c + 1] - lm[c + 3]) * sx / 2, 0.5)
        yy, xx = np.mgrid[:H, :W]; f |= (xx + .5 - x) ** 2 + (yy + .5 - y) ** 2 <= max(r, 0.75) ** 2
    return f

def region_threshold(tone, region, q):
    v = tone[region]; return np.percentile(v, q) if v.size else 128

def run2(rgb, W, aspect=1.25):
    lm = landmarks(rgb); crop, lmc = frame(rgb, lm, aspect); H = int(W * aspect)
    hi = cv2.resize(crop, (W * 10, H * 10), interpolation=cv2.INTER_AREA)
    lmh = lmc * (hi.shape[1] / crop.shape[1]); sx = W / hi.shape[1]; sy = H / hi.shape[0]
    seg = segment(hi); pg = prep(hi, seg)
    ps = cv2.resize(pg, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST)
    bg, hair, skin, clothes = segs == 0, segs == 1, (segs == 2) | (segs == 3), (segs == 4) | (segs == 5)
    person = ~bg
    sock = socket_mask(lmh, W, H, sx, sy); eyes = designed_eyes(lmh, W, H, sx, sy)
    brows = poly_mask((H, W), [lmh[LBROW] * [sx, sy], lmh[RBROW] * [sx, sy]])
    mouth = poly_mask((H, W), [lmh[MOUTH_LINE] * [sx, sy]], close=False, width=1)
    nose = np.zeros((H, W), bool)
    for a, b in NOSTRILS:
        x, y = (lmh[a] * 0.6 + lmh[b] * 0.4) * [sx, sy]; nose[int(y), int(x)] = True
    feats = eyes | brows | mouth | nose
    sil = outline(bg, W, H) & person
    out = {}

    # A: region-adaptive poster. Each region gets its own threshold (skin percentile => fair to any skin tone)
    a = np.ones((H, W), bool)
    a[skin] = (ps > region_threshold(ps, skin, 22))[skin]
    a[hair] = (ps > region_threshold(ps, hair, 88))[hair]
    a[clothes] = (ps > region_threshold(ps, clothes, 55))[clothes]
    a = clean(a, protect=feats | sock)
    a[sock] = True; a[feats] = False; a[sil] = False
    out['A region poster + drawn feats'] = a

    # B: A but lines only where regions meet (face oval/jaw) — lighter, more "drawn"
    b = a.copy(); jaw = poly_mask((H, W), [lmh[JAW] * [sx, sy]], close=False, width=1)
    b[skin & ~(ps < region_threshold(ps, skin, 8))] = True
    b[jaw & skin] = False; b[sock] = True; b[feats] = False; b[sil] = False
    out['B line portrait (skin open)'] = b

    # C: 4 tone levels per region, mode-filtered, fixed patterns (white/25/50/black)
    t = ps.copy(); k = 4
    for reg, lo_hi in ((skin, (3, 70)), (hair, (2, 98)), (clothes, (2, 90))):
        if reg.any():
            lo, hi_ = np.percentile(ps[reg], lo_hi); t[reg] = np.clip((ps[reg] - lo) / max(hi_ - lo, 1), 0, 1) * 255
    lvl = np.round(t / 255 * (k - 1)).astype(int); lvl[bg] = k - 1
    lvl = mode_filter(lvl, k, 3)
    pat = [np.zeros((H, W), bool), ordered(np.full((H, W), 64.0), B2), ordered(np.full((H, W), 128.0), B2), np.ones((H, W), bool)]
    c = np.ones((H, W), bool)
    for i in range(k): c[lvl == i] = pat[i][lvl == i]
    c[sock] = True; c[feats] = False; c[sil] = False
    out['C 4-tone patterns + drawn feats'] = c

    # D: Atkinson on region-normalized tone, features protected (tonal but faces stay readable)
    d = error_diffuse(np.where(bg, 255, t), ATK); d[sock] = True; d[feats] = False; d[sil] = False
    out['D Atkinson region-norm + feats'] = d
    return out, crop

if __name__ == '__main__':
    src, W, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rgb = np.array(Image.open(src).convert('RGB'))
    if rgb.shape[1] > 1600:
        f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    res, crop = run2(rgb, W); sheet(res, crop, W, path, cell=max(3, 360 // W)); print('ok', path)
