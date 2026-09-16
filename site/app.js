const $ = (id) => document.getElementById(id);
const API = '/app/api';
let S = { user:null, day:null, mood:null, limits:null, mode:'yesno', flipped:false, num:null };
/* iOS-оболочка: класс выставлен скриптом в head. Сообщения к нативному слою идут
   через мост WebKit; try/catch закрывает и его отсутствие (обычный браузер). */
const IOS_SHELL = document.documentElement.className.indexOf('ios-shell') !== -1;
function nativePost(m){ try{ window.webkit.messageHandlers.lunario.postMessage(m); return true; }catch(e){ return false; } }
const api = async (path, opts) => {
  const r = await fetch(API + path, Object.assign({ headers:{'Content-Type':'application/json'} }, opts));
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
const COMMAND_SELECTOR = '.wid,.quick-actions button,.day-focus,.app-nav button,.moonline';
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
  lightTarget=e.target.closest('.app-nav,.rem-summary,.acct,.wg-x,.day-focus,.wid,.moonline,.quick-actions button,.welcome-primary,.timeline-entry,.timeline-empty,.profile-summary,.wish-card'); lightEvent=e;
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
/* Вибрация: tap — нажатие, ok — сохранено, done — шаг завершён, award — награда */
const HAP = { tap: 9, ok: [0, 12], done: [0, 14, 45, 22], award: [0, 20, 60, 30, 60, 40] };
function hap(kind = 'tap'){
  // в оболочке вибрация идёт через Taptic Engine — navigator.vibrate на iOS не работает
  if (IOS_SHELL && nativePost({ type:'haptic', kind: kind === 'tap' ? 'tap' : 'success' })) return;
  try{ if(navigator.vibrate) navigator.vibrate(HAP[kind] || HAP.tap); }catch(e){}
}
const esc = (s) => String(s).replace(/[<>&"']/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

/* ── навигация: четыре вкладки внизу (home, ask, history, about); account и news открываются с главной по кружку с фото
   и вкладку не подсвечивают ── */
const INNER_VIEWS=['home','ask','history','about','account','news'];
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

/* ── реестр функций: раздел и название панели, где живёт (view), полноэкранная практика (page), ключ напоминания (reminder).
   Отсюда — заголовки, строка уведомлений под заголовком, полный экран и переход по ?open= из уведомления. ── */
const FEATURES = {
  card:{sec:'Ваш ритуал',title:'Карта дня',view:'home',reminder:'card'}, mood:{sec:'Сегодня',title:'Настроение дня',view:'home',reminder:'mood'},
  day:{sec:'Сегодня',title:'Прогноз дня',view:'home'}, tone:{sec:'Сегодня',title:'Вопрос дня',view:'home'}, ritual:{sec:'Сегодня',title:'Мой ритуал',view:'home'},
  habits:{sec:'Сегодня',title:'Дневник привычек',view:'home',page:true,reminder:'habits'}, askesis:{sec:'Сегодня',title:'Взять аскезу',view:'home',page:true,reminder:'askesis'},
  lunar:{sec:'Луна и небо',title:'Лунный день',view:'home',reminder:'lunar'}, sky:{sec:'Луна и небо',title:'На небе',view:'home',reminder:'sky'},
  worry:{sec:'Свериться с собой',title:'Разобрать вопрос',view:'ask'}, ask:{sec:'Свериться с собой',title:'',view:'ask'},
  journal:{sec:'Дневник',title:'Дневник',view:'history',page:true}, gratitude:{sec:'Дневник',title:'Дневник благодарности',view:'history',reminder:'gratitude'},
  wishes:{sec:'Дневник',title:'Мои желания',view:'history'}, hmood:{sec:'Дневник',title:'История настроений',view:'history',reminder:'moodreport'},
  hentries:{sec:'Дневник',title:'Мои вопросы и ответы',view:'history'}, week:{sec:'Дневник',title:'Итоги недели',view:'history'}, timelineEntry:{sec:'Дневник',title:'Запись',view:'history'},
  natal:{sec:'Обо мне',title:'Натальная карта',view:'about'}, year:{sec:'Обо мне',title:'Личный год',view:'about'}, birthnum:{sec:'Обо мне',title:'Нумерология',view:'about'}, compat:{sec:'Обо мне',title:'Совместимость',view:'about'},
  tests:{sec:'Обо мне',title:'Тесты',view:'about'},
  remind:{sec:'Аккаунт',title:'Уведомления',view:'account'}, mail:{sec:'Аккаунт',title:'Вход по почте',view:'account'}, edit:{sec:'Аккаунт',title:'Изменить мои данные',view:'account'}, shelves:{sec:'Аккаунт',title:'Мои данные',view:'account'},
  support:{sec:'Аккаунт',title:'Чат поддержки',view:'account'}, invite:{sec:'Аккаунт',title:'Позвать подругу',view:'account'}, appearance:{sec:'Аккаунт',title:'Оформление',view:'account'}, topics:{sec:'Аккаунт',title:'Темы чтения',view:'account'},
  skyplace:{sec:'Аккаунт',title:'Небо над вами',view:'account'}, appinfo:{sec:'Аккаунт',title:'О приложении',view:'account'}, terms:{sec:'Аккаунт',title:'Условия использования',view:'account'},
  practiceSettings:{sec:'',title:'Уведомления'}, askDate:{sec:'Взять аскезу',title:'Передвинуть дату'},
};
/* Цель из ?open= в уведомлении: ключ функции или ключ её напоминания (moodreport → История настроений) */
function openTarget(key){
  if(key==='news')return ['news',''];
  const k=FEATURES[key]?key:Object.keys(FEATURES).find(f=>FEATURES[f].reminder===key);
  return k?[FEATURES[k].view||'home',k]:null;
}
let wgOpen = null, wgFocus = null;
function openWidget(k, title){
  requestAnimationFrame(() => window.refreshMoonLogos?.());
  const f = FEATURES[k], pane = $('w-'+k); if (!f || !pane) return;
  if(f.page){openPractice(k);return;}
  const trigger=document.activeElement;closeWidget();wgFocus=trigger;
  $('wg-eb').textContent = f.sec;$('wg-eb').hidden=f.sec===(title||f.title); $('wg-title').textContent = title || f.title;
  $('wg-body').appendChild(pane); wgOpen = k;
  const feature=f.reminder;
  $('wg-tools').innerHTML=feature?remBox(feature):'';
  if(feature){remEditing[feature]=false;loadReminders().then(()=>paintRem(feature)).catch(()=>{if(wgOpen===k)$('wg-tools').innerHTML='<button data-on="click:openWidget-remind" type="button" class="text-action">Проверить уведомления →</button>';});}
  $('wg').dataset.kind=k;$('wg').classList.add('on'); document.body.classList.add('wg-open');
  requestAnimationFrame(()=>{revealCommands(pane);document.querySelector('.wg-x')?.focus({preventScroll:true});});
  document.querySelector('#wg .wg').scrollTop = 0; hap();
  loadWidgetContent(k);
}
/* Что подгрузить при открытии панели; у виджетов без записи содержимое статично (карта дня рисуется с главной) */
const WIDGET_LOADERS = {
  ritual: () => paintRitual(), appearance: () => paintAppearance(), topics: () => paintTopics(), skyplace: () => paintSkyPlace(),
  journal: () => { loadJournal(); prepareDictation(); requestAnimationFrame(() => growTextarea($('j-text'))); },
  wishes: () => loadWishes(), hentries: () => loadEntries(), week: () => loadWeek(), hmood: () => loadMoodReport(),
  mood: () => { moodUI.precision=false; moodUI.mode='families'; renderMoods(); paintMoodExtra(); },
  habits: () => { habitView='today'; hbEditing=null; habitFormOpen=false; if(HB)paintHabits(); loadHabits(); },
  askesis: () => loadAskesis(), sky: () => loadSky(), lunar: () => paintLunarWidget(), gratitude: () => loadGratitude(), tone: () => paintTone(),
  day: () => { showForecastNote(); track('forecast_view'); }, worry: () => renderHub(), invite: () => loadInvite(), remind: () => paintAllReminders(), edit: () => fillEdit(),
  support: () => supOpen(), natal: () => loadNatal(), mail: () => renderAuth(), shelves: () => loadShelves(), year: () => loadNumerology(), birthnum: () => loadNumerology(),
};
function loadWidgetContent(k){ WIDGET_LOADERS[k]?.(); }
function closeWidget(e){
  if (e && e.target !== $('wg')) return;
  if (!wgOpen) return;
  if(wgOpen==='journal'&&journalSpeech)stopJournalDictation();
  if(wgOpen==='support'){rememberSupportDraft();supStop();}
  $('wg-store').appendChild($('w-'+wgOpen)); wgOpen = null;
  $('wg').classList.remove('on'); document.body.classList.remove('wg-open');$('wg-tools').innerHTML='';
  if(wgFocus?.isConnected)wgFocus.focus({preventScroll:true});wgFocus=null;
  if(XP.page)refreshPracticeReminder();
}
document.addEventListener('keydown',e=>{
  const tabs=e.target.closest('.segmented');
  if(tabs && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    const items=[...tabs.querySelectorAll('[role=tab]')],i=items.indexOf(e.target);
    const next=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;
    e.preventDefault();items[next].click();return;
  }
  if(!wgOpen || $('award').classList.contains('on'))return;
  if(e.key==='Escape'){closeWidget();return;}
  if(e.key!=='Tab')return;
  const items=[...$('wg').querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
  const first=items[0],last=items.at(-1);
  if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
});
function focusSelectedTab(label){document.querySelector('.segmented[aria-label="'+label+'"] [aria-selected="true"]')?.focus({preventScroll:true});}

/* ── натальная карта: расчёт на сервере, здесь только вывод ── */
let natalCache = null;
/* ── «Мои данные»: профиль, практики и история ── */
async function loadShelves(){
  const box = $('sh-box'); box.innerHTML = '<div class="item"><p>Загружаем данные…</p></div>';
  try {
    const s = await api('/shelves');
    const a = s.about, dy = s.day, h = s.history;
    const row = (k, v) => v ? `<div class="sh-row"><span>${k}</span><b>${v}</b></div>` : '';
    const ru = { yesno: '«Да / Нет»', rune: 'руны', runes: 'расклады рун', spread: 'расклады Таро', card: 'карты дня' };
    const about = row('Имя', esc(a.name)) + row('Дата рождения', a.birth ? fmtDay(a.birth) + (a.birthTime ? ' · ' + a.birthTime : '') : '')
      + row('Город', esc(a.city) + (a.region ? `<small> · ${esc(a.region)}</small>` : '')) + row('Знак', a.sign ? `${a.sign.name}${a.sign.element ? ' · ' + a.sign.element : ''}` : '')
      + row('Число судьбы', a.destiny ? `${a.destiny.n} · ${esc(a.destiny.title)}` : '')
      + row('Личный год', a.year ? `${a.year.n}${a.year.energy ? ' · ' + esc(a.year.energy) : ''}<small> с ${fmtDay(a.year.from)} по ${fmtDay(dayBefore(a.year.to))}</small>` : '')
      + row('Натальная карта', a.natal && a.natal.sun ? `☉ ${a.natal.sun}${a.natal.moon ? ` · ☽ ${a.natal.moon}` : ''}${a.natal.asc ? ` · Asc ${a.natal.asc}` : ''}` : '')
      + row('В Лунарио', `с ${fmtDay(a.since)}${a.streak ? ` · серия ${a.streak}` : ''}`) + row('Почта', esc(a.email));
    const wk = dy.week.filter((w) => w.moodRu).map((w) => `${fmtDay(w.day).slice(0, 5)} — ${w.moodRu}`).join(', ');
    const day = row('Настроение', esc(dy.moodRu)) + row('Карта дня', dy.card ? esc(dy.card.name) : '')
      + row('Луна', `${esc(dy.moon || '')}${dy.lunar ? ` · ${dy.lunar.n}-й лунный день` : ''}`) + row('Неделя', esc(wk))
      + row('Дневник', dy.journal.length ? dy.journal.map((j) => `<small>${fmtDay(j.day).slice(0, 5)}</small> ${esc(j.text)}`).join('<br>') : '')
      + row('Желания', dy.wishes.open.length ? esc(dy.wishes.open.join(' · ')) + (dy.wishes.done ? `<small> · исполнено ${dy.wishes.done}</small>` : '') : '')
      + row('Привычки', dy.habits.map((x) => `${esc(x.title)}<small> · ${x.streak} подряд</small>`).join('<br>'))
      + row('Аскезы', dy.askesis.map((x) => `${esc(x.title)}<small> · день ${x.done} из ${x.total}, до ${fmtDay(x.until)}</small>`).join('<br>'));
    const hist = !h.total ? '<p>Обращений пока не было.</p>'
      : row('Всего', `${h.total}<small> · ${Object.entries(h.byKind).map(([k, n]) => `${ru[k] || k} ${n}`).join(', ')}</small>`)
      + row('Темы', esc(h.topics.map((t) => `${t.name} ${t.n}`).join(', '))) + row('Ответы «Да / Нет»', esc(h.verdicts.map((v) => `${v.verdict} ${v.n}`).join(', ')))
      + row('Последние', h.recent.slice(0, 6).map((r) => `<small>${fmtDay(r.day).slice(0, 5)} · ${esc(r.kindRu)}</small> ${r.question ? esc(r.question) + ' → ' : ''}${esc(r.answer)}`).join('<br>'));
    const shelf = (t, sub, body, i) => `<div class="item rise" style="--i:${i}"><b>${t}</b><small>${sub}</small><div class="sh-rows">${body || '<p>Пока пусто.</p>'}</div></div>`;
    box.innerHTML = shelf('Обо мне', 'анкета и то, что из неё считается', about, 0) + shelf('Мой день', `сегодня, ${fmtDay(dy.date)}, и последняя неделя`, day, 1) + shelf('Истории', 'к чему вы возвращаетесь и что вам отвечали', hist, 2)
      + `<p class="hint mt-1">Данные хранятся в России, личные тексты зашифрованы. Обновлено ${s.updated ? fmtWhen(s.updated) : '—'}. Стереть всё — «Очистить историю» в аккаунте.</p>`;
  } catch (e) { box.innerHTML = `<div class="item"><p>${e.code === 'no_birth' ? 'Заполните профиль — здесь появятся ваши данные.' : 'Не получилось загрузить данные, попробуйте позже.'}</p></div>`; }
}
async function loadNatal(){
  const box = $('natal-box');
  try{
    const c = natalCache || (natalCache = await api('/natal'));
    const dms = (p) => `${p.symbol} ${p.deg}°${String(p.min).padStart(2,'0')}′`;
    const planets = c.planets.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.retro ? '<span title="ретроградная">R</span>' : ''}</td></tr>`).join('');
    const points = c.points && c.points.length ? `<h3 class="mt-4">Точки</h3><table class="nt"><thead><tr><th>Точка</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${c.points.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.key === 'node' || p.key === 'snode' ? (p.retro ? '<span title="ретроградный">R</span>' : '<span title="директный">D</span>') : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const houses = c.houses ? `<h3 class="mt-4">Дома · ${esc(c.houses.system)}</h3><table class="nt"><thead><tr><th>Дом</th><th>Куспид</th></tr></thead><tbody>${c.houses.cusps.map((h) => `<tr><td>${h.house}${h.house===1?' · Asc':h.house===10?' · MC':''}</td><td>${dms(h)} <small>${esc(h.signOf)}</small></td></tr>`).join('')}</tbody></table>`
      : `<div class="card mt-3"><p>${!c.timeKnown ? 'Без времени рождения дома, Асцендент и MC не считаются — положения планет по знакам верны' + (c.moonUncertain ? ', а Луна за этот день перешла границу знака: её знак зависит от времени' : '') + '. ' : ''}${!c.hasPlace ? (c.city ? `Город «${esc(c.city)}» не нашёлся в базе — откройте анкету и выберите его из подсказок, по нему считаются дома и часовой пояс. ` : 'Укажите город рождения в аккаунте — по нему считаются дома и часовой пояс. ') : ''}<button data-on="click:closeWidget-go-account-openWidget-edit" class="btn ghost sm mt-3">Дополнить анкету</button></p></div>`;
    const aspects = c.aspects.length ? `<h3 class="mt-4">Аспекты</h3><div class="hbars mt-2">${c.aspects.map((a) => `<div class="l"><span>${esc(a.aName)} ${a.symbol} ${esc(a.bName)} <small class="faint">${esc(a.name)}</small></span><b>орб ${a.orb}°</b></div>`).join('')}</div>` : '';
    const sun = c.planets[0], moon = c.planets[1];
    box.innerHTML = `<div class="card sec"><p class="eyebrow">Западная традиция · тропический зодиак${c.houses ? ' · ' + esc(c.houses.system) : ''}</p>
        <p class="t2">☉ Солнце ${esc(sun.signIn)} · ☽ Луна ${esc(moon.signIn)}${c.houses ? ` · Asc ${esc(c.houses.asc.signIn)}` : ''}</p>
        <p class="hint">${fmtDay(c.input.birth)}${c.timeKnown ? ' ' + c.input.time : ' · время не указано'}${c.city ? ' · ' + esc(c.city) : ''}${c.hasPlace ? ` (${c.input.lat.toFixed(2)}°, ${c.input.lon.toFixed(2)}°)` : ''} · ${esc(c.tzNote || '')} · UTC ${c.input.utc}</p></div>
      <h3 class="mt-4">Планеты</h3><table class="nt"><thead><tr><th>Планета</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${planets}</tbody></table>
      ${points}${houses}${aspects}
      <p class="hint mt-3">${esc(c.precision)} Трактовка карты появится позже — сейчас важно, что расчёт верный.</p>`;
  }catch(e){ box.innerHTML = `<p class="msg err">${e.code==='no_birth' ? 'Укажите дату рождения в анкете — без неё карту не построить.' : 'Не получилось рассчитать карту.'}</p>`; }
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
  }catch(e){ if(supTicket!==id||wgOpen!=='support')return;const msg=$('sup-msg2');if(msg)msg.textContent='Не удалось обновить сообщения. Ваш текст сохранён в поле';else box.innerHTML='<p class="msg err">Не получилось открыть обращение. <button data-on="click:supThread-a0" data-a0="'+id+'" class="text-action">Повторить</button></p>'; }
}
async function supSend(id){
  const text = $('sup-reply').value.trim(), msg = $('sup-msg2'); showMsg(msg); if(!text) return;
  try{ const r = await api('/support/ticket?id='+id,{method:'POST',body:JSON.stringify({text})}); if(!r.ok) throw new Error(r.error); if(supTicket===id&&$('sup-reply')?.value.trim()===text){$('sup-reply').value='';supportDrafts[id]='';growTextarea($('sup-reply'));}hap('ok'); supThread(id); }
  catch(e){ showMsg(msg, 'Не отправилось.', true); }
}

function paintNextStep(){
  if(!S.day||!$('h-next'))return;
  const next=ritualNext(),done=XP.prefs.ritual.filter(ritualDone).length;
  $('h-ritual-practices').textContent=XP.prefs.ritual.map(key=>FEATURES[key].title).join(' · ');
  $('h-next').hidden=!next;if(next)$('h-next').textContent=next.label+' →';
  $('h-progress').classList.toggle('ritual-finished',!next);
  $('h-progress').textContent=next?done+' из '+XP.prefs.ritual.length+' практик':'Ритуал на сегодня завершён';
}
function continueDay(){const next=ritualNext();if(next){go(next.view);openWidget(next.key);}}
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
  try{const data=await api('/data/export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='lunario-'+S.day.date+'.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Файл с вашими данными подготовлен');
  }catch(e){toast('Не удалось скачать данные. Попробуйте ещё раз');}finally{exportPersonalData.busy=false;}
}

/* ── главная ── */
const ordinal = (n) => n + '-й';
function paintHome(){
  const u=S.user, d=S.day;
  const dt=new Date(d.date+'T12:00:00');
  $('h-date').textContent=dt.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
  $('h-wish').textContent = d.set?.text || '';
  paintAvatar();
  const staff = isStaff(u);                                           /* админы и все, кто есть в таблице доступов */
  $('h-cabs').hidden = !staff; $('h-cabs').closest('.row').classList.toggle('staff', staff); document.body.classList.toggle('staff', staff);
  $('h-moon').textContent = d.moon + (d.lunar ? ' · ' + ordinal(d.lunar.n) + ' лунный день' : '');
  $('h-lunar').textContent = d.lunar ? d.lunar.period : '';
  moonSetPhase(d.moonPhase);paintNextStep();
}
function updatePracticeStatus(key, value){
  document.querySelectorAll('[data-status="'+key+'"]').forEach(el=>el.textContent=value);paintNextStep();
}
/* Точка у аватара: «Новое в приложении» этого месяца ещё не открывали */
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
    homeStatusAt=Date.now();paintNextStep();
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
    paintMoodStat(r.stats); paintMoodExtra(); paintNextStep();
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
      if (b.lvl && list && list.tag !== 'table') {          /* вложенный пункт живёт внутри предыдущего */
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
/* Год живёт от дня рождения до дня рождения — так и подписываем:
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
    : e.code==='short_question' ? 'Допишите вопрос — ответ приходит на конкретный, а не на общий.'
    : 'Не получилось. Попробуйте ещё раз.';
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
  send: { too_often: 'Слишком часто. Попробуйте через несколько минут.', mail_off: 'Отправка почты ещё не настроена.', send_failed: 'Письмо не ушло. Проверьте адрес или попробуйте позже.', _: 'Не получилось отправить код.' },
  verify: { wrong_code: 'Код не подошёл. Проверьте письмо.', expired: 'Код истёк — запросите новый.', too_many: 'Слишком много попыток. Запросите новый код.', _: 'Не получилось войти.' },
  /* тот же код, но другое дело: здесь отказ означает, что аккаунт остался на месте */
  del: { wrong_code: 'Код не подошёл — аккаунт не удалён.', expired: 'Код истёк — начните удаление заново.', too_many: 'Слишком много попыток. Начните удаление заново.', no_code: 'Код не найден — начните удаление заново.', _: 'Не получилось удалить аккаунт.' },
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
/* До анкеты — «Уже пользовались?» на анкете и экран входа: профиль нашёлся — перезагрузка открывает приложение;
   почта новая — привязана к этому устройству, остаётся заполнить анкету (почту в ней уже не спрашиваем) */
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
async function loadWeek(){
  try{
    const w = await api('/week');
    $('w-summary').textContent = w.summary;
    const parts = [];
    if (w.moods.length) parts.push(w.moods.map(m=>`${m.mood} — ${m.count}`).join(' · '));
    if (w.asked.length) parts.push('спрашивали: ' + w.asked.map(a=>`${a.kind} — ${a.count}`).join(' · '));
    if (w.notes) parts.push(`записей в дневнике — ${w.notes}`);
    $('w-detail').innerHTML = parts.length
      ? parts.map(t=>`<p class="hint">${t}</p>`).join('')
      : '';
  }catch(e){ $('w-summary').textContent = 'Итог недели появится, когда наберутся отметки.'; }
}
async function loadInvite(){
  try{
    const i = await api('/invite');
    const bonus = i.bonusActive ? `<p class="hint t-gold mt-2">Подарок действует до ${fmtDay(i.bonusUntil)} — четыре подробных разбора в день.</p>` : '';
    const brought = i.brought ? `<p class="hint mt-2">По вашей ссылке пришли: ${i.brought}</p>` : '';
    $('inv-box').innerHTML = `
      <div class="field mb-0"><input id="inv-link" class="compact" readonly value="${esc(i.link)}"></div>
      <button data-on="click:copyInvite" class="btn ghost sm full mt-2">Скопировать ссылку</button>
      ${bonus}${brought}`;
  }catch(e){ $('inv-box').innerHTML = '<p class="hint">Ссылка появится чуть позже.</p>'; }
}
async function copyInvite(){
  const el = $('inv-link');
  try{
    await navigator.clipboard.writeText(el.value);
    toast('Ссылка скопирована');
  }catch(e){ el.select(); toast('Скопируйте ссылку вручную'); }
  track('invite_copy');
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
  catch(e){ toast('Не удалось изменить отметку желания. Попробуйте ещё раз.'); }
}
function journalPrompt(text){
  const el=$('j-text'); if(!el) return;
  if(!el.value.trim()) el.value=text+'\n';
  el.focus(); el.setSelectionRange(el.value.length,el.value.length); hap();
}
let journalSpeech=null;
function prepareDictation(){
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  $('j-dictate').textContent=supported?'Продиктовать':'Диктовка с клавиатуры';
  $('j-dictate').setAttribute('aria-pressed','false');
  $('j-speech-note').textContent=supported?'Браузер может отправлять голос своему сервису распознавания. В Лунарио сохраняется текст.':'Нажмите микрофон на клавиатуре телефона или включите системную диктовку';
}
function stopJournalDictation(){const rec=journalSpeech;journalSpeech=null;if(rec){rec.onresult=rec.onerror=rec.onend=null;try{rec.abort();}catch(e){}}prepareDictation();}
function journalDictate(){
  if(journalSpeech){journalSpeech.stop();return;}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){$('j-text').focus();$('j-speech-note').hidden=false;return;}
  const rec=new Recognition();journalSpeech=rec;rec.lang='ru-RU';rec.interimResults=false;
  $('j-dictate').textContent='Остановить диктовку';$('j-dictate').setAttribute('aria-pressed','true');
  rec.onresult=e=>{if(journalSpeech!==rec)return;const el=$('j-text');for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal!==false)el.value+=(el.value.trim()?' ':'')+e.results[i][0].transcript;el.value=el.value.slice(0,2000);};
  rec.onerror=e=>{if(journalSpeech!==rec||e.error==='aborted')return;toast(e.error==='not-allowed'?'Разрешите микрофон в настройках браузера или используйте клавиатуру':'Не удалось распознать речь. Попробуйте ещё раз');};
  rec.onend=()=>{if(journalSpeech!==rec)return;journalSpeech=null;prepareDictation();};
  try{rec.start();}catch(e){stopJournalDictation();toast('Не удалось включить диктовку');}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&journalSpeech)stopJournalDictation();});
