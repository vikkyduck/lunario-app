import { createHash, randomInt } from 'node:crypto';

export const setKey = text => createHash('sha256').update(String(text).normalize('NFC').trim().replace(/\s+/g, ' ')).digest('hex');

export function initDailySets(db, legacySets = []) {
  db.exec('CREATE TABLE IF NOT EXISTS daily_sets (user_id INTEGER NOT NULL, day TEXT NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY(user_id, day))');
  const cols = db.prepare('PRAGMA table_info(daily_sets)').all().map(c => c.name);
  for (const col of ['text_key', 'text', 'question', 'theme']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE daily_sets ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  // Preserve already issued phrases when migrating the former index-only history.
  const update = db.prepare('UPDATE daily_sets SET text_key=?, text=?, question=? WHERE user_id=? AND day=?');
  for (const row of db.prepare("SELECT * FROM daily_sets WHERE text_key='' ").all()) {
    const old = legacySets[row.idx];
    if (old) update.run(setKey(old[1]), old[1], old[2], row.user_id, row.day);
  }
}

// Rolling 365-day window, including today. Text identity survives reorder/content updates.
// The exact phrase and question are snapshotted so reloads never change today's pair.
// theme — ключ темы, под которую подбиралась пара: хранится рядом, чтобы тема дня не зависела от текста строки.
export function dailySet(db, user, day, sets, { allowRepeat = false, theme = '' } = {}) {
  let row = db.prepare('SELECT * FROM daily_sets WHERE user_id=? AND day=?').get(user.id, day);
  if (!row?.text) {
    const since = new Date(Date.parse(day) - 364 * 864e5).toISOString().slice(0, 10);
    const used = new Set(db.prepare('SELECT text_key FROM daily_sets WHERE user_id=? AND day>=? AND day<=?').all(user.id, since, day).map(r => r.text_key));
    const unique = [...new Map(Array.from(sets, (s, idx) => [setKey(s[1]), { s, idx, key: setKey(s[1]) }])).values()];
    let pool = unique.filter(s => !used.has(s.key));
    if (!pool.length && allowRepeat) pool = unique;   /* тема исчерпана за год — можно по второму кругу */
    if (!pool.length) return null; // Never silently repeat when an incomplete custom set is supplied.
    const chosen = pool[randomInt(pool.length)];
    db.prepare(`INSERT INTO daily_sets(user_id,day,idx,text_key,text,question,theme) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id,day) DO UPDATE SET idx=excluded.idx,text_key=excluded.text_key,text=excluded.text,question=excluded.question,theme=excluded.theme WHERE daily_sets.text=''`)
      .run(user.id, day, chosen.idx, chosen.key, chosen.s[1], chosen.s[2], String(theme || ''));
    row = db.prepare('SELECT * FROM daily_sets WHERE user_id=? AND day=?').get(user.id, day);
  }
  const name = String(user.name || '').trim();
  const text = name ? row.text.replaceAll('{Имя}', name) : row.text.replace(/,?\s*\{Имя\}/g, '');
  // Keep the issued source and personalized text intact; the calm daily card has no appended salutation.
  const statement = row.text.replace(/,?\s*\{Имя\}/g, '').replace(/\s+([,.!?])/g, '$1').trim();
  return { n: row.idx + 1, text, statement, question: row.question, theme: row.theme || '' };
}
