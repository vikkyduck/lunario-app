/* Тяжелые задания считаются в отдельном потоке (worker_threads): отчеты и дашборд кабинета, полная выгрузка личных данных
   (ревью v114, F09). SQLite в node синхронна: один отчет активации на большой базе или выгрузка года записей с PDF задерживали
   все запросы приложения примерно на секунду. Здесь свое соединение с той же базой (WAL: читатель не мешает писателю),
   те же модули и тот же результат, что и в основном потоке, — только не на его времени.
   Поток ничего не пишет: setConfig/resetConfig остаются в server.mjs. Запускает его job-runner.mjs. */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateText } from './private-text.mjs';
import { initWorkspace } from './workspace.mjs';
import { initReports, overview, report } from './reports.mjs';
import { verifySchema } from './schema.mjs';
import { personalExport } from './personal-export.mjs';
import { personalExportPdf } from './personal-export-pdf.mjs';
import { FEATURES as REMINDER_FEATURES } from './reminders.mjs';
import * as C from './content.mjs';

const { dataDir } = workerData;
const db = new DatabaseSync(join(dataDir, 'app.db'));
db.exec('PRAGMA busy_timeout = 5000');
verifySchema(db);   /* схему ведет основной процесс (F12): здесь только проверка, что она полная */
const { seal, open } = privateText(dataDir, { create: false });   // ключ уже создан основным процессом
initWorkspace(db, dataDir, seal, open);   // таблицы уже есть — только привязка модуля к базе
initReports(db, dataDir);

/* выгрузка: те же подписи, что у основного процесса (server.mjs) — название настроения, темы, напоминания, инструмента, обложка */
const SITE_DIR = process.env.SITE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
let headerPng = null;
const header = () => { if (headerPng === null) { try { headerPng = readFileSync(join(SITE_DIR, 'assets/mail/header.png')); } catch { headerPng = false; } } return headerPng || null; };
const moodName = (k) => String(k).startsWith('own:') ? String(k).slice(4) : ((C.moodInfo(k) || {}).label || 'настроение без названия');
const PDF_OPTS = () => ({ moodName, topicTitle: (k) => (C.READING_TOPICS.find((t) => t.key === k) || {}).title || k,
  reminderTitle: (k) => (REMINDER_FEATURES[k] || {}).title || k, toolTitle: (k) => ([...C.TOOLS].find((t) => t.key === k) || {}).title || k, headerPng: header() });
/* данные читаются в одной транзакции чтения — согласованный снимок: выгрузка не смешивает состояние до и после параллельной записи */
function exportJob(userId, format) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId); if (!u) throw new Error('not_found');
  db.exec('BEGIN'); let data; try { data = personalExport(db, u, open); } finally { db.exec('COMMIT'); }
  return format === 'pdf' ? personalExportPdf(data, PDF_OPTS()) : data;
}

const RUN = { overview: (q) => overview(q), report: (kind, q) => report(kind, q), export: (userId, format) => exportJob(userId, format) };
/* задания идут по одному; отмененное по таймауту (основной поток шлет { cancel: id }) не начинается (ревью v114, F10) */
const cancelled = new Set();
parentPort.on('message', (m) => {
  if (m && m.cancel) { cancelled.add(m.cancel); return; }
  const { id, kind, args } = m;
  if (cancelled.has(id)) { cancelled.delete(id); return; }
  try {
    const result = RUN[kind](...args);
    /* байты (PDF) — передачей владения буфером, без копии между потоками */
    if (Buffer.isBuffer(result)) { const ab = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength); parentPort.postMessage({ id, ok: true, result: new Uint8Array(ab) }, [ab]); }
    else parentPort.postMessage({ id, ok: true, result });
  }
  catch (e) { parentPort.postMessage({ id, ok: false, error: e.message || String(e) }); }
});
parentPort.postMessage({ ready: true });
