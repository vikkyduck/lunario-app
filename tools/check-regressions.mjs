/* Обязательные регрессии в браузере (повторный аудит v112, R15): последствия, которые штатные проверки маршрутов не ловят —
   правка между экранами, потерянный ответ и уточнение текста, удаление и повторное открытие, отмена выбора карт, очистка с черновиком.
   Настоящий бэкенд и изолированная база check-personal-features; запускается из него: --ui-regression (и в составе --ui).
   Экраны здесь дергаются теми же функциями, что и кнопки (go, openWidget, saveDayCard…) — проверяется путь данных, а не пиксели. */
import assert from 'node:assert/strict';
export async function checkRegressions({ browser, base, owner, codeFor }) {
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
    await page.evaluate(() => openWidget('gratitude')); await page.waitForFunction(() => S.grat && S.grat.items.some((i) => i.day === S.day.date)); await page.waitForSelector('#gr-box .saved-state');
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
    await page.evaluate(() => { go('history'); openWidget('gratitude'); }); await page.waitForFunction(() => S.grat && S.grat.items.some((i) => i.day === S.day.date));   /* после записи дня панель перечитывает ленту */
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
    /* F05 (ревью v114): задержанный ответ /habits и /askesis после очистки истории не возвращает удаленное — один контекст запросов, а не список.
       Ответ снимается с сервера до очистки (в нем удаленная запись) и отдается странице после нее — как поздний ответ в сети */
    for (const [path, widget, state, title] of [['/habits', 'habits', 'HB', 'Привычка до очистки'], ['/askesis', 'askesis', 'AS', 'Аскеза до очистки']]) {
      if (path === '/habits') await owner.json('/habits', 'POST', { title, rule: 'каждый день' });
      else await owner.json('/askesis', 'POST', { title, until: new Date(Date.parse(today + 'T12:00:00Z') + 5 * 864e5).toISOString().slice(0, 10) });
      let release; const held = new Promise((r) => { release = r; });
      await page.route('**/api' + path, async (route) => { if (route.request().method() !== 'GET') return route.continue(); const stale = await route.fetch(); await held; try { await route.fulfill({ response: stale }); } catch { /* запрос уже отменен страницей */ } });
      const pendingGet = page.waitForRequest((r) => r.url().endsWith('/api' + path) && r.method() === 'GET');
      await page.evaluate((w) => { closeWidget(); go('history'); openWidget(w); }, widget);
      await pendingGet; await page.waitForTimeout(150);   /* запрос ушел и держится на ответе — теперь очистка */
      await page.evaluate(() => wipe('data')); await page.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith('lun_draft_')));
      release(); await page.waitForTimeout(400); await page.unroute('**/api' + path);
      /* HB и AS объявлены через let — не свойства window, читаются по имени */
      assert.equal(await page.evaluate((st) => { const v = (0, eval)(st); return v === null || (Array.isArray(v) ? v.length === 0 : (v.active || []).length === 0); }, state), true, `${state} stays empty after the delayed response (F05)`);
      assert.ok(!(await page.locator(`#${widget === 'habits' ? 'hb-box' : 'as-box'}`).innerText()).includes(title), 'the deleted item is not on the screen');
      await page.evaluate((w) => (w === 'habits' ? loadHabits() : loadAskesis()), widget);
      await page.waitForFunction((st) => (0, eval)(st) !== null, state);
      assert.equal(await page.evaluate((st) => { const v = (0, eval)(st); return Array.isArray(v) ? v.length : v.active.length; }, state), 0, 'a fresh load after clearing is empty');
    }
    /* F05: сохранение итога недели захватывает неделю до await — быстрый переход на прошлую неделю до ответа не меняет ее текст и не стирает ее черновик */
    await page.evaluate(() => { closeWidget(); go('history'); openWidget('week'); }); await page.waitForSelector('#wk-reflect');
    const cur = await page.evaluate(() => WK.data.week.start), prevStart = await page.evaluate(() => WK.data.week.previous);
    await page.evaluate((p) => draftSet('week', p, 'Черновик прошлой недели'), prevStart);
    let releaseW; const heldW = new Promise((r) => { releaseW = r; });
    await page.route('**/api/week/reflect', async (route) => { await heldW; try { await route.continue(); } catch {} });
    await page.fill('#wk-reflect', 'Итог текущей недели'); await page.click('#wk-reflect-save');
    await page.evaluate(() => weekShift(-1)); await page.waitForFunction((p) => WK.data && WK.data.week.start === p, prevStart);
    assert.equal(await page.inputValue('#wk-reflect'), 'Черновик прошлой недели', 'the previous week opens with its own draft');
    releaseW(); await page.waitForFunction(() => !saveWeekReflection.busy); await page.unroute('**/api/week/reflect');
    assert.equal(await page.evaluate(() => WK.data.reflection.text), '', 'the current week text did not land in the previous week (F05)');
    assert.equal(await page.evaluate((p) => draftGet('week', p), prevStart), 'Черновик прошлой недели', 'the previous week draft is intact');
    assert.equal(await page.inputValue('#wk-reflect'), 'Черновик прошлой недели');
    assert.equal((await owner.json('/week?week=' + cur)).reflection.text, 'Итог текущей недели', 'the save itself reached the right week');
    assert.equal(await page.evaluate((c) => draftGet('week', c), cur), null, 'the saved week draft is cleared');
    /* Панель «Настроение» отмечает несколько (21.09): два быстрых настроения подряд — оба подсвечены и оба в карточке дня; повторное нажатие снимает одно */
    await page.evaluate(() => { closeWidget(); go('history'); openWidget('mood'); }); await page.waitForSelector('#t-moods .quick-mood');
    await page.evaluate(() => fetch('/app/api/day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moods: [] }) }).then(() => { S.moods = []; S.mood = null; renderMoods(); }));
    await page.locator('#t-moods .quick-mood[data-a0="quick:calm"]').click(); await page.waitForFunction(() => S.moods.length === 1);
    await page.locator('#t-moods .quick-mood[data-a0="quick:tired"]').click(); await page.waitForFunction(() => S.moods.length === 2);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#t-moods .quick-mood.on')].map((b) => b.dataset.a0)), ['quick:calm', 'quick:tired'], 'both quick moods stay highlighted');
    assert.ok((await page.locator('#t-moods .saved-state').innerText()).includes('Спокойно, Устала'), 'the saved line lists every mark');
    assert.deepEqual((await owner.json('/day')).moods, ['quick:calm', 'quick:tired'], 'the day card carries both marks');
    await page.locator('#t-moods .quick-mood[data-a0="quick:calm"]').click(); await page.waitForFunction(() => S.moods.length === 1);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#t-moods .quick-mood.on')].map((b) => b.dataset.a0)), ['quick:tired'], 'tapping a highlighted mood removes only it');
    assert.deepEqual((await owner.json('/day')).moods, ['quick:tired']);
    await page.evaluate(() => closeWidget());
    assert.deepEqual(errors, [], 'no page errors during the regressions');
    console.log('PASS: browser regressions — cross-screen gratitude edit, deleted answer, lost response + edit, cancelled card pick, drafts after history clearing, delayed loads after clearing, week switch during a save (F05), several moods in the panel.');
  } finally { await ctx.close(); }
  await checkOnboardingWithMail({ browser, base, codeFor });
}

