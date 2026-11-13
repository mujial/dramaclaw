#!/usr/bin/env python3
"""Kinetic lyric edit for "I Met Her Again" (9:16, 33 s) in the Parchai editing style.

    ../lyric-video/.venv/bin/python i_met_her_again.py            # render
    ../lyric-video/.venv/bin/python i_met_her_again.py --sheet    # contact sheets
"""
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fx import *  # noqa: E402,F401,F403
from fx import (BLACK, BLUE, BOLD, CAPS, FPS, H, MAROON, MED, RED, ROOT, SCRIPT, W, WHITE, YELLOW, Chain, card, clamp,
                eo, finish, gblur, hblur, ink, lerp, load, rain, seg, sm, sprite, text, tint, view, whip, wipe_diag,
                words, zoom)

DUR = 33.0
S = ROOT / "lyric-video" / "song1"
IMG = HERE / "img"
AUDIO = S / "song_clip.m4a"
GOLD, TEAL, CREAM = (214, 160, 28), (40, 150, 160), (247, 243, 231)


def s(name):
    return S / f"{name}.png"


MOON, HANDS, UMB = load(IMG / "moon.png"), load(IMG / "hands.png"), load(IMG / "umbrella.png")
MANEYES, CHEST, LIPS = load(IMG / "man_eyes.png"), load(IMG / "chest.png"), load(IMG / "lips.png")
FEET, CUP, ROAD = load(IMG / "feet.png"), load(IMG / "cup.png"), load(IMG / "road.png")
S1A, S1B, S2A, S2B, S3A, S7A = (load(s(n)) for n in ("s1a", "s1b", "s2a", "s2b", "s3a", "s7a"))
P04D, P08 = load(s("04d")), load(s("08"))
_g = cv2.cvtColor(load(IMG / "walk_sil.png"), cv2.COLOR_RGB2GRAY)
SIL = cv2.GaussianBlur((_g < 128).astype(np.float32), (0, 0), 1.0)
C1 = Chain([s(n) for n in ("01", "01ab", "01b")])
C2 = Chain([s(n) for n in ("02", "02ab", "02b", "02bc", "02c")])
C3 = Chain([s(n) for n in ("03c", "03d")])
C4 = Chain([s(n) for n in ("04", "04b", "04bc", "04c")])
C6 = Chain([s(n) for n in ("06", "06ab", "06b", "06bc", "06c")])
C7 = Chain([s(n) for n in ("07", "07ab", "07b", "07bc", "07c")])


def flash(fr, t, t0, color=(255, 250, 240), amt=0.6, d=0.25):
    return tint(fr, color, amt * (1 - seg(t, t0, t0 + d))) if t >= t0 else fr


def shake(fr, t, t0, d=0.35, amp=0.012):
    if not (t0 <= t < t0 + d):
        return fr
    k = (1 - seg(t, t0, t0 + d)) * amp
    return zoom(fr, 1.04, 0.5 + math.sin(t * 90) * k * 8, 0.5 + math.cos(t * 70) * k * 8)


def caption(fr, t, line, t0, t1, color=WHITE, y=0.93):
    a = seg(t, t0, t0 + 0.25) * (1 - seg(t, t1 - 0.25, t1)) * 0.85
    text(fr, line, MED, 25, W / 2, H * y, color, a=a, anchor="c")


