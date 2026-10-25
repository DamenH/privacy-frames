import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox} from 'playwright';
import {servers} from './server.mjs';
const server=await servers({separateRuntime:true}),results=[];
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await engine.launch(),context=await browser.newContext(),manager=await context.newPage();
 const checks=[];let errors=[];
 try{
  manager.on('pageerror',e=>errors.push(e.message));
  await manager.goto('http://127.0.0.1:4210/privacy-frames/');
  await manager.locator('#connect-runtime').waitFor();
  await manager.evaluate(()=>localStorage.setItem('manager-secret','synthetic-manager-canary'));
  const opened=context.waitForEvent('page');await manager.locator('#connect-runtime').click();const installer=await opened;
  installer.on('pageerror',e=>errors.push(e.message));
  await manager.getByText('Ready to install.',{exact:true}).waitFor();
  assert.equal(new URL(installer.url()).hostname,'localhost');
  checks.push('Top-level cross-site runtime connected without an iframe');
  await manager.locator('#app-url').fill('http://127.0.0.1:4212/');await manager.locator('#install button').click();
  const launch=manager.locator('[data-app="notes"]');await launch.waitFor();
  assert.match(await launch.getAttribute('href'),/^http:\/\/localhost:4211\/runtime\/apps\/notes\/notes-[a-f0-9]{64}\/index.html$/);
  const appOpened=context.waitForEvent('page');await launch.click();const app=await appOpened;
  app.on('pageerror',e=>errors.push(e.message));
  await app.locator('#note').waitFor();await app.locator('#note').fill('private-local-notes');await app.locator('#save').click();
  assert.equal(await app.evaluate(()=>localStorage.getItem('manager-secret')),null);
  assert.equal(await app.evaluate(()=>window.opener),null);
  await app.reload();await app.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));assert.equal(await app.locator('#note').inputValue(),'private-local-notes');
  checks.push('Readable source-bound URL, scoped persistence and separate manager storage');
  await app.close();await manager.reload();await manager.locator('[data-app="notes"]').waitFor();
  assert.equal(await manager.locator('iframe').count(),0);
  const reopened=context.waitForEvent('page');await manager.locator('[data-app="notes"]').click();const offline=await reopened;
  await offline.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));
  await context.setOffline(true);await offline.reload();await offline.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));
  assert.equal(await offline.locator('#note').inputValue(),'private-local-notes');
  await context.setOffline(false);await offline.close();
  checks.push('Cached manager library launches installed application offline');
  assert.deepEqual(errors,[]);results.push({name,version:browser.version(),checks});
 }catch(error){results.push({name,checks,errors,failure:error.stack});throw error;}
 finally{await context.close();await browser.close();}
}}
finally{await server.close();await writeFile(new URL('../results/separate-runtime.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: ${r.checks.length} separate-runtime groups passed`).join('\n'));
