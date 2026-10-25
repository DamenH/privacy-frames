import {prepareDocument,cssReferences} from './document.js';
import {digest,LIMITS,safePath,validateMarkup} from './package.js';

function publicURL(input,base){
 const url=new URL(input,base);url.hash='';
 if(url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Installation requires public HTTPS resources');
 return url;
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
  const entry=await download(source.href),prepared=prepareDocument(new TextDecoder().decode(entry.bytes),source.href);
  await Promise.all(prepared.links.map(link=>download(link)));
  let publisherManifest=null;
  if(prepared.manifestURL){
   try{
    const resource=await download(prepared.manifestURL);
    const value=JSON.parse(new TextDecoder().decode(resource.bytes));
    if(value&&typeof value==='object'&&!Array.isArray(value))publisherManifest={value,url:resource.url};
    const icons=(value?.icons||[]).filter(icon=>typeof icon.src==='string').slice(0,8);
    for(const icon of icons)try{await download(new URL(icon.src,resource.url).href);}catch(error){downloads.delete(new URL(icon.src,resource.url).href);onProgress('Optional icon unavailable: '+error.message);}
   }catch(error){downloads.delete(prepared.manifestURL);onProgress('Optional manifest unavailable: '+error.message);}
  }
  const discovered=new Set();
  while(true){
   const pending=(await Promise.all(downloads.values())).filter(item=>/text\/css/i.test(item.contentType)&&!discovered.has(item.url));
   if(!pending.length)break;
   for(const item of pending){discovered.add(item.url);await Promise.all(cssReferences(new TextDecoder().decode(item.bytes),item.url).map(url=>download(url)));}
  }
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
   if(/\.html$/i.test(path)){bytes=new TextEncoder().encode(prepareDocument(new TextDecoder().decode(bytes),item.url).html).buffer;}
   resources.push({...item,path,bytes,sha256:await digest(bytes)});
  }
  const label=(scope.pathname.split('/').filter(Boolean).at(-1)||prepared.title.trim()||source.hostname).toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,48)||'application';
  const manifest={format:1,id:label,name:prepared.title.trim().slice(0,100)||label,entry:'index.html',resources:resources.map(r=>r.path)};
  return {id:label+'-'+await digest(new TextEncoder().encode(source.href)),manifest,source:source.href,resources,publisherManifest,size:total,installedAt:new Date().toISOString(),preparation:{profile:'website-v1',serviceWorker:receipt,caches:caches.map(cache=>({name:cache.name,urls:cache.entries.map(entry=>entry.url)})),ended:true}};
 }finally{sealed=true;worker?.terminate();abort.abort();await Promise.allSettled(downloads.values());}
}