# ------------------------------------------------------------------ shots
def intro(t):
    """0-2.85  night sky, the title rushes past in huge letters."""
    p = sm(seg(t, 0, 2.85))
    fr = gblur(view(MOON, 0.5, lerp(0.30, 0.47, p), lerp(1.38, 1.14, p)), lerp(9, 1.2, sm(seg(t, 0, 1.6))))
    fr = tint(fr, (8, 12, 40), 0.22)
    px = 200
    scroll = lerp(300, -640, sm(seg(t, 0.3, 1.95)))
    hb = int(math.sin(math.pi * seg(t, 0.3, 1.95)) * 34)
    out = 1 - seg(t, 1.85, 2.05)
    for line, yb, x0 in (((("I", 0.3), ("MET", 0.55)), H * 0.36, 0), ((("HER", 0.95), ("AGAIN", 1.3)), H * 0.36 + 215, -30)):
        x = scroll + x0
        for wd, t0 in line:
            a = seg(t, t0, t0 + 0.14) * out
            x += text(fr, wd, BOLD, px, x, yb, WHITE, a=a, blur=(1 - a) * 12, hb=hb, glow=6) + 56
    a = seg(t, 2.0, 2.2) * (1 - seg(t, 2.6, 2.78))
    text(fr, "I MET HER AGAIN", CAPS, 74, W / 2, H * 0.40, WHITE, a=a, anchor="c", glow=7, blur=(1 - seg(t, 2.0, 2.2)) * 8)
    text(fr, "M A A N   P A N U", MED, 22, W / 2, H * 0.435, (255, 214, 120), a=a * 0.9, anchor="c")
    return fr


def l1(t):
    """2.75-7.45  Main unse mila sau raaton mein."""
    if t < 4.1:                                   # the two of them under the lamp
        p = seg(t, 2.75, 4.1)
        fr = view(C1.at(seg(t, 2.9, 4.0)), 0.52, lerp(0.64, 0.62, p), lerp(1.30, 1.42, p)).astype(np.float32)
        x = words(fr, [("Main", 2.85, WHITE), ("unse", 3.30, WHITE)], BOLD, 74, W * 0.37, H * 0.20, t, shadow=0.5)
        a = seg(t, 3.74, 3.86)
        text(fr, "mila", SCRIPT, 190, W * 0.44, H * 0.33, YELLOW, a=a, rot=5, wipe=seg(t, 3.74, 4.0))
        return fr
    if t < 5.0:                                   # hands
        p = seg(t, 4.1, 5.0)
        fr = view(HANDS, 0.5, 0.42, lerp(1.45, 1.2, eo(p)), rot=lerp(4, 0, eo(p)))
        fr = flash(hblur(fr, (1 - seg(t, 4.1, 4.25)) * 70), t, 4.1, (255, 200, 120), 0.5)
        a = seg(t, 4.12, 4.2)
        text(fr, "sau", BOLD, 70, W * 0.12, H * 0.20, WHITE, a=a, box=MAROON, blur=(1 - a) * 8)
        a = seg(t, 4.45, 4.55)
        text(fr, "raaton", BOLD, 104, lerp(W * 0.5, W * 0.16, eo(a)), H * 0.305, WHITE, a=a, box=BLUE, hb=int((1 - a) * 50))
        return fr
    # faces as a card on the night sky
    p = eo(seg(t, 5.0, 5.45))
    fr = gblur(view(MOON, 0.5, 0.42, 1.25 + 0.05 * seg(t, 5.0, 7.45)), 5) * 0.62
    gx = lerp(W * 0.9, -W * 1.3, seg(t, 5.0, 7.45))
    text(fr, "RAATON", CAPS, 420, gx, H * 0.50, (120, 150, 255), a=0.22)
    swap = t >= 6.2
    pic = view(S1B if swap else S1A, 0.5, 0.5, 1.12 + 0.05 * seg(t, 5.0, 7.45))
    sc = lerp(1.0, 0.60, p)
    rot = math.sin((t - 5.0) * 2.2) * 2.6 * p * (-1 if swap else 1)
    fr = card(fr, pic, 0.5 + math.sin(t * 1.6) * 0.008 * p, lerp(0.5, 0.47, p), sc, rot)
    fr = flash(fr, t, 6.2, (255, 226, 170), 0.55)
    x = words(fr, [("sau", 5.0, WHITE), ("raaton", 5.0, WHITE)], MED, 38, W * 0.20, H * 0.815, t)
    a = seg(t, 5.06, 5.2)
    text(fr, "mein", BOLD, lerp(120, 96, eo(a)), W * 0.19, H * 0.895, WHITE, a=a, shear=0.18, blur=(1 - a) * 6)
    q = sm(seg(t, 7.1, 7.45))
    if q > 0:
        fr = hblur(zoom(fr, 1 + 0.6 * q, 0.3, 0.86), q * 30)
    return fr


