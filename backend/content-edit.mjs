/* Кабинет «Контент»: правка текстов приложения записями и строками, а не целым файлом.
   «Книга» и «статья» (карты, руны, лунные дни, личный год, справочник): запись начинается с «=== Название», дальше
   короткие поля «поле: значение», затем разделы «[Раздел]» и текст. Таблицы (настрой, вопросы, темы, напоминания…):
   строка = запись, поля через «|», строки с # — заметки, они сохраняются как есть.
   Читаем и пишем только сам файл в папке контента; приложение перечитывает его само (watch в content.mjs). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, noYo } from './content.mjs';

/* какие файлы — «книга/статья», какие — таблица и как называются колонки (по ПРОЧТИ-МЕНЯ.txt) */
export const BOOKS = {
  'карты-таро.txt': { title: 'Карты Таро', key: 'код', images: 'tarot' },
  'руны.txt': { title: 'Руны', key: 'код', images: 'runes' },
  'лунные-дни.txt': { title: 'Лунные дни', key: 'число', images: 'lunar' },
  'личный-год.txt': { title: 'Личный год', key: 'число', images: 'year' },
  'лунные-дни-справочник.txt': { title: 'Справочник лунных дней', key: '', images: '' },
};
export const TABLES = {
  'напоминания.txt': { title: 'Пуши', cols: ['ключ', 'заголовок', 'текст'] },
  'настрой.txt': { title: 'Настрой дня и вопрос', cols: ['тема', 'настрой', 'вопрос'] },
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
const write = (name, text) => writeFileSync(path(name), noYo(text), 'utf8');

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
export function bookRecordSave(name, { index, title, fields, body }) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name));
  const i = Number(index);
  if (!(i >= 0 && i < book.records.length)) return { ok: false, error: 'not_found' };
  const t = String(title || '').trim(); if (!t) return { ok: false, error: 'no_title' };
  const fl = (Array.isArray(fields) ? fields : []).map(([k, v]) => [String(k || '').trim().replace(/[:|]/g, ''), String(v || '').trim().replace(/\n/g, ' ')]).filter(([k]) => k);
  book.records[i] = { title: t, fields: fl, body: String(body || '').replace(/\r/g, '').trim() };
  write(name, serializeBook(book));
  return { ok: true };
}
export function bookRecordAdd(name, after) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name));
  const sample = book.records[Math.min(book.records.length - 1, Math.max(0, Number(after) || 0))];
  const rec = { title: 'Новая запись', fields: (sample ? sample.fields : []).map(([k]) => [k, '']), body: '' };
  book.records.splice(Math.min(book.records.length, (Number(after) || 0) + 1), 0, rec);
  write(name, serializeBook(book));
  return { ok: true, index: Math.min(book.records.length - 1, (Number(after) || 0) + 1) };
}
export function bookRecordRemove(name, index) {
  if (!BOOKS[name]) return { ok: false, error: 'not_book' };
  const book = parseBook(read(name)); const i = Number(index);
  if (!(i >= 0 && i < book.records.length)) return { ok: false, error: 'not_found' };
  book.records.splice(i, 1); write(name, serializeBook(book)); return { ok: true };
}

/* ── таблица ── */
export function tableRows(name) {
  if (!TABLES[name]) throw new Error('not_table');
  const lines = read(name).split('\n');
  const notes = [], rows = [];
  for (const l of lines) { if (!l.trim()) continue; if (l.trim().startsWith('#')) { notes.push(l); continue; } rows.push(l.split('|').map((c) => c.trim())); }
  return { cols: TABLES[name].cols, notes: notes.join('\n'), rows };
}
export function tableSave(name, rows) {
  if (!TABLES[name]) return { ok: false, error: 'not_table' };
  if (!Array.isArray(rows)) return { ok: false, error: 'bad_rows' };
  const notes = read(name).split('\n').filter((l) => l.trim().startsWith('#'));
  const clean = rows.map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').replace(/[|\n\r]/g, ' ').trim())).filter((r) => r.some(Boolean));
  const body = clean.map((r) => r.join(' | ')).join('\n');
  write(name, (notes.length ? notes.join('\n') + '\n\n' : '') + body + '\n');
  return { ok: true, rows: clean.length };
}
