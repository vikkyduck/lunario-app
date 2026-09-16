/* Надёжное сохранение и вход: настоящий сервер, временная база, синтетические аккаунты.
   node tools/check-sync.mjs            — серверная часть
   node tools/check-sync.mjs --ui       — плюс клиентский модуль в настоящем браузере (нужен Playwright)
   Письма не отправляются, рабочая база и секреты не используются.

   Проверяются ровно те свойства, ради которых всё затевалось: повтор одного действия не создаёт дубль;
   чужой черновик не попадает в другой аккаунт; отказ посередине входа не оставляет человека без кода и без
   входа; записи гостя переносятся только по согласию. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), 'lunario-sync-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}/app`;
let server, log = '';

async function start() {
  server = spawn(process.execPath, [join(fixture, 'backend/server.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app',
      DATA_DIR: join(fixture, 'data'), CONTENT_DIR: join(fixture, 'content'), BACKUP_DIR: join(fixture, 'backups'),
      SITE_DIR: join(repo, 'site'), PUBLIC_BASE: `http://127.0.0.1:${port}`, ANON_RATE: '500', LUNARIO_QUIET: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`сервер не поднялся: ${log}`);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`сервер не ответил: ${log}`);
}
async function stop() { if (server && server.exitCode === null) { const ex = once(server, 'exit'); server.kill('SIGTERM'); await ex; } }

let seq = 0;
/* каждый синтетический человек — со своего адреса: у сервера лимит на создание анонимных аккаунтов с одного */
function account(ip = `198.51.100.${1 + (seq++ % 250)}`) {
  let cookie = '';
  return {
    get cookie() { return cookie; }, ip,
    async raw(path, method = 'GET', data, extra = {}) {
      const r = await fetch(base + '/api' + path, { method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...extra },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return r;
    },
    async json(path, method = 'GET', data) {
      const r = await this.raw(path, method, data); const body = await r.json();
      assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(body)}`); return body;
    },
  };
}

try {
  await cp(join(repo, 'backend'), join(fixture, 'backend'), { recursive: true,
    filter: (p) => !p.endsWith('.db') && !p.endsWith('.db-wal') && !p.endsWith('.db-shm') });
  await mkdir(join(fixture, 'content')); await mkdir(join(fixture, 'data'));
  const cities = new DatabaseSync(join(fixture, 'backend/cities.db'));
  cities.exec(`CREATE TABLE cities (name TEXT, region TEXT, country TEXT, lat REAL, lon REAL, tz TEXT, pop INTEGER, norm TEXT, w2 TEXT, alt TEXT);
    INSERT INTO cities VALUES ('Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow');`);
  cities.close();
  await start();
  const db = new DatabaseSync(join(fixture, 'data/app.db'));
  const code = '123456';
  const putCode = (email, purpose = 'login') => db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts, purpose)
    VALUES (?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, purpose=excluded.purpose`)
    .run(email, createHash('sha256').update(code + email).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString(), purpose);

  // ── Повтор одной операции не создаёт вторую запись ──
  const me = account(); const myId = (await me.json('/me')).user.id;
  const op = randomUUID();
  const first = await me.json('/sync/journal', 'POST', { operationId: op, accountId: myId, text: 'Первая запись дня' });
  assert.equal(first.ok, true); assert.equal(first.operationId, op); assert.equal(first.accountId, myId);
  assert.ok(Number.isSafeInteger(first.itemId), 'в квитанции есть номер записи');
  const again = await me.json('/sync/journal', 'POST', { operationId: op, accountId: myId, text: 'Первая запись дня' });
  assert.equal(again.itemId, first.itemId, 'повтор вернул ту же квитанцию');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(myId).c, 1, 'запись одна, а не две');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events WHERE user_id = ? AND type = ?').get(myId, 'journal_add').c, 1, 'и в аналитике действие одно');
  /* тот же id с другим текстом — это не «сохранить заново», а подмена смысла уже принятого действия */
  const conflict = await me.raw('/sync/journal', 'POST', { operationId: op, accountId: myId, text: 'Совсем другой текст' });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'operation_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(myId).c, 1, 'конфликт ничего не переписал');
  console.log('PASS: повтор операции не создаёт дубль и возвращает ту же квитанцию; тот же id с другим текстом — конфликт.');

  // ── Чужой аккаунт и негодные данные ──
  const other = account(); const otherId = (await other.json('/me')).user.id;
  assert.equal((await me.raw('/sync/journal', 'POST', { operationId: randomUUID(), accountId: otherId, text: 'Чужая запись' })).status, 409, 'запись в чужой аккаунт отклонена');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(otherId).c, 0);
  for (const [body, status, error] of [
    [{ operationId: 'не-uuid', text: 'Нормальный текст' }, 422, 'bad_operation_id'],
    [{ operationId: randomUUID(), text: 'ок' }, 422, 'short'],
    [{ operationId: randomUUID(), text: 'x'.repeat(2500) }, 413, 'too_long'],
    [{ operationId: randomUUID(), text: 'Нормальный текст', kind: 'чужой' }, 422, 'bad_kind'],
  ]) { const r = await me.raw('/sync/journal', 'POST', body); assert.equal(r.status, status, error); assert.equal((await r.json()).error, error); }
  assert.equal((await fetch(base + '/api/sync/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: randomUUID(), text: 'Без сессии' }) })).status, 401, 'без сессии писать нельзя');
  console.log('PASS: запись в чужой аккаунт, кривой номер операции, пустой и слишком длинный текст отклоняются по имени причины.');

  // ── Кто я сейчас: гостя не заводим ──
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  assert.equal((await fetch(base + '/api/auth/session', { headers: { 'X-Forwarded-For': '198.51.100.240' } })).status, 401, 'без сессии — 401');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before, 'и нового человека при этом не появилось');
  const who = await me.json('/auth/session');
  assert.equal(who.accountId, myId); assert.equal(who.signedIn, false);
  console.log('PASS: /auth/session читает сессию, не создаёт гостя и отвечает 401, когда сессии нет.');

  // ── Код входа: ровно шесть цифр ──
  const strict = account(); await strict.json('/me');
  const mail = 'strict@example.test';
  for (const bad of ['1234567', '12345', '12345a', '', '１２３４５６']) {
    putCode(mail);
    const r = await strict.raw('/auth/verify', 'POST', { email: mail, code: bad });
    assert.equal(r.status, 400, `код «${bad}» отклонён`);
    assert.equal((await r.json()).error, 'bad_code_format', `код «${bad}» — неверный формат, а не «не подошёл»`);
    assert.ok(db.prepare('SELECT 1 FROM login_codes WHERE email = ?').get(mail), 'негодный формат не гасит настоящий код');
  }
  assert.equal((await strict.json('/auth/verify', 'POST', { email: mail, code: `  ${code}  ` })).state, 'attached', 'внешние пробелы срезаются');
  console.log('PASS: принимается ровно шесть цифр; «1234567» больше не подходит вместо «123456».');

  // ── Отказ входа не съедает код и сохраняет счётчик попыток ──
  const tries = account(); await tries.json('/me');
  const triesMail = 'tries@example.test';
  putCode(triesMail);
  for (let i = 1; i <= 3; i++) {
    assert.equal((await (await tries.raw('/auth/verify', 'POST', { email: triesMail, code: '000000' })).json()).error, 'wrong_code');
    assert.equal(db.prepare('SELECT attempts FROM login_codes WHERE email = ?').get(triesMail).attempts, i, 'счётчик попыток пережил отказ');
  }
  assert.ok(db.prepare('SELECT 1 FROM login_codes WHERE email = ?').get(triesMail), 'код не пропал после неверных попыток');
  assert.equal((await tries.json('/auth/verify', 'POST', { email: triesMail, code })).state, 'attached', 'верный код после ошибок работает');
  console.log('PASS: неверный код увеличивает счётчик и не уничтожает сам код; верный после ошибок принимается.');

  // ── Вход: понятные состояния вместо мутного merged ──
  const fresh = account(); await fresh.json('/me');
  putCode('fresh@example.test');
  const attached = await fresh.json('/auth/verify', 'POST', { email: 'fresh@example.test', code });
  assert.equal(attached.state, 'attached'); assert.equal(attached.merged, false, 'прежнее поле осталось для уже работающих клиентов');
  putCode('fresh@example.test');
  assert.equal((await fresh.json('/auth/verify', 'POST', { email: 'fresh@example.test', code })).state, 'already_signed_in');
  console.log('PASS: вход различает «почта привязана» и «это уже мой аккаунт»; merged сохранён для прежних клиентов.');

  // ── Записи гостя не уезжают сами, но и не теряются ──
  const guest = account(); const guestId = (await guest.json('/me')).user.id;
  await guest.json('/journal', 'POST', { text: 'Запись, сделанная до входа' });
  await guest.json('/mood', 'POST', { mood: 'joy' });
  putCode('fresh@example.test');
  const switched = await guest.json('/auth/verify', 'POST', { email: 'fresh@example.test', code });
  assert.equal(switched.state, 'guest_transfer_required', 'сервер сообщает, что есть что перенести');
  assert.equal(switched.merged, true, 'для прежних клиентов это по-прежнему «устройство переключилось»');
  assert.ok(switched.transfer && switched.transfer.token, 'и даёт подписанное приглашение');
  assert.equal(switched.transfer.counts.journal, 1);
  const target = switched.user.id;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(guestId).c, 1, 'до согласия записи остаются у гостя');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(guestId).c, 1, 'и сам гость цел');
  const outsider = account(); await outsider.json('/me');
  assert.equal((await outsider.raw('/account/transfer', 'POST', { token: switched.transfer.token })).status, 403, 'перенести чужие записи нельзя');
  assert.equal((await guest.raw('/account/transfer', 'POST', { token: 'подделка.подпись' })).status, 400, 'подделанное приглашение отклонено');
  const moved = await guest.json('/account/transfer', 'POST', { token: switched.transfer.token });
  assert.equal(moved.moved.journal, 1, 'запись переехала');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(target).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(guestId).c, 0, 'гость убран после переноса');
  assert.equal((await guest.json('/account/transfer', 'POST', { token: switched.transfer.token })).already, true, 'повтор переноса безобиден');
  console.log('PASS: записи гостя переносятся только по явному согласию, чужое приглашение отклоняется, повтор безопасен.');

  // ── Повреждённая cookie не роняет запрос ──
  assert.equal((await fetch(base + '/api/health', { headers: { Cookie: 'lunario_app=%E0%A4%A; other=1' } })).status, 200, 'битая cookie не даёт 500');
  assert.equal((await fetch(base + '/api/auth/session', { headers: { Cookie: 'lunario_app=%', 'X-Forwarded-For': '198.51.100.241' } })).status, 401, 'для личного — честный 401, а не падение');
  console.log('PASS: повреждённая cookie не роняет запрос: health отвечает, личное отдаёт 401.');

  // ── Прежний способ записи продолжает работать ──
  const oldWay = account(); await oldWay.json('/me');
  assert.ok((await oldWay.json('/journal', 'POST', { text: 'Запись прежним способом' })).item.id, 'старый POST /api/journal отвечает как раньше');
  console.log('PASS: прежний POST /api/journal не изменился — старый клиент продолжает работать.');

  // ── Классификация ошибок базы ──
  const { publicError, AppError } = await import(pathToFileURL(join(fixture, 'backend/sync.mjs')).href);
  assert.equal(publicError({ errcode: 5 }).status, 503); assert.equal(publicError({ errcode: 5 }).retryable, true, 'занятая база — временно, стоит повторить');
  assert.equal(publicError({ errcode: 13 }).status, 503); assert.equal(publicError({ errcode: 13 }).retryable, false, 'нет места — повтор не поможет');
  assert.equal(publicError(new Error('boom')).code, 'internal_error', 'внутренняя ошибка наружу без подробностей');
  assert.equal(publicError(new AppError('short', 422)).code, 'short', 'понятные ошибки проходят как есть');
  console.log('PASS: занятая база — 503 с предложением повторить, нехватка места — 503 без повтора, остальное — 500 без подробностей.');

  // ── Клиентский модуль в настоящем браузере ──
  if (process.argv.includes('--ui')) {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const browser = await chromium.launch({ headless: true, ...(process.env.LUNARIO_CHROME_PATH ? { executablePath: process.env.LUNARIO_CHROME_PATH } : {}) });
    try {
      const client = account();
      const clientId = (await client.json('/me')).user.id;
      const [name, value] = client.cookie.split('=');
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/app', httpOnly: true, secure: false, sameSite: 'Lax' }]);
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/');
      /* грузим так же, как будет грузить приложение: внешним файлом с сервера — строгий CSP инлайн не пустит */
      await page.addScriptTag({ url: '/app/sync.js' });
      await page.evaluate(() => { window.__notes = []; LUN_SYNC.onNotice((m) => window.__notes.push(m)); });

      const saved = await page.evaluate((id) => LUN_SYNC.saveJournal('Запись из браузера', id), clientId);
      assert.equal(saved.state, 'synced', 'запись ушла в аккаунт');
      assert.deepEqual(await page.evaluate(() => window.__notes), ['Черновик сохранён на устройстве.', 'Запись сохранена в аккаунте.'],
        'сначала «сохранён на устройстве», и только после ответа — «сохранена в аккаунте»');
      assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(clientId).c, 1);

      /* в хранилище лежит шифротекст, а не читаемый текст */
      const stored = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('lunario-sync', 1);
        req.onsuccess = () => { const all = req.result.transaction('ops', 'readonly').objectStore('ops').getAll();
          all.onsuccess = () => resolve(all.result.map((r) => ({ hasText: 'text' in r, owner: r.owner, bytes: r.cipher.byteLength }))); };
      }));
      assert.ok(stored.length && !stored[0].hasText, 'открытого текста в хранилище нет');
      assert.equal(stored[0].owner, clientId);

      /* очередь переживает перезагрузку страницы: запись уже отправлена, но остаётся отмеченной и не шлётся заново */
      await page.reload();
      await page.addScriptTag({ url: '/app/sync.js' });
      assert.equal(await page.evaluate((id) => LUN_SYNC.pending(id), clientId), 0, 'отправленное не висит в очереди после перезагрузки');
      assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(clientId).c, 1, 'и не отправляется повторно');

      /* сменился человек — чужой черновик не уходит */
      await page.evaluate(() => { window.__notes = []; LUN_SYNC.onNotice((m) => window.__notes.push(m)); });
      const alien = await page.evaluate((id) => LUN_SYNC.saveJournal('Черновик другого человека', id + 1000), clientId);
      assert.equal(alien.state, 'conflict', 'операция чужого владельца не отправлена');
      assert.equal(db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ?').get(clientId).c, 1, 'и ничего не записалось');
      assert.ok((await page.evaluate(() => window.__notes)).some((m) => m.includes('на устройстве')), 'а текст при этом сохранён на устройстве');

      /* HTTP 200 с HTML вместо JSON — это ошибка, а не успех */
      await page.route('**/api/sync/journal', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>портал Wi-Fi</html>' }));
      await page.evaluate(() => { window.__notes = []; LUN_SYNC.onNotice((m) => window.__notes.push(m)); });
      const html = await page.evaluate((id) => LUN_SYNC.saveJournal('Ответ-заглушка', id), clientId);
      assert.notEqual(html.state, 'synced', 'страница-заглушка не считается сохранением');
      assert.ok((await page.evaluate(() => window.__notes)).some((m) => m.includes('на устройстве')), 'черновик остаётся на устройстве');
      assert.deepEqual(errors, [], 'на странице нет ошибок');
      await ctx.close();
      console.log('PASS: браузер — черновик ложится на устройство до отправки, в хранилище шифротекст, переживает перезагрузку, чужое и заглушку не отправляет.');
    } finally { await browser.close(); }
  } else console.log('(клиентская часть пропущена — запустите с --ui и установленным Playwright)');

  db.close();
  console.log('\nВсе проверки надёжного сохранения и входа пройдены.');
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
