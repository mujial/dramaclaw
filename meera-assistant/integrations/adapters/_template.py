"""
Template engine adapter.

Copy this file, rename it to your engine, and fill in the blanks.
Files starting with an underscore are ignored by the loader.
"""

ENGINE_ID = "my-engine"          # must match an id in ../../manifest.json


def available() -> bool:
    """Return True only if the engine can actually answer right now."""
    try:
        import some_package  # noqa: F401
        return True
    except Exception:
        return False


def handle(message: str):
    """Answer the message, or return None to let Meera fall back."""
    if not available():
        return None

    # ... call your engine here ...
    return None
