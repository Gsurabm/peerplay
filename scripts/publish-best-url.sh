#!/usr/bin/env bash
# Publish the best currently-healthy public address to PUBLIC_URL.txt and the
# workspace mirror, so there is always ONE link to share.
#
# Preference order: Tunnelmole (no interstitial) > Cloudflare > Pinggy.
# Usage: bash scripts/publish-best-url.sh   (runs forever)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="/home/user/PUBLIC_URL.txt"
OUT="$ROOT/PUBLIC_URL.txt"

while true; do
  for f in "$ROOT/.tools/url_tm.txt" "$ROOT/.tools/url_cf.txt" "$ROOT/.tools/url_pg.txt"; do
    [ -f "$f" ] || continue
    u=$(head -1 "$f" 2>/dev/null | tr -d '\r')
    [ -n "$u" ] || continue
    if curl -fs -m 12 "$u/api/health" | grep -q '"ok":true'; then
      if [ "$(cat "$OUT" 2>/dev/null)" != "$u" ]; then
        echo "$u" > "$OUT"
        [ -w "$(dirname "$MIRROR")" ] && echo "$u" > "$MIRROR"
        echo "[$(date '+%H:%M:%S')] published: $u"
      fi
      break
    fi
  done
  sleep 20
done
