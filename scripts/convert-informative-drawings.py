"""Convert Informative Drawings `opensketch_style` (Chan, Durand, Isola, CVPR 2022, MIT) to ONNX for style E.

Source: https://github.com/carolineec/informative-drawings → model.zip (Google Drive link in its README)
        → model/opensketch_style/netG_A_latest.pth
Needs torch, onnx, onnxruntime.   python scripts/convert-informative-drawings.py <netG_A_latest.pth>
Writes public/models/informative-drawings/opensketch_style.onnx (input "image" [1,3,H,W] RGB 0..1, H and W
multiples of 4; output "lines" [1,1,H,W], 1 = paper, 0 = ink).
"""
import hashlib, sys
import numpy as np, torch, torch.nn as nn, onnxruntime as ort

SHA256 = '30a534781061f34e83bb9406b4335da4ff2616c95d22a585c1245aa8363e74e0'  # see MODELS.md
OUT = 'public/models/informative-drawings/opensketch_style.onnx'

N = nn.InstanceNorm2d


class Res(nn.Module):
    def __init__(s, c):
        super().__init__()
        s.conv_block = nn.Sequential(nn.ReflectionPad2d(1), nn.Conv2d(c, c, 3), N(c), nn.ReLU(True),
                                     nn.ReflectionPad2d(1), nn.Conv2d(c, c, 3), N(c))

    def forward(s, x): return x + s.conv_block(x)


class Generator(nn.Module):  # same layout as the authors' model.py, 3 residual blocks
    def __init__(s, nres=3):
        super().__init__()
        s.model0 = nn.Sequential(nn.ReflectionPad2d(3), nn.Conv2d(3, 64, 7), N(64), nn.ReLU(True))
        s.model1 = nn.Sequential(nn.Conv2d(64, 128, 3, 2, 1), N(128), nn.ReLU(True),
                                 nn.Conv2d(128, 256, 3, 2, 1), N(256), nn.ReLU(True))
        s.model2 = nn.Sequential(*[Res(256) for _ in range(nres)])
        s.model3 = nn.Sequential(nn.ConvTranspose2d(256, 128, 3, 2, 1, 1), N(128), nn.ReLU(True),
                                 nn.ConvTranspose2d(128, 64, 3, 2, 1, 1), N(64), nn.ReLU(True))
        s.model4 = nn.Sequential(nn.ReflectionPad2d(3), nn.Conv2d(64, 1, 7), nn.Sigmoid())

    def forward(s, x): return s.model4(s.model3(s.model2(s.model1(s.model0(x)))))


path = sys.argv[1]
digest = hashlib.sha256(open(path, 'rb').read()).hexdigest()
assert digest == SHA256, f'unexpected checkpoint {digest}'
g = Generator()
g.load_state_dict(torch.load(path, map_location='cpu'))
g.eval()

torch.onnx.export(g, torch.rand(1, 3, 320, 256), OUT, input_names=['image'], output_names=['lines'],
                  dynamic_axes={'image': {2: 'h', 3: 'w'}, 'lines': {2: 'h', 3: 'w'}}, opset_version=17, dynamo=False)

sess = ort.InferenceSession(OUT, providers=['CPUExecutionProvider'])
for h, w in ((320, 256), (560, 448), (960, 768)):
    x = torch.rand(1, 3, h, w)
    with torch.no_grad():
        ref = g(x).numpy()
    got = sess.run(None, {'image': x.numpy()})[0]
    print(f'{w}x{h}: max |onnx - torch| = {np.abs(got - ref).max():.2e}')
print('wrote', OUT)
