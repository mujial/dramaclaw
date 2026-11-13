# Release v7.0.2 — Clearer API Key & Domain Setup, Corrected Resolutions and Language Switcher

> Release date: 2026-09-28

## Overview

v7.0.2 is a **patch release** focused on the issues users hit most. It makes API key and endpoint-domain configuration unambiguous — the top cause of `401` / "invalid token" — by explaining the difference between `.env`-supplied keys and web-UI keys, fixing a hint that asked users to bind a domain on `.env` keys that cannot be bound, and adding an explicit multi-key warning. It also corrects landscape video to true 16:9 with fixed resolution labels, refreshes the language selector into a site-styled switcher, and repairs the Docker image pull path. The new guidance is documented in Getting Started, the FAQ and the `.env.example` template, in English and Chinese.

## Usage

From v7.0.1:

```bash
git pull
.venv/bin/pip install -r requirements.txt
./start.sh
```

Docker users: `docker pull ghcr.io/lcy362/free-short-video:7.0.2` (then `docker compose up -d` to recreate the container). Note the image now lives at the flat path `ghcr.io/lcy362/free-short-video` — earlier nested-path references never resolved.

npm users: `npx free-short-video` or `npm install -g free-short-video`.

No breaking changes and no data migration are required. Existing tasks, checkpoints and configurations remain valid.

## What's New

### Features & Improvements

* **Clearer key/domain setup to prevent `401`.** The API Key panel now states, per source, that keys added in the web UI can be bound to their own domain (and are covered by *Auto-detect domains*), while `.env` / environment-variable keys always follow the single **global default domain** and cannot be bound individually. Each `.env` key now shows a neutral "follows global domain" badge with the resolved endpoint. A new **multi-key** note explains that a single mismatched or expired key makes tasks intermittently fail with `401` whenever that key is picked. Getting Started and the FAQ gained a "match the key to the right site" section, and `.env.example` now spells out the `.env`-key behavior — so single-site users set the domain and mixed-site users move keys into the web config page.
* **True 16:9 landscape.** Landscape (16:9) video now renders at the correct aspect ratio, and the portrait / large-landscape resolution option labels were fixed so the listed size matches what is actually generated.
* **Refreshed language switcher.** The native browser language dropdown was replaced with a site-styled language switcher, consistent with the rest of the UI across all 22 locales.

### Bug Fixes

* Fixed the config page recommending "bind a matching domain for each key" on `.env`-sourced keys, which have no domain dropdown and cannot be bound — the misleading hint that repeatedly sent users down the wrong path when chasing `401` errors. The *Auto-detect domains* tooltip now correctly states it only probes web-UI keys.
* Corrected the Docker/compose image reference to the real flat GHCR namespace, so documented pull commands actually resolve.

---

No action is required after upgrading. If you were hitting `401`, re-check your key against its site in the API Key panel or run *Auto-detect domains*.
