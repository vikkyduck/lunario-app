/* Общее для приложения (app.js) и кабинета (cabinet.js): выборка элемента, запрос к серверу, экранирование, тост,
   склонение, дата. Подключается первым на обеих страницах. */
const $ = (id) => document.getElementById(id);
const API = '/app/api';
const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
/* Сервер перезапускается при выкладке на пару секунд — чтение не падает, а пробует еще раз (502/503/504 или обрыв связи).
   Только для GET: повтор записи мог бы продублировать ее. Сессия истекла — страница перезагружается и показывает вход. */
const RETRY_STATUS = new Set([502, 503, 504]), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const api = async (path, opts) => {
  const init = Object.assign({ headers: { 'Content-Type': 'application/json', 'X-Tz': DEVICE_TZ } }, opts);   /* «сегодня» считается по поясу устройства */
  const canRetry = !init.method || init.method === 'GET';
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await fetch(API + path, init); }
    catch (e) { if (canRetry && attempt < 2 && navigator.onLine !== false) { await wait(1200 * (attempt + 1)); continue; } throw e; }
    if (canRetry && RETRY_STATUS.has(r.status) && attempt < 2) { await wait(1200 * (attempt + 1)); continue; }
    break;
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/me') { location.reload(); throw Object.assign(new Error('no_session'), { code: 'no_session', status: 401 }); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'err'), { code: j.error, status: r.status });
  if (opts?.method && opts.method !== 'GET' && typeof XP !== 'undefined') XP.timeline.dirty = true;
  return j;
};
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
/* Одни слова на все неудачи: не сохранилось — коротко, без «попробуйте еще раз» (текст в поле остается, человек видит сам) */
const ERR_SAVE = 'Не сохранилось', ERR_SAVE_KEPT = 'Не сохранилось — текст остался в поле';
function toast(t) { const el = $('toast'); if (!el) return; el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600); }
const plural = (n, a, b, c) => { const m = n % 100; if (m >= 11 && m <= 14) return c; const l = n % 10; return l === 1 ? a : l >= 2 && l <= 4 ? b : c; };
const fmtDay = (d) => String(d || '').split('-').reverse().join('.');   /* 19.09.2026 */
const fmtDayShort = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });   /* 19 сент. */
