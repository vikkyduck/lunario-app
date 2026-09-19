/* Лунарио — веб-приложение (PWA). Zero-dependency Node >=22.5 (node:sqlite).
   Слушает 127.0.0.1, за nginx. Своя папка и свой порт — не пересекается с лендингом.
   Аккаунт анонимный: httpOnly-cookie с токеном, e-mail можно привязать позже. */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname, normalize, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { vapidKeys, pushEndpointOk } from './push.mjs';
import * as C from './content.mjs';
import { personalExport } from './personal-export.mjs';
import { personalExportPdf } from './personal-export-pdf.mjs';
import { installPage } from './install-guide.mjs';
import { installPdf } from './install-pdf.mjs';
import { preferences, validPreferences, timeline, morningOf } from './experience.mjs';
import { entryPage } from './entries.mjs';
import { initDailySets, dailySet } from './daily-sets.mjs';
import { privateText } from './private-text.mjs';
import { createPractices, parseRule, habitStreak } from './practices.mjs';
import { CONTENT_DIR, IMAGE_DIRS, noYo } from './content.mjs';
import { MSK, MOSCOW, ISO_DAY, dayIn, addDays } from './util.mjs';
/* версия каталога — по дате последней правки текстов: экран перезапрашивает каталог, когда тексты обновились */
const catalogVersion = () => { try { return String(Math.floor(Math.max(statSync(new URL('./content.mjs', import.meta.url)).mtimeMs, ...readdirSync(CONTENT_DIR).filter(f=>f.endsWith('.txt')).map(f=>statSync(join(CONTENT_DIR,f)).mtimeMs)) / 1000)); } catch { return '2026-09-15'; } };
/* Тексты приложения читает и правит кабинет контента; папка под наблюдением — правки перечитываются сами */
const readContent = (name) => readFileSync(join(CONTENT_DIR, name), 'utf8');
const writeContent = (name, text) => writeFileSync(join(CONTENT_DIR, name), noYo(text), 'utf8');   /* из кабинета — тоже без «е с точками» */
const contentFiles = () => readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.txt')).sort().map((name) => {
  const text = readFileSync(join(CONTENT_DIR, name), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  return { name, lines, size: text.length, mtime: statSync(join(CONTENT_DIR, name)).mtime.toISOString().slice(0, 16).replace('T', ' ') };
});
import { findCities, cityByName, tzOffsetMinutes } from './cities.mjs';
import { sendMail, mailReady, loginMail, staffMail, deleteMail, verifySmtp } from './mailer.mjs';
import { lunarDay, lunarPeriodText, moonState, moonPhasesBetween } from './lunar.mjs';
import { initCabinet, rolesFor, isAdmin, ADMIN_EMAILS, ROLES, staffList, staffSet, staffRemove, costAdd, costRemove, logError } from './cabinet.mjs';
import { initReports, overview, report, userCard, REPORT_META, OVERVIEW_BLOCKS, getConfig, setConfig, resetConfig } from './reports.mjs';
import * as W from './workspace.mjs';
import { natalChart, skyAt, inSign } from './astro.mjs';
import { createShelves } from './shelves.mjs';
import { createBackup } from './backup.mjs';
import { skyNow } from './sky.mjs';
import { initReminders, FEATURES as REMINDER_FEATURES, listReminders, saveReminder, pendingFor, sendNow, nativePlan, previewNotification, dayRemembered } from './reminders.mjs';
import { CLIENT_EVENTS } from './events.mjs';
import { clearHistory, deleteAccount, sweepAbandoned } from './account-data.mjs';
import { migrate, verifySchema, SCHEMA_VERSION } from './schema.mjs';
import { createReportRunner } from './report-runner.mjs';
import { createCabinetRoutes } from './http/cabinet-routes.mjs';
import * as CE from './content-edit.mjs';
import { HTML_HEADERS } from './http/headers.mjs';
import { createIdentity } from './identity.mjs';
import { AppError, publicError, saveJournalOperation, sweepReceipts } from './sync.mjs';
import { offerTransfer, readOffer, guestRecordCounts, transferGuestRecords } from './transfer.mjs';
import { createPracticeRoutes } from './http/practice-routes.mjs';
import { createDay } from './day.mjs';
import { createWeek } from './week.mjs';
import { createMorning, skyEventOf, hash32, parseData, drawDistinct } from './morning.mjs';
import { createDayRoutes } from './http/day-routes.mjs';
import { createWeekRoutes } from './http/week-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5031);
const HOST = process.env.HOST || '127.0.0.1';
const SITE_DIR = process.env.SITE_DIR || join(__dirname, '..', 'site');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });   /* до ключей пушей и шифрования — они пишут сюда при первом запуске */
const BASE = process.env.BASE_PATH || '/app';
/* Резервные копии: ночью — cron (тот же backup.mjs), днем — кнопка в кабинете админа */
const BACKUP_DIR = process.env.BACKUP_DIR || join(__dirname, '..', 'backups');
const Backup = createBackup({ dataDir: DATA_DIR, contentDir: CONTENT_DIR, backupDir: BACKUP_DIR });
const CONSENT_VERSION = '2026-08-23';
const PUSH = vapidKeys(DATA_DIR);
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://lunario.online').replace(/\/+$/, '');
/* Какие события принимает /api/event и какие пишет сам обработчик — в реестре events.mjs */
const {seal, open:open_, sealBytes, openBytes} = privateText(DATA_DIR);
const db = new DatabaseSync(join(DATA_DIR, 'app.db'));

/* Короткое ожидание, если база занята другим писателем (напоминания, отчеты, ночная копия). Без него редкая
   встреча двух писателей дает «database is locked» и 500 на ровном месте. Держим маленьким: node:sqlite синхронна,
   и долгое ожидание встало бы колом во всем процессе — что не успело за секунду, честнее вернуть как 503. */
db.exec('PRAGMA busy_timeout = 1000');

/* Схема и ее история — в schema.mjs: шаги по номерам, каждый в своей транзакции;
   порт слушается только после того, как миграции прошли и обязательные колонки на месте */
migrate(db);
verifySchema(db);

const wishList = (userId) => db.prepare("SELECT id, text, done, ts, photo <> '' AS hasPhoto, photo_ts FROM wishes WHERE user_id=? ORDER BY done, id DESC").all(userId)
  .map((r) => ({ id: r.id, text: open_(r.text), done: r.done, ts: r.ts, photo: !!r.hasPhoto, photoTs: r.photo_ts || '' }));
/* Картинка приходит из телефона как data URL (jpeg/png/webp), уже уменьшенная; проверяем вид и размер */
function dataUrlOk(v, max) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  return m && m[2].length <= max * 1.37 ? String(v) : null;
}
let exportHeaderPng = null;   /* логотип с Луной для обложки PDF — та же картинка, что в письмах */
const exportHeader = () => { if (exportHeaderPng === null) { try { exportHeaderPng = readFileSync(join(SITE_DIR, 'assets/mail/header.png')); } catch { exportHeaderPng = false; } } return exportHeaderPng || null; };
/* «Как установить на телефон»: страница и PDF собираются из одного текста (install-guide.mjs) при первом запросе и живут в памяти —
   личного в них нет, а текст меняется только с выпуском */
let installHtml = null, installPdfBuf = null;
const installGuide = () => installHtml || (installHtml = installPage());
const installGuidePdf = () => {
  if (installPdfBuf) return installPdfBuf;
  let iconPng = null; try { iconPng = readFileSync(join(SITE_DIR, 'assets/apple-touch-icon.png')); } catch { /* без иконки памятка не хуже */ }
  return (installPdfBuf = installPdf({ headerPng: exportHeader(), iconPng }));
};
function sendDataUrl(res, dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  const buf = Buffer.from(m[2], 'base64');
  res.writeHead(200, { 'Content-Type': m[1], 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
  return res.end(buf);
}

const {habitList, askesisList} = createPractices(db, open_);
initReminders(db, { habitList: (uid, d) => habitList(uid, d), askesisList: (uid, d) => askesisList(uid, d), morningPack: (u, d) => Morning.pack(u, d) });   /* напоминания по функциям; переносит прежнюю подписку на карту дня */
initCabinet(db);   /* таблицы кабинетов; колонки users ведет schema.mjs */
initReports(db, DATA_DIR);
W.initWorkspace(db, DATA_DIR, seal, open_);
/* Отчеты и дашборд кабинета — в отдельном потоке: SQLite синхронна, и один отчет не должен задерживать запросы приложения */
const Reports = createReportRunner({ dataDir: DATA_DIR, inline: { overview, report } });

/* ── утилиты ── */
const today = () => dayIn();                    // YYYY-MM-DD по Москве
const nowISO = () => new Date().toISOString();
const clean = (s, max) => String(s ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
/* Многострочные тексты (дневник, заметки, обращения): переносы строк — часть текста, убираем только прочие управляющие символы */
const cleanText = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const sha = (s) => createHash('sha256').update(s).digest('hex');
// сотруднику, которому только что назначили роль, шлем код входа сразу — не нужно самому запрашивать
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
   Ключ берется из APP_SECRET в .env и в базу никогда не попадает: у того, кто
   получит только файл базы, останется набор нечитаемых строк.
   Записи, сделанные до включения шифрования, читаются как есть. */
/* Ключ создается сам при первом запуске и лежит рядом с базой, доступный только root.
   Файл базы без этого файла бесполезен. Терять ключ нельзя — записи станут нечитаемыми,
   поэтому он попадает в резервную копию вместе с базой. */
console.log('Личные записи шифруются перед записью в базу');

/* «Сегодня» человека — по поясу его устройства (заголовок X-Tz, запоминается в preferences.tz), иначе по поясу города из анкеты,
   иначе по Москве. Все личное — настрой, карта, записи, неделя — считается этим днем; аналитика и кабинет остаются по Москве. */
const tzOk = new Map();
function validTz(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z][\w+\-/]{1,60}$/.test(tz)) return false;
  if (!tzOk.has(tz)) { try { new Intl.DateTimeFormat('ru-RU', { timeZone: tz }); tzOk.set(tz, true); } catch { tzOk.set(tz, false); } }
  return tzOk.get(tz);
}
const userTz = (u) => { const p = u ? preferences(u.preferences) : {}; return validTz(p.tz) ? p.tz : validTz(u?.tz) ? u.tz : MSK; };
const userDay = (u) => dayIn(userTz(u));
/* пояс устройства сменился (переезд, поездка) — запоминаем, чтобы и пуши, и день считались по нему */
function rememberTz(u, req) {
  const tz = req.headers['x-tz']; if (!u || !validTz(tz)) return;
  const p = preferences(u.preferences); if (p.tz === tz) return;
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify({ ...p, tz }), u.id); u.preferences = JSON.stringify({ ...p, tz });
}

