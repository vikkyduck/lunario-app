/* Общие мелочи бэкенда — одно место вместо копий в server.mjs, reminders.mjs, shelves.mjs, practices.mjs, reports.mjs,
   workspace.mjs и cabinet.mjs: московский день, координаты по умолчанию, проверка даты, сдвиг дня, склонение. */
export const MSK = 'Europe/Moscow';
/* Без координат в анкете считаем по Москве — как и всё время в приложении */
export const MOSCOW = { lat: 55.7558, lon: 37.6173 };
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/* Календарный день ГГГГ-ММ-ДД в часовом поясе; без аргументов — «сегодня» по Москве, как у сервера */
export const dayIn = (tz = MSK, ms = Date.now()) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz });
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const plural = (n, one, few, many) => { const m = n % 100; if (m >= 11 && m <= 14) return many; const l = n % 10; return l === 1 ? one : l >= 2 && l <= 4 ? few : many; };
