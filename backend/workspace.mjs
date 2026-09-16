/* Рабочие данные кабинетов: то, что сотрудники вносят сами и что потом считают дашборды.
   Кампании и UTM (маркетолог), материалы и картинки (контент), ИИ-провайдеры и беклог (продуктолог),
   обращения и чат с пользователем (поддержка). Всё — в той же базе, что и приложение.
   Тексты сообщений шифруются тем же ключом, что и дневник; ключи ИИ — тоже. */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MSK, dayIn } from './util.mjs';

let db, seal = (s) => s, open_ = (s) => s, UPLOADS = '';
export function initWorkspace(database, dataDir, sealFn, openFn) {
  db = database; seal = sealFn; open_ = openFn; UPLOADS = join(dataDir, 'uploads');
  if (!existsSync(UPLOADS)) mkdirSync(UPLOADS, { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT DEFAULT '', medium TEXT DEFAULT '', campaign TEXT DEFAULT '',
      content TEXT DEFAULT '', term TEXT DEFAULT '', placement TEXT DEFAULT '', promise TEXT DEFAULT '', cost REAL DEFAULT 0,
      start_day TEXT DEFAULT '', end_day TEXT DEFAULT '', url TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'note', section TEXT DEFAULT 'Мой день', title TEXT DEFAULT '',
      text TEXT DEFAULT '', image TEXT DEFAULT '', show_day TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, file TEXT NOT NULL, type TEXT DEFAULT '', size INTEGER DEFAULT 0,
      uploaded_by TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_providers (
      provider TEXT PRIMARY KEY, key_enc TEXT DEFAULT '', model TEXT DEFAULT '', extra TEXT DEFAULT '', enabled INTEGER DEFAULT 1,
      check_ok INTEGER, check_note TEXT DEFAULT '', checked_at TEXT DEFAULT '', updated_by TEXT DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'content',
      status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal', due_day TEXT DEFAULT '',
      created_by TEXT DEFAULT '', assignee TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT DEFAULT '', topic TEXT DEFAULT 'Прочее', feature TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL,
      first_reply_at TEXT DEFAULT '', resolved_at TEXT DEFAULT '', last_at TEXT NOT NULL, last_by TEXT DEFAULT 'user'
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets (user_id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, who TEXT NOT NULL, author TEXT DEFAULT '', text TEXT NOT NULL,
      ts TEXT NOT NULL, read_user INTEGER DEFAULT 0, read_support INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages (ticket_id);
  `);
  const mcols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  if (!mcols.includes('archived')) db.exec("ALTER TABLE media ADD COLUMN archived INTEGER DEFAULT 0");
  if (!mcols.includes('archived_at')) db.exec("ALTER TABLE media ADD COLUMN archived_at TEXT DEFAULT ''");
  if (!existsSync(join(UPLOADS, 'archive'))) mkdirSync(join(UPLOADS, 'archive'), { recursive: true });
  /* колонки users.utm_* и first_ref (первый источник человека) добавляет миграция в schema.mjs */
}

const now = () => new Date().toISOString();
const dayMSK = (d = new Date()) => dayIn(MSK, d.getTime());
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const clean = (s, n) => String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, n);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const mask = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');

/* ── UTM: первый источник знакомства, записывается один раз ── */
export function setUtm(userId, q) {
  const u = one('SELECT utm_source, utm_campaign FROM users WHERE id = ?', userId);
  if (!u || u.utm_source || u.utm_campaign) return { ok: true, kept: true };   // первый источник не затирается источником возвращения
  const v = (k) => clean(q[k], 80).toLowerCase();
  if (!v('utm_source') && !v('utm_campaign') && !v('ref')) return { ok: false };
  db.prepare('UPDATE users SET utm_source=?, utm_medium=?, utm_campaign=?, utm_content=?, utm_term=?, first_ref=? WHERE id=?')
    .run(v('utm_source'), v('utm_medium'), v('utm_campaign'), v('utm_content'), v('utm_term'), clean(q.ref, 120), userId);
  return { ok: true };
}

/* ── кампании ── */
export function campaignList() { return all('SELECT * FROM campaigns ORDER BY created_at DESC'); }
export function campaignSave(b, by) {
  const name = clean(b.name, 80); if (!name) return { ok: false, error: 'no_name' };
  const f = { name, source: clean(b.source, 60).toLowerCase(), medium: clean(b.medium, 60).toLowerCase(), campaign: clean(b.campaign, 80).toLowerCase(), content: clean(b.content, 80).toLowerCase(), term: clean(b.term, 80).toLowerCase(),
    placement: clean(b.placement, 120), promise: clean(b.promise, 200), cost: Math.max(0, Number(b.cost) || 0), start_day: isDay(b.start_day) ? b.start_day : '', end_day: isDay(b.end_day) ? b.end_day : '', url: clean(b.url, 300) };
  if (!f.source && !f.campaign) return { ok: false, error: 'no_utm' };
  if (Number(b.id)) db.prepare('UPDATE campaigns SET name=?, source=?, medium=?, campaign=?, content=?, term=?, placement=?, promise=?, cost=?, start_day=?, end_day=?, url=? WHERE id=?')
    .run(f.name, f.source, f.medium, f.campaign, f.content, f.term, f.placement, f.promise, f.cost, f.start_day, f.end_day, f.url, Number(b.id));
  else db.prepare('INSERT INTO campaigns (name, source, medium, campaign, content, term, placement, promise, cost, start_day, end_day, url, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.name, f.source, f.medium, f.campaign, f.content, f.term, f.placement, f.promise, f.cost, f.start_day, f.end_day, f.url, by || '', now());
  return { ok: true };
}
export function campaignRemove(id) { db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(id)); return { ok: true }; }
/* кампания ↔ люди: совпадение utm_source + utm_campaign (+ content, если задан) */
export function campaignUsers(c) {
  return all(`SELECT id, substr(email_at,1,10) day FROM users WHERE email <> '' AND email_at <> '' AND utm_source = ? AND utm_campaign = ? ${c.content ? 'AND utm_content = ?' : ''}`, ...(c.content ? [c.source, c.campaign, c.content] : [c.source, c.campaign]));
}

/* ── материалы контент-редактора ── */
export const MATERIAL_KINDS = { question: 'Вопрос дня', affirmation: 'Аффирмация дня', note: 'Заметка / статья' };
export const MATERIAL_STATUS = { draft: 'Черновик', review: 'На проверке', scheduled: 'Запланирован', published: 'Опубликован' };
export function materialList() { return all(`SELECT * FROM materials ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'review' THEN 2 ELSE 3 END, show_day DESC, updated_at DESC`); }
export function materialSave(b, by) {
  const kind = b.kind in MATERIAL_KINDS ? b.kind : 'note', status = b.status in MATERIAL_STATUS ? b.status : 'draft';
  const text = clean(b.text, 4000), title = clean(b.title, 120);
  if (!text && !title) return { ok: false, error: 'empty' };
  const f = [kind, clean(b.section, 40) || 'Мой день', title, text, clean(b.image, 300), isDay(b.show_day) ? b.show_day : '', status];
  if (Number(b.id)) db.prepare('UPDATE materials SET kind=?, section=?, title=?, text=?, image=?, show_day=?, status=?, updated_at=? WHERE id=?').run(...f, now(), Number(b.id));
  else db.prepare('INSERT INTO materials (kind, section, title, text, image, show_day, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...f, by || '', now(), now());
  return { ok: true };
}
export function materialRemove(id) { db.prepare('DELETE FROM materials WHERE id = ?').run(Number(id)); return { ok: true }; }
/* опубликованный материал на сегодня — подставляется в «Мой день» вместо текста из файла */
export function materialForDay(kind, day) {
  return one(`SELECT title, text, image FROM materials WHERE kind = ? AND status = 'published' AND (show_day = ? OR show_day = '') ORDER BY show_day DESC, updated_at DESC LIMIT 1`, kind, day) || null;
}

/* ── картинки и файлы ── */
/* SVG не принимаем: это документ со скриптом, открытый по ссылке с нашего домена он получил бы cookie сотрудника */
const MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt' };
export function mediaList() {
  const items = all('SELECT * FROM media ORDER BY archived, created_at DESC');
  const live = items.filter((m) => !m.archived).reduce((s, m) => s + m.size, 0), archived = items.filter((m) => m.archived).reduce((s, m) => s + m.size, 0);
  return { items, totals: { live, archived, count: items.length } };
}
/* сгрузить: файл уезжает в архив (не отдаётся по ссылке, не попадает к пользователям), запись остаётся; вернуть можно в любой момент */
export function mediaArchive(id, on) {
  const m = one('SELECT * FROM media WHERE id = ?', Number(id)); if (!m) return { ok: false, error: 'not_found' };
  const from = join(UPLOADS, m.archived ? 'archive' : '', m.file), to = join(UPLOADS, on ? 'archive' : '', m.file);
  if (!!m.archived === !!on) return { ok: true };
  try { renameSync(from, to); } catch (e) { return { ok: false, error: 'move_failed' }; }
  db.prepare('UPDATE media SET archived = ?, archived_at = ? WHERE id = ?').run(on ? 1 : 0, on ? now() : '', m.id);
  return { ok: true };
}
export function mediaFile(id) { const m = one('SELECT * FROM media WHERE id = ?', Number(id)); if (!m) return null; const p = join(UPLOADS, m.archived ? 'archive' : '', m.file); return existsSync(p) ? { path: p, name: m.name, type: m.type } : null; }
export function mediaAdd(b, by) {
  const ext = MEDIA_TYPES[b.type]; if (!ext) return { ok: false, error: 'bad_type' };
  const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) return { ok: false, error: 'too_big' };
  const file = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`;
  writeFileSync(join(UPLOADS, file), buf);
  db.prepare('INSERT INTO media (name, file, type, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?)').run(clean(b.name, 120) || file, file, b.type, buf.length, by || '', now());
  return { ok: true, file, url: `/app/uploads/${file}` };
}
export function mediaRemove(id) {
  const m = one('SELECT file, archived FROM media WHERE id = ?', Number(id)); if (!m) return { ok: false };
  try { unlinkSync(join(UPLOADS, m.archived ? 'archive' : '', m.file)); } catch {}
  db.prepare('DELETE FROM media WHERE id = ?').run(Number(id)); return { ok: true };
}
export function mediaPath(file) { const safe = String(file).replace(/[^a-z0-9.\-]/gi, ''); const p = join(UPLOADS, safe); return safe && existsSync(p) ? p : null; }

/* ── ИИ-провайдеры: ключи хранятся зашифрованными, наружу не отдаются ── */
export const AI_PROVIDERS = {
  openai: { label: 'GPT (OpenAI)', model: 'gpt-4o-mini', hint: 'ключ sk-… из platform.openai.com' },
  gemini: { label: 'Gemini (Google)', model: 'gemini-2.0-flash', hint: 'ключ из aistudio.google.com' },
  yandex: { label: 'Алиса / YandexGPT', model: 'yandexgpt-lite', hint: 'API-ключ сервисного аккаунта; в «доп.» — folder id' },
  gigachat: { label: 'ГигаЧат (Сбер)', model: 'GigaChat', hint: 'Authorization key из личного кабинета; в «доп.» — scope, например GIGACHAT_API_PERS' },
};
export function aiList() {
  const rows = Object.fromEntries(all('SELECT * FROM ai_providers').map((r) => [r.provider, r]));
  return Object.entries(AI_PROVIDERS).map(([k, d]) => { const r = rows[k] || {}; return { provider: k, label: d.label, hint: d.hint, model: r.model || d.model, extra: r.extra || '', hasKey: !!r.key_enc, keyTail: r.key_enc ? '…' + open_(r.key_enc).slice(-4) : '', enabled: r.enabled !== 0, check_ok: r.check_ok ?? null, check_note: r.check_note || '', checked_at: r.checked_at || '', updated_by: r.updated_by || '', updated_at: r.updated_at || '' }; });
}
export function aiSave(b, by) {
  const k = String(b.provider || ''); if (!(k in AI_PROVIDERS)) return { ok: false, error: 'bad_provider' };
  const cur = one('SELECT key_enc FROM ai_providers WHERE provider = ?', k) || {};
  const key = clean(b.key, 400);
  db.prepare(`INSERT INTO ai_providers (provider, key_enc, model, extra, enabled, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET key_enc = excluded.key_enc, model = excluded.model, extra = excluded.extra, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(k, key ? seal(key) : (cur.key_enc || ''), clean(b.model, 80) || AI_PROVIDERS[k].model, clean(b.extra, 200), b.enabled === false ? 0 : 1, by || '', now());
  return { ok: true };
}
export function aiRemove(k) { db.prepare('DELETE FROM ai_providers WHERE provider = ?').run(String(k)); return { ok: true }; }
export function aiKey(k) { const r = one('SELECT key_enc, model, extra, enabled FROM ai_providers WHERE provider = ?', k); return r && r.key_enc && r.enabled ? { key: open_(r.key_enc), model: r.model, extra: r.extra } : null; }
/* живая проверка ключа там, где это один GET; у Яндекса и Сбера — OAuth, проверяем только формат */
export async function aiCheck(k) {
  const c = aiKey(k); if (!c) return { ok: false, note: 'ключ не задан или выключен' };
  let ok = false, note = '';
  try {
    if (k === 'openai') { const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${c.key}` }, signal: AbortSignal.timeout(10000) }); ok = r.ok; note = ok ? 'ключ принят' : `ответ ${r.status}`; }
    else if (k === 'gemini') { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(c.key)}`, { signal: AbortSignal.timeout(10000) }); ok = r.ok; note = ok ? 'ключ принят' : `ответ ${r.status}`; }
    else if (k === 'yandex') { ok = c.key.length > 20 && !!c.extra; note = ok ? 'формат в порядке; folder id задан — проверится при первом вызове' : 'нужен ключ и folder id в поле «доп.»'; }
    else if (k === 'gigachat') { ok = c.key.length > 20; note = ok ? 'формат в порядке; токен по OAuth получится при первом вызове' : 'слишком короткий ключ'; }
  } catch (e) { ok = false; note = 'сеть: ' + e.message; }
  db.prepare('UPDATE ai_providers SET check_ok = ?, check_note = ?, checked_at = ? WHERE provider = ?').run(ok ? 1 : 0, note, now(), k);
  return { ok, note };
}

/* ── беклог задач ── */
export const TASK_STATUS = { new: 'Новая', in_progress: 'В работе', review: 'На проверке', done: 'Готово' };
export const TASK_ROLES = { content: 'Контент', support: 'Поддержка', product: 'Продукт', marketing: 'Маркетинг' };
export function taskList(role) {
  const rows = role ? all(`SELECT * FROM tasks WHERE role = ? ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, CASE priority WHEN 'high' THEN 0 ELSE 1 END, created_at DESC`, role)
    : all(`SELECT * FROM tasks ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, CASE priority WHEN 'high' THEN 0 ELSE 1 END, created_at DESC`);
  return rows.map((t) => ({ ...t, created_by: mask(t.created_by), assignee: mask(t.assignee) }));
}
export function taskSave(b, by) {
  const title = clean(b.title, 140); if (!title) return { ok: false, error: 'no_title' };
  const role = b.role in TASK_ROLES ? b.role : 'content', status = b.status in TASK_STATUS ? b.status : 'new', priority = b.priority === 'high' ? 'high' : 'normal';
  if (Number(b.id)) {
    const cur = one('SELECT status FROM tasks WHERE id = ?', Number(b.id)); if (!cur) return { ok: false, error: 'not_found' };
    db.prepare('UPDATE tasks SET title=?, text=?, role=?, status=?, priority=?, due_day=?, assignee=?, updated_at=?, done_at=? WHERE id=?')
      .run(title, clean(b.text, 2000), role, status, priority, isDay(b.due_day) ? b.due_day : '', clean(b.assignee, 120), now(), status === 'done' ? (cur.status === 'done' ? one('SELECT done_at d FROM tasks WHERE id = ?', Number(b.id)).d : now()) : '', Number(b.id));
  } else db.prepare('INSERT INTO tasks (title, text, role, status, priority, due_day, created_by, assignee, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(title, clean(b.text, 2000), role, status, priority, isDay(b.due_day) ? b.due_day : '', by || '', clean(b.assignee, 120), now(), now());
  return { ok: true };
}
/* role — область сотрудника (контент или поддержка видят только свои задачи); пустая — весь беклог */
export function taskStatus(id, status, by, role = '') {
  if (!(status in TASK_STATUS)) return { ok: false, error: 'bad_status' };
  const t = one('SELECT role FROM tasks WHERE id = ?', Number(id)); if (!t) return { ok: false, error: 'not_found' };
  if (role && t.role !== role) return { ok: false, error: 'no_access' };   // скрытая в списке задача не должна меняться по id
  db.prepare('UPDATE tasks SET status=?, updated_at=?, done_at=? WHERE id=?').run(status, now(), status === 'done' ? now() : '', Number(id));
  return { ok: true };
}
export function taskRemove(id) { db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(id)); return { ok: true }; }

/* ── обращения и чат ── */
export const TICKET_STATUS = { new: 'Новое', open: 'В работе', waiting: 'Ждём ответа', resolved: 'Решено' };
export const TICKET_TOPICS = ['Вход и код', 'Анкета и профиль', 'Расклады и ответы', 'Напоминания', 'Удаление данных', 'Оплата', 'Идея или пожелание', 'Прочее'];
const SLA_FIRST_MIN = 30;   // цель: первый ответ за 30 минут
const msg = (m) => ({ id: m.id, who: m.who, author: m.who === 'support' ? (m.author.split('@')[0] || 'поддержка') : '', text: open_(m.text), ts: m.ts });

export function userTickets(userId) {
  return all('SELECT * FROM tickets WHERE user_id = ? ORDER BY last_at DESC', userId).map((t) => ({ id: t.id, subject: open_(t.subject), topic: t.topic, status: t.status, statusName: TICKET_STATUS[t.status], created_at: t.created_at, last_at: t.last_at,
    unread: one('SELECT COUNT(*) c FROM messages WHERE ticket_id = ? AND who = ? AND read_user = 0', t.id, 'support').c }));
}
export function userUnread(userId) { return one('SELECT COUNT(*) c FROM messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.user_id = ? AND m.who = ? AND m.read_user = 0', userId, 'support').c; }
export function ticketCreate(userId, b) {
  const text = clean(b.text, 2000); if (text.length < 3) return { ok: false, error: 'short' };
  const topic = TICKET_TOPICS.includes(b.topic) ? b.topic : 'Прочее';
  const openCount = one('SELECT COUNT(*) c FROM tickets WHERE user_id = ? AND status <> ?', userId, 'resolved').c;
  if (openCount >= 5) return { ok: false, error: 'too_many_open' };
  const t = now();
  const r = db.prepare('INSERT INTO tickets (user_id, subject, topic, feature, status, priority, created_at, last_at, last_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(userId, seal(clean(b.subject, 120) || text.slice(0, 60)), topic, clean(b.feature, 60), 'new', 'normal', t, t, 'user');   // тема — тоже личный текст
  db.prepare('INSERT INTO messages (ticket_id, who, author, text, ts, read_user) VALUES (?,?,?,?,?,1)').run(Number(r.lastInsertRowid), 'user', '', seal(text), t);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
export function ticketThread(id, userId = null) {
  const t = one('SELECT * FROM tickets WHERE id = ?', Number(id)); if (!t || (userId !== null && t.user_id !== userId)) return null;
  const u = one('SELECT email, name FROM users WHERE id = ?', t.user_id) || {};
  const list = all('SELECT * FROM messages WHERE ticket_id = ? ORDER BY ts', t.id);
  if (userId !== null) db.prepare('UPDATE messages SET read_user = 1 WHERE ticket_id = ? AND who = ?').run(t.id, 'support');
  else db.prepare('UPDATE messages SET read_support = 1 WHERE ticket_id = ? AND who = ?').run(t.id, 'user');
  return { id: t.id, subject: open_(t.subject), topic: t.topic, feature: t.feature, status: t.status, statusName: TICKET_STATUS[t.status], priority: t.priority, created_at: t.created_at, first_reply_at: t.first_reply_at, resolved_at: t.resolved_at,
    user: userId !== null ? null : { id: t.user_id, email: mask(u.email), name: u.name || '' }, messages: list.map(msg) };
}
export function ticketMessage(id, who, text, author = '', userId = null) {
  const t = one('SELECT * FROM tickets WHERE id = ?', Number(id)); if (!t || (userId !== null && t.user_id !== userId)) return { ok: false, error: 'not_found' };
  const s = clean(text, 2000); if (!s) return { ok: false, error: 'empty' };
  const ts = now();
  db.prepare('INSERT INTO messages (ticket_id, who, author, text, ts, read_user, read_support) VALUES (?,?,?,?,?,?,?)').run(t.id, who, author, seal(s), ts, who === 'user' ? 1 : 0, who === 'support' ? 1 : 0);
  const status = who === 'support' ? (t.status === 'resolved' ? 'resolved' : 'waiting') : (t.status === 'resolved' ? 'open' : t.status === 'waiting' ? 'open' : t.status);
  db.prepare('UPDATE tickets SET last_at = ?, last_by = ?, status = ?, first_reply_at = CASE WHEN first_reply_at = \'\' AND ? = \'support\' THEN ? ELSE first_reply_at END, resolved_at = CASE WHEN ? = \'resolved\' THEN resolved_at ELSE \'\' END WHERE id = ?')
    .run(ts, who, status, who, ts, status, t.id);
  return { ok: true };
}
export function ticketSet(id, b, by) {
  const t = one('SELECT * FROM tickets WHERE id = ?', Number(id)); if (!t) return { ok: false, error: 'not_found' };
  const status = b.status in TICKET_STATUS ? b.status : t.status, priority = b.priority === 'high' ? 'high' : b.priority === 'normal' ? 'normal' : t.priority;
  db.prepare('UPDATE tickets SET status = ?, priority = ?, resolved_at = ?, topic = ? WHERE id = ?').run(status, priority, status === 'resolved' ? (t.resolved_at || now()) : '', TICKET_TOPICS.includes(b.topic) ? b.topic : t.topic, t.id);
  return { ok: true };
}
export function ticketQueue(status = '') {
  const rows = status ? all(`SELECT * FROM tickets WHERE status = ? ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END, last_at DESC`, status) : all(`SELECT * FROM tickets ORDER BY CASE status WHEN 'resolved' THEN 1 ELSE 0 END, CASE priority WHEN 'high' THEN 0 ELSE 1 END, last_at DESC`);
  return rows.map((t) => { const u = one('SELECT email, name FROM users WHERE id = ?', t.user_id) || {}; const mins = t.first_reply_at ? Math.round((Date.parse(t.first_reply_at) - Date.parse(t.created_at)) / 60000) : null;
    return { id: t.id, user: { id: t.user_id, email: mask(u.email), name: u.name || '' }, subject: open_(t.subject), topic: t.topic, status: t.status, statusName: TICKET_STATUS[t.status], priority: t.priority, created_at: t.created_at, last_at: t.last_at, last_by: t.last_by,
      firstReplyMin: mins, slaOk: mins === null ? null : mins <= SLA_FIRST_MIN, unread: one('SELECT COUNT(*) c FROM messages WHERE ticket_id = ? AND who = ? AND read_support = 0', t.id, 'user').c }; });
}
/* SLA и работа поддержки за период */
export function slaMetrics(from, to, prevFrom, prevTo) {
  const calc = (a, b) => {
    const rows = all('SELECT * FROM tickets WHERE substr(created_at,1,10) BETWEEN ? AND ?', a, b);
    const first = rows.filter((t) => t.first_reply_at).map((t) => (Date.parse(t.first_reply_at) - Date.parse(t.created_at)) / 60000).sort((x, y) => x - y);
    const res = rows.filter((t) => t.resolved_at).map((t) => (Date.parse(t.resolved_at) - Date.parse(t.created_at)) / 3600000).sort((x, y) => x - y);
    const med = (arr) => (arr.length ? Math.round(arr[Math.floor(arr.length / 2)] * 10) / 10 : null);
    const users = {}; for (const t of rows) users[t.user_id] = (users[t.user_id] || 0) + 1;
    const topics = {}; for (const t of rows) topics[t.topic] = (topics[t.topic] || 0) + 1;
    return { total: rows.length, answered: first.length, withinSla: first.filter((m) => m <= SLA_FIRST_MIN).length, medianFirst: med(first), medianResolve: med(res), resolved: res.length,
      repeat: Object.values(users).filter((n) => n > 1).length, topics: Object.entries(topics).sort((x, y) => y[1] - x[1]), byDay: all('SELECT substr(created_at,1,10) day, COUNT(*) n FROM tickets WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY day', a, b) };
  };
  const cur = calc(from, to), prev = calc(prevFrom, prevTo);
  return { cur, prev, open: one('SELECT COUNT(*) c FROM tickets WHERE status <> ?', 'resolved').c, waitingFirst: one("SELECT COUNT(*) c FROM tickets WHERE first_reply_at = '' AND status <> 'resolved'").c, slaMin: SLA_FIRST_MIN };
}
export function ticketCountsForUser(userId) { return { total: one('SELECT COUNT(*) c FROM tickets WHERE user_id = ?', userId).c, open: one('SELECT COUNT(*) c FROM tickets WHERE user_id = ? AND status <> ?', userId, 'resolved').c }; }
