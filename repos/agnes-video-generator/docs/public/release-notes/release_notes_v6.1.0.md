# Release v6.1.0 — First-Retry Feedback: Self-Heal Transient Failures, Then Report with One Click

> Release date: 2026-08-25

## Overview

v6.1.0 is a **minor version** that closes the feedback loop for failed generation tasks. When a task fails, the progress page now leads you to **retry first** (reusing the existing checkpoint resume — most failures are transient rate limits, timeouts, or model-service hiccups and heal on their own). If retries keep failing, a feedback area **auto-expands** with a **one-click diagnostic report**: copy the structured info (app version, task type, failed step, error message, retry count, key configs) or jump to a **pre-filled GitHub Issue** — no need to describe your environment manually. A new **diagnostics endpoint** ties the task to its model-call error details, and the official FAQ explains the in-app feedback flow.

## Usage

From v6.0.0:

```bash
git pull
.venv/bin/pip install -r requirements.txt
./start.sh
```

No data migration required. Existing tasks, auto mode, and manual mode behavior are unchanged. The new feedback UI is served with the rest of the frontend — just hard-refresh the page if you upgraded from an older version.

## What's New

### Retry-First Guidance on Task Failure

The failed-task panel now gives you a clear action path instead of a dead-end error line:

- **Retry Task button** — resumes the task from the failed step via the existing checkpoint resume (no new backend endpoint, no full resubmit).
- **Retry count tracking** — retries are counted per task and persist across refreshes; the count resets when the task succeeds.
- **Transient-failure copy** — the panel explains that most failures come from temporary rate limiting / network timeouts / model-service fluctuation and are worth retrying before reporting.

### One-Click Issue Feedback with Progressive Expansion

When retries don't help, the feedback area helps you report efficiently:

- **Progressive expansion** — the feedback area stays a low-key hint line under the retry guidance; after **2 failed retries** it auto-expands, switching the copy to "still failing after N retries, please report with diagnostic info." You can open it manually at any time (your choice is remembered per task).
- **Deterministic-failure pre-screen** — parameter/content errors (HTTP 400, content policy, invalid API key) are detected from the error text, skip the retry guidance, and expand the feedback area directly with a "retrying may not help" hint and a de-emphasized retry button.
- **Diagnostic info preview** — a collapsible structured report: app version, task type, mode, failed step, error message, retry count, and key generation configs (no prompt text included).
- **Copy diagnostic info** — one click copies the full report for pasting anywhere.
- **Check the FAQ first** — a direct link to the official FAQ page for self-service troubleshooting.
- **Open a GitHub Issue** — jumps to the project issue tracker with title and body pre-filled from the diagnostic report (long bodies are safely truncated); a bug-report issue template is available in the repo.

### Diagnostics Endpoint (Phase 2)

- **`GET /api/tasks/{id}/diagnostics`** — returns a task summary plus the model-call error details associated with that task (exact task match first, time-window fallback), sourced from the existing `error_logs/` collector.
- **Task-linked error collection** — model errors are now written with their `task_id`, so a failure can be traced back to the exact API calls that caused it.
- **Privacy by design** — the endpoint never returns prompt text, response bodies, or system prompts; error messages are truncated. The feedback report is fully client-side and **nothing is uploaded automatically**.

### Other Features & Improvements

- **App version in diagnostics** — `APP_VERSION` is now exposed via `GET /api/config`, so every report carries the exact version that failed (kept in sync by the release process).
- **Official FAQ updated** — new entries explain what to do when generation fails (retry first, then report with diagnostic info) and how to get help / report issues; synced across the official site and wiki.

---
