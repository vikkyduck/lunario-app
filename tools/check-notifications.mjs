/* Used by check-personal-features.mjs --ui. Permission/transport are simulated;
   profile, reminders, notes and other application APIs use the isolated real backend. */
import assert from 'node:assert/strict';

export async function checkNotificationUI({browser,base,owner,other}) {
  const [name,value]=owner.cookie.split('=');
  const cookies=[{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,secure:false,sameSite:'Lax'}];
  await owner.json('/reminders','POST',{feature:'mood',enabled:false});
  // Real SW registration must complete before onboarding too, with no permission request.
  const fresh=await browser.newContext();
  try {
    const page=await fresh.newPage();await page.goto(base+'/');await page.waitForSelector('#v-hello.on');
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('/app/'))?.active);
    assert.equal(await page.evaluate(()=>Notification.permission),'default');
  } finally {await fresh.close();}

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
    assert.ok(await page.getByRole('button',{name:'Настроить уведомления',exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),0);
    await page.getByRole('button',{name:'Настроить уведомления',exact:true}).click();
    const mood=page.locator('#rem-all [data-rem=mood]');await mood.getByRole('switch').waitFor();
    await mood.getByRole('switch').click();
    await page.waitForFunction(()=>window.__pushQA.requests===1 && !document.querySelector('#rem-all [data-rem=mood] [role=switch]').disabled);
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='mood').enabled,false,'Denied permission must not enable schedule');
    await page.evaluate(()=>window.__pushQA.result='granted');
    await mood.getByRole('switch').click();
    await page.waitForFunction(()=>document.querySelector('#rem-all [data-rem=mood] [role=switch]').getAttribute('aria-checked')==='true');
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),2);
    await mood.getByRole('button',{name:/Время и регулярность/}).click();
    await mood.getByLabel('Время уведомления').fill('19:47');await mood.getByLabel('Время уведомления').blur();
    await page.waitForFunction(()=>S.rem.mood.time==='19:47');
    await mood.getByRole('button',{name:'Раз в неделю',exact:true}).click();
    await mood.getByRole('button',{name:'Пт',exact:true}).click();
    await page.waitForFunction(()=>S.rem.mood.weekday===5);
    await mood.getByRole('button',{name:'Отправить пробное',exact:true}).click();
    await page.waitForFunction(()=>window.__pushQA.tests.length===1);
    await page.reload();await page.waitForSelector('#v-home.on');
    assert.ok(await page.locator('#push-invite').isHidden());
    await page.evaluate(()=>{go('account');openWidget('remind');});
    await page.waitForFunction(()=>S.rem?.mood?.time==='19:47');
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='mood').weekday,5);
    assert.equal(await page.evaluate(()=>window.__pushQA.requests),0,'Existing subscription reconnects without another prompt');
    await page.locator('.wg-x').click();
    const cases=[['today','habits','habits'],['history','hmood','moodreport'],['today','mood','mood'],['today','askesis','askesis'],['today','gratitude','gratitude'],['around','sky','sky'],['around','lunar','lunar']];
    for(const [view,key,feature] of cases){
      await page.evaluate(v=>go(v),view);
      await page.locator(`#v-${view} button[onclick="openWidget('${key}')"]`).click();
      const rem=page.locator(`#wg-tools [data-rem=${feature}]`);
      await rem.getByRole('button',{name:/Время и регулярность/}).waitFor();
      await rem.getByRole('button',{name:/Время и регулярность/}).click();
      await rem.getByLabel('Время уведомления').waitFor();
      await rem.getByRole('button',{name:'Отправить пробное',exact:true}).click();
      await page.waitForFunction(f=>window.__pushQA.tests.some(t=>t.feature===f),feature);
      const share=page.locator('#wg-body').getByRole('button',{name:'Поделиться',exact:true}).first();
      await share.click();
      assert.ok((await page.evaluate(()=>window.__pushQA.shared.at(-1))).includes('Лунарио'));
      for(const [width,height] of [[320,568],[844,390],[1440,900]]){
        await page.setViewportSize({width,height});
        await rem.getByLabel('Время уведомления').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        assert.ok(await rem.getByLabel('Время уведомления').isVisible());
      }
      await page.locator('.wg-x').click();
    }
    for(const [,key,feature] of cases){
      await page.goto(base+'/?open='+feature);
      await page.waitForSelector('#wg.on #w-'+key);
      await page.locator('#wg-tools [data-rem='+feature+']').getByRole('button',{name:/Время и регулярность/}).waitFor();
    }
    assert.deepEqual(errors,[]);
    // Another account/device having a subscription must not suppress a permission prompt.
    await ctx.clearCookies();const [otherName,otherValue]=other.cookie.split('=');
    await ctx.addCookies([{...cookies[0],name:otherName,value:otherValue}]);
    await other.json('/profile','POST',{name:'Другое устройство',birth:'1990-01-01',city:'Москва',consent:true});
    await other.json('/push','POST',{endpoint:'https://push.invalid/different-device'});
    await page.evaluate(()=>{localStorage.removeItem('_qa_sub');localStorage.removeItem('_qa_perm');});
    await page.reload();await page.waitForSelector('#v-home.on');
    assert.ok(await page.locator('#push-invite').isVisible(),'Invitation dismissal belongs to one account');
    await page.evaluate(()=>{go('account');openWidget('remind');});
    await page.waitForFunction(()=>!!S.rem);
    assert.equal(await page.evaluate(()=>S.pushOn),false);
    console.log('PASS: notification invitation, denied/granted permission, current-device subscription, seven feature controls/share/test, saved weekly schedule and responsive layouts. No real push sent.');
  } finally {await ctx.close();}
  // Native bridge contract: denied permission does not create a schedule; the test
  // action gets the same backend message and link as web push. No iOS device here.
  const native=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    await native.addCookies(cookies);
    await owner.json('/reminders','POST',{feature:'gratitude',enabled:false});
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
    const rem=page.locator('#rem-all [data-rem=gratitude]');await rem.getByRole('switch').waitFor();
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='notificationPermission')&&!document.querySelector('#rem-all [data-rem=gratitude] [role=switch]').disabled);
    assert.equal((await owner.json('/reminders')).items.find(r=>r.feature==='gratitude').enabled,false);
    await page.evaluate(()=>window.__nativeQA.allowed=true);
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='schedule'&&r.id==='gratitude'&&r.on));
    await rem.getByRole('button',{name:'Отправить пробное',exact:true}).click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='notificationTest'));
    const test=await page.evaluate(()=>window.__nativeQA.requests.find(r=>r.type==='notificationTest'));
    assert.equal(test.url,'/app/?open=gratitude');assert.ok(test.title);
    await rem.getByRole('switch').click();
    await page.waitForFunction(()=>window.__nativeQA.requests.some(r=>r.type==='schedule'&&r.id==='gratitude'&&!r.on));
    console.log('PASS: native permission, schedule acknowledgement, disable, feature test message and destination (bridge simulated).');
  } finally {await native.close();}
}
