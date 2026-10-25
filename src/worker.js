import {getApp,listApps,putApp,deleteApp} from './store.js';
import {validateManifest,validateMarkup,digest,mime,LIMITS} from './package.js';
import {serialize} from 'parse5';
import {applicationURL,applicationIdentity,resourceURL} from './runtime-url.js';
const BASE=new URL('./',self.location.href);
const trustedFiles=['index.html','manager.js','host.css','guard.js','config.json','report.html','connect.html','connect.js','install-worker.js'];
function isManagerURL(input){try{const u=new URL(input);return u.origin===BASE.origin&&!u.search&&[BASE.pathname,BASE.pathname+'index.html',BASE.pathname+'connect.html'].includes(u.pathname);}catch{return false;}}
const BOOT='pf-trusted-bootstrap-'+__BUILD_ID__;
// Management roles are issued only to trusted document loads, then bound to the
// browser client ID. Changing a URL or supplying a claimed role is insufficient.
const roleURL=id=>new URL('__host-client/'+encodeURIComponent(id),BASE).href;
async function grantManagement(id){if(id)await(await caches.open(BOOT)).put(roleURL(id),new Response('manager'));}
async function hasManagement(id){return !!id&&!!await(await caches.open(BOOT)).match(roleURL(id));}
const events=[];
function record(kind,url,method){events.push({kind,url,method,time:new Date().toISOString()});if(events.length>300)events.shift();}
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(BOOT);await cache.addAll(trustedFiles.map(p=>new URL(p,BASE)));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(isManagerURL(client.url))await grantManagement(client.id);
 await self.clients.claim();
})()));
function policy(){return "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";}
const headers={'Content-Security-Policy':policy(),'X-DNS-Prefetch-Control':'off','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(self), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), attribution-reporting=(), browsing-topics=(), interest-cohort=()','X-Content-Type-Options':'nosniff'};
function response(body,type='text/html',status=200){return new Response(body,{status,headers:{...headers,'Content-Type':type}});}
function runtimeIdentity(url){return applicationIdentity(url,BASE);}
function alias(app,input,base){try{const url=new URL(input,base),hash=url.hash;url.hash='';const match=app.resources.find(resource=>resource.url===url.href);return match?resourceURL(app,match.path,BASE).href+hash:input;}catch{return input;}}
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
 strip(head);strip(body);return {head:serialize(head),body:serialize(body),scripts,source:app.source,aliases:app.resources.map(resource=>[resource.url,resourceURL(app,resource.path,BASE).href]),serviceWorker:app.preparation?.serviceWorker||null};
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
  if(!client||!isManagerURL(client.url)||!await hasManagement(client.id))throw new Error('Management client not authorized');
  const {operation,payload}=event.data||{};let value;
  if(operation==='install'){const app=await validatePackage(payload);const windows=await self.clients.matchAll({type:'window'});if(windows.some(c=>runtimeIdentity(c.url)===app.id))throw new Error('Close application windows before replacing an installation');
   for(const stage of app.preparation?.caches||[]){if(typeof stage.name!=='string'||stage.name.length>1000||!Array.isArray(stage.urls))throw new Error('Invalid installation cache');const cache=await caches.open(`pf:${app.id}:`+stage.name);for(const url of stage.urls){const resource=app.resources.find(r=>r.url===url);if(!resource)throw new Error('Cache contains an uninstalled resource');await cache.put(new Request(url),new Response(resource.bytes,{headers:{'Content-Type':resource.contentType||mime(resource.path)}}));}}
   app.installedAt=new Date().toISOString();await putApp(app);value={id:app.id};}
  else if(operation==='list')value=(await listApps()).map(a=>({id:a.id,manifest:a.manifest,source:a.source,installedAt:a.installedAt,size:a.size}));
  else if(operation==='remove'){const windows=await self.clients.matchAll({type:'window'});if(windows.some(c=>runtimeIdentity(c.url)===payload))throw new Error('Close application windows before uninstalling');await deleteApp(payload);value=true;}
  else if(operation==='events')value=events;
  else throw new Error('Unknown operation');port.postMessage({ok:true,value});
 }catch(e){port.postMessage({ok:false,error:String(e.message||e)})}})());
});
self.addEventListener('fetch',event=>{
 event.respondWith((async()=>{
  const req=event.request,url=new URL(req.url),client=event.clientId?await self.clients.get(event.clientId):null;
  // Fragments are application-local routing state, including on reload. They do
  // not select a different installed document or authorize a resource request.
  url.hash='';
  const id=runtimeIdentity(client?.url)||((req.mode==='navigate')?runtimeIdentity(url.href):null);
  const isTrusted=url.origin===BASE.origin&&trustedFiles.some(p=>url.href===new URL(p,BASE).href);
  const manager=isManagerURL(client?.url)&&await hasManagement(client?.id);
  const readOnlyHost=client?.url===new URL('report.html',BASE).href;
  const managerNavigation=req.mode==='navigate'&&isManagerURL(url.href);
  const hostDocument=req.mode==='navigate'&&url.href===new URL('report.html',BASE).href;
  if(!id&&managerNavigation)await grantManagement(event.resultingClientId);
  if(req.method==='GET'&&url.href===BASE.href&&!id&&(managerNavigation||manager)){return (await caches.open(BOOT)).match(new URL('index.html',BASE).href)||Response.error();}
  if(isTrusted&&req.method==='GET'&&((!id&&(manager||readOnlyHost||managerNavigation||hostDocument))||url.href===new URL('guard.js',BASE).href&&id)){
   const cached=await(await caches.open(BOOT)).match(url.href);return cached||Response.error();
  }
  if(!id){
   if(manager&&req.method==='GET'&&['http:','https:'].includes(url.protocol))return fetch(req);
   record('blocked-unmanaged',req.url,req.method);return Response.error();
  }
  const app=await getApp(id);if(!app)return response('<h1>Application not installed</h1>','text/html',404);
  const legacy=(req.mode==='navigate'?url.href:client?.url)?.startsWith(new URL('run/',BASE).href);
  const entry=legacy?new URL(`run/${id}/${app.manifest.entry}`,BASE):applicationURL(app,BASE);
  if(req.mode==='navigate'){
   // Any attempt to use a different document is refused. Bootstrap contains no untrusted markup.
   if(url.href!==entry.href||req.method!=='GET'){record('blocked-navigation',req.url,req.method);return Response.error();}
   const script=new URL('guard.js',BASE).href;
   return response(`<!doctype html><html><head><meta charset="utf-8"><title>Installed application</title></head><body><script src="${script}"></script></body></html>`);
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
