"""Faster-Whisper — offline speech to text."""
ENGINE_ID = "faster-whisper"

def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False

def handle(payload: dict):
    """payload: {path, language} -> {ok, text, language}"""
    try:
        from mira.voice import transcribe_file
    except Exception:
        return None
    p = payload or {}
    if not p.get("path"):
        return {"ok": False, "error": "no path"}
    return transcribe_file(p["path"], p.get("language"))
