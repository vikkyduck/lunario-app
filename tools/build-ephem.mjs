/* Собирает таблицу видимых эклиптических долгот планет и Хирона из JPL Horizons
   (эклиптика даты, геоцентр, с аберрацией и световым временем — то, что нужно астрологии).
   Результат — backend/ephem.bin: Int32 (долгота × 10000) подряд по телам, плюс backend/ephem.json с раскладкой.
   Запуск: node tools/build-ephem.mjs   (нужен интернет; ~2 минуты). В репозиторий кладём готовый bin —
   серверу интернет не нужен. Данные JPL — общественное достояние. */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const START = '1920-01-01', STOP = '2080-01-01';
const BODIES = [
  ['mercury', '199', 1], ['venus', '299', 1], ['mars', '499', 1],
  ['jupiter', '599', 4], ['saturn', '699', 4], ['uranus', '799', 4], ['neptune', '899', 4], ['pluto', '999', 4], ['chiron', '2060', 4],
];
const jd = (s) => { const [y, m, d] = s.split('-').map(Number); const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 - 0.5; };

const index = { start: START, jd0: jd(START), bodies: {} };
const chunks = []; let offset = 0;
for (const [name, id, step] of BODIES) {
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='${id}'&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&CENTER='500@399'&START_TIME='${START}'&STOP_TIME='${STOP}'&STEP_SIZE='${step}%20d'&QUANTITIES='31'&CAL_FORMAT='JD'&ANG_FORMAT='DEG'&APPARENT='AIRLESS'&CSV_FORMAT='YES'`;
  process.stdout.write(`${name} … `);
  const text = await (await fetch(url)).text();
  const m = text.match(/\$\$SOE\n([\s\S]*?)\$\$EOE/); if (!m) { console.log('нет данных:', text.slice(0, 300)); process.exit(1); }
  const rows = m[1].trim().split('\n').map((l) => l.split(',').map((s) => s.trim()));
  const lons = rows.map((r) => Math.round(Number(r[3]) * 10000));
  const jdFirst = Number(rows[0][0]), jdLast = Number(rows[rows.length - 1][0]);
  const buf = new Int32Array(lons); chunks.push(Buffer.from(buf.buffer));
  index.bodies[name] = { offset, n: lons.length, step, jd0: jdFirst, jd1: jdLast };
  offset += lons.length;
  console.log(`${lons.length} точек, шаг ${step} д, JD ${jdFirst}–${jdLast}`);
}
writeFileSync(join(OUT, 'ephem.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'ephem.json'), JSON.stringify(index));
console.log('готово:', (offset * 4 / 1024).toFixed(0), 'КБ');
