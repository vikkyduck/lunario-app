/* Карточка дня в Дневнике — «Запомнить этот день».
   Один экран и один запрос, но данные — каждое своим типом: запись, благодарность и ответ на вопрос дня — три строки journal
   с разными kind; настроения — mood_marks (несколько за день) плюс «главное» в moods для старых экранов и отчетов;
   привычки — habit_marks; аскеза — askesis_days (держусь / сорвалась, заметка). Ничего не разбирается и не режется:
   текст хранится целиком, предложением самого человека.
   Пустая ячейка при сохранении = «не менять»: случайно стереть запись нельзя. Зависимости — явным объектом, как у createKnowledge.
   Записей одного вида за день может быть несколько (старые версии писали отдельной панелью): экран получает их все списком
   (texts, gratitudes, answers), а «ячейка» для правки — последнюю; удаляется одна запись по ее id (аудит v98, F01, F17). */
import { createMutation } from './mutation.mjs';
import { addDays, isDay } from './util.mjs';
import { VERDICTS } from './week.mjs';
import { createMoods } from './moods.mjs';
import { countActiveDays, activeDays } from './day-sources.mjs';

export function createDay({ db, seal, open, readable = null, sealBytes = null, openBytes = null, C, habitList, askesisList, track, touchStreak, nowISO, cleanText, clean, dayWritten = null, questionOf, morningOf = () => null, themeTitle = (k) => k, lunarOf = () => null, dailyWrites = 100, mutate = null }) {
  const KINDS = { text: '', gratitude: 'gratitude', answer: 'answer' };
  /* все записи дня — через единый путь записи (mutation.mjs, F04): изменение и ревизия личных данных одной транзакцией */
  const write = mutate || createMutation(db);
  const latest = (uid, d, kind) => db.prepare('SELECT id, text, title FROM journal WHERE user_id = ? AND day = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(uid, d, kind);
  /* ячейка дня: запись не расшифровалась (чужой ключ, испорченные данные) — { text: null, unreadable: true }, не пустая строка (ревью v114, F14) */
  const read = readable || ((s) => ({ text: open(s), unreadable: false }));
  const cell = (row) => { if (!row) return null; const t = read(row.text), h = read(row.title || ''); return { id: row.id, text: t.text, title: h.unreadable ? null : h.text, ...(t.unreadable || h.unreadable ? { unreadable: true } : {}) }; };
  const allOf = (uid, d, kind) => db.prepare('SELECT id, text, title FROM journal WHERE user_id = ? AND day = ? AND kind = ? ORDER BY id').all(uid, d, kind).map(cell);
  const moodOk = (m) => /^own:[^\s|]{1,24}$/u.test(m) || !!C.moodInfo(m);
  const Moods = createMoods(db);
  const moodsOf = (uid, d) => Moods.ofDay(uid, d);
  /* утро дня, как оно выпало: настрой, вопрос и тема — из daily_sets; для прошлых дней ничего не тянется заново */
  const morningStored = (uid, d) => { const r = db.prepare('SELECT text, question, theme FROM daily_sets WHERE user_id = ? AND day = ?').get(uid, d); return r && r.text ? { set: r.text, question: r.question || '', theme: themeTitle(r.theme || '') } : null; };
  const echoOf = (uid, d) => (db.prepare('SELECT verdict FROM week_echoes WHERE user_id = ? AND day = ?').get(uid, d) || {}).verdict || '';
  /* Мысль к материалу (карта, руна, расклад): journal kind='thought', в title — источник JSON {source, slug, name, question, entry}.
     Карта и руна дня — одна мысль в день; вопрос к рунам или картам — мысль привязана к конкретному результату (entry — id в entries):
     две Феху на два вопроса — две мысли (аудит v98, F13). Повторная отправка к тому же результату обновляет, не плодит */
  const THOUGHT_SOURCES = ['card', 'dayrune', 'rune', 'runes', 'spread'];
  const thoughtMeta = (row) => { try { const m = JSON.parse(open(row.title || '')); return m && typeof m === 'object' ? m : {}; } catch { return {}; } };
  const thoughtsOf = (uid, d) => db.prepare("SELECT id, day, text, title FROM journal WHERE user_id = ? AND day = ? AND kind = 'thought' ORDER BY id").all(uid, d)
    .map((r) => { const m = thoughtMeta(r); return { id: r.id, day: r.day, text: open(r.text), source: m.source || '', slug: m.slug || '', name: m.name || '', question: m.question || '', entry: Number(m.entry) || 0 }; });
  function thoughtSave(u, d, b) {
    const source = THOUGHT_SOURCES.includes(b.source) ? b.source : '';
    const slug = clean(b.slug, 60), name = clean(b.name, 120), question = clean(b.question, 300), text = cleanText(b.text, 2000);
    if (!source || !slug) return { ok: false, error: 'bad_source' };
    if (text.length < 2) return { ok: false, error: 'short' };
    /* результат — свой: чужой или несуществующий id не привязывается */
    const entry = Number(b.entry) > 0 && db.prepare('SELECT 1 FROM entries WHERE id = ? AND user_id = ?').get(Number(b.entry), u.id) ? Number(b.entry) : 0;
    const meta = JSON.stringify({ source, slug, name, question, ...(entry ? { entry } : {}) });
    const prev = thoughtsOf(u.id, d).find((t) => t.source === source && t.slug === slug && (t.entry || 0) === entry);
    const out = write(u.id, () => {
      if (prev) { db.prepare('UPDATE journal SET text = ?, title = ? WHERE id = ? AND user_id = ?').run(seal(text), seal(meta), prev.id, u.id); return { ok: true, updated: true, item: { ...prev, text, name, question, entry } }; }
      if (db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c >= dailyWrites) return { ok: false, error: 'too_many', limit: dailyWrites };
      const r = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), 'thought', seal(meta));
      return { ok: true, item: { id: Number(r.lastInsertRowid), day: d, text, source, slug, name, question, entry } };
    });
    if (out.ok) { track(u, 'thought_save', out.updated ? source + ':update' : source); if (!out.updated) touchStreak(u); }
    return out;
  }
  const photoMeta = (uid, d) => db.prepare('SELECT ts, w, h FROM day_photos WHERE user_id = ? AND day = ?').get(uid, d) || null;

  function state(u, d, { today = true } = {}) {
    const kept = new Map(db.prepare('SELECT askesis_id, kept, note FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ?').all(u.id, d).map((n) => [n.askesis_id, n]));
    /* сегодняшнее утро — то же, что на «Сегодня»: вечер продолжает его; прошлый день (дописать вчера, поправить запись) — утро как оно выпало, без дорисовки */
    const m = today ? morningOf(u, d) : morningStored(u.id, d);
    return {
      day: d, today, question: today ? questionOf(u, d) : (m ? m.question : ''), set: m ? m.set : '', theme: m ? m.theme : '', echo: echoOf(u.id, d), photo: photoMeta(u.id, d), lunar: lunarOf(u, d),
      text: cell(latest(u.id, d, '')), gratitude: cell(latest(u.id, d, 'gratitude')), answer: cell(latest(u.id, d, 'answer')), thoughts: thoughtsOf(u.id, d),
      ...entriesOf(u.id, d), moods: moodsOf(u.id, d),
      habits: habitList(u.id, d).map((h) => ({ id: h.id, title: h.title, due: h.due, today: h.today, rule: h.rule })),
      askesis: askesisList(u.id, d).active.map((a) => { const n = kept.get(a.id); return { id: a.id, title: a.title, done: a.done, total: a.total, left: a.left, kept: n ? !!n.kept : null, note: n ? open(n.note || '') : '' }; }),
    };
  }

  /* все записи дня по видам — экран показывает каждую, удаляет по одной; итог недели (kind='weekly') лежит под воскресеньем */
  const entriesOf = (uid, d) => ({ texts: allOf(uid, d, ''), gratitudes: allOf(uid, d, 'gratitude'), answers: allOf(uid, d, 'answer'), weekly: cell(latest(uid, d, 'weekly')) });
  /* Правка задним числом — до года назад (day-routes); день старше отдается только для чтения, и экран знает это заранее (аудит v98, F18) */
  const EDIT_DAYS = 366;
  const editableFrom = (today) => addDays(today, -EDIT_DAYS);
  const editable = (d, today) => d <= today && d >= editableFrom(today);
  /* Прошлый день целиком — для чтения: утро (настрой, вопрос, тема), записи, настроение, «отозвалось», привычки и аскеза за день */
  function view(u, d, today = d) {
    const m = morningStored(u.id, d);
    return {
      day: d, set: m ? m.set : '', question: m ? m.question : '', theme: m ? m.theme : '', echo: echoOf(u.id, d), photo: photoMeta(u.id, d), lunar: lunarOf(u, d),
      editable: editable(d, today), editableFrom: editableFrom(today),
      text: cell(latest(u.id, d, '')), gratitude: cell(latest(u.id, d, 'gratitude')), answer: cell(latest(u.id, d, 'answer')), thoughts: thoughtsOf(u.id, d),
      ...entriesOf(u.id, d), moods: moodsOf(u.id, d),
      habits: db.prepare('SELECT h.title FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day = ? ORDER BY h.id').all(u.id, d).map((r) => open(r.title)),   /* названия хранятся зашифрованными — как в habitList */
      askesis: db.prepare('SELECT a.title, n.kept, n.note FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ? ORDER BY a.id').all(u.id, d).map((r) => ({ title: open(r.title), kept: !!r.kept, note: open(r.note || '') })),
    };
  }

  /* Сводка дня одной строкой — для списка «Прошлые дни»: первая запись, настроение, что еще записано, лунный день с названием (строка показывает только его — решение владелицы 20.09) */
  function summary(u, d) {
    const uid = u.id;
    const rows = db.prepare("SELECT kind, text FROM journal WHERE user_id = ? AND day = ? ORDER BY id DESC").all(uid, d);
    const first = rows.find((r) => r.kind === '') || rows.find((r) => r.kind === 'gratitude') || rows.find((r) => r.kind === 'answer') || rows.find((r) => r.kind === 'thought') || rows.find((r) => r.kind === 'weekly');
    const kinds = [];
    if (rows.some((r) => r.kind === 'weekly')) kinds.push('weekly');   /* итог недели под воскресеньем — виден в архиве и без других записей (R12) */
    if (rows.some((r) => r.kind === 'thought')) kinds.push('thought');
    if (rows.some((r) => r.kind === 'gratitude')) kinds.push('gratitude');
    if (rows.some((r) => r.kind === 'answer')) kinds.push('answer');
    if (db.prepare('SELECT 1 FROM habit_marks m JOIN habits h ON h.id = m.habit_id WHERE h.user_id = ? AND m.day = ? LIMIT 1').get(uid, d)) kinds.push('habits');
    if (db.prepare('SELECT 1 FROM askesis_days n JOIN askesis a ON a.id = n.askesis_id WHERE a.user_id = ? AND n.day = ? LIMIT 1').get(uid, d)) kinds.push('askesis');
    const moods = moodsOf(uid, d), m = morningStored(uid, d), ph = photoMeta(uid, d);
    const text = first ? open(first.text).replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    const ld = lunarOf(u, d);
    return { day: d, text, textKind: first ? first.kind || 'journal' : '', moods, kinds, theme: m ? m.theme : '', photo: ph ? ph.ts : '', lunar: ld ? ld.n : 0, lunarFrom: ld ? ld.nFrom || 0 : 0, lunarTitle: ld ? ld.title || '' : '', empty: (dayWritten ? !dayWritten(uid, d) : !moods.length && !ph) && !text };   /* «записан» — по правилу пуша и «Сегодня» (day-sources.mjs); текст любого вида — не пусто */
  }
  /* Список дней. calendar — последние n календарных дней до d (пустые тоже, с темой утра); иначе — только дни с записями, страницей до before */
  /* «дни с записями» — политика DAY_ACTIVE из day-sources.mjs: одна и та же для архива, страниц и счетчика (аудит v98 F08, v112 R12) */
  function days(u, d, { calendar = 0, before = '', limit = 30 } = {}) {
    const total = countActiveDays(db, u.id, d);   /* дней с записями до сегодня — по нему предлагаются шаги вечера */
    if (calendar) { const out = []; for (let i = 1; i <= calendar; i++) out.push(summary(u, addDays(d, -i))); return { items: out, next: null, total }; }
    const cut = isDay(before) ? before : d;
    const found = activeDays(db, u.id, cut, limit + 1);
    const page = found.slice(0, limit);
    return { items: page.map((x) => summary(u, x)), next: found.length > limit ? page[page.length - 1] : null, total };
  }

  /* Сохранение: все в одной транзакции — либо весь день записан, либо ничего (повтор с телефона безопасен).
     Дневной лимит строк проверяется до записи: сверх него — явный отказ too_many, ничего не пишется, текст остается в форме (аудит v98, F15).
     «Отозвалось» (echo) — в той же операции, а не отдельным запросом; пустая строка снимает отметку (F05).
     События и серия — после COMMIT: аналитика не должна отменять сохраненный день. */
  function save(u, d, b, { today = true } = {}) {
    const filled = [], events = [], emit = (t, x = '') => events.push([t, x]);
    const fresh = Object.entries(KINDS).filter(([field, kind]) => b[field] !== undefined && b[field] !== null && cleanText(b[field], 2000) && !latest(u.id, d, kind)).length;
    if (fresh && db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c + fresh > dailyWrites) return { ok: false, error: 'too_many', limit: dailyWrites };
    if (b.echo !== undefined && b.echo !== null && !(typeof b.echo === 'string' && (b.echo === '' || VERDICTS.includes(b.echo)))) return { ok: false, error: 'bad_echo' };
    /* нечитаемую запись не переписываем (F14): текст, который человек, возможно, еще восстановит из копии, не затирается новым */
    for (const [field, kind] of Object.entries(KINDS)) { if (b[field] === undefined || b[field] === null || !cleanText(b[field], 2000)) continue; const row = latest(u.id, d, kind); if (row && read(row.text).unreadable) return { ok: false, error: 'unreadable', field }; }
    const { rev } = write(u.id, () => {
      for (const [field, kind] of Object.entries(KINDS)) {
        if (b[field] === undefined || b[field] === null) continue;
        const text = cleanText(b[field], 2000); if (!text) continue;   /* пустое — не трогаем */
        const row = latest(u.id, d, kind);
        const title = kind === 'answer' ? clean(b.question || (today ? questionOf(u, d) : (morningStored(u.id, d) || {}).question || ''), 300) : '';
        if (row) { if (open(row.text) !== text) db.prepare('UPDATE journal SET text = ? WHERE id = ? AND user_id = ?').run(seal(text), row.id, u.id); }
        else { db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title)); emit(kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add'); }
        filled.push(field);
      }
      if (typeof b.echo === 'string' && b.echo !== echoOf(u.id, d)) {
        if (b.echo) db.prepare('INSERT INTO week_echoes (user_id, day, verdict, ts) VALUES (?,?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET verdict = excluded.verdict, ts = excluded.ts').run(u.id, d, b.echo, nowISO());
        else db.prepare('DELETE FROM week_echoes WHERE user_id = ? AND day = ?').run(u.id, d);
        emit('week_echo', b.echo || 'clear');
      }
      if (Array.isArray(b.moods)) {
        const moods = [...new Set(b.moods.map((m) => clean(m, 30)).filter(moodOk))].slice(0, 12);
        db.prepare('DELETE FROM mood_marks WHERE user_id = ? AND day = ?').run(u.id, d);
        for (const m of moods) db.prepare('INSERT OR IGNORE INTO mood_marks (user_id, day, mood) VALUES (?,?,?)').run(u.id, d, m);
        if (moods.length) { db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, moods[0]); emit('mood_set', moods[0].replace(/^own:.*/, 'own')); filled.push('moods'); }
        else db.prepare('DELETE FROM moods WHERE user_id = ? AND day = ?').run(u.id, d);
      }
      if (Array.isArray(b.habits)) {
        let touched = false;
        for (const it of b.habits) {
          const h = db.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(Number(it.id) || 0, u.id); if (!h) continue;
          const has = !!db.prepare('SELECT 1 FROM habit_marks WHERE habit_id = ? AND day = ?').get(h.id, d);
          if (it.done && !has) { db.prepare('INSERT INTO habit_marks (habit_id, day) VALUES (?,?)').run(h.id, d); emit('habit_mark', 'today'); touched = true; }
          if (!it.done && has) db.prepare('DELETE FROM habit_marks WHERE habit_id = ? AND day = ?').run(h.id, d);
        }
        if (touched) filled.push('habits');
      }
      if (Array.isArray(b.askesis)) {
        for (const it of b.askesis) {
          const a = db.prepare("SELECT id FROM askesis WHERE id = ? AND user_id = ? AND status = 'active'").get(Number(it.id) || 0, u.id); if (!a) continue;
          if (it.kept === undefined && it.note === undefined) continue;
          const prev = db.prepare('SELECT kept, note FROM askesis_days WHERE askesis_id = ? AND day = ?').get(a.id, d);
          const kept = it.kept === undefined ? (prev ? prev.kept : 1) : (it.kept ? 1 : 0);
          const note = it.note === undefined ? (prev ? prev.note : seal('')) : seal(cleanText(it.note, 500));
          db.prepare('INSERT INTO askesis_days (askesis_id, day, kept, note) VALUES (?,?,?,?) ON CONFLICT(askesis_id, day) DO UPDATE SET kept = excluded.kept, note = excluded.note').run(a.id, d, kept, note);
          emit('askesis_mark', kept ? 'kept' : 'missed'); if (!filled.includes('askesis')) filled.push('askesis');
        }
      }
      return { ok: true };
    });
    for (const [t, x] of events) track(u, t, x);
    /* деталь события: что заполнено; для прошлого дня — пометка past */
    if (filled.length) { if (today) touchStreak(u); track(u, 'day_save', [filled.join('|'), today ? '' : 'past'].filter(Boolean).join(' @')); }
    return { ok: true, saved: filled, rev, ...state(u, d, { today }) };
  }
  /* Убрать из дня одну запись: «text:12» — запись с этим id (и только ее); «text» без id — последнюю показанную;
     все записи вида за день — только явным «text:all». Настроение — все отметки дня; фото — своим маршрутом */
  function remove(u, d, what) {
    const m = /^(text|gratitude|answer|weekly)(?::(\d+|all))?$/.exec(what || '');
    if (m) {
      const kind = m[1] === 'text' ? '' : m[1], pick = m[2] || '';
      const out = write(u.id, () => {
        let r;
        if (pick === 'all') r = db.prepare('DELETE FROM journal WHERE user_id = ? AND day = ? AND kind = ?').run(u.id, d, kind);
        else if (pick) r = db.prepare('DELETE FROM journal WHERE user_id = ? AND day = ? AND kind = ? AND id = ?').run(u.id, d, kind, Number(pick));
        else { const last = latest(u.id, d, kind); r = last ? db.prepare('DELETE FROM journal WHERE id = ? AND user_id = ?').run(last.id, u.id) : { changes: 0 }; }
        return { ok: true, removed: r.changes };
      });
      track(u, 'day_remove', m[1] + (pick === 'all' ? ':all' : '')); return out;
    }
    if (/^thought:\d+$/.test(what || '')) { const out = write(u.id, () => ({ ok: true, removed: db.prepare("DELETE FROM journal WHERE user_id = ? AND day = ? AND kind = 'thought' AND id = ?").run(u.id, d, Number(what.slice(8))).changes })); track(u, 'day_remove', 'thought'); return out; }
    if (what === 'moods') { const out = write(u.id, () => { db.prepare('DELETE FROM mood_marks WHERE user_id = ? AND day = ?').run(u.id, d); return { ok: true, removed: db.prepare('DELETE FROM moods WHERE user_id = ? AND day = ?').run(u.id, d).changes }; }); track(u, 'day_remove', what); return out; }
    return { ok: false, error: 'bad_what' };
  }
  /* ── фото дня: один снимок на сегодня; миниатюра и полное — зашифрованными байтами; лимиты — на человека и на сутки ── */
  const PHOTO_MAX_FULL = 400 * 1024, PHOTO_MAX_THUMB = 40 * 1024, PHOTOS_PER_USER = 500, UPLOADS_PER_DAY = 30;
  function photoPut(u, d, { thumb, full, w, h }) {
    if (!sealBytes) return { ok: false, error: 'no_key' };
    if (!Buffer.isBuffer(thumb) || !Buffer.isBuffer(full) || !thumb.length || !full.length) return { ok: false, error: 'bad_photo' };
    if (full.length > PHOTO_MAX_FULL || thumb.length > PHOTO_MAX_THUMB) return { ok: false, error: 'too_big' };
    if (full[0] !== 0xff || full[1] !== 0xd8 || thumb[0] !== 0xff || thumb[1] !== 0xd8) return { ok: false, error: 'bad_photo' };   /* только JPEG — его и делает телефон */
    const have = db.prepare('SELECT 1 FROM day_photos WHERE user_id = ? AND day = ?').get(u.id, d);
    if (!have && db.prepare('SELECT COUNT(*) c FROM day_photos WHERE user_id = ?').get(u.id).c >= PHOTOS_PER_USER) return { ok: false, error: 'too_many' };
    if (db.prepare("SELECT COUNT(*) c FROM day_photos WHERE user_id = ? AND ts >= ?").get(u.id, new Date(Date.now() - 864e5).toISOString()).c >= UPLOADS_PER_DAY) return { ok: false, error: 'too_often' };
    const ts = nowISO();
    const out = write(u.id, () => { db.prepare('INSERT INTO day_photos (user_id, day, ts, w, h, thumb, full) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET ts = excluded.ts, w = excluded.w, h = excluded.h, thumb = excluded.thumb, full = excluded.full')
      .run(u.id, d, ts, Math.max(0, Math.trunc(w) || 0), Math.max(0, Math.trunc(h) || 0), sealBytes(thumb), sealBytes(full)); return { ok: true, photo: { ts, w, h } }; });
    track(u, 'day_photo', have ? 'replace' : 'add');
    return out;
  }
  function photoGet(u, day, size) {
    if (!openBytes) return null;
    const row = db.prepare(`SELECT ${size === 'full' ? 'full' : 'thumb'} AS data, ts FROM day_photos WHERE user_id = ? AND day = ?`).get(u.id, day);
    if (!row) return null;
    const bytes = openBytes(Buffer.from(row.data));
    return bytes ? { bytes, ts: row.ts } : null;
  }
  function photoDelete(u, d) { return write(u.id, () => ({ ok: true, removed: db.prepare('DELETE FROM day_photos WHERE user_id = ? AND day = ?').run(u.id, d).changes > 0 })); }
  return { state, save, remove, view, days, photoPut, photoGet, photoDelete, thoughtsOf, thoughtSave, editable, editableFrom, EDIT_DAYS };
}
