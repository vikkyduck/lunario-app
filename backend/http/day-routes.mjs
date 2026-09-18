/* Карточка дня — «Запомнить этот день»: состояние сегодняшнего дня и сохранение всего одним запросом.
   Тонкий HTTP-слой; что и как пишется — в day.mjs. Возвращает true: запрос обработан. */
export function createDayRoutes({ json, readBody, day }) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  return async function dayRoutes({ p, req, res, url, u, d }) {
    if (req.method === 'GET') {
      /* прошлые дни: список одной строкой (calendar — последние n дней, иначе страницей по дням с записями), открытый день, «мост» из прошлого */
      if (p === '/api/days') { const q = url.searchParams; return json(res, 200, day.days(u, d, { calendar: Math.min(31, Number(q.get('calendar')) || 0), before: q.get('before') || '', limit: Math.min(60, Number(q.get('limit')) || 30) })); }
      if (p === '/api/day/view') { const x = url.searchParams.get('day') || ''; if (!ISO.test(x) || x > d) return json(res, 400, { ok: false, error: 'bad_day' }); return json(res, 200, day.view(u, x)); }
      if (p === '/api/day/bridge') return json(res, 200, { item: day.bridge(u, d) });
    }
    if (p !== '/api/day') return false;
    if (req.method === 'GET') return json(res, 200, day.state(u, d));
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b || typeof b !== 'object') return json(res, 400, { ok: false, error: 'bad_body' });
      return json(res, 200, day.save(u, d, b));
    }
    return false;
  };
}
