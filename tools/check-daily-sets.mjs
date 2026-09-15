import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDailySets, dailySet } from '../backend/daily-sets.mjs';
process.env.CONTENT_DIR ||= new URL('../content', import.meta.url).pathname;
const C = await import('../backend/content.mjs');
const source = { sets: [...C.SETS] };   // единственный источник — content/установки.txt

const db=new DatabaseSync(':memory:'); initDailySets(db);
assert.equal(source.sets.length,365);
assert.equal(new Set(source.sets.map(s=>s[1])).size,365);
assert.ok(source.sets.every(s=>s[2]?.endsWith('?')));
const days=[], results=[];
for(let i=0;i<731;i++){
  const day=new Date(Date.UTC(2027,0,1)+i*864e5).toISOString().slice(0,10);
  const result=dailySet(db,{id:1,name:'Анна'},day,source.sets);
  assert.ok(result?.text); assert.ok(result.statement); assert.ok(!result.statement.includes('{Имя}')&&!result.statement.includes('Анна')); assert.ok(!result.text.includes('{Имя}'));
  assert.ok(!results.slice(-364).some(s=>s.text===result.text),`Repeated phrase within a year: ${day}`);
  assert.deepEqual(dailySet(db,{id:1,name:'Анна'},day,[...source.sets].reverse()),result,'Reload/reorder must keep today unchanged');
  days.push(day);results.push(result);
}
assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_sets WHERE user_id=1').get().n,731);
const second=days.slice(0,365).map(day=>dailySet(db,{id:2,name:'Анна'},day,source.sets));
assert.equal(new Set(second.map(s=>s.text)).size,365);
assert.ok(second.some((s,i)=>s.text!==results[i].text),'Users must have individual sequences');
const migrated=new DatabaseSync(':memory:');
migrated.exec(`CREATE TABLE daily_sets(user_id INTEGER,day TEXT,idx INTEGER,PRIMARY KEY(user_id,day)); INSERT INTO daily_sets VALUES(7,'2026-09-14',0);`);
initDailySets(migrated,[source.sets[17]]);
assert.equal(dailySet(migrated,{id:7,name:'Анна'},'2026-09-14',source.sets).text,source.sets[17][1].replace('{Имя}','Анна'));
const next=dailySet(migrated,{id:7,name:'Анна'},'2026-09-15',source.sets);
assert.notEqual(next.text,source.sets[17][1].replace('{Имя}','Анна'));
db.close();migrated.close();
console.log('PASS: all 365 source phrases, 731 consecutive dates without repeats in each 365-day window, per-user sequences, reload/reorder stability and legacy migration.');
