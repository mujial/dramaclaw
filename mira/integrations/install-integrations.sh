#!/usr/bin/env bash
# ============================================================
#  MIRA — integration installer
# ============================================================
#  Installs the open-source engines MIRA can route to.
#  Everything lands in integrations/vendor/ (safe to delete).
#
#  Usage:
#    ./install-integrations.sh              # all core engines (pip only, fast)
#    ./install-integrations.sh --source     # also clone the git repos
#    ./install-integrations.sh --engine edge-tts
#    ./install-integrations.sh --check      # report only, change nothing
#    ./install-integrations.sh --clean      # remove vendor/ checkouts
#    ./install-integrations.sh --list       # engine table
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$HERE/vendor"
LOG="$HERE/install.log"
MANIFEST="$HERE/manifest.json"

C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'
C_DIM=$'\033[2m';  C_CYAN=$'\033[0;36m'; C_OFF=$'\033[0m'

CHECK=0; SOURCE=0; CLEAN=0; LIST=0; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--status) CHECK=1 ;;
    --source|--clone) SOURCE=1 ;;
    --clean) CLEAN=1 ;;
    --list) LIST=1 ;;
    --engine) shift; ONLY="${1:-}" ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "${C_ERR}unknown flag: $1${C_OFF}"; exit 2 ;;
  esac
  shift
done

head1(){ printf '\n%s══ %s ══%s\n' "$C_CYAN" "$*" "$C_OFF"; }
ok()   { printf '  %s✔%s %s\n' "$C_OK"   "$C_OFF" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
err()  { printf '  %s✘%s %s\n' "$C_ERR"  "$C_OFF" "$*"; }
info() { printf '  %s·%s %s\n' "$C_DIM"  "$C_OFF" "$*"; }

have(){ command -v "$1" >/dev/null 2>&1; }
py_has(){ python3 -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('$1') else 1)" 2>/dev/null; }

py_install(){
  local pkg="$1"
  pip3 install -q --upgrade "$pkg" 2>>"$LOG" && return 0
  pip3 install -q --upgrade --break-system-packages "$pkg" 2>>"$LOG" && return 0
  python3 -m pip install -q --upgrade "$pkg" 2>>"$LOG" && return 0
  python3 -m pip install -q --upgrade --break-system-packages "$pkg" 2>>"$LOG" && return 0
  return 1
}

# id | repo url | ref | pip package | module | vendor dir | needs key
ENGINES=(
  "edge-tts|https://github.com/rany2/edge-tts.git|bd44c1d1aaebdc1d|edge-tts|edge_tts|vendor/edge-tts|0"
  "faster-whisper|https://github.com/SYSTRAN/faster-whisper.git|6cb639e70786|faster-whisper|faster_whisper|vendor/faster-whisper|0"
  "openwakeword|https://github.com/dscripka/openWakeWord.git|368c03716d1e92591906a84949bc477f3a834455|openwakeword|openwakeword|vendor/openWakeWord|0"
  "mem0|https://github.com/mem0ai/mem0.git|f1791daa86d46924|mem0ai|mem0|vendor/mem0|1"
  "open-interpreter|https://github.com/openinterpreter/openinterpreter.git|f09c887041133f52da1155e27d29edd8fa1f516e|open-interpreter|interpreter|vendor/openinterpreter|1"
)

status_of(){
  local module="$1" vdir="$2"
  if py_has "$module"; then echo "python-package"; return; fi
  if [ -d "$HERE/$vdir" ] && [ -n "$(ls -A "$HERE/$vdir" 2>/dev/null)" ]; then echo "vendor"; return; fi
  echo "offline"
}

print_table(){
  printf '  %-18s %-16s %-28s %s\n' "ENGINE" "STATUS" "REPO" "KIND"
  printf '  %s\n' "------------------------------------------------------------------------------"
  for row in "${ENGINES[@]}"; do
    IFS='|' read -r id url ref pip_pkg module vdir needs <<< "$row"
    st="$(status_of "$module" "$vdir")"
    repo="${url#https://github.com/}"; repo="${repo%.git}"
    if [ "$st" = "offline" ]; then colour="$C_DIM"; else colour="$C_OK"; fi
    printf "  %-18s ${colour}%-16s${C_OFF} %-28s %s\n" "$id" "$st" "$repo" ""
  done
}

head1 "MIRA integrations"
info "manifest : $MANIFEST"
info "vendor   : $VENDOR"
info "log      : $LOG"
echo ""

if [ "$LIST" = "1" ] || [ "$CHECK" = "1" ]; then
  head1 "Engine status"
  print_table
  echo ""
  [ "$CHECK" = "1" ] && info "nothing was changed (--check)"
  exit 0
fi

if [ "$CLEAN" = "1" ]; then
  head1 "Cleaning"
  if [ -d "$VENDOR" ]; then
    du -sh "$VENDOR" 2>/dev/null | awk '{print "  removing "$1}'
    rm -rf "$VENDOR"
    ok "vendor/ removed — installed pip packages were left alone"
  else
    warn "nothing to clean"
  fi
  exit 0
fi

have python3 || { err "python3 is required"; exit 1; }
mkdir -p "$VENDOR"
: > "$LOG"

DONE=0; FAILED=0; SKIPPED=0

for row in "${ENGINES[@]}"; do
  IFS='|' read -r id url ref pip_pkg module vdir needs <<< "$row"
  [ -n "$ONLY" ] && [ "$id" != "$ONLY" ] && continue

  head1 "$id"

  # --- pip ---------------------------------------------------------------
  if py_has "$module"; then
    ok "python package '$module' already importable"
  else
    info "pip install $pip_pkg"
    if py_install "$pip_pkg" && py_has "$module"; then
      ok "installed"
    else
      warn "pip install incomplete — see $LOG"
      FAILED=$((FAILED+1))
    fi
  fi

  # --- optional source checkout -----------------------------------------
  if [ "$SOURCE" = "1" ]; then
    if [ -d "$HERE/$vdir" ] && [ -n "$(ls -A "$HERE/$vdir" 2>/dev/null)" ]; then
      ok "source already at $vdir"
    else
      info "git clone --depth 1 $url"
      if git clone --depth 1 --single-branch "$url" "$HERE/$vdir" 2>>"$LOG"; then
        rm -rf "$HERE/$vdir/.git"
        sz=$(du -sm "$HERE/$vdir" 2>/dev/null | cut -f1)
        ok "cloned (${sz} MB)"
        [ -n "$ref" ] && info "manifest pins $ref (shallow clone tracks the default branch)"
      else
        warn "clone failed — see $LOG"
        FAILED=$((FAILED+1))
      fi
    fi
  fi

  if [ "$needs" = "1" ]; then
    info "needs an API key / model to actually answer"
    SKIPPED=$((SKIPPED+1))
  fi
  DONE=$((DONE+1))
done

head1 "Summary"
printf '  processed : %s\n' "$DONE"
printf '  failed    : %s\n' "$FAILED"
printf '  key-gated : %s\n' "$SKIPPED"
echo ""
head1 "Engine status"
print_table
echo ""
ok "done — restart server.py and MIRA picks these up automatically."
