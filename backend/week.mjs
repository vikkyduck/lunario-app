/* «Моя неделя: про что она» — воскресный экран Дневника (ТЗ 23.3).
   Пять частей по фактам, без чтения текстов ИИ: настроение недели по дням; два-три фрагмента дословно;
   «что отозвалось» — утренний настрой ↔ вечерняя запись, связь подтверждает сам человек (week_echoes);
   ритм привычек и аскез без оценки дисциплины; одна необязательная рефлексия (journal.kind='weekly',
   день записи — воскресенье недели). Неделя календарная, пн–вс; в понедельник по умолчанию — прошедшая.
   Мало данных — короткий экран. Зависимости — явным объектом, как у createDay. */
import { ISO_DAY, addDays, plural } from './util.mjs';
import { hash32 } from './morning.mjs';
import { transaction } from './sync.mjs';

const dow = (day) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;   /* 0 — понедельник */
export const VERDICTS = ['yes', 'no', 'unsure'];
const FRAGMENT = 280;

/* Календарная неделя вокруг дня: pick — любой день нужной недели; без него — текущая, а в понедельник — прошедшая */
export function weekOf(d, pick) {
  let anchor = ISO_DAY.test(pick || '') && Number.isFinite(Date.parse(pick)) ? pick : (dow(d) === 0 ? addDays(d, -1) : d);
  if (anchor > d) anchor = d;   /* в будущее не заглядываем */
  const start = addDays(anchor, -dow(anchor)), end = addDays(start, 6);
  return { start, end, days: [...Array(7)].map((_, i) => addDays(start, i)) };
}

