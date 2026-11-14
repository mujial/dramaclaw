"""
MIRA — tool & skill system.

Every capability is a `Tool` with a name, description, JSON input/output
schemas, a permission level and its own error handling. Skills are simply
groups of tools, so new capabilities can be dropped in without touching the
rest of the app.

Permission levels
  safe      runs without asking
  confirm   requires an explicit yes from the user (shown in the UI)
  blocked   disabled entirely until the user enables it in Settings

Nothing here pretends to have worked. `ToolResult.ok` is False on failure and
the error text goes straight back to the conversation.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

try:
    import httpx
except Exception:  # pragma: no cover
    httpx = None

from . import memory as mem
from .config import load_settings
from . import net as http

# ---------------------------------------------------------------------------
# types
# ---------------------------------------------------------------------------


@dataclass
class ToolResult:
    ok: bool
    data: object = None
    error: str | None = None
    summary: str = ""

    def to_dict(self) -> dict:
        return {"ok": self.ok, "data": self.data, "error": self.error, "summary": self.summary}


@dataclass
class Tool:
    name: str
    description: str
    skill: str
    input_schema: dict
    output_schema: dict
    permission: str                 # safe | confirm | blocked
    fn: Callable[..., ToolResult]
    timeout: float = 20.0
    tags: list[str] = field(default_factory=list)

    def spec(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "skill": self.skill,
            "permission": self.permission,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
        }

    def run(self, **kwargs) -> ToolResult:
        started = time.time()
        try:
            result = self.fn(**kwargs)
            if not isinstance(result, ToolResult):
                result = ToolResult(ok=True, data=result, summary=str(result)[:200])
        except TypeError as exc:
            result = ToolResult(ok=False, error=f"bad arguments: {exc}")
        except Exception as exc:
            result = ToolResult(ok=False, error=f"{type(exc).__name__}: {exc}")
        result.elapsed_ms = int((time.time() - started) * 1000)
        return result


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, skill: str, permission: str = "safe",
         input_schema: dict | None = None, output_schema: dict | None = None,
         tags: list[str] | None = None):
    """Decorator registering a function as a MIRA tool."""
    def deco(fn: Callable) -> Callable:
        REGISTRY[name] = Tool(
            name=name,
            description=description,
            skill=skill,
            permission=permission,
            input_schema=input_schema or {"type": "object", "properties": {}},
            output_schema=output_schema or {"type": "object"},
            fn=fn,
            tags=tags or [],
        )
        return fn
    return deco


def get(name: str) -> Tool | None:
    return REGISTRY.get(name)


def catalogue() -> list[dict]:
    return [t.spec() for t in REGISTRY.values()]


def skills() -> list[dict]:
    """Group the registry into skills for the dashboard."""
    settings = load_settings()
    disabled = set(settings.get("disabled_skills") or [])
    grouped: dict[str, dict] = {}
    for t in REGISTRY.values():
        g = grouped.setdefault(t.skill, {
            "skill": t.skill,
            "enabled": t.skill not in disabled,
            "tools": [],
            "permissions": set(),
        })
        g["tools"].append(t.name)
        g["permissions"].add(t.permission)
    out = []
    for g in grouped.values():
        g["permissions"] = sorted(g["permissions"])
        g["tool_count"] = len(g["tools"])
        out.append(g)
    return sorted(out, key=lambda x: x["skill"])


# ---------------------------------------------------------------------------
# Skill: core (time, math, system)
# ---------------------------------------------------------------------------


@tool("time_now", "Current local time, date and timezone offset.", "core",
      input_schema={"type": "object", "properties": {}},
      output_schema={"type": "object", "properties": {"time": {"type": "string"}}})
def _time_now():
    now = datetime.now().astimezone()
    return ToolResult(True, {
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%A, %d %B %Y"),
        "iso": now.isoformat(timespec="seconds"),
        "tz": now.strftime("%Z"),
    }, summary=now.strftime("%H:%M, %A %d %B"))


@tool("calculate", "Evaluate an arithmetic expression (numbers and + - * / ( ) %).",
      "core",
      input_schema={"type": "object", "required": ["expression"],
                    "properties": {"expression": {"type": "string"}}},
      output_schema={"type": "object", "properties": {"value": {"type": "number"}}})
def _calculate(expression: str):
    cleaned = re.sub(r"[^0-9+\-*/().%\s]", "", str(expression))
    if not cleaned.strip() or not re.search(r"\d", cleaned):
        return ToolResult(False, error="no arithmetic in input")
    try:
        value = eval(cleaned, {"__builtins__": {}}, {})  # noqa: S307
    except Exception as exc:
        return ToolResult(False, error=f"could not evaluate: {exc}")
    if not isinstance(value, (int, float)):
        return ToolResult(False, error="expression did not produce a number")
    return ToolResult(True, {"expression": cleaned.strip(), "value": value},
                      summary=f"{cleaned.strip()} = {value}")


@tool("system_status", "MIRA's own runtime and memory statistics.", "core")
def _system_status():
    from .config import SECRETS
    st = mem.stats()
    return ToolResult(True, {
        "memory": st,
        "keys_saved": SECRETS.names(),
        "secrets_encrypted": SECRETS.encrypted,
        "local_time": datetime.now().strftime("%H:%M"),
    }, summary=f"{st['episodes']} turns, {st['memories']} memories")


# ---------------------------------------------------------------------------
# Skill: memory
# ---------------------------------------------------------------------------


@tool("memory_remember", "Store a durable fact about the user.",
      "memory", permission="safe",
      input_schema={"type": "object", "required": ["content"],
                    "properties": {
                        "content": {"type": "string"},
                        "category": {"type": "string",
                                     "enum": mem.CATEGORIES}}})
def _memory_remember(content: str, category: str = "fact"):
    if mem.looks_sensitive(content):
        return ToolResult(False, error="refused: looks like a secret/credential")
    res = mem.add_memory(content, category)
    if not res.get("ok"):
        return ToolResult(False, error=res.get("reason", "could not store"))
    return ToolResult(True, dict(res, content=content),
                      summary=("already knew that: " + content[:60]) if res.get("deduped")
                      else ("remembered: " + content[:60]))


@tool("memory_search", "Search MIRA's long-term memory.", "memory",
      input_schema={"type": "object", "required": ["query"],
                    "properties": {"query": {"type": "string"},
                                   "limit": {"type": "integer"}}})
def _memory_search(query: str, limit: int = 8):
    hits = mem.search_memories(query, limit=max(1, min(50, int(limit or 8))))
    return ToolResult(True, {"query": query, "results": hits},
                      summary=f"{len(hits)} match(es)")


@tool("memory_recall_day", "Recall the conversation from a specific day.",
      "memory",
      input_schema={"type": "object", "properties": {"day": {"type": "string",
                    "description": "YYYY-MM-DD, defaults to yesterday"}}})
def _memory_recall_day(day: str = ""):
    eps = mem.episodes_on_day(day or None)
    if not eps:
        return ToolResult(True, {"day": day or "yesterday", "episodes": []},
                          summary="nothing recorded that day")
    lines = [f"{e['role']}: {e['content'][:160]}" for e in eps[:24]]
    return ToolResult(True, {"day": day or "yesterday", "episodes": eps,
                             "transcript": "\n".join(lines)},
                      summary=f"{len(eps)} turns on {day or 'yesterday'}")


# ---------------------------------------------------------------------------
# Skill: notes
# ---------------------------------------------------------------------------


def _notes_path():
    from .config import DATA
    return DATA / "notes.json"


def _load_notes() -> list[dict]:
    try:
        return json.loads(_notes_path().read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_notes(notes: list[dict]) -> None:
    _notes_path().write_text(json.dumps(notes, indent=2, ensure_ascii=False), encoding="utf-8")


@tool("note_add", "Add an item to the user's note list.", "notes",
      input_schema={"type": "object", "required": ["text"],
                    "properties": {"text": {"type": "string"}}})
def _note_add(text: str):
    text = (text or "").strip()
    if not text:
        return ToolResult(False, error="empty note")
    notes = _load_notes()
    notes.append({"text": text[:500], "done": False, "created": time.time()})
    _save_notes(notes)
    return ToolResult(True, {"text": text[:500], "count": len(notes)},
                      summary=f"noted \"{text[:60]}\" ({len(notes)} total)")


@tool("note_list", "List the user's notes.", "notes")
def _note_list():
    notes = _load_notes()
    return ToolResult(True, {"notes": notes},
                      summary=f"{sum(1 for n in notes if not n['done'])} open note(s)")


@tool("note_done", "Mark a note as done by its 1-based index.", "notes",
      input_schema={"type": "object", "required": ["index"],
                    "properties": {"index": {"type": "integer"}}})
def _note_done(index: int):
    notes = _load_notes()
    i = int(index) - 1
    if not (0 <= i < len(notes)):
        return ToolResult(False, error=f"no note at index {index}")
    notes[i]["done"] = True
    _save_notes(notes)
    return ToolResult(True, {"note": notes[i]}, summary=f"done: {notes[i]['text'][:60]}")


# ---------------------------------------------------------------------------
# Skill: web research
# ---------------------------------------------------------------------------


def _html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = (html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
                .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))
    return re.sub(r"\s+", " ", html).strip()


@tool("web_read", "Fetch a URL and return its readable text (HTML is stripped).",
      "research",
      input_schema={"type": "object", "required": ["url"],
                    "properties": {"url": {"type": "string"},
                                   "max_chars": {"type": "integer"}}})
def _web_read(url: str, max_chars: int = 6000):
    if not re.match(r"^https?://", url or ""):
        return ToolResult(False, error="only http(s) URLs are allowed")
    try:
        r = http.get(url, timeout=20, follow_redirects=True, 
                      headers={"User-Agent": "MIRA/1.0 (+personal assistant)"})
    except Exception as exc:
        return ToolResult(False, error=f"fetch failed: {exc}")
    if r.status_code >= 400:
        return ToolResult(False, error=f"HTTP {r.status_code} from {url}")
    ctype = r.headers.get("content-type", "")
    text = _html_to_text(r.text) if "html" in ctype else r.text
    text = text[: int(max_chars or 6000)]
    return ToolResult(True, {"url": url, "status": r.status_code, "text": text,
                             "chars": len(text)},
                      summary=f"read {len(text)} chars from {urllib.parse.urlparse(url).netloc}")


@tool("github_repo", "Analyse a public GitHub repository (stars, language, activity).",
      "research",
      input_schema={"type": "object", "required": ["repo"],
                    "properties": {"repo": {"type": "string",
                                            "description": "owner/name"}}})
def _github_repo(repo: str):
    repo = (repo or "").strip().strip("/")
    if not re.match(r"^[\w.-]+/[\w.-]+$", repo):
        return ToolResult(False, error="expected owner/name")
    try:
        r = http.get(f"https://api.github.com/repos/{repo}", timeout=20,
                      headers={"Accept": "application/vnd.github+json"})
    except Exception as exc:
        return ToolResult(False, error=f"GitHub request failed: {exc}")
    if r.status_code == 404:
        return ToolResult(False, error=f"repository '{repo}' not found")
    if r.status_code != 200:
        return ToolResult(False, error=f"GitHub HTTP {r.status_code}")
    d = r.json()
    info = {
        "full_name": d.get("full_name"),
        "description": d.get("description"),
        "stars": d.get("stargazers_count"),
        "forks": d.get("forks_count"),
        "language": d.get("language"),
        "open_issues": d.get("open_issues_count"),
        "license": (d.get("license") or {}).get("spdx_id"),
        "pushed_at": d.get("pushed_at"),
        "url": d.get("html_url"),
    }
    return ToolResult(True, info,
                      summary=f"{info['full_name']}: {info['stars']} stars, {info['language']}")


# ---------------------------------------------------------------------------
# Skill: device / planner
# ---------------------------------------------------------------------------


@tool("plan_create", "Turn a goal into an ordered checklist.", "planner",
      input_schema={"type": "object", "required": ["goal"],
                    "properties": {"goal": {"type": "string"},
                                   "steps": {"type": "array",
                                             "items": {"type": "string"}}}})
def _plan_create(goal: str, steps: list | None = None):
    if not steps:
        steps = [s.strip() for s in re.split(r"[.;\n]", goal) if s.strip()]
    plan = [{"n": i + 1, "step": s, "done": False} for i, s in enumerate(steps[:12])]
    return ToolResult(True, {"goal": goal, "plan": plan}, summary=f"{len(plan)} steps")


@tool("delete_all_data", "Delete every conversation and memory. Irreversible.",
      "privacy", permission="confirm",
      input_schema={"type": "object", "properties": {"confirm": {"type": "boolean"}}})
def _delete_all_data(confirm: bool = False):
    if not confirm:
        return ToolResult(False, error="confirmation required")
    a = mem.clear_all_history()
    b = mem.clear_memories()
    return ToolResult(True, {"episodes_deleted": a, "memories_deleted": b},
                      summary=f"deleted {a} turns and {b} memories")


# ---------------------------------------------------------------------------
# dispatch helpers
# ---------------------------------------------------------------------------


def run_tool(name: str, args: dict | None = None) -> dict:
    t = get(name)
    if t is None:
        return {"ok": False, "error": f"unknown tool '{name}'"}
    disabled = set(load_settings().get("disabled_skills") or [])
    if t.skill in disabled:
        return {"ok": False, "error": f"skill '{t.skill}' is disabled in Settings"}
    args = args or {}
    allowed = set((t.input_schema.get("properties") or {}).keys())
    clean = {k: v for k, v in args.items() if k in allowed}
    res = t.run(**clean)
    out = res.to_dict()
    out["tool"] = name
    out["elapsed_ms"] = getattr(res, "elapsed_ms", None)
    return out


# ---------------------------------------------------------------------------
# device actions — the phone itself does the opening
# ---------------------------------------------------------------------------
#
# The Python brain runs inside the app but cannot launch Android intents by
# itself. So these tools return a *requested action* in the result payload; the
# shell executes it through the native bridge and reports back. The tool still
# says exactly what it asked for, so nothing is claimed before it happens.

@tool("open_app", "Open an installed app on the phone by name (WhatsApp, YouTube, …).",
      "device", permission="safe",
      input_schema={"type": "object", "required": ["app"],
                    "properties": {"app": {"type": "string",
                                           "description": "app name as it appears in the launcher"}}})
def _open_app(app: str):
    name = (app or "").strip()
    if not name:
        return ToolResult(False, error="no app name")
    return ToolResult(True,
                      {"action": "open_app", "app": name},
                      summary=f"{name} kholne ki koshish")


@tool("open_url", "Open a website on the phone.",
      "device", permission="safe",
      input_schema={"type": "object", "required": ["url"],
                    "properties": {"url": {"type": "string"}}})
def _open_url(url: str):
    u = (url or "").strip()
    if not u:
        return ToolResult(False, error="no url")
    if not re.match(r"^[a-z]+://", u, re.I):
        if "." not in u and " " not in u:
            return ToolResult(False, error="that is not a website")
        u = "https://" + u.replace(" ", "")
    pretty = re.sub(r"^https?://", "", u).rstrip("/")
    return ToolResult(True, {"action": "open_url", "url": u},
                      summary=f"{pretty} khol rahi hoon")


_PHONE_KINDS = {"call", "sms", "alarm", "maps", "camera", "settings",
                "share", "email", "playstore", "websearch"}


@tool("phone_action", "Do a phone thing: call, sms, alarm, maps, camera, settings, share.",
      "device", permission="safe",
      input_schema={"type": "object", "required": ["kind"],
                    "properties": {
                        "kind": {"type": "string", "enum": sorted(_PHONE_KINDS)},
                        "value": {"type": "string",
                                  "description": "number / text / place / time, depending on kind"}}})
def _phone_action(kind: str, value: str = ""):
    k = (kind or "").strip().lower()
    if k not in _PHONE_KINDS:
        return ToolResult(False, error=f"unknown phone action '{kind}'")
    return ToolResult(True, {"action": "phone", "kind": k, "value": (value or "").strip()},
                      summary=f"phone: {k} {value}".strip())


@tool("web_search", "Search the web and return the top results (real HTTP, no key).",
      "research", permission="safe",
      input_schema={"type": "object", "required": ["query"],
                    "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}})
def _web_search(query: str, limit: int = 5):
    q = (query or "").strip()
    if not q:
        return ToolResult(False, error="empty query")
    n = max(1, min(8, int(limit or 5)))
    google = "https://www.google.com/search?q=" + urllib.parse.quote(q)
    errors = []

    def ddg_html():
        r = http.get("https://html.duckduckgo.com/html/", params={"q": q}, timeout=15,
                     headers={"User-Agent": "Mozilla/5.0 (Linux; Android 10) MIRA"})
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}")
        out = []
        for m in re.finditer(r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                             r.text, re.S):
            link = urllib.parse.unquote(m.group(1))
            mm = re.search(r"uddg=([^&]+)", link)
            if mm:
                link = urllib.parse.unquote(mm.group(1))
            title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
            if title and link.startswith("http"):
                out.append({"title": title[:140], "url": link, "source": "duckduckgo"})
            if len(out) >= n:
                break
        return out

    def wiki():
        r = http.get("https://en.wikipedia.org/w/api.php", timeout=15,
                     params={"action": "query", "list": "search", "srsearch": q,
                             "format": "json", "srlimit": n},
                     headers={"User-Agent": "MIRA/2.0 (personal assistant)"})
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}")
        data = r.json()
        out = []
        for hit in (data.get("query") or {}).get("search") or []:
            title = hit.get("title") or ""
            out.append({"title": title,
                        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                        "source": "wikipedia"})
        return out

    hits = []
    for backend in (ddg_html, wiki):
        try:
            hits = backend()
        except Exception as exc:
            errors.append(f"{backend.__name__}: {exc}")
        if hits:
            break

    if hits:
        return ToolResult(True,
                          {"query": q, "results": hits, "action": "open_url", "url": hits[0]["url"]},
                          summary="; ".join(h["title"][:50] for h in hits[:3]))

    # Nothing fetchable from here (offline, blocked network). The phone can
    # still open a real search — so do that instead of failing silently.
    return ToolResult(True,
                      {"query": q, "results": [], "action": "open_url", "url": google,
                       "note": "results could not be fetched; opening the browser search",
                       "errors": errors},
                      summary=f"'{q}' browser me search kar rahi hoon")
