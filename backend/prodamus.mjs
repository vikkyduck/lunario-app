/* Продамус (payform) — платёжные ссылки и проверка уведомлений.
   Без внешних библиотек, по официальному алгоритму подписи:
   1) все значения → строки; 2) ключи отсортировать по алфавиту, вглубь;
   3) в JSON; 4) экранировать «/» как «\/»; 5) HMAC-SHA256 секретным ключом.
   Подпись уведомления приходит в заголовке Sign. */
import { createHmac, timingSafeEqual } from 'node:crypto';

/* Рекурсивно: значения в строки + ключи по алфавиту. */
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
    return out;
  }
  return String(v ?? '');
}

export function sign(data, secret) {
  const json = JSON.stringify(normalize(data)).replace(/\//g, '\\/');
  return createHmac('sha256', secret).update(json, 'utf8').digest('hex');
}

export function verify(data, secret, signature) {
  const ours = Buffer.from(sign(data, secret), 'utf8');
  const theirs = Buffer.from(String(signature || '').toLowerCase(), 'utf8');
  return ours.length === theirs.length && timingSafeEqual(ours, theirs);
}

/* Уведомление приходит формой в стиле PHP: products[0][name]=…
   Разворачиваем такие ключи во вложенную структуру — подпись считалась от неё. */
export function parseForm(body) {
  const flat = new URLSearchParams(body);
  const root = {};
  for (const [key, value] of flat) {
    const path = [];
    const m = key.match(/^([^[]+)((?:\[[^\]]*\])*)$/);
    if (!m) continue;
    path.push(m[1]);
    for (const part of m[2].matchAll(/\[([^\]]*)\]/g)) path.push(part[1]);
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      if (!(p in node) || typeof node[p] !== 'object') node[p] = {};
      node = node[p];
    }
    node[path[path.length - 1]] = value;
  }
  /* PHP считает products[0], products[1] массивом — и подписывает как массив.
     Объекты, у которых все ключи это 0,1,2…, превращаем обратно в массивы. */
  const arrayify = (v) => {
    if (!v || typeof v !== 'object') return v;
    const keys = Object.keys(v);
    for (const k of keys) v[k] = arrayify(v[k]);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return keys.map(Number).sort((a, b) => a - b).map((k) => v[k]);
    }
    return v;
  };
  return arrayify(root);
}

/* Ссылка на оплату: адрес формы + параметры + подпись. */
export function payLink(formHost, params, secret) {
  const data = { ...params, signature: sign(params, secret) };
  const qs = new URLSearchParams();
  const add = (prefix, v) => {
    if (Array.isArray(v)) v.forEach((item, i) => add(`${prefix}[${i}]`, item));
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) add(prefix ? `${prefix}[${k}]` : k, val);
    else qs.append(prefix, String(v ?? ''));
  };
  add('', data);
  return `https://${formHost}/?${qs.toString()}`;
}
