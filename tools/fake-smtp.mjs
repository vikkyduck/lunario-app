/* Поддельный SMTP для проверок (tools/check-mail.mjs): TLS-сервер на 127.0.0.1 и случайном порту, говорит как smtp.yandex.ru.
   Письма никуда не уходят — складываются в память, код вынимается из текста письма. Сценарий меняется на ходу (fake.mode = 'auth535'),
   поэтому одна проверка проходит «почта легла → поднялась» без перезапуска сервера приложения.
   Сертификат создается при каждом прогоне во временной папке (openssl): закрытого ключа в репозитории нет, и проверка TLS
   у клиента не выключается — сервер приложения доверяет ему через NODE_EXTRA_CA_CERTS только в процессе проверки.
   Сценарии — по опытам консилиума 16.10 (почтовый инженер, QA): на каждом из них прежний клиент висел или терял причину. */
import { createServer as tlsServer, TLSSocket, createSecureContext } from 'node:tls';
import { createServer as netServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EHLO = ['250-smtp.yandex.ru', '250-8BITMIME', '250-PIPELINING', '250-SIZE 53477376', '250-AUTH LOGIN PLAIN XOAUTH2', '250-DSN', '250 ENHANCEDSTATUSCODES'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* самоподписанный сертификат на localhost и 127.0.0.1; он же — свой центр сертификации для NODE_EXTRA_CA_CERTS */
export function makeTestCert(dir) {
  const key = join(dir, 'smtp-test.key'), cert = join(dir, 'smtp-test.crt');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'pipe' });
  } catch (e) { throw new Error(`fake-smtp: не получилось создать тестовый сертификат через openssl (${String(e.stderr || e.message).trim()}). Установите openssl — без него проверка почты не запускается.`); }
  return { key, cert };
}

/* how: 'whole' — одним куском; 'bytes' — по байту; 'lines' — строка за строкой с паузой */
async function send(sock, lines, how = 'whole') {
  const text = (Array.isArray(lines) ? lines : [lines]).map((l) => l + '\r\n').join('');
  if (sock.destroyed) return;
  if (how === 'whole') return void sock.write(text);
  /* по три байта без таймера на каждый: разрезанные ответы проверяем, а на занятой машине не упираемся в ускоренные сроки */
  if (how === 'bytes') { const b = Buffer.from(text); for (let i = 0; i < b.length; i += 3) { if (sock.destroyed) return; sock.write(b.subarray(i, i + 3)); await new Promise(setImmediate); } return; }
  for (const l of text.split(/(?<=\r\n)/)) { if (sock.destroyed) return; sock.write(l); await wait(20); }
}
const closeNow = (sock) => sock.end();
const silent = () => {};
/* подмены на шагах диалога: greet, ehlo, auth, user, pass, mail, rcpt, data, dot, rset, quit → строка-ответ или функция(sock) */
const MODES = {
  ok: {},
  bytes: { how: 'bytes' },
  lines: { how: 'lines' },
  multiline_greet: { at: { greet: ['220-smtp.yandex.ru ESMTP', '220 ready'] } },
  auth535: { at: { pass: '535 5.7.8 Error: authentication failed: Invalid user or password!' } },
  auth454: { at: { pass: '454 4.7.0 Too many login attempts, please try later' } },
  greet421: { at: { greet: async (s) => { await send(s, '421 4.3.2 Service not available, closing transmission channel'); s.end(); } } },
  close_no_greeting: { at: { greet: closeNow } },
  close_after_ehlo: { at: { ehlo: closeNow } },
  close_after_pass: { at: { pass: closeNow } },
  silent: { at: { greet: silent } },
  /* приветствие по байту раз в 150 мс, бесконечно: таймер тишины не срабатывает, нужен общий срок */
  trickle: { at: { greet: async (s) => { while (!s.destroyed) { s.write('2'); await wait(150); } } } },
  mailfrom553: { at: { mail: '553 5.7.1 Sender address rejected: not owned by auth user.' } },
  /* как у многих настоящих серверов — с адресом в ответе: в журнал сбоев он должен попасть замаскированным */
  rcpt550: { at: { rcpt: (s, line) => send(s, `550 5.1.1 <${(String(line).match(/<([^>]+)>/) || [])[1] || ''}>: Recipient address rejected`) } },
  /* переполненный ящик ОДНОГО получателя: раньше слово «limit» в ответе закрывало вход всем на 6 часов (ревью 16.10) */
  rcpt552: { at: { rcpt: '552 5.2.2 Mailbox size limit exceeded' } },
  dot553: { at: { dot: '553 5.7.1 Sender address rejected: not owned by auth user.' } },
  /* сервер, который повторяет принятую строку в отказе: base64 пароля не должен попасть в журнал */
  auth535_echo: { at: { pass: (s, line) => send(s, `535 5.7.8 Error: authentication failed: ${line}`) } },
  /* отказ пароля с задержкой: пока первые два письма ждут ответа, остальные стоят в очереди */
  auth535_slow: { at: { pass: async (s) => { await wait(300); await send(s, '535 5.7.8 Error: authentication failed: Invalid user or password!'); } } },
  /* не SMTP на этом порту (IMAP на 993): ошибка настройки должна быть видна сразу, а не после таймера тишины */
  imap: { at: { greet: '* OK Yandex IMAP4rev1 at mail ready to rock' } },
  /* молчит на QUIT, не закрывая соединение */
  quit_silent: { at: { quit: () => {} } },
  rcpt451: { at: { rcpt: '451 4.7.1 Sorry, the service is currently unavailable. Please come back later.' } },
  data554: { at: { dot: '554 5.7.1 [2] Message rejected under suspicion of SPAM; https://ya.cc/1IrBc 1700000000-abc' } },
  close_after_dot: { at: { dot: closeNow } },
  quit_no_reply: { at: { quit: closeNow } },
  /* соединение принято и тут же сброшено — «почтовый сервер недоступен» без ожидания таймаута */
  refuse: { refuse: true },
};

