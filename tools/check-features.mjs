/* Реестр функций сходится с разметкой и маршрутами (аудит v98, F23): у каждой функции из backend/features.json с экраном (view)
   есть панель id="w-<ключ>" в index.html и живой переход — кнопка openWidget-<ключ> в разметке или загрузчик в WIDGET_LOADERS;
   каждая кнопка data-feature / openWidget-… в разметке и каждый ключ WIDGET_LOADERS зарегистрированы в реестре;
   группы кабинета (features.mjs) — только из реестра. Удаление или переименование
   функции ломает эту проверку до выпуска, а не у человека на экране.  node tools/check-features.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(join(repo, f), 'utf8');
const FEATURES = JSON.parse(read('backend/features.json'));
const html = read('site/index.html');
const js = ['app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js', 'handlers.js'].map((f) => read('site/' + f)).join('\n');
const { FEATURE_GROUPS } = await import(join(repo, 'backend/features.mjs'));

const panes = new Set([...html.matchAll(/id="w-([a-z-]+)"/g)].map((m) => m[1]));
const loaders = new Set([...(/const WIDGET_LOADERS = \{([\s\S]*?)\n\};/.exec(js) || ['', ''])[1].matchAll(/(?:^|[\s,{])([a-z]+): \(\)/g)].map((m) => m[1]));
const opened = new Set([...(html + js).matchAll(/openWidget-([a-z]+)/g)].map((m) => m[1]).concat([...js.matchAll(/openWidget\('([a-z]+)'/g)].map((m) => m[1])));
/* кнопки функций; data-feature у секций — подпись группы плиток утра, у кнопки go-… — переход в раздел, не функция */
const marked = new Set([...html.matchAll(/<button([^>]*)data-feature="([a-z]+)"/g)].filter((m) => !/data-on="click:go-/.test(m[1])).map((m) => m[2]));
const HOME_ONLY = new Set(['home', 'askDate']);   /* служебные записи без экрана: адрес уведомления и дата вопроса */

let n = 0;
for (const [key, f] of Object.entries(FEATURES)) {
  if (HOME_ONLY.has(key)) continue;
  assert.ok(f.view, `features.json: у «${key}» нет view`);
  assert.ok(panes.has(key), `features.json: у «${key}» нет панели id="w-${key}" в index.html`);
  assert.ok(opened.has(key) || loaders.has(key) || marked.has(key), `features.json: к «${key}» нет перехода — ни кнопки openWidget-${key}, ни data-feature, ни загрузчика`);
  n++;
}
for (const key of loaders) assert.ok(FEATURES[key], `WIDGET_LOADERS: «${key}» не зарегистрирован в features.json`);
for (const key of marked) assert.ok(FEATURES[key], `index.html: data-feature="${key}" не зарегистрирован в features.json`);
for (const key of opened) assert.ok(FEATURES[key] && panes.has(key), `openWidget-${key}: нет записи в реестре или панели`);
for (const [, items] of FEATURE_GROUPS) for (const [key] of items) assert.ok(FEATURES[key], `FEATURE_GROUPS: «${key}» вне реестра`);
console.log(`PASS: ${n} функций реестра имеют панель и переход; ${loaders.size} загрузчиков, ${marked.size} кнопок и ${FEATURE_GROUPS.length} групп кабинета ссылаются только на зарегистрированные ключи.`);
