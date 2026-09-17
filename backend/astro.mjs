/* Эфемериды без зависимостей: западная тропическая астрология, дома Плацидуса.
   Солнце и Луна — по Ж. Меесу (гл. 25 и 47): сверено с JPL Horizons, расхождение ~1–2″.
   Планеты и Хирон 1920–2080 — таблица видимых долгот из JPL Horizons (backend/ephem.bin,
   шаг 1 день для внутренних и 4 дня для внешних, интерполяция кубиком) — точность ~1″.
   Вне таблицы планеты считаются по кеплеровым элементам JPL (±1′), Хирон недоступен.
   Узел — истинный (Меес), Лилит — средний апогей, Селена — 7-летний цикл, Парс Фортуны — дневная/ночная формула. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm = (x) => ((x % 360) + 360) % 360;
const sin = (d) => Math.sin(d * D2R), cos = (d) => Math.cos(d * D2R), tan = (d) => Math.tan(d * D2R);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * R2D, atan2 = (y, x) => Math.atan2(y, x) * R2D;

/* юлианский день по UTC */
export function julianDay(y, m, d, hUTC = 0) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + hUTC / 24;
}
/* ΔT (TT − UT) — грубая аппроксимация, секунды; для наших целей хватает */
function deltaT(year) {
  const t = (year - 2000) / 100;
  if (year < 1900) return 0; if (year < 1950) return -2.79 + 1.494119 * (year - 1900) * 0.1; if (year < 2005) return 63.86 + 33.45 * t;
  return 62.92 + 32.217 * t + 55.89 * t * t;
}

/* нутация и наклон эклиптики */
function nutation(T) {
  const O = norm(125.04452 - 1934.136261 * T), L = norm(280.4665 + 36000.7698 * T), Lp = norm(218.3165 + 481267.8813 * T);
  const dpsi = (-17.20 * sin(O) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * O)) / 3600;
  const deps = (9.20 * cos(O) + 0.57 * cos(2 * L) + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * O)) / 3600;
  const eps0 = 23 + 26 / 60 + 21.448 / 3600 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
  return { dpsi, eps: eps0 + deps };
}

