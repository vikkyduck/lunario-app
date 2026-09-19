/* Изоляция личных данных: человек А не видит и не может изменить данные человека Б.

   node tools/check-isolation.mjs

   Настоящий сервер на временной базе, два синтетических аккаунта. Б заводит данные каждого вида —
   запись, благодарность, желание с фото, привычку, аскезу, настроение, расклад, обращение в поддержку,
   напоминание, устройство, — и в каждом лежит своя метка. Потом А со своей сессией стучится во все
   личные маршруты, подставляя настоящие номера записей Б, взятые прямо из базы (худший случай: номера
   чужих записей известны). Проверяется три вещи:

   · ни одна метка Б не встретилась ни в одном ответе А — ни в JSON, ни в картинке, ни в выгрузке;
   · после всех попыток А личные данные Б в базе не изменились ни на байт;
   · без сессии личные маршруты отвечают 401, а не отдают чужое.

   Письма не отправляются, рабочая база и секреты не используются. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
const fixture = await mkdtemp(join(tmpdir(), 'lunario-isolation-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}/app`;
let server, log = '';

async function start() {
  server = spawn(process.execPath, [join(fixture, 'backend/server.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app',
      DATA_DIR: join(fixture, 'data'), CONTENT_DIR: join(fixture, 'content'), BACKUP_DIR: join(fixture, 'backups'),
      SITE_DIR: join(repo, 'site'), PUBLIC_BASE: `http://127.0.0.1:${port}`, ANON_RATE: '500', LUNARIO_QUIET: '1',
      ADMIN_EMAILS: 'staff@example.test' },
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
function account(ip = `203.0.113.${1 + (seq++ % 250)}`) {
  let cookie = '';
  return {
    get cookie() { return cookie; }, ip,
    async raw(path, method = 'GET', data) {
      const r = await fetch(base + '/api' + path, { method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
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

/* однопиксельная картинка — чтобы у желания Б было настоящее фото */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });   /* день человека сервер считает по Москве (заголовка X-Tz тут нет), а не по UTC — иначе проверка падала между 00:00 и 03:00 МСК */

  /* ── Б заводит данные каждого вида; в каждом — своя метка ── */
  const marks = [];
  const M = (what) => { const s = `МЕТКА-Б-${what}-ф7к3`; if (!marks.includes(s)) marks.push(s); return s; };
  const mark = M;

  const bob = account(); const bobId = (await bob.json('/me')).user.id;
  await bob.json('/profile', 'POST', { name: mark('имя'), birth: '1990-05-05', city: 'Москва', consent: true });
  const bobNote = (await bob.json('/journal', 'POST', { text: mark('запись') })).item.id;
  const bobThanks = (await bob.json('/journal', 'POST', { text: mark('благодарность'), kind: 'gratitude' })).item.id;
  await bob.json('/wishes', 'POST', { text: mark('желание'), photo: PIXEL });
  const bobWish = db.prepare('SELECT id FROM wishes WHERE user_id = ?').get(bobId).id;
  await bob.json('/habits', 'POST', { title: mark('привычка'), rule: 'каждый день' });
  const bobHabit = db.prepare('SELECT id FROM habits WHERE user_id = ?').get(bobId).id;
  const until = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await bob.json('/askesis', 'POST', { title: mark('аскеза'), until });
  const bobAskesis = db.prepare('SELECT id FROM askesis WHERE user_id = ?').get(bobId).id;
  await bob.json('/askesis', 'PATCH', { id: bobAskesis, note: mark('наблюдение') });
  await bob.json('/mood', 'POST', { mood: `own:${M('настроение').slice(0, 24)}` });
  const bobTicket = (await bob.json('/support/tickets', 'POST', { subject: mark('тема'), text: mark('обращение'), topic: 'Прочее' })).id;
  await bob.json('/reminders', 'POST', { feature: 'morning', enabled: true, time: '09:00' });
  const bobEndpoint = 'https://fcm.googleapis.com/fcm/send/' + M('устройство').replace(/[^a-zA-Z0-9-]/g, '');
  await bob.json('/push', 'POST', { endpoint: bobEndpoint });
  /* расклад и установка дня — прямо в базу: содержимое дня в проверке не участвует, важен только номер */
  db.prepare("INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,'card',?,?,?,'{}')")
    .run(bobId, new Date().toISOString(), today, M('вопрос'), M('карта'), M('разбор'));
  const bobEntry = db.prepare('SELECT id FROM entries WHERE user_id = ?').get(bobId).id;
  db.prepare('INSERT INTO daily_sets (user_id, day, idx, text, question) VALUES (?,?,0,?,?) ON CONFLICT(user_id, day) DO UPDATE SET text = excluded.text, question = excluded.question').run(bobId, today, M('установка'), M('вопрос-дня'));   /* /me уже снял пару дня — метка ложится поверх */
  console.log(`Б завёл ${marks.length} личных записей, у каждой своя метка.`);

  /* ── снимок всего личного, что есть у Б: после атаки должен совпасть до байта ── */
  const TABLES = ['users', 'journal', 'wishes', 'habits', 'habit_marks', 'askesis', 'askesis_days', 'moods', 'mood_marks',
    'entries', 'daily_sets', 'tickets', 'messages', 'reminders', 'push_subs', 'push_queue', 'shelves', 'sessions', 'usage'];
  function snapshot(id) {
    const parts = [];
    for (const t of TABLES) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const where = cols.includes('user_id') ? 'WHERE user_id = ?' : t === 'users' ? 'WHERE id = ?'
        : t === 'habit_marks' ? 'WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)'
        : t === 'askesis_days' ? 'WHERE askesis_id IN (SELECT id FROM askesis WHERE user_id = ?)'
        : t === 'messages' ? 'WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)' : null;
      assert.ok(where, `таблица ${t} не привязана к человеку — проверка снимка её не увидит`);
      parts.push(t + ':' + JSON.stringify(db.prepare(`SELECT * FROM ${t} ${where}`).all(id)));
    }
    return createHash('sha256').update(parts.join('\n')).digest('hex');
  }
  function snapshotRaw(id){ const parts=[]; for (const t of TABLES) { const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); const where = cols.includes('user_id') ? 'WHERE user_id = ?' : t === 'users' ? 'WHERE id = ?' : t === 'habit_marks' ? 'WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)' : t === 'askesis_days' ? 'WHERE askesis_id IN (SELECT id FROM askesis WHERE user_id = ?)' : t === 'messages' ? 'WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)' : null; parts.push(t + ':' + JSON.stringify(db.prepare(`SELECT * FROM ${t} ${where}`).all(id))); } return parts.join('\n'); }
  /* полки Б досчитываются после ответа сервера (createShelves) — ждём, пока снимок перестанет меняться, иначе гонка со снимком */
  { await new Promise((r) => setTimeout(r, 900));   /* scheduleShelves ждёт 500 мс тишины после последней записи */
    let last = snapshot(bobId), stable = 0; for (let i = 0; i < 40 && stable < 3; i++) { await new Promise((r) => setTimeout(r, 150)); const cur = snapshot(bobId); stable = cur === last ? stable + 1 : 0; last = cur; } }
  const before = snapshot(bobId); const beforeRaw = process.env.ISO_DEBUG ? snapshotRaw(bobId) : '';

  /* ── А пробует дотянуться до всего, что есть у Б ── */
  const alice = account(); const aliceId = (await alice.json('/me')).user.id;
  assert.notEqual(aliceId, bobId, 'это два разных человека');
  const seen = [];   // всё, что А получил в ответах — в конце ищем в этом метки Б
  async function asAlice(path, method = 'GET', data) {
    const r = await alice.raw(path, method, data);
    const body = Buffer.from(await r.arrayBuffer());
    seen.push({ path, method, status: r.status, body });
    return { status: r.status, text: body.toString('utf8'), body };
  }

  /* обращения в поддержку — чужая переписка по номеру */
  assert.equal((await asAlice(`/support/ticket?id=${bobTicket}`)).status, 404, 'чужое обращение не открывается');
  assert.equal((await asAlice(`/support/ticket?id=${bobTicket}`, 'POST', { text: 'дописываю в чужую переписку' })).status, 400, 'в чужую переписку не дописать');
  assert.deepEqual((await asAlice('/support/tickets')).text.includes('МЕТКА-Б'), false, 'в списке своих обращений чужих нет');

  /* желания: чтение, правка, фото */
  const wishPhoto = await asAlice(`/wishes/photo?id=${bobWish}`);
  assert.equal(wishPhoto.status, 404, 'фото чужого желания не отдаётся');
  assert.equal((await asAlice('/wishes/photo', 'POST', { id: bobWish, photo: PIXEL })).status, 404, 'фото в чужое желание не подставить');
  await asAlice(`/wishes/photo?id=${bobWish}`, 'DELETE');
  await asAlice('/wishes', 'PATCH', { id: bobWish });
  assert.equal(db.prepare('SELECT done FROM wishes WHERE id = ?').get(bobWish).done, 0, 'чужое желание не отмечено сбывшимся');
  assert.ok(db.prepare('SELECT photo FROM wishes WHERE id = ?').get(bobWish).photo, 'фото чужого желания на месте');

  /* записи и благодарности */
  assert.equal((await asAlice('/journal', 'PATCH', { id: bobThanks, text: 'переписываю чужую благодарность' })).status, 404, 'чужую благодарность не переписать');
  assert.equal((await asAlice('/journal', 'PATCH', { id: bobNote, text: 'переписываю чужую запись' })).status, 404, 'чужую запись не переписать');
  await asAlice(`/entries?id=${bobEntry}`);
  await asAlice(`/entries?before=${bobEntry + 1}`);
  await asAlice('/entries');

  /* практики */
  assert.equal((await asAlice('/habits', 'PATCH', { id: bobHabit, day: today })).status, 404, 'чужую привычку не отметить');
  assert.equal((await asAlice('/habits', 'PATCH', { id: bobHabit, title: 'переименовываю чужую привычку' })).status, 404, 'чужую привычку не переименовать');
  await asAlice(`/habits?id=${bobHabit}`, 'DELETE');
  assert.equal(db.prepare('SELECT archived FROM habits WHERE id = ?').get(bobHabit).archived, 0, 'чужая привычка не убрана в архив');
  assert.equal((await asAlice('/askesis', 'PATCH', { id: bobAskesis, note: 'пишу в чужую аскезу' })).status, 404, 'в чужую аскезу не написать');
  assert.equal((await asAlice('/askesis', 'PATCH', { id: bobAskesis, until })).status, 404, 'чужой аскезе не передвинуть дату');
  await asAlice(`/askesis?id=${bobAskesis}`, 'DELETE');
  assert.equal(db.prepare('SELECT status FROM askesis WHERE id = ?').get(bobAskesis).status, 'active', 'чужая аскеза не остановлена');

  /* карточка дня: чужие привычка и аскеза, подсунутые в одно сохранение */
  if ((await asAlice('/day')).status === 200) {
    await asAlice('/day', 'POST', { habits: [{ id: bobHabit, done: true }], askesis: [{ id: bobAskesis, kept: 0, note: 'пишу в чужую аскезу' }] });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM habit_marks WHERE habit_id = ? AND day = ?').get(bobHabit, today).c, 0, 'чужая привычка не отмечена через карточку дня');
    /* у Б уже есть своя отметка за сегодня (PATCH с заметкой выше) — проверяем, что чужая попытка «сорвалась» её не тронула */
    assert.equal(db.prepare('SELECT kept FROM askesis_days WHERE askesis_id = ? AND day = ?').get(bobAskesis, today)?.kept, 1, 'в чужую аскезу не записано через карточку дня');
  }

  /* лента, досье, выгрузка, профиль */
  for (const path of ['/timeline', `/timeline?day=${today}`, '/timeline?offset=0', '/me', '/week', '/mood/report',
    '/data/export', '/data/export.pdf', '/shelves', '/shelves/context', '/day-status', '/invite', '/photo',
    '/reminders', '/reminders/askesis-plan', '/reminders/preview?feature=morning', '/wishes', '/habits', '/askesis', '/day']) await asAlice(path);

  /* уведомления: чужое устройство и чужая очередь */
  await asAlice('/push/next', 'POST', { endpoint: bobEndpoint });
  await asAlice('/reminders/test', 'POST', { feature: 'morning', endpoint: bobEndpoint });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_queue WHERE user_id = ?').get(bobId).c, 0, 'в очередь Б ничего не легло');

  /* чужая ячейка уведомлений: её нельзя перевесить на себя — иначе у Б уведомления молча прекратятся,
     а сервер начнёт слать на её устройство тексты А */
  assert.equal((await asAlice('/push', 'POST', { endpoint: bobEndpoint })).status, 409, 'чужую ячейку уведомлений не перехватить');
  assert.equal(db.prepare('SELECT user_id FROM push_subs WHERE endpoint = ?').get(bobEndpoint).user_id, bobId, 'ячейка осталась у Б');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?').get(aliceId).c, 0, 'и А её себе не записал');


  /* ── ни одной метки Б в ответах А ── */
  const leaked = [];
  for (const r of seen) { const s = r.body.toString('utf8'); for (const m of marks) if (s.includes(m)) leaked.push(`${r.method} ${r.path} → ${m}`); }
  assert.deepEqual(leaked, [], 'чужие данные попали в ответ А:\n' + leaked.join('\n'));
  console.log(`PASS: ${seen.length} запросов А к чужим данным — ни одной метки Б ни в одном ответе.`);

  /* ── данные Б не изменились ── */
  if (process.env.ISO_DEBUG && snapshot(bobId) !== before) { const a=beforeRaw.split('\n'), b=snapshotRaw(bobId).split('\n'); for (let i=0;i<a.length;i++) if (a[i]!==b[i]) { console.log('DIFF', a[i].slice(0,600)); console.log('NOW ', b[i].slice(0,600)); } }
  assert.equal(snapshot(bobId), before, 'после попыток А личные данные Б изменились');
  console.log('PASS: после всех попыток личные данные Б в базе не изменились ни на байт.');

  /* ── без сессии личное не отдаётся ── */
  const open = [];
  for (const path of ['/timeline', '/entries', '/wishes', '/habits', '/askesis', '/journal', '/data/export',
    '/data/export.pdf', '/shelves', '/shelves/context', '/photo', `/wishes/photo?id=${bobWish}`, '/support/tickets',
    `/support/ticket?id=${bobTicket}`, '/reminders', '/push', '/invite', '/week', '/mood/report', '/day-status', '/natal', '/day']) {
    const r = await fetch(base + '/api' + path, { headers: { 'X-Forwarded-For': '203.0.113.251' } });
    if (r.status !== 401) open.push(`${path} → ${r.status}`);
  }
  assert.deepEqual(open, [], 'личные маршруты отвечают не 401 без сессии:\n' + open.join('\n'));
  /* /api/me — единственное исключение: с него начинается работа, поэтому без сессии заводится
     новый пустой гость. Проверяем, что это именно новый пустой человек, а не чужой аккаунт. */
  const guest = await (await fetch(base + '/api/me', { headers: { 'X-Forwarded-For': '203.0.113.252' } })).json();
  assert.ok(guest.user && guest.user.id !== bobId && guest.user.id !== aliceId, '/me без сессии завёл нового человека, а не отдал чужого');
  assert.equal(marks.some((m) => JSON.stringify(guest).includes(m)), false, 'и в его ответе нет ни одной чужой метки');
  console.log('PASS: без сессии личные маршруты отвечают 401; /me заводит нового пустого гостя, а не отдаёт чужой аккаунт.');

  /* ── кабинет: сотруднику положено видеть счётчики, но не личные тексты ──
     Роль даёт доступ к чужим цифрам по работе — это не дефект. Дефект — если в отчёт попадает
     то, что человек написал своими словами: настроение «своим словом», запись, обращение. */
  const staff = account();
  await staff.json('/me');
  const staffMail = 'staff@example.test';
  db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts, purpose)
    VALUES (?,?,?,?,0,'login') ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0`)
    .run(staffMail, createHash('sha256').update('123456' + staffMail).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString());
  await staff.json('/auth/verify', 'POST', { email: staffMail, code: '123456' });
  const staffLeak = [];
  for (const kind of ['rituals', 'activity', 'features', 'topics', 'supportmetrics', 'quality', 'concerns', 'feedback', 'ai', 'lifecycle']) {
    const r = await staff.raw(`/cabinet/report?kind=${kind}`);
    if (r.status !== 200) continue;
    const text = JSON.stringify(await r.json());
    for (const m of marks) if (text.includes(m)) staffLeak.push(`${kind} → ${m}`);
    if (/"own:/.test(text)) staffLeak.push(`${kind} → настроение своим словом попало в отчёт целиком`);
  }
  const card = await staff.raw(`/cabinet/user?id=${bobId}`);
  if (card.status === 200) { const text = JSON.stringify(await card.json()); for (const m of marks) if (text.includes(m) && m !== M('имя')) staffLeak.push(`карточка человека → ${m}`); }
  assert.deepEqual(staffLeak, [], 'личные тексты попали в кабинет:\n' + staffLeak.join('\n'));
  console.log('PASS: в отчётах кабинета и карточке человека — счётчики, а не личные тексты.');

  /* ── беклог: сотрудник видит и меняет ровно задачи своих ролей ──
     Задачи — внутренняя работа, не чьи-то личные данные, но права по ролям должны совпадать с
     обещанием: контент и поддержка видят только своё, продукт и админ — весь беклог. Худший случай —
     две роли сразу (контент + поддержка): это две области, а не «весь беклог», и продуктовую задачу
     такой сотрудник не видит ни в списке, ни через ?role=, ни по номеру. */
  for (const role of ['content', 'support', 'product']) await staff.json('/cabinet/tasks', 'POST', { title: `Задача для роли ${role}`, role });
  const taskOf = (role) => db.prepare('SELECT id FROM tasks WHERE role = ?').get(role).id;
  const tContent = taskOf('content'), tSupport = taskOf('support'), tProduct = taskOf('product');
  const twoMail = 'two-roles@example.test';
  await staff.json('/cabinet/staff', 'POST', { email: twoMail, name: 'Контент и поддержка', roles: ['content', 'support'] });
  db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts, purpose) VALUES (?,?,?,?,0,'login')`)
    .run(twoMail, createHash('sha256').update('123456' + twoMail).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString());
  const two = account(); await two.json('/me'); await two.json('/auth/verify', 'POST', { email: twoMail, code: '123456' });
  const visible = async (q = '') => (await two.json('/cabinet/tasks' + q)).items.map((t) => t.id);
  assert.deepEqual((await visible()).filter((id) => [tContent, tSupport, tProduct].includes(id)).sort(), [tContent, tSupport].sort(),
    'сотрудник с двумя ролями видит задачи обеих своих областей и не видит продуктовую');
  assert.equal((await visible('?role=product')).includes(tProduct), false, 'срез по ?role= не открывает сотруднику чужую область');
  assert.equal((await two.raw('/cabinet/tasks', 'POST', { id: tProduct, status: 'done', onlyStatus: true })).status, 403, 'статус чужой (продуктовой) задачи по номеру не меняется');
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(tProduct).status, 'new', 'продуктовая задача в базе не тронута');
  for (const id of [tContent, tSupport]) assert.equal((await two.raw('/cabinet/tasks', 'POST', { id, status: 'in_progress', onlyStatus: true })).status, 200, 'свою задачу сотрудник по-прежнему переводит');
  console.log('PASS: сотрудник с двумя ролями видит и меняет ровно задачи своих областей — продуктовые ему не видны и не переводятся по номеру.');

  /* ── PDF рисует ровно то, что дал personalExport: своих запросов к базе не делает ── */
  const pdfSrc = readFileSync(join(repo, 'backend/personal-export-pdf.mjs'), 'utf8');
  assert.equal(/\bdb\.prepare\(|\bdb\.exec\(/.test(pdfSrc), false, 'PDF-выгрузка ходит в базу сама — данные могут прийти не от того человека');
  console.log('PASS: PDF-выгрузка не ходит в базу сама — рисует только то, что дал personalExport по сессии.');

  db.close();
  console.log('\nИзоляция личных данных: человек А не видит и не меняет данные человека Б.');
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
