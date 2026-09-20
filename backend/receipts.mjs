/* Квитанции операций (аудит v98 F02, повторный аудит v112 R02, R04, R05): клиент дает записи свой ключ op; сервер запоминает
   не ответ, а ссылку на результат — таблицу, id и хеш тела. Личного текста в квитанции нет: запись живет только в своей таблице,
   зашифрованной, и удаление записи не оставляет открытой копии. Повтор с тем же ключом и телом: запись жива — отдается в
   актуальном виде; удалена — repeated + removed, ничего не создается заново. Тот же ключ с другим телом — конфликт, но с найденной
   записью: клиент правит ее, а не создает вторую. Запись и квитанция — одна транзакция. Квитанции старше недели стираются. */
import { createHash } from 'node:crypto';
import { transaction } from './sync.mjs';

export function createReceipts(db, nowISO) {
  const opOf = (b) => typeof b?.op === 'string' && /^[\w.-]{8,64}$/.test(b.op) ? b.op : '';
  const hashOf = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const find = (uid, op) => { const r = db.prepare('SELECT payload_hash, response_json FROM sync_receipts WHERE user_id = ? AND operation_id = ?').get(uid, op); if (!r) return null; try { return { hash: r.payload_hash, ref: JSON.parse(r.response_json) }; } catch { return { hash: r.payload_hash, ref: {} }; } };
  const remember = (uid, op, hash, ref) => {
    db.prepare('INSERT OR REPLACE INTO sync_receipts (user_id, operation_id, payload_hash, response_json, created_at) VALUES (?,?,?,?,?)').run(uid, op, hash, JSON.stringify(ref), nowISO());
    db.prepare('DELETE FROM sync_receipts WHERE created_at < ?').run(new Date(Date.now() - 7 * 864e5).toISOString());
  };
  /* Одна операция с квитанцией: b — тело запроса, payload — что считается «тем же телом», load(ref) — актуальное состояние
     результата по ссылке (null — удален), write() — сама запись, возвращает { ref, out }. Ответ: out, либо повтор/конфликт. */
  function run(uid, b, payload, { load, write }) {
    const op = opOf(b), hash = op ? hashOf(payload) : '';
    if (op) {
      const rc = find(uid, op);
      if (rc) {
        const item = load(rc.ref);
        if (rc.hash === hash) return { status: 200, out: { ok: true, repeated: true, removed: !item, updated: !!rc.ref.updated, item } };
        return { status: 409, out: { ok: false, error: 'op_conflict', item } };
      }
    }
    const { ref, out } = transaction(db, () => { const r = write(); if (op) remember(uid, op, hash, r.ref); return r; });
    return { status: 200, out, ref };
  }
  return { opOf, hashOf, find, remember, run };
}
