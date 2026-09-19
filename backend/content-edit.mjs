/* Кабинет «Контент»: правка текстов приложения записями и строками, а не целым файлом.
   «Книга» и «статья» (карты, руны, лунные дни, личный год, справочник): запись начинается с «=== Название», дальше
   короткие поля «поле: значение», затем разделы «[Раздел]» и текст. Таблицы (настрой, вопросы, темы, напоминания…):
   строка = запись, поля через «|», строки с # — заметки, они сохраняются как есть.
   Читаем и пишем только сам файл в папке контента; приложение перечитывает его само (watch в content.mjs). */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
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
   любую версию можно вернуть — текущая при этом тоже уходит в архив. Картинки — в архив/картинки/<папка>/ ── */
const ARCHIVE = () => join(CONTENT_DIR, 'архив');
const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
const who = (by) => String(by || '').replace(/[^\w.@-]/g, '').slice(0, 60) || 'кабинет';
function archive(name, by) {
  const src = path(name); if (!existsSync(src)) return '';
  const dir = join(ARCHIVE(), name); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = `${stamp()}__${who(by)}.txt`; copyFileSync(src, join(dir, id)); return id;
}
export function writeFile(name, text, by) { archive(name, by); writeFileSync(path(name), noYo(text), 'utf8'); }
const write = writeFile;
export function versions(name) {
  const dir = join(ARCHIVE(), name); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().reverse().map((f) => { const m = f.match(/^(.+?)__(.+)\.txt$/); const st = statSync(join(dir, f));
    return { id: f, ts: m ? m[1].replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3') + 'Z' : '', by: m ? m[2] : '', size: st.size }; });
}
export function versionText(name, id) { const f = join(ARCHIVE(), name, basename(String(id))); return existsSync(f) ? readFileSync(f, 'utf8') : null; }
export function restore(name, id, by) {
  const text = versionText(name, id); if (text === null) return { ok: false, error: 'not_found' };
  writeFile(name, text, by); return { ok: true };
}
/* картинка: старый файл — в архив с меткой времени, список и возврат — по записи */
export function archiveImage(dir, file, by) {
  const src = join(CONTENT_DIR, 'картинки', dir, file); if (!existsSync(src)) return '';
  const adir = join(ARCHIVE(), 'картинки', dir); if (!existsSync(adir)) mkdirSync(adir, { recursive: true });
  const id = `${file.replace(/\.[^.]+$/, '')}__${stamp()}__${who(by)}${extname(file)}`; copyFileSync(src, join(adir, id)); return id;
}
export function imageVersions(dir, base) {
  const adir = join(ARCHIVE(), 'картинки', dir); if (!existsSync(adir)) return [];
  return readdirSync(adir).filter((f) => f.startsWith(base + '__')).sort().reverse().map((f) => { const m = f.match(/__(.+?)__(.+)\.[^.]+$/); return { id: f, ts: m ? m[1].replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3') + 'Z' : '', by: m ? m[2] : '' }; });
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
export function bookRecords(name) {
  if (!BOOKS[name]) throw new Error('not_book');
  const { records } = parseBook(read(name));
  return records.map((r, i) => ({ index: i, key: keyOf(name, r), title: r.title, fields: r.fields, body: r.body,
    image: (r.fields.find(([n]) => n === 'картинка') || [])[1] || '' }));
}
export function bookRecordSave(name, { index, title, fields, body }, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name));
  const i = Number(index);
  if (!(i >= 0 && i < book.records.length)) return { ok: false, error: 'not_found' };
  const t = String(title || '').trim(); if (!t) return { ok: false, error: 'no_title' };
  const fl = (Array.isArray(fields) ? fields : []).map(([k, v]) => [String(k || '').trim().replace(/[:|]/g, ''), String(v || '').trim().replace(/\n/g, ' ')]).filter(([k]) => k);
  book.records[i] = { title: t, fields: fl, body: String(body || '').replace(/\r/g, '').trim() };
  write(name, serializeBook(book), by);
  return { ok: true };
}
export function bookRecordAdd(name, after, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name));
  const sample = book.records[Math.min(book.records.length - 1, Math.max(0, Number(after) || 0))];
  const rec = { title: 'Новая запись', fields: (sample ? sample.fields : []).map(([k]) => [k, '']), body: '' };
  book.records.splice(Math.min(book.records.length, (Number(after) || 0) + 1), 0, rec);
  write(name, serializeBook(book), by);
  return { ok: true, index: Math.min(book.records.length - 1, (Number(after) || 0) + 1) };
}
export function bookRecordRemove(name, index, by) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name)); const i = Number(index);
  if (!(i >= 0 && i < book.records.length)) return { ok: false, error: 'not_found' };
  book.records.splice(i, 1); write(name, serializeBook(book), by); return { ok: true };
}

/* ── таблица ── */
export function tableRows(name) {
  if (!TABLES[name]) throw new Error('not_table');
  const lines = read(name).split('\n');
  const notes = [], rows = [];
  for (const l of lines) { if (!l.trim()) continue; if (l.trim().startsWith('#')) { notes.push(l); continue; } rows.push(l.split('|').map((c) => c.trim())); }
  return { cols: TABLES[name].cols, notes: notes.join('\n'), rows };
}
export function tableSave(name, rows, by) {
  if (!TABLES[name]) return { ok: false, error: 'not_table' };
  if (!Array.isArray(rows)) return { ok: false, error: 'bad_rows' };
  const notes = read(name).split('\n').filter((l) => l.trim().startsWith('#'));
  const clean = rows.map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').replace(/[|\n\r]/g, ' ').trim())).filter((r) => r.some(Boolean));
  const body = clean.map((r) => r.join(' | ')).join('\n');
  write(name, (notes.length ? notes.join('\n') + '\n\n' : '') + body + '\n', by);
  return { ok: true, rows: clean.length };
}

/* ── Файлы контента списком и целиком (страница «Тексты» и вкладка «Файлы целиком») ── */
export const contentFiles = () => readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.txt')).sort().map((name) => {
  const text = readFileSync(join(CONTENT_DIR, name), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  return { name, lines, size: text.length, mtime: statSync(join(CONTENT_DIR, name)).mtime.toISOString().slice(0, 16).replace('T', ' ') };
});
export const readContent = (name) => read(name);
export const writeContent = (name, text, by) => writeFile(name, text, by);   /* прежняя версия — в архив, без «е с точками» */

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
    try { const txt = readContent(set.file); if (txt.includes(oldName)) writeContent(set.file, txt.split(oldName).join(name), by); } catch { /* текст не тронули — картинка все равно на месте */ }
    try { unlinkSync(join(dir, oldName)); } catch {}
  } else if (!oldName) {
    return { ok: true, name, note: 'В текстовом файле у записи нет поля «картинка» — впишите имя файла: ' + name };
  }
  return { ok: true, name, url: `/app/content/${kind}/${name}?v=${Date.now().toString(36)}` };
}
