/* Рабочие кабинеты: роли по почте, доступы, расходы. Отчёты и дашборд — в reports.mjs.
   Личных текстов здесь нет: только счётчики, дни и типы событий. */
import { MSK, dayIn } from './util.mjs';

export const ROLES = {
  admin:     'Админ',
  marketing: 'Маркетолог',
  product:   'Продуктолог',
  content:   'Контент',
  support:   'Поддержка',
  user:      'Пользователь',
};
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'vikavika.utkina@yandex.ru,e.ratochka@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (email) => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

let db;
export function initCabinet(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      email TEXT PRIMARY KEY, name TEXT DEFAULT '', roles TEXT DEFAULT '[]',
      added_by TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'fixed', ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
      path TEXT DEFAULT '', message TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_errors_day ON errors (day);
  `);
  /* колонка users.email_at — момент подтверждения почты — добавляется миграцией в schema.mjs */
}

const dayMSK = (d = new Date()) => dayIn(MSK, d.getTime());
export function logError(path, message) {
  try {
    const ts = new Date().toISOString();
    db.prepare('INSERT INTO errors (ts, day, path, message) VALUES (?,?,?,?)').run(ts, dayMSK(), String(path).slice(0, 120), String(message).slice(0, 300));
  } catch {}
}

/* ── роли ── */
export function rolesFor(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return [];
  if (isAdmin(e)) return Object.keys(ROLES);
  const row = db.prepare('SELECT roles FROM staff WHERE email = ?').get(e);
  if (!row) return [];
  const roles = safeRoles(JSON.parse(row.roles || '[]'));
  return roles.length ? [...new Set([...roles, 'user'])] : [];
}
const safeRoles = (arr) => (Array.isArray(arr) ? arr : []).filter((r) => r in ROLES && r !== 'admin');

export function staffList() {
  const rows = db.prepare('SELECT email, name, roles, added_by, created_at FROM staff ORDER BY created_at').all()
    .map((r) => ({ ...r, roles: safeRoles(JSON.parse(r.roles || '[]')), admin: false }));
  const admins = ADMIN_EMAILS.map((email) => {
    const u = db.prepare('SELECT name FROM users WHERE email = ?').get(email);
    return { email, name: (u && u.name) || '', roles: Object.keys(ROLES), admin: true, locked: true };
  });
  return [...admins, ...rows.filter((r) => !isAdmin(r.email))];
}
export function staffSet(email, name, roles, by) {
  const e = String(email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return { ok: false, error: 'bad_email' };
  if (isAdmin(e)) return { ok: false, error: 'admin_locked' };          // права админов не трогаются
  const r = safeRoles(roles);
  db.prepare(`INSERT INTO staff (email, name, roles, added_by, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, roles = excluded.roles`)
    .run(e, String(name || '').slice(0, 80), JSON.stringify(r), by || '', new Date().toISOString());
  return { ok: true };
}
export function staffRemove(email) {
  const e = String(email || '').toLowerCase();
  if (isAdmin(e)) return { ok: false, error: 'admin_locked' };
  db.prepare('DELETE FROM staff WHERE email = ?').run(e);
  return { ok: true };
}

/* ── расходы ── */
const COST_KIND_KEYS = ['infra', 'services', 'support', 'content', 'acquisition', 'dev', 'budget'];
export function costAdd(month, name, amount, kind) {
  if (!/^\d{4}-\d{2}$/.test(month || '') || !name || !COST_KIND_KEYS.includes(kind)) return { ok: false, error: 'bad_cost' };
  db.prepare('INSERT INTO costs (month, name, amount, kind, ts) VALUES (?,?,?,?,?)').run(month, String(name).slice(0, 80), Number(amount) || 0, kind, new Date().toISOString());
  return { ok: true };
}
export function costRemove(id) { db.prepare('DELETE FROM costs WHERE id = ?').run(Number(id)); return { ok: true }; }
