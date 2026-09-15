/* Integration check: real HTTP handlers + SQLite, synthetic accounts only.
   node >=22.5 tools/check-personal-features.mjs
   No production data, credentials, email or notification delivery is used. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), 'lunario-personal-features-'));
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/app`;
let server, log = '';

async function start() {
  server = spawn(process.execPath, [join(fixture, 'backend/server.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app',
      DATA_DIR: join(fixture, 'data'), CONTENT_DIR: join(fixture, 'content'),
      BACKUP_DIR: join(fixture, 'backups'), SITE_DIR: join(repo, 'site'), PUBLIC_BASE: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { log += data; });
  server.stderr.on('data', data => { log += data; });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Test server stopped: ${log}`);
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`Test server did not start: ${log}`);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exit = once(server, 'exit'); server.kill('SIGTERM'); await exit;
}
function account() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async raw(path, method = 'GET', data) {
      const r = await fetch(base + '/api' + path, { method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return r;
    },
    async json(path, method = 'GET', data) {
      const r = await this.raw(path, method, data); const body = await r.json();
      assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(body)}`); return body;
    },
  };
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=';
const photo = `data:image/png;base64,${png}`;

try {
  await cp(join(repo, 'backend'), join(fixture, 'backend'), { recursive: true,
    filter: path => !path.endsWith('.db') && !path.endsWith('.db-wal') && !path.endsWith('.db-shm') });
  await mkdir(join(fixture, 'content'));
  await mkdir(join(fixture, 'data'));
  // Deterministic tiny city catalogue; the untracked production catalogue is never read.
  const cities = new DatabaseSync(join(fixture, 'backend/cities.db'));
  cities.exec(`CREATE TABLE cities (name TEXT, region TEXT, country TEXT, lat REAL, lon REAL, tz TEXT, pop INTEGER, norm TEXT, w2 TEXT, alt TEXT);
    INSERT INTO cities VALUES ('Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow');`);
  cities.close();
  await start();
  const owner = account(); const other = account();
  await owner.json('/me'); await other.json('/me');
  await owner.json('/profile', 'POST', { name: 'Проверка сохранения', birth: '1990-01-01', city: 'Москва', consent: true });
  const day = (await owner.json('/me')).day.date;
  const until = new Date(Date.parse(day) + 14 * 864e5).toISOString().slice(0, 10);
  await owner.json('/photo', 'POST', { photo });
  const wish = (await owner.json('/wishes', 'POST', { text: 'Тест: поездка к морю' })).items[0];
  await owner.json('/wishes/photo', 'POST', { id: wish.id, photo });
  await owner.json('/wishes', 'PATCH', { id: wish.id });
  const habit = (await owner.json('/habits', 'POST', { title: 'Тест: прогулка', rule: 'каждый день' })).items[0];
  await owner.json('/habits', 'PATCH', { id: habit.id, day });
  const askesis = (await owner.json('/askesis', 'POST', { title: 'Тест: без вечернего скроллинга', until })).active[0];
  await owner.json('/askesis', 'PATCH', { id: askesis.id, note: 'Тест: вечер прошёл спокойно' });
  await owner.json('/journal', 'POST', { text: 'Тест: запись в дневнике' });
  await owner.json('/mood', 'POST', { mood: 'joy' });

  // Access boundaries: another account cannot read or replace these records.
  assert.equal((await other.json('/wishes')).items.length, 0);
  assert.equal((await other.json('/habits')).items.length, 0);
  assert.equal((await other.json('/askesis')).active.length, 0);
  assert.equal((await other.raw(`/wishes/photo?id=${wish.id}`)).status, 404);
  assert.equal((await other.raw('/wishes/photo', 'POST', { id: wish.id, photo })).status, 404);
  assert.equal((await other.raw('/habits', 'PATCH', { id: habit.id, day })).status, 404);
  assert.equal((await other.raw('/askesis', 'PATCH', { id: askesis.id, note: 'Чужая запись' })).status, 404);

  const prefs={theme:'dark',ritual:['tone','journal']};
  await owner.json('/preferences','POST',prefs);
  assert.deepEqual((await owner.json('/me')).preferences,prefs);
  assert.equal((await other.json('/preferences')).preferences.theme,'dark');
  for(const ritual of [[],['tone'],['tone','tone'],['tone','unknown'],['card','mood','tone','journal']])assert.equal((await owner.raw('/preferences','POST',{theme:'dark',ritual})).status,400);
  const wishesBefore=(await owner.json('/wishes')).items.length;
  assert.equal((await owner.raw('/wishes','POST',{text:'Неверное фото',photo:'not-an-image'})).status,400);
  assert.equal((await owner.json('/wishes')).items.length,wishesBefore,'No orphan wish when its photo is invalid');
  const timelineOwner=account();await timelineOwner.json('/me');
  for(let i=0;i<65;i++)await timelineOwner.json('/journal','POST',{text:'Строка '+i,kind:i%2?'answer':'gratitude'});
  const first=(await timelineOwner.json('/timeline'));const second=(await timelineOwner.json('/timeline?offset='+first.next));
  assert.equal(first.items.length,60);assert.equal(second.items.length,5);assert.equal(second.next,null);
  assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,65);
  assert.ok((await timelineOwner.json('/timeline?kind=answer')).items.every(i=>i.kind==='answer'));
  assert.equal((await other.json('/timeline')).items.length,0);
  const ownTimeline=await owner.json('/timeline?day='+day);assert.ok(ownTimeline.items.some(i=>i.body==='Тест: запись в дневнике'));
  assert.ok(ownTimeline.items.some(i=>i.source==='askesis'));assert.ok(ownTimeline.items.some(i=>i.source==='habit'));
  console.log('PASS: validated account preferences; private filtered/paginated timeline; invalid photo creates no wish.');

  // A real process restart also verifies that session and encryption keys survive.
  await stop(); await start();
  const me = await owner.json('/me');
  assert.equal(me.user.name, 'Проверка сохранения'); assert.equal(me.user.photo, true);
  assert.equal(me.mood, 'joy');assert.deepEqual(me.preferences,prefs);assert.deepEqual((await owner.json('/data/export')).preferences,prefs);
  const savedWish = (await owner.json('/wishes')).items.find(x => x.id === wish.id);
  assert.equal(savedWish.text, 'Тест: поездка к морю'); assert.equal(savedWish.done, 1); assert.equal(savedWish.photo, true);
  for (const path of ['/photo', `/wishes/photo?id=${wish.id}`]) {
    const r = await owner.raw(path); assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'), png, `${path}: unchanged image bytes`);
  }
  const savedHabit = (await owner.json('/habits')).items.find(x => x.id === habit.id);
  assert.equal(savedHabit.title, 'Тест: прогулка'); assert.equal(savedHabit.today, true);
  assert.ok(savedHabit.week.some(x => x.day === day && x.done));
  const savedAskesis = (await owner.json('/askesis')).active.find(x => x.id === askesis.id);
  assert.equal(savedAskesis.title, 'Тест: без вечернего скроллинга'); assert.equal(savedAskesis.until, until);
  assert.equal(savedAskesis.today.text, 'Тест: вечер прошёл спокойно');
  assert.equal((await owner.json('/journal')).items[0].text, 'Тест: запись в дневнике');
  // Editing a habit must preserve its completion history.
  const edited = (await owner.json('/habits', 'PATCH', { id: habit.id, title: 'Тест: прогулка вечером', rule: 'каждый день' })).items.find(x => x.id === habit.id);
  assert.equal(edited.title, 'Тест: прогулка вечером'); assert.equal(edited.today, true);
  console.log('PASS: profile photo, wish photo and completion, habit history, askesis dates and notes, diary, mood survive a real server restart. Account isolation verified.');
  // Practices and reminders use the same persisted data as the visible cards.
  const longDate = new Date(Date.parse(day) + 1500 * 864e5).toISOString().slice(0,10);
  const longAskesis = (await owner.json('/askesis','POST',{title:'Без шоппинга, мой срок',until:longDate})).active.find(a=>a.until===longDate);
  assert.ok(longAskesis); assert.equal(longAskesis.notes.length,0);
  assert.equal((await owner.raw('/askesis','POST',{title:'Недействительная дата',until:'2099-02-31'})).status,400);
  const free = (await owner.json('/habits','POST',{title:'Мой ритуал',rule:'когда хочется'})).items.find(h=>h.title==='Мой ритуал');
  assert.equal(free.rule,'free'); assert.equal(free.ruleText,'когда хочется');
  const long = (await owner.json('/habits','POST',{title:'Большой интервал',rule:'каждые 100 дней'})).items.find(h=>h.title==='Большой интервал');
  assert.equal(long.rule,'every:100');
  const qaDB = new DatabaseSync(join(fixture,'data/app.db'));
  qaDB.exec('PRAGMA busy_timeout=5000');
  for (const milestone of [30,60,90,180,365]) {
    const h=(await owner.json('/habits','POST',{title:'Ежедневно '+milestone,rule:'каждый день'})).items.find(h=>h.title==='Ежедневно '+milestone);
    qaDB.prepare('UPDATE habits SET created_at=? WHERE id=?').run(new Date(Date.parse(day)-(milestone-1)*864e5).toISOString(),h.id);
    const add=qaDB.prepare('INSERT INTO habit_marks(habit_id,day) VALUES(?,?)');
    for(let i=1;i<milestone;i++)add.run(h.id,new Date(Date.parse(day)-i*864e5).toISOString().slice(0,10));
    const result=await owner.json('/habits','PATCH',{id:h.id});
    assert.equal(result.award?.days,milestone);
    await owner.json('/habits','PATCH',{id:h.id});
    assert.equal((await owner.json('/habits','PATCH',{id:h.id})).award,null,'A milestone is awarded once');
  }
  const weekly=(await owner.json('/habits','POST',{title:'Еженедельно',rule:'раз в неделю'})).items.find(h=>h.title==='Еженедельно');
  for(let i=1;i<365;i++)qaDB.prepare('INSERT INTO habit_marks(habit_id,day) VALUES(?,?)').run(weekly.id,new Date(Date.parse(day)-i*864e5).toISOString().slice(0,10));
  assert.equal((await owner.json('/habits','PATCH',{id:weekly.id})).award,null,'Non-daily habits get no daily milestone');
  const schedule=(await owner.json('/reminders','POST',{feature:'askesis',enabled:true,freq:'weekly',weekday:5,time:'20:40',tz:'Europe/Moscow'})).item;
  assert.equal(schedule.freq,'weekly'); assert.equal(schedule.time,'20:40'); assert.equal(schedule.weekday,5); assert.ok(schedule.nextAt);
  const reminders=await import(pathToFileURL(join(fixture,'backend/reminders.mjs')));
  const asc=await owner.json('/askesis');
  const worker=await import(pathToFileURL(join(fixture,'backend/send-daily.mjs')));
  worker.initScheduledReminders(qaDB,join(fixture,'data'));
  const person=qaDB.prepare('SELECT id,name FROM users WHERE name=?').get('Проверка сохранения');
  const plan=await owner.json('/reminders/askesis-plan');
  assert.equal(plan.items.length,14);
  assert.ok(plan.items.every(item=>new Date(item.date+'T12:00:00Z').getUTCDay()===5));
  assert.equal(Date.parse(plan.items[1].date)-Date.parse(plan.items[0].date),7*864e5);
  assert.ok(plan.items[0].body.includes(String(Math.round((Date.parse(longDate)-Date.parse(plan.items[0].date))/864e5))));
  assert.ok((await owner.json('/askesis')).active.some(a=>a.id===askesis.id),'Building a future plan must not finish current askeses');
  assert.equal((await other.json('/reminders/askesis-plan')).items.length,0);
  const push=reminders.notificationFor('askesis',person);
  assert.ok(push.body.includes(String(asc.active[0].left))); assert.ok(push.body.includes(asc.active[0].support));
  await owner.json('/habits','POST',{title:'10 000 шагов',rule:'каждый день'});
  await owner.json('/reminders','POST',{feature:'habits',enabled:true,time:'20:40'});
  qaDB.prepare('INSERT INTO push_subs(endpoint,user_id,created_at) VALUES(?,?,?)').run('https://push.invalid/synthetic',person.id,new Date().toISOString());
  qaDB.prepare("UPDATE reminders SET next_at=? WHERE user_id=? AND feature IN ('askesis','habits')").run(new Date(Date.now()-1000).toISOString(),person.id);
  let deliveries=0;
  const delivery=await reminders.runDue({},()=>{},async()=>{deliveries++;return true;});
  assert.equal(deliveries,1);assert.equal(delivery.queued,2);
  const queued=qaDB.prepare('SELECT feature,title,body FROM push_queue WHERE user_id=?').all(person.id);
  assert.ok(queued.some(n=>n.feature==='askesis' && n.title.includes('Без шоппинга, мой срок') && n.body.includes(String(longAskesis.left))));
  assert.ok(queued.some(n=>n.feature==='habits' && n.body.includes('10 000 шагов')));
  assert.ok(queued.every(n=>!n.body.includes('enc1:')));
  qaDB.prepare('DELETE FROM push_subs WHERE endpoint=?').run('https://push.invalid/synthetic');
  console.log('PASS: actual background-worker initialization queues correct askesis countdown/support and due habits; transport mocked, no notifications sent.');
  assert.equal(reminders.notificationFor('gratitude',person).title,'Кому и за что я благодарна сегодня?');
  await owner.json('/journal','POST',{kind:'gratitude',title:'Кому и за что я благодарна сегодня?',text:'Маме за звонок'});
  const gratitude=(await owner.json('/journal?kind=gratitude')).items[0];
  assert.equal(gratitude.day,day);assert.equal(gratitude.text,'Маме за звонок');
  const beforeEdit=(await owner.json('/journal?kind=gratitude')).items.length;
  const gratitudeEdited=await owner.json('/journal','PATCH',{id:gratitude.id,text:'Маме за звонок и поддержку'});
  assert.equal(gratitudeEdited.item.id,gratitude.id);assert.equal(gratitudeEdited.item.day,day);
  assert.equal((await owner.json('/journal?kind=gratitude')).items.length,beforeEdit,'Editing must not duplicate the entry');
  const deniedEdit=await other.raw('/journal','PATCH',{id:gratitude.id,text:'Чужая запись'});
  assert.equal(deniedEdit.status,404);

  const bundle=await owner.json('/data/export');assert.equal(bundle.profile.photo,photo);assert.ok(bundle.wishes.some(w=>w.photo===photo));assert.ok(bundle.habits.some(h=>h.title==='Тест: прогулка вечером'));assert.ok(bundle.askesis.some(a=>a.observations.some(n=>n.note==='Тест: вечер прошёл спокойно')));assert.ok(!(await other.json('/data/export')).journal.some(j=>j.id===gratitude.id));
  assert.equal(reminders.notificationFor('gratitude',person),null,'Do not remind after gratitude is recorded');
  assert.equal(reminders.notificationFor('gratitude',person,Date.parse(day+'T20:59:00Z'),'Asia/Tokyo'),null,'Reminder suppression uses the same day as the diary');
  await owner.json('/journal','POST',{kind:'answer',title:me.day.question,text:'Сегодня я могу дать себе время'});
  assert.ok((await owner.json('/journal')).items.some(i=>i.kind==='answer' && i.title===me.day.question && i.day===day));
  assert.equal((await owner.json('/catalog')).moods.length,32);
  // Every requested feature exposes a scheduled preference and a feature-specific preview.
  for (const feature of ['mood','moodreport','habits','askesis','gratitude','lunar','sky']) {
    const r=(await owner.json('/reminders','POST',{feature,enabled:true,time:'18:25',freq:'weekly',weekday:3,tz:'Asia/Tokyo'})).item;
    assert.equal(r.time,'18:25');assert.equal(r.weekday,3);assert.equal(r.tz,'Asia/Tokyo');
    assert.equal(new Date(r.nextAt).toLocaleString('sv-SE',{timeZone:r.tz}).slice(11,16),'18:25');
    const preview=(await owner.json('/reminders/preview?feature='+feature)).item;
    assert.ok(preview.title);assert.ok(preview.body);assert.equal(preview.url,'/app/?open='+feature);
  }
  assert.equal((await owner.raw('/reminders/preview?feature=invalid')).status,400);
  for(const feature of ['lunar','sky']) {
    const planned=await owner.json('/reminders/sky-plan?feature='+feature);
    assert.equal(planned.items.length,7);
    assert.ok(planned.items.every(n=>new Date(n.date+'T12:00:00Z').getUTCDay()===3 && n.body && n.url.endsWith(feature)));
  }
  const endpoint='https://push.invalid/current', otherEndpoint='https://push.invalid/other-device';
  for(const ep of [endpoint,otherEndpoint])qaDB.prepare('INSERT INTO push_subs(endpoint,user_id,created_at) VALUES(?,?,?)').run(ep,person.id,new Date().toISOString());
  let sentTo=[];
  assert.equal((await reminders.sendNow(person,'moodreport',{},endpoint,async sub=>{sentTo.push(sub.endpoint);return true;})).ok,true);
  assert.deepEqual(sentTo,[endpoint]);
  assert.ok(reminders.pendingFor(person.id,endpoint).some(n=>n.feature==='moodreport'));
  assert.ok(!reminders.pendingFor(person.id,otherEndpoint).some(n=>n.feature==='moodreport'));
  assert.equal((await reminders.sendNow(person,'mood',{},'https://push.invalid/unknown',async()=>{throw Error('Must not send');})).error,'no_push');
  qaDB.prepare('DELETE FROM push_subs WHERE user_id=?').run(person.id);
  console.log('PASS: all seven feature schedules, timezone, native lunar/sky plans, feature previews, device-specific test delivery and queue isolation.');
  qaDB.close();
  console.log('PASS: arbitrary askesis date, optional notes, free habit rhythm, 30/60/90/180/365 daily-only awards, weekly reminder settings and message content, dated gratitude and daily-question diary entries.');
  if (process.argv.includes('--ui-recovery') || process.argv.includes('--ui-restoration') || process.argv.includes('--ui') || process.argv.includes('--ui-repeat') || process.argv.includes('--ui-experience') || process.argv.includes('--ui-design') || process.argv.includes('--ui-regression') || process.argv.includes('--ui-brand')) {
    // Optional Playwright checks use the same real backend and isolated database.
    const { chromium } = createRequire(import.meta.url)('playwright');
    const browser = await chromium.launch({ headless: true,
      ...(process.env.LUNARIO_CHROME_PATH ? { executablePath: process.env.LUNARIO_CHROME_PATH } : {}) });
    try {
      if(process.argv.includes('--ui-recovery')){const recoveryOwner=account();await recoveryOwner.json('/me');await recoveryOwner.json('/profile','POST',{name:'Проверка функций',birth:'1990-01-01',city:'Москва',consent:true});const {checkFeatureRecovery}=await import('./check-feature-recovery.mjs');await checkFeatureRecovery({browser,base,owner:recoveryOwner});}
      if(process.argv.includes('--ui-restoration')){const restoreOwner=account();await restoreOwner.json('/me');await restoreOwner.json('/profile','POST',{name:'Гость',birth:'1990-01-01',city:'Москва',consent:true});const {checkRestoration}=await import('./check-restoration.mjs');await checkRestoration({browser,base,owner:restoreOwner});const routeOwner=account();await routeOwner.json('/me');await routeOwner.json('/profile','POST',{name:'Маршруты',birth:'1990-01-01',city:'Москва',consent:true});const {checkFourSections}=await import('./check-four-sections.mjs');await checkFourSections({browser,base,owner:routeOwner});}
      if(process.argv.includes('--ui-brand')){const {checkBrand}=await import('./check-brand.mjs');await checkBrand({browser,base,owner});}
      if(process.argv.includes('--ui')||process.argv.includes('--ui-design')){const designOwner=account();await designOwner.json('/me');await designOwner.json('/profile','POST',{name:'Анна',birth:'1990-01-01',city:'Москва',consent:true});const {checkDesign}=await import('./check-design.mjs');await checkDesign({browser,base,owner:designOwner});}
      if(process.argv.includes('--ui')||process.argv.includes('--ui-experience')){const xpOwner=account();await xpOwner.json('/me');await xpOwner.json('/profile','POST',{name:'Новый интерфейс',birth:'1990-01-01',city:'Москва',consent:true});const {checkExperience}=await import('./check-experience.mjs');await checkExperience({browser,base,owner:xpOwner});}
      if(!process.argv.includes('--ui-recovery')&&!process.argv.includes('--ui-restoration')&&!process.argv.includes('--ui-experience')&&!process.argv.includes('--ui-design')&&!process.argv.includes('--ui-brand')){
      const repeatOwner=account();await repeatOwner.json('/me');await repeatOwner.json('/profile','POST',{name:'Повторные действия',birth:'1990-01-01',city:'Москва',consent:true});
      const {checkRepeatPractices}=await import('./check-repeat-practices.mjs');await checkRepeatPractices({browser,base,owner:repeatOwner});
      if(!process.argv.includes('--ui-repeat')){
      const {checkNotificationUI}=await import('./check-notifications.mjs');
      await checkNotificationUI({browser,base,owner,other});
      const fourOwner=account();await fourOwner.json('/me');await fourOwner.json('/profile','POST',{name:'Четыре раздела',birth:'1990-01-01',city:'Москва',consent:true});
      const {checkFourSections}=await import('./check-four-sections.mjs');await checkFourSections({browser,base,owner:fourOwner});
      const uxOwner=account();await uxOwner.json('/me');
      await uxOwner.json('/profile','POST',{name:'Тест интерфейса',birth:'1990-01-01',city:'Москва',consent:true});
      const {checkUsabilityUI}=await import('./check-usability.mjs');
      await checkUsabilityUI({browser,base,owner:uxOwner});
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const [name, value] = owner.cookie.split('=');
      await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/app', httpOnly: true, secure: false, sameSite: 'Lax' }]);
      const page = await ctx.newPage(); const errors = [];const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#v-home.on');
      await page.waitForFunction(() => document.querySelector('#h-acct img')?.naturalWidth > 0);
      assert.equal(await page.locator('#h-acct .news-dot').count(), 1);
      await page.locator('.app-nav [data-nav=account]').click();
      assert.ok(await page.getByRole('button', { name: 'Заменить фото', exact: true }).isVisible());
      // Exercise the existing photo picker, resize/upload and avatar refresh.
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Заменить фото', exact: true }).click();
      await (await chooser).setFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Фото сохранено'));
      await page.reload(); await page.waitForSelector('#v-home.on');
      await page.waitForFunction(() => document.querySelector('#h-acct img')?.naturalWidth > 0);
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history').getByRole('button', { name: 'Мои желания', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#m-wishes .wish-picture img')?.naturalWidth > 0);
      assert.ok((await page.locator('#m-wishes').innerText()).includes('Тест: поездка к морю'));
      // A failed request must not discard the draft or leave an unhandled rejection.
      await page.route('**/api/wishes', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 503, json: { error: 'test_unavailable' } }) : route.continue());
      await page.locator('#w-text').fill('Тест: сохранить мой черновик');
      await page.locator('#wish-save').click();
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Текст остался'));
      assert.equal(await page.locator('#w-text').inputValue(), 'Тест: сохранить мой черновик');
      assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('#toast')).zIndex) > Number(getComputedStyle(document.querySelector('#wg')).zIndex)));
      await page.unroute('**/api/wishes');
      await page.locator('#wish-save').click();
      await page.waitForFunction(() => document.querySelector('#m-wishes').textContent.includes('Тест: сохранить мой черновик'));
      const wishChooser = page.waitForEvent('filechooser');
      await page.locator('#m-wishes .wish-picture:not(:has(img))').first().click();
      await (await wishChooser).setFiles({ name: 'test-wish.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.waitForFunction(() => document.querySelector('#m-wishes .wish-picture img')?.naturalWidth > 0 && document.querySelectorAll('#m-wishes .wish-picture img').length === 2);
      await close();
      await page.locator('.app-nav').getByRole('button', {name:'Сегодня',exact:true}).click();
      await page.getByRole('button', { name: /^Дневник привычек/ }).click();
      await page.locator('#habit-list').getByText('Тест: прогулка вечером', { exact: true }).waitFor();
      await close();
      await page.locator('#v-home').getByRole('button', { name: /^Взять аскезу/ }).click();
      await page.locator('#as-box').getByText('Тест: без вечернего скроллинга', { exact: true }).waitFor();
      assert.equal(await page.locator(`#as-note-${askesis.id}`).inputValue(), 'Тест: вечер прошёл спокойно');
      await close();await page.reload(); await page.waitForSelector('#v-home.on');
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history').getByRole('button', { name: 'Мои желания', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#m-wishes .wish-picture img').length === 2);
      await close();
      assert.deepEqual((await page.locator('.app-nav button').allTextContents()).map(t=>t.trim()), ['Сегодня','Свериться','Дневник','Я']);
      await page.locator('.app-nav').getByRole('button',{name:'Сегодня',exact:true}).click();
      await page.locator('#v-home').getByRole('button',{name:/^Отметить настроение/}).click();
      await page.getByRole('button',{name:'Все эмоции',exact:true}).click();
      assert.equal(await page.locator('#t-moods .mchip').count(),32);
      await page.locator('#t-moods .mchip').filter({hasText:/^восхищение$/}).click();
      await page.waitForFunction(()=>document.querySelector('#t-moods .mpick').textContent.includes('восхищение'));
      await close();
      await page.locator('.app-nav [data-nav=ask]').click();await page.locator('#v-ask').getByRole('button',{name:'Разобрать вопрос',exact:true}).click();
      const question=await page.locator('#hub-chips .chip').first().innerText();
      await page.locator('#hub-chips .chip').first().click();
      assert.equal(await page.locator('#hub-q').inputValue(),'Что мне сейчас важно в отношениях?');
      await page.locator('#hub-q').fill(question+' Это касается моей работы.');
      assert.equal(await page.locator('#hub-opts .chip').count(),4);
      assert.ok(!(await page.locator('#hub-opts').innerText()).includes('Да / Нет'));
      await close();
      await page.locator('.app-nav [data-nav=home]').click();await page.locator('#v-home [data-feature="tone"]').click();
      await page.locator('#tone-a').fill('Ответ из интерфейса');
      await page.getByRole('button',{name:'Отправить в дневник',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Записано в дневник'));
      await close();
      await page.locator('.app-nav [data-nav=history]').click();
      assert.equal(await page.locator('#v-history h1').innerText(),'Дневник');
      await page.locator('#v-history [data-feature="journal"]').click();
      await page.locator('#w-journal').getByText('Ответ из интерфейса',{exact:true}).waitFor();
      await close();
      await page.locator('.app-nav [data-nav=home]').click();
      await page.locator('.app-nav [data-nav=account]').click();await page.locator('#v-account [data-feature=news]').click();
      await page.locator('#news-box .wid').first().waitFor();
      // A root card edit is immediately reflected in News, with the same action.
      await page.evaluate(()=>{const root=document.querySelector('#v-home [data-feature=askesis]');root.querySelector('b').textContent='Взять аскезу · проверка';root.setAttribute('aria-label','Взять аскезу · проверка');return paintNews();});
      await page.locator('#news-box').getByRole('button',{name:/^Взять аскезу · проверка/}).click();
      await page.locator('#as-box').getByText('Тест: без вечернего скроллинга',{exact:true}).waitFor();
      await close();
      for(const [width,height] of [[390,844],[320,568],[844,390],[1440,900]]) {
        await page.setViewportSize({width,height});
        await page.locator('.app-nav [data-nav=home]').click();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
        for(const button of await page.locator('#v-home .wid').all()) {
          await button.scrollIntoViewIfNeeded(); assert.ok(await button.isVisible());
          const size=await button.boundingBox();assert.ok(size.height>=44);
        }
      }
      // Every surviving feature card opens the actual widget pane.
      for(const [view,key] of [['home','card'],['home','mood'],['ask','worry'],['home','day'],['home','tone'],['home','askesis'],['history','wishes'],['home','habits'],['history','gratitude'],['account','natal'],['account','year'],['account','birthnum'],['news','tests'],['account','compat'],['home','lunar'],['home','sky'],['history','hmood'],['history','wishes'],['history','hentries'],['history','journal'],['history','week'],['account','edit'],['account','mail'],['account','remind'],['account','shelves'],['account','support']]) {
        await page.evaluate(v=>go(v),view);
        await page.locator(`#v-${view} [data-feature="${key}"]`).click();
        await page.waitForFunction(k=>document.querySelector(':is(#wg-body,#practice-body) #w-'+k)!==null,key);
        await close();
      }
      await page.evaluate(()=>go('account'));
      for(const title of ['С чего начать','Вопросы и ответы']) {
        if(!(await page.locator('#v-account .upcoming').evaluate(el=>el.open)))await page.locator('#v-account .upcoming summary').click();
        await page.locator('#v-account').getByRole('button',{name:new RegExp('^'+title)}).click();
        assert.equal(await page.locator('#wg-title').innerText(),title);await close();
      }
      await page.evaluate(()=>go('ask'));
      assert.deepEqual(await page.locator('#v-ask .wid b').allTextContents(),['Разобрать вопрос','Да / Нет','Руны','Таро']);
      console.log('PASS: all four main sections, all 32 emotion options, editable question chips, answer-to-diary flow, canonical News links, all restored cards, 320/390/844/1440 layouts.');
      assert.deepEqual(errors, []);
      console.log('PASS: existing profile/wish photo uploads and reloads, habit/askesis navigation, saved notes, failed-request draft protection and visible feedback in the mobile UI.');
      }
      }
    } finally { await browser.close(); }
  }
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
