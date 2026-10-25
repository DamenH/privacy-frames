// This is a trusted host bridge, never an application execution context.
// A manager connection is accepted only from the actual parent and a configured
// origin. No manager origin or authority is taken from URL parameters.
const base=new URL('./',location.href),status=document.querySelector('#status');
let controller,port,storageRequired=false;
async function initialize(){
 const config=await(await fetch(new URL('config.json',base))).json();
 const allowed=new Set(config.managerOrigins||[]);
 window.addEventListener('message',async event=>{
  if(port||(window.parent===window||event.source!==window.parent)||!allowed.has(event.origin)||event.data?.type!=='pf-connect'||event.ports.length!==1){for(const rejected of event.ports)rejected.close();return;}
  const candidate=event.ports[0];
  port=candidate;
  try{
   if(storageRequired)candidate.postMessage({type:'pf-storage-required'});
   await ready;
   port.onmessage=async message=>{
    const {id,operation,payload}=message.data||{};
    if(!['install','list','remove','events'].includes(operation)){port.postMessage({id,ok:false,error:'Unknown manager operation'});return;}
    const reply=new MessageChannel();
    reply.port1.onmessage=e=>{
     reply.port1.close();
     if(e.data.ok&&operation==='remove')for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith(`pf:${payload}:`))storage.removeItem(key);
     port.postMessage({id,...e.data});
    };
    controller.postMessage({operation,payload},[reply.port2]);
   };
   port.start();port.postMessage({type:'pf-ready',base:base.href});
   status.textContent='Application storage ready.';
  }catch(error){candidate.postMessage({type:'pf-error',error:error.message});candidate.close();port=null;}
 });
 const ready=(async()=>{
  // Try the operations themselves: cookie permission does not prove that IDB,
  // service workers and localStorage share the required storage partition.
  try{localStorage.getItem('pf-storage-check');await indexedDB.databases();}
  catch(error){
   document.documentElement.dataset.runtimeState='storage-required';
   storageRequired=true;port?.postMessage({type:'pf-storage-required'});
   const button=document.querySelector('#reconnect');button.hidden=false;
   status.textContent='Allow access to installed application storage.';
   await new Promise((resolve,reject)=>{button.onclick=async()=>{try{
    if(!document.requestStorageAccess)throw error;
    await document.requestStorageAccess();button.hidden=true;resolve();
   }catch(e){reject(e);}};});
  }

  const initiallyControlled=!!navigator.serviceWorker.controller;
  let registration;
  try{registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});}
  catch(error){registration=await navigator.serviceWorker.getRegistration(base.pathname);if(!registration?.active)throw error;}
  await navigator.serviceWorker.ready;
  if(registration.navigationPreload)await registration.navigationPreload.disable();
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  if(!initiallyControlled){location.reload();await new Promise(()=>{});}
  controller=navigator.serviceWorker.controller;document.documentElement.dataset.runtimeState='ready';
  navigator.serviceWorker.addEventListener('controllerchange',()=>{controller=navigator.serviceWorker.controller;});
 })();
 ready.catch(error=>{document.documentElement.dataset.runtimeState='failed';status.textContent=error.message;});
 if(window.parent===window)status.textContent='Open the application library to manage installations.';
}
initialize().catch(error=>{document.documentElement.dataset.runtimeState='failed';status.textContent=error.message;});
