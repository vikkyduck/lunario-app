/* Лунарио — Практики: благодарность, привычки, аскезы, желания */
/* ══════════ Дневник благодарности ══════════ */
const gratQ = () => 'Кому и за что я благодарна сегодня?';
async function loadGratitude(){
  const box = $('gr-box'); box.innerHTML = LOADING;
  await loadCatalog().catch(() => {});
  try { const r = await api('/journal?kind=gratitude'); S.grat = r; paintGratitude(); }   /* r.next — с какой записи продолжать (F17) */
  catch (e) { box.innerHTML = LOAD_ERR; }
}
let gratitudeEdit=null,gratitudeDraft='',gratitudeSaving=false,gratitudeOp='';
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
      <div class="utility-actions"><button data-on="click:editGratitude-a0" data-a0="${todayItem.id}" type="button" class="btn ghost sm">Изменить запись</button></div>`:
      `<div class="field"><label for="gr-text">Моя благодарность</label><textarea data-on="input:gratitudeDraft-value" id="gr-text" maxlength="2000" placeholder="Маме — за звонок. Себе — за то, что нашла время на прогулку">${esc(gratitudeDraft)}</textarea></div>
      <div class="form-actions"><button data-on="click:saveGratitude" type="button" class="btn sm" ${gratitudeSaving?'disabled':''}>${gratitudeSaving?'Сохраняем…':'Сохранить'}</button>
      ${todayItem?`<button data-on="click:gratitudeEdit-null-gratitudeDraft-paintGratitude" type="button" class="btn ghost sm">Отмена</button>`:''}</div>`}</div>
    ${todayItem && !editing?actionsHtml(id):''}
    ${r.items.filter(i=>i.id!==todayItem?.id).length?moreBlock(r.items.filter(i=>i.id!==todayItem?.id).map(i=>`<div class="item"><small>${fmtDay(i.day)}</small><p class="entry-text">${esc(i.text)}</p></div>`).join('')+(r.next?`<button data-on="click:loadGratitudeMore" class="btn ghost sm mt-2" type="button" ${gratitudeMore.busy?'disabled':''}>Показать раньше</button>`:''),'Прошлые благодарности'):''}`;
  gratitudeHomeStatus(!!todayItem);
  paintRem('gratitude');preparePending();
}
/* продолжение ленты — страницей от последней показанной записи (аудит v98, F17) */
const gratitudeMore={busy:false};
async function loadGratitudeMore(){
  if(gratitudeMore.busy||!S.grat?.next)return; gratitudeMore.busy=true;
  try{ const r=await api('/journal?kind=gratitude&before='+S.grat.next); S.grat.items=[...S.grat.items,...r.items]; S.grat.next=r.next??null; }
  catch(e){ toast('Не загрузилось'); }
  finally{ gratitudeMore.busy=false; paintGratitude(); const d=$('gr-box')?.querySelector('details'); if(d)d.open=true; }
}
async function saveGratitude(){
  const text=($('gr-text')?.value||'').trim();if(text.length<3){toast('Напишите хотя бы пару слов');return;}
  if(gratitudeSaving)return;gratitudeSaving=true;
  const button=$('gr-box').querySelector('button[data-on="click:saveGratitude"]');button.disabled=true;button.textContent='Сохраняем…';
  try {
    const edit=gratitudeEdit; if(!edit)gratitudeOp=gratitudeOp||opKey();   /* повтор после обрыва — тот же ключ, вторая запись не появится (F02) */
    const r=await api('/journal',{method:edit?'PATCH':'POST',body:JSON.stringify({id:edit,text,kind:'gratitude',title:gratQ(),...(edit?{}:{op:gratitudeOp})})}); gratitudeOp='';
    const item={...(S.grat.items.find(i=>i.id===edit)||{}),...r.item,kind:'gratitude',title:gratQ()};
    S.grat.items=[item,...S.grat.items.filter(i=>i.id!==item.id)];
    gratitudeEdit=null;gratitudeDraft='';toast('Запись сохранена');hap('ok');paintGratitude();
  } catch(e){toast(e.code==='too_many'?'Записей за день уже сто — текст остался в поле':ERR_SAVE_KEPT);button.disabled=false;button.textContent='Сохранить';}
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
    <div class="grow">${hbEditing===h.id
      ?`<div class="hb-head"><b>${esc(h.title)}</b><button data-on="click:habitRemove-a0" data-a0="${h.id}" type="button" class="btn ghost sm hb-remove" aria-label="Удалить: ${esc(h.title)}">Удалить</button></div>`   /* при правке — «Удалить» в заглавной строке привычки (решение владелицы 20.09) */
      :`<b class="hb-columns"><span>${esc(h.title)}</span><span class="hb-rule">${esc(h.ruleText||h.ruleLabel)}</span></b>`}
      <small class="habit-progress">${habitProgress(h)}</small>
      ${habitView==='all'?`<div class="hd-row">${h.week.map(w=>`<button data-on="click:habitMark-a0-a1" data-a0="${h.id}" data-a1="${w.day}" type="button" class="hd${w.done?' on':''}${w.due?' planned':' rest'}${w.day===today?' today':''}" data-due="${w.due}" aria-label="${fmtDay(w.day)}: ${w.done?'отмечено':w.due?'запланировано, не отмечено':'свободный день'}" title="${w.due?'Запланировано':'Свободный день'}" aria-pressed="${w.done}"><span>${WD_SHORT[wdIdx(w.day)]}</span></button>`).join('')}</div>`:''}
      ${hbEditing===h.id?`<div class="hb-edit"><div class="field"><label for="hb-t-${h.id}">Название</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-titl" data-a0="${h.id}" data-a1="${h.id}" id="hb-t-${h.id}" value="${esc(habitEditDrafts[h.id]?.title??h.title)}" maxlength="80"></div>
        <div class="field"><label for="hb-r-${h.id}">Регулярность — своими словами</label><input data-on="input:habitEditDrafts-a0-Object-assign-habitEditDrafts-a1-rule" data-a0="${h.id}" data-a1="${h.id}" id="hb-r-${h.id}" value="${esc(habitEditDrafts[h.id]?.rule??(h.ruleText||h.ruleLabel))}" maxlength="60" list="rule-ideas"></div>
        <div class="form-actions"><button data-on="click:habitSave-a0" data-a0="${h.id}" type="button" class="btn sm">Сохранить</button><button data-on="click:habitCancelEdit-a0" data-a0="${h.id}" type="button" class="btn ghost sm">Отмена</button></div></div>`:''}
    </div>${habitView==='all' && hbEditing!==h.id?`<button data-on="click:habitEdit-a0" data-a0="${h.id}" type="button" class="btn ghost sm icon-action" aria-label="Изменить: ${esc(h.title)}">✎</button>`:''}</div>`;
  box.innerHTML=`<div class="segmented" role="tablist" aria-label="Дневник привычек"><button data-on="click:habitTab-today" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='today'}">Сегодня</button><button data-on="click:habitTab-all" type="button" role="tab" aria-controls="habit-list" aria-selected="${habitView==='all'}">Все привычки</button></div>
    <div id="habit-list" role="tabpanel" aria-label="${habitView==='today'?'Сегодня':'Все привычки'}">
      <p class="practice-progress" role="status">${!HB.length?'Добавьте первую привычку':habitView==='all'?'Мои привычки':!due.length?'На сегодня ничего не запланировано':done===due.length?'Все на сегодня отмечено ✓':'Отмечено '+done+' из '+due.length}</p>
      <div class="list">${items.map(row).join('')}</div>
      ${habitView==='all'&&items.some(h=>h.week.some(w=>!w.due))?'':''}
    </div>
    ${HB.length?`<button data-on="click:habitNew" type="button" class="btn ghost sm add-action" aria-expanded="${formOpen}" aria-controls="hb-new-form">${formOpen?'Закрыть добавление':'Добавить привычку'}</button>`:''}
    <div id="hb-new-form" class="card practice-card" ${formOpen?'':'hidden'}><h3>Новая привычка</h3><div class="hb-entry">
      <div class="field"><label for="hb-new">Что прививаю</label><input data-on="input:habitDraft-title-value" id="hb-new" placeholder="Например: 10 000 шагов" maxlength="80" value="${esc(habitDraft.title)}" list="hb-ideas"><datalist id="hb-ideas">${(CAT?.habitIdeas||[]).map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="hb-rule">Как часто — своими словами</label><input data-on="input:habitDraft-rule-value" id="hb-rule" placeholder="Каждый день, каждые 3 дня…" maxlength="60" value="${esc(habitDraft.rule)}" list="rule-ideas"></div></div>
      <div class="chips flow">${RULE_CHIPS.map(t=>`<button data-on="click:habitDraft-rule-this-textContent-hb-rule-value-habitDraf" type="button" class="chip">${t}</button>`).join('')}</div><datalist id="rule-ideas">${RULE_CHIPS.map(t=>`<option value="${t}">`).join('')}</datalist>
      <button data-on="click:habitAdd" type="button" class="btn sm">Добавить</button></div>
    ${HB.length?actionsHtml(id):''}`;
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
  catch (e) { toast(ERR_SAVE); }
}
async function habitMark(id, day){
  if(habitBusy.has(id))return;habitBusy.add(id);
  try {
    const r = await api('/habits', { method: 'PATCH', body: JSON.stringify({ id, day }) }); HB = r.items; hap('ok'); paintHabits();
  } catch (e) { toast('Не получилось отметить'); }
  finally{habitBusy.delete(id);document.querySelectorAll('[data-habit="'+id+'"] .hb-check').forEach(b=>b.disabled=false);}
}
async function habitRemove(id){
  if (!confirm('Удалить привычку из списка? Отметки сохранятся в истории.')) return;
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
      ${actionsHtml(id)}<div class="utility-actions"><button data-on="click:askMove-a0-a1" data-a0="${a.id}" data-a1="${a.until}" type="button" class="btn ghost sm">Передвинуть дату</button><button data-on="click:askStop-a0" data-a0="${a.id}" type="button" class="btn ghost sm">Завершить досрочно</button></div>
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
  paintRem('askesis');preparePending();
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
  catch (e) { toast(ERR_SAVE); }
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
  catch(e){msg.textContent=e.code==='bad_until'?'Дата должна быть не раньше сегодня':'Не сохранилось — дата осталась в поле';}
  finally{button.disabled=false;button.textContent='Сохранить дату';}
}
async function askStop(id){
  if (!confirm('Завершить аскезу досрочно? Она останется в прошлых.')) return;
  try { AS = await api('/askesis?id=' + id, { method: 'DELETE' }); paintAskesis(); refreshNativeAskesis(); } catch (e) { toast('Не получилось'); }
}

/* ══════════ Желания с фото для визуализации ══════════ */
function renderWishes(r){
  const html = r.items.map(w => `<article class="wish-card">
    ${w.photo?`<button data-on="click:showWishPhoto-a0-a1" data-a0="${w.id}" data-a1="${encodeURIComponent(w.photoTs)}" class="wish-picture" type="button" aria-label="Открыть фото желания: ${esc(w.text)}"><img src="/app/api/wishes/photo?id=${w.id}&t=${encodeURIComponent(w.photoTs)}" alt="${esc(w.text)}" loading="lazy"></button>`:`<button data-on="click:wishPhoto-a0" data-a0="${w.id}" class="wish-picture" type="button">＋ Добавить фото</button>`}
    <div class="wish-copy"><p>${esc(w.text)}</p><button data-on="click:toggleWish-a0" data-a0="${w.id}" class="btn ghost sm" type="button" aria-pressed="${!!w.done}">${w.done?'✓ Сбылось · отменить отметку':'Сбылось'}</button>${w.photo?`<button data-on="click:wishPhoto-a0" data-a0="${w.id}" class="btn ghost sm" type="button">Заменить фото</button>`:''}</div></article>`).join('')
    || '';
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
      im.onerror = () => { URL.revokeObjectURL(url); toast('Не получилось прочитать файл — нужен JPG, PNG или скриншот'); done(null); };
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
