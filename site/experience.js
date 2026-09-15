/* Reading, persistent preferences and full practice pages share the existing data and widgets. */
/* Настройки приходят из /api/me (умолчания — в backend/experience.mjs); до этого форма пустая */
const XP={prefs:{theme:'dark',ritual:[],topics:[],topicsAll:false,lunarViews:0},topicsShown:false,scroll:{},page:null,returnView:'home',returnFocus:null,ritualDraft:null,wishPhoto:'',timeline:{kind:'',day:'',items:[],next:null,request:0}};
/* Практики ритуала: подпись кнопки «следующий шаг»; название и раздел — из реестра FEATURES */
const RITUALS={card:'Открыть карту дня',mood:'Отметить настроение',habits:'Отметить привычки',gratitude:'Записать благодарность',tone:'Ответить на вопрос дня',journal:'Записать мысль'};
function activeView(){return document.querySelector('.view.on')?.id.slice(2)||'home';}
function rememberScroll(){XP.scroll[XP.page?'practice:'+XP.page:activeView()]=window.scrollY;}
function restoreScroll(key){requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,XP.scroll[key]||0)));}
function leavePractice(){
  if(!XP.page)return;
  rememberScroll();if(XP.page==='journal'&&journalSpeech)stopJournalDictation();
  $('wg-store').appendChild($('w-'+XP.page));$('practice-tools').replaceChildren();XP.page=null;document.body.classList.remove('practice-open');
}
function cleanPracticeUrl(){const u=new URL(location.href);u.searchParams.delete('practice');return u.pathname+u.search+u.hash;}
function openPractice(key,fromHistory=false){
  closeWidget();const previous=XP.page,view=previous?XP.returnView:activeView();
  rememberScroll();if(!previous)XP.returnFocus=document.activeElement;
  leavePractice();XP.returnView=view;XP.page=key;
  if(!fromHistory){history.replaceState({lunView:view},'',cleanPracticeUrl());const u=new URL(location.href);u.searchParams.set('practice',key);history.pushState({lunPractice:key,lunView:view},'',u.pathname+u.search);}
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('on',el.id==='v-practice'));
  document.body.classList.add('inner','practice-open');
  $('practice-title').textContent=FEATURES[key].title;$('practice-body').appendChild($('w-'+key));
  const feature=FEATURES[key].reminder;$('practice-tools').innerHTML=feature?`<button class="text-action rem-summary" type="button" onclick="openPracticeSettings('${feature}')">Уведомления →</button>`:'';
  if(feature)refreshPracticeReminder();
  window.refreshMoonLogos?.();loadWidgetContent(key);restoreScroll('practice:'+key);$('practice-back').focus({preventScroll:true});
}
function practiceBack(){if(!XP.page)return;if(history.state?.lunPractice)history.back();else{const v=XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}}
window.addEventListener('popstate',e=>{
  if(e.state?.lunPractice){XP.returnView=e.state.lunView||'home';openPractice(e.state.lunPractice,true);return;}
  if(XP.page){const v=e.state?.lunView||XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}
});
function openPracticeSettings(feature){openWidget('practiceSettings');$('practice-settings-box').innerHTML=remBox(feature);remEditing[feature]=true;paintRem(feature);}
function refreshPracticeReminder(){
  const key=XP.page,feature=FEATURES[key]?.reminder;if(!feature)return;
  loadReminders().then(()=>{if(XP.page!==key)return;const tools=$('practice-tools');tools.innerHTML=remBox(feature);paintRem(feature);const button=tools.querySelector('.rem-summary');if(button){button.setAttribute('onclick',`openPracticeSettings('${feature}')`);button.removeAttribute('aria-controls');button.setAttribute('aria-haspopup','dialog');button.removeAttribute('aria-expanded');button.lastElementChild.textContent='→';tools.replaceChildren(button);}}).catch(()=>{});
}

