import {parse,serialize} from 'parse5';
import {digest,LIMITS,safePath,validateMarkup} from './package.js';

function publicURL(input,base){
 const url=new URL(input,base);url.hash='';
 if(url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Installation requires public HTTPS resources');
 return url;
}
// Remove browser installation hints/policy metadata, retaining the executable
// application and ordinary styles. Application JavaScript bytes are unchanged.
function prepareHTML(text){
 const ast=parse(text),links=[];let title='';
 function walk(node){
  node.childNodes=(node.childNodes||[]).filter(child=>{
   const attr=name=>child.attrs?.find(a=>a.name===name)?.value;
   if(child.tagName==='title')title=(child.childNodes||[]).map(n=>n.value||'').join('');
   if(child.tagName==='meta'&&!attr('charset')&&!['viewport','color-scheme','theme-color'].includes(attr('name')?.toLowerCase()))return false;
   if(child.tagName==='link'&&attr('rel')?.toLowerCase()!=='stylesheet')return false;
   if(child.tagName==='script'&&attr('src'))links.push(attr('src'));
   if(child.tagName==='link'&&attr('href'))links.push(attr('href'));
   if(['img','audio','video','source'].includes(child.tagName)&&attr('src')&&!attr('src').startsWith('data:'))links.push(attr('src'));
   walk(child);return true;
  });if(node.content)walk(node.content);
 }
 walk(ast);const html=serialize(ast);validateMarkup(html,{document:true,initial:true});return {html,title,links};
}
export async function downloadWebsite(input,{onProgress=()=>{}}={}){
 const source=publicURL(input),scope=new URL('./',source),downloads=new Map(),abort=new AbortController();
 let size=0,sealed=false;
 async function download(input){
  const url=publicURL(input,scope).href;
  if(sealed)throw new Error('Installation has ended');
  if(downloads.has(url))return downloads.get(url);
  if(downloads.size>=LIMITS.files)throw new Error('Too many installation resources');
  const promise=(async()=>{
   const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:abort.signal});
   if(!response.ok)throw Object.assign(new Error(`${url}: HTTP ${response.status}`),{status:response.status});
   const reader=response.body.getReader(),chunks=[];let length=0;
   while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;size+=part.value.byteLength;if(size>LIMITS.bytes){abort.abort();throw new Error('Installation exceeds size limit');}chunks.push(part.value);}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   onProgress(`Preparing… ${downloads.size} resources`);
   return {url,bytes:bytes.buffer,contentType:response.headers.get('Content-Type')||'application/octet-stream'};
  })();downloads.set(url,promise);return promise;
 }
 let worker;
 try{
  const entry=await download(source.href),prepared=prepareHTML(new TextDecoder().decode(entry.bytes));
  await Promise.all(prepared.links.map(link=>download(new URL(link,source).href)));
  let receipt=null,caches=[];
  const scriptURL=new URL('sw.js',scope);let script;
  try{script=await download(scriptURL.href);}catch(error){if(error.status!==404)throw error;downloads.delete(scriptURL.href);}
  if(script){
   if(!/javascript|ecmascript/.test(script.contentType))throw new Error('Installation worker must be JavaScript');
   worker=new Worker(new URL('install-worker.js',import.meta.url));
   caches=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Installation worker timed out'));},45000);
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message||'Installation worker failed'));};
    worker.onmessage=async event=>{
     const data=event.data;
     if(data?.type==='download'){
      try{const resource=await download(data.url);worker.postMessage({type:'download-result',id:data.id,ok:true,bytes:resource.bytes,contentType:resource.contentType});}
      catch(error){worker.postMessage({type:'download-result',id:data.id,ok:false,error:error.message});}
     }else if(data?.type==='prepared'){clearTimeout(timer);resolve(data.caches);}
     else if(data?.type==='failed'){clearTimeout(timer);reject(new Error(data.error));}
    };
    worker.postMessage({type:'prepare',scope:scope.href,scriptURL:scriptURL.href,code:new TextDecoder().decode(script.bytes)});
   });
   receipt={scriptURL:scriptURL.href,scope:scope.href,completed:['install','activate'],profile:'precache-v1'};
  }
  // No publisher execution context or broker survives this transition.
  worker?.terminate();sealed=true;await Promise.all(downloads.values());abort.abort();
  const collected=new Map();for(const item of await Promise.all(downloads.values()))collected.set(item.url,item);
  let generatedSize=0;
  for(const cache of caches)for(const item of cache.entries){publicURL(item.url);if(!(item.bytes instanceof ArrayBuffer))throw new Error('Invalid cached resource');generatedSize+=item.bytes.byteLength;if(generatedSize>LIMITS.bytes)throw new Error('Installation caches exceed size limit');collected.set(item.url,item);}
  if(collected.size>LIMITS.files)throw new Error('Too many prepared resources');
  // The host-controlled document adaptation always takes precedence over cache
  // copies of the entry; publisher executable resources retain their bytes.
  collected.set(source.href,{...entry,bytes:new TextEncoder().encode(prepared.html).buffer});
  const paths=new Set(),resources=[];let total=0;
  for(const item of collected.values()){
   const url=new URL(item.url);let path=item.url===source.href?'index.html':url.origin===scope.origin&&url.href.startsWith(scope.href)?url.pathname.slice(scope.pathname.length):'';
   try{safePath(path);if(paths.has(path))throw new Error('Duplicate path');}catch{path='resources/'+(await digest(new TextEncoder().encode(item.url)))+'.'+(url.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]||'bin');}
   paths.add(path);total+=item.bytes.byteLength;if(total>LIMITS.bytes)throw new Error('Prepared application exceeds size limit');
   let bytes=item.bytes;
   if(/\.html$/i.test(path)){bytes=new TextEncoder().encode(prepareHTML(new TextDecoder().decode(bytes)).html).buffer;}
   resources.push({...item,path,bytes,sha256:await digest(bytes)});
  }
  const label=(scope.pathname.split('/').filter(Boolean).at(-1)||prepared.title.trim()||source.hostname).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,48)||'application';
  const manifest={format:1,id:label,name:prepared.title.trim().slice(0,100)||label,entry:'index.html',resources:resources.map(r=>r.path)};
  return {id:label+'-'+await digest(new TextEncoder().encode(source.href)),manifest,source:source.href,resources,size:total,installedAt:new Date().toISOString(),preparation:{profile:'website-v1',serviceWorker:receipt,caches:caches.map(cache=>({name:cache.name,urls:cache.entries.map(entry=>entry.url)})),ended:true}};
 }finally{sealed=true;worker?.terminate();abort.abort();await Promise.allSettled(downloads.values());}
}
