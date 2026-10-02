import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { calculateBirthNumbers as birth, calculateName as name, calculateNames as names, reduceNumber, PROFILES } from '../backend/numerology.mjs';
import { migrate, verifySchema } from '../backend/schema.mjs';
import { CATALOG, createNumerology } from '../backend/numerology-store.mjs';
import { privateText, hasEncrypted } from '../backend/private-text.mjs';
import { createMutation } from '../backend/mutation.mjs';
import { clearHistory, deleteAccount, sweepAbandoned } from '../backend/account-data.mjs';
import { personalExport } from '../backend/personal-export.mjs';

for (const [input, expected] of [[11, [2, 11, 11]], [22, [4, 22, 22]], [29, [2, 11, 11]], [33, [6, 6, 6]], [39, [3, 12, 3]]]) {
  assert.deepEqual(['base9', 'range22', 'expression'].map(k => reduceNumber(input, k).value), expected);
}
for (const input of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => reduceNumber(input), { code: 'INVALID_NUMBER' });
const examples = [
  ['1994-07-14', [5, 7, 5, 8, 7, 5], [14, 7, 5, 8, 7, 5]],
  ['1984-04-06', [6, 4, 4, 5, 1, 2], [6, 4, 22, 5, 10, 11]],
  ['1980-11-22', [4, 2, 9, 6, 3, 6], [22, 11, 18, 6, 12, 15]],
  ['1977-02-12', [3, 2, 6, 2, 4, 8], [12, 2, 6, 20, 4, 8]],
  ['1990-10-15', [6, 1, 1, 8, 7, 5], [15, 10, 19, 8, 7, 14]],
];
for (const [date, base, star] of examples) for (const [i, profile] of PROFILES.entries()) assert.deepEqual(Object.values(birth(date, '2026-10-02', profile).star).map(n => n.value), [base, star][i]);
assert.equal(birth('1990-10-15', '2026-10-02', PROFILES[0]).fullDateDigitSum, 26);
for (const [date, code] of [['1900-02-29', 'INVALID_DATE'], ['2026-02-30', 'INVALID_DATE'], ['0000-01-01', 'INVALID_DATE'], ['26-01-01', 'INVALID_DATE_FORMAT'], ['2026-10-03', 'FUTURE_BIRTH_DATE']]) assert.throws(() => birth(date, '2026-10-02', PROFILES[0]), { code });
assert.doesNotThrow(() => birth('2000-02-29', '2026-10-02', PROFILES[0]));
assert.throws(() => birth('2000-01-01', '2026-10-02'), { code: 'PROFILE_REQUIRED' });
let dates = 0;
for (let d = new Date('1900-01-01T12:00:00Z'); d < new Date('2100-01-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10), a = birth(date, '2099-12-31', PROFILES[0]), b = birth(date, '2099-12-31', PROFILES[1]);
  assert.equal(a.star.D.value, a.core9.destiny.value);
  assert.equal(a.star.E.value, reduceNumber(2 * a.star.D.value).value);
  assert.equal(a.star.F.value, reduceNumber(4 * a.star.D.value).value);
  for (const k of Object.keys(a.star)) {
    assert.ok(a.star[k].value >= 1 && a.star[k].value <= 9 && b.star[k].value >= 1 && b.star[k].value <= 22);
    assert.equal(a.star[k].value, reduceNumber(b.star[k].value).value);
  }
  dates++;
}
assert.equal(dates, 73049);
for (const [text, expected] of [['Е', 6], ['Ё', 7], ['Е\u0308', 7], ['Ъ', 1], ['Ь', 3], ['Иван', 2], ['Кристина', 6], ['Егиазарова', 6], ['Суреновна', 6], ['Лунарио', 4], ['Anna-Maria', 9]]) assert.equal(name(text).value, expected, text);
for (const [text, code] of [['--', 'EMPTY_NAME'], ['Ивaн', 'MIXED_ALPHABETS'], ['A1', 'UNSUPPORTED_CHARACTER'], ['Émile', 'UNSUPPORTED_CHARACTER'], ['ß', 'UNSUPPORTED_CHARACTER'], ['ı', 'UNSUPPORTED_CHARACTER'], ['A'.repeat(201), 'TEXT_TOO_LONG']]) assert.throws(() => name(text), { code });
assert.equal(names({ firstName: 'Кристина', lastName: 'Белова' }).expression.value, 11);
assert.equal(names({ firstName: 'Михаил', lastName: 'Сорокин', patronymic: 'Сергеевич' }).expression.value, 22);
assert.equal(names({ firstName: 'Кристина', lastName: 'Егиазарова', patronymic: 'Суреновна' }).expression.value, 9);
assert.equal(names({ firstName: 'Кристина' }).status, 'insufficient_input');
assert.equal(names({ firstName: 'Иван', lastName: 'Smith' }).errors.expression, 'MIXED_ALPHABETS');
assert.equal(names({ firstName: 'Иван', lastName: 'Иванов', everydayName: 'John' }).status, 'available');

const dir = mkdtempSync(join(tmpdir(), 'lunario-numerology-'));
let server, db;
try {
  db = new DatabaseSync(join(dir, 'app.db')); migrate(db, () => {}); verifySchema(db); migrate(db, () => {});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM numerology_texts').get().n, 99);
  for (const c of CATALOG.cards) {
    const stored = JSON.parse(db.prepare('SELECT payload FROM numerology_texts WHERE section=? AND number=?').get(c.section, c.value).payload);
    assert.deepEqual(stored, c);
  }
  db.prepare('INSERT INTO users(id,created_at,last_seen,birth) VALUES(1,?,?,?)').run('2026-10-02', '2026-10-02', '1984-04-06');
  db.prepare('INSERT INTO users(id,created_at,last_seen,birth) VALUES(2,?,?,?)').run('2026-10-02', '2026-10-02', '1994-07-14');
  const cipher = privateText(dir), service = createNumerology({ db, open: cipher.open, seal: cipher.seal, mutate: createMutation(db) });
  const user = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  let a = service.save(user(1), { firstName: 'Кристина', lastName: 'Белова', businessName: 'Лунарио' }, '2026-10-02');
  assert.equal(a.nameReadings.find(r => r.id === 'expression').content, null);
  assert.equal(a.nameReadings.find(r => r.id === 'expression').value, 11);
  assert.ok(user(1).numerology_data.startsWith('enc1:')); assert.ok(hasEncrypted(db));
  assert.equal(service.result(user(2), '2026-10-02').inputs.firstName, '');
  assert.ok(!JSON.stringify(service.result(user(2), '2026-10-02')).includes('Кристина'));
  const revision = user(1).data_rev;
  a = service.save(user(1), { firstName: 'Ивaн' }, '2026-10-02');
  assert.equal(a.ok, false); assert.equal(a.result.birthReadings.length, 8); assert.equal(user(1).data_rev, revision);
  assert.equal(service.result(user(1), '2026-10-02').inputs.firstName, 'Кристина');
  a = service.save(user(1), { profile: PROFILES[1] }, '2026-10-02');
  for (const r of a.birthReadings.filter(r => r.namespace === 'star22')) assert.equal(r.content, null);
  assert.equal(personalExport(db, user(1), cipher.open).numerology.firstName, 'Кристина');
  clearHistory(db, user(1)); assert.equal(service.result(user(1), '2026-10-02').inputs.firstName, 'Кристина');
  db.prepare("UPDATE users SET last_seen='2000-01-01' WHERE id=1").run();
  sweepAbandoned(db); assert.ok(user(1), 'A saved digital map is personal data, not an empty abandoned account');
  deleteAccount(db, user(1)); assert.equal(user(1), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM numerology_texts').get().n, 99);

  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r));
  let logs = '';
  server = spawn(process.execPath, ['backend/server.mjs'], { cwd: resolve('.'), env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app', DATA_DIR: dir, CONTENT_DIR: resolve('content'), CITIES_DB: resolve('backend/cities.db'), SITE_DIR: resolve('site'), PUBLIC_BASE: `http://127.0.0.1:${port}`, LUNARIO_QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  const base = `http://127.0.0.1:${port}/app`;
  for (let i = 0; i < 150; i++) { if (server.exitCode !== null) throw new Error(logs); try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await delay(100); }
  assert.equal((await fetch(base + '/api/numerology/map')).status, 401);
  const cookies = [];
  for (const date of ['1984-04-06', '1994-07-14']) {
    const me = await fetch(base + '/api/me'); const cookie = me.headers.get('set-cookie').split(';')[0]; cookies.push(cookie);
    assert.equal((await fetch(base + '/api/profile', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Тест', birth: date, city: '', consent: true }) })).status, 200);
  }
  const req = (i, path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie: cookies[i], 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const before = await (await req(0, '/api/numerology')).json();
  a = await (await req(0, '/api/numerology/map', { firstName: 'Ёлка', lastName: 'Белова', businessName: 'Лунарио', user_id: 2, birth: '2001-01-01' })).json();
  assert.equal(a.inputs.firstName, 'Ёлка'); assert.equal(a.birth.birthDate, '1984-04-06');
  const b = await (await req(1, '/api/numerology/map?user_id=2')).json();
  assert.equal(b.birth.birthDate, '1994-07-14'); assert.equal(b.inputs.firstName, '');
  assert.equal(b.birthReadings.length, 8); assert.equal(b.cards, undefined);
  const own = await (await req(0, '/api/numerology/map')).json(); assert.equal(own.inputs.firstName, 'Ёлка');
  assert.deepEqual((await (await req(0, '/api/numerology')).json()).year, before.year);
  assert.equal((await req(0, '/api/numerology/map', { firstName: 'Ивaн' })).status, 422);
  assert.equal((await req(0, '/api/numerology/map', { profile: 'unknown' })).status, 422);
  assert.equal((await fetch(base + '/data/numerology-v1.json')).status, 404);
  assert.equal((await fetch(base + '/backend/data/numerology-v1.json')).status, 404);
  console.log(`PASS: ${dates} dates in 2 profiles; reference formulas; Unicode; 99 verbatim cards; encryption, persistence, export, deletion; HTTP account isolation and unchanged personal year`);
} finally {
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  db?.close(); rmSync(dir, { recursive: true, force: true });
}
