import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes,createCipheriv,createDecipheriv,scryptSync } from 'node:crypto';

// Shared with the reminder worker. The enc1 format and key derivation stay unchanged.
export function privateText(DATA_DIR, {create=true}={}) {
const SECRET = (process.env.APP_SECRET || '').trim() || (() => {
  const keyFile = join(DATA_DIR, 'secret.key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  if (!create) throw new Error('Personal data key is missing');
  const fresh = randomBytes(32).toString('base64');
  writeFileSync(keyFile, fresh, { mode: 0o600 });
  console.log('Создан ключ шифрования записей: data/secret.key — храните его вместе с базой');
  return fresh;
})();
const KEY = scryptSync(SECRET, 'lunario-notes', 32);
const ENC_MARK = 'enc1:';

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
  if (!s.startsWith(ENC_MARK)) return s;              // старая запись без шифрования
  try {
    const raw = Buffer.from(s.slice(ENC_MARK.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
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
return {seal, open:open_, sealBytes, openBytes};
}
