import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkExperience({browser,base,owner}){
  const [name,value]=owner.cookie.split('='),day=(await owner.json('/me')).day.date;
  await owner.json('/habits','POST',{title:'Стакан воды',rule:'каждый день'});
  await owner.json('/askesis','POST',{title:'Без покупок',until:new Date(Date.parse(day)+90*864e5).toISOString().slice(0,10)});
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await ctx.addCookies([{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const shot=async label=>{if(process.env.LUNARIO_QA_SHOTS){await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity));await mkdir(process.env.LUNARIO_QA_SHOTS,{recursive:true});await page.screenshot({path:join(process.env.LUNARIO_QA_SHOTS,label+'.png'),fullPage:false});}};
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  try{
    await page.goto(base+'/');await page.waitForSelector('#v-home.on');
    /* инструменты: всё включаем через настройки, ритуала со счётчиком на главной больше нет */
    await page.waitForFunction(()=>CAT&&CAT.tools&&CAT.tools.length);
    const pr0=(await owner.json('/preferences')).preferences;await owner.json('/preferences','POST',{...pr0,tools:['gratitude','habits','askesis','wishes','hmood']});
    await page.reload();await page.waitForSelector('#v-home.on');await page.waitForFunction(()=>CAT&&CAT.tools&&!document.querySelector('#v-history [data-feature=askesis]').hidden);
    assert.equal(await page.locator('#h-next,.day-focus').count(),0);
    await page.locator('#v-home [data-feature=tone]').click();
    await page.locator('#tone-a').fill('Длинный ответ для проверки чтения и поля. '.repeat(30));
    assert.ok(await page.locator('#tone-a').evaluate(e=>e.clientHeight>300&&e.scrollHeight<=e.clientHeight+2));
    assert.equal(await page.locator('#tone-a').evaluate(e=>getComputedStyle(e).fontSize),'18px');
    assert.equal(await page.locator('#tone-box .card').count(),0);
    // A shrunken viewport models the space left above a keyboard; no real iOS keyboard is claimed.
    await page.setViewportSize({width:390,height:420});await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--visible-height'))-420)<2);
    const save=await page.locator('#tone-save').boundingBox();await shot('question-keyboard');assert.ok(save.y>=0&&save.y+save.height<=420,JSON.stringify(save));
    await page.locator('#tone-save').click();await page.locator('#tone-box .saved-state').waitFor();await close();
    /* Дневник по шагам: первый вопрос — тот же, что зовет вечерний пуш; записанный день читается текстом; прошлые дни — строками */
    await page.setViewportSize({width:390,height:844});await page.locator('.app-nav [data-nav=history]').click();await page.locator('#day-card #dc-text').waitFor();
    assert.equal(await page.locator('#day-card .dc-q').innerText(),'Что хочется оставить от этого дня?');
    await page.locator('#dc-text').fill('Сегодня я нашла время для себя');await page.locator('#dc-next').click();await page.locator('#dc-mood-chips').waitFor();
    while(await page.locator('#dc-next').innerText()!=='Запомнить этот день')await page.locator('#dc-next').click();
    await page.locator('#dc-next').click();await page.locator('#day-card .dc-read').first().waitFor({timeout:8000});
    assert.ok((await page.locator('#day-card').innerText()).includes('Сегодня я нашла время для себя'));assert.ok((await page.locator('#day-card').innerText()).includes('Длинный ответ'),'the answer of the day is part of the recorded day');
    await page.locator('.app-nav [data-nav=home]').click();await shot('home-tools-light');await page.reload();await page.waitForSelector('#v-home.on');
    await page.locator('.app-nav [data-nav=history]').click();await page.locator('#day-card .dc-read').first().waitFor();await shot('diary-light');
    assert.equal(await page.locator('#timeline-filters').count(),0,'no feed filters on the diary tab');assert.equal(await page.locator('.day-row').count(),6,'six past days as rows');await shot('diary-light');
    /* из отчета настроений день открывается страницей чтения (прежняя лента с фильтрами заменена строками «Прошлые дни») */
    await owner.json('/mood','POST',{mood:'joy'});await page.locator('[data-feature=hmood]').click();await page.locator('.mr-day').last().click();await page.locator('#wg.on #dayview-box').waitFor();await close();
    await page.locator('[data-feature=wishes]').click();await page.locator('#w-text').fill('Поездка к морю');
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9fUAAAAASUVORK5CYII=';
    const chooser=page.waitForEvent('filechooser');await page.locator('#wish-photo-pick').click();await(await chooser).setFiles({name:'sea.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.locator('#wish-preview img').waitFor();await page.locator('#wish-save').click();await page.locator('#m-wishes .wish-picture img').waitFor();
    assert.equal((await owner.json('/wishes')).items[0].photo,true);assert.equal((await owner.json('/wishes')).items.length,1);
    await page.getByRole('button',{name:'Сбылось',exact:true}).click();await page.getByRole('button',{name:'✓ Сбылось · отменить отметку',exact:true}).waitFor();assert.notEqual(await page.getByRole('button',{name:'✓ Сбылось · отменить отметку',exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');await shot('wishes-light');await close();
    for(let i=0;i<8;i++)await owner.json('/habits','POST',{title:'Привычка '+i,rule:'каждый день'});
    for(const key of ['habits','askesis']){
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history [data-feature='+key+']').click();await page.locator('#v-practice.on #w-'+key).waitFor();
      assert.equal(await page.locator('#practice-tools .rem-summary').count(),0,'practice pages have no reminder rows — three pushes live in the account');assert.ok(await page.locator('#v-practice.on #w-'+key).count());await shot(key+'-page-light');if(key==='habits'){await page.evaluate(()=>window.scrollTo(0,400));const position=await page.evaluate(()=>scrollY);await page.locator('.app-nav [data-nav=about]').click();await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history [data-feature=habits]').click();await page.waitForFunction(y=>Math.abs(scrollY-y)<5,position);}await page.reload();await page.locator('#v-practice.on #w-'+key).waitFor();await close();
    }
    await page.locator('#v-home .gear-btn').click();await page.locator('#w-appearance .theme-option.dark').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await close();   /* тема — кружком справа вверху, три варианта */
    await page.reload();await page.waitForSelector('#v-home.on');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await shot('home-dark');
    for(const theme of ['light','dark'])for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
      await page.evaluate(t=>applyTheme(t),theme);await page.setViewportSize({width,height});
      for(const view of ['home','history','about','account']){
        await page.evaluate(v=>go(v),view);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),theme+' '+view+' '+width);
        if(view==='home')for(const selector of ['#h-moon','#ar-period']){
          assert.ok(await page.locator(selector).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16),theme+' '+selector+' readable at '+width);
        }
      }
      for(const key of ['habits','askesis','journal','tone','wishes']){await page.evaluate(k=>openWidget(k),key);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),key+' '+width);await close();}
      if(width===1440){await page.evaluate(()=>go('home'));await shot('home-desktop-'+theme);}
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>go('home'));assert.equal(await page.locator('#v-home .wid').first().evaluate(e=>getComputedStyle(e).animationName),'none');
    assert.deepEqual(errors,[]);console.log('PASS: tools chosen through the catalog, no ritual counter; growing answer and keyboard-sized viewport; real practice pages/back/drafts; direct filtered timeline/mood day; atomic wish image and completion; persistent themes; four widths in both themes.');
  }finally{await ctx.close();}
}
