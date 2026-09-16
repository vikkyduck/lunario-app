const $ = (id) => document.getElementById(id);
const API = '/app/api', ICON = '/app/assets/brand/icons/';
const ROLE_META = {
  admin:     ['Админ', 'person', 'сводка, система, доступы'],
  marketing: ['Маркетолог', 'users', 'источники и аудитория'],
  product:   ['Продуктолог', 'spark', 'поведение и экономика'],
  content:   ['Контент', 'pen', 'материалы и качество'],
  support:   ['Поддержка', 'chat', 'обращения и помощь'],
  user:      ['Пользователь', 'moon', 'открыть приложение'],
};
const S = { me: null, role: null, page: null, period: '30d', filters: {}, data: null };
const api = async (path, opts) => {
  const r = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'err'), { code: j.error, status: r.status });
  return j;
};
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const fmt = (n) => (n === null || n === undefined ? '—' : typeof n === 'number' ? n.toLocaleString('ru-RU') : String(n));
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const daysWord = (n) => { const a = n % 10, b = n % 100; return n + ' ' + (b >= 11 && b <= 14 ? 'дней' : a === 1 ? 'день' : a >= 2 && a <= 4 ? 'дня' : 'дней'); };
const periodKeys = () => (S.me && S.me.periods && S.me.periods.length ? S.me.periods : [7, 30, 90]).map((d) => d + 'd');
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800); }
function show(v) { document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v)); window.scrollTo(0, 0); }
function openModal(html) { $('modal-body').innerHTML = html; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on'); }
const COLORS = ['#e0c070', '#a9b8ff', '#c9a4e8', '#8fd9b6', '#f0a3a3', '#f3dca0', '#7fb2e8', '#d4a373', '#b5b5b5'];

/* ── вход ── */
let loginEmail = '';
function renderLogin(step) {
  const box = $('l-box');
  if (step === 'code') {
    box.innerHTML = `<p style="font-size:15px;color:#e8e2f5">Код отправлен на <b>${esc(loginEmail)}</b></p>
      <input id="l-code" inputmode="numeric" maxlength="6" placeholder="000000" style="margin-top:12px;letter-spacing:8px;text-align:center;font-size:22px">
      <button data-on="click:loginVerify" class="btn gold" style="width:100%;margin-top:12px">Войти</button>
      <button data-on="click:renderLogin-email" class="btn sm" style="margin-top:8px">Изменить адрес</button><p class="msg" id="l-msg"></p>`;
    setTimeout(() => $('l-code').focus(), 60); return;
  }
  box.innerHTML = `<label class="eyebrow" style="margin-bottom:8px">Почта</label><input id="l-email" type="email" placeholder="you@example.ru" value="${esc(loginEmail)}">
    <button data-on="click:loginRequest" class="btn gold" style="width:100%;margin-top:12px">Прислать код</button><p class="msg" id="l-msg"></p>`;
  setTimeout(() => $('l-email').focus(), 60);
}
async function loginRequest() {
  const email = $('l-email').value.trim().toLowerCase(), msg = $('l-msg'); msg.className = 'msg';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { msg.classList.add('err'); msg.textContent = 'Проверьте адрес почты.'; return; }
  msg.textContent = 'Отправляем код…';
  try { await api('/auth/request', { method: 'POST', body: JSON.stringify({ email }) }); loginEmail = email; renderLogin('code'); }
  catch (e) { msg.classList.add('err'); msg.textContent = e.code === 'too_often' ? 'Слишком часто. Попробуйте через несколько минут.' : e.code === 'mail_off' ? 'Отправка почты не настроена.' : 'Не получилось отправить код.'; }
}
async function loginVerify() {
  const code = $('l-code').value.trim(), msg = $('l-msg'); msg.className = 'msg';
  if (code.length !== 6) { msg.classList.add('err'); msg.textContent = 'Код состоит из шести цифр.'; return; }
  try { await api('/auth/verify', { method: 'POST', body: JSON.stringify({ email: loginEmail, code }) }); await boot(); }
  catch (e) { msg.classList.add('err'); msg.textContent = e.code === 'wrong_code' ? 'Код не подошёл.' : e.code === 'expired' ? 'Код истёк — запросите новый.' : 'Не получилось войти.'; }
}
async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); }

/* ── роли ── */
function renderRoles() {
  const me = S.me, mine = new Set(me.roles);
  $('roles').innerHTML = Object.entries(ROLE_META).map(([k, [name, ico, sub]]) => {
    const has = mine.has(k);
    if (k === 'user') return `<a class="role${has ? '' : ' off'}" href="/app/?app=1"><i class="ico" style="--m:url(${ICON}${ico}.svg?v=2)"></i>${name}<small>${sub}</small></a>`;
    return `<button data-on="click:openRole-a0" data-a0="${k}" class="role${has ? '' : ' off'}" type="button"><i class="ico" style="--m:url(${ICON}${ico}.svg?v=2)"></i>${name}<small>${has ? sub : 'нет доступа'}</small></button>`;
  }).join('');
  $('who').innerHTML = `<span>${esc(me.name || '')}${me.name ? ' · ' : ''}${esc(me.email)}</span><a class="btn sm" href="/app/?app=1">В приложение</a><button data-on="click:logout" class="btn sm">Выйти</button>`;
  renderTeam();
}
const staffRows = (items) => items.map((s) => `<tr><td>${esc(s.name) || '<span class="lock">—</span>'}</td><td>${esc(s.email)}</td><td>${s.roles.filter((x) => x !== 'user').map((x) => `<span class="pill">${ROLE_META[x] ? ROLE_META[x][0] : x}</span>`).join('')}</td><td style="text-align:right">${s.locked ? '<span class="lock">защищён</span>' : `<button data-on="click:staffForm-a0" data-a0="${esc(s.email)}" class="btn sm">Изменить</button> <button data-on="click:staffDel-a0" data-a0="${esc(s.email)}" class="btn sm warn">Удалить</button>`}</td></tr>`).join('');
async function renderTeam() {
  const box = $('team');
  if (!S.me.isAdmin) {
    box.innerHTML = `<div class="notice">Откройте доступный кабинет. В роли «Пользователь» — приложение. Таблица доступов видна администраторам.</div>
      <div class="viz" style="margin-top:14px"><h3>Начните с рабочего кабинета</h3><div class="chips" style="margin-top:10px">${S.me.roles.filter((r) => r !== 'user').map((r) => `<span class="chip on">${ROLE_META[r][0]}</span>`).join('')}</div></div>`;
    return;
  }
  box.innerHTML = '<p class="empty">Загружаем доступы…</p>';
  const r = await api('/cabinet/staff'); S.staff = r.items;
  box.innerHTML = `<div class="row" style="justify-content:flex-end"><button data-on="click:staffForm" class="btn gold sm fixed">+ Добавить участника</button></div>
    <div class="tbl" style="margin-top:10px"><div class="scroll"><table class="staff-tbl"><thead><tr><th>ФИО</th><th>Почта</th><th>Роли</th><th></th></tr></thead><tbody>${staffRows(r.items)}</tbody></table></div></div>`;
}
function staffForm(email) {
  const s = (S.staff || []).find((x) => x.email === email);
  if (s && s.locked) { toast('Права защищённого администратора изменить нельзя'); return; }
  openModal(`<div class="head"><div><span class="eyebrow">Доступы</span><h2 style="margin-top:6px">${s ? 'Изменить доступы' : 'Добавить участника'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row" style="margin-top:14px"><input id="st-name" placeholder="ФИО" maxlength="80" value="${esc(s ? s.name : '')}"><input id="st-email" type="email" placeholder="почта" maxlength="120" value="${esc(s ? s.email : '')}" ${s ? 'readonly' : ''}></div>
    <div class="chips" style="margin-top:12px" id="st-roles">${['marketing', 'product', 'content', 'support'].map((k) => { const on = s && s.roles.includes(k); return `<label class="chip${on ? ' on' : ''}"><input data-on="change:this-parentNode-classList-toggle-on-checked" type="checkbox" value="${k}" ${on ? 'checked' : ''}> ${ROLE_META[k][0]}</label>`; }).join('')}</div>
    <p class="hint">Роль «Пользователь» доступна каждому. Назначить дополнительного администратора нельзя — их двое и они заданы почтой.</p>
    <div class="row" style="margin-top:14px"><button data-on="click:staffSave" class="btn gold fixed">Сохранить доступы</button>${s ? `<button data-on="click:staffDel-a0" data-a0="${esc(s.email)}" class="btn sm warn fixed">Удалить из команды</button>` : ''}<span class="hint" id="st-msg"></span></div>`);
  setTimeout(() => $(s ? 'st-name' : 'st-email').focus(), 60);
}
function openRole(k) { S.role = k; const menu = S.me.menus[k] || []; S.page = null; show('cab'); renderMenu(); openPage(menu[0]); history.replaceState(null, '', '#' + k); }
function renderMenu() {
  const menu = S.me.menus[S.role] || [];
  $('menu').innerHTML = `<a data-on="click:showHome-return-false" class="back" href="#">← Роли</a>` + menu.map((p) => `<a data-on="click:openPage-a0-return-false" data-a0="${p}" href="#${S.role}/${p}" class="${p === S.page ? 'on' : ''}">${esc((S.me.reports[p] || [p])[0])}</a>`).join('')
    + (S.me.isAdmin ? `<a data-on="click:cfgOpen-return-false" href="#" class="cfg">⚙ Настроить кабинет</a>` : '');
}
function showHome() { show('home'); history.replaceState(null, '', '#'); }

