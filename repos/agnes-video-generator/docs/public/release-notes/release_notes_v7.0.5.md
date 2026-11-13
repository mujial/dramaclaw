# Release v7.0.5 — ffmpeg Resolution Unified Everywhere, Clear Errors When ffmpeg Is Missing

> Release date: 2026-09-29

## Overview

v7.0.5 is a **patch release** that fixes ffmpeg and ffprobe handling across the whole pipeline. Every ffmpeg / ffprobe invocation now resolves to a real executable through the same mechanism (system `PATH`, the bundled `imageio-ffmpeg` binary, or `FFMPEG_BINARY` / `FFPROBE_BINARY`), so a machine without a system-wide ffmpeg no longer fails with the raw `[WinError 2] The system cannot find the file specified` in the silent-audio, last-frame and end-frame steps. Where only the bundled `ffmpeg` is available and `ffprobe` is not (as in the Docker image), duration, audio-stream and video-resolution probes now fall back to parsing `ffmpeg -i` output instead of silently returning empty values.

## Usage

From v7.0.4:

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.0.5` (then `docker compose up -d` to recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

No breaking changes and no data migration are required. Existing tasks, checkpoints and configurations remain valid. No new environment variables are introduced.

## What's New

### Features & Improvements

* **Readable, localized error when ffmpeg is missing.** If no usable ffmpeg executable can be found, the task now fails with a clear message in the user's UI language that names the problem and tells you how to fix it — install ffmpeg, make sure it is on `PATH`, or point the `FFMPEG_BINARY` environment variable at its absolute path — instead of the raw `[WinError 2]` that gave no clue about what was wrong.

### Bug Fixes

* **The silent audio track no longer breaks tasks on machines without a system-wide ffmpeg.** Generating the silent narration track (used when narration is turned off, or as an automatic fallback when text-to-speech is unavailable) launched `ffmpeg` by name, so the task failed at the `audio` step with `[WinError 2] The system cannot find the file specified` even though video concatenation, watermarking and the rest of the app already used the bundled binary. Last-frame extraction and end-frame normalization had the same problem and are fixed as well.
* **Duration, audio-stream and resolution probes no longer degrade silently when `ffprobe` is missing.** In lean environments — notably the Docker image, which ships only the bundled `ffmpeg` — media probing fell back to empty values, so narration/subtitle timing, watermark placement and anchor compositing could quietly proceed on wrong assumptions. Probing now falls back to `ffmpeg -i` output and returns real values.

---

After upgrading, tasks that previously failed in the `audio` step can be resumed from the task list and will continue from the failed step — no system-wide ffmpeg installation is required.
