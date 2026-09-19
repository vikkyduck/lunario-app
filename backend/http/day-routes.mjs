/* Карточка дня — «Запомнить этот день»: состояние сегодняшнего дня и сохранение всего одним запросом.
   Тонкий HTTP-слой; что и как пишется — в day.mjs. Возвращает true: запрос обработан. */
/* Тело запроса как байты (фото): без JSON и base64, с потолком по размеру — 413 сверх него */
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks = [];
    req.on('data', (c) => { if (done) return; size += c.length; if (size > max) { done = true; chunks.length = 0; req.pause(); reject(new Error('too_big')); } else chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
export function createDayRoutes({ json, readBody, day, bridge }) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  return async function dayRoutes({ p, req, res, url, u, d }) {
    /* фото дня: PUT — тело «миниатюра + полное» подряд (длина миниатюры в ?thumb=), только за сегодня; GET — по дню и размеру; DELETE — за сегодня */
    if (p === '/api/day/photo') {
      if (req.method === 'PUT') {
        const q = url.searchParams, tl = Math.trunc(Number(q.get('thumb'))) || 0;
        const body = await readRaw(req, 450 * 1024);
        if (tl <= 0 || tl >= body.length) return json(res, 400, { ok: false, error: 'bad_photo' });
        const r = day.photoPut(u, d, { thumb: body.subarray(0, tl), full: body.subarray(tl), w: Number(q.get('w')), h: Number(q.get('h')) });
        return json(res, r.ok ? 200 : r.error === 'too_big' ? 413 : r.error === 'too_often' ? 429 : 400, r);
      }
      if (req.method === 'GET') {
        const x = url.searchParams.get('day') || '', size = url.searchParams.get('size') === 'full' ? 'full' : 'thumb';
        if (!ISO.test(x) || x > d) { res.writeHead(404); return res.end(); }
        const ph = day.photoGet(u, x, size); if (!ph) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': ph.bytes.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(ph.bytes);
      }
      if (req.method === 'DELETE') return json(res, 200, day.photoDelete(u, d));
      return false;
    }
    if (req.method === 'GET') {
      /* прошлые дни: список одной строкой (calendar — последние n дней, иначе страницей по дням с записями), открытый день, «мост» из прошлого */
      if (p === '/api/days') { const q = url.searchParams; return json(res, 200, day.days(u, d, { calendar: Math.min(31, Number(q.get('calendar')) || 0), before: q.get('before') || '', limit: Math.min(60, Number(q.get('limit')) || 30) })); }
      if (p === '/api/day/view') { const x = url.searchParams.get('day') || ''; if (!ISO.test(x) || x > d) return json(res, 400, { ok: false, error: 'bad_day' }); return json(res, 200, day.view(u, x)); }
      if (p === '/api/thoughts') { const x = url.searchParams.get('day') || d; return json(res, 200, { items: day.thoughtsOf(u.id, ISO.test(x) && x <= d ? x : d) }); }   /* мысли к материалам за день */
      if (p === '/api/day/bridge') { const x = url.searchParams.get('day') || ''; return json(res, 200, { item: bridge(u, ISO.test(x) && x <= d ? x : d) }); }   /* «Я помню» (memory.mjs) и для открытого прошлого дня */
    }
    /* мысль к карте, руне или раскладу — одна на материал в день, повтор обновляет */
    if (p === '/api/thought' && req.method === 'POST') { const b = await readBody(req); const r = day.thoughtSave(u, d, b); return json(res, r.ok ? 200 : 400, r); }
    if (p !== '/api/day') return false;
    /* день можно дописать и поправить задним числом — до года назад; сегодняшний — как прежде */
    const past = (x) => ISO.test(x || '') && x < d && x >= new Date(Date.parse(d + 'T12:00:00Z') - 366 * 864e5).toISOString().slice(0, 10);
    if (req.method === 'GET') { const x = url.searchParams.get('day') || ''; if (x && x !== d && !past(x)) return json(res, 400, { ok: false, error: 'bad_day' }); return json(res, 200, day.state(u, x && x !== d ? x : d, { today: !x || x === d })); }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b || typeof b !== 'object') return json(res, 400, { ok: false, error: 'bad_body' });
      const x = typeof b.day === 'string' ? b.day : ''; if (x && x !== d && !past(x)) return json(res, 400, { ok: false, error: 'bad_day' });
      return json(res, 200, day.save(u, x && x !== d ? x : d, b, { today: !x || x === d }));
    }
    if (req.method === 'DELETE') { const x = url.searchParams.get('day') || d; if (x !== d && !past(x)) return json(res, 400, { ok: false, error: 'bad_day' }); const r = day.remove(u, x, url.searchParams.get('what') || ''); return json(res, r.ok ? 200 : 400, r); }
    return false;
  };
}
