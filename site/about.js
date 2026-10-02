/* Лунарио — «Обо мне»: натальная карта */
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
