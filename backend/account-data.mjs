/* Жизненный цикл личных данных — одна политика для «Очистить историю» и «Удалить аккаунт».

   У каждой сущности явное правило:
   · history — стирается и при очистке истории, и при удалении аккаунта;
   · account — только при удалении аккаунта (переписка с поддержкой, напоминания, устройства, сессии);
   · keep    — остается: обезличенный факт для статистики, без текстов.
   Дочерние таблицы (via) стираются через родителя и стоят в списке раньше него.
   seen — где человек видит эти данные; exported — ключ в личной выгрузке (personal-export.mjs; '' — не выгружается, и сказано почему).
   Новая таблица с user_id обязана попасть сюда — check-personal-features сверяет список со схемой базы и с выгрузкой (R10). */
export const PERSONAL_DATA = [
  { table: 'entries', on: 'history', note: 'вопросы, карты, расклады', seen: '«Свериться с собой» → история; день', exported: 'entries' },
  { table: 'moods', on: 'history', seen: 'карточка дня, отчет по настроениям', exported: 'moods' },
  { table: 'mood_marks', on: 'history', note: 'все отмеченные за день настроения', seen: 'карточка дня, неделя, отчет', exported: 'moods' },
  { table: 'journal', on: 'history', note: 'записи, благодарности, ответы на вопрос дня, мысли к материалам, рефлексии недели', seen: 'день, прошлые дни, неделя, практики', exported: 'journal' },
  { table: 'week_echoes', on: 'history', note: '«отозвалось» — связь утреннего настроя с вечером, отмеченная самим человеком', seen: 'неделя, карточка дня', exported: 'echoes' },
  { table: 'day_photos', on: 'history', note: 'фото дня — миниатюра и полное, зашифрованы', seen: 'день, прошлые дни', exported: 'dayPhotos' },
  { table: 'wishes', on: 'history', seen: '«Мои желания»', exported: 'wishes' },
  { table: 'usage', on: 'history', note: 'дневной счетчик раскладов — служебный, в выгрузке нет', seen: '', exported: '' },
  { table: 'daily_sets', on: 'history', note: 'какие установки дня уже выпадали', seen: '«Сегодня», утро в записи дня', exported: 'dailySets' },
  { table: 'habit_awards', on: 'history', via: { table: 'habits', key: 'habit_id' }, seen: 'дневник привычек', exported: 'habits' },
  { table: 'habit_marks', on: 'history', via: { table: 'habits', key: 'habit_id' }, seen: 'дневник привычек, день', exported: 'habits' },
  { table: 'habits', on: 'history', seen: 'дневник привычек', exported: 'habits' },
  { table: 'askesis_days', on: 'history', via: { table: 'askesis', key: 'askesis_id' }, seen: 'аскезы, день', exported: 'askesis' },
  { table: 'askesis', on: 'history', seen: 'аскезы', exported: 'askesis' },
  { table: 'compat_checks', on: 'history', note: 'расчеты совместимости', seen: '«Обо мне» → совместимость; база знаний', exported: 'compat' },
  { table: 'knowledge', on: 'history', note: 'база знаний пересобирается из остального — производная, в выгрузке нет', seen: 'кабинет «на себе»', exported: '' },
  { table: 'sync_receipts', on: 'history', note: 'квитанции операций: только ссылка на запись, без текста; запись стерта — и подтверждение о ней тоже', seen: '', exported: '' },
  { table: 'messages', on: 'account', via: { table: 'tickets', key: 'ticket_id' }, note: 'переписка с поддержкой' },
  { table: 'tickets', on: 'account' },
  { table: 'push_shown', on: 'account', via: { table: 'push_queue', key: 'item_id' } },
  { table: 'push_queue', on: 'account' },
  { table: 'push_subs', on: 'account' },
  { table: 'reminders', on: 'account' },
  { table: 'sessions', on: 'account' },
  { table: 'login_codes', on: 'account', by: 'email', note: 'код входа на эту почту' },
  { table: 'events', on: 'keep', note: 'тип действия и возрастная когорта, без текстов — обезличенная статистика' },
  { table: 'users', on: 'account', note: 'сама запись аккаунта — последней' },
];

function run(db, user, mode) {
  const modes = mode === 'account' ? ['history', 'account'] : ['history'];
  db.exec('BEGIN');
  try {
    for (const r of PERSONAL_DATA) {
      if (!modes.includes(r.on)) continue;
      if (r.table === 'users') db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      else if (r.by === 'email') { if (user.email) db.prepare(`DELETE FROM ${r.table} WHERE email = ?`).run(user.email); }
      else if (r.via) db.prepare(`DELETE FROM ${r.table} WHERE ${r.via.key} IN (SELECT id FROM ${r.via.table} WHERE user_id = ?)`).run(user.id);
      else db.prepare(`DELETE FROM ${r.table} WHERE user_id = ?`).run(user.id);
    }
    if (mode === 'history') db.prepare("UPDATE users SET streak = 0, streak_date = '' WHERE id = ?").run(user.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/* «Очистить историю»: записи и практики стираются, аккаунт, почта, устройства и переписка с поддержкой остаются */
export const clearHistory = (db, user) => run(db, user, 'history');
/* «Удалить аккаунт»: все личное, включая переписку с поддержкой; остается только обезличенная статистика */
export const deleteAccount = (db, user) => run(db, user, 'account');

/* Заброшенные анонимные аккаунты: без почты, без единой личной записи и без захода days дней — таким не о чем помнить.
   Уходят той же политикой, что при удалении аккаунта (сессии, устройства, напоминания). Возвращает, сколько убрано. */
export function sweepAbandoned(db, days = 90, limit = 500) {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  const ids = db.prepare(`SELECT id FROM users WHERE email = '' AND last_seen < ? AND photo = '' AND preferences = ''
    AND NOT EXISTS (SELECT 1 FROM entries WHERE user_id = users.id) AND NOT EXISTS (SELECT 1 FROM journal WHERE user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM moods WHERE user_id = users.id) AND NOT EXISTS (SELECT 1 FROM wishes WHERE user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM habits WHERE user_id = users.id) AND NOT EXISTS (SELECT 1 FROM askesis WHERE user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM tickets WHERE user_id = users.id) AND NOT EXISTS (SELECT 1 FROM day_photos WHERE user_id = users.id) LIMIT ${Math.max(1, Math.trunc(limit))}`).all(before).map((r) => r.id);
  for (const id of ids) deleteAccount(db, { id, email: '' });
  return ids.length;
}

/* Таблицы базы, у которых есть user_id, — для проверки полноты политики */
export function tablesWithUser(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'user_id'));
}
