/* Лунарио — «Свериться с собой»: карты, руны, выбор руками, лунный день, небо, открытка, «Ответить себе» */
/* ══════════ Карты Таро и руны: каталог, результаты, история, открытки ══════════ */
/* Каталог: тексты и картинки карт и рун приходят одним запросом и дальше живут в памяти.
   Ответы сервера несут только коды и названия — по кодам экран находит полные тексты. */
/* Последний удачный каталог остается в браузере: без сети настроения, награды и вопросы берутся из него,
   а не из копий справочников в коде — источник у контента один, content.mjs. */
const catalogFrom = (c) => ({ cards: Object.fromEntries(c.cards.map(x => [x.slug, x])), runes: Object.fromEntries(c.runes.map(x => [x.slug, x])), layouts: c.layouts, habitIdeas: c.habitIdeas || [], askesisIdeas: c.askesisIdeas || [], lunarDays: c.lunarDays || [],
  quickMoods: c.quickMoods || [], moods: c.moods || [], moodFamilies: c.moodFamilies || {}, legacyMoods: c.legacyMoods || {},
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

/* Каждый показанный результат регистрируется: по номеру «Поделиться» знает, из чего собирать открытку. */
const RES = {}; let resSeq = 0, pendingRes = [];
function regRes(p){ const id = 'res' + (++resSeq); RES[id] = p; pendingRes.push(id); return id; }
function preparePending(){ const ids = pendingRes; pendingRes = []; ids.forEach(preparePostcard); }
/* Под результатом — одна кнопка «Поделиться» (прежняя «Скачать на телефон» снята: это то же меню — решение владелицы 20.09); открытка уходит вместе с текстом */
function actionsHtml(id){
  return `<div class="resrow utility-actions"><button data-on="click:shareRes-a0" data-a0="${id}" class="btn ghost sm" type="button"><i class="ico share"></i>Поделиться</button></div>`;
}
const qLine = (q) => q ? `<p class="italic center mb-3">«${esc(q)}»</p>` : '';

/* ── карта дня: иллюстрация, ключи, образ, совет, вопрос себе; остальное — под «Читать полностью» ── */

/* ══════════ Мысль к материалу (по обзору 19.09): карта, руна или расклад задают вопрос — и принимают ответ. Поле под «Вопросом себе»,
   «Сохранить мысль»; хранится отдельно от ответа на вопрос дня, с источником, вопросом и датой; повторное открытие — та же мысль
   и «Дополнить». Мысли за сегодня грузятся один раз (S.thoughts) ══════════ */
const thoughtKey=(source,slug,entry)=>entry?`${source}:${slug}:${entry}`:`${source}:${slug}`;
const TH={edit:{},saving:{}};
/* мысли по дням: сегодняшние — для форм, прошлые — чтобы у результата из истории была видна его мысль (аудит v98, F12, F13) */
async function ensureThoughts(day){
  day=day||S.day?.date; if(!day)return [];
  S.thoughtsBy=S.thoughtsBy||{}; if(S.thoughtsBy[day])return S.thoughtsBy[day];
  try{ const r=await api('/thoughts'+(day===S.day.date?'':'?day='+day)); S.thoughtsBy[day]=r.items||[]; }catch(e){ S.thoughtsBy[day]=[]; }
  return S.thoughtsBy[day];
}
const thoughtOf=(source,slug,entry,day)=>((S.thoughtsBy&&S.thoughtsBy[day||S.day?.date])||[]).find(t=>t.source===source&&t.slug===slug&&(t.entry||0)===(entry||0))||null;
const thoughtDraft=(key)=>draftGet('thought',key)||'';
/* entry — id результата (вопрос к рунам или картам): две одинаковые руны на разные вопросы — две разные мысли.
   day — день результата: за сегодня форма, за прошлый день — только уже записанная мысль */
function thoughtHtml(source,slug,name,question,entry=0,day=S.day?.date){
  const key=thoughtKey(source,slug,entry), saved=thoughtOf(source,slug,entry,day), today=day===S.day?.date, editing=today&&(!saved||TH.edit[key]);
  if(!today&&!saved)return '';
  const text=editing?(thoughtDraft(key)||(saved?saved.text:'')):'';
  return `<section class="thought" id="th-${esc(key)}" data-key="${esc(key)}" data-day="${esc(day||'')}">${editing
    ?`<p class="thought-q">${ui('thought.q','Что в этом относится к моей ситуации?')}</p>
       <div class="field"><textarea data-on="input:thoughtInput-a0-this" data-a0="${esc(key)}" maxlength="2000" rows="2" placeholder="Своими словами…">${esc(text)}</textarea></div>
       <div class="answer-actions"><button data-on="click:thoughtSave-a0-a1-a2-a3-a4" data-a0="${esc(source)}" data-a1="${esc(slug)}" data-a2="${esc(name)}" data-a3="${esc(question||'')}" data-a4="${entry||0}" class="btn sm" type="button" ${TH.saving[key]?'disabled':''}>${TH.saving[key]?'Сохраняем…':saved?'Обновить':ui('thought.save','Сохранить мысль')}</button>${saved?`<button data-on="click:thoughtCancel-a0" data-a0="${esc(key)}" class="btn ghost sm" type="button">Отмена</button>`:''}</div>`
    :`<p class="thought-q">${ui('thought.mine','Моя мысль')}</p><p class="entry-text">${esc(saved.text)}</p>
       <div class="answer-actions"><span class="saved-state">В дневнике · ${fmtDay(saved.day)}</span>${today?`<button data-on="click:thoughtEdit-a0" data-a0="${esc(key)}" class="btn ghost sm" type="button">Дополнить</button>`:''}<button data-on="click:openDay-a0" data-a0="${esc(saved.day)}" class="btn ghost sm" type="button">Открыть запись</button></div>`}
  </section>`;
}
const thoughtParts=(key)=>{ const [source,slug,entry]=key.split(':'); return [source,slug,Number(entry)||0]; };
/* после отрисовки панели — подтянуть сохраненные мысли этого дня и перерисовать блоки на месте */
async function paintThoughts(day){
  day=day||S.day?.date; await ensureThoughts(day);
  document.querySelectorAll(`.thought[data-key][data-day="${day}"]`).forEach(el=>{ const [source,slug,entry]=thoughtParts(el.dataset.key); const saved=thoughtOf(source,slug,entry,day); if(!saved)return;
    const name=el.querySelector('[data-a2]')?.dataset.a2||saved.name, q=el.querySelector('[data-a3]')?.dataset.a3||saved.question; el.outerHTML=thoughtHtml(source,slug,name,q,entry,day); });
}
function thoughtInput(key,el){ draftSet('thought',key,el.value); growTextarea(el); }   /* черновик — на устройстве, переживает перезагрузку (F06) */
function thoughtEdit(key){ TH.edit[key]=true; const el=$('th-'+key); const [source,slug,entry]=thoughtParts(key); const saved=thoughtOf(source,slug,entry); if(el&&saved){ el.outerHTML=thoughtHtml(source,slug,saved.name,saved.question,entry); $('th-'+key)?.querySelector('textarea')?.focus(); } }
function thoughtCancel(key){ TH.edit[key]=false; draftClear('thought',key); const el=$('th-'+key); const [source,slug,entry]=thoughtParts(key); const saved=thoughtOf(source,slug,entry); if(el&&saved)el.outerHTML=thoughtHtml(source,slug,saved.name,saved.question,entry); }
async function thoughtSave(source,slug,name,question,entry){
  entry=Number(entry)||0; const key=thoughtKey(source,slug,entry); if(TH.saving[key])return;
  const el=$('th-'+key), text=(el?.querySelector('textarea')?.value||'').trim();
  if(text.length<2){ toast('Напишите хотя бы пару слов'); return; }
  TH.saving[key]=true; if(el)el.outerHTML=thoughtHtml(source,slug,name,question,entry);
  try{
    const r=await api('/thought',{method:'POST',body:JSON.stringify({source,slug,name,question,text,entry})});
    await ensureThoughts(); const items=S.thoughtsBy[S.day.date].filter(t=>!(t.source===source&&t.slug===slug&&(t.entry||0)===entry)); items.push(r.item); S.thoughtsBy[S.day.date]=items;
    draftClear('thought',key); TH.edit[key]=false; toast(r.updated?'Мысль обновлена':'Записано в дневник'); hap('ok'); S.daysTotal=S.daysTotal||0;
    if(typeof dayChanged==='function'){ const keep=S.thoughtsBy[S.day.date]; dayChanged(S.day.date); S.thoughtsBy[S.day.date]=keep; }
  }catch(e){ toast(e.code==='too_many'?'Записей за день уже сто — мысль осталась в поле':ERR_SAVE_KEPT); draftSet('thought',key,text); }
  finally{ TH.saving[key]=false; const el2=$('th-'+key); if(el2)el2.outerHTML=thoughtHtml(source,slug,name,question,entry); }
}
function cardDayHtml(c, day, compact){
  const id = regRes({ type: 'card', card: c, day });
  const s = c.sections || {};
  return `<div class="center"><div class="title-gold">${esc(c.name)}</div>${c.keys ? `<div class="kw">${esc(keysLine(c.keys))}</div>` : ''}</div>
    ${(c.today || (s.advice && s.advice.length)) ? `<div class="card mt-3"><h3>Сегодня</h3>${c.today ? `<p class="today">${esc(c.today)}</p>` : paras((s.advice||[]).slice(0,1))}</div>` : ''}
    ${c.question ? `<section class="card-question"><h3>${ui('card.question','Вопрос себе')}</h3><p>${esc(c.question)}</p></section>` : ''}
    ${!compact ? thoughtHtml('card', c.slug, c.name, c.question || '', 0, day) : ''}
    ${moreBlock((s.image && s.image.length ? `<h3>Образ карты</h3>${paras(s.image)}` : '') + sectionsHtml(c, ['spread', 'state', 'shadow'], CARD_SEC) + ((c.today || (s.advice||[]).length>1)?'<h3>Совет карты</h3>'+paras(c.today?s.advice:(s.advice||[]).slice(1)):'') , 'Прочитать подробнее')}
    ${actionsHtml(id)}`;
}

/* ══════════ Выбор руками (по референсам, решение владелицы 19.09): веер рубашек или ряд камней — человек касается нужного числа,
   и только потом сервер вытягивает. Рубашки неотличимы, случайность та же, но выбор — его. pickCards рисует веер в box
   и ждет касаний; обещание исполняется, когда выбрано need штук. ══════════ */
let PICK=null;
const pickWord=(kind,n)=>kind==='tarot'?plural(n,'карту','карты','карт'):plural(n,'руну','руны','рун');
/* вся колода (22 карты веером в два ряда) и все руны (мешочек): выбор не выглядит обрезанным — решение владелицы 19.09 */
function pickerHtml(kind,need,total){
  const back=kind==='tarot'?`<img src="/app/assets/brand/card-back.svg?v=1" width="200" height="360" alt="">`:`<span class="stone-back"></span>`;
  const card=(i)=>`<button data-on="click:pickerTap-a0" data-a0="${i}" class="fan-card" type="button" aria-label="${kind==='tarot'?'Карта':'Руна'} ${i+1}">${back}<span class="pick-n"></span></button>`;
  let rows;
  if(kind==='tarot'){ const nRows=Math.ceil(total/11), per=Math.ceil(total/nRows); rows=Array.from({length:nRows},(_,r)=>{ const idx=Array.from({length:Math.min(per,total-r*per)},(_,k)=>r*per+k); return `<div class="fan" style="--n:${idx.length}">${idx.map((i,k)=>card(i).replace('class="fan-card"',`class="fan-card" style="--i:${k}"`)).join('')}</div>`; }).join(''); }
  else rows=`<div class="fan" style="--n:${total}">${Array.from({length:total},(_,i)=>card(i)).join('')}</div>`;
  return `<div class="picker ${kind}" id="picker"><p class="picker-q">${need===1?(kind==='tarot'?ui('card.pick','Выберите карту'):ui('rune.pick','Выберите руну')):`Выберите ${need} ${pickWord(kind,need)}`}</p><div class="fan-rows">${rows}</div></div>`;
}
/* карты в ряду ложатся внахлест ровно так, чтобы ряд поместился в ширину экрана */
function fitFans(box){
  box.querySelectorAll('.picker.tarot .fan').forEach(fan=>{ const cards=[...fan.children]; if(cards.length<2)return; const w=cards[0].getBoundingClientRect().width||46, avail=fan.clientWidth-12; const step=Math.min(w*.62,(avail-w)/(cards.length-1)); fan.style.setProperty('--ml',(step-w).toFixed(1)+'px'); });
}
function pickCards(box,kind,need,{scroll=false}={}){
  const total=kind==='tarot'?(Object.keys(CAT?.cards||{}).length||22):(Object.keys(CAT?.runes||{}).length||24);
  box.innerHTML=pickerHtml(kind,need,total); box.style.display='block';
  requestAnimationFrame(()=>{ fitFans(box); if(scroll)box.scrollIntoView({behavior:'smooth',block:'center'}); });
  return new Promise((res)=>{ PICK={need,chosen:[],res}; });
}
function pickerTap(i){
  if(!PICK)return; i=+i;
  const el=document.querySelector(`#picker .fan-card[data-a0="${i}"]`); if(!el||PICK.chosen.includes(i))return;
  PICK.chosen.push(i); el.classList.add('on'); el.querySelector('.pick-n').textContent=PICK.need>1?PICK.chosen.length:''; hap();
  if(PICK.chosen.length>=PICK.need){ const p=PICK; PICK=null; $('picker')?.classList.add('done'); setTimeout(()=>p.res(p.chosen),480); }
}
/* карта дня: пока не открыта — веер вместо одной рубашки; выбранная становится картой дня и переворачивается */
async function paintCardPick(){
  const pick=$('t-pick'), card=$('t-card'); if(!pick||!card||S.preview)return;
  if(S.flipped){ pick.hidden=true; pick.innerHTML=''; card.hidden=false; return; }
  card.hidden=true; pick.hidden=false;
  await loadCatalog().catch(()=>{});
  await pickCards(pick,'tarot',1);
  if(S.flipped||wgOpen!=='card')return;
  pick.hidden=true; pick.innerHTML=''; card.hidden=false;
  await openCard();
  if(!S.flipped&&wgOpen==='card')paintCardPick();   /* не получилось — веер снова */
}
function paintCard(){
  const pub = S.day && S.day.card;
  const c = pub ? (cardBy(pub.slug) || pub) : null;
  $('c-face').innerHTML = c ? `<img src="${esc(c.image)}" alt="${esc(c.name)}">` : '';
  $('t-after').innerHTML = c ? cardDayHtml(c, S.day.date, false) : '';
  paintCardTile(); if (c) paintThoughts();
}
function paintCardTile(){
  const opened = !!(S.day && S.day.card && (S.flipped || S.day.cardOpened));
  const e = $('t-cardsub'); if (e && S.day) e.textContent = opened ? S.day.card.name : 'Одна карта на день';
  /* миниатюра в строке: рубашка, пока карту не открыли; после — ее лицо */
  const th = $('t-cardthumb'); if (!th || !S.day) return;
  const face = S.day.card && (S.flipped || S.day.cardOpened) ? (cardBy(S.day.card.slug) || S.day.card).image : '';
  const want = face ? face : '/app/assets/brand/card-back.svg?v=1';
  if (th.getAttribute('src') !== want) th.src = want;
}
function showFlipped(){
  S.flipped = true;
  $('t-card').classList.add('flip'); $('t-card').classList.remove('glow');
  paintCardTile();
}
function flipCard(){ if (!S.flipped) openCard(); }
const preload = (src) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = src; setTimeout(res, 2500); });
/* Карта тянется на сервере случайно — один раз в день — и сразу попадает в историю. */
async function openCard(){
  if (S.flipped || S.opening) return;
  S.opening = true;
  try{
    const [r] = await Promise.all([api('/card', { method: 'POST' }), loadCatalog().catch(() => null)]);
    S.day.card = r.card;
    if (r.card && r.card.image) await preload(r.card.image);
    paintCard(); hap('ok');
    showFlipped(); paintThoughts();
    setTimeout(() => { $('t-after').style.display = 'block'; $('t-after').classList.add('rise'); preparePending(); }, 500);
  }catch(e){ toast('Не получилось открыть карту'); }
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
  const inner = (it) => kind === 'tarot' ? `<img class="thumb" src="${esc(it.image)}" alt="">` : `<span class="glyph">${glyphSvg(it.path)}</span>`;
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
        ${r.image ? `<img class="stone" src="${esc(r.image)}" alt="">` : `<div class="glyph lg">${glyphSvg(r.path)}</div>`}
        <div class="title-gold">${esc(r.name)}</div>
        ${r.keyword ? `<div class="kw">${esc(r.keyword)}</div>` : ''}
        ${r.motto ? `<p class="mt-2 italic">${esc(r.motto)}</p>` : ''}
        <p class="mt-3 strong">${esc(r.answer || '')}</p>
        ${thoughtHtml(p.q ? 'rune' : 'dayrune', r.slug, r.name, p.q || '', p.entry || 0, p.day)}
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
      ${thoughtHtml('runes', p.layout || 'three', `${L.title}: ${runes.map(r => r.name).join(' · ')}`, p.q || '', p.entry || 0, p.day)}
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
        return `<div class="card pos" id="${id}-p${i}">${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="">` : ''}<div class="grow">${posHead(i, P)}
          <b>${esc(c.name)}</b>${c.keys ? `<div class="kw mt-1">${esc(keysLine(c.keys))}</div>` : ''}
          ${sp[0] ? `<p class="mt-2">${esc(sp[0])}</p>` : ''}
          ${moreBlock((sp.length > 1 ? paras(sp.slice(1)) : '') + sectionsHtml(c, ['advice'], CARD_SEC), 'Подробнее')}
        </div></div>`; }).join('')}</div>
      ${thoughtHtml('spread', p.layout || 'three', `${L.title}: ${cards.map(c => c.name).join(' · ')}`, p.q || '', p.entry || 0, p.day)}
      ${actionsHtml(id)}</div>`;
}

