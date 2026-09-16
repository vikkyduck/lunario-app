/* Отчёты рабочих кабинетов. Один источник данных — те же таблицы, что у приложения.
   Каждый отчёт отдаёт одинаковую структуру: kpis → charts → tables → how.
   У показателя три честных состояния: число, «нет данных» (событие ещё не собирается)
   и «не запущено» (функции в продукте нет). Личных текстов здесь нет и быть не должно. */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { campaignList, campaignUsers, slaMetrics, ticketQueue, TICKET_STATUS } from './workspace.mjs';
import * as C from './content.mjs';
import { preferences } from './experience.mjs';
import { MSK, dayIn, addDays } from './util.mjs';
import { CORE_EVENTS, EVENT_NAMES, FEATURE_EVENTS } from './events.mjs';

let db, DATA_DIR = '';
export function initReports(database, dataDir) {
  db = database; DATA_DIR = dataDir || '';
  db.exec('CREATE TABLE IF NOT EXISTS cabinet_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT DEFAULT \'\', updated_at TEXT DEFAULT \'\')');
}

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const inList = (arr) => arr.map((s) => `'${s}'`).join(',');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const delta = (cur, prev) => (cur === null || prev === null || prev === undefined ? null : prev ? Math.round(((cur - prev) / prev) * 100) : (cur ? null : 0));
export const dayMSK = (d = new Date()) => dayIn(MSK, d.getTime());
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const seriesDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const fill = (days, rows, key = 'n') => { const m = Object.fromEntries(rows.map((r) => [r.day, r[key]])); return days.map((d) => ({ x: d, y: m[d] || 0 })); };
const mask = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');
/* один форматтер на все события: toLocale*String создавал бы его заново на каждый из тысяч вызовов тепловой карты */
const HOUR_MSK = new Intl.DateTimeFormat('en-GB', { timeZone: MSK, hour: '2-digit', hourCycle: 'h23' });
const WD_MSK = new Intl.DateTimeFormat('en-GB', { timeZone: MSK, weekday: 'short' });
const hourMSK = (ts) => Number(HOUR_MSK.format(new Date(ts)).slice(0, 2));
const wdMSK = (ts) => WD_MSK.format(new Date(ts));

export function periodOf(q) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : dayMSK();
  const m = /^(\d{1,3})d$/.exec(q.period || '');
  const days = m ? Math.min(365, Math.max(1, Number(m[1]))) : 7;
  const preset = q.period === 'month' ? 'month' : `${days}d`;
  let from = preset === 'month' ? to.slice(0, 8) + '01' : addDays(to, -(days - 1));
  if (from > to) from = to;
  const len = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(len - 1));
  return { preset, from, to, prevFrom, prevTo, len };
}

/* ── справочники (значения по умолчанию; админ может менять их в конфигураторе) ── */
export const DEFAULT_PERIODS = [7, 30, 90];
export const OVERVIEW_BLOCKS = ['new_users', 'activation', 'active', 'repeat', 'retention', 'features', 'costs', 'problems'];
export const ROLE_MENUS = {
  admin:     ['overview', 'users', 'lifecycle', 'economy', 'ai', 'backlog', 'system', 'data', 'events', 'access', 'saved'],
  marketing: ['acquisition', 'campaigns', 'funnel', 'delivery', 'viral', 'audience', 'concerns', 'topics', 'heatmap', 'feedback', 'cohorts', 'notifications', 'saved'],
  product:   ['activity', 'retention', 'activation', 'features', 'topics', 'rituals', 'cohorts', 'notifications', 'ai', 'backlog', 'economy', 'lifecycle', 'supportmetrics', 'system', 'saved'],
  content:   ['materials', 'media', 'content', 'backlog', 'quality', 'concerns', 'rituals', 'feedback', 'faq', 'saved'],
  support:   ['tickets', 'supportmetrics', 'backlog', 'faq', 'users', 'delivery', 'saved'],
};
export const REPORT_META = {
  overview:      ['Единый дашборд', 'Что происходит с продуктом сейчас и куда перейти за объяснением'],
  acquisition:   ['Привлечение и кампании', 'Откуда приходят люди и сколько стоит тот, кто остаётся'],
  campaigns:     ['Кампании и UTM-ссылки', 'Что запускаем, сколько стоит и какой ссылкой ведём'],
  materials:     ['Материалы и публикации', 'Вопрос дня, аффирмации и заметки со статусами и датой показа'],
  media:         ['Картинки и файлы', 'Загрузить и получить ссылку для приложения'],
  backlog:       ['Задачи и беклог', 'Что поручено контенту и поддержке и в каком статусе'],
  funnel:        ['Воронка входа', 'Где люди останавливаются между приветствием и первым результатом'],
  delivery:      ['Коды на почту', 'Доходят ли письма с кодом и подтверждают ли почту'],
  viral:         ['Приглашения и карточки', 'Приводят ли люди других людей'],
  audience:      ['Портрет аудитории', 'Кто пользуется: возраст, город, часовой пояс, платформа'],
  concerns:      ['Темы и интересы', 'О чём спрашивают и какие ответы выбирают'],
  heatmap:       ['Когда активны', 'Часы, дни недели и фазы Луны'],
  feedback:      ['Обратная связь и NPS', 'Что говорят люди — с числом ответивших'],
  activity:      ['Активность и привычка', 'Размер аудитории и регулярность использования'],
  retention:     ['Удержание и возвраты', 'Возвращаются ли зрелые когорты после регистрации'],
  cohorts:       ['Сравнение когорт', 'Как отличаются группы по неделе, источнику и первой функции'],
  activation:    ['Первый результат', 'Доходит ли новичок до результата за 24 часа'],
  features:      ['Использование функций', 'Что пробуют, что используют повторно, что не замечают'],
  topics:        ['Темы чтения', 'Какие темы лунного дня выбирают и как это связано с возвращением'],
  rituals:       ['Ритуалы и постоянство', 'Какие ежедневные действия входят в привычку'],
  notifications: ['Пуши и ежедневные письма', 'Включают ли напоминания и возвращаются ли после них'],
  ai:            ['ИИ: провайдеры и расходы', 'Ключи GPT, Gemini, Алисы и ГигаЧата; токены и стоимость результата'],
  economy:       ['Экономика и бюджет', 'Расходы, прогноз и стоимость одного активного'],
  lifecycle:     ['Жизненный цикл', 'Стадии, предупреждения и удаления'],
  users:         ['Пользователи', 'Список для поиска и работы — без личных текстов'],
  events:        ['Журнал событий', 'Что фиксирует продукт по типам'],
  system:        ['Здоровье системы', 'Ошибки, ночные задачи, размер базы'],
  data:          ['Качество данных', 'Можно ли верить цифрам на дашбордах'],
  content:       ['Материалы', 'Тексты приложения: что есть и как правится'],
  quality:       ['Качество контента', 'Категории замечаний к текстам'],
  tickets:       ['Обращения', 'Очередь поддержки'],
  supportmetrics:['Работа поддержки', 'Скорость и качество ответов'],
  faq:           ['FAQ и «С чего начать»', 'Помогают ли подсказки без обращения'],
  saved:         ['Сохранённые отчёты', 'Отчёты с фильтрами, сохранённые в этом браузере'],
  access:        ['Управление доступами', 'Кто и куда заходит'],
};

