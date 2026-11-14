"""
MIRA — boot hook for the Android shell (Chaquopy).

MainActivity calls:

    Python.getInstance().getModule("mira.android_boot")
            .callAttr("start", filesDir, "")

`start` points MIRA at the app's private storage (the APK asset tree is
read-only), then runs the standard-library server on 127.0.0.1 and returns the
port the WebView should load.

Nothing here imports third-party code, so it works on a bare CPython runtime.
"""

from __future__ import annotations

import os
import sys
import traceback

_started_port = None
_error = None


def start(data_dir: str, web_dir: str = "", port: int = 0, verbose: bool = False) -> int:
    """Start the server in a background thread; return the port. 0 == failed."""
    global _started_port, _error

    if _started_port:
        return _started_port

    try:
        # Must happen before mira.config is imported anywhere.
        os.environ["MIRA_HOME"] = str(data_dir)
        os.makedirs(data_dir, exist_ok=True)

        if web_dir:
            os.environ["MIRA_WEB"] = str(web_dir)

        from . import standalone  # imports config -> honours MIRA_HOME

        wanted = port or 8090
        chosen = standalone.free_port(wanted)
        web = web_dir or str(standalone.WEB_DIR)

        standalone.start_background("127.0.0.1", chosen, web)
        _started_port = chosen

        if verbose:
            print(f"[mira] server on 127.0.0.1:{chosen}  data={data_dir}  web={web}")

        # Warm the heavy imports so the first tap is fast, not the first click.
        try:
            from . import memory
            memory.init()
        except Exception:
            traceback.print_exc()

        return chosen
    except Exception as exc:  # never crash the Activity
        _error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        return 0


def last_error() -> str:
    return _error or ""


def python_info() -> str:
    return f"{sys.version.split()[0]} ({sys.implementation.name})"
