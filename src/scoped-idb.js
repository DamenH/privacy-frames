// Rewrite the factory methods themselves so prototype recovery cannot bypass
// namespacing. Native requests/transactions keep their ordinary event behavior.
export function scopeIndexedDB({prefix,method,accessor,descriptor,apply,fail}){
 const nativeOpen=IDBFactory.prototype.open,nativeDelete=IDBFactory.prototype.deleteDatabase;
 const nativeList=IDBFactory.prototype.databases,nativeName=descriptor(IDBDatabase.prototype,'name').get;
 const factory=indexedDB;
 method(IDBFactory.prototype,'open',function(name,...version){
  if(!arguments.length)throw new TypeError('Database name is required');
  return apply(nativeOpen,this,[prefix+String(name),...version]);
 });
 method(IDBFactory.prototype,'deleteDatabase',function(name){
  if(!arguments.length)throw new TypeError('Database name is required');
  return apply(nativeDelete,this,[prefix+String(name)]);
 });
 if(nativeList)method(IDBFactory.prototype,'databases',async function(){
  return(await apply(nativeList,this,[])).filter(db=>db.name?.startsWith(prefix)).map(db=>({...db,name:db.name.slice(prefix.length)}));
 });
 accessor(IDBDatabase.prototype,'name',{get(){
  const name=apply(nativeName,this,[]);
  if(!name.startsWith(prefix))fail('Database belongs to another application');
  return name.slice(prefix.length);
 }});
 return factory;
}
