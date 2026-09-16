export const DEFAULT_PREFERENCES = {theme:'dark', ritual:['card','mood','gratitude'], topics:[], topicsAll:false, lunarViews:0};
const practices = new Set(['card','mood','habits','gratitude','tone','journal']);
export function preferences(raw) {
  try { return {...DEFAULT_PREFERENCES, ...JSON.parse(raw || '{}')}; }
  catch { return {...DEFAULT_PREFERENCES}; }
}
const topicKey = (k) => typeof k === 'string' && /^[a-z][a-z0-9-]{1,19}$/.test(k);
export function validPreferences(value) {
  if (value && value.topics !== undefined && !(Array.isArray(value.topics) && value.topics.length <= 12 && value.topics.every(topicKey))) return false;
  if (value && value.tools !== undefined && !(Array.isArray(value.tools) && value.tools.length <= 40 && value.tools.every(topicKey))) return false;   /* видимые инструменты: ключи из каталога */
  if (value && value.topicsAll !== undefined && typeof value.topicsAll !== 'boolean') return false;
  return value && ['system','light','dark'].includes(value.theme) && Array.isArray(value.ritual)
    && value.ritual.length >= 2 && value.ritual.length <= 3
    && new Set(value.ritual).size === value.ritual.length && value.ritual.every(k=>practices.has(k));
}
// One timeline over the original records. No copied journal or parallel source of truth.
export function timeline(db, uid, query, open) {
  const offset = Math.max(0, Math.min(100000, Math.trunc(Number(query.get('offset'))) || 0));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('day') || '') ? query.get('day') : '';
  const kind = query.get('kind') || '';
  const rows = db.prepare(`WITH timeline AS (
    SELECT 'journal' source, id, day, ts, CASE WHEN kind='' THEN 'journal' ELSE kind END kind, title, text body, '' data FROM journal WHERE user_id=?
    UNION ALL SELECT 'entry',id,day,ts,'readings',title,question,data FROM entries WHERE user_id=?
    UNION ALL SELECT 'mood',0,day,day,'mood',mood,'','' FROM moods WHERE user_id=?
    UNION ALL SELECT 'askesis',a.id,n.day,n.day,'practices',a.title,n.note,'' FROM askesis_days n JOIN askesis a ON a.id=n.askesis_id WHERE a.user_id=?
    UNION ALL SELECT 'habit',h.id,m.day,m.day,'practices',h.title,'','' FROM habit_marks m JOIN habits h ON h.id=m.habit_id WHERE h.user_id=?
    UNION ALL SELECT 'wish',id,substr(ts,1,10),ts,'wishes',text,'',CAST(done AS TEXT) FROM wishes WHERE user_id=?
  ) SELECT * FROM timeline WHERE (?='' OR day=?) AND (?='' OR kind=?) ORDER BY day DESC,ts DESC,source,id DESC LIMIT 61 OFFSET ?`)
    .all(uid,uid,uid,uid,uid,uid,day,day,kind,kind,offset);
  const more=rows.length>60;
  return {items:rows.slice(0,60).map(r=>({...r,title:open(r.title||''),body:open(r.body||'')})),next:more?offset+60:null};
}
