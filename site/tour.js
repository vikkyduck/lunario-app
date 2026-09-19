/* Подсказки по приложению — экскурсия по живому экрану (решение владелицы 18.09: «как в Клабс», но по нажатию, не сама).
   Каждый шаг подсвечивает элемент кольцом и ставит рядом карточку «N / 8 · текст · Пропустить · Далее».
   Короткий тур (три вкладки) — со строки «Подсказки» на «Сегодня», полный — из Аккаунта. Что уже видели — preferences.tour и localStorage. */
const TOUR_V = 2;
/* Полный тур — Аккаунт → «Подсказки по приложению». Короткий («где что», три вкладки) — строка на «Сегодня». */
const TOUR_STEPS = [
  { text: 'Лунарио — три минуты в день, чтобы замечать, что влияет на ваше состояние, без длинных дневников. Покажем, где что находится.' },
  { target: '#h-acct', text: 'Аккаунт. Здесь настраивается ваш ежедневный ритм: три уведомления — утром настрой дня, вечером «запомнить день», раз в неделю история про вас. Время выбираете сами.' },
  { target: '#v-home .home-intro', text: 'Утром приходит уведомление с настроем дня — фразой по теме дня. Открываете — и он здесь: можно сохранить открыткой или отправить кому-то.' },
  { target: '#morning-picker', text: 'Здесь вы выбираете, что хотите видеть каждое утро в уведомлении и на этом экране: карту дня, руну, планеты, Луну, вопрос дня. Можно все.' },
  { target: '#home-sky', text: 'Сюда попадает то, что вы выбрали. Каждое утро — только это, ничего лишнего.' },
  { target: '.app-nav [data-nav=history]', short: true, text: 'Дневник. Вечером придет уведомление: записать мысли дня, что было важным, кого поблагодарить, отметить настроение. Заметки хранятся здесь по дням, а раз в неделю из них собирается «Моя неделя» — история про вас.' },
  { target: '.app-nav [data-nav=ask]', short: true, text: 'Свериться с собой. Помимо ритма — инструменты на любой вопрос: разобрать его словами, спросить «Да / Нет», разложить руны или Таро. Ответы сохраняются.' },
  { target: '.app-nav [data-nav=about]', short: true, text: 'Обо мне. Ваша папка о вас: натальная карта, личный год, нумерология, совместимость, тесты. Здесь копится все, что вы о себе узнали, — и со временем пополняется.' },
];
const Tour = { i: -1, root: null, timer: 0, steps: TOUR_STEPS };

const tourKey = () => 'lun_tour_' + (S.user?.id || '');
function tourSeen(){ try { return Number(localStorage.getItem(tourKey())) >= TOUR_V || Number(XP.prefs?.tour) >= TOUR_V; } catch { return Number(XP.prefs?.tour) >= TOUR_V; } }
/* Строка «Подсказки» на «Сегодня» — пока короткий тур не смотрели; сам по себе тур не запускается */
function paintTourRow(){
  const box = $('home-tour'); if (!box) return;
  const due = !!S.user && !tourSeen() && !(S.daysTotal >= 1); box.hidden = !due;   /* показывается до первого записанного дня — один раз, не постоянно (обзор 19.09) */
  box.innerHTML = due ? `<button data-on="click:tourShort" class="later-row" id="tour-row" type="button"><span class="eyebrow">Подсказки</span><b>Как устроено приложение</b><span class="later-go">За 20 секунд →</span></button>` : '';
}
function tourMaybe(){ clearTimeout(Tour.timer); Tour.timer = setTimeout(paintTourRow, 300); }
function tourStart(manual, mode){
  if (Tour.i >= 0) return;
  Tour.steps = mode === 'short' ? TOUR_STEPS.filter((st) => st.short) : TOUR_STEPS;
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
  Tour.root.hidden = false; Tour.i = 0; track('tour_start', mode || 'full'); tourShow();
}
function tourShow(){
  const st = Tour.steps[Tour.i], n = Tour.steps.length, last = Tour.i === n - 1;
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
  if (Tour.i === Tour.steps.length - 1) { tourFinish('done'); return; }
  Tour.i++; tourShow();
}
function tourSkip(){ if (Tour.i < 0) return; tourFinish(Tour.i === Tour.steps.length - 1 ? 'done' : 'skip'); }
function tourFinish(how){
  track('tour_' + how, String(Tour.i + 1)); Tour.i = -1; Tour.el = null; if (Tour.root) Tour.root.hidden = true;
  try { localStorage.setItem(tourKey(), String(TOUR_V)); } catch {}
  if (!(Number(XP.prefs?.tour) >= TOUR_V)) savePreferences({ ...XP.prefs, tour: TOUR_V }).catch(() => {});
  paintTourRow();
}
function tourKeys(e){
  if (Tour.i < 0) return;
  if (e.key === 'Escape') { e.preventDefault(); tourSkip(); }
  else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('.tour-skip'))) { e.preventDefault(); tourNext(); }
}
