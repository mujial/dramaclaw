"""
MIRA — engine registry.

Reads `integrations/manifest.json` and probes each engine for real availability.
Nothing is assumed: an engine is only "ready" if it can actually be imported or
its service answers.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTEGRATIONS = ROOT / "integrations"
MANIFEST = INTEGRATIONS / "manifest.json"
VENDOR = INTEGRATIONS / "vendor"


def _manifest() -> dict:
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {"engines": []}


def _module_ok(name: str | None) -> bool:
    if not name:
        return False
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def _vendor_ok(rel: str | None) -> bool:
    if not rel:
        return False
    p = INTEGRATIONS / rel
    return p.is_dir() and bool(list(p.iterdir()))


def probe() -> list[dict]:
    out = []
    for e in _manifest().get("engines", []):
        probe_cfg = e.get("probe") or {}
        mod = _module_ok(probe_cfg.get("python_module"))
        ven = _vendor_ok(probe_cfg.get("vendor"))
        installed = mod or ven
        ready = installed and not e.get("needs_model_key", False)
        out.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "repo": e.get("repo"),
            "kind": e.get("kind"),
            "role": e.get("role"),
            "license": e.get("license"),
            "installed": installed,
            "ready": ready,
            "source": "python-package" if mod else ("vendor-checkout" if ven else None),
            "pip": e.get("pip"),
        })
    return out


def summary() -> dict:
    engines = probe()
    return {
        "engines": engines,
        "online": sum(1 for e in engines if e["ready"]),
        "installed": sum(1 for e in engines if e["installed"]),
        "total": len(engines),
    }
