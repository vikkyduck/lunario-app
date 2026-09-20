/* Что считается «днем с записями» — две явно названные политики, одно место (повторный аудит v112, R09, R12):
   · DAY_ACTIVE — любая личная отметка дня: запись любого вида (и итог недели тоже), настроение, привычка, аскеза, фото.
     По ней строится архив «Прошлые дни», список дней для страниц и счетчики («дней с записями» в портрете) — сохраненный
     текст не может стать недоступным из-за того, что в тот день не было другой активности;
   · DAY_WRITTEN — день «записан вечером»: текст или настроение (reminders.mjs dayWritten). По ней молчит вечерний пуш,
     строка на «Сегодня» говорит «день записан» и предлагаются шаги вечера — отметка привычки вечер не заменяет. */
export const DAY_ACTIVE = `SELECT day FROM journal WHERE user_id = ? UNION SELECT day FROM moods WHERE user_id = ? UNION SELECT day FROM mood_marks WHERE user_id = ?
      UNION SELECT m.day FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? UNION SELECT n.day FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ?
      UNION SELECT day FROM day_photos WHERE user_id = ?`;
export const DAY_ACTIVE_ARGS = (uid) => [uid, uid, uid, uid, uid, uid];
export const countActiveDays = (db, uid, before = '9999-12-31') => db.prepare(`SELECT COUNT(*) c FROM (${DAY_ACTIVE}) WHERE day < ?`).get(...DAY_ACTIVE_ARGS(uid), before).c;
export const activeDays = (db, uid, before, limit) => db.prepare(`SELECT day FROM (${DAY_ACTIVE}) WHERE day < ? ORDER BY day DESC LIMIT ?`).all(...DAY_ACTIVE_ARGS(uid), before, limit).map((r) => r.day);
