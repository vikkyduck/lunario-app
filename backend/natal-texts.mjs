/* Значения натальной карты — из контента, и резюме карты по правилам (без ИИ).

   Тексты пишет владелица в кабинете «Контент» → «Тексты», отдельными файлами или одним:
     планеты-в-знаках.txt   планета | знак | текст | суть
     планеты-в-домах.txt    планета | дом (1–12) | текст | суть
     аспекты.txt            планета | аспект | планета | текст | суть   (порядок планет не важен)
     точки-в-знаках.txt     точка | знак | текст | суть                 (Асцендент, MC, Лилит, Селена, узлы, Парс Фортуны, Вертекс)
     баланс-карты.txt       вид | значение | текст | суть               (стихия, нехватка, крест, стеллиум)
     натальная-карта.txt    все то же в одном файле: вид | … (см. заголовок файла)
   «Суть» — одна строка, из нее собирается резюме; если ее нет, берется первое предложение текста.

   Резюме — выводы по карте по правилам: ведущая стихия и крест (по десяти планетам от Солнца до Плутона), чего не хватает,
   стеллиум (три и больше планет в одном знаке), Солнце, Луна и Асцендент в знаках, Солнце и Луна в домах,
   три самых точных аспекта. Показывается на экране «Натальная карта» первым и ложится в базу знаний («Обо мне»). */

export const ELEMENT_OF = { 'Овен': 'огонь', 'Лев': 'огонь', 'Стрелец': 'огонь', 'Телец': 'земля', 'Дева': 'земля', 'Козерог': 'земля',
  'Близнецы': 'воздух', 'Весы': 'воздух', 'Водолей': 'воздух', 'Рак': 'вода', 'Скорпион': 'вода', 'Рыбы': 'вода' };
export const MODALITY_OF = { 'Овен': 'кардинальный', 'Рак': 'кардинальный', 'Весы': 'кардинальный', 'Козерог': 'кардинальный',
  'Телец': 'фиксированный', 'Лев': 'фиксированный', 'Скорпион': 'фиксированный', 'Водолей': 'фиксированный',
  'Близнецы': 'мутабельный', 'Дева': 'мутабельный', 'Стрелец': 'мутабельный', 'Рыбы': 'мутабельный' };
const CLASSICAL = new Set(['Солнце', 'Луна', 'Меркурий', 'Венера', 'Марс', 'Юпитер', 'Сатурн', 'Уран', 'Нептун', 'Плутон']);
const ELEMENTS = ['огонь', 'земля', 'воздух', 'вода'], MODALITIES = ['кардинальный', 'фиксированный', 'мутабельный'];
const key = (...a) => a.map((x) => String(x ?? '').trim().toLowerCase()).join('|');
const houseNo = (h) => { const m = String(h ?? '').match(/\d+/); return m ? Number(m[0]) : 0; };
const firstSentence = (t) => { const s = String(t || '').trim(); const m = s.match(/^(.{20,160}?[.!?…])(\s|$)/); return (m ? m[1] : s.slice(0, 140)).replace(/[.]+$/, ''); };
const ordinal = (n) => `${n}-й`;

/* Читает все файлы значений в одну структуру: {planetSign, planetHouse, aspect, pointSign, balance} → {текст, суть} */
export function loadNatalTexts(rows) {
  const T = { planetSign: {}, planetHouse: {}, aspect: {}, pointSign: {}, balance: {} };
  const put = (m, k, text, gist) => { if (text) m[k] = { text: String(text).trim(), gist: String(gist || '').trim() }; };
  for (const c of rows('планеты-в-знаках.txt', 3) || []) put(T.planetSign, key(c[0], c[1]), c[2], c[3]);
  for (const c of rows('планеты-в-домах.txt', 3) || []) put(T.planetHouse, key(c[0], houseNo(c[1])), c[2], c[3]);
  for (const c of rows('аспекты.txt', 4) || []) put(T.aspect, key(c[0], c[1], c[2]), c[3], c[4]);
  for (const c of rows('точки-в-знаках.txt', 3) || []) put(T.pointSign, key(c[0], c[1]), c[2], c[3]);
  for (const c of rows('баланс-карты.txt', 3) || []) put(T.balance, key(c[0], c[1]), c[2], c[3]);
  /* один файл на все: вид | кто | где | [с кем] | текст | суть — пустая ячейка «с кем» у не-аспектов допускается */
  for (const c of rows('натальная-карта.txt', 3) || []) {
    const kind = String(c[0]).trim().toLowerCase(), rest = c.slice(1);
    if (kind === 'аспект') { put(T.aspect, key(rest[0], rest[1], rest[2]), rest[3], rest[4]); continue; }
    const who = rest[0], where = rest[1], tail = rest.slice(2); if (tail[0] === '') tail.shift();
    if (kind === 'планета-в-знаке') put(T.planetSign, key(who, where), tail[0], tail[1]);
    else if (kind === 'планета-в-доме') put(T.planetHouse, key(who, houseNo(where)), tail[0], tail[1]);
    else if (kind === 'точка' || kind === 'точка-в-знаке') put(T.pointSign, key(who, where), tail[0], tail[1]);
    else if (kind === 'баланс') put(T.balance, key(who, where), tail[0], tail[1]);
  }
  return T;
}

