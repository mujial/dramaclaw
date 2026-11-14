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
