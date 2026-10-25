import 'ses';
// Only this trusted bootstrap runs as a native Worker. Publisher code runs in a
// compartment with no browser worker/network/storage/global messaging authority.
const send=globalThis.postMessage.bind(globalThis);
const receive=globalThis.addEventListener.bind(globalThis);
const pending=new Map();let sequence=0,started=false;
lockdown({errorTaming:'safe',consoleTaming:'safe'});
receive('message',async event=>{
 const data=event.data;
 if(data?.type==='download-result'){
  const waiter=pending.get(data.id);if(!waiter)return;pending.delete(data.id);
  if(data.ok)waiter.resolve(new Response(data.bytes,{headers:{'Content-Type':data.contentType}}));else waiter.reject(new Error(data.error));
  return;
 }
 if(started||data?.type!=='prepare')return;started=true;
 try{
  const scope=data.scope,handlers=new Map(),cacheData=new Map();
  const urlOf=input=>new URL(input instanceof Request?input.url:String(input),scope).href;
  const download=input=>{
   const url=urlOf(input);
   if(input instanceof Request&&input.method!=='GET')return Promise.reject(new Error('Installation permits GET only'));
   return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send({type:'download',id,url});});
  };
  const cacheAPI=harden({
   async open(name){name=String(name);if(!cacheData.has(name)){if(cacheData.size>=20)throw new Error('Too many installation caches');cacheData.set(name,new Map());}const entries=cacheData.get(name);
    return harden({
     async addAll(inputs){const requests=Array.from(inputs);if(requests.length>100)throw new Error('Too many installation requests');const values=await Promise.all(requests.map(async input=>[urlOf(input),await download(input)]));for(const [url,response]of values)entries.set(url,response);},
     async add(input){entries.set(urlOf(input),await download(input));},
     async put(input,response){if(!(response instanceof Response))throw new TypeError('Expected a Response');entries.set(urlOf(input),response.clone());},
     async match(input){return entries.get(urlOf(input))?.clone();},
     async keys(){return Array.from(entries.keys(),url=>new Request(url));},
     async delete(input){return entries.delete(urlOf(input));},
    });
   },
   async keys(){return Array.from(cacheData.keys());},async has(name){return cacheData.has(String(name));},async delete(name){return cacheData.delete(String(name));},
  });
  const world=harden({
   registration:{scope},location:{href:data.scriptURL,origin:new URL(data.scriptURL).origin},
   clients:{async claim(){}},async skipWaiting(){},
   addEventListener(type,handler){if(typeof handler!=='function')throw new TypeError('Expected handler');if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);},
  });
  const compartment=new Compartment({self:world,registration:world.registration,location:world.location,caches:cacheAPI,fetch:harden(download),URL,URLSearchParams,Request,Response,Headers,Blob,File,TextEncoder,TextDecoder,console:harden({log(){},warn(){},error(){}})});
  compartment.evaluate(data.code);
  if(!handlers.get('install')?.length)throw new Error('Worker has no explicit install handler');
  for(const type of ['install','activate']){
   const work=[];let accepting=true;
   const event=harden({type,waitUntil(promise){if(!accepting)throw new Error('Late waitUntil');work.push(Promise.resolve(promise));}});
   for(const callback of handlers.get(type)||[])callback(event);
   accepting=false;await Promise.all(work);
  }
  if(pending.size)throw new Error('Unfinished installation downloads');
  const caches=[];let total=0;
  for(const [name,entries]of cacheData){const values=[];for(const [url,response]of entries){const bytes=await response.arrayBuffer();total+=bytes.byteLength;if(total>20*1024*1024)throw new Error('Installation cache exceeds size limit');values.push({url,bytes,contentType:response.headers.get('Content-Type')||'application/octet-stream'});}caches.push({name,entries:values});}
  send({type:'prepared',caches});
 }catch(error){send({type:'failed',error:String(error.message||error)});}
});
