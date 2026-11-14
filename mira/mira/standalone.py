"""
MIRA — standalone server (standard library only).

`server.py` is the FastAPI build for a desktop/laptop. This module is the same
API written against `http.server`, with no FastAPI, no pydantic and no uvicorn,
so MIRA's brain can run:

  * inside the Android APK (Chaquopy ships CPython, not pip wheels for
    pydantic-core), and
  * in Termux, where `pip install fastapi` is slow or impossible.

Routes are byte-for-byte compatible with server.py, so the same web UI works
against either. Start it with:

    python3 -m mira.standalone --port 8090

The WebSocket channel is not implemented here; the frontend treats /ws as a
bonus and falls back to REST automatically.
"""

from __future__ import annotations

import json
import math
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import memory, providers, tools, voice, engines
from .agent import execute as agent_execute, summarise as agent_summarise, quick_action
from .config import DEFAULTS, DATA, SECRETS, load_settings, save_settings
from .persona import detect_emotion, system_prompt

APP_NAME = "MIRA"
VERSION = "1.0.0"
STARTED = time.time()

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webp": "image/webp",
    ".png": "image/png",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


# ---------------------------------------------------------------------------
# shared logic (mirrors server.py)
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


def _build_context(text: str, session: str):
    settings = load_settings()
    history = memory.recent_episodes(session, limit=12)
    messages = [{"role": e["role"], "content": e["content"]} for e in history]

    used = []
    if settings.get("memory_enabled", True):
        used = memory.search_memories(text, limit=8)
        wants_recall = bool(re.search(r"(yaad|remember|mere bare|about me|mujhe jaanta)", text, re.I))
        if wants_recall or not used:
            seen = {m["id"] for m in used}
            for m in memory.list_memories(limit=14):
                if m["id"] not in seen:
                    used.append(m)
            used = used[:10]

    messages.append({"role": "user", "content": text})
    return messages, used


def _post_process(text: str, settings: dict) -> list[dict]:
    if not settings.get("memory_enabled", True) or not settings.get("auto_extract_memory", True):
        return []
    added = []
    for content, category in memory.extract_memories(text):
        res = memory.add_memory(content, category, confidence=0.7, source="auto-extract")
        if res.get("ok") and not res.get("deduped"):
            added.append({"id": res["id"], "content": content, "category": category})
    return added


def do_chat(body: dict) -> dict:
    text = (body.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "empty message"}
    settings = load_settings()
    session = body.get("session") or "default"
    emotion = detect_emotion(text)
    memory.add_episode(session, "user", text, emotion)

    if body.get("mode") != "agent" and quick_action(text):
        report = agent_execute(text, session=session, auto_confirm=bool(body.get("auto_confirm")))
        narration = agent_summarise(report)
        memory.add_episode(session, "mira", narration, emotion)
        return {"ok": True, "mode": "device", "reply": narration, "agent": report,
                "actions": report.get("actions") or [], "emotion": emotion,
                "provider": "agent", "model": report.get("planner"), "fallback": False,
                "memories_added": [], "memories_used": [],
                "speak": settings.get("voice_enabled", True)}

    if body.get("mode") == "agent":
        report = agent_execute(text, session=session, auto_confirm=bool(body.get("auto_confirm")))
        narration = agent_summarise(report)
        memory.add_episode(session, "mira", narration, emotion)
        return {"ok": True, "mode": "agent", "reply": narration, "agent": report,
                "actions": report.get("actions") or [],
                "emotion": emotion, "provider": "agent", "model": report.get("planner"),
                "fallback": False, "memories_added": [], "memories_used": [],
                "speak": settings.get("voice_enabled", True)}

    messages, used = _build_context(text, session)
    settings["_memories"] = used
    result = providers.chat(messages, settings)

    reply = (result.get("text") or "").strip() or "Kuch samajh nahi aaya, phir se bolo?"
    memory.add_episode(session, "mira", reply, emotion)
    added = _post_process(text, settings)

    return {
        "ok": True, "mode": "chat", "reply": reply, "emotion": emotion,
        "provider": result.get("provider"), "model": result.get("model"),
        "fallback": result.get("fallback", False), "error": result.get("error"),
        "memories_used": [m["content"] for m in used], "memories_added": added,
        "speak": settings.get("voice_enabled", True),
    }


