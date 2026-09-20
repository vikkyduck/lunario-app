#!/usr/bin/env bash
# Общее для deploy.sh, deploy-safe.sh и rollback.sh (ревью v114, F11): как считается состояние прода и как зовутся команды на сервере.
# Подключается через source; ничего не запускает сам.
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
APP_ROOT="${APP_ROOT:-/opt/lunario-app}"
CONTENT_ROOT="${CONTENT_ROOT:-/opt/lunario-content}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/lunario-app-backups}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5031/app/api/health}"
# Команды на сервере — ssh; tools/check-deploy.sh подменяет RUN_REMOTE="bash -c" и гоняет выпуск в временную папку на этой же машине
remote() { if [ -n "${RUN_REMOTE:-}" ]; then $RUN_REMOTE "$1"; else ssh "$SERVER" "$1"; fi; }
dest() { if [ -n "${RUN_REMOTE:-}" ]; then echo "$1"; else echo "$SERVER:$1"; fi; }
# sha256 на любой стороне: на сервере — sha256sum (coreutils), на маке для локальной проверки — shasum -a 256; вывод у них один
SHA_CMD='if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi'
sha_local() { bash -c "$SHA_CMD" sha "$@"; }
# Манифест — хеши всех файлов site/ и backend/ (без cities.db и журналов SQLite), пути относительно каталога выпуска
MANIFEST_FIND="find site backend -type f ! -name cities.db ! -name '*.db-wal' ! -name '*.db-shm' -print0 | sort -z | xargs -0 bash -c '$SHA_CMD' sha"
# Состояние прода одной строкой команды: идентификатор выпуска, затем манифест живых файлов текущего выпуска (current — или,
# до первого выпуска новой раскладки, сама папка приложения). Именно живых, а не сохраненного MANIFEST: чужая правка файла
# на сервере не обновляет MANIFEST, а здесь она видна
remote_state_cmd() { echo "cd $APP_ROOT/current 2>/dev/null || cd $APP_ROOT || exit 1; (cat $APP_ROOT/RELEASE 2>/dev/null || echo unknown); $MANIFEST_FIND"; }
remote_state() { remote "$(remote_state_cmd)"; }
