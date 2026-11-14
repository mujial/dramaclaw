"""
MIRA — voice engine.

TTS chain, best available first:

  1. ElevenLabs      premium, most human — needs an API key
  2. edge-tts        Microsoft neural voices, free, no key, very human
  3. (client side)   the device's own speech engine / Web Speech API

The server returns audio bytes when it can. When it cannot, it returns a
structured `fallback: "client"` answer so the browser or the Android shell
speaks the text with its native voice. That is why the app never goes silent.

STT runs server-side through faster-whisper when the package and a model are
present; otherwise the client uses the device recogniser.
"""

from __future__ import annotations

import asyncio
import io
import json
import subprocess
import sys
from pathlib import Path

from .config import SECRETS, load_settings
from .net import verify as _verify

try:
    import httpx
except Exception:  # pragma: no cover
    httpx = None

# ---------------------------------------------------------------------------
# curated neural voice catalogue (edge-tts)
# ---------------------------------------------------------------------------

EDGE_VOICES = [
    {"id": "hi-IN-SwaraNeural",    "label": "Swara — Hindi female (warm)",     "lang": "hi-IN", "gender": "female"},
    {"id": "hi-IN-AnanyaNeural",   "label": "Ananya — Hindi female (soft)",    "lang": "hi-IN", "gender": "female"},
    {"id": "hi-IN-MadhurNeural",   "label": "Madhur — Hindi male",            "lang": "hi-IN", "gender": "male"},
    {"id": "en-IN-NeerjaNeural",   "label": "Neerja — Indian English female", "lang": "en-IN", "gender": "female"},
    {"id": "en-IN-AaravNeural",    "label": "Aarav — Indian English male",    "lang": "en-IN", "gender": "male"},
    {"id": "en-US-AriaNeural",     "label": "Aria — US English female",       "lang": "en-US", "gender": "female"},
    {"id": "en-US-JennyNeural",    "label": "Jenny — US English female",      "lang": "en-US", "gender": "female"},
    {"id": "en-GB-SoniaNeural",    "label": "Sonia — British English female", "lang": "en-GB", "gender": "female"},
]

DEFAULT_VOICE = "hi-IN-SwaraNeural"


def catalogue() -> list[dict]:
    return EDGE_VOICES


def resolve_voice(voice_id: str | None) -> str:
    if not voice_id:
        return DEFAULT_VOICE
    for v in EDGE_VOICES:
        if v["id"] == voice_id:
            return voice_id
    # allow any well-formed 5-part edge voice id
    if voice_id.count("-") >= 2 and voice_id.endswith("Neural"):
        return voice_id
    return DEFAULT_VOICE


# ---------------------------------------------------------------------------
# engine availability
# ---------------------------------------------------------------------------


def _edge_available() -> bool:
    try:
        import edge_tts  # noqa: F401
        return True
    except Exception:
        return False


def _eleven_available() -> bool:
    return SECRETS.has("elevenlabs") and httpx is not None


def status() -> dict:
    s = load_settings()
    wanted = s.get("voice_engine", "auto")
    return {
        "elevenlabs": {"configured": _eleven_available(), "needs_key": not SECRETS.has("elevenlabs")},
        "edge_tts": {"installed": _edge_available(), "needs_key": False},
        "client": {"available": True},
        "preferred": wanted,
        "voice_id": s.get("voice_id"),
        "catalogue": EDGE_VOICES,
    }


# ---------------------------------------------------------------------------
# ElevenLabs
# ---------------------------------------------------------------------------


def synth_elevenlabs(text: str, voice_id: str = "") -> tuple[bytes, str]:
    key = SECRETS.get("elevenlabs")
    if not key:
        raise RuntimeError("no ElevenLabs key")
    if httpx is None:
        raise RuntimeError("httpx is not installed")

    vid = voice_id or SECRETS.get("elevenlabs_voice") or "21m00Tcm4TlvDq8ikWAM"
    s = load_settings()
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{vid}",
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text[:4500],
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.42,
                "similarity_boost": 0.82,
                "style": 0.35,
                "use_speaker_boost": True,
            },
        },
        timeout=60,
        verify=_verify(),
    )
    if r.status_code != 200:
        detail = ""
        try:
            detail = json.dumps(r.json())[:200]
        except Exception:
            detail = (r.text or "")[:200]
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {detail}")
    return r.content, "audio/mpeg"


