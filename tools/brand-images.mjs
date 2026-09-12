/* Растровые иконки Лунарио из SVG дизайн-кита — одной командой, все площадки.
   Источники: site/assets/brand/app-icon.svg (ночной скруглённый квадрат), logo-mark.svg (знак без подложки)
   и ../lunario-landing/site/brand/favicon.svg (знак на квадрате 64, rx=14). SVG кита не трогаем —
   full-bleed варианты (rx=0) получаются подменой атрибута в памяти.
   Рендер через headless Chrome в 1x на прозрачном фоне (--default-background-color=00000000);
   там, где картинка целиком непрозрачна, Chrome сам пишет PNG без альфа-канала — это нужно App Store.
   favicon.ico собирается вручную: заголовок 6 байт + записи по 16 байт + PNG-вложения 16/32/48.
   После записи каждый файл декодируется (node:zlib) и проверяется: размер, альфа угла, цвет ночи.

   Запуск:  node tools/brand-images.mjs
   Результат:
     lunario-landing/site/assets + lunario-app/site/assets — favicon-16/32/48.png, apple-touch-icon.png
     lunario-landing/site + lunario-app/site               — favicon.ico
     lunario-app/site/assets                               — icon-192.png, icon-512.png, icon-maskable.png
     lunario-app/mobile/assets/icons                       — launcher-*.png, adaptive-foreground-432.png,
                                                             play-512.png, rustore-512.png, appstore-1024.png
     lunario-app/mobile/android/.../mipmap-*               — ic_launcher.png, ic_launcher_foreground.png
     lunario-app/mobile/ios/.../Assets.xcassets            — AppIcon icon-1024.png, LaunchLogo launch-logo.png
   После замены поднять ?v= в ссылках index.html / manifest.webmanifest / sw.js — кэш. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = join(ROOT, '..', 'lunario-landing');
const BRAND = join(ROOT, 'site', 'assets', 'brand');
const KIT = join(LANDING, 'site', 'brand');
const MOBILE = join(ROOT, 'mobile');
const ANDROID_RES = join(MOBILE, 'android', 'app', 'src', 'main', 'res');
const XCASSETS = join(MOBILE, 'ios', 'Lunario', 'Assets.xcassets');
const TMP = join(tmpdir(), 'lunario-brand-images');
mkdirSync(TMP, { recursive: true });

const appIcon = readFileSync(join(BRAND, 'app-icon.svg'), 'utf8');
const logoMark = readFileSync(join(BRAND, 'logo-mark.svg'), 'utf8');
const favicon = readFileSync(join(KIT, 'favicon.svg'), 'utf8');

/* full-bleed: у первого <rect> (подложка) rx → 0; сам файл кита не меняется */
const bleed = (svg) => svg.replace(/(<rect\b[^>]*?)\srx="[^"]*"/, '$1 rx="0"');

/* ---------- Chrome: svg размером size×size по центру холста W×W, фон прозрачный ----------
   PNG Chrome пишет за секунды, а сам процесс иногда живёт после этого ещё минуты — поэтому ждём
   не выхода, а готового файла (хвост IEND), и потом гасим процесс, если он не вышел сам. */
