import test from 'node:test';import assert from 'node:assert/strict';
import {prepareDocument,cssReferences} from '../src/document.js';
import {applicationURL,applicationIdentity,publicAlias} from '../src/runtime-url.js';
import {webManifest} from '../src/pwa.js';
const app={id:'pitch-training-cb0257e77b5a1a7925a6540f3d1a49cbb9511ebd0246f3807acecb7f3db1036f',source:'https://publisher.test/app/',manifest:{id:'pitch-training',name:'Pitch Training',entry:'index.html'},resources:[]};
test('short alias is source-derived and label does not select identity',()=>{
 assert.equal(publicAlias(app.id),'ywJX53taGnk');const url=applicationURL(app,'https://runtime.test/');assert.equal(url.href,'https://runtime.test/ywJX53taGnk/pitch-training/');
 assert.equal(applicationIdentity('https://runtime.test/ywJX53taGnk/wrong/#/reference','https://runtime.test/'),'ywJX53taGnk');assert.equal(applicationIdentity('https://other.test/ywJX53taGnk/pitch-training/','https://runtime.test/'),null);
 assert.equal(publicAlias(app.id),publicAlias('different-'+app.id.slice(-64)));
});
test('generic document base is resolved once and removed before admission',()=>{
 const result=prepareDocument('<base href="/assets/"><base href="https://ignored.test/"><title>Document</title><link rel="manifest" href="../app.webmanifest"><link rel="stylesheet" href="sheet.css"><style>p{background:url(bg.svg)}</style><img src="photo.png" srcset="large.png 2x"><a href="#section">Section</a>','https://publisher.test/docs/index.html');
 assert(!result.html.includes('<base'));assert.equal(result.manifestURL,'https://publisher.test/app.webmanifest');assert(result.links.includes('https://publisher.test/assets/sheet.css'));assert(result.links.includes('https://publisher.test/assets/bg.svg'));assert(result.links.includes('https://publisher.test/assets/photo.png'));assert(!result.html.includes('srcset='));assert(!result.links.includes('https://ignored.test/'));
 assert.throws(()=>prepareDocument('<base href="/assets/"><template><iframe></iframe></template>','https://publisher.test/'));
});
test('CSS dependency discovery handles imports, relative resources and cycles without following data',()=>{
 assert.deepEqual(cssReferences('@import "theme.css";p{background:url(../bg.svg)}b{mask:url(data:image/svg+xml,x)}','https://publisher.test/css/main.css'),['https://publisher.test/css/theme.css','https://publisher.test/bg.svg']);
});
test('manifest adapts identity, hash launch and presentation without granting handlers',()=>{
 const value={name:'Publisher name',short_name:'Short',start_url:'./#/reference',scope:'/',display:'standalone',theme_color:'#123456',file_handlers:[{action:'https://attacker.test/'}],protocol_handlers:[{protocol:'web+bad'}],shortcuts:[{name:'Reference',url:'./#/reference'},{name:'Outside',url:'https://attacker.test/'}]};
 const manifest=webManifest({...app,publisherManifest:{value,url:'https://publisher.test/app/manifest.webmanifest'}},'https://runtime.test/');
 assert.equal(manifest.name,'Publisher name');assert.equal(manifest.id,'/ywJX53taGnk/');assert.equal(manifest.scope,'/ywJX53taGnk/');assert.equal(manifest.start_url,'/ywJX53taGnk/pitch-training/#/reference');assert.equal(manifest.shortcuts.length,1);assert(!('file_handlers'in manifest));assert(!('protocol_handlers'in manifest));assert.equal(manifest.icons.length,2);
});

test('invalid bases fall back to the document and base targets cannot open new contexts',()=>{
 const invalid=prepareDocument('<base href="http://[bad"><base href="https://ignored.test/"><link rel="stylesheet" href="sheet.css?theme=dark">','https://publisher.test/docs/index.html');assert.deepEqual(invalid.links,['https://publisher.test/docs/sheet.css?theme=dark']);
 const target=prepareDocument('<base href="./assets/" target="_blank"><a href="#section">Section</a>','https://publisher.test/docs/index.html');assert(target.html.includes('href="#section"'));assert(!target.html.includes('<base'));assert(!target.html.includes('target="_blank"'));
});

test('unreadable or malformed optional publisher manifests preserve a valid document installation',async()=>{
 const {downloadWebsite}=await import('../src/website.js'),nativeFetch=globalThis.fetch;
 try{for(const failure of ['malformed','unreadable']){
  const progress=[];globalThis.fetch=async input=>{
   const url=String(input);if(url.endsWith('/index.html'))return new Response('<!doctype html><title>Fallback document</title><link rel="manifest" href="manifest.webmanifest"><p>Content</p>',{headers:{'content-type':'text/html'}});
   if(url.endsWith('/manifest.webmanifest')){if(failure==='unreadable')throw new TypeError('Synthetic unreadable metadata');return new Response('{bad json');}
   return new Response('Missing',{status:404});
  };
  const installed=await downloadWebsite('https://publisher.test/demo/index.html',{onProgress:value=>progress.push(value)});assert.equal(installed.publisherManifest,null);assert.equal(installed.manifest.name,'Fallback document');assert.equal(installed.preparation.ended,true);assert(progress.some(value=>value.startsWith('Optional manifest unavailable:')));assert.equal(webManifest(installed,'https://runtime.test/').icons.length,2);
 }}finally{globalThis.fetch=nativeFetch;}
});


test('a small publisher icon keeps its identity and gains installable fallback sizes',()=>{
 const source={...app,resources:[{url:'https://publisher.test/app/tiny.png',contentType:'image/png'}],publisherManifest:{url:'https://publisher.test/app/manifest.webmanifest',value:{icons:[{src:'tiny.png',sizes:'16x16',type:'image/png'}]}}};
 const manifest=webManifest(source,'https://runtime.test/');assert.equal(manifest.icons.length,3);assert(manifest.icons[0].src.includes('/__icon/'));assert(manifest.icons.some(icon=>icon.sizes==='192x192'));assert(manifest.icons.some(icon=>icon.sizes==='512x512'));
});
