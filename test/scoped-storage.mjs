import {launch} from './browser-profile.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox} from 'playwright';
import {servers} from './server.mjs';
const server=await servers(),results=[];
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await launch(engine),context=await browser.newContext(),manager=await context.newPage();
 const checks=[];
 try{
  await manager.goto('http://127.0.0.1:4210/privacy-frames/');await manager.getByText('Ready to install.',{exact:true}).waitFor();
  for(const port of [4212,4213]){await manager.locator('#app-url').fill(`http://127.0.0.1:${port}/`);await manager.locator('#install button').click();await manager.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Installed '));}
  async function launch(id){const opened=context.waitForEvent('page');await manager.locator(`[data-app="${id}"]`).click();const app=await opened;await app.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));return app;}
  const notes=await launch('notes'),sibling=await launch('notes'),other=await launch('image');
  for(const app of [notes,sibling,other])await app.evaluate(()=>{window.events=[];addEventListener('storage',e=>events.push({key:e.key,oldValue:e.oldValue,newValue:e.newValue,scoped:e.storageArea===localStorage,keys:Object.keys(e.storageArea),foreign:e.storageArea['manager-private']}));});
  await manager.evaluate(()=>localStorage.setItem('manager-private','synthetic-canary'));
  await notes.evaluate(()=>{localStorage.alpha='one';sessionStorage.setItem('session-only','one');});
  await sibling.waitForFunction(()=>events.length===1);
  assert.deepEqual(await sibling.evaluate(()=>events[0]),{key:'alpha',oldValue:null,newValue:'one',scoped:true,keys:['alpha'],foreign:undefined});
  assert.equal(await sibling.evaluate(()=>sessionStorage.getItem('session-only')),null);
  assert.equal(await other.evaluate(()=>localStorage.getItem('alpha')),null);
  assert.deepEqual(await other.evaluate(()=>events),[]);
  await sibling.evaluate(()=>localStorage.clear());await notes.waitForFunction(()=>events.some(e=>e.key==='alpha'&&e.newValue===null));
  assert.equal(await manager.evaluate(()=>localStorage.getItem('manager-private')),'synthetic-canary');
  checks.push('Local storage methods, named properties, clear and same-app events; session isolation; foreign events suppressed');
  const semantics=await notes.evaluate(()=>{
   const errors=[];for(const operation of [()=>localStorage.getItem(),()=>localStorage.setItem('missing'),()=>localStorage.removeItem(),()=>localStorage.key(),()=>localStorage.setItem(Symbol('key'),'value')]){try{operation();errors.push(null);}catch(e){errors.push(e.name);}}
   localStorage.first='first';localStorage.second='second';Object.defineProperty(localStorage,'defined',{value:42,writable:true,enumerable:true,configurable:true});
   const result={errors,missing:localStorage.nonexistent,keyFraction:localStorage.key(1.9),keyInteger:localStorage.key(1),defined:localStorage.defined,enumerated:Object.keys(localStorage),present:'defined'in localStorage,instance:localStorage instanceof Storage};localStorage.clear();return result;
  });
  assert.deepEqual(semantics.errors,Array(5).fill('TypeError'));assert.equal(semantics.missing,undefined);assert.equal(semantics.keyFraction,semantics.keyInteger);assert.equal(semantics.defined,'42');assert(semantics.enumerated.includes('defined')&&semantics.present&&semantics.instance);
  checks.push('Storage argument errors, string conversion, indexed keys, property descriptors and missing properties match normal use');
  const dbTest=await notes.evaluate(async()=>{
   const open=name=>new Promise((resolve,reject)=>{const request=IDBFactory.prototype.open.call(indexedDB,name,1);request.onupgradeneeded=()=>request.result.createObjectStore('values');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const db=await open('shared-name');
   await new Promise((resolve,reject)=>{const tx=db.transaction('values','readwrite');tx.objectStore('values').put('private-score','score');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
   const visibleName=db.name;db.close();
   return {visibleName,databases:await indexedDB.databases()};
  });
  assert.equal(dbTest.visibleName,'shared-name');assert.deepEqual(dbTest.databases.map(d=>d.name),['shared-name']);
  const foreign=await other.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('shared-name',1);let created=false;
   request.onupgradeneeded=()=>{created=true;};request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{const db=request.result;resolve({created,name:db.name,stores:Array.from(db.objectStoreNames)});db.close();};
  }));
  assert.deepEqual(foreign,{created:true,name:'shared-name',stores:[]});
  const nativeNames=await manager.evaluate(async()=> (await indexedDB.databases()).map(d=>d.name));
  assert.equal(nativeNames.filter(n=>n.endsWith(':shared-name')).length,2);
  assert(nativeNames.includes('privacy-frames-host-v1'));
  await notes.reload();await notes.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));
  const persisted=await notes.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('shared-name');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('values'),read=tx.objectStore('values').get('score');tx.oncomplete=()=>{resolve(read.result);db.close();};};}));
  assert.equal(persisted,'private-score');
  checks.push('Native IndexedDB requests and transactions, prototype calls, visible names, namespace isolation and reload persistence');
  await manager.evaluate(async()=>{const cache=await caches.open('manager-cache');await cache.put(new URL('/manager-secret',location.origin),new Response('synthetic-canary'));});
  const cached=await notes.evaluate(async()=>{
   const cache=await CacheStorage.prototype.open.call(caches,'shared-cache');await cache.put(new URL('/cached-value',location.origin),new Response('private-cache-value'));
   return {keys:await caches.keys(),value:await(await caches.match('/cached-value')).text(),foreign:!!await caches.match('/manager-secret')};
  });
  assert.deepEqual(cached,{keys:['shared-cache'],value:'private-cache-value',foreign:false});
  assert.equal(await other.evaluate(async()=>!!await caches.match('/cached-value')),false);
  await other.evaluate(async()=>{await caches.delete('shared-cache');});
  assert.equal(await notes.evaluate(async()=>await(await caches.match('/cached-value',{cacheName:'shared-cache'})).text()),'private-cache-value');
  checks.push('Cache names, prototype calls, cross-cache matching and deletion remain scoped');
  const start=server.traffic.length;
  const cacheNetwork=await notes.evaluate(async()=>{const cache=await caches.open('network-attempt');try{await cache.add('http://127.0.0.1:4216/cache?value=private-cache-marker');return false;}catch{return true;}});
  assert.equal(cacheNetwork,true);assert.deepEqual(server.traffic.slice(start).filter(r=>r.path.includes('private-cache-marker')),[]);
  checks.push('Native Cache.add network requests remain intercepted by the host worker');
  results.push({name,version:browser.version(),checks});
 }catch(error){results.push({name,checks,failure:error.stack});throw error;}
 finally{await context.close();await browser.close();}
}}
finally{await server.close();await writeFile(new URL('../results/scoped-storage.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: ${r.checks.length} scoped-storage groups passed`).join('\n'));
