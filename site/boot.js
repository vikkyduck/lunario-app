/* Первым делом, до стилей: тема и признак оболочки iOS — иначе экран мигнёт не тем цветом.
   Раньше лежало двумя инлайн-скриптами в <head>; CSP без 'unsafe-inline' их не пускает. */
try{const t=/[?&]theme=(light|dark|system)/.exec(location.search);if(t)localStorage.setItem('lun_theme',t[1]);const mode=localStorage.getItem('lun_theme')||'dark';   /* ?theme= — для проверок и скриншотов */document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}catch{}
/* «Компактный вид» — основной с 17.09 (решение владелицы); «Обычный» остаётся по выбору: ?skin=classic или Аккаунт → Оформление. Выбор помнится на устройстве */
/* Корпус телефона на компьютере: при ширине окна от 700px приложение живёт в рамке 430px (frame.css); на телефоне и в оболочке — как есть */
try{const framed=()=>{const on=matchMedia('(min-width: 700px)').matches&&!/ios-shell/.test(document.documentElement.className);document.documentElement.classList.toggle('framed',on);};framed();matchMedia('(min-width: 700px)').addEventListener('change',framed);}catch{}
try{const q=/[?&]skin=(compact|classic)/.exec(location.search);if(q)localStorage.setItem('lun_skin',q[1]);if(localStorage.getItem('lun_skin')!=='classic')document.documentElement.dataset.skin='compact';}catch{}
/* Оболочка для App Store объявляет о себе суффиксом в User-Agent и флагом,
   впрыснутым до загрузки страницы; ?shell=ios — для проверки в обычном браузере */
if (navigator.userAgent.indexOf('LunarioShell-iOS') !== -1 || window.__LUN_IOS__ || /[?&]shell=ios/.test(location.search))
  document.documentElement.className += ' ios-shell';
