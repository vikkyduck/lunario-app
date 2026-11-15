#!/usr/bin/env bash
# Проверка почты без повторного ввода пароля: настройки — из .env, код — того выпуска, где лежит этот скрипт
# (/opt/lunario-app/current/backend), а не старая копия /opt/lunario-app/backend, оставшаяся от прежней раскладки.
#   bash /opt/lunario-app/current/backend/test-smtp.sh --verify        — вход в ящик и проверка отправителя, письмо НЕ уходит
#   bash /opt/lunario-app/current/backend/test-smtp.sh адрес@куда.ru   — тестовое письмо с кодом 123456
# Пароль не печатается; адрес передается через окружение, а не вставкой в текст программы.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TO="${1:-}"
[ -n "$TO" ] || { echo "Укажите адрес: bash test-smtp.sh you@example.ru   (или --verify — проверить вход без письма)"; exit 1; }
LUNARIO_MAIL_TO="$TO" LUNARIO_MAILER="$HERE/mailer.mjs" LUNARIO_ENV_FILE="${ENV_FILE:-/opt/lunario-app/.env}" node --no-warnings --input-type=module -e '
import { readFileSync } from "node:fs";
for (const line of readFileSync(process.env.LUNARIO_ENV_FILE, "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const M = await import(process.env.LUNARIO_MAILER);
const to = process.env.LUNARIO_MAIL_TO;
console.log("логин:", process.env.SMTP_USER, "| конверт:", process.env.SMTP_SENDER || process.env.SMTP_USER, "| от кого:", process.env.SMTP_FROM);
const HINT = {
  auth: ["Яндекс не принял логин с паролем приложения (535). Почти всегда одно из двух:",
    "  • пароль приложения создан под ДРУГИМ аккаунтом: он привязан к тому ящику, под которым вы были залогинены.",
    "    Для ящика-сотрудника (vu@ / hello@) сначала войдите именно в него на id.yandex.ru и там создайте пароль;",
    "  • в Яндекс 360 у ящика выключен доступ по протоколам: mail.yandex.ru под этим ящиком → Настройки → Почтовые программы."],
  sender: ["Адрес отправителя не принадлежит ящику (553). Запустите bash set-smtp.sh — отправитель станет равен логину."],
  rejected: ["Яндекс отклонил письмо (554) — похоже на спам или ограничение ящика. Проверьте письма от Яндекса в самом ящике."],
  quota: ["Яндекс ограничил отправку (лимит писем). Сутки не пытайтесь отправлять — каждая попытка продлевает блокировку."],
  net: ["Нет связи с почтовым сервером: сеть, DNS или закрытый порт. Проверка порта: timeout 8 bash -c \"</dev/tcp/smtp.yandex.ru/465\" && echo открыт"],
  temp: ["Почтовый сервер временно отказывает — попробуйте через несколько минут."],
  tls: ["Ошибка TLS: проверьте часы сервера (timedatectl) и порт в SMTP_PORT (465 — TLS сразу, 587 — STARTTLS)."],
  config: ["Ошибка в настройках .env — поправьте SMTP_* и перезапустите сервис."],
};
const explain = (kind) => { for (const l of HINT[kind] || []) console.log(l); };
if (to === "--verify") {
  const r = await M.verifySmtp();
  if (r.ok) { console.log("✓ вход в ящик и отправитель в порядке — письмо не отправлялось"); process.exit(0); }
  console.log("✗ проверка не прошла:", r.error); console.log(""); explain(r.kind); process.exit(1);
}
const m = M.loginMail("123456");
try {
  await M.sendMail({ to, subject: m.subject, text: m.text, html: m.html });
  console.log("✓ письмо ушло на " + to + " — проверьте входящие и «Спам»");
} catch (e) {
  console.log("✗ не ушло:", e.message); console.log(""); explain(e.kind); process.exit(1);
}
'
