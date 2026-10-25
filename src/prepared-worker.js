// This compatibility object reports completed precaching, never a native worker
// registration. Publisher fetch handlers cannot control the isolated document.
export function preparedWorker(receipt,{source,runtime,fail}){
 if(!receipt||receipt.profile!=='precache-v1'||!receipt.completed?.includes('install')||!receipt.completed?.includes('activate'))return null;
 const original=new URL(receipt.scriptURL),publisher=new URL(source),origin=new URL(runtime).origin,virtual=new URL('sw.js',new URL('./',runtime)),virtualScope=new URL('./',virtual);
 const unsupported=()=>Promise.reject(new DOMException('Application worker operation is not supported by this host','NotSupportedError'));
 function admitted(input){const url=new URL(String(input),document.baseURI);return url.href===original.href||url.href===virtual.href||url.origin===origin&&url.pathname===original.pathname&&url.search===original.search;}
 const active=Object.freeze(Object.assign(new EventTarget(),{state:'activated',scriptURL:virtual.href,postMessage(){fail('Publisher worker messaging is not available');}}));
 const registration=Object.freeze(Object.assign(new EventTarget(),{
  scope:virtualScope.href,active,installing:null,waiting:null,update:unsupported,unregister:unsupported,
  navigationPreload:Object.freeze({getState:async()=>({enabled:false,headerValue:'true'}),enable:unsupported,disable:unsupported,setHeaderValue:unsupported}),
 }));
 return Object.freeze(Object.assign(new EventTarget(),{
  controller:active,ready:Promise.resolve(registration),
  async register(input,options={}){if(!admitted(input))fail('Only the prepared application worker is available');if(options.scope!==undefined){const scope=new URL(options.scope,document.baseURI),expected=new URL(receipt.scope);if(![origin,publisher.origin].includes(scope.origin)||![expected.pathname,virtualScope.pathname].includes(scope.pathname))fail('Worker scope differs from prepared scope');}return registration;},
  async getRegistration(input){if(input!==undefined){const url=new URL(input,document.baseURI);if(![origin,publisher.origin].includes(url.origin)||![new URL(receipt.scope).pathname,virtualScope.pathname].some(path=>url.pathname.startsWith(path)))return;}return registration;},
  async getRegistrations(){return[registration];},startMessages(){},
 }));
}
