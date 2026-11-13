#!/usr/bin/env python3
"""Recreation of the "Parchai" kinetic-lyric edit (square 720x720, 27.4 s).

Every shot is a small function of time: picture + camera move + effects +
kinetic text.  Pictures are our own drawings in img/, the audio comes from
source.mp4 (not committed).

    ../lyric-video/.venv/bin/python make_parchai.py            # full render
    ../lyric-video/.venv/bin/python make_parchai.py --sheet    # contact sheets only
"""
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lyric-video"))
from make_video import GLYPHS  # noqa: E402  (HarfBuzz + FreeType text)

W = H = 720
FPS = 30
DUR = 27.37
FONTS = HERE.parent / "lyric-video" / "fonts"
BOLD, MED, CAPS, DEVA = (FONTS / "Poppins-Bold.ttf", FONTS / "Poppins-Medium.ttf",
                         FONTS / "Anton-Regular.ttf", FONTS / "Kalam-Bold.ttf")
SCRIPT = HERE / "fonts" / "Yellowtail.ttf"

WHITE, BLACK, YELLOW = (255, 255, 255), (20, 20, 20), (255, 222, 30)
MAROON, BLUE, RED = (92, 26, 30), (26, 60, 235), (226, 40, 40)
RNG = np.random.default_rng(4)


# ---------------------------------------------------------------- helpers
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def sm(p):
    p = clamp(p)
    return p * p * (3 - 2 * p)


def eo(p):
    return 1 - (1 - clamp(p)) ** 3


def lerp(a, b, p):
    return a + (b - a) * p


def seg(t, a, b):
    return clamp((t - a) / (b - a))


def load(name, crop=0.0):
    img = cv2.cvtColor(cv2.imread(str(HERE / "img" / name)), cv2.COLOR_BGR2RGB)
    if crop:
        h, w = img.shape[:2]
        c = int(w * crop)
        img = cv2.resize(img[c:h - c, c:w - c], (w, h), interpolation=cv2.INTER_LANCZOS4)
    return img


def view(img, cx, cy, z, rot=0.0):
    """Camera: look at (cx, cy) of the picture with zoom z."""
    k = img.shape[1] / (W * z)
    c, s = math.cos(math.radians(rot)) * k, math.sin(math.radians(rot)) * k
    iw, ih = img.shape[1], img.shape[0]
    M = np.array([[c, -s, cx * iw - c * W / 2 + s * H / 2],
                  [s, c, cy * ih - s * W / 2 - c * H / 2]], np.float32)
    out = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                         borderMode=cv2.BORDER_REFLECT)
    return out.astype(np.float32)


def gblur(fr, s):
    return cv2.GaussianBlur(fr, (0, 0), s) if s > 0.4 else fr


def hblur(fr, k):
    k = int(k) | 1
    return cv2.blur(fr, (k, 1), borderType=cv2.BORDER_REFLECT) if k > 1 else fr


def tint(fr, color, a):
    return fr + (np.array(color, np.float32) - fr) * a if a > 0.003 else fr


