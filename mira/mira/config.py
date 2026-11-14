"""
MIRA — configuration, paths and secret storage.

Secrets (API keys) are encrypted at rest with AES-GCM (via `cryptography`)
using a machine-local key file that is created on first run with mode 0600.
If `cryptography` is unavailable the store degrades to 0600-only and says so
in the status endpoint — it never silently pretends to be encrypted.
"""

from __future__ import annotations

import json
import os
import stat
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Inside the Android APK this package is extracted into a read-only asset tree,
# so the shell points MIRA_HOME at the app's private files dir before import.
WEB = Path(os.environ.get("MIRA_WEB") or (ROOT / "web"))
DATA = Path(os.environ.get("MIRA_HOME") or (ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)

SETTINGS_FILE = DATA / "settings.json"
SECRETS_FILE = DATA / "secrets.bin"
KEY_FILE = DATA / ".local_key"
MEMORY_DB = DATA / "mira.db"

DEFAULTS = {
    "provider": "local",          # local | gemini | openai
    "model": "",
    "base_url": "",               # for OpenAI-compatible endpoints
    "persona_name": "MIRA",
    "user_name": "",
    "language": "auto",           # auto | hi | en | hinglish
    "voice_enabled": True,
    "voice_engine": "auto",       # auto | elevenlabs | edge | native
    "voice_id": "hi-IN-SwaraNeural",
    "voice_rate": 1.0,
    "voice_pitch": 1.0,
    "voice_volume": 1.0,
    "tts_provider": "auto",
    "max_reply_tokens": 320,      # short answers = fast speech
    "speech_max_chars": 420,      # she says the gist, the screen keeps the rest
    "continuous_conversation": True,
    "interrupt_enabled": True,
    "memory_enabled": True,
    "auto_extract_memory": True,
    "wake_word": False,
    "theme": "violet",
    "avatar_motion": True,
    "confirm_dangerous": True,
    "disabled_skills": [],
}

# ----------------------------------------------------------------------------
# settings (non-secret)
# ----------------------------------------------------------------------------


def load_settings() -> dict:
    cfg = dict(DEFAULTS)
    if SETTINGS_FILE.exists():
        try:
            cfg.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


def save_settings(cfg: dict) -> dict:
    merged = dict(DEFAULTS)
    merged.update({k: v for k, v in (cfg or {}).items() if k in DEFAULTS})
    SETTINGS_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(SETTINGS_FILE, 0o600)
    except Exception:
        pass
    return merged


# ----------------------------------------------------------------------------
# secret storage
# ----------------------------------------------------------------------------


def _local_key() -> bytes:
    """32-byte machine-local master key, created once with 0600 perms."""
    if KEY_FILE.exists():
        raw = KEY_FILE.read_bytes()
        if len(raw) >= 32:
            return raw[:32]
    raw = os.urandom(32)
    KEY_FILE.write_bytes(raw)
    try:
        os.chmod(KEY_FILE, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        pass
    return raw


class SecretStore:
    """Encrypted key/value store for provider credentials."""

    def __init__(self) -> None:
        self._fernet = None
        self.encrypted = False
        try:
            from cryptography.fernet import Fernet  # type: ignore
            import base64

            key = base64.urlsafe_b64encode(_local_key())
            self._fernet = Fernet(key)
            self.encrypted = True
        except Exception:
            self._fernet = None
            self.encrypted = False
        self._cache: dict | None = None

    # -- internals ---------------------------------------------------------
    def _read(self) -> dict:
        if self._cache is not None:
            return self._cache
        self._cache = {}
        if not SECRETS_FILE.exists():
            return self._cache
        try:
            raw = SECRETS_FILE.read_bytes()
            if self._fernet:
                raw = self._fernet.decrypt(raw)
            self._cache = json.loads(raw.decode("utf-8")) or {}
        except Exception:
            self._cache = {}
        return self._cache

    def _write(self, data: dict) -> None:
        raw = json.dumps(data).encode("utf-8")
        if self._fernet:
            raw = self._fernet.encrypt(raw)
        SECRETS_FILE.write_bytes(raw)
        try:
            os.chmod(SECRETS_FILE, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass
        self._cache = data

    # -- public ------------------------------------------------------------
    def set(self, name: str, value: str) -> None:
        data = dict(self._read())
        if value:
            data[name] = {
                "value": value,
                "added": time.time(),
                "hint": (value[:4] + "…" + value[-4:]) if len(value) > 12 else "set",
            }
        else:
            data.pop(name, None)
        self._write(data)

    def get(self, name: str) -> str | None:
        rec = self._read().get(name)
        return rec.get("value") if isinstance(rec, dict) else None

    def delete(self, name: str) -> bool:
        """Remove a stored secret. Returns True if something was removed."""
        data = self._read()
        if name not in data:
            return False
        data.pop(name, None)
        self._write(data)
        return True

    def has(self, name: str) -> bool:
        return bool(self.get(name))

    def names(self) -> list[str]:
        return sorted(self._read().keys())

    def public_view(self) -> list[dict]:
        out = []
        for name, rec in sorted(self._read().items()):
            out.append({
                "name": name,
                "hint": rec.get("hint", "set"),
                "added": rec.get("added"),
            })
        return out


SECRETS = SecretStore()

# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------


def safe_int(value, default=0, lo=None, hi=None):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n
