/* Веб-уведомления «карта дня готова» без внешних библиотек.
   Работает так: сервер один раз создаёт себе пару ключей (VAPID), браузер
   подписывается и отдаёт адрес своей «почтовой ячейки», а мы стучимся в неё,
   подписав запрос. Текст уведомления живёт в service worker — поэтому
   письмо-запрос пустое и шифровать содержимое не нужно. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createSign, createPrivateKey, createPublicKey } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/* Ключи создаются при первом запуске и живут рядом с базой. */
export function vapidKeys(dataDir) {
  const file = join(dataDir, 'push-keys.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = b64url(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65));
  const keys = {
    publicKey: pub,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

/* Подпись запроса: доказываем почтовой службе браузера, что это правда мы. */
function jwt(audience, keys, contact) {
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact,
  }));
  const signer = createSign('SHA256');
  signer.update(`${head}.${body}`);
  const der = signer.sign(createPrivateKey(keys.privateKeyPem));
  // der → «сырая» подпись из двух чисел по 32 байта, как требует стандарт
  let i = 2, r, s;
  if (der[0] !== 0x30) throw new Error('подпись неожиданного вида');
  i++; const rLen = der[i++]; r = der.subarray(i, i + rLen); i += rLen;
  i++; const sLen = der[i++]; s = der.subarray(i, i + sLen);
  const fix = (x) => { const out = Buffer.alloc(32); const src = x.length > 32 ? x.subarray(x.length - 32) : x; src.copy(out, 32 - src.length); return out; };
  return `${head}.${body}.${b64url(Buffer.concat([fix(r), fix(s)]))}`;
}

/* Одно уведомление. Возвращает true, если ячейка приняла; false — если её больше нет. */
export async function sendPush(sub, keys, contact = 'mailto:hello@lunario.online') {
  const url = new URL(sub.endpoint);
  const token = jwt(`${url.protocol}//${url.host}`, keys, contact);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Authorization: `vapid t=${token}, k=${keys.publicKey}`,
      'Content-Length': '0',
    },
  });
  if (res.status === 404 || res.status === 410) return false;   // человек отписался
  if (!res.ok) throw new Error(`почтовая служба ответила ${res.status}`);
  return true;
}