def zoom(fr, z, cx=0.5, cy=0.5):
    if abs(z - 1) < 1e-3:
        return fr
    M = np.array([[z, 0, cx * W * (1 - z)], [0, z, cy * H * (1 - z)]], np.float32)
    return cv2.warpAffine(fr, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def comp(fr, layer, x, y, color, a=1.0, add=False):
    """Blend a float mask `layer` (0..1) in `color` at (x, y)."""
    x, y = int(round(x)), int(round(y))
    h, w = layer.shape
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    m = layer[y0 - y:y1 - y, x0 - x:x1 - x, None] * a
    reg = fr[y0:y1, x0:x1]
    col = np.array(color, np.float32)
    if add:
        reg += col * m
    else:
        reg += (col - reg) * m


_cache = {}


def tmask(s, font, px):
    px = max(6, int(round(px)))
    key = (s, str(font), px)
    if key not in _cache:
        m, _x0, y0, _adv = GLYPHS.render(s, font, px)
        _cache[key] = (m.astype(np.float32) / 255.0, y0)
    return _cache[key]


def twidth(s, font, px):
    return tmask(s, font, px)[0].shape[1]


def text(fr, s, font, px, x, yb, color, a=1.0, blur=0.0, hb=0, glow=0.0, box=None,
         pad=0.2, rot=0.0, anchor="l", shear=0.0, wipe=1.0):
    """Draw a word. (x, yb) = left end of the baseline. Returns its width."""
    m, y0 = tmask(s, font, px)
    h, w = m.shape
    if a <= 0.01:
        return w
    if wipe < 1:
        m = m.copy()
        m[:, int(w * clamp(wipe)):] = 0
    P = int(px * pad) + int(blur * 3) + int(hb) + int(glow * 3) + int(abs(shear) * h) + 3
    layer = np.zeros((h + 2 * P, w + 2 * P), np.float32)
    layer[P:P + h, P:P + w] = m
    bx = None
    if box is not None:
        bp = int(px * pad)
        bx = np.zeros_like(layer)
        bx[P - bp:P + h + bp, P - bp:P + w + bp] = 1
    if shear:
        M = np.float32([[1, -shear, shear * (h / 2 + P)], [0, 1, 0]])
        layer = cv2.warpAffine(layer, M, (layer.shape[1], layer.shape[0]))
    if anchor == "c":
        x -= w / 2
    elif anchor == "r":
        x -= w
    ox, oy = x - P, yb + y0 - P

    def fx(L):
        if blur > 0.3:
            L = cv2.GaussianBlur(L, (0, 0), blur)
        if hb > 1:
            L = cv2.blur(L, (int(hb) | 1, 1))
        if rot:
            hh, ww = L.shape
            M = cv2.getRotationMatrix2D((ww / 2, hh / 2), rot, 1.0)
            L = cv2.warpAffine(L, M, (ww, hh))
        return L

    if bx is not None:
        comp(fr, fx(bx), ox, oy, box, a)
    if glow:
        comp(fr, fx(cv2.GaussianBlur(layer, (0, 0), glow)), ox, oy, color, a * 0.85, add=True)
    comp(fr, fx(layer), ox, oy, color, a)
    return w


def words(fr, items, font, px, x, yb, t, gap=0.28, **kw):
    """items = [(word, time, color)]; words pop in one after another on a line."""
    for wd, t0, col in items:
        a = seg(t, t0, t0 + 0.12)
        w = text(fr, wd, font, px, x, yb, col, a=a, blur=(1 - a) * px * 0.08, **kw)
        x += w + px * gap
    return x


def whip(a, b, p, direction=1):
    """Horizontal whip-pan from frame a to frame b (direction 1 = b enters from the left)."""
    e = sm(sm(p))
    off = int(round(e * W)) * direction
    out = np.empty_like(a)
    if direction > 0:
        out[:, off:] = a[:, :W - off]
        out[:, :off] = b[:, W - off:]
    else:
        out[:, :W + off] = a[:, -off:]
        out[:, W + off:] = b[:, :-off] if off else b[:, :0]
    return hblur(out, math.sin(math.pi * p) * 150)


# ---------------------------------------------------------------- assets
WALL = load("wall.png", 0.06)
FOOT = load("foot.png", 0.05)
COUPLE = load("couple.png")
EYE = load("eye.png")
WOMAN = load("woman.png")
BED = load("bed.png")
BEDCLOSE = load("bedclose.png")
HAND = load("hand.png")
REALEYE = load("realeye.png")
_f = cv2.cvtColor(load("fall.png"), cv2.COLOR_RGB2GRAY)
FALL = cv2.GaussianBlur((_f < 128).astype(np.float32), (0, 0), 1.0)


def _noise(sigma, size=1024):
    n = cv2.GaussianBlur(RNG.random((size, size)).astype(np.float32), (0, 0), sigma)
    return (n - n.min()) / (n.max() - n.min())


_n1, _n2 = _noise(60), _noise(9)
SKY = (np.array((112, 176, 226), np.float32)
       + (np.array((205, 230, 246), np.float32) - np.array((112, 176, 226), np.float32)) * (_n1 ** 1.4)[..., None]
       + (_n2[..., None] - 0.5) * 26)
SKY = np.clip(SKY, 0, 255).astype(np.uint8)
INK = _noise(22, 720)
GRAIN = [RNG.normal(0, 3.2, (H, W, 1)).astype(np.float32) for _ in range(6)]
_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.30 * np.clip(np.hypot((_xx - W / 2) / (W / 2), (_yy - H / 2) / (H / 2)) - 0.45, 0, 1) ** 1.5)[..., None]
LEAK = np.zeros((H, W, 3), np.float32)
for (lx, ly, lr, col) in ((0.95, 0.15, 260, (255, 120, 60)), (0.80, 0.30, 200, (90, 160, 255)), (0.05, 0.95, 240, (255, 200, 90))):
    g = np.exp(-(((_xx - lx * W) ** 2 + (_yy - ly * H) ** 2) / (2 * lr * lr)))
    LEAK += g[..., None] * np.array(col, np.float32)


def blob(r):
    yy, xx = np.mgrid[-r:r, -r:r].astype(np.float32)
    return np.clip(1 - np.hypot(xx, yy) / r, 0, 1) ** 0.8


CLOUD = np.zeros((260, 520), np.float32)
for (bx_, by_, br_) in ((110, 150, 100), (220, 120, 115), (330, 140, 105), (420, 165, 85), (170, 185, 75), (290, 190, 70)):
    b = blob(br_)
    v = CLOUD[by_ - br_:by_ + br_, bx_ - br_:bx_ + br_]
    np.maximum(v, b, out=v)
CLOUD = cv2.GaussianBlur(np.clip(CLOUD * 1.8, 0, 1), (0, 0), 10)


def cloud(fr, x, y, s=1.0, a=1.0):
    c = cv2.resize(CLOUD, None, fx=s, fy=s) if s != 1.0 else CLOUD
    comp(fr, c, x * W - c.shape[1] / 2, y * H - c.shape[0] / 2, (255, 255, 255), a)


