/* Лунарио — Вкладка «Дневник»: карточка дня, прошлые дни, настроения, неделя */
/* ══════════ «Моя неделя: про что она» — воскресный экран Дневника: пять частей по фактам, без интерпретаций ══════════ */
const WK={data:null,pick:'',pending:''};
const WK_DOW=['пн','вт','ср','чт','пт','сб','вс'];
const WK_MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const wkDate=(d,month=true)=>{const [,m,dd]=d.split('-').map(Number);return month?`${dd} ${WK_MONTHS[m-1]}`:String(dd);};
const wkRange=(a,b)=>a.slice(0,7)===b.slice(0,7)?`${wkDate(a,false)}–${wkDate(b)}`:`${wkDate(a)} – ${wkDate(b)}`;
const WK_KIND={'':'запись',gratitude:'благодарность',answer:'ответ на вопрос дня',thought:'мысль'};
const WK_VERDICT=[['yes','Отозвалось'],['no','Не связано'],['unsure','Не уверена']];
async function loadWeek(pick){
  if(pick!==undefined)WK.pick=pick; if(WK.pending){WK.pick=WK.pending;WK.pending='';}   /* открыть неделю конкретного дня — из «Итога недели» в дне */
  const box=$('week-box');if(!box)return;if(!WK.data)box.innerHTML='<p class="hint" role="status">Собираем неделю…</p>';
  try{WK.data=await api('/week'+(WK.pick?'?week='+WK.pick:''));paintWeek();}
  catch(e){box.innerHTML='<p class="msg err">Неделя не загрузилась. <button data-on="click:loadWeek" class="btn ghost sm" type="button">Повторить</button></p>';}
}
function weekShift(n){const w=WK.data?.week;if(!w)return;loadWeek(new Date(Date.parse(w.start+'T12:00:00Z')+Number(n)*7*864e5).toISOString().slice(0,10));}
function paintWeek(){
  const w=WK.data,box=$('week-box');if(!w||!box)return;
  const nav=`<div class="week-nav"><button data-on="click:weekShift-a0" data-a0="-1" type="button" class="btn ghost sm">← прошлая</button><span class="eyebrow">${wkRange(w.week.start,w.week.end)}</span>${w.week.current?'<span></span>':'<button data-on="click:weekShift-a0" data-a0="1" type="button" class="btn ghost sm">следующая →</button>'}</div>`;
  const quote=(f)=>`<blockquote class="week-quote"><small>${wkDate(f.day)} · ${WK_KIND[f.kind]||''}${f.kind==='thought'&&f.name?' · '+esc(f.name):''}</small><p>${esc(f.text)}</p></blockquote>`;   /* мысль — с именем материала: видно, к чему она */
  const saved=w.saved.length?`<section class="card week-part"><h3>Что вы сохранили</h3>${w.saved.map(quote).join('')}</section>`:'';
  const carried=w.reflection.previous?`<section class="card week-part week-carried"><span class="eyebrow">С прошлой недели</span><p class="t2">${quoted(w.reflection.previous)}</p></section>`:'';
  /* черновик рефлексии живет на устройстве до подтвержденного сохранения (аудит v98, F06): закрыть панель и обновить страницу — текст на месте */
  const draft=draftGet('week',w.week.start), reflectText=draft!==null?draft:w.reflection.text;
  const reflect=`<section class="card week-part"><h3>${esc(w.reflection.question)}</h3><div class="field"><textarea data-on="input:wkReflectInput-this" id="wk-reflect" maxlength="2000" rows="2">${esc(reflectText)}</textarea></div><div class="answer-actions"><button data-on="click:saveWeekReflection" class="btn sm" id="wk-reflect-save" type="button">Сохранить</button></div><p class="hint" id="wk-reflect-state" role="status">${draft!==null&&draft!==w.reflection.text?'Черновик восстановлен — не сохранен':''}</p></section>`;
  /* разделы — по наличию данных, а не по режиму (F08): неделя с одной мыслью или одной отметкой показывает ее, вступление говорит, сколько всего */
  const intro=w.mode!=='full'?`<section class="card week-part"><p class="t2">${esc(w.text)}</p></section>`:'';
  const days=w.moods.days;
  const moods=`<section class="card week-part"><h3>Настроение недели</h3>${w.moods.count?`<div class="week-strip" aria-hidden="true">${days.map((d,i)=>`<div class="week-col${d.day>w.week.today?' future':''}"><span class="week-dow">${WK_DOW[i]}</span><span class="week-dot ${d.moods.length?'done':'none'}"></span></div>`).join('')}</div><div class="week-mood-list">${days.map((d,i)=>d.moods.length?`<p><b>${WK_DOW[i]}</b>${d.moods.map(esc).join(' · ')}</p>`:'').join('')}</div>${w.moods.top[0]?.count>1?`<p class="hint">Чаще всего — ${w.moods.top.filter(t=>t.count===w.moods.top[0].count).map(t=>esc(t.mood)).join(', ')}: ${w.moods.top[0].count} ${plural(w.moods.top[0].count,'день','дня','дней')} из ${w.moods.count}</p>`:`<p class="hint">${w.moods.count===1?'Отметка за один день':`Отметки за ${w.moods.count} ${plural(w.moods.count,'день','дня','дней')} — настроения не повторялись`}</p>`}`:'<p class="hint">Настроение на этой неделе не отмечали</p>'}</section>`;
  const echoes=`<section class="card week-part"><h3>Что отозвалось</h3>${w.echoes.length?w.echoes.map(e=>`<div class="week-echo" data-day="${e.day}"><small><button data-on="click:openDay-a0" data-a0="${e.day}" class="week-daylink" type="button">${wkDate(e.day)} →</button>${e.source?' · '+esc(e.source):''}</small><p><span class="week-when">Утром</span> ${esc(e.morning)}</p><p><span class="week-when">Вечером</span> ${esc(e.evening)}</p><div class="chips flow">${WK_VERDICT.map(([k,l])=>`<button data-on="click:weekEcho-a0-a1" data-a0="${e.day}" data-a1="${k}" type="button" class="chip${e.verdict===k?' on':''}" aria-pressed="${e.verdict===k}">${l}</button>`).join('')}</div></div>`).join(''):'<p class="hint">Пар «утро ↔ вечер» пока не набралось: для них нужны настрой утром и запись вечером</p>'}</section>`;
  const dots=(list,cls)=>`<div class="week-dots" aria-hidden="true">${days.map(d=>`<span class="week-dot ${cls(list.find(x=>x.day===d.day))}"></span>`).join('')}</div>`;
  const habits=w.rhythm.habits.map(h=>`<div class="week-row"><div class="grow"><b>${esc(h.title)}</b><small>${h.due?`${h.done} из ${h.due} ${plural(h.due,'дня','дней','дней')}`:`${h.done} ${plural(h.done,'день','дня','дней')}`}</small></div>${dots(h.days,x=>!x?'none':x.done?'done':'due')}</div>`).join('');
  const askesis=w.rhythm.askesis.map(a=>`<div class="week-row"><div class="grow"><b>${esc(a.title)}</b><small>${a.days.length?`держусь — ${a.kept}${a.missed?` · сорвалась — ${a.missed}`:''}`:'отметок на этой неделе нет'}</small></div>${dots(a.days,x=>!x?'none':x.kept?'done':'missed')}</div>`).join('');
  const rhythm=habits||askesis?`<section class="card week-part"><h3>Ваш ритм</h3>${habits}${askesis}${w.rhythm.phrase?`<p class="hint week-phrase">${esc(w.rhythm.phrase)}</p>`:''}</section>`:'';
  box.innerHTML=nav+carried+intro+(w.mode==='full'||w.moods.count?moods:'')+saved+(w.mode==='full'||w.echoes.length?echoes:'')+rhythm+reflect;growTextarea($('wk-reflect'));
}
function wkReflectInput(el){ growTextarea(el); if(WK.data)draftSet('week',WK.data.week.start,el.value===WK.data.reflection.text?'':el.value); }
/* неделя конкретного дня — из строки «Итог недели» в открытом дне */
function openWeekAt(day){ WK.pending=day; if(!$('v-history')?.classList.contains('on'))go('history'); openWidget('week'); }
/* отметка «отозвалось»: повторное нажатие снимает */
async function weekEcho(day,verdict){
  const cur=WK.data?.echoes.find(e=>e.day===day);const next=cur&&cur.verdict===verdict?'':verdict;
  try{const r=await api('/week/echo',{method:'POST',body:JSON.stringify({day,verdict:next})});if(cur)cur.verdict=r.verdict;
    document.querySelectorAll(`.week-echo[data-day="${day}"] .chip`).forEach(b=>{const on=b.dataset.a1===r.verdict;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});hap('ok');}
  catch(e){toast('Не получилось отметить');}
}
async function saveWeekReflection(){
  if(saveWeekReflection.busy||!WK.data)return;saveWeekReflection.busy=true;const btn=$('wk-reflect-save');btn.disabled=true;
  try{const r=await api('/week/reflect',{method:'POST',body:JSON.stringify({week:WK.data.week.start,text:$('wk-reflect').value})});WK.data.reflection=r;
    draftClear('week',WK.data.week.start); $('wk-reflect-state').textContent=r.text?'Сохранено ✦ Строка в дневнике под датой воскресенья':'Строка снята';hap('ok');XP.timeline.dirty=true;}
  catch(e){$('wk-reflect-state').textContent=ERR_SAVE_KEPT;}
  finally{saveWeekReflection.busy=false;btn.disabled=false;}
}
/* «Моя неделя» — кнопкой у «Прошлых дней» (плитка «Неделя собралась» по воскресеньям снята, решение владелицы 20.09) */

