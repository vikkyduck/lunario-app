const $ = (id) => document.getElementById(id);
const API = '/app/api';
let S = { user:null, day:null, mood:null, limits:null, mode:'yesno', flipped:false, num:null };
/* iOS-оболочка: класс выставлен скриптом в head. Сообщения к нативному слою идут
   через мост WebKit; try/catch закрывает и его отсутствие (обычный браузер). */
const IOS_SHELL = document.documentElement.className.indexOf('ios-shell') !== -1;
function nativePost(m){ try{ window.webkit.messageHandlers.lunario.postMessage(m); return true; }catch(e){ return false; } }
const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch(e) { return ''; } })();
/* Сервер перезапускается при выкладке на пару секунд — чтение не падает, а пробует еще раз (502/503/504 или обрыв связи).
   Только для GET: повтор записи мог бы продублировать ее. */
const RETRY_STATUS = new Set([502, 503, 504]), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const api = async (path, opts) => {
  const init = Object.assign({ headers:{'Content-Type':'application/json', 'X-Tz': DEVICE_TZ} }, opts);   /* «сегодня» считается по поясу устройства */
  const canRetry = !init.method || init.method === 'GET';
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await fetch(API + path, init); }
    catch (e) { if (canRetry && attempt < 2 && navigator.onLine !== false) { await wait(1200 * (attempt + 1)); continue; } throw e; }
    if (canRetry && RETRY_STATUS.has(r.status) && attempt < 2) { await wait(1200 * (attempt + 1)); continue; }
    break;
  }
  const j = await r.json().catch(()=>({}));
  if (r.status===401 && path!=='/me'){ location.reload(); throw Object.assign(new Error('no_session'), { code:'no_session', status:401 }); }   /* сессия истекла на сервере */
  if (!r.ok) throw Object.assign(new Error(j.error||'err'), { code:j.error, status:r.status });
  if(opts?.method && opts.method!=='GET')XP.timeline.dirty=true;
  return j;
};
function track(t, d){
  try{
    const body = JSON.stringify({ t, d: d || '' });
    if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type:'application/json' }));
    else fetch(API + '/event', { method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true });
  }catch(e){ /* аналитика никогда не ломает приложение */ }
}
function toast(t){ const el=$('toast'); el.textContent=t; el.classList.add('on'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'),2600); }
/* Строка состояния под формой: пустая, подсказка или ошибка — одно место вместо className/classList в каждой форме */
const showMsg=(el,text='',err=false)=>{ if(!el)return; el.className='msg'+(err?' err':''); el.textContent=text; };
const LOADING='<p class="hint">Загружаем…</p>', LOAD_ERR='<p class="msg err">Не получилось загрузить.</p>';
const COMMAND_SELECTOR = '.wid,.app-nav button,.moonline';
function revealCommands(root=document){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll(COMMAND_SELECTOR).forEach((el) => {
    if(el.dataset.revealed)return;el.dataset.revealed='1';
    el.classList.remove('command-enter'); void el.offsetWidth; el.classList.add('command-enter');
  });
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest(COMMAND_SELECTOR); if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--tap-x', `${e.clientX-r.left}px`); el.style.setProperty('--tap-y', `${e.clientY-r.top}px`);
  el.classList.remove('reward'); void el.offsetWidth; el.classList.add('reward');
  clearTimeout(el._rewardTimer); el._rewardTimer=setTimeout(()=>el.classList.remove('reward'),620);
}, { passive:true, capture:true });
let lightFrame=0, lightTarget=null, lightEvent=null;
document.addEventListener('pointermove',(e)=>{
  if(e.pointerType==='touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  lightTarget=e.target.closest('.app-nav,.rem-summary,.acct,.wg-x,.wid,.moonline,.welcome-primary,.timeline-entry,.timeline-empty,.profile-summary,.wish-card'); lightEvent=e;
  if(lightFrame) return;
  lightFrame=requestAnimationFrame(()=>{
    if(lightTarget&&lightEvent){
      const r=lightTarget.getBoundingClientRect(),x=lightEvent.clientX-r.left,y=lightEvent.clientY-r.top;
      // Same optical coordinates as the landing; scoped names leave the moon logo's --mx/--my intact.
      if(r.width&&r.height){
        lightTarget.style.setProperty('--glass-x',`${(x/r.width*100).toFixed(2)}%`);
        lightTarget.style.setProperty('--glass-y',`${(y/r.height*100).toFixed(2)}%`);
        lightTarget.style.setProperty('--glass-edge',(Math.atan2(y-r.height/2,x-r.width/2)*180/Math.PI+90).toFixed(1));
      }
    }
    lightFrame=0;
  });
},{passive:true});
/* Вибрация: tap — нажатие, ok — сохранено, done — шаг завершен */
const HAP = { tap: 9, ok: [0, 12], done: [0, 14, 45, 22] };
function hap(kind = 'tap'){
  // в оболочке вибрация идет через Taptic Engine — navigator.vibrate на iOS не работает
  if (IOS_SHELL && nativePost({ type:'haptic', kind: kind === 'tap' ? 'tap' : 'success' })) return;
  try{ if(navigator.vibrate) navigator.vibrate(HAP[kind] || HAP.tap); }catch(e){}
}
const esc = (s) => String(s).replace(/[<>&"']/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

/* ── навигация: четыре вкладки внизу (home, ask, history, about); account и news открываются с главной по кружку с фото
   и вкладку не подсвечивают ── */
const INNER_VIEWS=['home','ask','history','about','account','news'];   /* rhythm, onb, login, hello — без нижней навигации */
const VIEW_ALIASES={today:'home',around:'home',me:'about'};
function go(v){
  v=VIEW_ALIASES[v]||v;
  rememberScroll();closeWidget();leavePractice();
  history.replaceState({lunView:v},'',cleanPracticeUrl());
  if(v==='news') markNewsSeen();
  document.body.classList.toggle('inner', INNER_VIEWS.includes(v));
  document.body.classList.toggle('hello', v==='hello');                // большая луна в фоне — только на приветствии
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on', s.id==='v-'+v));
  document.querySelectorAll('.app-nav button').forEach(b=>{const on=b.dataset.nav===v;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const active = $('v-'+v); if (active) requestAnimationFrame(()=>revealCommands(active));
  window.refreshMoonLogos?.();window.LunarioSky?.refresh();
  if(v==='account')XP.scroll.account=0;   /* открывается по кружку с любой вкладки — начинаем с шапки, а не с прошлой прокрутки */
  if(v==='home')window.tourMaybe?.();   /* подсказки по приложению — один раз, на «Сегодня» */
  restoreScroll(v);
  if(v==='home' && S.user?.onboarded){refreshHomeStatus();paintLunar();}
  if(v==='history') loadHistory();
  if(v==='about')loadAbout();
  if(v==='account')loadAccount();
  if(v==='news') paintNews();
}
function onboarded(){ return !!(S.user && S.user.onboarded); }
function openForm(){
  $('v-onb').classList.remove('verifying-email');
  $('o-form').style.display=''; $('o-codebox').style.display='none';
  const askMail = S.mailReady && !S.user?.email;   /* почта уже привязана через «Уже пользовались?» — второй раз не спрашиваем */
  $('o-mailfield').style.display = askMail ? '' : 'none'; $('o-back').style.display = askMail ? '' : 'none';
  if (askMail) authMount('o-auth', { idle: obAuthIdle, onDone: obDone });
  go('onb'); track('onboard_start');
}
function openLogin(){
  $('l-box').style.display=''; $('l-after').style.display='none';
  authMount('l-box', { step: 'email', onDone: obDone });
  go('login'); track('login_open');
}

/* ── реестр функций: раздел и название панели, где живет (view), полноэкранная практика (page), ключ напоминания (reminder).
   Отсюда — заголовки, строка уведомлений под заголовком, полный экран и переход по ?open= из уведомления. ── */
const FEATURES = {
  card:{sec:'Сегодня',title:'Карта дня',view:'home'}, mood:{sec:'Дневник',title:'Настроение дня',view:'history'},
  day:{sec:'Сегодня',title:'Прогноз дня',view:'home'}, tone:{sec:'Сегодня',title:'Вопрос дня',view:'home'}, dayrune:{sec:'Сегодня',title:'Руна дня',view:'home'}, tools:{sec:'Мои инструменты',title:'Все инструменты',view:'history'},
  habits:{sec:'Дневник',title:'Дневник привычек',view:'history',page:true}, askesis:{sec:'Дневник',title:'Взять аскезу',view:'history',page:true},
  lunar:{sec:'Сегодня',title:'Влияние Луны на сегодня',view:'home'}, sky:{sec:'Сегодня',title:'Влияние планет на сегодня',view:'home'},
  worry:{sec:'Свериться с собой',title:'Разобрать вопрос',view:'ask'}, ask:{sec:'Свериться с собой',title:'',view:'ask'},
  journal:{sec:'Дневник',title:'Дневник',view:'history',page:true}, gratitude:{sec:'Дневник',title:'Дневник благодарности',view:'history'},
  wishes:{sec:'Дневник',title:'Мои желания',view:'history'}, hmood:{sec:'Дневник',title:'История настроений',view:'history'},
  hentries:{sec:'Свериться с собой',title:'Мои вопросы и ответы',view:'ask'}, week:{sec:'Дневник',title:'Моя неделя',view:'history'}, timelineEntry:{sec:'Дневник',title:'Запись',view:'history'},
  natal:{sec:'Обо мне',title:'Натальная карта',view:'about'}, year:{sec:'Обо мне',title:'Личный год',view:'about'}, birthnum:{sec:'Обо мне',title:'Нумерология',view:'about'}, compat:{sec:'Обо мне',title:'Совместимость',view:'about'},
  tests:{sec:'Обо мне',title:'Тесты',view:'about'},
  remind:{sec:'Аккаунт',title:'Уведомления',view:'account'}, mail:{sec:'Аккаунт',title:'Вход по почте',view:'account'}, edit:{sec:'Аккаунт',title:'Изменить мои данные',view:'account'},
  support:{sec:'Аккаунт',title:'Чат поддержки',view:'account'}, invite:{sec:'Аккаунт',title:'Позвать подругу',view:'account'}, appearance:{sec:'Аккаунт',title:'Оформление',view:'account'}, topics:{sec:'Аккаунт',title:'Настройка контента',view:'account'},
  skyplace:{sec:'Аккаунт',title:'Геолокация',view:'account'}, appinfo:{sec:'Аккаунт',title:'О приложении',view:'account'}, terms:{sec:'Аккаунт',title:'Условия использования',view:'account'},
  askDate:{sec:'Взять аскезу',title:'Передвинуть дату'},
};
/* Цель из ?open= в уведомлении: ключ функции или ключ ее напоминания (moodreport → История настроений) */
function openTarget(key){
  if(key==='news')return ['news',''];
  if(key==='today'||key==='morning')return ['home',''];          /* утренний пуш — на «Сегодня» */
  if(key==='diary'||key==='evening')return ['history',''];       /* вечерний — в Дневник, к карточке дня */
  return FEATURES[key]?[FEATURES[key].view||'home',key]:null;   /* week и прочие виджеты — по реестру */
}
let wgOpen = null, wgFocus = null;
function openWidget(k, title){
  requestAnimationFrame(() => window.refreshMoonLogos?.());
  const f = FEATURES[k], pane = $('w-'+k); if (!f || !pane) return;
  if(f.page){openPractice(k);return;}
  const trigger=document.activeElement;closeWidget();wgFocus=trigger;
  $('wg-eb').textContent = f.sec;$('wg-eb').hidden=f.sec===(title||f.title); $('wg-title').textContent = title || f.title;
  $('wg-body').appendChild(pane); wgOpen = k;
  $('wg-tools').innerHTML='';   /* напоминаний по функциям нет — три пуша настраиваются в Аккаунте */
  $('wg').dataset.kind=k;$('wg').classList.add('on'); document.body.classList.add('wg-open');
  requestAnimationFrame(()=>{revealCommands(pane);document.querySelector('.wg-x')?.focus({preventScroll:true});});
  document.querySelector('#wg .wg').scrollTop = 0; hap();
  loadWidgetContent(k);
}
/* Что подгрузить при открытии панели; у виджетов без записи содержимое статично (карта дня рисуется с главной) */
const WIDGET_LOADERS = {
  tools: () => paintTools(), appearance: () => paintAppearance(), topics: () => paintTopics(), skyplace: () => paintSkyPlace(),
  journal: () => { loadJournal(); prepareDictation(); requestAnimationFrame(() => growTextarea($('j-text'))); },
  wishes: () => loadWishes(), hentries: () => loadEntries(), week: () => loadWeek(''), hmood: () => loadMoodReport(),
  mood: () => { moodUI.precision=false; moodUI.mode='families'; renderMoods(); paintMoodExtra(); },
  habits: () => { habitView='today'; hbEditing=null; habitFormOpen=false; if(HB)paintHabits(); loadHabits(); },
  askesis: () => loadAskesis(), sky: () => loadSky(), lunar: () => paintLunarWidget(), gratitude: () => loadGratitude(), tone: () => loadTone(),
  day: () => { showForecastNote(); track('forecast_view'); }, worry: () => renderHub(), invite: () => loadInvite(), remind: () => paintAllReminders(), edit: () => fillEdit(),
  support: () => supOpen(), dayrune: () => loadDayRune(), natal: () => loadNatal(), mail: () => renderAuth(), year: () => loadNumerology(), birthnum: () => loadNumerology(),
};
function loadWidgetContent(k){ WIDGET_LOADERS[k]?.(); }
function closeWidget(e){
  if (e && e.target !== $('wg')) return;
  if (!wgOpen) return;
  if(wgOpen==='journal'&&journalSpeech)stopJournalDictation();
  if(wgOpen==='support'){rememberSupportDraft();supStop();}
  if(wgOpen==='mood'&&$('v-history')?.classList.contains('on'))loadDayCard();   /* оттенки выбраны в круге — карточка дня показывает их сразу */
  $('wg-store').appendChild($('w-'+wgOpen)); wgOpen = null;
  $('wg').classList.remove('on'); document.body.classList.remove('wg-open');$('wg-tools').innerHTML='';
  if(wgFocus?.isConnected)wgFocus.focus({preventScroll:true});wgFocus=null;
}
document.addEventListener('keydown',e=>{
  const tabs=e.target.closest('.segmented');
  if(tabs && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    const items=[...tabs.querySelectorAll('[role=tab]')],i=items.indexOf(e.target);
    const next=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;
    e.preventDefault();items[next].click();return;
  }
  if(!wgOpen)return;
  if(e.key==='Escape'){closeWidget();return;}
  if(e.key!=='Tab')return;
  const items=[...$('wg').querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
  const first=items[0],last=items.at(-1);
  if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
});
function focusSelectedTab(label){document.querySelector('.segmented[aria-label="'+label+'"] [aria-selected="true"]')?.focus({preventScroll:true});}

/* ── натальная карта: расчет на сервере, здесь только вывод ── */
let natalCache = null;
/* ── руна дня: одна на день, тянется на сервере при первом открытии и дальше показывается та же ── */
async function loadDayRune(){
  const box=$('dayrune-box');if(!box)return;box.innerHTML='<p class="hint">Тянем руну…</p>';
  try{
    const [r]=await Promise.all([api('/dayrune',{method:'POST'}),loadCatalog()]);
    box.innerHTML=runesHtml({layout:'one',runes:[r.rune.slug],live:[r.rune],q:'',day:r.day});preparePending();
    const sub=$('t-runesub');if(sub)sub.textContent=`${r.rune.name}${r.rune.keyword?' · '+r.rune.keyword:''}`;
  }catch(e){box.innerHTML='<p class="msg err">Не получилось вытянуть руну. Попробуйте еще раз.</p>';}
}
async function loadNatal(){
  const box = $('natal-box');
  try{
    const c = natalCache || (natalCache = await api('/natal'));
    const dms = (p) => `${p.symbol} ${p.deg}°${String(p.min).padStart(2,'0')}′`;
    const planets = c.planets.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.retro ? '<span title="ретроградная">R</span>' : ''}</td></tr>`).join('');
    const points = c.points && c.points.length ? `<h3 class="mt-4">Точки</h3><table class="nt"><thead><tr><th>Точка</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${c.points.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.key === 'node' || p.key === 'snode' ? (p.retro ? '<span title="ретроградный">R</span>' : '<span title="директный">D</span>') : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const houses = c.houses ? `<h3 class="mt-4">Дома · ${esc(c.houses.system)}</h3><table class="nt"><thead><tr><th>Дом</th><th>Куспид</th></tr></thead><tbody>${c.houses.cusps.map((h) => `<tr><td>${h.house}${h.house===1?' · Asc':h.house===10?' · MC':''}</td><td>${dms(h)} <small>${esc(h.signOf)}</small></td></tr>`).join('')}</tbody></table>`
      : `<div class="card mt-3"><p>${!c.timeKnown ? 'Без времени рождения дома, Асцендент и MC не считаются — положения планет по знакам верны' + (c.moonUncertain ? ', а Луна за этот день перешла границу знака: ее знак зависит от времени' : '') + '. ' : ''}${!c.hasPlace ? (c.city ? `Город «${esc(c.city)}» не нашелся в базе — откройте анкету и выберите его из подсказок, по нему считаются дома и часовой пояс. ` : 'Укажите город рождения в аккаунте — по нему считаются дома и часовой пояс. ') : ''}<button data-on="click:closeWidget-go-account-openWidget-edit" class="btn ghost sm mt-3">Дополнить анкету</button></p></div>`;
    const aspects = c.aspects.length ? `<h3 class="mt-4">Аспекты</h3><div class="hbars mt-2">${c.aspects.map((a) => `<div class="l"><span>${esc(a.aName)} ${a.symbol} ${esc(a.bName)} <small class="faint">${esc(a.name)}</small></span><b>орб ${a.orb}°</b></div>`).join('')}</div>` : '';
    const sun = c.planets[0], moon = c.planets[1];
    box.innerHTML = `<div class="card sec"><p class="eyebrow">Западная традиция · тропический зодиак${c.houses ? ' · ' + esc(c.houses.system) : ''}</p>
        <p class="t2">☉ Солнце ${esc(sun.signIn)} · ☽ Луна ${esc(moon.signIn)}${c.houses ? ` · Asc ${esc(c.houses.asc.signIn)}` : ''}</p>
        <p class="hint">${fmtDay(c.input.birth)}${c.timeKnown ? ' ' + c.input.time : ' · время не указано'}${c.city ? ' · ' + esc(c.city) : ''}${c.hasPlace ? ` (${c.input.lat.toFixed(2)}°, ${c.input.lon.toFixed(2)}°)` : ''} · ${esc(c.tzNote || '')} · UTC ${c.input.utc}</p></div>
      <h3 class="mt-4">Планеты</h3><table class="nt"><thead><tr><th>Планета</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${planets}</tbody></table>
      ${points}${houses}${aspects}
      <p class="hint mt-3">${esc(c.precision)} Трактовка карты появится позже — сейчас важно, что расчет верный.</p>`;
  }catch(e){ box.innerHTML = `<p class="msg err">${e.code==='no_birth' ? 'Укажите дату рождения в анкете — без нее карту не построить.' : 'Не получилось рассчитать карту.'}</p>`; }
}

/* ── чат с поддержкой: список обращений, новое обращение, переписка ── */
let supTimer = null, supTicket = null;
const supportDrafts={};
function rememberSupportDraft(){if(supTicket!==null&&$('sup-reply'))supportDrafts[supTicket]=$('sup-reply').value;}
function supStop(){ clearTimeout(supTimer); supTimer = null; supTicket = null; }
async function supOpen(){
  rememberSupportDraft();supStop(); const box = $('sup-box'); box.innerHTML = LOADING;
  try{
    const r = await api('/support/tickets');
    box.innerHTML = `<p>Напишите нам — ответ появится в этом чате. О новом ответе сообщит точка у «Чата поддержки».</p>
      <div class="card mt-3"><div class="field"><label>Тема</label><select id="sup-topic">${r.topics.map((t)=>`<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field mb-2"><label>Сообщение</label><textarea id="sup-text" maxlength="2000" placeholder="Что случилось или что хотите спросить"></textarea></div>
        <button data-on="click:supCreate" class="btn">Отправить</button><p class="msg" id="sup-msg"></p></div>
      ${r.items.length ? `<span class="eyebrow mt-4">Мои обращения</span><div class="sup-list">${r.items.map((t)=>`<button data-on="click:supThread-a0" data-a0="${t.id}" class="sup-item" type="button"><span><b>${esc(t.subject)}</b><small>${esc(t.topic)} · <span class="sup-status">${esc(t.statusName)}</span> · ${supWhen(t.last_at)}</small></span>${t.unread?`<span class="badge">${t.unread}</span>`:''}</button>`).join('')}</div>` : ''}`;
    $('h-supdot').hidden = !r.items.some((t)=>t.unread);
  }catch(e){ box.innerHTML = '<p class="msg err">Не получилось загрузить чат.</p>'; }
}
const supWhen = (t) => fmtWhen(t, { month: 'short' });
async function supCreate(){
  const text = $('sup-text').value.trim(), msg = $('sup-msg'); showMsg(msg);
  if(text.length<3){ showMsg(msg, 'Напишите хотя бы пару слов.', true); return; }
  try{ const r = await api('/support/tickets',{method:'POST',body:JSON.stringify({topic:$('sup-topic').value,text})});
    if(!r.ok){ showMsg(msg, r.error==='too_many_open' ? 'У вас уже пять открытых обращений — дождитесь ответа.' : 'Не отправилось.', true); return; }
    hap('ok'); supThread(r.id);
  }catch(e){ showMsg(msg, 'Не отправилось.', true); }
}
async function supThread(id){
  rememberSupportDraft();supStop(); supTicket = id; const box = $('sup-box');
  try{
    const t = await api('/support/ticket?id='+id);
    if(supTicket!==id||wgOpen!=='support')return;
    // Refresh messages only while typing: keep the textarea, caret and keyboard intact.
    const messages=t.messages.map((m)=>`<div class="m ${m.who}"><small>${m.who==='support'?'поддержка':'вы'} · ${supWhen(m.ts)}</small>${esc(m.text)}</div>`).join('');
    const existing=$('sup-thread');
    if(existing&&existing.dataset.ticket===String(id)){
      const atEnd=existing.scrollHeight-existing.scrollTop-existing.clientHeight<32;
      existing.innerHTML=messages;if(atEnd)existing.scrollTop=existing.scrollHeight;
      $('sup-thread-state').textContent=t.statusName;
      supTimer=setTimeout(()=>{if(supTicket===id&&wgOpen==='support')supThread(id);},15000);return;
    }
    box.innerHTML = `<button data-on="click:supOpen" class="back">← Все обращения</button>
      <p class="t2 mt-2"><b>${esc(t.subject)}</b></p><p class="hint mt-1">${esc(t.topic)} · <span class="sup-status" id="sup-thread-state">${esc(t.statusName)}</span></p>
      <div class="thread" id="sup-thread" data-ticket="${id}">${messages}</div>
      <div class="field mt-3 mb-0"><label for="sup-reply">Ваше сообщение</label><textarea data-on="input:supportDrafts-a0-value" data-a0="${id}" id="sup-reply" maxlength="2000" placeholder="${t.status==='resolved'?'Обращение закрыто — напишите, если вопрос остался':'Ваше сообщение'}">${esc(supportDrafts[id]||'')}</textarea></div>
      <button data-on="click:supSend-a0" data-a0="${id}" class="btn mt-2">Отправить</button><p class="msg" id="sup-msg2"></p>`;
    const th = $('sup-thread'); th.scrollTop = th.scrollHeight;
    $('h-supdot').hidden = true;
    supTimer = setTimeout(()=>{ if(supTicket===id && wgOpen==='support') supThread(id); }, 15000);   /* пока чат открыт — обновляем раз в 15 секунд */
  }catch(e){ if(supTicket!==id||wgOpen!=='support')return;const msg=$('sup-msg2');if(msg)msg.textContent='Не удалось обновить сообщения. Ваш текст сохранен в поле';else box.innerHTML='<p class="msg err">Не получилось открыть обращение. <button data-on="click:supThread-a0" data-a0="'+id+'" class="text-action">Повторить</button></p>'; }
}
async function supSend(id){
  const text = $('sup-reply').value.trim(), msg = $('sup-msg2'); showMsg(msg); if(!text) return;
  try{ const r = await api('/support/ticket?id='+id,{method:'POST',body:JSON.stringify({text})}); if(!r.ok) throw new Error(r.error); if(supTicket===id&&$('sup-reply')?.value.trim()===text){$('sup-reply').value='';supportDrafts[id]='';growTextarea($('sup-reply'));}hap('ok'); supThread(id); }
  catch(e){ showMsg(msg, 'Не отправилось.', true); }
}

const MATERIAL_NOTE='Материалы Лунарио помогают посмотреть на ситуацию иначе и не заменяют медицинскую, психологическую или юридическую помощь.';
document.querySelectorAll('[data-material-note]').forEach(el=>el.textContent=MATERIAL_NOTE);
function showForecastNote(){
  const box=$('forecast-note');if(!box)return;
  let seen=false;try{seen=localStorage.getItem('lun_forecast_note_'+S.user.id)==='1';}catch(e){}
  box.innerHTML=seen?'':`<p class="hint">${MATERIAL_NOTE}</p><button data-on="click:dismissForecastNote" class="text-action secondary">Понятно</button>`;
}
function dismissForecastNote(){try{localStorage.setItem('lun_forecast_note_'+S.user.id,'1');}catch(e){}$('forecast-note').replaceChildren();}
async function exportPersonalData(){
  if(exportPersonalData.busy)return;exportPersonalData.busy=true;
  try{const r=await fetch(API+'/data/export.pdf');if(r.status===401){location.reload();return;}if(!r.ok)throw new Error('export');
    const blob=await r.blob(),url=URL.createObjectURL(blob);   /* читаемый PDF в стиле Лунарио; JSON для переноса — GET /api/data/export */
    const link=document.createElement('a');link.href=url;link.download='lunario-'+S.day.date+'.pdf';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Файл с вашими данными подготовлен');
  }catch(e){toast('Не удалось скачать данные. Попробуйте еще раз');}finally{exportPersonalData.busy=false;}
}

/* ── главная ── */
const ordinal = (n) => n + '-й';
/* «Сохранить открытку»: настрой дня, тема и вопрос — открыткой на экран блокировки; собирается заранее, как остальные */
/* строка над настроем: тема дня и откуда она — цепочка «источник → тема → настрой» видна, а не подразумевается */
const THEME_SOURCE_LABEL = { card: 'по карте дня', dayrune: 'по руне дня', sky: 'по планетам', tone: 'по прогнозу дня' };
function paintHomeTheme(d){
  const el = $('h-theme'); if (!el) return;
  const t = d.theme; el.hidden = !t || !d.set?.text;
  if (t) el.textContent = `${t.title}${THEME_SOURCE_LABEL[t.source] ? ' · ' + THEME_SOURCE_LABEL[t.source] : ''}`;
}
/* вечером и по воскресеньям «Сегодня» знает, что дальше: записать день (или он уже записан), посмотреть неделю */
function paintHomeLater(d){
  const box = $('home-later'); if (!box || !d?.date) return;
  const rows = [];
  const dow = new Date(d.date + 'T12:00:00Z').getUTCDay(), evening = new Date().getHours() >= 18;
  if (evening) rows.push(d.remembered
    ? `<button data-on="click:goDayCard" class="later-row" type="button"><span class="eyebrow">Вечер</span><b>День записан ✓</b><span class="later-go">Дополнить →</span></button>`
    : `<button data-on="click:goDayCard" class="later-row" type="button"><span class="eyebrow">Вечер</span><b>Запомнить этот день</b><span class="later-go">В дневник →</span></button>`);
  if (dow === 0 || dow === 1) rows.push(`<button data-on="click:goWeek" class="later-row" type="button"><span class="eyebrow">${dow === 0 ? 'Воскресенье' : 'Понедельник'}</span><b>Неделя собралась</b><span class="later-go">Моя неделя →</span></button>`);
  box.hidden = !rows.length; box.innerHTML = rows.join('');
  paintPushNudge();
}
/* Под настроем дня: расписание включено, а сюда уведомления не приходят — одна строка и одно нажатие */
function paintPushNudge(){
  const box = $('home-push'); if (!box) return;
  const due = pushNudgeDue(); box.hidden = !due; if (!due) { box.innerHTML = ''; return; }
  box.innerHTML = !PUSH_OK
    ? `<a class="later-row" id="push-nudge" href="/app/install"><span class="eyebrow">Напоминания</span><b>Придут с экрана «Домой»</b><span class="later-go">Как добавить →</span></a>`
    : Notification.permission === 'denied'
    ? `<button data-on="click:openWidget-remind" class="later-row" id="push-nudge" type="button"><span class="eyebrow">Напоминания</span><b>В этом браузере запрещены</b><span class="later-go">Как разрешить →</span></button>`
    : `<button data-on="click:homePushConnect" class="later-row" id="push-nudge" type="button"><span class="eyebrow">Напоминания</span><b>На этом устройстве не подключены</b><span class="later-go">Включить →</span></button>`;
}
/* Расписание есть, а уведомления сюда не приходят: ячейка пропала после переустановки на экран «Домой» или это новый браузер.
   Показываем, когда настройки уже загружены и разрешение не запрещено; после подключения строка исчезает. */
function pushNudgeDue(){
  if (!S.rem || IOS_SHELL || (!PUSH_OK && !IS_IOS)) return false;   /* iPhone в Safari — тоже показываем: там путь через экран «Домой» */
  return Object.values(S.rem).some((r) => r.enabled) && !remDeviceReady();
}
async function homePushConnect(){
  const btn = $('push-nudge'); if (!btn || btn.disabled) return; btn.disabled = true;
  try { if (await connectPushDevice()) { toast('Уведомления подключены'); track('push_on', 'home'); } }
  catch (e) { toast('Не удалось подключить уведомления. Попробуйте еще раз'); }
  finally { paintPushNudge(); REM_ORDER.forEach(paintRem); }
}
function goDayCard(){ go('history'); requestAnimationFrame(() => $('day-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
function goWeek(){ go('history'); openWidget('week'); }
let morningPc = { key: '', id: null };
function paintMorningPostcard(d){
  const box = $('h-wish-actions'); if (!box) return;
  $('h-wish').hidden = !d.set?.text;
  if (!d.set?.text) { box.innerHTML = ''; return; }
  const key = [d.date, d.set.text, d.card?.name || '', d.rune?.name || ''].join('|');
  if (key !== morningPc.key) morningPc = { key, id: regRes({ type: 'morning', text: d.set.text, question: d.set.question || d.question || '', theme: d.theme?.title || '', day: d.date,
    moonPct: d.moonPct, waxing: (d.moonPhase || 0) < 0.5, card: d.card?.name || '', rune: d.rune?.name || '', lunar: d.lunar ? `${ordinal(d.lunar.n)} лунный день` : '' }) };
  box.innerHTML = `<button data-on="click:savePostcard-a0" data-a0="${morningPc.id}" class="text-action" type="button">Сохранить открытку</button><button data-on="click:shareRes-a0" data-a0="${morningPc.id}" class="text-action secondary" type="button"><i class="ico share"></i>Поделиться</button>`;
  /* открытка собирается, когда экран уже нарисован и главный поток свободен */
  (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(preparePending, { timeout: 3000 });
}
function paintHome(){
  const u=S.user, d=S.day;
  const dt=new Date(d.date+'T12:00:00');
  $('h-date').textContent=dt.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
  $('h-wish').textContent = d.set?.text || '';
  paintMorningPostcard(d); paintHomeTheme(d); paintHomeLater(d);
  if (!S.rem) loadReminders().then(paintPushNudge).catch(() => {});   /* строка «не подключены» — когда расписание известно */
  paintAvatar();
  const staff = isStaff(u);                                           /* админы и все, кто есть в таблице доступов */
  if ($('ac-cabs')) $('ac-cabs').hidden = !staff; document.body.classList.toggle('staff', staff);   /* вход в кабинеты — строкой в Аккаунте, шапка без второго кружка */
  $('h-moon').innerHTML = esc(d.moon) + (d.lunar ? ' · <span class="nowrap">' + esc(ordinal(d.lunar.n)) + ' лунный день</span>' : '');   /* «6-й» не рвется по дефису */
  $('h-lunar').textContent = d.lunar ? d.lunar.period : '';
  moonSetPhase(d.moonPhase);
}
function updatePracticeStatus(key, value){
  document.querySelectorAll('[data-status="'+key+'"]').forEach(el=>el.textContent=value);
}
/* Точка у аватара: «Новое в приложении» этого месяца еще не открывали */
const newsSeen=()=>{ try{ return localStorage.getItem('lun_news_seen')===S.day.date.slice(0,7); }catch(e){ return true; } };
function paintNewsDot(){ const seen=newsSeen(); document.querySelectorAll('.news-dot').forEach(dot=>{dot.hidden=seen;}); }
function markNewsSeen(){ try{ localStorage.setItem('lun_news_seen',S.day.date.slice(0,7)); }catch(e){} paintNewsDot(); }
function habitsHomeStatus(items){
  const due=items.filter(h=>h.due), done=due.filter(h=>h.today).length;S.habitsPending=due.length-done;S.habitsReady=true;S.habitsCount=items.length;
  updatePracticeStatus('habits',!items.length?'Добавить первую привычку':due.length?'Отмечено '+done+' из '+due.length:'Сегодня без отметок');
}
function askesisHomeStatus(data){
  const first=data.active[0];
  updatePracticeStatus('askesis',first?(first.left===0?'Сегодня последний день':'До конца '+first.left+' '+plural(first.left,'день','дня','дней')):'Свой срок и поддержка');
}
function gratitudeHomeStatus(done){ S.gratitudeDone=done; updatePracticeStatus('gratitude',done?'Благодарность записана':'Записать благодарность'); }
/* Что из практик уже сделано сегодня — один запрос /day-status, не чаще раза в 30 секунд */
let homeStatusRequest=null, homeStatusAt=0;
function refreshHomeStatus(force=false){
  if(homeStatusRequest)return homeStatusRequest;
  if(!force && Date.now()-homeStatusAt<30000)return Promise.resolve();
  const uid=S.user.id;
  homeStatusRequest=api('/day-status').then(r=>{
    if(S.user.id!==uid)return;
    S.journalDone=r.journal; S.answerDone=r.answer;
    habitsHomeStatus(r.habits); askesisHomeStatus(r.askesis); gratitudeHomeStatus(r.gratitude);
    homeStatusAt=Date.now();
  }).catch(()=>{}).finally(()=>{homeStatusRequest=null;});
  return homeStatusRequest;
}
function paintLunar(){
  const l=S.day && S.day.lunar; if(!l){ $('ar-period').textContent=''; return; }
  $('ar-period').textContent = (l.advice || '').split(/(?<=[.!?])\s+/)[0];
  if (wgOpen === 'lunar') paintLunarWidget();
}

/* ── мой день: панели заполняются данными дня ── */
function paintToday(){
  const d=S.day;
  renderHub();
  paintCard();
  $('f-title').textContent=d.forecast.title; $('f-text').textContent=d.forecast.text;
  $('f-bars').innerHTML=Object.entries({Работа:'work',Отношения:'love',Здоровье:'health',Финансы:'money'}).map(([label,key])=>{
    const raw=d.forecast.bars?.[key];if(typeof raw!=='number'||!Number.isFinite(raw))return '';
    const value=Math.max(0,Math.min(100,Math.round(raw)));
    return `<div class="barrow"><span class="l">${label}</span><div class="bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-valuetext="${value}%"><i style="width:${value}%"></i></div><span class="v">${value}%</span></div>`;
  }).join('');
  $('t-daysub').textContent=d.forecast.title;
  if($('t-skysub'))$('t-skysub').textContent=d.sky?.title||'Фазы Луны, затмения, ретроградные планеты';   /* то же событие, что в утреннем пуше */
  if(d.card&&d.cardOpened&&!S.flipped)showFlipped();   /* карту уже открывали — панель показывает ее; вытянутая утром ждет переворота */
  if($('t-runesub'))$('t-runesub').textContent=d.rune?`${d.rune.name}${d.rune.keyword?' · '+d.rune.keyword:''}`:'Одна руна на день: образ и совет';
  if($('t-tonesub'))$('t-tonesub').textContent=d.question||'Вопрос по теме дня — ответ вечером в дневнике';
  if (wgOpen === 'tone') paintTone();
  renderMoods(); paintCardTile(); paintLunar(); loadNumerology();
}
const plural=(n,a,b,c)=>{const m=n%100;if(m>=11&&m<=14)return c;const l=n%10;return l===1?a:l>=2&&l<=4?b:c;};
function pickOwnMood(){ const w = ($('mood-own').value || '').trim().split(/\s+/)[0] || ''; if (!w) { toast('Напишите одно слово'); return; } pickMood('own:' + w.slice(0, 24)); }
async function pickMood(id){
  hap();
  try{
    const r=await api('/mood',{method:'POST',body:JSON.stringify({mood:id})});
    S.mood=r.mood; moodUI.own=ownMood(r.mood); renderMoods();
    paintMoodStat(r.stats); paintMoodExtra(); 
  }catch(e){ toast('Не удалось сохранить'); }
}
function paintMoodStat(stats){
  const parts=(stats||[]).filter(s=>s.c>0).map(s=>MOOD_LABEL[s.mood]+' — '+s.c);
  const t = parts.length?'В этом месяце: '+parts.join(' · ')+'.':'';
  $('t-moodstat').textContent=t; $('hm-sub').textContent=t;
}
async function loadNumerology(){
  if (S.num) { paintNum(S.num); return; }
  try{ S.num = await api('/numerology'); paintNum(S.num); }
  catch(e){ /* нумерология не загрузилась — разделы «Обо мне» покажут пустые поля */ }
}
/* ── личный год: иллюстрация, планета и энергия, короткая строка и открытка; описание — блоками ровно как в файле ── */
const inl = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');   /* [текст](адрес) — ссылка на источник */
function blocksHtml(blocks){
  const out = []; let list = null;   /* открытый список: tag, li — пункт не закрыт, sub — открыт вложенный список */
  const endLi = () => { if (list.sub) { out.push('</ul>'); list.sub = false; } if (list.li) { out.push('</li>'); list.li = false; } };
  const close = () => { if (!list) return; if (list.tag === 'table') out.push('</table></div>'); else { endLi(); out.push(`</${list.tag}>`); } list = null; };
  for (const b of blocks || []) {
    if (b.t === 'li') {
      const tag = b.n ? 'ol' : 'ul';
      if (b.lvl && list && list.tag !== 'table') {          /* вложенный пункт живет внутри предыдущего */
        if (!list.sub) { out.push('<ul>'); list.sub = true; }
        out.push(`<li>${inl(b.text)}</li>`); continue;
      }
      if (list && (list.tag !== tag || (b.n === 1 && tag === 'ol'))) close();
      if (!list) { list = { tag, li: false, sub: false }; out.push(`<${tag}>`); }
      endLi(); out.push(`<li${b.n ? ` value="${b.n}"` : ''}>${inl(b.text)}`); list.li = true; continue;
    }
    if (b.t === 'tr') {
      if (!list || list.tag !== 'table') { close(); list = { tag: 'table', head: true }; out.push('<div class="yr-tw"><table class="yr-t">'); }
      const c = list.head ? 'th' : 'td'; list.head = false;
      out.push(`<tr>${b.cells.map((x) => `<${c}>${inl(x)}</${c}>`).join('')}</tr>`); continue;
    }
    close(); out.push(b.t === 'h' ? `<h4>${inl(b.text)}</h4>` : `<p>${inl(b.text)}</p>`);
  }
  close(); return out.join('');
}
/* Год живет от дня рождения до дня рождения — так и подписываем:
   «с 6 апреля 2026 по 5 апреля 2027», строкой ниже — «с 6 апреля 2027 по 5 апреля 2028 — год 3» */
const ruDate = (d, withYear) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).replace(/\s*г\.$/, '');
const dayBefore = (d) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() - 1); return t.toISOString().slice(0, 10); };
const span = (from, to) => `с ${ruDate(from, true)} по ${ruDate(dayBefore(to), true)}`;
const yearPeriod = (y) => y.from ? span(y.from, y.to) + (y.next && y.next.to ? `<br>${span(y.next.from, y.next.to)} — год ${y.next.n}` : '') : String(y.year);
function yearHtml(y){
  const i = y.info, id = y.res || (y.res = regRes({ type: 'year', year: y, stamp: String(y.year) }));
  return `<div class="item rise">
    <img class="yr-img" src="${i.image}?v=1" width="1080" height="1080" alt="Личный год ${y.n} · ${esc(i.energy)}">
    <div class="row top mt-3">
      <span class="num-mark">${y.n}</span>
      <div class="grow"><b>Год ${y.n} · ${esc(i.planet)} · ${esc(i.energy)}</b>${i.message ? `<p class="mt-2 strong italic">${esc(i.message)}</p>` : `<p class="mt-2">${esc(y.text || '')}</p>`}</div>
    </div>
    ${actionsHtml(id)}
  </div>
  <div class="item rise yr-art" style="--i:1">${i.caption ? `<p class="yr-cap">${esc(i.caption)}</p>` : ''}${blocksHtml(i.blocks)}</div>`;
}
function paintNum(n){
  const item=(num,title,text,f)=>`<div class="item rise"><div class="row top">
    <span class="num-mark">${num}</span>
    <div class="grow"><b>${title}</b>${f?`<small>${f}</small>`:''}<p class="mt-2">${text}</p></div></div></div>`;
  $('w-year-box').innerHTML=n.year.info ? yearHtml(n.year) : item(n.year.n,'Личный год '+n.year.n,n.year.text,yearPeriod(n.year));
  if (n.year.info) preparePending();   /* открытка года собирается заранее, как и остальные */
  $('w-birth-box').innerHTML=item(n.destiny.n,n.destiny.title,n.destiny.text,n.destiny.formula);
  $('m-yearsub').textContent=n.year.info ? `${n.year.n} · ${n.year.info.planet} · ${n.year.info.energy}` : String(n.year.n);
}

/* ── «Что вас сегодня беспокоит?»: вопрос раскрывается в три способа получить ответ ── */
function askErrorText(e){
  if(e.code==='limit') track('spread_limit');
  return e.code==='limit' ? 'Разборы на сегодня закончились. Карта дня, «Да/Нет» и руны остаются без ограничений.'
    : e.code==='short_question' ? 'Напишите вопрос целиком, так вы потом вспомните, что вас волновало.'
    : 'Не получилось. Попробуйте еще раз.';
}
$('a-go').onclick=async()=>{
  const q=$('a-q').value.trim(), msg=$('a-msg'); showMsg(msg);
  $('a-go').disabled=true; $('a-go').textContent='Смотрим…';
  try{
    await runAsk(S.mode,q,$('a-result'),$('a-hint'),S.layout);
    $('a-result').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){ showMsg(msg, askErrorText(e), true); }
  checkQ();
};

/* ── вход по коду на почту: один поток на анкету («Уже пользовались?»), экран входа и виджет «Вход по почте».
   Три места отличаются только контейнером и тем, что делать после проверки кода (onDone). ── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const AUTH_ERRORS = {
  send: { too_often: 'Слишком часто. Попробуйте через несколько минут.', mail_off: 'Отправка почты еще не настроена.', send_failed: 'Письмо не ушло. Проверьте адрес или попробуйте позже.', _: 'Не получилось отправить код.' },
  verify: { wrong_code: 'Код не подошел. Проверьте письмо.', expired: 'Код истек — запросите новый.', too_many: 'Слишком много попыток. Запросите новый код.', _: 'Не получилось войти.' },
  /* тот же код, но другое дело: здесь отказ означает, что аккаунт остался на месте */
  del: { wrong_code: 'Код не подошел — аккаунт не удален.', expired: 'Код истек — начните удаление заново.', too_many: 'Слишком много попыток. Начните удаление заново.', no_code: 'Код не найден — начните удаление заново.', _: 'Не получилось удалить аккаунт.' },
};
const authErrorText = (e, step) => AUTH_ERRORS[step][e && e.code] || AUTH_ERRORS[step]._;
/* сотрудник: кабинет открывается по умолчанию, пока человек не нажал «В приложение» — выбор запоминается на устройстве */
const isStaff = (u) => !!(u && u.roles && u.roles.length);
function inApp(){ try{ return localStorage.getItem('lun_app')==='1'; }catch(e){ return false; } }
function openCabinet(){ try{ localStorage.removeItem('lun_app'); }catch(e){} location.href='/app/cabinet'; }
/* box — id контейнера; step — idle | email | code; idle() — что показать в покое; onDone(r) — что делать после кода */
const auth = { box: '', step: 'idle', email: '', idle: () => '', onDone: () => {} };
function authMount(box, o){
  if (auth.box && auth.box !== box) { const prev = $(auth.box); if (prev) prev.innerHTML = ''; }
  Object.assign(auth, { step: 'idle', email: '', idle: () => '' }, o, { box });
  paintAuth();
}
function paintAuth(){
  const box = $(auth.box); if (!box) return;
  box.classList.add('auth-flow');
  if (auth.step === 'idle') { box.innerHTML = auth.idle(); return; }
  box.innerHTML = auth.step === 'email'
    ? `<div class="field"><label for="auth-email">Почта</label><input id="auth-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.ru" value="${esc(auth.email)}"></div>
      <button data-on="click:authSend" class="btn auth-submit">Прислать код</button><p class="msg" id="auth-msg"></p>`
    : `<p class="auth-sent">Код отправлен на <b>${esc(auth.email)}</b></p>
      <div class="field"><label for="auth-code">Код из письма</label><input id="auth-code" class="code-input" inputmode="numeric" maxlength="6" placeholder="000000"></div>
      <button data-on="click:authCheck" class="btn auth-submit">Войти</button>
      <button data-on="click:auth-step-email-paintAuth" class="btn ghost sm auth-secondary">Изменить адрес</button><p class="msg" id="auth-msg"></p>`;
  setTimeout(() => $(auth.step === 'email' ? 'auth-email' : 'auth-code')?.focus(), 60);
}
const requestCode = (email) => api('/auth/request', { method:'POST', body: JSON.stringify({ email }) }).then(() => track('login_code_sent'));
async function authSend(){
  const email = $('auth-email').value.trim().toLowerCase(), msg = $('auth-msg');
  if (!EMAIL_RE.test(email)) { showMsg(msg, 'Проверьте адрес почты.', true); return; }
  showMsg(msg, 'Отправляем код…');
  try { await requestCode(email); auth.email = email; auth.step = 'code'; paintAuth(); hap('ok'); }
  catch (e) { showMsg(msg, authErrorText(e, 'send'), true); }
}
async function authCheck(){
  const code = $('auth-code').value.trim(), msg = $('auth-msg');
  if (code.length !== 6) { showMsg(msg, 'Код состоит из шести цифр.', true); return; }
  try {
    const r = await api('/auth/verify', { method:'POST', body: JSON.stringify({ email: auth.email, code }) });
    hap('done'); track('login_done');
    if (isStaff(r.user) && !inApp()) { location.href = '/app/cabinet'; return; }   // сотрудник — сначала в кабинет
    auth.onDone(r);
  } catch (e) { showMsg(msg, authErrorText(e, 'verify'), true); }
}
/* Виджет «Вход по почте» в «Аккаунте» */
function renderAuth(){
  const u = S.user;
  const idle = () => u.email
    ? `<p class="t2">Вы вошли как <b>${esc(u.email)}</b></p>
      ${isStaff(u) ? `<button data-on="click:openCabinet" class="btn sm full mt-3">Кабинет сотрудника</button>` : ''}
      <button data-on="click:logout" class="btn ghost sm full mt-3">Выйти на этом устройстве</button>`
    : S.localPreview
    ? '<p>Вход по почте доступен на сайте Лунарио.</p><p class="mt-3">Это локальный просмотр: письма с кодом здесь не отправляются. Записи демо остаются здесь и не переносятся в аккаунт на сайте.</p><a class="btn auth-submit" href="https://lunario.online/app/" target="_blank" rel="noopener">Открыть сайт для входа ↗</a>'
    : `<p class="t2">Вход по почте скоро появится</p>
      <p class="hint">Пока записи хранятся на этом устройстве. Не удаляйте приложение — иначе история потеряется.</p>`;
  authMount('m-auth', { step: u.email || !S.mailReady ? 'idle' : 'email', idle, onDone: (r) => {
    if (r.merged) { location.reload(); return; }   /* чужой аккаунт найден — перезагрузка подтянет его целиком */
    S.user = r.user; toast('Почта сохранена — доступ не потеряется'); renderAuth(); loadAccount();
  } });
}
/* До анкеты — «Уже пользовались?» на анкете и экран входа: профиль нашелся — перезагрузка открывает приложение;
   почта новая — привязана к этому устройству, остается заполнить анкету (почту в ней уже не спрашиваем) */
function obDone(r){
  if (r.user && r.user.onboarded) { location.reload(); return; }
  S.user = r.user;
  if (auth.box === 'l-box') { $('l-after').style.display = ''; $('l-box').style.display = 'none'; return; }
  $('o-back').style.display = 'none'; $('o-mailfield').style.display = 'none';
  toast('Почта сохранена — осталось заполнить профиль');
}
const obAuthIdle = () => `<button data-on="click:auth-step-email-paintAuth" class="btn ghost sm full mt-3">Войти по почте</button>`;
/* all — отозвать сессии на всех устройствах: если телефон потерян или код входа попал не в те руки */
async function logout(all){
  if(!confirm(all?'Выйти на всех устройствах? Везде понадобится заново войти по коду; записи останутся в аккаунте.':'Выйти на этом устройстве? Записи останутся в аккаунте и вернутся при следующем входе.')) return;
  await api(all?'/auth/logout-all':'/auth/logout',{method:'POST'});
  location.reload();
}
/* ══════════ «Моя неделя: про что она» — воскресный экран Дневника: пять частей по фактам, без интерпретаций ══════════ */
const WK={data:null,pick:''};
const WK_DOW=['пн','вт','ср','чт','пт','сб','вс'];
const WK_MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const wkDate=(d,month=true)=>{const [,m,dd]=d.split('-').map(Number);return month?`${dd} ${WK_MONTHS[m-1]}`:String(dd);};
const wkRange=(a,b)=>a.slice(0,7)===b.slice(0,7)?`${wkDate(a,false)}–${wkDate(b)}`:`${wkDate(a)} – ${wkDate(b)}`;
const WK_KIND={'':'запись',gratitude:'благодарность',answer:'ответ на вопрос дня'};
const WK_VERDICT=[['yes','Отозвалось'],['no','Не связано'],['unsure','Не уверена']];
async function loadWeek(pick){
  if(pick!==undefined)WK.pick=pick;
  const box=$('week-box');if(!box)return;if(!WK.data)box.innerHTML='<p class="hint" role="status">Собираем неделю…</p>';
  try{WK.data=await api('/week'+(WK.pick?'?week='+WK.pick:''));paintWeek();}
  catch(e){box.innerHTML='<p class="msg err">Неделя не загрузилась. <button data-on="click:loadWeek" class="text-action" type="button">Повторить</button></p>';}
}
function weekShift(n){const w=WK.data?.week;if(!w)return;loadWeek(new Date(Date.parse(w.start+'T12:00:00Z')+Number(n)*7*864e5).toISOString().slice(0,10));}
function paintWeek(){
  const w=WK.data,box=$('week-box');if(!w||!box)return;
  const nav=`<div class="week-nav"><button data-on="click:weekShift-a0" data-a0="-1" type="button" class="text-action">← прошлая</button><span class="eyebrow">${wkRange(w.week.start,w.week.end)}</span>${w.week.current?'<span></span>':'<button data-on="click:weekShift-a0" data-a0="1" type="button" class="text-action">следующая →</button>'}</div>`;
  const quote=(f)=>`<blockquote class="week-quote"><small>${wkDate(f.day)} · ${WK_KIND[f.kind]||''}</small><p>${esc(f.text)}</p></blockquote>`;
  const saved=w.saved.length?`<section class="card week-part"><h3>Что вы сохранили</h3>${w.saved.map(quote).join('')}</section>`:'';
  const reflect=`<section class="card week-part"><h3>${esc(w.reflection.question)}</h3><p class="hint">Одна строка, если хочется — она останется в дневнике</p><div class="field"><textarea data-on="input:growTextarea-this" id="wk-reflect" maxlength="2000" rows="2">${esc(w.reflection.text)}</textarea></div><div class="answer-actions"><button data-on="click:saveWeekReflection" class="btn sm" id="wk-reflect-save" type="button">Сохранить</button></div><p class="hint" id="wk-reflect-state" role="status"></p></section>`;
  if(w.mode!=='full'){box.innerHTML=nav+`<section class="card week-part"><p class="t2">${esc(w.text)}</p></section>`+saved+reflect;growTextarea($('wk-reflect'));return;}
  const days=w.moods.days;
  const moods=`<section class="card week-part"><h3>Настроение недели</h3>${w.moods.count?`<div class="week-strip" aria-hidden="true">${days.map((d,i)=>`<div class="week-col${d.day>w.week.today?' future':''}"><span class="week-dow">${WK_DOW[i]}</span><span class="week-dot ${d.moods.length?'done':'none'}"></span></div>`).join('')}</div><div class="week-mood-list">${days.map((d,i)=>d.moods.length?`<p><b>${WK_DOW[i]}</b>${d.moods.map(esc).join(' · ')}</p>`:'').join('')}</div>${w.moods.top[0]?.count>1?`<p class="hint">Чаще всего — ${w.moods.top.filter(t=>t.count===w.moods.top[0].count).map(t=>esc(t.mood)).join(', ')}: ${w.moods.top[0].count} ${plural(w.moods.top[0].count,'день','дня','дней')} из ${w.moods.count}</p>`:`<p class="hint">${w.moods.count===1?'Один день с отметкой — картина сложится к концу недели':'Ничего не повторялось — каждый день был своим'}</p>`}`:'<p class="hint">Настроение на этой неделе не отмечали</p>'}</section>`;
  const echoes=`<section class="card week-part"><h3>Что отозвалось</h3><p class="hint">Утренний настрой и то, что вы записали вечером. Связаны ли они — решаете вы</p>${w.echoes.length?w.echoes.map(e=>`<div class="week-echo" data-day="${e.day}"><small>${wkDate(e.day)}${e.source?' · '+esc(e.source):''}</small><p><span class="week-when">Утром</span> ${esc(e.morning)}</p><p><span class="week-when">Вечером</span> ${esc(e.evening)}</p><div class="chips flow">${WK_VERDICT.map(([k,l])=>`<button data-on="click:weekEcho-a0-a1" data-a0="${e.day}" data-a1="${k}" type="button" class="chip${e.verdict===k?' on':''}" aria-pressed="${e.verdict===k}">${l}</button>`).join('')}</div></div>`).join(''):'<p class="hint">Пар «утро ↔ вечер» пока не набралось: для них нужны настрой утром и запись вечером</p>'}</section>`;
  const dots=(list,cls)=>`<div class="week-dots" aria-hidden="true">${days.map(d=>`<span class="week-dot ${cls(list.find(x=>x.day===d.day))}"></span>`).join('')}</div>`;
  const habits=w.rhythm.habits.map(h=>`<div class="week-row"><div class="grow"><b>${esc(h.title)}</b><small>${h.due?`${h.done} из ${h.due} ${plural(h.due,'дня','дней','дней')}`:`${h.done} ${plural(h.done,'день','дня','дней')}`}</small></div>${dots(h.days,x=>!x?'none':x.done?'done':'due')}</div>`).join('');
  const askesis=w.rhythm.askesis.map(a=>`<div class="week-row"><div class="grow"><b>${esc(a.title)}</b><small>${a.days.length?`держусь — ${a.kept}${a.missed?` · сорвалась — ${a.missed}`:''}`:'отметок на этой неделе нет'}</small></div>${dots(a.days,x=>!x?'none':x.kept?'done':'missed')}</div>`).join('');
  const rhythm=habits||askesis?`<section class="card week-part"><h3>Ваш ритм</h3>${habits}${askesis}${w.rhythm.phrase?`<p class="hint week-phrase">${esc(w.rhythm.phrase)}</p>`:''}</section>`:'';
  box.innerHTML=nav+moods+saved+echoes+rhythm+reflect;growTextarea($('wk-reflect'));
}
/* отметка «отозвалось»: повторное нажатие снимает */
async function weekEcho(day,verdict){
  const cur=WK.data?.echoes.find(e=>e.day===day);const next=cur&&cur.verdict===verdict?'':verdict;
  try{const r=await api('/week/echo',{method:'POST',body:JSON.stringify({day,verdict:next})});if(cur)cur.verdict=r.verdict;
    document.querySelectorAll(`.week-echo[data-day="${day}"] .chip`).forEach(b=>{const on=b.dataset.a1===r.verdict;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});hap('ok');}
  catch(e){toast('Не удалось сохранить отметку');}
}
async function saveWeekReflection(){
  if(saveWeekReflection.busy||!WK.data)return;saveWeekReflection.busy=true;const btn=$('wk-reflect-save');btn.disabled=true;
  try{const r=await api('/week/reflect',{method:'POST',body:JSON.stringify({week:WK.data.week.start,text:$('wk-reflect').value})});WK.data.reflection=r;
    $('wk-reflect-state').textContent=r.text?'Сохранено ✦ Строка в дневнике под датой воскресенья':'Строка снята';hap('ok');XP.timeline.dirty=true;}
  catch(e){$('wk-reflect-state').textContent='Не удалось сохранить. Текст остался в поле — попробуйте еще раз';}
  finally{saveWeekReflection.busy=false;btn.disabled=false;}
}
/* по воскресеньям и понедельникам «Моя неделя» — первой плиткой Дневника */
function paintWeekTop(){
  const el=$('week-top');if(!el||!S.day?.date)return;const dow=new Date(S.day.date+'T12:00:00Z').getUTCDay();const show=dow===0||dow===1;el.hidden=!show;
  if(show)$('week-top-sub').textContent=dow===0?'Воскресенье — можно посмотреть на неделю целиком':'Прошедшая неделя — целиком, на одном экране';
}
/* ══════════ Реферальная ссылка: одна на все места — «Позвать подругу», совместимость, открытки ══════════
   Код приходит в /api/me (user.refCode); ссылка открывает приложение, внутри — инструкция по установке. Кто пришел по ссылке —
   users.invited_by, видно в кабинете и здесь именами. Подарок обеим: неделю вдвое больше подробных разборов. */
const refLink = () => S.user?.refCode ? `${location.origin}/app/?ref=${S.user.refCode}` : `${location.origin}/app/`;
const inviteText = (who) => who === 'compat'
  ? `Посчитала нашу совместимость в Лунарио — посмотри, что там у тебя. По моей ссылке неделю вдвое больше разборов, а в приложении есть, как поставить его на телефон:\n${refLink()}`
  : `Это Лунарио — пространство, где можно услышать себя: карта дня, дневник, настроение. Заходи по моей ссылке — обеим неделю вдвое больше разборов. Внутри — как поставить на телефон:\n${refLink()}`;
/* Кнопки «Поделиться» и «Скопировать» — одинаковые в каждом месте; where — откуда нажали (аналитика) */
const inviteButtonsHtml = (where, { shareLabel = 'Поделиться ссылкой' } = {}) => `<div class="invite-actions mt-3">
    <button data-on="click:shareInvite-a0" data-a0="${where}" class="btn sm full" type="button">${shareLabel}</button>
    <button data-on="click:copyInvite-a0" data-a0="${where}" class="btn ghost sm full mt-2" type="button">Скопировать ссылку</button></div>`;
async function shareInvite(where){
  const text = inviteText(where); track('invite_share', where);
  if (IOS_SHELL && nativePost({ type: 'share', text })) return;
  if (navigator.share) { try { await navigator.share({ title: 'Лунарио', text }); return; } catch(e) { if (e.name === 'AbortError') return; } }
  await copyInvite(where, text);   /* без меню «Поделиться» (компьютер) — текст с ссылкой в буфер */
}
async function copyInvite(where, text){
  const value = text || refLink();
  try{ await navigator.clipboard.writeText(value); toast(text ? 'Приглашение скопировано — вставьте в сообщение' : 'Ссылка скопирована'); }
  catch(e){ const el = $('inv-link'); if (el) { el.select(); toast('Скопируйте ссылку вручную'); } else toast('Не удалось скопировать: ' + value); }
  track('invite_copy', where || '');
}
async function loadInvite(){
  try{
    const i = await api('/invite');
    const bonus = i.bonusActive ? `<p class="hint t-gold mt-3">Подарок действует до ${fmtDay(i.bonusUntil)} — четыре подробных разбора в день.</p>` : '';
    const names = (i.broughtNames || []).join(', '), rest = i.brought - (i.broughtNames || []).length;
    const brought = i.brought ? `<p class="hint mt-3">По вашей ссылке пришли: ${i.brought}${names ? ` — ${esc(names)}${rest > 0 ? ` и еще ${rest} без имени` : ''}` : ''}</p>` : '<p class="hint mt-3">По вашей ссылке пока никто не приходил — здесь появятся имена.</p>';
    $('inv-box').innerHTML = `
      <div class="field mb-0"><input id="inv-link" class="compact" readonly value="${esc(i.link)}" aria-label="Моя ссылка"></div>
      ${inviteButtonsHtml('invite')}
      ${bonus}${brought}`;
  }catch(e){ $('inv-box').innerHTML = '<p class="hint">Ссылка появится чуть позже.</p>'; }
}
async function addWish(){
  const t=$('w-text').value.trim(); if(t.length<3){ toast('Сформулируйте чуть подробнее'); return; }
  if(addWish.saving) return; addWish.saving=true;$('wish-save').disabled=true;
  const photo=XP.wishPhoto;
  try {
    const r=await api('/wishes',{method:'POST',body:JSON.stringify({text:t,photo})});
    if(XP.wishPhoto===photo){XP.wishPhoto='';paintWishDraft();}
    if($('w-text').value.trim()===t) $('w-text').value='';
    renderWishes(r); hap('done'); toast('Желание сохранено');
  } catch(e){ toast('Не удалось сохранить желание. Текст остался в поле.'); }
  finally { addWish.saving=false;$('wish-save').disabled=false; }
}
async function toggleWish(id){
  hap();
  try { renderWishes(await api('/wishes',{method:'PATCH',body:JSON.stringify({id})})); }
  catch(e){ toast('Не удалось изменить отметку желания. Попробуйте еще раз.'); }
}
/* Подсказки и диктовка — в «Записать мысль» (j) и в первой ячейке карточки дня (dc): одна механика, разные поля */
const DICT_SCOPES={j:{text:'j-text',btn:'j-dictate',note:'j-speech-note'},dc:{text:'dc-text',btn:'dc-dictate',note:'dc-speech-note'}};
function journalPrompt(text,scope='j'){
  const el=$(DICT_SCOPES[scope].text); if(!el) return;
  if(!el.value.trim()) el.value=text+'\n';
  el.focus(); el.setSelectionRange(el.value.length,el.value.length); growTextarea(el); hap();
}
let journalSpeech=null;
function prepareDictation(){
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  for(const c of Object.values(DICT_SCOPES)){const btn=$(c.btn),note=$(c.note);if(!btn)continue;
    btn.textContent=supported?'Продиктовать':'Диктовка с клавиатуры';btn.setAttribute('aria-pressed','false');
    if(note)note.textContent=supported?'Браузер может отправлять голос своему сервису распознавания. В Лунарио сохраняется текст.':'Нажмите микрофон на клавиатуре телефона или включите системную диктовку';}
}
function stopJournalDictation(){const rec=journalSpeech;journalSpeech=null;if(rec){rec.onresult=rec.onerror=rec.onend=null;try{rec.abort();}catch(e){}}prepareDictation();}
function journalDictate(scope='j'){
  const c=DICT_SCOPES[scope]; if(!$(c.btn)) return;
  if(journalSpeech){journalSpeech.stop();return;}
  prepareDictation(); if($(c.note))$(c.note).hidden=false;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){$(c.text).focus();return;}
  const rec=new Recognition();journalSpeech=rec;rec.lang='ru-RU';rec.interimResults=false;
  $(c.btn).textContent='Остановить диктовку';$(c.btn).setAttribute('aria-pressed','true');
  rec.onresult=e=>{if(journalSpeech!==rec)return;const el=$(c.text);for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal!==false)el.value+=(el.value.trim()?' ':'')+e.results[i][0].transcript;el.value=el.value.slice(0,2000);growTextarea(el);};
  rec.onerror=e=>{if(journalSpeech!==rec||e.error==='aborted')return;toast(e.error==='not-allowed'?'Разрешите микрофон в настройках браузера или используйте клавиатуру':'Не удалось распознать речь. Попробуйте еще раз');};
  rec.onend=()=>{if(journalSpeech!==rec)return;journalSpeech=null;prepareDictation();};
  try{rec.start();}catch(e){stopJournalDictation();toast('Не удалось включить диктовку');}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&journalSpeech)stopJournalDictation();});