def disc_logo(fr, cx, cy, r, blur=0.0, rot=-12):
    """Green music-app style disc with three sound arcs."""
    S = int(r * 2 + 8)
    disc = np.zeros((S, S), np.float32)
    arcs = np.zeros((S, S), np.float32)
    c = S // 2
    cv2.circle(disc, (c, c), int(r), 1.0, -1, cv2.LINE_AA)
    for i, (rr, th) in enumerate(((0.62, 0.13), (0.47, 0.11), (0.33, 0.09))):
        cv2.ellipse(arcs, (c, int(c + r * (0.55 + 0.05 * i))), (int(r * rr * 1.25), int(r * rr)), rot, 215, 325,
                    1.0, max(2, int(r * th)), cv2.LINE_AA)
    if blur:
        disc, arcs = cv2.GaussianBlur(disc, (0, 0), blur), cv2.GaussianBlur(arcs, (0, 0), blur)
    comp(fr, disc, cx * W - c, cy * H - c, (40, 215, 100))
    comp(fr, arcs * disc, cx * W - c, cy * H - c, (14, 40, 22))


# ---------------------------------------------------------------- shots
def s1_wall(t):
    """0.0-2.3  blurred wall, huge white words rushing past, then the anklet foot whips in."""
    z = lerp(1.35, 1.15, sm(t / 1.6))
    fr = gblur(view(WALL, 0.5, 0.5, z), lerp(7, 3, sm(t / 1.2)))
    fr = tint(fr, (120, 96, 70), 0.34 * (1 - seg(t, 1.45, 1.6)))
    px = 150
    scroll = lerp(170, -330, sm(seg(t, 0.25, 1.55)))
    speed = math.sin(math.pi * seg(t, 0.25, 1.55))
    hb = int(speed * 26)
    out = 1 - seg(t, 1.45, 1.62)
    for (line, yb, x0) in ((((("Teri", 0.2), ("chham", 0.45))), 330, 0), (((("chham", 0.78), ("karti", 1.2))), 480, -10)):
        x = scroll + x0
        for wd, t0 in line:
            a = seg(t, t0, t0 + 0.14) * out
            text(fr, wd, BOLD, px, x + 5, yb + 7, (70, 52, 36), a=a * 0.45, blur=7, hb=hb)
            w = text(fr, wd, BOLD, px, x, yb, WHITE, a=a, blur=(1 - a) * 10, hb=hb)
            x += w + 44
    if t > 1.45:
        b = s1_foot(t)
        p = seg(t, 1.45, 1.75)
        fr = whip(fr, b, p, 1) if p < 1 else b
    return fr


def s1_foot(t):
    fr = view(FOOT, lerp(0.47, 0.5, sm(seg(t, 1.45, 4.0))), 0.5, lerp(1.22, 1.08, sm(seg(t, 1.45, 3.0))),
              rot=lerp(-3, 0, sm(seg(t, 1.45, 2.4))))
    a = seg(t, 1.6, 1.8) * 0.85
    text(fr, "chham karti", MED, 30, W * 0.5, H * 0.56, WHITE, a=a, anchor="c")
    return fr


def s2_green(t):
    """2.3-4.2  the picture shrinks into a card on a green music-app screen."""
    card = s1_foot(t)
    p = eo(seg(t, 2.3, 2.75))
    sc = lerp(1.0, 0.60, p)
    rot = math.sin((t - 2.3) * 2.4) * 2.5 * p
    cx, cy = W * 0.5 + math.sin(t * 1.7) * 6 * p, lerp(H * 0.5, H * 0.40, p)
    fr = np.empty((H, W, 3), np.float32)
    fr[:] = np.array((26, 168, 84), np.float32)
    fr += (_yy[..., None] / H - 0.5) * -34
    disc_logo(fr, lerp(-0.25, 0.10, p), lerp(-0.2, 0.09, p), 150, blur=2.5)
    disc_logo(fr, lerp(1.3, 0.97, p), lerp(1.3, 0.93, p), 190, blur=5, rot=-20)
    M = cv2.getRotationMatrix2D((W / 2, H / 2), rot, sc)
    M[0, 2] += cx - W / 2
    M[1, 2] += cy - H / 2
    cw = cv2.warpAffine(card, M, (W, H), flags=cv2.INTER_LINEAR)
    am = cv2.warpAffine(np.ones((H, W), np.float32), M, (W, H), flags=cv2.INTER_LINEAR)
    sh = cv2.GaussianBlur(am, (0, 0), 14)
    fr *= 1 - 0.35 * np.roll(sh, 10, axis=0)[..., None] * p
    fr = fr * (1 - am[..., None]) + cw * am[..., None]
    words(fr, [("Sun", 2.45, WHITE), ("kahin", 2.68, WHITE), ("jhoom", 2.92, WHITE), ("naa", 3.2, WHITE)],
          MED, 34, W * 0.12, H * 0.775, t)
    a = seg(t, 3.38, 3.52)
    text(fr, "jaaoon", BOLD, lerp(96, 78, eo(a)), W * 0.11, H * 0.895, WHITE, a=a, shear=0.18, blur=(1 - a) * 6)
    q = sm(seg(t, 3.65, 4.2))
    if q > 0:
        fr = hblur(zoom(fr, 1 + 0.75 * q, 0.22, 0.86), q * 30)
    return fr


