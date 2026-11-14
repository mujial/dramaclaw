"""mem0 — optional richer long-term memory backend."""
ENGINE_ID = "mem0"

_CLIENT = None

def available() -> bool:
    try:
        import mem0  # noqa: F401
        return True
    except Exception:
        return False

def handle(payload: dict):
    """payload: {action: add|search, user_id, text|query}"""
    global _CLIENT
    try:
        from mem0 import Memory
    except Exception as exc:
        return {"ok": False, "error": f"mem0 not installed: {exc}"}
    p = payload or {}
    try:
        if _CLIENT is None:
            _CLIENT = Memory()
        action = p.get("action", "search")
        uid = p.get("user_id", "mira-user")
        if action == "add":
            return {"ok": True, "result": _CLIENT.add(p.get("text", ""), user_id=uid)}
        return {"ok": True, "result": _CLIENT.search(p.get("query", ""), user_id=uid)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
