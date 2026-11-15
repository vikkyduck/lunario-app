/* Реестр функций приложения — одно место для клиента и сервера: backend/features.json.
   Клиент получает его с /api/me (FEATURES в app.js), сервер — отсюда: группы для картинок в кабинете (workspace),
   названия в журнале событий (events). Переименовать функцию = одна правка в json. */
import { readFileSync } from 'node:fs';
export const FEATURES = JSON.parse(readFileSync(new URL('./features.json', import.meta.url), 'utf8'));
export const featureTitle = (key, fallback = key) => (FEATURES[key] && FEATURES[key].title) || fallback;
/* [[«Раздел», [[ключ, подпись], …]], …] — функции, к которым в кабинете можно прикрепить картинку (у них есть group) */
export const FEATURE_GROUPS = (() => {
  const order = ['Сегодня', 'Дневник', 'Свериться с собой', 'Обо мне', 'Аккаунт'], out = new Map(order.map((g) => [g, []]));
  for (const [key, f] of Object.entries(FEATURES)) if (f.group) (out.get(f.group) || out.set(f.group, []).get(f.group)).push([key, f.art || f.title]);
  return [...out].filter(([, items]) => items.length);
})();
