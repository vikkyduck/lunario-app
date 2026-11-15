/* Первым делом, до стилей: тема и признак оболочки iOS — иначе экран мигнет не тем цветом.
   Раньше лежало двумя инлайн-скриптами в <head>; CSP без 'unsafe-inline' их не пускает. */
try{const t=/[?&]theme=(light|dark|system)/.exec(location.search);if(t)localStorage.setItem('lun_theme',t[1]);const mode=localStorage.getItem('lun_theme')||'dark';   /* ?theme= — для проверок и скриншотов */document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}catch{}
/* Вид один — компактный (решение владелицы 17.09; «обычный» снят 19.09). Атрибут остается: на нем держатся стили app.css */
document.documentElement.dataset.skin='compact';
/* Оболочка для App Store объявляет о себе суффиксом в User-Agent и флагом,
   впрыснутым до загрузки страницы; ?shell=ios — для проверки в обычном браузере */
if (navigator.userAgent.indexOf('LunarioShell-iOS') !== -1 || window.__LUN_IOS__ || /[?&]shell=ios/.test(location.search))
  document.documentElement.className += ' ios-shell';
/* Корпус телефона на компьютере (решение владелицы 17.09, «как в Клабс»): при ширине окна от 700px приложение живет в рамке 430px (frame.css);
   на телефоне и в оболочке iOS — как есть. Строка пропала вместе с переключателем скинов в v98 — возвращена 20.09 */
try{const framed=()=>{const on=matchMedia('(min-width: 700px)').matches&&!/ios-shell/.test(document.documentElement.className);document.documentElement.classList.toggle('framed',on);};framed();matchMedia('(min-width: 700px)').addEventListener('change',framed);}catch{}
