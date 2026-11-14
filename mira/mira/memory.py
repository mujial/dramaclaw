"""
MIRA — three-layer memory on SQLite.

Layer A  short-term   -> the recent turns of the current session (episodes table)
Layer B  long-term    -> durable facts and preferences (memories table)
Layer C  contextual   -> retrieval that mixes both, plus date-aware lookups so
                         "what did we talk about yesterday" actually works

Everything stays on the device. There is no network call in this module.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

from .config import MEMORY_DB

MAX_CONTENT = 2000

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    session   TEXT NOT NULL,
    role      TEXT NOT NULL,             -- user | mira | tool | system
    content   TEXT NOT NULL,
    emotion   TEXT,
    ts        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ep_session ON episodes(session, ts);
CREATE INDEX IF NOT EXISTS idx_ep_ts      ON episodes(ts);

CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'fact',
    fingerprint TEXT NOT NULL UNIQUE,    -- normalised hash, blocks duplicates
    confidence REAL NOT NULL DEFAULT 0.6,
    source     TEXT DEFAULT 'conversation',
    pinned     INTEGER NOT NULL DEFAULT 0,
    created    REAL NOT NULL,
    updated    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_cat ON memories(category);

CREATE TABLE IF NOT EXISTS actions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    goal    TEXT NOT NULL,
    plan    TEXT,
    status  TEXT NOT NULL DEFAULT 'pending',
    result  TEXT,
    ts      REAL NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    MEMORY_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(MEMORY_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


# ---------------------------------------------------------------------------
# normalisation / fingerprints
# ---------------------------------------------------------------------------

_STOP = {
    "the", "a", "an", "is", "are", "was", "were", "to", "of", "and", "in", "on",
    "i", "my", "me", "you", "it", "that", "this", "hai", "ha", "ho", "ka", "ki",
    "ko", "me", "mein", "se", "aur", "bhi", "na", "nahi",
}


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9\u0900-\u097F]+", (text or "").lower()) if t not in _STOP]


def fingerprint(content: str) -> str:
    """Order-insensitive fingerprint so paraphrased duplicates collapse."""
    toks = sorted(set(_tokens(content)))
    base = " ".join(toks) or (content or "").strip().lower()
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------------------
# layer A — episodes (short-term / conversation)
# ---------------------------------------------------------------------------


def add_episode(session: str, role: str, content: str, emotion: str | None = None) -> int:
    content = (content or "")[:MAX_CONTENT]
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO episodes(session, role, content, emotion, ts) VALUES (?,?,?,?,?)",
            (session or "default", role, content, emotion, time.time()),
        )
        return int(cur.lastrowid)


def recent_episodes(session: str = "default", limit: int = 16) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE session=? ORDER BY ts DESC LIMIT ?",
            (session or "default", max(1, limit)),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def conversation_history(session: str = "default", limit: int = 200) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE session=? ORDER BY ts ASC LIMIT ?",
            (session or "default", max(1, limit)),
        ).fetchall()
    return [dict(r) for r in rows]


def sessions() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT session, COUNT(*) AS turns, MIN(ts) AS started, MAX(ts) AS last
               FROM episodes GROUP BY session ORDER BY last DESC LIMIT 50"""
        ).fetchall()
    return [dict(r) for r in rows]


def delete_session(session: str) -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM episodes WHERE session=?", (session,))
        return cur.rowcount


def clear_all_history() -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM episodes")
        return cur.rowcount


def episodes_on_day(day: str | None = None) -> list[dict]:
    """`day` is YYYY-MM-DD; defaults to yesterday when omitted."""
    if not day:
        day = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start = datetime.strptime(day, "%Y-%m-%d").timestamp()
    end = start + 86400
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE ts>=? AND ts<? ORDER BY ts ASC", (start, end)
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# layer B — long-term memories
# ---------------------------------------------------------------------------

CATEGORIES = ["fact", "preference", "person", "project", "routine", "emotion", "goal", "other"]


def add_memory(content: str, category: str = "fact", confidence: float = 0.6,
               source: str = "conversation") -> dict:
    content = re.sub(r"\s+", " ", (content or "").strip())[:400]
    if len(content) < 3:
        return {"ok": False, "reason": "too short"}

    cat = category if category in CATEGORIES else "other"
    fp = fingerprint(content)
    now = time.time()

    with _connect() as conn:
        existing = conn.execute("SELECT * FROM memories WHERE fingerprint=?", (fp,)).fetchone()
        if existing:
            # bump confidence rather than storing a duplicate
            conn.execute(
                "UPDATE memories SET confidence=?, updated=? WHERE id=?",
                (min(1.0, float(existing["confidence"]) + 0.1), now, existing["id"]),
            )
            return {"ok": True, "deduped": True, "id": existing["id"]}

        cur = conn.execute(
            """INSERT INTO memories(content, category, fingerprint, confidence, source, created, updated)
               VALUES (?,?,?,?,?,?,?)""",
            (content, cat, fp, max(0.0, min(1.0, confidence)), source, now, now),
        )
        return {"ok": True, "id": int(cur.lastrowid), "deduped": False}


