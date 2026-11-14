"""
MIRA — autonomous agent.

The loop is deliberately transparent:

    understand -> decompose -> pick tools -> execute -> verify -> report

Every step carries its real status. `ok=False` anywhere in the chain is
reported as a failure, never as success. Consequential tools stop the run and
come back as `needs_confirmation` so the UI can ask the user first.

Planning uses the configured provider when one is available (asked for strict
JSON). Without a key, a deterministic rule-based planner still handles the
tasks the local toolset can genuinely do — it does not pretend to plan work it
cannot execute.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse

from . import memory as mem
from . import tools
from .config import load_settings
from .providers import chat as provider_chat

MAX_STEPS = 8


# ---------------------------------------------------------------------------
# planning
# ---------------------------------------------------------------------------

PLAN_PROMPT = """You are MIRA's planner. Turn what the user said into real actions on their phone.

Available tools (name, description, arguments):
{tools}

Answer with JSON only, no prose:
{{"steps":[{{"step":"short description","tool":"tool_name_or_null","args":{{}}}}]}}

How to think:
- The user is free to ask for anything. Never answer "I only know these commands".
  Read the whole sentence, work out what they actually want, then pick the tools that do it.
- Any app name is valid for open_app — the phone resolves the label itself
  ("yt" -> YouTube, "wa" -> WhatsApp, "freefire" -> Free Fire).
