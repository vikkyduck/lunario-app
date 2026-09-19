import {CONSTELLATIONS} from './constellations.js?v=93';
import {MOSCOW, observer, visibleSky} from './sky-model.js?v=93';

const canvas=document.getElementById('sky');
const ctx=canvas?.getContext('2d');
const motion=matchMedia('(prefers-reduced-motion: reduce)');
let place=MOSCOW, timer, busy=false, measuredAt=0, permission, width=0, height=0, generation=0, profile=null;
/* Откуда берем место — по убыванию приоритета: город, который человек указал сам (хранится только в этом браузере) →
   местоположение устройства, если человек сам нажал «Определить» или доступ уже был дан раньше → город из анкеты →
   грубая точка по часовому поясу → Москва. Диалог геолокации на загрузке не показываем: только по нажатию. */
const TZ_PLACES={'Europe/Kaliningrad':[54.71,20.51,'Калининград'],'Europe/Moscow':[55.76,37.62,'Москва'],'Europe/Kirov':[58.6,49.66,'Киров'],
  'Europe/Volgograd':[48.71,44.51,'Волгоград'],'Europe/Astrakhan':[46.35,48.04,'Астрахань'],'Europe/Saratov':[51.53,46.03,'Саратов'],
  'Europe/Ulyanovsk':[54.31,48.4,'Ульяновск'],'Europe/Samara':[53.2,50.15,'Самара'],'Asia/Yekaterinburg':[56.84,60.6,'Екатеринбург'],
  'Asia/Omsk':[54.99,73.37,'Омск'],'Asia/Novosibirsk':[55.03,82.92,'Новосибирск'],'Asia/Barnaul':[53.35,83.77,'Барнаул'],
  'Asia/Tomsk':[56.5,84.97,'Томск'],'Asia/Novokuznetsk':[53.76,87.14,'Новокузнецк'],'Asia/Krasnoyarsk':[56.01,92.87,'Красноярск'],
  'Asia/Irkutsk':[52.29,104.28,'Иркутск'],'Asia/Chita':[52.03,113.5,'Чита'],'Asia/Yakutsk':[62.03,129.73,'Якутск'],
  'Asia/Vladivostok':[43.12,131.89,'Владивосток'],'Asia/Magadan':[59.56,150.8,'Магадан'],'Asia/Sakhalin':[46.96,142.74,'Южно-Сахалинск'],
  'Asia/Kamchatka':[53.02,158.65,'Петропавловск-Камчатский'],'Asia/Anadyr':[64.73,177.5,'Анадырь'],'Europe/Minsk':[53.9,27.57,'Минск'],
  'Europe/Kiev':[50.45,30.52,'Киев'],'Europe/Kyiv':[50.45,30.52,'Киев'],'Asia/Almaty':[43.24,76.93,'Алматы'],'Asia/Tashkent':[41.3,69.24,'Ташкент'],
  'Asia/Bishkek':[42.87,74.59,'Бишкек'],'Asia/Yerevan':[40.18,44.51,'Ереван'],'Asia/Tbilisi':[41.69,44.8,'Тбилиси'],'Asia/Baku':[40.41,49.87,'Баку'],
  'Europe/Chisinau':[47.01,28.86,'Кишинев'],'Asia/Dushanbe':[38.56,68.77,'Душанбе'],'Asia/Ashgabat':[37.96,58.33,'Ашхабад'],'Europe/Riga':[56.95,24.11,'Рига'],
  'Europe/Vilnius':[54.69,25.28,'Вильнюс'],'Europe/Tallinn':[59.44,24.75,'Таллин'],'Asia/Jerusalem':[31.77,35.22,'Иерусалим'],'Europe/Istanbul':[41.01,28.98,'Стамбул'],
  'Asia/Dubai':[25.2,55.27,'Дубай'],'Europe/Belgrade':[44.79,20.46,'Белград'],'Europe/Berlin':[52.52,13.4,'Берлин'],'Europe/Stockholm':[59.33,18.07,'Стокгольм']};
function savedCity(){ try{ const c=JSON.parse(localStorage.getItem('lun_sky_place')||'null'); return c&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)?{lat:c.lat,lon:c.lon,name:c.name||'',source:'city'}:null; }catch{ return null; } }
function tzPlace(){ try{ const tz=Intl.DateTimeFormat().resolvedOptions().timeZone, p=TZ_PLACES[tz]; return p?{lat:p[0],lon:p[1],name:p[2],source:'tz'}:null; }catch{ return null; } }
function fallbackPlace(){ return savedCity() || (profile&&Number.isFinite(profile.lat)&&Number.isFinite(profile.lon)?{lat:profile.lat,lon:profile.lon,name:profile.name||'',source:'profile'}:null) || tzPlace() || MOSCOW; }