async function compat(){
  const b=$('m-cdate').value; if(!b){ toast('Укажите дату партнёра'); return; }
  try{
    const r=await api('/compat',{method:'POST',body:JSON.stringify({birth:b})});
    $('m-cres').style.display='block';
    $('m-cres').innerHTML=`<div class="big">${r.total}%</div>
      <p class="serif center strong">${r.you} и ${r.other}</p>
      <div class="split">
      ${r.rings.map(([n,v])=>`<div class="ring"><svg width="54" height="54" viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle class="v" cx="28" cy="28" r="24" fill="none" stroke="#d9b868" stroke-width="4" stroke-linecap="round" data-p="${v}"/></svg><span class="val">${v}%</span><span class="lbl">${n}</span></div>`).join('')}
      </div><p class="mt-3">${r.text}</p>`;
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
  if(!birth){ showMsg(msg, 'Укажите дату рождения — без неё подсказки будут общими.', true); return; }
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
      startApp(); return;
    }catch(e){
      last=e;
      if (e.status) break;
      if (attempt===1){ $('o-go').textContent='Связь прервалась, пробуем ещё раз…'; await new Promise(r=>setTimeout(r,1200)); }
    }
  }
  $('o-go').disabled=false; $('o-go').textContent='Открыть мой день';
  showMsg(msg, last && last.code==='no_consent' ? 'Подтвердите согласие на обработку данных.'
    : last && last.code==='bad_birth' ? 'Проверьте дату рождения.'
    : last && last.status ? 'Сервер не принял анкету. Напишите нам, если повторится.'
    : 'Не удалось связаться с сервером — похоже, пропала сеть. Данные не потеряны: нажмите ещё раз.', true);
};
/* В анкете указана почта: код — на том же экране; не ушёл — не держим человека на пороге, почту можно привязать в «Аккаунте» */
async function obSendCode(email){
  try { await requestCode(email); }
  catch (e) { toast(authErrorText(e, 'send')); startApp(); return; }
  $('o-form').style.display='none'; $('o-back').style.display='none'; $('o-codebox').style.display='';
  $('v-onb').classList.add('verifying-email'); window.scrollTo(0,0);
  authMount('o-codebox', { step: 'code', email, onDone: (r) => {
    if (r.merged) { location.reload(); return; }        // почта уже была — открываем тот аккаунт
    S.user = r.user; startApp();
  } });
}