def list_memories(category: str | None = None, limit: int = 300) -> list[dict]:
    with _connect() as conn:
        if category and category != "all":
            rows = conn.execute(
                "SELECT * FROM memories WHERE category=? ORDER BY pinned DESC, updated DESC LIMIT ?",
                (category, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM memories ORDER BY pinned DESC, updated DESC LIMIT ?", (limit,)
            ).fetchall()
    return [dict(r) for r in rows]


def update_memory(mem_id: int, content: str | None = None, category: str | None = None,
                  pinned: bool | None = None) -> dict:
    sets, args = [], []
    if content is not None:
        content = re.sub(r"\s+", " ", content.strip())[:400]
        sets += ["content=?", "fingerprint=?"]
        args += [content, fingerprint(content)]
    if category is not None and category in CATEGORIES:
        sets.append("category=?")
        args.append(category)
    if pinned is not None:
        sets.append("pinned=?")
        args.append(1 if pinned else 0)
    if not sets:
        return {"ok": False, "reason": "nothing to change"}
    sets.append("updated=?")
    args.append(time.time())
    args.append(mem_id)
    try:
        with _connect() as conn:
            cur = conn.execute(f"UPDATE memories SET {', '.join(sets)} WHERE id=?", args)
            if cur.rowcount <= 0:
                return {"ok": False, "reason": "memory not found"}
        return {"ok": True}
    except sqlite3.IntegrityError:
        # the edited text already exists as another memory — say so instead of 500
        return {"ok": False, "reason": "An identical memory already exists."}


def delete_memory(mem_id: int) -> bool:
    with _connect() as conn:
        return conn.execute("DELETE FROM memories WHERE id=?", (mem_id,)).rowcount > 0


def clear_memories() -> int:
    with _connect() as conn:
        return conn.execute("DELETE FROM memories").rowcount


def search_memories(query: str, limit: int = 8) -> list[dict]:
    """Keyword scoring — deliberately simple, fast and explainable."""
    qt = set(_tokens(query))
    if not qt:
        return []
    scored = []
    for m in list_memories(limit=1000):
        mt = set(_tokens(m["content"]))
        if not mt:
            continue
        overlap = len(qt & mt)
        if overlap == 0:
            continue
        score = overlap / (len(qt) ** 0.5) + 0.15 * float(m["confidence"])
        if m["pinned"]:
            score += 0.3
        # freshness nudge
        age_days = (time.time() - float(m["updated"])) / 86400
        score += max(0.0, 0.12 - age_days * 0.004)
        scored.append((score, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:limit]]


# ---------------------------------------------------------------------------
# layer C — contextual recall
# ---------------------------------------------------------------------------

_DAY_WORDS = {
    "yesterday": -1, "kal": -1, "aaj": 0, "today": 0, "parso": -2,
    "last week": -7, "pichle hafte": -7,
}


def _day_from_phrase(text: str) -> str | None:
    low = (text or "").lower()
    for word, delta in _DAY_WORDS.items():
        if word in low:
            return (datetime.now() + timedelta(days=delta)).strftime("%Y-%m-%d")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", low)
    return m.group(1) if m else None


def contextual_recall(query: str, session: str = "default") -> dict:
    """What MIRA should bring to mind before answering."""
    day = _day_from_phrase(query)
    out = {
        "memories": search_memories(query, limit=8),
        "recent": recent_episodes(session, limit=8),
        "day_episodes": [],
        "day": day,
    }
    if day:
        out["day_episodes"] = episodes_on_day(day)[:30]
    return out


# ---------------------------------------------------------------------------
# automatic memory extraction (no model required)
# ---------------------------------------------------------------------------

_PATTERNS = [
    (r"\bmy name is\s+([A-Za-z\u0900-\u097F ]{2,30})", "person", "The user's name is {0}."),
    (r"\bmera naam\s+([A-Za-z\u0900-\u097F ]{2,30})", "person", "The user's name is {0}."),
    (r"\bi (?:live|stay) in\s+([A-Za-z\u0900-\u097F ,]{2,40})", "fact", "The user lives in {0}."),
    (r"\bmain\s+([A-Za-z\u0900-\u097F ,]{2,40})\s+me(?:in)?\s+(?:rehta|rehti)", "fact", "The user lives in {0}."),
    (r"\bi (?:love|like|enjoy)\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{2,50})", "preference", "The user likes {0}."),
    (r"\bmujhe\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{2,50})\s+pasand", "preference", "The user likes {0}."),
    (r"\bi (?:hate|dislike)\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{2,50})", "preference", "The user dislikes {0}."),
    (r"\bi work (?:as|at)\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{2,50})", "fact", "The user works as {0}."),
    (r"\bmy (?:favourite|favorite)\s+(\w+)\s+is\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{2,40})", "preference", "The user's favourite {0} is {1}."),
    (r"\bi(?:'m| am)\s+(\d{1,2})\s*(?:years? old|saal)", "fact", "The user is {0} years old."),
    (r"\bi(?:'m| am) (?:working on|building)\s+([A-Za-z0-9\u0900-\u097F ,'&+-]{3,60})", "project", "The user is working on {0}."),
    (r"\bremember (?:that )?(.{6,120})", "fact", "{0}"),
    (r"\byaad rakho (?:ki )?(.{6,120})", "fact", "{0}"),
]

_SECRET_WORDS = ("password", "passwd", "otp", "cvv", "pin ", "api key", "apikey",
                 "secret", "token", "credit card", "aadhaar", "aadhar")


def looks_sensitive(text: str) -> bool:
    low = (text or "").lower()
    return any(w in low for w in _SECRET_WORDS)


_CUT = re.compile(
    r"\s+(?:and|aur|but|lekin|par|because|kyunki|so|isliye|then|phir)\s+|[,;!?]|\s+jo\s+|\s+which\s+",
    re.IGNORECASE,
)


_TRAIL = re.compile(r"\s+(?:hai|hoon|ho|tha|thi|the|raj|raha|rahi)\s*$", re.IGNORECASE)


def _trim_phrase(value: str) -> str:
    """'arjun and i love biryani' -> 'arjun';  'priya hai' -> 'priya'."""
    value = _CUT.split(value, 1)[0].strip(" .,'\"-")
    value = _TRAIL.sub("", value).strip(" .,'\"-")
    return value


# "mera naam kya hai" is a question, not a fact about the user.
_BAD_VALUES = {
    "kya", "kaun", "kaunsi", "kaise", "kaisa", "kahan", "kab", "kyun", "kyu",
    "what", "who", "how", "where", "which", "why", "hai", "hain", "nahi", "not",
    "yaad", "kuch", "sab", "mera", "meri", "mere", "tum", "tumhara", "tera",
}


def extract_memories(text: str) -> list[tuple[str, str]]:
    """Return [(content, category)] candidates found in a user message."""
    if not text or looks_sensitive(text):
        return []
    found: list[tuple[str, str]] = []
    low = " " + text.lower().strip() + " "

    for pattern, category, template in _PATTERNS:
        for m in re.finditer(pattern, low, flags=re.IGNORECASE):
            groups = [_trim_phrase(g) for g in m.groups() if g]
            if not groups:
                continue
            if any(not g or len(g) < 2 for g in groups):
                continue
            if any(g.lower() in _BAD_VALUES for g in groups):
                continue
            if category == "person" or "lives in" in template:
                groups = [g.title() for g in groups]
            try:
                content = template.format(*groups)
            except (IndexError, KeyError):
                content = m.group(0)
            content = re.sub(r"\s+", " ", content).strip()
            if 4 < len(content) < 300:
                found.append((content[0].upper() + content[1:], category))

    # de-duplicate within this message
    seen, unique = set(), []
    for content, cat in found:
        fp = fingerprint(content)
        if fp not in seen:
            seen.add(fp)
            unique.append((content, cat))
    return unique[:6]


# ---------------------------------------------------------------------------
# stats / export
# ---------------------------------------------------------------------------


def stats() -> dict:
    with _connect() as conn:
        e = conn.execute("SELECT COUNT(*) c FROM episodes").fetchone()["c"]
        m = conn.execute("SELECT COUNT(*) c FROM memories").fetchone()["c"]
        s = conn.execute("SELECT COUNT(DISTINCT session) c FROM episodes").fetchone()["c"]
        by_cat = conn.execute(
            "SELECT category, COUNT(*) c FROM memories GROUP BY category"
        ).fetchall()
    return {
        "episodes": e,
        "memories": m,
        "sessions": s,
        "by_category": {r["category"]: r["c"] for r in by_cat},
        "db_path": str(MEMORY_DB),
    }


def export_all() -> dict:
    with _connect() as conn:
        eps = [dict(r) for r in conn.execute("SELECT * FROM episodes ORDER BY ts").fetchall()]
        mems = [dict(r) for r in conn.execute("SELECT * FROM memories ORDER BY created").fetchall()]
        acts = [dict(r) for r in conn.execute("SELECT * FROM actions ORDER BY ts").fetchall()]
    return {
        "app": "MIRA",
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "episodes": eps,
        "memories": mems,
        "actions": acts,
    }


def log_action(goal: str, plan: list, status: str, result: str = "") -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO actions(goal, plan, status, result, ts) VALUES (?,?,?,?,?)",
            (goal[:400], json.dumps(plan, ensure_ascii=False)[:8000], status, result[:4000], time.time()),
        )
        return int(cur.lastrowid)


def recent_actions(limit: int = 20) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM actions ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["plan"] = json.loads(d["plan"] or "[]")
        except Exception:
            d["plan"] = []
        out.append(d)
    return out
