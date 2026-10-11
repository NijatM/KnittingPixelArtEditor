"""Round 4: U2-Net portrait (APDrawing-trained, non-commercial) vs Informative-Drawings coarse."""
import sys, numpy as np, cv2, onnxruntime as ort
from PIL import Image
from exp import *
from exp2 import socket_mask, designed_eyes, region_threshold
from exp3 import lineart

def u2portrait(rgb):
    s = ort.InferenceSession(M + 'u2net_portrait.onnx'); inp = s.get_inputs()[0]
    h, w = rgb.shape[:2]; n = max(h, w)
    sq = np.full((n, n, 3), 255, np.uint8); sq[(n - h) // 2:(n - h) // 2 + h, (n - w) // 2:(n - w) // 2 + w] = rgb
    x = cv2.resize(sq, (512, 512), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    d1 = s.run(None, {inp.name: x})[0][0, 0]
    d1 = (d1 - d1.min()) / (d1.max() - d1.min() + 1e-8)  # ink prob
    d1 = cv2.resize(d1, (n, n)); return d1[(n - h) // 2:(n - h) // 2 + h, (n - w) // 2:(n - w) // 2 + w]

def run4(rgb, W, aspect=1.25):
    lm = landmarks(rgb); crop, lmc = frame(rgb, lm, aspect); H = int(W * aspect)
    hi = cv2.resize(crop, (W * 10, H * 10), interpolation=cv2.INTER_AREA)
    lmh = lmc * (hi.shape[1] / crop.shape[1]); sx = W / hi.shape[1]; sy = H / hi.shape[0]
    seg = segment(hi)
    mid = cv2.resize(hi, (512, 640), interpolation=cv2.INTER_AREA)
    segm = cv2.resize(seg, (512, 640), interpolation=cv2.INTER_NEAREST); mid[segm == 0] = 255
    segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST)
    bg, hair, clothes = segs == 0, segs == 1, (segs == 4) | (segs == 5)
    pg = prep(hi, seg); ps = cv2.resize(pg, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    sock = socket_mask(lmh, W, H, sx, sy); eyes = designed_eyes(lmh, W, H, sx, sy)
    brows = poly_mask((H, W), [lmh[LBROW] * [sx, sy], lmh[RBROW] * [sx, sy]])
    sil = outline(bg, W, H) & ~bg
    t = 0.16 if W < 70 else 0.22
    out = {}
    def hybrid(e, eyes_on=True):
        h = e.copy()
        h[hair] = (ps > region_threshold(ps, hair, 88))[hair]
        h[clothes] = (ps > region_threshold(ps, clothes, 55))[clothes]
        h = clean(h, protect=sock if eyes_on else None)
        if eyes_on: h[sock] = True; h[eyes | brows] = False
        h[sil] = False; return h
    u = u2portrait(mid); u[segm == 0] = 0
    ucov = cv2.resize(u, (W, H), interpolation=cv2.INTER_AREA)
    ue = ~clean(ucov > t + 0.08)
    out['G U2Net-portrait (pure ML)'] = ue
    out['H U2Net + regions (model eyes)'] = hybrid(ue, eyes_on=False)
    ink = 1 - lineart(mid, M + 'sk_model2.pth'); ink[segm == 0] = 0
    ie = ~clean(cv2.resize(ink, (W, H), interpolation=cv2.INTER_AREA) > t)
    out['F ID-coarse + regions + eyes'] = hybrid(ie)
    out['I ID-coarse + regions (model eyes)'] = hybrid(ie, eyes_on=False)
    Image.fromarray(((1 - u) * 255).astype(np.uint8)).save(f'out/u2_raw_{W}.png')
    return out, crop

if __name__ == '__main__':
    src, W, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rgb = np.array(Image.open(src).convert('RGB'))
    if rgb.shape[1] > 1600:
        f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    res, crop = run4(rgb, W); sheet(res, crop, W, path, cell=max(3, 360 // W)); print('ok', path)
