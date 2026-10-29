import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const { outputFiles } = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import {createPolicyTools} from './src/runtime/enforcement/native.ts';
import {scopeWebStorage} from './src/runtime/enforcement/web-storage.ts';
const nativeStorage=window.localStorage, nativeGet=Storage.prototype.getItem, apply=Reflect.apply;
window.probe=()=>{
  // Deliberately reproduce the unsafe forwarding rule as a working control.
  const hidden=Object.create(Storage.prototype);
  const unsafe=new Proxy(hidden,{get:(target,key)=>Reflect.get(target,key)});
  scopeWebStorage('fixture:',createPolicyTools());
  Object.defineProperty(Object.prototype,'inheritedReceiver',{configurable:true,get(){return this;}});
  Object.defineProperty(Object.prototype,'inheritedMethod',{configurable:true,value:function(){return this;}});
  try{
    const exposed=window.localStorage;
    const control=unsafe.inheritedReceiver;
    const controlIdentity=control===hidden && control!==unsafe;
    Object.setPrototypeOf(control,null);
    const controlMutation=Object.getPrototypeOf(hidden)===null;
    const received=exposed.inheritedReceiver;
    let denied=false;
    try{Object.setPrototypeOf(received,null);}catch{denied=true;}
    exposed.setItem('safe','stored');
    const positive=exposed.getItem('safe')==='stored' && apply(nativeGet,nativeStorage,['fixture:safe'])==='stored';
    return JSON.stringify({controlIdentity,controlMutation,getterReceiver:received===exposed,methodReceiver:exposed.inheritedMethod()===exposed,denied,positive});
  }finally{
    delete Object.prototype.inheritedReceiver;
    delete Object.prototype.inheritedMethod;
  }
};
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const bundle = outputFiles[0]!.text;
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(bundle);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script src="/fixture.js"></script>');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const results: unknown[] = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:' + address.port);
      const serialized = await page.evaluate(() =>
        Reflect.apply(Reflect.get(window, 'probe'), window, []),
      );
      const result: unknown = JSON.parse(serialized);
      assert.deepEqual(result, {
        controlIdentity: true,
        controlMutation: true,
        getterReceiver: true,
        methodReceiver: true,
        denied: true,
        positive: true,
      });
      results.push({ browser: name, version: browser.version(), result });
      console.log(name, JSON.stringify(result));
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/storage-proxy-receiver.json',
    JSON.stringify(
      { provenance: await testProvenance(import.meta.url), results },
      null,
      2,
    ) + '\n',
  );
}