/* Анкета, когда письма настроены (как в проде: mailReady=true) и почта уже привязана до анкеты — через «Войти» на приветствии
   или «Уже пользовались?» на самой анкете (21.09: «Проверьте адрес почты» под «Открыть мой день» без поля почты — анкету было не отправить).
   Проверки идут без SMTP, поэтому mailReady в /api/me подменяется, а /api/auth/request — ответом «ушло»; код кладется в базу (codeFor),
   /api/auth/verify и /api/profile — настоящие. Заодно: адрес, набранный в поле до входа по другой почте, не уходит на сервер */
async function checkOnboardingWithMail({ browser, base, codeFor }) {
  if (!codeFor) return;
  const mailLive = async (page) => {
    await page.route('**/api/me', async (route) => { const r = await route.fetch(); const body = await r.json(); await route.fulfill({ response: r, json: { ...body, mailReady: true } }); });
    await page.route('**/api/auth/request', (route) => route.fulfill({ json: { ok: true } }));
  };
  const fillSteps = async (page, name) => {
    await page.locator('#o-name').fill(name); await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
    await page.locator('#o-birth').fill('1991-03-03'); await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
    await page.locator('[data-on="click:obSkipTime"]').click();
    await page.locator('#o-city').fill('Москва'); await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
  };
  /* 1. Приветствие → «Войти» → новая почта → код → «Заполнить профиль» → шаги → «Открыть мой день» — сразу «Сегодня» */
  const login = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await login.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
    await mailLive(page);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-hello.on');
    await page.locator('#hello-login').click(); await page.waitForSelector('#v-login.on #auth-email');
    const mail = 'onboard-login@example.test'; codeFor(mail);
    await page.fill('#auth-email', mail); await page.click('#l-box [data-on="click:authSend"]'); await page.waitForSelector('#auth-code');
    await page.fill('#auth-code', '123456'); await page.click('#l-box [data-on="click:authCheck"]');
    await page.waitForFunction(() => document.getElementById('l-after').style.display !== 'none');
    assert.equal(await page.evaluate(() => S.user.email), mail, 'the new address is attached to the device account before the questionnaire');
    await page.locator('#l-after [data-on="click:openForm"]').click(); await page.waitForSelector('#v-onb.on');
    await fillSteps(page, 'Вошла до анкеты');
    assert.equal(await page.locator('#o-mailfield').evaluate((e) => e.style.display), 'none', 'the email field is hidden — the address is already attached');
    assert.equal(await page.locator('#ob-done-q').innerText(), 'Почти готово');
    await page.locator('#o-consent').check(); await page.locator('#o-go').click();
    await page.waitForFunction(() => document.querySelector('#v-home.on') || document.getElementById('o-msg').innerText.trim());
    assert.equal(await page.locator('#o-msg').innerText(), '', 'the form must submit — no «Проверьте адрес почты» for a hidden field');
    await page.waitForSelector('#v-home.on');
    assert.deepEqual(await page.evaluate(() => [S.user.onboarded, S.user.email, S.user.name]), [true, mail, 'Вошла до анкеты'], 'the profile is saved and the address kept');
    assert.deepEqual(errors, [], 'no page errors on the onboarding with an attached address');
  } finally { await login.close(); }
  /* 2. На самой анкете: адрес набран в поле, затем «Уже пользовались?» с другой почтой — поле прячется, заголовок меняется, анкета уходит,
        на сервер не идет ни код на набранный адрес, ни его привязка */
  const inline = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await inline.newPage(), errors = [], sent = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
    await mailLive(page); page.on('request', (r) => { if (r.url().endsWith('/api/auth/request')) sent.push(r.postDataJSON().email); });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-hello.on');
    await page.getByRole('button', { name: /Открыть мой день/ }).click(); await page.waitForSelector('#v-onb.on');
    await fillSteps(page, 'Вошла на анкете');
    assert.equal(await page.locator('#ob-done-q').innerText(), 'Куда прислать код?', 'mail is live and no address yet — the last step asks for one');
    await page.fill('#o-email', 'typed-then-abandoned@example.test');
    await page.click('#o-auth [data-on="click:auth-step-email-paintAuth"]'); await page.waitForSelector('#o-auth #auth-email');
    const mail = 'onboard-inline@example.test'; codeFor(mail);
    await page.fill('#o-auth #auth-email', mail); await page.click('#o-auth [data-on="click:authSend"]'); await page.waitForSelector('#o-auth #auth-code');
    await page.fill('#o-auth #auth-code', '123456'); await page.click('#o-auth [data-on="click:authCheck"]');
    await page.waitForFunction((m) => S.user && S.user.email === m, mail);
    await page.waitForFunction(() => document.getElementById('ob-done-q').innerText === 'Почти готово');
    assert.equal(await page.locator('#o-mailfield').evaluate((e) => e.style.display), 'none', 'after signing in on the form the email field is hidden');
    await page.locator('#o-consent').check(); await page.locator('#o-go').click();
    await page.waitForFunction(() => document.querySelector('#v-home.on') || document.getElementById('o-msg').innerText.trim());
    assert.equal(await page.locator('#o-msg').innerText(), '', 'the form must submit after signing in on it');
    await page.waitForSelector('#v-home.on');
    assert.deepEqual(sent, [mail], 'the abandoned address in the hidden field never gets a code');
    assert.deepEqual(await page.evaluate(() => [S.user.onboarded, S.user.email]), [true, mail]);
    assert.deepEqual(errors, [], 'no page errors on the inline sign-in path');
  } finally { await inline.close(); }
  console.log('PASS: questionnaire with mail live — address attached before the form (hello → Войти) and on the form (Уже пользовались?) submits without «Проверьте адрес почты»; a typed-then-abandoned address gets no code.');
}