/* ══════════ Карточка дня «Запомнить этот день» — по шагам (решение владелицы 18.09): один вопрос на экран, «Дальше», в конце
   праздник и день в режиме чтения. Данные — те же типы и тот же один запрос POST /api/day, что и раньше; ни один шаг не обязателен,
   пустое не сохраняется. Черновик живет в localStorage до сохранения: звонок в 21:03 не стирает написанное. ══════════ */
const DC={state:null,forDay:null,mode:'steps',step:0,text:'',gratitude:'',answer:'',moods:new Set(),own:'',ownOpen:false,habits:new Map(),askesis:new Map(),touched:{habits:new Set(),askesis:new Set()},echo:'',bridge:undefined,dirty:false};
const addDaysC=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const yesterdayC=()=>S.day?addDaysC(S.day.date,-1):'';
/* Шаги вечера. База — «пара строк» и настроение, у всех и всегда. Остальное — инструменты: благодарность, привычки, аскеза
   включаются в строке «Вечером записываю» (preferences.tools), вопрос дня следует за утренней плиткой «Вопрос дня» (один выбор —
   два места). Порядок фиксированный, от легкого к трудному; человек выбирает состав, не очередность. */
/* По умолчанию вечер — одно настроение (решение владелицы 19.09); все остальное — практики, которые человек включает сам */
const stepOrder=()=>['mood','text','gratitude','answer','habits','askesis'];
const TOOL_OF={text:'journal'};   /* ключ шага → ключ в каталоге инструментов */
const STEP_NAME={text:'Запись',mood:'Настроение',gratitude:'Благодарность',answer:'Вопрос дня',habits:'Привычки',askesis:'Аскеза',photo:'Фото'};
/* «Фото дня» — не шаг, а вложение первого шага: кнопка камеры рядом с микрофоном; инструмент, выключен у нового человека */
const EVENING_EXTRAS=['photo'];
const CAM_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const STEP_TOOLS=['text','gratitude','answer','habits','askesis'];   /* шаги из каталога инструментов */
const DC_Q={text:'Что хочется оставить от этого дня?',mood:'Как вы сегодня?',gratitude:'Кому и за что вы сегодня благодарны?',answer:'Вопрос дня',habits:'Привычки сегодня',askesis:'Аскеза'};
const DC_PLACEHOLDER={text:'Пара строк — хватит',gratitude:'Кому и за что',answer:'Своими словами'};
const ECHO_LABEL={yes:'Отозвалось',no:'Не связано',unsure:'Не уверена'};
const MIC_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
/* «пятница, 18 сентября» — как на «Сегодня»; cap — с заглавной для заголовков */
const fmtDayWords=(d,cap=false)=>{const s=new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});return cap?s[0].toUpperCase()+s.slice(1):s;};
const stepOn=(key)=>key==='mood'?true:toolsVisible().has(TOOL_OF[key]||key);   /* все практики, включая вопрос дня и фото, — по выбору человека */
const eveningStepsOn=()=>stepOrder().filter(stepOn);
/* черновик — свой у каждого аккаунта на устройстве, шаг по имени (состав шагов может меняться) */
const dcDraftKey=()=>'lun_dc_draft_'+(S.user?.id||0);
function dcSaveDraft(){ if(!DC.state)return; try{ localStorage.setItem(dcDraftKey(),JSON.stringify({day:DC.state.day,stepKey:(dcSteps()[DC.step]||{}).key||'text',text:DC.text,gratitude:DC.gratitude,answer:DC.answer,moods:[...DC.moods],own:DC.own,echo:DC.echo,
  habits:[...DC.touched.habits].map(id=>[id,!!DC.habits.get(id)]),askesis:[...DC.touched.askesis].map(id=>[id,DC.askesis.get(id)])})); }catch(e){} }
function dcLoadDraft(day){ try{ const d=JSON.parse(localStorage.getItem(dcDraftKey())||'null'); return d&&d.day===day?d:null; }catch(e){ return null; } }
function dcClearDraft(){ try{ localStorage.removeItem(dcDraftKey()); }catch(e){} }
const dcWritten=(s)=>!!(s&&(s.text||s.gratitude||s.answer||s.moods.length));
async function loadDayCard(keepStep=false){
  const box=$('day-card'); if(!box)return;
  if(!DC.state)box.innerHTML='<p class="hint">Загружаем сегодняшний день…</p>';
  try{ const wasStep=DC.step, wasMode=DC.mode; DC.state=await api(DC.forDay?'/day?day='+DC.forDay:'/day'); dcFromState(); if(keepStep){DC.step=wasStep;DC.mode=wasMode;} if(DC.forDay&&!keepStep){DC.mode='steps';DC.step=0;} paintDayCard(); paintEveningSet(); }
  catch(e){ box.innerHTML=e.code==='not_editable'?`<p class="hint">${fmtDayWords(DC.forDay||'',true)} — только для чтения: поправить можно дни за последний год</p><button data-on="click:dcToday" class="btn ghost sm mt-3" type="button">К сегодняшнему дню →</button>`:'<p class="hint">Не получилось загрузить день</p><button data-on="click:loadDayCard" class="btn ghost sm mt-3" type="button">Повторить</button>'; }
}
/* Значения с сервера + черновик; записанный день без черновика открывается для чтения */
function dcFromState(){
  const s=DC.state, draft=dcLoadDraft(s.day);
  DC.text=s.text?s.text.text:''; DC.gratitude=s.gratitude?s.gratitude.text:''; DC.answer=s.answer?s.answer.text:'';
  if(!DC.forDay)answerFrom(s.answer,s.day);   /* панель и карточка на «Сегодня» знают тот же ответ */
  DC.moods=new Set(s.moods.filter(m=>!m.startsWith('own:'))); DC.own=s.moods.filter(m=>m.startsWith('own:')).map(m=>m.slice(4)).join(', '); DC.ownOpen=!!DC.own;
  DC.habits=new Map(s.habits.map(h=>[h.id,h.today])); DC.askesis=new Map(s.askesis.map(a=>[a.id,{kept:a.kept,note:a.note}])); DC.touched={habits:new Set(),askesis:new Set()}; DC.echo=s.echo||'';
  /* черновик — последнее намерение человека на этом устройстве, он главнее сервера за тот же день (аудит v98, F07): поле восстанавливается
     по наличию ключа (пустая строка — тоже значение), выбранные настроения заменяют серверные, а не сливаются с ними */
  if(draft){
    for(const k of ['text','gratitude','answer','own'])if(k in draft)DC[k]=draft[k]||''; if(Array.isArray(draft.moods))DC.moods=new Set(draft.moods); if('echo' in draft)DC.echo=draft.echo||''; DC.ownOpen=!!DC.own;
    for(const [id,done] of draft.habits||[]){ if(DC.habits.has(id)){DC.habits.set(id,done);DC.touched.habits.add(id);} }
    for(const [id,v] of draft.askesis||[]){ if(DC.askesis.has(id)&&v){DC.askesis.set(id,v);DC.touched.askesis.add(id);} }
    const i=dcSteps().findIndex(st=>st.key===draft.stepKey); DC.step=Math.max(0,i); DC.mode='steps'; DC.dirty=true;
  } else { DC.step=0; DC.dirty=false; DC.mode=dcWritten(s)?'done':'steps'; }
}
/* Шаги сегодняшнего вечера: база + включенные инструменты. Привычки: включены, а привычек нет — шаг предлагает завести первую;
   есть, но сегодня ничего не по расписанию — шага нет. Аскеза — так же. */