/* Значения к рассчитанной карте и резюме. chart — как отдает astro.natalChart(); T — loadNatalTexts() */
export function natalMeanings(chart, T) {
  const g = (m, k) => (m && m[k]) || null;
  const gist = (e) => (e ? (e.gist || firstSentence(e.text)) : '');
  const planets = (chart.planets || []).map((p) => {
    const inSign = g(T.planetSign, key(p.name, p.sign)), inHouse = p.house ? g(T.planetHouse, key(p.name, p.house)) : null;
    return { key: p.key, name: p.name, sign: p.sign, signIn: p.signIn, degree: String(p.text || '').split(' ')[0], house: p.house || null, retro: !!p.retro,
      inSign: inSign ? { title: `${p.name} ${p.signIn}`, text: inSign.text, gist: gist(inSign) } : null,
      inHouse: inHouse ? { title: `${p.name} в ${ordinal(p.house)} доме`, text: inHouse.text, gist: gist(inHouse) } : null };
  });
  const pointList = [];
  if (chart.houses) pointList.push({ name: 'Асцендент', sign: chart.houses.asc.sign, signIn: chart.houses.asc.signIn, degree: String(chart.houses.asc.text || '').split(' ')[0] }, { name: 'MC', sign: chart.houses.mc.sign, signIn: chart.houses.mc.signIn, degree: String(chart.houses.mc.text || '').split(' ')[0] });
  for (const p of chart.points || []) pointList.push({ name: p.name, sign: p.sign, signIn: p.signIn, degree: String(p.text || '').split(' ')[0], house: p.house || null });
  const points = pointList.map((p) => { const e = g(T.pointSign, key(p.name, p.sign)); return { ...p, meaning: e ? { title: `${p.name} ${p.signIn || 'в ' + p.sign}`, text: e.text, gist: gist(e) } : null }; });
  const aspects = (chart.aspects || []).map((a) => { const e = g(T.aspect, key(a.aName, a.name, a.bName)) || g(T.aspect, key(a.bName, a.name, a.aName)); return { a: a.aName, b: a.bName, aspect: a.name, symbol: a.symbol, angle: a.angle, orb: a.orb, meaning: e ? { title: `${a.aName} ${String(a.name).toLowerCase()} ${a.bName}`, text: e.text, gist: gist(e) } : null }; });

  /* баланс: стихии и кресты по десяти классическим планетам */
  const classical = planets.filter((p) => CLASSICAL.has(p.name));
  const count = (map, list) => { const c = Object.fromEntries(list.map((x) => [x, 0])); for (const p of classical) { const v = map[p.sign]; if (v) c[v]++; } return c; };
  const elements = count(ELEMENT_OF, ELEMENTS), modalities = count(MODALITY_OF, MODALITIES);
  const prefer = (c, list) => { const max = Math.max(...list.map((x) => c[x])); const top = list.filter((x) => c[x] === max); if (top.length === 1) return top[0];
    const sun = classical.find((p) => p.name === 'Солнце'), moon = classical.find((p) => p.name === 'Луна');   /* при равенстве — стихия Солнца, потом Луны */
    for (const p of [sun, moon]) { const v = p && (list === ELEMENTS ? ELEMENT_OF : MODALITY_OF)[p.sign]; if (v && top.includes(v)) return v; } return top[0]; };
  const bySign = {}; for (const p of classical) bySign[p.sign] = (bySign[p.sign] || 0) + 1;
  const balance = { elements, modalities, dominant: classical.length ? prefer(elements, ELEMENTS) : '', lacking: ELEMENTS.filter((e) => elements[e] === 0), modality: classical.length ? prefer(modalities, MODALITIES) : '',
    stellium: Object.entries(bySign).filter(([, n]) => n >= 3).map(([s]) => s) };

  /* резюме: выводы по правилам, словами из контента */
  const summary = [];
  const add = (title, e) => { if (e) summary.push({ title, gist: gist(e), text: e.text }); };
  if (balance.dominant) add(`Ведущая стихия — ${balance.dominant}`, g(T.balance, key('стихия', balance.dominant)));
  for (const el of balance.lacking) add(`Не хватает: ${el}`, g(T.balance, key('нехватка', el)));
  if (balance.modality) add(`Ведущий крест — ${balance.modality}`, g(T.balance, key('крест', balance.modality)));
  for (const s of balance.stellium) add(`Стеллиум в ${s}`, g(T.balance, key('стеллиум', s)));
  for (const name of ['Солнце', 'Луна']) { const p = planets.find((x) => x.name === name); if (p?.inSign) summary.push({ title: p.inSign.title, gist: p.inSign.gist, text: p.inSign.text }); }
  const asc = points.find((x) => x.name === 'Асцендент'); if (asc?.meaning) summary.push({ title: asc.meaning.title, gist: asc.meaning.gist, text: asc.meaning.text });
  for (const name of ['Солнце', 'Луна']) { const p = planets.find((x) => x.name === name); if (p?.inHouse) summary.push({ title: p.inHouse.title, gist: p.inHouse.gist, text: p.inHouse.text }); }
  for (const a of aspects.filter((x) => x.meaning).slice(0, 3)) summary.push({ title: a.meaning.title, gist: a.meaning.gist, text: a.meaning.text });

  const hasTexts = summary.length > 0 || planets.some((p) => p.inSign || p.inHouse) || points.some((p) => p.meaning) || aspects.some((a) => a.meaning);
  return { summary, balance, planets, points, aspects, hasTexts };
}
