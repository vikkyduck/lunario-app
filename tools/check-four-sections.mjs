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
    assert.deepEqual((await page.locator('.app-nav button').allTextContents()).map(s=>s.trim()),['Сегодня','Свериться','Дневник','Я']);
    assert.equal(await page.locator('#v-home .sqs,#v-home .mini,#v-today,#v-about,#v-around').count(),0,'No obsolete menu or orphan category');
    const initialDay=(await owner.json('/me')).day;
    await page.locator('#h-set-question').click();
    assert.equal(await page.locator('#tone-box .practice-question').innerText(),initialDay.question);
    assert.equal(await page.locator('#tone-box > .hint').innerText(),initialDay.set.statement);
    await close();assert.equal(await page.evaluate(()=>document.activeElement.id),'h-set-question');
    const routes={home:['card','day','tone','mood','habits','askesis','lunar','sky'],ask:['worry'],history:['journal','gratitude','wishes','hmood','hentries','week'],account:['natal','year','birthnum','compat','mail','remind','shelves','support','edit','invite'],news:['tests']};
    for(const [view,keys] of Object.entries(routes))for(const key of keys){
      await page.evaluate(v=>go(v),view);
      const root=page.locator(`#v-${view} [data-feature="${key}"]`);assert.equal(await root.count(),1,key+' canonical entry');
      await root.click();await page.locator(`:is(#wg.on,#v-practice.on) #w-${key}`).waitFor();await close();
    }
    for(const mode of ['yesno','rune','spread']){await page.evaluate(()=>go('ask'));await page.locator(`#v-ask button[onclick="openAsk('${mode}')"]`).click();await page.locator('#w-ask').waitFor();assert.ok(await page.locator('#a-go').evaluate(el=>!el.classList.contains('ghost')));await close();}
    for(const [alias,target] of [['today','home'],['around','home'],['about','account']]){await page.evaluate(v=>go(v),alias);assert.ok(await page.locator('#v-'+target).evaluate(el=>el.classList.contains('on')));}
    await page.reload();await page.waitForSelector('#v-home.on');
    assert.equal(await page.locator('#h-next').innerText(),'Открыть карту дня →');
    await page.locator('#h-next').click();await page.locator('#t-open').click();await page.locator('#t-after').waitFor();await close();
    assert.equal(await page.locator('#h-next').innerText(),'Отметить настроение →');
    await page.locator('#h-next').click();assert.equal(await page.locator('.quick-mood').count(),6);assert.ok(await page.locator('#mood-detail').isHidden());
    await page.getByRole('button',{name:'Устала',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mpick')?.textContent.includes('Устала'));
    assert.equal((await owner.json('/me')).mood,'quick:tired');
    const report=await owner.json('/mood/report');assert.ok(report.month.stats.some(s=>s.mood==='quick:tired'));
    await page.getByRole('button',{name:'Все эмоции',exact:true}).click();assert.equal(await page.locator('.mchip').count(),32);await close();
    assert.equal(await page.locator('#h-next').innerText(),'Записать благодарность →');
    await page.locator('#h-next').click();assert.ok(await page.locator('#v-history.on').count());await page.locator('#gr-text').fill('Себе за внимательность к себе');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#gr-box .saved-state').waitFor();await close();
    await page.locator('.app-nav [data-nav=home]').click();assert.ok(await page.locator('#h-next').isHidden());assert.equal(await page.locator('#h-progress').innerText(),'Ритуал на сегодня завершён');
    await page.locator('#h-set-question').click();await page.locator('#tone-a').fill('Я заметила свои потребности');await page.locator('#tone-save').click();await page.locator('#tone-box .saved-state').waitFor();await close();assert.ok(await page.locator('#h-next').isHidden());
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
    assert.ok(await page.locator('#ln-art .morebody').isHidden());await page.getByRole('button',{name:'О дне подробнее',exact:true}).click();assert.ok(await page.locator('#ln-art .morebody').isVisible());assert.equal(await page.locator('#ln-art .morebtn').getAttribute('aria-expanded'),'true');
    await page.locator('.lunar-library summary').click();await page.locator('#ln-days .chip').last().click();assert.ok((await page.locator('#ln-preview').innerText()).includes('Вступление 30'));await page.locator('#ln-preview .morebtn').click();assert.ok((await page.locator('#ln-preview').innerText()).includes('Полная глава 30'));await close();
    await page.evaluate(()=>openWidget('day'));assert.ok(await page.locator('#forecast-note').innerText());await page.getByRole('button',{name:'Понятно',exact:true}).click();await close();await page.evaluate(()=>openWidget('day'));assert.equal(await page.locator('#forecast-note').innerText(),'');await close();
    await page.evaluate(()=>go('account'));const download=page.waitForEvent('download');await page.getByRole('button',{name:/Скачать мои данные/}).click();const file=await download;assert.match(file.suggestedFilename(),/^lunario-.*\.json$/);
    const exported=await owner.json('/data/export');assert.ok(exported.journal.some(i=>i.text.includes('Продиктованное продолжение')));assert.ok(exported.journal.some(i=>i.kind==='gratitude'));assert.ok(exported.dailySets.length);assert.ok(!JSON.stringify(exported).includes('token_hash'));
    assert.deepEqual(errors,[]);
    console.log('PASS: all features mapped to four sections; real next-step sequence; five quick moods plus full 32; question directions/draft/explicit submit; dictation lifecycle; lunar hierarchy; forecast note; personal export download.');
  }finally{await ctx.close();}
}
