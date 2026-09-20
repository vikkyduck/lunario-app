/* Отчеты кабинета считаются в отдельном потоке (worker_threads).
   SQLite в node синхронна: один отчет активации на большой базе задерживал все запросы приложения
   примерно на секунду. Здесь свое соединение с той же базой (WAL: читатель не мешает писателю),
   те же модули и тот же результат, что и в основном потоке, — только не на его времени.
   Поток ничего не пишет: setConfig/resetConfig остаются в server.mjs. Запускает его report-runner.mjs. */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { privateText } from './private-text.mjs';
import { initWorkspace } from './workspace.mjs';
import { initReports, overview, report } from './reports.mjs';
import { verifySchema } from './schema.mjs';

const { dataDir } = workerData;
const db = new DatabaseSync(join(dataDir, 'app.db'));
db.exec('PRAGMA busy_timeout = 5000');
verifySchema(db);   /* схему ведет основной процесс (F12): здесь только проверка, что она полная */
const { seal, open } = privateText(dataDir, { create: false });   // ключ уже создан основным процессом
initWorkspace(db, dataDir, seal, open);   // таблицы уже есть — только привязка модуля к базе
initReports(db, dataDir);

const RUN = { overview: (q) => overview(q), report: (kind, q) => report(kind, q) };
parentPort.on('message', ({ id, kind, args }) => {
  try { parentPort.postMessage({ id, ok: true, result: RUN[kind](...args) }); }
  catch (e) { parentPort.postMessage({ id, ok: false, error: e.message || String(e) }); }
});
parentPort.postMessage({ ready: true });
