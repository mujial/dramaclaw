"""edge-tts — MIRA's human-sounding voice (free, no key)."""
ENGINE_ID = "edge-tts"

def available() -> bool:
    try:
        import edge_tts  # noqa: F401
        return True
    except Exception:
        return False

def voices() -> list:
    try:
        from mira.voice import EDGE_VOICES
        return EDGE_VOICES
    except Exception:
        return []

def handle(payload: dict):
    """payload: {text, voice, rate, pitch} -> {ok, mime, audio}"""
    try:
        from mira.voice import synth_edge
    except Exception:
        return None
    p = payload or {}
    try:
        audio, mime = synth_edge(p.get("text", ""),
                                 p.get("voice", "hi-IN-SwaraNeural"),
                                 float(p.get("rate", 1.0)),
                                 float(p.get("pitch", 1.0)))
        return {"ok": True, "mime": mime, "audio": audio, "engine": ENGINE_ID}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "engine": ENGINE_ID}
