# MIRA — personal AI companion

> "MIRA is not just a chatbot."
> Ek companion jo yaad rakhti hai, bolti hai, aur kaam karti hai — tumhare phone par.

Ye ek **chalne wala** app hai, mockup nahi. Server + web UI + voice + memory + agent,
sab wired hai. Jo cheez key maangti hai, wo saaf-saaf batati hai — jhooth nahi bolti.

---

## 1. Ye kya kar sakti hai (aaj, is code me)

| Kaam | Kaise | Status |
|---|---|---|
| Hinglish me baat karna | `LocalCore` offline + Gemini/OpenAI-compatible | ✅ works |
| Tumhe yaad rakhna | 3-layer SQLite memory, auto-extraction, dedupe | ✅ works |
| "Kal kya hua tha" poochna | episodes + day recall | ✅ works |
| Bolna (human-like) | edge-tts neural voices (free) → ElevenLabs → device | ✅ code ready* |
| Sunna | Browser Web Speech STT + server-side faster-whisper | ✅ works |
| Beech me tokna | VAD + tap, speech interrupt | ✅ works |
| Kaam karna | 13 tools, planner, verify, confirm-gate | ✅ works |
| GitHub repo padhna | live `api.github.com` | ✅ works |
| Notes / reminders | local notes store | ✅ works |
| Poora data mitana | `/api/privacy/wipe` | ✅ works |

\* edge-tts Microsoft ke public endpoint par jaata hai. Is dev sandbox me network
blocked hai, isliye `/api/tts` yahan `{"fallback":"client"}` lautata hai — tumhare
phone/PC par ye asli neural voice degi. Ye code me handle kiya hua hai, dhoka nahi.

### Jo paise/key maangta hai (साफ़ बात)
- **Gemini / OpenAI / ElevenLabs** — key tumhare apne account ki. Bina key ke Local Core chalega.
- **faster-whisper** server-side — pehli baar model download hota hai (~75 MB `base`).
- **open-interpreter** — `OPENAI_API_KEY` ke bina off rehta hai (jaan-boojh kar).

---

## 2. Chalana

```bash
cd mira
pip install -r requirements.txt
python3 server.py --port 8090
```

Browser: **http://localhost:8090** — bas. Koi build step nahi, koi npm nahi.

Server `0.0.0.0` par bind karta hai, isliye same WiFi ke phone se bhi khul jaayega:
`http://<tumhara-ip>:8090`.

### Android APK — poora brain andar

`mira-android/` me **Chaquopy** hai: asli CPython APK ke andar chalta hai, MIRA ka
standard-library server `127.0.0.1` par uthta hai, aur WebView bas wahi khinch
leta hai. Matlab **koi laptop nahi, koi Termux nahi, koi WiFi server nahi** — app
kholte hi MIRA zinda, uske apne phone me.

```bash
cd mira-android && ./sync-assets.sh        # UI ko assets me daalta hai
```

CI se signed APK: `.github/workflows/build-mira-apk.yml` (Actions → run).
Banaya hua APK yahan commit hota hai:

```
mira-android/ci-out/MIRA-Companion.apk     836 KB
package  com.mira.companion  v1.0
minSdk   29 (Android 10)   targetSdk 34
perms    INTERNET, RECORD_AUDIO, VIBRATE, ACCESS_NETWORK_STATE
```

**APK me kya-kya hai:**
- ✅ Poora brain: memory, agent, tools, providers, voice, Gemini TTS — sab in-process
- ✅ Poora UI, native Hindi TTS, native continuous STT, mic permission handling
- ✅ `mira.standalone` — FastAPI ke bina chalne wala same API (stdlib only), isliye
  pydantic/uvicorn ke Android wheels ki zaroorat hi nahi
- ✅ Fallback: agar embedded Python kabhi start na ho, shell bundled UI khol deta hai
  aur LAN server bhi set kar sakte ho (**Settings → MIRA server**)

