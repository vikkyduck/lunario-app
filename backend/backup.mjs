/* Лунарио — резервные копии того, что нельзя восстановить из git:
   база приложения (люди, записи, полочки), ключ шифрования и ключи пушей, папка контента.

   Одна реализация на два входа: ночной cron запускает этот файл напрямую
   (node backend/backup.mjs), а кабинет админа вызывает createBackup().run() по кнопке
   и показывает список копий. Хранится 14 копий каждого вида, папка — BACKUP_DIR
   (на сервере /opt/lunario-app-backups; приложению она разрешена на запись в systemd). */
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync, createReadStream, createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = 14;
const NAME = /^(app-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.db\.gz|content-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.tar\.gz)$/;
const mb = (b) => Math.round(b / 1048576 * 10) / 10;

export function createBackup({ dataDir, contentDir, backupDir }) {
  const dbFile = join(dataDir, 'app.db');

  function list() {
    if (!existsSync(backupDir)) return { items: [], last: null, lastContent: null, keys: false, dir: backupDir };
    const items = readdirSync(backupDir).filter((n) => NAME.test(n)).map((n) => {
      const st = statSync(join(backupDir, n));
      return { name: n, kind: n.startsWith('app-') ? 'db' : 'content', size: st.size, mb: mb(st.size), ts: st.mtime.toISOString() };
    }).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const last = items.find((i) => i.kind === 'db'), lastContent = items.find((i) => i.kind === 'content');
    return { items, last: last ? last.ts : null, lastContent: lastContent ? lastContent.ts : null, keys: existsSync(join(backupDir, 'secret.key')), dir: backupDir };
  }

  /* Снять копию. manual — копия по кнопке получает время в имени, чтобы не затереть ночную. */
  async function run(manual = false) {
    mkdirSync(backupDir, { recursive: true });
    const now = new Date(), stamp = now.toISOString().slice(0, 10) + (manual ? '-' + now.toISOString().slice(11, 19).replace(/:/g, '') : '');
    const out = { stamp, files: [] };
    if (existsSync(dbFile)) {
      const tmp = join(backupDir, `app-${stamp}.db`);
      const src = new DatabaseSync(dbFile, { readOnly: true });
      try { await sqliteBackup(src, tmp); } finally { src.close(); }
      /* сжимаем потоком: копия по кнопке из кабинета не должна держать всю базу в памяти и блокировать сервер */
      await pipeline(createReadStream(tmp), createGzip(), createWriteStream(tmp + '.gz'));
      unlinkSync(tmp);
      out.files.push(`app-${stamp}.db.gz`);
      for (const k of ['secret.key', 'push-keys.json']) if (existsSync(join(dataDir, k))) copyFileSync(join(dataDir, k), join(backupDir, k));   // без ключа база не читается
    }
    if (existsSync(contentDir)) {
      await promisify(execFile)('tar', ['-czf', join(backupDir, `content-${stamp}.tar.gz`), '-C', dirname(contentDir), basename(contentDir)]);
      out.files.push(`content-${stamp}.tar.gz`);
    }
    for (const kind of ['app-', 'content-']) {   // старше четырнадцати — убираем
      const old = readdirSync(backupDir).filter((n) => n.startsWith(kind) && NAME.test(n)).sort().reverse().slice(KEEP);
      for (const n of old) unlinkSync(join(backupDir, n));
    }
    return out;
  }

  const file = (name) => (NAME.test(String(name || '')) && existsSync(join(backupDir, name)) ? join(backupDir, name) : null);
  return { list, run, file, dir: backupDir };
}

/* Запуск из cron: node backend/backup.mjs — пути берутся из окружения, как у сервера */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const B = createBackup({
    dataDir: process.env.DATA_DIR || join(here, '..', 'data'),
    contentDir: process.env.CONTENT_DIR || join(here, '..', 'content'),
    backupDir: process.env.BACKUP_DIR || join(here, '..', 'backups'),
  });
  B.run().then((r) => console.log('Копия снята:', r.files.join(', '), '→', B.dir)).catch((e) => { console.error('Копия не снялась:', e.message); process.exit(1); });
}
