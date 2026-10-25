import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium,firefox} from 'playwright';import {launch} from './browser-profile.mjs';import {servers} from './server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'pf-manager-upgrade-')),results=[];
let server;
try{
 const archive=execFileSync('git',['archive','e5082f0'],{cwd:root});execFileSync('tar',['-xf','-','-C',temporary],{input:archive});await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
 execFileSync(process.execPath,['build.mjs'],{cwd:temporary,stdio:'pipe'});execFileSync(process.execPath,['report.mjs'],{cwd:temporary,stdio:'pipe'});
 server=await servers({separateRuntime:true,productionRoles:true,initialManagerDirectory:join(temporary,'dist')});
 for(const [name,engine]of Object.entries({chromium,firefox})){
  server.setManagerDirectory(join(temporary,'dist'));const browser=await launch(engine),context=await browser.newContext(),page=await context.newPage();context.setDefaultTimeout(30000);
  try{
   await page.goto('http://127.0.0.1:4210/privacy-frames/');await page.locator('#connect-runtime').waitFor();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.evaluate(()=>localStorage.setItem('manager-upgrade-canary','private-manager-state'));
   server.setManagerDirectory(join(root,'dist-manager'));await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
   await page.locator('#refresh-apps').waitFor();await page.getByText('Ready to install.',{exact:true}).waitFor();assert.equal(await page.locator('#connect-runtime').count(),0);assert.equal(await page.locator('iframe').count(),1);assert.equal(context.pages().length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('manager-upgrade-canary')),'private-manager-state');
   results.push({name,version:browser.version(),checks:['A cached previous-release manager adopts the new trusted UI automatically','The iframe replaces the connection button without a popup','Existing manager state survives the service-worker upgrade']});
  }finally{await context.close();await browser.close();}
 }
}finally{await server?.close();await rm(temporary,{recursive:true,force:true});await writeFile(new URL('../results/upgrade.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: ${r.checks.length} manager-upgrade groups passed`).join('\n'));
