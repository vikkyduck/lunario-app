/* Почта входа по коду — проверка с поддельным SMTP (tools/fake-smtp.mjs), без настоящих писем и секретов.

   Зачем (консилиум 16.10): вход по почте лежал на проде больше недели, а все проверки были зеленые — они шли без SMTP,
   считали «почта выключена» нормой и подменяли mailReady:true в браузере. Путь «почта включена» не проходил никто.
   Здесь — три слоя:
     1) mailer.mjs напрямую против поддельного сервера: ни один сценарий не висит, у каждой ошибки есть этап и вид сбоя;
     2) mail-state.mjs с подставной проверкой: расписание, пробная попытка, «отказ адреса флаг не трогает», срок проверки;
     3) настоящий backend/server.mjs: в том числе авария с прода — почта лежала при запуске и ожила, вход включается сам.
   Сроки ускорены (LUNARIO_TEST=1 + MAIL_TIME_SCALE): без LUNARIO_TEST рабочий код ускорение не принимает.
   Сертификат создается на прогон (openssl); NODE_EXTRA_CA_CERTS читается Node только при запуске, поэтому проверка
   перезапускает сама себя дочерним процессом.   node tools/check-mail.mjs */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { get as httpGet } from 'node:http';
import { makeTestCert, startFakeSmtp } from './fake-smtp.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const SCALE = '0.05';

/* запуск — в конце файла: вспомогательные функции ниже объявлены через const */


/* шаг с пределом времени: зависание — провал с названием, а не тихий таймаут всего прогона */
async function within(ms, what, p) {
  let t; const guard = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`ЗАВИСЛО дольше ${ms} мс: ${what}`)), ms); });
  try { return await Promise.race([p, guard]); } finally { clearTimeout(t); }
}
const freePort = async () => { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
/* MAIL_CHECK_VERBOSE=1 — печатать шаги: где именно застряло */
const step = (what) => { if (process.env.MAIL_CHECK_VERBOSE === '1') console.error(`· ${what}`); };
const until = async (what, ms, fn) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`не дождались за ${ms} мс: ${what}`); await delay(50); } };

async function inner() {
  const dir = process.env.MAIL_TEST_DIR, cert = { key: process.env.MAIL_TEST_KEY, cert: process.env.MAIL_TEST_CERT };
  const fake = await startFakeSmtp({ cert });
  const fake587 = await startFakeSmtp({ cert, starttls: true });
  const smtpEnv = (over = {}) => ({ SMTP_HOST: 'localhost', SMTP_PORT: String(fake.port), SMTP_USER: 'hello@lunario.test', SMTP_PASS: 'app-password-16ch', SMTP_FROM: 'Лунарио <hello@lunario.test>', ...over });
  const servers = [];
  let failed = null;
  try {
    /* MAIL_CHECK_ONLY=server — только сценарии сервера: так их можно прогнать и на старом коде, где mailer еще прежний */
    if (process.env.MAIL_CHECK_ONLY !== 'server') { await unitMailer(fake, fake587, smtpEnv); await unitState(); }
    await serverChecks(fake, smtpEnv, dir, servers);
  } catch (e) { failed = e; }
  /* уборка не должна прятать причину падения: у каждого шага свой предел */
  for (const s of servers) await within(5000, `остановка сервера ${s.name}`, s.stop()).catch((e) => console.error(e.message));
  await within(3000, 'остановка поддельного SMTP', Promise.all([fake.close(), fake587.close()])).catch((e) => console.error(e.message));
  if (failed) { console.error(failed); const last = servers.at(-1); if (last) console.error(`--- журнал сервера ${last.name} ---\n${last.log.slice(-3000)}`); process.exit(1); }
  console.log('PASS: почта входа — клиент SMTP не виснет и называет причину, состояние почты само восстанавливается, сервер отвечает честно');
  process.exit(0);
}