/* ── страница отчёта ── */
async function openPage(p) {
  S.page = p; renderMenu(); history.replaceState(null, '', `#${S.role}/${p}`);
  const box = $('report');
  const meta = S.me.reports[p] || [p, ''];
  box.innerHTML = `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 style="margin-top:6px">${esc(meta[0])}</h1><p style="margin-top:6px">${esc(meta[1])}</p></div></div><p class="empty">Считаем…</p>`;
  window.scrollTo(0, 0);
  try {
    if (p === 'saved') return renderSaved();
    if (p === 'access') return renderAccess();
    const qs = new URLSearchParams({ period: S.period, ...S.filters });
    const r = p === 'overview' ? await api('/cabinet/dashboard?' + qs) : await api(`/cabinet/report?kind=${p}&` + qs);
    S.data = r;
    if (p === 'overview') return renderOverview(r);
    renderReport(r);
  } catch (e) { box.innerHTML += `<p class="msg err">Не получилось загрузить: ${esc(e.code || e.message)}</p>`; }
}
const periodLabel = (P) => `${fmtDay(P.from)} — ${fmtDay(P.to)} · сравнение с ${fmtDay(P.prevFrom)} — ${fmtDay(P.prevTo)}`;
function toolbar(r, withSave = true) {
  const per = periodKeys().map((k) => `<button data-on="click:setPeriod-a0" data-a0="${k}" data-p="${k}" class="${S.period === k ? 'on' : ''}">${daysWord(parseInt(k))}</button>`).join('');
  const filters = (r.filters || []).map((f) => `<label>${esc(f.label)}<select data-on="change:setFilter-a0-value" data-a0="${f.key}"><option value="">Все</option>${f.options.map(([v, t]) => `<option value="${esc(v)}" ${f.value === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`).join('');
  const search = r.key === 'users' ? `<label>Поиск<input data-on="keydown:if-event-key-Enter-setFilter-q-value" id="u-q" placeholder="имя, почта или id" value="${esc(S.filters.q || '')}"></label>` : '';
  return `<div class="tools"><div class="periods">${per}</div><div class="filters">${filters}${search}</div>${withSave ? `<span style="flex:1"></span><button data-on="click:saveReport" class="btn sm">☆ Сохранить</button><button data-on="click:exportCsv" class="btn sm">↓ CSV</button>` : ''}</div>
    <p class="hint">${periodLabel(r.period)}${Object.keys(S.filters).filter((k) => S.filters[k]).length ? ' · фильтры: ' + Object.entries(S.filters).filter(([, v]) => v).map(([k, v]) => v).join(', ') : ''}</p>`;
}
function setPeriod(k) { S.period = k; openPage(S.page); }
function setFilter(k, v) { S.filters[k] = v; openPage(S.page); }
function head(r) { return `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 style="margin-top:6px">${esc(r.title)}</h1><p style="margin-top:6px">${esc(r.question)}</p></div></div>`; }

function cmp(k) {
  if (k.delta === null || k.delta === undefined) return k.prev === null || k.prev === undefined ? '' : `<span class="cmp">раньше — ${fmt(k.prev)}</span>`;
  const good = k.good === 'down' ? k.delta < 0 : k.delta > 0, bad = k.good === 'down' ? k.delta > 0 : k.delta < 0;
  const arrow = k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '=';
  return `<span class="cmp"><span class="${good ? 'up' : bad ? 'down' : ''}">${arrow} ${Math.abs(k.delta)}%</span> · раньше — ${fmt(k.prev)}</span>`;
}
function kpiCard(k) {
  const na = k.state === 'off' ? '<span class="state off">не запущено</span>' : k.state === 'nodata' || k.value === null ? '<span class="state">нет данных</span>' : '';
  return `<div class="kpi"><b>${esc(k.title)}</b>${na ? `<span class="val na">${na}</span>` : `<span class="val">${fmt(k.value)}<span class="unit">${esc(k.unit)}</span></span>${cmp(k)}`}${k.sub ? `<span class="sub">${esc(k.sub)}</span>` : ''}</div>`;
}
function renderReport(r) {
  let html = head(r) + toolbar(r);
  if (r.kpis && r.kpis.length) html += `<div class="kpis">${r.kpis.map(kpiCard).join('')}</div>`;
  if (r.notes && r.notes.length) html += r.notes.map((n) => `<div class="notice">${esc(n)}</div>`).join('');
  if (r.key === 'economy') html += economyExtras(r);
  if (r.charts && r.charts.length) html += `<div class="charts">${r.charts.map(vizCard).join('')}</div>`;
  if (r.key === 'users') html += usersTable(r);
  if (r.key === 'content') html += contentFiles(r);
  for (const t of r.tables || []) html += tableCard(t, r.key);
  html += `<div id="extra"></div>`;
  if (r.how) html += `<div class="how"><b>Как считается.</b> ${esc(r.how)}</div>`;
  $('report').innerHTML = html;
  const ex = EXTRAS[r.key]; if (ex) ex(r).catch((e) => { $('extra').innerHTML = `<p class="msg err">Не загрузилось: ${esc(e.code || e.message)}</p>`; });
}
const fmtTs = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const field = (label, inner) => `<label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--faint)">${label}${inner}</label>`;
const utmLink = (c) => { const u = new URL('https://lunario.online/app/'); for (const k of ['source', 'medium', 'campaign', 'content', 'term']) if (c[k]) u.searchParams.set('utm_' + k, c[k]); return u.toString(); };
const copy = (t) => navigator.clipboard.writeText(t).then(() => toast('Ссылка скопирована')).catch(() => prompt('Скопируйте ссылку', t));
const EXTRAS = {
  /* резервные копии — на странице «Здоровье системы»: статус, снять сейчас, скачать */
  async system() {
    const r = await api('/cabinet/backups');
    const ageH = (t) => (t ? (Date.now() - Date.parse(t)) / 36e5 : null);
    const fresh = (t) => t !== null && ageH(t) !== null && ageH(t) < 26;
    const when = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было');
    const mbs = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : (b / 1048576).toFixed(1).replace('.', ',') + ' МБ');
    const kp = (title, t, sub) => ({ title, value: t ? when(t) : null, unit: '', sub: sub || (t ? (fresh(t) ? 'свежая' : 'старше суток — проверьте cron') : ''), state: t ? 'ok' : 'nodata' });
    const rows = r.items.map((f) => `<tr><td>${f.kind === 'db' ? 'База и полочки' : 'Тексты и картинки'}</td><td>${when(f.ts)}</td><td>${mbs(f.size)}</td><td>${r.admin ? `<a class="btn sm" href="/app/api/cabinet/backups/download?name=${encodeURIComponent(f.name)}">Скачать</a>` : ''}</td></tr>`).join('');
    $('extra').innerHTML = `<h3 style="margin-top:22px">Резервные копии</h3>
      <div class="kpis" style="margin-top:10px">${kpiCard(kp('База приложения', r.last))}${kpiCard(kp('Тексты и картинки', r.lastContent))}${kpiCard({ title: 'Ключ шифрования', value: r.keys ? 'в копии' : null, unit: '', sub: r.keys ? 'без него база не читается' : 'нет — снимите копию', state: r.keys ? 'ok' : 'nodata' })}</div>
      <div class="notice">Копии снимаются ${esc(r.schedule)}: база (люди, записи, полочки), ключ шифрования, ключи пушей и папка контента. Хранятся ${r.keep} последних каждого вида в ${esc(r.dir)} на сервере. Личные тексты внутри зашифрованы; скачать может только администратор — и это попадает в журнал.</div>
      ${r.admin ? `<div class="row" style="margin-top:12px;gap:10px"><button data-on="click:backupNow" class="btn gold sm fixed" id="bk-run">Снять копию сейчас</button><span class="hint" id="bk-msg"></span></div>` : ''}
      <div class="tbl" style="margin-top:10px"><div class="scroll"><table><thead><tr><th>Что</th><th>Когда</th><th>Размер</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Копий пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async campaigns() {
    const r = await api('/cabinet/campaigns'); S.campaigns = r.items;
    $('extra').innerHTML = `<div class="row" style="justify-content:flex-end;margin-top:14px"><button data-on="click:campaignForm-0" class="btn gold sm fixed">+ Новая кампания</button></div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Кампания</th><th>UTM</th><th>Обещание · размещение</th><th>Расходы</th><th>Даты</th><th>Ссылка</th><th></th></tr></thead><tbody>${r.items.map((c) => `<tr><td><b>${esc(c.name)}</b><small>${esc((c.created_by || '').split('@')[0])}</small></td><td>${esc([c.source, c.medium, c.campaign, c.content].filter(Boolean).join(' / '))}</td><td>${esc(c.promise) || '—'}<small>${esc(c.placement)}</small></td><td class="num">${fmt(Math.round(c.cost))} ₽</td><td>${c.start_day || '—'}${c.end_day ? ' — ' + c.end_day : ''}</td><td><button data-on="click:copy-link" class="btn sm" data-link="${esc(utmLink(c))}">Скопировать</button></td><td class="num"><button data-on="click:campaignForm-a0" data-a0="${c.id}" class="btn sm">Изменить</button> <button data-on="click:campaignDel-a0" data-a0="${c.id}" class="btn sm warn">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Кампаний пока нет. Заведите первую — и получите ссылку с UTM.</td></tr>'}</tbody></table></div>
      <p class="note">Ссылка ведёт в приложение; лендинг тоже пробрасывает UTM в приложение, так что можно вести и на lunario.online. Расходы и обещание нужны, чтобы в «Привлечении» посчиталась цена регистрации и удержанного.</p></div>`;
  },
  async materials() {
    const r = await api('/cabinet/materials'); S.materials = r; const st = (k) => `<span class="pill" style="${k === 'published' ? 'border-color:rgba(168,236,198,.6);color:var(--ok)' : k === 'draft' ? 'opacity:.7' : ''}">${esc(r.statuses[k] || k)}</span>`;
    $('extra').innerHTML = `<div class="row" style="justify-content:flex-end;margin-top:14px"><button data-on="click:materialForm-0" class="btn gold sm fixed">+ Новый материал</button></div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Материал</th><th>Тип · раздел</th><th>Дата показа</th><th>Статус</th><th>Изменён</th><th></th></tr></thead><tbody>${r.items.map((m) => `<tr><td><b>${esc(m.title || m.text.slice(0, 60))}</b>${m.image ? `<small><a href="${esc(m.image)}" target="_blank">картинка</a></small>` : ''}</td><td>${esc(r.kinds[m.kind] || m.kind)}<small>${esc(m.section)}</small></td><td>${m.show_day || 'каждый день'}</td><td>${st(m.status)}</td><td>${fmtTs(m.updated_at)}<small>${esc((m.created_by || '').split('@')[0])}</small></td><td class="num"><button data-on="click:materialForm-a0" data-a0="${m.id}" class="btn sm">Открыть</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Материалов пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async media() {
    const r = await api('/cabinet/media'); const mb = (b) => (b / 1048576).toFixed(1) + ' МБ';
    const card = (m) => `<div class="file" style="flex-direction:column;align-items:stretch;cursor:default${m.archived ? ';opacity:.7' : ''}">${!m.archived && m.type.startsWith('image/') && m.type !== 'image/svg+xml' ? `<img src="/app/uploads/${esc(m.file)}" alt="" loading="lazy" style="width:100%;height:120px;object-fit:cover;border-radius:10px">` : `<div style="height:60px;display:grid;place-items:center;color:var(--faint)">${m.archived ? 'в архиве' : esc(m.type)}</div>`}<span style="margin-top:8px">${esc(m.name)}<br><small>${Math.round(m.size / 1024)} КБ · ${fmtTs(m.created_at)}${m.archived ? ' · сгружен ' + fmtTs(m.archived_at) : ''}</small></span>
      <div class="row" style="margin-top:8px;gap:6px">${m.archived ? `<button data-on="click:mediaArchive-a0-false" data-a0="${m.id}" class="btn sm">Вернуть</button>` : `<button data-on="click:copy-link" class="btn sm" data-link="${location.origin}/app/uploads/${esc(m.file)}">Ссылка</button><button data-on="click:mediaArchive-a0-true" data-a0="${m.id}" class="btn sm" title="убрать с сервера в архив: ссылка перестанет работать, файл и запись сохранятся">Сгрузить</button>`}<a class="btn sm" href="/app/api/cabinet/media/download?id=${m.id}">Скачать</a><button data-on="click:mediaDel-a0" data-a0="${m.id}" class="btn sm warn fixed">✕</button></div></div>`;
    const live = r.items.filter((m) => !m.archived), arch = r.items.filter((m) => m.archived);
    $('extra').innerHTML = `<div class="kpis" style="margin-top:14px">${kpiCard({ title: 'Отдаётся пользователям', value: +mb(r.totals.live).replace(',', '.').split(' ')[0], unit: 'МБ', sub: `${live.length} файлов · в приложение попадает только то, что вставлено в опубликованный материал`, state: 'ok' })}${kpiCard({ title: 'В архиве на сервере', value: +mb(r.totals.archived).split(' ')[0], unit: 'МБ', sub: `${arch.length} файлов · не отдаются, можно вернуть или скачать`, state: 'ok' })}</div>
      <div class="notice">Приложение у пользователей хранит только оболочку (шрифты, иконки, ~1 МБ); картинки материалов грузятся по сети при показе и на телефоне не оседают. Чтобы облегчить сервер, сгружайте файлы, которые больше не нужны в приложении: запись и доступ к скачиванию останутся.</div>
      <div class="viz" style="margin-top:14px"><h3>Загрузить</h3><div class="row" style="margin-top:10px"><input type="file" id="m-file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf" style="padding:8px"><button data-on="click:mediaUpload" class="btn gold fixed">Загрузить</button><span class="hint" id="m-msg"></span></div><p class="hint">До 5 МБ. Для картинок в приложении лучше WebP или JPG шириной до 1600px — они в разы легче PNG.</p></div>
      <h3 style="margin-top:18px">Активные</h3><div class="files" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${live.map(card).join('') || '<p class="empty">Файлов пока нет.</p>'}</div>
      ${arch.length ? `<h3 style="margin-top:18px">Архив</h3><div class="files" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${arch.map(card).join('')}</div>` : ''}`;
  },
  async backlog() {
    const r = await api('/cabinet/tasks'); S.tasks = r;
    const sel = (t) => `<select data-on="change:taskStatus-a0-value" data-a0="${t.id}" style="min-height:34px;padding:4px 30px 4px 10px;font-size:14px">${Object.entries(r.statuses).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    $('extra').innerHTML = `${r.canCreate ? `<div class="row" style="justify-content:flex-end;margin-top:14px"><button data-on="click:taskForm-0" class="btn gold sm fixed">+ Новая задача</button></div>` : `<div class="notice">Вы видите задачи, поставленные ${r.own.length > 1 ? 'вашим ролям' : 'вашей роли'}${r.own.length ? ` (${r.own.map((k) => `«${esc(r.roles[k])}»`).join(', ')})` : ''}. Меняйте статус — постановщик увидит его сразу.</div>`}
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Задача</th><th>Кому</th><th>Приоритет</th><th>Срок</th><th>Статус</th><th>Поставил</th><th></th></tr></thead><tbody>${r.items.map((t) => `<tr style="${t.status === 'done' ? 'opacity:.55' : ''}"><td><b>${esc(t.title)}</b>${t.text ? `<small>${esc(t.text.slice(0, 140))}</small>` : ''}</td><td>${esc(r.roles[t.role] || t.role)}${t.assignee ? `<small>${esc(t.assignee)}</small>` : ''}</td><td>${t.priority === 'high' ? '<span class="pill" style="color:var(--warn);border-color:rgba(255,184,184,.5)">высокий</span>' : 'обычный'}</td><td>${t.due_day || '—'}</td><td>${sel(t)}</td><td>${esc(t.created_by)}<small>${fmtTs(t.created_at)}</small></td><td class="num">${r.canCreate ? `<button data-on="click:taskForm-a0" data-a0="${t.id}" class="btn sm">✎</button> <button data-on="click:taskDel-a0" data-a0="${t.id}" class="btn sm warn">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Задач пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async tickets() {
    const q = S.data.queue || [], st = S.data.statuses || {};
    const f = S.filters.tstatus || '';
    const rows = q.filter((t) => !f || t.status === f);
    $('extra').innerHTML = `<div class="chips" style="margin-top:14px">${[['', 'Все'], ...Object.entries(st)].map(([k, v]) => `<span data-on="click:S-filters-tstatus-a0-EXTRAS-tickets" data-a0="${k}" class="chip${f === k ? ' on' : ''}">${esc(v)}</span>`).join('')}</div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>№</th><th>Пользователь</th><th>Тема</th><th>Статус</th><th>Приоритет</th><th>Первый ответ</th><th>Последнее</th><th></th></tr></thead><tbody>${rows.map((t) => `<tr><td class="num">${t.id}${t.unread ? ` <span class="pill" style="color:var(--gold-2)">${t.unread} нов.</span>` : ''}</td><td>${esc(t.user.name) || '—'}<small>${esc(t.user.email) || 'без почты'} · id ${t.user.id}</small></td><td><b>${esc(t.subject)}</b><small>${esc(t.topic)}</small></td><td>${esc(t.statusName)}</td><td>${t.priority === 'high' ? '<span style="color:var(--warn)">высокий</span>' : 'обычный'}</td><td>${t.firstReplyMin === null ? (t.status === 'resolved' ? '—' : '<span style="color:var(--warn)">ждёт</span>') : `${t.firstReplyMin} мин ${t.slaOk ? '<span class="up">✓</span>' : '<span class="down">поздно</span>'}`}</td><td>${fmtTs(t.last_at)}<small>${t.last_by === 'support' ? 'мы' : 'пользователь'}</small></td><td class="num"><button data-on="click:ticketOpen-a0" data-a0="${t.id}" class="btn sm">Открыть чат</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Обращений нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async ai() {
    const r = await api('/cabinet/ai');
    $('extra').innerHTML = `<div class="cfg-sec"><h3>Провайдеры ИИ</h3><p class="hint">Ключи хранятся зашифрованными и наружу не отдаются — виден только хвост. Проверка живая у GPT и Gemini; у Алисы и ГигаЧата — OAuth, сработает при первом вызове.</p>
      <div class="files" style="margin-top:10px">${r.items.map((p) => `<div class="file" style="flex-direction:column;align-items:stretch;cursor:default"><div class="row"><b style="flex:1">${esc(p.label)}</b>${p.hasKey ? `<span class="pill" style="${p.check_ok === 1 ? 'color:var(--ok);border-color:rgba(168,236,198,.6)' : p.check_ok === 0 ? 'color:var(--warn)' : ''}">${p.check_ok === 1 ? 'проверен' : p.check_ok === 0 ? 'ошибка' : 'не проверен'}</span>` : '<span class="pill" style="opacity:.6">не подключён</span>'}</div>
        <small>${esc(p.hint)}${p.hasKey ? ` · ключ ${esc(p.keyTail)} · модель ${esc(p.model)}` : ''}${p.check_note ? ` · ${esc(p.check_note)}` : ''}</small>
        <div style="display:grid;gap:6px;margin-top:8px"><input id="ai-key-${p.provider}" placeholder="${p.hasKey ? 'новый ключ (пусто — оставить прежний)' : 'API-ключ'}" autocomplete="off"><div class="row"><input id="ai-model-${p.provider}" value="${esc(p.model)}" placeholder="модель"><input id="ai-extra-${p.provider}" value="${esc(p.extra)}" placeholder="доп. (folder id / scope)"></div>
        <div class="row"><button data-on="click:aiSave-a0" data-a0="${p.provider}" class="btn gold sm fixed">Сохранить</button>${p.hasKey ? `<button data-on="click:aiCheck-a0" data-a0="${p.provider}" class="btn sm fixed">Проверить</button><button data-on="click:aiDel-a0" data-a0="${p.provider}" class="btn sm warn fixed">Убрать</button>` : ''}</div></div></div>`).join('')}</div></div>`;
  },
};
function campaignForm(id) {
  const c = (S.campaigns || []).find((x) => x.id === id) || {};
  openModal(`<div class="head"><div><span class="eyebrow">Кампания</span><h2 style="margin-top:6px">${id ? 'Изменить' : 'Новая кампания'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div style="display:grid;gap:10px;margin-top:12px">${field('Название', `<input id="cp-name" value="${esc(c.name || '')}" maxlength="80" placeholder="Телеграм · сентябрь">`)}
    <div class="row">${field('utm_source', `<input id="cp-source" value="${esc(c.source || '')}" placeholder="telegram">`)}${field('utm_medium', `<input id="cp-medium" value="${esc(c.medium || '')}" placeholder="post">`)}${field('utm_campaign', `<input id="cp-campaign" value="${esc(c.campaign || '')}" placeholder="sep-launch">`)}</div>
    <div class="row">${field('utm_content · размещение или автор', `<input id="cp-content" value="${esc(c.content || '')}" placeholder="story-1">`)}${field('utm_term', `<input id="cp-term" value="${esc(c.term || '')}">`)}</div>
    ${field('Рекламное обещание', `<input id="cp-promise" value="${esc(c.promise || '')}" maxlength="200" placeholder="Карта дня бесплатно">`)}
    ${field('Где размещено (канал, автор, ссылка на пост)', `<input id="cp-placement" value="${esc(c.placement || '')}" maxlength="120">`)}
    <div class="row">${field('Расходы, ₽', `<input id="cp-cost" type="number" inputmode="decimal" value="${c.cost || ''}">`)}${field('Старт', `<input id="cp-start" type="date" value="${c.start_day || ''}">`)}${field('Конец', `<input id="cp-end" type="date" value="${c.end_day || ''}">`)}</div>
    <p class="hint" id="cp-link" style="word-break:break-all"></p>
    <div class="row"><button data-on="click:campaignSave-a0" data-a0="${id}" class="btn gold fixed">Сохранить</button><span class="hint" id="cp-msg"></span></div></div>`);
  const upd = () => { $('cp-link').textContent = 'Ссылка: ' + utmLink({ source: $('cp-source').value.trim().toLowerCase(), medium: $('cp-medium').value.trim().toLowerCase(), campaign: $('cp-campaign').value.trim().toLowerCase(), content: $('cp-content').value.trim().toLowerCase(), term: $('cp-term').value.trim().toLowerCase() }); };
  ['source', 'medium', 'campaign', 'content', 'term'].forEach((k) => $('cp-' + k).addEventListener('input', upd)); upd();
}
async function campaignSave(id) {
  const g = (k) => $('cp-' + k).value.trim();
  const r = await api('/cabinet/campaigns', { method: 'POST', body: JSON.stringify({ id, name: g('name'), source: g('source'), medium: g('medium'), campaign: g('campaign'), content: g('content'), term: g('term'), promise: g('promise'), placement: g('placement'), cost: +g('cost'), start_day: g('start'), end_day: g('end') }) });
  if (!r.ok) { $('cp-msg').textContent = r.error === 'no_name' ? 'Нужно название.' : r.error === 'no_utm' ? 'Нужен хотя бы utm_source или utm_campaign.' : 'Не сохранилось.'; return; }
  toast('Сохранено'); closeModal(); EXTRAS.campaigns();
}
async function campaignDel(id) { if (!confirm('Удалить кампанию? Люди, пришедшие по её UTM, останутся в базе.')) return; await api('/cabinet/campaigns?id=' + id, { method: 'DELETE' }); toast('Удалено'); EXTRAS.campaigns(); }
function materialForm(id) {
  const r = S.materials, m = (r.items || []).find((x) => x.id === id) || {};
  openModal(`<div class="head"><div><span class="eyebrow">Материал</span><h2 style="margin-top:6px">${id ? 'Изменить' : 'Новый материал'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div style="display:grid;gap:10px;margin-top:12px"><div class="row">${field('Тип', `<select id="mt-kind">${Object.entries(r.kinds).map(([k, v]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('Раздел', `<select id="mt-section">${['Мой день', 'Обо мне', 'Свериться', 'Что вокруг', 'История'].map((x) => `<option ${m.section === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
    ${field('Заголовок (для заметок)', `<input id="mt-title" value="${esc(m.title || '')}" maxlength="120">`)}
    ${field('Текст', `<textarea id="mt-text" style="min-height:160px;font-family:inherit">${esc(m.text || '')}</textarea>`)}
    ${field('Картинка (ссылка из «Картинки и файлы»)', `<input id="mt-image" value="${esc(m.image || '')}" placeholder="/app/uploads/…">`)}
    <div class="row">${field('Дата показа (пусто — каждый день)', `<input id="mt-day" type="date" value="${m.show_day || ''}">`)}${field('Статус', `<select id="mt-status">${Object.entries(r.statuses).map(([k, v]) => `<option value="${k}" ${(m.status || 'draft') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}</div>
    <p class="hint">«Вопрос дня» и «Аффирмация» в статусе «Опубликован» подменяют текст в «Моём дне» у всех — в указанный день или каждый день, если дата пуста.</p>
    <div class="row"><button data-on="click:materialSave-a0" data-a0="${id}" class="btn gold fixed">Сохранить</button>${id ? `<button data-on="click:materialDel-a0" data-a0="${id}" class="btn sm warn fixed">Удалить</button>` : ''}<span class="hint" id="mt-msg"></span></div></div>`);
}
async function materialSave(id) {
  const r = await api('/cabinet/materials', { method: 'POST', body: JSON.stringify({ id, kind: $('mt-kind').value, section: $('mt-section').value, title: $('mt-title').value, text: $('mt-text').value, image: $('mt-image').value, show_day: $('mt-day').value, status: $('mt-status').value }) });
  if (!r.ok) { $('mt-msg').textContent = 'Нужен текст или заголовок.'; return; } toast('Сохранено'); closeModal(); EXTRAS.materials();
}
async function materialDel(id) { if (!confirm('Удалить материал?')) return; await api('/cabinet/materials?id=' + id, { method: 'DELETE' }); toast('Удалено'); closeModal(); EXTRAS.materials(); }
function mediaUpload() {
  const f = $('m-file').files[0], msg = $('m-msg'); if (!f) { msg.textContent = 'Выберите файл.'; return; }
  if (f.size > 5 * 1024 * 1024) { msg.textContent = 'До 5 МБ.'; return; }
  msg.textContent = 'Загружаем…';
  const rd = new FileReader(); rd.onload = async () => { try { const r = await api('/cabinet/media', { method: 'POST', body: JSON.stringify({ name: f.name, type: f.type, data: rd.result }) }); if (!r.ok) { msg.textContent = r.error === 'bad_type' ? 'Такой тип не принимаем.' : 'Не загрузилось.'; return; } toast('Загружено'); EXTRAS.media(); } catch (e) { msg.textContent = 'Не загрузилось: ' + (e.code || e.message); } }; rd.readAsDataURL(f);
}
async function backupNow() {
  const b = $('bk-run'), m = $('bk-msg'); b.disabled = true; m.textContent = 'Снимаем копию…';
  try { const r = await api('/cabinet/backups', { method: 'POST' }); toast(r.ok ? 'Копия снята' : 'Не получилось'); m.textContent = r.ok ? '' : (r.message || 'ошибка'); if (r.ok) EXTRAS.system(); }
  catch (e) { m.textContent = 'Не получилось: ' + (e.code || e.message); }
  finally { b.disabled = false; }
}
async function mediaArchive(id, on) { const r = await api('/cabinet/media/archive', { method: 'POST', body: JSON.stringify({ id, on }) }); toast(r.ok ? (on ? 'Сгружено в архив' : 'Возвращено') : 'Не получилось'); EXTRAS.media(); }
async function mediaDel(id) { if (!confirm('Удалить файл насовсем? Если он ещё может понадобиться — лучше «Сгрузить»: запись и скачивание останутся.')) return; await api('/cabinet/media?id=' + id, { method: 'DELETE' }); toast('Удалено'); EXTRAS.media(); }
function taskForm(id) {
  const r = S.tasks, t = (r.items || []).find((x) => x.id === id) || {};
  openModal(`<div class="head"><div><span class="eyebrow">Беклог</span><h2 style="margin-top:6px">${id ? 'Изменить задачу' : 'Новая задача'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div style="display:grid;gap:10px;margin-top:12px">${field('Что сделать', `<input id="tk-title" value="${esc(t.title || '')}" maxlength="140">`)}
    ${field('Подробности', `<textarea id="tk-text" style="min-height:120px;font-family:inherit">${esc(t.text || '')}</textarea>`)}
    <div class="row">${field('Кому', `<select id="tk-role">${Object.entries(r.roles).map(([k, v]) => `<option value="${k}" ${(t.role || 'content') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('Приоритет', `<select id="tk-priority"><option value="normal">обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>высокий</option></select>`)}${field('Срок', `<input id="tk-due" type="date" value="${t.due_day || ''}">`)}</div>
    ${field('Исполнитель (почта, необязательно)', `<input id="tk-assignee" value="${esc(t.assignee || '')}">`)}
    <div class="row"><button data-on="click:taskSave-a0" data-a0="${id}" class="btn gold fixed">Сохранить</button><span class="hint" id="tk-msg"></span></div></div>`);
}
async function taskSave(id) {
  const t = (S.tasks.items || []).find((x) => x.id === id) || {};
  const r = await api('/cabinet/tasks', { method: 'POST', body: JSON.stringify({ id, title: $('tk-title').value, text: $('tk-text').value, role: $('tk-role').value, priority: $('tk-priority').value, due_day: $('tk-due').value, assignee: $('tk-assignee').value, status: t.status || 'new' }) });
  if (!r.ok) { $('tk-msg').textContent = 'Нужно название задачи.'; return; } toast('Сохранено'); closeModal(); EXTRAS.backlog();
}
async function taskStatus(id, status) { await api('/cabinet/tasks', { method: 'POST', body: JSON.stringify({ id, status, onlyStatus: true }) }); toast('Статус обновлён'); EXTRAS.backlog(); }
async function taskDel(id) { if (!confirm('Удалить задачу?')) return; await api('/cabinet/tasks?id=' + id, { method: 'DELETE' }); EXTRAS.backlog(); }
async function ticketOpen(id) {
  openModal('<p class="empty">Открываем…</p>');
  const t = await api('/cabinet/ticket?id=' + id), st = S.data.statuses || {};
  openModal(`<div class="head"><div><span class="eyebrow">Обращение № ${t.id} · ${esc(t.topic)}</span><h2 style="margin-top:6px">${esc(t.subject)}</h2><p class="hint">${esc(t.user.name) || 'без имени'} · ${esc(t.user.email) || 'без почты'} · id ${t.user.id} · создано ${fmtTs(t.created_at)}${t.first_reply_at ? ' · первый ответ ' + fmtTs(t.first_reply_at) : ''}</p></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row" style="margin-top:10px"><select data-on="change:ticketSet-a0" data-a0="${t.id}" id="tc-status">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select><select data-on="change:ticketSet-a0" data-a0="${t.id}" id="tc-priority"><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>высокий</option></select></div>
    <div class="thread" id="tc-thread">${t.messages.map((m) => `<div class="m ${m.who}"><small>${m.who === 'support' ? esc(m.author) : 'пользователь'} · ${fmtTs(m.ts)}</small>${esc(m.text)}</div>`).join('')}</div>
    <div style="display:grid;gap:8px;margin-top:10px"><textarea id="tc-text" style="min-height:90px;font-family:inherit" placeholder="Ответ пользователю — он увидит его в приложении в разделе «Чат»"></textarea><div class="row"><button data-on="click:ticketReply-a0" data-a0="${t.id}" class="btn gold fixed">Отправить</button><button data-on="click:ticketReply-a0-resolved" data-a0="${t.id}" class="btn sm fixed">Отправить и закрыть</button></div></div>`);
  const th = $('tc-thread'); th.scrollTop = th.scrollHeight;
}
async function ticketReply(id, status) {
  const text = $('tc-text').value.trim(); if (!text) return;
  await api('/cabinet/ticket?id=' + id, { method: 'POST', body: JSON.stringify({ text, status: status || '' }) });
  toast(status ? 'Отправлено, обращение закрыто' : 'Отправлено'); await openPage('tickets'); if (!status) ticketOpen(id); else closeModal();
}
async function ticketSet(id) { await api('/cabinet/ticket?id=' + id, { method: 'POST', body: JSON.stringify({ status: $('tc-status').value, priority: $('tc-priority').value }) }); toast('Обновлено'); openPage('tickets'); }
async function aiSave(p) { const r = await api('/cabinet/ai', { method: 'POST', body: JSON.stringify({ provider: p, key: $('ai-key-' + p).value.trim(), model: $('ai-model-' + p).value.trim(), extra: $('ai-extra-' + p).value.trim() }) }); toast(r.ok ? 'Сохранено' : 'Не сохранилось'); EXTRAS.ai(); }
async function aiCheck(p) { toast('Проверяем…'); const r = await api('/cabinet/ai/check', { method: 'POST', body: JSON.stringify({ provider: p }) }); toast(r.ok ? 'Ключ работает' : 'Не прошло: ' + r.note); EXTRAS.ai(); }
async function aiDel(p) { if (!confirm('Убрать ключ провайдера?')) return; await api('/cabinet/ai?provider=' + p, { method: 'DELETE' }); EXTRAS.ai(); }
function renderOverview(r) {
  const w = r.week;
  let html = head(r) + toolbar(r, false);
  html += `<button data-on="click:openPage-activity" class="north"><div><span class="eyebrow">${esc(w.title)}</span><div class="val" style="margin-top:6px">${fmt(w.value)}</div></div><div style="max-width:520px"><p style="color:var(--text);font-weight:600">${esc(w.sub)}</p>${cmp({ delta: w.delta, prev: w.prev })}</div></button>`;
  html += `<div class="blocks">${r.blocks.map((b) => `<button data-on="click:openPage-a0" data-a0="${b.to}" class="block${b.main ? ' main' : ''}${b.alarm ? ' alarm' : ''}" type="button">
    <b>${esc(b.title)}</b>${b.state === 'nodata' ? '<span class="val na"><span class="state">нет данных</span></span>' : `<span class="val">${fmt(b.value)}<span class="unit">${esc(b.unit)}</span></span>`}${cmp(b)}${b.sub ? `<span class="sub">${esc(b.sub)}</span>` : ''}${spark(b.series)}<span class="go">${esc((S.me.reports[b.to] || [b.to])[0])} →</span></button>`).join('')}</div>`;
  html += `<div class="charts">${r.charts.map(vizCard).join('')}</div>`;
  html += `<div class="how"><b>Как читать.</b> Сначала ключевой показатель и сравнение с предыдущим сопоставимым периодом, потом диаграмма — тренд, доли или связь, потом таблица с числителем, знаменателем и окном. Проценты без основания не читаются. «0», «нет данных» и «не запущено» — разные состояния.</div>`;
  $('report').innerHTML = html;
}
function spark(series) {
  if (!series || series.length < 2) return '';
  const max = Math.max(1, ...series.map((s) => s.y)), w = 100, h = 32, step = w / (series.length - 1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${series.map((s, i) => `${(i * step).toFixed(1)},${(h - (s.y / max) * (h - 4) - 2).toFixed(1)}`).join(' ')}" fill="none" stroke="#e0c070" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

/* ── диаграммы: inline SVG, без библиотек ── */
function vizCard(c) {
  const body = { line: lineViz, bars: barsViz, hbars: hbarsViz, pie: pieViz, funnel: funnelViz, scatter: scatterViz, heat: heatViz }[c.type];
  return `<section class="viz"><h3>${esc(c.title)}</h3><div class="sub">${esc(c.subtitle)}</div>${body ? body(c.data) : ''}${c.insight ? `<div class="insight">${esc(c.insight)}</div>` : ''}</section>`;
}
function lineViz(d) {
  const marks = d && !Array.isArray(d) ? (d.marks || []) : [];
  if (d && !Array.isArray(d)) d = d.points || [];
  const pts = (d || []).filter((p) => p.y !== null && p.y !== undefined);
  if (pts.length < 2) return '<p class="empty">Мало точек для линии' + (pts.length === 1 ? `: ${esc(d[0].x)} — ${fmt(d[0].y)}` : '') + '.</p>';
  const W = 560, H = 190, L = 34, B = 26, T = 12, max = Math.max(1, ...pts.map((p) => p.y)), n = pts.length;
  const X = (i) => L + (i / (n - 1)) * (W - L - 8), Y = (v) => T + (1 - v / max) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = path + ` L${X(n - 1).toFixed(1)},${(H - B).toFixed(1)} L${L},${(H - B).toFixed(1)} Z`;
  const grid = [0, .5, 1].map((f) => `<line x1="${L}" x2="${W - 8}" y1="${Y(max * f).toFixed(1)}" y2="${Y(max * f).toFixed(1)}" stroke="rgba(255,255,255,.1)"/><text x="${L - 6}" y="${(Y(max * f) + 4).toFixed(1)}" text-anchor="end">${fmt(Math.round(max * f))}</text>`).join('');
  const lab = [0, Math.floor((n - 1) / 2), n - 1].map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(/^\d{4}-\d{2}-\d{2}$/.test(pts[i].x) ? fmtDay(pts[i].x) : pts[i].x)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${n > 40 ? 2 : 3.5}" fill="#f3dca0"><title>${esc(p.x)}: ${fmt(p.y)}</title></circle>`).join('');
  const mk = marks.map((m) => { const i = pts.findIndex((p) => p.x === m.x); if (i < 0) return ''; return `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#a9b8ff" stroke-width="1.5" stroke-dasharray="4 3"><title>${esc(m.label)} · ${esc(m.x)}</title></line><text x="${(X(i) + 4).toFixed(1)}" y="${T + 12}" style="fill:#a9b8ff">${esc(String(m.label).slice(0, 14))}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}">${grid}<path d="${area}" fill="rgba(224,192,112,.12)"/><path d="${path}" fill="none" stroke="#e0c070" stroke-width="2.2" stroke-linejoin="round"/>${mk}${dots}${lab}</svg>`;
}
function barsViz(rows) {
  rows = (rows || []).filter((r) => typeof r[1] === 'number');
  if (!rows.length) return '<p class="empty">Нет данных для выбранных условий.</p>';
  const W = 560, H = 200, B = 30, T = 18, max = Math.max(1, ...rows.map((r) => r[1])), n = rows.length, bw = Math.min(46, (W - 10) / n - 6);
  return `<svg viewBox="0 0 ${W} ${H}">${rows.map((r, i) => { const x = 5 + (i + .5) * ((W - 10) / n) - bw / 2, h = (r[1] / max) * (H - B - T), y = H - B - h; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="5" fill="url(#g)"><title>${esc(r[0])}: ${fmt(r[1])}</title></rect><text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${fmt(r[1])}</text>${n <= 12 || i % Math.ceil(n / 12) === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(String(r[0]).slice(0, 12))}</text>` : ''}`; }).join('')}<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f3dca0"/><stop offset="1" stop-color="#bf9440"/></linearGradient></defs></svg>`;
}
function hbarsViz(rows) {
  rows = (rows || []).filter((r) => typeof r[1] === 'number');
  if (!rows.length) return '<p class="empty">Нет данных для выбранных условий.</p>';
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="hbars">${rows.map((r) => `<div><div class="l"><span>${esc(r[0])}</span><b>${fmt(r[1])}</b></div><div class="t"><i style="width:${(r[1] / max * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>`;
}
function pieViz(rows) {
  rows = (rows || []).filter((r) => typeof r[1] === 'number' && r[1] > 0);
  const total = rows.reduce((s, r) => s + r[1], 0);
  if (!total) return '<p class="empty">Нет данных для выбранных условий.</p>';
  let a = -Math.PI / 2; const R = 60, r0 = 36, cx = 75, cy = 75;
  const arcs = rows.map((r, i) => { const ang = r[1] / total * Math.PI * 2, a2 = a + ang, big = ang > Math.PI ? 1 : 0;
    const p = (rad, t) => [cx + rad * Math.cos(t), cy + rad * Math.sin(t)].map((v) => v.toFixed(2)).join(',');
    const d = rows.length === 1 ? `M${cx + R},${cy} A${R},${R} 0 1 1 ${cx - R},${cy} A${R},${R} 0 1 1 ${cx + R},${cy} M${cx + r0},${cy} A${r0},${r0} 0 1 0 ${cx - r0},${cy} A${r0},${r0} 0 1 0 ${cx + r0},${cy}` : `M${p(R, a)} A${R},${R} 0 ${big} 1 ${p(R, a2)} L${p(r0, a2)} A${r0},${r0} 0 ${big} 0 ${p(r0, a)} Z`;
    a = a2; return `<path d="${d}" fill="${COLORS[i % COLORS.length]}" fill-rule="evenodd"><title>${esc(r[0])}: ${fmt(r[1])}</title></path>`; }).join('');
  return `<div class="pie"><svg viewBox="0 0 150 150" style="margin-top:0">${arcs}<text x="75" y="80" text-anchor="middle" style="font-size:18px;fill:#fff;font-weight:700">${fmt(total)}</text></svg><div class="legend">${rows.map((r, i) => `<div><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(r[0])}<b>${fmt(r[1])} · ${(r[1] / total * 100).toFixed(1).replace('.', ',')}%</b></div>`).join('')}</div></div>`;
}
function funnelViz(rows) {
  const nums = rows.filter((r) => typeof r[1] === 'number');
  const max = Math.max(1, ...nums.map((r) => r[1]));
  return `<div class="funnel">${rows.map((r, i) => typeof r[1] === 'number' ? `<div style="width:${Math.max(36, r[1] / max * 100).toFixed(1)}%"><b>${fmt(r[1])}</b>${esc(r[0])}${i && typeof rows[i - 1][1] === 'number' && rows[i - 1][1] ? ` <span style="color:var(--faint)">· ${(r[1] / rows[i - 1][1] * 100).toFixed(0)}% от предыдущего</span>` : ''}</div>` : `<div style="width:36%;opacity:.55"><b>${esc(r[1])}</b>${esc(r[0])}</div>`).join('')}</div>`;
}
function scatterViz(pts) {
  pts = pts || [];
  if (pts.length < 3) return `<p class="empty">Пока мало людей с 30 днями наблюдения${pts.length ? ` (${pts.length})` : ''}.</p>`;
  const W = 560, H = 210, L = 34, B = 28, T = 10, mx = Math.max(1, ...pts.map((p) => p[0])), my = Math.max(1, ...pts.map((p) => p[1]));
  const X = (v) => L + v / mx * (W - L - 10), Y = (v) => T + (1 - v / my) * (H - T - B);
  const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0), sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const k = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx), b = (sy - k * sx) / n;
  const line = `<line x1="${X(0)}" y1="${Y(Math.max(0, Math.min(my, b)))}" x2="${X(mx)}" y2="${Y(Math.max(0, Math.min(my, k * mx + b)))}" stroke="#a9b8ff" stroke-width="2" stroke-dasharray="6 4"/>`;
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="${L}" x2="${W - 10}" y1="${H - B}" y2="${H - B}" stroke="rgba(255,255,255,.15)"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.15)"/>${pts.map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="4" fill="rgba(224,192,112,.55)"><title>первая неделя: ${p[0]} дн. → за 30 дней: ${p[1]} дн.</title></circle>`).join('')}${line}<text x="${W - 10}" y="${H - 8}" text-anchor="end">дней с действиями в первую неделю →</text><text x="${L + 4}" y="${T + 10}">↑ дней за 30</text></svg>`;
}
function heatViz(d) {
  if (!d || !d.cells) return '';
  const max = Math.max(1, ...d.cells.flat());
  return `<div class="heat"><span class="lab"></span>${d.cols.map((c) => `<span class="lab" style="justify-content:center">${c % 3 === 0 ? c : ''}</span>`).join('')}${d.rows.map((r, i) => `<span class="lab">${r}</span>` + d.cells[i].map((v, h) => `<span style="--a:${(0.06 + v / max * 0.9).toFixed(2)}" title="${r}, ${h}:00 — ${v}"></span>`).join('')).join('')}</div>`;
}

/* ── таблицы ── */
function tableCard(t, kind) {
  const isNum = (v) => typeof v === 'number';
  const rows = t.rows || [];
  let body;
  if (kind === 'economy' && t.headers[t.headers.length - 1] === '') {
    body = rows.map((r) => `<tr>${r.slice(0, -1).map((c) => `<td class="${isNum(c) ? 'num' : ''}">${esc(fmt(c))}</td>`).join('')}<td class="num">${S.me.isAdmin ? `<button data-on="click:costDel-a0" data-a0="${Number(r[r.length - 1]) || 0}" class="btn sm warn">Убрать</button>` : ''}</td></tr>`).join('');
  } else body = rows.map((r) => `<tr>${r.map((c) => `<td class="${isNum(c) ? 'num' : ''}">${esc(fmt(c))}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl"><h3>${esc(t.title)}</h3><div class="scroll"><table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${t.headers.length}" class="empty">Нет данных для выбранных условий.</td></tr>`}</tbody></table></div>${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}</div>`;
}
function exportCsv() {
  const r = S.data; if (!r) return;
  const safe = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const lines = [];
  for (const k of r.kpis || []) lines.push([k.title, k.state === 'off' ? 'не запущено' : k.value ?? 'нет данных', k.unit, k.prev ?? ''].map(safe).join(';'));
  for (const t of r.tables || []) { lines.push(''); lines.push(safe(t.title)); lines.push(t.headers.map(safe).join(';')); for (const row of t.rows || []) lines.push(row.map(safe).join(';')); }
  if (r.userList) { lines.push(''); lines.push(['id', 'почта', 'имя', 'регистрация', 'последний визит', 'источник', 'платформа', 'активных дней', 'серия', 'стадия', 'функции', 'пуш'].map(safe).join(';')); for (const u of r.userList) lines.push([u.id, u.email, u.name, u.reg, u.last, u.source, u.platform, u.days, u.streak, u.stage, u.feats.join(', '), u.push ? 'да' : 'нет'].map(safe).join(';')); }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lunario-${r.key}-${r.period.from}-${r.period.to}.csv`; a.click();
}

/* ── сохранённые отчёты (в этом браузере) ── */
const savedKey = 'lun_cab_saved';
const savedList = () => { try { return JSON.parse(localStorage.getItem(savedKey) || '[]'); } catch { return []; } };
function saveReport() {
  const list = savedList(); list.unshift({ role: S.role, page: S.page, period: S.period, filters: { ...S.filters }, ts: new Date().toISOString(), title: (S.me.reports[S.page] || [S.page])[0] });
  try { localStorage.setItem(savedKey, JSON.stringify(list.slice(0, 50))); toast('Отчёт сохранён'); } catch { toast('Браузер не сохранил отчёт'); }
}
function renderSaved() {
  const list = savedList();
  $('report').innerHTML = `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 style="margin-top:6px">Сохранённые отчёты</h1><p style="margin-top:6px">Отчёты с фильтрами, сохранённые в этом браузере</p></div></div>` +
    (list.length ? `<div class="tbl"><div class="scroll"><table><thead><tr><th>Отчёт</th><th>Кабинет</th><th>Период</th><th>Фильтры</th><th>Когда</th><th></th></tr></thead><tbody>${list.map((s, i) => `<tr><td>${esc(s.title)}</td><td>${esc((ROLE_META[s.role] || [s.role])[0])}</td><td>${esc(/^\d+d$/.test(s.period) ? daysWord(parseInt(s.period)) : s.period)}</td><td>${esc(Object.values(s.filters).filter(Boolean).join(', ') || '—')}</td><td>${new Date(s.ts).toLocaleString('ru-RU')}</td><td class="num"><button data-on="click:openSaved-a0" data-a0="${i}" class="btn sm">Открыть</button> <button data-on="click:delSaved-a0" data-a0="${i}" class="btn sm warn">Убрать</button></td></tr>`).join('')}</tbody></table></div></div>` : '<p class="empty" style="margin-top:14px">Сохранённых отчётов пока нет. Откройте отчёт, выберите фильтры и нажмите «☆ Сохранить».</p>');
}
function openSaved(i) { const s = savedList()[i]; if (!s) return; S.period = s.period; S.filters = { ...s.filters }; if (S.me.menus[s.role] && (S.me.roles.includes(s.role))) { S.role = s.role; } openPage(s.page); }
function delSaved(i) { const l = savedList(); l.splice(i, 1); localStorage.setItem(savedKey, JSON.stringify(l)); renderSaved(); }

/* ── пользователи ── */
function usersTable(r) {
  const list = r.userList || [];
  return `<div class="tbl"><h3>Список · ${list.length}</h3><div class="scroll"><table><thead><tr><th>Пользователь</th><th>Регистрация</th><th>Последний визит</th><th>Активные дни / серия</th><th>Стадия</th><th>Источник · платформа</th><th>Функции</th><th>Пуш</th><th></th></tr></thead><tbody>${list.map((u) => `<tr><td>${esc(u.name) || '—'}<small>${esc(u.email)} · id ${u.id}${u.role ? ' · ' + u.role : ''}</small></td><td>${u.reg}</td><td>${u.last}</td><td class="num">${u.days} / ${u.streak}</td><td>${esc(u.stage)}</td><td>${esc(u.source)} · ${esc(u.platform)}</td><td>${u.feats.map((f) => `<span class="pill">${esc(f)}</span>`).join('') || '<span class="lock">нет</span>'}</td><td>${u.push ? 'вкл' : '—'}</td><td class="num"><button data-on="click:userCard-a0" data-a0="${u.id}" class="btn sm">Карточка</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Никого не нашли.</td></tr>'}</tbody></table></div><p class="note">Показаны первые 500 строк; CSV содержит весь список. Личные тексты и индивидуальное настроение недоступны.</p></div>`;
}
async function userCard(id) {
  openModal('<p class="empty">Загружаем…</p>');
  try {
    const c = await api('/cabinet/user?id=' + id);
    const row = (k, v) => `<tr><td style="color:var(--faint);width:44%">${k}</td><td>${v}</td></tr>`;
    openModal(`<div class="head"><div><span class="eyebrow">Карточка пользователя · id ${c.id}</span><h2 style="margin-top:6px">${esc(c.name) || '—'} <span style="color:var(--faint);font-weight:500">${esc(c.email)}</span></h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
      <table style="margin-top:12px"><tbody>${row('Регистрация · подтверждена', c.reg)}${row('Последняя авторизация', c.lastAuth)}${row('Последнее посещение', c.lastSeen)}${row('Последнее содержательное действие', c.lastAct)}${row('Активных дней · серия', `${c.days} · ${c.streak}`)}${row('Первая функция', esc(c.first))}${row('Источник · платформа · пояс', `${esc(c.source)} · ${esc(c.platform)} · ${esc(c.tz || '—')}`)}${row('Напоминание', c.push ? 'включено' : 'нет')}${row('Записей · дневник · желания · настроений', `${c.counts.entries} · ${c.counts.journal} · ${c.counts.wishes} · ${c.counts.moods}`)}${row('Обращения', esc(c.tickets))}${row('Расходы ИИ за месяц', esc(c.ai))}</tbody></table>
      <h3 style="margin-top:18px">События по типам · без личных текстов</h3><table><thead><tr><th>Событие</th><th>Раз</th><th>Последний день</th></tr></thead><tbody>${c.byType.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
      <p class="note">Три разные даты: авторизация (ввод кода), посещение (открытие) и содержательное действие. Тексты записей в кабинете не показываются.</p>`);
  } catch (e) { openModal(`<p class="msg err">Не получилось: ${esc(e.code || e.message)}</p>`); }
}

/* ── экономика: форма расхода и рост аудитории ── */
function economyExtras(r) {
  const per = (r.kpis.find((k) => k.title.startsWith('На 1 активного')) || {}).value;
  const growth = `<div class="viz" style="margin-top:14px"><h3>Рост аудитории</h3><div class="sub">линейная модель по стоимости обслуживания одного активного за месяц</div>
    <div class="row" style="margin-top:12px"><input data-on="input:g-out-textContent-value-toLocaleString-ru-RU-человек-a0" data-a0="${per ?? 'null'}" data-a1="${per || 0}" type="range" min="1000" max="10000" step="1000" value="1000" style="min-height:0;padding:0"><b id="g-out" class="fixed" style="min-width:220px">1 000 человек → ${per === null || per === undefined ? 'нет данных' : (1000 * per).toLocaleString('ru-RU') + ' ₽/мес'}</b></div>
    <p class="note">Тестовые аккаунты и разработка исключены. Без реальных тарифов — только текущее среднее.</p></div>`;
  if (!S.me.isAdmin || !r.costForm) return growth;
  return growth + `<div class="viz" style="margin-top:14px"><h3>Добавить расход · ${r.costForm.month}</h3>
    <div class="row" style="margin-top:12px"><select id="c-kind">${r.costForm.kinds.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select><input id="c-name" placeholder="например: сервер Timeweb"><input id="c-amount" type="number" inputmode="decimal" placeholder="сумма, ₽" style="max-width:160px"><button data-on="click:costAdd-a0" data-a0="${r.costForm.month}" class="btn gold fixed">Добавить</button></div>
    <p class="note">Расходы, которые не приходят автоматически, вносятся вручную с периодом и категорией. «Бюджет месяца» — отдельная строка для сравнения с прогнозом.</p></div>`;
}
async function costAdd(month) {
  const r = await api('/cabinet/costs', { method: 'POST', body: JSON.stringify({ month, name: $('c-name').value.trim(), amount: +$('c-amount').value, kind: $('c-kind').value }) });
  if (!r.ok) { toast('Проверьте название и сумму'); return; }
  toast('Добавлено'); openPage('economy');
}
async function costDel(id) { if (!confirm('Убрать строку расходов?')) return; await api('/cabinet/costs?id=' + id, { method: 'DELETE' }); toast('Убрано'); openPage('economy'); }

/* ── контент: файлы и правка ── */
function contentFiles(r) {
  const files = r.files || [];
  return `<div class="notice">Тексты приложения — обычные файлы: одна строка — одна запись, поля через «|». Строки с решёткой # — заметки, приложение их не читает. Сохранение публикует сразу: статусов «черновик / на проверке / запланирован» пока нет.</div>
    <div class="files">${files.map((f) => `<button data-on="click:editFile-a0" data-a0="${esc(f.name)}" class="file"><span>${esc(f.name)}<br><small>${f.lines} записей · изменён ${f.mtime}</small></span><span class="btn sm">Править</span></button>`).join('')}</div>`;
}
async function editFile(name) {
  openModal('<p class="empty">Открываем…</p>');
  try {
    const f = await api('/cabinet/content?file=' + encodeURIComponent(name));
    openModal(`<div class="head"><div><span class="eyebrow">Материал</span><h2 style="margin-top:6px">${esc(name)}</h2></div><div class="row"><button data-on="click:saveFile-a0" data-a0="${esc(name)}" class="btn gold fixed">Сохранить и опубликовать</button><button data-on="click:closeModal" class="btn sm fixed">Закрыть</button></div></div>
      <textarea id="f-text" style="margin-top:12px" spellcheck="true">${esc(f.text)}</textarea><p class="note" id="f-msg">Формат описан в «ПРОЧТИ-МЕНЯ.txt». После сохранения приложение перечитает файл само.</p>`);
  } catch (e) { openModal(`<p class="msg err">Не получилось открыть: ${esc(e.code || e.message)}</p>`); }
}
async function saveFile(name) {
  const msg = $('f-msg');
  try { await api('/cabinet/content?file=' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify({ text: $('f-text').value }) }); toast('Сохранено — уже в приложении'); closeModal(); openPage('content'); }
  catch (e) { msg.className = 'msg err'; msg.textContent = 'Не сохранилось: ' + (e.code || e.message); }
}

/* ── конструктор кабинетов (админ): состав дашбордов, названия, периоды, блоки сводки ── */
const BLOCK_NAMES = { new_users: 'Новые с подтверждённой почтой', activation: 'Активация за 24 часа', active: 'Активные за день, неделю и месяц', repeat: 'Повторное использование', retention: 'Возвраты D1, D7 и 4-я неделя', features: 'Использование функций', costs: 'Расходы за месяц', problems: 'Требуют внимания' };
let CFG = null;
async function cfgOpen(role) {
  const c = await api('/cabinet/config');
  CFG = { menus: JSON.parse(JSON.stringify(c.menus)), periods: [...c.periods], blocks: [...c.blocks], titles: JSON.parse(JSON.stringify(c.titles || {})), defaults: c.defaults, custom: c.custom, updated: c.updated, role: role || S.role || 'admin' };
  cfgRender();
}
function cfgRender() {
  const c = CFG, r = c.role, menu = c.menus[r], all = c.defaults.reports;
  const name = (k) => (c.titles[k] && c.titles[k].title) || all[k][0];
  const list = menu.map((k, i) => `<div class="cfg-item"><b>${esc(name(k))}</b>
      <button data-on="click:cfgMove-a0-1" data-a0="${k}" class="btn sm" ${i === 0 ? 'disabled' : ''}>↑</button><button data-on="click:cfgMove-a0-1-2" data-a0="${k}" class="btn sm" ${i === menu.length - 1 ? 'disabled' : ''}>↓</button><button data-on="click:cfgRemove-a0" data-a0="${k}" class="btn sm warn">✕</button>
      <details><summary>✎ название и вопрос</summary><input data-on="input:cfgTitle-a0-title-value" data-a0="${k}" value="${esc(name(k))}" maxlength="80"><input data-on="input:cfgTitle-a0-question-value" data-a0="${k}" value="${esc((c.titles[k] && c.titles[k].question) || all[k][1])}" maxlength="160"></details></div>`).join('');
  const rest = Object.keys(all).filter((k) => !menu.includes(k));
  const add = rest.length ? `<div class="row" style="margin-top:10px"><select id="cfg-add">${rest.map((k) => `<option value="${k}">${esc(name(k))} — ${esc(all[k][1])}</option>`).join('')}</select><button data-on="click:cfgAdd" class="btn sm fixed">+ Добавить дашборд</button></div>` : '<p class="hint">Все дашборды уже в этом кабинете.</p>';
  const periods = `<div class="chips" style="margin-top:8px">${c.periods.map((d) => `<span class="chip on">${daysWord(d)} <button data-on="click:cfgPeriod-a0-false" data-a0="${d}" class="btn sm warn" style="min-height:22px;padding:0 6px;font-size:12px;border:0;background:none">✕</button></span>`).join('')}</div>
    <div class="row" style="margin-top:8px"><input id="cfg-days" type="number" min="1" max="365" placeholder="дней, например 60" style="max-width:220px"><button data-on="click:cfgPeriod-cfg-days-value-true" class="btn sm fixed">+ Добавить период</button></div>
    <p class="hint">Набор кнопок периода одинаков во всех кабинетах. Сравнение всегда с предыдущим таким же отрезком.</p>`;
  const blocks = r === 'admin' ? `<div class="cfg-sec"><h3>Блоки единого дашборда</h3><p class="hint">Порядок — как в списке. Снятый блок исчезает со сводки, отчёт за ним остаётся в меню.</p><div class="chips" style="margin-top:8px">${c.defaults.blocks.map((k) => `<label class="chip${c.blocks.includes(k) ? ' on' : ''}"><input data-on="change:cfgBlock-a0-checked" data-a0="${k}" type="checkbox" ${c.blocks.includes(k) ? 'checked' : ''}> ${esc(BLOCK_NAMES[k] || k)}</label>`).join('')}</div></div>` : '';
  openModal(`<div class="head"><div><span class="eyebrow">Конструктор кабинетов</span><h2 style="margin-top:6px">Что видит роль</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row" style="margin-top:12px"><select data-on="change:CFG-role-value-cfgRender">${Object.entries(ROLE_META).filter(([k]) => k !== 'user').map(([k, [nm]]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${nm}</option>`).join('')}</select><span class="hint fixed">${c.custom ? `изменено ${esc((c.updated.updated_by || '').split('@')[0])} · ${(c.updated.updated_at || '').slice(0, 10)}` : 'настройки по умолчанию'}</span></div>
    <div class="cfg-sec"><h3>Дашборды в кабинете «${esc(ROLE_META[r][0])}»</h3><p class="hint">Порядок в списке — порядок в меню. Убранный дашборд для этой роли закрывается и на сервере.</p><div class="cfg-list">${list}</div>${add}</div>
    <div class="cfg-sec"><h3>Периоды</h3>${periods}</div>${blocks}
    <div class="row" style="margin-top:20px"><button data-on="click:cfgSave" class="btn gold fixed">Сохранить для всех</button><button data-on="click:cfgReset" class="btn sm fixed">Сбросить к умолчаниям</button><span class="hint" id="cfg-msg"></span></div>`);
}
function cfgMove(k, d) { const m = CFG.menus[CFG.role], i = m.indexOf(k), j = i + d; if (j < 0 || j >= m.length) return; [m[i], m[j]] = [m[j], m[i]]; cfgRender(); }
function cfgRemove(k) { const m = CFG.menus[CFG.role]; if (m.length <= 1) { toast('В кабинете должен остаться хотя бы один дашборд'); return; } CFG.menus[CFG.role] = m.filter((x) => x !== k); cfgRender(); }
function cfgAdd() { const k = $('cfg-add').value; if (k && !CFG.menus[CFG.role].includes(k)) CFG.menus[CFG.role].push(k); cfgRender(); }
function cfgTitle(k, f, v) { CFG.titles[k] = CFG.titles[k] || { title: CFG.defaults.reports[k][0], question: CFG.defaults.reports[k][1] }; CFG.titles[k][f] = v; }
function cfgPeriod(d, add) { if (add) { if (!(d >= 1 && d <= 365)) { toast('От 1 до 365 дней'); return; } if (!CFG.periods.includes(d)) CFG.periods.push(d); CFG.periods.sort((a, b) => a - b); } else { if (CFG.periods.length <= 1) { toast('Нужен хотя бы один период'); return; } CFG.periods = CFG.periods.filter((x) => x !== d); } cfgRender(); }
function cfgBlock(k, on) { CFG.blocks = CFG.defaults.blocks.filter((b) => (b === k ? on : CFG.blocks.includes(b))); }
async function cfgSave() {
  const msg = $('cfg-msg');
  try {
    const r = await api('/cabinet/config', { method: 'POST', body: JSON.stringify({ menus: CFG.menus, periods: CFG.periods, blocks: CFG.blocks, titles: CFG.titles }) });
    if (!r.ok) { msg.textContent = r.error === 'empty_menu' ? 'В каждом кабинете нужен хотя бы один дашборд.' : 'Не сохранилось: ' + r.error; return; }
    toast('Сохранено для всех кабинетов'); closeModal(); await cfgApply();
  } catch (e) { msg.textContent = 'Не сохранилось: ' + (e.code || e.message); }
}
async function cfgReset() {
  if (!confirm('Вернуть состав дашбордов, периоды и названия к умолчаниям для всех кабинетов?')) return;
  await api('/cabinet/config', { method: 'DELETE' }); toast('Настройки по умолчанию'); closeModal(); await cfgApply();
}
async function cfgApply() {
  S.me = await api('/cabinet/me');
  if (!periodKeys().includes(S.period)) S.period = periodKeys().includes('30d') ? '30d' : periodKeys()[0];
  if ($('v-cab').classList.contains('on')) { const menu = S.me.menus[S.role] || []; renderMenu(); openPage(menu.includes(S.page) ? S.page : menu[0]); }
}

/* ── доступы ── */
async function renderAccess() {
  const box = $('report');
  if (!S.me.isAdmin) { box.innerHTML += '<p class="msg err">Таблица доступов видна только админам.</p>'; return; }
  const r = await api('/cabinet/staff'); S.staff = r.items;
  box.innerHTML = `<div class="head"><div><span class="eyebrow">Админ · рабочий кабинет</span><h1 style="margin-top:6px">Управление доступами</h1></div><button data-on="click:staffForm" class="btn gold sm">+ Добавить участника</button></div>
    <div class="notice">Два администратора имеют одинаковые права. Их нельзя удалить или понизить. Любому другому участнику можно назначить несколько ролей — роль «Пользователь» есть у каждого.</div>
    <div class="tbl"><div class="scroll"><table class="staff-tbl"><thead><tr><th>ФИО</th><th>Почта</th><th>Роли</th><th></th></tr></thead><tbody>${staffRows(r.items)}</tbody></table></div></div>`;
}
async function refreshStaff() { if ($('v-home').classList.contains('on')) renderTeam(); else if (S.page === 'access') renderAccess(); }
async function staffSave() {
  const roles = [...$('st-roles').querySelectorAll('input:checked')].map((i) => i.value), msg = $('st-msg');
  try {
    const r = await api('/cabinet/staff', { method: 'POST', body: JSON.stringify({ name: $('st-name').value.trim(), email: $('st-email').value.trim(), roles }) });
    if (!r.ok) { msg.textContent = r.error === 'admin_locked' ? 'Права защищённого администратора изменить нельзя.' : 'Проверьте почту.'; return; }
    toast('Сохранено'); closeModal(); refreshStaff();
  } catch (e) { msg.textContent = 'Не получилось сохранить.'; }
}
async function staffDel(email) {
  if (!confirm(`Убрать доступ у ${email}?`)) return;
  const r = await api('/cabinet/staff?email=' + encodeURIComponent(email), { method: 'DELETE' });
  if (!r.ok) toast('Права защищённого администратора изменить нельзя'); else { toast('Доступ убран'); closeModal(); refreshStaff(); }
}

/* ── старт ── */
async function boot() {
  const me = await api('/cabinet/me').catch(() => null);
  if (!me) { show('login'); renderLogin('email'); return; }
  S.me = me;
  if (!me.roles.length) {
    show('login');
    $('who').innerHTML = me.email ? `<span>${esc(me.email)}</span><button data-on="click:logout" class="btn sm">Выйти</button>` : '';
    $('l-box').innerHTML = me.email
      ? `<p style="font-size:15px;color:#e8e2f5">У почты <b>${esc(me.email)}</b> нет доступа к кабинетам.</p><p class="hint">Доступ выдаёт админ. Приложение открыто как обычно.</p><a class="btn gold" style="width:100%;margin-top:14px" href="/app/?app=1">В приложение</a>`
      : '';
    if (!me.email) renderLogin('email');
    return;
  }
  renderRoles();
  if (!periodKeys().includes(S.period)) S.period = periodKeys().includes('30d') ? '30d' : periodKeys()[0];
  const [role, page] = location.hash.replace('#', '').split('/');
  if (role && me.roles.includes(role) && me.menus[role]) { S.role = role; show('cab'); renderMenu(); openPage(page && me.menus[role].includes(page) ? page : me.menus[role][0]); }
  else show('home');
}
boot();
