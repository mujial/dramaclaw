#!/usr/bin/env python3
"""
Build a single-file, fully offline copy of Meera.

Inlines styles.css, meera.js and the icon (as a data URI) into one .html so
the whole assistant can live in a single download — handy for phones and for
dropping into Netlify / GitHub Pages / PWABuilder.

    python3 build-standalone.py
    -> Meera-AI-Assistant-Standalone.html
"""

import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "Meera-AI-Assistant-Standalone.html"


def main() -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "meera.js").read_text(encoding="utf-8")

    icon_path = ROOT / "icon.png"
    if icon_path.exists():
        data_uri = "data:image/png;base64," + base64.b64encode(icon_path.read_bytes()).decode()
    else:
        data_uri = ""

    # 1. inline the stylesheet
    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>",
    )

    # 2. inline the script
    html = html.replace(
        '<script src="meera.js"></script>',
        "<script>\n" + js + "\n</script>",
    )

    # 3. icon -> data URI
    if data_uri:
        html = html.replace('href="icon.png"', 'href="%s"' % data_uri)

    # 4. a single file cannot register a relative service worker
    html = re.sub(
        r"function registerSW\(\) \{.*?\n\}",
        "function registerSW() { /* single-file build: no service worker */ }",
        html,
        flags=re.S,
    )

    # 5. drop the external manifest link (no file alongside it)
    html = re.sub(r'<link rel="manifest" href="manifest\.json">\n?', "", html)

    # 6. mark it clearly
    html = html.replace(
        "<title>M.E.E.R.A. — Personal AI Assistant</title>",
        "<title>M.E.E.R.A. — Personal AI Assistant (Standalone)</title>",
    )

    OUT.write_text(html, encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"built  {OUT.name}  ({kb:,.0f} KB)")
    print(f"       icon embedded: {'yes' if data_uri else 'no'}")
    ext = re.findall(r'(?:src|href)="(?!data:|#|https?:)[^"]+"', html)
    print("       remaining external refs: %d" % len(ext))
    return 0


if __name__ == "__main__":
    sys.exit(main())