/* Событие продукта: только тип, короткая деталь и возрастная когорта — без личных текстов */
const track = (u, type, detail = '') => db.prepare('INSERT INTO events (ts, day, user_id, type, detail, age_band) VALUES (?,?,?,?,?,?)').run(nowISO(), today(), u.id, type, String(detail || '').slice(0, 60), ageBand(u.birth));
function ageBand(birth) {
  if (!ISO_DAY.test(String(birth || ''))) return '';
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

/* Ответ JSON. Возвращает true — «запрос обработан»: по этому признаку маршрутные модули
   (backend/http/*) говорят серверу, что дальше искать не нужно. */
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); return true; };

/* Кнопка «Прислать код» появляется только после успешной проверки авторизации.
   Сервис перезапускается скриптом set-smtp.sh — проверка сработает сама. */
let smtpOk = false;
if (mailReady()) {
  verifySmtp().then((r) => {
    smtpOk = r.ok;
    console.log(r.ok ? 'SMTP: авторизация прошла — вход по почте включен'
                     : `SMTP: авторизация НЕ прошла (${r.error}) — вход по почте скрыт`);
  });
} else console.log('SMTP: не настроен — вход по почте скрыт');
const mailLive = () => smtpOk;

const codeRate = new Map(), codeRateEmail = new Map(), codeRateAll = { n: 0, t: 0 }, verifyRate = new Map(), anonRate = new Map();
/* Сколько анонимных аккаунтов заводим с одного адреса за окно и сколько записей принимаем от одного аккаунта:
   людям этого хватает с запасом, а скрипту не дает раздуть базу. ANON_RATE — для проверок. */
