/* Подсказки по приложению — экскурсия из восьми шагов (решение владелицы 18.09: «онбординг как в Клабс»).
   Показывается один раз на главной: после анкеты и трёх напоминаний, а тем, кто уже в приложении, — при первом открытии
   этой версии. Каждый шаг подсвечивает элемент экрана кольцом и ставит рядом карточку «N / 8 · текст · Пропустить · Далее».
   Что уже видели — в настройках аккаунта (preferences.tour) и в localStorage этого устройства. Повторить — Аккаунт → «Подсказки». */
const TOUR_V = 1;
const TOUR_STEPS = [
  { text: 'Это Лунарио. За полминуты покажем, где что находится — и как собрать свой ритм: что видеть утром и что записывать вечером.' },
  { target: '#v-home .home-intro', text: 'Каждое утро здесь — настрой дня: одна фраза по теме дня. Её можно сохранить открыткой или отправить кому-то.' },
  { target: '#morning-picker', text: 'Ритм собираете вы сами. Отметьте, что хотите видеть каждое утро: карту дня, руну, планеты, прогноз, Луну или вопрос дня. Выбранное — сверху и в утреннем уведомлении.' },
  { target: '#home-sky', text: 'Здесь — ваше утро, только выбранное. Откройте карту или руну — это отметка дня; из таких отметок складывается история о вас.' },
  { target: '.app-nav [data-nav=history]', text: 'Дневник. Вечером — «Запомнить этот день»: что произошло, что почувствовали, настроение. По воскресеньям здесь собирается «Моя неделя».' },
  { target: '.app-nav [data-nav=ask]', text: 'Свериться с собой. Когда есть вопрос — разобрать его, спросить «Да / Нет» или посмотреть прогноз дня. Ответы остаются в дневнике.' },
  { target: '.app-nav [data-nav=about]', text: 'Обо мне. Натальная карта, личный год, число рождения, совместимость — то, что известно о вас по дате рождения.' },
  { target: '#h-acct', text: 'Аккаунт. Три напоминания — утро, вечер и воскресенье — приходят сами, когда вы их включите. Здесь же уведомления, тема и фото.', last: 'Настроить напоминания', done: 'Готово' },
];
const Tour = { i: -1, root: null, timer: 0 };