let shots = 0;
const IEND = Buffer.from('IEND\xaeB`\x82', 'latin1');
const pngComplete = (p) => { if (!existsSync(p)) return false; const b = readFileSync(p); return b.length > 8 && b.subarray(-8).equals(IEND); };
async function shot(svg, W, size = W) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
.wrap{position:relative;width:${W}px;height:${W}px;overflow:hidden}
svg{position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;transform:translate(-50%,-50%)}
</style></head><body><div class="wrap">${svg}</div></body></html>`;
  const src = join(TMP, `shot-${++shots}.html`);
  const dst = join(TMP, `shot-${shots}.png`);
  writeFileSync(src, html);
  const child = spawn(CHROME, [
    '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${W},${W}`,
    `--screenshot=${dst}`, `file://${src}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const deadline = Date.now() + 90_000;
  while (!pngComplete(dst)) {
    if (exited) throw new Error(`chrome вышел без скриншота: ${stderr}`);
    if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error(`chrome: нет скриншота за 90 с: ${stderr}`); }
    await sleep(100);
  }
  for (let i = 0; i < 20 && !exited; i++) await sleep(100);   /* даём выйти самому */
  if (!exited) child.kill('SIGTERM');
  return readFileSync(dst);
}

/* ---------- ICO: заголовок (reserved 0, type 1, count) + записи по 16 байт + PNG подряд ---------- */
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size & 255; e[1] = size & 255;      /* 256 пишется как 0 */
    e[2] = 0; e[3] = 0;                        /* палитры нет, reserved */
    e.writeUInt16LE(1, 4);                     /* planes */
    e.writeUInt16LE(32, 6);                    /* бит на пиксель */
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...entries.map(e => e.png)]);
}

/* ---------- PNG-декодер для проверки: 8 бит, без interlace (ровно то, что пишет Chrome) ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG');
  let pos = 8, w, h, depth, ctype, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`PNG depth=${depth} interlace=${interlace} — не поддерживается`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const px = (x, y) => {
    const p = out.subarray((y * w + x) * ch, (y * w + x) * ch + ch);
    return ch === 4 ? [p[0], p[1], p[2], p[3]] : ch === 3 ? [p[0], p[1], p[2], 255] : ch === 2 ? [p[0], p[0], p[0], p[1]] : [p[0], p[0], p[0], 255];
  };
  return { w, h, hasAlpha: ch === 4 || ch === 2, px };
}

/* ---------- проверка одного PNG: размер, угол, центр ----------
   transparent: угол (0,0) alpha 0; (2,2) alpha 0, когда пиксель геометрически вне скругления (от 48px);
   opaque: угол (2,2) alpha 255 и цвет ночи (тёмный, не белый); центр всегда непрозрачная луна */
function verify(png, size, mode) {
  const p = decodePng(png);
  const c0 = p.px(0, 0), c2 = p.px(2, 2), mid = p.px(p.w >> 1, p.h >> 1);
  const ok = [];
  ok.push(p.w === size && p.h === size);
  if (mode === 'transparent') {
    ok.push(c0[3] === 0);
    if (size >= 48) ok.push(c2[3] === 0);
    ok.push(p.hasAlpha);
  } else {
    ok.push(c2[3] === 255 && Math.max(c2[0], c2[1], c2[2]) < 96 && c2[2] > c2[0]);
    ok.push(!p.hasAlpha);
  }
  ok.push(mid[3] === 255 && mid[0] > 200);   /* золото луны в центре */
  return {
    pass: ok.every(Boolean),
    info: `${p.w}×${p.h} alpha:${p.hasAlpha ? 'yes' : 'no'} (0,0)=${c0.join(',')} (2,2)=${c2.join(',')} центр=${mid.join(',')}`,
  };
}

/* ---------- что рендерить ---------- */
const jobs = [];
const job = (name, png, size, mode, dests) => jobs.push({ name, png, size, mode, dests });

/* 1. favicon-16/32/48 — favicon.svg, скруглённый квадрат, прозрачные уголки */
const fav = {};
for (const s of [16, 32, 48]) {
  fav[s] = await shot(favicon, s);
  job(`favicon-${s}.png`, fav[s], s, 'transparent',
    [join(LANDING, 'site', 'assets'), join(ROOT, 'site', 'assets')]);
}

/* 3. PWA any + 5. Android launcher — app-icon.svg как есть (rx=116) */
const squircle = {};
for (const s of [48, 72, 96, 144, 192, 512]) squircle[s] = await shot(appIcon, s);
job('icon-192.png', squircle[192], 192, 'transparent', [join(ROOT, 'site', 'assets')]);
job('icon-512.png', squircle[512], 512, 'transparent', [join(ROOT, 'site', 'assets')]);
const DENSITY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(DENSITY)) {
  job(`launcher-${d}-${s}.png`, squircle[s], s, 'transparent', [join(MOBILE, 'assets', 'icons')]);
  job('ic_launcher.png', squircle[s], s, 'transparent', [join(ANDROID_RES, `mipmap-${d}`)]);
}

/* 3/4/5/6. full-bleed (rx=0), без прозрачности: maskable, apple-touch, магазины, iOS AppIcon */
const full = {};
for (const s of [180, 512, 1024]) full[s] = await shot(bleed(appIcon), s);
job('icon-maskable.png', full[512], 512, 'opaque', [join(ROOT, 'site', 'assets')]);
job('apple-touch-icon.png', full[180], 180, 'opaque',
  [join(LANDING, 'site', 'assets'), join(ROOT, 'site', 'assets')]);
job('play-512.png', full[512], 512, 'opaque', [join(MOBILE, 'assets', 'icons')]);
job('rustore-512.png', full[512], 512, 'opaque', [join(MOBILE, 'assets', 'icons')]);
job('appstore-1024.png', full[1024], 1024, 'opaque', [join(MOBILE, 'assets', 'icons')]);
job('icon-1024.png', full[1024], 1024, 'opaque', [join(XCASSETS, 'AppIcon.appiconset')]);

/* 5. adaptive foreground 432: только знак, композиция ≈ 66% (безопасная зона adaptive icon) по центру */
const FG = 432;
const fg = await shot(logoMark, FG, Math.round(FG * 0.66));
job('adaptive-foreground-432.png', fg, FG, 'transparent', [join(MOBILE, 'assets', 'icons')]);
for (const d of Object.keys(DENSITY)) job('ic_launcher_foreground.png', fg, FG, 'transparent', [join(ANDROID_RES, `mipmap-${d}`)]);

/* 6. iOS LaunchLogo 512: знак на прозрачном (в сториборде показывается 120pt aspect-fit) */
job('launch-logo.png', await shot(logoMark, 512), 512, 'transparent', [join(XCASSETS, 'LaunchLogo.imageset')]);

/* ---------- запись + проверка ---------- */
const rel = (p) => relative(join(ROOT, '..'), p);
let failed = 0;
for (const { name, png, size, mode, dests } of jobs) {
  const { pass, info } = verify(png, size, mode);
  if (!pass) failed++;
  for (const dir of dests) {
    mkdirSync(dir, { recursive: true });
    const dst = join(dir, name);
    writeFileSync(dst, png);
    console.log(`${pass ? 'ok ' : 'FAIL'} ${rel(dst)} — ${mode}, ${info}`);
  }
}

/* 2. favicon.ico — 16+32+48 PNG-вложениями; проверяем, что записи читаются обратно */
{
  const buf = ico([16, 32, 48].map(size => ({ size, png: fav[size] })));
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + 16 * i, len = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    const p = decodePng(buf.subarray(off, off + len));
    entries.push(`${p.w}×${p.h} (0,0)=${p.px(0, 0).join(',')}`);
  }
  const pass = count === 3 && entries.every((s, i) => s.startsWith(`${[16, 32, 48][i]}×`));
  if (!pass) failed++;
  for (const dir of [join(LANDING, 'site'), join(ROOT, 'site')]) {
    const dst = join(dir, 'favicon.ico');
    writeFileSync(dst, buf);
    console.log(`${pass ? 'ok ' : 'FAIL'} ${rel(dst)} — ico ${count} записи: ${entries.join('; ')}`);
  }
}

rmSync(TMP, { recursive: true, force: true });
if (failed) { console.error(`\nПроверка не пройдена: ${failed}`); process.exit(1); }
console.log(`\nГотово: ${jobs.length} картинок + favicon.ico, ${shots} рендеров Chrome.`);
