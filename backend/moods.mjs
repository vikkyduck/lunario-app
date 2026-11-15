/* Один контракт чтения настроений (аудит v98, F10): все отметки дня — из mood_marks, а день без них (записи старых версий) —
   из «главного» в moods. Отсюда читают карточка дня, «Моя неделя», отчет по настроениям, выгрузка и база знаний:
   считать отметки и дни наблюдения везде одинаково, «главное» настроение — первое из отмеченных. */
export function createMoods(db) {
  /* по дням за отрезок: Map(день → [настроения]) */
  function byDay(uid, from, to) {
    const map = new Map();
    for (const m of db.prepare('SELECT day, mood FROM mood_marks WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day, rowid').all(uid, from, to)) map.set(m.day, [...(map.get(m.day) || []), m.mood]);
    for (const m of db.prepare('SELECT day, mood FROM moods WHERE user_id = ? AND day BETWEEN ? AND ?').all(uid, from, to)) if (!map.has(m.day)) map.set(m.day, [m.mood]);
    return map;
  }
  const ofDay = (uid, day) => byDay(uid, day, day).get(day) || [];
  /* сводка за отрезок: все отметки, число дней наблюдения, счет по настроениям (все отметки, не только главные) */
  function summary(uid, from, to) {
    const map = byDay(uid, from, to), counts = new Map();
    for (const list of map.values()) for (const m of list) counts.set(m, (counts.get(m) || 0) + 1);
    const stats = [...counts].map(([mood, c]) => ({ mood, c })).sort((a, b) => b.c - a.c || a.mood.localeCompare(b.mood));
    return { byDay: map, days: map.size, total: stats.reduce((s, m) => s + m.c, 0), stats };
  }
  /* все отметки человека по дням — для выгрузки: главное — первое */
  const all = (uid) => [...byDay(uid, '0000-00-00', '9999-99-99')].sort((a, b) => a[0].localeCompare(b[0])).map(([day, marks]) => ({ day, mood: marks[0], marks }));
  return { byDay, ofDay, summary, all };
}
