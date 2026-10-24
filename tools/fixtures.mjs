/* Тексты и база городов для проверок. Ни то ни другое в git не лежит: тексты (content/) живут на сервере и в рабочей копии
   владелицы, cities.db собирается из GeoNames. Чтобы проверки шли и там, где их нет (GitHub Actions, свежий клон):
   — тексты: настоящие из content/, если они там есть; иначе тестовые из tools/fixtures/content — та же структура, которую ждет
     backend/content.mjs (каждый файл из must(), ключи тем, коды карт и рун), но без настоящих формулировок. Зеленый прогон
     на тестовых текстах проверяет код, а не сами тексты — check-all говорит, на каких текстах шел прогон;
   — города: одна строка (Москва) — серверу и проверкам этого хватает, настоящий справочник не читается.
   LUNARIO_CHECK_CONTENT: auto (по умолчанию) — настоящие, если есть; real — только настоящие, без них провал (deploy.sh:
   выпуск проверяется на настоящих текстах); fixtures — тестовые, даже если настоящие есть (воспроизвести CI у себя). */
import { cp, readdir } from 'node:fs/promises';
import { readdirSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_CONTENT = join(repo, 'tools', 'fixtures', 'content');
const README = 'ПРОЧТИ-МЕНЯ.txt';   /* описание формата — единственный файл content/, который лежит в git */

/* настоящие тексты есть, если в папке есть хоть один .txt кроме описания формата; неполная папка — тоже «настоящие»:
   проверки упадут с понятным «Нет файла контента», а не пройдут молча на тестовых */
const hasRealTexts = (dir) => { try { return readdirSync(dir).some((f) => f.endsWith('.txt') && f !== README); } catch { return false; } };

/* { dir, kind: 'real' | 'fixtures' } — откуда проверкам брать тексты */
export function contentSource() {
  const mode = process.env.LUNARIO_CHECK_CONTENT || 'auto', real = join(repo, 'content');
  if (!['auto', 'real', 'fixtures'].includes(mode)) throw new Error(`LUNARIO_CHECK_CONTENT=${mode}: ждется auto, real или fixtures`);
  if (mode === 'fixtures') return { dir: FIXTURE_CONTENT, kind: 'fixtures' };
  /* в пакете выпуска content — символьная ссылка на рабочую копию (deploy.sh): берется настоящий путь */
  if (hasRealTexts(real)) return { dir: realpathSync(real), kind: 'real' };
  if (mode === 'real') throw new Error(`Нет настоящих текстов в ${real} (LUNARIO_CHECK_CONTENT=real). Заберите тексты: ./тексты-с-сервера.sh`);
  return { dir: FIXTURE_CONTENT, kind: 'fixtures' };
}

/* Копия текстов (.txt верхнего уровня, без картинок и архива) в папку проверки — проверки правят тексты через кабинет,
   и правка не должна дойти ни до настоящей папки, ни до тестовых файлов в git. Возвращает вид текстов */
export async function copyContent(dest) {
  const { dir, kind } = contentSource();
  await cp(dir, dest, { recursive: true, dereference: true, filter: (p) => p === dir || (dirname(p) === dir && p.endsWith('.txt')) });
  if (!(await readdir(dest)).some((f) => f.endsWith('.txt') && f !== README)) throw new Error(`в ${dest} не скопировалось ни одного текста из ${dir}`);
  return kind;
}

/* Справочник городов на одну строку — колонки, которые читает backend/cities.mjs (как в прежних копиях этой базы в проверках) */
export function makeCitiesDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS cities (name TEXT, region TEXT, country TEXT, lat REAL, lon REAL, tz TEXT, pop INTEGER, norm TEXT, w2 TEXT, alt TEXT);
    INSERT INTO cities SELECT 'Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow' WHERE NOT EXISTS (SELECT 1 FROM cities);`);
  db.close();
  return path;
}

export const contentNote = (kind) => kind === 'real' ? 'тексты: настоящие (content/)'
  : `тексты: тестовые (tools/fixtures/content) — ${process.env.LUNARIO_CHECK_CONTENT === 'fixtures' ? 'выбраны LUNARIO_CHECK_CONTENT=fixtures' : 'настоящих в content/ нет'}; проверен код, а не сами тексты`;
