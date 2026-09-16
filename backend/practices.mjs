import * as C from './content.mjs';
import { MSK, dayIn, addDays } from './util.mjs';

const WD_RULES = [[1, /(^|[^а-я])(пн|понедельн)/], [2, /(^|[^а-я])(вт([^а-я]|$)|вторн)/], [3, /(^|[^а-я])(ср([^а-я]|$)|сред)/], [4, /(^|[^а-я])(чт|четверг)/],
  [5, /(^|[^а-я])(пт|пятниц)/], [6, /(^|[^а-я])(сб|суббот)/], [7, /(^|[^а-я])(вс([^а-я]|$)|воскрес)/]];
const WORD_NUM = { один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, пару: 2, пара: 2 };
const numIn = (t, re) => { const m = re.exec(t); if (!m) return null; const v = m[1]; return /^\d+$/.test(v) ? Number(v) : WORD_NUM[v] || null; };
export function parseRule(text) {
  const t = String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[.,!]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /кажд(ый|ого|ое|ую) ?(день|дня|утро|вечер|ночь|сутки)|ежеднев|daily|всегда|постоянно|утром|вечером|перед сном|на ночь|за завтраком|раз в день|в день/.test(t)) return 'daily';
  if (/будн|рабоч/.test(t)) return 'weekdays';
  if (/выходн/.test(t)) return 'weekend';
  if (/через ?день|день через день/.test(t)) return 'alt';
  const everyDays = numIn(t, /кажд(?:ые|ый|ую)?\s+([а-я\d]+)\s*(?:дн|день|сут)/) ?? numIn(t, /раз\s+в\s+([а-я\d]+)\s*(?:дн|сут)/) ?? numIn(t, /через\s+([а-я\d]+)\s*(?:дн|сут)/);
  if (everyDays && everyDays >= 2) return 'every:' + everyDays;
  const everyWeeks = numIn(t, /кажд(?:ые|ую)?\s+([а-я\d]+)\s*недел/) ?? numIn(t, /раз\s+в\s+([а-я\d]+)\s*недел/);
  if (everyWeeks && everyWeeks >= 2) return 'every:' + (everyWeeks * 7);
  const days = WD_RULES.filter(([, re]) => re.test(t)).map(([n]) => n);
  if (days.length) return 'days:' + days.join(',');
  const times = numIn(t, /([а-я\d]+)\s*раз/);
  if (/недел/.test(t)) return times && times > 7 ? 'free' : times && times > 1 ? 'times:' + times : 'weekly';
  if (/месяц|ежемес/.test(t)) return times && times > 31 ? 'free' : times && times > 1 ? 'mtimes:' + times : 'monthly';
  if (/год|ежегод/.test(t)) return 'free';
  return 'free';   /* непонятный ритм не подгоняем под ежедневный — привычка ждёт отметки, когда нужно человеку */
}
const RULE_LABEL = (rule) => rule === 'daily' ? 'каждый день' : rule === 'weekdays' ? 'по будням' : rule === 'weekend' ? 'по выходным' : rule === 'alt' ? 'через день'
  : rule === 'weekly' ? 'раз в неделю' : rule === 'monthly' ? 'раз в месяц' : rule === 'free' ? 'в своём ритме' : rule.startsWith('times:') ? `${rule.slice(6)} раза в неделю`
  : rule.startsWith('mtimes:') ? `${rule.slice(7)} раза в месяц` : rule.startsWith('every:') ? `каждые ${rule.slice(6)} дн.`
  : rule.startsWith('days:') ? rule.slice(5).split(',').map((n) => ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][Number(n)]).join(', ') : rule;
