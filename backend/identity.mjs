/* Кто человек: сессии устройства и коды на почту.

   Одно место на всё, что отвечает за «это тот же человек»: кука сессии, срок её жизни, выдача и проверка
   кода из письма. Раньше это жило посреди server.mjs вперемешку с расчётами и маршрутами.

   Модуль не знает про HTTP-маршруты: ему передают req/res, он возвращает пользователя или null.
   Зависимости — явным объектом (db, шифрование, роли), как у createShelves и кабинета.

   Два срока жизни сессии. Обычному человеку — год с выдачи и полгода без захода: приложение личное,
   заставлять входить заново незачем. Сотруднику, у которого открыт кабинет с аналитикой и карточками
   людей, — 90 дней и 45 без захода. Кука скользящая: пока человек пользуется приложением, она
   продлевается, иначе однажды истекла бы в браузере при живой сессии на сервере.

   Коды на почту различаются целью: 'login' открывает вход, 'delete' подтверждает удаление аккаунта.
   Код одной цели не подходит для другой — письмо «подтвердите удаление» не должно открывать вход. */
import { randomBytes } from 'node:crypto';

export function createIdentity({ db, basePath, sha, clean, nowISO, userById, rolesFor }) {
  const COOKIE = 'lunario_app';
  /* Сессия живёт год с выдачи и полгода без входа; пользование отмечаем не чаще раза в 10 минут */
  const SESSION_MAX_MS = 365 * 864e5, SESSION_IDLE_MS = 180 * 864e5, SEEN_STEP_MS = 10 * 60000;
  /* Сотруднику кабинет открывает аналитику и карточки людей, поэтому его токен не живёт вечно: не дольше 90 дней
     с выдачи и 45 дней без захода. Кука при этом скользящая, так что заново вводить код нужно раз в 90 дней, а не при
     каждом заходе. */
  const STAFF_MAX_MS = 90 * 864e5, STAFF_IDLE_MS = 45 * 864e5;
  function parseCookies(req) {
    const out = {};
    for (const p of String(req.headers.cookie || '').split(';')) {
      const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    }
    return out;
  }
  function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=${basePath}; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`);
  }
  const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=${basePath}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
  function newSession(userId, res, ua = '') {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, ua) VALUES (?,?,?,?,?)')
      .run(sha(token), userId, nowISO(), nowISO(), clean(ua, 200));
    setSessionCookie(res, token);
    return token;
  }
  function getUser(req, res, create = true) {
    const tok = parseCookies(req)[COOKIE];
    if (tok) {
      const h = sha(tok), sess = db.prepare('SELECT user_id, created_at, last_seen FROM sessions WHERE token_hash = ?').get(h);
      if (sess) {
        const now = Date.now(), age = now - Date.parse(sess.created_at), idle = now - Date.parse(sess.last_seen);
        const u = userById(sess.user_id);
        /* Порог у сотрудников короче. Проверку роли (запрос к staff) делаем только когда она способна изменить исход —
           сессия уже старше сотруднического порога, но ещё в пределах пользовательского; свежие сессии её не касаются. */
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
  /* Проверка кода: та же для входа и для удаления. Возвращает причину отказа или null, если код подошёл (и погашен). */
  function checkLoginCode(email, code, purpose = 'login') {
    const rec = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
    if (!rec || (rec.purpose || 'login') !== purpose) return 'no_code';
    if (rec.attempts >= 5) return 'too_many';
    if (new Date(rec.expires_at) < new Date()) return 'expired';
    if (rec.code_hash !== sha(code + email)) { db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(email); return 'wrong_code'; }
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
    return null;
  }

  return { parseCookies, setSessionCookie, clearSessionCookie, newSession, getUser, issueLoginCode, checkLoginCode,
    /* для проверок и отчётов: какая политика сейчас действует */
    policy: { SESSION_MAX_MS, SESSION_IDLE_MS, STAFF_MAX_MS, STAFF_IDLE_MS, SEEN_STEP_MS } };
}
