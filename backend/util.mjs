/* Общие мелочи бэкенда — одно место вместо копий в server.mjs, reminders.mjs, knowledge.mjs, practices.mjs, reports.mjs,
   workspace.mjs и cabinet.mjs: московский день, координаты по умолчанию, проверка даты, сдвиг дня, склонение. */
export const MSK = 'Europe/Moscow';
/* Без координат в анкете считаем по Москве — как и все время в приложении */
export const MOSCOW = { lat: 55.7558, lon: 37.6173 };
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/* Настоящая календарная дата: форма ГГГГ-ММ-ДД и обратная сверка года, месяца и дня — «2026-02-31» не проходит,
   29 февраля — только в високосный год (аудит v98, F14). Одна проверка на все маршруты с датами. */
export const isDay = (s) => { if (!ISO_DAY.test(s || '')) return false; const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
/* Календарный день ГГГГ-ММ-ДД в часовом поясе; без аргументов — «сегодня» по Москве, как у сервера */
export const dayIn = (tz = MSK, ms = Date.now()) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz });
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const plural = (n, one, few, many) => { const m = n % 100; if (m >= 11 && m <= 14) return many; const l = n % 10; return l === 1 ? one : l >= 2 && l <= 4 ? few : many; };
/* Адреса и почта в тексте, которые стоит сделать ссылками (страница и PDF инструкции, выгрузка): знак препинания после адреса — не его часть */
export const LINK_RE = /https?:\/\/[^\s«»"()]+|[\w.+-]+@lunario\.online|lunario\.online(?:\/[\w./-]*)?/g;
export const trimLink = (m) => m.replace(/[.,;:!?]+$/, '');
export const linkTarget = (t) => t.includes('@') ? 'mailto:' + t : t.startsWith('http') ? t : 'https://' + t;

/* Угол в градусах в [0, 360) — астрономия (astro, lunar, sky) */
export const norm360 = (x) => ((x % 360) + 360) % 360;
/* Строка от человека: однострочная (управляющие символы — в пробел) и многострочная (абзацы остаются) — с ограничением длины */
export const clean = (s, max) => String(s ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
export const cleanText = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
/* «3 дня»: число и слово вместе */
export const countWord = (n, one, few, many) => `${n} ${plural(Math.abs(n), one, few, many)}`;