function initExperience(prefs){XP.prefs=prefs||XP.prefs;applyTheme(XP.prefs.theme);paintNextStep();}
function applyTheme(mode){
  const theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;
  document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f0edf8':'#0b0a14';
  window.LunarioSky?.refresh();
  window.refreshMoonLogos?.();
  try{localStorage.setItem('lun_theme',mode);}catch{}
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(XP.prefs.theme==='system')applyTheme('system');});
function paintAppearance(){
  $('appearance-box').innerHTML=`<p class="hint">Выберите тему для чтения</p><div class="theme-options">${[['light','Светлая'],['dark','Тёмная'],['system','Как на устройстве']].map(([key,label])=>`<button type="button" class="theme-option ${key}" aria-pressed="${XP.prefs.theme===key}" onclick="saveTheme('${key}')"><span aria-hidden="true">Aa</span>${label}</button>`).join('')}</div><p class="saved-state" id="theme-state" role="status"></p>`;
}
async function savePreferences(value){const r=await api('/preferences',{method:'POST',body:JSON.stringify(value)});XP.prefs=r.preferences;return r;}
async function saveTheme(theme){
  if(saveTheme.busy)return;saveTheme.busy=true;
  try{await savePreferences({...XP.prefs,theme});applyTheme(theme);paintAppearance();$('theme-state').textContent='Тема сохранена';}
  catch{toast('Не удалось сохранить тему. Попробуйте ещё раз');}finally{saveTheme.busy=false;}
}
function ritualDone(key){return {card:!!S.day?.card,mood:!!S.mood,habits:!!S.habitsReady&&S.habitsPending===0&&S.habitsCount>0,gratitude:!!S.gratitudeDone,tone:!!toneSaved||!!S.answerDone,journal:!!S.journalDone}[key];}
function ritualNext(){const key=XP.prefs.ritual.find(k=>!ritualDone(k));return key?{key,view:FEATURES[key].view,label:RITUALS[key]}:null;}
function paintRitual(){
  if(!XP.ritualDraft)XP.ritualDraft=[...XP.prefs.ritual];
  $('ritual-box').innerHTML=`<p class="hint">Выберите 2–3 практики. Они будут открываться с главной кнопки в выбранном порядке.</p><div class="ritual-options">${Object.keys(RITUALS).map((key)=>{const n=XP.ritualDraft.indexOf(key);return `<button class="ritual-option" type="button" aria-pressed="${n>=0}" onclick="toggleRitual('${key}')"><span>${esc(FEATURES[key].title)}</span><span aria-hidden="true">${n>=0?n+1:'＋'}</span></button>`;}).join('')}</div><p id="ritual-count" class="hint" role="status">Выбрано ${XP.ritualDraft.length} из 3</p><button class="btn" id="ritual-save" onclick="saveRitual()" ${XP.ritualDraft.length<2?'disabled':''}>Сохранить ритуал</button>`;
}
function toggleRitual(key){const i=XP.ritualDraft.indexOf(key);if(i>=0)XP.ritualDraft.splice(i,1);else if(XP.ritualDraft.length<3)XP.ritualDraft.push(key);else{$('ritual-count').textContent='Уже выбраны 3 практики. Уберите одну, чтобы выбрать другую';return;}paintRitual();}
async function saveRitual(){
  if(saveRitual.busy)return;saveRitual.busy=true;$('ritual-save').disabled=true;
  try{await savePreferences({...XP.prefs,ritual:[...XP.ritualDraft]});XP.ritualDraft=null;paintNextStep();closeWidget();toast('Ритуал сохранён');}
  catch{toast('Не удалось сохранить. Ваш выбор остался');}finally{saveRitual.busy=false;if($('ritual-save'))$('ritual-save').disabled=false;}
}

