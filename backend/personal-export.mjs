// Only the current account's content. No credentials, sessions, push addresses or staff data.
/* Состав полной выгрузки — один набор данных для JSON и PDF (аудит v98, F11): все отметки настроения по дням (moods.mjs),
   у мысли к материалу — источник (материал, вопрос, результат), у фото дня — адрес снимка; чего в файле нет — названо в limits. */
import {preferences} from './experience.mjs';
import { createMoods } from './moods.mjs';
import { readableWith } from './private-text.mjs';
import { countWord } from './util.mjs';
export const EXPORT_LIMITS = ['Фото дня в файле нет: у каждого снимка указан адрес (url), по нему фото открывается при входе в аккаунт', 'Картинок желаний в файле нет: у желания с фото указан адрес (url), по нему картинка открывается при входе в аккаунт'];
/* Строка «N записей не удалось расшифровать» — в limits, если такие есть; их id — отдельным полем unreadableIds (ревью v114, F14) */
export const unreadableLimit = (n) => `${countWord(n, 'запись', 'записи', 'записей')} не удалось расшифровать — обратитесь в поддержку`;
export function personalExport(db,u,open){
  const rows=(sql)=>db.prepare(sql).all(u.id);
  /* одна обертка расшифровки на всю выгрузку: не читается — text: null и unreadable: true, а не пустая строка (F14) */
  const readable=readableWith(open), unreadableIds=[];
  const rd=(id,s)=>{const r=readable(s);if(r.unreadable&&!unreadableIds.includes(id))unreadableIds.push(id);return r;};
  const journal=rows('SELECT id,ts,day,text,kind,title FROM journal WHERE user_id=? ORDER BY id').map(r=>{const t=rd(r.id,r.text),h=rd(r.id,r.title||'');const out={...r,text:t.text,title:h.text,...(t.unreadable||h.unreadable?{unreadable:true}:{})};
    if(r.kind==='thought'&&!h.unreadable){try{const m=JSON.parse(out.title);out.title='';out.thought={source:m.source||'',slug:m.slug||'',name:m.name||'',question:m.question||'',entry:Number(m.entry)||0};}catch{}}
    return out;});
  /* фото желаний — адресами, не data-URL (F09): они раздували JSON и время выгрузки; photo — есть ли снимок */
  const wishes=rows("SELECT id,ts,text,done,done_ts,photo<>'' AS hasPhoto,photo_ts FROM wishes WHERE user_id=? ORDER BY id").map(r=>{const t=readable(r.text);const {hasPhoto,...rest}=r;return {...rest,text:t.text,photo:!!hasPhoto,url:hasPhoto?`/app/api/wishes/photo?id=${r.id}`:'',...(t.unreadable?{unreadable:true}:{})};});
  const habits=rows('SELECT id,title,created_at,archived,rule,rule_text FROM habits WHERE user_id=? ORDER BY id').map(r=>{const t=readable(r.title);return {...r,title:t.text,rule_text:readable(r.rule_text||'').text,...(t.unreadable?{unreadable:true}:{}),marks:db.prepare('SELECT day FROM habit_marks WHERE habit_id=? ORDER BY day').all(r.id).map(x=>x.day)};});
  const askesis=rows('SELECT id,title,days,started,until,status,finished_at FROM askesis WHERE user_id=? ORDER BY id').map(r=>{const t=readable(r.title);return {...r,title:t.text,...(t.unreadable?{unreadable:true}:{}),observations:db.prepare('SELECT day,kept,note FROM askesis_days WHERE askesis_id=? ORDER BY day').all(r.id).map(n=>({...n,note:readable(n.note||'').text}))};});
  const limits=unreadableIds.length?[...EXPORT_LIMITS,unreadableLimit(unreadableIds.length)]:EXPORT_LIMITS;
  return {version:3,exportedAt:new Date().toISOString(),limits,...(unreadableIds.length?{unreadableIds}:{}),preferences:preferences(u.preferences),profile:{name:u.name,birth:u.birth,birthTime:u.birth_time,city:u.city,email:u.email,photo:(db.prepare('SELECT photo FROM users WHERE id=?').get(u.id)||{}).photo||''},journal,wishes,habits,askesis,
    moods:createMoods(db).all(u.id),   /* {day, mood — главное, marks — все отметки дня} */
    entries:rows('SELECT id,ts,day,kind,question,title,body,data FROM entries WHERE user_id=? ORDER BY id').map(r=>{const q=readable(r.question);return {...r,question:q.text,data:r.data,...(q.unreadable?{unreadable:true}:{})};}),
    dailySets:rows('SELECT day,text,question FROM daily_sets WHERE user_id=? ORDER BY day'),
    dayPhotos:rows('SELECT day,ts,w,h FROM day_photos WHERE user_id=? ORDER BY day').map(r=>({...r,url:`/app/api/day/photo?day=${r.day}&size=full`})),
    compat:rows('SELECT id,ts,day,other_birth,total,rings,you,other,text FROM compat_checks WHERE user_id=? ORDER BY id').map(r=>{let rings=[];try{rings=JSON.parse(r.rings);}catch{} return {...r,rings,text:readable(r.text).text};}),   /* история совместимости — та же, что в базе знаний (R10) */
    echoes:rows('SELECT day,verdict FROM week_echoes WHERE user_id=? ORDER BY day'),
    reminders:rows('SELECT feature,enabled,time,freq,weekday,tz FROM reminders WHERE user_id=? ORDER BY feature')};
}
