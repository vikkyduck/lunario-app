/* Reading, persistent preferences and full practice pages share the existing data and widgets. */
/* Настройки приходят из /api/me (умолчания — в backend/experience.mjs); до этого форма пустая */
const XP={prefs:{theme:'dark',ritual:[],topics:[],topicsAll:false,lunarViews:0},topicsShown:false,scroll:{},page:null,returnView:'home',returnFocus:null,wishPhoto:'',timeline:{kind:'',day:'',items:[],next:null,request:0}};
/* Практики ритуала: подпись кнопки «следующий шаг»; название и раздел — из реестра FEATURES */
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
  $('practice-tools').replaceChildren();   /* напоминаний по функциям нет — три пуша живут в Аккаунте */
  window.refreshMoonLogos?.();loadWidgetContent(key);restoreScroll('practice:'+key);$('practice-back').focus({preventScroll:true});
}
function practiceBack(){if(!XP.page)return;if(history.state?.lunPractice)history.back();else{const v=XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}}
window.addEventListener('popstate',e=>{
  if(e.state?.lunPractice){XP.returnView=e.state.lunView||'home';openPractice(e.state.lunPractice,true);return;}
  if(XP.page){const v=e.state?.lunView||XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}
});

function initExperience(prefs){XP.prefs=prefs||XP.prefs;applyTheme(XP.prefs.theme);applyTools();paintMorning();}
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
  $('appearance-box').innerHTML=`<p class="hint">Выберите тему для чтения</p><div class="theme-options">${[['light','Светлая'],['dark','Тёмная'],['system','Как на устройстве']].map(([key,label])=>`<button data-on="click:saveTheme-a0" data-a0="${key}" type="button" class="theme-option ${key}" aria-pressed="${XP.prefs.theme===key}"><span aria-hidden="true">Aa</span>${label}</button>`).join('')}</div><p class="saved-state" id="theme-state" role="status"></p>`;
}
async function savePreferences(value){const r=await api('/preferences',{method:'POST',body:JSON.stringify(value)});XP.prefs=r.preferences;return r;}
async function saveTheme(theme){
  if(saveTheme.busy)return;saveTheme.busy=true;
  try{await savePreferences({...XP.prefs,theme});applyTheme(theme);paintAppearance();$('theme-state').textContent='Тема сохранена';}
  catch{toast('Не удалось сохранить тему. Попробуйте ещё раз');}finally{saveTheme.busy=false;}
}
/* ── Инструменты: что человек оставил на «Сегодня» и в «Дневнике». Список — prefs.tools; нет списка — стартовый набор из
   каталога плюс прежний «ритуал» (чтобы у тех, кто уже пользуется, ничего не пропало). Только видимость: записи и напоминания не трогаются ── */
const toolCatalog=()=>(CAT&&CAT.tools)||[];
function toolsVisible(){
  if(Array.isArray(XP.prefs.tools))return new Set(XP.prefs.tools);
  return new Set([...toolCatalog().filter(t=>t.start).map(t=>t.key),...(XP.prefs.ritual||[])]);
}
function applyTools(){
  const vis=toolsVisible(),keys=new Set(toolCatalog().map(t=>t.key));
  document.querySelectorAll('#v-history [data-feature]').forEach(el=>{const k=el.dataset.feature;if(keys.has(k))el.hidden=!vis.has(k);});
  /* группа без единой видимой плитки прячется вместе с заголовком */
  document.querySelectorAll('#v-history .feature-group,#v-history .diary-library').forEach(g=>{const tiles=[...g.querySelectorAll('[data-feature]')];if(tiles.some(el=>keys.has(el.dataset.feature)))g.hidden=tiles.every(el=>el.hidden);});   /* «Итоги недели» и другие постоянные плитки держат группу открытой */
}
function paintTools(){
  const box=$('tools-box');if(!box)return;
  const vis=toolsVisible(),sections=[['history','Дневник']];
  box.innerHTML=sections.map(([sec,name])=>{const items=toolCatalog().filter(t=>t.section===sec);if(!items.length)return '';
    return `<section class="tools-group"><h3>${name}</h3>${items.map(t=>`<div class="tool-card${vis.has(t.key)?' on':''}"><b>${esc(t.title)}</b><p>${esc(t.text)}</p><div class="tool-actions"><button data-on="click:previewTool-a0" data-a0="${t.key}" class="text-action secondary" type="button">Посмотреть</button><button data-on="click:toggleTool-a0" data-a0="${t.key}" class="text-action" type="button" aria-pressed="${vis.has(t.key)}">${vis.has(t.key)?'Убрать':'Добавить'}</button></div></div>`).join('')}</section>`;}).join('');
}
async function toggleTool(key){
  if(toggleTool.busy)return;toggleTool.busy=true;
  const vis=toolsVisible(),add=!vis.has(key);if(add)vis.add(key);else vis.delete(key);
  const tools=toolCatalog().map(t=>t.key).filter(k=>vis.has(k));
  try{await savePreferences({...XP.prefs,tools});applyTools();paintTools();track(add?'tools_add':'tools_remove',key);
    const t=toolCatalog().find(x=>x.key===key);toast(add?`${t?t.title:'Инструмент'} — в разделе «${t&&t.section==='history'?'Дневник':'Сегодня'}»`:'Убрано с экрана. Записи сохранены');}
  catch{toast('Не удалось сохранить. Попробуйте ещё раз');}
  finally{toggleTool.busy=false;}
}
function previewTool(key){closeWidget();go(FEATURES[key]?.view||'home');openWidget(key);}

