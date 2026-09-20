/* Кабинет «Контент»: правка текстов приложения записями и строками, а не целым файлом.
   «Книга» и «статья» (карты, руны, лунные дни, личный год, справочник): запись начинается с «=== Название», дальше
   короткие поля «поле: значение», затем разделы «[Раздел]» и текст. Таблицы (настрой, вопросы, темы, напоминания…):
   строка = запись, поля через «|», строки с # — заметки, они сохраняются как есть.
   Читаем и пишем только сам файл в папке контента; приложение перечитывает его само (watch в content.mjs). */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { CONTENT_DIR, IMAGE_DIRS, noYo } from './content.mjs';
import * as C from './content.mjs';

/* какие файлы — «книга/статья», какие — таблица и как называются колонки (по ПРОЧТИ-МЕНЯ.txt) */
export const BOOKS = {
  'карты-таро.txt': { title: 'Карты Таро', key: 'код', images: 'tarot' },
  'руны.txt': { title: 'Руны', key: 'код', images: 'runes' },
  'лунные-дни.txt': { title: 'Лунные дни', key: 'число', images: 'lunar' },
  'личный-год.txt': { title: 'Личный год', key: 'число', images: 'year' },
  'лунные-дни-справочник.txt': { title: 'Справочник лунных дней', key: '', images: '' },
};
export const TABLES = {
  'интерфейс.txt': { title: 'Фразы интерфейса', cols: ['ключ', 'текст'] },
  'напоминания.txt': { title: 'Пуши', cols: ['ключ', 'заголовок', 'текст'] },
  'память.txt': { title: 'Память («Я помню»)', cols: ['ключ', 'текст'] },
  'вопросы-по-темам.txt': { title: 'Вопросы дня по теме', cols: ['тема', 'вопрос'] },
  'планеты-в-знаках.txt': { title: 'Натальная карта: планеты в знаках', cols: ['планета', 'знак', 'текст', 'суть'] },
  'планеты-в-домах.txt': { title: 'Натальная карта: планеты в домах', cols: ['планета', 'дом', 'текст', 'суть'] },
  'аспекты.txt': { title: 'Натальная карта: аспекты', cols: ['планета', 'аспект', 'планета', 'текст', 'суть'] },
  'точки-в-знаках.txt': { title: 'Натальная карта: Асцендент, MC и точки', cols: ['точка', 'знак', 'текст', 'суть'] },
  'баланс-карты.txt': { title: 'Натальная карта: стихии, кресты, стеллиумы (резюме)', cols: ['вид', 'значение', 'текст', 'суть'] },
  'натальная-карта.txt': { title: 'Натальная карта: все значения одним файлом', cols: ['вид', 'кто', 'где', 'с кем (аспект)', 'текст', 'суть'] },
  'настрой.txt': { title: 'Настрой дня и вопрос', cols: ['тема', 'настрой', 'вопрос', 'картинка'] },
  'вопросы-дня.txt': { title: 'Вопросы дня', cols: ['вопрос'] },
  'аффирмации.txt': { title: 'Аффирмации (открытка)', cols: ['фраза'] },
  'темы-дня.txt': { title: 'Темы дня', cols: ['ключ', 'название', 'о чем'] },
  'темы-источников.txt': { title: 'Источники тем', cols: ['тип', 'источник', 'тема'] },
  'тона-дня.txt': { title: 'Тона дня (прогноз)', cols: ['название', 'текст', 'доп.'] },
  'знаки-зодиака.txt': { title: 'Знаки зодиака', cols: ['знак', 'черта'] },
  'ответы-да-нет.txt': { title: 'Да / Нет', cols: ['тема', 'да', 'нет', 'доп.'] },
  'небо.txt': { title: 'Небо', cols: ['вид', 'ключ', 'название', 'текст', 'доп.'] },
  'неделя.txt': { title: 'Моя неделя', cols: ['ключ', 'текст'] },
  'новое.txt': { title: 'Что нового', cols: ['месяц', 'название', 'раздел:виджет', 'о чем'] },
  'инструменты.txt': { title: 'Инструменты дневника', cols: ['ключ', 'раздел', 'название', 'о чем', 'на старте'] },
  'привычки.txt': { title: 'Подсказки привычек', cols: ['привычка'] },
  'аскезы.txt': { title: 'Аскезы на выбор', cols: ['аскеза'] },
  'эмоции.txt': { title: 'Круг эмоций', cols: ['вид', 'ключ', 'название', 'цвет'] },
  'темы.txt': { title: 'Темы чтения', cols: ['ключ', 'раздел статьи', 'чип', 'по умолчанию'] },
  'нумерология-судьба.txt': { title: 'Число судьбы', cols: ['число', 'название', 'текст'] },
  'нумерология-год.txt': { title: 'Личный год (строка)', cols: ['число', 'текст'] },
  'нумерология-день.txt': { title: 'Число дня', cols: ['число', 'текст'] },
};
const path = (name) => { if (!/^[\wа-яА-Я.-]+\.txt$/u.test(name) || name.includes('/')) throw new Error('bad_file'); return join(CONTENT_DIR, name); };
const read = (name) => readFileSync(path(name), 'utf8');

