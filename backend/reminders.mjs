/* Напоминания по функциям: карта дня, настроение, отчёт по настроениям, привычки, аскеза,
   лунный день, небо. Человек сам включает каждое, выбирает время и регулярность.

   Как доходит: планировщик (send-daily.mjs, раз в 5 минут) находит напоминания, у которых
   подошло время, собирает текст, кладёт его в очередь push_queue и шлёт в браузер пустой
   сигнал. Service worker по сигналу забирает тексты из очереди (/api/push/next) и показывает.
   Так личное не летит через чужие почтовые службы — только «проснись».
   В оболочке App Store веб-пуша нет: там те же настройки превращаются в локальные
   уведомления телефона (NativeBridge.swift), сервер ничего не шлёт. */
import { tzOffsetMinutes } from './cities.mjs';
import { lunarDay } from './lunar.mjs';
import { skyNow } from './sky.mjs';
import { sendPush } from './push.mjs';
import * as C from './content.mjs';

export const FEATURES = {
  card:       { title: 'Карта дня',            hint: 'Утром: карта дня готова',                   time: '09:00', freq: 'daily',  weekday: 7, url: '/app/?open=card' },
  mood:       { title: 'Настроение дня',       hint: 'Вечером: как прошёл день',                  time: '21:00', freq: 'daily',  weekday: 7, url: '/app/?open=mood' },
  moodreport: { title: 'Отчёт по настроениям', hint: 'Раз в неделю: итог по отметкам',            time: '20:00', freq: 'weekly', weekday: 7, url: '/app/?open=moodreport' },
  habits:     { title: 'Дневник привычек',     hint: 'Вечером: отметить привычки',                time: '20:00', freq: 'daily',  weekday: 7, url: '/app/?open=habits' },
  askesis:    { title: 'Аскеза',               hint: 'Утром: какой сегодня день аскезы',          time: '08:00', freq: 'daily',  weekday: 7, url: '/app/?open=askesis' },
  lunar:      { title: 'Лунный день',          hint: 'Утром: лунный день и рекомендация',         time: '09:00', freq: 'daily',  weekday: 7, url: '/app/?open=lunar' },
  sky:        { title: 'На небе',              hint: 'Когда что-то происходит: полнолуние, затмение, ретроградный Меркурий', time: '10:00', freq: 'events', weekday: 7, url: '/app/?open=sky' },
};
const FREQS = ['daily', 'weekdays', 'weekly', 'events'];
const MSK = 'Europe/Moscow';
const todayMSK = () => new Date().toLocaleDateString('sv-SE', { timeZone: MSK });
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