function dcSteps(){
  const s=DC.state, out=[];
  for(const key of eveningStepsOn()){
    if(key==='habits'){ if(!s.habits.length)out.push({key,create:true}); else if(s.habits.some(h=>h.due||h.rule==='free'||h.today))out.push({key}); continue; }
    if(key==='askesis'){ if(DC.forDay&&!s.askesis.length)continue; out.push(s.askesis.length?{key}:{key,create:true}); continue; }
    if(key==='answer'&&DC.forDay&&!s.question)continue;   /* у прошлого дня вопрос — только если он тогда был */
    if(key==='habits'&&DC.forDay&&!s.habits.length)continue;
    out.push({key});
  }
  return out;
}
function dcFilled(key){
  if(key==='text')return !!DC.text.trim(); if(key==='gratitude')return !!DC.gratitude.trim(); if(key==='answer')return !!DC.answer.trim();
  if(key==='mood')return DC.moods.size>0||!!DC.own.trim()||!!DC.echo; if(key==='habits')return [...DC.habits.values()].some(Boolean); if(key==='askesis')return [...DC.askesis.values()].some(v=>v.kept!==null);
  return false;
}
function paintDayCard(){
  const s=DC.state, box=$('day-card'); if(!s||!box)return;
  if(DC.mode==='done'){ paintDayDone(); return; }
  box.classList.remove('done'); const da=$('diary-action'); if(da){ da.hidden=true; da.innerHTML=''; }
  if(DC.mode==='celebrate'){ paintDayParty(); return; }
  const steps=dcSteps(); DC.step=Math.min(DC.step,steps.length-1); const i=DC.step, step=steps[i], last=i===steps.length-1;
  const dots=`<div class="dc-dots" aria-hidden="true">${steps.map((_,k)=>`<i class="${k<i?'done':k===i?'on':''}"></i>`).join('')}</div>
    <p class="dc-names" aria-label="Шаги вечера">${steps.map((st,k)=>`<span class="${k===i?'on':k<i?'done':''}">${STEP_NAME[st.key]}</span>`).join('<i>·</i>')}</p>`;
  const dayLabel=DC.forDay?(DC.forDay===yesterdayC()?`Вчера · ${fmtDayWords(s.day)}`:`${fmtDayWords(s.day)} · правим`):fmtDayWords(s.day);
  const head=`<div class="dc-head"><span class="eyebrow">${dayLabel}</span>${DC.forDay?'<button data-on="click:dcToday" class="btn ghost sm" type="button">К сегодня</button>':''}</div>${dots}`;
  const echo=s.set?`<p class="dc-echo">Утром: <b>${quoted(s.set)}</b></p>`:'';
  const area=(id,val,ph)=>`<div class="dc-wrap${id==='text'&&stepOn('photo')?' with-cam':''}"><textarea data-on="input:dcInput-a0" data-a0="${id}" id="dc-${id}" maxlength="2000" rows="3" placeholder="${esc(ph)}" aria-label="${esc(DC_Q[id])}">${esc(val)}</textarea>${id==='text'&&stepOn('photo')?`<button data-on="click:dcPickPhoto" class="dc-mic dc-cam" id="dc-cam" type="button" aria-label="Добавить фото дня">${CAM_SVG}</button>`:''}<button data-on="click:dcDictate-a0" data-a0="dc-${id}" class="dc-mic" id="dc-mic" type="button" aria-label="Продиктовать" aria-pressed="false">${MIC_SVG}</button></div><p id="dc-speech-note" class="dc-hint" hidden></p>`;
  let body='';
  if(step.key==='text') body=`${echo}<p class="dc-q">${ui('diary.text',DC_Q.text)}</p>${area('text',DC.text,DC_PLACEHOLDER.text)}${stepOn('photo')?dcPhotoHtml():''}`;
  else if(step.key==='gratitude') body=`<p class="dc-q">${ui('diary.gratitude',DC_Q.gratitude)}</p>${area('gratitude',DC.gratitude,DC_PLACEHOLDER.gratitude)}`;
  else if(step.key==='answer') body=`<span class="eyebrow mb-2">Вопрос дня</span><p class="dc-q">${esc(s.question||'О чем был этот день?')}</p>${area('answer',DC.answer,DC_PLACEHOLDER.answer)}`;
  else if(step.key==='mood'){
    const shades=[...DC.moods].filter(m=>!quickMoods().some(q=>q.key===m));
    body=`<p class="dc-q">${ui('diary.mood',DC_Q.mood)}</p><div class="chips flow" id="dc-mood-chips">${[...quickMoods().map(q=>[q.key,q.label]),...shades.map(k=>[k,MOOD_LABEL[k]])].map(([k,label])=>`<button data-on="click:dcMood-a0" data-a0="${k}" type="button" class="chip${DC.moods.has(k)?' on':''}" aria-pressed="${DC.moods.has(k)}">${esc(label)}</button>`).join('')}<button data-on="click:openWidget-mood" type="button" class="chip">все оттенки…</button><button data-on="click:dcOwnToggle" type="button" class="chip${DC.ownOpen?' on':''}" aria-pressed="${DC.ownOpen}">+ свое слово</button></div>
      <div class="field dc-own mt-3"${DC.ownOpen?'':' hidden'}><input data-on="input:dcOwnInput" id="dc-own" maxlength="80" placeholder="свое слово — можно несколько через запятую" autocomplete="off" value="${esc(DC.own)}"></div>
      ${s.set?`<div class="dc-echo-q mt-3"><span>Утром: ${quoted(s.set)} — отозвалось?</span>${Object.entries(ECHO_LABEL).map(([k,l])=>`<button data-on="click:dcEcho-a0" data-a0="${k}" type="button" class="chip${DC.echo===k?' on':''}" aria-pressed="${DC.echo===k}">${l}</button>`).join('')}</div>`:''}
      ${stepOn('photo')&&!stepOn('text')?`<div class="dc-photo-row mt-3"><button data-on="click:dcPickPhoto" class="chip" id="dc-cam" type="button">${CAM_SVG} Фото дня</button></div>${dcPhotoHtml()}`:''}`;
  } else if(step.key==='habits'){
    if(step.create) body=`<p class="dc-q">Какую привычку вести?</p><div class="field"><input id="dc-new-habit" maxlength="80" placeholder="например, стакан воды утром" autocomplete="off"></div><button data-on="click:dcAddHabit" class="btn ghost sm mt-2" type="button">Добавить привычку</button><p class="hint" id="dc-create-msg" role="status"></p>`;
    else { const habits=s.habits.filter(h=>h.due||h.rule==='free'||h.today);
      body=`<p class="dc-q">${ui('diary.habits',DC_Q.habits)}</p><div id="dc-habit-list">${habits.map(h=>`<div class="dc-row"><button data-on="click:dcHabit-a0" data-a0="${h.id}" type="button" class="dc-check" aria-pressed="${!!DC.habits.get(h.id)}" aria-label="${esc(h.title)}">${DC.habits.get(h.id)?'✓':''}</button><div class="grow">${esc(h.title)}</div></div>`).join('')}</div>`; }
  } else if(step.key==='askesis'){
    if(step.create){ const until=new Date(Date.parse(s.day+'T12:00:00Z')+7*864e5).toISOString().slice(0,10);
      body=`<p class="dc-q">Какую аскезу взять?</p><div class="field"><input id="dc-new-askesis" maxlength="80" placeholder="например, без сладкого" autocomplete="off"></div><div class="field mt-2"><label for="dc-new-until">До какого дня</label><input id="dc-new-until" type="date" value="${until}" min="${s.day}"></div><button data-on="click:dcAddAskesis" class="btn ghost sm mt-2" type="button">Взять аскезу</button><p class="hint" id="dc-create-msg" role="status"></p>`; }
    else body=`<p class="dc-q">${ui('diary.askesis',DC_Q.askesis)}</p><div id="dc-askesis-list">${s.askesis.map(a=>{const v=DC.askesis.get(a.id)||{kept:null,note:''};return `<div class="dc-ask"><div class="grow"><b>${esc(a.title)}</b><small>день ${a.done} из ${a.total}${a.left?` · осталось ${a.left} ${plural(a.left,'день','дня','дней')}`:' · последний день'}</small></div>
      <button data-on="click:dcAsk-a0-a1" data-a0="${a.id}" data-a1="1" type="button" class="chip${v.kept===true?' on':''}" aria-pressed="${v.kept===true}">держусь</button><button data-on="click:dcAsk-a0-a1" data-a0="${a.id}" data-a1="0" type="button" class="chip${v.kept===false?' on':''}" aria-pressed="${v.kept===false}">сорвалась</button>
      <div class="field grow"><input data-on="input:dcNote-a0-value" data-a0="${a.id}" maxlength="500" placeholder="заметка, если хочется" value="${esc(v.note||'')}"></div></div>`;}).join('')}</div>`;
  }
  const filled=dcFilled(step.key);
  const primary=last?`<button data-on="click:saveDayCard" class="btn" id="dc-next" type="button">${DC.forDay?(DC.forDay===yesterdayC()?'Запомнить вчерашний день':'Сохранить'):ui('diary.save','Запомнить этот день')}</button>`:`<button data-on="click:dcNext" class="btn" id="dc-next" type="button">Дальше</button>`;
  /* «Сохранить» и «← Назад» на каждом шаге (решение владелицы 19.09): человек всегда видит, как закончить и как вернуться */
  const secondary=[!last?`<button data-on="click:saveDayCard" class="btn ghost sm" type="button">Сохранить</button>`:'', i?`<button data-on="click:dcBack" class="btn ghost sm" type="button">← Назад</button>`:''].filter(Boolean);
  const actions=`<div class="answer-actions dc-actions">${primary}${filled||last?'':`<button data-on="click:dcNext" class="btn ghost sm dc-skip" type="button">Пропустить</button>`}</div>${secondary.length?`<div class="dc-secondary">${secondary.join('')}</div>`:''}<p class="hint" id="dc-state" role="status"></p>`;
  box.innerHTML=head+body+actions;
  if(step.key==='mood'&&DC.ownOpen&&!DC.own)$('dc-own')?.focus({preventScroll:true});
  box.querySelectorAll('textarea').forEach(growTextarea);
  if(!journalSpeech)prepareDictation();
}
function dcInput(id){ const el=$('dc-'+id); if(!el)return; DC[id]=el.value; DC.dirty=true; dcSaveDraft(); const skip=document.querySelector('.dc-skip'); if(skip&&el.value.trim())skip.remove(); }
function dcNext(){ hap(); if(journalSpeech)stopJournalDictation(); DC.step=Math.min(DC.step+1,dcSteps().length-1); dcSaveDraft(); paintDayCard(); scrollToTop(Math.max(0,$('day-card').getBoundingClientRect().top+scrollTopNow()-16)); }
function dcBack(){ hap(); if(journalSpeech)stopJournalDictation(); DC.step=Math.max(0,DC.step-1); dcSaveDraft(); paintDayCard(); }
function dcMood(key){if(DC.moods.has(key))DC.moods.delete(key);else DC.moods.add(key);DC.dirty=true;dcSaveDraft();const b=document.querySelector(`#dc-mood-chips [data-a0="${key}"]`);if(b){b.classList.toggle('on',DC.moods.has(key));b.setAttribute('aria-pressed',DC.moods.has(key));}hap();document.querySelector('.dc-skip')?.remove();}
function dcOwnToggle(){ DC.ownOpen=!DC.ownOpen; paintDayCard(); }
function dcOwnInput(){DC.own=$('dc-own').value;DC.dirty=true;dcSaveDraft();if(DC.own.trim())document.querySelector('.dc-skip')?.remove();}
function dcHabit(id){id=Number(id);DC.habits.set(id,!DC.habits.get(id));DC.touched.habits.add(id);dcSaveDraft();const b=document.querySelector(`#dc-habit-list [data-a0="${id}"]`);if(b){b.setAttribute('aria-pressed',DC.habits.get(id));b.textContent=DC.habits.get(id)?'✓':'';}hap();document.querySelector('.dc-skip')?.remove();}
function dcAsk(id,kept){id=Number(id);const cur=DC.askesis.get(id)||{kept:null,note:''};cur.kept=kept==='1';DC.askesis.set(id,cur);DC.touched.askesis.add(id);dcSaveDraft();document.querySelectorAll(`#dc-askesis-list [data-a0="${id}"].chip`).forEach(b=>{const on=(b.dataset.a1==='1')===cur.kept;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});hap();document.querySelector('.dc-skip')?.remove();}
function dcNote(id,value){id=Number(id);const cur=DC.askesis.get(id)||{kept:null,note:''};cur.note=value;DC.askesis.set(id,cur);DC.touched.askesis.add(id);dcSaveDraft();}
function dcEcho(v){ DC.echo=DC.echo===v?'':v; dcSaveDraft(); document.querySelectorAll('.dc-echo-q .chip').forEach(b=>{const on=b.dataset.a0===DC.echo;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);}); hap(); document.querySelector('.dc-skip')?.remove(); }
/* микрофон внутри поля: диктовка идет в поле текущего шага */
function dcDictate(fieldId){ DICT_SCOPES.dc={text:fieldId,btn:'dc-mic',note:'dc-speech-note'}; journalDictate('dc'); }
function dcEdit(){ DC.mode='steps'; DC.step=0; DC.bridge=undefined; paintDayCard(); hap(); scrollToTop(Math.max(0,$('day-card').getBoundingClientRect().top+scrollTopNow()-16)); }
/* первая привычка и первая аскеза — прямо из шага, без похода на страницу инструмента */
async function dcAddHabit(){
  const title=($('dc-new-habit')?.value||'').trim(), msg=$('dc-create-msg'); if(title.length<2){ if(msg)msg.textContent='Назовите привычку — хотя бы два знака'; return; }
  try{ await api('/habits',{method:'POST',body:JSON.stringify({title,rule:'каждый день'})}); hap('done'); toast('Привычка добавлена'); XP.timeline.dirty=true; await loadDayCard(true); }
  catch(e){ if(msg)msg.textContent=e.code==='too_many'?'Привычек уже двадцать — уберите лишние в «Дневнике привычек»':'Не получилось добавить'; }
}
async function dcAddAskesis(){
  const title=($('dc-new-askesis')?.value||'').trim(), until=$('dc-new-until')?.value||'', msg=$('dc-create-msg'); if(title.length<2){ if(msg)msg.textContent='Назовите аскезу — хотя бы два знака'; return; }
  try{ await api('/askesis',{method:'POST',body:JSON.stringify({title,until})}); hap('done'); toast('Аскеза взята — мы рядом ✦'); XP.timeline.dirty=true; refreshNativeAskesis(); await loadDayCard(true); }
  catch(e){ if(msg)msg.textContent=e.code==='bad_until'?'Выберите дату не раньше сегодняшней':e.code==='too_many'?'Аскез уже пять — завершите одну в «Аскезах»':'Не получилось'; }
}
async function saveDayCard(){
  if(saveDayCard.busy||!DC.state)return;
  if(journalSpeech)stopJournalDictation();
  const on=new Set(dcSteps().map(st=>st.key));
  const nothing=!DC.text.trim()&&!DC.gratitude.trim()&&!DC.answer.trim()&&!DC.moods.size&&!DC.own.trim()&&!DC.touched.habits.size&&!DC.touched.askesis.size;
  if(nothing&&!dcWritten(DC.state)){ const st=$('dc-state'); if(st)st.textContent='Пока нечего запомнить — отметьте настроение или напишите пару слов'; hap(); return; }
  saveDayCard.busy=true;const btn=$('dc-next');if(btn){btn.disabled=true;btn.textContent='Запоминаем…';}
  const own=DC.own.split(',').map(x=>x.trim().replace(/\s+/g,'-').slice(0,24)).filter(Boolean).map(x=>'own:'+x);
  /* уходит только то, что было на экране и что трогали: скрытый шаг — ключа нет, сервер «не трогает»; привычки — только отмеченные в этой сессии,
     чтобы не стереть галочку, поставленную позже в самом инструменте */
  const body={moods:[...DC.moods,...own],...(on.has('text')?{text:DC.text}:{}),...(DC.forDay?{day:DC.forDay}:{}),...(DC.state.set?{echo:DC.echo||''}:{}),   /* «отозвалось» — в той же операции; пустое снимает отметку */
    ...(on.has('gratitude')?{gratitude:DC.gratitude}:{}),...(on.has('answer')?{answer:DC.answer,question:DC.state.question}:{}),
    habits:[...DC.touched.habits].map(id=>({id,done:!!DC.habits.get(id)})),askesis:[...DC.touched.askesis].map(id=>{const v=DC.askesis.get(id)||{kept:null,note:''};return {id,...(v.kept===null?{}:{kept:v.kept}),note:v.note||''};})};
  try{
    const r=await api('/day',{method:'POST',body:JSON.stringify(body)});
    DC.state={...r}; dcClearDraft(); DC.dirty=false; DC.bridge=undefined; DC.touched={habits:new Set(),askesis:new Set()}; hap('done');
    if(!DC.forDay){ answerFrom(r.answer,r.day); ANS.draft=''; paintAnswerEverywhere(); if(S.day&&r.day===S.day.date)S.day.remembered=true; }
    if(!DC.forDay){ S.mood=DC.state.moods[0]||null; if(S.day&&r.saved.length)S.day.remembered=true; }
    if(DC.forDay===yesterdayC()){ S.yesterday=undefined; }
    DC.firstSave=!DC.forDay&&!(S.daysTotal>0); dayChanged(r.day,false);
    DC.mode=matchMedia('(prefers-reduced-motion: reduce)').matches?'done':'celebrate'; paintDayCard();
  }
  catch(e){ const st=$('dc-state'); if(st)st.textContent=e.code==='too_many'?'Записей за этот день уже сто — новые не сохраняются, текст остался в форме':ERR_SAVE_KEPT; }   /* лимит — честный отказ, черновик на месте (F15) */
  finally{ saveDayCard.busy=false; const b=$('dc-next'); if(b){b.disabled=false;b.textContent=DC.forDay?'Сохранить':'Запомнить этот день';} }
}
/* Дописать или поправить прошлый день — той же карточкой по шагам: «Вчера не записали» утром на «Сегодня», «Изменить» в открытом дне */
async function dcLoadFor(day){
  if(journalSpeech)stopJournalDictation();
  DC.forDay=day&&S.day&&day!==S.day.date?day:null; DC.bridge=undefined; eveningSetOpen=false; closeWidget();
  if(!$('v-history')?.classList.contains('on'))go('history');
  await loadDayCard(); hap();
  requestAnimationFrame(()=>{ const c=$('day-card'); if(c)scrollToTop(Math.max(0,c.getBoundingClientRect().top+scrollTopNow()-16)); });
}
function dcToday(){ dcLoadFor(null); }

