/* Сборка справочника городов из дампов GeoNames (CC BY 4.0) в SQLite.
   Запуск: node tools/build-cities.mjs /путь/к/дампам
   Результат: backend/cities.db — его и возит деплой. */
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SRC = process.argv[2] || '/tmp/geo';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'cities.db');
if (existsSync(OUT)) unlinkSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(`
  PRAGMA journal_mode = DELETE;
  CREATE TABLE cities (
    name TEXT NOT NULL, norm TEXT NOT NULL, alt TEXT DEFAULT '',
    lat REAL NOT NULL, lon REAL NOT NULL, tz TEXT NOT NULL,
    region TEXT DEFAULT '', country TEXT DEFAULT '', cc TEXT DEFAULT '', pop INTEGER DEFAULT 0
  );
`);

const CYR = /[А-Яа-яЁё]/;
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я\s-]/gi, '').trim();

/* Русские названия стран: остальные — как в GeoNames */
const COUNTRY_RU = {
  RU:'Россия', UA:'Украина', BY:'Беларусь', KZ:'Казахстан', UZ:'Узбекистан', AZ:'Азербайджан',
  AM:'Армения', GE:'Грузия', KG:'Киргизия', TJ:'Таджикистан', TM:'Туркмения', MD:'Молдавия',
  LV:'Латвия', LT:'Литва', EE:'Эстония', DE:'Германия', FR:'Франция', GB:'Великобритания',
  IT:'Италия', ES:'Испания', US:'США', CA:'Канада', CN:'Китай', JP:'Япония', TR:'Турция',
  IL:'Израиль', AE:'ОАЭ', TH:'Таиланд', IN:'Индия', PL:'Польша', CZ:'Чехия', RS:'Сербия',
  BG:'Болгария', GR:'Греция', RO:'Румыния', HU:'Венгрия', AT:'Австрия', CH:'Швейцария',
  NL:'Нидерланды', BE:'Бельгия', SE:'Швеция', NO:'Норвегия', FI:'Финляндия', DK:'Дания',
  PT:'Португалия', VN:'Вьетнам', KR:'Южная Корея', EG:'Египет', CY:'Кипр', ME:'Черногория',
  HR:'Хорватия', SK:'Словакия', SI:'Словения', MN:'Монголия', AU:'Австралия', BR:'Бразилия',
};
const countryName = {};
for (const line of readFileSync(join(SRC, 'countryInfo.txt'), 'utf8').split('\n')) {
  if (line.startsWith('#') || !line.trim()) continue;
  const f = line.split('\t');
  countryName[f[0]] = COUNTRY_RU[f[0]] || f[4];
}

/* Регионы России: GeoNames даёт английские названия — переводим по названию,
   а НЕ по номеру: коды admin1 у GeoNames свои и с российской нумерацией не совпадают. */
const RU_REGION = {
  'Adygeya Republic':'Адыгея','Altai':'Республика Алтай','Altai Krai':'Алтайский край',
  'Amur Oblast':'Амурская область','Arkhangelskaya':'Архангельская область','Astrakhan Oblast':'Астраханская область',
  'Bashkortostan Republic':'Башкортостан','Belgorod Oblast':'Белгородская область','Bryansk Oblast':'Брянская область',
  'Buryatiya Republic':'Бурятия','Chechnya':'Чечня','Chelyabinsk':'Челябинская область','Chukotka':'Чукотка',
  'Chuvash Republic':'Чувашия','Dagestan':'Дагестан','Ingushetiya Republic':'Ингушетия',
  'Irkutsk Oblast':'Иркутская область','Ivanovo Oblast':'Ивановская область','Jewish Autonomous Oblast':'Еврейская АО',
  'Kabardino-Balkariya Republic':'Кабардино-Балкария','Kaliningrad Oblast':'Калининградская область',
  'Kalmykiya Republic':'Калмыкия','Kaluga Oblast':'Калужская область','Kamchatka':'Камчатский край',
  'Karachayevo-Cherkesiya Republic':'Карачаево-Черкесия','Karelia':'Карелия','Khabarovsk':'Хабаровский край',
  'Khakasiya Republic':'Хакасия','Khanty-Mansia':'Ханты-Мансийский АО','Kirov Oblast':'Кировская область',
  'Komi':'Коми','Kostroma Oblast':'Костромская область','Krasnodar Krai':'Краснодарский край',
  'Krasnoyarsk Krai':'Красноярский край','Kurgan Oblast':'Курганская область','Kursk Oblast':'Курская область',
  'Kuzbass':'Кемеровская область',"Leningradskaya Oblast'":'Ленинградская область','Lipetsk Oblast':'Липецкая область',
  'Magadan Oblast':'Магаданская область','Mariy-El Republic':'Марий Эл','Mordoviya Republic':'Мордовия',
  'Moscow':'Москва','Moscow Oblast':'Московская область','Murmansk':'Мурманская область','Nenets':'Ненецкий АО',
  'Nizhny Novgorod Oblast':'Нижегородская область','North Ossetia–Alania':'Северная Осетия',
  'Novgorod Oblast':'Новгородская область','Novosibirsk Oblast':'Новосибирская область','Omsk Oblast':'Омская область',
  'Orenburg Oblast':'Оренбургская область','Oryol oblast':'Орловская область','Penza Oblast':'Пензенская область',
  'Perm Krai':'Пермский край','Primorye':'Приморский край','Pskov Oblast':'Псковская область',
  'Republic of Tyva':'Тыва','Rostov':'Ростовская область','Ryazan Oblast':'Рязанская область','Sakha':'Якутия',
  'Sakhalin Oblast':'Сахалинская область','Samara Oblast':'Самарская область','Saratov Oblast':'Саратовская область',
  'Smolensk Oblast':'Смоленская область','St.-Petersburg':'Санкт-Петербург','Stavropol Kray':'Ставропольский край',
  'Sverdlovsk Oblast':'Свердловская область','Tambov Oblast':'Тамбовская область','Tatarstan Republic':'Татарстан',
  'Tomsk Oblast':'Томская область','Tula Oblast':'Тульская область','Tver Oblast':'Тверская область',
  'Tyumen Oblast':'Тюменская область','Udmurtiya Republic':'Удмуртия','Ulyanovsk':'Ульяновская область',
  'Vladimir Oblast':'Владимирская область','Volgograd Oblast':'Волгоградская область','Vologda Oblast':'Вологодская область',
  'Voronezh Oblast':'Воронежская область','Yamalo-Nenets':'Ямало-Ненецкий АО','Yaroslavl Oblast':'Ярославская область',
  'Zabaykalskiy (Transbaikal) Kray':'Забайкальский край','Crimea':'Крым','Sevastopol City':'Севастополь',
};
const admin1 = {};
for (const line of readFileSync(join(SRC, 'admin1.txt'), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 2) continue;
  const [cc, code] = f[0].split('.');
  admin1[f[0]] = cc === 'RU' ? (RU_REGION[f[1]] || f[1]) : f[1];
}

