import {launch} from './browser-profile.mjs';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {chromium,firefox} from 'playwright';import {servers} from './server.mjs';
const server=await servers({separateRuntime:true}),results=[];
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await launch(engine),context=await browser.newContext();context.setDefaultTimeout(15000);
 const row={name,version:browser.version(),deployment:'deliberately cross-site: 127.0.0.1 parent and localhost iframe'};results.push(row);
 try{
  const manager=await context.newPage();await manager.goto('http://127.0.0.1:4210/privacy-frames/');await manager.getByText('Ready to install.',{exact:true}).waitFor();
  await manager.evaluate(()=>{const frame=document.createElement('iframe');frame.src='http://localhost:4211/runtime/connect.html';frame.id='cross-site-storage-probe';document.body.append(frame);});
  await manager.locator('#cross-site-storage-probe').waitFor();let frame;
  for(let attempt=0;attempt<30&&!frame;attempt++){frame=manager.frames().find(f=>f.url().startsWith('http://localhost:4211/'));if(!frame)await new Promise(resolve=>setTimeout(resolve,100));}
  assert(frame);await frame.waitForFunction(()=>!!document.documentElement.dataset.runtimeState);
  let embedded;
  try{embedded=await frame.evaluate(()=>{localStorage.setItem('pf-partition-probe','embedded-public-probe');return localStorage.getItem('pf-partition-probe');});}catch{embedded='denied';}
  const top=await context.newPage();await top.goto('http://localhost:4211/runtime/connect.html');await top.waitForFunction(()=>!!document.documentElement.dataset.runtimeState);
  let topValue;try{topValue=await top.evaluate(()=>localStorage.getItem('pf-partition-probe'));}catch{topValue='denied';}
  row.embedded=embedded;row.topLevel=topValue;row.storageShared=embedded==='embedded-public-probe'&&topValue===embedded;
  row.conclusion=row.storageShared?'This browser configuration shares the probe; production still uses same-site origins.':'Cross-site embedding is partitioned or denied; it cannot substitute for the same-site deployment.';
  const control=await top.evaluate(()=>{localStorage.setItem('pf-top-level-control','top-level-public-probe');return localStorage.getItem('pf-top-level-control');});assert.equal(control,'top-level-public-probe');row.topLevelControl=true;
 }catch(error){row.failure=error.stack;throw error;}finally{await context.close();await browser.close();}
}}
finally{await server.close();await writeFile(new URL('../results/storage-policy.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: cross-site shared=${r.storageShared}`).join('\n'));
