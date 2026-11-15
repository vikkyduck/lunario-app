import { randomUUID } from 'node:crypto';
import { collectRagSources, chunkSources } from './rag-sources.mjs';
import { RAG_NOT_READY } from './rag-provider.mjs';

const terms = q => [...new Set(q.toLowerCase().replaceAll('\u0451', 'е').match(/[а-яa-z0-9]{4,}/g) || [])].filter(w => !['почему','котор','какой','какая','сегодня','пожалуйста','помоги','меня','могу','мне','этот','этого','были','было'].includes(w)).map(w => w.length > 5 ? w.slice(0, -2) : w);
const yieldTick = () => new Promise(resolve => setImmediate(resolve));
export function createRag({ db, seal, open, knowledge, dayOf, catalogVersion, mutate, provider, serviceUrl = process.env.RAG_URL || '', serviceToken = process.env.RAG_SERVICE_TOKEN || '', fetcher = fetch, logger = () => {} }) {
  const indexVersion = () => `rag-v1:${process.env.RAG_MODEL || 'intfloat/multilingual-e5-small'}:${catalogVersion()}`;
  const enabled = !!serviceUrl && !!serviceToken, syncing = new Map(), asking = new Set();
  let pumping = false, lastFailure = 0;
  const userOf = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const stateOf = id => db.prepare('SELECT * FROM rag_state WHERE user_id=?').get(id);
  const same = (id, rev, namespace) => { const u = userOf(id), s = stateOf(id); return !!u && u.data_rev === rev && s?.namespace === namespace; };
  const noAnswer = reason => ({ ok: true, answer: RAG_NOT_READY, sources: [], reason });
  async function call(path, body, ms = 60000) {
    if (!enabled) throw new Error('rag_disabled');
    const r = await fetcher(serviceUrl + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(ms), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error(`rag_http_${r.status}`);
    return r.json();
  }
  async function syncOne(id) {
    let u = userOf(id); if (!u) return;
    let s = stateOf(id);
    if (!s) { db.prepare('INSERT INTO rag_state(user_id,namespace) VALUES (?,?)').run(id, randomUUID()); s = stateOf(id); }
    const catalog = indexVersion(), revision = u.data_rev;
    if (s.rev === revision && s.catalog === catalog) return s;
    // Source snapshot and revision are read without awaits in the same Node event-loop turn.
    const profile = knowledge.rebuild(u, dayOf(u), ['profile']).profile;
    const sources = collectRagSources({ db, user: u, open, profile });
    const chunks = chunkSources(s.namespace, sources);
    if (chunks.length > 100000) throw new Error('index_too_large');
    await call('/index', { namespace: s.namespace, items: chunks.map(x => ({ id: x.id, text: x.text })) }, 180000);
    // Deletion, editing or account transfer may have happened while embedding.
    if (!same(id, revision, s.namespace)) throw new Error('data_changed');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM rag_chunks WHERE user_id=?').run(id);
      const put = db.prepare('INSERT INTO rag_chunks(id,user_id,source_key,label,kind,day,text_enc) VALUES (?,?,?,?,?,?,?)');
      for (const c of chunks) put.run(c.id, id, c.key, c.label, c.kind, c.day, seal(c.text));
      db.prepare('UPDATE rag_state SET rev=?,catalog=?,updated_at=? WHERE user_id=? AND namespace=?').run(revision, catalog, new Date().toISOString(), id, s.namespace);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return stateOf(id);
  }
  function sync(id) {
    if (!syncing.has(id)) syncing.set(id, syncOne(id).finally(() => syncing.delete(id)));
    return syncing.get(id);
  }
  async function purge() {
    for (const r of db.prepare('SELECT namespace FROM rag_purges LIMIT 20').all()) {
      await call('/purge', r);
      db.prepare('DELETE FROM rag_purges WHERE namespace=?').run(r.namespace);
    }
  }
  async function pump() {
    if (!enabled || pumping || Date.now() - lastFailure < 30000) return;
    pumping = true;
    try {
      await purge();
      const catalog = indexVersion();
      const ids = db.prepare('SELECT u.id FROM users u LEFT JOIN rag_state s ON s.user_id=u.id WHERE u.onboarded=1 AND (s.user_id IS NULL OR s.rev<>u.data_rev OR s.catalog<>?) LIMIT 10').all(catalog);
      for (const { id } of ids) { await yieldTick(); await sync(id); }
    } catch (e) { lastFailure = Date.now(); logger('rag_index', e.message.startsWith('rag_') ? e.message : 'index_failed'); }
    finally { pumping = false; }
  }
  async function status() {
    if (!enabled || !provider.configured()) return { available: false };
    try { await call('/health', null, 2000); return { available: true }; } catch { return { available: false }; }
  }
  async function context(id, query) {
    const s = await sync(id); if (!s) throw new Error('data_changed');
    const result = await call('/search', { namespace: s.namespace, query, top_k: 24 });
    if (!same(id, s.rev, s.namespace)) throw new Error('data_changed');
    const rows = db.prepare('SELECT * FROM rag_chunks WHERE user_id=?').all(id);
    const scores = new Map(result.items.map(x => [x.id, Number(x.score)])), words = terms(query);
    let from = '', to = dayOf(userOf(id));
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g);
    if (dates?.length) { from = dates[0]; to = dates[1] || dates[0]; }
    else if (/за (?:последн\S* |этот |эту )?(месяц|неделю|7 дней|30 дней)/i.test(query)) {
      const days = /неделю|7 дней/i.test(query) ? 7 : 30;
      from = new Date(Date.parse(to + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
    }
    const best = Math.max(0, ...scores.values());
    const ranked = rows.map(r => {
      const text = open(r.text_enc), lower = text.toLowerCase().replaceAll('\u0451', 'е');
      const lexical = words.filter(w => lower.includes(w)).length;
      return { ...r, text, semantic: scores.get(r.id) || 0, rank: (scores.get(r.id) || 0) + Math.min(lexical, 4) * 0.045 + (['user_statement','user_observation'].includes(r.kind) ? 0.04 : 0), lexical };
    }).filter(r => (!from || !r.day || (r.day >= from && r.day <= to)) && (r.semantic >= Math.max(0.80, best - 0.05) || r.lexical > 0)).sort((a, b) => b.rank - a.rank);
    const selected = [], keys = new Set(); let length = 0;
    // Questions about change use the complete date range, not just nearest vector neighbors.
    if (from && /настро|состояни|чувств|измен|динамик/i.test(query)) {
      const moods = db.prepare('SELECT mood,COUNT(*) AS days FROM moods WHERE user_id=? AND day BETWEEN ? AND ? GROUP BY mood').all(id, from, to);
      const marks = db.prepare('SELECT mood,COUNT(*) AS marks FROM mood_marks WHERE user_id=? AND day BETWEEN ? AND ? GROUP BY mood').all(id, from, to);
      if (moods.length || marks.length) selected.push({ id: 'S1', label: `Настроения с ${from} по ${to}`, kind: 'calculation', day: from, text: JSON.stringify({ from, to, mainMoodByDay: moods, allMoodMarks: marks, note: 'Дни без отметок неизвестны, это не отсутствие переживаний.' }), chunk: '' });
    }
    for (const r of ranked) {
      if (keys.has(r.source_key) || length + r.text.length > 8500) continue;
      if (r.kind === 'astrology' && selected.filter(s => s.kind === 'astrology').length >= 2 && !/натальн|планет|астро|карт[ауые]|аспект/i.test(query)) continue;
      keys.add(r.source_key); length += r.text.length;
      selected.push({ id: `S${selected.length + 1}`, label: r.label, kind: r.kind, day: r.day, text: r.text, chunk: r.id });
      if (selected.length >= 8) break;
    }
    return { sources: selected, state: s };
  }
  function history(id) {
    return db.prepare('SELECT id,day,ts,question,answer,sources FROM rag_turns WHERE user_id=? ORDER BY id DESC LIMIT 20').all(id).reverse().map(r => ({ id: r.id, day: r.day, ts: r.ts, question: open(r.question), answer: open(r.answer), sources: JSON.parse(open(r.sources)) }));
  }
  async function ask(user, query, requestId) {
    const existing = db.prepare('SELECT question,answer,sources FROM rag_turns WHERE user_id=? AND request_id=?').get(user.id, requestId);
    if (existing) return open(existing.question) === query ? { ok: true, answer: open(existing.answer), sources: JSON.parse(open(existing.sources)), repeated: true } : { ok: false, error: 'request_conflict' };
    if (!enabled || !provider.configured()) return noAnswer('unavailable');
    if (asking.has(user.id) || asking.size >= 2) return noAnswer('busy');
    const day = dayOf(user), used = db.prepare('SELECT requests FROM rag_usage WHERE user_id=? AND day=?').get(user.id, day)?.requests || 0;
    if (used >= Number(process.env.RAG_DAILY_LIMIT || 20)) return noAnswer('limit');
    asking.add(user.id);
    try {
      const { sources, state } = await context(user.id, query);
      if (!sources.length) return noAnswer('no_context');
      db.prepare('INSERT INTO rag_usage(user_id,day,requests) VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET requests=requests+1').run(user.id, day);
      const previous = history(user.id).filter(x => x.sources.length && x.sources.every(s => s.chunk && db.prepare('SELECT 1 FROM rag_chunks WHERE id=? AND user_id=?').get(s.chunk, user.id))).slice(-3).map(x => ({ question: x.question.slice(0, 500), answer: x.answer.slice(0, 500) }));
      const result = await provider.generate({ query, context: sources.map(({ chunk, ...rest }) => rest), history: previous });
      if (!same(user.id, state.rev, state.namespace) || state.catalog !== indexVersion()) return noAnswer('changed');
      const usedSources = sources.filter(s => result.ids.includes(s.id)).map(({ text, kind, ...rest }) => rest);
      // Source text is kept in encrypted chunks, never copied into public logs.
      mutate(user.id, () => {
        db.prepare('INSERT INTO rag_turns(user_id,request_id,day,ts,question,answer,sources,model,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?,?)').run(user.id, requestId, day, new Date().toISOString(), seal(query), seal(result.answer), seal(JSON.stringify(usedSources)), result.model, result.input, result.output);
        return { ok: true };
      });
      return { ok: true, answer: result.answer, sources: usedSources };
    } catch (e) { logger('rag_answer', /^provider_http_\d+$/.test(e.message) ? e.message : 'answer_unavailable'); return noAnswer('unavailable'); }
    finally { asking.delete(user.id); }
  }
  async function source(id, chunk) {
    const s = await sync(id); if (!s || !same(id, s.rev, s.namespace)) return null;
    const r = db.prepare('SELECT label,day,text_enc FROM rag_chunks WHERE user_id=? AND id=?').get(id, chunk);
    return r ? { label: r.label, day: r.day, text: open(r.text_enc) } : null;
  }
  return { status, ask, context, sync, purge, pump, source, history, start() { if (enabled) { setTimeout(pump, 5000).unref(); setInterval(pump, 10000).unref(); } } };
}
