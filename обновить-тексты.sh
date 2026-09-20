#!/usr/bin/env bash
# Отправляет тексты и картинки из локальной папки content/ в папку контента на сервере.
# Кода не касается. Папка контента на сервере — /opt/lunario-content, в git она не попадает.
# Файл, который на сервере правили позже (например, из кабинета «Контент»), не перезаписывается:
# сначала заберите его командой ./тексты-с-сервера.sh
set -euo pipefail
cd "$(dirname "$0")"
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
REMOTE=/opt/lunario-content

echo "==> проверяю файлы"
node --input-type=module -e "
const C = await import('./backend/content.mjs');
console.log('   карт:', C.ARCANA.length, '· знаков:', C.SIGNS.length, '· тонов дня:', C.DAY_TONES.length, '· рун:', C.RUNES.length, '· личных лет:', [1,2,3,4,5,6,7,8,9].filter((n) => C.YEARS[n]).length);
console.log('   аффирмаций:', C.AFFIRMATIONS.length, '· вопросов дня:', C.DAY_QUESTIONS.length, '· лунных дней с описанием:', C.LUNAR_INFO.length, '· глав справочника:', C.lunarRef() ? C.lunarRef().sections.length : 0);
process.exit(0);" 2>/dev/null | grep -v '^Тексты:'

echo "==> отправляю на сервер (новее на сервере — не трогаю)"
ssh "$SERVER" "mkdir -p $REMOTE/картинки"
# без -o/-g: иначе файлы приезжают с владельцем вашего компьютера (uid 501), и сервис (пользователь lunario, F02) не может их ни читать, ни править из кабинета
for i in 1 2 3 4 5; do
  rsync -rlptDz --update --exclude '.DS_Store' content/ "$SERVER:$REMOTE/" && break
  echo "   связь оборвалась, пробую ещё раз ($i)"; sleep 15
done

# файлы, пришедшие от root, сервису (пользователь lunario, F02) иначе не переписать из кабинета «Контент»
ssh "$SERVER" 'for s in /opt/lunario-app/current/backend/service-user.sh /opt/lunario-app/backend/service-user.sh; do if [ -e "$s" ]; then bash "$s" >/dev/null; break; fi; done'
echo "==> проверяю, что приложение их увидело"
sleep 3
ssh "$SERVER" 'curl -s -o /dev/null -w "   сайт отвечает: %{http_code}\n" https://lunario.online/app/'
echo "✅ Готово — новые тексты уже у людей. Перезапускать ничего не нужно."
