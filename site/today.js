/* Лунарио — Вкладка «Сегодня»: герой, действие дня, настрой, строки утра */
/* ── главная ── */
const ordinal = (n) => n + '-й';
/* Одно правило на все цитаты: внутри «…» точка в конце не ставится (решение владелицы 20.09). unperiod — для холста, quoted — для разметки */
const unperiod = (t) => String(t || '').trim().replace(/\.+$/, '');
const quoted = (t) => '«' + esc(unperiod(t)) + '»';
/* Строка-плитка: надзаголовок · текст · действие справа — одна разметка на «Вечер», «Вчера», «Обо мне», «Подсказки», «Напоминания».
   on — 'click:имя' обработчика (кнопка) или { href } (ссылка); attrs — дополнительные атрибуты (data-a0, id, класс) */
function row(eyebrow, text, go, on, attrs = '') {
  const inner = `<span class="eyebrow">${eyebrow}</span><b>${text}</b>${go ? `<span class="later-go">${String(go).replace(/\s*→$/, '')}</span>` : ''}`;   /* действие — кнопкой, без стрелки */
  return typeof on === 'object' ? `<a class="later-row" href="${on.href}" ${attrs}>${inner}</a>` : `<button data-on="${on}" class="later-row" type="button" ${attrs}>${inner}</button>`;
}
/* «Сохранить открытку»: настрой дня, тема и вопрос — открыткой на экран блокировки; собирается заранее, как остальные */
/* строки «тема дня · по прогнозу дня» над настроем и «Неделя собралась» по воскресеньям сняты (решение владелицы 20.09); вечерний шаг — в карточке действия под Луной */

/* ══════════ Текст последнего уведомления — карточкой на «Сегодня» ══════════
   На телефоне уведомление обрезается, а нажатие ведет на экран, где тот же смысл разложен по плиткам — человек ищет «тот текст»
   и не находит. Карточка показывает заголовок и текст целиком, пока ее не скроют; из уведомления (?open=) к ней прокручиваем. */
