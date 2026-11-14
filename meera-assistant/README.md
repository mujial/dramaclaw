# M.E.E.R.A. — Personal AI Assistant

**M**odular **E**ngine & **E**mpathic **R**esponse **A**ssistant

A JARVIS-class assistant HUD that runs in any browser, with a voice interface,
a live arc-reactor display, and a pluggable registry of four open-source AI
engines waiting to be switched on.

```
  ┌─────────────┬───────────────────────────┬──────────────┐
  │  SYSTEM     │                           │  ENGINES     │
  │  DIAG       │        ◉ REACTOR          │  ○ Leon      │
  │  load/power │      (voice + state)      │  ○ JARVIS    │
  │             │                           │  ● Whisper   │
  │             │   ── transcript ──        │              │
  │             │                           │  ACTIVITY    │
  └─────────────┴───────────────────────────┴──────────────┘
       ▲ speak or type          🎙 mic   ▶ send
```

---

## Quick start

```bash
# 1. run the gateway (no dependencies, pure Python stdlib)
python3 server.py                 # http://localhost:8080

# 2. that's it — the HUD loads and Meera is live
```

If you don't want to run Python, just open `index.html` directly: the HUD
falls back to its built-in JavaScript brain and every core skill still works.

---

## What she can already do

| Skill | Say this |
|---|---|
| Identity | "who are you" |
| Status report | "status report" |
| Time / date | "what time is it", "what's the date" |
| Maths | "calculate 42*19", "what is 128 divided by 4" |
| Launch sites | "open youtube", "open maps", "open gmail" |
| Web search | "search quantum computing" |
| Memory | "note call the plumber", "show my notes", "clear my notes" |
| Engine control | "switch engine leon", "engine list" |
| Voice | "mute", "unmute", or the 🔊 button |
| Wake word | the 👂 button, then say **"Meera, …"** |
| Personality | "tell me a joke", "activate protocol" |
| Standby | "shut down", "bye" |

Keyboard: `/` focuses the input, `Escape` stops speech.

---

## The four engines

Meera is the conductor. The heavy lifting is delegated to these open-source
projects, each registered in `integrations/manifest.json` with a **pinned
commit** so installs are reproducible.

| # | Engine | Repo | License | Role |
|---|---|---|---|---|
| 1 | **Open Interpreter** | [`openinterpreter/openinterpreter`](https://github.com/openinterpreter/openinterpreter) | Apache-2.0 | **Hands** — natural language → real OS actions |
| 2 | **Leon** | [`leon-ai/leon`](https://github.com/leon-ai/leon) | MIT | **Skills** — 17k★ personal-assistant framework with wake word |
| 3 | **JARVIS (HuggingGPT)** | [`microsoft/JARVIS`](https://github.com/microsoft/JARVIS) | MIT | **Planner** — LLM decomposes tasks onto specialist models |
| 4 | **Faster-Whisper** | [`SYSTRAN/faster-whisper`](https://github.com/SYSTRAN/faster-whisper) | MIT | **Ears** — fast offline speech-to-text |
| + | *openWakeWord* (optional) | [`dscripka/openWakeWord`](https://github.com/dscripka/openWakeWord) | Apache-2.0 | **Ear-drums** — offline wake word |

### Install them

```bash
cd integrations

./install-integrations.sh --check          # what is already here?
./install-integrations.sh                  # install the core four
./install-integrations.sh --all            # + openWakeWord
./install-integrations.sh --engine leon    # just one
./install-integrations.sh --pip-only       # skip the git checkout
./install-integrations.sh --clone-only     # skip pip/npm
./install-integrations.sh --clean          # remove vendor/ checkouts
```

Source checkouts land in `integrations/vendor/` (≈380 MB total, safe to delete).
Python packages install into your normal site-packages, so `--clean` never
breaks an engine that is already importable.

### Status

`./install-integrations.sh --check` and **`GET /api/status`** report the same
three states:

| State | Meaning |
|---|---|
| `offline` | not on this machine |
| `installed` | on disk, but not callable (no API key, service down) |
| `ready` | Meera can route to it right now |

The HUD mirrors this live in the **Engines** panel — click any engine to switch.

---

## API

```
GET  /                 the HUD
GET  /api/health       {"ok": true}
GET  /api/status       full engine + system report
GET  /api/engines      the raw integration manifest
POST /api/chat         {"engine": "open-interpreter", "message": "list my files"}
```

```bash
curl -s localhost:8080/api/status | jq '.engines[] | {id, ready}'
curl -s -X POST localhost:8080/api/chat \
     -H 'Content-Type: application/json' \
     -d '{"engine":"open-interpreter","message":"how much disk is free?"}'
```

---

## Adding your own engine

```bash
cp integrations/adapters/_template.py integrations/adapters/mine.py
```

Fill in three things, add an entry to `integrations/manifest.json`, restart the
gateway. The adapter is auto-discovered; a broken import can never take the
server down.

```python
ENGINE_ID = "mine"

def available() -> bool:          # can we call it right now?
    ...

def handle(message: str):         # answer, or None to fall back
    ...
```

---

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD markup |
| `styles.css` | HUD theme (cyan/amber, scanlines, corner brackets) |
| `meera.js` | Reactor canvas, diagnostics, intent router, voice I/O |
| `server.py` | Dependency-free gateway: static files + engine routing |
| `sw.js` | Service worker — full offline shell |
| `manifest.json` | PWA manifest (installable to home screen) |
| `build-standalone.py` | Bundles everything into one offline `.html` |
| `integrations/manifest.json` | Pinned engine registry |
| `integrations/install-integrations.sh` | The installer |
| `integrations/adapters/` | One file per engine |

---

## Install as an app

**Browser:** open the URL → menu → *Install app* / *Add to Home screen*.

**Android APK:** host the folder (e.g. drag the ZIP onto
[Netlify Drop](https://app.netlify.com/drop)), paste the URL into
[PWABuilder](https://www.pwabuilder.com), and generate a signed APK. Free,
no signup.

---

## Notes & limits

* The built-in brain is **rule-based**, not a language model. That is
  deliberate: the HUD works offline, instantly, with no keys. For open-ended
  conversation, switch to one of the neural engines once installed.
* Open Interpreter and HuggingGPT need an LLM provider (`OPENAI_API_KEY`, or a
  local Ollama/LM Studio endpoint). Without one they show as *installed*, not
  *ready*.
* Meera never lets an engine auto-execute code: `auto_run = False` and
  `safe_mode = "ask"` are set in the Open Interpreter adapter.
* Pinned commits are best-effort — GitHub does not always allow fetching an
  arbitrary SHA in a shallow clone, in which case the installer tracks the
  default branch and says so.

---

Built for one person, by one assistant. Say "Meera" and she answers. ◉
