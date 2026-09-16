/* Integration check: real HTTP handlers + SQLite, synthetic accounts only.
   node >=22.5 tools/check-personal-features.mjs
   No production data, credentials, email or notification delivery is used. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { versionMismatch } from './bump-version.mjs';

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
  await mkdir(join(fixture, 'content'));
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
  /* Читаемая выгрузка: настоящий PDF, со шрифтом, текстами дневника и без чужих записей — те же данные, что в JSON */
  { const r=await owner.raw('/data/export.pdf');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.match(r.headers.get('content-disposition')||'',/^attachment; filename="lunario-\d{4}-\d{2}-\d{2}\.pdf"$/);
    const pdf=Buffer.from(await r.arrayBuffer());assert.ok(pdf.subarray(0,5).toString('latin1')==='%PDF-','PDF header');assert.ok(pdf.includes('/FontFile2') && pdf.includes('/Identity-H'),'embedded TrueType font');assert.ok(pdf.includes('/Subtype /Image'),'cover image');assert.ok(pdf.length>50000);
    const {personalExportPdf}=await import(pathToFileURL(join(fixture,'backend/personal-export-pdf.mjs')).href);
    const text=(buf)=>{let out='';const re=/stream\r?\n/g;let m;while((m=re.exec(buf.toString('latin1')))){const start=m.index+m[0].length,end=buf.indexOf('endstream',start);try{out+=inflateSync(buf.subarray(start,end)).toString('latin1');}catch{}}return out;};
    const hexOf=(buf)=>{const cmap=text(buf);const map=new Map();for(const mm of cmap.matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4})>/g))map.set(mm[1],String.fromCharCode(parseInt(mm[2],16)));let s='';for(const mm of cmap.matchAll(/<([0-9a-f]+)> Tj/g))s+=mm[1].match(/.{4}/g).map((g)=>map.get(g)||'').join('')+'\n';return s;};
    const mine=hexOf(personalExportPdf(bundle));assert.ok(mine.includes('Тест: прогулка вечером'),'habit title in PDF text');assert.ok(mine.includes('Тест: вечер прошёл спокойно'),'askesis note in PDF text');
    assert.ok(!hexOf(personalExportPdf(await other.json('/data/export'))).includes('Тест: прогулка вечером'),'other account gets its own PDF'); }
  assert.equal(reminders.notificationFor('gratitude',person),null,'Do not remind after gratitude is recorded');
  assert.equal(reminders.notificationFor('gratitude',person,Date.parse(day+'T20:59:00Z'),'Asia/Tokyo'),null,'Reminder suppression uses the same day as the diary');
  await owner.json('/journal','POST',{kind:'answer',title:me.day.question,text:'Сегодня я могу дать себе время'});
  assert.ok((await owner.json('/journal')).items.some(i=>i.kind==='answer' && i.title===me.day.question && i.day===day));
  // Home screen status comes from one request; it mirrors the same tables the practice screens read.
  const status=await owner.json('/day-status');
  assert.equal(status.gratitude,true);assert.equal(status.answer,true);assert.equal(typeof status.journal,'boolean');
  assert.ok(status.habits.some(h=>h.title==='Тест: прогулка вечером'));assert.ok(Array.isArray(status.askesis.active));
  assert.equal((await other.json('/day-status')).gratitude,false,'Day status must be per account');
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
  // ── Одна версия оболочки: index.html, импорты sky.js и SHELL в sw.js должны совпадать ──
  assert.equal(versionMismatch(), null, 'Shell version must be the same in index.html, sky.js and sw.js');

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
    await acc.json('/reminders', 'POST', { feature: 'card', enabled: true, tz: 'Europe/Moscow' });
    await acc.json('/push', 'POST', { endpoint: 'https://push.example.com/box/' + name });
    await acc.json('/shelves');
    return (await acc.json('/me')).user.id;
  };
  const rowsOf = (uid) => Object.fromEntries(PERSONAL_DATA.filter((r) => r.table !== 'users').map((r) => [r.table, r.by === 'email' ? 0
    : r.via ? qaDB.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE ${r.via.key} IN (SELECT id FROM ${r.via.table} WHERE user_id=?)`).get(uid).c
    : qaDB.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE user_id=?`).get(uid).c]));
  const victim = account(), keeper = account();
  const victimId = await seed(victim, 'Удаляемый'), keeperId = await seed(keeper, 'Остающийся');
  const before = rowsOf(victimId), keeperBefore = rowsOf(keeperId);
  for (const t of ['tickets', 'messages', 'reminders', 'push_subs', 'sessions', 'journal', 'habit_marks', 'askesis_days', 'shelves']) assert.ok(before[t] > 0, `Seed must fill ${t}`);
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
  for (const [cycle, name] of [[0, 'Новолуние'], [0.06, 'Новолуние'], [0.07, 'Растущий серп'], [0.25, 'Первая четверть'], [0.5, 'Полнолуние'], [0.75, 'Последняя четверть'], [0.9, 'Старая Луна'], [0.95, 'Новолуние']]) assert.equal(moonPhaseName(cycle), name, `phase name at ${cycle}`);
  for (const at of ['2026-09-15T12:00:00Z', '2026-09-18T12:00:00Z', '2026-09-26T12:00:00Z']) { const m = moonState(Date.parse(at)); assert.ok(MOON_NAMES.includes(m.name) && m.illumination >= 0 && m.illumination <= 100, at); }
  const shelvesDay = (await evt.json('/shelves')).day;
  assert.equal(shelvesDay.moon, meMoon.day.moon, 'Dossier shows the same phase as the day pack');
  console.log('PASS: day pack, sky screen and dossier share one moon model and one naming rule.');

  // ── Досье аскезы читает актуальный контракт: те же поля, что у практик, в тексте нет undefined ──
  const askOwner = account(); await askOwner.json('/me'); await askOwner.json('/profile', 'POST', { name: 'Аскеза', birth: '1988-08-08', city: 'Москва', consent: true });
  const askDay = (await askOwner.json('/me')).day.date, askUntil = new Date(Date.parse(askDay) + 29 * 864e5).toISOString().slice(0, 10);
  const started = (await askOwner.json('/askesis', 'POST', { title: 'Без сладкого', until: askUntil })).active[0];
  assert.deepEqual([started.total, started.done, started.left], [30, 1, 29]);
  const dossierAsk = (await askOwner.json('/shelves')).day.askesis[0];
  for (const k of ['title', 'done', 'total', 'left', 'until', 'notes']) assert.ok(k in dossierAsk, `Dossier askesis carries ${k}`);
  assert.deepEqual([dossierAsk.done, dossierAsk.total, dossierAsk.left, dossierAsk.until], [started.done, started.total, started.left, started.until]);
  const dossierText = (await askOwner.json('/shelves/context')).text;
  assert.ok(dossierText.includes('Без сладкого — день 1 из 30'), 'Context text uses the current askesis fields: ' + dossierText.split('\n').find((l) => l.startsWith('Аскезы')));
  assert.ok(!/undefined|NaN/.test(dossierText), 'No undefined in dossier text');
  console.log('PASS: dossier and context text use the same askesis contract as the practices model.');

  // ── Лимит раскладов: одна политика для /api/me и /api/spread ──
  const limits = (await askOwner.json('/me')).limits; assert.equal(limits.spreadsLeft, limits.spreadsTotal);
  for (let i = 0; i < limits.spreadsTotal; i++) {
    const r = await askOwner.json('/spread', 'POST', { question: 'Что мне важно понять про эту неделю?', layout: 'three' });
    assert.equal(r.left, limits.spreadsTotal - i - 1); assert.equal((await askOwner.json('/me')).limits.spreadsLeft, r.left, 'Reported quota matches the check');
  }
  assert.equal((await askOwner.raw('/spread', 'POST', { question: 'Что мне важно понять про эту неделю?', layout: 'three' })).status, 429, 'Quota check uses the same limit the API reports');
  console.log('PASS: spread quota is enforced by the same rule the API reports.');

  // ── Досье пересобирается частями: отметка настроения не трогает «Обо мне» с натальной картой ──
  const shelfRows = (uid) => Object.fromEntries(qaDB.prepare('SELECT shelf, json, updated_at FROM shelves WHERE user_id=?').all(uid).map((r) => [r.shelf, r]));
  const askId = (await askOwner.json('/me')).user.id;
  const rowsBefore = shelfRows(askId); assert.equal(Object.keys(rowsBefore).length, 3);
  await delay(20); await askOwner.json('/mood', 'POST', { mood: 'trust' }); await askOwner.json('/shelves');
  const rowsAfter = shelfRows(askId);
  assert.equal(rowsAfter.about.json, rowsBefore.about.json, 'Mood does not rebuild «Обо мне»'); assert.equal(rowsAfter.about.updated_at, rowsBefore.about.updated_at);
  assert.notEqual(rowsAfter.day.updated_at, rowsBefore.day.updated_at, 'Mood rebuilds «Мой день»');
  assert.equal((await askOwner.json('/shelves')).day.moodRu.toLowerCase(), 'доверие');
  await askOwner.json('/profile', 'POST', { name: 'Аскеза-2', birth: '1988-08-08', city: 'Москва', consent: true }); await askOwner.json('/shelves');
  assert.notEqual(shelfRows(askId).about.updated_at, rowsAfter.about.updated_at, 'Profile rebuilds «Обо мне»');
  assert.equal((await askOwner.json('/shelves')).about.name, 'Аскеза-2');
  console.log('PASS: dossier shelves are rebuilt only where the action touches them.');

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
  for (const f of ['app.js', 'experience.js', 'cabinet.js', 'handlers.js', 'cabinet-handlers.js']) assert.ok(!/\son[a-z]+="/.test(fs.readFileSync(join(repo, 'site', f), 'utf8')), f + ' has no on*= attributes in templates');
  assert.equal((await fetch(base + '/sw.js')).headers.get('x-content-type-options'), 'nosniff');
  /* офлайн-оболочка: каждый адрес из SHELL в sw.js должен отдаваться — иначе первое офлайн-открытие получит пустой экран */
  const sw = fs.readFileSync(join(repo, 'site', 'sw.js'), 'utf8');
  const shell = new Function('V', 'return ' + /const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/\/\*[\s\S]*?\*\//g, ''))(/const V = '(\d+)'/.exec(sw)[1]);
  for (const u of shell) assert.equal((await fetch(base + u.replace(/^\/app/, ''))).status, 200, 'SHELL entry is served: ' + u);
  /* Реестр обработчиков и разметка должны сходиться. Перенос из атрибутов делался скриптом, и у него два
     характерных промаха: тело, собранное конкатенацией ('+id+' в обычной строке), он принимал за литерал,
     а имя с зашитым аргументом рядом с параметрическим давало мёртвую запись и ломало поиск по data-a0. */
  const sites = ['index.html', 'app.js', 'experience.js', 'handlers.js', 'cabinet.html', 'cabinet.js', 'cabinet-handlers.js'].map((f) => [f, fs.readFileSync(join(repo, 'site', f), 'utf8')]);
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
  const appUsed = used(['index.html', 'app.js', 'experience.js']);
  for (const m of src['experience.js'].matchAll(/setAttribute\('data-on'\s*,\s*'([^']+)'/g)) appUsed.add(m[1].slice(m[1].indexOf(':') + 1));   // одна кнопка получает data-on из кода
  for (const [reg, u] of [['handlers.js', appUsed], ['cabinet-handlers.js', used(['cabinet.html', 'cabinet.js'])]]) {
    for (const n of u) assert.ok(named(reg).has(n), `${reg}: разметка ссылается на «${n}», а обработчика нет`);
    for (const n of named(reg)) assert.ok(u.has(n), `${reg}: «${n}» никем не используется — мёртвая запись после переноса`);
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
  console.log('PASS: backups are encrypted with a separate secret and the app key no longer sits beside the database.');

  // ── Схема: версия базы записана, повторный запуск ничего не меняет, health её показывает ──
  const { SCHEMA_VERSION } = await import(pathToFileURL(join(fixture, 'backend/schema.mjs')).href);
  assert.equal(qaDB.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'user_version tracks the last applied migration');
  assert.equal((await (await fetch(base + '/api/health')).json()).schema, SCHEMA_VERSION);
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
      /* «Аккаунт» больше не вкладка внизу: после перестройки навигации туда ведёт кружок с фото в шапке,
         а нижние вкладки — «Сегодня», «Свериться с собой», «Дневник», «Обо мне». */
      await page.locator('#h-acct').click();
      await page.locator('#v-account.on').waitFor();
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
      /* пробелы нормализуем: в подписи вкладки неразрывный пробел, чтобы «с собой» не разрывалось на узком экране */
      assert.deepEqual((await page.locator('.app-nav button').allTextContents()).map(t=>t.replace(/\s+/g,' ').trim()), ['Сегодня','Свериться с собой','Дневник','Обо мне']);
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
      await page.locator('#h-acct').click();await page.locator('#v-account [data-feature=news]').click();
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
      for(const [view,key] of [['home','card'],['home','mood'],['ask','worry'],['home','day'],['home','tone'],['home','askesis'],['history','wishes'],['home','habits'],['history','gratitude'],['about','natal'],['about','year'],['about','birthnum'],['about','compat'],['about','tests'],['home','lunar'],['home','sky'],['history','hmood'],['history','wishes'],['history','hentries'],['history','journal'],['history','week'],['account','edit'],['account','mail'],['account','remind'],['account','support']]) {
        await page.evaluate(v=>go(v),view);
        await page.locator(`#v-${view} [data-feature="${key}"]`).click();
        await page.waitForFunction(k=>document.querySelector(':is(#wg-body,#practice-body) #w-'+k)!==null,key);
        await close();
      }
      // «Скоро» рисуется из строк «скоро | …» в content/новое.txt: раздел виден только когда такие строки есть.
      await page.evaluate(()=>go('news'));await page.locator('#news-box .wid').first().waitFor();   /* paintNews асинхронный: ждём плитки */
      assert.equal(await page.locator('#news-soon').isHidden(), !(await page.evaluate(()=>(CAT?.news||[]).some(n=>n.soon))));
      await page.evaluate(()=>go('ask'));
      assert.deepEqual(await page.locator('#v-ask .wid b').allTextContents(),['Разобрать вопрос','Да / Нет','Руны','Таро']);
      console.log('PASS: all four main sections, all 32 emotion options, editable question chips, answer-to-diary flow, canonical News links, all restored cards, 320/390/844/1440 layouts.');
      assert.deepEqual(errors, []);
      console.log('PASS: existing profile/wish photo uploads and reloads, habit/askesis navigation, saved notes, failed-request draft protection and visible feedback in the mobile UI.');
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
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
