/* Утреннее напоминание «карта дня готова». Запускается по расписанию.
   Шлём только тем, кто сам включил напоминание, и один раз в день. */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vapidKeys, sendPush } from './push.mjs';

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const db = new DatabaseSync(join(DATA_DIR, 'app.db'));
const keys = vapidKeys(DATA_DIR);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

const subs = db.prepare("SELECT endpoint, user_id, last_ok FROM push_subs WHERE last_ok <> ?").all(today);
let sent = 0, gone = 0, failed = 0;

for (const s of subs) {
  try {
    const ok = await sendPush({ endpoint: s.endpoint }, keys);
    if (ok) {
      db.prepare('UPDATE push_subs SET last_ok=? WHERE endpoint=?').run(today, s.endpoint);
      sent++;
    } else {
      db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint);   // человек отписался
      gone++;
    }
  } catch (e) {
    failed++;
    console.error('не ушло:', e.message);
  }
}
console.log(`Напоминания: отправлено ${sent}, отписались ${gone}, не дошло ${failed}`);
