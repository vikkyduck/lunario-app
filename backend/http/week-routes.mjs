/* «Моя неделя: про что она» — состояние недели, отметка «отозвалось», рефлексия.
   Тонкий HTTP-слой; что и как считается — в week.mjs. Возвращает true: запрос обработан. */
export function createWeekRoutes({ json, readBody, week, track }) {
  return async function weekRoutes({ p, req, res, url, u, d }) {
    if (p === '/api/week' && req.method === 'GET') {
      const s = week.state(u, d, url.searchParams.get('week') || '');
      track(u, 'week_view', s.mode);
      return json(res, 200, s);
    }
    if (p === '/api/week/echo' && req.method === 'POST') {
      const b = await readBody(req);
      const r = week.echo(u, d, b && typeof b === 'object' ? b : {});
      return json(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/week/reflect' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b || typeof b !== 'object') return json(res, 400, { ok: false, error: 'bad_body' });
      return json(res, 200, week.reflect(u, d, b));
    }
    return false;
  };
}