const TIMELINE_TYPES=[['','Все'],['journal','Записи'],['gratitude','Благодарности'],['answer','Вопрос дня'],['mood','Настроения'],['readings','Карты и ответы'],['practices','Практики'],['wishes','Желания']];
function timelineText(text){return text.length>400?`<details class="timeline-long"><summary><span class="entry-text">${esc(text.slice(0,230))}…</span><span class="text-action">Читать полностью</span></summary><p class="entry-text">${esc(text)}</p></details>`:`<p class="entry-text">${esc(text)}</p>`;}
function paintTimelineFilters(){
  $('timeline-filters').innerHTML=TIMELINE_TYPES.map(([key,label])=>`<button class="chip" type="button" aria-pressed="${XP.timeline.kind===key}" onclick="filterTimeline('${key}')">${label}</button>`).join('');
  $('timeline-date').hidden=!XP.timeline.day;$('timeline-date').innerHTML=XP.timeline.day?`${fmtDay(XP.timeline.day)} <button type="button" class="text-action" onclick="showAllDiary()">Все даты ×</button>`:'';
}
function filterTimeline(kind){XP.timeline.kind=kind;loadTimeline();}
function showAllDiary(){XP.timeline.day='';loadTimeline();}
function diaryDay(day){closeWidget();XP.timeline.day=day;XP.timeline.kind='';XP.timeline.dirty=true;XP.scroll.history=0;go('history');}
async function loadTimeline(more=false){
  const t=XP.timeline,request=++t.request;paintTimelineFilters();
  if(!more){t.dirty=false;if(!t.items.length)$('timeline-list').innerHTML='<p class="hint" role="status">Загружаем записи…</p>';}
  $('timeline-more').hidden=true;
  try{const q=new URLSearchParams({kind:t.kind,day:t.day,offset:String(more?t.next||0:0)});const r=await api('/timeline?'+q);if(request!==t.request)return;t.items=more?[...t.items,...r.items]:r.items;t.next=r.next;paintTimeline();}
  catch{if(request!==t.request)return;$('timeline-list').insertAdjacentHTML('beforeend','<p class="msg err">Записи не загрузились. <button class="text-action" onclick="loadTimeline()">Повторить</button></p>');}
}
function paintTimeline(){
  const t=XP.timeline;let prev='';
  $('timeline-list').innerHTML=t.items.map((r,index)=>{
    const heading=r.day!==prev?`<h2 class="timeline-day">${fmtDay(r.day)}</h2>`:'';prev=r.day;
    const label=TIMELINE_TYPES.find(([key])=>key===r.kind)?.[1]||'';
    let content=r.source==='mood'?`<p class="entry-text">${esc(moodInfo(r.title)?.label||MOOD_LABEL[r.title]||r.title.replace(/^own:/,''))}</p>`:
      r.source==='entry'?`<button type="button" class="timeline-link" onclick="openTimelineEntry(${index})">${esc(r.body||r.title)} <span aria-hidden="true">→</span></button>`:
      `${r.title?`<p class="timeline-title">${esc(r.title)}</p>`:''}${r.body?timelineText(r.body):''}${r.source==='habit'?'<p class="hint">Выполнено</p>':''}${r.source==='wish'?`<button class="text-action" onclick="openWidget('wishes')">${r.data==='1'?'Сбылось':'Открыть желание'} →</button>`:''}`;
    return heading+`<article class="timeline-entry"><span class="timeline-kind">${esc(label)}</span>${content}</article>`;
  }).join('')||`<p class="hint timeline-empty">${t.day?'В этот день записей этого типа нет':t.kind?'Записей этого типа пока нет':'Здесь появятся ваши записи, настроение и история практик'}</p>`;
  $('timeline-more').hidden=t.next===null;
}
async function openTimelineEntry(index){
  const row=XP.timeline.items[index];if(!row)return;openWidget('timelineEntry');const box=$('timeline-entry-box');box.textContent='Загружаем…';
  try{const r=await api('/entries?id='+row.id);await loadCatalog();box.innerHTML=r.items[0]?entryHtml(r.items[0]):'<p>Запись не найдена</p>';preparePending();}
  catch{box.textContent='Не получилось загрузить запись. Попробуйте открыть её ещё раз';}
}

async function chooseWishPhoto(){const photo=await pickImage(1200,.82);if(!photo)return;XP.wishPhoto=photo;paintWishDraft();}
function paintWishDraft(){const box=$('wish-preview');box.innerHTML=XP.wishPhoto?`<img src="${XP.wishPhoto}" alt="Фото нового желания"><button type="button" class="text-action" onclick="XP.wishPhoto='';paintWishDraft()">Убрать фото</button>`:'';$('wish-photo-pick').textContent=XP.wishPhoto?'Заменить фото':'Добавить фото';}
function growTextarea(el){if(!el||el.tagName!=='TEXTAREA'||!el.getClientRects().length)return;el.style.height='auto';el.style.height=Math.max(160,el.scrollHeight+2)+'px';}
function enhanceInterface(root){
  // Labels and navigation cues follow the original controls when panes move or rerender.
  if(root.nodeType!==1)return;
  const fields=root.matches('.field')?[root]:[...root.querySelectorAll('.field')];
  for(const field of fields){const label=field.querySelector('label:not([for])'),input=field.querySelector('input[id],textarea[id],select[id]');if(label&&input)label.htmlFor=input.id;}
  const cards=root.matches('.wid')?[root]:[...root.querySelectorAll('.wid')];
  for(const card of cards)if(!card.querySelector('.destination-arrow')){const arrow=document.createElement('span');arrow.className='destination-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='›';card.appendChild(arrow);}
}
document.addEventListener('input',e=>growTextarea(e.target));
enhanceInterface(document.documentElement);
new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1){enhanceInterface(n);if(n.matches('textarea'))growTextarea(n);n.querySelectorAll('textarea').forEach(growTextarea);}}).observe(document.documentElement,{childList:true,subtree:true});
function keyboardViewport(){const v=window.visualViewport;document.documentElement.style.setProperty('--visible-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--keyboard-gap',Math.max(0,innerHeight-(v?.height||innerHeight)-(v?.offsetTop||0))+'px');}
window.visualViewport?.addEventListener('resize',keyboardViewport);window.addEventListener('resize',keyboardViewport);keyboardViewport();