/* ── конфигурация кабинетов: какие дашборды в какой роли, периоды, блоки сводки, названия ── */
const ROLE_KEYS = Object.keys(ROLE_MENUS);
const readSetting = (key) => { try { const r = db.prepare('SELECT value FROM cabinet_settings WHERE key = ?').get(key); return r ? JSON.parse(r.value) : null; } catch { return null; } };
export function getConfig() {
  const c = readSetting('config') || {};
  const menus = {}; for (const r of ROLE_KEYS) menus[r] = Array.isArray(c.menus && c.menus[r]) ? c.menus[r].filter((k) => k in REPORT_META) : [...ROLE_MENUS[r]];
  const periods = Array.isArray(c.periods) && c.periods.length ? c.periods : [...DEFAULT_PERIODS];
  const blocks = Array.isArray(c.blocks) ? c.blocks.filter((k) => OVERVIEW_BLOCKS.includes(k)) : [...OVERVIEW_BLOCKS];
  const titles = c.titles && typeof c.titles === 'object' ? c.titles : {};
  const reports = {}; for (const [k, v] of Object.entries(REPORT_META)) { const t = titles[k] || {}; reports[k] = [t.title || v[0], t.question || v[1]]; }
  return { menus, periods, blocks, titles, reports, custom: !!readSetting('config'), updated: (db.prepare('SELECT updated_by, updated_at FROM cabinet_settings WHERE key = ?').get('config') || {}) };
}
export function setConfig(input, by) {
  const c = input && typeof input === 'object' ? input : {};
  const menus = {};
  for (const r of ROLE_KEYS) {
    const arr = Array.isArray(c.menus && c.menus[r]) ? c.menus[r] : ROLE_MENUS[r];
    menus[r] = [...new Set(arr.map(String).filter((k) => k in REPORT_META))];
    if (!menus[r].length) return { ok: false, error: 'empty_menu', role: r };
  }
  const periods = [...new Set((Array.isArray(c.periods) ? c.periods : DEFAULT_PERIODS).map((x) => Math.round(Number(x))).filter((x) => x >= 1 && x <= 365))].sort((a, b) => a - b).slice(0, 8);
  if (!periods.length) return { ok: false, error: 'empty_periods' };
  const blocks = [...new Set((Array.isArray(c.blocks) ? c.blocks : OVERVIEW_BLOCKS).map(String).filter((k) => OVERVIEW_BLOCKS.includes(k)))];
  const titles = {};
  if (c.titles && typeof c.titles === 'object') for (const [k, v] of Object.entries(c.titles)) {
    if (!(k in REPORT_META) || !v || typeof v !== 'object') continue;
    const title = String(v.title || '').trim().slice(0, 80), question = String(v.question || '').trim().slice(0, 160);
    if ((title && title !== REPORT_META[k][0]) || (question && question !== REPORT_META[k][1])) titles[k] = { title: title || REPORT_META[k][0], question: question || REPORT_META[k][1] };
  }
  db.prepare('INSERT INTO cabinet_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .run('config', JSON.stringify({ menus, periods, blocks, titles }), String(by || ''), new Date().toISOString());
  return { ok: true };
}
export function resetConfig() { db.prepare('DELETE FROM cabinet_settings WHERE key = ?').run('config'); return { ok: true }; }

/* Функции продукта и содержательные действия — из общего реестра events.mjs (один источник для сервера и отчётов) */
export const FEATURES = FEATURE_EVENTS.map((e) => [e.key, e.section, e.title, 'работает']);
const FUNC = CORE_EVENTS;
const ACTIVE = ['app_open', ...FUNC];
const FNAME = Object.fromEntries(FEATURES.map((f) => [f[0], f[2]]));

const kpi = (title, value, o = {}) => ({ title, value, unit: o.unit || '', prev: o.prev ?? null, delta: o.delta === undefined ? delta(value, o.prev ?? null) : o.delta, sub: o.sub || '', state: o.state || (value === null ? 'nodata' : 'ok'), good: o.good || 'up' });
const off = (title, sub) => ({ title, value: null, unit: '', prev: null, delta: null, sub, state: 'off' });
const nodata = (title, sub) => ({ title, value: null, unit: '', prev: null, delta: null, sub, state: 'nodata' });
const chart = (type, title, subtitle, data, insight = '') => ({ type, title, subtitle, data, insight });
const table = (title, headers, rows, note = '') => ({ title, headers, rows, note });

/* ── базовые считалки ── */
const platformOf = (ua = '') => /LunarioShell-iOS|iPhone|iPad/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : ua ? 'Десктоп' : 'Неизвестно';
function userPlatforms() {
  const rows = all('SELECT user_id, ua FROM sessions ORDER BY last_seen');
  const m = {}; for (const r of rows) m[r.user_id] = platformOf(r.ua); return m;
}
const sourceOf = (u) => (u.utm_source ? u.utm_source : u.invited_by ? 'Приглашение' : 'Прямой / лендинг');
function registered(from, to) {
  return all(`SELECT id, email, name, city, city_region, tz, birth, invited_by, onboarded, utm_source, utm_medium, utm_campaign, utm_content, substr(email_at,1,10) day, created_at, last_seen FROM users
    WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ?`, from, to);
}
/* Кэш на время одного отчёта. Когорты перебираются в циклах (человек × окно), и раньше на каждого уходил
   свой запрос; теперь активные дни, первое действие, отметки настроения и подписки читаются одним запросом
   на всех и дальше ищутся в памяти. Живёт только внутри overview()/report(): следующий отчёт видит свежие данные. */
let memo = null;
const withMemo = (fn) => (...a) => { const outer = memo; if (!outer) memo = new Map(); try { return fn(...a); } finally { memo = outer; } };
function memoized(key, load) {
  if (!memo) return load();
  if (!memo.has(key)) memo.set(key, load());
  return memo.get(key);
}
/* дни с действиями из types по каждому человеку: Map(user_id → [день, …]) */
const daysOf = (types) => memoized('days:' + types.join(','), () => {
  const m = new Map();
  for (const r of all(`SELECT DISTINCT user_id, day FROM events WHERE type IN (${inList(types)})`)) { let d = m.get(r.user_id); if (!d) m.set(r.user_id, d = []); d.push(r.day); }
  return m;
});
const daysBetweenOf = (id, a, b, types) => (daysOf(types).get(id) || []).filter((x) => x >= a && x <= b).length;
/* первое содержательное действие человека: тип и момент */
function firstFunc(id) {
  if (!memo) return one(`SELECT type, ts FROM events WHERE user_id = ? AND type IN (${inList(FUNC)}) ORDER BY ts LIMIT 1`, id);
  return memoized('first', () => new Map(all(`SELECT user_id, type, MIN(ts) ts FROM events WHERE type IN (${inList(FUNC)}) GROUP BY user_id`).map((r) => [r.user_id, r]))).get(id) || null;
}
/* то же для когорты — один проход по индексу вместо запроса на каждого */
function firstFuncs(ids) {
  const m = new Map(); if (!ids.length) return m;
  for (const r of all(`SELECT user_id, type, MIN(ts) ts FROM events WHERE user_id IN (${ids.map(() => '?').join(',')}) AND type IN (${inList(FUNC)}) GROUP BY user_id`, ...ids)) m.set(r.user_id, r);
  return m;
}
const actedBetween = (id, a, b, types = ACTIVE) => (memo ? daysBetweenOf(id, a, b, types) > 0
  : !!one(`SELECT 1 FROM events WHERE user_id = ? AND type IN (${inList(types)}) AND day BETWEEN ? AND ? LIMIT 1`, id, a, b));
const hasPush = (id) => memoized('push', () => new Set(all('SELECT DISTINCT user_id FROM push_subs').map((r) => r.user_id))).has(id);
const moodDaysBetween = (id, a, b) => (memoized('moods', () => { const m = new Map(); for (const r of all('SELECT user_id, day FROM moods')) { let d = m.get(r.user_id); if (!d) m.set(r.user_id, d = []); d.push(r.day); } return m; }).get(id) || []).filter((x) => x >= a && x <= b).length;
const activeUsers = (a, b, types = ACTIVE) => one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ?`, a, b).c;
const dauSeries = (days, from, to, types = ACTIVE) => fill(days, all(`SELECT day, COUNT(DISTINCT user_id) n FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ? GROUP BY day`, from, to));
const staffEmails = () => new Set([...all('SELECT email FROM staff').map((r) => r.email)]);

/* активация: первый результат работающей функции в течение 24 часов после подтверждения почты */
function activation24(from, to) {
  const cohort = all(`SELECT id, email_at FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ?`, from, to);
  let a24 = 0, late = 0, none = 0, sameDay = 0; const firsts = {}; const hours = [];
  const first = firstFuncs(cohort.map((u) => u.id));
  for (const u of cohort) {
    const f = first.get(u.id);
    if (!f) { none++; continue; }
    const h = (Date.parse(f.ts) - Date.parse(u.email_at)) / 36e5;
    firsts[f.type] = (firsts[f.type] || 0) + 1;
    if (h <= 24) { a24++; hours.push(Math.max(0, h)); } else late++;
    if (dayMSK(new Date(f.ts)) === dayMSK(new Date(u.email_at))) sameDay++;
  }
  hours.sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;
  return { cohort: cohort.length, a24, late, none, sameDay, share: pct(a24, cohort.length), firsts, medianHours: median === null ? null : Math.round(median * 10) / 10 };
}
function retention(from, to, today) {
  const cohort = all(`SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ?`, from, to);
  const r = { d1: [1, 1], d7: [7, 7], w4: [22, 28], d30: [30, 30] };
  const out = { cohort: cohort.length };
  for (const [k, [a, b]] of Object.entries(r)) {
    let eligible = 0, back = 0;
    for (const u of cohort) if (addDays(u.day, b) <= today) { eligible++; if (actedBetween(u.id, addDays(u.day, a), addDays(u.day, b), FUNC)) back++; }
    out[k] = { eligible, back, pct: pct(back, eligible) };
  }
  return out;
}
function freqDist(from, to) {
  const per = all(`SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id`, from, to);
  const dist = { '1 день': 0, '2 дня': 0, '3–4 дня': 0, '5–7 дней': 0 };
  for (const r of per) dist[r.d >= 5 ? '5–7 дней' : r.d >= 3 ? '3–4 дня' : r.d === 2 ? '2 дня' : '1 день']++;
  return { per, dist };
}
/* уровни постоянства за последнюю неделю периода + стадии отсутствия */
function levels(to) {
  const wk = Object.fromEntries(all(`SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id`, addDays(to, -6), to).map((r) => [r.user_id, r.d]));
  const users = all("SELECT id, last_seen FROM users WHERE email <> ''");
  const lv = { 'Ядро': 0, 'Регулярные': 0, 'Редкие': 0, 'Спящие': 0, 'Предупреждённые': 0, 'К удалению': 0 };
  for (const u of users) {
    const d = wk[u.id] || 0, gone = daysBetween(u.last_seen.slice(0, 10), to);
    if (d >= 5) lv['Ядро']++; else if (d >= 2) lv['Регулярные']++; else if (d === 1) lv['Редкие']++;
    else if (gone >= 61) lv['К удалению']++; else if (gone >= 31) lv['Предупреждённые']++; else if (gone >= 15) lv['Спящие']++;
  }
  return lv;
}
/* постоянный: действия хотя бы в 3 из последних 4 недель; только те, кого наблюдаем ≥ 28 дней */
function steady(to) {
  const users = all("SELECT id, email_at FROM users WHERE email <> '' AND email_at <> ''");
  let observed = 0, steadyN = 0;
  for (const u of users) {
    if (daysBetween(u.email_at.slice(0, 10), to) < 28) continue;
    observed++;
    let weeks = 0;
    for (let w = 0; w < 4; w++) if (actedBetween(u.id, addDays(to, -(7 * w + 6)), addDays(to, -7 * w), FUNC)) weeks++;
    if (weeks >= 3) steadyN++;
  }
  return { observed, steady: steadyN, share: pct(steadyN, observed) };
}
function weekRegulars(to) {   // главный ориентир: 4+ дня за последнюю полную календарную неделю пн–вс
  const d = new Date(to + 'T12:00:00Z'), wd = (d.getUTCDay() + 6) % 7;
  let mon = addDays(to, -wd), sun = addDays(mon, 6);
  if (sun > to) { mon = addDays(mon, -7); sun = addDays(sun, -7); }
  const n = all(`SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id HAVING d >= 4`, mon, sun).length;
  const pm = addDays(mon, -7), ps = addDays(sun, -7);
  const p = all(`SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id HAVING d >= 4`, pm, ps).length;
  return { mon, sun, n, prev: p };
}
export const COST_KINDS = { infra: 'Инфраструктура', services: 'Сторонние сервисы', support: 'Поддержка и сопровождение', content: 'Контент', acquisition: 'Привлечение', dev: 'Разработка', budget: 'Бюджет месяца',
  fixed: 'Инфраструктура', variable: 'Сторонние сервисы' };   // старые виды сводятся к категориям
function costs(today) {
  const month = today.slice(0, 7);
  const prevM = (() => { const d = new Date(month + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const rows = all('SELECT id, month, name, amount, kind, ts FROM costs WHERE month = ? ORDER BY ts', month);
  const prevRows = all("SELECT amount, kind FROM costs WHERE month = ? AND kind <> 'budget'", prevM);
  const dim = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate(), elapsed = +today.slice(8, 10);
  const byCat = {}; let budget = 0, dev = 0;
  for (const r of rows) { if (r.kind === 'budget') { budget += r.amount; continue; } const c = COST_KINDS[r.kind] || 'Прочее'; byCat[c] = (byCat[c] || 0) + r.amount; if (r.kind === 'dev') dev += r.amount; }
  const spent = Object.values(byCat).reduce((s, v) => s + v, 0);
  const variable = spent - (byCat['Инфраструктура'] || 0) - dev;
  const forecast = Math.round((byCat['Инфраструктура'] || 0) + dev + (elapsed ? variable / elapsed * dim : 0));
  const weekAgo = all("SELECT amount FROM costs WHERE kind <> 'budget' AND substr(ts,1,10) >= ?", addDays(today, -6)).reduce((s, r) => s + r.amount, 0);
  const todayN = all("SELECT amount FROM costs WHERE kind <> 'budget' AND substr(ts,1,10) = ?", today).reduce((s, r) => s + r.amount, 0);
  return { month, prevM, rows, byCat, budget, spent: Math.round(spent), forecast, dev, prevSpent: Math.round(prevRows.reduce((s, r) => s + r.amount, 0)), dim, elapsed, week: Math.round(weekAgo), today: Math.round(todayN) };
}
function loginCodes(from, to) {
  const sent = one("SELECT COUNT(*) c FROM events WHERE type = 'login_code_sent' AND day BETWEEN ? AND ?", from, to).c;
  const done = one("SELECT COUNT(*) c FROM events WHERE type = 'login_done' AND day BETWEEN ? AND ?", from, to).c;
  const donePeople = one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'login_done' AND day BETWEEN ? AND ?", from, to).c;
  const pending = all('SELECT email, attempts, created_at, expires_at FROM login_codes');
  const now = new Date().toISOString();
  const expired = pending.filter((r) => r.expires_at < now && r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to).length;
  const wrong = pending.filter((r) => r.attempts >= 3).length;
  const mailErr = one("SELECT COUNT(*) c FROM errors WHERE path = 'mail' AND day BETWEEN ? AND ?", from, to).c;
  const domains = {};
  for (const r of all("SELECT email FROM users WHERE email <> '' AND substr(email_at,1,10) BETWEEN ? AND ?", from, to)) { const d = r.email.split('@')[1] || '—'; domains[d] = (domains[d] || 0) + 1; }
  for (const r of pending.filter((r) => r.expires_at < now)) { const d = r.email.split('@')[1] || '—'; domains[d] = domains[d] || 0; }
  return { sent, done, donePeople, expired, wrong, mailErr, domains, share: pct(done, sent) };
}

function scatterFreq(today) {
  const users = all("SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) <= ?", addDays(today, -30)).slice(-300);
  return users.map((u) => [daysBetweenOf(u.id, u.day, addDays(u.day, 6), FUNC), daysBetweenOf(u.id, u.day, addDays(u.day, 29), FUNC)]);
}
const SECTION_OF = Object.fromEntries(FEATURES.map((f) => [f[0], f[1]]));
function sectionReach(from, to) {
  const rows = all(`SELECT type, user_id FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY type, user_id`, from, to);
  const m = Object.fromEntries([...new Set(FEATURES.map((f) => f[1]))].map((s) => [s, new Set()]));
  for (const r of rows) { const sct = SECTION_OF[r.type]; if (m[sct]) m[sct].add(r.user_id); }
  return Object.entries(m).map(([k, v]) => [k, v.size]);
}
/* поведение первой недели → D30 (только зрелые, ≥ 31 дня) */
function firstWeekBehaviour(today) {
  const users = all("SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) <= ?", addDays(today, -31));
  const groups = {
    'Настроение ≥ 3 раз в первую неделю': (u) => moodDaysBetween(u.id, u.day, addDays(u.day, 6)) >= 3,
    'Открыли карту дня в первую неделю': (u) => actedBetween(u.id, u.day, addDays(u.day, 6), ['card_open']),
    'Включили напоминание': (u) => hasPush(u.id),
    'Позвали подругу': (u) => actedBetween(u.id, u.day, addDays(u.day, 6), ['invite_copy']),
  };
  return Object.entries(groups).map(([name, f]) => { const g = users.filter(f); const back = g.filter((u) => actedBetween(u.id, addDays(u.day, 30), addDays(u.day, 30), FUNC)).length; return [name, g.length ? `${pct(back, g.length)}%` : '—', `${back} из ${g.length}`]; });
}

/* ── единый дашборд ── */
export const overview = withMemo(function overview(q) {
  const cfg = getConfig();
  const P = periodOf(q), today = dayMSK(), days = seriesDays(P.from, P.to);
  const nu = registered(P.from, P.to).length, nuP = registered(P.prevFrom, P.prevTo).length;
  const ac = activation24(P.from, P.to), acP = activation24(P.prevFrom, P.prevTo);
  const dau = activeUsers(P.to, P.to, FUNC), wau = activeUsers(addDays(P.to, -6), P.to, FUNC), mau = activeUsers(addDays(P.to, -29), P.to, FUNC);
  const wauP = activeUsers(addDays(P.prevTo, -6), P.prevTo, FUNC);
  const fd = freqDist(P.from, P.to), fdP = freqDist(P.prevFrom, P.prevTo);
  const rep = fd.per.filter((r) => r.d >= 2).length, repP = fdP.per.filter((r) => r.d >= 2).length;
  const st = steady(P.to);
  const rt = retention(P.from, P.to, today), rtP = retention(P.prevFrom, P.prevTo, today);
  const fe = featuresTable(P.from, P.to), feP = featuresTable(P.prevFrom, P.prevTo);
  const cs = costs(today);
  const pr = problems(P.from, P.to), prP = problems(P.prevFrom, P.prevTo);
  const wk = weekRegulars(today);
  const acts = one(`SELECT COUNT(*) c FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?`, P.from, P.to).c;
  const actsP = one(`SELECT COUNT(*) c FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?`, P.prevFrom, P.prevTo).c;
  const nuSeries = fill(days, all(`SELECT substr(email_at,1,10) day, COUNT(*) n FROM users WHERE email <> '' AND substr(email_at,1,10) BETWEEN ? AND ? GROUP BY day`, P.from, P.to));
  const srcRows = (() => { const m = {}; for (const u of all("SELECT invited_by, utm_source FROM users WHERE email <> ''")) { const k = sourceOf(u); m[k] = (m[k] || 0) + 1; } return Object.entries(m); })();
  const charts = [
    chart('line', 'Активная аудитория по дням', 'уникальные люди с содержательным действием', dauSeries(days, P.from, P.to, FUNC), 'Видно направление изменения и отдельные пики, а не только итог за период.'),
    chart('pie', 'Откуда пришли пользователи', 'первый известный источник, все аккаунты с почтой', srcRows, 'Неизвестный источник показан отдельно, без попытки угадать канал.'),
    chart('scatter', 'Частота первой недели и возвращение', 'каждая точка — 1 человек: дней с действиями в первую неделю → дней за 30', scatterFreq(today), 'Линия показывает связь показателей. Она не доказывает, что высокая частота сама вызвала удержание.'),
    chart('bars', 'Использование разделов', 'уникальные пользователи за период', sectionReach(P.from, P.to), 'Сравнивайте охват вместе с повторным использованием в отчёте функций.'),
  ];
  const week = { title: 'Главный ориентир недели', value: wk.n, prev: wk.prev, delta: delta(wk.n, wk.prev), sub: `людей с содержательным действием в 4+ разных дня · последняя полная неделя ${wk.mon} — ${wk.sun}, пн–вс · не зависит от фильтра периода` };
  const allBlocks = [
      { key: 'new_users', to: 'acquisition', title: 'Новые с подтверждённой почтой', value: nu, prev: nuP, delta: delta(nu, nuP), unit: 'чел.', series: nuSeries, sub: 'завершили регистрацию за период' },
      { key: 'activation', to: 'activation', title: 'Активация за 24 часа', value: ac.share, prev: acP.share, delta: delta(ac.share, acP.share), unit: '%', sub: `${ac.a24} из ${ac.cohort} новичков получили первый результат в первые сутки` },
      { key: 'active', to: 'activity', title: 'Активные за день, неделю и месяц', value: wau, prev: wauP, delta: delta(wau, wauP), unit: 'WAU', sub: `DAU — ${dau} · MAU — ${mau} · липкость ${mau ? Math.round(dau / mau * 100) : 0}%`, series: dauSeries(days, P.from, P.to, FUNC) },
      { key: 'repeat', to: 'rituals', title: 'Повторное использование', value: rep, prev: repP, delta: delta(rep, repP), unit: 'чел. в 2+ дня', sub: `постоянных (3 из 4 недель): ${st.steady} из ${st.observed} наблюдаемых ≥ 28 дней${st.share === null ? '' : ` (${st.share}%)`}`, main: true },
      { key: 'retention', to: 'retention', title: 'Возвраты D1, D7 и 4-я неделя', value: rt.d1.pct, prev: rtP.d1.pct, delta: delta(rt.d1.pct, rtP.d1.pct), unit: '% D1', sub: `D7 — ${rt.d7.pct ?? '—'}% · 4-я неделя — ${rt.w4.pct ?? '—'}% · зрелая когорта ${rt.cohort}`, state: rt.d1.pct === null ? 'nodata' : 'ok' },
      { key: 'features', to: 'features', title: 'Использование функций', value: acts, prev: actsP, delta: delta(acts, actsP), unit: 'действий', sub: `${fe.tried} из ${fe.working} работающих функций кто-то попробовал` + (fe.unnoticed.length ? ` · без внимания: ${fe.unnoticed.slice(0, 2).join(', ')}` : '') },
      { key: 'costs', to: 'economy', title: 'Расходы за месяц', value: cs.spent, prev: cs.prevSpent, delta: delta(cs.spent, cs.prevSpent), unit: '₽', sub: `прогноз до конца месяца — ${cs.forecast} ₽` + (cs.budget ? ` · бюджет ${cs.budget} ₽ — ${cs.forecast <= cs.budget ? 'укладываемся' : 'превышение'}` : ' · бюджет не задан'), good: 'down' },
      { key: 'problems', to: 'system', title: 'Требуют внимания', value: pr.total, prev: prP.total, delta: delta(pr.total, prP.total), unit: 'сигналов', sub: pr.items.filter((i) => i.value > 0).map((i) => i.name).join(', ') || 'всё спокойно', alarm: pr.total > 0, good: 'down' },
  ];
  return {
    charts,
    key: 'overview', title: cfg.reports.overview[0], question: cfg.reports.overview[1], period: P, today,
    week,
    blocks: cfg.blocks.map((k) => allBlocks.find((b) => b.key === k)).filter(Boolean),
  };
});
function problems(from, to) {
  const lc = loginCodes(from, to);
  const errs = all('SELECT path, COUNT(*) n FROM errors WHERE day BETWEEN ? AND ? GROUP BY path ORDER BY n DESC', from, to);
  const apiErrs = errs.filter((e) => e.path !== 'mail').reduce((s, e) => s + e.n, 0);
  const items = [
    { key: 'login', name: 'Ошибки входа', value: lc.wrong + lc.expired, hint: `неверный код 3+ раза — ${lc.wrong}, код не введён до истечения — ${lc.expired}` },
    { key: 'mail', name: 'Письма с кодом не ушли', value: lc.mailErr, hint: 'сбои отправки почты' },
    { key: 'api', name: 'Сбои функций', value: apiErrs, hint: errs.filter((e) => e.path !== 'mail').map((e) => `${e.path} — ${e.n}`).join(', ') || 'сбоев не было' },
    { key: 'ai', name: 'Рост стоимости ИИ', value: 0, hint: 'ИИ-модели в приложении не подключены', state: 'off' },
    { key: 'support', name: 'Неотвеченные обращения', value: one("SELECT COUNT(*) c FROM tickets WHERE first_reply_at = '' AND status <> 'resolved'").c, hint: 'ждут первого ответа поддержки' },
  ];
  return { total: items.reduce((s, i) => s + i.value, 0), items, errs };
}
function featuresTable(from, to) {
  const types = FEATURES.map((f) => f[0]);
  const rows = all(`SELECT type, COUNT(*) events, COUNT(DISTINCT user_id) people FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ? GROUP BY type`, from, to);
  const reuse = all(`SELECT type, COUNT(*) people FROM (SELECT type, user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ? GROUP BY type, user_id HAVING d >= 2) GROUP BY type`, from, to);
  const dau = activeUsers(from, to, FUNC);
  const m = Object.fromEntries(rows.map((r) => [r.type, r])), re = Object.fromEntries(reuse.map((r) => [r.type, r.people]));
  const items = FEATURES.map(([k, section, name, status]) => ({ key: k, section, name, status, people: (m[k] || {}).people || 0, events: (m[k] || {}).events || 0, reused: re[k] || 0, share: pct((m[k] || {}).people || 0, dau) }));
  const working = items.filter((i) => i.status === 'работает' && FUNC.includes(i.key));
  return { items, dau, working: working.length, tried: working.filter((i) => i.people > 0).length, unnoticed: working.filter((i) => i.people === 0).map((i) => i.name) };
}

/* ── отчёты ── */
export const report = withMemo(function report(kind, q) {
  const P = periodOf(q), today = dayMSK(), days = seriesDays(P.from, P.to);
  const meta = REPORT_META[kind]; if (!meta) return null;
  const named = getConfig().reports[kind] || meta;
  const R = { key: kind, title: named[0], question: named[1], period: P, today, filters: [], kpis: [], charts: [], tables: [], notes: [], how: '' };
  const B = builders[kind]; if (!B) return R;
  B(R, { P, today, days, q });
  return R;
});
const builders = {
  acquisition(R, { P, days, q, today }) {
    const plat = userPlatforms();
    const cur = registered(P.from, P.to), prev = registered(P.prevFrom, P.prevTo);
    const srcOpts = [...new Set(cur.concat(prev).map(sourceOf))].sort();
    const src = q.source || '', pf = q.platform || '';
    const group = cur.filter((u) => (!src || sourceOf(u) === src) && (!pf || (plat[u.id] || 'Неизвестно') === pf));
    R.filters = [
      { key: 'source', label: 'Источник', options: srcOpts.map((x) => [x, x]), value: src },
      { key: 'platform', label: 'Платформа', options: [['iOS', 'iOS'], ['Android', 'Android'], ['Десктоп', 'Десктоп']], value: pf },
    ];
    const activated = (u) => { const f = firstFunc(u.id); return !!f && (Date.parse(f.ts) - Date.parse(u.day + 'T00:00:00Z')) < 48 * 36e5; };
    const d7 = (u) => addDays(u.day, 7) <= today && actedBetween(u.id, addDays(u.day, 7), addDays(u.day, 7), FUNC);
    const w4 = (u) => addDays(u.day, 28) <= today && actedBetween(u.id, addDays(u.day, 22), addDays(u.day, 28), FUNC);
    const act = group.filter(activated).length, invited = group.filter((u) => u.invited_by).length, unknown = group.filter((u) => !u.utm_source && !u.invited_by).length;
    /* кампании: расходы и люди — только когда совпали UTM и когорта внутри периода */
    const camps = campaignList().map((c) => {
      const people = campaignUsers(c).filter((u) => u.day >= P.from && u.day <= P.to);
      const a = people.filter(activated).length, e7 = people.filter((u) => addDays(u.day, 7) <= today), b7 = e7.filter(d7).length, e4 = people.filter((u) => addDays(u.day, 28) <= today), b4 = e4.filter(w4).length;
      const cpa = people.length && c.cost ? Math.round(c.cost / people.length) : null, cpaAct = a && c.cost ? Math.round(c.cost / a) : null, cpaW4 = b4 && c.cost ? Math.round(c.cost / b4) : null;
      return { c, people: people.length, a, e7: e7.length, b7, e4: e4.length, b4, cpa, cpaAct, cpaW4 };
    });
    const spent = camps.reduce((s, x) => s + (x.c.cost || 0), 0), regsFromCamps = camps.reduce((s, x) => s + x.people, 0);
    R.kpis = [
      kpi('Регистрации', group.length, { prev: prev.length, unit: 'чел.', sub: 'подтвердили почту за период' }),
      kpi('Активированы', act, { unit: 'чел.', sub: `${pct(act, group.length) ?? 0}% · первый результат в первые сутки` }),
      kpi('Неизвестный источник', pct(unknown, group.length), { unit: '%', sub: `${unknown} чел. без UTM и приглашения · первый источник не заменяется источником возврата`, good: 'down' }),
      kpi('Стоимость регистрации', regsFromCamps && spent ? Math.round(spent / regsFromCamps) : null, { unit: '₽', sub: spent ? `${Math.round(spent)} ₽ по кампаниям с датами в периоде · ${regsFromCamps} регистраций с их UTM` : 'внесите расходы в «Кампании и UTM-ссылки»', good: 'down' }),
    ];
    const bySrc = {};
    for (const u of group) { const k = sourceOf(u); bySrc[k] = bySrc[k] || { reg: 0, act: 0, d7: 0, e7: 0, w4: 0, e4: 0 }; const b = bySrc[k]; b.reg++; if (activated(u)) b.act++; if (addDays(u.day, 7) <= today) { b.e7++; if (d7(u)) b.d7++; } if (addDays(u.day, 28) <= today) { b.e4++; if (w4(u)) b.w4++; } }
    const marks = campaignList().filter((c) => c.start_day && c.start_day >= P.from && c.start_day <= P.to).map((c) => ({ x: c.start_day, label: c.name }));
    R.charts = [
      chart('line', 'Регистрации по дням', 'подтверждение почты · метки — старт кампаний', { points: fill(days, all(`SELECT substr(email_at,1,10) day, COUNT(*) n FROM users WHERE email <> '' AND substr(email_at,1,10) BETWEEN ? AND ? GROUP BY day`, P.from, P.to)), marks }, 'Всплеск сверяйте с меткой кампании — иначе он ничего не объясняет.'),
      chart('pie', 'Источники аудитории', 'первый известный источник, регистрации за период', Object.entries(bySrc).map(([k, v]) => [k, v.reg])),
    ];
    R.tables = [
      table('По источникам', ['Источник', 'Регистрации', 'Активированы', 'D7', '4-я неделя'],
        Object.entries(bySrc).sort((a, b) => b[1].reg - a[1].reg).map(([k, v]) => [k, v.reg, `${v.act} (${pct(v.act, v.reg) ?? 0}%)`, v.e7 ? `${v.d7} из ${v.e7}` : 'когорта не дозрела', v.e4 ? `${v.w4} из ${v.e4}` : 'когорта не дозрела']),
        'Источник — utm_source из ссылки, которой человек пришёл впервые; без UTM — приглашение или прямой заход.'),
      table('Кампании', ['Кампания', 'UTM', 'Обещание', 'Расходы', 'Регистрации', 'Активированы', 'D7', '4-я неделя', 'Цена регистрации', 'Цена активированного', 'Цена удержанного (4-я нед.)'],
        camps.map((x) => [x.c.name, [x.c.source, x.c.medium, x.c.campaign].filter(Boolean).join(' / '), x.c.promise || '—', Math.round(x.c.cost) || 0, x.people, x.a, x.e7 ? `${x.b7} из ${x.e7}` : '—', x.e4 ? `${x.b4} из ${x.e4}` : '—', x.cpa ?? '—', x.cpaAct ?? '—', x.cpaW4 ?? '—']),
        'Стоимость удержанного считается только когда расходы и люди относятся к одной кампании и одной когорте. Кампании заводятся в «Кампании и UTM-ссылки».'),
    ];
    R.how = 'Первый источник хранится отдельно от источника возвращения: переход из письма или пуша не стирает исходный канал. Активирован — первый результат работающей функции в первые сутки. Люди привязываются к кампании по совпадению utm_source и utm_campaign.';
  },
  funnel(R, { P }) {
    const c = (t) => one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = ? AND day BETWEEN ? AND ?`, t, P.from, P.to).c;
    const cp = (t) => one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = ? AND day BETWEEN ? AND ?`, t, P.prevFrom, P.prevTo).c;
    const steps = [['Приветствие', c('intro_view')], ['Начали анкету', c('onboard_start')], ['Заполнили анкету', c('onboard_done')], ['Запросили код', c('login_code_sent')], ['Подтвердили почту', c('login_done')], ['Открыли главную', one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'app_open' AND day BETWEEN ? AND ? AND user_id IN (SELECT user_id FROM events WHERE type='login_done' AND day BETWEEN ? AND ?)`, P.from, P.to, P.from, P.to).c], ['Первый результат', one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? AND user_id IN (SELECT user_id FROM events WHERE type='login_done' AND day BETWEEN ? AND ?)`, P.from, P.to, P.from, P.to).c]];
    const conv = pct(steps[4][1], steps[0][1]);   // индексы: 0 приветствие … 4 подтвердили почту
    const noUse = registered(P.from, P.to).filter((u) => !firstFunc(u.id)).length;
    R.kpis = [
      kpi('Приветствие → почта', conv, { prev: pct(cp('login_done'), cp('intro_view')), unit: '%', sub: `${steps[4][1]} из ${steps[0][1]} увидевших приветствие` }),
      kpi('Дошли до почты', pct(steps[3][1], steps[0][1]), { unit: '%', sub: `${steps[3][1]} запросили код` }),
      kpi('Подтвердили без функций', noUse, { unit: 'чел.', sub: 'зарегистрировались, но ничего не попробовали', good: 'down' }),
      nodata('Среднее время шага', 'время на каждом поле анкеты ещё не фиксируется'),
    ];
    R.charts = [chart('funnel', 'Ветка с анкетой', 'уникальные люди на каждом шаге за период', steps, 'Потеря между «Начали» и «Заполнили» — поле остановки; между «Запросили код» и «Подтвердили» — доставка и ввод кода.')];
    R.tables = [
      table('Две ветки входа', ['Ветка', 'Людей', 'Что дальше'], [['Заполнить анкету', steps[1][1], 'анкета → почта → код → главная → первый результат'], ['Посмотреть без анкеты', 'нет данных', 'заглушка «В разработке» — событие ещё не собирается'], ['Гости, позже заполнившие анкету', 'нет данных', 'появится вместе с веткой без анкеты']]),
      table('Остановки на полях анкеты', ['Поле', 'Остановились'], [], 'Событие остановки на конкретном поле ещё не собирается — только начало и завершение анкеты.'),
    ];
    R.how = 'Каждый шаг — уникальные люди с таким событием за период. Первый результат — работающая функция у тех, кто подтвердил почту в этот же период. Нажатие на заглушку результатом не считается.';
  },
  delivery(R, { P }) {
    const lc = loginCodes(P.from, P.to), lp = loginCodes(P.prevFrom, P.prevTo);
    R.kpis = [
      kpi('Запросов кода', lc.sent, { prev: lp.sent, unit: 'шт.' }),
      kpi('Подтвердили почту', lc.share, { prev: lp.share, unit: '%', sub: `${lc.done} подтверждений · ${lc.donePeople} человек` }),
      kpi('Письмо не ушло', lc.mailErr, { prev: lp.mailErr, unit: 'шт.', good: 'down' }),
      kpi('Неверный / просроченный', lc.wrong + lc.expired, { unit: 'шт.', sub: `неверных 3+ раза — ${lc.wrong} · просрочено — ${lc.expired}`, good: 'down' }),
    ];
    R.charts = [chart('hbars', 'Почтовые домены', 'подтвердившие за период', Object.entries(lc.domains).sort((a, b) => b[1] - a[1]).slice(0, 12))];
    R.tables = [table('По доменам', ['Домен', 'Подтвердили', 'Ожидают / просрочены'], Object.entries(lc.domains).sort((a, b) => b[1] - a[1]).map(([d, n]) => [d, n, all('SELECT COUNT(*) c FROM login_codes WHERE email LIKE ?', '%@' + d)[0].c]), 'Доставка письма провайдером (delivered / bounced) не отслеживается — только отправка и ввод кода.')];
    R.how = 'Запрос — событие отправки кода. Подтверждение — верно введённый код. Неверный — код с 3 и более ошибочными попытками; просроченный — не введён за 15 минут.';
  },
  viral(R, { P }) {
    const c = (t, a = P.from, b = P.to) => one('SELECT COUNT(*) c FROM events WHERE type = ? AND day BETWEEN ? AND ?', t, a, b).c;
    const up = (t, a = P.from, b = P.to) => one('SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = ? AND day BETWEEN ? AND ?', t, a, b).c;
    const invitedReg = one("SELECT COUNT(*) c FROM users WHERE invited_by IS NOT NULL AND email <> '' AND substr(email_at,1,10) BETWEEN ? AND ?", P.from, P.to).c;
    const mau = activeUsers(addDays(P.to, -29), P.to, FUNC);
    const kFactor = mau ? Math.round(one("SELECT COUNT(*) c FROM users WHERE invited_by IS NOT NULL AND substr(email_at,1,10) BETWEEN ? AND ?", addDays(P.to, -29), P.to).c / mau * 100) / 100 : null;
    R.kpis = [
      kpi('Скопировали приглашение', up('invite_copy'), { prev: up('invite_copy', P.prevFrom, P.prevTo), unit: 'чел.' }),
      kpi('Пришли по ссылке', up('invite_used'), { prev: up('invite_used', P.prevFrom, P.prevTo), unit: 'чел.' }),
      kpi('Зарегистрировались приглашённые', invitedReg, { unit: 'чел.' }),
      kpi('Новых от 1 активного за месяц', kFactor, { unit: '', sub: 'приглашённые регистрации / MAU' }),
    ];
    R.charts = [chart('funnel', 'Приглашения', 'показ → копирование → переход → регистрация → совместимость', [['Показ', 'нет данных'], ['Скопировали', up('invite_copy')], ['Перешли', up('invite_used')], ['Зарегистрировались', invitedReg], ['Совместимость', up('compat_calc')]], 'Повторный вход существующего пользователя по приглашению не считается привлечением.')];
    const inv = registered(P.from, P.to).filter((u) => u.invited_by), org = registered(P.from, P.to).filter((u) => !u.invited_by);
    const d7 = (g) => { const e = g.filter((u) => addDays(u.day, 7) <= R.today); return e.length ? `${e.filter((u) => actedBetween(u.id, addDays(u.day, 7), addDays(u.day, 7), FUNC)).length} из ${e.length}` : 'когорта не дозрела'; };
    R.tables = [
      table('Приглашённые и органика', ['Группа', 'Регистрации', 'D7'], [['Приглашённые', inv.length, d7(inv)], ['Органика', org.length, d7(org)]]),
      table('Карточки для соцсетей', ['Событие', 'Раз', 'Людей'], [['Создана', 'нет данных', 'нет данных'], ['Нажали «Поделиться»', c('share_card'), up('share_card')], ['Переход по ссылке карточки', 'нет данных', 'нет данных']], 'Нажатие кнопки не доказывает публикацию: создание, сохранение, нажатие и переход — разные события, собирается пока только нажатие.'),
    ];
    R.how = 'Приглашённый — аккаунт с полем «кто пригласил», заполненным при первом входе по ссылке. Виральность — приглашённые регистрации за 30 дней на одного активного за тот же срок.';
  },
  audience(R, { P }) {
    const plat = userPlatforms();
    const users = all("SELECT id, birth, city, city_region, tz FROM users WHERE email <> ''");
    const band = (b) => { if (!/^\d{4}/.test(b || '')) return 'не указан'; const a = new Date().getUTCFullYear() - +b.slice(0, 4); return a < 25 ? 'до 25' : a < 35 ? '25–34' : a < 45 ? '35–44' : a < 55 ? '45–54' : '55+'; };
    const cnt = (f) => { const m = {}; for (const u of users) { const k = f(u) || 'не указан'; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const ages = cnt((u) => band(u.birth)), cities = cnt((u) => u.city).slice(0, 15), tzs = cnt((u) => u.tz), plats = cnt((u) => plat[u.id] || 'Неизвестно');
    const small = (rows) => rows.map(([k, n]) => [k, n < 10 ? 'меньше 10 — скрыто' : n]);
    R.kpis = [kpi('Аккаунтов с почтой', users.length, { unit: 'чел.' }), kpi('Указали дату рождения', users.filter((u) => /^\d{4}/.test(u.birth)).length, { unit: 'чел.' }), kpi('Указали город', users.filter((u) => u.city).length, { unit: 'чел.' }), off('Гендер', 'в анкете не спрашиваем — поле не собирается')];
    R.charts = [chart('bars', 'Возрастные группы', 'по дате рождения из анкеты', ages), chart('pie', 'Платформы', 'по последней сессии', plats)];
    R.tables = [table('Города', ['Город', 'Людей'], small(cities)), table('Часовые пояса', ['Пояс', 'Людей'], small(tzs), 'Показан текущий часовой пояс из анкеты города; он не заменяет пояс рождения.')];
    R.notes = ['Чувствительные распределения показываются только для групп от 10 человек — меньшие скрыты.'];
    R.how = 'Портрет — все аккаунты с подтверждённой почтой на сегодня, без фильтра периода. Платформа — по User-Agent последней сессии.';
  },
  concerns(R, { P }) {
    const topics = all("SELECT detail, COUNT(*) n, COUNT(DISTINCT user_id) p FROM events WHERE type = 'worry_pick' AND day BETWEEN ? AND ? GROUP BY detail ORDER BY n DESC", P.from, P.to);
    const asks = [['ask_yesno', 'Да / нет'], ['ask_rune', 'Руна'], ['ask_spread', 'Три карты']].map(([t, n]) => [n, one('SELECT COUNT(*) c FROM events WHERE type = ? AND day BETWEEN ? AND ?', t, P.from, P.to).c, one('SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = ? AND day BETWEEN ? AND ?', t, P.from, P.to).c]);
    R.kpis = [kpi('Выбрали тему', topics.reduce((s, t) => s + t.p, 0), { unit: 'чел.' }), kpi('Вопросов всего', asks.reduce((s, a) => s + a[1], 0), { unit: 'шт.' }), kpi('Самая частая тема', topics[0] ? topics[0].n : null, { unit: topics[0] ? topics[0].detail : '', state: topics[0] ? 'ok' : 'nodata' }), off('Интерес к таро / рунам как теме', 'опрос интересов не запущен')];
    R.charts = [chart('hbars', 'Темы «Что вас беспокоит»', 'выборов за период', topics.map((t) => [t.detail || '—', t.n])), chart('bars', 'Какой инструмент выбирают', 'вопросов за период', asks.map((a) => [a[0], a[1]]))];
    R.tables = [table('Инструменты', ['Инструмент', 'Вопросов', 'Людей'], asks)];
    R.how = 'Тема — выбор в списке «Что вас беспокоит». Текст самого вопроса в аналитику не попадает.';
  },
  heatmap(R, { P }) {
    const ev = all(`SELECT ts FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?`, P.from, P.to);
    const hours = Array(24).fill(0), wd = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const grid = {}; for (const e of ev) { const h = hourMSK(e.ts), d = wdMSK(e.ts); hours[h]++; wd[d] = (wd[d] || 0) + 1; grid[d + h] = (grid[d + h] || 0) + 1; }
    const RU = { Mon: 'Пн', Tue: 'Вт', Wed: 'Ср', Thu: 'Чт', Fri: 'Пт', Sat: 'Сб', Sun: 'Вс' };
    const peak = hours.indexOf(Math.max(...hours));
    R.kpis = [kpi('Действий за период', ev.length, { unit: 'шт.' }), kpi('Пиковый час', ev.length ? peak : null, { unit: ':00 МСК' }), kpi('Самый активный день', ev.length ? RU[Object.entries(wd).sort((a, b) => b[1] - a[1])[0][0]] : null, { unit: '' }), nodata('Фазы Луны', 'разрез по фазам появится вместе с ночным агрегатом')];
    R.charts = [chart('bars', 'По часам (МСК)', 'содержательные действия', hours.map((n, h) => [String(h), n])), chart('heat', 'День недели × час', 'содержательные действия', { rows: Object.keys(RU).map((k) => RU[k]), cols: [...Array(24).keys()], cells: Object.keys(RU).map((d) => [...Array(24).keys()].map((h) => grid[d + h] || 0)) })];
    R.how = 'Час — по московскому времени сервера. Это время действия, а не часовой пояс человека: пояс пользователя будет добавлен, когда в событии появится локальная дата.';
  },
  feedback(R) {
    R.kpis = [off('NPS', 'вопрос внутри приложения ещё не задаётся'), off('«Было полезно?»', 'точка сбора после результата не запущена'), off('Причины удаления', 'необязательный вопрос при удалении не запущен'), nodata('Ответивших', '—')];
    R.tables = [table('Три точки обратной связи', ['Точка', 'Вопросы', 'Статус'], [['После результата', '«Было полезно?», «Понятно ли написано?», «Что не подошло?»', 'не запущено'], ['После периода использования', '«Ради чего возвращаетесь?», «Чего не хватает?»', 'не запущено'], ['При удалении аккаунта', 'необязательная причина, не мешает удалению', 'не запущено']], 'Рядом с распределением ответов всегда показываются число ответивших и доля ответа среди тех, кому вопрос показали. Малое число оценок — не мнение всей аудитории.')];
    R.how = 'NPS задаётся одним вопросом не чаще раза в квартал. Оценка «было полезно» отражает впечатление, а не точность прогноза.';
  },
  activity(R, { P, days }) {
    const dau = activeUsers(P.to, P.to, FUNC), wau = activeUsers(addDays(P.to, -6), P.to, FUNC), mau = activeUsers(addDays(P.to, -29), P.to, FUNC);
    const dauP = activeUsers(P.prevTo, P.prevTo, FUNC), wauP = activeUsers(addDays(P.prevTo, -6), P.prevTo, FUNC), mauP = activeUsers(addDays(P.prevTo, -29), P.prevTo, FUNC);
    const openOnly = one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'app_open' AND day BETWEEN ? AND ? AND user_id NOT IN (SELECT user_id FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?)`, P.from, P.to, P.from, P.to).c;
    const fd = freqDist(addDays(P.to, -6), P.to);
    const sessions = one('SELECT COUNT(*) c FROM events WHERE type = \'app_open\' AND day BETWEEN ? AND ?', P.from, P.to).c;
    const acts = one(`SELECT COUNT(*) c FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?`, P.from, P.to).c;
    const active = activeUsers(P.from, P.to, FUNC);
    const lv = levels(P.to);
    const resurrected = all(`SELECT DISTINCT user_id FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ?`, P.from, P.to).filter((r) => !actedBetween(r.user_id, addDays(P.from, -30), addDays(P.from, -1), FUNC) && actedBetween(r.user_id, '2000-01-01', addDays(P.from, -31), FUNC)).length;
    R.kpis = [
      kpi('DAU', dau, { prev: dauP, unit: 'чел.', sub: 'содержательное действие в последний день периода' }),
      kpi('WAU', wau, { prev: wauP, unit: 'чел.' }), kpi('MAU', mau, { prev: mauP, unit: 'чел.' }),
      kpi('Липкость DAU / MAU', mau ? Math.round(dau / mau * 100) : null, { unit: '%' }),
      kpi('Только открыли', openOnly, { unit: 'чел.', sub: 'открыли приложение, но без содержательного действия', good: 'down' }),
      kpi('Открытий в день', sessions && P.len ? Math.round(sessions / P.len * 10) / 10 : 0, { unit: 'в среднем' }),
      kpi('Ритуалов на 1 активного', active ? Math.round(acts / active * 10) / 10 : null, { unit: 'за период' }),
      kpi('Воскресшие', resurrected, { unit: 'чел.', sub: 'вернулись после 30+ дней без действий' }),
    ];
    R.charts = [chart('line', 'Активная аудитория по дням', 'уникальные люди с содержательным действием', dauSeries(days, P.from, P.to, FUNC), 'Ищите тренд, скачок или провал — и сверяйте с релизом, кампанией, изменением анкеты или сбоем.'),
      chart('bars', 'Распределение частоты', 'дней с действиями за последнюю неделю периода', Object.entries(fd.dist), 'Среднее скрывает изменение регулярности; распределение — нет.'),
      chart('pie', 'Уровни постоянства', 'по последней неделе периода и сроку отсутствия', Object.entries(lv).filter((e) => e[1]))];
    R.tables = [table('Уровни постоянства и жизненный цикл', ['Уровень', 'Определение', 'Людей'], [['Ядро', 'действия в 5–7 дней недели', lv['Ядро']], ['Регулярные', '2–4 дня', lv['Регулярные']], ['Редкие', '1 день', lv['Редкие']], ['Спящие', '15–30 дней без захода', lv['Спящие']], ['Предупреждённые', '31–60 дней без захода (письмо ещё не отправляется)', lv['Предупреждённые']], ['К удалению', 'с 61-го дня без захода (автоудаление не запущено)', lv['К удалению']]], 'Частота использования и жизненный цикл — разные классификации: первая описывает привычку, вторая — срок отсутствия.')];
    R.notes = ['Средняя длина сессии не считается: событие завершения сессии не собирается.'];
    R.how = 'Содержательное действие — результат работающей функции: настроение, запись, карта, расклад, руна, ответ, совместимость. Вход, просмотр главной и нажатие на заглушку не считаются. DAU/WAU/MAU — уникальные люди за 1, 7 и 30 дней до конца периода.';
  },
  retention(R, { P, today }) {
    const rt = retention(P.from, P.to, today), rp = retention(P.prevFrom, P.prevTo, today);
    const f = (x) => (x.pct === null ? null : x.pct);
    R.kpis = [kpi('D1', f(rt.d1), { prev: f(rp.d1), unit: '%', sub: `${rt.d1.back} из ${rt.d1.eligible} зрелых` }), kpi('D7', f(rt.d7), { prev: f(rp.d7), unit: '%', sub: `${rt.d7.back} из ${rt.d7.eligible}` }), kpi('4-я неделя', f(rt.w4), { prev: f(rp.w4), unit: '%', sub: `${rt.w4.back} из ${rt.w4.eligible} · дни 22–28` }), kpi('D30', f(rt.d30), { prev: f(rp.d30), unit: '%', sub: `${rt.d30.back} из ${rt.d30.eligible}` })];
    const weeks = []; for (let w = 0; w < 8; w++) { const to = addDays(today, -7 * w), from = addDays(to, -6); const r = retention(from, to, today); weeks.unshift([`${from} — ${to}`, r.cohort, r.d1.pct ?? '—', r.d7.pct ?? '—', r.w4.pct ?? '—', r.d30.pct ?? '—']); }
    R.charts = [chart('line', 'Как меняется удержание', 'D1, D7, 4-я неделя и D30 по когорте периода — только зрелые', [['D1', rt.d1.pct], ['D7', rt.d7.pct], ['4-я нед.', rt.w4.pct], ['D30', rt.d30.pct]].map(([x, y]) => ({ x, y })), 'Показатели разных окон не складываются: каждая точка отвечает на отдельный вопрос.'),
      chart('line', 'D7 по недельным когортам', 'только зрелые когорты', weeks.map((w) => ({ x: w[0].slice(5, 10), y: typeof w[3] === 'number' ? w[3] : null })))];
    R.tables = [table('Когорты по неделе регистрации', ['Неделя', 'Когорта', 'D1 %', 'D7 %', '4-я нед. %', 'D30 %'], weeks, 'Прочерк — когорта ещё не дожила до этого дня. Это не ноль.'),
      table('Поведение первой недели и D30', ['Поведение', 'D30', 'Размер зрелой группы'], firstWeekBehaviour(today), 'Сравнение показывает связь, а не причинный эффект: для проверки причины нужен отдельный эксперимент.')];
    R.notes = ['Возврат после письма о бездействии — отдельная метрика реактивации; она не называется D30 и здесь не смешивается.'];
    R.how = 'D1 — содержательное действие ровно на следующий календарный день после подтверждения почты; D7 — ровно на 7-й; 4-я неделя — хотя бы раз в дни 22–28; D30 — ровно на 30-й. В знаменателе только те, у кого нужный день уже наступил.';
  },
  cohorts(R, { P, today }) {
    const plat = userPlatforms();
    const users = all("SELECT id, invited_by, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) <= ?", P.to);
    const groups = { 'Источник': (u) => sourceOf(u), 'Платформа': (u) => plat[u.id] || 'Неизвестно', 'Первая функция': (u) => { const f = firstFunc(u.id); return f ? FNAME[f.type] || f.type : 'без функций'; }, 'Приглашение': (u) => (u.invited_by ? 'Приглашённые' : 'Остальные'), 'Напоминания': (u) => (hasPush(u.id) ? 'С напоминаниями' : 'Без') };
    const rows = [];
    for (const [g, f] of Object.entries(groups)) {
      const m = {}; for (const u of users) { const k = f(u); (m[k] = m[k] || []).push(u); }
      for (const [k, arr] of Object.entries(m)) {
        const act = arr.filter((u) => { const x = firstFunc(u.id); return x && (Date.parse(x.ts) - Date.parse(u.day + 'T00:00:00Z')) < 48 * 36e5; }).length;
        const e7 = arr.filter((u) => addDays(u.day, 7) <= today), b7 = e7.filter((u) => actedBetween(u.id, addDays(u.day, 7), addDays(u.day, 7), FUNC)).length;
        const e30 = arr.filter((u) => addDays(u.day, 30) <= today), b30 = e30.filter((u) => actedBetween(u.id, addDays(u.day, 30), addDays(u.day, 30), FUNC)).length;
        rows.push([g, k, arr.length, `${act} (${pct(act, arr.length) ?? 0}%)`, e7.length ? `${pct(b7, e7.length)}% из ${e7.length}` : '—', e30.length ? `${pct(b30, e30.length)}% из ${e30.length}` : '—']);
      }
    }
    R.kpis = [kpi('Людей в сравнении', users.length, { unit: 'чел.', sub: 'все с подтверждённой почтой до конца периода' })];
    R.tables = [table('Группы', ['Разрез', 'Группа', 'Людей', 'Активированы', 'D7', 'D30'], rows, 'Прочерк — группа ещё не дожила до окна. Малые группы читайте с осторожностью.')];
    R.notes = ['Разрезы «неделя регистрации», «поведение в первые сутки», «основной сценарий», «частота», «версия» появятся, когда в событии будет снимок когортных полей. Любая связь здесь — наблюдение для гипотезы, а не доказанная причина.'];
    R.how = 'Активирован — первый результат в первые сутки. D7 и D30 — содержательное действие ровно в этот день; знаменатель — только дозревшие.';
  },
  activation(R, { P }) {
    const a = activation24(P.from, P.to), p = activation24(P.prevFrom, P.prevTo);
    R.kpis = [kpi('Активация за 24 часа', a.share, { prev: p.share, unit: '%', sub: `${a.a24} из ${a.cohort} новичков` }), kpi('В первый календарный день', pct(a.sameDay, a.cohort), { unit: '%', sub: `${a.sameDay} чел.` }), kpi('Поздняя активация', a.late, { unit: 'чел.', sub: 'первый результат позже 24 часов' }), kpi('Без функций', a.none, { unit: 'чел.', sub: 'подтвердили почту, ничего не попробовали', good: 'down' }), kpi('Медиана до первого результата', a.medianHours, { unit: 'ч' })];
    R.charts = [chart('funnel', 'Регистрация → первый результат', 'когорта периода', [['Подтвердили почту', a.cohort], ['Результат за 24 ч', a.a24], ['Позже', a.late]]), chart('hbars', 'Первое выбранное действие', 'какой функцией знакомятся', Object.entries(a.firsts).map(([k, n]) => [FNAME[k] || k, n]).sort((x, y) => y[1] - x[1]))];
    R.notes = ['Результат в первой сессии и «сколько из 5 разделов открыли в первой сессии» появятся вместе с событием завершения сессии и открытием разделов.', 'Эти значения не складываются без проверки пересечения групп.'];
    R.how = 'Активирован — в течение 24 часов после подтверждения почты получил первый результат работающей функции. Заглушки не считаются.';
  },
  features(R, { P }) {
    const f = featuresTable(P.from, P.to), fp = featuresTable(P.prevFrom, P.prevTo);
    const pm = Object.fromEntries(fp.items.map((i) => [i.key, i]));
    R.kpis = [kpi('Активных за период', f.dau, { prev: fp.dau, unit: 'чел.' }), kpi('Попробовали функций', f.tried, { prev: fp.tried, unit: `из ${f.working}` }), kpi('Действий всего', f.items.reduce((s, i) => s + i.events, 0), { unit: 'шт.' }), kpi('Без внимания', f.unnoticed.length, { unit: 'функций', sub: f.unnoticed.join(', ') || 'все попробовали', good: 'down' })];
    R.charts = [chart('hbars', 'Уникальные пользователи по функциям', 'за период', f.items.filter((i) => i.people).sort((a, b) => b.people - a.people).map((i) => [i.name, i.people]))];
    R.tables = [table('Все функции по разделам', ['Раздел', 'Функция', 'Статус', 'Увидели вход', 'Перешли', 'Начали', 'Результат', 'Открыли результат', 'Уникальных', 'Действий', 'Повторно в другой день', '% от активных', 'Раньше'],
      f.items.map((i) => [i.section, i.name, i.status, 'нет данных', 'нет данных', 'нет данных', i.status === 'работает' ? i.events : '—', 'нет данных', i.people, i.events, i.reused, i.share ?? '—', (pm[i.key] || {}).people ?? 0]),
      'Один человек может сделать 20 раскладов — это 1 уникальный и 20 действий. Показ входа, переход, начало и открытие результата — этапы, которые пока не размечены событиями; собирается только факт результата.')];
    R.how = 'Уникальных — люди с событием функции за период. Повторно — событие в 2+ разных днях. Доля — от активных с содержательным действием за период. Заглушки исключены из активации и активной аудитории.';
  },
  topics(R, { P }) {
    const labels = Object.fromEntries([...C.READING_TOPICS].map((t) => [t.key, t.label]));
    const users = all("SELECT id, preferences FROM users WHERE onboarded = 1 AND preferences <> ''").map((r) => { const pr = preferences(r.preferences); return { id: r.id, topics: (pr.topics || []).filter((k) => labels[k]), all: !!pr.topicsAll, views: pr.lunarViews || 0 }; });
    const onboarded = one('SELECT COUNT(*) c FROM users WHERE onboarded = 1').c;
    const chose = users.filter((x) => x.topics.length), allOn = users.filter((x) => x.all);
    const count = {}; for (const x of chose) for (const k of x.topics) count[k] = (count[k] || 0) + 1;
    const expand = Object.fromEntries(all("SELECT detail, COUNT(*) n FROM events WHERE type = 'lunar_expand' AND day BETWEEN ? AND ? GROUP BY detail", P.from, P.to).map((r) => [r.detail, r.n]));
    const setEv = one("SELECT COUNT(*) n, COUNT(DISTINCT user_id) p FROM events WHERE type = 'topics_set' AND day BETWEEN ? AND ?", P.from, P.to);
    const views = Object.fromEntries(all("SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type = 'lunar_view' AND day BETWEEN ? AND ? GROUP BY user_id", P.from, P.to).map((r) => [r.user_id, r.d]));
    const back = (ids) => { const n = ids.filter((id) => (views[id] || 0) >= 2).length; return ids.length >= 10 ? `${pct(n, ids.length)}% (${n} из ${ids.length})` : ids.length ? 'меньше 10 человек — скрыто' : '—'; };
    const withT = chose.map((x) => x.id), without = users.filter((x) => !x.topics.length).map((x) => x.id);
    const avg = chose.length ? Math.round((chose.reduce((s, x) => s + x.topics.length, 0) / chose.length) * 10) / 10 : null;
    R.kpis = [
      kpi('Выбрали темы', onboarded ? pct(chose.length, onboarded) : null, { unit: '% с анкетой', sub: `${chose.length} чел. · остальные читают набор по умолчанию` }),
      kpi('Тем в выборе', avg, { unit: 'в среднем', sub: avg === null ? 'пока никто не выбирал' : 'у тех, кто выбирал' }),
      kpi('«Показывать всё»', chose.length + allOn.length ? pct(allOn.length, users.length || 1) : null, { unit: '% настроивших', sub: `${allOn.length} чел. читают все разделы` }),
      kpi('Меняли выбор за период', setEv.p, { unit: 'чел.', sub: `${setEv.n} изменений` }),
    ];
    const keys = Object.keys(labels).filter((k) => !C.READING_META.has(k));
    R.charts = [chart('hbars', 'Какие темы выбирают', 'людей с темой в выборе', keys.map((k) => [labels[k], count[k] || 0]).sort((a, b) => b[1] - a[1]), 'Темы, которые никто не выбирает и не разворачивает за 30 дней, — кандидаты на сокращение.')];
    R.tables = [
      table('Темы', ['Тема', 'В выборе (чел.)', 'Разворачивали скрытой (раз)', 'Разворачивали, но не выбрали'], keys.map((k) => [labels[k], count[k] || 0, expand[k] || 0, expand[k] && !count[k] ? 'да — кандидат в набор по умолчанию' : '']), 'Разворот — открытие скрытого раздела по «Показать всё» или по его заголовку.'),
      table('Возвращение к лунному дню', ['Группа', 'Открывали лунный день в 2+ разных дня за период'], [['Выбрали темы', back(withT)], ['Набор по умолчанию', back(without)]], 'Связь, не причина: те, кто настраивает чтение, могли быть вовлечены и до этого.'),
      table('Сравнение с вопросами', ['Показатель', 'Значение'], [['Совпадение выбранных тем с темами вопросов «Свериться»', 'нет данных — тема вопроса в событие не пишется']], ''),
    ];
    R.notes.push('Ряд тем появляется со второго открытия лунного дня; до этого человек видит набор по умолчанию.');
    R.how = 'Выбор тем хранится в настройках человека (ключи тем, без текстов). Разворачивание скрытых разделов и смена выбора — события lunar_expand и topics_set. Личный год темами пока не режется.';
  },
  rituals(R, { P, days }) {
    const c = (sql, ...a) => one(sql, ...a).c;
    const active = activeUsers(P.from, P.to, FUNC);
    const moodP = c('SELECT COUNT(DISTINCT user_id) c FROM moods WHERE day BETWEEN ? AND ?', P.from, P.to), moodD = c('SELECT COUNT(*) c FROM moods WHERE day BETWEEN ? AND ?', P.from, P.to);
    const jr = c('SELECT COUNT(*) c FROM journal WHERE day BETWEEN ? AND ?', P.from, P.to), jrP = c('SELECT COUNT(DISTINCT user_id) c FROM journal WHERE day BETWEEN ? AND ?', P.from, P.to);
    const wAdd = c('SELECT COUNT(*) c FROM wishes WHERE substr(ts,1,10) BETWEEN ? AND ?', P.from, P.to), wDone = c("SELECT COUNT(*) c FROM wishes WHERE done = 1 AND substr(done_ts,1,10) BETWEEN ? AND ?", P.from, P.to);
    const card = c("SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'card_open' AND day BETWEEN ? AND ?", P.from, P.to);
    const streaks = all("SELECT streak FROM users WHERE streak > 0 AND streak_date >= ?", addDays(P.to, -1)).map((r) => r.streak);
    const st = steady(P.to);
    /* «own:…» — настроение, названное своим словом: это личный текст. В отчёт идёт только счётчик,
       само слово не показывается — то же правило, что и в аналитике (server.mjs, mood_set). */
    const moodDist = all("SELECT CASE WHEN mood LIKE 'own:%' THEN 'своё слово' ELSE mood END mood, COUNT(*) n FROM moods WHERE day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC", P.from, P.to);
    const firstDay = (t, a, b) => all(`SELECT type FROM events WHERE id IN (SELECT MIN(id) FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id, day)`, a, b).filter((r) => r.type === t).length;
    R.kpis = [kpi('Отметили настроение', active ? pct(moodP, active) : null, { unit: '% активных', sub: `${moodP} чел. · ${moodD} дней с отметкой` }), kpi('Записей на 1 активного', active ? Math.round(jr / active * 10) / 10 : null, { unit: '', sub: `${jr} записей · ${jrP} чел.` }), kpi('Желания', wAdd, { unit: 'добавлено', sub: `исполнено — ${wDone}` }), kpi('Открывали карту дня', card, { unit: 'чел.' }), kpi('Постоянные', st.share, { unit: '%', sub: `${st.steady} из ${st.observed} наблюдаемых ≥ 28 дней · 3 из 4 недель` }), kpi('Серия ≥ 4 дней', streaks.filter((n) => n >= 4).length, { unit: 'чел.', sub: `живых серий — ${streaks.length} · самая длинная — ${streaks.length ? Math.max(...streaks) : 0}` }), kpi('Настроение сегодня', (() => { const d = activeUsers(P.to, P.to, FUNC); return d ? pct(c('SELECT COUNT(*) c FROM moods WHERE day = ?', P.to), d) : null; })(), { unit: '% активных за день' })];
    R.charts = [chart('line', 'Дни с настроением', 'отметок в день', fill(days, all('SELECT day, COUNT(*) n FROM moods WHERE day BETWEEN ? AND ? GROUP BY day', P.from, P.to))), chart('pie', 'Настроения', 'только в агрегате', moodDist.map((m) => [m.mood, m.n]))];
    R.tables = [table('Механики удержания', ['Механика', 'Показатель', 'Значение'], [
      ['Карта дня', 'уникальных за период / повторно в другой день', `${card} / ${one("SELECT COUNT(*) c FROM (SELECT user_id, COUNT(DISTINCT day) d FROM events WHERE type='card_open' AND day BETWEEN ? AND ? GROUP BY user_id HAVING d>=2)", P.from, P.to).c}`],
      ['Настроение', 'было первым действием посещения (раз)', firstDay('mood_set', P.from, P.to)],
      ['Записи', 'дней с записями', c('SELECT COUNT(DISTINCT day) c FROM journal WHERE day BETWEEN ? AND ?', P.from, P.to)],
      ['Желания', 'добавлено / исполнено', `${wAdd} / ${wDone}`],
      ['Недельный ИИ-отчёт', 'создано / открыто', 'не запущено'], ['Привычки и благодарности', 'продолжение на 2-й и 4-й неделе', 'не запущено'], ['Вопрос дня, число дня, аффирмация', 'повторные открытия', 'нет данных — событие не собирается'],
    ])];
    R.how = 'Настроение — таблица отметок по дням, только агрегат. Постоянный — действия хотя бы в 3 из последних 4 недель; в долю входят только наблюдаемые ≥ 28 дней, новички отдельно.';
  },
  notifications(R, { P, days }) {
    const subs = one('SELECT COUNT(DISTINCT user_id) c FROM push_subs').c, users = one("SELECT COUNT(*) c FROM users WHERE email <> ''").c;
    const on = one("SELECT COUNT(*) c FROM events WHERE type = 'push_on' AND day BETWEEN ? AND ?", P.from, P.to).c, offN = one("SELECT COUNT(*) c FROM events WHERE type = 'push_off' AND day BETWEEN ? AND ?", P.from, P.to).c;
    const sentDays = all('SELECT last_ok day, COUNT(*) n FROM push_subs WHERE last_ok BETWEEN ? AND ? GROUP BY last_ok', P.from, P.to);
    const sent = sentDays.reduce((s, r) => s + r.n, 0);
    const back1h = (() => { let n = 0; for (const r of all('SELECT user_id, last_ok FROM push_subs WHERE last_ok BETWEEN ? AND ?', P.from, P.to)) { if (one("SELECT 1 FROM events WHERE user_id = ? AND day = ? AND type = 'app_open' AND ts BETWEEN ? AND ? LIMIT 1", r.user_id, r.last_ok, r.last_ok + 'T06:00:00', r.last_ok + 'T07:00:00')) n++; } return n; })();
    R.kpis = [kpi('С включённым пушем', pct(subs, users), { unit: '%', sub: `${subs} из ${users}` }), kpi('Отправлено', sent, { unit: 'шт.', sub: '09:00 МСК, «карта дня готова»' }), kpi('Вернулись в течение часа', sent ? pct(back1h, sent) : null, { unit: '%', sub: `${back1h} открытий 09:00–10:00 МСК` }), kpi('Включили / выключили', on, { unit: `вкл · выкл ${offN}` }), off('Ежедневные письма', 'рассылка не запущена'), nodata('Открытия пуша', 'событие клика по уведомлению не собирается')];
    R.charts = [chart('line', 'Отправлено пушей', 'по дням', fill(days, sentDays))];
    R.tables = [table('Пуши и письма', ['Канал', 'Включено', 'Отправлено', 'Открыто', 'Отключений', 'Возврат за час'], [['Пуш', subs, sent, 'нет данных', offN, back1h], ['Письмо', 'не запущено', '—', '—', '—', '—']], 'Результат по времени отправки будет сравним, когда появится второе время.')];
    R.how = 'Отправка — отметка дня у подписки после успешного пуша. Возврат — открытие приложения в течение часа после утренней отправки.';
  },
  ai(R) {
    R.kpis = [off('Расходы на ИИ сегодня', 'ИИ-модели в приложении не подключены'), off('Токены за месяц', ''), off('Стоимость открытого отчёта', ''), off('Невостребованные материалы', '')];
    R.tables = [table('Журнал ИИ-вызовов', ['Время', 'Пользователь (id)', 'Функция', 'Запуск', 'Поставщик', 'Модель', 'Версия инструкции', 'Вход', 'Выход', 'Кэш', 'Стоимость', 'Задержка', 'Статус', 'Создан', 'Показан', 'Открыт'], [], 'Структура журнала готова; записи появятся с первым подключённым сценарием. Кэшированные токены входят во входные и не прибавляются второй раз. Тексты запросов и ответов в кабинете не показываются.')];
    R.notes = ['Повторное открытие сохранённого результата — просмотр, не новый расход.'];
    R.how = 'Технический вызов, успешное создание, показ, открытие и повторное открытие — разные события.';
  },
  economy(R, { today }) {
    const cs = costs(today);
    const mau = activeUsers(addDays(today, -29), today, FUNC);
    const perActive = mau ? Math.round(cs.spent / mau) : null;
    const serviceOnly = cs.spent - cs.dev;
    R.kpis = [kpi('Сегодня', cs.today, { unit: '₽', good: 'down' }), kpi('За 7 дней', cs.week, { unit: '₽', good: 'down' }), kpi('За месяц', cs.spent, { prev: cs.prevSpent, unit: '₽', sub: `без разработки — ${Math.round(serviceOnly)} ₽`, good: 'down' }), kpi('Прогноз до конца месяца', cs.forecast, { unit: '₽', sub: cs.budget ? `бюджет ${cs.budget} ₽ · ${cs.forecast <= cs.budget ? 'укладываемся' : 'превышение на ' + (cs.forecast - cs.budget) + ' ₽'}` : 'бюджет не задан', good: 'down' }), kpi('На 1 активного в месяц', perActive, { unit: '₽', sub: `MAU ${mau}` , good: 'down' }), kpi('Прогноз на 1 000 активных', perActive === null ? null : perActive * 1000, { unit: '₽/мес', sub: `на 10 000 — ${perActive === null ? '—' : perActive * 10000} ₽` })];
    R.charts = [chart('pie', 'Структура расходов', cs.month, Object.entries(cs.byCat)), chart('line', 'Накопление расходов', 'по дням внесения', (() => { let acc = 0; return all("SELECT substr(ts,1,10) day, SUM(amount) n FROM costs WHERE month = ? AND kind <> 'budget' GROUP BY day ORDER BY day", cs.month).map((r) => ({ x: r.day, y: (acc += r.n) })); })())];
    R.tables = [table('Строки расходов · ' + cs.month, ['Категория', 'Что', 'Сумма', 'Внесено', ''], cs.rows.map((r) => [COST_KINDS[r.kind] || r.kind, r.name, Math.round(r.amount), r.ts.slice(0, 10), r.id]), 'Расходы тестовых аккаунтов и разработки исключаются из нормативов обслуживания по умолчанию.')];
    R.costForm = { month: cs.month, kinds: ['infra', 'services', 'support', 'content', 'acquisition', 'dev', 'budget'].map((k) => [k, COST_KINDS[k]]) };
    R.how = 'Прогноз = инфраструктура и разработка + переменные категории, растянутые на месяц по среднему за прошедшие дни. Стоимость обслуживания одного активного — расходы месяца без разработки на MAU.';
  },
  lifecycle(R, { today }) {
    const lv = levels(today);
    const total = one("SELECT COUNT(*) c FROM users").c, withMail = one("SELECT COUNT(*) c FROM users WHERE email <> ''").c;
    const everRegistered = one("SELECT MAX(id) c FROM users").c;
    const del30 = all("SELECT id, last_seen FROM users WHERE email <> ''").filter((u) => { const g = daysBetween(u.last_seen.slice(0, 10), today); return g >= 31 && g < 61; }).length;
    R.kpis = [kpi('Аккаунтов сейчас', withMail, { unit: 'с почтой', sub: `всего записей в живой базе — ${total}` }), kpi('Зарегистрировались за всё время', everRegistered, { unit: '', sub: 'накопительный счётчик, не уменьшается' }), kpi('Спящие', lv['Спящие'], { unit: 'чел.', sub: '15–30 дней' }), kpi('Удалятся в ближайшие 30 дней', del30, { unit: 'чел.', sub: 'если автоудаление включат', good: 'down' }), off('Предупреждено за месяц', 'письмо о бездействии не отправляется'), off('Удалено автоматически', 'автоудаление не запущено')];
    R.charts = [chart('funnel', 'Стадии', 'по сроку отсутствия', [['Активные (≤14 дней)', lv['Ядро'] + lv['Регулярные'] + lv['Редкие']], ['Спящие 15–30', lv['Спящие']], ['Предупреждённые 31–60', lv['Предупреждённые']], ['К удалению 61+', lv['К удалению']]])];
    R.tables = [table('События жизненного цикла', ['Событие', 'За месяц'], [['Предупреждение отправлено', 'не запущено'], ['Предупреждение не доставлено', 'не запущено'], ['Вход после предупреждения', 'не запущено'], ['Удалено автоматически', 'не запущено'], ['Удалено самостоятельно', 'нет данных — событие удаления не собирается'], ['Повторная регистрация после удаления', 'не распознаётся']], 'Отток датируется последним содержательным действием, а не датой удаления. Причина удаления хранится отдельно: самостоятельно, автоматически, администратором.')];
    R.notes = ['Открытый вопрос владельцев: можно ли после удаления хранить идентификатор, чтобы узнать вернувшегося человека. Это противоречит требованию удалить идентифицируемые данные — в продукте удалённый остаётся только обезличенной статистикой.'];
    R.how = '«Аккаунтов сейчас» — живая база; «за всё время» — неубывающий счётчик. Стадии: спящие 15–30 дней без захода, предупреждённые 31–60, к удалению с 61-го.';
  },
  users(R, { q }) {
    const plat = userPlatforms(), staff = staffEmails();
    const s = String(q.q || '').toLowerCase().trim(), stage = q.stage || '';
    const rows = all("SELECT id, email, name, created_at, last_seen, email_at, invited_by, onboarded, streak, streak_date FROM users WHERE email <> '' ORDER BY last_seen DESC");
    const today = R.today;
    const list = rows.map((u) => {
      const gone = daysBetween(u.last_seen.slice(0, 10), today);
      const st = gone >= 61 ? 'К удалению' : gone >= 31 ? 'Предупреждённые' : gone >= 15 ? 'Спящие' : 'Активные';
      const days = one(`SELECT COUNT(DISTINCT day) c FROM events WHERE user_id = ? AND type IN (${inList(FUNC)})`, u.id).c;
      const feats = all(`SELECT DISTINCT type FROM events WHERE user_id = ? AND type IN (${inList(FUNC)})`, u.id).map((r) => FNAME[r.type] || r.type);
      return { id: u.id, email: mask(u.email), name: u.name, reg: (u.email_at || u.created_at).slice(0, 10), last: u.last_seen.slice(0, 10), source: u.invited_by ? 'Приглашение' : 'Прямой', platform: plat[u.id] || '—', days, streak: u.streak_date >= addDays(today, -1) ? u.streak : 0, stage: st, feats, push: !!one('SELECT 1 FROM push_subs WHERE user_id = ? LIMIT 1', u.id), role: staff.has(u.email) ? 'сотрудник' : '', test: staff.has(u.email) };
    }).filter((u) => (!s || u.email.toLowerCase().includes(s) || (u.name || '').toLowerCase().includes(s) || String(u.id) === s) && (!stage || u.stage === stage));
    R.filters = [{ key: 'stage', label: 'Стадия', options: [['Активные', 'Активные'], ['Спящие', 'Спящие'], ['Предупреждённые', 'Предупреждённые'], ['К удалению', 'К удалению']], value: stage }];
    R.kpis = [kpi('Найдено', list.length, { unit: 'чел.' }), kpi('Сотрудников в списке', list.filter((u) => u.test).length, { unit: '', sub: 'исключаются из нормативов' })];
    R.userList = list.slice(0, 500);
    R.how = 'В списке только сведения для поиска и работы: почта скрыта частично, личных текстов нет. Три разные даты — авторизация, посещение и содержательное действие — доступны в карточке.';
  },
  events(R, { P, days }) {
    const rows = all('SELECT type, COUNT(*) n, COUNT(DISTINCT user_id) p FROM events WHERE day BETWEEN ? AND ? GROUP BY type ORDER BY n DESC', P.from, P.to);
    const prev = Object.fromEntries(all('SELECT type, COUNT(*) n FROM events WHERE day BETWEEN ? AND ? GROUP BY type', P.prevFrom, P.prevTo).map((r) => [r.type, r.n]));
    R.kpis = [kpi('Событий за период', rows.reduce((s, r) => s + r.n, 0), { unit: 'шт.' }), kpi('Типов событий', rows.length, { unit: `из ${Object.keys(EVENT_NAMES).length} в каталоге` })];
    R.charts = [chart('line', 'Событий по дням', 'все типы', fill(days, all('SELECT day, COUNT(*) n FROM events WHERE day BETWEEN ? AND ? GROUP BY day', P.from, P.to)))];
    R.tables = [table('По типам', ['Событие', 'Ключ', 'Раз', 'Людей', 'Раньше'], rows.map((r) => [EVENT_NAMES[r.type] || r.type, r.type, r.n, r.p, prev[r.type] || 0])),
      table('Каталог: что ещё не собирается', ['Поверхность', 'События'], [['Вход', 'шаг анкеты, остановка на поле, время заполнения, код доставлен / не доставлен, введён неверно / просрочен'], ['Главная', 'открытие каждого из 5 квадратов и каждой заглушки'], ['Мой день', 'вопрос дня отвечен, прогноз и сферы, аффирмация открыта / расшарена'], ['Что вокруг и История', 'лунный день, событие неба, вкладка истории, автосохранение отдельно'], ['Социальные', 'приглашение показано / создано, совместимость просмотрена, карточка создана / сохранена, переход по ней'], ['Аккаунт', 'выход, изменение анкеты, очистка истории, удаление с причиной, переключение роли'], ['Система', 'старт сессии, версия приложения, часовой пояс, UTM'], ['Жизненный цикл', 'предупреждение, вход после него, автоудаление, причина']])];
    R.how = 'Событие хранит тип, деталь без личного текста и возрастную группу. Почта, тексты дневника, желаний и вопросов в событие не пишутся.';
  },
  system(R, { P, days }) {
    const errs = all('SELECT path, COUNT(*) n, MAX(ts) last FROM errors WHERE day BETWEEN ? AND ? GROUP BY path ORDER BY n DESC', P.from, P.to);
    const errSeries = fill(days, all('SELECT day, COUNT(*) n FROM errors WHERE day BETWEEN ? AND ? GROUP BY day', P.from, P.to));
    let dbSize = null; try { dbSize = Math.round(statSync(join(DATA_DIR, 'app.db')).size / 1048576 * 10) / 10; } catch {}
    const lastPush = one('SELECT MAX(last_ok) d FROM push_subs').d;
    const pr = problems(P.from, P.to);
    const ua = {}; for (const s of all('SELECT ua FROM sessions WHERE last_seen >= ?', addDays(R.today, -30))) { const k = platformOf(s.ua); ua[k] = (ua[k] || 0) + 1; }
    R.kpis = [kpi('Сбоев за период', errs.reduce((s, e) => s + e.n, 0), { unit: 'шт.', good: 'down' }), kpi('Ночная рассылка', lastPush ? (lastPush >= addDays(R.today, -1) ? 'ок' : 'не было ' + lastPush) : null, { unit: '', sub: 'последняя успешная отправка ' + (lastPush || '—'), state: lastPush ? 'ok' : 'nodata' }), kpi('База данных', dbSize, { unit: 'МБ' }), nodata('Задержка API', 'время ответа не логируется'), nodata('Клиентские ошибки', 'сбор ошибок из браузера не подключён'), off('Почтовые алерты', 'не настроены')];
    R.charts = [chart('line', 'Сбои по дням', 'ошибки сервера и почты', errSeries), chart('pie', 'Платформы сессий', 'за 30 дней', Object.entries(ua))];
    R.tables = [table('Сигналы', ['Сигнал', 'Значение', 'Пояснение'], pr.items.map((i) => [i.name, i.state === 'off' ? 'не запущено' : i.value, i.hint])), table('Где ломается', ['Адрес', 'Раз', 'Последний'], errs.map((e) => [e.path, e.n, e.last.replace('T', ' ').slice(0, 16)])), table('Последние сбои', ['Когда', 'Где', 'Что'], all('SELECT ts, path, message FROM errors WHERE day BETWEEN ? AND ? ORDER BY ts DESC LIMIT 50', P.from, P.to).map((e) => [e.ts.replace('T', ' ').slice(0, 16), e.path, e.message]))];
    R.how = 'Сбой — ответ сервера с ошибкой или неудачная отправка письма. Напоминания уходят по таймеру раз в 5 минут в часовом поясе человека; «ок», если сегодня или вчера были успешные отправки.';
  },
  data(R, { P }) {
    const total = one('SELECT COUNT(*) c FROM events WHERE day BETWEEN ? AND ?', P.from, P.to).c;
    const orphan = one('SELECT COUNT(*) c FROM events WHERE day BETWEEN ? AND ? AND user_id NOT IN (SELECT id FROM users)', P.from, P.to).c;
    const dup = one("SELECT COUNT(*) c FROM (SELECT user_id, type, ts FROM events WHERE day BETWEEN ? AND ? GROUP BY user_id, type, ts HAVING COUNT(*) > 1)", P.from, P.to).c;
    const unknownSrc = one("SELECT COUNT(*) c FROM users WHERE email <> '' AND invited_by IS NULL").c, withMail = one("SELECT COUNT(*) c FROM users WHERE email <> ''").c;
    const staff = staffEmails().size;
    const unlinkedCosts = one("SELECT COUNT(*) c FROM costs WHERE kind NOT IN ('infra','services','support','content','acquisition','dev','budget','fixed','variable')").c;
    R.kpis = [kpi('Обновление аналитики', 'живое', { unit: '', sub: 'отчёты читают базу напрямую; ночного агрегата пока нет' }), kpi('Неизвестный источник', pct(unknownSrc, withMail), { unit: '%', sub: 'без UTM и кода приглашения', good: 'down' }), kpi('События без пользователя', orphan, { unit: `из ${total}`, good: 'down' }), kpi('Повторные события', dup, { unit: 'шт.', good: 'down' }), kpi('Тестовые аккаунты', staff, { unit: 'сотрудников', sub: 'исключаются из нормативов' }), kpi('Расходы без категории', unlinkedCosts, { unit: 'строк', good: 'down' }), nodata('Расхождение с биллингом', 'биллинг ИИ не подключён')];
    R.tables = [table('Что нужно для достоверности', ['Правило', 'Статус'], [['Единый внутренний идентификатор пользователя', 'есть'], ['Разделение тестовых и реальных аккаунтов', 'по списку сотрудников'], ['Единый перечень событий', 'есть (каталог в «Журнале событий»)'], ['Источник перехода внутри приложения', 'нет — событие без источника'], ['UTC, часовой пояс и локальная дата в событии', 'только UTC и день по МСК'], ['Версия приложения и экрана', 'нет'], ['Числитель, знаменатель и окно у процентов', 'показываются в каждом отчёте'], ['Отметки релизов и кампаний на графиках', 'нет'], ['Ночной агрегат', 'нет — живой расчёт'], ['Контроль повторных событий', 'проверка в этом отчёте']])];
    R.how = 'Отчёт проверяет саму аналитику: без этого проценты нельзя читать.';
  },
  content(R) {
    R.tables = [];   // каталог файлов добавляет сервер (ему известна папка content)
    R.how = 'Тексты живут обычными файлами; правка через кабинет сохраняется на сервер и подхватывается без перезапуска. Статусы «черновик / на проверке / запланирован / опубликован» и дата показа — не запущены: файл публикуется сразу.';
  },
  quality(R) {
    R.kpis = [off('Замечаний к текстам', 'кнопка «что не подошло» после результата не запущена')];
    R.tables = [table('Категории замечаний', ['Категория', 'За период'], ['Непонятный результат', 'Повторяющийся текст', 'Пугающая формулировка', 'Чрезмерная категоричность', 'Неверная персонализация', 'Ошибка календаря'].map((c) => [c, 'не запущено']), 'Оценки «откликнулось» и «помогло поразмышлять» описывают впечатление и не подтверждают точность прогноза.')];
    R.how = 'Сообщения о качестве распределяются по рабочим категориям, чтобы контент-редактор видел, что править.';
  },
  tickets(R) {
    const q = ticketQueue('');
    const openN = q.filter((t) => t.status !== 'resolved').length, waiting = q.filter((t) => t.firstReplyMin === null && t.status !== 'resolved').length, unread = q.reduce((s, t) => s + t.unread, 0);
    R.kpis = [kpi('Открытых обращений', openN, { unit: 'шт.', good: 'down' }), kpi('Ждут первого ответа', waiting, { unit: 'шт.', good: 'down' }), kpi('Непрочитанных сообщений', unread, { unit: 'шт.', good: 'down' }), kpi('Всего обращений', q.length, { unit: 'шт.' })];
    R.queue = q; R.statuses = TICKET_STATUS;
    R.notes = ['Поддержка не видит дневник, желания, благодарности, личные вопросы и настроение. Полная переписка — только внутри обращения, которое человек сам направил.'];
    R.how = 'Статусы: новое → в работе → ждём ответа пользователя → решено. Первый ответ — цель 30 минут. Ответ поддержки сразу виден человеку в приложении, в разделе «Чат».';
  },
  supportmetrics(R, { P, days }) {
    const m = slaMetrics(P.from, P.to, P.prevFrom, P.prevTo), c = m.cur, pv = m.prev;
    R.kpis = [
      kpi('Открыто сейчас', m.open, { unit: 'шт.', sub: `ждут первого ответа — ${m.waitingFirst}`, good: 'down' }),
      kpi('Первый ответ · медиана', c.medianFirst, { prev: pv.medianFirst, unit: 'мин', sub: `цель ≤ ${m.slaMin} мин`, good: 'down' }),
      kpi('В пределах SLA', pct(c.withinSla, c.answered), { prev: pct(pv.withinSla, pv.answered), unit: '%', sub: `${c.withinSla} из ${c.answered} отвеченных` }),
      kpi('Время решения · медиана', c.medianResolve, { prev: pv.medianResolve, unit: 'ч', sub: `${c.resolved} решено`, good: 'down' }),
      kpi('Обращений за период', c.total, { prev: pv.total, unit: 'шт.' }),
      kpi('Повторные обращения', c.repeat, { prev: pv.repeat, unit: 'чел.', sub: 'написали больше одного раза', good: 'down' }),
    ];
    R.charts = [chart('line', 'Обращения по дням', 'созданные', fill(days, c.byDay)), chart('hbars', 'Темы обращений', 'за период', c.topics)];
    R.tables = [table('Темы', ['Тема', 'Обращений', 'Раньше'], c.topics.map(([t, n]) => [t, n, (pv.topics.find((x) => x[0] === t) || [0, 0])[1]])), table('FAQ и «С чего начать»', ['Показатель', 'Значение'], [['FAQ помог', 'не запущено'], ['Прошли «С чего начать»', 'нет данных — событие завершения не собирается']])];
    R.how = `Первый ответ — от создания обращения до первого сообщения поддержки; SLA — доля ответов за ${m.slaMin} минут среди отвеченных. Время решения — до перевода в «Решено». Повторные — люди с двумя и более обращениями за период.`;
  },
  faq(R, { P }) {
    const tour = one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'tour_view' AND day BETWEEN ? AND ?", P.from, P.to).c;
    R.kpis = [kpi('Открыли «С чего начать»', tour, { unit: 'чел.' }), off('Просмотры FAQ', 'раздел FAQ не запущен'), off('Ответили «помогло»', '')];
    R.tables = [table('Сценарий «С чего начать»', ['Шаг', 'Дошли'], [['Открыли', tour], ['Прошли до конца', 'нет данных — событие завершения не собирается']])];
    R.how = 'Открытие — событие показа подсказки «С чего начать».';
  },
  saved(R) { R.how = 'Сохранённые отчёты живут в этом браузере вместе с фильтрами.'; },
  campaigns(R) { R.how = 'Одна кампания — один набор UTM (source / medium / campaign, при желании content). Ссылка строится сама; люди, пришедшие по ней, привязываются к кампании при первом открытии приложения, и в «Привлечении» по ним считается цена регистрации, активированного и удержанного.'; },
  materials(R) { R.how = 'Опубликованный «Вопрос дня» или «Аффирмация» с датой показа подменяет текст из файла в «Моём дне» у всех пользователей в этот день; без даты — действует каждый день, пока опубликован. Черновики и «на проверке» в приложение не попадают.'; },
  media(R) { R.how = 'Файл хранится на сервере рядом с базой и отдаётся по ссылке /app/uploads/…; ссылку можно вставить в материал или отдать разработчику. До 5 МБ: PNG, JPG, WebP, GIF, SVG, PDF.'; },
  backlog(R) { R.how = 'Задачи ставят продуктолог и админ; контент и поддержка видят только свои, меняют статус и видят, что уже готово. Статусы: новая → в работе → на проверке → готово.'; },
  access(R) { R.how = 'Два администратора равноправны и защищены: их нельзя удалить или понизить. Остальным сотрудникам можно назначить несколько ролей.'; },
};

