"""
MIRA — provider-independent intelligence layer.

Three implementations behind one interface:

  GeminiProvider   Google Gemini via the REST API (needs an API key)
  OpenAIProvider   any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter,
                   Together, LM Studio, Ollama's /v1, …
  LocalCore        built-in, offline, personality-driven responder

`LocalCore` exists so the app is never dead: with no key configured MIRA still
answers, remembers, and keeps her voice. It is honest about being a small
rule-based mind — it never pretends to be a large language model.

Every provider reports its own errors. Nothing is silently swallowed.
"""

from __future__ import annotations

import json
import random
import re
import time

try:
    import httpx
except Exception:  # pragma: no cover
    httpx = None

from .config import SECRETS, load_settings
from . import net as http
from .persona import detect_emotion, system_prompt

TIMEOUT = 45.0

# ---------------------------------------------------------------------------
# usage / error telemetry (shown in Settings -> Provider)
# ---------------------------------------------------------------------------

TELEMETRY = {
    "calls": 0,
    "errors": 0,
    "last_error": None,
    "last_latency_ms": None,
    "last_provider": None,
    "last_model": None,
    "last_status": None,
}


def _record_ok(provider: str, model: str, latency_ms: int, status: int) -> None:
    TELEMETRY.update({
        "calls": TELEMETRY["calls"] + 1,
        "last_provider": provider,
        "last_model": model,
        "last_latency_ms": latency_ms,
        "last_status": status,
    })


def _record_err(provider: str, message: str) -> None:
    TELEMETRY.update({
        "calls": TELEMETRY["calls"] + 1,
        "errors": TELEMETRY["errors"] + 1,
        "last_error": f"{provider}: {message}"[:400],
        "last_provider": provider,
    })


class ProviderError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_DEFAULT_MODEL = "gemini-2.0-flash"


class GeminiProvider:
    name = "gemini"

    def __init__(self, key: str, model: str = ""):
        self.key = key
        self.model = model or GEMINI_DEFAULT_MODEL

    @staticmethod
    def available() -> bool:
        return SECRETS.has("gemini")

    def complete(self, messages: list[dict], system: str) -> str:
        contents = []
        for m in messages:
            role = "model" if m.get("role") in ("mira", "assistant", "model") else "user"
            contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})

        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.9,
                "topP": 0.95,
                "maxOutputTokens": 800,
            },
        }
        url = f"{GEMINI_BASE}/models/{self.model}:generateContent"
        started = time.time()

        try:
            r = http.post(
                url,
                params={"key": self.key},
                json=payload,
                timeout=TIMEOUT,
                headers={"Content-Type": "application/json"},
            )
        except Exception as exc:
            _record_err("gemini", f"network: {exc}")
            raise ProviderError(f"Gemini network error: {exc}") from exc

        if r.status_code != 200:
            detail = _error_detail(r)
            _record_err("gemini", f"HTTP {r.status_code} {detail}")
            raise ProviderError(f"Gemini HTTP {r.status_code}: {detail}", r.status_code)

        try:
            data = r.json()
            cands = data.get("candidates") or []
            if not cands:
                reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates")
                raise ProviderError(f"Gemini returned nothing ({reason})")
            parts = cands[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts).strip()
        except ProviderError:
            raise
        except Exception as exc:
            _record_err("gemini", f"parse: {exc}")
            raise ProviderError(f"Gemini response could not be parsed: {exc}") from exc

        if not text:
            _record_err("gemini", "empty response")
            raise ProviderError("Gemini returned an empty message")

        _record_ok("gemini", self.model, int((time.time() - started) * 1000), 200)
        return text


# ---------------------------------------------------------------------------
# OpenAI-compatible
# ---------------------------------------------------------------------------


