/* Перенос записей гостя в аккаунт, в который человек только что вошел.

   Зачем. Человек пишет дневник до входа — записи лежат у анонимного профиля устройства. Потом он входит по коду
   в свой прежний аккаунт, устройство переключается, и прежние записи пропадают из виду: они остались у брошенного
   гостя. Раньше ответ сервера говорил merged: true, но это означало лишь смену сессии, а не перенос.

   Почему не переносим сами. Вход в аккаунт — не доказательство, что гостевые записи принадлежат тому же человеку:
   на общем компьютере это чужой дневник. Поэтому сервер лишь сообщает, что есть что перенести, а решает человек.

   Приглашение — не в базе, а подписанное. Токен = данные + подпись секретом процесса: подделать нельзя, хранить
   ничего не нужно. Повтор безопасен сам собой: после переноса гостя больше нет, и второй запрос просто ничего
   не находит. Перезапуск сервера обесценивает невостребованные приглашения — записи при этом на месте, пропадает
   только кнопка «перенести», и ее можно получить снова, войдя еще раз.

   Правило конфликта. У части таблиц ключ — человек и день (настроение дня, установка дня, счетчик раскладов).
   Если в аккаунте на этот день уже что-то есть, побеждает то, что в аккаунте: переносить поверх — значит
   затирать более поздний осознанный выбор. Что не поместилось, показываем в отчете, а не умалчиваем. */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PERSONAL_DATA } from './account-data.mjs';

const SECRET = randomBytes(32);
const OFFER_MS = 30 * 60000;   /* полчаса на решение: дольше держать приглашение к чужим записям незачем */

const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');
/* Приглашение перенести записи гостя guestId в аккаунт accountId */
export function offerTransfer(guestId, accountId, now = Date.now()) {
  const data = `${guestId}:${accountId}:${now + OFFER_MS}`;
  return `${data}.${sign(data)}`;
}
export function readOffer(token, now = Date.now()) {
  const raw = String(token || ''), dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const data = raw.slice(0, dot), got = Buffer.from(raw.slice(dot + 1));
  const want = Buffer.from(sign(data));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [guestId, accountId, expires] = data.split(':').map(Number);
  if (!Number.isInteger(guestId) || !Number.isInteger(accountId) || !(now < expires)) return null;
  return { guestId, accountId };
}

/* Таблицы, которые принадлежат человеку и переезжают вместе с ним: те же, что стираются при «Очистить историю».
   Дочерние (via) ссылаются на родителя и переезжают вместе с ним сами. Досье и квитанции операций не переносим:
   досье пересобирается из записей, а квитанция подтверждает действие прежнего аккаунта. */
const SKIP = new Set(['shelves', 'sync_receipts']);
export const MOVED_TABLES = PERSONAL_DATA.filter((r) => r.on === 'history' && !r.via && !SKIP.has(r.table)).map((r) => r.table);

/* Сколько у гостя записей каждого вида — для честного вопроса «перенести?» */
export function guestRecordCounts(db, guestId) {
  const out = {};
  for (const t of MOVED_TABLES) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id = ?`).get(guestId).c;
    if (n) out[t] = n;
  }
  return out;
}

/* Перенос одной транзакцией. Возвращает, что переехало и что уступило место уже существующему.
   Вызывать вне другой транзакции: node:sqlite не умеет вложенные BEGIN. */
export function transferGuestRecords(db, guestId, accountId) {
  let begun = false;
  try {
    db.exec('BEGIN IMMEDIATE'); begun = true;
    const guest = db.prepare('SELECT id, email FROM users WHERE id = ?').get(guestId);
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(accountId);
    /* Гостя уже нет — значит, перенос состоялся раньше. Это не ошибка: повтор должен быть безобидным. */
    if (!guest) { db.exec('COMMIT'); begun = false; return { ok: true, already: true, moved: {}, kept: {} }; }
    if (!target) { db.exec('COMMIT'); begun = false; return { ok: false, error: 'not_found' }; }
    /* У гостя появилась своя почта — это уже не брошенный профиль устройства, а чей-то аккаунт. */
    if (guest.email) { db.exec('COMMIT'); begun = false; return { ok: false, error: 'guest_has_email' }; }

    /* Часть таблиц заводят свои модули (досье, напоминания, обращения), а не миграции — в урезанной сборке
       или в проверке их может не быть. Работаем с тем, что есть, вместо падения на первой отсутствующей. */
    const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const moved = {}, kept = {};
    for (const t of MOVED_TABLES) {
      if (!present.has(t)) continue;
      const before = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id = ?`).get(guestId).c;
      if (!before) continue;
      /* OR IGNORE: строка, у которой в аккаунте уже занят тот же день, остается у гостя и удаляется ниже */
      const n = db.prepare(`UPDATE OR IGNORE ${t} SET user_id = ? WHERE user_id = ?`).run(accountId, guestId).changes;
      const left = db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(guestId).changes;
      if (n) moved[t] = n;
      if (left) kept[t] = left;
    }
    /* Досье гостя не нужно: у аккаунта свое, и оно пересоберется из переехавших записей.
       Остальное личное гостя (устройства, напоминания, обращения) уходит вместе с ним по общей политике. */
    for (const r of PERSONAL_DATA) {
      if (r.table === 'users' || r.by === 'email') continue;
      if (r.via) { if (present.has(r.table) && present.has(r.via.table)) db.prepare(`DELETE FROM ${r.table} WHERE ${r.via.key} IN (SELECT id FROM ${r.via.table} WHERE user_id = ?)`).run(guestId); }
      else if (present.has(r.table)) db.prepare(`DELETE FROM ${r.table} WHERE user_id = ?`).run(guestId);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(guestId);
    db.exec('COMMIT'); begun = false;
    return { ok: true, moved, kept };
  } catch (e) {
    if (begun) { try { db.exec('ROLLBACK'); } catch { try { db.close(); } catch {} } }
    throw e;
  }
}
