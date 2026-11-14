"""
MIRA — HTTP with a sane TLS trust store.

The default `httpx` verify bundle is `certifi`. On machines behind a corporate
or sandbox TLS proxy that bundle does not contain the local root CA, so every
outbound call fails with CERTIFICATE_VERIFY_FAILED even though `curl` works
fine.

`verify` builds one context that trusts **both** certifi and the operating
system's CA store. Verification stays on — we widen the trust anchors, we never
disable the check.
"""

from __future__ import annotations

import os
import ssl

_SYSTEM_BUNDLES = (
    "/etc/ssl/certs/ca-certificates.crt",      # Debian / Ubuntu / Alpine
    "/etc/pki/tls/certs/ca-bundle.crt",        # RHEL / Fedora / CentOS
    "/etc/ssl/cert.pem",                       # macOS / BSD
    "/usr/local/share/ca-certificates",        # update-ca-certificates dir
)

_cache = None


def verify():
    """An SSLContext trusting certifi + the system store (cached)."""
    global _cache
    if _cache is not None:
        return _cache

    cafile = None
    try:
        import certifi  # type: ignore
        cafile = certifi.where()
    except Exception:
        cafile = None

    try:
        ctx = ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()
    except Exception:
        ctx = ssl.create_default_context()

    for path in _SYSTEM_BUNDLES:
        if not os.path.exists(path):
            continue
        try:
            if os.path.isdir(path):
                ctx.load_verify_locations(capath=path)
            else:
                ctx.load_verify_locations(cafile=path)
        except Exception:
            continue

    _cache = ctx
    return ctx


def describe() -> dict:
    """What trust anchors are actually in play — surfaced in /api/status."""
    bundles = [p for p in _SYSTEM_BUNDLES if os.path.exists(p)]
    try:
        import certifi  # type: ignore
        bundles.append(certifi.where())
    except Exception:
        pass
    return {"trust": "certifi + system", "bundles": bundles}


# ---------------------------------------------------------------------------
# transport that works with or without httpx
# ---------------------------------------------------------------------------
#
# httpx is the desktop dependency. Inside the Android APK (Chaquopy) and in
# Termux there may be no httpx at all, so every outbound call goes through
# `request()`, which falls back to urllib. Same TLS context either way.

import json as _json
import urllib.error
import urllib.request


def request(method: str, url: str, *, headers: dict | None = None,
            json_body: dict | None = None, data: bytes | None = None,
            timeout: float = 60, prefer: str = "auto"):
    """Return (status, headers_dict, body_bytes). Never raises for HTTP status."""
    hdrs = dict(headers or {})

    use_httpx = prefer in ("auto", "httpx")
    if use_httpx:
        try:
            import httpx  # type: ignore
        except Exception:
            httpx = None
        else:
            with httpx.Client(timeout=timeout, verify=verify()) as c:
                r = c.request(method, url, headers=hdrs, json=json_body, content=data)
                return r.status_code, dict(r.headers), r.content

    payload = data
    if json_body is not None:
        payload = _json.dumps(json_body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")

    req = urllib.request.Request(url, data=payload, headers=hdrs, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=verify()) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


class Response:
    """Tiny stand-in for an httpx.Response (only what MIRA uses)."""

    __slots__ = ("status_code", "headers", "content", "url")

    def __init__(self, status_code: int, headers: dict, content: bytes, url: str = ""):
        self.status_code = status_code
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.content = content or b""
        self.url = url

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", "replace")

    def json(self):
        return _json.loads(self.text)


def _with_params(url: str, params: dict | None) -> str:
    if not params:
        return url
    clean = {k: v for k, v in params.items() if v is not None}
    if not clean:
        return url
    sep = "&" if "?" in url else "?"
    return url + sep + urllib.parse.urlencode(clean)


def get(url: str, *, params=None, headers=None, timeout=30,
        follow_redirects=True, verify=None, **_ignored) -> Response:
    st, h, b = request("GET", _with_params(url, params), headers=headers, timeout=timeout)
    return Response(st, h, b, url)


def post(url: str, *, params=None, headers=None, json=None, data=None, timeout=60,
         verify=None, follow_redirects=True, **_ignored) -> Response:
    st, h, b = request("POST", _with_params(url, params), headers=headers,
                       json_body=json, data=data, timeout=timeout)
    return Response(st, h, b, url)
