import {downloadPackage} from './package.js';
import {applicationURL} from './runtime-url.js';

const $=selector=>document.querySelector(selector);
const base=new URL('./',location.href);
let worker;
let runtimeBase=base;
let remotePort,remoteFrame,sequence=0,connecting;
const pending=new Map();
function disconnectRuntime(error){
 remotePort?.close();remotePort=null;connecting=null;
 for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}
 pending.clear();
}
function connectRuntime(){
 if(remotePort&&remoteFrame?.isConnected)return Promise.resolve();
 if(connecting)return connecting;
 remoteFrame?.remove();
 const frame=document.createElement('iframe');remoteFrame=frame;
 frame.id='runtime-bridge';frame.title='Application storage';frame.hidden=true;
 frame.setAttribute('allow','storage-access');
 connecting=new Promise((resolve,reject)=>{
  const attempts=new Set();let retry,timer,settled=false;
  const cleanup=keep=>{clearInterval(retry);clearTimeout(timer);for(const port of attempts)if(port!==keep)port.close();attempts.clear();};
  const failed=error=>{if(settled)return;settled=true;cleanup();disconnectRuntime(error);frame.remove();reject(error);};
  frame.onerror=()=>failed(new Error('Application storage could not load.'));
  frame.onload=()=>{
   if(settled){disconnectRuntime(new Error('Application storage reloaded. Try again.'));return;}
   clearInterval(retry);for(const port of attempts)port.close();attempts.clear();
   retry=setInterval(()=>{
    const attempt=new MessageChannel();attempts.add(attempt.port1);
    attempt.port1.onmessage=event=>{
     if(event.data?.type==='pf-storage-required'){
      frame.hidden=false;frame.className='storage-permission';status('Allow application storage to continue.');return;
     }
     if(event.data?.type==='pf-error'){failed(new Error(event.data.error));return;}
     if(event.data?.type!=='pf-ready'||event.data.base!==runtimeBase.href)return;
     settled=true;cleanup(attempt.port1);frame.hidden=true;remotePort=attempt.port1;
     remotePort.onmessage=event=>{const request=pending.get(event.data?.id);if(!request)return;pending.delete(event.data.id);clearTimeout(request.timer);event.data.ok?request.resolve(event.data.value):request.reject(new Error(event.data.error));};
     remotePort.onmessageerror=()=>disconnectRuntime(new Error('Application storage connection failed.'));
     resolve();
    };
    frame.contentWindow.postMessage({type:'pf-connect'},runtimeBase.origin,[attempt.port2]);
   },200);
  };
  timer=setTimeout(()=>failed(new Error('Application storage connection timed out.')),60000);
  frame.src=new URL('connect.html',runtimeBase);document.body.append(frame);
 });
 return connecting;
}

async function initialize(manage=true){
 if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');
 const initiallyControlled=!!navigator.serviceWorker.controller;
 let registration;
 try{registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});}
 catch(error){registration=await navigator.serviceWorker.getRegistration(base.pathname);if(!registration?.active)throw error;}
 await navigator.serviceWorker.ready;
 if(registration.navigationPreload)await registration.navigationPreload.disable();
 if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
 if(!initiallyControlled){location.reload();await new Promise(()=>{});}
 worker=navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{worker=navigator.serviceWorker.controller;});
 if(manage){await refresh();status('Ready to install.');}
}

async function request(operation,payload){
 if(runtimeBase.origin!==base.origin||runtimeBase.pathname!==base.pathname){
  await connectRuntime();
  return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Runtime request timed out.'));},30000);pending.set(id,{resolve,reject,timer});remotePort.postMessage({id,operation,payload});});
 }
 if(!worker)throw new Error('Host is not ready.');
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel();
  const timer=setTimeout(()=>{channel.port1.close();reject(new Error('Host request timed out.'));},25000);
  channel.port1.onmessage=event=>{
   clearTimeout(timer);channel.port1.close();
   if(!event.data.ok){reject(new Error(event.data.error));return;}
   if(operation==='remove'){
    const prefix=`pf:${payload}:`;
    for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith(prefix))storage.removeItem(key);
   }
   resolve(event.data.value);
  };
  worker.postMessage({operation,payload},[channel.port2]);
 });
}

function status(text,error=false){$('#status').textContent=text;$('#status').dataset.error=String(error);}
function node(tag,text,className){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
async function refresh(){
 const apps=await request('list');
 localStorage.setItem('privacy-frames-library',JSON.stringify(apps));
 render(apps);
}
function render(apps){
 $('#app-list').replaceChildren();$('#count').textContent=String(apps.length);$('#empty').hidden=apps.length>0;
 for(const app of apps){
  const row=node('article',null,'app-card'),info=node('div',null,'app-info');
  info.append(node('h3',app.manifest.name),node('p',new URL(app.source).hostname,'source'));
  const actions=node('div',null,'actions'),launch=node('a','Open','button');
  launch.href=applicationURL(app,runtimeBase).href;
  launch.target='_blank';launch.rel='noopener noreferrer';launch.dataset.app=app.manifest.id;launch.dataset.installation=app.id;
  const remove=node('button','Remove','quiet');remove.type='button';
  remove.addEventListener('click',async()=>{try{await request('remove',app.id);await refresh();status('Removed.');}catch(error){status(error.message,true);}});
  actions.append(launch,remove);row.append(info,actions);$('#app-list').append(row);
 }
}

$('#install').addEventListener('submit',async event=>{
 event.preventDefault();const button=$('#install button');button.disabled=true;
 try{
  if(runtimeBase.origin!==base.origin||runtimeBase.pathname!==base.pathname)await connectRuntime();
  status('Downloading…');const pkg=await downloadPackage($('#app-url').value.trim(),{onProgress:status});
  status('Installing…');await request('install',pkg);await refresh();
  status(`Installed ${pkg.manifest.name}.`);$('#app-url').value='';
 }catch(error){status(`Installation refused: ${error.message}`,true);}
 finally{button.disabled=false;}
});

$('#refresh-events').addEventListener('click',async()=>{
 try{const events=await request('events');$('#events').textContent=events.length?events.slice(-40).reverse().map(e=>`${e.kind.toUpperCase()}  ${e.method}  ${e.url}`).join('\n'):'No runtime requests recorded.';}
 catch(error){status(error.message,true);}
});
$('#refresh-apps').addEventListener('click',async()=>{try{await refresh();status('Ready to install.');}catch(error){status(error.message,true);}});

try{
 const response=await fetch(new URL('config.json',base));if(!response.ok)throw new Error('Host configuration unavailable.');
 const config=await response.json();
 if(config.managerURL&&new URL(config.managerURL).origin!==location.origin){location.replace(config.managerURL);throw new Error('Opening the application library…');}
 if(config.runtimeURL)runtimeBase=new URL(config.runtimeURL);
 for(const app of config.examples||[]){
  const button=node('button',app.name,'example');button.type='button';
  button.title=app.url;
  button.addEventListener('click',()=>{$('#app-url').value=app.url;$('#app-url').focus();});
  $('#examples').append(button);
 }
 if(runtimeBase.origin!==base.origin||runtimeBase.pathname!==base.pathname){
  await initialize(false);
  try{render(JSON.parse(localStorage.getItem('privacy-frames-library')||'[]'));}catch{render([]);}
  await refresh();status('Ready to install.');
 }else await initialize();
 $('#refresh-apps').disabled=false;
}catch(error){status(error.message,true);}
