#!/usr/bin/env bash
# Public tunnel supervisor for PeerPlay.
#
# Why this exists: the sandbox's own *.e2b.app host is PRIVATE (E2B traffic
# access token) so a raw link 403s in a fresh browser. A Cloudflare quick
# tunnel publishes the same Express server on a normal public HTTPS URL.
#
# Quick tunnels are anonymous and get cleaned up by Cloudflare ("Tunnel not
# found"), and the hostname changes on every restart. This supervisor:
#   * runs cloudflared over HTTP/2 (QUIC is flaky from this sandbox),
#   * restarts the tunnel if the process dies,
#   * health-checks the public URL and restarts the tunnel if it stops
#     answering,
#   * always writes the CURRENT url to PUBLIC_URL.txt.
#
# Usage:  npm run tunnel:watch        (foreground, self-healing)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.tools/cloudflared"
LOG="$ROOT/.tools/tunnel.log"
URL_FILE="$ROOT/PUBLIC_URL.txt"
MIRROR="/home/user/PUBLIC_URL.txt"
PORT="${PORT:-4000}"
PROTO="${TUNNEL_PROTOCOL:-http2}"

mkdir -p "$ROOT/.tools"

if [ ! -x "$BIN" ]; then
  echo "→ downloading cloudflared…"
  curl -sL -o "$BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi

publish_url() {
  local url=""
  # wait until the tunnel actually prints its hostname (not just the banner)
  for _ in $(seq 1 40); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)
    [ -n "$url" ] && break
    sleep 1
  done
  if [ -n "$url" ]; then
    echo "$url" > "$URL_FILE"
    if [ -w "$(dirname "$MIRROR")" ]; then echo "$url" > "$MIRROR"; fi
    echo "[$(date '+%H:%M:%S')] PUBLIC URL: $url"
  else
    echo "[$(date '+%H:%M:%S')] could not read the tunnel url from the log"
  fi
}

echo "→ tunnel supervisor up (proto=$PROTO origin=http://127.0.0.1:$PORT)"

while true; do
  : > "$LOG"
  "$BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --protocol "$PROTO" >> "$LOG" 2>&1 &
  TUNNEL_PID=$!

  # 1. wait for the tunnel to register and publish its hostname
  for _ in $(seq 1 45); do
    grep -qE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" && break
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
  done
  publish_url

  # 2. health loop - restart the tunnel if the public url stops answering
  FAILURES=0
  while kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep 45
    URL=$(cat "$URL_FILE" 2>/dev/null || true)
    if [ -z "$URL" ]; then
      FAILURES=$((FAILURES + 1))
    elif curl -fs -m 20 -o /dev/null "$URL/api/health"; then
      FAILURES=0
    else
      FAILURES=$((FAILURES + 1))
      echo "[$(date '+%H:%M:%S')] health check failed ($FAILURES) for $URL"
    fi
    if [ "$FAILURES" -ge 3 ]; then
      echo "[$(date '+%H:%M:%S')] tunnel unhealthy - recycling"
      kill "$TUNNEL_PID" 2>/dev/null
      break
    fi
  done

  wait "$TUNNEL_PID" 2>/dev/null
  echo "[$(date '+%H:%M:%S')] tunnel exited - restarting in 5s"
  rm -f "$URL_FILE"
  sleep 5
done
