/* Лунарио — «Обо мне»: натальная карта */
/* ── натальная карта: расчет на сервере, здесь только вывод ── */
let natalCache = null;
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
async function loadNatal(){
  const box = $('natal-box');
  try{
    const c = natalCache || (natalCache = await api('/natal'));
    const dms = (p) => `${zodiacGlyph(p.signIndex)} ${p.deg}°${String(p.min).padStart(2,'0')}′`;
    const planets = c.planets.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.retro ? '<span title="ретроградная">R</span>' : ''}</td></tr>`).join('');
    const points = c.points && c.points.length ? `<h3 class="mt-4">Точки</h3><table class="nt"><thead><tr><th>Точка</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${c.points.map((p) => `<tr><td>${p.symbol} ${esc(p.name)}${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</td><td>${dms(p)} <small>${esc(p.signOf)}</small></td><td>${p.house ? p.house : '—'}</td><td>${p.key === 'node' || p.key === 'snode' ? (p.retro ? '<span title="ретроградный">R</span>' : '<span title="директный">D</span>') : ''}</td></tr>`).join('')}</tbody></table>` : '';
    const houses = c.houses ? `<h3 class="mt-4">Дома · ${esc(c.houses.system)}</h3><table class="nt"><thead><tr><th>Дом</th><th>Куспид</th></tr></thead><tbody>${c.houses.cusps.map((h) => `<tr><td>${h.house}${h.house===1?' · Asc':h.house===10?' · MC':''}</td><td>${dms(h)} <small>${esc(h.signOf)}</small></td></tr>`).join('')}</tbody></table>`
      : `<div class="card mt-3"><p>${!c.timeKnown ? 'Без времени рождения дома, Асцендент и MC не считаются — положения планет по знакам верны' + (c.moonUncertain ? ', а Луна за этот день перешла границу знака: ее знак зависит от времени' : '') + '. ' : ''}${!c.hasPlace ? (c.city ? `Город «${esc(c.city)}» не нашелся в базе — откройте анкету и выберите его из подсказок, по нему считаются дома и часовой пояс. ` : 'Укажите город рождения в аккаунте — по нему считаются дома и часовой пояс. ') : ''}<button data-on="click:closeWidget-go-account-openWidget-edit" class="btn ghost sm mt-3" type="button">Дополнить анкету</button></p></div>`;
    const aspects = c.aspects.length ? `<h3 class="mt-4">Аспекты</h3><div class="hbars mt-2">${c.aspects.map((a) => `<div class="l"><span>${esc(a.aName)} ${a.symbol} ${esc(a.bName)} <small class="faint">${esc(a.name)}</small></span><b>орб ${a.orb}°</b></div>`).join('')}</div>` : '';
    const sun = c.planets[0], moon = c.planets[1], m = c.meanings || {};
    /* резюме по правилам — выводы из значений (natal-texts.mjs), наверху; подробные значения — после таблиц, только там, где текст есть */
    const summary = (m.summary || []).length ? `<div class="card mt-3 natal-summary"><p class="eyebrow">Резюме</p>${m.summary.map((x) => `<p class="mt-2"><b>${esc(x.title)}</b> — ${esc(x.gist)}</p>`).join('')}</div>` : '';
    const block = (title, items) => items.length ? `<h3 class="mt-4">${title}</h3><div class="list">${items.map((x) => `<div class="item"><b>${esc(x.title)}</b><p class="mt-1">${esc(x.text)}</p></div>`).join('')}</div>` : '';
    const inSigns = (m.planets || []).flatMap((p) => [p.inSign, p.inHouse].filter(Boolean));
    const inPoints = (m.points || []).map((p) => p.meaning).filter(Boolean);
    const inAspects = (m.aspects || []).map((a) => a.meaning).filter(Boolean);
    box.innerHTML = `<div class="card sec"><p class="eyebrow">Западная традиция · тропический зодиак${c.houses ? ' · ' + esc(c.houses.system) : ''}</p>
        <p class="t2">☉ Солнце ${esc(sun.signIn)} · ☽ Луна ${esc(moon.signIn)}${c.houses ? ` · Asc ${esc(c.houses.asc.signIn)}` : ''}</p></div>
      ${summary}
      <h3 class="mt-4">Планеты</h3><table class="nt"><thead><tr><th>Планета</th><th>Положение</th><th>Дом</th><th></th></tr></thead><tbody>${planets}</tbody></table>
      ${points}${houses}${aspects}
      ${block('Планеты в знаках и домах', inSigns)}${block('Асцендент и точки', inPoints)}${block('Что значат аспекты', inAspects)}`;   /* строка с датой, координатами и UTC и сноска о точности эфемерид сняты (решение владелицы 20.09) */
  }catch(e){ box.innerHTML = `<p class="msg err">${e.code==='no_birth' ? 'Укажите дату рождения в анкете — без нее карту не построить.' : 'Не получилось рассчитать карту.'}</p>`; }
}