/* Из строки дампа берём русское название, если оно есть */
const RU_ONLY = /^[А-Яа-яЁё0-9\s.,'’()-]+$/;              // без æ, ў, ї, ђ и прочей нерусской кириллицы
function pick(f) {
  const official = RU_NAME.get(f[0]);
  let ru = official ? official.name : null;
  if (!ru) {                                              // запасной путь для сёл без записи в языковом файле
    const alts = (f[3] || '').split(',').filter(Boolean);
    ru = [f[1], ...alts].find((a) => CYR.test(a) && RU_ONLY.test(a) && !/^[А-Я]{2,}$/.test(a));
  }
  return { ru, lat: +f[4], lon: +f[5], tz: f[17], cc: f[8], a1: f[10], pop: +(f[14] || 0), lat_name: f[1] };
}

/* Официальные русские названия (alternateNamesV2, isolanguage=ru).
   Без него «Москва» превращается в осетинское «Мæскуы»: в alternatenames
   лежат имена на всех языках подряд, и первое кириллическое — лотерея. */
const RU_NAME = new Map();
if (existsSync(join(SRC, 'ru-names.txt'))) {
  for (const line of readFileSync(join(SRC, 'ru-names.txt'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 4) continue;
    const [, gid, , name, , isPref, isShort, isColloq, isHist] = f;
    if (isColloq === '1' || isHist === '1') continue;      // прозвища и устаревшие — мимо
    const cur = RU_NAME.get(gid);
    const rank = (isPref === '1' ? 2 : 0) + (isShort === '1' ? 1 : 0);
    if (!cur || rank > cur.rank) RU_NAME.set(gid, { name, rank });
  }
  console.log(`русских названий: ${RU_NAME.size}`);
}

const ins = db.prepare('INSERT INTO cities (name, norm, alt, lat, lon, tz, region, country, cc, pop) VALUES (?,?,?,?,?,?,?,?,?,?)');
const seen = new Set();
let added = 0, skipped = 0;
function feed(file, { requireRu = false } = {}) {
  if (!existsSync(join(SRC, file))) return;
  db.exec('BEGIN');
  for (const line of readFileSync(join(SRC, file), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 19 || f[6] !== 'P') continue;          // P = населённый пункт
    if (f[7] === 'PPLX' || f[7] === 'PPLW') continue;      // район города и исчезнувший н.п.
    const c = pick(f);
    if (!c.tz || !isFinite(c.lat)) continue;
    const name = c.ru || c.lat_name;
    if (requireRu && !c.ru) { skipped++; continue; }
    const key = `${norm(name)}|${c.lat.toFixed(2)}|${c.lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ins.run(name, norm(name), c.ru && c.lat_name !== c.ru ? norm(c.lat_name) : '',
      c.lat, c.lon, c.tz, admin1[`${c.cc}.${c.a1}`] || '', countryName[c.cc] || c.cc, c.cc, c.pop);
    added++;
  }
  db.exec('COMMIT');
}

for (const cc of ['RU','UA','BY','KZ','UZ','AZ','AM','GE','KG','TJ','TM','MD','LV','LT','EE']) feed(`${cc}.txt`);
feed('cities1000.txt');                                   // остальной мир

db.exec('CREATE INDEX idx_norm ON cities (norm)');
db.exec('CREATE INDEX idx_alt ON cities (alt)');
db.exec('VACUUM');
const n = db.prepare('SELECT COUNT(*) c FROM cities').get().c;
const countries = db.prepare('SELECT COUNT(DISTINCT cc) c FROM cities').get().c;
console.log(`готово: ${n} населённых пунктов из ${countries} стран (пропущено без названия: ${skipped})`);
