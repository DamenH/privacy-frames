// Installed publisher URLs become local virtual resources before native request
// creation. CSP permits only the runtime origin; the worker still rejects every
// local request that is not part of the installation.
export function resourceAliases({method,accessor,descriptor,apply}){
 const NativeRequest=Request,nativeFetch=fetch,requestURL=descriptor(Request.prototype,'url').get;
 let aliases=new Map();
 const mapURL=input=>{const url=new URL(String(input),document.baseURI),hash=url.hash;url.hash='';if(aliases.has(url.href))return aliases.get(url.href)+hash;url.hash=hash;return url.href;};
 const mapRequest=input=>input instanceof NativeRequest?new NativeRequest(mapURL(apply(requestURL,input,[])),input):mapURL(input);
 method(window,'fetch',function(input,init){return apply(nativeFetch,this,[mapRequest(input),init]);});
 const open=XMLHttpRequest.prototype.open;
 method(XMLHttpRequest.prototype,'open',function(method,url,...rest){return apply(open,this,[method,mapURL(url),...rest]);});
 const put=Cache.prototype.put;
 method(Cache.prototype,'add',async function(input){const request=new NativeRequest(input),response=await nativeFetch(mapRequest(request));if(!response.ok||response.status===206)throw new TypeError('Cache download failed');await apply(put,this,[request,response]);});
 method(Cache.prototype,'addAll',async function(inputs){const requests=Array.from(inputs,input=>new NativeRequest(input));if(new Set(requests.map(request=>request.url)).size!==requests.length)throw new TypeError('Duplicate cache requests');const responses=await Promise.all(requests.map(request=>nativeFetch(mapRequest(request))));if(responses.some(response=>!response.ok||response.status===206))throw new TypeError('Cache download failed');for(let index=0;index<requests.length;index++)await apply(put,this,[requests[index],responses[index]]);});
 for(const [ctor,key]of [[globalThis.HTMLImageElement,'src'],[globalThis.HTMLMediaElement,'src'],[globalThis.HTMLSourceElement,'src'],[globalThis.HTMLInputElement,'src'],[globalThis.HTMLVideoElement,'poster'],[globalThis.HTMLAnchorElement,'href'],[globalThis.HTMLAreaElement,'href']])if(ctor){const d=descriptor(ctor.prototype,key);if(d?.set)accessor(ctor.prototype,key,{set(value){return apply(d.set,this,[mapURL(value)]);}});}
 return Object.freeze({mapURL,install(entries){aliases=new Map(entries);}});
}
