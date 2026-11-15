#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS.
# Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"

echo "==> проверка окружения"
# Админы кабинета задаются только строкой ADMIN_EMAILS в .env на сервере. Без нее новая версия
# поднимется без админов, поэтому проверяем до любых изменений на сервере.
if ! ssh "$SERVER" 'grep -qE "^ADMIN_EMAILS=.+@" /opt/lunario-app/.env 2>/dev/null'; then
  echo "✗ На сервере не задан ADMIN_EMAILS в /opt/lunario-app/.env - кабинет остался бы без админов."
  echo "  Задайте адреса и повторите выкатку:"
  echo "  bash backend/set-admins.sh 'first@example.ru,second@example.ru'"
  exit 1
fi

echo "==> site/ и backend/ → /opt/lunario-app"
ssh "$SERVER" 'mkdir -p /opt/lunario-app/{site,backend,data} /opt/lunario-content/картинки'
rsync -az --delete site/ "$SERVER:/opt/lunario-app/site/"
# cities.db в git не входит: без защиты rsync --delete стирал ее на сервере, и сервис не поднимался. P - не удалять на сервере, но обновить, если она есть локально
rsync -az --delete --filter="P cities.db" backend/ "$SERVER:/opt/lunario-app/backend/"
# тексты и картинки — не код: они живут в /opt/lunario-content и выкладываются отдельно, ./обновить-тексты.sh

echo "==> пользователь lunario, права и systemd"
# Сервис, планировщик напоминаний и ночные копии работают от пользователя lunario, а не от root.
# Все, кто пишет в базу, должны быть одним пользователем: служебные файлы SQLite (-wal, -shm),
# созданные root, сервис открыть не сможет. Поэтому на время смены владельца сервис и таймер стоят.
# Если шаг упадет, trap запустит их обратно, чтобы приложение не осталось лежать.
# Каждый шаг на своей строке: в цепочке через && set -e не останавливает скрипт на первой ошибке.
ssh "$SERVER" 'set -e
  trap "systemctl start lunario-app lunario-daily.timer 2>/dev/null || true" ERR
  id -u lunario >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /opt/lunario-app --shell /usr/sbin/nologin lunario
  mkdir -p /opt/lunario-app-backups
  touch /var/log/lunario-app-backup.log
  systemctl stop lunario-daily.timer lunario-daily.service lunario-app 2>/dev/null || true
  chown -R lunario:lunario /opt/lunario-app/data /opt/lunario-content /opt/lunario-app-backups /var/log/lunario-app-backup.log
  install -m644 /opt/lunario-app/backend/lunario-app.service /etc/systemd/system/lunario-app.service
  install -m644 /opt/lunario-app/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service
  install -m644 /opt/lunario-app/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer
  install -m644 /dev/stdin /etc/cron.d/lunario-app-backup <<< "40 3 * * * lunario DATA_DIR=/opt/lunario-app/data CONTENT_DIR=/opt/lunario-content BACKUP_DIR=/opt/lunario-app-backups /usr/bin/node /opt/lunario-app/backend/backup.mjs >>/var/log/lunario-app-backup.log 2>&1"
  systemctl daemon-reload
  systemctl enable lunario-app >/dev/null
  systemctl enable lunario-daily.timer >/dev/null
  systemctl restart lunario-app
  systemctl restart lunario-daily.timer
  sleep 1
  printf "сервис работает от: "; ps -o user= -p "$(systemctl show -p MainPID --value lunario-app)" || echo "не запущен"
  printf "health: "; curl -sS http://127.0.0.1:5031/app/api/health; echo'

echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true
