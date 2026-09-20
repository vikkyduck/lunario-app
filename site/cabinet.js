const ICON = '/app/assets/brand/icons/';
const ROLE_META = {
  admin:     ['Админ', 'person', 'сводка, система, доступы'],
  marketing: ['Маркетолог', 'users', 'источники и аудитория'],
  product:   ['Продуктолог', 'spark', 'поведение и экономика'],
  content:   ['Контент', 'pen', 'материалы и качество'],
  support:   ['Поддержка', 'chat', 'обращения и помощь'],
  user:      ['Пользователь', 'moon', 'открыть приложение'],
};
const S = { me: null, role: null, page: null, period: '30d', filters: {}, data: null };
const fmt = (n) => (n === null || n === undefined ? '—' : typeof n === 'number' ? n.toLocaleString('ru-RU') : String(n));
const daysWord = (n) => n + ' ' + plural(n, 'день', 'дня', 'дней');
const periodKeys = () => (S.me && S.me.periods && S.me.periods.length ? S.me.periods : [7, 30, 90]).map((d) => d + 'd');
function show(v) { document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v)); window.scrollTo(0, 0); }
function openModal(html) { $('modal-body').innerHTML = html; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on'); }
const COLORS = ['#e0c070', '#a9b8ff', '#c9a4e8', '#8fd9b6', '#f0a3a3', '#f3dca0', '#7fb2e8', '#d4a373', '#b5b5b5'];

/* ── вход ── */
let loginEmail = '';
function renderLogin(step) {
  const box = $('l-box');
  if (step === 'code') {
    box.innerHTML = `<p class="lead">Код отправлен на <b>${esc(loginEmail)}</b></p>
      <input id="l-code" inputmode="numeric" maxlength="6" placeholder="000000" class="mt-12 code-input">
      <button data-on="click:loginVerify" class="btn gold w-full mt-12">Войти</button>
      <button data-on="click:renderLogin-email" class="btn sm mt-8">Изменить адрес</button><p class="msg" id="l-msg"></p>`;
    setTimeout(() => $('l-code').focus(), 60); return;
  }
  box.innerHTML = `<label class="eyebrow mb-8">Почта</label><input id="l-email" type="email" placeholder="you@example.ru" value="${esc(loginEmail)}">
    <button data-on="click:loginRequest" class="btn gold w-full mt-12">Прислать код</button><p class="msg" id="l-msg"></p>`;
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
  catch (e) { msg.classList.add('err'); msg.textContent = e.code === 'wrong_code' ? 'Код не подошел.' : e.code === 'expired' ? 'Код истек — запросите новый.' : 'Не получилось войти.'; }
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
const staffRows = (items) => items.map((s) => `<tr><td>${esc(s.name) || '<span class="lock">—</span>'}</td><td>${esc(s.email)}</td><td>${s.roles.filter((x) => x !== 'user').map((x) => `<span class="pill">${ROLE_META[x] ? ROLE_META[x][0] : x}</span>`).join('')}</td><td class="right">${s.locked ? '<span class="lock">защищен</span>' : `<button data-on="click:staffForm-a0" data-a0="${esc(s.email)}" class="btn sm">Изменить</button> <button data-on="click:staffDel-a0" data-a0="${esc(s.email)}" class="btn sm warn">Удалить</button>`}</td></tr>`).join('');
async function renderTeam() {
  const box = $('team');
  if (!S.me.isAdmin) {
    box.innerHTML = `<div class="notice">Откройте доступный кабинет. В роли «Пользователь» — приложение. Таблица доступов видна администраторам.</div>
      <div class="viz mt-14"><h3>Начните с рабочего кабинета</h3><div class="chips mt-10">${S.me.roles.filter((r) => r !== 'user').map((r) => `<span class="chip on">${ROLE_META[r][0]}</span>`).join('')}</div></div>`;
    return;
  }
  box.innerHTML = '<p class="empty">Загружаем доступы…</p>';
  const r = await api('/cabinet/staff'); S.staff = r.items;
  box.innerHTML = `<div class="row row-end"><button data-on="click:staffForm" class="btn gold sm fixed">+ Добавить участника</button></div>
    <div class="tbl mt-10"><div class="scroll"><table class="staff-tbl"><thead><tr><th>ФИО</th><th>Почта</th><th>Роли</th><th></th></tr></thead><tbody>${staffRows(r.items)}</tbody></table></div></div>`;
}
function staffForm(email) {
  const s = (S.staff || []).find((x) => x.email === email);
  if (s && s.locked) { toast('Права защищенного администратора изменить нельзя'); return; }
  openModal(`<div class="head"><div><span class="eyebrow">Доступы</span><h2 class="mt-6">${s ? 'Изменить доступы' : 'Добавить участника'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row mt-14"><input id="st-name" placeholder="ФИО" maxlength="80" value="${esc(s ? s.name : '')}"><input id="st-email" type="email" placeholder="почта" maxlength="120" value="${esc(s ? s.email : '')}" ${s ? 'readonly' : ''}></div>
    <div class="chips mt-12" id="st-roles">${['marketing', 'product', 'content', 'support'].map((k) => { const on = s && s.roles.includes(k); return `<label class="chip${on ? ' on' : ''}"><input data-on="change:this-parentNode-classList-toggle-on-checked" type="checkbox" value="${k}" ${on ? 'checked' : ''}> ${ROLE_META[k][0]}</label>`; }).join('')}</div>
    <p class="hint">Роль «Пользователь» доступна каждому. Назначить дополнительного администратора нельзя — их двое и они заданы почтой.</p>
    <div class="row mt-14"><button data-on="click:staffSave" class="btn gold fixed">Сохранить доступы</button>${s ? `<button data-on="click:staffDel-a0" data-a0="${esc(s.email)}" class="btn sm warn fixed">Удалить из команды</button>` : ''}<span class="hint" id="st-msg"></span></div>`);
  setTimeout(() => $(s ? 'st-name' : 'st-email').focus(), 60);
}
function openRole(k) { S.role = k; const menu = S.me.menus[k] || []; S.page = null; show('cab'); renderMenu(); openPage(menu[0]); history.replaceState(null, '', '#' + k); }
function renderMenu() {
  const menu = S.me.menus[S.role] || [];
  $('menu').innerHTML = `<a data-on="click:showHome-return-false" class="back" href="#">← Роли</a>` + menu.map((p) => `<a data-on="click:openPage-a0-return-false" data-a0="${p}" href="#${S.role}/${p}" class="${p === S.page ? 'on' : ''}">${esc((S.me.reports[p] || [p])[0])}</a>`).join('')
    + (S.me.isAdmin ? `<a data-on="click:cfgOpen-return-false" href="#" class="cfg">⚙ Настроить кабинет</a>` : '');
}
function showHome() { show('home'); history.replaceState(null, '', '#'); }

/* ── страница отчета ── */
async function openPage(p) {
  S.page = p; renderMenu(); history.replaceState(null, '', `#${S.role}/${p}`);
  const box = $('report');
  const meta = S.me.reports[p] || [p, ''];
  box.innerHTML = `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 class="mt-6">${esc(meta[0])}</h1><p class="mt-6">${esc(meta[1])}</p></div></div><p class="empty">Считаем…</p>`;
  window.scrollTo(0, 0);
  try {
    if (p === 'saved') return renderSaved();
    if (p === 'access') return renderAccess();
    if (p === 'content') return renderContent();
    if (p === 'check') return renderCheck();
    if (p === 'materials' || p === 'media') { CT.tab = p; return renderContent(); }   /* прежние разделы — вкладки одной страницы */
    const qs = new URLSearchParams({ period: S.period, ...S.filters });
    const r = p === 'overview' ? await api('/cabinet/dashboard?' + qs) : await api(`/cabinet/report?kind=${p}&` + qs);
    S.data = r;
    if (p === 'overview') return renderOverview(r);
    renderReport(r);
  } catch (e) { box.innerHTML += `<p class="msg err">Не получилось загрузить: ${esc(e.code || e.message)}</p>`; }
}
const periodLabel = (P) => `${fmtDayShort(P.from)} — ${fmtDayShort(P.to)} · сравнение с ${fmtDayShort(P.prevFrom)} — ${fmtDayShort(P.prevTo)}`;
function toolbar(r, withSave = true) {
  const per = periodKeys().map((k) => `<button data-on="click:setPeriod-a0" data-a0="${k}" data-p="${k}" class="${S.period === k ? 'on' : ''}">${daysWord(parseInt(k))}</button>`).join('');
  const filters = (r.filters || []).map((f) => `<label>${esc(f.label)}<select data-on="change:setFilter-a0-value" data-a0="${f.key}"><option value="">Все</option>${f.options.map(([v, t]) => `<option value="${esc(v)}" ${f.value === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`).join('');
  const search = r.key === 'users' ? `<label>Поиск<input data-on="keydown:if-event-key-Enter-setFilter-q-value" id="u-q" placeholder="имя, почта или id" value="${esc(S.filters.q || '')}"></label>` : '';
  return `<div class="tools"><div class="periods">${per}</div><div class="filters">${filters}${search}</div>${withSave ? `<span class="grow"></span><button data-on="click:saveReport" class="btn sm">☆ Сохранить</button><button data-on="click:exportCsv" class="btn sm">↓ CSV</button>` : ''}</div>
    <p class="hint">${periodLabel(r.period)}${Object.keys(S.filters).filter((k) => S.filters[k]).length ? ' · фильтры: ' + Object.entries(S.filters).filter(([, v]) => v).map(([k, v]) => v).join(', ') : ''}</p>`;
}
function setPeriod(k) { S.period = k; openPage(S.page); }
function setFilter(k, v) { S.filters[k] = v; openPage(S.page); }
function head(r) { return `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 class="mt-6">${esc(r.title)}</h1><p class="mt-6">${esc(r.question)}</p></div></div>`; }

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
  for (const t of r.tables || []) html += tableCard(t, r.key);
  html += `<div id="extra"></div>`;
  if (r.how) html += `<div class="how"><b>Как считается.</b> ${esc(r.how)}</div>`;
  $('report').innerHTML = html;
  const ex = EXTRAS[r.key]; if (ex) ex(r).catch((e) => { $('extra').innerHTML = `<p class="msg err">Не загрузилось: ${esc(e.code || e.message)}</p>`; });
}
const fmtTs = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const field = (label, inner) => `<label class="field">${label}${inner}</label>`;
const utmLink = (c) => { const u = new URL('https://lunario.online/app/'); for (const k of ['source', 'medium', 'campaign', 'content', 'term']) if (c[k]) u.searchParams.set('utm_' + k, c[k]); return u.toString(); };
const copy = (t) => navigator.clipboard.writeText(t).then(() => toast('Ссылка скопирована')).catch(() => prompt('Скопируйте ссылку', t));
const EXTRAS = {
  /* резервные копии — на странице «Здоровье системы»: статус, снять сейчас, скачать */
  async system() {
    const r = await api('/cabinet/backups');
    const ageH = (t) => (t ? (Date.now() - Date.parse(t)) / 36e5 : null);
    const fresh = (t) => t !== null && ageH(t) !== null && ageH(t) < 26;
    const when = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'еще не было');
    const mbs = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : (b / 1048576).toFixed(1).replace('.', ',') + ' МБ');
    const kp = (title, t, sub) => ({ title, value: t ? when(t) : null, unit: '', sub: sub || (t ? (fresh(t) ? 'свежая' : 'старше суток — проверьте cron') : ''), state: t ? 'ok' : 'nodata' });
    const rows = r.items.map((f) => `<tr><td>${f.kind === 'db' ? 'База и полочки' : 'Тексты и картинки'}</td><td>${when(f.ts)}</td><td>${mbs(f.size)}</td><td>${r.admin ? `<a class="btn sm" href="/app/api/cabinet/backups/download?name=${encodeURIComponent(f.name)}">Скачать</a>` : ''}</td></tr>`).join('');
    $('extra').innerHTML = `<h3 class="mt-22">Резервные копии</h3>
      <div class="kpis mt-10">${kpiCard(kp('База приложения', r.last))}${kpiCard(kp('Тексты и картинки', r.lastContent))}${kpiCard({ title: 'Ключ шифрования', value: r.keys ? 'в копии' : null, unit: '', sub: r.keys ? 'без него база не читается' : 'нет — снимите копию', state: r.keys ? 'ok' : 'nodata' })}</div>
      <div class="notice">Копии снимаются ${esc(r.schedule)}: база (люди, записи, полочки), ключ шифрования, ключи пушей и папка контента. Хранятся ${r.keep} последних каждого вида в ${esc(r.dir)} на сервере. Личные тексты внутри зашифрованы; скачать может только администратор — и это попадает в журнал.</div>
      ${r.admin ? `<div class="row mt-12 gap-10"><button data-on="click:backupNow" class="btn gold sm fixed" id="bk-run">Снять копию сейчас</button><span class="hint" id="bk-msg"></span></div>` : ''}
      <div class="tbl mt-10"><div class="scroll"><table><thead><tr><th>Что</th><th>Когда</th><th>Размер</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Копий пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async campaigns() {
    const r = await api('/cabinet/campaigns'); S.campaigns = r.items;
    $('extra').innerHTML = `<div class="row row-end mt-14"><button data-on="click:campaignForm-0" class="btn gold sm fixed">+ Новая кампания</button></div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Кампания</th><th>UTM</th><th>Обещание · размещение</th><th>Расходы</th><th>Даты</th><th>Ссылка</th><th></th></tr></thead><tbody>${r.items.map((c) => `<tr><td><b>${esc(c.name)}</b><small>${esc((c.created_by || '').split('@')[0])}</small></td><td>${esc([c.source, c.medium, c.campaign, c.content].filter(Boolean).join(' / '))}</td><td>${esc(c.promise) || '—'}<small>${esc(c.placement)}</small></td><td class="num">${fmt(Math.round(c.cost))} ₽</td><td>${c.start_day || '—'}${c.end_day ? ' — ' + c.end_day : ''}</td><td><button data-on="click:copy-link" class="btn sm" data-link="${esc(utmLink(c))}">Скопировать</button></td><td class="num"><button data-on="click:campaignForm-a0" data-a0="${c.id}" class="btn sm">Изменить</button> <button data-on="click:campaignDel-a0" data-a0="${c.id}" class="btn sm warn">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Кампаний пока нет. Заведите первую — и получите ссылку с UTM.</td></tr>'}</tbody></table></div>
      <p class="note">Ссылка ведет в приложение; лендинг тоже пробрасывает UTM в приложение, так что можно вести и на lunario.online. Расходы и обещание нужны, чтобы в «Привлечении» посчиталась цена регистрации и удержанного.</p></div>`;
  },
  async materials() {
    const r = await api('/cabinet/materials'); S.materials = r; const st = (k) => `<span class="pill${k === 'published' ? ' ok' : k === 'draft' ? ' dim-70' : ''}">${esc(r.statuses[k] || k)}</span>`;
    $('extra').innerHTML = `<div class="row row-end mt-14"><button data-on="click:materialForm-0" class="btn gold sm fixed">+ Новый материал</button></div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Материал</th><th>Тип · раздел</th><th>Дата показа</th><th>Статус</th><th>Изменен</th><th></th></tr></thead><tbody>${r.items.map((m) => `<tr><td><b>${esc(m.title || m.text.slice(0, 60) || (m.kind === 'image' ? 'Картинка · ' + (((r.features || []).find(([k]) => k === m.section) || [])[1] || m.section) : ''))}</b>${m.image ? `<small><a href="${esc(m.image)}" target="_blank">картинка</a></small>` : ''}</td><td>${esc(r.kinds[m.kind] || m.kind)}<small>${esc(m.section)}</small></td><td>${m.show_day || 'каждый день'}</td><td>${st(m.status)}</td><td>${fmtTs(m.updated_at)}<small>${esc((m.created_by || '').split('@')[0])}</small></td><td class="num"><button data-on="click:materialForm-a0" data-a0="${m.id}" class="btn sm">Открыть</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Материалов пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async media() {
    const r = await api('/cabinet/media'); S.mediaItems = r.items; const mb = (b) => (b / 1048576).toFixed(1) + ' МБ';
    const card = (m) => `<div class="file col no-pointer${m.archived ? ' dim-70' : ''}">${!m.archived && m.type.startsWith('image/') && m.type !== 'image/svg+xml' ? `<img src="/app/uploads/${esc(m.file)}" alt="" loading="lazy" class="thumb-wide">` : `<div class="empty-60">${m.archived ? 'в архиве' : esc(m.type)}</div>`}<span class="mt-8">${esc(m.name)}<br><small>${Math.round(m.size / 1024)} КБ · ${fmtTs(m.created_at)}${m.archived ? ' · сгружен ' + fmtTs(m.archived_at) : ''}</small></span>
      <div class="row mt-8 gap-6">${m.archived ? `<button data-on="click:mediaArchive-a0-false" data-a0="${m.id}" class="btn sm">Вернуть</button>` : `${m.type.startsWith('image/') ? `<button data-on="click:mediaAttach-a0" data-a0="${m.id}" class="btn gold sm">Прикрепить…</button>` : ''}<button data-on="click:copy-link" class="btn sm" data-link="${location.origin}/app/uploads/${esc(m.file)}">Ссылка</button><button data-on="click:mediaArchive-a0-true" data-a0="${m.id}" class="btn sm" title="убрать с сервера в архив: ссылка перестанет работать, файл и запись сохранятся">Сгрузить</button>`}<a class="btn sm" href="/app/api/cabinet/media/download?id=${m.id}">Скачать</a><button data-on="click:mediaDel-a0" data-a0="${m.id}" class="btn sm warn fixed">✕</button></div></div>`;
    const live = r.items.filter((m) => !m.archived), arch = r.items.filter((m) => m.archived);
    $('extra').innerHTML = `<div class="kpis mt-14">${kpiCard({ title: 'Отдается пользователям', value: +mb(r.totals.live).replace(',', '.').split(' ')[0], unit: 'МБ', sub: `${live.length} файлов · в приложение попадает только то, что вставлено в опубликованный материал`, state: 'ok' })}${kpiCard({ title: 'В архиве на сервере', value: +mb(r.totals.archived).split(' ')[0], unit: 'МБ', sub: `${arch.length} файлов · не отдаются, можно вернуть или скачать`, state: 'ok' })}</div>
      <div class="notice">Приложение у пользователей хранит только оболочку (шрифты, иконки, ~1 МБ); картинки материалов грузятся по сети при показе и на телефоне не оседают. Чтобы облегчить сервер, сгружайте файлы, которые больше не нужны в приложении: запись и доступ к скачиванию останутся.</div>
      <div class="viz mt-14"><h3>Загрузить</h3><div class="row mt-10"><input type="file" id="m-file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf" class="pad-8"><button data-on="click:mediaUpload" class="btn gold fixed">Загрузить</button><span class="hint" id="m-msg"></span></div><p class="hint">До 5 МБ. Для картинок в приложении лучше WebP или JPG шириной до 1600px — они в разы легче PNG.</p></div>
      <h3 class="mt-18">Активные</h3><div class="files cols-220">${live.map(card).join('') || '<p class="empty">Файлов пока нет.</p>'}</div>
      ${arch.length ? `<h3 class="mt-18">Архив</h3><div class="files cols-220">${arch.map(card).join('')}</div>` : ''}`;
  },
  async backlog() {
    const r = await api('/cabinet/tasks'); S.tasks = r;
    const sel = (t) => `<select data-on="change:taskStatus-a0-value" data-a0="${t.id}" class="sel-sm">${Object.entries(r.statuses).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    $('extra').innerHTML = `${r.canCreate ? `<div class="row row-end mt-14"><button data-on="click:taskForm-0" class="btn gold sm fixed">+ Новая задача</button></div>` : `<div class="notice">Вы видите задачи, поставленные ${r.own.length > 1 ? 'вашим ролям' : 'вашей роли'}${r.own.length ? ` (${r.own.map((k) => `«${esc(r.roles[k])}»`).join(', ')})` : ''}. Меняйте статус — постановщик увидит его сразу.</div>`}
      <div class="tbl"><div class="scroll"><table><thead><tr><th>Задача</th><th>Кому</th><th>Приоритет</th><th>Срок</th><th>Статус</th><th>Поставил</th><th></th></tr></thead><tbody>${r.items.map((t) => `<tr class="${t.status === 'done' ? 'dim-55' : ''}"><td><b>${esc(t.title)}</b>${t.text ? `<small>${esc(t.text.slice(0, 140))}</small>` : ''}</td><td>${esc(r.roles[t.role] || t.role)}${t.assignee ? `<small>${esc(t.assignee)}</small>` : ''}</td><td>${t.priority === 'high' ? '<span class="pill warn warn-border">высокий</span>' : 'обычный'}</td><td>${t.due_day || '—'}</td><td>${sel(t)}</td><td>${esc(t.created_by)}<small>${fmtTs(t.created_at)}</small></td><td class="num">${r.canCreate ? `<button data-on="click:taskForm-a0" data-a0="${t.id}" class="btn sm">✎</button> <button data-on="click:taskDel-a0" data-a0="${t.id}" class="btn sm warn">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Задач пока нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async tickets() {
    const q = S.data.queue || [], st = S.data.statuses || {};
    const f = S.filters.tstatus || '';
    const rows = q.filter((t) => !f || t.status === f);
    $('extra').innerHTML = `<div class="chips mt-14">${[['', 'Все'], ...Object.entries(st)].map(([k, v]) => `<span data-on="click:S-filters-tstatus-a0-EXTRAS-tickets" data-a0="${k}" class="chip${f === k ? ' on' : ''}">${esc(v)}</span>`).join('')}</div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th>№</th><th>Пользователь</th><th>Тема</th><th>Статус</th><th>Приоритет</th><th>Первый ответ</th><th>Последнее</th><th></th></tr></thead><tbody>${rows.map((t) => `<tr><td class="num">${t.id}${t.unread ? ` <span class="pill c-gold">${t.unread} нов.</span>` : ''}</td><td>${esc(t.user.name) || '—'}<small>${esc(t.user.email) || 'без почты'} · id ${t.user.id}</small></td><td><b>${esc(t.subject)}</b><small>${esc(t.topic)}</small></td><td>${esc(t.statusName)}</td><td>${t.priority === 'high' ? '<span class="warn">высокий</span>' : 'обычный'}</td><td>${t.firstReplyMin === null ? (t.status === 'resolved' ? '—' : '<span class="warn">ждет</span>') : `${t.firstReplyMin} мин ${t.slaOk ? '<span class="up">✓</span>' : '<span class="down">поздно</span>'}`}</td><td>${fmtTs(t.last_at)}<small>${t.last_by === 'support' ? 'мы' : 'пользователь'}</small></td><td class="num"><button data-on="click:ticketOpen-a0" data-a0="${t.id}" class="btn sm">Открыть чат</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Обращений нет.</td></tr>'}</tbody></table></div></div>`;
  },
  async ai() {
    const r = await api('/cabinet/ai');
    $('extra').innerHTML = `<div class="cfg-sec"><h3>Провайдеры ИИ</h3><p class="hint">Ключи хранятся зашифрованными и наружу не отдаются — виден только хвост. Проверка живая у GPT и Gemini; у Алисы и ГигаЧата — OAuth, сработает при первом вызове.</p>
      <div class="files mt-10">${r.items.map((p) => `<div class="file col no-pointer"><div class="row"><b class="grow">${esc(p.label)}</b>${p.hasKey ? `<span class="pill${p.check_ok === 1 ? ' ok' : p.check_ok === 0 ? ' warn' : ''}">${p.check_ok === 1 ? 'проверен' : p.check_ok === 0 ? 'ошибка' : 'не проверен'}</span>` : '<span class="pill dim">не подключен</span>'}</div>
        <small>${esc(p.hint)}${p.hasKey ? ` · ключ ${esc(p.keyTail)} · модель ${esc(p.model)}` : ''}${p.check_note ? ` · ${esc(p.check_note)}` : ''}</small>
        <div class="stack-6 mt-8"><input id="ai-key-${p.provider}" placeholder="${p.hasKey ? 'новый ключ (пусто — оставить прежний)' : 'API-ключ'}" autocomplete="off"><div class="row"><input id="ai-model-${p.provider}" value="${esc(p.model)}" placeholder="модель"><input id="ai-extra-${p.provider}" value="${esc(p.extra)}" placeholder="доп. (folder id / scope)"></div>
        <div class="row"><button data-on="click:aiSave-a0" data-a0="${p.provider}" class="btn gold sm fixed">Сохранить</button>${p.hasKey ? `<button data-on="click:aiCheck-a0" data-a0="${p.provider}" class="btn sm fixed">Проверить</button><button data-on="click:aiDel-a0" data-a0="${p.provider}" class="btn sm warn fixed">Убрать</button>` : ''}</div></div></div>`).join('')}</div></div>`;
  },
};
function campaignForm(id) {
  const c = (S.campaigns || []).find((x) => x.id === id) || {};
  openModal(`<div class="head"><div><span class="eyebrow">Кампания</span><h2 class="mt-6">${id ? 'Изменить' : 'Новая кампания'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="stack-10 mt-12">${field('Название', `<input id="cp-name" value="${esc(c.name || '')}" maxlength="80" placeholder="Телеграм · сентябрь">`)}
    <div class="row">${field('utm_source', `<input id="cp-source" value="${esc(c.source || '')}" placeholder="telegram">`)}${field('utm_medium', `<input id="cp-medium" value="${esc(c.medium || '')}" placeholder="post">`)}${field('utm_campaign', `<input id="cp-campaign" value="${esc(c.campaign || '')}" placeholder="sep-launch">`)}</div>
    <div class="row">${field('utm_content · размещение или автор', `<input id="cp-content" value="${esc(c.content || '')}" placeholder="story-1">`)}${field('utm_term', `<input id="cp-term" value="${esc(c.term || '')}">`)}</div>
    ${field('Рекламное обещание', `<input id="cp-promise" value="${esc(c.promise || '')}" maxlength="200" placeholder="Карта дня бесплатно">`)}
    ${field('Где размещено (канал, автор, ссылка на пост)', `<input id="cp-placement" value="${esc(c.placement || '')}" maxlength="120">`)}
    <div class="row">${field('Расходы, ₽', `<input id="cp-cost" type="number" inputmode="decimal" value="${c.cost || ''}">`)}${field('Старт', `<input id="cp-start" type="date" value="${c.start_day || ''}">`)}${field('Конец', `<input id="cp-end" type="date" value="${c.end_day || ''}">`)}</div>
    <p class="hint wrap-all" id="cp-link"></p>
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
async function campaignDel(id) { if (!confirm('Удалить кампанию? Люди, пришедшие по ее UTM, останутся в базе.')) return; await api('/cabinet/campaigns?id=' + id, { method: 'DELETE' }); toast('Удалено'); EXTRAS.campaigns(); }
function materialForm(id) {
  const r = S.materials, m = (r.items || []).find((x) => x.id === id) || {};
  const img = m.kind === 'image';
  openModal(`<div class="head"><div><span class="eyebrow">Материал</span><h2 class="mt-6">${id ? 'Изменить' : 'Новый материал'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="form-grid">
      <div class="row">${field('Тип', `<select data-on="change:materialKind" id="mt-kind">${Object.entries(r.kinds).map(([k, v]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}<span id="mt-feature-wrap" ${img ? '' : 'hidden'}>${field('Функция', `<select id="mt-feature">${(r.groups || []).map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([k, v]) => `<option value="${k}" ${m.section === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</optgroup>`).join('')}</select>`)}</span></div>
      <span id="mt-text-wrap" ${img ? 'hidden' : ''}>${field('Текст', `<textarea id="mt-text" class="tall">${esc(m.text || '')}</textarea>`)}</span>
      ${field('Картинка', `<div class="row"><input id="mt-image" value="${esc(m.image || '')}" placeholder="/app/uploads/… или загрузите файл" class="grow"><input type="file" id="mt-file" accept="image/png,image/jpeg,image/webp,image/gif" class="file-input"><button data-on="click:materialUpload" class="btn sm" type="button">Загрузить</button></div><img id="mt-preview" src="${esc(m.image || '')}" alt="" class="preview" ${m.image ? '' : 'hidden'}>`)}
      <div class="row">${field('Дата показа (пусто — каждый день)', `<input id="mt-day" type="date" value="${m.show_day || ''}">`)}${field('Статус', `<select id="mt-status">${Object.entries(r.statuses).map(([k, v]) => `<option value="${k}" ${(m.status || 'draft') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}</div>
      <p class="hint">«Опубликован» — видно всем: вопрос и аффирмация подменяют текст дня, картинка появляется наверху выбранной функции (для «Настрой дня» — рядом с фразой на «Сегодня»). Дата пустая — каждый день.</p>
      <div class="row"><button data-on="click:materialSave-a0" data-a0="${id}" class="btn gold fixed">Сохранить</button>${id ? `<button data-on="click:materialDel-a0" data-a0="${id}" class="btn sm warn fixed">Удалить</button><button data-on="click:materialHistory-a0" data-a0="${id}" class="btn sm" type="button">История</button>` : ''}<span class="hint" id="mt-msg"></span></div><div id="mt-hist"></div></div>`);
}
async function materialSave(id) {
  const kind = $('mt-kind').value;
  const r = await api('/cabinet/materials', { method: 'POST', body: JSON.stringify({ id, kind, section: kind === 'image' ? $('mt-feature').value : '', text: $('mt-text').value, image: $('mt-image').value, show_day: $('mt-day').value, status: $('mt-status').value }) });
  if (!r.ok) { $('mt-msg').textContent = r.error === 'no_image' ? 'Загрузите картинку.' : r.error === 'no_feature' ? 'Выберите функцию.' : 'Нужен текст.'; return; } toast('Сохранено'); closeModal(); EXTRAS.materials();
}
function materialKind() { const img = $('mt-kind').value === 'image'; $('mt-text-wrap').hidden = img; $('mt-feature-wrap').hidden = !img; }
/* картинка к материалу — прямо из формы: файл уходит в «Картинки и файлы», ссылка подставляется сама */
function materialUpload() {
  const f = $('mt-file').files[0], msg = $('mt-msg'); if (!f) { msg.textContent = 'Выберите файл.'; return; }
  if (f.size > 5 * 1024 * 1024) { msg.textContent = 'До 5 МБ.'; return; }
  msg.textContent = 'Загружаем…';
  const rd = new FileReader(); rd.onload = async () => {
    try { const r = await api('/cabinet/media', { method: 'POST', body: JSON.stringify({ name: f.name, type: f.type, data: rd.result }) });
      if (!r.ok) { msg.textContent = r.error === 'bad_type' ? 'Такой тип не принимаем.' : 'Не загрузилось.'; return; }
      $('mt-image').value = r.url; const pv = $('mt-preview'); pv.src = r.url; pv.hidden = false; msg.textContent = 'Картинка загружена'; }
    catch (e) { msg.textContent = 'Не загрузилось: ' + (e.code || e.message); }
  }; rd.readAsDataURL(f);
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
async function mediaDel(id) { if (!confirm('Удалить файл насовсем? Если он еще может понадобиться — лучше «Сгрузить»: запись и скачивание останутся.')) return; await api('/cabinet/media?id=' + id, { method: 'DELETE' }); toast('Удалено'); EXTRAS.media(); }
function taskForm(id) {
  const r = S.tasks, t = (r.items || []).find((x) => x.id === id) || {};
  openModal(`<div class="head"><div><span class="eyebrow">Беклог</span><h2 class="mt-6">${id ? 'Изменить задачу' : 'Новая задача'}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="stack-10 mt-12">${field('Что сделать', `<input id="tk-title" value="${esc(t.title || '')}" maxlength="140">`)}
    ${field('Подробности', `<textarea id="tk-text" class="ta minh-120">${esc(t.text || '')}</textarea>`)}
    <div class="row">${field('Кому', `<select id="tk-role">${Object.entries(r.roles).map(([k, v]) => `<option value="${k}" ${(t.role || 'content') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('Приоритет', `<select id="tk-priority"><option value="normal">обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>высокий</option></select>`)}${field('Срок', `<input id="tk-due" type="date" value="${t.due_day || ''}">`)}</div>
    ${field('Исполнитель (почта, необязательно)', `<input id="tk-assignee" value="${esc(t.assignee || '')}">`)}
    <div class="row"><button data-on="click:taskSave-a0" data-a0="${id}" class="btn gold fixed">Сохранить</button><span class="hint" id="tk-msg"></span></div></div>`);
}
async function taskSave(id) {
  const t = (S.tasks.items || []).find((x) => x.id === id) || {};
  const r = await api('/cabinet/tasks', { method: 'POST', body: JSON.stringify({ id, title: $('tk-title').value, text: $('tk-text').value, role: $('tk-role').value, priority: $('tk-priority').value, due_day: $('tk-due').value, assignee: $('tk-assignee').value, status: t.status || 'new' }) });
  if (!r.ok) { $('tk-msg').textContent = 'Нужно название задачи.'; return; } toast('Сохранено'); closeModal(); EXTRAS.backlog();
}
async function taskStatus(id, status) { await api('/cabinet/tasks', { method: 'POST', body: JSON.stringify({ id, status, onlyStatus: true }) }); toast('Статус обновлен'); EXTRAS.backlog(); }
async function taskDel(id) { if (!confirm('Удалить задачу?')) return; await api('/cabinet/tasks?id=' + id, { method: 'DELETE' }); EXTRAS.backlog(); }
async function ticketOpen(id) {
  openModal('<p class="empty">Открываем…</p>');
  const t = await api('/cabinet/ticket?id=' + id), st = S.data.statuses || {};
  openModal(`<div class="head"><div><span class="eyebrow">Обращение № ${t.id} · ${esc(t.topic)}</span><h2 class="mt-6">${esc(t.subject)}</h2><p class="hint">${esc(t.user.name) || 'без имени'} · ${esc(t.user.email) || 'без почты'} · id ${t.user.id} · создано ${fmtTs(t.created_at)}${t.first_reply_at ? ' · первый ответ ' + fmtTs(t.first_reply_at) : ''}</p></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row mt-10"><select data-on="change:ticketSet-a0" data-a0="${t.id}" id="tc-status">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select><select data-on="change:ticketSet-a0" data-a0="${t.id}" id="tc-priority"><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>обычный</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>высокий</option></select></div>
    <div class="thread" id="tc-thread">${t.messages.map((m) => `<div class="m ${m.who}"><small>${m.who === 'support' ? esc(m.author) : 'пользователь'} · ${fmtTs(m.ts)}</small>${esc(m.text)}</div>`).join('')}</div>
    <div class="stack-8 mt-10"><textarea id="tc-text" class="ta minh-90" placeholder="Ответ пользователю — он увидит его в приложении в разделе «Чат»"></textarea><div class="row"><button data-on="click:ticketReply-a0" data-a0="${t.id}" class="btn gold fixed">Отправить</button><button data-on="click:ticketReply-a0-resolved" data-a0="${t.id}" class="btn sm fixed">Отправить и закрыть</button></div></div>`);
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
  html += `<button data-on="click:openPage-activity" class="north"><div><span class="eyebrow">${esc(w.title)}</span><div class="val mt-6">${fmt(w.value)}</div></div><div class="maxw-520"><p class="c-text fw-600">${esc(w.sub)}</p>${cmp({ delta: w.delta, prev: w.prev })}</div></button>`;
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
  const lab = [0, Math.floor((n - 1) / 2), n - 1].map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(/^\d{4}-\d{2}-\d{2}$/.test(pts[i].x) ? fmtDayShort(pts[i].x) : pts[i].x)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${n > 40 ? 2 : 3.5}" fill="#f3dca0"><title>${esc(p.x)}: ${fmt(p.y)}</title></circle>`).join('');
  const mk = marks.map((m) => { const i = pts.findIndex((p) => p.x === m.x); if (i < 0) return ''; return `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#a9b8ff" stroke-width="1.5" stroke-dasharray="4 3"><title>${esc(m.label)} · ${esc(m.x)}</title></line><text x="${(X(i) + 4).toFixed(1)}" y="${T + 12}" class="fill-accent">${esc(String(m.label).slice(0, 14))}</text>`; }).join('');
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
  return `<div class="pie"><svg viewBox="0 0 150 150" class="mt-0">${arcs}<text x="75" y="80" text-anchor="middle" class="pie-total">${fmt(total)}</text></svg><div class="legend">${rows.map((r, i) => `<div><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(r[0])}<b>${fmt(r[1])} · ${(r[1] / total * 100).toFixed(1).replace('.', ',')}%</b></div>`).join('')}</div></div>`;
}
function funnelViz(rows) {
  const nums = rows.filter((r) => typeof r[1] === 'number');
  const max = Math.max(1, ...nums.map((r) => r[1]));
  return `<div class="funnel">${rows.map((r, i) => typeof r[1] === 'number' ? `<div style="width:${Math.max(36, r[1] / max * 100).toFixed(1)}%"><b>${fmt(r[1])}</b>${esc(r[0])}${i && typeof rows[i - 1][1] === 'number' && rows[i - 1][1] ? ` <span class="faint">· ${(r[1] / rows[i - 1][1] * 100).toFixed(0)}% от предыдущего</span>` : ''}</div>` : `<div class="w-36 dim-55"><b>${esc(r[1])}</b>${esc(r[0])}</div>`).join('')}</div>`;
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
  return `<div class="heat"><span class="lab"></span>${d.cols.map((c) => `<span class="lab row-center">${c % 3 === 0 ? c : ''}</span>`).join('')}${d.rows.map((r, i) => `<span class="lab">${r}</span>` + d.cells[i].map((v, h) => `<span style="--a:${(0.06 + v / max * 0.9).toFixed(2)}" title="${r}, ${h}:00 — ${v}"></span>`).join('')).join('')}</div>`;
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
  if (r.userList) { lines.push(''); lines.push(['id', 'почта', 'имя', 'регистрация', 'последний визит', 'источник', 'от кого (id)', 'привел(а)', 'платформа', 'активных дней', 'серия', 'стадия', 'функции', 'пуш'].map(safe).join(';')); for (const u of r.userList) lines.push([u.id, u.email, u.name, u.reg, u.last, u.source, u.from ? `${u.from.name || u.from.email} (${u.from.id})` : '', u.brought || 0, u.platform, u.days, u.streak, u.stage, u.feats.join(', '), u.push ? 'да' : 'нет'].map(safe).join(';')); }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lunario-${r.key}-${r.period.from}-${r.period.to}.csv`; a.click();
}

/* ── сохраненные отчеты (в этом браузере) ── */
const savedKey = 'lun_cab_saved';
const savedList = () => { try { return JSON.parse(localStorage.getItem(savedKey) || '[]'); } catch { return []; } };
function saveReport() {
  const list = savedList(); list.unshift({ role: S.role, page: S.page, period: S.period, filters: { ...S.filters }, ts: new Date().toISOString(), title: (S.me.reports[S.page] || [S.page])[0] });
  try { localStorage.setItem(savedKey, JSON.stringify(list.slice(0, 50))); toast('Отчет сохранен'); } catch { toast('Браузер не сохранил отчет'); }
}
function renderSaved() {
  const list = savedList();
  $('report').innerHTML = `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 class="mt-6">Сохраненные отчеты</h1><p class="mt-6">Отчеты с фильтрами, сохраненные в этом браузере</p></div></div>` +
    (list.length ? `<div class="tbl"><div class="scroll"><table><thead><tr><th>Отчет</th><th>Кабинет</th><th>Период</th><th>Фильтры</th><th>Когда</th><th></th></tr></thead><tbody>${list.map((s, i) => `<tr><td>${esc(s.title)}</td><td>${esc((ROLE_META[s.role] || [s.role])[0])}</td><td>${esc(/^\d+d$/.test(s.period) ? daysWord(parseInt(s.period)) : s.period)}</td><td>${esc(Object.values(s.filters).filter(Boolean).join(', ') || '—')}</td><td>${new Date(s.ts).toLocaleString('ru-RU')}</td><td class="num"><button data-on="click:openSaved-a0" data-a0="${i}" class="btn sm">Открыть</button> <button data-on="click:delSaved-a0" data-a0="${i}" class="btn sm warn">Убрать</button></td></tr>`).join('')}</tbody></table></div></div>` : '<p class="empty mt-14">Сохраненных отчетов пока нет. Откройте отчет, выберите фильтры и нажмите «☆ Сохранить».</p>');
}
function openSaved(i) { const s = savedList()[i]; if (!s) return; S.period = s.period; S.filters = { ...s.filters }; if (S.me.menus[s.role] && (S.me.roles.includes(s.role))) { S.role = s.role; } openPage(s.page); }
function delSaved(i) { const l = savedList(); l.splice(i, 1); localStorage.setItem(savedKey, JSON.stringify(l)); renderSaved(); }

/* ── пользователи ── */
function usersTable(r) {
  const list = r.userList || [];
  return `<div class="tbl"><h3>Список · ${list.length}</h3><div class="scroll"><table><thead><tr><th>Пользователь</th><th>Регистрация</th><th>Последний визит</th><th>Активные дни / серия</th><th>Стадия</th><th>Источник · платформа</th><th>Функции</th><th>Пуш</th><th></th></tr></thead><tbody>${list.map((u) => `<tr><td>${esc(u.name) || '—'}<small>${esc(u.email)} · id ${u.id}${u.role ? ' · ' + u.role : ''}</small></td><td>${u.reg}</td><td>${u.last}</td><td class="num">${u.days} / ${u.streak}</td><td>${esc(u.stage)}</td><td>${esc(u.source)}${u.from ? `<small>от ${esc(u.from.name || u.from.email)} · id ${u.from.id}</small>` : ''}${u.brought ? `<small>привел(а): ${u.brought}</small>` : ''} · ${esc(u.platform)}</td><td>${u.feats.map((f) => `<span class="pill">${esc(f)}</span>`).join('') || '<span class="lock">нет</span>'}</td><td>${u.push ? 'вкл' : '—'}</td><td class="num"><button data-on="click:userCard-a0" data-a0="${u.id}" class="btn sm">Карточка</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Никого не нашли.</td></tr>'}</tbody></table></div><p class="note">Показаны первые 500 строк; CSV содержит весь список. Личные тексты и индивидуальное настроение недоступны.</p></div>`;
}
async function userCard(id) {
  openModal('<p class="empty">Загружаем…</p>');
  try {
    const c = await api('/cabinet/user?id=' + id);
    const row = (k, v) => `<tr><td class="faint w-44">${k}</td><td>${v}</td></tr>`;
    openModal(`<div class="head"><div><span class="eyebrow">Карточка пользователя · id ${c.id}</span><h2 class="mt-6">${esc(c.name) || '—'} <span class="faint fw-500">${esc(c.email)}</span></h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
      <table class="mt-12"><tbody>${row('Регистрация · подтверждена', c.reg)}${row('Последняя авторизация', c.lastAuth)}${row('Последнее посещение', c.lastSeen)}${row('Последнее содержательное действие', c.lastAct)}${row('Активных дней · серия', `${c.days} · ${c.streak}`)}${row('Первая функция', esc(c.first))}${row('Источник · платформа · пояс', `${esc(c.source)} · ${esc(c.platform)} · ${esc(c.tz || '—')}`)}${c.from ? row('Пришел по приглашению от', `${esc(c.from.name) || '—'} · ${esc(c.from.email)} · <button data-on="click:userCard-a0" data-a0="${c.from.id}" class="btn sm">id ${c.from.id}</button>`) : ''}${c.brought && c.brought.length ? row('Пригласил(а)', c.brought.map((b) => `${esc(b.name) || '—'} · ${esc(b.email)} · ${b.reg}${b.onboarded ? '' : ' · без анкеты'} · <button data-on="click:userCard-a0" data-a0="${b.id}" class="btn sm">id ${b.id}</button>`).join('<br>')) : ''}${row('Напоминание', c.push ? 'включено' : 'нет')}${row('Записей · дневник · желания · настроений', `${c.counts.entries} · ${c.counts.journal} · ${c.counts.wishes} · ${c.counts.moods}`)}${row('Обращения', esc(c.tickets))}${row('Расходы ИИ за месяц', esc(c.ai))}</tbody></table>
      <h3 class="mt-18">События по типам · без личных текстов</h3><table><thead><tr><th>Событие</th><th>Раз</th><th>Последний день</th></tr></thead><tbody>${c.byType.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
      <p class="note">Три разные даты: авторизация (ввод кода), посещение (открытие) и содержательное действие. Тексты записей в кабинете не показываются.</p>`);
  } catch (e) { openModal(`<p class="msg err">Не получилось: ${esc(e.code || e.message)}</p>`); }
}

/* ── экономика: форма расхода и рост аудитории ── */
function economyExtras(r) {
  const per = (r.kpis.find((k) => k.title.startsWith('На 1 активного')) || {}).value;
  const growth = `<div class="viz mt-14"><h3>Рост аудитории</h3><div class="sub">линейная модель по стоимости обслуживания одного активного за месяц</div>
    <div class="row mt-12"><input data-on="input:g-out-textContent-value-toLocaleString-ru-RU-человек-a0" data-a0="${per ?? 'null'}" data-a1="${per || 0}" type="range" min="1000" max="10000" step="1000" value="1000" class="flat"><b id="g-out" class="fixed minw-220">1 000 человек → ${per === null || per === undefined ? 'нет данных' : (1000 * per).toLocaleString('ru-RU') + ' ₽/мес'}</b></div>
    <p class="note">Тестовые аккаунты и разработка исключены. Без реальных тарифов — только текущее среднее.</p></div>`;
  if (!S.me.isAdmin || !r.costForm) return growth;
  return growth + `<div class="viz mt-14"><h3>Добавить расход · ${r.costForm.month}</h3>
    <div class="row mt-12"><select id="c-kind">${r.costForm.kinds.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select><input id="c-name" placeholder="например: сервер Timeweb"><input id="c-amount" type="number" inputmode="decimal" placeholder="сумма, ₽" class="maxw-160"><button data-on="click:costAdd-a0" data-a0="${r.costForm.month}" class="btn gold fixed">Добавить</button></div>
    <p class="note">Расходы, которые не приходят автоматически, вносятся вручную с периодом и категорией. «Бюджет месяца» — отдельная строка для сравнения с прогнозом.</p></div>`;
}
async function costAdd(month) {
  const r = await api('/cabinet/costs', { method: 'POST', body: JSON.stringify({ month, name: $('c-name').value.trim(), amount: +$('c-amount').value, kind: $('c-kind').value }) });
  if (!r.ok) { toast('Проверьте название и сумму'); return; }
  toast('Добавлено'); openPage('economy');
}
async function costDel(id) { if (!confirm('Убрать строку расходов?')) return; await api('/cabinet/costs?id=' + id, { method: 'DELETE' }); toast('Убрано'); openPage('economy'); }

/* ── контент: файл целиком (вкладка «Тексты») ── */
async function editFile(name) {
  openModal('<p class="empty">Открываем…</p>');
  try {
    const f = await api('/cabinet/content?file=' + encodeURIComponent(name));
    openModal(`<div class="head"><div><span class="eyebrow">Материал</span><h2 class="mt-6">${esc(name)}</h2></div><div class="row"><button data-on="click:saveFile-a0" data-a0="${esc(name)}" class="btn gold fixed">Сохранить и опубликовать</button><button data-on="click:closeModal" class="btn sm fixed">Закрыть</button></div></div>
      <textarea id="f-text" class="mt-12" spellcheck="true">${esc(f.text)}</textarea><p class="note" id="f-msg">Формат описан в «ПРОЧТИ-МЕНЯ.txt». После сохранения приложение перечитает файл само.</p>`);
  } catch (e) { openModal(`<p class="msg err">Не получилось открыть: ${esc(e.code || e.message)}</p>`); }
}
async function saveFile(name) {
  const msg = $('f-msg');
  try { await api('/cabinet/content?file=' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify({ text: $('f-text').value }) }); toast('Сохранено — уже в приложении'); closeModal(); openPage('content'); }
  catch (e) { msg.className = 'msg err'; msg.textContent = 'Не сохранилось: ' + (e.code || e.message); }
}


/* ══════════ «Контент» — одна страница (решение владелицы 19.09): Каталоги · Темы дня · Пуши · Публикации · Картинки · Тексты.
   Раньше это были три раздела меню и сырые файлы; теперь — записи, строки, картинки к записям и к функциям, пакетная загрузка. ══════════ */
const CT = { tab: 'catalog', book: '', map: null, records: null, tables: {}, media: null, materials: null };
const CT_TABS = [['catalog', 'Каталоги'], ['themes', 'Темы дня'], ['push', 'Пуши'], ['memory', 'Память'], ['materials', 'Публикации'], ['media', 'Картинки'], ['files', 'Тексты']];
async function renderContent() {
  const box = $('report');
  box.innerHTML = `<div class="head"><div><span class="eyebrow">${esc(ROLE_META[S.role][0])} · рабочий кабинет</span><h1 class="mt-6">Контент</h1></div></div>
    <div class="tabs ct-tabs" id="ct-tabs">${CT_TABS.map(([k, t]) => `<button data-on="click:ctTab-a0" data-a0="${k}" class="${CT.tab === k ? 'on' : ''}" type="button">${t}</button>`).join('')}</div>
    <div class="row mt-12"><input data-on="keydown:if-event-key-Enter-ctSearch-value" id="ct-q" placeholder="Найти во всех текстах — слово или фразу, Enter" class="grow minh-40"><button data-on="click:ctSearchGo" class="btn sm" type="button">Найти</button></div>
    <div id="ct-search"></div>
    <div id="extra"><p class="empty">Загружаем…</p></div>`;
  window.scrollTo(0, 0);
  if (!CT.map) CT.map = await api('/cabinet/content-map');
  await ctPaint();
}
async function ctTab(k) { CT.tab = k; document.querySelectorAll('#ct-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.a0 === k)); $('extra').innerHTML = '<p class="empty">Загружаем…</p>'; await ctPaint(); }
async function ctPaint() {
  try {
    if (CT.tab === 'catalog') return ctCatalog();
    if (CT.tab === 'themes') return ctThemes();
    if (CT.tab === 'push') return ctPush();
    if (CT.tab === 'memory') return ctMemory();
    if (CT.tab === 'materials') return EXTRAS.materials();
    if (CT.tab === 'media') return EXTRAS.media();
    if (CT.tab === 'files') return ctFiles();
  } catch (e) { $('extra').innerHTML = `<p class="msg err">Не загрузилось: ${esc(e.code || e.message)}</p>`; }
}

/* ── Каталоги: карты, руны, лунные дни, личный год — записи с картинками ── */
async function ctCatalog() {
  const books = CT.map.books.filter((b) => b.images);
  if (!CT.book) CT.book = books[0].file;
  const r = await api('/cabinet/records?file=' + encodeURIComponent(CT.book)); CT.records = r;
  const img = (rec) => rec.image ? `/app/content/${r.images}/${encodeURIComponent(rec.image)}?v=${Date.now().toString(36)}` : '';
  $('extra').innerHTML = `<div class="tabs sub mt-14">${books.map((b) => `<button data-on="click:ctBook-a0" data-a0="${esc(b.file)}" class="${CT.book === b.file ? 'on' : ''}" type="button">${esc(b.title)} · ${b.lines}</button>`).join('')}</div>
    <div class="row row-between mt-12 gap-10">
      <label class="btn sm pointer">Загрузить картинки пакетом<input data-on="change:ctBulkPick-this" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label>
      <span class="hint">Файлы называются как «картинка» у записи (${r.key === 'число' ? '1.jpg … 30.jpg' : 'fool.jpg, magician.jpg …'}) — сопоставятся сами; остальные попросят выбрать запись</span>
      <button data-on="click:ctRecordAdd" class="btn sm" type="button">+ Запись</button><button data-on="click:ctHistory-a0" data-a0="${esc(CT.book)}" class="btn sm" type="button">Архив правок</button></div>
    <div id="ct-bulk"></div>
    <div class="files cols-160 mt-12">${r.records.map((rec) => `<button data-on="click:ctRecord-a0" data-a0="${rec.index}" class="file rec col gap-6 left" type="button">
      ${rec.image ? `<img src="${img(rec)}" alt="" loading="lazy" class="thumb-sq">` : '<div class="thumb-empty">нет картинки</div>'}
      <b>${esc(rec.title)}</b><small>${esc((rec.fields.find(([k]) => !['код', 'картинка', 'число', 'знак', 'англ'].includes(k)) || ['', ''])[1]).slice(0, 70)}</small></button>`).join('')}</div>`;
}
function ctBook(file) { CT.book = file; ctCatalog(); }
function ctRecord(index) {
  const r = CT.records, rec = r.records.find((x) => x.index === Number(index)); if (!rec) return;
  const locked = (k) => ['код', 'картинка', 'знак', 'число'].includes(k);
  const src = rec.image ? `/app/content/${r.images}/${encodeURIComponent(rec.image)}?v=${Date.now().toString(36)}` : '';
  openModal(`<div class="head"><div><span class="eyebrow">${esc(r.title)}</span><h2 class="mt-6">${esc(rec.title)}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="rec-edit split-160 mt-12">
      <div><div id="rec-img-box">${src ? `<img id="rec-img" src="${src}" alt="" class="thumb">` : '<div class="thumb-empty">нет картинки</div>'}</div>
        <label class="btn sm block-center mt-8 pointer">Заменить картинку<input data-on="change:ctRecordImage-a0-this" data-a0="${rec.key}" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <p class="hint mt-6" id="rec-img-msg"></p>
        ${rec.image ? `<button data-on="click:ctImageHistory-a0-a1-a2" data-a0="${esc(r.images)}" data-a1="${esc(rec.image.replace(/\.[^.]+$/, ''))}" data-a2="${esc(rec.key)}" class="btn sm w-full mt-6" type="button">Прежние картинки</button><div id="rec-img-hist"></div>` : ''}
        <a class="btn sm block-center mt-10" href="/app/?preview=${esc(r.images)}:${encodeURIComponent(rec.key)}" target="_blank" rel="noopener">Посмотреть в приложении ↗</a></div>
      <div class="stack-10">
        ${field('Название', `<input id="rec-title" value="${esc(rec.title)}" maxlength="120">`)}
        ${rec.fields.map(([k, v], i) => field(esc(k) + (locked(k) ? ' · служебное' : ''), `<input data-rec-field="${i}" data-rec-key="${esc(k)}" value="${esc(v)}" ${locked(k) ? 'readonly class="dim"' : ''}>`)).join('')}
        ${field('Текст (разделы в [квадратных скобках], абзацы через пустую строку)', `<textarea id="rec-body" class="ta-code">${esc(rec.body)}</textarea>`)}
        <div class="row"><button data-on="click:ctRecordSave-a0" data-a0="${esc(rec.key)}" class="btn gold fixed" type="button">Сохранить</button><button data-on="click:ctRecordDel-a0" data-a0="${esc(rec.key)}" class="btn sm warn fixed" type="button">Удалить запись</button><span class="hint" id="rec-msg"></span></div>
      </div></div>`);
}
/* карточка уходит по ключу записи и версии файла, с которой ее открыли (аудит v98, F03): пока правили, кто-то удалил или добавил
   запись — сервер отвечает conflict, и карточка не ложится поверх соседней; версия справочника — CT.records.version */
const CONFLICT_MSG = 'Файл изменился, пока вы правили: откройте запись заново и повторите';
async function ctRecordSave(key) {
  const fields = [...document.querySelectorAll('[data-rec-field]')].map((el) => [el.dataset.recKey, el.value]);
  const msg = $('rec-msg'); msg.textContent = 'Сохраняем…';
  try { const r = await api('/cabinet/record', { method: 'POST', body: JSON.stringify({ file: CT.book, key, version: CT.records?.version || '', title: $('rec-title').value, fields, body: $('rec-body').value }) });
    if (!r.ok) { msg.textContent = 'Не сохранилось: ' + r.error; return; } toast('Сохранено — уже в приложении'); closeModal(); ctCatalog(); }
  catch (e) { msg.textContent = e.code === 'conflict' ? CONFLICT_MSG : 'Не сохранилось: ' + (e.code || e.message); }
}
async function ctRecordDel(key) {
  if (!confirm('Удалить запись из файла? Вернуть можно будет только из архива версий.')) return;
  try { await api('/cabinet/record?file=' + encodeURIComponent(CT.book) + '&key=' + encodeURIComponent(key) + '&version=' + encodeURIComponent(CT.records?.version || ''), { method: 'DELETE' }); toast('Удалено'); closeModal(); ctCatalog(); }
  catch (e) { const msg = $('rec-msg'); if (msg) msg.textContent = e.code === 'conflict' ? CONFLICT_MSG : 'Не удалилось: ' + (e.code || e.message); }
}
async function ctRecordAdd() { const r = await api('/cabinet/record', { method: 'POST', body: JSON.stringify({ file: CT.book, add: (CT.records?.records.length || 1) - 1 }) }); if (r.ok) { await ctCatalog(); ctRecord(r.index); } }
const readAsDataUrl = (f) => new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); });
async function ctRecordImage(key, input) {
  const f = input.files[0], msg = $('rec-img-msg'); if (!f) return; if (f.size > 6 * 1024 * 1024) { msg.textContent = 'До 6 МБ'; return; }
  msg.textContent = 'Загружаем…';
  try { const r = await api('/cabinet/content-images', { method: 'POST', body: JSON.stringify({ kind: CT.records.images, key, type: f.type, data: await readAsDataUrl(f) }) });
    if (!r.ok) { msg.textContent = r.error === 'bad_type' ? 'Только JPG, PNG или WebP' : 'Не загрузилось'; return; }
    msg.textContent = r.note || 'Картинка заменена'; const im = $('rec-img'); if (im && r.url) im.src = r.url; }
  catch (e) { msg.textContent = 'Не загрузилось: ' + (e.code || e.message); }
}
/* пакетная загрузка: имя файла без расширения = «картинка» записи или ее ключ; что не совпало — выбрать запись руками */
let ctBulk = [];
function ctBulkPick(input) {
  const recs = CT.records.records;
  ctBulk = [...input.files].map((f) => { const base = f.name.replace(/\.[^.]+$/, '').toLowerCase(); const hit = recs.find((r) => (r.image || '').replace(/\.[^.]+$/, '').toLowerCase() === base || String(r.key).toLowerCase() === base); return { file: f, key: hit ? hit.key : '', title: hit ? hit.title : '' }; });
  $('ct-bulk').innerHTML = `<div class="viz mt-12"><h3>Пакет: ${ctBulk.length} ${plural(ctBulk.length, 'файл', 'файла', 'файлов')}</h3>
    <div class="tbl"><div class="scroll"><table><thead><tr><th>Файл</th><th>Запись</th></tr></thead><tbody>${ctBulk.map((b, i) => `<tr><td>${esc(b.file.name)}</td><td><select data-on="change:ctBulkAssign-a0-value" data-a0="${i}"><option value="">— выбрать —</option>${recs.map((r) => `<option value="${esc(r.key)}" ${r.key === b.key ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
    <div class="row mt-10"><button data-on="click:ctBulkGo" class="btn gold fixed" type="button">Загрузить ${ctBulk.filter((b) => b.key).length} из ${ctBulk.length}</button><span class="hint" id="ct-bulk-msg"></span></div></div>`;
}
function ctBulkAssign(i, key) { ctBulk[i].key = key; }
async function ctBulkGo() {
  const msg = $('ct-bulk-msg'); let ok = 0, fail = 0;
  for (const b of ctBulk.filter((x) => x.key)) {
    msg.textContent = `Загружаем ${ok + fail + 1}…`;
    try { const r = await api('/cabinet/content-images', { method: 'POST', body: JSON.stringify({ kind: CT.records.images, key: b.key, type: b.file.type, data: await readAsDataUrl(b.file) }) }); if (r.ok) ok++; else fail++; } catch { fail++; }
  }
  toast(`Загружено ${ok}${fail ? `, не получилось ${fail}` : ''}`); ctBulk = []; setTimeout(ctCatalog, 1500);
}

/* ── Темы дня: цепочка «источник → тема → настрой → вопрос дня» и правка настроев и вопросов ── */
async function ctThemes() {
  const [themes, sources, sets, cards, runes] = await Promise.all([...['темы-дня.txt', 'темы-источников.txt', 'настрой.txt'].map((f) => api('/cabinet/table?file=' + encodeURIComponent(f))), api('/cabinet/records?file=' + encodeURIComponent('карты-таро.txt')), api('/cabinet/records?file=' + encodeURIComponent('руны.txt'))]);
  CT.tables['настрой.txt'] = sets; CT.themes = { themes, sources, cards, runes };
  ctThemesRepaint();
}
/* перерисовка из уже загруженного — правки в ячейках не теряются */
function ctThemesRepaint() {
  const { themes, sources, cards, runes } = CT.themes, sets = CT.tables['настрой.txt'];
  const KIND = { тон: 'Прогноз дня', карта: 'Карты', руна: 'Руны', небо: 'Небо' };
  const nameOf = (kind, key) => { const list = kind === 'карта' ? cards.records : kind === 'руна' ? runes.records : null; const hit = list && list.find((r) => r.key === key); return hit ? hit.title : key; };
  $('extra').innerHTML = `<div class="notice mt-14">Как это связано: утро выбирает <b>источник</b> (карта дня, руна, небо или прогноз) → у источника есть <b>тема дня</b> → из строк темы выпадает <b>настрой</b> (главная фраза на «Сегодня») и его <b>вопрос дня</b>, на который человек отвечает вечером. Ниже — все темы с их источниками; настрой и вопросы правятся прямо здесь.</div>
    ${themes.rows.map(([key, name, about]) => { const src = sources.rows.filter((r) => r[2] === key); const mine = sets.rows.map((r, i) => [r, i]).filter(([r]) => r[0] === key);
      return `<div class="viz mt-14"><h3>${esc(name)} <small class="muted fw-400">· ${esc(key)}</small></h3><p class="hint mt-4">${esc(about || '')}</p>
        <p class="mt-8 hint-13">Источники: ${src.length ? Object.entries(src.reduce((a, r) => ((a[r[0]] = a[r[0]] || []).push(r[1]), a), {})).map(([k, v]) => `<b>${esc(KIND[k] || k)}</b>: ${v.map((x) => esc(nameOf(k, x))).join(', ')}`).join(' · ') : '<i>ни один источник не ведет к этой теме</i>'}</p>
        <div class="tbl mt-8"><div class="scroll"><table><thead><tr><th class="w-40">Настрой</th><th>Вопрос дня</th><th class="w-96">Картинка</th><th></th></tr></thead><tbody>${mine.map(([r, i]) => `<tr><td><input data-on="input:ctSetCell-a0-a1-value" data-a0="${i}" data-a1="1" value="${esc(r[1] || '')}"></td><td><input data-on="input:ctSetCell-a0-a1-value" data-a0="${i}" data-a1="2" value="${esc(r[2] || '')}"></td><td>${r[3] ? `<img src="${esc(r[3])}" alt="" class="thumb-44"> <button data-on="click:ctSetImgClear-a0" data-a0="${i}" class="btn sm" type="button" title="Убрать картинку">×</button>` : `<label class="btn sm pointer">+ фото<input data-on="change:ctSetImg-a0-this" data-a0="${i}" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>`}</td><td><button data-on="click:ctSetDel-a0" data-a0="${i}" class="btn sm" type="button">×</button></td></tr>`).join('')}</tbody></table></div></div>
        <button data-on="click:ctSetAdd-a0" data-a0="${esc(key)}" class="btn sm mt-8" type="button">+ Настрой и вопрос</button></div>`; }).join('')}
    <div class="row mt-14 sticky-foot"><button data-on="click:ctSetSave" class="btn gold fixed" type="button">Сохранить настрой и вопросы</button><button data-on="click:ctHistory-a0" data-a0="настрой.txt" class="btn sm" type="button">Архив правок</button><span class="hint" id="ct-set-msg">${sets.rows.length} строк</span></div>`;
}
function ctSetCell(i, j, v) { CT.tables['настрой.txt'].rows[i][j] = v; }
/* картинка к строке настроя: файл — в библиотеку, ссылка — в 4-ю колонку; на «Сегодня» встает к этой фразе */
async function ctSetImg(i, input) {
  const f = input.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { toast('До 5 МБ'); return; }
  try { const r = await api('/cabinet/media', { method: 'POST', body: JSON.stringify({ name: f.name, type: f.type, data: await readAsDataUrl(f) }) }); if (!r.ok) { toast('Не загрузилось'); return; }
    const row = CT.tables['настрой.txt'].rows[i]; while (row.length < 4) row.push(''); row[3] = r.url; toast('Картинка у строки — не забудьте «Сохранить»'); ctThemesRepaint(); }
  catch (e) { toast('Не загрузилось: ' + (e.code || e.message)); }
}
function ctSetImgClear(i) { const row = CT.tables['настрой.txt'].rows[i]; if (row) row[3] = ''; ctThemesRepaint(); }
function ctSetDel(i) { CT.tables['настрой.txt'].rows.splice(i, 1); ctThemesRepaint(); }
function ctSetAdd(key) { CT.tables['настрой.txt'].rows.push([key, '', '', '']); ctThemesRepaint(); }
async function ctSetSave() { const msg = $('ct-set-msg'); msg.textContent = 'Сохраняем…'; try { const r = await api('/cabinet/table', { method: 'POST', body: JSON.stringify({ file: 'настрой.txt', rows: CT.tables['настрой.txt'].rows }) }); msg.textContent = r.ok ? `Сохранено — ${r.rows} строк, уже в приложении` : 'Не сохранилось'; if (r.ok) toast('Сохранено'); } catch (e) { msg.textContent = 'Не сохранилось: ' + (e.code || e.message); } }

/* ── Пуши: утро, вечер (варианты по дням), неделя, пробное — тексты напоминаний ── */
async function ctPush() {
  const t = await api('/cabinet/table?file=' + encodeURIComponent('напоминания.txt')); CT.tables['напоминания.txt'] = t;
  ctPushRepaint();
}
function ctPushRepaint() {
  const t = CT.tables['напоминания.txt'];
  const G = [['Утро', (k) => k.startsWith('morning'), 'Заголовок утреннего пуша — настрой дня, тело собирается из выбранных плиток; здесь — только «утро еще не собралось»'], ['Вечер', (k) => k.startsWith('evening'), 'Приглашение открыть приложение — не вопрос. Варианты чередуются по дням; номера подряд'], ['Неделя', (k) => k.startsWith('week'), 'week — обычная, week-мало — когда моментов меньше трех ({n}, {момента})'], ['Остальное', (k) => !/^(morning|evening|week)/.test(k), '']];
  $('extra').innerHTML = G.map(([title, test, hint]) => { const rows = t.rows.map((r, i) => [r, i]).filter(([r]) => test(r[0])); return `<div class="viz mt-14"><h3>${title} · ${rows.length}</h3>${hint ? `<p class="hint mt-4">${esc(hint)}</p>` : ''}
    <div class="tbl mt-8"><div class="scroll"><table><thead><tr><th class="w-120">Ключ</th><th class="w-38">Заголовок</th><th>Текст</th><th></th></tr></thead><tbody>${rows.map(([r, i]) => `<tr><td><input data-on="input:ctPushCell-a0-a1-value" data-a0="${i}" data-a1="0" value="${esc(r[0])}" class="mono"></td><td><input data-on="input:ctPushCell-a0-a1-value" data-a0="${i}" data-a1="1" value="${esc(r[1] || '')}"></td><td><input data-on="input:ctPushCell-a0-a1-value" data-a0="${i}" data-a1="2" value="${esc(r[2] || '')}"></td><td><button data-on="click:ctPushDel-a0" data-a0="${i}" class="btn sm" type="button">×</button></td></tr>`).join('')}</tbody></table></div></div>
    ${title === 'Вечер' ? `<button data-on="click:ctPushAddEvening" class="btn sm mt-8" type="button">+ Вечерний вариант</button>` : ''}</div>`; }).join('')
    + `<div class="row mt-14 sticky-foot"><button data-on="click:ctPushSave" class="btn gold fixed" type="button">Сохранить пуши</button><button data-on="click:ctHistory-a0" data-a0="напоминания.txt" class="btn sm" type="button">Архив правок</button><span class="hint" id="ct-push-msg">${t.rows.length} строк · после сохранения тексты сразу уходят в очередь на следующую отправку</span></div>`;
}
function ctPushCell(i, j, v) { CT.tables['напоминания.txt'].rows[i][j] = v; }
function ctPushDel(i) { CT.tables['напоминания.txt'].rows.splice(i, 1); ctPushRepaint(); }
function ctPushAddEvening() { const rows = CT.tables['напоминания.txt'].rows; const n = rows.filter((r) => /^evening(-\d+)?$/.test(r[0])).length; rows.push([n ? `evening-${n + 1}` : 'evening', '', '']); ctPushRepaint(); }
async function ctPushSave() { const msg = $('ct-push-msg'); msg.textContent = 'Сохраняем…'; try { const r = await api('/cabinet/table', { method: 'POST', body: JSON.stringify({ file: 'напоминания.txt', rows: CT.tables['напоминания.txt'].rows }) }); msg.textContent = r.ok ? `Сохранено — ${r.rows} строк` : 'Не сохранилось'; if (r.ok) toast('Сохранено'); } catch (e) { msg.textContent = 'Не сохранилось: ' + (e.code || e.message); } }

/* ── Память («Я помню»): приложение вспоминает человека одной фразой. Правила — в коде (memory.mjs), слова — здесь.
      Пустой текст выключает правило. «Проверить на себе» показывает, что сработало бы у вас сегодня ── */
const MEMORY_RULES = [
  ['вопрос-тот-же', 'На этот же вопрос дня человек уже отвечал раньше', 'Когда · текст'],
  ['тема-вопроса', 'Сегодня спросил про тему, о которой уже спрашивал «Да / Нет» (позавчера и раньше)', 'Когда · тема · ответ'],
  ['тема-руны', 'То же, но раньше на эту тему отвечала руна', 'Когда · тема · руна'],
  ['запись-о-теме', 'В сегодняшней записи — тема, о которой он спрашивал «Да / Нет»', 'Когда · тема · ответ'],
  ['карта-год-назад', 'Карта дня ровно год назад', 'карта'],
  ['карта-повтор', 'Сегодняшняя карта уже приходила — неделю назад и раньше', 'Карта · когда'],
  ['руна-повтор', 'Сегодняшняя руна дня уже выпадала', 'руна · когда'],
  ['неделю-назад', 'Запись ровно неделю назад', 'текст'],
  ['вчера', 'Вчерашнее настроение', 'настроение'],
  ['раньше', 'Последняя запись за месяц', 'Когда · текст'],
  ['первая-карта', '«Обо мне», после первой недели: с какого дня здесь и какой была первая карта', 'дата · карта'],
  ['с-нами', '«Обо мне», если карты еще не было', 'дата'],
];
const EVENING_RULES = [
  ['evening-аскеза', 'Идет аскеза — со второго дня', 'Аскеза · n · всего · дней'],
  ['evening-тревога', 'Три дня подряд отмечено тревожное настроение', 'имя'],
  ['evening-серия', 'Серия записанных дней — от трех', 'n · дней'],
  ['evening-привычка', 'Привычка держится три дня и больше, сегодня еще не отмечена', 'Привычка · n · дней'],
];
const TOPIC_RU = { work: 'работа', money: 'деньги', love: 'отношения', health: 'здоровье', move: 'дом и переезд', study: 'учеба' };
async function ctMemory() {
  for (const file of ['память.txt', 'вопросы-по-темам.txt', 'напоминания.txt']) CT.tables[file] = await api('/cabinet/table?file=' + encodeURIComponent(file));
  ctMemoryRepaint();
}
function ctMemoryRepaint() {
  const M = CT.tables['память.txt'], Q = CT.tables['вопросы-по-темам.txt'], P = CT.tables['напоминания.txt'];
  const rowOf = (t, key) => { let i = t.rows.findIndex((r) => r[0] === key); if (i < 0) { t.rows.push([key, '']); i = t.rows.length - 1; } return i; };
  const ruleRows = (t, rules, textCols) => rules.map(([key, when, vars]) => { const i = rowOf(t, key); const r = t.rows[i]; const on = textCols.some((j) => (r[j] || '').trim());
    return `<tr class="${on ? '' : 'dim-55'}"><td><b>${esc(when)}</b><br><small class="hint">${esc(key)} · подстановки: ${esc(vars)}</small></td>${textCols.map((j) => `<td><input data-on="input:ctMemoryCell-a0-a1-a2-value" data-a0="${esc(t.file)}" data-a1="${i}" data-a2="${j}" value="${esc(r[j] || '')}" placeholder="${on ? '' : 'пусто — правило выключено'}"></td>`).join('')}</tr>`; }).join('');
  $('extra').innerHTML = `<div class="viz mt-14"><h3>Как это работает</h3><p class="hint mt-4">Приложение не считает человека, а вспоминает его — одной фразой, как близкий. Правила живут в коде, слова — здесь: одна строка в день на карточке дня в Дневнике (первое совпавшее сверху вниз), одна — на «Обо мне». Нечего вспомнить — молчит. Пустой текст выключает правило. {Когда} с большой буквы — с большой буквы в тексте.</p></div>
    <div class="viz mt-14"><h3>Строки памяти · карточка дня и «Обо мне»</h3>
      <div class="tbl mt-8"><div class="scroll"><table><thead><tr><th class="w-40">Когда срабатывает</th><th>Фраза</th></tr></thead><tbody>${ruleRows(M, MEMORY_RULES, [1])}</tbody></table></div></div>
      <div class="row mt-10"><button data-on="click:ctMemorySave-a0" data-a0="память.txt" class="btn gold fixed" type="button">Сохранить строки памяти</button><button data-on="click:ctHistory-a0" data-a0="память.txt" class="btn sm" type="button">Архив правок</button><span class="hint" id="ct-memory-msg-память.txt"></span></div></div>
    <div class="viz mt-14"><h3>Вопрос дня по теме · ${Q.rows.length}</h3><p class="hint mt-4">Если за месяц человек спрашивал про одно и то же три раза и больше, через день вместо общего вопроса дня приходит вопрос по его теме. Темы: ${Object.entries(TOPIC_RU).map(([k, v]) => `<b>${k}</b> — ${v}`).join(' · ')}</p>
      <div class="tbl mt-8"><div class="scroll"><table><thead><tr><th class="w-120">Тема</th><th>Вопрос</th><th></th></tr></thead><tbody>${Q.rows.map((r, i) => `<tr><td><select data-on="change:ctMemoryCell-a0-a1-a2-value" data-a0="вопросы-по-темам.txt" data-a1="${i}" data-a2="0" class="sel-sm">${Object.entries(TOPIC_RU).map(([k, v]) => `<option value="${k}" ${r[0] === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td><td><input data-on="input:ctMemoryCell-a0-a1-a2-value" data-a0="вопросы-по-темам.txt" data-a1="${i}" data-a2="1" value="${esc(r[1] || '')}"></td><td><button data-on="click:ctMemoryDel-a0-a1" data-a0="вопросы-по-темам.txt" data-a1="${i}" class="btn sm" type="button">×</button></td></tr>`).join('')}</tbody></table></div></div>
      <div class="row mt-10"><button data-on="click:ctMemoryAddQ" class="btn sm" type="button">+ Вопрос</button><button data-on="click:ctMemorySave-a0" data-a0="вопросы-по-темам.txt" class="btn gold fixed" type="button">Сохранить вопросы</button><button data-on="click:ctHistory-a0" data-a0="вопросы-по-темам.txt" class="btn sm" type="button">Архив правок</button><span class="hint" id="ct-memory-msg-вопросы-по-темам.txt"></span></div></div>
    <div class="viz mt-14"><h3>Вечер, который видит день</h3><p class="hint mt-4">Вместо обычного вечернего пуша — строка про его аскезу, серию, тревожные дни или привычку. Правила по порядку сверху вниз; молчит, если день уже записан. Остальные вечерние варианты — во вкладке «Пуши»</p>
      <div class="tbl mt-8"><div class="scroll"><table><thead><tr><th class="w-36">Когда срабатывает</th><th>Заголовок</th><th>Текст</th></tr></thead><tbody>${ruleRows(P, EVENING_RULES, [1, 2])}</tbody></table></div></div>
      <div class="row mt-10"><button data-on="click:ctMemorySave-a0" data-a0="напоминания.txt" class="btn gold fixed" type="button">Сохранить вечер</button><span class="hint" id="ct-memory-msg-напоминания.txt"></span></div></div>
    <div class="viz mt-14"><h3>Проверить на себе</h3><p class="hint mt-4">Что сработало бы у вас сегодня — по вашим записям, картам и вопросам в приложении</p>
      <div class="row mt-8"><button data-on="click:ctMemoryPreview" class="btn sm" type="button">Показать</button></div><div id="ct-memory-preview" class="mt-10"></div></div>
    <div class="viz mt-14"><h3>База знаний — на себе</h3><p class="hint mt-4">Папка документов о человеке, собранная из журнала: «Обо мне» с натальной картой дословно, «Тесты и совместимости», «Последние записи» (120 дней дословно), отчеты по месяцам, «Портрет». Читают ее ИИ и выгрузка, а не экраны; обновляется раз в сутки. Здесь — ваши собственные документы. Значения планет в знаках и аспектов — таблицы «планеты-в-знаках.txt» и «аспекты.txt» во вкладке «Тексты»</p>
      <div class="row mt-8"><button data-on="click:ctKnowledge" class="btn sm" type="button">Показать документы</button></div><div id="ct-knowledge" class="mt-10"></div></div>`;
}
function ctMemoryCell(file, i, j, v) { CT.tables[file].rows[i][j] = v; }
function ctMemoryDel(file, i) { CT.tables[file].rows.splice(i, 1); ctMemoryRepaint(); }
function ctMemoryAddQ() { CT.tables['вопросы-по-темам.txt'].rows.push(['work', '']); ctMemoryRepaint(); }
async function ctMemorySave(file) { const msg = document.getElementById('ct-memory-msg-' + file); msg.textContent = 'Сохраняем…'; try { const r = await api('/cabinet/table', { method: 'POST', body: JSON.stringify({ file, rows: CT.tables[file].rows }) }); msg.textContent = r.ok ? `Сохранено — ${r.rows} строк, уже в приложении` : 'Не сохранилось'; if (r.ok) toast('Сохранено'); } catch (e) { msg.textContent = 'Не сохранилось: ' + (e.code || e.message); } }
async function ctKnowledge() {
  const box = $('ct-knowledge'); box.innerHTML = '<p class="hint">Смотрим…</p>';
  try { await api('/knowledge/rebuild', { method: 'POST' }); const r = await api('/cabinet/knowledge-self');
    box.innerHTML = `<div class="files">${r.docs.map((x) => `<button data-on="click:ctKnowledgeDoc-a0" data-a0="${esc(x.doc)}" class="file" type="button"><span>${esc(x.title)}<br><small>${esc(x.doc)} · ${(x.size / 1024).toFixed(1)} КБ · обновлен ${esc(String(x.updated).slice(0, 16).replace('T', ' '))}</small></span><span class="btn sm">Открыть</span></button>`).join('')}</div>`;
  } catch (e) { box.innerHTML = `<p class="msg err">Не получилось: ${esc(e.code || e.message)}</p>`; }
}
async function ctKnowledgeDoc(doc) {
  const r = await api('/cabinet/knowledge-self?doc=' + encodeURIComponent(doc));
  openModal(`<div class="head"><div><span class="eyebrow">база знаний · ${esc(doc)}</span><h2 class="mt-6">${esc((r.data && r.data.title) || doc)}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <p class="hint mt-6">Так документ увидит ИИ — текстом; ниже — те же данные как есть</p>
    <pre class="hint pre mt-10">${esc(r.text)}</pre>
    <pre class="mono-box mt-10">${esc(JSON.stringify(r.data, null, 1))}</pre>`);
}
async function ctMemoryPreview() {
  const box = $('ct-memory-preview'); box.innerHTML = '<p class="hint">Смотрим…</p>';
  try {
    const r = await api('/cabinet/memory-preview');
    const FAV = { rune: 'Руна', runes3: 'Три руны', spread: 'Три карты', fork: 'Выбор' };
    const rows = [['Карточка дня', r.day ? `${esc(r.day.text)} <small class="hint">· ${esc(r.day.kind)}</small>` : '<span class="hint">нечего вспомнить — молчим</span>'],
      ['«Обо мне»', r.about ? esc(r.about.text) : '<span class="hint">первая неделя — молчим</span>'],
      ['Любимый способ в «Ответить себе»', r.favorite ? FAV[r.favorite] || r.favorite : '<span class="hint">меньше трех обращений — по умолчанию руна</span>'],
      ['Тема месяца', r.topic ? `${esc(TOPIC_RU[r.topic] || r.topic)}${r.topicQuestion ? ` · сегодня вопрос дня по теме: «${esc(r.topicQuestion)}»` : ' · сегодня общий вопрос дня (по теме — через день)'}` : '<span class="hint">меньше трех вопросов про одно за месяц</span>'],
      ['Вечерний пуш', r.evening ? `${esc(r.evening.key)} · ${esc(JSON.stringify(r.evening.vars))}` : '<span class="hint">обычный вечер</span>']];
    box.innerHTML = `<div class="tbl"><div class="scroll"><table><tbody>${rows.map(([k, v]) => `<tr><td class="faint w-44">${k}</td><td>${v}</td></tr>`).join('')}</tbody></table></div></div>${r.warnings.length ? `<p class="msg err mt-8">${r.warnings.map(esc).join('<br>')}</p>` : ''}`;
  } catch (e) { box.innerHTML = `<p class="msg err">Не получилось: ${esc(e.code || e.message)}</p>`; }
}

/* ── Тексты: остальные таблицы строками и файлы целиком ── */
async function ctFiles() {
  const r = await api('/cabinet/report?kind=content&period=' + S.period); const files = r.files || [];
  const tables = CT.map.tables.filter((t) => !['настрой.txt', 'напоминания.txt', 'память.txt', 'вопросы-по-темам.txt'].includes(t.file)).sort((a, b) => (a.file === 'интерфейс.txt' ? -1 : b.file === 'интерфейс.txt' ? 1 : 0));   /* фразы интерфейса — первыми */
  $('extra').innerHTML = `<div class="viz mt-14"><h3>Таблицы — строками</h3><p class="hint mt-4">Одна строка — одна запись; правится по ячейкам</p>
      <div class="files mt-10">${tables.map((t) => `<button data-on="click:ctTable-a0" data-a0="${esc(t.file)}" class="file" type="button"><span>${esc(t.title)}<br><small>${esc(t.file)} · ${t.lines} строк</small></span><span class="btn sm">Править</span></button>`).join('')}</div></div>
    <div class="viz mt-14"><h3>Файлы целиком</h3><p class="hint mt-4">Для всего остального и для правок в структуре. Формат — в «ПРОЧТИ-МЕНЯ.txt»</p>
      <div class="files mt-10">${files.map((f) => `<div class="file no-pointer"><span>${esc(f.name)}<br><small>${f.lines} записей · изменен ${esc(f.mtime)}</small></span><span class="row gap-6"><button data-on="click:editFile-a0" data-a0="${esc(f.name)}" class="btn sm" type="button">Открыть</button><button data-on="click:ctHistory-a0" data-a0="${esc(f.name)}" class="btn sm" type="button">Архив</button></span></div>`).join('')}</div></div>
    ${(r.kpis || []).length ? `<div class="kpis mt-14">${r.kpis.map(kpiCard).join('')}</div>` : ''}${(r.tables || []).map((t) => tableCard(t, 'content')).join('')}`;
}
async function ctTable(file) {
  const t = await api('/cabinet/table?file=' + encodeURIComponent(file)); CT.tables[file] = t;
  const paint = () => openModal(`<div class="head"><div><span class="eyebrow">${esc(file)}</span><h2 class="mt-6">${esc(t.title)}</h2></div><div class="row"><button data-on="click:ctTableSave-a0" data-a0="${esc(file)}" class="btn gold fixed" type="button">Сохранить</button><button data-on="click:closeModal" class="btn sm">Закрыть</button></div></div>
    ${t.notes ? `<pre class="hint pre mt-10">${esc(t.notes.replace(/^#\\s?/gm, ''))}</pre>` : ''}
    <div class="tbl mt-10"><div class="scroll"><table><thead><tr>${t.cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th></th></tr></thead><tbody>${t.rows.map((r, i) => `<tr>${t.cols.map((c, j) => `<td><input data-on="input:ctTableCell-a0-a1-a2-value" data-a0="${esc(file)}" data-a1="${i}" data-a2="${j}" value="${esc(r[j] || '')}"></td>`).join('')}<td><button data-on="click:ctTableDel-a0-a1" data-a0="${esc(file)}" data-a1="${i}" class="btn sm" type="button">×</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="row mt-10"><button data-on="click:ctTableAdd-a0" data-a0="${esc(file)}" class="btn sm" type="button">+ Строка</button><span class="hint" id="ct-table-msg">${t.rows.length} строк</span></div>`);
  CT.tablePaint = paint; paint();
}
function ctTableCell(file, i, j, v) { CT.tables[file].rows[i][j] = v; }
function ctTableDel(file, i) { CT.tables[file].rows.splice(i, 1); CT.tablePaint(); }
function ctTableAdd(file) { CT.tables[file].rows.push(CT.tables[file].cols.map(() => '')); CT.tablePaint(); }
async function ctTableSave(file) { const msg = $('ct-table-msg'); msg.textContent = 'Сохраняем…'; try { const r = await api('/cabinet/table', { method: 'POST', body: JSON.stringify({ file, rows: CT.tables[file].rows }) }); msg.textContent = r.ok ? `Сохранено — ${r.rows} строк` : 'Не сохранилось'; if (r.ok) toast('Сохранено — уже в приложении'); } catch (e) { msg.textContent = 'Не сохранилось: ' + (e.code || e.message); } }

/* ── Картинка из библиотеки — к функции или на карту/руну/день ── */
async function mediaAttach(id) {
  if (!CT.map) CT.map = await api('/cabinet/content-map');
  const m = (S.mediaItems || []).find((x) => x.id === Number(id)); if (!m) return;
  const books = CT.map.books.filter((b) => b.images);
  openModal(`<div class="head"><div><span class="eyebrow">Картинка</span><h2 class="mt-6">${esc(m.name)}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="split-140 mt-12"><img src="/app/uploads/${esc(m.file)}" alt="" class="thumb">
    <div class="stack-14">
      <div class="viz"><h3>К функции</h3><p class="hint mt-4">Появится наверху выбранной функции у всех, для «Настрой дня» — рядом с фразой на «Сегодня»</p>
        <div class="row mt-8">${field('Функция', `<select id="ma-feature">${CT.map.features.map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</optgroup>`).join('')}</select>`)}${field('Дата (пусто — каждый день)', `<input id="ma-day" type="date">`)}<button data-on="click:mediaAttachFeature-a0" data-a0="${m.id}" class="btn gold sm fixed self-end" type="button">Опубликовать</button></div></div>
      <div class="viz"><h3>На карту, руну, лунный день или год</h3>
        <div class="row mt-8">${field('Каталог', `<select data-on="change:mediaAttachBook-value" id="ma-book">${books.map((b) => `<option value="${esc(b.file)}">${esc(b.title)}</option>`).join('')}</select>`)}${field('Запись', `<select id="ma-record"><option>…</option></select>`)}<button data-on="click:mediaAttachRecord-a0" data-a0="${m.id}" class="btn gold sm fixed self-end" type="button">Поставить</button></div></div>
      <p class="hint" id="ma-msg"></p></div></div>`);
  mediaAttachBook(books[0].file);
}
async function mediaAttachBook(file) { const r = await api('/cabinet/records?file=' + encodeURIComponent(file)); CT.attachBook = r; $('ma-record').innerHTML = r.records.map((x) => `<option value="${esc(x.key)}">${esc(x.title)}</option>`).join(''); }
async function mediaAttachFeature(id) { const m = (S.mediaItems || []).find((x) => x.id === Number(id)); const r = await api('/cabinet/materials', { method: 'POST', body: JSON.stringify({ kind: 'image', section: $('ma-feature').value, image: '/app/uploads/' + m.file, show_day: $('ma-day').value, status: 'published' }) }); $('ma-msg').textContent = r.ok ? 'Опубликовано — уже в приложении' : 'Не получилось: ' + r.error; if (r.ok) toast('Опубликовано'); }
async function mediaAttachRecord(id) { const r = await api('/cabinet/content-images', { method: 'POST', body: JSON.stringify({ kind: CT.attachBook.images, key: $('ma-record').value, mediaId: Number(id) }) }); $('ma-msg').textContent = r.ok ? (r.note || 'Поставлено — уже в приложении') : 'Не получилось: ' + r.error; if (r.ok) toast('Поставлено'); }

/* ── поиск по всем текстам ── */
function ctSearchGo() { ctSearch($('ct-q').value); }
async function ctSearch(q) {
  const box = $('ct-search'); q = String(q || '').trim(); if (q.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="empty">Ищем…</p>';
  const r = await api('/cabinet/search?q=' + encodeURIComponent(q));
  box.innerHTML = `<div class="viz mt-10"><h3>Найдено: ${r.total}${r.total > r.items.length ? ` (показаны ${r.items.length})` : ''} <button data-on="click:ctSearchClear" class="btn sm ml-8" type="button">Закрыть</button></h3>
    <div class="files mt-8">${r.items.map((it) => `<button data-on="click:ctOpenHit-a0-a1-a2" data-a0="${esc(it.file)}" data-a1="${esc(it.kind)}" data-a2="${it.index}" class="file left" type="button"><span><b>${esc(it.title)}</b> <small>· ${esc(it.file)}</small><br><small>…${esc(it.snippet)}…</small></span><span class="btn sm">Открыть</span></button>`).join('') || '<p class="empty">Ничего не нашлось</p>'}</div></div>`;
}
function ctSearchClear() { $('ct-search').innerHTML = ''; $('ct-q').value = ''; }
async function ctOpenHit(file, kind, index) {
  if (kind === 'book') { CT.book = file; CT.records = await api('/cabinet/records?file=' + encodeURIComponent(file)); ctRecord(index); }
  else ctTable(file);
}

/* ── история версий файла: список с датой и автором, посмотреть, откатить ── */
async function ctHistory(file) {
  const r = await api('/cabinet/versions?file=' + encodeURIComponent(file));
  openModal(`<div class="head"><div><span class="eyebrow">Архив правок</span><h2 class="mt-6">${esc(file)}</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <p class="hint mt-8">Перед каждым сохранением прежний файл уходит в архив. «Вернуть» ставит выбранную версию на место — текущая тоже сохранится в архиве.</p>
    <div class="tbl mt-10"><div class="scroll"><table><thead><tr><th>Когда</th><th>Кто</th><th>Размер</th><th></th></tr></thead><tbody>${r.items.map((v) => `<tr><td>${fmtTs(v.ts)}</td><td>${esc(v.by)}</td><td>${(v.size / 1024).toFixed(1)} КБ</td><td class="row gap-6"><button data-on="click:ctVersionView-a0-a1" data-a0="${esc(file)}" data-a1="${esc(v.id)}" class="btn sm" type="button">Посмотреть</button><button data-on="click:ctVersionRestore-a0-a1" data-a0="${esc(file)}" data-a1="${esc(v.id)}" class="btn gold sm" type="button">Вернуть</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Правок из кабинета еще не было</td></tr>'}</tbody></table></div></div>
    <pre id="ct-version-text" class="hint mono-box mt-10"></pre>`);
}
async function ctVersionView(file, id) { const r = await api('/cabinet/versions?file=' + encodeURIComponent(file) + '&id=' + encodeURIComponent(id)); $('ct-version-text').textContent = r.text || ''; }
async function ctVersionRestore(file, id) { if (!confirm('Вернуть эту версию файла? Текущая уйдет в архив.')) return; const r = await api('/cabinet/versions', { method: 'POST', body: JSON.stringify({ file, id }) }); if (r.ok) { toast('Версия возвращена — уже в приложении'); closeModal(); ctPaint(); } else toast('Не получилось: ' + r.error); }
/* история картинки записи */
async function ctImageHistory(kind, base, key) {
  const r = await api('/cabinet/image-versions?kind=' + encodeURIComponent(kind) + '&base=' + encodeURIComponent(base));
  const box = $('rec-img-hist'); if (!box) return;
  box.innerHTML = r.items.length ? `<div class="stack-6 mt-8">${r.items.map((v) => `<div class="row gap-8 fs-12"><span>${fmtTs(v.ts)}</span><button data-on="click:ctImageRestore-a0-a1-a2" data-a0="${esc(kind)}" data-a1="${esc(v.id)}" data-a2="${esc(key)}" class="btn sm" type="button">Вернуть</button></div>`).join('')}</div>` : '<p class="hint mt-6">Прежних картинок нет</p>';
}
async function ctImageRestore(kind, id, key) { const r = await api('/cabinet/image-versions?kind=' + encodeURIComponent(kind), { method: 'POST', body: JSON.stringify({ id, key }) }); if (r.ok) { toast('Картинка возвращена'); const im = $('rec-img'); if (im && r.url) im.src = r.url; } else toast('Не получилось: ' + r.error); }
/* материалы: история и возврат */
async function materialHistory(id) {
  const r = await api('/cabinet/materials/versions?id=' + id);
  const box = $('mt-hist'); if (!box) return;
  box.innerHTML = r.items.length ? `<div class="tbl mt-8"><div class="scroll"><table><thead><tr><th>Когда</th><th>Кто</th><th>Что было</th><th></th></tr></thead><tbody>${r.items.map((v) => `<tr><td>${fmtTs(v.ts)}</td><td>${esc(v.by)}</td><td><small>${esc((v.title || v.text || v.image || '').slice(0, 80))} · ${esc(v.status)}</small></td><td><button data-on="click:materialRestore-a0" data-a0="${v.id}" class="btn sm" type="button">Вернуть</button></td></tr>`).join('')}</tbody></table></div></div>` : '<p class="hint mt-6">Правок еще не было</p>';
}
async function materialRestore(versionId) { const r = await api('/cabinet/materials/versions', { method: 'POST', body: JSON.stringify({ versionId }) }); if (r.ok) { toast('Версия возвращена'); closeModal(); EXTRAS.materials(); } else toast('Не получилось'); }

/* ── «Проверка текстов»: пять отчетов о текстах на одной странице ── */
async function renderCheck() {
  const box = $('report'); const kinds = ['quality', 'concerns', 'topics', 'rituals', 'feedback', 'faq'];
  box.innerHTML += `<div class="tools"><div class="periods">${periodKeys().map((k) => `<button data-on="click:setPeriod-a0" data-a0="${k}" class="${S.period === k ? 'on' : ''}">${daysWord(parseInt(k))}</button>`).join('')}</div></div><div id="check-body"><p class="empty">Загружаем…</p></div>`;
  const parts = [];
  for (const k of kinds) { try { const r = await api(`/cabinet/report?kind=${k}&period=${S.period}`); parts.push(`<section class="check-part mt-22"><h2>${esc(r.title || k)}</h2>${r.sub ? `<p class="hint">${esc(r.sub)}</p>` : ''}${(r.notes || []).map((n) => `<div class="notice">${esc(n)}</div>`).join('')}${(r.kpis || []).length ? `<div class="kpis">${r.kpis.map(kpiCard).join('')}</div>` : ''}${(r.charts || []).length ? `<div class="charts">${r.charts.map(vizCard).join('')}</div>` : ''}${(r.tables || []).map((t) => tableCard(t, k)).join('')}${r.how ? `<div class="how"><b>Как считается.</b> ${esc(r.how)}</div>` : ''}</section>`); } catch (e) { parts.push(`<p class="msg err">${esc(k)}: ${esc(e.code || e.message)}</p>`); } }
  $('check-body').innerHTML = parts.join('');
}

/* ── конструктор кабинетов (админ): состав дашбордов, названия, периоды, блоки сводки ── */
const BLOCK_NAMES = { new_users: 'Новые с подтвержденной почтой', activation: 'Активация за 24 часа', active: 'Активные за день, неделю и месяц', repeat: 'Повторное использование', retention: 'Возвраты D1, D7 и 4-я неделя', features: 'Использование функций', costs: 'Расходы за месяц', problems: 'Требуют внимания' };
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
  const add = rest.length ? `<div class="row mt-10"><select id="cfg-add">${rest.map((k) => `<option value="${k}">${esc(name(k))} — ${esc(all[k][1])}</option>`).join('')}</select><button data-on="click:cfgAdd" class="btn sm fixed">+ Добавить дашборд</button></div>` : '<p class="hint">Все дашборды уже в этом кабинете.</p>';
  const periods = `<div class="chips mt-8">${c.periods.map((d) => `<span class="chip on">${daysWord(d)} <button data-on="click:cfgPeriod-a0-false" data-a0="${d}" class="btn sm warn btn-bare">✕</button></span>`).join('')}</div>
    <div class="row mt-8"><input id="cfg-days" type="number" min="1" max="365" placeholder="дней, например 60" class="maxw-220"><button data-on="click:cfgPeriod-cfg-days-value-true" class="btn sm fixed">+ Добавить период</button></div>
    <p class="hint">Набор кнопок периода одинаков во всех кабинетах. Сравнение всегда с предыдущим таким же отрезком.</p>`;
  const blocks = r === 'admin' ? `<div class="cfg-sec"><h3>Блоки единого дашборда</h3><p class="hint">Порядок — как в списке. Снятый блок исчезает со сводки, отчет за ним остается в меню.</p><div class="chips mt-8">${c.defaults.blocks.map((k) => `<label class="chip${c.blocks.includes(k) ? ' on' : ''}"><input data-on="change:cfgBlock-a0-checked" data-a0="${k}" type="checkbox" ${c.blocks.includes(k) ? 'checked' : ''}> ${esc(BLOCK_NAMES[k] || k)}</label>`).join('')}</div></div>` : '';
  openModal(`<div class="head"><div><span class="eyebrow">Конструктор кабинетов</span><h2 class="mt-6">Что видит роль</h2></div><button data-on="click:closeModal" class="btn sm">Закрыть</button></div>
    <div class="row mt-12"><select data-on="change:CFG-role-value-cfgRender">${Object.entries(ROLE_META).filter(([k]) => k !== 'user').map(([k, [nm]]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${nm}</option>`).join('')}</select><span class="hint fixed">${c.custom ? `изменено ${esc((c.updated.updated_by || '').split('@')[0])} · ${(c.updated.updated_at || '').slice(0, 10)}` : 'настройки по умолчанию'}</span></div>
    <div class="cfg-sec"><h3>Дашборды в кабинете «${esc(ROLE_META[r][0])}»</h3><p class="hint">Порядок в списке — порядок в меню. Убранный дашборд для этой роли закрывается и на сервере.</p><div class="cfg-list">${list}</div>${add}</div>
    <div class="cfg-sec"><h3>Периоды</h3>${periods}</div>${blocks}
    <div class="row mt-20"><button data-on="click:cfgSave" class="btn gold fixed">Сохранить для всех</button><button data-on="click:cfgReset" class="btn sm fixed">Сбросить к умолчаниям</button><span class="hint" id="cfg-msg"></span></div>`);
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
  box.innerHTML = `<div class="head"><div><span class="eyebrow">Админ · рабочий кабинет</span><h1 class="mt-6">Управление доступами</h1></div><button data-on="click:staffForm" class="btn gold sm">+ Добавить участника</button></div>
    <div class="notice">Два администратора имеют одинаковые права. Их нельзя удалить или понизить. Любому другому участнику можно назначить несколько ролей — роль «Пользователь» есть у каждого.</div>
    <div class="tbl"><div class="scroll"><table class="staff-tbl"><thead><tr><th>ФИО</th><th>Почта</th><th>Роли</th><th></th></tr></thead><tbody>${staffRows(r.items)}</tbody></table></div></div>`;
}
async function refreshStaff() { if ($('v-home').classList.contains('on')) renderTeam(); else if (S.page === 'access') renderAccess(); }
async function staffSave() {
  const roles = [...$('st-roles').querySelectorAll('input:checked')].map((i) => i.value), msg = $('st-msg');
  try {
    const r = await api('/cabinet/staff', { method: 'POST', body: JSON.stringify({ name: $('st-name').value.trim(), email: $('st-email').value.trim(), roles }) });
    if (!r.ok) { msg.textContent = r.error === 'admin_locked' ? 'Права защищенного администратора изменить нельзя.' : 'Проверьте почту.'; return; }
    toast('Сохранено'); closeModal(); refreshStaff();
  } catch (e) { msg.textContent = 'Не получилось сохранить.'; }
}
async function staffDel(email) {
  if (!confirm(`Убрать доступ у ${email}?`)) return;
  const r = await api('/cabinet/staff?email=' + encodeURIComponent(email), { method: 'DELETE' });
  if (!r.ok) toast('Права защищенного администратора изменить нельзя'); else { toast('Доступ убран'); closeModal(); refreshStaff(); }
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
      ? `<p class="lead">У почты <b>${esc(me.email)}</b> нет доступа к кабинетам.</p><p class="hint">Доступ выдает админ. Приложение открыто как обычно.</p><a class="btn gold w-full mt-14" href="/app/?app=1">В приложение</a>`
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
