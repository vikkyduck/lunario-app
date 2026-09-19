/* Лунарио — статический контент приложения.
   Ступень А по бэклогу: тексты написаны заранее, генерация ИИ не нужна,
   предельная стоимость показа — ноль. Тон: опора, без гарантий и запугивания.

   ТЕКСТЫ ЖИВУТ В ПАПКЕ ../content — обычные текстовые файлы, которые правит
   владелец продукта без программиста. Здесь остаются запасные значения:
   если файла нет или строка испорчена, приложение возьмет их и продолжит
   работать, а в журнал напишет, что именно не прочиталось. */
import { readFileSync, writeFileSync, existsSync, statSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTENT_DIR = process.env.CONTENT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
/* Картинки лежат рядом с текстами, в папке картинки/: по-русски для владельца, по-английски в адресе.
   Приложение отдает их по /app/content/<вид>/<файл> — см. маршрут в server.mjs. */
export const IMAGE_DIRS = { tarot: 'таро', runes: 'руны', year: 'личный-год', lunar: 'лунные-дни' };
/* Фразы интерфейса, которые владелица правит сама (интерфейс.txt). Ключ — где фраза живет; значение — как в коде по умолчанию */
export const UI_DEFAULT = {
  'hello.claim': 'Пространство, где можно услышать себя', 'hello.ritual': 'Три минуты в день',
  'hello.morning': 'Утром', 'hello.morning_sub': 'настрой дня, пока варится кофе', 'hello.evening': 'Вечером', 'hello.evening_sub': 'пара фраз о том, что запомнилось',
  'hello.week': 'К воскресенью', 'hello.week_sub': 'Лунарио само соберет историю вашей недели', 'hello.cta': 'Открыть мой день',
  'hello.free': 'Карта дня, лунный день и дневник — бесплатно', 'hello.trust': 'Записи хранятся в России и видны только вам.',
  'onb.lead': 'Несколько слов о себе', 'onb.name': 'Как вас зовут?', 'onb.birth': 'Когда вы родились?', 'onb.time': 'Во сколько?', 'onb.city': 'Где вы родились?', 'onb.done': 'Почти готово',
  'onb.next': 'Дальше', 'onb.skip_time': 'Не знаю', 'onb.go': 'Открыть мой день',
  'home.evening_q': 'Что хочется сохранить из сегодняшнего дня?', 'home.evening_btn': 'Запомнить этот день', 'home.answer_btn': 'Ответить себе', 'home.answer_more': 'Продолжить',
  'home.natal_row': 'Натальная карта готова', 'home.tips_row': 'Как устроено приложение', 'home.morning_group': 'Мое утро', 'home.more_group': 'Еще про этот день',
  'diary.mood': 'Как вы сегодня?', 'diary.text': 'Что хочется оставить от этого дня?', 'diary.gratitude': 'Кому и за что вы сегодня благодарны?', 'diary.habits': 'Привычки сегодня', 'diary.askesis': 'Аскеза',
  'diary.save': 'Запомнить этот день', 'diary.done': 'День записан ✦', 'diary.night': 'Спокойной ночи ✦', 'diary.day': 'Хорошего дня ✦', 'diary.practices': 'Практики', 'diary.past': 'Прошлые дни', 'diary.archive': 'Архив →',
  'thought.q': 'Что в этом относится к моей ситуации?', 'thought.save': 'Сохранить мысль', 'thought.mine': 'Моя мысль',
  'nav.today': 'Сегодня', 'nav.diary': 'Дневник', 'nav.ask': 'Свериться с собой', 'nav.about': 'Обо мне',
  'ask.title': 'Свериться с собой', 'ask.caption': 'Карты, руны, вопросы', 'about.title': 'Обо мне',
  'card.pick': 'Выберите карту', 'rune.pick': 'Выберите руну', 'card.question': 'Вопрос себе', 'card.today': 'Сегодня',
  'return': '← Вернуться', 'back': '← Назад',
};
/* адрес картинки с версией по времени файла: заменили картинку в кабинете — у людей обновится сразу, а неизменная кэшируется навсегда */
const img = (kind, file) => {
  if (!file) return '';
  let v = '1';
  try { v = Math.floor(statSync(join(CONTENT_DIR, 'картинки', IMAGE_DIRS[kind] || kind, file)).mtimeMs / 1000).toString(36); } catch { /* файла нет — адрес все равно отдадим */ }
  return `/app/content/${kind}/${file}?v=${v}`;
};

/* Правило владелицы: в приложении нет буквы «е с точками» — и в файлах контента тоже. Файл пришел с ней (кабинет, rsync,
   правка на сервере) — при чтении переписывается без нее, и у людей тексты всегда через «е». Кабинет делает то же с материалами. */
export const noYo = (s) => String(s).replace(/\u0451/g, '\u0435').replace(/\u0401/g, '\u0415');   /* сама буква в коде не пишется — проверка check-yo */
const hasYo = (s) => /[\u0451\u0401]/.test(s);
function readWithoutYo(path) {   /* читает файл и заодно приводит его к правилу — имя говорит, что функция пишет на диск */
  const raw = readFileSync(path, 'utf8');
  if (!hasYo(raw)) return raw;
  const fixed = noYo(raw);
  try { writeFileSync(path, fixed, 'utf8'); } catch { /* нет прав на запись — покажем исправленный текст, файл останется как есть */ }
  return fixed;
}

/* Читает файл как таблицу: строка = запись, поля разделены «|».
   Пустые строки и строки с # пропускаются — там заметки для человека. */
function rows(file, minCols) {
  const path = join(CONTENT_DIR, file);
  if (!existsSync(path)) return null;
  const out = [];
  let skipped = 0;
  for (const raw of readWithoutYo(path).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('|').map((s) => s.trim());
    if (cols.length < minCols || cols.some((c, i) => i < minCols && !c)) { skipped++; continue; }
    out.push(cols);
  }
  if (skipped) console.log(`Тексты: в файле ${file} пропущено строк — ${skipped} (не хватает полей, разделенных «|»)`);
  return out.length ? out : null;
}
/* Файл, где каждая строка — просто фраза (аффирмации, вопросы дня). */
function lines(file) {
  const path = join(CONTENT_DIR, file);
  if (!existsSync(path)) return null;
  const out = readWithoutYo(path).split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  return out.length ? out : null;
}
const num = (v, d) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : d; };

