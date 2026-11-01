#!/usr/bin/env bash
# Probe every published public URL and report the success rate.
# Usage: bash scripts/probe-links.sh [rounds] [sleep_seconds]
ROUNDS="${1:-18}"
SLEEP="${2:-10}"
URLS=()
for f in /home/user/peerplay/PUBLIC_URL.txt /home/user/peerplay/.tools/pinggy_urls.txt; do
  [ -f "$f" ] || continue
  while read -r u; do
    [ -n "$u" ] && URLS+=("$u")
  done < <(sort -u "$f")
done
[ ${#URLS[@]} -eq 0 ] && { echo "no URLs to probe"; exit 1; }

declare -A ok fail
for u in "${URLS[@]}"; do ok[$u]=0; fail[$u]=0; done

for i in $(seq 1 "$ROUNDS"); do
  for u in "${URLS[@]}"; do
    if curl -fs -m 12 -o /dev/null "$u/api/health"; then
      ok[$u]=$(( ${ok[$u]} + 1 ))
    else
      fail[$u]=$(( ${fail[$u]} + 1 ))
    fi
  done
  sleep "$SLEEP"
done

echo
for u in "${URLS[@]}"; do
  total=$(( ${ok[$u]} + ${fail[$u]} ))
  pct=$(( ${ok[$u]} * 100 / total ))
  echo "$u -> ${ok[$u]}/${total} ok (${pct}%)"
done