/* ── архив версий (решение владелицы 19.09): перед каждой записью прежний файл уезжает в архив/<файл>/<время>__<кто>.txt,
   любую версию можно вернуть — текущая при этом тоже уходит в архив. Картинки — в архив/картинки/<папка>/.
   Имя версии — до миллисекунды и с номером при совпадении: два сохранения подряд не затирают друг друга (аудит v98, F04).
   Сам файл пишется во временный и подменяется атомарно: обрыв посередине не оставит половину справочника. ── */
const ARCHIVE = () => join(CONTENT_DIR, 'архив');
const stamp = (d = new Date()) => d.toISOString().replace(/Z$/, '').replace(/:/g, '-');
const who = (by) => String(by || '').replace(/[^\w.@-]/g, '').slice(0, 60) || 'кабинет';
const uniqueName = (dir, base, ext) => { let id = base + ext; for (let n = 2; existsSync(join(dir, id)); n++) id = `${base}-${n}${ext}`; return id; };
/* время из имени версии: 2026-09-20T10-11-12.345-2 → 2026-09-20T10:11:12.345Z */
const tsOf = (s) => String(s || '').replace(/T(\d\d)-(\d\d)-(\d\d)(\.\d+)?(-\d+)?$/, 'T$1:$2:$3$4') + 'Z';
function archive(name, by) {
  const src = path(name); if (!existsSync(src)) return '';
  const dir = join(ARCHIVE(), name); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = uniqueName(dir, `${stamp()}__${who(by)}`, '.txt'); copyFileSync(src, join(dir, id)); return id;
}
function writeAtomic(file, text) { const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`; writeFileSync(tmp, text, 'utf8'); renameSync(tmp, file); }
/* Версия файла — отпечаток его текста. Единственный низкоуровневый способ записи (R03): expected — версия, которую редактор
   читал; не совпала с текущей — conflict, файл не трогается. null — осознанный пропуск проверки (нет прочитанной версии:
   загрузка целиком новой копии текстов). Все редакторы — книги, таблицы, сырой файл, откат версии — идут через этот путь */
const versionOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);
export const fileVersion = (name) => existsSync(path(name)) ? versionOf(read(name)) : '';
export function writeFile(name, text, by, expected) {
  if (expected === undefined) throw new Error('writeFile: нужна прочитанная версия (или null — осознанно без проверки)');
  if (expected !== null && expected !== fileVersion(name)) return { ok: false, error: 'conflict', version: fileVersion(name) };
  archive(name, by); writeAtomic(path(name), noYo(text)); return { ok: true, version: fileVersion(name) };
}
const write = writeFile;
export function versions(name) {
  const dir = join(ARCHIVE(), name); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().reverse().map((f) => { const m = f.match(/^(.+?)__(.+)\.txt$/); const st = statSync(join(dir, f));
    return { id: f, ts: m ? tsOf(m[1]) : '', by: m ? m[2] : '', size: st.size }; });
}
export function versionText(name, id) { const f = join(ARCHIVE(), name, basename(String(id))); return existsSync(f) ? readFileSync(f, 'utf8') : null; }
export function restore(name, id, by, expected = null) {
  const text = versionText(name, id); if (text === null) return { ok: false, error: 'not_found' };
  return writeFile(name, text, by, expected);
}
/* картинка: старый файл — в архив с меткой времени, список и возврат — по записи */
export function archiveImage(dir, file, by) {
  const src = join(CONTENT_DIR, 'картинки', dir, file); if (!existsSync(src)) return '';
  const adir = join(ARCHIVE(), 'картинки', dir); if (!existsSync(adir)) mkdirSync(adir, { recursive: true });
  const id = uniqueName(adir, `${file.replace(/\.[^.]+$/, '')}__${stamp()}__${who(by)}`, extname(file)); copyFileSync(src, join(adir, id)); return id;
}
export function imageVersions(dir, base) {
  const adir = join(ARCHIVE(), 'картинки', dir); if (!existsSync(adir)) return [];
  return readdirSync(adir).filter((f) => f.startsWith(base + '__')).sort().reverse().map((f) => { const m = f.match(/__(.+?)__(.+?)(?:-\d+)?\.[^.]+$/); return { id: f, ts: m ? tsOf(m[1]) : '', by: m ? m[2] : '' }; });
}
export function imageArchivePath(dir, id) { const f = join(ARCHIVE(), 'картинки', dir, basename(String(id))); return existsSync(f) ? f : null; }

/* ── книга / статья ── */
export function parseBook(text) {
  const lines = text.split('\n');
  const records = []; let preamble = []; let cur = null;
  for (const line of lines) {
    if (line.startsWith('=== ')) { cur = { title: line.slice(4).trim(), fields: [], body: [] , raw: [] }; records.push(cur); continue; }
    if (!cur) { preamble.push(line); continue; }
    cur.raw.push(line);
  }
  for (const r of records) {
    let i = 0; const raw = r.raw;
    while (i < raw.length && /^[^\s\[#][^:]*:\s/.test(raw[i]) && !raw[i].startsWith('##')) { const m = raw[i].match(/^([^:]+):\s?(.*)$/); r.fields.push([m[1].trim(), m[2].trim()]); i++; }
    r.body = raw.slice(i).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    delete r.raw;
  }
  /* сколько пустых строк перед первой записью и между записями — сохраняем как в файле, чтобы правка одной записи не трогала остальное */
  const gaps = [...text.matchAll(/\n(\n*)=== /g)].map((m) => '\n' + m[1]);
  const preSep = gaps[0] || '\n\n';
  const rest = gaps.slice(1); const sep = rest.length ? rest.sort((a, b) => rest.filter((x) => x === b).length - rest.filter((x) => x === a).length)[0] : '\n\n';
  return { preamble: preamble.join('\n').replace(/\s+$/, ''), records, sep, preSep };
}
export function serializeBook({ preamble, records, sep = '\n\n', preSep = sep }) {
  return (preamble ? preamble + preSep : '') + records.map((r) => `=== ${r.title}\n${r.fields.map(([k, v]) => `${k}: ${v}`).join('\n')}${r.fields.length ? '\n' : ''}\n${r.body}`.replace(/\s+$/, '')).join(sep) + '\n';
}
const keyOf = (name, r) => { const k = BOOKS[name]?.key; const f = k ? r.fields.find(([n]) => n === k) : null; return f ? f[1] : r.title; };
/* версия справочника — та же fileVersion: карточка сохраняется по ключу записи и версии, с которой ее открыли;
   файл изменился (кто-то удалил или добавил запись) — конфликт, а не запись поверх соседней карточки (аудит v98, F03) */
export const bookVersion = fileVersion;
export function bookRecords(name) {
  if (!BOOKS[name]) throw new Error('not_book');
  const text = read(name), version = versionOf(text);
  const { records } = parseBook(text);
  return records.map((r, i) => ({ index: i, key: keyOf(name, r), version, title: r.title, fields: r.fields, body: r.body,
    image: (r.fields.find(([n]) => n === 'картинка') || [])[1] || '' }));
}
/* запись ищется по ключу (код, число или название); index — только для старых вызовов без ключа */
const locate = (name, book, { key, index }) => { if (key !== undefined && key !== null && String(key) !== '') { const i = book.records.findIndex((r) => keyOf(name, r) === String(key)); return i; } const i = Number(index); return i >= 0 && i < book.records.length ? i : -1; };
export function bookRecordSave(name, { index, key, version, title, fields, body }, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const text = read(name), cur = versionOf(text);
  if (version && version !== cur) return { ok: false, error: 'conflict', version: cur };
  const book = parseBook(text);
  const i = locate(name, book, { key, index });
  if (i < 0) return { ok: false, error: 'not_found' };
  const t = String(title || '').trim(); if (!t) return { ok: false, error: 'no_title' };
  const fl = (Array.isArray(fields) ? fields : []).map(([k, v]) => [String(k || '').trim().replace(/[:|]/g, ''), String(v || '').trim().replace(/\n/g, ' ')]).filter(([k]) => k);
  book.records[i] = { title: t, fields: fl, body: String(body || '').replace(/\r/g, '').trim() };
  return write(name, serializeBook(book), by, cur);
}
export function bookRecordAdd(name, after, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const text = read(name), book = parseBook(text);
  const sample = book.records[Math.min(book.records.length - 1, Math.max(0, Number(after) || 0))];
  const rec = { title: 'Новая запись', fields: (sample ? sample.fields : []).map(([k]) => [k, '']), body: '' };
  book.records.splice(Math.min(book.records.length, (Number(after) || 0) + 1), 0, rec);
  const w = write(name, serializeBook(book), by, versionOf(text)); if (!w.ok) return w;
  return { ok: true, index: Math.min(book.records.length - 1, (Number(after) || 0) + 1), version: w.version };
}
export function bookRecordRemove(name, { index, key, version } = {}, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const text = read(name), cur = versionOf(text);
  if (version && version !== cur) return { ok: false, error: 'conflict', version: cur };
  const book = parseBook(text); const i = locate(name, book, { key, index });
  if (i < 0) return { ok: false, error: 'not_found' };
  book.records.splice(i, 1); return write(name, serializeBook(book), by, cur);
}

/* ── таблица ── */
export function tableRows(name) {
  if (!TABLES[name]) throw new Error('not_table');
  const text = read(name), lines = text.split('\n');
  const notes = [], rows = [];
  for (const l of lines) { if (!l.trim()) continue; if (l.trim().startsWith('#')) { notes.push(l); continue; } rows.push(l.split('|').map((c) => c.trim())); }
  return { cols: TABLES[name].cols, notes: notes.join('\n'), rows, version: versionOf(text) };
}
/* таблица сохраняется целиком, поэтому версия обязательна: вторая вкладка с прежней версией получит conflict, а не затрет строку первой (R03) */
export function tableSave(name, rows, by, version) {
  if (!TABLES[name]) return { ok: false, error: 'not_table' };
  if (!Array.isArray(rows)) return { ok: false, error: 'bad_rows' };
  const text = read(name), cur = versionOf(text);
  if (version !== cur) return { ok: false, error: version ? 'conflict' : 'no_version', version: cur };
  const notes = text.split('\n').filter((l) => l.trim().startsWith('#'));
  const clean = rows.map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').replace(/[|\n\r]/g, ' ').trim())).filter((r) => r.some(Boolean));
  const body = clean.map((r) => r.join(' | ')).join('\n');
  const w = write(name, (notes.length ? notes.join('\n') + '\n\n' : '') + body + '\n', by, cur); if (!w.ok) return w;
  return { ok: true, rows: clean.length, version: w.version };
}

/* ── Файлы контента списком и целиком (страница «Тексты» и вкладка «Файлы целиком») ── */
export const contentFiles = () => readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.txt')).sort().map((name) => {
  const text = readFileSync(join(CONTENT_DIR, name), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  return { name, lines, size: text.length, mtime: statSync(join(CONTENT_DIR, name)).mtime.toISOString().slice(0, 16).replace('T', ' ') };
});
export const readContent = (name) => read(name);
export const contentRead = (name) => { const text = read(name); return { text, version: versionOf(text) }; };
export const writeContent = (name, text, by, expected) => writeFile(name, text, by, expected);   /* прежняя версия — в архив, без «е с точками»; expected — версия, с которой правили */

/* ── Картинки к записям каталогов: какие наборы есть и как заменить картинку у записи ── */
export const CONTENT_IMAGE_SETS = {
  tarot: { title: 'Карты Таро', file: 'карты-таро.txt', items: () => [...C.ARCANA].map((c) => ({ key: c.slug, name: c.name, image: c.image })) },
  runes: { title: 'Руны', file: 'руны.txt', items: () => [...C.RUNES].map((r) => ({ key: r.slug, name: r.name, image: r.image })) },
  lunar: { title: 'Лунные дни', file: 'лунные-дни.txt', items: () => [...C.LUNAR_INFO].map((d) => ({ key: String(d.n), name: `${d.n} · ${d.theme || d.symbol || ''}`, image: d.image })) },
  year: { title: 'Личный год', file: 'личный-год.txt', items: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33].map((n) => C.YEARS[n]).filter(Boolean).map((y) => ({ key: String(y.n), name: `${y.n} · ${y.title || y.energy || ''}`, image: y.image })) },   /* YEARS — прокси без списка ключей */
};
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export function contentImageList() { return Object.entries(CONTENT_IMAGE_SETS).map(([kind, s]) => ({ kind, title: s.title, items: s.items() })); }
export function contentImagePut({ kind, key, type, data, by }) {
  const set = CONTENT_IMAGE_SETS[kind]; if (!set) return { ok: false, error: 'bad_kind' };
  const item = set.items().find((i) => i.key === String(key)); if (!item) return { ok: false, error: 'not_found' };
  /* имя текущего файла — из текстового файла на диске, а не из памяти: тексты перечитываются с задержкой, и две замены подряд иначе расходятся */
  try { const fresh = bookRecords(set.file).find((r) => r.key === String(key)); if (fresh) item.image = fresh.image ? `/app/content/${kind}/${fresh.image}` : ''; } catch { /* оставим как в памяти */ }
  const ext = IMAGE_EXT[type]; if (!ext) return { ok: false, error: 'bad_type' };
  const buf = Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) return { ok: false, error: 'too_big' };
  const dir = join(CONTENT_DIR, 'картинки', IMAGE_DIRS[kind]); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const oldName = item.image ? decodeURIComponent(item.image.split('/').pop().split('?')[0]) : '';
  const base = oldName ? oldName.replace(/\.[^.]+$/, '') : String(key).replace(/[^\w.-]/g, '') || 'img';
  const name = `${base}.${ext}`;
  if (oldName) archiveImage(IMAGE_DIRS[kind], oldName, by);   /* прежняя картинка — в архив, вернуть можно из записи */
  writeFileSync(join(dir, name), buf);
  if (oldName && oldName !== name) {   /* новое расширение — переписываем имя в текстовом файле, старый файл убираем */
    try { const txt = readContent(set.file); if (txt.includes(oldName)) writeContent(set.file, txt.split(oldName).join(name), by, versionOf(txt)); } catch { /* текст не тронули — картинка все равно на месте */ }
    try { unlinkSync(join(dir, oldName)); } catch {}
  } else if (!oldName) {
    return { ok: true, name, note: 'В текстовом файле у записи нет поля «картинка» — впишите имя файла: ' + name };
  }
  return { ok: true, name, url: `/app/content/${kind}/${name}?v=${Date.now().toString(36)}` };
}
