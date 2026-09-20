/* Кто человек: сессии устройства и коды на почту.

   Одно место на все, что отвечает за «это тот же человек»: кука сессии, срок ее жизни, выдача и проверка
   кода из письма. Раньше это жило посреди server.mjs вперемешку с расчетами и маршрутами.

   Модуль не знает про HTTP-маршруты: ему передают req/res, он возвращает пользователя или null.
   Зависимости — явным объектом (db, шифрование, роли), как у createKnowledge и кабинета.

   Два срока жизни сессии. Обычному человеку — год с выдачи и полгода без захода: приложение личное,
   заставлять входить заново незачем. Сотруднику, у которого открыт кабинет с аналитикой и карточками
   людей, — 90 дней и 45 без захода. Кука скользящая: пока человек пользуется приложением, она
   продлевается, иначе однажды истекла бы в браузере при живой сессии на сервере.

   Коды на почту различаются целью: 'login' открывает вход, 'delete' подтверждает удаление аккаунта.
   Код одной цели не подходит для другой — письмо «подтвердите удаление» не должно открывать вход. */
import { randomBytes } from 'node:crypto';

export function createIdentity({ db, basePath, sha, clean, nowISO, userById, rolesFor }) {
  const COOKIE = 'lunario_app';
  /* Сессия живет год с выдачи и полгода без входа; пользование отмечаем не чаще раза в 10 минут */
  const SESSION_MAX_MS = 365 * 864e5, SESSION_IDLE_MS = 180 * 864e5, SEEN_STEP_MS = 10 * 60000;
  /* Сотруднику кабинет открывает аналитику и карточки людей, поэтому его токен не живет вечно: не дольше 90 дней
     с выдачи и 45 дней без захода. Кука при этом скользящая, так что заново вводить код нужно раз в 90 дней, а не при
     каждом заходе. */
  const STAFF_MAX_MS = 90 * 864e5, STAFF_IDLE_MS = 45 * 864e5;
  /* Куку присылает клиент, и она бывает битой: «%» без двух цифр роняет decodeURIComponent. Одна испорченная кука
     не должна ронять весь запрос — берем ее как есть, а остальные читаем нормально. */
  function parseCookies(req) {
    const out = {};
    for (const p of String(req.headers.cookie || '').split(';')) {
      const i = p.indexOf('='); if (i <= 0) continue;
      const raw = p.slice(i + 1).trim();
      let value; try { value = decodeURIComponent(raw); } catch { value = raw; }
      out[p.slice(0, i).trim()] = value;
    }
    return out;
  }
  function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=${basePath}; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`);
  }
  const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=${basePath}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
  /* Только запись в базу, без ответа: нужно, чтобы создание сессии умещалось внутрь транзакции входа.
     Кука — отдельно и строго после COMMIT: иначе при откате у человека осталась бы кука несуществующей сессии. */
  function createSession(userId, ua = '') {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, ua) VALUES (?,?,?,?,?)')
      .run(sha(token), userId, nowISO(), nowISO(), clean(ua, 200));
    return token;
  }
  function newSession(userId, res, ua = '') { const token = createSession(userId, ua); setSessionCookie(res, token); return token; }
  function getUser(req, res, create = true) {
    const tok = parseCookies(req)[COOKIE];
    if (tok) {
      const h = sha(tok), sess = db.prepare('SELECT user_id, created_at, last_seen FROM sessions WHERE token_hash = ?').get(h);
      if (sess) {
        const now = Date.now(), age = now - Date.parse(sess.created_at), idle = now - Date.parse(sess.last_seen);
        const u = userById(sess.user_id);
        /* Порог у сотрудников короче. Проверку роли (запрос к staff) делаем только когда она способна изменить исход —
           сессия уже старше сотруднического порога, но еще в пределах пользовательского; свежие сессии ее не касаются. */
        const overStaff = age > STAFF_MAX_MS || idle > STAFF_IDLE_MS;
        const overUser = age > SESSION_MAX_MS || idle > SESSION_IDLE_MS;
        const expired = overUser || (overStaff && u && u.email && rolesFor(u.email).length);
        if (expired) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
        else if (u) {
          if (idle > SEEN_STEP_MS) {
            db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(nowISO(), h);
            /* Скользящая сессия: пока человек пользуется приложением, кука продлевается. Иначе она однажды
               истекала бы в браузере при живой сессии на сервере — и код пришлось бы вводить заново. */
            if (res) setSessionCookie(res, tok);
          }
          if (now - Date.parse(u.last_seen) > SEEN_STEP_MS) db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(nowISO(), u.id);
          return u;
        }
      }
    }
    if (!create) return null;
    const info = db.prepare('INSERT INTO users (created_at, last_seen) VALUES (?,?)').run(nowISO(), nowISO());
    newSession(info.lastInsertRowid, res, req.headers['user-agent']);
    return userById(info.lastInsertRowid);
  }

  /* Код действует 15 минут. purpose — для чего он: 'login' (вход и выдача доступа сотруднику) или
     'delete' (подтверждение удаления аккаунта). Код одной цели не подходит для другой: письмо
     «подтвердите удаление» не должно открывать вход. У почты в каждый момент один код — новый заменяет прежний. */
  function issueLoginCode(email, purpose = 'login') {
    const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
    db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts, purpose)
      VALUES (?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET
      code_hash = excluded.code_hash, created_at = excluded.created_at,
      expires_at = excluded.expires_at, attempts = 0, purpose = excluded.purpose`)
      .run(email, sha(code + email), nowISO(), new Date(Date.now() + 15 * 60000).toISOString(), purpose);
    return code;
  }
  /* Ровно шесть ASCII-цифр. Раньше код резался до шести символов, и «1234567» с верными первыми шестью подходил —
     то есть проверка пропускала не тот код, который человек получил в письме. */
  const CODE = /^[0-9]{6}$/;
  const codeFormatOk = (code) => typeof code === 'string' && CODE.test(code);

  /* Проверка кода: та же для входа и для удаления. Возвращает причину отказа или null, если код подошел (и погашен). */
  function checkLoginCode(email, code, purpose = 'login') {
    if (!codeFormatOk(code)) return 'bad_code_format';
    const rec = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
    if (!rec || (rec.purpose || 'login') !== purpose) return 'no_code';
    if (rec.attempts >= 5) return 'too_many';
    if (new Date(rec.expires_at) < new Date()) return 'expired';
    if (rec.code_hash !== sha(code + email)) { db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(email); return 'wrong_code'; }
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
    return null;
  }

  /* Подтверждение кода — одной транзакцией.

     Раньше это шло вразнобой: код гасился одним запросом, почта привязывалась другим, сессия — третьим.
     Отказ в середине оставлял человека без кода и без входа: код уже удален, а почта еще не привязана,
     и повторить тем же кодом невозможно. Теперь либо все, либо ничего.

     Два правила, которые легко нарушить:
     · счетчик неверных попыток обязан сохраниться даже при отказе — поэтому при неверном коде мы не бросаем
       исключение (оно откатило бы счетчик), а возвращаем решение и фиксируем транзакцию;
     · токен новой сессии здесь только записывается в базу; кука ставится вызывающим и строго после COMMIT.

     Записи гостя сами никуда не переносятся: вход в чужой аккаунт — не повод отдать ему чужой дневник.
     Если у гостя есть что переносить, возвращаем предложение, а решение принимает человек.

     Возвращает { state, ... }, где state:
       attached          — почта закреплена за тем же аккаунтом, в котором человек и был;
       already_signed_in — эта почта уже принадлежит текущему аккаунту;
       signed_in         — вошли в другой существующий аккаунт (гостю было нечего переносить);
       guest_transfer_required — то же, но у гостя остались записи, и он может их перенести;
       иначе { error } — причина отказа. */
  function verifyLogin({ email, code, guest, ua, currentToken, profileFields, countGuestRecords, transferOffer }) {
    let begun = false;
    try {
      db.exec('BEGIN IMMEDIATE'); begun = true;
      const bad = checkLoginCode(email, code, 'login');
      if (bad) { db.exec('COMMIT'); begun = false; return { error: bad }; }

      const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const revoke = () => { if (currentToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(currentToken)); };

      if (!existing) {                       /* почты еще нет — закрепляем за текущим аккаунтом, все написанное остается */
        db.prepare('UPDATE users SET email = ?, email_at = ? WHERE id = ?').run(email, nowISO(), guest.id);
        revoke();
        const token = createSession(guest.id, ua);
        db.exec('COMMIT'); begun = false;
        return { state: 'attached', accountId: guest.id, token };
      }
      if (existing.id === guest.id) {         /* уже свой аккаунт — просто меняем токен устройства */
        revoke();
        const token = createSession(guest.id, ua);
        db.exec('COMMIT'); begun = false;
        return { state: 'already_signed_in', accountId: guest.id, token };
      }

      /* Аккаунт с этой почтой есть, и это другой аккаунт. Анкету, заполненную только что на этом устройстве,
         переносим — она про того же человека и в найденном аккаунте ее нет. Записи не трогаем. */
      if (guest.onboarded && !existing.onboarded && profileFields) db.prepare(profileFields.sql).run(...profileFields.values(guest, existing.id));
      revoke();
      const token = createSession(existing.id, ua);
      const counts = countGuestRecords ? countGuestRecords(guest.id) : {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (!total) {                           /* гостю нечего терять — пустой профиль устройства не копим */
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(guest.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(guest.id);
      }
      db.exec('COMMIT'); begun = false;
      return total
        ? { state: 'guest_transfer_required', accountId: existing.id, token, guestId: guest.id, counts, transfer: transferOffer ? transferOffer(guest.id, existing.id) : null }
        : { state: 'signed_in', accountId: existing.id, token };
    } catch (e) {
      if (begun) { try { db.exec('ROLLBACK'); } catch { try { db.close(); } catch {} } }
      throw e;
    }
  }

  return { parseCookies, setSessionCookie, clearSessionCookie, newSession, createSession, getUser, issueLoginCode, checkLoginCode, codeFormatOk, verifyLogin,
    /* для проверок и отчетов: какая политика сейчас действует */
    policy: { SESSION_MAX_MS, SESSION_IDLE_MS, STAFF_MAX_MS, STAFF_IDLE_MS, SEEN_STEP_MS } };
}