def l2(t):
    """7.45-12.05  Unn saawan ki barsaaton mein."""
    if t < 8.8:                                   # umbrella from above
        p = seg(t, 7.45, 8.8)
        fr = view(UMB, 0.5, 0.40, lerp(1.34, 1.16, p), rot=lerp(-10, 6, p))
        fr = rain(fr, t)
        x = words(fr, [("Unn", 7.45, WHITE)], BOLD, 74, W * 0.08, H * 0.165, t, shadow=0.5)
        a = seg(t, 7.90, 8.02)
        text(fr, "saawan", SCRIPT, 170, W * 0.10, H * 0.285, WHITE, a=a, rot=4, wipe=seg(t, 7.90, 8.3), shadow=0.5)
        a = seg(t, 8.54, 8.64)
        text(fr, "ki", BOLD, 54, W * 0.72, H * 0.30, WHITE, a=a, box=TEAL)
        return fr
    if t < 10.0:                                  # the couple, huge word rushing through
        p = seg(t, 8.8, 10.0)
        fr = view(C2.at(p), 0.5, lerp(0.585, 0.60, p), lerp(1.75, 1.55, eo(p))).astype(np.float32)
        fr = flash(rain(fr, t), t, 8.84, (150, 215, 255), 0.6)
        fr = shake(fr, t, 8.84)
        x = lerp(W * 1.0, -W * 1.05, sm(p))
        text(fr, "BARSAATON", BOLD, 230, x, H * 0.27, WHITE, hb=int(math.sin(math.pi * p) * 34), glow=4, shadow=0.6)
        return fr
    if t < 11.0:                                  # hand in the rain
        p = seg(t, 10.0, 11.0)
        fr = view(S2A, lerp(0.46, 0.52, p), 0.47, lerp(1.15, 1.3, p))
        fr = rain(hblur(fr, (1 - seg(t, 10.0, 10.15)) * 70), t)
        text(fr, "barsaaton", BOLD, 54, W * 0.08, H * 0.175, WHITE, box=BLUE)
        text(fr, "mein", SCRIPT, 150, W * 0.12, H * 0.295, YELLOW, rot=5)
        return fr
    p = seg(t, 11.0, 12.05)                       # faces under the umbrella
    fr = view(S2B, 0.5, lerp(0.52, 0.50, p), lerp(1.4, 1.14, eo(p)))
    fr = flash(rain(fr, t), t, 11.0, (220, 240, 255), 0.5)
    caption(fr, t, "Unn saawan ki barsaaton mein", 11.05, 12.0)
    fr = gblur(fr, seg(t, 11.8, 12.05) * 14) * (1 - seg(t, 11.85, 12.05))
    return fr