/* ══════════ Фото дня: один снимок, сжимается на телефоне (полное 1280 px JPEG до ~250 КБ, миниатюра 240×240), уходит сразу при
   выборе — отдельно от сохранения дня и не в черновик. Сервер хранит зашифрованным (day_photos), отдает по дню и размеру. ══════════ */
const dayPhotoUrl=(day,size,ts)=>`${API}/day/photo?day=${day}&size=${size}&t=${encodeURIComponent(ts||'')}`;
const photoFullHtml=(v)=>v.photo?`<img class="dc-photo-full" src="${dayPhotoUrl(v.day,'full',v.photo.ts)}" alt="Фото дня" loading="lazy" decoding="async"${v.photo.w&&v.photo.h?` width="${v.photo.w}" height="${v.photo.h}"`:''}>`:'';
function dcPhotoHtml(){ const p=DC.state.photo; return `<div class="dc-photo" id="dc-photo">${p?`<img src="${dayPhotoUrl(DC.state.day,'thumb',p.ts)}" alt="Фото дня" width="72" height="72"><span class="hint">Фото дня добавлено</span><button data-on="click:dcRemovePhoto" class="btn ghost sm" type="button">Убрать</button>`:''}</div>`; }
function pickDayPhoto(){
  return new Promise((resolve)=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='image/jpeg,image/png,image/webp,image/heic,image/heif'; inp.style.cssText='position:fixed;left:-9999px;top:0;opacity:0'; document.body.appendChild(inp);
    const done=(v)=>{ inp.remove(); resolve(v); };
    inp.onchange=async()=>{
      const f=inp.files&&inp.files[0]; if(!f)return done(null);
      const toBlob=(cv,q)=>new Promise(r=>cv.toBlob(r,'image/jpeg',q));
      const build=async(w,h,src)=>{
        const k=Math.min(1,1280/Math.max(w,h)), cv=document.createElement('canvas'); cv.width=Math.round(w*k); cv.height=Math.round(h*k); cv.getContext('2d').drawImage(src,0,0,cv.width,cv.height);
        let q=0.8, full=await toBlob(cv,q); while(full&&full.size>250*1024&&q>0.5){ q-=0.1; full=await toBlob(cv,q); }   /* потолок сервера 400 КБ, целимся в 250 */
        const t=document.createElement('canvas'); t.width=t.height=240; const side=Math.min(cv.width,cv.height); t.getContext('2d').drawImage(cv,(cv.width-side)/2,(cv.height-side)/2,side,side,0,0,240,240);
        const thumb=await toBlob(t,0.7); return full&&thumb?{full,thumb,w:cv.width,h:cv.height}:null;
      };
      try{ if(window.createImageBitmap){ const bm=await createImageBitmap(f); const out=await build(bm.width,bm.height,bm); bm.close&&bm.close(); return done(out); } }catch(e){ /* формат не читается — через Image */ }
      const im=new Image(); const url=URL.createObjectURL(f);
      im.onload=async()=>{ const out=await build(im.width,im.height,im); URL.revokeObjectURL(url); done(out); };
      im.onerror=()=>{ URL.revokeObjectURL(url); toast('Не получилось прочитать файл — нужен JPG, PNG или скриншот'); done(null); };
      im.src=url;
    };
    inp.click();
  });
}
async function dcPickPhoto(){
  if(dcPickPhoto.busy)return; const ph=await pickDayPhoto(); if(!ph)return; dcPickPhoto.busy=true;
  const btn=$('dc-cam'); if(btn)btn.disabled=true;
  try{
    const r=await fetch(`${API}/day/photo?thumb=${ph.thumb.size}&w=${ph.w}&h=${ph.h}`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/octet-stream'},body:new Blob([ph.thumb,ph.full])});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw Object.assign(new Error(j.error||'err'),{status:r.status,code:j.error});
    DC.state.photo=j.photo; dayChanged(DC.state.day,false); hap('done'); toast('Фото дня добавлено ✦');
    const box=$('dc-photo'); if(box)box.outerHTML=dcPhotoHtml();
  }catch(e){ toast(e.status===413||e.code==='too_big'?'Фото слишком большое — попробуйте другое':e.code==='too_often'?'Слишком много фото за сутки':'Не получилось загрузить фото'); }
  finally{ dcPickPhoto.busy=false; const b=$('dc-cam'); if(b)b.disabled=false; }
}
async function dcRemovePhoto(){
  try{ await api('/day/photo',{method:'DELETE'}); DC.state.photo=null; dayChanged(DC.state.day,false); hap(); const box=$('dc-photo'); if(box)box.outerHTML=dcPhotoHtml(); }
  catch(e){ toast('Не получилось убрать фото'); }
}
/* Праздник: луна разгорается, искры разлетаются — и день показывается как текст */
function paintDayParty(){
  const box=$('day-card'); const sparks=Array.from({length:22},(_,k)=>`<i class="spark${k%3?'':' s'}" style="--a:${Math.round(k*360/22+(k%2?9:-6))}deg;--d:${90+((k*41)%80)}px;--w:${(k%6)*80}ms"></i>`).join('');
  box.innerHTML=`<div class="dc-party" aria-live="polite"><i class="ring"></i><i class="ring r2"></i><div class="moon"></div>${sparks}<p>День записан ✦</p></div>`;
  scrollToTop(Math.max(0,box.getBoundingClientRect().top+scrollTopNow()-16));
  setTimeout(()=>{ if(DC.mode==='celebrate'){ DC.mode='done'; paintDayCard(); } },2300);
}
/* День записан — читается, а не заполняется: настроение, утро, записи прозой, «мост» из прошлого (строка «Привычки: … · Настрой: …» снята — решение владелицы 20.09) */
function paintDayDone(){
  const s=DC.state, box=$('day-card');
  const hour=new Date().getHours(), night=hour>=EVENING_HOUR||hour<4;
  const moods=s.moods.map(m=>MOOD_LABEL[m]||m.replace(/^own:/,''));
  const warm=DC.forDay?'':(night?ui('diary.night','Спокойной ночи ✦'):ui('diary.day','Хорошего дня ✦'));
  /* главное действие вкладки — строкой в стекле над записью (решение владелицы 19.09); сама запись — плоской карточкой */
  const da=$('diary-action'); if(da){ da.innerHTML=row(DC.forDay?(DC.forDay===yesterdayC()?'Вчера':fmtDayWords(s.day)):'Сегодня',ui('diary.done','День записан ✦'),'Дополнить →','click:dcEdit'); da.hidden=false; }
  box.classList.add('done');
  box.innerHTML=`<span class="eyebrow">${DC.forDay===yesterdayC()?'вчера, ':''}${fmtDayWords(s.day)}</span>
    ${moods.length?`<div class="dc-moods">${moods.map(m=>`<i>${esc(m)}</i>`).join('')}</div>`:''}
    ${photoFullHtml(s)}
    ${morningHtml(s)}
    ${dayProseHtml(s)}
    ${warm?`<p class="dc-warm">${warm}</p>`:''}
    <div class="dc-bridge" id="dc-bridge" hidden></div>
    ${DC.forDay?'':nextStepHtml()}
    ${DC.forDay?'':toolOfferHtml()}
    ${DC.forDay?'<div class="dc-done-actions"><button data-on="click:dcToday" class="btn ghost sm" type="button">К сегодняшнему дню →</button></div>':''}<p class="hint" id="dc-state" role="status"></p>`;
  loadBridge();
}
/* После первого записанного дня — один следующий шаг (обязательства после ценности, решение 19.09): включить напоминания —
   мастер и запрос разрешения на пуш; на iPhone в Safari сначала — добавить на экран «Домой», иначе напоминаний не будет */
function nextStepHtml(){
  if(rhythmSeen()||(S.daysTotal||0)>3) return '';
  if(S.rem&&Object.values(S.rem).some(r=>r.enabled)) return '';
  if(IS_IOS&&!PUSH_OK&&!IOS_SHELL) return row('Завтра','Чтобы напомнить вечером — добавьте Лунарио на экран «Домой»','Как →',{href:'/app/install'});
  return row('Завтра','Напомнить вечером?','Включить →','click:openRhythm-history');
}

/* ══════════ Как человек узнает про инструменты: не из каталога, а по одному, в нужный момент ══════════
   После первого записанного дня — «Чем дополнить вечера?» со всеми чипами сразу. Дальше — одно предложение в вечер, по порогам
   (благодарность со второго дня, привычки с пятого, аскеза со второй недели), «Не сейчас» дважды — больше не предлагаем.
   Память предложений — на устройстве, по аккаунту. */
const OFFER_TEXT={text:'Оставлять от дня пару строк?',gratitude:'Добавить благодарность?',photo:'Оставлять от дня фото?',answer:'Отвечать вечером на вопрос дня?',habits:'Вести привычки?',askesis:'Взять аскезу?'};
const OFFER_AFTER={text:1,photo:2,gratitude:3,answer:3,habits:4,askesis:10};   /* сколько записанных дней должно быть, чтобы предложить */
const offerKey=()=>'lun_tool_offer_'+(S.user?.id||0);
const offerMem=()=>{ try{ return JSON.parse(localStorage.getItem(offerKey())||'{}')||{}; }catch(e){ return {}; } };
const offerSave=(m)=>{ try{ localStorage.setItem(offerKey(),JSON.stringify(m)); }catch(e){} };
function toolOfferHtml(){
  const off=['text','gratitude','photo','answer','habits','askesis'].filter(k=>!stepOn(k)); if(!off.length)return '';
  if(DC.firstSave) return `<div class="dc-offer" id="dc-offer"><span class="eyebrow">Чем дополнить вечера?</span><div class="chips flow mt-2">${off.map(k=>`<button data-on="click:offerAccept-a0" data-a0="${k}" type="button" class="chip">+ ${STEP_NAME[k].toLowerCase()}</button>`).join('')}</div></div>`;
  const m=offerMem(), today=DC.state.day, total=S.daysTotal||0; if(m.day===today&&m.shown)return '';   /* одно предложение в вечер */
  const key=off.find(k=>total>=OFFER_AFTER[k]&&(m.no?.[k]||0)<2&&!(m.last?.[k]&&Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(m.last[k]+'T12:00:00Z'))/864e5)<7));
  if(!key)return '';
  offerSave({...m,day:today,shown:key,last:{...(m.last||{}),[key]:today}}); track('tool_offer_show',key);
  return `<div class="dc-offer" id="dc-offer"><p>${OFFER_TEXT[key]}</p><div class="dc-offer-actions"><button data-on="click:offerAccept-a0" data-a0="${key}" class="btn sm" type="button">Добавить</button><button data-on="click:offerLater-a0" data-a0="${key}" class="btn ghost sm" type="button">Не сейчас</button></div></div>`;
}
async function offerAccept(key){ track('tool_offer_accept',key); await toggleEveningStep(key,true); const box=$('dc-offer'); if(box){ if(DC.firstSave){ const b=box.querySelector(`[data-a0="${key}"]`); if(b){b.classList.add('on');b.disabled=true;} } else box.remove(); } }
function offerLater(key){ const m=offerMem(); offerSave({...m,no:{...(m.no||{}),[key]:(m.no?.[key]||0)+1}}); track('tool_offer_dismiss',key); $('dc-offer')?.remove(); hap(); }

