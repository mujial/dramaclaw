# Release v7.1.1 — Video 2.5 Default Model, Upload Validation, and Localization Fixes

> Release date: 2026-10-15

## Overview

v7.1.1 is a **patch release**. Following the upstream retirement of the legacy Video 2.0 channel, the app now defaults to **agnes-video-2.5-flash** and submits every video task through the 2.5 standard protocol. Image uploads are validated on arrival, so a corrupt or unsupported file fails immediately with a clear, localized message instead of breaking a task deep inside the pipeline. This release also makes chat calls resilient to empty responses, keeps the poetry scene-prompt builder language-neutral, and completes the translation of the feedback panel and diagnostic report across all 22 interface languages.

## Usage

From v7.1.0:

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.1.1` (then `docker compose up -d` to recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

Upgrade notes:

- **Video 2.0 is no longer supported.** The upstream v2.0 channel was decommissioned, so the legacy submission path has been removed and the default video model is now `agnes-video-2.5-flash`. If your saved configuration still pins `models.video` to `agnes-video-v2.0`, re-select a 2.5-series model in the Web UI configuration; otherwise submission targets a retired channel and fails. Duration options follow the 2.5 tiers (4–12 seconds).
- No data migration is required. Existing tasks, checkpoints and `config.json` files are read as-is.

## What's New

### Features & Improvements

- **`agnes-video-2.5-flash` is the default video model.** With the legacy Video 2.0 channel retired upstream, the model lineup now covers the 2.5 series only, and every video task is submitted through the 2.5 standard protocol (`mode` / `seconds` / `size` / `aspect_ratio`). The per-model guidance shown in the create-task form reflects the available models.
- **Configurable configuration directory for npm deployments.** A new `AGNES_CONFIG_DIR` environment variable lets `npx free-short-video` users keep `config.json` (their saved keys and settings) in a stable location such as `~/.agnes_config`, instead of inside the ephemeral npm cache that is lost on `npm cache clean` or a cache-directory change.
- **Image uploads are validated on arrival.** Non-whitelisted file types are rejected with a readable message instead of being silently rewritten, and uploaded bytes are checked to be a decodable image. A corrupt file now fails immediately with a clear, scene-scoped message rather than surfacing as a low-level error during generation.
- **Feedback panel and diagnostic report fully localized.** The remaining feedback-panel and diagnostic-report labels that still appeared in English on non-English interfaces are now translated across all 22 interface languages.

### Bug Fixes

- **Custom end-frame images keep their scene mapping.** Uploaded end-frame images are now saved to their own scene index, so an empty slot no longer shifts later images onto the wrong scenes.
- **Chat calls retry once on an empty response** instead of aborting the screenwriting stage with a `None` or `KeyError`.
- **Poetry scene prompts use a language-neutral default style.** When no style is specified, the default hint is no longer a hardcoded Chinese phrase, so non-Chinese runs stay in their own language.
- **API-key authentication diagnostics no longer write the configured site domain into the log line.**
