/* Лунарио — Ядро: состояние, навигация, панели, старт. Остальное — по вкладкам: today.js, diary.js, readings.js, practices.js, about.js, account.js; старт — start.js. Все файлы — обычные скрипты в одном окне, функции зовут друг друга по имени. */
let S = { user:null, day:null, mood:null, mode:'yesno', flipped:false, num:null };
/* сброс состояния аккаунта на устройстве (F05): загруженные записи и производные экраны; нумерология живет с анкетой — только при выходе */
registerReset(()=>{ S.grat=null; S.thoughtsBy={}; S.entries=null; S.moodReport=null; S.yesterday=undefined; S.memory=null; S.mood=null; });
registerReset(()=>{ S.num=null; },{profile:true});
/* iOS-оболочка: класс выставлен скриптом в head. Сообщения к нативному слою идут
   через мост WebKit; try/catch закрывает и его отсутствие (обычный браузер). */
const IOS_SHELL = document.documentElement.className.indexOf('ios-shell') !== -1;
function nativePost(m){ try{ window.webkit.messageHandlers.lunario.postMessage(m); return true; }catch(e){ return false; } }
function track(t, d){
  try{
    const body = JSON.stringify({ t, d: d || '' });
    if (navigator.sendBeacon) navigator.sendBeacon(API + '/event', new Blob([body], { type:'application/json' }));
    else fetch(API + '/event', { method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true });
  }catch(e){ /* аналитика никогда не ломает приложение */ }
}
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

/* ── навигация: четыре вкладки внизу (home, ask, history, about); account открывается с главной по кружку с фото
   и вкладку не подсвечивает ── */
