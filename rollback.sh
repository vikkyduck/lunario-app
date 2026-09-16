#!/usr/bin/env bash
# Откат кода на сервере к снимку, который deploy.sh снимает перед каждой выкаткой:
# восстанавливаются site/ и backend/ (база, ключи и контент не трогаются), сервис перезапускается, проверяется health.
# bash rollback.sh            — к последнему снимку
# bash rollback.sh <файл>     — к конкретному code-….tar.gz из /opt/lunario-app-backups
# База после отката может быть новее кода: миграции только добавляют колонки, прежний код работает на ней как есть.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
SNAP="${1:-}"
if [ -z "$SNAP" ]; then SNAP="$(ssh "$SERVER" 'ls -t /opt/lunario-app-backups/code-*.tar.gz 2>/dev/null | head -1')"; fi
[ -n "$SNAP" ] || { echo "❌ снимков кода нет — deploy.sh ещё не снимал их"; exit 1; }
echo "==> откат к $SNAP"
ssh "$SERVER" "tar -xzf '$SNAP' -C /opt/lunario-app && systemctl restart lunario-app && sleep 1 && printf 'health: ' && curl -sS http://127.0.0.1:5031/app/api/health && echo"