/* ── разделы: данные подгружаются при входе ── */
/* На экране «Дневник» видны лента и счётчик желаний; итоги, вопросы и записи виджеты грузят сами при открытии */
function loadHistory(){ if(!XP.timeline.items.length||XP.timeline.dirty)loadTimeline(); loadWishes(); }
const loadWishes=()=>api('/wishes').then(renderWishes).catch(()=>{});
function loadAbout(){
  const u=S.user; loadNumerology();
  $('ab-sub').textContent=[u.name,u.sign].filter(Boolean).join(' · ')||'Мой профиль';
}
function loadAccount(){
  const u=S.user; paintAvatar();
  $('ac-name').textContent=u.name||'Мой профиль';
  $('m-sign').textContent=[u.sign,u.birth?fmtDay(u.birth):'',u.city].filter(Boolean).join(' · ');
  $('profile-summary').textContent=[u.birth?fmtDay(u.birth):'',u.city].filter(Boolean).join(' · ');
  $('ac-mail').textContent=u.email||'Мой профиль и приложение';
  const geoLine=$('m-geo');
  if(u.lat!=null){
    const off=u.tzOffset!=null?(u.tzOffset>=0?'+':'−')+Math.abs(Math.round(u.tzOffset/60)):'—';
    geoLine.innerHTML=`Координаты для натальной карты: <b>${u.lat.toFixed(4)}, ${u.lon.toFixed(4)}</b> · ${u.tz} · на дату рождения UTC${off}`
      +(u.natalReady?'':'<br>Добавьте время рождения — без него карта строится приблизительно.');
  } else geoLine.textContent='Город не распознан — координаты не сохранены. Впишите город из подсказки, чтобы построить натальную карту.';
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
    $('journal-saved').hidden=false;$('journal-saved').textContent='Запись сохранена · '+fmtDay(r.item.day);toast('Запись сохранена');S.journalDone=true;paintNextStep();growTextarea($('j-text'));loadJournal();
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
    showMsg(msg, e.code==='bad_birth' ? 'Проверьте дату рождения.' : 'Не получилось сохранить. Попробуйте ещё раз.', true);
  }
}
/* Удаление необратимо, поэтому у аккаунта с почтой оно подтверждается кодом из письма — как и вход.
   Аккаунту без почты подтверждать нечем: остаётся только вопрос на экране. */
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
let deferred=null;
window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); deferred=e; track('install_prompt'); $('t-install').style.display='flex'; });
async function installApp(){ if(!deferred) return; track('installed'); deferred.prompt(); await deferred.userChoice; deferred=null; $('t-install').style.display='none'; }

