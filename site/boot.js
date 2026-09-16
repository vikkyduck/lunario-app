/* Первым делом, до стилей: тема и признак оболочки iOS — иначе экран мигнёт не тем цветом.
   Раньше лежало двумя инлайн-скриптами в <head>; CSP без 'unsafe-inline' их не пускает. */
try{const mode=localStorage.getItem('lun_theme')||'dark';document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}catch{}
/* Оболочка для App Store объявляет о себе суффиксом в User-Agent и флагом,
   впрыснутым до загрузки страницы; ?shell=ios — для проверки в обычном браузере */
if (navigator.userAgent.indexOf('LunarioShell-iOS') !== -1 || window.__LUN_IOS__ || /[?&]shell=ios/.test(location.search))
  document.documentElement.className += ' ios-shell';