/* Файл-«книга»: запись начинается со строки «=== Название», дальше короткие поля
   «поле: значение», затем разделы [Название] с абзацами (пустая строка — новый абзац).
   Так лежат карты Таро и руны: у них длинные тексты, в одну строку их не уложить. */
function book(file) {
  const path = join(CONTENT_DIR, file);
  if (!existsSync(path)) return null;
  const text = readWithoutYo(path);
  if (!/^=== /m.test(text)) return null;                 // старый строчный формат — не наш
  const out = [];
  let cur = null, sec = null, para = [];
  const flush = () => { if (cur && sec && para.length) (cur.sections[sec] ||= []).push(para.join(' ')); para = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    if (line.startsWith('=== ')) { flush(); cur = { name: line.slice(4).trim(), fields: {}, sections: {} }; out.push(cur); sec = null; continue; }
    if (!cur) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { flush(); sec = m[1].trim(); continue; }
    if (!line) { flush(); continue; }
    if (!sec) { const f = line.match(/^([^:]+):\s*(.*)$/); if (f) cur.fields[f[1].trim().toLowerCase()] = f[2].trim(); continue; }
    para.push(line);
  }
  flush();
  const ok = out.filter((e) => e.name);
  return ok.length ? ok : null;
}

/* Файл-«статья»: как книга, но текст раздела хранится построчно, со структурой — «## подзаголовок»,
   списки «- » и «1. » («  - » — вложенный), строки таблицы «| … |», выделения **жирный** и *курсив*.
   Так лежит личный год: длинное описание с таблицами, которое экран рисует как есть. */
function article(file) {
  const path = join(CONTENT_DIR, file);
  if (!existsSync(path)) return null;
  const out = [];
  let cur = null, sec = null;
  for (const raw of readWithoutYo(path).split('\n')) {
    const line = raw.replace(/\s+$/, ''), t = line.trim();
    if (!t) continue;
    if (t.startsWith('=== ')) { cur = { name: t.slice(4).trim(), fields: {}, sections: {} }; out.push(cur); sec = null; continue; }
    if (!cur) continue;
    const m = t.match(/^\[(.+)\]$/);
    if (m) { sec = m[1].trim(); continue; }
    if (t.startsWith('## ') && sec) { (cur.sections[sec] ||= []).push({ t: 'h', text: t.slice(3).trim() }); continue; }
    if (t.startsWith('#')) continue;
    if (!sec) { const f = t.match(/^([^:]+):\s*(.*)$/); if (f) cur.fields[f[1].trim().toLowerCase()] = f[2].trim(); continue; }
    const blocks = (cur.sections[sec] ||= []);
    if (t.startsWith('|')) { blocks.push({ t: 'tr', cells: t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) }); continue; }
    const li = line.match(/^(\s*)(?:-|(\d+)\.)\s+(.*)$/);
    if (li) { blocks.push({ t: 'li', n: li[2] ? Number(li[2]) : 0, lvl: li[1].length >= 2 ? 1 : 0, text: li[3].trim() }); continue; }
    blocks.push({ t: 'p', text: t });
  }
  const ok = out.filter((e) => e.name);
  return ok.length ? ok : null;
}

/* ── 22 старших аркана: имя · о чем карта · что сделать сегодня ── */

/* Коды карт — по ним история находит карту, даже если название поправили. Порядок — как в колоде. */
const TAROT_SLUGS = ['fool', 'magician', 'priestess', 'empress', 'emperor', 'hierophant', 'lovers', 'chariot', 'strength', 'hermit', 'wheel',
  'justice', 'hanged', 'death', 'temperance', 'devil', 'tower', 'star', 'moon', 'sun', 'judgement', 'world'];
const cardFromBook = (e, i) => {
  const f = e.fields, s = e.sections;
  return {
    slug: f['код'] || TAROT_SLUGS[i] || `card${i}`, name: e.name, en: f['англ'] || '', keys: f['ключи'] || '', question: f['вопрос'] || '',
    today: f['сегодня'] || '', image: img('tarot', f['картинка']),
    sections: { image: s['Образ'] || [], spread: s['В раскладе'] || [], state: s['Состояние человека'] || [], shadow: s['Теневая сторона'] || [], advice: s['Совет'] || [] },
  };
};

/* ── Знаки зодиака: черта × тон дня → персональный прогноз ── */
const SIGNS_FALLBACK = [
  ['Козерог',  [1,20],  'вы держите нагрузку дольше других и потому позже замечаете усталость'],
  ['Водолей',  [2,19],  'вам нужнее воздуха свобода решать самой, без чужих сценариев'],
  ['Рыбы',     [3,20],  'вы считываете настроение вокруг раньше, чем понимаете свое'],
  ['Овен',     [4,20],  'вам легче начать, чем ждать, и это ваша сила, а не недостаток'],
  ['Телец',    [5,21],  'вы цените устойчивость и не любите решать наспех'],
  ['Близнецы', [6,21],  'вам нужен разговор, чтобы понять, что вы думаете на самом деле'],
  ['Рак',      [7,22],  'вы бережете своих и часто ставите себя в этой очереди последней'],
  ['Лев',      [8,23],  'вам важно, чтобы вклад видели, — и это честная потребность'],
  ['Дева',     [9,23],  'вы замечаете детали, которых не видят другие, и от этого устаете'],
  ['Весы',     [10,23], 'вы ищете равновесие и потому дольше выбираете'],
  ['Скорпион', [11,22], 'вы чувствуете глубже, чем показываете'],
  ['Стрелец',  [12,21], 'вам тесно там, где не видно горизонта'],
];