/* Солнце: видимая геоцентрическая долгота */
function sunLongitude(T) {
  const L0 = norm(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const O = 125.04 - 1934.136 * T;
  return norm(L0 + C - 0.00569 - 0.00478 * sin(O));
}

/* Луна: ряды Мееса, таблицы 47.A / 47.B */
const LR = [[0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],[0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],[2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],[0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],[2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],[3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],[0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],[2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],[4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],[0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],[4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],[1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752]];
const LB = [[0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],[0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],[0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],[4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],[2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],[0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],[2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],[0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],[0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],[0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],[4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107]];
function moonPosition(T) {
  const Lp = norm(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000);
  const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000);
  const M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000);
  const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000);
  const F = norm(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000);
  const A1 = norm(119.75 + 131.849 * T), A2 = norm(53.09 + 479264.290 * T), A3 = norm(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) { const e = m ? (Math.abs(m) === 2 ? E * E : E) : 1; const a = d * D + m * M + mp * Mp + f * F; sl += l * e * sin(a); sr += r * e * cos(a); }
  for (const [d, m, mp, f, b] of LB) { const e = m ? (Math.abs(m) === 2 ? E * E : E) : 1; sb += b * e * sin(d * D + m * M + mp * Mp + f * F); }
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  return { lon: norm(Lp + sl / 1e6), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

/* планеты: элементы JPL (a, e, I, L, ϖ, Ω) на J2000 + скорости за столетие */
const EL = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  pluto:   [[39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
};
function helio(name, T) {
  const [e0, r] = EL[name]; const [a, e, I, L, w_, O] = e0.map((v, i) => v + r[i] * T);
  const w = w_ - O; let M = norm(L - w_); if (M > 180) M -= 360;
  let Ec = M + (e * R2D) * sin(M);
  for (let i = 0; i < 20; i++) { const dM = M - (Ec - (e * R2D) * sin(Ec)); const dE = dM / (1 - e * cos(Ec)); Ec += dE; if (Math.abs(dE) < 1e-8) break; }
  const xp = a * (cos(Ec) - e), yp = a * Math.sqrt(1 - e * e) * sin(Ec);
  const cw = cos(w), sw = sin(w), cO = cos(O), sO = sin(O), cI = cos(I), sI = sin(I);
  return { x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, z: (sw * sI) * xp + (cw * sI) * yp };
}
function planetLongitude(name, T) {
  const p = helio(name, T), e = helio('earth', T);
  const x = p.x - e.x, y = p.y - e.y, z = p.z - e.z;
  const lonJ2000 = norm(atan2(y, x)), lat = atan2(z, Math.sqrt(x * x + y * y));
  const prec = 1.3969713 * T + 0.0003086 * T * T;      // общая прецессия: J2000 → эклиптика даты
  return { lon: norm(lonJ2000 + prec), lat, dist: Math.sqrt(x * x + y * y + z * z) };
}
const meanNode = (T) => norm(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441 - T ** 4 / 60616000);
/* истинный узел: средний + периодические члены (Меес, гл. 47) */
function trueNode(T) {
  const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868), M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699), F = norm(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000);
  return norm(meanNode(T) - 1.4979 * sin(2 * (D - F)) - 0.1500 * sin(M) - 0.1226 * sin(2 * D) + 0.1176 * sin(2 * F) - 0.0801 * sin(2 * (Mp - F)));
}
/* оскулирующий узел: по вектору момента импульса Луны r × v (так считает Swiss Ephemeris) */
function osculatingNode(T) {
  const dt = 1 / 24 / 36525;                                            // ± 1 час
  const vec = (t) => { const m = moonPosition(t); const cb = cos(m.lat); return [m.dist * cb * cos(m.lon), m.dist * cb * sin(m.lon), m.dist * sin(m.lat)]; };
  const r = vec(T), a = vec(T - dt), b = vec(T + dt), v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  return norm(atan2(h[0], -h[1]));
}
/* средний апогей лунной орбиты = средний перигей + 180° */
const meanLilith = (T) => norm(83.3532465 + 4069.0137287 * T - 0.0103200 * T * T - T ** 3 / 80053 + T ** 4 / 18999000 + 180);
/* Селена (Белая Луна): равномерный цикл в 7 тропических лет; эпоха выверена по эталонной карте */
const selena = (JD) => norm(153.0372 + (JD - 2445796.7056) * 360 / (7 * 365.2422));

/* ── таблица JPL Horizons: видимые долготы планет и Хирона ── */
let EPH = null;
function ephem() {
  if (EPH !== null) return EPH;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const idx = JSON.parse(readFileSync(join(dir, 'ephem.json'), 'utf8'));
    const buf = readFileSync(join(dir, 'ephem.bin'));
    EPH = { idx, data: new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
  } catch { EPH = false; }
  return EPH;
}
function tableLon(name, JD) {
  const e = ephem(); if (!e || !e.idx.bodies[name]) return null;
  const b = e.idx.bodies[name];
  const x = (JD - b.jd0) / b.step, i = Math.floor(x);
  if (i < 1 || i + 2 >= b.n) return null;
  const y = [-1, 0, 1, 2].map((k) => e.data[b.offset + i + k] / 10000);
  for (let k = 1; k < 4; k++) { while (y[k] - y[k - 1] > 180) y[k] -= 360; while (y[k] - y[k - 1] < -180) y[k] += 360; }   // развернуть через 0°
  const t = x - i;   // интерполяция Лагранжа по четырем точкам
  const v = y[0] * (-t * (t - 1) * (t - 2) / 6) + y[1] * ((t + 1) * (t - 1) * (t - 2) / 2) + y[2] * (-(t + 1) * t * (t - 2) / 2) + y[3] * ((t + 1) * t * (t - 1) / 6);
  return norm(v);
}
export const ephemRange = () => { const e = ephem(); return e ? { from: e.idx.start, to: '2080-01-01' } : null; };

