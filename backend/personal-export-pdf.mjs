/* «Скачать мои данные» — читаемый PDF в стилистике Лунарио: ночной фон, мягкое свечение, логотип с Луной,
   золотые подписи разделов и стеклянные карточки. Содержимое — то же, что в personalExport(): профиль, настройки,
   дневник, желания, привычки, аскезы, настроения, вопросы и ответы, установки дня, напоминания.
   Шрифт Onest (backend/fonts, OFL) встраивается в файл, поэтому PDF выглядит одинаково везде. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfDocument, wrap } from './pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let fontsCache = null;
const fonts = () => fontsCache || (fontsCache = { regular: readFileSync(join(here, 'fonts/onest-400.ttf')), semibold: readFileSync(join(here, 'fonts/onest-600.ttf')) });

/* палитра ночи из theme.css, в долях 0–1 */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const C = { bg: hex('#0f0d1c'), glow: hex('#d9b868'), text: hex('#f5f2ea'), muted: hex('#cdc6e2'), faint: hex('#8f87ad'), gold: hex('#d9b868'), gold2: hex('#f0d79a'), panel: hex('#f5f2ea'), line: hex('#f5f2ea'), warn: hex('#ffb3b3') };

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(d || ''); };
const fmtWhen = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : `${fmtDay(iso.slice(0, 10))}, ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`; };
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many); };
const KIND = { yesno: '«Да / Нет»', rune: 'Руна', runes: 'Расклад рун', spread: 'Расклад Таро', card: 'Карта дня', dayrune: 'Руна дня' };
const JOURNAL_KIND = { gratitude: 'благодарность', answer: 'ответ на вопрос дня', weekly: 'итог недели' };
const ECHO = { yes: 'отозвалось', no: 'не связано', unsure: 'не уверена' };
const THEME = { dark: 'ночная', light: 'светлая', system: 'как в системе' };
const FREQ = { daily: 'каждый день', weekly: 'раз в неделю', events: 'по событиям на небе' };
const WEEKDAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const ASK_STATUS = { active: 'идёт', done: 'выполнена', failed: 'прервана', stopped: 'остановлена' };

