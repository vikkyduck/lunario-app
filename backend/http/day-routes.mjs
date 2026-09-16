/* Карточка дня — «Запомнить этот день»: состояние сегодняшнего дня и сохранение всего одним запросом.
   Тонкий HTTP-слой; что и как пишется — в day.mjs. Возвращает true: запрос обработан. */
export function createDayRoutes({ json, readBody, day }) {
  return async function dayRoutes({ p, req, res, u, d }) {
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