async function compat(){
  const b=$('m-cdate').value; if(!b){ toast('Укажите дату партнера'); return; }
  try{
    const r=await api('/compat',{method:'POST',body:JSON.stringify({birth:b})});
    $('m-cres').style.display='block';
    $('m-cres').innerHTML=`<div class="big">${r.total}%</div>
      <p class="serif center strong">${r.you} и ${r.other}</p>
      <div class="split">
      ${r.rings.map(([n,v])=>`<div class="ring"><svg width="54" height="54" viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle class="v" cx="28" cy="28" r="24" fill="none" stroke="#d9b868" stroke-width="4" stroke-linecap="round" data-p="${v}"/></svg><span class="val">${v}%</span><span class="lbl">${n}</span></div>`).join('')}
      </div><p class="mt-3">${r.text}</p>
      <div class="compat-invite mt-4"><span class="eyebrow">Позвать в Лунарио</span><p class="hint mt-2">Отправьте партнеру или подруге ссылку: по ней открывается приложение, внутри — как поставить его на телефон. Обоим на неделю — вдвое больше подробных разборов.</p>${inviteButtonsHtml('compat', { shareLabel: 'Отправить ссылку' })}</div>`;
    setTimeout(()=>document.querySelectorAll('#m-cres circle.v').forEach((c,i)=>{ c.style.transitionDelay=i*90+'ms'; c.style.strokeDashoffset=151-151*(+c.dataset.p)/100; }),60);
    hap('done');
  }catch(e){ toast('Не получилось рассчитать'); }
}
function attachCity(inputId, listId, geoId){
  const inp=$(inputId), list=$(listId), geo=$(geoId);
  let items=[], hl=-1, picked=null, t=null;
  const paint=()=>{
    list.innerHTML=items.map((c,i)=>`<button type="button" class="${i===hl?'hl':''}" data-i="${i}">${c.name}<small>${[c.region,c.country].filter(Boolean).join(', ')} · ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}</small></button>`).join('');
    list.classList.toggle('on', items.length>0);
    list.querySelectorAll('button').forEach(b=>b.onclick=()=>choose(items[+b.dataset.i]));
  };
  const choose=(c)=>{ picked=c; inp.value=c.name; items=[]; hl=-1; paint();
    geo.innerHTML=`✦ <b>${c.name}</b> — ${[c.region,c.country].filter(Boolean).join(', ')}<br>${c.lat.toFixed(4)}, ${c.lon.toFixed(4)} · ${c.tz}`; hap(); };
  inp.addEventListener('input',()=>{
    picked=null; geo.textContent='Координаты и часовой пояс подставим сами — они понадобятся для натальной карты.';
    clearTimeout(t);
    const q=inp.value.trim();
    if(q.length<2){ items=[]; paint(); return; }
    t=setTimeout(async()=>{
      try{ items=(await api('/cities?q='+encodeURIComponent(q))).items; hl=-1; paint(); }catch(e){ items=[]; paint(); }
    },160);
  });
  inp.addEventListener('keydown',(e)=>{
    if(!items.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); hl=(hl+1)%items.length; paint(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); hl=(hl-1+items.length)%items.length; paint(); }
    else if(e.key==='Enter'&&hl>=0){ e.preventDefault(); choose(items[hl]); }
    else if(e.key==='Escape'){ items=[]; paint(); }
  });
  inp.addEventListener('blur',()=>setTimeout(()=>{ items=[]; paint(); },160));
  return { get picked(){ return picked; } };
}

