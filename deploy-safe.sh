#!/usr/bin/env bash
# Безопасная выкатка из нескольких рабочих копий (аудит v98 F22, ревью v114 F11): сравнивается идентификатор выпуска и манифест
# хешей ВСЕХ живых файлов site/ и backend/ текущего выпуска — правка одного app.js или серверного модуля на проде остановит выпуск.
# Снимок сверяется дважды: здесь и в deploy.sh под замком, прямо перед выкладкой (EXPECT_RELEASE + EXPECT_MANIFEST).
#   bash deploy-safe.sh snapshot            — снять снимок прода (RELEASE + манифест) в .deploy-snapshot ДО своих правок
#   bash deploy-safe.sh [файл-снимка]        — сверить прод со снимком (по умолчанию .deploy-snapshot) и, если совпал, выпустить
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"; cd "$REPO"
# shellcheck source=deploy-lib.sh
. "$REPO/deploy-lib.sh"
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
EXPECT_RELEASE="$(head -1 "$SNAP")" EXPECT_MANIFEST="$SNAP" bash deploy.sh   # deploy.sh сверит и идентификатор, и манифест еще раз под замком (R14, F11)
