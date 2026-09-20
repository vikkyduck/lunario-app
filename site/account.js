/* Лунарио — Аккаунт и вход: анкета по шагам, поддержка, приглашение, напоминания, буква имени */
/* ── чат с поддержкой: список обращений, новое обращение, переписка ── */
let supTimer = null, supTicket = null;
const supportDrafts={};
function rememberSupportDraft(){if(supTicket!==null&&$('sup-reply'))supportDrafts[supTicket]=$('sup-reply').value;}
function supStop(){ clearTimeout(supTimer); supTimer = null; supTicket = null; }
async function supOpen(){
  rememberSupportDraft();supStop(); const box = $('sup-box'); box.innerHTML = LOADING;
  try{
    const c = ctx(); const r = await api('/support/tickets'); if (!c.alive() || wgOpen !== 'support') return;   /* поздний ответ после выхода не рисуем (F05) */
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
    const c = ctx(); const t = await api('/support/ticket?id='+id);
    if(!c.alive()||supTicket!==id||wgOpen!=='support')return;
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
  }catch(e){ if(supTicket!==id||wgOpen!=='support')return;const msg=$('sup-msg2');if(msg)msg.textContent='Не получилось обновить — текст остался в поле';else box.innerHTML='<p class="msg err">Не получилось открыть обращение. <button data-on="click:supThread-a0" data-a0="'+id+'" class="btn ghost sm" type="button">Повторить</button></p>'; }
}
async function supSend(id){
  const text = $('sup-reply').value.trim(), msg = $('sup-msg2'); showMsg(msg); if(!text) return;
  try{ const r = await api('/support/ticket?id='+id,{method:'POST',body:JSON.stringify({text})}); if(!r.ok) throw new Error(r.error); if(supTicket===id&&$('sup-reply')?.value.trim()===text){$('sup-reply').value='';supportDrafts[id]='';growTextarea($('sup-reply'));}hap('ok'); supThread(id); }
  catch(e){ showMsg(msg, 'Не отправилось.', true); }
}

/* ══════════ Реферальная ссылка: одна на все места — «Позвать подругу», совместимость, открытки ══════════
   Код приходит в /api/me (user.refCode); ссылка открывает приложение, внутри — инструкция по установке. Кто пришел по ссылке —
   users.invited_by, видно в кабинете и здесь именами. Подарок обеим: неделю вдвое больше подробных разборов. */
