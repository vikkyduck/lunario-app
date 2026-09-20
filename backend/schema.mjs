/* Схема базы приложения и ее история — одно место вместо ALTER TABLE, разбросанных по модулям.

   Как устроено. MIGRATIONS — последовательные шаги с номером; номер последнего примененного лежит в
   PRAGMA user_version, поэтому на следующем запуске пройденные шаги не выполняются. Каждый шаг идет
   в своей транзакции: упал — откатился целиком, сервер не стартует (лучше не подняться, чем работать
   на половине схемы). Шаги идемпотентны: база, которую до нумерации вели прежним кодом, имеет
   user_version = 0 и проходит все шаги без вреда — колонка уже есть, значит, пропускаем.
   После миграций verifySchema() проверяет обязательные колонки; только потом слушается порт.

   Таблицы кабинетов, напоминаний, очереди пушей, установок дня и полок создают свои модули
   (cabinet, workspace, reminders, daily-sets, knowledge): у них CREATE TABLE IF NOT EXISTS без истории,
   и их использует еще и отдельный процесс send-daily. Все, что касается users и личных таблиц, — здесь. */

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
/* ALTER TABLE ADD COLUMN, если колонки еще нет — безопасно и для баз, где она появилась раньше */
export function addColumn(db, table, col, def) {
  if (!columns(db, table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const BASE_SQL = `
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
`;

export const MIGRATIONS = [
  { v: 1, name: 'базовые таблицы', up: (db) => db.exec(BASE_SQL) },
  { v: 2, name: 'приглашения: свой код у каждого и кто кого привел', up(db) {
    addColumn(db, 'users', 'ref_code', "TEXT DEFAULT ''");
    addColumn(db, 'users', 'invited_by', 'INTEGER');
    addColumn(db, 'users', 'bonus_until', "TEXT DEFAULT ''");
  } },
  { v: 3, name: 'вид записи дневника, аскеза до даты, регулярность привычек, фото', up(db) {
    addColumn(db, 'journal', 'kind', "TEXT DEFAULT ''"); addColumn(db, 'journal', 'title', "TEXT DEFAULT ''");
    addColumn(db, 'askesis', 'until', "TEXT DEFAULT ''");
    db.exec("UPDATE askesis SET until = date(started, '+' || (days - 1) || ' days') WHERE until = ''");
    addColumn(db, 'habits', 'rule', "TEXT DEFAULT 'daily'"); addColumn(db, 'habits', 'rule_text', "TEXT DEFAULT ''");
    addColumn(db, 'wishes', 'photo', "TEXT DEFAULT ''"); addColumn(db, 'wishes', 'photo_ts', "TEXT DEFAULT ''");
    addColumn(db, 'users', 'photo', "TEXT DEFAULT ''"); addColumn(db, 'users', 'photo_ts', "TEXT DEFAULT ''");
  } },
  { v: 4, name: 'коды выпавших карт и рун в истории — по ним расклад открывается заново', up: (db) => addColumn(db, 'entries', 'data', "TEXT DEFAULT ''") },
  { v: 5, name: 'координаты и часовой пояс города — для натальной карты', up(db) {
    for (const [col, def] of [['lat', 'REAL'], ['lon', 'REAL'], ['tz', "TEXT DEFAULT ''"], ['city_region', "TEXT DEFAULT ''"]]) addColumn(db, 'users', col, def);
  } },
  /* Раньше кука была самим аккаунтом (users.token_hash) — переносим ее в сессии, чтобы один аккаунт открывался
     на нескольких устройствах. UNIQUE на token_hash не дает завести второй анонимный профиль — пересобираем таблицу;
     все остальные колонки, в том числе добавленные шагами выше, переезжают как есть — иначе они бы пропали. */
  { v: 6, name: 'сессии вместо token_hash в users', up(db) {
    if (columns(db, 'users').includes('token_hash')) {
      const moved = db.prepare(`INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, last_seen)
        SELECT token_hash, id, created_at, last_seen FROM users WHERE token_hash <> ''`).run();
      if (moved.changes) console.log(`перенесено сессий из старых аккаунтов: ${moved.changes}`);
      const info = db.prepare('PRAGMA table_info(users)').all().filter((c) => c.name !== 'token_hash');
      const base = new Set(['id', 'created_at', 'last_seen', 'name', 'birth', 'birth_time', 'city', 'email', 'consent_version', 'consent_ts', 'streak', 'streak_date', 'onboarded']);
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
        name TEXT DEFAULT '', birth TEXT DEFAULT '', birth_time TEXT DEFAULT '', city TEXT DEFAULT '',
        email TEXT DEFAULT '', consent_version TEXT DEFAULT '', consent_ts TEXT DEFAULT '',
        streak INTEGER DEFAULT 0, streak_date TEXT DEFAULT '', onboarded INTEGER DEFAULT 0)`);
      for (const c of info) if (!base.has(c.name)) db.exec(`ALTER TABLE users_new ADD COLUMN ${c.name} ${c.type || 'TEXT'}${c.dflt_value !== null ? ' DEFAULT ' + c.dflt_value : ''}`);
      const keep = info.map((c) => c.name).join(', ');
      db.exec(`INSERT INTO users_new (${keep}) SELECT ${keep} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      console.log('таблица users пересобрана без token_hash');
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email <> ''");
  } },
  { v: 7, name: 'настройки человека (тема, ритуал, темы чтения)', up: (db) => addColumn(db, 'users', 'preferences', "TEXT DEFAULT ''") },
  { v: 8, name: 'индексы по человеку: лента, желания, привычки, аскезы и события ищутся по user_id, а не полным просмотром', up: (db) => db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, day, type);
    CREATE INDEX IF NOT EXISTS idx_journal_user ON journal (user_id, id);
    CREATE INDEX IF NOT EXISTS idx_journal_user_day ON journal (user_id, day);
    CREATE INDEX IF NOT EXISTS idx_wishes_user ON wishes (user_id, id);
    CREATE INDEX IF NOT EXISTS idx_habits_user ON habits (user_id);
    CREATE INDEX IF NOT EXISTS idx_askesis_user ON askesis (user_id);`) },
  /* Раньше эту колонку добавлял кабинет: момент подтверждения почты — точка отсчета когорт в отчетах */
  { v: 9, name: 'момент подтверждения почты (email_at)', up(db) {
    if (columns(db, 'users').includes('email_at')) return;
    db.exec("ALTER TABLE users ADD COLUMN email_at TEXT DEFAULT ''");
    // у тех, кто уже с почтой, момент подтверждения берем из события входа, иначе — из даты создания
    db.exec(`UPDATE users SET email_at = COALESCE(
      (SELECT MIN(ts) FROM events e WHERE e.user_id = users.id AND e.type = 'login_done'), created_at)
      WHERE email <> '' AND email_at = ''`);
  } },
  /* Раньше эти колонки добавляли рабочие кабинеты: первый источник человека (UTM с лендинга или рекламы) */
  { v: 10, name: 'UTM-метки первого визита', up(db) {
    for (const c of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'first_ref']) addColumn(db, 'users', c, "TEXT DEFAULT ''");
  } },
  /* Отчеты ищут первое действие человека и активность по дням; (user_id, ts) закрывает MIN(ts) по индексу */
  { v: 11, name: 'индекс событий по человеку и времени', up: (db) => db.exec('CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events (user_id, ts)') },
  /* Код на почту выдается для разных дел: вход и подтверждение удаления аккаунта.
     Без явной цели код, присланный «подтвердите удаление», годился бы и для входа. */
  { v: 12, name: 'цель кода на почту (вход или удаление аккаунта)', up: (db) => addColumn(db, 'login_codes', 'purpose', "TEXT NOT NULL DEFAULT 'login'") },
  /* Квитанции операций: повтор одного и того же действия не должен создавать вторую запись.
     Клиент шлет свой operationId; сохраненный ответ возвращается как есть, а тот же id с другим телом — это конфликт.
     Колонка называется user_id, а не account_id, чтобы таблица попала под общую политику личных данных
     (account-data.mjs) и ее страж: у каждой таблицы с user_id должно быть явное правило удаления. */
  { v: 13, name: 'квитанции операций — повтор не создает дубль', up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS sync_receipts (
      user_id INTEGER NOT NULL, operation_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_created ON sync_receipts (created_at);`) },
  /* Вечером можно отметить несколько настроений, хоть все (решение владелицы 16.09). Первое остается «главным» в moods —
     отчеты и старые экраны продолжают работать, а полный список живет здесь. */
  { v: 14, name: 'несколько настроений за день', up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS mood_marks (user_id INTEGER NOT NULL, day TEXT NOT NULL, mood TEXT NOT NULL, PRIMARY KEY (user_id, day, mood));`) },
  /* «Моя неделя»: связь «утренний настрой ↔ вечерняя запись» подтверждает сам человек — yes / no / unsure, одна отметка на день */
  { v: 15, name: 'что отозвалось за неделю', up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS week_echoes (user_id INTEGER NOT NULL, day TEXT NOT NULL, verdict TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (user_id, day));`) },
  /* Когда устройство в последний раз откликнулось на сигнал (забрало тексты) — чтобы в «Уведомлениях» было видно,
     доходят ли напоминания именно сюда, а не только «отправлено» */
  { v: 16, name: 'отклик устройства на пуш', up: (db) => { addColumn(db, 'push_subs', 'last_sent', "TEXT DEFAULT ''"); addColumn(db, 'push_subs', 'last_wake', "TEXT DEFAULT ''"); } },
  /* Фото дня: один снимок на день, миниатюра и полное — зашифрованными байтами (sealBytes) в базе; полное — до 350 КБ JPEG 1280 px,
     миниатюра — 240×240 ~10 КБ. Отдельная таблица, а не колонка journal: у дня может не быть текста, а фото — быть */
  { v: 17, name: 'фото дня', up: (db) => db.exec(`CREATE TABLE IF NOT EXISTS day_photos (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, ts TEXT NOT NULL, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0,
    thumb BLOB NOT NULL, full BLOB NOT NULL, PRIMARY KEY (user_id, day))`) },
  /* «Полки» (снимок только на сегодня, никем не читались) заменены базой знаний — knowledge.mjs создает свои таблицы сам */
  { v: 18, name: 'база знаний вместо полок', up: (db) => db.exec('DROP TABLE IF EXISTS shelves') },
  /* Ревизия личных данных (повторный аудит v112, R08): растет при каждой записи, правке и удалении; база знаний хранит ревизию,
     с которой собран документ, и пересобирает его при чтении, если данные с тех пор менялись — «удаленный текст остается в сводке» невозможно */
  { v: 19, name: 'ревизия личных данных для базы знаний', up: (db) => db.exec('ALTER TABLE users ADD COLUMN data_rev INTEGER DEFAULT 0') },
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].v;

