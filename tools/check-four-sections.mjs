import assert from 'node:assert/strict';
export async function checkFourSections({browser,base,owner}){
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');await ctx.addCookies([{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,sameSite:'Lax'}]);
  await ctx.addInitScript(()=>{window.__speechQA={starts:0,aborts:0};window.SpeechRecognition=class{constructor(){window.__speechQA.rec=this;}start(){window.__speechQA.starts++;}stop(){this.onend?.();}abort(){window.__speechQA.aborts++;this.onend?.();}};});
  const lunarDays=Array.from({length:30},(_,i)=>({n:i+1,theme:'Тема '+(i+1),symbol:'Символ',image:'/app/icon-192.png',blocks:[{t:'p',text:'Вступление '+(i+1)},{t:'h',text:'Подробности'},{t:'p',text:'Полная глава '+(i+1)}]}));
  await ctx.route('**/api/lunar-days*',route=>route.fulfill({json:{days:lunarDays,reference:null}}));
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  try{
    await page.goto(base+'/');await page.waitForSelector('#v-home.on');
    /* пробелы нормализуем: в подписи вкладки стоит неразрывный пробел, чтобы «с собой» не разрывалось на узком экране —
   для человека это тот же текст, и проверка не должна зависеть от вида пробела */
    assert.deepEqual((await page.locator('.app-nav button').allTextContents()).map(s=>s.replace(/\s+/g,' ').trim()),['Сегодня','Свериться с собой','Дневник','Обо мне']);
    assert.equal(await page.locator('#v-home .sqs,#v-home .mini,#v-today,#v-around').count(),0,'No obsolete menu or orphan category');
    // «Аккаунт» — не вкладка: открывается по кружку с фото на главной, ни одна вкладка не подсвечена, назад — на «Сегодня»
    await page.locator('#h-acct').click();await page.locator('#v-account.on').waitFor();assert.equal(await page.locator('.app-nav [aria-current=page]').count(),0);
    assert.equal(await page.locator('#v-account [data-feature=natal],#v-account [data-feature=year]').count(),0,'Readings live in «Обо мне», not in the account');
    await page.locator('.app-nav [data-nav=home]').click();await page.locator('#v-home.on').waitFor();
    // кружок с фото виден на каждой из четырёх вкладок и с любой из них открывает «Аккаунт»
    for(const view of ['ask','history','about']){await page.locator(`.app-nav [data-nav=${view}]`).click();await page.locator('#v-'+view+'.on').waitFor();assert.ok(await page.locator('.section-acct').isVisible(),view+' shows the account circle');}
    await page.locator('.section-acct').click();await page.locator('#v-account.on').waitFor();assert.ok(await page.locator('.section-acct').isHidden(),'No circle on the account screen itself');await page.locator('.app-nav [data-nav=home]').click();await page.locator('#v-home.on').waitFor();
    const initialDay=(await owner.json('/me')).day;
    await page.locator('#v-home [data-feature=tone]').click();
    assert.equal(await page.locator('#tone-box .practice-question').innerText(),initialDay.question);
    assert.equal(await page.locator('#tone-box > .hint').innerText(),initialDay.set.statement);
    await close();assert.equal(await page.evaluate(()=>document.activeElement.dataset.feature),'tone');assert.equal(await page.locator('#h-set-question').count(),0,'no duplicate question link in the hero');
    const routes={home:['card','dayrune','day','tone','lunar','sky'],ask:['worry','hentries'],history:['journal','mood','gratitude','habits','askesis','wishes','hmood','week'],about:['natal','year','birthnum','compat','tests'],account:['mail','remind','support','edit','invite']};
    for(const [view,keys] of Object.entries(routes))for(const key of keys){
      await page.evaluate(v=>go(v),view);
      const root=page.locator(`#v-${view} [data-feature="${key}"]`);assert.equal(await root.count(),1,key+' canonical entry');
      await root.click();await page.locator(`:is(#wg.on,#v-practice.on) #w-${key}`).waitFor();await close();
    }
    for(const mode of ['yesno','rune','spread']){await page.evaluate(()=>go('ask'));await page.locator(`#v-ask button[data-on="click:openAsk-${mode}"]`).click();await page.locator('#w-ask').waitFor();assert.ok(await page.locator('#a-go').evaluate(el=>!el.classList.contains('ghost')));await close();}
    for(const [alias,target] of [['today','home'],['around','home'],['me','about']]){await page.evaluate(v=>go(v),alias);assert.ok(await page.locator('#v-'+target).evaluate(el=>el.classList.contains('on')));}
    // ── Конструктор инструментов Дневника: новый человек видит стартовый набор, каталог добавляет и убирает плитки, записи целы ──
    await page.reload();await page.waitForSelector('#v-home.on');await page.waitForFunction(()=>CAT&&CAT.tools&&CAT.tools.length);
    for(const key of ['card','dayrune','day','tone','lunar','sky'])assert.ok(await page.locator('#v-home [data-feature='+key+']').isVisible(),key+' is always on «Сегодня»');
    // ── Утро: ответ на «На что хочу обращать внимание каждое утро?» — выбранное сверху, остальное квадратами; карта тянется сама и задаёт тему с утра ──
    assert.deepEqual(await page.locator('#morning-chips .chip').allTextContents(),['Карта дня','Руна дня','Влияние планет','Прогноз дня','Луна','Вопрос дня']);
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#morning-feed [data-feature]')].map(e=>e.dataset.feature)),['lunar','tone'],'default morning: Луна и вопрос дня');
    assert.ok((await page.locator('#h-wish').innerText()).length>10&&(await owner.json('/me')).day.theme?.key,'настрой дня и его тема');
    await page.locator('#morning-chips').getByRole('button',{name:'Карта дня',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#morning-feed [data-feature=card]'));
    assert.deepEqual((await owner.json('/preferences')).preferences.morning,['card','lunar','tone']);
    const meAfter=await owner.json('/me');assert.ok(meAfter.day.card,'a chosen card is drawn by itself');
    await page.locator('#morning-chips').getByRole('button',{name:'Карта дня',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#morning-more [data-feature=card]'));
    assert.equal(await page.locator('#v-home [data-feature=habits],#v-home [data-feature=askesis],#v-home [data-feature=mood],#h-next,#h-progress,.day-focus,.quick-actions').count(),0,'practices, mood and the ritual counter are not on «Сегодня»');
    assert.equal(await page.locator('#v-history [data-feature=hentries]').count(),0);assert.ok(await page.locator('#v-ask [data-feature=hentries]').count()===1,'question history lives in «Свериться с собой»');
    await page.evaluate(()=>go('history'));
    const start=(await page.evaluate(()=>[...document.querySelectorAll('#v-history [data-feature]')].filter(e=>!e.hidden).map(e=>e.dataset.feature)));
    assert.ok(start.includes('gratitude')&&start.includes('journal')&&start.includes('mood')&&start.includes('week'),'start set: '+start.join(','));
    assert.ok(!start.includes('askesis')&&!start.includes('habits')&&!start.includes('wishes'),'optional tools are hidden until chosen');
    assert.ok(await page.locator('#v-history .feature-group').filter({hasText:'Практики'}).isHidden(),'empty group is hidden with its heading');
    const habit=await owner.json('/habits','POST',{title:'Тест: до конструктора',rule:'каждый день'});
    await page.locator('#v-history .tools-link button').click();await page.locator('#wg-body #w-tools .tool-card').first().waitFor();
    assert.equal(await page.locator('#wg-eb').innerText(),'Мои инструменты');
    const toolCard=(t)=>page.locator('#w-tools .tool-card').filter({has:page.locator('b',{hasText:new RegExp('^'+t+'$')})});
    await toolCard('Дневник привычек').getByRole('button',{name:'Добавить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#v-history [data-feature=habits]').hidden);
    await toolCard('Дневник благодарности').getByRole('button',{name:'Убрать',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#v-history [data-feature=gratitude]').hidden);
    assert.deepEqual((await owner.json('/preferences')).preferences.tools,['habits'],'visible tools are saved in preferences');
    await toolCard('Дневник привычек').getByRole('button',{name:'Посмотреть',exact:true}).click();await page.locator('#v-practice.on #w-habits').waitFor();
    await page.locator('#habit-list').getByText('Тест: до конструктора',{exact:true}).waitFor();await close();
    await page.evaluate(()=>openWidget('tools'));await toolCard('Дневник привычек').getByRole('button',{name:'Убрать',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#v-history [data-feature=habits]').hidden);await close();
    assert.ok((await owner.json('/habits')).items.some(h=>h.title==='Тест: до конструктора'),'hiding a tool keeps its records');
    await page.reload();await page.waitForSelector('#v-home.on');await page.waitForFunction(()=>CAT&&CAT.tools&&CAT.tools.length);await page.evaluate(()=>go('history'));
    assert.ok(await page.locator('#v-history [data-feature=gratitude]').isHidden()&&await page.locator('#v-history [data-feature=journal]').isVisible(),'choice survives reload');
    /* дальше сценарии открывают все плитки — включаем всё */
    const prefsNow=(await owner.json('/preferences')).preferences;await owner.json('/preferences','POST',{...prefsNow,tools:['gratitude','habits','askesis','wishes','hmood']});
    await page.reload();await page.waitForSelector('#v-home.on');await page.waitForFunction(()=>CAT&&CAT.tools&&!document.querySelector('#v-history [data-feature=askesis]').hidden);
    await page.locator('#v-home [data-feature=card]').click();await page.locator('#t-open').click();await page.locator('#t-after').waitFor();await close();
    await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history [data-feature=mood]').click();assert.equal(await page.locator('.quick-mood').count(),6);assert.ok(await page.locator('#mood-detail').isHidden());
    await page.getByRole('button',{name:'Устала',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mpick')?.textContent.includes('Устала'));
    assert.equal((await owner.json('/me')).mood,'quick:tired');
    const report=await owner.json('/mood/report');assert.ok(report.month.stats.some(s=>s.mood==='quick:tired'));
    await page.getByRole('button',{name:'Все эмоции',exact:true}).click();assert.equal(await page.locator('.mchip').count(),32);await close();
    await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history [data-feature=gratitude]').click();await page.locator('#gr-text').fill('Себе за внимательность к себе');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#gr-box .saved-state').waitFor();await close();
    await page.locator('.app-nav [data-nav=home]').click();
    await page.locator('#v-home [data-feature=tone]').click();await page.locator('#tone-a').fill('Я заметила свои потребности');await page.locator('#tone-save').click();await page.locator('#tone-box .saved-state').waitFor();await close();
    await page.evaluate(()=>{go('history');openWidget('journal');});await page.locator('#j-text').fill('Мой текст.');await page.locator('#j-dictate').click();
    await page.evaluate(()=>window.__speechQA.rec.onresult({resultIndex:0,results:[Object.assign([{transcript:'Продиктованное продолжение'}],{isFinal:true})]}));
    assert.equal(await page.locator('#j-text').inputValue(),'Мой текст. Продиктованное продолжение');await close();assert.equal(await page.evaluate(()=>window.__speechQA.aborts),1);assert.equal(await page.locator('#j-dictate').getAttribute('aria-pressed'),'false');assert.ok(await page.evaluate(()=>window.__speechQA.rec.onresult===null&&window.__speechQA.rec.onerror===null&&window.__speechQA.rec.onend===null));
    await page.locator('#v-history [data-feature=journal]').click();assert.equal(await page.locator('#j-text').inputValue(),'Мой текст. Продиктованное продолжение');
    await page.getByRole('button',{name:'Сохранить запись',exact:true}).click();await page.locator('#journal-saved').waitFor();await close();
    await page.evaluate(()=>go('ask'));await page.locator('[data-feature=worry]').click();
    assert.deepEqual(await page.locator('#hub-chips button').allTextContents(),['Отношения','Работа и деньги','Решение','Тревога','Отношение к себе','Другое']);
    await page.getByRole('button',{name:'Работа и деньги',exact:true}).click();await page.locator('#hub-q').fill('Как мне договориться об условиях работы?');await page.getByRole('button',{name:'Решение',exact:true}).click();assert.equal(await page.locator('#hub-q').inputValue(),'Как мне договориться об условиях работы?');
    const before=(await owner.json('/entries')).items.length;await page.locator('#hub-opts .chip').nth(1).click();assert.equal((await owner.json('/entries')).items.length,before,'Choosing a method does not submit the question');
    await page.locator('#hub-go').click();await page.waitForFunction(()=>document.querySelector('#hub-res .card')!==null);assert.equal((await owner.json('/entries')).items.length,before+1);await close();
    await page.evaluate(()=>{go('home');openWidget('lunar');});await page.locator('.lunar-heading h3').waitFor();assert.ok(await page.locator('.lunar-library').evaluate(el=>!el.open));await page.locator('#ln-days .chip').first().waitFor({state:'attached'});assert.equal(await page.locator('#ln-days .chip').count(),30);
    /* с «темами чтения» статья дня показывает выбранные разделы сразу, а остальные — свёрнутыми <details>; кнопки «О дне подробнее» больше нет */
    await page.locator('#ln-art .yr-art').waitFor();const hiddenSecs=page.locator('#ln-art .ln-hidden details');
    if(await hiddenSecs.count()){assert.ok(!(await hiddenSecs.first().evaluate(el=>el.open)));await hiddenSecs.first().locator('summary').click();assert.ok(await hiddenSecs.first().evaluate(el=>el.open));}
    await page.locator('.lunar-library > summary').click();await page.locator('#ln-days .chip').last().click();    /* без кнопки «подробнее»: невыбранные разделы лежат свёрнутыми <details> (их текст не входит в innerText) — раскрываем, и глава видна целиком */
    await page.locator('#ln-preview .yr-art').waitFor();const prevHidden=page.locator('#ln-preview .ln-hidden details');if(await prevHidden.count())await prevHidden.first().locator('summary').click();
    const previewText=await page.locator('#ln-preview').innerText();assert.ok(previewText.includes('Вступление 30'),'вступление 30-го дня');assert.ok(previewText.includes('Полная глава 30'),'полная глава 30-го дня');await close();
    await page.evaluate(()=>openWidget('day'));assert.ok(await page.locator('#forecast-note').innerText());await page.getByRole('button',{name:'Понятно',exact:true}).click();await close();await page.evaluate(()=>openWidget('day'));assert.equal(await page.locator('#forecast-note').innerText(),'');await close();
    await page.evaluate(()=>go('account'));const download=page.waitForEvent('download');await page.getByRole('button',{name:/Скачать мои данные/}).click();const file=await download;assert.match(file.suggestedFilename(),/^lunario-.*\.pdf$/);
    const exported=await owner.json('/data/export');assert.ok(exported.journal.some(i=>i.text.includes('Продиктованное продолжение')));assert.ok(exported.journal.some(i=>i.kind==='gratitude'));assert.ok(exported.dailySets.length);assert.ok(!JSON.stringify(exported).includes('token_hash'));
    assert.deepEqual(errors,[]);
    console.log('PASS: all features mapped to four sections; tools catalog (start set, add/remove, records kept, reload); five quick moods plus full 32; question directions/draft/explicit submit; dictation lifecycle; lunar hierarchy; forecast note; personal export download.');
  }finally{await ctx.close();}
}
