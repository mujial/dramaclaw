"""
JARVIS / HuggingGPT adapter — Meera's planner.

Microsoft's JARVIS decomposes a request into subtasks with an LLM, then
dispatches each subtask to a specialist model on Hugging Face. That is a
push-button demo rather than a library, so this adapter runs it as a
subprocess against the vendor checkout.

Setup:
    pip install -r integrations/vendor/JARVIS/requirements.txt
    export OPENAI_API_KEY=sk-...
    export HUGGINGFACE_API_KEY=hf_...
Then Meera can route to it from the engines panel.

Because the upstream demo is interactive and slow, Meera calls it only on
explicit request and caps the runtime.
"""

import os
import subprocess
import sys

ENGINE_ID = "jarvis-hugginggpt"

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(HERE, "vendor", "JARVIS")
TIMEOUT = float(os.environ.get("JARVIS_TIMEOUT", "90"))


def _entrypoint():
    for name in ("run.py", "main.py", "app.py"):
        p = os.path.join(VENDOR, name)
        if os.path.isfile(p):
            return p
    return None


def available() -> bool:
    if not os.path.isdir(VENDOR):
        return False
    if not (os.environ.get("OPENAI_API_KEY") or os.environ.get("HUGGINGFACE_API_KEY")):
        return False
    return _entrypoint() is not None


def handle(message: str):
    entry = _entrypoint()
    if not entry:
        return None

    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")
    try:
        proc = subprocess.run(
            [sys.executable, entry],
            cwd=VENDOR,
            input=(message + "\n").encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return f"HuggingGPT exceeded its {int(TIMEOUT)}s budget — it is a heavy multi-model pipeline."
    except Exception as exc:
        return f"HuggingGPT could not start: {exc}"

    out = (proc.stdout or b"").decode("utf-8", "replace").strip()
    if proc.returncode != 0 and not out:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        return "HuggingGPT failed:\n" + (err[-900:] or f"exit code {proc.returncode}")
    return out[-4000:] if out else None
