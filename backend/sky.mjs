/* «На небе»: что происходит сейчас и что будет в ближайшие недели.
   Фазы Луны и затмения — по Меёсу (lunar.mjs), планеты — из astro.mjs (JPL-таблица или кеплеровы элементы).
   Затмение определяется по близости Солнца к лунному узлу в новолуние/полнолуние: это надёжный
   астрономический признак, но без расчёта видимости из конкретного города. Тексты — опора, не прогноз. */
import { skyAt, ASPECT_LIST, SIGNS } from './astro.mjs';
import { moonPhasesBetween, moonState } from './lunar.mjs';

const norm = (x) => ((x % 360) + 360) % 360;
const DAY = 864e5;
const signOf = (lon) => SIGNS[Math.floor(norm(lon) / 30)];
/* предложный падеж: «в Весах», «в Рыбах» */
const SIGN_IN = { Овен: 'в Овне', Телец: 'в Тельце', Близнецы: 'в Близнецах', Рак: 'в Раке', Лев: 'во Льве', Дева: 'в Деве', Весы: 'в Весах', Скорпион: 'в Скорпионе', Стрелец: 'в Стрельце', Козерог: 'в Козероге', Водолей: 'в Водолее', Рыбы: 'в Рыбах' };
export const inSign = (s) => SIGN_IN[s] || `в ${s}`;

const PHASE_TEXT = {
  new: ['Новолуние', 'Хорошее время для намерений и первого малого шага. Не требуйте от себя больших сил — они придут с ростом Луны.'],
  q1: ['Первая четверть', 'Момент усилия: то, что задумали в новолуние, просит первого действия. Сопротивление сейчас — это нормально.'],
  full: ['Полнолуние', 'Чувства громче обычного, сон чутче. Завершайте и отпускайте, а новое не начинайте сгоряча.'],
  q3: ['Последняя четверть', 'Время подвести итог и убрать лишнее перед новым кругом. Хорошо отдыхать и наводить порядок.'],
};
const ECLIPSE_TEXT = {
  solar: ['Солнечное затмение', 'Поворотная точка, которая отзывается месяцами. Важные решения лучше принять за несколько дней до или после, а не в этот день.'],
  lunar: ['Лунное затмение', 'Обостряет то, что давно просилось наружу — в чувствах и отношениях. Берегите силы и сон, не ищите выяснений.'],
};
/* планета: имя, «ретроградный/ая», «директный/ая», совет на период, совет на выход */
const RETRO = {
  mercury: ['Меркурий', 'ретроградный', 'директный', 'Перепроверяйте договорённости, письма, билеты и технику. Хорошо возвращаться к старому, хуже — подписывать новое.', 'Можно снова договариваться, покупать технику и запускать отложенное.'],
  venus: ['Венера', 'ретроградная', 'директная', 'Возвращаются старые чувства и вопросы о том, что для вас ценно. Не время резких перемен во внешности и отношениях.', 'Отношения и деньги возвращаются в обычный ритм — можно решать то, что откладывали.'],
  mars: ['Марс', 'ретроградный', 'директный', 'Сил меньше, раздражения больше. Не форсируйте, доделывайте начатое и берегите тело.', 'Энергия возвращается — хорошее время начинать и действовать прямо.'],
  jupiter: ['Юпитер', 'ретроградный', 'директный', 'Рост замедляется, чтобы вы пересмотрели, куда идёте. Учёба и планы — внутрь, а не наружу.', 'Возможности снова открываются — смотрите шире.'],
  saturn: ['Сатурн', 'ретроградный', 'директный', 'Проверка на прочность: структуры и обязательства просят пересмотра. Не бросайте, но и не берите нового груза.', 'Порядок возвращается: то, что выдержало проверку, можно строить дальше.'],
};
const SEASON = {
  Овен: 'Начинается месяц действия и смелости: хорошо стартовать и говорить прямо.', Телец: 'Месяц устойчивости: тело, деньги, удовольствие и медленный рост.',
  Близнецы: 'Месяц разговоров, встреч и учёбы: слова весят больше.', Рак: 'Месяц дома и чувств: берегите своих и себя.',
  Лев: 'Месяц света и творчества: разрешите себе быть видимой.', Дева: 'Месяц порядка и заботы о деталях: наводите чистоту в делах и в теле.',
  Весы: 'Месяц отношений и равновесия: договаривайтесь и выбирайте красивое.', Скорпион: 'Месяц глубины: то, что скрыто, просится наружу. Не бойтесь честности.',
  Стрелец: 'Месяц горизонта: учёба, дорога, смысл. Смотрите дальше привычного.', Козерог: 'Месяц целей и ответственности: строить долго и всерьёз.',
  Водолей: 'Месяц свободы и друзей: ищите своё, не оглядываясь.', Рыбы: 'Месяц тишины и интуиции: отдыхайте, слушайте, завершайте круг.',
};