/* ── Руны старшего футарка ── */

const runeFromBook = (e, i) => {
  const f = e.fields, s = e.sections;
  return {
    slug: f['код'] || `rune${i}`, name: e.name, latin: f['лат'] || '', keyword: f['ключ'] || '', motto: f['образ'] || '', answer: f['ответ'] || '',
    image: img('runes', f['картинка']), path: f['знак'] || 'M16 5v22',
    sections: { meaning: s['Значение'] || [], advice: s['Совет'] || [], state: s['Состояние человека'] || [], interact: s['Во взаимодействии'] || [] },
  };
};

/* ── Расклады: названия позиций и пояснения. Позиции нужны и серверу (запись в историю), и экрану ── */
const P = (name, hint) => ({ name, hint });
export const LAYOUTS = {
  rune: {
    one: { title: 'Одна руна', sub: 'Короткий ответ', desc: 'Одна руна — один ясный ответ: что сейчас главное в вашем вопросе.', pos: [P('Ответ', '')] },
    three: { title: 'Три руны', sub: 'Прошлое · Настоящее · Будущее',
      desc: 'Классический расклад: первая руна показывает корни ситуации, вторая — текущее положение дел, третья — возможный итог.',
      pos: [P('Прошлое', 'корни ситуации'), P('Настоящее', 'текущее положение дел'), P('Будущее', 'возможный итог')] },
    cross: { title: 'Крест', sub: 'Пять рун',
      desc: 'Первая руна — суть проблемы, вторая — прошлое, третья — что делать (совет), четвертая — скрытые препятствия, пятая — итог.',
      pos: [P('Суть проблемы', ''), P('Прошлое', ''), P('Что делать', 'совет'), P('Скрытые препятствия', ''), P('Итог', '')] },
    elements: { title: 'Четыре стихии', sub: 'По сторонам света',
      desc: 'Руны выкладываются по сторонам света и показывают физический, эмоциональный, ментальный и духовный аспекты ситуации.',
      pos: [P('Север · Земля', 'физический аспект'), P('Запад · Вода', 'эмоциональный аспект'), P('Восток · Воздух', 'ментальный аспект'), P('Юг · Огонь', 'духовный аспект')] },
  },
  tarot: {
    three: { title: 'Три карты', sub: 'Прошлое · Настоящее · Будущее',
      desc: 'Показывает глубинные причины ситуации в прошлом, суть проблемы в настоящем и кармический итог в будущем.',
      pos: [P('Прошлое', 'глубинные причины ситуации'), P('Настоящее', 'суть проблемы'), P('Будущее', 'кармический итог')] },
    fork: { title: 'Выбор', sub: 'Развилка · три карты',
      desc: 'Первая карта показывает текущую ситуацию, вторая — путь при выборе первого решения, третья — путь при выборе второго решения.',
      pos: [P('Ситуация сейчас', ''), P('Первое решение', 'путь, если выбрать его'), P('Второе решение', 'путь, если выбрать его')] },
    celtic: { title: 'Кельтский крест', sub: 'Десять карт',
      desc: 'Классическая схема из десяти карт: исчерпывающий анализ серьезного кризиса, судьбоносного поворота или большой темы жизни. Первые шесть — крест: внутреннее состояние и ситуация; четыре справа — жезл: внешние факторы и итог.',
      pos: [
        P('Сердце проблемы', 'суть ситуации, то, что происходит с вами прямо сейчас'),
        P('Препятствие', 'карта лежит поперек первой: то, что мешает, блокирует развитие или бросает вам вызов — даже позитивная карта здесь указывает на избыток этой энергии'),
        P('Базис · прошлое', 'основа ситуации, недавние события или подсознательные причины, которые привели к текущему моменту'),
        P('Уходящее прошлое', 'мысли, люди или события, которые уже теряют влияние и уходят из вашей жизни'),
        P('Потенциал', 'ваши сознательные планы, цели, идеальный исход или то, чего вы хотите достичь'),
        P('Ближайшее будущее', 'то, что произойдет в самое ближайшее время — обычно в течение нескольких недель'),
        P('Ваше «Я»', 'ваше истинное отношение к ситуации, внутренние силы, страхи или ресурсы'),
        P('Влияние окружения', 'как на ситуацию влияют другие люди, близкие, коллеги или внешние обстоятельства'),
        P('Надежды и страхи', 'то, чего вы больше всего ждете или боитесь — эта позиция часто показывает психологические блоки'),
        P('Конечный итог', 'долгосрочный результат развития ситуации, перспектива на несколько месяцев или полгода, резюме всего расклада'),
      ] },
  },
};

/* ── Лунные дни: название и рекомендация. Запасные значения — те же короткие строки, что в content/лунные-дни.txt.
   Сам файл — «статья» на каждый день (число, название, рекомендация, тема, символ, картинка и [Описание] —
   глава справочника как есть, с подзаголовками «## » и ссылками [текст](адрес)); старый строчный формат
   «номер | название | рекомендация» тоже читается. Общие главы справочника — лунные-дни-справочник.txt. ── */
