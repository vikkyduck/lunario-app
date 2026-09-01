/* Скриншоты для App Store: снимаем приложение в режиме iOS-оболочки (?shell=ios —
   без цен и кнопок оплаты, как увидит рецензент) в двух обязательных размерах
   и собираем витринные версии с подписью на фирменном фоне.

   Запуск:  node tools/store-shots-ios.mjs http://localhost:5099/app/ <токен-сессии>
   Результат: mobile/assets/appstore/{raw-69,raw-65,69,65}/NN-*.png */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334, PROF = '/tmp/lun-store-shots';
const APP = (process.argv[2] || 'http://localhost:5099/app/').replace(/\/$/, '') + '/?shell=ios';
const TOKEN = process.argv[3];
const OUT = resolve('mobile/assets/appstore');

// App Store Connect: 6.9" — 1320×2868, 6.5" — 1242×2688 (портрет)
const SIZES = [
  { key: '69', w: 440, h: 956, scale: 3 },
  { key: '65', w: 414, h: 896, scale: 3 },
];

const FRAMES = [
  { file: '01-today',   caption: 'Одна карта\nкаждое утро' },
  { file: '02-ask',     caption: 'Ответ на конкретный\nвопрос' },
  { file: '03-numbers', caption: 'Числа, рассчитанные\nпо вашей дате' },
  { file: '04-compat',  caption: 'Совместимость\nпо датам рождения' },
  { file: '05-journal', caption: 'Дневник, который\nвидите только вы' },
];

// подсказку «оставьте почту» и карточку входа прячем: у человека с привязанной
// почтой их нет, а в витрине они читаются как предупреждение
const TIDY = `const s=document.getElementById('t-save'); if(s) s.style.display='none';
  const a=document.getElementById('m-auth'); if(a && a.closest('.sec')) a.closest('.sec').style.display='none';
  await document.fonts.ready;`;
const PREP = {
  '01-today': `(async()=>{ ${TIDY}
    $('t-hello').textContent='Доброе утро, Ева';   // подпись кадра — про утро
    openCard(); await new Promise(r=>setTimeout(r,1100)); })()`,
  '02-ask': `(async()=>{ ${TIDY} go('ask'); setMode('yesno');
    $('a-q').value='Стоит ли соглашаться на новую роль?'; checkQ(); $('a-go').click();
    await new Promise(r=>setTimeout(r,1200)); window.scrollTo(0,330); })()`,
  '03-numbers': `(async()=>{ ${TIDY} go('me'); await new Promise(r=>setTimeout(r,1100));
    const n=$('m-num').closest('.sec'); n.scrollIntoView({block:'start'}); window.scrollBy(0,-14); })()`,
  '04-compat': `(async()=>{ ${TIDY} go('me'); await new Promise(r=>setTimeout(r,800));
    $('m-cdate').value='1985-07-23'; await compat(); await new Promise(r=>setTimeout(r,1200));
    $('m-cdate').closest('.sec').scrollIntoView({block:'start'}); window.scrollBy(0,-14); })()`,
  '05-journal': `(async()=>{ ${TIDY} go('me'); await new Promise(r=>setTimeout(r,1100));
    $('j-text').closest('.sec').scrollIntoView({block:'start'}); window.scrollBy(0,-14); })()`,
};

rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, '--window-size=460,1000',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});

/* Витринная рамка: подпись сверху, кадр приложения в скруглённой карточке ниже. */
const frameHTML = (pngPath, caption, W, H) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Onest;src:url('file://${resolve('site/assets/fonts/onest-400-cyrillic.woff2')}') format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:Onest;src:url('file://${resolve('site/assets/fonts/onest-400-latin.woff2')}') format('woff2');unicode-range:U+0000-00FF}
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:Onest,sans-serif;
  background:radial-gradient(circle at 50% -6%,rgba(109,91,208,.32),transparent 40%),
             radial-gradient(circle at 92% 88%,rgba(217,184,104,.15),transparent 30%),
             linear-gradient(180deg,#141126,#0b0a14 70%);}
body:before{content:"";position:fixed;inset:0;opacity:.25;
  background-image:radial-gradient(circle,rgba(245,240,224,.9) 0 3px,transparent 4.5px),radial-gradient(circle,rgba(233,199,126,.6) 0 3px,transparent 4px);
  background-size:264px 264px,411px 411px;background-position:36px 60px,210px 150px}
h1{position:relative;color:#f5f2ea;font-weight:600;font-size:${Math.round(W*0.072)}px;line-height:1.22;
  text-align:center;letter-spacing:-.01em;padding:${Math.round(H*0.045)}px 40px 0;white-space:pre-line}
.shot{position:relative;margin:${Math.round(H*0.028)}px auto 0;width:${Math.round(W*0.855)}px;
  border-radius:${Math.round(W*0.075)}px;overflow:hidden;
  border:3px solid rgba(217,184,104,.5);box-shadow:0 60px 160px rgba(11,10,20,.85),0 0 90px rgba(217,184,104,.14)}
.shot img{display:block;width:100%}
</style><h1>${caption}</h1><div class="shot"><img src="file://${pngPath}"></div>`;

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome не поднялся');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  };

  await send('Network.enable');
  const u = new URL(APP);
  if (TOKEN) await send('Network.setCookie', { name: 'lunario_app', value: TOKEN, domain: u.hostname, path: '/app', httpOnly: true });

  for (const size of SIZES) {
    const rawDir = `${OUT}/raw-${size.key}`, frameDir = `${OUT}/${size.key}`;
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(frameDir, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: size.scale, mobile: true });

    for (const f of FRAMES) {
      await send('Page.navigate', { url: APP });
      await wait(1700);
      await send('Runtime.evaluate', { expression: PREP[f.file], awaitPromise: true });
      await wait(600);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${rawDir}/${f.file}.png`, Buffer.from(data, 'base64'));
      console.log(` ✓ raw-${size.key}/${f.file}.png`);
    }

    // витринные версии: страница-рамка ровно в пиксель размера стора
    const W = size.w * size.scale, H = size.h * size.scale;
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    for (const f of FRAMES) {
      const page = `/tmp/lun-frame-${size.key}-${f.file}.html`;
      writeFileSync(page, frameHTML(`${rawDir}/${f.file}.png`, f.caption, W, H));
      await send('Page.navigate', { url: 'file://' + page });
      await wait(900);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${frameDir}/${f.file}.png`, Buffer.from(data, 'base64'));
      console.log(` ✓ ${size.key}/${f.file}.png`);
    }
  }
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
