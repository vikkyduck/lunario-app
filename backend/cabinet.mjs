/* Рабочие кабинеты: роли по почте и единый дашборд.
   Все цифры считаются из тех же таблиц, что и приложение (events, users, …) — один источник.
   Личных текстов здесь нет: только счётчики, дни и типы событий. */

export const ROLES = {
  admin:     'Админ',
  marketing: 'Маркетолог',
  product:   'Продуктолог',
  content:   'Контент',
  support:   'Поддержка',
  user:      'Пользователь',
};
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'vikavika.utkina@yandex.ru,e.ratochka@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (email) => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

/* Какие блоки дашборда видит роль. Админ — всё. */
const BLOCK_ROLES = {
  new_users:  ['marketing', 'product'],
  activation: ['product', 'content'],
  active:     ['marketing', 'product'],
  repeat:     ['product', 'marketing', 'content'],
  retention:  ['marketing', 'product'],
  features:   ['product', 'content'],
  costs:      [],
  problems:   ['support', 'product'],
};

/* «Работающие функции» — то, что даёт результат человеку. Открыть приложение или посмотреть
   витрину результатом не считаем. */
const FUNC = ['card_open', 'mood_set', 'ask_yesno', 'ask_rune', 'ask_spread', 'journal_add', 'wish_add', 'compat_calc', 'worry_pick', 'share_card'];
const FEATURE_NAMES = {
  card_open: 'Карта дня', mood_set: 'Настроение дня', ask_yesno: 'Да / Нет', ask_rune: 'Руна', ask_spread: 'Три карты',
  journal_add: 'Дневник', wish_add: 'Мои желания', compat_calc: 'Совместимость', worry_pick: 'Что вас беспокоит?',
  share_card: 'Поделиться карточкой', invite_copy: 'Позвать подругу', push_on: 'Напоминание', installed: 'Установка на телефон',
};
const inList = (arr) => arr.map((s) => `'${s}'`).join(',');

let db;
export function initCabinet(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      email TEXT PRIMARY KEY, name TEXT DEFAULT '', roles TEXT DEFAULT '[]',
      added_by TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'fixed', ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
      path TEXT DEFAULT '', message TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_errors_day ON errors (day);
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('email_at')) {
    db.exec("ALTER TABLE users ADD COLUMN email_at TEXT DEFAULT ''");
    // у тех, кто уже с почтой, момент подтверждения берём из события входа, иначе — из даты создания
    db.exec(`UPDATE users SET email_at = COALESCE(
      (SELECT MIN(ts) FROM events e WHERE e.user_id = users.id AND e.type = 'login_done'), created_at)
      WHERE email <> '' AND email_at = ''`);
  }
}

export function logError(path, message) {
  try {
    const ts = new Date().toISOString();
    db.prepare('INSERT INTO errors (ts, day, path, message) VALUES (?,?,?,?)').run(ts, dayMSK(), String(path).slice(0, 120), String(message).slice(0, 300));
  } catch {}
}

/* ── роли ── */
export function rolesFor(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return [];
  if (isAdmin(e)) return Object.keys(ROLES);
  const row = db.prepare('SELECT roles FROM staff WHERE email = ?').get(e);
  if (!row) return [];
  const roles = safeRoles(JSON.parse(row.roles || '[]'));
  return roles.length ? [...new Set([...roles, 'user'])] : [];
}
const safeRoles = (arr) => (Array.isArray(arr) ? arr : []).filter((r) => r in ROLES && r !== 'admin');

