"""
MIRA engine adapters.

Each module exposes:
    ENGINE_ID : str
    available() -> bool
    handle(payload) -> dict | None

`handle` is intentionally generic: voice adapters take text or a file path,
the agent adapter takes a goal. server.py / mira/voice.py call them directly.
"""
import importlib, pkgutil, traceback

_HERE = __import__('os').path.dirname(__file__)
REGISTRY = {}

def discover():
    global REGISTRY
    REGISTRY = {}
    for info in pkgutil.iter_modules([_HERE]):
        if info.name.startswith('_'):
            continue
        try:
            mod = importlib.import_module(__name__ + '.' + info.name)
        except Exception:
            traceback.print_exc()
            continue
        eid = getattr(mod, 'ENGINE_ID', None)
        if eid and callable(getattr(mod, 'handle', None)):
            REGISTRY[eid] = mod
    return REGISTRY
