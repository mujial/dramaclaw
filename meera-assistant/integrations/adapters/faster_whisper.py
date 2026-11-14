"""
Faster-Whisper adapter — Meera's ears.

Whisper is a speech-to-text model, not a chat engine, so this adapter does
not answer messages. It exposes transcription helpers that the gateway can
call, and reports availability so the HUD knows offline voice is ready.

Model sizes (downloaded on first use):
    tiny   ~75 MB     base ~145 MB    small ~480 MB    medium ~1.5 GB
Set MEERA_WHISPER_MODEL to override (default: base).
"""

import os

ENGINE_ID = "faster-whisper"

_MODEL = None


def _model_size() -> str:
    return os.environ.get("MEERA_WHISPER_MODEL", "base")


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return False
    return True


def load(model_size: str | None = None):
    """Load (and cache) a WhisperModel. Heavy — call this off the main thread."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    from faster_whisper import WhisperModel  # type: ignore

    size = model_size or _model_size()
    device = os.environ.get("MEERA_WHISPER_DEVICE", "cpu")
    compute = "int8" if device == "cpu" else "float16"
    _MODEL = WhisperModel(size, device=device, compute_type=compute)
    return _MODEL


def transcribe(path: str, language: str | None = None):
    """Transcribe an audio file -> (text, detected_language, duration)."""
    if not available():
        return None
    model = load()
    segments, info = model.transcribe(path, language=language, beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    return {
        "text": text,
        "language": getattr(info, "language", None),
        "language_probability": round(getattr(info, "language_probability", 0.0), 3),
        "duration": round(getattr(info, "duration", 0.0), 2),
    }


def handle(message: str):
    """Not a chat engine — Meera handles text itself."""
    return None
