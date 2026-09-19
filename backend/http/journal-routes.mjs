/* Настроение, дневник, желания и фото, лента записей, отчет по настроениям.
   Тонкий HTTP-слой поверх server.mjs: возвращает true, если запрос обработан. */
export function createJournalRoutes({ C, clean, cleanText, DAILY_WRITES, dataUrlOk, db, entryPage, json, nowISO, open_, publicUser, readBody, seal, sendDataUrl, touchStreak, track, userById, userPhoto, weekSummary, WISHES_MAX, wishList }) {
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
      const stats = db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, month + '%');
      return json(res, 200, { ok: true, mood, stats, streak: touchStreak(u) });
    }
    /* Дневник: обычная запись, благодарность («кому и за что я благодарна сегодня») или ответ на вопрос дня.
       Все лежит в одной ленте, вид записи подписан. */
    if (p === '/api/journal') {
      if (req.method === 'PATCH') {
        const b = await readBody(req), text = cleanText(b.text, 2000);
        const item = db.prepare("SELECT id, day FROM journal WHERE id=? AND user_id=? AND kind='gratitude'").get(Number(b.id) || 0, u.id);
        if (!item) return json(res, 404, { ok: false, error: 'not_found' });
        if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
        db.prepare('UPDATE journal SET text=? WHERE id=? AND user_id=?').run(seal(text), item.id, u.id);
        return json(res, 200, { ok: true, item: { ...item, text } });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const text = cleanText(b.text, 2000);
        if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
        if (db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c >= DAILY_WRITES) return json(res, 429, { ok: false, error: 'too_many' });
        const kind = ['gratitude', 'answer'].includes(b.kind) ? b.kind : '';
        const title = clean(b.title, 300);
        /* ответ на вопрос дня — один на день: повторная отправка обновляет его, как и карточка дня в Дневнике */
        if (kind === 'answer') {
          const prev = db.prepare("SELECT id FROM journal WHERE user_id = ? AND day = ? AND kind = 'answer' ORDER BY id DESC LIMIT 1").get(u.id, d);
          if (prev) { db.prepare('UPDATE journal SET text = ?, title = ? WHERE id = ? AND user_id = ?').run(seal(text), seal(title), prev.id, u.id); return json(res, 200, { ok: true, updated: true, item: { id: prev.id, day: d, text, kind, title } }); }
        }
        const inserted = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title));
        track(u, kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add', '');
        return json(res, 200, { ok: true, streak: touchStreak(u), item: { id: Number(inserted.lastInsertRowid), day: d, text, kind, title } });
      }
      const kind = url.searchParams.get('kind');
      const rows = kind ? db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? AND kind=? ORDER BY id DESC LIMIT 60').all(u.id, kind)
        : db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? ORDER BY id DESC LIMIT 60').all(u.id);
      return json(res, 200, { items: rows.map((r) => ({ ...r, text: open_(r.text), title: open_(r.title || '') })), today: !!(kind && rows.find((r) => r.day === d)) });
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
        if (db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ?').get(u.id).c >= WISHES_MAX) return json(res, 429, { ok: false, error: 'too_many' });
        const photo=b.photo ? dataUrlOk(b.photo,600*1024) : '';
        if (b.photo && !photo) return json(res,400,{error:'bad_photo'});
        db.prepare('INSERT INTO wishes (user_id, ts, text, photo, photo_ts) VALUES (?,?,?,?,?)').run(u.id, nowISO(), seal(text),photo,photo?nowISO():'');
        track(u, 'wish_add', photo ? 'photo' : '');
      } else if (req.method === 'PATCH') {
        const b = await readBody(req);
        db.prepare('UPDATE wishes SET done = CASE done WHEN 1 THEN 0 ELSE 1 END, done_ts = ? WHERE id = ? AND user_id = ?').run(nowISO(), Number(b.id) || 0, u.id);
      }
      return json(res, 200, { items: wishList(u.id) });
    }
    if (p === '/api/entries' && req.method === 'GET')
      return json(res, 200, entryPage(db,u.id,url.searchParams,open_));
    /* Отчет по настроениям: неделя по дням, месяц по долям, итог словами */
    if (p === '/api/mood/report' && req.method === 'GET') {
      const w = weekSummary(u);
      const week = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(Date.parse(d) - i * 864e5).toISOString().slice(0, 10);
        const row = db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, day);
        week.push({ day, mood: row ? row.mood : '' });
      }
      const month = d.slice(0, 7);
      const stats = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id = ? AND day LIKE ? GROUP BY mood ORDER BY c DESC').all(u.id, month + '%');
      const total = db.prepare('SELECT COUNT(*) c FROM moods WHERE user_id = ?').get(u.id).c;
      const monthEntries=db.prepare('SELECT day,mood FROM moods WHERE user_id=? AND day LIKE ? ORDER BY day').all(u.id,month+'%');
      return json(res, 200, { week, month: { key: month, stats, entries:monthEntries, days: stats.reduce((s, m) => s + m.c, 0) }, total, summary: w.summary });
    }
    return false;
  };
}
