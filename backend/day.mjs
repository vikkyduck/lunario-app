/* Карточка дня в Дневнике — «Запомнить этот день».
   Один экран и один запрос, но данные — каждое своим типом: запись, благодарность и ответ на вопрос дня — три строки journal
   с разными kind; настроения — mood_marks (несколько за день) плюс «главное» в moods для старых экранов и отчетов;
   привычки — habit_marks; аскеза — askesis_days (держусь / сорвалась, заметка). Ничего не разбирается и не режется:
   текст хранится целиком, предложением самого человека.
   Пустая ячейка при сохранении = «не менять»: случайно стереть запись нельзя. Зависимости — явным объектом, как у createShelves. */
import { transaction } from './sync.mjs';

export function createDay({ db, seal, open, C, habitList, askesisList, track, touchStreak, nowISO, cleanText, clean, questionOf, morningOf = () => null, themeTitle = (k) => k, dailyWrites = 100 }) {
  const KINDS = { text: '', gratitude: 'gratitude', answer: 'answer' };
  const latest = (uid, d, kind) => db.prepare('SELECT id, text, title FROM journal WHERE user_id = ? AND day = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(uid, d, kind);
  const cell = (row) => row ? { id: row.id, text: open(row.text), title: open(row.title || '') } : null;
  const moodOk = (m) => /^own:[^\s|]{1,24}$/u.test(m) || !!C.moodInfo(m);
  const moodsOf = (uid, d) => {
    const marks = db.prepare('SELECT mood FROM mood_marks WHERE user_id = ? AND day = ? ORDER BY rowid').all(uid, d).map((m) => m.mood);
    if (marks.length) return marks;
    const main = db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(uid, d);
    return main ? [main.mood] : [];
  };
  /* утро дня, как оно выпало: настрой, вопрос и тема — из daily_sets; для прошлых дней ничего не тянется заново */
  const morningStored = (uid, d) => { const r = db.prepare('SELECT text, question, theme FROM daily_sets WHERE user_id = ? AND day = ?').get(uid, d); return r && r.text ? { set: r.text, question: r.question || '', theme: themeTitle(r.theme || '') } : null; };
  const echoOf = (uid, d) => (db.prepare('SELECT verdict FROM week_echoes WHERE user_id = ? AND day = ?').get(uid, d) || {}).verdict || '';
  const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  function state(u, d) {
    const kept = new Map(db.prepare('SELECT askesis_id, kept, note FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ?').all(u.id, d).map((n) => [n.askesis_id, n]));
    const m = morningOf(u, d);   /* сегодняшнее утро — то же, что на «Сегодня»: вечер продолжает его, а не начинает заново */
    return {
      day: d, question: questionOf(u, d), set: m ? m.set : '', theme: m ? m.theme : '', echo: echoOf(u.id, d),
      text: cell(latest(u.id, d, '')), gratitude: cell(latest(u.id, d, 'gratitude')), answer: cell(latest(u.id, d, 'answer')),
      moods: moodsOf(u.id, d),
      habits: habitList(u.id, d).map((h) => ({ id: h.id, title: h.title, due: h.due, today: h.today, rule: h.rule })),
      askesis: askesisList(u.id, d).active.map((a) => { const n = kept.get(a.id); return { id: a.id, title: a.title, done: a.done, total: a.total, left: a.left, kept: n ? !!n.kept : null, note: n ? open(n.note || '') : '' }; }),
    };
  }

  /* Прошлый день целиком — для чтения: утро (настрой, вопрос, тема), записи, настроение, «отозвалось», привычки и аскеза за день */
  function view(u, d) {
    const m = morningStored(u.id, d);
    return {
      day: d, set: m ? m.set : '', question: m ? m.question : '', theme: m ? m.theme : '', echo: echoOf(u.id, d),
      text: cell(latest(u.id, d, '')), gratitude: cell(latest(u.id, d, 'gratitude')), answer: cell(latest(u.id, d, 'answer')),
      moods: moodsOf(u.id, d),
      habits: db.prepare('SELECT h.title FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day = ? ORDER BY h.id').all(u.id, d).map((r) => r.title),
      askesis: db.prepare('SELECT a.title, n.kept, n.note FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ? ORDER BY a.id').all(u.id, d).map((r) => ({ title: r.title, kept: !!r.kept, note: open(r.note || '') })),
    };
  }

  /* Сводка дня одной строкой — для списка «Прошлые дни»: первая запись, настроение, что еще записано, тема утра */
  function summary(uid, d) {
    const rows = db.prepare("SELECT kind, text FROM journal WHERE user_id = ? AND day = ? AND kind <> 'weekly' ORDER BY id DESC").all(uid, d);
    const first = rows.find((r) => r.kind === '') || rows.find((r) => r.kind === 'gratitude') || rows.find((r) => r.kind === 'answer');
    const kinds = [];
    if (rows.some((r) => r.kind === 'gratitude')) kinds.push('gratitude');
    if (rows.some((r) => r.kind === 'answer')) kinds.push('answer');
    if (db.prepare('SELECT 1 FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day = ? LIMIT 1').get(uid, d)) kinds.push('habits');
    if (db.prepare('SELECT 1 FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ? LIMIT 1').get(uid, d)) kinds.push('askesis');
    const moods = moodsOf(uid, d), m = morningStored(uid, d);
    const text = first ? open(first.text).replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    return { day: d, text, textKind: first ? first.kind || 'journal' : '', moods, kinds, theme: m ? m.theme : '', empty: !text && !moods.length && !kinds.length };
  }
  /* Список дней. calendar — последние n календарных дней до d (пустые тоже, с темой утра); иначе — только дни с записями, страницей до before */
  function days(u, d, { calendar = 0, before = '', limit = 30 } = {}) {
    if (calendar) { const out = []; for (let i = 1; i <= calendar; i++) out.push(summary(u.id, addDays(d, -i))); return { items: out, next: null }; }
    const cut = before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : d;
    const found = db.prepare(`SELECT day FROM (
      SELECT day FROM journal WHERE user_id = ? AND kind <> 'weekly' UNION SELECT day FROM moods WHERE user_id = ? UNION SELECT day FROM mood_marks WHERE user_id = ?
      UNION SELECT m.day FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? UNION SELECT n.day FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ?)
      WHERE day < ? ORDER BY day DESC LIMIT ?`).all(u.id, u.id, u.id, u.id, u.id, cut, limit + 1).map((r) => r.day);
    const page = found.slice(0, limit);
    return { items: page.map((x) => summary(u.id, x)), next: found.length > limit ? page[page.length - 1] : null, total: db.prepare("SELECT COUNT(DISTINCT day) c FROM journal WHERE user_id = ? AND kind <> 'weekly'").get(u.id).c };
  }

  /* «Мост» — одна строка из прошлого, дословно, без ИИ: ответ на тот же вопрос дня, запись неделю назад или вчерашнее настроение */
  function bridge(u, d) {
    const q = questionOf(u, d);
    if (q) {
      for (const r of db.prepare("SELECT day, text, title FROM journal WHERE user_id = ? AND kind = 'answer' AND day < ? ORDER BY id DESC LIMIT 80").all(u.id, d)) {
        if (open(r.title || '') === q) return { kind: 'answer', day: r.day, text: open(r.text).slice(0, 280), question: q };
      }
    }
    const week = db.prepare("SELECT day, text, kind FROM journal WHERE user_id = ? AND day = ? AND kind IN ('', 'gratitude') ORDER BY id DESC LIMIT 1").get(u.id, addDays(d, -7));
    if (week) return { kind: 'week', day: week.day, text: open(week.text).slice(0, 280) };
    const y = moodsOf(u.id, addDays(d, -1));
    if (y.length) return { kind: 'yesterday', day: addDays(d, -1), moods: y };
    const last = db.prepare("SELECT day, text FROM journal WHERE user_id = ? AND day < ? AND day >= ? AND kind = '' ORDER BY id DESC LIMIT 1").get(u.id, d, addDays(d, -30));
    if (last) return { kind: 'earlier', day: last.day, text: open(last.text).slice(0, 280) };
    return null;
  }

  /* Сохранение: все в одной транзакции — либо весь день записан, либо ничего (повтор с телефона безопасен).
     События и серия — после COMMIT: аналитика не должна отменять сохраненный день. */
  function save(u, d, b) {
    const filled = [], events = [], emit = (t, x = '') => events.push([t, x]);
    transaction(db, () => {
      for (const [field, kind] of Object.entries(KINDS)) {
        if (b[field] === undefined || b[field] === null) continue;
        const text = cleanText(b[field], 2000); if (!text) continue;   /* пустое — не трогаем */
        const row = latest(u.id, d, kind);
        const title = kind === 'answer' ? clean(b.question || questionOf(u, d), 300) : '';
        if (row) { if (open(row.text) !== text) db.prepare('UPDATE journal SET text = ? WHERE id = ? AND user_id = ?').run(seal(text), row.id, u.id); }
        else if (db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c >= dailyWrites) continue;   /* тот же дневной лимит, что у «Записать мысль» */
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
  return { state, save, view, days, bridge };
}
