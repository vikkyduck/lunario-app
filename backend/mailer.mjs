/* Отправка почты по SMTP без зависимостей: node:tls (node:net для STARTTLS) + разговор с сервером руками.
   Настройки — из окружения (файл /opt/lunario-app/.env, читается systemd):
     SMTP_HOST=smtp.yandex.ru  SMTP_PORT=465  SMTP_USER=you@example.ru
     SMTP_PASS=<пароль приложения>  SMTP_FROM="Лунарио <hello@example.ru>"
   Необязательные: SMTP_SENDER — адрес в конверте (по умолчанию SMTP_USER); SMTP_SECURE=tls|starttls
   (по умолчанию tls, для порта 587 — starttls); SMTP_TLS_NAME — имя из сертификата, если в SMTP_HOST записан IP.
   Пароль приложения создается в id.yandex.ru → Безопасность → Пароли приложений
   и доступа к самому ящику не дает.

   Почему клиент устроен так (консилиум 16.10, после того как вход по почте лежал на проде):
   — один читатель на соединение: закрытие, обрыв и ошибка отклоняют ожидающий ответ. Прежний talk() не слушал
     'close'/'end', и проверка при старте висела навсегда, если сервер закрыл соединение молча;
   — у разговора общий срок, а не только таймер тишины: сервер, отвечающий по байту, тоже не держит запрос вечно;
   — каждая ошибка — SmtpError с этапом и видом сбоя (kind): от вида зависит, когда перепроверять почту
     (mail-state.mjs) и что написать в журнале. Пустых причин больше нет: AggregateError (все адреса хоста
     недоступны, IPv4 и IPv6) раскрывается в список, а не в «()»;
   — опечатка в .env (порт, IP вместо имени) — состояние «не настроена», а не падение всего сервера;
   — проверка доходит до MAIL FROM и сбрасывается RSET: «адрес отправителя не принадлежит ящику» ловится до людей;
   — QUIT после принятого письма необязателен: 250 после точки и есть «отправлено»;
   — строки разговора никогда не попадают в ошибки и журналы: AUTH LOGIN — это base64 от логина и пароля. */
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, isIP } from 'node:net';
import { randomBytes } from 'node:crypto';

const CFG = () => {
  const host = (process.env.SMTP_HOST || '').trim(), port = Number(process.env.SMTP_PORT || 465);
  return {
    host, port,
    secure: (process.env.SMTP_SECURE || (port === 587 ? 'starttls' : 'tls')).trim().toLowerCase(),
    /* имя, по которому проверяется сертификат: у IP его нет, и проверку TLS не выключаем ни в какой ветке */
    tlsName: (process.env.SMTP_TLS_NAME || '').trim() || (isIP(host) ? '' : host),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    sender: process.env.SMTP_SENDER || process.env.SMTP_USER || '',   // адрес в конверте
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',        // что видит получатель
  };
};
/* настроена ли почта вообще: есть сервер, логин и пароль */
export const mailConfigured = () => { const c = CFG(); return !!(c.host && c.user && c.pass); };
export const NOT_CONFIGURED = 'почта не настроена (нет SMTP_HOST, SMTP_USER или SMTP_PASS)';
/* что не так в настройках — или '' */
export function configProblem() {
  const c = CFG();
  if (!mailConfigured()) return NOT_CONFIGURED;
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return `SMTP_PORT=${process.env.SMTP_PORT} — нужен номер порта 1–65535`;
  if (!['tls', 'starttls'].includes(c.secure)) return `SMTP_SECURE=${c.secure} — нужно tls или starttls`;
  if (!c.tlsName) return 'SMTP_HOST записан IP-адресом — укажите SMTP_TLS_NAME (имя из сертификата, например smtp.yandex.ru)';
  return '';
}

/* Сроки — в проверках их можно ускорить (MAIL_TIME_SCALE), но только вместе с LUNARIO_TEST=1:
   опечатка в .env прода не заставит сервер долбить почтовый ящик без пауз */
export const timeScale = () => {
  const s = Number(process.env.MAIL_TIME_SCALE);
  return process.env.LUNARIO_TEST === '1' && s > 0 && s < 1 ? s : 1;
};
const ms = (n) => Math.max(50, Math.round(n * timeScale()));

