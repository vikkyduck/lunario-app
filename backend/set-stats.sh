#!/usr/bin/env bash
# Пароль к сводке по продукту (/app/api/stats). Запуск на сервере:
#   ssh -t root@5.129.198.180 'bash /opt/lunario-app/backend/set-stats.sh'
set -euo pipefail
ENV=/opt/lunario-app/.env
touch "$ENV"; chmod 600 "$ENV"

echo
echo "Сводка по Лунарио — кто заходит, что нажимают, за что готовы платить."
echo "Придумайте логин и пароль: их спросит браузер при открытии сводки."
echo

read -r -p "1/2 Логин [admin]: " U; U="${U:-admin}"

while :; do
  read -r -s -p "2/2 Пароль (ввод скрыт): " P; echo
  P="${P//[[:space:]]/}"
  [ -z "$P" ] && { echo "   ✗ Пусто. Введите пароль."; continue; }
  [ ${#P} -lt 8 ] && echo "   ⚠ Короткий пароль — лучше от 8 символов."
  break
done

# переписываем только свои строки, остальное в .env не трогаем
grep -v '^STATS_USER=\|^STATS_PASS=' "$ENV" > "$ENV.tmp" || true
{ echo "STATS_USER=$U"; echo "STATS_PASS=$P"; } >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"

systemctl restart lunario-app
sleep 1
echo
echo "✓ Готово. Сводка: https://lunario.online/app/api/stats"
echo "  Логин: $U · пароль тот, что вы ввели."
