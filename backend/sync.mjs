/* Одна короткая транзакция для синхронной node:sqlite (используют day.mjs и week.mjs). Клиентская очередь операций
   с квитанциями, что жила здесь раньше, снята вместе с sync.js (19.09): в приложении она не использовалась. */
/* Одна короткая транзакция. work() обязана быть синхронной: БД синхронна, и await внутри подвесил бы весь процесс.
   BEGIN IMMEDIATE берет право на запись сразу — иначе два писателя обнаружат конфликт только на COMMIT.
   Не удался откат — соединение испорчено, закрываем: работать дальше на нем опаснее, чем упасть. */
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