/* сидерическое время и дома */
function gmst(JD) { const T = (JD - 2451545) / 36525; return norm(280.46061837 + 360.98564736629 * (JD - 2451545) + 0.000387933 * T * T - T ** 3 / 38710000); }
const eclFromRA = (ra, eps) => norm(atan2(sin(ra), cos(ra) * cos(eps)));
function placidus(ramc, phi, eps) {
  const mc = eclFromRA(ramc, eps);
  const asc = norm(atan2(cos(ramc), -(sin(ramc) * cos(eps) + tan(phi) * sin(eps))));
  const cusp = (offset, frac, nocturnal) => {
    let ra = ramc + offset;
    for (let i = 0; i < 60; i++) {
      const dec = Math.atan(tan(eps) * sin(ra)) * R2D, x = tan(dec) * tan(phi);
      if (Math.abs(x) > 1) return null;                              // за полярным кругом Плацидус не определен
      const ad = asin(x), next = nocturnal ? ramc + 180 - frac * (90 - ad) : ramc + frac * (90 + ad);
      if (Math.abs(norm(next - ra + 180) - 180) < 1e-6) { ra = next; break; } ra = next;
    }
    return eclFromRA(ra, eps);
  };
  const c11 = cusp(30, 1 / 3, false), c12 = cusp(60, 2 / 3, false), c2 = cusp(120, 2 / 3, true), c3 = cusp(150, 1 / 3, true);
  if ([c11, c12, c2, c3].some((c) => c === null)) return { system: 'Порфирий (широта за полярным кругом)', asc, mc, cusps: porphyry(asc, mc) };
  const c = [asc, c2, c3, norm(mc + 180), norm(c11 + 180), norm(c12 + 180), norm(asc + 180), norm(c2 + 180), norm(c3 + 180), mc, c11, c12];
  return { system: 'Плацидус', asc, mc, cusps: c };
}
function porphyry(asc, mc) {
  const q = norm(asc - mc) / 3, ic = norm(mc + 180), dsc = norm(asc + 180), q2 = norm(ic - asc) / 3;
  return [asc, norm(asc + q2), norm(asc + 2 * q2), ic, norm(ic + q), norm(ic + 2 * q), dsc, norm(dsc + q2), norm(dsc + 2 * q2), mc, norm(mc + q), norm(mc + 2 * q)];
}

export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
const SIGN_SYM = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
/* Склонение знаков — одно место на все приложение: «Солнце в Козероге, Луна во Льве» (предложный) и «10°41′ Козерога» (родительный) */
const SIGN_IN = { Овен: 'в Овне', Телец: 'в Тельце', Близнецы: 'в Близнецах', Рак: 'в Раке', Лев: 'во Льве', Дева: 'в Деве', Весы: 'в Весах', Скорпион: 'в Скорпионе', Стрелец: 'в Стрельце', Козерог: 'в Козероге', Водолей: 'в Водолее', Рыбы: 'в Рыбах' };
const SIGN_OF = { Овен: 'Овна', Телец: 'Тельца', Близнецы: 'Близнецов', Рак: 'Рака', Лев: 'Льва', Дева: 'Девы', Весы: 'Весов', Скорпион: 'Скорпиона', Стрелец: 'Стрельца', Козерог: 'Козерога', Водолей: 'Водолея', Рыбы: 'Рыб' };
export const inSign = (s) => SIGN_IN[s] || `в ${s}`;
export const ofSign = (s) => SIGN_OF[s] || s;
export const BODIES = [
  ['sun', 'Солнце', '☉'], ['moon', 'Луна', '☽'], ['mercury', 'Меркурий', '☿'], ['venus', 'Венера', '♀'], ['mars', 'Марс', '♂'],
  ['jupiter', 'Юпитер', '♃'], ['saturn', 'Сатурн', '♄'], ['uranus', 'Уран', '♅'], ['neptune', 'Нептун', '♆'], ['pluto', 'Плутон', '♇'], ['chiron', 'Хирон', '⚷'],
];
export const POINTS = [['lilith', 'Лилит', '⚸'], ['selena', 'Селена', '⚪'], ['node', 'Северный узел', '☊'], ['snode', 'Южный узел', '☋'], ['fortune', 'Парс Фортуны', '⊗'], ['vertex', 'Вертекс', 'Vx']];
const ASPECTS = [['conjunction', 'Соединение', 0, 8, '☌'], ['opposition', 'Оппозиция', 180, 8, '☍'], ['trine', 'Тригон', 120, 7, '△'], ['square', 'Квадрат', 90, 7, '□'], ['sextile', 'Секстиль', 60, 5, '⚹']];

