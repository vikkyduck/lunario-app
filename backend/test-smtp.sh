#!/usr/bin/env bash
# Быстрая проверка отправки без повторного ввода пароля: берём настройки из .env.
# Запуск: bash /opt/lunario-app/backend/test-smtp.sh адрес@куда.ru
set -euo pipefail
TO="${1:-}"
[ -n "$TO" ] || { echo "Укажите адрес: bash test-smtp.sh you@example.ru"; exit 1; }
cd /opt/lunario-app
node --input-type=module -e "
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/opt/lunario-app/.env','utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0,i).trim()] = line.slice(i+1).trim().replace(/^\"|\"\$/g,'');
}
console.log('логин:', process.env.SMTP_USER, '| конверт:', process.env.SMTP_SENDER || process.env.SMTP_USER, '| от кого:', process.env.SMTP_FROM);
const { sendMail, loginMail } = await import('/opt/lunario-app/backend/mailer.mjs');
const m = loginMail('123456');
try {
  await sendMail({ to: '$TO', subject: m.subject, text: m.text, html: m.html });
  console.log('✓ письмо ушло на $TO — проверьте входящие и «Спам»');
} catch (e) {
  const msg = e.message;
  console.log('✗ не ушло:', msg);
  if (/535/.test(msg)) {
    console.log('');
    console.log('535 = Яндекс не принял логин с паролем. Почти всегда одно из двух:');
    console.log('  • пароль приложения создан под ДРУГИМ аккаунтом. Он привязан к тому ящику,');
    console.log('    под которым вы были залогинены. Для ящика-сотрудника (vu@ / hello@) нужно');
    console.log('    сначала войти именно в него на id.yandex.ru, и уже там создать пароль.');
    console.log('  • в Яндекс 360 у ящика выключен доступ по протоколам (IMAP/SMTP).');
    console.log('    Проверить: mail.yandex.ru под этим ящиком → Настройки → Почтовые программы.');
  }
  if (/55[34]/.test(msg)) {
    console.log('');
    console.log('553/554 = адрес отправителя не принадлежит ящику, под которым авторизовались.');
    console.log('Поставьте SMTP_SENDER равным логину: bash set-smtp.sh и оставьте значения по умолчанию.');
  }
  process.exit(1);
}
" 2>&1 | grep -v Warning
