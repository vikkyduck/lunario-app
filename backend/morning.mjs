/* Утро: тема дня, настрой и вопрос к нему, карта и руна дня.
   Общий модуль для сервера (пакет дня на «Сегодня») и планировщика напоминаний (утренний пуш): оба должны считать
   одно и то же. Тему задаёт первый выбранный источник — карта → руна → влияние планет (главное событие неба) → тон дня;
   выбранные карта и руна тянутся сами при первом открытии дня. Настрой к теме — из настрой.txt без повторов в течение года (daily_sets), тема исчерпана —
   по второму кругу. Выпавшая пара снимается на день и в течение дня не меняется. Зависимости — явным объектом. */
import { randomInt } from 'node:crypto';
import { dailySet } from './daily-sets.mjs';
import { preferences, morningOf } from './experience.mjs';
import { skyNow } from './sky.mjs';

/* Главное событие неба на день — код строки «небо | …» из темы-источников.txt: фаза (new/q1/full/q3) → затмение → начало
   ретроградности; в обычный день — первая уже ретроградная планета; тихое небо — null. Эфемериды считаются раз в день на процесс. */
const skyKeys = new Map();
export function skyKeyOf(day) {
  if (skyKeys.has(day)) return skyKeys.get(day);
  let key = null;
  try {
    const s = skyNow(Date.parse(day + 'T09:00:00Z'));
    const ev = s.today.find((e) => ['new', 'q1', 'full', 'q3'].includes(e.type)) || s.today.find((e) => e.type === 'eclipse') || s.today.find((e) => e.type === 'retro');
    if (ev) key = ev.type === 'eclipse' ? `затмение ${ev.kind}` : ev.type === 'retro' ? `ретро ${ev.planet}` : `фаза ${ev.type}`;
    else if (s.retro.length) key = `ретро ${s.retro[0].key}`;
  } catch { key = null; }
  if (skyKeys.size > 64) skyKeys.clear();
  skyKeys.set(day, key);
  return key;
}

export function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const parseData = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
/* Случайные и без повторов внутри одного расклада — как из настоящей колоды или мешочка. */
export function drawDistinct(list, n) {
  const idx = [...Array(list.length).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, Math.min(n, idx.length)).map((i) => list[i]);
}

export function createMorning({ db, C, track, nowISO, today }) {
  const toneOfDay = (u, day) => C.DAY_TONES[hash32(`${u.id}:${day}:tone`) % C.DAY_TONES.length];
  const lastEntry = (u, day, kind) => db.prepare('SELECT data FROM entries WHERE user_id=? AND day=? AND kind=? ORDER BY id DESC LIMIT 1').get(u.id, day, kind);
  const cardOfDay = (u, day) => { const slug = (parseData(lastEntry(u, day, 'card')?.data) || {}).card; return slug ? [...C.ARCANA].find((c) => c.slug === slug) || null : null; };
  const runeOfDay = (u, day) => { const slug = (parseData(lastEntry(u, day, 'dayrune')?.data) || {}).rune; return slug ? [...C.RUNES].find((r) => r.slug === slug) || null : null; };
  const chosenOf = (u) => morningOf(preferences(u.preferences));

  /* Выбранные карта и руна тянутся сами — чтобы тема дня была известна с утра, а не после клика */
  function drawMorning(u, day) {
    if (day !== today()) return;
    const chosen = chosenOf(u);
    if (chosen.includes('card') && !cardOfDay(u, day)) {
      const a = drawDistinct([...C.ARCANA], 1)[0];
      db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)').run(u.id, nowISO(), day, 'card', '', a.name, a.keys, JSON.stringify({ card: a.slug }));
      track(u, 'card_open', a.slug);
    }
    if (chosen.includes('dayrune') && !runeOfDay(u, day)) {
      const r = drawDistinct([...C.RUNES], 1)[0];
      db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)').run(u.id, nowISO(), day, 'dayrune', '', r.name, r.answer, JSON.stringify({ rune: r.slug, layout: 'one', runes: [r.slug] }));
      track(u, 'dayrune_open', r.slug);
    }
  }
  /* Тема дня — по первому выбранному источнику: карта → руна → влияние планет → тон дня; без выбора — тон дня */
  function themeOfDay(u, day) {
    const chosen = chosenOf(u);
    let key = null;
    if (chosen.includes('card')) { const c = cardOfDay(u, day); if (c) key = C.themeOf('карта', c.slug); }
    if (!key && chosen.includes('dayrune')) { const r = runeOfDay(u, day); if (r) key = C.themeOf('руна', r.slug); }
    if (!key && chosen.includes('sky')) { const k = skyKeyOf(day); if (k) key = C.themeOf('небо', k); }
    if (!key) key = C.themeOf('тон', toneOfDay(u, day)[0]) || [...C.THEMES][0]?.key || null;
    return [...C.THEMES].find((t) => t.key === key) || null;
  }
  function setOfDay(u, day) {
    const theme = themeOfDay(u, day), all = [...C.NASTROY];
    const pool = (theme ? all.filter((n) => n[0] === theme.key) : all).map((n, i) => [i + 1, n[1], n[2]]);
    return (pool.length && (dailySet(db, u, day, pool) || dailySet(db, u, day, pool, { allowRepeat: true }))) || (all.length ? dailySet(db, u, day, all.map((n, i) => [i + 1, n[1], n[2]]), { allowRepeat: true }) : null);
  }
  /* тема уже выпавшего настроя: в течение дня не меняется, даже если днём выбрать другой источник */
  function themeFor(u, day, set) {
    const byText = set ? [...C.NASTROY].find((n) => n[1] === set.text) : null;
    return (byText && [...C.THEMES].find((t) => t.key === byText[0])) || themeOfDay(u, day);
  }
  /* лёгкий пакет утра — для утреннего пуша и локальных уведомлений телефона */
  function pack(u, day) {
    drawMorning(u, day);
    const set = setOfDay(u, day), theme = themeFor(u, day, set), tone = toneOfDay(u, day);
    return { day, set, theme: theme ? { key: theme.key, title: theme.title } : null, chosen: chosenOf(u), card: cardOfDay(u, day), rune: runeOfDay(u, day),
      forecast: { title: tone[0], text: tone[1] }, question: (set || {}).question || '' };
  }
  return { toneOfDay, cardOfDay, runeOfDay, drawMorning, themeOfDay, setOfDay, themeFor, pack };
}
