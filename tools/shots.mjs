/* Скриншоты для карточек магазинов: поднимаем Chrome, ставим куку сессии,
   ходим по экранам и снимаем. Продуктового кода не трогаем. */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333, PROF = '/tmp/cs-shots';
const APP = process.argv[2] || 'http://localhost:5099/app/';
const TOKEN = process.argv[3];
const OUT = process.argv[4] || 'mobile/assets/screenshots';
const W = 414, H = 896, SCALE = 2;                 // 828×1792 — подходит и Play, и RuStore

rmSync(PROF, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, `--window-size=${W},${H}`,
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});

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

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: true });
  await send('Network.enable');
  const u = new URL(APP);
  if (TOKEN) await send('Network.setCookie', { name: 'lunario_app', value: TOKEN, domain: u.hostname, path: '/app', httpOnly: true });

  const shot = async (file, prep) => {
    await send('Page.navigate', { url: APP });
    await wait(1600);
    if (prep) { await send('Runtime.evaluate', { expression: prep, awaitPromise: true }); await wait(1400); }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'));
    console.log(' ✓', file);
  };

  await shot('01-today.png', `openCard(); new Promise(r=>setTimeout(r,900))`);
  await shot('02-ask.png', `(async()=>{go('ask');setMode('yesno');$('a-q').value='Стоит ли менять работу сейчас?';checkQ();$('a-go').click();await new Promise(r=>setTimeout(r,1200));window.scrollTo(0,320);})()`);
  await shot('03-me.png', `(async()=>{go('me');await new Promise(r=>setTimeout(r,900));window.scrollTo(0,60);})()`);
  await shot('04-compat.png', `(async()=>{go('me');await new Promise(r=>setTimeout(r,800));$('m-cdate').value='1985-07-23';await compat();await new Promise(r=>setTimeout(r,900));document.getElementById('m-cres').scrollIntoView({block:'center'});})()`);
  await shot('05-journal.png', `(async()=>{go('me');await new Promise(r=>setTimeout(r,900));document.getElementById('m-journal').scrollIntoView({block:'center'});})()`);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