/* ── анкета: профиль → код на почту → главная ── */
attachCity('o-city','o-city-list','o-geo');
$('o-go').onclick=async()=>{
  const msg=$('o-msg'); showMsg(msg);
  const birth=$('o-birth').value;
  if(!birth){ showMsg(msg, 'Укажите дату рождения — без нее подсказки будут общими.', true); return; }
  const email=$('o-email').value.trim().toLowerCase();
  if(S.mailReady && !EMAIL_RE.test(email)){ showMsg(msg, 'Проверьте адрес почты.', true); return; }
  if(!$('o-consent').checked){ showMsg(msg, 'Чтобы продолжить, подтвердите согласие на обработку данных.', true); return; }
  const body = JSON.stringify({ name:$('o-name').value, birth, birthTime:$('o-time').value, city:$('o-city').value, consent:true });
  $('o-go').disabled=true; $('o-go').textContent='Готовим ваш день…';
  let last=null;
  for (let attempt=1; attempt<=2; attempt++){
    try{
      const r = await api('/profile', { method:'POST', body });
      S.user=r.user; S.day=r.day; hap('done');
      if (S.mailReady && email) { await obSendCode(email); return; }
      finishOnboarding(); return;
    }catch(e){
      last=e;
      if (e.status) break;
      if (attempt===1){ $('o-go').textContent='Связь прервалась, пробуем еще раз…'; await new Promise(r=>setTimeout(r,1200)); }
    }
  }
  $('o-go').disabled=false; $('o-go').textContent='Открыть мой день';
  showMsg(msg, last && last.code==='no_consent' ? 'Подтвердите согласие на обработку данных.'
    : last && last.code==='bad_birth' ? 'Проверьте дату рождения.'
    : last && last.status ? 'Сервер не принял анкету. Напишите нам, если повторится.'
    : 'Не удалось связаться с сервером — похоже, пропала сеть. Данные не потеряны: нажмите еще раз.', true);
};
/* В анкете указана почта: код — на том же экране; не ушел — не держим человека на пороге, почту можно привязать в «Аккаунте» */
async function obSendCode(email){
  try { await requestCode(email); }
  catch (e) { toast(authErrorText(e, 'send')); finishOnboarding(); return; }
  $('o-form').style.display='none'; $('o-back').style.display='none'; $('o-codebox').style.display='';
  $('v-onb').classList.add('verifying-email'); scrollToTop(0);
  authMount('o-codebox', { step: 'code', email, onDone: (r) => {
    if (r.merged) { location.reload(); return; }        // почта уже была — открываем тот аккаунт
    S.user = r.user; finishOnboarding();
  } });
}

/* ── разделы: данные подгружаются при входе ── */
/* На экране «Дневник» видны лента и счетчик желаний; итоги, вопросы и записи виджеты грузят сами при открытии */
function loadHistory(){ if(!XP.timeline.items.length||XP.timeline.dirty)loadTimeline(); loadWishes(); loadDayCard(); paintWeekTop(); }

/* ══════════ Карточка дня «Запомнить этот день»: ячейки-вопросы, настроение, привычки, аскеза — один запрос, разные типы ══════════ */
const DC={state:null,moods:new Set(),own:'',habits:new Map(),askesis:new Map()};
async function loadDayCard(){
  if(!$('day-card'))return;
  try{ DC.state=await api('/day'); paintDayCard(); }
  catch(e){ if($('dc-state'))$('dc-state').textContent='Не удалось загрузить сегодняшний день. Попробуйте еще раз'; }
}
function paintDayCard(){
  const s=DC.state;if(!s||!$('day-card'))return;
  $('dc-date').textContent=fmtDay(s.day);
  $('dc-question').textContent=s.question||'';
  if(!journalSpeech)prepareDictation();
  const fill=(id,cell)=>{const el=$(id);if(document.activeElement!==el){el.value=cell?cell.text:'';growTextarea(el);}};
  fill('dc-text',s.text);fill('dc-grat',s.gratitude);fill('dc-answer',s.answer);
  DC.moods=new Set(s.moods.filter(m=>!m.startsWith('own:')));const own=s.moods.filter(m=>m.startsWith('own:')).map(m=>m.slice(4));
  if(document.activeElement!==$('dc-own')){DC.own=own.join(', ');$('dc-own').value=DC.own;}
  const shades=[...s.moods].filter(m=>!quickMoods().some(q=>q.key===m)&&!m.startsWith('own:'));   /* оттенки из круга эмоций — тоже чипами */
  $('dc-mood-chips').innerHTML=[...quickMoods().map(q=>[q.key,q.label]),...shades.map(k=>[k,MOOD_LABEL[k]])].map(([k,label])=>`<button data-on="click:dcMood-a0" data-a0="${k}" type="button" class="chip${DC.moods.has(k)?' on':''}" aria-pressed="${DC.moods.has(k)}">${esc(label)}</button>`).join('')
    +`<button data-on="click:openWidget-mood" type="button" class="chip">все оттенки…</button>`;
  DC.habits=new Map(s.habits.map(h=>[h.id,h.today]));
  const habits=s.habits.filter(h=>h.due||h.rule==='free'||h.today);
  $('dc-habit-list').innerHTML=habits.map(h=>`<div class="dc-row"><button data-on="click:dcHabit-a0" data-a0="${h.id}" type="button" class="dc-check" aria-pressed="${DC.habits.get(h.id)}" aria-label="${esc(h.title)}">${DC.habits.get(h.id)?'✓':''}</button><div class="grow">${esc(h.title)}</div></div>`).join('');
  $('dc-habits').classList.toggle('empty',!habits.length);
  DC.askesis=new Map(s.askesis.map(a=>[a.id,{kept:a.kept,note:a.note}]));
  $('dc-askesis-list').innerHTML=s.askesis.map(a=>`<div class="dc-ask"><div class="grow"><b>${esc(a.title)}</b><small>день ${a.done} из ${a.total}${a.left?` · осталось ${a.left} ${plural(a.left,'день','дня','дней')}`:' · последний день'}</small></div>
    <button data-on="click:dcAsk-a0-a1" data-a0="${a.id}" data-a1="1" type="button" class="chip${a.kept===true?' on':''}" aria-pressed="${a.kept===true}">держусь</button><button data-on="click:dcAsk-a0-a1" data-a0="${a.id}" data-a1="0" type="button" class="chip${a.kept===false?' on':''}" aria-pressed="${a.kept===false}">сорвалась</button>
    <div class="field grow"><input data-on="input:dcNote-a0-value" data-a0="${a.id}" maxlength="500" placeholder="заметка, если хочется" value="${esc(a.note||'')}"></div></div>`).join('');
  $('dc-askesis').classList.toggle('empty',!s.askesis.length);
}
function dcMood(key){if(DC.moods.has(key))DC.moods.delete(key);else DC.moods.add(key);const b=document.querySelector(`#dc-mood-chips [data-a0="${key}"]`);if(b){b.classList.toggle('on',DC.moods.has(key));b.setAttribute('aria-pressed',DC.moods.has(key));}}
function dcOwnInput(){DC.own=$('dc-own').value;}
function dcHabit(id){id=Number(id);DC.habits.set(id,!DC.habits.get(id));const b=document.querySelector(`#dc-habit-list [data-a0="${id}"]`);if(b){b.setAttribute('aria-pressed',DC.habits.get(id));b.textContent=DC.habits.get(id)?'✓':'';}}
function dcAsk(id,kept){id=Number(id);const cur=DC.askesis.get(id)||{kept:null,note:''};cur.kept=kept==='1';DC.askesis.set(id,cur);document.querySelectorAll(`#dc-askesis-list [data-a0="${id}"].chip`).forEach(b=>{const on=(b.dataset.a1==='1')===cur.kept;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});}
function dcNote(id,value){id=Number(id);const cur=DC.askesis.get(id)||{kept:null,note:''};cur.note=value;DC.askesis.set(id,cur);}
async function saveDayCard(){
  if(saveDayCard.busy||!DC.state)return;saveDayCard.busy=true;const btn=$('dc-save');btn.disabled=true;btn.textContent='Запоминаем…';
  const own=DC.own.split(',').map(x=>x.trim().replace(/\s+/g,'-').slice(0,24)).filter(Boolean).map(x=>'own:'+x);
  const body={text:$('dc-text').value,gratitude:$('dc-grat').value,answer:$('dc-answer').value,question:DC.state.question,moods:[...DC.moods,...own],
    habits:[...DC.habits].map(([id,done])=>({id,done})),askesis:[...DC.askesis].map(([id,v])=>({id,...(v.kept===null?{}:{kept:v.kept}),note:v.note||''}))};
  try{ DC.state=await api('/day',{method:'POST',body:JSON.stringify(body)}); paintDayCard(); hap('done');
    $('dc-state').textContent='День сохранен ✦ Можно дополнить до полуночи'; toast('День сохранен ✦'); XP.timeline.dirty=true; loadTimeline(); S.mood=DC.state.moods[0]||null; if(S.day&&DC.state.saved.length){S.day.remembered=true;paintHomeLater(S.day);} }
  catch(e){ $('dc-state').textContent='Не удалось сохранить. Все написанное осталось в полях — попробуйте еще раз'; }
  finally{ saveDayCard.busy=false; btn.disabled=false; btn.textContent='Запомнить этот день'; }
}
const loadWishes=()=>api('/wishes').then(renderWishes).catch(()=>{});
function loadAbout(){
  const u=S.user; loadNumerology();
  $('ab-sub').textContent=[u.name,u.sign].filter(Boolean).join(' · ')||'Мой профиль';
}
function loadAccount(){
  const u=S.user; paintAvatar();
  $('ac-name').textContent=u.name||'Мой профиль';
  $('profile-summary').textContent=[u.birth?fmtDay(u.birth):'',u.city].filter(Boolean).join(' · ');
  $('ac-mail-sub').textContent=u.email||'Сохраненные записи доступны на других устройствах';   /* почта, по которой вошли, — прямо в ряду «Вход по почте» */
}
function loadJournal(){
  api('/journal').then(r=>{
    const kindOf = (i) => i.kind === 'gratitude' ? ' · благодарность' : i.kind === 'answer' ? ' · ответ на вопрос дня' : '';
    const html=r.items.map(i=>`<div class="item"><small>${fmtDay(i.day)}${kindOf(i)}</small>${i.kind === 'answer' && i.title ? `<p class="mt-1 italic">${esc(i.title)}</p>` : ''}<p class="mt-2">${esc(i.text)}</p></div>`).join('')||'<div class="item"><p>Пока пусто. Пара строк вечером — и здесь появится ваша лента.</p></div>';
    $('m-journal').innerHTML=html;
  }).catch(()=>{});
}
async function saveJournal(){
  const t=$('j-text').value.trim(); if(t.length<3){ toast('Напишите хотя бы пару слов'); return; }
  if(saveJournal.saving) return; saveJournal.saving=true;
  try {
    const r=await api('/journal',{method:'POST',body:JSON.stringify({text:t})});
    if($('j-text').value.trim()===t) $('j-text').value='';
    hap('done');
    const card=$('journal-card'); card.classList.remove('saved'); void card.offsetWidth; card.classList.add('saved');
    $('journal-saved').hidden=false;$('journal-saved').textContent='Запись сохранена · '+fmtDay(r.item.day);toast('Запись сохранена');S.journalDone=true;growTextarea($('j-text'));loadJournal();
  } catch(e){ toast('Не удалось сохранить запись. Текст остался в поле.'); }
  finally { saveJournal.saving=false; }
}
let editReady = false;
function fillEdit(){
  const u = S.user;
  $('e-name').value = u.name || ''; $('e-birth').value = u.birth || ''; $('e-time').value = u.birthTime || ''; $('e-city').value = u.city || '';
  $('e-msg').textContent='';
  if (!editReady) { attachCity('e-city','e-city-list','e-geo'); editReady = true; }
}
async function saveProfile(){
  const msg = $('e-msg');
  const birth = $('e-birth').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) { showMsg(msg, 'Проверьте дату рождения.', true); return; }
  showMsg(msg, 'Сохраняем…');
  try{
    const r = await api('/profile',{method:'POST',body:JSON.stringify({
      name:$('e-name').value.trim(), birth, birthTime:$('e-time').value, city:$('e-city').value.trim(), consent:true })});
    S.user = r.user; S.day = r.day; S.num = null; natalCache = null;
    showMsg(msg);
    toast('Данные обновлены'); closeWidget();
    paintHome(); paintToday(); loadAccount();
  }catch(e){
    showMsg(msg, e.code==='bad_birth' ? 'Проверьте дату рождения.' : 'Не получилось сохранить. Попробуйте еще раз.', true);
  }
}
/* Удаление необратимо, поэтому у аккаунта с почтой оно подтверждается кодом из письма — как и вход.
   Аккаунту без почты подтверждать нечем: остается только вопрос на экране. */
async function wipe(what){
  const isAcc=what==='account';
  if(!confirm(isAcc?'Удалить аккаунт и все данные? Это необратимо.':'Очистить всю историю вопросов, дневник и желания?')) return;
  let code='';
  if(isAcc && S.user && S.user.email){
    let sent;
    try{ sent=await api('/account/delete-code',{method:'POST'}); }
    catch(e){ toast(authErrorText(e,'send')); return; }
    if(sent.sent){
      code=(prompt(`Код подтверждения отправлен на ${S.user.email}. Введите его, чтобы удалить аккаунт — после этого записи не восстановить.`)||'').trim();
      if(!code) return;
    }
  }
  try{ await api('/'+(isAcc?'account':'data'),{method:'DELETE',...(code?{body:JSON.stringify({code})}:{})}); }
  catch(e){ toast(isAcc?authErrorText(e,'del'):'Не получилось очистить историю.'); return; }
  if(isAcc){ location.reload(); return; }
  toast('История очищена'); loadHistory();
}

/* ── установка на телефон ── */
/* Строка «Установить на телефон» в Аккаунте — ссылка на инструкцию /app/install (страница и PDF, backend/install-guide.mjs).
   Если Chrome на телефоне сам умеет ставить приложение (beforeinstallprompt), нажатие открывает его диалог; отказался — следующее
   нажатие ведет на инструкцию. На компьютере (корпус телефона) диалог не показываем: ставить на компьютер незачем, а инструкцию читают */
let deferred=null;
window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); deferred=e; track('install_prompt'); });
window.addEventListener('appinstalled',()=>{ deferred=null; });
function installApp(event){
  if(!deferred || document.documentElement.classList.contains('framed')) return;   /* нет системного диалога — ссылка ведет на инструкцию */
  event.preventDefault(); track('installed');
  const p=deferred; deferred=null; p.prompt(); p.userChoice.catch(()=>{});
}

