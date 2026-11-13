# Release v6.2.0 — Agnes Video 2.5 & 2.5 Flash Model Support

> Release date: 2026-08-27

## Overview

v6.2.0 is a **minor version** that adds support for the new **Agnes Video 2.5 and Video 2.5 Flash** video generation models (the Flash variant is **free for a limited time**), together with a **video model selector with capability comparison** and **model-aware form options** in the Simple Video tab — so the duration, aspect ratio, resolution quality and negative-prompt inputs automatically adapt to the selected model. It also fixes a square-output issue in the 2.5-series keyframe mode that stretched portrait/landscape footage.

## Usage

From v6.1.0:

```bash
git pull
.venv/bin/pip install -r requirements.txt
./start.sh
```

No breaking changes or data migration required. The default video model stays `agnes-video-v2.0`; you can switch to `agnes-video-2.5` (paid) or `agnes-video-2.5-flash` (free, limited time) in the settings panel or directly in the Simple Video form.

## What's New

### Features & Improvements

- **Agnes Video 2.5 & 2.5 Flash support** — the newest video generation models are now fully supported. **Video 2.5 Flash** is **free for a limited time** (720P, `$0/sec`), while **Video 2.5** adds paid quality tiers (720P / 960P / 2K). Both expose new generation modes (text / first-last-frame / image reference), 4–12s durations, and aspect-ratio-based output (21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16).
- **Video model selector with capability comparison** — video model selection is now open in the settings panel and on the Simple Video form. When choosing a model you see a detailed comparison of all three models (price, generation modes, durations, resolution, negative-prompt support, reference-image limits and reference-video support) before committing.
- **Model-aware form options (Simple Video)** — the form adapts to the selected model: generation modes, duration presets (v2.0: 5–20s; 2.5-series: 4–12s), resolution control (pixel presets vs. **aspect ratio + quality tier** with the actual output pixels shown, e.g. `9:16 · 720×1280`), and negative-prompt visibility are all driven by the chosen model's capabilities.

### Bug Fixes

- **2.5-series keyframe square-output fix** — the 2.5 / 2.5-Flash `keyframe` mode returned a fixed **704×704 square** regardless of `aspect_ratio`, stretching portrait/landscape footage (people appeared wider). Multi-image submissions now automatically fall back to the `reference` mode so output follows the requested ratio (e.g. 768×1152 input → 704×960 portrait).
- **Regression checker F3 resolution validation** — the regression suite now validates 2.5-series outputs by aspect ratio instead of absolute pixels, so 720P tier outputs (704×960) are no longer misreported as failures.

---