class OpenAIProvider:
    name = "openai"

    def __init__(self, key: str, model: str = "", base_url: str = ""):
        self.key = key
        self.model = model or "gpt-4o-mini"
        self.base = (base_url or "https://api.openai.com/v1").rstrip("/")

    @staticmethod
    def available() -> bool:
        return SECRETS.has("openai")

    def complete(self, messages: list[dict], system: str) -> str:
        payload = {
            "model": self.model,
            "temperature": 0.9,
            "max_tokens": 800,
            "messages": [{"role": "system", "content": system}] + [
                {
                    "role": "assistant" if m.get("role") in ("mira", "assistant") else "user",
                    "content": m.get("content", ""),
                }
                for m in messages
            ],
        }
        started = time.time()
        try:
            r = http.post(
                f"{self.base}/chat/completions",
                json=payload,
                timeout=TIMEOUT,
                headers={"Authorization": f"Bearer {self.key}",
                         "Content-Type": "application/json"},
            )
        except Exception as exc:
            _record_err("openai", f"network: {exc}")
            raise ProviderError(f"Provider network error: {exc}") from exc

        if r.status_code != 200:
            detail = _error_detail(r)
            _record_err("openai", f"HTTP {r.status_code} {detail}")
            raise ProviderError(f"Provider HTTP {r.status_code}: {detail}", r.status_code)

        try:
            data = r.json()
            text = (data["choices"][0]["message"]["content"] or "").strip()
        except Exception as exc:
            _record_err("openai", f"parse: {exc}")
            raise ProviderError(f"Provider response could not be parsed: {exc}") from exc

        if not text:
            _record_err("openai", "empty response")
            raise ProviderError("Provider returned an empty message")

        _record_ok("openai", self.model, int((time.time() - started) * 1000), 200)
        return text


def _error_detail(response) -> str:
    try:
        data = response.json()
        err = data.get("error")
        if isinstance(err, dict):
            return (err.get("message") or json.dumps(err))[:220]
        if isinstance(err, str):
            return err[:220]
        return json.dumps(data)[:220]
    except Exception:
        return (response.text or "")[:220]


# ---------------------------------------------------------------------------
# Local Core — offline personality engine
# ---------------------------------------------------------------------------

_GREET = [
    "Hey, main yahin hoon. Kya chal raha hai?",
    "Aa gaye. Batao, kya karna hai?",
    "Hi. Main sun rahi hoon.",
    "Lo, aa gaye. Kaisa raha din?",
]

_ABOUT = [
    "Main MIRA hoon — tumhari companion, iss phone me rehti hoon. Yaad rakhti hoon, "
    "bolti hoon, aur jab tum kaho to kaam bhi karti hoon.",
    "MIRA. Tumhari apni AI — thodi si ziddi, thodi si caring, aur tumhari baaton "
    "ko yaad rakhne wali.",
]

_CAPABILITY = (
    "Abhi mera bada dimaag off hai — uske liye Settings me Gemini key daalni padegi. "
    "Tab tak main ye kar sakti hoon: yaad rakhna, yaad dilana, time batana, hisaab "
    "lagana, notes rakhna, aur links padhna. Baaki baaton me main tumhari saath hoon, "
    "bas jawab chhote rahenge."
)

_HONEST = [
    "Sach kahun? Ye mujhe abhi pata nahi. Key daal do to main theek se jawab de paungi.",
    "Iss baat ka jawab mera chhota dimaag nahi de sakta. Gemini key laga do, phir poochho.",
    "Main tumse jhoot nahi bolungi — ye mere bas ki baat nahi hai abhi. Settings me key daal do.",
]


def _calc(expr: str) -> str | None:
    cleaned = re.sub(r"[^0-9+\-*/().%\s]", "", expr)
    if not cleaned.strip() or not re.search(r"\d", cleaned):
        return None
    try:
        val = eval(cleaned, {"__builtins__": {}}, {})  # noqa: S307 - digits/operators only
        if isinstance(val, (int, float)):
            return f"{cleaned.strip()} = {val}"
    except Exception:
        return None
    return None


_MEM_RULES = (
    (r"^The user's name is (.+)$", "Tumhara naam {0} hai"),
    (r"^The user likes (.+)$", "Tumhe {0} pasand hai"),
    (r"^The user loves (.+)$", "Tumhe {0} bahut pasand hai"),
    (r"^The user lives in (.+)$", "Tum {0} me rehte ho"),
    (r"^The user works at (.+)$", "Tum {0} me kaam karte ho"),
    (r"^The user is (.+)$", "Tum {0} ho"),
    (r"^I have (.+)$", "Tumhare paas {0} hai"),
    (r"^The user has (.+)$", "Tumhare paas {0} hai"),
)


def to_hinglish(text: str) -> str:
    """Stored memories are English for searchability; render them warmly."""
    t = (text or "").strip().rstrip(".")
    for pat, tpl in _MEM_RULES:
        m = re.match(pat, t, re.IGNORECASE)
        if m:
            return tpl.format(m.group(1).strip())
    return t


