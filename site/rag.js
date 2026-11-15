/* Personal conversation: no localStorage transcripts; account context guards every await. */
let ragSending = false, ragRequest = null;
async function ragAvailability() {
  const c = ctx();
  try { const s = await api('/rag/status'); if (c.alive() && $('rag-entry')) $('rag-entry').hidden = !s.available; } catch {}
}
function ragRenderTurn(item) {
  const article = document.createElement('article'); article.className = 'rag-turn';
  const question = document.createElement('p'); question.className = 'rag-question'; question.textContent = item.question;
  const answer = document.createElement('p'); answer.className = 'rag-answer'; answer.textContent = item.answer;
  article.append(question, answer);
  if (item.sources?.length) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'На чем основан ответ'; details.append(summary);
    for (const s of item.sources) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn ghost sm';
      button.textContent = `${s.id} · ${s.label}${s.day ? ' · ' + fmtDay(s.day) : ''}`;
      if (s.chunk) button.addEventListener('click', async () => {
        const c = ctx(); button.disabled = true;
        try { const source = await api('/rag/source?id=' + encodeURIComponent(s.chunk)); if (!c.alive()) return; const p = document.createElement('p'); p.className = 'rag-source'; p.textContent = source.text; button.replaceWith(p); }
        catch { if (c.alive()) { button.textContent = 'Источник изменен или удален'; button.disabled = false; } }
      });
      else button.disabled = true;
      details.append(button);
    }
    article.append(details);
  }
  return article;
}
async function openRag() {
  const box = $('rag-panel'), c = ctx(); box.hidden = false; $('rag-messages').replaceChildren();
  try { const r = await api('/rag/history'); if (!c.alive()) return; for (const item of r.items) $('rag-messages').append(ragRenderTurn(item)); }
  catch { if (c.alive()) $('rag-status').textContent = 'Не получилось загрузить разговор'; }
  if (c.alive()) { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('rag-question').focus(); }
}
async function sendRag(event) {
  event.preventDefault(); if (ragSending) return;
  const input = $('rag-question'), question = input.value.trim(), c = ctx(); if (question.length < 3) return;
  ragSending = true;
  if (!ragRequest || ragRequest.question !== question) ragRequest = { question, requestId: crypto.randomUUID() };
  const send = $('rag-send'); send.disabled = true; $('rag-status').textContent = 'Собираем ваш контекст…';
  try {
    const r = await api('/rag/ask', { method: 'POST', body: JSON.stringify(ragRequest) }); if (!c.alive()) return;
    $('rag-messages').append(ragRenderTurn({ question, ...r }));
    if (!r.reason) { input.value = ''; ragRequest = null; }
    $('rag-status').textContent = '';
  } catch { if (c.alive()) $('rag-status').textContent = 'Пока не готовы ответить'; }
  finally { ragSending = false; if (c.alive()) send.disabled = false; }
}
function clearRagUi() {
  ragRequest = null;
  $('rag-messages')?.replaceChildren();
  if ($('rag-question')) $('rag-question').value = '';
  if ($('rag-panel')) $('rag-panel').hidden = true;
  if ($('rag-entry')) $('rag-entry').hidden = true;
}