/* Адреса в тексте ошибки — в виде v***@domain: журнал сбоев видят роли admin и product */
export const maskEmails = (s) => String(s || '').replace(/([^\s<>"'@:;,]+)@([^\s<>"';,]+)/g, (_, u, dom) => `${u.slice(0, 1)}***@${dom}`);

export class SmtpError extends Error {
  constructor(stage, kind, text, code = 0) { super(`${stage}: ${text}`); this.stage = stage; this.kind = kind; this.smtpCode = code; this.bodySent = false; }
}
const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME|ERR_SSL|EPROTO/;
const netText = (e) => e && Array.isArray(e.errors) && e.errors.length
  ? e.errors.map((x) => `${x.code || x.message} ${x.address || ''}:${x.port || ''}`).join(', ')
  : (e && (e.message || e.code)) || String(e);
const netKind = (e) => TLS_CODES.test(String(e && e.code)) || /certificate|wrong version number/i.test(String(e && e.message)) ? 'tls' : 'net';
/* Вид сбоя по этапу и коду ответа. net/temp проходят сами — их перепроверяют по нарастающей; auth/sender/tls/server
   сами не проходят — перепроверка редкая, чтобы частые неудачные входы не выглядели для Яндекса подбором пароля.
   recipient и rejected — дело ОДНОГО письма: ответ на RCPT (нет адреса, ящик получателя полон, грейлистинг) и отказ
   текста письма. По свободному тексту ответа их не обобщаем: раньше «552 Mailbox size limit exceeded» одного получателя
   читалось как «лимит Яндекса» и закрывало вход всем на 6 часов — и посторонний мог делать это нарочно (ревью 16.10).
   Общий сбой из отказа текста — только «отправитель не принадлежит ящику» (553 / sender / not owned) */
const SENDER = /sender|not owned/i;
function kindOf(stage, code, text) {
  if (stage === 'auth') return 'auth';                                     // 535/534/530, 454 — пароль, доступ по протоколам, блокировка ящика
  if (stage === 'rcpt') return 'recipient';
  if (stage === 'mail_from') return code >= 500 ? 'sender' : 'temp';     // 553 not owned by auth user
  if (stage === 'body') return code >= 500 && (code === 553 || SENDER.test(text)) ? 'sender' : 'rejected';
  return code >= 400 && code < 500 ? 'temp' : 'server';
}

/* Ответ сервера без наших секретов: сервер, который повторяет принятую строку («535 … failed: <строка>»), иначе вынес бы
   base64 логина и пароля в журнал сбоев и journalctl. Вырезаем и сами значения, и их base64 */
const scrub = (text, secrets) => secrets.filter((v) => v && v.length >= 6).reduce((t, v) => t.split(v).join('***'), text);   /* короткие значения не трогаем: «u» вырезало бы полтекста */
/* Один разговор с SMTP: один читатель ответов на все соединение, общий срок и таймер тишины.
   deadline — общий момент «до»: после STARTTLS вторая половина разговора не получает срок заново */
function session(sock, { idleMs, deadline, secrets = [] }) {
  const totalMs = Math.max(50, deadline - Date.now());
  let buf = '', waiter = null, dead = null, stage = 'connect';
  const fail = (e) => { if (!dead) dead = e; if (waiter) { const w = waiter; waiter = null; w.rej(dead); } };
  const total = setTimeout(() => { fail(new SmtpError(stage, 'net', `разговор не уложился в ${totalMs} мс`)); sock.destroy(); }, totalMs);
  sock.setTimeout(idleMs, () => { fail(new SmtpError(stage, 'net', `нет ответа ${idleMs} мс`)); sock.destroy(); });
  const onData = (d) => { buf += d.toString('utf8'); pump(); };
  const onError = (e) => fail(new SmtpError(stage, netKind(e), netText(e)));
  const onClose = () => fail(new SmtpError(stage, 'net', 'сервер закрыл соединение без ответа'));
  sock.on('data', onData); sock.on('error', onError); sock.on('end', onClose); sock.on('close', onClose);
  function pump() {
    if (!waiter) return;
    const m = buf.match(/^(?:\d{3}-[^\n]*\n)*\d{3}(?:[ \t][^\n]*)?\r?\n/);    // полный ответ, в том числе многострочный
    if (!m) {
      /* законченная строка не по SMTP (IMAP на 993, прокси со своим приветствием) — ошибка настройки сразу, а не таймер тишины */
      const line = buf.includes('\n') ? buf.split('\n')[0] : '';
      if (line && !/^\d{3}([ \t-]|\r?$)/.test(line)) fail(new SmtpError(stage, 'server', `сервер ответил не по SMTP: «${scrub(line.trim(), secrets).slice(0, 60)}»`));
      return;
    }
    buf = buf.slice(m[0].length);
    const w = waiter; waiter = null; w.res(m[0]);
  }
  const reply = () => new Promise((res, rej) => { if (dead) return rej(dead); waiter = { res, rej }; pump(); });
  async function cmd(name, expect, line) {
    stage = name;
    if (dead) throw dead;
    if (line !== undefined) sock.write(line + '\r\n');
    const r = await reply();
    const code = Number(r.slice(0, 3));
    const text = scrub(r.trim().replace(/\r?\n/g, ' | '), secrets).slice(0, 200);   // текст ответа сервера, не наша строка
    if (!expect.includes(code)) throw new SmtpError(name, kindOf(name, code, text), `SMTP ${text}`, code);
    return r;
  }
  /* QUIT — вежливость, а не условие: ответа ждем не дольше секунды. Письмо уже принято, слот очереди и человек не ждут
     таймер тишины, если сервер молчит на QUIT (ревью 16.10) */
  async function quit() {
    stage = 'quit';
    if (dead) return;
    sock.write('QUIT\r\n');
    let t; await Promise.race([reply().catch(() => {}), new Promise((r) => { t = setTimeout(r, ms(1000)); })]); clearTimeout(t);
  }
  /* отцепиться от сокета: после STARTTLS дальше говорит TLS-обертка */
  const detach = () => { clearTimeout(total); sock.setTimeout(0); sock.off('data', onData); sock.off('error', onError); sock.off('end', onClose); sock.off('close', onClose); };
  const close = () => { detach(); sock.destroy(); };
  return { cmd, quit, close, detach, failure: () => dead };
}

/* дождаться соединения (или TLS-рукопожатия); если раньше сработал срок сессии — его причина, а не «закрыто» */
const opened = (sock, ev, s) => new Promise((res, rej) => {
  const off = () => { sock.off(ev, ok); sock.off('error', bad); sock.off('close', gone); };
  const ok = () => { off(); res(); };
  const bad = (e) => { off(); rej(new SmtpError('connect', netKind(e), netText(e))); };
  const gone = () => { off(); rej(s.failure() || new SmtpError('connect', 'net', 'соединение закрыто до рукопожатия')); };
  sock.once(ev, ok); sock.once('error', bad); sock.once('close', gone);
});

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/* Не больше двух разговоров с SMTP одновременно: всплеск запросов кода не открывает десятки входов в ящик
   (на такое Яндекс отвечает 421 и временной блокировкой). Очередь короткая — лишним сразу «занято». */
const MAX_SESSIONS = 2, MAX_QUEUE = 30;
let active = 0;
const queue = [];
async function slot() {
  if (active < MAX_SESSIONS) { active++; return; }
  if (queue.length >= MAX_QUEUE) throw new SmtpError('queue', 'busy', 'очередь к почтовому серверу занята');
  await new Promise((res, rej) => {
    const t = setTimeout(() => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1); rej(new SmtpError('queue', 'busy', 'очередь к почтовому серверу не продвинулась')); }, ms(20000));
    const entry = () => { clearTimeout(t); res(); };
    queue.push(entry);
  });
}
const release = () => { const next = queue.shift(); if (next) next(); else active--; };
async function withSlot(fn) { await slot(); try { return await fn(); } finally { release(); } }

/* открыть соединение, поздороваться и войти. limits: { idleMs, totalMs } — общий срок считается один раз */
async function login(c, { idleMs, totalMs }) {
  const limits = { idleMs, deadline: Date.now() + totalMs, secrets: [c.user, c.pass, b64(c.user), b64(c.pass)] };
  let raw;
  try { raw = c.secure === 'tls' ? tlsConnect({ host: c.host, port: c.port, servername: c.tlsName }) : netConnect({ host: c.host, port: c.port }); }
  catch (e) { throw new SmtpError('connect', 'config', e.message); }
  raw.on('error', () => {});                         // запасной слушатель: ошибка после закрытия не уронит процесс
  let s = session(raw, limits);
  try {
    await opened(raw, c.secure === 'tls' ? 'secureConnect' : 'connect', s);
    await s.cmd('greeting', [220]);
    await s.cmd('ehlo', [250], 'EHLO lunario.online');
    if (c.secure === 'starttls') {
      await s.cmd('starttls', [220], 'STARTTLS');
      s.detach();
      const t = tlsConnect({ socket: raw, servername: c.tlsName });
      t.on('error', () => {});
      s = session(t, limits);
      await opened(t, 'secureConnect', s);
      await s.cmd('ehlo', [250], 'EHLO lunario.online');
    }
    await s.cmd('auth', [334], 'AUTH LOGIN');
    await s.cmd('auth', [334], b64(c.user));
    await s.cmd('auth', [235], b64(c.pass));
    return s;
  } catch (e) { s.close(); raw.destroy(); throw e; }
}

/* Тема и имя отправителя по RFC 2047: кириллица иначе приедет крокозябрами. Слова не длиннее 75 символов,
   между ними перенос строки — длинная тема письма об удалении иначе ломает строку заголовка */
const mimeWords = (s) => {
  const out = []; let cur = '';
  for (const ch of String(s)) { if (Buffer.byteLength(cur + ch) > 42) { out.push(cur); cur = ''; } cur += ch; }
  if (cur) out.push(cur);
  return out.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
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
  return `${/^[\x20-\x7E]*$/.test(name) ? name : mimeWords(name)} <${addr}>`;
};
const addrOf = (raw) => { const m = String(raw).match(/<([^>]+)>/); return (m ? m[1] : String(raw)).trim(); };

/* Письмо уходит или бросает SmtpError — других исключений наружу нет.
   bodySent=true у ошибки значит: текст письма уже передан, а ответа не дождались — письмо могло дойти.
   gate() — спросить состояние почты еще раз, когда очередь дошла: пока письмо ждало, первое из очереди могло получить 535,
   и остальные не должны входить в ящик с неверным паролем (ревью 16.10). settle(err|null) — сообщить исход ДО того, как
   место в очереди перейдет следующему письму: иначе следующее успевало спросить gate() раньше, чем узнали про 535 */
export async function sendMail({ to, subject, text, html, gate = null, settle = () => {} }) {
  const bad = configProblem();
  if (bad) throw new SmtpError('config', 'config', bad);
  const c = CFG();
  return withSlot(async () => {
    if (gate && !gate()) { const e = new SmtpError('queue', 'gated', 'почта перестала работать, пока письмо ждало очереди'); settle(e); throw e; }
    let s;
    try {
      s = await login(c, { idleMs: ms(15000), totalMs: ms(30000) });
      await s.cmd('mail_from', [250], `MAIL FROM:<${c.sender}>`);
      await s.cmd('rcpt', [250, 251], `RCPT TO:<${to}>`);
      await s.cmd('data', [354], 'DATA');
      const boundary = 'lun' + randomBytes(9).toString('hex');
      const domain = addrOf(c.from).split('@')[1] || 'lunario.online';
      const body = [
        `From: ${formatFrom(c.from)}`,
        `To: <${to}>`,
        `Subject: ${mimeWords(subject)}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${Date.now().toString(36)}.${randomBytes(8).toString('hex')}@${domain}>`,
        'Auto-Submitted: auto-generated',
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(text).replace(/(.{76})(?=.)/g, '$1\r\n'),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(html).replace(/(.{76})(?=.)/g, '$1\r\n'),
        `--${boundary}--`,
        '.',
      ].join('\r\n');
      try { await s.cmd('body', [250], body); }
      catch (e) { if (e instanceof SmtpError && e.kind === 'net') e.bodySent = true; throw e; }
      settle(null);
      await s.quit();   /* письмо уже принято — молчание на QUIT не ошибка */
      return { ok: true };
    } catch (e) {
      const err = e instanceof SmtpError ? e : new SmtpError('connect', 'net', netText(e));
      settle(err); throw err;
    } finally { if (s) s.close(); }
  });
}

/* Проверка без письма: вход, MAIL FROM и RSET — письмо не создается, но ловятся и 535 (пароль), и 553
   (отправитель не принадлежит ящику). Никогда не бросает: всегда { ok } или { ok:false, kind, stage, error } */
export async function verifySmtp() {
  const bad = configProblem();
  if (bad) return { ok: false, kind: 'config', stage: 'config', error: bad };
  const c = CFG();
  try {
    return await withSlot(async () => {
      let s;
      try {
        s = await login(c, { idleMs: ms(10000), totalMs: ms(20000) });
        await s.cmd('mail_from', [250], `MAIL FROM:<${c.sender}>`);
        await s.cmd('rset', [250], 'RSET');
        await s.quit();   /* вход и отправитель уже проверены */
        return { ok: true };
      } finally { if (s) s.close(); }
    });
  } catch (e) {
    return { ok: false, kind: e.kind || netKind(e), stage: e.stage || 'connect', error: e instanceof SmtpError ? e.message : netText(e) };
  }
}

/* Письмо с кодом входа — в стиле бренда, без обещаний и давления.
   Выглядит как обложка lunario.online: ночь, золото, луна со звездами.
   Луна и «Лунарио» шрифтом Comfortaa — картинкой (веб-шрифты почта режет),
   лежит в site/assets/mail/ и грузится по абсолютному адресу.
   Верстка таблицами и inline-стилями; rgba и градиенты — с фолбэком
   через bgcolor/hex для клиентов на движке Word. */
const MAIL_ASSETS = 'https://lunario.online/app/assets/mail';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/* Письмо о новом доступе к рабочему кабинету — тот же визуальный язык, что у письма
   с кодом входа. Код в нем настоящий и рабочий 15 минут: приходит, когда админ
   назначает человеку роль, чтобы тот мог сразу войти в /app/cabinet. */
export function staffMail(roleNames, code) {
  const rolesLine = roleNames.join(', ');
  const text = `Вам открыли доступ к рабочему кабинету Лунарио: ${rolesLine}.\n\nВаш код для входа: ${code}\n\nОткройте lunario.online/app/cabinet, укажите эту почту и введите код. Код действует 15 минут — если он истечет, на странице входа можно запросить новый.`;
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
      <p style="margin:16px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#8f87ad">Если это письмо неожиданно, просто удалите его: без кода ничего не произойдет.</p>
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

/* Подтверждение удаления аккаунта. Отдельное письмо и отдельная цель кода: код из этого письма
   не открывает вход, а код входа не удаляет аккаунт. Тон спокойный, без запугивания — но прямо
   сказано, что произойдет и что делать, если человек этого не просил. */
export function deleteMail(code) {
  const text = `Код для подтверждения удаления аккаунта Лунарио: ${code}\n\nПосле ввода кода будут удалены профиль, дневник, желания, привычки, аскезы, настроения, история вопросов и переписка с поддержкой. Восстановить их будет нельзя.\n\nКод действует 15 минут. Если вы не запрашивали удаление — просто удалите это письмо, с аккаунтом ничего не произойдет.`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Подтверждение удаления аккаунта Лунарио</title></head>
<body style="margin:0;padding:0;background-color:#0b0a14;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0a14" style="background-color:#0b0a14;background-image:linear-gradient(180deg,#141126 0%,#0b0a14 70%)"><tr><td align="center" style="padding:24px 14px 36px">
  <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:440px;table-layout:fixed">
    <tr><td align="center" style="padding:0 0 4px">
      <img src="${MAIL_ASSETS}/header.png?v=1" width="440" height="210" alt="Лунарио" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:24px;font-weight:300;letter-spacing:.5px;color:#f5f2ea;text-align:center">
    </td></tr>
    <tr><td bgcolor="#1d1738" style="background-color:#1d1738;background-image:linear-gradient(135deg,#231c45 0%,#1d1738 50%,#1f193c 100%);border:1px solid #594b3d;border-color:rgba(217,184,104,.35);border-radius:24px;padding:34px 32px 32px">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#d9b868">Удаление аккаунта</p>
      <h1 style="margin:0 0 20px;font-family:${FONT};font-weight:600;font-size:26px;line-height:1.25;color:#f5f2ea">Код подтверждения</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:22px;background-color:rgba(217,184,104,.06)"><tr><td style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#34293e" style="border-radius:16px;background-color:rgba(217,184,104,.12);border:1px solid #6e5c4d;border-color:rgba(217,184,104,.35)"><tr>
          <td align="center" style="padding:20px 10px 20px 20px;font-family:${FONT};font-weight:600;font-size:40px;line-height:1.2;letter-spacing:10px;color:#f0d79a">${code}</td>
        </tr></table>
      </td></tr></table>
      <p style="margin:22px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#b9b2cf">После ввода кода будут удалены профиль, дневник, желания, привычки, аскезы, настроения, история вопросов и переписка с поддержкой. Восстановить их будет нельзя.</p>
      <p style="margin:16px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#8f87ad">Если вы не запрашивали удаление, просто удалите это письмо: без кода с аккаунтом ничего не произойдет.</p>
    </td></tr>
    <tr><td align="center" style="padding:6px 0 0;line-height:0">
      <img src="${MAIL_ASSETS}/stars.png?v=1" width="440" height="56" alt="" style="display:block;width:100%;max-width:440px;height:auto;border:0;outline:none">
    </td></tr>
    <tr><td align="center" style="padding:0">
      <span style="font-family:${FONT};font-size:12px;color:#8f87ad">lunario.online · данные хранятся в России</span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  return { subject: `Подтверждение удаления аккаунта Лунарио: ${code}`, text, html };
}

export function loginMail(code) {
  const text = `Ваш код для входа в Лунарио: ${code}\n\nКод действует 15 минут. Если вы не запрашивали вход — просто удалите это письмо, ничего не произойдет.`;
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
      <p style="margin:16px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#8f87ad">Если вы не запрашивали вход, просто удалите это письмо: без кода ничего не произойдет.</p>
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