export function createWeek({ db, open, seal, C, MOOD_RU, habitList, askesisList, track, nowISO, cleanText }) {
  const trim = (t) => t.length > FRAGMENT ? t.slice(0, FRAGMENT - 1).trimEnd() + '…' : t;
  const texts = (key) => [...(C.WEEK_TEXTS[key] || [])];

  function moodsOf(uid, w) {
    const byDay = new Map();
    for (const m of db.prepare('SELECT day, mood FROM mood_marks WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day, rowid').all(uid, w.start, w.end)) byDay.set(m.day, [...(byDay.get(m.day) || []), m.mood]);
    for (const m of db.prepare('SELECT day, mood FROM moods WHERE user_id = ? AND day BETWEEN ? AND ?').all(uid, w.start, w.end)) if (!byDay.has(m.day)) byDay.set(m.day, [m.mood]);
    const counts = new Map();
    const days = w.days.map((day) => { const list = (byDay.get(day) || []).map((m) => MOOD_RU[m] || m); for (const l of list) counts.set(l, (counts.get(l) || 0) + 1); return { day, moods: list }; });
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([mood, count]) => ({ mood, count }));
    return { days, top, count: days.filter((x) => x.moods.length).length };
  }
  /* Два-три фрагмента дословно: по одному на день (самый длинный), дни — разнесённые по неделе */
  function savedOf(rows) {
    const byDay = new Map();
    for (const r of rows) { const cur = byDay.get(r.day); if (!cur || r.text.length > cur.text.length) byDay.set(r.day, r); }
    const days = [...byDay.values()];
    let pick = days.length > 3 ? [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]] : days;
    if (pick.length < 3) for (const r of [...rows].sort((a, b) => b.text.length - a.text.length)) { if (pick.length >= 3) break; if (!pick.includes(r)) pick.push(r); }
    return pick.sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id).map((r) => ({ day: r.day, kind: r.kind, text: trim(r.text) }));
  }
  /* Утро ↔ вечер: настрой, который выпал утром, и то, что человек записал вечером; отметку ставит сам */
  function echoesOf(uid, w, d, rows) {
    const verdicts = new Map(db.prepare('SELECT day, verdict FROM week_echoes WHERE user_id = ? AND day BETWEEN ? AND ?').all(uid, w.start, w.end).map((e) => [e.day, e.verdict]));
    const out = [];
    for (const day of w.days) {
      if (day > d) break;
      const set = db.prepare("SELECT text FROM daily_sets WHERE user_id = ? AND day = ? AND text <> ''").get(uid, day);
      const evening = rows.filter((r) => r.day === day).sort((a, b) => b.text.length - a.text.length)[0];
      if (!set || !evening) continue;
      const card = db.prepare("SELECT title FROM entries WHERE user_id = ? AND day = ? AND kind IN ('card','dayrune') ORDER BY id LIMIT 1").get(uid, day);
      out.push({ day, morning: set.text.replace(/,?\s*\{Имя\}/g, '').replace(/\s+([,.!?])/g, '$1').trim(), source: card ? card.title : '', evening: trim(evening.text), kind: evening.kind, verdict: verdicts.get(day) || '' });
    }
    return out;
  }
  /* Ритм: дни привычек (должна была / отметила) и аскез (держусь / сорвалась) — счёт, не оценка */
  function rhythmOf(uid, w, d) {
    const habits = new Map();
    for (const day of w.days) {
      if (day > d) break;
      for (const h of habitList(uid, day)) {
        if (!h.due && !h.today) continue;
        const cur = habits.get(h.id) || { id: h.id, title: h.title, days: [] };
        cur.days.push({ day, due: !!h.due, done: !!h.today }); habits.set(h.id, cur);
      }
    }
    const askesis = new Map();
    for (const a of askesisList(uid, d).active) askesis.set(a.id, { id: a.id, title: a.title, days: [] });
    for (const n of db.prepare('SELECT a.id, a.title, n.day, n.kept FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day BETWEEN ? AND ? ORDER BY n.day').all(uid, w.start, w.end)) {
      const cur = askesis.get(n.id) || { id: n.id, title: n.title, days: [] }; cur.days.push({ day: n.day, kept: !!n.kept }); askesis.set(n.id, cur);
    }
    const list = [...habits.values()].map((h) => ({ ...h, done: h.days.filter((x) => x.done).length, due: h.days.filter((x) => x.due).length }));
    const ask = [...askesis.values()].map((a) => ({ ...a, kept: a.days.filter((x) => x.kept).length, missed: a.days.filter((x) => !x.kept).length }));
    const pool = texts('ритм');
    return { habits: list, askesis: ask, phrase: list.length || ask.length ? pool[hash32(`${uid}:${w.start}:ритм`) % Math.max(1, pool.length)] || '' : '' };
  }
  function reflectionOf(uid, w) {
    const row = db.prepare("SELECT id, text FROM journal WHERE user_id = ? AND day = ? AND kind = 'weekly' ORDER BY id DESC LIMIT 1").get(uid, w.end);
    return { question: texts('рефлексия')[0] || '', day: w.end, text: row ? open(row.text) : '' };
  }

  function state(u, d, pick) {
    const w = weekOf(d, pick);
    const rows = db.prepare("SELECT id, day, kind, text FROM journal WHERE user_id = ? AND day BETWEEN ? AND ? AND kind IN ('', 'gratitude', 'answer') ORDER BY day, id").all(u.id, w.start, w.end).map((r) => ({ ...r, text: open(r.text) })).filter((r) => r.text);
    const moods = moodsOf(u.id, w);
    const moments = rows.length + moods.count;
    const mode = !moments ? 'empty' : moments < 3 ? 'few' : 'full';
    const few = (texts('мало')[0] || '').replaceAll('{n}', String(moments)).replaceAll('{момента}', plural(moments, 'момент', 'момента', 'моментов'));
    return {
      week: { start: w.start, end: w.end, today: d, current: w.start === weekOf(d, d).start, previous: addDays(w.start, -7) },
      mode, moments, text: mode === 'empty' ? texts('пусто')[0] || '' : mode === 'few' ? few : '',
      moods, saved: savedOf(rows), echoes: echoesOf(u.id, w, d, rows), rhythm: rhythmOf(u.id, w, d), reflection: reflectionOf(u.id, w),
    };
  }
  /* Отметка «отозвалось»: одна на день, пустая — снимает */
  function echo(u, d, b) {
    const day = ISO_DAY.test(b.day || '') ? b.day : '';
    const verdict = VERDICTS.includes(b.verdict) ? b.verdict : b.verdict === '' ? '' : null;
    if (!day || day > d || day < addDays(d, -366) || verdict === null) return { ok: false, error: 'bad_echo' };
    if (verdict) db.prepare('INSERT INTO week_echoes (user_id, day, verdict, ts) VALUES (?,?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET verdict = excluded.verdict, ts = excluded.ts').run(u.id, day, verdict, nowISO());
    else db.prepare('DELETE FROM week_echoes WHERE user_id = ? AND day = ?').run(u.id, day);
    track(u, 'week_echo', verdict || 'clear');
    return { ok: true, day, verdict };
  }
  /* Рефлексия недели — одна запись на неделю; пустой текст снимает её */
  function reflect(u, d, b) {
    const w = weekOf(d, b.week), text = cleanText(b.text, 2000);
    transaction(db, () => {
      const row = db.prepare("SELECT id FROM journal WHERE user_id = ? AND day = ? AND kind = 'weekly' ORDER BY id DESC LIMIT 1").get(u.id, w.end);
      if (!text) { if (row) db.prepare('DELETE FROM journal WHERE id = ? AND user_id = ?').run(row.id, u.id); }
      else if (row) db.prepare('UPDATE journal SET text = ? WHERE id = ? AND user_id = ?').run(seal(text), row.id, u.id);
      else db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), w.end, seal(text), 'weekly', seal(''));
    });
    track(u, 'week_reflect', text ? 'save' : 'clear');
    return { ok: true, ...reflectionOf(u.id, w) };
  }
  return { state, echo, reflect };
}