/* Поток вёрстки: страницы A4, поля, перенос блоков на новую страницу, колонтитулы */
class Flow {
  constructor(doc, fonts, headerImage) {
    this.doc = doc; this.f = fonts; this.header = headerImage;
    this.W = doc.w; this.H = doc.h; this.mx = 48; this.top = this.H - 56; this.bottom = 56; this.cw = this.W - this.mx * 2;
    this.n = 0; this.page = null; this.y = 0;
  }
  newPage() {
    this.n++; const p = this.page = this.doc.addPage();
    p.fillPage(C.bg);
    p.glow(this.W * 0.92, this.H * 0.78, 260, C.glow, C.bg, 0.16);
    p.glow(this.W * 0.06, this.H * 0.2, 200, hex('#f0d79a'), C.bg, 0.08);
    if (this.n > 1) p.text(this.f.regular, 8.5, this.mx, this.H - 34, 'Лунарио · Мои данные', C.faint, { spacing: 0.3 });
    this.y = this.n > 1 ? this.top - 8 : this.top;
    return p;
  }
  finish() { /* номера страниц — когда известно их число */
    this.doc.pages.forEach((page, i) => { const s = `${i + 1} / ${this.doc.pages.length}`; page.writer.text(this.f.regular, 8.5, (this.W - this.f.regular.width(s, 8.5)) / 2, 30, s, C.faint); });
  }
  ensure(h) { if (!this.page || this.y - h < this.bottom) this.newPage(); }
  gap(h) { this.y -= h; }
  /* золотая подпись капителью + заголовок раздела */
  section(eyebrow, title, count) {
    this.ensure(120); this.gap(this.y === this.top ? 0 : 18);
    this.page.text(this.f.semibold, 8.5, this.mx, this.y - 8, eyebrow.toUpperCase(), C.gold, { spacing: 1.3 });
    this.y -= 24;
    const t = count ? `${title} · ${count}` : title;
    this.page.text(this.f.semibold, 16, this.mx, this.y - 12, t, C.text);
    this.y -= 28;
  }
  para(text, { size = 10.5, color = C.text, font = this.f.regular, lh = 1.5, after = 6, x = this.mx, width = this.cw } = {}) {
    const lines = wrap(font, size, text, width); const step = size * lh;
    for (const line of lines) { this.ensure(step); this.page.text(font, size, x, this.y - size, line, color); this.y -= step; }
    this.y -= after;
  }
  /* строка «подпись — значение» */
  kv(label, value) {
    if (!value) return;
    const lw = 128, vx = this.mx + lw, lines = wrap(this.f.regular, 10.5, String(value), this.cw - lw), h = Math.max(1, lines.length) * 15.5;
    this.ensure(h);
    this.page.text(this.f.regular, 9.5, this.mx, this.y - 10.5, label, C.muted);
    lines.forEach((l, i) => this.page.text(this.f.regular, 10.5, vx, this.y - 11 - i * 15.5, l, C.text));
    this.y -= h + 4;
  }
  /* карточка: подпись мелким, заголовок, текст; высокая карточка делится по страницам */
  card({ meta = '', title = '', answer = '', text = '', note = '', titleColor = C.text }) {
    const pad = 12, size = 10.5, lh = 15.5, w = this.cw - pad * 2;
    const rows = [];
    if (meta) rows.push({ t: meta, font: this.f.regular, size: 8.5, color: C.faint, h: 12, spacing: 0.3 });
    if (title) for (const l of wrap(this.f.semibold, 11.5, title, w)) rows.push({ t: l, font: this.f.semibold, size: 11.5, color: titleColor, h: 16 });
    if (answer) for (const l of wrap(this.f.semibold, 10.5, answer, w)) rows.push({ t: l, font: this.f.semibold, size: 10.5, color: C.gold2, h: 15 });
    if (text) for (const l of wrap(this.f.regular, size, text, w)) rows.push({ t: l, font: this.f.regular, size, color: C.text, h: lh });
    if (note) for (const l of wrap(this.f.regular, 9.5, note, w)) rows.push({ t: l, font: this.f.regular, size: 9.5, color: C.muted, h: 13.5 });
    if (!rows.length) return;
    const total = rows.reduce((s, r) => s + r.h, 0) + pad * 2;
    if (this.page && this.y - total < this.bottom && this.y - this.bottom < Math.min(total, 96)) this.newPage();   /* не начинать карточку парой строк у самого низа */
    let i = 0;
    while (i < rows.length) {
      this.ensure(Math.min(rows[i].h + pad * 2, 60));
      const avail = this.y - this.bottom - pad * 2; let h = 0, j = i;
      while (j < rows.length && h + rows[j].h <= avail) { h += rows[j].h; j++; }
      if (j === i) { j = i + 1; h = rows[i].h; }
      this.page.panel(this.mx, this.y - h - pad * 2, this.cw, h + pad * 2, { radius: 10, fill: C.panel, fillAlpha: 0.055, stroke: C.line, strokeAlpha: 0.12 });
      let ty = this.y - pad;
      for (let k = i; k < j; k++) { const r = rows[k]; this.page.text(r.font, r.size, this.mx + pad, ty - r.size + (r.h - r.size) / 2 - 1, r.t, r.color, { spacing: r.spacing || 0 }); ty -= r.h; }
      this.y -= h + pad * 2 + 8; i = j;
      if (i < rows.length) this.newPage();
    }
  }
  /* плотный список коротких строк с точкой-маркером */
  bullets(items, { size = 10.5 } = {}) {
    for (const it of items) {
      const lines = wrap(this.f.regular, size, it, this.cw - 14), step = size * 1.45;
      this.ensure(step * lines.length);
      this.page.circle(this.mx + 3, this.y - size * 0.62, 1.6, C.gold, 0.9);
      lines.forEach((l, i) => this.page.text(this.f.regular, size, this.mx + 14, this.y - size - i * step, l, C.text));
      this.y -= step * lines.length + 3;
    }
    this.y -= 4;
  }
  empty(text) { this.para(text, { color: C.faint, size: 10, after: 8 }); }
}