function place(lon) {
  const s = Math.floor(lon / 30), d = lon - s * 30, deg = Math.floor(d), min = Math.floor((d - deg) * 60), sec = Math.round(((d - deg) * 60 - min) * 60);
  return { lon: Math.round(lon * 10000) / 10000, sign: SIGNS[s], signIn: inSign(SIGNS[s]), signOf: ofSign(SIGNS[s]), symbol: SIGN_SYM[s], signIndex: s, deg, min, sec, text: `${deg}°${String(min).padStart(2, '0')}′ ${ofSign(SIGNS[s])}` };
}
function houseOf(lon, cusps) { for (let i = 0; i < 12; i++) { const a = cusps[i], b = cusps[(i + 1) % 12]; if (norm(lon - a) < norm(b - a)) return i + 1; } return 12; }

function bodiesAt(T, JD) {
  const { dpsi, eps } = nutation(T);
  const out = {}, src = {};
  out.sun = { lon: sunLongitude(T), lat: 0 }; src.sun = 'meeus';
  const m = moonPosition(T); out.moon = { lon: norm(m.lon + dpsi), lat: m.lat, dist: m.dist }; src.moon = 'meeus';
  for (const k of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron']) {
    const t = tableLon(k, JD);
    if (t !== null) { out[k] = { lon: t, lat: 0 }; src[k] = 'jpl'; continue; }
    if (k === 'chiron') continue;                                       // вне таблицы Хирона нет
    const p = planetLongitude(k, T); out[k] = { lon: norm(p.lon + dpsi), lat: p.lat, dist: p.dist }; src[k] = 'kepler';
  }
  out.node = { lon: norm(osculatingNode(T) + dpsi), lat: 0 }; out.snode = { lon: norm(out.node.lon + 180), lat: 0 };
  out.lilith = { lon: norm(meanLilith(T) + dpsi), lat: 0 }; out.selena = { lon: selena(JD), lat: 0 };
  return { bodies: out, eps, dpsi, src };
}

/* Положения на момент времени (мс UTC): долгота, знак, ретроградность — для экрана «На небе» и напоминаний. */
export function skyAt(ms) {
  const JD = ms / 864e5 + 2440587.5;
  const d = new Date(ms);
  const JDE = JD + deltaT(d.getUTCFullYear() + d.getUTCMonth() / 12) / 86400;
  const T = (JDE - 2451545) / 36525;
  const { bodies } = bodiesAt(T, JD);
  const later = bodiesAt(T + 0.5 / 36525, JD + 0.5).bodies;
  const out = {};
  for (const [k, name, symbol] of BODIES) {
    const b = bodies[k]; if (!b) continue;
    const p = place(b.lon);
    out[k] = { key: k, name, ...p, signSymbol: p.symbol, symbol, retro: k === 'sun' || k === 'moon' ? false : norm(later[k].lon - b.lon + 180) - 180 < 0 };
  }
  const np = place(bodies.node.lon);
  out.node = { key: 'node', name: 'Северный узел', ...np, signSymbol: np.symbol, symbol: '☊', retro: false };
  return out;
}
export const ASPECT_LIST = ASPECTS;

