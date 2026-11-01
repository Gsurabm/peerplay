#!/usr/bin/env bash
# Tertiary public tunnel for PeerPlay (Tunnelmole - free, no account, no
# interstitial page).
#
# Cloudflare quick tunnels are reaped by Cloudflare within minutes from this
# sandbox, so PeerPlay runs several providers in parallel and publishes every
# live address on the landing page (and on /api/config -> public_links).
#
# Usage:  bash scripts/tunnel-tunnelmole.sh

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
OUT="$TOOLS/tunnelmole_urls.txt"
LIVE="$TOOLS/url_tm.txt"
LOG="$TOOLS/tunnelmole.log"
PORT="${PORT:-4000}"
BIN="$TOOLS/node_modules/.bin/tmole"

mkdir -p "$TOOLS"
touch "$OUT"

if [ ! -x "$BIN" ]; then
  echo "→ installing tunnelmole…"
  npm install --prefix "$TOOLS" --silent --no-fund --no-audit tunnelmole >/dev/null 2>&1 || true
fi

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "tunnelmole supervisor up (origin=http://127.0.0.1:$PORT)"

while true; do
  : > "$LOG"
  "$BIN" "$PORT" >> "$LOG" 2>&1 &
  TM_PID=$!

  URL=""
  for _ in $(seq 1 45); do
    URL=$(grep -oE 'https://[a-z0-9.-]+\.tunnelmole\.net' "$LOG" | head -1 || true)
    [ -n "$URL" ] && break
    kill -0 "$TM_PID" 2>/dev/null || break
    sleep 1
  done

  if [ -n "$URL" ]; then
    echo "$URL" > "$OUT"
    log "tunnelmole URL: $URL"
  else
    log "no tunnelmole address yet"
  fi

  while kill -0 "$TM_PID" 2>/dev/null; do
    sleep 20
    # recycle if the address stops answering
    if [ -n "$URL" ]; then
      if curl -fs -m 15 "$URL/api/health" | grep -q '"ok":true'; then
        echo "$URL" > "$LIVE"
      else
        rm -f "$LIVE"
        log "tunnelmole address unhealthy - recycling"
        break
      fi
    fi
  done

  kill "$TM_PID" 2>/dev/null
  wait "$TM_PID" 2>/dev/null
  rm -f "$OUT" "$LIVE"
  log "tunnelmole tunnel stopped - restarting in 5s"
  sleep 5
done