def s3_couple(t):
    """4.33-8.73  blue sky couple: close on him, close on her, then the wide with every label."""
    lab = 62
    if t < 5.5:                                   # close on the man
        p = seg(t, 4.33, 5.5)
        fr = view(COUPLE, lerp(0.40, 0.385, p), 0.64, lerp(2.5, 2.75, p))
        cloud(fr, 0.2, 0.98, 1.3)
        cloud(fr, 0.95, 0.12, 0.9, 0.9)
        a = seg(t, 4.7, 4.8)
        text(fr, "Jo", BOLD, lab, W * 0.13, H * 0.56, WHITE, a=a, box=MAROON, blur=(1 - a) * 8)
        a = seg(t, 4.95, 5.05)
        text(fr, "Dekhen", BOLD, lab + 10, lerp(-40, 8, eo(a)), H * 0.75, WHITE, a=a, box=BLUE,
             hb=int((1 - a) * 40) + (22 if t > 5.3 else 0))
        if t > 5.3:
            fr = hblur(fr, seg(t, 5.3, 5.5) * 60)
        return fr
    if t < 6.4:                                   # close on the woman
        p = seg(t, 5.5, 6.4)
        fr = view(COUPLE, lerp(0.655, 0.67, p), 0.66, lerp(2.9, 2.6, p))
        cloud(fr, 0.75, 1.0, 1.4)
        cloud(fr, 0.1, 0.1, 1.0, 0.9)
        text(fr, "Jo", BOLD, lab, -W * 0.06, H * 0.52, WHITE, box=MAROON)
        a = seg(t, 5.72, 5.82)
        text(fr, "Mujhko", BOLD, 40, W * 0.60, H * 0.44, WHITE, a=a, box=MAROON, blur=(1 - a) * 6)
        a = seg(t, 6.0, 6.14)
        text(fr, "Aise", BOLD, lab + 14, W * 0.50, H * 0.64, WHITE, a=a, box=BLUE, blur=(1 - a) * 12)
        fr = hblur(fr, (1 - seg(t, 5.5, 5.62)) * 60)
        return fr
    p = eo(seg(t, 6.4, 6.95))                     # pull back to the wide
    q = seg(t, 6.95, 8.73)
    z = lerp(2.6, 1.42, p) - 0.06 * q
    fr = view(COUPLE, lerp(0.67, 0.5, p), lerp(0.66, 0.60, p), z)
    k = z / 1.42
    cloud(fr, 0.08 - 0.02 * q, 0.80, 1.0)
    cloud(fr, 0.62 + 0.02 * q, 0.84, 1.15)
    cloud(fr, 0.98, 0.70, 0.8, 0.9)

    def at(ix, iy):                               # picture coords -> screen
        return (W / 2 + (ix - lerp(0.67, 0.5, p)) * W * z, H / 2 + (iy - lerp(0.66, 0.60, p)) * H * z)

    for wd, (ix, iy), px, bg in (("Jo", (0.345, 0.515), 44, MAROON), ("Dekhen", (0.255, 0.60), 34, BLUE),
                                 ("Mujhko", (0.66, 0.50), 30, MAROON), ("Aise", (0.665, 0.59), 38, BLUE)):
        x, y = at(ix, iy)
        text(fr, wd, BOLD, px * k, x, y, WHITE, box=bg, anchor="c")
    a = seg(t, 6.75, 6.9)
    text(fr, "Sab kahin", BOLD, 46, W * 0.02, H * 0.115, (88, 88, 96), a=a, blur=(1 - a) * 6)
    a = seg(t, 7.05, 7.2)
    text(fr, "bhul naa jaaye", MED, 27, W * 0.03, H * 0.165, (60, 60, 70), a=a)
    fr = gblur(fr, (1 - seg(t, 6.4, 6.7)) * 6)
    return fr


