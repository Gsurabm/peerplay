#!/usr/bin/env bash
# Bring the whole PeerPlay stack up in one command:
#   API server + web build + Tunnelmole + Pinggy + Cloudflare + URL publisher.
#
# Usage:  npm run start:all        (foreground supervisor, Ctrl-C to stop)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ building the web client…"
npm --prefix web run build >/dev/null 2>&1 && echo "   web/dist ready"

echo "→ starting the API server…"
if curl -fs -m 5 -o /dev/null http://127.0.0.1:4000/api/health; then
  echo "   already running"
else
  nohup node server/src/index.js > "$ROOT/.tools/api.log" 2>&1 &
  disown || true
  sleep 4
  curl -fs -m 5 -o /dev/null http://127.0.0.1:4000/api/health && echo "   up on :4000" || echo "   FAILED - check .tools/api.log"
fi

echo "→ starting the public tunnels…"
nohup bash "$ROOT/scripts/tunnel-tunnelmole.sh" > "$ROOT/.tools/tunnelmole.out" 2>&1 & disown || true
nohup bash "$ROOT/scripts/tunnel-pinggy.sh"     > "$ROOT/.tools/pinggy.out"     2>&1 & disown || true
nohup bash "$ROOT/scripts/tunnel-supervisor.sh" > "$ROOT/.tools/cloudflare.out" 2>&1 & disown || true
nohup bash "$ROOT/scripts/publish-best-url.sh"  > "$ROOT/.tools/publisher.out"  2>&1 & disown || true

sleep 25
echo
echo "→ live public address:"
cat "$ROOT/PUBLIC_URL.txt" 2>/dev/null || echo "   (waiting for the first tunnel…)"
echo
echo "   all live addresses:"
for f in "$ROOT"/.tools/url_*.txt; do
  [ -f "$f" ] && echo "   - $(cat "$f")"
done
echo
echo "   keep this terminal open, or run: npm run keepalive"
