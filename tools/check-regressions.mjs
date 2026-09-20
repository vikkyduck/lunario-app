/* Обязательные регрессии в браузере (повторный аудит v112, R15): последствия, которые штатные проверки маршрутов не ловят —
   правка между экранами, потерянный ответ и уточнение текста, удаление и повторное открытие, отмена выбора карт, очистка с черновиком.
   Настоящий бэкенд и изолированная база check-personal-features; запускается из него: --ui-regression (и в составе --ui).
   Экраны здесь дергаются теми же функциями, что и кнопки (go, openWidget, saveDayCard…) — проверяется путь данных, а не пиксели. */
import assert from 'node:assert/strict';
export async function checkRegressions({ browser, base, owner }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const [name, value] = owner.cookie.split('='); await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/app', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const pr = (await owner.json('/preferences')).preferences; await owner.json('/preferences', 'POST', { tools: [...new Set([...(pr.tools || []), 'gratitude', 'journal'])] });
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-home.on');
    const today = await page.evaluate(() => S.day.date);
    /* R01: благодарность A → карточка дня загружена → в панели правим на B → сохраняем день с новым настроением: остается B */
    await owner.json('/journal', 'POST', { text: 'Благодарность A — из панели', kind: 'gratitude' });
    await page.evaluate(() => go('history')); await page.waitForFunction(() => DC.state && DC.state.gratitude && DC.state.gratitude.text.startsWith('Благодарность A'));
    await page.evaluate(() => openWidget('gratitude')); await page.waitForSelector('#gr-box .saved-state');
    await page.evaluate(() => editGratitude(S.grat.items.find((i) => i.day === S.day.date).id)); await page.waitForSelector('#gr-text');
    await page.fill('#gr-text', 'Благодарность B — уточнена в панели'); await page.click('#gr-box button[data-on="click:saveGratitude"]');
    await page.waitForFunction(() => S.grat.items.some((i) => i.text.startsWith('Благодарность B')));
    await page.evaluate(() => { closeWidget(); DC.mode = 'steps'; dcMood('joy'); return saveDayCard(); });
    await page.waitForFunction(() => DC.mode !== 'steps' || !saveDayCard.busy);
    const st = await owner.json('/day'); assert.equal(st.gratitude.text, 'Благодарность B — уточнена в панели', 'the day save keeps the fresh gratitude from the panel (R01)');
    assert.deepEqual(st.moods, ['joy']);
    /* R01: удаленный ответ не остается в панели «Вопрос дня» */
    const ans = await owner.json('/journal', 'POST', { text: 'Ответ дня, который удалят', kind: 'answer', title: 'Вопрос' });
    await page.evaluate(() => { ANS.loadedFor = ''; return ensureAnswer(); }); await page.waitForFunction(() => ANS.saved && ANS.saved.text.startsWith('Ответ дня'));
    await page.evaluate((id) => dayRemove(S.day.date, 'answer:' + id), ans.item.id);
    await page.waitForFunction(() => !ANS.saved);
    await page.evaluate(() => ensureAnswer()); assert.equal(await page.evaluate(() => ANS.saved), null, 'a deleted answer is gone from the panel without a reload (R01)');
    /* R04: ответ сервера потерян, текст уточнен, повтор — одна запись с последним текстом */
    await page.evaluate(() => { go('history'); openWidget('gratitude'); }); await page.waitForSelector('#gr-box');
    await page.evaluate(() => editGratitude(S.grat.items.find((i) => i.day === S.day.date).id)); await page.waitForSelector('#gr-text');
    await page.evaluate(() => { gratitudeEdit = null; });   /* как новая запись: путь с ключом операции */
    let lost = 0; await page.route('**/api/journal', async (route) => { if (route.request().method() === 'POST' && !lost) { lost = 1; await route.fetch(); return route.abort(); } return route.continue(); });
    await page.fill('#gr-text', 'Благодарность C — первая попытка'); await page.click('#gr-box button[data-on="click:saveGratitude"]');
    await page.waitForFunction(() => document.querySelector('#gr-box button[data-on="click:saveGratitude"]') && !gratitudeSaving);
    await page.fill('#gr-text', 'Благодарность C — уточненная'); await page.click('#gr-box button[data-on="click:saveGratitude"]');
    await page.waitForFunction(() => S.grat.items.some((i) => i.text === 'Благодарность C — уточненная'));
    await page.unroute('**/api/journal');
    const grats = (await owner.json('/journal?kind=gratitude')).items.filter((i) => i.text.startsWith('Благодарность C'));
    assert.deepEqual(grats.map((g) => g.text), ['Благодарность C — уточненная'], 'lost response + edit leaves one record with the last text (R04)');
    /* R11: закрыть панель во время выбора карт — кнопка снова работает и дает результат */
    await page.evaluate(() => { closeWidget(); go('ask'); openWidget('worry'); }); await page.waitForSelector('#hub-q');
    await page.fill('#hub-q', 'Что мне важно понять про этот разговор сейчас?'); await page.evaluate(() => hubCheck());
    await page.click('#hub-go'); await page.waitForSelector('#picker .fan-card');
    await page.click('.wg-x'); await page.waitForFunction(() => !hubAsk.busy, null, { timeout: 5000 });
    await page.evaluate(() => openWidget('worry')); await page.waitForSelector('#hub-q');
    await page.fill('#hub-q', 'Что мне важно понять про этот разговор сейчас?'); await page.evaluate(() => hubCheck());
    await page.click('#hub-go'); await page.waitForSelector('#picker .fan-card');
    const need = await page.evaluate(() => PICK.need);
    for (let i = 0; i < need; i++) await page.locator('#picker .fan-card').nth(i).click();
    await page.waitForSelector('#hub-res .card .actions, #hub-res .card', { timeout: 15000 });
    assert.ok((await owner.json('/entries?kind=questions')).items.some((e) => e.question.startsWith('Что мне важно понять')), 'after a cancelled pick the next question still produces a result (R11)');
    /* R06 + R07: черновик недели, очистка истории — черновика нет; пустой черновик остается пустым */
    await page.evaluate(() => { closeWidget(); go('history'); openWidget('week'); }); await page.waitForSelector('#wk-reflect');
    await page.fill('#wk-reflect', 'Черновик итога, который должен исчезнуть'); await page.evaluate(() => wkReflectInput(document.getElementById('wk-reflect')));
    assert.ok((await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('lun_draft_')))), 'a week draft is on the device');
    await page.evaluate(() => { closeWidget(); return wipe('data'); }); await page.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith('lun_draft_')));
    await page.evaluate(() => openWidget('week')); await page.waitForSelector('#wk-reflect');
    assert.equal(await page.inputValue('#wk-reflect'), '', 'after clearing the history the old draft is not shown (R06)');
    await owner.json('/week/reflect', 'POST', { text: 'Сохраненный итог недели' });
    await page.evaluate(() => { closeWidget(); WK.data = null; openWidget('week'); }); await page.waitForFunction(() => document.getElementById('wk-reflect') && document.getElementById('wk-reflect').value === 'Сохраненный итог недели');
    await page.fill('#wk-reflect', ''); await page.evaluate(() => wkReflectInput(document.getElementById('wk-reflect')));
    await page.evaluate(() => { closeWidget(); openWidget('week'); }); await page.waitForSelector('#wk-reflect');
    assert.equal(await page.inputValue('#wk-reflect'), '', 'a cleared draft stays empty on reopen (R07)');
    assert.deepEqual(errors, [], 'no page errors during the regressions');
    console.log('PASS: browser regressions — cross-screen gratitude edit, deleted answer, lost response + edit, cancelled card pick, drafts after history clearing.');
  } finally { await ctx.close(); }
}
