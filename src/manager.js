import {downloadPackage} from './package.js';

const $=selector=>document.querySelector(selector);
const base=new URL('./',location.href);
let worker;

async function initialize(){
 if(!('serviceWorker' in navigator))throw new Error('This browser does not support service workers.');
 let registration;
 try{registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});}
 catch(error){registration=await navigator.serviceWorker.getRegistration(base.pathname);if(!registration?.active)throw error;}
 await navigator.serviceWorker.ready;
 if(registration.navigationPreload)await registration.navigationPreload.disable();
 if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
 worker=navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{worker=navigator.serviceWorker.controller;});
 await refresh();
 status('Ready to install.');
}

async function request(operation,payload){
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
 $('#app-list').replaceChildren();$('#count').textContent=String(apps.length);$('#empty').hidden=apps.length>0;
 for(const app of apps){
  const row=node('article',null,'app-card'),info=node('div',null,'app-info');
  info.append(node('h3',app.manifest.name),node('p',new URL(app.source).hostname,'source'));
  const actions=node('div',null,'actions'),launch=node('a','Open','button');
  launch.href=new URL(`run/${app.id}/${app.manifest.entry}`,base).href;
  launch.target='_blank';launch.rel='noopener noreferrer';launch.dataset.app=app.manifest.id;launch.dataset.installation=app.id;
  const remove=node('button','Remove','quiet');remove.type='button';
  remove.addEventListener('click',async()=>{try{await request('remove',app.id);await refresh();status('Removed.');}catch(error){status(error.message,true);}});
  actions.append(launch,remove);row.append(info,actions);$('#app-list').append(row);
 }
}

$('#install').addEventListener('submit',async event=>{
 event.preventDefault();const button=$('#install button');button.disabled=true;
 try{
  status('Downloading…');const pkg=await downloadPackage($('#app-url').value.trim());
  status('Installing…');await request('install',pkg);await refresh();
  status(`Installed ${pkg.manifest.name}.`);$('#app-url').value='';
 }catch(error){status(`Installation refused: ${error.message}`,true);}
 finally{button.disabled=false;}
});

$('#refresh-events').addEventListener('click',async()=>{
 try{const events=await request('events');$('#events').textContent=events.length?events.slice(-40).reverse().map(e=>`${e.kind.toUpperCase()}  ${e.method}  ${e.url}`).join('\n'):'No runtime requests recorded.';}
 catch(error){status(error.message,true);}
});

try{
 const response=await fetch(new URL('config.json',base));if(!response.ok)throw new Error('Host configuration unavailable.');
 const config=await response.json();
 for(const app of config.examples||[]){
  const button=node('button',app.name,'example');button.type='button';
  button.title=app.url;
  button.addEventListener('click',()=>{$('#app-url').value=app.url;$('#app-url').focus();});
  $('#examples').append(button);
 }
 await initialize();
}catch(error){status(error.message,true);}
