/* Лунарио — веб-приложение (PWA). Zero-dependency Node >=22.5 (node:sqlite).
   Слушает 127.0.0.1, за nginx. Своя папка и свой порт — не пересекается с лендингом.
   Аккаунт анонимный: httpOnly-cookie с токеном, e-mail можно привязать позже. */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { vapidKeys } from './push.mjs';
import * as C from './content.mjs';
import { personalExport } from './personal-export.mjs';
import { preferences, validPreferences, timeline } from './experience.mjs';
import { entryPage } from './entries.mjs';
import { initDailySets, dailySet } from './daily-sets.mjs';
import { privateText } from './private-text.mjs';
import { createPractices, parseRule, habitStreak, HABIT_MILESTONES } from './practices.mjs';
import { CONTENT_DIR, IMAGE_DIRS } from './content.mjs';
/* версия каталога — по дате последней правки текстов: экран перезапрашивает каталог, когда тексты обновились */
const catalogVersion = () => { try { return String(Math.floor(Math.max(statSync(new URL('./content.mjs', import.meta.url)).mtimeMs, ...readdirSync(CONTENT_DIR).filter(f=>f.endsWith('.txt')).map(f=>statSync(join(CONTENT_DIR,f)).mtimeMs)) / 1000)); } catch { return '2026-09-15'; } };
const contentFiles = () => readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.txt')).sort().map((name) => {
  const text = readFileSync(join(CONTENT_DIR, name), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  return { name, lines, size: text.length, mtime: statSync(join(CONTENT_DIR, name)).mtime.toISOString().slice(0, 16).replace('T', ' ') };
});
import { findCities, cityByName, tzOffsetMinutes } from './cities.mjs';
import { sendMail, mailReady, loginMail, staffMail, verifySmtp } from './mailer.mjs';
import { lunarDay, lunarPeriodText, moonState } from './lunar.mjs';
import { initCabinet, rolesFor, isAdmin, ADMIN_EMAILS, ROLES, staffList, staffSet, staffRemove, costAdd, costRemove, logError } from './cabinet.mjs';
import { initReports, overview, report, userCard, REPORT_META, OVERVIEW_BLOCKS, getConfig, setConfig, resetConfig } from './reports.mjs';
import * as W from './workspace.mjs';
import { natalChart } from './astro.mjs';
import { createShelves } from './shelves.mjs';
import { createBackup } from './backup.mjs';
import { skyNow } from './sky.mjs';
import { initReminders, FEATURES as REMINDER_FEATURES, listReminders, saveReminder, clearReminders, pendingFor, sendNow, askesisNativePlan, skyNativePlan, previewNotification } from './reminders.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5031);
const HOST = process.env.HOST || '127.0.0.1';
const SITE_DIR = process.env.SITE_DIR || join(__dirname, '..', 'site');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const BASE = process.env.BASE_PATH || '/app';
/* Резервные копии: ночью — cron (тот же backup.mjs), днём — кнопка в кабинете админа */
const BACKUP_DIR = process.env.BACKUP_DIR || join(__dirname, '..', 'backups');
const Backup = createBackup({ dataDir: DATA_DIR, contentDir: CONTENT_DIR, backupDir: BACKUP_DIR });
const CONSENT_VERSION = '2026-08-23';
const PUSH = vapidKeys(DATA_DIR);
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://lunario.online').replace(/\/+$/, '');
/* Что разрешено писать в аналитику. Текстов вопросов в списке нет намеренно. */
const EVENT_TYPES = new Set([
  'app_open', 'intro_view', 'tour_view', 'login_open', 'worry_pick', 'onboard_start', 'onboard_done', 'login_code_sent', 'login_done',
  'card_open', 'mood_set', 'ask_yesno', 'ask_rune', 'ask_spread', 'spread_limit',
  'journal_add', 'wish_add', 'compat_calc', 'share_card', 'install_prompt', 'installed',
  'invite_copy', 'invite_used', 'push_on', 'push_off',
  'support_open', 'support_new', 'utm_seen', 'natal_view', 'card_download',
  'reminder_on', 'reminder_off', 'reminder_test', 'habit_add', 'habit_mark', 'habit_award', 'askesis_start', 'askesis_mark', 'sky_view', 'lunar_view', 'moodreport_view',
  'gratitude_add', 'answer_add', 'news_view', 'wish_photo', 'photo_set', 'topics_set', 'topics_all', 'lunar_expand',
]);
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const {seal, open:open_} = privateText(DATA_DIR);
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
  /* Дневник привычек: привычка и отметки по дням */
  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
    created_at TEXT NOT NULL, archived INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS habit_marks (habit_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (habit_id, day));
  /* Аскеза: обещание себе на срок, отметки по дням с парой слов */
  CREATE TABLE IF NOT EXISTS askesis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, days INTEGER NOT NULL,
    started TEXT NOT NULL, status TEXT DEFAULT 'active', finished_at TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS askesis_days (askesis_id INTEGER NOT NULL, day TEXT NOT NULL, kept INTEGER DEFAULT 1, note TEXT DEFAULT '', PRIMARY KEY (askesis_id, day));
  /* Награды за непрерывные ежедневные привычки: 30, 60, 90, 180, 365 дней — каждая показывается один раз */
  CREATE TABLE IF NOT EXISTS habit_awards (habit_id INTEGER NOT NULL, days INTEGER NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (habit_id, days));
  /* Установка дня: какая выпала человеку в какой день — чтобы за год не повторяться */
  CREATE TABLE IF NOT EXISTS daily_sets (user_id INTEGER NOT NULL, day TEXT NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY (user_id, day));
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
  /* Кому слать напоминание про карту дня. */
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL, last_ok TEXT DEFAULT ''
  );
  /* Интерес к тому, чего ещё нет: подписка, эксперт, безлимит, артефакты. */
