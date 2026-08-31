/* Лунарио — веб-приложение (PWA). Zero-dependency Node >=22.5 (node:sqlite).
   Слушает 127.0.0.1, за nginx. Своя папка и свой порт — не пересекается с лендингом.
   Аккаунт анонимный: httpOnly-cookie с токеном, e-mail можно привязать позже. */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { vapidKeys } from './push.mjs';
import { sign as paySign, verify as payVerify, parseForm as payParse, payLink } from './prodamus.mjs';
import * as C from './content.mjs';
import { findCities, cityByName, tzOffsetMinutes } from './cities.mjs';
import { sendMail, mailReady, loginMail, verifySmtp } from './mailer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5031);
const HOST = process.env.HOST || '127.0.0.1';
const SITE_DIR = process.env.SITE_DIR || join(__dirname, '..', 'site');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const BASE = process.env.BASE_PATH || '/app';
const CONSENT_VERSION = '2026-08-23';
const PUSH = vapidKeys(DATA_DIR);
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://lunario.online').replace(/\/+$/, '');
/* Цена-гипотеза для замера спроса. Меняется одной строкой (или SUB_PRICE в .env),
   когда партнёр принесёт медиаплан. Денег не берём — только считаем намерение. */
const SUB_PRICE = process.env.SUB_PRICE || '490 ₽ / месяц';
/* Продамус: адрес платёжной формы и секретный ключ (Настройки → Секретный ключ).
   Пока ключа нет — оплата не предлагается, работает прежний замер интереса. */
const PAY_FORM = (process.env.PRODAMUS_FORM || 'utkina.payform.ru').trim();
const PAY_SECRET = (process.env.PRODAMUS_SECRET || '').trim();
const PAY_AMOUNT = (process.env.SUB_AMOUNT || '490.00').trim();   // число для платёжки
/* Что можно оплатить. Цены-гипотезы для замера спроса — меняются через .env.
   subscription/unlimited включают Лунарио+; expert — разовая услуга (эксперт свяжется). */
const PAY_ITEMS = {
  subscription: { name: 'Лунарио+ — доступ на месяц', amount: () => PAY_AMOUNT, grants: 'plus' },
  unlimited:    { name: 'Лунарио+ — доступ на месяц', amount: () => PAY_AMOUNT, grants: 'plus' },
  expert:       { name: 'Консультация с экспертом', amount: () => (process.env.EXPERT_AMOUNT || '2500.00').trim(), grants: 'expert' },
};
const payReady = () => !!PAY_SECRET;
if (!PAY_SECRET) console.log('Оплата не настроена: задайте PRODAMUS_SECRET в .env (backend/set-pay.sh)');
/* Что разрешено писать в аналитику. Текстов вопросов в списке нет намеренно. */
const EVENT_TYPES = new Set([
  'app_open', 'intro_view', 'tour_view', 'login_open', 'worry_pick', 'onboard_start', 'onboard_done', 'login_code_sent', 'login_done',
  'card_open', 'mood_set', 'ask_yesno', 'ask_rune', 'ask_spread', 'spread_limit',
  'journal_add', 'wish_add', 'compat_calc', 'share_card', 'install_prompt', 'installed',
  'paywall_view', 'paywall_click', 'invite_copy', 'invite_used', 'push_on', 'push_off', 'pay_start', 'payment_success',
]);
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    name TEXT DEFAULT '', birth TEXT DEFAULT '', birth_time TEXT DEFAULT '', city TEXT DEFAULT '',
    email TEXT DEFAULT '',
    consent_version TEXT DEFAULT '', consent_ts TEXT DEFAULT '',
    streak INTEGER DEFAULT 0, streak_date TEXT DEFAULT '',
    onboarded INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ua TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, attempts INTEGER DEFAULT 0, sent INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    ts TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
    question TEXT DEFAULT '', title TEXT DEFAULT '', body TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_entries_user ON entries (user_id, id DESC);
  CREATE TABLE IF NOT EXISTS moods (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, mood TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    ts TEXT NOT NULL, day TEXT NOT NULL, text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    ts TEXT NOT NULL, text TEXT NOT NULL, done INTEGER DEFAULT 0, done_ts TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS usage (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, spreads INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  /* События продукта. Текстов вопросов здесь нет и быть не должно —
     только факт, тип и когорта, чтобы понимать поведение, не читая личное. */
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, day TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL, detail TEXT DEFAULT '',
    age_band TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_events_day ON events (day, type);
  /* Платежи: заказ создаётся у нас, подтверждение приходит вебхуком Продамуса. */
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, user_id INTEGER NOT NULL,
    feature TEXT NOT NULL, amount TEXT NOT NULL,
    status TEXT DEFAULT 'created',          -- created | paid
    paid_ts TEXT DEFAULT '', payment_type TEXT DEFAULT '',
    demo INTEGER DEFAULT 0
  );
  /* Кому слать напоминание про карту дня. */
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL, last_ok TEXT DEFAULT ''
  );
  /* Интерес к тому, чего ещё нет: подписка, эксперт, безлимит, артефакты. */
  CREATE TABLE IF NOT EXISTS interest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, user_id INTEGER NOT NULL,
    feature TEXT NOT NULL, price TEXT DEFAULT '',
    notify INTEGER DEFAULT 0, email TEXT DEFAULT ''
  );