def l3(t):
    """12.05-16.7  Vo kehna chahte the shayad kuch  (eye seen through a slit)."""
    open_ = max(sm(seg(t, 14.08, 14.24)) * (1 - sm(seg(t, 16.2, 16.55))), 0)
    if t < 14.12:
        pic = view(S3A, 0.5 + 0.015 * math.sin(t * 1.3), 0.66, 1.3 + 0.04 * math.sin(t * 2.1), rot=math.sin(t * 1.9))
    elif t < 15.4:
        p = seg(t, 14.12, 15.4)
        pic = view(LIPS, 0.5, lerp(0.30, 0.34, p), lerp(1.45, 1.22, eo(p)))
    else:
        p = seg(t, 15.4, 16.7)
        pic = view(C3.at(seg(t, 15.5, 16.3)), 0.52, 0.52, lerp(1.2, 1.36, p)).astype(np.float32)
    half = lerp(0.085, 0.75, open_)
    mid = lerp(0.40, 0.5, open_)
    band = np.clip((half - np.abs(YY / H - mid)) / 0.035, 0, 1)[..., None]
    fr = pic * band
    fr = flash(fr, t, 14.12, (255, 150, 235), 0.6)
    fr = flash(fr, t, 15.4, (150, 220, 130), 0.45)
    fr = shake(fr, t, 14.12)
    o1 = 1 - seg(t, 14.0, 14.12)
    if t < 14.12:
        words(fr, [("Vo", 12.05, WHITE), ("kehna", 12.68, YELLOW)], BOLD, 40, W * 0.10, H * 0.305, t)
    a = seg(t, 13.28, 13.4) * o1
    w1 = text(fr, "chahte", SCRIPT, 104, W * 0.14, H * 0.60, WHITE, a=a, rot=3, wipe=seg(t, 13.28, 13.6))
    a = seg(t, 13.82, 13.92) * o1
    text(fr, "the", SCRIPT, 104, W * 0.14 + w1 + 26, H * 0.60, YELLOW, a=a, rot=3)
    if t >= 14.12:
        g = sm(seg(t, 14.3, 14.6))
        o2 = 1 - seg(t, 16.15, 16.4)
        text(fr, "SHAYAD", BOLD, lerp(250, 150, g), lerp(-W * 0.06, W * 0.07, g), lerp(H * 0.70, H * 0.66, g), WHITE,
             a=seg(t, 14.12, 14.2) * o2, glow=lerp(12, 6, g))
        a = seg(t, 14.72, 14.82) * o2
        text(fr, "kuch", SCRIPT, 230, W * 0.34, H * 0.80, YELLOW, a=a, rot=6, wipe=seg(t, 14.72, 15.0))
    fr *= min(seg(t, 12.05, 12.25), 1 - seg(t, 16.5, 16.7))
    return fr


def l4(t):
    """16.7-21.4  Main dekh na paaya aankhon mein."""
    if t < 18.5:
        p = seg(t, 16.7, 18.5)
        fr = view(C4.at(seg(t, 16.9, 18.4)), lerp(0.46, 0.42, p), 0.47, lerp(1.26, 1.5, p)).astype(np.float32)
        fr = tint(fr, (20, 10, 40), 0.22) * seg(t, 16.7, 16.9)
        x = lerp(W * 0.50, W * 0.10, sm(seg(t, 16.7, 18.4)))
        x2 = words(fr, [("MAIN", 16.70, WHITE), ("DEKH", 17.44, WHITE)], CAPS, 120, x, H * 0.20, t, gap=0.2, glow=3, shadow=0.6)
        a = seg(t, 17.75, 17.83)
        w = text(fr, "na", BOLD, 70, x + 6, H * 0.275, WHITE, a=a, box=RED)
        a = seg(t, 18.02, 18.12)
        text(fr, "paaya", SCRIPT, 130, x + w + 60, H * 0.292, YELLOW, a=a, rot=4, wipe=seg(t, 18.02, 18.3))
        return fr
    if t < 19.6:                                  # his eyes, huge word scrolls
        p = seg(t, 18.5, 19.6)
        fr = view(MANEYES, 0.52, lerp(0.56, 0.54, p), lerp(1.55, 1.16, eo(seg(t, 18.5, 19.0))))
        fr = shake(flash(fr, t, 18.54, (255, 200, 150), 0.65), t, 18.54)
        x = lerp(W * 0.95, -W * 0.95, sm(p))
        text(fr, "AANKHON", BOLD, 250, x, H * 0.88, WHITE, hb=int(math.sin(math.pi * p) * 36), glow=7)
        a = seg(t, 19.10, 19.2)
        text(fr, "mein", SCRIPT, 130, W * 0.56, H * 0.19, YELLOW, a=a, rot=5)
        return fr
    if t < 20.5:                                  # her eyes / his eyes, strobing
        k = int((t - 19.6) / 0.3)
        p = ((t - 19.6) % 0.3) / 0.3
        if k % 2 == 0:
            fr = view(S3A, 0.5, 0.60, 1.5 + 0.1 * p)
        else:
            fr = view(MANEYES, 0.52, 0.55, 1.3 + 0.1 * p)
        fr = tint(fr, (255, 255, 255), 0.5 * (1 - clamp(p * 4)))
        text(fr, "aankhon", BOLD, 58, W * 0.08, H * 0.165, WHITE, box=MAROON)
        text(fr, "mein", SCRIPT, 150, W * 0.12, H * 0.285, YELLOW, rot=5)
        return fr
    p = seg(t, 20.5, 21.4)
    fr = view(P04D, lerp(0.46, 0.5, p), 0.5, lerp(1.5, 1.12, eo(p)))
    fr = hblur(fr, (1 - seg(t, 20.5, 20.65)) * 60)
    caption(fr, t, "Main dekh na paaya aankhon mein", 20.55, 21.35)
    fr = tint(gblur(fr, seg(t, 21.15, 21.4) * 12), CREAM, seg(t, 21.15, 21.4))
    return fr


