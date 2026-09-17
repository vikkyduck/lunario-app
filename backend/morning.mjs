/* Утро: тема дня, настрой и вопрос к нему, карта и руна дня.
   Общий модуль для сервера (пакет дня на «Сегодня») и планировщика напоминаний (утренний пуш): оба должны считать
   одно и то же. Тему задаёт первый выбранный источник — карта → руна → влияние планет (главное событие неба) → тон дня;
   выбранные карта и руна тянутся сами при первом открытии дня. Настрой к теме — из настрой.txt без повторов в течение года (daily_sets), тема исчерпана —
   по второму кругу. Выпавшая пара снимается на день и в течение дня не меняется. Зависимости — явным объектом. */
import { randomInt } from 'node:crypto';
import { dailySet } from './daily-sets.mjs';
import { preferences, morningOf } from './experience.mjs';
import { skyNow } from './sky.mjs';

/* Главное событие неба на день — одно и то же для темы дня, строки утреннего пуша и подписи плитки «Влияние планет»:
   фаза (new/q1/full/q3) → затмение → начало ретроградности; в обычный день — первая уже ретроградная планета; тихое небо — null.
   key — код строки «небо | …» из темы-источников.txt, title — как сказать человеку. Эфемериды считаются раз в день на процесс. */
const skyDays = new Map();
export function skyEventOf(day) {
  if (skyDays.has(day)) return skyDays.get(day);
  let out = null;
  try {
    const s = skyNow(Date.parse(day + 'T09:00:00Z'));
    const ev = s.today.find((e) => ['new', 'q1', 'full', 'q3'].includes(e.type)) || s.today.find((e) => e.type === 'eclipse') || s.today.find((e) => e.type === 'retro');
    if (ev) out = { key: ev.type === 'eclipse' ? `затмение ${ev.kind}` : ev.type === 'retro' ? `ретро ${ev.planet}` : `фаза ${ev.type}`, title: ev.title };
    else if (s.retro.length) out = { key: `ретро ${s.retro[0].key}`, title: `${s.retro[0].name} — ${s.retro[0].adj}` };
  } catch { out = null; }
  if (skyDays.size > 64) skyDays.clear();
  skyDays.set(day, out);
  return out;
}
export const skyKeyOf = (day) => skyEventOf(day)?.key || null;

export function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const parseData = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
/* Случайные и без повторов внутри одного расклада — как из настоящей колоды или мешочка. */
export function drawDistinct(list, n) {
  const idx = [...Array(list.length).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, Math.min(n, idx.length)).map((i) => list[i]);
}

