/* Квитанции операций (аудит v98 F02, повторный аудит v112 R02, R04, R05): клиент дает записи свой ключ op; сервер запоминает
   не ответ, а ссылку на результат — таблицу, id и хеш тела. Личного текста в квитанции нет: запись живет только в своей таблице,
   зашифрованной, и удаление записи не оставляет открытой копии. Повтор с тем же ключом и телом: запись жива — отдается в
   актуальном виде; удалена — repeated + removed, ничего не создается заново. Тот же ключ с другим телом — конфликт, но с найденной
   записью: клиент правит ее, а не создает вторую. Запись и квитанция — одна транзакция. Квитанции старше недели стираются.
   Одинаковый исход повтора (ревью v114, F06): квитанция ищется первой, до любых квот — принятая 100-я запись при повторе не
   получит 429; квоты проверяются внутри write(), отказ ({ refuse }) квитанции не оставляет — повтор отказа снова отказ, а не
   «удалено»; в хеш тела входит вид операции (kind), чтобы один ключ op для разных сущностей не считался тем же телом. */
import { createHash } from 'node:crypto';
import { transaction } from './sync.mjs';

/* mutate — единый путь записи (mutation.mjs, F04): запись, квитанция и ревизия личных данных — одна транзакция;
   без него (проверки) — простая транзакция без ревизии */
export function createReceipts(db, nowISO, mutate = (uid, work) => transaction(db, work)) {
  const opOf = (b) => typeof b?.op === 'string' && /^[\w.-]{8,64}$/.test(b.op) ? b.op : '';
  const hashOf = (payload, kind = '') => createHash('sha256').update(JSON.stringify(kind ? { kind, ...payload } : payload)).digest('hex');
  const find = (uid, op) => { const r = db.prepare('SELECT payload_hash, response_json FROM sync_receipts WHERE user_id = ? AND operation_id = ?').get(uid, op); if (!r) return null; try { return { hash: r.payload_hash, ref: JSON.parse(r.response_json) }; } catch { return { hash: r.payload_hash, ref: {} }; } };
  const remember = (uid, op, hash, ref) => {
    db.prepare('INSERT OR REPLACE INTO sync_receipts (user_id, operation_id, payload_hash, response_json, created_at) VALUES (?,?,?,?,?)').run(uid, op, hash, JSON.stringify(ref), nowISO());
    db.prepare('DELETE FROM sync_receipts WHERE created_at < ?').run(new Date(Date.now() - 7 * 864e5).toISOString());
  };
  /* Одна операция с квитанцией: b — тело запроса, kind — вид операции ('journal.create', 'wish.create'), payload — что считается
     «тем же телом», load(ref) — актуальное состояние результата по ссылке (null — удален), write() — сама запись: возвращает
     { ref, out } (принято) или { refuse: { status, out } } (отказ по квоте — ничего не записано, квитанции нет).
     Ответ: { status, out } — out, повтор, конфликт или отказ. Сначала квитанция, потом квоты: повтор принятой операции всегда 200. */
  function run(uid, b, payload, { kind = '', load, write }) {
    const op = opOf(b), hash = op ? hashOf(payload, kind) : '';
    if (op) {
      const rc = find(uid, op);
      if (rc) {
        const item = load(rc.ref);
        if (rc.hash === hash) return { status: 200, out: { ok: true, repeated: true, removed: !item, updated: !!rc.ref.updated, item } };
        return { status: 409, out: { ok: false, error: 'op_conflict', item } };
      }
    }
    const r = mutate(uid, () => {
      const w = write();
      if (w.refuse) return { ok: false, refuse: w.refuse };   /* отказ: транзакция без записи, ревизия не двигается, квитанции нет */
      if (op) remember(uid, op, hash, w.ref);
      return w;
    });
    if (r.refuse) return { status: r.refuse.status, out: r.refuse.out, refused: true };
    return { status: 200, out: r.rev ? { ...r.out, rev: r.rev } : r.out, ref: r.ref };
  }
  return { opOf, hashOf, find, remember, run };
}
