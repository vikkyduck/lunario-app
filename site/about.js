/* Лунарио — «Обо мне»: натальная карта */
let digitalMapRequest = 0;
registerReset(() => { digitalMapRequest++; if ($('w-birth-box')) $('w-birth-box').innerHTML = ''; }, { profile: true });
const digitalText = text => esc(String(text ?? '').replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е'));
const digitalErrors = {
  NO_BIRTH: 'Добавьте дату рождения в анкете.', INVALID_DATE_FORMAT: 'Проверьте формат даты рождения.',
  INVALID_DATE: 'Проверьте дату рождения.', FUTURE_BIRTH_DATE: 'Дата рождения не может быть в будущем.',
  EMPTY_NAME: 'Введите хотя бы одну букву.', MIXED_ALPHABETS: 'Используйте один алфавит для официального имени, фамилии и отчества.',
  UNSUPPORTED_CHARACTER: 'Допустимы русские или латинские буквы, пробелы, дефисы и апострофы.',
  TEXT_TOO_LONG: 'В поле должно быть не больше 200 символов.', PROFILE_REQUIRED: 'Выберите способ расчета.',
};
const digitalFields = [['firstName', 'Официальное имя'], ['lastName', 'Фамилия'], ['patronymic', 'Отчество'], ['everydayName', 'Повседневное имя'], ['businessName', 'Название бизнеса']];
function digitalCalculation(n) {
  const terms = n.inputs.join(' + '), steps = n.reduction.steps;
  return (n.letters ? n.letters.map(l => `${esc(l.letter)} = ${l.value}`).join(' · ') + '<br>' : '')
    + esc(terms + (n.inputs.length > 1 ? ' = ' + n.sum : '') + (steps.length > 1 ? ' → ' + steps.slice(1).join(' → ') : ''));
}
function digitalReading(r) {
  const c = r.content;
  return `<details class="card natal-description digital-reading" data-reading="${esc(r.id)}"><summary><span class="digital-number">${r.value}</span><span>${digitalText(r.label)}</span></summary><div class="natal-description-body">
    ${c ? `<h3>${digitalText(c.title)}</h3><h4>Возможный ресурс</h4><p>${digitalText(c.resource)}</p><h4>Возможная трудность</h4><p>${digitalText(c.difficulty)}</p><h4>Ваша задача</h4><p>${digitalText(c.task)}</p>` : `<p>${digitalText(r.message)}</p>`}
    ${r.id === 'D' && r.namespace === 'base9' ? '<p class="hint">Число отношений совпадает с числом судьбы по формуле. Здесь оно рассматривается в контексте отношений.</p>' : ''}
    <details class="digital-trace"><summary>Расчет</summary><p>${r.calculation.normalized ? esc(r.calculation.normalized) + '<br>' : ''}${digitalCalculation(r.calculation)}</p></details>
  </div></details>`;
}
function digitalStar(birth) {
  const points = [['A', 55, 110], ['B', 160, 34], ['C', 265, 110], ['D', 226, 244], ['E', 94, 244], ['F', 160, 150]];
  return `<svg class="digital-star" viewBox="0 0 320 282" role="img" aria-label="Звезда по дате рождения: ${points.map(([k]) => `${k}: ${birth.star[k].value}`).join(', ')}">
    <path d="M160 34L226 244L55 110H265L94 244Z"/><path class="digital-outline" d="M160 34L265 110L226 244H94L55 110Z"/>
    ${points.map(([k, x, y]) => `<circle cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y + 6}">${birth.star[k].value}</text>`).join('')}</svg>`;
}
function renderDigitalMap(data, { formOpen = false, errors = {}, draft } = {}) {
  const box = $('w-birth-box'), input = draft || data.inputs;
  box.innerHTML = `<p class="hint digital-notice">${digitalText(data.notice)}</p>
    <div id="digital-birth-results">${data.birth ? `<details class="card digital-chart"><summary>Звезда ${data.profile.startsWith('base9') ? '1–9' : '1–22'} · ${numDate(data.birth.birthDate)}</summary>
      <div class="natal-description-body"><div class="field"><label for="digital-profile">Способ расчета звезды</label><select id="digital-profile" data-on="change:changeDigitalMapProfile-value"><option value="base9-v1-proposed" ${data.profile.startsWith('base9') ? 'selected' : ''}>Базовые числа 1–9</option><option value="star22-v1-proposed" ${data.profile.startsWith('star22') ? 'selected' : ''}>Звезда 1–22 · только расчет</option></select></div>${digitalStar(data.birth)}</div></details>
      ${data.birthReadings.map(digitalReading).join('')}` : `<p class="msg err">${digitalText(digitalErrors[data.birthError] || 'Не получилось рассчитать дату.')}</p><button class="btn ghost" data-on="click:closeWidget-go-account-openWidget-edit" type="button">Дополнить анкету</button>`}</div>
    <details class="card digital-form" ${formOpen ? 'open' : ''}><summary>Имя и название бизнеса</summary><form id="digital-form" class="natal-description-body" data-on="submit:saveDigitalMap">
      ${digitalFields.map(([key, label]) => `<div class="field"><label for="digital-${key}">${label}</label><input id="digital-${key}" name="${key}" value="${esc(input[key])}" maxlength="200" autocomplete="off" data-on="input:digitalMapDirty" ${errors[key] ? `aria-invalid="true" aria-describedby="digital-error-${key}"` : ''}>${errors[key] ? `<p class="msg err" id="digital-error-${key}">${digitalText(digitalErrors[errors[key]] || 'Проверьте значение.')}</p>` : ''}</div>`).join('')}
      <button class="btn" type="submit">Сохранить и рассчитать</button><p id="digital-form-status" role="status">${errors.expression ? digitalText(digitalErrors[errors.expression]) : ''}</p></form></details>
    <div id="digital-personal-results">${data.nameReadings.map(digitalReading).join('')}
      ${data.expressionStatus === 'insufficient_input' ? '<p class="hint">Для числа экспрессии нужны официальное имя и фамилия. Отчество можно оставить пустым.</p>' : ''}
      ${data.business ? digitalReading(data.business) : ''}</div><p id="digital-status" role="status"></p>`;
}
function digitalMapDirty() {
  const results = $('digital-personal-results'); if (results) results.hidden = true;
  const status = $('digital-form-status'); if (status) status.textContent = 'Изменения еще не сохранены';
}
async function loadDigitalMap() {
  const box = $('w-birth-box'), request = ++digitalMapRequest, context = ctx();
  box.innerHTML = '<p class="hint">Считаем цифровую карту…</p>';
  try {
    const data = await api('/numerology/map');
    if (context.alive() && request === digitalMapRequest) renderDigitalMap(data);
  } catch (e) {
    if (!context.alive() || request !== digitalMapRequest || e.code === 'cancelled') return;
    box.innerHTML = '<p class="msg err">Не получилось загрузить цифровую карту.</p><button class="btn ghost" type="button" data-on="click:loadDigitalMap">Повторить</button>';
  }
}
async function saveDigitalMap(form, profile) {
  const inputs = Object.fromEntries(new FormData(form)), context = ctx(), request = ++digitalMapRequest;
  if (profile) inputs.profile = profile;
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  const controls = [...form.querySelectorAll('input'), $('digital-profile')].filter(Boolean);
  controls.forEach(el => { el.disabled = true; });
  const status = $('digital-form-status'); status.textContent = 'Сохраняем…';
  try {
    const data = await api('/numerology/map', { method: 'POST', body: JSON.stringify(inputs) });
    if (!context.alive() || request !== digitalMapRequest) return;
    renderDigitalMap(data, { formOpen: !profile });
    $('digital-form-status').textContent = 'Сохранено';
  } catch (e) {
    if (!context.alive() || request !== digitalMapRequest || e.code === 'cancelled') return;
    if (e.body?.result) renderDigitalMap(e.body.result, { formOpen: true, errors: e.body.errors || {}, draft: inputs });
    $('digital-form-status').textContent = digitalErrors[e.code] || (e.body?.errors ? 'Проверьте отмеченные поля. Изменения не сохранены.' : 'Не получилось сохранить. Повторите попытку.');
  } finally { if (submit.isConnected) submit.disabled = false; controls.forEach(el => { if (el.isConnected) el.disabled = false; }); }
}
async function changeDigitalMapProfile(profile) {
  // Include typed fields so switching the chart never discards a name draft.
  await saveDigitalMap($('digital-form'), profile);
}
/* ── натальная карта: расчет на сервере, здесь только вывод ── */
let natalCache = null;
registerReset(() => { natalCache = null; }, { profile: true });   /* живет с анкетой: сбрасывается при выходе, не при очистке истории (F05) */
/* ── руна дня: одна на день, тянется на сервере при первом открытии и дальше показывается та же ── */
async function loadDayRune(){
  const box=$('dayrune-box');if(!box||S.preview)return;
  if(!S.day?.runeOpened){ await loadCatalog().catch(()=>{}); await pickCards(box,'rune',1); if(wgOpen!=='dayrune')return; }   /* руну выбирают руками — камень из мешочка */
  box.innerHTML='<p class="hint">Тянем руну…</p>';
  try{
    const [r]=await Promise.all([api('/dayrune',{method:'POST'}),loadCatalog()]);
    box.innerHTML=runesHtml({layout:'one',runes:[r.rune.slug],live:[r.rune],q:'',day:r.day});preparePending();paintThoughts();
    if(S.day){ S.day.rune=r.rune; S.day.runeOpened=true; } paintRuneTile();
  }catch(e){box.innerHTML='<p class="msg err">Не получилось вытянуть руну</p>';}
}
/* строка «Руна дня» на «Сегодня»: до выбора — иконка и общая подпись, после — камень и имя руны (как у карты дня) */
function paintRuneTile(){
  const d=S.day, sub=$('t-runesub'), th=$('t-runethumb'), ico=document.querySelector('[data-feature="dayrune"] .ico'); if(!d)return;
  const opened=!!(d.rune&&d.runeOpened);
  if(sub)sub.textContent=opened?`${d.rune.name}${d.rune.keyword?' · '+d.rune.keyword:''}`:'Одна руна на день';
  if(th){ th.hidden=!(opened&&d.rune.image); if(opened&&d.rune.image){ const img=th.querySelector('img'); const want=d.rune.image; if(img.getAttribute('src')!==want)img.src=want; } }
  if(ico)ico.hidden=opened&&!!d.rune.image;
}
/* знак зодиака тонкой линией из спрайта в index.html — эмодзи ♈…♓ на телефонах цветные и не из палитры */
const zodiacGlyph = (i) => Number.isInteger(i) ? `<svg class="zsym" aria-hidden="true"><use href="#z${i}"/></svg>` : '';
const natalDescriptionTitles = {
  'Солнце': 'Ваш источник жизненных сил',
  'Луна': 'ваш способ восстанавливаться и реагировать',
  'Меркурий': 'ваш способ мышления и стиль общения',
  'Венера': 'ваше понятия о красоте и то, как вы выбираете партнеров',
  'Марс': 'ваш способ действовать и отстаивать границы',
  'Юпитер': 'ваш ориентир для развития, амбиций и зона везения',
  'Сатурн': 'ваше отношение к ответственности, правилам и долгосрочным целям.',
  'Уран': 'как вы понимаете свободу и к каким озарениям способны',
  'Нептун': 'ваш источник интуиции, воображения и идеалов',
  'Хирон': 'ваша уязвимая зона опыта, где преодоление слабостей рождает способность помогать другим',
};
async function loadNatal(){
  const box = $('natal-box');
  try{
    const c = natalCache || await (async () => { const k = ctx(); const n = await api('/natal'); if (!k.alive()) throw cancelledError(); return (natalCache = n); })();
    const dms = (p) => `${zodiacGlyph(p.signIndex)} ${p.deg}°${String(p.min).padStart(2,'0')}′`;
    const planets = c.planets.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.retro ? '<span title="ретроградная">R</span>' : ''}</td></tr>`).join('');
    const points = c.points && c.points.length ? `<h3 class="mt-4">Точки</h3><table class="nt"><thead><tr><th>Точка</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${c.points.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.key === 'node' || p.key === 'snode' ? (p.retro ? '<span title="ретроградный">R</span>' : '<span title="директный">D</span>') : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const houses = c.houses ? `<h3 class="mt-4">Дома · ${esc(c.houses.system)}</h3><table class="nt"><thead><tr><th>Дом</th><th>Куспид</th></tr></thead><tbody>${c.houses.cusps.map((h) => `<tr><td>${h.house}${h.house===1?' · Asc':h.house===10?' · MC':''}</td><td>${dms(h)} <small>${esc(h.signOf)}</small></td></tr>`).join('')}</tbody></table>`
      : `<div class="card mt-3"><p>${!c.timeKnown ? 'Без времени рождения дома, Асцендент и MC не считаются — положения планет по знакам верны' + (c.moonUncertain ? ', а Луна за этот день перешла границу знака: ее знак зависит от времени' : '') + '. ' : ''}${!c.hasPlace ? (c.city ? `Город «${esc(c.city)}» не нашелся в базе — откройте анкету и выберите его из подсказок, по нему считаются дома и часовой пояс. ` : 'Укажите город рождения в аккаунте — по нему считаются дома и часовой пояс. ') : ''}<button data-on="click:closeWidget-go-account-openWidget-edit" class="btn ghost sm mt-3" type="button">Дополнить анкету</button></p></div>`;
    const aspects = c.aspects.length ? `<h3 class="mt-4">Аспекты</h3><div class="hbars mt-2">${c.aspects.map((a) => `<div class="l"><span>${esc(a.aName)} ${a.symbol} ${esc(a.bName)} <small class="faint">${esc(a.name)}</small></span><b>орб ${a.orb}°</b></div>`).join('')}</div>` : '';
    const m = c.meanings || {};
    const labels = new Set(['Возможный ресурс', 'Возможные трудности']);
    const prose = (text) => String(text).split(/\n\s*\n/).filter(Boolean).map(part => labels.has(part.trim())
      ? `<h4>${esc(part.trim())}</h4>` : `<p>${esc(part)}</p>`).join('');
    const descriptions = (m.planets || []).filter(p => p.inSign && natalDescriptionTitles[p.name]);
    box.innerHTML = `<details class="natal-chart"><summary>Натальная карта</summary><div class="natal-chart-body">
      <h3>Планеты</h3><table class="nt"><thead><tr><th>Планета</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${planets}</tbody></table>
      ${points}${houses}${aspects}</div></details>
      <div class="natal-descriptions">${descriptions.map(p => `<details class="card natal-description"><summary>${esc(natalDescriptionTitles[p.name])}</summary><div class="natal-description-body"><h3>${esc(p.inSign.title)}</h3>${prose(p.inSign.text)}</div></details>`).join('')}</div>`;

  }catch(e){ if(e.code==='cancelled')return; box.innerHTML = `<p class="msg err">${e.code==='no_birth' ? 'Укажите дату рождения в анкете — без нее карту не построить.' : 'Не получилось рассчитать карту.'}</p>`; }
}
