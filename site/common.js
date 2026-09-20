/* Общее для приложения (app.js) и кабинета (cabinet.js): выборка элемента, запрос к серверу, экранирование, тост,
   склонение, дата. Подключается первым на обеих страницах. */
const $ = (id) => document.getElementById(id);
const API = '/app/api';
const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
/* Сервер перезапускается при выкладке на пару секунд — чтение не падает, а пробует еще раз (502/503/504 или обрыв связи).
   Только для GET: повтор записи мог бы продублировать ее. Сессия истекла — страница перезагружается и показывает вход. */
const RETRY_STATUS = new Set([502, 503, 504]), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
/* Контекст запросов аккаунта (ревью v114, F05): ответ применяется, только если поколение не сменилось; сброс (выход, очистка истории)
   отменяет все живые запросы самим браузером, а поколение защищает те, что уже пришли. Одна форма на все загрузчики и сохранения:
   const c = ctx() — до await, if (!c.alive()) return — после. api() отдает fetch сигнал контекста, отмена — ошибка с code 'cancelled',
   по аналогии с отменой выбора карт: обработчики на нее молчат */
const CTX = { gen: 0, ac: new AbortController() };
const ctx = () => { const gen = CTX.gen; return { gen, signal: CTX.ac.signal, alive: (g = gen) => g === CTX.gen }; };
function resetRequests(){ CTX.ac.abort(); CTX.ac = new AbortController(); CTX.gen++; }
const cancelledError = () => Object.assign(new Error('cancelled'), { code: 'cancelled' });
const api = async (path, opts) => {
  const init = Object.assign({ headers: { 'Content-Type': 'application/json', 'X-Tz': DEVICE_TZ } }, opts);   /* «сегодня» считается по поясу устройства */
  if (!init.signal) init.signal = CTX.ac.signal;
  const canRetry = !init.method || init.method === 'GET';
  let r;
  for (let attempt = 0; ; attempt++) {
    if (init.signal.aborted) throw cancelledError();
    try { r = await fetch(API + path, init); }
    catch (e) { if (e && e.name === 'AbortError') throw cancelledError(); if (canRetry && attempt < 2 && navigator.onLine !== false) { await wait(1200 * (attempt + 1)); continue; } throw e; }
    if (canRetry && RETRY_STATUS.has(r.status) && attempt < 2) { await wait(1200 * (attempt + 1)); continue; }
    break;
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/me') { location.reload(); throw Object.assign(new Error('no_session'), { code: 'no_session', status: 401 }); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'err'), { code: j.error, status: r.status, body: j });   /* body — что нашел сервер (например, запись по ключу операции при конфликте) */
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

/* Черновики на устройстве — один механизм на все поля (аудит v98, F06): по аккаунту, виду записи и ключу (дата, неделя, материал).
   Восстанавливается, пока сохранение не подтверждено сервером; после подтверждения стирается. Ничего никуда не отправляет */
const draftKey=(kind,id)=>`lun_draft_${(typeof S!=='undefined'&&S.user?.id)||0}_${kind}_${id}`;
/* null — черновика нет; '' — есть, и он пустой: человек очистил поле, это его намерение (R07). Убирает черновик только draftClear */
const draftGet=(kind,id)=>{ try{ return localStorage.getItem(draftKey(kind,id)); }catch(e){ return null; } };
const draftSet=(kind,id,text)=>{ try{ localStorage.setItem(draftKey(kind,id),String(text??'')); }catch(e){} };
const draftClear=(kind,id)=>{ try{ localStorage.removeItem(draftKey(kind,id)); }catch(e){} };
/* Единый сброс данных аккаунта на устройстве (R06, ревью v114 F05): после «Очистить историю» и при выходе — черновики этого аккаунта,
   память предложений, загруженные записи и производные экраны. Сначала resetRequests(): живые запросы отменяются, поздний ответ
   не рисуется. Состояния модулей не перечислены здесь списком — каждый файл вкладки регистрирует свой сброс рядом со своими
   переменными (registerReset), а profile:true помечает то, что живет с анкетой (нумерология, натальная карта): при очистке истории
   анкета остается — такие сбросы зовутся только при выходе (resetLocalAccount({ profile: false }) — очистка истории).
   Политика выхода: черновики этого аккаунта на устройстве стираются — следующий человек за тем же телефоном их не увидит */
const RESETS=[];
function registerReset(fn,{profile=false}={}){ RESETS.push({fn,profile}); }
function resetLocalAccount({profile=true}={}){
  resetRequests();
  const uid=(typeof S!=='undefined'&&S.user?.id)||0;
  try{ const gone=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&(k.startsWith(`lun_draft_${uid}_`)||k===`lun_dc_draft_${uid}`||k===`lun_tool_offer_${uid}`))gone.push(k); } gone.forEach(k=>localStorage.removeItem(k)); }catch(e){}
  for(const r of RESETS){ if(!profile&&r.profile)continue; try{ r.fn(); }catch(e){ /* сброс одного модуля не должен мешать остальным */ } }
}
/* Ключ повторной операции (аудит v98, F02): один на попытку сохранения; повтор после обрыва уходит с тем же ключом — сервер отвечает
   той же квитанцией и второй записи не создает. Новый ключ — только после подтвержденного сохранения */
const opKey=()=>'op-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
