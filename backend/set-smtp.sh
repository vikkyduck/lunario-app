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
  read -r -p "1/3 Логин ящика (адрес целиком) [hello@vi-utkina.ru]: " SMTP_USER
  SMTP_USER=${SMTP_USER:-hello@vi-utkina.ru}
  if [[ "$SMTP_USER" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$ ]]; then break; fi
  echo "   ✗ «$SMTP_USER» — не адрес почты. Нужен вид vu@vi-utkina.ru (название бренда спросим третьим вопросом)."
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
cat > "$ENV" <<CONF
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
CONF
chmod 600 "$ENV"
echo
echo "✓ Настройки сохранены в $ENV (права 600, читает только root)"

systemctl restart lunario-app
sleep 1
printf "✓ сервис: "; curl -sS http://127.0.0.1:5031/app/api/health; echo
echo

read -r -p "Куда отправить тестовое письмо (Enter — пропустить): " TESTTO
if [ -n "$TESTTO" ]; then
  # .env читает сам test-smtp.sh (Node'ом построчно): в SMTP_FROM есть «<», и bash
  # на таком файле падает с «syntax error near unexpected token newline».
  bash "$(dirname "$0")/test-smtp.sh" "$TESTTO" || exit 1
fi
echo
echo "Готово. Кнопка «Прислать код» в разделе «Я» теперь работает."
