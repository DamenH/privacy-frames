import {getApp,listApps,putApp,deleteApp} from './store.js';
import {validateManifest,validateMarkup,digest,mime,LIMITS} from './package.js';
import {serialize} from 'parse5';
const BASE=new URL('./',self.location.href);
const trustedFiles=['index.html','manager.js','host.css','guard.js','config.json','report.html'];
function isManagerURL(input){try{const u=new URL(input);return u.origin===BASE.origin&&!u.search&&[BASE.pathname,BASE.pathname+'index.html'].includes(u.pathname);}catch{return false;}}
const BOOT='pf-trusted-bootstrap-'+__BUILD_ID__;
const events=[];
function record(kind,url,method){events.push({kind,url,method,time:new Date().toISOString()});if(events.length>300)events.shift();}
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(BOOT);await cache.addAll(trustedFiles.map(p=>new URL(p,BASE)));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function policy(){return "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src https: http:; media-src 'self' blob: data:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";}
const headers={'Content-Security-Policy':policy(),'X-DNS-Prefetch-Control':'off','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), attribution-reporting=(), browsing-topics=(), interest-cohort=()','X-Content-Type-Options':'nosniff'};
function response(body,type='text/html',status=200){return new Response(body,{status,headers:{...headers,'Content-Type':type}});}
function runtimeIdentity(url){try{const u=new URL(url);if(u.origin!==BASE.origin||!u.pathname.startsWith(BASE.pathname+'run/'))return null;return u.pathname.slice((BASE.pathname+'run/').length).split('/')[0];}catch{return null;}}
function prepared(app){
 const bytes=app.resources.find(r=>r.path===app.manifest.entry).bytes;
 const ast=validateMarkup(new TextDecoder().decode(bytes),{document:true,initial:true});
 const html=ast.childNodes.find(n=>n.tagName==='html'),head=html.childNodes.find(n=>n.tagName==='head'),body=html.childNodes.find(n=>n.tagName==='body');
 const scripts=[];
 function strip(node){node.childNodes=(node.childNodes||[]).filter(n=>{if(n.tagName==='script'){const src=n.attrs.find(a=>a.name==='src')?.value,type=n.attrs.find(a=>a.name==='type')?.value;if(!src)throw new Error('Missing script resource');const url=new URL(src,new URL(`run/${app.id}/${app.manifest.entry}`,BASE));const match=app.resources.find(r=>new URL(`run/${app.id}/${r.path}`,BASE).href===url.href);if(!match||!['','module','text/javascript','application/javascript'].includes(type||''))throw new Error('Script must be packaged JavaScript');scripts.push({src:url.href,type:type||''});return false;}strip(n);return true;});if(node.content)strip(node.content);}
 strip(head);strip(body);return {head:serialize(head),body:serialize(body),scripts,source:app.source};
}
async function validatePackage(pkg){
 pkg.manifest=validateManifest(pkg.manifest);const identity=pkg.manifest.id+'-'+(await digest(new TextEncoder().encode(pkg.source)));if(pkg.id!==identity)throw new Error('Installation identity mismatch');if(!Array.isArray(pkg.resources)||pkg.resources.length!==pkg.manifest.resources.length)throw new Error('Incomplete package');let bytes=0;
 for(const path of pkg.manifest.resources){const matches=pkg.resources.filter(r=>r.path===path);if(matches.length!==1)throw new Error('Duplicate or missing resource');const r=matches[0];if(!(r.bytes instanceof ArrayBuffer))throw new Error('Invalid resource bytes');bytes+=r.bytes.byteLength;if(bytes>LIMITS.bytes||await digest(r.bytes)!==r.sha256)throw new Error('Resource integrity mismatch');if(path.endsWith('.html'))validateMarkup(new TextDecoder().decode(r.bytes),{document:true,initial:true});}
 prepared(pkg);return pkg;
}
self.addEventListener('message',event=>{
 const port=event.ports[0];if(!port)return;
 event.waitUntil((async()=>{try{
  const client=await self.clients.get(event.source?.id);
  if(!client||!isManagerURL(client.url))throw new Error('Management client not authorized');
  const {operation,payload}=event.data||{};let value;
  if(operation==='install'){const app=await validatePackage(payload);const windows=await self.clients.matchAll({type:'window'});if(windows.some(c=>runtimeIdentity(c.url)===app.id))throw new Error('Close application windows before replacing an installation');app.installedAt=new Date().toISOString();await putApp(app);value={id:app.id};}
  else if(operation==='list')value=(await listApps()).map(a=>({id:a.id,manifest:a.manifest,source:a.source,installedAt:a.installedAt,size:a.size}));
  else if(operation==='remove'){const windows=await self.clients.matchAll({type:'window'});if(windows.some(c=>runtimeIdentity(c.url)===payload))throw new Error('Close application windows before uninstalling');await deleteApp(payload);value=true;}
  else if(operation==='events')value=events;
  else throw new Error('Unknown operation');port.postMessage({ok:true,value});
 }catch(e){port.postMessage({ok:false,error:String(e.message||e)})}})());
});
self.addEventListener('fetch',event=>{
 event.respondWith((async()=>{
  const req=event.request,url=new URL(req.url),client=event.clientId?await self.clients.get(event.clientId):null;
  const id=runtimeIdentity(client?.url)||((req.mode==='navigate')?runtimeIdentity(url.href):null);
  const isTrusted=url.origin===BASE.origin&&trustedFiles.some(p=>url.href===new URL(p,BASE).href);
  const manager=isManagerURL(client?.url);
  const readOnlyHost=client?.url===new URL('report.html',BASE).href;
  const managerNavigation=req.mode==='navigate'&&isManagerURL(url.href);
  const hostDocument=req.mode==='navigate'&&url.href===new URL('report.html',BASE).href;
  if(req.method==='GET'&&url.href===BASE.href&&!id&&(managerNavigation||manager)){return (await caches.open(BOOT)).match(new URL('index.html',BASE).href)||Response.error();}
  if(isTrusted&&req.method==='GET'&&((!id&&(manager||readOnlyHost||managerNavigation||hostDocument))||url.href===new URL('guard.js',BASE).href&&id)){
   const cached=await(await caches.open(BOOT)).match(url.href);return cached||Response.error();
  }
  if(!id){
   if(manager&&req.method==='GET'&&['http:','https:'].includes(url.protocol))return fetch(req);
   record('blocked-unmanaged',req.url,req.method);return Response.error();
  }
  const app=await getApp(id);if(!app)return response('<h1>Application not installed</h1>','text/html',404);
  const entry=new URL(`run/${id}/${app.manifest.entry}`,BASE);
  if(req.mode==='navigate'){
   // Any attempt to use a different document is refused. Bootstrap contains no untrusted markup.
   if(url.href!==entry.href||req.method!=='GET'){record('blocked-navigation',req.url,req.method);return Response.error();}
   const script=new URL('guard.js',BASE).href;
   return response(`<!doctype html><html><head><meta charset="utf-8"><title>Installed application</title></head><body><script src="${script}"></script></body></html>`);
  }
  if(url.origin===entry.origin&&url.pathname===entry.pathname&&url.search==='?host-content=1'&&req.method==='GET')return response(JSON.stringify(prepared(app)),'application/json');
  if(req.method==='GET'){
   const resource=app.resources.find(r=>new URL(`run/${id}/${r.path}`,BASE).href===url.href||r.url===url.href);
   if(resource){record('installed',req.url,req.method);return response(resource.bytes,mime(resource.path));}
  }
  record('blocked',req.url,req.method);return Response.error();
 })().catch(error=>{console.error(error);return Response.error()}));
});
