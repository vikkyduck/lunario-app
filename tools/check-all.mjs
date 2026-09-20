/* Один набор обязательных проверок для CI и выпуска (аудит v98, F21): его запускают .github/workflows/check.yml и deploy.sh,
   чтобы выпуск не проверял больше или меньше, чем CI. Синтаксис — весь бэкенд, включая backend/http/, инструменты и клиентские
   скрипты; версии оболочки; затем каждая проверка из tools/ по одной, с выводом при падении. Чего нет в окружении, говорится
   явно: UI-часть (Playwright) пропускается с пометкой, а не молча «проходит».   node tools/check-all.mjs [--quick] */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const quick = process.argv.includes('--quick');
const run = (args) => spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
const results = [];
const step = (name, r) => { const ok = r.status === 0; results.push([name, ok ? 'PASS' : 'FAIL']); console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) console.log((r.stdout || '') + (r.stderr || '')); return ok; };

/* 1. синтаксис — все .mjs бэкенда (и вложенные http/), инструменты, скрипты сайта */
const files = [];
const walk = (dir, ext) => { for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) { if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(join(dir, e.name), ext); } else if (ext.some((x) => e.name.endsWith(x))) files.push(join(dir, e.name)); } };
walk('backend', ['.mjs']); walk('tools', ['.mjs']); walk('site', ['.js']);
let syntaxOk = true;
for (const f of files) { const r = run(['--check', f]); if (r.status !== 0) { syntaxOk = false; console.log(`❌ синтаксис: ${f}\n${r.stderr}`); } }
step(`синтаксис: ${files.length} файлов`, { status: syntaxOk ? 0 : 1 });

/* 2. версии оболочки согласованы */
step('версии ?v= оболочки', run(['tools/bump-version.mjs']));

/* 3. проверки по темам — каждая своим процессом; сначала быстрые и статические, потом интеграционные (с настоящим сервером) */
const CHECKS = ['check-yo', 'check-features', 'check-daily-sets', 'check-entry-history', 'check-brand', 'check-daylight', 'check-design', 'check-experience',
  'check-feature-recovery', 'check-four-sections', 'check-notifications', 'check-repeat-practices', 'check-restoration', 'check-usability',
  ...(quick ? [] : ['check-personal-features', 'check-sync', 'check-isolation'])];
for (const c of CHECKS) step(c, run([`tools/${c}.mjs`]));

/* 4. чего в этом окружении нет — сказано явно */
let ui = false; try { await import('playwright'); ui = true; } catch { /* нет браузера */ }
console.log(ui ? 'ℹ️ Playwright есть: UI-проверки — node tools/check-personal-features.mjs --ui' : '⚠️ UI-проверки пропущены: Playwright не установлен (мобильная навигация, диктовка и доставка уведомлений здесь не проверяются)');
const failed = results.filter(([, s]) => s === 'FAIL');
console.log(`\n${failed.length ? '❌' : '✅'} итог: ${results.length - failed.length} из ${results.length} проверок прошли${failed.length ? `; не прошли: ${failed.map(([n]) => n).join(', ')}` : ''}${quick ? ' (--quick: без интеграционных)' : ''}`);
process.exit(failed.length ? 1 : 0);