`);

const wishList = (userId) => db.prepare("SELECT id, text, done, ts, photo <> '' AS hasPhoto, photo_ts FROM wishes WHERE user_id=? ORDER BY done, id DESC").all(userId)
  .map((r) => ({ id: r.id, text: open_(r.text), done: r.done, ts: r.ts, photo: !!r.hasPhoto, photoTs: r.photo_ts || '' }));
/* Картинка приходит из телефона как data URL (jpeg/png/webp), уже уменьшенная; проверяем вид и размер */
function dataUrlOk(v, max) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  return m && m[2].length <= max * 1.37 ? String(v) : null;
}
function sendDataUrl(res, dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  const buf = Buffer.from(m[2], 'base64');
  res.writeHead(200, { 'Content-Type': m[1], 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
  return res.end(buf);
}

/* Привычки и аскезы — личное; стираются вместе с историей */
function wipePersonal(userId) {
  db.prepare('DELETE FROM habit_awards WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM daily_sets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM habit_marks WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM habits WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM askesis_days WHERE askesis_id IN (SELECT id FROM askesis WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM askesis WHERE user_id = ?').run(userId);
}

/* Приглашения: свой код у каждого и запись, кто кого привёл. */
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('ref_code')) db.exec("ALTER TABLE users ADD COLUMN ref_code TEXT DEFAULT ''");
  if (!cols.includes('invited_by')) db.exec('ALTER TABLE users ADD COLUMN invited_by INTEGER');
  if (!cols.includes('bonus_until')) db.exec("ALTER TABLE users ADD COLUMN bonus_until TEXT DEFAULT ''");
}

/* Дневник: вид записи (благодарность, ответ на вопрос дня) и заголовок; аскеза — до даты, а не на число дней;
   привычки — со своей регулярностью; фото у желаний и у аккаунта */
{
  const add = (table, col, def) => { const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
  add('journal', 'kind', "TEXT DEFAULT ''"); add('journal', 'title', "TEXT DEFAULT ''");
  add('askesis', 'until', "TEXT DEFAULT ''");
  db.exec("UPDATE askesis SET until = date(started, '+' || (days - 1) || ' days') WHERE until = ''");
  add('habits', 'rule', "TEXT DEFAULT 'daily'"); add('habits', 'rule_text', "TEXT DEFAULT ''");
  add('wishes', 'photo', "TEXT DEFAULT ''"); add('wishes', 'photo_ts', "TEXT DEFAULT ''");
  add('users', 'photo', "TEXT DEFAULT ''"); add('users', 'photo_ts', "TEXT DEFAULT ''");
}

/* История хранит не только текст, но и коды выпавших карт и рун — по ним расклад открывается заново */
{
  const cols = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  if (!cols.includes('data')) db.exec("ALTER TABLE entries ADD COLUMN data TEXT DEFAULT ''");
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

if (!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='preferences')) db.exec("ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT ''");
const {habitList, askesisList} = createPractices(db, open_);
initReminders(db, { habitList: (uid, d) => habitList(uid, d), askesisList: (uid, d) => askesisList(uid, d) });   /* напоминания по функциям; переносит прежнюю подписку на карту дня */
initCabinet(db);   /* таблицы кабинетов и колонка email_at — после миграций users */
initReports(db, DATA_DIR);
W.initWorkspace(db, DATA_DIR, seal, open_);

/* ── утилиты ── */
const MSK = 'Europe/Moscow';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: MSK }); // YYYY-MM-DD
const nowISO = () => new Date().toISOString();
const clean = (s, max) => String(s ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
/* Многострочные тексты (дневник, заметки, обращения): переносы строк — часть текста, убираем только прочие управляющие символы */
const cleanText = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const sha = (s) => createHash('sha256').update(s).digest('hex');
// код действует 15 минут; используется и на обычном входе, и при выдаче доступа сотруднику
function issueLoginCode(email) {
  const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
  db.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts)
    VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET
    code_hash = excluded.code_hash, created_at = excluded.created_at,
    expires_at = excluded.expires_at, attempts = 0`)
    .run(email, sha(code + email), nowISO(), new Date(Date.now() + 15 * 60000).toISOString());
  return code;
}
// сотруднику, которому только что назначили роль, шлём код входа сразу — не нужно самому запрашивать
async function notifyStaffAccess(email, roleKeys) {
  const names = (roleKeys || []).filter((r) => r !== 'user' && r in ROLES && r !== 'admin').map((r) => ROLES[r]);
  if (!names.length || !mailLive()) return;
  try {
    const code = issueLoginCode(email);
    const m = staffMail(names, code);
    await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
  } catch (e) {
    console.error('письмо о доступе не ушло:', e.message);
    logError('mail', e.message);
  }
}
/* Возрастная когорта вместо точного возраста: ядро аудитории 35+ смотрим отдельно,
   но саму дату рождения в аналитику не тащим. */
/* Личные тексты — вопросы, дневник, желания — лежат в базе зашифрованными.
   Ключ берётся из APP_SECRET в .env и в базу никогда не попадает: у того, кто
   получит только файл базы, останется набор нечитаемых строк.
   Записи, сделанные до включения шифрования, читаются как есть. */
/* Ключ создаётся сам при первом запуске и лежит рядом с базой, доступный только root.
   Файл базы без этого файла бесполезен. Терять ключ нельзя — записи станут нечитаемыми,
   поэтому он попадает в резервную копию вместе с базой. */
console.log('Личные записи шифруются перед записью в базу');

/* Подарок за приглашение действует неделю и удваивает число подробных разборов. */
const hasBonus = (u) => !!u.bonus_until && u.bonus_until >= today();
const spreadLimit = (u) => (hasBonus(u) ? 4 : 2);

/* Личные таблицы человека: их чистит «Очистить историю», при удалении аккаунта к ним добавляются сессии и подписки */
const PERSONAL_TABLES = ['entries', 'moods', 'journal', 'wishes', 'usage', 'shelves'];
/* Событие продукта: только тип, короткая деталь и возрастная когорта — без личных текстов */
const track = (u, type, detail = '') => db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)').run(nowISO(), today(), u.id, type, String(detail || '').slice(0, 60), ageBand(u.birth));
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
/* Личный год живёт от дня рождения до дня рождения: до него в календарном году действует число прошлого
   года, с него — новое. Родившийся 6 апреля 1984 в 2026-м до 6 апреля проживает год 1, с 6 апреля — год 2.
   Число всегда 1–9: тексты и картинки есть только для них, мастер-числа 11 и 22 сводятся дальше. */
function personalYearAt(birth, day) {
  const md = birth.slice(5), y = Number(day.slice(0, 4));
  const year = day.slice(5) >= md ? y : y - 1;                       // год, в котором начался текущий личный год
  const single = (n) => (n > 9 ? digits(n).reduce((a, b) => a + b, 0) : n);
  const bday = (yy) => md === '02-29' && !(yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0)) ? `${yy}-03-01` : `${yy}-${md}`;
  return {
    n: single(personalYear(birth, year)), year, from: bday(year), to: bday(year + 1),   // «to» — следующий день рождения, не включая
    next: { n: single(personalYear(birth, year + 1)), from: bday(year + 1), to: bday(year + 2) },
  };
}
const dayNum = (day) => { let n = reduceNum(digits(day).reduce((a, b) => a + b, 0)); return n > 9 ? reduceNum(digits(n).reduce((a, b) => a + b, 0)) : n; };
/* Фаза Луны — из lunar.mjs (ряды Меёса), та же модель, что у «На небе» и лунного дня */
const moonOf = (day) => moonState(Date.parse(day + 'T12:00:00Z'));

/* ── карты и руны: что уходит на экран (тексты экран берёт из каталога по коду) ── */
const cardPublic = (a) => ({ slug: a.slug, name: a.name, keys: a.keys, question: a.question, today: a.today, image: a.image });
const runePublic = (r) => ({ slug: r.slug, name: r.name, keyword: r.keyword, motto: r.motto, answer: r.answer, path: r.path, image: r.image });
/* Случайные и без повторов внутри одного расклада — как из настоящей колоды или мешочка. */
function drawDistinct(list, n) {
  const idx = [...Array(list.length).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, Math.min(n, idx.length)).map((i) => list[i]);
}
const parseData = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
/* Карта дня тянется один раз в день и живёт в истории; до открытия её нет. */
function cardOfDay(u, day) {
  const row = db.prepare("SELECT data FROM entries WHERE user_id=? AND day=? AND kind='card' ORDER BY id DESC LIMIT 1").get(u.id, day);
  const slug = (parseData(row && row.data) || {}).card;
  const a = slug ? C.ARCANA.find((c) => c.slug === slug) : null;
  return a ? cardPublic(a) : null;
}

/* Установка дня: случайная, без повторов в течение года у каждого человека. Выпавшая запоминается в daily_sets. */
initDailySets(db, C.LEGACY_SETS);
const setOfDay = (u, day) => dailySet(db, u, day, C.SETS);

/* ── персональный день ── */
function dayPack(u, day) {
  const seed = `${u.id}:${day}`;
  const set = setOfDay(u, day);
  const sign = u.birth ? signOf(u.birth) : null;
  const tone = C.DAY_TONES[hash32(seed + ':tone') % C.DAY_TONES.length];
  return {
    date: day,
    moon: moonOf(day).name,
    moonPhase: +moonOf(day).cycle.toFixed(3),          // доля цикла 0..1 — по ней рисуется луна
    // освещённость диска, а не доля цикла: при фазе 0.65 диск освещён на 79 %, не на 65
    moonPct: moonOf(day).illumination,
    card: cardOfDay(u, day),
    sign: sign ? sign.name : '',
    forecast: sign
      ? { title: tone[0], text: `${tone[1]} ${sign.trait[0].toUpperCase()}${sign.trait.slice(1)} — сегодня это особенно заметно.`, bars: tone[2] }
      : { title: tone[0], text: tone[1], bars: tone[2] },
    affirmation: (W.materialForDay('affirmation', day) || {}).text || C.AFFIRMATIONS[hash32(seed + ':aff') % C.AFFIRMATIONS.length],
    set,                            /* установка на главной и вопрос дня к ней */
    question: (set || {}).question || (W.materialForDay('question', day) || {}).text || C.DAY_QUESTIONS[hash32(seed + ':q') % C.DAY_QUESTIONS.length],
    lunar: lunarPack(u),
  };
}
/* Лунный день считается по месту рождения из анкеты (там же часовой пояс);
   без координат — Москва, как и всё остальное время в приложении. */
