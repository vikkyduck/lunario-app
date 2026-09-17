/* Версия оболочки — одна на index.html (?v=), импорты sky.js и SHELL в sw.js.
   node tools/bump-version.mjs        — показать текущие версии и расхождения
   node tools/bump-version.mjs 43     — поставить 43 везде
   Проверка согласованности живёт в check-personal-features.mjs: расхождение версий — ошибка выпуска. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
/* Только ресурсы оболочки; у картинок и иконок свои версии (?v=1, ?v=2) — они независимы */
const FILES = { 'index.html': /\/app\/(?:theme\.css|experience\.css|moon-glass\.css|sky\.js|experience\.js|boot\.js|moon-logo\.js|app\.js|handlers\.js|on\.js)\?v=(\d+)/g,
  'cabinet.html': /\/app\/(?:cabinet\.js|cabinet-handlers\.js|on\.js)\?v=(\d+)/g,
  'sky.js': /\.\/(?:constellations|sky-model)\.js\?v=(\d+)/g, 'sw.js': /const V = '(\d+)'/g };
export function shellVersions(dir = site) {
  const out = {};
  for (const [f, re] of Object.entries(FILES)) out[f] = [...readFileSync(join(dir, f), 'utf8').matchAll(re)].map((m) => m[1]);
  return out;
}
/* Любой css/js оболочки в index.html обязан нести ?v= и быть в SHELL у sw.js — иначе новый файл проскочит мимо кэша
   и офлайн-оболочки; список FILES выше — только для замены номера, проверка идёт по самой разметке */
export function shellGaps(dir = site) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8'), sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/app\/[\w.-]+\.(?:css|js))(\?v=\d+)?"/g)];
  const noVersion = refs.filter((m) => !m[2]).map((m) => m[1]);
  const shell = new Set([...sw.matchAll(/'(\/app\/[\w.-]+\.(?:css|js))\?v=' \+ V/g)].map((m) => m[1]));
  const notCached = refs.map((m) => m[1]).filter((f) => !shell.has(f) && !/sky\.js$/.test(f));   /* sky.js грузится по требованию, свои импорты версионирует сам */
  return noVersion.length || notCached.length ? { noVersion, notCached } : null;
}
export function versionMismatch(dir = site) {
  const all = new Set(Object.values(shellVersions(dir)).flat());
  return all.size === 1 ? null : shellVersions(dir);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (target) {
    if (!/^\d+$/.test(target)) { console.error('Нужен номер версии, например: node tools/bump-version.mjs 43'); process.exit(1); }
    for (const [f, re] of Object.entries(FILES)) {
      const p = join(site, f), text = readFileSync(p, 'utf8');
      writeFileSync(p, text.replace(re, (m, v) => m.replace(v, target)));
    }
  }
  const v = shellVersions(), bad = versionMismatch();
  for (const [f, list] of Object.entries(v)) console.log(`${f}: ${[...new Set(list)].join(', ') || '—'} (${list.length} мест)`);
  if (bad) { console.error('Версии расходятся — оболочка в кэше будет собрана из разных выпусков'); process.exit(1); }
  const gaps = shellGaps();
  if (gaps) { console.error('Оболочка неполная:', gaps.noVersion.length ? 'без ?v= — ' + gaps.noVersion.join(', ') : '', gaps.notCached.length ? 'нет в SHELL sw.js — ' + gaps.notCached.join(', ') : ''); process.exit(1); }
  console.log('Версия оболочки согласована:', [...new Set(v['sw.js'])][0]);
}
