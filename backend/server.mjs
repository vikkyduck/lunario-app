/* Лунарио — веб-приложение (PWA). Zero-dependency Node >=22.5 (node:sqlite).
   Слушает 127.0.0.1, за nginx. Своя папка и свой порт — не пересекается с лендингом.
   Аккаунт анонимный: httpOnly-cookie с токеном, e-mail можно привязать позже. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
import { MSK, MOSCOW, ISO_DAY, dayIn, addDays, clean, cleanText } from './util.mjs';
/* версия каталога — по дате последней правки текстов: экран перезапрашивает каталог, когда тексты обновились */
const catalogVersion = () => { try { return String(Math.floor(Math.max(statSync(new URL('./content.mjs', import.meta.url)).mtimeMs, ...readdirSync(CONTENT_DIR).filter(f=>f.endsWith('.txt')).map(f=>statSync(join(CONTENT_DIR,f)).mtimeMs)) / 1000)); } catch { return '2026-09-15'; } };
import { findCities, cityByName, tzOffsetMinutes } from './cities.mjs';
import { sendMail, mailReady, loginMail, staffMail, deleteMail, verifySmtp } from './mailer.mjs';
import { lunarDay, lunarPeriodText, moonState, moonPhasesBetween } from './lunar.mjs';
import { initCabinet, rolesFor, isAdmin, ADMIN_EMAILS, ROLES, staffList, staffSet, staffRemove, costAdd, costRemove, logError } from './cabinet.mjs';
import { initReports, overview, report, userCard, REPORT_META, OVERVIEW_BLOCKS, getConfig, setConfig, resetConfig } from './reports.mjs';
import * as W from './workspace.mjs';
import { natalChart, skyAt, inSign } from './astro.mjs';
import { createKnowledge } from './knowledge.mjs';
import { createMemory } from './memory.mjs';
import { createBackup } from './backup.mjs';
import { skyNow } from './sky.mjs';
import { initReminders, FEATURES as REMINDER_FEATURES, listReminders, saveReminder, pendingFor, sendNow, nativePlan, previewNotification, dayWritten } from './reminders.mjs';
import { CLIENT_EVENTS } from './events.mjs';
import { clearHistory, deleteAccount, sweepAbandoned } from './account-data.mjs';
import { migrate, verifySchema, SCHEMA_VERSION } from './schema.mjs';
import { createReportRunner } from './report-runner.mjs';
import { createCabinetRoutes } from './http/cabinet-routes.mjs';
import * as CE from './content-edit.mjs';
import { FEATURES } from './features.mjs';
import { HTML_HEADERS } from './http/headers.mjs';
import { createIdentity } from './identity.mjs';
import { offerTransfer, readOffer, guestRecordCounts, transferGuestRecords } from './transfer.mjs';
import { createPracticeRoutes } from './http/practice-routes.mjs';
import { createDay } from './day.mjs';
import { createWeek } from './week.mjs';
import { createMorning, skyEventOf, hash32, parseData, drawDistinct } from './morning.mjs';
import { createDayRoutes } from './http/day-routes.mjs';
import { createWeekRoutes } from './http/week-routes.mjs';
import { createAuthRoutes } from './http/auth-routes.mjs';
import { createReadingRoutes } from './http/reading-routes.mjs';
import { createJournalRoutes } from './http/journal-routes.mjs';
import { createPushRoutes } from './http/push-routes.mjs';

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
initReminders(db, { habitList: (uid, d) => habitList(uid, d), askesisList: (uid, d) => askesisList(uid, d), morningPack: (u, d) => Morning.pack(u, d), eveningPersonal: (u, d) => Memory.eveningPersonal(u, d) });   /* напоминания по функциям; переносит прежнюю подписку на карту дня */
initCabinet(db);   /* таблицы кабинетов; колонки users ведет schema.mjs */
initReports(db, DATA_DIR);
W.initWorkspace(db, DATA_DIR, seal, open_);
/* Отчеты и дашборд кабинета — в отдельном потоке: SQLite синхронна, и один отчет не должен задерживать запросы приложения */
const Reports = createReportRunner({ dataDir: DATA_DIR, inline: { overview, report } });

