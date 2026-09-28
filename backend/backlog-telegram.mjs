/* Durable backlog notifications. Telegram failure never changes a saved task. */
export function createBacklogTelegram({ db, token = '', chatId = '', cabinetUrl = '', fetchFn = fetch, clock = Date.now, log = console.warn }) {
  let busy = false;
  const enabled = Boolean(token && chatId);
  const format = (e) => {
    const roles = { content: 'Контент', support: 'Поддержка', product: 'Продукт', marketing: 'Маркетинг' };
    const statuses = { new: 'Новая', in_progress: 'В работе', review: 'На проверке', done: 'Готово' };
    const lines = [e.kind === 'created' ? 'Новая задача' : e.kind === 'status' ? 'Изменен статус задачи' : 'Прикреплена ссылка', `№ ${e.task_id} · ${e.title}`, `Функция: ${roles[e.role] || e.role}`];
    if (e.kind === 'status') lines.push(`${statuses[e.old_status] || e.old_status} → ${statuses[e.status] || e.status}`);
    if (e.kind === 'created') lines.push(`Статус: ${statuses[e.status] || e.status}`);
    if (e.kind === 'link') lines.push(e.link_title || 'Материал', e.url);
    return lines.join('\n');
  };
  async function flush() {
    if (!enabled || busy) return;
    busy = true;
    try {
      // One process owns the queue; pending rows survive restart. At most one message per tick.
      const row = db.prepare("SELECT * FROM backlog_telegram_outbox WHERE state = 'pending' ORDER BY id LIMIT 1").get();
      if (!row || row.next_at > clock()) return;
      const event = JSON.parse(row.payload);
      const body = { chat_id: chatId, text: format(event), link_preview_options: { is_disabled: true } };
      if (cabinetUrl) body.reply_markup = { inline_keyboard: [[{ text: 'Открыть кабинет', url: cabinetUrl }]] };
      let result, response;
      try {
        response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        result = await response.json();
      } catch { result = { ok: false }; }
      if (response?.ok && result?.ok) {
        db.prepare("UPDATE backlog_telegram_outbox SET state='sent', sent_at=?, attempts=attempts+1, last_error='' WHERE id=?").run(clock(), row.id);
      } else {
        const code = Number(result?.error_code || response?.status || 0);
        const permanent = [400, 401, 403, 404].includes(code);
        const retry = Math.max(2000, Math.min(3600000, Number(result?.parameters?.retry_after || 0) * 1000 || 2000 * 2 ** Math.min(row.attempts, 10)));
        db.prepare('UPDATE backlog_telegram_outbox SET state=?, attempts=attempts+1, next_at=?, last_error=? WHERE id=?')
          .run(permanent ? 'failed' : 'pending', clock() + retry, code ? `telegram_${code}` : 'network_error', row.id);
        log(`[backlog-telegram] event ${row.id}: ${permanent ? 'failed' : 'retry'} (${code || 'network'})`);
      }
      db.prepare("DELETE FROM backlog_telegram_outbox WHERE state='sent' AND sent_at < ?").run(clock() - 30 * 86400000);
    } finally { busy = false; }
  }
  function start() {
    if (!enabled) return () => {};
    const tick = () => flush().catch(() => log('[backlog-telegram] queue error'));
    const timer = setInterval(tick, 2000); timer.unref(); tick();
    return () => clearInterval(timer);
  }
  return { enabled, flush, start };
}