**Kya nahi hai:** faster-whisper (CTranslate2 ka Android wheel nahi hai) aur
edge-tts (aiohttp). Isliye APK me STT phone ka native recogniser karta hai aur
awaaz **Gemini TTS** se aati hai — jo already sabse accha option hai.

Desktop bhi waise hi chalta hai:

```bash
python3 server.py --port 8090          # FastAPI build (websocket bhi)
python3 -m mira.standalone --port 8090 # stdlib build (APK ke andar yahi chalta hai)
```

---

## 3. Architecture

```
mira/
├── server.py            FastAPI: REST + WebSocket + static UI
├── mira/
│   ├── config.py        paths, DEFAULTS, AES-GCM SecretStore
│   ├── persona.py       SYSTEM_PROMPT, emotion detect
│   ├── memory.py        SQLite: episodes / memories / actions
│   ├── providers.py     Gemini, OpenAI-compatible, LocalCore, fallback chain
│   ├── tools.py         @tool registry — 13 tools, JSON schema, permissions
│   ├── agent.py         plan → execute → verify → narrate
│   ├── voice.py         TTS chain + faster-whisper STT
│   ├── engines.py       installed engines ka live probe
│   └── net.py           TLS trust store (certifi + system CAs)
├── web/                 index.html, app.css, app.js, assets/
├── integrations/        manifest.json, install script, adapters/
└── data/                mira.db, settings.json, secrets.bin (gitignored)
```

### Baat kaise hoti hai
```
mic ──► Web Speech STT ──► POST /api/chat ──► memory recall
                                              │
                            ┌─────────────────┴──────────────────┐
                       mode=chat                            mode=agent
                            │                                    │
                    Gemini / OpenAI /                    plan → tools →
                    LocalCore fallback                   verify → narrate
                            │                                    │
                    memory auto-extract ◄────────────────────────┘
                            │
                      reply + emotion
                            │
        /api/tts (edge-tts) ─┴─ fallback: browser SpeechSynthesis
                            │
                    avatar lip-sync (data-state)
```

### Memory — teen layer
1. **Short-term** — `episodes`: har turn, session ke saath.
2. **Long-term** — `memories`: durable facts, `fingerprint` se dedupe, category, pin.
3. **Contextual** — `contextual_recall()`: "kal", "pichle hafte" jaise sawaal par
   us din ke episodes wapas.

Auto-extraction regex-based hai (model-free) — English + Hinglish dono:
`my name is X`, `mera naam X`, `i love X`, `mujhe X pasand`, `i live in X`,
`main X me rehta`, `remember that ...`, `yaad rakho ...`.

**Kabhi store nahi hota:** password, OTP, CVV, PIN, API key, Aadhaar — `looks_sensitive()`
pehle hi rok deta hai (auto aur manual dono raaste me).

### Agent ka contract
```json
{
  "goal": "delete all my data",
  "planner": "offline",
  "status": "needs_confirmation",
  "pending_confirmation": {"tool": "delete_all_data", "args": {}, "step": 1},
  "steps": [...],
  "verify": {"verified": false, "reason": "waiting for the user's approval"}
}
```
- `permission="confirm"` wale tools **ruk jaate hain** — UI me Allow/No chip aata hai.
- `_verify()` sirf tab `verified: true` deta hai jab har executed step `ok` ho.
- Kuch na chale to `summarise()` saaf bolta hai: *"Poora nahi kar payi. 'X' par atak gayi: …"*

### Voice chain (robotic nahi)

| Priority | Engine | Voice | Kyun |
|---|---|---|---|
| 1 | **Gemini TTS** | Kore / Aoede / Leda / Zephyr … | MIRA ki apni awaaz, female, Hinglish me natural |
| 2 | ElevenLabs | koi bhi | premium (key chahiye) |
| 3 | edge-tts | hi-IN-SwaraNeural | free Microsoft neural, no key |
| 4 | device voice | phone ka | offline, har phone me |

Gemini TTS `gemini-2.5-flash-preview-tts` se aati hai: server PCM leta hai,
WAV me wrap karta hai, browser/WebView seedha bajata hai. Settings me voice
dropdown me **★ Gemini** group pehle aata hai; `gemini:Kore` jaisa id engine ko
pin kar deta hai.

