"""openWakeWord — local wake-word detection (groundwork for hands-free)."""
ENGINE_ID = "openwakeword"

_MODEL = None

def available() -> bool:
    try:
        import openwakeword  # noqa: F401
        return True
    except Exception:
        return False

def handle(payload: dict):
    """payload: {pcm: bytes|list, sample_rate: int} -> {ok, detections}"""
    global _MODEL
    try:
        from openwakeword.model import Model
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    try:
        if _MODEL is None:
            _MODEL = Model()
        p = payload or {}
        pcm = p.get("pcm")
        if pcm is None:
            return {"ok": False, "error": "no pcm data"}
        scores = _MODEL.predict(pcm)
        hits = {k: float(v) for k, v in (scores or {}).items() if float(v) > 0.5}
        return {"ok": True, "detections": hits}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
