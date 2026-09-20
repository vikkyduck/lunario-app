/* Практики дня: что уже сделано сегодня, дневник привычек и аскеза.

   Тонкий HTTP-слой. Правила привычек и аскез живут в practices.mjs (habitList/askesisList) и общие для
   экрана, напоминаний и досье — здесь только разбор запроса, проверки ввода и запись.

   Три вещи, которые легко перепутать и которые поэтому названы явно:
   · регулярность привычки человек задает словами, parseRule превращает их в правило;
   · награда за серию выдается один раз и только ежедневной привычке;
   · аскеза живет до даты, а не «на N дней», и отметка — это наблюдение парой слов, а не галочка.

   Возвращает true: запрос обработан, ответ отправлен. */
import { isDay } from '../util.mjs';
export function createPracticeRoutes(deps) {
  const { db, json, readBody, clean, cleanText, seal, open_, ISO_DAY, nowISO, track, touchStreak,
    habitList, askesisList, parseRule, habitStreak, validEndDate } = deps;

  return async function practiceRoutes({ p, req, res, url, u, d }) {
  /* ── главная: что из практик уже сделано сегодня — одним запросом вместо пяти ── */
  if (p === '/api/day-status' && req.method === 'GET') {
    const done = (kind) => !!db.prepare('SELECT 1 FROM journal WHERE user_id = ? AND day = ? AND kind = ? LIMIT 1').get(u.id, d, kind);
    return json(res, 200, { habits: habitList(u.id, d), askesis: askesisList(u.id, d), journal: done(''), gratitude: done('gratitude'), answer: done('answer') });
  }

  /* ── дневник привычек: список с регулярностью, карточка дня, награды ── */
  if (p === '/api/habits') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      const title = clean(b.title, 80), ruleText = clean(b.rule, 60);
      if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
      if (db.prepare('SELECT COUNT(*) c FROM habits WHERE user_id = ? AND archived = 0').get(u.id).c >= 20) return json(res, 400, { ok: false, error: 'too_many' });
      db.prepare('INSERT INTO habits (user_id, title, created_at, rule, rule_text) VALUES (?,?,?,?,?)').run(u.id, seal(title), nowISO(), parseRule(ruleText), ruleText);
      touchStreak(u); track(u, 'habit_add', parseRule(ruleText));
    } else if (req.method === 'PATCH') {
      const b = await readBody(req);
      const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(Number(b.id) || 0, u.id);
      if (!h) return json(res, 404, { ok: false, error: 'not_found' });
      if (b.rule !== undefined || b.title !== undefined) {   // правка названия или регулярности
        const ruleText = b.rule !== undefined ? clean(b.rule, 60) : h.rule_text, title = b.title !== undefined ? clean(b.title, 80) : open_(h.title);
        if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
        db.prepare('UPDATE habits SET title = ?, rule = ?, rule_text = ? WHERE id = ?').run(seal(title), parseRule(ruleText), ruleText, h.id);
      } else {
        /* день — только если передан и настоящий, не старше недели и не в будущем; иначе ошибка, а не отметка за сегодня (R13).
           done — желаемое состояние: два одинаковых запроса оставляют то же, что и один; без done — переключение (старые вызовы) (R05) */
        let day = d;
        if (b.day !== undefined && b.day !== null && b.day !== '') { if (!isDay(b.day) || b.day > d || Date.parse(d) - Date.parse(b.day) > 6 * 864e5) return json(res, 400, { ok: false, error: 'bad_day' }); day = b.day; }
        const has = !!db.prepare('SELECT 1 FROM habit_marks WHERE habit_id = ? AND day = ?').get(h.id, day);
        const want = typeof b.done === 'boolean' ? b.done : !has;
        if (!want && has) db.prepare('DELETE FROM habit_marks WHERE habit_id = ? AND day = ?').run(h.id, day);
        else if (want && !has) {
          db.prepare('INSERT INTO habit_marks (habit_id, day) VALUES (?,?)').run(h.id, day); if (day === d) touchStreak(u); track(u, 'habit_mark', day === d ? 'today' : 'past');
        }
      }
    } else if (req.method === 'DELETE') {
      db.prepare('UPDATE habits SET archived = 1 WHERE id = ? AND user_id = ?').run(Number(url.searchParams.get('id')) || 0, u.id);
    }
    return json(res, 200, { items: habitList(u.id, d), streak: u.streak });
  }

  /* ── аскеза: до даты, поддержка и счет дней, заметки по желанию ── */
  if (p === '/api/askesis') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      const title = clean(b.title, 80), until = String(b.until || '');
      if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
      if (!validEndDate(until, d)) return json(res, 400, { ok: false, error: 'bad_until' });
      if (db.prepare("SELECT COUNT(*) c FROM askesis WHERE user_id = ? AND status = 'active'").get(u.id).c >= 5) return json(res, 400, { ok: false, error: 'too_many' });
      const days = Math.round((Date.parse(until) - Date.parse(d)) / 864e5) + 1;
      db.prepare('INSERT INTO askesis (user_id, title, days, started, until) VALUES (?,?,?,?,?)').run(u.id, seal(title), days, d, until);
      touchStreak(u); track(u, 'askesis_start', String(days));
    } else if (req.method === 'PATCH') {
      const b = await readBody(req);
      const a = db.prepare("SELECT * FROM askesis WHERE id = ? AND user_id = ? AND status = 'active'").get(Number(b.id) || 0, u.id);
      if (!a) return json(res, 404, { ok: false, error: 'not_found' });
      if (b.until !== undefined) {                                   // передвинуть дату
        const until = String(b.until || '');
        if (!validEndDate(until, d)) return json(res, 400, { ok: false, error: 'bad_until' });
        db.prepare('UPDATE askesis SET until = ?, days = ? WHERE id = ?').run(until, Math.round((Date.parse(until) - Date.parse(a.started)) / 864e5) + 1, a.id);
      } else {                                                       // заметка-наблюдение за сегодня
        const note = cleanText(b.note, 500);
        db.prepare('INSERT INTO askesis_days (askesis_id, day, kept, note) VALUES (?,?,1,?) ON CONFLICT(askesis_id, day) DO UPDATE SET note = excluded.note').run(a.id, d, seal(note));
        touchStreak(u); track(u, 'askesis_mark', '');
      }
    } else if (req.method === 'DELETE') {
      db.prepare("UPDATE askesis SET status = 'stopped', finished_at = ? WHERE id = ? AND user_id = ? AND status = 'active'").run(d, Number(url.searchParams.get('id')) || 0, u.id);
    }
    return json(res, 200, askesisList(u.id, d));
  }
    return false;   // не наш маршрут
  };
}
