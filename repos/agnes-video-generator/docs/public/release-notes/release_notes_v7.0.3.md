# Release v7.0.3 — Surviving Agnes Queue Saturation, Honest Error Messages and a Reliable Model Switch

> Release date: 2026-09-28

## Overview

v7.0.3 is a **patch release** aimed at the failure users hit most: the free Agnes video queue staying saturated for 10+ minutes. Submissions rejected with `503 video_queue_full` now retry on a dedicated track without burning the normal retry budget, and the progress panel keeps you informed — naming Agnes, quoting the raw upstream error, and telling you what to do (retry off-peak). Real failure reasons are no longer swallowed (`HTTP 503: server error` → the actual upstream message and code), switching text-model providers back to Agnes now actually takes effect, and after a frontend update the app entry page can no longer be served stale by your browser.

## Usage

From v7.0.2:

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.0.3` (then `docker compose up -d` to recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

No breaking changes and no data migration are required. Existing tasks, checkpoints and configurations remain valid.

Optional new environment variables (defaults keep prior behavior):

- `AGNES_VIDEO_QUEUE_RETRY_SECONDS` — how long to keep retrying while the Agnes video queue is full (default 900s).
- `AGNES_FIX_V25_PORTRAIT_ROTATION=1` — opt-in fix for the upstream portrait (9:16) rotation defect on Video 2.5 Flash.

## What's New

### Features & Improvements

* **Survive Agnes queue saturation.** When Agnes rejects submissions with `503 video_queue_full` (the free Video 2.5 Flash queue can stay full for 10+ minutes), the app now retries on a dedicated track — every 30–60s for up to 900s (`AGNES_VIDEO_QUEUE_RETRY_SECONDS`) — without consuming the normal retry budget, so you no longer get a premature "generation failed" while you were simply never queued. Nothing is consumed by a rejected submit. The progress panel shows it live: `Agnes 视频队列已满（HTTP 503 · video_queue_full），正在排队重试（第 N 次 / 已等 X 分钟）。建议错峰重试或稍后再试。`
* **Honest error messages.** Upstream failures now surface the real reason instead of a generic `HTTP 503: server error` or a raw dict dump: the submitted error's `code` and `message` are kept end-to-end (e.g. `ComfyUI internal error: inference not finished after 15 minutes (code=500)`), so "queue full" and "queued but stuck" are no longer indistinguishable. `error_logs/` stores readable text plus the upstream code.
* **Queue notices in your language (all 22 locales).** Queue-full progress and failure notices are now rendered by the frontend from structured i18n keys, so Japanese, Arabic, Russian, etc. users see their own language instead of a Chinese fallback. The raw upstream error (HTTP status, `video_queue_full`) is quoted untranslated, as it comes from the API.
* **Config panels start collapsed.** All four configuration cards (provider management, model selection, workspace, privacy) now start collapsed instead of expanded; your manual expand/collapse preference is still remembered per browser.
* **Know when a model is not adapted.** Video models that appear in the upstream model list but have no capability entry in your installed version are now marked with `⚠` plus an explicit notice, instead of being silently submitted with the old v2.0 pixel protocol. The app version is shown in the page footer and returned by `GET /api/models`.

### Bug Fixes

* **Switching the text model provider back to Agnes now works.** Previously the switch only changed the UI: the backend kept the previously selected third-party provider and kept calling its endpoint (an empty value was dropped by the form layer and treated as "no change"). The selection is now sent explicitly, and it persists when you click **Save**.
* **Frontend no longer breaks after an update.** The app entry page is now served with `Cache-Control: no-cache`, so browsers can no longer keep a stale entry page that references deleted build assets — the "task list (or the whole app) silently stopped working after pulling a new version" failure mode is gone. After upgrading, do one hard refresh (`Cmd/Ctrl+Shift+R`); afterwards updates apply on normal reload.
* Fixed the queue-full messaging to name Agnes, quote the raw upstream error, and include an actionable suggestion (retry off-peak), instead of the vague "upstream video queue is full".

---

No action is required after upgrading. If your tasks sit at 0% for a long time, that is the Agnes free queue — the app now retries and tells you so; off-peak retries or switching to Video 2.0 (separate queue) remain the practical workarounds.
