/* Три напоминания — утро, вечер, неделя (решение владелицы 16.09). Человек включает каждое, выбирает время,
   для недели — день. Утро — настрой дня и выбранные плитки утра; вечер — «Что хочется оставить от этого дня?»
   (молчит, если день уже записан); неделя — «Моя неделя: про что она». В пуш ничего не дописывается.

   Как доходит: планировщик (send-daily.mjs, раз в 5 минут) находит напоминания, у которых
   подошло время, собирает текст, кладёт его в очередь push_queue и шлёт в браузер пустой
   сигнал. Service worker по сигналу забирает тексты из очереди (/api/push/next) и показывает.
   Так личное не летит через чужие почтовые службы — только «проснись».
   В оболочке App Store веб-пуша нет: там те же настройки превращаются в локальные
   уведомления телефона (NativeBridge.swift), сервер ничего не шлёт. */
import { tzOffsetMinutes } from './cities.mjs';
import { lunarDay } from './lunar.mjs';
import { sendPush } from './push.mjs';
import * as C from './content.mjs';
import { preferences } from './experience.mjs';
import { MSK, MOSCOW, dayIn, plural } from './util.mjs';

export const FEATURES = {
  morning: { title: 'Утро',    hint: 'Настрой дня и то, что вы выбрали на «Сегодня»',      time: '09:00', freq: 'daily',  weekday: 7, url: '/app/?open=today' },
  evening: { title: 'Вечер',   hint: 'Запомнить этот день — молчит, если день уже записан', time: '21:00', freq: 'daily',  weekday: 7, url: '/app/?open=diary' },
  week:    { title: 'Неделя',  hint: 'Моя неделя: про что она',                             time: '13:00', freq: 'weekly', weekday: 7, url: '/app/?open=week' },
};
/* Прежние восемь поштучных напоминаний: переносятся один раз в три новых, дальше не показываются и не срабатывают */
const LEGACY = { morning: ['card', 'lunar', 'sky'], evening: ['mood', 'habits', 'askesis', 'gratitude'], week: ['moodreport'] };
const FREQS = ['daily', 'weekdays', 'weekly'];
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

let db = null, hooks = {};
export function initReminders(database, h = {}) {
  db = database; hooks = h;   // habitList/askesisList из сервера — чтобы тексты считались одинаково
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
  if (!db.prepare('PRAGMA table_info(push_queue)').all().some(c => c.name === 'endpoint'))
    db.exec("ALTER TABLE push_queue ADD COLUMN endpoint TEXT NOT NULL DEFAULT ''");
  /* Раньше было одно напоминание — о карте дня в 9 утра для всех, кто подписался.
     Переносим его в новую систему один раз, чтобы у людей ничего не пропало. */
  if (!db.prepare('SELECT COUNT(*) c FROM reminders').get().c) {
    const users = db.prepare('SELECT DISTINCT user_id FROM push_subs').all();
    for (const { user_id } of users) saveReminder(user_id, { feature: 'morning', enabled: true });
    if (users.length) console.log(`Напоминания: перенесено прежних подписок на карту дня — ${users.length}`);
  }
  migrateLegacyReminders();
}
/* Восемь поштучных → три. Утро берёт самое раннее время из включённых утренних, вечер — самое позднее из вечерних,
   неделя — день и время отчёта по настроениям. Прежние строки выключаются, чтобы не срабатывать, но не удаляются. */
export function migrateLegacyReminders() {
  const legacyKeys = Object.values(LEGACY).flat();
  const users = db.prepare(`SELECT DISTINCT user_id FROM reminders WHERE feature IN (${legacyKeys.map(() => '?').join(',')}) AND enabled = 1`).all(...legacyKeys).map((r) => r.user_id);
  let moved = 0;
  for (const uid of users) {
    if (db.prepare("SELECT 1 FROM reminders WHERE user_id = ? AND feature IN ('morning','evening','week')").get(uid)) continue;
    for (const [feature, olds] of Object.entries(LEGACY)) {
      const rows = db.prepare(`SELECT * FROM reminders WHERE user_id = ? AND enabled = 1 AND feature IN (${olds.map(() => '?').join(',')})`).all(uid, ...olds);
      if (!rows.length) continue;
      const times = rows.map((r) => r.time).sort();
      const time = feature === 'morning' ? times[0] : feature === 'evening' ? times[times.length - 1] : rows[0].time;
      saveReminder(uid, { feature, enabled: true, time, tz: rows[0].tz || '', ...(feature === 'week' ? { freq: 'weekly', weekday: rows[0].weekday } : {}) });
    }
    moved++;
  }
  db.prepare(`UPDATE reminders SET enabled = 0, next_at = '' WHERE feature IN (${legacyKeys.map(() => '?').join(',')}) AND enabled = 1`).run(...legacyKeys);
  if (moved) console.log(`Напоминания: перенесено на три пуша — ${moved}`);
  return moved;
}

