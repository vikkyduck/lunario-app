#!/usr/bin/env bash
# Диагностика входа по почте на сервере. Только чтение: ничего не меняет и не перезапускает.
# Запуск с компьютера, откуда идет выкатка:
#   bash проверить-почту.sh                  - состояние, журнал, настройки
#   bash проверить-почту.sh you@example.ru   - то же и тестовое письмо с кодом 123456
# Пароли не показываются: только есть они или нет.
# Скрипт пришел из main (92bcc82) и переписан под раскладку выпусков: код живет в /opt/lunario-app/current.
set -uo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
TO="${1:-}"
ssh "$SERVER" bash -s -- "$TO" <<'REMOTE'
TO="${1:-}"
ENV=/opt/lunario-app/.env
APP=/opt/lunario-app/current
[ -e "$APP/backend/server.mjs" ] || APP=/opt/lunario-app   # прежняя раскладка без выпусков
echo "== 1. Сервис и почта"
printf "выпуск: "; cat /opt/lunario-app/RELEASE 2>/dev/null || echo "нет файла RELEASE"
printf "сервис: "; systemctl is-active lunario-app
printf "health: "; curl -sS -m 5 http://127.0.0.1:5031/app/api/health; echo
echo "   mail: ok - вход по почте работает, checking - первая проверка после запуска,"
echo "   down - почта не работает (сервер перепроверяет сам), off - не настроена или ошибка в .env."
echo
echo "== 2. Почта в журнале за 7 дней (последние 30 строк)"
journalctl -u lunario-app --since "7 days ago" --no-pager 2>/dev/null \
  | grep -E "SMTP|почт|X-Forwarded-For" | tail -30
echo
printf "== 3. Запусков сервиса за 7 дней: "
journalctl -u lunario-app --since "7 days ago" --no-pager 2>/dev/null | grep -c "lunario-app: http"
echo
echo "== 4. Настройки почты в $ENV"
grep -E '^SMTP_(HOST|PORT|USER|FROM|SENDER|SECURE|TLS_NAME)=' "$ENV" 2>/dev/null || echo "   строк SMTP_ нет: почта не настроена, нужен bash $APP/backend/set-smtp.sh"
grep -q '^SMTP_PASS=.' "$ENV" 2>/dev/null && echo "SMTP_PASS задан" || echo "SMTP_PASS НЕ задан"
echo "   Адрес в SMTP_FROM должен совпадать с SMTP_USER или быть его алиасом в Яндекс 360,"
echo "   иначе Яндекс отбивает письма (сервер сам повторит отправку от адреса логина)"
echo
echo "== 5. Передает ли nginx адрес клиента"
grep -rn -E "X-Forwarded-For|X-Real-IP" /etc/nginx/ 2>/dev/null \
  || echo "   заголовков нет: лимиты на коды и новые аккаунты считаются на всех клиентов вместе"
echo
echo "== 6. База городов"
ls -la "$APP/backend/cities.db" 2>/dev/null || echo "   cities.db НЕТ: подсказок городов не будет, сервер при этом поднимется"
echo
echo "== 7. Вход в ящик без письма"
bash "$APP/backend/test-smtp.sh" --verify
if [ -n "$TO" ]; then
  echo
  echo "== 8. Тестовое письмо на $TO"
  bash "$APP/backend/test-smtp.sh" "$TO"
fi
REMOTE
