import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const evidence={date:new Date().toISOString(),assets:[]};
const base='https://damenh.github.io/privacy-frames/';
for(const file of ['index.html','manager.js','guard.js','sw.js','config.json','host.css','report.html']){
 const response=await fetch(new URL(file,base));assert.equal(response.status,200);const remote=Buffer.from(await response.arrayBuffer());const local=await readFile(new URL('dist/'+file,root));assert.equal(sha(remote),sha(local),file);evidence.assets.push({site:'host',file,sha256:sha(remote)});
}
const publisher='https://raw.githubusercontent.com/DamenH/privacy-frames-apps/main/apps/';
for(const id of ['notes','image','resources','adversary','playground']){
 const response=await fetch(publisher+id+'/app.json');assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');const manifest=await response.json();
 for(const file of ['app.json',...manifest.resources]){const response=await fetch(publisher+id+'/'+file);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const local=await readFile(new URL('../privacy-frames-apps/apps/'+id+'/'+file,root));assert.equal(sha(bytes),sha(local),id+'/'+file);evidence.assets.push({site:id,file,sha256:sha(bytes)});}
}
const alternate=await fetch('https://damenh.github.io/privacy-frames-apps/playground/',{redirect:'manual'});assert([301,302,307,308].includes(alternate.status));assert.notEqual(new URL(alternate.headers.get('location')).origin,new URL(base).origin);evidence.publisherOriginRedirect={status:alternate.status,targetOrigin:new URL(alternate.headers.get('location')).origin};
await writeFile(new URL('results/assets.json',root),JSON.stringify(evidence,null,2)+'\n');console.log(evidence.assets.length,'published code/resource assets match local sources.');
