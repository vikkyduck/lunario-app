/* Рабочие кабинеты: HTTP-слой `/api/cabinet/*`.

   Тонкий адаптер: разбирает запрос, проверяет роль и отдает ответ. Считают и пишут по-прежнему
   reports.mjs (числа), workspace.mjs (то, что сотрудники вносят сами), cabinet.mjs (роли и расходы),
   backup.mjs (копии) — сам этот файл ничего не вычисляет.

   Зависимости передаются явно, одним объектом, как у createShelves: видно, что именно нужно кабинету,
   и его можно собрать в проверке, не поднимая весь сервер. Правило доступа одно и то же на каждом
   запросе — скрытая кнопка не защита; состав кабинетов задает админ, по умолчанию берется из кода.

   Возвращает true: запрос обработан, ответ отправлен. */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export function createCabinetRoutes(deps) {
  const { json, readBody, rolesFor, isAdmin, getConfig, setConfig, resetConfig, REPORT_META, OVERVIEW_BLOCKS,
    Reports, userCard, contentFiles, readContent, writeContent, contentImageList, contentImagePut, CE, Backup, W,
    staffList, staffSet, staffRemove, notifyStaffAccess, ADMIN_EMAILS, costAdd, costRemove, logError, mailLive } = deps;

  return async function cabinetRoutes({ p, req, res, url, u }) {
    const roles = rolesFor(u.email);
    const cfg = getConfig();   // состав кабинетов задает админ; по умолчанию — из кода
    if (p === '/api/cabinet/me') return json(res, 200, { email: u.email || '', name: u.name || '', roles, isAdmin: isAdmin(u.email), mailReady: mailLive(), menus: cfg.menus, reports: cfg.reports, periods: cfg.periods, blocks: cfg.blocks, custom: cfg.custom });
    if (!roles.length) return json(res, 403, { ok: false, error: 'no_access' });
    const admin = roles.includes('admin');
    // роль проверяется на каждом запросе: скрытая кнопка — не защита
    /* страница «Контент» одна — под ней материалы, картинки, файлы и записи; «Проверка текстов» — пять отчетов о текстах */
    const UNDER = { content: ['materials', 'media', 'content', 'records', 'table'], check: ['quality', 'concerns', 'topics', 'rituals', 'feedback', 'faq'] };
    const allowed = (kind) => admin || roles.some((r) => { const m = cfg.menus[r] || []; return m.includes(kind) || Object.entries(UNDER).some(([page, kinds]) => kinds.includes(kind) && m.includes(page)); });
    if (p === '/api/cabinet/config') {
      if (req.method === 'GET') return json(res, 200, { ...cfg, defaults: { reports: REPORT_META, blocks: OVERVIEW_BLOCKS } });
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      if (req.method === 'POST') { const b = await readBody(req); const r = setConfig(b, u.email); if (r.ok) console.log(`[кабинет] ${u.email} изменил конфигурацию кабинетов`); return json(res, r.ok ? 200 : 400, r); }
      if (req.method === 'DELETE') { console.log(`[кабинет] ${u.email} сбросил конфигурацию кабинетов`); return json(res, 200, resetConfig()); }
    }
    if (p === '/api/cabinet/dashboard') {
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      return json(res, 200, await Reports.overview(Object.fromEntries(url.searchParams)));
    }
    if (p === '/api/cabinet/report') {
      const kind = url.searchParams.get('kind') || '';
      if (!allowed(kind)) return json(res, 403, { ok: false, error: 'no_access' });
      const r = await Reports.report(kind, Object.fromEntries(url.searchParams));
      if (!r) return json(res, 404, { ok: false, error: 'not_found' });
      if (kind === 'content') r.files = contentFiles();
      return json(res, 200, r);
    }
    /* ── резервные копии: список — всем, у кого есть «Здоровье системы»; снять и скачать — только админам ── */
    if (p === '/api/cabinet/backups' && req.method === 'GET') {
      if (!allowed('system')) return json(res, 403, { ok: false, error: 'no_access' });
      return json(res, 200, { ...Backup.list(), schedule: 'каждую ночь в 03:40 по серверу', keep: 14, admin });
    }
    if (p === '/api/cabinet/backups' && req.method === 'POST') {
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      try { const r = await Backup.run(true); console.log(`[кабинет] ${u.email} снял резервную копию: ${r.files.join(', ')}`); return json(res, 200, { ok: true, ...r }); }
      catch (e) { logError('/api/cabinet/backups', e.message); return json(res, 500, { ok: false, error: 'backup_failed', message: e.message }); }
    }
    if (p === '/api/cabinet/backups/download' && req.method === 'GET') {
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      const f = Backup.file(url.searchParams.get('name')); if (!f) return json(res, 404, { ok: false, error: 'not_found' });
      console.log(`[кабинет] ${u.email} скачал резервную копию ${basename(f)}`);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${basename(f)}"`, 'Cache-Control': 'no-store' });
      return res.end(readFileSync(f));
    }
    if (p === '/api/cabinet/user') {
      if (!allowed('users')) return json(res, 403, { ok: false, error: 'no_access' });
      const c = userCard(url.searchParams.get('id'));
      return c ? json(res, 200, c) : json(res, 404, { ok: false, error: 'not_found' });
    }
    if (p === '/api/cabinet/content') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      const name = String(url.searchParams.get('file') || '');
      if (!contentFiles().some((f) => f.name === name)) return json(res, 404, { ok: false, error: 'not_found' });
      if (req.method === 'GET') return json(res, 200, { name, text: readContent(name) });
      if (req.method === 'POST') {
        const b = await readBody(req);
        const text = String(b.text || '');
        if (text.length > 200000) return json(res, 400, { ok: false, error: 'too_long' });
        writeContent(name, text);   // папка под наблюдением — тексты перечитаются сами
        console.log(`[контент] ${u.email} сохранил ${name} (${text.length} симв.)`);
        return json(res, 200, { ok: true });
      }
    }
    /* тексты записями и строками (content-edit.mjs): книги — карты, руны, лунные дни, личный год; таблицы — настрой, пуши, темы… */
    if (p === '/api/cabinet/content-map') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      const files = contentFiles();
      return json(res, 200, { books: Object.entries(CE.BOOKS).map(([file, b]) => ({ file, ...b, lines: (files.find((f) => f.name === file) || {}).lines || 0 })),
        tables: Object.entries(CE.TABLES).map(([file, t]) => ({ file, title: t.title, cols: t.cols, lines: (files.find((f) => f.name === file) || {}).lines || 0 })),
        other: files.filter((f) => !CE.BOOKS[f.name] && !CE.TABLES[f.name]).map((f) => f.name), features: W.FEATURE_GROUPS });
    }
    if (p === '/api/cabinet/records') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      const file = String(url.searchParams.get('file') || '');
      if (!CE.BOOKS[file]) return json(res, 404, { ok: false, error: 'not_found' });
      try { return json(res, 200, { file, ...CE.BOOKS[file], records: CE.bookRecords(file) }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    }
    if (p === '/api/cabinet/record') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      if (req.method === 'POST') { const b = await readBody(req, 600 * 1024); const r = b.add !== undefined ? CE.bookRecordAdd(String(b.file || ''), b.add) : CE.bookRecordSave(String(b.file || ''), b); if (r.ok) console.log(`[контент] ${u.email} ${b.add !== undefined ? 'добавил запись в' : 'изменил запись в'} ${b.file}`); return json(res, r.ok ? 200 : 400, r); }
      if (req.method === 'DELETE') { const r = CE.bookRecordRemove(String(url.searchParams.get('file') || ''), url.searchParams.get('index')); return json(res, r.ok ? 200 : 400, r); }
    }
    if (p === '/api/cabinet/table') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      const file = String(req.method === 'GET' ? url.searchParams.get('file') || '' : '');
      if (req.method === 'GET') { if (!CE.TABLES[file]) return json(res, 404, { ok: false, error: 'not_found' }); try { return json(res, 200, { file, title: CE.TABLES[file].title, ...CE.tableRows(file) }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
      if (req.method === 'POST') { const b = await readBody(req, 600 * 1024); const r = CE.tableSave(String(b.file || ''), b.rows); if (r.ok) console.log(`[контент] ${u.email} сохранил таблицу ${b.file} (${r.rows} строк)`); return json(res, r.ok ? 200 : 400, r); }
    }
    /* картинки функций: список по наборам и замена файла */
    if (p === '/api/cabinet/content-images') {
      if (!allowed('content')) return json(res, 403, { ok: false, error: 'no_access' });
      if (req.method === 'GET') return json(res, 200, { sets: contentImageList() });
      if (req.method === 'POST') {
        const b = await readBody(req, 8 * 1024 * 1024);
        if (b.mediaId) { const f = W.mediaFile(b.mediaId); if (!f) return json(res, 404, { ok: false, error: 'not_found' }); b.type = f.type; b.data = readFileSync(f.path).toString('base64'); }   /* картинка из библиотеки — на карту, руну, день */
        const r = contentImagePut(b);
        if (r.ok) console.log(`[контент] ${u.email} заменил картинку ${b.kind}/${b.key} → ${r.name}`);
        return json(res, r.ok ? 200 : 400, r);
      }
    }
    if (p === '/api/cabinet/campaigns') {
      if (!allowed('campaigns')) return json(res, 403, { ok: false, error: 'no_access' });
      if (req.method === 'GET') return json(res, 200, { items: W.campaignList() });
      if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.campaignSave(b, u.email)); }
      if (req.method === 'DELETE') return json(res, 200, W.campaignRemove(url.searchParams.get('id')));
    }
    if (p === '/api/cabinet/materials') {
      if (!allowed('materials')) return json(res, 403, { ok: false, error: 'no_access' });
      if (req.method === 'GET') return json(res, 200, { items: W.materialList(), kinds: W.MATERIAL_KINDS, statuses: W.MATERIAL_STATUS, features: W.FEATURE_ART, groups: W.FEATURE_GROUPS });
      if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.materialSave(b, u.email)); }
      if (req.method === 'DELETE') return json(res, 200, W.materialRemove(url.searchParams.get('id')));
    }
    if (p === '/api/cabinet/media/archive' && req.method === 'POST') {
      if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
      const b = await readBody(req); return json(res, 200, W.mediaArchive(b.id, !!b.on));
    }
    if (p === '/api/cabinet/media/download' && req.method === 'GET') {
      if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
      const f = W.mediaFile(url.searchParams.get('id')); if (!f) return json(res, 404, { ok: false, error: 'not_found' });
      res.writeHead(200, { 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'no-store' });
      return res.end(readFileSync(f.path));
    }
    if (p === '/api/cabinet/media') {
      if (!allowed('media')) return json(res, 403, { ok: false, error: 'no_access' });
      if (req.method === 'GET') return json(res, 200, W.mediaList());
      if (req.method === 'POST') { const b = await readBody(req, 7 * 1024 * 1024); return json(res, 200, W.mediaAdd(b, u.email)); }
      if (req.method === 'DELETE') return json(res, 200, W.mediaRemove(url.searchParams.get('id')));
    }
    if (p === '/api/cabinet/ai' || p === '/api/cabinet/ai/check') {
      if (!allowed('ai')) return json(res, 403, { ok: false, error: 'no_access' });
      if (p.endsWith('/check') && req.method === 'POST') { const b = await readBody(req); return json(res, 200, await W.aiCheck(String(b.provider || ''))); }
      if (req.method === 'GET') return json(res, 200, { items: W.aiList() });
      if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, W.aiSave(b, u.email)); }
      if (req.method === 'DELETE') return json(res, 200, W.aiRemove(url.searchParams.get('provider')));
    }
    if (p === '/api/cabinet/tasks') {
      if (!allowed('backlog')) return json(res, 403, { ok: false, error: 'no_access' });
      // контент и поддержка видят только свое (с двумя ролями — обе области); продукт и админ — весь беклог
      const own = admin || roles.includes('product') ? [] : roles.filter((r) => r === 'content' || r === 'support');
      const pick = url.searchParams.get('role') || '';   // срез одной роли — только тем, кому открыт весь беклог
      if (req.method === 'GET') return json(res, 200, { items: W.taskList(own.length ? own : pick ? [pick] : []), statuses: W.TASK_STATUS, roles: W.TASK_ROLES, canCreate: admin || roles.includes('product'), own });
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (b.id && b.onlyStatus) { const r = W.taskStatus(b.id, b.status, u.email, own); return json(res, r.ok ? 200 : r.error === 'no_access' ? 403 : 400, r); }
        if (!(admin || roles.includes('product'))) return json(res, 403, { ok: false, error: 'product_only' });
        return json(res, 200, W.taskSave(b, u.email));
      }
      if (req.method === 'DELETE') { if (!(admin || roles.includes('product'))) return json(res, 403, { ok: false, error: 'product_only' }); return json(res, 200, W.taskRemove(url.searchParams.get('id'))); }
    }
    if (p === '/api/cabinet/tickets' || p === '/api/cabinet/ticket') {
      if (!allowed('tickets')) return json(res, 403, { ok: false, error: 'no_access' });
      if (p.endsWith('/tickets')) return json(res, 200, { items: W.ticketQueue(url.searchParams.get('status') || ''), statuses: W.TICKET_STATUS, topics: W.TICKET_TOPICS });
      const id = url.searchParams.get('id');
      if (req.method === 'GET') { const t = W.ticketThread(id); return t ? json(res, 200, t) : json(res, 404, { ok: false, error: 'not_found' }); }
      if (req.method === 'POST') { const b = await readBody(req); if (b.text) { const r = W.ticketMessage(id, 'support', b.text, u.email); if (!r.ok) return json(res, 400, r); } if (b.status || b.priority || b.topic) W.ticketSet(id, b, u.email); return json(res, 200, { ok: true }); }
    }
    if (p === '/api/cabinet/staff') {
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      if (req.method === 'GET') return json(res, 200, { items: staffList(), admins: ADMIN_EMAILS });
      if (req.method === 'POST') {
        const b = await readBody(req);
        const r = staffSet(b.email, b.name, b.roles, u.email);
        if (r.ok) notifyStaffAccess(String(b.email || '').toLowerCase().trim(), Array.isArray(b.roles) ? b.roles : []);
        return json(res, 200, r);
      }
      if (req.method === 'DELETE') return json(res, 200, staffRemove(url.searchParams.get('email')));
    }
    if (p === '/api/cabinet/costs') {
      if (!admin) return json(res, 403, { ok: false, error: 'admins_only' });
      if (req.method === 'POST') { const b = await readBody(req); return json(res, 200, costAdd(b.month, b.name, b.amount, b.kind)); }
      if (req.method === 'DELETE') return json(res, 200, costRemove(url.searchParams.get('id')));
    }
    return json(res, 404, { ok: false, error: 'not_found' });
  };
}
