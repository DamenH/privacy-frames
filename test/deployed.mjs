import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox} from 'playwright';
const hostURL=process.env.HOST_URL||'https://damenh.github.io/privacy-frames/';
const report={date:new Date().toISOString(),host:new URL(hostURL).hostname,browsers:[]};
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await engine.launch();const context=await browser.newContext({viewport:{width:1100,height:900}});const page=await context.newPage();
 const row={name,version:browser.version(),checks:[],errors:[]};report.browsers.push(row);page.on('pageerror',e=>row.errors.push(e.message));
 try{
  await page.goto(hostURL);await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Ready to install.');
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.locator('h1').textContent(),'Privacy Frames');assert.equal(await page.locator('#install button').textContent(),'Install');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(17, 19, 22)');
  row.checks.push('Compact dark host with no installation iframe');
  const config=await(await page.request.get(new URL('config.json',hostURL).href)).json();
  for(const app of config.examples){await page.locator('#app-url').fill(app.url);await page.locator('#install button').click();const manifest=await(await page.request.get(new URL('app.json',app.url).href)).json();await page.locator(`[data-app="${manifest.id}"]`).waitFor();}
  assert.equal(await page.locator('.app-card').count(),4);await page.reload();await page.locator('[data-app="adversary"]').waitFor();row.checks.push('Four pasted URLs install from external publisher and survive reload');
  async function launch(id){const opened=context.waitForEvent('page');await page.locator(`[data-app="${id}"]`).click();const app=await opened;await app.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));assert.equal(new URL(app.url()).origin,new URL(hostURL).origin);return app;}
  let app=await launch('notes');assert.equal(await app.evaluate(()=>window.opener),null);await app.locator('#note').fill('Deployed private note');await app.locator('#save').click();await app.reload();await app.waitForFunction(()=>document.querySelector('#mode')?.textContent.includes('network isolated'));assert.equal(await app.locator('#note').inputValue(),'Deployed private note');await app.close();row.checks.push('Same-origin notes, persistence and opener isolation');
  app=await launch('image');await app.locator('#file').setInputFiles(new URL('./pixels.png',import.meta.url).pathname);await app.waitForFunction(()=>document.querySelector('canvas').width===2);assert.deepEqual(await app.evaluate(()=>Array.from(document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data)),[220,40,90,255]);await app.locator('#invert').click();assert.deepEqual(await app.evaluate(()=>Array.from(document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data)),[35,215,165,255]);await app.close();row.checks.push('Local image input and pixel processing');
  app=await launch('resources');await app.getByText('Article loaded using native fetch.',{exact:true}).waitFor();assert(await app.locator('#illustration').evaluate(img=>img.complete&&img.naturalWidth>0));await app.close();row.checks.push('Installed native fetch and image loading');
  await page.evaluate(()=>localStorage.setItem('host-private-canary','manager-value'));
  app=await launch('adversary');assert.equal(await app.evaluate(()=>localStorage.getItem('host-private-canary')),null);await app.evaluate(()=>{localStorage.setItem('host-private-canary','attacker');localStorage.clear();});assert.equal(await page.evaluate(()=>localStorage.getItem('host-private-canary')),'manager-value');
  for(const file of ['index.html','manager.js','config.json','sw.js'])assert(await app.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},new URL(file,hostURL).href));
  await app.locator('#run').click();await app.waitForFunction(()=>document.querySelectorAll('#results tr').length===Object.keys(boundaryProbes).length);row.probes=await app.locator('#results tr').allTextContents();assert.equal(row.probes.length,30);assert(row.probes.every(x=>x.includes('Blocked:')));assert.equal(await app.evaluate(()=>window.length),0);await app.close();row.checks.push('Thirty hostile checks, same-origin host storage and resource isolation');
  await context.setOffline(true);await page.reload();await page.locator('[data-app="resources"]').waitFor();app=await launch('resources');await app.getByText('Article loaded using native fetch.',{exact:true}).waitFor();await app.close();await context.setOffline(false);row.checks.push('Host and installed app launch with browser offline');
  await page.locator('.observations summary').click();await page.locator('#refresh-events').click();await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('BLOCKED'));row.checks.push('Direct worker management and diagnostics after offline reload');
  const response=await page.request.get(new URL('report.html',hostURL).href);assert.equal(response.status(),200);assert((await response.text()).includes('same origin'));row.checks.push('Updated report delivered');
  if(name==='chromium'){await page.screenshot({path:new URL('../results/desktop.png',import.meta.url).pathname,fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL('../results/mobile.png',import.meta.url).pathname,fullPage:true});}
 }catch(error){row.failure=error.stack;throw error;}finally{await context.close();await browser.close();}
}}
finally{await writeFile(new URL('../results/deployed.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(report.browsers.map(b=>`${b.name}: ${b.checks.length} deployed groups passed`).join('\n'));
