#!/usr/bin/env bash
# Откат кода на сервере — переключение ссылки current на прежний каталог выпуска (ревью v114, F11): deploy.sh не заменяет файлы
# на месте, а кладет каждый выпуск в /opt/lunario-app/releases/<выпуск> и запоминает прежний в PREVIOUS. База, ключи и контент
# не трогаются; миграции только добавляют колонки, поэтому прежний код работает на более новой базе как есть.
#   bash rollback.sh            — к прежнему выпуску (PREVIOUS)
#   bash rollback.sh <выпуск>   — к конкретному каталогу из /opt/lunario-app/releases (имя — короткий хеш коммита)
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy-lib.sh
. "$REPO/deploy-lib.sh"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TARGET="${1:-}"
if [ -n "$TARGET" ]; then TARGET="releases/$TARGET"; else TARGET="$(remote "cat $APP_ROOT/PREVIOUS 2>/dev/null || true")"; fi
[ -n "$TARGET" ] || { echo "❌ прежнего выпуска нет — deploy.sh новой раскладки еще не выпускал; список: ls $APP_ROOT/releases"; exit 1; }
remote "test -e $APP_ROOT/$TARGET/backend/server.mjs" || { echo "❌ каталога $APP_ROOT/$TARGET нет — список: ls $APP_ROOT/releases"; exit 1; }
CUR="$(remote "readlink $APP_ROOT/current 2>/dev/null || echo ''")"
echo "==> откат: current → $TARGET (сейчас $CUR)"
remote "cd $APP_ROOT && ln -sfn $TARGET current && echo '$CUR' > PREVIOUS && (cp $TARGET/RELEASE RELEASE 2>/dev/null || true) && (cp $TARGET/MANIFEST MANIFEST 2>/dev/null || true)"
if [ "${INSTALL_UNITS:-1}" = 1 ]; then remote "$SYSTEMCTL restart lunario-app && sleep 1 && printf 'health: ' && curl -sS $HEALTH_URL && echo"; fi
