import {chromium,webkit,firefox} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SWIPE_BASE||'http://127.0.0.1:5039/app/';
for(const engine of [chromium,webkit,firefox]){
  const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.SWIPE_CHROME?{channel:'chrome'}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
    if(new URL(base).hostname==='127.0.0.1'){
      await page.request.get(base+'api/me');
      const cookies=await page.context().cookies();await page.context().addCookies(cookies.map(c=>({...c,secure:false})));
      const profile=await page.request.post(base+'api/profile',{data:{name:'Swipe QA',birth:'1990-01-01',city:'Москва',consent:true}});assert.equal(profile.status(),200);
      await page.context().addCookies((await page.context().cookies()).map(c=>({...c,secure:false})));
    }
    await page.route('**/api/event',r=>r.fulfill({json:{ok:true}}));
    await page.goto(base,{waitUntil:'networkidle'});await page.waitForSelector('#v-hello.on,#v-home.on');await page.evaluate(()=>go('about'));await page.waitForTimeout(350);
    const active=()=>page.locator('.view.on').getAttribute('id');
    const drag=async(right)=>{await page.mouse.move(right?55:330,170);await page.mouse.down();await page.mouse.move(right?330:55,173,{steps:20});await page.mouse.up();await page.waitForTimeout(300);};
    for(const v of ['ask','history','home']){await drag(true);assert.equal(await active(),'v-'+v,engine.name()+' mouse right');}
    for(const v of ['history','ask','about']){await drag(false);assert.equal(await active(),'v-'+v,engine.name()+' mouse left');}
    await page.mouse.move(200,160);
    for(let i=0;i<30;i++)await page.mouse.wheel(-4,0);
    assert.equal(await active(),'v-ask','small wheel deltas accumulate; inertia changes only one section');
    await page.waitForTimeout(350);
    await page.mouse.wheel(0,150);assert.equal(await active(),'v-ask','vertical wheel does not switch');
    await page.evaluate(()=>go('about'));
    // Chromium exposes native touch injection. Other engines run their actual TouchEvent handlers.
    const cdp=engine===chromium?await page.context().newCDPSession(page):null;
    async function touch(right,vertical=false){
      const x0=right?55:330,x1=vertical?x0+3:right?330:55,y0=170,y1=vertical?350:173;
      if(cdp){for(let i=0;i<=16;i++)await cdp.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{x:x0+(x1-x0)*i/16,y:y0+(y1-y0)*i/16}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      else await page.evaluate(({x0,x1,y0,y1})=>{const el=document.elementFromPoint(x0,y0);function fire(type,x,y,end=false){const t={identifier:1,target:el,clientX:x,clientY:y},e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:end?[]:[t]},changedTouches:{value:[t]}});el.dispatchEvent(e);}fire('touchstart',x0,y0);fire('touchmove',x1,y1);fire('touchend',x1,y1,true);},{x0,x1,y0,y1});
      await page.waitForTimeout(300);
    }
    for(const v of ['ask','history','home']){await touch(true);assert.equal(await active(),'v-'+v,engine.name()+' touch right');}
    for(const v of ['history','ask','about']){await touch(false);assert.equal(await active(),'v-'+v,engine.name()+' touch left');}
    await touch(true,true);assert.equal(await active(),'v-about','vertical touch stays');
    console.log('PASS '+engine.name()+': 12 transitions, mouse, touch, small trackpad deltas, inertia, vertical scrolling');
  }finally{await browser.close();}
}
