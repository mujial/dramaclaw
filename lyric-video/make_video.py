#!/usr/bin/env python3
"""Illustrated lyric-video (reel) renderer, v2.

Usage:
    python make_video.py project.json                       # render the MP4
    python make_video.py project.json --frame 5.2 out.png   # one preview frame

Per scene it can do: pose change (optical-flow morph between two drawings),
eye blink, wind sway / breathing warps, camera moves, light flicker, rain,
kinetic lyrics drawn *inside* the scene, and several transition styles.
See README.md for the project.json fields.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

import cv2
import freetype
import numpy as np
import uharfbuzz as hb

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"

DEFAULTS = {
    "width": 720,
    "height": 1280,
    "fps": 30,
    "line_seconds": 4.2,      # used when lyrics have no timestamps
    "intro_seconds": 0.5,
    "outro_seconds": 1.4,
    "transition_seconds": 0.6,
    "scene_lead": 0.35,       # image changes this long before its lyric line
    "font_latin": "Anton-Regular.ttf",
    "font_devanagari": "Kalam-Bold.ttf",
    "font_caption": "Poppins-Medium.ttf",
    "font_size": 0.064,       # fraction of scene width
    "accent_size": 0.15,
    "uppercase": True,
    "particles": True,
    "grain": 2.0,
    "vignette": 0.36,
}

# every scene image is normalised to this size (9:16, a bit larger than output)
SW, SH = 864, 1536


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(p):
    p = clamp(p)
    return p * p * (3 - 2 * p)


def ease_out(p):
    p = clamp(p)
    return 1 - (1 - p) ** 3


def back_out(p, s=1.9):
    p = clamp(p) - 1
    return p * p * ((s + 1) * p + s) + 1


def bounce_out(p):
    p = clamp(p)
    if p < 1 / 2.75:
        return 7.5625 * p * p
    if p < 2 / 2.75:
        p -= 1.5 / 2.75
        return 7.5625 * p * p + 0.75
    if p < 2.5 / 2.75:
        p -= 2.25 / 2.75
        return 7.5625 * p * p + 0.9375
    p -= 2.625 / 2.75
    return 7.5625 * p * p + 0.984375


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))


def load_scene_image(path):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read image: {path}")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    s = max(SW / w, SH / h)
    img = cv2.resize(img, (math.ceil(w * s), math.ceil(h * s)), interpolation=cv2.INTER_LANCZOS4)
    h, w = img.shape[:2]
    l, t = (w - SW) // 2, (h - SH) // 2
    return np.ascontiguousarray(img[t : t + SH, l : l + SW])


def blend(frame, mask, x, y, color, alpha=1.0):
    """Alpha-blend a single-channel mask (uint8/float) onto frame in colour."""
    if alpha <= 0.003:
        return
    H, W = frame.shape[:2]
    h, w = mask.shape[:2]
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    m = mask[y0 - y : y1 - y, x0 - x : x1 - x].astype(np.float32) * (alpha / 255.0)
    m = m[..., None]
    region = frame[y0:y1, x0:x1].astype(np.float32)
    region += (np.array(color, np.float32) - region) * m
    frame[y0:y1, x0:x1] = region.astype(np.uint8)


# --------------------------------------------------------------------------
# Text: HarfBuzz shaping + FreeType rasterising (correct Devanagari matras)
# --------------------------------------------------------------------------
class Glyphs:
    def __init__(self):
        self._fonts = {}

    def _font(self, path):
        path = str(path)
        if path not in self._fonts:
            data = Path(path).read_bytes()
            self._fonts[path] = (hb.Font(hb.Face(data)), freetype.Face(path))
        return self._fonts[path]

    def render(self, text, path, px, tracking=0.0):
        """Return (mask uint8 HxW, x_offset, y_offset_from_baseline, advance)."""
        hbfont, face = self._font(path)
        hbfont.scale = (px * 64, px * 64)
        face.set_pixel_sizes(0, px)
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hbfont, buf)
        pen = 0.0
        parts = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            face.load_glyph(info.codepoint, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
            g = face.glyph
            bm = g.bitmap
            if bm.width and bm.rows:
                arr = np.array(bm.buffer, dtype=np.uint8).reshape(bm.rows, bm.pitch)[:, : bm.width]
                x = int(round(pen + pos.x_offset / 64.0)) + g.bitmap_left
                y = -int(round(pos.y_offset / 64.0)) - g.bitmap_top
                parts.append((arr, x, y))
            pen += pos.x_advance / 64.0 + (tracking * px if pos.x_advance else 0)
        pen -= tracking * px
        if not parts:
            return np.zeros((1, 1), np.uint8), 0, 0, pen
        x0 = min(p[1] for p in parts)
        y0 = min(p[2] for p in parts)
        x1 = max(p[1] + p[0].shape[1] for p in parts)
        y1 = max(p[2] + p[0].shape[0] for p in parts)
        mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
        for arr, x, y in parts:
            view = mask[y - y0 : y - y0 + arr.shape[0], x - x0 : x - x0 + arr.shape[1]]
            np.maximum(view, arr, out=view)
        return mask, x0, y0, pen


GLYPHS = Glyphs()
_DEVA = re.compile(r"[\u0900-\u097F]")
_TS = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$")


def parse_lyrics(path, cfg):
    """One lyric line per row. Optional `[mm:ss.xx]` stamp.
    `*word*` = accent word, `*शब्द|shabd*` = accent word with small caption."""
    raw = [l.strip() for l in Path(path).read_text(encoding="utf-8").splitlines()]
    raw = [l for l in raw if l and not l.startswith("#")]
    lines = []
    for i, l in enumerate(raw):
        m = _TS.match(l)
        if m:
            start, text = int(m.group(1)) * 60 + float(m.group(2)), m.group(3)
        else:
            start, text = cfg["intro_seconds"] + i * cfg["line_seconds"], l
        words = []
        for tok in text.split():
            accent = tok.startswith("*") and tok.endswith("*") and len(tok) > 2
            tok = tok.strip("*")
            caption = None
            if accent and "|" in tok:
                tok, caption = tok.split("|", 1)
            if cfg["uppercase"] and not _DEVA.search(tok):
                tok = tok.upper()
            words.append({"text": tok, "accent": accent, "caption": caption})
        if words:
            lines.append({"start": start, "words": words})
    lines.sort(key=lambda d: d["start"])
    for a, b in zip(lines, lines[1:]):
        a["end"] = b["start"]
    if lines:
        lines[-1]["end"] = lines[-1]["start"] + cfg["line_seconds"]
    return lines


def _pad_blur(mask, pad, sigma):
    m = cv2.copyMakeBorder(mask, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    return cv2.GaussianBlur(m, (0, 0), sigma)


def _swash(width, thick, seed):
    """A hand-drawn looking tapered underline stroke."""
    h = int(thick * 5)
    m = np.zeros((h, int(width)), np.uint8)
    rng = np.random.default_rng(seed)
    bend = rng.uniform(-0.25, 0.25)
    n = int(width)
    for i in range(0, n, 2):
        u = i / max(n - 1, 1)
        y = h / 2 + math.sin(u * math.pi) * thick * (1.2 + bend) - thick * 0.8 + math.sin(u * 9) * thick * 0.12
        r = thick * (0.25 + 0.75 * math.sin(u * math.pi) ** 0.6) / 2
        cv2.circle(m, (i, int(y)), max(int(round(r)), 1), 255, -1, cv2.LINE_AA)
    return m


class LyricBlock:
    """Layout + animation of one lyric line, in scene-image pixel space."""

    def __init__(self, line, cfg, sc_conf, index):
        self.start, self.end = line["start"], line["end"]
        self.style = sc_conf.get("text_anim", ["rise", "drop", "pop", "slide"][index % 4])
        pos = sc_conf.get("text_pos", cfg.get("text_pos", [0.5, 0.19]))
        max_w = SW * sc_conf.get("text_width", cfg.get("text_width", 0.66))
        base = int(SW * cfg["font_size"])
        acc = int(SW * cfg["accent_size"])
        tilt = sc_conf.get("accent_tilt", -3.0 if index % 2 == 0 else 3.0)

        # group words into rows: plain words wrap, accent word gets its own row
        rows, cur = [], []
        for w in line["words"]:
            if w["accent"]:
                if cur:
                    rows.append(cur)
                    cur = []
                rows.append([w])
            else:
                cur.append(w)
        if cur:
            rows.append(cur)

        built = []  # (items, width, ascent, descent, is_accent)
        for row in rows:
            if row[0]["accent"]:
                w = row[0]
                deva = bool(_DEVA.search(w["text"]))
                font = FONTS / (cfg["font_devanagari"] if deva else cfg["font_latin"])
                size = acc if deva else int(acc * 0.8)
                mask, ox, oy, adv = GLYPHS.render(w["text"], font, size)
                while mask.shape[1] > max_w:
                    size = int(size * 0.92)
                    mask, ox, oy, adv = GLYPHS.render(w["text"], font, size)
                if tilt:
                    h0, w0 = mask.shape
                    M = cv2.getRotationMatrix2D((w0 / 2, h0 / 2), tilt, 1.0)
                    ex = int(abs(math.sin(math.radians(tilt))) * w0 / 2) + 2
                    M[1, 2] += ex
                    mask = cv2.warpAffine(mask, M, (w0, h0 + 2 * ex), flags=cv2.INTER_LINEAR)
                    oy -= ex
                it = {"mask": mask, "accent": True, "w": mask.shape[1], "oy": oy, "ox": 0}
                built.append(([it], mask.shape[1], -oy, mask.shape[0] + oy, True, w.get("caption"), size))
            else:
                # wrap plain words
                sub, sub_w = [], 0.0
                space = base * 0.30

                def flush():
                    asc = max(-i["oy"] for i in sub)
                    desc = max(i["mask"].shape[0] + i["oy"] for i in sub)
                    built.append((list(sub), sub_w, asc, desc, False, None, base))

                for w in row:
                    deva = bool(_DEVA.search(w["text"]))
                    font = FONTS / (cfg["font_devanagari"] if deva else cfg["font_latin"])
                    mask, ox, oy, adv = GLYPHS.render(w["text"], font, base, tracking=0.03)
                    add = adv + (space if sub else 0)
                    if sub and (sub_w + add > max_w or len(sub) >= 4):
                        flush()
                        sub, sub_w, add = [], 0.0, adv
                    sub.append({"mask": mask, "accent": False, "w": adv, "oy": oy, "ox": ox, "x_in_row": sub_w + add - adv})
                    sub_w += add
                if sub:
                    flush()

        gap = base * 0.26
        total = sum(b[2] + b[3] for b in built) + gap * (len(built) - 1)
        for b in built:
            if b[5]:
                total += base * 0.62
        cx, cy = pos[0] * SW, pos[1] * SH
        y = cy - total / 2
        self.items = []
        self.box = [cx - max_w / 2, y, cx + max_w / 2, y + total]
        for items, rw, asc, desc, is_acc, caption, size in built:
            baseline = y + asc
            x = cx - rw / 2
            for it in items:
                it["x"] = int(round(x + (it.get("x_in_row", 0)) + it["ox"]))
                it["y"] = int(round(baseline + it["oy"]))
                self.items.append(it)
            y = baseline + desc
            if is_acc:
                a = items[0]
                sw = _swash(rw * 0.92, max(size * 0.07, 5), seed=index)
                self.items.append({"mask": sw, "accent": True, "kind": "swash",
                                   "x": int(cx - sw.shape[1] / 2), "y": int(y - size * 0.10)})
                y += size * 0.02
                if caption:
                    cm, cox, coy, cadv = GLYPHS.render(caption.upper(), FONTS / cfg["font_caption"],
                                                       int(base * 0.40), tracking=0.32)
                    self.items.append({"mask": cm, "accent": False, "kind": "caption",
                                       "x": int(cx - cm.shape[1] / 2), "y": int(y + base * 0.22)})
                    y += base * 0.62
            y += gap

        # precompute shadows / glows and reveal times
        n_words = sum(1 for it in self.items if "kind" not in it)
        dur = self.end - self.start
        step = min(0.2, dur * 0.5 / max(n_words, 1))
        t = self.start + 0.12
        for it in self.items:
            pad = 14
            it["pad"] = pad
            it["shadow"] = _pad_blur(it["mask"], pad, 5.0)
            if it["accent"]:
                it["glow"] = _pad_blur(it["mask"], 30, 12.0)
            kind = it.get("kind")
            if kind == "swash":
                it["t"] = t - step + 0.22
            elif kind == "caption":
                it["t"] = t - step + 0.38
            else:
                it["t"] = t
                t += step * (1.8 if it["accent"] else 1.0)

    def set_colors(self, main, accent, shadow, shadow_alpha):
        self.main, self.accent, self.shadow, self.shadow_alpha = main, accent, shadow, shadow_alpha

    def draw(self, img, t):
        if not (self.start <= t < self.end + 0.4):
            return
        out = smooth((self.end + 0.25 - t) / 0.4)
        for it in self.items:
            dt = t - it["t"]
            if dt <= 0:
                continue
            mask, x, y = it["mask"], it["x"], it["y"]
            kind = it.get("kind")
            color = self.accent if it["accent"] else self.main
            alpha, dx, dy, scale, wipe = out, 0, 0, 1.0, None
            if kind == "swash" or (it["accent"] and kind is None):
                wipe = smooth(dt / (0.45 if kind else 0.55))
                alpha *= clamp(dt / 0.12)
                if kind is None:
                    scale = 1.0 + 0.025 * math.sin((t - it["t"]) * 2.2)
            elif kind == "caption":
                alpha *= smooth(dt / 0.4)
                dy = int((1 - ease_out(dt / 0.4)) * 10)
            else:
                p = dt / 0.34
                alpha *= clamp(p * 2.2)
                if self.style == "pop":
                    scale = 0.55 + 0.45 * back_out(p)
                elif self.style == "drop":
                    dy = int(-(1 - bounce_out(dt / 0.5)) * 70)
                elif self.style == "slide":
                    dx = int(-(1 - ease_out(p)) * 60)
                else:  # rise
                    dy = int((1 - ease_out(p)) * 34)
            if wipe is not None and wipe < 1:
                w = mask.shape[1]
                edge = wipe * (w + 60) - 60
                ramp = np.clip((edge + 60 - np.arange(w, dtype=np.float32)) / 60.0, 0, 1)
                mask = (mask.astype(np.float32) * ramp[None, :]).astype(np.uint8)
                shadow = (it["shadow"].astype(np.float32) * np.pad(ramp, it["pad"], mode="edge")[None, :]).astype(np.uint8)
                glow = None
            else:
                shadow = it["shadow"]
                glow = it.get("glow")
            if scale != 1.0:
                h0, w0 = mask.shape
                mask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
                x -= (mask.shape[1] - w0) // 2
                y -= (mask.shape[0] - h0) // 2
                shadow = None
            if glow is not None and kind is None:
                ga = 0.42 * alpha * (0.75 + 0.25 * math.sin(t * 3.0))
                blend(img, glow, it["x"] - 30 + dx, it["y"] - 30 + dy, self.accent, ga)
            if shadow is not None:
                blend(img, shadow, x - it["pad"] + dx, y - it["pad"] + dy + 3, self.shadow, alpha * self.shadow_alpha)
            blend(img, mask, x + dx, y + dy, color, alpha)


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------
class Warp:
    """Local sinusoidal displacement inside an ellipse (hair, cloth, breathing)."""

    def __init__(self, conf, seed):
        cx, cy = conf["c"][0] * SW, conf["c"][1] * SH
        rx, ry = conf["r"][0] * SW, conf["r"][1] * SH
        x0, x1 = max(int(cx - rx), 0), min(int(cx + rx), SW)
        y0, y1 = max(int(cy - ry), 0), min(int(cy + ry), SH)
        self.box = (x0, y0, x1, y1)
        gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        d = ((gx - cx) / rx) ** 2 + ((gy - cy) / ry) ** 2
        self.w = np.clip(1 - d, 0, 1) ** 2
        self.gx, self.gy = gx, gy
        self.amp = conf.get("amp", 5.0)
        self.hz = conf.get("hz", 0.45)
        self.axis = conf.get("axis", "x")
        self.phase = conf.get("phase", seed * 1.7)
        self.wave = (gy - cy) / max(ry, 1) * 1.2 if self.axis == "x" else (gx - cx) / max(rx, 1) * 0.6

    def apply(self, src, dst, t):
        x0, y0, x1, y1 = self.box
        if x1 <= x0 or y1 <= y0:
            return
        ph = 2 * math.pi * self.hz * t + self.phase
        gust = 0.65 + 0.35 * math.sin(0.9 * t + self.phase * 0.5)
        d = self.amp * gust * self.w * (np.sin(ph - self.wave) + 0.35 * np.sin(2.3 * ph - 2 * self.wave))
        if self.axis == "x":
            mx, my = self.gx - d, self.gy - 0.25 * d
        else:
            mx, my = self.gx, self.gy - d
        dst[y0:y1, x0:x1] = cv2.remap(src, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def make_flow(A, B, lim=40.0):
    """Smoothed two-way optical flow, gated to where the drawings differ."""
    ga = cv2.cvtColor(A, cv2.COLOR_RGB2GRAY)
    gb = cv2.cvtColor(B, cv2.COLOR_RGB2GRAY)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(1)
    fab = dis.calc(ga, gb, None)
    fba = dis.calc(gb, ga, None)
    diff = cv2.GaussianBlur(cv2.absdiff(ga, gb), (0, 0), 6).astype(np.float32)
    gate = np.clip((diff - 4) / 10, 0, 1)
    gate = cv2.GaussianBlur(cv2.dilate(gate, np.ones((31, 31), np.uint8)), (0, 0), 12)[..., None]
    fab = np.clip(cv2.GaussianBlur(fab, (0, 0), 4) * gate, -lim, lim)
    fba = np.clip(cv2.GaussianBlur(fba, (0, 0), 4) * gate, -lim, lim)
    return fab, fba


def morph(A, B, fab, fba, gx, gy, k):
    a = cv2.remap(A, gx + k * fba[..., 0], gy + k * fba[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    b = cv2.remap(B, gx + (1 - k) * fab[..., 0], gy + (1 - k) * fab[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return cv2.addWeighted(a, 1 - k, b, k, 0)


class Scene:
    def __init__(self, conf, folder, index):
        self.conf = conf
        self.index = index
        self.A = load_scene_image(folder / conf["image"])
        self.start = self.end = 0.0
        self.block = None
        self.rain = bool(conf.get("rain"))
        self.gy, self.gx = np.mgrid[0:SH, 0:SW].astype(np.float32)

        # pose change: optical-flow morph A -> B
        self.B = None
        pose = conf.get("pose")
        if pose:
            self.B = load_scene_image(folder / pose["image"])
            self.pose_at = pose.get("at", 1.9)
            self.pose_dur = pose.get("dur", 0.9)
            if pose.get("mode", "flow") == "flow":
                self.fab, self.fba = make_flow(self.A, self.B, pose.get("max_flow", 40.0))
            else:
                self.fab = self.fba = None

        # blink: eyes-closed drawing composited only inside the eye box
        self.blink = None
        bl = conf.get("blink")
        if bl:
            K = load_scene_image(folder / bl["image"])
            x0, y0, x1, y1 = bl["box"]
            x0, x1, y0, y1 = int(x0 * SW), int(x1 * SW), int(y0 * SH), int(y1 * SH)
            m = np.zeros((y1 - y0, x1 - x0), np.float32)
            pad = max(4, min(m.shape) // 12)
            m[pad:-pad, pad:-pad] = 1
            m = cv2.GaussianBlur(m, (0, 0), pad / 2.0)[..., None]
            fab, fba = make_flow(self.A, K, 25.0)
            sl = (slice(y0, y1), slice(x0, x1))
            self.blink = {"K": K, "mask": m, "box": (x0, y0, x1, y1), "at": bl.get("at", [1.0]),
                          "fab": fab[sl], "fba": fba[sl], "gx": self.gx[sl], "gy": self.gy[sl]}

        self.warps = [Warp(w, i + index * 3) for i, w in enumerate(conf.get("sway", []))]
        self.glows = []
        for g in conf.get("glow", []):
            r = int(g.get("r", 0.25) * SW)
            yy, xx = np.mgrid[-r:r, -r:r].astype(np.float32)
            sp = np.clip(1 - np.sqrt(xx * xx + yy * yy) / r, 0, 1) ** 2
            self.glows.append({"sp": sp[..., None], "x": int(g["c"][0] * SW) - r, "y": int(g["c"][1] * SH) - r,
                               "color": np.array(hex_rgb(g.get("color", "#ffb347")), np.float32),
                               "amp": g.get("amp", 0.35), "hz": g.get("hz", 1.0)})

        cam = conf.get("cam", {})
        self.cam0 = cam.get("from", [0.5, 0.5, 1.06, 0.0])
        self.cam1 = cam.get("to", [0.5, 0.48, 1.2, 0.0])

    # -- drawing content at local time ------------------------------------
    def content(self, t):
        lt = t - self.start
        img = self.A
        if self.B is not None:
            k = smooth((lt - self.pose_at) / self.pose_dur)
            if k >= 1:
                img = self.B
            elif k > 0:
                if self.fab is None:
                    img = cv2.addWeighted(self.A, 1 - k, self.B, k, 0)
                else:
                    img = morph(self.A, self.B, self.fab, self.fba, self.gx, self.gy, k)
        img = img.copy()
        if self.blink is not None:
            k = 0.0
            for at in self.blink["at"]:
                d = lt - at
                if 0 <= d < 0.32:
                    k = max(k, smooth(d / 0.10) if d < 0.16 else smooth((0.32 - d) / 0.16))
            if k > 0 and (self.B is None or lt < self.pose_at):
                bk = self.blink
                x0, y0, x1, y1 = bk["box"]
                mid = morph(self.A, bk["K"], bk["fab"], bk["fba"], bk["gx"], bk["gy"], k).astype(np.float32)
                reg = img[y0:y1, x0:x1].astype(np.float32)
                reg += (mid - reg) * bk["mask"]
                img[y0:y1, x0:x1] = reg.astype(np.uint8)
        if self.warps:
            src = img.copy()
            for w in self.warps:
                w.apply(src, img, t)
        for g in self.glows:
            a = g["amp"] * (0.55 + 0.25 * math.sin(2 * math.pi * g["hz"] * t) + 0.2 * math.sin(2 * math.pi * g["hz"] * 2.7 * t + 1))
            x, y = g["x"], g["y"]
            h, w = g["sp"].shape[:2]
            x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, SW), min(y + h, SH)
            reg = img[y0:y1, x0:x1].astype(np.float32)
            reg += g["color"] * g["sp"][y0 - y : y1 - y, x0 - x : x1 - x] * a
            img[y0:y1, x0:x1] = np.clip(reg, 0, 255).astype(np.uint8)
        if self.block is not None:
            self.block.draw(img, t)
        return img

    # -- camera -----------------------------------------------------------
    def camera(self, t):
        p = (t - self.start) / max(self.end - self.start, 1e-3)
        p = clamp(p)
        e = 0.5 - 0.5 * math.cos(math.pi * p)        # ease in-out
        e = 0.35 * p + 0.65 * e                      # never fully stops
        cx, cy, z, rot = [a + (b - a) * e for a, b in zip(self.cam0, self.cam1)]
        s = self.index * 2.1
        # handheld drift
        cx += (math.sin(t * 0.83 + s) + 0.5 * math.sin(t * 1.9 + s * 2)) * 0.0035
        cy += (math.sin(t * 0.71 + s + 2) + 0.5 * math.sin(t * 1.6 + s)) * 0.0035
        rot += math.sin(t * 0.6 + s) * 0.18
        z = max(z, 1.03)
        hx = hy = 0.5 / z * 1.03
        cx, cy = clamp(cx, hx, 1 - hx), clamp(cy, hy, 1 - hy)
        return cx, cy, z, rot

    def frame(self, t, W, H):
        img = self.content(t)
        cx, cy, z, rot = self.camera(t)
        k = SW / (W * z)
        c, s = math.cos(math.radians(rot)) * k, math.sin(math.radians(rot)) * k
        M = np.array([[c, -s, cx * SW - c * W / 2 + s * H / 2],
                      [s, c, cy * SH - s * W / 2 - c * H / 2]], np.float32)
        return cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                              borderMode=cv2.BORDER_REFLECT)


# --------------------------------------------------------------------------
# Screen-space effects
# --------------------------------------------------------------------------
class Particles:
    def __init__(self, W, H, n=40, seed=7):
        r = np.random.default_rng(seed)
        self.W, self.H = W, H
        self.x = r.uniform(0, W, n)
        self.y = r.uniform(0, H, n)
        self.vy = r.uniform(10, 34, n)
        self.wob = r.uniform(0.3, 1.2, n)
        self.ph = r.uniform(0, 6.28, n)
        self.size = r.choice([0, 0, 1, 1, 2, 3], n)
        self.sprites = []
        for rad in (3, 6, 12, 26):
            d = rad * 6
            im = np.zeros((d, d), np.uint8)
            cv2.circle(im, (d // 2, d // 2), rad, 255, -1, cv2.LINE_AA)
            self.sprites.append(cv2.GaussianBlur(im, (0, 0), rad * 0.7).astype(np.float32))

    def draw(self, frame, t, color=(255, 236, 190)):
        col = np.array(color, np.float32)
        for i in range(len(self.x)):
            sp = self.sprites[self.size[i]]
            d = sp.shape[0]
            speed = 1.0 + self.size[i] * 0.5   # near (big) particles move faster
            x = int((self.x[i] + 30 * speed * math.sin(t * self.wob[i] + self.ph[i])) % self.W) - d // 2
            y = int((self.y[i] - self.vy[i] * speed * t) % (self.H + d)) - d
            a = (0.30 + 0.25 * math.sin(t * 1.7 * self.wob[i] + self.ph[i] * 3)) * (0.55 if self.size[i] == 3 else 1)
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + d, self.W), min(y + d, self.H)
            if x1 <= x0 or y1 <= y0 or a <= 0:
                continue
            m = sp[y0 - y : y1 - y, x0 - x : x1 - x, None] * (a / 255.0)
            reg = frame[y0:y1, x0:x1].astype(np.float32)
            frame[y0:y1, x0:x1] = np.minimum(reg + col * m, 255).astype(np.uint8)


class Rain:
    def __init__(self, W, H, n=220, seed=3):
        r = np.random.default_rng(seed)
        self.W, self.H = W, H
        self.x = r.uniform(-0.2 * W, 1.2 * W, n)
        self.y = r.uniform(0, H, n)
        self.depth = r.uniform(0.4, 1.0, n)

    def draw(self, frame, t, strength=1.0):
        im = np.zeros((self.H, self.W), np.uint8)
        for x, y, dp in zip(self.x, self.y, self.depth):
            v, ln = 1900 * dp, 85 * dp
            yy = (y + v * t) % (self.H + 120) - 60
            xx = x - 0.18 * (yy - y)
            cv2.line(im, (int(xx), int(yy)), (int(xx - 0.18 * ln), int(yy + ln)),
                     int(110 + 120 * dp), 1 if dp < 0.75 else 2, cv2.LINE_AA)
        m = cv2.GaussianBlur(im, (0, 0), 0.9).astype(np.float32)[..., None] * (0.6 * strength / 255)
        f = frame.astype(np.float32)
        f += (np.array((228, 238, 248), np.float32) - f) * m
        frame[:] = f.astype(np.uint8)


def vignette(W, H, strength):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2) / 1.414
    return (1 - strength * np.clip(r, 0, 1) ** 2.2)[..., None]


def scale_about_center(img, s):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), 0, s)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def transition(kind, a, b, p):
    """Mix outgoing frame a and incoming frame b at progress p (0..1)."""
    H, W = a.shape[:2]
    if kind.startswith("whip"):
        e = smooth(smooth(p))
        speed = math.sin(math.pi * p)
        horiz = kind in ("whip_left", "whip_right")
        sign = -1 if kind in ("whip_left", "whip_up") else 1
        size = W if horiz else H
        off = int(round(e * size)) * sign
        out = np.empty_like(a)
        if horiz:
            if sign < 0:   # content moves left
                out[:, : W + off] = a[:, -off:]
                out[:, W + off :] = b[:, : -off] if off else b[:, :0]
            else:
                out[:, off:] = a[:, : W - off]
                out[:, :off] = b[:, W - off :]
            k = int(speed * 130) | 1
            if k > 1:
                out = cv2.blur(out, (k, 1), borderType=cv2.BORDER_REFLECT)
        else:
            if sign < 0:   # content moves up
                out[: H + off] = a[-off:]
                out[H + off :] = b[: -off] if off else b[:0]
            else:
                out[off:] = a[: H - off]
                out[:off] = b[H - off :]
            k = int(speed * 170) | 1
            if k > 1:
                out = cv2.blur(out, (1, k), borderType=cv2.BORDER_REFLECT)
        return out
    e = smooth(p)
    if kind == "zoom":
        a2 = scale_about_center(a, 1 + 1.3 * e * e)
        b2 = scale_about_center(b, 1 + 0.5 * (1 - e) ** 2)
        out = cv2.addWeighted(a2, 1 - e, b2, e, 0)
        k = int(math.sin(math.pi * p) * 14)
        return cv2.GaussianBlur(out, (0, 0), k) if k >= 1 else out
    if kind == "blur":
        sig = math.sin(math.pi * p) * 22
        if sig >= 1:
            a = cv2.GaussianBlur(a, (0, 0), sig)
            b = cv2.GaussianBlur(b, (0, 0), sig)
        return cv2.addWeighted(a, 1 - e, b, e, 0)
    if kind == "flash":
        e2 = smooth(clamp((p - 0.3) / 0.4))
        out = cv2.addWeighted(a, 1 - e2, b, e2, 0).astype(np.float32)
        f = math.sin(math.pi * p) ** 1.5
        out += (np.array((255, 246, 225), np.float32) - out) * (0.92 * f)
        return out.astype(np.uint8)
    return cv2.addWeighted(a, 1 - e, b, e, 0)


# --------------------------------------------------------------------------
# Project
# --------------------------------------------------------------------------
class Project:
    def __init__(self, path):
        self.dir = Path(path).resolve().parent
        cfg = dict(DEFAULTS)
        cfg.update(json.loads(Path(path).read_text(encoding="utf-8")))
        self.cfg = cfg
        W, H = cfg["width"], cfg["height"]
        self.W, self.H, self.fps = W, H, cfg["fps"]
        self.lines = parse_lyrics(self.dir / cfg["lyrics"], cfg)
        self.duration = cfg.get("duration") or (self.lines[-1]["end"] + cfg["outro_seconds"])
        xf = cfg["transition_seconds"]

        self.scenes = []
        for i, sc in enumerate(cfg["scenes"]):
            s = Scene(sc, self.dir, i)
            if "start" in sc:
                s.start = float(sc["start"])
            elif i < len(self.lines):
                s.start = max(0.0, self.lines[i]["start"] - cfg["scene_lead"]) if i else 0.0
            else:
                s.start = self.scenes[-1].start + cfg["line_seconds"]
            s.xf = sc.get("transition_seconds", xf)
            s.trans = sc.get("transition", "dissolve")   # how this scene ENTERS
            self.scenes.append(s)
        for a, b in zip(self.scenes, self.scenes[1:]):
            a.end = b.start + b.xf
        self.scenes[-1].end = self.duration

        for i, ln in enumerate(self.lines):
            sc = self.scenes[i] if len(self.scenes) == len(self.lines) else self.scene_at(ln["start"] + 0.5)
            blk = LyricBlock(ln, cfg, sc.conf, i)
            x0, y0, x1, y1 = [int(max(v, 0)) for v in blk.box]
            lum = sc.A[y0:y1, x0:x1].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
            dark = sc.conf.get("text_color", "dark" if lum.mean() > 150 else "light") == "dark"
            main = hex_rgb(sc.conf.get("text", "#231710" if dark else "#ffffff"))
            accent = hex_rgb(sc.conf.get("accent", "#c2185b" if dark else "#ffd166"))
            blk.set_colors(main, accent, (255, 248, 232) if dark else (0, 0, 0), 0.7 if dark else 0.65)
            sc.block = blk if sc.block is None else sc.block

        self.vig = vignette(W, H, cfg["vignette"]) if cfg["vignette"] else None
        self.particles = Particles(W, H) if cfg["particles"] else None
        self.rain = Rain(W, H)
        rng = np.random.default_rng(1)
        self.grain = [rng.normal(0, cfg["grain"], (H, W, 1)).astype(np.float32) for _ in range(6)] if cfg["grain"] else None

    def scene_at(self, t):
        cur = self.scenes[0]
        for s in self.scenes:
            if s.start <= t:
                cur = s
        return cur

    def scene_frame(self, s, t):
        f = s.frame(t, self.W, self.H)
        if s.rain:
            self.rain.draw(f, t)
        return f

    def render_frame(self, t):
        idx = self.scenes.index(self.scene_at(t))
        cur = self.scenes[idx]
        frame = self.scene_frame(cur, t)
        if idx > 0 and t - cur.start < cur.xf:
            prev = self.scene_frame(self.scenes[idx - 1], t)
            frame = transition(cur.trans, prev, frame, (t - cur.start) / cur.xf)
        if self.particles is not None:
            self.particles.draw(frame, t)
        f = frame.astype(np.float32)
        if self.vig is not None:
            f *= self.vig
        if self.grain is not None:
            f += self.grain[int(t * self.fps) % len(self.grain)]
        fade = min(smooth(t / 0.6), smooth((self.duration - t) / 0.9))
        if fade < 1:
            f *= fade
        return np.clip(f, 0, 255).astype(np.uint8)

    def render(self):
        import imageio_ffmpeg

        out = self.dir / self.cfg.get("output", "output.mp4")
        out.parent.mkdir(parents=True, exist_ok=True)
        cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{self.W}x{self.H}",
               "-r", str(self.fps), "-i", "-"]
        audio = self.cfg.get("audio")
        if audio:
            cmd += ["-i", str(self.dir / audio), "-c:a", "aac", "-b:a", "192k"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", str(self.cfg.get("crf", 20)),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", f"{self.duration:.3f}", str(out)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        n = int(round(self.duration * self.fps))
        for i in range(n):
            proc.stdin.write(self.render_frame(i / self.fps).tobytes())
            if i % 90 == 0:
                print(f"{i}/{n} frames", flush=True)
        proc.stdin.close()
        if proc.wait() != 0:
            raise SystemExit("ffmpeg failed")
        print(f"done: {out}  ({self.duration:.1f}s, {n} frames)")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    proj = Project(sys.argv[1])
    if "--frame" in sys.argv:
        i = sys.argv.index("--frame")
        for k in range(i + 1, len(sys.argv) - 1, 2):
            f = proj.render_frame(float(sys.argv[k]))
            cv2.imwrite(sys.argv[k + 1], cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
    else:
        proj.render()


if __name__ == "__main__":
    main()
