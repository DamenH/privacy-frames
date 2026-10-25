import {webManifest,manifestURL} from './pwa.js';
import {getApp,listApps,putApp,deleteApp} from './store.js';
import {validateManifest,validateMarkup,digest,mime,LIMITS} from './package.js';
import {serialize} from 'parse5';
import {applicationURL,applicationIdentity,resourceURL,publicAlias} from './runtime-url.js';
const BASE=new URL('./',self.location.href);
const trustedFiles=['index.html','manager.js','host.css','guard.js','config.json','report.html','connect.html','connect.js','install-worker.js','pwa-192.png','pwa-512.png'];
function isManagerURL(input){try{const u=new URL(input);return u.origin===BASE.origin&&!u.search&&(__HOST_ROLE__==='runtime'?[BASE.pathname+'connect.html']:[BASE.pathname,BASE.pathname+'index.html',BASE.pathname+'connect.html']).includes(u.pathname);}catch{return false;}}
const BOOT='pf-trusted-bootstrap-'+__BUILD_ID__;
// Management roles are issued only to trusted document loads, then bound to the
// browser client ID. Changing a URL or supplying a claimed role is insufficient.
const ROLES='pf-management-clients-v1';
const roleURL=id=>new URL('__host-client/'+encodeURIComponent(id),BASE).href;
async function grantManagement(id){if(id)await(await caches.open(ROLES)).put(roleURL(id),new Response('manager'));}
async function hasManagement(id){return !!id&&!!await(await caches.open(ROLES)).match(roleURL(id));}
const events=[];
function record(kind,url,method){events.push({kind,url,method,time:new Date().toISOString()});if(events.length>300)events.shift();}
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(BOOT);await cache.addAll(trustedFiles.map(p=>new URL(p,BASE)));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const upgrading=__HOST_ROLE__==='manager'&&(await caches.keys()).some(name=>name.startsWith('pf-trusted-bootstrap-')&&name!==BOOT);
 await self.clients.claim();
 // Refresh only trusted manager documents after an upgrade, so an old cached
 // manager cannot retain the removed popup flow or obsolete runtime hostname.
 if(upgrading)for(const client of await self.clients.matchAll({type:'window'}))if(isManagerURL(client.url)&&client.url!==new URL('connect.html',BASE).href)await client.navigate(client.url);
})()));
function policy(){return "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; manifest-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";}
const headers={'Content-Security-Policy':policy(),'X-DNS-Prefetch-Control':'off','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(self), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), attribution-reporting=(), browsing-topics=(), interest-cohort=()','X-Content-Type-Options':'nosniff'};
function response(body,type='text/html',status=200){return new Response(body,{status,headers:{...headers,'Content-Type':type}});}
async function runtimeIdentity(url){
 const key=applicationIdentity(url,BASE);if(!key)return null;
 if(key.length!==11)return key;
 const matches=(await listApps()).filter(app=>publicAlias(app.id)===key);
 return matches.length===1?matches[0].id:null;
}
function alias(app,input,base){if(String(input).startsWith('#'))return input;try{const url=new URL(input,base),hash=url.hash;url.hash='';const match=app.resources.find(resource=>resource.url===url.href);return match?resourceURL(app,match.path,BASE).href+hash:input;}catch{return input;}}
function css(app,text,base){return text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi,(whole,double,single,plain)=>{const value=double??single??plain,mapped=alias(app,value,base);return mapped===value?whole:`url(${JSON.stringify(mapped)})`;}).replace(/(@import\s+)(["'])(.*?)\2/gi,(whole,rule,quote,value)=>rule+JSON.stringify(alias(app,value,base)));}
function prepared(app){
 const bytes=app.resources.find(r=>r.path===app.manifest.entry).bytes;
 const ast=validateMarkup(new TextDecoder().decode(bytes),{document:true,initial:true});
 const html=ast.childNodes.find(n=>n.tagName==='html'),head=html.childNodes.find(n=>n.tagName==='head'),body=html.childNodes.find(n=>n.tagName==='body');
 const scripts=[];
 function strip(node){node.childNodes=(node.childNodes||[]).filter(n=>{if(n.tagName==='script'){const src=n.attrs.find(a=>a.name==='src')?.value,type=n.attrs.find(a=>a.name==='type')?.value;if(!src)throw new Error('Missing script resource');const url=new URL(src,applicationURL(app,BASE)),original=new URL(src,app.source);const match=app.resources.find(r=>resourceURL(app,r.path,BASE).href===url.href||r.url===original.href);if(!match||!['','module','text/javascript','application/javascript'].includes(type||''))throw new Error('Script must be packaged JavaScript');scripts.push({src:resourceURL(app,match.path,BASE).href,type:type||''});return false;}
  for(const attr of n.attrs||[]){if(['src','href','poster'].includes(attr.name))attr.value=alias(app,attr.value,app.source);if(attr.name==='style')attr.value=css(app,attr.value,app.source);}
  if(n.tagName==='style')for(const child of n.childNodes||[])if(child.nodeName==='#text')child.value=css(app,child.value,app.source);
  strip(n);return true;});if(node.content)strip(node.content);}
 strip(head);strip(body);return {head:serialize(head),body:serialize(body),scripts,source:app.source,aliases:app.resources.map(resource=>[resource.url,resourceURL(app,resource.path,BASE).href]),manifestURL:manifestURL(app,BASE).href,serviceWorker:app.preparation?.serviceWorker||null};
}
async function validatePackage(pkg){
 pkg.manifest=validateManifest(pkg.manifest);const identity=pkg.manifest.id+'-'+(await digest(new TextEncoder().encode(pkg.source)));if(pkg.id!==identity)throw new Error('Installation identity mismatch');if(!Array.isArray(pkg.resources)||pkg.resources.length!==pkg.manifest.resources.length)throw new Error('Incomplete package');let bytes=0;
 for(const path of pkg.manifest.resources){const matches=pkg.resources.filter(r=>r.path===path);if(matches.length!==1)throw new Error('Duplicate or missing resource');const r=matches[0];if(!(r.bytes instanceof ArrayBuffer))throw new Error('Invalid resource bytes');bytes+=r.bytes.byteLength;if(bytes>LIMITS.bytes||await digest(r.bytes)!==r.sha256)throw new Error('Resource integrity mismatch');if(path.endsWith('.html'))validateMarkup(new TextDecoder().decode(r.bytes),{document:true,initial:true});}
 if((await listApps()).some(app=>app.id!==pkg.id&&publicAlias(app.id)===publicAlias(pkg.id)))throw new Error('Installation alias collision');
 prepared(pkg);return pkg;
}
let managementQueue=Promise.resolve();
self.addEventListener('message',event=>{
 const port=event.ports[0];if(!port)return;
 const operation=managementQueue.then(async()=>{try{
  const client=await self.clients.get(event.source?.id);
  if(!client||!isManagerURL(client.url)||!await hasManagement(client.id))throw new Error('Management client not authorized');
  const {operation,payload}=event.data||{};let value;
  if(operation==='install'){const app=await validatePackage(payload);const windows=await self.clients.matchAll({type:'window'});if((await Promise.all(windows.map(c=>runtimeIdentity(c.url)))).includes(app.id))throw new Error('Close application windows before replacing an installation');
   for(const stage of app.preparation?.caches||[]){if(typeof stage.name!=='string'||stage.name.length>1000||!Array.isArray(stage.urls))throw new Error('Invalid installation cache');const cache=await caches.open(`pf:${app.id}:`+stage.name);for(const url of stage.urls){const resource=app.resources.find(r=>r.url===url);if(!resource)throw new Error('Cache contains an uninstalled resource');await cache.put(new Request(url),new Response(resource.bytes,{headers:{'Content-Type':resource.contentType||mime(resource.path)}}));}}
   app.installedAt=new Date().toISOString();await putApp(app);value={id:app.id};}
  else if(operation==='list')value=(await listApps()).map(a=>({id:a.id,manifest:a.manifest,source:a.source,installedAt:a.installedAt,size:a.size}));
  else if(operation==='remove'){const windows=await self.clients.matchAll({type:'window'});if((await Promise.all(windows.map(c=>runtimeIdentity(c.url)))).includes(payload))throw new Error('Close application windows before uninstalling');await deleteApp(payload);value=true;}
  else if(operation==='events')value=events;
  else throw new Error('Unknown operation');port.postMessage({ok:true,value});
 }catch(e){port.postMessage({ok:false,error:String(e.message||e)})}});
 managementQueue=operation.catch(()=>{});event.waitUntil(operation);
});
self.addEventListener('fetch',event=>{
 event.respondWith((async()=>{
  const req=event.request,url=new URL(req.url),client=event.clientId?await self.clients.get(event.clientId):null;
  // Fragments are application-local routing state, including on reload. They do
  // not select a different installed document or authorize a resource request.
  url.hash='';
  // Browsers may fetch manifests/icons without an application client. These
  // fixed routes expose only public installation metadata and captured icons.
  const publicPath=url.origin===BASE.origin&&url.pathname.startsWith(BASE.pathname)?url.pathname.slice(BASE.pathname.length):'';
  const publicRoute=publicPath.match(/^([A-Za-z0-9_-]{11})\/(__manifest\.webmanifest|__icon\/(\d+))$/);
  if(publicRoute&&req.method==='GET'&&!url.search&&req.mode!=='navigate'){
   const apps=(await listApps()).filter(app=>publicAlias(app.id)===publicRoute[1]);
   if(apps.length===1){
    const app=apps[0];
    if(publicRoute[2]==='__manifest.webmanifest')return response(JSON.stringify(webManifest(app,BASE)),'application/manifest+json');
    const resource=app.resources[Number(publicRoute[3])];
    const admitted=webManifest(app,BASE).icons.some(icon=>new URL(icon.src,BASE).href===url.href);
    if(admitted&&resource)return response(resource.bytes,resource.contentType);
   }
   return Response.error();
  }
  if(req.method==='GET'&&!url.search&&['pwa-192.png','pwa-512.png'].some(path=>url.href===new URL(path,BASE).href)&&req.mode!=='navigate')return (await caches.open(BOOT)).match(url.href)||Response.error();
  const id=await runtimeIdentity(client?.url)||((req.mode==='navigate')?await runtimeIdentity(url.href):null);
  const isTrusted=url.origin===BASE.origin&&trustedFiles.some(p=>url.href===new URL(p,BASE).href);
  const manager=isManagerURL(client?.url)&&await hasManagement(client?.id);
  const readOnlyHost=client?.url===new URL('report.html',BASE).href||__HOST_ROLE__==='runtime'&&[BASE.href,new URL('index.html',BASE).href].includes(client?.url);
  const managerNavigation=req.mode==='navigate'&&isManagerURL(url.href);
  const hostDocument=req.mode==='navigate'&&(url.href===new URL('report.html',BASE).href||__HOST_ROLE__==='runtime'&&[BASE.href,new URL('index.html',BASE).href].includes(url.href));
  if(!id&&managerNavigation)await grantManagement(event.resultingClientId);
  if(req.method==='GET'&&url.href===BASE.href&&!id&&(managerNavigation||manager||hostDocument)){return (await caches.open(BOOT)).match(new URL('index.html',BASE).href)||Response.error();}
  if(isTrusted&&req.method==='GET'&&((!id&&(manager||readOnlyHost||managerNavigation||hostDocument))||url.href===new URL('guard.js',BASE).href&&id)){
   const cached=await(await caches.open(BOOT)).match(url.href);return cached||Response.error();
  }
  if(!id){
   if(__HOST_ROLE__!=='runtime'&&manager&&new URL(client.url).pathname!==new URL('connect.html',BASE).pathname&&req.method==='GET'&&['http:','https:'].includes(url.protocol))return fetch(req);
   record('blocked-unmanaged',req.url,req.method);return Response.error();
  }
  const app=await getApp(id);if(!app)return response('<h1>Application not installed</h1>','text/html',404);
  const legacy=(req.mode==='navigate'?url.href:client?.url)?.startsWith(new URL('run/',BASE).href);
  const entry=legacy?new URL(`run/${id}/${app.manifest.entry}`,BASE):applicationURL(app,BASE);
  if(req.mode==='navigate'){
   // Any attempt to use a different document is refused. Bootstrap contains no untrusted markup.
   if(!legacy&&req.method==='GET'&&url.origin===entry.origin&&!url.search){
    const parts=url.pathname.slice(BASE.pathname.length).split('/');
    if(parts[0]===publicAlias(app.id)&&(parts.length<=2||parts.length===3&&parts[2]===''||parts.length===3&&parts[2]===app.manifest.entry)&&url.href!==entry.href)return new Response(null,{status:302,headers:{Location:entry.href}});
   }
   if(url.href!==entry.href||req.method!=='GET'){record('blocked-navigation',req.url,req.method);return Response.error();}
   const script=new URL('guard.js',BASE).href;
   return response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.manifest.name.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}</title><link rel="manifest" href="${manifestURL(app,BASE).href}"></head><body><script src="${script}" data-installation="${app.id}"></script></body></html>`);
  }
  if(url.origin===entry.origin&&url.pathname===entry.pathname&&url.search==='?host-content=1'&&req.method==='GET')return response(JSON.stringify(prepared(app)),'application/json');
  if(req.method==='GET'){
   const original=app.preparation?.ended&&url.origin===BASE.origin?new URL(url.pathname+url.search,new URL(app.source).origin).href:null;
   const resource=app.resources.find(r=>resourceURL(app,r.path,BASE).href===url.href||new URL(`run/${id}/${r.path}`,BASE).href===url.href||r.url===url.href||original&&r.url===original);
   if(resource){record('installed',req.url,req.method);return response(resource.path.endsWith('.css')?css(app,new TextDecoder().decode(resource.bytes),resource.url):resource.bytes,resource.contentType||mime(resource.path));}
  }
  record('blocked',req.url,req.method);return Response.error();
 })().catch(error=>{console.error(error);return Response.error()}));
});
