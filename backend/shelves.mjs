/* Лунарио — «полочки»: личное досье каждого человека.

   Всё, что приложение знает о человеке, раскладывается по трём полкам —
   «Обо мне», «Мой день», «Истории» — и лежит в таблице shelves: одна запись на полку.
   Собирается из тех же таблиц, что и экраны (users, entries, moods, journal, wishes,
   habits, askesis), пересобирается после каждого действия и не позже начала нового дня.
   Личные тексты внутри зашифрованы тем же ключом, что дневник.

   Это единый источник контекста для гаданий и гороскопов: context() отдаёт досье
   объектом, contextText() — текстом для ИИ. Почты и идентификаторов в тексте нет.
   Сюда никогда не попадает ничего чужого: только то, что человек сам оставил в приложении. */

const ELEMENT = {
  'Овен': 'огонь', 'Лев': 'огонь', 'Стрелец': 'огонь',
  'Телец': 'земля', 'Дева': 'земля', 'Козерог': 'земля',
  'Близнецы': 'воздух', 'Весы': 'воздух', 'Водолей': 'воздух',
  'Рак': 'вода', 'Скорпион': 'вода', 'Рыбы': 'вода',
};
/* «Солнце в Овне»: знак в предложном падеже для текста досье */
const IN_SIGN = { 'Овен': 'Овне', 'Телец': 'Тельце', 'Близнецы': 'Близнецах', 'Рак': 'Раке', 'Лев': 'Льве', 'Дева': 'Деве', 'Весы': 'Весах',
  'Скорпион': 'Скорпионе', 'Стрелец': 'Стрельце', 'Козерог': 'Козероге', 'Водолей': 'Водолее', 'Рыбы': 'Рыбах' };
const inSign = (n) => IN_SIGN[n] || n;
const TOPIC_RU = { work: 'работа', money: 'деньги', love: 'отношения', health: 'здоровье', move: 'дом и переезд', study: 'учёба', self: 'о себе' };
const KIND_RU = { yesno: '«Да / Нет»', rune: 'руна', runes: 'расклад рун', spread: 'расклад Таро', card: 'карта дня' };
const SHELVES = ['about', 'day', 'history'];

const dayShift = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const fmt = (d) => (d ? String(d).split('-').reverse().join('.') : '');
const short = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

