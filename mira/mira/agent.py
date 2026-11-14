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

from . import memory as mem
from . import tools
from .config import load_settings
from .providers import chat as provider_chat

MAX_STEPS = 8


# ---------------------------------------------------------------------------
# planning
# ---------------------------------------------------------------------------

PLAN_PROMPT = """You are MIRA's task planner. Break the user's goal into at most 6 concrete steps.

Available tools (name: description):
{tools}

Answer with JSON only, no prose, in exactly this shape:
{{"steps":[{{"step":"short imperative description","tool":"tool_name_or_null","args":{{}}}}]}}

Rules:
- Only use a tool from the list, or null when the step is reasoning/说话 only.
- Include the minimum number of steps that actually achieves the goal.
- If the goal cannot be achieved with these tools, return a single step with tool null.
"""


def _tool_catalogue_text() -> str:
    return "\n".join(f"- {t['name']}: {t['description']}" for t in tools.catalogue())


def plan_with_model(goal: str) -> list[dict] | None:
    settings = load_settings()
    if settings.get("provider") == "local":
        return None

    prompt = PLAN_PROMPT.format(tools=_tool_catalogue_text())
    messages = [{"role": "user", "content": f"Goal: {goal}"}]
    try:
        res = provider_chat(messages, {**settings, "_memories": []})
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

_RULES = [
    (r"(https?://\S+)", "web_read", lambda m: {"url": m.group(1)}),
    (r"github\.com/([\w.-]+/[\w.-]+)", "github_repo", lambda m: {"repo": m.group(1)}),
    (r"\b(?:repo|repository)\s+([\w.-]+/[\w.-]+)", "github_repo", lambda m: {"repo": m.group(1)}),
]


def plan_offline(goal: str) -> list[dict]:
    low = goal.lower()

    # destructive / irreversible — always routed through the confirm gate
    if re.search(r"(delete|wipe|erase|clear|mita|hata)\s+(all|sab|sara|everything|mera data|my data)", low) \
       or re.search(r"(reset|factory reset|sab kuch mita)", low):
        return [{"step": "Wipe all MIRA data", "tool": "delete_all_data", "args": {}}]

    # ---- device commands: open / search / call / alarm / maps ----
    # "youtube.com kholo" -> browser, "youtube kholo" -> the app itself
    _VERBS = {"karo", "kar", "kro", "do", "de", "na", "please", "plz", "abhi", "ab",
              "jaldi", "zara", "mera", "meri", "mere", "kholo", "open", "launch", "it", "the"}

    # suffix form first: "WhatsApp kholo" / "YouTube open karo" / "camera khol do"
    m2 = re.search(
        r"^(.+?)\s+(?:ko\s+)?(?:khol|open|chalu|launch|baja)\s*"
        r"(?:o|do|de|na|karo|kar\s*do|kar\s*de)?\s*$",
        goal.strip(), re.I,
    )
    m = re.search(r"^(?:open|khol(?:o|do)|chalu kar(?:o|do)|launch)\s+(.+)$", goal.strip(), re.I)
    target = ""
    if m2:
        target = m2.group(1)
    elif m:
        target = m.group(1)
    target = re.sub(r"\b(app|application|browser|website|site|par|pe|me|mein)\b", " ",
                    target, flags=re.I).strip(" .!?")
    target = re.sub(r"\s+", " ", target).strip()
    if target:
        low_t = target.lower()
        words = [w for w in re.split(r"\s+", low_t) if w]
        if low_t in _VERBS or low_t in {"", "app", "phone"} or \
                all(w in _VERBS for w in words):
            target = ""

    if target:
        if re.search(r"\.(com|in|org|net|io|np|co|dev|ai)\b", low_t) or low_t.startswith("http"):
            return [{"step": f"Open {target}", "tool": "open_url", "args": {"url": target}}]
        if low_t in {"camera", "settings", "whatsapp", "youtube", "instagram", "facebook",
                       "gallery", "maps", "phone", "chrome", "gmail", "telegram", "spotify"} \
                or " " in target or len(target) < 24:
            return [{"step": f"Open {target}", "tool": "open_app", "args": {"app": target}}]

    m = re.search(r"(?:search|google|dhundo|dhoondo|khojo)\s+(?:karo\s+)?(.+)$", goal, re.I)
    if m:
        return [{"step": f"Search for {m.group(1)[:60]}", "tool": "web_search",
                 "args": {"query": m.group(1).strip(" .!?")}}]

    m = re.search(r"^call\s+(.+)$", goal, re.I)
    if m:
        return [{"step": "Open the dialer", "tool": "phone_action",
                 "args": {"kind": "call", "value": m.group(1).strip()}}]

    m = re.search(
        r"(?:alarm|utha\s*do|wake me)\s*(?:lagao|set|baja\s*do)?\s*"
        r"(\d{1,2}(?:[:.\s]\d{2})?\s*(?:am|pm|baje|bje)?)",
        goal, re.I,
    )
    if m:
        return [{"step": "Set the alarm", "tool": "phone_action",
                 "args": {"kind": "alarm", "value": m.group(1).strip()}}]

    m = re.search(r"(?:maps? me|map par|ka rasta)\s+(.+)$", goal, re.I)
    if m:
        return [{"step": "Open maps", "tool": "phone_action",
                 "args": {"kind": "maps", "value": m.group(1).strip(" .!?")}}]

    # explicit time
    if re.search(r"\b(time|date|waqt|tarikh|kya baj)", low):
        return [{"step": "Check the clock", "tool": "time_now", "args": {}}]

    # repo analysis
    m = re.search(r"(?:github\.com/|repo\s+)([\w.-]+/[\w.-]+)", goal)
    if m:
        return [{"step": f"Inspect {m.group(1)}", "tool": "github_repo",
                 "args": {"repo": m.group(1)}}]

    # read a url
    m = re.search(r"(https?://\S+)", goal)
    if m:
        return [{"step": f"Read {m.group(1)}", "tool": "web_read",
                 "args": {"url": m.group(1)}}]

    # arithmetic
    m = re.search(r"(?:calculate|calc|kitna)\s+(.+)$", goal, re.I)
    if m:
        return [{"step": "Evaluate the expression", "tool": "calculate",
                 "args": {"expression": m.group(1)}}]

    # note
    m = re.search(r"(?:note|likh(?:o|do)|yaad rakho)[:\s]+(.+)$", goal, re.I)
    if m:
        return [{"step": "Save the note", "tool": "note_add", "args": {"text": m.group(1)}}]

    # generic goal -> checklist
    return [{"step": f"Break down: {goal[:120]}", "tool": "plan_create",
             "args": {"goal": goal}}]


# ---------------------------------------------------------------------------
# execution
# ---------------------------------------------------------------------------


def execute(goal: str, session: str = "default", auto_confirm: bool = False) -> dict:
    """Run the agent loop and return a full, honest trace."""
    started = time.time()
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

        if t.permission == "confirm" and not auto_confirm:
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

    first = done[0]
    summary = first.get("summary") or ""
    tail = f" {len(done)} step(s) done." if len(done) > 1 else ""
    return f"Ho gaya. {summary}.{tail}".replace("..", ".")


_DEVICE_TOOLS = {"open_app", "open_url", "phone_action", "web_search"}


def quick_action(goal: str) -> list[dict] | None:
    """Return a device plan if this message is an imperative phone command.

    Chat mode uses this so "WhatsApp kholo" just works instead of being
    answered with a paragraph. Anything else returns None and goes to the model.
    """
    steps = plan_offline(goal)
    if steps and steps[0].get("tool") in _DEVICE_TOOLS:
        return steps
    return None
