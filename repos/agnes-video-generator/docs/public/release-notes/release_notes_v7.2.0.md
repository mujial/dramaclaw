# Release v7.2.0 — Jimeng (Dreamina) External Asset Mode for AI Video Generation

> Release date: 2026-10-20

## Overview

v7.2.0 is a **feature release** that adds a third execution mode: **external assets (Jimeng / Dreamina collaboration)**. Instead of generating every shot with the Agnes video model, you can produce the pictures and native audio in Jimeng and import the clips back — storyboarding, prompt drafting, normalization, subtitle alignment and stitching stay inside the app. This release also makes subtitle burning survive an ffmpeg build without libass, and adds a batch import path that normalizes and probes every imported clip.

## Usage

From v7.1.1:

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.2.0` (then `docker compose up -d` to recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

Upgrade notes:

- No data migration is required. Existing tasks, checkpoints and `config.json` files are read as-is.
- The new mode is available for the long-video task types (creative, manuscript, poetry, anchor). Simple video and simple image keep the auto/manual choices.
- External assets require an account with the external tool (Jimeng gives daily free credits); the app never calls that tool's API — you copy a prompt, generate, then import the files.

## What's New

### Features & Improvements

- **External asset mode with Jimeng (Dreamina) collaboration.** A third execution mode next to auto and manual. At each checkpoint the app renders a ready-to-copy creation prompt for the selected tool — picture, audio and duration constraints included — so the storyboard stays consistent while the shots come from Jimeng's video model with native audio.
  - The **videos checkpoint prompt is the storyboard script itself**, numbered per scene with its target duration, so it can be pasted into Jimeng scene by scene.
  - The videos checkpoint validates that every scene clip is present before you continue, and reviews the imported stills at the references checkpoint.
  - The tool list comes from a registry (`GET /api/providers`); Jimeng is the only entry for now and custom tools are intentionally not user-definable.
- **Batch import with normalization and probing.** Select several mp4/png files at once: clips are scaled and padded to the task resolution, re-timed to 30 fps with H.264/AAC, and stills are normalized to PNG. Each file is reported back with duration, resolution, frame rate, whether it carries an audio track, and its video/audio codec. File names map to scenes by the first number they contain (`scene_1.mp4` → scene 1), falling back to upload order, with an explicit mapping available.
- **Subtitles can follow narration or on-screen dialogue.** In external asset mode the subtitle text source is selectable: the narration script, or per-scene dialogue that the screenwriter generates alongside the video prompts — useful when the native audio is character speech.
- **Keep the original audio track.** When the video's own audio is used, the app skips TTS and silent-audio placeholders entirely, keeps each clip's audio in the final cut, and derives the subtitle timeline from the real per-clip durations.
- **The collaboration mode is labeled beta, with the official docs one click away.** The external-asset entry points carry a **Beta** bubble, and both the create panel and the checkpoint collaboration card link the official workflow guide and FAQ (including how to handle Agnes `503` / `video queue is full`), in all 22 interface languages.
- **Storyboard prompts follow the input language.** In external asset mode the scene prompts are written in the same language as the user's idea instead of being forced into English, so the prompts handed to Jimeng match what was asked for.

### Bug Fixes

- **Subtitle burning no longer silently drops subtitles when the system ffmpeg lacks libass.** The system binary is probed for the `subtitles` filter and, when missing (for example Homebrew's ffmpeg formula), the bundled static ffmpeg is used instead of degrading to a plain, subtitle-free concat.
- **Imported file names can no longer land outside their scenes.** A name carrying a year or timestamp (e.g. `20261015.mp4`) is no longer mistaken for a scene index and written to a non-existent scene directory.
- **Clips without an audio track are accepted on import** and no longer highlighted as an error: whether the clip carries audio is the user's call, and the final cut falls back to the project voiceover when it does not.
- **Chinese input stays Chinese for story and storyboard in external asset mode**, where the language pinning previously produced an English story from a Chinese idea.
- **End-frame scene indices are bounded**, closing a crafted request that could exhaust worker memory before a task was even created.

---

Compatibility: the new execution mode is additive — auto and manual behaviour is unchanged, and tasks created by earlier versions keep running with their saved mode.
