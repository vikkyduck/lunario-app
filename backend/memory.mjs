/* Лунарио — «Я помню»: приложение вспоминает человека одной фразой, а не считает его.

   Источник — те же таблицы, что у экранов (entries, journal, moods, habits, askesis, users): правилам нужны точные даты по дням.
   База знаний (knowledge.mjs) — отдельная папка документов для ИИ и выгрузки, она собирается из тех же таблиц и памятью не читается.
   Фразы — content/память.txt, вопросы по теме — content/вопросы-по-темам.txt, вечерние варианты —
   content/напоминания.txt (ключи evening-аскеза, evening-серия, evening-тревога, evening-привычка).
   Все правится в кабинете «Контент» → «Память»; пустая фраза у ключа выключает правило.

   Правило одно на все механики: есть что вспомнить — одна строка; нечего — молчим.
   Шесть механик (решение владелицы 19.09):
     dayLine       — «Я помню»: одна строка на карточке дня (Дневник) — прошлый ответ на этот же вопрос, прошлый ответ
                     «Да / Нет» на ту же тему, карта год назад, карта или руна, которая уже приходила, запись неделю назад…
     topicQuestion — вопрос дня знает, чем человек живет: если за месяц он спрашивал про одно и то же три раза и больше,
                     через день вопрос дня берется из вопросов по этой теме
     favorite      — вход в «Ответить себе» без выбора: способ, которым человек пользуется чаще, уже выбран
     eveningPersonal — вечерний пуш видит день: аскеза (день N из M), серия, три тревожных дня подряд, привычка
     aboutLine     — «Обо мне»: «В Лунарио с 3 марта. Первой картой была Луна»
   Ничего не пишется в базу: все считается на лету из того, что человек сам оставил. */
import { hash32, parseData } from './morning.mjs';
import { addDays, plural } from './util.mjs';

/* тема вопроса — как ее назвать после «про»: «про работу» */
const TOPIC_ACC = { work: 'работу', money: 'деньги', love: 'отношения', health: 'здоровье', move: 'переезд и дом', study: 'учебу', self: 'себя' };
const ASK_KINDS = ['yesno', 'rune', 'runes', 'spread'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDate = (d, withYear = false) => { const [y, m, dd] = String(d).split('-'); return `${Number(dd)} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ''}`; };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const short = (s, n = 140) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* «вчера», «три дня назад», «неделю назад», «месяц назад», «год назад» — по-человечески, без чисел там, где есть слово */
export function agoRu(from, to) {
  const n = Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5);
  const WORDS = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть'];
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'вчера';
  if (n === 2) return 'позавчера';
  if (n < 7) return `${WORDS[n]} дня назад`;
  if (n === 7) return 'неделю назад';
  if (n < 14) return `${n} дней назад`;
  if (n < 21) return 'две недели назад';
  if (n < 28) return 'три недели назад';
  if (n < 45) return 'месяц назад';
  if (n < 75) return 'полтора месяца назад';
  if (n < 105) return 'два месяца назад';
  if (n < 165) return `${WORDS[Math.round(n / 30)]} месяца назад`;
  if (n < 240) return 'полгода назад';
  if (n < 330) return `${WORDS[Math.round(n / 30)]} месяцев назад`;
  if (n < 400) return 'год назад';
  return fmtDate(from, true);
}