export function staffList() {
  const rows = db.prepare('SELECT email, name, roles, added_by, created_at FROM staff ORDER BY created_at').all()
    .map((r) => ({ ...r, roles: safeRoles(JSON.parse(r.roles || '[]')), admin: false }));
  const admins = ADMIN_EMAILS.map((email) => {
    const u = db.prepare('SELECT name FROM users WHERE email = ?').get(email);
    return { email, name: (u && u.name) || '', roles: Object.keys(ROLES), admin: true, locked: true };
  });
  return [...admins, ...rows.filter((r) => !isAdmin(r.email))];
}
export function staffSet(email, name, roles, by) {
  const e = String(email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return { ok: false, error: 'bad_email' };
  if (isAdmin(e)) return { ok: false, error: 'admin_locked' };          // права админов не трогаются
  const r = safeRoles(roles);
  db.prepare(`INSERT INTO staff (email, name, roles, added_by, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, roles = excluded.roles`)
    .run(e, String(name || '').slice(0, 80), JSON.stringify(r), by || '', new Date().toISOString());
  return { ok: true };
}
export function staffRemove(email) {
  const e = String(email || '').toLowerCase();
  if (isAdmin(e)) return { ok: false, error: 'admin_locked' };
  db.prepare('DELETE FROM staff WHERE email = ?').run(e);
  return { ok: true };
}

/* ── периоды ── */
const MSK = 'Europe/Moscow';
export const dayMSK = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: MSK });
const addDays = (day, n) => { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

export function periodOf(q) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : dayMSK();
  let from;
  const preset = q.period || '7d';
  if (preset === 'month') from = to.slice(0, 8) + '01';
  else if (preset === '30d') from = addDays(to, -29);
  else if (preset === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) from = q.from;
  else from = addDays(to, -6);
  if (from > to) from = to;
  const len = daysBetween(from, to) + 1;
  let prevTo, prevFrom;
  if (preset === 'month') {                          // сравнение с тем же числом прошлого месяца
    const m = new Date(from + 'T12:00:00Z'); m.setUTCMonth(m.getUTCMonth() - 1);
    prevFrom = m.toISOString().slice(0, 10);
    const pt = new Date(to + 'T12:00:00Z'); pt.setUTCMonth(pt.getUTCMonth() - 1);
    prevTo = pt.toISOString().slice(0, 10);
  } else { prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(len - 1)); }
  return { preset, from, to, prevFrom, prevTo, len };
}

/* ── считалки ── */
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const delta = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : (cur ? null : 0));