/* ══════════ Состав вечера под карточкой — одна кнопка «Настроить вечер» (строка «Мой вечер: …» снята, решение владелицы 20.09) ══════════
   Нажатие разворачивает чипы на месте: база не снимается, инструменты включаются и выключаются (preferences.tools),
   вопрос дня следует за утренней плиткой. Без прокрутки и без каталога. */
let eveningSetOpen=false;
function paintEveningSet(){
  const box=$('evening-set'); if(!box||!S.user?.onboarded)return;
  if(!eveningSetOpen){ box.innerHTML=`<button data-on="click:eveningSetToggle" class="btn ghost sm" type="button" aria-expanded="false">Настроить вечер</button>`; return; }
  $('dc-offer')?.remove();   /* чипы уже здесь — второй набор в карточке ни к чему */
  box.innerHTML=`<div class="chips flow" aria-label="Шаги вечера">${[...stepOrder(),...EVENING_EXTRAS].map(k=>{const base=k==='mood', isOn=stepOn(k);return `<button data-on="click:eveningStepToggle-a0" data-a0="${k}" type="button" class="chip${isOn?' on':''}${base?' fixed':''}" aria-pressed="${isOn}"${base?' disabled':''}>${STEP_NAME[k].toLowerCase()}${base?' ✓':''}</button>`;}).join('')}</div>
    <button data-on="click:eveningSetToggle" class="btn ghost sm mt-2" type="button" aria-expanded="true">Готово</button>`;
}
function eveningSetToggle(){ eveningSetOpen=!eveningSetOpen; paintEveningSet(); hap(); }
/* Включить или выключить шаг вечера. answer — утренняя плитка «Вопрос дня» (один выбор — два места); остальное — инструмент из каталога */
async function toggleEveningStep(key,forceOn){
  if(key==='mood')return;
  const isOn=stepOn(key); if(forceOn&&isOn)return;
  { const tk=TOOL_OF[key]||key, tools=toolsVisible(); if(isOn)tools.delete(tk);else tools.add(tk); const list=toolCatalog().map(t=>t.key).filter(k=>tools.has(k));
    try{ await savePreferences({tools:list}); applyTools(); track(isOn?'tools_remove':'tools_add',key+':evening'); }catch(e){ toast(ERR_SAVE); return; } }
  const nowOn=stepOn(key); toast(nowOn?`${STEP_NAME[key]} — в вашем вечере`:'Убрано из вечера');
  paintEveningSet(); if(DC.mode==='steps'){ const cur=(dcSteps()[DC.step]||{}).key; paintDayCard(); if(cur){const i=dcSteps().findIndex(st=>st.key===cur); if(i>=0){DC.step=i;paintDayCard();}} }
}
function eveningStepToggle(key){ toggleEveningStep(key); }