# ---------------------------------------------------------------------------
# edge-tts
# ---------------------------------------------------------------------------


async def _edge_synth_async(text: str, voice: str, rate: str, pitch: str) -> bytes:
    import edge_tts  # type: ignore

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            buf.write(chunk["data"])
    return buf.getvalue()


def synth_edge(text: str, voice: str, rate: float = 1.0, pitch: float = 1.0) -> tuple[bytes, str]:
    if not _edge_available():
        raise RuntimeError("edge-tts is not installed")

    # edge-tts wants relative percentages, e.g. +10% / -5Hz
    rate_pct = int(round((float(rate) - 1.0) * 100))
    pitch_hz = int(round((float(pitch) - 1.0) * 60))
    rate_s = f"{rate_pct:+d}%"
    pitch_s = f"{pitch_hz:+d}Hz"

    audio = asyncio.run(_edge_synth_async(text[:4000], voice, rate_s, pitch_s))
    if not audio:
        raise RuntimeError("edge-tts returned no audio")
    return audio, "audio/mpeg"


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------


def synthesize(text: str, voice_id: str | None = None,
               engine: str | None = None) -> dict:
    """Try each engine in order. Always returns a dict, never raises."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "fallback": "client", "error": "empty text"}

    s = load_settings()
    engine = engine or s.get("voice_engine", "auto")
    voice = resolve_voice(voice_id or s.get("voice_id"))
    rate = float(s.get("voice_rate", 1.0))
    pitch = float(s.get("voice_pitch", 1.0))

    order = ["elevenlabs", "edge"] if engine == "auto" else [engine]
    errors = []

    for eng in order:
        try:
            if eng == "elevenlabs" and _eleven_available():
                audio, mime = synth_elevenlabs(text)
                return {"ok": True, "engine": "elevenlabs", "mime": mime, "audio": audio}
            if eng == "edge" and _edge_available():
                audio, mime = synth_edge(text, voice, rate, pitch)
                return {"ok": True, "engine": "edge", "mime": mime, "voice": voice,
                        "audio": audio}
        except Exception as exc:
            errors.append(f"{eng}: {exc}")

    return {
        "ok": False,
        "fallback": "client",
        "engine": "client",
        "errors": errors,
        "hint": "No server-side voice engine was reachable; the device voice will be used.",
    }


# ---------------------------------------------------------------------------
# speech-to-text (server side, optional)
# ---------------------------------------------------------------------------

_WHISPER = None
_WHISPER_ERROR = None


def stt_status() -> dict:
    global _WHISPER_ERROR
    try:
        import faster_whisper  # noqa: F401
        installed = True
    except Exception as exc:
        installed = False
        _WHISPER_ERROR = str(exc)
    return {
        "faster_whisper": {"installed": installed, "error": _WHISPER_ERROR},
        "model_loaded": _WHISPER is not None,
        "model": "base",
    }


def transcribe_file(path: str | Path, language: str | None = None) -> dict:
    """Transcribe an audio file with faster-whisper if it is usable."""
    global _WHISPER, _WHISPER_ERROR
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:
        _WHISPER_ERROR = str(exc)
        return {"ok": False, "error": f"faster-whisper unavailable: {exc}"}

    try:
        if _WHISPER is None:
            _WHISPER = WhisperModel("base", device="cpu", compute_type="int8")
        segments, info = _WHISPER.transcribe(str(path), language=language or None, beam_size=5)
        text = " ".join(s.text.strip() for s in segments).strip()
        return {
            "ok": True,
            "text": text,
            "language": getattr(info, "language", None),
            "probability": round(float(getattr(info, "language_probability", 0.0)), 3),
        }
    except Exception as exc:
        _WHISPER_ERROR = str(exc)
        return {"ok": False, "error": f"transcription failed: {exc}"}
