/* Вход по коду на почту, перенос гостевых записей, выход, удаление истории и аккаунта.
   Тонкий HTTP-слой поверх server.mjs: возвращает true, если запрос обработан. */
export function createAuthRoutes({ allowRate, checkLoginCode, clean, clearHistory, clearSessionCookie, clientIp, codeRate, codeRateAll, codeRateEmail, dayPack, db, deleteAccount, deleteMail, guestRecordCounts, issueLoginCode, json, logError, loginMail, mailLive, offerTransfer, parseCookies, publicUser, RATE_WINDOW_MS, readBody, readOffer, knowledgeRebuild, sendMail, setSessionCookie, sha, transferGuestRecords, userById, verifyLogin, verifyRate }) {
  return async function authRoutes({ p, req, res, url, u, d }) {
    /* ── вход по коду на почту ── */
    if (p === '/api/auth/request' && req.method === 'POST') {
      const b = await readBody(req);
      const email = clean(b.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) return json(res, 400, { ok: false, error: 'bad_email' });
      if (!allowRate(codeRate, clientIp(req), 5)) return json(res, 429, { ok: false, error: 'too_often' });
      /* на один адрес — не больше 3 кодов за окно, а всего с сервера — не больше 200: чужую почту не бомбим,
         репутацию отправителя не сжигаем, даже если адрес клиента подменен */
      if (!allowRate(codeRateEmail, email, 3)) return json(res, 429, { ok: false, error: 'too_often' });
      if (Date.now() - codeRateAll.t > RATE_WINDOW_MS) { codeRateAll.n = 0; codeRateAll.t = Date.now(); }
      if (++codeRateAll.n > 200) return json(res, 429, { ok: false, error: 'too_often' });
      if (!mailLive()) return json(res, 503, { ok: false, error: 'mail_off' });
      const code = issueLoginCode(email);
      try {
        const m = loginMail(code);
        await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
      } catch (e) {
        console.error('почта не ушла:', e.message);
        logError('mail', e.message);
        return json(res, 502, { ok: false, error: 'send_failed' });
      }
      return json(res, 200, { ok: true });
    }
    if (p === '/api/auth/verify' && req.method === 'POST') {
      if (!allowRate(verifyRate, clientIp(req), 60)) return json(res, 429, { ok: false, error: 'too_often' });   /* перебор кодов по многим почтам с одного адреса */
      const b = await readBody(req);
      const email = clean(b.email, 200).toLowerCase();
      /* Код не режем: раньше clean(b.code, 6) обрезал «1234567» до «123456», и подходил не тот код, что в письме.
         Все остальное — проверка, привязка аккаунта, новая сессия, погашение кода — одной транзакцией в identity.mjs:
         отказ посередине больше не оставляет человека без кода и без входа. */
      const r = verifyLogin({
        email, code: typeof b.code === 'string' ? b.code.trim() : '',
        guest: u, ua: req.headers['user-agent'], currentToken: parseCookies(req).lunario_app,
        /* анкету, заполненную только что на этом устройстве, переносим в найденный аккаунт — она про того же человека */
        profileFields: { sql: `UPDATE users SET name=?, birth=?, birth_time=?, city=?, city_region=?, lat=?, lon=?, tz=?, onboarded=1,
                               consent_version=?, consent_ts=? WHERE id=?`,
          values: (g, id) => [g.name, g.birth, g.birth_time, g.city, g.city_region, g.lat, g.lon, g.tz, g.consent_version, g.consent_ts, id] },
        countGuestRecords: (id) => guestRecordCounts(db, id),
        transferOffer: (guestId, accountId) => offerTransfer(guestId, accountId),
      });
      if (r.error) return json(res, r.error === 'too_many' ? 429 : 400, { ok: false, error: r.error });
      /* Кука — только после COMMIT: при откате у человека не должно остаться куки несуществующей сессии. */
      setSessionCookie(res, r.token);
      const account = userById(r.accountId);
      /* merged остается ради уже работающих клиентов: true означало «устройство переключилось на другой аккаунт».
         Новое поле state говорит точнее, а transfer — что у гостя остались записи и их можно перенести. */
      const merged = r.state === 'signed_in' || r.state === 'guest_transfer_required';
      return json(res, 200, { ok: true, merged, state: r.state, user: publicUser(account),
        ...(merged ? { day: dayPack(account, d) } : {}),
        ...(r.transfer ? { transfer: { token: r.transfer, counts: r.counts } } : {}) });
    }
    /* Записи, сделанные до входа, переносятся только по явному согласию: вход в аккаунт — не доказательство,
       что гостевой дневник принадлежит тому же человеку (общий компьютер). Приглашение подписано и живет полчаса. */
    if (p === '/api/account/transfer' && req.method === 'POST') {
      const b = await readBody(req);
      const offer = readOffer(b.token);
      if (!offer) return json(res, 400, { ok: false, error: 'bad_transfer_token' });
      if (offer.accountId !== u.id) return json(res, 403, { ok: false, error: 'not_your_transfer' });
      const done = transferGuestRecords(db, offer.guestId, offer.accountId);
      if (!done.ok) return json(res, done.error === 'not_found' ? 404 : 409, { ok: false, error: done.error });
      knowledgeRebuild(u, d);   /* записи переехали — документы базы знаний пересобираются */
      return json(res, 200, { ok: true, moved: done.moved, kept: done.kept, already: !!done.already });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const tok = parseCookies(req).lunario_app;
      if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(tok));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    /* «Выйти на всех устройствах»: отзыв всех сессий аккаунта — если телефон потерян или токен утек */
    if (p === '/api/auth/logout-all' && req.method === 'POST') {
      const gone = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id).changes;
      clearSessionCookie(res);
      return json(res, 200, { ok: true, devices: gone });
    }
    /* «Очистить историю» и «Удалить аккаунт» — одна политика на все личные таблицы (account-data.mjs) */
    if (p === '/api/data' && req.method === 'DELETE') { clearHistory(db, u); return json(res, 200, { ok: true }); }   /* ревизию поднимает сама очистка, в своей транзакции (R08, F04) */
    /* Удаление необратимо, поэтому у аккаунта с почтой оно подтверждается отдельным кодом из письма:
       одной кнопки на чужом или забытом устройстве мало. Аккаунту без почты подтверждать нечем — там только кнопка. */
    if (p === '/api/account/delete-code' && req.method === 'POST') {
      if (!u.email) return json(res, 200, { ok: true, sent: false, reason: 'no_email' });
      if (!allowRate(codeRate, clientIp(req), 5) || !allowRate(codeRateEmail, u.email, 3)) return json(res, 429, { ok: false, error: 'too_often' });
      if (!mailLive()) return json(res, 503, { ok: false, error: 'mail_off' });
      try {
        const m = deleteMail(issueLoginCode(u.email, 'delete'));
        await sendMail({ to: u.email, subject: m.subject, text: m.text, html: m.html });
      } catch (e) { logError('mail', e.message); return json(res, 502, { ok: false, error: 'send_failed' }); }
      return json(res, 200, { ok: true, sent: true });
    }
    if (p === '/api/account' && req.method === 'DELETE') {
      if (u.email) {
        const b = await readBody(req).catch(() => ({}));
        const bad = checkLoginCode(u.email, clean(b.code, 6), 'delete');
        if (bad) return json(res, bad === 'too_many' ? 429 : 400, { ok: false, error: bad });
      }
      deleteAccount(db, u);
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    return false;
  };
}
