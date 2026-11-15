import assert from 'node:assert/strict';
export async function checkRepeatPractices({browser,base,owner}){
  const day=(await owner.json('/me')).day.date;
  await owner.json('/habits','POST',{title:'Прогулка',rule:'каждый день'});
  await owner.json('/habits','POST',{title:'Вода',rule:'каждый день'});
  const until=new Date(Date.parse(day)+45*864e5).toISOString().slice(0,10);
  await owner.json('/askesis','POST',{title:'Без шоппинга',until});
  await owner.json('/askesis','POST',{title:'Без скроллинга',until});
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');await ctx.addCookies([{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[],gaps=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async key=>{await page.evaluate(k=>openWidget(k),key);await page.locator(':is(#wg.on,#v-practice.on) #w-'+key).waitFor();};
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  const primary=()=>page.locator(':is(#wg-body,#practice-body) .btn:not(.ghost):visible').count();
  try{
    await page.goto(base+'/');await page.waitForSelector('#v-home.on');
    await open('habits');await page.locator('#habit-list .hb-check').first().waitFor();
    await page.getByRole('tab',{name:'Все привычки',exact:true}).click();await close();await open('habits');
    await page.locator('#habit-list .hb-check').first().waitFor();
    if(await page.getByRole('tab',{name:'Сегодня',exact:true}).getAttribute('aria-selected')!=='true')gaps.push('Привычки повторно открываются не на Сегодня');
    await page.getByRole('tab',{name:'Все привычки',exact:true}).click();
    await page.getByRole('button',{name:'+ Добавить привычку',exact:true}).click();
    await page.locator('#hb-new').fill('Черновик новой привычки');await page.locator('#hb-rule').fill('Каждые 5 дней');
    await page.getByRole('button',{name:'Изменить: Прогулка',exact:true}).click();
    if(await primary()>1)gaps.push('Добавление и редактирование привычки показывают две основные кнопки');
    await page.locator('.hb-edit input').first().fill('Черновик изменения');
    await page.getByRole('button',{name:/Добавить привычку|Закрыть добавление/}).click();
    if(await primary()>1)gaps.push('Возврат к добавлению оставляет редактор привычки открытым');
    assert.equal(await page.locator('#hb-new').inputValue(),'Черновик новой привычки');
    assert.equal(await page.locator('#hb-rule').inputValue(),'Каждые 5 дней');
    await close();await open('habits');await page.getByRole('tab',{name:'Все привычки',exact:true}).click();
    await page.getByRole('button',{name:'Изменить: Прогулка',exact:true}).click();
    assert.equal(await page.locator('.hb-edit input').first().inputValue(),'Черновик изменения');
    await page.locator('.hb-edit input').last().fill('Каждые 5 дней');
    await page.locator('.hb-edit').getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('.hb-edit').waitFor({state:'hidden'});
    const habits=(await owner.json('/habits')).items;assert.equal(habits.length,2);
    assert.equal(habits.find(h=>h.title==='Черновик изменения').ruleText,'Каждые 5 дней');
    await close();
    await open('mood');await page.getByRole('button',{name:'Все эмоции',exact:true}).click();
    assert.equal(await page.locator('#t-moods .mchip').count(),32);await close();await open('mood');
    if(await page.locator('#mood-detail').isVisible())gaps.push('Настроение повторно открывает развёрнутые 32 эмоции');
    await close();
    await open('askesis');await page.locator('.observation').first().waitFor();
    await page.locator('.observation summary').nth(0).click();await page.locator('.observation textarea').nth(0).fill('Первое наблюдение');
    await page.locator('.observation summary').nth(1).click();await page.locator('.observation textarea').nth(1).fill('Второе наблюдение');
    if(await primary()>1)gaps.push('Одновременно открыты формы двух наблюдений');
    await page.locator('#as-box .practice-create > summary').click();   // именно заголовок панели: внутри формы есть свой <summary>
    /* Семантика делегирования (on.js): у атрибута ontoggle срабатывал только свой <details> — toggle не всплывает.
       Вложенные «Примеры аскез» внутри панели создания аскезы не должны дёргать askPanelToggle внешней панели.
       Проверяем сам механизм на временной разметке: click обязан дойти до предка, toggle — нет. */
    const delegation=await page.evaluate(()=>{
      const calls=[];window.LUN_HANDLERS.__qaOuter=function(){calls.push('предок:'+event.type);};
      const box=document.createElement('div');
      box.innerHTML='<details data-on="toggle:__qaOuter click:__qaOuter"><summary>внешний</summary><details id="__qaInner"><summary>вложенный</summary></details></details>';
      document.body.appendChild(box);
      const inner=box.querySelector('#__qaInner');
      inner.open=true;inner.dispatchEvent(new Event('toggle',{bubbles:false}));
      inner.querySelector('summary').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      box.remove();delete window.LUN_HANDLERS.__qaOuter;
      return calls;
    });
    assert.deepEqual(delegation,['предок:click'],'toggle вложенного <details> не должен вызывать обработчик предка, click — должен');
    if(await primary()>1)gaps.push('Создание аскезы конкурирует с формами наблюдений');
    await page.locator('.observation summary').nth(0).click();
    assert.equal(await page.locator('.observation textarea').nth(0).inputValue(),'Первое наблюдение');
    assert.deepEqual(errors,[]);assert.deepEqual(gaps,[]);
    console.log('PASS: repeated entry starts with Today and quick moods; practice editors are exclusive; observation drafts survive switching.');
  }finally{await ctx.close();}
}
