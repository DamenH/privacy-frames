// This is a trusted first-party window, never an application execution context.
// A manager connection is accepted only from the actual opener and a configured
// origin. No manager origin or authority is taken from URL parameters.
const base=new URL('./',location.href),status=document.querySelector('#status');
let controller,port;
async function initialize(){
 const config=await(await fetch(new URL('config.json',base))).json();
 const allowed=new Set(config.managerOrigins||[]);
 window.addEventListener('message',async event=>{
  if(port||event.source!==window.opener||!allowed.has(event.origin)||event.data?.type!=='pf-connect'||event.ports.length!==1){for(const rejected of event.ports)rejected.close();return;}
  const candidate=event.ports[0];
  port=candidate;
  try{
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
   status.textContent='Runtime connected. Keep this window open while managing applications.';
  }catch(error){candidate.postMessage({type:'pf-error',error:error.message});candidate.close();port=null;}
 });
 const ready=(async()=>{
  let registration;
  try{registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});}
  catch(error){registration=await navigator.serviceWorker.getRegistration(base.pathname);if(!registration?.active)throw error;}
  await navigator.serviceWorker.ready;
  if(registration.navigationPreload)await registration.navigationPreload.disable();
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  controller=navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{controller=navigator.serviceWorker.controller;});
 })();
 ready.catch(error=>{status.textContent=error.message;});
 if(!window.opener)status.textContent='Open the runtime from your Privacy Frames library.';
}
initialize().catch(error=>{status.textContent=error.message;});
