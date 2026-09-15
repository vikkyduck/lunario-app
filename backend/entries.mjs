// Read the original records. Cursor paging keeps older questions reachable without copying history.
export function entryPage(db, userId, query, open) {
  const id = Math.max(0, Math.trunc(Number(query.get('id'))) || 0);
  const before = Math.max(0, Math.trunc(Number(query.get('before'))) || 0);
  const kind = ['questions', 'card'].includes(query.get('kind')) ? query.get('kind') : '';
  const rows = db.prepare(`SELECT id, day, kind, question, title, body, data FROM entries
    WHERE user_id=? AND (?=0 OR id=?) AND (?=0 OR id<?)
      AND (?='' OR (?='card' AND kind='card') OR (?='questions' AND kind<>'card'))
    ORDER BY id DESC LIMIT 101`).all(userId,id,id,before,before,kind,kind,kind);
  const items = rows.slice(0,100).map(row => {
    let data = {}; try { data = JSON.parse(row.data || '{}'); } catch {}
    return {...row, question:open(row.question), data};
  });
  return {items, next:rows.length>100 ? items.at(-1).id : null};
}