/* Следующий момент срабатывания (мс UTC) — в часовом поясе человека. */
export function nextAt(r, fromMs = Date.now()) {
  const tz = r.tz && validTz(r.tz) ? r.tz : MSK;
  let day = dayIn(tz, fromMs);
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
  if (feature === 'week') freq = 'weekly';   /* неделя — всегда раз в неделю */
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

/* ── текст уведомления по функции; null — сегодня напоминать не о чем ── */
/* Текст из content/напоминания.txt с подстановками {…}; лишние подстановки убираются */
const firstSentence = (s) => { const m = String(s || '').match(/^.+?[.!?…](\s|$)/); return (m ? m[0] : String(s || '')).trim(); };
/* Темы чтения человека: если выбрана ровно одна содержательная тема и у дня есть такой раздел — {title, text} */
export function lunarTopicLine(u, n) {
  const content = (preferences(u.preferences).topics || []).filter((k) => !C.READING_META.has(k));
  if (content.length !== 1) return null;
  const day = C.LUNAR_INFO.find((d) => d.n === n), sec = day && (day.sections || []).find((s) => s.key === content[0]);
  const para = sec && sec.blocks.find((b) => b.t === 'p');
  return para ? { title: sec.title, text: firstSentence(para.text) } : null;
}
const tpl = (key, vars) => {
  const [title, body] = C.REMINDER_TEXTS[key] || ['Лунарио', ''];
  const fill = (t) => String(t).replace(/\{([^}]+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : '')).replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  return { title: fill(title), body: fill(body) };
};
/* День человека — тем же правилом, что сервер (userDay): пояс устройства из preferences.tz → пояс города из анкеты → Москва.
   Иначе вечерний пуш «не видит» записанный день у тех, кто западнее Москвы, а утро снимает настрой на вчера у тех, кто восточнее. */
export function userDayOf(u, atMs = Date.now()) {
  const p = preferences(u.preferences);
  return dayIn(p.tz && validTz(p.tz) ? p.tz : u.tz && validTz(u.tz) ? u.tz : MSK, atMs);
}
export function notificationFor(feature, u, atMs = Date.now(), tz = u.tz || MSK) {
  if (!FEATURES[feature]) return null;
  const d = userDayOf(u, atMs), url = FEATURES[feature].url;
  if (feature === 'morning') return morningNotification(u, d, atMs, tz);
  if (feature === 'evening') {
    if (dayRemembered(u.id, d)) return null;   /* день уже записан — не напоминаем */
    return { ...tpl('evening'), url };
  }
  if (feature === 'week') {
    const n = weekMoments(u.id, d);
    if (!n) return null;                        /* записей не было — пуш не нужен, экран скажет, что это нормально */
    if (n < 3) return { ...tpl('week-мало', { n, 'момента': plural(n, 'момент', 'момента', 'моментов') }), url };
    return { ...tpl('week'), url };
  }
  return null;
}
/* Утро: заголовок — настрой дня, тело — по строке на каждую выбранную плитку. Пакет утра считает сервер (hooks.morningPack). */
function morningNotification(u, d, atMs, tz) {
  const pack = hooks.morningPack ? hooks.morningPack(u, d) : null;
  const url = FEATURES.morning.url;
  if (!pack) return { ...tpl('morning-пусто'), url };
  const lines = [];
  for (const k of pack.chosen || []) {
    if (k === 'card' && pack.card) lines.push(`Карта дня — ${pack.card.name}${pack.card.keys ? ': ' + firstSentence(pack.card.keys) : ''}`);
    if (k === 'dayrune' && pack.rune) lines.push(`Руна дня — ${pack.rune.name}${pack.rune.keyword ? ': ' + pack.rune.keyword : ''}`);
    if (k === 'sky' && pack.sky) lines.push(`Планеты — ${pack.sky.title}`);   /* то же событие, что задаёт тему и стоит на плитке */
    if (k === 'day' && pack.forecast) lines.push(`${pack.forecast.title} — ${firstSentence(pack.forecast.text)}`);
    if (k === 'lunar') { const ld = lunarDay(atMs, u.lat ?? MOSCOW.lat, u.lon ?? MOSCOW.lon); if (ld) { const [name, advice] = C.LUNAR_DAYS[ld.n - 1] || ['', '']; const topic = lunarTopicLine(u, ld.n); lines.push(`${ld.n}-й лунный день · ${name} — ${topic ? topic.text : firstSentence(advice)}`); } }
    if (k === 'tone' && pack.question) lines.push(`Вопрос дня — ${pack.question}`);
  }
  const title = pack.set ? pack.set.text : tpl('morning-пусто').title;
  return { title: title.slice(0, 120), body: (lines.join('\n') || (pack.theme ? pack.theme.title : '')).slice(0, 480), url };
}
/* День записан — если сегодня есть хоть что-то: запись, настроение, отметка привычки или аскезы */
export function dayRemembered(userId, d) {
  return !!(db.prepare("SELECT 1 FROM journal WHERE user_id = ? AND day = ? AND kind <> 'weekly' LIMIT 1").get(userId, d)
    || db.prepare('SELECT 1 FROM moods WHERE user_id = ? AND day = ? LIMIT 1').get(userId, d)
    || db.prepare('SELECT 1 FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day = ? LIMIT 1').get(userId, d)
    || db.prepare('SELECT 1 FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ? LIMIT 1').get(userId, d));
}
/* Сколько моментов сохранено за неделю: записи всех видов и отмеченные настроения */
export function weekMoments(userId, d) {
  const since = new Date(Date.parse(d + 'T12:00:00Z') - 6 * 864e5).toISOString().slice(0, 10);
  return db.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day BETWEEN ? AND ? AND kind <> 'weekly'").get(userId, since, d).c
    + db.prepare('SELECT COUNT(*) c FROM moods WHERE user_id = ? AND day BETWEEN ? AND ?').get(userId, since, d).c;
}

/* Локальные уведомления телефона (оболочка App Store): план на 14 дней для одного из трёх напоминаний.
   Утро — настрой каждого дня (пара снимается заранее, поэтому утром на «Сегодня» будет та же); вечер и неделя — общий текст. */
export function nativePlan(u, feature, fromMs = Date.now()) {
  const r = listReminders(u.id).find((x) => x.feature === feature);
  if (!r?.enabled) return { items: [] };
  const tz = r.tz || MSK, items = []; let cursor = fromMs;
  for (let i = 0; i < 14; i++) {
    const at = nextAt(r, cursor); if (!at) break;
    const day = dayIn(tz, at), n = feature === 'morning' ? morningNotification(u, userDayOf(u, at), at, tz) : { ...tpl(feature), url: FEATURES[feature].url };
    if (n) items.push({ date: day, ...n });
    cursor = at + 1000;
  }
  return { items, tz, time: r.time };
}

export function previewNotification(u, feature) {
  if (!FEATURES[feature]) return null;
  return notificationFor(feature, u) || (feature === 'evening' ? { ...tpl('evening'), url: FEATURES.evening.url } : feature === 'week' ? { ...tpl('week'), url: FEATURES.week.url } : null) || { title: FEATURES[feature].title, body: 'Пробное уведомление — всё готово к вашим напоминаниям', url: FEATURES[feature].url };
}

/* ── планировщик: что подошло по времени — в очередь и в браузеры ── */
export async function runDue(keys, log = console.log, deliver = sendPush) {
  const now = Date.now(), nowISO = new Date(now).toISOString();
  const due = db.prepare("SELECT * FROM reminders WHERE enabled = 1 AND next_at <> '' AND next_at <= ?").all(nowISO);
  const byUser = new Map();
  for (const r of due) {
    const late = now - Date.parse(r.next_at) > 3 * 3600e3;   // сервер лежал — не досылаем вчерашнее
    let n = null;
    if (!late && FEATURES[r.feature]) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id);
      try { n = u ? notificationFor(r.feature, u, now, r.tz || u.tz || MSK) : null; } catch (e) { log('не собралось:', r.feature, e.message); }
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
        if (await deliver({ endpoint: s.endpoint }, keys)) { stat.sent++; db.prepare('UPDATE push_subs SET last_ok = ?, last_sent = ? WHERE endpoint = ?').run(nowISO.slice(0, 10), nowISO, s.endpoint); }
        else { db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); stat.gone++; }
      } catch (e) { stat.failed++; log('не ушло:', e.message); }
    }
  }
  db.prepare('DELETE FROM push_queue WHERE ts < ?').run(new Date(now - 2 * 864e5).toISOString());
  db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(nowISO);
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(new Date(now - 400 * 864e5).toISOString());
  db.prepare('DELETE FROM push_shown WHERE item_id NOT IN (SELECT id FROM push_queue)').run();
  return stat;
}

