import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('changing only example configuration invalidates trusted bootstrap cache',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'privacy-frames-build-'));
 const build=async env=>{execFileSync(process.execPath,['build.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,...env,BUILD_DIRECTORY:temporary},stdio:'pipe'});return readFile(join(temporary,'sw.js'),'utf8');};
 try{
  const first=await build({HOST_CONFIG:'',PUBLISHER_URL:'https://first.example/'});
  const second=await build({HOST_CONFIG:'',PUBLISHER_URL:'https://second.example/'});
  assert.notEqual(first,second);
  const config=join(temporary,'config.json');await writeFile(config,JSON.stringify({examples:[]}));
  const third=await build({HOST_CONFIG:config});assert.notEqual(second,third);
  await build({HOST_CONFIG:'',PUBLISHER_URL:''});const defaults=JSON.parse(await readFile(join(temporary,'config.json'),'utf8'));assert.equal(defaults.examples.length,5);assert(defaults.examples.every(app=>app.url.startsWith('https://raw.githubusercontent.com/DamenH/privacy-frames-apps/main/apps/')));
 }finally{await rm(temporary,{recursive:true,force:true});}
});