/* deps — то, что уже есть в server.mjs: база, шифрование, тексты и расчёты. Модуль ничего не дублирует. */
export function createShelves(deps) {
  const { db, seal, open, C, signOf, destinyNum, personalYearAt, dayNum, topicOf, ageBand, hasPlus, cardOfDay, dayPack, habitList, askesisList, natal, MOOD_RU, nowISO } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS shelves (
      user_id INTEGER NOT NULL, shelf TEXT NOT NULL,
      json TEXT NOT NULL, day TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, shelf)
    );
  `);
  const put = db.prepare('INSERT INTO shelves (user_id, shelf, json, day, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, shelf) DO UPDATE SET json = excluded.json, day = excluded.day, updated_at = excluded.updated_at');
  const get = db.prepare('SELECT shelf, json, day, updated_at FROM shelves WHERE user_id = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');

  /* ── «Обо мне»: анкета и всё, что из неё считается ── */
  const readingInterests = (u) => {
    let topics = []; try { topics = JSON.parse(u.preferences || '{}').topics || []; } catch { topics = []; }
    return topics.filter((k) => !['symbol', 'advice', 'live'].includes(k)).map((k) => { const t = [...C.READING_TOPICS].find((x) => x.key === k); return t ? t.label : ''; }).filter(Boolean);
  };
  function buildAbout(u, d) {
    const birthOk = /^\d{4}-\d{2}-\d{2}$/.test(u.birth || '');
    const sign = birthOk ? signOf(u.birth) : null;
    const about = {
      name: u.name || '', email: u.email || '', birth: u.birth || '', birthTime: u.birth_time || '',
      city: u.city || '', region: u.city_region || '', tz: u.tz || '', age: birthOk ? ageBand(u.birth) : '',
      sign: sign ? { name: sign.name, element: ELEMENT[sign.name] || '', trait: sign.trait } : null,
      destiny: null, year: null, natal: null,
      since: (u.created_at || '').slice(0, 10), lastSeen: (u.last_seen || '').slice(0, 10), streak: u.streak || 0,
      plus: hasPlus(u), plusUntil: u.plus_until || '', invited: !!u.invited_by,
      interests: readingInterests(u),   // темы чтения, которые человек выбрал сам — явный сигнал интересов
    };
    if (birthOk) {
      const dn = destinyNum(u.birth), py = personalYearAt(u.birth, d), info = C.YEARS[py.n] || null;
      about.destiny = { n: dn, title: (C.NUM_DESTINY[dn] || [])[0] || '', text: (C.NUM_DESTINY[dn] || [])[1] || '' };
      about.year = { n: py.n, from: py.from, to: py.to, next: py.next, text: C.NUM_YEAR[py.n] || '',
        planet: info ? info.planet : '', energy: info ? info.energy : '', caption: info ? info.caption : '' };
      try {
        const ch = natal(u);   // Солнце, Луна и Асцендент — достаточно для контекста, полная карта считается на экране
        if (ch) {
          const pick = (n) => (ch.planets || []).find((p) => p.name === n);
          const sun = pick('Солнце'), moon = pick('Луна'), asc = ch.houses && ch.houses.cusps ? ch.houses.cusps[0] : null;
          about.natal = { sun: sun ? sun.sign : '', moon: moon ? moon.sign : '', moonUncertain: !!ch.moonUncertain, asc: asc ? asc.sign : '', timeKnown: !!ch.timeKnown, houses: !!ch.houses };
        }
      } catch { about.natal = null; }
    }
    return about;
  }

  /* ── «Мой день»: сегодня и последняя неделя ── */
  function buildDay(u, d) {
    const pack = dayPack(u, d);
    const moodOf = (day) => (db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, day) || {}).mood || '';
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = dayShift(d, -i);
      const card = db.prepare("SELECT title FROM entries WHERE user_id = ? AND day = ? AND kind = 'card' ORDER BY id DESC LIMIT 1").get(u.id, day);
      week.push({
        day, mood: moodOf(day), moodRu: MOOD_RU[moodOf(day)] || '', card: card ? card.title : '',
        notes: db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, day).c,
        asked: db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id = ? AND day = ? AND kind <> 'card'").get(u.id, day).c,
      });
    }
    const month = d.slice(0, 7);
    const moodMonth = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id = ? AND day LIKE ? GROUP BY mood ORDER BY c DESC').all(u.id, month + '%')
      .map((m) => ({ mood: m.mood, moodRu: MOOD_RU[m.mood] || m.mood, n: m.c }));
    const n = dayNum(d);
    const ask = askesisList(u.id, d);
    return {
      date: d,
      mood: moodOf(d), moodRu: MOOD_RU[moodOf(d)] || '',
      card: pack.card ? { name: pack.card.name, keys: pack.card.keys || '', today: pack.card.today || '' } : null,
      number: { n, text: C.NUM_DAY[n] || '' },
      moon: pack.moon, lunar: pack.lunar ? { n: pack.lunar.n, title: pack.lunar.title || '' } : null,
      forecast: pack.forecast ? pack.forecast.title : '', affirmation: pack.affirmation || '', question: pack.question || '',
      week, moodMonth,
      journal: db.prepare('SELECT day, text FROM journal WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(u.id).map((r) => ({ day: r.day, text: open(r.text) })),
      wishes: {
        open: db.prepare('SELECT text FROM wishes WHERE user_id = ? AND done = 0 ORDER BY id DESC LIMIT 10').all(u.id).map((r) => open(r.text)),
        done: db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ? AND done = 1').get(u.id).c,
      },
      habits: habitList(u.id, d).map((h) => ({ title: h.title, streak: h.streak, today: h.today, total: h.total })),
      askesis: ask.active.map((a) => ({ title: a.title, day: a.day, days: a.days, kept: a.kept, missed: a.missed })),
    };
  }

  /* ── «Истории»: к чему человек возвращается и что ему отвечали ── */
  function buildHistory(u, d) {
    const rows = db.prepare('SELECT id, day, kind, question, title, body, data FROM entries WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(u.id);
    const byKind = {}, topics = {}, verdicts = {};
    let first = '', last = '';
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      if (!last) last = r.day; first = r.day;
      if (r.kind === 'card') continue;
      const q = open(r.question);
      if (q) { const t = topicOf(q); topics[t] = (topics[t] || 0) + 1; }
      if (r.kind === 'yesno') verdicts[r.title] = (verdicts[r.title] || 0) + 1;
    }
    const total = db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = ?').get(u.id).c;
    const topicList = Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ topic: t, name: TOPIC_RU[t] || t, n }));
    const askedKinds = Object.entries(byKind).filter(([k]) => k !== 'card').sort((a, b) => b[1] - a[1]);
    return {
      total, first, last, byKind,
      topics: topicList,
      verdicts: Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ verdict: v, n })),
      favorite: askedKinds.length ? KIND_RU[askedKinds[0][0]] || askedKinds[0][0] : '',
      mainTopic: topicList.length ? topicList[0].name : '',
      recent: rows.filter((r) => r.kind !== 'card').slice(0, 20).map((r) => ({
        day: r.day, kind: r.kind, kindRu: KIND_RU[r.kind] || r.kind, question: open(r.question), answer: r.title, note: short(r.body, 200),
      })),
      cards: rows.filter((r) => r.kind === 'card').slice(0, 14).map((r) => ({ day: r.day, name: r.title })),
    };
  }

  /* Пересобрать все три полки и положить в базу. u — строка users или её id. */
  function rebuild(uOrId, d) {
    const u = typeof uOrId === 'object' ? uOrId : userById.get(uOrId);
    if (!u) return null;
    const out = { about: buildAbout(u, d), day: buildDay(u, d), history: buildHistory(u, d) };
    const ts = nowISO();
    for (const s of SHELVES) put.run(u.id, s, seal(JSON.stringify(out[s])), d, ts);
    return { ...out, updated: ts };
  }

  /* Прочитать полки; если их нет или они со вчерашнего дня — собрать заново. */
  function read(u, d) {
    const rows = get.all(u.id);
    if (rows.length !== SHELVES.length || rows.some((r) => r.day !== d)) return rebuild(u, d);
    const out = {};
    for (const r of rows) { try { out[r.shelf] = JSON.parse(open(r.json)); } catch { return rebuild(u, d); } }
    if (SHELVES.some((s) => !out[s])) return rebuild(u, d);
    out.updated = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
    return out;
  }

  /* После любого действия человека — обновить его полки. Ошибка здесь не должна ломать ответ. */
  function refresh(userId, d) { try { rebuild(userId, d); } catch (e) { console.log('Полочки: не пересобрались для', userId, e.message); } }
  function wipe(userId) { db.prepare('DELETE FROM shelves WHERE user_id = ?').run(userId); }

  /* Досье текстом — для ИИ-разборов, гороскопов и раскладов. Без почты и служебных полей. */
  function contextText(s) {
    const a = s.about, dy = s.day, h = s.history, L = [];
    const who = [];
    if (a.name) who.push(a.name);
    if (a.age) who.push(a.age === 'до 25' ? 'до 25 лет' : `${a.age} лет`);
    if (a.sign) who.push(`${a.sign.name}${a.sign.element ? ` (${a.sign.element})` : ''}`);
    const born = a.birth ? `Родилась ${fmt(a.birth)}${a.birthTime ? ` в ${a.birthTime}` : ''}${a.city ? `, ${a.city}` : ''}.` : 'Дата рождения не указана.';
    L.push('ОБО МНЕ');
    L.push(`${who.join(', ') || 'Имя не указано'}. ${born}`);
    if (a.sign && a.sign.trait) L.push(`Черта знака: ${a.sign.trait}.`);
    if (a.destiny) L.push(`Число судьбы ${a.destiny.n} — ${a.destiny.title}. ${a.destiny.text}`);
    if (a.year) L.push(`Личный год ${a.year.n}${a.year.planet ? ` (${a.year.planet} · ${a.year.energy})` : ''}, с ${fmt(a.year.from)} по ${fmt(dayShift(a.year.to, -1))}. ${a.year.text}${a.year.next ? ` Следующий, год ${a.year.next.n}, начнётся ${fmt(a.year.next.from)}.` : ''}`);
    if (a.natal && (a.natal.sun || a.natal.moon)) L.push(`Натальная карта: Солнце в ${inSign(a.natal.sun) || '—'}${a.natal.moon ? `, Луна в ${inSign(a.natal.moon)}${a.natal.moonUncertain ? ' (знак зависит от времени рождения)' : ''}` : ''}${a.natal.asc ? `, Асцендент в ${inSign(a.natal.asc)}` : ''}${a.natal.timeKnown ? '' : '; время рождения не указано, дома не считаются'}.`);
    if (a.interests && a.interests.length) L.push(`Интересы (выбранные темы чтения): ${a.interests.join(', ')}.`);
    L.push(`В Лунарио с ${fmt(a.since)}${a.streak ? `, серия ${a.streak} ${plural(a.streak, 'день', 'дня', 'дней')} подряд` : ''}${a.plus ? ', подписка Плюс' : ''}.`);

    L.push('', `МОЙ ДЕНЬ (${fmt(dy.date)})`);
    const now = [];
    if (dy.moodRu) now.push(`настроение — ${dy.moodRu}`);
    if (dy.card) now.push(`карта дня — ${dy.card.name}${dy.card.keys ? ` (${dy.card.keys})` : ''}`);
    if (dy.number && dy.number.n) now.push(`число дня ${dy.number.n}${dy.number.text ? ` — ${dy.number.text.replace(/\.$/, '')}` : ''}`);
    if (dy.moon) now.push(dy.moon.toLowerCase());
    if (dy.lunar) now.push(`${dy.lunar.n}-й лунный день${dy.lunar.title ? ` — ${dy.lunar.title}` : ''}`);
    if (dy.forecast) now.push(`тон дня — ${dy.forecast.toLowerCase()}`);
    L.push(now.length ? now.join('; ') + '.' : 'Сегодня отметок ещё нет.');
    const wk = dy.week.filter((w) => w.moodRu);
    if (wk.length) L.push(`Неделя: ${wk.map((w) => `${fmt(w.day).slice(0, 5)} — ${w.moodRu}`).join(', ')}.`);
    if (dy.moodMonth.length) L.push(`За месяц чаще всего — ${dy.moodMonth[0].moodRu} (${dy.moodMonth[0].n} из ${dy.moodMonth.reduce((s, m) => s + m.n, 0)}).`);
    if (dy.journal.length) L.push(`Дневник: ${dy.journal.map((j) => `${fmt(j.day).slice(0, 5)} «${short(j.text, 140)}»`).join('; ')}.`);
    if (dy.wishes.open.length) L.push(`Желания: ${dy.wishes.open.map((w) => `«${short(w, 80)}»`).join(', ')}${dy.wishes.done ? `; исполнено — ${dy.wishes.done}` : ''}.`);
    if (dy.habits.length) L.push(`Привычки: ${dy.habits.map((h) => `${h.title} (${h.streak} ${plural(h.streak, 'день', 'дня', 'дней')} подряд${h.today ? ', сегодня отмечена' : ''})`).join('; ')}.`);
    if (dy.askesis.length) L.push(`Аскезы: ${dy.askesis.map((x) => `${x.title} — день ${x.day} из ${x.days}, соблюдено ${x.kept}${x.missed ? `, пропущено ${x.missed}` : ''}`).join('; ')}.`);

    L.push('', 'ИСТОРИИ');
    if (!h.total) L.push('Обращений пока не было.');
    else {
      const kinds = Object.entries(h.byKind).map(([k, n]) => `${KIND_RU[k] || k} — ${n}`).join(', ');
      L.push(`Всего ${h.total} ${plural(h.total, 'запись', 'записи', 'записей')} с ${fmt(h.first)} по ${fmt(h.last)}: ${kinds}.`);
      if (h.topics.length) L.push(`Темы вопросов: ${h.topics.map((t) => `${t.name} — ${t.n}`).join(', ')}.${h.mainTopic ? ` Чаще всего возвращается к теме «${h.mainTopic}».` : ''}`);
      if (h.verdicts.length) L.push(`Ответы «Да / Нет»: ${h.verdicts.map((v) => `${v.verdict} — ${v.n}`).join(', ')}.`);
      if (h.recent.length) L.push(`Последние обращения: ${h.recent.slice(0, 8).map((r) => `${fmt(r.day).slice(0, 5)} ${r.kindRu}${r.question ? ` «${short(r.question, 90)}»` : ''} → ${r.answer}`).join('; ')}.`);
      if (h.cards.length) L.push(`Карты дня недавно: ${h.cards.slice(0, 7).map((c) => `${fmt(c.day).slice(0, 5)} ${c.name}`).join(', ')}.`);
    }
    return L.join('\n');
  }

  /* Контекст для гадания или гороскопа: объект полок плюс готовый текст. */
  function context(u, d) { const s = read(u, d); return { ...s, text: contextText(s) }; }

  return { rebuild, read, refresh, wipe, context, contextText, SHELVES };
}