const PUSH_KIND = { morning: 'Утреннее уведомление', evening: 'Вечернее уведомление', week: 'Уведомление недели' };
const pushHidden = () => { try { return localStorage.getItem('lun_push_hidden') || ''; } catch(e) { return ''; } };
async function loadPushNote(force=false){
  const box = $('push-note'); if (!box || !S.user?.onboarded || IOS_SHELL) return null;
  if (force || S.pushLast === undefined) { try { const c = ctx(); const r = await api('/push/last'); if (!c.alive()) return; S.pushLast = r.item || false; } catch(e) { if (e.code === 'cancelled') return; S.pushLast = S.pushLast ?? false; } }   /* один запрос на сессию; из уведомления — заново */
  const it = S.pushLast;
  if (!it || String(it.id) === pushHidden()) { box.hidden = true; box.replaceChildren(); return null; }
  if (it.feature === 'morning' && S.day?.set?.text && it.title === S.day.set.text) { box.hidden = true; box.replaceChildren(); return null; }   /* утреннее — тот же настрой, что уже на экране */
  const when = new Date(it.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<button data-on="click:hidePushNote" class="later-row push-row" type="button"><span class="eyebrow">${PUSH_KIND[it.feature] || 'Уведомление'} · ${when}</span><b>${esc(it.title)}</b>${it.body ? `<small>${esc(it.body)}</small>` : ''}<span class="later-go" aria-label="Скрыть">×</span></button>`;
  box.hidden = false; return box;
}
function hidePushNote(){ if (S.pushLast) { try { localStorage.setItem('lun_push_hidden', String(S.pushLast.id)); } catch(e) {} } const box = $('push-note'); if (box) { box.hidden = true; box.replaceChildren(); } hap(); }
/* «Вчера вечером: „…“» — строка на «Сегодня» с первой фразой вчерашней записи; тап открывает день. Дневник возвращает слова утром */
async function paintYesterday(){
  const box=$('home-yesterday'); if(!box||!S.user?.onboarded)return;
  if(S.yesterday===undefined){ try{ const c=ctx(); const r=await api('/days?calendar=1'); if(!c.alive())return; S.yesterday=(r.items||[])[0]||null; S.daysTotal=r.total||0; window.tourMaybe?.(); }catch(e){ if(e.code==='cancelled')return; S.yesterday=null; } }
  const y=S.yesterday; if(!y){ box.hidden=true; box.innerHTML=''; return; }
  if(y.empty){ if(new Date().getHours()<12){ box.innerHTML=row('Вчера','Не записали','Дописать →','click:dcFor-a0',`data-a0="${y.day}"`); box.hidden=false; } else { box.hidden=true; box.innerHTML=''; } return; }
  const moods=y.moods.map(m=>(MOOD_LABEL[m]||m.replace(/^own:/,'')).toLowerCase());
  const line=y.text?quoted(y.text.length>80?y.text.slice(0,80).replace(/\s+\S*$/,'')+'…':y.text):moods.length?esc(moods.join(', ')):'фото дня';
  box.innerHTML=row('Вчера',line,'Открыть →','click:openDay-a0',`data-a0="${y.day}"`); box.hidden=false;
}
/* Первые дни после анкеты: «Натальная карта готова» — мы спросили дату, время и город, и вот зачем; тап ведет прямо в карту,
   а не на вкладку. После открытия строка не возвращается */
const natalRowKey=()=>'lun_natal_row_'+(S.user?.id||0);
function paintNatalRow(){
  const box=$('home-natal'); if(!box)return;
  let seen=false; try{ seen=localStorage.getItem(natalRowKey())==='1'; }catch(e){}
  const due=!!S.user?.birth&&!seen&&(S.freshOnboard||(S.daysTotal||0)<3);
  box.hidden=!due; box.innerHTML=due?row('Обо мне',ui('home.natal_row','Натальная карта готова'),'Открыть →','click:openNatalFromHome'):'';
}
function openNatalFromHome(){ try{ localStorage.setItem(natalRowKey(),'1'); }catch(e){} go('about'); openWidget('natal'); }

/* ══════════ Карточка действия на «Сегодня» (по обзору 19.09): один шаг сразу под Луной. Днем — вопрос дня с полем и «Ответить себе»
   (ответ есть — виден, «Продолжить»); вечером — «Запомнить этот день» или «День записан ✓ · Дополнить». Ответ — тот же, что в
   панели «Вопрос дня» и в карточке дня (kind='answer', один на день) ══════════ */
const EVENING_HOUR=17;   /* с этого часа «Сегодня» и дневник живут вечером: один порог на все */
const isEvening=()=>new Date().getHours()>=EVENING_HOUR;
async function paintHomeAction(){
  const box=$('home-action'), d=S.day; if(!box||!d)return;
  if(isEvening()){
    box.innerHTML=d.remembered
      ?row('Вечер',ui('diary.done','День записан ✦'),'Дополнить →','click:goDayCard')
      :`<div class="card ha"><span class="eyebrow">Вечер</span><p class="ha-q">${ui('home.evening_q','Что хочется сохранить из сегодняшнего дня?')}</p><button data-on="click:goDayCard" class="btn" type="button">${ui('home.evening_btn','Запомнить этот день')}</button></div>`;
    box.hidden=false; return;
  }
  if(!d.question){ box.hidden=true; box.innerHTML=''; return; }
  await ensureAnswer();
  const saved=ANS.saved&&ANS.saved.day===d.date?ANS.saved:null, editing=!saved||ANS.open;
  box.innerHTML=`<div class="card ha"><span class="eyebrow">Вопрос дня</span><p class="ha-q">${esc(d.question)}</p>${editing
    ?`<div class="field"><textarea data-on="input:answerInput-this" id="ha-a" maxlength="2000" rows="2" placeholder="Пара строк — как есть…">${esc(ANS.draft||(saved?saved.text:''))}</textarea></div><div class="answer-actions"><button data-on="click:haSave" id="ha-save" class="btn" type="button" ${ANS.saving?'disabled':''}>${ANS.saving?'Сохраняем…':saved?'Обновить':ui('home.answer_btn','Ответить себе')}</button>${saved?`<button data-on="click:haCancel" class="btn ghost sm" type="button">Отмена</button>`:''}</div>`
    :`<p class="entry-text">${esc(saved.text)}</p><div class="answer-actions"><button data-on="click:haEdit" class="btn ghost sm" type="button">${ui('home.answer_more','Продолжить')}</button><span class="saved-state">В дневнике</span></div>`}</div>`;
  box.hidden=false; requestAnimationFrame(()=>{ const t=$('ha-a'); if(t)growTextarea(t); });
}
function haEdit(){ ANS.open=true; paintHomeAction().then(()=>$('ha-a')?.focus({preventScroll:true})); }
function haCancel(){ ANS.open=false; ANS.draft=''; draftClear('answer',S.day.date); paintHomeAction(); }
function haSave(){ saveAnswerText($('ha-a')?.value); }
/* Под настроем дня: расписание включено, а сюда уведомления не приходят — одна строка и одно нажатие */
function paintPushNudge(){
  const box = $('home-push'); if (!box) return;
  const due = pushNudgeDue(); box.hidden = !due; if (!due) { box.innerHTML = ''; return; }
  box.innerHTML = !PUSH_OK
    ? row('Напоминания','Придут с экрана «Домой»','Как добавить →',{href:'/app/install'},'id="push-nudge"')
    : Notification.permission === 'denied'
    ? row('Напоминания','В этом браузере запрещены','Как разрешить →','click:openWidget-remind','id="push-nudge"')
    : row('Напоминания','На этом устройстве не подключены','Включить →','click:homePushConnect','id="push-nudge"');
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
  catch (e) { toast('Не получилось включить уведомления'); }
  finally { paintPushNudge(); REM_ORDER.forEach(paintRem); }
}
function goDayCard(){ if(DC.forDay){DC.forDay=null;DC.state=null;} go('history'); requestAnimationFrame(() => $('day-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
let morningPc = { key: '', id: null };
function paintMorningPostcard(d){
  const box = $('h-wish-actions'); if (!box) return;
  $('h-wish').hidden = !d.set?.text;
  if (!d.set?.text) { box.innerHTML = ''; return; }
  const key = [d.date, d.set.text, d.card?.name || '', d.rune?.name || ''].join('|');
  if (key !== morningPc.key) morningPc = { key, id: regRes({ type: 'morning', text: d.set.text, question: d.set.question || d.question || '', theme: d.theme?.title || '', day: d.date,
    moonPct: d.moonPct, waxing: (d.moonPhase || 0) < 0.5, card: d.card?.name || '', rune: d.rune?.name || '', lunar: d.lunar ? `${ordinal(d.lunar.n)} лунный день` : '' }) };
  box.innerHTML = `<button data-on="click:shareRes-a0" data-a0="${morningPc.id}" class="btn ghost sm" type="button"><i class="ico share"></i>Поделиться</button>`;
  /* открытка собирается, когда экран уже нарисован и главный поток свободен */
  (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(preparePending, { timeout: 3000 });
}

/* ══════════ Герой «Сегодня» (по разбору референсов 19.09): большая Луна с настоящей фазой, под ней «Растущая Луна · 8-й лунный день»
   антиквой и полоска недели с маленькими лунами. Строки «имя · Луна сейчас в Рыбах» и даты полнолуния/новолуния сняты (решение владелицы 20.09).
   Фазы на дни недели — от сегодняшней доли цикла по синодическому месяцу: для значков хватает. ══════════ */
const SYNODIC=29.530588;
function paintHero(d){
  const ph=$('hero-phase'); if(!ph||!d)return;
  ph.innerHTML=[esc(d.moon||''),d.lunar?`<span class="nowrap">${ordinal(d.lunar.n)} лунный</span> день`:''].filter(Boolean).join('\u00a0· ');   /* «8-й» не рвется по дефису, точка держится за фазой */
  if(typeof d.moonPhase==='number') window.moonPaint?.($('moonHero'),d.moonPhase);   /* своя фаза у холста — герой не зависит от общего рисования */
  const strip=$('week-strip'); if(!strip)return;
  const today=new Date(d.date+'T12:00:00Z'), dow=(today.getUTCDay()+6)%7;
  /* день недели — кнопка: прошлые и сегодня открывают этот день в Дневнике, будущие — нет (по обзору экспертов 19.09: полоска выглядела нажимаемой) */
  strip.innerHTML=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((n,i)=>{ const off=i-dow, dt=new Date(today.getTime()+off*864e5), phase=((((d.moonPhase||0)+off/SYNODIC)%1)+1)%1, day=dt.toISOString().slice(0,10);
    const inner=`<canvas width="26" height="26" data-phase="${phase.toFixed(3)}"></canvas><i>${n}</i><small>${dt.getUTCDate()}</small>`;
    return off>0?`<span class="ws-day future">${inner}</span>`:`<button data-on="click:openDay-a0" data-a0="${day}" class="ws-day${off===0?' on':''}" type="button" aria-label="${off===0?'Сегодня в Дневнике':fmtDayWords(day)}">${inner}</button>`; }).join('');
  strip.querySelectorAll('canvas').forEach(cv=>window.moonPaint?.(cv,+cv.dataset.phase));
}
function paintHome(){
  const u=S.user, d=S.day;
  const dt=new Date(d.date+'T12:00:00');
  $('h-date').textContent=dt.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
  $('h-wish').textContent = d.set?.text || '';
  paintHero(d); paintHomeAction(); paintHomeArt(); paintMorningPostcard(d); paintPushNudge(); paintNatalRow();
  if (!S.rem) loadReminders().then(paintPushNudge).catch(() => {});   /* строка «не подключены» — когда расписание известно */
  paintAvatar();
  const staff = isStaff(u);                                           /* админы и все, кто есть в таблице доступов */
  { const cabs = $('ac-cabs'); if (cabs) { if (staff) cabs.hidden = false; else cabs.remove(); } }   /* не сотруднику плитки нет и в DOM — иначе скрытая ломала бы счет плиток в сетке */
  document.body.classList.toggle('staff', staff);   /* вход в кабинеты — строкой в Аккаунте, шапка без второго кружка */
  $('h-moon').innerHTML = esc(d.moon) + (d.lunar ? ' · <span class="nowrap">' + esc(ordinal(d.lunar.n)) + ' лунный день</span>' : '');   /* «6-й» не рвется по дефису */
  $('h-lunar').textContent = d.lunar ? d.lunar.period : '';
  moonSetPhase(d.moonPhase);
}
/* плашки практик в Дневнике — одной строкой, без подписей о состоянии (решение владелицы 20.09); состояние остается в S для вечернего пуша и подсказок */
function habitsHomeStatus(items){
  const due=items.filter(h=>h.due), done=due.filter(h=>h.today).length;S.habitsPending=due.length-done;S.habitsReady=true;S.habitsCount=items.length;
}
function gratitudeHomeStatus(done){ S.gratitudeDone=done; }
/* Что из практик уже сделано сегодня — один запрос /day-status, не чаще раза в 30 секунд */
let homeStatusRequest=null, homeStatusAt=0;
function refreshHomeStatus(force=false){
  if(homeStatusRequest)return homeStatusRequest;
  if(!force && Date.now()-homeStatusAt<30000)return Promise.resolve();
  const uid=S.user.id;
  homeStatusRequest=api('/day-status').then(r=>{
    if(S.user.id!==uid)return;
    S.answerDone=r.answer;
    habitsHomeStatus(r.habits); gratitudeHomeStatus(r.gratitude);
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
  paintRuneTile();
  if($('t-tonesub'))$('t-tonesub').textContent=d.question||'Вопрос по теме дня — ответ вечером в дневнике';
  if (wgOpen === 'tone') paintTone();
  renderMoods(); paintCardTile(); paintLunar(); loadNumerology();
}
function pickOwnMood(){ const w = ($('mood-own').value || '').trim().split(/\s+/)[0] || ''; if (!w) { toast('Напишите одно слово'); return; } pickMood('own:' + w.slice(0, 24), true); }   /* «Сохранить» всегда отмечает, не снимает */
/* Отметок за день несколько, как в карточке дня: нажатие отмечает, повторное — снимает (on — желаемое состояние, не переключение:
   повтор запроса дает тот же исход). Сервер отвечает всем списком дня; главное (S.mood) — первое из отмеченных, для открытки */
async function pickMood(id,on=!(S.moods||[]).includes(id)){
  hap();
  try{
    const r=await api('/mood',{method:'POST',body:JSON.stringify({mood:id,on})});
    S.moods=r.moods||[]; S.mood=r.mood||null; moodUI.own=S.moods.map(ownMood).find(Boolean)||null; renderMoods();
    paintMoodExtra(); if(S.day)dayChanged(S.day.date);   /* карточка дня, лента и неделя узнают об отметке (F25) */
  }catch(e){ toast(ERR_SAVE); }
}
async function loadNumerology(){
  if (S.num) { paintNum(S.num); return; }
  try{ const c=ctx(); const num=await api('/numerology'); if(!c.alive())return; S.num=num; paintNum(S.num); }
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
    <img class="yr-img" src="${i.image}" width="1080" height="1080" alt="Личный год ${y.n} · ${esc(i.energy)}">
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
  return e.code==='short_question' ? 'Напишите вопрос целиком, так вы потом вспомните, что вас волновало.'
    : e.code==='open_question' ? 'Этот вопрос — не про «да» или «нет». Спросите руны или карты — или переформулируйте: «Стоит ли…?»'   /* аудит v98, F19 */
    : e.code==='too_many' ? 'Вопросов за день уже сто — продолжим завтра'
    : 'Не получилось';
}
$('a-go').onclick=async()=>{
  const q=$('a-q').value.trim(), msg=$('a-msg'); showMsg(msg);
  $('a-go').disabled=true; $('a-go').textContent=S.mode==='yesno'?'Смотрим…':'Выберите ниже ↓';
  try{
    await runAsk(S.mode,q,$('a-result'),$('a-hint'),S.layout);
    $('a-result').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){ if(e.code!=='cancelled')showMsg(msg, askErrorText(e), true); }   /* закрыли выбор карт — просто тишина, кнопка снова работает (R11) */
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
/* Почта в «Аккаунте» — строкой под датой рождения (решение владелицы 20.09, панель «Вход по почте» снята). У аккаунта без почты —
   кнопка «Привязать почту»: тот же поток кода, что на анкете, разворачивается прямо в карточке профиля */
function accountMailOpen(){
  const box=$('ac-auth'); if(!box)return;
  box.hidden=false; $('ac-mail-btn').hidden=true;
  authMount('ac-auth', { step:'email', onDone:(r)=>{
    if (r.merged) { location.reload(); return; }   /* чужой аккаунт найден — перезагрузка подтянет его целиком */
    S.user=r.user; toast('Почта сохранена — доступ не потеряется'); box.hidden=true; box.innerHTML=''; loadAccount();
  } });
}
/* До анкеты — «Уже пользовались?» на анкете и экран входа: профиль нашелся — перезагрузка открывает приложение;
   почта новая — привязана к этому устройству, остается заполнить анкету (почту в ней уже не спрашиваем) */
function obDone(r){
  if (r.user && r.user.onboarded) { location.reload(); return; }
  S.user = r.user;
  if (auth.box === 'l-box') { $('l-after').style.display = ''; $('l-box').style.display = 'none'; return; }
  $('o-back').style.display = 'none'; $('o-mailfield').style.display = 'none';
  if (obIdx === OB_STEPS.length - 1) obStep(obIdx);   /* вошли на последнем шаге — заголовок «Куда прислать код?» сменяется на «Почти готово» */
  toast('Почта сохранена — осталось заполнить профиль');
}
const obAuthIdle = () => `<button data-on="click:auth-step-email-paintAuth" class="btn ghost sm full mt-3">Войти по почте</button>`;
/* all — отозвать сессии на всех устройствах: если телефон потерян или код входа попал не в те руки */
async function logout(all){
  if(!confirm(all?'Выйти на всех устройствах? Везде понадобится заново войти по коду; записи останутся в аккаунте.':'Выйти на этом устройстве? Записи останутся в аккаунте и вернутся при следующем входе.')) return;
  resetLocalAccount();   /* черновики, память предложений и состояние с анкетой — с устройства (политика выхода, R06); живые запросы отменены (F05) */
  await api(all?'/auth/logout-all':'/auth/logout',{method:'POST'});
  location.reload();
}

/* ══════════ Вопрос дня: к фразе на главной; ответ уходит в дневник ══════════ */
/* Ответ на вопрос дня — один на день и одно состояние ANS, где бы его ни писали: панель «Вопрос дня», карточка действия
   на «Сегодня» или шаг дневника. Все три читают ANS и после сохранения обновляют друг друга через paintAnswerEverywhere() */
const ANS={draft:'',saving:false,saved:null,loadedFor:'',open:false};
registerReset(()=>{ ANS.saved=null; ANS.draft=''; ANS.loadedFor=''; ANS.open=false; });   /* сброс аккаунта на устройстве (F05) */
async function ensureAnswer(){
  if(!S.day)return; if(ANS.saved&&ANS.saved.day!==S.day.date){ANS.saved=null;ANS.loadedFor='';}
  if(!ANS.draft){ const dr=draftGet('answer',S.day.date); if(dr!==null){ ANS.draft=dr; ANS.open=!!dr; } }   /* несохраненный ответ живет на устройстве (R07) */
  if(ANS.loadedFor===S.day.date)return;
  try{ const c=ctx(), day=S.day.date; const st=await api('/day'); if(!c.alive()||S.day?.date!==day)return; ANS.loadedFor=day; ANS.saved=st.answer?{id:st.answer.id,day:st.day,text:st.answer.text}:null; }catch(e){}
}
function answerFrom(a,day){ ANS.saved=a&&a.text?{id:a.id,day,text:a.text}:null; ANS.loadedFor=day; }   /* карточка дня уже знает ответ — панели не спрашивают заново */
/* сохранить ответ из любого места; textarea остается с текстом при ошибке */
async function saveAnswerText(t){
  t=(t||'').trim(); if(t.length<3){toast('Напишите хотя бы пару слов');return false;}
  if(ANS.saving)return false; ANS.saving=true; paintAnswerEverywhere();
  /* ответ на вопрос дня — один на день, повтор обновляет его: ключ операции здесь не нужен, дубля быть не может.
     День и контекст берутся до await (F05): поздний ответ после сброса не рисуется, черновик снимается у того дня, за который отвечали */
  const c=ctx(), day=S.day.date;
  try{ const r=await api('/journal',{method:'POST',body:JSON.stringify({text:t,kind:'answer',title:S.day.question})}); if(!c.alive())return true; draftClear('answer',day); if(S.day?.date!==day)return true; ANS.draft=''; ANS.open=false; ANS.saved={id:r.item.id,day:r.item.day,text:r.item.text};
    toast(r.updated?'Ответ обновлен в дневнике':'Записано в дневник'); hap('ok'); if(DC.state&&DC.state.day===r.item.day){DC.state.answer={id:r.item.id,text:r.item.text}; if(DC.mode!=='steps')DC.answer=r.item.text;} XP.timeline.dirty=true; return true; }
  catch(e){ if(e.code==='cancelled')return false; toast(ERR_SAVE_KEPT); ANS.draft=t; ANS.open=true; return false; }
  finally{ ANS.saving=false; paintAnswerEverywhere(); }
}
function paintAnswerEverywhere(){ if(wgOpen==='tone')paintTone(); paintHomeAction(); }
function paintTone(){
  const d=S.day,st=d.set;if(!$('tone-box'))return;
  const saved=ANS.saved&&ANS.saved.day===d.date?ANS.saved:null, text=ANS.draft||(saved?saved.text:'');
  $('tone-box').innerHTML=`${st?`<p class="hint mb-4">${esc(st.statement||st.text)}</p>`:''}
    <p class="practice-question">${esc(d.question)}</p>
    ${saved?`<div class="saved-state" role="status">В дневнике · ${fmtDay(saved.day)} — можно дописать</div>`:''}
    <div class="answer-form"><div class="field"><textarea data-on="input:answerInput-this" id="tone-a" aria-label="Ответ на вопрос дня" maxlength="2000" placeholder="Пара строк — как есть…">${esc(text)}</textarea></div></div>
    <div class="answer-actions"><button data-on="click:saveAnswer" id="tone-save" type="button" class="btn sm" ${ANS.saving?'disabled':''}>${ANS.saving?'Сохраняем…':saved?'Обновить в дневнике':'Отправить в дневник'}</button></div>`;
  requestAnimationFrame(()=>growTextarea($('tone-a')));
}
async function loadTone(){ paintTone(); await ensureAnswer(); paintTone(); }
function answerInput(el){ ANS.draft=el.value; draftSet('answer',S.day.date,el.value); growTextarea(el); }
function saveAnswer(){ saveAnswerText($('tone-a')?.value); }
