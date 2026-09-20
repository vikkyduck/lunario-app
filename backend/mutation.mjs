/* Единый путь изменения личных данных (ревью v114, F04): проверить → изменить → квитанция → ревизия — одной транзакцией.
   Ревизией (users.data_rev) владеет тот, кто пишет данные, а не маршрутизатор: раньше она поднималась до чтения тела запроса,
   и база знаний могла собрать старые данные под новой ревизией. Отказ (ok:false) ничего не пишет и ревизию не трогает.
   Возвращает MutationResult: { ok, applied | repeated, item?, rev } — то, что вернула work(), плюс rev.
   work() синхронна (transaction из sync.mjs не терпит await); вложенных транзакций нет — кто зовет mutate(), сам BEGIN не делает.
   Правило: любой INSERT/UPDATE/DELETE по таблице из PERSONAL_DATA (account-data.mjs) идет через mutate();
   страж в check-personal-features перечисляет, какой запрос какую таблицу трогает, и проверяет «ровно +1». */
import { transaction } from './sync.mjs';

export function createMutation(db) {
  const bump = db.prepare('UPDATE users SET data_rev = data_rev + 1 WHERE id = ? RETURNING data_rev');
  return function mutate(uid, work) {
    return transaction(db, () => {
      const out = work();
      if (!out || out.ok === false) return out;
      const row = bump.get(uid);
      return { ...out, rev: row ? row.data_rev : 0 };
    });
  };
}
