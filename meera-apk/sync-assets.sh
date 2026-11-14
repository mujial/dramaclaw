#!/usr/bin/env bash
# Copy the Meera HUD into the Android asset tree and inject the native bridge.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../meera-assistant"
DEST="$HERE/app/src/main/assets/www"

[ -d "$SRC" ] || { echo "missing $SRC"; exit 1; }
mkdir -p "$DEST"

for f in index.html styles.css meera.js icon.png manifest.json; do
  cp "$SRC/$f" "$DEST/$f"
done

# native-bridge.js must load before meera.js
python3 - "$DEST/index.html" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
html = p.read_text(encoding='utf-8')
tag = '<script src="native-bridge.js"></script>\n'
if 'native-bridge.js' not in html:
    html = html.replace('<script src="meera.js"></script>', tag + '<script src="meera.js"></script>')
p.write_text(html, encoding='utf-8')
print('  injected native-bridge.js')
PY

echo "synced -> $DEST"
ls -la "$DEST"
