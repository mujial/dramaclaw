"""Open Interpreter — deep autonomous execution (opt-in, needs an LLM key)."""
ENGINE_ID = "open-interpreter"

def available() -> bool:
    import os
    try:
        import interpreter  # noqa: F401
    except Exception:
        return False
    return bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENINTERPRETER_LOCAL") == "1")

def handle(payload: dict):
    """payload: {goal} -> {ok, output}. Never auto-runs code."""
    try:
        from interpreter import interpreter
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    goal = (payload or {}).get("goal", "")
    if not goal:
        return {"ok": False, "error": "no goal"}
    try:
        interpreter.auto_run = False
        interpreter.safe_mode = "ask"
        chunks = []
        for chunk in interpreter.chat(goal, display=False, stream=True):
            if isinstance(chunk, dict) and isinstance(chunk.get("content"), str):
                chunks.append(chunk["content"])
        out = "\n".join(c.strip() for c in chunks if c.strip())
        return {"ok": bool(out), "output": out or None,
                "note": "auto_run disabled — code was proposed, not executed"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
