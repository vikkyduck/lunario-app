/* Справочник населённых пунктов: GeoNames (CC BY 4.0), собран в cities.db.
   Ищем по префиксу диапазоном — индекс отрабатывает мгновенно даже на 487k строк. */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, 'cities.db'), { readOnly: true });

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я\s-]/gi, '').trim();
const HI = '￿';
const row = (r) => ({ name: r.name, region: r.region, country: r.country, lat: r.lat, lon: r.lon, tz: r.tz, pop: r.pop });

/* Приоритет: точное совпадение → крупные города → всё остальное */
const qPrefix = db.prepare(`
  SELECT name, region, country, lat, lon, tz, pop FROM cities
  WHERE norm >= ? AND norm < ?
  ORDER BY (norm = ?) DESC, pop DESC LIMIT ?`);
const qWord = db.prepare(`
  SELECT name, region, country, lat, lon, tz, pop FROM cities
  WHERE w2 >= ? AND w2 < ?
  ORDER BY pop DESC LIMIT ?`);
const qAlt = db.prepare(`
  SELECT name, region, country, lat, lon, tz, pop FROM cities
  WHERE alt >= ? AND alt < ?
  ORDER BY pop DESC LIMIT ?`);

export function findCities(q, limit = 8) {
  const n = norm(q);
  if (n.length < 2) return [];
  const out = [], seen = new Set();
  const add = (rows) => {
    for (const r of rows) {
      const k = `${r.name}|${r.lat.toFixed(2)}|${r.lon.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(row(r));
      if (out.length >= limit) return true;
    }
    return false;
  };
  if (add(qPrefix.all(n, n + HI, n, limit))) return out;
  if (add(qWord.all(n, n + HI, limit))) return out;         // «новгород» → Нижний Новгород
  add(qAlt.all(n, n + HI, limit));                          // латиницей: «moscow»
  return out;
}

export function cityByName(name) {
  const n = norm(name);
  const r = db.prepare(`SELECT name, region, country, lat, lon, tz, pop FROM cities
    WHERE norm = ? ORDER BY pop DESC LIMIT 1`).get(n);
  return r ? row(r) : null;
}

/* Смещение пояса на конкретный момент — с учётом исторических правил перевода часов */
export function tzOffsetMinutes(tz, isoLocal) {
  try {
    const d = new Date(isoLocal + 'Z');
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(d).find((p) => p.type === 'timeZoneName');
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part ? part.value : '');
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  } catch { return 0; }
}