/* карточка пользователя — без личных текстов */
export function userCard(id) {
  const u = one('SELECT id, email, name, created_at, last_seen, email_at, invited_by, onboarded, streak, streak_date, city, tz FROM users WHERE id = ?', Number(id));
  if (!u) return null;
  const lastAuth = one("SELECT MAX(ts) t FROM events WHERE user_id = ? AND type = 'login_done'", u.id).t;
  const lastAct = one(`SELECT MAX(ts) t FROM events WHERE user_id = ? AND type IN (${inList(FUNC)})`, u.id).t;
  const days = one(`SELECT COUNT(DISTINCT day) c FROM events WHERE user_id = ? AND type IN (${inList(FUNC)})`, u.id).c;
  const byType = all('SELECT type, COUNT(*) n, MAX(day) last FROM events WHERE user_id = ? GROUP BY type ORDER BY n DESC', u.id).map((r) => [EVENT_NAMES[r.type] || r.type, r.n, r.last]);
  const first = firstFunc(u.id);
  const plat = platformOf((one('SELECT ua FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 1', u.id) || {}).ua);
  return { id: u.id, email: mask(u.email), name: u.name, reg: (u.email_at || u.created_at).slice(0, 10), lastAuth: lastAuth ? lastAuth.slice(0, 16).replace('T', ' ') : '—', lastSeen: u.last_seen.slice(0, 16).replace('T', ' '), lastAct: lastAct ? lastAct.slice(0, 16).replace('T', ' ') : '—',
    days, streak: u.streak, first: first ? `${FNAME[first.type] || first.type} · ${first.ts.slice(0, 10)}` : '—', source: u.invited_by ? 'Приглашение' : 'Прямой', platform: plat, push: !!one('SELECT 1 FROM push_subs WHERE user_id = ? LIMIT 1', u.id), city: u.city, tz: u.tz,
    counts: { entries: one('SELECT COUNT(*) c FROM entries WHERE user_id = ?', u.id).c, journal: one('SELECT COUNT(*) c FROM journal WHERE user_id = ?', u.id).c, wishes: one('SELECT COUNT(*) c FROM wishes WHERE user_id = ?', u.id).c, moods: one('SELECT COUNT(*) c FROM moods WHERE user_id = ?', u.id).c },
    byType, tickets: (() => { const t = one("SELECT COUNT(*) c, SUM(status <> 'resolved') o FROM tickets WHERE user_id = ?", u.id); return t.c ? `${t.c} · открытых ${t.o || 0}` : 'обращений не было'; })(), ai: 'ИИ не подключён' };
}
