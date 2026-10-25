export function scopeCaches({prefix,method,apply}){
 const factory=caches;
 const native=Object.fromEntries(['open','has','delete','keys','match'].map(key=>[key,CacheStorage.prototype[key]]));
 for(const key of ['open','has','delete'])method(CacheStorage.prototype,key,function(name){
  if(!arguments.length)throw new TypeError('Cache name is required');
  return apply(native[key],this,[prefix+String(name)]);
 });
 method(CacheStorage.prototype,'keys',async function(){return(await apply(native.keys,this,[])).filter(name=>name.startsWith(prefix)).map(name=>name.slice(prefix.length));});
 method(CacheStorage.prototype,'match',async function(request,options={}){
  if(options.cacheName!==undefined)return apply(native.match,this,[request,{...options,cacheName:prefix+String(options.cacheName)}]);
  const names=await apply(native.keys,this,[]);
  for(const name of names.filter(name=>name.startsWith(prefix))){const response=await apply(native.match,this,[request,{...options,cacheName:name}]);if(response)return response;}
 });
 return factory;
}
