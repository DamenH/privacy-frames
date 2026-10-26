import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
import {chromium,firefox} from 'playwright';import {launch} from './browser-profile.mjs';
const hostURL=process.env.HOST_URL||'https://pf.damenh.com/',results=[];
try{for(const [name,engine]of Object.entries({chromium,firefox})){
 const browser=await launch(engine),context=await browser.newContext();context.setDefaultTimeout(30000);const row={name,version:browser.version()};results.push(row);
 try{
  const manager=await context.newPage();await manager.goto(hostURL);await manager.getByText('Ready to install.',{exact:true}).waitFor();
  const config=await manager.evaluate(async()=>await(await fetch('./config.json')).json()),bridge=manager.frames().find(frame=>frame.url().endsWith('/connect.html'));
  const installed=await bridge.evaluate(async()=>{
   const source='https://publisher.invalid/embedding/app.json',hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
   const manifest={format:1,id:'embedding-probe',name:'Embedding probe',entry:'index.html',resources:['index.html','app.js']},resources=[];
   for(const [path,text]of [['index.html','<!doctype html><input id="secret"><p id="mode">Loading</p><script src="./app.js"></script>'],['app.js','const input=document.querySelector("#secret");input.value=localStorage.getItem("secret")||"";input.addEventListener("input",()=>localStorage.setItem("secret",input.value));document.querySelector("#mode").textContent="Ready";if(parent!==window)parent.postMessage({type:"private-embedding-probe",secret:localStorage.getItem("secret")},"*");']]){const bytes=new TextEncoder().encode(text).buffer;resources.push({path,url:new URL(path,source).href,bytes,sha256:await hash(bytes)});}
   const pkg={id:manifest.id+'-'+await hash(new TextEncoder().encode(source)),manifest,source,resources};return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({operation:'install',payload:pkg},[channel.port2]);});
  });assert.equal(installed.ok,true);await manager.locator('#refresh-apps').click();const link=manager.locator('[data-app="embedding-probe"]');await link.waitFor();const url=await link.getAttribute('href');
  const app=await context.newPage(),response=await app.goto(url);await app.getByText('Ready',{exact:true}).waitFor();const headers=await response.allHeaders();assert.equal(headers['x-frame-options'],'DENY');assert(headers['content-security-policy'].includes("frame-ancestors 'none'"));
  await app.locator('#secret').fill('synthetic-private-embedding-marker');await app.reload();await app.getByText('Ready',{exact:true}).waitFor();assert.equal(await app.locator('#secret').inputValue(),'synthetic-private-embedding-marker');await app.close();
  const attacker=await context.newPage();row.policyObservations=[];attacker.on('console',message=>{if(/frame-ancestors|X-Frame-Options|framing|framed/i.test(message.text()))row.policyObservations.push(message.text());});await attacker.goto(config.examples.find(example=>example.name==='Notes').url);
  const received=await attacker.evaluate(async target=>{
   const messages=[];addEventListener('message',event=>messages.push(event.data));
   const control=document.createElement('iframe');control.srcdoc='<script>parent.postMessage({type:"embedding-control"},"*")<\/script>';document.body.append(control);
   const frame=document.createElement('iframe');frame.src=target;document.body.append(frame);await new Promise(resolve=>setTimeout(resolve,800));
   return {control:messages.some(value=>value?.type==='embedding-control'),leaks:messages.filter(value=>value?.type==='private-embedding-probe')};
  },url);assert.equal(received.control,true);assert.deepEqual(received.leaks,[]);await attacker.close();
  const removed=await bridge.evaluate(id=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({operation:'remove',payload:id},[channel.port2]);}),installed.value.id);assert.equal(removed.ok,true);
  row.checks=['Live app response forbids embedding independently of JavaScript checks','A private value persists in ordinary top-level confined execution','Same-site external parent receives the unrestricted control but no private message'];row.host=hostURL;row.runtime=config.runtimeURL;
 }catch(error){row.failure=error.stack;throw error;}finally{await context.close();await browser.close();}
}}
finally{await writeFile(new URL('../results/embedding-deployed.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
console.log(results.map(r=>`${r.name}: ${r.checks.length} live embedding groups passed`).join('\n'));
