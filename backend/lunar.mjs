/* Лунный день: номер и границы для точки на Земле.
   Первый лунный день начинается в новолуние, каждый следующий — с восхода Луны.
   Астрономия по Меёсу (укороченные ряды): Солнце ±0.01°, Луна ±0.05° —
   момент восхода точен до минуты-двух, этого хватает для «с 12:46 по 13:57». */
const R = Math.PI / 180;
const norm = (x) => ((x % 360) + 360) % 360;
const jdOf = (ms) => ms / 864e5 + 2440587.5;
const msOf = (jd) => (jd - 2440587.5) * 864e5;
const DT = 69 / 86400;                                  // ΔT: земное время опережает UT на ~69 с

function sunLon(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T, M = R * (357.52911 + 35999.05029 * T);
  const C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  return norm(L0 + C);
}

// ряды Меёса (гл. 47): аргументы D, M, M', F и коэффициенты в 1e-6 градуса / метрах
const LON = [[0,0,1,0,6288774],[2,0,-1,0,1274027],[2,0,0,0,658314],[0,0,2,0,213618],[0,1,0,0,-185116],[0,0,0,2,-114332],
  [2,0,-2,0,58793],[2,-1,-1,0,57066],[2,0,1,0,53322],[2,-1,0,0,45758],[0,1,-1,0,-40923],[1,0,0,0,-34720],[0,1,1,0,-30383],
  [2,0,0,-2,15327],[0,0,1,2,-12528],[0,0,1,-2,10980],[4,0,-1,0,10675],[0,0,3,0,10034],[4,0,-2,0,8548],[2,1,-1,0,-7888],
  [2,1,0,0,-6766],[1,0,-1,0,-5163],[1,1,0,0,4987],[2,-1,1,0,4036],[2,0,2,0,3994],[4,0,0,0,3861],[2,0,-3,0,3665],
  [0,1,-2,0,-2689],[2,0,-1,2,-2602],[2,-1,-2,0,2390],[1,0,1,0,-2348],[2,-2,0,0,2236],[0,1,2,0,-2120],[0,2,0,0,-2069],[2,-2,-1,0,2048]];
const LAT = [[0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],
  [2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],
  [2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794]];
const DIST = [[0,0,1,0,-20905355],[2,0,-1,0,-3699111],[2,0,0,0,-2955968],[0,0,2,0,-569925],[0,1,0,0,48888],[0,0,0,2,-3149],
  [2,0,-2,0,246158],[2,-1,-1,0,-152138],[2,0,1,0,-170733],[2,-1,0,0,-204586],[0,1,-1,0,-129620],[1,0,0,0,108743],[0,1,1,0,104755]];

function moonPos(jd) {                                  // геоцентрические λ, β (градусы) и расстояние (км)
  const T = (jd - 2451545) / 36525;
  const Lp = norm(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = norm(93.272095 + 483202.0175233 * T - 0.0036539 * T * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;    // поправка на эксцентриситет земной орбиты
  const arg = (t) => R * (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F);
  const ecc = (t) => (t[1] === 0 ? 1 : Math.abs(t[1]) === 1 ? E : E * E);
  let lon = 0, lat = 0, dist = 385000.56;
  for (const t of LON) lon += t[4] * ecc(t) * Math.sin(arg(t));
  for (const t of LAT) lat += t[4] * ecc(t) * Math.sin(arg(t));
  for (const t of DIST) dist += t[4] * ecc(t) * Math.cos(arg(t)) / 1000;
  return { lon: norm(Lp + lon / 1e6), lat: lat / 1e6, dist };
}

function moonEquatorial(jd) {
  const { lon, lat, dist } = moonPos(jd + DT);
  const T = (jd - 2451545) / 36525, eps = R * (23.4392911 - 0.0130042 * T);
  const l = R * lon, b = R * lat;
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  return { ra: norm(ra / R), dec: dec / R, parallax: Math.asin(6378.14 / dist) / R };
}

function gmst(jd) {
  const T = (jd - 2451545) / 36525;
  return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T * T * T / 38710000);
}

// высота центра Луны над горизонтом минус порог восхода (учёт параллакса и рефракции)
function moonAltDiff(jd, lat, lon) {
  const m = moonEquatorial(jd);
  const H = R * norm(gmst(jd) + lon - m.ra);
  const alt = Math.asin(Math.sin(R * lat) * Math.sin(R * m.dec) + Math.cos(R * lat) * Math.cos(R * m.dec) * Math.cos(H)) / R;
  const h0 = 0.7275 * m.parallax - 34 / 60;
  return alt - h0;
}

// элонгация Луны от Солнца в (-180, 180]: новолуние — переход через 0 снизу вверх
function elong(jd) {
  const e = norm(moonPos(jd + DT).lon - sunLon(jd + DT));
  return e > 180 ? e - 360 : e;
}

function bisect(f, a, b, iters = 40) {                  // f(a) < 0 < f(b)
  for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; }
  return (a + b) / 2;
}

export function newMoonBefore(ms) {
  let jd = jdOf(ms), step = 0.25;
  let e = elong(jd);
  // идём назад, пока элонгация не «перепрыгнет» через 0 (стала отрицательной)
  for (let i = 0; i < 200; i++) {
    const prev = elong(jd - step);
    if (prev < 0 && e >= 0) return msOf(bisect(elong, jd - step, jd));
    jd -= step; e = prev;
  }
  return null;
}

export function moonrisesBetween(fromMs, toMs, lat, lon) {
  const out = [];
  const step = 10 / 1440;                               // 10 минут
  let jd = jdOf(fromMs), end = jdOf(toMs);
  let prev = moonAltDiff(jd, lat, lon);
  while (jd < end) {
    const next = jd + step, cur = moonAltDiff(next, lat, lon);
    if (prev < 0 && cur >= 0) out.push(msOf(bisect((x) => moonAltDiff(x, lat, lon), jd, next, 30)));
    prev = cur; jd = next;
  }
  return out;
}

/* Номер лунного дня и его границы для момента nowMs в точке (lat, lon).
   Восхода может не быть несколько суток (полярные широты) — тогда to = null. */
export function lunarDay(nowMs, lat, lon) {
  const nm = newMoonBefore(nowMs);
  if (nm == null) return null;
  const rises = moonrisesBetween(nm, nowMs, lat, lon).filter((t) => t > nm && t <= nowMs);
  const after = moonrisesBetween(nowMs, nowMs + 4 * 864e5, lat, lon);
  return { n: Math.min(30, rises.length + 1), from: rises.length ? rises[rises.length - 1] : nm, to: after[0] || null, newMoon: nm };
}

/* «с 13 сентября 12:46 по 14 сентября 13:57» в часовом поясе человека */
export function lunarPeriodText(ld, tz) {
  const fmt = (ms) => {
    const p = new Intl.DateTimeFormat('ru-RU', { timeZone: tz || 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
    const g = (t) => (p.find((x) => x.type === t) || {}).value || '';
    return `${g('day')} ${g('month')} ${g('hour')}:${g('minute')}`;
  };
  if (!ld) return '';
  return ld.to ? `с ${fmt(ld.from)} по ${fmt(ld.to)}` : `с ${fmt(ld.from)}`;
}