/* ── утилиты ── */
const today = () => dayIn();                    // YYYY-MM-DD по Москве
const nowISO = () => new Date().toISOString();
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
    remembered: dayWritten(u.id, day),                /* день уже записан — вечерняя строка на «Сегодня» скажет об этом */
    rune: (() => { const r = runeOfDay(u, day); return r ? runePublic(r) : null; })(),
    sky: (() => { const e = skyEventOf(day); return e ? { title: e.title } : null; })(),   /* главное событие неба — то же, что в пуше и в теме дня */
    /* вопрос дня знает, чем человек живет (memory.mjs): через день — по теме, к которой он возвращается; иначе — вопрос к настрою */
    question: Memory.topicQuestion(u, day) || (set || {}).question || (W.materialForDay('question', day) || {}).text || C.DAY_QUESTIONS[hash32(seed + ':q') % C.DAY_QUESTIONS.length],
    lunar: lunarPack(u),
    art: artWithSet(day, set),                         /* картинки к функциям из кабинета «Контент» на этот день; у настроя может быть своя */
  };
}
/* картинки функций считаются один раз в минуту — материалы меняются редко */
const artCache = { day: '', at: 0, v: {} };
/* картинка у самой строки настроя (4-я колонка настрой.txt) — к фразе дня, если для «Сегодня» не опубликована другая */
function artWithSet(day, set) {
  const art = artOf(day); if (art.home || !set) return art;
  const norm = (t) => String(t || '').replace(/,?\s*\{Имя\}/g, '').replace(/\s+([,.!?])/g, '$1').replace(/[.]+\s*$/, '').trim();
  const row = [...C.NASTROY].find((n) => norm(n[1]) === norm(set.statement || set.text)); const img = row && row[3];
  return img ? { ...art, home: img } : art;
}
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
/* лунный день на вечер этой даты — по месту из анкеты; в записи дня, в строке прошлых дней и в базе знаний */
const lunarOf = (u, d) => { try { const ld = lunarDay(Date.parse(d + 'T18:00:00Z'), u?.lat ?? MOSCOW.lat, u?.lon ?? MOSCOW.lon); return ld ? { n: ld.n, title: (C.LUNAR_DAYS[ld.n - 1] || [''])[0] } : null; } catch { return null; } };
/* «Я помню» — память о человеке одной фразой: строка на карточке дня, вопрос дня по теме, любимый способ ответа, вечерний пуш, «Обо мне» */
const Memory = createMemory({ db, open: open_, C, questionOf: (u, d) => dayPack(u, d).question, topicOf, MOOD_RU, habitList, askesisList });
/* База знаний — папка документов о человеке, собранная из журнала (knowledge.mjs): ее читают ИИ, выгрузка и «на себе» в кабинете, экраны — нет */
const Knowledge = createKnowledge({ db, seal, open: open_, C, signOf, destinyNum, personalYearAt, dayNum, numFormula, ageBand, natal: natalFor, habitList, askesisList, MOOD_RU, topicOf, memory: Memory, lunarOf, nowISO });
/* раз в сутки по поясу человека документы пересобираются — по одному человеку за такт, не задерживая запросы; свежие (за сегодня) не трогаются */
function knowledgeDaily() {
  try { const stale = Knowledge.staleUsers((u) => userDay(u)); let i = 0;
    const step = () => { if (i >= stale.length) return; const u = stale[i++]; try { Knowledge.rebuild(u, userDay(u)); } catch (e) { logError('knowledge', e.message); } setImmediate(step); };
    step(); } catch (e) { logError('knowledge', e.message); }
}
setTimeout(knowledgeDaily, 20000).unref(); setInterval(knowledgeDaily, 15 * 60000).unref();
/* Заброшенные анонимные аккаунты (без почты, записей и захода 90 дней) убираются раз в сутки — правило в account-data.mjs */
const sweep = () => { try { const n = sweepAbandoned(db); if (n) console.log(`Аккаунты: убрано заброшенных анонимных — ${n}`); } catch (e) { console.log('Аккаунты: уборка не прошла —', e.message); } };
setTimeout(sweep, 60000).unref();
setInterval(sweep, 24 * 3600 * 1000).unref();
/* Кабинеты сотрудников — отдельный HTTP-слой со своими зависимостями (backend/http/cabinet-routes.mjs).
   Собирается здесь, где все перечисленное уже определено. */
