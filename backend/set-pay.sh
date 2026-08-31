#!/usr/bin/env bash
# Подключение оплаты через Продамус. Запуск на сервере:
#   ssh -t root@5.129.198.180 'bash /opt/lunario-app/backend/set-pay.sh'
set -euo pipefail
ENV=/opt/lunario-app/.env
touch "$ENV"; chmod 600 "$ENV"

echo
echo "Оплата Лунарио+ через Продамус."
echo "Секретный ключ лежит в кабинете: utkina.payform.ru → Настройки → «Секретный ключ» → скопировать."
echo

read -r -p "1/3 Адрес платёжной формы [utkina.payform.ru]: " F; F="${F:-utkina.payform.ru}"

while :; do
  read -r -s -p "2/3 Секретный ключ (ввод скрыт, вставьте из кабинета): " K; echo
  K="${K//[[:space:]]/}"
  [ -z "$K" ] && { echo "   ✗ Пусто. Скопируйте ключ в кабинете и вставьте сюда."; continue; }
  [ ${#K} -lt 32 ] && echo "   ⚠ Ключ выглядит коротким — проверьте, что скопировали целиком."
  break
done

read -r -p "3/3 Цена подписки в рублях [490]: " A; A="${A:-490}"
A="${A//[^0-9.]/}"

grep -v '^PRODAMUS_FORM=\|^PRODAMUS_SECRET=\|^SUB_AMOUNT=\|^SUB_PRICE=' "$ENV" > "$ENV.tmp" || true
{
  echo "PRODAMUS_FORM=$F"
  echo "PRODAMUS_SECRET=$K"
  echo "SUB_AMOUNT=$A.00"
  echo "SUB_PRICE=$A ₽ / месяц"
} >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"

systemctl restart lunario-app
sleep 1
echo
echo "✓ Готово. В приложении в окне «Лунарио+» появилась кнопка «Оформить за $A ₽»."
echo "  Проверка: пока форма в демо-режиме, оплата пройдёт без списания денег."
