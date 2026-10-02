import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate, verifySchema } from '../backend/schema.mjs';
import { privateText } from '../backend/private-text.mjs';
import { createMutation } from '../backend/mutation.mjs';
import { clearHistory, deleteAccount } from '../backend/account-data.mjs';
import { createRag } from '../backend/rag.mjs';
import { createRagProvider, RAG_NOT_READY } from '../backend/rag-provider.mjs';
import { splitText } from '../backend/rag-sources.mjs';

const dir = mkdtempSync(join(tmpdir(), 'lunario-rag-')), db = new DatabaseSync(':memory:');
migrate(db, () => {}); verifySchema(db);
const { seal, open } = privateText(dir), mutate = createMutation(db);
const person = (name) => { const r = db.prepare("INSERT INTO users(created_at,last_seen,name,birth,onboarded) VALUES ('2024-01-01','2026-10-02',?,'1990-01-01',1)").run(name); return Number(r.lastInsertRowid); };
const a = person('Анна'), b = person('Борис'), user = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const note = (id, text, day = '2024-02-01') => mutate(id, () => ({ ok: true, ...db.prepare('INSERT INTO journal(user_id,ts,day,text) VALUES (?,?,?,?)').run(id, day, day, seal(text)) }));
note(a, 'Когда тревожно, мне помогают прогулки у реки. В 2024 году это помогало после работы.');
note(b, 'Секрет Бориса: поездка в Сингапур.');
const vectors = new Map(), purged = new Set(); let delayIndex = null, generated = 0, leakId = '', duringGenerate = null;
const fetcher = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.endsWith('/health')) return Response.json({ ok: true });
  if (url.endsWith('/index')) { if (delayIndex) await delayIndex; vectors.set(body.namespace, body.items); return Response.json({ ok: true }); }
  if (url.endsWith('/purge')) { purged.add(body.namespace); vectors.delete(body.namespace); return Response.json({ ok: true }); }
  if (url.endsWith('/search')) return Response.json({ items: [...(vectors.get(body.namespace) || []).map(r => ({ id: r.id, score: r.text.includes('прогулки') ? 0.9 : 0.6 })), ...(leakId ? [{ id: leakId, score: 1 }] : [])] });
  throw new Error('unexpected request');
};
const provider = { configured: () => true, generate: async ({ context }) => { generated++; if (duringGenerate) duringGenerate(); return { answer: 'Вам помогали прогулки [S1].', ids: [context[0].id], model: 'test-double', input: 20, output: 10 }; } };
const rag = createRag({ db, seal, open, mutate, provider, dayOf: () => '2026-10-02', catalogVersion: () => 'test-v1', knowledge: { rebuild: () => ({ profile: { natal: null } }) }, serviceUrl: 'http://local.test', serviceToken: 'test', fetcher });
try {
  await rag.sync(a); await rag.sync(b);
  leakId = db.prepare('SELECT id FROM rag_chunks WHERE user_id=? LIMIT 1').get(b).id;
  const context = await rag.context(a, 'Что помогает мне справляться с тревогой?');
  assert(context.sources.some(s => s.text.includes('2024'))); // outside old 120-day window
  assert(!JSON.stringify(context).includes('Сингапур'));
  assert.equal(await rag.source(a, leakId), null);
  assert(db.prepare('SELECT text_enc FROM rag_chunks LIMIT 1').get().text_enc.startsWith('enc1:'));
  const beforeAnswer = user(a).data_rev;
  const req = randomUUID(), result = await rag.ask(user(a), 'Что помогает с тревогой?', req);
  assert.equal(user(a).data_rev, beforeAnswer + 1);
  assert(result.answer.includes('прогулки')); assert.equal(generated, 1);
  await rag.ask(user(a), 'Что помогает с тревогой?', req); assert.equal(generated, 1);
  assert.equal((await rag.ask(user(a), 'Другой вопрос', req)).error, 'request_conflict');
  assert(!db.prepare('SELECT answer FROM rag_turns').get().answer.includes('прогулки'));
  assert(rag.history(a)[0].question.includes('тревогой'));
  // Edits replace old chunks. Foreign IDs and deleted sources never resolve.
  const oldId = context.sources[0].chunk;
  mutate(a, () => { db.prepare('UPDATE journal SET text=? WHERE user_id=?').run(seal('Теперь помогает плавание в бассейне.'), a); return { ok: true }; });
  await rag.sync(a); assert.equal(await rag.source(a, oldId), null);
  // Deleting during a model request must suppress the late result.
  duringGenerate = () => clearHistory(db, user(a));
  const late = await rag.ask(user(a), 'Плавание в бассейне помогает?', randomUUID());
  assert.equal(late.answer, RAG_NOT_READY); assert.equal(rag.history(a).length, 0);
  await rag.purge(); assert(purged.size > 0);
  // Deletion during indexing cannot restore encrypted chunks after the account is gone.
  note(b, 'Дополнение'); let release; delayIndex = new Promise(r => { release = r; });
  const pending = rag.sync(b); deleteAccount(db, user(b)); release();
  await assert.rejects(pending, /data_changed/); assert.equal(db.prepare('SELECT count(*) n FROM rag_chunks WHERE user_id=?').get(b).n, 0);
  await rag.purge();
  assert(splitText('а'.repeat(1400)).every(s => s.length <= 650));
  // Provider rejects invented citations and uses the exact requested refusal.
  const api = createRagProvider({ getKey: () => ({ key: 'test', extra: 'test-folder', model: 'test-model' }), fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ answer: 'Вы переехали [S99]', source_ids: ['S99'] }) } }] }) });
  await assert.rejects(api.generate({ query: 'Где я живу?', context: [{ id: 'S1', text: 'Нет места проживания' }] }), /invalid_sources/);
  const off = createRag({ db, seal, open, mutate, provider: { configured: () => false }, dayOf: () => '2026-10-02' });
  assert.equal((await off.ask(user(a), 'Вопрос?', randomUUID())).answer, 'Пока не готовы ответить');
  console.log('PASS RAG: history, isolation, encrypted storage, edits, idempotency, deletion races, provider citations, exact refusal. Provider calls use a test double; no live generation claimed.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
