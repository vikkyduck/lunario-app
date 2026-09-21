/* Used by check-personal-features.mjs --ui. Permission/transport are simulated;
   profile, reminders, notes and other application APIs use the isolated real backend. */
import assert from 'node:assert/strict';

export async function checkNotificationUI({browser,base,owner,other}) {
  const [name,value]=owner.cookie.split('=');
  const cookies=[{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,secure:false,sameSite:'Lax'}];
  await owner.json('/reminders','POST',{feature:'evening',enabled:false});
  // Real SW registration must complete before onboarding too, with no permission request.
  const fresh=await browser.newContext();
  try {
    const page=await fresh.newPage();await page.goto(base+'/');await page.waitForSelector('#v-hello.on');
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('/app/'))?.active);
    assert.equal(await page.evaluate(()=>Notification.permission),'default');
  } finally {await fresh.close();}

  /* Анкета по шагам → сразу «Сегодня» (без мастера, решение 19.09); мастер напоминаний открывается позже — здесь вызываем его
     напрямую, как строка «Напомнить вечером?» в записанном дне; выбор уходит в Аккаунт → Уведомления */
  const onb=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    const page=await onb.newPage();await page.goto(base+'/');await page.waitForSelector('#v-hello.on');
    await page.getByRole('button',{name:/Открыть мой день/}).click();await page.waitForSelector('#v-onb.on');
    await page.locator('#o-name').fill('Ритм');await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
    await page.locator('#o-birth').fill('1992-02-02');await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
    await page.locator('[data-on="click:obSkipTime"]').click();
    await page.locator('#o-city').fill('Москва');await page.locator('#o-form .ob-step:not([hidden]) [data-on="click:obNext"]').click();
    await page.locator('#o-consent').check();
    await page.locator('#o-go').click();await page.waitForSelector('#v-home.on');
    await page.evaluate(()=>openRhythm('home'));await page.waitForSelector('#v-rhythm.on');
    assert.deepEqual(await page.locator('#v-rhythm .rhythm-row b').allTextContents(),['Утро','Вечер','Воскресенье']);
    assert.equal(await page.locator('.app-nav').evaluate(e=>getComputedStyle(e).display),'none','no bottom tabs on the onboarding step');
    await page.locator('#rh-time-evening').fill('20:30');await page.locator('#rh-week').uncheck();
    await page.locator('#rh-go').click();await page.waitForSelector('#v-home.on');
    const rems=await page.evaluate(()=>fetch('/app/api/reminders').then(r=>r.json()).then(r=>Object.fromEntries(r.items.map(i=>[i.feature,i]))));
    assert.ok(rems.morning.enabled&&rems.morning.time==='09:00');assert.ok(rems.evening.enabled&&rems.evening.time==='20:30');assert.equal(rems.week.enabled,false);
  } finally {await onb.close();}

  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    await ctx.addCookies(cookies);
    await ctx.addInitScript(()=>{
      const qa=window.__pushQA={permission:localStorage.getItem('_qa_perm')||'default',result:'denied',requests:0,registrations:0,shared:[],tests:[]};
      const endpoint='https://push.invalid/ui-current-device';
      const sub=()=>localStorage.getItem('_qa_sub')?{endpoint}:null;
      Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return qa.permission;},requestPermission:async()=>{qa.requests++;qa.permission=qa.result;localStorage.setItem('_qa_perm',qa.permission);return qa.permission;}}});
      const reg={pushManager:{getSubscription:async()=>sub(),subscribe:async()=>{localStorage.setItem('_qa_sub','1');return {endpoint};}}};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>{qa.registrations++;return reg;},ready:Promise.resolve(reg),getRegistration:async()=>reg}});
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{qa.shared.push(data.text);}});
    });
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/reminders/test',async route=>{
      const body=route.request().postDataJSON();assert.equal(body.endpoint,'https://push.invalid/ui-current-device');
      await page.evaluate(b=>window.__pushQA.tests.push(b),body);
      await route.fulfill({json:{ok:true,sent:1}});
    });
    await page.goto(base+'/');await page.waitForSelector('#v-home.on');
    assert.equal(await page.locator('#push-invite,.push-invite-row').count(),0,'no notification banner on the home screen — the three reminders are set after the questionnaire and in the account');
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),0);
    await page.evaluate(()=>{go('account');openWidget('remind');});
    assert.deepEqual(await page.locator('#rem-all .item > b').allTextContents(),['Утро','Вечер','Неделя'],'exactly three reminders');
    const mood=page.locator('#rem-all [data-rem=evening]');await mood.getByRole('switch').waitFor();
    await mood.getByRole('switch').click();
    await page.waitForFunction(()=>window.__pushQA.requests===1 && !document.querySelector('#rem-all [data-rem=evening] [role=switch]').disabled);
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='evening').enabled,false,'Denied permission must not enable schedule');
    assert.match(await page.locator('#rem-device-status').innerText(),/заблокированы/);
    await page.locator('.wg-x').click();await page.locator('.app-nav [data-nav=home]').click();
    await page.locator('#v-home [data-feature=card]').click();
    assert.equal(await page.locator('#wg-tools .rem-summary').count(),0,'widgets have no reminder rows of their own any more');
    await page.locator('.wg-x').click();await page.evaluate(()=>{go('account');openWidget('remind');});await page.locator('#rem-device-status').waitFor();
    assert.match(await page.locator('#rem-device-status').innerText(),/заблокированы/);
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),1,'Reopening the settings must not request permission again');
    await page.evaluate(()=>window.__pushQA.result='granted');
    await mood.getByRole('switch').click();
    await page.waitForFunction(()=>document.querySelector('#rem-all [data-rem=evening] [role=switch]').getAttribute('aria-checked')==='true');
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),2);
    await mood.getByRole('button',{name:/Время и регулярность/}).click();
    await mood.getByLabel('Время уведомления').fill('19:47');await mood.getByLabel('Время уведомления').blur();
    await page.waitForFunction(()=>S.rem.evening.time==='19:47');
    await mood.getByRole('button',{name:'Раз в неделю',exact:true}).click();
    await mood.getByRole('button',{name:'Пт',exact:true}).click();
    await page.waitForFunction(()=>S.rem.evening.weekday===5);
    await mood.getByRole('button',{name:'Отправить пробное',exact:true}).click();
    await page.waitForFunction(()=>window.__pushQA.tests.length===1);
    await page.reload();await page.waitForSelector('#v-home.on');
    await page.evaluate(()=>{go('account');openWidget('remind');});
    await page.waitForFunction(()=>S.rem?.evening?.time==='19:47');
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='evening').weekday,5);
    /* у недели регулярность одна — раз в неделю, день выбирается */
    const week=page.locator('#rem-all [data-rem=week]');await week.getByRole('button',{name:/Время и регулярность/}).click();
    assert.deepEqual(await week.locator('[aria-label="Регулярность"] .chip').allTextContents(),['Раз в неделю']);
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),0,'Existing subscription reconnects without another prompt');
    await page.locator('.wg-x').click();
    for(const [width,height] of [[320,568],[844,390],[1440,900]]){
      await page.setViewportSize({width,height});
      await mood.getByLabel('Время уведомления').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.ok(await mood.getByLabel('Время уведомления').isVisible());
    }
    await page.setViewportSize({width:390,height:844});await page.locator('.wg-x').click();
    /* переходы из пушей: утро — на «Сегодня», вечер — в Дневник к карточке дня, неделя — к итогам */
    for(const [open,view,widget] of [['today','home',''],['diary','history',''],['week','history','week']]){
      await page.goto(base+'/?open='+open);await page.waitForSelector('#v-'+view+'.on');
      if(widget)await page.waitForSelector('#wg.on #w-'+widget);else assert.equal(await page.locator('#wg.on').count(),0);
    }
    assert.deepEqual(errors,[]);
    // Another account/device having a subscription must not suppress a permission prompt.
    await ctx.clearCookies();const [otherName,otherValue]=other.cookie.split('=');
    await ctx.addCookies([{...cookies[0],name:otherName,value:otherValue}]);
    await other.json('/profile','POST',{name:'Другое устройство',birth:'1990-01-01',city:'Москва',consent:true});
    await other.json('/push','POST',{endpoint:'https://push.invalid/different-device'});
    await page.evaluate(()=>{localStorage.removeItem('_qa_sub');localStorage.removeItem('_qa_perm');});
    await page.reload();await page.waitForSelector('#v-home.on');
    await page.evaluate(()=>{go('account');openWidget('remind');});
    await page.waitForFunction(()=>!!S.rem);
    assert.equal(await page.evaluate(()=>S.pushOn),false);
    console.log('PASS: three reminders in the account, denied/granted permission, current-device subscription, saved schedule, push deep links and responsive layouts. No real push sent.');
  } finally {await ctx.close();}
  // Native bridge contract: denied permission does not create a schedule; the test
  // action gets the same backend message and link as web push. No iOS device here.
  const native=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    await native.addCookies(cookies);
    await owner.json('/reminders','POST',{feature:'week',enabled:false});
    await native.addInitScript(()=>{
      window.__LUN_IOS__=4;
      const qa=window.__nativeQA={allowed:false,requests:[],states:{}};
      window.webkit={messageHandlers:{lunario:{postMessage:m=>{
        qa.requests.push(m);
        let ok=qa.allowed,reason=ok?'':'denied';
        if(m.type==='schedule'){ok=!m.on||qa.allowed;qa.states[m.id]=m.on&&ok;window.__lunScheduleState?.(qa.states,ok?'':'denied');}
        if(m.type==='scheduleStatus')window.__lunScheduleState?.(qa.states,'');
        if(m.requestId)queueMicrotask(()=>window.__lunNotificationResult({requestId:m.requestId,ok,reason}));
      }}}};
    });
    const page=await native.newPage();await page.goto(base+'/');await page.waitForSelector('#v-home.on');
    await page.evaluate(()=>{go('account');openWidget('remind');});
    const rem=page.locator('#rem-all [data-rem=week]');await rem.getByRole('switch').waitFor();
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='notificationPermission')&&!document.querySelector('#rem-all [data-rem=week] [role=switch]').disabled);
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='week').enabled,false);
    await page.evaluate(()=>window.__nativeQA.allowed=true);
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='schedule'&&r.id==='week'&&r.on));
    await rem.getByRole('button',{name:'Отправить пробное',exact:true}).click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='notificationTest'));
    const test=await page.evaluate(()=>window.__nativeQA.requests.find(r=>r.type==='notificationTest'));
    assert.equal(test.url,'/app/?open=week');assert.ok(test.title);
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='schedule'&&r.id==='week'&&!r.on));
    console.log('PASS: native permission, schedule acknowledgement, disable, feature test message and destination (bridge simulated).');
  } finally {await native.close();}
}
