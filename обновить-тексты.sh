#!/usr/bin/env bash
# Выкладывает тексты из папки content/ на боевой сервер. Ничего, кроме текстов, не трогает.
set -euo pipefail
cd "$(dirname "$0")"
SERVER=root@5.129.198.180

echo "==> проверяю файлы"
node --input-type=module -e "
const C = await import('./backend/content.mjs');
console.log('   карт:', C.ARCANA.length, '· знаков:', C.SIGNS.length, '· тонов дня:', C.DAY_TONES.length, '· рун:', C.RUNES.length);
console.log('   аффирмаций:', C.AFFIRMATIONS.length, '· вопросов дня:', C.DAY_QUESTIONS.length);
process.exit(0);" 2>/dev/null | grep -v '^Тексты:'

echo "==> отправляю на сервер"
for i in 1 2 3 4 5; do
  rsync -az --delete content/ "$SERVER:/opt/lunario-app/content/" && break
  echo "   связь оборвалась, пробую ещё раз ($i)"; sleep 15
done

echo "==> проверяю, что приложение их увидело"
sleep 3
ssh "$SERVER" 'curl -s -o /dev/null -w "   сайт отвечает: %{http_code}\n" https://lunario.online/app/'
echo "✅ Готово — новые тексты уже у людей."