export function createMorning({ db, C, track, nowISO, today }) {   /* today(u) — день человека по его поясу */
  const toneOfDay = (u, day) => C.DAY_TONES[hash32(`${u.id}:${day}:tone`) % C.DAY_TONES.length];
  const lastEntry = (u, day, kind) => db.prepare('SELECT data FROM entries WHERE user_id=? AND day=? AND kind=? ORDER BY id DESC LIMIT 1').get(u.id, day, kind);
  const cardOfDay = (u, day) => { const slug = (parseData(lastEntry(u, day, 'card')?.data) || {}).card; return slug ? [...C.ARCANA].find((c) => c.slug === slug) || null : null; };
  const runeOfDay = (u, day) => { const slug = (parseData(lastEntry(u, day, 'dayrune')?.data) || {}).rune; return slug ? [...C.RUNES].find((r) => r.slug === slug) || null : null; };
  const chosenOf = (u) => morningOf(preferences(u.preferences));
  /* Утренняя карта и руна — по дню и человеку, а не из случайного мешочка: так план уведомлений на две недели вперёд
     (телефон) считает те же карты, что утром вытянет /me, и настрой снимается под них. Ручная вытяжка (/api/card) остаётся случайной. */
  const pickOf = (u, day, kind, list) => list[hash32(`${u.id}:${day}:${kind}`) % list.length];
  const cardFor = (u, day) => cardOfDay(u, day) || (day > today(u) && chosenOf(u).includes('card') ? pickOf(u, day, 'card', [...C.ARCANA]) : null);
  const runeFor = (u, day) => runeOfDay(u, day) || (day > today(u) && chosenOf(u).includes('dayrune') ? pickOf(u, day, 'dayrune', [...C.RUNES]) : null);

  /* Выбранные карта и руна тянутся сами — чтобы тема дня была известна с утра, а не после клика.
     Запись помечена auto: в «Мои вопросы и ответы» она не показывается, пока человек её не открыл; событие — «вытянута», не «открыл». */
  function drawMorning(u, day) {
    if (day !== today(u)) return;
    const chosen = chosenOf(u);
    if (chosen.includes('card') && !cardOfDay(u, day)) {
      const a = pickOf(u, day, 'card', [...C.ARCANA]);
      db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)').run(u.id, nowISO(), day, 'card', '', a.name, a.keys, JSON.stringify({ card: a.slug, auto: 1 }));
      track(u, 'card_draw', a.slug);
    }
    if (chosen.includes('dayrune') && !runeOfDay(u, day)) {
      const r = pickOf(u, day, 'dayrune', [...C.RUNES]);
      db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)').run(u.id, nowISO(), day, 'dayrune', '', r.name, r.answer, JSON.stringify({ rune: r.slug, layout: 'one', runes: [r.slug], auto: 1 }));
      track(u, 'dayrune_draw', r.slug);
    }
  }
  /* Тема дня — по первому выбранному источнику: карта → руна → влияние планет → тон дня; без выбора — тон дня.
     Для будущих дней (план телефона) карта и руна берутся те, что вытянутся в тот день. */
  function themeOfDay(u, day) {
    const chosen = chosenOf(u);
    let key = null;
    if (chosen.includes('card')) { const c = cardFor(u, day); if (c) key = C.themeOf('карта', c.slug); }
    if (!key && chosen.includes('dayrune')) { const r = runeFor(u, day); if (r) key = C.themeOf('руна', r.slug); }
    if (!key && chosen.includes('sky')) { const k = skyKeyOf(day); if (k) key = C.themeOf('небо', k); }
    if (!key) key = C.themeOf('тон', toneOfDay(u, day)[0]) || [...C.THEMES][0]?.key || null;
    return [...C.THEMES].find((t) => t.key === key) || null;
  }
  function setOfDay(u, day) {
    const theme = themeOfDay(u, day), all = [...C.NASTROY], key = theme ? theme.key : '';
    const pool = (theme ? all.filter((n) => n[0] === theme.key) : all).map((n, i) => [i + 1, n[1], n[2]]);
    return (pool.length && (dailySet(db, u, day, pool, { theme: key }) || dailySet(db, u, day, pool, { allowRepeat: true, theme: key })))
      || (all.length ? dailySet(db, u, day, all.map((n, i) => [i + 1, n[1], n[2]]), { allowRepeat: true }) : null);
  }
  /* тема уже выпавшего настроя: в течение дня не меняется, даже если днём выбрать другой источник.
     Ключ темы хранится вместе с парой; для старых пар без ключа — по тексту строки (без подстановки имени) */
  function themeFor(u, day, set) {
    const themes = [...C.THEMES];
    const stored = set?.theme ? themes.find((t) => t.key === set.theme) : null;
    if (stored) return stored;
    const raw = (t) => String(t || '').replace(/,?\s*\{Имя\}/g, '').replace(/\s+([,.!?])/g, '$1').trim();
    const byText = set ? [...C.NASTROY].find((n) => raw(n[1]) === raw(set.statement || set.text)) : null;
    return (byText && themes.find((t) => t.key === byText[0])) || themeOfDay(u, day);
  }
  /* Откуда взялась тема дня — для строки над настроем («Тихий день · по карте дня»): первый выбранный источник, чья тема совпала;
     карта/руна, если их не выбирали, тему не задают; ничего не совпало — прогноз (тон дня) */
  function themeSource(u, day, theme) {
    if (!theme) return 'tone';
    const chosen = chosenOf(u);
    if (chosen.includes('card')) { const c = cardFor(u, day); if (c && C.themeOf('карта', c.slug) === theme.key) return 'card'; }
    if (chosen.includes('dayrune')) { const r = runeFor(u, day); if (r && C.themeOf('руна', r.slug) === theme.key) return 'dayrune'; }
    if (chosen.includes('sky')) { const k = skyKeyOf(day); if (k && C.themeOf('небо', k) === theme.key) return 'sky'; }
    return 'tone';
  }
  /* открыл ли человек утреннюю карту/руну сам (пометка auto снимается при открытии) */
  const openedOf = (u, day, kind) => { const row = lastEntry(u, day, kind); return !!row && !(parseData(row.data) || {}).auto; };
  /* лёгкий пакет утра — для утреннего пуша, плана телефона и подписей плиток; будущие дни считаются без записи в базу карт и рун */
  function pack(u, day) {
    drawMorning(u, day);
    const set = setOfDay(u, day), theme = themeFor(u, day, set), tone = toneOfDay(u, day);
    return { day, set, theme: theme ? { key: theme.key, title: theme.title, source: themeSource(u, day, theme) } : null, chosen: chosenOf(u), card: cardFor(u, day), rune: runeFor(u, day),
      sky: skyEventOf(day), forecast: { title: tone[0], text: tone[1] }, question: (set || {}).question || '' };
  }
  return { toneOfDay, cardOfDay, runeOfDay, cardFor, runeFor, openedOf, drawMorning, themeOfDay, themeSource, setOfDay, themeFor, pack };
}
