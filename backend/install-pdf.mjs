/* Памятка «Как установить Лунарио на телефон» в PDF — /app/install.pdf. Текст тот же, что на странице
   /app/install (backend/install-guide.mjs), оформление то же, что у «Скачать мои данные»: ночной фон, логотип с
   Луной, золотые подписи разделов, нумерованные шаги и стеклянные карточки. Собирается pdf.mjs без зависимостей,
   шрифт Onest встраивается — файл выглядит одинаково на телефоне, компьютере и на бумаге. */
import { PdfDocument } from './pdf.mjs';
import { Flow, C, fonts } from './personal-export-pdf.mjs';
import { GUIDE, APP_URL } from './install-guide.mjs';

/* headerPng — site/assets/mail/header.png (логотип), iconPng — site/assets/apple-touch-icon.png (какой будет иконка) */
export function installPdf({ headerPng = null, iconPng = null } = {}) {
  const g = GUIDE;
  const doc = new PdfDocument({ title: g.title });
  const F = { regular: doc.addFont(fonts().regular), semibold: doc.addFont(fonts().semibold) };
  const flow = new Flow(doc, F, { running: 'Лунарио · Установка на телефон' });

  /* ── обложка: логотип, подпись, заголовок, вступление ── */
  const page = flow.newPage();
  let y = flow.top + 6;
  if (headerPng) {
    try { const img = doc.addImage(headerPng, { half: true }); const w = 300, h = w * img.height / img.width; page.image(img, (flow.W - w) / 2, y - h, w, h); y -= h - 6; } catch { y -= 20; }
  } else y -= 20;
  const center = (font, size, text, yy, color, spacing = 0) => page.text(font, size, (flow.W - font.width(text, size, spacing)) / 2, yy, text, color, { spacing });
  center(F.semibold, 8.5, g.eyebrow.toUpperCase(), y - 8, C.gold, 1.6); y -= 30;
  center(F.semibold, 24, g.title, y - 18, C.text); y -= 40;
  flow.y = y;
  flow.para(g.lead, { size: 10.5, color: C.muted, lh: 1.55, after: 6 });

  /* адрес приложения — крупно, чтобы набрать с бумаги */
  flow.ensure(58);
  flow.page.panel(flow.mx, flow.y - 46, flow.cw, 46, { radius: 10, fill: C.gold, fillAlpha: 0.08, stroke: C.gold, strokeAlpha: 0.35 });
  flow.page.text(F.regular, 8.5, flow.mx + 14, flow.y - 16, 'АДРЕС ПРИЛОЖЕНИЯ', C.gold, { spacing: 1.3 });
  flow.page.text(F.semibold, 15, flow.mx + 14, flow.y - 36, APP_URL, C.text);
  if (iconPng) {
    try { const img = doc.addImage(iconPng); const s = 30; flow.page.image(img, flow.mx + flow.cw - s - 8, flow.y - 38, s, s); } catch { /* без иконки страница не хуже */ }
  }
  flow.y -= 46 + 10;

  /* ── платформы: шаги и заметка ── */
  for (const p of g.platforms) {
    flow.section(p.browser, p.name);
    flow.steps(p.steps);
    if (p.note) flow.card({ text: p.note });
  }

  /* ── что изменится ── */
  flow.section('После установки', g.after.title);
  flow.bullets(g.after.items, { size: 10.5 });

  /* ── вопросы ── */
  flow.section('Помощь', g.faq.title);
  for (const f of g.faq.items) flow.card({ title: f.q, text: f.a });
  flow.para(g.support, { size: 10, color: C.muted, lh: 1.5, after: 4 });
  flow.para(`Эта инструкция онлайн: ${APP_URL}/install`, { size: 9.5, color: C.faint, lh: 1.5 });

  flow.finish();
  return doc.build();
}
