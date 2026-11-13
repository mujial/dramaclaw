# Release v7.2.1 — Durable npm Install and Agent-Friendly Startup

> Release date: 2026-10-21

## Overview

v7.2.1 is a **patch release** that fixes a durability problem in the npm / npx install of this free AI
short-video generator: the runtime, API key config, workspace and logs used to live inside the package
directory, which for `npx` is an npm cache folder — an `npm cache clean` or a version bump could take
them with it and force every Python dependency to be downloaded again. They now live in one data root,
dependencies are installed once, and the launcher gains `--detach` / `--json` / `--print-paths` for
scripted and AI-agent use. Two logging/error-hygiene fixes ride along.

## Usage

From v7.2.0 (source):

```bash
git pull
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.2.1` (then `docker compose up -d` to
recreate the container).

npm users: `npx free-short-video` or `npm install -g free-short-video`.

### Upgrading notes

- **npm / npx installs now keep data in `~/.agnes-video`** (`AGNES_HOME` or `--home <dir>` overrides it):
  `venv/`, `config/`, `workspace/`, `logs/`. Previously these sat inside the package directory.
- **Existing settings migrate automatically.** On the first run, a `.agnes_config` found in the package
  directory is copied into the new data root, so the configured API key and preferences carry over.
  Videos produced earlier are not moved.
- Docker and source installations are unaffected (same mount points / project directory as before).

## What's New

### Features & Improvements

- **Cache-proof local install.** Virtualenv, configuration, workspace and logs live under one data root
  (`~/.agnes-video` by default). Clearing the npm cache or upgrading the package no longer forces a full
  Python dependency re-download, and generated videos no longer sit inside a package folder.
- **Dependencies installed once.** `pip` runs again only when `requirements.txt` actually changed
  (sha256 fingerprint), so later starts skip the network and work offline.
- **Script and agent friendly startup.** `--detach` starts the service in the background and exits when
  it answers; `--json` prints `{ok, ready, pid, base, home, venv, workspace, log}`; `--print-paths`
  reports where each piece lives without starting anything.
- **Relocatable default workspace.** `AGNES_WORKING_DIR` decides where the default workspace points, so
  media can be kept on another disk or folder.
- **`has_key` on `GET /api/config`.** Tooling can check whether an API key is configured without parsing
  the masked prefix.

### Bug Fixes

- Failed asset imports no longer expose internal error details to the caller.
- Watermark fallback paths and ffmpeg overlay failures are now logged with stack traces, so a missing
  font or a broken overlay can be diagnosed from the log instead of an unexplained watermark.

---

**Compatibility:** no API breaks. Existing `.env` files, workspaces configured in the Web UI and keys
supplied through `AGNES_API_KEY` keep working; environment keys still use the single global domain.