const ANON_RATE = Number(process.env.ANON_RATE || 30), DAILY_WRITES = 100, WISHES_MAX = 300;
const RATE_WINDOW_MS = 10 * 60000;
function allowRate(map, key, max) {
  const now = Date.now();
  const rec = map.get(key) || { n: 0, t: now };
  if (now - rec.t > RATE_WINDOW_MS) { rec.n = 0; rec.t = now; }
  rec.n++; map.set(key, rec);
  if (map.size > 5000) for (const [k, r] of map) if (now - r.t > RATE_WINDOW_MS) map.delete(k);
  return rec.n <= max;
}
/* Адрес клиента для лимитов. За nginx (слушаем 127.0.0.1) настоящий адрес — ПОСЛЕДНИЙ в X-Forwarded-For: его дописывает
   сам nginx (proxy_add_x_forwarded_for), а первые элементы мог прислать клиент, чтобы обойти лимит одним заголовком.
   Без прокси (прямое подключение не с loopback) заголовку не верим вовсе. */
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;
let warnedNoXff = false;
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const xff = req.headers['x-forwarded-for'];
  if (xff && LOOPBACK.test(peer)) { const last = String(xff).split(',').pop().trim(); if (last) return last; }
  /* За прокси без этого заголовка все люди считаются одним клиентом и делят один лимит на коды входа — говорим об этом вслух */
  if (!xff && LOOPBACK.test(peer) && !warnedNoXff) { warnedNoXff = true; console.log('ВНИМАНИЕ: запрос с loopback без X-Forwarded-For — лимиты считаются на весь сервер. В nginx нужен proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'); }
  return peer;
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
function numFormula(birth) {                    // показываем арифметику: ее можно проверить руками
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
/* Личный год живет от дня рождения до дня рождения: до него в календарном году действует число прошлого
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
/* Фаза Луны — из lunar.mjs (ряды Мееса), та же модель, что у «На небе» и лунного дня */
const moonOf = (day) => moonState(Date.parse(day + 'T12:00:00Z'));

/* ── карты и руны: что уходит на экран (тексты экран берет из каталога по коду) ── */
const cardPublic = (a) => ({ slug: a.slug, name: a.name, keys: a.keys, question: a.question, today: a.today, image: a.image });
const runePublic = (r) => ({ slug: r.slug, name: r.name, keyword: r.keyword, motto: r.motto, answer: r.answer, path: r.path, image: r.image });
/* Карта дня тянется один раз в день и живет в истории; до открытия ее нет. */
const Morning = createMorning({ db, C, track, nowISO, today: (u) => userDay(u) });
const cardOfDay = (u, day) => { const a = Morning.cardOfDay(u, day); return a ? cardPublic(a) : null; };

/* Тема дня → настрой и вопрос дня. Тему задает тон дня (пока человек не собрал утро из карты, руны и планет — тогда
   первый выбранный источник). Настрой к теме выпадает без повторов в течение года; тема исчерпана — по второму кругу.
   Выпавшая пара запоминается в daily_sets, поэтому в течение дня не меняется. */
initDailySets(db);
const { toneOfDay, runeOfDay, drawMorning, setOfDay, themeFor } = Morning;
/* Человек открыл то, что утро вытянуло само: снимаем пометку auto (запись появляется в «Мои вопросы и ответы»)
   и пишем «открыл» — один раз в день, чтобы автоматическая вытяжка не считалась действием человека */
function markOpened(u, day, kind, event, detail) {
  const row = db.prepare('SELECT id, data FROM entries WHERE user_id = ? AND day = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(u.id, day, kind);
  if (!row) return;
  const data = parseData(row.data) || {};
  if (data.auto) { delete data.auto; db.prepare('UPDATE entries SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id); }
  if (!db.prepare('SELECT 1 FROM events WHERE user_id = ? AND day = ? AND type = ? LIMIT 1').get(u.id, day, event)) track(u, event, detail);
}

/* Транзитная Луна сейчас («в Рыбах») и ближайшие новолуние и полнолуние — для героя на «Сегодня».
   Считается по всем телам, поэтому ответ держим десять минут; даты фаз — на сутки, в поясе человека. */
const moonNowCache = { at: 0, signIn: '' };
function moonSignNow() {
  const t = Date.now();
  if (t - moonNowCache.at > 6e5) { try { moonNowCache.signIn = skyAt(t).moon.signIn; } catch { moonNowCache.signIn = ''; } moonNowCache.at = t; }
  return moonNowCache.signIn;
}
const moonNextCache = new Map();
function moonNext(tz) {
  const key = `${dayIn(tz)}|${tz}`;
  if (moonNextCache.has(key)) return moonNextCache.get(key);
  const out = { new: '', full: '' };
  try {
    const now = Date.now();
    for (const p of moonPhasesBetween(now, now + 31 * 864e5)) { if ((p.phase === 'new' || p.phase === 'full') && !out[p.phase]) out[p.phase] = dayIn(tz, p.at); }
  } catch { /* без дат герой не хуже */ }
  if (moonNextCache.size > 50) moonNextCache.clear();
  moonNextCache.set(key, out); return out;
}

/* ── персональный день ── */
function dayPack(u, day) {
  const seed = `${u.id}:${day}`;
  drawMorning(u, day);
  const set = setOfDay(u, day);
  const sign = u.birth ? signOf(u.birth) : null;
  /* тема дня — та, к которой подобран уже выпавший настрой; сегодня она не меняется, даже если днем выбрать другой источник */
  const tone = toneOfDay(u, day), moon = moonOf(day), theme = themeFor(u, day, set);
  return {
    date: day,
    moon: moon.name,
    moonPhase: +moon.cycle.toFixed(3),          // доля цикла 0..1 — по ней рисуется луна
    // освещенность диска, а не доля цикла: при фазе 0.65 диск освещен на 79 %, не на 65
    moonPct: moon.illumination,
    moonSign: moonSignNow(),                    // транзитная Луна сейчас: «в Рыбах»
    moonNext: moonNext(u.tz || MSK),            // ближайшие новолуние и полнолуние — даты в поясе человека
    card: cardOfDay(u, day),
    sign: sign ? sign.name : '',
    forecast: sign
      ? { title: tone[0], text: `${tone[1]} ${sign.trait[0].toUpperCase()}${sign.trait.slice(1)} — сегодня это особенно заметно.`, bars: tone[2] }
      : { title: tone[0], text: tone[1], bars: tone[2] },
    affirmation: (W.materialForDay('affirmation', day) || {}).text || C.AFFIRMATIONS[hash32(seed + ':aff') % C.AFFIRMATIONS.length],
    set,                            /* настрой дня на главной и вопрос дня к нему — по теме дня */
    theme: theme ? { key: theme.key, title: theme.title, source: Morning.themeSource(u, day, theme) } : null,
    morning: morningOf(preferences(u.preferences)),   /* выбранные плитки утра */
    cardOpened: Morning.openedOf(u, day, 'card'),     /* утро вытянуло карту само — в панели она ждет, пока ее откроют */
    runeOpened: Morning.openedOf(u, day, 'dayrune'),  /* то же для руны дня: до выбора человек не видит, какая выпала */
    remembered: dayRemembered(u.id, day),             /* день уже записан — вечерняя строка на «Сегодня» скажет об этом */
    rune: (() => { const r = runeOfDay(u, day); return r ? runePublic(r) : null; })(),
    sky: (() => { const e = skyEventOf(day); return e ? { title: e.title } : null; })(),   /* главное событие неба — то же, что в пуше и в теме дня */
    question: (set || {}).question || (W.materialForDay('question', day) || {}).text || C.DAY_QUESTIONS[hash32(seed + ':q') % C.DAY_QUESTIONS.length],
    lunar: lunarPack(u),
    art: artOf(day),                                   /* картинки к функциям из кабинета «Контент» на этот день */
  };
}
/* картинки функций считаются один раз в минуту — материалы меняются редко */
const artCache = { day: '', at: 0, v: {} };
function artOf(day) { const t = Date.now(); if (artCache.day !== day || t - artCache.at > 6e4) { try { artCache.v = W.artForDay(day); } catch { artCache.v = {}; } artCache.day = day; artCache.at = t; } return artCache.v; }
/* Лунный день считается по месту рождения из анкеты (там же часовой пояс);
   без координат — Москва, как и все остальное время в приложении. */
function lunarPack(u) {
  try {
    const ld = lunarDay(Date.now(), u.lat ?? MOSCOW.lat, u.lon ?? MOSCOW.lon);
    if (!ld) return null;
    const [title, advice] = C.LUNAR_DAYS[ld.n - 1] || ['', ''];
    const info = C.LUNAR_INFO.find((d) => d.n === ld.n);   /* тема и картинка — на открытку; само описание экран берет из /api/lunar-days */
    return { n: ld.n, from: new Date(ld.from).toISOString(), to: ld.to ? new Date(ld.to).toISOString() : null, period: lunarPeriodText(ld, u.tz || MSK), title, advice,
      theme: info ? info.theme : '', symbol: info ? info.symbol : '', image: info ? info.image : '' };
  } catch (e) { return null; }
}
const topicOf = (q) => (C.TOPICS.find(([, re]) => re.test(q)) || ['self'])[0];
/* «На небе» считает события на 62 дня вперед — держим результат пять минут на часовой пояс */
const skyMemo = new Map();
function skyCached(tz) {
  const key = tz + ':' + Math.floor(Date.now() / 300000);
  if (!skyMemo.has(key)) { if (skyMemo.size > 50) skyMemo.clear(); skyMemo.set(key, skyNow(Date.now(), tz)); }
  return skyMemo.get(key);
}
const testRate = new Map();
const PUSH_DEVICES = 10;   /* сколько ячеек уведомлений держим у одного аккаунта */
const MOOD_RU = new Proxy({}, { get: (_, k) => { if (String(k).startsWith('own:')) return String(k).slice(4); const m = C.moodInfo(k); return m ? m.label : String(k); } });
const moodTone = (k) => { const m = C.moodInfo(k); return m ? m.tone : '0'; };
/* Неделя по отметкам настроения — для «Итогов недели» и отчета по настроениям */
function weekSummary(u) {
  const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const moods = db.prepare('SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day>=? GROUP BY mood ORDER BY c DESC').all(u.id, since);
  const days = db.prepare('SELECT COUNT(DISTINCT day) c FROM moods WHERE user_id=? AND day>=?').get(u.id, since).c;
  const total = moods.reduce((s, m) => s + m.c, 0);
  let summary = '';
  if (!total) summary = 'На этой неделе вы еще не отмечали состояние. Одна отметка в день — и через неделю здесь появится картина.';
  else {
    const top = moods[0];
    const share = Math.round((top.c / total) * 100);
    summary = `Вы отмечались ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}. Чаще всего — ${MOOD_RU[top.mood]}: ${share}% отметок.`;
    const plus = moods.filter((m) => moodTone(m.mood) === '+').reduce((s, m) => s + m.c, 0);
    const minus = moods.filter((m) => moodTone(m.mood) === '-').reduce((s, m) => s + m.c, 0);
    if (plus / total >= 0.6) summary += ' Неделя выдалась ровной и теплой.';
    else if (minus / total >= 0.6) summary += ' Неделя была непростой — это видно по отметкам.';
  }
  return { since, moods, days, total, summary };
}
/* ── Привычки: регулярность задает человек словами, мы ее понимаем ──
   daily — каждый день; weekdays — по будням; weekend — по выходным; alt — через день;
   days:1,3,5 — в выбранные дни недели (1 — понедельник); weekly — раз в неделю; times:N — N раз в неделю;
   monthly — раз в месяц. Непонятную формулировку сохраняем как свободный ритм. */
const validEndDate = (value, today) => ISO_DAY.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value && value >= today;

/* ── пользователь ── */
/* Фото — картинка до 300 КБ; в объект аккаунта берем только признак, саму картинку читает /api/photo.
   Колонки перечислены явно (после всех миграций), чтобы SELECT не поднимал и не декодировал фото на каждом запросе */
const USER_COLS = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name).filter((c) => c !== 'photo').join(', ') + ", (photo <> '') AS photo";
const userById = (id) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id);
const userByEmail = (email) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).get(email);
const userPhoto = (id) => (db.prepare('SELECT photo FROM users WHERE id = ?').get(id) || {}).photo || '';
/* Кто человек — сессии устройства и коды на почту — в backend/identity.mjs */
const { parseCookies, setSessionCookie, clearSessionCookie, newSession, getUser, issueLoginCode, checkLoginCode, verifyLogin } =
  createIdentity({ db, basePath: BASE, sha, clean, nowISO, userById, rolesFor });
function touchStreak(u) {                       // серию продолжает любой ритуал за день
  const d = userDay(u);
  if (u.streak_date === d) return u.streak;
  const next = u.streak_date === addDays(d, -1) ? u.streak + 1 : 1;
  db.prepare('UPDATE users SET streak = ?, streak_date = ? WHERE id = ?').run(next, d, u.id);
  u.streak = next; u.streak_date = d;
  return next;
}
/* Код приглашения у каждого свой; заводится при первом обращении. По коду строятся реферальные ссылки:
   /app/?ref=код открывает приложение, /app/install?ref=код — инструкцию по установке; кто пришел — в users.invited_by */
function refCodeOf(u) {
  if (!u.ref_code) { u.ref_code = randomBytes(4).toString('hex'); db.prepare('UPDATE users SET ref_code=? WHERE id=?').run(u.ref_code, u.id); }
  return u.ref_code;
}
const firstName = (name) => clean(name, 40).split(/\s+/)[0] || '';
const inviteHost = (code) => (code && /^[a-z0-9]{6,12}$/i.test(code)) ? db.prepare("SELECT * FROM users WHERE ref_code=? AND ref_code<>''").get(code) : null;
const publicUser = (u) => ({
  id: u.id, refCode: u.onboarded ? refCodeOf(u) : '',
  name: u.name, birth: u.birth, birthTime: u.birth_time, city: u.city,
  region: u.city_region || '', lat: u.lat ?? null, lon: u.lon ?? null, tz: u.tz || '',
  tzOffset: u.tz && u.birth ? tzOffsetMinutes(u.tz, `${u.birth}T${u.birth_time || '12:00'}:00`) : null,
  natalReady: !!(u.birth && u.lat != null && u.birth_time),
  signedIn: !!u.email,
  sign: u.birth ? signOf(u.birth).name : '', onboarded: !!u.onboarded, streak: u.streak,
  photo: !!u.photo, photoTs: u.photo_ts || '',
  streakToday: u.streak_date === userDay(u), email: u.email,
  roles: rolesFor(u.email),   /* сотрудники после входа попадают в кабинет */
});

/* Тело больше max — не читаем дальше, но соединение не рвем: сначала человеку уходит 413 (см. catch внизу), потом сокет закрывается */
function readBody(req, max = 32768) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks = [];
    req.on('data', (c) => { if (done) return; size += c.length; if (size > max) { done = true; chunks.length = 0; req.pause(); reject(new Error('too_big')); } else chunks.push(c); });
    req.on('end', () => { if (done) return; done = true; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
/* Заголовки страниц (CSP, кликджекинг, nosniff) — backend/http/headers.mjs, общие с локальным просмотром */
function serveStatic(res, rel, cacheSec = 3600, headOnly = false, extra = {}) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(SITE_DIR, safe);
  if (!file.startsWith(normalize(SITE_DIR)) || !existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
  const type = MIME[extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cacheSec ? `public, max-age=${cacheSec}${cacheSec >= 31536000 ? ', immutable' : ''}` : 'no-cache', ...(type.startsWith('text/html') ? HTML_HEADERS : {}), ...extra });
  res.end(headOnly ? undefined : readFileSync(file));
}
function sendHtml(res, html, headOnly = false, extra = {}) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...HTML_HEADERS, ...extra });
  res.end(headOnly ? undefined : html);
}
/* Страница открыта по реферальной ссылке (?ref=код): манифест в разметке получает тот же код, и у приложения, поставленного с этой
   страницы, start_url несет его — иначе приглашение терялось бы при установке (браузер запрашивает манифест при загрузке страницы,
   раньше, чем аккаунт узнает о приглашении; на iPhone у приложения с экрана «Домой» к тому же свое хранилище) */
const withRef = (html, code) => html.replace('href="/app/manifest.webmanifest"', `href="/app/manifest.webmanifest?ref=${code}"`);
/* Видимость для ИИ-агентов: заголовок Link со ссылками на карту сайта, политику, каталог API и описание (RFC 8288);
   запрос с Accept: text/markdown получает описание приложения в markdown вместо HTML (llms.txt). */
const AGENT_LINKS = ['</sitemap.xml>; rel="sitemap"', '</politika>; rel="privacy-policy"', '</soglasie>; rel="terms-of-service"',
  '</.well-known/api-catalog>; rel="api-catalog"', '</app/llms.txt>; rel="describedby"; type="text/markdown"', '</.well-known/ai-catalog.json>; rel="ai-catalog"'].join(', ');
const wantsMarkdown = (req) => /\btext\/markdown\b/.test(req.headers.accept || '') && !/\btext\/html\b/.test((req.headers.accept || '').split(',')[0]);

/* ── маршруты ── */
/* ── полочки: досье каждого человека — «Обо мне», «Мой день», «Истории».
   Экран «Мои данные» показывает их человеку, разборы и гороскопы берут отсюда контекст. */
/* Натальная карта по анкете — одна подготовка для маршрута /api/natal и досье: время рождения, пояс, координаты.
   Анкета старше координат или город записан не как в базе — доопределяем по названию и запоминаем. */
