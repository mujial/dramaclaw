#!/usr/bin/env bash
# Copy MIRA's web UI into the Android asset tree.
#
# The APK ships the interface (HTML/CSS/JS/avatar frames) so it launches
# instantly and works offline for the shell. The brain (Python server) is
# reached over HTTP/WS — see Settings → "MIRA server".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../mira/web"
DEST="$HERE/app/src/main/assets/www"

[ -d "$SRC" ] || { echo "missing $SRC"; exit 1; }
mkdir -p "$DEST"

# wipe stale files but keep the directory
find "$DEST" -mindepth 1 -delete

cp "$SRC/index.html" "$DEST/index.html"
cp "$SRC/app.css"    "$DEST/app.css"
cp "$SRC/app.js"     "$DEST/app.js"
mkdir -p "$DEST/assets"
cp "$SRC"/assets/*.webp "$DEST/assets/" 2>/dev/null || true

# The shell must not hit a build-time URL: app.js reads ?api=<server> from the
# location, so nothing to rewrite here — but assert the hook exists.
grep -q "MiraNative" "$DEST/app.js" || {
  echo "ERROR: app.js has no native bridge hook — the APK would have no mic/TTS"; exit 1;
}
grep -q "API_BASE" "$DEST/app.js" || {
  echo "ERROR: app.js does not honour ?api= — the APK could not reach the server"; exit 1;
}

echo "synced -> $DEST"
ls -la "$DEST" "$DEST/assets"
