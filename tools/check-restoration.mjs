import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkRestoration({browser,base,owner}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const [name,value]=owner.cookie.split('=');await context.addCookies([{name,value,domain:'127.0.0.1',path:'/app'}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const folder=process.env.LUNARIO_QA_DIR;
  const shot=async label=>{if(folder){await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,'restored-'+label+'.png'),fullPage:true});}};
  const close=async()=>{await page.locator('.wg-x').click();await page.locator('#wg').waitFor({state:'hidden'});};
  try{
    const q='Как мне подготовиться к разговору о новой работе?';
    await owner.json('/ask','POST',{kind:'yesno',question:q});
    const card=(await owner.json('/card','POST')).card;
    const catalogue=await owner.json('/catalog');
    // The isolated server deliberately has no editorial content directory.
    // Supply a complete sample card to verify every section of the renderer.
    const full={...catalogue.cards.find(c=>c.slug===card.slug),
      question:'Какой первый шаг я готова сделать сегодня?',
      sections:{image:['Образ тестовой карты.'],spread:['Карта в тестовом раскладе.'],state:['Состояние человека.'],shadow:['Теневая сторона карты.'],advice:['Совет тестовой карты.']}};
    await context.route('**/api/catalog*',route=>route.fulfill({json:{...catalogue,cards:catalogue.cards.map(c=>c.slug===full.slug?full:c)}}));
    await page.goto(base+'/');await page.locator('#v-home.on').waitFor();
    const me=await owner.json('/me');assert.equal(await page.locator("#h-wish").textContent(),me.day.set.text);assert.ok(me.day.theme&&me.day.set.question,"настрой и вопрос — по теме дня");
    await page.evaluate(()=>go('ask'));await page.locator('[data-feature=worry]').click();
    await page.locator('#hub-chips button').first().waitFor();
    assert.equal(await page.locator('#hub-questions').count(),0,'no preset questions any more');
    assert.equal(await page.locator('#hub-chips button').count(),6);
    assert.ok(await page.locator('#hub-opts').isVisible()&&await page.locator('#hub-go').isDisabled(),'instruments are visible right away, the button waits for a question');
    await page.locator('#hub-q').fill('Работа');assert.ok(await page.locator('#hub-go').isDisabled());assert.match(await page.locator('#hub-hint').innerText(),/Напишите вопрос целиком/);
    await page.locator('#hub-chips button').first().click();assert.equal(await page.locator('#hub-q').inputValue(),'Что мне сейчас важно в отношениях?','a short own text is replaced by the topic question');
    const edited='Что мне сейчас важно в отношениях? Что мне важно понять?';await page.locator('#hub-q').fill(edited);assert.ok(await page.locator('#hub-go').isEnabled());assert.equal(await page.locator('#hub-hint').innerText(),'');
    await page.locator('#hub-chips button').nth(1).click();assert.equal(await page.locator('#hub-q').inputValue(),edited,'a full own question survives a topic switch');
    await close();await page.locator('[data-feature=worry]').click();assert.equal(await page.locator('#hub-q').inputValue(),edited);
    await page.locator('#hub-go').click();await page.locator('#hub-res .card').first().waitFor();
    assert.ok((await owner.json('/entries?kind=questions')).items.some(i=>i.question===edited));
    await shot('topics-and-questions');await close();
    await page.evaluate(()=>go('ask'));await page.locator('[data-feature=hentries]').click();await page.locator('#m-entries .hist').first().waitFor();
    assert.ok((await page.locator('#m-entries').innerText()).includes(q));
    assert.ok((await page.locator('#m-entries').innerText()).includes(edited));
    assert.ok(!(await page.locator('#m-entries').innerText()).includes('Карта дня'));
    await shot('questions-history');
    await page.getByRole('tab',{name:'Карты дня',exact:true}).click();await page.locator('#m-entries .hist').first().waitFor();
    assert.ok((await page.locator('#m-entries').innerText()).includes(card.name));
    await page.locator('#m-entries .histhead').first().click();await page.locator('#m-entries .card-question').waitFor();
    assert.equal(await page.locator('#m-entries .card-question p').innerText(),full.question);
    assert.ok(await page.locator('#m-entries .morebody').isHidden());
    await page.locator('#m-entries .morebtn').click();
    for(const texts of Object.values(full.sections||{}))for(const text of texts)assert.ok((await page.locator('#m-entries').innerText()).includes(text),'Full card section retained');
    await shot('card-details');
    for(const width of [320,390,844,1440]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await close();await page.evaluate(()=>openWidget('worry'));await page.locator('#hub-questions button').first().waitFor();
      assert.ok(await page.locator('#w-worry').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Prompt chips fit at '+width);
      await close();await page.evaluate(()=>openWidget('hentries'));await page.locator('#m-entries .hist').first().waitFor();
    }
    await close();await page.reload();await page.locator('#v-home.on').waitFor();
    assert.equal(await page.locator('#h-wish').textContent(),me.day.set.text);
    assert.equal((await owner.json('/entries?kind=questions')).items.length,2);
    assert.equal((await owner.json('/entries?kind=card')).items.length,1);
    assert.deepEqual(errors,[]);
    console.log('PASS: no shelf wording; named daily phrase including guest; catalogue questions/topics and editable drafts; saved questions separated from cards; full card content and question retained; 4 widths.');
  }finally{await context.close();}
}
