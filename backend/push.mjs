/* Веб-уведомления «карта дня готова» без внешних библиотек.
   Работает так: сервер один раз создает себе пару ключей (VAPID), браузер
   подписывается и отдает адрес своей «почтовой ячейки», а мы стучимся в нее,
   подписав запрос. Текст уведомления живет в service worker — поэтому
   письмо-запрос пустое и шифровать содержимое не нужно. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createSign, createPrivateKey, createPublicKey } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/* Адрес почтовой ячейки браузера задает клиент, а стучится по нему сервер. Поэтому принимаем только https
   на стандартном порту, имя хоста (не IP) и не локальное имя — иначе сервер можно направить внутрь своей сети. */
const LOCAL_HOST = /(^|\.)(localhost|local|internal|lan|home\.arpa|localdomain)$/i;
export function pushEndpointOk(endpoint) {
  let u; try { u = new URL(String(endpoint || '')); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return !!host && !isIP(host) && !LOCAL_HOST.test(host) && host.includes('.');
}
/* 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, 100.64/10 и IPv6-аналоги */
export function isPrivateIp(ip) {
  const v4 = String(ip).match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { const a = Number(v4[1]), b = Number(v4[2]); return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
  const l = String(ip).toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}
/* Перед отправкой: имя разрешается только в публичные адреса. Ошибка DNS — не приговор ячейке, а временный сбой. */
async function assertPublicEndpoint(endpoint) {
  if (!pushEndpointOk(endpoint)) return false;
  const addrs = await lookup(new URL(endpoint).hostname, { all: true });
  return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
}

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

/* Одно уведомление. Возвращает true, если ячейка приняла; false — если ее больше нет. */
export async function sendPush(sub, keys, contact = 'mailto:hello@lunario.online') {
  if (!(await assertPublicEndpoint(sub.endpoint))) return false;   // адрес не публичный — ячейки для нас нет
  const url = new URL(sub.endpoint);
  const token = jwt(`${url.protocol}//${url.host}`, keys, contact);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
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
