/* Планировщик напоминаний. Запускается systemd-таймером раз в 5 минут:
   находит напоминания, у которых подошло время (в часовом поясе человека), собирает тексты,
   кладёт их в очередь и будит браузеры пустым сигналом. Подробности — в reminders.mjs. */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vapidKeys } from './push.mjs';
import { initReminders, runDue } from './reminders.mjs';
import { privateText } from './private-text.mjs';
import { createPractices } from './practices.mjs';

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export function initScheduledReminders(db, dataDir = DATA_DIR) {
  const {open} = privateText(dataDir, {create:false});
  initReminders(db, createPractices(db, open));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = new DatabaseSync(join(DATA_DIR, 'app.db'));
  db.exec('PRAGMA busy_timeout=5000');
  initScheduledReminders(db);
  const stat = await runDue(vapidKeys(DATA_DIR));
  if (stat.due) console.log(`Напоминания: подошло ${stat.due}, в очередь ${stat.queued}, отправлено ${stat.sent}, отписались ${stat.gone}, не дошло ${stat.failed}`);
  db.close();
}