/* утро дня одной врезкой: настрой в «…» и лунный день с названием («День тени»); тема дня («День начала») не показывается — «день чего» здесь только по лунному календарю
   (решение владелицы 20.09). Вопрос — только если на него нет ответа (ответ показывает его сам) */
const lunarLine=(s)=>s.lunar&&s.lunar.n?`${s.lunar.n}-й лунный день${s.lunar.title?` · ${esc(s.lunar.title)}`:''}`:'';
const morningHtml=(s)=>s.set||s.lunar?`<div class="dc-morning">${s.set?`Утром<b>${quoted(s.set)}</b>${s.question&&!s.answer?esc(s.question):''}`:''}${lunarLine(s)?`<span class="dc-lunar">☾ ${lunarLine(s)}</span>`:''}</div>`:'';
/* записи прозой — все записи дня, каждая со своим id (аудит v98, F01, F17): в открытом дне у каждой «×» удаляет именно ее.
   Итог недели (weekly) лежит под воскресеньем и ведет в «Мою неделю» */
const dayProseHtml=(s,editDay='')=>{
  const list=[];
  for(const t of (s.texts||(s.text?[s.text]:[])))list.push(['Вечером',t.text,'','text:'+t.id]);
  for(const g of (s.gratitudes||(s.gratitude?[s.gratitude]:[])))list.push(['Благодарность',g.text,'','gratitude:'+g.id]);
  for(const a of (s.answers||(s.answer?[s.answer]:[])))list.push(['Ответ на вопрос дня',a.text,a.title||s.question||'','answer:'+a.id]);
  for(const t of (s.thoughts||[]))list.push([t.name||'Мысль',t.text,t.question||'','thought:'+t.id]);   /* мысли к карте, руне, раскладу — с именем материала и его вопросом */
  if(s.weekly)list.push(['Итог недели',s.weekly.text,'','weekly:'+s.weekly.id,`<button data-on="click:openWeekAt-a0" data-a0="${s.day}" class="week-daylink" type="button">Неделя →</button>`]);
  return list.map(([label,text,q,what,extra])=>`<p class="dc-read"><small>${label}${extra||''}${editDay?`<button data-on="click:dayRemove-a0-a1" data-a0="${editDay}" data-a1="${what}" class="dc-x" type="button" aria-label="Удалить">×</button>`:''}</small>${q?`<span class="q">${esc(q)}</span>`:''}${esc(text)}</p>`).join('');
};
async function dayRemove(day,what){
  const names={text:'запись',gratitude:'благодарность',answer:'ответ на вопрос дня',moods:'настроение',thought:'мысль',weekly:'итог недели'};
  if(!confirm(`Удалить ${names[String(what).split(':')[0]]||'это'} за ${fmtDayWords(day)}? Вернуть будет нельзя.`))return;
  try{ await api(`/day?day=${day}&what=${what}`,{method:'DELETE'}); hap(); toast('Удалено'); dayChanged(day); if(!(S.day&&day===S.day.date))openDay(day); }
  catch(e){ toast('Не получилось удалить'); }
}
/* Одна точка обновления после записи, правки или удаления в дне (аудит v98, F25): список дней, «вчера» на «Сегодня», лента, неделя,
   мысли за день — и карточка дня, если она про этот день (reloadCard=false — когда ответ сервера уже лег в DC.state) */
