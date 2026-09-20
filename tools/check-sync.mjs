/* Вход по коду на почту: настоящий сервер, временная база, синтетические письма.
   node tools/check-sync.mjs — ровно шесть цифр кода, счётчик попыток, «почта привязана» и «это уже мой аккаунт»,
   перенос записей гостя только по согласию, повреждённая cookie не роняет запрос, POST /api/journal работает. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

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
  await cp(join(repo, 'content'), join(fixture, 'content'), { recursive: true, filter: (p) => p === join(repo, 'content') || (dirname(p) === join(repo, 'content') && p.endsWith('.txt')) });   /* тексты приложения, без картинок и архива: запасных копий в коде нет */ await mkdir(join(fixture, 'data'));
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

  const me = account(); await me.json('/me');

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
  assert.equal((await fetch(base + '/api/day', { headers: { Cookie: 'lunario_app=%', 'X-Forwarded-For': '198.51.100.241' } })).status, 401, 'для личного — честный 401, а не падение');
  console.log('PASS: повреждённая cookie не роняет запрос: health отвечает, личное отдаёт 401.');

  // ── Прежний способ записи продолжает работать ──
  const oldWay = account(); await oldWay.json('/me');
  assert.ok((await oldWay.json('/journal', 'POST', { text: 'Запись прежним способом' })).item.id, 'старый POST /api/journal отвечает как раньше');
  console.log('PASS: прежний POST /api/journal не изменился — старый клиент продолжает работать.');


  db.close();
  console.log('\nВсе проверки входа пройдены.');
} catch (e) {
  console.error(e); const lines = log.split('\n').filter((l) => /ошибка|Error|at /.test(l)); if (lines.length) console.error('--- журнал сервера:\n' + lines.slice(-25).join('\n'));   /* при падении — что сказал сам сервер */
  process.exitCode = 1;
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