def s4_eye(t):
    """8.87-13.13  dark; an eye seen through a slit, colour flashes, glowing words."""
    beat = max(seg(t, 9.78, 9.8) * (1 - seg(t, 9.8, 10.0)), 0)
    open_ = max(sm(seg(t, 9.75, 9.9)) * (1 - sm(seg(t, 11.3, 11.5))), sm(seg(t, 12.2, 12.4)))
    z = lerp(1.25, 1.75, open_) + 0.05 * math.sin(t * 2.2)
    cx = 0.60 + 0.02 * math.sin(t * 1.3)
    fr = view(EYE, cx, lerp(0.585, 0.50, open_), z, rot=math.sin(t * 1.9) * 1.2)
    # slit / letterbox
    half = lerp(0.14, 0.75, open_)
    mid = lerp(0.39, 0.5, open_)
    band = np.clip((half - np.abs(_yy / H - mid)) / 0.07, 0, 1)[..., None]
    fr = fr * band * lerp(0.8, 1.0, open_)
    # colour flashes
    fr = tint(fr, (255, 150, 235), 0.55 * (1 - seg(t, 9.8, 10.05)) * (t >= 9.8))
    fr = tint(fr, (150, 220, 120), 0.45 * (1 - seg(t, 10.1, 10.3)) * (t >= 10.1))
    fr = tint(fr, (255, 190, 150), 0.6 * (1 - seg(t, 11.7, 11.95)) * (t >= 11.7))
    fr = tint(fr, (255, 170, 235), 0.5 * (1 - seg(t, 12.75, 13.0)) * (t >= 12.75))
    # "Aankhen teri"
    big = sm(seg(t, 9.75, 9.9))
    out = 1 - seg(t, 10.55, 10.7)
    px = lerp(28, 72, big)
    x = lerp(W * 0.10, -W * 0.20, big) - seg(t, 9.9, 10.7) * 90
    yb = lerp(H * 0.30, H * 0.20, big)
    a = seg(t, 9.0, 9.1) * out
    w = text(fr, "Aankhen", BOLD, px, x, yb, WHITE, a=a, glow=4 * big)
    a = seg(t, 9.3, 9.4) * out
    text(fr, "teri", BOLD, px, x + w + px * 0.25, yb, YELLOW, a=a, glow=4 * big)
    # "Par aansoo mein" (script)
    o2 = 1 - seg(t, 11.25, 11.45)
    sx = W * 0.30 - seg(t, 10.2, 11.3) * W * 0.34
    a = seg(t, 9.82, 9.95) * o2
    w1 = text(fr, "Par", SCRIPT, 74, sx, H * 0.90, WHITE, a=a, rot=3)
    a = seg(t, 10.28, 10.42) * o2
    w2 = text(fr, "aansoo", SCRIPT, 74, sx + w1 + 20, H * 0.90, YELLOW, a=a, rot=3, wipe=seg(t, 10.28, 10.6))
    a = seg(t, 10.6, 10.72) * o2
    text(fr, "mein", SCRIPT, 74, sx + w1 + w2 + 44, H * 0.90, WHITE, a=a, rot=3)
    # "Soyee" huge -> small, then "Nhi"
    if 10.85 <= t < 11.73:
        g = sm(seg(t, 11.05, 11.3))
        a = seg(t, 10.85, 10.95)
        px = lerp(170, 62, g)
        text(fr, "Soyee", BOLD, px, lerp(W * 0.04, W * 0.50, g), lerp(H * 0.42, H * 0.47, g), WHITE, a=a,
             glow=lerp(10, 4, g), blur=(1 - a) * 12)
        a = seg(t, 11.42, 11.52)
        text(fr, "Nhi", SCRIPT, 44, W * 0.57, H * 0.555, YELLOW, a=a)
    # "Par jaagoon main" + "Soyee Na"
    if t >= 11.95:
        sx = W * 0.14 - sm(seg(t, 12.3, 13.0)) * W * 0.42
        px = lerp(34, 60, sm(seg(t, 12.2, 12.45)))
        yb = lerp(H * 0.72, H * 0.89, sm(seg(t, 12.2, 12.45)))
        x = words(fr, [("Par", 11.98, WHITE), ("jaagoon", 12.24, WHITE), ("main", 12.78, WHITE)], BOLD, px, sx, yb, t,
                  hb=int(math.sin(math.pi * seg(t, 12.3, 13.0)) * 14))
        a = seg(t, 12.48, 12.58)
        text(fr, "Soyee", BOLD, 150, lerp(W * 0.80, W * 0.36, eo(seg(t, 12.48, 12.9))), H * 0.26, WHITE, a=a, glow=9)
        a = seg(t, 12.6, 12.7)
        text(fr, "Na", SCRIPT, 150, lerp(W * 0.80, W * 0.42, eo(seg(t, 12.6, 12.95))), H * 0.50, YELLOW, a=a, rot=5)
    fr = gblur(fr, beat * 6)
    fr *= min(seg(t, 8.87, 9.02), 1 - seg(t, 12.98, 13.13))
    return fr


