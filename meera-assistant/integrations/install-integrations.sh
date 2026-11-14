#!/usr/bin/env bash
# ============================================================
#  M.E.E.R.A. — Integration Installer
# ============================================================
#  Registers and installs the open-source AI engines that
#  Meera can route requests to.
#
#  Usage:
#    ./install-integrations.sh                 # core 4 engines
#    ./install-integrations.sh --all           # + optional engines
#    ./install-integrations.sh --engine leon   # just one
#    ./install-integrations.sh --clone-only    # git only, no pip/npm
#    ./install-integrations.sh --check         # report status, change nothing
#    ./install-integrations.sh --clean         # remove vendor/ checkouts
#
#  Everything lands in integrations/vendor/ and is safe to delete.
# ============================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$HERE/vendor"
MANIFEST="$HERE/manifest.json"
LOG="$HERE/install.log"

C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'
C_DIM=$'\033[2m';   C_CYAN=$'\033[0;36m'; C_OFF=$'\033[0m'

ALL=0; CLONE_ONLY=0; CHECK_ONLY=0; CLEAN=0; PIP_ONLY=0; ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1 ;;
    --clone-only|--no-deps) CLONE_ONLY=1 ;;
    --pip-only) PIP_ONLY=1 ;;
    --check|--status) CHECK_ONLY=1 ;;
    --clean) CLEAN=1 ;;
    --engine) shift; ONLY="${1:-}" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "${C_ERR}unknown flag: $1${C_OFF}"; exit 2 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
head1(){ printf '\n%s══ %s ══%s\n' "$C_CYAN" "$*" "$C_OFF"; }
ok()   { printf '  %s✔%s %s\n' "$C_OK"   "$C_OFF" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
err()  { printf '  %s✘%s %s\n' "$C_ERR"  "$C_OFF" "$*"; }
info() { printf '  %s·%s %s\n' "$C_DIM"  "$C_OFF" "$*"; }

# ---------- engine table (mirrors manifest.json) ----------
# id | repo url | ref | pip package | optional | npm
ENGINES=(
  "open-interpreter|https://github.com/openinterpreter/openinterpreter.git|f09c887041133f52da1155e27d29edd8fa1f516e|open-interpreter|0|0"
  "leon|https://github.com/leon-ai/leon.git|7b5819f8e867|none|0|1"
  "jarvis-hugginggpt|https://github.com/microsoft/JARVIS.git|7624cf388b47|none|0|0"
  "faster-whisper|https://github.com/SYSTRAN/faster-whisper.git|6cb639e70786|faster-whisper|0|0"
  "openwakeword|https://github.com/dscripka/openWakeWord.git|368c03716d1e92591906a84949bc477f3a834455|openwakeword|1|0"
)

have() { command -v "$1" >/dev/null 2>&1; }

py_has() { python3 -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('$1') else 1)" 2>/dev/null; }

py_install() {
  local pkg="$1"
  if have pip3; then
    pip3 install --quiet --upgrade "$pkg" 2>>"$LOG" && return 0
    # PEP 668 environments (Debian/Ubuntu, this sandbox)
    pip3 install --quiet --upgrade --break-system-packages "$pkg" 2>>"$LOG" && return 0
  fi
  if have python3; then
    python3 -m pip install --quiet --upgrade "$pkg" 2>>"$LOG" && return 0
    python3 -m pip install --quiet --upgrade --break-system-packages "$pkg" 2>>"$LOG" && return 0
  fi
  return 1
}

vendor_dir_for() {
  case "$1" in
    open-interpreter) echo "$VENDOR/openinterpreter" ;;
    leon)             echo "$VENDOR/leon" ;;
    jarvis-hugginggpt) echo "$VENDOR/JARVIS" ;;
    faster-whisper)   echo "$VENDOR/faster-whisper" ;;
    openwakeword)     echo "$VENDOR/openWakeWord" ;;
    *) echo "$VENDOR/$1" ;;
  esac
}

check_engine() {
  local id="$1"
  local src=""
  case "$id" in
    open-interpreter) py_has interpreter && src="python-package" ; local vd="$VENDOR/openinterpreter" ;;
    jarvis-hugginggpt) local vd="$VENDOR/JARVIS" ;;
    faster-whisper) py_has faster_whisper && src="python-package"; local vd="$VENDOR/faster-whisper" ;;
    openwakeword) py_has openwakeword && src="python-package"; local vd="$VENDOR/openWakeWord" ;;
    leon) local vd="$VENDOR/leon" ;;
    *) local vd="$VENDOR/$id" ;;
  esac
  if [ -z "$src" ] && [ -n "${vd:-}" ] && [ -d "$vd" ] && [ -n "$(ls -A "$vd" 2>/dev/null)" ]; then
    src="vendor-checkout"
  fi
  printf '%s' "${src:-offline}"
}

# ============================================================
head1 "M.E.E.R.A. integration installer"
info "manifest : $MANIFEST"
info "vendor   : $VENDOR"
info "log      : $LOG"
say ""

if [ "$CLEAN" = "1" ]; then
  head1 "Cleaning vendor checkouts"
  if [ -d "$VENDOR" ]; then
    du -sh "$VENDOR" 2>/dev/null | awk '{print "  removing "$1}'
    rm -rf "$VENDOR"
    ok "vendor/ removed — pip packages were left untouched"
  else
    warn "nothing to clean"
  fi
  exit 0
fi

