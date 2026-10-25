import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox} from 'playwright';
import {servers} from './server.mjs';
const server=await servers({separateRuntime:true}),results=[];
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await engine.launch(name==='chromium'?{executablePath:chromium.executablePath()}:{}),context=await browser.newContext(),manager=await context.newPage();
 const checks=[],errors=[];let app;
 try{
  await manager.goto('http://127.0.0.1:4210/privacy-frames/');await manager.locator('#connect-runtime').waitFor();await manager.locator('#connect-runtime').click();await manager.getByText('Ready to install.',{exact:true}).waitFor();
  await manager.evaluate(()=>{localStorage.setItem('private-manager-data','synthetic-canary');});
  await manager.locator('#app-url').fill('http://127.0.0.1:4218/');await manager.locator('#install button').click();
  await manager.waitForFunction(()=>/^(Installed |Installation refused:)/.test(document.querySelector('#status').textContent));
  assert.match(await manager.locator('#status').textContent(),/^Installed /);
  assert.equal(manager.workers().length,0,'Preparation worker survived completion');
  assert.equal(await manager.evaluate(()=>localStorage.getItem('private-manager-data')),'synthetic-canary');
  checks.push('No-manifest website installation completes with no native browser authority in publisher install code and no surviving preparation worker');
  const opened=context.waitForEvent('page');await manager.locator('[data-app="ordinary-offline-app"]').click();app=await opened;app.on('pageerror',e=>errors.push(e.message));
  await app.getByText('Imported module: prepared; activated',{exact:true}).waitFor();
  assert(Object.values(await app.evaluate(async()=>(await(await fetch('/phase.json')).json()).authority)).every(value=>value===false));
  const externalStart=server.traffic.length;
  await app.locator('#private').fill('private-website-marker-'+name);await app.locator('#send').click();await app.getByText('Network blocked',{exact:true}).waitFor();
  assert.deepEqual(server.traffic.slice(externalStart).filter(r=>r.path.includes('private-website-marker')),[]);
  assert.equal(app.workers().length,0);
  checks.push('Root-relative CSS/resources, relative module imports and generated cache content work; private execution has no publisher worker or network fallback');
  const authority=await app.evaluate(async()=>{
   const ready=await navigator.serviceWorker.ready;const results=[];
   for(const operation of [()=>navigator.serviceWorker.register('/other-worker.js'),()=>ready.update(),()=>ready.unregister(),()=>ready.navigationPreload.enable(),()=>ready.active.postMessage({operation:'list'})]){
    try{await operation();results.push(false);}catch{results.push(true);}
   }
   return results;
  });assert.deepEqual(authority,[true,true,true,true,true]);
  await context.setOffline(true);await app.reload();await app.getByText('Imported module: prepared; activated',{exact:true}).waitFor();await context.setOffline(false);await app.close();
  checks.push('Mediated registration cannot enable updates, alternate workers, messaging or navigation preload; offline fresh document works');
  await manager.locator('#app-url').fill('http://127.0.0.1:4218/reject/');await manager.locator('#install button').click();await manager.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Installation refused:'));
  assert.match(await manager.locator('#status').textContent(),/Installation deliberately rejected/);assert.equal(await manager.locator('.app-card').count(),1);assert.equal(manager.workers().length,0);
  checks.push('Rejected install handler terminates preparation and publishes no application');
  assert.deepEqual(errors,[]);results.push({name,version:browser.version(),checks});
 }catch(error){results.push({name,checks,errors,status:await manager.locator('#status').textContent(),failure:error.stack});throw error;}
 finally{await context.close();await browser.close();}
}}
finally{await server.close();await writeFile(new URL('../results/website-installation.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: ${r.checks.length} website-installation groups passed`).join('\n'));
