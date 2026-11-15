#!/usr/bin/env bash
# Адреса админов рабочего кабинета. В коде их нет: репозиторий публичный, а адрес админа -
# половина входа в кабинет. Запуск с компьютера, откуда идет выкатка:
#   bash backend/set-admins.sh 'first@example.ru,second@example.ru'        - прод
#   bash backend/set-admins.sh 'first@example.ru' test                      - тестовый стенд
# Переписывает в .env на сервере только строку ADMIN_EMAILS и перезапускает сервис.
set -euo pipefail
LIST="$(printf '%s' "${1:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
TARGET="${2:-prod}"
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"

[ -n "$LIST" ] || { echo "Укажите адреса через запятую: bash backend/set-admins.sh 'first@example.ru,second@example.ru'"; exit 1; }
IFS=',' read -r -a ADDRS <<< "$LIST"
for a in "${ADDRS[@]}"; do
  [[ "$a" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "✗ \"$a\" - не адрес почты"; exit 1; }
done
case "$TARGET" in
  prod) ENVF=/opt/lunario-app/.env;      UNIT=lunario-app ;;
  test) ENVF=/opt/lunario-app-test/.env; UNIT=lunario-app-test ;;
  *) echo "Второй параметр - prod или test"; exit 1 ;;
esac

# В адресах после проверки только буквы, цифры и . _ % + - @ , - строку можно вставить в команду как есть
ssh "$SERVER" "set -e
  touch $ENVF; chmod 600 $ENVF
  { grep -v '^ADMIN_EMAILS=' $ENVF || true; echo 'ADMIN_EMAILS=$LIST'; } > $ENVF.tmp
  mv $ENVF.tmp $ENVF; chmod 600 $ENVF
  systemctl restart $UNIT 2>/dev/null || true"
echo "✓ ADMIN_EMAILS задан ($TARGET), адресов: ${#ADDRS[@]}. Сервис перезапущен."