/* Что обязано быть в базе после миграций — проверяется до старта HTTP-сервера */
const REQUIRED = {
  users: ['email', 'onboarded', 'ref_code', 'invited_by', 'bonus_until', 'photo', 'photo_ts', 'lat', 'lon', 'tz', 'city_region', 'preferences', 'email_at', 'utm_source', 'first_ref'],
  sessions: ['token_hash', 'user_id', 'created_at', 'last_seen'],
  entries: ['data'], journal: ['kind', 'title'], askesis: ['until'], habits: ['rule', 'rule_text'], wishes: ['photo', 'photo_ts'],
  events: ['user_id', 'day', 'type', 'age_band'], sync_receipts: ['user_id', 'operation_id', 'payload_hash', 'response_json'], push_subs: ['endpoint', 'user_id'], login_codes: ['code_hash', 'expires_at', 'purpose'],
};

/* Провести базу до текущей версии. Возвращает номер версии; бросает ошибку, если шаг не прошел. */
export function migrate(db, log = console.log) {
  db.exec('PRAGMA journal_mode = WAL');   // вне транзакции: внутри нее режим журнала не меняется
  let current = db.prepare('PRAGMA user_version').get().user_version;
  /* База новее кода — так бывает после отката выпуска (rollback.sh). Шаги только добавляют колонки и индексы
     (удалять — отдельным выпуском, когда код их уже не читает), поэтому прежний код работает на новой базе как есть:
     номер не понижаем, миграции не трогаем, verifySchema() ниже проверит нужное. */
  if (current > SCHEMA_VERSION) { log(`База: схема ${current} новее кода (${SCHEMA_VERSION}) — работаю на ней как есть, миграции не запускаются`); return current; }
  const from = current;
  for (const m of MIGRATIONS) {
    if (m.v <= current) continue;
    db.exec('BEGIN');
    try { m.up(db); db.exec(`PRAGMA user_version = ${m.v}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw new Error(`миграция ${m.v} «${m.name}» не прошла, база оставлена на версии ${current}: ${e.message}`); }
    current = m.v;
  }
  if (current !== from) log(`База: схема ${from} → ${current}`);
  return current;
}

/* Обязательные таблицы и колонки на месте — иначе ошибка с точным именем, а не 500 на первом запросе */
export function verifySchema(db) {
  const missing = [];
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const have = columns(db, table);
    if (!have.length) { missing.push(`${table} (таблицы нет)`); continue; }
    for (const c of cols) if (!have.includes(c)) missing.push(`${table}.${c}`);
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_email'").get() === undefined) missing.push('индекс idx_users_email');
  if (missing.length) throw new Error('схема базы неполная: ' + missing.join(', '));
  return true;
}