/* ══════════ Карты Таро и руны: каталог, результаты, история, открытки ══════════ */
/* Каталог: тексты и картинки карт и рун приходят одним запросом и дальше живут в памяти.
   Ответы сервера несут только коды и названия — по кодам экран находит полные тексты. */
/* Последний удачный каталог остается в браузере: без сети настроения, награды и вопросы берутся из него,
   а не из копий справочников в коде — источник у контента один, content.mjs. */
const catalogFrom = (c) => ({ cards: Object.fromEntries(c.cards.map(x => [x.slug, x])), runes: Object.fromEntries(c.runes.map(x => [x.slug, x])), layouts: c.layouts, habitIdeas: c.habitIdeas || [], askesisIdeas: c.askesisIdeas || [], lunarDays: c.lunarDays || [],
  news: c.news || [], quickMoods: c.quickMoods || [], moods: c.moods || [], moodFamilies: c.moodFamilies || {}, legacyMoods: c.legacyMoods || {},
  tools: c.tools || [], reminderTexts: c.reminderTexts || {} });
let CAT = null, catPromise = null;
try { const cached = localStorage.getItem('lun_catalog'); if (cached) CAT = catalogFrom(JSON.parse(cached)); } catch (e) {}
function loadCatalog(){
  if (CAT && CAT.fresh) return Promise.resolve(CAT);
  if (catPromise) return catPromise;
  catPromise = api('/catalog?v=' + encodeURIComponent(S.catalogV || 1)).then(c => {
    CAT = catalogFrom(c); CAT.fresh = true;
    try { localStorage.setItem('lun_catalog', JSON.stringify(c)); } catch (e) {}
    return CAT;
  }).catch(e => { catPromise = null; if (CAT) return CAT; throw e; });
  return catPromise;
}
const cardBy = (s) => (CAT && CAT.cards[s]) || null;
const runeBy = (s) => (CAT && CAT.runes[s]) || null;
const layoutOf = (kind, key) => (CAT && CAT.layouts[kind] && CAT.layouts[kind][key]) || null;
const keysLine = (k) => String(k || '').replace(/\.\s*$/, '').split(/\.\s+/).join(' · ');
const fmtDay = (d) => String(d || '').split('-').reverse().join('.');
/* «16 сентября, 21:05» — момент времени; месяц можно укоротить или добавить день недели */
const fmtWhen = (at, o) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...o });
const paras = (arr) => (arr || []).map(t => `<p>${esc(t)}</p>`).join('');
const glyphSvg = (path) => `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="${esc(path || 'M16 5v22')}" stroke="#e9c77e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
let moreSeq = 0;
function moreBlock(html, label){
  if (!html) return '';
  const id = 'more' + (++moreSeq);
  return `<div class="more" id="${id}"><button data-on="click:toggleMore-a0" data-a0="${id}" class="morebtn" type="button" aria-expanded="false" aria-controls="${id}-body"><span>${label || 'Читать полностью'}</span>${CHEV}</button><div class="morebody" id="${id}-body">${html}</div></div>`;
}
function toggleMore(id){ const el = $(id); if (!el) return; const open=el.classList.toggle('on');el.querySelector('.morebtn').setAttribute('aria-expanded',String(open));hap(); }
const CARD_SEC = { image: 'Образ', spread: 'В раскладе', state: 'Состояние человека', shadow: 'Теневая сторона', advice: 'Совет' };
const RUNE_SEC = { meaning: 'Значение', advice: 'Совет', state: 'Состояние человека', interact: 'Во взаимодействии' };
function sectionsHtml(obj, keys, titles){
  const s = (obj && obj.sections) || {};
  return keys.filter(k => s[k] && s[k].length).map(k => `<h3>${titles[k]}</h3>${paras(s[k])}`).join('');
}

/* Каждый показанный результат регистрируется: по номеру «Скачать» знает, из чего собирать открытку. */
const RES = {}; let resSeq = 0, pendingRes = [];
function regRes(p){ const id = 'res' + (++resSeq); RES[id] = p; pendingRes.push(id); return id; }
function preparePending(){ const ids = pendingRes; pendingRes = []; ids.forEach(preparePostcard); }
function actionsHtml(id, withShare){
  return `<div class="resrow utility-actions">${withShare ? `<button data-on="click:shareRes-a0" data-a0="${id}" class="text-action" type="button"><i class="ico share"></i>Поделиться</button>` : ''}<button data-on="click:savePostcard-a0" data-a0="${id}" class="text-action secondary" type="button">↓ Скачать на телефон</button></div>`;
}
const qLine = (q) => q ? `<p class="italic center mb-3">«${esc(q)}»</p>` : '';

/* ── карта дня: иллюстрация, ключи, образ, совет, вопрос себе; остальное — под «Читать полностью» ── */
function cardDayHtml(c, day, compact){
  const id = regRes({ type: 'card', card: c, day });
  const s = c.sections || {};
  return `<div class="center"><div class="title-gold">${esc(c.name)}</div>${c.keys ? `<div class="kw">${esc(keysLine(c.keys))}</div>` : ''}</div>
    ${(c.today || (s.advice && s.advice.length)) ? `<div class="card mt-3"><h3>Сегодня</h3>${c.today ? `<p class="today">${esc(c.today)}</p>` : paras((s.advice||[]).slice(0,1))}</div>` : ''}
    ${c.question ? `<section class="card-question"><h3>Вопрос себе</h3><p>${esc(c.question)}</p></section>` : ''}
    ${moreBlock((s.image && s.image.length ? `<h3>Образ карты</h3>${paras(s.image)}` : '') + sectionsHtml(c, ['spread', 'state', 'shadow'], CARD_SEC) + ((c.today || (s.advice||[]).length>1)?'<h3>Совет карты</h3>'+paras(c.today?s.advice:(s.advice||[]).slice(1)):'') , 'Прочитать подробнее')}
    ${actionsHtml(id, !compact)}`;
}
function paintCard(){
  const pub = S.day && S.day.card;
  const c = pub ? (cardBy(pub.slug) || pub) : null;
  $('c-face').innerHTML = c ? `<img src="${esc(c.image)}?v=1" alt="${esc(c.name)}">` : '';
  $('t-after').innerHTML = c ? cardDayHtml(c, S.day.date, false) : '';
  paintCardTile();
}
function paintCardTile(){ const e = $('t-cardsub'); if (e && S.day) e.textContent = S.day.card ? S.day.card.name : 'Одна карта на день: смысл и что сделать сегодня'; }
function showFlipped(){
  S.flipped = true;
  $('t-card').classList.add('flip'); $('t-card').classList.remove('glow');
  $('t-open').style.display = 'none'; paintCardTile();
}
function flipCard(){ if (!S.flipped) openCard(); }
$('t-open').onclick = openCard;
const preload = (src) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = src; setTimeout(res, 2500); });
/* Карта тянется на сервере случайно — один раз в день — и сразу попадает в историю. */
async function openCard(){
  if (S.flipped || S.opening) return;
  S.opening = true; $('t-open').disabled = true;
  try{
    const [r] = await Promise.all([api('/card', { method: 'POST' }), loadCatalog().catch(() => null)]);
    S.day.card = r.card;
    if (r.card && r.card.image) await preload(r.card.image + '?v=1');
    paintCard(); hap('ok');
    showFlipped();
    setTimeout(() => { $('t-after').style.display = 'block'; $('t-after').classList.add('rise'); preparePending(); cardNudge(); }, 500);
  }catch(e){ toast('Не получилось открыть карту — попробуйте еще раз'); $('t-open').disabled = false; }
  S.opening = false;
}

/* ── схема расклада: [колонка, строка] каждой позиции ── */
const CELLS = {
  three: [[1, 1], [2, 1], [3, 1]], fork: [[1, 1], [1, 2], [2, 2]],
  cross: [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]], elements: [[2, 1], [1, 2], [3, 2], [2, 3]],
  celtic: [[2, 2], [2, 2], [1, 2], [3, 2], [2, 1], [2, 3], [4, 4], [4, 3], [4, 2], [4, 1]],
};
function diagramHtml(kind, layout, items, rid){
  const cells = CELLS[layout] || items.map((_, i) => [i + 1, 1]);
  const cols = Math.max(...cells.map(c => c[0]));
  const inner = (it) => kind === 'tarot' ? `<img class="thumb" src="${esc(it.image)}?v=1" alt="">` : `<span class="glyph">${glyphSvg(it.path)}</span>`;
  return `<div class="lay" style="grid-template-columns:repeat(${cols},58px)">${items.map((it, i) => {
    const [c, r] = cells[i] || [i + 1, 1];
    const col = layout === 'fork' && i === 0 ? '1 / span 2' : c;
    return `<div class="c${layout === 'celtic' && i === 1 ? ' p2' : ''}" style="grid-column:${col};grid-row:${r}"><button data-on="click:scrollToPos-a0-a1" data-a0="${rid}" data-a1="${i}" type="button" aria-label="Позиция ${i + 1}">${inner(it)}<span class="num">${i + 1}</span></button></div>`;
  }).join('')}</div>`;
}
function scrollToPos(rid, i){ const el = $(rid + '-p' + i); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1400); }
const posHead = (i, P) => `<span class="pn">${i + 1}. ${esc(P.name)}${P.hint ? `<small>${esc(P.hint)}</small>` : ''}</span>`;

/* ── руны: одна руна и расклады ── */
function runesHtml(p){
  const L = layoutOf('rune', p.layout) || { title: 'Руны', pos: [] };
  const runes = p.runes.map(s => runeBy(s) || (p.live || []).find(x => x.slug === s) || { slug: s, name: s, path: '', sections: {} });
  const id = regRes({ type: p.layout === 'one' || runes.length === 1 ? 'rune' : 'runes', layout: p.layout, runes, q: p.q, day: p.day });
  if (runes.length === 1) {
    const r = runes[0];
    return `<div class="card rise center">${qLine(p.q)}
        ${r.image ? `<img class="stone" src="${esc(r.image)}?v=1" alt="">` : `<div class="glyph lg">${glyphSvg(r.path)}</div>`}
        <div class="title-gold">${esc(r.name)}</div>
        ${r.keyword ? `<div class="kw">${esc(r.keyword)}</div>` : ''}
        ${r.motto ? `<p class="mt-2 italic">${esc(r.motto)}</p>` : ''}
        <p class="mt-3 strong">${esc(r.answer || '')}</p>
        <div class="left">${moreBlock(sectionsHtml(r, ['meaning', 'advice', 'state', 'interact'], RUNE_SEC))}</div>
        ${actionsHtml(id)}</div>`;
  }
  return `<div class="card rise">${qLine(p.q)}<div class="center"><span class="eyebrow">${esc(L.title)}</span></div>
      ${diagramHtml('rune', p.layout, runes, id)}
      <div class="list">${runes.map((r, i) => { const P = L.pos[i] || { name: 'Позиция ' + (i + 1), hint: '' }; const s = r.sections || {};
        return `<div class="card pos" id="${id}-p${i}"><span class="glyph">${glyphSvg(r.path)}</span><div class="grow">${posHead(i, P)}
          <b>${esc(r.name)}${r.keyword ? ` <span class="sub">· ${esc(r.keyword)}</span>` : ''}</b>
          <p class="mt-2 t2">${esc(r.answer || '')}</p>
          ${moreBlock(sectionsHtml({ sections: { meaning: (s.meaning || []).slice(0, 1), advice: s.advice } }, ['meaning', 'advice'], RUNE_SEC), 'Подробнее')}
        </div></div>`; }).join('')}</div>
      ${actionsHtml(id)}</div>`;
}

/* ── Таро: расклады ── */
function spreadHtml(p){
  const L = layoutOf('tarot', p.layout) || { title: 'Расклад', pos: [] };
  const cards = p.cards.map(s => cardBy(s) || (p.live || []).find(x => x.slug === s) || { slug: s, name: s, keys: '', image: '', sections: {} });
  const id = regRes({ type: 'spread', layout: p.layout, cards, q: p.q, day: p.day });
  return `<div class="card rise">${qLine(p.q)}<div class="center"><span class="eyebrow">${esc(L.title)}</span></div>
      ${diagramHtml('tarot', p.layout, cards, id)}
      <div class="list">${cards.map((c, i) => { const P = L.pos[i] || { name: 'Позиция ' + (i + 1), hint: '' }; const sp = (c.sections && c.sections.spread) || [];
        return `<div class="card pos" id="${id}-p${i}">${c.image ? `<img class="thumb" src="${esc(c.image)}?v=1" alt="">` : ''}<div class="grow">${posHead(i, P)}
          <b>${esc(c.name)}</b>${c.keys ? `<div class="kw mt-1">${esc(keysLine(c.keys))}</div>` : ''}
          ${sp[0] ? `<p class="mt-2">${esc(sp[0])}</p>` : ''}
          ${moreBlock((sp.length > 1 ? paras(sp.slice(1)) : '') + sectionsHtml(c, ['advice'], CARD_SEC), 'Подробнее')}
        </div></div>`; }).join('')}</div>
      ${actionsHtml(id)}</div>`;
}

/* ── Да / Нет ── */
function yesnoHtml(p){
  const id = regRes({ type: 'yesno', title: p.title, body: p.body, q: p.q, day: p.day });
  return `<div class="card rise center">${qLine(p.q)}<div class="big">${esc(p.title)}</div><p class="mt-3">${esc(p.body)}</p>${actionsHtml(id)}</div>` +
    (p.memory ? `<div class="card rise memory" style="--i:1"><span class="eyebrow mb-2">Мы помним ваш прошлый вопрос</span><p>Раньше на похожий вопрос ответ был <b class="strong">«${esc(p.memory.title)}»</b>, сегодня — <b class="strong">«${esc(p.title)}»</b>. Оба верны, каждый для своего момента: изменились обстоятельства.</p></div>` : '');
}

/* ── свериться: способ и расклад ── */
const LABELS = { yesno: 'О чем спрашиваете', rune: 'О чем спрашиваете руны', spread: 'Ваш вопрос к картам' };
const MODE_TITLE = { yesno: 'Да / Нет', rune: 'Руны', spread: 'Таро' };
const LAYOUT_ORDER = { rune: ['one', 'three', 'cross', 'elements'], spread: ['three', 'fork', 'celtic'] };
function openAsk(m){ setMode(m); openWidget('ask', MODE_TITLE[m]); setTimeout(() => $('a-q').focus(), 350); }
function setMode(m){
  S.mode = m; S.layout = m === 'spread' ? 'three' : 'one';
  $('a-label').textContent = LABELS[m];
  $('a-result').style.display = 'none'; $('a-result').innerHTML = ''; $('a-msg').textContent = '';
  paintHint(); renderLayouts(); loadCatalog().then(renderLayouts).catch(() => {});
  checkQ();
}
function paintHint(){ $('a-hint').textContent = S.mode === 'spread' && S.limits ? `Разбор расклада: осталось ${S.limits.spreadsLeft} из ${S.limits.spreadsTotal} на сегодня.` : 'Бесплатно и без ограничений.'; }
function renderLayouts(){
  const box = $('a-layouts'), kind = S.mode === 'rune' ? 'rune' : S.mode === 'spread' ? 'tarot' : '';
  if (!kind || !CAT) { box.style.display = 'none'; return; }
  const L = CAT.layouts[kind][S.layout];
  box.style.display = '';
  box.innerHTML = `<div class="chips flow">${LAYOUT_ORDER[S.mode].map(k => `<button data-on="click:setLayout-a0" data-a0="${k}" type="button" class="chip${S.layout === k ? ' on' : ''}">${esc(CAT.layouts[kind][k].title)}</button>`).join('')}</div>
    <p class="laydesc"><b>${esc(L.sub)}</b> — ${esc(L.desc)}</p>`;
}
function setLayout(k){ S.layout = k; hap(); renderLayouts(); checkQ(); }
$('a-q').addEventListener('input', checkQ);
function checkQ(){
  const v = $('a-q').value.trim(), ok = v.length >= 10 && /\s/.test(v);
  $('a-go').disabled = !ok;
  $('a-go').textContent = ok ? 'Получить ответ' : (v.length ? 'Допишите вопрос' : 'Напишите вопрос');
}
async function runAsk(mode, q, out, hint, layout){
  await loadCatalog().catch(() => {});
  if (mode === 'spread') {
    const L = layout || 'three';
    const r = await api('/spread', { method: 'POST', body: JSON.stringify({ question: q, layout: L }) });
    if (S.limits) S.limits.spreadsLeft = r.left;
    out.innerHTML = spreadHtml({ q, layout: r.layout, cards: r.cards.map(c => c.slug), live: r.cards, day: S.day.date });
    if (hint) hint.textContent = `Разбор расклада: осталось ${r.left} из ${S.limits ? S.limits.spreadsTotal : 2} на сегодня.`;
  } else {
    const L = mode === 'rune' ? (layout || 'one') : '';
    const r = await api('/ask', { method: 'POST', body: JSON.stringify({ question: q, kind: mode, layout: L }) });
    out.innerHTML = r.kind === 'rune' ? runesHtml({ q, layout: r.layout, runes: r.runes.map(x => x.slug), live: r.runes, day: S.day.date })
      : yesnoHtml({ q, title: r.title, body: r.body, day: S.day.date, memory: r.memory });
  }
  out.style.display = 'block'; hap('done'); preparePending();
}

/* ── история: записи раскрываются в тот же вид, что и свежий результат ── */
const KIND_LABEL = { card: 'Карта дня', dayrune: 'Руна дня', yesno: 'Да / Нет', rune: 'Руна', runes: 'Руны', spread: 'Таро' };
function kindLabel(i){
  const L = i.data && i.data.layout ? layoutOf(i.kind === 'spread' ? 'tarot' : 'rune', i.data.layout) : null;
  return L && i.kind !== 'rune' ? `${KIND_LABEL[i.kind]} · ${L.title}` : (KIND_LABEL[i.kind] || i.kind);
}
const entriesView={kind:'questions',next:null,request:0};
function filterEntries(kind){entriesView.kind=kind;loadEntries();}
async function loadEntries(more=false){
  const request=++entriesView.request,box=$('m-entries');
  document.querySelectorAll('.entries-tabs button').forEach((button,index)=>button.setAttribute('aria-selected',['questions','card',''][index]===entriesView.kind));
  $('entries-more').hidden=true;
  if(!more)box.innerHTML='<p class="hint" role="status">Загружаем историю…</p>';
  try{
    const query=new URLSearchParams({kind:entriesView.kind});
    if(more&&entriesView.next)query.set('before',entriesView.next);
    const r=await api('/entries?'+query);await loadCatalog().catch(()=>{});
    if(request!==entriesView.request)return;
    S.entries=more?[...(S.entries||[]),...r.items]:r.items;entriesView.next=r.next??null;
    box.innerHTML=S.entries.map((i,n)=>`<div class="item hist" id="he-${n}"><button data-on="click:toggleEntry-a0" data-a0="${n}" class="histhead" type="button" aria-expanded="false" aria-controls="hb-${n}"><span><b>${esc(i.question||i.title)}</b><small>${fmtDay(i.day)} · ${esc(kindLabel(i))}${i.question&&i.title.length<=48?' · '+esc(i.title):''}</small></span>${CHEV}</button><div class="histbody" id="hb-${n}"></div></div>`).join('')
      || `<p class="hint">${entriesView.kind==='questions'?'Здесь появятся ваши вопросы и ответы. Карты дня доступны в соседней вкладке.':entriesView.kind==='card'?'Вы еще не открывали карту дня.':'Записей пока нет.'}</p>`;
    $('entries-more').hidden=entriesView.next===null;
  }catch{
    if(request!==entriesView.request)return;
    box.innerHTML='<p class="msg err">История не загрузилась. <button data-on="click:loadEntries" type="button" class="text-action">Повторить</button></p>';
  }
}
function toggleEntry(n){
  const it = $('he-' + n), body = $('hb-' + n); if (!it) return;
  const open = !it.classList.contains('on'); it.classList.toggle('on', open); it.querySelector('.histhead').setAttribute('aria-expanded',open); hap();
  if (open && !body.innerHTML) { body.innerHTML = entryHtml(S.entries[n]); preparePending(); }
}
function entryHtml(i){
  const d = i.data || {};
  if (i.kind === 'card' && d.card) return cardDayHtml(cardBy(d.card) || { name: i.title, keys: i.body, sections: {} }, i.day, true);
  if (i.kind === 'yesno') return yesnoHtml({ q: i.question, title: i.title, body: i.body, day: i.day });
  if ((i.kind === 'rune' || i.kind === 'runes' || i.kind === 'dayrune') && d.runes) return runesHtml({ q: i.question, layout: d.layout || 'one', runes: d.runes, day: i.day });
  if (i.kind === 'spread' && d.cards) return spreadHtml({ q: i.question, layout: d.layout || 'three', cards: d.cards, day: i.day });
  return `<p>${esc(i.body || i.title)}</p>`;   /* записи, сделанные до появления кодов */
}

/* ══════════ Открытка 9:16: чистая картинка без интерфейса — на экран блокировки или подруге ══════════ */
const PC_W = 1080, PC_H = 1920;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const fontsReady = () => Promise.all(['300 40px Comfortaa', '600 56px Onest', '400 36px Onest', 'italic 400 28px Onest'].map(f => document.fonts.load(f))).catch(() => {});
const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
function wrapLines(ctx, text, maxW){
  const out = [];
  for (const par of String(text || '').split('\n')) {
    let line = '';
    for (const w of par.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
    out.push(line);
  }
  return out;
}
function drawText(ctx, text, x, y, o){   /* возвращает y после последней строки */
  const { size = 36, weight = 400, family = 'Onest', color = '#f5f2ea', maxW = 880, lh = 1.4, italic = false, spacing = 0, align = 'center' } = o || {};
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  try { ctx.letterSpacing = spacing + 'px'; } catch (e) {}
  for (const l of wrapLines(ctx, text, maxW)) { ctx.fillText(l, x, y); y += size * lh; }
  try { ctx.letterSpacing = '0px'; } catch (e) {}
  return y;
}
function rrect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function pcBase(ctx){
  const g = ctx.createLinearGradient(0, 0, 0, PC_H); g.addColorStop(0, '#171330'); g.addColorStop(0.55, '#0e0c1c'); g.addColorStop(1, '#0b0a14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, PC_W, PC_H);
  const o = ctx.createRadialGradient(540, 240, 20, 540, 240, 720); o.addColorStop(0, 'rgba(109,91,208,.36)'); o.addColorStop(1, 'rgba(109,91,208,0)');
  ctx.fillStyle = o; ctx.fillRect(0, 0, PC_W, PC_H);
  let x = 20260914; const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  for (let i = 0; i < 150; i++) { const sx = rnd() * PC_W, sy = rnd() * PC_H, r = 0.6 + rnd() * 1.7; ctx.fillStyle = `rgba(245,242,234,${(0.12 + rnd() * 0.5).toFixed(2)})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); }
}
function pcFooter(ctx, day){   /* дата и тихая подпись — источник читается, но не кричит */
  if (day) drawText(ctx, new Date(day + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }), 540, 1742, { size: 28, color: '#8f87ad' });
  drawText(ctx, 'Лунарио', 540, 1830, { size: 40, weight: 300, family: 'Comfortaa', color: '#d9b868', spacing: 4 });
}
function pcGlyph(ctx, path, cx, cy, size, lw){   /* знак руны одной линией — те же координаты, что и на экране */
  const k = size / 32;
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(k, k);
  ctx.strokeStyle = '#e9c77e'; ctx.lineWidth = lw / k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(233,199,126,.55)'; ctx.shadowBlur = 26 / k;
  ctx.stroke(new Path2D(path || 'M16 5v22')); ctx.restore();
}
async function pcImage(ctx, src, x, y, w, h, r){
  try {
    const im = await loadImg(src);
    ctx.save(); ctx.shadowColor = 'rgba(217,184,104,.35)'; ctx.shadowBlur = 60; rrect(ctx, x, y, w, h, r); ctx.fillStyle = '#1d1738'; ctx.fill(); ctx.restore();
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip(); ctx.drawImage(im, x, y, w, h); ctx.restore();
    ctx.save(); rrect(ctx, x + 1, y + 1, w - 2, h - 2, r); ctx.strokeStyle = 'rgba(217,184,104,.5)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  } catch (e) { rrect(ctx, x, y, w, h, r); ctx.fillStyle = '#1d1738'; ctx.fill(); }
}
/* иллюстрация во всю ширину, верх и низ растворяются в фоне — как родная заставка, а не картинка в рамке */
async function pcCover(ctx, src, top){
  try {
    const im = await loadImg(src);
    const tmp = document.createElement('canvas'); tmp.width = PC_W; tmp.height = PC_W; const tc = tmp.getContext('2d');
    tc.drawImage(im, 0, 0, PC_W, PC_W);
    const g = tc.createLinearGradient(0, 0, 0, PC_W); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.16, 'rgba(0,0,0,1)'); g.addColorStop(0.86, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = g; tc.fillRect(0, 0, PC_W, PC_W);
    ctx.drawImage(tmp, 0, top);
    return true;
  } catch (e) { return false; }
}
function pcMoon(ctx, verdict, cx, cy, R){   /* один штрих: полная луна — «да», серп — «нет», половина — «позже» */
  ctx.save(); ctx.strokeStyle = '#e9c77e'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(233,199,126,.5)'; ctx.shadowBlur = 30;
  ctx.beginPath();
  if (verdict === 'Нет') { ctx.arc(cx, cy, R, Math.PI * 0.55, Math.PI * 1.45); ctx.arc(cx + R * 0.62, cy, R * 0.98, Math.PI * 1.31, Math.PI * 0.69, true); ctx.closePath(); }
  else if (verdict === 'Позже') { ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); }
  else { ctx.arc(cx, cy, R, 0, Math.PI * 2); }
  ctx.stroke(); ctx.restore();
}
async function drawPostcard(p){
  const cv = document.createElement('canvas'); cv.width = PC_W; cv.height = PC_H; const ctx = cv.getContext('2d');
  await fontsReady(); pcBase(ctx);
  if (p.type === 'card') {
    const c = p.card;
    await pcImage(ctx, c.image + '?v=1', 180, 130, 720, 1350, 30);
    const y = drawText(ctx, keysLine(c.keys) || c.name, 540, 1585, { size: 38, color: '#ded8ee', maxW: 900 });
    if (c.question && y < 1660) drawText(ctx, c.question, 540, y + 10, { size: 26, italic: true, color: '#b9b2cf', maxW: 900, lh: 1.3 });
  } else if (p.type === 'rune') {
    const r = p.runes[0];
    pcGlyph(ctx, r.path, 540, 520, 560, 40);
    let y = drawText(ctx, r.name, 540, 960, { size: 66, weight: 600, color: '#e9c77e' });
    if (r.keyword) y = drawText(ctx, r.keyword.toUpperCase(), 540, y + 4, { size: 26, color: '#b9b2cf', spacing: 6 });
    y = drawText(ctx, r.answer || r.motto || '', 540, y + 64, { size: 38, color: '#f5f2ea', maxW: 860, lh: 1.42 });
    if (p.q) drawText(ctx, '«' + p.q + '»', 540, Math.max(y + 54, 1440), { size: 28, italic: true, color: '#8f87ad', maxW: 860, lh: 1.35 });
  } else if (p.type === 'yesno') {
    pcMoon(ctx, p.title, 540, 470, 150);
    let y = drawText(ctx, p.title, 540, 810, { size: 120, weight: 600, color: '#e9c77e' });
    y = drawText(ctx, p.body || '', 540, y + 50, { size: 38, color: '#f5f2ea', maxW: 860, lh: 1.42 });
    if (p.q) drawText(ctx, '«' + p.q + '»', 540, Math.max(y + 54, 1440), { size: 28, italic: true, color: '#8f87ad', maxW: 860, lh: 1.35 });
  } else if (p.type === 'year') {
    const y = p.year, i = y.info;
    await pcCover(ctx, i.image + '?v=1', 70);
    /* «Год 3 · Юпитер · Проявление сути»: год и планета — строкой сверху, суть года — крупно, ниже — послание */
    let yy = drawText(ctx, `ГОД ${y.n} · ${(i.planet || '').toUpperCase()}`, 540, 1230, { size: 28, weight: 700, color: '#d9b868', spacing: 6 });
    yy = drawText(ctx, i.energy || '', 540, yy + 26, { size: (i.energy || '').length > 32 ? 44 : 58, weight: 600, color: '#f5f2ea', maxW: 940, lh: 1.15 });
    if (i.message) {   /* послание года — фраза, которую не стыдно поставить на экран блокировки */
      ctx.fillStyle = 'rgba(217,184,104,.6)'; ctx.fillRect(512, yy + 18, 56, 2);
      yy = drawText(ctx, i.message, 540, yy + 74, { size: 36, color: '#ded8ee', maxW: 900, lh: 1.35, italic: true });
    } else if (i.caption) yy = drawText(ctx, i.caption, 540, yy + 34, { size: 30, italic: true, color: '#ded8ee', maxW: 880, lh: 1.35 });
    /* дат на открытке нет намеренно: это послание на экран блокировки, а не справка; период года виден на экране */
  } else if (p.type === 'runes' || p.type === 'spread') {
    const kind = p.type === 'spread' ? 'tarot' : 'rune';
    const L = layoutOf(kind, p.layout) || { title: '', pos: [] };
    drawText(ctx, L.title.toUpperCase(), 540, 150, { size: 30, color: '#d9b868', spacing: 6 });
    if (p.q) drawText(ctx, '«' + p.q + '»', 540, 205, { size: 26, italic: true, color: '#8f87ad', maxW: 900, lh: 1.3 });
    const items = kind === 'tarot' ? p.cards : p.runes;
    const cells = CELLS[p.layout] || items.map((_, i) => [i + 1, 1]);
    const cols = Math.max(...cells.map(c => c[0])), rows = Math.max(...cells.map(c => c[1]));
    const cw = kind === 'tarot' ? (cols >= 4 ? 130 : 280) : 220, ch = kind === 'tarot' ? Math.round(cw * 15 / 8) : 220, gap = kind === 'tarot' ? 26 : 56, lab = cols >= 4 ? 78 : 66;
    const totalW = cols * cw + (cols - 1) * gap, totalH = rows * (ch + lab) + (rows - 1) * gap;
    const x0 = (PC_W - totalW) / 2, y0 = 300 + Math.max(0, (1400 - totalH) / 2);
    const small = cols >= 4;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], [c, r] = cells[i] || [i + 1, 1];
      let x = x0 + (c - 1) * (cw + gap); const y = y0 + (r - 1) * (ch + lab + gap);
      if (p.layout === 'fork' && i === 0) x = x0 + (totalW - cw) / 2;
      const across = p.layout === 'celtic' && i === 1;
      if (kind === 'tarot') {
        if (across) { ctx.save(); ctx.translate(x + cw / 2, y + ch / 2); ctx.rotate(Math.PI / 2); ctx.globalAlpha = .96; await pcImage(ctx, it.image + '?v=1', -cw / 2, -ch / 2, cw, ch, 12); ctx.restore(); }
        else await pcImage(ctx, it.image + '?v=1', x, y, cw, ch, 14);
      } else {
        ctx.save(); rrect(ctx, x, y, cw, ch, 36); ctx.fillStyle = 'rgba(245,242,234,.06)'; ctx.fill(); ctx.strokeStyle = 'rgba(217,184,104,.4)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        pcGlyph(ctx, it.path, x + cw / 2, y + ch / 2, 150, 12);
      }
      const P = L.pos[i] || {};
      if (across) {   /* карта поперек первой: подпись — в пустом углу схемы */
        const lx = x0 + (3 * cw + 2 * gap) / 2, ly = y0 + 3 * (ch + lab + gap) + ch / 2 - 10;
        const yy = drawText(ctx, '2 · ' + (P.name || '') + ' · поперек первой', lx, ly, { size: 17, color: '#b9b2cf', maxW: 3 * cw + 2 * gap, lh: 1.15 });
        drawText(ctx, it.name, lx, yy + 2, { size: 19, weight: 600, color: '#e9c77e', maxW: 3 * cw + 2 * gap, lh: 1.1 });
        continue;
      }
      const yy = drawText(ctx, (i + 1) + ' · ' + (P.name || ''), x + cw / 2, y + ch + 28, { size: small ? 17 : 21, color: '#b9b2cf', maxW: cw + gap - 4, lh: 1.15 });
      drawText(ctx, it.name, x + cw / 2, yy + 2, { size: small ? 18 : 23, weight: 600, color: '#e9c77e', maxW: cw + gap - 4, lh: 1.1 });
    }
  }
  if (!['card', 'rune', 'yesno', 'runes', 'spread'].includes(p.type)) await drawPostcardExtra(ctx, p);
  pcFooter(ctx, p.day);
  return cv;
}
const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
const blobToDataUrl = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
/* Открытка собирается заранее — чтобы по нажатию системное меню открылось сразу, без пауз. */
function preparePostcard(id){
  const p = RES[id]; if (!p || p.ready) return;
  p.ready = drawPostcard(p).then(toBlob).then(b => (p.blob = b)).catch(() => null);
}
async function savePostcard(id){
  const p = RES[id]; if (!p) return;
  track('card_download', p.type);
  if (!p.blob) { toast('Собираем открытку…'); preparePostcard(id); await p.ready; }
  if (!p.blob) { toast('Не получилось собрать открытку'); return; }
  const name = ['lunario', p.type, String(p.day || p.stamp || '').replace(/-/g, '')].filter(Boolean).join('-') + '.png';
  const file = new File([p.blob], name, { type: 'image/png' });
  /* оболочка App Store: системное меню через мост — «Сохранить изображение», мессенджеры, AirDrop */
  if (IOS_SHELL) { const du = await blobToDataUrl(p.blob); if (nativePost({ type: 'shareImage', png: du.split(',')[1], name })) return; }
  /* телефон в браузере: меню «Сохранить изображение / Отправить», если система умеет делиться файлами */
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Лунарио' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  /* Safari без меню: показываем картинку — ее можно зажать и сохранить в Фото */
  if (IS_IOS) { showPostcard(await blobToDataUrl(p.blob)); return; }
  const url = URL.createObjectURL(p.blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); toast('Открытка сохранена в загрузки');
}
function showPostcard(src){ $('pc-img').src = src; $('pc').classList.add('on'); }
function hidePostcard(){ $('pc').classList.remove('on'); $('pc-img').removeAttribute('src'); $('pc-hint').innerHTML = 'Зажмите картинку и выберите «Сохранить в Фото»'; }