/* ══════════ Карты Таро и руны: каталог, результаты, история, открытки ══════════ */
/* Каталог: тексты и картинки карт и рун приходят одним запросом и дальше живут в памяти.
   Ответы сервера несут только коды и названия — по кодам экран находит полные тексты. */
/* Последний удачный каталог остаётся в браузере: без сети настроения, награды и вопросы берутся из него,
   а не из копий справочников в коде — источник у контента один, content.mjs. */
const catalogFrom = (c) => ({ cards: Object.fromEntries(c.cards.map(x => [x.slug, x])), runes: Object.fromEntries(c.runes.map(x => [x.slug, x])), layouts: c.layouts, habitIdeas: c.habitIdeas || [], askesisIdeas: c.askesisIdeas || [], lunarDays: c.lunarDays || [],
  news: c.news || [], quickMoods: c.quickMoods || [], moods: c.moods || [], moodFamilies: c.moodFamilies || {}, legacyMoods: c.legacyMoods || {},
  worries: c.worries || [], awards: c.awards || [], reminderTexts: c.reminderTexts || {} });
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
  paintCardTile();paintNextStep();
}
function paintCardTile(){ const e = $('t-cardsub'); if (e && S.day) e.textContent = S.flipped && S.day.card ? S.day.card.name : '22 аркана: смысл и что с ним делать сегодня'; }
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
  }catch(e){ toast('Не получилось открыть карту — попробуйте ещё раз'); $('t-open').disabled = false; }
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
const LABELS = { yesno: 'О чём спрашиваете', rune: 'О чём спрашиваете руны', spread: 'Ваш вопрос к картам' };
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
const KIND_LABEL = { card: 'Карта дня', yesno: 'Да / Нет', rune: 'Руна', runes: 'Руны', spread: 'Таро' };
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
      || `<p class="hint">${entriesView.kind==='questions'?'Здесь появятся ваши вопросы и ответы. Карты дня доступны в соседней вкладке.':entriesView.kind==='card'?'Вы ещё не открывали карту дня.':'Записей пока нет.'}</p>`;
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
  if ((i.kind === 'rune' || i.kind === 'runes') && d.runes) return runesHtml({ q: i.question, layout: d.layout || 'one', runes: d.runes, day: i.day });
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
      if (across) {   /* карта поперёк первой: подпись — в пустом углу схемы */
        const lx = x0 + (3 * cw + 2 * gap) / 2, ly = y0 + 3 * (ch + lab + gap) + ch / 2 - 10;
        const yy = drawText(ctx, '2 · ' + (P.name || '') + ' · поперёк первой', lx, ly, { size: 17, color: '#b9b2cf', maxW: 3 * cw + 2 * gap, lh: 1.15 });
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
  /* Safari без меню: показываем картинку — её можно зажать и сохранить в Фото */
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
const REM_ORDER = ['card', 'mood', 'moodreport', 'habits', 'askesis', 'gratitude', 'lunar', 'sky'];
const FREQ_LABEL = { daily: 'Каждый день', weekdays: 'По будням', weekly: 'Раз в неделю', events: 'Когда что-то происходит' };
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_ON = ['по понедельникам', 'по вторникам', 'по средам', 'по четвергам', 'по пятницам', 'по субботам', 'по воскресеньям'];
const wdIdx = (day) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
const IOS_BRIDGE = typeof window.__LUN_IOS__ === 'number' ? window.__LUN_IOS__ : (IOS_SHELL ? 1 : 0);
const PUSH_OK = !IOS_SHELL && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
const NATIVE_TEXT_FALLBACK = { card: ['Лунарио', 'Ваша карта дня готова ✦'], mood: ['Как прошёл день?', 'Отметьте настроение — одно нажатие'], moodreport: ['Отчёт по настроениям', 'Ваш отчёт за неделю готов'],
  habits: ['Привычки', 'Отметьте привычки за сегодня'], askesis: ['Аскеза', 'Вы держитесь — загляните, сколько дней осталось'], gratitude: ['Кому и за что я благодарна сегодня?', 'Пара слов — и запись останется в дневнике'], lunar: ['Лунный день', 'Посмотрите рекомендацию на сегодня'], sky: ['На небе', 'Сегодня на небе что-то происходит — посмотрите'] };
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
    const sub = reg && await withTimeout(reg.pushManager.getSubscription());
    if (sub) {
      // Attach this existing device subscription to the current signed-in account.
      await api('/push', {method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
      S.pushEndpoint = sub.endpoint; S.pushOn = true;
    }
  } catch(e) { /* the explicit enable button lets the user reconnect */ }
}
const invitationKey = () => 'lun_push_invite_' + S.user.id;
function showPushInvitation(){
  const box = $('push-invite');
  try { if (localStorage.getItem(invitationKey())) return; } catch(e) {}
  box.hidden = false;
  box.innerHTML = `<div class="push-invite-row"><button data-on="click:openPushSettings" type="button" class="text-action" aria-label="Настроить уведомления"><i class="ico bell"></i>Настроить уведомления <span aria-hidden="true">→</span></button><button data-on="click:dismissPushInvitation" type="button" class="text-action secondary">Не сейчас</button></div>`;
}
function dismissPushInvitation(){
  try { localStorage.setItem(invitationKey(),'1'); } catch(e) {}
  $('push-invite').hidden = true;
}
function openPushSettings(){ dismissPushInvitation(); go('account'); openWidget('remind'); }

function loadReminders(force){
  if (S.rem && !force) return Promise.resolve(S.rem);
  if (remPromise && !force) return remPromise;
  remPromise = api('/reminders').then(async r => { S.rem = Object.fromEntries(r.items.map(i => [i.feature, i])); S.pushKey = r.push.key; await syncPushDevice(); return S.rem; }).catch(e => { remPromise = null; throw e; });
  return remPromise;
}
const remBox = (f, full=false) => `<div class="rem" data-rem="${f}" data-full="${full}"></div>`;
/* Строка уведомлений под заголовком виджета: настройки подгружаются, если ещё не были */
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
    :!PUSH_OK?(IS_IOS?'На iPhone добавьте Лунарио на экран «Домой», откройте оттуда и включите уведомления':'Этот браузер не поддерживает пуш-уведомления')
    :Notification.permission==='denied'?'Уведомления заблокированы. Разрешите их в настройках сайта в браузере'
    :S.pushOn?'Это устройство подключено':'При первом включении браузер спросит разрешение. Если расписание уже включено, подключите это устройство';
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
        <div class="chips flow mt-3" aria-label="Регулярность">${(f === 'sky' ? ['events','daily','weekdays','weekly'] : ['daily','weekdays','weekly']).map(k => `<button data-on="click:remSave-a0-freq-a1" data-a0="${f}" data-a1="${k}" type="button" class="chip${r.freq === k ? ' on' : ''}" aria-pressed="${r.freq===k}">${FREQ_LABEL[k]}</button>`).join('')}</div>
        ${r.freq === 'weekly' ? `<div class="chips flow mt-2" aria-label="День недели">${WD_SHORT.map((w,i) => `<button data-on="click:remSave-a0-weekday-a1" data-a0="${f}" data-a1="${i+1}" type="button" class="chip${r.weekday === i+1 ? ' on' : ''}" aria-pressed="${r.weekday===i+1}">${w}</button>`).join('')}</div>` : ''}
        <p class="hint mt-3">Часовой пояс: ${esc(TZ || 'Europe/Moscow')}. Изменения сохраняются автоматически</p>
        ${!IOS_SHELL && ['habits','mood','gratitude'].includes(f) ? '<p class="hint mt-2">Если сегодня всё уже отмечено, напоминание не отправляем</p>' : ''}
        ${f==='askesis' ? '<p class="hint mt-2">Поддержка и оставшиеся дни — пока есть активная аскеза</p>' : ''}

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
  catch(e) { toast('Не удалось подключить уведомления. Попробуйте ещё раз'); }
  finally { remBusy[f]=false; REM_ORDER.forEach(paintRem); }
}
async function remToggle(f){
  const r = S.rem && S.rem[f]; if (!r || remBusy[f]) return; hap();
  remBusy[f]=true; paintRem(f);
  try {
    // Request permission directly in this click, before any network wait.
    if (!r.enabled && !(await connectPushDevice())) return;
    if (await remSave(f,{enabled:!r.enabled})) {
      dismissPushInvitation();
      toast(S.rem[f].enabled ? 'Напомним ' + remText(S.rem[f]) : 'Уведомления выключены');
    }
  } catch(e) { toast('Не удалось включить уведомления. Попробуйте ещё раз'); }
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
  } catch(e) { S.pushOn=false; toast('Не получилось подключить уведомления. Проверьте связь и повторите'); return false; }
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
  if (IOS_BRIDGE < 2) { if (f === 'card') nativePost({ type: 'reminder', on: r.enabled }); return; }
  const [hh, mm] = r.time.split(':').map(Number);
  /* у телефона нет подстановок — берём заголовок из текстов напоминаний, если он без {скобок}, иначе запасной */
  const rt = CAT && CAT.reminderTexts && CAT.reminderTexts[f], nt = NATIVE_TEXT_FALLBACK[f];
  const msg = { type: 'schedule', id: f, on: r.enabled, hour: hh, minute: mm, freq: r.freq, weekday: r.weekday, title: rt && !/[{}]/.test(rt[0]) ? rt[0] : nt[0], body: rt && !/[{}]/.test(rt[1]) ? rt[1] : nt[1] };
  if (f === 'askesis' && IOS_BRIDGE >= 3 && r.enabled) {
    const plan=await api('/reminders/askesis-plan'); msg.messages=plan.items; msg.tz=plan.tz||TZ; if(!plan.items.length)msg.on=false;
  }
  if (IOS_BRIDGE >= 4 && ['lunar','sky'].includes(f) && r.enabled) {
    const plan=await api('/reminders/sky-plan?feature='+f); msg.messages=plan.items; msg.tz=plan.tz||TZ;
  } else if (f === 'sky' && r.freq === 'events') {
    try { const sky = S.sky || (S.sky = await api('/sky')); msg.dates = [...new Set([...sky.today, ...sky.upcoming].map(e => new Date(e.at).toLocaleDateString('sv-SE')))].slice(0, 20); } catch (e) { /* без дат — телефон напомнит ежедневно */ }
  }
  msg.url='/app/?open='+f; msg.tz=msg.tz||TZ;
  if(IOS_BRIDGE>=4){ const result=await nativeRequest(msg); if(!result.ok)throw new Error(result.reason||'native_schedule'); }
  else nativePost(msg);
}
function refreshNativeAskesis(){ if(IOS_SHELL && IOS_BRIDGE>=3) loadReminders(true).then(async()=>{for(const f of (IOS_BRIDGE>=4?['askesis','lunar','sky']:['askesis'])) if(S.rem[f].enabled && (IOS_BRIDGE<4 || S.nativePermission==='granted')) await nativeSchedule(f);}).catch(()=>{}); }
document.addEventListener('visibilitychange',()=>{if(!document.hidden && S.user?.onboarded)refreshNativeAskesis();});
window.__lunScheduleState = (states, reason) => {
  S.nativeStates = states || {};
  if(reason==='denied') S.nativePermission='denied';
  REM_ORDER.forEach(paintRem);
  if (reason === 'denied') toast('Уведомления для Лунарио выключены — их можно разрешить в Настройках телефона');
};
/* После карты обновляем ту же строку уведомлений у заголовка. */
function cardNudge(){remRefresh('card');}
/* «Напоминания» в аккаунте: все функции одним списком */
async function paintAllReminders(){
  const box = $('rem-all'); box.innerHTML = LOADING;
  try { await loadReminders(true); } catch (e) { box.innerHTML = LOAD_ERR; return; }
  box.innerHTML = `<p class="hint">Выберите, о чём напоминать. Для каждой функции можно задать своё время и регулярность.</p><p id="rem-device-status" class="rem-status" role="status"></p>
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
  remRefresh('mood'); preparePending();
}

/* ══════════ Отчёт по настроениям: неделя по дням, месяц по долям ══════════ */
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthName = (key) => { const [y, m] = key.split('-'); return MONTHS_RU[Number(m) - 1] + ' ' + y; };
async function loadMoodReport(){
  const box = $('mr-box'); box.innerHTML = '<p class="hint">Считаем…</p>';
  try { S.moodReport = await api('/mood/report'); paintMoodReport(); track('moodreport_view'); }
  catch (e) { box.innerHTML = LOAD_ERR; }
  remRefresh('moodreport');
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
    <details class="lunar-period"><summary>Период и место расчёта</summary><p>${esc(l.period)}</p><p>По месту рождения из профиля: ${esc(S.user.city||'Москва')}. Часовой пояс: ${esc(S.user.tz||'Europe/Moscow')}</p></details>
    <details class="lunar-library"><summary>Все 30 лунных дней</summary><div id="ln-days"></div><div id="ln-preview"></div><div id="ln-ref"></div></details>`;
  XP.lunarSeenAtOpen=(XP.prefs.lunarViews||0)>=1;   /* ряд тем — со второго открытия: смотрим счётчик до того, как засчитать это открытие */
  remRefresh('lunar');preparePending();track('lunar_view','topics:'+(topicsAll()?'all':((XP.prefs.topics||[]).length||'default')));XP.prefs.lunarViews=(XP.prefs.lunarViews||0)+1;
  loadLunarDays().then(()=>{paintLunarArticle();$('ln-ref').innerHTML=lunarRefHtml(LUN.reference);}).catch(()=>{if($('ln-art'))$('ln-art').innerHTML='<p class="hint">Справочник не загрузился. Откройте лунный день ещё раз</p>';});
}
/* ── Темы чтения: человек выбирает разделы, остальное — под заголовками-свёртками. Ряд тем появляется со второго открытия. ── */
const META_TOPICS=new Set(['symbol','advice','live']);
function topicList(){return (LUN&&LUN.topics)||[];}
function topicsChosen(){const t=XP.prefs.topics||[];return t.length?t:topicList().filter(x=>x.def).map(x=>x.key);}
function topicsAll(){return !!XP.prefs.topicsAll;}
function topicsRowVisible(){return !!XP.lunarSeenAtOpen||!!XP.topicsShown;}
function topicsRowHtml(){
  const chosen=new Set(topicsChosen()),all=topicsAll();
  return `<div class="chips flow ln-topics" role="group" aria-label="Темы чтения">${topicList().map(t=>`<button data-on="click:toggleTopic-a0" data-a0="${t.key}" type="button" class="chip${chosen.has(t.key)?' on':''}${META_TOPICS.has(t.key)?' meta':''}" aria-pressed="${chosen.has(t.key)}">${esc(t.label)}</button>`).join('')}</div>
    <div class="ln-all"><span>${all?'Показаны все разделы':'Показаны выбранные темы'}</span><button data-on="click:setTopicsAll-a0" data-a0="${all?'false':'true'}" type="button">${all?'Только выбранное':'Показать всё'}</button></div>`;
}
async function toggleTopic(key){
  const cur=new Set(topicsChosen());if(cur.has(key))cur.delete(key);else cur.add(key);
  const topics=topicList().map(t=>t.key).filter(k=>cur.has(k));
  try{await savePreferences({...XP.prefs,topics});track('topics_set',topics.join(','));hap();}
  catch{toast('Не удалось сохранить выбор. Попробуйте ещё раз');return;}
  paintLunarArticle();if($('topics-box'))paintTopics();
}
async function setTopicsAll(on){
  try{await savePreferences({...XP.prefs,topicsAll:!!on});track('topics_all',on?'on':'off');}
  catch{toast('Не удалось сохранить. Попробуйте ещё раз');return;}
  XP.topicsShown=true;paintLunarArticle();if($('topics-box'))paintTopics();
}
function paintLunarArticle(){
  const l=S.day&&S.day.lunar,d=LUN&&LUN.days.find(x=>x.n===l.n);if(!l||!$('ln-art'))return;
  $('ln-art').innerHTML=(topicsRowVisible()?topicsRowHtml():'')+(d?lunarDayHtml(d,l.n,true):'');
  const adv=document.querySelector('#ln-box .practice-card');if(adv)adv.style.display=(topicsAll()||topicsChosen().includes('advice'))?'':'none';
  showLunarDay(l.n);preparePending();
}
function trackExpand(el,key){if(el.open)track('lunar_expand',key);}
/* Открытка: одна выбранная содержательная тема — её заголовок и первая фраза вместо общей рекомендации */
function lunarTopicLine(n){
  const content=topicsChosen().filter(k=>!META_TOPICS.has(k));if(content.length!==1||!LUN)return '';
  const d=LUN.days.find(x=>x.n===n),s=d&&(d.sections||[]).find(x=>x.key===content[0]),para=s&&s.blocks.find(b=>b.t==='p');
  if(!para)return '';const m=String(para.text).match(/^.+?[.!?…](\s|$)/);return s.title+': '+(m?m[0]:para.text).trim();
}
/* WebMCP: если браузер даёт агентам доступ к инструментам страницы (navigator.modelContext), объявляем два безопасных:
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
/* Виджет «Небо над вами»: место для созвездий — по устройству (только по нажатию), свой город или как в анкете */
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
/* Виджет «Темы чтения» в «Аккаунте» */
function paintTopics(){
  const box=$('topics-box');if(!box)return;
  if(!LUN){box.innerHTML='<p class="hint">Загружаем темы…</p>';loadLunarDays().then(paintTopics).catch(()=>{box.innerHTML='<p class="hint">Не удалось загрузить темы. Откройте ещё раз</p>';});return;}
  box.innerHTML=`<p class="hint">Лунный день показывается выбранными разделами, остальные свёрнуты под заголовками. Выбор действует на экране, в напоминании и на открытке.</p>${topicsRowHtml()}`;
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
  remRefresh('sky').then(() => { if (IOS_SHELL && S.rem?.sky.enabled) nativeSchedule('sky'); });
}
function paintSky(){
  const s = S.sky, box = $('sky-box');
  const id = regRes({ type: 'sky', sky: s, day: s.date });
  const ev = (e, cls) => `<div class="item skyev${cls ? ' ' + cls : ''}"><b>${esc(e.title)}</b><small>${fmtWhen(e.at)}</small>${e.note ? `<p class="mt-2">${esc(e.note)}</p>` : ''}</div>`;
  box.innerHTML = `<div class="card center"><span class="eyebrow">Сегодня</span>
      <div class="title-gold mt-2">${esc(s.moon.phase)} ${esc(s.moon.signIn)}</div>
      <p class="mt-1">Луна освещена на ${s.moon.illumination}% · ${s.moon.waxing ? 'растёт' : 'убывает'} · Солнце ${esc(s.sun.signIn)}</p>
      <p class="t2">${s.retro.length ? s.retro.map(r => `${r.symbol} ${esc(r.name)} — ${r.adj}`).join(' · ') : 'Ретроградных планет сейчас нет'}</p>
    </div>
    ${s.today.length ? `<div class="list mt-3">${s.today.map(e => ev(e, 'now')).join('')}</div>` : ''}
    ${s.retro.length ? `<div class="card mt-3">${s.retro.map(r => `<h3>${r.symbol} ${esc(r.name)} ${r.adj}</h3><p>${esc(r.note)}</p>`).join('')}</div>` : ''}
    ${s.aspects.length ? `<div class="card mt-3"><h3>Точные аспекты сегодня</h3>${s.aspects.map(a => `<p>${a.aSym} ${esc(a.a)} ${a.symbol} ${a.bSym} ${esc(a.b)} <small class="faint">· ${esc(a.name.toLowerCase())}, орб ${a.orb}°</small></p>`).join('')}</div>` : ''}
    <span class="eyebrow mt-4">Ближайшие недели</span>
    <div class="list mt-2">${s.upcoming.map(e => ev(e)).join('')}</div>
    ${actionsHtml(id, true)}
    <p class="hint mt-3 center">Фазы и планеты рассчитаны астрономически. Затмения — по положению Луны у узлов, без учёта видимости из вашего города.</p>`;
  paintRem('sky'); preparePending();
}