/* События в интервале: фазы, затмения, ретроградность, вход Солнца в знак. Отсортированы по времени. */
export function skyEvents(fromMs, days = 60) {
  const toMs = fromMs + days * DAY;
  const out = [];
  for (const p of moonPhasesBetween(fromMs, toMs)) {
    const sign = signOf(p.moonLon);
    const [title, note] = PHASE_TEXT[p.phase];
    out.push({ at: new Date(p.at).toISOString(), type: p.phase, title: `${title} ${inSign(sign)}`, note });
    if (p.phase === 'new' || p.phase === 'full') {
      const node = skyAt(p.at).node.lon;
      const x = norm(p.sunLon - node), d = Math.min(x, 360 - x, Math.abs(x - 180));
      const kind = p.phase === 'new' ? (d < 15.4 ? 'solar' : null) : (d < 12 ? 'lunar' : null);
      if (kind) { const [t, n] = ECLIPSE_TEXT[kind]; out.push({ at: new Date(p.at).toISOString(), type: 'eclipse', title: `${t} ${inSign(sign)}`, note: n }); }
    }
  }
  /* ретроградность и вход Солнца в знак — по дням, момент перемены уточняется делением отрезка */
  const when = (t0, t1, changed) => { for (let i = 0; i < 16; i++) { const m = (t0 + t1) / 2; if (changed(skyAt(m))) t1 = m; else t0 = m; } return t1; };
  let prev = skyAt(fromMs - DAY), tPrev = fromMs - DAY;
  for (let t = fromMs; t <= toMs; t += DAY) {
    const cur = skyAt(t);
    for (const k of Object.keys(RETRO)) {
      if (!cur[k] || !prev[k] || cur[k].retro === prev[k].retro) continue;
      const [name, retroAdj, directAdj, startNote, endNote] = RETRO[k];
      const at = new Date(when(tPrev, t, (x) => x[k].retro === cur[k].retro)).toISOString();
      out.push(cur[k].retro
        ? { at, type: 'retro', planet: k, title: `${name} — ${retroAdj} ${inSign(cur[k].sign)}`, note: startNote }
        : { at, type: 'direct', planet: k, title: `${name} — снова ${directAdj}`, note: endNote });
    }
    if (cur.sun.signIndex !== prev.sun.signIndex) {
      const at = new Date(when(tPrev, t, (x) => x.sun.signIndex === cur.sun.signIndex)).toISOString();
      out.push({ at, type: 'ingress', title: `Солнце входит в знак ${cur.sun.sign}`, note: SEASON[cur.sun.sign] || '' });
    }
    prev = cur; tPrev = t;
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/* Сводка на сейчас: Луна, Солнце, ретроградные планеты, точные аспекты и события — сегодняшние и ближайшие. */
export function skyNow(ms = Date.now(), tz = 'Europe/Moscow') {
  const b = skyAt(ms);
  const m = moonState(ms);
  const phaseName = ['Новолуние', 'Растущий серп', 'Первая четверть', 'Растущая Луна', 'Полнолуние', 'Убывающая Луна', 'Последняя четверть', 'Старая Луна'][Math.floor(((m.cycle + 1 / 16) % 1) * 8)];
  const retro = Object.keys(RETRO).filter((k) => b[k] && b[k].retro).map((k) => ({ key: k, name: b[k].name, symbol: b[k].symbol, sign: b[k].sign, adj: RETRO[k][1], note: RETRO[k][3] }));
  const keys = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
  const aspects = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const A = b[keys[i]], B = b[keys[j]]; if (!A || !B) continue;
    const d = Math.abs(norm(A.lon - B.lon + 180) - 180);
    for (const [key, name, angle, , sym] of ASPECT_LIST) { const off = Math.abs(d - angle); if (off <= 3) aspects.push({ a: A.name, b: B.name, aSym: A.symbol, bSym: B.symbol, name, symbol: sym, orb: Math.round(off * 10) / 10 }); }
  }
  aspects.sort((x, y) => x.orb - y.orb);
  const day = new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz });
  const events = skyEvents(ms - DAY, 62);
  const dayOf = (e) => new Date(e.at).toLocaleDateString('sv-SE', { timeZone: tz });
  return {
    date: day,
    moon: { phase: phaseName, illumination: m.illumination, waxing: m.waxing, sign: b.moon.sign, signIn: inSign(b.moon.sign), text: b.moon.text },
    sun: { sign: b.sun.sign, text: b.sun.text, season: SEASON[b.sun.sign] || '' },
    planets: ['mercury', 'venus', 'mars', 'jupiter', 'saturn'].filter((k) => b[k]).map((k) => ({ key: k, name: b[k].name, symbol: b[k].symbol, sign: b[k].sign, retro: b[k].retro })),
    retro, aspects: aspects.slice(0, 5),
    today: events.filter((e) => dayOf(e) === day),
    upcoming: events.filter((e) => dayOf(e) > day).slice(0, 10),
  };
}
