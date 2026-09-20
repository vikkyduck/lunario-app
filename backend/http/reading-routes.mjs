/* Карта дня, руна дня, вопрос «да/нет» и руны, расклад, натальная карта, нумерология, совместимость.
   Тонкий HTTP-слой поверх server.mjs: возвращает true, если запрос обработан. */
import { isDay } from '../util.mjs';
/* открытый вопрос — начинается с вопросительного слова, на которое «да» или «нет» не отвечают; «как думаешь, стоит ли…» — все же про да/нет */
const OPEN_Q = /^[«"'\s]*(как|что|почему|зачем|когда|где|куда|откуда|кто|кого|кому|кем|чем|чего|сколько|какой|какая|какое|какие|каким|какую|о чем)(?![а-я\u0451])/iu;   /* \b в JS не знает кириллицы — граница слова задана явно */
const YESNO_LEAD = /^[«"'\s]*как\s+(думае|счита|по-твоему|по-вашему|вы\s+думаете|вы\s+считаете)/iu;
export function createReadingRoutes({ compatSave, natalMeanings, C, cardOfDay, cardPublic, clean, DAILY_WRITES, dayNum, db, destinyNum, drawDistinct, hash32, ISO_DAY, json, markOpened, Morning, natalFor, nowISO, numFormula, parseData, personalYearAt, readBody, runePublic, seal, signOf, topicOf, touchStreak, track }) {
  return async function readingRoutes({ p, req, res, url, u, d }) {
    /* ── натальная карта: считается на лету по анкете, ничего не хранится ── */
    if (p === '/api/natal' && req.method === 'GET') {
      if (!ISO_DAY.test(u.birth || '')) return json(res, 400, { ok: false, error: 'no_birth' });
      const chart = natalFor(u);
      if (!url.searchParams.has('quiet')) track(u, 'natal_view', chart.timeKnown ? 'with_time' : 'no_time');   /* quiet — карточка на «Обо мне», а не открытие карты */
      return json(res, 200, { ...chart, meanings: natalMeanings(chart) });   /* значения из контента и резюме по правилам — те же, что в базе знаний */
    }
    /* Карта дня: тянется случайно, один раз в день, и сразу ложится в историю. Повторное нажатие
       возвращает ту же карту — колода на сегодня уже открыта. */
    if (p === '/api/card' && req.method === 'POST') {
      let card = cardOfDay(u, d);
      if (card) markOpened(u, d, 'card', 'card_open', (Morning.cardOfDay(u, d) || {}).slug || '');
      if (!card) {
        const a = drawDistinct([...C.ARCANA], 1)[0];
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, 'card', '', a.name, a.keys, JSON.stringify({ card: a.slug }));
        card = cardPublic(a); track(u, 'card_open', a.slug);
      }
      return json(res, 200, { ok: true, card, streak: touchStreak(u) });
    }
    /* Руна дня: как карта дня — одна на день, запоминается в entries (kind dayrune), повторное открытие возвращает ту же */
    if (p === '/api/dayrune' && req.method === 'POST') {
      const row = db.prepare("SELECT data FROM entries WHERE user_id=? AND day=? AND kind='dayrune' ORDER BY id DESC LIMIT 1").get(u.id, d);
      const slug = (parseData(row && row.data) || {}).rune;
      let rune = slug ? [...C.RUNES].find((r) => r.slug === slug) : null;
      if (rune) markOpened(u, d, 'dayrune', 'dayrune_open', slug);
      if (!rune) {
        rune = drawDistinct([...C.RUNES], 1)[0];
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, 'dayrune', '', rune.name, rune.answer, JSON.stringify({ rune: rune.slug, layout: 'one', runes: [rune.slug] }));
        track(u, 'dayrune_open', rune.slug);
      }
      return json(res, 200, { ok: true, day: d, rune: runePublic(rune) });
    }
    if (p === '/api/ask' && req.method === 'POST') {
      const b = await readBody(req);
      const q = clean(b.question, 300);
      if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
      if (db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = ? AND day = ?').get(u.id, d).c >= DAILY_WRITES) return json(res, 429, { ok: false, error: 'too_many' });
      const kind = b.kind === 'rune' ? 'rune' : 'yesno';
      /* «Как…», «что…», «почему…» — не вопрос про да или нет (аудит v98, F19): ответ не тянется, экран предлагает руны, карты или другую формулировку */
      if (kind === 'yesno' && OPEN_Q.test(q) && !YESNO_LEAD.test(q)) return json(res, 400, { ok: false, error: 'open_question' });
      const topic = topicOf(q);
      let title, body, extra = {}, stored = kind, data = '';
      if (kind === 'rune') {
        /* руны выпадают случайно, без повторов внутри расклада; одна руна — kind «rune», расклад — «runes» */
        const L = C.LAYOUTS.rune[b.layout] ? b.layout : 'one';
        const pos = C.LAYOUTS.rune[L].pos;
        const runes = drawDistinct([...C.RUNES], pos.length).map((r, i) => ({ pos: pos[i].name, ...runePublic(r) }));
        title = runes.map((r) => r.name).join(' · ');
        body = L === 'one' ? runes[0].answer : runes.map((r) => `${r.pos}: ${r.name} — ${r.answer}`).join(' ');
        stored = L === 'one' ? 'rune' : 'runes';
        data = JSON.stringify({ layout: L, runes: runes.map((r) => r.slug) });
        extra = { layout: L, runes, path: runes[0].path };
      } else {
        const i = hash32(q) % 3;
        title = C.YN_VERDICTS[i]; body = C.YN_RIDERS[topic][i];
      }
      const ins = db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
        .run(u.id, nowISO(), d, stored, seal(q), title, body, data);
      track(u, kind === 'rune' ? 'ask_rune' : 'ask_yesno', kind === 'rune' ? extra.layout : topic);
      const prev = db.prepare("SELECT title, day FROM entries WHERE user_id=? AND kind='yesno' AND day<? AND title<>? ORDER BY id DESC LIMIT 1").get(u.id, d, title);
      return json(res, 200, { ok: true, kind, entry: Number(ins.lastInsertRowid), title, body, topic, ...extra, streak: touchStreak(u), memory: kind === 'yesno' && prev ? { title: prev.title, day: prev.day } : null });   /* entry — id результата: к нему привязывается мысль (F13) */
    }
    if (p === '/api/spread' && req.method === 'POST') {
      const b = await readBody(req);
      const q = clean(b.question, 300);
      if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
      /* Дневного лимита раскладов нет (решение владелицы 18.09: лимит был на случай платных ИИ-разборов, а тексты — свои).
         Счетчик usage.spreads остается для статистики. Карты выпадают случайно и не повторяются внутри расклада */
      const L = C.LAYOUTS.tarot[b.layout] ? b.layout : 'three';
      const pos = C.LAYOUTS.tarot[L].pos;
      const cards = drawDistinct([...C.ARCANA], pos.length).map((a, i) => ({ pos: pos[i].name, ...cardPublic(a) }));
      db.prepare('INSERT INTO usage (user_id, day, spreads) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET spreads = spreads + 1').run(u.id, d);
      const ins = db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
        .run(u.id, nowISO(), d, 'spread', seal(q), cards.map((c) => c.name).join(' · '), cards.map((c) => `${c.pos}: ${c.name} — ${c.keys}`).join(' '),
             JSON.stringify({ layout: L, cards: cards.map((c) => c.slug) }));
      track(u, 'ask_spread', L);
      return json(res, 200, { ok: true, entry: Number(ins.lastInsertRowid), layout: L, cards, streak: touchStreak(u) });
    }
    if (p === '/api/numerology' && req.method === 'GET') {
      if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
      const dn = destinyNum(u.birth), dd = dayNum(d), py = personalYearAt(u.birth, d);
      return json(res, 200, {
        destiny: { n: dn, title: C.NUM_DESTINY[dn][0], text: C.NUM_DESTINY[dn][1], formula: numFormula(u.birth) },
        year: { ...py, text: C.NUM_YEAR[py.n], info: C.YEARS[py.n] || null },
        day: { n: dd, text: C.NUM_DAY[dd] },
      });
    }
    if (p === '/api/compat' && req.method === 'POST') {
      const b = await readBody(req);
      const other = clean(b.birth, 10);
      if (!isDay(other)) return json(res, 400, { ok: false, error: 'bad_birth' });
      if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
      const a = signOf(u.birth), o = signOf(other);
      const seed = hash32([u.birth, other].sort().join('|'));
      const mk = (k, lo, hi) => lo + (hash32(seed + k) % (hi - lo + 1));
      const rings = [['Эмоции', mk('e', 55, 95)], ['Общение', mk('c', 50, 95)], ['Быт', mk('b', 45, 90)], ['Страсть', mk('p', 55, 95)]];
      track(u, 'compat_calc', '');
      const total = Math.round(rings.reduce((s, r) => s + r[1], 0) / rings.length);
      const out = {
        total, rings, you: a.name, other: o.name,
        // черта знака в контенте может уже начинаться с «вы …» — не дублируем обращение
        text: `${a.name} и ${o.name}. ${/^вы\s/i.test(a.trait) ? a.trait[0].toUpperCase() + a.trait.slice(1) : 'Вы ' + a.trait}; партнер — ${o.trait}. Это союз, который растет, когда каждый уважает темп другого.`,
      };
      compatSave(u, d, { ...out, otherBirth: other });   /* расчет — в журнал и в документ «Тесты и совместимости» базы знаний */
      return json(res, 200, out);
    }
    return false;
  };
}