/* Картинки функций для кабинета «Контент»: что нарисовано у карт, рун, лунных дней и личного года, и замена файла на месте.
   Файл пишется в папку контента (картинки/<папка>/<имя>); если расширение новое — имя в текстовом файле переписывается,
   а адреса у людей обновляются сами: версия в адресе — время файла. */
const cabinetRoutes = createCabinetRoutes({ json, readBody, rolesFor, isAdmin, getConfig, setConfig, resetConfig, memoryPreview: (u, d) => Memory.preview(u, d), knowledgeList: (u, d) => Knowledge.list(u, d), knowledgeRead: (u, doc, d) => Knowledge.read(u, doc, d), knowledgeText: (u, doc, d) => Knowledge.text(u, doc, d),
  REPORT_META, OVERVIEW_BLOCKS, Reports, userCard, CE, IMAGE_DIRS, Backup, W,
  staffList, staffSet, staffRemove, notifyStaffAccess, ADMIN_EMAILS, costAdd, costRemove, logError, mailLive });

const practiceRoutes = createPracticeRoutes({ db, json, readBody, clean, cleanText, seal, open_, ISO_DAY, nowISO,
  track, touchStreak, habitList, askesisList, parseRule, habitStreak, validEndDate });
const Day = createDay({ db, seal, open: open_, sealBytes, openBytes, C, habitList, askesisList, track, touchStreak, nowISO, cleanText, clean, dayWritten, questionOf: (u, d) => dayPack(u, d).question,
  morningOf: (u, d) => { const p = dayPack(u, d); return { set: p.set ? p.set.text : '', theme: p.theme ? p.theme.title : '' }; },   /* вечер продолжает утро: настрой и тема на карточке дня */
  themeTitle: (key) => ([...C.THEMES].find((t) => t.key === key) || {}).title || '',
  lunarOf,
  dailyWrites: DAILY_WRITES });
const dayRoutes = createDayRoutes({ json, readBody, day: Day, bridge: (u, d) => Memory.dayLine(u, d) });
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

