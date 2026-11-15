/* Прислать человеку его напоминание сейчас — для проверки пушей с сервера, минуя кнопку «Прислать пробное» в приложении.
   На сервере:  cd /opt/lunario-app && DATA_DIR=/opt/lunario-app/data CONTENT_DIR=/opt/lunario-content node tools/send-push.mjs <почта> [morning|evening|week]
   Текст собирается так же, как у планировщика (send-daily.mjs), уходит во все подключенные устройства человека. */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vapidKeys } from '../backend/push.mjs';
import { sendNow } from '../backend/reminders.mjs';
import { initScheduledReminders } from '../backend/send-daily.mjs';

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const [email, feature = 'morning'] = process.argv.slice(2);
if (!email) { console.error('Нужна почта: node tools/send-push.mjs <почта> [morning|evening|week]'); process.exit(1); }

const db = new DatabaseSync(join(DATA_DIR, 'app.db'));
db.exec('PRAGMA busy_timeout=5000');
initScheduledReminders(db, DATA_DIR);
const u = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim());
if (!u) { console.error('Человек с такой почтой не найден'); process.exit(1); }
const devices = db.prepare('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?').get(u.id).c;
console.log(`id ${u.id}, устройств с пушами: ${devices}`);
const r = await sendNow(u, feature, vapidKeys(DATA_DIR));
console.log(r.ok ? `Отправлено на ${r.sent} устр.: «${r.preview.title}» — ${r.preview.body} → ${r.preview.url}` : `Не отправлено: ${r.error || 'почтовая служба не приняла'}`);
db.close();