Frontend audio ko **AnalyserNode** se padhta hai aur usi se mouth animate karta hai —
lip-sync asli awaaz se aata hai, random timer se nahi. Device voice par synthetic
envelope use hota hai.

---

## 4. API

| Method | Path | Kya |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/status` | provider, memory, voice, engines, secrets |
| POST | `/api/chat` | `{text, mode:"chat"\|"agent", auto_confirm}` |
| POST | `/api/tools/run` | `{tool, args}` — koi bhi registered tool |
| GET/POST/PATCH/DELETE | `/api/memory[...]` | list / add / edit / delete |
| GET | `/api/memory/search?q=` | keyword search |
| GET | `/api/memory/recall?q=` | contextual (day-wise) |
| GET | `/api/memory/export` | JSON backup download |
| GET/PUT | `/api/settings` | settings |
| GET/POST/DELETE | `/api/keys[...]` | encrypted key CRUD |
| POST | `/api/keys/test` | asli connection test (jhooth nahi) |
| GET | `/api/skills` | tools + skills |
| GET | `/api/voice` | engines + 8-voice catalogue |
| POST | `/api/tts` | MP3 bytes ya `{fallback:"client"}` |
| POST | `/api/stt` | audio file → text |
| POST | `/api/privacy/wipe` | sab mitana (`confirm:true`) |
| WS | `/ws` | `thinking` → `reply` stream |

Docs: `/api/docs`.

---

## 5. Engines (alag repos, MIRA me wired)

`integrations/manifest.json` me pinned, `install-integrations.sh` se install:

```bash
cd mira/integrations
./install-integrations.sh --check      # kya installed hai
./install-integrations.sh --engine edge-tts
./install-integrations.sh --list       # saare engines
```

| Engine | Repo | License | Role |
|---|---|---|---|
| edge-tts | rany2/edge-tts | GPL-3.0 | MIRA ki awaaz |
| faster-whisper | SYSTRAN/faster-whisper | MIT | offline STT |
| openWakeWord | dscripka/openWakeWord | Apache-2.0 | wake word |
| mem0 | mem0ai/mem0 | Apache-2.0 | richer memory (opt) |
| open-interpreter | openinterpreter/openinterpreter | Apache-2.0 | deep tasks (opt) |

`mira/engines.py` inhe **live probe** karta hai (`find_spec`), aur Skills screen par
honest card dikhata hai — installed / offline. Jhoothi "enabled" state nahi.

---

## 6. Privacy

- Keys `data/secrets.bin` me **AES-GCM** se encrypted (machine-bound key file `0600`).
- UI ko key kabhi wapas nahi milti — sirf `••••1234` hint.
- `data/` poora gitignored hai.
- Bina internet sab kuch chalta hai except Gemini/edge-tts.
- Ek button se sab mit jaata hai — `POST /api/privacy/wipe`.

---

## 7. Test results (aaj, is repo me)

```
core        health, status, engines             PASS
chat        reply, auto-memory, offline recall  PASS
agent       run, math, confirm-gate, no-lie     PASS
tools       7/7 incl. live GitHub               PASS
memory      list, edit(dup-guard), delete, search PASS
settings    save + persist                      PASS
keys        store, mask, honest test, delete    PASS
voice       catalogue, honest TTS fallback      PASS
ws          thinking → reply                    PASS
──────────────────────────────────────────────────────
33 passed, 0 failed
```

Reproduce: `python3 tests/e2e.py` (server chalu hone ke baad).

---

## 8. Jo abhi missing hai (honest list)

- **Always-on wake word** — openWakeWord adapter ready hai, par Android 10 par
  background mic unrestricted nahi milta. App khula ho tab hi sun rahi hai.
- **True streaming STT** — abhi utterance ke baad transcribe hota hai.
- **Multi-user / cloud sync** — single device, by design.
- **APK** — wrapper is repo me hai; signed build CI se (see workflow).
