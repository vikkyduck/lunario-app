/* Отправка почты по SMTP без зависимостей: node:tls + разговор с сервером руками.
   Настройки — из окружения (файл /opt/lunario-app/.env, читается systemd):
     SMTP_HOST=smtp.yandex.ru  SMTP_PORT=465  SMTP_USER=you@example.ru
     SMTP_PASS=<пароль приложения>  SMTP_FROM="Лунарио <vu@withoutwater.ru>"
   Пароль приложения создаётся в id.yandex.ru → Безопасность → Пароли приложений
   и доступа к самому ящику не даёт. */
import { connect } from 'node:tls';
import { randomBytes } from 'node:crypto';

const CFG = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  sender: process.env.SMTP_SENDER || process.env.SMTP_USER || '',   // адрес в конверте
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',        // что видит получатель
});
export const mailReady = () => { const c = CFG(); return !!(c.host && c.user && c.pass); };

/* Одна реплика разговора: отправить строку и дождаться полного ответа сервера.
   Ответа может не быть вовсе: сервер закрыл соединение молча (так делают при
   подозрении на спам и при перегрузке). Раньше на этом месте обещание повисало
   навсегда: запрос кода не завершался, человек бесконечно видел "Отправляем код...".
   Теперь закрытое соединение - такая же ошибка, как неверный код ответа. */
function talk(sock, expect, line) {
  return new Promise((res, rej) => {
    if (sock.destroyed) return rej(new Error('smtp_closed'));
    let buf = '';
    const stop = () => { sock.off('data', onData); sock.off('error', onError); sock.off('close', onClose); };
    const onError = (e) => { stop(); rej(e); };
    const onClose = () => { stop(); rej(new Error('smtp_closed' + (buf ? `: ${buf.trim().slice(0, 120)}` : ''))); };
    const onData = (d) => {
      buf += d.toString('utf8');
      if (!/\r\n$/.test(buf)) return;                       // ждём конца ответа
      const last = buf.trim().split('\r\n').pop();
      if (/^\d{3}-/.test(last)) return;                     // многострочный ответ ещё не закончен
      stop();
      const code = Number(buf.slice(0, 3));
      if (expect && !expect.includes(code)) return rej(new Error(`SMTP ${code}: ${buf.trim().slice(0, 120)}`));
      res(buf);
    };
    sock.on('data', onData);
    sock.once('error', onError);
    sock.once('close', onClose);
    if (line !== undefined) sock.write(line + '\r\n');
  });
}

/* Соединение, приветствие и вход - общие для отправки и для проверки.
   Два ограничения по времени: тишина дольше idleMs и весь разговор дольше totalMs. */