function status(text) {
  document.querySelectorAll('[data-sky-place]').forEach(el=>el.textContent=text);
  document.querySelectorAll('.sky-location-control').forEach(el=>{el.disabled=busy;el.setAttribute('aria-busy',String(busy));});
}
function placeLabel() {
  if(place.source==='device') return 'По вашему местоположению';
  if(place.source==='city') return `${place.name} · вы указали`;
  if(place.source==='profile') return `${place.name||'Город из анкеты'} · по анкете`;
  if(place.source==='tz') return `${place.name} · по часовому поясу`;
  return 'Москва · место не определено';
}
function draw() {
  if(!ctx || document.hidden) return;
  const dpr=Math.min(devicePixelRatio || 1,2);
  width=canvas.clientWidth; height=canvas.clientHeight;
  if(!width || !height) return;
  if(canvas.width!==Math.round(width*dpr) || canvas.height!==Math.round(height*dpr)) {
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const now=Date.now(), figures=visibleSky(CONSTELLATIONS,place,now);
  const light=document.documentElement.dataset.theme==='light' && !document.body.classList.contains('hello');
  const radius=Math.hypot(width/2,height/2);
  const project=s=>{
    const r=(1-s.altitude/90)*radius, a=s.azimuth*Math.PI/180;
    return {...s,x:width/2-r*Math.sin(a),y:height/2-r*Math.cos(a),edge:Math.min(1,s.altitude/10)};
  };
  for(const c of figures) {
    const stars=c.stars.map(s=>s && project(s));
    ctx.lineWidth=.85;ctx.strokeStyle=light?'rgba(63,49,106,.38)':'rgba(240,215,154,.28)';ctx.beginPath();
    for(const [a,b] of c.edges) if(stars[a] && stars[b]) {
      ctx.moveTo(stars[a].x,stars[a].y);ctx.lineTo(stars[b].x,stars[b].y);
    }
    ctx.stroke();
    for(const s of stars) {
      if(!s || s.x< -20 || s.x>width+20 || s.y< -20 || s.y>height+20) continue;
      const r=Math.max(.8,2.2-s.mag*.27), a=Math.min(.95,.82-s.mag*.08)*s.edge;
      const glow=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,r*7);
      glow.addColorStop(0,`rgba(255,251,232,${a})`);
      glow.addColorStop(.25,`rgba(240,215,154,${a*.22})`);
      glow.addColorStop(1,'rgba(217,184,104,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(s.x,s.y,r*7,0,2*Math.PI);ctx.fill();
      ctx.fillStyle=light?`rgba(63,49,106,${a})`:`rgba(255,251,232,${a})`;ctx.beginPath();ctx.arc(s.x,s.y,r*.65,0,2*Math.PI);ctx.fill();
    }
  }
  // Only the existing real-star catalogue is rendered: no random constellations or meteors.
  canvas.dataset.locationSource=place.source;
  canvas.dataset.constellations=figures.map(c=>c.name).join('|');
  canvas.classList.add('on');
}
function resume() {
  clearTimeout(timer);draw();
  if(!document.hidden) timer=setTimeout(resume,motion.matches?60000:15000);
}
async function locate(manual=false) {
  if(busy)return;
  if(!navigator.geolocation){place=fallbackPlace();status(placeLabel());resume();return;}
  const request=++generation;
  busy=true;status('Определяем местоположение…');
  await new Promise(resolve=>{
    const done=(coords,error)=>{
      if(request!==generation){resolve();return;}
      const got=observer(coords); place=got.source==='device'?got:fallbackPlace(); busy=false;measuredAt=Date.now();
      if(got.source==='device'){ try{ localStorage.removeItem('lun_sky_place'); }catch{} }
      status(error && manual ? 'Нет доступа к месту · '+placeLabel() : placeLabel());
      resume();resolve();
    };
    try { navigator.geolocation.getCurrentPosition(p=>done(p.coords),()=>done(null,true),{
      enableHighAccuracy:false,timeout:8000,maximumAge:300000
    }); } catch { done(null,true); }
  });
}
// Координаты устройства живут только в памяти страницы: ни API, ни аналитика, ни хранилище их не получают.
// Город, выбранный вручную, — в localStorage этого браузера (название и координаты города, не человека).
function setCity(c){ if(!c||!Number.isFinite(c.lat)||!Number.isFinite(c.lon))return; generation++;busy=false;
  try{ localStorage.setItem('lun_sky_place',JSON.stringify({name:c.name||'',lat:c.lat,lon:c.lon})); }catch{}
  place={lat:c.lat,lon:c.lon,name:c.name||'',source:'city'}; status(placeLabel()); resume(); }
function useProfile(){ generation++;busy=false; try{ localStorage.removeItem('lun_sky_place'); }catch{} place=fallbackPlace(); status(placeLabel()); resume(); }
function setProfile(p){ profile=p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)?{lat:p.lat,lon:p.lon,name:p.name||''}:null; if(place.source!=='device'&&place.source!=='city'){ place=fallbackPlace(); status(placeLabel()); resume(); } }
function describe(){ return {source:place.source,name:place.name||'',label:placeLabel(),hasProfile:!!profile,geolocation:!!navigator.geolocation}; }
window.LunarioSky={locate,refresh:resume,setCity,useProfile,setProfile,describe};
place=fallbackPlace();status(placeLabel());resume();
window.addEventListener('resize',draw);
motion.addEventListener('change',resume);
canvas?.addEventListener('contextlost',e=>e.preventDefault());
canvas?.addEventListener('contextrestored',resume);
document.addEventListener('visibilitychange',()=>{
  resume();
  if(!document.hidden && (permission?.state==='granted' || (!permission && place.source==='device')) && Date.now()-measuredAt>300000)locate();
});
try {
  permission=await navigator.permissions?.query({name:'geolocation'});
  if(permission) permission.addEventListener('change',()=>{
    if(permission.state==='granted') locate();
    else {generation++;busy=false;place=fallbackPlace();status(placeLabel());resume();}
  });
  /* без нажатия человека диалог не показываем: уточняем по устройству, только если доступ уже был дан раньше */
  if(permission?.state==='granted' && !savedCity()) locate();
} catch {}
