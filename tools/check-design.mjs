/* Consumer interface audit with synthetic data; no messages leave the test backend. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkDesign({browser,base,owner}){
  const me=await owner.json('/me'),day=me.day.date;
  const until=new Date(Date.parse(day)+30*864e5).toISOString().slice(0,10);
  const askesis=(await owner.json('/askesis','POST',{title:'Без вечернего скроллинга',until})).active[0];
  await owner.json('/habits','POST',{title:'Прогулка',rule:'каждый день'});
  await owner.json('/journal','POST',{text:'Сегодня мне помогла прогулка. Хочу сохранить это ощущение.'});
  const ticket=await owner.json('/support/tickets','POST',{topic:'Другое',text:'Тестовый вопрос в изолированной базе'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');await ctx.addCookies([{name,value,domain:'127.0.0.1',path:'/app',httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[],coverage=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const folder=process.env.LUNARIO_QA_SHOTS;
  const shot=async label=>{if(folder){await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,'design-'+label+'.png'),fullPage:false});}};
  const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else if(await page.locator('#v-practice.on').count()){await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
  const ready=async()=>{await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity));};
  const fit=async label=>{
    const result=await page.evaluate(()=>{
      const sheet=document.querySelector('#wg.on .wg'),scope=sheet||document.querySelector('.view.on');
      return {page:document.documentElement.scrollWidth<=innerWidth+1,scope:scope.scrollWidth<=scope.clientWidth+1,
        unlabeled:[...scope.querySelectorAll('.field label')].filter(l=>l.getClientRects().length&&!l.control).map(l=>l.textContent)};
    });
    const forbiddenBlur=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getClientRects().length&&!e.matches('.toast,.wg-bg')).flatMap(e=>['', '::before', '::after'].filter(p=>{
      const s=getComputedStyle(e,p||null);return s.backdropFilter!=='none'||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none');
    }).map(p=>e.tagName+'.'+e.className+p)));
    assert.deepEqual(forbiddenBlur,[],label+' backdrop blur is reserved for toast and widget scrim');
    if(!result.page||!result.scope){await shot('overflow-'+label.replaceAll(' ','-'));console.log('OVERFLOW',label,await page.evaluate(()=>{const scope=document.querySelector('#wg.on .wg')||document.querySelector('.view.on');return {viewport:innerWidth,page:document.documentElement.scrollWidth,scope:scope.scrollWidth,width:scope.clientWidth,elements:[...scope.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth).map(e=>({element:e.tagName+'.'+e.className,box:e.getBoundingClientRect().toJSON()}))};}));}
    assert.ok(result.page&&result.scope,label+' horizontal overflow');assert.deepEqual(result.unlabeled,[],label+' label association');coverage.push(label);
  };
  try{
    await page.goto(base+'/');await page.locator('#v-home.on').waitFor();
    assert.equal(await page.locator('.toast').evaluate(e=>getComputedStyle(e).backdropFilter),'blur(18px)');
    assert.equal(await page.locator('.wg-bg').evaluate(e=>getComputedStyle(e).backdropFilter),'blur(14px)');
    await page.evaluate(()=>openWidget('askesis'));await page.locator('#as-box .observation').waitFor();
    await page.getByRole('button',{name:'Передвинуть дату',exact:true}).click();await page.locator('#ask-date').waitFor();
    assert.equal(await page.locator('#ask-date').inputValue(),until);
    await page.locator('#ask-date').fill('');await page.locator('#ask-date-save').click();assert.equal(await page.locator('#ask-date').getAttribute('aria-invalid'),'true');
    const changed=new Date(Date.parse(until)+7*864e5).toISOString().slice(0,10);
    await page.locator('#ask-date').fill(changed);await page.locator('#ask-date-save').click();await page.locator('#wg').waitFor({state:'hidden'});
    assert.equal((await owner.json('/askesis')).active.find(a=>a.id===askesis.id).until,changed);await close();

    await page.evaluate(()=>openWidget('support'));await page.locator('#sup-text').waitFor();await page.evaluate(id=>supThread(id),ticket.id);await page.locator('#sup-reply').waitFor();
    await page.locator('#sup-reply').fill('Несохранённый ответ');await page.locator('#sup-reply').focus();
    await page.evaluate(id=>supThread(id),ticket.id);
    assert.equal(await page.locator('#sup-reply').inputValue(),'Несохранённый ответ');assert.ok(await page.locator('#sup-reply').evaluate(e=>e===document.activeElement));
    await page.route('**/api/support/ticket?*',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
    await page.evaluate(id=>supThread(id),ticket.id);assert.equal(await page.locator('#sup-reply').inputValue(),'Несохранённый ответ');await page.unroute('**/api/support/ticket?*');
    await close();await page.evaluate(()=>openWidget('support'));await page.locator('#sup-text').waitFor();await page.evaluate(id=>supThread(id),ticket.id);await page.locator('#sup-reply').waitFor();assert.equal(await page.locator('#sup-reply').inputValue(),'Несохранённый ответ');await close();

    const panes=['card','mood','worry','day','tone','gratitude','journal','habits','askesis','wishes','sky','lunar','hmood','hentries','week','year','birthnum','compat','natal','edit','remind','mail','support','invite','appinfo','terms','tools','appearance'];
    for(const theme of ['light','dark'])for(const [width,height] of [[320,568],[390,844],[1440,900]]){
      await page.setViewportSize({width,height});await page.evaluate(t=>applyTheme(t),theme);
      for(const view of ['home','ask','history','about','account','news']){
        await page.evaluate(v=>{XP.scroll[v]=0;go(v);},view);await ready();await fit(theme+' '+width+' '+view);
        assert.equal(await page.locator('.app-nav [aria-current=page]').count(),['account','news'].includes(view)?0:1);   /* аккаунт и новости — не вкладки */
        if(width!==320)await shot(theme+'-'+width+'-'+view);
      }
      for(const key of panes){
        await page.evaluate(k=>openWidget(k),key);await ready();await fit(theme+' '+width+' '+key);
        if(key==='appearance'){
          assert.ok(await page.locator('#theme-state').isHidden(),'No empty saved-state frame');
          assert.equal(await page.locator('.theme-option.dark>span').evaluate(e=>getComputedStyle(e).color),'rgb(245, 242, 234)');
        }
        if(key==='remind')assert.ok(await page.locator('.rem-head .sw').first().evaluate(e=>e.getBoundingClientRect().height>=44),'Switch has a usable touch target');
        if(width===390&&['mood','habits','askesis','journal','tone','remind','edit','appearance','wishes'].includes(key))await shot(theme+'-'+key);
        if(['appearance','tools'].includes(key)&&width<760){const rect=await page.locator('.wg').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=height+1,'short sheet fits '+key);}
        await close();
      }
      for(const mode of ['yesno','rune','spread']){await page.evaluate(m=>openAsk(m),mode);await page.locator('#a-q').waitFor();await ready();await fit(theme+' '+width+' '+mode);await close();}
    }
    await page.setViewportSize({width:320,height:568});await page.evaluate(()=>go('onb'));await ready();await fit('onboarding');
    assert.ok(await page.locator('#o-form .field label').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=15));await shot('onboarding');
    await page.evaluate(()=>go('hello'));await ready();await fit('welcome');assert.ok(await page.locator('.heromoon img').evaluate(e=>e.complete&&e.naturalWidth>0));await shot('welcome');
    await page.evaluate(()=>openLogin());await ready();await fit('email login');await shot('login');
    await page.evaluate(()=>go('home'));await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-feature=habits]').hover();assert.equal(await page.locator('[data-feature=habits]').evaluate(e=>getComputedStyle(e).transform),'none');
    assert.deepEqual(errors,[]);
    if(folder)await writeFile(join(folder,'design-coverage.json'),JSON.stringify({coverage,errors},null,2));
    console.log('PASS: '+coverage.length+' design screens in both themes; associated labels, no horizontal overflow, short settings, editable askesis date, support draft/caret across refresh and failure, all original destinations, reduced motion.');
  }finally{await ctx.close();}
}