function dayChanged(day,reloadCard=true){
  XP.timeline.dirty=true; WK.data=null; if(day===yesterdayC())S.yesterday=undefined; if(S.thoughtsBy)delete S.thoughtsBy[day];
  loadDays(); if(reloadCard&&DC.state&&DC.state.day===day)loadDayCard(true);
}
/* листать дни свайпом в открытом дне */
(()=>{ let x0=null,y0=null; document.addEventListener('touchstart',(e)=>{ const t=e.target.closest('#dayview-box'); if(!t||!e.touches[0]){x0=null;return;} x0=e.touches[0].clientX; y0=e.touches[0].clientY; },{passive:true});
  document.addEventListener('touchend',(e)=>{ if(x0===null||!e.changedTouches[0])return; const dx=e.changedTouches[0].clientX-x0, dy=e.changedTouches[0].clientY-y0; x0=null; if(Math.abs(dx)<60||Math.abs(dy)>Math.abs(dx))return;
    const v=document.querySelector('#dayview-box .dayview'); if(!v)return; const day=v.dataset.day; const to=dx<0?addDaysC(day,1):addDaysC(day,-1); if(to>S.day.date)return; openDay(to); },{passive:true}); })();
/* «Мост» — одна строка из прошлого, дословно */
const daysAgo=(d,base=S.day.date)=>{const n=Math.round((Date.parse(base+'T12:00:00Z')-Date.parse(d+'T12:00:00Z'))/864e5);return n===1?'Накануне':n===7?'Неделей раньше':n<31?`${n} ${plural(n,'днем','днями','днями')} раньше`:`${fmtDayWords(d)}`;};
/* «Я помню» — строка приходит с сервера готовой (memory.mjs, тексты — память.txt в кабинете); цитаты в «…» — жирным */
const bridgeHtml=(b)=>esc(b.text).replace(/«([^»]+)»/g,'«<b>$1</b>»');
async function loadBridge(){
  const box=$('dc-bridge'); if(!box)return;
  if(DC.bridge===undefined){ try{ DC.bridge=(await api(DC.forDay?'/day/bridge?day='+DC.forDay:'/day/bridge')).item||null; }catch(e){ DC.bridge=null; } }
  const b=DC.bridge; if(!$('dc-bridge'))return;
  if(!b)return;
  $('dc-bridge').innerHTML=bridgeHtml(b);
  $('dc-bridge').hidden=false; track('bridge_view',b.kind);
}

/* ══════════ Прошлые дни: полоска настроения за две недели и строки по дням; «Все дни» — постранично ══════════
   Строка дня — только «день чего» по лунному календарю и номер лунного дня с луной («День тени · ☾ 9-й лунный день»); текст, настроения
   и прочие показатели в превью не выводятся (решение владелицы 20.09) — все это открывается по нажатию */
