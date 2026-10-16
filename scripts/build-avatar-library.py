"""Build the clean avatar library from the team's 40 approved characters (each drawn at six sizes).

    python scripts/build-avatar-library.py <portrait-40-multi-resolution folder>

The source folder stays outside the repo. This writes, under public/avatars/:
  <nickname>/<size>.png   the character as drawn, 1-bit, at 25, 50, 72, 80, 96 and 128 px
  library-<size>.json     every character cut into parts: one label per pixel, part anchors, tags
  manifest.json           nicknames, names, tags and hair measures (the same at every size)

Cutting happens at 128 px, where the parts are drawn apart; the smaller sizes are reductions of the same artwork,
so each of their pixels takes the label of the 128 px pixels it covers (weighted: thin lines win).
Needs numpy, scipy and Pillow.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

SIZES = [25, 50, 72, 80, 96, 128]
OUT = 'public/avatars'
# Pixel labels. Paper: 0 outside the face, 8 inside it. Ink: 1 head (hair, outline, ears, neck, clothes) outside
# the face, 9 head inside it, 2..7 the swappable parts, 10 a beard or chin goatee drawn into the jaw: part of its own
# head (the jaw line was never drawn under it), and a part other heads can wear.
PAPER, HEAD, BROWS, EYES, GLASSES, NOSE, MOUTH, FACIAL, FACE, HEAD_IN, BEARD = range(11)

# number → nickname (short, from the team's labels)
NICK = ['sidepart', 'bob', 'flame', 'waves', 'buzzbeard', 'pixie', 'centrepart', 'fringe', 'curls', 'curlybob',
        'baldstache', 'closecrop', 'shag', 'roundwaves', 'tightcurls', 'bun', 'tiedback', 'longcurls', 'pompadour',
        'asymbob', 'quiff', 'ponytail', 'braid', 'afro', 'curtains', 'twinbraids', 'crewcut', 'bluntbob', 'receding',
        'sidebraid', 'flattop', 'curlycateye', 'locs', 'shaved', 'aviator', 'sweptpixie', 'topknot', 'buns',
        'longbeard', 'sidefringe']
# Facial hair drawn into the head (beards and chin goatees join the jaw line, so they stay with the hair).
HEAD_BEARD = {5: 'beard', 17: 'beard', 29: 'beard', 39: 'beard', 15: 'goatee', 37: 'goatee'}
# Where a beard ends when the rule (the first paper below the mouth, down the middle) runs into the shirt.
BEARD_BOTTOM = {29: 96}
# Hand corrections at 128 px where the rules misread the drawing: (label, x0, y0, x1, y1), inclusive.
FIX = {
    4: [(EYES, 75, 61, 81, 63), (EYES, 84, 61, 87, 61)],   # the right eye's lashes run into the hair
    6: [(GLASSES, 38, 61, 52, 61), (GLASSES, 76, 61, 94, 61)],  # cat-eye frames: thick top, not brows
    17: [(FACIAL, 50, 68, 82, 80)],                      # the moustache hides the mouth
    40: [(HEAD, 46, 42, 52, 45)],                        # a strand of the fringe over the glasses
}
# Eyes drawn closed or relaxed (smiling arcs, flat dashes); read off the drawings, since they are as thick as open ones.
EYES_CLOSED = {2, 7, 9, 11, 12, 16, 22, 26, 29, 34, 39}
FACE_BOX = {21: (47, 62, 81, 94)}  # silver hair is paper inside its outline: parts only in this box

N4 = nd.generate_binary_structure(2, 1)
N8 = nd.generate_binary_structure(2, 2)


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r + 0.5


def box(m):
    ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max(), ys.max()


def piece(m):
    x0, y0, x1, y1 = box(m)
    return dict(m=m, x0=x0, y0=y0, x1=x1, y1=y1, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, w=x1 - x0 + 1, h=y1 - y0 + 1,
                n=int(m.sum()))


def pieces(m):
    lab, n = nd.label(m, N8)
    return [piece(lab == k) for k in range(1, n + 1)]


def face_region(I):
    """F: the face — the paper pieces inside it (forehead, cheeks, lenses), closed over the thin lines between them."""
    h, w = I.shape
    lab, n = nd.label(~I, N4)
    border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    idx = range(1, n + 1)
    sizes = np.array(nd.sum(np.ones_like(lab), lab, idx))
    cm = nd.center_of_mass(np.ones_like(lab), lab, idx)
    cand = [k for k in idx if k not in border and 0.3 < cm[k - 1][1] / w < 0.7 and 0.25 < cm[k - 1][0] / h < 0.8]
    S = lab == max(cand, key=lambda k: sizes[k - 1])
    r1, r2 = max(2, round(3 * w / 128)), max(3, round(5 * w / 128))
    others = [k for k in idx if k not in border and not S[lab == k].any() and sizes[k - 1] >= 0.002 * h * w]
    grown = True
    while grown:  # add touching pieces; big ones (forehead, scalp) also across thick brows
        grown = False
        xs = np.nonzero(S)[1]
        D1, D2 = nd.binary_dilation(S, disk(r1)), nd.binary_dilation(S, disk(r2))
        for k in list(others):
            P = lab == k
            if not xs.min() <= cm[k - 1][1] <= xs.max():
                continue
            if (nd.binary_dilation(P, disk(r1)) & D1).any() or \
                    (sizes[k - 1] >= 0.012 * h * w and (nd.binary_dilation(P, disk(r2)) & D2).any()):
                S |= P
                others.remove(k)
                grown = True
    return nd.binary_fill_holes(nd.binary_closing(S, disk(max(1, round(3 * w / 128)))))


def rows_of(side):
    """Side pieces grouped into rows that overlap vertically."""
    rows = []
    for c in sorted(side, key=lambda c: c['y0']):
        if rows and c['y0'] <= rows[-1]['y1'] + 1:
            rows[-1]['cs'].append(c)
            rows[-1]['y1'] = max(rows[-1]['y1'], c['y1'])
        else:
            rows.append(dict(y0=c['y0'], y1=c['y1'], cs=[c]))
    return rows


def label128(I, num):
    h, w = I.shape
    F = face_region(I)
    if num in FACE_BOX:
        x0, y0, x1, y1 = FACE_BOX[num]
        keep = np.zeros_like(F)
        keep[y0:y1 + 1, x0:x1 + 1] = True
        feat_area = F & keep
    else:
        feat_area = F
    ys, xs = np.nonzero(F)
    cx, fw = (xs.min() + xs.max()) / 2, xs.max() - xs.min() + 1
    feat = I & feat_area
    L = np.where(I, HEAD, PAPER).astype(np.uint8)
    edge = nd.binary_dilation(~F, N8)
    info = [c for c in pieces(feat) if c['n'] >= 2]

    # Glasses: two paper pieces side by side, each ringed mostly by drawn lines (the rims).
    pl, pn = nd.label(~I & F, N4)
    lenses = []
    for k in range(1, pn + 1):
        c = piece(pl == k)
        if c['n'] < 0.03 * fw * fw or abs(c['cx'] - cx) < 0.08 * fw or c['w'] < 0.14 * fw:
            continue
        ring = nd.binary_dilation(c['m'], N8) & ~c['m']
        if (ring & feat).sum() >= 0.6 * ring.sum():
            lenses.append(c)
    pairs = [(l, r) for l in lenses for r in lenses if l['cx'] < cx < r['cx'] and abs(l['cy'] - r['cy']) < 0.08 * fw
             and max(l['n'], r['n']) < 2 * min(l['n'], r['n']) and abs((l['cx'] + r['cx']) / 2 - cx) < 0.1 * fw]
    eye_y = None
    if pairs:
        l, r = max(pairs, key=lambda p: p[0]['n'] + p[1]['n'])
        eye_y = (l['cy'] + r['cy']) / 2
        lf = nd.binary_fill_holes(l['m']) | nd.binary_fill_holes(r['m'])
        rims = nd.binary_dilation(lf, N8) & ~lf & feat
        G = np.zeros_like(I)
        rest = []
        for c in info:
            if (c['m'] & rims).any():
                G |= c['m']
            elif (c['m'] & lf).sum() > 0.5 * c['n']:
                L[c['m']] = EYES
            else:
                rest.append(c)
        info = rest
        # Brows resting on the rims: what lies above the top rim, which is as thick as the bottom rim.
        thick = []
        for c in (l, r):
            x = int(round(c['cx']))
            y, t = c['y1'] + 1, 0
            while y < h and I[y, x] and t < 4:
                y, t = y + 1, t + 1
            thick.append(t)
        rim = max(1, min(thick))
        top = min(l['y0'], r['y0'])
        B = G.copy()
        B[top - rim:] = False
        G[:top - rim] = False
        for c in pieces(B):
            if c['w'] >= 0.12 * fw:
                L[c['m']] = BROWS
            else:
                G |= c['m']
        L[G] = GLASSES

    if eye_y is None:  # the lowest row of free-standing side pieces on both sides, in the upper face
        ytop, ybot = ys.min(), ys.max()
        rows = rows_of([c for c in info if abs(c['cx'] - cx) > 0.12 * fw and c['w'] < 0.4 * fw
                        and not (c['m'] & edge).any() and c['cy'] < ytop + 0.6 * (ybot - ytop)])
        both = [r for r in rows if any(c['cx'] < cx for c in r['cs']) and any(c['cx'] > cx for c in r['cs'])]
        eye_y = np.mean([c['cy'] for c in both[-1]['cs']]) if both else \
            (rows[-1]['y0'] + rows[-1]['y1']) / 2 if rows else h * 0.45

    # Pieces touching the face edge are hair or outline, unless they sit where brows, eyes or the mouth go.
    rest = []
    for c in info:
        if (c['m'] & edge).any():
            side = abs(c['cx'] - cx) > 0.12 * fw
            brow = side and c['w'] >= 2.2 * c['h'] and eye_y - 0.4 * fw < c['cy'] < eye_y - 0.04 * fw
            eye = side and abs(c['cy'] - eye_y) < 0.1 * fw and c['w'] < 0.4 * fw
            low = eye_y + 0.1 * fw < c['cy'] < eye_y + 0.5 * fw and not side and c['w'] < 0.5 * fw
            if not (brow or eye or low):
                L[c['m']] = HEAD
                continue
        rest.append(c)
    info = rest

    for r in rows_of([c for c in info if abs(c['cx'] - cx) > 0.12 * fw]):
        lab = BROWS if r['y1'] < eye_y - 0.04 * fw else EYES if abs((r['y0'] + r['y1']) / 2 - eye_y) < 0.12 * fw \
            else HEAD
        for c in r['cs']:
            L[c['m']] = lab
    # Down the middle: nose, moustache, mouth, chin tuft. The mouth is the lowest wide, thin (or open) piece.
    mid = sorted([c for c in info if abs(c['cx'] - cx) <= 0.12 * fw], key=lambda c: c['cy'])
    for c in mid:
        if c['cy'] <= eye_y:
            L[c['m']] = NOSE if c['cy'] > eye_y - 0.05 * fw else HEAD
    mid = [c for c in mid if c['cy'] > eye_y]
    fill = lambda c: c['n'] / (c['w'] * c['h'])
    wide = [c for c in mid if c['w'] >= 0.15 * fw and c['w'] >= 1.8 * c['h'] and (c['h'] <= 0.08 * fw or fill(c) < 0.45)]
    mouth = wide[-1] if wide else (mid[-1] if mid else None)
    for c in mid:
        if c is mouth:
            L[c['m']] = MOUTH
        elif mouth is not None and c['cy'] > mouth['cy']:
            L[c['m']] = FACIAL
        elif c['w'] >= 0.25 * fw or (c['w'] >= 0.15 * fw and fill(c) >= 0.45):
            L[c['m']] = FACIAL
        else:
            L[c['m']] = NOSE

    for lab, x0, y0, x1, y1 in FIX.get(num, []):
        sub = L[y0:y1 + 1, x0:x1 + 1]
        sub[sub != PAPER] = lab
    L[(L == PAPER) & F] = FACE
    L[(L == HEAD) & F] = HEAD_IN
    if num in HEAD_BEARD:
        L[beard(L, num)] = BEARD
    return L


# Vote weight per label when reducing: paper, head, brows, eyes, glasses, nose, mouth, facial, face, head in face.
WEIGHT = np.array([0, 1, 1.5, 1, 3, 2, 1.5, 1, 0, 0, 1])


def beard(L, num):
    """The solid beard (or chin goatee) of a head that has one: thick head ink below the nose, around the chin."""
    a = anchors(L)
    ax, d, ny, my = a['axis'], a['d'], a['nose'][1], a['mouth'][1]
    ey = (a['eyes'][0][1] + a['eyes'][1][1]) / 2
    s = L.shape[0]
    Y, X = np.mgrid[0:s, 0:s]
    ink = (L == HEAD) | (L == HEAD_IN)
    row = np.nonzero((L >= 2)[int(round(ey))])[0]
    half = max(row.max() - ax, ax - row.min()) + 0.06 * d
    if HEAD_BEARD[num] == 'goatee':
        half = 0.35 * d  # the tuft only, not the jaw lines beside it
    y, c = int(my + 0.3 * d), int(round(ax))
    while y < s and ink[y, c - 1:c + 2].any():
        y += 1
    bottom = BEARD_BOTTOM.get(num, min(int(my + 1.8 * d), y - 1))
    zone = (Y > ny + 0.2 * d) & (np.abs(X - ax) <= half) & (Y <= bottom)
    core = nd.binary_opening(ink & zone, disk(2))  # thin lines (neck, jaw) drop out
    lab, n = nd.label(core, N8)
    keep = np.zeros_like(core)
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if ys.max() > my and abs(xs.mean() - ax) < 0.6 * d:
            keep |= lab == k
    return nd.binary_dilation(keep, N8) & ink & zone


def transfer(L128, I):
    """Labels at a smaller size: each pixel takes the label most (weighted) of the 128 px pixels under it have."""
    s = I.shape[0]
    f = 128 / s
    L = np.zeros((s, s), np.uint8)
    ink128 = (L128 != PAPER) & (L128 != FACE)
    face128 = (L128 >= 2) & (L128 != BEARD)  # every part label is inside the face
    for y in range(s):
        for x in range(s):
            for grow in (0, 1, 2):
                y0, y1 = max(0, int(y * f) - grow), min(128, int(np.ceil((y + 1) * f)) + grow)
                x0, x1 = max(0, int(x * f) - grow), min(128, int(np.ceil((x + 1) * f)) + grow)
                win = L128[y0:y1, x0:x1]
                inside = face128[y0:y1, x0:x1].mean() >= 0.5
                if not I[y, x]:
                    L[y, x] = FACE if inside else PAPER
                    break
                ink = win[ink128[y0:y1, x0:x1]]
                if len(ink):
                    counts = np.bincount(ink, minlength=11).astype(float)
                    counts[HEAD] += counts[HEAD_IN]
                    counts[HEAD_IN] = 0
                    counts *= WEIGHT  # thin lines (rims, brows, mouth) outvote what they touch, or they break up
                    best = int(np.argmax(counts))
                    if counts[best] == counts[HEAD]:
                        best = HEAD  # ties stay with the head
                    L[y, x] = (HEAD_IN if inside else HEAD) if best == HEAD else best
                    break
            else:
                L[y, x] = HEAD_IN if inside else HEAD
    return L


def centre(m):
    x0, y0, x1, y1 = box(m)
    return [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]


def anchors(L, ref=None):
    """Where the parts sit: eye centres, nose, mouth (bounding-box middles, so symmetric parts stay centred).
    A part lost in the reduction to a small size sits where it does at 128 px (ref), scaled."""
    s = L.shape[0]
    k = s / 128
    scaled = lambda p: [round((p[0] + 0.5) * k - 0.5, 1), round((p[1] + 0.5) * k - 0.5, 1)]
    F = (L >= 2) & (L != BEARD)
    xs = np.nonzero(F)[1]
    axis = (xs.min() + xs.max()) / 2
    E = L == EYES
    cols = np.arange(s)[None, :]
    l, r = E & (cols < axis), E & (cols >= axis)
    eyes = [centre(l) if l.any() else None, centre(r) if r.any() else None]
    if eyes[0] is None and eyes[1] is None:
        eyes = [scaled(ref['eyes'][0]), scaled(ref['eyes'][1])]
    if eyes[0] is None:
        eyes[0] = [round(2 * axis - eyes[1][0], 1), eyes[1][1]]
    if eyes[1] is None:
        eyes[1] = [round(2 * axis - eyes[0][0], 1), eyes[0][1]]
    axis = (eyes[0][0] + eyes[1][0]) / 2
    d = eyes[1][0] - eyes[0][0]
    ey = (eyes[0][1] + eyes[1][1]) / 2
    mouth = centre(L == MOUTH) if (L == MOUTH).any() else scaled(ref['mouth']) if ref else None
    if mouth is None:
        fy = box(L == FACIAL)[3] if (L == FACIAL).any() else ey + 0.9 * d
        mouth = [round(axis, 1), round(fy + 1, 1)]
    nose = centre(L == NOSE) if (L == NOSE).any() else scaled(ref['nose']) if ref else \
        [round(axis, 1), round(ey + 0.55 * (mouth[1] - ey), 1)]
    return dict(eyes=eyes, nose=nose, mouth=mouth, axis=round(axis, 1), d=round(d, 1))


def tags(L, num):
    """What the photo is matched on: glasses and their shape, facial hair, eyes, mouth."""
    t = {}
    G = L == GLASSES
    if G.any():  # lens shape: the paper (and eyes) ringed mostly by the frame
        lab, n = nd.label((L == FACE) | (L == EYES), N4)
        ps = []
        for k in range(1, n + 1):
            P = lab == k
            ring = nd.binary_dilation(P, N8) & ~P
            if P.sum() >= 6 and (ring & G).sum() >= 0.5 * ring.sum():
                ps.append(piece(P))
        ps = sorted(ps, key=lambda c: -c['n'])[:2]
        if ps:
            fill = float(np.mean([c['n'] / (c['w'] * c['h']) for c in ps]))
            t['glasses'] = dict(shape='square' if fill >= 0.92 else 'round',
                                aspect=round(float(np.mean([c['w'] / c['h'] for c in ps])), 2))
    t['facial'] = HEAD_BEARD.get(num, 'goatee' if num == 3 else 'moustache' if (L == FACIAL).any() else 'none')
    t['headFacial'] = HEAD_BEARD.get(num, 'none')  # drawn into the head: stays whatever parts are picked
    t['eyes'] = 'closed' if num in EYES_CLOSED else 'open'
    M = L == MOUTH
    if M.any():
        hole = (nd.binary_fill_holes(M) & ~M).sum() >= 3
        x0, y0, x1, y1 = box(M)
        t['mouth'] = 'grin' if hole else 'smile'
    else:
        t['mouth'] = 'hidden'
    return t


def hair(L):
    """Hair measures at 128 px, in eye distances from the middle of the eyes (matched against the photo's)."""
    a = anchors(L)
    d, ax, ey, my = a['d'], a['axis'], (a['eyes'][0][1] + a['eyes'][1][1]) / 2, a['mouth'][1]
    ink = (L != PAPER) & (L != FACE)
    F = (L >= 2) & (L != BEARD)
    s = L.shape[0]
    Y, X = np.mgrid[0:s, 0:s]
    central = np.abs(X - ax) < 0.6 * d
    top = (ey - Y[ink & central].min()) / d
    band = ink & (np.abs(Y - ey) <= 0.2 * d)
    width = (X[band].max() - X[band].min() + 1) / d
    region = nd.binary_fill_holes(nd.binary_closing(ink | F, disk(2))) & ~F & (Y < ey)
    vol = region.sum() / d ** 2
    dens = (ink & region).sum() / max(1, region.sum())
    side = (np.abs(X - ax) >= 0.95 * d) & (np.abs(X - ax) <= 1.6 * d) & (Y >= my - 0.2 * d) & (Y <= my + 0.8 * d)
    length = (ink & side).sum() / max(1, side.sum())
    cf = F & (np.abs(X - ax) <= 0.25 * d)
    hairline = (ey - Y[cf].min()) / d
    lm, rm = (region & (X < ax)).sum(), (region & (X >= ax)).sum()
    asym = (rm - lm) / max(1, lm + rm)
    r = lambda v: round(float(v), 3)
    return dict(top=r(top), width=r(width), volume=r(vol), density=r(dens), length=r(length), hairline=r(hairline),
                asym=r(asym))


def rle(L):
    flat, out, i = L.ravel(), [], 0
    while i < len(flat):
        j = i
        while j < len(flat) and flat[j] == flat[i]:
            j += 1
        out.append(chr(97 + int(flat[i])) + (str(j - i) if j - i > 1 else ''))
        i = j
    return ''.join(out)


def main(src):
    man = json.load(open(os.path.join(src, 'manifest.json')))
    os.makedirs(OUT, exist_ok=True)
    libs = {s: [] for s in SIZES}
    chars = []
    for o in man['options']:
        num = int(o['number'])
        nick = NICK[num - 1]
        load = lambda s: np.array(Image.open(os.path.join(src, o['pixels'][str(s)])).convert('L')) < 128
        L128 = label128(load(128), num)
        t, hm = tags(L128, num), hair(L128)
        chars.append(dict(number=num, nick=nick, name=o['label'], tags=t, hair=hm))
        os.makedirs(os.path.join(OUT, nick), exist_ok=True)
        for s in SIZES:
            I = load(s)
            Image.fromarray(np.where(I, 0, 255).astype(np.uint8)).convert('1').save(os.path.join(OUT, nick, f'{s}.png'))
            L = L128 if s == 128 else transfer(L128, I)
            assert (((L != PAPER) & (L != FACE)) == I).all()
            libs[s].append(dict(nick=nick, labels=rle(L), at=anchors(L, anchors(L128))))
        print(f'{num:02d} {nick:12s}', t, hm)
    for s in SIZES:
        json.dump(dict(size=s, chars=libs[s]), open(os.path.join(OUT, f'library-{s}.json'), 'w'), separators=(',', ':'))
    json.dump(dict(sizes=SIZES, labels=['paper', 'head', 'brows', 'eyes', 'glasses', 'nose', 'mouth', 'facial',
                                        'face', 'head-in-face', 'beard'], chars=chars),
              open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1])
