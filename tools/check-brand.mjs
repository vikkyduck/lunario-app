import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MOSCOW,observer,siderealDegrees,horizontal,visibleSky} from '../site/sky-model.js';
import {CONSTELLATIONS} from '../site/constellations.js';
import {checkDaylight} from './check-daylight.mjs';

// Independent astronomical boundary checks at J2000: published GMST and known meridian/horizon geometry.
const epoch=Date.parse('2000-01-01T12:00:00Z');
assert.ok(Math.abs(siderealDegrees(epoch,0)-280.46061837)<1e-8);
assert.deepEqual(observer(null),MOSCOW);
assert.deepEqual(observer({latitude:NaN,longitude:0}),MOSCOW);
assert.equal(observer({latitude:0,longitude:0}).source,'device');
const meridian=siderealDegrees(epoch,0)/15;
assert.ok(Math.abs(horizontal(meridian,0,{lat:0,lon:0},epoch).altitude-90)<1e-6);
assert.ok(horizontal((meridian+12)%24,0,{lat:0,lon:0},epoch).altitude < -89.99);
assert.ok(Math.abs(horizontal(0,90,MOSCOW,epoch).altitude-MOSCOW.lat)<1e-8);
assert.ok(horizontal(0,90,{lat:-34,lon:151},epoch).altitude<0);
const north=visibleSky(CONSTELLATIONS,MOSCOW,epoch);
const south=visibleSky(CONSTELLATIONS,{lat:-34,lon:151},epoch);
assert.notDeepEqual(north.map(c=>c.name),south.map(c=>c.name));
for(const c of [...north,...south])for(const p of c.stars.filter(Boolean))assert.ok(p.altitude>0 && Number.isFinite(p.azimuth));
console.log('PASS: sky time reference, zenith/nadir/pole geometry, hemisphere visibility, exact Moscow fallback.');

