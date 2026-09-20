/* Настроение, дневник, желания и фото, лента записей, отчет по настроениям.
   Тонкий HTTP-слой поверх server.mjs: возвращает true, если запрос обработан. */
import { addDays } from '../util.mjs';
export function createJournalRoutes({ C, clean, cleanText, DAILY_WRITES, dataUrlOk, db, entryPage, json, nowISO, open_, readable, publicUser, readBody, seal, sendDataUrl, touchStreak, track, userById, userPhoto, weekSummary, WISHES_MAX, wishList, Moods, Receipts }) {
  /* Квитанции операций — receipts.mjs: ключ op от клиента, в квитанции только ссылка на запись (без текста); повтор отдает запись
     в актуальном виде или говорит, что она удалена; другой текст с тем же ключом — конфликт с найденной записью (R02, R04) */
  /* Запись ленты: не расшифровалась — { text: null, unreadable: true }, а не пустая строка и не 500 на всю ленту (ревью v114, F14) */
  const shape = (row) => { const t = readable(row.text), h = readable(row.title || ''); return { id: row.id, day: row.day, kind: row.kind, text: t.text, title: h.unreadable ? null : h.text, ...(t.unreadable || h.unreadable ? { unreadable: true } : {}) }; };
  const journalItem = (ref) => { const row = ref && ref.id ? db.prepare('SELECT id, day, text, kind, title FROM journal WHERE id = ? AND user_id = ?').get(ref.id, ref.uid) : null; return row ? shape(row) : null; };
  return async function journalRoutes({ p, req, res, url, u, d }) {
    if (p === '/api/mood' && req.method === 'POST') {
      const b = await readBody(req);
      const mood = clean(b.mood, 30);
      const own = /^own:[^\s|]{1,24}$/u.test(mood);   /* свое слово: «own:собранно» */
      if (!own && !C.moodInfo(mood)) return json(res, 400, { ok: false, error: 'bad_mood' });
      db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, mood);
      db.prepare('INSERT OR IGNORE INTO mood_marks (user_id, day, mood) VALUES (?,?,?)').run(u.id, d, mood);   /* карточка дня показывает все отмеченные */
      track(u, 'mood_set', mood.replace(/^own:.*/, 'own'));   /* свое слово — личный текст, в аналитику не идет */
      const month = d.slice(0, 7);
      return json(res, 200, { ok: true, mood, stats: Moods.summary(u.id, month + '-01', month + '-31').stats, streak: touchStreak(u) });
    }
    /* Дневник: обычная запись, благодарность («кому и за что я благодарна сегодня») или ответ на вопрос дня.
       Все лежит в одной ленте, вид записи подписан. */
    if (p === '/api/journal') {
      if (req.method === 'PATCH') {
        const b = await readBody(req), text = cleanText(b.text, 2000);
        const item = db.prepare("SELECT id, day, text FROM journal WHERE id=? AND user_id=? AND kind='gratitude'").get(Number(b.id) || 0, u.id);
        if (!item) return json(res, 404, { ok: false, error: 'not_found' });
        if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
        if (readable(item.text).unreadable) return json(res, 409, { ok: false, error: 'unreadable' });   /* нечитаемую запись не переписываем: ее еще можно восстановить из копии (F14) */
        db.prepare('UPDATE journal SET text=? WHERE id=? AND user_id=?').run(seal(text), item.id, u.id);
        return json(res, 200, { ok: true, item: { id: item.id, day: item.day, text } });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const text = cleanText(b.text, 2000);
        if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
        const kind = ['gratitude', 'answer'].includes(b.kind) ? b.kind : '';
        const title = clean(b.title, 300);
        /* ответ на вопрос дня — один на день: повторная отправка обновляет его, как и карточка дня в Дневнике */
        const prev = kind === 'answer' ? db.prepare("SELECT id FROM journal WHERE user_id = ? AND day = ? AND kind = 'answer' ORDER BY id DESC LIMIT 1").get(u.id, d) : null;
        if (!prev && db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c >= DAILY_WRITES) return json(res, 429, { ok: false, error: 'too_many', limit: DAILY_WRITES });
        const r = Receipts.run(u.id, b, { text, kind, title }, {
          load: (ref) => journalItem({ ...ref, uid: u.id }),
          write: () => {
            if (prev) { db.prepare('UPDATE journal SET text = ?, title = ? WHERE id = ? AND user_id = ?').run(seal(text), seal(title), prev.id, u.id); return { ref: { table: 'journal', id: prev.id, updated: true }, out: { ok: true, updated: true, item: { id: prev.id, day: d, text, kind, title } } }; }
            const inserted = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title));
            track(u, kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add', '');
            const id = Number(inserted.lastInsertRowid);
            return { ref: { table: 'journal', id }, out: { ok: true, streak: touchStreak(u), item: { id, day: d, text, kind, title } } };
          },
        });
        return json(res, r.status, r.out);
      }
      /* лента записей страницами: before — id последней показанной, next — с чего продолжать (аудит v98, F17) */
      const kind = url.searchParams.get('kind'), before = Math.max(0, Math.trunc(Number(url.searchParams.get('before'))) || 0), limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get('limit'))) || 60));
      const rows = db.prepare(`SELECT id, day, text, kind, title FROM journal WHERE user_id=? AND (?='' OR kind=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?`).all(u.id, kind || '', kind || '', before, before, limit + 1);
      const page = rows.slice(0, limit);
      return json(res, 200, { items: page.map(shape), next: rows.length > limit ? page[page.length - 1].id : null, today: !!(kind && page.find((r) => r.day === d)) });
    }
    /* Фото у желания — картинка для визуализации. Уменьшается в телефоне, хранится как есть, отдается только хозяйке. */
    if (p === '/api/wishes/photo') {
      const id = Number(url.searchParams.get('id') || 0);
      if (req.method === 'GET') {
        const w = db.prepare('SELECT photo FROM wishes WHERE id = ? AND user_id = ?').get(id, u.id);
        if (!w || !w.photo) { res.writeHead(404); return res.end(); }
        return sendDataUrl(res, w.photo);
      }
      if (req.method === 'POST') {
        const b = await readBody(req, 1024 * 1024);
        const wid = Number(b.id) || 0;
        if (!db.prepare('SELECT 1 FROM wishes WHERE id = ? AND user_id = ?').get(wid, u.id)) return json(res, 404, { ok: false, error: 'not_found' });
        const photo = dataUrlOk(b.photo, 600 * 1024); if (!photo) return json(res, 400, { ok: false, error: 'bad_photo' });
        db.prepare('UPDATE wishes SET photo = ?, photo_ts = ? WHERE id = ?').run(photo, nowISO(), wid);
        track(u, 'wish_photo', '');
      }
      if (req.method === 'DELETE') db.prepare("UPDATE wishes SET photo = '', photo_ts = '' WHERE id = ? AND user_id = ?").run(id, u.id);
      return json(res, 200, { items: wishList(u.id) });
    }
    /* Свое фото в аккаунте — показывается в кружке в правом верхнем углу */
    if (p === '/api/photo') {
      if (req.method === 'GET') { const photo = userPhoto(u.id); if (!photo) { res.writeHead(404); return res.end(); } return sendDataUrl(res, photo); }
      if (req.method === 'POST') {
        const b = await readBody(req, 512 * 1024);
        const photo = dataUrlOk(b.photo, 300 * 1024); if (!photo) return json(res, 400, { ok: false, error: 'bad_photo' });
        db.prepare('UPDATE users SET photo = ?, photo_ts = ? WHERE id = ?').run(photo, nowISO(), u.id);
        track(u, 'photo_set', '');
      }
      if (req.method === 'DELETE') db.prepare("UPDATE users SET photo = '', photo_ts = '' WHERE id = ?").run(u.id);
      return json(res, 200, { ok: true, user: publicUser(userById(u.id)) });
    }
    if (p === '/api/wishes') {
      if (req.method === 'POST') {
        const b = await readBody(req, 1024 * 1024);
        const text = clean(b.text, 200);
        if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
        const photo=b.photo ? dataUrlOk(b.photo,600*1024) : '';
        if (b.photo && !photo) return json(res,400,{error:'bad_photo'});
        /* тот же ключ op после потерянного ответа — то же желание, а не второе (R05); квитанция хранит только id */
        const r = Receipts.run(u.id, b, { text, photo: photo ? photo.length : 0 }, {
          load: (ref) => db.prepare('SELECT id FROM wishes WHERE id = ? AND user_id = ?').get(ref.id || 0, u.id) || null,
          write: () => {
            if (db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ?').get(u.id).c >= WISHES_MAX) return { ref: { table: 'wishes', id: 0, refused: 'too_many' }, out: { ok: false, error: 'too_many' } };
            const ins = db.prepare('INSERT INTO wishes (user_id, ts, text, photo, photo_ts) VALUES (?,?,?,?,?)').run(u.id, nowISO(), seal(text),photo,photo?nowISO():'');
            track(u, 'wish_add', photo ? 'photo' : '');
            return { ref: { table: 'wishes', id: Number(ins.lastInsertRowid) }, out: { ok: true } };
          },
        });
        if (r.out.error === 'too_many') return json(res, 429, r.out);
        if (r.status !== 200) return json(res, r.status, r.out);
        return json(res, 200, { items: wishList(u.id), ...(r.out.repeated ? { repeated: true, removed: !!r.out.removed } : {}) });
      } else if (req.method === 'PATCH') {
        const b = await readBody(req);
        db.prepare('UPDATE wishes SET done = CASE done WHEN 1 THEN 0 ELSE 1 END, done_ts = ? WHERE id = ? AND user_id = ?').run(nowISO(), Number(b.id) || 0, u.id);
      }
      return json(res, 200, { items: wishList(u.id) });
    }
    if (p === '/api/entries' && req.method === 'GET')
      return json(res, 200, entryPage(db,u.id,url.searchParams,open_));
    /* Отчет по настроениям: последние 7 дней по дням (все отметки, главная — первая), месяц по долям всех отметок, итог словами.
       Читает тот же контракт moods.mjs, что карточка дня и неделя (аудит v98, F10) */
    if (p === '/api/mood/report' && req.method === 'GET') {
      const w = weekSummary(u, d);
      const byWeek = Moods.byDay(u.id, addDays(d, -6), d);
      const week = []; for (let i = 6; i >= 0; i--) { const day = addDays(d, -i); const list = byWeek.get(day) || []; week.push({ day, mood: list[0] || '', moods: list }); }
      const month = d.slice(0, 7), m = Moods.summary(u.id, month + '-01', month + '-31');
      const total = db.prepare('SELECT COUNT(*) c FROM (SELECT day FROM moods WHERE user_id = ? UNION SELECT day FROM mood_marks WHERE user_id = ?)').get(u.id, u.id).c;
      const monthEntries = [...m.byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, list]) => ({ day, mood: list[0], moods: list }));
      return json(res, 200, { week, month: { key: month, stats: m.stats, entries: monthEntries, days: m.days, marks: m.total }, total, summary: w.summary });
    }
    return false;
  };
}