const moodTone=(m)=>{ if(!m)return ''; if(m.startsWith('own:'))return 'own'; const i=moodInfo(m); return i?({'+':'plus','0':'zero','-':'minus'}[i.tone]||'zero'):'zero'; };
const dayRowHtml=(x)=>{
  const dt=new Date(x.day+'T12:00:00'), wd=dt.toLocaleDateString('ru-RU',{weekday:'short'}).replace('.','');
  const tail=x.photo?`<img class="ph" src="${API}/day/photo?day=${x.day}&size=thumb&t=${encodeURIComponent(x.photo)}" alt="" loading="lazy" decoding="async">`:`<span class="a" aria-hidden="true">›</span>`;
  return `<button data-on="click:openDay-a0" data-a0="${x.day}" class="day-row${x.empty?' empty':''}${x.photo?' has-photo':''}" type="button" aria-label="${fmtDayWords(x.day,true)}"><span class="n"><b>${dt.getDate()}</b><small>${wd}</small></span><span class="t"><p class="${x.lunarTitle?'':'quiet'}">${x.lunarTitle?esc(x.lunarTitle):x.empty?'Без записей':'Записан'}</p><small>${x.lunar?`☾ ${ordinal(x.lunar)} лунный день`:''}</small></span>${tail}</button>`;
};
async function loadDays(){
  const list=$('days-list'); if(!list)return;
  try{
    const r=await api('/days?calendar=14'); const items=r.items; S.daysTotal=r.total||0;
    const today=DC.state?{day:DC.state.day,moods:DC.state.moods}:{day:S.day.date,moods:S.mood?[S.mood]:[]};
    S.daysStrip=[...items].reverse().concat([today]);
    const rows=items.slice(0,3); const any=items.some(x=>!x.empty);
    list.innerHTML=any?rows.map(dayRowHtml).join(''):`<p class="hint">Пока пусто</p>`;
    $('days-all').hidden=!any;
  }catch(e){ list.innerHTML='<p class="hint">Прошлые дни не загрузились.</p>'; }
}
async function loadAllDays(more=false){
  const box=$('days-box'); if(!box)return;
  if(!more){ box.innerHTML='<p class="hint">Загружаем…</p>'; loadAllDays.next=''; }
  try{
    if(!CAT) await loadCatalog();   /* названия настроений — из каталога; без него в списке мелькали бы ключи вроде quick:anxious */
    const q=new URLSearchParams({limit:'30'}); if(more&&loadAllDays.next)q.set('before',loadAllDays.next);
    const r=await api('/days?'+q); loadAllDays.next=r.next||'';
    const monthOf=(d)=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.','');
    let month=more?loadAllDays.month||'':'';   /* месяц — подписью, когда сменился: числа без месяца в длинном списке не читаются */
    const rows=r.items.map(x=>{const m=monthOf(x.day);const head=m!==month?`<p class="hint days-month">${m[0].toUpperCase()+m.slice(1)}</p>`:'';month=m;return head+dayRowHtml(x);}).join('');
    loadAllDays.month=month;
    const strip=(S.daysStrip||[]).map((x,k,arr)=>`<i class="t-${moodTone(x.moods[0])}${k===arr.length-1?' today':''}" title="${fmtDayWords(x.day,true)}"></i>`).join('');
    if(!more)box.innerHTML=`${strip?`<div class="days-strip">${strip}</div>`:''}<p class="hint">${r.total?`${r.total} ${plural(r.total,'день','дня','дней')}`:'Пока пусто'}</p><div class="days-list" id="days-all-list">${rows}</div><button data-on="click:loadAllDays-true" class="btn ghost" id="days-more" type="button"${r.next?'':' hidden'}>Показать еще</button>`;
    else { $('days-all-list').insertAdjacentHTML('beforeend',rows); $('days-more').hidden=!r.next; }
  }catch(e){ box.innerHTML='<p class="hint">Не получилось загрузить.</p>'; }
}
/* Открытый день — читается как текст: утро, записи, настроение, практики */
async function openDay(day){
  if(S.day&&day===S.day.date){ go('history'); requestAnimationFrame(()=>$('day-card')?.scrollIntoView({block:'start',behavior:'smooth'})); return; }
  openWidget('dayview',fmtDayWords(day,true)); const box=$('dayview-box'); box.innerHTML='<p class="hint">Загружаем…</p>'; track('day_open');
  try{
    const v=await api('/day/view?day='+day); const moods=v.moods.map(m=>MOOD_LABEL[m]||m.replace(/^own:/,''));
    const empty=!(v.texts||[]).length&&!(v.gratitudes||[]).length&&!(v.answers||[]).length&&!(v.thoughts||[]).length&&!moods.length&&!v.habits.length&&!v.askesis.length&&!v.photo;
    const canEdit=v.editable!==false;   /* старше года — только чтение, и это сказано заранее, без «Повторить» (аудит v98, F18) */
    const prev=addDaysC(day,-1), next=addDaysC(day,1), canNext=next<=S.day.date;
    box.innerHTML=`<div class="dayview" data-day="${day}">${moods.length?`<div class="dc-moods">${moods.map(m=>`<i>${esc(m)}</i>`).join('')}${v.moods.length&&canEdit?`<button data-on="click:dayRemove-a0-a1" data-a0="${day}" data-a1="moods" class="dc-x" type="button" aria-label="Убрать настроение">×</button>`:''}</div>`:''}
      ${photoFullHtml(v)}${morningHtml(v)}
      ${dayProseHtml(v,canEdit?day:'')}
      ${empty?'<p class="hint mt-3">Записей не было</p>':''}<div class="dc-bridge" id="dv-bridge" hidden></div>
      <div class="dc-done-actions mt-3">${canEdit?`<button data-on="click:dcFor-a0" data-a0="${day}" class="btn ghost sm" type="button">${empty?'Записать этот день':'Изменить'}</button>`:`<p class="hint">Только чтение: поправить можно дни начиная с ${fmtDayWords(v.editableFrom||'')}</p>`}</div>
      <nav class="day-nav" aria-label="Соседние дни"><button data-on="click:openDay-a0" data-a0="${prev}" class="btn ghost sm" type="button">‹ ${fmtDayWords(prev)}</button><button data-on="click:openDay-a0" data-a0="${next}" class="btn ghost sm" type="button"${canNext?'':' hidden'}>${next===S.day.date?'сегодня':fmtDayWords(next)} ›</button></nav></div>`;
    api('/day/bridge?day='+day).then(r=>{ const b=r.item, el=$('dv-bridge'); if(!b||!el)return; el.innerHTML=bridgeHtml(b,day); el.hidden=false; }).catch(()=>{});
  }catch(e){ box.innerHTML='<p class="hint">Не получилось загрузить этот день.</p>'; }
}
const loadWishes=()=>api('/wishes').then(renderWishes).catch(()=>{});
function loadAbout(){
  const u=S.user; loadNumerology();
  $('ab-sub').textContent=[u.name,u.sign].filter(Boolean).join(' · ')||'Мой профиль';
  paintMeCard();
}
/* карточка человека над списком: имя, натальная Луна и лунный день рождения — из той же натальной карты, что и панель */
async function paintMeCard(){
  const box=$('me-card'); if(!box)return;
  const u=S.user; if(!u?.birth){ box.hidden=true; return; }
  const name=String(u.name||'').trim();
  const paint=(c)=>{
    const moon=c?.planets?.find(p=>p.key==='moon'), lb=c?.lunarBirth;
    const line=[moon?`Натальная Луна ${esc(moon.signIn)}`:'', lb?`родились в <span class="nowrap">${ordinal(lb.n)} лунный</span> день`:''].filter(Boolean).join(' · ');
    const memo=S.memory?.about?.text||'';   /* «В Лунарио с 3 марта. Первой картой была Луна» — memory.mjs, после первой недели */
    box.innerHTML=`<b class="me-name">${esc(name||'Обо мне')}</b>${line?`<span class="me-line">${line}</span>`:''}<span class="me-sub">${[fmtDay(u.birth),u.city].filter(Boolean).map(esc).join(' · ')}</span>${memo?`<span class="me-memo">${esc(memo)}</span>`:''}`;
    box.hidden=false; const sub=$('ab-sub'); if(sub) sub.hidden=true;   /* имя и знак под заголовком — теперь в карточке */
  };
  paint(natalCache);
  if(!natalCache){ try{ natalCache=await api('/natal?quiet=1'); paint(natalCache); }catch(e){ /* карточка остается с датой и городом */ } }
}
function loadAccount(){
  const u=S.user; paintAvatar();
  $('ac-name').textContent=u.name||'Мой профиль';
  $('profile-summary').textContent=[u.birth?fmtDay(u.birth):'',u.city].filter(Boolean).join(' · ');
  const mail=$('profile-email'); mail.textContent=u.email||''; mail.hidden=!u.email;   /* почта, по которой вошли, — под датой рождения */
  const btn=$('ac-mail-btn'), box=$('ac-auth'); if(btn)btn.hidden=!!u.email||!S.mailReady||S.localPreview||!box.hidden;   /* привязать можно, пока почты нет и письма настроены */
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
    showMsg(msg, e.code==='bad_birth' ? 'Проверьте дату рождения.' : ERR_SAVE, true);
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
  catch(e){ toast(isAcc?authErrorText(e,'del'):'Не получилось очистить историю'); return; }
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

/* ══════════ Настроение дня: напоминание вечером и открытка ══════════ */
function paintMoodExtra(){
  const box = $('mood-extra'); if (!box) return;
  const m = moodInfo(S.mood);
  const id = m ? regRes({ type: 'mood', mood: S.mood, label: m.label, day: S.day.date }) : '';
  box.innerHTML = `${m ? actionsHtml(id) : ''}`;
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
    ${total ? actionsHtml(id) : ''}`;
  paintRem('moodreport'); preparePending();
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
/* пять быстрых настроений известны и до каталога — иначе на карточке дня мелькает ключ вроде quick:calm */
const QUICK_FALLBACK={'quick:well':'Хорошо','quick:calm':'Спокойно','quick:tired':'Устала','quick:anxious':'Тревожно','quick:heavy':'Тяжело'};
function moodInfo(key){ const quick=quickMoods().find(m=>m.key===key);if(quick)return quick; if(!CAT&&QUICK_FALLBACK[key])return {key,label:QUICK_FALLBACK[key],family:key==='quick:anxious'?'fear':key==='quick:well'?'joy':key==='quick:calm'?'trust':'sadness',tone:key==='quick:well'||key==='quick:calm'?'+':'-'}; if(key==='displeasure') return {key,label:'неудовольствие',family:'disgust',tone:'-'}; if (ownMood(key)) return { key, label: ownMood(key), family: 'own', tone: '0' }; const k = (CAT?.legacyMoods || {})[key] || key; return moodList().find(m => m.key === k) || null; }
/* название настроения — одно правило на все сводки (аудит v98, F26): из каталога или свое слово, иначе понятный запасной текст, не ключ */
const MOOD_LABEL = new Proxy({}, { get: (_, k) => { const m = moodInfo(k); return m ? m.label : 'настроение без названия'; } });
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
  if(!quickMoods().length){$('t-moods').innerHTML=`<p class="practice-question">Как вы сейчас?</p><p class="hint">Список настроений не загрузился.</p><button data-on="click:loadCatalog-then-renderMoods-catch-toast-Нет-связи" type="button" class="btn ghost sm">Повторить</button>`;return;}
  $('t-moods').innerHTML=`<p class="practice-question">Как вы сейчас?</p>
    <div class="quick-moods">${quickMoods().map(m=>`<button data-on="click:quickMood-a0" data-a0="${m.key}" type="button" class="quick-mood${S.mood===m.key?' on':''}" aria-pressed="${S.mood===m.key}">${moodSvg(m.key,30)}<span>${esc(m.label)}</span></button>`).join('')}<button data-on="click:moodOwn" type="button" class="quick-mood"><i class="ico pen"></i><span>Свое слово</span></button></div>
    ${cur?`<div class="mpick saved-state" role="status">${moodSvg(S.mood,36)}<div><b>Сегодня — ${esc(cur.label)}</b><small>Сохранено · ${fmtDay(S.day.date)}. Можно выбрать другое</small></div></div>`:''}
    <div class="mood-own-row" ${moodUI.ownOpen?'':'hidden'}><label for="mood-own">Свое настроение</label><div class="row"><input data-on="input:moodUI-own-value keydown:if-event-key-Enter-pickOwnMood" id="mood-own" aria-label="Свое настроение" maxlength="24" placeholder="Например: собранно" value="${esc(moodUI.own??ownMood(S.mood))}"><button data-on="click:pickOwnMood" class="btn sm" aria-label="Сохранить свое настроение">Сохранить</button></div></div>
    <div class="utility-actions"><button data-on="click:moodDetails" type="button" class="btn ghost sm">${cur?'Хотите назвать точнее?':'Назвать точнее'}</button><button data-on="click:moodDetails-all" type="button" class="btn ghost sm">Все эмоции</button></div>
    <div id="mood-detail" ${moodUI.precision?'':'hidden'}><div class="segmented" role="tablist" aria-label="Выбор эмоций"><button data-on="click:moodMode-families" role="tab" aria-selected="${moodUI.mode==='families'}">Основные эмоции</button><button data-on="click:moodMode-all" role="tab" aria-selected="${moodUI.mode==='all'}">Все эмоции</button></div>
    ${moodUI.mode==='families'?`
      <div id="mood-shades" class="mood-shades" ${selected?'':'hidden'}><p>${selected?esc(fams[selected][0]):''} · что ближе?</p><div class="chips flow">${list.filter(m=>m.family===selected).map(chip).join('')}</div></div>
      <div class="emotion-families">${familyKeys.map(f=>`<button data-on="click:moodFamily-a0" data-a0="${f}" type="button" class="emotion-family${selected===f?' on':''}" style="--c:var(--emotion-${f},${fams[f][1]})" aria-expanded="${selected===f}">${moodSvg(f,28)}<span>${esc(fams[f][0])}</span><span aria-hidden="true">⌄</span></button>`).join('')}</div>
      <button data-on="click:moodFamily-a0" data-a0="dyad" class="btn ghost sm mt-3" type="button">Сочетания эмоций</button><p class="hint">Оттенки по кругу Плутчика</p>`:
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