const wdOf = (day) => ((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;     // 1 — понедельник … 7 — воскресенье
const habitStart = h => dayIn(MSK, Date.parse(h.created_at));
const weekStart = (day) => addDays(day, 1 - wdOf(day));
/* нужно ли делать привычку в этот день; для недельных и месячных — «ещё не сделана в этом периоде» */
function habitDue(h, day, marks) {
  const r = h.rule || 'daily', wd = wdOf(day);
  if (r === 'daily') return true;
  if (r === 'weekdays') return wd <= 5;
  if (r === 'weekend') return wd >= 6;
  if (r === 'alt') return Math.round((Date.parse(day) - Date.parse(habitStart(h))) / 864e5) % 2 === 0;
  if (r.startsWith('days:')) return r.slice(5).split(',').map(Number).includes(wd);
  if (r === 'free') return true;
  if (r.startsWith('every:')) {   /* каждые N дней: отсчёт от первой отметки, до неё — от дня добавления */
    const n = Math.max(2, Number(r.slice(6))), first = [...marks].sort()[0] || habitStart(h);
    const diff = Math.round((Date.parse(day) - Date.parse(first)) / 864e5);
    return diff >= 0 && diff % n === 0 || marks.has(day);
  }
  if (r.startsWith('mtimes:')) { const need = Number(r.slice(7)), m = day.slice(0, 7); return [...marks].filter((x) => x.startsWith(m) && x !== day).length < need || marks.has(day); }
  if (r === 'weekly' || r.startsWith('times:')) {
    const need = r === 'weekly' ? 1 : Number(r.slice(6)), ws = weekStart(day);
    let done = 0; for (let i = 0; i < 7; i++) if (marks.has(addDays(ws, i))) done++;
    return done < need || marks.has(day);
  }
  if (r === 'monthly') { const m = day.slice(0, 7); return ![...marks].some((x) => x.startsWith(m) && x !== day); }
  return true;
}
/* серия: сколько подряд «нужных» дней (для недельных — недель, для месячных — месяцев) отмечено к сегодняшнему дню */
export function habitStreak(h, d, marks) {
  const r = h.rule || 'daily';
  if (r === 'free') return marks.size;                       /* свой ритм: считаем отметки, а не пропуски */
  if (r.startsWith('every:')) {                              /* каждые N дней: подряд закрытые «нужные» дни */
    const n = Math.max(2, Number(r.slice(6))), first = [...marks].sort()[0]; if (!first) return 0;
    let c = 0, cur = first; const last = marks.has(d) ? d : addDays(d, -1);
    while (cur <= last) { if (marks.has(cur)) c++; else if (cur < addDays(last, -(n - 1))) c = 0; cur = addDays(cur, n); }
    return c;
  }
  if (r.startsWith('mtimes:')) {
    const need = Number(r.slice(7)); let n = 0; const cnt = (m) => [...marks].filter((x) => x.startsWith(m)).length;
    let [y, m] = d.split('-').map(Number); if (cnt(d.slice(0, 7)) >= need) n++;
    for (let k = 1; k < 120; k++) { m--; if (m === 0) { m = 12; y--; } if (cnt(`${y}-${String(m).padStart(2, '0')}`) >= need) n++; else break; }
    return n;
  }
  if (r === 'weekly' || r.startsWith('times:')) {
    const need = r === 'weekly' ? 1 : Number(r.slice(6)); let n = 0; const ws = weekStart(d);
    const count = (start) => { let c = 0; for (let i = 0; i < 7; i++) if (marks.has(addDays(start, i))) c++; return c; };
    if (count(ws) >= need) n++;   // текущая неделя — если уже закрыта
    for (let k = 1; k < 200; k++) { if (count(addDays(ws, -7 * k)) >= need) n++; else break; }
    return n;
  }
  if (r === 'monthly') {
    let n = 0; const months = new Set([...marks].map((x) => x.slice(0, 7)));
    let [y, m] = d.split('-').map(Number); if (months.has(d.slice(0, 7))) n++;
    for (let k = 1; k < 120; k++) { m--; if (m === 0) { m = 12; y--; } if (months.has(`${y}-${String(m).padStart(2, '0')}`)) n++; else break; }
    return n;
  }
  let n = 0, cur = marks.has(d) ? d : addDays(d, -1);      // сегодня ещё не отмечено — считаем до вчера
  const born = habitStart(h);
  for (let k = 0; k < 4000 && cur >= born; k++) {
    if (habitDue(h, cur, marks)) { if (marks.has(cur)) n++; else break; }
    cur = addDays(cur, -1);
  }
  return n;
}
export function createPractices(db, open_) {
/* Ритм привычек перечитывается из слов человека при каждом запуске: парсер умнеет — старые записи подтягиваются */
for (const h of db.prepare("SELECT id, rule, rule_text FROM habits WHERE rule_text <> ''").all()) { const r = parseRule(h.rule_text); if (r !== h.rule) db.prepare('UPDATE habits SET rule = ? WHERE id = ?').run(r, h.id); }
/* Привычки: что делать сегодня, отметки за 7 дней, серия и награды за 30/60/90/180/365 дней подряд (только ежедневные) */
function habitList(userId, d) {
  const week = []; for (let i = 6; i >= 0; i--) week.push(addDays(d, -i));
  return db.prepare('SELECT id, title, created_at, rule, rule_text FROM habits WHERE user_id = ? AND archived = 0 ORDER BY id').all(userId).map((h) => {
    const marks = new Set(db.prepare('SELECT day FROM habit_marks WHERE habit_id = ?').all(h.id).map((m) => m.day));
    const rule = h.rule || 'daily', streak = habitStreak(h, d, marks);
;
    return { id: h.id, title: open_(h.title), since: habitStart(h), rule, ruleText: h.rule_text || '', ruleLabel: RULE_LABEL(rule), daily: rule === 'daily',
      due: habitDue(h, d, marks), today: marks.has(d), streak, total: marks.size,
      week: week.map((day) => ({ day, done: marks.has(day), due: habitDue(h, day, marks) })) };
  });
}
/* Аскезы: отказ или ограничение до выбранной даты. Истёкшие закрываются сами; заметки-наблюдения — по желанию. */
function askesisList(userId, d) {
  for (const a of db.prepare("SELECT id, until FROM askesis WHERE user_id = ? AND status = 'active'").all(userId))
    if (a.until && a.until < d) db.prepare("UPDATE askesis SET status = 'done', finished_at = ? WHERE id = ?").run(a.until, a.id);
  const shape = (a) => {
    const notes = db.prepare('SELECT day, note FROM askesis_days WHERE askesis_id = ? ORDER BY day').all(a.id).map((m) => ({ day: m.day, text: open_(m.note) })).filter((m) => m.text);
    const until = a.until || addDays(a.started, (a.days || 1) - 1);
    const total = Math.max(1, Math.round((Date.parse(until) - Date.parse(a.started)) / 864e5) + 1);
    const done = Math.min(total, Math.max(0, Math.round((Date.parse(d < until ? d : until) - Date.parse(a.started)) / 864e5) + 1));
    return { id: a.id, title: open_(a.title), started: a.started, until, total, done, left: Math.max(0, Math.round((Date.parse(until) - Date.parse(d)) / 864e5)),
      status: a.status, finished: a.finished_at, notes, today: notes.find((n) => n.day === d) || null};
  };
  return {
    active: db.prepare("SELECT * FROM askesis WHERE user_id = ? AND status = 'active' ORDER BY id DESC").all(userId).map(shape),
    past: db.prepare("SELECT * FROM askesis WHERE user_id = ? AND status <> 'active' ORDER BY id DESC LIMIT 12").all(userId).map(shape),
  };
}

return {habitList,askesisList};
}
