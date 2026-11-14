#!/usr/bin/env python3
"""
MIRA — application server.

FastAPI + WebSocket backend for the companion UI.

    python3 server.py            # http://0.0.0.0:8090
    python3 server.py --port 9000

Design notes
  * every endpoint degrades gracefully — a missing API key or a dead network
    never breaks the app, it just returns an honest status
  * secrets are encrypted at rest (see mira/config.py) and never returned
  * memory is local SQLite; nothing leaves the device unless you configure a
    cloud provider
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from mira import agent, engines, memory, providers, tools, voice
from mira.config import (DATA, DEFAULTS, ROOT, SECRETS, WEB, load_settings,
                         save_settings)
from mira.persona import detect_emotion, system_prompt

APP_NAME = "MIRA"
VERSION = "1.0.0"
STARTED = time.time()

memory.init()

app = FastAPI(title=f"{APP_NAME} API", version=VERSION, docs_url="/api/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


class ChatIn(BaseModel):
    text: str
    session: str = "default"
    mode: str = "chat"            # chat | agent
    auto_confirm: bool = False
    stream: bool = False


class MemoryIn(BaseModel):
    content: str
    category: str = "fact"


class MemoryPatch(BaseModel):
    content: str | None = None
    category: str | None = None
    pinned: bool | None = None


class KeyIn(BaseModel):
    provider: str
    key: str = ""   # empty => "test the key already stored"


class SettingsIn(BaseModel):
    settings: dict


class TtsIn(BaseModel):
    text: str
    voice_id: str | None = None
    engine: str | None = None


class AgentIn(BaseModel):
    goal: str
    session: str = "default"
    auto_confirm: bool = False


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _build_context(text: str, session: str) -> tuple[list[dict], list[dict]]:
    """Return (messages for the model, memories used)."""
    settings = load_settings()
    history = memory.recent_episodes(session, limit=12)
    messages = [{"role": e["role"], "content": e["content"]} for e in history]

    used_memories = []
    if settings.get("memory_enabled", True):
        used_memories = memory.search_memories(text, limit=8)
        # A question like "tumhe mere bare me kya yaad hai" has no keywords to
        # match on, so keyword search alone would return nothing. For recall
        # questions (and when nothing matched at all) top up with the most
        # recent durable memories.
        wants_recall = bool(re.search(r"(yaad|remember|mere bare|about me|mujhe jaanta)", text, re.I))
        if wants_recall or not used_memories:
            seen = {m["id"] for m in used_memories}
            for m in memory.list_memories(limit=14):
                if m["id"] not in seen:
                    used_memories.append(m)
            used_memories = used_memories[:10]

    messages.append({"role": "user", "content": text})
    return messages, used_memories


def _chat_payload(body: ChatIn) -> dict:
    """Device-command shortcut: same payload the non-streaming chat returns."""
    text = (body.text or "").strip()
    settings = load_settings()
    session = body.session or "default"
    emotion = detect_emotion(text)
    report = agent.execute(text, session=session, auto_confirm=body.auto_confirm)
    narration = agent.summarise(report)
    memory.add_episode(session, "mira", narration, emotion)
    return {"ok": True, "mode": "device", "reply": narration, "agent": report,
            "actions": report.get("actions") or [], "emotion": emotion,
            "provider": "agent", "model": report.get("planner"), "fallback": False,
            "memories_added": [], "memories_used": [], "speak": True}


def _post_process(text: str, reply: str, settings: dict) -> list[dict]:
    """Auto-extract durable memories from what the user just said."""
    if not settings.get("memory_enabled", True) or not settings.get("auto_extract_memory", True):
        return []
    added = []
    for content, category in memory.extract_memories(text):
        res = memory.add_memory(content, category, confidence=0.7, source="auto-extract")
        if res.get("ok") and not res.get("deduped"):
            added.append({"id": res["id"], "content": content, "category": category})
    return added


# ---------------------------------------------------------------------------
# streaming chat (SSE) — voice starts on the first sentence
# ---------------------------------------------------------------------------


def _stream_chat(body: ChatIn):
    text = (body.text or "").strip()
    if not text:
        return JSONResponse({"ok": False, "error": "empty message"}, status_code=400)

    settings = load_settings()
    session = body.session or "default"
    emotion = detect_emotion(text)

    # instant device commands do not need to be streamed
    if body.mode != "agent" and agent.quick_action(text):
        payload = _chat_payload(body)
        def device():
            yield "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
        return StreamingResponse(device(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store"})

    memory.add_episode(session, "user", text, emotion)
    messages, used = _build_context(text, session)
    settings["_memories"] = used
    settings["_mood"] = emotion

    def gen():
        pieces = []
        yield "data: " + json.dumps({"type": "start", "emotion": emotion,
                                     "memories_used": [m["content"] for m in used]},
                                    ensure_ascii=False) + "\n\n"
        try:
            for delta in providers.stream_chat(messages, settings):
                pieces.append(delta)
                yield "data: " + json.dumps({"type": "delta", "text": delta},
                                            ensure_ascii=False) + "\n\n"
        except Exception as exc:
            yield "data: " + json.dumps({"type": "error",
                                         "error": f"{type(exc).__name__}: {exc}"},
                                        ensure_ascii=False) + "\n\n"

        reply = "".join(pieces).strip() or "Kuch samajh nahi aaya, phir se bolo?"
        memory.add_episode(session, "mira", reply, emotion)
        added = _post_process(text, reply, settings)
        yield "data: " + json.dumps({
            "type": "done", "reply": reply, "mode": "chat", "emotion": emotion,
            "provider": settings.get("provider"), "memories_added": added,
            "memories_used": [m["content"] for m in used], "speak": True,
        }, ensure_ascii=False) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store",
                                      "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# core status
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {"ok": True, "app": APP_NAME, "version": VERSION,
            "uptime_sec": round(time.time() - STARTED, 1)}


@app.get("/api/status")
def status():
    settings = load_settings()
    mem_stats = memory.stats()
    return {
        "app": APP_NAME,
        "version": VERSION,
        "uptime_sec": round(time.time() - STARTED, 1),
        "time": _now_iso(),
        "provider": {
            "active": settings.get("provider"),
            "model": settings.get("model") or providers.GEMINI_DEFAULT_MODEL,
            "base_url": settings.get("base_url") or "",
            "gemini_configured": SECRETS.has("gemini"),
            "openai_configured": SECRETS.has("openai"),
            "elevenlabs_configured": SECRETS.has("elevenlabs"),
            "telemetry": providers.TELEMETRY,
        },
        "secrets": {
            "encrypted": SECRETS.encrypted,
            "names": SECRETS.names(),
            "file": str(DATA / "secrets.bin"),
        },
        "memory": mem_stats,
        "voice": voice.status(),
        "stt": voice.stt_status(),
        "skills": tools.skills(),
        "engines": engines.probe(),
        "engine_summary": engines.summary(),
        "settings": settings,
    }


# ---------------------------------------------------------------------------
# chat
# ---------------------------------------------------------------------------


@app.post("/api/chat")
def chat(body: ChatIn):
    if getattr(body, "stream", False):
        return _stream_chat(body)
    text = (body.text or "").strip()
    if not text:
        return JSONResponse({"ok": False, "error": "empty message"}, status_code=400)

    settings = load_settings()
    session = body.session or "default"
    emotion = detect_emotion(text)

    memory.add_episode(session, "user", text, emotion)

    # ---- device commands work from plain chat too ---------------------
    # "youtube kholo" must open YouTube, not return an essay about it.
    if body.mode != "agent":
        quick = agent.quick_action(text)
        if quick:
            report = agent.execute(text, session=session, auto_confirm=body.auto_confirm)
            narration = agent.summarise(report)
            memory.add_episode(session, "mira", narration, emotion)
            return {
                "ok": True,
                "mode": "device",
                "reply": narration,
                "agent": report,
                "actions": report.get("actions") or [],
                "emotion": emotion,
                "provider": "agent",
                "model": report.get("planner"),
                "fallback": False,
                "memories_added": [],
                "memories_used": [],
                "speak": True,
            }

    # ---- agent mode: act, then narrate --------------------------------
    if body.mode == "agent":
        report = agent.execute(text, session=session, auto_confirm=body.auto_confirm)
        narration = agent.summarise(report)
        memory.add_episode(session, "mira", narration, emotion)
        return {
            "ok": True,
            "mode": "agent",
            "reply": narration,
            "agent": report,
            "actions": report.get("actions") or [],
            "emotion": emotion,
            "provider": "agent",
            "model": report.get("planner"),
            "fallback": False,
            "memories_added": [],
        }

    # ---- normal conversation ------------------------------------------
    messages, used_memories = _build_context(text, session)
    settings["_memories"] = used_memories

    result = providers.chat(messages, settings)

    # a broken/empty reply still gets stored so the transcript stays honest
    reply = (result.get("text") or "").strip() or "Kuch samajh nahi aaya, phir se bolo?"

    memory.add_episode(session, "mira", reply, emotion)
    added = _post_process(text, reply, settings)

    return {
        "ok": True,
        "mode": "chat",
        "reply": reply,
        "emotion": emotion,
        "provider": result.get("provider"),
        "model": result.get("model"),
        "fallback": result.get("fallback", False),
        "error": result.get("error"),
        "memories_used": [m["content"] for m in used_memories],
        "memories_added": added,
        "speak": settings.get("voice_enabled", True),
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """Real-time channel: emits `thinking` before the reply arrives."""
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {"text": raw}

            text = (payload.get("text") or "").strip()
            if not text:
                await ws.send_json({"type": "error", "error": "empty message"})
                continue

            session = payload.get("session") or "default"
            await ws.send_json({"type": "thinking", "at": _now_iso()})

            # reuse the REST path so both transports behave identically
            body = ChatIn(text=text, session=session,
                          mode=payload.get("mode", "chat"),
                          auto_confirm=bool(payload.get("auto_confirm")))
            result = chat(body)
            if isinstance(result, JSONResponse):
                result = json.loads(result.body.decode("utf-8"))
            result["type"] = "reply"
            await ws.send_json(result)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "error": str(exc)})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# agent
# ---------------------------------------------------------------------------


@app.post("/api/agent")
def run_agent(body: AgentIn):
    if not (body.goal or "").strip():
        return JSONResponse({"ok": False, "error": "empty goal"}, status_code=400)
    report = agent.execute(body.goal.strip(), session=body.session,
                           auto_confirm=body.auto_confirm)
    return {"ok": True, "report": report, "reply": agent.summarise(report)}


@app.get("/api/agent/history")
def agent_history():
    return {"actions": memory.recent_actions(20)}


# ---------------------------------------------------------------------------
# memory
# ---------------------------------------------------------------------------


@app.get("/api/memory")
def get_memories(category: str = "all", limit: int = 300):
    return {
        "memories": memory.list_memories(category, limit=max(1, min(1000, limit))),
        "categories": memory.CATEGORIES,
        "stats": memory.stats(),
    }


@app.post("/api/memory")
def add_memory(body: MemoryIn):
    if memory.looks_sensitive(body.content):
        return JSONResponse(
            {"ok": False, "error": "Refused: this looks like a secret or credential."},
            status_code=400,
        )
    res = memory.add_memory(body.content, body.category, confidence=0.9, source="manual")
    return {"ok": bool(res.get("ok")), **res}


@app.patch("/api/memory/{mem_id}")
def patch_memory(mem_id: int, body: MemoryPatch):
    res = memory.update_memory(mem_id, body.content, body.category, body.pinned)
    return {"ok": bool(res.get("ok")), "error": res.get("reason"),
            "memories": memory.list_memories(limit=300),
            "stats": memory.stats()}


@app.delete("/api/memory/{mem_id}")
def remove_memory(mem_id: int):
    return {"ok": memory.delete_memory(mem_id),
            "memories": memory.list_memories(limit=300),
            "stats": memory.stats()}


@app.get("/api/memory/search")
def search_memory(q: str = ""):
    if not q.strip():
        return {"results": []}
    return {"query": q, "results": memory.search_memories(q, limit=20),
            "recall": memory.contextual_recall(q)["day_episodes"] and "day-found" or ""}


@app.get("/api/memory/recall")
def recall(q: str = "", session: str = "default"):
    return memory.contextual_recall(q, session)


@app.get("/api/memory/export")
def export_memory():
    payload = memory.export_all()
    blob = json.dumps(payload, indent=2, ensure_ascii=False)
    fname = f"mira-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        content=blob,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ---------------------------------------------------------------------------
# history
# ---------------------------------------------------------------------------


@app.get("/api/history")
def history(session: str = "default", limit: int = 200):
    return {
        "session": session,
        "messages": memory.conversation_history(session, limit=limit),
        "sessions": memory.sessions(),
    }


@app.delete("/api/history")
def clear_history(session: str | None = None):
    if session:
        return {"ok": True, "deleted": memory.delete_session(session)}
    return {"ok": True, "deleted": memory.clear_all_history()}


# ---------------------------------------------------------------------------
# settings + keys
# ---------------------------------------------------------------------------


@app.get("/api/settings")
def get_settings():
    return {"settings": load_settings(), "defaults": DEFAULTS}


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    updated = save_settings({**load_settings(), **(body.settings or {})})
    return {"ok": True, "settings": updated}


@app.get("/api/keys")
def list_keys():
    return {
        "keys": SECRETS.public_view(),
        "encrypted": SECRETS.encrypted,
        "note": ("Stored encrypted with AES-GCM on this device."
                 if SECRETS.encrypted else
                 "cryptography is unavailable — keys are file-protected only (0600)."),
    }


@app.post("/api/keys")
def set_key(body: KeyIn):
    name = (body.provider or "").strip().lower()
    if not (body.key or "").strip():
        return JSONResponse({"ok": False, "error": "empty key"}, status_code=400)
    if name not in {"gemini", "openai", "elevenlabs"}:
        return JSONResponse({"ok": False, "error": "unknown provider"}, status_code=400)
    if not (body.key or "").strip():
        return JSONResponse({"ok": False, "error": "empty key"}, status_code=400)
    SECRETS.set(name, body.key.strip())

    # Saving a key used to leave the app on Local Core, which looks exactly
    # like "the key does nothing". Switch to it and fill in a working model.
    settings = load_settings()
    switched = False
    if name in {"gemini", "openai"} and settings.get("provider") in (None, "", "local"):
        settings["provider"] = name
        switched = True
    if name == "gemini" and not (settings.get("model") or "").strip():
        settings["model"] = providers.GEMINI_DEFAULT_MODEL
    if switched:
        settings = save_settings(settings)

    return {"ok": True, "provider": name, "encrypted": SECRETS.encrypted,
            "active_provider": settings.get("provider"), "switched": switched,
            "model": settings.get("model") or providers.GEMINI_DEFAULT_MODEL,
            "hint": ("Key saved and switched to " + name) if switched else "Key saved"}


@app.delete("/api/keys/{provider}")
def delete_key(provider: str):
    SECRETS.set(provider.lower(), "")
    return {"ok": True, "provider": provider}


@app.post("/api/keys/test")
def test_key(body: KeyIn):
    provider = (body.provider or "").lower()
    settings = load_settings()
    if body.key:
        # test without persisting
        old = SECRETS.get(provider)
        SECRETS.set(provider, body.key.strip())
        try:
            result = providers.test_connection(provider, settings.get("model", ""),
                                               settings.get("base_url", ""))
        finally:
            SECRETS.set(provider, old or "")
        return result
    return providers.test_connection(provider, settings.get("model", ""),
                                     settings.get("base_url", ""))


# ---------------------------------------------------------------------------
# skills
# ---------------------------------------------------------------------------


@app.get("/api/skills")
def get_skills():
    return {"skills": tools.skills(), "tools": tools.catalogue()}


@app.post("/api/skills/{name}/toggle")
def toggle_skill(name: str, enabled: bool = True):
    s = load_settings()
    disabled = set(s.get("disabled_skills") or [])
    if enabled:
        disabled.discard(name)
    else:
        disabled.add(name)
    save_settings({**s, "disabled_skills": sorted(disabled)})
    return {"ok": True, "skill": name, "enabled": enabled}


@app.post("/api/tools/run")
async def run_tool_endpoint(request: Request):
    body = await request.json()
    name = body.get("tool")
    args = body.get("args") or {}
    if not name:
        return JSONResponse({"ok": False, "error": "missing tool"}, status_code=400)
    return tools.run_tool(name, args)


# ---------------------------------------------------------------------------
# voice
# ---------------------------------------------------------------------------


@app.get("/api/voice")
def voice_status():
    return voice.status()


@app.post("/api/tts")
def tts(body: TtsIn):
    text = (body.text or "").strip()
    if not text:
        return JSONResponse({"ok": False, "fallback": "client", "error": "empty text"},
                            status_code=400)
    result = voice.synthesize(text, body.voice_id, body.engine)
    if result.get("ok") and result.get("audio"):
        return Response(
            content=result["audio"],
            media_type=result.get("mime", "audio/mpeg"),
            headers={
                "X-Mira-Engine": result.get("engine", ""),
                "X-Mira-Voice": result.get("voice", ""),
                "Cache-Control": "no-store",
            },
        )
    return JSONResponse({
        "ok": False,
        "fallback": "client",
        "engine": result.get("engine"),
        "errors": result.get("errors", []),
        "hint": result.get("hint"),
    })


@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    suffix = Path(file.filename or "clip.webm").suffix or ".webm"
    tmp = Path(tempfile.gettempdir()) / f"mira-{uuid.uuid4().hex}{suffix}"
    try:
        tmp.write_bytes(await file.read())
        result = voice.transcribe_file(tmp)
        return result
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# privacy
# ---------------------------------------------------------------------------


@app.post("/api/privacy/wipe")
async def wipe(request: Request):
    body = await request.json()
    if not body.get("confirm"):
        return JSONResponse({"ok": False, "error": "confirmation required"}, status_code=400)
    episodes = memory.clear_all_history()
    memories = memory.clear_memories()
    return {"ok": True, "episodes_deleted": episodes, "memories_deleted": memories}


# ---------------------------------------------------------------------------
# static UI
# ---------------------------------------------------------------------------

if (WEB / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(WEB / "assets")), name="assets")


@app.get("/")
def index():
    idx = WEB / "index.html"
    if not idx.exists():
        return JSONResponse({"error": "web/index.html is missing"}, status_code=500)
    return FileResponse(str(idx), media_type="text/html", headers={"Cache-Control": "no-store"})


@app.get("/{path:path}")
def static_fallback(path: str):
    if path.startswith("api/"):
        return JSONResponse({"error": "not found"}, status_code=404)
    target = (WEB / path).resolve()
    try:
        target.relative_to(WEB.resolve())
    except ValueError:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if target.is_file():
        return FileResponse(str(target))
    return FileResponse(str(WEB / "index.html"), media_type="text/html")


# ---------------------------------------------------------------------------
# entry
# ---------------------------------------------------------------------------


def main() -> None:
    import uvicorn

    ap = argparse.ArgumentParser(description="MIRA companion server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8090)))
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()

    print("=" * 64)
    print("  M I R A   —   personal AI companion")
    print("=" * 64)
    print(f"  UI          http://{args.host}:{args.port}/")
    print(f"  API docs    http://{args.host}:{args.port}/api/docs")
    print(f"  memory      {memory.stats()['memories']} memories, "
          f"{memory.stats()['episodes']} turns")
    print(f"  secrets     {'AES-GCM encrypted' if SECRETS.encrypted else 'file-permission only'}")
    print(f"  gemini key  {'yes' if SECRETS.has('gemini') else 'not set (Local Core active)'}")
    print("=" * 64)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