/* Натальная карта. birth: 'YYYY-MM-DD', time: 'HH:MM' | '', tzOffsetMin: смещение местного времени от UTC в минутах, lat/lon: градусы (восток и север положительные). */
export function natalChart({ birth, time, tzOffsetMin = 0, lat = null, lon = null }) {
  const [Y, Mo, Da] = String(birth).split('-').map(Number);
  const timeKnown = /^\d{2}:\d{2}$/.test(time || '');
  const [hh, mm] = timeKnown ? time.split(':').map(Number) : [12, 0];
  const utcHours = hh + mm / 60 - tzOffsetMin / 60;
  const JD = julianDay(Y, Mo, Da, utcHours);
  const JDE = JD + deltaT(Y + (Mo - 1) / 12) / 86400;
  const T = (JDE - 2451545) / 36525;
  const { bodies, eps, src } = bodiesAt(T, JD);
  const later = bodiesAt(T + 0.5 / 36525, JD + 0.5).bodies;   // через 12 часов — для ретроградности
  const hasPlace = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
  let houses = null;
  if (timeKnown && hasPlace) {
    const ramc = norm(gmst(JD) + lon);                       // местное звездное время = RA MC
    const h = placidus(ramc, lat, eps);
    houses = { system: h.system, asc: place(h.asc), mc: place(h.mc), cusps: h.cusps.map((c, i) => ({ house: i + 1, ...place(c) })), ramc: Math.round(ramc * 100) / 100 };
  }
  const cuspLons = houses ? houses.cusps.map((c) => c.lon) : null;
  const planets = BODIES.filter(([k]) => bodies[k]).map(([k, name, sym]) => {
    const b = bodies[k], p = place(b.lon);
    const retro = ['sun', 'moon'].includes(k) ? false : norm(later[k].lon - b.lon + 180) - 180 < 0;
    return { key: k, name, symbol: sym, ...p, lat: Math.round((b.lat || 0) * 100) / 100, retro, house: cuspLons ? houseOf(b.lon, cuspLons) : null, source: src[k] };
  });
  /* точки: Парс Фортуны (день: Asc + Луна − Солнце; ночь: Asc + Солнце − Луна) и Вертекс — только при известных домах */
  if (houses) {
    const asc = houses.asc.lon, sunL = bodies.sun.lon, moonL = bodies.moon.lon;
    const day = norm(sunL - asc) >= 180;                                  // Солнце над горизонтом — в домах 7–12
    bodies.fortune = { lon: norm(day ? asc + moonL - sunL : asc + sunL - moonL), lat: 0, note: day ? 'дневная формула' : 'ночная формула' };
    bodies.vertex = { lon: norm(atan2(cos(houses.ramc + 180), -(sin(houses.ramc + 180) * cos(eps) + tan(90 - lat) * sin(eps)))), lat: 0 };
  }
  const points = POINTS.filter(([k]) => bodies[k]).map(([k, name, sym]) => {
    const b = bodies[k], p = place(b.lon);
    const retro = k === 'node' || k === 'snode' ? norm(later.node.lon - bodies.node.lon + 180) - 180 < 0 : false;
    return { key: k, name, symbol: sym, ...p, retro, note: b.note || '', house: cuspLons ? houseOf(b.lon, cuspLons) : null };
  });
  const aspects = [];
  const main = planets.filter((p) => p.key !== 'chiron');
  for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
    const d = Math.abs(norm(main[i].lon - main[j].lon + 180) - 180);
    for (const [key, name, angle, orb, sym] of ASPECTS) {
      const bonus = main[i].key === 'sun' || main[i].key === 'moon' || main[j].key === 'sun' || main[j].key === 'moon' ? 1 : 0;
      const off = Math.abs(d - angle);
      if (off <= orb + bonus) aspects.push({ a: main[i].key, b: main[j].key, aName: main[i].name, bName: main[j].name, aspect: key, name, symbol: sym, angle, orb: Math.round(off * 10) / 10 });
    }
  }
  aspects.sort((x, y) => x.orb - y.orb);
  /* без времени рождения: Луна за сутки проходит ~13°, знак может отличаться */
  let moonUncertain = false;
  if (!timeKnown) { const j0 = julianDay(Y, Mo, Da, 0 - tzOffsetMin / 60), j1 = j0 + 1; const a = bodiesAt((j0 + deltaT(Y) / 86400 - 2451545) / 36525, j0).bodies.moon.lon, b = bodiesAt((j1 + deltaT(Y) / 86400 - 2451545) / 36525, j1).bodies.moon.lon; moonUncertain = Math.floor(a / 30) !== Math.floor(b / 30); }
  return {
    input: { birth, time: timeKnown ? time : '', tzOffsetMin, lat, lon, jd: Math.round(JD * 100000) / 100000, utc: new Date((JD - 2440587.5) * 86400000).toISOString().slice(0, 16).replace('T', ' ') },
    zodiac: 'тропический (западный)', houseSystem: houses ? houses.system : null, obliquity: Math.round(eps * 10000) / 10000,
    planets, points, houses, aspects, timeKnown, hasPlace, moonUncertain,
    precision: src.mars === 'jpl' ? 'Планеты и Хирон — по эфемеридам JPL (точность около секунды дуги), Солнце и Луна — с той же точностью; узел истинный, Лилит — средний апогей, Селена — 7-летний цикл.'
      : 'Дата вне таблицы JPL (1920–2080): планеты посчитаны по кеплеровым элементам с точностью около минуты дуги, Хирон недоступен.',
  };
}
