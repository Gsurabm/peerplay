#!/usr/bin/env bash
# Expose the PeerPlay dev server on a public HTTPS URL (no token required),
# so it can be opened in any browser, on any machine, in two tabs or two
# different browsers at the same time.
#
# The sandbox's own *.e2b.app preview host is PRIVATE (E2B traffic access
# token), which is why a raw link 403s in a fresh browser. This tunnel
# publishes the same Express server on a trycloudflare.com hostname instead.
#
# Usage:  npm run tunnel          (keeps running in the foreground)
#         npm run tunnel -- --bg  (background, writes the URL to PUBLIC_URL.txt)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.tools/cloudflared"
URL_FILE="$ROOT/PUBLIC_URL.txt"
PORT="${PORT:-4000}"

mkdir -p "$ROOT/.tools"

if [ ! -x "$BIN" ]; then
  echo "→ downloading cloudflared…"
  curl -sL -o "$BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi

echo "→ serving http://127.0.0.1:$PORT through a public tunnel"

if [ "${1:-}" = "--bg" ]; then
  nohup "$BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --edge-ip-version 4 \
    > "$ROOT/.tools/tunnel.log" 2>&1 &
  echo $! > "$ROOT/.tools/tunnel.pid"
  for _ in $(seq 1 30); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$ROOT/.tools/tunnel.log" | head -1 || true)
    [ -n "$URL" ] && { echo "$URL" > "$URL_FILE"; echo "→ PUBLIC URL: $URL"; exit 0; }
    sleep 1
  done
  echo "→ tunnel did not report a URL, check $ROOT/.tools/tunnel.log" >&2
  exit 1
fi

"$BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --edge-ip-version 4