function seriesDays(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
function fillSeries(days, rows, key = 'n') { const m = Object.fromEntries(rows.map((r) => [r.day, r[key]])); return days.map((d) => ({ day: d, n: m[d] || 0 })); }

// новые с подтверждённой почтой: по дню подтверждения
function newUsers(from, to) {
  const rows = all(`SELECT substr(email_at,1,10) day, COUNT(*) n FROM users WHERE email <> '' AND email_at <> ''
    AND substr(email_at,1,10) BETWEEN ? AND ? GROUP BY day`, from, to);
  return { total: rows.reduce((s, r) => s + r.n, 0), rows };
}
// активация: из новых за период — те, кто в первые 7 дней сделал хоть одно результативное действие
function activation(from, to) {
  const cohort = all(`SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ?`, from, to);
  let activated = 0; const byFeature = {};
  for (const u of cohort) {
    const ev = all(`SELECT type, MIN(day) d FROM events WHERE user_id = ? AND type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY type`, u.id, u.day, addDays(u.day, 7));
    if (ev.length) { activated++; for (const e of ev) byFeature[e.type] = (byFeature[e.type] || 0) + 1; }
  }
  return { cohort: cohort.length, activated, share: pct(activated, cohort.length), byFeature };
}
const ACTIVE_TYPES = ['app_open', ...FUNC];
function activeUsers(fromDay, toDay) {
  return one(`SELECT COUNT(DISTINCT user_id) c FROM events WHERE type IN (${inList(ACTIVE_TYPES)}) AND day BETWEEN ? AND ?`, fromDay, toDay).c;
}
function activeBlock(to) {
  return { dau: activeUsers(to, to), wau: activeUsers(addDays(to, -6), to), mau: activeUsers(addDays(to, -29), to) };
}
// повторное использование за период и «постоянные»: результативные функции в 4+ разных дня за 7 дней
function repeatBlock(from, to) {
  const perUser = all(`SELECT user_id, COUNT(DISTINCT day) days FROM events WHERE type IN (${inList(ACTIVE_TYPES)}) AND day BETWEEN ? AND ? GROUP BY user_id`, from, to);
  const active = perUser.length, repeat = perUser.filter((r) => r.days >= 2).length;
  const dist = { '1': 0, '2': 0, '3': 0, '4+': 0 };
  for (const r of perUser) dist[r.days >= 4 ? '4+' : String(r.days)]++;
  const wk = all(`SELECT user_id, COUNT(DISTINCT day) days FROM events WHERE type IN (${inList(FUNC)}) AND day BETWEEN ? AND ? GROUP BY user_id HAVING days >= 4`, addDays(to, -6), to);
  return { active, repeat, share: pct(repeat, active), regulars: wk.length, dist };
}
// возврат после регистрации: когорта — подтвердившие почту в период; D1 — активен ровно на следующий день,
// D7 — на седьмой, W4 — хоть раз в дни 21–27
function retentionBlock(from, to, today) {
  const cohort = all(`SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ?`, from, to);
  const act = (id, a, b) => !!one(`SELECT 1 FROM events WHERE user_id = ? AND type IN (${inList(ACTIVE_TYPES)}) AND day BETWEEN ? AND ? LIMIT 1`, id, a, b);
  const r = { d1: { eligible: 0, back: 0 }, d7: { eligible: 0, back: 0 }, w4: { eligible: 0, back: 0 } };
  for (const u of cohort) {
    if (addDays(u.day, 1) <= today) { r.d1.eligible++; if (act(u.id, addDays(u.day, 1), addDays(u.day, 1))) r.d1.back++; }
    if (addDays(u.day, 7) <= today) { r.d7.eligible++; if (act(u.id, addDays(u.day, 7), addDays(u.day, 7))) r.d7.back++; }
    if (addDays(u.day, 27) <= today) { r.w4.eligible++; if (act(u.id, addDays(u.day, 21), addDays(u.day, 27))) r.w4.back++; }
  }
  for (const k of Object.keys(r)) r[k].pct = r[k].eligible ? pct(r[k].back, r[k].eligible) : null;   // когорта ещё не дожила до этого дня — прочерк, а не 0
  return { cohort: cohort.length, ...r };
}
function featuresBlock(from, to) {
  const types = Object.keys(FEATURE_NAMES);
  const rows = all(`SELECT type, COUNT(*) events, COUNT(DISTINCT user_id) people FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ? GROUP BY type`, from, to);
  const reuse = all(`SELECT type, COUNT(*) people FROM (SELECT type, user_id, COUNT(DISTINCT day) d FROM events WHERE type IN (${inList(types)}) AND day BETWEEN ? AND ? GROUP BY type, user_id HAVING d >= 2) GROUP BY type`, from, to);
  const active = activeUsers(from, to);
  const m = Object.fromEntries(rows.map((r) => [r.type, r])), re = Object.fromEntries(reuse.map((r) => [r.type, r.people]));
  const items = types.map((t) => ({ type: t, name: FEATURE_NAMES[t], people: (m[t] || {}).people || 0, events: (m[t] || {}).events || 0, reused: re[t] || 0, share: pct((m[t] || {}).people || 0, active) }))
    .sort((a, b) => b.people - a.people);
  return { active, items, tried: items.filter((i) => i.people > 0).length, unnoticed: items.filter((i) => i.people === 0).map((i) => i.name) };
}
function costsBlock(today) {
  const month = today.slice(0, 7), prev = (() => { const d = new Date(today.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const rows = all('SELECT id, month, name, amount, kind, ts FROM costs WHERE month = ? ORDER BY ts', month);
  const prevRows = all('SELECT amount, kind FROM costs WHERE month = ? AND kind <> ?', prev, 'budget');
  const dim = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate(), elapsed = +today.slice(8, 10);
  const fixed = rows.filter((r) => r.kind === 'fixed').reduce((s, r) => s + r.amount, 0);
  const variable = rows.filter((r) => r.kind === 'variable').reduce((s, r) => s + r.amount, 0);
  const budget = rows.filter((r) => r.kind === 'budget').reduce((s, r) => s + r.amount, 0);
  const spent = fixed + variable, forecast = Math.round(fixed + (elapsed ? variable / elapsed * dim : 0));
  return { month, spent: Math.round(spent), forecast, budget, withinBudget: budget ? forecast <= budget : null,
    prevMonth: prev, prevSpent: Math.round(prevRows.reduce((s, r) => s + r.amount, 0)), items: rows, daysInMonth: dim, elapsed, ai: 0 };
}
function problemsBlock(from, to) {
  const loginFails = one('SELECT COUNT(*) c FROM login_codes WHERE attempts >= 3').c;
  const expired = one("SELECT COUNT(*) c FROM login_codes WHERE expires_at < ? AND substr(created_at,1,10) BETWEEN ? AND ?", new Date().toISOString(), from, to).c;
  const errs = all('SELECT path, COUNT(*) n, MAX(ts) last FROM errors WHERE day BETWEEN ? AND ? GROUP BY path ORDER BY n DESC', from, to);
  const mailErrs = errs.filter((e) => e.path === 'mail').reduce((s, e) => s + e.n, 0);
  const apiErrs = errs.filter((e) => e.path !== 'mail').reduce((s, e) => s + e.n, 0);
  const items = [
    { key: 'login', name: 'Ошибки входа', value: loginFails + expired, hint: `неверный код 3+ раза — ${loginFails}, код не введён до истечения — ${expired}` },
    { key: 'mail', name: 'Письма с кодом не ушли', value: mailErrs, hint: 'сбои отправки почты' },
    { key: 'api', name: 'Сбои функций', value: apiErrs, hint: errs.filter((e) => e.path !== 'mail').map((e) => `${e.path} — ${e.n}`).join(', ') || 'сбоев не было' },
    { key: 'ai', name: 'Рост стоимости ИИ', value: 0, hint: 'ИИ-модели в приложении не используются' },
    { key: 'support', name: 'Неотвеченные обращения', value: 0, hint: 'чат поддержки в разработке — обращений нет' },
  ];
  return { total: items.reduce((s, i) => s + i.value, 0), items, errors: errs };
}

/* ── единый дашборд: 8 блоков, у каждого — текущий период и предыдущий ── */
export function dashboard(q) {
  const P = periodOf(q), today = dayMSK();
  const days = seriesDays(P.from, P.to);
  const nu = newUsers(P.from, P.to), nuP = newUsers(P.prevFrom, P.prevTo);
  const ac = activation(P.from, P.to), acP = activation(P.prevFrom, P.prevTo);
  const av = activeBlock(P.to), avP = activeBlock(P.prevTo);
  const rp = repeatBlock(P.from, P.to), rpP = repeatBlock(P.prevFrom, P.prevTo);
  const rt = retentionBlock(P.from, P.to, today), rtP = retentionBlock(P.prevFrom, P.prevTo, today);
  const ft = featuresBlock(P.from, P.to), ftP = featuresBlock(P.prevFrom, P.prevTo);
  const cs = costsBlock(today);
  const pr = problemsBlock(P.from, P.to), prP = problemsBlock(P.prevFrom, P.prevTo);
  const dauSeries = fillSeries(days, all(`SELECT day, COUNT(DISTINCT user_id) n FROM events WHERE type IN (${inList(ACTIVE_TYPES)}) AND day BETWEEN ? AND ? GROUP BY day`, P.from, P.to));
  return {
    period: P, today,
    blocks: [
      { key: 'new_users', title: 'Новые пользователи с подтверждённой почтой', question: 'Сколько людей действительно зарегистрировалось за выбранный период?',
        value: nu.total, prev: nuP.total, delta: delta(nu.total, nuP.total), unit: 'чел.', series: fillSeries(days, nu.rows) },
      { key: 'activation', title: 'Активация', question: 'Доходят ли люди после анкеты до результата?',
        value: ac.share, prev: acP.share, delta: delta(ac.share, acP.share), unit: '%', sub: `${ac.activated} из ${ac.cohort} новичков` },
      { key: 'active', title: 'Активные пользователи за день, неделю и месяц', question: 'Каков размер аудитории, которая пользуется приложением?',
        value: av.wau, prev: avP.wau, delta: delta(av.wau, avP.wau), unit: 'чел. за неделю', sub: `день — ${av.dau} · месяц — ${av.mau}`, series: dauSeries },
      { key: 'repeat', title: 'Повторное использование и доля постоянных', question: 'Сколько людей возвращаются и формируют привычку?',
        value: rp.regulars, prev: rpP.regulars, delta: delta(rp.regulars, rpP.regulars), unit: 'постоянных', sub: `4+ дня за неделю · повторно — ${rp.repeat} из ${rp.active} (${rp.share}%)`, main: true },
      { key: 'retention', title: 'Возврат после регистрации', question: 'Сохраняется ли интерес после первого знакомства?',
        value: rt.d1.pct, prev: rtP.d1.pct, delta: rt.d1.pct === null || rtP.d1.pct === null ? null : delta(rt.d1.pct, rtP.d1.pct), unit: '% на следующий день', sub: `через неделю — ${rt.d7.pct === null ? '—' : rt.d7.pct + '%'} · на четвёртой неделе — ${rt.w4.pct === null ? '—' : rt.w4.pct + '%'}` },
      { key: 'features', title: 'Использование функций', question: 'Какие функции пробуют, какие используют повторно, какие остаются незамеченными?',
        value: ft.tried, prev: ftP.tried, delta: delta(ft.tried, ftP.tried), unit: `из ${ft.items.length} функций`, sub: ft.unnoticed.length ? `без внимания: ${ft.unnoticed.slice(0, 3).join(', ')}${ft.unnoticed.length > 3 ? '…' : ''}` : 'все функции кто-то попробовал' },
      { key: 'costs', title: 'Расходы за месяц и прогноз до конца месяца', question: 'Сколько денег потребляет приложение и укладывается ли в бюджет?',
        value: cs.forecast, prev: cs.prevSpent, delta: delta(cs.forecast, cs.prevSpent), unit: '₽ прогноз', sub: `потрачено ${cs.spent} ₽` + (cs.budget ? ` · бюджет ${cs.budget} ₽ — ${cs.withinBudget ? 'укладываемся' : 'превышение'}` : ' · бюджет не задан') },
      { key: 'problems', title: 'Проблемы, требующие внимания', question: 'Есть ли ошибки входа, рост стоимости ИИ, неотвеченные обращения, сбои отдельных функций?',
        value: pr.total, prev: prP.total, delta: delta(pr.total, prP.total), unit: 'сигналов', sub: pr.items.filter((i) => i.value > 0).map((i) => i.name).join(', ') || 'всё спокойно', alarm: pr.total > 0 },
    ],
  };
}

/* Отчёт по блоку: из чего получилась цифра. */
export function report(kind, q) {
  const P = periodOf(q), today = dayMSK(), days = seriesDays(P.from, P.to);
  const mask = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
  switch (kind) {
    case 'new_users': {
      const cur = newUsers(P.from, P.to), prev = newUsers(P.prevFrom, P.prevTo);
      const list = all(`SELECT email, name, city, substr(email_at,1,10) day, onboarded FROM users WHERE email <> '' AND email_at <> '' AND substr(email_at,1,10) BETWEEN ? AND ? ORDER BY email_at DESC LIMIT 300`, P.from, P.to)
        .map((r) => ({ email: mask(r.email), name: r.name, city: r.city, day: r.day, onboarded: !!r.onboarded }));
      return { period: P, value: cur.total, prev: prev.total, series: fillSeries(days, cur.rows), rows: list,
        how: 'Считаются люди, которые ввели код из письма: момент подтверждения почты. Анонимные профили без почты в счёт не идут.' };
    }
    case 'activation': {
      const cur = activation(P.from, P.to), prev = activation(P.prevFrom, P.prevTo);
      return { period: P, value: cur.share, prev: prev.share, detail: cur, rows: Object.entries(cur.byFeature).map(([t, n]) => ({ name: FEATURE_NAMES[t] || t, n })).sort((a, b) => b.n - a.n),
        how: 'Новичок считается активированным, если в первые 7 дней после подтверждения почты сделал хотя бы одно результативное действие: открыл карту дня, отметил настроение, задал вопрос, записал в дневник или желание, посчитал совместимость.' };
    }
    case 'active': {
      const cur = activeBlock(P.to), prev = activeBlock(P.prevTo);
      const series = fillSeries(days, all(`SELECT day, COUNT(DISTINCT user_id) n FROM events WHERE type IN (${inList(ACTIVE_TYPES)}) AND day BETWEEN ? AND ? GROUP BY day`, P.from, P.to));
      return { period: P, value: cur.wau, prev: prev.wau, detail: { cur, prev }, series,
        rows: [{ name: 'За день (DAU)', n: cur.dau, p: prev.dau }, { name: 'За неделю (WAU)', n: cur.wau, p: prev.wau }, { name: 'За месяц (MAU)', n: cur.mau, p: prev.mau }],
        how: 'Активный — тот, у кого в этот день есть хотя бы одно событие: открыл приложение или воспользовался функцией. Неделя и месяц — 7 и 30 дней до конца периода включительно.' };
    }
    case 'repeat': {
      const cur = repeatBlock(P.from, P.to), prev = repeatBlock(P.prevFrom, P.prevTo);
      return { period: P, value: cur.regulars, prev: prev.regulars, detail: { cur, prev },
        rows: Object.entries(cur.dist).map(([d, n]) => ({ name: `${d} ${d === '1' ? 'день' : 'дня'} активности`, n })),
        how: 'Главный ориентир: постоянные — те, кто воспользовался работающими функциями хотя бы в 4 разных дня за последние 7 дней периода. Повторные — активны в 2 и более разных дня внутри периода.' };
    }
    case 'retention': {
      const cur = retentionBlock(P.from, P.to, today), prev = retentionBlock(P.prevFrom, P.prevTo, today);
      return { period: P, value: cur.d1.pct, prev: prev.d1.pct, detail: { cur, prev },
        rows: [['d1', 'На следующий день'], ['d7', 'Через неделю (7-й день)'], ['w4', 'На четвёртой неделе (дни 21–27)']].map(([k, name]) => ({ name, n: cur[k].pct, sub: `${cur[k].back} из ${cur[k].eligible}`, p: prev[k].pct })),
        how: 'Когорта — подтвердившие почту в выбранный период. В расчёт попадают только те, у кого нужный день уже наступил. Активность — любое событие в приложении.' };
    }
    case 'features': {
      const cur = featuresBlock(P.from, P.to), prev = featuresBlock(P.prevFrom, P.prevTo);
      const pm = Object.fromEntries(prev.items.map((i) => [i.type, i]));
      return { period: P, value: cur.tried, prev: prev.tried, detail: { active: cur.active, unnoticed: cur.unnoticed },
        rows: cur.items.map((i) => ({ name: i.name, n: i.people, sub: `повторно — ${i.reused} · событий — ${i.events} · ${i.share}% активных`, p: (pm[i.type] || {}).people || 0 })),
        how: 'Попробовали — хотя бы одно событие за период. Повторно — событие в двух и более разных днях. Доля — от активных за период.' };
    }
    case 'costs': {
      const cs = costsBlock(today);
      return { period: P, value: cs.forecast, prev: cs.prevSpent, detail: cs,
        rows: cs.items.map((i) => ({ id: i.id, name: i.name, n: Math.round(i.amount), sub: i.kind === 'fixed' ? 'постоянная' : i.kind === 'variable' ? 'переменная' : 'бюджет', kind: i.kind })),
        how: 'Постоянные расходы (сервер, домен, почта) вводятся один раз в месяц, переменные (ИИ, рассылки) — по мере появления. Прогноз = постоянные + переменные, растянутые на весь месяц по среднему за прошедшие дни.' };
    }
    case 'problems': {
      const cur = problemsBlock(P.from, P.to), prev = problemsBlock(P.prevFrom, P.prevTo);
      return { period: P, value: cur.total, prev: prev.total, detail: cur,
        rows: cur.items.map((i) => ({ name: i.name, n: i.value, sub: i.hint })),
        errors: all('SELECT ts, path, message FROM errors WHERE day BETWEEN ? AND ? ORDER BY ts DESC LIMIT 100', P.from, P.to),
        how: 'Ошибки входа — коды, введённые неверно 3 и более раз, и коды, которые так и не ввели. Сбои функций — ответы сервера с ошибкой, по адресам. Письма — неудачные отправки кода.' };
    }
    default: return null;
  }
}
export function blockAllowed(key, roles) { return roles.includes('admin') || (BLOCK_ROLES[key] || []).some((r) => roles.includes(r)); }

/* ── расходы ── */
export function costAdd(month, name, amount, kind) {
  if (!/^\d{4}-\d{2}$/.test(month || '') || !name || !['fixed', 'variable', 'budget'].includes(kind)) return { ok: false, error: 'bad_cost' };
  db.prepare('INSERT INTO costs (month, name, amount, kind, ts) VALUES (?,?,?,?,?)').run(month, String(name).slice(0, 80), Number(amount) || 0, kind, new Date().toISOString());
  return { ok: true };
}
export function costRemove(id) { db.prepare('DELETE FROM costs WHERE id = ?').run(Number(id)); return { ok: true }; }
