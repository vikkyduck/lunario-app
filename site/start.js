/* Лунарио — старт приложения: подключается последним, когда все функции уже объявлены */
/* ── старт ── */
function startApp(){
  const initialPractice=new URLSearchParams(location.search).get('practice');
  paintHome(); paintToday(); go(initialPractice==='journal'?'history':'home');
  if(FEATURES[initialPractice]?.page)openPractice(initialPractice); refreshNativeAskesis();
  if (S.day.card && S.day.cardOpened) { showFlipped(); $('t-after').style.display = 'block'; }   /* карту уже открывали — она в истории; вытянутую утром еще предстоит перевернуть */
  loadCatalog().then(() => { renderMoods(); applyTools(); if (S.flipped) { paintCard(); preparePending(); } if (wgOpen === 'ask') renderLayouts(); }).catch(() => {});
  openFromUrl(location.href);   /* из уведомления приходят сразу в нужный раздел */
  { const pv=new URLSearchParams(location.search).get('preview'); if(pv) openPreview(pv); }   /* из кабинета: посмотреть запись как на экране */
}
/* Куда вести по адресу из уведомления или проверки: ?open=today|diary|week (и ключи виджетов), ?view=ask|history|about|account.
   Вызывается при старте (адрес страницы) и когда service worker присылает адрес уже открытому приложению (нажали на уведомление,
   а приложение было открыто — sw.js, notificationclick): переходим без перезагрузки */
/* Предпросмотр из кабинета «Контент»: /app/?preview=tarot:fool | runes:ansuz | lunar:8 | year:3 — показывает запись так, как ее видит человек */
async function openPreview(spec){
  const [kind,key]=String(spec).split(':'); if(!kind||!key)return;
  S.preview=true; await loadCatalog().catch(()=>{});
  if(kind==='tarot'){ const c=cardBy(key); if(!c){toast('Карта не найдена');return;} S.flipped=true; openWidget('card'); $('t-pick').hidden=true; $('t-card').hidden=false; $('t-card').classList.add('flip'); $('c-face').innerHTML=`<img src="${esc(c.image)}" alt="${esc(c.name)}">`; $('t-after').innerHTML=cardDayHtml(c,'',false); $('t-after').style.display='block'; }
  else if(kind==='runes'){ const r=runeBy(key); if(!r){toast('Руна не найдена');return;} openWidget('dayrune'); $('dayrune-box').innerHTML=runesHtml({layout:'one',runes:[r.slug],live:[r],q:'',day:''}); }
  else if(kind==='lunar'){ openWidget('lunar'); let n=0; const t=setInterval(()=>{ if((LUN&&LUN.days)||n++>30){ clearInterval(t); showLunarDay(Number(key)); } },200); }
  else if(kind==='year'){ openWidget('year'); }
}
function openFromUrl(href){
  try {
    const qs = new URL(href, location.origin).searchParams;
    const view = qs.get('view') || '';   /* ?view=ask|history|about — открыть вкладку (проверки, скриншоты) */
    if (['home', 'ask', 'history', 'about', 'account'].includes(view)) { go(view); history.replaceState(null, '', location.pathname); }
    const openKey = qs.get('open') || '', target = openTarget(openKey);
    if (target) {
      if (openKey === 'diary' || openKey === 'evening') { if (DC.forDay) { DC.forDay = null; DC.state = null; } }   /* из уведомления — к сегодняшнему дню, даже если правили вчерашний */
      go(target[0]); if (target[1]) openWidget(target[1]); history.replaceState(null, '', location.pathname); track('push_open', openKey);
      if (openKey === 'diary' || openKey === 'evening') setTimeout(() => {   /* из вечернего уведомления — к первому вопросу дня, карточка подсвечена */
        const c = $('day-card'); if (!c) return;
        scrollToTop(Math.max(0, c.getBoundingClientRect().top + scrollTopNow() - 16));
        c.classList.add('from-push'); setTimeout(() => c.classList.remove('from-push'), 1800);
      }, 300);
      if (openKey === 'today' || openKey === 'morning') loadPushNote(true).then((note) => setTimeout(() => {   /* из утреннего уведомления — к его тексту; нет текста — к своему утру */
        const target = note || $('home-sky'); if (!target || target.hidden) return;
        scrollToTop(target.getBoundingClientRect().top + scrollTopNow() - 16);   /* сразу, без плавности: страница могла еще не стать видимой */
        const t = note || target.querySelector('[data-feature]'); if (t) { t.classList.add('from-push'); setTimeout(() => t.classList.remove('from-push'), 1800); }
      }, 250));
    }
  } catch (e) {}
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'open') return;
  try { e.ports[0]?.postMessage('ok'); } catch (err) {}   /* ответ воркеру: адрес принят, перезагружать не нужно */
  if (onboarded()) openFromUrl(e.data.url);
});
(async function(){
  if('serviceWorker' in navigator) ensurePushWorker().catch(()=>{});
  let r;
  try{
    try { r = await api('/me'); try { localStorage.setItem('lun_me', JSON.stringify({ at: Date.now(), r })); } catch(e) {} }
    catch(e){   /* нет связи (а не отказ сервера) — сегодняшний пакет дня не меняется до полуночи, показываем последний сохраненный */
      const snap = (!e.status && offlineSnapshot()) || null; if (!snap) throw e;
      r = snap.r; S.offlineAt = snap.at;
    }
    S.user=r.user; S.day=r.day; S.mood=r.mood; S.memory=r.memory||{}; S.mailReady=!!r.mailReady; S.localPreview=!!r.localPreview; S.catalogV=r.catalogV||1;S.ui=r.ui||{};FEATURES=r.features||FEATURES;applyUi();initExperience(r.preferences);
    if (S.offlineAt) { const n = $('offline-note'); if (n) { n.hidden = false; n.textContent = `Без связи · показываем то, что было на ${new Date(S.offlineAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${r.day?.date !== new Date().toLocaleDateString('sv-SE') ? ', ' + fmtDay(r.day?.date) : ''}`; } }
    try{ if(r.user&&r.user.lat!=null) window.LunarioSky?.setProfile({lat:r.user.lat,lon:r.user.lon,name:r.user.city||''}); }catch(e){}
    registerWebMcp();
    try{ if(/[?&]app=1/.test(location.search)) localStorage.setItem('lun_app','1'); }catch(e){}
    if(isStaff(r.user) && !inApp() && !/[?&]preview=/.test(location.search)){ location.replace('/app/cabinet'); return; }   /* предпросмотр из кабинета — остаемся в приложении */
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
        if (inv.ok) setTimeout(()=>toast(inv.from ? `${inv.from} зовет вас в Лунарио — добро пожаловать` : 'Вы пришли по ссылке подруги — добро пожаловать'), 1200);   /* событие invite_used пишет сервер */
        history.replaceState(null,'',location.pathname);
      }
    }catch(e){ /* ссылка старая — просто открываем приложение */ }
    if(r.day && typeof r.day.moonPhase==='number') moonSetPhase(r.day.moonPhase);
    if(!r.user.onboarded){ go('hello'); track('intro_view'); if(S.mailReady) $('hello-login').style.display='block'; return; }
    startApp();
  }catch(e){ go('hello'); }
})();
