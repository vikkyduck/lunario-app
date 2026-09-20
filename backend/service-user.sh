#!/usr/bin/env bash
# Пользователь сервиса и права на сервере (ревью v114, F02). Запускается от root на сервере — deploy.sh зовет его после
# каждого rsync (rsync от root сбрасывает владельцев), обновить-тексты.sh — после отправки контента. Повторный запуск
# ничего не ломает: пользователь создается один раз, владельцы и режимы выставляются заново.
#   код (site/, backend/)            — root:lunario, только чтение для сервиса, посторонним недоступен
#   данные, контент, копии           — lunario:lunario, сервис пишет; data/secret.key — 0600
#   .env (SMTP, BACKUP_SECRET)       — root:lunario 0640: systemd читает его сам до смены пользователя
#   bash backend/service-user.sh [APP_DIR] [CONTENT_DIR] [BACKUP_DIR]
set -euo pipefail
USER_NAME="${SERVICE_USER:-lunario}"
APP="${1:-/opt/lunario-app}"; CONTENT="${2:-/opt/lunario-content}"; BACKUPS="${3:-/opt/lunario-app-backups}"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
  echo "создан системный пользователь $USER_NAME (без домашней папки и входа)"
fi
mkdir -p "$APP/data" "$CONTENT" "$BACKUPS"
# код — только чтение: сервис не может переписать сам себя, даже если найдется дыра в кабинете
for d in "$APP/site" "$APP/backend" "$APP/releases" "$APP/tools"; do
  [ -e "$d" ] || continue
  chown -R "root:$USER_NAME" "$d"
  chmod -R o-rwx,g-w "$d"
done
for f in "$APP/RELEASE" "$APP/MANIFEST"; do [ -e "$f" ] && chown "root:$USER_NAME" "$f" && chmod 0640 "$f" || true; done
# данные, контент и копии — сервис пишет; посторонним недоступно
for d in "$APP/data" "$CONTENT" "$BACKUPS"; do
  chown -R "$USER_NAME:$USER_NAME" "$d"
  chmod -R o-rwx "$d"
done
[ -e "$APP/data/secret.key" ] && chmod 0600 "$APP/data/secret.key" || true
[ -e "$APP/.env" ] && chown "root:$USER_NAME" "$APP/.env" && chmod 0640 "$APP/.env" || true
echo "права выставлены: код root:$USER_NAME (чтение), данные/контент/копии $USER_NAME:$USER_NAME"