const refLink = () => S.user?.refCode ? `${location.origin}/app/?ref=${S.user.refCode}` : `${location.origin}/app/`;
const inviteText = (who) => who === 'compat'
  ? `Посчитала нашу совместимость в Лунарио — посмотри, что там у тебя. Это бесплатно, а внутри есть, как поставить приложение на телефон:\n${refLink()}`
  : `Это Лунарио — пространство, где можно услышать себя: карта дня, дневник, настроение. Бесплатно. Заходи по моей ссылке, внутри — как поставить на телефон:\n${refLink()}`;
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
  catch(e){ const el = $('inv-link'); if (el) { el.select(); toast('Скопируйте ссылку вручную'); } else toast('Не получилось скопировать: ' + value); }
  track('invite_copy', where || '');
}
async function loadInvite(){
  try{
    const c = ctx(); const i = await api('/invite'); if (!c.alive()) return;
    const names = (i.broughtNames || []).join(', '), rest = i.brought - (i.broughtNames || []).length;
    const brought = i.brought ? `<p class="hint mt-3">По вашей ссылке пришли: ${i.brought}${names ? ` — ${esc(names)}${rest > 0 ? ` и еще ${rest} без имени` : ''}` : ''}</p>` : '<p class="hint mt-3">По вашей ссылке пока никто не приходил — здесь появятся имена.</p>';
    $('inv-box').innerHTML = `
      <div class="field mb-0"><input id="inv-link" class="compact" readonly value="${esc(i.link)}" aria-label="Моя ссылка"></div>
      ${inviteButtonsHtml('invite')}
      ${brought}`;
  }catch(e){ $('inv-box').innerHTML = '<p class="hint">Ссылка появится чуть позже.</p>'; }
}
async function addWish(){
  const t=$('w-text').value.trim(); if(t.length<3){ toast('Сформулируйте чуть подробнее'); return; }
  if(addWish.saving) return; addWish.saving=true;$('wish-save').disabled=true;
  const photo=XP.wishPhoto; addWish.op=addWish.op||opKey();   /* повтор после потерянного ответа — то же желание, не второе (R05) */
  try {
    const r=await api('/wishes',{method:'POST',body:JSON.stringify({text:t,photo,op:addWish.op})}); addWish.op='';
    if(XP.wishPhoto===photo){XP.wishPhoto='';paintWishDraft();}
    if($('w-text').value.trim()===t) $('w-text').value='';
    renderWishes(r); hap('done'); toast(r.repeated?(r.removed?'Это желание уже было удалено':'Желание уже сохранено'):'Желание сохранено');
  } catch(e){ toast(ERR_SAVE_KEPT); }
  finally { addWish.saving=false;$('wish-save').disabled=false; }
}
/* done — желаемое состояние, а не «переключить» (F06): повтор запроса после обрыва не вернет отметку назад */
async function toggleWish(id){
  hap();
  const cur=(renderWishes.items||[]).find((w)=>w.id===id);
  try { renderWishes(await api('/wishes',{method:'PATCH',body:JSON.stringify({id,done:cur?!cur.done:true})})); }
  catch(e){ toast('Не получилось отметить'); }
}
/* Подсказки и диктовка — в «Записать мысль» (j) и в первой ячейке карточки дня (dc): одна механика, разные поля */
const DICT_SCOPES={dc:{text:'dc-text',btn:'dc-mic',note:'dc-speech-note'}};   /* dc.text подставляет шаг карточки дня (dcDictate) */
/* подпись кнопки диктовки: у текстовой — текст, у микрофона-иконки в поле — aria-label и класс on */
function dictLabel(btn,text,on){ if(!btn)return; if(btn.classList.contains('dc-mic')){btn.setAttribute('aria-label',text);btn.title=text;btn.classList.toggle('on',!!on);} else btn.textContent=text; btn.setAttribute('aria-pressed',on?'true':'false'); }
function journalPrompt(text,scope='j'){
  const el=$(DICT_SCOPES[scope].text); if(!el) return;
  if(!el.value.trim()) el.value=text+'\n';
  el.focus(); el.setSelectionRange(el.value.length,el.value.length); growTextarea(el); hap();
}
let journalSpeech=null;
function prepareDictation(){
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  for(const c of Object.values(DICT_SCOPES)){const btn=$(c.btn),note=$(c.note);if(!btn)continue;
    dictLabel(btn,supported?'Продиктовать':'Диктовка с клавиатуры',false);
    if(note)note.textContent=supported?'Браузер может отправлять голос своему сервису распознавания. В Лунарио сохраняется текст.':'Нажмите микрофон на клавиатуре телефона или включите системную диктовку';}
}
function stopJournalDictation(){const rec=journalSpeech;journalSpeech=null;if(rec){rec.onresult=rec.onerror=rec.onend=null;try{rec.abort();}catch(e){}}prepareDictation();}
function journalDictate(scope='dc'){
  const c=DICT_SCOPES[scope]; if(!$(c.btn)) return;
  if(journalSpeech){journalSpeech.stop();return;}
  prepareDictation(); if($(c.note))$(c.note).hidden=false;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){$(c.text).focus();return;}
  const rec=new Recognition();journalSpeech=rec;rec.lang='ru-RU';rec.interimResults=false;
  dictLabel($(c.btn),'Остановить диктовку',true);
  rec.onresult=e=>{if(journalSpeech!==rec)return;const el=$(c.text);for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal!==false)el.value+=(el.value.trim()?' ':'')+e.results[i][0].transcript;el.value=el.value.slice(0,2000);growTextarea(el);};
  rec.onerror=e=>{if(journalSpeech!==rec||e.error==='aborted')return;toast(e.error==='not-allowed'?'Разрешите микрофон в настройках браузера или используйте клавиатуру':'Не получилось распознать речь');};
  rec.onend=()=>{if(journalSpeech!==rec)return;journalSpeech=null;prepareDictation();};
  try{rec.start();}catch(e){stopJournalDictation();toast('Не получилось включить диктовку');}
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
      ${r.rings.map(([n,v,why])=>`<div class="ring"><svg width="54" height="54" viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle class="v" cx="28" cy="28" r="24" fill="none" stroke="#d9b868" stroke-width="4" stroke-linecap="round" data-p="${v}"/></svg><span class="val">${v}%</span><span class="lbl">${n}</span>${why?`<small class="hint">${esc(why)}</small>`:''}</div>`).join('')}
      </div><p class="mt-3">${esc(r.text)}</p>
      ${r.method?`<p class="hint mt-2">${esc(r.method)}</p>`:''}${r.question?`<p class="practice-question mt-3">${esc(r.question)}</p>`:''}
      <div class="compat-invite mt-4"><span class="eyebrow">Позвать в Лунарио</span><p class="hint mt-2">Отправьте партнеру или подруге ссылку: по ней открывается приложение, внутри — как поставить его на телефон.</p>${inviteButtonsHtml('compat', { shareLabel: 'Отправить ссылку' })}</div>`;
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
    picked=null; geo.textContent='';
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

/* ── анкета по шагам: один вопрос на экран (решение владелицы 19.09), как в дневнике; отправка — прежняя, по o-go ── */
const OB_STEPS=[['name','Имя'],['birth','Дата'],['time','Время'],['city','Город'],['done','Готово']];
let obIdx=0;
function obStep(n){
  obIdx=Math.max(0,Math.min(OB_STEPS.length-1,n));
  document.querySelectorAll('#o-form .ob-step').forEach((el,i)=>{ el.hidden=i!==obIdx; });
  $('ob-dots').innerHTML=OB_STEPS.map((_,i)=>`<i class="${i<obIdx?'done':i===obIdx?'on':''}"></i>`).join('');
  $('ob-names').innerHTML=OB_STEPS.map(([,t],i)=>`<span class="${i<obIdx?'done':i===obIdx?'on':''}">${t}</span>`).join('<i>·</i>');
  if(obIdx===OB_STEPS.length-1){ const askMail=S.mailReady&&!S.user?.email; $('ob-done-q').textContent=askMail?'Куда прислать код?':ui('onb.done','Почти готово'); }
  const inp=document.querySelector('#o-form .ob-step:not([hidden]) input:not([type=checkbox])');
  if(inp&&obIdx>0&&inp.type!=='date'&&inp.type!=='time') setTimeout(()=>inp.focus({preventScroll:true}),60);
  scrollToTop(0);
}
function obNext(){
  const key=OB_STEPS[obIdx][0], msg=$('o-msg');
  if(key==='birth'&&!$('o-birth').value){ toast('Укажите дату рождения — без нее подсказки будут общими'); $('o-birth').focus(); return; }
  if(key==='birth'){ const d=$('o-birth').value; if(d<'1900-01-01'||d>new Date().toISOString().slice(0,10)){ toast('Проверьте дату рождения'); return; } }
  showMsg(msg); hap(); obStep(obIdx+1);
}
function obBack(){ hap(); obStep(obIdx-1); }
function obSkipTime(){ $('o-time').value=''; hap(); obStep(obIdx+1); }
document.querySelectorAll('#o-form .ob-step input:not([type=checkbox])').forEach(inp=>inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&obIdx<OB_STEPS.length-1&&!$('o-city-list').classList.contains('on')){ e.preventDefault(); obNext(); } }));
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
    : 'Нет связи — анкета осталась на месте, нажмите еще раз', true);
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
function loadHistory(){ loadWishes(); loadDayCard(); loadDays(); paintEveningSet(); }

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
/* ── Напоминания: не сразу после анкеты, а после первого записанного дня (решение 19.09): анкета → «Сегодня» с личным результатом,
   мастер — строкой в записанном дне и в Аккаунт → Уведомления. «Включить» — нажатие, на которое телефон спрашивает разрешение ── */
function finishOnboarding(){ startApp(); S.freshOnboard=true; go('home'); }   /* onboard_done пишет сервер в POST /api/profile */
let rhythmBack='home';
function openRhythm(from){ rhythmBack=from||'home'; rhythmStep(2); go('rhythm'); track('rhythm_view',from||''); }
function rhythmStep(n){
  const v=$('v-rhythm'); if(!v)return; v.dataset.step=String(n);
  const note=$('rh-device-note'); if(note){ note.textContent=rhythmDeviceNote(); if(IS_IOS&&!PUSH_OK&&!IOS_SHELL) note.append(' ', Object.assign(document.createElement('a'), { href: '/app/install', className: 't-gold', textContent: 'Как добавить →' })); }
  scrollToTop(0);
}
/* На iPhone в Safari пуши не приходят — только с экрана «Домой»; человеку лучше узнать это здесь, а не через три дня тишины */
function rhythmDeviceNote(){
  if(IOS_SHELL) return 'Придут на этот iPhone';
  if(IS_IOS && !PUSH_OK) return 'На iPhone приходят только с экрана «Домой».';
  if(!PUSH_OK) return 'Этот браузер не показывает уведомления — включите с телефона';
  return 'Придут на это устройство';
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
  }catch(e){toast('Напоминания не сохранились — их можно включить в Аккаунте');}
  finally{rhythmEnable.busy=false;btn.disabled=false;btn.textContent='Включить напоминания';rhythmLater();go(rhythmBack);}
}
function rhythmSkip(){track('rhythm_enable','none');rhythmLater();go(rhythmBack);}
/* строка «Напомнить вечером?» в записанном дне показывается, пока мастер не открывали; после — только Аккаунт → Уведомления */
const rhythmLaterKey=()=>'lun_rhythm_seen_'+(S.user?.id||0);
function rhythmLater(){ try{ localStorage.setItem(rhythmLaterKey(),'1'); }catch(e){} }
function rhythmSeen(){ try{ return localStorage.getItem(rhythmLaterKey())==='1'; }catch(e){ return false; } }

function loadReminders(force){
  if (S.rem && !force) return Promise.resolve(S.rem);
  if (remPromise && !force) return remPromise;
  remPromise = api('/reminders').then(async r => { S.rem = Object.fromEntries(r.items.map(i => [i.feature, i])); S.pushKey = r.push.key; S.pushDevices = r.push.devices || []; await syncPushDevice(); return S.rem; }).catch(e => { remPromise = null; throw e; });
  return remPromise;
}
const remBox = (f, full=false) => `<div class="rem" data-rem="${f}" data-full="${full}"></div>`;
/* Строка уведомлений под заголовком виджета: настройки подгружаются, если еще не были */
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
    const actions=`<div class="rem-actions">${reconnect?`<button data-on="click:remConnect-a0" data-a0="${f}" type="button" class="btn ghost sm" ${busy?'disabled':''}>Подключить это устройство</button>`:''}${r.enabled&&(PUSH_OK||IOS_BRIDGE>=4)?`<button data-on="click:remTest-a0" data-a0="${f}" type="button" class="btn ghost sm" ${busy?'disabled':''}>Отправить пробное</button>`:''}</div>`;
    box.innerHTML=`${full?toggle:''}<button data-on="click:remEdit-a0" data-a0="${f}" type="button" class="rem-summary text-action" aria-label="${full?'Время и регулярность':esc('Уведомления · '+state+'. Время и регулярность')}" aria-expanded="${edit}" aria-controls="${panel}">${full?'Время и регулярность':`<i class="ico bell"></i><span>Уведомления · ${esc(state)}</span>`}<span aria-hidden="true">${edit?'−':'⌄'}</span></button>
      ${full?actions:''}<div id="${panel}" class="rem-body" ${edit?'':'hidden'}>
        ${full?'':toggle+`<p class="rem-status" role="status">${esc(remStatus(f,r))}</p>`+(!remDeviceReady()?`<button data-on="click:openWidget-remind" type="button" class="btn ghost sm">Разрешения уведомлений</button>`:'')+actions}
        <div class="rem-row"><label for="${panel}-time">Время</label><input data-on="change:remSave-a0-time-value" data-a0="${f}" id="${panel}-time" aria-label="Время уведомления" type="time" value="${r.time}"></div>
        <div class="chips flow mt-3" aria-label="Регулярность">${(f === 'week' ? ['weekly'] : ['daily','weekdays','weekly']).map(k => `<button data-on="click:remSave-a0-freq-a1" data-a0="${f}" data-a1="${k}" type="button" class="chip${r.freq === k ? ' on' : ''}" aria-pressed="${r.freq===k}">${FREQ_LABEL[k]}</button>`).join('')}</div>
        ${r.freq === 'weekly' ? `<div class="chips flow mt-2" aria-label="День недели">${WD_SHORT.map((w,i) => `<button data-on="click:remSave-a0-weekday-a1" data-a0="${f}" data-a1="${i+1}" type="button" class="chip${r.weekday === i+1 ? ' on' : ''}" aria-pressed="${r.weekday===i+1}">${w}</button>`).join('')}</div>` : ''}
        <p class="hint mt-3">Часовой пояс: ${esc(TZ || 'Europe/Moscow')}</p>
        ${f==='evening' ? '' : f==='morning' ? '' : ''}

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
  catch(e) { toast('Не получилось включить уведомления'); }
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
  } catch(e) { toast('Не получилось включить уведомления'); }
  finally { remBusy[f]=false; REM_ORDER.forEach(paintRem); }
}
async function remSave(f, patch){
  try {
    const r = await api('/reminders', {method:'POST',body:JSON.stringify({feature:f,tz:TZ,...patch})});
    S.rem[f] = r.item;
    if (IOS_SHELL && (!r.item.enabled || S.nativePermission==='granted')) await nativeSchedule(f);
    paintRem(f); return true;
  } catch(e) { paintRem(f); toast(ERR_SAVE); return false; }
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
/* «Напоминания» в аккаунте: все функции одним списком */
async function paintAllReminders(){
  const box = $('rem-all'); box.innerHTML = LOADING;
  try { await loadReminders(true); }
  catch (e) { box.innerHTML = '<p class="msg err">Не получилось загрузить настройки уведомлений.</p><button data-on="click:paintAllReminders" type="button" class="btn ghost mt-3">Повторить</button>'; return; }
  box.innerHTML = `<p id="rem-device-status" class="rem-status" role="status"></p>
    <div class="list mt-3">${REM_ORDER.map(f => `<div class="item"><b class="mb-2">${esc(S.rem[f].title)}</b>${remBox(f,true)}</div>`).join('')}</div>`;
  REM_ORDER.forEach(paintRem);
  if (IOS_SHELL && IOS_BRIDGE >= 2) nativePost({ type: 'scheduleStatus' });
}

/* ══════════ Буква имени — в кружке справа вверху на каждой вкладке (дверь в «Аккаунт») и в карточке профиля. Фото участницы снято 20.09
   (владелица и Марина, голос ЦА: «это не соцсеть»); загруженные раньше фото на экране не показываются, API /photo остается для экспорта ══════════ */
function paintAvatar(){
  const u = S.user, letter = (u.name || '').trim().charAt(0).toUpperCase() || '✦';
  document.querySelectorAll('.acct-btn').forEach(el=>{ el.textContent = letter; });
  const av = $('ac-avatar'); if (av) av.textContent = letter;
}
/* «Аккаунт» открывается с любой вкладки — «← Назад» возвращает туда же */
function openAccount(){ S.accountFrom = activeView(); go('account'); }
function accountBack(){ hap?.(); go(S.accountFrom && S.accountFrom !== 'account' ? S.accountFrom : 'home'); }
