/* Восстановление зашифрованной копии Лунарио.

   node tools/restore-backup.mjs <файл .enc> [куда]

   Пароль берётся из BACKUP_SECRET — того же, что задан сервису при снятии копии.
   Скрипт только расшифровывает и распаковывает рядом; он ничего не перезаписывает в работающей папке данных.
   Дальше файлы переносит человек: остановить сервис → положить app.db и secret.key в DATA_DIR → запустить. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { decryptBuffer } from '../backend/backup.mjs';

const [file, outDir = 'restored-' + basename(String(process.argv[2] || '')).replace(/\.(tar\.gz|db\.gz)\.enc$/, '')] = process.argv.slice(2);
const secret = process.env.BACKUP_SECRET || '';
if (!file) { console.error('Укажите файл копии: node tools/restore-backup.mjs /opt/lunario-app-backups/app-2026-09-16.db.gz.enc'); process.exit(1); }
if (!secret) { console.error('Нужен BACKUP_SECRET — тот же пароль, что у сервиса при снятии копии.'); process.exit(1); }
if (!existsSync(file)) { console.error('Файла нет: ' + file); process.exit(1); }

let plain;
try { plain = decryptBuffer(readFileSync(file), secret); }
catch (e) { console.error('Не расшифровалось: ' + e.message + '\nЧаще всего это другой BACKUP_SECRET.'); process.exit(1); }

const dir = resolve(outDir);
mkdirSync(dir, { recursive: true });
const tar = join(dir, 'bundle.tar');
writeFileSync(tar, plain);
execFileSync('tar', ['-xf', tar, '-C', dir]);
execFileSync('rm', ['-f', tar]);
console.log(`Распаковано в ${dir}`);
for (const n of ['app-*.db.gz', 'secret.key', 'push-keys.json']) console.log(' ·', n);
console.log('\nДальше вручную: systemctl stop lunario-app · gunzip app-*.db.gz → DATA_DIR/app.db · secret.key и push-keys.json → DATA_DIR · systemctl start lunario-app');