/* Что показать по сигналу: свежие тексты, которые это устройство ещё не показывало. */
export function pendingFor(userId, endpoint) {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const items = db.prepare("SELECT id, feature, title, body, url FROM push_queue WHERE user_id = ? AND ts >= ? AND (endpoint = '' OR endpoint = ?) ORDER BY id").all(userId, since, endpoint || '')
    .filter((it) => !endpoint || !db.prepare('SELECT 1 FROM push_shown WHERE item_id = ? AND endpoint = ?').get(it.id, endpoint));
  if (endpoint) for (const it of items) db.prepare('INSERT OR IGNORE INTO push_shown (item_id, endpoint) VALUES (?,?)').run(it.id, endpoint);
  return items;
}

/* Пробное уведомление прямо сейчас — чтобы человек увидел, как оно выглядит. */
export async function sendNow(u, feature, keys, endpoint = '', deliver = sendPush) {
  const n = previewNotification(u, feature);
  if (!n) return { ok: false, error: 'bad_feature' };
  const subs = endpoint ? db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ? AND endpoint = ?').all(u.id, endpoint)
    : db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all(u.id);
  if (!subs.length) return { ok: false, error: 'no_push' };
  db.prepare('INSERT INTO push_queue (user_id, ts, feature, title, body, url, endpoint) VALUES (?,?,?,?,?,?,?)').run(u.id, new Date().toISOString(), feature, n.title, n.body, n.url, endpoint);
  let sent = 0;
  for (const s of subs) { try { if (await deliver({ endpoint: s.endpoint }, keys)) sent++; else db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); } catch { /* почтовая служба не ответила */ } }
  return { ok: sent > 0, sent, preview: n };
}
