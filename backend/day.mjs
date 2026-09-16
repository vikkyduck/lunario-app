/* Карточка дня в Дневнике — «Запомнить этот день».
   Один экран и один запрос, но данные — каждое своим типом: запись, благодарность и ответ на вопрос дня — три строки journal
   с разными kind; настроения — mood_marks (несколько за день) плюс «главное» в moods для старых экранов и отчётов;
   привычки — habit_marks; аскеза — askesis_days (держусь / сорвалась, заметка). Ничего не разбирается и не режется:
   текст хранится целиком, предложением самого человека.
   Пустая ячейка при сохранении = «не менять»: случайно стереть запись нельзя. Зависимости — явным объектом, как у createShelves. */
import { transaction } from './sync.mjs';

export function createDay({ db, seal, open, C, habitList, askesisList, track, touchStreak, nowISO, cleanText, clean, questionOf }) {
  const KINDS = { text: '', gratitude: 'gratitude', answer: 'answer' };
  const latest = (uid, d, kind) => db.prepare('SELECT id, text, title FROM journal WHERE user_id = ? AND day = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(uid, d, kind);
  const cell = (row) => row ? { id: row.id, text: open(row.text), title: open(row.title || '') } : null;
  const moodOk = (m) => /^own:[^\s|]{1,24}$/u.test(m) || !!C.moodInfo(m);

  function state(u, d) {
    const marks = db.prepare('SELECT mood FROM mood_marks WHERE user_id = ? AND day = ? ORDER BY rowid').all(u.id, d).map((m) => m.mood);
    const main = db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, d);
    const kept = new Map(db.prepare('SELECT askesis_id, kept, note FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ?').all(u.id, d).map((n) => [n.askesis_id, n]));
    return {
      day: d, question: questionOf(u, d),
      text: cell(latest(u.id, d, '')), gratitude: cell(latest(u.id, d, 'gratitude')), answer: cell(latest(u.id, d, 'answer')),
      moods: marks.length ? marks : (main ? [main.mood] : []),
      habits: habitList(u.id, d).map((h) => ({ id: h.id, title: h.title, due: h.due, today: h.today, rule: h.rule })),
      askesis: askesisList(u.id, d).active.map((a) => { const n = kept.get(a.id); return { id: a.id, title: a.title, done: a.done, total: a.total, left: a.left, kept: n ? !!n.kept : null, note: n ? open(n.note || '') : '' }; }),
    };
  }

  /* Сохранение: всё в одной транзакции — либо весь день записан, либо ничего (повтор с телефона безопасен).
     События и серия — после COMMIT: аналитика не должна отменять сохранённый день. */
  function save(u, d, b) {
    const filled = [], events = [], emit = (t, x = '') => events.push([t, x]);
    transaction(db, () => {
      for (const [field, kind] of Object.entries(KINDS)) {
        if (b[field] === undefined || b[field] === null) continue;
        const text = cleanText(b[field], 2000); if (!text) continue;   /* пустое — не трогаем */
        const row = latest(u.id, d, kind);
        const title = kind === 'answer' ? clean(b.question || questionOf(u, d), 300) : '';
        if (row) { if (open(row.text) !== text) db.prepare('UPDATE journal SET text = ? WHERE id = ? AND user_id = ?').run(seal(text), row.id, u.id); }
        else { db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title)); emit(kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add'); }
        filled.push(field);
      }
      if (Array.isArray(b.moods)) {
        const moods = [...new Set(b.moods.map((m) => clean(m, 30)).filter(moodOk))].slice(0, 12);
        db.prepare('DELETE FROM mood_marks WHERE user_id = ? AND day = ?').run(u.id, d);
        for (const m of moods) db.prepare('INSERT OR IGNORE INTO mood_marks (user_id, day, mood) VALUES (?,?,?)').run(u.id, d, m);
        if (moods.length) { db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, moods[0]); emit('mood_set', moods[0].replace(/^own:.*/, 'own')); filled.push('moods'); }
        else db.prepare('DELETE FROM moods WHERE user_id = ? AND day = ?').run(u.id, d);
      }
      if (Array.isArray(b.habits)) {
        let touched = false;
        for (const it of b.habits) {
          const h = db.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(Number(it.id) || 0, u.id); if (!h) continue;
          const has = !!db.prepare('SELECT 1 FROM habit_marks WHERE habit_id = ? AND day = ?').get(h.id, d);
          if (it.done && !has) { db.prepare('INSERT INTO habit_marks (habit_id, day) VALUES (?,?)').run(h.id, d); emit('habit_mark', 'today'); touched = true; }
          if (!it.done && has) db.prepare('DELETE FROM habit_marks WHERE habit_id = ? AND day = ?').run(h.id, d);
        }
        if (touched) filled.push('habits');
      }
      if (Array.isArray(b.askesis)) {
        for (const it of b.askesis) {
          const a = db.prepare("SELECT id FROM askesis WHERE id = ? AND user_id = ? AND status = 'active'").get(Number(it.id) || 0, u.id); if (!a) continue;
          if (it.kept === undefined && it.note === undefined) continue;
          const prev = db.prepare('SELECT kept, note FROM askesis_days WHERE askesis_id = ? AND day = ?').get(a.id, d);
          const kept = it.kept === undefined ? (prev ? prev.kept : 1) : (it.kept ? 1 : 0);
          const note = it.note === undefined ? (prev ? prev.note : seal('')) : seal(cleanText(it.note, 500));
          db.prepare('INSERT INTO askesis_days (askesis_id, day, kept, note) VALUES (?,?,?,?) ON CONFLICT(askesis_id, day) DO UPDATE SET kept = excluded.kept, note = excluded.note').run(a.id, d, kept, note);
          emit('askesis_mark', kept ? 'kept' : 'missed'); if (!filled.includes('askesis')) filled.push('askesis');
        }
      }
    });
    for (const [t, x] of events) track(u, t, x);
    if (filled.length) { touchStreak(u); track(u, 'day_save', filled.join('|')); }
    return { ok: true, saved: filled, ...state(u, d) };
  }
  return { state, save };
}
