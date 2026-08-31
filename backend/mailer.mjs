/* Отправка почты по SMTP без зависимостей: node:tls + разговор с сервером руками.
   Настройки — из окружения (файл /opt/lunario-app/.env, читается systemd):
     SMTP_HOST=smtp.yandex.ru  SMTP_PORT=465  SMTP_USER=vu@vi-utkina.ru
     SMTP_PASS=<пароль приложения>  SMTP_FROM="Лунарио <vu@withoutwater.ru>"
   Пароль приложения создаётся в id.yandex.ru → Безопасность → Пароли приложений
   и доступа к самому ящику не даёт. */
import { connect } from 'node:tls';

const CFG = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  sender: process.env.SMTP_SENDER || process.env.SMTP_USER || '',   // адрес в конверте
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',        // что видит получатель
});
export const mailReady = () => { const c = CFG(); return !!(c.host && c.user && c.pass); };

function talk(sock, expect, line) {
  return new Promise((res, rej) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString('utf8');
      if (!/\r\n$/.test(buf)) return;                       // ждём конца ответа
      const last = buf.trim().split('\r\n').pop();
      if (/^\d{3}-/.test(last)) return;                     // многострочный ответ ещё не закончен
      sock.off('data', onData); sock.off('error', rej);
      const code = Number(buf.slice(0, 3));
      if (expect && !expect.includes(code)) return rej(new Error(`SMTP ${code}: ${buf.trim().slice(0, 120)}`));
      res(buf);
    };
    sock.on('data', onData);
    sock.once('error', rej);
    if (line !== undefined) sock.write(line + '\r\n');
  });
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
/* Тема письма по RFC 2047: кириллица иначе приедет крокозябрами */
const mimeWord = (s) => `=?UTF-8?B?${b64(s)}?=`;
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

export async function sendMail({ to, subject, text, html }) {
  const c = CFG();
  if (!mailReady()) throw new Error('smtp_not_configured');
  const sock = connect({ host: c.host, port: c.port, servername: c.host });
  sock.setTimeout(15000, () => sock.destroy(new Error('smtp_timeout')));
  try {
    await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j); });
    await talk(sock, [220]);
    await talk(sock, [250], 'EHLO lunario.online');
    await talk(sock, [334], 'AUTH LOGIN');
    await talk(sock, [334], b64(c.user));
    await talk(sock, [235], b64(c.pass));
    await talk(sock, [250], `MAIL FROM:<${c.sender}>`);
    await talk(sock, [250, 251], `RCPT TO:<${to}>`);
    await talk(sock, [354], 'DATA');
    const boundary = 'lun' + Math.random().toString(36).slice(2);
    const body = [
      `From: ${formatFrom(c.from)}`,
      `To: <${to}>`,
      `Subject: ${mimeWord(subject)}`,
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
    await talk(sock, [221], 'QUIT');
  } finally { sock.destroy(); }
}

/* Проверка авторизации без отправки письма: подключаемся, здороваемся,
   логинимся и вежливо выходим. Ошибка 535 ловится здесь, а не на живом пользователе. */
export async function verifySmtp() {
  const c = CFG();
  if (!mailReady()) return { ok: false, error: 'not_configured' };
  const sock = connect({ host: c.host, port: c.port, servername: c.host });
  sock.setTimeout(10000, () => sock.destroy(new Error('smtp_timeout')));
  try {
    await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j); });
    await talk(sock, [220]);
    await talk(sock, [250], 'EHLO lunario.online');
    await talk(sock, [334], 'AUTH LOGIN');
    await talk(sock, [334], b64(c.user));
    await talk(sock, [235], b64(c.pass));
    await talk(sock, [221], 'QUIT');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { sock.destroy(); }
}

/* Письмо с кодом входа — в стиле бренда, без обещаний и давления */
export function loginMail(code) {
  const text = `Ваш код для входа в Лунарио: ${code}\n\nКод действует 15 минут. Если вы не запрашивали вход — просто удалите это письмо, ничего не произойдёт.`;
  const html = `<!doctype html><html><body style="margin:0;background:#070510;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070510"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:440px;max-width:440px">
    <tr><td align="center" style="padding-bottom:18px">
      <span style="font-family:Georgia,serif;font-size:21px;color:#f8f6ff">&#9790;&nbsp;Лунарио</span>
    </td></tr>
    <tr><td style="background:#140e2b;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:32px 30px">
      <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#b07cff">Вход в приложение</p>
      <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.25;color:#f8f6ff">Ваш код</h1>
      <div style="font-family:Georgia,serif;font-size:40px;letter-spacing:10px;color:#e8d8a8;background:rgba(255,255,255,.05);border-radius:14px;padding:18px 10px;text-align:center">${code}</div>
      <p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#bdb6d7">Код действует 15 минут. Введите его в приложении — записи, дневник и серия дней перенесутся на это устройство.</p>
      <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#8f87a5">Если вы не запрашивали вход, просто удалите это письмо: без кода ничего не произойдёт.</p>
    </td></tr>
    <tr><td align="center" style="padding-top:16px">
      <span style="font-family:Arial,sans-serif;font-size:12px;color:#7d7593">lunario.online · данные хранятся в России</span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  return { subject: `Код входа в Лунарио: ${code}`, text, html };
}
