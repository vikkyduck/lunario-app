import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes,createCipheriv,createDecipheriv,scryptSync } from 'node:crypto';

/* Три исхода расшифровки — три разных результата (ревью v114, F14): строка при успехе; штатная пустая строка на входе —
   пустая строка на выходе; чужой ключ или испорченные данные — исключение decrypt_failed, а не '' (иначе экран, выгрузка
   и сводки не отличали бы «не читается» от «ничего не писал»). Кто показывает список, помечает элемент через readable();
   одиночный маршрут отдает 500 decrypt_failed — переводит общий обработчик server.mjs */
const ENC_MARK = 'enc1:';
const KEY_CHECK_TEXT = 'lunario-key-check';
export const decryptFailed = () => Object.assign(new Error('decrypt_failed'), { code: 'decrypt_failed' });
export const isDecryptFailed = (e) => !!e && e.code === 'decrypt_failed';
/* Обертка для списков: { text, unreadable } — «не читается» помечается, остальные ошибки идут дальше */
export const readableWith = (open) => (s) => { try { return { text: open(s), unreadable: false }; } catch (e) { if (isDecryptFailed(e)) return { text: null, unreadable: true }; throw e; } };
/* Есть ли в базе хоть одна зашифрованная строка — по ней решается, можно ли заводить новый ключ (только на пустой базе) */
export function hasEncrypted(db) {
  for (const [table, col] of [['journal', 'text'], ['wishes', 'text'], ['habits', 'title'], ['askesis', 'title'], ['entries', 'question']]) {
    try { if (db.prepare(`SELECT 1 FROM ${table} WHERE ${col} LIKE '${ENC_MARK}%' LIMIT 1`).get()) return true; } catch { /* таблицы еще нет */ }
  }
  return false;
}
export const KEY_MISMATCH = 'ключ шифрования не совпадает с данными — восстановите data/secret.key из резервной копии';

// Shared with the reminder worker. The enc1 format and key derivation stay unchanged.
/* create — заводить ключ, если файла нет. encrypted — сервер передает hasEncrypted(db): true/false включает защиту ключа —
   без файла ключа при зашифрованных записях не стартовать (автосоздание ключа — только на пустой базе); с ключом — сверить
   маркер data/key.check (пишется при первом запуске с этим ключом), не сошелся — не стартовать. undefined (поток отчетов,
   планировщик, проверки) — без защиты: ключ уже проверил основной процесс */
export function privateText(DATA_DIR, {create=true, encrypted}={}) {
const keyFile = join(DATA_DIR, 'secret.key'), guard = encrypted !== undefined;
if (guard && encrypted && !(process.env.APP_SECRET || '').trim() && !existsSync(keyFile)) throw new Error(KEY_MISMATCH + ' (файла ключа нет, а записи зашифрованы)');
const SECRET = (process.env.APP_SECRET || '').trim() || (() => {
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  if (!create) throw new Error('Personal data key is missing');
  const fresh = randomBytes(32).toString('base64');
  writeFileSync(keyFile, fresh, { mode: 0o600 });
  console.log('Создан ключ шифрования записей: data/secret.key — храните его вместе с базой');
  return fresh;
})();
const KEY = scryptSync(SECRET, 'lunario-notes', 32);

function seal(text) {
  const s = String(text ?? '');
  if (!s) return s;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return ENC_MARK + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function open_(text) {
  const s = String(text ?? '');
  if (!s.startsWith(ENC_MARK)) return s;              // старая запись без шифрования или штатная пустая строка
  try {
    const raw = Buffer.from(s.slice(ENC_MARK.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { throw decryptFailed(); }
}
/* Байты (фото дня): тот же ключ и AES-256-GCM, без base64 — iv (12) + тег (16) + тело. Не открылось — null */
function sealBytes(buf) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
function openBytes(buf) {
  try { const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]); }
  catch { return null; }
}
/* Маркер ключа: data/key.check = seal('lunario-key-check'). Есть и не открывается — ключ не тот, сервер не стартует;
   нет — пишется (первый запуск с этим ключом). Так сервер не начнет писать новым ключом поверх архива, который уже не откроется */
const checkFile = join(DATA_DIR, 'key.check');
if (guard) {
  let ok = false;
  if (existsSync(checkFile)) { try { ok = open_(readFileSync(checkFile, 'utf8').trim()) === KEY_CHECK_TEXT; } catch { ok = false; } if (!ok && encrypted) throw new Error(KEY_MISMATCH); }
  if (!ok) writeFileSync(checkFile, seal(KEY_CHECK_TEXT), { mode: 0o600 });   /* первый запуск с этим ключом — или пустая база, защищать нечего */
}
return {seal, open:open_, sealBytes, openBytes, readable: readableWith(open_)};
}
