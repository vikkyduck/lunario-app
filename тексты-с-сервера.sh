#!/usr/bin/env bash
# Забирает тексты и картинки с сервера в локальную папку content/ — например, на новом компьютере
# или после правок в кабинете «Контент». Локальный файл, который правили позже, не перезаписывается.
set -euo pipefail
cd "$(dirname "$0")"
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
REMOTE=/opt/lunario-content

mkdir -p content
echo "==> забираю с сервера (новее локально — не трогаю)"
rsync -az --update "$SERVER:$REMOTE/" content/
echo "✅ Готово: $(ls content/*.txt | wc -l | tr -d ' ') текстовых файлов, картинок — $(find content/картинки -type f | wc -l | tr -d ' ')"