/* ══════════ Напоминания по функциям: включить, выбрать время и регулярность, прислать пробное ══════════
   Настройки живут на сервере (/api/reminders). В браузере напоминание приходит веб-пушем:
   сервер будит service worker пустым сигналом, тексты тот забирает сам. В оболочке App Store
   веб-пуша нет — те же настройки уходят телефону, и напоминает он (NativeBridge.swift). */
const REM_ORDER = ['morning', 'evening', 'week'];
const FREQ_LABEL = { daily: 'Каждый день', weekdays: 'По будням', weekly: 'Раз в неделю', events: 'Когда что-то происходит' };
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_ON = ['по понедельникам', 'по вторникам', 'по средам', 'по четвергам', 'по пятницам', 'по субботам', 'по воскресеньям'];
const wdIdx = (day) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
const IOS_BRIDGE = typeof window.__LUN_IOS__ === 'number' ? window.__LUN_IOS__ : (IOS_SHELL ? 1 : 0);
const PUSH_OK = !IOS_SHELL && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
const NATIVE_TEXT_FALLBACK = { morning: ['Доброе утро', 'На что вы хотите обращать внимание сегодня?'], evening: ['Запомнить этот день', 'Что хочется оставить от этого дня?'], week: ['Моя неделя: про что она', 'Ваша неделя в Лунарио готова'] };
let remPromise = null, remEditing = {}, remBusy = {}, pushRegistration = null;
const withTimeout = (promise, ms = 12000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
function ensurePushWorker(){
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('unsupported'));
  if (!pushRegistration) pushRegistration = withTimeout(navigator.serviceWorker.register('/app/sw.js', {scope:'/app/'}))
    .then(() => withTimeout(navigator.serviceWorker.ready)).catch(e => { pushRegistration = null; throw e; });
  return pushRegistration;
}
async function syncPushDevice(){
  S.pushOn = false; S.pushEndpoint = '';
  if(IOS_BRIDGE>=4){ const r=await nativeRequest({type:'notificationStatus'}); S.nativePermission=r.ok?'granted':r.reason; return; }
  if (!PUSH_OK || Notification.permission !== 'granted') return;
  try {
    const reg = await withTimeout(navigator.serviceWorker.getRegistration('/app/'));
    /* Разрешение уже дано, а ячейки нет (переустановили на экран «Домой», браузер ее сбросил) — заводим новую без вопросов:
       спрашивать заново нечего, а без ячейки напоминания молча не приходят. */
    const sub = reg && (await withTimeout(reg.pushManager.getSubscription())
      || (S.pushKey && await withTimeout(reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:toBytes(S.pushKey) }))));
    if (sub) {
      // Attach this existing device subscription to the current signed-in account.
      await api('/push', {method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
      S.pushEndpoint = sub.endpoint; S.pushOn = true;
    }
  } catch(e) { /* the explicit enable button lets the user reconnect */ }
}
const invitationKey = () => 'lun_push_invite_' + S.user.id;
/* ── Три напоминания после анкеты: первое, что человек настраивает; то же — в Аккаунт → Уведомления ── */
/* Мастер после анкеты (решение владелицы 18.09): шаг 1 — что показывать каждое утро (та же настройка, что чипы на «Сегодня»),
   шаг 2 — когда напоминать и «Включить напоминания» — нажатие, на которое телефон спрашивает разрешение. */
function finishOnboarding(){ startApp(); rhythmStep(1); go('rhythm'); track('rhythm_view'); }
function rhythmStep(n){
  const v=$('v-rhythm'); if(!v)return; v.dataset.step=String(n);
  $('rh-step-1').hidden=n!==1; $('rh-step-2').hidden=n!==2;
  if(n===1){ const chosen=new Set(Array.isArray(XP.prefs?.morning)?morningChosen():['card','lunar','tone']); v.querySelectorAll('[data-morning]').forEach(i=>{ i.checked=chosen.has(i.dataset.morning); }); }   /* еще не выбирали — карта, Луна и вопрос дня */
  if(n===2){ const note=$('rh-device-note'); if(note){ note.textContent=rhythmDeviceNote(); if(IS_IOS&&!PUSH_OK&&!IOS_SHELL) note.append(' ', Object.assign(document.createElement('a'), { href: '/app/install', className: 't-gold', textContent: 'Как добавить →' })); } }
  scrollToTop(0);
}
/* На iPhone в Safari пуши не приходят — только с экрана «Домой»; человеку лучше узнать это здесь, а не через три дня тишины */
function rhythmDeviceNote(){
  if(IOS_SHELL) return 'Уведомления придут на этот iPhone. Время можно поменять потом в Аккаунте';
  if(IS_IOS && !PUSH_OK) return 'На iPhone уведомления приходят только с экрана «Домой»: Поделиться → «На экран Домой». Расписание сохраним сейчас, подключить устройство можно оттуда';
  if(!PUSH_OK) return 'Этот браузер не показывает уведомления — расписание сохраним, а подключить можно с телефона';
  return 'Уведомления придут на это устройство. Время можно поменять потом в Аккаунте';
}
async function rhythmNext(){
  const btn=$('rh-next'); if(btn.disabled)return; btn.disabled=true;
  const morning=[...document.querySelectorAll('#rh-morning-list [data-morning]')].filter(i=>i.checked).map(i=>i.dataset.morning);
  try{ await savePreferences({...XP.prefs, morning}); paintMorning(); track('rhythm_morning', morning.join('|')||'none'); }
  catch(e){ toast('Не удалось сохранить выбор — его можно поменять на «Сегодня»'); }
  finally{ btn.disabled=false; rhythmStep(2); }
}
async function rhythmEnable(){
  if(rhythmEnable.busy)return;rhythmEnable.busy=true;const btn=$('rh-go');btn.disabled=true;btn.textContent='Включаем…';
  const chosen=REM_ORDER.filter(f=>$('rh-'+f).checked);
  try{
    await loadReminders(true);
    let device=true;
    if(chosen.length){ try{ device=await connectPushDevice(); }catch{ device=false; } }   /* разрешение спрашивается прямо на этом нажатии */
    for(const f of chosen)await remSave(f,{enabled:true,time:$('rh-time-'+f).value||S.rem[f].time,...(f==='week'?{freq:'weekly',weekday:7}:{})});
    track('rhythm_enable',chosen.join('|'));
    if(chosen.length&&device)toast('Напоминания включены');
  }catch(e){toast('Не удалось сохранить напоминания — их можно включить в Аккаунте');}
  finally{rhythmEnable.busy=false;btn.disabled=false;btn.textContent='Включить напоминания';go('home');}
}
function rhythmSkip(){track('rhythm_enable','none');go('home');}

function loadReminders(force){
  if (S.rem && !force) return Promise.resolve(S.rem);
  if (remPromise && !force) return remPromise;
  remPromise = api('/reminders').then(async r => { S.rem = Object.fromEntries(r.items.map(i => [i.feature, i])); S.pushKey = r.push.key; S.pushDevices = r.push.devices || []; await syncPushDevice(); return S.rem; }).catch(e => { remPromise = null; throw e; });
  return remPromise;
}
const remBox = (f, full=false) => `<div class="rem" data-rem="${f}" data-full="${full}"></div>`;
/* Строка уведомлений под заголовком виджета: настройки подгружаются, если еще не были */
const remRefresh = (f) => loadReminders().then(() => paintRem(f)).catch(() => {});
const remText = (r) => r.freq === 'events' ? 'когда что-то происходит, в ' + r.time : r.time + ' · ' + (r.freq === 'weekly' ? WD_ON[r.weekday - 1] : FREQ_LABEL[r.freq].toLowerCase());
function remDeviceReady(){
  return IOS_SHELL ? IOS_BRIDGE>=4 && S.nativePermission==='granted' : PUSH_OK && Notification.permission==='granted' && S.pushOn;
}
function remStatus(f, r){
  if(!r.enabled)return 'Выключены для этой функции';
  if(!remDeviceReady())return 'Расписание сохранено. Доставка на это устройство не подключена';
  if(IOS_SHELL)return S.nativeStates?.[f]===false?'На этом телефоне напоминание не включено':'Напоминание включено на телефоне · '+remText(r);
  return r.nextAt ? 'Следующее напоминание: ' + fmtWhen(r.nextAt, { weekday: 'short' }) : 'Уведомления включены';
}
function paintDeviceStatus(){
  const box=$('rem-device-status');if(!box)return;
  box.textContent=IOS_SHELL?(IOS_BRIDGE<4?'Обновите приложение, чтобы проверить разрешение на уведомления':S.nativePermission==='granted'?'Уведомления разрешены на этом iPhone':S.nativePermission==='denied'?'Уведомления выключены в настройках iPhone → Лунарио → Уведомления':'При первом включении iPhone спросит разрешение')
    :!PUSH_OK?(IS_IOS?'На iPhone добавьте Лунарио на экран «Домой», откройте оттуда и включите уведомления.':'Этот браузер не поддерживает пуш-уведомления')
    :Notification.permission==='denied'?'Уведомления заблокированы. Разрешите их в настройках сайта в браузере'
    :S.pushOn?'Это устройство подключено'+deviceTrace():'При первом включении браузер спросит разрешение. Если расписание уже включено, подключите это устройство';
  if(!IOS_SHELL&&!PUSH_OK&&IS_IOS) box.append(' ', Object.assign(document.createElement('a'), { href: '/app/install', className: 't-gold', textContent: 'Как добавить →' }));   /* инструкция по шагам — на своей странице */
}
/* Что сервер знает про эту ячейку: когда последний раз отправлял сигнал и когда устройство за текстами приходило.
   Если сигнал был, а отклика нет — уведомления глушит само устройство (режим «Не беспокоить», запрет для сайта). */
function deviceTrace(){
  const d=(S.pushDevices||[]).find(x=>x.endpoint===S.pushEndpoint); if(!d||!d.last_sent) return '';
  const sent=fmtWhen(d.last_sent,{weekday:'short'}), wake=d.last_wake&&d.last_wake>=d.last_sent?fmtWhen(d.last_wake,{weekday:'short'}):'';
  return ` · последний сигнал ${sent}` + (wake ? `, устройство откликнулось ${wake}` : ' — устройство не откликнулось. Проверьте, не включен ли режим «Не беспокоить» и разрешены ли уведомления для Лунарио');
}
function paintRem(f){
  const r=S.rem && S.rem[f];if(!r)return;
  const edit=!!remEditing[f],busy=!!remBusy[f];
  const reconnect=r.enabled && (IOS_SHELL?S.nativePermission!=='granted'||S.nativeStates?.[f]===false:PUSH_OK&&!S.pushOn);
  document.querySelectorAll(`[data-rem="${f}"]`).forEach((box,i)=>{
    const full=box.dataset.full==='true',panel=`rem-settings-${f}-${i}`;
    const toggle=`<div class="rem-head"><button data-on="click:remToggle-a0" data-a0="${f}" type="button" class="sw${r.enabled?' on':''}" role="switch" aria-checked="${r.enabled}" aria-label="Уведомления: ${esc(r.title)}" ${busy?'disabled':''}><i></i></button><div class="rem-lbl"><b>Получать уведомления</b><small>${esc(r.enabled?remText(r):r.hint)}</small></div></div>`;
    const state=r.enabled?remText(r):'выключены';
    const actions=`<div class="rem-actions">${reconnect?`<button data-on="click:remConnect-a0" data-a0="${f}" type="button" class="text-action" ${busy?'disabled':''}>Подключить это устройство</button>`:''}${r.enabled&&(PUSH_OK||IOS_BRIDGE>=4)?`<button data-on="click:remTest-a0" data-a0="${f}" type="button" class="text-action" ${busy?'disabled':''}>Отправить пробное</button>`:''}</div>`;
    box.innerHTML=`${full?toggle:''}<button data-on="click:remEdit-a0" data-a0="${f}" type="button" class="rem-summary text-action" aria-label="${full?'Время и регулярность':esc('Уведомления · '+state+'. Время и регулярность')}" aria-expanded="${edit}" aria-controls="${panel}">${full?'Время и регулярность':`<i class="ico bell"></i><span>Уведомления · ${esc(state)}</span>`}<span aria-hidden="true">${edit?'−':'⌄'}</span></button>
      ${full?actions:''}<div id="${panel}" class="rem-body" ${edit?'':'hidden'}>
        ${full?'':toggle+`<p class="rem-status" role="status">${esc(remStatus(f,r))}</p>`+(!remDeviceReady()?`<button data-on="click:openWidget-remind" type="button" class="text-action secondary">Разрешения уведомлений →</button>`:'')+actions}
        <div class="rem-row"><label for="${panel}-time">Время</label><input data-on="change:remSave-a0-time-value" data-a0="${f}" id="${panel}-time" aria-label="Время уведомления" type="time" value="${r.time}"></div>
        <div class="chips flow mt-3" aria-label="Регулярность">${(f === 'week' ? ['weekly'] : ['daily','weekdays','weekly']).map(k => `<button data-on="click:remSave-a0-freq-a1" data-a0="${f}" data-a1="${k}" type="button" class="chip${r.freq === k ? ' on' : ''}" aria-pressed="${r.freq===k}">${FREQ_LABEL[k]}</button>`).join('')}</div>
        ${r.freq === 'weekly' ? `<div class="chips flow mt-2" aria-label="День недели">${WD_SHORT.map((w,i) => `<button data-on="click:remSave-a0-weekday-a1" data-a0="${f}" data-a1="${i+1}" type="button" class="chip${r.weekday === i+1 ? ' on' : ''}" aria-pressed="${r.weekday===i+1}">${w}</button>`).join('')}</div>` : ''}
        <p class="hint mt-3">Часовой пояс: ${esc(TZ || 'Europe/Moscow')}. Изменения сохраняются автоматически</p>
        ${f==='evening' ? '<p class="hint mt-2">Если день уже записан, вечером не напоминаем</p>' : f==='morning' ? '<p class="hint mt-2">В утреннем уведомлении — настрой дня и то, что вы выбрали на «Сегодня»</p>' : ''}

      </div>`;
  });
  paintDeviceStatus();
}
function remEdit(f){ const full=document.activeElement.closest('[data-rem]')?.dataset.full;remEditing[f]=!remEditing[f];hap();paintRem(f);document.querySelector(`[data-rem="${f}"][data-full="${full}"] .rem-summary`)?.focus({preventScroll:true}); }
async function connectPushDevice(){
  if (IOS_SHELL) {
    if (IOS_BRIDGE < 4) { toast('Обновите приложение, чтобы проверить разрешение на уведомления'); return false; }
    const r = await nativeRequest({type:'notificationPermission'});
    S.nativePermission = r.ok ? 'granted' : 'denied';
    if (!r.ok) toast('Разрешите уведомления в настройках iPhone → Лунарио');
    return r.ok;
  }
  if (!PUSH_OK) { toast(IS_IOS ? 'Добавьте Лунарио на экран «Домой» и откройте оттуда' : 'Этот браузер не поддерживает уведомления'); return false; }
  return pushSubscribe();
}
async function remConnect(f){
  if (remBusy[f]) return;
  remBusy[f]=true; paintRem(f);
  try { if (await connectPushDevice()) { if(IOS_SHELL) await nativeSchedule(f); toast('Это устройство подключено'); } }
  catch(e) { toast('Не удалось подключить уведомления. Попробуйте еще раз'); }
  finally { remBusy[f]=false; REM_ORDER.forEach(paintRem); }
}
async function remToggle(f){
  const r = S.rem && S.rem[f]; if (!r || remBusy[f]) return; hap();
  remBusy[f]=true; paintRem(f);
  try {
    /* Разрешение спрашивается прямо в этом нажатии. Но расписание — про аккаунт, а не про это устройство: оно сохраняется
       в любом случае (раньше отказ браузера молча отменял включение — «уведомления не настраиваются»). */
    let device = true;
    if (!r.enabled) { try { device = await connectPushDevice(); } catch { device = false; } }
    if (await remSave(f,{enabled:!r.enabled})) {
      if (!S.rem[f].enabled) toast('Уведомления выключены');
      else if (device) toast('Напомним ' + remText(S.rem[f]));   /* иначе connectPushDevice уже объяснил, чего не хватает этому устройству */
    }
  } catch(e) { toast('Не удалось включить уведомления. Попробуйте еще раз'); }
  finally { remBusy[f]=false; REM_ORDER.forEach(paintRem); }
}
async function remSave(f, patch){
  try {
    const r = await api('/reminders', {method:'POST',body:JSON.stringify({feature:f,tz:TZ,...patch})});
    S.rem[f] = r.item;
    if (IOS_SHELL && (!r.item.enabled || S.nativePermission==='granted')) await nativeSchedule(f);
    paintRem(f); return true;
  } catch(e) { paintRem(f); toast('Не удалось сохранить настройки уведомлений'); return false; }
}
async function remTest(f){
  if (remBusy[f]) return;
  remBusy[f]=true; paintRem(f);
  try {
    if (!(await connectPushDevice())) return;
    if (IOS_SHELL) {
      const {item}=await api('/reminders/preview?feature='+f);
      const result=await nativeRequest({type:'notificationTest',id:f,...item});
      toast(result.ok ? 'Пробное уведомление появится через несколько секунд' : 'Телефон не смог показать уведомление');
    } else {
      const r=await api('/reminders/test',{method:'POST',body:JSON.stringify({feature:f,endpoint:S.pushEndpoint})});
      toast(r.ok ? 'Отправлено. Проверьте уведомления устройства' : 'Не получилось отправить');
    }
  } catch(e) { toast(e.code==='too_many' ? 'Не чаще 3 пробных уведомлений за 10 минут' : 'Не получилось отправить пробное уведомление'); }
  finally { remBusy[f]=false; REM_ORDER.forEach(paintRem); }
}
/* публичный ключ сервера приходит строкой base64url — браузеру он нужен байтами */
function toBytes(base64){
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function pushSubscribe(){
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { S.pushOn=false; toast('Разрешите уведомления в настройках сайта в браузере'); return false; }
    const reg = await ensurePushWorker();
    const sub = await withTimeout(reg.pushManager.getSubscription()) || await withTimeout(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:toBytes(S.pushKey)}));
    await api('/push',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
    S.pushEndpoint=sub.endpoint; S.pushOn=true; return true;
  } catch(e) {
    S.pushOn=false;
    /* ячейка уведомлений этого браузера занята другим аккаунтом — «повторите» тут не поможет, нужно другое действие */
    toast(e && e.code==='endpoint_taken'
      ? 'На этом устройстве уведомления включены у другого аккаунта. Зайдите в него и выключите уведомления — тогда включатся ваши'
      : 'Не получилось подключить уведомления. Проверьте связь и повторите');
    return false;
  }
}
let nativeRequestId=0;
const nativeRequests=new Map();
function nativeRequest(message){
  return new Promise((resolve,reject)=>{
    const requestId=String(++nativeRequestId);
    const timer=setTimeout(()=>{nativeRequests.delete(requestId);reject(new Error('native_timeout'));},30000);
    nativeRequests.set(requestId,result=>{clearTimeout(timer);resolve(result);});
    if(!nativePost({...message,requestId})){clearTimeout(timer);nativeRequests.delete(requestId);reject(new Error('native_unavailable'));}
  });
}
window.__lunNotificationResult = result => {
  const done=nativeRequests.get(result.requestId); if(done){nativeRequests.delete(result.requestId);done(result);}
};
/* оболочка App Store: локальные уведомления телефона в то же время и с той же регулярностью */
async function nativeSchedule(f){
  const r = S.rem && S.rem[f]; if (!r) return;
  if (IOS_BRIDGE>=4 && r.enabled && S.nativePermission!=='granted') return;
  if (IOS_BRIDGE < 2) { if (f === 'morning') nativePost({ type: 'reminder', on: r.enabled }); return; }
  const [hh, mm] = r.time.split(':').map(Number);
  /* у телефона нет подстановок — берем заголовок из текстов напоминаний, если он без {скобок}, иначе запасной */
  const rt = CAT && CAT.reminderTexts && CAT.reminderTexts[f==='morning'?'morning-пусто':f], nt = NATIVE_TEXT_FALLBACK[f];
  const msg = { type: 'schedule', id: f, on: r.enabled, hour: hh, minute: mm, freq: r.freq, weekday: r.weekday, title: rt && !/[{}]/.test(rt[0]) ? rt[0] : nt[0], body: rt && !/[{}]/.test(rt[1]) ? rt[1] : nt[1] };
  if (IOS_BRIDGE >= 3 && r.enabled) { const plan=await api('/reminders/native-plan?feature='+f); msg.messages=plan.items; msg.tz=plan.tz||TZ; }   /* утро — настрой каждого дня заранее */
  msg.url={morning:'/app/?open=today',evening:'/app/?open=diary',week:'/app/?open=week'}[f]; msg.tz=msg.tz||TZ;
  if(IOS_BRIDGE>=4){ const result=await nativeRequest(msg); if(!result.ok)throw new Error(result.reason||'native_schedule'); }
  else nativePost(msg);
}
function refreshNativeAskesis(){ if(IOS_SHELL && IOS_BRIDGE>=3) loadReminders(true).then(async()=>{for(const f of REM_ORDER) if(S.rem[f]?.enabled && (IOS_BRIDGE<4 || S.nativePermission==='granted')) await nativeSchedule(f);}).catch(()=>{}); }
document.addEventListener('visibilitychange',()=>{if(!document.hidden && S.user?.onboarded)refreshNativeAskesis();});
window.__lunScheduleState = (states, reason) => {
  S.nativeStates = states || {};
  if(reason==='denied') S.nativePermission='denied';
  REM_ORDER.forEach(paintRem);
  if (reason === 'denied') toast('Уведомления для Лунарио выключены — их можно разрешить в Настройках телефона');
};
/* После карты обновляем ту же строку уведомлений у заголовка. */
function cardNudge(){}
/* «Напоминания» в аккаунте: все функции одним списком */
async function paintAllReminders(){
  const box = $('rem-all'); box.innerHTML = LOADING;
  try { await loadReminders(true); }
  catch (e) { box.innerHTML = '<p class="msg err">Не получилось загрузить настройки уведомлений.</p><button data-on="click:paintAllReminders" type="button" class="btn ghost mt-3">Повторить</button>'; return; }
  box.innerHTML = `<p class="hint">Три напоминания: утром — настрой дня и ваше утро, вечером — запомнить день, в воскресенье — ваша неделя. Время — свое.</p><p id="rem-device-status" class="rem-status" role="status"></p>
    <div class="list mt-3">${REM_ORDER.map(f => `<div class="item"><b class="mb-2">${esc(S.rem[f].title)}</b>${remBox(f,true)}</div>`).join('')}</div>`;
  REM_ORDER.forEach(paintRem);
  if (IOS_SHELL && IOS_BRIDGE >= 2) nativePost({ type: 'scheduleStatus' });
}

