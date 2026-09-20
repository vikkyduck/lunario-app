#!/usr/bin/env bash
# Безопасная выкатка из нескольких рабочих копий (аудит v98, F22): сравнивается не один index.html, а идентификатор выпуска
# и манифест хешей ВСЕХ выложенных файлов site/ и backend/ — правка одного app.js или серверного модуля на проде остановит rsync.
#   bash deploy-safe.sh snapshot            — снять снимок прода (RELEASE + манифест) в .deploy-snapshot ДО своих правок
#   bash deploy-safe.sh [файл-снимка]        — сверить прод со снимком (по умолчанию .deploy-snapshot) и, если совпал, выпустить
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
cd "$(dirname "$0")"
remote_state() {
  ssh "$SERVER" "cd /opt/lunario-app && (cat RELEASE 2>/dev/null || echo unknown) && find site backend -type f ! -name cities.db ! -name '*.db-wal' ! -name '*.db-shm' -print0 | sort -z | xargs -0 sha256sum"
}
if [ "${1:-}" = "snapshot" ]; then remote_state > .deploy-snapshot; echo "✅ снимок прода снят: .deploy-snapshot ($(head -1 .deploy-snapshot), $(($(wc -l < .deploy-snapshot) - 1)) файлов)"; exit 0; fi
SNAP="${1:-.deploy-snapshot}"
[ -s "$SNAP" ] || { echo "❌ нет снимка $SNAP — сначала: bash deploy-safe.sh snapshot"; exit 1; }
TMP=$(mktemp); remote_state > "$TMP"
if ! cmp -s "$TMP" "$SNAP"; then
  echo "❌ Прод изменился с момента снимка (выпуск $(head -1 "$SNAP") → $(head -1 "$TMP")) — на сервере есть правки, которых нет локально:"
  diff <(tail -n +2 "$SNAP" | awk '{print $2}') <(tail -n +2 "$TMP" | awk '{print $2}') | grep '^[<>]' | head -20 || true
  diff <(tail -n +2 "$SNAP") <(tail -n +2 "$TMP") | grep '^>' | awk '{print "  изменен: " $3}' | head -40 || true
  rm -f "$TMP"; exit 1
fi
rm -f "$TMP"
echo "✅ Прод совпадает со снимком ($(head -1 "$SNAP")) — чужой работы не затрем."
EXPECT_RELEASE="$(head -1 "$SNAP")" bash deploy.sh   # deploy.sh сверит идентификатор еще раз под замком, прямо перед заменой файлов (R14)
