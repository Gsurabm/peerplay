#!/usr/bin/env bash
# Secondary public tunnel for PeerPlay (Pinggy, no account required).
#
# Cloudflare quick tunnels get garbage-collected quickly, so PeerPlay runs a
# second provider in parallel. This script keeps a Pinggy tunnel alive and
# writes every address it is serving to .tools/pinggy_urls.txt, which the API
# exposes on /api/config (public_links) and the landing page renders with a
# copy button.
#
# Usage:  bash scripts/tunnel-pinggy.sh

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.tools/pinggy_urls.txt"
LIVE="$ROOT/.tools/url_pg.txt"
LOG="$ROOT/.tools/pinggy.log"
PORT="${PORT:-4000}"

mkdir -p "$ROOT/.tools"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "pinggy tunnel supervisor up (origin=http://127.0.0.1:$PORT)"

while true; do
  : > "$LOG"
  ssh -p 443 \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ServerAliveInterval=25 \
      -o ServerAliveCountMax=8 \
      -o ExitOnForwardFailure=yes \
      -o StrictHostKeyChecking=no \
      -R0:127.0.0.1:"$PORT" \
      a.pinggy.io >> "$LOG" 2>&1 &
  SSH_PID=$!

  # wait for the addresses to be printed
  for _ in $(seq 1 30); do
    URLS=$(grep -oE 'https://[a-z0-9.-]+\.(free\.pinggy\.net|run\.pinggy-free\.link)' "$LOG" | sort -u || true)
    [ -n "$URLS" ] && break
    kill -0 "$SSH_PID" 2>/dev/null || break
    sleep 1
  done

  if [ -n "${URLS:-}" ]; then
    echo "$URLS" > "$OUT"
    log "pinggy URLs:"; echo "$URLS" | sed 's/^/   /'
  else
    log "no pinggy address yet - will retry"
  fi

  # keep the tunnel alive until ssh dies, then republish
  while kill -0 "$SSH_PID" 2>/dev/null; do
    sleep 20
    if [ -n "${URLS:-}" ]; then
      FIRST=$(echo "$URLS" | head -1)
      if curl -fs -m 15 "$FIRST/api/health" | grep -q '"ok":true'; then
        echo "$FIRST" > "$LIVE"
      else
        rm -f "$LIVE"
      fi
    fi
  done

  wait "$SSH_PID" 2>/dev/null
  log "pinggy tunnel exited - restarting in 10s"
  rm -f "$OUT" "$LIVE"
  sleep 10
done
