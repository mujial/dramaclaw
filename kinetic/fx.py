"""Shared toolkit for kinetic lyric edits: camera, blur/tint/whip effects and animated text."""
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lyric-video"))
from make_video import GLYPHS, make_flow, morph  # noqa: E402

W, H, FPS = 720, 1280, 30
FONTS = ROOT / "lyric-video" / "fonts"
BOLD, MED, CAPS, DEVA = (FONTS / "Poppins-Bold.ttf", FONTS / "Poppins-Medium.ttf",
                         FONTS / "Anton-Regular.ttf", FONTS / "Kalam-Bold.ttf")
SCRIPT = ROOT / "parchai" / "fonts" / "Yellowtail.ttf"
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


def load(path, crop=0.0):
    img = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)
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
         pad=0.2, rot=0.0, anchor="l", shear=0.0, wipe=1.0, shadow=0.0):
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
    if shadow:
        comp(fr, fx(cv2.GaussianBlur(layer, (0, 0), max(2.0, px * 0.05))), ox + px * 0.03, oy + px * 0.045,
             (20, 10, 8), a * shadow)
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



def noise(sigma, w=W, h=H):
    n = cv2.GaussianBlur(RNG.random((h, w)).astype(np.float32), (0, 0), sigma)
    return (n - n.min()) / (n.max() - n.min())


YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
INK = noise(24)
GRAIN = [RNG.normal(0, 3.0, (H, W, 1)).astype(np.float32) for _ in range(6)]
VIG = (1 - 0.32 * np.clip(np.hypot((XX - W / 2) / (W / 2), (YY - H / 2) / (H / 2)) - 0.5, 0, 1) ** 1.5)[..., None]
LEAK = np.zeros((H, W, 3), np.float32)
for (lx, ly, lr, col) in ((0.95, 0.10, 300, (255, 120, 60)), (0.85, 0.28, 240, (90, 160, 255)), (0.05, 0.95, 320, (255, 200, 90))):
    LEAK += np.exp(-(((XX - lx * W) ** 2 + (YY - ly * H) ** 2) / (2 * lr * lr)))[..., None] * np.array(col, np.float32)

# rain: slanted streaks on a tall tile that scrolls down
_r = np.zeros((H * 2, W), np.float32)
for _ in range(520):
    x, y, ln = int(RNG.integers(0, W)), int(RNG.integers(0, H * 2)), int(RNG.integers(26, 70))
    cv2.line(_r, (x, y), (x - ln // 5, y + ln), float(RNG.uniform(0.25, 0.8)), 1, cv2.LINE_AA)
RAIN = np.vstack([_r, _r])


def rain(fr, t, a=0.5):
    off = int(t * 1500) % (H * 2)
    return fr + RAIN[H * 4 - H - off:H * 4 - off][..., None] * (235 * a)


def wipe_diag(a, b, p, color):
    """Diagonal colour sweep from the top-left."""
    d = (XX / W + YY / H) / 2
    lead = np.clip((p * 1.5 - d) / 0.02, 0, 1)[..., None]
    tail = np.clip((p * 1.5 - 0.5 - d) / 0.02, 0, 1)[..., None]
    out = a * (1 - lead) + np.array(color, np.float32) * lead
    return out * (1 - tail) + b * tail


def ink(fr, q):
    """Black ink eats the frame from the left (q 0..1)."""
    edge = XX / W * 0.9 + INK * 0.55
    m = np.clip((q * 1.55 - edge) / 0.07, 0, 1)[..., None]
    soft = cv2.GaussianBlur(m, (0, 0), 4)[..., None]
    return fr * (1 - soft * 0.6) * (1 - m)


def sprite(fr, mask, cx, cy, scale, rot, color):
    """Draw a silhouette mask centred at (cx, cy) (fractions), `scale` = height as a fraction of H."""
    sh, sw = mask.shape
    M = cv2.getRotationMatrix2D((sw / 2, sh / 2), rot, scale * H / sh)
    M[0, 2] += cx * W - sw / 2
    M[1, 2] += cy * H - sh / 2
    comp(fr, cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_LINEAR), 0, 0, color)


def card(fr, pic, cx, cy, scale, rot, shadow=0.4):
    """Place a full-frame picture as a tilted card."""
    M = cv2.getRotationMatrix2D((W / 2, H / 2), rot, scale)
    M[0, 2] += cx * W - W / 2
    M[1, 2] += cy * H - H / 2
    cw = cv2.warpAffine(pic, M, (W, H), flags=cv2.INTER_LINEAR)
    am = cv2.warpAffine(np.ones((H, W), np.float32), M, (W, H), flags=cv2.INTER_LINEAR)
    sh = np.roll(cv2.GaussianBlur(am, (0, 0), 18), 14, axis=0)[..., None]
    fr = fr * (1 - shadow * sh)
    return fr * (1 - am[..., None]) + cw * am[..., None]


class Chain:
    """A run of drawings of the same shot; at(p) morphs through them (p 0..1)."""

    def __init__(self, paths, lim=80.0):
        self.imgs = [load(p) for p in paths]
        h, w = self.imgs[0].shape[:2]
        self.gy, self.gx = np.mgrid[0:h, 0:w].astype(np.float32)
        self.flows = [make_flow(a, b, lim) for a, b in zip(self.imgs, self.imgs[1:])]

    def at(self, p):
        n = len(self.flows)
        x = clamp(p) * n
        i = min(int(x), n - 1)
        k = sm(clamp((x - i - 0.12) / 0.76))
        if k <= 0:
            return self.imgs[i]
        if k >= 1:
            return self.imgs[i + 1]
        fab, fba = self.flows[i]
        return morph(self.imgs[i], self.imgs[i + 1], fab, fba, self.gx, self.gy, k)


def finish(fr, t, fade_in=0.3):
    lum = fr.mean() / 255.0
    fr = fr + LEAK * (0.05 + 0.04 * math.sin(t * 0.9)) * (0.35 + lum)
    fr = fr * VIG + GRAIN[int(t * FPS) % len(GRAIN)]
    fr *= seg(t, 0.03, fade_in)
    return np.clip(fr, 0, 255).astype(np.uint8)
