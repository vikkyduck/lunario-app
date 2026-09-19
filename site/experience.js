/* Reading, persistent preferences and full practice pages share the existing data and widgets. */
/* Настройки приходят из /api/me (умолчания — в backend/experience.mjs); до этого форма пустая */
const XP={prefs:{theme:'dark',ritual:[],topics:[],topicsAll:false,lunarViews:0},topicsShown:false,scroll:{},page:null,returnView:'home',returnFocus:null,wishPhoto:'',timeline:{dirty:false}};   /* timeline.dirty — записи менялись, «Прошлые дни» перечитать */
/* Практики ритуала: подпись кнопки «следующий шаг»; название и раздел — из реестра FEATURES */
function activeView(){return document.querySelector('.view.on')?.id.slice(2)||'home';}
/* что прокручивается: в корпусе телефона на компьютере (html.framed) — .wrap, на самом телефоне — окно */
function scroller(){return document.documentElement.classList.contains('framed')?document.querySelector('.wrap'):null;}
function scrollTopNow(){const s=scroller();return s?s.scrollTop:window.scrollY;}
function scrollToTop(y,behavior='auto'){const s=scroller();if(s)s.scrollTo({top:y,behavior});else window.scrollTo({top:y,behavior});}
function rememberScroll(){XP.scroll[XP.page?'practice:'+XP.page:activeView()]=scrollTopNow();}
function restoreScroll(key){requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToTop(XP.scroll[key]||0)));}
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
  { const src=typeof artFor==='function'?artFor(key):''; if(src){ const img=document.createElement('img'); img.className='wg-art'; img.src=src; img.alt=''; img.decoding='async'; $('practice-tools').appendChild(img); } }   /* картинка к практике из кабинета */
  window.refreshMoonLogos?.();loadWidgetContent(key);restoreScroll('practice:'+key);$('practice-back').focus({preventScroll:true});
}
function practiceBack(){if(!XP.page)return;if(history.state?.lunPractice)history.back();else{const v=XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}}
window.addEventListener('popstate',e=>{
  if(e.state?.lunPractice){XP.returnView=e.state.lunView||'home';openPractice(e.state.lunPractice,true);return;}
  if(XP.page){const v=e.state?.lunView||XP.returnView;go(v);XP.returnFocus?.focus({preventScroll:true});}
});

function initExperience(prefs){XP.prefs=prefs||XP.prefs;const forced=/[?&]theme=(light|dark|system)/.exec(location.search);applyTheme(forced?forced[1]:XP.prefs.theme);applyTools();paintMorning();}   /* ?theme= — разовый показ темы для проверок и скриншотов */
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
  $('appearance-box').innerHTML=`<p class="hint">Выберите тему для чтения</p><div class="theme-options">${[['light','Светлая'],['dark','Темная'],['system','Как на устройстве']].map(([key,label])=>`<button data-on="click:saveTheme-a0" data-a0="${key}" type="button" class="theme-option ${key}" aria-pressed="${XP.prefs.theme===key}"><span aria-hidden="true">Aa</span>${label}</button>`).join('')}</div><p class="saved-state" id="theme-state" role="status"></p>
    <div class="skin-row"><label class="rhythm-row"><input data-on="change:setSkin-this" type="checkbox" id="skin-compact" ${document.documentElement.dataset.skin==='compact'?'checked':''}><span class="grow"><b>Компактный вид</b><small>Строки вместо плиток, меньше кегль, навигация у края. Выключить — вернется обычный вид; помнится на этом устройстве</small></span></label></div>`;
}
function setSkin(el){const on=!!el.checked;try{localStorage.setItem('lun_skin',on?'compact':'classic');}catch{}if(on)document.documentElement.dataset.skin='compact';else delete document.documentElement.dataset.skin;track(on?'skin_compact_on':'skin_compact_off');}
async function savePreferences(value){const r=await api('/preferences',{method:'POST',body:JSON.stringify(value)});XP.prefs=r.preferences;return r;}
async function saveTheme(theme){
  if(saveTheme.busy)return;saveTheme.busy=true;
  try{await savePreferences({...XP.prefs,theme});applyTheme(theme);paintAppearance();$('theme-state').textContent='Тема сохранена';}
  catch{toast('Не удалось сохранить тему. Попробуйте еще раз');}finally{saveTheme.busy=false;}
}
/* ── Инструменты: что человек оставил в «Дневнике». Список — prefs.tools; нет списка — стартовый набор из каталога (сейчас пустой:
   вечер начинается с записи и настроения, остальное предлагается по одному). Прежний «ритуал» сюда больше не подмешивается —
   у кого была благодарность по ритуалу, получит ее предложением после ближайшей записи. Только видимость: записи не трогаются ── */
const toolCatalog=()=>(CAT&&CAT.tools)||[];
function toolsVisible(){
  if(Array.isArray(XP.prefs.tools))return new Set(XP.prefs.tools);
  return new Set(toolCatalog().filter(t=>t.start).map(t=>t.key));
}
/* Прячутся только страницы шагов-инструментов (привычки, аскеза — data-feature в разметке); полки — неделя, желания, история настроений —
   видны всегда: прятать чтение и породило «узнаю, только если прокручу вниз и раскрою список» */