/* cert — { key, cert } из makeTestCert: его же процесс проверки отдает серверу приложения в NODE_EXTRA_CA_CERTS */
export async function startFakeSmtp({ cert: files, mode = 'ok', starttls = false }) {
  const { key, cert } = files;
  const TLS = { key: readFileSync(key), cert: readFileSync(cert) };
  const fake = { mode, letters: [], connections: 0, active: 0, maxActive: 0, log: [], certFile: cert, port: 0 };

  function dialog(sock) {
    const o = MODES[fake.mode] || MODES.ok, how = o.how || 'whole', at = o.at || {};
    fake.connections++; fake.active++; fake.maxActive = Math.max(fake.maxActive, fake.active);
    sock.once('close', () => { fake.active--; });
    if (o.refuse) { sock.destroy(); return; }
    let buf = '', inData = false, authStage = 0, letter = null;
    const act = async (name, def, line) => { fake.log.push(name); const a = at[name]; if (typeof a === 'function') return a(sock, line); return send(sock, a !== undefined ? a : def, how); };
    if (!sock.noGreet) act('greet', '220 smtp.yandex.ru ESMTP fake');
    sock.on('data', async (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; fake.letters.push(letter); await act('dot', '250 2.0.0 Ok: queued on fake'); }
          else letter.lines.push(line);
          continue;
        }
        const up = line.toUpperCase();
        if (authStage === 1) { authStage = 2; await act('user', '334 UGFzc3dvcmQ6'); continue; }
        if (authStage === 2) { authStage = 0; await act('pass', '235 2.7.0 Authentication successful.', line); continue; }
        if (up.startsWith('EHLO')) await act('ehlo', EHLO);
        else if (up.startsWith('AUTH LOGIN')) { authStage = 1; await act('auth', '334 VXNlcm5hbWU6'); }
        else if (up.startsWith('MAIL FROM')) { letter = { from: line.slice(10), to: '', lines: [] }; await act('mail', '250 2.1.0 <sender> ok'); }
        else if (up.startsWith('RCPT TO')) { letter.to = (line.match(/<([^>]+)>/) || [])[1] || ''; await act('rcpt', '250 2.1.5 <rcpt> recipient ok', line); }
        else if (up === 'DATA') { inData = true; await act('data', '354 Enter mail, end with "." on a line by itself'); }
        else if (up === 'RSET') { letter = null; await act('rset', '250 2.0.0 Ok'); }
        else if (up === 'QUIT') { if (at.quit) { await act('quit'); } else { await act('quit', '221 2.0.0 Closing connection.'); sock.end(); } }
        else await send(sock, '502 5.5.2 Syntax error, command unrecognized.');
      }
    });
  }

  let srv;
  const sockets = new Set();
  if (!starttls) {
    srv = tlsServer(TLS, (sock) => { sock.on('error', () => {}); dialog(sock); });
    srv.on('tlsClientError', () => {});
  } else {
    /* 587: открытый текст, EHLO с STARTTLS, затем TLS поверх того же соединения */
    const ctx = createSecureContext(TLS);
    srv = netServer((raw) => {
      raw.on('error', () => {});
      raw.write('220 smtp.yandex.ru ESMTP fake\r\n');
      let b = '';
      const onD = (d) => { b += d; if (!b.includes('\r\n')) return; const line = b.trim(); b = '';
        if (/^EHLO/i.test(line)) raw.write('250-smtp.yandex.ru\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN\r\n');
        else if (/^STARTTLS/i.test(line)) { raw.off('data', onD); raw.write('220 Go ahead\r\n'); const t = new TLSSocket(raw, { isServer: true, secureContext: ctx }); t.on('error', () => {}); t.noGreet = true; t.on('secure', () => dialog(t)); }
        else raw.write('530 5.7.0 Must issue a STARTTLS command first\r\n'); };
      raw.on('data', onD);
    });
  }
  srv.on('connection', (s) => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  fake.port = srv.address().port;

  /* текст письма (text/plain) и шестизначный код из него */
  fake.textOf = (letter) => {
    const lines = letter.lines, i = lines.findIndex((l) => /^Content-Type: text\/plain/i.test(l));
    if (i < 0) return '';
    const start = lines.indexOf('', i) + 1, end = lines.findIndex((l, j) => j > start && l.startsWith('--'));
    return Buffer.from(lines.slice(start, end).join(''), 'base64').toString('utf8');
  };
  fake.headersOf = (letter) => letter.lines.slice(0, letter.lines.indexOf(''));
  fake.lastTo = (email) => [...fake.letters].reverse().find((l) => l.to === email);
  fake.codeFor = (email) => { const l = fake.lastTo(email); const m = l && fake.textOf(l).match(/\b(\d{6})\b/); return m ? m[1] : ''; };
  fake.close = () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()); });
  return fake;
}
