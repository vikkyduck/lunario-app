/* Надёжная запись: повтор одного действия не создаёт второй записи.

   Зачем. Ответ может потеряться по дороге — сеть оборвалась, телефон уснул, вкладку закрыли. Человек нажимает
   «Сохранить» ещё раз, и без защиты в дневнике оказываются две одинаковые записи. Поэтому клиент придумывает
   операции имя (operationId) и повторяет запрос с тем же именем, а сервер хранит квитанцию: что он на это имя
   уже ответил. Повтор возвращает ту же квитанцию и ничего не пишет; то же имя с другим текстом — это конфликт,
   а не молчаливая замена смысла.

   Три вещи, которые здесь легко сделать неправильно:
   · Запись и квитанция должны попасть в базу вместе. Если записать их раздельно, отказ между ними оставит
     либо запись без подтверждения (повтор задвоит), либо подтверждение без записи (текст пропадёт).
   · node:sqlite синхронна. Внутри транзакции нельзя ждать ничего внешнего: await задержит COMMIT и вместе с ним
     весь процесс. transaction() отказывается принимать async-функцию, чтобы это нельзя было написать случайно.
   · Ошибку базы нельзя показывать человеку. «database is locked» — это «попробуйте ещё раз», а не поломка;
     «disk I/O error» — это «сервер не может писать». Первое стоит повторить, второе — нет. publicError() делит их. */

import { createHash } from 'node:crypto';

/* Ошибка с понятным кодом: status — что ответить, retryable — стоит ли клиенту повторять сам */
export class AppError extends Error {
  constructor(code, status = 400, retryable = false) { super(code); Object.assign(this, { code, status, retryable }); }
}

/* Одна короткая транзакция. work() обязана быть синхронной: БД синхронна, и await внутри подвесил бы весь процесс.
   BEGIN IMMEDIATE берёт право на запись сразу — иначе два писателя обнаружат конфликт только на COMMIT.
   Не удался откат — соединение испорчено, закрываем: работать дальше на нём опаснее, чем упасть. */
export function transaction(db, work) {
  if (work.constructor.name === 'AsyncFunction') throw new Error('async_inside_transaction');
  let begun = false;
  try {
    db.exec('BEGIN IMMEDIATE'); begun = true;
    const result = work();
    if (result && typeof result.then === 'function') throw new Error('async_inside_transaction');
    db.exec('COMMIT'); begun = false;
    return result;
  } catch (e) {
    if (begun) { try { db.exec('ROLLBACK'); } catch { try { db.close(); } catch {} } }
    throw e;
  }
}

/* Что показать наружу. Коды SQLite: 5 занято, 6 заблокировано — временное, стоит повторить;
   8 только чтение, 10 ошибка ввода-вывода, 11 повреждение, 13 нет места, 14 не открыть, 26 не база —
   сервер писать не может, повтор не поможет. Остальное — наша ошибка, наружу без подробностей. */
export function publicError(e) {
  if (e instanceof AppError) return e;
  const code = Number(e?.errcode) & 255;
  if ([5, 6].includes(code)) return new AppError('temporarily_unavailable', 503, true);
  if ([8, 10, 11, 13, 14, 26].includes(code)) return new AppError('storage_unavailable', 503, false);
  return new AppError('internal_error', 500, false);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Квитанции живут дольше, чем клиент повторяет попытки, но не вечно: старые чистятся по горизонту. */
export const RECEIPT_DAYS = 30;

/* Одна запись дневника по имени операции. principal — человек из проверенной сессии, не из тела запроса.
   deps: seal (шифрование текста), day (календарный день этого человека), now, а также track и touchStreak —
   те же побочные действия, что у обычного POST /api/journal, чтобы аналитика и серия не разошлись. */
export function saveJournalOperation(db, principal, body, deps) {
  const { seal, day, now, track, touchStreak, dailyLimit = 100 } = deps;
  if (!principal) throw new AppError('session_required', 401);
  /* accountId в теле — не разрешение, а ожидание клиента: «я пишу в тот аккаунт, в котором был».
     Сменился человек за время лежания в очереди — это конфликт, а не повод записать чужое. */
  if (body.accountId !== undefined && Number(body.accountId) !== principal.id) throw new AppError('account_changed', 409);
  if (typeof body.operationId !== 'string' || !UUID.test(body.operationId)) throw new AppError('bad_operation_id', 422);
  if (typeof body.text !== 'string') throw new AppError('bad_text', 422);
  const kind = body.kind ?? '';
  if (!['', 'answer', 'gratitude'].includes(kind)) throw new AppError('bad_kind', 422);
  /* Текст не режем молча: слишком длинное — отказ с понятной причиной, иначе человек не узнает, что хвост потерян. */
  const text = String(body.text).replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 3) throw new AppError('short', 422);
  if (text.length > 2000) throw new AppError('too_long', 413);
  const title = typeof body.title === 'string' ? body.title.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 300) : '';
  /* Отпечаток тела — по нормализованному виду: тот же текст после повтора даёт тот же отпечаток. */
  const hash = createHash('sha256').update(JSON.stringify({ text, kind, title })).digest('hex');

  const out = transaction(db, () => {
    const seen = db.prepare('SELECT payload_hash, response_json FROM sync_receipts WHERE user_id = ? AND operation_id = ?').get(principal.id, body.operationId);
    if (seen) {
      if (seen.payload_hash !== hash) throw new AppError('operation_conflict', 409);
      return { response: JSON.parse(seen.response_json), fresh: false };
    }
    if (db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(principal.id, day).c >= dailyLimit) throw new AppError('too_many', 429);
    const row = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)')
      .run(principal.id, now, day, seal(text), kind, seal(title));
    const response = { ok: true, operationId: body.operationId, accountId: principal.id, itemId: Number(row.lastInsertRowid), day, kind };
    db.prepare('INSERT INTO sync_receipts (user_id, operation_id, payload_hash, response_json, created_at) VALUES (?,?,?,?,?)')
      .run(principal.id, body.operationId, hash, JSON.stringify(response), now);
    return { response, fresh: true };
  });

  /* Аналитика и серия — уже после COMMIT: они не должны отменять сохранённую запись, если сами не заладятся,
     и повтор той же операции не должен считаться вторым действием. */
  if (out.fresh) {
    try { track(principal, kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add', ''); } catch {}
    try { out.response.streak = touchStreak(principal); } catch {}
  }
  return out.response;
}

/* Уборка старых квитанций: их держат ради повторов, а не как историю. Зовётся редко, из фоновой уборки. */
export function sweepReceipts(db, days = RECEIPT_DAYS) {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  return db.prepare('DELETE FROM sync_receipts WHERE created_at < ?').run(before).changes;
}
