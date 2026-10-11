"""Round 5: cost of ID-coarse vs input resolution, and quality at small grids."""
import time, numpy as np, cv2, torch
from PIL import Image
from exp import *
from exp2 import socket_mask, designed_eyes, region_threshold
from exp3 import Gen
torch.set_num_threads(4)
g = Gen(); g.load_state_dict(torch.load(M + 'sk_model2.pth', map_location='cpu')); g.eval()
def la(rgb):
    with torch.no_grad(): return g(torch.from_numpy(rgb).float().permute(2, 0, 1)[None] / 255)[0, 0].numpy()
for name, src in (('astronaut', 'astronaut.png'), ('obama', 'obama.jpg')):
    rgb = np.array(Image.open(src).convert('RGB'))
    if rgb.shape[1] > 1600: f = 1600 / rgb.shape[1]; rgb = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    lm = landmarks(rgb); crop, lmc = frame(rgb, lm, 1.25)
    res = {}
    for W in (40, 64):
        H = int(W * 1.25); hi = cv2.resize(crop, (W * 10, H * 10), interpolation=cv2.INTER_AREA); seg = segment(hi)
        segs = cv2.resize(seg, (W, H), interpolation=cv2.INTER_NEAREST); bg = segs == 0
        ps = cv2.resize(prep(hi, seg), (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
        for ins in (512, 320, 256):
            mid = cv2.resize(hi, (ins, int(ins * 1.25)), interpolation=cv2.INTER_AREA)
            sm = cv2.resize(seg, (ins, int(ins * 1.25)), interpolation=cv2.INTER_NEAREST); mid[sm == 0] = 255
            t0 = time.time(); ink = 1 - la(mid); dt = time.time() - t0; ink[sm == 0] = 0
            e = ~clean(cv2.resize(ink, (W, H), interpolation=cv2.INTER_AREA) > 0.16)
            for reg, q in ((segs == 1, 88), ((segs == 4) | (segs == 5), 55)):
                e[reg] = (ps > region_threshold(ps, reg, q))[reg]
            e = clean(e); e[outline(bg, W, H) & ~bg] = False
            res[f'W{W} in{ins} ({dt:.1f}s cpu)'] = e
            print(name, W, ins, f'{dt:.2f}s')
    # sheet expects equal sizes; render two rows separately
    for W in (40, 64):
        sub = {k: v for k, v in res.items() if k.startswith(f'W{W} ')}
        sheet(sub, crop, W, f'out/v5_{name}_{W}.png', cell=max(3, 300 // W))