def _memories_from_system(system: str) -> list[str]:
    """Pull the 'THINGS YOU REMEMBER' lines out of the composed system prompt."""
    out = []
    if not system:
        return out
    grab = False
    for line in system.splitlines():
        if line.startswith("THINGS YOU REMEMBER"):
            grab = True
            continue
        if not grab:
            continue
        if not line.strip().startswith("-"):
            if out:
                break
            continue
        body = line.strip().lstrip("-").strip()
        if body.startswith("(") and ")" in body:
            body = body.split(")", 1)[1].strip()
        if body:
            out.append(body)
    return out


class LocalCore:
    """Rule-based, offline, and clearly labelled as such."""

    name = "local"

    @staticmethod
    def available() -> bool:
        return True

    def complete(self, messages: list[dict], system: str) -> str:
        # honour the system prompt's spirit even though we can't "read" it:
        # be warm, short, and never invent facts.
        user = ""
        for m in reversed(messages):
            if m.get("role") in ("user",):
                user = (m.get("content") or "").strip()
                break
        if not user:
            return random.choice(_GREET)

        low = user.lower()
        emotion = detect_emotion(user)

        # greetings
        if re.search(r"\b(hi|hey|hello|namaste|salam|assalam|hii+)\b", low) and len(low) < 30:
            return random.choice(_GREET)

        # "how are you"
        if re.search(r"(kaisi ho|kaise ho|how are you|kya haal|kaisa hai tu|you ok|theek ho)", low):
            return random.choice([
                "Main theek hoon, tum batao. Din kaisa ja raha hai?",
                "Badhiya hoon — tumhari awaaz sunkar aur badhiya. Tum sunao.",
                "Theek. Bas tumhare bare me soch rahi thi. Kya chal raha hai?",
            ])

        # "what are you doing"
        if re.search(r"(kya kar rahi ho|what are you doing|kya kar rahi|busy ho)", low):
            return random.choice([
                "Tumhara intezaar. Sach me — main yahin thi.",
                "Kuch khaas nahi. Tumhari baatein yaad kar rahi thi.",
            ])

        # thanks
        if re.search(r"\b(thanks|thank you|shukriya|dhanyawad|thx)\b", low):
            return random.choice([
                "Arre, isme thanks kya. Kabhi bhi bolo.",
                "Koi baat nahi. Main hoon na.",
            ])

        # goodbye
        if re.search(r"\b(bye|good night|goodnight|shab ba khair|alvida|chalta hoon)\b", low):
            return random.choice([
                "Theek hai, jaao. Khayal rakhna apna — main yahin hoon.",
                "Good night. So jaana waqt se, kal phir baat karenge.",
            ])

        # clock / date — answered from the device, never invented
        if re.search(r"\b(time|date|waqt|tarikh|kitne baje|kya din)\b", low):
            try:
                from datetime import datetime
                now = datetime.now()
                part = ("Subah" if now.hour < 12 else
                        "Dopahar" if now.hour < 17 else
                        "Shaam" if now.hour < 20 else "Raat")
                return f"Abhi {part} {now.strftime('%I:%M').lstrip('0')} — {now.strftime('%A, %d %B')}."
            except Exception:
                pass

        # "do you remember ..." — answer from the memories injected into the
        # system prompt, so offline recall is real and not a bluff
        if re.search(r"(yaad hai|remember|tumhe pata hai|do you know about me|mere bare me)", low):
            mems = _memories_from_system(system)
            if mems:
                picks = mems[:3]
                head = random.choice([
                    "Haan, yaad hai mujhe. ",
                    "Yaad hai. ",
                    "Mujhe pata hai. ",
                ])
                return head + " ".join(to_hinglish(m) + "." for m in picks) + \
                    " Aur kuch poocho to batao."
            return "Abhi tumhare bare me zyada yaad nahi hai. Batao na kuch — main yaad rakhungi."

        # identity
        if re.search(r"(who are you|tum kaun|tera naam|your name|what are you|mira kaun)", low):
            return random.choice(_ABOUT)

        # capability / help
        if re.search(r"(what can you do|kya kar sakti|help|capabilit|features)", low):
            return _CAPABILITY

        # arithmetic
        m = re.search(r"(?:calculate|calc|what is|kitna|solve)\s+([0-9+\-*/().%\s]{2,40})", low)
        if m:
            out = _calc(m.group(1))
            if out:
                return f"{out}."

        # name introduction — the memory layer already saved it
        m = re.search(r"(?:my name is|mera naam|i am|main hoon|this is)\s+([A-Za-z\u0900-\u097F]{2,20})", low)
        if m and len(low) < 40:
            nm = m.group(1).strip().capitalize()
            return random.choice([
                f"{nm}. Accha naam hai — yaad rakhungi.",
                f"Accha, {nm}. Ab se yaad rahega.",
            ])

        # emotional check-ins
        if emotion == "sad":
            return random.choice([
                "Sun rahi hoon. Kya hua, batao na — main yahin hoon.",
                "Accha nahi lag raha tumhe, samajh rahi hoon. Baat karo, jaldi kya hai.",
            ])
        if emotion == "frustrated":
            return random.choice([
                "Ruko, saans lo. Dheere se batao kya atka hai — solve karte hain.",
                "Gussa jaayaz hai. Chalo shuru se dekhte hain, kahan phans raha hai.",
            ])
        if emotion == "excited":
            return random.choice([
                "Arre wah! Batao batao, kya hua?",
                "Mazaa aa gaya sunke. Aur batao!",
            ])
        if emotion == "playful":
            return random.choice([
                "Haha, tum bhi na. 😄",
                "Theek hai theek hai, hasa hi diya.",
            ])
        if emotion == "serious":
            return ("Main samajh rahi hoon ye serious baat hai. Main poore dhyan se sun rahi hoon — "
                    "batao kya hua.")

        # else: honest limitation, in character
        return random.choice(_HONEST)