/* ══════════ Настроение дня: напоминание вечером и открытка ══════════ */
function paintMoodExtra(){
  const box = $('mood-extra'); if (!box) return;
  const m = moodInfo(S.mood);
  const id = m ? regRes({ type: 'mood', mood: S.mood, label: m.label, day: S.day.date }) : '';
  box.innerHTML = `${m ? actionsHtml(id, true) : '<p class="hint center mt-3">Отметьте настроение — и его можно будет сохранить открыткой.</p>'}`;
  preparePending();
}

/* ══════════ Отчет по настроениям: неделя по дням, месяц по долям ══════════ */
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthName = (key) => { const [y, m] = key.split('-'); return MONTHS_RU[Number(m) - 1] + ' ' + y; };
async function loadMoodReport(){
  const box = $('mr-box'); box.innerHTML = '<p class="hint">Считаем…</p>';
  try { S.moodReport = await api('/mood/report'); paintMoodReport(); track('moodreport_view'); }
  catch (e) { box.innerHTML = LOAD_ERR; }
}
function paintMoodReport(){
  const r = S.moodReport, box = $('mr-box'), total = r.month.days;
  const id = regRes({ type: 'moodreport', r, day: S.day.date });
  box.innerHTML = `<p class="t2">${esc(r.summary)}</p>
    <div class="card mt-3"><h3>Неделя</h3><div class="mr-strip">${r.week.map(w => `<button data-on="click:diaryDay-a0" data-a0="${w.day}" type="button" aria-label="Открыть дневник за ${fmtDay(w.day)}" class="mr-day${w.mood ? ' on' : ''}${w.day === S.day.date ? ' today' : ''}" title="${w.mood ? MOOD_LABEL[w.mood] : ''}">${w.mood ? moodSvg(w.mood, 30) : '<span class="mr-empty"></span>'}<small>${WD_SHORT[wdIdx(w.day)]}</small></button>`).join('')}</div></div>
    <div class="card mt-3"><h3>${monthName(r.month.key)}</h3>${total ? r.month.stats.map(s => `<div class="barrow"><span class="l">${MOOD_LABEL[s.mood] || s.mood}</span><div class="bar"><i style="width:${Math.round(s.c / total * 100)}%"></i></div><span class="v">${s.c}</span></div>`).join('') : '<p>В этом месяце отметок пока нет.</p>'}</div>

    ${r.month.entries?.length?`<h3>Записи по дням</h3><div class="mr-month-days">${r.month.entries.map(w=>`<button data-on="click:diaryDay-a0" data-a0="${w.day}" class="mr-day" type="button" aria-label="Открыть дневник за ${fmtDay(w.day)}">${moodSvg(w.mood,28)}<small>${Number(w.day.slice(-2))}</small></button>`).join('')}</div>`:''}
    ${total ? actionsHtml(id, true) : ''}`;
  paintRem('moodreport'); preparePending();
}