export function createMemory({ db, open, C, questionOf, topicOf, MOOD_RU, habitList, askesisList }) {
  /* фраза по ключу из память.txt: {когда} — как есть, {Когда} — с большой буквы; нет текста — правило выключено */
  const phrase = (key, vars) => {
    const t = C.MEMORY[key];
    if (!t) return '';
    return String(t).replace(/\{([^}]+)\}/g, (_, k) => {
      const lower = k[0].toLowerCase() + k.slice(1);
      const v = vars[k] ?? vars[lower];
      if (v == null || v === '') return '';
      return k[0] === k[0].toUpperCase() && k[0] !== k[0].toLowerCase() ? cap(String(v)) : String(v);
    }).replace(/\s{2,}/g, ' ').replace(/\s+([.,!?»])/g, '$1').trim();
  };
  const line = (kind, day, vars) => { const text = phrase(kind, vars); return text ? { kind, day, text } : null; };
  const cardName = (slug) => { const a = [...C.ARCANA].find((c) => c.slug === slug); return a ? a.name.replace(/^[IVXL0]+\s*·\s*/, '') : ''; };   /* «VII · Колесница» → «Колесница» */
  const runeName = (slug) => { const r = [...C.RUNES].find((x) => x.slug === slug); return r ? r.name : ''; };
  const moodWord = (key) => String(MOOD_RU[key] || '').toLowerCase();

  /* обращения человека: день, вид, тема (по словам вопроса), ответ — из entries; карты дня отдельно */
  function asks(uid, { before = null, limit = 60 } = {}) {
    const rows = before
      ? db.prepare("SELECT day, kind, question, title, data FROM entries WHERE user_id = ? AND day < ? AND kind <> 'card' AND kind <> 'dayrune' ORDER BY id DESC LIMIT ?").all(uid, before, limit)
      : db.prepare("SELECT day, kind, question, title, data FROM entries WHERE user_id = ? AND kind <> 'card' AND kind <> 'dayrune' ORDER BY id DESC LIMIT ?").all(uid, limit);
    return rows.map((r) => { const q = open(r.question || ''); return { day: r.day, kind: r.kind, question: q, topic: q ? topicOf(q) : '', answer: r.title, data: parseData(r.data) }; });
  }

  /* ── «Я помню»: одна строка на карточке дня ── */
  function dayLine(u, d) {
    const uid = u.id;
    const question = questionOf(u, d) || '';
    /* 1. на этот же вопрос дня уже отвечали */
    if (question) {
      for (const r of db.prepare("SELECT day, text, title FROM journal WHERE user_id = ? AND kind = 'answer' AND day < ? ORDER BY id DESC LIMIT 80").all(uid, d)) {
        if (open(r.title || '') === question) { const l = line('вопрос-тот-же', r.day, { когда: agoRu(r.day, d), текст: short(open(r.text)) }); if (l) return l; break; }
      }
    }
    /* 2. сегодня спрашивали про тему, о которой уже спрашивали раньше — и тогда был ответ «Да / Нет» или руна */
    const today = asks(uid, { limit: 10 }).filter((a) => a.day === d && a.topic && a.topic !== 'self');
    const earlier = asks(uid, { before: addDays(d, -2), limit: 80 });
    for (const t of today) {
      const prev = earlier.find((a) => a.topic === t.topic && (a.kind === 'yesno' || a.kind === 'rune'));
      if (!prev) continue;
      const l = prev.kind === 'yesno'
        ? line('тема-вопроса', prev.day, { когда: agoRu(prev.day, d), тема: TOPIC_ACC[t.topic], ответ: prev.answer })
        : line('тема-руны', prev.day, { когда: agoRu(prev.day, d), тема: TOPIC_ACC[t.topic], руна: prev.answer });
      if (l) return l;
    }
    /* 3. в сегодняшней записи — тема, про которую человек спрашивал раньше */
    const note = db.prepare("SELECT text FROM journal WHERE user_id = ? AND day = ? AND kind = '' ORDER BY id DESC LIMIT 1").get(uid, d);
    if (note) {
      const topic = topicOf(open(note.text));
      if (topic && topic !== 'self') {
        const prev = earlier.find((a) => a.topic === topic && a.kind === 'yesno');
        if (prev) { const l = line('запись-о-теме', prev.day, { когда: agoRu(prev.day, d), тема: TOPIC_ACC[topic], ответ: prev.answer }); if (l) return l; }
      }
    }
    /* 4. карта дня ровно год назад */
    const yearAgo = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
    const cy = db.prepare("SELECT data FROM entries WHERE user_id = ? AND day = ? AND kind = 'card' ORDER BY id DESC LIMIT 1").get(uid, yearAgo);
    if (cy) { const name = cardName((parseData(cy.data) || {}).card); if (name) { const l = line('карта-год-назад', yearAgo, { карта: name }); if (l) return l; } }
    /* 5. сегодняшняя карта или руна уже приходила */
    const cardToday = db.prepare("SELECT data FROM entries WHERE user_id = ? AND day = ? AND kind = 'card' ORDER BY id DESC LIMIT 1").get(uid, d);
    const slug = cardToday && (parseData(cardToday.data) || {}).card;
    if (slug) {
      const prev = db.prepare("SELECT day, data FROM entries WHERE user_id = ? AND day < ? AND kind = 'card' ORDER BY id DESC LIMIT 400").all(uid, addDays(d, -6)).find((r) => (parseData(r.data) || {}).card === slug);
      if (prev) { const l = line('карта-повтор', prev.day, { карта: cardName(slug), когда: agoRu(prev.day, d) }); if (l) return l; }
    }
    const runeToday = db.prepare("SELECT data FROM entries WHERE user_id = ? AND day = ? AND kind = 'dayrune' ORDER BY id DESC LIMIT 1").get(uid, d);
    const rslug = runeToday && (parseData(runeToday.data) || {}).rune;
    if (rslug) {
      const prev = db.prepare("SELECT day, data FROM entries WHERE user_id = ? AND day < ? AND kind = 'dayrune' ORDER BY id DESC LIMIT 400").all(uid, addDays(d, -6)).find((r) => (parseData(r.data) || {}).rune === rslug);
      if (prev) { const l = line('руна-повтор', prev.day, { руна: runeName(rslug), когда: agoRu(prev.day, d) }); if (l) return l; }
    }
    /* 6. неделю назад писали */
    const week = db.prepare("SELECT day, text FROM journal WHERE user_id = ? AND day = ? AND kind IN ('', 'gratitude') ORDER BY id DESC LIMIT 1").get(uid, addDays(d, -7));
    if (week) { const l = line('неделю-назад', week.day, { текст: short(open(week.text)) }); if (l) return l; }
    /* 7. вчерашнее настроение */
    const y = db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(uid, addDays(d, -1));
    if (y && y.mood) { const l = line('вчера', addDays(d, -1), { настроение: moodWord(y.mood) }); if (l) return l; }
    /* 8. последняя запись за месяц */
    const last = db.prepare("SELECT day, text FROM journal WHERE user_id = ? AND day < ? AND day >= ? AND kind = '' ORDER BY id DESC LIMIT 1").get(uid, d, addDays(d, -30));
    if (last) { const l = line('раньше', last.day, { когда: agoRu(last.day, d), текст: short(open(last.text)) }); if (l) return l; }
    return null;
  }

  /* ── «Обо мне»: с какого дня человек здесь и какой была первая карта — после первой недели ── */
  function aboutLine(u, d) {
    const since = String(u.created_at || '').slice(0, 10);
    if (!since || Date.parse(d) - Date.parse(since) < 7 * 864e5) return null;
    const first = db.prepare("SELECT day, data FROM entries WHERE user_id = ? AND kind = 'card' ORDER BY id ASC LIMIT 1").get(u.id);
    const name = first ? cardName((parseData(first.data) || {}).card) : '';
    const dateStr = fmtDate(since, since.slice(0, 4) !== d.slice(0, 4));
    return (name && line('первая-карта', since, { дата: dateStr, карта: name })) || line('с-нами', since, { дата: dateStr });
  }

  /* ── любимый способ ответа: чем пользуется чаще (не меньше трех обращений) — для входа в «Ответить себе» ── */
  function favorite(u) {
    const counts = {};
    for (const a of asks(u.id, { limit: 40 })) {
      const L = (a.data && a.data.layout) || '';
      const key = a.kind === 'rune' ? 'rune' : a.kind === 'runes' ? 'runes3' : a.kind === 'spread' ? (L === 'fork' ? 'fork' : 'spread') : '';
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 3 ? best[0] : null;
  }

  /* ── тема, к которой человек возвращается: три и больше вопросов за месяц ── */
  function mainTopic(uid, d) {
    const counts = {};
    for (const a of asks(uid, { limit: 60 })) { if (a.day < addDays(d, -30)) break; if (a.topic && a.topic !== 'self') counts[a.topic] = (counts[a.topic] || 0) + 1; }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 3 ? best[0] : '';
  }
  /* ── вопрос дня по теме — через день, чтобы общие вопросы не пропадали; один и тот же день — один и тот же вопрос ── */
  function topicQuestion(u, d) {
    const topic = mainTopic(u.id, d); if (!topic) return '';
    const pool = [...C.TOPIC_QUESTIONS].filter((r) => r[0] === topic).map((r) => r[1]); if (!pool.length) return '';
    const h = hash32(`${u.id}:${d}:тема`);
    if (h % 2) return '';
    return pool[Math.floor(h / 2) % pool.length];
  }

  /* ── вечерний пуш, который видит день: ключ из напоминания.txt и подстановки; нет ключа в файле — правило выключено ── */
  function eveningPersonal(u, d) {
    const has = (k) => !!C.REMINDER_TEXTS[k];
    const ask = has('evening-аскеза') ? askesisList(u.id, d).active.find((a) => a.done >= 2 && a.done <= a.total) : null;
    if (ask) return { key: 'evening-аскеза', vars: { аскеза: ask.title, n: ask.done, всего: ask.total, дней: plural(ask.done, 'день', 'дня', 'дней') } };
    if (has('evening-тревога')) {
      const days = [1, 2, 3].map((i) => db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, addDays(d, -i)));
      if (days.every((r) => r && (C.moodInfo(r.mood) || {}).family === 'fear')) return { key: 'evening-тревога', vars: { имя: u.name || '' } };
    }
    if (has('evening-серия') && u.streak >= 3 && (u.streak_date === d || u.streak_date === addDays(d, -1))) return { key: 'evening-серия', vars: { n: u.streak, дней: plural(u.streak, 'день', 'дня', 'дней') } };
    if (has('evening-привычка')) {
      const h = habitList(u.id, d).filter((x) => x.streak >= 3 && !x.today).sort((a, b) => b.streak - a.streak)[0];
      if (h) return { key: 'evening-привычка', vars: { привычка: h.title, n: h.streak, дней: plural(h.streak, 'день', 'дня', 'дней') } };
    }
    return null;
  }

  /* ── для кабинета: что сработало бы у этого человека сегодня, и все ли подстановки в текстах известны ── */
  const KNOWN = ['когда', 'тема', 'ответ', 'карта', 'руна', 'текст', 'настроение', 'дата', 'имя', 'n', 'всего', 'дней', 'аскеза', 'привычка'];
  function preview(u, d) {
    const warn = [];
    for (const [k, t] of Object.entries(C.MEMORY)) for (const m of String(t).matchAll(/\{([^}]+)\}/g)) { const k2 = m[1][0].toLowerCase() + m[1].slice(1); if (!KNOWN.includes(k2)) warn.push(`${k}: неизвестная подстановка {${m[1]}}`); }
    const ev = eveningPersonal(u, d);
    return { day: dayLine(u, d), about: aboutLine(u, d), favorite: favorite(u), topic: mainTopic(u.id, d), topicQuestion: topicQuestion(u, d), evening: ev, warnings: warn, rules: Object.keys(C.MEMORY) };
  }

  return { dayLine, aboutLine, favorite, topicQuestion, eveningPersonal, preview, mainTopic, agoRu };
}