async function open(c, idleMs, totalMs) {
  const sock = connect({ host: c.host, port: c.port, servername: c.host });
  sock.setTimeout(idleMs, () => sock.destroy(new Error('smtp_timeout')));
  const deadline = setTimeout(() => sock.destroy(new Error('smtp_timeout')), totalMs);
  deadline.unref();
  sock.once('close', () => clearTimeout(deadline));
  sock.on('error', () => {});   // ошибку разбирает текущая реплика; без слушателя процесс бы упал
  try {
    await new Promise((r, j) => {
      const ok = () => { sock.off('error', j); sock.off('close', closed); r(); };
      const closed = () => j(new Error('smtp_closed'));
      sock.once('secureConnect', ok); sock.once('error', j); sock.once('close', closed);
    });
    await talk(sock, [220]);
    await talk(sock, [250], 'EHLO lunario.online');
    await talk(sock, [334], 'AUTH LOGIN');
    await talk(sock, [334], b64(c.user));
    await talk(sock, [235], b64(c.pass));
    return sock;
  } catch (e) { sock.destroy(); throw e; }
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
/* Тема и имя по RFC 2047: кириллица иначе приедет крокозябрами.
   Одно закодированное слово - не длиннее 75 знаков, поэтому длинная тема
   режется на несколько слов по границам символов и переносится строкой с пробелом. */
const mimeWord = (s) => {
  const words = []; let cur = '';
  for (const ch of String(s)) {
    if (cur && Buffer.byteLength(cur + ch, 'utf8') > 45) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur || !words.length) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
};
/* «Лунарио <hello@lunario.online>» → имя по RFC 2047, адрес как есть.
   Сырую кириллицу в From сервер выбрасывает вместе со всем заголовком:
   письмо уходит без отправителя, DKIM ломается (bad signature format),
   и получатель отбивает его как спам (mail.ru — с 550). */
const formatFrom = (raw) => {
  const m = String(raw).trim().match(/^(.*?)\s*<([^>]+)>$/);
  if (!m) return `<${String(raw).trim()}>`;
  const [, name, addr] = m;
  if (!name) return `<${addr}>`;
  return `${/^[\x20-\x7E]*$/.test(name) ? name : mimeWord(name)} <${addr}>`;
};
const addrOf = (raw) => { const m = String(raw).match(/<([^>]+)>/); return (m ? m[1] : String(raw)).trim(); };

/* Яндекс отправляет только от имени ящика, под которым вошли (и его подтвержденных
   алиасов). Если SMTP_FROM или SMTP_SENDER указывают на другой адрес, письмо отбивается
   ответом 553 "Sender address rejected: not owned by auth user" и код не доходит.
   Тогда пробуем еще раз от адреса логина: имя отправителя остается прежним. */
const NOT_OWNER = /^SMTP 55\d\b.*(not owned|sender address rejected)/i;
let warnedOwner = false;
export async function sendMail(msg) {
  const c = CFG();
  if (!mailReady()) throw new Error('smtp_not_configured');
  try {
    return await sendOnce(c, msg);
  } catch (e) {
    const user = c.user.toLowerCase();
    const mismatch = c.sender.toLowerCase() !== user || addrOf(c.from).toLowerCase() !== user;
    if (!mismatch || !NOT_OWNER.test(e.message)) throw e;
    if (!warnedOwner) { warnedOwner = true; console.warn(`SMTP: адрес отправителя не принадлежит ${c.user}, письма уходят от адреса логина. Поправьте SMTP_FROM: bash set-smtp.sh`); }
    const name = (String(c.from).match(/^(.*?)\s*</) || [])[1] || '';
    return sendOnce({ ...c, sender: c.user, from: name ? `${name} <${c.user}>` : c.user }, msg);
  }
}

async function sendOnce(c, { to, subject, text, html }) {
  const sock = await open(c, 15000, 40000);
  try {
    await talk(sock, [250], `MAIL FROM:<${c.sender}>`);
    await talk(sock, [250, 251], `RCPT TO:<${to}>`);
    await talk(sock, [354], 'DATA');
    const boundary = 'lun' + Math.random().toString(36).slice(2);
    /* Date и Message-ID обязательны по RFC 5322. Без них часть почтовых служб
       (Gmail - прямо, остальные - через спам-фильтр) письмо не принимает или прячет. */
    const domain = (addrOf(c.from).split('@')[1] || 'lunario.online').toLowerCase();
    const body = [
      `From: ${formatFrom(c.from)}`,
      `To: <${to}>`,
      `Subject: ${mimeWord(subject)}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${Date.now().toString(36)}.${randomBytes(8).toString('hex')}@${domain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text).replace(/(.{76})/g, '$1\r\n'),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(html).replace(/(.{76})/g, '$1\r\n'),
      `--${boundary}--`,
      '.',
    ].join('\r\n');
    await talk(sock, [250], body);
    await talk(sock, [221], 'QUIT').catch(() => {});   // письмо уже принято: молчание на QUIT - не ошибка
  } finally { sock.destroy(); }
}

/* Проверка авторизации без отправки письма: подключаемся, здороваемся,
   логинимся и вежливо выходим. Ошибка 535 ловится здесь, а не на живом пользователе. */
export async function verifySmtp() {
  const c = CFG();
  if (!mailReady()) return { ok: false, error: 'not_configured' };
  let sock = null;
  try {
    sock = await open(c, 10000, 25000);
    await talk(sock, [221], 'QUIT').catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { if (sock) sock.destroy(); }
}

/* Письмо с кодом входа — в стиле бренда, без обещаний и давления.
   Выглядит как обложка lunario.online: ночь, золото, луна со звёздами.
   Луна и «Лунарио» шрифтом Comfortaa — картинкой (веб-шрифты почта режет),
   лежит в site/assets/mail/ и грузится по абсолютному адресу.
   Верстка таблицами и inline-стилями; rgba и градиенты — с фолбэком
   через bgcolor/hex для клиентов на движке Word. */
const MAIL_ASSETS = 'https://lunario.online/app/assets/mail';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/* Письмо о новом доступе к рабочему кабинету — тот же визуальный язык, что у письма
   с кодом входа. Код в нём настоящий и рабочий 15 минут: приходит, когда админ
   назначает человеку роль, чтобы тот мог сразу войти в /app/cabinet. */
export function staffMail(roleNames, code) {
  const rolesLine = roleNames.join(', ');
  const text = `Вам открыли доступ к рабочему кабинету Лунарио: ${rolesLine}.\n\nВаш код для входа: ${code}\n\nОткройте lunario.online/app/cabinet, укажите эту почту и введите код. Код действует 15 минут — если он истечёт, на странице входа можно запросить новый.`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Доступ к кабинету Лунарио: ${code}</title></head>
<body style="margin:0;padding:0;background-color:#0b0a14;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0a14" style="background-color:#0b0a14;background-image:linear-gradient(180deg,#141126 0%,#0b0a14 70%)"><tr><td align="center" style="padding:24px 14px 36px">
  <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:440px;table-layout:fixed">
    <tr><td align="center" style="padding:0 0 4px">
      <img src="${MAIL_ASSETS}/header.png?v=1" width="440" height="210" alt="Лунарио" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:24px;font-weight:300;letter-spacing:.5px;color:#f5f2ea;text-align:center">
    </td></tr>
    <tr><td bgcolor="#1d1738" style="background-color:#1d1738;background-image:linear-gradient(135deg,#231c45 0%,#1d1738 50%,#1f193c 100%);border:1px solid #594b3d;border-color:rgba(217,184,104,.35);border-radius:24px;padding:34px 32px 32px">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#d9b868">Рабочий кабинет</p>
      <h1 style="margin:0 0 12px;font-family:${FONT};font-weight:600;font-size:26px;line-height:1.25;color:#f5f2ea">Вам открыли доступ</h1>
      <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:#cdc6e2">Кабинеты: <span style="color:#f0d79a">${rolesLine}</span></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:22px;background-color:rgba(217,184,104,.06)"><tr><td style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#34293e" style="border-radius:16px;background-color:rgba(217,184,104,.12);border:1px solid #6e5c4d;border-color:rgba(217,184,104,.35)"><tr>
          <td align="center" style="padding:20px 10px 20px 20px;font-family:${FONT};font-weight:600;font-size:40px;line-height:1.2;letter-spacing:10px;color:#f0d79a">${code}</td>
        </tr></table>
      </td></tr></table>
      <p style="margin:22px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#b9b2cf">Откройте <span style="color:#f0d79a">lunario.online/app/cabinet</span>, укажите эту почту и введите код — он действует 15 минут.</p>
      <p style="margin:16px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#8f87ad">Если это письмо неожиданно, просто удалите его: без кода ничего не произойдёт.</p>
    </td></tr>
    <tr><td align="center" style="padding:6px 0 0;line-height:0">
      <img src="${MAIL_ASSETS}/stars.png?v=1" width="440" height="56" alt="" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none">
    </td></tr>
    <tr><td align="center" style="padding:0">
      <span style="font-family:${FONT};font-size:12px;color:#8f87ad">lunario.online · данные хранятся в России</span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  return { subject: `Доступ к кабинету Лунарио: ${rolesLine}`, text, html };
}

export function loginMail(code) {
  const text = `Ваш код для входа в Лунарио: ${code}\n\nКод действует 15 минут. Если вы не запрашивали вход — просто удалите это письмо, ничего не произойдёт.`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Код входа в Лунарио: ${code}</title></head>
<body style="margin:0;padding:0;background-color:#0b0a14;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0a14" style="background-color:#0b0a14;background-image:linear-gradient(180deg,#141126 0%,#0b0a14 70%)"><tr><td align="center" style="padding:24px 14px 36px">
  <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:440px;table-layout:fixed">
    <tr><td align="center" style="padding:0 0 4px">
      <img src="${MAIL_ASSETS}/header.png?v=1" width="440" height="210" alt="Лунарио" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:24px;font-weight:300;letter-spacing:.5px;color:#f5f2ea;text-align:center">
    </td></tr>
    <tr><td bgcolor="#1d1738" style="background-color:#1d1738;background-image:linear-gradient(135deg,#231c45 0%,#1d1738 50%,#1f193c 100%);border:1px solid #594b3d;border-color:rgba(217,184,104,.35);border-radius:24px;padding:34px 32px 32px">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#d9b868">Вход в приложение</p>
      <h1 style="margin:0 0 20px;font-family:${FONT};font-weight:600;font-size:26px;line-height:1.25;color:#f5f2ea">Ваш код</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:22px;background-color:rgba(217,184,104,.06)"><tr><td style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#34293e" style="border-radius:16px;background-color:rgba(217,184,104,.12);border:1px solid #6e5c4d;border-color:rgba(217,184,104,.35)"><tr>
          <td align="center" style="padding:20px 10px 20px 20px;font-family:${FONT};font-weight:600;font-size:40px;line-height:1.2;letter-spacing:10px;color:#f0d79a">${code}</td>
        </tr></table>
      </td></tr></table>
      <p style="margin:22px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#b9b2cf">Код действует 15 минут. Введите его в приложении — записи, дневник и серия дней перенесутся на это устройство.</p>
      <p style="margin:16px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#8f87ad">Если вы не запрашивали вход, просто удалите это письмо: без кода ничего не произойдёт.</p>
    </td></tr>
    <tr><td align="center" style="padding:6px 0 0;line-height:0">
      <img src="${MAIL_ASSETS}/stars.png?v=1" width="440" height="56" alt="" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none">
    </td></tr>
    <tr><td align="center" style="padding:0">
      <span style="font-family:${FONT};font-size:12px;color:#8f87ad">lunario.online · данные хранятся в России</span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  return { subject: `Код входа в Лунарио: ${code}`, text, html };
}
