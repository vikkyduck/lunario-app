/* Защита запросов до всякой работы сервера (консилиум 16.10, безопасность) — одно место для server.mjs и проверок.

   1. Запросы с чужих сайтов. Любая страница в интернете могла простым POST text/plain просить коды входа на чужие адреса —
      с IP своих посетителей, мимо лимита «на адрес». Каждое такое письмо уходит из нашего ящика на Яндексе, и залп писем
      незнакомым людям — кратчайший путь к его блокировке, то есть к повторению аварии 16.10, но надолго.
      Изменяющий запрос браузера с чужой страницы отклоняется: Sec-Fetch-Site: cross-site шлют все нынешние браузеры,
      чужой Origin — запасной признак для старых. Запросы не из браузера (curl, deploy.sh, проверки) этих заголовков
      не шлют и проходят: адрес у них свой, и на него действуют лимиты.
   2. Лимиты по IPv6 — по сети /64. Абоненту обычно выдают целую сеть /64, и лимит «на адрес» обходился сменой адреса
      внутри нее. IPv4, в том числе записанный как ::ffff:1.2.3.4, — по адресу, как раньше. */
import { isIPv4, isIPv6 } from 'node:net';

/* Ключ лимита: IPv4 — сам адрес, IPv6 — его сеть /64 в одной записи (2001:db8:0:a::1 и 2001:0db8:0000:000a:ffff::9 — один ключ).
   Не адрес (пустой peer, мусор в X-Forwarded-For) — как есть: лимит сработает на эту строку, а не пропустит ее. */
export function ipNetwork(ip) {
  const s = String(ip || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  const bare = s.replace(/%.*$/, '');   /* зона интерфейса (fe80::1%eth0) к сети отношения не имеет */
  if (!isIPv6(bare)) return s;
  /* последние 32 бита могут быть записаны как IPv4 (64:ff9b::1.2.3.4) — для подсчета групп это две группы */
  const groups = (part) => (part ? part.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g])) : []);
  const [head, tail] = bare.includes('::') ? bare.split('::') : [bare, null];
  const left = groups(head), right = tail === null ? [] : groups(tail);
  const full = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return full.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/* Изменяющий запрос с чужой страницы? allowedOrigin — публичный адрес приложения (https://lunario.online): за nginx заголовок
   Host может быть внутренним (127.0.0.1:5031), а Origin у своей страницы — публичный. Иначе свой — тот, чей хост совпадает
   с Host запроса (локальный запуск, проверки в браузере). Origin: null (песочница, file://) — чужой. */
export function crossSiteWrite(req, allowedOrigin) {
  if (READ_METHODS.has(req.method)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (origin === undefined || origin === allowedOrigin) return false;
  let host; try { host = new URL(origin).host; } catch { return true; }
  return !host || host !== req.headers.host;
}