function applyTools(){
  const vis=toolsVisible(),keys=new Set(toolCatalog().map(t=>t.key));
  document.querySelectorAll('#v-history [data-feature]').forEach(el=>{const k=el.dataset.feature;if(keys.has(k))el.hidden=!vis.has(k);});
  /* группа без единой видимой плитки прячется вместе с заголовком */
  document.querySelectorAll('#v-history .feature-group').forEach(g=>{const tiles=[...g.querySelectorAll('[data-feature]')];if(tiles.some(el=>keys.has(el.dataset.feature)))g.hidden=tiles.every(el=>el.hidden);});   /* «Итоги недели» и другие постоянные плитки держат группу открытой */
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
  catch{toast('Не удалось сохранить. Попробуйте еще раз');}
  finally{toggleTool.busy=false;}
}
function previewTool(key){closeWidget();go(FEATURES[key]?.view||'home');openWidget(key);}

/* ── Утро на «Сегодня»: ответ на «На что хочу обращать внимание каждое утро?». Выбранные плитки — в ленте «Ваше утро» и в утреннем пуше,
   остальные — маленькими квадратами ниже. Карта и руна, если выбраны, тянутся утром сами, и от них считается тема дня ── */
/* плитки утра и подписи их чипов — из разметки «Сегодня» (data-feature / data-chip): новая плитка добавляется там, списка здесь нет */
const MORNING=[...document.querySelectorAll('#morning-more [data-feature][data-chip]')].map(el=>[el.dataset.feature,el.dataset.chip]);
function morningChosen(){return Array.isArray(XP.prefs.morning)?XP.prefs.morning.filter(k=>MORNING.some(m=>m[0]===k)):['lunar','tone'];}
/* Плитки переезжают между «Ваше утро» и «Все про этот день» с места на место (FLIP): человек видит, куда ушла плитка, а не скачок.
   Чипы рисуются один раз и дальше только переключаются — фокус и озвучка «нажато» остаются на том же элементе */
function paintMorning(){
  const chips=$('morning-chips'),feed=$('morning-feed'),more=$('morning-more');if(!chips||!feed||!more)return;
  const chosen=morningChosen(),tiles=MORNING.map(([k])=>document.querySelector('#v-home [data-feature="'+k+'"]')).filter(Boolean);
  const animate=$('v-home')?.classList.contains('on')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before=animate?new Map(tiles.map(t=>[t,t.getBoundingClientRect()])):null;   /* где плитка видна сейчас — с учетом еще идущего переезда */
  if(animate)for(const t of tiles)t.getAnimations().forEach(a=>a.cancel());          /* дальше меряем чистую раскладку */
  if(!chips.children.length)chips.innerHTML=MORNING.map(([k,label])=>`<button data-on="click:toggleMorning-a0" data-a0="${k}" type="button" class="chip">${label}</button>`).join('');
  for(const c of chips.children){const on=chosen.includes(c.dataset.a0);c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on));}
  for(const t of tiles)(chosen.includes(t.dataset.feature)?feed:more).appendChild(t);
  more.dataset.count=String(more.children.length);   /* сколько квадратов осталось — для ровных рядов на телефоне */
  feed.closest('.feature-group').hidden=!chosen.length;more.closest('.feature-group').hidden=chosen.length===MORNING.length;
  /* вопрос задан, пока на него не ответили; после выбора — одна строка «Утром показываем…», развернуть можно всегда */
  const answered=Array.isArray(XP.prefs.morning),collapsed=!XP.morningOpen;   /* свернуто по умолчанию (по обзору 19.09): экран — для чтения, не для настроек */
  const picker=$('morning-picker'),summary=$('morning-summary');
  if(picker)picker.hidden=collapsed;if(summary){summary.hidden=!collapsed;$('morning-summary-list').textContent=chosen.length?chosen.map(k=>MORNING.find(m=>m[0]===k)[1]).join(' · '):'только настрой дня';}
  if($('morning-empty'))$('morning-empty').hidden=chosen.length>0;if($('morning-done'))$('morning-done').hidden=false;
  if(!before)return;
  const dur=320,easing='cubic-bezier(.2,.7,.2,1)';
  for(const t of tiles){const a=before.get(t),b=t.getBoundingClientRect();if(!a.width||!b.width)continue;const dx=a.left-b.left,dy=a.top-b.top,sx=a.width/b.width,sy=a.height/b.height;
    if(Math.abs(dx)<1&&Math.abs(dy)<1&&Math.abs(sx-1)<.02&&Math.abs(sy-1)<.02)continue;
    t.style.zIndex='2';t.style.pointerEvents='none';   /* летит поверх соседей, и наведение не ловит ее на полпути */
    const box=t.animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],{duration:dur,easing});
    if(Math.abs(sx-1)>.15||Math.abs(sy-1)>.15)for(const c of t.children)c.animate([{opacity:0},{opacity:0,offset:.35},{opacity:1}],{duration:dur,easing:'ease-out'});   /* коробка тянется, содержимое проявляется — без «желе» в тексте */
    box.onfinish=box.oncancel=()=>{t.style.zIndex='';t.style.pointerEvents='';};}
}
function morningEdit(){XP.morningOpen=true;paintMorning();requestAnimationFrame(()=>$('morning-chips')?.querySelector('.chip')?.focus({preventScroll:true}));track('morning_edit');}
function morningDone(){XP.morningOpen=false;paintMorning();requestAnimationFrame(()=>$('morning-summary')?.focus({preventScroll:true}));}
/* Переключение — сразу на экране, сохранение — следом; нажатий может быть несколько подряд, истиной становится ответ на последнее.
   Не сохранилось — плитка возвращается. Карта или руна тянутся сразу; тема дня и настрой — с завтрашнего утра, об этом говорим. */
