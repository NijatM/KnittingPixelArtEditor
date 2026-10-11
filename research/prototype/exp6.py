"""Round 6: best pipelines on the team's own test portraits (private)."""
import sys, glob, os, numpy as np, cv2
from PIL import Image, ImageOps
from exp import *
from exp2 import run2, socket_mask, designed_eyes, region_threshold
from exp3 import lineart

def run6(rgb, W, aspect=1.25):
    res, crop = run2(rgb, W, aspect)
    out = {k: v for k, v in res.items() if not k.startswith('B')}
    out['B line portrait'] = res['B line portrait (skin open)']
    lm = landmarks(rgb); crop, lmc = frame(rgb, lm, aspect); H = int(W * aspect)
    hi = cv2.resize(crop, (W * 10, H * 10), interpolation=cv2.INTER_AREA)
    lmh = lmc * (hi.shape[1] / crop.shape[1]); sx = W / hi.shape[1]; sy = H / hi.shape[0]
    seg = segment(hi); segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST)
    bg, hair, clothes = segs == 0, segs == 1, (segs == 4) | (segs == 5)
    ps = cv2.resize(prep(hi, seg), (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    ins = int(np.clip(round(W * 7 / 32) * 32, 256, 768))
    mid = cv2.resize(hi, (ins, int(ins * aspect)), interpolation=cv2.INTER_AREA)
    sm = cv2.resize(seg, (ins, int(ins * aspect)), interpolation=cv2.INTER_NEAREST); mid[sm == 0] = 255
    ink = 1 - lineart(mid, M + 'sk_model2.pth'); ink[sm == 0] = 0
    e = ~clean(cv2.resize(ink, (W, H), interpolation=cv2.INTER_AREA) > 0.16)
    e[hair] = (ps > region_threshold(ps, hair, 88))[hair]
    e[clothes] = (ps > region_threshold(ps, clothes, 55))[clothes]
    e = clean(e); e[outline(bg, W, H) & ~bg] = False
    out['I ML lines + regions'] = e
    f = e.copy(); sock = socket_mask(lmh, W, H, sx, sy)
    f[sock] = True; f[designed_eyes(lmh, W, H, sx, sy)] = False
    f[poly_mask((H, W), [lmh[LBROW] * [sx, sy], lmh[RBROW] * [sx, sy]])] = False
    out['F ML lines + drawn eyes'] = f
    return out, crop

if __name__ == '__main__':
    W = int(sys.argv[1]); os.makedirs('out/r6', exist_ok=True)
    for src in sorted(glob.glob(sys.argv[2] + '/*.[jp]*g')):
        rgb = np.array(ImageOps.exif_transpose(Image.open(src)).convert('RGB'))
        if rgb.shape[1] > 1600:
            f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        try:
            res, crop = run6(rgb, W)
            name = os.path.splitext(os.path.basename(src))[0]
            sheet(res, crop, W, f'out/r6/{name}_{W}.png', cell=5); print('ok', name)
        except Exception as ex:
            print('FAIL', src, type(ex).__name__, ex)
