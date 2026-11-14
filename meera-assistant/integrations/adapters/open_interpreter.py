"""
Open Interpreter adapter — Meera's hands.

Turns a natural-language request into real actions on the machine (files,
shell commands, data work). The package is installed lazily so a missing
dependency never blocks the gateway.

Requires an LLM backend. Supported out of the box:
    OPENAI_API_KEY=sk-...                 (OpenAI / compatible)
    OPENINTERPRETER_MODEL=gpt-4o-mini     (override the model)
For fully local use, point it at Ollama:
    interpreter.local = True
    interpreter.model = "ollama/llama3"
"""

import os

ENGINE_ID = "open-interpreter"


def _interpreter():
    from interpreter import interpreter  # type: ignore
    return interpreter


def available() -> bool:
    try:
        import interpreter  # noqa: F401
    except Exception:
        return False
    # A real run also needs a model provider; without one the engine is
    # installed but not usable, so we report it honestly.
    if os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENINTERPRETER_MODEL"):
        return True
    if os.environ.get("OPENINTERPRETER_LOCAL") == "1":
        return True
    return False


def handle(message: str):
    try:
        interpreter = _interpreter()
    except Exception:
        return None

    if os.environ.get("OPENINTERPRETER_LOCAL") == "1":
        interpreter.local = True
        interpreter.model = os.environ.get("OPENINTERPRETER_MODEL", "ollama/llama3")
    else:
        interpreter.local = False
        if os.environ.get("OPENINTERPRETER_MODEL"):
            interpreter.model = os.environ["OPENINTERPRETER_MODEL"]

    # Safety: never let the assistant execute anything unattended.
    interpreter.auto_run = False
    interpreter.safe_mode = "ask"

    chunks = []
    try:
        for chunk in interpreter.chat(message, display=False, stream=True):
            if isinstance(chunk, dict):
                c = chunk.get("content")
                if isinstance(c, str) and c.strip():
                    chunks.append(c.strip())
    except Exception as exc:
        return f"Open Interpreter error: {exc}"

    text = "\n".join(chunks).strip()
    if not text:
        return None
    if not interpreter.auto_run:
        text += "\n\n(Code was proposed, not executed — auto-run is disabled in Meera.)"
    return text