/* ── Да / Нет ── */
function yesnoHtml(p){
  const id = regRes({ type: 'yesno', title: p.title, body: p.body, q: p.q, day: p.day });
  return `<div class="card rise center">${qLine(p.q)}<div class="big">${esc(p.title)}</div><p class="mt-3">${esc(p.body)}</p>${actionsHtml(id)}</div>` +
    (p.memory ? `<div class="card rise memory" style="--i:1"><span class="eyebrow mb-2">Мы помним ваш прошлый вопрос</span><p>Раньше на похожий вопрос ответ был <b class="strong">«${esc(p.memory.title)}»</b>, сегодня — <b class="strong">«${esc(p.title)}»</b>. ${esc(ui('ask.memory','Что изменилось с тех пор — знаете только вы: это повод вернуться к вопросу и к своим обстоятельствам.'))}</p></div>` : '');   /* без выдуманных причин (аудит v98, F19) */
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
function paintHint(){ $('a-hint').textContent = ''; }   /* лимитов нет — и говорить о них не нужно (решение владелицы) */
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
  if (mode === 'spread' || mode === 'rune') {   /* сначала человек выбирает рубашки, потом сервер тянет */
    const L = layout || (mode === 'spread' ? 'three' : 'one'), need = (CELLS[L] || []).length || 1;
    await pickCards(out, mode === 'spread' ? 'tarot' : 'rune', need, { scroll: true });
    const go = $('a-go'); if (go && go.disabled) go.textContent = 'Смотрим…';
  }
  if (mode === 'spread') {
    const L = layout || 'three';
    const r = await api('/spread', { method: 'POST', body: JSON.stringify({ question: q, layout: L }) });
    out.innerHTML = spreadHtml({ q, layout: r.layout, cards: r.cards.map(c => c.slug), live: r.cards, day: S.day.date, entry: r.entry || 0 });
    paintThoughts();
  } else {
    const L = mode === 'rune' ? (layout || 'one') : '';
    const r = await api('/ask', { method: 'POST', body: JSON.stringify({ question: q, kind: mode, layout: L }) });
    out.innerHTML = r.kind === 'rune' ? runesHtml({ q, layout: r.layout, runes: r.runes.map(x => x.slug), live: r.runes, day: S.day.date, entry: r.entry || 0 })
      : yesnoHtml({ q, title: r.title, body: r.body, day: S.day.date, memory: r.memory });
    if (r.kind === 'rune') paintThoughts();
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
    box.innerHTML='<p class="msg err">История не загрузилась. <button data-on="click:loadEntries" type="button" class="btn ghost sm">Повторить</button></p>';
  }
}
function toggleEntry(n){
  const it = $('he-' + n), body = $('hb-' + n); if (!it) return;
  const open = !it.classList.contains('on'); it.classList.toggle('on', open); it.querySelector('.histhead').setAttribute('aria-expanded',open); hap();
  if (open && !body.innerHTML) { body.innerHTML = entryHtml(S.entries[n]); preparePending(); paintThoughts(S.entries[n].day); }   /* результат из истории помнит свою мысль */
}
function entryHtml(i){
  const d = i.data || {};
  if (i.kind === 'card' && d.card) return cardDayHtml(cardBy(d.card) || { name: i.title, keys: i.body, sections: {} }, i.day, true);
  if (i.kind === 'yesno') return yesnoHtml({ q: i.question, title: i.title, body: i.body, day: i.day });
  if ((i.kind === 'rune' || i.kind === 'runes' || i.kind === 'dayrune') && d.runes) return runesHtml({ q: i.question, layout: d.layout || 'one', runes: d.runes, day: i.day, entry: i.kind === 'dayrune' ? 0 : i.id });
  if (i.kind === 'spread' && d.cards) return spreadHtml({ q: i.question, layout: d.layout || 'three', cards: d.cards, day: i.day, entry: i.id });
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
    await pcImage(ctx, c.image, 180, 130, 720, 1350, 30);
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
    await pcCover(ctx, i.image, 70);
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
        if (across) { ctx.save(); ctx.translate(x + cw / 2, y + ch / 2); ctx.rotate(Math.PI / 2); ctx.globalAlpha = .96; await pcImage(ctx, it.image, -cw / 2, -ch / 2, cw, ch, 12); ctx.restore(); }
        else await pcImage(ctx, it.image, x, y, cw, ch, 14);
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
/* Открытка собирается заранее — чтобы по нажатию «Поделиться» системное меню открылось сразу, без пауз. */
function preparePostcard(id){
  const p = RES[id]; if (!p || p.ready) return;
  p.ready = drawPostcard(p).then(toBlob).then(b => (p.blob = b)).catch(() => null);
}
function showPostcard(src){ $('pc-img').src = src; $('pc').classList.add('on'); }
function hidePostcard(){ $('pc').classList.remove('on'); $('pc-img').removeAttribute('src'); $('pc-hint').innerHTML = 'Зажмите картинку и выберите «Сохранить в Фото»'; }

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
    <div id="ln-art"><p class="hint">Загружаем главу справочника…</p></div>${actionsHtml(id)}
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
  try{await savePreferences({topics});track('topics_set',topics.join(','));hap();}
  catch{toast(ERR_SAVE);return;}
  paintLunarArticle();
}
async function setTopicsAll(on){
  try{await savePreferences({topicsAll:!!on});track('topics_all',on?'on':'off');}
  catch{toast(ERR_SAVE);return;}
  XP.topicsShown=true;paintLunarArticle();
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
      {name:'lunario_open',description:'Открыть раздел или инструмент Лунарио: home, ask, history, about, account; или виджет card, mood, lunar, sky, natal, year, compat.',
        inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']},
        execute:async({target})=>{const t=String(target||'');if(['home','ask','history','about','account'].includes(t)){go(t);return {ok:true,view:t};}if(FEATURES[t]){openWidget(t);return {ok:true,widget:t};}return {ok:false,error:'unknown target'};}}
    ]});
  }catch(e){}
}
/* Глава дня: иллюстрация, номер и тема, вступление сразу, разделы с подзаголовками — под «Читать полностью». */
function lunarDayHtml(d, today, primary=false){
  const secs = d.sections && d.sections.length ? d.sections : [{ key: 'symbol', title: '', blocks: d.blocks }];
  const all = topicsAll(), chosen = new Set(topicsChosen());
  const shown = secs.filter(s => all || chosen.has(s.key)), hidden = secs.filter(s => !all && !chosen.has(s.key));
  const secHtml = (s) => (s.title ? `<h3 class="ln-sec">${esc(s.title)}</h3>` : '') + blocksHtml(s.blocks);
  const hiddenHtml = hidden.length ? `<div class="ln-hidden">${hidden.map(s => `<details data-on="toggle:trackExpand-this-a0" data-a0="${s.key}"><summary>${esc(s.title || 'Символ и тема')}</summary>${blocksHtml(s.blocks)}</details>`).join('')}</div>` : '';
  return `<div class="item rise yr-art">
    <img class="yr-img" src="${d.image}" width="1080" height="1080" alt="${d.n} лунный день · ${esc(d.symbol || d.theme)}">
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
  box.innerHTML = `<div class="card center"><span class="eyebrow">${ui('card.today','Сегодня')}</span>
      <div class="title-gold mt-2">${esc(s.moon.phase)} ${esc(s.moon.signIn)}</div>
      <p class="mt-1">Луна освещена на ${s.moon.illumination}% · ${s.moon.waxing ? 'растет' : 'убывает'} · Солнце ${esc(s.sun.signIn)}</p>
      <p class="t2">${s.retro.length ? s.retro.map(r => `${r.symbol} ${esc(r.name)} — ${r.adj}`).join(' · ') : 'Ретроградных планет сейчас нет'}</p>
    </div>
    ${s.today.length ? `<div class="list mt-3">${s.today.map(e => ev(e, 'now')).join('')}</div>` : ''}
    ${s.retro.length ? `<div class="card mt-3">${s.retro.map(r => `<h3>${r.symbol} ${esc(r.name)} ${r.adj}</h3><p>${esc(r.note)}</p>`).join('')}</div>` : ''}
    ${s.aspects.length ? `<div class="card mt-3"><h3>Точные аспекты сегодня</h3>${s.aspects.map(a => `<p>${a.aSym} ${esc(a.a)} ${a.symbol} ${a.bSym} ${esc(a.b)} <small class="faint">· ${esc(a.name.toLowerCase())}, орб ${a.orb}°</small></p>`).join('')}</div>` : ''}
    <span class="eyebrow mt-4">Ближайшие недели</span>
    <div class="list mt-2">${s.upcoming.map(e => ev(e)).join('')}</div>
    ${actionsHtml(id)}
    <p class="hint mt-3 center">Фазы и планеты рассчитаны астрономически. Затмения — по положению Луны у узлов, без учета видимости из вашего города.</p>`;
  paintRem('sky'); preparePending();
}

/* ══════════ Поделиться: любой результат — открытка вместе с текстом ══════════ */
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
/* Одно действие на результат (решение владелицы 20.09: «Скачать на телефон» и «Поделиться» — одно и то же меню). Открытка 9:16 уходит
   в системное меню вместе с текстом, где система умеет делиться файлами (телефон, оболочка App Store); иначе — текст; на компьютере — в буфер обмена */
async function shareRes(id){
  const p = RES[id]; if (!p) return;
  const t = shareResText(p); track('share_card', p.type);
  if (!p.blob) { preparePostcard(id); await p.ready; }
  if (p.blob) {
    const name = ['lunario', p.type, String(p.day || p.stamp || '').replace(/-/g, '')].filter(Boolean).join('-') + '.png';
    if (IOS_SHELL) { const du = await blobToDataUrl(p.blob); if (nativePost({ type: 'shareImage', png: du.split(',')[1], name, text: t })) return; }
    const file = new File([p.blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Лунарио', text: t }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
  }
  if (IOS_SHELL && nativePost({ type: 'share', text: t })) return;
  if (navigator.share) { try { await navigator.share({title:'Лунарио',text:t}); } catch(e) { if(e.name!=='AbortError')toast('Не получилось открыть «Поделиться»'); } }
  else { try { await navigator.clipboard.writeText(t); toast('Скопировано — можно поделиться'); } catch(e) { toast('Не получилось скопировать — разрешите доступ к буферу обмена'); } }
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
    if (S.day && S.day.affirmation) drawText(ctx, '«' + unperiod(S.day.affirmation) + '»', 540, y + 70, { size: 34, italic: true, color: '#ded8ee', maxW: 860, lh: 1.45 });
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
    if (l.image && await pcCover(ctx, l.image, 70)) {   /* иллюстрация дня — как у личного года; под ней номер, название, тема и рекомендация */
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

/* ══════════ «Ответить себе на вопрос»: тема или свой вопрос своими словами, инструмент ответа выбирается тут же ══════════ */
const HUB_TOPICS=[['Отношения','Что мне сейчас важно в отношениях?'],['Работа и деньги','Что мне важно понять о работе или деньгах?'],['Решение','Какое решение мне сейчас подходит?'],['Тревога','Что стоит за моей тревогой сейчас?'],['Отношение к себе','Что мне сейчас важно услышать о себе?'],['Другое','Что мне важно понять сейчас?']];
const HUB_OPTS=[['rune','rune','Руна','one'],['runes3','rune','Три руны','three'],['spread','tarot','Три карты','three'],['fork','tarot','Выбор','fork']];
const hubDraft={text:'',topic:null,kind:'rune',touched:false};
const hubReady=(q)=>q.length>=10&&/\s/.test(q);   /* тот же порог, что на сервере: ответ приходит на конкретный вопрос, а не на слово */
function renderHub(){
  const w=$('t-worry');if(!w)return;
  if(!hubDraft.touched&&S.memory?.favorite)hubDraft.kind=S.memory.favorite;   /* любимый способ уже выбран — приложение знает, как человеку удобно (memory.mjs) */
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
function hubMethod(kind){hubDraft.kind=kind;hubDraft.touched=true;document.querySelectorAll('#hub-opts .chip').forEach(b=>{const on=b.dataset.kind===kind;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});}
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
