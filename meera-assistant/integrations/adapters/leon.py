"""
Leon adapter — Meera's skill library.

Leon runs as its own Node service (default http://localhost:1337). This
adapter proxies text requests to that server, so Meera can borrow Leon's
skills without embedding its codebase.

Setup:
    cd integrations/vendor/leon
    npm install
    npm run build
    npm start                    # serves on :1337
Then restart server.py and Leon shows up as READY.
"""

import json
import os
import urllib.error
import urllib.request

ENGINE_ID = "leon"

BASE = os.environ.get("LEON_URL", "http://localhost:1337")
TIMEOUT = float(os.environ.get("LEON_TIMEOUT", "12"))


def _ping() -> bool:
    for path in ("/", "/health", "/api/status"):
        try:
            with urllib.request.urlopen(BASE + path, timeout=1.5) as r:
                if r.status < 500:
                    return True
        except Exception:
            continue
    return False


def available() -> bool:
    return _ping()


def handle(message: str):
    """Send a query to Leon's HTTP API.

    Leon's REST surface differs between versions, so we try the modern
    /api/query route first and fall back to the legacy one.
    """
    payloads = [
        (BASE + "/api/query", {"text": message, "session_id": "meera"}),
        (BASE + "/api/query", {"query": message}),
    ]

    for url, body in payloads:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8", "replace")
            parsed = json.loads(raw)
            for key in ("answer", "text", "message", "reply", "response"):
                if isinstance(parsed.get(key), str) and parsed[key].strip():
                    return parsed[key].strip()
            return raw[:1200] if raw.strip() else None
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 400, 405):
                continue
            return f"Leon responded with HTTP {exc.code}."
        except Exception:
            continue

    return "Leon is installed but its service is not answering. Start it with `npm start` inside integrations/vendor/leon."
