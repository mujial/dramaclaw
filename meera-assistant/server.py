#!/usr/bin/env python3
"""
M.E.E.R.A. Core Gateway
=======================
A dependency-free HTTP gateway that:
  * serves the Meera HUD (static files)
  * reports live status of the installed AI-engine integrations
  * routes chat requests to whichever engine is installed

Run:      python3 server.py [--port 8080]
Endpoints:  GET  /              -> HUD
            GET  api/status     -> {"engines":[...]}
            GET  api/engines    -> engine manifest
            POST api/chat       -> {"reply": "..."}
            GET  api/health     -> {"ok": true}

No third-party packages are required. Engine adapters are optional:
if a package or vendor checkout is missing, the engine simply reports
"offline" and the HUD falls back to its built-in JavaScript brain.
"""

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
INTEGRATIONS = os.path.join(ROOT, "integrations")
VENDOR = os.path.join(INTEGRATIONS, "vendor")
MANIFEST = os.path.join(INTEGRATIONS, "manifest.json")

# optional adapter plugins ------------------------------------------------
if INTEGRATIONS not in sys.path:
    sys.path.insert(0, INTEGRATIONS)
try:
    from adapters import discover as _discover_adapters, REGISTRY as _ADAPTERS
    _ADAPTERS = _discover_adapters()
except Exception:
    _ADAPTERS = {}

START = time.time()


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def load_manifest():
    """Return the integration manifest, or a safe default if missing."""
    try:
        with open(MANIFEST, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"engines": []}


def python_module_available(name):
    if not name:
        return False
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def dir_present(rel):
    if not rel:
        return False
    path = os.path.join(INTEGRATIONS, rel)
    return os.path.isdir(path) and bool(os.listdir(path))


def probe_engine(eng):
    """Resolve a single engine entry to {id, name, installed, ready, ...}."""
    probe = eng.get("probe", {}) or {}
    module = probe.get("python_module")
    vendor = probe.get("vendor")
    binary = probe.get("binary")

    mod_ok = python_module_available(module) if module else False
    ven_ok = dir_present(vendor) if vendor else False
    bin_ok = bool(shutil.which(binary)) if binary else False

    installed = mod_ok or ven_ok or bin_ok

    # "ready" means we could actually call it right now
    ready = installed and not eng.get("requires_api_key", False)

    adapter = _ADAPTERS.get(eng.get("id"))
    if adapter is not None:
        # An adapter can answer `installed` from disk but still not be callable
        # (missing API key, service not running), so trust the adapter for both.
        try:
            live = bool(adapter.available())
        except Exception:
            live = False
        if live:
            installed = True
        ready = live

    return {
        "id": eng.get("id"),
        "name": eng.get("name"),
        "repo": eng.get("repo"),
        "kind": eng.get("kind"),
        "license": eng.get("license"),
        "installed": installed,
        "ready": ready,
        "source": "python-package" if mod_ok else "vendor-checkout" if ven_ok else "binary" if bin_ok else None,
        "path": os.path.join(INTEGRATIONS, vendor) if ven_ok else None,
        "notes": eng.get("notes", ""),
        "adapter": bool(adapter),
    }


def status_payload():
    man = load_manifest()
    engines = [probe_engine(e) for e in man.get("engines", [])]

    # Meera's built-in router is always available
    engines.insert(0, {
        "id": "meera-core",
        "name": "Meera Core",
        "repo": "built-in",
        "kind": "NLU + intent router",
        "license": "MIT (bundled)",
        "installed": True,
        "ready": True,
        "source": "built-in",
        "path": None,
        "notes": "Ships with the app. Rule-based intent router with 20+ skills.",
    })

    online = sum(1 for e in engines if e["ready"])
    return {
        "ok": True,
        "app": "M.E.E.R.A.",
        "version": man.get("version", "1.0.0"),
        "uptime_sec": round(time.time() - START, 1),
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "engines": engines,
        "summary": {"online": online, "total": len(engines)},
    }


# ----------------------------------------------------------------------
# optional engine routing
# ----------------------------------------------------------------------
def route_chat(engine_id, message):
    """Route a chat message to whichever engine is live."""
    if engine_id in ("meera-core", "", None):
        return {
            "engine": "meera-core",
            "ok": True,
            "reply": (
                "Meera Core is the browser-side router — it answers directly in "
                "the HUD. This gateway only proxies external engines."
            ),
        }

    adapter = _ADAPTERS.get(engine_id)
    if adapter is None:
        return {
            "engine": engine_id,
            "ok": False,
            "reply": f"No adapter registered for '{engine_id}'. Add one in integrations/adapters/.",
        }

    try:
        if not adapter.available():
            return {
                "engine": engine_id,
                "ok": False,
                "reply": (
                    f"'{engine_id}' is installed but not ready. "
                    "Run integrations/install-integrations.sh and check its README section."
                ),
            }
        reply = adapter.handle(message)
    except Exception as exc:  # never let an engine take the gateway down
        return {"engine": engine_id, "ok": False, "reply": f"{engine_id} raised: {exc}"}

    if reply is None:
        return {
            "engine": "meera-core",
            "ok": True,
            "fallback": True,
            "reply": f"'{engine_id}' declined the request, so Meera Core handled it instead.",
        }
    return {"engine": engine_id, "ok": True, "reply": reply}


# ----------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # quieter logs
    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write("  api  %s\n" % (fmt % args))
        elif os.environ.get("MEERA_VERBOSE"):
            super().log_message(fmt, *args)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def end_headers(self):
        # never cache the shell, so updates land immediately
        if not self.path.startswith("/api/"):
            self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._json({"ok": True, "app": "M.E.E.R.A."})
        if path in ("/api/status", "/api/engines"):
            return self._json(status_payload())
        if path == "/api/version":
            return self._json(load_manifest())
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/chat":
            data = self._body()
            engine = data.get("engine") or "meera-core"
            msg = data.get("message") or ""
            if not msg.strip():
                return self._json({"ok": False, "reply": "Empty message."}, 400)
            return self._json(route_chat(engine, msg))
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def _p(*a):
    print(*a, flush=True)


def main():
    ap = argparse.ArgumentParser(description="M.E.E.R.A. Core Gateway")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    _p("=" * 58)
    _p("  M.E.E.R.A. CORE GATEWAY")
    _p("  HUD        http://%s:%d/" % (args.host, args.port))
    _p("  Status API http://%s:%d/api/status" % (args.host, args.port))
    _p("=" * 58)

    st = status_payload()
    _p("  engines online: %d/%d" % (st["summary"]["online"], st["summary"]["total"]))
    for e in st["engines"]:
        mark = "READY" if e["ready"] else "INSTALLED" if e["installed"] else "offline"
        _p("    [%-9s] %s" % (mark, e["name"]))
    _p("=" * 58)
    _p("  Ctrl+C to stop\n")

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        _p("\n  shutting down...")
        srv.shutdown()


if __name__ == "__main__":
    main()