const THEME_SOURCE={card:'по карте дня',dayrune:'по руне дня',sky:'по планетам'};
async function toggleMorning(key){
  const was=morningChosen(),set=new Set(was);if(set.has(key))set.delete(key);else set.add(key);
  const morning=MORNING.map(m=>m[0]).filter(k=>set.has(k));
  XP.prefs={...XP.prefs,morning};paintMorning();hap();
  const seq=toggleMorning.seq=(toggleMorning.seq||0)+1;
  try{const r=await api('/preferences',{method:'POST',body:JSON.stringify(XP.prefs)});if(seq!==toggleMorning.seq)return;XP.prefs=r.preferences;track(set.has(key)?'morning_add':'morning_remove',key);}
  catch{if(seq!==toggleMorning.seq)return;XP.prefs={...XP.prefs,morning:was};paintMorning();toast('Не удалось сохранить выбор. Попробуйте еще раз');return;}
  if(set.has(key)&&THEME_SOURCE[key]){
    const src=MORNING.map(m=>m[0]).find(k=>THEME_SOURCE[k]&&set.has(k));   /* первый выбранный источник по порядку карта → руна → планеты */
    if(src===key)toast(`Настрой ${THEME_SOURCE[key]} — с завтрашнего утра`);
    if(key==='card'||key==='dayrune'){try{const r=await api('/me');if(seq!==toggleMorning.seq)return;S.day=r.day;paintToday();paintMorningPostcard(S.day);paintHomeTheme(S.day);}catch{}}
  }
}

/* День из отчета настроений или недели — открытым днем (openDay в app.js); прежняя лента с фильтрами заменена строками «Прошлые дни» */
function diaryDay(day){openDay(day);}

async function chooseWishPhoto(){const photo=await pickImage(1200,.82);if(!photo)return;XP.wishPhoto=photo;paintWishDraft();}
function paintWishDraft(){const box=$('wish-preview');box.innerHTML=XP.wishPhoto?`<img src="${XP.wishPhoto}" alt="Фото нового желания"><button data-on="click:XP-wishPhoto-paintWishDraft" type="button" class="text-action">Убрать фото</button>`:'';$('wish-photo-pick').textContent=XP.wishPhoto?'Заменить фото':'Добавить фото';}
function growTextarea(el){if(!el||el.tagName!=='TEXTAREA'||!el.getClientRects().length)return;const min=el.closest('.day-card')?56:160;   /* ячейки карточки дня — компактные */
  el.style.height='auto';el.style.height=Math.max(min,el.scrollHeight+2)+'px';}
function enhanceInterface(root){
  // Labels and navigation cues follow the original controls when panes move or rerender.
  if(root.nodeType!==1)return;
  const fields=root.matches('.field')?[root]:[...root.querySelectorAll('.field')];
  for(const field of fields){const label=field.querySelector('label:not([for])'),input=field.querySelector('input[id],textarea[id],select[id]');if(label&&input)label.htmlFor=input.id;}
  const cards=(root.matches('.wid')?[root]:[...root.querySelectorAll('.wid')]).filter(c=>c.closest('.list-rows,#v-account .compact-links'));   /* «›» — только у строк-переходов */
  for(const card of cards)if(!card.querySelector('.destination-arrow')){const arrow=document.createElement('span');arrow.className='destination-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='›';card.appendChild(arrow);}
}
document.addEventListener('input',e=>growTextarea(e.target));
enhanceInterface(document.documentElement);
new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1){enhanceInterface(n);if(n.matches('textarea'))growTextarea(n);n.querySelectorAll('textarea').forEach(growTextarea);}}).observe(document.documentElement,{childList:true,subtree:true});
function keyboardViewport(){const v=window.visualViewport;document.documentElement.style.setProperty('--visible-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--keyboard-gap',Math.max(0,innerHeight-(v?.height||innerHeight)-(v?.offsetTop||0))+'px');}
window.visualViewport?.addEventListener('resize',keyboardViewport);window.addEventListener('resize',keyboardViewport);keyboardViewport();
