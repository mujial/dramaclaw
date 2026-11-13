# Release v7.0.4 — No More False Failures from Upstream 404s, and Visibility into Upstream API Errors

> Release date: 2026-09-28

## Overview

v7.0.4 is a **patch release** that removes a whole class of false failures and adds visibility into upstream API errors. Under Agnes peak load a submitted video task can stay invisible to polling for 10+ minutes, and those transient `404` responses are no longer treated as failures — tasks that were simply not ready yet no longer get killed. On top of that, upstream API errors are now tracked by HTTP status code, model type and API method (aggregated per task, reported anonymously), so recurring upstream problems such as `503` queue saturation can be seen as a trend instead of isolated one-off errors.

## Usage

From v7.0.3:

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.0.4` (then `docker compose up -d` to recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

No breaking changes and no data migration are required. Existing tasks, checkpoints and configurations remain valid. No new environment variables are introduced.

## What's New

### Features & Improvements

* **Upstream API error trends.** Errors that carry an HTTP status code are now aggregated per task — by status code, model type (chat / image / video) and API method — and returned by the task detail API. The frontend reports them anonymously as `api_error` events, and task-failure / creation-failure events now carry the extracted status code as well, so recurring upstream failures (for example `503 video_queue_full`) can be tracked as a trend over time instead of being seen as unrelated single errors. The aggregation lives in memory for the lifetime of the task and is cleared with it; `error_logs/` remains the offline source of truth.
* **Honest "not ready yet" state while polling.** A transient `404` while waiting for a submitted video is now an expected intermediate state rather than an error. It no longer consumes the consecutive-failure budget and no longer gets flushed into `error_logs`, so the failure panel and the logs stop reporting failures for tasks that were in fact still queued upstream.

### Refactoring & Optimizations

* Regression coverage for the upstream error-handling path: consecutive `404`s followed by a successful completion, and a permanent `404` that correctly falls back to the overall polling timeout.

### Bug Fixes

* Fixed video tasks failing with a spurious error when the upstream gateway had not made the task record visible yet — a state observed for 420s and even 1100s+ under peak load. The overall polling timeout stays as the final backstop, and it keeps the `video_id` so the task can be resumed rather than reported as a server-confirmed failure.

---

No action is required after upgrading. If a task still fails, the failure panel now shows the real upstream reason with its HTTP status code, and repeated upstream errors of the same kind become visible as a trend.
