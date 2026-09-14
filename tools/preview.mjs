/* Local, persistent demo. No production writes, SMTP, payments or push delivery.
   node tools/preview.mjs — http://localhost:5038/app/
   Personal demo data lives in .local-preview/data; it survives process restarts.
   Public illustrations are fetched read-only from the existing site. */
import { createServer, request } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = join(repo, '.local-preview'); mkdirSync(work, {recursive:true});
mkdirSync(join(work,'data'), {recursive:true});
const citiesPath = join(work, 'cities.db');
if (!existsSync(citiesPath)) {
  const cities = new DatabaseSync(citiesPath);
  cities.exec(`CREATE TABLE cities(name TEXT,region TEXT,country TEXT,lat REAL,lon REAL,tz TEXT,pop INTEGER,norm TEXT,w2 TEXT,alt TEXT);
    INSERT INTO cities VALUES('Москва','Москва','Россия',55.7558,37.6173,'Europe/Moscow',13000000,'москва','','moscow');`);
  cities.close();
}
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
  const upstream = request(apiBase+req.url,{method:req.method,headers:{...req.headers,host:`127.0.0.1:${apiPort}`}},r=>{
    const headers={...r.headers,'cache-control':'no-store'};
    if(headers['set-cookie']) headers['set-cookie']=headers['set-cookie'].map(c=>c.replace(/; Secure/gi,''));
    res.writeHead(r.statusCode,headers);r.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Local backend unavailable');});req.pipe(upstream);
}
const publicCache=new Map();
async function publicJson(path) {
  if(!publicCache.has(path)) publicCache.set(path,fetch('https://lunario.online'+path,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error('Public content unavailable');return r.json();}).catch(e=>{publicCache.delete(path);throw e;}));
  return publicCache.get(path);
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
        body=url.pathname.endsWith('lunar-days')?published:{...local,cards:published.cards,runes:published.runes,layouts:published.layouts,lunarDays:published.lunarDays};
      }catch{}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
    }
    if(url.pathname==='/app/api/me' && req.method==='GET') {
      let r=await fetch(apiBase+req.url,{headers:{cookie:req.headers.cookie||''}});
      const cookies=r.headers.getSetCookie(); const cookie=cookies.length?cookies.map(c=>c.split(';')[0]).join('; '):req.headers.cookie||'';
      let body=await r.json();
      if(r.ok && !body.user.onboarded) {
        // Synthetic local fixture only: never submit the visitor's real profile or consent.
        const profile=await fetch(apiBase+'/app/api/profile',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({name:'Гость',birth:'1990-01-01',city:'Москва',consent:true})});
        if(!profile.ok) throw new Error('Demo profile could not be initialized');
        body=await(await fetch(apiBase+req.url,{headers:{cookie}})).json();
      }
      if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replace(/; Secure/gi,'')));
      res.writeHead(r.status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
    }
    if(url.pathname.startsWith('/app/content/') && req.method==='GET') {
      const upstream=await fetch('https://lunario.online'+url.pathname+url.search,{signal:AbortSignal.timeout(15000)});
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream'});
      res.end(Buffer.from(await upstream.arrayBuffer()));return;
    }
    if(url.pathname.startsWith('/app/api/')) {proxy(req,res);return;}
    if(url.pathname==='/sw.js'||url.pathname==='/app/sw.js'){res.writeHead(404);res.end();return;}
    if(['/app/','/app/index.html'].includes(url.pathname)) {
      const html=readFileSync(join(repo,'site/index.html'),'utf8').replace('<title>','<title>Локальный просмотр · ')
        .replace('<body>','<body><div style="position:fixed;z-index:350;top:0;left:0;right:0;text-align:center;font:10px/16px system-ui;background:#201a35;color:#c9bedc;pointer-events:none">Демо-профиль · данные сохраняются только локально</div>');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
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
function stop(){server.close();child.kill('SIGTERM');}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',()=>server.close());
