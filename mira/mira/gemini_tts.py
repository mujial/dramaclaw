"""
MIRA — Gemini native speech (female).

Uses the Gemini TTS models, which return raw 24 kHz PCM inside the normal
`generateContent` response. We wrap that PCM in a WAV container so any browser,
WebView or audio player can play it without a codec.

    POST /v1beta/models/{model}:generateContent
    { "contents": [{ "parts": [{ "text": "..." }] }],
      "generationConfig": {
        "responseModalities": ["AUDIO"],
        "speechConfig": { "voiceConfig": {
            "prebuiltVoiceConfig": { "voiceName": "Kore" } } } } }

No key => this module does nothing and `voice.synthesize()` moves on to the
next engine. It never pretends to have spoken.
"""

from __future__ import annotations

import base64
import io
import re
import wave

from .config import SECRETS, load_settings
from .net import request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-2.5-flash-preview-tts"
DEFAULT_VOICE = "Kore"

# Female voices that read Hindi/Hinglish naturally. Ordered by how well they
# carry a warm companion tone in Devanagari + Latin text.
GEMINI_VOICES = [
    {"id": "Kore",         "label": "Kore — Gemini female (warm, steady)",    "lang": "multi", "gender": "female"},
    {"id": "Aoede",        "label": "Aoede — Gemini female (breezy)",         "lang": "multi", "gender": "female"},
    {"id": "Leda",         "label": "Leda — Gemini female (young, soft)",     "lang": "multi", "gender": "female"},
    {"id": "Zephyr",       "label": "Zephyr — Gemini female (bright)",        "lang": "multi", "gender": "female"},
    {"id": "Autonoe",      "label": "Autonoe — Gemini female (calm)",         "lang": "multi", "gender": "female"},
    {"id": "Callirrhoe",   "label": "Callirrhoe — Gemini female (relaxed)",   "lang": "multi", "gender": "female"},
    {"id": "Despina",      "label": "Despina — Gemini female (smooth)",       "lang": "multi", "gender": "female"},
    {"id": "Erinome",      "label": "Erinome — Gemini female (clear)",        "lang": "multi", "gender": "female"},
]

_VOICE_IDS = {v["id"] for v in GEMINI_VOICES}


def available() -> bool:
    return SECRETS.has("gemini")


def catalogue() -> list[dict]:
    return GEMINI_VOICES


def resolve_voice(voice_id: str | None) -> str:
    """Accepts 'gemini:Kore', bare 'Kore', or anything else -> default."""
    if not voice_id:
        return DEFAULT_VOICE
    v = voice_id.split(":", 1)[-1] if ":" in voice_id else voice_id
    return v if v in _VOICE_IDS else DEFAULT_VOICE


def _pcm_to_wav(pcm: bytes, rate: int = 24000, channels: int = 1, width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _parse_mime(mime: str) -> int:
    m = re.search(r"rate=(\d+)", mime or "")
    return int(m.group(1)) if m else 24000


def _chunks(text: str, size: int = 900) -> list[str]:
    """Gemini TTS caps a request; split on sentence-ish boundaries."""
    text = re.sub(r"[ \t]+", " ", text.strip())
    if len(text) <= size:
        return [text] if text else []
    parts, cur = [], ""
    for piece in re.split(r"(?<=[.!?।\n])\s+", text):
        if len(cur) + len(piece) + 1 > size and cur:
            parts.append(cur.strip())
            cur = piece
        else:
            cur = (cur + " " + piece).strip()
    if cur:
        parts.append(cur.strip())
    return parts


def _one(text: str, voice: str, model: str, key: str, style: str = "") -> bytes:
    prompt = f"{style}\n\n{text}" if style else text
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
    }
    status, _, raw = request(
        "POST",
        f"{API_ROOT}/models/{model}:generateContent",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        json_body=body,
        timeout=90,
    )
    if status != 200:
        detail = (raw or b"")[:300].decode("utf-8", "replace")
        raise RuntimeError(f"Gemini TTS HTTP {status}: {detail}")

    import json as _json
    data = _json.loads(raw.decode("utf-8"))
    cands = data.get("candidates") or []
    if not cands:
        fb = (data.get("promptFeedback") or {}).get("blockReason")
        raise RuntimeError(f"Gemini TTS returned no candidates{f' ({fb})' if fb else ''}")

    for part in (cands[0].get("content") or {}).get("parts") or []:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            mime = inline.get("mimeType") or inline.get("mime_type") or "audio/L16;rate=24000"
            pcm = base64.b64decode(inline["data"])
            return _pcm_to_wav(pcm, rate=_parse_mime(mime))
    raise RuntimeError("Gemini TTS response contained no audio")


def synth(text: str, voice_id: str | None = None, model: str | None = None) -> tuple[bytes, str]:
    """Return (wav_bytes, 'audio/wav'). Raises with a real reason on failure."""
    key = SECRETS.get("gemini")
    if not key:
        raise RuntimeError("no Gemini key")

    settings = load_settings()
    model = model or settings.get("gemini_tts_model") or DEFAULT_MODEL
    voice = resolve_voice(voice_id or settings.get("voice_id"))

    text = (text or "").strip()
    if not text:
        raise RuntimeError("empty text")

    # Gemini reads Hindi best when told how to deliver it. Keep this short —
    # long style prompts eat into the audio budget.
    style = "Speak as a warm, natural young Indian woman. Hinglish, conversational, not robotic."

    wavs = [_one(chunk, voice, model, key, style) for chunk in _chunks(text, 900)]
    if not wavs:
        raise RuntimeError("nothing to speak")
    if len(wavs) == 1:
        return wavs[0], "audio/wav"

    # concatenate WAV frames that share the same format
    out = io.BytesIO()
    with wave.open(io.BytesIO(wavs[0]), "rb") as first:
        params = first.getparams()
    with wave.open(out, "wb") as w:
        w.setparams(params)
        for wv in wavs:
            with wave.open(io.BytesIO(wv), "rb") as r:
                w.writeframes(r.readframes(r.getnframes()))
    return out.getvalue(), "audio/wav"