const LUNAR_DAYS_FALLBACK = [
  ['День замысла', 'Загадайте, а не начинайте: сегодня хорошо обдумывать планы и представлять результат. Действия лучше отложить на завтра.'],
  ['День начала', 'Подходит для первого шага в новом деле и для щедрости. Не бросайтесь в крайности — ни в еде, ни в спорах.'],
  ['День напора', 'Энергии много, и она ищет выход. Направьте ее в дело или движение, а не в выяснение отношений.'],
  ['День выбора', 'Взвешивайте, а не решайте сгоряча. Полезно побыть в тишине и не обещать лишнего.'],
  ['День верности себе', 'Прислушайтесь к тому, чего вы хотите на самом деле. Хороший день для честных разговоров и еды по аппетиту.'],
  ['День слова', 'Мысли и слова сегодня весят больше обычного. Говорите важное и не спорьте ради спора.'],
  ['День ветра', 'Слова обретают силу: не желайте зла и не давайте пустых обещаний. Хорошо просить, договариваться, благодарить.'],
  ['День огня', 'Хорошо разбирать завалы — в делах и в голове. Теплая еда, свеча, теплый разговор помогают.'],
  ['День тени', 'Непростой день: тревоги громче. Не начинайте важного, не ссорьтесь, простите то, что можно простить.'],
  ['День рода', 'Позвоните родным или вспомните тех, кто был до вас. Хорош для дома и семейных дел.'],
  ['День силы', 'Самый сильный день месяца: можно браться за трудное. Только не распыляйтесь — одна цель.'],
  ['День сердца', 'Доброта и покой. Хорошо просить и прощать, дарить и принимать. Тяжелую работу лучше отложить.'],
  ['День колеса', 'Возвращается незакрытое: долги, обещания, старые темы. Закройте хотя бы одну из них.'],
  ['День трубы', 'Хороший день для старта и движения. То, что начнете сегодня, пойдет быстрее.'],
  ['День испытания', 'Соблазны и раздражение сильнее обычного. Не поддавайтесь на провокации, берегите слово.'],
  ['День равновесия', 'Тихий день: ищите меру во всем. Подходит для примирений и спокойных дел.'],
  ['День радости', 'Разрешите себе удовольствие: встречу, танец, вкусное. Отношения сегодня в фокусе.'],
  ['День зеркала', 'Все вокруг отражает вас. Если что-то раздражает, посмотрите, о чем это в вас самой.'],
  ['День паутины', 'Не плетите интриг и не поддавайтесь чужим. Хорошо расчищать: дом, список дел, телефон.'],
  ['День орла', 'Взгляд сверху: хорошо принимать взрослые решения и видеть целое. Не мельчите.'],
  ['День коня', 'Смелость и движение. Хорош для дороги, спорта и честных поступков.'],
  ['День знания', 'Учитесь, читайте, слушайте тех, кто опытнее. Щедрость сегодня возвращается.'],
  ['День крокодила', 'Берегите силы, не мстите и не переусердствуйте. Тихий вечер лучше большой компании.'],
  ['День медведя', 'Сила просыпается — направьте ее в тело и в дело. Не давите на других.'],
  ['День черепахи', 'Не спешите. Хорош для уединения, отдыха и медленных дел.'],
  ['День жабы', 'Не хвастайтесь и не тратьте лишнего. Экономьте силы и слова.'],
  ['День трезубца', 'Интуиция обострена. Хорошо для отдыха, воды и мягких решений.'],
  ['День лотоса', 'Светлый день: хорош для дома, покупок и добрых дел. Все, что сделано с любовью, приживается.'],
  ['День гидры', 'Самый темный день месяца: не начинайте, не спорьте, не поддавайтесь унынию. Проведите его тихо.'],
  ['День лебедя', 'Итог месяца: простите, поблагодарите, отпустите. Завтра — новое начало.'],
];
/* Темы чтения: ключ | заголовок раздела в статье | по умолчанию. Заголовки разделов лунных дней — служебные:
   по ним код узнает тему; сравнение после нормализации (регистр, е/е, пробелы). symbol и advice — не разделы,
   а вступление статьи и поле «рекомендация». */
