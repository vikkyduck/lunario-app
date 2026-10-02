/* Canonical, complete history. No 120-day cutoff, credentials, photo bytes or analytics.
   Source kinds keep a user's words separate from symbolic interpretations and AI text. */
import { createHash } from 'node:crypto';
import { personalExport } from './personal-export.mjs';
export const digest = (s) => createHash('sha256').update(s).digest('hex');
export function splitText(text, size = 650, overlap = 100) {
  const out = []; text = String(text || '').trim();
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) { const cut = text.lastIndexOf(' ', end); if (cut > start + 500) end = cut; }
    out.push(text.slice(start, end)); if (end === text.length) break; start = end - overlap;
  }
  return out;
}
export function collectRagSources({ db, user, open, profile }) {
  const x = personalExport(db, user, open), out = [];
  const add = (key, label, kind, day, text) => { if (text?.trim()) out.push({ key, label, kind, day: day || '', text: text.trim() }); };
  add('profile', 'Анкета', 'profile', '', [`Имя: ${user.name || 'не указано'}`, `Дата рождения: ${user.birth || 'не указана'}`, `Время рождения: ${user.birth_time || 'не указано'}`, `Город: ${user.city || 'не указан'}`, `Предпочтения: ${JSON.stringify(x.preferences)}`].join('\n'));
  if (profile?.natal) {
    const n = profile.natal;
    add('natal:precision', 'Точность натальной карты', 'calculation', '', `Время рождения ${n.timeKnown ? 'известно' : 'неизвестно'}. Место ${n.hasPlace ? 'определено' : 'не определено'}. ${n.moonUncertain ? 'Положение Луны может быть неточным.' : ''} Зодиак: ${n.zodiac || ''}. Система домов: ${n.houseSystem || 'не определена'}.`);
    for (const p of n.planets || []) add(`natal:${p.key}`, `Натальная карта: ${p.name || p.key}`, 'astrology', '', `${p.name} ${p.signIn || 'в ' + p.sign}, ${p.degree}${p.house ? ', дом ' + p.house : ''}${p.retro ? ', ретроградная' : ''}.\n${n.timeKnown ? '' : 'Время рождения неизвестно. Дома и Асцендент не определены. '}Символическая трактовка, не свидетельство поведения: ${p.inSign?.text || ''}\n${p.inHouse?.text || ''}`);
    add('natal:houses', 'Дома натальной карты', 'calculation', '', n.houses ? `Асцендент: ${n.houses.asc.sign} ${n.houses.asc.degree}. MC: ${n.houses.mc.sign} ${n.houses.mc.degree}.\n${n.houses.cusps.map(h => 'Дом ' + h.house + ': ' + h.sign + ' ' + h.degree).join('\n')}` : 'Дома не определены: не хватает точного времени или места рождения.');
    for (const [i, a] of (n.aspects || []).entries()) add(`aspect:${i}`, 'Аспект натальной карты', 'astrology', '', `${a.a} ${a.aspect} ${a.b}, орб ${a.orb}. ${a.meaning?.text || ''}`);
  }
  if (profile?.lunarBirth) add('lunar-birth', 'Лунный день рождения', 'calculation', '', `${profile.lunarBirth.n}-й лунный день: ${profile.lunarBirth.title || ''}${profile.lunarBirth.uncertain ? '. Приблизительно: время рождения неизвестно.' : ''}`);
  if (profile?.numerology) add('numerology', 'Нумерология', 'astrology', '', `Символическая трактовка: число судьбы ${profile.numerology.destiny.n}. ${profile.numerology.destiny.text} Личный год: ${profile.numerology.year.n}. ${profile.numerology.year.text}`);
  for (const r of x.journal) if (!r.unreadable) add(`journal:${r.id}`, r.kind === 'answer' ? 'Ответ на вопрос дня' : r.kind === 'gratitude' ? 'Благодарность' : r.kind === 'weekly' ? 'Итоги недели' : 'Дневник', 'user_statement', r.day, [r.title, r.thought && JSON.stringify(r.thought), r.text].filter(Boolean).join('\n'));
  for (const r of x.wishes) if (!r.unreadable) add(`wish:${r.id}`, 'Желание', 'user_statement', r.ts.slice(0, 10), `${r.text}\n${r.done ? 'Отмечено исполненным' : 'Еще не отмечено исполненным'}`);
  for (const r of x.entries) if (!r.unreadable) add(`entry:${r.id}`, 'Вопрос и расклад', 'reading', r.day, `Вопрос пользователя: ${r.question || 'без вопроса'}\nСимволический результат (${r.kind}): ${r.title}\n${r.body}`);
  for (const r of x.compat) add(`compat:${r.id}`, 'Расчет совместимости', 'astrology', r.day, `Дата партнера: ${r.other_birth}\n${r.text || ''}\nСимволическая трактовка, не сведения о реальных отношениях.`);
  for (const r of x.moods) add(`mood:${r.day}`, 'Настроение', 'user_observation', r.day, JSON.stringify(r));
  for (const r of x.habits) if (!r.unreadable) {
    add(`habit:${r.id}`, 'Привычка', 'user_statement', r.created_at.slice(0, 10), `${r.title}\nПравило: ${r.rule} ${r.rule_text || ''}\nАрхив: ${!!r.archived}`);
    for (const day of r.marks) add(`habit:${r.id}:${day}`, 'Отметка привычки', 'user_observation', day, `${r.title}: выполнено`);
  }
  for (const r of x.askesis) if (!r.unreadable) {
    add(`askesis:${r.id}`, 'Аскеза', 'user_statement', r.started, `${r.title}\nДо: ${r.until}. Статус: ${r.status}`);
    for (const d of r.observations) add(`askesis:${r.id}:${d.day}`, 'Наблюдение об аскезе', 'user_observation', d.day, `${r.title}: ${d.kept ? 'соблюдено' : 'не соблюдено'}\n${d.note || ''}`);
  }
  for (const r of x.dailySets) add(`daily:${r.day}`, 'Настрой и вопрос дня', 'editorial', r.day, `${r.text || ''}\n${r.question || ''}`);
  for (const r of x.echoes) add(`echo:${r.day}`, 'Отклик на день', 'user_observation', r.day, `Отметка пользователя: ${r.verdict}`);
  for (const r of x.ragTurns || []) add(`conversation:${r.id}`, 'Вопрос Лунарио', 'user_question', r.day, r.question);
  return out;
}
export function chunkSources(namespace, sources) {
  return sources.flatMap(s => splitText(s.text).map((body, i) => {
    const text = [s.label, s.day, `Тип: ${s.kind}`, body].filter(Boolean).join('\n');
    return { ...s, text, id: digest(`${namespace}\n${s.key}\n${i}\n${text}`) };
  }));
}
