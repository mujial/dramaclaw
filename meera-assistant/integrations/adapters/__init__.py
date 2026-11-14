"""
Meera engine adapters
=====================
Each module in this folder exposes three things:

    ENGINE_ID : str                     -- must match an id in ../manifest.json
    available() -> bool                 -- can we actually call it right now?
    handle(message: str) -> str | None  -- answer, or None if unavailable

`server.py` discovers every adapter automatically on startup and adds it to
the routing table. A broken or missing dependency never crashes the gateway:
the import is guarded and the engine simply reports "offline".

To add your own engine:
  1. copy `_template.py` to `<your_engine>.py`
  2. set ENGINE_ID, fill in available() and handle()
  3. add a matching entry to ../manifest.json so the HUD shows it
  4. restart server.py — that's it
"""

import importlib
import os
import pkgutil
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))

REGISTRY = {}   # engine_id -> module


def discover():
    """Import every adapter module in this folder and build the registry."""
    global REGISTRY
    REGISTRY = {}

    for mod_info in pkgutil.iter_modules([_HERE]):
        name = mod_info.name
        if name.startswith('_'):
            continue
        try:
            mod = importlib.import_module(__name__ + '.' + name)
        except Exception:
            traceback.print_exc()
            continue

        engine_id = getattr(mod, 'ENGINE_ID', None)
        handler = getattr(mod, 'handle', None)
        if not engine_id or not callable(handler):
            continue

        REGISTRY[engine_id] = mod

    return REGISTRY


def describe():
    """Return a light status summary for every discovered adapter."""
    out = []
    for engine_id, mod in REGISTRY.items():
        try:
            ok = bool(mod.available())
        except Exception:
            ok = False
        out.append({
            'id': engine_id,
            'available': ok,
            'doc': (mod.__doc__ or '').strip().splitlines()[0] if mod.__doc__ else '',
        })
    return out