const INNER_VIEWS=['home','ask','history','about','account'];   /* rhythm, onb, login, hello — без нижней навигации */
const VIEW_ALIASES={today:'home',around:'home',me:'about'};
function go(v){
  v=VIEW_ALIASES[v]||v;
  rememberScroll();closeWidget();leavePractice();
  history.replaceState({lunView:v},'',cleanPracticeUrl());
  document.body.classList.toggle('inner', INNER_VIEWS.includes(v));
  document.body.classList.toggle('hello', v==='hello');                // большая луна в фоне — только на приветствии
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on', s.id==='v-'+v));
  document.querySelectorAll('.app-nav button').forEach(b=>{const on=b.dataset.nav===v;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const active = $('v-'+v); if (active) requestAnimationFrame(()=>revealCommands(active));
  window.refreshMoonLogos?.();window.LunarioSky?.refresh();
  if(v==='account')XP.scroll.account=0;   /* открывается по кружку с любой вкладки — начинаем с шапки, а не с прошлой прокрутки */
  if(v==='home')window.tourMaybe?.();   /* подсказки по приложению — один раз, на «Сегодня» */
  restoreScroll(v);
  if(v==='home' && S.user?.onboarded){refreshHomeStatus();paintLunar();loadPushNote();paintYesterday();}
  if(v==='hello') paintHelloLive();
  if(v==='history') loadHistory();
  if(v==='about')loadAbout();
  if(v==='account')loadAccount();
}
function onboarded(){ return !!(S.user && S.user.onboarded); }
/* Фразы интерфейса из кабинета (интерфейс.txt): ui('ключ', 'как в коде'). Статичная разметка — data-ui, applyUi() после загрузки */
const ui=(k,f)=>(S.ui&&S.ui[k])||f;
function applyUi(){ if(!S.ui)return; document.querySelectorAll('[data-ui]').forEach(el=>{ const v=S.ui[el.dataset.ui]; if(v&&el.textContent!==v)el.textContent=v; }); }
/* Строка сегодняшнего дня на приветствии: «Сегодня 8-й лунный день · Растущая Луна» — по Москве, без входа */
async function paintHelloLive(){
  const el=$('hello-live'); if(!el||el.textContent)return;
  try{ const r=await api('/hello'); if(r.ui){ S.ui=r.ui; applyUi(); } const parts=[r.lunar?`${ordinal(r.lunar.n)} лунный день`:'',r.moon||''].filter(Boolean); if(parts.length){ el.textContent='Сегодня · '+parts.join(' · '); el.hidden=false; } }catch(e){ /* без строки приветствие не хуже */ }
}
function openForm(){
  $('v-onb').classList.remove('verifying-email');
  $('o-form').style.display=''; $('o-codebox').style.display='none';
  const askMail = S.mailReady && !S.user?.email;   /* почта уже привязана через «Уже пользовались?» — второй раз не спрашиваем */
  $('o-mailfield').style.display = askMail ? '' : 'none'; $('o-back').style.display = askMail ? '' : 'none';
  if (askMail) authMount('o-auth', { idle: obAuthIdle, onDone: obDone });
  obStep(0);
  go('onb'); track('onboard_start');
}
function openLogin(){
  $('l-box').style.display=''; $('l-after').style.display='none';
  authMount('l-box', { step: 'email', onDone: obDone });
  go('login'); track('login_open');
}

/* ── реестр функций: раздел и название панели, где живет (view), полноэкранная практика (page), ключ напоминания (reminder).
   Отсюда — заголовки, строка уведомлений под заголовком, полный экран и переход по ?open= из уведомления. ── */
let FEATURES = {};   /* backend/features.json — приходит с /api/me; одно место на клиент и сервер */
/* Цель из ?open= в уведомлении: ключ функции или ключ ее напоминания (moodreport → История настроений) */
function openTarget(key){
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
  paintWidgetArt(k);
  $('wg-tools').innerHTML='';   /* напоминаний по функциям нет — три пуша настраиваются в Аккаунте */
  $('wg').dataset.kind=k;$('wg').classList.add('on'); document.body.classList.add('wg-open');
  requestAnimationFrame(()=>{revealCommands(pane);document.querySelector('.wg-x')?.focus({preventScroll:true});});
  document.querySelector('#wg .wg').scrollTop = 0; hap();
  loadWidgetContent(k);
}
/* Что подгрузить при открытии панели; у виджетов без записи содержимое статично (карта дня рисуется с главной) */
const WIDGET_LOADERS = {
  appearance: () => paintAppearance(), wishes: () => loadWishes(), hentries: () => loadEntries(), week: () => loadWeek(''), hmood: () => loadMoodReport(),
  mood: () => { moodUI.precision=false; moodUI.mode='families'; renderMoods(); paintMoodExtra(); },
  habits: () => { habitView='today'; hbEditing=null; habitFormOpen=false; if(HB)paintHabits(); loadHabits(); },
  askesis: () => loadAskesis(), days: () => loadAllDays(), sky: () => loadSky(), lunar: () => paintLunarWidget(), gratitude: () => loadGratitude(), tone: () => loadTone(),
  day: () => { showForecastNote(); track('forecast_view'); }, worry: () => renderHub(), invite: () => loadInvite(), remind: () => paintAllReminders(), edit: () => fillEdit(),
  support: () => supOpen(), dayrune: () => loadDayRune(), card: () => paintCardPick(), natal: () => loadNatal(), year: () => loadNumerology(), birthnum: () => loadNumerology(),
};
function loadWidgetContent(k){ WIDGET_LOADERS[k]?.(); }
/* Картинка к функции из кабинета «Контент» (dayPack.art): наверху панели; ask — общая для Таро, рун и «Да / Нет» */
function artFor(k){ const a=S.day?.art||{}; return a[k]||(k==='spread'||k==='rune'||k==='yesno'?a.ask:'')||''; }
function paintWidgetArt(k){
  const body=$('wg-body'); if(!body)return;
  body.querySelector('.wg-art')?.remove();
  const src=artFor(k); if(!src)return;
  const img=document.createElement('img'); img.className='wg-art'; img.src=src; img.alt=''; img.loading='lazy'; img.decoding='async';
  body.prepend(img);
}
function paintHomeArt(){
  const el=$('h-art'); if(!el)return;
  const src=(S.day?.art||{}).home||'';
  el.hidden=!src; if(src&&el.getAttribute('src')!==src)el.src=src;
}
function closeWidget(e){
  if (e && e.target !== $('wg')) return;
  if (!wgOpen) return;
  if(typeof cancelPick==='function')cancelPick();   /* незавершенный выбор карт не оставит кнопку «занятой» (R11) */
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

const MATERIAL_NOTE='Материалы Лунарио помогают посмотреть на ситуацию иначе и не заменяют медицинскую, психологическую или юридическую помощь.';
document.querySelectorAll('[data-material-note]').forEach(el=>el.textContent=MATERIAL_NOTE);
function showForecastNote(){
  const box=$('forecast-note');if(!box)return;
  let seen=false;try{seen=localStorage.getItem('lun_forecast_note_'+S.user.id)==='1';}catch(e){}
  box.innerHTML=seen?'':`<p class="hint">${MATERIAL_NOTE}</p><button data-on="click:dismissForecastNote" class="btn ghost sm" type="button">Понятно</button>`;
}
function dismissForecastNote(){try{localStorage.setItem('lun_forecast_note_'+S.user.id,'1');}catch(e){}$('forecast-note').replaceChildren();}
async function exportPersonalData(){
  if(exportPersonalData.busy)return;exportPersonalData.busy=true;
  try{const r=await fetch(API+'/data/export.pdf');if(r.status===401){location.reload();return;}if(r.status===429){toast('Выгрузка уже готовится — подождите');return;}if(!r.ok)throw new Error('export');   /* очередь выгрузок занята (F09) */
    const blob=await r.blob(),url=URL.createObjectURL(blob);   /* читаемый PDF в стиле Лунарио; JSON для переноса — GET /api/data/export */
    const link=document.createElement('a');link.href=url;link.download='lunario-'+S.day.date+'.pdf';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Файл с вашими данными подготовлен');
  }catch(e){toast('Не получилось скачать');}finally{exportPersonalData.busy=false;}
}

/* снимок последнего удачного /me — только для аккаунта, который уже прошел анкету, и не старше суток */
function offlineSnapshot(){
  try { const s = JSON.parse(localStorage.getItem('lun_me') || 'null'); return s && s.r?.user?.onboarded && Date.now() - s.at < 26 * 3600e3 ? s : null; } catch(e) { return null; }
}
/* часы в статус-баре корпуса телефона (только на компьютере, декоративные) */
function frameClock(){const el=$('frame-clock');if(!el)return;const tick=()=>{el.textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});};tick();setInterval(tick,15000);}
frameClock();
