#!/usr/bin/env bash
# lunario.online/app-test — тестовая копия приложения для просмотра ветки до выкладки на прод.
# Своя папка /opt/lunario-app-test, свой порт 5032, своя база; прод (/opt/lunario-app, 5031) не трогаем.
# Пути /app/ в отдаче переписывает nginx (sub_filter) — код приложения о тесте не знает.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
# Админы кабинета задаются только в .env. На стенде без них кабинет просто останется без админов
if ! ssh "$SERVER" 'grep -qE "^ADMIN_EMAILS=.+@" /opt/lunario-app-test/.env 2>/dev/null'; then
  echo "⚠ На стенде не задан ADMIN_EMAILS в /opt/lunario-app-test/.env: кабинет стенда будет без админов."
  echo "  Задать: bash backend/set-admins.sh 'first@example.ru' test"
fi
echo "==> site/ и backend/ → /opt/lunario-app-test (тексты и картинки стенд читает из общей /opt/lunario-content)"
ssh "$SERVER" 'mkdir -p /opt/lunario-app-test/{site,backend,data}'
rsync -az --delete site/ "$SERVER:/opt/lunario-app-test/site/"
# cities.db в git не входит: без защиты rsync --delete стирал ее на сервере, и сервис не поднимался. P - не удалять на сервере, но обновить, если она есть локально
rsync -az --delete --filter="P cities.db" backend/ "$SERVER:/opt/lunario-app-test/backend/"
echo "==> пользователь lunario-test, права и systemd"
# Стенд работает от своего пользователя: его файлы - только данные и копии стенда. Контент прода он читает,
# но писать в него не может (ReadOnlyPaths в unit). Если шаг упадет, trap запустит стенд обратно.
ssh "$SERVER" 'set -e
  trap "systemctl start lunario-app-test 2>/dev/null || true" ERR
  id -u lunario-test >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /opt/lunario-app-test --shell /usr/sbin/nologin lunario-test
  mkdir -p /opt/lunario-app-test/backups
  systemctl stop lunario-app-test 2>/dev/null || true
  chown -R lunario-test:lunario-test /opt/lunario-app-test/data /opt/lunario-app-test/backups
  install -m644 /opt/lunario-app-test/backend/lunario-app-test.service /etc/systemd/system/lunario-app-test.service
  systemctl daemon-reload
  systemctl enable lunario-app-test >/dev/null
  systemctl restart lunario-app-test
  sleep 1
  printf "стенд работает от: "; ps -o user= -p "$(systemctl show -p MainPID --value lunario-app-test)" || echo "не запущен"
  printf "health: "; curl -sS http://127.0.0.1:5032/app-test/api/health; echo'
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app-test/ → %{http_code}\n" https://lunario.online/app-test/ || true