if [ "$CHECK_ONLY" = "1" ]; then
  head1 "Engine status"
  printf '  %-22s %-14s %s\n' "ENGINE" "STATUS" "SOURCE"
  printf '  %s\n' "----------------------------------------------------------"
  for row in "${ENGINES[@]}"; do
    IFS='|' read -r id url ref pip_pkg optional npm <<< "$row"
    st="$(check_engine "$id")"
    case "$st" in
      offline)          colour="$C_DIM" ;;
      *)                colour="$C_OK" ;;
    esac
    printf "  %-22s ${colour}%-14s${C_OFF} %s\n" "$id" "$st" "$url" | sed 's#https://github.com/##'
  done
  say ""
  exit 0
fi

have git || { err "git is required"; exit 1; }
mkdir -p "$VENDOR"
: > "$LOG"

INSTALLED=0; SKIPPED=0; FAILED=0

for row in "${ENGINES[@]}"; do
  IFS='|' read -r id url ref pip_pkg optional npm <<< "$row"

  if [ "$ALL" = "0" ] && [ "$optional" = "1" ]; then
    info "skip $id (optional — use --all)"
    SKIPPED=$((SKIPPED+1)); continue
  fi
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then continue; fi

  head1 "$id"
  vd="$(vendor_dir_for "$id")"
  repo_name="$(basename "$vd")"

  # ---------- 1. source checkout ----------
  if [ "$PIP_ONLY" = "1" ]; then
    info "--pip-only: skipping source checkout"
  elif [ -d "$vd/.git" ] || { [ -d "$vd" ] && [ -n "$(ls -A "$vd" 2>/dev/null)" ]; }; then
    ok "source already present at vendor/$repo_name"
  else
    info "git clone --depth 1 $url"
    if git clone --depth 1 --single-branch "$url" "$vd" 2>>"$LOG"; then
      if [ -n "$ref" ] && [ ${#ref} -ge 7 ]; then
        ( cd "$vd" \
          && git fetch --depth 1 origin "$ref" 2>>"$LOG" >/dev/null 2>&1 \
          && git checkout -q "$ref" 2>>"$LOG" ) \
          && ok "pinned to ${ref:0:12}" \
          || warn "could not pin ${ref:0:12}; tracking default branch"
      fi
      # drop git history to keep the folder small
      rm -rf "$vd/.git"
      sz=$(du -sm "$vd" 2>/dev/null | cut -f1)
      ok "checked out (${sz} MB)"
    else
      err "clone failed — see $LOG"
      FAILED=$((FAILED+1)); continue
    fi
  fi

  # ---------- 2. dependencies ----------
  if [ "$CLONE_ONLY" = "1" ]; then
    info "--clone-only: skipping dependencies"
    INSTALLED=$((INSTALLED+1)); continue
  fi

  case "$id" in
    open-interpreter)
      if py_has interpreter; then
        ok "python package 'interpreter' already importable"
      else
        info "pip install open-interpreter"
        if py_install open-interpreter && py_has interpreter; then
          ok "pip package installed"
        else
          warn "pip install incomplete (needs an LLM provider at runtime)"
        fi
      fi
      ;;
    faster-whisper)
      if py_has faster_whisper; then
        ok "python package 'faster_whisper' already importable"
      else
        info "pip install faster-whisper"
        if py_install faster-whisper && py_has faster_whisper; then
          ok "pip package installed — models download on first use"
        else
          warn "pip install failed — see $LOG"
        fi
      fi
      ;;
    openwakeword)
      if py_has openwakeword; then
        ok "python package 'openwakeword' already importable"
      else
        info "pip install openwakeword"
        py_install openwakeword && ok "pip package installed" || warn "pip install failed"
      fi
      ;;
    leon)
      if have npm; then
        if [ -d "$vd/node_modules" ]; then
          ok "npm dependencies already installed"
        else
          info "npm install (this is the slow one)"
          ( cd "$vd" && npm install --no-audit --no-fund >>"$LOG" 2>&1 ) \
            && ok "npm dependencies installed" \
            || warn "npm install failed — see $LOG"
        fi
      else
        warn "npm not found — skipping Leon's Node dependencies"
      fi
      ;;
    jarvis-hugginggpt)
      if [ -f "$vd/requirements.txt" ] && have pip3; then
        info "pip install -r $repo_name/requirements.txt"
        ( pip3 install -q -r "$vd/requirements.txt" --break-system-packages 2>>"$LOG" \
          || pip3 install -q -r "$vd/requirements.txt" 2>>"$LOG" ) \
          && ok "python requirements installed" \
          || warn "requirements install had problems — see $LOG"
      else
        warn "requirements.txt not found — clone only"
      fi
      ;;
  esac

  INSTALLED=$((INSTALLED+1))
done

# ============================================================
head1 "Summary"
printf '  installed/updated : %s\n' "$INSTALLED"
printf '  skipped           : %s\n' "$SKIPPED"
printf '  failed            : %s\n' "$FAILED"
say ""
info "verify with:  ./install-integrations.sh --check"
info "then start:    python3 ../server.py"
say ""

head1 "Engine status"
printf '  %-22s %s\n' "ENGINE" "STATUS"
printf '  %s\n' "----------------------------------------"
for row in "${ENGINES[@]}"; do
  IFS='|' read -r id url ref pip_pkg optional npm <<< "$row"
  st="$(check_engine "$id")"
  if [ "$st" = "offline" ]; then
    printf "  %-22s ${C_DIM}%s${C_OFF}\n" "$id" "$st"
  else
    printf "  %-22s ${C_OK}%s${C_OFF}\n" "$id" "$st"
  fi
done
say ""
ok "done. Meera will pick these up on the next scan."
