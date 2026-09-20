/* Integration check: real HTTP handlers + SQLite, synthetic accounts only.
   node >=22.5 tools/check-personal-features.mjs
   No production data, credentials, email or notification delivery is used. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer, connect as netConnect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { versionMismatch, shellGaps } from './bump-version.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), 'lunario-personal-features-'));
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/app`;
const adminMail = 'admin@example.test';
let server, log = '';
/* модули бэкенда, которые проверка подключает напрямую, читают папку контента и ключ из окружения — как сервер */
process.env.CONTENT_DIR = join(fixture, 'content'); process.env.LUNARIO_QUIET = '1';

async function start() {
  server = spawn(process.execPath, [join(fixture, 'backend/server.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/app',
      DATA_DIR: join(fixture, 'data'), CONTENT_DIR: join(fixture, 'content'),
      BACKUP_DIR: join(fixture, 'backups'), SITE_DIR: join(repo, 'site'), PUBLIC_BASE: `http://127.0.0.1:${port}`, ADMIN_EMAILS: adminMail, ANON_RATE: '40' },
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
let clientSeq = 0;
/* Каждый синтетический аккаунт — свой адрес клиента (сервер за прокси берёт последний элемент X-Forwarded-For),
   иначе десятки аккаунтов проверки с одного loopback упрутся в лимит на создание анонимных аккаунтов */
function account(ip = `203.0.113.${1 + (clientSeq++ % 250)}`) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    ip,
    async raw(path, method = 'GET', data, headers = {}) {
      const r = await fetch(base + '/api' + path, { method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...headers },
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
  await cp(join(repo, 'content'), join(fixture, 'content'), { recursive: true, filter: (p) => p === join(repo, 'content') || (dirname(p) === join(repo, 'content') && p.endsWith('.txt')) });   /* тексты приложения, без картинок и архива: запасных копий в коде нет */
  /* «Новое в приложении» живёт только в content/новое.txt (запасного списка в коде нет): две новинки на текущий месяц,
     чтобы экран новостей было чем проверять — плитка ведёт в существующий раздел */
  const newsMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7);
  await writeFile(join(fixture, 'content', 'новое.txt'), `# месяц | название | раздел:виджет | о чём\n${newsMonth} | Взять аскезу | today:askesis | Отказ или ограничение до выбранной даты\n${newsMonth} | Карта дня | today:card | Все 22 аркана с картинками\n`);
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
  const pr1=(await owner.json("/me")).preferences;assert.deepEqual({theme:pr1.theme,ritual:pr1.ritual},prefs);
  assert.deepEqual(pr1.topics,[]);assert.equal(pr1.topicsAll,false);   // темы чтения: пусто = набор по умолчанию
  await owner.json('/preferences','POST',{...prefs,topics:['love','nope','love'],topicsAll:true,lunarViews:50});
  const pr2=(await owner.json("/me")).preferences;assert.deepEqual(pr2.topics,["love"]);assert.equal(pr2.topicsAll,true);assert.equal(pr2.lunarViews,0);   // неизвестные ключи отбрасываются, счётчик ведёт сервер
  await owner.json('/preferences','POST',{...prefs,topics:[],topicsAll:false});
  assert.equal((await other.json('/preferences')).preferences.theme,'dark');
  for(const ritual of [[],['tone'],['tone','tone'],['tone','unknown'],['card','mood','tone','journal']])assert.equal((await owner.raw('/preferences','POST',{theme:'dark',ritual})).status,400);
  /* Инструменты: каталог отдаёт список со стартовым набором; выбор хранится в настройках, чужие ключи отбрасываются, не-массив — ошибка */
  const catTools=(await (await fetch(base+'/api/catalog')).json()).tools;assert.ok(Array.isArray(catTools)&&catTools.some(t=>t.key==='journal'&&!t.start)&&catTools.some(t=>t.key==='gratitude'&&!t.start)&&catTools.every(t=>t.section==='history'),'tools catalog: diary only; every practice is off for a new person — the evening starts with mood only');
  assert.equal((await owner.json('/preferences')).preferences.tools,undefined,'no choice yet — client shows the start set');
  await owner.json('/preferences','POST',{...prefs,tools:['askesis','nope','askesis','wishes']});assert.deepEqual((await owner.json('/preferences')).preferences.tools,['askesis','wishes']);
  await owner.json('/preferences','POST',{...prefs,topics:[]});assert.deepEqual((await owner.json('/preferences')).preferences.tools,['askesis','wishes'],'saving other preferences keeps the tools');
  assert.equal((await owner.raw('/preferences','POST',{...prefs,tools:'wishes'})).status,400);
  await owner.json('/preferences','POST',{...prefs,tools:[]});assert.deepEqual((await owner.json('/preferences')).preferences.tools,[]);
  await owner.json('/preferences','POST',{...prefs,tools:['gratitude','habits','askesis','wishes','hmood']});   /* дальше UI-сценарии открывают плитки с главной */
  /* Утро: выбранные плитки хранятся в настройках; карта и руна, если выбраны, тянутся при первом /me дня; тема дня — от них */
  { const fresh=account();await fresh.json('/me');await fresh.json('/profile','POST',{name:'Утро',birth:'1991-02-02',city:'Москва',consent:true});
    const me0=await fresh.json('/me');assert.deepEqual(me0.day.morning,['lunar','tone']);assert.ok(me0.day.set?.text&&me0.day.set.question&&me0.day.theme?.key,'настрой, вопрос и тема дня');assert.equal(me0.day.card,null);assert.equal(me0.day.rune,null);
    assert.equal((await fresh.raw('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['card','Не ключ!']})).status,400);
    await fresh.json('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['dayrune','card']});
    const me1=await fresh.json('/me');assert.ok(me1.day.card&&me1.day.rune,'chosen card and rune are drawn by themselves');assert.deepEqual(me1.day.morning,['dayrune','card']);
    /* утро вытянуло само: в «Мои вопросы и ответы» такого нет и событие — «вытянута», а не «открыл»; открыл — появилось, событие один раз */
    const db0=new DatabaseSync(join(fixture,'data/app.db'));const freshId=(await fresh.json('/me')).user.id;const ev=(t)=>db0.prepare('SELECT COUNT(*) n FROM events WHERE user_id=? AND type=?').get(freshId,t).n;
    assert.equal((await fresh.json('/entries?kind=card')).items.length,0,'auto-drawn card is not an asked entry');assert.equal(ev('card_draw'),1);assert.equal(ev('card_open'),0,'auto draw is not an open');
    await fresh.json('/card','POST');await fresh.json('/card','POST');assert.equal((await fresh.json('/entries?kind=card')).items.length,1,'opened card is listed');assert.equal(ev('card_open'),1,'opened once a day');
    assert.equal((await fresh.json('/entries?kind=questions')).items.filter(i=>i.kind==='dayrune').length,0,'auto-drawn rune stays out of the list until opened');db0.close();
    assert.equal((await fresh.json('/dayrune','POST')).rune.slug,me1.day.rune.slug,'the same rune all day');assert.equal(me1.day.set.text,me0.day.set.text,'today\'s настрой does not change after the choice');
    const other2=account();await other2.json('/me');await other2.json('/profile','POST',{name:'Утро-2',birth:'1991-02-02',city:'Москва',consent:true});
    await other2.json('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['card']});const me2=await other2.json('/me');
    assert.ok(me2.day.card,'card drawn from the first day pack');assert.ok(me2.day.theme?.key,'theme from the card');
}
  /* Карточка дня: один запрос — разные типы; повтор не дублирует; пустая ячейка не стирает; чужие привычки и аскезы не трогаются */
  { const p=account();await p.json('/me');await p.json('/profile','POST',{name:'День',birth:'1993-03-03',city:'Москва',consent:true});
    const h=(await p.json('/habits','POST',{title:'Вода',rule:'каждый день'})).items.find(x=>x.title==='Вода');
    const untilDay=new Date(Date.parse(day+'T12:00:00Z')+6*864e5).toISOString().slice(0,10);const a=(await p.json('/askesis','POST',{title:'Без сахара',until:untilDay})).active.find(x=>x.until===untilDay);
    const s0=await p.json('/day');assert.ok(s0.question&&s0.text===null&&s0.moods.length===0&&s0.habits.some(x=>x.id===h.id)&&s0.askesis.some(x=>x.id===a.id));
    const r1=await p.json('/day','POST',{text:'Первая запись дня',gratitude:'Себе',answer:'Ответ дня',moods:['quick:calm','joy','own:собранно','nope'],habits:[{id:h.id,done:true},{id:999999,done:true}],askesis:[{id:a.id,kept:false,note:'Сорвалась вечером'}]});
    assert.deepEqual(r1.saved,['text','gratitude','answer','moods','habits','askesis']);assert.deepEqual(r1.moods,['quick:calm','joy','own:собранно']);assert.ok(r1.habits.find(x=>x.id===h.id).today);
    assert.equal(r1.askesis.find(x=>x.id===a.id).kept,false);assert.equal(r1.askesis.find(x=>x.id===a.id).note,'Сорвалась вечером');
    const j1=(await p.json('/journal')).items;assert.equal(j1.length,3);assert.deepEqual(j1.map(i=>i.kind).sort(),['','answer','gratitude']);assert.equal(j1.find(i=>i.kind==='answer').title,s0.question);
    assert.equal((await p.json('/me')).mood,'quick:calm','first mood stays the main one');
    const r2=await p.json('/day','POST',{text:'Первая запись дня, дописанная',gratitude:'',moods:['joy']});
    assert.equal(r2.text.text,'Первая запись дня, дописанная');assert.equal(r2.gratitude.text,'Себе','empty cell keeps the record');assert.deepEqual(r2.moods,['joy']);
    assert.equal((await p.json('/journal')).items.length,3,'no duplicates on a second save');
    const a2=await p.json('/journal','POST',{text:'Ответ дня, дописанный из панели',kind:'answer',title:s0.question});assert.ok(a2.updated,'the question panel updates the answer written in the day card');
    assert.equal((await p.json('/journal')).items.filter(i=>i.kind==='answer').length,1,'one answer per day');assert.equal((await p.json('/day')).answer.text,'Ответ дня, дописанный из панели');
    assert.equal((await p.json('/day','POST',{habits:[{id:h.id,done:false}]})).habits.find(x=>x.id===h.id).today,false);
    assert.equal((await other.raw('/day','POST',{habits:[{id:h.id,done:true}]})).status,200);assert.equal((await p.json('/day')).habits.find(x=>x.id===h.id).today,false,'another account cannot mark my habit');
    const tl=await p.json('/timeline?kind=askesis&day=&offset=0');assert.ok(tl.items.some(i=>i.kind==='askesis'&&i.data==='0'),'askesis day with kept=0 in the timeline'); }
  const wishesBefore=(await owner.json('/wishes')).items.length;
  assert.equal((await owner.raw('/wishes','POST',{text:'Неверное фото',photo:'not-an-image'})).status,400);
  assert.equal((await owner.json('/wishes')).items.length,wishesBefore,'No orphan wish when its photo is invalid');
  const timelineOwner=account();await timelineOwner.json('/me');
  for(let i=0;i<65;i++)await timelineOwner.json('/journal','POST',{text:'Строка '+i,kind:i%2?'':'gratitude'});   /* ответ на вопрос дня — один на день, поэтому здесь записи и благодарности */
  const first=(await timelineOwner.json('/timeline'));const second=(await timelineOwner.json('/timeline?offset='+first.next));
  assert.equal(first.items.length,60);assert.equal(second.items.length,5);assert.equal(second.next,null);
  assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,65);
  assert.ok((await timelineOwner.json('/timeline?kind=gratitude')).items.every(i=>i.kind==='gratitude'));
  assert.equal((await other.json('/timeline')).items.length,0);
  const ownTimeline=await owner.json('/timeline?day='+day);assert.ok(ownTimeline.items.some(i=>i.body==='Тест: запись в дневнике'));
  assert.ok(ownTimeline.items.some(i=>i.source==='askesis'));assert.ok(ownTimeline.items.some(i=>i.source==='habit'));
  console.log('PASS: validated account preferences; private filtered/paginated timeline; invalid photo creates no wish.');

  // A real process restart also verifies that session and encryption keys survive.
  await stop(); await start();
  const me = await owner.json('/me');
  assert.equal(me.user.name, 'Проверка сохранения'); assert.equal(me.user.photo, true);
  assert.equal(me.mood, 'joy');const core=(x)=>({theme:x.theme,ritual:x.ritual});assert.deepEqual(core(me.preferences),prefs);assert.deepEqual(core((await owner.json('/data/export')).preferences),prefs);
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
  /* Наград за серии больше нет (решение владелицы): отметка — просто отметка, серия считается, но ничего не «выдаётся» */
  { const h=(await owner.json('/habits','POST',{title:'Ежедневно 30',rule:'каждый день'})).items.find(h=>h.title==='Ежедневно 30');
    qaDB.prepare('UPDATE habits SET created_at=? WHERE id=?').run(new Date(Date.parse(day)-29*864e5).toISOString(),h.id);
    const add=qaDB.prepare('INSERT INTO habit_marks(habit_id,day) VALUES(?,?)');for(let i=1;i<30;i++)add.run(h.id,new Date(Date.parse(day)-i*864e5).toISOString().slice(0,10));
    const result=await owner.json('/habits','PATCH',{id:h.id});assert.equal(result.award,undefined,'no award field');
    const row=result.items.find(x=>x.id===h.id);assert.equal(row.streak,30);assert.equal(row.awards,undefined);assert.equal(row.next,undefined);
    assert.equal(qaDB.prepare('SELECT COUNT(*) n FROM habit_awards').get().n,0,'nothing is written to habit_awards any more'); }
  /* ── Три напоминания: утро (настрой и выбранные плитки), вечер (молчит, если день записан), неделя (по воскресеньям) ── */
  const reminders=await import(pathToFileURL(join(fixture,'backend/reminders.mjs')));
  assert.deepEqual(Object.keys(reminders.FEATURES),['morning','evening','week']);
  assert.equal((await owner.raw('/reminders','POST',{feature:'askesis',enabled:true})).status,400,'old per-feature reminders are gone');
  const list=(await owner.json('/reminders')).items;assert.deepEqual(list.map(r=>r.feature),['morning','evening','week']);assert.equal(list.find(r=>r.feature==='week').freq,'weekly');
  const schedule=(await owner.json('/reminders','POST',{feature:'evening',enabled:true,time:'20:40',tz:'Europe/Moscow'})).item;
  assert.equal(schedule.time,'20:40');assert.equal(schedule.freq,'daily');assert.ok(schedule.nextAt);
  assert.equal((await owner.json('/reminders','POST',{feature:'week',enabled:true,freq:'daily',weekday:5,time:'13:10'})).item.freq,'weekly','week is always weekly');
  const worker=await import(pathToFileURL(join(fixture,'backend/send-daily.mjs')));
  worker.initScheduledReminders(qaDB,join(fixture,'data'));
  const person=qaDB.prepare('SELECT id,name,preferences,tz,lat,lon,birth FROM users WHERE name=?').get('Проверка сохранения');
  /* утро: заголовок — настрой дня, строки — по выбранным плиткам; план на 14 дней для телефона */
  await owner.json('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['card','lunar','tone']});
  const morning=reminders.notificationFor('morning',qaDB.prepare('SELECT * FROM users WHERE id=?').get(person.id));
  const meNow=await owner.json('/me');assert.equal(morning.title,meNow.day.set.text,'morning push title is the настрой of the day');
  assert.ok(morning.body.includes('Карта дня — ')&&morning.body.includes('лунный день')&&morning.body.includes('Вопрос дня — '),morning.body);assert.equal(morning.url,'/app/?open=today');
  await owner.json('/reminders','POST',{feature:'morning',enabled:true,time:'08:30'});
  const plan=await owner.json('/reminders/native-plan?feature=morning');assert.equal(plan.items.length,14);assert.ok(plan.items.every(i=>i.title&&i.url==='/app/?open=today'));
  /* план на будущие дни считает ту же карту, что утром вытянет /me, и настрой снимается под её тему — цепочка «карта → тема → настрой» не рвётся */
  { const { hash32 }=await import(pathToFileURL(join(fixture,'backend/morning.mjs')).href);const C=await import(pathToFileURL(join(fixture,'backend/content.mjs')).href);
    const ownerId=(await owner.json('/me')).user.id;const future=plan.items.find(i=>i.date>day);const arcana=[...C.ARCANA];const card=arcana[hash32(`${ownerId}:${future.date}:card`)%arcana.length];
    assert.ok(future.body.includes('Карта дня — '+card.name),'future push names the card of that day: '+future.body);
    assert.equal(qaDB.prepare('SELECT theme FROM daily_sets WHERE user_id=? AND day=?').get(ownerId,future.date).theme,C.themeOf('карта',card.slug),'future настрой is snapshotted under the card theme');
    assert.ok(plan.items.every(i=>!i.body.includes('На небе')),'sky line is «Планеты — …»'); }
  assert.equal(Date.parse(plan.items[1].date)-Date.parse(plan.items[0].date),864e5);
  assert.equal((await other.json('/reminders/native-plan?feature=morning')).items.length,0,'no plan without an enabled reminder');
  /* влияние планет как источник темы: главное событие неба на день → строка «небо | …» из темы-источников.txt.
     Пара «настрой — вопрос» снимается при первом /me, поэтому после выбора источника снимок дня сбрасывается */
  { const { skyKeyOf } = await import(pathToFileURL(join(fixture,'backend/morning.mjs')).href);const C=await import(pathToFileURL(join(fixture,'backend/content.mjs')).href);
    const skyKey=skyKeyOf(day);assert.ok(skyKey===null||/^(фаза|затмение|ретро) /.test(skyKey),'sky key: '+skyKey);
    const skyP=account();await skyP.json('/me');await skyP.json('/profile','POST',{name:'Небо',birth:'1990-05-05',city:'Москва',consent:true});
    await skyP.json('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['sky']});
    qaDB.prepare('DELETE FROM daily_sets WHERE user_id=(SELECT id FROM users WHERE name=?)').run('Небо');const me3=await skyP.json('/me');
    if(skyKey&&C.themeOf('небо',skyKey))assert.equal(me3.day.theme.key,C.themeOf('небо',skyKey),'theme comes from the sky event');else assert.ok(me3.day.theme?.key,'quiet sky falls back to the tone of the day'); }
  /* день человека — по поясу устройства (X-Tz), запоминается в preferences.tz; кривой заголовок — пояс города из анкеты или Москва */
  { const far=account();await far.json('/me');await far.json('/profile','POST',{name:'Далеко',birth:'1990-06-06',city:'Москва',consent:true});
    const dayAt=(tz)=>new Date().toLocaleDateString('sv-SE',{timeZone:tz});
    const r1=await (await far.raw('/me','GET',undefined,{'X-Tz':'Pacific/Kiritimati'})).json();assert.equal(r1.day.date,dayAt('Pacific/Kiritimati'),'day follows the device timezone');assert.equal(r1.preferences.tz,'Pacific/Kiritimati','timezone remembered');
    const r2=await (await far.raw('/me','GET',undefined,{'X-Tz':'Not/AZone'})).json();assert.equal(r2.day.date,dayAt('Pacific/Kiritimati'),'a bad header keeps the remembered timezone');
    const r3=await (await far.raw('/me','GET',undefined,{'X-Tz':'Pacific/Niue'})).json();assert.equal(r3.day.date,dayAt('Pacific/Niue'),'a new device timezone wins');
    await far.json('/preferences','POST',{theme:'dark',ritual:['tone','journal'],morning:['card']});assert.equal((await far.json('/me')).preferences.tz,'Pacific/Niue','saving preferences keeps the timezone'); }
  /* вечер: пока день не записан — напоминаем; записали хоть что-то — молчим */
  const evPerson=account();await evPerson.json('/me');await evPerson.json('/profile','POST',{name:'Вечер',birth:'1994-04-04',city:'Москва',consent:true});
  const evRow=qaDB.prepare('SELECT * FROM users WHERE name=?').get('Вечер');
  assert.equal(reminders.notificationFor('week',evRow),null,'no moments this week — no weekly push');
  /* вечерний пуш — приглашение, одна из формулировок evening / evening-N по дню; молчит, когда день записан словами или настроением,
     а отметка привычки его не глушит */
  const evC=await import(pathToFileURL(join(fixture,'backend/content.mjs')).href);
  const evKeys=['evening',...Array.from({length:199},(_,i)=>'evening-'+(i+2))].map((k)=>evC.REMINDER_TEXTS[k]).filter(Boolean).map((t)=>t[0]);
  assert.ok(evKeys.includes(reminders.notificationFor('evening',evRow).title),'evening push is one of the invitation variants');
  assert.equal(reminders.notificationFor('evening',evRow).body.search(/напишите|ответьте/i),-1,'the evening push invites, it does not ask to write');
  const evHabit=(await evPerson.json('/habits','POST',{title:'Вода',rule:'каждый день'})).items.find((x)=>x.title==='Вода');await evPerson.json('/day','POST',{habits:[{id:evHabit.id,done:true}]});
  assert.ok(reminders.notificationFor('evening',evRow),'a habit mark alone does not silence the evening push');
  await evPerson.json('/day','POST',{moods:['joy']});assert.equal(reminders.notificationFor('evening',evRow),null,'a remembered day needs no evening push');
  /* неделя: без записей — пуша нет; мало — «сохранили N момент(а)»; три и больше — «неделя готова» */
  assert.match(reminders.notificationFor('week',evRow).body,/сохранили 1 момент$/);
  await evPerson.json('/day','POST',{text:'Первый момент'});assert.match(reminders.notificationFor('week',evRow).body,/сохранили 2 момента/);
  await evPerson.json('/day','POST',{gratitude:'Второй'});assert.equal(reminders.notificationFor('week',evRow).title,'Моя неделя: про что она');
  /* планировщик кладёт в очередь и будит устройство */
  qaDB.prepare('INSERT INTO push_subs(endpoint,user_id,created_at) VALUES(?,?,?)').run('https://push.invalid/synthetic',person.id,new Date().toISOString());
  qaDB.prepare("UPDATE reminders SET next_at=? WHERE user_id=? AND feature IN ('morning','evening')").run(new Date(Date.now()-1000).toISOString(),person.id);
  let deliveries=0;
  const delivery=await reminders.runDue({},()=>{},async()=>{deliveries++;return true;});
  assert.equal(deliveries,1);assert.ok(delivery.queued>=1);
  const queued=qaDB.prepare('SELECT feature,title,body FROM push_queue WHERE user_id=?').all(person.id);
  assert.ok(queued.some(n=>n.feature==='morning'&&n.title===meNow.day.set.text));assert.ok(queued.every(n=>!n.body.includes('enc1:')));
  qaDB.prepare('DELETE FROM push_subs WHERE endpoint=?').run('https://push.invalid/synthetic');
  /* перенос старых восьми: включённые утренние → утро с самым ранним временем, вечерние → вечер с самым поздним, отчёт → неделя */
  { const legacy=account();await legacy.json('/me');await legacy.json('/profile','POST',{name:'Прежние напоминания',birth:'1990-01-01',city:'Москва',consent:true});
    const uid=qaDB.prepare('SELECT id FROM users WHERE name=?').get('Прежние напоминания').id;
    const ins=qaDB.prepare("INSERT INTO reminders(user_id,feature,enabled,time,freq,weekday,tz,next_at) VALUES(?,?,1,?,?,?,'Europe/Moscow','2030-01-01T00:00:00.000Z')");
    ins.run(uid,'card','09:15','daily',7);ins.run(uid,'lunar','08:40','daily',7);ins.run(uid,'habits','20:00','daily',7);ins.run(uid,'gratitude','21:30','daily',7);ins.run(uid,'moodreport','19:00','weekly',6);
    assert.equal(reminders.migrateLegacyReminders(),1);
    const moved=Object.fromEntries((await legacy.json('/reminders')).items.map(r=>[r.feature,r]));
    assert.equal(moved.morning.time,'08:40');assert.ok(moved.morning.enabled);assert.equal(moved.evening.time,'21:30');assert.ok(moved.evening.enabled);assert.equal(moved.week.weekday,6);assert.equal(moved.week.time,'19:00');
    assert.equal(qaDB.prepare("SELECT COUNT(*) n FROM reminders WHERE user_id=? AND enabled=1 AND feature NOT IN ('morning','evening','week')").get(uid).n,0,'old rows are switched off');
    assert.equal(reminders.migrateLegacyReminders(),0,'migration runs once'); }
  console.log('PASS: three reminders — morning from the настрой and chosen tiles, evening silent after a remembered day, weekly by moments; native 14-day plan; worker queue; legacy migration.');
  /* «Моя неделя»: пусто → мало → полная; фрагменты дословно; «отозвалось» только по своим дням; рефлексия одна на неделю; чужие данные не видны */
  { const wk=account();await wk.json('/me');await wk.json('/profile','POST',{name:'Неделя',birth:'1992-02-02',city:'Москва',consent:true});
    const w0=await wk.json('/week');assert.equal(w0.mode,'empty');assert.equal(w0.text,'Записей не было. Это нормально.');assert.ok(w0.week.start<=day&&w0.week.end>=w0.week.start);assert.equal(w0.reflection.question,'Что хочется взять с собой в следующую неделю?');
    assert.equal((await wk.json('/week?week=2030-01-01')).week.end<=w0.week.end,true,'the future is clamped to the current week');
    await wk.json('/day','POST',{text:'Первый момент недели'});const w1=await wk.json('/week');assert.equal(w1.mode,'few');assert.equal(w1.text,'На этой неделе вы сохранили 1 момент');assert.equal(w1.saved[0].text,'Первый момент недели');
    await wk.json('/day','POST',{gratitude:'Себе за то, что дошла',moods:['joy','quick:calm']});const w2=await wk.json('/week');assert.equal(w2.mode,'full');assert.equal(w2.moments,3);
    assert.equal(w2.moods.count,1);assert.deepEqual(w2.moods.days.find(x=>x.day===day).moods.map(m=>m.toLowerCase()),['радость','спокойно']);assert.ok(w2.moods.top.some(t=>t.mood.toLowerCase()==='радость'));
    assert.equal(w2.saved.length,2,'verbatim fragments');assert.ok(w2.saved.every(f=>['Первый момент недели','Себе за то, что дошла'].includes(f.text)));
    await wk.json('/me');const e=w2.echoes.find(x=>x.day===day);assert.ok(e&&e.morning&&e.evening&&e.verdict==='','today has a morning настрой and an evening record');
    assert.equal((await wk.json('/week/echo','POST',{day,verdict:'yes'})).verdict,'yes');assert.equal((await wk.json('/week')).echoes.find(x=>x.day===day).verdict,'yes');
    assert.equal((await wk.raw('/week/echo','POST',{day,verdict:'maybe'})).status,400);assert.equal((await wk.raw('/week/echo','POST',{day:'2031-01-01',verdict:'yes'})).status,400);
    assert.equal((await wk.json('/week/echo','POST',{day,verdict:''})).verdict,'');assert.equal(qaDB.prepare('SELECT COUNT(*) n FROM week_echoes WHERE day=?').get(day).n,0,'cleared verdict leaves no row');
    const r1=await wk.json('/week/reflect','POST',{week:day,text:'Взять с собой тишину'});assert.equal(r1.text,'Взять с собой тишину');assert.equal(r1.day,w2.week.end);
    await wk.json('/week/reflect','POST',{week:day,text:'Взять с собой тишину и сон'});assert.equal((await wk.json('/week')).reflection.text,'Взять с собой тишину и сон');
    const uid=(await wk.json('/me')).user.id;assert.equal(qaDB.prepare("SELECT COUNT(*) n FROM journal WHERE user_id=? AND kind='weekly'").get(uid).n,1,'one reflection per week');
    assert.ok((await wk.json('/timeline?kind=&day=&offset=0')).items.some(i=>i.kind==='weekly'&&i.body==='Взять с собой тишину и сон'),'reflection is in the diary timeline');
    assert.equal((await wk.json('/week')).moments,3,'the reflection itself is not a moment');
    await wk.json('/week/reflect','POST',{week:day,text:''});assert.equal((await wk.json('/week')).reflection.text,'','empty text removes the reflection');
    const h=(await wk.json('/habits','POST',{title:'Прогулка',rule:'каждый день'})).items.find(x=>x.title==='Прогулка');await wk.json('/day','POST',{habits:[{id:h.id,done:true}]});
    const w3=await wk.json('/week');const rh=w3.rhythm.habits.find(x=>x.id===h.id);assert.ok(rh&&rh.done===1&&rh.days.some(x=>x.day===day&&x.done),'habit days in the rhythm');assert.ok(w3.rhythm.phrase,'a pace phrase comes with the rhythm');
    const stranger=account();await stranger.json('/me');const ws=await stranger.json('/week');assert.equal(ws.mode,'empty');assert.equal(ws.echoes.length,0);assert.equal(ws.rhythm.habits.length,0,'another account sees none of it');
    assert.equal(reminders.notificationFor('week',qaDB.prepare('SELECT * FROM users WHERE id=?').get(uid)).title,'Моя неделя: про что она'); }
  console.log('PASS: «Моя неделя» — empty / few / full modes, verbatim fragments, echo verdicts, one weekly reflection, rhythm days, account isolation.');
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
  /* Читаемая выгрузка: настоящий PDF, со шрифтом, текстами дневника и без чужих записей — те же данные, что в JSON */
  { const r=await owner.raw('/data/export.pdf');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.match(r.headers.get('content-disposition')||'',/^attachment; filename="lunario-\d{4}-\d{2}-\d{2}\.pdf"$/);
    const pdf=Buffer.from(await r.arrayBuffer());assert.ok(pdf.subarray(0,5).toString('latin1')==='%PDF-','PDF header');assert.ok(pdf.includes('/FontFile2') && pdf.includes('/Identity-H'),'embedded TrueType font');assert.ok(pdf.includes('/Subtype /Image'),'cover image');assert.ok(pdf.length>50000);
    const {personalExportPdf}=await import(pathToFileURL(join(fixture,'backend/personal-export-pdf.mjs')).href);
    const text=(buf)=>{let out='';const re=/stream\r?\n/g;let m;while((m=re.exec(buf.toString('latin1')))){const start=m.index+m[0].length,end=buf.indexOf('endstream',start);try{out+=inflateSync(buf.subarray(start,end)).toString('latin1');}catch{}}return out;};
    const hexOf=(buf)=>{const cmap=text(buf);const map=new Map();for(const mm of cmap.matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4})>/g))map.set(mm[1],String.fromCharCode(parseInt(mm[2],16)));let s='';for(const mm of cmap.matchAll(/<([0-9a-f]+)> Tj/g))s+=mm[1].match(/.{4}/g).map((g)=>map.get(g)||'').join('')+'\n';return s;};
    const mine=hexOf(personalExportPdf(bundle));assert.ok(mine.includes('Тест: прогулка вечером'),'habit title in PDF text');assert.ok(mine.includes('Тест: вечер прошёл спокойно'),'askesis note in PDF text');
    assert.ok(!hexOf(personalExportPdf(await other.json('/data/export'))).includes('Тест: прогулка вечером'),'other account gets its own PDF'); }
  await owner.json('/journal','POST',{kind:'answer',title:me.day.question,text:'Сегодня я могу дать себе время'});
  assert.ok((await owner.json('/journal')).items.some(i=>i.kind==='answer' && i.title===me.day.question && i.day===day));
  // Home screen status comes from one request; it mirrors the same tables the practice screens read.
  const status=await owner.json('/day-status');
  assert.equal(status.gratitude,true);assert.equal(status.answer,true);assert.equal(typeof status.journal,'boolean');
  assert.ok(status.habits.some(h=>h.title==='Тест: прогулка вечером'));assert.ok(Array.isArray(status.askesis.active));
  assert.equal((await other.json('/day-status')).gratitude,false,'Day status must be per account');
  assert.equal((await owner.json('/catalog')).moods.length,32);
  // Each of the three reminders has a schedule with its own time zone and a preview.
  for (const feature of ['morning','evening','week']) {
    const r=(await owner.json('/reminders','POST',{feature,enabled:true,time:'18:25',freq:'weekly',weekday:3,tz:'Asia/Tokyo'})).item;
    assert.equal(r.time,'18:25');assert.equal(r.weekday,3);assert.equal(r.tz,'Asia/Tokyo');
    assert.equal(new Date(r.nextAt).toLocaleString('sv-SE',{timeZone:r.tz}).slice(11,16),'18:25');
    const preview=(await owner.json('/reminders/preview?feature='+feature)).item;
    assert.ok(preview.title);assert.ok(preview.body);assert.equal(preview.url,reminders.FEATURES[feature].url);
  }
  assert.equal((await owner.raw('/reminders/preview?feature=invalid')).status,400);
  const endpoint='https://push.invalid/current', otherEndpoint='https://push.invalid/other-device';
  for(const ep of [endpoint,otherEndpoint])qaDB.prepare('INSERT INTO push_subs(endpoint,user_id,created_at) VALUES(?,?,?)').run(ep,person.id,new Date().toISOString());
  let sentTo=[];
  assert.equal((await reminders.sendNow(person,'week',{},endpoint,async sub=>{sentTo.push(sub.endpoint);return true;})).ok,true);
  assert.deepEqual(sentTo,[endpoint]);
  assert.ok(reminders.pendingFor(person.id,endpoint).some(n=>n.feature==='week'));
  assert.ok(!reminders.pendingFor(person.id,otherEndpoint).some(n=>n.feature==='week'));
  assert.equal((await reminders.sendNow(person,'evening',{},'https://push.invalid/unknown',async()=>{throw Error('Must not send');})).error,'no_push');
  qaDB.prepare('DELETE FROM push_subs WHERE user_id=?').run(person.id);
  console.log('PASS: three reminder schedules, timezone, previews, device-specific test delivery and queue isolation.');
  // ── Одна версия оболочки: index.html, импорты sky.js и SHELL в sw.js должны совпадать ──
  assert.equal(versionMismatch(), null, 'Shell version must be the same in index.html, sky.js and sw.js');
  assert.equal(shellGaps(), null, 'every shell css/js in index.html carries ?v= and is listed in SHELL of sw.js');

  // ── Политика личных данных: каждая таблица с user_id описана; удаление аккаунта уносит и переписку с поддержкой ──
  const { PERSONAL_DATA, tablesWithUser } = await import(pathToFileURL(join(fixture, 'backend/account-data.mjs')).href);
  const policy = new Set(PERSONAL_DATA.map((r) => r.table));
  for (const t of tablesWithUser(qaDB)) assert.ok(policy.has(t), `Table ${t} has user_id but no lifecycle rule`);
  for (const t of policy) assert.ok(qaDB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), `Policy names unknown table ${t}`);
  const seed = async (acc, name) => {
    await acc.json('/me'); await acc.json('/profile', 'POST', { name, birth: '1991-02-03', city: 'Москва', consent: true });
    await acc.json('/mood', 'POST', { mood: 'joy' });
    await acc.json('/journal', 'POST', { text: 'Личная запись', kind: 'gratitude', title: 'Кому и за что я благодарна сегодня?' });
    await acc.json('/wishes', 'POST', { text: 'Личное желание' });
    const h = (await acc.json('/habits', 'POST', { title: 'Привычка', rule: 'каждый день' })).items[0]; await acc.json('/habits', 'PATCH', { id: h.id });
    const a = (await acc.json('/askesis', 'POST', { title: 'Аскеза', until })).active[0]; await acc.json('/askesis', 'PATCH', { id: a.id, note: 'Наблюдение' });
    await acc.json('/ask', 'POST', { question: 'Стоит ли мне менять работу этой осенью?', kind: 'yesno' });
    const t = await acc.json('/support/tickets', 'POST', { topic: 'Прочее', text: 'Личный вопрос в поддержку' }); await acc.json('/support/ticket?id=' + t.id, 'POST', { text: 'Ещё сообщение' });
    await acc.json('/reminders', 'POST', { feature: 'morning', enabled: true, tz: 'Europe/Moscow' });
    await acc.json('/push', 'POST', { endpoint: 'https://push.example.com/box/' + name });
    await acc.json('/knowledge?doc=recent'); await acc.json('/compat', 'POST', { birth: '1990-01-01' });
    return (await acc.json('/me')).user.id;
  };
  const rowsOf = (uid) => Object.fromEntries(PERSONAL_DATA.filter((r) => r.table !== 'users').map((r) => [r.table, r.by === 'email' ? 0
    : r.via ? qaDB.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE ${r.via.key} IN (SELECT id FROM ${r.via.table} WHERE user_id=?)`).get(uid).c
    : qaDB.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE user_id=?`).get(uid).c]));
  const victim = account(), keeper = account();
  const victimId = await seed(victim, 'Удаляемый'), keeperId = await seed(keeper, 'Остающийся');
  const before = rowsOf(victimId), keeperBefore = rowsOf(keeperId);
  for (const t of ['tickets', 'messages', 'reminders', 'push_subs', 'sessions', 'journal', 'habit_marks', 'askesis_days', 'knowledge', 'compat_checks']) assert.ok(before[t] > 0, `Seed must fill ${t}`);
  assert.ok(qaDB.prepare('SELECT subject FROM tickets WHERE user_id=?').get(victimId).subject.startsWith('enc1:'), 'Ticket subject must be encrypted at rest');
  await victim.json('/account', 'DELETE');
  const after = rowsOf(victimId);
  for (const r of PERSONAL_DATA) { if (r.table === 'users' || r.by === 'email') continue; assert.equal(after[r.table], r.on === 'keep' ? before[r.table] : 0, `${r.table} after account deletion (${r.on})`); }
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(victimId).c, 0);
  assert.deepEqual(rowsOf(keeperId), keeperBefore, 'Deleting one account leaves the neighbour untouched');
  await keeper.json('/data', 'DELETE');
  const cleared = rowsOf(keeperId);
  for (const r of PERSONAL_DATA) { if (r.table === 'users' || r.by === 'email') continue; if (r.on === 'history') assert.equal(cleared[r.table], 0, `${r.table} after clearing history`); }
  for (const t of ['tickets', 'messages', 'reminders', 'push_subs', 'sessions']) assert.ok(cleared[t] > 0, `Clearing history keeps ${t}`);
  assert.equal((await keeper.json('/me')).user.id, keeperId, 'Clearing history keeps the account');
  console.log('PASS: one lifecycle policy covers every table with user_id; account deletion removes support threads and devices; clearing history keeps the account and support.');

  // ── События: подтверждённые действия пишет сервер, браузер их подделать не может ──
  const evt = account(); await evt.json('/me'); await evt.json('/profile', 'POST', { name: 'События', birth: '1990-05-05', city: 'Москва', consent: true });
  const evtId = (await evt.json('/me')).user.id;
  const count = (type) => qaDB.prepare('SELECT COUNT(*) c FROM events WHERE user_id=? AND type=?').get(evtId, type).c;
  assert.equal((await evt.raw('/event', 'POST', { t: 'mood_set' })).status, 400, 'Server-owned events are rejected from /api/event');
  await evt.json('/mood', 'POST', { mood: 'joy' }); assert.equal(count('mood_set'), 1);
  await evt.json('/card', 'POST'); await evt.json('/card', 'POST'); assert.equal(count('card_open'), 1, 'Card of the day is drawn once and counted once');
  { const r1 = await evt.json('/dayrune', 'POST'), r2 = await evt.json('/dayrune', 'POST');
    assert.ok(r1.rune && r1.rune.slug && r1.rune.name && r1.rune.answer, 'rune of the day has a name and an answer');
    assert.equal(r2.rune.slug, r1.rune.slug, 'the same rune all day'); assert.equal(count('dayrune_open'), 1, 'Rune of the day is drawn once and counted once');
    assert.ok((await evt.json('/entries')).items.some((i) => i.kind === 'dayrune' && i.title === r1.rune.name), 'rune of the day is recorded'); }
  await evt.json('/journal', 'POST', { text: 'Обычная запись' }); assert.equal(count('journal_add'), 1);
  await evt.json('/journal', 'POST', { text: 'Спасибо', kind: 'gratitude', title: 'Кому и за что я благодарна сегодня?' }); assert.equal(count('gratitude_add'), 1);
  await evt.json('/event', 'POST', { t: 'forecast_view' }); assert.equal(count('forecast_view'), 1);
  const { CORE_EVENTS } = await import(pathToFileURL(join(fixture, 'backend/events.mjs')).href);
  for (const k of ['gratitude_add', 'answer_add', 'mood_set', 'journal_add', 'habit_add', 'askesis_start']) assert.ok(CORE_EVENTS.includes(k), `${k} counts as a core action`);
  console.log('PASS: server records confirmed actions itself; /api/event accepts only client impressions; gratitude and daily-question answers count as activity.');

  // ── Адрес push-ячейки: только https на стандартном порту к публичному имени ──
  for (const bad of ['https://127.0.0.1/box', 'https://localhost/box', 'http://push.example.com/box', 'https://push.example.com:8443/box', 'https://[::1]/box', 'https://user:pw@push.example.com/box'])
    assert.equal((await evt.raw('/push', 'POST', { endpoint: bad })).status, 400, 'Rejected: ' + bad);
  assert.equal((await evt.raw('/push', 'POST', { endpoint: 'https://push.example.com/box/ok' })).status, 200);
  assert.equal(count('push_on'), 1);

  // ── Статус задачи меняет только сотрудник своей области ──
  const staffMail = 'content@example.test', code = '123456';
  qaDB.prepare('INSERT INTO staff (email, name, roles, added_by, created_at) VALUES (?,?,?,?,?)').run(staffMail, 'Редактор', JSON.stringify(['content']), 'test', new Date().toISOString());
  qaDB.prepare('INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts) VALUES (?,?,?,?,0)').run(staffMail, createHash('sha256').update(code + staffMail).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString());
  const staff = account(); await staff.json('/me'); await staff.json('/auth/verify', 'POST', { email: staffMail, code });
  const now = new Date().toISOString();
  qaDB.prepare("INSERT INTO tasks (title, text, role, status, priority, created_at, updated_at) VALUES ('Чужая', '', 'product', 'new', 'normal', ?, ?)").run(now, now);
  qaDB.prepare("INSERT INTO tasks (title, text, role, status, priority, created_at, updated_at) VALUES ('Своя', '', 'content', 'new', 'normal', ?, ?)").run(now, now);
  const foreign = qaDB.prepare("SELECT id FROM tasks WHERE title='Чужая'").get().id, own = qaDB.prepare("SELECT id FROM tasks WHERE title='Своя'").get().id;
  assert.equal((await staff.raw('/cabinet/tasks', 'POST', { id: foreign, status: 'done', onlyStatus: true })).status, 403);
  assert.equal(qaDB.prepare('SELECT status FROM tasks WHERE id=?').get(foreign).status, 'new');
  assert.equal((await staff.raw('/cabinet/tasks', 'POST', { id: own, status: 'done', onlyStatus: true })).status, 200);

  // ── Сессия: без cookie нет нового аккаунта; истёкшая сессия отвергается ──
  const usersBefore = qaDB.prepare('SELECT COUNT(*) c FROM users').get().c;
  assert.equal((await fetch(base + '/api/timeline?kind=&day=&offset=0')).status, 401);
  assert.equal((await fetch(base + '/api/nothing-here')).status, 401);
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users').get().c, usersBefore, 'Unknown or anonymous API calls must not create accounts');
  const expiring = account(); const expId = (await expiring.json('/me')).user.id;
  qaDB.prepare("UPDATE sessions SET created_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(expId);
  assert.equal((await expiring.raw('/timeline?kind=&day=&offset=0')).status, 401, 'A year-old session is rejected');
  assert.notEqual((await expiring.json('/me')).user.id, expId, 'After expiry /me starts a fresh session');
  console.log('PASS: push endpoints are validated, task status respects role scope, sessions expire and stray API calls create no accounts.');

  // ── Загрузки кабинета: SVG не принимается, файлы отдаются в sandbox без исполнения ──
  const mediaOf = (type) => staff.json('/cabinet/media', 'POST', { name: 'Проба', type, data: 'data:' + type + ';base64,' + png });
  assert.equal((await mediaOf('image/svg+xml')).error, 'bad_type', 'SVG upload is rejected: it would run scripts on the app origin');
  const uploaded = await mediaOf('image/png'); assert.ok(uploaded.ok && uploaded.url.startsWith('/app/uploads/'));
  const served = await fetch(base + uploaded.url.slice('/app'.length));
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-security-policy') || '', /sandbox/, 'Uploads are served with a sandbox CSP');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  console.log('PASS: cabinet uploads reject SVG and are served under a sandbox CSP with nosniff.');

  // ── F01 (ревью v114): архив версий читается только внутри папки контента — чужие имена, кодированные разделители,
  //    абсолютные пути и символьная ссылка наружу отклоняются; разрешенная версия читается ──
  { for (const bad of ['../..', '..%2F..', '/etc', 'руны.txt/..', 'руны.txt%00'])
      assert.equal((await staff.raw('/cabinet/versions?file=' + bad + '&id=synthetic.txt')).status, 400, 'archive: ' + bad);
    assert.equal((await staff.raw('/cabinet/versions?file=руны.txt&id=../../secret.key')).status, 400, 'a version id with .. is refused');
    assert.equal((await staff.raw('/cabinet/versions?file=руны.txt&id=%2Fetc%2Fpasswd')).status, 400, 'an absolute version id is refused');
    assert.equal((await staff.raw('/cabinet/versions?file=руны.txt&id=нет-такой.txt')).status, 400, 'an id not of our own form (время__кто.txt) is refused');
    assert.equal((await staff.raw('/cabinet/versions?file=руны.txt&id=2000-01-01T00-00-00.000__nobody.txt')).status, 404, 'a well-formed but missing version is 404, not an error');
    assert.equal((await staff.raw('/cabinet/versions', 'POST', { file: '../..', id: 'synthetic.txt', version: 'x' })).status, 400, 'restore checks the file name too');
    /* символьная ссылка наружу: имя версии приличное, но настоящий путь — вне контента; «секрет» — синтетический файл проверки */
    const { symlink } = await import('node:fs/promises');
    await writeFile(join(fixture, 'outside-secret.txt'), 'MARKER-снаружи');
    await mkdir(join(fixture, 'content', 'архив', 'руны.txt'), { recursive: true });
    await symlink(join(fixture, 'outside-secret.txt'), join(fixture, 'content', 'архив', 'руны.txt', '2026-01-01T00-00-00.000__evil.txt'));
    const viaLink = await staff.raw('/cabinet/versions?file=руны.txt&id=2026-01-01T00-00-00.000__evil.txt');
    assert.ok(viaLink.status === 400 || viaLink.status === 404, 'a symlink out of the archive is not served: ' + viaLink.status);
    assert.ok(!(await viaLink.text()).includes('MARKER'), 'no outside bytes leak through the archive');
    const CE0 = await import(pathToFileURL(join(fixture, 'backend/content-edit.mjs')).href);
    assert.equal(CE0.writeFile('руны.txt', CE0.readContent('руны.txt'), 'f01', CE0.fileVersion('руны.txt')).ok, true);
    const okId = CE0.versions('руны.txt').find((v) => v.by === 'f01').id;
    const okVersion = await staff.raw('/cabinet/versions?file=руны.txt&id=' + encodeURIComponent(okId));
    assert.equal(okVersion.status, 200, 'a real archived version is served'); assert.ok((await okVersion.json()).text.includes('==='), 'with its text');
    /* картинки: набор — только известный, идентификатор версии — только вида base__время__кто.ext */
    assert.equal((await staff.raw('/cabinet/image-versions?kind=nope&base=x')).status, 404);
    for (const bad of ['../../x.png', '/etc/passwd', 'x.svg', 'noseparator.png']) assert.equal((await staff.raw('/cabinet/image-versions?kind=runes', 'POST', { id: bad, key: 'fehu' })).status, 400, 'image archive: ' + bad);
    assert.equal((await staff.raw('/cabinet/image-versions?kind=runes', 'POST', { id: 'fehu__2026-01-01T00-00-00.000__x.png', key: 'fehu' })).status, 404, 'a missing image version is 404');
    const routesSrc = (await import('node:fs')).readFileSync(join(repo, 'backend/http/cabinet-routes.mjs'), 'utf8');
    assert.ok(!/(?<![.\w])join\(/.test(routesSrc) && !/CONTENT_DIR|IMAGE_DIRS\[|from 'node:path'.*join/.test(routesSrc), 'cabinet routes build no paths from request data — the repository does');
    console.log('PASS: F01 — content archive refuses foreign names, encoded separators, absolute paths and symlinks out of the tree; real versions are served; routes build no paths.'); }

  // ── Одна модель Луны: дневной пакет, «На небе» и досье считают фазу одной функцией lunar.mjs ──
  const { moonState, moonPhaseName, MOON_NAMES } = await import(pathToFileURL(join(fixture, 'backend/lunar.mjs')).href);
  const meMoon = await evt.json('/me');
  const noon = moonState(Date.parse(meMoon.day.date + 'T12:00:00Z'));
  assert.equal(meMoon.day.moon, noon.name, 'Day pack phase name comes from lunar.moonState');
  assert.equal(meMoon.day.moonPct, noon.illumination, 'Day pack illumination comes from lunar.moonState');
  assert.equal(Math.abs(meMoon.day.moonPhase - noon.cycle) < 0.001, true);
  const sky = await evt.json('/sky'); const nowMoon = moonState(Date.now());
  assert.equal(sky.moon.phase, nowMoon.name, 'Sky screen names the phase by the same rule');
  assert.ok(Math.abs(sky.moon.illumination - nowMoon.illumination) <= 1);
  assert.ok(MOON_NAMES.includes(meMoon.day.moon) && MOON_NAMES.includes(sky.moon.phase));
  for (const [cycle, name] of [[0, 'Новолуние'], [0.06, 'Новолуние'], [0.07, 'Растущий серп'], [0.25, 'Первая четверть'], [0.5, 'Полнолуние'], [0.75, 'Последняя четверть'], [0.9, 'Убывающий серп'], [0.95, 'Новолуние']]) assert.equal(moonPhaseName(cycle), name, `phase name at ${cycle}`);
  for (const at of ['2026-09-15T12:00:00Z', '2026-09-18T12:00:00Z', '2026-09-26T12:00:00Z']) { const m = moonState(Date.parse(at)); assert.ok(MOON_NAMES.includes(m.name) && m.illumination >= 0 && m.illumination <= 100, at); }
  const recentDoc = (await evt.json('/knowledge?doc=recent')).data;
  assert.equal(recentDoc.window, 120, 'Knowledge «recent» covers a 120-day window'); assert.ok(Array.isArray(recentDoc.days));
  console.log('PASS: day pack and sky screen share one moon model; knowledge «recent» is a 120-day window.');

  // ── Досье аскезы читает актуальный контракт: те же поля, что у практик, в тексте нет undefined ──
  const askOwner = account(); await askOwner.json('/me'); await askOwner.json('/profile', 'POST', { name: 'Аскеза', birth: '1988-08-08', city: 'Москва', consent: true });
  const askDay = (await askOwner.json('/me')).day.date, askUntil = new Date(Date.parse(askDay) + 29 * 864e5).toISOString().slice(0, 10);
  const started = (await askOwner.json('/askesis', 'POST', { title: 'Без сладкого', until: askUntil })).active[0];
  assert.deepEqual([started.total, started.done, started.left], [30, 1, 29]);
  const portraitAsk = (await askOwner.json('/knowledge?doc=portrait')).data.askesis[0];
  for (const k of ['title', 'done', 'total', 'until']) assert.ok(k in portraitAsk, `Knowledge portrait askesis carries ${k}`);
  assert.deepEqual([portraitAsk.done, portraitAsk.total, portraitAsk.until], [started.done, started.total, started.until]);
  const portraitText = (await askOwner.json('/knowledge/text?doc=portrait')).text;
  assert.ok(portraitText.includes('Без сладкого — день 1 из 30'), 'Portrait text uses the current askesis fields: ' + portraitText.split('\n').find((l) => l.startsWith('Аскезы')));
  assert.ok(!/undefined|NaN/.test(portraitText), 'No undefined in portrait text');
  console.log('PASS: knowledge portrait and its text use the same askesis contract as the practices model.');

  // ── «Я помню» (memory.mjs): любимый способ ответа, строка на карточке дня из вчерашнего настроения, вечерний пуш про аскезу ──
  { const d0 = (await askOwner.json('/me')).day.date, ago = (n) => new Date(Date.parse(d0 + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    for (const q of ['Стоит ли мне сейчас менять работу?', 'Получится ли у меня новый проект на работе?', 'Поговорить ли с начальником о повышении?']) await askOwner.json('/ask', 'POST', { question: q, kind: 'rune', layout: 'one' });
    assert.equal((await askOwner.json('/me')).memory.favorite, 'rune', 'Three rune asks make rune the favorite method');
    await askOwner.json('/day', 'POST', { day: ago(1), moods: ['quick:anxious'] });
    const line = (await askOwner.json('/day/bridge')).item;
    assert.ok(line && line.kind === 'вчера' && /^Вчера было тревожно/.test(line.text), 'Day line remembers yesterday in the words of память.txt: ' + JSON.stringify(line));
    assert.equal((await askOwner.json('/me')).memory.about, null, 'About line stays silent during the first week');
    for (const n of [2, 3]) await askOwner.json('/day', 'POST', { day: ago(n), moods: ['quick:anxious'] });
    const ev = (await askOwner.json('/reminders/preview?feature=evening')).item;
    assert.ok(ev && /тревожный день/.test(ev.title), 'Evening push sees three anxious days: ' + JSON.stringify(ev));
    qaDB.prepare("UPDATE askesis SET started = ? WHERE user_id = (SELECT id FROM users WHERE name = 'Аскеза')").run(ago(5));
    for (const n of [1, 2, 3]) await askOwner.json('/day', 'POST', { day: ago(n), moods: ['quick:calm'] });
    const ev2 = (await askOwner.json('/reminders/preview?feature=evening')).item;
    assert.equal(ev2 && ev2.title, 'Без сладкого: день 6 из 35', 'Askesis comes first in the evening push (start moved back 5 days, end fixed): ' + JSON.stringify(ev2));
    console.log('PASS: memory — favorite method, day line from yesterday, evening push sees askesis and anxious days.'); }

  // ── Прошлый день: дописать и поправить можно до года назад, серия не трогается; удалить блок; далекое прошлое — 400 ──
  { const me=await askOwner.json('/me'), y=new Date(Date.parse(me.day.date+'T12:00:00Z')-864e5).toISOString().slice(0,10), streak=me.user.streak;
    const st=await askOwner.json('/day?day='+y); assert.equal(st.today,false); assert.equal(st.day,y,'yesterday state is served as a past day');
    const r=await askOwner.json('/day','POST',{day:y,text:'Дописала утром',moods:['joy']}); assert.ok(r.ok&&r.saved.includes('text')&&r.today===false,'a past day is saved');
    assert.equal((await askOwner.json('/me')).user.streak,streak,'editing yesterday does not touch the streak');
    assert.equal((await askOwner.json('/days?calendar=1')).items[0].text,'Дописала утром','the past-days list shows the late entry');
    assert.equal((await askOwner.json('/day?day='+y+'&what=moods','DELETE')).removed,1,'a block of a day can be deleted');
    assert.equal((await askOwner.raw('/day','POST',{day:'2020-01-01',text:'x'})).status,400,'days older than a year are not editable');
    console.log('PASS: a past day can be written and corrected within a year; deleting a block works; the streak stays.'); }

  // ── Аудит v98 (F01–F19): удаление одной записи, повтор без дубля, отклик в составе дня, честный лимит, мысль к результату,
  //    открытый вопрос, настоящие даты, частичные настройки, все отметки настроения в отчете и выгрузке, старый день только для чтения ──
  { const aud = account(); const me = await aud.json('/me'), d0 = me.day.date, uid = me.user.id;
    await aud.json('/profile', 'POST', { name: 'Аудит', birth: '1991-03-03', city: 'Москва', consent: true });
    /* F02: тот же ключ операции — тот же ответ, второй благодарности нет; тот же ключ с другим текстом — конфликт */
    const op = 'op-check-' + Date.now().toString(36);
    const g1 = await aud.json('/journal', 'POST', { text: 'Маме — за звонок', kind: 'gratitude', op });
    const g2 = await aud.json('/journal', 'POST', { text: 'Маме — за звонок', kind: 'gratitude', op });
    assert.equal(g2.item.id, g1.item.id, 'repeat with the same op returns the same item'); assert.equal(g2.repeated, true);
    assert.equal(qaDB.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND kind = 'gratitude'").get(uid).c, 1, 'one gratitude after a repeated save');
    assert.equal((await aud.raw('/journal', 'POST', { text: 'Другой текст', kind: 'gratitude', op })).status, 409, 'same op with another body is a conflict');
    /* F01, F17: две записи одного вида за день видны обе; удаляется одна по id, первая остается и входит в выгрузку; лента — страницами */
    await aud.json('/journal', 'POST', { text: 'Первая запись дня' }); await aud.json('/journal', 'POST', { text: 'Вторая запись дня' });
    const st = await aud.json('/day'); assert.equal(st.texts.length, 2, 'both entries of the day are served'); assert.equal(st.text.text, 'Вторая запись дня', 'the cell for editing is the latest one');
    assert.equal((await aud.json(`/day?day=${d0}&what=text:${st.texts[1].id}`, 'DELETE')).removed, 1, 'one entry is deleted by id');
    const view = await aud.json('/day/view?day=' + d0); assert.deepEqual(view.texts.map((t) => t.text), ['Первая запись дня'], 'the other entry survives');
    assert.ok((await aud.json('/data/export')).journal.some((j) => j.text === 'Первая запись дня'), 'and is in the export');
    const page = await aud.json('/journal?limit=1'); assert.equal(page.items.length, 1); assert.ok(page.next, 'journal pages have a continuation');
    assert.ok((await aud.json('/journal?limit=1&before=' + page.next)).items[0].id < page.items[0].id, 'before= continues from the last shown id');
    /* F05: «отозвалось» — в той же операции дня; пустая строка снимает; мусор — отказ */
    assert.equal((await aud.json('/day', 'POST', { moods: ['joy', 'trust'], echo: 'yes' })).echo, 'yes', 'echo is saved with the day');
    assert.equal((await aud.json('/day', 'POST', { echo: '' })).echo, '', 'an empty echo clears the mark');
    assert.equal((await aud.raw('/day', 'POST', { echo: 'maybe' })).status, 400, 'an unknown verdict is refused');
    /* F10, F26: две отметки за день одинаково видны в дне, отчете и выгрузке; одна отметка не превращается в вывод о неделе; ключи не попадают в текст */
    assert.deepEqual((await aud.json('/day')).moods, ['joy', 'trust']);
    const rep = await aud.json('/mood/report'); const todayRow = rep.week.find((w) => w.day === d0);
    assert.deepEqual(todayRow.moods, ['joy', 'trust'], 'the report week row carries every mark'); assert.equal(rep.month.marks >= 2, true);
    assert.ok(!/ровным|непрост/.test(rep.summary), 'one observed day gives no verdict about the week: ' + rep.summary); assert.ok(!/\bjoy\b|\btrust\b/.test(rep.summary), 'no raw keys in the summary');
    const ex = await aud.json('/data/export'); const exDay = ex.moods.find((m) => m.day === d0); assert.deepEqual(exDay.marks, ['joy', 'trust'], 'export carries all marks'); assert.ok(Array.isArray(ex.limits) && ex.limits.length, 'export names what it does not contain');
    /* F13, F12: мысль привязана к результату — две одинаковые руны на два вопроса дают две мысли; повтор к тому же результату обновляет только ее; расклад тоже принимает мысль */
    const a1 = await aud.json('/ask', 'POST', { question: 'Стоит ли мне менять работу сейчас?', kind: 'rune' });
    const a2 = await aud.json('/ask', 'POST', { question: 'Получится ли переезд в этом году?', kind: 'rune' });
    assert.ok(a1.entry > 0 && a2.entry > a1.entry, 'asks return their result id');
    await aud.json('/thought', 'POST', { source: 'rune', slug: 'fehu', name: 'Феху', question: 'Стоит ли мне менять работу сейчас?', text: 'Про работу', entry: a1.entry });
    await aud.json('/thought', 'POST', { source: 'rune', slug: 'fehu', name: 'Феху', question: 'Получится ли переезд в этом году?', text: 'Про переезд', entry: a2.entry });
    const upd = await aud.json('/thought', 'POST', { source: 'rune', slug: 'fehu', name: 'Феху', question: 'Стоит ли мне менять работу сейчас?', text: 'Про работу — дополнила', entry: a1.entry });
    assert.equal(upd.updated, true);
    const th = (await aud.json('/thoughts')).items.filter((t) => t.slug === 'fehu'); assert.equal(th.length, 2, 'same rune, two questions — two thoughts');
    assert.deepEqual(th.map((t) => t.text).sort(), ['Про переезд', 'Про работу — дополнила']);
    const sp = await aud.json('/spread', 'POST', { question: 'Что мне важно понять про отношения?', layout: 'three' });
    assert.ok((await aud.json('/thought', 'POST', { source: 'spread', slug: 'three', name: 'Три карты', question: 'Что мне важно понять про отношения?', text: 'Мысль к раскладу', entry: sp.entry })).item.entry === sp.entry, 'a spread takes a thought bound to its result');
    assert.equal((await aud.json('/thought', 'POST', { source: 'runes', slug: 'three', name: 'Три руны', text: 'Чужой id не привязывается', entry: 99999999 })).item.entry, 0, 'a foreign result id is dropped');
    const exTh = (await aud.json('/data/export')).journal.find((j) => j.kind === 'thought' && j.text === 'Мысль к раскладу'); assert.equal(exTh.thought.name, 'Три карты', 'export keeps the thought source'); assert.equal(exTh.title, '');
    /* F19: «как…» — не вопрос про да/нет; «как думаешь, стоит ли…» — да/нет */
    assert.equal((await aud.raw('/ask', 'POST', { question: 'Как спокойно подготовиться к разговору?', kind: 'yesno' })).status, 400, 'an open question gets no yes/no');
    assert.equal((await aud.raw('/ask', 'POST', { question: 'Как спокойно подготовиться к разговору?', kind: 'yesno' }).then((r) => r.json())).error, 'open_question');
    assert.equal((await aud.raw('/ask', 'POST', { question: 'Как думаешь, стоит ли мне идти на этот разговор?', kind: 'yesno' })).status, 200);
    assert.equal((await aud.raw('/ask', 'POST', { question: 'Как спокойно подготовиться к разговору?', kind: 'rune' })).status, 200, 'runes take open questions');
    /* F14: настоящие календарные даты */
    for (const bad of ['2026-02-31', '2026-04-31', '2025-02-29']) { assert.equal((await aud.raw('/day/view?day=' + bad)).status, 400, bad + ' is refused'); assert.equal((await aud.raw('/day', 'POST', { day: bad, text: 'x' })).status, 400); assert.equal((await aud.raw('/week/echo', 'POST', { day: bad, verdict: 'yes' })).status, 400); }
    assert.equal((await aud.raw('/day/view?day=2024-02-29')).status, 200, 'a leap day is a real date');
    assert.equal((await aud.raw('/profile', 'POST', { name: 'Аудит', birth: '1990-02-30', city: 'Москва', consent: true })).status, 400, 'birth must be a real date');
    /* F18: старый день — чтение с причиной, а не бесполезный повтор */
    const old = await aud.json('/day/view?day=2024-01-01'); assert.equal(old.editable, false); assert.ok(old.editableFrom > '2024-01-01', 'the view says from which day editing is possible');
    const oldEdit = await aud.raw('/day?day=2024-01-01'); assert.equal(oldEdit.status, 400); assert.equal((await oldEdit.json()).error, 'not_editable');
    /* F16: уходят только измененные поля — тема из одной «вкладки» не затирается выбором утра из другой */
    await aud.json('/preferences', 'POST', { theme: 'light' }); const pr = await aud.json('/preferences', 'POST', { morning: ['lunar'] });
    assert.equal(pr.preferences.theme, 'light', 'a partial save keeps the other fields'); assert.deepEqual(pr.preferences.morning, ['lunar']);
    assert.equal((await aud.raw('/preferences', 'POST', { theme: 'neon' })).status, 400, 'the merged object is still validated');
    /* F15: лимит строк за день — явный отказ до записи, ничего не сохраняется; правка существующей записи работает */
    let limit = 0; for (let i = 0; i < 150 && !limit; i++) { const r = await aud.raw('/journal', 'POST', { text: 'Благодарность номер ' + i, kind: 'gratitude' }); if (r.status === 429) limit = (await r.json()).limit; else assert.equal(r.status, 200); }
    assert.ok(limit > 0, 'the limit is reached and named');
    const before = qaDB.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(uid, d0).c;
    const full = await aud.raw('/day', 'POST', { answer: 'Новый ответ сверх лимита', question: 'Вопрос' }); assert.equal(full.status, 429, 'the day card refuses a new line over the limit'); assert.equal((await full.json()).error, 'too_many');
    assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM journal WHERE user_id = ? AND day = ?').get(uid, d0).c, before, 'nothing was written');
    assert.equal((await aud.json('/day', 'POST', { text: 'Первая запись дня — поправлена' })).text.text, 'Первая запись дня — поправлена', 'editing an existing entry still works at the limit');
    console.log('PASS: audit v98 — delete one entry by id, repeat without a duplicate, echo inside the day, honest limit, thought per result, open questions, real dates, partial preferences, all mood marks everywhere, old days read-only.'); }

  // ── Аудит v98 (F08, F03, F04): неделя видит мысль и фото; карточка справочника — по ключу и версии; архив не перезаписывается ──
  { const w = account(); const me = await w.json('/me'), d0 = me.day.date;
    await w.json('/thought', 'POST', { source: 'card', slug: 'sun', name: 'Солнце', question: '', text: 'Мысль к карте — единственный момент недели' });
    const wk = await w.json('/week'); assert.notEqual(wk.mode, 'empty', 'a week with one thought is not empty'); assert.equal(wk.moments, 1);
    assert.ok(wk.saved.some((f) => f.kind === 'thought' && f.name === 'Солнце'), 'the thought is a fragment with its material: ' + JSON.stringify(wk.saved));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    await fetch(`${base}/api/day/photo?thumb=${jpeg.length}&w=100&h=100`, { method: 'PUT', headers: { Cookie: w.cookie, 'Content-Type': 'application/octet-stream', 'X-Forwarded-For': w.ip }, body: Buffer.concat([jpeg, jpeg]) });
    assert.equal((await w.json('/week')).counts.photos, 1, 'a day photo counts as a moment');
    const CE = await import(pathToFileURL(join(fixture, 'backend/content-edit.mjs')).href);
    const recs = CE.bookRecords('руны.txt'), r0 = recs[0], v0 = r0.version; assert.ok(v0 && recs.every((r) => r.version === v0));
    const n0 = CE.versions('руны.txt').length;
    assert.equal(CE.bookRecordSave('руны.txt', { key: r0.key, version: v0, title: r0.title, fields: r0.fields, body: r0.body + '\n\nПроверка правки.' }, 'test').ok, true, 'a record saves by key and version');
    assert.equal(CE.bookRecordSave('руны.txt', { key: r0.key, version: v0, title: r0.title, fields: r0.fields, body: r0.body }, 'test').error, 'conflict', 'a stale version is a conflict, not an overwrite');
    assert.equal(CE.bookRecordSave('руны.txt', { key: 'нет-такой-руны', title: 'x' }, 'test').error, 'not_found');
    assert.equal(CE.bookRecords('руны.txt').find((r) => r.key === r0.key).body.endsWith('Проверка правки.'), true, 'the right record changed');
    for (let i = 0; i < 3; i++) assert.equal(CE.writeFile('руны.txt', CE.readContent('руны.txt'), 'test', CE.fileVersion('руны.txt')).ok, true);   /* три записи подряд внутри одной секунды, каждая — с прочитанной версией */
    const vs = CE.versions('руны.txt'); assert.equal(vs.length, n0 + 4, 'every save leaves its own archive version'); assert.equal(new Set(vs.map((x) => x.id)).size, vs.length); assert.ok(vs.every((x) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(x.ts)), 'version time parses: ' + vs[0].ts);
    console.log('PASS: audit v98 — a week counts thoughts and photos; catalog records save by key and version with conflicts; archive names are unique.'); }

  // ── Повторный аудит v112: квитанции без текста (R02), уточнение после обрыва (R04), желания и привычки (R05, R13), свежесть базы знаний (R08),
  //    портрет и все отметки (R09), совместимость в выгрузке (R10), итог недели в архиве (R12), лунный день записи (R18), таблицы по версии (R03) ──
  { const rq = account(); const me = await rq.json('/me'), d0 = me.day.date, uid = me.user.id;
    await rq.json('/profile', 'POST', { name: 'Повтор', birth: '1992-05-05', city: 'Москва', consent: true });
    /* R02: в квитанции нет личного текста; повтор после удаления не «сохраняет» удаленное */
    const op = 'op-recheck-' + Date.now().toString(36);
    const g = await rq.json('/journal', 'POST', { text: 'Секретная благодарность подруге', kind: 'gratitude', op });
    const rc = qaDB.prepare('SELECT response_json, payload_hash FROM sync_receipts WHERE user_id = ? AND operation_id = ?').get(uid, op);
    assert.ok(rc && !rc.response_json.includes('Секретная') && !rc.response_json.includes('подруге'), 'the receipt holds a reference, not the text: ' + rc.response_json);
    assert.equal(JSON.parse(rc.response_json).id, g.item.id);
    const again = await rq.json('/journal', 'POST', { text: 'Секретная благодарность подруге', kind: 'gratitude', op }); assert.equal(again.repeated, true); assert.equal(again.item.id, g.item.id, 'a plain repeat returns the living record');
    await rq.json(`/day?day=${d0}&what=gratitude:${g.item.id}`, 'DELETE');
    const after = await rq.json('/journal', 'POST', { text: 'Секретная благодарность подруге', kind: 'gratitude', op });
    assert.equal(after.repeated, true); assert.equal(after.removed, true); assert.equal(after.item, null, 'a repeat after deletion says the record is gone');
    assert.equal(qaDB.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND kind = 'gratitude'").get(uid).c, 0, 'and recreates nothing');
    /* R04: тот же ключ с другим текстом — конфликт с найденной записью, и правка по ней оставляет одну запись */
    const op2 = 'op-edit-' + Date.now().toString(36);
    const first = await rq.json('/journal', 'POST', { text: 'Первый вариант текста', kind: 'gratitude', op: op2 });
    const conflict = await rq.raw('/journal', 'POST', { text: 'Уточненный вариант текста', kind: 'gratitude', op: op2 }); assert.equal(conflict.status, 409);
    const cb = await conflict.json(); assert.equal(cb.item && cb.item.id, first.item.id, 'the conflict names the record found by the key');
    await rq.json('/journal', 'PATCH', { id: cb.item.id, text: 'Уточненный вариант текста' });
    assert.deepEqual((await rq.json('/journal?kind=gratitude')).items.map((i) => i.text), ['Уточненный вариант текста'], 'one record with the last text');
    /* R05: желание с ключом операции; привычка — желаемое состояние; R13: неверная дата — ошибка, не «сегодня» */
    const wop = 'op-wish-' + Date.now().toString(36);
    await rq.json('/wishes', 'POST', { text: 'Поездка к морю', op: wop }); const w2 = await rq.json('/wishes', 'POST', { text: 'Поездка к морю', op: wop });
    assert.equal(w2.repeated, true); assert.equal(w2.items.filter((w) => w.text === 'Поездка к морю').length, 1, 'a repeated wish creation gives one wish');
    const hb = (await rq.json('/habits', 'POST', { title: 'Прогулка', rule: 'каждый день' })).items[0];
    await rq.json('/habits', 'PATCH', { id: hb.id, done: true }); const twice = await rq.json('/habits', 'PATCH', { id: hb.id, done: true });
    assert.equal(twice.items.find((h) => h.id === hb.id).today, true, 'done=true twice keeps the habit done (R05)');
    assert.equal((await rq.raw('/habits', 'PATCH', { id: hb.id, day: '2026-02-31' })).status, 400, 'an impossible habit date is refused (R13)');
    assert.equal((await rq.raw('/habits', 'PATCH', { id: hb.id, day: new Date(Date.parse(d0 + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10) })).status, 400, 'a future date is refused');
    assert.equal((await rq.json('/habits')).items.find((h) => h.id === hb.id).today, true, 'and today\'s mark is untouched');
    /* R08: база знаний видит запись и ее удаление без ручной пересборки */
    await rq.json('/knowledge?doc=recent');
    const j = await rq.json('/journal', 'POST', { text: 'Запись, которая должна попасть в базу знаний сразу' });
    const rec1 = (await rq.json('/knowledge?doc=recent')).data.days.find((x) => x.day === d0);
    assert.ok(rec1 && rec1.text === 'Запись, которая должна попасть в базу знаний сразу', 'recent reflects a new entry on the next read (R08): ' + JSON.stringify(rec1));
    await rq.json(`/day?day=${d0}&what=text:${j.item.id}`, 'DELETE');
    const rec2 = (await rq.json('/knowledge?doc=recent')).data.days.find((x) => x.day === d0);
    assert.ok(!rec2 || rec2.text === undefined, 'a deleted entry leaves the recent document: ' + JSON.stringify(rec2));
    assert.ok((await rq.json('/knowledge/text?doc=recent')).text.includes('Запись, которая') === false);
    /* R09: портрет считает все отметки дня */
    await rq.json('/day', 'POST', { moods: ['joy', 'trust'] });
    const portrait = (await rq.json('/knowledge?doc=portrait')).data;
    assert.deepEqual(portrait.moods90.map((m) => m.mood.toLowerCase()).sort(), ['доверие', 'радость'], 'the portrait keeps both marks of the day (R09): ' + JSON.stringify(portrait.moods90));
    assert.equal(portrait.moodDays90, 1); assert.equal(portrait.moodMarks90, 2);
    /* R10: совместимость — в выгрузке, и у каждой таблицы истории названо, где она в выгрузке */
    await rq.json('/compat', 'POST', { birth: '1991-11-11' });
    const ex = await rq.json('/data/export'); assert.equal(ex.compat.length, 1); assert.equal(ex.compat[0].other_birth, '1991-11-11'); assert.ok(ex.compat[0].rings.length === 4 && ex.compat[0].text);
    const { PERSONAL_DATA: PD } = await import(pathToFileURL(join(fixture, 'backend/account-data.mjs')).href);
    for (const row of PD.filter((r) => r.on === 'history')) { assert.ok('exported' in row, `${row.table}: where it is exported is named`); if (row.exported) assert.ok(Array.isArray(ex[row.exported]), `${row.table} → export.${row.exported}`); }
    const { personalExportPdf: pdfFn } = await import(pathToFileURL(join(fixture, 'backend/personal-export-pdf.mjs')).href);
    assert.ok(pdfFn(ex, {}).length > 1000, 'the PDF builds with the compatibility section');
    /* R16: кольца совместимости выводятся из названных правил, метод и вопрос — рядом */
    const cmp = await rq.json('/compat', 'POST', { birth: '1991-11-11' });
    assert.ok(cmp.rings.every((r) => r.length === 3 && /по (стихиям|крестам|углу|притяжению)/.test(r[2])), 'every ring names its rule: ' + JSON.stringify(cmp.rings));
    assert.ok(cmp.method && cmp.question);
    /* R12: день только с итогом недели — в архиве и не пустой */
    const old = new Date(Date.parse(d0 + 'T12:00:00Z') - 20 * 864e5).toISOString().slice(0, 10);
    const wk = await rq.json('/week/reflect', 'POST', { week: old, text: 'Итог давней недели без других записей' });
    const days = await rq.json('/days?limit=60'); const row = days.items.find((x) => x.day === wk.day);
    assert.ok(row && !row.empty && row.text.startsWith('Итог давней недели'), 'a weekly-only day is listed in the archive (R12): ' + JSON.stringify(row));
    assert.equal((await rq.json('/day/view?day=' + wk.day)).weekly.text, 'Итог давней недели без других записей');
    /* R18: лунный день записи — фиксированный момент, с переходом при смене за сутки */
    const view = await rq.json('/day/view?day=' + wk.day); assert.ok(view.lunar && view.lunar.at === '21:00' && 'nFrom' in view.lunar, 'the record lunar day carries its moment: ' + JSON.stringify(view.lunar));
    /* R03: таблица сохраняется по версии; сырой файл — тоже; откат — тоже */
    const CE2 = await import(pathToFileURL(join(fixture, 'backend/content-edit.mjs')).href);
    const t0 = CE2.tableRows('привычки.txt'); assert.ok(t0.version);
    assert.equal(CE2.tableSave('привычки.txt', [...t0.rows, ['Проверка первой вкладки']], 'a', t0.version).ok, true);
    const t1 = CE2.tableSave('привычки.txt', [...t0.rows, ['Проверка второй вкладки']], 'b', t0.version); assert.equal(t1.error, 'conflict', 'the second tab with the old version gets a conflict, the first edit stays');
    assert.ok(CE2.tableRows('привычки.txt').rows.some((r) => r[0] === 'Проверка первой вкладки'));
    assert.equal(CE2.tableSave('привычки.txt', t0.rows, 'c').error, 'no_version', 'a table save without a version is refused');
    const raw = CE2.contentRead('привычки.txt'); assert.equal(CE2.writeContent('привычки.txt', raw.text, 'd', 'stale').error, 'conflict'); assert.equal(CE2.writeContent('привычки.txt', raw.text, 'd', raw.version).ok, true);
    assert.throws(() => CE2.writeFile('привычки.txt', 'x', 'e'), /версия/, 'the low-level write demands a version');
    console.log('PASS: audit v112 — receipts without text and honest repeats, edit after a lost response, wishes and habits repeat safely, invalid habit dates refused, knowledge base fresh within the day, portrait counts every mark, compatibility exported with a named basis, weekly-only days in the archive, record lunar day fixed, tables and raw files save by version.'); }

  // ── F04 (ревью v114): ревизией личных данных владеет тот, кто пишет — тест-страж по каждой таблице PERSONAL_DATA с on:'history':
  //    типичная запись через API поднимает users.data_rev ровно на 1, отклоненный запрос не трогает ее; гонка «ревизия раньше данных» воспроизведена ──
  { const g = account(); const gMe = await g.json('/me'), gId = gMe.user.id, d0 = gMe.day.date;
    await g.json('/profile', 'POST', { name: 'Страж ревизии', birth: '1990-05-05', city: 'Москва', consent: true });
    const rev = () => qaDB.prepare('SELECT data_rev FROM users WHERE id = ?').get(gId).data_rev;
    const untilG = new Date(Date.parse(d0 + 'T12:00:00Z') + 9 * 864e5).toISOString().slice(0, 10);
    let habitG = null, askG = null;
    const jpegG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, 5)]);
    /* какой запрос какую таблицу трогает — это и есть документация пути записи; null — таблица без действия человека, причина рядом */
    const WRITES = [
      ['entries', () => g.json('/ask', 'POST', { question: 'Стоит ли мне сегодня начать новое дело?', kind: 'yesno' })],
      ['usage', () => g.json('/spread', 'POST', { question: 'Что мне важно понять про эту неделю?', layout: 'three' })],
      ['moods', () => g.json('/mood', 'POST', { mood: 'joy' })],
      ['mood_marks', () => g.json('/day', 'POST', { moods: ['trust', 'joy'] })],
      ['journal', () => g.json('/journal', 'POST', { text: 'Запись для стража ревизии' })],
      ['sync_receipts', () => g.json('/journal', 'POST', { text: 'Запись с ключом операции', kind: 'gratitude', op: 'op-guard-' + Date.now().toString(36) })],
      ['week_echoes', () => g.json('/week/echo', 'POST', { day: d0, verdict: 'yes' })],
      ['day_photos', () => fetch(`${base}/api/day/photo?thumb=${jpegG.length}&w=100&h=100`, { method: 'PUT', headers: { Cookie: g.cookie, 'Content-Type': 'application/octet-stream', 'X-Forwarded-For': g.ip }, body: Buffer.concat([jpegG, jpegG]) }).then((r) => assert.equal(r.status, 200))],
      ['wishes', () => g.json('/wishes', 'POST', { text: 'Желание стража' })],
      ['habits', async () => { habitG = (await g.json('/habits', 'POST', { title: 'Привычка стража', rule: 'каждый день' })).items[0]; }],
      ['habit_marks', () => g.json('/habits', 'PATCH', { id: habitG.id, done: true })],
      ['askesis', async () => { askG = (await g.json('/askesis', 'POST', { title: 'Аскеза стража', until: untilG })).active[0]; }],
      ['askesis_days', () => g.json('/askesis', 'PATCH', { id: askG.id, note: 'Заметка стража' })],
      ['compat_checks', () => g.json('/compat', 'POST', { birth: '1991-11-11' })],
      ['daily_sets', null, 'настрой дня выпадает сервером на первом /me дня — не действие человека, документ дня и так собирается заново'],
      ['habit_awards', null, 'больше не пишется (награды сняты)'],
      ['knowledge', null, 'производная: собирается из остального и хранит ревизию, с которой собрана — сама ее не двигает'],
    ];
    const { PERSONAL_DATA: PDG } = await import(pathToFileURL(join(fixture, 'backend/account-data.mjs')).href);
    for (const row of PDG.filter((r) => r.on === 'history')) assert.ok(WRITES.some(([t]) => t === row.table), `guard lists ${row.table}`);
    for (const [table, act, why] of WRITES) {
      if (!act) { assert.ok(why, table + ' explains why no write'); continue; }
      const before = rev(); await act(); assert.equal(rev(), before + 1, `${table}: one write raises data_rev by exactly 1`);
    }
    /* отклоненный ввод ревизию не трогает: короткая запись, чужая привычка, мусорный отклик */
    const r0 = rev();
    assert.equal((await g.raw('/journal', 'POST', { text: 'ab' })).status, 400);
    assert.equal((await g.raw('/day', 'POST', { echo: 'maybe' })).status, 400);
    assert.equal((await g.raw('/habits', 'PATCH', { id: 99999999, done: true })).status, 404);
    assert.equal((await g.raw('/day', 'DELETE')).status, 400);
    assert.equal(rev(), r0, 'refused requests leave data_rev alone');
    /* удаление и очистка — тоже записи */
    const jg = await g.json('/journal', 'POST', { text: 'Запись, которую удалят' }); const r1 = rev();
    await g.json(`/day?day=${d0}&what=text:${jg.item.id}`, 'DELETE'); assert.equal(rev(), r1 + 1, 'a delete raises data_rev');
    const r2 = rev(); await g.json('/data', 'DELETE'); assert.equal(rev(), r2 + 1, 'clearing the history raises data_rev inside its own transaction');
    /* в маршрутизаторе больше нет списка путей: ревизией владеет запись */
    const srvSrc = (await import('node:fs')).readFileSync(join(repo, 'backend/server.mjs'), 'utf8');
    assert.ok(!/DATA_PATHS|touchData/.test(srvSrc), 'server.mjs holds no path list for the revision');
    /* гонка из ревью: POST /journal уходит по частям — заголовки и половина тела; пока тело не дошло, читается recent; потом тело досылается.
       Раньше ревизия поднималась до чтения тела: сводка собиралась без записи, но под новой ревизией, и считала себя свежей */
    const rc = account(); const rcMe = await rc.json('/me'), rcDay = rcMe.day.date;
    await rc.json('/profile', 'POST', { name: 'Гонка', birth: '1990-06-06', city: 'Москва', consent: true });
    await rc.json('/knowledge?doc=recent');
    const bodyBuf = Buffer.from(JSON.stringify({ text: 'Запись во время гонки ревизии' })), half = Math.floor(bodyBuf.length / 2);
    const sock = netConnect(port, '127.0.0.1'); await once(sock, 'connect');
    let reply = ''; sock.on('data', (c) => { reply += c; }); const closed = once(sock, 'close');
    sock.write(`POST /app/api/journal HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${rc.cookie}\r\nX-Forwarded-For: ${rc.ip}\r\nContent-Type: application/json\r\nContent-Length: ${bodyBuf.length}\r\nConnection: close\r\n\r\n`);
    sock.write(bodyBuf.subarray(0, half)); await delay(150);
    const during = (await rc.json('/knowledge?doc=recent')).data.days.find((x) => x.day === rcDay);
    assert.ok(!during || !JSON.stringify(during).includes('во время гонки'), 'before the body arrives the record is not in the summary');
    sock.write(bodyBuf.subarray(half)); await closed;
    assert.match(reply, /^HTTP\/1\.1 200/, 'the split request is accepted: ' + reply.slice(0, 60));
    const after = (await rc.json('/knowledge?doc=recent')).data.days.find((x) => x.day === rcDay);
    assert.ok(after && JSON.stringify(after).includes('Запись во время гонки ревизии'), 'after the write the summary is fresh, not signed with a revision it never saw: ' + JSON.stringify(after));
    console.log('PASS: F04 — every personal-data table has a named write that raises data_rev by exactly one, refusals do not, the router keeps no path list, and the review race yields a fresh summary.'); }

  // ── Фото дня: байты уходят без JSON, хранятся зашифрованными, отдаются только своему человеку; не-JPEG и лишний размер отбрасываются ──
  { const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
    const put = (who, thumb, full, q = '') => fetch(`${base}/api/day/photo?thumb=${thumb.length}&w=1280&h=960${q}`, { method: 'PUT', headers: { Cookie: who.cookie, 'Content-Type': 'application/octet-stream', 'X-Forwarded-For': who.ip }, body: Buffer.concat([thumb, full]) });
    const r1 = await put(askOwner, jpeg(3000), jpeg(120000)); assert.equal(r1.status, 200); const j1 = await r1.json(); assert.ok(j1.ok && j1.photo.ts && j1.photo.w === 1280, 'day photo accepted');
    const rowPh = qaDB.prepare('SELECT thumb, full FROM day_photos WHERE user_id = ?').get((await askOwner.json('/me')).user.id);
    assert.ok(rowPh && !(rowPh.full[0] === 0xff && rowPh.full[1] === 0xd8) && !(rowPh.thumb[0] === 0xff && rowPh.thumb[1] === 0xd8), 'photo bytes are sealed at rest, not raw JPEG');
    const today = (await askOwner.json('/me')).day.date;
    const g = await askOwner.raw(`/day/photo?day=${today}&size=full`); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/jpeg'); assert.equal((await g.arrayBuffer()).byteLength, 120004, 'full photo comes back byte for byte');
    assert.ok((await askOwner.json('/day')).photo && (await askOwner.json(`/days?calendar=1`)).items.length === 1, 'day state carries the photo');
    const stranger = account(); await stranger.json('/me'); await stranger.json('/profile', 'POST', { name: 'Чужая', birth: '1990-01-01', city: 'Москва', consent: true });
    assert.equal((await stranger.raw(`/day/photo?day=${today}&size=full`)).status, 404, 'another account cannot read the photo');
    assert.equal((await put(askOwner, jpeg(3000), Buffer.alloc(120000, 1))).status, 400, 'only JPEG is accepted');
    assert.equal((await put(askOwner, jpeg(3000), jpeg(430 * 1024))).status, 413, 'oversized photo is refused before parsing');
    assert.equal((await askOwner.json('/day/photo', 'DELETE')).removed, true); assert.equal((await askOwner.raw(`/day/photo?day=${today}&size=thumb`)).status, 404, 'photo is gone after delete');
    console.log('PASS: day photo is stored sealed, served only to its owner as JPEG, validated by type and size, deleted on request.'); }

  // ── Раскладов в день — без лимита (решение владелицы 18.09); /api/me не сообщает о квоте, ошибки limit не бывает ──
  assert.ok(!('limits' in (await askOwner.json('/me'))), 'No spread quota is reported');
  for (let i = 0; i < 5; i++) {
    const r = await askOwner.json('/spread', 'POST', { question: 'Что мне важно понять про эту неделю?', layout: 'three' });
    assert.ok(r.ok && r.cards.length === 3 && !('left' in r), `Spread ${i + 1} succeeds without a quota`);
  }
  console.log('PASS: tarot spreads are unlimited; the API reports no quota.');

  // ── База знаний: папка документов из журнала — профиль пересобирается по анкете, совместимость ложится в «Тесты и совместимости», записи — после пересборки ──
  const askId = (await askOwner.json('/me')).user.id;
  const docsNow = (await askOwner.json('/knowledge')).docs.map((x) => x.doc);
  for (const k of ['profile', 'readings', 'recent', 'portrait']) assert.ok(docsNow.includes(k), `Knowledge has «${k}»`);
  await askOwner.json('/profile', 'POST', { name: 'Аскеза-2', birth: '1988-08-08', city: 'Москва', consent: true });
  const prof = (await askOwner.json('/knowledge?doc=profile')).data;
  assert.equal(prof.name, 'Аскеза-2', 'Profile rebuilds on anketa'); assert.ok(prof.natal && prof.natal.planets.length >= 10 && prof.natal.aspects.length, 'Natal chart is stored verbatim: planets and aspects');
  assert.ok(prof.natal.planets.every((p) => p.name && p.sign && p.degree), 'Every planet carries name, sign and degree');
  assert.ok(prof.natal.summary.length >= 1 && prof.natal.summary.every((x) => x.title && x.gist), 'Natal summary is built by rules from content: ' + JSON.stringify(prof.natal.summary[0]));
  assert.ok(['огонь', 'земля', 'воздух', 'вода'].includes(prof.natal.balance.dominant), 'Dominant element is one of four');
  const natalScreen = await askOwner.json('/natal');
  assert.deepEqual(natalScreen.meanings.summary.map((x) => x.title), prof.natal.summary.map((x) => x.title), 'Screen and knowledge base share one summary');
  assert.ok((await askOwner.json('/knowledge/text?doc=profile')).text.includes('Резюме:'), 'Profile text opens with the natal summary');
  const cmp = await askOwner.json('/compat', 'POST', { birth: '1991-03-14' });
  const readings = (await askOwner.json('/knowledge?doc=readings')).data;
  assert.equal(readings.compat.length, 1); assert.equal(readings.compat[0].total, cmp.total); assert.equal(readings.compat[0].otherBirth, '1991-03-14');
  assert.ok((await askOwner.json('/knowledge/text?doc=readings')).text.includes(`${cmp.total}%`), 'Readings text carries the compatibility');
  await askOwner.json('/mood', 'POST', { mood: 'trust' }); await askOwner.json('/knowledge/rebuild', 'POST', {});
  const todayRec = (await askOwner.json('/knowledge?doc=recent')).data.days.find((x) => x.day === askDay);
  assert.ok(todayRec && todayRec.moods.some((m) => m.label.toLowerCase() === 'доверие'), 'Recent day record carries today\'s mood after rebuild: ' + JSON.stringify(todayRec));
  assert.equal(qaDB.prepare("SELECT COUNT(*) c FROM knowledge WHERE user_id = ?").get(askId).c >= 4, true);
  console.log('PASS: knowledge base — profile with verbatim natal chart, persisted compatibility, recent days after rebuild.');

  // ── Отчёты кабинета считаются в отдельном потоке и совпадают с расчётом в основном ──
  qaDB.prepare('INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts) VALUES (?,?,?,?,0)').run(adminMail, createHash('sha256').update(code + adminMail).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString());
  const adminAcc = account(); await adminAcc.json('/me'); await adminAcc.json('/auth/verify', 'POST', { email: adminMail, code });
  assert.equal((await adminAcc.json('/cabinet/me')).isAdmin, true);
  const { privateText } = await import(pathToFileURL(join(fixture, 'backend/private-text.mjs')).href);
  const Wsp = await import(pathToFileURL(join(fixture, 'backend/workspace.mjs')).href);
  const Rep = await import(pathToFileURL(join(fixture, 'backend/reports.mjs')).href);
  const keys = privateText(join(fixture, 'data'), { create: false }); Wsp.initWorkspace(qaDB, join(fixture, 'data'), keys.seal, keys.open); Rep.initReports(qaDB, join(fixture, 'data'));
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'today' ? undefined : v)));
  assert.deepEqual(strip(await adminAcc.json('/cabinet/dashboard?period=30d')), strip(Rep.overview({ period: '30d' })), 'Dashboard from the worker equals the in-process calculation');
  for (const kind of ['activity', 'retention', 'activation', 'features', 'cohorts', 'events']) assert.deepEqual(strip(await adminAcc.json('/cabinet/report?kind=' + kind + '&period=30d')), strip(Rep.report(kind, { period: '30d' })), 'Report ' + kind);
  assert.equal((await adminAcc.raw('/cabinet/report?kind=nope')).status, 404, 'Unknown report kind');
  assert.ok(!/считаю в основном потоке|поток отчётов упал/.test(log), 'Reports were served by the worker thread, not the inline fallback');
  console.log('PASS: cabinet dashboard and reports come from the worker thread with the same numbers as the in-process functions.');

  // ── Сессии: вход по коду меняет токен устройства; выход со всех устройств; у сотрудников срок короче ──
  const rot = account(); await rot.json('/me'); const rotCookieBefore = rot.cookie;
  const rotMail = 'rotate@example.test';
  qaDB.prepare('INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts) VALUES (?,?,?,?,0)').run(rotMail, createHash('sha256').update(code + rotMail).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString());
  await rot.json('/auth/verify', 'POST', { email: rotMail, code });
  assert.notEqual(rot.cookie, rotCookieBefore, 'Confirming the e-mail rotates the device token');
  assert.equal((await fetch(base + '/api/timeline', { headers: { Cookie: rotCookieBefore } })).status, 401, 'The pre-login token is revoked');
  const rotId = (await rot.json('/me')).user.id;
  qaDB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES ('other-device', ?, ?, ?)").run(rotId, new Date().toISOString(), new Date().toISOString());
  assert.equal((await rot.json('/auth/logout-all', 'POST')).devices, 2, 'Logout everywhere revokes every session of the account');
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id=?').get(rotId).c, 0);
  const staffId = qaDB.prepare('SELECT user_id FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)').get(staffMail).user_id;
  const monthAgo = new Date(Date.now() - 31 * 864e5).toISOString(), longAgoStaff = new Date(Date.now() - 46 * 864e5).toISOString();
  qaDB.prepare('UPDATE sessions SET last_seen=? WHERE user_id=?').run(monthAgo, staffId);
  assert.equal((await staff.raw('/cabinet/tasks')).status, 200, 'A staff member who looks in monthly stays signed in');
  qaDB.prepare('UPDATE sessions SET last_seen=? WHERE user_id=?').run(longAgoStaff, staffId);
  assert.equal((await staff.raw('/cabinet/tasks')).status, 401, 'A staff session idle past the limit expires');
  assert.equal((await staff.json('/cabinet/me')).email, '', 'Cabinet sees no one after the staff session expired');
  const plainId = (await askOwner.json('/me')).user.id;
  qaDB.prepare('UPDATE sessions SET last_seen=? WHERE user_id=?').run(longAgoStaff, plainId);
  assert.equal((await askOwner.json('/me')).user.id, plainId, 'An ordinary session survives a month and a half without visits');
  console.log('PASS: login rotates the session token, logout-all revokes every device, staff sessions expire sooner.');

  // ── Устройств для уведомлений у аккаунта — не больше десяти, остаются новые ──
  const pusher = account(); await pusher.json('/me'); const pusherId = (await pusher.json('/me')).user.id;
  for (let i = 1; i <= 12; i++) { await pusher.json('/push', 'POST', { endpoint: 'https://push.example.com/many/' + i }); await delay(2); }
  const endpoints = qaDB.prepare('SELECT endpoint FROM push_subs WHERE user_id=? ORDER BY created_at').all(pusherId).map((r) => r.endpoint);
  assert.equal(endpoints.length, 10, 'At most ten push endpoints per account');
  assert.ok(endpoints.includes('https://push.example.com/many/12') && !endpoints.includes('https://push.example.com/many/1'), 'The oldest endpoints are dropped first');
  console.log('PASS: push endpoints per account are capped, newest kept.');

  // ── Заброшенные анонимные аккаунты убираются; с почтой или записями — остаются ──
  const { sweepAbandoned } = await import(pathToFileURL(join(fixture, 'backend/account-data.mjs')).href);
  const ghost = account(); const ghostId = (await ghost.json('/me')).user.id;
  const ghostWithData = account(); const ghostDataId = (await ghostWithData.json('/me')).user.id; await ghostWithData.json('/mood', 'POST', { mood: 'joy' });
  const longAgo = new Date(Date.now() - 100 * 864e5).toISOString();
  qaDB.prepare('UPDATE users SET last_seen=? WHERE id IN (?,?,?)').run(longAgo, ghostId, ghostDataId, rotId);
  assert.equal(sweepAbandoned(qaDB), 1, 'Only the empty anonymous account is swept');
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(ghostId).c, 0);
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id IN (?,?)').get(ghostDataId, rotId).c, 2, 'Accounts with a mood or an e-mail stay');
  assert.equal((await ghost.raw('/timeline')).status, 401, 'The swept account\'s session is gone too');
  console.log('PASS: abandoned anonymous accounts are swept by the same lifecycle policy; anything with data or e-mail stays.');

  // ── Адрес клиента и лимиты: подменить X-Forwarded-For нельзя, коды на почту и аккаунты ограничены ──
  const req = (xff, email) => fetch(base + '/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: JSON.stringify({ email }) }).then((r) => r.status);
  for (let i = 0; i < 5; i++) assert.equal(await req(`10.0.0.${i}, 198.51.100.1`, `p${i}@example.test`), 503, 'Rate check passes, mail is off in tests');
  assert.equal(await req('10.0.0.99, 198.51.100.1', 'p9@example.test'), 429, 'A spoofed first X-Forwarded-For entry does not reset the per-address limit');
  assert.equal(await req('10.0.0.99, 198.51.100.2', 'p9@example.test'), 503, 'A different real (last) address is a different client');
  for (let i = 0; i < 3; i++) assert.equal(await req(`198.51.100.${10 + i}`, 'victim@example.test'), 503);
  assert.equal(await req('198.51.100.13', 'victim@example.test'), 429, 'One mailbox gets at most three codes per window whatever the address');
  const verifyIp = '198.51.100.50';
  for (let i = 0; i < 60; i++) assert.equal((await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': verifyIp, Cookie: evt.cookie }, body: JSON.stringify({ email: 'nobody@example.test', code: '000000' }) })).status, 400);
  assert.equal((await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': verifyIp, Cookie: evt.cookie }, body: JSON.stringify({ email: 'nobody@example.test', code: '000000' }) })).status, 429, 'Code guessing across mailboxes is throttled per address');
  const anonIp = '198.51.100.77';
  for (let i = 0; i < 40; i++) assert.equal((await fetch(base + '/api/me', { headers: { 'X-Forwarded-For': anonIp } })).status, 200);
  assert.equal((await fetch(base + '/api/me', { headers: { 'X-Forwarded-For': anonIp } })).status, 429, 'Anonymous account creation is capped per address');
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: evt.cookie, 'X-Forwarded-For': anonIp } })).status, 200, 'An existing session from the same address still works');
  console.log('PASS: the client address is the proxy-appended one, login codes are capped per address, per mailbox and globally, anonymous sign-ups are capped.');

  // ── Бюджет записей: скрипт не раздует базу, человеку хватает с запасом ──
  const writer = account(); await writer.json('/me');
  for (let i = 0; i < 100; i++) await writer.json('/ask', 'POST', { question: `Стоит ли мне сегодня ${i} раз подумать об этом?`, kind: 'yesno' });
  assert.equal((await writer.raw('/ask', 'POST', { question: 'Стоит ли мне ещё раз спросить о том же?', kind: 'yesno' })).status, 429, 'Readings per day are capped');
  for (let i = 0; i < 100; i++) await writer.json('/journal', 'POST', { text: 'Запись номер ' + i });
  assert.equal((await writer.raw('/journal', 'POST', { text: 'Сто первая запись' })).status, 429, 'Diary entries per day are capped');
  for (let i = 0; i < 300; i++) await writer.json('/wishes', 'POST', { text: 'Желание ' + i });
  assert.equal((await writer.raw('/wishes', 'POST', { text: 'Триста первое' })).status, 429, 'Wishes per account are capped');
  assert.equal((await writer.raw('/journal', 'POST', 'x'.repeat(40000))).status, 413, 'Oversized body is refused by name');
  assert.equal((await fetch(base + '/api/journal', { method: 'POST', headers: { Cookie: writer.cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': writer.ip }, body: '{bad' })).status, 400);
  console.log('PASS: per-account write budget and request-size errors are explicit; internals stay in the log.');

  // ── Заголовки страниц и CSP: скрипты только со своего домена, инлайна в разметке нет ──
  for (const path of ['/', '/cabinet']) {
    const r = await fetch(base + path), h = r.headers, html = await r.text(), csp = h.get('content-security-policy') || '';
    assert.equal(h.get('x-frame-options'), 'DENY', path + ' X-Frame-Options');
    assert.match(csp, /frame-ancestors 'none'/, path + ' CSP frame-ancestors');
    assert.match(csp, /script-src 'self'(;|$)/, path + " CSP script-src is 'self' only");
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), path + ' no unsafe-inline for scripts');
    assert.equal(h.get('x-content-type-options'), 'nosniff', path + ' nosniff');
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), path + ' has no inline <script>');
    assert.ok(!/\son[a-z]+="/i.test(html), path + ' has no inline on*= handlers');
  }
  /* и в шаблонах JS, из которых собирается разметка: атрибут-обработчик, добавленный через innerHTML, CSP тоже блокирует */
  const fs = await import('node:fs');
  for (const f of ['app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js', 'cabinet.js', 'handlers.js', 'cabinet-handlers.js']) assert.ok(!/\son[a-z]+="/.test(fs.readFileSync(join(repo, 'site', f), 'utf8')), f + ' has no on*= attributes in templates');
  assert.equal((await fetch(base + '/sw.js')).headers.get('x-content-type-options'), 'nosniff');
  /* офлайн-оболочка: каждый адрес из SHELL в sw.js должен отдаваться — иначе первое офлайн-открытие получит пустой экран */
  const sw = fs.readFileSync(join(repo, 'site', 'sw.js'), 'utf8');
  const shell = new Function('V', 'return ' + /const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/\/\*[\s\S]*?\*\//g, ''))(/const V = '(\d+)'/.exec(sw)[1]);
  for (const u of shell) assert.equal((await fetch(base + u.replace(/^\/app/, ''))).status, 200, 'SHELL entry is served: ' + u);
  /* Реестр обработчиков и разметка должны сходиться. Перенос из атрибутов делался скриптом, и у него два
     характерных промаха: тело, собранное конкатенацией ('+id+' в обычной строке), он принимал за литерал,
     а имя с зашитым аргументом рядом с параметрическим давало мёртвую запись и ломало поиск по data-a0. */
  const sites = ['index.html', 'app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js', 'handlers.js', 'cabinet.html', 'cabinet.js', 'cabinet-handlers.js'].map((f) => [f, fs.readFileSync(join(repo, 'site', f), 'utf8')]);
  const src = Object.fromEntries(sites);
  for (const reg of ['handlers.js', 'cabinet-handlers.js']) {
    for (const [, name, body] of src[reg].matchAll(/^ {2}"([^"]+)": function \(event\) \{ (.*) \},$/gm)) {
      assert.ok(!/'\+\s*[A-Za-z_$][\w$]*\s*\+'/.test(body), `${reg}: «${name}» хранит кусок конкатенации вида '+имя+' — это переменная той строки, где собиралась разметка, её место в data-aN: ${body}`);
      assert.ok(!/\$\{/.test(body), `${reg}: «${name}» хранит незакрытую подстановку: ${body}`);
    }
  }
  const named = (f) => new Set([...src[f].matchAll(/^ {2}"([^"]+)": function \(event\)/gm)].map((m) => m[1]));
  /* Имена из разметки. Пропускаем те, что собираются в коде (`'[data-on="click:openWidget-'+key+'"]'` — это селектор,
     а не разметка): имя там подставляется на ходу, а сами кнопки объявлены в разметке и так попадут в список. */
  const used = (files) => { const out = new Set(); for (const f of files) for (const [, spec] of src[f].matchAll(/data-on="([^"]+)"/g)) { if (/'\+|\+'|\$\{/.test(spec)) continue; for (const pair of spec.split(' ')) out.add(pair.slice(pair.indexOf(':') + 1)); } return out; };
  /* имена, которые собирает row() и другие помощники: строки вида 'click:имя' в скриптах */
  const usedInStrings = (files, out) => { for (const f of files) for (const [, n] of src[f].matchAll(/['"](?:click|input|change|keydown|toggle):([A-Za-z_$][\w$-]*)['"]/g)) if (!n.endsWith('-') && n !== 'checked') out.add(n); return out; };   /* '…-'+key — селектор, не имя */
  const appUsed = usedInStrings(['app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js'], used(['index.html', 'app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js']));
  for (const m of src['experience.js'].matchAll(/setAttribute\('data-on'\s*,\s*'([^']+)'/g)) appUsed.add(m[1].slice(m[1].indexOf(':') + 1));   // одна кнопка получает data-on из кода
  /* Имя «функция-a0-this-value» on.js вызывает сам (auto): для него нужна не запись в реестре, а глобальная function-декларация.
     Всё остальное (openWidget-tone, go-home, if-event-key-…) — только из реестра. */
  const autoOk = (files, n) => { const parts = n.split('-'); if (!parts.slice(1).every((a) => ['this', 'value', 'event'].includes(a) || /^a\d$/.test(a))) return false;
    return files.some((f) => new RegExp('^(?:async )?function ' + parts[0].replace(/[$]/g, '\\$&') + '\\(', 'm').test(src[f])); };
  for (const [reg, u, files] of [['handlers.js', appUsed, ['app.js', 'today.js', 'diary.js', 'readings.js', 'practices.js', 'about.js', 'account.js', 'start.js', 'experience.js', 'tour.js']], ['cabinet-handlers.js', usedInStrings(['cabinet.js'], used(['cabinet.html', 'cabinet.js'])), ['cabinet.js']]]) {
    for (const n of u) assert.ok(named(reg).has(n) || autoOk(files, n), `${reg}: разметка ссылается на «${n}», а обработчика нет (ни в реестре, ни function-декларации)`);
    for (const n of named(reg)) assert.ok(u.has(n), `${reg}: «${n}» никем не используется — мёртвая запись после переноса`);
    for (const n of named(reg)) { if (!autoOk(files, n)) continue; const parts = n.split('-'); const derived = parts[0] + '(' + parts.slice(1).map((a) => a === 'this' ? 'this' : a === 'value' ? 'this.value' : a === 'event' ? 'event' : 'this.dataset.' + a).join(', ') + ')';
      const body = ((src[reg].split('\n').find((l) => l.startsWith(`  "${n}"`)) || '').match(/\{ (.*) \},$/) || [])[1] || '';
      assert.ok(body.replace(/;$/, '') !== derived, `${reg}: «${n}» выводится из имени — запись в реестре лишняя`); }
  }
  console.log(`PASS: strict CSP (script-src self, no inline scripts or handlers in markup or templates), anti-clickjacking and nosniff headers; all ${shell.length} offline shell files are served; handler registry matches the markup with no leftover concatenation.`);

  // ── Удаление аккаунта подтверждается отдельным кодом; код входа для этого не годится ──
  const doomed = account(); await doomed.json('/me');
  const doomedMail = 'doomed@example.test';
  const putCode = (email, purpose) => qaDB.prepare("INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts, purpose) VALUES (?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, purpose=excluded.purpose")
    .run(email, createHash('sha256').update(code + email).digest('hex'), new Date().toISOString(), new Date(Date.now() + 600000).toISOString(), purpose);
  putCode(doomedMail, 'login');
  await doomed.json('/auth/verify', 'POST', { email: doomedMail, code });
  const doomedId = (await doomed.json('/me')).user.id;
  await doomed.json('/journal', 'POST', { text: 'Эта запись должна исчезнуть только по коду' });
  assert.equal((await doomed.raw('/account', 'DELETE')).status, 400, 'Deletion without a code is refused');
  putCode(doomedMail, 'login');
  assert.equal((await doomed.raw('/account', 'DELETE', { code })).status, 400, 'A login code does not delete the account');
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(doomedId).c, 1, 'The account is still there after refused attempts');
  putCode(doomedMail, 'delete');
  assert.equal((await doomed.raw('/account', 'DELETE', { code: '000000' })).status, 400, 'A wrong code does not delete the account');
  putCode(doomedMail, 'delete');
  assert.equal((await doomed.raw('/auth/verify', 'POST', { email: doomedMail, code })).status, 400, 'A deletion code does not open a login');
  putCode(doomedMail, 'delete');
  assert.equal((await doomed.raw('/account', 'DELETE', { code })).status, 200, 'The right deletion code deletes the account');
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(doomedId).c, 0);
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM journal WHERE user_id=?').get(doomedId).c, 0);
  const anon = account(); const anonId = (await anon.json('/me')).user.id;
  assert.equal((await anon.raw('/account', 'DELETE')).status, 200, 'An account without an e-mail has nothing to confirm with');
  assert.equal(qaDB.prepare('SELECT COUNT(*) c FROM users WHERE id=?').get(anonId).c, 0);
  console.log('PASS: account deletion is confirmed by a separate e-mail code; login and deletion codes are not interchangeable.');

  // ── Скользящая сессия: кука продлевается при использовании, входить заново не нужно ──
  const roll = account(); await roll.json('/me');
  const rollId = (await roll.json('/me')).user.id;
  qaDB.prepare("UPDATE sessions SET last_seen = ? WHERE user_id = ?").run(new Date(Date.now() - 40 * 60000).toISOString(), rollId);
  const r1 = await roll.raw('/me');
  assert.ok(r1.headers.get('set-cookie'), 'A session in use is re-issued with a fresh Max-Age');
  assert.match(r1.headers.get('set-cookie'), /Max-Age=31536000/);
  assert.equal((await roll.json('/me')).user.id, rollId, 'The rolling cookie keeps the same account');
  assert.equal((await roll.raw('/me')).headers.get('set-cookie'), null, 'A freshly seen session is not re-issued on every request');
  console.log('PASS: an active session rolls its cookie forward instead of quietly expiring in the browser.');

  // ── Копии: с BACKUP_SECRET в папке только шифротекст, ключ едет внутрь архива ──
  const { createBackup, decryptBuffer } = await import(pathToFileURL(join(fixture, 'backend/backup.mjs')).href);
  const bkDir = join(fixture, 'bk-enc');
  const B = createBackup({ dataDir: join(fixture, 'data'), contentDir: join(fixture, 'content'), backupDir: bkDir, secret: 'пароль-копий' });
  const made = await B.run(true);
  assert.ok(made.files.every((f) => f.endsWith('.enc')), 'Every archive is encrypted: ' + made.files.join(', '));
  const inDir = (await import('node:fs')).readdirSync(bkDir);
  assert.ok(!inDir.includes('secret.key') && !inDir.includes('push-keys.json'), 'The app key is not lying next to the database: ' + inDir.join(', '));
  const enc = (await import('node:fs')).readFileSync(join(bkDir, made.files.find((f) => f.startsWith('app-'))));
  assert.ok(!enc.includes(Buffer.from('SQLite format')), 'The archive body is not readable');
  assert.throws(() => decryptBuffer(enc, 'другой-пароль'), /authenticate|state/, 'A wrong password does not decrypt');
  const tarBuf = decryptBuffer(enc, 'пароль-копий');
  assert.ok(tarBuf.includes(Buffer.from('secret.key')) && tarBuf.includes(Buffer.from('.db.gz')), 'The key travels inside the encrypted archive');
  /* F03: копии старше 30 дней убираются по дате в имени, даже если их меньше четырнадцати (старые копии хранят квитанции с открытым текстом) */
  await writeFile(join(bkDir, 'app-2020-01-01.db.gz.enc'), 'x'); await writeFile(join(bkDir, 'content-2020-01-01.tar.gz'), 'x');
  const swept = B.sweep(); assert.ok(swept.includes('app-2020-01-01.db.gz.enc') && swept.includes('content-2020-01-01.tar.gz'), 'copies older than 30 days are removed: ' + swept.join(', '));
  assert.ok(!B.list().items.some((i) => i.name.includes('2020-01-01')) && B.list().items.length >= 2, 'fresh copies stay');
  console.log('PASS: backups are encrypted with a separate secret and the app key no longer sits beside the database; copies older than 30 days are swept.');

  // ── F14 (ревью v114): чужой ключ и испорченные данные — исключение decrypt_failed, штатная пустая строка — ''; в ленте, дне и выгрузке
  //    нечитаемая запись помечена, а не пуста; ее нельзя переписать; выгрузка называет число нечитаемых и их id ──
  { const dirA = join(fixture, 'keys-a'), dirB = join(fixture, 'keys-b'); await mkdir(dirA); await mkdir(dirB);
    const A = privateText(dirA), Bk = privateText(dirB);
    const sealed = A.seal('текст под ключом A');
    assert.equal(A.open(sealed), 'текст под ключом A'); assert.equal(A.open(''), '', 'an empty string stays empty — that is normal'); assert.equal(A.open('старая открытая запись'), 'старая открытая запись');
    assert.throws(() => Bk.open(sealed), (e) => e.code === 'decrypt_failed', 'another key throws decrypt_failed instead of returning an empty string');
    assert.throws(() => A.open(sealed.slice(0, -6) + 'AAAAAA'), (e) => e.code === 'decrypt_failed', 'a damaged ciphertext throws too');
    assert.deepEqual(A.readable(sealed), { text: 'текст под ключом A', unreadable: false }); assert.deepEqual(Bk.readable(sealed), { text: null, unreadable: true });
    const { readFileSync: rfs } = await import('node:fs');
    assert.ok(rfs(join(fixture, 'data/key.check'), 'utf8').startsWith('enc1:'), 'the server wrote its key marker on start');
    /* нечитаемая строка в базе: лента и день помечают ее, выгрузка называет, правка отклоняется */
    const un = account(); const unMe = await un.json('/me'), unId = unMe.user.id, unDay = unMe.day.date;
    await un.json('/profile', 'POST', { name: 'Нечитаемая', birth: '1990-01-01', city: 'Москва', consent: true });
    const good = await un.json('/journal', 'POST', { text: 'Читаемая запись', kind: 'gratitude' });
    qaDB.prepare("INSERT INTO journal (user_id, ts, day, text, kind, title) VALUES (?, ?, ?, ?, '', '')").run(unId, new Date().toISOString(), unDay, Bk.seal('запись чужим ключом'));
    const badId = qaDB.prepare("SELECT id FROM journal WHERE user_id = ? AND kind = ''").get(unId).id;
    const feed = (await un.json('/journal')).items; const badRow = feed.find((i) => i.id === badId), goodRow = feed.find((i) => i.id === good.item.id);
    assert.ok(badRow && badRow.unreadable === true && badRow.text === null, 'the feed marks the unreadable record: ' + JSON.stringify(badRow)); assert.equal(goodRow.text, 'Читаемая запись'); assert.ok(!('unreadable' in goodRow));
    const dayState = await un.json('/day'); assert.ok(dayState.text && dayState.text.unreadable === true && dayState.text.text === null, 'the day card marks the cell: ' + JSON.stringify(dayState.text)); assert.equal(dayState.gratitude.text, 'Читаемая запись');
    const overwrite = await un.raw('/day', 'POST', { text: 'Новый текст поверх нечитаемого' }); assert.equal(overwrite.status, 409); assert.equal((await overwrite.json()).error, 'unreadable', 'an unreadable record is not overwritten');
    assert.equal(qaDB.prepare('SELECT text FROM journal WHERE id = ?').get(badId).text.startsWith('enc1:'), true, 'the damaged bytes are untouched');
    assert.equal((await un.json('/day', 'POST', { gratitude: 'Читаемая запись — поправлена' })).gratitude.text, 'Читаемая запись — поправлена', 'other cells of the day still save');
    const ex = await un.json('/data/export');
    assert.ok(ex.limits.some((l) => /1 запись не удалось расшифровать/.test(l)), 'the export names the unreadable count: ' + JSON.stringify(ex.limits)); assert.deepEqual(ex.unreadableIds, [badId]);
    assert.ok(ex.journal.find((j) => j.id === badId).unreadable === true && ex.journal.find((j) => j.id === badId).text === null);
    const { personalExportPdf: pdfF14 } = await import(pathToFileURL(join(fixture, 'backend/personal-export-pdf.mjs')).href);
    const pdfBuf = pdfF14(ex, {}); assert.ok(pdfBuf.length > 1000, 'the PDF builds with an unreadable record');
    const pdfText = [...pdfBuf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('\n');
    assert.ok(pdfText.length > 0, 'PDF streams inflate');
    const pdfR = await un.raw('/data/export.pdf'); assert.equal(pdfR.status, 200, 'the PDF route serves with an unreadable record');
    console.log('PASS: F14 — decrypt failure is an exception, not an empty string; unreadable records are marked in the feed, the day card and the export, named in limits and never overwritten.'); }

  // ── Схема: версия базы записана, повторный запуск ничего не меняет, health её показывает ──
  const { SCHEMA_VERSION } = await import(pathToFileURL(join(fixture, 'backend/schema.mjs')).href);
  assert.equal(qaDB.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'user_version tracks the last applied migration');
  assert.equal((await (await fetch(base + '/api/health')).json()).schema, SCHEMA_VERSION);
  qaDB.close();
  console.log('PASS: arbitrary askesis date, optional notes, free habit rhythm, no streak awards, weekly reminder settings and message content, dated gratitude and daily-question diary entries.');
  if (process.argv.includes('--ui-recovery') || process.argv.includes('--ui-restoration') || process.argv.includes('--ui') || process.argv.includes('--ui-repeat') || process.argv.includes('--ui-experience') || process.argv.includes('--ui-design') || process.argv.includes('--ui-regression') || process.argv.includes('--ui-brand')) {   /* --ui-regression — обязательный набор из check-all (R15) */
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
      if(process.argv.includes('--ui')||process.argv.includes('--ui-regression')){const rgOwner=account();await rgOwner.json('/me');await rgOwner.json('/profile','POST',{name:'Регрессии',birth:'1990-01-01',city:'Москва',consent:true});const {checkRegressions}=await import('./check-regressions.mjs');await checkRegressions({browser,base,owner:rgOwner});}
      if(!process.argv.includes('--ui-recovery')&&!process.argv.includes('--ui-restoration')&&!process.argv.includes('--ui-experience')&&!process.argv.includes('--ui-design')&&!process.argv.includes('--ui-brand')&&!process.argv.includes('--ui-regression')){
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
      { const pr=(await owner.json('/preferences')).preferences; await owner.json('/preferences','POST',{...pr,tools:['gratitude','habits','askesis','wishes','hmood']}); }   /* сценарии ниже открывают все плитки */
      const page = await ctx.newPage(); const errors = [];const close=async()=>{if(await page.locator('#wg.on').count())await page.locator('.wg-x').click();else{await page.locator('#practice-back').click();await page.locator('#v-practice').waitFor({state:'hidden'});}};
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#v-home.on');
      /* «Аккаунт» больше не вкладка внизу: туда ведёт строка «Аккаунт» на «Обо мне»; кружок справа вверху — тема (20.09).
         Нижние вкладки — «Сегодня», «Свериться с собой», «Дневник», «Обо мне». Фото участницы в интерфейсе нет */
      await page.evaluate(() => go('account'));
      await page.locator('#v-account.on').waitFor();
      assert.ok(await page.locator('#ac-avatar').isVisible(), 'the profile shows the first letter of the name');
      await page.reload(); await page.waitForSelector('#v-home.on');
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
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history').getByRole('button', { name: /^Взять аскезу/ }).click();
      await page.locator('#as-box').getByText('Тест: без вечернего скроллинга', { exact: true }).waitFor();
      assert.equal(await page.locator(`#as-note-${askesis.id}`).inputValue(), 'Тест: вечер прошёл спокойно');
      await close();await page.reload(); await page.waitForSelector('#v-home.on');
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history').getByRole('button', { name: 'Мои желания', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#m-wishes .wish-picture img').length === 2);
      await close();
      /* пробелы нормализуем: в подписи вкладки неразрывный пробел, чтобы «с собой» не разрывалось на узком экране */
      assert.deepEqual((await page.locator('.app-nav button').allTextContents()).map(t=>t.replace(/\s+/g,' ').trim()), ['Сегодня','Свериться с собой','Дневник','Обо мне']);
      await page.locator('.app-nav').getByRole('button',{name:'Сегодня',exact:true}).click();
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history').getByRole('button',{name:/^Отметить настроение/}).click();
      await page.getByRole('button',{name:'Все эмоции',exact:true}).click();
      assert.equal(await page.locator('#t-moods .mchip').count(),32);
      await page.locator('#t-moods .mchip').filter({hasText:/^восхищение$/}).click();
      await page.waitForFunction(()=>document.querySelector('#t-moods .mpick').textContent.includes('восхищение'));
      await close();
      await page.locator('.app-nav [data-nav=ask]').click();await page.locator('#v-ask').getByRole('button',{name:'Ответить себе на вопрос',exact:true}).click();
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
      /* экрана «Новое в приложении» больше нет (20.09): прямой путь к аскезе — со вкладки «Дневник» */
      await page.locator('.app-nav [data-nav=history]').click();await page.locator('#v-history [data-feature=askesis]').click();
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
      for(const [view,key] of [['home','card'],['history','mood'],['ask','worry'],['home','day'],['home','tone'],['history','askesis'],['history','wishes'],['history','habits'],['history','gratitude'],['about','natal'],['about','year'],['about','birthnum'],['about','compat'],['home','lunar'],['home','sky'],['history','hmood'],['history','wishes'],['ask','hentries'],['history','journal'],['history','week'],['account','edit'],['account','remind'],['account','support']]) {
        await page.evaluate(v=>go(v),view);
        await page.locator(`#v-${view} [data-feature="${key}"]`).click();
        await page.waitForFunction(k=>document.querySelector(':is(#wg-body,#practice-body) #w-'+k)!==null,key);
        await close();
      }
      await page.evaluate(()=>go('ask'));
      assert.deepEqual(await page.locator('#v-ask .wid b').allTextContents(),['Ответить себе на вопрос','Да / Нет','Руны','Таро']);
      console.log('PASS: all four main sections, all 32 emotion options, editable question chips, answer-to-diary flow, canonical News links, all restored cards, 320/390/844/1440 layouts.');
      assert.deepEqual(errors, []);
      console.log('PASS: existing wish photo uploads and reloads, habit/askesis navigation, saved notes, failed-request draft protection and visible feedback in the mobile UI.');
      }
      }
    } finally { await browser.close(); }
  }
  // ── Старая база с token_hash: пересборка users сохраняет все добавленные колонки ──
  await stop();
  await rm(join(fixture, 'data'), { recursive: true, force: true }); await mkdir(join(fixture, 'data'));
  const old = new DatabaseSync(join(fixture, 'data/app.db'));
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, name TEXT DEFAULT '', birth TEXT DEFAULT '', birth_time TEXT DEFAULT '', city TEXT DEFAULT '',
    email TEXT DEFAULT '', consent_version TEXT DEFAULT '', consent_ts TEXT DEFAULT '', streak INTEGER DEFAULT 0, streak_date TEXT DEFAULT '', onboarded INTEGER DEFAULT 0, token_hash TEXT DEFAULT '', ref_code TEXT DEFAULT '', photo TEXT DEFAULT '');
    INSERT INTO users (created_at, last_seen, name, token_hash, ref_code, photo) VALUES ('2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z','Старый','abc','ref123','data:image/png;base64,AAAA');`);
  old.close();
  await start();
  const migrated = new DatabaseSync(join(fixture, 'data/app.db'));
  const cols = migrated.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const c of ['ref_code', 'photo', 'photo_ts', 'invited_by', 'bonus_until', 'preferences', 'lat', 'tz']) assert.ok(cols.includes(c), `Migrated users table keeps/gains ${c}`);
  assert.ok(!cols.includes('token_hash'));
  const legacy = migrated.prepare("SELECT ref_code, photo FROM users WHERE name='Старый'").get();
  assert.equal(legacy.ref_code, 'ref123'); assert.ok(legacy.photo.startsWith('data:image/png'));
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'Legacy base ends on the current schema version');
  const schemaSnapshot = () => migrated.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
  const snap1 = schemaSnapshot();
  await stop(); await start();
  assert.deepEqual(schemaSnapshot(), snap1, 'A restart on a current base changes nothing in the schema');
  await stop();
  migrated.exec('PRAGMA user_version = 999');   // откат выпуска: код старее базы — миграции только добавляют, прежний код работает как есть
  log = ''; await start();
  assert.match(log, /новее кода/, 'Older code on a newer base says so and keeps the version untouched');
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 999);
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
  migrated.close();
  console.log('PASS: legacy token_hash schema migrates without losing later columns or their values; migrations are versioned, idempotent on restart and safe for a rolled-back release.');

  // ── F03 (ревью v114): настоящая база v19 с квитанциями старой формы — после обновления открытого текста в них нет,
  //    распознанная квитанция стала ссылкой на запись, нераспознанная удалена, повтор успешной операции не создает дубль ──
  await stop();
  await rm(join(fixture, 'data'), { recursive: true, force: true }); await mkdir(join(fixture, 'data'));
  { const Schema = await import(pathToFileURL(join(fixture, 'backend/schema.mjs')).href);
    const v19 = new DatabaseSync(join(fixture, 'data/app.db'));
    for (const m of Schema.MIGRATIONS.filter((x) => x.v <= 19)) { v19.exec('BEGIN'); m.up(v19); v19.exec(`PRAGMA user_version = ${m.v}`); v19.exec('COMMIT'); }
    assert.equal(v19.prepare('PRAGMA user_version').get().user_version, 19);
    const ts = new Date().toISOString();
    v19.prepare("INSERT INTO users (id, created_at, last_seen, name, onboarded) VALUES (7, ?, ?, 'Квитанции', 1)").run(ts, ts);
    v19.prepare("INSERT INTO journal (id, user_id, ts, day, text, kind, title) VALUES (1, 7, ?, '2026-09-01', 'старая запись без шифрования', 'gratitude', '')").run(ts);   /* без enc1: у этой базы нет ключа, а с ключом сервер сверяет маркер (F14) */
    const put = v19.prepare('INSERT INTO sync_receipts (user_id, operation_id, payload_hash, response_json, created_at) VALUES (7, ?, ?, ?, ?)');
    put.run('op-old-format', 'h1', '{"ok":true,"item":{"id":1,"day":"2026-09-01","text":"MARKER-секрет","kind":"gratitude","title":""},"streak":3}', ts);
    put.run('op-old-updated', 'h2', '{"ok":true,"updated":true,"item":{"id":1,"text":"MARKER-еще"}}', ts);
    put.run('op-new-format', 'h3', '{"table":"journal","id":1}', ts);
    put.run('op-refused', 'h4', '{"table":"wishes","id":0,"refused":"too_many"}', ts);
    put.run('op-garbage', 'h5', 'not json {MARKER', ts);
    v19.close(); }
  await start();
  { const m20 = new DatabaseSync(join(fixture, 'data/app.db'));
    assert.equal(m20.prepare("SELECT COUNT(*) c FROM sync_receipts WHERE response_json LIKE '%MARKER%'").get().c, 0, 'no open text is left in receipts after the migration');
    assert.deepEqual(JSON.parse(m20.prepare("SELECT response_json FROM sync_receipts WHERE operation_id = 'op-old-format'").get().response_json), { table: 'journal', id: 1, updated: false }, 'a recognised old receipt became a reference');
    assert.deepEqual(JSON.parse(m20.prepare("SELECT response_json FROM sync_receipts WHERE operation_id = 'op-old-updated'").get().response_json), { table: 'journal', id: 1, updated: true });
    assert.equal(m20.prepare("SELECT response_json FROM sync_receipts WHERE operation_id = 'op-new-format'").get().response_json, '{"table":"journal","id":1}', 'a v114 receipt is untouched');
    for (const op of ['op-refused', 'op-garbage']) assert.equal(m20.prepare('SELECT COUNT(*) c FROM sync_receipts WHERE operation_id = ?').get(op).c, 0, op + ' is dropped: unrecognised or a refusal is not a receipt');
    assert.equal(m20.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    /* повтор успешной операции на обновленной базе — тот же результат, а не вторая запись */
    const rp = account(); const rpId = (await rp.json('/me')).user.id, rop = 'op-after-migrate';
    const first = await rp.json('/journal', 'POST', { text: 'Повтор после обновления', kind: 'gratitude', op: rop });
    const again = await rp.json('/journal', 'POST', { text: 'Повтор после обновления', kind: 'gratitude', op: rop });
    assert.equal(again.repeated, true); assert.equal(again.item.id, first.item.id);
    assert.equal(m20.prepare("SELECT COUNT(*) c FROM journal WHERE user_id = ? AND kind = 'gratitude'").get(rpId).c, 1, 'one gratitude after a repeat on the migrated base');
    m20.close(); }
  console.log('PASS: F03 — receipts of the v110–v113 form are reduced to references by migration 20, unrecognised and refusal receipts are dropped, repeats stay honest.');

  // ── F14 (ревью v114): сервер с подмененным или пропавшим ключом при непустой базе не стартует — и не пишет новым ключом поверх архива ──
  { const fs14 = await import('node:fs');
    const keyPath = join(fixture, 'data/secret.key'), keyBytes = fs14.readFileSync(keyPath);
    const guarded = account(); await guarded.json('/me'); await guarded.json('/journal', 'POST', { text: 'Запись под настоящим ключом' });   /* база не пуста и зашифрована */
    await stop();
    fs14.writeFileSync(keyPath, 'другой-ключ-' + Date.now());
    log = ''; await assert.rejects(start(), /ключ/, 'a replaced key refuses to start'); assert.match(log, /ключ шифрования не совпадает/, 'the log names the key: ' + log.slice(-300));
    fs14.rmSync(keyPath);
    log = ''; await assert.rejects(start(), /ключ/, 'a missing key on an encrypted base refuses to start too'); assert.ok(!fs14.existsSync(keyPath), 'no fresh key is created over the archive');
    fs14.writeFileSync(keyPath, keyBytes);
    log = ''; await start(); assert.equal((await guarded.json('/journal')).items[0].text, 'Запись под настоящим ключом', 'the real key restored — the server starts and reads');
    console.log('PASS: F14 — a replaced or lost key on a non-empty base stops the server before it writes anything.'); }
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