def l5(t):
    """21.4-24.48  Vo leke aye the paimaana  (white screen, one object)."""
    fr = np.empty((H, W, 3), np.float32)
    fr[:] = np.array(CREAM, np.float32)
    g = sm(seg(t, 22.45, 22.7))
    out = 1 - seg(t, 23.3, 23.5)
    px = lerp(110, 60, g)
    x, yb = lerp(W * 0.12, W * 0.09, g), lerp(H * 0.44, H * 0.19, g)
    x2 = words(fr, [("Vo", 21.40, BLACK), ("leke", 22.06, BLACK)], BOLD, px, x, yb, t)
    words(fr, [("aye", 22.72, (70, 70, 70)), ("the", 23.14, (70, 70, 70))], BOLD, 60, x2 + 4, yb, t)
    p = eo(seg(t, 22.5, 22.95))
    if p > 0:
        q = seg(t, 22.95, 24.48)
        cup = view(CUP, lerp(1.15, 0.5, p), 0.43 - 0.01 * q, lerp(2.3, 1.75, p) + 0.12 * q, rot=lerp(-14, 0, p) + math.sin(t * 2) * 1.5)
        cup = hblur(cup, (1 - seg(t, 22.5, 22.9)) * 130)
        fr = np.minimum(fr, cup + 6)
    kx = W * 0.10
    for i, ch in enumerate("Paimaana"):
        a = seg(t, 23.54 + i * 0.05, 23.62 + i * 0.05)
        kx += text(fr, ch, SCRIPT, 158, kx, H * 0.325 - i * 4, GOLD, a=a, rot=6, blur=(1 - a) * 5) + 1
    caption(fr, t, "Vo leke aye the paimaana", 22.9, 24.4, (120, 110, 100))
    fr = tint(fr, (10, 6, 6), seg(t, 24.3, 24.48))
    return fr


def l6(t):
    """24.48-26.75  Naapne mere dard yahan  (dark, big glowing caps)."""
    if t < 25.6:
        p = seg(t, 24.48, 25.6)
        fr = view(C6.at(p), 0.5, lerp(0.50, 0.48, p), lerp(1.2, 1.42, p)).astype(np.float32) * 0.62
        fr *= seg(t, 24.48, 24.62)
        x = lerp(W * 0.50, W * 0.07, sm(seg(t, 24.48, 25.25)))
        words(fr, [("NAAPNE", 24.48, WHITE), ("MERE", 25.10, WHITE)], CAPS, 132, x, H * 0.215, t, gap=0.2, glow=4,
              hb=int(math.sin(math.pi * seg(t, 24.48, 25.25)) * 14))
        return fr
    p = seg(t, 25.6, 26.75)
    fr = view(CHEST, 0.5, 0.50, lerp(1.7, 1.22, eo(seg(t, 25.6, 26.0))) + 0.05 * p) * 0.75
    fr = shake(flash(fr, t, 25.6, (255, 60, 50), 0.6, 0.35), t, 25.6, 0.45, 0.016)
    a = seg(t, 25.60, 25.66)
    text(fr, "DARD", CAPS, lerp(440, 360, eo(seg(t, 25.6, 25.9))), W * 0.5, H * 0.335, (255, 74, 62), a=a, anchor="c", glow=12)
    a = seg(t, 25.90, 26.0)
    text(fr, "yahan", SCRIPT, 150, W * 0.52, H * 0.42, WHITE, a=a, rot=5, wipe=seg(t, 25.9, 26.15))
    fr = tint(fr, (255, 250, 240), seg(t, 26.62, 26.75) * 0.9)
    return fr