function natalFor(u) {
  const time = /^\d{2}:\d{2}$/.test(u.birth_time || '') ? u.birth_time : '';
  if ((u.lat == null || !u.tz) && u.city) {
    const geo = cityByName(u.city);
    if (geo) { db.prepare('UPDATE users SET lat=?, lon=?, tz=?, city_region=? WHERE id=?').run(geo.lat, geo.lon, geo.tz, [geo.region, geo.country].filter(Boolean).join(', '), u.id); u.lat = geo.lat; u.lon = geo.lon; u.tz = geo.tz; }
  }
  const tzOff = u.tz ? tzOffsetMinutes(u.tz, `${u.birth}T${time || '12:00'}:00`) : 0;
  const chart = natalChart({ birth: u.birth, time, tzOffsetMin: tzOff, lat: u.lat ?? null, lon: u.lon ?? null });
  chart.tz = u.tz || ''; chart.city = u.city || ''; chart.cityFound = u.lat != null;
  chart.tzNote = u.tz ? `${u.tz}, UTC${tzOff >= 0 ? '+' : '−'}${Math.abs(tzOff) / 60}` + (time ? '' : ' (полдень)') : 'пояс не определен — время взято как UTC';
  /* лунный день рождения — по месту и моменту рождения; без времени берется полдень, и у границы дня номер может отличаться на один */
  try {
    const born = Date.parse(`${u.birth}T${time || '12:00'}:00Z`) - tzOff * 6e4;
    const ld = lunarDay(born, u.lat ?? MOSCOW.lat, u.lon ?? MOSCOW.lon);
    chart.lunarBirth = ld ? { n: ld.n, uncertain: !time } : null;
  } catch { chart.lunarBirth = null; }
  return chart;
}
const Shelves = createShelves({ db, seal, open: open_, C, signOf, destinyNum, personalYearAt, dayNum, topicOf, ageBand, cardOfDay, dayPack, habitList, askesisList, natal: natalFor, MOOD_RU, nowISO });
/* после этих действий полки пересобираются — уже после того, как ответ ушел человеку; у каждого маршрута — только те полки,
   которых он касается: анкета меняет «Обо мне» (с натальной картой) и «Мой день», карта дня и вопросы — день и «Истории»,
   настроение, дневник, желания и практики — только «Мой день» */
const SHELF_TOUCH = {
  '/api/profile': ['about', 'day'], '/api/preferences': ['about'], '/api/data': ['about', 'day', 'history'],
  '/api/card': ['day', 'history'], '/api/ask': ['day', 'history'], '/api/spread': ['day', 'history'],
  '/api/mood': ['day'], '/api/journal': ['day'], '/api/thought': ['day'], '/api/wishes': ['day'], '/api/habits': ['day'], '/api/askesis': ['day'],
};
/* Серия действий подряд (отметки привычек) пересобирает полки один раз, а не на каждое, полки копятся;
   «Мои данные» дожидаются отложенной сборки */
const shelfTimers = new Map();
function scheduleShelves(uid, d, shelves) {
  const prev = shelfTimers.get(uid);
  if (prev) clearTimeout(prev.timer);
  const only = [...new Set([...(prev ? prev.only : []), ...shelves])];
  shelfTimers.set(uid, { only, timer: setTimeout(() => { shelfTimers.delete(uid); Shelves.refresh(uid, d, only); }, 500) });
}
function flushShelves(uid, d) { const p = shelfTimers.get(uid); if (p) { clearTimeout(p.timer); shelfTimers.delete(uid); Shelves.refresh(uid, d, p.only); } }
/* Заброшенные анонимные аккаунты (без почты, записей и захода 90 дней) убираются раз в сутки — правило в account-data.mjs */
const sweep = () => { try { const n = sweepAbandoned(db); if (n) console.log(`Аккаунты: убрано заброшенных анонимных — ${n}`); } catch (e) { console.log('Аккаунты: уборка не прошла —', e.message); } };
setTimeout(sweep, 60000).unref();
setInterval(sweep, 24 * 3600 * 1000).unref();
/* У тех, кто пришел раньше полок, они собираются один раз при старте — по одному человеку, не задерживая запросы */
setTimeout(() => {
  const ids = db.prepare('SELECT id FROM users WHERE onboarded = 1 AND id NOT IN (SELECT user_id FROM shelves)').all().map((r) => r.id);
  if (!ids.length) return;
  console.log(`Полочки: собираются для ${ids.length} человек`);
  let i = 0;
  const step = () => { if (i >= ids.length) { console.log('Полочки: собраны'); return; } Shelves.refresh(ids[i++], today()); setImmediate(step); };
  step();
}, 3000).unref();

/* Кабинеты сотрудников — отдельный HTTP-слой со своими зависимостями (backend/http/cabinet-routes.mjs).
   Собирается здесь, где все перечисленное уже определено. */
/* Картинки функций для кабинета «Контент»: что нарисовано у карт, рун, лунных дней и личного года, и замена файла на месте.
   Файл пишется в папку контента (картинки/<папка>/<имя>); если расширение новое — имя в текстовом файле переписывается,
   а адреса у людей обновляются сами: версия в адресе — время файла. */
const CONTENT_IMAGE_SETS = {
  tarot: { title: 'Карты Таро', file: 'карты-таро.txt', items: () => [...C.ARCANA].map((c) => ({ key: c.slug, name: c.name, image: c.image })) },
  runes: { title: 'Руны', file: 'руны.txt', items: () => [...C.RUNES].map((r) => ({ key: r.slug, name: r.name, image: r.image })) },
  lunar: { title: 'Лунные дни', file: 'лунные-дни.txt', items: () => [...C.LUNAR_INFO].map((d) => ({ key: String(d.n), name: `${d.n} · ${d.theme || d.symbol || ''}`, image: d.image })) },
  year: { title: 'Личный год', file: 'личный-год.txt', items: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33].map((n) => C.YEARS[n]).filter(Boolean).map((y) => ({ key: String(y.n), name: `${y.n} · ${y.title || y.energy || ''}`, image: y.image })) },   /* YEARS — прокси без списка ключей */
};
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function contentImageList() { return Object.entries(CONTENT_IMAGE_SETS).map(([kind, s]) => ({ kind, title: s.title, items: s.items() })); }
function contentImagePut({ kind, key, type, data }) {
  const set = CONTENT_IMAGE_SETS[kind]; if (!set) return { ok: false, error: 'bad_kind' };
  const item = set.items().find((i) => i.key === String(key)); if (!item) return { ok: false, error: 'not_found' };
  const ext = IMAGE_EXT[type]; if (!ext) return { ok: false, error: 'bad_type' };
  const buf = Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) return { ok: false, error: 'too_big' };
  const dir = join(CONTENT_DIR, 'картинки', IMAGE_DIRS[kind]); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const oldName = item.image ? decodeURIComponent(item.image.split('/').pop().split('?')[0]) : '';
  const base = oldName ? oldName.replace(/\.[^.]+$/, '') : String(key).replace(/[^\w.-]/g, '') || 'img';
  const name = `${base}.${ext}`;
  writeFileSync(join(dir, name), buf);
  if (oldName && oldName !== name) {   /* новое расширение — переписываем имя в текстовом файле, старый файл убираем */
    try { const txt = readContent(set.file); if (txt.includes(oldName)) writeContent(set.file, txt.split(oldName).join(name)); } catch { /* текст не тронули — картинка все равно на месте */ }
    try { unlinkSync(join(dir, oldName)); } catch {}
  } else if (!oldName) {
    return { ok: true, name, note: 'В текстовом файле у записи нет поля «картинка» — впишите имя файла: ' + name };
  }
  return { ok: true, name, url: `/app/content/${kind}/${name}?v=${Date.now().toString(36)}` };
}
const cabinetRoutes = createCabinetRoutes({ json, readBody, rolesFor, isAdmin, getConfig, setConfig, resetConfig,
  REPORT_META, OVERVIEW_BLOCKS, Reports, userCard, contentFiles, readContent, writeContent, contentImageList, contentImagePut, CE, Backup, W,
  staffList, staffSet, staffRemove, notifyStaffAccess, ADMIN_EMAILS, costAdd, costRemove, logError, mailLive });

const practiceRoutes = createPracticeRoutes({ db, json, readBody, clean, cleanText, seal, open_, ISO_DAY, nowISO,
  track, touchStreak, habitList, askesisList, parseRule, habitStreak, validEndDate });
const Day = createDay({ db, seal, open: open_, sealBytes, openBytes, C, habitList, askesisList, track, touchStreak, nowISO, cleanText, clean, questionOf: (u, d) => dayPack(u, d).question,
  morningOf: (u, d) => { const p = dayPack(u, d); return { set: p.set ? p.set.text : '', theme: p.theme ? p.theme.title : '' }; },   /* вечер продолжает утро: настрой и тема на карточке дня */
  themeTitle: (key) => ([...C.THEMES].find((t) => t.key === key) || {}).title || '',
  /* лунный день на вечер этой даты — по месту из анкеты; в записи дня и в строке прошлых дней */
  lunarOf: (u, d) => { try { const ld = lunarDay(Date.parse(d + 'T18:00:00Z'), u?.lat ?? MOSCOW.lat, u?.lon ?? MOSCOW.lon); return ld ? { n: ld.n, title: (C.LUNAR_DAYS[ld.n - 1] || [''])[0] } : null; } catch { return null; } },
  dailyWrites: DAILY_WRITES });