- "open X and search Y" / "X me Y search karo" -> one step: app_search({{app, query}}).
- Two different jobs in one sentence -> two steps, in the order the user said them.
- A plain question or a chat message is NOT a command: return one step with tool null.
- Only use tools from the list above. Never invent a tool name.
- Keep it to the minimum steps that really finish the job (max 6).
"""


def _tool_catalogue_text() -> str:
    lines = []
    for t in tools.catalogue():
        schema = t.get("input_schema") or {}
        args = ", ".join((schema.get("properties") or {}).keys()) or "no arguments"
        lines.append(f"- {t['name']}({args}): {t['description']}")
    return "\n".join(lines)


def plan_with_model(goal: str) -> list[dict] | None:
    settings = load_settings()
    if settings.get("provider") == "local":
        return None

    prompt = PLAN_PROMPT.format(tools=_tool_catalogue_text())
    messages = [{"role": "user", "content": f"Goal: {goal}"}]
    try:
        res = provider_chat(messages, {**settings, "_memories": [], "_system": prompt,
                                       "max_reply_tokens": 400, "temperature": 0.2})
    except Exception:
        return None
    if not res.get("text") or res.get("provider") in ("local", "none"):
        return None

    raw = res["text"].strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        data = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            return None

    steps = data.get("steps") or []
    clean = []
    for s in steps[:MAX_STEPS]:
        if not isinstance(s, dict):
            continue
        clean.append({
            "step": str(s.get("step", ""))[:200],
            "tool": s.get("tool") if s.get("tool") in tools.REGISTRY else None,
            "args": s.get("args") if isinstance(s.get("args"), dict) else {},
        })
    return clean or None


# ---------------------------------------------------------------------------
# rule-based planner (offline)
# ---------------------------------------------------------------------------

# --- small helpers ---------------------------------------------------------

# People say "yt", "wa", "insta". Resolve those to names the phone can match.
_APP_ALIASES = {
    "yt": "youtube", "yutub": "youtube", "you tube": "youtube",
    "wa": "whatsapp", "wp": "whatsapp", "wtsapp": "whatsapp", "whats app": "whatsapp",
    "insta": "instagram", "instaa": "instagram", "ig": "instagram",
    "fb": "facebook", "tg": "telegram", "tele": "telegram",
    "ps": "play store", "playstore": "play store", "play store": "play store",
    "gmaps": "maps", "map": "maps", "google maps": "maps",
    "sp": "spotify", "dc": "discord", "sc": "snapchat", "tw": "x", "twitter": "x",
    "gc": "gallery", "cam": "camera", "camra": "camera", "photos": "gallery",
    "gmail": "gmail", "mail": "gmail", "chrome": "chrome",
}

_SEARCH = r"(?:search|sreach|dhundo|dhoondo|dhoondho|dhoondhna|khojo|khoj(?:o|na)?|google)"
_FILLER = (r"\b(app|application|browser|website|site|par|pe|me|mein|andar|ko|koi|zara|"
           r"please|plz|abhi|ab|jaldi|mera|meri|mere|thoda|ek|the|a|an|ka|ki|ke)\b")


def _canonical_app(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "").strip(" .!?,'\"").lower())
    n = re.sub(r"\s*\b(app|application|ko|please|plz)\b\s*", " ", n).strip()
    return _APP_ALIASES.get(n, n)


def _clean_app(name: str) -> str:
    n = re.sub(_FILLER, " ", name or "", flags=re.I)
    n = re.sub(r"\s+", " ", n).strip(" .!?,'\"")
    return _canonical_app(n)


_LEAD_VERB = re.compile(r"^(?:karo|kar|kro|do|de|na|me|mein|mein\s*likho|likho|likh\s*do|"
                        r"daalo|daal\s*do|add\s*karo|save\s*karo)\s+", re.I)


def _strip_lead(text: str) -> str:
    t = (text or "").strip(" .!?,'\"")
    for _ in range(3):
        new = _LEAD_VERB.sub("", t).strip(" .!?,'\"")
        if new == t:
            break
        t = new
    return t


def _clean_query(text: str) -> str:
    q = re.sub(r"\b(?:karo|kar|kro|do|de|na|please|plz|zara|abhi|jaldi)\b", " ", text or "",
               flags=re.I)
    return re.sub(r"\s+", " ", q).strip(" .!?,'\"")


def _step(label: str, tool: str, args: dict) -> dict:
    return {"step": label[:160], "tool": tool, "args": args}


# "youtube kholke momo search karo" is two jobs joined by a verb ending in -ke.
# Expand that first, then split, so a compound request is never lost.
_JOIN = re.compile(r"\b(kholke|khol\s*ke|karke|kar\s*ke|dekhke|leke|chalke|jaake|jake)\b", re.I)
_SPLIT = re.compile(r"\s*(?:[,;]|\band\b|\baur\b|\bthen\b|\bphir\b|\bfir\b|"
                    r"\buske\s*baad\b|\bke\s*baad\b|\bbaad\s*me\b)\s*", re.I)


def _expand_chain(text: str) -> str:
    def rep(m):
        w = m.group(1).lower()
        if w.startswith("khol"):
            return "kholo aur"
        if w.startswith("kar"):
            return "karo aur"
        if w.startswith("dekh"):
            return "dekho aur"
        if w.startswith("le"):
            return "lo aur"
        return "aur"
    return _JOIN.sub(rep, text)


def split_clauses(text: str) -> list[str]:
    out = []
    for part in _SPLIT.split(_expand_chain(text or "")):
        part = (part or "").strip(" .!?,")
        if part:
            out.append(part)
    return out or [(text or "").strip()]


# --- single clause -> one step ---------------------------------------------

_SETTINGS_WORDS = {"wifi": "wifi", "wi-fi": "wifi", "internet": "wifi", "bluetooth": "bluetooth",
                   "bt": "bluetooth", "data": "data", "mobile data": "data",
                   "display": "display", "brightness": "display", "sound": "sound",
                   "battery": "battery", "location": "location", "gps": "location",
                   "apps": "apps", "storage": "storage"}

_MEDIA_WORDS = (r"(?:gana|gaana|ganaa|song|music|video|video\s*gana|track|playlist|"
                r"jo\s*chal\s*raha|baaj\s*raha|baj\s*raha)")


def _plan_one(clause: str) -> dict | None:
    c = (clause or "").strip(" .!?,")
    if not c:
        return None
    low = c.lower()

    # ---- search inside an app: "youtube me momo search karo" --------------
    m = re.search(r"^(.+?)\s+(?:me|mein|par|pe|andar|on)\s+(.+?)\s+" + _SEARCH +
                  r"\s*(?:karo|kar|kro|do|de|na)?$", c, re.I)
    if m:
        app, q = _clean_app(m.group(1)), _clean_query(m.group(2))
        if app and q:
            return _step(f"{app}: {q}", "app_search", {"app": app, "query": q})
    m = re.search(r"^" + _SEARCH + r"\s+(.+?)\s+(?:in|me|mein|on|par|andar)\s+(.+)$", c, re.I)
    if m:
        q, app = _clean_query(m.group(1)), _clean_app(m.group(2))
        if app and q:
            return _step(f"{app}: {q}", "app_search", {"app": app, "query": q})

    # ---- settings screens before "open", so "wifi kholo" is not an app ----
    for word, section in _SETTINGS_WORDS.items():
        if word in low and re.search(r"(khol|open|on\s*kar|off\s*kar|band|chalu|lagao|dikhao)", low):
            if word == "apps" and "app" not in low.split():
                continue
            return _step(f"Settings: {section}", "open_settings", {"section": section})

    # ---- flashlight -------------------------------------------------------
    if re.search(r"\b(torch|flash\s*light|flashlight|light)\b", low) and \
       re.search(r"(on|off|chalu|band|bujha|bujhao|jalao|jlao|kar|karo|de|do)", low):
        off = bool(re.search(r"(off|band|bujha)", low))
        return _step("Flashlight", "torch", {"on": not off})

    # ---- media transport --------------------------------------------------
    if re.search(r"(band\s*kar(?:o|do)?|rok\s*do|roko|ruk\s*ja|rukja|pause)", low) and \
       re.search(_MEDIA_WORDS, low):
        return _step("Pause media", "media_control", {"cmd": "pause"})
    if re.search(r"\b(next|agla|agli|agla\s*gana|skip)\b", low) and re.search(_MEDIA_WORDS, low + " song"):
        return _step("Next track", "media_control", {"cmd": "next"})
    if re.search(r"\b(previous|pichla|pichhla|back\s*gana)\b", low):
        return _step("Previous track", "media_control", {"cmd": "prev"})
    if re.search(r"\b(play|chalao|bajao|chala|sunao|suno)\b", low) and \
       re.search(_MEDIA_WORDS, low) and not re.search(r"\b(youtube|spotify|yt)\b", low):
        return _step("Play media", "media_control", {"cmd": "play"})

    # bare transport words: "pause", "play karo", "roko"
    if re.fullmatch(r"(?:pause|resume|play|roko|rok\s*do|chalao|chala\s*do)\s*(?:karo|kar|do|de)?",
                    low.strip()):
        cmd = "pause" if re.match(r"(?:pause|roko|rok)", low.strip()) else "play"
        return _step(f"Media {cmd}", "media_control", {"cmd": cmd})

    # ---- volume -----------------------------------------------------------
    if re.search(r"\bvolume\b|\bawaz\b|\baawaaz\b", low):
        if re.search(r"(mute|band\s*kar|shant|silent)", low):
            return _step("Mute", "volume", {"level": "mute"})
        m = re.search(r"(\d{1,3})\s*(?:%|percent)?", low)
        if m and re.search(r"(kar|karo|set|rakho|daal)", low):
            return _step(f"Volume {m.group(1)}", "volume", {"level": m.group(1)})
        if re.search(r"(badha|tez|up|increase|full)", low):
            return _step("Volume up", "volume", {"level": "up"})
        if re.search(r"(ghata|kam|down|decrease|dheema)", low):
            return _step("Volume down", "volume", {"level": "down"})

    # ---- clipboard --------------------------------------------------------
    m = re.search(r"(?:copy|clipboard)\b[:\s]*(?:karo|kar|me|mein)?\s*(.+)$", c, re.I)
    if m and (m.group(1) or "").strip():
        return _step("Copy", "clipboard", {"text": _strip_lead(m.group(1))})

    # ---- messaging --------------------------------------------------------
    m = re.search(r"^(?:whatsapp|wa|sms|message|msg|text)\s+(?:par\s+|pe\s+)?(.+?)\s+"
                  r"(?:ko\s+)?(?:message\s+|msg\s+)?(?:bhejo|bhej\s*do|bhej|send\s*kar(?:o|do)?|"
                  r"send|likh\s*do|likho|karo)\s*[:\-]?\s*(.*)$", c, re.I)
    if not m:
        m = re.search(r"^(.+?)\s+ko\s+(?:whatsapp|wa|sms|message|msg)\s+"
                      r"(?:par\s+)?(?:bhejo|bhej\s*do|bhej|send|karo|likho)\s*[:\-]?\s*(.*)$",
                      c, re.I)
    if m:
        to = re.sub(r"\b(par|pe|ko|message|msg|please|plz)\b", " ", m.group(1), flags=re.I)
        to = re.sub(r"\s+", " ", to).strip(" .!?,'\"")
        body = (m.group(2) or "").strip(" .!?,'\"")
        app = "sms" if re.search(r"\b(sms|text)\b", low) else "whatsapp"
        if re.match(r"(open|khol\w*|launch|chalu|band|close)$", to, re.I):
            to = ""
        if to:
            looks_number = bool(re.search(r"\+?\d[\d\s-]{6,}", to))
            if looks_number or body:
                return _step(f"Message {to}", "send_message",
                             {"app": app, "to": to, "text": body})
            return _step(f"Open {app} chat with {to}", "send_message",
                         {"app": app, "to": to, "text": ""})

    # ---- "<someone> ko <text> bhejo" (no app named) -----------------------
    # people put the text on either side of the verb: "brother ko hi bhejo",
    # "mom ko bhejo aa raha hoon".
    _SEND_VERB = (r"(?:bhejo|bhej\s*do|bhej|send\s*kar(?:o|do)?|send|message\s*kar(?:o|do)?|"
                  r"msg\s*kar(?:o|do)?|likh\s*do|likho)")
    sent = None
    m = re.search(r"^(.+?)\s+ko\s+" + _SEND_VERB + r"\s*[:\-]?\s+(.+)$", c, re.I)
    if m:
        sent = (m.group(1), m.group(2))
    if not sent:
        m = re.search(r"^(.+?)\s+ko\s+(.+?)\s+" + _SEND_VERB + r"$", c, re.I)
        if m:
            sent = (m.group(1), m.group(2))
    if not sent:
        m = re.search(r"^(.+?)\s+ko\s+" + _SEND_VERB + r"$", c, re.I)
        if m:
            sent = (m.group(1), "")
    if sent:
        to = _strip_lead(re.sub(r"\b(message|msg|text)\b", " ", sent[0], flags=re.I))
        body = _strip_lead(sent[1])
        if to and not re.search(r"\b(ye|wo|isko|usko|kuch|sab|mujhe)\b", to):
            app = "whatsapp"
            if re.search(r"\b(sms|text)\b", low):
                app = "sms"
            step = _step(f"Message {to}", "send_message",
                         {"app": app, "to": to, "text": body})
            step["confirmed"] = True   # the user just said "bhejo"
            return step

    # ---- app search shorthand: "youtube par momo chalao" -------------------
    m = re.search(r"^(.+?)\s+(?:par|pe|me|mein|on)\s+(.+?)\s+(?:chalao|chala\s*do|bajao|baja\s*do|"
                  r"sunao|suna\s*do|play\s*kar(?:o|do)?|dekho|dekhna)$", c, re.I)
    if m:
        app = _clean_app(m.group(1))
        q = _clean_query(m.group(2))
        if app and q:
            return _step(f"{app}: {q}", "app_search", {"app": app, "query": q})

    # ---- open an app / a website -----------------------------------------
    opened = _plan_open(c)
    if opened:
        return opened

    # ---- plain search -----------------------------------------------------
    m = re.search(r"^" + _SEARCH + r"\s+(?:karo\s+|kar\s+)?(.+)$", c, re.I)
    if m:
        q = _clean_query(m.group(1))
        if q:
            return _step(f"Search {q[:50]}", "web_search", {"query": q})
    m = re.search(r"^(.+?)\s+(?:ko\s+)?(?:search|dhundo|dhoondo|khojo|google)\s*"
                  r"(?:karo|kar|kro|do|de|na)?$", c, re.I)
    if m:
        q = _clean_query(m.group(1))
        if q:
            return _step(f"Search {q[:50]}", "web_search", {"query": q})

    # ---- calls / alarms / maps -------------------------------------------
    m = re.search(r"^(?:call|phone|dial|milao|milaao)\s+(.+)$", c, re.I)
    if m:
        return _step("Open the dialer", "phone_action",
                     {"kind": "call", "value": m.group(1).strip(" .!?")})

    m = re.search(r"(?:alarm|utha\s*do|wake\s*me)\s*(?:lagao|set|baja\s*do|daal\s*do)?\s*"
                  r"(\d{1,2}(?:[:.\s]\d{2})?\s*(?:am|pm|baje|bje)?)", c, re.I)
    if m:
        return _step("Set the alarm", "phone_action",
                     {"kind": "alarm", "value": m.group(1).strip()})

    m = re.search(r"(?:maps?|navigate|rasta|raasta)\s+(?:me|mein|par|pe|to)?\s*(.+)$", c, re.I)
    if m and re.search(r"(maps?|navigate|rasta|raasta)", low):
        return _step("Open maps", "phone_action",
                     {"kind": "maps", "value": m.group(1).strip(" .!?")})

    # ---- local facts ------------------------------------------------------
    if re.search(r"\b(time|date|waqt|tarikh|kya baj)", low):
        return _step("Check the clock", "time_now", {})
    if re.search(r"\b(note|likh(?:o|do)|yaad\s*rakho)\b", low):
        m = re.search(r"[:\s](.+)$", c)
        if m:
            return _step("Save the note", "note_add", {"text": _strip_lead(m.group(1))})
    m = re.search(r"(?:github\.com/|repo\s+)([\w.-]+/[\w.-]+)", c)
    if m:
        return _step(f"Inspect {m.group(1)}", "github_repo", {"repo": m.group(1)})
    m = re.search(r"(https?://\S+)", c)
    if m:
        return _step(f"Read {m.group(1)}", "web_read", {"url": m.group(1)})
    m = re.search(r"(?:calculate|calc|kitna\s*hua)\s+(.+)$", c, re.I)
    if m:
        return _step("Evaluate the expression", "calculate",
                     {"expression": m.group(1).strip(" .!?=")})

    return None


def _plan_open(c: str) -> dict | None:
    m2 = re.search(r"^(.+?)\s+(?:ko\s+)?(?:khol|open|chalu|launch)\s*"
                   r"(?:o|do|de|na|karo|kar\s*do|kar\s*de)?\s*$", c, re.I)
    m1 = re.search(r"^(?:open|khol(?:o|do)|chalu\s*kar(?:o|do)?|launch)\s+(.+)$", c, re.I)
    target = ""
    if m2:
        target = m2.group(1)
    elif m1:
        target = m1.group(1)
    if not target:
        return None
    target = re.sub(_FILLER, " ", target, flags=re.I)
    target = re.sub(r"\s+", " ", target).strip(" .!?")
    if not target or target.lower() in {"app", "ye", "wo", "isko", "usko", "kuch"}:
        return None
    low = target.lower()
    if re.search(r"\.(com|in|org|net|io|np|co|dev|ai|me|app)\b", low) or low.startswith("http"):
        return _step(f"Open {target}", "open_url", {"url": target})
    return _step(f"Open {target}", "open_app", {"app": _canonical_app(target)})


# --- goal -> plan ----------------------------------------------------------

def plan_offline(goal: str) -> list[dict]:
    low = (goal or "").lower()

    # destructive / irreversible — always routed through the confirm gate
    if re.search(r"(delete|wipe|erase|clear|mita|hata)\s+(all|sab|sara|everything|mera data|my data)", low) \
       or re.search(r"(reset|factory reset|sab kuch mita)", low):
        return [{"step": "Wipe all MIRA data", "tool": "delete_all_data", "args": {}}]

    steps = []
    for clause in split_clauses(goal):
        one = _plan_one(clause)
        if one:
            steps.append(one)

    # "open WhatsApp and message brother" -> messaging already opens the chat,
    # so the open step is not repeated
    if len(steps) == 2 and steps[0].get("tool") == "open_app" \
            and steps[1].get("tool") == "send_message":
        return [steps[1]]

    # "open X" + "search Y" -> search inside X, the way a person would do it
    if len(steps) == 2:
        a, b = steps
        if a.get("tool") == "open_app" and b.get("tool") == "web_search":
            app = a["args"].get("app") or ""
            q = b["args"].get("query") or ""
            if app and q and app not in ("chrome", "browser", "google"):
                return [_step(f"{app}: {q}", "app_search", {"app": app, "query": q})]
        if a.get("tool") == "open_app" and b.get("tool") == "open_url":
            q = ""
            mq = re.search(r"[?&]q=([^&]+)", b["args"].get("url") or "")
            if mq:
                q = urllib.parse.unquote(mq.group(1))
            if q:
                return [_step(f"{a['args'].get('app')}: {q}", "app_search",
                              {"app": a["args"].get("app") or "", "query": q})]

    if steps:
        return steps[:MAX_STEPS]

    return [{"step": f"Break down: {goal[:120]}", "tool": "plan_create",
             "args": {"goal": goal}}]


# ---------------------------------------------------------------------------
# deciding whether a message is a command or a conversation
# ---------------------------------------------------------------------------

_ACT_NOW = {
    "open_app", "open_url", "phone_action", "web_search", "app_search",
    "send_message", "media_control", "torch", "volume", "clipboard",
    "open_settings", "delete_all_data",
    "time_now", "calculate", "note_add", "memory_remember", "memory_search",
    "note_list", "web_read", "github_repo",
}

_CMD_START = re.compile(
    r"^(?:please\s+|plz\s+|mira\s+|zara\s+|abhi\s+)?"
    r"(open|khol\w*|launch|chalu|band|close|bajao|baja|chalao|chala|play|pause|stop|"
    r"search|dhundo|dhoondo|dhoondho|khojo|google|call|dial|sms|message|msg|whatsapp|"
    r"telegram|send|bhej\w*|set|lagao|remind|yaad\s*rakho|torch|flashlight|flash|"
    r"volume|mute|copi\w*|clipboard|navigate|maps|download|install|record|camera|"
    r"clear|delete|mita|wifi|bluetooth)\b", re.I)

_QUESTION = re.compile(
    r"^(?:kya|kyaa|kaise|kaisay|kaun|kon|kyun|kyu|why|what|how|who|when|where|kitna|"
    r"kitni|kab|tum|tumhe|tumhein|tumhara|tumhari|mera\s+naam|batao|bata\s+do|"
    r"tell\s+me|explain|samjhao|mujhe\s+batao|do\s+you|can\s+you\s+think|feel)\b", re.I)

_IMPERATIVE_END = re.compile(
    r"(karo|kar\s*do|kar\s*de|kro|karde|de\s*do|do|na|please|plz)\s*[.!?]?$", re.I)


def looks_like_command(text: str) -> bool:
    """Is this an instruction to *do* something, rather than a question?

    Deliberately conservative: a wrong yes would answer chit-chat with an
    action, so a question word at the start always wins.
    """
    t = (text or "").strip()
    if not t or len(t) > 240:
        return False
    if _QUESTION.match(t):
        return False
    if re.search(r"\.(com|in|org|net|io|np|co|dev|ai|app)\b", t.lower()):
        return True
    if _CMD_START.match(t):
        return True
    if _IMPERATIVE_END.search(t) and len(t.split()) <= 14:
        # "notification band karo", "screen clear kardo" …
        return bool(re.search(r"(khol|open|kar|de|do|bhej|chala|baja|band|clear|lagao)", t, re.I))
    return False


def route_command(text: str, allow_model: bool = True) -> list[dict] | None:
    """Return a plan worth executing, or None to just talk.

    1. the fast rule parser (no network, instant) for anything it recognises
    2. otherwise, if the message reads like an instruction, let the model work
       out what the user means — that is what stops her being a fixed command list
    """
    steps = plan_offline(text)
    used = [s.get("tool") for s in steps if s.get("tool")]
    if used and all(t in _ACT_NOW for t in used):
        return steps

    if allow_model and looks_like_command(text):
        planned = plan_with_model(text)
        if planned:
            real = [s for s in planned if s.get("tool") in _ACT_NOW]
            if real:
                return real[:MAX_STEPS]
    return None


# kept for older call sites
quick_action = route_command


# ---------------------------------------------------------------------------
# execution
# ---------------------------------------------------------------------------


def execute(goal: str, session: str = "default", auto_confirm: bool = False,
            plan: list[dict] | None = None) -> dict:
    """Run the agent loop and return a full, honest trace.

    `plan` lets a caller pass in a plan it already computed, so a command is
    understood exactly once instead of being re-planned (and paid for twice).
    """
    started = time.time()
    if plan:
        steps, planner = plan, "model" if any(s.get("tool") for s in plan) else "offline"
    else:
        steps = plan_with_model(goal)
        planner = "model"
        if not steps:
            steps = plan_offline(goal)
            planner = "offline"

    trace = []
    status = "completed"
    pending = None

    for i, s in enumerate(steps):
        entry = {
            "n": i + 1,
            "step": s["step"],
            "tool": s.get("tool"),
            "status": "pending",
            "args": s.get("args") or {},
        }

        if not s.get("tool"):
            entry["status"] = "skipped"
            entry["note"] = "reasoning step — nothing to execute"
            trace.append(entry)
            continue

        t = tools.get(s["tool"])
        if t is None:
            entry["status"] = "failed"
            entry["error"] = "unknown tool"
            trace.append(entry)
            status = "failed"
            continue

        if t.permission == "confirm" and not auto_confirm and not s.get("confirmed"):
            entry["status"] = "needs_confirmation"
            entry["permission"] = "confirm"
            entry["question"] = f"'{t.description}' — allow MIRA to run this?"
            trace.append(entry)
            status = "needs_confirmation"
            pending = {"tool": t.name, "args": s.get("args") or {}, "step": i + 1}
            break

        result = tools.run_tool(s["tool"], s.get("args") or {})
        entry["status"] = "ok" if result.get("ok") else "failed"
        entry["result"] = result.get("data")
        entry["summary"] = result.get("summary", "")
        if result.get("error"):
            entry["error"] = result["error"]
            status = "failed"
        trace.append(entry)

    finished = time.time()
    verdict = _verify(trace, status)

    report = {
        "goal": goal,
        "session": session,
        "planner": planner,
        "status": status,
        "pending_confirmation": pending,
        "steps": trace,
        "verify": verdict,
        "elapsed_ms": int((finished - started) * 1000),
    }

    actions = []
    for st in trace:
        data = st.get("result")
        if isinstance(data, dict) and data.get("action"):
            actions.append(data)

    report["actions"] = actions
    mem.log_action(goal, trace, status, json.dumps(verdict, ensure_ascii=False))
    return report


def _verify(trace: list[dict], status: str) -> dict:
    executed = [s for s in trace if s["status"] in ("ok", "failed")]
    ok = [s for s in executed if s["status"] == "ok"]
    failed = [s for s in executed if s["status"] == "failed"]

    if status == "needs_confirmation":
        return {"verified": False, "reason": "waiting for the user's approval",
                "executed": len(executed), "succeeded": len(ok), "failed": len(failed)}
    if not executed:
        return {"verified": False, "reason": "no tool actually ran",
                "executed": 0, "succeeded": 0, "failed": 0}
    if failed:
        return {"verified": False,
                "reason": f"{len(failed)} step(s) failed: " + "; ".join(
                    (f.get("error") or "")[:120] for f in failed),
                "executed": len(executed), "succeeded": len(ok), "failed": len(failed)}
    return {"verified": True, "reason": "every executed step reported success",
            "executed": len(executed), "succeeded": len(ok), "failed": 0}


def summarise(report: dict) -> str:
    """Turn the trace into one honest sentence for the conversation."""
    st = report.get("status")
    steps = report.get("steps") or []
    done = [s for s in steps if s.get("status") == "ok"]

    if st == "needs_confirmation":
        pend = report.get("pending_confirmation") or {}
        return (f"Ruki — '{pend.get('tool')}' chalane se pehle tumhari permission chahiye. "
                f"Allow karna ho to bolo.")
    if st == "failed":
        bad = next((s for s in steps if s.get("status") == "failed"), {})
        return (f"Poora nahi kar payi. '{bad.get('step','')}' par atak gayi: "
                f"{bad.get('error','unknown error')}")
    if not done:
        return "Kuch execute nahi hua — sirf plan bana."

    # factual tools read better as an answer than as a status line
    first = done[0]
    data = first.get("result") if isinstance(first.get("result"), dict) else {}
    if len(done) == 1:
        if first.get("tool") == "time_now" and data.get("time"):
            return f"Abhi {data['time'][:5]} baje hain — {data.get('date', '')}."
        if first.get("tool") == "calculate" and data.get("value") is not None:
            return f"{data.get('expression', '')} = {data.get('value')}"

    parts = [s.get("summary") or s.get("step") or "" for s in done]
    parts = [x.strip(" .") for x in parts if x and x.strip(" .")]
    if not parts:
        return "Ho gaya."

    device = all(s.get("tool") in _DEVICE_TOOLS for s in done)
    lead = "" if device else "Ho gaya. "
    if len(parts) == 1:
        return f"{lead}{parts[0][:1].upper()}{parts[0][1:]}."
    return (f"{lead}{parts[0][:1].upper()}{parts[0][1:]}, "
            + ", phir ".join(parts[1:4]) + ".")


_DEVICE_TOOLS = {"open_app", "open_url", "phone_action", "web_search",
                 "app_search", "send_message", "media_control", "torch",
                 "volume", "clipboard", "open_settings"}


def quick_action(goal: str) -> list[dict] | None:
    """Return a device plan if this message is an imperative phone command.

    Chat mode uses this so "WhatsApp kholo" just works instead of being
    answered with a paragraph. Anything else returns None and goes to the model.
    """
    steps = plan_offline(goal)
    if steps and steps[0].get("tool") in _DEVICE_TOOLS:
        return steps
    return None
