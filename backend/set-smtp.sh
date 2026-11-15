#!/usr/bin/env bash
# Лунарио: включение входа по почте. Запускается НА СЕРВЕРЕ, пароль вводит владелец —
# в терминале, невидимо, мимо чата и мимо логов.
set -euo pipefail
ENV=/opt/lunario-app/.env

echo "── Лунарио · настройка отправки почты ──"
echo
echo "Понадобится ПАРОЛЬ ПРИЛОЖЕНИЯ Яндекса (не пароль от ящика):"
echo "  id.yandex.ru → Безопасность → Пароли приложений → «Почта» → создать"
echo
echo "Будет три вопроса. На любой можно просто нажать Enter — подставится значение в скобках."
echo

# 1. Логин — обязательно полный адрес: Яндекс авторизует по нему
while :; do
  read -r -p "1/3 Логин ящика (адрес целиком) [hello@example.ru]: " SMTP_USER
  SMTP_USER=${SMTP_USER:-hello@example.ru}
  if [[ "$SMTP_USER" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$ ]]; then break; fi
  echo "   ✗ «$SMTP_USER» — не адрес почты. Нужен вид you@example.ru (название бренда спросим третьим вопросом)."
done

# 2. Пароль приложения — 16 символов, Яндекс показывает его группами по 4
while :; do
  read -r -s -p "2/3 Пароль приложения (ввод скрыт): " SMTP_PASS; echo
  SMTP_PASS=${SMTP_PASS// /}                       # пробелы из группировки убираем сами
  if [ -z "$SMTP_PASS" ]; then echo "   ✗ Пусто. Скопируйте пароль приложения из id.yandex.ru."; continue; fi
  if [ ${#SMTP_PASS} -lt 12 ]; then
    echo "   ⚠ Короткий (${#SMTP_PASS} симв.). Пароль приложения обычно 16 символов."
    read -r -p "   Всё равно использовать? [y/N]: " YES
    [[ "$YES" =~ ^[YyДд]$ ]] || continue
  fi
  break
done

# 3. Отправитель — то, что увидит человек в списке писем
echo "   Если домен lunario.online уже подтверждён в Яндекс 360 — оставьте Enter."
echo "   Если ещё нет — впишите: Лунарио <$SMTP_USER>"
read -r -p "3/3 Подпись отправителя [Лунарио <hello@lunario.online>]: " SMTP_FROM
SMTP_FROM=${SMTP_FROM:-"Лунарио <hello@lunario.online>"}

umask 077
# меняем только свои ключи — остальное в .env (например ADMIN_EMAILS) остаётся. SMTP_SENDER, SMTP_SECURE и SMTP_TLS_NAME
# тоже убираем: прежний «конверт» от другого ящика давал 553 на каждое письмо, а повторный запуск этого скрипта его не трогал
touch "$ENV"
grep -v '^SMTP_HOST=\|^SMTP_PORT=\|^SMTP_USER=\|^SMTP_PASS=\|^SMTP_FROM=\|^SMTP_SENDER=\|^SMTP_SECURE=\|^SMTP_TLS_NAME=' "$ENV" > "$ENV.tmp" || true
{
  echo "SMTP_HOST=smtp.yandex.ru"
  echo "SMTP_PORT=465"
  echo "SMTP_USER=$SMTP_USER"
  echo "SMTP_PASS=$SMTP_PASS"
  echo "SMTP_FROM=$SMTP_FROM"
} >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
echo
echo "✓ Настройки сохранены в $ENV (права 600, читает только root)"

systemctl restart lunario-app
# Вердикт — от самого сервиса: он проверяет вход в ящик и отправителя при запуске. Раньше здесь была секунда ожидания
# и безусловное «Готово», даже если Яндекс отклонил пароль
H=""
for i in $(seq 1 15); do
  H="$(curl -sS --max-time 3 http://127.0.0.1:5031/app/api/health 2>/dev/null || true)"
  case "$H" in *'"mail":"checking"'*|'') sleep 2;; *) break;; esac
done
echo
MAIL_OK=0
node "$(dirname "$0")/mail-report.mjs" "$H" && MAIL_OK=1 || true
echo

read -r -p "Куда отправить тестовое письмо (Enter — пропустить): " TESTTO
if [ -n "$TESTTO" ]; then
  # .env читает сам test-smtp.sh (Node'ом построчно): в SMTP_FROM есть «<», и bash
  # на таком файле падает с «syntax error near unexpected token newline».
  bash "$(dirname "$0")/test-smtp.sh" "$TESTTO" || exit 1
fi
echo
if [ "$MAIL_OK" = 1 ]; then echo "Готово. Вход по почте (приветствие → «Войти», анкета, кабинет) работает."
else echo "Вход по почте пока НЕ работает — причина выше. Проверить вход без письма: bash $(dirname "$0")/test-smtp.sh --verify"; exit 1; fi
