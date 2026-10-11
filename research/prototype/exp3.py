"""Round 3: ML portrait line model (Informative Drawings, MIT CVPR'22) -> stitch grid."""
import sys, numpy as np, cv2, torch, torch.nn as nn
from PIL import Image
from exp import *
from exp2 import socket_mask, designed_eyes, region_threshold

N = nn.InstanceNorm2d
class Res(nn.Module):
    def __init__(s, c):
        super().__init__(); s.conv_block = nn.Sequential(nn.ReflectionPad2d(1), nn.Conv2d(c, c, 3), N(c), nn.ReLU(True), nn.ReflectionPad2d(1), nn.Conv2d(c, c, 3), N(c))
    def forward(s, x): return x + s.conv_block(x)
class Gen(nn.Module):
    def __init__(s, nres=3):
        super().__init__()
        s.model0 = nn.Sequential(nn.ReflectionPad2d(3), nn.Conv2d(3, 64, 7), N(64), nn.ReLU(True))
        s.model1 = nn.Sequential(nn.Conv2d(64, 128, 3, 2, 1), N(128), nn.ReLU(True), nn.Conv2d(128, 256, 3, 2, 1), N(256), nn.ReLU(True))
        s.model2 = nn.Sequential(*[Res(256) for _ in range(nres)])
        s.model3 = nn.Sequential(nn.ConvTranspose2d(256, 128, 3, 2, 1, 1), N(128), nn.ReLU(True), nn.ConvTranspose2d(128, 64, 3, 2, 1, 1), N(64), nn.ReLU(True))
        s.model4 = nn.Sequential(nn.ReflectionPad2d(3), nn.Conv2d(64, 1, 7), nn.Sigmoid())
    def forward(s, x): return s.model4(s.model3(s.model2(s.model1(s.model0(x)))))

def lineart(rgb, path):
    g = Gen(); g.load_state_dict(torch.load(path, map_location='cpu')); g.eval()
    with torch.no_grad():
        x = torch.from_numpy(rgb).float().permute(2, 0, 1)[None] / 255
        return g(x)[0, 0].numpy()  # 1 = paper, 0 = ink

def run3(rgb, W, aspect=1.25):
    lm = landmarks(rgb); crop, lmc = frame(rgb, lm, aspect); H = int(W * aspect)
    hi = cv2.resize(crop, (W * 10, H * 10), interpolation=cv2.INTER_AREA)
    lmh = lmc * (hi.shape[1] / crop.shape[1]); sx = W / hi.shape[1]; sy = H / hi.shape[0]
    seg = segment(hi)
    mid = cv2.resize(hi, (512, 640), interpolation=cv2.INTER_AREA)
    segm = cv2.resize(seg, (512, 640), interpolation=cv2.INTER_NEAREST)
    mid_bg = mid.copy(); mid_bg[segm == 0] = 255
    segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST)
    bg, hair, skin, clothes = segs == 0, segs == 1, (segs == 2) | (segs == 3), (segs == 4) | (segs == 5)
    pg = prep(hi, seg); ps = cv2.resize(pg, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    sock = socket_mask(lmh, W, H, sx, sy); eyes = designed_eyes(lmh, W, H, sx, sy)
    brows = poly_mask((H, W), [lmh[LBROW] * [sx, sy], lmh[RBROW] * [sx, sy]])
    sil = outline(bg, W, H) & ~bg
    out = {}
    for name, f in (('real', 'sk_model.pth'), ('coarse', 'sk_model2.pth')):
        la = lineart(mid_bg, M + f)
        ink = 1 - la; ink[segm == 0] = 0
        cov = cv2.resize(ink, (W, H), interpolation=cv2.INTER_AREA)
        t = 0.16 if W < 70 else 0.22
        e = ~clean(cov > t)
        out[f'E ID-{name} lines (pure ML)'] = e
        # hybrid: ML lines on skin + region-poster hair/clothes + drawn eyes/brows
        h = e.copy()
        h[hair] = (ps > region_threshold(ps, hair, 88))[hair]
        h[clothes] = (ps > region_threshold(ps, clothes, 55))[clothes]
        h = clean(h, protect=sock)
        h[sock] = True; h[eyes | brows] = False; h[sil] = False
        out[f'F ID-{name} + regions + eyes'] = h
    Image.fromarray((lineart(mid_bg, M + 'sk_model.pth') * 255).astype(np.uint8)).save(f'out/id_raw_{W}.png')
    return out, crop

if __name__ == '__main__':
    src, W, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rgb = np.array(Image.open(src).convert('RGB'))
    if rgb.shape[1] > 1600:
        f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    res, crop = run3(rgb, W); sheet(res, crop, W, path, cell=max(3, 360 // W)); print('ok', path)
