# Release v6.2.1 — Localized Feedback & Diagnostic Report

> Release date: 2026-08-28

## Overview

v6.2.1 is a **patch release** focused on **localization (i18n)** of the in-app **feedback / diagnostics** flow. The diagnostic report and issue-template fields previously had hard-coded Chinese labels; they now follow your UI language across all 22 supported languages, so international users see correctly-translated diagnostics when submitting issues.

## Usage

From v6.2.0:

```bash
git pull
.venv/bin/pip install -r requirements.txt
./start.sh
```

No breaking changes or data migration required.

## What's New

### Bug Fixes

- **Localized feedback & diagnostic report** — the diagnostic report header, field names and the generated issue (GitHub) template are no longer hard-coded in Chinese. They now respect your UI language (22 languages), so fields, titles and truncation hints in the feedback panel render correctly for non-Chinese users.