def s5_sky(t):
    """13.2-17.0  pale sky, a falling silhouette, TOOTE / Kaanchon, then huge scrolling words."""
    drop = sm(seg(t, 15.0, 15.6))                 # camera follows the fall: everything slides up
    fr = view(SKY, 0.5 + 0.01 * math.sin(t), 0.45 + 0.12 * drop + 0.02 * (t - 13.2), 1.5)
    oy = -drop * H * 0.9
    # silhouette
    if 13.4 < t < 15.9:
        p = eo(seg(t, 13.4, 14.35))
        q = seg(t, 15.0, 15.7)
        sc = lerp(1.05, 0.50, p) * (1 + 0.5 * q)
        cx = lerp(0.72, 0.60, p) - 0.25 * q
        cy = lerp(-0.25, 0.50, p) + 0.02 * math.sin(t * 3) + q * q * 1.1
        rot = lerp(70, 0, p) + (t - 14.35) * 14 * (t > 14.35) + q * 60
        S = FALL.shape[0]
        M = cv2.getRotationMatrix2D((S / 2, S / 2), rot, sc * W / S)
        M[0, 2] += cx * W - S / 2
        M[1, 2] += cy * H - S / 2
        m = cv2.warpAffine(FALL, M, (W, H), flags=cv2.INTER_LINEAR)
        comp(fr, m, 0, 0, (8, 8, 12))
    # TOOTE / DIL KI UN / Kaanchon / MAIN
    g = sm(seg(t, 13.75, 14.5))
    a = seg(t, 13.22, 13.34)
    text(fr, "TOOTE", BOLD, lerp(118, 62, g), lerp(-W * 0.01, W * 0.065, g), lerp(H * 0.20, H * 0.165, g) + oy, WHITE,
         a=a, blur=(1 - a) * 10)
    a = seg(t, 13.55, 13.68)
    text(fr, "DIL KI UN", BOLD, lerp(30, 22, g), lerp(W * 0.01, W * 0.105, g), lerp(H * 0.285, H * 0.225, g) + oy,
         tuple(int(lerp(c1, c2, seg(t, 13.6, 13.9))) for c1, c2 in zip((235, 90, 220), (30, 40, 70))), a=a)
    kx = W * 0.14
    for i, ch in enumerate("Kaanchon"):
        a = seg(t, 14.15 + i * 0.055, 14.23 + i * 0.055)
        w = text(fr, ch, SCRIPT, 112, kx, H * 0.56 + oy - i * 3.2, YELLOW, a=a, rot=6, blur=(1 - a) * 5)
        kx += w + 1
    a = seg(t, 14.62, 14.7)
    text(fr, "MAIN", BOLD, 24, W * 0.675, H * 0.625 + oy, WHITE, a=a, box=RED)
    # "Tu din main / naa mile raaton mein": grows huge and scrolls left
    if t > 15.05:
        g = sm(seg(t, 15.7, 16.35))
        px = lerp(44, 185, g)
        sc = sm(seg(t, 15.85, 16.9))
        x = lerp(W * 0.10, -px * 3.25, sc) if g > 0 else W * 0.10
        yb = lerp(H * 0.60, H * 0.50, g) - (1 - seg(t, 15.05, 15.5)) * H * 0.08 * 0 + (1 - drop) * H * 0.22
        hb = int(math.sin(math.pi * seg(t, 15.85, 16.9)) * 30 * g)
        words(fr, [("Tu", 15.1, WHITE), ("din", 15.42, WHITE), ("main", 15.72, WHITE)], BOLD, px, x, yb, t, hb=hb)
        px2 = lerp(22, 86, g)
        x2 = lerp(W * 0.10, -px2 * 6.2, sc) if g > 0 else W * 0.10
        words(fr, [("naa", 15.78, YELLOW), ("mile", 16.02, YELLOW), ("raaton", 16.38, YELLOW), ("mein", 16.68, YELLOW)],
              BOLD, px2, x2 + W * 0.02 * g, yb + px2 * 1.25, t, hb=hb // 2)
    fr = gblur(fr, (1 - seg(t, 13.2, 13.35)) * 8)
    fr *= min(seg(t, 13.13, 13.3), 1 - seg(t, 16.88, 17.03))
    return fr


def s6_woman(t):
    """17.03-19.1  dark portrait, big condensed glowing caps sliding across."""
    p = seg(t, 17.03, 19.1)
    punch = sm(seg(t, 17.55, 17.75)) * (1 - sm(seg(t, 18.0, 18.2))) + sm(seg(t, 18.55, 18.7))
    z = 1.08 + 0.12 * p + 0.75 * punch
    fr = view(WOMAN, lerp(0.56, 0.62, p) - 0.09 * punch, 0.50 - 0.05 * punch, z)
    fr = gblur(fr, punch * 5)
    fr = tint(fr, (255, 225, 120), 0.4 * (1 - seg(t, 18.35, 18.6)) * (t >= 18.35))
    slide = sm(seg(t, 17.3, 19.0))
    x = lerp(W * 0.58, W * 0.40, slide)
    hb = int(math.sin(math.pi * seg(t, 17.6, 18.1)) * 22 + math.sin(math.pi * seg(t, 18.5, 18.8)) * 30)
    x2 = words(fr, [("MATHE", 17.3, WHITE), ("KI", 17.9, WHITE)], CAPS, 104, x, H * 0.50, t, gap=0.22, glow=7, hb=hb)
    a = seg(t, 18.28, 18.38)
    w = text(fr, "YEH", CAPS, 112, x - W * 0.16, H * 0.68, WHITE, a=a, glow=8, hb=hb)
    a = seg(t, 18.5, 18.6)
    text(fr, "BINDIYA", CAPS, 112, x - W * 0.16 + w + 24, H * 0.68, WHITE, a=a, glow=8, hb=hb)
    fr *= min(seg(t, 17.03, 17.25), 1.0)
    return fr


def _banner():
    bw, bh = 1200, 130
    img = np.zeros((bh + 200, bw + 200, 3), np.float32)
    al = np.zeros((bh + 200, bw + 200), np.float32)
    y0 = 100
    img[y0:y0 + bh, :bw + 100] = (98, 140, 196)
    img[y0:y0 + 8, :bw + 100] = (70, 104, 160)
    img[y0 + bh - 8:y0 + bh, :bw + 100] = (70, 104, 160)
    al[y0:y0 + bh, :bw + 100] = 1
    x = 40
    for _ in range(3):
        x += text_on(img, "चुरा ले गई है", DEVA, 78, x, y0 + 92, (30, 52, 98)) + 70
    c = (bw + 100, y0 + bh // 2)
    cv2.circle(img, c, 98, (150, 185, 225), -1, cv2.LINE_AA)
    cv2.circle(img, c, 98, (34, 58, 104), 9, cv2.LINE_AA)
    cv2.circle(img, c, 46, (34, 58, 104), 7, cv2.LINE_AA)
    cv2.circle(al, c, 100, 1.0, -1, cv2.LINE_AA)
    return img, al, c


def text_on(img, s, font, px, x, yb, color):
    m, y0 = tmask(s, font, px)
    h, w = m.shape
    reg = img[yb + y0:yb + y0 + h, x:x + w]
    hh, ww = reg.shape[:2]
    reg += (np.array(color, np.float32) - reg) * m[:hh, :ww, None]
    return w


BANNER = None


def s7_bed(t):
    """19.1-21.13  sleepless boy: close-up, wide with a swinging banner, pan to the photo."""
    global BANNER
    if t < 19.6:
        p = seg(t, 19.1, 19.6)
        fr = view(BEDCLOSE, 0.5, 0.5, lerp(1.16, 1.04, p), rot=lerp(-3, 0, p))
        q = seg(t, 19.38, 19.6)
        fr = tint(gblur(fr, q * 9), (255, 240, 235), q * 0.55)
        return fr
    if t < 20.42:
        p = seg(t, 19.6, 20.42)
        fr = view(BED, 0.47, 0.44, lerp(1.5, 1.38, eo(p)), rot=lerp(4, 0, eo(p)))
        fr = tint(gblur(fr, (1 - seg(t, 19.6, 19.72)) * 8), (255, 240, 235), (1 - seg(t, 19.6, 19.75)) * 0.5)
        if BANNER is None:
            BANNER = _banner()
        img, al, piv = BANNER
        ang = lerp(34, -22, sm(seg(t, 19.68, 20.42)))
        px, py = W * 0.90, lerp(H * 1.05, H * 0.56, eo(seg(t, 19.66, 19.95)))
        M = cv2.getRotationMatrix2D(piv, ang, 0.62)
        M[0, 2] += px - piv[0]
        M[1, 2] += py - piv[1]
        bi = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR)
        ba = cv2.warpAffine(al, M, (W, H), flags=cv2.INTER_LINEAR)[..., None]
        fr *= 1 - 0.25 * np.roll(cv2.GaussianBlur(ba, (0, 0), 8), 8, axis=0).reshape(H, W, 1)
        fr = fr * (1 - ba) + bi * ba
        if t > 20.3:
            fr = hblur(fr, seg(t, 20.3, 20.42) * 70)
        return fr
    p = eo(seg(t, 20.42, 20.9))
    fr = view(BED, lerp(0.60, 0.70, p), lerp(0.60, 0.80, p), lerp(1.8, 2.5, p), rot=lerp(28, 12, p))
    fr = hblur(fr, (1 - seg(t, 20.42, 20.6)) * 70)
    a = seg(t, 20.7, 20.8)
    text(fr, "निंदिया", DEVA, 40, W * 0.42 + 2, H * 0.955 + 3, (40, 20, 10), a=a * 0.8, anchor="c", blur=2)
    text(fr, "निंदिया", DEVA, 40, W * 0.42, H * 0.955, (255, 220, 70), a=a, anchor="c")
    return fr


def s8_hand(t):
    """21.13-23.1  white screen, one black word, a mehndi hand sweeps in."""
    fr = np.full((H, W, 3), 250, np.float32)
    g = sm(seg(t, 21.45, 21.65))
    a = seg(t, 21.16, 21.24) * (1 - seg(t, 21.75, 21.9))
    text(fr, "Dekhen", BOLD, lerp(78, 46, g), lerp(W * 0.19, W * 0.22, g), lerp(H * 0.53, H * 0.50, g), BLACK, a=a)
    p = eo(seg(t, 21.48, 21.9))
    if p > 0:
        q = seg(t, 21.9, 23.1)
        hand = view(HAND, lerp(-0.10, 0.52, p) + 0.05 * q, 0.50, lerp(1.9, 1.55, p) - 0.05 * q)
        hand = hblur(hand, (1 - seg(t, 21.48, 21.85)) * 120)
        fr = np.minimum(fr, hand + 5)             # hand art sits on white: multiply-style overlay
    words(fr, [("Haathon", 21.58, BLACK), ("ki", 22.0, BLACK), ("mehandi", 22.28, BLACK), ("teri", 22.78, (120, 120, 120))],
          BOLD, 20, W * 0.365, H * 0.94, t)
    return fr


def s9_realeye(t):
    """23.1-27.37  white flash into a huge eye, blue words, ink swallows the frame."""
    p = eo(seg(t, 23.15, 23.85))
    z = lerp(3.2, 1.22, p) + 0.04 * math.sin(t * 1.4)
    fr = view(REALEYE, 0.52, lerp(0.46, 0.50, p), z, rot=lerp(8, 0, p))
    fr = gblur(fr, (1 - seg(t, 23.15, 23.6)) * 10)
    fr = tint(fr, (255, 252, 245), max(1 - seg(t, 23.1, 23.5), 0) * 0.95)
    fr = tint(fr, (255, 215, 240), 0.6 * (1 - seg(t, 24.2, 24.5)) * (t >= 24.2))
    blue = (36, 132, 216)
    rise = eo(seg(t, 23.65, 24.0))
    yb = lerp(H * 1.06, H * 0.90, rise)
    x = lerp(W * 0.52, W * 0.40, sm(seg(t, 23.65, 24.6)))
    words(fr, [("To", 23.66, blue), ("so", 23.84, blue), ("naa", 24.08, blue)], BOLD, 82, x, yb, t)
    words(fr, [("paye", 24.85, (28, 104, 176)), ("akhiyan", 25.15, (28, 104, 176))], BOLD, 29, x + 6, yb + 38, t)
    # ink wipe from the left
    q = seg(t, 24.8, 26.3)
    if q > 0:
        edge = _xx / W * 0.9 + INK * 0.55
        ink = np.clip((q * 1.55 - edge) / 0.07, 0, 1)[..., None]
        soft = cv2.GaussianBlur(ink, (0, 0), 3)[..., None]
        fr = fr * (1 - soft * 0.6)
        txt = fr.copy()
        fr = fr * (1 - ink)
        # the words survive a moment longer than the picture
        keep = (1 - seg(t, 26.2, 27.1))
        mask = np.zeros((H, W, 3), np.float32)
        words(mask, [("To", 0, WHITE), ("so", 0, WHITE), ("naa", 0, WHITE)], BOLD, 82, x, yb, 99)
        words(mask, [("paye", 0, WHITE), ("akhiyan", 0, WHITE)], BOLD, 29, x + 6, yb + 38, 99)
        m = mask[..., :1] / 255.0
        fr = fr + (txt * 0.8 - fr) * m * keep
    fr *= 1 - seg(t, 26.5, 27.25)
    return fr


def yellow_wipe(a, b, p):
    """Diagonal yellow sweep from the top-left."""
    d = (_xx + _yy) / (W + H)
    lead = np.clip((p * 1.5 - d) / 0.02, 0, 1)[..., None]
    tail = np.clip((p * 1.5 - 0.5 - d) / 0.02, 0, 1)[..., None]
    out = a * (1 - lead) + np.array((248, 190, 44), np.float32) * lead
    return out * (1 - tail) + b * tail


def frame(t):
    if t < 2.3:
        fr = s1_wall(t)
    elif t < 4.2:
        fr = s2_green(t)
    elif t < 4.36:
        fr = yellow_wipe(s2_green(t), s3_couple(4.36), seg(t, 4.2, 4.36))
    elif t < 8.73:
        fr = s3_couple(t)
    elif t < 8.87:
        p = seg(t, 8.73, 8.87)
        fr = gblur(s3_couple(8.73), p * 18) * (1 - p)
    elif t < 13.13:
        fr = s4_eye(t)
    elif t < 17.03:
        fr = s5_sky(t)
    elif t < 19.1:
        fr = s6_woman(t)
    elif t < 21.13:
        fr = s7_bed(t)
    elif t < 23.1:
        fr = s8_hand(t)
    else:
        fr = s9_realeye(t)
    # finishing: light leak, vignette, grain, fade in
    lum = fr.mean() / 255.0
    fr = fr + LEAK * (0.05 + 0.05 * math.sin(t * 0.9)) * (0.4 + lum)
    fr = fr * VIG + GRAIN[int(t * FPS) % len(GRAIN)]
    fr *= seg(t, 0.05, 0.3)
    return np.clip(fr, 0, 255).astype(np.uint8)


def sheets():
    step = 0.27
    ts = [i * step for i in range(int(DUR / step) + 1)]
    for k in range(0, len(ts), 28):
        tiles = []
        for t in ts[k:k + 28]:
            f = cv2.resize(frame(t), (200, 200))
            cv2.putText(f, f"{t:.2f}", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)
            tiles.append(f)
        while len(tiles) % 7:
            tiles.append(np.zeros((200, 200, 3), np.uint8))
        sh = np.vstack([np.hstack(tiles[r:r + 7]) for r in range(0, len(tiles), 7)])
        cv2.imwrite(str(HERE / f"_sheet{k // 28}.jpg"), cv2.cvtColor(sh, cv2.COLOR_RGB2BGR), [1, 84])
    print("sheets written")


def render():
    import imageio_ffmpeg

    out = HERE / "output" / "parchai_recreation.mp4"
    out.parent.mkdir(exist_ok=True)
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    src = HERE / "source.mp4"
    if src.exists():
        cmd += ["-i", str(src), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-t", f"{DUR:.3f}", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(round(DUR * FPS))
    for i in range(n):
        proc.stdin.write(frame(i / FPS).tobytes())
        if i % 120 == 0:
            print(f"{i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    print("done:", out)


if __name__ == "__main__":
    sheets() if "--sheet" in sys.argv else render()
