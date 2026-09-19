// Only the current account's content. No credentials, sessions, push addresses or staff data.
import {preferences} from './experience.mjs';
export function personalExport(db,u,open){
  const rows=(sql)=>db.prepare(sql).all(u.id);
  const journal=rows('SELECT id,ts,day,text,kind,title FROM journal WHERE user_id=? ORDER BY id').map(r=>({...r,text:open(r.text),title:open(r.title||'')}));
  const wishes=rows('SELECT id,ts,text,done,done_ts,photo,photo_ts FROM wishes WHERE user_id=? ORDER BY id').map(r=>({...r,text:open(r.text)}));
  const habits=rows('SELECT id,title,created_at,archived,rule,rule_text FROM habits WHERE user_id=? ORDER BY id').map(r=>({...r,title:open(r.title),rule_text:open(r.rule_text||''),marks:db.prepare('SELECT day FROM habit_marks WHERE habit_id=? ORDER BY day').all(r.id).map(x=>x.day)}));
  const askesis=rows('SELECT id,title,days,started,until,status,finished_at FROM askesis WHERE user_id=? ORDER BY id').map(r=>({...r,title:open(r.title),observations:db.prepare('SELECT day,kept,note FROM askesis_days WHERE askesis_id=? ORDER BY day').all(r.id).map(n=>({...n,note:open(n.note||'')}))}));
  return {version:2,exportedAt:new Date().toISOString(),preferences:preferences(u.preferences),profile:{name:u.name,birth:u.birth,birthTime:u.birth_time,city:u.city,email:u.email,photo:(db.prepare('SELECT photo FROM users WHERE id=?').get(u.id)||{}).photo||''},journal,wishes,habits,askesis,
    moods:rows('SELECT day,mood FROM moods WHERE user_id=? ORDER BY day'),
    entries:rows('SELECT id,ts,day,kind,question,title,body,data FROM entries WHERE user_id=? ORDER BY id').map(r=>({...r,question:open(r.question),data:r.data})),
    dailySets:rows('SELECT day,text,question FROM daily_sets WHERE user_id=? ORDER BY day'),
    dayPhotos:rows('SELECT day,ts,w,h FROM day_photos WHERE user_id=? ORDER BY day'),   /* только сведения: сами снимки — в приложении, по дню */
    echoes:rows('SELECT day,verdict FROM week_echoes WHERE user_id=? ORDER BY day'),
    reminders:rows('SELECT feature,enabled,time,freq,weekday,tz FROM reminders WHERE user_id=? ORDER BY feature')};
}