const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-zа-я0-9]+/g, ' ').trim();
const readingTopicsFrom = (rowsIn) => {
  const src = rowsIn.map((c) => [c[0], /^\(/.test(c[1]) ? '' : c[1], c[2] || '', /^(да|yes|1)$/i.test(c[3] || '')]);
  return src.filter((t) => /^[a-z][a-z0-9-]{1,19}$/.test(t[0])).map(([key, title, label, def]) => ({ key, title, label: label || title, def: !!def, norm: normTitle(title) }));
};
const unknownTopics = new Set();
/* Статья → разделы с ключами: вступление (до первого «##») — symbol, каждый подзаголовок — тема по ключу;
   незнакомый заголовок получает ключ «x-N», показывается только в режиме «все» и один раз пишется в журнал. */
const splitSections = (blocks, topics, where) => {
  const out = []; let cur = { key: 'symbol', title: '', blocks: [] }; let x = 0;
  for (const b of blocks) {
    if (b.t === 'h') {
      if (cur.blocks.length || cur.key !== 'symbol') out.push(cur);
      const n = normTitle(b.text), t = topics.find((tp) => tp.title && tp.norm === n);
      if (!t && !unknownTopics.has(n)) { unknownTopics.add(n); console.warn(`Темы чтения: в ${where} раздел «${b.text}» не описан в темы.txt — виден только в режиме «все»`); }
      cur = { key: t ? t.key : `x-${++x}`, title: b.text, blocks: [] };
      continue;
    }
    cur.blocks.push(b);
  }
  if (cur.blocks.length || cur.key !== 'symbol') out.push(cur);
  return out;
};
/* День из статьи: короткие поля — на экран, в напоминание и на открытку; описание — блоками как в файле. */
const lunarFromArticle = (e) => {
  const f = e.fields;
  return {
    n: num(f['число'], 0), name: f['название'] || '', advice: f['рекомендация'] || '', theme: f['тема'] || '', symbol: f['символ'] || '',
    image: img('lunar', f['картинка']), blocks: e.sections['Описание'] || [],
  };
};

/* ── Круг эмоций Плутчика: ключ → название, семейство (лепесток), оттенок и цвет.
   Восемь лепестков по три степени плюс восемь сочетаний между лепестками. Прежние пять
   настроений остаются читаемыми в старых отметках. ── */
const M = (key, label, family, tone) => ({ key, label, family, tone });
const MOODS_FALLBACK = [
  M('serenity', 'безмятежность', 'joy', '+'), M('joy', 'радость', 'joy', '+'), M('ecstasy', 'восторг', 'joy', '+'),
  M('acceptance', 'принятие', 'trust', '+'), M('trust', 'доверие', 'trust', '+'), M('admiration', 'восхищение', 'trust', '+'),
  M('apprehension', 'тревога', 'fear', '-'), M('fear', 'страх', 'fear', '-'), M('terror', 'ужас', 'fear', '-'),
  M('distraction', 'отвлечение', 'surprise', '0'), M('surprise', 'удивление', 'surprise', '0'), M('amazement', 'изумление', 'surprise', '0'),
  M('pensiveness', 'задумчивость', 'sadness', '-'), M('sadness', 'грусть', 'sadness', '-'), M('grief', 'горе', 'sadness', '-'),
  M('boredom', 'скука', 'disgust', '-'), M('disgust', 'отвращение', 'disgust', '-'), M('loathing', 'омерзение', 'disgust', '-'),
  M('annoyance', 'досада', 'anger', '-'), M('anger', 'злость', 'anger', '-'), M('rage', 'ярость', 'anger', '-'),
  M('interest', 'интерес', 'anticipation', '0'), M('anticipation', 'ожидание', 'anticipation', '0'), M('vigilance', 'настороженность', 'anticipation', '0'),
  M('optimism', 'оптимизм', 'dyad', '+'), M('love', 'любовь', 'dyad', '+'), M('submission', 'покорность', 'dyad', '0'), M('awe', 'трепет', 'dyad', '0'),
  M('disappointment', 'разочарование', 'dyad', '-'), M('remorse', 'раскаяние', 'dyad', '-'), M('contempt', 'презрение', 'dyad', '-'), M('aggressiveness', 'агрессия', 'dyad', '-'),
];
const MOOD_FAMILIES_FALLBACK = { joy: ['Радость', '#f2c94c'], trust: ['Доверие', '#9ccc3c'], fear: ['Страх', '#3aa35a'], surprise: ['Удивление', '#2aa7c9'],
  sadness: ['Грусть', '#4c78c8'], disgust: ['Отвращение', '#8f5fb8'], anger: ['Злость', '#e0475c'], anticipation: ['Ожидание', '#f0932b'], dyad: ['На стыке', '#b9b2cf'] };
/* прежние пять отметок — чтобы старая история читалась */
export const LEGACY_MOODS = { joy: 'joy', calm: 'serenity', tired: 'pensiveness', anx: 'apprehension', sad: 'sadness' };
export const QUICK_MOODS = [M('quick:well','Хорошо','joy','+'),M('quick:calm','Спокойно','trust','+'),M('quick:tired','Устала','sadness','-'),M('quick:anxious','Тревожно','fear','-'),M('quick:heavy','Тяжело','sadness','-')];
export const moodInfo = (key) => QUICK_MOODS.find(m=>m.key===key) || data.MOOD_BY_KEY[LEGACY_MOODS[key] || key] || null;
/* Тексты напоминаний по функции — запасные, те же, что в content/напоминания.txt */
/* Тексты экрана «Моя неделя» — запасные, те же, что в content/неделя.txt: ключ → варианты (ритм — несколько, берется по неделе) */
const WEEK_TEXTS_FALLBACK = {
  'ритм': ['Ритм — это не счет. Дни, когда получилось, уже с вами.', 'Пропуски — тоже часть ритма, а не его отсутствие.', 'У недели свой темп. Вы его видите — и этого достаточно.'],
  'пусто': ['Записей не было. Это нормально.'],
  'мало': ['На этой неделе вы сохранили {n} {момента}'],
  'рефлексия': ['Что хочется взять с собой в следующую неделю?'],
};

/* ── Установки дня: запасной набор на случай отсутствия файла ── */
/* Темы дня (12): ключ | название | о чем. Тон дня, карта, руна и небо ведут к теме (темы-источников.txt),
   к теме подбираются настрой и вопрос дня (настрой.txt). Запасные списки — если файлов нет. */
const THEME_KEY = /^[а-яе][а-яе-]{1,24}$/;

/* ── Нумерология ── */
/* Личный год: планета, энергия, подпись и картинка идут на экран и на открытку, описание — блоками как в файле.
   Запасного текста нет: без файла экран показывает прежнюю короткую строку из нумерология-год.txt. */
const yearFromArticle = (e) => {
  const f = e.fields;
  return {
    n: num(f['число'], 0), planet: f['планета'] || '', energy: f['энергия'] || '', caption: f['подпись'] || '', message: f['послание'] || '',
    image: img('year', f['картинка']), blocks: e.sections['Описание'] || [],
  };
};

/* ── Настрой дня ── */
/* Пожелание дня в приветствии: «Вдохновения вам, Викки». Родительный падеж, без точки. */
/* Инструменты Дневника: ключ | раздел (history) | название | описание | на старте. «Сегодня» — чтение дня, там все видно всегда. Запасной список — если файла нет */
const toolsFrom = (rowsIn) => rowsIn.filter((c) => /^[a-z][a-z0-9-]{1,19}$/.test(c[0]) && ['today', 'history'].includes(c[1]))
  .map(([key, section, title, text, start]) => ({ key, section, title, text: text || '', start: /^(да|yes|1)$/i.test(start || '') }));

/* ── Ответы «Да/Нет»: вердикт × тема ── */
const YN_VERDICTS_FALLBACK = ['Да', 'Нет', 'Позже'];
const TOPICS_FALLBACK = [
  ['work',   /работ|карьер|начальн|коллег|увол|должност|проект|бизнес|дел[оа]|собеседован|офис|команд|клиент|заказ/i],
  ['money',  /деньг|финанс|зарплат|кредит|долг|ипотек|купит|продат|вложи|инвест|цен[ауы]|доход|накопл|трат/i],
  ['love',   /отношени|любов|партн[ее]р|муж|жен[ае]|парн|девушк|развод|свидан|брак|расстат|помир|чувств|семь|вместе|с ним\b|с ней\b|замуж|свадьб|роман|измен/i],
  ['health', /здоров|болезн|врач|устал|сил[ыу]|сон|тело|спорт|выгор|нерв|тревог/i],
  ['move',   /переезд|город|стран|квартир|дом|жиль|съеха|аренд|ремонт/i],
  ['study',  /уч[ее]б|курс|(?<![а-яе])учит|образован|диплом|экзамен|школ|универ|навык/i],   // «получится» — не про учебу
];


/* ── Сборка: файл из ../content, если он есть; иначе запасное значение выше ── */
/* Файл контента обязателен: без него приложение не стартует с понятной ошибкой, а не работает молча на устаревшей копии из кода */
const must = (name, v) => { if (v === null || v === undefined) throw new Error(`Нет файла контента: ${name} (папка ${CONTENT_DIR}). Заберите тексты: ./тексты-с-сервера.sh`); return v; };
function build() {
  const r = {};

  /* Карты Таро: книга с картинками и разделами */
  r.ARCANA = must('карты-таро.txt', book('карты-таро.txt')).map(cardFromBook);

  /* У знаков из файла берем только черту: даты определяют знак и меняться не должны. */
  const signs = rows('знаки-зодиака.txt', 2);
  r.SIGNS = SIGNS_FALLBACK.map((s, i) => (signs && signs[i] ? [signs[i][0], s[1], signs[i][1]] : s));

  const tones = must('тона-дня.txt', rows('тона-дня.txt', 3));
  r.DAY_TONES = tones.map((c) => {
    const [w, l, hh, m] = String(c[2]).split(',');
    return [c[0], c[1], { work: num(w, 60), love: num(l, 60), health: num(hh, 60), money: num(m, 60) }];
  });

  /* Руны: книга со знаком-рисунком в каждой записи. */
  r.RUNES = must('руны.txt', book('руны.txt')).map(runeFromBook);

  r.NUM_DESTINY = Object.fromEntries(must('нумерология-судьба.txt', rows('нумерология-судьба.txt', 3)).map((c) => [c[0], [c[1], c[2]]]));

  r.NUM_YEAR = Object.fromEntries(must('нумерология-год.txt', rows('нумерология-год.txt', 2)).map((c) => [c[0], c[1]]));

  r.YEARS = Object.fromEntries((article('личный-год.txt') || []).map(yearFromArticle).filter((y) => y.n).map((y) => [y.n, y]));

  r.NUM_DAY = Object.fromEntries(must('нумерология-день.txt', rows('нумерология-день.txt', 2)).map((c) => [c[0], c[1]]));

  /* Лунные дни: статья на каждый день (число 1…30) или старый строчный файл «номер | название | рекомендация».
     LUNAR_DAYS — пары [название, рекомендация] по номеру, как раньше; LUNAR_INFO — полные записи с картинкой и описанием. */
  const ldArt = article('лунные-дни.txt');
  const ldInfo = (ldArt || []).map(lunarFromArticle).filter((d) => d.n >= 1 && d.n <= 30);
  r.LUNAR_DAYS = LUNAR_DAYS_FALLBACK.map((d, i) => { const a = ldInfo.find((x) => x.n === i + 1); return a ? [a.name || d[0], a.advice || d[1]] : d; });
  r.READING_TOPICS = readingTopicsFrom(must('темы.txt', rows('темы.txt', 2)));
  r.LUNAR_INFO = ldInfo.sort((a, b) => a.n - b.n).map((d) => ({ ...d, sections: splitSections(d.blocks, r.READING_TOPICS, `лунные-дни.txt, день ${d.n}`) }));
  /* Общие главы справочника: одна запись, каждый раздел [Название] — глава; на экране идут в том же порядке */
  const ref = (article('лунные-дни-справочник.txt') || [])[0];
  r.LUNAR_REF = ref ? { title: ref.name, caption: ref.fields['подпись'] || '', sections: Object.entries(ref.sections).map(([title, blocks]) => ({ title, blocks })) } : null;
  r.ASKESIS_IDEAS = must('аскезы.txt', lines('аскезы.txt'));
  r.HABIT_IDEAS = must('привычки.txt', lines('привычки.txt'));
  r.TOOLS = toolsFrom(must('инструменты.txt', rows('инструменты.txt', 4)));

  /* Темы дня и настрой: тема выбирается по источнику (тон, карта, руна, небо), к теме — настрой и вопрос дня */
  r.THEMES = must('темы-дня.txt', rows('темы-дня.txt', 2)).filter((t) => THEME_KEY.test(t[0])).map(([key, title, about]) => ({ key, title, about: about || '' }));
  const themeKeys = new Set(r.THEMES.map((t) => t.key));
  r.THEME_OF = {};
  for (const [src, code, key] of must('темы-источников.txt', rows('темы-источников.txt', 3))) { if (!themeKeys.has(key)) continue; (r.THEME_OF[src] ||= {})[code.replace(/\s+/g, ' ')] = key; }
  r.NASTROY = must('настрой.txt', rows('настрой.txt', 3)).filter((n) => themeKeys.has(n[0]) && /\?\s*$/.test(n[2]));
  for (const t of r.THEMES) if (!r.NASTROY.some((n) => n[0] === t.key) && !process.env.LUNARIO_QUIET) console.warn(`Тексты: у темы «${t.title}» нет ни одного настроя в настрой.txt`);
  /* «Новое в приложении»: месяц | название | раздел:виджет | описание */
  /* «месяц | название | раздел:виджет | о чем» — новинка с переходом; «скоро | название | о чем» — анонс без перехода */
  r.NEWS = (rows('новое.txt', 3) || []).flatMap((c) => {
    if (c[0] === 'скоро') return [{ soon: true, title: c[1], text: c[2] }];
    if (c.length < 4 || !c[3]) return [];
    const [view, widget] = c[2].split(':'); return [{ month: c[0], title: c[1], view: view.trim(), widget: (widget || '').trim(), text: c[3] }];
  });

  /* Круг эмоций: «лепесток | ключ | Название | цвет» и «ключ | название | лепесток | тон» в одном файле */
  const em = rows('эмоции.txt', 4);
  const fams = em ? em.filter((c) => c[0] === 'лепесток') : [];
  const moods = em ? em.filter((c) => c[0] !== 'лепесток').map((c) => M(c[0], c[1], c[2], c[3])) : [];
  r.MOODS = [...new Map([...MOODS_FALLBACK, ...moods.filter(m=>m.key!=='displeasure')].map(m => [m.key, m])).values()];
  r.MOOD_FAMILIES = fams.length >= 8 ? Object.fromEntries(fams.map((c) => [c[1], [c[2], c[3]]])) : MOOD_FAMILIES_FALLBACK;
  r.MOOD_BY_KEY = Object.fromEntries(r.MOODS.map((m) => [m.key, m]));
  r.MOOD_BY_KEY.displeasure = M('displeasure', 'неудовольствие', 'disgust', '-');
  /* Тексты напоминаний */
  const rt = rows('напоминания.txt', 2);   /* текст может быть одной фразой — только заголовок, без тела */
  r.REMINDER_TEXTS = Object.fromEntries(must('напоминания.txt', rt).map((c) => [c[0], [c[1], c[2] || '']]));
  /* Тексты «Моей недели»: ключ | текст; ключ может повторяться — это варианты, файл целиком заменяет запасной список по ключу */
  /* фразы интерфейса — интерфейс.txt (ключ | текст); чего нет в файле — как в коде (UI_DEFAULT). Правится в кабинете, вкладка «Тексты» */
  r.UI = { ...UI_DEFAULT };
  for (const [k, v] of rows('интерфейс.txt', 2) || []) if (k && v) r.UI[k] = v;
  const wt = rows('неделя.txt', 2) || [];
  r.WEEK_TEXTS = { ...WEEK_TEXTS_FALLBACK };
  for (const key of new Set(wt.map((c) => c[0]))) r.WEEK_TEXTS[key] = wt.filter((c) => c[0] === key).map((c) => c[1]);
  /* Тексты неба: тип | ключ | … — в объект по типам; чего нет в файле, то возьмет sky.mjs из своих запасных */
  const sk = rows('небо.txt', 3) || [];
  const sky = { phase: {}, eclipse: {}, retro: {}, season: {} };
  for (const c of sk) {
    if (c[0] === 'фаза' && c.length >= 4) sky.phase[c[1]] = [c[2], c[3]];
    else if (c[0] === 'затмение' && c.length >= 4) sky.eclipse[c[1]] = [c[2], c[3]];
    else if (c[0] === 'ретро' && c.length >= 7) sky.retro[c[1]] = [c[2], c[3], c[4], c[5], c[6]];
    else if (c[0] === 'сезон') sky.season[c[1]] = c[2];
  }
  r.SKY = sky;

  /* «Я помню» — фразы памяти (ключ | текст; пустой текст выключает правило) и вопросы дня по теме (тема | вопрос).
     Файлы не обязательны: без них приложение просто молчит */
  r.MEMORY = Object.fromEntries((rows('память.txt', 1) || []).map((c) => [c[0], c[1] || '']));
  r.TOPIC_QUESTIONS = (rows('вопросы-по-темам.txt', 2) || []).map((c) => [c[0], c[1]]);
  r.AFFIRMATIONS = must('аффирмации.txt', lines('аффирмации.txt'));
  r.DAY_QUESTIONS = must('вопросы-дня.txt', lines('вопросы-дня.txt'));

  r.YN_RIDERS = Object.fromEntries(must('ответы-да-нет.txt', rows('ответы-да-нет.txt', 4)).map((c) => [c[0], [c[1], c[2], c[3]]]));

  r.YN_VERDICTS = YN_VERDICTS_FALLBACK;
  r.TOPICS = TOPICS_FALLBACK;
  return r;
}

let data = build();
export const ARCANA = new Proxy([], { get: (_, k) => Reflect.get(data.ARCANA, k) });
export const SIGNS = new Proxy([], { get: (_, k) => Reflect.get(data.SIGNS, k) });
export const DAY_TONES = new Proxy([], { get: (_, k) => Reflect.get(data.DAY_TONES, k) });
export const RUNES = new Proxy([], { get: (_, k) => Reflect.get(data.RUNES, k) });
export const AFFIRMATIONS = new Proxy([], { get: (_, k) => Reflect.get(data.AFFIRMATIONS, k) });
export const DAY_QUESTIONS = new Proxy([], { get: (_, k) => Reflect.get(data.DAY_QUESTIONS, k) });
export const YN_VERDICTS = new Proxy([], { get: (_, k) => Reflect.get(data.YN_VERDICTS, k) });
export const TOPICS = new Proxy([], { get: (_, k) => Reflect.get(data.TOPICS, k) });
export const YN_RIDERS = new Proxy({}, { get: (_, k) => Reflect.get(data.YN_RIDERS, k) });
export const NUM_DESTINY = new Proxy({}, { get: (_, k) => Reflect.get(data.NUM_DESTINY, k) });
export const NUM_YEAR = new Proxy({}, { get: (_, k) => Reflect.get(data.NUM_YEAR, k) });
export const YEARS = new Proxy({}, { get: (_, k) => Reflect.get(data.YEARS, k) });
export const NUM_DAY = new Proxy({}, { get: (_, k) => Reflect.get(data.NUM_DAY, k) });
export const LUNAR_DAYS = new Proxy([], { get: (_, k) => Reflect.get(data.LUNAR_DAYS, k) });
export const LUNAR_INFO = new Proxy([], { get: (_, k) => Reflect.get(data.LUNAR_INFO, k) });
export const MEMORY = new Proxy({}, { get: (_, k) => Reflect.get(data.MEMORY, k), ownKeys: () => Reflect.ownKeys(data.MEMORY), getOwnPropertyDescriptor: (_, k) => ({ value: data.MEMORY[k], enumerable: true, configurable: true }) });
export const TOPIC_QUESTIONS = new Proxy([], { get: (_, k) => Reflect.get(data.TOPIC_QUESTIONS, k) });
export const UI = new Proxy({}, { get: (_, k) => Reflect.get(data.UI, k), ownKeys: () => Reflect.ownKeys(data.UI), getOwnPropertyDescriptor: (_, k) => ({ value: data.UI[k], enumerable: true, configurable: true }) });
export const lunarRef = () => data.LUNAR_REF;
export const READING_TOPICS = new Proxy([], { get: (_, k) => Reflect.get(data.READING_TOPICS, k) });
/* Темы-«обертки» (вступление, рекомендация, «как прожить») — не содержательные разделы; напоминание и досье их не считают */
export const READING_META = new Set(['symbol', 'advice', 'live']);
export const THEMES = new Proxy([], { get: (_, k) => Reflect.get(data.THEMES, k) });
export const NASTROY = new Proxy([], { get: (_, k) => Reflect.get(data.NASTROY, k) });
/* тема по источнику: themeOf('карта', 'star') → 'восстановление'; неизвестное — null */
export const themeOf = (source, code) => (data.THEME_OF[source] || {})[String(code || '').replace(/\s+/g, ' ')] || null;
export const MOODS = new Proxy([], { get: (_, k) => Reflect.get(data.MOODS, k) });
export const MOOD_FAMILIES = new Proxy({}, { get: (_, k) => Reflect.get(data.MOOD_FAMILIES, k), ownKeys: () => Reflect.ownKeys(data.MOOD_FAMILIES), getOwnPropertyDescriptor: (_, k) => ({ value: data.MOOD_FAMILIES[k], enumerable: true, configurable: true }) });
export const REMINDER_TEXTS = new Proxy({}, { get: (_, k) => Reflect.get(data.REMINDER_TEXTS, k) });
export const WEEK_TEXTS = new Proxy({}, { get: (_, k) => Reflect.get(data.WEEK_TEXTS, k) });
export const SKY = new Proxy({}, { get: (_, k) => Reflect.get(data.SKY, k) });
export const NEWS = new Proxy([], { get: (_, k) => Reflect.get(data.NEWS, k) });
export const ASKESIS_IDEAS = new Proxy([], { get: (_, k) => Reflect.get(data.ASKESIS_IDEAS, k) });
export const HABIT_IDEAS = new Proxy([], { get: (_, k) => Reflect.get(data.HABIT_IDEAS, k) });
export const TOOLS = new Proxy([], { get: (_, k) => Reflect.get(data.TOOLS, k) });

/* Правки в текстах подхватываются без перезапуска — через пару секунд после сохранения. */
let reloadTimer = null;
try {
  if (existsSync(CONTENT_DIR)) {
    const w = watch(CONTENT_DIR, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try { data = build(); } catch (e) { console.error('Тексты: не перечитаны, работаем на прежних —', e.message); return; }
        console.log(`Тексты перечитаны: карт ${data.ARCANA.length}, рун ${data.RUNES.length}, тонов дня ${data.DAY_TONES.length}`);
      }, 1200);
    });
    w.unref();   // слежение не должно мешать процессу завершаться
  }
} catch { /* нет прав на слежение — тексты просто читаются при старте */ }

/* Поток отчетов подключает этот же модуль — ему в журнал повторять не нужно (LUNARIO_QUIET) */
if (!process.env.LUNARIO_QUIET) console.log(`Тексты: карт ${data.ARCANA.length}, знаков ${data.SIGNS.length}, тонов дня ${data.DAY_TONES.length}, рун ${data.RUNES.length}`);