let db = null;
export function initReminders(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      user_id INTEGER NOT NULL, feature TEXT NOT NULL, enabled INTEGER DEFAULT 0,
      time TEXT DEFAULT '09:00', freq TEXT DEFAULT 'daily', weekday INTEGER DEFAULT 7, tz TEXT DEFAULT '',
      next_at TEXT DEFAULT '', last_at TEXT DEFAULT '', PRIMARY KEY (user_id, feature)
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (enabled, next_at);
    CREATE TABLE IF NOT EXISTS push_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ts TEXT NOT NULL,
      feature TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS push_shown (item_id INTEGER NOT NULL, endpoint TEXT NOT NULL, PRIMARY KEY (item_id, endpoint));
  `);
  /* Раньше было одно напоминание — о карте дня в 9 утра для всех, кто подписался.
     Переносим его в новую систему один раз, чтобы у людей ничего не пропало. */
  if (!db.prepare('SELECT COUNT(*) c FROM reminders').get().c) {
    const users = db.prepare('SELECT DISTINCT user_id FROM push_subs').all();
    for (const { user_id } of users) saveReminder(user_id, { feature: 'card', enabled: true });
    if (users.length) console.log(`Напоминания: перенесено прежних подписок на карту дня — ${users.length}`);
  }
}

/* Следующий момент срабатывания (мс UTC) — в часовом поясе человека. */
export function nextAt(r, fromMs = Date.now()) {
  const tz = r.tz && validTz(r.tz) ? r.tz : MSK;
  let day = new Date(fromMs).toLocaleDateString('sv-SE', { timeZone: tz });
  for (let i = 0; i < 400; i++) {
    const wd = ((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;   // 1 — понедельник … 7 — воскресенье
    const okDay = r.freq === 'weekly' ? wd === Number(r.weekday) : r.freq === 'weekdays' ? wd <= 5 : true;
    if (okDay) {
      const local = `${day}T${r.time}:00`;
      const ms = Date.parse(local + 'Z') - tzOffsetMinutes(tz, local) * 60000;
      if (ms > fromMs) return ms;
    }
    day = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  }
  return null;
}

const rowOf = (userId, feature) => db.prepare('SELECT * FROM reminders WHERE user_id = ? AND feature = ?').get(userId, feature);
const pub = (feature, row) => {
  const d = FEATURES[feature];
  const r = row || {};
  return { feature, title: d.title, hint: d.hint, enabled: !!r.enabled, time: r.time || d.time, freq: r.freq || d.freq, weekday: Number(r.weekday || d.weekday), tz: r.tz || '', nextAt: r.next_at || '' };
};
export const listReminders = (userId) => Object.keys(FEATURES).map((f) => pub(f, rowOf(userId, f)));

export function saveReminder(userId, patch) {
  const feature = String(patch.feature || '');
  const d = FEATURES[feature]; if (!d) return { ok: false, error: 'bad_feature' };
  const cur = rowOf(userId, feature) || { enabled: 0, time: d.time, freq: d.freq, weekday: d.weekday, tz: '' };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time || '') ? patch.time : cur.time;
  let freq = FREQS.includes(patch.freq) ? patch.freq : cur.freq;
  if (freq === 'events' && feature !== 'sky') freq = 'daily';
  const weekday = Number(patch.weekday) >= 1 && Number(patch.weekday) <= 7 ? Number(patch.weekday) : cur.weekday;
  const tz = typeof patch.tz === 'string' && validTz(patch.tz) ? patch.tz : cur.tz;
  const enabled = patch.enabled === undefined ? !!cur.enabled : !!patch.enabled;
  const r = { time, freq, weekday, tz };
  const next = enabled ? nextAt(r) : null;
  db.prepare(`INSERT INTO reminders (user_id, feature, enabled, time, freq, weekday, tz, next_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, feature) DO UPDATE SET enabled = excluded.enabled, time = excluded.time, freq = excluded.freq, weekday = excluded.weekday, tz = excluded.tz, next_at = excluded.next_at`)
    .run(userId, feature, enabled ? 1 : 0, time, freq, weekday, tz, next ? new Date(next).toISOString() : '');
  return { ok: true, item: pub(feature, rowOf(userId, feature)) };
}
export const clearReminders = (userId) => { db.prepare('DELETE FROM reminders WHERE user_id = ?').run(userId); db.prepare('DELETE FROM push_queue WHERE user_id = ?').run(userId); };

/* ── текст уведомления по функции; null — сегодня напоминать не о чем ── */
const plural = (n, a, b, c) => { const m = n % 100; if (m >= 11 && m <= 14) return c; const l = n % 10; return l === 1 ? a : l >= 2 && l <= 4 ? b : c; };
const MOOD_RU = { joy: 'радостно', calm: 'спокойно', tired: 'устало', anx: 'тревожно', sad: 'грустно' };
export function notificationFor(feature, u) {
  const d = todayMSK(), url = FEATURES[feature].url;
  if (feature === 'card') return { title: 'Лунарио', body: 'Ваша карта дня готова ✦', url };
  if (feature === 'mood') {
    if (db.prepare('SELECT 1 FROM moods WHERE user_id = ? AND day = ?').get(u.id, d)) return null;
    return { title: 'Как прошёл день?', body: 'Отметьте настроение — одно нажатие, и вечером станет яснее.', url };
  }
  if (feature === 'moodreport') {
    const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const moods = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id = ? AND day >= ? GROUP BY mood ORDER BY c DESC').all(u.id, since);
    const total = moods.reduce((s, m) => s + m.c, 0);
    if (!total) return { title: 'Отчёт по настроениям', body: 'На этой неделе отметок не было. Начните с сегодняшней — и через неделю будет картина.', url };
    const top = moods[0];
    return { title: 'Отчёт по настроениям за неделю', body: `Отмечено ${total} ${plural(total, 'день', 'дня', 'дней')}, чаще всего — ${MOOD_RU[top.mood] || top.mood}. Откройте, чтобы увидеть неделю целиком.`, url };
  }
  if (feature === 'habits') {
    const habits = db.prepare('SELECT id FROM habits WHERE user_id = ? AND archived = 0').all(u.id);
    if (!habits.length) return { title: 'Дневник привычек', body: 'Добавьте первую привычку — с одной маленькой начинается ритм.', url };
    const done = db.prepare(`SELECT COUNT(*) c FROM habit_marks WHERE day = ? AND habit_id IN (${habits.map(() => '?').join(',')})`).get(d, ...habits.map((h) => h.id)).c;
    const left = habits.length - done;
    if (left <= 0) return null;
    return { title: 'Привычки', body: `Осталось отметить: ${left} из ${habits.length}. Минута — и день закрыт ✦`, url };
  }
  if (feature === 'askesis') {
    const act = db.prepare("SELECT days, started FROM askesis WHERE user_id = ? AND status = 'active'").all(u.id)
      .map((a) => ({ n: Math.floor((Date.parse(d) - Date.parse(a.started)) / 864e5) + 1, days: a.days })).filter((a) => a.n >= 1 && a.n <= a.days);
    if (!act.length) return null;
    const line = act.map((a) => `день ${a.n} из ${a.days}`).join(' · ');
    return { title: act.length > 1 ? 'Аскезы' : 'Аскеза', body: `${line.charAt(0).toUpperCase()}${line.slice(1)} — отметьте, как прошёл день.`, url };
  }
  if (feature === 'lunar') {
    const ld = lunarDay(Date.now(), u.lat ?? 55.7558, u.lon ?? 37.6173);
    if (!ld) return null;
    const [name, advice] = C.LUNAR_DAYS[ld.n - 1] || ['Лунный день', ''];
    return { title: `${ld.n}-й лунный день · ${name}`, body: advice, url };
  }
  if (feature === 'sky') {
    const now = skyNow(Date.now(), u.tz || MSK);
    if (!now.today.length) return null;
    const first = now.today[0];
    return { title: 'На небе сегодня', body: `${now.today.map((e) => e.title).join(' · ')}. ${first.note}`.slice(0, 220), url };
  }
  return null;
}

/* ── планировщик: что подошло по времени — в очередь и в браузеры ── */
export async function runDue(keys, log = console.log) {
  const now = Date.now(), nowISO = new Date(now).toISOString();
  const due = db.prepare("SELECT * FROM reminders WHERE enabled = 1 AND next_at <> '' AND next_at <= ?").all(nowISO);
  const byUser = new Map();
  for (const r of due) {
    const late = now - Date.parse(r.next_at) > 3 * 3600e3;   // сервер лежал — не досылаем вчерашнее
    let n = null;
    if (!late && FEATURES[r.feature]) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id);
      try { n = u ? notificationFor(r.feature, u) : null; } catch (e) { log('не собралось:', r.feature, e.message); }
    }
    if (n) { if (!byUser.has(r.user_id)) byUser.set(r.user_id, []); byUser.get(r.user_id).push({ feature: r.feature, ...n }); }
    const next = nextAt(r, now);
    db.prepare('UPDATE reminders SET next_at = ?, last_at = ? WHERE user_id = ? AND feature = ?').run(next ? new Date(next).toISOString() : '', nowISO, r.user_id, r.feature);
  }
  const stat = { due: due.length, queued: 0, sent: 0, gone: 0, failed: 0 };
  for (const [uid, items] of byUser) {
    const subs = db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all(uid);
    if (!subs.length) continue;                                  // только оболочка iOS — там напоминает сам телефон
    for (const it of items) { db.prepare('INSERT INTO push_queue (user_id, ts, feature, title, body, url) VALUES (?,?,?,?,?,?)').run(uid, nowISO, it.feature, it.title, it.body, it.url); stat.queued++; }
    for (const s of subs) {
      try {
        if (await sendPush({ endpoint: s.endpoint }, keys)) stat.sent++;
        else { db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); stat.gone++; }
      } catch (e) { stat.failed++; log('не ушло:', e.message); }
    }
  }
  db.prepare('DELETE FROM push_queue WHERE ts < ?').run(new Date(now - 2 * 864e5).toISOString());
  db.prepare('DELETE FROM push_shown WHERE item_id NOT IN (SELECT id FROM push_queue)').run();
  return stat;
}

/* Что показать по сигналу: свежие тексты, которые это устройство ещё не показывало. */
export function pendingFor(userId, endpoint) {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const items = db.prepare('SELECT id, feature, title, body, url FROM push_queue WHERE user_id = ? AND ts >= ? ORDER BY id').all(userId, since)
    .filter((it) => !endpoint || !db.prepare('SELECT 1 FROM push_shown WHERE item_id = ? AND endpoint = ?').get(it.id, endpoint));
  if (endpoint) for (const it of items) db.prepare('INSERT OR IGNORE INTO push_shown (item_id, endpoint) VALUES (?,?)').run(it.id, endpoint);
  return items;
}

/* Пробное уведомление прямо сейчас — чтобы человек увидел, как оно выглядит. */
export async function sendNow(u, feature, keys) {
  const n = FEATURES[feature] ? (notificationFor(feature, u) || { title: FEATURES[feature].title, body: 'Сегодня напоминать не о чем — но напоминания работают ✦', url: FEATURES[feature].url }) : null;
  if (!n) return { ok: false, error: 'bad_feature' };
  const subs = db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all(u.id);
  if (!subs.length) return { ok: false, error: 'no_push' };
  db.prepare('INSERT INTO push_queue (user_id, ts, feature, title, body, url) VALUES (?,?,?,?,?,?)').run(u.id, new Date().toISOString(), feature, n.title, n.body, n.url);
  let sent = 0;
  for (const s of subs) { try { if (await sendPush({ endpoint: s.endpoint }, keys)) sent++; else db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); } catch { /* почтовая служба не ответила */ } }
  return { ok: sent > 0, sent, preview: n };
}
