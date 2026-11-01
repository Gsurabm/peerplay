#!/usr/bin/env bash
# PeerPlay keep-alive watchdog.
#
# The sandbox can be suspended/restarted between sessions. This watchdog makes
# sure that whenever you come back, the app and its public tunnels are already
# running and serving a fresh public address.
#
# It checks every 30 seconds:
#   * the API server on port 4000          -> restarts it if it is down
#   * the Tunnelmole tunnel supervisor      -> restarts it if it is gone
#   * the Pinggy tunnel supervisor          -> restarts it if it is gone
#   * the Cloudflare tunnel supervisor      -> restarts it if it is gone
#   * the best-URL publisher                -> restarts it if it is gone
#
# Usage:  npm run keepalive      (foreground, safe to leave running)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.tools/keepalive.log"
API_LOG="$ROOT/.tools/api.log"
PORT="${PORT:-4000}"

mkdir -p "$ROOT/.tools"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

running() { pgrep -f "$1" >/dev/null 2>&1; }

start_bg() {
  local name="$1"; shift
  log "starting $name"
  nohup "$@" >> "$ROOT/.tools/${name}.log" 2>&1 &
  disown || true
}

log "keepalive watchdog up (root=$ROOT)"

while true; do
  # 1. API server
  if ! curl -fs -m 8 -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
    log "API server not answering - restarting"
    cd "$ROOT/server" || exit 1
    nohup node src/index.js >> "$API_LOG" 2>&1 &
    disown || true
    sleep 6
  fi

  # 2. tunnel supervisors
  running "tunnel-tunnelmole.sh"  || start_bg tunnelmole bash "$ROOT/scripts/tunnel-tunnelmole.sh"
  running "tunnel-pinggy.sh"      || start_bg pinggy     bash "$ROOT/scripts/tunnel-pinggy.sh"
  running "tunnel-supervisor.sh"  || start_bg cloudflare bash "$ROOT/scripts/tunnel-supervisor.sh"
  running "publish-best-url.sh"   || start_bg publisher  bash "$ROOT/scripts/publish-best-url.sh"

  sleep 30
done
