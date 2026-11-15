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
    /* «Дневник» с 02.10 (a27a29a) — строки дней .day-row вместо карточек ленты .timeline-entry со стеклом; сверяем то, что важно
       и сейчас: навигация на месте, текст и значки читаются на светлом, строка дня контрастна */
    await page.locator('.day-row').first().waitFor();
    for(const [width,height] of [[390,844],[1440,900]]) {
      await page.setViewportSize({width,height});
      const state=await page.evaluate(()=>{
        const nav=document.querySelector('.app-nav'),s=getComputedStyle(nav),r=nav.getBoundingClientRect();
        const row=document.querySelector('.day-row'),label=row.querySelector('p')||row;
        /* фон строки — первый непрозрачный снизу вверх (строка может быть прозрачной поверх страницы) */
        let bgEl=row,bg='rgba(0, 0, 0, 0)';while(bgEl&&/rgba\(0, 0, 0, 0\)|transparent/.test(bg)){bg=getComputedStyle(bgEl).backgroundColor;bgEl=bgEl.parentElement;}
        return {position:s.position,navBottom:r.bottom,navTop:r.top,height:innerHeight,
          text:getComputedStyle(document.body).color,icons:[...nav.querySelectorAll('.ico')].map(e=>getComputedStyle(e).backgroundColor),
          rowText:getComputedStyle(label).color,rowBg:bg,glass:getComputedStyle(row).backdropFilter};
      });
      assert.equal(state.position,'fixed');assert.ok(state.navBottom<=height&&state.navTop>=0,'Navigation stays in view');
      assert.equal(state.text,'rgb(29, 23, 56)');assert.ok(state.icons.every(c=>c==='rgb(42, 33, 80)'));
      const rgb=(c)=>(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
      const ratio=(a,b)=>{const [x,y]=[luminance(rgb(a)),luminance(rgb(b))].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
      assert.ok(ratio(state.rowText,state.rowBg)>=4.5,`Diary row text is readable on its background (${state.rowText} on ${state.rowBg})`);assert.equal(state.glass,'none','No blur on diary rows');
    }
    /* логотип раздела скрыт («одна шапка», v65), а скрытые холсты moon-logo.js не перерисовывает — берем видимый знак Лунарио на «Сегодня» */
    await page.evaluate(()=>go('home'));
    const pixels=async()=>page.evaluate(()=>{
      const cv=[...document.querySelectorAll('canvas[data-brand-moon]')].find(c=>c.offsetParent);
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
    await page.evaluate(()=>go('history'));await page.locator('.day-row').first().waitFor();
    /* слой поверх строки появляется только с content — display у пустого ::after (общее правило кнопок) ни на что не влияет */
    const after=await page.locator('.day-row').first().evaluate(e=>{const a=getComputedStyle(e,'::after');return {content:a.content,display:a.display};});
    assert.ok(after.content==='none'||after.content==='normal'||after.display==='none','No decorative overlay on diary rows in the light theme: '+JSON.stringify(after));
    console.log('PASS: lilac/indigo contrast, fixed navigation and readable icons, readable diary rows without blur, full-moon cutout, immediate theme redraw under reduced motion.');
  } finally {await context.close();}
}