const authRoutes = createAuthRoutes({ knowledgeRebuild: (u, d) => Knowledge.rebuild(u, d), allowRate, checkLoginCode, clean, clearHistory, clearSessionCookie, clientIp, codeRate, codeRateAll, codeRateEmail, dayPack, db, deleteAccount, deleteMail, guestRecordCounts, issueLoginCode, json, logError, loginMail, mailLive, offerTransfer, parseCookies, publicUser, RATE_WINDOW_MS, readBody, readOffer, sendMail, setSessionCookie, sha, transferGuestRecords, userById, verifyLogin, verifyRate });
const readingRoutes = createReadingRoutes({ compatSave: (u, d, r) => Knowledge.compatSave(u, d, r), C, cardOfDay, cardPublic, clean, DAILY_WRITES, dayNum, db, destinyNum, drawDistinct, hash32, ISO_DAY, json, markOpened, Morning, natalFor, nowISO, numFormula, parseData, personalYearAt, readBody, runePublic, seal, signOf, topicOf, touchStreak, track });
const journalRoutes = createJournalRoutes({ C, clean, cleanText, DAILY_WRITES, dataUrlOk, db, entryPage, json, nowISO, open_, publicUser, readBody, seal, sendDataUrl, touchStreak, track, userById, userPhoto, weekSummary, WISHES_MAX, wishList });
const pushRoutes = createPushRoutes({ allowRate, clean, db, firstName, inviteHost, json, listReminders, nativePlan, nowISO, pendingFor, previewNotification, PUBLIC_BASE, PUSH, PUSH_DEVICES, pushEndpointOk, readBody, refCodeOf, REMINDER_FEATURES, saveReminder, sendNow, testRate, track });

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
      return json(res, 200, { ok: true, moon: m.name, moonPhase: +m.cycle.toFixed(3), lunar, ui: { ...C.UI } });
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

      /* ── рабочие кабинеты: роли по почте, единый дашборд, доступы — backend/http/cabinet-routes.mjs ── */
      if (p.startsWith('/api/cabinet/')) return cabinetRoutes({ p, req, res, url, u, d });

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
          user: publicUser(u), day: dayPack(u, d), catalogV: catalogVersion(), preferences: preferences(u.preferences), ui: { ...C.UI }, features: FEATURES,
          mood: (db.prepare('SELECT mood FROM moods WHERE user_id = ? AND day = ?').get(u.id, d) || {}).mood || null,
          moodStats: db.prepare("SELECT mood, COUNT(*) c FROM moods WHERE user_id=? AND day LIKE ? GROUP BY mood").all(u.id, d.slice(0, 7) + '%'),
          mailReady: mailLive(),
          supportUnread: W.userUnread(u.id),
          memory: { favorite: Memory.favorite(u), about: Memory.aboutLine(u, d) },   /* «Я помню»: любимый способ ответа и строка на «Обо мне» */
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
        try { Knowledge.rebuild(fresh, d, ['profile']); } catch (e) { logError('knowledge', e.message); }   /* анкета изменилась — «Обо мне» с натальной картой пересобирается сразу */
        return json(res, 200, { ok: true, user: publicUser(fresh), day: dayPack(fresh, d) });
      }

      /* ── остальные маршруты — по модулям в backend/http/: вход и аккаунт, гадания, дневник, уведомления, практики, день, неделя ── */
      if (await authRoutes({ p, req, res, url, u, d })) return;
      if (await readingRoutes({ p, req, res, url, u, d })) return;
      if (await journalRoutes({ p, req, res, url, u, d })) return;
      if (await pushRoutes({ p, req, res, url, u, d })) return;
      if (await practiceRoutes({ p, req, res, url, u, d })) return;
      if (await dayRoutes({ p, req, res, url, u, d })) return;
      if (await weekRoutes({ p, req, res, url, u, d })) return;

      /* ── на небе: сейчас и ближайшие недели ── */
      if (p === '/api/sky' && req.method === 'GET') return json(res, 200, skyCached(u.tz || MSK));

      /* ── база знаний: папка документов о человеке — для ИИ, выгрузки и «на себе» в кабинете; экраны ее не читают ── */
      if (p === '/api/knowledge' && req.method === 'GET') { const doc = url.searchParams.get('doc'); if (!doc) return json(res, 200, { docs: Knowledge.list(u, d) }); const data = Knowledge.read(u, doc, d); return data ? json(res, 200, { doc, data }) : json(res, 404, { ok: false, error: 'not_found' }); }
      if (p === '/api/knowledge/text' && req.method === 'GET') { const doc = url.searchParams.get('doc') || 'portrait'; const text = Knowledge.text(u, doc, d); return text ? json(res, 200, { doc, text }) : json(res, 404, { ok: false, error: 'not_found' }); }
      if (p === '/api/knowledge/rebuild' && req.method === 'POST') { Knowledge.rebuild(u, d); return json(res, 200, { ok: true, docs: Knowledge.list(u) }); }

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
