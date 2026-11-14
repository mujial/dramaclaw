#!/usr/bin/env bash
# Copy MIRA's Python brain and web UI into the Android module.
#
# Two copies on purpose:
#   1. app/src/main/python/mira/  -> the brain, run in-process by Chaquopy
#   2. app/src/main/python/web/   -> what that brain serves to the WebView
# and assets/www as the offline fallback if the embedded server cannot start.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_WEB="$HERE/../mira/web"
SRC_PY="$HERE/../mira/mira"
PY_DEST="$HERE/app/src/main/python"
WWW_DEST="$HERE/app/src/main/assets/www"

[ -d "$SRC_WEB" ] || { echo "missing $SRC_WEB"; exit 1; }
[ -d "$SRC_PY" ]  || { echo "missing $SRC_PY";  exit 1; }

# ---- 1. python package -----------------------------------------------------
mkdir -p "$PY_DEST/mira" "$PY_DEST/web"
find "$PY_DEST/mira" -name '*.py' -delete 2>/dev/null || true
cp "$SRC_PY"/*.py "$PY_DEST/mira/"
find "$PY_DEST" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

# Server modules that only make sense on a desktop are not shipped.
rm -f "$PY_DEST/mira/../server.py" 2>/dev/null || true

# ---- 2. the UI the python server serves ------------------------------------
find "$PY_DEST/web" -mindepth 1 -delete 2>/dev/null || true
cp -r "$SRC_WEB/." "$PY_DEST/web/"

# ---- 3. offline fallback copy for the WebView -----------------------------
mkdir -p "$WWW_DEST"
find "$WWW_DEST" -mindepth 1 -delete
cp "$SRC_WEB/index.html" "$SRC_WEB/app.css" "$SRC_WEB/app.js" "$WWW_DEST/"
mkdir -p "$WWW_DEST/assets"
cp "$SRC_WEB"/assets/*.webp "$WWW_DEST/assets/" 2>/dev/null || true

# ---- assertions: a broken sync must fail the build, not the phone ---------
grep -q "MiraNative" "$WWW_DEST/app.js" || {
  echo "ERROR: app.js has no native bridge hook — the APK would have no mic/TTS"; exit 1;
}
grep -q "API_BASE" "$WWW_DEST/app.js" || {
  echo "ERROR: app.js does not honour ?api= — the fallback shell could not reach a server"; exit 1;
}
[ -f "$PY_DEST/mira/android_boot.py" ] || { echo "ERROR: android_boot.py missing"; exit 1; }
[ -f "$PY_DEST/mira/standalone.py" ]  || { echo "ERROR: standalone.py missing";  exit 1; }
[ -f "$PY_DEST/web/index.html" ]      || { echo "ERROR: web/index.html missing";  exit 1; }

echo "synced python -> $PY_DEST/mira ($(ls "$PY_DEST/mira"/*.py | wc -l) modules)"
echo "synced web    -> $PY_DEST/web and $WWW_DEST"
du -sh "$PY_DEST" "$WWW_DEST"
