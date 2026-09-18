/* «Как установить Лунарио на телефон» — один текст на два вида: страница /app/install и PDF /app/install.pdf.
   Лунарио — веб-приложение (PWA): в магазинах его искать не нужно, оно ставится на экран «Домой» из браузера.
   Текст живет здесь (GUIDE), страницу собирает installPage(), PDF — install-pdf.mjs. Ссылка на страницу — из
   Аккаунта («Установить на телефон») и с подсказки про уведомления на iPhone. Без буквы «ё», как во всем приложении. */

export const APP_URL = 'lunario.online/app';

export const GUIDE = {
  eyebrow: 'Установка',
  title: 'Как установить Лунарио на телефон',
  lead: 'Лунарио — веб-приложение: его не нужно искать в App Store или Google Play. Откройте lunario.online/app в браузере телефона и добавьте на экран «Домой» — появится иконка, как у обычного приложения, оно будет открываться на весь экран, а напоминания станут приходить как уведомления. Займет меньше минуты.',
  platforms: [
    { key: 'ios', name: 'iPhone', browser: 'Safari',
      steps: [
        { title: 'Откройте lunario.online/app в Safari', text: 'Именно в Safari. Если ссылка открылась внутри Telegram, Instagram или другого приложения, нажмите три точки или значок компаса и выберите «Открыть в Safari».' },
        { title: 'Нажмите «Поделиться»', text: 'Квадрат со стрелкой вверх на нижней панели Safari (на iPad — в правом верхнем углу).' },
        { title: 'Выберите «На экран “Домой”»', text: 'Пролистайте список действий вниз — пункт с иконкой «плюс в квадрате».' },
        { title: 'Нажмите «Добавить»', text: 'В правом верхнем углу. Название «Лунарио» уже подставлено.' },
        { title: 'Откройте Лунарио с экрана «Домой»', text: 'Иконка с Луной появится рядом с другими приложениями. Записи и аккаунт — те же, что в браузере.' },
      ],
      note: 'Уведомления на iPhone приходят только в приложение с экрана «Домой» (iOS 16.4 и новее). После установки откройте его оттуда, зайдите в Аккаунт → Уведомления и включите — iPhone спросит разрешение.' },
    { key: 'android', name: 'Android', browser: 'Chrome',
      steps: [
        { title: 'Откройте lunario.online/app в Chrome', text: 'Если ссылка открылась внутри другого приложения, нажмите три точки и выберите «Открыть в Chrome».' },
        { title: 'Нажмите «Установить приложение»', text: 'Chrome сам предложит установку плашкой внизу экрана. Если плашки нет — нажмите три точки в правом верхнем углу и выберите «Установить приложение» или «Добавить на главный экран».' },
        { title: 'Подтвердите «Установить»', text: 'Иконка с Луной появится на главном экране и в списке приложений.' },
        { title: 'Откройте Лунарио с главного экрана', text: 'Записи и аккаунт — те же, что в браузере. В самом Лунарио есть та же кнопка: Аккаунт → «Установить на телефон».' },
      ],
      note: 'В Samsung Internet: меню (три полоски) → «Добавить страницу на» → «Главный экран». В Яндекс Браузере: три точки → «Добавить на главный экран».' },
  ],
  after: { title: 'Что изменится после установки', items: [
    'Иконка с Луной на экране телефона: открывается в одно касание, без адресной строки, на весь экран.',
    'Уведомления: утренний настрой, вечернее «Запомнить этот день» и итоги недели — время выбираете сами в Аккаунт → Уведомления.',
    'Все, что уже записано, остается: это тот же аккаунт. Вход по почте открывает записи и на других устройствах.',
    'Открывается и без сети: оболочка приложения хранится на телефоне, записи подгрузятся, когда связь появится.',
  ] },
  faq: { title: 'Если что-то не получается', items: [
    { q: 'На iPhone нет пункта «На экран “Домой”»', a: 'Страница открыта не в Safari. Скопируйте адрес lunario.online/app, откройте Safari и вставьте его в адресную строку.' },
    { q: 'В Chrome нет «Установить приложение»', a: 'Обновите Chrome в Google Play или выберите «Добавить на главный экран» — результат тот же.' },
    { q: 'Установила, а уведомления не приходят', a: 'Откройте Лунарио с иконки на экране, а не из браузера, зайдите в Аккаунт → Уведомления и нажмите «Подключить это устройство». Проверьте, что в настройках телефона уведомления для Лунарио разрешены.' },
    { q: 'Как удалить', a: 'Как обычное приложение: удерживайте иконку и выберите «Удалить». Записи остаются в аккаунте — при следующей установке все на месте.' },
  ] },
  support: 'Не получилось — напишите нам: Аккаунт → Чат поддержки или hello@lunario.online. Ответим и поможем поставить.',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Страница ночная всегда, как экраны до входа: ее открывают из браузера, где темы приложения еще нет.
   Скрипт только внешний (install.js) — CSP страниц без 'unsafe-inline'; без него видны обе платформы подряд. */
const CSS = `
@font-face{font-family:'Onest';font-style:normal;font-weight:100 900;font-display:swap;src:url('/app/assets/fonts/onest-400-cyrillic.woff2') format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Onest';font-style:normal;font-weight:100 900;font-display:swap;src:url('/app/assets/fonts/onest-400-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--bg:#0b0a14;--text:#f5f2ea;--text-2:#ded8ee;--muted:#cdc6e2;--faint:#8f87ad;--gold:#d9b868;--gold-2:#f0d79a;--line:rgba(245,242,234,.12);--selected:rgba(217,184,104,.16);
  --glass-bg:linear-gradient(135deg,rgba(245,242,234,.10),rgba(245,242,234,.04) 45%,rgba(245,242,234,.07)),linear-gradient(rgba(20,17,38,.78),rgba(20,17,38,.78));
  --glass-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(0,0,0,.18),0 12px 34px -14px rgba(0,0,0,.55);
  --control:linear-gradient(135deg,#f0d79a 0%,#d9b868 55%,#b98f3e 100%);--r-xl:24px;--r-pill:999px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg)}
body{font-family:Onest,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:linear-gradient(180deg,#141126 0%,#0b0a14 70%);background-attachment:fixed;min-height:100dvh;font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
.bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
.orb-1{width:56vw;height:56vw;max-width:760px;max-height:760px;top:-22vw;left:50%;transform:translateX(-50%);background:radial-gradient(circle,#6d5bd0 0%,transparent 65%)}
.orb-2{width:34vw;height:34vw;max-width:460px;max-height:460px;bottom:-12vw;right:-8vw;background:radial-gradient(circle,rgba(217,184,104,.5) 0%,transparent 65%)}
.wrap{position:relative;z-index:1;max-width:640px;margin:0 auto;padding:calc(20px + env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom))}
a{color:var(--gold-2);text-underline-offset:3px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px}
.top a{text-decoration:none;font-size:15px;color:var(--gold-2)}
.hero{margin-top:8px}
.hero img{width:min(300px,70%);height:auto;display:block;margin:0 auto -18px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:700;color:var(--gold);display:block}
h1{font-size:30px;line-height:1.2;letter-spacing:-.01em;margin:10px 0 14px;font-weight:600}
h2{font-size:22px;line-height:1.3;margin:0 0 6px;font-weight:600}
.lead{color:var(--muted);margin:0 0 22px;max-width:36em;text-wrap:pretty}
.actions{display:grid;gap:10px;margin:0 0 28px}
.btn{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:58px;padding:0 20px;border:0;border-radius:var(--r-pill);background:var(--control);color:#1d1738;font:inherit;font-weight:600;font-size:17px;text-decoration:none;cursor:pointer;box-shadow:0 10px 26px -14px rgba(217,184,104,.6)}
.btn.ghost{background:rgba(255,255,255,.06);box-shadow:none;border:1px solid var(--line);color:var(--text)}
.btn:active{transform:scale(.985)}
.btn svg{width:20px;height:20px;flex:0 0 20px}
.chips{display:flex;gap:8px;margin:0 0 18px}
.chip{flex:1 1 0;min-height:48px;padding:0 16px;border-radius:var(--r-pill);border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);font:inherit;font-size:16px;font-weight:500;cursor:pointer}
.chip[aria-pressed=true]{color:var(--gold-2);border-color:var(--gold);background:var(--selected)}
html:not([data-os]) .chips{display:none}
html[data-os=ios] [data-os=android],html[data-os=android] [data-os=ios]{display:none}
.card{background:var(--glass-bg);border:1px solid var(--line);border-radius:var(--r-xl);padding:22px 20px;box-shadow:var(--glass-shadow);margin:0 0 14px}
.card .eyebrow{margin-bottom:4px}
.steps{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:16px}
.steps li{display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:14px;align-items:start}
.steps i{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--selected);border:1px solid rgba(217,184,104,.45);color:var(--gold-2);font-style:normal;font-weight:700;font-size:15px;margin-top:2px}
.steps b{display:block;font-weight:600;line-height:1.35;margin-bottom:3px}
.steps p{margin:0;color:var(--muted);font-size:15px;line-height:1.55}
.note{margin:18px 0 0;padding:12px 16px;border-left:2px solid var(--gold);background:rgba(217,184,104,.08);border-radius:0 14px 14px 0;color:var(--text-2);font-size:15px;line-height:1.55}
.list{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:10px}
.list li{position:relative;padding-left:18px;color:var(--text-2);font-size:16px}
.list li::before{content:'';position:absolute;left:0;top:.7em;width:6px;height:6px;border-radius:50%;background:var(--gold)}
.faq dt{font-weight:600;margin-top:14px}
.faq dt:first-child{margin-top:8px}
.faq dd{margin:4px 0 0;color:var(--muted);font-size:15px;line-height:1.55}
.icon-row{display:flex;align-items:center;gap:14px;margin:6px 0 0}
.icon-row img{width:56px;height:56px;border-radius:14px;box-shadow:0 8px 20px -10px rgba(0,0,0,.7)}
.icon-row span{color:var(--muted);font-size:15px;line-height:1.5}
.support{color:var(--muted);font-size:15px;text-align:center;margin:26px 0 0}
footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);color:var(--faint);font-size:13px;text-align:center;line-height:1.7}
footer a{color:var(--faint)}
#native-install{display:none}
html[data-can-install] #native-install{display:flex}
@media(min-width:700px){.wrap{padding-top:40px}.actions{grid-template-columns:1fr 1fr}h1{font-size:36px}}
@media(prefers-reduced-motion:no-preference){.btn,.chip{transition:transform 120ms cubic-bezier(.2,.85,.3,1),background 180ms}}
`;

const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';

const platformHtml = (p) => `
  <section class="card" data-os="${p.key}" aria-labelledby="h-${p.key}">
    <span class="eyebrow">${esc(p.browser)}</span><h2 id="h-${p.key}">${esc(p.name)}</h2>
    <ol class="steps">${p.steps.map((s, i) => `<li><i>${i + 1}</i><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div></li>`).join('')}</ol>
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
  </section>`;

/* Готовый HTML страницы; собирается один раз при первом запросе (см. server.mjs) */
export function installPage() {
  const g = GUIDE;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(g.title)} — Лунарио</title>
<meta name="description" content="Лунарио ставится на iPhone и Android прямо из браузера, без магазинов: пять шагов, PDF-памятка и ответы на частые вопросы.">
<meta property="og:type" content="article">
<meta property="og:url" content="https://lunario.online/app/install">
<meta property="og:title" content="${esc(g.title)}">
<meta property="og:description" content="Иконка на экране «Домой», полный экран и уведомления — без App Store и Google Play.">
<meta property="og:locale" content="ru_RU">
<meta property="og:image" content="https://lunario.online/app/assets/og.png?v=1">
<meta name="theme-color" content="#0b0a14">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Лунарио">
<link rel="icon" href="/app/assets/favicon.svg?v=3" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="/app/assets/apple-touch-icon.png">
<link rel="manifest" href="/app/manifest.webmanifest">
<style>${CSS}</style>
</head>
<body>
<div class="bg" aria-hidden="true"><div class="orb orb-1"></div><div class="orb orb-2"></div></div>
<main class="wrap">
  <nav class="top" aria-label="Навигация"><a href="/app/">← В приложение</a><a href="/app/install.pdf" download="lunario-ustanovka.pdf">Скачать PDF</a></nav>
  <header class="hero">
    <img src="/app/assets/mail/header.png" width="880" height="420" alt="Лунарио">
    <span class="eyebrow">${esc(g.eyebrow)}</span>
    <h1>${esc(g.title)}</h1>
    <p class="lead">${esc(g.lead)}</p>
  </header>
  <div class="actions">
    <button class="btn" id="native-install" type="button">Установить на этот телефон</button>
    <a class="btn ghost" href="/app/install.pdf" download="lunario-ustanovka.pdf">${ICON_DOWNLOAD}Скачать в PDF</a>
    <a class="btn ghost" href="/app/">Открыть Лунарио</a>
  </div>
  <div class="chips" role="group" aria-label="Телефон">${g.platforms.map((p) => `<button class="chip" type="button" data-pick="${p.key}" aria-pressed="false">${esc(p.name)}</button>`).join('')}</div>
  ${g.platforms.map(platformHtml).join('')}
  <section class="card" aria-labelledby="h-after">
    <h2 id="h-after">${esc(g.after.title)}</h2>
    <div class="icon-row"><img src="/app/assets/apple-touch-icon.png" width="180" height="180" alt="Иконка Лунарио"><span>Так выглядит иконка Лунарио на экране телефона</span></div>
    <ul class="list">${g.after.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>
  <section class="card faq" aria-labelledby="h-faq">
    <h2 id="h-faq">${esc(g.faq.title)}</h2>
    <dl>${g.faq.items.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join('')}</dl>
  </section>
  <p class="support">${esc(g.support)}</p>
  <footer>Лунарио · <a href="https://${APP_URL}/">${APP_URL}</a><br>Эта страница: lunario.online/app/install · <a href="/app/install.pdf" download="lunario-ustanovka.pdf">PDF</a></footer>
</main>
<script src="/app/install.js"></script>
</body>
</html>`;
}
