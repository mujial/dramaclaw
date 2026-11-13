#!/usr/bin/env python3
"""Illustrated lyric-video (reel) renderer.

Usage:
    python make_video.py project.json                 # render the MP4
    python make_video.py project.json --frame 5.2 out.png   # one preview frame

Needs: pillow numpy imageio-ffmpeg uharfbuzz freetype-py  (see README.md)
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

import freetype
import numpy as np
import uharfbuzz as hb
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"

DEFAULTS = {
    "width": 720,
    "height": 1280,
    "fps": 30,
    "line_seconds": 4.0,      # used when lyrics have no timestamps
    "intro_seconds": 0.6,
    "outro_seconds": 1.2,
    "crossfade": 0.7,
    "scene_lead": 0.35,       # image changes this long before its lyric line
    "font_latin": "Anton-Regular.ttf",
    "font_devanagari": "Kalam-Bold.ttf",
    "font_size": 0.115,       # fraction of video width
    "accent_scale": 1.3,
    "uppercase": True,
    "particles": True,
    "vignette": 0.38,
}

MOTIONS = ["zoom_in", "pan_right", "zoom_out", "pan_left", "pan_up", "pan_down"]


# --------------------------------------------------------------------------
# Text: HarfBuzz shaping + FreeType rasterising (correct Devanagari matras)
# --------------------------------------------------------------------------
class Glyphs:
    def __init__(self):
        self._fonts = {}
        self._cache = {}

    def _font(self, path):
        if path not in self._fonts:
            data = Path(path).read_bytes()
            self._fonts[path] = (hb.Font(hb.Face(data)), freetype.Face(str(path)))
        return self._fonts[path]

    def render(self, text, path, px):
        """Return (mask uint8 HxW, x_offset, y_offset_from_baseline, advance)."""
        key = (text, str(path), px)
        if key in self._cache:
            return self._cache[key]
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
            pen += pos.x_advance / 64.0
        if not parts:
            out = (np.zeros((1, 1), np.uint8), 0, 0, pen)
        else:
            x0 = min(p[1] for p in parts)
            y0 = min(p[2] for p in parts)
            x1 = max(p[1] + p[0].shape[1] for p in parts)
            y1 = max(p[2] + p[0].shape[0] for p in parts)
            mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
            for arr, x, y in parts:
                view = mask[y - y0 : y - y0 + arr.shape[0], x - x0 : x - x0 + arr.shape[1]]
                np.maximum(view, arr, out=view)
            out = (mask, x0, y0, pen)
        self._cache[key] = out
        return out


GLYPHS = Glyphs()
_DEVA = re.compile(r"[\u0900-\u097F]")


def blend(frame, mask, x, y, color, alpha=1.0):
    """Alpha-blend a single-channel mask onto frame (uint8 HxWx3) in colour."""
    if alpha <= 0:
        return
    H, W = frame.shape[:2]
    h, w = mask.shape
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    m = mask[y0 - y : y1 - y, x0 - x : x1 - x].astype(np.float32) * (alpha / 255.0)
    m = m[..., None]
    region = frame[y0:y1, x0:x1].astype(np.float32)
    region += (np.array(color, np.float32) - region) * m
    frame[y0:y1, x0:x1] = region.astype(np.uint8)


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))


# --------------------------------------------------------------------------
# Lyrics
# --------------------------------------------------------------------------
_TS = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$")


def parse_lyrics(path, cfg):
    """Lines: optional `[mm:ss.xx]` stamp; `*word*` marks an accent word."""
    raw = [l.strip() for l in Path(path).read_text(encoding="utf-8").splitlines()]
    raw = [l for l in raw if l and not l.startswith("#")]
    lines = []
    for i, l in enumerate(raw):
        m = _TS.match(l)
        if m:
            start = int(m.group(1)) * 60 + float(m.group(2))
            text = m.group(3)
        else:
            start = cfg["intro_seconds"] + i * cfg["line_seconds"]
            text = l
        words = []
        for tok in text.split():
            accent = tok.startswith("*") and tok.endswith("*") and len(tok) > 2
            tok = tok.strip("*")
            if cfg["uppercase"] and not _DEVA.search(tok):
                tok = tok.upper()
            words.append((tok, accent))
        if words:
            lines.append({"start": start, "words": words})
    lines.sort(key=lambda d: d["start"])
    for a, b in zip(lines, lines[1:]):
        a["end"] = b["start"]
    if lines:
        lines[-1]["end"] = lines[-1]["start"] + cfg["line_seconds"]
    return lines


def layout_line(line, cfg, W, H, pos):
    """Compute word masks + positions for one lyric line, centred at pos."""
    max_w = W * 0.86
    px = int(W * cfg["font_size"])
    while True:
        items = []
        for text, accent in line["words"]:
            deva = bool(_DEVA.search(text))
            font = FONTS / (cfg["font_devanagari"] if deva else cfg["font_latin"])
            size = int(px * (cfg["accent_scale"] if accent else 1.0))
            mask, ox, oy, adv = GLYPHS.render(text, font, size)
            items.append({"mask": mask, "ox": ox, "oy": oy, "adv": adv, "accent": accent})
        space = px * 0.30
        rows, cur, cur_w = [], [], 0.0
        for it in items:
            add = it["adv"] + (space if cur else 0)
            # keep rows short (reel style): wrap on width or after 3 words
            if cur and (cur_w + add > max_w or len(cur) >= 3):
                rows.append((cur, cur_w))
                cur, cur_w, add = [], 0.0, it["adv"]
            cur.append(it)
            cur_w += add
        rows.append((cur, cur_w))
        if max(w for _, w in rows) <= max_w or px < 24:
            break
        px = int(px * 0.92)
    row_h = px * 1.28
    cx, cy = pos[0] * W, pos[1] * H
    top = cy - row_h * len(rows) / 2
    placed = []
    for r, (row, rw) in enumerate(rows):
        x = cx - rw / 2
        base = top + r * row_h + px * 0.95
        for it in row:
            it["x"] = int(round(x + it["ox"]))
            it["y"] = int(round(base + it["oy"]))
            pad = max(6, px // 6)
            sh = Image.fromarray(np.pad(it["mask"], pad))
            it["shadow"] = np.asarray(sh.filter(ImageFilter.GaussianBlur(pad / 2.2)))
            it["pad"] = pad
            placed.append(it)
            x += it["adv"] + space
    n = len(placed)
    dur = line["end"] - line["start"]
    reveal = min(dur * 0.55, 0.38 * n)
    for i, it in enumerate(placed):
        it["t"] = line["start"] + (reveal * i / n if n > 1 else 0)
    box = (int(cx - max_w / 2), int(top), int(cx + max_w / 2), int(top + row_h * len(rows)))
    return placed, box


# --------------------------------------------------------------------------
# Scenes / effects
# --------------------------------------------------------------------------
def ease(p):
    p = min(max(p, 0.0), 1.0)
    return p * p * (3 - 2 * p)


class Scene:
    OVER = 1.22  # image is prepared this much larger than the frame

    def __init__(self, path, motion, W, H):
        img = Image.open(path).convert("RGB")
        tw, th = int(W * self.OVER), int(H * self.OVER)
        s = max(tw / img.width, th / img.height)
        img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
        l, t = (img.width - tw) // 2, (img.height - th) // 2
        self.img = img.crop((l, t, l + tw, t + th))
        self.motion, self.W, self.H = motion, W, H
        self.start = self.end = 0.0

    def frame(self, t):
        p = (t - self.start) / max(self.end - self.start, 1e-3)
        p = min(max(p, 0.0), 1.0)
        O = self.OVER
        z0 = z1 = 1.10
        dx0 = dx1 = dy0 = dy1 = 0.0
        m = self.motion
        if m == "zoom_in":
            z0, z1 = 1.02, 1.18
        elif m == "zoom_out":
            z0, z1 = 1.18, 1.02
        elif m == "pan_left":
            dx0, dx1 = 0.045, -0.045
        elif m == "pan_right":
            dx0, dx1 = -0.045, 0.045
        elif m == "pan_up":
            dy0, dy1 = 0.04, -0.04
        elif m == "pan_down":
            dy0, dy1 = -0.04, 0.04
        z = z0 + (z1 - z0) * p
        dx = (dx0 + (dx1 - dx0) * p) * self.W
        dy = (dy0 + (dy1 - dy0) * p) * self.H
        a = O / z  # source pixels per output pixel
        cx = self.img.width / 2 + dx * a
        cy = self.img.height / 2 + dy * a
        c = cx - a * self.W / 2
        f = cy - a * self.H / 2
        out = self.img.transform((self.W, self.H), Image.AFFINE, (a, 0, c, 0, a, f), Image.BICUBIC)
        return np.asarray(out)


class Particles:
    def __init__(self, W, H, n=46, seed=7):
        r = np.random.default_rng(seed)
        self.W, self.H = W, H
        self.x = r.uniform(0, W, n)
        self.y = r.uniform(0, H, n)
        self.vy = r.uniform(8, 30, n)
        self.wob = r.uniform(0.3, 1.2, n)
        self.ph = r.uniform(0, 6.28, n)
        self.size = r.choice([0, 0, 1, 1, 2], n)
        self.sprites = []
        for rad in (3, 6, 12):
            d = rad * 6
            im = Image.new("L", (d, d), 0)
            ImageDraw.Draw(im).ellipse((d / 2 - rad, d / 2 - rad, d / 2 + rad, d / 2 + rad), fill=255)
            self.sprites.append(np.asarray(im.filter(ImageFilter.GaussianBlur(rad * 0.7)), np.float32))

    def draw(self, frame, t, color=(255, 236, 190)):
        col = np.array(color, np.float32)
        for i in range(len(self.x)):
            sp = self.sprites[self.size[i]]
            d = sp.shape[0]
            x = int((self.x[i] + 26 * math.sin(t * self.wob[i] + self.ph[i])) % self.W) - d // 2
            y = int((self.y[i] - self.vy[i] * t) % (self.H + d)) - d
            a = 0.30 + 0.25 * math.sin(t * 1.7 * self.wob[i] + self.ph[i] * 3)
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + d, self.W), min(y + d, self.H)
            if x1 <= x0 or y1 <= y0 or a <= 0:
                continue
            m = sp[y0 - y : y1 - y, x0 - x : x1 - x, None] * (a / 255.0)
            reg = frame[y0:y1, x0:x1].astype(np.float32)
            frame[y0:y1, x0:x1] = np.minimum(reg + col * m, 255).astype(np.uint8)


class Rain:
    def __init__(self, W, H, n=150, seed=3):
        r = np.random.default_rng(seed)
        self.W, self.H = W, H
        self.x = r.uniform(-0.2 * W, 1.2 * W, n)
        self.y = r.uniform(0, H, n)
        self.v = r.uniform(1100, 1900, n)
        self.len = r.uniform(28, 70, n)

    def draw(self, frame, t, strength=1.0):
        im = Image.new("L", (self.W, self.H), 0)
        d = ImageDraw.Draw(im)
        for x, y, v, ln in zip(self.x, self.y, self.v, self.len):
            yy = (y + v * t) % (self.H + 100) - 50
            xx = x - 0.16 * (yy - y)
            d.line((xx, yy, xx - 0.16 * ln, yy + ln), fill=150, width=2)
        m = np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), np.float32)[..., None] * (0.55 * strength / 255)
        f = frame.astype(np.float32)
        f += (np.array((225, 235, 245), np.float32) - f) * m
        frame[:] = f.astype(np.uint8)


def vignette(W, H, strength):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2) / 1.414
    return (1 - strength * np.clip(r, 0, 1) ** 2.2)[..., None]


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

        self.scenes = []
        for i, sc in enumerate(cfg["scenes"]):
            s = Scene(self.dir / sc["image"], sc.get("motion") or MOTIONS[i % len(MOTIONS)], W, H)
            if "start" in sc:
                s.start = float(sc["start"])
            elif i < len(self.lines):
                s.start = max(0.0, self.lines[i]["start"] - cfg["scene_lead"]) if i else 0.0
            else:
                s.start = self.scenes[-1].start + cfg["line_seconds"]
            s.conf = sc
            self.scenes.append(s)
        for a, b in zip(self.scenes, self.scenes[1:]):
            a.end = b.start + cfg["crossfade"]
        self.scenes[-1].end = self.duration

        self.vig = vignette(W, H, cfg["vignette"]) if cfg["vignette"] else None
        self.particles = Particles(W, H) if cfg["particles"] else None
        self.rain = Rain(W, H)

        # lay out each lyric line against the scene that is on screen for it
        for ln in self.lines:
            sc = self.scene_at(ln["start"] + 0.5)
            pos = sc.conf.get("text_pos", cfg.get("text_pos", [0.5, 0.2]))
            ln["items"], box = layout_line(ln, cfg, W, H, pos)
            mode = sc.conf.get("text_color", "auto")
            if mode == "auto":
                bg = sc.frame((ln["start"] + ln["end"]) / 2)
                x0, y0, x1, y1 = [max(v, 0) for v in box]
                lum = bg[y0:y1, x0:x1].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
                mode = "dark" if lum.mean() > 150 else "light"
            if mode == "dark":
                ln["colors"] = (hex_rgb(cfg.get("dark_text", "#1b1410")),
                                hex_rgb(cfg.get("dark_accent", "#c2185b")), (255, 248, 232), 0.75)
            else:
                ln["colors"] = (hex_rgb(cfg.get("light_text", "#ffffff")),
                                hex_rgb(cfg.get("light_accent", "#ffd166")), (0, 0, 0), 0.7)

    def scene_at(self, t):
        cur = self.scenes[0]
        for s in self.scenes:
            if s.start <= t:
                cur = s
        return cur

    def render_frame(self, t):
        xf = self.cfg["crossfade"]
        idx = self.scenes.index(self.scene_at(t))
        cur = self.scenes[idx]
        frame = cur.frame(t).copy()
        if idx > 0 and t - cur.start < xf:
            k = ease((t - cur.start) / xf)
            prev = self.scenes[idx - 1].frame(t).astype(np.float32)
            frame = (prev + (frame.astype(np.float32) - prev) * k).astype(np.uint8)
        # per-scene effects (also faded with the scene)
        for j in (idx - 1, idx):
            if j < 0:
                continue
            s = self.scenes[j]
            if s.conf.get("rain"):
                k = ease((t - s.start) / xf) if j == idx else 1 - ease((t - cur.start) / xf)
                if k > 0.01:
                    self.rain.draw(frame, t, k)
        if self.particles is not None:
            self.particles.draw(frame, t)
        if self.vig is not None:
            frame = (frame.astype(np.float32) * self.vig).astype(np.uint8)
        fade = min(ease(t / 0.5), ease((self.duration - t) / 0.6))
        if fade < 1:
            frame = (frame.astype(np.float32) * fade).astype(np.uint8)
        self.draw_lyrics(frame, t)
        return frame

    def draw_lyrics(self, frame, t):
        for ln in self.lines:
            if not (ln["start"] <= t < ln["end"]):
                continue
            main, accent, shadow, sh_a = ln["colors"]
            out = ease((ln["end"] - t) / 0.3)  # line exit fade
            for it in ln["items"]:
                p = ease((t - it["t"]) / 0.25)
                if p <= 0:
                    continue
                a = p * out
                dy = int(round((1 - p) * 22 - (1 - out) * 14))
                blend(frame, it["shadow"], it["x"] - it["pad"], it["y"] - it["pad"] + dy + 3, shadow, a * sh_a)
                blend(frame, it["mask"], it["x"], it["y"] + dy, accent if it["accent"] else main, a)

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
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-t", f"{self.duration:.3f}", str(out)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        n = int(round(self.duration * self.fps))
        for i in range(n):
            proc.stdin.write(self.render_frame(i / self.fps).tobytes())
            if i % 60 == 0:
                print(f"\r{i}/{n} frames", end="", flush=True)
        proc.stdin.close()
        if proc.wait() != 0:
            raise SystemExit("ffmpeg failed")
        print(f"\rdone: {out}  ({self.duration:.1f}s, {n} frames)")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    proj = Project(sys.argv[1])
    if "--frame" in sys.argv:
        i = sys.argv.index("--frame")
        Image.fromarray(proj.render_frame(float(sys.argv[i + 1]))).save(sys.argv[i + 2])
    else:
        proj.render()


if __name__ == "__main__":
    main()
