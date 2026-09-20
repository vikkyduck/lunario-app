/* Часы приложения (ревью v114, F13): момент и календарный день — разные вещи с разными именами, а выбор пояса — в одном месте.
   · момент — миллисекунды UTC (Date.now(), created_at, ts): одинаков для всех;
   · день человека (userDay) — календарная дата ГГГГ-ММ-ДД в его поясе: пояс устройства (заголовок X-Tz, запоминается в
     preferences.tz) → пояс города из анкеты → Москва. Все личное — настрой, карта, записи, неделя, привычки — считается этим днем;
   · localMoment — обратный переход: день и время по стенным часам пояса → момент UTC (лунные дни, границы суток).
   Поведение при путешествии: текущий день — по поясу устройства сейчас; расписание привычки — от сохраненного start_day
   (день человека в момент создания), пояс создания (habits.tz) прошлые дни не пересчитывает: то, что уже отмечено, остается
   отмеченным своим днем. Раньше userTz/userDay жили в server.mjs, userDayOf — в reminders.mjs, at() — дважды в server.mjs. */
import { preferences } from './experience.mjs';
import { tzOffsetMinutes } from './cities.mjs';
import { MSK, dayIn } from './util.mjs';

const tzOk = new Map();
export function validTz(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z][\w+\-/]{1,60}$/.test(tz)) return false;
  if (!tzOk.has(tz)) { try { new Intl.DateTimeFormat('ru-RU', { timeZone: tz }); tzOk.set(tz, true); } catch { tzOk.set(tz, false); } }
  return tzOk.get(tz);
}
/* пояс человека: устройство → город анкеты → Москва */
export const userTz = (u) => { const p = u ? preferences(u.preferences) : {}; return validTz(p.tz) ? p.tz : validTz(u?.tz) ? u.tz : MSK; };
/* календарный день человека в момент atMs (по умолчанию — сейчас) */
export const userDay = (u, atMs = Date.now()) => dayIn(userTz(u), atMs);
/* момент UTC (мс) для дня и времени ЧЧ:ММ по стенным часам пояса */
export const localMoment = (day, hm, tz) => { const local = `${day}T${hm}:00`; return Date.parse(local + 'Z') - tzOffsetMinutes(tz, local) * 60000; };
