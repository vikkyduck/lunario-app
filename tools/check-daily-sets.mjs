import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDailySets, dailySet } from '../backend/daily-sets.mjs';
import { migrate } from '../backend/schema.mjs';   /* таблицу и колонки создают миграции, не модуль (F12) */
/* Настрой дня: пары «настрой | вопрос» по темам. Внутри темы — без повторов, пока тема не исчерпана; исчерпана — по второму
   кругу (allowRepeat), но никогда пусто. Выпавшая пара снимается в daily_sets и в течение дня не меняется.
   Папка текстов в git не попадает, поэтому чередование проверяется на условных парах; у владельца — и на настоящих. */
import { fileURLToPath } from 'node:url';
process.env.CONTENT_DIR ||= fileURLToPath(new URL('../content', import.meta.url)); process.env.LUNARIO_QUIET = '1';   /* .pathname ломал кириллический путь (R15) */
const C = await import('../backend/content.mjs');
const real = [...C.NASTROY], themes = [...C.THEMES];
if (real.length) {
  assert.ok(themes.length >= 12, 'twelve themes');
  assert.ok(real.every((n) => themes.some((t) => t.key === n[0]) && n[1] && /\?\s*$/.test(n[2])), 'every настрой has a known theme and a question');
  for (const t of themes) assert.ok(real.some((n) => n[0] === t.key), `theme «${t.title}» has at least one настрой`);
  assert.equal(C.themeOf('тон', 'День границ'), 'границы'); assert.equal(C.themeOf('карта', 'star'), 'восстановление'); assert.equal(C.themeOf('небо', 'фаза full'), 'выдох'); assert.equal(C.themeOf('руна', 'nope'), null);
} else console.log('Папки текстов нет — содержимое не проверяется, чередование проверяется на условных парах');
const pool = (n) => Array.from({ length: n }, (_, i) => [i + 1, `Настрой ${i}`, `Вопрос ${i}?`]);
const db = new DatabaseSync(':memory:'); migrate(db, () => {}); initDailySets(db);
const day = (i) => new Date(Date.UTC(2027, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const four = pool(4), seen = [];
for (let i = 0; i < 4; i++) { const r = dailySet(db, { id: 1, name: 'Анна' }, day(i), four); assert.ok(r?.text && r.question && !r.text.includes('{Имя}')); assert.ok(!seen.includes(r.text), 'no repeat while the theme has fresh lines'); seen.push(r.text); assert.deepEqual(dailySet(db, { id: 1, name: 'Анна' }, day(i), [...four].reverse()), r, 'reload/reorder keeps the day'); }
assert.equal(dailySet(db, { id: 1, name: 'Анна' }, day(4), four), null, 'exhausted theme returns null without allowRepeat');
const again = dailySet(db, { id: 1, name: 'Анна' }, day(4), four, { allowRepeat: true }); assert.ok(again?.text && seen.includes(again.text), 'exhausted theme goes round again');
assert.equal(dailySet(db, { id: 1, name: 'Анна' }, day(4), four).text, again.text, 'the repeated pair is snapshotted too');
const big = pool(400), texts = new Set();
for (let i = 0; i < 365; i++) texts.add(dailySet(db, { id: 2, name: 'Анна' }, day(i), big).text);
assert.equal(texts.size, 365, 'a big pool never repeats within a year');
assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_sets').get().n, 5 + 365);
const stale = new DatabaseSync(':memory:'); stale.exec(`CREATE TABLE daily_sets(user_id INTEGER,day TEXT,idx INTEGER,PRIMARY KEY(user_id,day)); INSERT INTO daily_sets VALUES(7,'2026-09-14',0);`);
migrate(stale, () => {}); initDailySets(stale); assert.ok(dailySet(stale, { id: 7, name: 'Анна' }, '2026-09-14', four)?.text, 'an old index-only row gets a fresh pair');
db.close(); stale.close();
console.log(`PASS: ${real.length ? `${real.length} настроев в ${themes.length} темах, ` : ''}theme pools without repeats until exhausted, second round on exhaustion, daily snapshot, legacy rows.`);