/* ══════════ Лунный день: рекомендация, иллюстрация и глава справочника — текст ровно как в файле ══════════ */
/* Все 30 глав с картинками и общие главы справочника приходят одним запросом, когда экран открыли, и дальше живут в памяти. */
let LUN = null, lunPromise = null;
function loadLunarDays(){
  if (LUN) return Promise.resolve(LUN);
  if (lunPromise) return lunPromise;
  lunPromise = api('/lunar-days?v=' + encodeURIComponent(S.catalogV || 1))
    .then(r => (LUN = { days: r.days || [], reference: r.reference || null, topics: r.topics || [] }))
    .catch(e => { lunPromise = null; throw e; });
  return lunPromise;
}
function lunarPeriodCompact(l){
  if(!l.to)return l.period||'';
  const end=new Date(l.to),tz=S.user.tz||'Europe/Moscow',today=new Date().toLocaleDateString('sv-SE',{timeZone:tz});
  return end.toLocaleDateString('sv-SE',{timeZone:tz})===today?'Сегодня, до '+end.toLocaleTimeString('ru-RU',{timeZone:tz,hour:'2-digit',minute:'2-digit'}):'До '+end.toLocaleString('ru-RU',{timeZone:tz,day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
}
function paintLunarWidget(){
  const l=S.day?.lunar,box=$('ln-box');if(!box)return;
  if(!l){box.innerHTML='<p class="stubtext">Лунный день пока не рассчитан.</p>';return;}
  const id=regRes({type:'lunar',l,day:S.day.date});
  box.innerHTML=`<div class="lunar-heading"><h3>${ordinal(l.n)} лунный день</h3>${l.title?`<p class="practice-question">${esc(l.title)}</p>`:''}<p>${esc(lunarPeriodCompact(l))}</p></div>
    ${l.advice?`<div class="card practice-card"><h3>Рекомендация</h3><p>${esc(l.advice)}</p></div>`:''}
    <div id="ln-art"><p class="hint">Загружаем главу справочника…</p></div>${actionsHtml(id,true)}
    <details class="lunar-period"><summary>Период и место расчета</summary><p>${esc(l.period)}</p><p>По месту рождения из профиля: ${esc(S.user.city||'Москва')}. Часовой пояс: ${esc(S.user.tz||'Europe/Moscow')}</p></details>
    <details class="lunar-library"><summary>Все 30 лунных дней</summary><div id="ln-days"></div><div id="ln-preview"></div><div id="ln-ref"></div></details>`;
  XP.lunarSeenAtOpen=(XP.prefs.lunarViews||0)>=1;   /* ряд тем — со второго открытия: смотрим счетчик до того, как засчитать это открытие */
  preparePending();track('lunar_view','topics:'+(topicsAll()?'all':((XP.prefs.topics||[]).length||'default')));XP.prefs.lunarViews=(XP.prefs.lunarViews||0)+1;
  loadLunarDays().then(()=>{paintLunarArticle();$('ln-ref').innerHTML=lunarRefHtml(LUN.reference);}).catch(()=>{if($('ln-art'))$('ln-art').innerHTML='<p class="hint">Справочник не загрузился. Откройте лунный день еще раз</p>';});
}
/* ── Темы чтения: человек выбирает разделы, остальное — под заголовками-свертками. Ряд тем появляется со второго открытия. ── */
const META_TOPICS=new Set(['symbol','advice','live']);
function topicList(){return (LUN&&LUN.topics)||[];}
function topicsChosen(){const t=XP.prefs.topics||[];return t.length?t:topicList().filter(x=>x.def).map(x=>x.key);}
function topicsAll(){return !!XP.prefs.topicsAll;}
function topicsRowVisible(){return !!XP.lunarSeenAtOpen||!!XP.topicsShown;}
function topicsRowHtml(){
  const chosen=new Set(topicsChosen()),all=topicsAll();
  return `<div class="chips flow ln-topics" role="group" aria-label="Темы чтения">${topicList().map(t=>`<button data-on="click:toggleTopic-a0" data-a0="${t.key}" type="button" class="chip${chosen.has(t.key)?' on':''}${META_TOPICS.has(t.key)?' meta':''}" aria-pressed="${chosen.has(t.key)}">${esc(t.label)}</button>`).join('')}</div>
    <div class="ln-all"><span>${all?'Показаны все разделы':'Показаны выбранные темы'}</span><button data-on="click:setTopicsAll-a0" data-a0="${all?'false':'true'}" type="button">${all?'Только выбранное':'Показать все'}</button></div>`;
}
async function toggleTopic(key){
  const cur=new Set(topicsChosen());if(cur.has(key))cur.delete(key);else cur.add(key);
  const topics=topicList().map(t=>t.key).filter(k=>cur.has(k));
  try{await savePreferences({...XP.prefs,topics});track('topics_set',topics.join(','));hap();}
  catch{toast('Не удалось сохранить выбор. Попробуйте еще раз');return;}
  paintLunarArticle();if($('topics-box'))paintTopics();
}
async function setTopicsAll(on){
  try{await savePreferences({...XP.prefs,topicsAll:!!on});track('topics_all',on?'on':'off');}
  catch{toast('Не удалось сохранить. Попробуйте еще раз');return;}
  XP.topicsShown=true;paintLunarArticle();if($('topics-box'))paintTopics();
}
function paintLunarArticle(){
  const l=S.day&&S.day.lunar,d=LUN&&LUN.days.find(x=>x.n===l.n);if(!l||!$('ln-art'))return;
  $('ln-art').innerHTML=(topicsRowVisible()?topicsRowHtml():'')+(d?lunarDayHtml(d,l.n,true):'');
  const adv=document.querySelector('#ln-box .practice-card');if(adv)adv.style.display=(topicsAll()||topicsChosen().includes('advice'))?'':'none';
  showLunarDay(l.n);preparePending();
}
function trackExpand(el,key){if(el.open)track('lunar_expand',key);}
/* Открытка: одна выбранная содержательная тема — ее заголовок и первая фраза вместо общей рекомендации */
function lunarTopicLine(n){
  const content=topicsChosen().filter(k=>!META_TOPICS.has(k));if(content.length!==1||!LUN)return '';
  const d=LUN.days.find(x=>x.n===n),s=d&&(d.sections||[]).find(x=>x.key===content[0]),para=s&&s.blocks.find(b=>b.t==='p');
  if(!para)return '';const m=String(para.text).match(/^.+?[.!?…](\s|$)/);return s.title+': '+(m?m[0]:para.text).trim();
}
/* WebMCP: если браузер дает агентам доступ к инструментам страницы (navigator.modelContext), объявляем два безопасных:
   что за день сегодня и переход в раздел. Личные записи наружу не отдаются. */
function registerWebMcp(){
  try{
    const mc=navigator.modelContext; if(!mc||typeof mc.provideContext!=='function')return;
    mc.provideContext({tools:[
      {name:'lunario_today',description:'Сегодня в Лунарио: дата, фаза Луны, лунный день и его рекомендация, установка дня. Без личных записей.',inputSchema:{type:'object',properties:{}},
        execute:async()=>{const d=S.day||{};const l=d.lunar||{};return {date:d.date,moon:d.moon,lunarDay:l.n?{n:l.n,title:l.title,advice:l.advice,period:l.period}:null,setting:d.set?d.set.statement||'':'' };}},
      {name:'lunario_open',description:'Открыть раздел или инструмент Лунарио: home, ask, history, about, account, news; или виджет card, mood, lunar, sky, natal, year, compat, topics.',
        inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']},
        execute:async({target})=>{const t=String(target||'');if(['home','ask','history','about','account','news'].includes(t)){go(t);return {ok:true,view:t};}if(FEATURES[t]){openWidget(t);return {ok:true,widget:t};}return {ok:false,error:'unknown target'};}}
    ]});
  }catch(e){}
}
/* Виджет «Геолокация»: место для созвездий — по устройству (только по нажатию), свой город или как в анкете */
function paintSkyPlace(){
  const box=$('skyplace-box'),sky=window.LunarioSky;if(!box)return;
  const d=sky?sky.describe():{label:'Москва',source:'moscow',hasProfile:false,geolocation:false};
  box.innerHTML=`<p class="hint">Созвездия на фоне рисуются для этого места. Координаты устройства никуда не отправляются; выбранный город запоминается только в этом браузере.</p>
    <div class="card mt-3"><span class="eyebrow">Сейчас</span><p class="mt-1" id="sp-now">${esc(d.label)}</p></div>
    <div class="field sug mt-3"><label for="sp-city">Указать город</label><input id="sp-city" placeholder="Начните вводить: Влад…" maxlength="60" autocomplete="off"><div class="sug-list" id="sp-city-list"></div><p class="hint mt-2" id="sp-geo">Выберите город из подсказки — небо перестроится сразу.</p></div>
    <div class="rows mt-3">
      ${d.geolocation?`<button data-on="click:window-LunarioSky-locate-true-setTimeout-paintSkyPlace-1" class="rowbtn" type="button"><span>Определить по устройству</span><small>Телефон спросит разрешение один раз</small></button>`:''}
      ${d.hasProfile?`<button data-on="click:window-LunarioSky-useProfile-paintSkyPlace" class="rowbtn" type="button"><span>Как в анкете</span><small>Город рождения из профиля</small></button>`:''}
    </div>`;
  const pick=attachCity('sp-city','sp-city-list','sp-geo');
  $('sp-city-list').addEventListener('click',()=>setTimeout(()=>{const c=pick.picked;if(c&&sky){sky.setCity({name:c.name,lat:c.lat,lon:c.lon});$('sp-now').textContent=sky.describe().label;toast('Небо перестроено ✦');}},0));
}
/* Виджет «Настройка контента» (темы чтения) в «Аккаунте» */
function paintTopics(){
  const box=$('topics-box');if(!box)return;
  if(!LUN){box.innerHTML='<p class="hint">Загружаем темы…</p>';loadLunarDays().then(paintTopics).catch(()=>{box.innerHTML='<p class="hint">Не удалось загрузить темы. Откройте еще раз</p>';});return;}
  box.innerHTML=`<p class="hint">Лунный день показывается выбранными разделами, остальные свернуты под заголовками. Выбор действует на экране, в напоминании и на открытке.</p>${topicsRowHtml()}`;
}
/* Глава дня: иллюстрация, номер и тема, вступление сразу, разделы с подзаголовками — под «Читать полностью». */
function lunarDayHtml(d, today, primary=false){
  const secs = d.sections && d.sections.length ? d.sections : [{ key: 'symbol', title: '', blocks: d.blocks }];
  const all = topicsAll(), chosen = new Set(topicsChosen());
  const shown = secs.filter(s => all || chosen.has(s.key)), hidden = secs.filter(s => !all && !chosen.has(s.key));
  const secHtml = (s) => (s.title ? `<h3 class="ln-sec">${esc(s.title)}</h3>` : '') + blocksHtml(s.blocks);
  const hiddenHtml = hidden.length ? `<div class="ln-hidden">${hidden.map(s => `<details data-on="toggle:trackExpand-this-a0" data-a0="${s.key}"><summary>${esc(s.title || 'Символ и тема')}</summary>${blocksHtml(s.blocks)}</details>`).join('')}</div>` : '';
  return `<div class="item rise yr-art">
    <img class="yr-img" src="${d.image}?v=1" width="1080" height="1080" alt="${d.n} лунный день · ${esc(d.symbol || d.theme)}">
    ${primary?'':`<p class="ln-eb">${d.n} лунный день${d.n===today?' · сегодня':''}</p>`}
    ${primary && d.theme===S.day.lunar.title?'':`<p class="ln-title">${esc(d.theme)}</p>`}
    ${shown.map(secHtml).join('')}${hiddenHtml}
  </div>`;
}
/* Полоска всех 30 дней — как оглавление справочника: любой день можно прочитать заранее. */
function showLunarDay(n){
  const days = (LUN && LUN.days) || [], d = days.find(x => x.n === n), art = $('ln-preview'), strip = $('ln-days');
  if (!art || !strip) return;
  const today = S.day && S.day.lunar ? S.day.lunar.n : 0;
  strip.innerHTML = days.length ? `<div class="chips ln-days">${days.map(x => `<button data-on="click:showLunarDay-a0" data-a0="${x.n}" class="chip${x.n === n ? ' on' : ''}" type="button">${x.n}</button>`).join('')}</div>` : '';
  art.innerHTML = d ? lunarDayHtml(d, today) : '';
  art.style.marginTop = d ? '12px' : '0';
  const on=strip.querySelector('.chip.on');if(on&&strip.closest('details')?.open)on.scrollIntoView({block:'nearest',inline:'center'});
}
/* Общие главы справочника — каждая под своим названием; «Оглавление» заменяет полоска дней выше. */
function lunarRefHtml(ref){
  if (!ref || !ref.sections) return '';
  const secs = ref.sections.filter(s => s.title !== 'Оглавление' && s.blocks && s.blocks.length);
  if (!secs.length) return '';
  return `<div class="card yr-art mt-3"><h3>${esc(ref.title)}</h3>${ref.caption ? `<p class="hint mt-0">${esc(ref.caption)}</p>` : ''}
    ${secs.map(sec => moreBlock(blocksHtml(sec.blocks), sec.title)).join('')}</div>`;
}

/* ══════════ На небе: сегодня и ближайшие недели ══════════ */
async function loadSky(){
  const box = $('sky-box'); if (!S.sky) box.innerHTML = '<p class="hint">Смотрим на небо…</p>';
  try { S.sky = await api('/sky'); paintSky(); track('sky_view'); }
  catch (e) { box.innerHTML = '<p class="msg err">Не получилось рассчитать небо.</p>'; }

}
function paintSky(){
  const s = S.sky, box = $('sky-box');
  const id = regRes({ type: 'sky', sky: s, day: s.date });
  const ev = (e, cls) => `<div class="item skyev${cls ? ' ' + cls : ''}"><b>${esc(e.title)}</b><small>${fmtWhen(e.at)}</small>${e.note ? `<p class="mt-2">${esc(e.note)}</p>` : ''}</div>`;
  box.innerHTML = `<div class="card center"><span class="eyebrow">Сегодня</span>
      <div class="title-gold mt-2">${esc(s.moon.phase)} ${esc(s.moon.signIn)}</div>
      <p class="mt-1">Луна освещена на ${s.moon.illumination}% · ${s.moon.waxing ? 'растет' : 'убывает'} · Солнце ${esc(s.sun.signIn)}</p>
      <p class="t2">${s.retro.length ? s.retro.map(r => `${r.symbol} ${esc(r.name)} — ${r.adj}`).join(' · ') : 'Ретроградных планет сейчас нет'}</p>
    </div>
    ${s.today.length ? `<div class="list mt-3">${s.today.map(e => ev(e, 'now')).join('')}</div>` : ''}
    ${s.retro.length ? `<div class="card mt-3">${s.retro.map(r => `<h3>${r.symbol} ${esc(r.name)} ${r.adj}</h3><p>${esc(r.note)}</p>`).join('')}</div>` : ''}
    ${s.aspects.length ? `<div class="card mt-3"><h3>Точные аспекты сегодня</h3>${s.aspects.map(a => `<p>${a.aSym} ${esc(a.a)} ${a.symbol} ${a.bSym} ${esc(a.b)} <small class="faint">· ${esc(a.name.toLowerCase())}, орб ${a.orb}°</small></p>`).join('')}</div>` : ''}
    <span class="eyebrow mt-4">Ближайшие недели</span>
    <div class="list mt-2">${s.upcoming.map(e => ev(e)).join('')}</div>
    ${actionsHtml(id, true)}
    <p class="hint mt-3 center">Фазы и планеты рассчитаны астрономически. Затмения — по положению Луны у узлов, без учета видимости из вашего города.</p>`;
  paintRem('sky'); preparePending();
}

/* ══════════ Поделиться текстом: любой результат ══════════ */
function shareResText(p){
  const link = refLink();   /* реферальная: кто придет с открытки — тоже «от кого» */
  switch (p.type) {
    case 'morning': return `${p.text}${p.question ? '\n' + p.question : ''}\nЛунарио · ${link}`;
    case 'card': return `${p.card.name} — карта дня в Лунарио.\n${keysLine(p.card.keys)}\n${link}`;
    case 'rune': return `Руна ${p.runes[0].name} — ${p.runes[0].answer || p.runes[0].motto || ''}\nЛунарио · ${link}`;
    case 'runes': return `Руны: ${p.runes.map(r => r.name).join(' · ')}\nЛунарио · ${link}`;
    case 'spread': return `Таро: ${p.cards.map(c => c.name).join(' · ')}\nЛунарио · ${link}`;
    case 'yesno': return `${p.title}. ${p.body}\nЛунарио · ${link}`;
    case 'mood': return `Сегодня в Лунарио — ${p.label.toLowerCase()}.\n${link}`;
    case 'moodreport': return `${p.r.summary}\nЛунарио · ${link}`;
    case 'habits': return `Мои привычки в Лунарио: ${p.items.map(h => h.title).join(', ')}.\n${link}`;
    case 'askesis': return `Аскеза «${p.a.title}»: день ${p.a.done} из ${p.a.total}, осталось ${p.a.left}.\nЛунарио · ${link}`;
    case 'lunar': return `${ordinal(p.l.n)} лунный день${p.l.title ? ' · ' + p.l.title : ''}${p.l.theme ? '\n' + p.l.theme : ''}\n${p.l.advice || ''}\nЛунарио · ${link}`;
    case 'gratitude': return `Сегодня я благодарна: ${p.text}\nЛунарио · ${link}`;
    case 'sky': return `На небе сегодня: ${p.sky.moon.phase} ${p.sky.moon.signIn}${p.sky.today.length ? ' · ' + p.sky.today.map(e => e.title).join(' · ') : ''}.\nЛунарио · ${link}`;
  }
  return `Лунарио · ${link}`;
}
async function shareRes(id){
  const p = RES[id]; if (!p) return;
  const t = shareResText(p); track('share_card', p.type);
  if (IOS_SHELL && nativePost({ type: 'share', text: t })) return;
  if (navigator.share) { try { await navigator.share({title:'Лунарио',text:t}); } catch(e) { if(e.name!=='AbortError')toast('Не удалось открыть меню «Поделиться»'); } }
  else { try { await navigator.clipboard.writeText(t); toast('Скопировано — можно поделиться'); } catch(e) { toast('Не удалось скопировать. Разрешите доступ к буферу обмена'); } }
}

/* диск Луны с настоящей освещенностью */
function pcMoonDisc(ctx, cx, cy, R, illum, waxing){
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#2a2150'; ctx.fill();
  const k = Math.max(0, Math.min(1, illum / 100)), rx = Math.abs(R * (1 - 2 * k));
  ctx.beginPath();
  if (waxing) { ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); ctx.ellipse(cx, cy, rx, R, 0, Math.PI / 2, -Math.PI / 2, k < 0.5); }
  else { ctx.arc(cx, cy, R, Math.PI / 2, Math.PI * 1.5); ctx.ellipse(cx, cy, rx, R, 0, -Math.PI / 2, Math.PI / 2, k < 0.5); }
  ctx.closePath(); ctx.fillStyle = '#f0d79a'; ctx.shadowColor = 'rgba(240,215,154,.55)'; ctx.shadowBlur = 50; ctx.fill();
  ctx.restore();
}
async function drawPostcardExtra(ctx, p){
  if (p.type === 'morning') {   /* утро: луна как сегодня, тема, настрой крупно, вопрос курсивом, внизу — что еще выбрано на утро */
    pcMoonDisc(ctx, 540, 400, 150, p.moonPct ?? 50, p.waxing);
    let y = drawText(ctx, (p.theme || 'НАСТРОЙ ДНЯ').toUpperCase(), 540, 660, { size: 28, weight: 700, color: '#d9b868', spacing: 6 });
    y = drawText(ctx, p.text, 540, y + 40, { size: p.text.length > 70 ? 44 : 56, weight: 600, color: '#f5f2ea', maxW: 900, lh: 1.25 });
    if (p.question) { ctx.fillStyle = 'rgba(217,184,104,.6)'; ctx.fillRect(512, y + 30, 56, 2); y = drawText(ctx, p.question, 540, y + 84, { size: 34, italic: true, color: '#ded8ee', maxW: 860, lh: 1.4 }); }
    const extras = [p.card ? `Карта дня — ${p.card}` : '', p.rune ? `Руна дня — ${p.rune}` : '', p.lunar].filter(Boolean);
    if (extras.length) drawText(ctx, extras.join(' · '), 540, Math.max(y + 70, 1440), { size: 26, color: '#8f87ad', maxW: 900, lh: 1.35 });
    return true;
  }
  if (p.type === 'mood') {
    pcSmiley(ctx, p.mood, 540, 600, 520);
    let y = drawText(ctx, 'Сегодня — ' + p.label.toLowerCase(), 540, 1010, { size: 58, weight: 600, color: '#e9c77e', maxW: 900 });
    if (S.day && S.day.affirmation) drawText(ctx, '«' + S.day.affirmation + '»', 540, y + 70, { size: 34, italic: true, color: '#ded8ee', maxW: 860, lh: 1.45 });
    return true;
  }
  if (p.type === 'moodreport') {
    const r = p.r;
    drawText(ctx, 'НАСТРОЕНИЯ ЗА НЕДЕЛЮ', 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    r.week.forEach((w, i) => {
      const cx = 540 + (i - 3) * 132;
      if (w.mood) pcSmiley(ctx, w.mood, cx, 400, 92);
      else { ctx.save(); ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(245,242,234,.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, 400, 34, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      drawText(ctx, WD_SHORT[wdIdx(w.day)], cx, 500, { size: 24, color: w.day === p.day ? '#f0d79a' : '#8f87ad' });
    });
    let y = drawText(ctx, monthName(r.month.key), 540, 660, { size: 36, weight: 600, color: '#f5f2ea' });
    const total = r.month.days;
    for (const s of r.month.stats) {
      y += 30;
      drawText(ctx, MOOD_LABEL[s.mood] || s.mood, 180, y + 12, { size: 30, color: '#b9b2cf', align: 'left', maxW: 260 });
      ctx.fillStyle = 'rgba(245,242,234,.09)'; rrect(ctx, 460, y - 12, 380, 22, 11); ctx.fill();
      const g = ctx.createLinearGradient(460, 0, 840, 0); g.addColorStop(0, '#b98f3e'); g.addColorStop(1, '#f0d79a');
      ctx.fillStyle = g; rrect(ctx, 460, y - 12, Math.max(22, 380 * s.c / total), 22, 11); ctx.fill();
      drawText(ctx, String(s.c), 900, y + 10, { size: 28, color: '#f5f2ea', align: 'right' });
      y += 34;
    }
    drawText(ctx, r.summary, 540, Math.max(y + 120, 1300), { size: 32, color: '#ded8ee', maxW: 860, lh: 1.45 });
    return true;
  }
  if (p.type === 'habits') {
    drawText(ctx, 'МОИ ПРИВЫЧКИ', 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    const wk = p.items[0].week;
    drawText(ctx, `${fmtDay(wk[0].day).slice(0, 5)} — ${fmtDay(wk[6].day).slice(0, 5)}`, 540, 225, { size: 28, color: '#8f87ad' });
    const rows = p.items.slice(0, 8);
    let y = Math.max(360, Math.round((1560 - rows.length * 140) / 2) + 120), marks = 0;
    for (const h of rows) {
      drawText(ctx, h.title, 150, y, { size: 36, weight: 600, color: '#f5f2ea', align: 'left', maxW: 780, lh: 1.1 });
      h.week.forEach((w, i) => { const cx = 170 + i * 68; ctx.beginPath(); ctx.arc(cx, y + 50, 16, 0, Math.PI * 2); if (w.done) { ctx.fillStyle = '#e9c77e'; ctx.fill(); marks++; } else { ctx.strokeStyle = 'rgba(233,199,126,.5)'; ctx.lineWidth = 2.5; ctx.stroke(); } });
      y += 140;
    }
    drawText(ctx, `${marks} из ${p.items.length * 7} отметок за неделю`, 540, Math.max(y + 40, 1580), { size: 32, color: '#ded8ee' });
    return true;
  }
  if (p.type === 'askesis') {
    const a = p.a;
    drawText(ctx, 'АСКЕЗА', 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    drawText(ctx, a.title, 540, 420, { size: 60, weight: 600, color: '#e9c77e', maxW: 900, lh: 1.15 });
    const cx = 540, cy = 900, R = 210;
    ctx.save(); ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(245,242,234,.1)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e9c77e'; ctx.shadowColor = 'rgba(233,199,126,.5)'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.done / a.total); ctx.stroke(); ctx.restore();
    drawText(ctx, String(a.done), cx, cy + 45, { size: 150, weight: 600, color: '#f5f2ea' });
    drawText(ctx, `из ${a.total}`, cx, cy + 115, { size: 34, color: '#b9b2cf' });
    let y = drawText(ctx, a.left === 0 ? 'Сегодня последний день ✦' : `До конца осталось ${a.left} ${plural(a.left, 'день', 'дня', 'дней')}`, 540, 1260, { size: 34, color: '#ded8ee' });
    drawText(ctx, `${fmtDay(a.started)} — ${fmtDay(a.until)}`, 540, y + 16, { size: 28, color: '#8f87ad' });
    return true;
  }
  if (p.type === 'gratitude') {
    drawText(ctx, 'БЛАГОДАРНОСТЬ', 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    let y = drawText(ctx, gratQ(), 540, 470, { size: 44, weight: 600, color: '#e9c77e', maxW: 880, lh: 1.25 });
    drawText(ctx, p.text, 540, y + 80, { size: 40, color: '#f5f2ea', maxW: 860, lh: 1.42 });
    return true;
  }
  if (p.type === 'lunar') {
    const l = p.l;
    if (l.image && await pcCover(ctx, l.image + '?v=1', 70)) {   /* иллюстрация дня — как у личного года; под ней номер, название, тема и рекомендация */
      let y = drawText(ctx, `${l.n}-Й ЛУННЫЙ ДЕНЬ`, 540, 1225, { size: 28, weight: 700, color: '#d9b868', spacing: 6 });
      if (l.title) y = drawText(ctx, l.title, 540, y + 22, { size: 50, weight: 600, color: '#e9c77e', maxW: 940, lh: 1.2 });
      if (l.theme) y = drawText(ctx, l.theme, 540, y + 6, { size: 28, italic: true, color: '#ded8ee', maxW: 900, lh: 1.3 });
      const adv = lunarTopicLine(l.n) || l.advice;
      if (adv) y = drawText(ctx, adv, 540, y + 40, { size: 32, color: '#f5f2ea', maxW: 880, lh: 1.4 });
      drawText(ctx, l.period, 540, y + 30, { size: 25, color: '#8f87ad', maxW: 900 });
      return true;
    }
    ctx.save(); ctx.shadowColor = 'rgba(233,199,126,.45)'; ctx.shadowBlur = 60; drawText(ctx, String(l.n), 540, 560, { size: 300, weight: 600, color: '#e9c77e' }); ctx.restore();
    let y = drawText(ctx, `${ordinal(l.n)} лунный день`, 540, 660, { size: 40, color: '#f5f2ea' });
    if (l.title) y = drawText(ctx, l.title, 540, y + 30, { size: 50, weight: 600, color: '#e9c77e', maxW: 900 });
    const adv2 = lunarTopicLine(l.n) || l.advice;
    if (adv2) y = drawText(ctx, adv2, 540, y + 60, { size: 38, color: '#f5f2ea', maxW: 860, lh: 1.42 });
    drawText(ctx, l.period, 540, Math.max(y + 60, 1440), { size: 26, color: '#8f87ad', maxW: 900 });
    return true;
  }
  if (p.type === 'sky') {
    const s = p.sky;
    drawText(ctx, 'НА НЕБЕ', 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    pcMoonDisc(ctx, 540, 470, 170, s.moon.illumination, s.moon.waxing);
    let y = drawText(ctx, `${s.moon.phase} ${s.moon.signIn}`, 540, 760, { size: 50, weight: 600, color: '#e9c77e', maxW: 900 });
    y = drawText(ctx, `Луна освещена на ${s.moon.illumination}% · Солнце ${s.sun.signIn}`, 540, y + 10, { size: 28, color: '#b9b2cf', maxW: 900 });
    if (s.retro.length) y = drawText(ctx, s.retro.map(r => `${r.name} — ${r.adj}`).join(' · '), 540, y + 20, { size: 30, color: '#ded8ee', maxW: 900 });
    const lines = [...s.today.map(e => ({ ...e, now: true })), ...s.upcoming].slice(0, 5);
    y += 70;
    for (const e of lines) {
      y = drawText(ctx, (e.now ? 'Сегодня · ' : new Date(e.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' · ') + e.title, 540, y, { size: e.now ? 34 : 30, weight: e.now ? 600 : 400, color: e.now ? '#f0d79a' : '#f5f2ea', maxW: 900, lh: 1.3 });
      y += 22;
    }
    return true;
  }
  return false;
}
/* ══════════ Круг эмоций Плутчика: восемь лепестков по три оттенка и восемь сочетаний — список и цвета из каталога ══════════ */
/* какой лепесток рисовать у сочетания — по тому, что в нем звучит громче */
const DYAD_FACE = { optimism:'joy', love:'joy', submission:'anticipation', awe:'surprise', disappointment:'sadness', remorse:'sadness', contempt:'anger', aggressiveness:'anger' };
const MOUTH = { joy:'M11.5 18.5q4.5 4.5 9 0', trust:'M12 19q4 3 8 0', fear:'M11.5 19q2.2-2 4.5 0t4.5 0', surprise:'M13.8 19.2a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
  sadness:'M11.5 20.5q4.5-4 9 0', disgust:'M11.5 19.5q2 1.6 4.5 0t4.5 0', anger:'M11.5 20.5q4.5-3 9 0', anticipation:'M12.5 19.5h7' };
const moodList = () => CAT?.moods || [];
const moodFams = () => CAT?.moodFamilies || {};
/* свое слово: хранится как «own:слово» — на экране и в отчете показывается как есть, без лепестка */
const ownMood = (key) => typeof key === 'string' && key.startsWith('own:') ? key.slice(4) : '';
function moodInfo(key){ const quick=quickMoods().find(m=>m.key===key);if(quick)return quick; if(key==='displeasure') return {key,label:'неудовольствие',family:'disgust',tone:'-'}; if (ownMood(key)) return { key, label: ownMood(key), family: 'own', tone: '0' }; const k = (CAT?.legacyMoods || {})[key] || key; return moodList().find(m => m.key === k) || null; }
const MOOD_LABEL = new Proxy({}, { get: (_, k) => { const m = moodInfo(k); return m ? m.label : String(k); } });
const moodFace = (key) => { const m = moodInfo(key); if (!m || m.family === 'own') return 'anticipation'; return m.family === 'dyad' ? DYAD_FACE[m.key] || 'joy' : m.family; };
const moodColor = (key) => { const m = moodInfo(key); if (!m || m.family === 'own') return '#e9c77e'; const fam = m.family === 'dyad' ? moodFace(key) : m.family; return (moodFams()[fam] || ['', '#b9b2cf'])[1]; };
const moodUiColor = key => `var(--emotion-${moodInfo(key)?.family==='own'?'own':moodFace(key)},${moodColor(key)})`;
const moodSvg = (mood, size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" style="color:${moodUiColor(mood)}"><circle cx="16" cy="16" r="12.5" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/><circle cx="20" cy="13" r="1.4" fill="currentColor"/><path d="${MOUTH[moodFace(mood)]}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const quickMoods=()=>CAT?.quickMoods||[];
const moodUI={mode:'families',family:null,own:null,ownOpen:false,precision:false};
function moodMode(mode){moodUI.mode=mode;renderMoods();focusSelectedTab('Выбор эмоций');}
function moodFamily(family){moodUI.family=moodUI.family===family?null:family;renderMoods();document.querySelector('[data-on="click:moodFamily-a0"][data-a0="'+family+'"]')?.focus({preventScroll:true});}
function moodDetails(mode='families'){moodUI.precision=true;moodUI.mode=mode;renderMoods();$('mood-detail')?.scrollIntoView({behavior:'smooth',block:'nearest'});}
function moodOwn(){moodUI.ownOpen=true;renderMoods();$('mood-own').focus();}
async function quickMood(key){const m=quickMoods().find(m=>m.key===key);if(!m)return;moodUI.family=m.family;moodUI.precision=false;await pickMood(key);}
function renderMoods(){
  const fams=moodFams(),list=moodList(),cur=moodInfo(S.mood),selected=moodUI.family;
  const chip=m=>`<button data-on="click:pickMood-a0" data-a0="${m.key}" type="button" class="chip mchip${cur?.key===m.key?' on':''}" aria-pressed="${cur?.key===m.key}" style="--c:${moodUiColor(m.key)}">${esc(m.label)}</button>`;
  const familyKeys=Object.keys(fams).filter(f=>f!=='dyad'&&list.some(m=>m.family===f));
  $('t-moods').className='mood-picker';
  if(!quickMoods().length){$('t-moods').innerHTML=`<p class="practice-question">Как вы сейчас?</p><p class="hint">Список настроений не загрузился. <button data-on="click:loadCatalog-then-renderMoods-catch-toast-Нет-связи" type="button" class="text-action">Повторить</button></p>`;return;}
  $('t-moods').innerHTML=`<p class="practice-question">Как вы сейчас?</p>
    <div class="quick-moods">${quickMoods().map(m=>`<button data-on="click:quickMood-a0" data-a0="${m.key}" type="button" class="quick-mood${S.mood===m.key?' on':''}" aria-pressed="${S.mood===m.key}">${moodSvg(m.key,30)}<span>${esc(m.label)}</span></button>`).join('')}<button data-on="click:moodOwn" type="button" class="quick-mood"><i class="ico pen"></i><span>Свое слово</span></button></div>
    ${cur?`<div class="mpick saved-state" role="status">${moodSvg(S.mood,36)}<div><b>Сегодня — ${esc(cur.label)}</b><small>Сохранено · ${fmtDay(S.day.date)}. Можно выбрать другое</small></div></div>`:''}
    <div class="mood-own-row" ${moodUI.ownOpen?'':'hidden'}><label for="mood-own">Свое настроение</label><div class="row"><input data-on="input:moodUI-own-value keydown:if-event-key-Enter-pickOwnMood" id="mood-own" aria-label="Свое настроение" maxlength="24" placeholder="Например: собранно" value="${esc(moodUI.own??ownMood(S.mood))}"><button data-on="click:pickOwnMood" class="btn sm" aria-label="Сохранить свое настроение">Сохранить</button></div></div>
    <div class="utility-actions"><button data-on="click:moodDetails" type="button" class="text-action secondary">${cur?'Хотите назвать точнее?':'Назвать точнее'}</button><button data-on="click:moodDetails-all" type="button" class="text-action secondary">Все эмоции</button></div>
    <div id="mood-detail" ${moodUI.precision?'':'hidden'}><div class="segmented" role="tablist" aria-label="Выбор эмоций"><button data-on="click:moodMode-families" role="tab" aria-selected="${moodUI.mode==='families'}">Основные эмоции</button><button data-on="click:moodMode-all" role="tab" aria-selected="${moodUI.mode==='all'}">Все эмоции</button></div>
    ${moodUI.mode==='families'?`
      <div id="mood-shades" class="mood-shades" ${selected?'':'hidden'}><p>${selected?esc(fams[selected][0]):''} · что ближе?</p><div class="chips flow">${list.filter(m=>m.family===selected).map(chip).join('')}</div></div>
      <div class="emotion-families">${familyKeys.map(f=>`<button data-on="click:moodFamily-a0" data-a0="${f}" type="button" class="emotion-family${selected===f?' on':''}" style="--c:var(--emotion-${f},${fams[f][1]})" aria-expanded="${selected===f}">${moodSvg(f,28)}<span>${esc(fams[f][0])}</span><span aria-hidden="true">⌄</span></button>`).join('')}</div>
      <button data-on="click:moodFamily-a0" data-a0="dyad" class="text-action secondary" type="button">Сочетания эмоций</button><p class="hint">Оттенки по кругу Плутчика</p>`:
      Object.keys(fams).filter(f=>list.some(m=>m.family===f)).map(f=>`<div class="mfam"><span class="fname">${esc(fams[f][0])}</span><div class="chips flow">${list.filter(m=>m.family===f).map(chip).join('')}</div></div>`).join('')}
    </div>`;
}

/* смайлик настроения на открытке — лепесток дает рот и цвет */
function pcSmiley(ctx, mood, cx, cy, size){
  const k = size / 32, color = moodColor(mood);
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(k, k);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.shadowColor = color; ctx.shadowBlur = 20 / k;
  ctx.beginPath(); ctx.arc(16, 16, 12.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(12, 13, 1.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(20, 13, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.stroke(new Path2D(MOUTH[moodFace(mood)])); ctx.restore();
}

/* ══════════ «Разобрать вопрос»: тема или свой вопрос своими словами, инструмент ответа выбирается тут же ══════════ */
const HUB_TOPICS=[['Отношения','Что мне сейчас важно в отношениях?'],['Работа и деньги','Что мне важно понять о работе или деньгах?'],['Решение','Какое решение мне сейчас подходит?'],['Тревога','Что стоит за моей тревогой сейчас?'],['Отношение к себе','Что мне сейчас важно услышать о себе?'],['Другое','Что мне важно понять сейчас?']];
const HUB_OPTS=[['rune','rune','Руна','one'],['runes3','rune','Три руны','three'],['spread','tarot','Три карты','three'],['fork','tarot','Выбор','fork']];
const hubDraft={text:'',topic:null,kind:'rune'};
const hubReady=(q)=>q.length>=10&&/\s/.test(q);   /* тот же порог, что на сервере: ответ приходит на конкретный вопрос, а не на слово */
function renderHub(){
  const w=$('t-worry');if(!w)return;
  w.innerHTML=`<div class="card hubq"><p>Темы</p><div class="chips flow" id="hub-chips">${HUB_TOPICS.map(([label],i)=>`<button data-on="click:hubTopic-a0" data-a0="${i}" type="button" class="chip${hubDraft.topic===i?' on':''}" aria-pressed="${hubDraft.topic===i}">${label}</button>`).join('')}</div>
    <div class="field"><label for="hub-q">Что именно сейчас не дает покоя?</label><textarea data-on="input:hubDraft-text-value-hubCheck" id="hub-q" maxlength="300" placeholder="Опишите своими словами…">${esc(hubDraft.text)}</textarea><p class="hint" id="hub-hint" role="status"></p></div>
    <div id="hub-opts"><span class="eyebrow">Как получить ответ</span><div class="chips flow">${HUB_OPTS.map(([key,,label])=>`<button data-on="click:hubMethod-a0" data-a0="${key}" type="button" class="chip${hubDraft.kind===key?' on':''}" data-kind="${key}" aria-pressed="${hubDraft.kind===key}">${label}</button>`).join('')}</div>
    <button data-on="click:hubAsk" type="button" class="btn" id="hub-go">Получить ответ</button></div></div><div id="hub-res" hidden></div>`;
  hubCheck();
}
function hubTopic(index){
  const previous=HUB_TOPICS[hubDraft.topic]?.[1];
  if(!hubReady(hubDraft.text.trim())||hubDraft.text===previous)hubDraft.text=HUB_TOPICS[index][1];   /* пустое или слишком короткое свое — заменяем вопросом темы */
  hubDraft.topic=index;renderHub();$('hub-q').focus();
}
function hubMethod(kind){hubDraft.kind=kind;document.querySelectorAll('#hub-opts .chip').forEach(b=>{const on=b.dataset.kind===kind;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});}
/* инструменты видны всегда; пока вопрос короче нескольких слов — кнопка ждет и подсказывает, что дописать */
function hubCheck(){const v=$('hub-q').value.trim(),ok=hubReady(v);$('hub-go').disabled=!ok;$('hub-hint').textContent=ok||!v?'':'Напишите вопрос целиком, так вы потом вспомните, что вас волновало';}
async function hubAsk(){
  if(hubAsk.busy)return;const q=$('hub-q').value.trim();if(!hubReady(q)){hubCheck();return;}
  const out=$('hub-res'),button=$('hub-go');hubAsk.busy=true;button.disabled=true;button.textContent='Получаем ответ…';out.hidden=false;out.innerHTML='<p class="msg">Смотрим…</p>';
  const opt=HUB_OPTS.find(o=>o[0]===hubDraft.kind);track('worry_pick',hubDraft.kind);
  try{await runAsk(opt[1]==='rune'?'rune':'spread',q,out,null,opt[3]);out.scrollIntoView({behavior:'smooth',block:'start'});}
  catch(e){out.innerHTML=`<p class="msg err">${askErrorText(e)}</p>`;}
  finally{hubAsk.busy=false;button.disabled=false;button.textContent='Получить ответ';}
}

/* ══════════ Вопрос дня: к фразе на главной; ответ уходит в дневник ══════════ */
/* Ответ на вопрос дня — один на день, где бы его ни писали: здесь или в карточке дня. Панель показывает уже записанный
   ответ и правит его, а не добавляет второй */
let toneDraft='',toneSaving=false,toneSaved=null,toneLoadedFor='';
function paintTone(){
  const d=S.day,st=d.set;if(!$('tone-box'))return;
  if(toneSaved&&toneSaved.day!==d.date)toneSaved=null;
  const text=toneDraft||(toneSaved?toneSaved.text:'');
  $('tone-box').innerHTML=`${st?`<p class="hint mb-4">${esc(st.statement||st.text)}</p>`:''}
    <p class="practice-question">${esc(d.question)}</p>
    ${toneSaved?`<div class="saved-state" role="status">В дневнике · ${fmtDay(toneSaved.day)} — можно дописать</div>`:''}
    <div class="answer-form"><div class="field"><textarea data-on="input:toneDraft-value-growTextarea-this" id="tone-a" aria-label="Ответ на вопрос дня" maxlength="2000" placeholder="Пара строк — как есть…">${esc(text)}</textarea></div></div>
    <div class="answer-actions"><button data-on="click:saveAnswer" id="tone-save" type="button" class="btn sm" ${toneSaving?'disabled':''}>${toneSaving?'Сохраняем…':toneSaved?'Обновить в дневнике':'Отправить в дневник'}</button></div>`;
  requestAnimationFrame(()=>growTextarea($('tone-a')));
}
/* при открытии — подтянуть ответ, если он уже есть (например, записан вечером в карточке дня) */
async function loadTone(){
  paintTone();
  if(toneLoadedFor===S.day.date)return;
  try{const st=await api('/day');toneLoadedFor=S.day.date;if(st.answer&&!toneDraft){toneSaved={id:st.answer.id,day:st.day,text:st.answer.text};paintTone();}}catch(e){}
}
async function saveAnswer(){
  if(toneSaving)return;const t=($('tone-a').value||'').trim();
  if(t.length<3){toast('Напишите хотя бы пару слов');return;}
  toneSaving=true;$('tone-save').disabled=true;
  try{const r=await api('/journal',{method:'POST',body:JSON.stringify({text:t,kind:'answer',title:S.day.question})});toneDraft='';toneSaved={id:r.item.id,day:r.item.day,text:r.item.text};toast(r.updated?'Ответ обновлен в дневнике':'Записано в дневник');hap('ok');loadJournal();XP.timeline.dirty=true;}
  catch(e){toast('Не получилось сохранить. Ваш текст остался в поле');}
  finally{toneSaving=false;paintTone();}
}

/* ══════════ Дневник благодарности ══════════ */
const gratQ = () => 'Кому и за что я благодарна сегодня?';
async function loadGratitude(){
  const box = $('gr-box'); box.innerHTML = LOADING;
  await loadCatalog().catch(() => {});
  try { const r = await api('/journal?kind=gratitude'); S.grat = r; paintGratitude(); }
  catch (e) { box.innerHTML = LOAD_ERR; }
}
let gratitudeEdit=null,gratitudeDraft='',gratitudeSaving=false;
function editGratitude(id){
  const item=S.grat.items.find(i=>i.id===id); if(!item)return;
  gratitudeEdit=id;gratitudeDraft=item.text;paintGratitude();$('gr-text').focus();
}
function paintGratitude(){
  const r=S.grat,box=$('gr-box'),todayItem=r.items.find(i=>i.day===S.day.date);
  const editing=gratitudeEdit!==null || !todayItem;
  const id=todayItem?regRes({type:'gratitude',text:todayItem.text,day:todayItem.day}):'';
  box.innerHTML=`<div class="card practice-card"><p class="practice-question">${esc(gratQ())}</p>
    ${!editing?`<div class="saved-state" role="status">Сохранено · ${fmtDay(todayItem.day)}</div><p class="entry-text">${esc(todayItem.text)}</p>
      <button data-on="click:editGratitude-a0" data-a0="${todayItem.id}" type="button" class="text-action">Изменить запись</button>`:
      `<div class="field"><label for="gr-text">Моя благодарность</label><textarea data-on="input:gratitudeDraft-value" id="gr-text" maxlength="2000" placeholder="Маме — за звонок. Себе — за то, что нашла время на прогулку">${esc(gratitudeDraft)}</textarea></div>
      <button data-on="click:saveGratitude" type="button" class="btn sm" ${gratitudeSaving?'disabled':''}>${gratitudeSaving?'Сохраняем…':'Сохранить'}</button>
      ${todayItem?`<button data-on="click:gratitudeEdit-null-gratitudeDraft-paintGratitude" type="button" class="text-action secondary">Отмена</button>`:''}`}</div>
    ${todayItem && !editing?actionsHtml(id,true):''}
    ${r.items.filter(i=>i.id!==todayItem?.id).length?moreBlock(r.items.filter(i=>i.id!==todayItem?.id).slice(0,30).map(i=>`<div class="item"><small>${fmtDay(i.day)}</small><p class="entry-text">${esc(i.text)}</p></div>`).join(''),'Прошлые благодарности'):'<p class="hint">Запись остается здесь и в Дневнике, вместе с датой</p>'}`;
  gratitudeHomeStatus(!!todayItem);
  paintRem('gratitude');preparePending();
}
async function saveGratitude(){
  const text=($('gr-text')?.value||'').trim();if(text.length<3){toast('Напишите хотя бы пару слов');return;}
  if(gratitudeSaving)return;gratitudeSaving=true;
  const button=$('gr-box').querySelector('button[data-on="click:saveGratitude"]');button.disabled=true;button.textContent='Сохраняем…';
  try {
    const edit=gratitudeEdit;
    const r=await api('/journal',{method:edit?'PATCH':'POST',body:JSON.stringify({id:edit,text,kind:'gratitude',title:gratQ()})});
    const item={...(S.grat.items.find(i=>i.id===edit)||{}),...r.item,kind:'gratitude',title:gratQ()};
    S.grat.items=[item,...S.grat.items.filter(i=>i.id!==item.id)];
    gratitudeEdit=null;gratitudeDraft='';toast('Запись сохранена');hap('ok');paintGratitude();
  } catch(e){toast('Не удалось сохранить. Текст остался в поле');button.disabled=false;button.textContent='Сохранить';}
  finally{gratitudeSaving=false;}
}

/* ══════════ Дневник привычек: своя регулярность, карточка дня, награды за 30 · 60 · 90 · 180 · 365 ══════════ */
let HB = null, hbEditing = null;
const RULE_CHIPS = ['каждый день', 'по будням', 'по выходным', 'через день', 'раз в неделю', '3 раза в неделю', 'раз в месяц'];
async function loadHabits(){
  const box = $('hb-box'); if (!HB) box.innerHTML = LOADING;
  await loadCatalog().catch(() => {});
  try { const r = await api('/habits'); HB = r.items; paintHabits(); }
  catch (e) { box.innerHTML = LOAD_ERR; }
}
let habitView='today',habitFormOpen=false,habitDraft={title:'',rule:''};
const habitBusy=new Set(),habitEditDrafts={};
function habitTab(view){habitView=view;hbEditing=null;paintHabits();focusSelectedTab('Дневник привычек');}
function habitEdit(id){habitView='all';habitFormOpen=false;hbEditing=id;paintHabits();$('hb-t-'+id)?.focus();}
function habitNew(){habitFormOpen=!habitFormOpen;if(habitFormOpen)hbEditing=null;paintHabits();if(habitFormOpen)$('hb-new')?.focus();}
function habitCancelEdit(id){delete habitEditDrafts[id];hbEditing=null;paintHabits();}
function habitProgress(h){
  if(h.rule==='free')return `Отмечено ${h.total} ${plural(h.total,'раз','раза','раз')}`;
  if(!h.streak)return 'Пока нет серии';
  const unit=h.rule==='monthly'||h.rule.startsWith('mtimes:')?['месяц','месяца','месяцев']
    :h.rule==='weekly'||h.rule.startsWith('times:')?['неделя','недели','недель']
    :h.rule==='daily'?['день','дня','дней']:['выполнение','выполнения','выполнений'];
  return `${h.streak} ${plural(h.streak,...unit)} подряд`;
}
function paintHabits(){
  const box=$('hb-box'),today=S.day.date,due=HB.filter(h=>h.due),done=due.filter(h=>h.today).length;
  const id=HB.length?regRes({type:'habits',items:HB,day:today}):'';
  const items=habitView==='today'?due:HB,formOpen=habitFormOpen||!HB.length;
  const row=h=>`<div class="item hb${h.today?' on':''}${hbEditing===h.id?' editing':''}" data-habit="${h.id}">
    <button data-on="click:habitMark-a0" data-a0="${h.id}" type="button" class="hb-check" aria-label="${h.today?'Снять отметку':'Отметить'}: ${esc(h.title)}" aria-pressed="${h.today}" ${habitBusy.has(h.id)?'disabled':''}>${h.today?'✓':''}</button>
    <div class="grow"><b class="hb-columns"><span>${esc(h.title)}</span><span class="hb-rule">${esc(h.ruleText||h.ruleLabel)}</span></b>
      <small class="habit-progress">${habitProgress(h)}</small>
      ${habitView==='all'?`<div class="hd-row">${h.week.map(w=>`<button data-on="click:habitMark-a0-a1" data-a0="${h.id}" data-a1="${w.day}" type="button" class="hd${w.done?' on':''}${w.due?' planned':' rest'}${w.day===today?' today':''}" data-due="${w.due}" aria-label="${fmtDay(w.day)}: ${w.done?'отмечено':w.due?'запланировано, не отмечено':'свободный день'}" title="${w.due?'Запланировано':'Свободный день'}" aria-pressed="${w.done}"><span>${WD_SHORT[wdIdx(w.day)]}</span></button>`).join('')}</div>`:''}
      ${hbEditing===h.id?`<div class="hb-edit"><div class="field"><label for="hb-t-${h.id}">Название</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-titl" data-a0="${h.id}" data-a1="${h.id}" id="hb-t-${h.id}" value="${esc(habitEditDrafts[h.id]?.title??h.title)}" maxlength="80"></div>
        <div class="field"><label for="hb-r-${h.id}">Регулярность — своими словами</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-rule" data-a0="${h.id}" data-a1="${h.id}" id="hb-r-${h.id}" value="${esc(habitEditDrafts[h.id]?.rule??(h.ruleText||h.ruleLabel))}" maxlength="60" list="rule-ideas"></div>
        <button data-on="click:habitSave-a0" data-a0="${h.id}" type="button" class="btn sm">Сохранить</button><div class="utility-actions"><button data-on="click:habitCancelEdit-a0" data-a0="${h.id}" type="button" class="text-action secondary">Отмена</button><button data-on="click:habitRemove-a0" data-a0="${h.id}" type="button" class="text-action secondary">Убрать привычку</button></div></div>`:''}
    </div>${habitView==='all' && hbEditing!==h.id?`<button data-on="click:habitEdit-a0" data-a0="${h.id}" type="button" class="text-action icon-action" aria-label="Изменить: ${esc(h.title)}">✎</button>`:''}</div>`;
  box.innerHTML=`<div class="segmented" role="tablist" aria-label="Дневник привычек"><button data-on="click:habitTab-today" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='today'}">Сегодня</button><button data-on="click:habitTab-all" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='all'}">Все привычки</button></div>
    <div id="habit-list" role="tabpanel" aria-label="${habitView==='today'?'Сегодня':'Все привычки'}">
      <p class="practice-progress" role="status">${!HB.length?'Добавьте первую привычку':habitView==='all'?'Мои привычки':!due.length?'На сегодня ничего не запланировано':done===due.length?'Все на сегодня отмечено ✓':'Отмечено '+done+' из '+due.length}</p>
      <div class="list">${items.map(row).join('')}</div>
      ${habitView==='all'&&items.some(h=>h.week.some(w=>!w.due))?'<p class="hint habit-calendar-key">Пунктир — свободный день. При необходимости его тоже можно отметить</p>':''}
    </div>
    ${HB.length?`<button data-on="click:habitNew" type="button" class="text-action add-action" aria-expanded="${formOpen}" aria-controls="hb-new-form">${formOpen?'Закрыть добавление':'+ Добавить привычку'}</button>`:''}
    <div id="hb-new-form" class="card practice-card" ${formOpen?'':'hidden'}><h3>Новая привычка</h3><div class="hb-entry">
      <div class="field"><label for="hb-new">Что прививаю</label><input data-on="input:habitDraft-title-value" id="hb-new" placeholder="Например: 10 000 шагов" maxlength="80" value="${esc(habitDraft.title)}" list="hb-ideas"><datalist id="hb-ideas">${(CAT?.habitIdeas||[]).map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="hb-rule">Как часто — своими словами</label><input data-on="input:habitDraft-rule-value" id="hb-rule" placeholder="Каждый день, каждые 3 дня…" maxlength="60" value="${esc(habitDraft.rule)}" list="rule-ideas"></div></div>
      <div class="chips flow">${RULE_CHIPS.map(t=>`<button data-on="click:habitDraft-rule-this-textContent-hb-rule-value-habitDraf" type="button" class="chip">${t}</button>`).join('')}</div><datalist id="rule-ideas">${RULE_CHIPS.map(t=>`<option value="${t}">`).join('')}</datalist>
      <p class="hint">Можно указать свой ритм. Если он не распознан, отмечайте привычку в удобные вам дни</p><button data-on="click:habitAdd" type="button" class="btn sm">Добавить</button></div>
    ${HB.length?actionsHtml(id,true):''}`;
  habitsHomeStatus(HB);paintRem('habits');preparePending();
}

async function habitAdd(){
  const title = ($('hb-new').value || '').trim(), rule = ($('hb-rule').value || '').trim();
  if (title.length < 2) { toast('Назовите привычку'); return; }
  try { const r = await api('/habits', { method: 'POST', body: JSON.stringify({ title, rule }) }); HB = r.items; habitDraft={title:'',rule:''};habitFormOpen=false; hap(); paintHabits(); }
  catch (e) { toast(e.code === 'too_many' ? 'Двадцать привычек — уже много. Уберите одну.' : 'Не получилось добавить'); }
}
async function habitSave(id){
  const title = ($('hb-t-' + id).value || '').trim(), rule = ($('hb-r-' + id).value || '').trim();
  try { const r = await api('/habits', { method: 'PATCH', body: JSON.stringify({ id, title, rule }) }); HB = r.items; delete habitEditDrafts[id]; hbEditing = null; hap(); paintHabits(); toast('Привычка сохранена'); }
  catch (e) { toast('Не получилось сохранить'); }
}
async function habitMark(id, day){
  if(habitBusy.has(id))return;habitBusy.add(id);
  try {
    const r = await api('/habits', { method: 'PATCH', body: JSON.stringify({ id, day }) }); HB = r.items; hap('ok'); paintHabits();
  } catch (e) { toast('Не получилось отметить'); }
  finally{habitBusy.delete(id);document.querySelectorAll('[data-habit="'+id+'"] .hb-check').forEach(b=>b.disabled=false);}
}
async function habitRemove(id){
  if (!confirm('Убрать привычку из списка? Отметки сохранятся в истории.')) return;
  try { const r = await api('/habits?id=' + id, { method: 'DELETE' }); HB = r.items; delete habitEditDrafts[id]; hbEditing = null; paintHabits(); } catch (e) { toast('Не получилось'); }
}

/* ══════════ Взять аскезу: отказ до выбранной даты, счет дней, заметки по желанию ══════════ */
let AS = null, askForm = {};
async function loadAskesis(){
  const box = $('as-box'); if (!AS) box.innerHTML = LOADING;
  await loadCatalog().catch(() => {});
  try { AS = await api('/askesis'); paintAskesis(); }
  catch (e) { box.innerHTML = LOAD_ERR; }
}
const askNoteDrafts={},askNoteOpen={};
function toggleAskPanel(event,summary,key){
  event.preventDefault();const panel=summary.parentElement;panel.open=!panel.open;askPanelToggle(panel,key);
}
function askPanelToggle(el,key){
  if(!el.isConnected)return;
  if(el.open){
    document.querySelectorAll('#as-box .observation,#as-box .practice-create').forEach(other=>{if(other!==el)other.open=false;});
    Object.keys(askNoteOpen).forEach(id=>askNoteOpen[id]=false);askForm.open=false;
  }
  if(key==='new')askForm.open=el.open;else askNoteOpen[key]=el.open;
}
function paintAskesis(){
  const box=$('as-box'),today=S.day.date;
  const active=AS.active.map(a=>{
    const id=regRes({type:'askesis',a,day:today});
    return `<div class="card practice-card">
      <h3 class="practice-question">${esc(a.title)}</h3>
      <p class="practice-progress">${a.left===0?'Сегодня последний день':`Осталось ${a.left} ${plural(a.left,'день','дня','дней')}`} · до ${ruDate(a.until)}</p>
      <div class="bar" role="progressbar" aria-label="Срок аскезы" aria-valuemin="0" aria-valuemax="${a.total}" aria-valuenow="${a.done}"><i style="width:${Math.round(a.done/a.total*100)}%"></i></div>
      ${a.today?`<div class="saved-state" role="status">Наблюдение сохранено · ${fmtDay(today)}</div><p class="entry-text">${esc(a.today.text)}</p>`:''}
      <details data-on="toggle:askPanelToggle-this-a0" data-a0="${a.id}" class="observation" ${askNoteOpen[a.id]?'open':''}>
        <summary data-on="click:toggleAskPanel-event-this-a0" data-a0="${a.id}">${a.today?'Изменить наблюдение':'Добавить наблюдение'}</summary>
        <div class="field"><label for="as-note-${a.id}">Что заметила сегодня · необязательно</label><textarea data-on="input:askNoteDrafts-a0-value" data-a0="${a.id}" id="as-note-${a.id}" maxlength="500" placeholder="Несколько слов о своем опыте…">${esc(askNoteDrafts[a.id]??a.today?.text??'')}</textarea></div>
        <button data-on="click:askNote-a0" data-a0="${a.id}" type="button" class="btn sm">Сохранить наблюдение</button>
      </details>
      ${a.notes.length?moreBlock(a.notes.slice().reverse().map(n=>`<p><small>${fmtDay(n.day)}</small><br>${esc(n.text)}</p>`).join(''),`Мои наблюдения · ${a.notes.length}`):''}
      ${actionsHtml(id,true)}<div class="utility-actions"><button data-on="click:askMove-a0-a1" data-a0="${a.id}" data-a1="${a.until}" type="button" class="text-action secondary">Передвинуть дату</button><button data-on="click:askStop-a0" data-a0="${a.id}" type="button" class="text-action secondary">Завершить досрочно</button></div>
    </div>`;
  }).join('');
  const f=askForm.new||{title:'',until:''};
  const form=`<p>Отказ или ограничение до дня, который вы выберете сами.</p>
    ${(CAT?.askesisIdeas||[]).length?`<details class="practice-ideas"><summary>Примеры аскез</summary><div class="chips flow">${CAT.askesisIdeas.map(t=>`<button data-on="click:askPick-this-textContent" type="button" class="chip">${esc(t)}</button>`).join('')}</div></details>`:''}
    <div class="field"><label for="as-title">От чего отказываюсь или что ограничиваю</label><input data-on="input:askForm-new-Object-assign-askForm-new-title-value" id="as-title" maxlength="80" placeholder="Например: без шоппинга" value="${esc(f.title)}"></div>
    <div class="field"><label for="as-until">До какого дня</label><input data-on="change:askForm-new-Object-assign-askForm-new-until-value" id="as-until" type="date" min="${today}" value="${esc(f.until)}"></div>
    <div class="chips flow ask-quick-dates" aria-label="Быстрый выбор срока">${[['Неделя',7],['2 недели',14],['Месяц',30],['40 дней',40],['До конца года',0]].map(([label,n])=>`<button data-on="click:askQuick-a0" data-a0="${n}" type="button" class="chip">${label}</button>`).join('')}</div>
    <button data-on="click:askStart" type="button" class="btn">Взять аскезу</button>`;
  box.innerHTML=active+(AS.active.length<5?(AS.active.length?`<details data-on="toggle:askPanelToggle-this-new" class="practice-create" ${askForm.open?'open':''}><summary data-on="click:toggleAskPanel-event-this-new">Добавить аскезу</summary><div class="card practice-card">${form}</div></details>`:`<div class="card practice-card">${form}</div>`):'')+
    (AS.past.length?`<span class="eyebrow mt-5">Прошлые</span><div class="list">${AS.past.map(a=>`<div class="item"><b>${esc(a.title)}</b><small>${fmtDay(a.started)} — ${fmtDay(a.finished||a.until)} · ${a.status==='done'?'пройдена до конца':'завершена досрочно'}</small>${a.notes.length?moreBlock(a.notes.map(n=>`<p><small>${fmtDay(n.day)}</small><br>${esc(n.text)}</p>`).join(''),'Мои наблюдения'):''}</div>`).join('')}</div>`:'');
  askesisHomeStatus(AS);paintRem('askesis');preparePending();
}
function askPick(text){
  $('as-title').value=text;askForm.new=Object.assign(askForm.new||{},{title:text});
  $('as-title').focus();hap();
}
function askQuick(days){
  // The end date is inclusive: a week begun today ends on its seventh day.
  const until=days?new Date(Date.parse(S.day.date+'T12:00:00Z')+(days-1)*864e5).toISOString().slice(0,10):S.day.date.slice(0,4)+'-12-31';
  $('as-until').value=until;askForm.new=Object.assign(askForm.new||{},{until});hap();
}
async function askStart(){
  const title = ($('as-title').value || '').trim(), until = $('as-until').value;
  if (title.length < 2) { toast('Назовите аскезу'); return; }
  if (!until) { toast('Выберите, до какого дня'); return; }
  try { AS = await api('/askesis', { method: 'POST', body: JSON.stringify({ title, until }) }); askForm.new = null;askForm.open=false; hap('done'); toast('Аскеза взята — мы рядом ✦'); paintAskesis(); refreshNativeAskesis(); }
  catch (e) { toast(e.code === 'bad_until' ? 'Дата должна быть не раньше сегодня' : e.code === 'too_many' ? 'Пять аскез сразу — уже много' : 'Не получилось'); }
}
async function askNote(id){
  const note = (($('as-note-' + id) || {}).value || '').trim(); if (!note) { toast('Заметка пустая'); return; }
  try { AS = await api('/askesis', { method: 'PATCH', body: JSON.stringify({ id, note }) }); delete askNoteDrafts[id];askNoteOpen[id]=false; hap('ok'); toast('Заметка сохранена'); paintAskesis(); }
  catch (e) { toast('Не получилось сохранить'); }
}
let askDateId=null;
function askMove(id,cur){
  askDateId=id;openWidget('askDate');$('ask-date').value=cur;$('ask-date').min=S.day.date;$('ask-date-msg').textContent='';$('ask-date').removeAttribute('aria-invalid');
}
async function saveAskDate(){
  const input=$('ask-date'),msg=$('ask-date-msg'),button=$('ask-date-save'),id=askDateId,until=input.value;
  if(!until||until<S.day.date){msg.textContent='Выберите дату не раньше сегодня';input.setAttribute('aria-invalid','true');input.focus();return;}
  if(button.disabled)return;button.disabled=true;button.textContent='Сохраняем…';input.removeAttribute('aria-invalid');
  try{AS=await api('/askesis',{method:'PATCH',body:JSON.stringify({id,until})});paintAskesis();refreshNativeAskesis();if(wgOpen==='askDate'&&askDateId===id)closeWidget();toast('Дата сохранена');}
  catch(e){msg.textContent=e.code==='bad_until'?'Дата должна быть не раньше сегодня':'Не удалось сохранить. Выбранная дата осталась в поле';}
  finally{button.disabled=false;button.textContent='Сохранить дату';}
}
async function askStop(id){
  if (!confirm('Завершить аскезу досрочно? Она останется в прошлых.')) return;
  try { AS = await api('/askesis?id=' + id, { method: 'DELETE' }); paintAskesis(); refreshNativeAskesis(); } catch (e) { toast('Не получилось'); }
}

/* ══════════ Желания с фото для визуализации ══════════ */
function renderWishes(r){
  updatePracticeStatus('wishes',r.items.length?r.items.filter(w=>!w.done).length+' желаний':'Фото и планы');
  const html = r.items.map(w => `<article class="wish-card">
    ${w.photo?`<button data-on="click:showWishPhoto-a0-a1" data-a0="${w.id}" data-a1="${encodeURIComponent(w.photoTs)}" class="wish-picture" type="button" aria-label="Открыть фото желания: ${esc(w.text)}"><img src="/app/api/wishes/photo?id=${w.id}&t=${encodeURIComponent(w.photoTs)}" alt="${esc(w.text)}" loading="lazy"></button>`:`<button data-on="click:wishPhoto-a0" data-a0="${w.id}" class="wish-picture" type="button">＋ Добавить фото</button>`}
    <div class="wish-copy"><p>${esc(w.text)}</p><button data-on="click:toggleWish-a0" data-a0="${w.id}" class="${w.done?'text-action':'btn ghost sm'}" type="button" aria-pressed="${!!w.done}">${w.done?'✓ Сбылось · отменить отметку':'Сбылось'}</button>${w.photo?`<button data-on="click:wishPhoto-a0" data-a0="${w.id}" class="text-action secondary" type="button">Заменить фото</button>`:''}</div></article>`).join('')
    || '<p class="hint">Запишите желание, к нему можно добавить фото для визуализации</p>';
  $('m-wishes').innerHTML = html;
}
/* картинка уменьшается прямо в телефоне до нужной стороны и уходит как jpeg */
function pickImage(maxSide, quality){
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';
    inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'; document.body.appendChild(inp);
    const done = (v) => { inp.remove(); resolve(v); };
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return done(null);
      const draw = (w, h, src) => { const k = Math.min(1, maxSide / Math.max(w, h)), cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k); cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', quality); };
      try { if (window.createImageBitmap) { const bm = await createImageBitmap(f); const out = draw(bm.width, bm.height, bm); bm.close && bm.close(); return done(out); } } catch (e) { /* формат не читается — пробуем через Image */ }
      const im = new Image(); const url = URL.createObjectURL(f);
      im.onload = () => { const out = draw(im.width, im.height, im); URL.revokeObjectURL(url); done(out); };
      im.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось прочитать файл — выберите JPG, PNG или скриншот'); done(null); };
      im.src = url;
    };
    inp.click();
  });
}
async function wishPhoto(id){
  const photo = await pickImage(900, 0.82); if (!photo) return;
  try { const r = await api('/wishes/photo', { method: 'POST', body: JSON.stringify({ id, photo }) }); renderWishes(r); toast('Фото добавлено ✦'); }
  catch (e) { toast(e.status === 413 ? 'Фото слишком большое — попробуйте другое' : 'Не получилось загрузить фото'); }
}
function showWishPhoto(id, t){
  $('pc-img').src = `/app/api/wishes/photo?id=${id}&t=${t}`; $('pc').classList.add('on');
  $('pc-hint').innerHTML = `<button data-on="click:removeWishPhoto-a0" data-a0="${id}" class="btn ghost sm" type="button">Убрать фото</button>`;
}
async function removeWishPhoto(id){ try { const r = await api('/wishes/photo?id=' + id, { method: 'DELETE' }); hidePostcard(); renderWishes(r); } catch (e) { toast('Не получилось'); } }

/* ══════════ Фото в аккаунте — кружок в правом верхнем углу главной, по нему же открывается «Аккаунт» ══════════ */
const photoUrl = (u) => u && u.photo ? `/app/api/photo?t=${encodeURIComponent(u.photoTs || '')}` : '';
function paintAvatar(){
  const u = S.user, letter = (u.name || '').trim().charAt(0).toUpperCase() || '✦';
  document.querySelectorAll('.acct').forEach(el=>{el.innerHTML = `<span class="acct-content">${u.photo ? `<img src="${photoUrl(u)}" alt="">` : esc(letter)}</span><i class="news-dot" hidden aria-hidden="true"></i>`;}); paintNewsDot();
  const box = $('ac-photo'); if (box) box.innerHTML = `<div class="avatar">${u.photo ? `<img src="${photoUrl(u)}" alt="">` : letter}</div>`;
  const actions = $('ac-photo-actions'); if (actions) actions.innerHTML = `<button data-on="click:setPhoto" class="text-action" type="button">${u.photo ? 'Заменить фото' : 'Загрузить фото'}</button>${u.photo ? '<button data-on="click:removePhoto" class="text-action secondary" type="button">Убрать фото</button>' : ''}`;
  const note = $('ac-photo-note'); if (note) note.hidden = !!u.photo;
}
async function setPhoto(){
  const photo = await pickImage(320, 0.85); if (!photo) return;
  try { const r = await api('/photo', { method: 'POST', body: JSON.stringify({ photo }) }); S.user = Object.assign(S.user, r.user); paintAvatar(); toast('Фото сохранено ✦'); }
  catch (e) { toast(e.status === 413 ? 'Фото слишком большое — попробуйте другое' : 'Не получилось загрузить фото'); }
}
async function removePhoto(){ try { const r = await api('/photo', { method: 'DELETE' }); S.user = Object.assign(S.user, r.user); paintAvatar(); } catch (e) { toast('Не получилось'); } }

/* ══════════ Новое в приложении: плитки ведут в сами разделы, дублировать нечего. Список — content/новое.txt ══════════ */
function featureRoot(key){
  if(!/^[a-z][a-z0-9-]*$/.test(key||''))return null;
  return document.querySelector('[data-feature="'+key+'"]')
    ||document.querySelector('.app-nav [data-nav="'+(Object.hasOwn(VIEW_ALIASES,key)?VIEW_ALIASES[key]:key)+'"]')
    ||document.querySelector('button[data-on="click:openWidget-'+key+'"]');
}
async function paintNews(){
  const box = $('news-box'); box.innerHTML = LOADING;
  try { await loadCatalog(); } catch(e) {}
  const month = S.day.date.slice(0,7);
  $('news-sub').textContent = monthName(month).replace(/^./,c=>c.toUpperCase());
  const news = CAT?.news || [], keys = new Set(news.filter(n=>n.month===month).map(n=>n.widget || n.view));
  const soon = news.filter(n=>n.soon);
  $('news-soon').hidden = !soon.length;
  $('news-soon-box').innerHTML = soon.map(n=>`<div class="item"><b>${esc(n.title)}</b><small>${esc(n.text)}</small></div>`).join('');
  box.replaceChildren();
  for(const key of keys){
    const root = featureRoot(key); if(!root) continue;
    const tile = key==='around'?document.querySelector('[data-feature="lunar"]').cloneNode(true):root.cloneNode(true); tile.className='wid'; tile.hidden=false; tile.removeAttribute('id'); tile.removeAttribute('data-on'); tile.removeAttribute('style');   /* обработчик клона — свой, ниже */
    const section=root.dataset.nav||(root.dataset.feature==='account'?'account':'');   /* раздел: вкладка внизу или «Аккаунт» по кружку с фото */
    if(section){
      tile.replaceChildren();const icon=root.querySelector('.ico');const i=document.createElement('i');i.className=icon?icon.className:'ico person';tile.appendChild(i);
      const title=document.createElement('b');title.textContent=root.dataset.nav?root.textContent.trim():$('v-'+section).querySelector('h1').textContent.trim();tile.appendChild(title);
      const caption=$('v-'+section)?.querySelector('.eyebrow');if(caption){const sub=document.createElement('span');sub.textContent=caption.textContent;tile.appendChild(sub);}
    }
    tile.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    tile.querySelectorAll('canvas').forEach(el=>{const icon=document.createElement('i');icon.className='ico moon';el.replaceWith(icon);});
    tile.removeAttribute('data-feature');tile.removeAttribute('data-nav');tile.removeAttribute('aria-current');tile.dataset.newsTarget=key;
    tile.onclick=()=>{const current=featureRoot(key);if(!current)return;if(current.dataset.nav){current.click();return;}go(current.closest('.view')?.id.slice(2)||'home');if(key==='around')current.scrollIntoView({behavior:'smooth',block:'start'});else current.click();};
    box.appendChild(tile);
  }
  if(!box.children.length) box.innerHTML='<p class="hint">В этом месяце новинок еще не было</p>';
  markNewsSeen(); track('news_view');
}

/* снимок последнего удачного /me — только для аккаунта, который уже прошел анкету, и не старше суток */
function offlineSnapshot(){
  try { const s = JSON.parse(localStorage.getItem('lun_me') || 'null'); return s && s.r?.user?.onboarded && Date.now() - s.at < 26 * 3600e3 ? s : null; } catch(e) { return null; }
}
/* часы в статус-баре корпуса телефона (только на компьютере, декоративные) */
function frameClock(){const el=$('frame-clock');if(!el)return;const tick=()=>{el.textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});};tick();setInterval(tick,15000);}
frameClock();
/* ── старт ── */
function startApp(){
  const initialPractice=new URLSearchParams(location.search).get('practice');
  paintHome(); paintToday(); go(initialPractice==='journal'?'history':'home');
  if(FEATURES[initialPractice]?.page)openPractice(initialPractice); refreshNativeAskesis();
  if (S.day.card && S.day.cardOpened) { showFlipped(); $('t-after').style.display = 'block'; }   /* карту уже открывали — она в истории; вытянутую утром еще предстоит перевернуть */
  loadCatalog().then(() => { renderMoods(); applyTools(); if (S.flipped) { paintCard(); preparePending(); } if (wgOpen === 'ask') renderLayouts(); if (wgOpen === 'tools') paintTools(); }).catch(() => {});
  /* из уведомления приходят сразу в нужный раздел */
  try {
    const view = new URLSearchParams(location.search).get('view') || '';   /* ?view=ask|history|about — открыть вкладку (проверки, скриншоты) */
    if (['home', 'ask', 'history', 'about', 'account'].includes(view)) { go(view); history.replaceState(null, '', location.pathname); }
    const openKey = new URLSearchParams(location.search).get('open') || '', target = openTarget(openKey);
    if (target) {
      go(target[0]); if (target[1]) openWidget(target[1]); history.replaceState(null, '', location.pathname); track('push_open', openKey);
      if (openKey === 'today' || openKey === 'morning') setTimeout(() => {   /* из утреннего уведомления — к своему утру, первая плитка подсвечена (после восстановления прокрутки в go) */
        const feed = $('home-sky'); if (!feed || feed.hidden) return;
        scrollToTop(feed.getBoundingClientRect().top + scrollTopNow() - 16);   /* сразу, без плавности: страница могла еще не стать видимой */
        const t = feed.querySelector('[data-feature]'); if (t) { t.classList.add('from-push'); setTimeout(() => t.classList.remove('from-push'), 1800); }
      }, 250);
    }
  } catch (e) {}
}
(async function(){
  if('serviceWorker' in navigator) ensurePushWorker().catch(()=>{});
  let r;
  try{
    try { r = await api('/me'); try { localStorage.setItem('lun_me', JSON.stringify({ at: Date.now(), r })); } catch(e) {} }
    catch(e){   /* нет связи (а не отказ сервера) — сегодняшний пакет дня не меняется до полуночи, показываем последний сохраненный */
      const snap = (!e.status && offlineSnapshot()) || null; if (!snap) throw e;
      r = snap.r; S.offlineAt = snap.at;
    }
    S.user=r.user; S.day=r.day; S.mood=r.mood; S.limits=r.limits; S.mailReady=!!r.mailReady; S.localPreview=!!r.localPreview; S.catalogV=r.catalogV||1;initExperience(r.preferences);
    if (S.offlineAt) { const n = $('offline-note'); if (n) { n.hidden = false; n.textContent = `Без связи · показываем то, что было на ${new Date(S.offlineAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${r.day?.date !== new Date().toLocaleDateString('sv-SE') ? ', ' + fmtDay(r.day?.date) : ''}`; } }
    try{ if(r.user&&r.user.lat!=null) window.LunarioSky?.setProfile({lat:r.user.lat,lon:r.user.lon,name:r.user.city||''}); }catch(e){}
    registerWebMcp();
    try{ if(/[?&]app=1/.test(location.search)) localStorage.setItem('lun_app','1'); }catch(e){}
    if(isStaff(r.user) && !inApp()){ location.replace('/app/cabinet'); return; }
    track('app_open');
    try{
      const qs = new URLSearchParams(location.search), utm = {};
      for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) if (qs.get(k)) utm[k] = qs.get(k);
      if (Object.keys(utm).length) { utm.ref = document.referrer.slice(0, 120); await api('/utm',{method:'POST',body:JSON.stringify(utm)}); if (!qs.get('ref')) history.replaceState(null,'',location.pathname + (qs.get('app') ? '?app=1' : '')); }
    }catch(e){}
    if (r.supportUnread) { const d = $('h-supdot'); if (d) d.hidden = false; }
    const ref = new URLSearchParams(location.search).get('ref');
    try{
      if (ref && /^[a-z0-9]{6,12}$/i.test(ref)) {
        const inv = await api('/invite',{method:'POST',body:JSON.stringify({code:ref})});
        if (inv.ok) setTimeout(()=>toast(`Подарок от ${inv.from || 'подруги'}: четыре разбора в день на неделю`), 1200);   /* событие invite_used пишет сервер */
        history.replaceState(null,'',location.pathname);
      }
    }catch(e){ /* ссылка старая — просто открываем приложение */ }
    if(r.day && typeof r.day.moonPhase==='number') moonSetPhase(r.day.moonPhase);
    if(!r.user.onboarded){ go('hello'); track('intro_view'); if(S.mailReady) $('hello-login').style.display='block'; return; }
    startApp();
    paintMoodStat(r.moodStats);
  }catch(e){ go('hello'); }
})();