/* ── 1. mailer.mjs против поддельного сервера ── */
async function unitMailer(fake, fake587, smtpEnv) {
  const setEnv = (env) => { for (const k of Object.keys(process.env)) if (k.startsWith('SMTP_')) delete process.env[k]; Object.assign(process.env, env); };
  setEnv(smtpEnv());
  const M = await import(join(repo, 'backend/mailer.mjs'));
  const letter = { subject: 'Код входа в Лунарио: 123456 — проверка длинной темы письма с кириллицей', text: 'Ваш код для входа в Лунарио: 123456', html: '<p>123456</p>' };
  const send = (to = 'a@example.test') => M.sendMail({ to, ...letter }).then(() => ({ ok: true }), (e) => ({ ok: false, e }));
  const LIMIT = 4000;

  fake.mode = 'ok';
  assert.deepEqual(await within(LIMIT, 'verify ok', M.verifySmtp()), { ok: true });
  assert.ok(fake.log.includes('mail') && fake.log.includes('rset'), 'Проверка доходит до MAIL FROM и сбрасывает его RSET — письма не создает');
  const n0 = fake.letters.length;
  assert.equal((await within(LIMIT, 'send ok', send('ok@example.test'))).ok, true);
  assert.equal(fake.letters.length, n0 + 1, 'Проверка без письма, отправка — ровно одно письмо');
  const h = fake.headersOf(fake.lastTo('ok@example.test')).join('\n');
  assert.match(h, /^Date: /m); assert.match(h, /^Message-ID: <.+@lunario\.test>$/m); assert.match(h, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(h, /^From: =\?UTF-8\?B\?.+\?= <hello@lunario\.test>$/m, 'Кириллица в имени отправителя — по RFC 2047');
  assert.ok(h.split('\n').every((l) => l.length <= 78), 'Ни одна строка заголовков не длиннее 78 символов');
  assert.equal(fake.codeFor('ok@example.test'), '123456');

  for (const mode of ['bytes', 'lines', 'multiline_greet', 'quit_no_reply']) {
    fake.mode = mode;
    const r = await within(LIMIT, `send ${mode}`, send()); assert.equal(r.ok, true, `Режим ${mode}: письмо уходит — ${r.e?.message}`);
  }
  /* сценарии отказа: вид сбоя и этап названы, причина не пустая, ничего не висит */
  const cases = [
    ['auth535', 'auth', 'auth'], ['auth454', 'auth', 'auth'], ['greet421', 'temp', 'greeting'],
    ['close_no_greeting', 'net', 'greeting'], ['close_after_ehlo', 'net', 'ehlo'], ['close_after_pass', 'net', 'auth'],
    ['silent', 'net', 'greeting'], ['trickle', 'net', 'greeting'], ['mailfrom553', 'sender', 'mail_from'], ['refuse', 'net', null],
    ['imap', 'server', 'greeting'], ['auth535_echo', 'auth', 'auth'],
  ];
  for (const [mode, kind, stage] of cases) {
    fake.mode = mode;
    const v = await within(LIMIT, `verify ${mode}`, M.verifySmtp());
    assert.equal(v.ok, false, `${mode}: проверка не проходит`);
    assert.equal(v.kind, kind, `${mode}: вид сбоя ${kind}, а не ${v.kind} (${v.error})`);
    if (stage) assert.equal(v.stage, stage, `${mode}: этап ${stage}, а не ${v.stage}`);
    assert.ok(v.error && !/\(\)$/.test(v.error) && v.error.length > 8, `${mode}: причина названа — «${v.error}»`);
    const secrets = ['app-password-16ch', Buffer.from('app-password-16ch').toString('base64'), Buffer.from('hello@lunario.test').toString('base64')];
    assert.ok(!secrets.some((x) => v.error.includes(x)), `${mode}: ни пароль, ни base64 логина и пароля в тексте ошибки — «${v.error}»`);
  }
  /* не SMTP на порту — ошибка сразу, а не после таймера тишины */
  fake.mode = 'imap';
  { const t0 = Date.now(); await M.verifySmtp(); assert.ok(Date.now() - t0 < 300, `Ответ не по SMTP распознан за ${Date.now() - t0} мс`); }
  /* ответ на RCPT — всегда дело одного адреса, даже со словами «limit exceeded»; после текста письма общим считается только «отправитель» */
  for (const [mode, kind] of [['rcpt550', 'recipient'], ['rcpt451', 'recipient'], ['rcpt552', 'recipient'], ['data554', 'rejected'], ['dot553', 'sender'], ['auth535', 'auth']]) {
    fake.mode = mode;
    const r = await within(LIMIT, `send ${mode}`, send());
    assert.equal(r.ok, false); assert.ok(r.e instanceof M.SmtpError, `${mode}: наружу только SmtpError`); assert.equal(r.e.kind, kind, `${mode}: ${r.e.message}`);
  }
  /* молчание на QUIT после принятого письма — не ждем таймер тишины */
  fake.mode = 'quit_silent';
  { const t0 = Date.now(); assert.equal((await within(LIMIT, 'send quit_silent', send())).ok, true); assert.ok(Date.now() - t0 < 400, `QUIT без ответа: ${Date.now() - t0} мс`); }
  fake.mode = 'close_after_dot';
  const cd = await within(LIMIT, 'send close_after_dot', send());
  assert.equal(cd.ok, false); assert.equal(cd.e.bodySent, true, 'Обрыв после переданного письма — «могло дойти», а не «не ушло»');

  /* закрытый порт на localhost (IPv6 и IPv4): раньше причина была пустой — AggregateError без message */
  const closed = await freePort();
  setEnv(smtpEnv({ SMTP_PORT: String(closed) }));
  const ref = await within(LIMIT, 'verify closed port', M.verifySmtp());
  assert.equal(ref.kind, 'net'); assert.match(ref.error, /ECONNREFUSED/, `Причина у закрытого порта названа: «${ref.error}»`);

  /* опечатки в .env — состояние «не настроена», а не падение процесса */
  setEnv(smtpEnv({ SMTP_PORT: 'abc' }));
  assert.equal((await M.verifySmtp()).kind, 'config');
  assert.equal((await send()).e.kind, 'config');
  setEnv(smtpEnv({ SMTP_HOST: '127.0.0.1' }));
  assert.match(M.configProblem(), /SMTP_TLS_NAME/, 'IP без имени для сертификата — ошибка настройки, проверку TLS не выключаем');
  setEnv(smtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_TLS_NAME: 'localhost' }));
  fake.mode = 'ok';
  assert.deepEqual(await within(LIMIT, 'verify by IP + TLS name', M.verifySmtp()), { ok: true }, 'IP + SMTP_TLS_NAME: сертификат проверяется по имени');
  setEnv(smtpEnv({ SMTP_HOST: 'localhost', SMTP_TLS_NAME: 'wrong.example' }));
  const wrong = await within(LIMIT, 'verify wrong TLS name', M.verifySmtp());
  assert.equal(wrong.ok, false); assert.equal(wrong.kind, 'tls', `Чужое имя в сертификате — tls: ${wrong.error}`);

  /* 587 и STARTTLS */
  setEnv(smtpEnv({ SMTP_PORT: String(fake587.port), SMTP_SECURE: 'starttls' }));
  fake587.mode = 'ok';
  assert.equal((await within(LIMIT, 'send starttls', send('tls@example.test'))).ok, true, 'STARTTLS: письмо уходит');
  assert.equal(fake587.codeFor('tls@example.test'), '123456');

  /* не больше двух разговоров с SMTP одновременно */
  setEnv(smtpEnv()); fake.mode = 'lines'; fake.maxActive = 0;
  const many = await within(8000, 'six parallel sends', Promise.all(Array.from({ length: 6 }, (_, i) => send(`p${i}@example.test`))));
  assert.ok(many.every((r) => r.ok), 'Шесть писем подряд уходят через очередь');
  assert.ok(fake.maxActive <= 2, `Одновременно не больше 2 соединений, было ${fake.maxActive}`);
  fake.mode = 'ok';
  assert.equal(M.maskEmails('550 No such user <victim.name@mail.ru>'), '550 No such user <v***@mail.ru>');
  /* ключ лимита: IPv6 — сеть /64 в одной записи, IPv4 (и ::ffff:a.b.c.d) — сам адрес */
  const { ipNetwork } = await import(join(repo, 'backend/http/request-guard.mjs'));
  assert.equal(ipNetwork('2001:db8:0:a::1'), ipNetwork('2001:0db8:0000:000a:ffff::9')); assert.equal(ipNetwork('2001:db8:0:a::1'), '2001:db8:0:a::/64');
  assert.notEqual(ipNetwork('2001:db8:0:a::1'), ipNetwork('2001:db8:0:b::1'));
  assert.equal(ipNetwork('::ffff:203.0.113.7'), '203.0.113.7'); assert.equal(ipNetwork('203.0.113.7'), '203.0.113.7');
  console.log('PASS: mailer — 4 режима отправки, 16 сценариев отказа с этапом и причиной, секреты вырезаны, QUIT не держит, STARTTLS, IP + имя сертификата, очередь из 2 соединений');
}

