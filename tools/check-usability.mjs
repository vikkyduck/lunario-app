/* Focused integration checks for the simplified practices. Uses an isolated account/backend. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkUsabilityUI({browser,base,owner}){
  const [name,value]=owner.cookie.split('='),day=(await owner.json('/me')).day.date;
  await owner.json('/habits','POST',{title:'Прогулка',rule:'каждый день'});
  await owner.json('/habits','POST',{title:'Стакан воды',rule:'каждый день'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await ctx.addCookies([{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  const open=async key=>{await page.evaluate(k=>openWidget(k),key);await page.locator(':is(#wg-body,#practice-body) #w-'+key).waitFor();};
  const capture=async label=>{if(process.env.LUNARIO_QA_SHOTS){await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.target?.classList?.contains('command-enter')));await mkdir(process.env.LUNARIO_QA_SHOTS,{recursive:true});await page.screenshot({path:join(process.env.LUNARIO_QA_SHOTS,label+'.png'),fullPage:false});}};
  try{
    /* плитки инструментов на главной видны только по выбору — включаем все, сценарий открывает их по названию */
    { const pr=(await owner.json('/preferences')).preferences; await owner.json('/preferences','POST',{...pr,tools:['gratitude','habits','askesis','wishes','hmood']}); }
    await page.goto(base+'/');await page.waitForSelector('#v-home.on');await page.waitForFunction(()=>CAT&&CAT.tools&&!document.querySelector('#v-history [data-feature=habits]').hidden);
    const data=await owner.json('/me');
    assert.equal(await page.locator('#h-wish').innerText(),data.day.set.text);
    assert.ok((await page.locator('#h-wish').innerText()).endsWith(', '+data.user.name));
    await page.waitForFunction(()=>S.habitsReady&&S.habitsCount===2);   /* плашки практик без подписей о состоянии — ждем сам статус */
    await open('habits');await page.locator('#habit-list .hb-check').first().waitFor();
    assert.equal(await page.locator('#habit-list .hb-check').count(),2);
    assert.ok(await page.locator('#hb-new-form').isHidden());
    await page.locator('#habit-list .hb-check').first().click();
    await page.waitForFunction(()=>document.querySelector('#habit-list .practice-progress').textContent.includes('1 из 2'));
    await page.getByRole('tab',{name:'Все привычки',exact:true}).click();
    assert.equal(await page.locator('#habit-list .hb-check').count(),2,'No duplicate today checklist');
    await page.getByRole('button',{name:'Добавить привычку',exact:true}).click();
    await page.locator('#hb-new').fill('Черновик привычки');await page.locator('#hb-rule').fill('Каждые 5 дней');
    await page.getByRole('tab',{name:'Сегодня',exact:true}).click();
    assert.equal(await page.locator('#hb-rule').inputValue(),'Каждые 5 дней');
    await close();await open('habits');await page.getByRole('button',{name:'Добавить привычку',exact:true}).click();await page.locator('#hb-new').waitFor();
    assert.equal(await page.locator('#hb-new').inputValue(),'Черновик привычки');
    await page.getByRole('button',{name:'Добавить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#hb-new-form').hidden);
    assert.equal((await owner.json('/habits')).items.find(h=>h.title==='Черновик привычки').ruleText,'Каждые 5 дней');
    assert.equal(await page.locator('.hb-columns').first().evaluate(el=>getComputedStyle(el).display),'grid');
    await capture('habits-mobile');await close();

    await open('mood');await page.getByRole('button',{name:'Назвать точнее',exact:true}).click();await page.locator('.emotion-family').first().waitFor();
    assert.equal(await page.locator('.emotion-family').count(),8);
    assert.equal(await page.locator('#t-moods .mchip').count(),0);
    await page.getByRole('button',{name:'Своё слово',exact:true}).click();
    await page.locator('#mood-own').fill('Тихое любопытство');
    await page.locator('.emotion-family').first().click();
    assert.equal(await page.locator('#mood-shades .mchip').count(),3);
    assert.equal(await page.locator('#mood-own').inputValue(),'Тихое любопытство');
    await page.getByRole('tab',{name:'Все эмоции',exact:true}).click();
    assert.equal(await page.locator('#t-moods .mchip').count(),32);
    await page.locator('#mood-own').fill('');
    await page.getByRole('tab',{name:'Основные эмоции',exact:true}).click();
    assert.equal(await page.locator('#mood-own').inputValue(),'');
    /* «Сочетания эмоций» перерисовывает список — фокус должен вернуться на саму кнопку, иначе он падает на <body>
       и клавиатурой приходится идти с начала экрана. Кнопка есть только в режиме «Основные эмоции». */
    const dyad=page.getByRole('button',{name:'Сочетания эмоций',exact:true});
    await dyad.waitFor();await dyad.click();
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Сочетания эмоций','после перерисовки фокус вернулся на «Сочетания эмоций»');
    await page.locator('.emotion-family').first().click();   // возвращаем выбранное семейство — дальше проверяются его оттенки
    await page.locator('#mood-shades .mchip').nth(1).click();
    await page.locator('#t-moods .saved-state').waitFor();
    await capture('mood-mobile');await close();

    await open('gratitude');await page.locator('#gr-text').waitFor();
    assert.equal(await page.locator('#gr-box .practice-question').innerText(),'Кому и за что я благодарна сегодня?');
    await page.locator('#gr-text').fill('Подруге за разговор');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#gr-box .saved-state').waitFor();
    const saved=(await owner.json('/journal?kind=gratitude')).items[0];
    assert.equal(saved.day,day);assert.equal(await page.locator('#gr-text').count(),0);
    await page.getByRole('button',{name:'Изменить запись',exact:true}).click();
    await page.locator('#gr-text').fill('Подруге за тёплый разговор');
    await page.route('**/api/journal',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{error:'test_unavailable'}}):route.continue());
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.waitForFunction(()=>!gratitudeSaving);
    assert.equal(await page.locator('#gr-text').inputValue(),'Подруге за тёплый разговор');
    await close();await open('gratitude');await page.locator('#gr-text').waitFor();
    assert.equal(await page.locator('#gr-text').inputValue(),'Подруге за тёплый разговор');
    await page.unroute('**/api/journal');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#gr-box .saved-state').waitFor();
    const after=(await owner.json('/journal?kind=gratitude')).items;
    assert.equal(after.length,1);assert.equal(after[0].id,saved.id);assert.equal(after[0].day,saved.day);
    assert.equal(after[0].text,'Подруге за тёплый разговор');
    await capture('gratitude-mobile');await close();

    await open('askesis');await page.locator('#as-title').waitFor();
    await page.locator('#as-title').fill('Без вечернего скроллинга');
    const until=new Date(Date.parse(day)+45*864e5).toISOString().slice(0,10);
    await page.locator('#as-until').fill(until);
    await page.locator('#as-box').getByRole('button',{name:'Взять аскезу',exact:true}).click();
    await page.locator('.observation').waitFor();
    assert.ok(await page.locator('.observation textarea').isHidden());
    assert.ok(await page.locator('.practice-create input').first().isHidden());
    await page.locator('.observation summary').click();
    await page.locator('.observation textarea').fill('Вечер стал спокойнее');
    await close();await open('askesis');await page.locator('.observation textarea').waitFor();
    assert.equal(await page.locator('.observation textarea').inputValue(),'Вечер стал спокойнее');
    await page.getByRole('button',{name:'Сохранить наблюдение',exact:true}).click();
    await page.locator('#as-box .saved-state').waitFor();
    assert.ok(await page.locator('.observation textarea').isHidden());
    assert.equal((await owner.json('/askesis')).active[0].today.text,'Вечер стал спокойнее');
    assert.ok(await page.locator('#as-box h3').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=20));
    await capture('askesis-mobile');await close();

    await open('tone');await page.locator('#tone-a').fill('Я могу двигаться в своём темпе');
    await close();await open('tone');
    assert.equal(await page.locator('#tone-a').inputValue(),'Я могу двигаться в своём темпе');
    await page.getByRole('button',{name:'Отправить в дневник',exact:true}).click();
    await page.locator('#tone-box .saved-state').waitFor();
    assert.equal((await owner.json('/journal?kind=answer')).items.length,1);
    // Keyboard focus remains in the open dialog and returns to its trigger on close.
    await page.locator('.wg-x').focus();await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(()=>document.querySelector('#wg').contains(document.activeElement)));
    await close();
    await page.evaluate(()=>go('history'));await page.locator('#v-history').getByRole('button',{name:'Дневник привычек',exact:true}).click();
    await close();
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Дневник привычек');

    for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>go('home'));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await capture('home-'+width);
      for(const key of ['mood','habits','gratitude','askesis']){
        await open(key);await page.locator(':is(#wg-tools,#practice-tools) .rem-summary').waitFor();
        assert.equal(await page.locator(':is(#wg-tools,#practice-tools) .rem-body:visible').count(),0);
        assert.equal(await page.locator('#wg-body [data-rem]').count(),0);
        assert.ok(await page.evaluate(()=>{const el=document.querySelector('#v-practice.on')||document.querySelector('.wg');return el.scrollWidth<=el.clientWidth+1;}),key+' modal overflow');
        await close();
      }
    }
    await page.emulateMedia({reducedMotion:'reduce'});await open('habits');
    assert.equal(await page.locator('.wg').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.deepEqual(errors,[]);
    console.log('PASS: calm home/statuses, one habit checklist, free rhythm/draft retention, 8 mood families/all 32 emotions, gratitude edit/no duplicate/date preservation, optional askesis notes, saved daily answer, compact reminders, keyboard focus and four responsive sizes.');
  }finally{await ctx.close();}
}