export async function checkBrand({browser,base,owner}) {
  const folder=process.env.LUNARIO_QA_DIR;
  if(folder)await mkdir(folder,{recursive:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Australia/Sydney',serviceWorkers:'block'});
  // Explicit denial must use Moscow, regardless of timezone. No real location permission is requested in tests.
  await context.addInitScript(()=>{
    Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){fail({code:1});}},configurable:true});
  });
  const [name,value]=owner.cookie.split('=');
  await context.addCookies([{name,value,domain:'127.0.0.1',path:'/app'}]);
  const page=await context.newPage(),errors=[],fonts=[],coverage=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/fonts\.google|fonts\.gstatic|prata/i.test(r.url()))fonts.push(r.url());});
  const ready=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled((document.querySelector('.view.on')?.getAnimations()||[]).map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const shot=async label=>{if(folder)await page.screenshot({path:join(folder,'brand-'+label+'.png'),fullPage:true});};
  try {
    await page.goto(base+'/');await page.locator('#v-home.on').waitFor();await ready();
    await page.waitForFunction(()=>document.querySelector('#sky').dataset.locationSource==='moscow');
    assert.ok((await page.locator('#sky').getAttribute('data-constellations')).length>0);
    for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390]]) {
      await page.setViewportSize({width,height});await page.evaluate(()=>go('home'));await ready();
      const geometry=await page.evaluate(()=>{
        const image=document.querySelector('.home-moon img'),moon=image.getBoundingClientRect(),text=document.querySelector('#h-wish').getBoundingClientRect();
        return {width:innerWidth,scroll:document.documentElement.scrollWidth,moon:{x:moon.x,y:moon.y,right:moon.right,bottom:moon.bottom,width:moon.width,height:moon.height},textRight:text.right,
          loaded:image.complete&&image.naturalWidth>0,font:getComputedStyle(document.querySelector('#h-wish')).fontFamily,
          clip:getComputedStyle(image).clipPath,mask:getComputedStyle(image.parentElement).maskImage};
      });
      assert.ok(geometry.loaded);assert.ok(geometry.scroll<=width+1);
      assert.ok(geometry.moon.x>=0 && geometry.moon.right<=width+1);
      assert.ok(geometry.moon.width<=280 && Math.abs(geometry.moon.width-geometry.moon.height)<1);
      assert.ok(geometry.textRight<=geometry.moon.x+1,'Text and moon occupy separate columns');
      assert.equal(geometry.clip,'none');assert.equal(geometry.mask,'none');assert.match(geometry.font,/Onest/);
      coverage.push({width,height,...geometry});await shot('home-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    for(const view of ['ask','history','about','account']) {
      await page.evaluate(v=>go(v),view);await ready();
      assert.ok(await page.locator('.section-brand').isVisible());
      const logo=await page.locator('.section-brand').evaluate(e=>({font:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight}));
      assert.match(logo.font,/Comfortaa/);assert.equal(logo.weight,'300');
      const font=await page.locator('#v-'+view+'>h1').evaluate(e=>getComputedStyle(e).fontFamily);assert.match(font,/Onest/);
    }
    await page.evaluate(()=>openWidget('habits'));await ready();assert.ok(await page.locator('.section-brand').isVisible());
    await page.evaluate(()=>go('home'));await page.evaluate(()=>openWidget('tone'));await ready();
    assert.ok(await page.locator('.widget-brand').isVisible());
    const c=page.locator('.widget-brand canvas'),before=await c.evaluate(e=>e.toDataURL());
    await page.waitForTimeout(1100);assert.notEqual(await c.evaluate(e=>e.toDataURL()),before);
    await page.emulateMedia({reducedMotion:'reduce'});await ready();await page.waitForTimeout(100);
    const still=await c.evaluate(e=>e.toDataURL());await page.waitForTimeout(1100);assert.equal(await c.evaluate(e=>e.toDataURL()),still);
    await shot('question');await page.evaluate(()=>closeWidget());await page.emulateMedia({reducedMotion:'no-preference'});
    for(const [width,height] of [[1440,900],[1050,900],[887,920],[768,1024],[600,900],[390,844],[320,568],[844,390]]) {
      await page.setViewportSize({width,height});await page.evaluate(()=>go('hello'));await ready();
      assert.ok(await page.locator('.heromoon img').evaluate(e=>e.complete&&e.naturalWidth>0));
      assert.ok(await page.locator('.heromoon').evaluate(e=>e.getBoundingClientRect().width<=650));
      const button=await page.locator('#v-hello .cta .btn').evaluate(e=>({color:getComputedStyle(e).color,glass:getComputedStyle(e).backdropFilter}));
      assert.equal(button.color,'rgb(245, 242, 234)');assert.equal(button.glass,'none');
      assert.match(await page.locator('#v-hello .cta .btn').evaluate(e=>getComputedStyle(e).backgroundImage),/0\.78/,'Dense welcome glass without backdrop filtering');
      const typography=await page.locator('#v-hello .gift b').first().evaluate(e=>({size:parseFloat(getComputedStyle(e).fontSize),weight:getComputedStyle(e).fontWeight}));
      assert.equal(typography.weight,'600');assert.ok(typography.size>=24,'Benefits stay readable on the narrowest phone');
      assert.ok(await page.locator('.welcome-primary').evaluate(e=>getComputedStyle(e,'::before').backgroundImage.startsWith('conic-gradient')));

      assert.equal(await page.locator('#v-hello .gift b').first().textContent(),'Замечать свое настроение');
      assert.ok(await page.locator('#v-hello .cta .btn').evaluate(e=>e.getBoundingClientRect().height>=70));
      assert.ok(await page.locator('#v-hello .gift b').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=22));
      const layout=await page.evaluate(()=>{
        const text=document.querySelector('#v-hello .hello-content').getBoundingClientRect(),moon=document.querySelector('#v-hello .heromoon').getBoundingClientRect();
        return {separate:text.right+24<=moon.left||moon.bottom+24<=text.top,overflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      assert.ok(layout.separate,'Welcome moon must not collide with copy or the main action at '+width);assert.equal(layout.overflow,false);
      await shot('welcome-'+width);
    }
    // The landing's moving edge responds to pointer position, with no effect under reduced motion.
    await page.setViewportSize({width:1440,height:900});await ready();
    const primary=page.locator('.welcome-primary');await primary.scrollIntoViewIfNeeded();
    const rect=await primary.boundingBox();
    await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.35);await page.waitForTimeout(60);
    const edge=await primary.evaluate(e=>e.style.getPropertyValue('--glass-edge'));assert.ok(edge.length>0);
    await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.6);await page.waitForTimeout(60);
    assert.notEqual(await primary.evaluate(e=>e.style.getPropertyValue('--glass-edge')),edge);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await primary.evaluate(e=>getComputedStyle(e,'::after').display),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    // Exercise both login steps without sending email. Catch the input/button collision from the screenshot.
    await page.route(base+'/api/auth/request',route=>route.fulfill({json:{ok:true}}));
    for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390]]) {
      await page.setViewportSize({width,height});await page.evaluate(()=>openLogin());await ready();
      for(const step of ['email','code']) {
        if(step==='code'){
          await page.locator('#auth-email').fill('layout@example.test');
          await page.locator('#l-box .auth-submit').click();
          await page.locator('#auth-code').waitFor();await ready();
        }
        const geometry=await page.locator('#l-box').evaluate(e=>{
          const field=e.querySelector('input').getBoundingClientRect(),button=e.querySelector('.auth-submit').getBoundingClientRect();
          return {gap:button.top-field.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};
        });
        assert.ok(geometry.gap>=24,step+' field and button need a clear gap');assert.equal(geometry.overflow,false);
        await page.locator('#l-box .auth-submit').scrollIntoViewIfNeeded();
        assert.ok(await page.locator('#l-box .auth-submit').isVisible());
        await shot('login-'+step+'-'+width);
      }
    }
    // Registration has a separate code panel. It must receive the same spacing as returning-user login.
    for(const [width,height] of [[887,920],[390,844],[320,568],[844,390]]){
      await page.setViewportSize({width,height});
      await page.evaluate(async()=>{openForm();obEmail='registration@example.test';await obSendCode();});
      await page.locator('#o-codebox').waitFor();await ready();
      const panel=await page.locator('#o-codebox').evaluate(e=>{
        const input=e.querySelector('input').getBoundingClientRect(),button=e.querySelector('.auth-submit').getBoundingClientRect();
        return {gap:button.top-input.bottom,border:parseFloat(getComputedStyle(e).borderWidth),overflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      assert.ok(panel.gap>=32,'Registration code input and action should be separate');assert.equal(panel.border,0);assert.equal(panel.overflow,false);
      await shot('registration-code-'+width);
    }
    await page.unroute(base+'/api/auth/request');
    await page.evaluate(()=>go('hello'));await ready();
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok){ok({coords:{latitude:-33.8688,longitude:151.2093}});}},configurable:true});
      return window.LunarioSky.locate(true);
    });
    assert.equal(await page.locator('#sky').getAttribute('data-location-source'),'device');
    const actual=await page.locator('#sky').getAttribute('data-constellations');
    assert.notEqual(actual,visibleSky(CONSTELLATIONS,MOSCOW,Date.now()).map(c=>c.name).join('|'));
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){fail({code:3});}},configurable:true});
      return window.LunarioSky.locate(true);
    });
    assert.equal(await page.locator('#sky').getAttribute('data-location-source'),'moscow');
    assert.deepEqual(fonts,[]);assert.deepEqual(errors,[]);
    if(folder)await writeFile(join(folder,'brand-coverage.json'),JSON.stringify({coverage,errors,fonts},null,2));
    console.log('PASS: Onest/Comfortaa, animated interior logos, reduced motion, unclipped moon, glass welcome, local fonts, device/Moscow geolocation in a foreign timezone.');
  } finally {await context.close();}
  await checkDaylight({browser,base,owner});
}
