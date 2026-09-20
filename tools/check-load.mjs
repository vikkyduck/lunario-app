/* Замер под выгрузкой (ревью v114, F09) — локальный, не нагрузочный прогноз: настоящий сервер во временной папке, синтетический
   аккаунт с годом истории (365 записей по ~1,7 тыс. символов) и 20 фото дня; запускается выгрузка PDF, и пока она считается,
   20 раз подряд спрашивается /api/health. Фиксируются p95 health, время выгрузки, глубина очереди и память процесса проверки.
   Порог для локального прогона: health p95 < 50 мс во время выгрузки — раньше выгрузка шла в основном потоке и давала ~660 мс.
   node tools/check-load.mjs   (в составе tools/check-all.mjs отдельным шагом) */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), 'lunario-load-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}/app`;
process.env.CONTENT_DIR = join(fixture, 'content'); process.env.LUNARIO_QUIET = '1';
let server, log = '';
async function start() {
  server = spawn(process.execPath, [join(fixture, 'backend/server.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app', DATA_DIR: join(fixture, 'data'), CONTENT_DIR: join(fixture, 'content'),
      BACKUP_DIR: join(fixture, 'backups'), SITE_DIR: join(repo, 'site'), PUBLIC_BASE: `http://127.0.0.1:${port}`, ANON_RATE: '40' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error('сервер замера не поднялся: ' + log); try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await delay(100); }
  throw new Error('сервер замера не поднялся: ' + log);
}
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
try {
  await cp(join(repo, 'backend'), join(fixture, 'backend'), { recursive: true, filter: (p) => !/\.db(-wal|-shm)?$/.test(p) });
  const contentSrc = realpathSync(join(repo, 'content'));
  await cp(contentSrc, join(fixture, 'content'), { recursive: true, dereference: true, filter: (p) => p === contentSrc || (dirname(p) === contentSrc && p.endsWith('.txt')) });
  await mkdir(join(fixture, 'data'));
  const cities = new DatabaseSync(join(fixture, 'backend/cities.db'));
  cities.exec(`CREATE TABLE cities (name TEXT, region TEXT, country TEXT, lat REAL, lon REAL, tz TEXT, pop INTEGER, norm TEXT, w2 TEXT, alt TEXT);
    INSERT INTO cities VALUES ('Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow');`);
  cities.close();
  await start();
  let cookie = '';
  const raw = async (path, method = 'GET', data, headers = {}) => { const r = await fetch(base + '/api' + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return r; };
  const me = await (await raw('/me')).json(); const uid = me.user.id, today = me.day.date;
  await raw('/profile', 'POST', { name: 'Год истории', birth: '1988-04-04', city: 'Москва', consent: true });
  /* год записей — прямо в базу тем же ключом, что у сервера: 365 дней по одной записи ~1,7 тыс. символов и настроение */
  const { privateText } = await import(pathToFileURL(join(fixture, 'backend/private-text.mjs')).href);
  const { seal } = privateText(join(fixture, 'data'), { create: false });
  const db = new DatabaseSync(join(fixture, 'data/app.db')); db.exec('PRAGMA busy_timeout = 5000');
  const text = 'Сегодня был длинный день, и хочется оставить от него не только усталость, но и то, что получилось. '.repeat(17).slice(0, 1700);
  const ins = db.prepare("INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?, ?, ?, ?, '', '')"), mood = db.prepare('INSERT OR IGNORE INTO moods (user_id, day, mood) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 365; i++) { const day = new Date(Date.parse(today + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10); ins.run(uid, day + 'T20:00:00.000Z', day, seal(text + ' #' + i)); mood.run(uid, day, i % 2 ? 'joy' : 'calm'); }
  db.exec('COMMIT'); db.close();
  /* 20 фото дня через настоящий маршрут: миниатюра 3 КБ + полное 120 КБ, за прошлые дни — PUT принимает только сегодня, поэтому день подменяется в базе */
  const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${base}/api/day/photo?thumb=3004&w=1280&h=960`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'X-Forwarded-For': '203.0.113.9' }, body: Buffer.concat([jpeg(3000), jpeg(120000)]) });
    assert.equal(r.status, 200, 'фото дня принято');
    const db2 = new DatabaseSync(join(fixture, 'data/app.db')); db2.exec('PRAGMA busy_timeout = 5000');
    db2.prepare('UPDATE day_photos SET day = ? WHERE user_id = ? AND day = ?').run(new Date(Date.parse(today + 'T12:00:00Z') - (i + 1) * 864e5).toISOString().slice(0, 10), uid, today); db2.close();
  }
  /* замер: выгрузка PDF стартует, и пока она идет, health спрашивается 20 раз подряд */
  const t0 = performance.now();
  const exportP = raw('/data/export.pdf').then(async (r) => { assert.equal(r.status, 200, 'выгрузка отдана'); const buf = Buffer.from(await r.arrayBuffer()); return { ms: performance.now() - t0, bytes: buf.length }; });
  await delay(30);   /* запрос ушел и задание отдано потоку */
  const lat = []; let depth = 0;
  for (let i = 0; i < 20; i++) { const t = performance.now(); const r = await raw('/health'); assert.equal(r.status, 200); lat.push(performance.now() - t); depth = Math.max(depth, (await r.json()).jobs || 0); }
  const exp = await exportP;
  const p = p95(lat), rss = Math.round(process.memoryUsage().rss / 1048576);
  console.log(`замер: выгрузка PDF ${Math.round(exp.ms)} мс (${Math.round(exp.bytes / 1024)} КБ, 365 записей, 20 фото); health во время выгрузки — p95 ${p.toFixed(1)} мс, max ${Math.max(...lat).toFixed(1)} мс; глубина очереди заданий ${depth}; память проверки ${rss} МБ`);
  assert.ok(depth >= 1, 'во время выгрузки очередь заданий не пуста — значит, выгрузка шла в потоке');
  assert.ok(p < 50, `health p95 во время выгрузки ${p.toFixed(1)} мс — выгрузка должна идти в потоке заданий, а не в основном`);
  /* две выгрузки подряд одного человека — одна задача, обе отдаются; JSON тоже через поток и без data-URL картинок */
  const [a, b] = await Promise.all([raw('/data/export'), raw('/data/export')]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const json = await a.json(); assert.equal(json.journal.length, 365); assert.equal(json.dayPhotos.length, 20); assert.ok(!JSON.stringify(json.wishes).includes('data:image'));
  console.log('PASS: check-load — год истории и фото под выгрузкой не задерживают короткие запросы (локальный замер, не нагрузочный прогноз).');
} finally {
  if (server && server.exitCode === null) { const exit = once(server, 'exit'); server.kill('SIGTERM'); await exit; }
  await rm(fixture, { recursive: true, force: true });
}
