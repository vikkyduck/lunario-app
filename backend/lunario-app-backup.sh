#!/usr/bin/env bash
# Ночная копия того, что нельзя восстановить из git: база приложения (люди, записи, полочки),
# ключ шифрования и ключи пушей, папка контента (тексты и картинки). Хранится 14 дней.
# Ставится кроном из /etc/cron.d/lunario-app-backup (deploy.sh кладёт его сам).
set -euo pipefail
DST=/opt/lunario-app-backups
DATA=/opt/lunario-app/data
CONTENT=/opt/lunario-content
STAMP=$(date +%F)
mkdir -p "$DST"
sqlite3 "$DATA/app.db" ".backup '$DST/app-$STAMP.db'"
gzip -f "$DST/app-$STAMP.db"
cp -p "$DATA/secret.key" "$DST/secret.key"                # ключ один и тот же, без него база не читается
[ -f "$DATA/push-keys.json" ] && cp -p "$DATA/push-keys.json" "$DST/push-keys.json"
tar -czf "$DST/content-$STAMP.tar.gz" -C "$(dirname "$CONTENT")" "$(basename "$CONTENT")"
ls -t "$DST"/app-*.db.gz | tail -n +15 | xargs -r rm -f
ls -t "$DST"/content-*.tar.gz | tail -n +15 | xargs -r rm -f
