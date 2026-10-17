/* Обязательные регрессии в браузере (повторный аудит v112, R15): последствия, которые штатные проверки маршрутов не ловят —
   правка между экранами, потерянный ответ и уточнение текста, удаление и повторное открытие, отмена выбора карт, очистка с черновиком.
   Настоящий бэкенд и изолированная база check-personal-features; запускается из него: --ui-regression (и в составе --ui).
   Экраны здесь дергаются теми же функциями, что и кнопки (go, openWidget, saveDayCard…) — проверяется путь данных, а не пиксели. */
import assert from 'node:assert/strict';
export async function checkRegressions({ browser, base, owner, codeFor }) {
  // A stalled connection must never leave only the phone background.
  const startupCtx = await browser.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
  try {
    const startup = await startupCtx.newPage();
    await startup.route('**/api/me', () => {});
    await startup.goto(base + '/', {waitUntil: 'domcontentloaded'});
    await startup.locator('#v-hello.on').waitFor({state: 'visible', timeout: 2000});
    assert.equal(await startup.locator('[data-startup-required]').evaluateAll(nodes=>nodes.every(n=>n.disabled)), true);
    await startup.getByText('Не удалось подключиться к Лунарио.', {exact: false}).waitFor({timeout: 11000});
    assert.equal(await startup.getByRole('link', {name: 'Повторить загрузку'}).isVisible(), true);
    await startup.unroute('**/api/me');
    await startup.getByRole('link', {name: 'Повторить загрузку'}).click();
    await startup.waitForFunction(() => !document.querySelector('[data-startup-required]').disabled);
    assert.equal(await startup.locator('#startup-note').isVisible(), false);
    assert.equal(await startup.getByRole('button', {name: 'Войти по почте'}).isEnabled(), true);
    const welcomeLayout = await startup.evaluate(() => {
      const blocks = ['.hello-header', '.hello-about', '.hello-oracle', '.hello-footer'].map(selector => document.querySelector(selector).getBoundingClientRect());
      const gaps = blocks.slice(1).map((box, index) => Math.round(box.top - blocks[index].bottom));
      return {
        fits: document.documentElement.scrollHeight <= innerHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        headerPosition: getComputedStyle(document.querySelector('.hello-header')).position,
        ordered: blocks.every((box, index) => !index || box.top >= blocks[index - 1].bottom),
        gapSpread: Math.max(...gaps) - Math.min(...gaps),
        trustBottom: Math.round(innerHeight - blocks.at(-1).bottom),
      };
    });
    assert.deepEqual({fits: welcomeLayout.fits, horizontalOverflow: welcomeLayout.horizontalOverflow, headerPosition: welcomeLayout.headerPosition, ordered: welcomeLayout.ordered}, {fits: true, horizontalOverflow: false, headerPosition: 'relative', ordered: true});
    assert.ok(welcomeLayout.gapSpread <= 3, 'welcome blocks are distributed evenly');
    assert.ok(welcomeLayout.trustBottom <= 30, 'privacy note stays at the bottom of the screen');
    // The desktop phone has its own height: distributing against the window left a large empty bottom.
    await startup.setViewportSize({width: 1000, height: 1000});
    await startup.waitForFunction(() => document.documentElement.classList.contains('framed'));
    const framedWelcome = await startup.evaluate(() => {
      const wrap = document.querySelector('.wrap'), trust = document.querySelector('#v-hello .trust').getBoundingClientRect();
      return {bottomGap: document.body.getBoundingClientRect().bottom - trust.bottom,
        overflow: wrap.scrollHeight > wrap.clientHeight + 1};
    });
    assert.ok(framedWelcome.bottomGap >= 40 && framedWelcome.bottomGap <= 48, 'privacy note follows the phone bottom, not content height');
    assert.equal(framedWelcome.overflow, false, 'welcome fits inside the tall phone frame');
    await startup.setViewportSize({width: 320, height: 568});
    await startup.waitForFunction(() => !document.documentElement.classList.contains('framed'));
    assert.equal(await startup.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'small phones have no sideways overflow');
    await startup.getByRole('link', {name: 'Что внутри'}).scrollIntoViewIfNeeded();
    assert.equal(await startup.getByRole('link', {name: 'Что внутри'}).isVisible(), true);
    await startup.setViewportSize({width: 390, height: 844});
    await startup.locator('#hello-start').click();
    await startup.locator('#v-onb.on #o-name').waitFor();
    await startup.locator('#v-onb [data-on="click:go-hello"]').click();
    await startup.locator('#hello-login').click();
    /* «Войти» видна всегда (2291021), а почта в проверках не настроена (mailReady=false): экран входа не дает форму, которая
       ответила бы «Отправка почты еще не настроена.», а честно говорит, что вход сейчас не работает; «Начать знакомство» рядом */
    await startup.locator('#v-login.on #l-box .auth-off-title, #v-login.on #l-box #auth-email').first().waitFor();
    if (!(await startup.evaluate(() => S.mailReady))) {
      assert.equal(await startup.locator('#l-box .auth-off-title').innerText(), 'Вход по почте временно не работает', 'mail is off — the login screen says so instead of offering the form');
      assert.equal(await startup.locator('#l-box #auth-email').count(), 0, 'no email field while mail is off');
    }
    assert.equal(await startup.locator('#v-login.on .login-new button').isVisible(), true, '«Начать знакомство» stays on the login screen');
    await startup.locator('#v-login.on .login-new button').click();
    await startup.locator('#v-onb.on #o-name').waitFor();
    await startup.locator('#v-onb [data-on="click:go-hello"]').click();
    const [cookieName, cookieValue] = owner.cookie.split('=');
    await startupCtx.addCookies([{name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/app'}]);
    await startup.reload({waitUntil: 'domcontentloaded'});
    await startup.locator('#v-home.on').waitFor();
    await startup.route('**/api/me', () => {});
    await startup.reload({waitUntil: 'domcontentloaded'});
    await startup.locator('#v-home.on').waitFor({timeout: 11000});
    assert.equal(await startup.locator('#offline-note').isVisible(), true, 'saved profile is restored after the network deadline');
  } finally { await startupCtx.close(); }
  const noScripts = await browser.newContext({javaScriptEnabled: false, serviceWorkers: 'block'});
  try {
    const staticPage = await noScripts.newPage();
    await staticPage.goto(base + '/');
    assert.equal(await staticPage.locator('#v-hello').isVisible(), true, 'welcome is rendered even without application scripts');
    assert.equal(await staticPage.getByRole('link', {name: 'Что внутри'}).isVisible(), true);
    assert.equal(await staticPage.getByRole('button', {name: 'Открыть мой день'}).count(), 0);
    assert.equal(await staticPage.getByRole('button', {name: 'Войти по почте'}).isVisible(), true);
    assert.equal(await staticPage.locator('.hello-claim').textContent(), 'Пространство, где можно услышать себя');
    assert.equal(await staticPage.locator('.hello-description').textContent(), 'Помнит контекст и помогает найти ресурс');
    assert.deepEqual(await staticPage.locator('.hello-paths li').allTextContents(), [
      'Свериться с собойнайти свое решение',
      'Совместимостьпрояснить суть отношений',
      'Обо мнеключ к талантам',
      'Каждое утроподсказка на день',
    ]);
    assert.deepEqual(await staticPage.locator('.hello-paths strong').allTextContents(), ['Свериться с собой', 'Совместимость', 'Обо мне']);
    assert.equal(await staticPage.locator('.hello-future p').textContent(), 'Лунарио личный компаньон, который понимает с полуслова и всегда на вашей стороне');
    assert.equal(await staticPage.getByRole('link', {name: 'Повторить загрузку'}).isVisible(), true);
  } finally { await noScripts.close(); }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const [name, value] = owner.cookie.split('='); await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/app', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const pr = (await owner.json('/preferences')).preferences; await owner.json('/preferences', 'POST', { tools: [...new Set([...(pr.tools || []), 'gratitude', 'journal'])] });
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-home.on');
    const today = await page.evaluate(() => S.day.date);
    // A free note needs no enabled tools; the draft and the saved note remain reachable through search.
    await owner.json('/preferences','POST',{tools:[]});await page.reload();
    await page.locator('[data-nav="history"]').click();
    await page.getByRole('button',{name:'Записать мысль',exact:true}).click();
    await page.locator('#dc-text').fill('Проверка дневника: прогулка вернула спокойствие');
    await page.reload();await page.locator('[data-nav="history"]').click();
    await page.locator('#dc-text').waitFor();
    assert.equal(await page.locator('#dc-text').inputValue(),'Проверка дневника: прогулка вернула спокойствие');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#day-card.done').waitFor();
    assert.ok((await page.locator('#day-card').innerText()).includes('прогулка вернула спокойствие'));
    assert.deepEqual((await owner.json('/preferences')).preferences.tools,[],'free writing does not change evening preferences');
    await page.getByRole('button',{name:'Найти запись',exact:true}).click();
    await page.locator('#days-query').fill('прогулка вернула');await page.getByRole('button',{name:'Найти',exact:true}).click();
    await page.locator('#days-all-list .day-row').waitFor();
    assert.equal(await page.locator('#days-all-list .day-row').count(),1);
    await page.locator('#days-all-list .day-row').click();await page.locator('#v-history.on').waitFor();
    assert.equal(await page.locator('#day-card.done').isVisible(),true);
    await owner.json('/preferences','POST',{tools:[...new Set([...(pr.tools||[]),'gratitude','journal'])]});
    await page.reload();await page.locator('#v-home.on').waitFor();
    const natal = await owner.json('/natal');
    await page.locator('[data-nav="about"]').click();
    assert.equal(await page.locator('#me-card').isVisible(), false, 'old profile introduction stays hidden');
    await page.getByRole('button', {name: 'Натальная карта', exact: true}).click();
    await page.locator('.natal-chart').waitFor();
    assert.equal(await page.locator('.natal-chart-body').isVisible(), false, 'raw chart is collapsed initially');
    const meaningTitles = {'Солнце':'Ваш источник жизненных сил','Луна':'ваш способ восстанавливаться и реагировать','Меркурий':'ваш способ мышления и стиль общения','Венера':'ваше понятия о красоте и то, как вы выбираете партнеров','Марс':'ваш способ действовать и отстаивать границы','Юпитер':'ваш ориентир для развития, амбиций и зона везения','Сатурн':'ваше отношение к ответственности, правилам и долгосрочным целям.','Уран':'как вы понимаете свободу и к каким озарениям способны','Нептун':'ваш источник интуиции, воображения и идеалов','Хирон':'ваша уязвимая зона опыта, где преодоление слабостей рождает способность помогать другим'};
    const expected = natal.meanings.planets.filter(p => p.inSign && meaningTitles[p.name]);
    assert.deepEqual(await page.locator('.natal-description > summary').allTextContents(), expected.map(p => meaningTitles[p.name]));
    assert.equal(await page.locator('.natal-description[open]').count(), 0, 'planet descriptions are collapsed initially');
    for (let i = 0; i < expected.length; i++) {
      const item = page.locator('.natal-description').nth(i);
      assert.equal(await item.locator('.natal-description-body').isVisible(), false);
      await item.locator('summary').click();
      assert.equal(await item.locator('h3').innerText(), expected[i].inSign.title, 'placement is shown inside the expanded description');
      const text = await item.innerText();
      for (const paragraph of expected[i].inSign.text.split(/\n\s*\n/)) assert.ok(text.includes(paragraph));
      await item.locator('summary').click();
    }
    assert.equal(await page.locator('.natal-summary').count(), 0);
    await page.locator('.natal-chart > summary').click();
    assert.equal(await page.locator('.natal-chart-body').isVisible(), true, 'chart expands on click');
    await page.locator('.natal-chart > summary').click();
    assert.equal(await page.locator('.natal-chart-body').isVisible(), false, 'chart collapses on click');
    await page.locator('.wg-x').click();

    const numerology = await owner.json('/numerology');
    await page.getByRole('button', {name: 'Личный год', exact: true}).click();
    await page.locator('#w-year-box .yr-img').waitFor();
    assert.equal(await page.locator('#m-yearsub').innerText(), '', 'old planet and energy subtitle is removed from the personal-year tile');
    assert.equal(await page.locator('#w-year-box .num-mark').count(), 0, 'old year-number badge is removed');
    const yearText = await page.locator('#w-year-box').innerText();
    assert.ok(!yearText.includes(`Год ${numerology.year.n} ·`), 'old year, planet and energy heading is removed');
    if (numerology.year.info?.message) assert.ok(yearText.includes(numerology.year.info.message), 'the personal message remains');
    await page.locator('.wg-x').click();

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
  await checkMailStates({ browser, base, owner });
}

/* Вход по почте при разных состояниях почты (16.10: на проде «Прислать код» отвечал красным «Отправка почты еще не настроена.»
   без объяснения и выхода). Экран входа сам спрашивает GET /api/mail-status, при выключенной почте — честный блок без поля почты,
   «Проверить еще раз», краткий и долгий сбой, двойное нажатие, письмо с задержкой, «Прислать еще раз» через минуту, возвращение
   на вкладку, анкета, удаление аккаунта и кабинет. Новые ответы сервера (mail-status, mail_down, uncertain, busy) подменяются
   page.route — проверяется договор с сервером, а не его реализация; минуты ожидания проматываются page.clock */
async function checkMailStates({ browser, base, owner }) {
  const OFF_TITLE = 'Вход по почте временно не работает', OFF_TEXT = 'Ваш профиль и записи сохранены — это сбой на нашей стороне. Загляните чуть позже.';
  const msgIs = (page, text) => page.waitForFunction((t) => document.getElementById('auth-msg')?.innerText === t, text);
  const login = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await login.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install();
    let status = { mailReady: false, mail: 'down', retryAfter: 120 }, statusHits = 0, reply = () => ({ json: { ok: true } });
    const sends = [];
    await page.route('**/api/me', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...(await r.json()), mailReady: false, mail: 'down' } }); });
    await page.route('**/api/mail-status', (route) => { statusHits++; return route.fulfill({ json: status, headers: { 'Cache-Control': 'no-store' } }); });
    await page.route('**/api/auth/request', async (route) => { sends.push(route.request().postDataJSON().email); return route.fulfill(await reply()); });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-hello.on');
    await page.waitForFunction(() => !document.getElementById('hello-login').disabled);
    /* анкета: «Уже пользовались?» не исчезает молча, а говорит, что вход сейчас не работает; последний шаг — без поля почты */
    await page.locator('#hello-start').click(); await page.waitForSelector('#v-onb.on');
    assert.equal(await page.locator('#o-back').isVisible(), true, 'the returning-user block stays on the questionnaire while mail is off');
    assert.equal(await page.locator('#o-back .auth-off-note').innerText(), 'Уже пользовались Лунарио? Вход по почте сейчас не работает — ваш профиль и записи сохранены, загляните чуть позже.');
    assert.equal(await page.locator('#o-back').getByRole('button', { name: 'Войти по почте' }).count(), 0, 'no sign-in button that cannot work');
    await page.locator('#v-onb [data-on="click:go-hello"]').click(); await page.waitForSelector('#v-hello.on');
    /* (1) «Войти» на приветствии видна → экран входа спросил сервер → честный блок, поля почты нет, «Начать знакомство» на месте */
    assert.equal(await page.locator('#hello-login').isVisible(), true, '«Войти» on the welcome screen is never hidden');
    statusHits = 0;   /* анкета выше тоже сверялась с сервером (почта считалась выключенной) — считаем только экран входа */
    await page.locator('#hello-login').click();
    await page.locator('#l-box .auth-off-title').waitFor();
    assert.equal(await page.locator('#l-box .auth-off-title').innerText(), OFF_TITLE);
    assert.equal(await page.locator('#l-box .auth-off-text').innerText(), OFF_TEXT);
    assert.equal(await page.locator('#auth-email').count(), 0, 'no email field while mail is off');
    assert.equal(await page.locator('#v-login .login-intro').isVisible(), false, '«Укажите прежнюю почту» is not shown without the field');
    assert.equal(await page.locator('#v-login .login-new button').innerText(), 'Начать знакомство');
    assert.equal(await page.locator('#v-login .login-new button').isVisible(), true);
    assert.equal(statusHits, 1, 'the login screen asked the server about mail once');
    await page.getByRole('button', { name: 'Проверить еще раз' }).click(); await msgIs(page, 'Пока не работает. Попробуйте позже.');
    assert.equal(statusHits, 2); assert.equal(await page.locator('#auth-email').count(), 0);
    /* (2) почту починили — «Проверить еще раз» рисует форму */
    status = { mailReady: true, mail: 'ok', retryAfter: null };
    await page.getByRole('button', { name: 'Проверить еще раз' }).click(); await page.locator('#l-box #auth-email').waitFor();
    assert.equal(await page.evaluate(() => S.mailReady), true);
    assert.equal(await page.locator('#v-login .login-intro').isVisible(), true, 'the intro comes back with the form');
    /* (3) короткий сбой: форма с адресом остается, «через 2 мин.» из retryAfter 90, кнопка снова работает */
    const mail = 'mail-states@example.test';
    reply = () => ({ status: 503, json: { ok: false, error: 'mail_down', mailReady: true, retryAfter: 90 } });
    await page.fill('#auth-email', mail); await page.click('#l-box .auth-submit');
    await msgIs(page, 'Почта сейчас не отвечает. Попробуйте еще раз через 2 мин.');
    assert.equal(await page.inputValue('#auth-email'), mail, 'the address stays in the field');
    assert.equal(await page.locator('#l-box .auth-submit').isEnabled(), true, 'the button works again after a refusal');
    assert.equal(await page.locator('#l-box .auth-submit').getAttribute('aria-busy'), null);
    assert.equal(await page.evaluate(() => S.mailReady), true, 'a short outage keeps the form');
    /* (4) mail_off — честный блок, S.mailReady=false; долгий mail_down (mailReady:false) — так же */
    for (const body of [{ ok: false, error: 'mail_off', mailReady: false }, { ok: false, error: 'mail_down', mailReady: false, retryAfter: 600 }]) {
      reply = () => ({ status: 503, json: body });
      await page.click('#l-box .auth-submit'); await page.locator('#l-box .auth-off-title').waitFor();
      assert.equal(await page.evaluate(() => S.mailReady), false, body.error + ' turns the login screen off');
      assert.equal(await page.locator('#auth-email').count(), 0);
      if (body.error === 'mail_off') {
        /* (E) возвращение на вкладку: не чаще раза в 5 минут — сразу запроса нет, через 5 минут почта снова работает и форма вернулась */
        status = { mailReady: true, mail: 'ok', retryAfter: null }; const hits = statusHits;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(200);
        assert.equal(statusHits, hits, 'no mail-status request right after an answer about mail');
        await page.clock.fastForward(5 * 60e3 + 1000);
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.locator('#l-box #auth-email').waitFor();
        assert.equal(statusHits, hits + 1);
      } else {
        await page.getByRole('button', { name: 'Проверить еще раз' }).click(); await page.locator('#l-box #auth-email').waitFor();
      }
      assert.equal(await page.inputValue('#auth-email'), mail, 'the typed address comes back with the form');
    }
    /* (5) двойное нажатие «Прислать код» — ровно один запрос; кнопка занята; 8 с без ответа — «Письмо идет дольше обычного…» */
    let release; const held = new Promise((r) => { release = r; });
    reply = async () => { await held; return { json: { ok: true } }; };
    sends.length = 0;
    await page.locator('#l-box .auth-submit').dblclick();
    await page.waitForFunction(() => document.querySelector('#l-box .auth-submit')?.getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#l-box .auth-submit').isDisabled(), true, 'the button is disabled while the request is on its way');
    await page.evaluate(() => { authSend(); });   /* и повторный вызов в обход кнопки ничего не шлет (промис не ждем: без защиты он висел бы на том же ответе) */
    await page.waitForTimeout(200);
    await page.clock.fastForward(8500); await msgIs(page, 'Письмо идет дольше обычного…');
    release(); await page.locator('#l-box #auth-code').waitFor();
    assert.equal(sends.length, 1, 'a double tap sends exactly one code');
    /* (7) шаг кода: «Спам», «Прислать еще раз» — не сразу, а через 60 с; тот же адрес */
    assert.equal(await page.locator('#l-box .auth-note').first().innerText(), 'Не пришло? Проверьте папку «Спам».');
    assert.equal(await page.locator('#auth-resend').isDisabled(), true, 'resend is not available right away');
    assert.match(await page.locator('#auth-resend').innerText(), /^Прислать еще раз через (60|59) с$/);
    await page.clock.fastForward(30000);
    assert.equal(await page.locator('#auth-resend').isDisabled(), true, 'resend is still waiting at 30 s');
    await page.clock.fastForward(31000); await page.waitForFunction(() => !document.getElementById('auth-resend').disabled);
    assert.equal(await page.locator('#auth-resend').innerText(), 'Прислать еще раз');
    reply = () => ({ json: { ok: true } });
    await page.locator('#auth-resend').click(); await msgIs(page, 'Отправили новый код — введите его из последнего письма.');
    assert.deepEqual(sends, [mail, mail], 'resend goes to the same address');
    assert.equal(await page.locator('#auth-resend').isDisabled(), true, 'the countdown starts again');
    assert.equal(await page.getByRole('button', { name: 'Изменить адрес' }).isVisible(), true);
    /* (6) письмо ушло, но ответ почты оборвался (uncertain): шаг кода и мягкая строка про задержку */
    await page.getByRole('button', { name: 'Изменить адрес' }).click(); await page.locator('#l-box #auth-email').waitFor();
    reply = () => ({ json: { ok: true, uncertain: true } });
    await page.click('#l-box .auth-submit'); await page.locator('#l-box #auth-code').waitFor();
    assert.equal(await page.locator('#l-box .auth-late').innerText(), 'Письмо могло задержаться. Если его нет через пару минут, запросите код еще раз.');
    /* общий словарь: остальные отказы — своими словами, кнопка возвращается */
    await page.getByRole('button', { name: 'Изменить адрес' }).click(); await page.locator('#l-box #auth-email').waitFor();
    for (const [r, text] of [
      [{ status: 502, json: { ok: false, error: 'send_failed', mailReady: true } }, 'Письмо не ушло из-за сбоя на нашей стороне. Попробуйте через несколько минут.'],
      [{ status: 502, json: { ok: false, error: 'bad_recipient' } }, 'Почтовый ящик не принял письмо. Проверьте, нет ли опечатки в адресе.'],
      [{ status: 429, json: { ok: false, error: 'too_often' } }, 'Код уже отправляли несколько раз. Проверьте папку «Спам» или попробуйте через 10 минут.'],
      [{ status: 429, json: { ok: false, error: 'busy' } }, 'Сейчас много запросов. Попробуйте через 10 минут.'],
      [{ status: 504, contentType: 'text/html', body: '<html>Gateway Timeout</html>' }, 'Лунарио обновляется. Подождите минуту и нажмите еще раз.'],
    ]) {
      reply = () => r; await page.click('#l-box .auth-submit'); await msgIs(page, text);
      assert.equal(await page.locator('#l-box .auth-submit').isEnabled(), true);
    }
    await page.unroute('**/api/auth/request'); await page.route('**/api/auth/request', (route) => route.abort('internetdisconnected'));
    await page.click('#l-box .auth-submit'); await msgIs(page, 'Нет связи с Лунарио. Проверьте интернет и нажмите еще раз.');
    assert.deepEqual(errors, [], 'no page errors on the mail states');
  } finally { await login.close(); }

  /* (8) удаление аккаунта с почтой, а письма не уходят: не тост на 2,6 с, а строка в «Аккаунте» до следующей попытки;
     DELETE /api/account не уходит вовсе */
  const DEL_TEXT = 'Подтвердить удаление кодом сейчас не получится: письма временно не уходят. Все записи можно стереть уже сейчас кнопкой «Очистить историю». Удалить аккаунт можно будет, когда письма снова пойдут: нажмите «Удалить аккаунт» еще раз позже.';
  const acc = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const [name, value] = owner.cookie.split('='); await acc.addCookies([{ name, value, domain: '127.0.0.1', path: '/app', httpOnly: true, sameSite: 'Lax' }]);
    const page = await acc.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    let deletes = 0, code = null;
    await page.route('**/api/account', (route) => { deletes++; return route.fulfill({ status: 500, json: { ok: false } }); });   /* страховка: аккаунт проверки не удаляется ни при каком исходе */
    await page.route('**/api/account/delete-code', (route) => route.fulfill(code));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#v-home.on');
    await page.evaluate(() => { S.user.email = 'delete-check@example.test'; go('account'); }); await page.waitForSelector('#v-account.on');
    for (const r of [{ status: 503, json: { ok: false, error: 'mail_off', mailReady: false } }, { status: 503, json: { ok: false, error: 'mail_down', mailReady: true, retryAfter: 60 } }, { status: 502, json: { ok: false, error: 'send_failed', mailReady: true } }]) {
      code = r; await page.evaluate(() => delNote(''));
      await page.locator('#v-account [data-on="click:wipe-account"]').click();
      /* сначала строка «Отправляем код…», затем итог — ждем итог */
      await page.waitForFunction((t) => document.querySelector('#ac-del-note')?.innerText === t, DEL_TEXT).catch(() => {});
      assert.equal(await page.locator('#ac-del-note').innerText(), DEL_TEXT, r.json.error + ' explains what can be done now');
      if (r.json.error === 'mail_off') { await page.waitForTimeout(3000); assert.equal(await page.locator('#ac-del-note').isVisible(), true, 'the note stays, unlike a 2.6 s toast'); }
    }
    assert.equal(await page.locator('#v-account [data-on="click:wipe-data"]').isVisible(), true, '«Очистить историю» is right there');
    assert.equal(deletes, 0, 'nothing is deleted without a code');
    assert.deepEqual(errors, []);
  } finally { await acc.close(); }

  /* (9) кабинет: /api/cabinet/me mailReady:false — строка о неработающем входе, форма все равно видна; тексты — общие с приложением */
  const cab = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await cab.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', (e) => errors.push(e.message));
    let reply = null; const sends = [];
    await page.route('**/api/cabinet/me', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...(await r.json()), mailReady: false } }); });
    await page.route('**/api/auth/request', (route) => { sends.push(1); return route.fulfill(reply); });
    await page.goto(base + '/cabinet', { waitUntil: 'domcontentloaded' }); await page.locator('#v-login.on #l-email').waitFor();
    assert.equal(await page.locator('#l-mail-off').innerText(), 'Вход по почте сейчас не работает. Если вы уже входили на этом устройстве — обновите страницу; иначе попробуйте позже.');
    await page.fill('#l-email', 'staff-check@example.test');
    for (const [r, text] of [
      [{ status: 503, json: { ok: false, error: 'mail_down', mailReady: true, retryAfter: 90 } }, 'Почта сейчас не отвечает. Попробуйте еще раз через 2 мин.'],
      [{ status: 503, json: { ok: false, error: 'mail_off', mailReady: false } }, 'Вход по почте сейчас не работает. Это сбой на нашей стороне, ваш профиль и записи сохранены. Загляните чуть позже.'],
      [{ status: 502, json: { ok: false, error: 'send_failed', mailReady: true } }, 'Письмо не ушло из-за сбоя на нашей стороне. Попробуйте через несколько минут.'],
      [{ status: 502, json: { ok: false, error: 'bad_recipient' } }, 'Почтовый ящик не принял письмо. Проверьте, нет ли опечатки в адресе.'],
      [{ status: 429, json: { ok: false, error: 'busy' } }, 'Сейчас много запросов. Попробуйте через 10 минут.'],
    ]) {
      reply = r; await page.getByRole('button', { name: 'Прислать код' }).click();
      await page.waitForFunction((t) => document.getElementById('l-msg')?.innerText === t, text);
      assert.equal(await page.getByRole('button', { name: 'Прислать код' }).isEnabled(), true);
    }
    reply = { json: { ok: true } }; sends.length = 0;
    await page.getByRole('button', { name: 'Прислать код' }).dblclick(); await page.locator('#l-code').waitFor();
    assert.equal(sends.length, 1, 'a double tap in the cabinet sends one code');
    assert.deepEqual(errors, []);
  } finally { await cab.close(); }
  console.log('PASS: mail states — login screen asks /api/mail-status and shows an honest block instead of the form, «Проверить еще раз», short (mail_down 2 мин.) and long outages, one request per double tap, slow-letter line, delayed letter (uncertain), resend after 60 s, tab return at most every 5 min, questionnaire note, account deletion note instead of a toast, cabinet line and shared texts.');
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
  // A first-time visitor starts from the visible CTA, completes the profile and verifies a new address.
  const fresh = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    const page=await fresh.newPage();page.setDefaultTimeout(15000);await mailLive(page);
    await page.goto(base+'/');await page.locator('#hello-start').click();
    await fillSteps(page,'Первое знакомство');
    const mail='new-welcome@example.test';codeFor(mail);
    await page.locator('#o-email').fill(mail);await page.locator('#o-consent').check();await page.locator('#o-go').click();
    await page.locator('#o-codebox #auth-code').fill('123456');await page.locator('#o-codebox [data-on="click:authCheck"]').click();
    await page.locator('#v-home.on').waitFor();
    assert.deepEqual(await page.evaluate(()=>[S.user.onboarded,S.user.email,S.user.name]),[true,mail,'Первое знакомство']);
    await page.reload();await page.locator('#v-home.on').waitFor();
  } finally {await fresh.close();}
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
    await page.waitForFunction(() => !document.getElementById('hello-login').disabled);
    await page.locator('#hello-dice').click();
    await page.locator('#hello-continue:not([hidden]) button').waitFor();
    await page.locator('#hello-continue button').click(); await page.waitForSelector('#v-onb.on');
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
