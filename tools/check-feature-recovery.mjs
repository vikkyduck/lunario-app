import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

// Exercises the seven omissions from the feature audit against an isolated real backend.
export async function checkFeatureRecovery({browser,base,owner}){
  const me=await owner.json('/me'),day=me.day.date,catalog=await owner.json('/catalog');
  for(const [title,rule] of [['Свободная практика','когда захочу'],['Недельная практика','раз в неделю'],['Месячная практика','раз в месяц'],['Рабочие дни','по будням']]){
    const h=(await owner.json('/habits','POST',{title,rule})).items.find(h=>h.title===title);
    await owner.json('/habits','PATCH',{id:h.id,day});
  }
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');await context.addCookies([{name,value,domain:'127.0.0.1',path:'/app'}]);
  await context.route('**/api/catalog*',route=>route.fulfill({json:{...catalog,news:[
    {month:day.slice(0,7),view:'ask',widget:'',title:'Расклады Таро и рун'},
    {month:day.slice(0,7),view:'history',widget:'',title:'История'},
    {month:day.slice(0,7),view:'about',widget:'',title:'Обо мне'},
    {month:day.slice(0,7),view:'today',widget:'',title:'Сегодня'},
    {month:day.slice(0,7),view:'today',widget:'card',title:'Карта дня'},
  ]}}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async key=>{await page.evaluate(k=>openWidget(k),key);};
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  const shot=async label=>{if(process.env.LUNARIO_QA_DIR){await mkdir(process.env.LUNARIO_QA_DIR,{recursive:true});await page.screenshot({path:join(process.env.LUNARIO_QA_DIR,'recovery-'+label+'.png'),fullPage:true});}};
  try{
    await page.goto(base+'/');await page.locator('#v-home.on').waitFor();
    await open('day');assert.equal(await page.locator('#f-bars [role=meter]').count(),4);
    for(const [label,key] of [['Работа','work'],['Отношения','love'],['Здоровье','health'],['Финансы','money']])assert.equal(await page.getByRole('meter',{name:label,exact:true}).getAttribute('aria-valuenow'),String(me.day.forecast.bars[key]));
    await shot('forecast');await close();
    await open('habits');await page.locator('#habit-list .hb').first().waitFor();
    await page.getByRole('tab',{name:'Все привычки',exact:true}).click();
    assert.match(await page.locator('.hb').filter({hasText:'Свободная практика'}).innerText(),/Отмечено 1 раз/);
    assert.match(await page.locator('.hb').filter({hasText:'Недельная практика'}).innerText(),/1 неделя подряд/);
    assert.match(await page.locator('.hb').filter({hasText:'Месячная практика'}).innerText(),/1 месяц подряд/);
    const weekdays=page.locator('.hb').filter({hasText:'Рабочие дни'});
    assert.equal(await weekdays.locator('.hd.rest').count(),2);assert.equal(await weekdays.locator('.hd.planned').count(),5);
    assert.equal(await weekdays.locator('.hd.rest:not(.on)').first().evaluate(e=>getComputedStyle(e,'::before').borderStyle),'dashed');
    await page.getByRole('button',{name:'Добавить привычку',exact:true}).click();
    assert.equal(await page.locator('#hb-new').getAttribute('list'),'hb-ideas');
    assert.deepEqual(await page.locator('#hb-ideas option').evaluateAll(items=>items.map(e=>e.value)),catalog.habitIdeas);
    await page.locator('#hb-new').fill(catalog.habitIdeas[0]);await page.locator('#hb-rule').fill('каждые 17 дней');
    await page.getByRole('button',{name:'Добавить',exact:true}).click();await page.locator('#hb-new-form').waitFor({state:'hidden'});
    assert.equal((await owner.json('/habits')).items.find(h=>h.title===catalog.habitIdeas[0]).ruleText,'каждые 17 дней');
    await shot('habits');await close();
    await open('askesis');await page.locator('#as-title').waitFor();
    await page.locator('.practice-ideas summary').click();
    assert.deepEqual(await page.locator('.practice-ideas button').allTextContents(),catalog.askesisIdeas);
    await page.locator('.practice-ideas button').first().click();assert.equal(await page.locator('#as-title').inputValue(),catalog.askesisIdeas[0]);
    await page.locator('#as-title').fill('Мой вариант аскезы');
    for(const [label,days] of [['Неделя',7],['2 недели',14],['Месяц',30],['40 дней',40],['До конца года',0]]){
      await page.getByRole('button',{name:label,exact:true}).click();
      assert.equal(await page.locator('#as-until').inputValue(),days?new Date(Date.parse(day+'T12:00:00Z')+(days-1)*864e5).toISOString().slice(0,10):day.slice(0,4)+'-12-31');
      assert.equal(await page.locator('#as-title').inputValue(),'Мой вариант аскезы');
    }
    await page.evaluate(()=>{S.day.date='2026-12-29';askQuick(7);});assert.equal(await page.locator('#as-until').inputValue(),'2027-01-04');await page.evaluate(d=>{S.day.date=d;},day);
    const custom=new Date(Date.parse(day+'T12:00:00Z')+500*864e5).toISOString().slice(0,10);
    await page.locator('#as-until').fill(custom);await page.locator('#as-title').click();
    await shot('askesis');
    await page.locator('#as-box').getByRole('button',{name:'Взять аскезу',exact:true}).click();
    await page.locator('.practice-question').filter({hasText:'Мой вариант аскезы'}).waitFor();
    assert.equal((await owner.json('/askesis')).active[0].until,custom);await close();
    /* экран «Новое в приложении» снят (решение владелицы 20.09) — переходов по плиткам новостей больше нет */
    for(const theme of ['light','dark'])for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
      await page.setViewportSize({width,height});await page.evaluate(t=>applyTheme(t),theme);
      for(const key of ['day','habits','askesis']){
        await open(key);
        if(key==='habits'){await page.getByRole('tab',{name:'Все привычки',exact:true}).click();}
        if(key==='askesis'){
          for(const selector of ['.practice-create','.practice-ideas']){
            if(!await page.locator(selector).evaluate(el=>el.open))await page.locator(selector+'>summary').click();
          }
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${key} fits ${width}, ${theme}`);
        if(key==='day')assert.equal(await page.locator('#f-bars [role=meter]').count(),4);
        await close();
      }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: all 7 audited omissions restored; forecast values, catalogue suggestions, editable askesis shortcuts/inclusive dates, non-daily progress, calendar due state, canonical News navigation; 4 widths in both themes.');
  }finally{await context.close();}
}
