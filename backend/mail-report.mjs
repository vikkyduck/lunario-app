/* Вслух о входе по почте — для deploy.sh, rollback.sh и set-smtp.sh (консилиум 16.10).
   Почта — внешний сервис: ее сбой не повод откатывать выпуск, но и молчать о нем нельзя — так вход пролежал на проде неделю,
   пока каждая выкатка говорила «выпуск работает». Сюда передается ответ /api/health, запрошенный с самого сервера
   (тогда в нем есть mailInfo с причиной).   node mail-report.mjs '<json health>'
   Код выхода: 0 — почта работает, 3 — не работает, 4 — еще проверяется или неизвестно. */
const raw = process.argv[2] || '';
let h = null;
try { h = JSON.parse(raw); } catch { /* нет ответа — ниже скажем, что не знаем */ }
const say = (s) => console.log(s);
if (!h || !h.mail) {
  say('ℹ️  состояние входа по почте неизвестно (сервер не ответил или выпуск без поля mail в /api/health)');
  process.exit(4);
}
const info = h.mailInfo || {};
if (h.mail === 'ok') { say('✓ вход по почте работает'); process.exit(0); }
if (h.mail === 'checking') {
  say('… почта еще проверяется. Через минуту: curl -s http://127.0.0.1:5031/app/api/health — поле mail должно быть "ok"');
  process.exit(4);
}
say('');
say('⚠️  ВЫПУСК РАБОТАЕТ, НО ВХОД ПО ПОЧТЕ СЕЙЧАС НЕ РАБОТАЕТ');
if (info.reason) say(`   причина: ${info.reason}`);
if (h.mail === 'down') say(`   сервер перепроверит почту сам${info.retryAfter ? ` (через ${info.retryAfter} с)` : ''} — откатывать выпуск не нужно, код тут обычно ни при чем`);
if (h.mail === 'off') say('   почта не настроена или ошибка в /opt/lunario-app/.env — сама не включится: bash /opt/lunario-app/current/backend/set-smtp.sh');
if (info.kind === 'auth') say('   что делать: новый пароль приложения под этим ящиком в id.yandex.ru → bash /opt/lunario-app/current/backend/set-smtp.sh');
if (info.kind === 'net' || info.kind === 'temp') say('   обычно проходит само за несколько минут; если дольше часа — проверить порт 465 и DNS на сервере');
say('   подробности на сервере: journalctl -u lunario-app -n 80 --no-pager | grep SMTP:');
say('');
process.exit(3);