/* ══════════ Поделиться текстом: любой результат ══════════ */
function shareResText(p){
  const link = location.origin + '/app/';
  switch (p.type) {
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
    case 'award': return `${p.days} ${plural(p.days, 'день', 'дня', 'дней')} подряд: «${p.title}» — ${p.name} ✦\nЛунарио · ${link}`;
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

/* диск Луны с настоящей освещённостью */
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
  if (p.type === 'award') {
    drawText(ctx, `${p.days} ${plural(p.days, 'ДЕНЬ', 'ДНЯ', 'ДНЕЙ')} ПОДРЯД`, 540, 170, { size: 30, color: '#d9b868', spacing: 6 });
    if (p.days >= 365) { ctx.save(); ctx.strokeStyle = '#f0d79a'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(240,215,154,.6)'; ctx.shadowBlur = 60;
      ctx.beginPath(); ctx.arc(540, 560, 150, 0, Math.PI * 2); ctx.fillStyle = '#f0d79a'; ctx.fill();
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(540 + Math.cos(a) * 200, 560 + Math.sin(a) * 200); ctx.lineTo(540 + Math.cos(a) * 280, 560 + Math.sin(a) * 280); ctx.stroke(); } ctx.restore(); }
    else pcMoonDisc(ctx, 540, 560, 200, { 30: 18, 60: 50, 90: 80, 180: 100 }[p.days] || 100, true);
    let y = drawText(ctx, p.name, 540, 940, { size: 64, weight: 600, color: '#e9c77e' });
    y = drawText(ctx, p.title, 540, y + 30, { size: 40, color: '#f5f2ea', maxW: 900, lh: 1.3 });
    drawText(ctx, p.text, 540, y + 50, { size: 32, color: '#ded8ee', maxW: 860, lh: 1.42 });
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
/* какой лепесток рисовать у сочетания — по тому, что в нём звучит громче */
const DYAD_FACE = { optimism:'joy', love:'joy', submission:'anticipation', awe:'surprise', disappointment:'sadness', remorse:'sadness', contempt:'anger', aggressiveness:'anger' };
const MOUTH = { joy:'M11.5 18.5q4.5 4.5 9 0', trust:'M12 19q4 3 8 0', fear:'M11.5 19q2.2-2 4.5 0t4.5 0', surprise:'M13.8 19.2a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
  sadness:'M11.5 20.5q4.5-4 9 0', disgust:'M11.5 19.5q2 1.6 4.5 0t4.5 0', anger:'M11.5 20.5q4.5-3 9 0', anticipation:'M12.5 19.5h7' };
const moodList = () => CAT?.moods || [];
const moodFams = () => CAT?.moodFamilies || {};
/* своё слово: хранится как «own:слово» — на экране и в отчёте показывается как есть, без лепестка */
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
    <div class="quick-moods">${quickMoods().map(m=>`<button data-on="click:quickMood-a0" data-a0="${m.key}" type="button" class="quick-mood${S.mood===m.key?' on':''}" aria-pressed="${S.mood===m.key}">${moodSvg(m.key,30)}<span>${esc(m.label)}</span></button>`).join('')}<button data-on="click:moodOwn" type="button" class="quick-mood"><i class="ico pen"></i><span>Своё слово</span></button></div>
    ${cur?`<div class="mpick saved-state" role="status">${moodSvg(S.mood,36)}<div><b>Сегодня — ${esc(cur.label)}</b><small>Сохранено · ${fmtDay(S.day.date)}. Можно выбрать другое</small></div></div>`:''}
    <div class="mood-own-row" ${moodUI.ownOpen?'':'hidden'}><label for="mood-own">Своё настроение</label><div class="row"><input data-on="input:moodUI-own-value keydown:if-event-key-Enter-pickOwnMood" id="mood-own" aria-label="Своё настроение" maxlength="24" placeholder="Например: собранно" value="${esc(moodUI.own??ownMood(S.mood))}"><button data-on="click:pickOwnMood" class="btn sm" aria-label="Сохранить своё настроение">Сохранить</button></div></div>
    <div class="utility-actions"><button data-on="click:moodDetails" type="button" class="text-action secondary">${cur?'Хотите назвать точнее?':'Назвать точнее'}</button><button data-on="click:moodDetails-all" type="button" class="text-action secondary">Все эмоции</button></div>
    <div id="mood-detail" ${moodUI.precision?'':'hidden'}><div class="segmented" role="tablist" aria-label="Выбор эмоций"><button data-on="click:moodMode-families" role="tab" aria-selected="${moodUI.mode==='families'}">Основные эмоции</button><button data-on="click:moodMode-all" role="tab" aria-selected="${moodUI.mode==='all'}">Все эмоции</button></div>
    ${moodUI.mode==='families'?`
      <div id="mood-shades" class="mood-shades" ${selected?'':'hidden'}><p>${selected?esc(fams[selected][0]):''} · что ближе?</p><div class="chips flow">${list.filter(m=>m.family===selected).map(chip).join('')}</div></div>
      <div class="emotion-families">${familyKeys.map(f=>`<button data-on="click:moodFamily-a0" data-a0="${f}" type="button" class="emotion-family${selected===f?' on':''}" style="--c:var(--emotion-${f},${fams[f][1]})" aria-expanded="${selected===f}">${moodSvg(f,28)}<span>${esc(fams[f][0])}</span><span aria-hidden="true">⌄</span></button>`).join('')}</div>
      <button data-on="click:moodFamily-a0" data-a0="dyad" class="text-action secondary" type="button">Сочетания эмоций</button><p class="hint">Оттенки по кругу Плутчика</p>`:
      Object.keys(fams).filter(f=>list.some(m=>m.family===f)).map(f=>`<div class="mfam"><span class="fname">${esc(fams[f][0])}</span><div class="chips flow">${list.filter(m=>m.family===f).map(chip).join('')}</div></div>`).join('')}
    </div>`;
}

/* смайлик настроения на открытке — лепесток даёт рот и цвет */
function pcSmiley(ctx, mood, cx, cy, size){
  const k = size / 32, color = moodColor(mood);
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(k, k);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.shadowColor = color; ctx.shadowBlur = 20 / k;
  ctx.beginPath(); ctx.arc(16, 16, 12.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(12, 13, 1.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(20, 13, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.stroke(new Path2D(MOUTH[moodFace(mood)])); ctx.restore();
}

/* ══════════ «Что вас сегодня беспокоит?»: свой запрос или плашка, потом — как получить ответ ══════════ */
const HUB_TOPICS=[['Отношения','Что мне сейчас важно в отношениях?'],['Работа и деньги','Что мне важно понять о работе или деньгах?'],['Решение','Какое решение мне сейчас подходит?'],['Тревога','Что вызывает мою тревогу и как я могу себя поддержать?'],['Отношение к себе','Как я сейчас отношусь к себе и что хочу изменить?'],['Другое','']];
const HUB_OPTS=[['rune','rune','Руна','one'],['runes3','rune','Три руны','three'],['spread','tarot','Три карты','three'],['fork','tarot','Выбор','fork']];
const hubDraft={text:'',topic:null,kind:'rune'};
function renderHub(){
  const w=$('t-worry');if(!w)return;
  w.innerHTML=`<div class="card hubq"><p>Темы</p><div class="chips flow" id="hub-chips">${HUB_TOPICS.map(([label],i)=>`<button data-on="click:hubTopic-a0" data-a0="${i}" type="button" class="chip${hubDraft.topic===i?' on':''}" aria-pressed="${hubDraft.topic===i}">${label}</button>`).join('')}</div>
    <div class="field"><label for="hub-q">Что именно сейчас не даёт покоя?</label><textarea data-on="input:hubDraft-text-value-hubCheck" id="hub-q" maxlength="300" placeholder="Опишите своими словами…">${esc(hubDraft.text)}</textarea></div>
    <section class="hub-questions"><h3>Вопросы</h3><div class="chips flow" id="hub-questions"></div></section>
    <div id="hub-opts" hidden><span class="eyebrow">Как получить ответ</span><div class="chips flow">${HUB_OPTS.map(([key,,label])=>`<button data-on="click:hubMethod-a0" data-a0="${key}" type="button" class="chip${hubDraft.kind===key?' on':''}" data-kind="${key}" aria-pressed="${hubDraft.kind===key}">${label}</button>`).join('')}</div>
    <button data-on="click:hubAsk" type="button" class="btn" id="hub-go">Получить ответ</button></div></div><div id="hub-res" hidden></div>`;
  hubCheck();loadHubQuestions();
}
function loadHubQuestions(){
  if(CAT){renderHubQuestions();return;}
  $('hub-questions').innerHTML='<p class="hint">Загружаем вопросы…</p>';
  loadCatalog().then(renderHubQuestions).catch(()=>{const box=$('hub-questions');if(box)box.innerHTML='<button data-on="click:loadHubQuestions" type="button" class="text-action">Загрузить вопросы</button>';});
}
function renderHubQuestions(){
  const box=$('hub-questions');if(!box)return;
  box.innerHTML=(CAT?.worries||[]).map(text=>`<button data-on="click:hubPick-this" type="button" class="chip">${esc(text)}</button>`).join('');
}
function hubPick(button){
  hubDraft.text=button.textContent;$('hub-q').value=hubDraft.text;hubCheck();growTextarea($('hub-q'));$('hub-q').focus();
}
function hubTopic(index){
  const previous=HUB_TOPICS[hubDraft.topic]?.[1];
  if(!hubDraft.text.trim()||hubDraft.text===previous)hubDraft.text=HUB_TOPICS[index][1];
  hubDraft.topic=index;renderHub();$('hub-q').focus();
}
function hubMethod(kind){hubDraft.kind=kind;document.querySelectorAll('#hub-opts .chip').forEach(b=>{const on=b.dataset.kind===kind;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});}
function hubCheck(){const v=$('hub-q').value.trim();$('hub-opts').hidden=!(v.length>=10&&/\s/.test(v));}
async function hubAsk(){
  if(hubAsk.busy)return;const q=$('hub-q').value.trim();if(q.length<10||!(/\s/.test(q)))return;
  const out=$('hub-res'),button=$('hub-go');hubAsk.busy=true;button.disabled=true;button.textContent='Получаем ответ…';out.hidden=false;out.innerHTML='<p class="msg">Смотрим…</p>';
  const opt=HUB_OPTS.find(o=>o[0]===hubDraft.kind);track('worry_pick',hubDraft.kind);
  try{await runAsk(opt[1]==='rune'?'rune':'spread',q,out,null,opt[3]);out.scrollIntoView({behavior:'smooth',block:'start'});}
  catch(e){out.innerHTML=`<p class="msg err">${askErrorText(e)}</p>`;}
  finally{hubAsk.busy=false;button.disabled=false;button.textContent='Получить ответ';}
}

/* ══════════ Вопрос дня: к фразе на главной; ответ уходит в дневник ══════════ */
let toneDraft='',toneSaving=false,toneSaved=null;
function paintTone(){
  const d=S.day,st=d.set;if(!$('tone-box'))return;
  $('tone-box').innerHTML=`${st?`<p class="hint mb-4">${esc(st.statement||st.text)}</p>`:''}
    <p class="practice-question">${esc(d.question)}</p>
    ${toneSaved?`<div class="saved-state" role="status">Сохранено в дневнике · ${fmtDay(toneSaved.day)}</div><p class="entry-text">${esc(toneSaved.text)}</p>`:''}
    <div class="answer-form"><div class="field"><textarea data-on="input:toneDraft-value-growTextarea-this" id="tone-a" aria-label="Ответ на вопрос дня" maxlength="2000" placeholder="Пара строк — как есть…">${esc(toneDraft)}</textarea></div></div>
    <div class="answer-actions"><button data-on="click:saveAnswer" id="tone-save" type="button" class="btn sm" ${toneSaving?'disabled':''}>${toneSaving?'Сохраняем…':'Отправить в дневник'}</button></div>`;
  requestAnimationFrame(()=>growTextarea($('tone-a')));
}
async function saveAnswer(){
  if(toneSaving)return;const t=($('tone-a').value||'').trim();
  if(t.length<3){toast('Напишите хотя бы пару слов');return;}
  toneSaving=true;$('tone-save').disabled=true;
  try{const r=await api('/journal',{method:'POST',body:JSON.stringify({text:t,kind:'answer',title:S.day.question})});toneDraft='';toneSaved=r.item;paintNextStep();toast('Записано в дневник');hap('ok');loadJournal();}
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
  remRefresh('gratitude');
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
    ${r.items.filter(i=>i.id!==todayItem?.id).length?moreBlock(r.items.filter(i=>i.id!==todayItem?.id).slice(0,30).map(i=>`<div class="item"><small>${fmtDay(i.day)}</small><p class="entry-text">${esc(i.text)}</p></div>`).join(''),'Прошлые благодарности'):'<p class="hint">Запись остаётся здесь и в Дневнике, вместе с датой</p>'}`;
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
  remRefresh('habits');
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
      ${h.awards.length?`<span class="hb-badge">${awardIcon(h.awards.at(-1),16)} ${h.awards.at(-1)} дней</span>`:''}
      ${habitView==='all'?`<div class="hd-row">${h.week.map(w=>`<button data-on="click:habitMark-a0-a1" data-a0="${h.id}" data-a1="${w.day}" type="button" class="hd${w.done?' on':''}${w.due?' planned':' rest'}${w.day===today?' today':''}" data-due="${w.due}" aria-label="${fmtDay(w.day)}: ${w.done?'отмечено':w.due?'запланировано, не отмечено':'свободный день'}" title="${w.due?'Запланировано':'Свободный день'}" aria-pressed="${w.done}"><span>${WD_SHORT[wdIdx(w.day)]}</span></button>`).join('')}</div>`:''}
      ${hbEditing===h.id?`<div class="hb-edit"><div class="field"><label for="hb-t-${h.id}">Название</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-titl" data-a0="${h.id}" data-a1="${h.id}" id="hb-t-${h.id}" value="${esc(habitEditDrafts[h.id]?.title??h.title)}" maxlength="80"></div>
        <div class="field"><label for="hb-r-${h.id}">Регулярность — своими словами</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-rule" data-a0="${h.id}" data-a1="${h.id}" id="hb-r-${h.id}" value="${esc(habitEditDrafts[h.id]?.rule??(h.ruleText||h.ruleLabel))}" maxlength="60" list="rule-ideas"></div>
        <button data-on="click:habitSave-a0" data-a0="${h.id}" type="button" class="btn sm">Сохранить</button><div class="utility-actions"><button data-on="click:habitCancelEdit-a0" data-a0="${h.id}" type="button" class="text-action secondary">Отмена</button><button data-on="click:habitRemove-a0" data-a0="${h.id}" type="button" class="text-action secondary">Убрать привычку</button></div></div>`:''}
    </div>${habitView==='all' && hbEditing!==h.id?`<button data-on="click:habitEdit-a0" data-a0="${h.id}" type="button" class="text-action icon-action" aria-label="Изменить: ${esc(h.title)}">✎</button>`:''}</div>`;
  box.innerHTML=`<div class="segmented" role="tablist" aria-label="Дневник привычек"><button data-on="click:habitTab-today" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='today'}">Сегодня</button><button data-on="click:habitTab-all" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='all'}">Все привычки</button></div>
    <div id="habit-list" role="tabpanel" aria-label="${habitView==='today'?'Сегодня':'Все привычки'}">
      <p class="practice-progress" role="status">${!HB.length?'Добавьте первую привычку':habitView==='all'?'Мои привычки':!due.length?'На сегодня ничего не запланировано':done===due.length?'Всё на сегодня отмечено ✓':'Отмечено '+done+' из '+due.length}</p>
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
    if (r.award) showAward(r.award);
  } catch (e) { toast('Не получилось отметить'); }
  finally{habitBusy.delete(id);document.querySelectorAll('[data-habit="'+id+'"] .hb-check').forEach(b=>b.disabled=false);}
}
async function habitRemove(id){
  if (!confirm('Убрать привычку из списка? Отметки сохранятся в истории.')) return;
  try { const r = await api('/habits?id=' + id, { method: 'DELETE' }); HB = r.items; delete habitEditDrafts[id]; hbEditing = null; paintHabits(); } catch (e) { toast('Не получилось'); }
}
/* награды: луна растёт вместе с серией — от молодого серпа до солнца; тексты из каталога */
const awardText = (days) => { const a = CAT?.awards?.find((x) => x[0] === days); return a ? [a[1], a[2]] : [`${days} дней подряд`, '']; };
function awardIcon(days, size){
  const k = days >= 365 ? 1 : days >= 180 ? 1 : days >= 90 ? .8 : days >= 60 ? .5 : .18;
  if (days >= 365) return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="#f0d79a" stroke-width="2.5" stroke-linecap="round"><circle cx="32" cy="32" r="13" fill="#f0d79a"/>${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6; return `<line x1="${32 + Math.cos(a) * 19}" y1="${32 + Math.sin(a) * 19}" x2="${32 + Math.cos(a) * 27}" y2="${32 + Math.sin(a) * 27}"/>`; }).join('')}</svg>`;
  const rx = Math.abs(32 * (1 - 2 * k)) * 0.6, sweep = k < .5 ? 1 : 0;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="20" fill="#2a2150" stroke="rgba(240,215,154,.35)"/><path d="M32 12A20 20 0 0 1 32 52A${rx} 20 0 0 ${sweep} 32 12Z" fill="#f0d79a"/></svg>`;
}
function showAward(a){
  const [name, text] = awardText(a.days);
  const id = regRes({ type: 'award', days: a.days, name, text, title: a.title, day: S.day.date });
  $('award-box').innerHTML = `<div class="award">${awardIcon(a.days, 180)}<span class="eyebrow mt-3">${a.days} ${plural(a.days, 'день', 'дня', 'дней')} подряд</span>
      <div class="title-gold mt-2">${esc(name)}</div>
      <p class="mt-2 strong">${esc(a.title)}</p><p class="mt-2">${esc(text)}</p>
      <div class="resrow mt-4"><button data-on="click:savePostcard-a0" data-a0="${id}" class="btn sm" type="button">↓&nbsp; Открытка</button><button data-on="click:shareRes-a0" data-a0="${id}" class="btn ghost sm" type="button">Поделиться</button><button data-on="click:award-classList-remove-on" class="btn ghost sm" type="button">Закрыть</button></div></div>`;
  $('award').classList.add('on'); hap('award'); preparePending();
}