def l7(t):
    """26.75-28.95  Dekh ke mujhko hansta hua."""
    if t < 28.45:
        p = seg(t, 26.75, 28.45)
        fr = view(C7.at(p), lerp(0.44, 0.40, p), 0.50, lerp(1.18, 1.36, p)).astype(np.float32)
        fr = flash(fr, t, 26.75, (255, 250, 240), 0.9, 0.3)
        a = seg(t, 26.75, 26.85)
        text(fr, "Dekh ke", BOLD, 66, W * 0.07, H * 0.165, WHITE, a=a, box=MAROON)
        a = seg(t, 27.42, 27.5)
        text(fr, "mujhko", BOLD, 80, lerp(W * 0.6, W * 0.30, eo(a)), H * 0.245, WHITE, a=a, box=BLUE, hb=int((1 - a) * 40))
        if t >= 28.0:
            b = eo(seg(t, 28.0, 28.25))
            fr = shake(fr, t, 28.0, 0.3)
            text(fr, "hansta", SCRIPT, lerp(270, 205, b), W * 0.07, H * 0.90, YELLOW, rot=7, wipe=seg(t, 28.0, 28.22), shadow=0.5)
        return fr
    p = seg(t, 28.45, 28.95)
    fr = view(S7A, 0.5, 0.54, lerp(1.4, 1.2, eo(p)))
    g = fr.mean(axis=2, keepdims=True)
    fr = flash(fr + (g - fr) * 0.6, t, 28.45, (255, 255, 255), 0.7, 0.2)
    text(fr, "hua", BOLD, 84, W * 0.5, H * 0.22, WHITE, anchor="c", box=BLACK)
    return fr


