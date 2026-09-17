/* Local, persistent demo. No production writes, SMTP or payments. Push works after explicit opt-in.
   node tools/preview.mjs — http://localhost:5038/app/
   Personal demo data lives in .local-preview/data; it survives process restarts.
   Public illustrations are fetched read-only from the existing site. */
import { createServer, request } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { HTML_HEADERS } from '../backend/http/headers.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = join(repo, '.local-preview'); mkdirSync(work, {recursive:true});
mkdirSync(join(work,'data'), {recursive:true});
// Use the same public reference database as production, not a one-city demo fixture.
const citiesPath = process.env.PREVIEW_CITIES_DB || join(repo, 'backend/cities.db');
if (!existsSync(citiesPath)) throw new Error('Нужен полный справочник backend/cities.db. Подготовка описана в README, раздел «Локальный просмотр».');
const cityReference = new DatabaseSync(citiesPath, {readOnly:true});
const cityCount = cityReference.prepare('SELECT COUNT(*) AS n FROM cities').get().n;
cityReference.close();
if(cityCount<2) throw new Error('Справочник городов содержит только демо-запись. Подключите полный backend/cities.db.');
console.log(`Справочник городов: ${cityCount} населённых пунктов`);
const port = Number(process.env.PREVIEW_PORT || 5038), apiPort = port + 1;
const apiBase = `http://127.0.0.1:${apiPort}`;
const child = spawn(process.execPath, [join(repo,'backend/server.mjs')], {
  env: {PATH:process.env.PATH, PORT:String(apiPort), HOST:'127.0.0.1', BASE_PATH:'/app',
    SITE_DIR:join(repo,'site'), DATA_DIR:join(work,'data'), BACKUP_DIR:join(work,'backups'),
    CONTENT_DIR:join(repo,'content'), CITIES_DB:citiesPath, PUBLIC_BASE:`http://localhost:${port}`},
  stdio:['ignore','inherit','inherit'],
});
for (let i=0;i<100;i++) {
  if(child.exitCode!==null) throw new Error('Local backend stopped');
  try{if((await fetch(apiBase+'/app/api/health')).ok) break;}catch{}
  if(i===99) throw new Error('Local backend did not start');
  await delay(100);
}
function proxy(req,res) {
  // Как nginx на сервере: дописываем адрес соединения в конец X-Forwarded-For — по нему приложение считает лимиты
  const fwd = req.headers['x-forwarded-for'], peer = req.socket.remoteAddress || '127.0.0.1';
  const upstream = request(apiBase+req.url,{method:req.method,headers:{...req.headers,host:`127.0.0.1:${apiPort}`,'x-forwarded-for':fwd?`${fwd}, ${peer}`:peer}},r=>{
    const headers={...r.headers,'cache-control':'no-store'};
    if(headers['set-cookie']) headers['set-cookie']=headers['set-cookie'].map(c=>c.replace(/; Secure/gi,''));
    res.writeHead(r.statusCode,headers);r.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Local backend unavailable');});req.pipe(upstream);
}
const publicCache=new Map();
async function publicJson(path) {
  let cached=publicCache.get(path);
  const file=join(work,path.endsWith('catalog')?'public-catalog.json':'public-lunar-days.json');
  if(!cached){
    cached={value:null,promise:null,until:0};
    try{cached.value=JSON.parse(readFileSync(file,'utf8'));}catch{}
    publicCache.set(path,cached);
  }
  if(cached.value&&cached.until>Date.now())return cached.value;
  if(!cached.promise){
    cached.until=Date.now()+30000;
    cached.promise=fetch('https://lunario.online'+path,{signal:AbortSignal.timeout(15000)})
      .then(r=>{if(!r.ok)throw new Error('Public content unavailable');return r.json();})
      .then(value=>{
        cached.value=value;
        try{writeFileSync(file+'.tmp',JSON.stringify(value));renameSync(file+'.tmp',file);}catch(e){console.warn('Public catalogue cache:',e.message);}
        return value;
      }).catch(e=>{console.warn('Public catalogue refresh:',e.message);if(cached.value)return cached.value;throw e;})
      .finally(()=>{cached.promise=null;});
  }
  // Keep the last public reference copy visible while refreshing. Personal data is never cached here.
  if(cached.value){cached.promise.catch(()=>{});return cached.value;}
  return cached.promise;
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://localhost:${port}`);
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method==='GET' && ['/app/api/catalog','/app/api/lunar-days'].includes(url.pathname)) {
      const local=await(await fetch(apiBase+req.url)).json();
      let body=local;
      try {
        const published=await publicJson(url.pathname);
        body=url.pathname.endsWith('lunar-days')?published:{...local,cards:published.cards,runes:published.runes,layouts:published.layouts,lunarDays:published.lunarDays,news:published.news,habitIdeas:published.habitIdeas,askesisIdeas:published.askesisIdeas};
      }catch{}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
    }
    if(url.pathname==='/app/api/me' && req.method==='GET') {
      const tzHeader=req.headers['x-tz']?{'x-tz':String(req.headers['x-tz'])}:{};   /* пояс устройства — как в проде, иначе «сегодня» демо считалось бы по Москве */
      let r=await fetch(apiBase+req.url,{headers:{cookie:req.headers.cookie||'',...tzHeader}});
      const cookies=r.headers.getSetCookie(); const cookie=cookies.length?cookies.map(c=>c.split(';')[0]).join('; '):req.headers.cookie||'';
      let body=await r.json();
      if(r.ok && !body.user.onboarded) {
        // Synthetic local fixture only: never submit the visitor's real profile or consent.
        const profile=await fetch(apiBase+'/app/api/profile',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({name:'Гость',birth:'1990-01-01',city:'Москва',consent:true})});
        if(!profile.ok) throw new Error('Demo profile could not be initialized');
        body=await(await fetch(apiBase+req.url,{headers:{cookie,...tzHeader}})).json();
      }
      body.localPreview=true;
      if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replace(/; Secure/gi,'')));
      res.writeHead(r.status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
    }
    if(url.pathname.startsWith('/app/content/') && req.method==='GET') {
      const upstream=await fetch('https://lunario.online'+url.pathname+url.search,{signal:AbortSignal.timeout(15000)});
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream'});
      res.end(Buffer.from(await upstream.arrayBuffer()));return;
    }
    if(url.pathname.startsWith('/app/api/')) {proxy(req,res);return;}
    if(url.pathname==='/sw.js'){res.writeHead(404);res.end();return;}
    if(['/app/','/app/index.html'].includes(url.pathname)) {
      const html=readFileSync(join(repo,'site/index.html'),'utf8').replace('<title>','<title>Локальный просмотр · ')
        .replace('<body>','<body><div style="position:fixed;z-index:350;top:0;left:0;right:0;text-align:center;font:10px/16px system-ui;background:#201a35;color:#c9bedc;pointer-events:none">Демо-профиль · данные сохраняются только локально</div>');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...HTML_HEADERS});res.end(html);return;   // тот же CSP, что у сервера: превью честно показывает, что заблокируется
    }
    if(url.pathname.startsWith('/app/')) {proxy(req,res);return;}
    if(url.pathname==='/api/event'){res.writeHead(204);res.end();return;}
    const landing=join(dirname(repo),'lunario-landing/site');
    const file=resolve(landing,decodeURIComponent(url.pathname).slice(1)||'index.html');
    if(!file.startsWith(landing+sep)){res.writeHead(403);res.end();return;}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
    let data=readFileSync(file);
    if(extname(file)==='.html')data=data.toString().replaceAll('{{VARIANT}}','A').replaceAll('{{METRIKA_ID_JSON}}','null').replaceAll('{{METRIKA_HEAD}}','');
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(data);
  }catch(e){console.error(e.message);res.writeHead(502);res.end('Local preview could not load this resource');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Persistent local preview: http://localhost:${port}/app/`));
// Local reminders use this preview's database and keys. No enabled reminders means no sends.
let reminderWorker=null;
function deliverLocalReminders(){
  if(reminderWorker)return;
  reminderWorker=spawn(process.execPath,[join(repo,'backend/send-daily.mjs')],{
    env:{PATH:process.env.PATH,DATA_DIR:join(work,'data'),CONTENT_DIR:join(repo,'content')},stdio:['ignore','inherit','inherit']});
  reminderWorker.on('exit',()=>{reminderWorker=null;});
}
const reminderTimer=setInterval(deliverLocalReminders,60000);
function stop(){clearInterval(reminderTimer);reminderWorker?.kill('SIGTERM');server.close();child.kill('SIGTERM');}

process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',()=>{clearInterval(reminderTimer);reminderWorker?.kill('SIGTERM');server.close();});