function lunarPack(u) {
  try {
    const ld = lunarDay(Date.now(), u.lat ?? 55.7558, u.lon ?? 37.6173);
    if (!ld) return null;
    const [title, advice] = C.LUNAR_DAYS[ld.n - 1] || ['', ''];
    const info = C.LUNAR_INFO.find((d) => d.n === ld.n);   /* тема и картинка — на открытку; само описание экран берёт из /api/lunar-days */
    return { n: ld.n, from: new Date(ld.from).toISOString(), to: ld.to ? new Date(ld.to).toISOString() : null, period: lunarPeriodText(ld, u.tz || 'Europe/Moscow'), title, advice,
      theme: info ? info.theme : '', symbol: info ? info.symbol : '', image: info ? info.image : '' };
  } catch (e) { return null; }
}
const topicOf = (q) => (C.TOPICS.find(([, re]) => re.test(q)) || ['self'])[0];
const testRate = new Map();
const MOOD_RU = new Proxy({}, { get: (_, k) => { if (String(k).startsWith('own:')) return String(k).slice(4); const m = C.moodInfo(k); return m ? m.label : String(k); } });
const moodTone = (k) => { const m = C.moodInfo(k); return m ? m.tone : '0'; };
/* Неделя по отметкам настроения — для «Итогов недели» и отчёта по настроениям */
function weekSummary(u) {
  const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const moods = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day>=? GROUP BY mood ORDER BY c DESC').all(u.id, since);
  const days = db.prepare('SELECT COUNT(DISTINCT day) c FROM moods WHERE user_id=? AND day>=?').get(u.id, since).c;
  const total = moods.reduce((s, m) => s + m.c, 0);
  let summary = '';
  if (!total) summary = 'На этой неделе вы ещё не отмечали состояние. Одна отметка в день — и через неделю здесь появится картина.';
  else {
    const top = moods[0];
    const share = Math.round((top.c / total) * 100);
    summary = `Вы отмечались ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}. Чаще всего — ${MOOD_RU[top.mood]}: ${share}% отметок.`;
    const plus = moods.filter((m) => moodTone(m.mood) === '+').reduce((s, m) => s + m.c, 0);
    const minus = moods.filter((m) => moodTone(m.mood) === '-').reduce((s, m) => s + m.c, 0);
    if (plus / total >= 0.6) summary += ' Неделя выдалась ровной и тёплой.';
    else if (minus / total >= 0.6) summary += ' Неделя была непростой — это видно по отметкам.';
  }
  return { since, moods, days, total, summary };
}
/* ── Привычки: регулярность задаёт человек словами, мы её понимаем ──
   daily — каждый день; weekdays — по будням; weekend — по выходным; alt — через день;
   days:1,3,5 — в выбранные дни недели (1 — понедельник); weekly — раз в неделю; times:N — N раз в неделю;
   monthly — раз в месяц. Непонятную формулировку сохраняем как свободный ритм. */
const validEndDate = (value, today) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value && value >= today;

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
  id: u.id,
  name: u.name, birth: u.birth, birthTime: u.birth_time, city: u.city,
  region: u.city_region || '', lat: u.lat ?? null, lon: u.lon ?? null, tz: u.tz || '',
  tzOffset: u.tz && u.birth ? tzOffsetMinutes(u.tz, `${u.birth}T${u.birth_time || '12:00'}:00`) : null,
  natalReady: !!(u.birth && u.lat != null && u.birth_time),
  signedIn: !!u.email,
  sign: u.birth ? signOf(u.birth).name : '', onboarded: !!u.onboarded, streak: u.streak,
  photo: !!u.photo, photoTs: u.photo_ts || '',
  streakToday: u.streak_date === today(), email: u.email,
  roles: rolesFor(u.email),   /* сотрудники после входа попадают в кабинет */
});

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBody(req, max = 32768) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serveStatic(res, rel, cacheSec = 3600, headOnly = false) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(SITE_DIR, safe);
  if (!file.startsWith(normalize(SITE_DIR)) || !existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': cacheSec ? `public, max-age=${cacheSec}${cacheSec >= 31536000 ? ', immutable' : ''}` : 'no-cache' });
  res.end(headOnly ? undefined : readFileSync(file));
}

/* ── маршруты ── */
/* ── полочки: досье каждого человека — «Обо мне», «Мой день», «Истории».
   Экран «Мои данные» показывает их человеку, разборы и гороскопы берут отсюда контекст. */
