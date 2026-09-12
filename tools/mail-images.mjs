/* Картинки для письма с кодом входа (backend/mailer.mjs → loginMail):
   шапка «луна + Лунарио» и полоска звёздной пыли под карточкой.
   Веб-шрифты почта режет, поэтому wordmark Comfortaa Light — картинкой.
   Рендер через headless Chrome на прозрачном фоне в 2x, небо детерминировано (свой PRNG).

   Запуск:  node tools/mail-images.mjs
   Результат: site/assets/mail/header.png (880×420), site/assets/mail/stars.png (880×112).
   После замены картинок поднять ?v= в ссылках mailer.mjs — почтовые клиенты кэшируют. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'site', 'assets', 'fonts');
const BRAND = join(ROOT, 'site', 'assets', 'brand');
const OUT = join(ROOT, 'site', 'assets', 'mail');
const TMP = join(tmpdir(), 'lunario-mail-images');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

/* file:// в Chrome режет @font-face с диска — шрифты вшиваем base64 */
const b64 = (p) => readFileSync(p).toString('base64');
const fontCss = `
@font-face{font-family:'Comfortaa';font-style:normal;font-weight:300 700;
  src:url(data:font/woff2;base64,${b64(join(FONTS, 'comfortaa-300-700-cyrillic.woff2'))}) format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Comfortaa';font-style:normal;font-weight:300 700;
  src:url(data:font/woff2;base64,${b64(join(FONTS, 'comfortaa-300-700-latin.woff2'))}) format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
`;

/* mulberry32 — одно и то же небо при каждом рендере */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* звёздная пыль как на обложке: rgb(245,240,224), r .35–.95, альфа .14–.44; редкие яркие — с ореолом */
function stars({ W, H, n, seed, avoid = [], bright = 0, fade = false }) {
  const r = rng(seed);
  const out = [];
  const blocked = (x, y) => avoid.some(b => x > b[0] && x < b[2] && y > b[1] && y < b[3]);
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const x = r() * W, y = r() * H;
    if (blocked(x, y)) continue;
    let a = 0.14 + r() * 0.30;
    if (fade) { const k = Math.min(1, Math.min(x, W - x) / (W * 0.22)); a *= 0.35 + 0.65 * k; }  /* к краям гаснет */
    const d = (0.35 + r() * 0.6) * 2;
    out.push(`<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${d.toFixed(2)}px;height:${d.toFixed(2)}px;opacity:${a.toFixed(3)}"></i>`);
  }
  for (let i = 0; i < bright; i++) {
    let x, y, tries = 0;
    do { x = r() * W; y = r() * H; } while (blocked(x, y) && tries++ < 200);
    const a = 0.55 + r() * 0.35;
    r();  /* сохраняем последовательность PRNG */
    out.push(`<b style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;opacity:${a.toFixed(3)}"></b>`);
  }
  return out.join('');
}

const baseCss = `
html,body{margin:0;padding:0;background:transparent}
i,b{position:absolute;border-radius:50%;transform:translate(-50%,-50%);display:block}
i{background:rgb(245,240,224)}
b{width:6px;height:6px;background:radial-gradient(circle,#fffcf4 0%,rgba(240,228,196,.55) 35%,rgba(232,206,150,0) 70%)}
b::after{content:"";position:absolute;left:50%;top:50%;width:2.2px;height:2.2px;border-radius:50%;
  background:#fffdf7;transform:translate(-50%,-50%)}
`;

function render(name, W, H, body, extraCss = '') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}${baseCss}${extraCss}
.wrap{position:relative;width:${W}px;height:${H}px;overflow:hidden}
</style></head><body><div class="wrap">${body}</div></body></html>`;
  const src = join(TMP, `${name}.html`);
  writeFileSync(src, html);
  const dst = join(OUT, `${name}.png`);
  const res = spawnSync(CHROME, [
    '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=2',
    '--default-background-color=00000000', `--window-size=${W},${H}`,
    `--screenshot=${dst}`, `file://${src}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) throw new Error(`chrome: ${res.stderr}`);
  console.log(`${dst} ← ${W}×${H} @2x`);
}

/* ---------- шапка 440×210: луна из бренд-кита + «Лунарио» Comfortaa Light ---------- */
{
  const W = 440, H = 210;
  const moon = readFileSync(join(BRAND, 'logo-mark.svg'), 'utf8').replace(/<svg /, '<svg width="104" height="104" ');
  render('header', W, H,
    stars({ W, H, n: 64, seed: 20260912, bright: 3, avoid: [[150, 6, 290, 126], [110, 124, 330, 184]] }) +
    `<div class="mark">${moon}</div><h1 class="wordmark">Лунарио</h1>`,
    `.mark{position:absolute;left:50%;top:14px;transform:translateX(calc(-50% + 6px));width:104px;height:104px;line-height:0;
       filter:drop-shadow(0 6px 36px rgba(217,184,104,.40))}
     .mark svg{display:block}
     .wordmark{position:absolute;left:0;right:0;top:124px;margin:0;text-align:center;
       font-family:'Comfortaa',sans-serif;font-weight:300;font-size:42px;line-height:1.14;letter-spacing:.01em;color:#f5f2ea}`);
}

/* ---------- полоска пыли 440×56 под карточкой ---------- */
{
  const W = 440, H = 56;
  render('stars', W, H, stars({ W, H, n: 34, seed: 777, bright: 1, fade: true }));
}

rmSync(TMP, { recursive: true, force: true });