def do_status() -> dict:
    settings = load_settings()
    return {
        "app": APP_NAME, "version": VERSION,
        "uptime_sec": round(time.time() - STARTED, 1), "time": _now_iso(),
        "provider": {
            "active": settings.get("provider"),
            "model": settings.get("model") or providers.GEMINI_DEFAULT_MODEL,
            "base_url": settings.get("base_url") or "",
            "gemini_configured": SECRETS.has("gemini"),
            "openai_configured": SECRETS.has("openai"),
            "elevenlabs_configured": SECRETS.has("elevenlabs"),
            "telemetry": providers.TELEMETRY,
        },
        "secrets": {"encrypted": SECRETS.encrypted, "names": SECRETS.names(),
                    "file": str(DATA / "secrets.bin")},
        "memory": memory.stats(),
        "voice": voice.status(),
        "stt": voice.stt_status(),
        "skills": tools.skills(),
        "engines": engines.probe(),
        "engine_summary": engines.summary(),
        "settings": settings,
    }


def do_keys_test(body: dict) -> dict:
    provider = (body.get("provider") or "").lower()
    settings = load_settings()
    key = (body.get("key") or "").strip()
    if key:
        old = SECRETS.get(provider)
        SECRETS.set(provider, key)
        try:
            return providers.test_connection(provider, settings.get("model", ""),
                                             settings.get("base_url", ""))
        finally:
            SECRETS.set(provider, old or "")
    return providers.test_connection(provider, settings.get("model", ""),
                                     settings.get("base_url", ""))


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = f"MIRA/{VERSION}"
    protocol_version = "HTTP/1.1"

    # ---- helpers ---------------------------------------------------------

    def _send(self, status: int, body: bytes, ctype: str = "application/json",
              extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, payload, status: int = 200):
        self._send(status, json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if not n:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def log_message(self, fmt, *args):  # quieter than the default
        if os.environ.get("MIRA_VERBOSE"):
            sys.stderr.write("  " + (fmt % args) + "\n")

    def do_OPTIONS(self):
        self._send(204, b"")

    # ---- routing ---------------------------------------------------------

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method: str):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        q = {k: v[0] for k, v in qs.items()}

        try:
            if path.startswith("/api/"):
                self._api(method, path, q)
            else:
                self._static(path)
        except Exception as exc:  # never leave the client hanging
            import traceback
            traceback.print_exc()
            self._json({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500)

    # ---- API -------------------------------------------------------------

    def _api(self, method: str, path: str, q: dict):
        if path == "/api/health" and method == "GET":
            return self._json({"ok": True, "app": APP_NAME, "version": VERSION,
                               "uptime_sec": round(time.time() - STARTED, 1)})

        if path == "/api/status" and method == "GET":
            return self._json(do_status())

        if path == "/api/chat" and method == "POST":
            body = self._body()
            if body.get("stream"):
                return self._stream_chat(body)
            return self._json(do_chat(body))

        if path == "/api/agent" and method == "POST":
            b = self._body()
            goal = (b.get("goal") or "").strip()
            if not goal:
                return self._json({"ok": False, "error": "empty goal"}, 400)
            report = agent_execute(goal, session=b.get("session") or "default",
                                   auto_confirm=bool(b.get("auto_confirm")))
            return self._json({"ok": True, "agent": report, "reply": agent_summarise(report)})

        if path == "/api/tools/run" and method == "POST":
            b = self._body()
            name = b.get("tool")
            if not name:
                return self._json({"ok": False, "error": "missing tool"}, 400)
            return self._json(tools.run_tool(name, b.get("args") or {}))

        if path == "/api/skills" and method == "GET":
            return self._json({"skills": tools.skills(), "tools": tools.catalogue()})

        m = re.match(r"^/api/skills/(.+)/toggle$", path)
        if m and method == "POST":
            name = urllib.parse.unquote(m.group(1))
            enabled = q.get("enabled", "true") != "false"
            s = load_settings()
            disabled = set(s.get("disabled_skills") or [])
            disabled.discard(name) if enabled else disabled.add(name)
            save_settings({**s, "disabled_skills": sorted(disabled)})
            return self._json({"ok": True, "skill": name, "enabled": enabled})

        # ---- memory ----
        if path == "/api/memory" and method == "GET":
            cat = q.get("category", "all")
            limit = int(q.get("limit", 300) or 300)
            return self._json({"memories": memory.list_memories(cat, limit=max(1, min(1000, limit))),
                               "categories": memory.CATEGORIES, "stats": memory.stats()})

        if path == "/api/memory" and method == "POST":
            b = self._body()
            content = (b.get("content") or "").strip()
            if not content:
                return self._json({"ok": False, "error": "empty content"}, 400)
            if memory.looks_sensitive(content):
                return self._json({"ok": False,
                                   "error": "Refused: this looks like a secret or credential."}, 400)
            res = memory.add_memory(content, b.get("category") or "fact",
                                    confidence=0.9, source="manual")
            return self._json({"ok": bool(res.get("ok")), **res})

        m = re.match(r"^/api/memory/(\d+)$", path)
        if m:
            mid = int(m.group(1))
            if method == "PATCH":
                b = self._body()
                res = memory.update_memory(mid, b.get("content"), b.get("category"), b.get("pinned"))
                return self._json({"ok": bool(res.get("ok")), "error": res.get("reason"),
                                   "memories": memory.list_memories(limit=300),
                                   "stats": memory.stats()})
            if method == "DELETE":
                return self._json({"ok": memory.delete_memory(mid),
                                   "memories": memory.list_memories(limit=300),
                                   "stats": memory.stats()})

        if path == "/api/memory/search" and method == "GET":
            text = q.get("q", "")
            if not text.strip():
                return self._json({"results": []})
            return self._json({"query": text, "results": memory.search_memories(text, limit=20)})

        if path == "/api/memory/recall" and method == "GET":
            return self._json(memory.contextual_recall(q.get("q", ""), q.get("session", "default")))

        if path == "/api/memory/export" and method == "GET":
            blob = json.dumps(memory.export_all(), indent=2, ensure_ascii=False).encode("utf-8")
            name = f"mira-backup-{time.strftime('%Y%m%d-%H%M%S')}.json"
            return self._send(200, blob, "application/json",
                              {"Content-Disposition": f'attachment; filename="{name}"'})

        # ---- history ----
        if path == "/api/history" and method == "GET":
            session = q.get("session", "default")
            limit = int(q.get("limit", 200) or 200)
            return self._json({"session": session,
                               "messages": memory.conversation_history(session, limit=limit),
                               "sessions": memory.sessions()})
        if path == "/api/history" and method == "DELETE":
            session = q.get("session")
            if session:
                return self._json({"ok": True, "deleted": memory.delete_session(session)})
            return self._json({"ok": True, "deleted": memory.clear_all_history()})

        # ---- settings ----
        if path == "/api/settings" and method == "GET":
            return self._json({"settings": load_settings(), "defaults": DEFAULTS})
        if path == "/api/settings" and method == "PUT":
            b = self._body()
            updated = save_settings({**load_settings(), **(b.get("settings") or {})})
            return self._json({"ok": True, "settings": updated})

        # ---- keys ----
        if path == "/api/keys" and method == "GET":
            return self._json({
                "keys": SECRETS.public_view(), "encrypted": SECRETS.encrypted,
                "note": ("Stored encrypted with AES-GCM on this device." if SECRETS.encrypted
                         else "cryptography unavailable — keys are file-protected only (0600).")})

        if path == "/api/keys" and method == "POST":
            b = self._body()
            name = (b.get("provider") or "").strip().lower()
            key = (b.get("key") or "").strip()
            if not key:
                return self._json({"ok": False, "error": "empty key"}, 400)
            if name not in {"gemini", "openai", "elevenlabs"}:
                return self._json({"ok": False, "error": "unknown provider"}, 400)
            SECRETS.set(name, key)
            settings = load_settings()
            switched = False
            if name in {"gemini", "openai"} and settings.get("provider") in (None, "", "local"):
                settings["provider"] = name
                switched = True
            if name == "gemini" and not (settings.get("model") or "").strip():
                settings["model"] = providers.GEMINI_DEFAULT_MODEL
            if switched:
                settings = save_settings(settings)
            return self._json({"ok": True, "provider": name, "encrypted": SECRETS.encrypted,
                               "active_provider": settings.get("provider"),
                               "switched": switched,
                               "model": settings.get("model") or providers.GEMINI_DEFAULT_MODEL,
                               "hint": ("Key saved and switched to " + name) if switched
                                       else "Key saved"})

        m = re.match(r"^/api/keys/([a-z]+)$", path)
        if m and method == "DELETE":
            return self._json({"ok": SECRETS.delete(m.group(1))})

        if path == "/api/keys/test" and method == "POST":
            return self._json(do_keys_test(self._body()))

        # ---- voice ----
        if path == "/api/voice" and method == "GET":
            return self._json(voice.status())

        if path == "/api/tts" and method == "POST":
            b = self._body()
            text = (b.get("text") or "").strip()
            if not text:
                return self._json({"ok": False, "fallback": "client", "error": "empty text"}, 400)
            result = voice.synthesize(text, b.get("voice_id"), b.get("engine"))
            if result.get("ok") and result.get("audio"):
                return self._send(200, result["audio"], result.get("mime", "audio/mpeg"),
                                  {"X-Mira-Engine": result.get("engine", ""),
                                   "X-Mira-Voice": str(result.get("voice", ""))})
            return self._json({"ok": False, "fallback": "client",
                               "engine": result.get("engine"),
                               "errors": result.get("errors", []),
                               "hint": result.get("hint")})

        if path == "/api/stt" and method == "POST":
            return self._json(self._handle_stt())

        # ---- privacy ----
        if path == "/api/privacy/wipe" and method == "POST":
            if not self._body().get("confirm"):
                return self._json({"ok": False, "error": "confirmation required"}, 400)
            return self._json({"ok": True,
                               "episodes_deleted": memory.clear_all_history(),
                               "memories_deleted": memory.clear_memories()})

        return self._json({"ok": False, "error": f"no route: {method} {path}"}, 404)

    # ---- streaming chat (SSE, close-delimited) --------------------------

    def _stream_chat(self, body: dict):
        """Stream the reply token-by-token so her voice can start early."""
        text = (body.get("text") or "").strip()
        if not text:
            return self._json({"ok": False, "error": "empty message"}, 400)

        settings = load_settings()
        session = body.get("session") or "default"
        emotion = detect_emotion(text)

        # device commands are instant — no reason to stream them
        if body.get("mode") != "agent" and quick_action(text):
            payload = do_chat(body)
            return self._sse_iter([payload])

        memory.add_episode(session, "user", text, emotion)
        messages, used = _build_context(text, session)
        settings["_memories"] = used
        settings["_mood"] = emotion

        def gen():
            pieces = []
            try:
                yield {"type": "start", "emotion": emotion,
                       "memories_used": [m["content"] for m in used]}
                for delta in providers.stream_chat(messages, settings):
                    pieces.append(delta)
                    yield {"type": "delta", "text": delta}
            except Exception as exc:
                yield {"type": "error", "error": f"{type(exc).__name__}: {exc}"}

            reply = "".join(pieces).strip()
            if not reply:
                reply = "Kuch samajh nahi aaya, phir se bolo?"
                yield {"type": "delta", "text": reply}

            memory.add_episode(session, "mira", reply, emotion)
            added = _post_process(text, settings)
            yield {"type": "done", "reply": reply, "mode": "chat", "emotion": emotion,
                   "provider": settings.get("provider"), "memories_added": added,
                   "memories_used": [m["content"] for m in used], "speak": True}

        return self._sse_iter(gen())

    def _sse_iter(self, events):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            for ev in events:
                self.wfile.write(("data: " + json.dumps(ev, ensure_ascii=False, default=str)
                                  + "\n\n").encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    # ---- multipart STT (minimal, no dependencies) ------------------------

    def _handle_stt(self) -> dict:
        ctype = self.headers.get("Content-Type") or ""
        if "multipart/form-data" not in ctype:
            return {"ok": False, "error": "expected multipart/form-data"}
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(n)
        boundary = ctype.split("boundary=", 1)[-1].strip().strip('"').encode()
        parts = raw.split(b"--" + boundary)
        import tempfile, uuid
        for part in parts:
            if b"filename=" not in part:
                continue
            head, _, payload = part.partition(b"\r\n\r\n")
            payload = payload.rsplit(b"\r\n", 1)[0]
            name = b"clip.webm"
            fm = re.search(rb'filename="([^"]+)"', head)
            if fm:
                name = fm.group(1)
            suffix = Path(name.decode("utf-8", "replace")).suffix or ".webm"
            tmp = Path(tempfile.gettempdir()) / f"mira-{uuid.uuid4().hex}{suffix}"
            try:
                tmp.write_bytes(payload)
                return voice.transcribe_file(tmp)
            finally:
                try:
                    tmp.unlink(missing_ok=True)
                except Exception:
                    pass
        return {"ok": False, "error": "no file part"}

    # ---- static UI -------------------------------------------------------

    def _static(self, path: str):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())):
            return self._json({"ok": False, "error": "forbidden"}, 403)

        if not target.is_file():
            # SPA fallback for the five views
            target = WEB_DIR / "index.html"
        if not target.is_file():
            return self._json({"ok": False, "error": "UI not found"}, 404)

        ctype = MIME.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] \
            or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)