const dayRoutes = createDayRoutes({ json, readBody, day: Day });
/* откуда настрой того дня — подпись для «Что отозвалось» в неделе: карта дня и ее имя, руна, планеты или прогноз дня */
function setSourceLabel(uid, day) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid); if (!u) return '';
  try {
    const set = Morning.setOfDay(u, day); if (!set) return '';
    const theme = Morning.themeFor(u, day, set), src = Morning.themeSource(u, day, theme);
    if (src === 'card') { const c = Morning.cardFor(u, day); return 'по карте дня' + (c ? ' · ' + c.name : ''); }
    if (src === 'dayrune') { const r = Morning.runeFor(u, day); return 'по руне дня' + (r ? ' · ' + r.name : ''); }
    if (src === 'sky') { const e = skyEventOf(day); return 'по планетам' + (e ? ' · ' + e.title : ''); }
    return 'по прогнозу дня';
  } catch { return ''; }
}
const Week = createWeek({ db, open: open_, seal, C, MOOD_RU, habitList, askesisList, track, nowISO, cleanText, setSource: setSourceLabel });
const weekRoutes = createWeekRoutes({ json, readBody, week: Week, track });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    /* iOS и Яндекс.Браузер при добавлении на экран «Домой» пробуют /apple-touch-icon.png в корне сайта; nginx отдает все,
       что начинается с /app, сюда — поэтому корневая иконка тоже наша, иначе на телефоне вместо луны буква «Л» */
    if (/^\/apple-touch-icon(-precomposed)?(-\d+x\d+)?\.png$/.test(p)) return serveStatic(res, 'assets/apple-touch-icon.png', 86400, req.method === 'HEAD');
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
    if (p === '' ) p = '/';

    if (p === '/api/health') return json(res, 200, { ok: true, service: 'lunario-app', schema: SCHEMA_VERSION });
    /* Кто зовет: по коду из реферальной ссылки — только имя, без аккаунта; страница установки показывает «Ирина зовет вас в Лунарио» */
    if (p === '/api/invite/host' && req.method === 'GET') {
      const host = inviteHost(url.searchParams.get('code') || '');
      if (!host) return json(res, 404, { ok: false });
      res.setHeader('Cache-Control', 'public, max-age=600');
      return json(res, 200, { ok: true, name: firstName(host.name) });
    }

    /* Строка сегодняшнего дня на приветствии — до анкеты, по Москве: фаза, лунный день и его тема. Личного нет, кэш десять минут */
    if (p === '/api/hello' && req.method === 'GET') {
      let lunar = null;
      try { const ld = lunarDay(Date.now(), MOSCOW.lat, MOSCOW.lon); if (ld) lunar = { n: ld.n, title: (C.LUNAR_DAYS[ld.n - 1] || [''])[0] }; } catch { /* без лунного дня строка короче */ }
      const m = moonState(Date.now());
      res.setHeader('Cache-Control', 'public, max-age=600');
      return json(res, 200, { ok: true, moon: m.name, moonPhase: +m.cycle.toFixed(3), lunar });
    }

    /* Каталог карт и рун: тексты, картинки, расклады. Личного здесь нет, поэтому кэшируется на 10 минут —
       правки в content/ доедут до людей не позже. */
    if (p === '/api/catalog' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(JSON.stringify({ cards: [...C.ARCANA], runes: [...C.RUNES], layouts: C.LAYOUTS, lunarDays: [...C.LUNAR_DAYS], askesisIdeas: [...C.ASKESIS_IDEAS], habitIdeas: [...C.HABIT_IDEAS], tools: [...C.TOOLS],
        news: [...C.NEWS], quickMoods: C.QUICK_MOODS, moods: [...C.MOODS], moodFamilies: { ...C.MOOD_FAMILIES }, legacyMoods: C.LEGACY_MOODS,
        reminderTexts: Object.fromEntries(['morning-пусто', 'evening', 'week'].map((k) => [k, C.REMINDER_TEXTS[k]])) }));
    }

    /* Лунные дни целиком: 30 статей с картинками и общие главы справочника. Личного нет, кэш как у каталога;
       экран «Лунный день» забирает это один раз, когда его открыли. */
    if (p === '/api/lunar-days' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      return res.end(JSON.stringify({ days: [...C.LUNAR_INFO], reference: C.lunarRef(), topics: [...C.READING_TOPICS].map(({ key, label, def }) => ({ key, label, def })) }));
    }

    /* Сводка по продукту: сколько людей, что нажимают, кто вернулся.
       Закрыта паролем; личных текстов внутри нет — только счетчики. */


    /* ── API ── */
    if (p.startsWith('/api/')) {
      /* Анонимный аккаунт заводится только там, где начинается работа, и не чаще ANON_RATE с адреса за окно;
         остальным без сессии — 401, а не новый пользователь */
      let u = getUser(req, res, false);
      if (!u && (p === '/api/me' || p === '/api/auth/request')) {
        if (!allowRate(anonRate, clientIp(req), ANON_RATE)) return json(res, 429, { ok: false, error: 'too_often' });
        u = getUser(req, res, true);
      }
      if (u) rememberTz(u, req);
      const d = u ? userDay(u) : today();   /* день человека — по его поясу; без аккаунта — по Москве */
      if (!u) {
        if (p === '/api/cabinet/me') { const cfg = getConfig(); return json(res, 200, { email: '', name: '', roles: [], isAdmin: false, mailReady: mailLive(), menus: cfg.menus, reports: cfg.reports, periods: cfg.periods, blocks: cfg.blocks, custom: cfg.custom }); }
        return json(res, 401, { ok: false, error: 'no_session' });
      }
      if (req.method !== 'GET' && SHELF_TOUCH[p]) { const uid = u.id; res.once('finish', () => scheduleShelves(uid, d, SHELF_TOUCH[p])); }

      /* ── рабочие кабинеты: роли по почте, единый дашборд, доступы — backend/http/cabinet-routes.mjs ── */
      if (p.startsWith('/api/cabinet/')) return cabinetRoutes({ p, req, res, url, u });

      /* ── натальная карта: считается на лету по анкете, ничего не хранится ── */
      if (p === '/api/natal' && req.method === 'GET') {
        if (!ISO_DAY.test(u.birth || '')) return json(res, 400, { ok: false, error: 'no_birth' });
        const chart = natalFor(u);
        if (!url.searchParams.has('quiet')) track(u, 'natal_view', chart.timeKnown ? 'with_time' : 'no_time');   /* quiet — карточка на «Обо мне», а не открытие карты */
        return json(res, 200, chart);
      }

      /* ── первый источник (UTM с лендинга или рекламы) — один раз ── */
      if (p === '/api/utm' && req.method === 'POST') { const b = await readBody(req); const r = W.setUtm(u.id, b); if (r.ok && !r.kept) track(u, 'utm_seen', clean(b.utm_source, 40)); return json(res, 200, r); }

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
        /* на один адрес — не больше 3 кодов за окно, а всего с сервера — не больше 200: чужую почту не бомбим,
           репутацию отправителя не сжигаем, даже если адрес клиента подменен */
        if (!allowRate(codeRateEmail, email, 3)) return json(res, 429, { ok: false, error: 'too_often' });
        if (Date.now() - codeRateAll.t > RATE_WINDOW_MS) { codeRateAll.n = 0; codeRateAll.t = Date.now(); }
        if (++codeRateAll.n > 200) return json(res, 429, { ok: false, error: 'too_often' });
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
        if (!allowRate(verifyRate, clientIp(req), 60)) return json(res, 429, { ok: false, error: 'too_often' });   /* перебор кодов по многим почтам с одного адреса */
        const b = await readBody(req);
        const email = clean(b.email, 200).toLowerCase();
        /* Код не режем: раньше clean(b.code, 6) обрезал «1234567» до «123456», и подходил не тот код, что в письме.
           Все остальное — проверка, привязка аккаунта, новая сессия, погашение кода — одной транзакцией в identity.mjs:
           отказ посередине больше не оставляет человека без кода и без входа. */
        const r = verifyLogin({
          email, code: typeof b.code === 'string' ? b.code.trim() : '',
          guest: u, ua: req.headers['user-agent'], currentToken: parseCookies(req).lunario_app,
          /* анкету, заполненную только что на этом устройстве, переносим в найденный аккаунт — она про того же человека */
          profileFields: { sql: `UPDATE users SET name=?, birth=?, birth_time=?, city=?, city_region=?, lat=?, lon=?, tz=?, onboarded=1,
                                 consent_version=?, consent_ts=? WHERE id=?`,
            values: (g, id) => [g.name, g.birth, g.birth_time, g.city, g.city_region, g.lat, g.lon, g.tz, g.consent_version, g.consent_ts, id] },
          countGuestRecords: (id) => guestRecordCounts(db, id),
          transferOffer: (guestId, accountId) => offerTransfer(guestId, accountId),
        });
        if (r.error) return json(res, r.error === 'too_many' ? 429 : 400, { ok: false, error: r.error });
        /* Кука — только после COMMIT: при откате у человека не должно остаться куки несуществующей сессии. */
        setSessionCookie(res, r.token);
        const account = userById(r.accountId);
        /* merged остается ради уже работающих клиентов: true означало «устройство переключилось на другой аккаунт».
           Новое поле state говорит точнее, а transfer — что у гостя остались записи и их можно перенести. */
        const merged = r.state === 'signed_in' || r.state === 'guest_transfer_required';
        return json(res, 200, { ok: true, merged, state: r.state, user: publicUser(account),
          ...(merged ? { day: dayPack(account, d) } : {}),
          ...(r.transfer ? { transfer: { token: r.transfer, counts: r.counts } } : {}) });
      }

      /* Записи, сделанные до входа, переносятся только по явному согласию: вход в аккаунт — не доказательство,
         что гостевой дневник принадлежит тому же человеку (общий компьютер). Приглашение подписано и живет полчаса. */
      if (p === '/api/account/transfer' && req.method === 'POST') {
        const b = await readBody(req);
        const offer = readOffer(b.token);
        if (!offer) return json(res, 400, { ok: false, error: 'bad_transfer_token' });
        if (offer.accountId !== u.id) return json(res, 403, { ok: false, error: 'not_your_transfer' });
        const done = transferGuestRecords(db, offer.guestId, offer.accountId);
        if (!done.ok) return json(res, done.error === 'not_found' ? 404 : 409, { ok: false, error: done.error });
        flushShelves(u.id, d); scheduleShelves(u.id, d, ['about', 'day', 'history']);
        return json(res, 200, { ok: true, moved: done.moved, kept: done.kept, already: !!done.already });
      }

      /* Кто я сейчас. Очередь спрашивает это перед каждой отправкой: если за время лежания в очереди человек
         сменился, чужой черновик отправлять нельзя. Гостя здесь не заводим — на то и 401. */
      if (p === '/api/auth/session' && req.method === 'GET')
        return json(res, 200, { ok: true, accountId: u.id, signedIn: !!u.email, email: u.email || '' });

      /* Запись дневника по имени операции: повтор с тем же именем возвращает ту же квитанцию и не создает дубль.
         Обычный POST /api/journal остается как был — старый клиент ничего не заметит. */
      if (p === '/api/sync/journal' && req.method === 'POST') {
        const b = await readBody(req);
        try {
          const receipt = saveJournalOperation(db, u, b, { seal, day: d, now: nowISO(), track, touchStreak, dailyLimit: DAILY_WRITES });
          res.once('finish', () => scheduleShelves(u.id, d, ['day']));
          return json(res, 200, receipt);
        } catch (e) {
          const pub = publicError(e);
          if (pub.status >= 500) logError(p, e.message);
          return json(res, pub.status, { ok: false, error: pub.code, retryable: pub.retryable });
        }
      }

      if (p === '/api/auth/logout' && req.method === 'POST') {
        const tok = parseCookies(req).lunario_app;
        if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(tok));
        clearSessionCookie(res);
        return json(res, 200, { ok: true });
      }
      /* «Выйти на всех устройствах»: отзыв всех сессий аккаунта — если телефон потерян или токен утек */
      if (p === '/api/auth/logout-all' && req.method === 'POST') {
        const gone = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id).changes;
        clearSessionCookie(res);
        return json(res, 200, { ok: true, devices: gone });
      }

      if (p === '/api/cities' && req.method === 'GET')
        return json(res, 200, { items: findCities(url.searchParams.get('q') || '') });

      /* Событие продукта: что человек сделал. Тексты вопросов сюда не попадают. */
      if (p === '/api/event' && req.method === 'POST') {
        const b = await readBody(req);
        const type = clean(b.t, 40);
        if (!CLIENT_EVENTS.has(type)) return json(res, 400, { ok: false });   // подтвержденные действия пишет сам обработчик
        track(u, type, clean(b.d, 60));
        if (type === 'lunar_view') {   /* сколько раз открывал лунный день: ряд тем появляется со второго открытия */
          const pr = preferences(u.preferences); if ((pr.lunarViews || 0) < 99) db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify({ ...pr, lunarViews: (pr.lunarViews || 0) + 1 }), u.id);
        }
        return json(res, 200, { ok: true });
      }


      if (p === '/api/me' && req.method === 'GET') {
        return json(res, 200, {
          user: publicUser(u), day: dayPack(u, d), catalogV: catalogVersion(), preferences: preferences(u.preferences),
          mood: (db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, d) || {}).mood || null,
          moodStats: db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, d.slice(0, 7) + '%'),
          mailReady: mailLive(),
          supportUnread: W.userUnread(u.id),
        });
      }

      if (p === '/api/data/export' && req.method === 'GET') return json(res,200,personalExport(db,u,open_));
      /* Читаемая выгрузка: те же данные, что в JSON, но PDF в стиле Лунарио — для человека, а не для переноса */
      if (p === '/api/data/export.pdf' && req.method === 'GET') {
        const pdf = personalExportPdf(personalExport(db, u, open_), {
          moodName: (m) => MOOD_RU[m], topicTitle: (k) => (C.READING_TOPICS.find((t) => t.key === k) || {}).title || k,
          reminderTitle: (k) => (REMINDER_FEATURES[k] || {}).title || k, toolTitle: (k) => ([...C.TOOLS].find((t) => t.key === k) || {}).title || k, headerPng: exportHeader(),
        });
        const name = `lunario-${d}.pdf`;
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        return res.end(pdf);
      }

      if (p === '/api/preferences') {
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (!validPreferences(b)) return json(res,400,{error:'bad_preferences'});
          const prev = preferences(u.preferences), known = new Set([...C.READING_TOPICS].map((t) => t.key));
          const topics = b.topics ? [...new Set(b.topics.filter((k) => known.has(k)))] : (prev.topics || []);
          /* lunarViews — служебный счетчик, его ведет сервер по событию lunar_view; с клиента не принимается */
          /* tools — какие инструменты человек оставил на экранах; нет поля — стартовый набор из каталога (видимость, не данные) */
          const toolKeys = new Set([...C.TOOLS].map((t) => t.key));
          const tools = Array.isArray(b.tools) ? [...new Set(b.tools.filter((k) => toolKeys.has(k)))] : (prev.tools ?? null);
          const morning = Array.isArray(b.morning) ? [...new Set(b.morning)] : (prev.morning ?? null);   /* плитки утра на «Сегодня» */
          const value = {theme:b.theme,ritual:b.ritual,topics,topicsAll:b.topicsAll !== undefined ? !!b.topicsAll : !!prev.topicsAll,lunarViews:prev.lunarViews||0,...(tools ? {tools} : {}),...(morning ? {morning} : {}),...(prev.tz ? {tz:prev.tz} : {}),...(Number.isInteger(b.tour) ? {tour:b.tour} : prev.tour ? {tour:prev.tour} : {})};   /* tz — пояс устройства, ведет сервер по заголовку; tour — подсказки уже показаны */
          db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(value),u.id);
          return json(res,200,{preferences:value});
        }
        return json(res,200,{preferences:preferences(u.preferences)});
      }
      if (p === '/api/timeline' && req.method === 'GET') return json(res,200,timeline(db,u.id,url.searchParams,open_));

      if (p === '/api/profile' && req.method === 'POST') {
        const b = await readBody(req);
        const birth = clean(b.birth, 10);
        if (!ISO_DAY.test(birth)) return json(res, 400, { ok: false, error: 'bad_birth' });
        if (b.consent !== true) return json(res, 400, { ok: false, error: 'no_consent' });
        const cityName = clean(b.city, 60);
        const geo = cityName ? cityByName(cityName) : null;   // координаты подставляются по названию
        db.prepare('UPDATE users SET name=?, birth=?, birth_time=?, city=?, city_region=?, lat=?, lon=?, tz=?, onboarded=1, consent_version=?, consent_ts=? WHERE id=?')
          .run(clean(b.name, 60), birth, clean(b.birthTime, 5), geo ? geo.name : cityName,
               geo ? [geo.region, geo.country].filter(Boolean).join(', ') : '', geo ? geo.lat : null, geo ? geo.lon : null, geo ? geo.tz : '',
               CONSENT_VERSION, nowISO(), u.id);
        if (!u.onboarded) track(u, 'onboard_done', '');
        const fresh = userById(u.id);
        return json(res, 200, { ok: true, user: publicUser(fresh), day: dayPack(fresh, d) });
      }

      /* Карта дня: тянется случайно, один раз в день, и сразу ложится в историю. Повторное нажатие
         возвращает ту же карту — колода на сегодня уже открыта. */
      if (p === '/api/card' && req.method === 'POST') {
        let card = cardOfDay(u, d);
        if (card) markOpened(u, d, 'card', 'card_open', (Morning.cardOfDay(u, d) || {}).slug || '');
        if (!card) {
          const a = drawDistinct([...C.ARCANA], 1)[0];
          db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
            .run(u.id, nowISO(), d, 'card', '', a.name, a.keys, JSON.stringify({ card: a.slug }));
          card = cardPublic(a); track(u, 'card_open', a.slug);
        }
        return json(res, 200, { ok: true, card, streak: touchStreak(u) });
      }

      /* Руна дня: как карта дня — одна на день, запоминается в entries (kind dayrune), повторное открытие возвращает ту же */
      if (p === '/api/dayrune' && req.method === 'POST') {
        const row = db.prepare("SELECT data FROM entries WHERE user_id=? AND day=? AND kind='dayrune' ORDER BY id DESC LIMIT 1").get(u.id, d);
        const slug = (parseData(row && row.data) || {}).rune;
        let rune = slug ? [...C.RUNES].find((r) => r.slug === slug) : null;
        if (rune) markOpened(u, d, 'dayrune', 'dayrune_open', slug);
        if (!rune) {
          rune = drawDistinct([...C.RUNES], 1)[0];
          db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
            .run(u.id, nowISO(), d, 'dayrune', '', rune.name, rune.answer, JSON.stringify({ rune: rune.slug, layout: 'one', runes: [rune.slug] }));
          track(u, 'dayrune_open', rune.slug);
        }
        return json(res, 200, { ok: true, day: d, rune: runePublic(rune) });
      }

      if (p === '/api/ask' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        if (db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = ? AND day = ?').get(u.id, d).c >= DAILY_WRITES) return json(res, 429, { ok: false, error: 'too_many' });
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
        track(u, kind === 'rune' ? 'ask_rune' : 'ask_yesno', kind === 'rune' ? extra.layout : topic);
        const prev = db.prepare("SELECT title, day FROM entries WHERE user_id=? AND kind='yesno' AND day<? AND title<>? ORDER BY id DESC LIMIT 1").get(u.id, d, title);
        return json(res, 200, { ok: true, kind, title, body, topic, ...extra, streak: touchStreak(u), memory: kind === 'yesno' && prev ? { title: prev.title, day: prev.day } : null });
      }

      if (p === '/api/spread' && req.method === 'POST') {
        const b = await readBody(req);
        const q = clean(b.question, 300);
        if (q.length < 10 || !/\s/.test(q)) return json(res, 400, { ok: false, error: 'short_question' });
        /* Дневного лимита раскладов нет (решение владелицы 18.09: лимит был на случай платных ИИ-разборов, а тексты — свои).
           Счетчик usage.spreads остается для статистики. Карты выпадают случайно и не повторяются внутри расклада */
        const L = C.LAYOUTS.tarot[b.layout] ? b.layout : 'three';
        const pos = C.LAYOUTS.tarot[L].pos;
        const cards = drawDistinct([...C.ARCANA], pos.length).map((a, i) => ({ pos: pos[i].name, ...cardPublic(a) }));
        db.prepare('INSERT INTO usage (user_id, day, spreads) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET spreads = spreads + 1').run(u.id, d);
        db.prepare('INSERT INTO entries (user_id, ts, day, kind, question, title, body, data) VALUES (?,?,?,?,?,?,?,?)')
          .run(u.id, nowISO(), d, 'spread', seal(q), cards.map((c) => c.name).join(' · '), cards.map((c) => `${c.pos}: ${c.name} — ${c.keys}`).join(' '),
               JSON.stringify({ layout: L, cards: cards.map((c) => c.slug) }));
        track(u, 'ask_spread', L);
        return json(res, 200, { ok: true, layout: L, cards, streak: touchStreak(u) });
      }

      if (p === '/api/mood' && req.method === 'POST') {
        const b = await readBody(req);
        const mood = clean(b.mood, 30);
        const own = /^own:[^\s|]{1,24}$/u.test(mood);   /* свое слово: «own:собранно» */
        if (!own && !C.moodInfo(mood)) return json(res, 400, { ok: false, error: 'bad_mood' });
        db.prepare('INSERT INTO moods (user_id, day, mood) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET mood = excluded.mood').run(u.id, d, mood);
        db.prepare('INSERT OR IGNORE INTO mood_marks (user_id, day, mood) VALUES (?,?,?)').run(u.id, d, mood);   /* карточка дня показывает все отмеченные */
        track(u, 'mood_set', mood.replace(/^own:.*/, 'own'));   /* свое слово — личный текст, в аналитику не идет */
        const month = d.slice(0, 7);
        const stats = db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, month + '%');
        return json(res, 200, { ok: true, mood, stats, streak: touchStreak(u) });
      }

      /* Дневник: обычная запись, благодарность («кому и за что я благодарна сегодня») или ответ на вопрос дня.
         Все лежит в одной ленте, вид записи подписан. */
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
          if (db.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(u.id, d).c >= DAILY_WRITES) return json(res, 429, { ok: false, error: 'too_many' });
          const kind = ['gratitude', 'answer'].includes(b.kind) ? b.kind : '';
          const title = clean(b.title, 300);
          /* ответ на вопрос дня — один на день: повторная отправка обновляет его, как и карточка дня в Дневнике */
          if (kind === 'answer') {
            const prev = db.prepare("SELECT id FROM journal WHERE user_id = ? AND day = ? AND kind = 'answer' ORDER BY id DESC LIMIT 1").get(u.id, d);
            if (prev) { db.prepare('UPDATE journal SET text = ?, title = ? WHERE id = ? AND user_id = ?').run(seal(text), seal(title), prev.id, u.id); return json(res, 200, { ok: true, updated: true, item: { id: prev.id, day: d, text, kind, title } }); }
          }
          const inserted = db.prepare('INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?,?,?,?,?,?)').run(u.id, nowISO(), d, seal(text), kind, seal(title));
          track(u, kind === 'gratitude' ? 'gratitude_add' : kind === 'answer' ? 'answer_add' : 'journal_add', '');
          return json(res, 200, { ok: true, streak: touchStreak(u), item: { id: Number(inserted.lastInsertRowid), day: d, text, kind, title } });
        }
        const kind = url.searchParams.get('kind');
        const rows = kind ? db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? AND kind=? ORDER BY id DESC LIMIT 60').all(u.id, kind)
          : db.prepare('SELECT id, day, text, kind, title FROM journal WHERE user_id=? ORDER BY id DESC LIMIT 60').all(u.id);
        return json(res, 200, { items: rows.map((r) => ({ ...r, text: open_(r.text), title: open_(r.title || '') })), today: !!(kind && rows.find((r) => r.day === d)) });
      }

      /* Фото у желания — картинка для визуализации. Уменьшается в телефоне, хранится как есть, отдается только хозяйке. */
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
      /* Свое фото в аккаунте — показывается в кружке в правом верхнем углу */
      if (p === '/api/photo') {
        if (req.method === 'GET') { const photo = userPhoto(u.id); if (!photo) { res.writeHead(404); return res.end(); } return sendDataUrl(res, photo); }
        if (req.method === 'POST') {
          const b = await readBody(req, 512 * 1024);
          const photo = dataUrlOk(b.photo, 300 * 1024); if (!photo) return json(res, 400, { ok: false, error: 'bad_photo' });
          db.prepare('UPDATE users SET photo = ?, photo_ts = ? WHERE id = ?').run(photo, nowISO(), u.id);
          track(u, 'photo_set', '');
        }
        if (req.method === 'DELETE') db.prepare("UPDATE users SET photo = '', photo_ts = '' WHERE id = ?").run(u.id);
        return json(res, 200, { ok: true, user: publicUser(userById(u.id)) });
      }

      if (p === '/api/wishes') {
        if (req.method === 'POST') {
          const b = await readBody(req, 1024 * 1024);
          const text = clean(b.text, 200);
          if (text.length < 3) return json(res, 400, { ok: false, error: 'short' });
          if (db.prepare('SELECT COUNT(*) c FROM wishes WHERE user_id = ?').get(u.id).c >= WISHES_MAX) return json(res, 429, { ok: false, error: 'too_many' });
          const photo=b.photo ? dataUrlOk(b.photo,600*1024) : '';
          if (b.photo && !photo) return json(res,400,{error:'bad_photo'});
          db.prepare('INSERT INTO wishes (user_id, ts, text, photo, photo_ts) VALUES (?,?,?,?,?)').run(u.id, nowISO(), seal(text),photo,photo?nowISO():'');
          track(u, 'wish_add', photo ? 'photo' : '');
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          db.prepare('UPDATE wishes SET done = CASE done WHEN 1 THEN 0 ELSE 1 END, done_ts = ? WHERE id = ? AND user_id = ?').run(nowISO(), Number(b.id) || 0, u.id);
        }
        return json(res, 200, { items: wishList(u.id) });
      }

      if (p === '/api/entries' && req.method === 'GET')
        return json(res, 200, entryPage(db,u.id,url.searchParams,open_));


      /* Напоминание утром: браузер дает адрес своей ячейки, мы его храним. */
      if (p === '/api/push' && req.method === 'GET')
        return json(res, 200, { key: PUSH.publicKey, on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id=?').get(u.id) });
      if (p === '/api/push' && req.method === 'POST') {
        const b = await readBody(req);
        const endpoint = clean(b.endpoint, 500);
        if (!pushEndpointOk(endpoint)) return json(res, 400, { ok: false, error: 'bad_endpoint' });
        const holder = db.prepare('SELECT user_id FROM push_subs WHERE endpoint = ?').get(endpoint);
        /* Ячейка уже у другого аккаунта — не перехватываем: иначе тот, кто узнал чужой адрес, молча забрал бы себе
           чужие уведомления. Выход из аккаунта ячейку НЕ освобождает — ее снимает только «выключить уведомления»
           (DELETE /api/push). Поэтому на общем браузере второй человек включит свои после того, как первый выключит
           у себя; приложение так ему и говорит (pushSubscribe в site/app.js, ответ endpoint_taken). */
        if (holder && holder.user_id !== u.id) return json(res, 409, { ok: false, error: 'endpoint_taken' });
        const fresh = !holder;
        db.prepare('INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?,?,?) ON CONFLICT(endpoint) DO NOTHING').run(endpoint, u.id, nowISO());
        /* устройств у аккаунта — не больше PUSH_DEVICES: лишние (самые старые) ячейки уходят, чтобы сервер не рассылал в тысячи адресов с одного аккаунта */
        db.prepare(`DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${PUSH_DEVICES})`).run(u.id, u.id);
        if (fresh) track(u, 'push_on', '');
        return json(res, 200, { ok: true });
      }
      if (p === '/api/push' && req.method === 'DELETE') {
        db.prepare('DELETE FROM push_subs WHERE user_id=?').run(u.id);
        return json(res, 200, { ok: true });
      }

      /* Приглашение подруги: у каждого свой код; пришла по ссылке — записываем, от кого (users.invited_by). Подарка за
         приглашение больше нет (лимит раскладов снят), поле bonus_until остается в базе для совместимости и не пишется */
      if (p === '/api/invite' && req.method === 'GET') {
        const code = refCodeOf(u);
        /* кто пришел по ссылке: имена тех, кто заполнил анкету, остальные — счетом; почты и записей здесь нет */
        const came = db.prepare('SELECT name FROM users WHERE invited_by=? ORDER BY created_at').all(u.id);
        return json(res, 200, {
          link: `${PUBLIC_BASE}/app/?ref=${code}`, installLink: `${PUBLIC_BASE}/app/install?ref=${code}`,
          brought: came.length, broughtNames: came.map((r) => firstName(r.name)).filter(Boolean).slice(0, 20),
        });
      }
      if (p === '/api/invite' && req.method === 'POST') {
        const b = await readBody(req);
        const code = clean(b.code, 16);
        if (!code || u.invited_by || u.ref_code === code) return json(res, 200, { ok: false });
        const host = inviteHost(code);
        if (!host || host.id === u.id) return json(res, 200, { ok: false });
        db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(host.id, u.id);
        track(u, 'invite_used', String(host.id));   /* кто от кого пришел — в событиях и в users.invited_by; раньше событие с клиента отбрасывалось */
        return json(res, 200, { ok: true, from: firstName(host.name) });
      }

      /* Отчет по настроениям: неделя по дням, месяц по долям, итог словами */
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
        return json(res, 200, { week, month: { key: month, stats, entries:monthEntries, days: stats.reduce((s, m) => s + m.c, 0) }, total, summary: w.summary });
      }

      /* ── напоминания по функциям ── */
      if (p === '/api/reminders/preview' && req.method === 'GET') {
        const item = previewNotification(u, url.searchParams.get('feature'));
        return json(res, item ? 200 : 400, item ? { item } : { error: 'bad_feature' });
      }
      /* план локальных уведомлений телефона на 14 дней: ?feature=morning|evening|week (старые адреса — на тот же план) */
      if ((p === '/api/reminders/native-plan' || p === '/api/reminders/sky-plan' || p === '/api/reminders/askesis-plan') && req.method === 'GET')
        return json(res, 200, nativePlan(u, REMINDER_FEATURES[url.searchParams.get('feature')] ? url.searchParams.get('feature') : 'morning'));
      if (p === '/api/reminders' && req.method === 'GET')
        return json(res, 200, { items: listReminders(u.id), push: { on: !!db.prepare('SELECT 1 FROM push_subs WHERE user_id = ?').get(u.id), key: PUSH.publicKey,
          /* по устройствам: когда подключено, когда сервер последний раз доставил сигнал и когда устройство откликнулось */
          devices: db.prepare('SELECT endpoint, created_at, last_sent, last_wake FROM push_subs WHERE user_id = ? ORDER BY created_at DESC').all(u.id) } });
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
      /* сигнал пришел — service worker забирает тексты, которые еще не показывал на этом устройстве */
      /* Последнее уведомление за сутки — текстом: на телефоне уведомление обрезается, а в приложении человек ищет «тот текст».
         «Сегодня» показывает его карточкой, пока не скроют */
      if (p === '/api/push/last' && req.method === 'GET') {
        const since = new Date(Date.now() - 20 * 3600e3).toISOString();
        const item = db.prepare('SELECT id, ts, feature, title, body, url FROM push_queue WHERE user_id = ? AND ts >= ? ORDER BY id DESC LIMIT 1').get(u.id, since) || null;
        return json(res, 200, { item });
      }
      if (p === '/api/push/next' && req.method === 'POST') {
        const b = await readBody(req);
        const endpoint = clean(b.endpoint, 500);
        if (endpoint) db.prepare('UPDATE push_subs SET last_wake = ? WHERE endpoint = ? AND user_id = ?').run(nowISO(), endpoint, u.id);   /* устройство откликнулось */
        return json(res, 200, { items: pendingFor(u.id, endpoint) });
      }

      /* ── практики дня: что сделано сегодня, привычки, аскеза — backend/http/practice-routes.mjs ── */
      if (await practiceRoutes({ p, req, res, url, u, d })) return;
      if (await dayRoutes({ p, req, res, url, u, d })) return;
      if (await weekRoutes({ p, req, res, url, u, d })) return;

      /* ── на небе: сейчас и ближайшие недели ── */
      if (p === '/api/sky' && req.method === 'GET') return json(res, 200, skyCached(u.tz || MSK));

      /* ── полочки: что Лунарио знает о человеке — три полки и досье текстом для разборов ── */
      if (p === '/api/shelves' && req.method === 'GET') { flushShelves(u.id, d); return json(res, 200, Shelves.read(u, d)); }
      if (p === '/api/shelves/context' && req.method === 'GET') { flushShelves(u.id, d); return json(res, 200, { text: Shelves.contextText(Shelves.read(u, d)) }); }

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
        if (!ISO_DAY.test(other)) return json(res, 400, { ok: false, error: 'bad_birth' });
        if (!u.birth) return json(res, 400, { ok: false, error: 'no_birth' });
        const a = signOf(u.birth), o = signOf(other);
        const seed = hash32([u.birth, other].sort().join('|'));
        const mk = (k, lo, hi) => lo + (hash32(seed + k) % (hi - lo + 1));
        const rings = [['Эмоции', mk('e', 55, 95)], ['Общение', mk('c', 50, 95)], ['Быт', mk('b', 45, 90)], ['Страсть', mk('p', 55, 95)]];
        track(u, 'compat_calc', '');
        const total = Math.round(rings.reduce((s, r) => s + r[1], 0) / rings.length);
        return json(res, 200, {
          total, rings, you: a.name, other: o.name,
          // черта знака в контенте может уже начинаться с «вы …» — не дублируем обращение
          text: `${a.name} и ${o.name}. ${/^вы\s/i.test(a.trait) ? a.trait[0].toUpperCase() + a.trait.slice(1) : 'Вы ' + a.trait}; партнер — ${o.trait}. Это союз, который растет, когда каждый уважает темп другого.`,
        });
      }

      /* «Очистить историю» и «Удалить аккаунт» — одна политика на все личные таблицы (account-data.mjs) */
      if (p === '/api/data' && req.method === 'DELETE') { clearHistory(db, u); return json(res, 200, { ok: true }); }
      /* Удаление необратимо, поэтому у аккаунта с почтой оно подтверждается отдельным кодом из письма:
         одной кнопки на чужом или забытом устройстве мало. Аккаунту без почты подтверждать нечем — там только кнопка. */
      if (p === '/api/account/delete-code' && req.method === 'POST') {
        if (!u.email) return json(res, 200, { ok: true, sent: false, reason: 'no_email' });
        if (!allowRate(codeRate, clientIp(req), 5) || !allowRate(codeRateEmail, u.email, 3)) return json(res, 429, { ok: false, error: 'too_often' });
        if (!mailLive()) return json(res, 503, { ok: false, error: 'mail_off' });
        try {
          const m = deleteMail(issueLoginCode(u.email, 'delete'));
          await sendMail({ to: u.email, subject: m.subject, text: m.text, html: m.html });
        } catch (e) { logError('mail', e.message); return json(res, 502, { ok: false, error: 'send_failed' }); }
        return json(res, 200, { ok: true, sent: true });
      }
      if (p === '/api/account' && req.method === 'DELETE') {
        if (u.email) {
          const b = await readBody(req).catch(() => ({}));
          const bad = checkLoginCode(u.email, clean(b.code, 6), 'delete');
          if (bad) return json(res, bad === 'too_many' ? 429 : 400, { ok: false, error: bad });
        }
        deleteAccount(db, u);
        clearSessionCookie(res);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: 'not_found' });
    }

    /* ── статика ── */
    /* картинки контента: /app/content/tarot/fool.jpg → <папка контента>/картинки/таро/fool.jpg.
       Папка контента живет отдельно от кода (на сервере — /opt/lunario-content) и в git не попадает. */
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
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400',
        'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff' });   /* даже документ со скриптом здесь ничего не выполнит */
      return res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    }
    if (p === '/' || p === '/index.html') {
      if (wantsMarkdown(req)) return serveStatic(res, 'llms.txt', 3600, req.method === 'HEAD', { 'Content-Type': 'text/markdown; charset=utf-8', 'Vary': 'Accept', 'Link': AGENT_LINKS });
      const ref = inviteHost(url.searchParams.get('ref') || '');
      if (ref) return sendHtml(res, withRef(readFileSync(join(SITE_DIR, 'index.html'), 'utf8'), ref.ref_code), req.method === 'HEAD', { 'Vary': 'Accept', 'Link': AGENT_LINKS });
      return serveStatic(res, 'index.html', 0, req.method === 'HEAD', { 'Vary': 'Accept', 'Link': AGENT_LINKS });
    }
    if (p === '/llms.txt') return serveStatic(res, 'llms.txt', 3600, req.method === 'HEAD', { 'Content-Type': 'text/markdown; charset=utf-8' });
    if (p === '/cabinet' || p === '/cabinet/') return serveStatic(res, 'cabinet.html', 0);
    /* инструкция по установке на телефон: страница в оформлении приложения и та же памятка в PDF — без аккаунта, ее присылают и до входа */
    if ((p === '/install' || p === '/install/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const ref = inviteHost(url.searchParams.get('ref') || '');
      if (ref) return sendHtml(res, withRef(installGuide(), ref.ref_code), req.method === 'HEAD');
      return sendHtml(res, installGuide(), req.method === 'HEAD', { 'Cache-Control': 'public, max-age=600' });
    }
    if (p === '/install.pdf' && (req.method === 'GET' || req.method === 'HEAD')) {
      const pdf = installGuidePdf();
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': 'attachment; filename="lunario-ustanovka.pdf"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
      return res.end(req.method === 'HEAD' ? undefined : pdf);
    }
    if (p === '/manifest.webmanifest') {
      /* У приглашенного start_url несет код пригласившей: на iPhone у приложения с экрана «Домой» свое хранилище (новый гость),
         и без этого связь «кто от кого пришел» и подарок терялись бы при установке. Остальным — манифест как есть */
      const fromUrl = inviteHost(url.searchParams.get('ref') || '');   /* страница открыта по реферальной ссылке — код уже в адресе манифеста (withRef) */
      const u = fromUrl ? null : getUser(req, res, false);
      const host = fromUrl || (u && u.invited_by ? db.prepare('SELECT ref_code FROM users WHERE id=?').get(u.invited_by) : null);
      if (!host || !host.ref_code) return serveStatic(res, 'manifest.webmanifest', 0);
      const m = JSON.parse(readFileSync(join(SITE_DIR, 'manifest.webmanifest'), 'utf8'));
      m.start_url = `/app/?ref=${host.ref_code}`;
      res.writeHead(200, { 'Content-Type': MIME['.webmanifest'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(JSON.stringify(m));
    }
    if (p === '/sw.js') return serveStatic(res, 'sw.js', 0);
    if ((req.method === 'GET' || req.method === 'HEAD') && !p.includes('..')) return serveStatic(res, p, url.search.includes('v=') ? 31536000 : 86400, req.method === 'HEAD');
    res.writeHead(404); res.end();
  } catch (e) {
    const known = e.message === 'bad_json' ? 400 : e.message === 'too_big' ? 413 : 0;   /* ошибки запроса — человеку по имени; внутренние — только в журнал */
    if (!known) { console.error('[ошибка]', req.url, e.stack || e.message); logError(req.url, e.message); }
    if (known === 413) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); }   /* недочитанное тело не тянем — закрываем после ответа */
    json(res, known || 500, { ok: false, error: known ? e.message : 'server_error' });
  }
});
server.listen(PORT, HOST, () => console.log(`lunario-app: http://${HOST}:${PORT}${BASE} · site=${SITE_DIR} · db=${DATA_DIR}/app.db`));