def l8(t):
    """28.95-33  Vo laut gaye phir jaane kahan."""
    if t < 29.54:
        p = seg(t, 28.95, 29.54)
        fr = view(P08, 0.5, 0.52, lerp(1.3, 1.15, eo(p)))
        fr = hblur(fr, (1 - seg(t, 28.95, 29.08)) * 60)
        words(fr, [("VO", 28.95, WHITE), ("LAUT", 29.10, WHITE)], BOLD, 130, W * 0.06, H * 0.20, t, shadow=0.6)
        return fr
    if t < 30.3:
        p = seg(t, 29.54, 30.3)
        fr = view(FEET, 0.5, lerp(0.60, 0.56, p), lerp(1.3, 1.14, eo(p)))
        fr = flash(fr, t, 29.54, (255, 230, 170), 0.5)
        text(fr, "GAYE", BOLD, lerp(260, 210, eo(p)), W * 0.5, H * 0.26, WHITE, anchor="c", shadow=0.65)
        a = seg(t, 29.96, 30.06)
        text(fr, "phir", BOLD, 64, W * 0.5, H * 0.335, WHITE, a=a, anchor="c", box=MAROON)
        return fr
    p = seg(t, 30.3, 33.0)
    fr = view(ROAD, 0.5, lerp(0.56, 0.50, p), lerp(1.12, 1.3, p))
    fr = flash(fr, t, 30.3, (255, 236, 190), 0.55)
    far = sm(seg(t, 30.3, 32.6))
    sprite(fr, SIL, 0.5 + 0.004 * math.sin(t * 5), lerp(0.70, 0.565, far), lerp(0.42, 0.06, far),
           math.sin(t * 5) * 1.5, (22, 14, 12))
    g = sm(seg(t, 30.6, 31.2))
    words(fr, [("VO", 0, WHITE), ("LAUT", 0, WHITE), ("GAYE", 0, WHITE)], BOLD, lerp(96, 62, g), W * 0.07,
          lerp(H * 0.17, H * 0.145, g), t, shadow=0.6)
    words(fr, [("phir", 0, (70, 40, 30)), ("jaane", 30.32, (70, 40, 30))], BOLD, 40, W * 0.075, lerp(H * 0.22, H * 0.185, g), t)
    kx = W * 0.10
    for i, ch in enumerate("Kahan"):
        a = seg(t, 30.75 + i * 0.07, 30.85 + i * 0.07)
        kx += text(fr, ch, SCRIPT, 226, kx - W * 0.04, H * 0.375 - i * 6, YELLOW, a=a, rot=7, blur=(1 - a) * 6, shadow=0.5) + 2
    q = seg(t, 31.5, 32.7)
    if q > 0:
        keep = fr.copy()
        fr = ink(fr, q)
        mask = np.zeros((H, W, 3), np.float32)
        kx = W * 0.10
        for i, ch in enumerate("Kahan"):
            kx += text(mask, ch, SCRIPT, 226, kx - W * 0.04, H * 0.375 - i * 6, WHITE, rot=7) + 2
        m = mask[..., :1] / 255.0
        fr = fr + (keep - fr) * m * (1 - seg(t, 32.3, 32.9))
    fr *= 1 - seg(t, 32.5, 32.95)
    return fr


def frame(t):
    if t < 2.6:
        fr = intro(t)
    elif t < 2.85:
        fr = whip(intro(t), l1(t), seg(t, 2.6, 2.85), -1)
    elif t < 7.36:
        fr = l1(t)
    elif t < 7.52:
        fr = wipe_diag(l1(t), l2(7.52), seg(t, 7.36, 7.52), (40, 170, 175))
    elif t < 12.05:
        fr = l2(t)
    elif t < 16.7:
        fr = l3(t)
    elif t < 21.4:
        fr = l4(t)
    elif t < 24.48:
        fr = l5(t)
    elif t < 26.75:
        fr = l6(t)
    elif t < 28.95:
        fr = l7(t)
    else:
        fr = l8(t)
    return finish(fr, t)


def sheets():
    step = 0.3
    ts = [i * step for i in range(int(DUR / step))]
    for k in range(0, len(ts), 28):
        tiles = []
        for t in ts[k:k + 28]:
            f = cv2.resize(frame(t), (198, 352))
            cv2.putText(f, f"{t:.2f}", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)
            tiles.append(f)
        while len(tiles) % 7:
            tiles.append(np.zeros((352, 198, 3), np.uint8))
        sh = np.vstack([np.hstack(tiles[r:r + 7]) for r in range(0, len(tiles), 7)])
        cv2.imwrite(str(HERE / f"_sheet{k // 28}.jpg"), cv2.cvtColor(sh, cv2.COLOR_RGB2BGR), [1, 84])
    print("sheets written")


def render():
    import imageio_ffmpeg

    out = HERE / "output" / "i_met_her_again_kinetic.mp4"
    out.parent.mkdir(exist_ok=True)
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", str(AUDIO), "-map", "0:v", "-map", "1:a",
           "-c:a", "aac", "-b:a", "192k", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", f"{DUR:.3f}", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(round(DUR * FPS))
    for i in range(n):
        proc.stdin.write(frame(i / FPS).tobytes())
        if i % 150 == 0:
            print(f"{i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    print("done:", out)


if __name__ == "__main__":
    sheets() if "--sheet" in sys.argv else render()
