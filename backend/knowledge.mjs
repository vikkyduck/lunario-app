/* Лунарио — база знаний о человеке (решение владелицы 20.09.2026).

   Журнал операций (entries, journal, moods, habits, askesis, wishes, users…) остается источником истины:
   экраны приложения читают и пишут только его — быстро, построчно, без пересборок.
   База знаний — папка документов на человека, собранная ИЗ журнала; ее читает не приложение, а ИИ,
   экспорт и «Проверить на себе» в кабинете. Обновляется раз в сутки (send-daily.mjs) и по запросу.

   Документы (таблица knowledge: один ряд — один документ, JSON зашифрован ключом дневника):
     profile        — «Обо мне»: анкета, знак и стихия, нумерология, натальная карта ДОСЛОВНО (планеты, дома, аспекты)
                      + значения планет в знаках и аспектов из контента (планеты-в-знаках.txt, аспекты.txt), лунный день рождения
     readings       — «Тесты и совместимости»: каждый расчет совместимости (compat_checks); тесты — когда появятся
     recent         — «Последние записи»: последние RECENT_DAYS дней дословно — тексты, настроения, карты, руны, вопросы и ответы,
                      мысли к материалам, привычки, аскезы, фото, «отозвалось», недельные рефлексии
     month:ГГГГ-ММ  — отчет за месяц, вышедший из окна: благодарности дословно, аскезы с отметками, привычки, настроения по неделям,
                      недельные рефлексии, карты дня, счет обращений — без сырых текстов дневника (они остаются в журнале)
     portrait       — «Портрет»: выжимка — с какого дня здесь, серия, любимый способ, тема месяца, настроения за 90 дней, первая карта
   text(doc) отдает документ связным текстом — для промпта ИИ. Почты и служебных id в текстах нет. */
import { addDays, plural } from './util.mjs';
import { createMoods } from './moods.mjs';
import { countActiveDays } from './day-sources.mjs';
import { readableWith } from './private-text.mjs';

