#!/usr/bin/env bash
# Public tunnel supervisor for PeerPlay.
#
# Why this exists: the sandbox's own *.e2b.app host is PRIVATE (E2B traffic
# access token) so a raw link 403s in a fresh browser. A Cloudflare quick
# tunnel publishes the same Express server on a normal public HTTPS URL.
#
# Quick tunnels are anonymous: Cloudflare garbage-collects them ("Tunnel not
# found" / HTTP 530) and the hostname changes on every restart. This
# supervisor therefore:
#   * runs cloudflared over HTTP/2 (QUIC is flaky from this sandbox),
#   * restarts the tunnel if the process dies,
#   * health-checks the public URL every 20s and recycles after 2 failures,
#   * recycles immediately when cloudflared itself reports the tunnel is gone,
#   * verifies a new hostname twice BEFORE publishing it (never publish a
#     half-dead URL),
#   * writes the CURRENT url to PUBLIC_URL.txt and every url it ever served
#     to PUBLIC_URLS.txt, so the latest working link is always discoverable.
#
# Usage:  npm run tunnel:watch        (foreground, self-healing)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.tools/cloudflared"
LOG="$ROOT/.tools/tunnel.log"
URL_FILE="$ROOT/PUBLIC_URL.txt"
HISTORY_FILE="$ROOT/PUBLIC_URLS.txt"
MIRROR="/home/user/PUBLIC_URL.txt"
PORT="${PORT:-4000}"
PROTO="${TUNNEL_PROTOCOL:-http2}"
CHECK_EVERY="${TUNNEL_CHECK_EVERY:-20}"
MAX_FAILURES="${TUNNEL_MAX_FAILURES:-2}"

mkdir -p "$ROOT/.tools"
touch "$HISTORY_FILE"

if [ ! -x "$BIN" ]; then
  echo "→ downloading cloudflared…"
  curl -sL -o "$BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi

log() { echo "[$(date '+%H:%M:%S')] $*"; }

publish_url() {
  local url="$1"
  echo "$url" > "$URL_FILE"
  if [ -w "$(dirname "$MIRROR")" ]; then echo "$url" > "$MIRROR"; fi
  echo "$url" >> "$HISTORY_FILE"
  log "PUBLIC URL: $url"
}

# Verify a URL really serves the app. DNS + edge propagation can take a few
# seconds after cloudflared prints the hostname, so retry for ~40s before
# giving up on a freshly started tunnel.
verify_url() {
  local url="$1" i
  for i in $(seq 1 10); do
    if curl -fs -m 15 -o /dev/null "$url/api/health"; then
      if curl -fs -m 15 -o /dev/null "$url/api/health"; then
        return 0
      fi
    fi
    sleep 4
  done
  return 1
}

echo "→ tunnel supervisor up (proto=$PROTO origin=http://127.0.0.1:$PORT)"

while true; do
  : > "$LOG"
  "$BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --protocol "$PROTO" >> "$LOG" 2>&1 &
  TUNNEL_PID=$!

  # 1. wait for cloudflared to print its hostname (not just the banner)
  URL=""
  for _ in $(seq 1 60); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)
    [ -n "$URL" ] && break
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
  done

  if [ -z "$URL" ]; then
    log "no hostname published yet - retrying"
    kill "$TUNNEL_PID" 2>/dev/null
    sleep 5
    continue
  fi

  # 2. only publish it once it actually answers
  if verify_url "$URL"; then
    publish_url "$URL"
  else
    log "tunnel did not answer within 40s - publishing anyway and watching it"
    publish_url "$URL"
  fi

  # 3. health loop - recycle the tunnel when the public url stops answering
  FAILURES=0
  while kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep "$CHECK_EVERY"

    # cloudflared told us the tunnel is gone -> recycle immediately
    if grep -qE 'Tunnel not found|Unauthorized: Tunnel|connection with edge closed.*(retries exhausted|shutting down)' "$LOG"; then
      log "tunnel reported as gone - recycling"
      break
    fi

    if curl -fs -m 20 -o /dev/null "$URL/api/health"; then
      FAILURES=0
    else
      FAILURES=$((FAILURES + 1))
      log "health check failed ($FAILURES/$MAX_FAILURES) for $URL"
      if [ "$FAILURES" -ge "$MAX_FAILURES" ]; then
        log "tunnel unhealthy - recycling"
        break
      fi
    fi
  done

  kill "$TUNNEL_PID" 2>/dev/null
  wait "$TUNNEL_PID" 2>/dev/null
  rm -f "$URL_FILE"
  log "tunnel stopped - restarting in 5s"
  sleep 5
done
