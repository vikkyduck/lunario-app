#!/usr/bin/env bash
# Диагностика входа по почте на сервере. Только чтение: ничего не меняет и не перезапускает.
# Запуск с компьютера, откуда идет выкатка:
#   bash проверить-почту.sh                  - состояние, журнал, настройки
#   bash проверить-почту.sh you@example.ru   - то же и тестовое письмо с кодом 123456
# Пароли не показываются: только есть они или нет.
set -uo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
TO="${1:-}"
ssh "$SERVER" bash -s -- "$TO" <<'REMOTE'
TO="${1:-}"
ENV=/opt/lunario-app/.env
echo "== 1. Сервис и почта"
printf "сервис: "; systemctl is-active lunario-app
printf "health: "; curl -sS -m 5 http://127.0.0.1:5031/app/api/health; echo
echo "   mail: ok - код уходит, error - почта настроена, но проверка не проходит, off - не настроена."
echo "   Если поля mail нет, на сервере старая версия: нужен bash deploy.sh"
echo
echo "== 2. Почта в журнале за 7 дней (последние 30 строк)"
journalctl -u lunario-app --since "7 days ago" --no-pager 2>/dev/null \
  | grep -E "SMTP|почта не ушла|письмо о доступе не ушло|nginx не передает" | tail -30
echo
printf "== 3. Запусков сервиса за 7 дней: "
journalctl -u lunario-app --since "7 days ago" --no-pager 2>/dev/null | grep -c "lunario-app: http"
echo "   До исправления почта проверялась один раз на запуск: не прошла проверка - вход скрыт до следующего запуска"
echo
echo "== 4. Настройки почты в $ENV"
grep -E '^SMTP_(HOST|PORT|USER|FROM|SENDER)=' "$ENV" 2>/dev/null || echo "   строк SMTP_ нет: почта не настроена, нужен bash /opt/lunario-app/backend/set-smtp.sh"
grep -q '^SMTP_PASS=.' "$ENV" 2>/dev/null && echo "SMTP_PASS задан" || echo "SMTP_PASS НЕ задан"
echo "   Адрес в SMTP_FROM должен совпадать с SMTP_USER или быть его алиасом в Яндекс 360,"
echo "   иначе Яндекс отбивает письма (новая версия сама повторит отправку от адреса логина)"
echo
echo "== 5. Передает ли nginx IP пользователя"
grep -rn -E "X-Forwarded-For|X-Real-IP" /etc/nginx/ 2>/dev/null \
  || echo "   заголовков нет: до исправления лимит 5 кодов за 10 минут был общим на всех пользователей"
echo
echo "== 6. База городов"
ls -la /opt/lunario-app/backend/cities.db 2>/dev/null || echo "   cities.db НЕТ: старая версия сервера на этом падала целиком"
if [ -n "$TO" ]; then
  echo
  echo "== 7. Тестовое письмо на $TO"
  bash /opt/lunario-app/backend/test-smtp.sh "$TO"
fi
REMOTE