export const RECENT_DAYS = 120;
export const DOC_TITLES = { profile: 'Обо мне', readings: 'Тесты и совместимости', recent: 'Последние записи', portrait: 'Портрет' };
const KIND_RU = { yesno: '«Да / Нет»', rune: 'руна', runes: 'расклад рун', spread: 'расклад Таро', card: 'карта дня', dayrune: 'руна дня' };
const TOPIC_RU = { work: 'работа', money: 'деньги', love: 'отношения', health: 'здоровье', move: 'дом и переезд', study: 'учеба', self: 'о себе' };
const ELEMENT = { 'Овен': 'огонь', 'Лев': 'огонь', 'Стрелец': 'огонь', 'Телец': 'земля', 'Дева': 'земля', 'Козерог': 'земля',
  'Близнецы': 'воздух', 'Весы': 'воздух', 'Водолей': 'воздух', 'Рак': 'вода', 'Скорпион': 'вода', 'Рыбы': 'вода' };
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const fmt = (d) => { const [y, m, dd] = String(d).split('-'); return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`; };
const monthTitle = (ym) => { const [y, m] = ym.split('-'); return `${MONTH_NOM[Number(m) - 1]} ${y}`; };
const monthOf = (d) => String(d).slice(0, 7);
const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
/* начало недели (понедельник) для группировки настроений */
const weekStart = (d) => { const dt = new Date(d + 'T12:00:00Z'); return addDays(d, -((dt.getUTCDay() + 6) % 7)); };

export function createKnowledge({ db, seal, open, C, signOf, destinyNum, personalYearAt, dayNum, numFormula, ageBand, natal, natalMeanings, habitList, askesisList, MOOD_RU, topicOf, memory, lunarOf, nowISO, dataRev = () => 0 }) {
  /* таблицы knowledge (с колонкой rev) и compat_checks — в миграциях schema.mjs (шаг 22, F12): модуль ничего не создает.
     rev — ревизия личных данных, с которой собран документ (users.data_rev, R08): изменилась — документ пересобирается при чтении.
     Ревизия поднимается в той же транзакции, что и сама запись (mutation.mjs, ревью v114 F04), поэтому документ, собранный под
     ревизией N, видит все данные ревизии N — гонки «старые данные под новой ревизией» нет */
  const put = db.prepare('INSERT INTO knowledge (user_id, doc, json, updated_at, day, rev) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, doc) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, day = excluded.day, rev = excluded.rev');
  const getDoc = db.prepare('SELECT json, updated_at, day, rev FROM knowledge WHERE user_id = ? AND doc = ?');
  const listDocs = db.prepare('SELECT doc, updated_at, day, LENGTH(json) size FROM knowledge WHERE user_id = ? ORDER BY doc');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const cardName = (slug) => { const a = [...C.ARCANA].find((c) => c.slug === slug); return a ? a.name : ''; };
  const runeName = (slug) => { const r = [...C.RUNES].find((x) => x.slug === slug); return r ? r.name : ''; };
  const Moods = createMoods(db);
  const readable = readableWith(open);   /* нечитаемая запись помечается, а не роняет документ и не выглядит пустой (F14) */
  const moodWord = (k) => String(MOOD_RU[k] || k);
  const moodsOf = (uid, d) => Moods.ofDay(uid, d);   /* один контракт чтения настроений — moods.mjs (аудит v98, F10) */

  /* ── «Обо мне» ── */
  function buildProfile(u, d) {
    const birthOk = /^\d{4}-\d{2}-\d{2}$/.test(u.birth || '');
    const sign = birthOk ? signOf(u.birth) : null;
    const doc = {
      name: u.name || '', birth: u.birth || '', birthTime: u.birth_time || '', city: u.city || '', region: u.city_region || '', tz: u.tz || '',
      age: birthOk ? ageBand(u.birth) : '', since: String(u.created_at || '').slice(0, 10), streak: u.streak || 0,
      sign: sign ? { name: sign.name, element: ELEMENT[sign.name] || '', trait: sign.trait } : null,
      numerology: null, natal: null, lunarBirth: null,
    };
    if (birthOk) {
      const dn = destinyNum(u.birth), py = personalYearAt(u.birth, d), info = C.YEARS[py.n] || null;
      doc.numerology = { destiny: { n: dn, title: (C.NUM_DESTINY[dn] || [])[0] || '', text: (C.NUM_DESTINY[dn] || [])[1] || '', formula: numFormula(u.birth) },
        year: { n: py.n, from: py.from, to: py.to, text: C.NUM_YEAR[py.n] || '', planet: info ? info.planet : '', energy: info ? info.energy : '', caption: info ? info.caption : '' },
        dayNumber: { n: dayNum(d), text: C.NUM_DAY[dayNum(d)] || '' } };
      try {
        const ch = natal(u);   /* натальная карта — дословно: планеты с градусами и домами, дома, аспекты с орбами; значения и резюме — natal-texts.mjs */
        if (ch) {
          const m = natalMeanings(ch);
          doc.natal = {
            input: ch.input, zodiac: ch.zodiac, houseSystem: ch.houseSystem, timeKnown: ch.timeKnown, hasPlace: ch.hasPlace, moonUncertain: ch.moonUncertain, precision: ch.precision, tz: ch.tz, city: ch.city,
            summary: m.summary, balance: m.balance,
            planets: m.planets.map((p) => ({ ...p, lon: (ch.planets.find((x) => x.key === p.key) || {}).lon })),
            points: m.points,
            houses: ch.houses ? { system: ch.houses.system, asc: { sign: ch.houses.asc.sign, degree: ch.houses.asc.text }, mc: { sign: ch.houses.mc.sign, degree: ch.houses.mc.text }, cusps: ch.houses.cusps.map((c) => ({ house: c.house, sign: c.sign, degree: c.text })) } : null,
            aspects: m.aspects,
          };
          doc.lunarBirth = ch.lunarBirth ? { n: ch.lunarBirth.n, title: (C.LUNAR_DAYS[ch.lunarBirth.n - 1] || [''])[0], uncertain: !!ch.lunarBirth.uncertain } : null;
        }
      } catch { doc.natal = null; }
    }
    return doc;
  }

  /* ── «Тесты и совместимости» ── */
  function buildReadings(u) {
    const compat = db.prepare('SELECT ts, day, other_birth, total, rings, you, other, text FROM compat_checks WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(u.id)
      .map((r) => ({ day: r.day, otherBirth: r.other_birth, total: r.total, rings: parse(r.rings) || [], you: r.you, other: r.other, text: open(r.text) }));
    return { tests: [], compat };   /* тесты появятся вместе с экраном «Тесты» — сюда лягут их результаты по датам */
  }

  /* ── дни дословно: все, что человек оставил за промежуток [from, to]. Кратность — по контракту JournalDay (day.mjs entriesOf,
     ревью v114 F08): записей одного вида за день может быть несколько, поэтому texts[], gratitudes[], answers[] — массивы с id в
     порядке id, ничего не вытесняется; weekly — одна на день (это гарантирует week.reflect). Выгрузка и сводка сопоставляются по id.
     Пакетные выборки (F09): по одной выборке диапазона на таблицу и группировка по дню в JS — а не десятки SELECT на каждый из 120 дней ── */
  function dayRecords(u, from, to) {
    const uid = u.id, recs = new Map();
    const rec = (day) => { if (!recs.has(day)) recs.set(day, { day }); return recs.get(day); };
    for (const [day, list] of Moods.byDay(uid, from, to)) if (list.length) rec(day).moods = list.map((m) => ({ key: m, label: moodWord(m) }));
    for (const r of db.prepare("SELECT id, day, kind, text, title FROM journal WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY id").all(uid, from, to)) {
      const x = rec(r.day), t = readable(r.text), h = readable(r.title || ''), text = t.text, title = h.text;
      const flag = t.unreadable || h.unreadable ? { unreadable: true } : {};
      if (r.kind === '') (x.texts ||= []).push({ id: r.id, text, ...flag });
      else if (r.kind === 'gratitude') (x.gratitudes ||= []).push({ id: r.id, text, ...flag });
      else if (r.kind === 'answer') (x.answers ||= []).push({ id: r.id, question: title, text, ...flag });
      else if (r.kind === 'weekly') x.weekly = t.unreadable ? null : text;
      else if (r.kind === 'thought') { const meta = parse(title) || {}; (x.thoughts ||= []).push({ id: r.id, about: meta.source || '', name: meta.name || '', question: meta.question || '', entry: Number(meta.entry) || 0, text, ...flag }); }
    }
    for (const r of db.prepare('SELECT day, kind, question, title, body, data FROM entries WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY id').all(uid, from, to)) {
      const x = rec(r.day), data = parse(r.data) || {};
      if (r.kind === 'card') x.card = { slug: data.card || '', name: r.title, keys: r.body };
      else if (r.kind === 'dayrune') x.rune = { slug: data.rune || '', name: r.title, answer: r.body };
      else { const q = readable(r.question || '').text || ''; (x.asks ||= []).push({ kind: r.kind, kindRu: KIND_RU[r.kind] || r.kind, question: q, topic: q ? (TOPIC_RU[topicOf(q)] || '') : '', answer: r.title, text: r.body, layout: data.layout || '', cards: (data.cards || []).map(cardName).filter(Boolean), runes: (data.runes || []).map(runeName).filter(Boolean) }); }
    }
    for (const r of db.prepare('SELECT m.day, h.title FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day BETWEEN ? AND ? ORDER BY m.day, h.id').all(uid, from, to)) { const t = readable(r.title).text; if (t !== null) (rec(r.day).habits ||= []).push(t); }
    for (const r of db.prepare('SELECT x.day, a.title, x.kept, x.note FROM askesis_days x JOIN askesis a ON a.id = x.askesis_id WHERE a.user_id = ? AND x.day BETWEEN ? AND ? ORDER BY x.day, a.id').all(uid, from, to)) (rec(r.day).askesis ||= []).push({ title: readable(r.title).text, kept: !!r.kept, note: readable(r.note || '').text });
    for (const r of db.prepare('SELECT day FROM day_photos WHERE user_id = ? AND day BETWEEN ? AND ?').all(uid, from, to)) rec(r.day).photo = true;
    for (const r of db.prepare('SELECT day, verdict FROM week_echoes WHERE user_id = ? AND day BETWEEN ? AND ?').all(uid, from, to)) rec(r.day).echo = r.verdict;
    for (const r of db.prepare("SELECT day, text, question FROM daily_sets WHERE user_id = ? AND day BETWEEN ? AND ? AND text <> ''").all(uid, from, to)) rec(r.day).morning = { set: r.text.replace(/,?\s*\{Имя\}/g, '').replace(/\s+([,.!?])/g, '$1').trim(), question: r.question || '' };
    return [...recs.keys()].sort().map((day) => { const x = recs.get(day), lunar = lunarOf ? lunarOf(u, day) : null; return lunar ? { day, lunar, ...x } : x; });
  }
  /* дни, в которых что-то есть, в промежутке [from, to] */
  function daysWithRecords(uid, from, to) {
    const q = (sql) => db.prepare(sql).all(uid, from, to).map((r) => r.day);
    return [...new Set([
      ...q('SELECT DISTINCT day FROM journal WHERE user_id = ? AND day BETWEEN ? AND ?'), ...q('SELECT DISTINCT day FROM entries WHERE user_id = ? AND day BETWEEN ? AND ?'),
      ...q('SELECT DISTINCT day FROM moods WHERE user_id = ? AND day BETWEEN ? AND ?'), ...q('SELECT DISTINCT day FROM mood_marks WHERE user_id = ? AND day BETWEEN ? AND ?'),
      ...q('SELECT DISTINCT day FROM day_photos WHERE user_id = ? AND day BETWEEN ? AND ?'), ...q('SELECT DISTINCT day FROM week_echoes WHERE user_id = ? AND day BETWEEN ? AND ?'),
      ...db.prepare('SELECT DISTINCT m.day FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day BETWEEN ? AND ?').all(uid, from, to).map((r) => r.day),
      ...db.prepare('SELECT DISTINCT x.day FROM askesis_days x JOIN askesis a ON a.id = x.askesis_id WHERE a.user_id = ? AND x.day BETWEEN ? AND ?').all(uid, from, to).map((r) => r.day),
    ])].sort();
  }

  /* ── «Последние записи»: окно в RECENT_DAYS дней, дословно — одной выборкой на таблицу (F09) ── */
  function buildRecent(u, d) {
    const from = addDays(d, -(RECENT_DAYS - 1));
    return { from, to: d, window: RECENT_DAYS, days: dayRecords(u, from, d) };
  }

  /* ── отчет за месяц (месяц целиком вышел из окна): без сырых текстов дневника ── */
  function buildMonth(u, ym) {
    const uid = u.id, from = ym + '-01', to = addDays(monthOf(addDays(from, 40)) + '-01', -1);   /* последний день месяца */
    const days = daysWithRecords(uid, from, to);
    const moodDays = days.map((day) => ({ day, moods: moodsOf(uid, day).map(moodWord) })).filter((x) => x.moods.length);
    const weeks = {};
    for (const x of moodDays) (weeks[weekStart(x.day)] ||= []).push(x);
    const byWeek = Object.entries(weeks).sort().map(([start, list]) => {
      const count = {}; for (const x of list) for (const m of x.moods) count[m] = (count[m] || 0) + 1;
      const dominant = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      const reflect = db.prepare("SELECT text FROM journal WHERE user_id = ? AND kind = 'weekly' AND day BETWEEN ? AND ? ORDER BY id DESC LIMIT 1").get(uid, start, addDays(start, 6));
      return { week: start, days: list, dominant: dominant ? dominant[0] : '', reflection: reflect ? open(reflect.text) : '' };
    });
    const gratitudes = db.prepare("SELECT day, text FROM journal WHERE user_id = ? AND kind = 'gratitude' AND day BETWEEN ? AND ? ORDER BY day").all(uid, from, to).map((r) => ({ day: r.day, text: open(r.text) }));
    const askesis = db.prepare('SELECT id, title, started, days, status FROM askesis WHERE user_id = ? ORDER BY id').all(uid).map((a) => {
      const marks = db.prepare('SELECT day, kept, note FROM askesis_days WHERE askesis_id = ? AND day BETWEEN ? AND ? ORDER BY day').all(a.id, from, to).map((x) => ({ day: x.day, kept: !!x.kept, note: open(x.note || '') }));
      return marks.length ? { title: open(a.title), started: a.started, status: a.status, days: marks, kept: marks.filter((x) => x.kept).length, failed: marks.filter((x) => !x.kept).length } : null;
    }).filter(Boolean);
    const habits = db.prepare('SELECT id, title FROM habits WHERE user_id = ? ORDER BY id').all(uid).map((h) => {
      const done = db.prepare('SELECT day FROM habit_marks WHERE habit_id = ? AND day BETWEEN ? AND ? ORDER BY day').all(h.id, from, to).map((x) => x.day);
      return done.length ? { title: open(h.title), done } : null;
    }).filter(Boolean);
    const cards = db.prepare("SELECT day, title FROM entries WHERE user_id = ? AND kind = 'card' AND day BETWEEN ? AND ? ORDER BY day").all(uid, from, to).map((r) => ({ day: r.day, name: r.title }));
    const asks = {}; for (const r of db.prepare("SELECT kind, COUNT(*) n FROM entries WHERE user_id = ? AND kind NOT IN ('card','dayrune') AND day BETWEEN ? AND ? GROUP BY kind").all(uid, from, to)) asks[KIND_RU[r.kind] || r.kind] = r.n;
    const notes = db.prepare("SELECT COUNT(*) n FROM journal WHERE user_id = ? AND kind = '' AND day BETWEEN ? AND ?").get(uid, from, to).n;
    return { month: ym, title: monthTitle(ym), from, to, daysWithRecords: days.length, notes, moods: { days: moodDays, byWeek }, gratitudes, askesis, habits, cards, asks };
  }

  /* ── «Портрет»: выжимка ── */
  function buildPortrait(u, d) {
    const uid = u.id, since = String(u.created_at || '').slice(0, 10);
    const first = db.prepare("SELECT day, title FROM entries WHERE user_id = ? AND kind = 'card' ORDER BY id ASC LIMIT 1").get(uid);
    /* настроения за 90 дней — все отметки по общему контракту moods.mjs, знаменатель — все отметки, рядом число дней наблюдения (R09) */
    const m90 = Moods.summary(uid, addDays(d, -90), d);
    const moods90 = {}; let moodTotal = m90.total;
    for (const r of m90.stats) moods90[moodWord(r.mood)] = (moods90[moodWord(r.mood)] || 0) + r.c;
    const topics = {}; for (const r of db.prepare("SELECT question FROM entries WHERE user_id = ? AND kind NOT IN ('card','dayrune') AND question <> '' ORDER BY id DESC LIMIT 200").all(uid)) { const q = open(r.question); const t = q ? topicOf(q) : ''; if (t) topics[TOPIC_RU[t] || t] = (topics[TOPIC_RU[t] || t] || 0) + 1; }
    const cards = {}; for (const r of db.prepare("SELECT title FROM entries WHERE user_id = ? AND kind = 'card'").all(uid)) cards[r.title] = (cards[r.title] || 0) + 1;
    const counts = { days: countActiveDays(db, uid),   /* дни с любой отметкой — та же политика, что у архива «Прошлые дни» (day-sources.mjs) */
      notes: db.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND kind = ''").get(uid).c, gratitudes: db.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND kind = 'gratitude'").get(uid).c,
      asks: db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id = ? AND kind NOT IN ('card','dayrune')").get(uid).c, cards: db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id = ? AND kind = 'card'").get(uid).c,
      wishes: db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ?').get(uid).c, wishesDone: db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ? AND done = 1').get(uid).c };
    const FAV = { rune: 'руна', runes3: 'три руны', spread: 'три карты', fork: 'расклад «Выбор»' };
    const fav = memory ? memory.favorite(u) : null, main = memory ? memory.mainTopic(uid, d) : '';
    return {
      since, streak: u.streak || 0, firstCard: first ? { day: first.day, name: first.title } : null, counts,
      moods90: Object.entries(moods90).map(([mood, n]) => ({ mood, n, share: moodTotal ? Math.round(n / moodTotal * 100) : 0 })), moodDays90: m90.days, moodMarks90: moodTotal,
      topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([topic, n]) => ({ topic, n })), mainTopic: main ? (TOPIC_RU[main] || main) : '',
      favoriteMethod: fav ? FAV[fav] || fav : '', frequentCards: Object.entries(cards).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })),
      habits: habitList(uid, d).map((h) => ({ title: h.title, streak: h.streak, total: h.total })),
      askesis: askesisList(uid, d).active.map((a) => ({ title: a.title, done: a.done, total: a.total, until: a.until })),
      wishes: db.prepare('SELECT text, done FROM wishes WHERE user_id = ? ORDER BY done, id DESC LIMIT 20').all(uid).map((w) => ({ text: open(w.text), done: !!w.done })),
    };
  }

  /* месяцы, целиком вышедшие из окна: от первой записи до последнего полного месяца перед окном */
  function monthsOutside(uid, d) {
    const first = db.prepare('SELECT MIN(day) day FROM (SELECT day FROM journal WHERE user_id = ? UNION SELECT day FROM entries WHERE user_id = ? UNION SELECT day FROM moods WHERE user_id = ?)').get(uid, uid, uid).day;
    if (!first) return [];
    const edge = addDays(d, -RECENT_DAYS), out = [];
    for (let ym = monthOf(first); ym < monthOf(edge); ym = monthOf(addDays(ym + '-01', 40))) out.push(ym);
    return out;
  }

  const save = (uid, doc, data, d) => put.run(uid, doc, seal(JSON.stringify(data)), nowISO(), d, dataRev(uid));
  /* пересобрать документы человека; which — какие (по умолчанию все, месяцы — только новые и за последний год) */
  function rebuild(uOrId, d, which = null) {
    const u = typeof uOrId === 'object' ? uOrId : userById.get(uOrId); if (!u) return null;
    const want = (k) => !which || which.includes(k);
    const out = {};
    if (want('profile')) { out.profile = buildProfile(u, d); save(u.id, 'profile', out.profile, d); }
    if (want('readings')) { out.readings = buildReadings(u); save(u.id, 'readings', out.readings, d); }
    if (want('recent')) { out.recent = buildRecent(u, d); save(u.id, 'recent', out.recent, d); }
    if (want('portrait')) { out.portrait = buildPortrait(u, d); save(u.id, 'portrait', out.portrait, d); }
    if (want('months')) {
      const have = new Set(listDocs.all(u.id).map((r) => r.doc));
      const yearAgo = monthOf(addDays(d, -366));
      for (const ym of monthsOutside(u.id, d)) {
        if (have.has('month:' + ym) && ym < yearAgo) continue;   /* старше года — не трогаем: править можно только год назад */
        const m = buildMonth(u, ym);
        if (m.daysWithRecords || m.cards.length || m.gratitudes.length) save(u.id, 'month:' + ym, m, d);
        else if (have.has('month:' + ym)) db.prepare('DELETE FROM knowledge WHERE user_id = ? AND doc = ?').run(u.id, 'month:' + ym);   /* пустой месяц — без отчета */
      }
    }
    return out;
  }
  /* прочитать документ; нет, вчерашний или собранный до последнего изменения данных (rev) — собрать заново (R08).
     Месячный отчет за пределами года правки заморожен; в пределах года — тоже следует за ревизией */
  const fresh = (row, uid, d) => row && row.day === d && Number(row.rev || 0) === dataRev(uid);
  function read(u, doc, d) {
    if (doc.startsWith('month:')) {
      const ym = doc.slice(6), row = getDoc.get(u.id, doc);
      if (row && (ym < monthOf(addDays(d, -366)) || Number(row.rev || 0) === dataRev(u.id))) return parse(open(row.json));
      if (!monthsOutside(u.id, d).includes(ym)) return row ? parse(open(row.json)) : null;
      const data = buildMonth(u, ym); save(u.id, doc, data, d); return data;
    }
    if (!DOC_TITLES[doc]) return null;
    const row = getDoc.get(u.id, doc);
    if (fresh(row, u.id, d)) return parse(open(row.json));
    return row ? rebuild(u, d, [doc])[doc] : rebuild(u, d)[doc];   /* первое обращение собирает всю папку, устаревший документ — только себя */
  }
  /* когда собран документ — для подписи «Собрано …» там, где задержка допустима */
  const builtAt = (uid, doc) => (getDoc.get(uid, doc) || {}).updated_at || '';
  const ORDER = ['profile', 'portrait', 'recent', 'readings'];
  function list(u, d) {
    if (d && !getDoc.get(u.id, 'recent')) rebuild(u, d);
    return listDocs.all(u.id).map((r) => ({ doc: r.doc, title: r.doc.startsWith('month:') ? 'Отчет · ' + monthTitle(r.doc.slice(6)) : DOC_TITLES[r.doc] || r.doc, updated: r.updated_at, day: r.day, size: r.size }))
      .sort((a, b) => (ORDER.indexOf(a.doc) + 1 || 99) - (ORDER.indexOf(b.doc) + 1 || 99) || b.doc.localeCompare(a.doc));   /* сначала четыре основных, потом отчеты — свежие выше */
  }
  function wipe(uid) { db.prepare('DELETE FROM knowledge WHERE user_id = ?').run(uid); }
  /* кого пересобрать сегодня: у кого «Последних записей» нет или они не за сегодняшний день (день — по поясу человека) */
  function staleUsers(dayOf) {
    return db.prepare("SELECT u.* FROM users u LEFT JOIN knowledge k ON k.user_id = u.id AND k.doc = 'recent' WHERE u.onboarded = 1").all().filter((u) => { const row = getDoc.get(u.id, 'recent'); return !row || row.day !== dayOf(u); });
  }
  /* совместимость — в журнал (compat_checks), документ «Тесты и совместимости» пересобирается сразу */
  function compatSave(u, d, r) {
    db.prepare('INSERT INTO compat_checks (user_id, ts, day, other_birth, total, rings, you, other, text) VALUES (?,?,?,?,?,?,?,?,?)').run(u.id, nowISO(), d, r.otherBirth, r.total, JSON.stringify(r.rings), r.you, r.other, seal(r.text));
    rebuild(u, d, ['readings']);
  }

  /* ── документ текстом — для ИИ ── */
  const L = (arr) => arr.filter(Boolean).join('\n');
  function textProfile(p) {
    const who = [p.name, p.age ? (p.age === 'до 25' ? 'до 25 лет' : `${p.age} лет`) : '', p.sign ? `${p.sign.name} (${p.sign.element})` : ''].filter(Boolean).join(', ');
    const out = ['ОБО МНЕ', `${who || 'Имя не указано'}. ${p.birth ? `Родилась ${fmt(p.birth)}${p.birthTime ? ` в ${p.birthTime}` : ''}${p.city ? `, ${p.city}` : ''}.` : 'Дата рождения не указана.'}`];
    if (p.sign?.trait) out.push(`Черта знака: ${p.sign.trait}.`);
    if (p.numerology) { const n = p.numerology; out.push(`Число судьбы ${n.destiny.n} — ${n.destiny.title}. ${n.destiny.text}`, `Личный год ${n.year.n}${n.year.planet ? ` (${n.year.planet} · ${n.year.energy})` : ''}, с ${fmt(n.year.from)} по ${fmt(addDays(n.year.to, -1))}. ${n.year.text}`); }
    if (p.lunarBirth) out.push(`Лунный день рождения: ${p.lunarBirth.n}-й${p.lunarBirth.title ? ` — ${p.lunarBirth.title}` : ''}${p.lunarBirth.uncertain ? ' (без времени рождения — приблизительно)' : ''}.`);
    if (p.natal) {
      const n = p.natal;
      out.push('', `НАТАЛЬНАЯ КАРТА (${n.zodiac}${n.houseSystem ? `, дома — ${n.houseSystem}` : ''}${n.timeKnown ? '' : '; время рождения неизвестно — дома и Асцендент не считаются, Луна взята на полдень'})`);
      if (n.summary && n.summary.length) { out.push('Резюме:'); for (const s of n.summary) out.push(`${s.title} — ${s.gist}`); out.push(''); }
      if (n.balance) out.push(`Стихии: ${Object.entries(n.balance.elements).map(([k, v]) => `${k} ${v}`).join(', ')}; кресты: ${Object.entries(n.balance.modalities).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
      for (const pl of n.planets) out.push(`${pl.name} ${pl.signIn || 'в ' + pl.sign}, ${pl.degree}${pl.house ? `, ${pl.house}-й дом` : ''}${pl.retro ? ', ретроградная' : ''}${pl.inSign ? ` — ${pl.inSign.text}` : ''}${pl.inHouse ? ` В ${pl.house}-м доме: ${pl.inHouse.text}` : ''}`);
      for (const pt of n.points) if (pt.meaning || pt.name === 'Асцендент' || pt.name === 'MC') out.push(`${pt.name} ${pt.signIn || 'в ' + pt.sign}${pt.degree ? `, ${pt.degree}` : ''}${pt.meaning ? ` — ${pt.meaning.text}` : ''}`);
      if (n.aspects.length) { out.push('Аспекты:'); for (const a of n.aspects) out.push(`${a.a} ${a.aspect.toLowerCase()} ${a.b} (орб ${a.orb}°)${a.meaning ? ` — ${a.meaning.text}` : ''}`); }
    }
    out.push(`В Лунарио с ${p.since ? fmt(p.since) : '—'}${p.streak ? `, серия ${p.streak} ${plural(p.streak, 'день', 'дня', 'дней')} подряд` : ''}.`);
    return L(out);
  }
  function textReadings(r) {
    const out = ['ТЕСТЫ И СОВМЕСТИМОСТИ'];
    out.push(r.tests.length ? `Тесты: ${r.tests.length}.` : 'Тестов еще не было.');
    if (!r.compat.length) out.push('Совместимость не считали.');
    for (const c of r.compat) out.push(`${fmt(c.day)}: ${c.you} и ${c.other} (партнер ${fmt(c.otherBirth)}) — ${c.total}%: ${c.rings.map(([k, v]) => `${k} ${v}`).join(', ')}. ${c.text}`);
    return L(out);
  }
  function textDay(r) {
    const parts = [];
    if (r.lunar) parts.push(`${r.lunar.n}-й лунный день${r.lunar.title ? ` — ${r.lunar.title}` : ''}`);
    if (r.moods) parts.push(`настроение: ${r.moods.map((m) => m.label.toLowerCase()).join(', ')}`);
    if (r.morning) parts.push(`настрой утра: «${r.morning.set}»`);
    if (r.card) parts.push(`карта дня — ${r.card.name}`);
    if (r.rune) parts.push(`руна дня — ${r.rune.name}`);
    const lines = [`${fmt(r.day)}${parts.length ? ' · ' + parts.join('; ') : ''}`];
    /* по одной строке на каждую запись вида, в порядке id (F08); нечитаемая — названа, а не пропущена молча (F14) */
    const quote = (label, x) => x.unreadable ? `${label}: запись не удалось расшифровать` : `${label}: «${x.text}»`;
    for (const t of r.texts || []) lines.push(quote('Запись', t));
    for (const g of r.gratitudes || []) lines.push(quote('Благодарность', g));
    for (const a of r.answers || []) lines.push(a.unreadable ? 'Вопрос дня — ответ не удалось расшифровать' : `Вопрос дня «${a.question}» — ответ: «${a.text}»`);
    for (const t of r.thoughts || []) lines.push(t.unreadable ? `Мысль к ${t.name || t.about}: не удалось расшифровать` : `Мысль к ${t.name || t.about}: «${t.text}»`);
    for (const a of r.asks || []) { const list = a.cards?.length ? a.cards : a.runes?.length ? a.runes : []; lines.push(`${a.kindRu}${a.topic ? ` (${a.topic})` : ''}: «${a.question}» → ${a.answer}${list.length > 1 ? ` (${list.join(', ')})` : ''}`); }
    if (r.habits) lines.push(`Привычки: ${r.habits.join(', ')} ✓`);
    for (const a of r.askesis || []) lines.push(`Аскеза «${a.title}»: ${a.kept ? 'держусь' : 'сорвалась'}${a.note ? ` — «${a.note}»` : ''}`);
    if (r.weekly) lines.push(`Итог недели: «${r.weekly}»`);
    if (r.photo) lines.push('Есть фото дня.');
    return lines.join('\n');
  }
  function textRecent(r) { return L(['ПОСЛЕДНИЕ ЗАПИСИ', `С ${fmt(r.from)} по ${fmt(r.to)} — ${r.days.length} ${plural(r.days.length, 'день', 'дня', 'дней')} с записями.`, ...(r.days.length ? r.days.map(textDay) : ['Записей пока нет.'])]); }
  function textMonth(m) {
    const out = [`ОТЧЕТ · ${m.title.toUpperCase()}`, `Дней с записями: ${m.daysWithRecords}, записей в дневнике: ${m.notes}${Object.keys(m.asks).length ? `, обращений: ${Object.entries(m.asks).map(([k, n]) => `${k} — ${n}`).join(', ')}` : ''}.`];
    for (const w of m.moods.byWeek) out.push(`Неделя с ${fmt(w.week)}: ${w.days.map((x) => `${x.day.slice(8)} — ${x.moods.join('/')}`).join(', ')}${w.dominant ? `; чаще всего — ${w.dominant.toLowerCase()}` : ''}${w.reflection ? `. Итог недели: «${w.reflection}»` : ''}`);
    if (m.gratitudes.length) { out.push('Благодарности:'); for (const g of m.gratitudes) out.push(`${fmt(g.day)}: «${g.text}»`); }
    for (const a of m.askesis) out.push(`Аскеза «${a.title}»: держалась ${a.kept} ${plural(a.kept, 'день', 'дня', 'дней')}${a.failed ? `, срывов ${a.failed}` : ''}${a.days.filter((x) => x.note).length ? '; заметки: ' + a.days.filter((x) => x.note).map((x) => `${x.day.slice(8)} — «${x.note}»`).join('; ') : ''}`);
    for (const h of m.habits) out.push(`Привычка «${h.title}»: отмечена ${h.done.length} ${plural(h.done.length, 'раз', 'раза', 'раз')}`);
    if (m.cards.length) out.push(`Карты дня: ${m.cards.map((c) => `${c.day.slice(8)} ${c.name}`).join(', ')}`);
    return L(out);
  }
  function textPortrait(p) {
    const out = ['ПОРТРЕТ', `В Лунарио с ${p.since ? fmt(p.since) : '—'}${p.streak ? `, серия ${p.streak} ${plural(p.streak, 'день', 'дня', 'дней')} подряд` : ''}${p.firstCard ? `. Первой картой была ${p.firstCard.name} (${fmt(p.firstCard.day)})` : ''}.`,
      `Дней с записями: ${p.counts.days}, записей: ${p.counts.notes}, благодарностей: ${p.counts.gratitudes}, обращений: ${p.counts.asks}, карт дня: ${p.counts.cards}, желаний: ${p.counts.wishes}${p.counts.wishesDone ? ` (исполнено ${p.counts.wishesDone})` : ''}.`];
    if (p.moods90.length) out.push(`Настроения за 90 дней (все отметки: ${p.moodMarks90 || 0} за ${p.moodDays90 || 0} ${plural(p.moodDays90 || 0, 'день', 'дня', 'дней')}): ${p.moods90.map((m) => `${m.mood.toLowerCase()} ${m.share}%`).join(', ')}.`);
    if (p.topics.length) out.push(`Темы вопросов: ${p.topics.map((t) => `${t.topic} — ${t.n}`).join(', ')}${p.mainTopic ? `. Чаще всего возвращается к теме «${p.mainTopic}»` : ''}.`);
    if (p.favoriteMethod) out.push(`Любимый способ ответа: ${p.favoriteMethod}.`);
    if (p.frequentCards.length) out.push(`Чаще всего приходили карты: ${p.frequentCards.map((c) => `${c.name} (${c.n})`).join(', ')}.`);
    if (p.habits.length) out.push(`Привычки: ${p.habits.map((h) => `${h.title} — ${h.streak} ${plural(h.streak, 'день', 'дня', 'дней')} подряд`).join('; ')}.`);
    if (p.askesis.length) out.push(`Аскезы: ${p.askesis.map((a) => `${a.title} — день ${a.done} из ${a.total}`).join('; ')}.`);
    if (p.wishes.length) out.push(`Желания: ${p.wishes.map((w) => `«${w.text}»${w.done ? ' ✓' : ''}`).join(', ')}.`);
    return L(out);
  }
  function text(u, doc, d) {
    const data = read(u, doc, d); if (!data) return '';
    if (doc === 'profile') return textProfile(data); if (doc === 'readings') return textReadings(data);
    if (doc === 'recent') return textRecent(data); if (doc === 'portrait') return textPortrait(data);
    return textMonth(data);
  }
  return { rebuild, read, list, text, wipe, staleUsers, compatSave, builtAt, RECENT_DAYS, DOC_TITLES };
}