def serve(host: str = "0.0.0.0", port: int = 8090, web_dir: str | Path | None = None,
          quiet: bool = False):
    global WEB_DIR
    if web_dir:
        WEB_DIR = Path(web_dir).resolve()
    memory.init()

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True

    if not quiet:
        print("=" * 62)
        print("  M I R A   —   personal AI companion (standalone)")
        print("=" * 62)
        st = memory.stats()
        print(f"  UI          http://{host}:{port}/")
        print(f"  web dir     {WEB_DIR}")
        print(f"  memory      {st['memories']} memories, {st['episodes']} turns")
        print(f"  secrets     {'AES-GCM encrypted' if SECRETS.encrypted else 'file-protected'}")
        print(f"  gemini key  {'yes' if SECRETS.has('gemini') else 'not set (Local Core active)'}")
        print("=" * 62)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def start_background(host: str = "127.0.0.1", port: int = 8090,
                     web_dir: str | Path | None = None) -> ThreadingHTTPServer:
    """Start in a daemon thread and return the server (Android shell uses this)."""
    global WEB_DIR
    if web_dir:
        WEB_DIR = Path(web_dir).resolve()
    memory.init()
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True, name="mira-http").start()
    return httpd


def free_port(start: int = 8090, tries: int = 20) -> int:
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return start


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="MIRA standalone server (stdlib only)")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--web", default=str(WEB_DIR))
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    serve(a.host, a.port, a.web, quiet=a.quiet)