/* Точка входа: данные personalExport + подписи для кодов → Buffer с PDF */
export function personalExportPdf(data, { moodName = (m) => m, topicTitle = (k) => k, reminderTitle = (k) => k, toolTitle = (k) => k, headerPng = null } = {}) {
  const doc = new PdfDocument({ title: 'Лунарио — мои данные' });
  const F = { regular: doc.addFont(fonts().regular), semibold: doc.addFont(fonts().semibold) };
  const flow = new Flow(doc, F);
  const p = data.profile || {};
  const name = (p.name || '').trim();

  /* ── обложка: логотип, заголовок, дата выгрузки ── */
  const page = flow.newPage();
  let y = flow.top + 6;
  if (headerPng) {
    try { const img = doc.addImage(headerPng, { half: true }); const w = 300, h = w * img.height / img.width; page.image(img, (flow.W - w) / 2, y - h, w, h); y -= h - 6; } catch { y -= 20; }
  } else y -= 20;
  const center = (font, size, text, yy, color, spacing = 0) => page.text(font, size, (flow.W - font.width(text, size, spacing)) / 2, yy, text, color, { spacing });
  center(F.semibold, 8.5, 'МОИ ДАННЫЕ', y - 8, C.gold, 1.6); y -= 30;
  center(F.semibold, 24, 'Всё, что хранит Лунарио', y - 18, C.text); y -= 36;
  const when = fmtDay((data.exportedAt || new Date().toISOString()).slice(0, 10));
  center(F.regular, 11, [name, `выгрузка от ${when}`].filter(Boolean).join(' · '), y - 10, C.muted); y -= 30;
  flow.y = y;
  flow.para('Здесь всё, что вы доверили приложению: анкета, записи дневника, желания, привычки и аскезы, настроения, вопросы с ответами и настройки. На сервере личные тексты хранятся зашифрованными — этот файл их расшифрованная копия, берегите его как бумажный дневник.', { size: 10.5, color: C.muted, lh: 1.55, after: 10 });

  /* ── профиль ── */
  flow.section('Профиль', 'Обо мне');
  if (p.photo && /^data:image\/jpeg;base64,/.test(p.photo)) {
    try {
      const img = doc.addImage(Buffer.from(p.photo.split(',')[1], 'base64')); const s = 56;
      flow.ensure(s + 8); flow.page.image(img, flow.mx, flow.y - s, s, s, { clipCircle: true });
      flow.page.text(F.semibold, 14, flow.mx + s + 14, flow.y - 22, name || 'Без имени', C.text);
      flow.page.text(F.regular, 10.5, flow.mx + s + 14, flow.y - 40, [p.birth ? fmtDay(p.birth) : '', p.city].filter(Boolean).join(' · '), C.muted);
      flow.y -= s + 14;
    } catch { /* фото не в JPEG — обойдёмся строками */ }
  }
  flow.kv('Имя', name);
  flow.kv('Дата рождения', p.birth ? fmtDay(p.birth) + (p.birthTime ? `, ${p.birthTime}` : '') : '');
  flow.kv('Город', p.city);
  flow.kv('Почта', p.email);
  flow.kv('Фото', p.photo ? 'загружено' : '');

  /* ── настройки ── */
  const pr = data.preferences || {};
  flow.section('Приложение', 'Настройки');
  flow.kv('Оформление', THEME[pr.theme] || pr.theme || '');
  flow.kv('Мои инструменты', Array.isArray(pr.tools) ? (pr.tools.length ? pr.tools.map(toolTitle).join(', ') : 'только стартовый набор') : 'стартовый набор');
  flow.kv('Настройка контента', pr.topicsAll ? 'показывать всё' : (pr.topics || []).length ? pr.topics.map(topicTitle).join(', ') : 'как предложено');
  const rem = (data.reminders || []).filter((r) => r.enabled);
  flow.kv('Напоминания', rem.length ? rem.map((r) => `${reminderTitle(r.feature)} — ${r.time || ''}${r.freq === 'weekly' ? `, ${WEEKDAYS[r.weekday] || 'раз в неделю'}` : r.freq && r.freq !== 'daily' ? `, ${FREQ[r.freq] || r.freq}` : ''}`).join('; ') : 'выключены');

  /* ── дневник ── */
  const journal = [...(data.journal || [])].sort((a, b) => (b.day || '').localeCompare(a.day || '') || b.id - a.id);
  flow.section('Дневник', 'Записи', journal.length ? plural(journal.length, 'запись', 'записи', 'записей') : '');
  if (!journal.length) flow.empty('Записей пока не было.');
  for (const j of journal) flow.card({ meta: [fmtDay(j.day), JOURNAL_KIND[j.kind]].filter(Boolean).join(' · '), title: j.kind === 'answer' && j.title ? j.title : '', text: j.text });

  /* ── желания ── */
  const wishes = data.wishes || [];
  flow.section('Дневник', 'Мои желания', wishes.length ? plural(wishes.length, 'желание', 'желания', 'желаний') : '');
  if (!wishes.length) flow.empty('Желаний пока не записано.');
  else flow.bullets(wishes.map((w) => `${w.text}${w.done ? ` — исполнено${w.done_ts ? ' ' + fmtDay(w.done_ts.slice(0, 10)) : ''}` : ''}${w.photo ? ' · с фото' : ''}`));

  /* ── привычки ── */
  const habits = data.habits || [];
  flow.section('Практики', 'Дневник привычек', habits.length ? plural(habits.length, 'привычка', 'привычки', 'привычек') : '');
  if (!habits.length) flow.empty('Привычек пока нет.');
  for (const h of habits) {
    const marks = h.marks || [];
    flow.card({ meta: [`с ${fmtDay((h.created_at || '').slice(0, 10))}`, h.archived ? 'в архиве' : ''].filter(Boolean).join(' · '), title: h.title,
      text: [h.rule_text ? `Ритм: ${h.rule_text}.` : '', marks.length ? `Отметок: ${marks.length}, с ${fmtDay(marks[0])} по ${fmtDay(marks[marks.length - 1])}.` : 'Отметок пока не было.'].filter(Boolean).join(' ') });
  }

  /* ── аскезы ── */
  const askesis = data.askesis || [];
  flow.section('Практики', 'Аскезы', askesis.length ? plural(askesis.length, 'аскеза', 'аскезы', 'аскез') : '');
  if (!askesis.length) flow.empty('Аскез пока не было.');
  for (const a of askesis) {
    const obs = a.observations || [], kept = obs.filter((o) => o.kept).length, notes = obs.filter((o) => o.note).map((o) => `${fmtDay(o.day)} — ${o.note}`);
    flow.card({ meta: [`${fmtDay(a.started)} → ${fmtDay(a.until)}`, `${a.days} дн.`, ASK_STATUS[a.status] || a.status].filter(Boolean).join(' · '), title: a.title,
      text: obs.length ? `Отмечено дней: ${obs.length}, из них выдержано ${kept}.` : 'Отметок пока не было.', note: notes.join('\n') });
  }

  /* ── настроения ── */
  const moods = [...(data.moods || [])].sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  flow.section('Дневник', 'Настроение по дням', moods.length ? plural(moods.length, 'отметка', 'отметки', 'отметок') : '');
  if (!moods.length) flow.empty('Настроение пока не отмечалось.');
  else flow.bullets(moods.map((m) => `${fmtDay(m.day)} — ${moodName(m.mood)}`), { size: 10 });

  /* ── вопросы и ответы ── */
  const entries = [...(data.entries || [])].sort((a, b) => (b.day || '').localeCompare(a.day || '') || b.id - a.id);
  flow.section('Свериться с собой', 'Вопросы и ответы', entries.length ? plural(entries.length, 'обращение', 'обращения', 'обращений') : '');
  if (!entries.length) flow.empty('Обращений пока не было.');
  for (const e of entries) flow.card({ meta: [fmtDay(e.day), KIND[e.kind] || e.kind].filter(Boolean).join(' · '), title: e.question || (e.title || ''), answer: e.question ? (e.title || '') : '', text: e.body || '' });

  /* ── установки дня ── */
  const sets = [...(data.dailySets || [])].sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  flow.section('Сегодня', 'Настрой дня', sets.length ? plural(sets.length, 'день', 'дня', 'дней') : '');
  if (!sets.length) flow.empty('Установок пока не было.');
  for (const s of sets) flow.card({ meta: fmtDay(s.day), text: s.text, note: s.question });

  /* ── что отозвалось ── */
  const echoes = [...(data.echoes || [])].sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  if (echoes.length) { flow.section('Дневник', 'Что отозвалось', plural(echoes.length, 'отметка', 'отметки', 'отметок')); flow.bullets(echoes.map((e) => `${fmtDay(e.day)} — ${ECHO[e.verdict] || e.verdict}`), { size: 10 }); }

  flow.finish();
  return doc.build();
}