/* ── Утро на «Сегодня»: ответ на «На что хочу обращать внимание каждое утро?». Выбранные плитки — в ленте «Ваше утро» и в утреннем пуше,
   остальные — маленькими квадратами ниже. Карта и руна, если выбраны, тянутся утром сами, и от них считается тема дня ── */
const MORNING=[['card','Карта дня'],['dayrune','Руна дня'],['sky','Влияние планет'],['day','Прогноз дня'],['lunar','Луна'],['tone','Вопрос дня']];
function morningChosen(){return Array.isArray(XP.prefs.morning)?XP.prefs.morning.filter(k=>MORNING.some(m=>m[0]===k)):['lunar','tone'];}
function paintMorning(){
  const chips=$('morning-chips'),feed=$('morning-feed'),more=$('morning-more');if(!chips||!feed||!more)return;
  const chosen=morningChosen();
  chips.innerHTML=MORNING.map(([k,label])=>`<button data-on="click:toggleMorning-a0" data-a0="${k}" type="button" class="chip${chosen.includes(k)?' on':''}" aria-pressed="${chosen.includes(k)}">${label}</button>`).join('');
  for(const [k] of MORNING){const tile=document.querySelector('#v-home [data-feature="'+k+'"]');if(tile)(chosen.includes(k)?feed:more).appendChild(tile);}
  feed.closest('.feature-group').hidden=!chosen.length;more.closest('.feature-group').hidden=chosen.length===MORNING.length;
}
async function toggleMorning(key){
  if(toggleMorning.busy)return;toggleMorning.busy=true;
  const set=new Set(morningChosen());if(set.has(key))set.delete(key);else set.add(key);
  const morning=MORNING.map(m=>m[0]).filter(k=>set.has(k));
  try{await savePreferences({...XP.prefs,morning});paintMorning();track(set.has(key)?'morning_add':'morning_remove',key);
    if(set.has(key)&&(key==='card'||key==='dayrune')){const r=await api('/me');S.day=r.day;paintToday();}   /* карта или руна тянутся сразу; тема дня — с завтрашнего утра */
  }catch{toast('Не удалось сохранить. Попробуйте ещё раз');}
  finally{toggleMorning.busy=false;}
}

/* Фильтры ленты — по функции. «Карты и ответы» из дневника убраны (история «Свериться с собой» живёт там), «Практики» — тоже:
   отметки привычек и аскез вернутся в дневник своими фильтрами вместе с вечерней карточкой дня. Подписи записей — для всех видов. */