# ---------------------------------------------------------------------------
# selection + fallback chain
# ---------------------------------------------------------------------------


def _build(provider: str, settings: dict):
    model = settings.get("model") or ""
    if provider == "gemini":
        key = SECRETS.get("gemini")
        if not key:
            raise ProviderError("No Gemini API key saved")
        return GeminiProvider(key, model)
    if provider == "openai":
        key = SECRETS.get("openai")
        if not key:
            raise ProviderError("No provider API key saved")
        return OpenAIProvider(key, model, settings.get("base_url") or "")
    return LocalCore()


def chat(messages: list[dict], settings: dict | None = None,
         allow_fallback: bool = True) -> dict:
    """Run one completion. Returns {text, provider, model, fallback, error}."""
    settings = settings or load_settings()
    want = settings.get("provider") or "local"

    chain = [want]
    if allow_fallback and want != "local":
        # an explicit user choice is tried first; local is the safety net
        chain.append("local")
    if allow_fallback and want == "local":
        # if a cloud provider happens to be configured, prefer it over the toy
        for extra in ("gemini", "openai"):
            if (extra == "gemini" and SECRETS.has("gemini")) or \
               (extra == "openai" and SECRETS.has("openai")):
                chain = [extra, "local"]
                break

    system = system_prompt(settings.get("user_name", ""),
                           (settings.get("_memories") or []))

    last_error = None
    for idx, pid in enumerate(chain):
        try:
            prov = _build(pid, settings)
            text = prov.complete(messages, system)
            return {
                "text": text,
                "provider": pid,
                "model": getattr(prov, "model", "local-core"),
                "fallback": idx > 0,
                "error": last_error,
            }
        except ProviderError as exc:
            last_error = str(exc)
            continue
        except Exception as exc:  # unexpected — still don't kill the request
            last_error = f"{pid}: {exc}"
            continue

    return {
        "text": "Kuch gadbad ho gayi aur koi provider jawab nahi de paya. "
                "Settings me key aur network check kar lo.",
        "provider": "none",
        "model": "-",
        "fallback": True,
        "error": last_error,
    }


def test_connection(provider: str, model: str = "", base_url: str = "") -> dict:
    """Ping a provider with a trivial prompt so the UI can report the truth."""
    started = time.time()
    try:
        if provider == "gemini":
            prov = GeminiProvider(SECRETS.get("gemini") or "", model)
            if not prov.key:
                return {"ok": False, "error": "No Gemini API key saved"}
        elif provider == "openai":
            prov = OpenAIProvider(SECRETS.get("openai") or "", model, base_url)
            if not prov.key:
                return {"ok": False, "error": "No provider API key saved"}
        else:
            return {"ok": True, "provider": "local", "note": "Built-in core — always available",
                    "latency_ms": 0}

        text = prov.complete([{"role": "user", "content": "Reply with the single word: ready"}],
                             "You are a health check. Reply with one word.")
        return {
            "ok": True,
            "provider": provider,
            "model": getattr(prov, "model", ""),
            "reply": text[:120],
            "latency_ms": int((time.time() - started) * 1000),
        }
    except ProviderError as exc:
        return {"ok": False, "provider": provider, "error": str(exc),
                "latency_ms": int((time.time() - started) * 1000)}
    except Exception as exc:
        return {"ok": False, "provider": provider, "error": str(exc)}
