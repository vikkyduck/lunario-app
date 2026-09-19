/* Уведомления: ячейки push, напоминания по функциям, очередь текстов; приглашение подруги.
   Тонкий HTTP-слой поверх server.mjs: возвращает true, если запрос обработан. */
export function createPushRoutes({ allowRate, clean, db, firstName, inviteHost, json, listReminders, nativePlan, nowISO, pendingFor, previewNotification, PUBLIC_BASE, PUSH, PUSH_DEVICES, pushEndpointOk, readBody, refCodeOf, REMINDER_FEATURES, saveReminder, sendNow, testRate, track }) {
  return async function pushRoutes({ p, req, res, url, u, d }) {
    /* Напоминание утром: браузер дает адрес своей ячейки, мы его храним. */
    if (p === '/api/push' && req.method === 'GET')
      return json(res, 200, { key: PUSH.publicKey, on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id=?').get(u.id) });
    if (p === '/api/push' && req.method === 'POST') {
      const b = await readBody(req);
      const endpoint = clean(b.endpoint, 500);
      if (!pushEndpointOk(endpoint)) return json(res, 400, { ok: false, error: 'bad_endpoint' });
      const holder = db.prepare('SELECT user_id FROM push_subs WHERE endpoint = ?').get(endpoint);
      /* Ячейка уже у другого аккаунта — не перехватываем: иначе тот, кто узнал чужой адрес, молча забрал бы себе
         чужие уведомления. Выход из аккаунта ячейку НЕ освобождает — ее снимает только «выключить уведомления»
         (DELETE /api/push). Поэтому на общем браузере второй человек включит свои после того, как первый выключит
         у себя; приложение так ему и говорит (pushSubscribe в site/app.js, ответ endpoint_taken). */
      if (holder && holder.user_id !== u.id) return json(res, 409, { ok: false, error: 'endpoint_taken' });
      const fresh = !holder;
      db.prepare('INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?,?,?) ON CONFLICT(endpoint) DO NOTHING').run(endpoint, u.id, nowISO());
      /* устройств у аккаунта — не больше PUSH_DEVICES: лишние (самые старые) ячейки уходят, чтобы сервер не рассылал в тысячи адресов с одного аккаунта */
      db.prepare(`DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${PUSH_DEVICES})`).run(u.id, u.id);
      if (fresh) track(u, 'push_on', '');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/push' && req.method === 'DELETE') {
      db.prepare('DELETE FROM push_subs WHERE user_id=?').run(u.id);
      return json(res, 200, { ok: true });
    }
    /* Приглашение подруги: у каждого свой код; пришла по ссылке — записываем, от кого (users.invited_by). Подарка за
       приглашение больше нет (лимит раскладов снят), поле bonus_until остается в базе для совместимости и не пишется */
    if (p === '/api/invite' && req.method === 'GET') {
      const code = refCodeOf(u);
      /* кто пришел по ссылке: имена тех, кто заполнил анкету, остальные — счетом; почты и записей здесь нет */
      const came = db.prepare('SELECT name FROM users WHERE invited_by=? ORDER BY created_at').all(u.id);
      return json(res, 200, {
        link: `${PUBLIC_BASE}/app/?ref=${code}`, installLink: `${PUBLIC_BASE}/app/install?ref=${code}`,
        brought: came.length, broughtNames: came.map((r) => firstName(r.name)).filter(Boolean).slice(0, 20),
      });
    }
    if (p === '/api/invite' && req.method === 'POST') {
      const b = await readBody(req);
      const code = clean(b.code, 16);
      if (!code || u.invited_by || u.ref_code === code) return json(res, 200, { ok: false });
      const host = inviteHost(code);
      if (!host || host.id === u.id) return json(res, 200, { ok: false });
      db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(host.id, u.id);
      track(u, 'invite_used', String(host.id));   /* кто от кого пришел — в событиях и в users.invited_by; раньше событие с клиента отбрасывалось */
      return json(res, 200, { ok: true, from: firstName(host.name) });
    }
    /* ── напоминания по функциям ── */
    if (p === '/api/reminders/preview' && req.method === 'GET') {
      const item = previewNotification(u, url.searchParams.get('feature'));
      return json(res, item ? 200 : 400, item ? { item } : { error: 'bad_feature' });
    }
    /* план локальных уведомлений телефона на 14 дней: ?feature=morning|evening|week (старые адреса — на тот же план) */
    if ((p === '/api/reminders/native-plan' || p === '/api/reminders/sky-plan' || p === '/api/reminders/askesis-plan') && req.method === 'GET')
      return json(res, 200, nativePlan(u, REMINDER_FEATURES[url.searchParams.get('feature')] ? url.searchParams.get('feature') : 'morning'));
    if (p === '/api/reminders' && req.method === 'GET')
      return json(res, 200, { items: listReminders(u.id), push: { on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id = ?').get(u.id), key: PUSH.publicKey,
        /* по устройствам: когда подключено, когда сервер последний раз доставил сигнал и когда устройство откликнулось */
        devices: db.prepare('SELECT endpoint, created_at, last_sent, last_wake FROM push_subs WHERE user_id = ? ORDER BY created_at DESC').all(u.id) } });
    if (p === '/api/reminders' && req.method === 'POST') {
      const b = await readBody(req);
      const r = saveReminder(u.id, b);
      if (!r.ok) return json(res, 400, r);
      if (b.enabled !== undefined) track(u, b.enabled ? 'reminder_on' : 'reminder_off', b.feature);
      return json(res, 200, r);
    }
    if (p === '/api/reminders/test' && req.method === 'POST') {
      const b = await readBody(req);
      if (!allowRate(testRate, String(u.id), 3)) return json(res, 429, { ok: false, error: 'too_many' });
      const r = await sendNow(u, String(b.feature || 'card'), PUSH, clean(b.endpoint, 500));
      if (r.ok) track(u, 'reminder_test', b.feature);
      return json(res, r.ok ? 200 : 400, r);
    }
    /* сигнал пришел — service worker забирает тексты, которые еще не показывал на этом устройстве */
    /* Последнее уведомление за сутки — текстом: на телефоне уведомление обрезается, а в приложении человек ищет «тот текст».
       «Сегодня» показывает его карточкой, пока не скроют */
    if (p === '/api/push/last' && req.method === 'GET') {
      const since = new Date(Date.now() - 20 * 3600e3).toISOString();
      const item = db.prepare('SELECT id, ts, feature, title, body, url FROM push_queue WHERE user_id = ? AND ts >= ? ORDER BY id DESC LIMIT 1').get(u.id, since) || null;
      return json(res, 200, { item });
    }
    if (p === '/api/push/next' && req.method === 'POST') {
      const b = await readBody(req);
      const endpoint = clean(b.endpoint, 500);
      if (endpoint) db.prepare('UPDATE push_subs SET last_wake = ? WHERE endpoint = ? AND user_id = ?').run(nowISO(), endpoint, u.id);   /* устройство откликнулось */
      return json(res, 200, { items: pendingFor(u.id, endpoint) });
    }
    return false;
  };
}