/* ══════════ Взять аскезу: отказ до выбранной даты, поддержка и счёт дней, заметки по желанию ══════════ */
let AS = null, askForm = {};
async function loadAskesis(){
  const box = $('as-box'); if (!AS) box.innerHTML = LOADING;
  await loadCatalog().catch(() => {});
  try { AS = await api('/askesis'); paintAskesis(); }
  catch (e) { box.innerHTML = LOAD_ERR; }
  remRefresh('askesis');
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
      <p class="ask-support">${esc(a.support)}</p>
      ${a.today?`<div class="saved-state" role="status">Наблюдение сохранено · ${fmtDay(today)}</div><p class="entry-text">${esc(a.today.text)}</p>`:''}
      <details data-on="toggle:askPanelToggle-this-a0" data-a0="${a.id}" class="observation" ${askNoteOpen[a.id]?'open':''}>
        <summary data-on="click:toggleAskPanel-event-this-a0" data-a0="${a.id}">${a.today?'Изменить наблюдение':'Добавить наблюдение'}</summary>
        <div class="field"><label for="as-note-${a.id}">Что заметила сегодня · необязательно</label><textarea data-on="input:askNoteDrafts-a0-value" data-a0="${a.id}" id="as-note-${a.id}" maxlength="500" placeholder="Несколько слов о своём опыте…">${esc(askNoteDrafts[a.id]??a.today?.text??'')}</textarea></div>
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
    const tile = key==='around'?document.querySelector('[data-feature="lunar"]').cloneNode(true):root.cloneNode(true); tile.className='wid'; tile.removeAttribute('id'); tile.removeAttribute('data-on'); tile.removeAttribute('style');   /* обработчик клона — свой, ниже */
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
  if(!box.children.length) box.innerHTML='<p class="hint">В этом месяце новинок ещё не было</p>';
  markNewsSeen(); track('news_view');
}