`);

/* Приглашения: свой код у каждого и запись, кто кого привёл. */
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('ref_code')) db.exec("ALTER TABLE users ADD COLUMN ref_code TEXT DEFAULT ''");
  if (!cols.includes('invited_by')) db.exec('ALTER TABLE users ADD COLUMN invited_by INTEGER');
  if (!cols.includes('bonus_until')) db.exec("ALTER TABLE users ADD COLUMN bonus_until TEXT DEFAULT ''");
  if (!cols.includes('plus_until')) db.exec("ALTER TABLE users ADD COLUMN plus_until TEXT DEFAULT ''");
}

/* Координаты нужны натальной карте — добавляем к уже созданным базам */
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const [col, def] of [['lat', 'REAL'], ['lon', 'REAL'], ['tz', "TEXT DEFAULT ''"], ['city_region', "TEXT DEFAULT ''"]])
    if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}

/* Раньше кука была самим аккаунтом — переносим её в сессии, чтобы один
   аккаунт мог открываться на нескольких устройствах. Данные не теряются. */
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('token_hash')) {
    const moved = db.prepare(`INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, last_seen)
      SELECT token_hash, id, created_at, last_seen FROM users WHERE token_hash <> ''`).run();
    if (moved.changes) console.log(`перенесено сессий из старых аккаунтов: ${moved.changes}`);
    // UNIQUE на token_hash не даёт завести второй анонимный профиль — пересобираем таблицу
    db.exec('BEGIN');
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
      name TEXT DEFAULT '', birth TEXT DEFAULT '', birth_time TEXT DEFAULT '', city TEXT DEFAULT '',
      email TEXT DEFAULT '', consent_version TEXT DEFAULT '', consent_ts TEXT DEFAULT '',
      streak INTEGER DEFAULT 0, streak_date TEXT DEFAULT '', onboarded INTEGER DEFAULT 0,
      lat REAL, lon REAL, tz TEXT DEFAULT '', city_region TEXT DEFAULT '')`);
    db.exec(`INSERT INTO users_new (id, created_at, last_seen, name, birth, birth_time, city, email,
      consent_version, consent_ts, streak, streak_date, onboarded, lat, lon, tz, city_region)
      SELECT id, created_at, last_seen, name, birth, birth_time, city, email,
      consent_version, consent_ts, streak, streak_date, onboarded, lat, lon, tz, city_region FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
    console.log('таблица users пересобрана без token_hash');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email <> \'\'');
}

/* ── утилиты ── */
const MSK = 'Europe/Moscow';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: MSK }); // YYYY-MM-DD
const nowISO = () => new Date().toISOString();
const clean = (s, max) => String(s ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
const sha = (s) => createHash('sha256').update(s).digest('hex');
/* Возрастная когорта вместо точного возраста: ядро аудитории 35+ смотрим отдельно,
   но саму дату рождения в аналитику не тащим. */
/* Личные тексты — вопросы, дневник, желания — лежат в базе зашифрованными.
   Ключ берётся из APP_SECRET в .env и в базу никогда не попадает: у того, кто
   получит только файл базы, останется набор нечитаемых строк.
   Записи, сделанные до включения шифрования, читаются как есть. */
/* Ключ создаётся сам при первом запуске и лежит рядом с базой, доступный только root.
   Файл базы без этого файла бесполезен. Терять ключ нельзя — записи станут нечитаемыми,
   поэтому он попадает в резервную копию вместе с базой. */
const SECRET = (process.env.APP_SECRET || '').trim() || (() => {
  const keyFile = join(DATA_DIR, 'secret.key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  const fresh = randomBytes(32).toString('base64');
  writeFileSync(keyFile, fresh, { mode: 0o600 });
  console.log('Создан ключ шифрования записей: data/secret.key — храните его вместе с базой');
  return fresh;
})();
const KEY = scryptSync(SECRET, 'lunario-notes', 32);
const ENC_MARK = 'enc1:';

function seal(text) {
  const s = String(text ?? '');
  if (!s) return s;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return ENC_MARK + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function open_(text) {
  const s = String(text ?? '');
  if (!s.startsWith(ENC_MARK)) return s;              // старая запись без шифрования
  try {
    const raw = Buffer.from(s.slice(ENC_MARK.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}
console.log('Личные записи шифруются перед записью в базу');

/* Подарок за приглашение действует неделю и удваивает число подробных разборов. */
const hasBonus = (u) => !!u.bonus_until && u.bonus_until >= today();
const hasPlus = (u) => !!u.plus_until && u.plus_until >= today();
const spreadLimit = (u) => (hasPlus(u) ? 999 : hasBonus(u) ? 4 : 2);

function ageBand(birth) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birth || ''))) return '';
  const b = new Date(birth + 'T00:00:00Z'), now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  if (age < 25) return 'до 25';
  if (age < 35) return '25–34';
  if (age < 45) return '35–44';
  if (age < 55) return '45–54';
  return '55+';
}

/* Страница сводки: цифры словами, чтобы не читать выгрузку данных. */
function statsPage() {
  const s = statsPack();
  const esc = (x) => String(x).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const rows = (arr, a, b) => arr.length
    ? arr.map((r) => `<tr><td>${esc(r[a])}</td><td class="n">${esc(r[b])}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">Пока пусто</td></tr>';
  const returning = s.returning.map((r) => `<tr><td>${r.days} ${r.days === 1 ? 'день' : r.days < 5 ? 'дня' : 'дней'}</td><td class="n">${r.people}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Пока пусто</td></tr>';
  const interest = s.interest.length
    ? s.interest.map((i) => {
        const RU = { subscription: 'Лунарио+ (подписка)', expert: 'разговор с экспертом', unlimited: 'безлимит разборов', artifacts: 'артефакты', spreads: 'расклады на выбор', courses: 'курсы и круги', constellation: 'своё созвездие' };
        return `<tr><td>${RU[i.feature] || esc(i.feature)}</td><td class="n">${i.clicks}</td><td class="n">${i.people}</td><td class="n">${i.want_notice || 0}</td></tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">Никто пока не нажимал</td></tr>';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Лунарио — сводка</title>
<style>
  body{margin:0;background:#0b0817;color:#f1eef8;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:28px 18px 60px}
  .wrap{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:30px}
  h1{font-family:Georgia,serif;font-size:30px;margin:0}
  h2{font-family:Georgia,serif;font-size:20px;margin:0 0 12px;font-weight:600}
  .muted{color:#a79fbc;font-size:14px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .card{background:#171130;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:16px 18px}
  .card b{display:block;font-size:28px;font-family:Georgia,serif;color:#e8d8a8}
  .card span{font-size:13px;color:#a79fbc}
  table{width:100%;border-collapse:collapse;background:#171130;border:1px solid rgba(255,255,255,.09);border-radius:14px;overflow:hidden}
  td,th{padding:10px 14px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06);font-size:14.5px}
  th{color:#a79fbc;font-weight:500;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em}
  tr:last-child td{border-bottom:0}
  .n{text-align:right;font-variant-numeric:tabular-nums}
  .empty{color:#7d7593;text-align:center}
</style></head><body><div class="wrap">
  <div>
    <h1>Лунарио — что происходит</h1>
    <p class="muted">Данные на ${esc(s.today)}. Текстов вопросов здесь нет: только счётчики.</p>
  </div>
  <div class="cards">
    <div class="card"><b>${s.people['всего']}</b><span>человек всего</span></div>
    <div class="card"><b>${s.people['заполнили_профиль']}</b><span>заполнили профиль</span></div>
    <div class="card"><b>${s.people['оставили_почту']}</b><span>оставили почту</span></div>
  </div>
  <div><h2>Что нажимают</h2><table><tr><th>Действие</th><th class="n">Раз</th></tr>${rows(s.events_by_type, 'type', 'n')}</table></div>
  <div><h2>Сколько дней возвращались</h2><table><tr><th>Заходили</th><th class="n">Человек</th></tr>${returning}</table></div>
  <div><h2>Возраст</h2><table><tr><th>Когорта</th><th class="n">Человек</th></tr>${rows(s.cohorts, 'age_band', 'people')}</table></div>
  <div>
    <h2>За что готовы платить</h2>
    <table><tr><th>Что</th><th class="n">Кликов</th><th class="n">Людей</th><th class="n">Ждут письма</th></tr>${interest}</table>
    <p class="muted" style="margin-top:8px">Цена на экране: ${esc(s.price_shown)}</p>
  </div>
  <div><h2>По дням</h2><table><tr><th>День</th><th class="n">Действий</th></tr>${rows(s.events_by_day, 'day', 'n')}</table></div>
</div></body></html>`;
}

/* Доступ к сводке — по паролю из .env (как в админке лендинга). */
function statsAuthed(req, res) {
  const user = (process.env.STATS_USER || '').trim(), pass = (process.env.STATS_PASS || '').trim();
  if (!user || !pass) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Сводка не настроена: задайте STATS_USER и STATS_PASS в /opt/lunario-app/.env');
    return false;
  }
  const head = String(req.headers.authorization || '');
  if (head.startsWith('Basic ')) {
    const [u2, p2] = Buffer.from(head.slice(6), 'base64').toString('utf8').split(':');
    if (u2 === user && p2 === pass) return true;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Lunario"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Нужен пароль');
  return false;
}

/* Сводка: сколько людей, что нажимают, кто возвращается, за что готовы платить. */
function statsPack() {
  const q = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const day = today();
  const users = one('SELECT COUNT(*) c FROM users').c;
  const onboarded = one('SELECT COUNT(*) c FROM users WHERE onboarded = 1').c;
  const withEmail = one("SELECT COUNT(*) c FROM users WHERE email <> ''").c;
  return {
    today: day,
    people: { всего: users, заполнили_профиль: onboarded, оставили_почту: withEmail },
    events_by_day: q("SELECT day, COUNT(*) n FROM events WHERE day >= date('now','-14 days') GROUP BY day ORDER BY day DESC"),
    events_by_type: q("SELECT type, COUNT(*) n, COUNT(DISTINCT user_id) people FROM events GROUP BY type ORDER BY n DESC"),
    cohorts: q("SELECT age_band, COUNT(DISTINCT user_id) people FROM events WHERE age_band <> '' GROUP BY age_band ORDER BY age_band"),
    returning: q("SELECT days, COUNT(*) people FROM (SELECT user_id, COUNT(DISTINCT day) days FROM events GROUP BY user_id) GROUP BY days ORDER BY days"),
    interest: q('SELECT feature, COUNT(*) clicks, COUNT(DISTINCT user_id) people, SUM(notify) want_notice FROM interest GROUP BY feature ORDER BY clicks DESC'),
    price_shown: SUB_PRICE,
  };
}

function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

/* Кнопка «Прислать код» появляется только после успешной проверки авторизации.
   Сервис перезапускается скриптом set-smtp.sh — проверка сработает сама. */
let smtpOk = false;
if (mailReady()) {
  verifySmtp().then((r) => {
    smtpOk = r.ok;
    console.log(r.ok ? 'SMTP: авторизация прошла — вход по почте включён'
                     : `SMTP: авторизация НЕ прошла (${r.error}) — вход по почте скрыт`);
  });
} else console.log('SMTP: не настроен — вход по почте скрыт');
const mailLive = () => smtpOk;

const codeRate = new Map();
const RATE_WINDOW_MS = 10 * 60000;
function allowRate(map, key, max) {
  const now = Date.now();
  const rec = map.get(key) || { n: 0, t: now };
  if (now - rec.t > RATE_WINDOW_MS) { rec.n = 0; rec.t = now; }
  rec.n++; map.set(key, rec);
  if (map.size > 5000) for (const [k, r] of map) if (now - r.t > RATE_WINDOW_MS) map.delete(k);
  return rec.n <= max;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return xff ? String(xff).split(',')[0].trim() : (req.socket.remoteAddress || '');
}

/* ── астро/числа ── */
/* Считается каждый раз заново: тексты знаков правит владелец продукта,
   и перечитанный файл должен подхватываться без перезапуска. */
const signCuts = () => [...C.SIGNS].map(([name, [m, d], trait]) => ({ name, m, d, trait }));
function signOf(birth) {                       // birth: YYYY-MM-DD
  const cuts = signCuts();
  const [, mm, dd] = String(birth).split('-').map(Number);
  for (const s of cuts) if (mm < s.m || (mm === s.m && dd <= s.d)) return s;
  return cuts[0];                               // после 21 декабря — снова Козерог
}
const digits = (s) => String(s).replace(/\D/g, '').split('').map(Number);
function reduceNum(n) { while (n > 9 && n !== 11 && n !== 22) n = digits(n).reduce((a, b) => a + b, 0); return n; }
const destinyNum = (birth) => reduceNum(digits(birth).reduce((a, b) => a + b, 0));
function numFormula(birth) {                    // показываем арифметику: её можно проверить руками
  const [y, m, d] = birth.split('-');
  const seq = (d + m + y).split('').map(Number);
  const chain = [seq.reduce((a, b) => a + b, 0)];
  while (chain.at(-1) > 9 && ![11, 22].includes(chain.at(-1))) chain.push(digits(chain.at(-1)).reduce((a, b) => a + b, 0));
  return `${d}.${m}.${y} → ${seq.join('+')} = ${chain.join(' → ')}`;
}
function personalYear(birth, year) {
  const [, mm, dd] = birth.split('-').map(Number);
  return reduceNum(digits(`${dd}${mm}${year}`).reduce((a, b) => a + b, 0));
}
const dayNum = (day) => { let n = reduceNum(digits(day).reduce((a, b) => a + b, 0)); return n > 9 ? reduceNum(digits(n).reduce((a, b) => a + b, 0)) : n; };
function moonPhase(day) {                       // 0..1 доля цикла
  const t = Date.parse(day + 'T12:00:00Z');
  const synodic = 29.530588853 * 864e5;
  return (((t - Date.parse('2000-01-06T18:14:00Z')) % synodic) + synodic) % synodic / synodic;
}
const MOON_NAMES = ['Новолуние', 'Растущий серп', 'Первая четверть', 'Растущая Луна', 'Полнолуние', 'Убывающая Луна', 'Последняя четверть', 'Старая Луна'];
const moonName = (day) => MOON_NAMES[Math.floor(moonPhase(day) * 8) % 8];

/* ── персональный день ── */
function dayPack(u, day) {
  const seed = `${u.id}:${day}`;
  const sign = u.birth ? signOf(u.birth) : null;
  const arc = C.ARCANA[hash32(seed + ':card') % C.ARCANA.length];
  const tone = C.DAY_TONES[hash32(seed + ':tone') % C.DAY_TONES.length];
  return {
    date: day,
    moon: moonName(day),
    moonPct: Math.round(moonPhase(day) * 100),
    card: { name: arc[0], meaning: arc[1], advice: arc[2] },
    sign: sign ? sign.name : '',
    forecast: sign
      ? { title: tone[0], text: `${tone[1]} ${sign.trait[0].toUpperCase()}${sign.trait.slice(1)} — сегодня это особенно заметно.`, bars: tone[2] }
      : { title: tone[0], text: tone[1], bars: tone[2] },
    affirmation: C.AFFIRMATIONS[hash32(seed + ':aff') % C.AFFIRMATIONS.length],
    question: C.DAY_QUESTIONS[hash32(seed + ':q') % C.DAY_QUESTIONS.length],
  };
}
const topicOf = (q) => (C.TOPICS.find(([, re]) => re.test(q)) || ['self'])[0];

/* ── пользователь ── */
function parseCookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `lunario_app=${token}; Path=${BASE}; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`);
}
function newSession(userId, res, ua = '') {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, ua) VALUES (?,?,?,?,?)')
    .run(sha(token), userId, nowISO(), nowISO(), clean(ua, 200));
  setSessionCookie(res, token);
  return token;
}
function getUser(req, res, create = true) {
  const tok = parseCookies(req).lunario_app;
  if (tok) {
    const sess = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(sha(tok));
    if (sess) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id);
      if (u) {
        db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(nowISO(), sha(tok));
        db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(nowISO(), u.id);
        return u;
      }
    }
  }
  if (!create) return null;
  const info = db.prepare('INSERT INTO users (created_at, last_seen) VALUES (?,?)').run(nowISO(), nowISO());
  newSession(info.lastInsertRowid, res, req.headers['user-agent']);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}
function touchStreak(u) {                       // серию продолжает любой ритуал за день
  const d = today();
  if (u.streak_date === d) return u.streak;
  const y = new Date(Date.parse(d) - 864e5).toLocaleDateString('sv-SE', { timeZone: MSK });
  const next = u.streak_date === y ? u.streak + 1 : 1;
  db.prepare('UPDATE users SET streak = ?, streak_date = ? WHERE id = ?').run(next, d, u.id);
  u.streak = next; u.streak_date = d;
  return next;
}
const publicUser = (u) => ({
  name: u.name, birth: u.birth, birthTime: u.birth_time, city: u.city,
  region: u.city_region || '', lat: u.lat ?? null, lon: u.lon ?? null, tz: u.tz || '',
  tzOffset: u.tz && u.birth ? tzOffsetMinutes(u.tz, `${u.birth}T${u.birth_time || '12:00'}:00`) : null,
  natalReady: !!(u.birth && u.lat != null && u.birth_time),
  signedIn: !!u.email,
  sign: u.birth ? signOf(u.birth).name : '', onboarded: !!u.onboarded, streak: u.streak,
  streakToday: u.streak_date === today(), email: u.email,
});

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 32768) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(res, rel, cacheSec = 3600) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(SITE_DIR, safe);
  if (!file.startsWith(normalize(SITE_DIR)) || !existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': `public, max-age=${cacheSec}` });
  res.end(readFileSync(file));
}

/* ── маршруты ── */
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
    if (p === '' ) p = '/';

    if (p === '/api/health') return json(res, 200, { ok: true, service: 'lunario-app' });

    /* Сводка по продукту: сколько людей, что нажимают, кто вернулся.
       Закрыта паролем; личных текстов внутри нет — только счётчики. */
    if (p === '/api/stats') {
      if (!statsAuthed(req, res)) return;
      return json(res, 200, statsPack());
    }

    /* Та же сводка, но читаемая человеком. */
    if (p === '/stats' || p === '/stats/') {
      if (!statsAuthed(req, res)) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(statsPage());
    }

    /* Подтверждение оплаты от Продамуса. Без куки — источник проверяется подписью. */
    if (p === '/api/pay/webhook' && req.method === 'POST') {
      if (!payReady()) { res.writeHead(503); return res.end('not configured'); }
      const raw = await readRaw(req);
      const data = payParse(raw);
      const signHeader = req.headers['sign'] || req.headers['Sign'];
      console.log(`[вебхук] пришёл: order_id=${data.order_id||'?'} status=${data.payment_status||'?'} demo=${data.demo_mode||'0'} подпись=${signHeader?'есть':'нет'}`);

      /* Продамус проверяет адрес пробным запросом перед сохранением: в нём нет
         нашего номера заказа. Отвечаем «принято», иначе адрес не сохранится.
         Ничего при этом не активируем — деньги двигают только подписанные уведомления. */
      if (!/^lun-\d+$/.test(String(data.order_id || ''))) {
        console.log('[вебхук] пробный запрос — отвечаем принято');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('success');
      }
      if (!payVerify(data, PAY_SECRET, signHeader)) {
        console.error('[оплата] подпись уведомления не сошлась, order_id:', data.order_id);
        res.writeHead(400); return res.end('bad sign');
      }
      const orderId = String(data.order_id || '');
      const m = orderId.match(/^lun-(\d+)$/);
      const status = String(data.payment_status || '');
      if (m && status === 'success') {
        const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(m[1]));
        if (pay && pay.status !== 'paid') {
          const isDemo = String(data.demo_mode || '') === '1' || String(data.payment_type || '').includes('demo');
          db.prepare("UPDATE payments SET status='paid', paid_ts=?, payment_type=?, demo=? WHERE id=?")
            .run(nowISO(), clean(String(data.payment_type || ''), 60), isDemo ? 1 : 0, pay.id);
          const u2 = db.prepare('SELECT * FROM users WHERE id = ?').get(pay.user_id);
          if (u2) {
            const grants = (PAY_ITEMS[pay.feature] || {}).grants;
            if (grants === 'plus') {
              /* Лунарио+ на 30 дней; повторная оплата продлевает от конца текущего срока */
              const from = hasPlus(u2) ? new Date(u2.plus_until + 'T00:00:00Z') : new Date();
              const until = new Date(from.getTime() + 30 * 864e5).toISOString().slice(0, 10);
              db.prepare('UPDATE users SET plus_until=? WHERE id=?').run(until, u2.id);
              console.log(`[оплата] заказ ${orderId} оплачен${isDemo ? ' (демо)' : ''}, Лунарио+ до ${until} у пользователя ${u2.id}`);
            } else {
              /* Разовая услуга (консультация): доступ не выдаём, эксперт свяжется вручную. */
              console.log(`[оплата] заказ ${orderId} (${pay.feature}) оплачен${isDemo ? ' (демо)' : ''}, пользователь ${u2.id}`);
            }
            db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)')
              .run(nowISO(), today(), u2.id, 'payment_success', pay.feature + (isDemo ? ':demo' : ''), ageBand(u2.birth));
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('success');
    }

    /* ── API ── */
    if (p.startsWith('/api/')) {
      const u = getUser(req, res);
      const d = today();

      /* ── вход по коду на почту ── */
      if (p === '/api/auth/request' && req.method === 'POST') {
        const b = await readBody(req);
        const email = clean(b.email, 200).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) return json(res, 400, { ok: false, error: 'bad_email' });
        if (!allowRate(codeRate, clientIp(req), 5)) return json(res, 429, { ok: false, error: 'too_often' });
        if (!mailLive()) return json(res, 503, { ok: false, error: 'mail_off' });
        const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
        db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts)
          VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET
          code_hash = excluded.code_hash, created_at = excluded.created_at,
          expires_at = excluded.expires_at, attempts = 0`)
          .run(email, sha(code + email), nowISO(), new Date(Date.now() + 15 * 60000).toISOString());
        try {
          const m = loginMail(code);
          await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
        } catch (e) {
          console.error('почта не ушла:', e.message);
          return json(res, 502, { ok: false, error: 'send_failed' });
        }
        return json(res, 200, { ok: true });
      }

      if (p === '/api/auth/verify' && req.method === 'POST') {
        const b = await readBody(req);
        const email = clean(b.email, 200).toLowerCase();
        const code = clean(b.code, 6);
        const rec = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
        if (!rec) return json(res, 400, { ok: false, error: 'no_code' });
        if (rec.attempts >= 5) return json(res, 429, { ok: false, error: 'too_many' });
        if (new Date(rec.expires_at) < new Date()) return json(res, 400, { ok: false, error: 'expired' });
        if (rec.code_hash !== sha(code + email)) {
          db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
          return json(res, 400, { ok: false, error: 'wrong_code' });
        }
        db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);

        const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!existing) {
          // почты ещё нет — закрепляем её за текущим аккаунтом, всё написанное остаётся
          db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, u.id);
          return json(res, 200, { ok: true, merged: false, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
        }
        if (existing.id === u.id) return json(res, 200, { ok: true, merged: false, user: publicUser(existing) });

        // аккаунт с этой почтой уже есть — переключаем устройство на него
        newSession(existing.id, res, req.headers['user-agent']);
        const empty = !u.email && !db.prepare('SELECT 1 FROM entries WHERE user_id = ? LIMIT 1').get(u.id)
          && !db.prepare('SELECT 1 FROM journal WHERE user_id = ? LIMIT 1').get(u.id);
        if (empty) {                              // пустой анонимный профиль этого устройства не копим
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
          db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        }
        return json(res, 200, { ok: true, merged: true, user: publicUser(existing), day: dayPack(existing, d) });
      }

      if (p === '/api/auth/logout' && req.method === 'POST') {
        const tok = parseCookies(req).lunario_app;
        if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(tok));
        res.setHeader('Set-Cookie', `lunario_app=; Path=${BASE}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
        return json(res, 200, { ok: true });
      }

      if (p === '/api/cities' && req.method === 'GET')
        return json(res, 200, { items: findCities(url.searchParams.get('q') || '') });

      /* Событие продукта: что человек сделал. Тексты вопросов сюда не попадают. */
      if (p === '/api/event' && req.method === 'POST') {
        const b = await readBody(req);
        const type = clean(b.t, 40);
        if (!EVENT_TYPES.has(type)) return json(res, 400, { ok: false });
        db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)')
          .run(nowISO(), d, u.id, type, clean(b.d, 60), ageBand(u.birth));
        return json(res, 200, { ok: true });
      }

      /* «Хочу», когда откроется: замер спроса на то, чего ещё нет. */
      if (p === '/api/interest' && req.method === 'POST') {
        const b = await readBody(req);
        const feature = clean(b.feature, 40);
        if (!['subscription', 'expert', 'unlimited', 'artifacts', 'spreads', 'courses', 'constellation'].includes(feature)) return json(res, 400, { ok: false });
        const notify = b.notify === true;
        db.prepare('INSERT INTO interest (ts, user_id, feature, price, notify, email) VALUES (?,?,?,?,?,?)')
          .run(nowISO(), u.id, feature, feature === 'subscription' ? SUB_PRICE : '', notify ? 1 : 0, notify ? (u.email || '') : '');
        db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)')
          .run(nowISO(), d, u.id, 'paywall_click', feature, ageBand(u.birth));
        return json(res, 200, { ok: true, notify: notify && !!u.email });
      }

      if (p === '/api/me' && req.method === 'GET') {
        const used = db.prepare('SELECT spreads FROM usage WHERE user_id = ? AND day = ?').get(u.id, d);
        return json(res, 200, {
          user: publicUser(u), day: dayPack(u, d),
          mood: (db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, d) || {}).mood || null,
          moodStats: db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, d.slice(0, 7) + '%'),
          limits: { spreadsLeft: Math.max(0, spreadLimit(u) - (used ? used.spreads : 0)), spreadsTotal: spreadLimit(u) },
          price: SUB_PRICE,
          prices: { subscription: SUB_PRICE, unlimited: SUB_PRICE, expert: (process.env.EXPERT_PRICE || '2500 ₽ / консультация') },
          payReady: payReady(),
          plusUntil: u.plus_until || '',
          plusActive: hasPlus(u),
          mailReady: mailLive(),
          counts: {
            entries: db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = ?').get(u.id).c,
            wishes: db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ? AND done = 0').get(u.id).c,
          },
        });
      }

      if (p === '/api/profile' && req.method === 'POST') {
        const b = await readBody(req);
        const birth = clean(b.birth, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return json(res, 400, { ok: false, error: 'bad_birth' });
        if (b.consent !== true) return json(res, 400, { ok: false, error: 'no_consent' });
        const cityName = clean(b.city, 60);
        const geo = cityName ? cityByName(cityName) : null;   // координаты подставляются по названию
        db.prepare('UPDATE users SET name=?, birth=?, birth_time=?, city=?, city_region=?, lat=?, lon=?, tz=?, onboarded=1, consent_version=?, consent_ts=? WHERE id=?')
          .run(clean(b.name, 60), birth, clean(b.birthTime, 5), geo ? geo.name : cityName,
               geo ? [geo.region, geo.country].filter(Boolean).join(', ') : '', geo ? geo.lat : null, geo ? geo.lon : null, geo ? geo.tz : '',
               CONSENT_VERSION, nowISO(), u.id);
        const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
        return json(res, 200, { ok: true, user: publicUser(fresh), day: dayPack(fresh, d) });
      }

      if (p === '/api/ask' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        const kind = b.kind === 'rune' ? 'rune' : 'yesno';
        const topic = topicOf(q);
        let title, body;
        if (kind === 'rune') {
          const r = C.RUNES[hash32(q) % C.RUNES.length];
          title = `${r[0]} — ${r[1]}`; body = r[3];
          var extra = { path: r[2] };
        } else {
          const i = hash32(q) % 3;
          title = C.YN_VERDICTS[i]; body = C.YN_RIDERS[topic][i];
        }
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body) VALUES (?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, kind, seal(q), title, body);
        const prev = db.prepare("SELECT title, day FROM entries WHERE user_id=? AND kind='yesno' AND day<? AND title<>? ORDER BY id DESC LIMIT 1").get(u.id, d, title);
        return json(res, 200, { ok: true, kind, title, body, topic, ...(kind === 'rune' ? extra : {}), streak: touchStreak(u), memory: kind === 'yesno' && prev ? { title: prev.title, day: prev.day } : null });
      }

      if (p === '/api/spread' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        const row = db.prepare('SELECT spreads FROM usage WHERE user_id=? AND day=?').get(u.id, d);
        const used = row ? row.spreads : 0;
        if (used >= 2) return json(res, 429, { ok: false, error: 'limit' });
        const pos = ['Прошлое', 'Настоящее', 'Будущее'];
        const cards = pos.map((label, i) => {
          const a = C.ARCANA[hash32(`${u.id}:${q}:${i}`) % C.ARCANA.length];
          return { pos: label, name: a[0], text: a[1] };
        });
        db.prepare('INSERT INTO usage (user_id, day, spreads) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET spreads = spreads + 1').run(u.id, d);
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body) VALUES (?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, 'spread', seal(q), cards.map((c) => c.name).join(' · '), cards.map((c) => `${c.pos}: ${c.text}`).join(' '));
        return json(res, 200, { ok: true, cards, left: Math.max(0, spreadLimit(u) - used - 1), streak: touchStreak(u) });
      }

      if (p === '/api/ritual' && req.method === 'POST') return json(res, 200, { ok: true, streak: touchStreak(u) });

      if (p === '/api/mood' && req.method === 'POST') {
        const b = await readBody(req);
        const mood = clean(b.mood, 12);
        if (!['joy', 'calm', 'tired', 'anx', 'sad'].includes(mood)) return json(res, 400, { ok: false, error: 'bad_mood' });
        db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, mood);
        const month = d.slice(0, 7);
        const stats = db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, month + '%');
        return json(res, 200, { ok: true, mood, stats, streak: touchStreak(u) });
      }

      if (p === '/api/journal') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const text = clean(b.text, 2000);
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          db.prepare('INSERT INTO journal (user_id, ts, day, text) VALUES (?,?,?,?)').run(u.id, nowISO(), d, seal(text));
          return json(res, 200, { ok: true, streak: touchStreak(u) });
        }
        return json(res, 200, { items: db.prepare('SELECT day, text FROM journal WHERE user_id=? ORDER BY id DESC LIMIT 60').all(u.id).map((r) => ({ ...r, text: open_(r.text) })) });
      }

      if (p === '/api/wishes') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const text = clean(b.text, 200);
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          db.prepare('INSERT INTO wishes (user_id, ts, text) VALUES (?,?,?)').run(u.id, nowISO(), seal(text));
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          db.prepare('UPDATE wishes SET done = CASE done WHEN 1 THEN 0 ELSE 1 END, done_ts = ? WHERE id = ? AND user_id = ?').run(nowISO(), Number(b.id) || 0, u.id);
        }
        return json(res, 200, { items: db.prepare('SELECT id, text, done, ts FROM wishes WHERE user_id=? ORDER BY done, id DESC').all(u.id).map((r) => ({ ...r, text: open_(r.text) })) });
      }

      if (p === '/api/entries' && req.method === 'GET')
        return json(res, 200, { items: db.prepare('SELECT day, kind, question, title FROM entries WHERE user_id=? ORDER BY id DESC LIMIT 100').all(u.id).map((r) => ({ ...r, question: open_(r.question) })) });

      /* Оплата: создаём заказ (подписка или консультация) и отправляем на страницу оплаты. */
      if (p === '/api/pay' && req.method === 'POST') {
        if (!payReady()) return json(res, 503, { ok: false, error: 'pay_off' });
        const b = await readBody(req);
        const feature = ['subscription', 'unlimited', 'expert'].includes(b.feature) ? b.feature : 'subscription';
        const item = PAY_ITEMS[feature];
        const amount = item.amount();
        const ins = db.prepare('INSERT INTO payments (ts, user_id, feature, amount) VALUES (?,?,?,?)')
          .run(nowISO(), u.id, feature, amount);
        const orderId = `lun-${ins.lastInsertRowid}`;
        const params = {
          do: 'pay',
          order_id: orderId,
          products: [{ name: item.name, price: amount, quantity: '1' }],
          urlSuccess: `${PUBLIC_BASE}/app/?paid=ok`,
          urlReturn: `${PUBLIC_BASE}/app/?paid=no`,
          urlNotification: `${PUBLIC_BASE}/app/api/pay/webhook`,
          ...(u.email ? { customer_email: u.email } : {}),
        };
        db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)')
          .run(nowISO(), d, u.id, 'pay_start', feature, ageBand(u.birth));
        return json(res, 200, { ok: true, url: payLink(PAY_FORM, params, PAY_SECRET) });
      }

      /* Напоминание утром: браузер даёт адрес своей ячейки, мы его храним. */
      if (p === '/api/push' && req.method === 'GET')
        return json(res, 200, { key: PUSH.publicKey, on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id=?').get(u.id) });
      if (p === '/api/push' && req.method === 'POST') {
        const b = await readBody(req);
        const endpoint = clean(b.endpoint, 500);
        if (!/^https:\/\//.test(endpoint)) return json(res, 400, { ok: false });
        db.prepare('INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id')
          .run(endpoint, u.id, nowISO());
        return json(res, 200, { ok: true });
      }
      if (p === '/api/push' && req.method === 'DELETE') {
        db.prepare('DELETE FROM push_subs WHERE user_id=?').run(u.id);
        return json(res, 200, { ok: true });
      }

      /* Приглашение подруги: у каждого свой код. Пришла по ссылке — обеим
         на неделю открывается вдвое больше подробных разборов. */
      if (p === '/api/invite' && req.method === 'GET') {
        let code = u.ref_code;
        if (!code) {
          code = randomBytes(4).toString('hex');
          db.prepare('UPDATE users SET ref_code=? WHERE id=?').run(code, u.id);
        }
        const brought = db.prepare('SELECT COUNT(*) c FROM users WHERE invited_by=?').get(u.id).c;
        return json(res, 200, {
          link: `${PUBLIC_BASE}/app/?ref=${code}`,
          brought,
          bonusUntil: u.bonus_until || '',
          bonusActive: hasBonus(u),
        });
      }
      if (p === '/api/invite' && req.method === 'POST') {
        const b = await readBody(req);
        const code = clean(b.code, 16);
        if (!code || u.invited_by || u.ref_code === code) return json(res, 200, { ok: false });
        const host = db.prepare("SELECT * FROM users WHERE ref_code=? AND ref_code<>''").get(code);
        if (!host || host.id === u.id) return json(res, 200, { ok: false });
        const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
        db.prepare('UPDATE users SET invited_by=?, bonus_until=? WHERE id=?').run(host.id, until, u.id);
        db.prepare('UPDATE users SET bonus_until=? WHERE id=?').run(until, host.id);
        return json(res, 200, { ok: true, until });
      }

      /* Итог недели: сколько дней отмечено, какое состояние преобладало,
         о чём чаще спрашивали. Считается по фактам, без чтения текстов. */
      if (p === '/api/week' && req.method === 'GET') {
        const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
        const moods = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day>=? GROUP BY mood ORDER BY c DESC').all(u.id, since);
        const asked = db.prepare('SELECT kind, COUNT(*) c FROM entries WHERE user_id=? AND day>=? GROUP BY kind').all(u.id, since);
        const notes = db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id=? AND day>=?').get(u.id, since).c;
        const days = db.prepare('SELECT COUNT(DISTINCT day) c FROM moods WHERE user_id=? AND day>=?').get(u.id, since).c;
        const total = moods.reduce((s, m) => s + m.c, 0);
        const MOOD_RU = { joy: 'радостно', calm: 'спокойно', tired: 'устало', anx: 'тревожно', sad: 'грустно' };
        const KIND_RU = { yesno: 'вопросы «Да / Нет»', rune: 'руны', spread: 'расклады' };
        let summary = '';
        if (!total) summary = 'На этой неделе вы ещё не отмечали состояние. Одна отметка в день — и через неделю здесь появится картина.';
        else {
          const top = moods[0];
          const share = Math.round((top.c / total) * 100);
          summary = `Вы отмечались ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}. Чаще всего было ${MOOD_RU[top.mood] || top.mood} — ${share}% отметок.`;
          const calmish = moods.filter((m) => m.mood === 'calm' || m.mood === 'joy').reduce((s, m) => s + m.c, 0);
          if (calmish / total >= 0.6) summary += ' Неделя выдалась ровной.';
          else if ((total - calmish) / total >= 0.6) summary += ' Неделя была непростой — это видно по отметкам.';
        }
        return json(res, 200, {
          days, notes,
          moods: moods.map((m) => ({ mood: MOOD_RU[m.mood] || m.mood, count: m.c })),
          asked: asked.map((a) => ({ kind: KIND_RU[a.kind] || a.kind, count: a.c })),
          summary,
        });
      }

      if (p === '/api/numerology' && req.method === 'GET') {
        if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
        const dn = destinyNum(u.birth), py = personalYear(u.birth, Number(d.slice(0, 4))), dd = dayNum(d);
        return json(res, 200, {
          destiny: { n: dn, title: C.NUM_DESTINY[dn][0], text: C.NUM_DESTINY[dn][1], formula: numFormula(u.birth) },
          year: { n: py, year: Number(d.slice(0, 4)), text: C.NUM_YEAR[py] || C.NUM_YEAR[reduceNum(py)] },
          day: { n: dd, text: C.NUM_DAY[dd] },
        });
      }

      if (p === '/api/compat' && req.method === 'POST') {
        const b = await readBody(req);
        const other = clean(b.birth, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(other)) return json(res, 400, { ok: false, error: 'bad_birth' });
        if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
        const a = signOf(u.birth), o = signOf(other);
        const seed = hash32([u.birth, other].sort().join('|'));
        const mk = (k, lo, hi) => lo + (hash32(seed + k) % (hi - lo + 1));
        const rings = [['Эмоции', mk('e', 55, 95)], ['Общение', mk('c', 50, 95)], ['Быт', mk('b', 45, 90)], ['Страсть', mk('p', 55, 95)]];
        const total = Math.round(rings.reduce((s, r) => s + r[1], 0) / rings.length);
        return json(res, 200, {
          total, rings, you: a.name, other: o.name,
          text: `${a.name} и ${o.name}. Вы ${a.trait}; партнёр — ${o.trait}. Это союз, который растёт, когда каждый уважает темп другого.`,
        });
      }

      if (p === '/api/data' && req.method === 'DELETE') {
        for (const t of ['entries', 'moods', 'journal', 'wishes', 'usage']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id);
        db.prepare('UPDATE users SET streak = 0, streak_date = "" WHERE id = ?').run(u.id);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/account' && req.method === 'DELETE') {
        for (const t of ['entries', 'moods', 'journal', 'wishes', 'usage', 'sessions']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        res.setHeader('Set-Cookie', `lunario_app=; Path=${BASE}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: 'not_found' });
    }

    /* ── статика ── */
    if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html', 0);
    if (p === '/manifest.webmanifest') return serveStatic(res, 'manifest.webmanifest', 3600);
    if (p === '/sw.js') return serveStatic(res, 'sw.js', 0);
    if (req.method === 'GET' && !p.includes('..')) return serveStatic(res, p, 86400);
    res.writeHead(404); res.end();
  } catch (e) {
    if (e.message !== 'bad_json') console.error('[ошибка]', req.url, e.stack || e.message);
    json(res, e.message === 'bad_json' ? 400 : 500, { ok: false, error: e.message || 'server_error' });
  }
});
server.listen(PORT, HOST, () => console.log(`lunario-app: http://${HOST}:${PORT}${BASE} · site=${SITE_DIR} · db=${DATA_DIR}/app.db`));
