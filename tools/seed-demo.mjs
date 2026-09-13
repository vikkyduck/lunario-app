/* Демо-данные для кабинета на ТЕСТОВОМ стенде: вымышленные пользователи с почтой demo-N@example.com
   и событиями за последние 45 дней. Запуск на сервере: node seed-demo.mjs /opt/lunario-app-test/data/app.db
   На проде запускать нельзя — проверка по имени файла. */
import { DatabaseSync } from 'node:sqlite';
const file = process.argv[2] || '';
if (!file.includes('lunario-app-test')) { console.error('только тестовая база'); process.exit(1); }
const db = new DatabaseSync(file);
const FUNC = ['card_open', 'mood_set', 'ask_yesno', 'ask_rune', 'ask_spread', 'journal_add', 'wish_add', 'compat_calc', 'worry_pick', 'share_card', 'invite_copy', 'push_on'];
const W = { card_open: 9, mood_set: 7, ask_yesno: 5, ask_rune: 3, ask_spread: 2, journal_add: 3, wish_add: 2, compat_calc: 1, worry_pick: 3, share_card: 1, invite_copy: 1, push_on: 1 };
let seed = 20260913; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = () => { const tot = Object.values(W).reduce((a, b) => a + b, 0); let r = rnd() * tot; for (const [k, w] of Object.entries(W)) { if ((r -= w) <= 0) return k; } return 'card_open'; };
const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const cities = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Краснодар'];
const names = ['Анна', 'Мария', 'Елена', 'Ольга', 'Дарья', 'Ирина', 'Наталья', 'Юлия', 'Алина', 'Вера'];
db.exec("DELETE FROM events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'demo-%@example.com')");
db.exec("DELETE FROM users WHERE email LIKE 'demo-%@example.com'");
const insU = db.prepare('INSERT INTO users (created_at, last_seen, name, birth, city, email, email_at, onboarded, consent_version, consent_ts) VALUES (?,?,?,?,?,?,?,1,?,?)');
const insE = db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)');
let users = 0, events = 0;
for (let i = 1; i <= 70; i++) {
  const regAgo = Math.floor(rnd() * 44);                       // день регистрации: 0..43 дня назад
  const regDay = day(regAgo), ts = regDay + 'T' + String(8 + Math.floor(rnd() * 12)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':00.000Z';
  const r = insU.run(ts, ts, names[i % names.length], `19${80 + (i % 20)}-0${1 + (i % 9)}-1${i % 9}`, cities[i % cities.length], `demo-${i}@example.com`, ts, '1', ts);
  const uid = Number(r.lastInsertRowid); users++;
  insE.run(ts, regDay, uid, 'login_done', '', '30-39'); insE.run(ts, regDay, uid, 'app_open', '', '30-39'); events += 2;
  const habit = rnd();                                         // 0.35 — заглянул и ушёл, 0.45 — иногда, 0.2 — постоянный
  const p = habit < 0.35 ? 0.08 : habit < 0.8 ? 0.35 : 0.8;
  if (rnd() < 0.75) { insE.run(ts, regDay, uid, pick(), '', '30-39'); events++; }   // активация в первый день
  for (let d = regAgo - 1; d >= 0; d--) {
    if (rnd() > p) continue;
    const dd = day(d), t = dd + 'T' + String(7 + Math.floor(rnd() * 14)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':00.000Z';
    insE.run(t, dd, uid, 'app_open', '', '30-39'); events++;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) { insE.run(t, dd, uid, pick(), '', '30-39'); events++; }
  }
}
// пара строк расходов на текущий месяц и прошлый
const month = new Date().toISOString().slice(0, 7);
const prev = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7);
db.exec("DELETE FROM costs WHERE name LIKE 'демо:%'");
const insC = db.prepare('INSERT INTO costs (month, name, amount, kind, ts) VALUES (?,?,?,?,?)');
insC.run(month, 'демо: сервер Timeweb', 1090, 'fixed', new Date().toISOString());
insC.run(month, 'демо: домен и почта', 350, 'fixed', new Date().toISOString());
insC.run(month, 'демо: бюджет', 5000, 'budget', new Date().toISOString());
insC.run(prev, 'демо: сервер Timeweb', 1090, 'fixed', new Date().toISOString());
insC.run(prev, 'демо: домен и почта', 350, 'fixed', new Date().toISOString());
console.log(`демо: пользователей ${users}, событий ${events}`);
