#!/usr/bin/env bash
# Безопасная выкатка: сначала убеждаемся, что прод не изменился с момента,
# когда мы сняли с него копию (иначе rsync --delete затрёт чужую работу).
set -euo pipefail
SERVER="root@5.129.198.180"
SNAP="$1"   # копия прод-файла, снятая ДО правок

TMP=$(mktemp)
scp -q "$SERVER:/opt/lunario-app/site/index.html" "$TMP"
if ! cmp -s "$TMP" "$SNAP"; then
  echo "❌ Прод изменился с момента снимка — на сервере есть правки, которых нет локально."
  diff "$SNAP" "$TMP" | head -40
  rm -f "$TMP"; exit 1
fi
rm -f "$TMP"
echo "✅ Прод совпадает со снимком — чужой работы не затрём."
cd "$(dirname "$0")"
bash deploy.sh
