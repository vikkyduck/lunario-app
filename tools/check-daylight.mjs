import assert from 'node:assert/strict';

// Isolated synthetic account. Clock control affects only this test document.
export async function checkDaylight({browser,base,owner}) {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');
  await context.addCookies([{name,value,domain:'127.0.0.1',path:'/app'}]);
  await context.addInitScript(()=>{
    window.brandTestTime=0;
    Object.defineProperty(performance,'now',{value:()=>window.brandTestTime,configurable:true});
  });
  const page=await context.newPage();
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  assert.ok((luminance([240,237,248])+.05)/(luminance([42,33,80])+.05)>12,'Readable indigo text/icons on pale lilac');
  try {
    await page.goto(base+'/');await page.locator('#v-home.on').waitFor();
    await page.evaluate(()=>{applyTheme('light');go('history');});
    await page.locator('.timeline-entry').first().waitFor();
    for(const [width,height] of [[390,844],[1440,900]]) {
      await page.setViewportSize({width,height});
      const state=await page.evaluate(()=>{
        const nav=document.querySelector('.app-nav'),s=getComputedStyle(nav),r=nav.getBoundingClientRect();
        const entry=document.querySelector('.timeline-entry'),cs=getComputedStyle(entry);
        return {position:s.position,navBottom:r.bottom,navTop:r.top,height:innerHeight,
          text:getComputedStyle(document.body).color,icons:[...nav.querySelectorAll('.ico')].map(e=>getComputedStyle(e).backgroundColor),
          base:cs.backgroundColor,navBase:s.backgroundColor,glass:cs.backdropFilter,fill:cs.backgroundImage,shadow:cs.boxShadow,edge:getComputedStyle(entry,'::before').backgroundImage};
      });
      assert.equal(state.position,'fixed');assert.ok(state.navBottom<=height&&state.navTop>=0,'Navigation stays in view');
      assert.equal(state.text,'rgb(29, 23, 56)');assert.ok(state.icons.every(c=>c==='rgb(42, 33, 80)'));
      assert.equal(state.base,'rgb(245, 242, 234)');assert.equal(state.navBase,state.base);assert.equal(state.glass,'none');assert.match(state.fill,/0\.96/);assert.equal((state.fill.match(/linear-gradient/g)||[]).length,2);assert.match(state.edge,/conic-gradient/);assert.notEqual(state.shadow,'none');
    }
    const pixels=async()=>page.locator('.section-brand canvas').evaluate(cv=>{
      const ctx=cv.getContext('2d'),p=ctx.getImageData(0,0,cv.width,cv.height).data;
      let opaque=0,alpha=0;for(let i=3;i<p.length;i+=4){alpha+=p[i];if(p[i]>128)opaque++;}
      return {opaque,alpha,center:[...ctx.getImageData(cv.width/2,cv.height/2,1,1).data]};
    });
    // With t0=0, these clock offsets place the logo exactly at full/new moon.
    await page.evaluate(()=>{window.brandTestTime=1760;window.refreshMoonLogos();});
    const full=await pixels();
    await page.evaluate(()=>{window.brandTestTime=12760;window.refreshMoonLogos();});
    const dark=await pixels();
    assert.deepEqual(dark.center,[42,33,80,255]);
    assert.ok(full.alpha<dark.alpha*.015,'Full illuminated disc opens onto the actual background');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>applyTheme('light'));const lightStill=await pixels();
    await page.evaluate(()=>applyTheme('dark'));const nightStill=await pixels();
    assert.ok(nightStill.alpha>lightStill.alpha*2,'Theme switches redraw even with animation disabled');
    await page.evaluate(()=>applyTheme('light'));
    assert.equal(await page.locator('.timeline-entry').first().evaluate(e=>getComputedStyle(e,'::after').display),'none');
    console.log('PASS: lilac/indigo contrast, fixed navigation and readable icons, dense two-layer diary glass without blur, full-moon cutout, immediate theme redraw under reduced motion.');
  } finally {await context.close();}
}
