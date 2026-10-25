import 'ses';
import {validateMarkup,elementAllowed} from './package.js';
import {applicationIdentity,publicAlias} from './runtime-url.js';
import {scopeIndexedDB} from './scoped-idb.js';
import {scopeCaches} from './scoped-caches.js';
import {preparedWorker} from './prepared-worker.js';
import {resourceAliases} from './resource-aliases.js';

// Only this trusted script exists in the initial document. Application content
// and scripts are loaded from a verified worker response after setup succeeds.
const rawHTML=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML').set;
const rawCreate=Document.prototype.createElement,rawAppend=Node.prototype.appendChild;
const rawAttr=Element.prototype.setAttribute;
const rawGetAttr=Element.prototype.getAttribute;
const trustedHead=document.head,trustedBody=document.body;
const nativeApply=Reflect.apply;
// This code is always parser-blocking and precedes all application markup.
// No native method captured here is published to application code.
try {
 lockdown({evalTaming:'unsafe-eval',errorTaming:'safe',consoleTaming:'safe',overrideTaming:'severe'});
 const apply=Reflect.apply, descriptor=Object.getOwnPropertyDescriptor, define=Object.defineProperty;
 const str=String, array=Array.from;
 const fail=message=>{throw new DOMException(message,'SecurityError')};
 let applicationWorker=null;
 const deny=()=>fail('Operation prohibited by application host');
 function method(owner,key,replace){const d=descriptor(owner,key);if(!d)return;if(d.value===replace)return; if(!d.configurable&&(!('value'in d)||!d.writable))throw new Error(`Cannot protect ${key}`);define(owner,key,{value:replace,writable:false,configurable:false,enumerable:d.enumerable});}
 function accessor(owner,key,replacement){const d=descriptor(owner,key);if(!d)return;if(!d.configurable)throw new Error(`Cannot protect ${key}`);define(owner,key,{...d,...replacement,configurable:false});}
 function propertyOwner(object,key){for(let p=object;p;p=Object.getPrototypeOf(p))if(Object.hasOwn(p,key))return p;}
 const resources=resourceAliases({method,accessor,descriptor,apply});
 const prevent=Event.prototype.preventDefault;
 const nativeAdd=EventTarget.prototype.addEventListener;
 const nav=window.navigation;
 if(!nav||typeof NavigateEvent!=='function')throw new Error('Navigation API required');
 const nativeHash=descriptor(NavigateEvent.prototype,'hashChange').get;
 apply(nativeAdd,nav,['navigate',event=>{if(!apply(nativeHash,event,[]))apply(prevent,event,[])},{capture:true}]);
 const modifier=['ctrlKey','metaKey','shiftKey','altKey'].map(k=>descriptor(MouseEvent.prototype,k).get);
 apply(nativeAdd,window,['click',e=>{if(modifier.some(get=>apply(get,e,[])))apply(prevent,e,[])},{capture:true}]);
 for(const name of ['auxclick','contextmenu'])apply(nativeAdd,window,[name,e=>apply(prevent,e,[]),{capture:true}]);
 // The browser's own rich-HTML insertion must not bypass parser admission.
 for(const name of ['paste','drop'])apply(nativeAdd,window,[name,event=>{const transfer=event.clipboardData||event.dataTransfer;if(transfer&&array(transfer.types||[]).includes('text/html'))apply(prevent,event,[])},{capture:true}]);
 method(window,'open',deny);method(window,'print',deny);
 if(globalThis.DocumentPictureInPicture)method(DocumentPictureInPicture.prototype,'requestWindow',deny);
 const pipOwner=propertyOwner(window,'documentPictureInPicture');if(pipOwner)accessor(pipOwner,'documentPictureInPicture',{get:deny});
 method(Document.prototype,'execCommand',deny);
 for(const key of ['cookie','domain']){const owner=propertyOwner(document,key);if(owner)accessor(owner,key,{get:deny,set:deny});}
 const cookieOwner=propertyOwner(window,'cookieStore');if(cookieOwner)accessor(cookieOwner,'cookieStore',{get:deny});
 for(const key of ['open','write','writeln'])method(Document.prototype,key,deny);
 for(const key of ['back','forward','go'])method(History.prototype,key,deny);
 const NativeURL=URL,initialURL=new NativeURL(location.href);
 for(const key of ['pushState','replaceState']){const fn=History.prototype[key];method(History.prototype,key,function(state,title,url){if(url!==undefined&&url!==null){const target=new NativeURL(str(url),location.href);if(target.origin!==initialURL.origin||target.pathname!==initialURL.pathname||target.search!==initialURL.search)fail('Only fragment history is admitted');}return apply(fn,this,[state,str(title),url]);});}

 for(const key of ['back','forward','traverseTo'])method(Navigation.prototype,key,deny);

 // Guard browser parsing before it can create nodes. Validators run with frozen JS intrinsics.
 const textHTML=value=>{const text=str(value);validateMarkup(text);return text;};
 for(const proto of [Element.prototype,ShadowRoot.prototype]){
  for(const key of ['innerHTML','outerHTML']){
   const d=descriptor(proto,key);if(d?.set)accessor(proto,key,{set(value){return apply(d.set,this,[textHTML(value)])}});
  }
  for(const key of ['setHTML','setHTMLUnsafe','getHTML'])if(key!=='getHTML')method(proto,key,deny);
 }
 const adjacent=Element.prototype.insertAdjacentHTML;
 method(Element.prototype,'insertAdjacentHTML',function(position,html){return apply(adjacent,this,[str(position),textHTML(html)])});
 method(Range.prototype,'createContextualFragment',deny);
 method(DOMParser.prototype,'parseFromString',deny);
 for(const key of ['parseHTML','parseHTMLUnsafe'])method(Document,key,deny);
 for(const key of ['createHTMLDocument','createDocument','createDocumentType'])method(DOMImplementation.prototype,key,deny);
 method(Element.prototype,'attachInternals',deny);
 // Declarative/custom element constructors must not introduce hidden insertion behavior.
 if(globalThis.CustomElementRegistry)for(const key of ['define','initialize','upgrade'])method(CustomElementRegistry.prototype,key,deny);

 const create=Document.prototype.createElement, createNS=Document.prototype.createElementNS;
 method(Document.prototype,'createElement',function(name,options){const tag=str(name);elementAllowed(tag);if(options!==undefined)fail('Customized built-in elements are not admitted');if(['script','meta'].includes(tag.toLowerCase()))fail('Dynamic policy/resource elements are not admitted');return apply(create,this,[tag])});
 method(Document.prototype,'createElementNS',function(namespace,name,options){const ns=str(namespace),tag=str(name);elementAllowed(tag);if(!['http://www.w3.org/1999/xhtml','http://www.w3.org/2000/svg','http://www.w3.org/1998/Math/MathML'].includes(ns)||options!==undefined)fail('Unsupported namespace/options');if(['script','link','meta'].includes(tag.toLowerCase()))fail('Dynamic policy/resource elements are not admitted');return apply(createNS,this,[ns,tag])});
 const nodeType=descriptor(Node.prototype,'nodeType').get;
 const first=descriptor(Node.prototype,'firstChild').get,next=descriptor(Node.prototype,'nextSibling').get;
 const local=descriptor(Element.prototype,'localName').get;
 const template=globalThis.HTMLTemplateElement&&descriptor(HTMLTemplateElement.prototype,'content').get;
 function inspect(node){
  let type;try{type=apply(nodeType,node,[])}catch{return;}
  if(type===1){const tag=apply(local,node,[]);elementAllowed(tag);if(['script','link','meta'].includes(tag.toLowerCase()))fail('Dynamic policy/resource elements are not admitted');if(tag==='template'&&template)inspect(apply(template,node,[]));}
  for(let child=apply(first,node,[]);child;child=apply(next,child,[]))inspect(child);
 }
 function insertion(proto,key,indices){const fn=proto&&proto[key];if(typeof fn!=='function')return;method(proto,key,function(...args){for(const i of indices?indices(args):args.map((_,i)=>i))inspect(args[i]);return apply(fn,this,args)});}
 for(const name of ['appendChild','insertBefore','replaceChild'])insertion(Node.prototype,name,()=>[0]);
 for(const proto of [Element.prototype,Document.prototype,DocumentFragment.prototype])for(const name of ['append','prepend','replaceChildren'])insertion(proto,name);
 for(const proto of [Element.prototype,CharacterData.prototype,DocumentType.prototype])for(const name of ['before','after','replaceWith'])insertion(proto,name);
 insertion(Element.prototype,'insertAdjacentElement',()=>[1]);
 insertion(Range.prototype,'insertNode',()=>[0]);
 insertion(Range.prototype,'surroundContents',()=>[0]);
 // Getter restrictions add protection if a context-producing browser path is missed.
 for(const ctor of [globalThis.HTMLIFrameElement,globalThis.HTMLFrameElement,globalThis.HTMLObjectElement,globalThis.HTMLEmbedElement])if(ctor){for(const key of ['contentWindow','contentDocument','getSVGDocument']){const d=descriptor(ctor.prototype,key);if(d?.get)accessor(ctor.prototype,key,{get:deny});else if(d?.value)method(ctor.prototype,key,deny);}}

 // Reflected properties and Attr objects must not bypass element policy.
 for(const ctor of [globalThis.HTMLLinkElement,globalThis.HTMLMetaElement,globalThis.HTMLScriptElement])if(ctor){
  for(const key of Object.getOwnPropertyNames(ctor.prototype)){const d=descriptor(ctor.prototype,key);if(d?.set||key==='relList')accessor(ctor.prototype,key,{...(d?.set?{set(value){if(ctor===globalThis.HTMLMetaElement&&key==='content'&&apply(rawGetAttr,this,['name'])==='theme-color'&&apply(rawGetAttr,this,['http-equiv'])===null)return apply(d.set,this,[str(value)]);return deny();}}:{}),...(key==='relList'?{get(){const list=apply(d.get,this,[]);return Object.freeze({supports:token=>list.supports(str(token)),contains:token=>list.contains(str(token)),item:index=>list.item(index),get length(){return list.length},get value(){return list.value},toString:()=>list.value,add:deny,remove:deny,toggle:deny,replace:deny,[Symbol.iterator]:()=>list[Symbol.iterator]()});}}:{})});}
 }

 const ownerElement=descriptor(Attr.prototype,'ownerElement').get;
 const sensitive=node=>{const tag=apply(local,node,[]).toLowerCase();if(['link','meta','script'].includes(tag))fail('Policy element is immutable');};
 for(const [proto,key]of [[Attr.prototype,'value'],[Node.prototype,'nodeValue'],[Node.prototype,'textContent']]){const d=descriptor(proto,key);if(d?.set)accessor(proto,key,{set(value){if(apply(nodeType,this,[])===2){const owner=apply(ownerElement,this,[]);if(owner)sensitive(owner);}return apply(d.set,this,[value]);}});}
 for(const key of ['setAttributeNode','setAttributeNodeNS']){const fn=Element.prototype[key];method(Element.prototype,key,function(...args){sensitive(this);const attr=args[0];const attrName=str(attr?.name||'').toLowerCase();if(['srcdoc','is'].includes(attrName)||attrName.startsWith('on'))fail('Attribute not admitted');return apply(fn,this,args)});}
 // NamedNodeMap setters can recover their target only after mutation. Refuse them.
 for(const key of ['setNamedItem','setNamedItemNS'])method(NamedNodeMap.prototype,key,deny);
 // Remove alternate agents/transports, including prototype recovery routes.
 for(const key of ['WebSocket','WebTransport','RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','Worker','SharedWorker','ShadowRealm','BroadcastChannel','EventSource','Notification','PresentationRequest','fetchLater','PendingGetBeacon','PendingPostBeacon','TCPSocket','UDPSocket','WebSocketStream','NDEFReader'])if(key in window)method(window,key,deny);
 for(const key of Object.getOwnPropertyNames(window).filter(k=>/^(RTC|webkitRTC)/.test(k)))method(window,key,deny);
 if(globalThis.Worklet)method(Worklet.prototype,'addModule',deny);
 // Browser-mediated services are not necessarily ordinary document fetches.
 // Keep local Web Audio, but exclude remote speech/casting and URL-bearing OS
 // media artwork. Text-only media metadata used by players remains available.
 if(globalThis.SpeechSynthesis)method(SpeechSynthesis.prototype,'speak',deny);
 for(const ctor of [globalThis.SpeechRecognition,globalThis.webkitSpeechRecognition])if(ctor)method(ctor.prototype,'start',deny);
 if(globalThis.RemotePlayback)for(const key of ['prompt','watchAvailability','cancelWatchAvailability'])method(RemotePlayback.prototype,key,deny);
 if(globalThis.MediaMetadata&&globalThis.MediaSession){
  const artwork=descriptor(MediaMetadata.prototype,'artwork'),chapters=descriptor(MediaMetadata.prototype,'chapterInfo'),metadata=descriptor(MediaSession.prototype,'metadata');
  if(artwork?.set)accessor(MediaMetadata.prototype,'artwork',{set(value){if(array(value).length)deny();return apply(artwork.set,this,[[]]);}});
  if(metadata?.set)accessor(MediaSession.prototype,'metadata',{set(value){if(value!==null&&(artwork?.get&&apply(artwork.get,value,[]).length||chapters?.get&&apply(chapters.get,value,[]).length))deny();return apply(metadata.set,this,[value]);}});
 }
 for(const ctor of [globalThis.ServiceWorkerContainer,globalThis.ServiceWorkerRegistration,globalThis.ServiceWorker,globalThis.NavigationPreloadManager])if(ctor)for(const key of ['register','getRegistration','getRegistrations','startMessages','update','unregister','postMessage','enable','disable','setHeaderValue','getState'])method(ctor.prototype,key,deny);
 if(globalThis.Navigator){const owner=propertyOwner(navigator,'serviceWorker');if(owner)accessor(owner,'serviceWorker',{get:()=>applicationWorker||deny()});for(const key of ['sendBeacon','share','registerProtocolHandler','unregisterProtocolHandler','runAdAuction','joinAdInterestGroup','leaveAdInterestGroup','updateAdInterestGroups','getInterestGroupAdAuctionData','createAuctionNonce','deprecatedReplaceInURN','deprecatedURNToURL'])method(Navigator.prototype,key,deny);}
 if(globalThis.CredentialsContainer)for(const key of ['get','create','store','preventSilentAccess'])method(CredentialsContainer.prototype,key,deny);
 if(globalThis.Navigator)for(const key of ['presentation','storage']){const owner=propertyOwner(navigator,key);if(owner)accessor(owner,key,{get:deny});}
 if(globalThis.Clipboard)for(const key of ['write','writeText'])method(Clipboard.prototype,key,deny);
 for(const key of ['sharedStorage']){const owner=propertyOwner(window,key);if(owner)accessor(owner,key,{get:deny});}
 // Management state is inaccessible; provide application-scoped Storage-compatible methods.
 const guardURL=new URL(document.currentScript.src);
 const app=document.currentScript.getAttribute('data-installation');
 const route=applicationIdentity(location.href,new URL('./',guardURL));
 if(!app||!(route===app||route===publicAlias(app)))throw new Error('Invalid runtime identity');
 const prefix=`pf:${app}:`;
 const scopedCaches=scopeCaches({prefix,method,apply});
 {const owner=propertyOwner(window,'caches');accessor(owner,'caches',{get:()=>scopedCaches});}
 const scopedIDB=scopeIndexedDB({prefix,method,accessor,descriptor,apply,fail});
 for(const key of ['indexedDB','webkitIndexedDB','mozIndexedDB','msIndexedDB']){const owner=propertyOwner(window,key);if(owner)accessor(owner,key,{get:()=>scopedIDB});}
 const storageViews=new Map();
 for(const key of ['localStorage','sessionStorage']){
  const owner=propertyOwner(window,key),d=descriptor(owner,key),native=apply(d.get,window,[]);
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,keyAt=Storage.prototype.key;
  const length=descriptor(Storage.prototype,'length').get;
  const keys=()=>{const result=[];for(let i=0;i<apply(length,native,[]);i++){const k=apply(keyAt,native,[i]);if(k?.startsWith(prefix))result.push(k.slice(prefix.length));}return result;};
  const text=value=>{if(typeof value==='symbol')throw new TypeError('Storage strings cannot be symbols');return str(value);};
  const required=(count,minimum)=>{if(count<minimum)throw new TypeError('Missing required Storage argument');};
  const api=Object.freeze({
   getItem:function(k){required(arguments.length,1);return apply(get,native,[prefix+text(k)]);},
   setItem:function(k,v){required(arguments.length,2);return apply(set,native,[prefix+text(k),text(v)]);},
   removeItem:function(k){required(arguments.length,1);return apply(remove,native,[prefix+text(k)]);},
   clear:()=>keys().forEach(k=>apply(remove,native,[prefix+k])),
   key:function(i){required(arguments.length,1);return keys()[(+i)>>>0]??null;},
  });
  const proxy=new Proxy(Object.create(Storage.prototype),{
   get:(target,k)=>k==='length'?keys().length:Object.hasOwn(api,k)?api[k]:typeof k==='string'&&keys().includes(k)?api.getItem(k):Reflect.get(target,k),
   set:(_,k,v)=>{if(typeof k!=='string')return false;api.setItem(k,v);return true},
   deleteProperty:(_,k)=>{if(typeof k==='string')api.removeItem(k);return true},
   has:(target,k)=>typeof k==='string'&&keys().includes(k)||Reflect.has(target,k),
   ownKeys:keys,
   getOwnPropertyDescriptor:(_,k)=>keys().includes(k)?{enumerable:true,configurable:true,writable:true,value:api.getItem(k)}:undefined,
   defineProperty:(_,k,d)=>{if(typeof k!=='string'||!('value'in d)||d.configurable===false||d.enumerable===false||d.writable===false)return false;api.setItem(k,d.value);return true},
   preventExtensions:()=>false,setPrototypeOf:()=>false,
  });
  accessor(owner,key,{get:()=>proxy});
  storageViews.set(native,proxy);
 }
 // Storage events carry a native Storage reference independently of the window
 // getters. Filter before application listeners and mediate every exposed field.
 if(globalThis.StorageEvent){
  const eventStorage=descriptor(StorageEvent.prototype,'storageArea').get;
  const eventKey=descriptor(StorageEvent.prototype,'key').get;
  const stop=Event.prototype.stopImmediatePropagation;
  const belongs=event=>{const area=apply(eventStorage,event,[]),key=apply(eventKey,event,[]);return storageViews.has(area)&&typeof key==='string'&&key.startsWith(prefix);};
  apply(nativeAdd,window,['storage',event=>{if(!belongs(event))apply(stop,event,[])},{capture:true}]);
  accessor(StorageEvent.prototype,'storageArea',{get(){return storageViews.get(apply(eventStorage,this,[]))??null;}});
  accessor(StorageEvent.prototype,'key',{get(){const key=apply(eventKey,this,[]);return belongs(this)?key.slice(prefix.length):null;}});
  for(const key of ['oldValue','newValue','url']){const get=descriptor(StorageEvent.prototype,key).get;accessor(StorageEvent.prototype,key,{get(){return belongs(this)?apply(get,this,[]):key==='url'?'':null;}});}
 }
 // Storage Access handles can expose native storage through another API.
 for(const key of ['requestStorageAccess','requestStorageAccessFor'])method(Document.prototype,key,deny);
 for(const key of ['requestFileSystem','webkitRequestFileSystem','resolveLocalFileSystemURL','webkitResolveLocalFileSystemURL','openDatabase'])method(window,key,deny);
 for(const key of ['getItem','setItem','removeItem','clear','key'])method(Storage.prototype,key,deny);
 // Policy elements can only be emitted by installation; prevent attribute-based activation.
 for(const name of ['setAttribute','setAttributeNS','toggleAttribute']){
  const fn=Element.prototype[name];method(Element.prototype,name,function(...args){const tag=apply(local,this,[]).toLowerCase();if(['link','meta','script'].includes(tag))fail('Policy element is immutable');const key=str(args[name==='setAttributeNS'?1:0]).toLowerCase();if(key==='srcdoc'||key==='is'||key.startsWith('on'))fail('Attribute not admitted');if(name!=='toggleAttribute'&&['src','href','poster','xlink:href'].includes(key)){const index=name==='setAttributeNS'?2:1;args[index]=resources.mapURL(args[index]);}return apply(fn,this,args)});
 }
 // Static metadata contains no host authority; applications may inspect it.

 document.documentElement.dataset.hostReady='true';
 const content=new URL(location.href);content.search='?host-content=1';
 fetch(content).then(r=>{if(!r.ok)throw new Error('Installed content unavailable');return r.json()}).then(async data=>{
  // Markup was independently validated by the worker. No app script executes in this parsing step.
  validateMarkup(data.head,{initial:true});validateMarkup(data.body,{initial:true});
  resources.install(data.aliases||[]);
  applicationWorker=preparedWorker(data.serviceWorker,{source:data.source,runtime:location.href,fail});
  define(window,'privacyHost',{value:Object.freeze({version:1,application:app,publisher:new NativeURL(data.source).origin,mode:'network-isolated'}),writable:false,configurable:false});
  // Keep the bootstrap's manifest link continuously attached. Native PWA
  // installation can inspect it while the asynchronous app content is loading.
  const template=nativeApply(rawCreate,document,['template']);nativeApply(rawHTML,template,[data.head]);
  for(const child of Array.from(template.content.childNodes))nativeApply(rawAppend,trustedHead,[child]);
  nativeApply(rawHTML,trustedBody,[data.body]);
  if(data.manifestURL&&!document.querySelector('link[rel="manifest"]')){const link=nativeApply(rawCreate,document,['link']);nativeApply(rawAttr,link,['rel','manifest']);nativeApply(rawAttr,link,['href',data.manifestURL]);nativeApply(rawAppend,trustedHead,[link]);}
  for(const script of data.scripts){
   await new Promise((resolve,reject)=>{const node=nativeApply(rawCreate,document,['script']);nativeApply(rawAttr,node,['src',script.src]);if(script.type)nativeApply(rawAttr,node,['type',script.type]);node.onload=resolve;node.onerror=()=>reject(new Error('Installed script failed'));nativeApply(rawAppend,trustedHead,[node]);});
  }
 }).catch(error=>{nativeApply(rawHTML,trustedBody,['<h1>Application could not start</h1><p>Reload or reinstall this application.</p>']);console.error(error)});
} catch(error) {
 // Parsing must never proceed into untrusted scripts after setup failure.
 nativeApply(rawHTML,trustedBody,['<h1>Application refused</h1><p>The browser could not establish the required runtime restrictions.</p>']);
 throw error;
}