/* ── 2. mail-state.mjs: расписание и правила, подставная проверка ── */
async function unitState() {
  const { createMailState } = await import(join(repo, 'backend/mail-state.mjs'));
  const mk = (results, o = {}) => {
    const seq = [...results], changes = [];
    const s = createMailState({ configProblem: () => o.bad || '', scale: o.scale ?? 0.001, onChange: (st, prev) => changes.push(`${prev}>${st.state}${st.kind ? ':' + st.kind : ''}`),
      verify: () => { const r = seq.length > 1 ? seq.shift() : seq[0]; return typeof r === 'function' ? r() : Promise.resolve(r); } });
    return { s, changes };
  };
  const NET = { ok: false, kind: 'net', error: 'connect: ECONNREFUSED' }, AUTH = { ok: false, kind: 'auth', error: 'auth: SMTP 535' }, OK = { ok: true };

  /* авария с прода: проверка при запуске не прошла — почта включается сама, без перезапуска */
  { const { s, changes } = mk([NET, NET, OK]); await s.start();
    assert.equal(s.publicState(), 'down'); assert.equal(s.formUseful(), true, 'Короткий сбой — форма входа остается');
    await until('само восстановление после двух неудач', 2000, () => s.publicState() === 'ok');
    assert.deepEqual(changes, ['checking>down:net', 'down>ok']); s.stop(); }
  /* зависшая проверка не держит «checking» вечно */
  { const { s } = mk([() => new Promise(() => {})], { scale: 0.002 }); await within(1000, 'hung verify', s.start());
    assert.equal(s.publicState(), 'down'); assert.match(s.status().lastError, /не уложилась/); s.stop(); }
  /* пароль не принят: к почте по запросам людей не ходим, формы нет */
  { const { s } = mk([AUTH]); await s.start();
    assert.deepEqual({ ...s.peek(), retryAfter: 0 }, { ok: false, error: 'mail_down', retryAfter: 0 }); assert.equal(s.formUseful(), false);
    assert.ok(s.status().nextCheckAt - Date.now() > 1000, 'После 535 перепроверка редкая (30 мин по шкале), а не через секунды'); s.stop(); }
  /* сетевой сбой: одна пробная попытка на сервер, не чаще раза в минуту — часы подставные, таймеры не срабатывают сами */
  { let now = 1e9; const timers = { setTimeout: () => ({ unref() {} }), clearTimeout() {} };
    const s = createMailState({ configProblem: () => '', verify: async () => NET, clock: () => now, timers });
    await s.start();
    assert.equal(s.peek().ok, false, 'Сразу после неудачной проверки — пауза, а не новая попытка');
    now += 59e3; assert.equal(s.peek().ok, false);
    now += 1e3; const g1 = await s.admit(); assert.equal(g1.probe, true, 'Через минуту запрос человека сам служит проверкой');
    assert.equal(s.peek().ok, false, 'Пока идет пробная попытка, вторую не пускаем');
    s.report(null); assert.equal(s.publicState(), 'ok', 'Удачное письмо — почта снова работает');
    assert.equal(s.peek().ok, true); s.stop(); }
  /* отказы одного письма общее состояние не трогают; подряд по разным адресам — сигнал владелице, вход открыт */
  { const anomalies = [];
    const s = createMailState({ configProblem: () => '', verify: async () => OK, scale: 0.001, onAnomaly: (a) => anomalies.push(a) }); await s.start();
    s.report({ kind: 'recipient', message: 'rcpt: SMTP 552 Mailbox size limit exceeded' }, 'a@full.test'); assert.equal(s.publicState(), 'ok', 'Переполненный ящик получателя — дело одного адреса');
    for (const d of ['x.test', 'y.test', 'z.test', 'x.test', 'y.test']) s.report({ kind: 'rejected', message: 'body: SMTP 554 spam' }, `p@${d}`);
    assert.equal(s.publicState(), 'ok', 'Отказы текста письма не закрывают вход всем');
    assert.equal(anomalies.length, 1, 'Пять отказов подряд по трем и больше доменам — один сигнал'); assert.ok(anomalies[0].domains >= 3);
    s.report({ kind: 'busy', message: 'queue' }); s.report({ kind: 'gated', message: 'queue' }); assert.equal(s.publicState(), 'ok', 'Очередь к SMTP состояние не меняет');
    /* залп писем, упавших из-за одного мигания сети, лестницу не перескакивает */
    for (let i = 0; i < 5; i++) s.report({ kind: 'net', message: 'connect: ECONNRESET' });
    assert.equal(s.status().fails, 1); assert.ok(s.status().nextCheckAt - Date.now() < 200, 'Следующая проверка — первая ступень лестницы, а не десятая минута');
    assert.equal(s.mayConnect(null), false, 'Письмо из очереди после сбоя в ящик не входит'); assert.equal(s.mayConnect({ ok: true, probe: true }), true, 'Пробная попытка — входит');
    s.stop(); }
  /* проверка, начатая до удачного письма, не перекрывает его своей неудачей */
  { const pending = []; const s = createMailState({ configProblem: () => '', verify: () => new Promise((r) => pending.push(r)), scale: 1 });
    const first = s.start(); await until('первая проверка началась', 500, () => pending.length === 1); pending[0](OK); await first;
    const late = s.check(); await until('вторая проверка началась', 500, () => pending.length === 2);
    s.report(null); pending[1](NET); await late;
    assert.equal(s.publicState(), 'ok', 'Свежее «письмо ушло» важнее старой проверки'); s.stop(); }
  /* после неверного пароля наружу не уходит точное время до проверки: по нему угадывается причина */
  { const { s } = mk([AUTH]); await s.start(); assert.equal(s.publicRetryAfter(), null); s.stop(); }
  /* настройка с ошибкой — off, без перепроверок */
  { const { s } = mk([OK], { bad: 'SMTP_PORT=abc' }); await s.start();
    assert.equal(s.publicState(), 'off'); assert.deepEqual(s.peek(), { ok: false, error: 'mail_off' }); assert.equal(s.status().nextCheckAt, 0); s.stop(); }
  console.log('PASS: mail-state — само восстановление, срок проверки, редкие повторы после 535, одна пробная попытка, отказы одного письма вход не закрывают, очередь после сбоя в ящик не входит');
}

