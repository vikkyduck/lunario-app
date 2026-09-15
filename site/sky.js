import {CONSTELLATIONS} from './constellations.js?v=25';
import {MOSCOW, observer, visibleSky} from './sky-model.js?v=25';

const canvas=document.getElementById('sky');
const ctx=canvas?.getContext('2d');
const motion=matchMedia('(prefers-reduced-motion: reduce)');
let place=MOSCOW, timer, busy=false, measuredAt=0, permission, width=0, height=0, generation=0;

function status(text) {
  document.querySelectorAll('[data-sky-place]').forEach(el=>el.textContent=text);
  document.querySelectorAll('.sky-location-control').forEach(el=>{el.disabled=busy;el.setAttribute('aria-busy',String(busy));});
}
function placeLabel() {
  return place.source==='device' ? 'По вашему местоположению · обновить' : 'Москва · определить моё местоположение';
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
  if(!navigator.geolocation){place=MOSCOW;status(placeLabel());resume();return;}
  const request=++generation;
  busy=true;status('Определяем местоположение…');
  await new Promise(resolve=>{
    const done=(coords,error)=>{
      if(request!==generation){resolve();return;}
      place=observer(coords);busy=false;measuredAt=Date.now();
      status(error && manual ? 'Нет доступа к месту · показываем Москву' : placeLabel());
      resume();resolve();
    };
    try { navigator.geolocation.getCurrentPosition(p=>done(p.coords),()=>done(null,true),{
      enableHighAccuracy:false,timeout:8000,maximumAge:300000
    }); } catch { done(null,true); }
  });
}
// Coordinates stay in this page's memory: no API, analytics or persistent storage receives them.
window.LunarioSky={locate,refresh:resume};
status(placeLabel());resume();
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
    else {generation++;busy=false;place=MOSCOW;status(placeLabel());resume();}
  });
  if(permission?.state!=='denied')locate();
} catch { locate(); }