/* ── старт ── */
function startApp(){
  const initialPractice=new URLSearchParams(location.search).get('practice');
  paintHome(); paintToday(); go(initialPractice==='journal'?'history':'home');
  if(FEATURES[initialPractice]?.page)openPractice(initialPractice); showPushInvitation(); refreshNativeAskesis();
  if (S.day.card) { showFlipped(); $('t-after').style.display = 'block'; }   /* карта на сегодня уже открыта — она в истории */
  loadCatalog().then(() => { renderMoods(); if (S.flipped) { paintCard(); preparePending(); } if (wgOpen === 'ask') renderLayouts(); }).catch(() => {});
  /* из уведомления приходят сразу в нужный раздел */
  try {
    const target = openTarget(new URLSearchParams(location.search).get('open') || '');
    if (target) { go(target[0]); if (target[1]) openWidget(target[1]); history.replaceState(null, '', location.pathname); }
  } catch (e) {}
}
(async function(){
  if('serviceWorker' in navigator) ensurePushWorker().catch(()=>{});
  try{
    const r = await api('/me');
    S.user=r.user; S.day=r.day; S.mood=r.mood; S.limits=r.limits; S.mailReady=!!r.mailReady; S.localPreview=!!r.localPreview; S.catalogV=r.catalogV||1;initExperience(r.preferences);
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
        if (inv.ok) { track('invite_used'); setTimeout(()=>toast('Подарок от подруги: четыре разбора в день на неделю'), 1200); }
        history.replaceState(null,'',location.pathname);
      }
    }catch(e){ /* ссылка старая — просто открываем приложение */ }
    if(r.day && typeof r.day.moonPhase==='number') moonSetPhase(r.day.moonPhase);
    if(!r.user.onboarded){ go('hello'); track('intro_view'); if(S.mailReady) $('hello-login').style.display='block'; return; }
    startApp();
    paintMoodStat(r.moodStats);
  }catch(e){ go('hello'); }
})();