/* ── 3. настоящий сервер приложения ── */
async function serverChecks(fake, smtpEnv, dir, servers) {
  /* база городов в git не лежит (собирается из GeoNames) — для сервера хватает одной строки, как в check-personal-features */
  const citiesDb = join(dir, 'cities.db');
  { const c = new DatabaseSync(citiesDb); c.exec(`CREATE TABLE IF NOT EXISTS cities (name TEXT, region TEXT, country TEXT, lat REAL, lon REAL, tz TEXT, pop INTEGER, norm TEXT, w2 TEXT, alt TEXT);
      INSERT INTO cities VALUES ('Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow');`); c.close(); }
  async function boot(name, env) {
    const port = await freePort(), data = join(dir, name);
    await mkdir(data, { recursive: true });
    let log = '';
    const child = spawn(process.execPath, ['--no-warnings', join(repo, 'backend/server.mjs')], {
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS, LUNARIO_TEST: '1', MAIL_TIME_SCALE: SCALE, LUNARIO_QUIET: '1',
        PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app', DATA_DIR: join(data, 'data'), BACKUP_DIR: join(data, 'backups'),
        CONTENT_DIR: process.env.CONTENT_DIR || join(repo, 'content'), CITIES_DB: citiesDb, SITE_DIR: join(repo, 'site'), ANON_RATE: '500', ...env },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}/app/api`;
    for (let i = 0; ; i++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name}: сервер упал при запуске\n${log}`);
      try { if ((await fetch(base + '/health')).ok) break; } catch {}
      if (i > 150) throw new Error(`${name}: сервер не поднялся\n${log}`);
      await delay(100);
    }
    let ip = 0;
    const srv = {
      name, base, get log() { return log; }, db: () => new DatabaseSync(join(data, 'data', 'app.db'), { readOnly: true }),
      async req(path, { method = 'GET', body, cookie = '', xff } = {}) {
        /* xff: null — запрос «с самого сервера», без X-Forwarded-For (так ходят deploy.sh и set-smtp.sh) */
        const fwd = xff === null ? {} : { 'X-Forwarded-For': xff || `203.0.113.${1 + (ip++ % 250)}` };
        const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...fwd, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
          .catch((e) => { throw new Error(`${name}: ${method} ${path} без ответа за 10 с (${e.message})`); });
        return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
      },
      code: (email, o = {}) => srv.req('/auth/request', { method: 'POST', body: { email }, ...o }),
      status: () => srv.req('/mail-status').then((r) => r.body),
      async stop() { if (child.exitCode === null && child.signalCode === null) { const e = once(child, 'exit'); child.kill('SIGTERM'); await e; } },   /* остановленный сигналом: exitCode пуст, есть signalCode */
    };
    servers.push(srv);
    return srv;
  }
  const T = 6000;

  /* B. Авария с прода: при запуске почтовый сервер недоступен, потом ожил — вход включается сам, без перезапуска */
  fake.mode = 'refuse';
  step('B'); const B = await boot('startup-down', smtpEnv());
  await until('первая проверка при запуске', T, async () => (await B.status()).mail !== 'checking');
  assert.equal((await B.status()).mail, 'down', 'Почта лежит при запуске — состояние down');
  assert.equal((await B.status()).mailReady, true, 'Сбой сети короткий — экран входа держит форму');
  assert.match(B.log, /SMTP: почта не работает — нет связи/, 'В journalctl — строка «SMTP:» с понятной причиной');
  fake.mode = 'ok';
  await until('само восстановление почты', T, async () => (await B.status()).mail === 'ok');
  assert.match(B.log, /SMTP: почта снова работает/);
  assert.equal((await B.code('after-recovery@example.test')).status, 200, 'После восстановления код уходит');
  const stateRows = B.db().prepare("SELECT message FROM errors WHERE path='mail_state' ORDER BY id").all().map((r) => r.message);
  assert.ok(stateRows.some((m) => /почта не работает: net/.test(m)) && stateRows.includes('почта снова работает'), `Смены состояния — в журнале сбоев кабинета: ${stateRows}`);
  await B.stop();
  /* G. Пароль починили через set-smtp.sh — сервис перезапускается: новый процесс пишет «снова работает», иначе кабинет
     навсегда показывал бы «не работает» по последней строке журнала (ревью 16.10) */
  fake.mode = 'auth535';
  const G1 = await boot('restart', smtpEnv());
  await until('пароль не принят при запуске', T, async () => (await G1.status()).mail === 'down');
  await G1.stop();
  fake.mode = 'ok';
  const G2 = await boot('restart', smtpEnv());
  await until('почта работает после перезапуска', T, async () => (await G2.status()).mail === 'ok');
  assert.equal(G2.db().prepare("SELECT message FROM errors WHERE path='mail_state' ORDER BY id DESC LIMIT 1").get().message, 'почта снова работает');
  assert.match(G2.log, /SMTP: почта снова работает/);
  await G2.stop();
  console.log('PASS: авария с прода — почта лежала при запуске и ожила: вход включился сам, причина в журнале; после перезапуска с исправленным паролем — «снова работает»');

  /* F. Почтовый сервер закрыл соединение молча при запуске: раньше проверка висела вечно и строки «SMTP:» не было */
  fake.mode = 'close_no_greeting';
  step('F'); const F = await boot('startup-silent-close', smtpEnv());
  await until('проверка не висит', T, async () => (await F.status()).mail === 'down');
  assert.match(F.log, /SMTP: почта не работает/);
  await F.stop();

  /* C. Почта не настроена: честный mail_off, лимиты не тратятся */
  step('C'); const C = await boot('no-smtp', {});
  assert.deepEqual(await C.status(), { mailReady: false, mail: 'off', retryAfter: null });
  for (let i = 0; i < 6; i++) { const r = await C.code('same@example.test', { xff: '198.51.100.200' }); assert.equal(r.status, 503); assert.equal(r.body.error, 'mail_off'); }
  assert.equal(C.db().prepare("SELECT COUNT(*) c FROM errors WHERE path='mail_state'").get().c, 0, 'Без SMTP на компьютере разработчика журнал сбоев не засоряется');
  await C.stop();

  /* D. Опечатка в SMTP_PORT — сервер жив, почта off */
  step('D'); const D = await boot('bad-port', smtpEnv({ SMTP_PORT: 'abc' }));
  assert.equal((await D.status()).mail, 'off'); assert.equal((await D.req('/health')).body.ok, true);
  assert.match((await D.req('/health', { xff: null })).body.mailInfo?.reason || '', /SMTP_PORT/, 'Причина видна выкатке на самом сервере');
  await D.stop();

  /* A. Почта работает */
  fake.mode = 'ok';
  step('A'); const A = await boot('mail-ok', smtpEnv());
  await until('почта проверена', T, async () => (await A.status()).mail === 'ok');
  const outside = (await A.req('/health', { xff: '203.0.113.9' })).body;
  assert.equal(outside.mail, 'ok'); assert.equal(outside.mailInfo, undefined, 'Снаружи (через nginx) — только грубое состояние почты');
  step('код из письма открывает вхо');
  /* код из письма открывает вход */
  const r1 = await A.code('user@example.test');
  assert.equal(r1.status, 200); assert.deepEqual(r1.body, { ok: true });
  const v1 = await A.req('/auth/verify', { method: 'POST', body: { email: 'user@example.test', code: fake.codeFor('user@example.test') }, cookie: r1.cookie });
  assert.equal(v1.status, 200); assert.equal(v1.body.state, 'attached');
  const session = v1.cookie || r1.cookie;   /* вход выдает новую сессию */
  step('неудачная повторная отправк');
  /* неудачная повторная отправка не отменяет код, который уже у человека в почте */
  const k1 = await A.code('keep@example.test'); const kept = fake.codeFor('keep@example.test');
  fake.mode = 'rcpt550';
  const bad = await A.code('keep@example.test', { cookie: k1.cookie });
  assert.equal(bad.status, 502); assert.equal(bad.body.error, 'bad_recipient'); assert.equal((await A.status()).mail, 'ok', '550 на адрес не выключает почту всем');
  fake.mode = 'ok';
  assert.equal((await A.req('/auth/verify', { method: 'POST', body: { email: 'keep@example.test', code: kept }, cookie: k1.cookie })).status, 200, 'Код из первого письма по-прежнему подходит');
  step('обрыв после переданного пис');
  /* обрыв после переданного письма: «могло задержаться», код действует */
  fake.mode = 'close_after_dot';
  const unc = await A.code('maybe@example.test');
  assert.deepEqual(unc.body, { ok: true, uncertain: true });
  fake.mode = 'ok';
  assert.equal((await A.req('/auth/verify', { method: 'POST', body: { email: 'maybe@example.test', code: fake.codeFor('maybe@example.test') }, cookie: unc.cookie })).status, 200, 'Код из письма, о котором сервер не знал наверняка, действует');
  step('удаление аккаунта по коду и');
  /* удаление аккаунта по коду из письма */
  const dc = await A.req('/account/delete-code', { method: 'POST', cookie: session });
  assert.deepEqual(dc.body, { ok: true, sent: true });
  assert.match(fake.textOf(fake.lastTo('user@example.test')), /удален/);
  assert.equal((await A.req('/account', { method: 'DELETE', body: { code: fake.codeFor('user@example.test') }, cookie: session })).status, 200);
  step('лимиты (перенесено');
  /* лимиты (перенесено из check-personal-features: там почта выключена и лимиты больше не тратятся) — адрес клиента берется последний */
  for (let i = 0; i < 5; i++) assert.equal((await A.code(`p${i}@example.test`, { xff: `10.0.0.${i}, 198.51.100.1` })).status, 200, 'Лимит на устройство: 5 кодов');
  const spoof = await A.code('p9@example.test', { xff: '10.0.0.99, 198.51.100.1' });
  assert.equal(spoof.status, 429); assert.equal(spoof.body.error, 'too_often', 'Подмена первого X-Forwarded-For не сбрасывает лимит');
  assert.equal((await A.code('p9@example.test', { xff: '10.0.0.99, 198.51.100.2' })).status, 200, 'Другой настоящий (последний) адрес — другой клиент');
  for (let i = 0; i < 3; i++) assert.equal((await A.code('victim@example.test', { xff: `198.51.100.${10 + i}` })).status, 200);
  assert.equal((await A.code('victim@example.test', { xff: '198.51.100.13' })).body.error, 'too_often', 'На один ящик — не больше трех кодов за окно');
  step('письмо отклонено как спам');
  /* письмо отклонено как спам и переполненный ящик получателя — почта для остальных работает (раньше «552 … limit exceeded»
     закрывал вход всем на 6 часов, и посторонний мог делать это нарочно) */
  fake.mode = 'data554';
  assert.equal((await A.code('spam@example.test')).body.error, 'send_failed');
  assert.equal((await A.status()).mail, 'ok');
  fake.mode = 'rcpt552';
  assert.equal((await A.code('full@example.test')).body.error, 'bad_recipient');
  assert.deepEqual(await A.status(), { mailReady: true, mail: 'ok', retryAfter: null }, 'Один переполненный ящик не выключает вход всем');
  fake.mode = 'ok';
  assert.equal((await A.code('after-full@example.test')).status, 200);
  /* причина — только на запрос с самого сервера: без X-Forwarded-For, но с публичным Host (nginx без нужной строки) — не отдаем */
  const viaHost = await new Promise((res) => { const rq = httpGet({ host: '127.0.0.1', port: new URL(A.base).port, path: '/app/api/health', headers: { Host: 'lunario.online' } }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res(JSON.parse(b))); }); rq.end(); });
  assert.equal(viaHost.mail, 'ok'); assert.equal(viaHost.mailInfo, undefined, 'Host — публичное имя: причины в ответе нет');
  step('молчащий почтовый сервер');
  /* молчащий почтовый сервер: запрос не висит, сервер отвечает остальным */
  fake.mode = 'silent';
  const t0 = Date.now(), slow = A.code('silent@example.test');
  await delay(100);
  const th = Date.now(); assert.equal((await A.req('/health')).status, 200); assert.ok(Date.now() - th < 500, 'Пока ждем почту, сервер отвечает');
  const sr = await within(T, 'request on silent SMTP', slow);
  assert.equal(sr.status, 502); assert.equal(sr.body.error, 'send_failed'); assert.ok(Date.now() - t0 < 4000, `Ответ за ${Date.now() - t0} мс, а не до 504 от nginx`);
  assert.equal((await A.status()).mailReady, true, 'Сетевой сбой — форма остается, следующая попытка возможна');
  fake.mode = 'ok';
  await until('восстановление после молчания', T, async () => (await A.status()).mail === 'ok');
  step('защита формы');
  /* запросы с чужих сайтов — отказ до всякой работы; тело не JSON — отказ; свой Origin — как обычно (request-guard.mjs) */
  const rawPost = (headers, body) => fetch(A.base + '/auth/request', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.201', ...headers }, body, signal: AbortSignal.timeout(10000) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const ask = JSON.stringify({ email: 'guard@example.test' }), JSONH = { 'Content-Type': 'application/json' };
  assert.deepEqual(await rawPost({ ...JSONH, 'Sec-Fetch-Site': 'cross-site' }, ask), { status: 403, body: { ok: false, error: 'cross_site' } }, 'Запрос кода с чужой страницы (Sec-Fetch-Site) — отказ');
  assert.equal((await rawPost({ ...JSONH, Origin: 'https://evil.example' }, ask)).body.error, 'cross_site', 'Чужой Origin — отказ');
  assert.equal((await rawPost({ 'Content-Type': 'text/plain' }, ask)).status, 415, 'Тело не JSON (простой запрос с чужой формы) — отказ');
  assert.equal((await rawPost({ ...JSONH, Origin: 'https://lunario.online', 'Sec-Fetch-Site': 'same-origin' }, ask)).status, 200, 'Своя страница — код уходит');
  /* лимит по IPv6 — сетью /64: смена адреса внутри сети его не обходит */
  for (let i = 1; i <= 5; i++) assert.equal((await A.code(`v6-${i}@example.test`, { xff: `2001:db8:0:7::${i}` })).status, 200);
  assert.equal((await A.code('v6-6@example.test', { xff: '2001:db8:0:7:ffff::9' })).body.error, 'too_often', 'Тот же /64 — тот же лимит');
  assert.equal((await A.code('v6-7@example.test', { xff: '2001:db8:0:8::1' })).status, 200, 'Другая сеть /64 — другой клиент');
  /* неверные коды копятся на адрес: после пяти новый код — через паузу, а не сразу с новыми пятью попытками */
  const pc = await A.code('pause@example.test', { xff: '203.0.113.202' }); assert.equal(pc.status, 200);
  const right = fake.codeFor('pause@example.test'), wrong = right === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) assert.equal((await A.req('/auth/verify', { method: 'POST', body: { email: 'pause@example.test', code: wrong }, cookie: pc.cookie, xff: '203.0.113.202' })).body.error, 'wrong_code');
  const again = await A.code('pause@example.test', { xff: '203.0.113.203', cookie: pc.cookie });
  assert.equal(again.status, 429); assert.equal(again.body.error, 'code_pause'); assert.ok(again.body.retryAfter > 0 && again.body.retryAfter <= 60, `Пауза ${again.body.retryAfter} с`);
  step('пароль отозван');
  /* пароль отозван, пока шесть писем стоят в очереди: в ящик входят только первые два, остальные — уже «почта не работает»;
     дальше к Яндексу по запросам людей не ходим (раньше очередь входила с неверным паролем до 32 раз подряд — ревью 16.10) */
  fake.mode = 'auth535_slow';
  const passBefore = fake.log.filter((x) => x === 'pass').length;
  const burst = await within(T, 'six requests while the password is revoked', Promise.all(Array.from({ length: 6 }, (_, i) => A.code(`auth${i}@example.test`))));
  const passes = fake.log.filter((x) => x === 'pass').length - passBefore;
  assert.ok(passes <= 2, `Неудачных входов в ящик ${passes}, а не по одному на каждое письмо`);
  assert.ok(burst.every((r) => [502, 503].includes(r.status)), burst.map((r) => r.status).join(','));
  assert.ok(burst.some((r) => r.status === 502) && burst.some((r) => r.body.error === 'mail_down'), 'Первые — «не ушло», остальные — «почта не работает»');
  assert.ok(burst.every((r) => r.body.mailReady === false), 'После 535 экран входа показывает «вход временно не работает»');
  const st535 = await A.status(); assert.equal(st535.mailReady, false); assert.equal(st535.mail, 'down'); assert.equal(st535.retryAfter, null, 'Наружу — без точного времени до проверки');
  const c0 = fake.connections;
  for (let i = 0; i < 3; i++) { const r = await A.code(`auth-more${i}@example.test`); assert.equal(r.status, 503); assert.equal(r.body.error, 'mail_down'); assert.equal(r.body.retryAfter, undefined); }
  assert.equal(fake.connections, c0, 'Запросы людей при неверном пароле не входят в ящик — не похоже на подбор пароля');
  const rows = A.db().prepare("SELECT path, message FROM errors WHERE path IN ('mail','mail_state') ORDER BY id").all();
  assert.ok(rows.some((r) => r.path === 'mail_state' && /почта не работает: auth/.test(r.message)), 'Сбой почты — в журнале сбоев');
  assert.ok(rows.some((r) => r.message.includes('<k***@example.test>')), 'Адрес из ответа сервера — в журнале замаскированным');
  assert.ok(!rows.some((r) => /keep@example\.test/.test(r.message)), 'Открытого адреса в журнале сбоев нет');
  /* договоренность консилиума: ни пароль, ни base64 логина и пароля — ни в journalctl, ни в журнале сбоев */
  const secrets = ['app-password-16ch', Buffer.from('app-password-16ch').toString('base64'), Buffer.from('hello@lunario.test').toString('base64')];
  for (const srv of [A, B]) assert.ok(!secrets.some((x) => srv.log.includes(x)), `${srv.name}: секретов в журнале сервера нет`);
  assert.ok(!secrets.some((x) => rows.some((r) => r.message.includes(x))), 'Секретов в журнале сбоев нет');
  await A.stop();
  console.log('PASS: сервер — код из письма, «письмо, потом база», uncertain, удаление по коду, лимиты и X-Forwarded-For, защита от чужих сайтов, IPv6 /64, пауза после неверных кодов, 550/552/554/молчание/535 и очередь по правилам');
}

if (!process.argv.includes('--inner')) {
  const dir = await mkdtemp(join(tmpdir(), 'lunario-mail-'));
  try {
    const cert = makeTestCert(dir);
    const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), '--inner'], {
      stdio: 'inherit', timeout: 180000, killSignal: 'SIGKILL', env: { ...process.env, NODE_EXTRA_CA_CERTS: cert.cert, MAIL_TEST_DIR: dir, MAIL_TEST_KEY: cert.key, MAIL_TEST_CERT: cert.cert, LUNARIO_TEST: '1', MAIL_TIME_SCALE: SCALE },
    });
    if (r.error || r.signal) console.error(`check-mail: проверка не уложилась в 3 мин или упала (${r.error?.message || r.signal}) — зависание считается провалом`);
    process.exitCode = r.status ?? 1;
  } finally { await rm(dir, { recursive: true, force: true }); }
} else await inner();