const tourKey = () => 'lun_tour_' + (S.user?.id || '');
function tourSeen(){ try { return Number(localStorage.getItem(tourKey())) >= TOUR_V || Number(XP.prefs?.tour) >= TOUR_V; } catch { return Number(XP.prefs?.tour) >= TOUR_V; } }
/* Пора ли: человек в приложении, на «Сегодня», без открытой панели, экскурсию ещё не видел */
function tourDue(){
  return Tour.i < 0 && !!S.user && document.body.classList.contains('inner') && $('v-home')?.classList.contains('on')
    && !$('wg-bg')?.classList.contains('on') && !tourSeen();
}
function tourMaybe(){
  clearTimeout(Tour.timer);
  Tour.timer = setTimeout(() => { if (tourDue()) tourStart(); }, 900);   /* главная успевает нарисоваться */
}
function tourStart(manual){
  if (Tour.i >= 0) return;
  if (!$('v-home')?.classList.contains('on')) go('home');
  if (!Tour.root) {
    const root = document.createElement('div'); root.className = 'tour'; root.id = 'tour';
    root.innerHTML = '<div class="tour-scrim"></div><div class="tour-ring" hidden></div>'
      + '<div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-step" aria-describedby="tour-text">'
      + '<span class="tour-step" id="tour-step"></span><p class="tour-text" id="tour-text"></p>'
      + '<div class="tour-actions"><button data-on="click:tourSkip" class="tour-skip" type="button">Пропустить</button>'
      + '<button data-on="click:tourNext" class="tour-next" id="tour-next" type="button">Далее</button></div></div>';
    document.body.appendChild(root); Tour.root = root;
    addEventListener('resize', tourReposition); addEventListener('scroll', tourReposition, true); document.addEventListener('keydown', tourKeys);
  }
  Tour.root.hidden = false; Tour.i = 0; track('tour_start', manual ? 'manual' : 'auto'); tourShow();
}
function tourShow(){
  const st = TOUR_STEPS[Tour.i], n = TOUR_STEPS.length, last = Tour.i === n - 1;
  $('tour-step').textContent = `${Tour.i + 1} / ${n}`; $('tour-text').textContent = st.text;
  $('tour-next').textContent = last ? (st.last || 'Готово') : 'Далее';
  Tour.root.querySelector('.tour-skip').textContent = last ? (st.done || 'Готово') : 'Пропустить';
  const el = st.target ? document.querySelector(st.target) : null;
  Tour.el = el && el.offsetParent !== null ? el : null;
  if (Tour.el) Tour.el.scrollIntoView({ block: 'center', behavior: 'auto' });
  tourReposition(); $('tour-next')?.focus({ preventScroll: true });
  setTimeout(tourReposition, 80);   /* карточка получила новый текст и высоту, прокрутка улеглась */
}
/* Кольцо и карточка считаются от корпуса телефона на компьютере (fixed там отсчитывается от body), на телефоне — от окна */
function tourReposition(){
  if (Tour.i < 0 || !Tour.root) return;
  const framed = document.documentElement.classList.contains('framed');
  const base = framed ? document.body.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const ring = Tour.root.querySelector('.tour-ring'), card = Tour.root.querySelector('.tour-card'), scrim = Tour.root.querySelector('.tour-scrim');
  const cw = Math.min(base.width - 32, 400); card.style.width = cw + 'px';
  const ch = card.offsetHeight;
  if (!Tour.el) {
    ring.hidden = true; scrim.hidden = false;
    card.style.left = Math.round((base.width - cw) / 2) + 'px'; card.style.top = Math.round((base.height - ch) / 2) + 'px';
    return;
  }
  const r = Tour.el.getBoundingClientRect(), pad = 6;
  const x = r.left - base.left, y = r.top - base.top;
  ring.hidden = false; scrim.hidden = true;
  ring.style.left = Math.round(x - pad) + 'px'; ring.style.top = Math.round(y - pad) + 'px';
  ring.style.width = Math.round(r.width + pad * 2) + 'px'; ring.style.height = Math.round(r.height + pad * 2) + 'px';
  const radius = parseFloat(getComputedStyle(Tour.el).borderTopLeftRadius) || 12; ring.style.borderRadius = Math.min(radius + pad, 40) + 'px';
  const gap = 14, below = y + r.height + gap, above = y - gap - ch;
  const top = below + ch <= base.height - 16 ? below : above >= 16 ? above : Math.max(16, Math.min(base.height - ch - 16, (base.height - ch) / 2));
  const left = Math.max(16, Math.min(base.width - cw - 16, x + r.width / 2 - cw / 2));
  card.style.left = Math.round(left) + 'px'; card.style.top = Math.round(top) + 'px';
}
function tourNext(){
  if (Tour.i < 0) return; hap?.();
  const st = TOUR_STEPS[Tour.i];
  if (Tour.i === TOUR_STEPS.length - 1) { tourFinish('done'); if (st.last) openWidget('remind'); return; }
  Tour.i++; tourShow();
}
function tourSkip(){ if (Tour.i < 0) return; tourFinish(Tour.i === TOUR_STEPS.length - 1 ? 'done' : 'skip'); }
function tourFinish(how){
  track('tour_' + how, String(Tour.i + 1)); Tour.i = -1; Tour.el = null; if (Tour.root) Tour.root.hidden = true;
  try { localStorage.setItem(tourKey(), String(TOUR_V)); } catch {}
  if (Number(XP.prefs?.tour) < TOUR_V || XP.prefs?.tour === undefined) savePreferences({ ...XP.prefs, tour: TOUR_V }).catch(() => {});
}
function tourKeys(e){
  if (Tour.i < 0) return;
  if (e.key === 'Escape') { e.preventDefault(); tourSkip(); }
  else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('.tour-skip'))) { e.preventDefault(); tourNext(); }
}
