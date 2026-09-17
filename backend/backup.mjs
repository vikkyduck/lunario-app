/* Лунарио — резервные копии того, что нельзя восстановить из git:
   база приложения (люди, записи, полочки), ключ шифрования и ключи пушей, папка контента.

   Одна реализация на два входа: ночной cron запускает этот файл напрямую
   (node backend/backup.mjs), а кабинет админа вызывает createBackup().run() по кнопке
   и показывает список копий. Хранится 14 копий каждого вида, папка — BACKUP_DIR
   (на сервере /opt/lunario-app-backups; приложению она разрешена на запись в systemd). */
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync, createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = 14;
const NAME = /^(app-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.db\.gz(?:\.enc)?|content-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.tar\.gz(?:\.enc)?)$/;
const mb = (b) => Math.round(b / 1048576 * 10) / 10;
let warnedPlain = false;

/* Копия базы — это все личные записи. Раньше она лежала в одной папке с ключом шифрования: у того, кто получил
   доступ к копиям, было и то и другое. Теперь при заданном BACKUP_SECRET архив шифруется отдельным ключом
   (AES-256-GCM поверх gzip), а ключ приложения и ключи пушей едут внутрь этого же архива, а не рядом с ним.

   Это не мешает главному: живой сервер по-прежнему читает записи своим ключом и отдает их досье и разборам —
   шифрование копий к работе приложения отношения не имеет.

   BACKUP_SECRET задается в окружении сервиса (systemd EnvironmentFile), в папке копий его нет.
   Потеря пароля = потеря копий: храните его в менеджере паролей. Формат файла: "LUNBK1" | соль(16) | iv(12) | тег(16) | шифротекст. */
const MAGIC = Buffer.from('LUNBK1');
const keyFrom = (secret, salt) => scryptSync(String(secret), salt, 32);
export function encryptFile(src, dest, secret) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(secret, salt), iv);
  const body = Buffer.concat([c.update(readFileSync(src)), c.final()]);
  return { header: Buffer.concat([MAGIC, salt, iv, c.getAuthTag()]), body, dest };
}
/* Расшифровать копию: используется tools/restore-backup.mjs и проверкой */
export function decryptBuffer(buf, secret) {
  if (!buf.subarray(0, 6).equals(MAGIC)) throw new Error('это не зашифрованная копия Лунарио');
  const salt = buf.subarray(6, 22), iv = buf.subarray(22, 34), tag = buf.subarray(34, 50);
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret, salt), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(50)), d.final()]);   // не тот пароль — ошибка тега, а не мусор
}

export function createBackup({ dataDir, contentDir, backupDir, secret = process.env.BACKUP_SECRET || '' }) {
  const dbFile = join(dataDir, 'app.db');
  const keyFiles = ['secret.key', 'push-keys.json'];

  function list() {
    if (!existsSync(backupDir)) return { items: [], last: null, lastContent: null, keys: false, dir: backupDir };
    const items = readdirSync(backupDir).filter((n) => NAME.test(n)).map((n) => {
      const st = statSync(join(backupDir, n));
      return { name: n, kind: n.startsWith('app-') ? 'db' : 'content', size: st.size, mb: mb(st.size), ts: st.mtime.toISOString() };
    }).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const last = items.find((i) => i.kind === 'db'), lastContent = items.find((i) => i.kind === 'content');
    return { items, last: last ? last.ts : null, lastContent: lastContent ? lastContent.ts : null, keys: existsSync(join(backupDir, 'secret.key')), encrypted: !!secret, dir: backupDir };
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
      if (secret) {
        /* база и ключи — в одном зашифрованном архиве: получивший папку копий не прочитает ни записи, ни ключ */
        const bundle = join(backupDir, `app-${stamp}.tar`);
        const present = keyFiles.filter((k) => existsSync(join(dataDir, k)));
        for (const k of present) copyFileSync(join(dataDir, k), join(backupDir, k));
        await promisify(execFile)('tar', ['-cf', bundle, '-C', backupDir, `app-${stamp}.db.gz`, ...present]);
        const { header, body } = encryptFile(bundle, '', secret);
        writeFileSync(join(backupDir, `app-${stamp}.db.gz.enc`), Buffer.concat([header, body]));
        for (const f of [bundle, join(backupDir, `app-${stamp}.db.gz`), ...present.map((k) => join(backupDir, k))]) { try { unlinkSync(f); } catch {} }
        out.files.push(`app-${stamp}.db.gz.enc`);
      } else {
        out.files.push(`app-${stamp}.db.gz`);
        for (const k of keyFiles) if (existsSync(join(dataDir, k))) copyFileSync(join(dataDir, k), join(backupDir, k));   // без ключа база не читается
        if (!warnedPlain) { warnedPlain = true; console.log('ВНИМАНИЕ: BACKUP_SECRET не задан — копия базы и ключ шифрования лежат рядом в открытом виде. Задайте BACKUP_SECRET в окружении сервиса.'); }
      }
    }
    if (existsSync(contentDir)) {
      const tar = join(backupDir, `content-${stamp}.tar.gz`);
      await promisify(execFile)('tar', ['-czf', tar, '-C', dirname(contentDir), basename(contentDir)]);
      if (secret) {
        const { header, body } = encryptFile(tar, '', secret);
        writeFileSync(tar + '.enc', Buffer.concat([header, body]));
        unlinkSync(tar);
        out.files.push(`content-${stamp}.tar.gz.enc`);
      } else out.files.push(`content-${stamp}.tar.gz`);
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