const natalOf = (u) => {
  const time = /^\d{2}:\d{2}$/.test(u.birth_time || '') ? u.birth_time : '';
  const tzOff = u.tz ? tzOffsetMinutes(u.tz, `${u.birth}T${time || '12:00'}:00`) : 0;
  return natalChart({ birth: u.birth, time, tzOffsetMin: tzOff, lat: u.lat ?? null, lon: u.lon ?? null });
};
const Shelves = createShelves({ db, seal, open: open_, C, signOf, destinyNum, personalYearAt, dayNum, topicOf, ageBand, cardOfDay, dayPack, habitList, askesisList, natal: natalOf, MOOD_RU, nowISO });
/* после этих действий полки пересобираются — уже после того, как ответ ушёл человеку */
const SHELF_TOUCH = new Set(['/api/profile', '/api/card', '/api/ask', '/api/spread', '/api/ritual', '/api/mood', '/api/journal', '/api/wishes', '/api/habits', '/api/askesis', '/api/compat', '/api/data', '/api/preferences']);
/* У тех, кто пришёл раньше полок, они собираются один раз при старте — по одному человеку, не задерживая запросы */
setTimeout(() => {
  const ids = db.prepare('SELECT id FROM users WHERE onboarded = 1 AND id NOT IN (SELECT user_id FROM shelves)').all().map((r) => r.id);
  if (!ids.length) return;
  console.log(`Полочки: собираются для ${ids.length} человек`);
  let i = 0;
  const step = () => { if (i >= ids.length) { console.log('Полочки: собраны'); return; } Shelves.refresh(ids[i++], today()); setImmediate(step); };
  step();
}, 3000).unref();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
    if (p === '' ) p = '/';

    if (p === '/api/health') return json(res, 200, { ok: true, service: 'lunario-app' });

    /* Каталог карт и рун: тексты, картинки, расклады. Личного здесь нет, поэтому кэшируется на 10 минут —
       правки в content/ доедут до людей не позже. */
    if (p === '/api/catalog' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(JSON.stringify({ cards: [...C.ARCANA], runes: [...C.RUNES], layouts: C.LAYOUTS, lunarDays: [...C.LUNAR_DAYS], askesisIdeas: [...C.ASKESIS_IDEAS], habitIdeas: [...C.HABIT_IDEAS],
        news: [...C.NEWS], quickMoods: C.QUICK_MOODS, moods: [...C.MOODS], moodFamilies: { ...C.MOOD_FAMILIES }, legacyMoods: C.LEGACY_MOODS,
        worries: [...C.WORRIES], awards: [...C.AWARDS], reminderTexts: Object.fromEntries(['card', 'mood', 'moodreport', 'habits', 'askesis', 'gratitude', 'lunar', 'sky'].map((k) => [k, C.REMINDER_TEXTS[k]])) }));
    }

    /* Лунные дни целиком: 30 статей с картинками и общие главы справочника. Личного нет, кэш как у каталога;
       экран «Лунный день» забирает это один раз, когда его открыли. */
    if (p === '/api/lunar-days' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(JSON.stringify({ days: [...C.LUNAR_INFO], reference: C.lunarRef(), topics: [...C.READING_TOPICS].map(({ key, label, def }) => ({ key, label, def })) }));
    }

    /* Сводка по продукту: сколько людей, что нажимают, кто вернулся.
       Закрыта паролем; личных текстов внутри нет — только счётчики. */


    /* ── API ── */
    if (p.startsWith('/api/')) {
      const u = getUser(req, res);
      const d = today();
      if (req.method !== 'GET' && SHELF_TOUCH.has(p) && u && u.id) { const uid = u.id; res.once('finish', () => Shelves.refresh(uid, d)); }

      /* ── рабочие кабинеты: роли по почте, единый дашборд, доступы ── */
      if (p.startsWith('/api/cabinet/')) {
        const roles = rolesFor(u.email);
        const cfg = getConfig();   // состав кабинетов задаёт админ; по умолчанию — из кода
        if (p === '/api/cabinet/me') return json(res, 200, { email: u.email || '', name: u.name || '', roles, isAdmin: isAdmin(u.email), mailReady: mailLive(), menus: cfg.menus, reports: cfg.reports, periods: cfg.periods, blocks: cfg.blocks, custom: cfg.custom });
        if (!roles.length) return json(res, 403, { ok: false, error: 'no_access' });
        const admin = roles.includes('admin');
        // роль проверяется на каждом запросе: скрытая кнопка — не защита
        const allowed = (kind) => admin || roles.some((r) => (cfg.menus[r] || []).includes(kind));
        if (p === '/api/cabinet/config') {
          if (req.method === 'GET') return json(res, 200, { ...cfg, defaults: { reports: REPORT_META, blocks: OVERVIEW_BLOCKS } });
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          if (req.method === 'POST') { const b = await readBody(req); const r = setConfig(b, u.email); if (r.ok) console.log(`[кабинет] ${u.email} изменил конфигурацию кабинетов`); return json(res, r.ok ? 200 : 400, r); }
          if (req.method === 'DELETE') { console.log(`[кабинет] ${u.email} сбросил конфигурацию кабинетов`); return json(res, 200, resetConfig()); }
        }
        if (p === '/api/cabinet/dashboard') {
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          return json(res, 200, overview(Object.fromEntries(url.searchParams)));
        }
        if (p === '/api/cabinet/report') {
          const kind = url.searchParams.get('kind') || '';
          if (!allowed(kind)) return json(res, 403, { ok: false, error: 'no_access' });
          const r = report(kind, Object.fromEntries(url.searchParams));
          if (!r) return json(res, 404, { ok: false, error: 'not_found' });
          if (kind === 'content') r.files = contentFiles();
          return json(res, 200, r);
        }
        /* ── резервные копии: список — всем, у кого есть «Здоровье системы»; снять и скачать — только админам ── */
        if (p === '/api/cabinet/backups' && req.method === 'GET') {
          if (!allowed('system')) return json(res, 403, { ok: false, error: 'no_access' });
          return json(res, 200, { ...Backup.list(), schedule: 'каждую ночь в 03:40 по серверу', keep: 14, admin });
        }
        if (p === '/api/cabinet/backups' && req.method === 'POST') {
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          try { const r = await Backup.run(true); console.log(`[кабинет] ${u.email} снял резервную копию: ${r.files.join(', ')}`); return json(res, 200, { ok: true, ...r }); }
          catch (e) { logError('/api/cabinet/backups', e.message); return json(res, 500, { ok: false, error: 'backup_failed', message: e.message }); }
        }
        if (p === '/api/cabinet/backups/download' && req.method === 'GET') {
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          const f = Backup.file(url.searchParams.get('name')); if (!f) return json(res, 404, { ok: false, error: 'not_found' });
          console.log(`[кабинет] ${u.email} скачал резервную копию ${basename(f)}`);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${basename(f)}"`, 'Cache-Control': 'no-store' });
          return res.end(readFileSync(f));
        }
        if (p === '/api/cabinet/user') {
          if (!allowed('users')) return json(res, 403, { ok: false, error: 'no_access' });
          const c = userCard(url.searchParams.get('id'));
          return c ? json(res, 200, c) : json(res, 404, { ok: false, error: 'not_found' });
        }
        if (p === '/api/cabinet/content') {
          if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
          const name = String(url.searchParams.get('file') || '');
          if (!contentFiles().some((f) => f.name === name)) return json(res, 404, { ok: false, error: 'not_found' });
          if (req.method === 'GET') return json(res, 200, { name, text: readFileSync(join(CONTENT_DIR, name), 'utf8') });
          if (req.method === 'POST') {
            const b = await readBody(req);
            const text = String(b.text || '');
            if (text.length > 200000) return json(res, 400, { ok: false, error: 'too_long' });
            writeFileSync(join(CONTENT_DIR, name), text, 'utf8');   // папка под наблюдением — тексты перечитаются сами
            console.log(`[контент] ${u.email} сохранил ${name} (${text.length} симв.)`);
            return json(res, 200, { ok: true });
          }
        }
        if (p === '/api/cabinet/campaigns') {
          if (!allowed('campaigns')) return json(res, 403, { ok: false, error: 'no_access' });
          if (req.method === 'GET') return json(res, 200, { items: W.campaignList() });
          if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.campaignSave(b, u.email)); }
          if (req.method === 'DELETE') return json(res, 200, W.campaignRemove(url.searchParams.get('id')));
        }
        if (p === '/api/cabinet/materials') {
          if (!allowed('materials')) return json(res, 403, { ok: false, error: 'no_access' });
          if (req.method === 'GET') return json(res, 200, { items: W.materialList(), kinds: W.MATERIAL_KINDS, statuses: W.MATERIAL_STATUS });
          if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.materialSave(b, u.email)); }
          if (req.method === 'DELETE') return json(res, 200, W.materialRemove(url.searchParams.get('id')));
        }
        if (p === '/api/cabinet/media/archive' && req.method === 'POST') {
          if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
          const b = await readBody(req); return json(res, 200, W.mediaArchive(b.id, !!b.on));
        }
        if (p === '/api/cabinet/media/download' && req.method === 'GET') {
          if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
          const f = W.mediaFile(url.searchParams.get('id')); if (!f) return json(res, 404, { ok: false, error: 'not_found' });
          res.writeHead(200, { 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'no-store' });
          return res.end(readFileSync(f.path));
        }
        if (p === '/api/cabinet/media') {
          if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
          if (req.method === 'GET') return json(res, 200, W.mediaList());
          if (req.method === 'POST') { const b = await readBody(req, 7 * 1024 * 1024); return json(res, 200, W.mediaAdd(b, u.email)); }
          if (req.method === 'DELETE') return json(res, 200, W.mediaRemove(url.searchParams.get('id')));
        }
        if (p === '/api/cabinet/ai' || p === '/api/cabinet/ai/check') {
          if (!allowed('ai')) return json(res, 403, { ok: false, error: 'no_access' });
          if (p.endsWith('/check') && req.method === 'POST') { const b = await readBody(req); return json(res, 200, await W.aiCheck(String(b.provider || ''))); }
          if (req.method === 'GET') return json(res, 200, { items: W.aiList() });
          if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.aiSave(b, u.email)); }
          if (req.method === 'DELETE') return json(res, 200, W.aiRemove(url.searchParams.get('provider')));
        }
        if (p === '/api/cabinet/tasks') {
          if (!allowed('backlog')) return json(res, 403, { ok: false, error: 'no_access' });
          // контент и поддержка видят только своё; продукт и админ — весь беклог
          const own = admin || roles.includes('product') ? '' : (roles.includes('content') && !roles.includes('support') ? 'content' : roles.includes('support') && !roles.includes('content') ? 'support' : '');
          if (req.method === 'GET') return json(res, 200, { items: own ? W.taskList(own) : W.taskList(url.searchParams.get('role') || ''), statuses: W.TASK_STATUS, roles: W.TASK_ROLES, canCreate: admin || roles.includes('product'), own });
          if (req.method === 'POST') {
            const b = await readBody(req);
            if (b.id && b.onlyStatus) return json(res, 200, W.taskStatus(b.id, b.status, u.email));
            if (!(admin || roles.includes('product'))) return json(res, 403, { ok: false, error: 'product_only' });
            return json(res, 200, W.taskSave(b, u.email));
          }
          if (req.method === 'DELETE') { if (!(admin || roles.includes('product'))) return json(res, 403, { ok: false, error: 'product_only' }); return json(res, 200, W.taskRemove(url.searchParams.get('id'))); }
        }
        if (p === '/api/cabinet/tickets' || p === '/api/cabinet/ticket') {
          if (!allowed('tickets')) return json(res, 403, { ok: false, error: 'no_access' });
          if (p.endsWith('/tickets')) return json(res, 200, { items: W.ticketQueue(url.searchParams.get('status') || ''), statuses: W.TICKET_STATUS, topics: W.TICKET_TOPICS });
          const id = url.searchParams.get('id');
          if (req.method === 'GET') { const t = W.ticketThread(id); return t ? json(res, 200, t) : json(res, 404, { ok: false, error: 'not_found' }); }
          if (req.method === 'POST') { const b = await readBody(req); if (b.text) { const r = W.ticketMessage(id, 'support', b.text, u.email); if (!r.ok) return json(res, 400, r); } if (b.status || b.priority || b.topic) W.ticketSet(id, b, u.email); return json(res, 200, { ok: true }); }
        }
        if (p === '/api/cabinet/staff') {
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          if (req.method === 'GET') return json(res, 200, { items: staffList(), admins: ADMIN_EMAILS });
          if (req.method === 'POST') {
            const b = await readBody(req);
            const r = staffSet(b.email, b.name, b.roles, u.email);
            if (r.ok) notifyStaffAccess(String(b.email || '').toLowerCase().trim(), Array.isArray(b.roles) ? b.roles : []);
            return json(res, 200, r);
          }
          if (req.method === 'DELETE') return json(res, 200, staffRemove(url.searchParams.get('email')));
        }
        if (p === '/api/cabinet/costs') {
          if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
          if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, costAdd(b.month, b.name, b.amount, b.kind)); }
          if (req.method === 'DELETE') return json(res, 200, costRemove(url.searchParams.get('id')));
        }
        return json(res, 404, { ok: false, error: 'not_found' });
      }

      /* ── натальная карта: считается на лету по анкете, ничего не хранится ── */
      if (p === '/api/natal' && req.method === 'GET') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(u.birth || '')) return json(res, 400, { ok: false, error: 'no_birth' });
        const time = /^\d{2}:\d{2}$/.test(u.birth_time || '') ? u.birth_time : '';
        // анкета старше координат или город записан не как в базе — доопределяем по названию и запоминаем
        if ((u.lat == null || !u.tz) && u.city) {
          const geo = cityByName(u.city);
          if (geo) { db.prepare('UPDATE users SET lat=?, lon=?, tz=?, city_region=? WHERE id=?').run(geo.lat, geo.lon, geo.tz, [geo.region, geo.country].filter(Boolean).join(', '), u.id); u.lat = geo.lat; u.lon = geo.lon; u.tz = geo.tz; }
        }
        const tzOff = u.tz ? tzOffsetMinutes(u.tz, `${u.birth}T${time || '12:00'}:00`) : 0;
        const chart = natalChart({ birth: u.birth, time, tzOffsetMin: tzOff, lat: u.lat ?? null, lon: u.lon ?? null });
        chart.tz = u.tz || ''; chart.city = u.city || ''; chart.cityFound = u.lat != null;
        chart.tzNote = u.tz ? `${u.tz}, UTC${tzOff >= 0 ? '+' : '−'}${Math.abs(tzOff) / 60}` + (time ? '' : ' (полдень)') : 'пояс не определён — время взято как UTC';
        track(u, 'natal_view', time ? 'with_time' : 'no_time');
        return json(res, 200, chart);
      }

      /* ── первый источник (UTM с лендинга или рекламы) — один раз ── */
      if (p === '/api/utm' && req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.setUtm(u.id, b)); }

      /* ── чат с поддержкой: человек видит только свои обращения ── */
      if (p === '/api/support/tickets') {
        if (req.method === 'GET') return json(res, 200, { items: W.userTickets(u.id), topics: W.TICKET_TOPICS });
        if (req.method === 'POST') { const b = await readBody(req); const r = W.ticketCreate(u.id, b); if (r.ok) track(u, 'support_new', b.topic); return json(res, r.ok ? 200 : 400, r); }
      }
      if (p === '/api/support/ticket') {
        const id = url.searchParams.get('id');
        if (req.method === 'GET') { const t = W.ticketThread(id, u.id); return t ? json(res, 200, t) : json(res, 404, { ok: false, error: 'not_found' }); }
        if (req.method === 'POST') { const b = await readBody(req); const r = W.ticketMessage(id, 'user', b.text, '', u.id); return json(res, r.ok ? 200 : 400, r); }
      }

      /* ── вход по коду на почту ── */
      if (p === '/api/auth/request' && req.method === 'POST') {
        const b = await readBody(req);
        const email = clean(b.email, 200).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) return json(res, 400, { ok: false, error: 'bad_email' });
        if (!allowRate(codeRate, clientIp(req), 5)) return json(res, 429, { ok: false, error: 'too_often' });
        if (!mailLive()) return json(res, 503, { ok: false, error: 'mail_off' });
        const code = issueLoginCode(email);
        try {
          const m = loginMail(code);
          await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
        } catch (e) {
          console.error('почта не ушла:', e.message);
          logError('mail', e.message);
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

        let existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!existing) {
          // почты ещё нет — закрепляем её за текущим аккаунтом, всё написанное остаётся
          db.prepare('UPDATE users SET email = ?, email_at = ? WHERE id = ?').run(email, nowISO(), u.id);
          return json(res, 200, { ok: true, merged: false, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
        }
        if (existing.id === u.id) return json(res, 200, { ok: true, merged: false, user: publicUser(existing) });

        // аккаунт с этой почтой уже есть — переключаем устройство на него
        newSession(existing.id, res, req.headers['user-agent']);
        if (u.onboarded && !existing.onboarded) {   // анкету только что заполнили на этом устройстве — она едет в найденный аккаунт
          db.prepare(`UPDATE users SET name=?, birth=?, birth_time=?, city=?, city_region=?, lat=?, lon=?, tz=?, onboarded=1,
                      consent_version=?, consent_ts=? WHERE id=?`)
            .run(u.name, u.birth, u.birth_time, u.city, u.city_region, u.lat, u.lon, u.tz, u.consent_version, u.consent_ts, existing.id);
          existing = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
        }
        const empty = !u.email && !db.prepare('SELECT 1 FROM entries WHERE user_id = ? LIMIT 1').get(u.id)
          && !db.prepare('SELECT 1 FROM journal WHERE user_id = ? LIMIT 1').get(u.id)
          && !u.photo && !u.preferences
          && !['wishes','habits','askesis','moods'].some(table=>db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? LIMIT 1`).get(u.id));
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
        track(u, type, clean(b.d, 60));
        if (type === 'lunar_view') {   /* сколько раз открывал лунный день: ряд тем появляется со второго открытия */
          const pr = preferences(u.preferences); if ((pr.lunarViews || 0) < 99) db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify({ ...pr, lunarViews: (pr.lunarViews || 0) + 1 }), u.id);
        }
        return json(res, 200, { ok: true });
      }


      if (p === '/api/me' && req.method === 'GET') {
        const used = db.prepare('SELECT spreads FROM usage WHERE user_id = ? AND day = ?').get(u.id, d);
        return json(res, 200, {
          user: publicUser(u), day: dayPack(u, d), catalogV: catalogVersion(), preferences: preferences(u.preferences),
          mood: (db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, d) || {}).mood || null,
          moodStats: db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, d.slice(0, 7) + '%'),
          limits: { spreadsLeft: Math.max(0, spreadLimit(u) - (used ? used.spreads : 0)), spreadsTotal: spreadLimit(u) },
          mailReady: mailLive(),
          supportUnread: W.userUnread(u.id),
          counts: {
            entries: db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = ?').get(u.id).c,
            wishes: db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ? AND done = 0').get(u.id).c,
          },
        });
      }

      if (p === '/api/data/export' && req.method === 'GET') return json(res,200,personalExport(db,u,open_));

      if (p === '/api/preferences') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (!validPreferences(b)) return json(res,400,{error:'bad_preferences'});
          const prev = preferences(u.preferences), known = new Set([...C.READING_TOPICS].map((t) => t.key));
          const topics = b.topics ? [...new Set(b.topics.filter((k) => known.has(k)))] : (prev.topics || []);
          /* lunarViews — служебный счётчик, его ведёт сервер по событию lunar_view; с клиента не принимается */
          const value = {theme:b.theme,ritual:b.ritual,topics,topicsAll:b.topicsAll !== undefined ? !!b.topicsAll : !!prev.topicsAll,lunarViews:prev.lunarViews||0};
          db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(value),u.id);
          return json(res,200,{preferences:value});
        }
        return json(res,200,{preferences:preferences(u.preferences)});
      }
      if (p === '/api/timeline' && req.method === 'GET') return json(res,200,timeline(db,u.id,url.searchParams,open_));

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

      /* Карта дня: тянется случайно, один раз в день, и сразу ложится в историю. Повторное нажатие
         возвращает ту же карту — колода на сегодня уже открыта. */
      if (p === '/api/card' && req.method === 'POST') {
        let card = cardOfDay(u, d);
        if (!card) {
          const a = drawDistinct([...C.ARCANA], 1)[0];
          db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
            .run(u.id, nowISO(), d, 'card', '', a.name, a.keys, JSON.stringify({ card: a.slug }));
          card = cardPublic(a);
        }
        return json(res, 200, { ok: true, card, streak: touchStreak(u) });
      }

      if (p === '/api/ask' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        const kind = b.kind === 'rune' ? 'rune' : 'yesno';
        const topic = topicOf(q);
        let title, body, extra = {}, stored = kind, data = '';
        if (kind === 'rune') {
          /* руны выпадают случайно, без повторов внутри расклада; одна руна — kind «rune», расклад — «runes» */
          const L = C.LAYOUTS.rune[b.layout] ? b.layout : 'one';
          const pos = C.LAYOUTS.rune[L].pos;
          const runes = drawDistinct([...C.RUNES], pos.length).map((r, i) => ({ pos: pos[i].name, ...runePublic(r) }));
          title = runes.map((r) => r.name).join(' · ');
          body = L === 'one' ? runes[0].answer : runes.map((r) => `${r.pos}: ${r.name} — ${r.answer}`).join(' ');
          stored = L === 'one' ? 'rune' : 'runes';
          data = JSON.stringify({ layout: L, runes: runes.map((r) => r.slug) });
          extra = { layout: L, runes, path: runes[0].path };
        } else {
          const i = hash32(q) % 3;
          title = C.YN_VERDICTS[i]; body = C.YN_RIDERS[topic][i];
        }
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, stored, seal(q), title, body, data);
        const prev = db.prepare("SELECT title, day FROM entries WHERE user_id=? AND kind='yesno' AND day<? AND title<>? ORDER BY id DESC LIMIT 1").get(u.id, d, title);
        return json(res, 200, { ok: true, kind, title, body, topic, ...extra, streak: touchStreak(u), memory: kind === 'yesno' && prev ? { title: prev.title, day: prev.day } : null });
      }

      if (p === '/api/spread' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        const row = db.prepare('SELECT spreads FROM usage WHERE user_id=? AND day=?').get(u.id, d);
        const used = row ? row.spreads : 0;
        if (used >= spreadLimit(u)) return json(res, 429, { ok: false, error: 'limit' });
        /* карты выпадают случайно и не повторяются внутри расклада; любой расклад — один разбор из дневного лимита */
        const L = C.LAYOUTS.tarot[b.layout] ? b.layout : 'three';
        const pos = C.LAYOUTS.tarot[L].pos;
        const cards = drawDistinct([...C.ARCANA], pos.length).map((a, i) => ({ pos: pos[i].name, ...cardPublic(a) }));
        db.prepare('INSERT INTO usage (user_id, day, spreads) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET spreads = spreads + 1').run(u.id, d);
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, 'spread', seal(q), cards.map((c) => c.name).join(' · '), cards.map((c) => `${c.pos}: ${c.name} — ${c.keys}`).join(' '),
               JSON.stringify({ layout: L, cards: cards.map((c) => c.slug) }));
        return json(res, 200, { ok: true, layout: L, cards, left: Math.max(0, spreadLimit(u) - used - 1), streak: touchStreak(u) });
      }

      if (p === '/api/ritual' && req.method === 'POST') return json(res, 200, { ok: true, streak: touchStreak(u) });

      if (p === '/api/mood' && req.method === 'POST') {
        const b = await readBody(req);
        const mood = clean(b.mood, 30);
        const own = /^own:[^\s|]{1,24}$/u.test(mood);   /* своё слово: «own:собранно» */
        if (!own && !C.moodInfo(mood)) return json(res, 400, { ok: false, error: 'bad_mood' });
        db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, mood);
        const month = d.slice(0, 7);
        const stats = db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, month + '%');
        return json(res, 200, { ok: true, mood, stats, streak: touchStreak(u) });
      }

      /* Дневник: обычная запись, благодарность («кому и за что я благодарна сегодня») или ответ на вопрос дня.
         Всё лежит в одной ленте, вид записи подписан. */
      if (p === '/api/journal') {
        if (req.method === 'PATCH') {
          const b = await readBody(req), text = cleanText(b.text, 2000);
          const item = db.prepare("SELECT id, day FROM journal WHERE id=? AND user_id=? AND kind='gratitude'").get(Number(b.id) || 0, u.id);
          if (!item) return json(res, 404, { ok: false, error: 'not_found' });
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          db.prepare('UPDATE journal SET text=? WHERE id=? AND user_id=?').run(seal(text), item.id, u.id);
          return json(res, 200, { ok: true, item: { ...item, text } });
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          const text = cleanText(b.text, 2000);
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          const kind = ['gratitude', 'answer'].includes(b.kind) ? b.kind : '';
          const title = clean(b.title, 300);
          const inserted = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title));
          if (kind) track(u, kind === 'gratitude' ? 'gratitude_add' : 'answer_add', '');
          return json(res, 200, { ok: true, streak: touchStreak(u), item: { id: Number(inserted.lastInsertRowid), day: d, text, kind, title } });
        }
        const kind = url.searchParams.get('kind');
        const rows = kind ? db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? AND kind=? ORDER BY id DESC LIMIT 60').all(u.id, kind)
          : db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? ORDER BY id DESC LIMIT 60').all(u.id);
        return json(res, 200, { items: rows.map((r) => ({ ...r, text: open_(r.text), title: open_(r.title || '') })), today: !!(kind && rows.find((r) => r.day === d)) });
      }

      /* Фото у желания — картинка для визуализации. Уменьшается в телефоне, хранится как есть, отдаётся только хозяйке. */
      if (p === '/api/wishes/photo') {
        const id = Number(url.searchParams.get('id') || 0);
        if (req.method === 'GET') {
          const w = db.prepare('SELECT photo FROM wishes WHERE id = ? AND user_id = ?').get(id, u.id);
          if (!w || !w.photo) { res.writeHead(404); return res.end(); }
          return sendDataUrl(res, w.photo);
        }
        if (req.method === 'POST') {
          const b = await readBody(req, 1024 * 1024);
          const wid = Number(b.id) || 0;
          if (!db.prepare('SELECT 1 FROM wishes WHERE id = ? AND user_id = ?').get(wid, u.id)) return json(res, 404, { ok: false, error: 'not_found' });
          const photo = dataUrlOk(b.photo, 600 * 1024); if (!photo) return json(res, 400, { ok: false, error: 'bad_photo' });
          db.prepare('UPDATE wishes SET photo = ?, photo_ts = ? WHERE id = ?').run(photo, nowISO(), wid);
          track(u, 'wish_photo', '');
        }
        if (req.method === 'DELETE') db.prepare("UPDATE wishes SET photo = '', photo_ts = '' WHERE id = ? AND user_id = ?").run(id, u.id);
        return json(res, 200, { items: wishList(u.id) });
      }
      /* Своё фото в аккаунте — показывается в кружке в правом верхнем углу */
      if (p === '/api/photo') {
        if (req.method === 'GET') { if (!u.photo) { res.writeHead(404); return res.end(); } return sendDataUrl(res, u.photo); }
        if (req.method === 'POST') {
          const b = await readBody(req, 512 * 1024);
          const photo = dataUrlOk(b.photo, 300 * 1024); if (!photo) return json(res, 400, { ok: false, error: 'bad_photo' });
          db.prepare('UPDATE users SET photo = ?, photo_ts = ? WHERE id = ?').run(photo, nowISO(), u.id);
          track(u, 'photo_set', '');
        }
        if (req.method === 'DELETE') db.prepare("UPDATE users SET photo = '', photo_ts = '' WHERE id = ?").run(u.id);
        return json(res, 200, { ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
      }

      if (p === '/api/wishes') {
        if (req.method === 'POST') {
          const b = await readBody(req, 1024 * 1024);
          const text = clean(b.text, 200);
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          const photo=b.photo ? dataUrlOk(b.photo,600*1024) : '';
          if (b.photo && !photo) return json(res,400,{error:'bad_photo'});
          db.prepare('INSERT INTO wishes (user_id, ts, text, photo, photo_ts) VALUES (?,?,?,?,?)').run(u.id, nowISO(), seal(text),photo,photo?nowISO():'');
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          db.prepare('UPDATE wishes SET done = CASE done WHEN 1 THEN 0 ELSE 1 END, done_ts = ? WHERE id = ? AND user_id = ?').run(nowISO(), Number(b.id) || 0, u.id);
        }
        return json(res, 200, { items: wishList(u.id) });
      }

      if (p === '/api/entries' && req.method === 'GET')
        return json(res, 200, entryPage(db,u.id,url.searchParams,open_));


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
        const w = weekSummary(u);
        const asked = db.prepare('SELECT kind, COUNT(*) c FROM entries WHERE user_id=? AND day>=? GROUP BY kind').all(u.id, w.since);
        const notes = db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id=? AND day>=?').get(u.id, w.since).c;
        const KIND_RU = { yesno: 'вопросы «Да / Нет»', rune: 'руны', runes: 'расклады рун', spread: 'расклады Таро', card: 'карты дня' };
        return json(res, 200, {
          days: w.days, notes,
          moods: w.moods.map((m) => ({ mood: MOOD_RU[m.mood] || m.mood, count: m.c })),
          asked: asked.map((a) => ({ kind: KIND_RU[a.kind] || a.kind, count: a.c })),
          summary: w.summary,
        });
      }

      /* Отчёт по настроениям: неделя по дням, месяц по долям, итог словами */
      if (p === '/api/mood/report' && req.method === 'GET') {
        const w = weekSummary(u);
        const week = [];
        for (let i = 6; i >= 0; i--) {
          const day = new Date(Date.parse(d) - i * 864e5).toISOString().slice(0, 10);
          const row = db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, day);
          week.push({ day, mood: row ? row.mood : '' });
        }
        const month = d.slice(0, 7);
        const stats = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id = ? AND day LIKE ? GROUP BY mood ORDER BY c DESC').all(u.id, month + '%');
        const total = db.prepare('SELECT COUNT(*) c FROM moods WHERE user_id = ?').get(u.id).c;
        const monthEntries=db.prepare('SELECT day,mood FROM moods WHERE user_id=? AND day LIKE ? ORDER BY day').all(u.id,month+'%');
        return json(res, 200, { week, month: { key: month, stats, entries:monthEntries, days: stats.reduce((s, m) => s + m.c, 0) }, total, summary: w.summary, labels: MOOD_RU });
      }

      /* ── напоминания по функциям ── */
      if (p === '/api/reminders/preview' && req.method === 'GET') {
        const item = previewNotification(u, url.searchParams.get('feature'));
        return json(res, item ? 200 : 400, item ? { item } : { error: 'bad_feature' });
      }
      if (p === '/api/reminders/sky-plan' && req.method === 'GET')
        return json(res, 200, skyNativePlan(u, url.searchParams.get('feature')));
      if (p === '/api/reminders/askesis-plan' && req.method === 'GET') return json(res, 200, askesisNativePlan(u.id));
      if (p === '/api/reminders' && req.method === 'GET')
        return json(res, 200, { items: listReminders(u.id), push: { on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id = ?').get(u.id), key: PUSH.publicKey } });
      if (p === '/api/reminders' && req.method === 'POST') {
        const b = await readBody(req);
        const r = saveReminder(u.id, b);
        if (!r.ok) return json(res, 400, r);
        if (b.enabled !== undefined) track(u, b.enabled ? 'reminder_on' : 'reminder_off', b.feature);
        return json(res, 200, r);
      }
      if (p === '/api/reminders/test' && req.method === 'POST') {
        const b = await readBody(req);
        if (!allowRate(testRate, String(u.id), 3)) return json(res, 429, { ok: false, error: 'too_many' });
        const r = await sendNow(u, String(b.feature || 'card'), PUSH, clean(b.endpoint, 500));
        if (r.ok) track(u, 'reminder_test', b.feature);
        return json(res, r.ok ? 200 : 400, r);
      }
      /* сигнал пришёл — service worker забирает тексты, которые ещё не показывал на этом устройстве */
      if (p === '/api/push/next' && req.method === 'POST') {
        const b = await readBody(req);
        return json(res, 200, { items: pendingFor(u.id, clean(b.endpoint, 500)) });
      }

      /* ── дневник привычек: список с регулярностью, карточка дня, награды ── */
      if (p === '/api/habits') {
        let award = null;
        if (req.method === 'POST') {
          const b = await readBody(req);
          const title = clean(b.title, 80), ruleText = clean(b.rule, 60);
          if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
          if (db.prepare('SELECT COUNT(*) c FROM habits WHERE user_id = ? AND archived = 0').get(u.id).c >= 20) return json(res, 400, { ok: false, error: 'too_many' });
          db.prepare('INSERT INTO habits (user_id, title, created_at, rule, rule_text) VALUES (?,?,?,?,?)').run(u.id, seal(title), nowISO(), parseRule(ruleText), ruleText);
          touchStreak(u);
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(Number(b.id) || 0, u.id);
          if (!h) return json(res, 404, { ok: false, error: 'not_found' });
          if (b.rule !== undefined || b.title !== undefined) {   // правка названия или регулярности
            const ruleText = b.rule !== undefined ? clean(b.rule, 60) : h.rule_text, title = b.title !== undefined ? clean(b.title, 80) : open_(h.title);
            if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
            db.prepare('UPDATE habits SET title = ?, rule = ?, rule_text = ? WHERE id = ?').run(seal(title), parseRule(ruleText), ruleText, h.id);
          } else {
            const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') && b.day <= d && Date.parse(d) - Date.parse(b.day) <= 6 * 864e5 ? b.day : d;
            if (db.prepare('SELECT 1 FROM habit_marks WHERE habit_id = ? AND day = ?').get(h.id, day)) db.prepare('DELETE FROM habit_marks WHERE habit_id = ? AND day = ?').run(h.id, day);
            else {
              db.prepare('INSERT INTO habit_marks (habit_id, day) VALUES (?,?)').run(h.id, day); if (day === d) touchStreak(u);
              /* ежедневная привычка дошла до рубежа — награда, один раз */
              if ((h.rule || 'daily') === 'daily') {
                const marks = new Set(db.prepare('SELECT day FROM habit_marks WHERE habit_id = ?').all(h.id).map((m) => m.day));
                const streak = habitStreak(h, d, marks);
                if (HABIT_MILESTONES.includes(streak) && !db.prepare('SELECT 1 FROM habit_awards WHERE habit_id = ? AND days = ?').get(h.id, streak)) {
                  db.prepare('INSERT INTO habit_awards (habit_id, days, ts) VALUES (?,?,?)').run(h.id, streak, nowISO());
                  track(u, 'habit_award', streak);
                  award = { habitId: h.id, title: open_(h.title), days: streak };
                }
              }
            }
          }
        } else if (req.method === 'DELETE') {
          db.prepare('UPDATE habits SET archived = 1 WHERE id = ? AND user_id = ?').run(Number(url.searchParams.get('id')) || 0, u.id);
        }
        return json(res, 200, { items: habitList(u.id, d), streak: u.streak, award });
      }

      /* ── аскеза: до даты, поддержка и счёт дней, заметки по желанию ── */
      if (p === '/api/askesis') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          const title = clean(b.title, 80), until = String(b.until || '');
          if (title.length < 2) return json(res, 400, { ok: false, error: 'short' });
          if (!validEndDate(until, d)) return json(res, 400, { ok: false, error: 'bad_until' });
          if (db.prepare("SELECT COUNT(*) c FROM askesis WHERE user_id = ? AND status = 'active'").get(u.id).c >= 5) return json(res, 400, { ok: false, error: 'too_many' });
          const days = Math.round((Date.parse(until) - Date.parse(d)) / 864e5) + 1;
          db.prepare('INSERT INTO askesis (user_id, title, days, started, until) VALUES (?,?,?,?,?)').run(u.id, seal(title), days, d, until);
          touchStreak(u);
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          const a = db.prepare("SELECT * FROM askesis WHERE id = ? AND user_id = ? AND status = 'active'").get(Number(b.id) || 0, u.id);
          if (!a) return json(res, 404, { ok: false, error: 'not_found' });
          if (b.until !== undefined) {                                   // передвинуть дату
            const until = String(b.until || '');
            if (!validEndDate(until, d)) return json(res, 400, { ok: false, error: 'bad_until' });
            db.prepare('UPDATE askesis SET until = ?, days = ? WHERE id = ?').run(until, Math.round((Date.parse(until) - Date.parse(a.started)) / 864e5) + 1, a.id);
          } else {                                                       // заметка-наблюдение за сегодня
            const note = cleanText(b.note, 500);
            db.prepare('INSERT INTO askesis_days (askesis_id, day, kept, note) VALUES (?,?,1,?) ON CONFLICT(askesis_id, day) DO UPDATE SET note = excluded.note').run(a.id, d, seal(note));
            touchStreak(u);
          }
        } else if (req.method === 'DELETE') {
          db.prepare("UPDATE askesis SET status = 'stopped', finished_at = ? WHERE id = ? AND user_id = ? AND status = 'active'").run(d, Number(url.searchParams.get('id')) || 0, u.id);
        }
        return json(res, 200, askesisList(u.id, d));
      }

      /* ── на небе: сейчас и ближайшие недели ── */
      if (p === '/api/sky' && req.method === 'GET') return json(res, 200, skyNow(Date.now(), u.tz || 'Europe/Moscow'));

      /* ── полочки: что Лунарио знает о человеке — три полки и досье текстом для разборов ── */
      if (p === '/api/shelves' && req.method === 'GET') return json(res, 200, Shelves.read(u, d));
      if (p === '/api/shelves/context' && req.method === 'GET') return json(res, 200, { text: Shelves.contextText(Shelves.read(u, d)) });

      if (p === '/api/numerology' && req.method === 'GET') {
        if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
        const dn = destinyNum(u.birth), dd = dayNum(d), py = personalYearAt(u.birth, d);
        return json(res, 200, {
          destiny: { n: dn, title: C.NUM_DESTINY[dn][0], text: C.NUM_DESTINY[dn][1], formula: numFormula(u.birth) },
          year: { ...py, text: C.NUM_YEAR[py.n], info: C.YEARS[py.n] || null },
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
          // черта знака в контенте может уже начинаться с «вы …» — не дублируем обращение
          text: `${a.name} и ${o.name}. ${/^вы\s/i.test(a.trait) ? a.trait[0].toUpperCase() + a.trait.slice(1) : 'Вы ' + a.trait}; партнёр — ${o.trait}. Это союз, который растёт, когда каждый уважает темп другого.`,
        });
      }

      if (p === '/api/data' && req.method === 'DELETE') {
        for (const t of PERSONAL_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id);
        wipePersonal(u.id);
        db.prepare("UPDATE users SET streak = 0, streak_date = '' WHERE id = ?").run(u.id);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/account' && req.method === 'DELETE') {
        for (const t of [...PERSONAL_TABLES, 'sessions', 'push_subs']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id);
        wipePersonal(u.id); clearReminders(u.id);
        // замер интереса остаётся (обезличенный факт клика), но почта и просьба «сообщите» уходят вместе с аккаунтом
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        res.setHeader('Set-Cookie', `lunario_app=; Path=${BASE}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: 'not_found' });
    }

    /* ── статика ── */
    /* картинки контента: /app/content/tarot/fool.jpg → <папка контента>/картинки/таро/fool.jpg.
       Папка контента живёт отдельно от кода (на сервере — /opt/lunario-content) и в git не попадает. */
    if (p.startsWith('/content/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const [kind, file] = p.slice('/content/'.length).split('/');
      const dir = IMAGE_DIRS[kind];
      if (!dir || !file || !/^[\w.-]+$/.test(file) || file.startsWith('.')) { res.writeHead(404); return res.end(); }
      const f = join(CONTENT_DIR, 'картинки', dir, file);
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': url.search.includes('v=') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    }
    if (p.startsWith('/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const f = W.mediaPath(p.slice('/uploads/'.length));
      if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    }
    if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html', 0);
    if (p === '/cabinet' || p === '/cabinet/') return serveStatic(res, 'cabinet.html', 0);
    if (p === '/manifest.webmanifest') return serveStatic(res, 'manifest.webmanifest', 0);
    if (p === '/sw.js') return serveStatic(res, 'sw.js', 0);
    if ((req.method === 'GET' || req.method === 'HEAD') && !p.includes('..')) return serveStatic(res, p, url.search.includes('v=') ? 31536000 : 86400, req.method === 'HEAD');
    res.writeHead(404); res.end();
  } catch (e) {
    if (e.message !== 'bad_json') { console.error('[ошибка]', req.url, e.stack || e.message); logError(req.url, e.message); }
    json(res, e.message === 'bad_json' ? 400 : 500, { ok: false, error: e.message || 'server_error' });
  }
});
server.listen(PORT, HOST, () => console.log(`lunario-app: http://${HOST}:${PORT}${BASE} · site=${SITE_DIR} · db=${DATA_DIR}/app.db`));
