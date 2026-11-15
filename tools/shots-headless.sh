#!/bin/zsh
# Скриншоты телефона без Playwright — обычным Chrome в headless-режиме, поверх локального просмотра (node tools/preview.mjs).
#   tools/shots-headless.sh <папка> [skin=classic|compact] [theme=dark|light]
# Кладёт по файлу на вкладку: home / history / ask / about, 500×1500 CSS-px в 2× (Chrome headless не даёт окно уже ~500px).
OUT=${1:-shots}; SKIN=${2:-classic}; THEME=${3:-dark}; mkdir -p "$OUT"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for view in home history ask about; do
  F="$OUT/$SKIN-$THEME-$view.png"; rm -f "$F"; P=$(mktemp -d /tmp/lun-shot.XXXX)
  "$CH" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$P" --window-size=500,1500 --force-device-scale-factor=2 \
    --virtual-time-budget=10000 --screenshot="$F" "http://localhost:5038/app/?skin=$SKIN&theme=$THEME&view=$view" >/dev/null 2>&1 &
  PID=$!; for i in $(seq 1 40); do [ -s "$F" ] && break; sleep 0.5; done; sleep 1; kill $PID 2>/dev/null; wait $PID 2>/dev/null; rm -rf "$P"
  [ -s "$F" ] && echo "$F" || echo "не снялось: $F"
done