const TIMELINE_TYPES=[['','Все'],['journal','Записи'],['gratitude','Благодарности'],['answer','Вопрос дня'],['mood','Настроения'],['habits','Привычки'],['askesis','Аскезы'],['wishes','Желания']];
const TIMELINE_LABELS={journal:'Запись',gratitude:'Благодарность',answer:'Вопрос дня',mood:'Настроение',readings:'Карты и ответы',habits:'Привычка',askesis:'Аскеза',wishes:'Желание',weekly:'Итог недели'};
function timelineText(text){return text.length>400?`<details class="timeline-long"><summary><span class="entry-text">${esc(text.slice(0,230))}…</span><span class="text-action">Читать полностью</span></summary><p class="entry-text">${esc(text)}</p></details>`:`<p class="entry-text">${esc(text)}</p>`;}
function paintTimelineFilters(){
  $('timeline-filters').innerHTML=TIMELINE_TYPES.map(([key,label])=>`<button data-on="click:filterTimeline-a0" data-a0="${key}" class="chip" type="button" aria-pressed="${XP.timeline.kind===key}">${label}</button>`).join('');
  $('timeline-date').hidden=!XP.timeline.day;$('timeline-date').innerHTML=XP.timeline.day?`${fmtDay(XP.timeline.day)} <button data-on="click:showAllDiary" type="button" class="text-action">Все даты ×</button>`:'';
}
function filterTimeline(kind){XP.timeline.kind=kind;XP.timeline.day='';loadTimeline();}
function showAllDiary(){XP.timeline.day='';loadTimeline();}
function diaryDay(day){closeWidget();XP.timeline.day=day;XP.timeline.kind='';XP.timeline.dirty=true;XP.scroll.history=0;go('history');}
async function loadTimeline(more=false){
  const t=XP.timeline,request=++t.request;paintTimelineFilters();
  if(!more){t.dirty=false;if(!t.items.length)$('timeline-list').innerHTML='<p class="hint" role="status">Загружаем записи…</p>';}
  $('timeline-more').hidden=true;
  try{const q=new URLSearchParams({kind:t.kind,day:t.day,offset:String(more?t.next||0:0)});const r=await api('/timeline?'+q);if(request!==t.request)return;t.items=more?[...t.items,...r.items]:r.items;t.next=r.next;paintTimeline();}
  catch{if(request!==t.request)return;$('timeline-list').insertAdjacentHTML('beforeend','<p class="msg err">Записи не загрузились. <button data-on="click:loadTimeline" class="text-action">Повторить</button></p>');}
}
function paintTimeline(){
  const t=XP.timeline;const days=[];   /* день — одна карточка: заголовок с датой, внутри записи через тонкие линии */
  t.items.forEach((r,index)=>{
    if(r.kind==='readings')return;   /* карты и ответы — в «Свериться с собой», не в дневнике */
    const label=TIMELINE_LABELS[r.kind]||'';
    let content=r.source==='mood'?`<p class="entry-text">${esc(moodInfo(r.title)?.label||MOOD_LABEL[r.title]||r.title.replace(/^own:/,''))}</p>`:
      r.source==='entry'?`<button data-on="click:openTimelineEntry-a0" data-a0="${index}" type="button" class="timeline-link">${esc(r.body||r.title)} <span aria-hidden="true">→</span></button>`:
      `${r.title?`<p class="timeline-title">${esc(r.title)}</p>`:''}${r.body?timelineText(r.body):''}${r.source==='habit'?'<p class="hint">Выполнено</p>':''}${r.source==='askesis'?`<p class="hint">${r.data==='0'?'Сорвалась':'Держусь'}</p>`:''}${r.source==='wish'?`<button data-on="click:openWidget-wishes" class="text-action">${r.data==='1'?'Сбылось':'Открыть желание'} →</button>`:''}`;
    const last=days[days.length-1];
    if(r.source==='mood'&&last&&last.day===r.day&&last.moodEntry){last.moodEntry.push(content);return;}   /* несколько настроений за день — одной строкой */
    const html=`<article class="timeline-entry"><span class="timeline-kind">${esc(label)}</span>${content}</article>`;
    if(last&&last.day===r.day){last.parts.push(html);if(r.source==='mood')last.moodEntry=[content];}
    else days.push({day:r.day,parts:[html],moodEntry:r.source==='mood'?[content]:null});
  });
  const dayHtml=(d)=>{if(d.moodEntry&&d.moodEntry.length>1){const merged=`<article class="timeline-entry"><span class="timeline-kind">Настроение</span><p class="entry-text">${d.moodEntry.map(c=>c.replace(/<[^>]+>/g,'')).join(' · ')}</p></article>`;const i=d.parts.findIndex(p=>p.includes('>Настроение<'));if(i>=0)d.parts[i]=merged;}return d.parts.join('');};
  $('timeline-list').innerHTML=days.map(d=>`<section class="day-entry"><h2 class="timeline-day">${fmtDay(d.day)}</h2>${dayHtml(d)}</section>`).join('')||`<p class="hint timeline-empty">${t.day?'В этот день записей этого типа нет':t.kind?'Записей этого типа пока нет':'Здесь появятся ваши записи, настроение и история практик'}</p>`;
  $('timeline-more').hidden=t.next===null;
}
async function openTimelineEntry(index){
  const row=XP.timeline.items[index];if(!row)return;openWidget('timelineEntry');const box=$('timeline-entry-box');box.textContent='Загружаем…';
  try{const r=await api('/entries?id='+row.id);await loadCatalog();box.innerHTML=r.items[0]?entryHtml(r.items[0]):'<p>Запись не найдена</p>';preparePending();}
  catch{box.textContent='Не получилось загрузить запись. Попробуйте открыть её ещё раз';}
}

async function chooseWishPhoto(){const photo=await pickImage(1200,.82);if(!photo)return;XP.wishPhoto=photo;paintWishDraft();}
function paintWishDraft(){const box=$('wish-preview');box.innerHTML=XP.wishPhoto?`<img src="${XP.wishPhoto}" alt="Фото нового желания"><button data-on="click:XP-wishPhoto-paintWishDraft" type="button" class="text-action">Убрать фото</button>`:'';$('wish-photo-pick').textContent=XP.wishPhoto?'Заменить фото':'Добавить фото';}
function growTextarea(el){if(!el||el.tagName!=='TEXTAREA'||!el.getClientRects().length)return;const min=el.closest('.day-card')?56:160;   /* ячейки карточки дня — компактные */
  el.style.height='auto';el.style.height=Math.max(min,el.scrollHeight+2)+'px';}
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
