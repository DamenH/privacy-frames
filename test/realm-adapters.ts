import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      import {createApplicationRealm} from './src/runtime/realms/index.ts';
      globalThis.probeRealm = (backend) => {
        const realm = createApplicationRealm(backend);
        try {
          Array.prototype.__hostMarker = 1;
          const separate = realm.evaluate('Array.prototype.__hostMarker === undefined');
          delete Array.prototype.__hostMarker;
          let objectRejected = false;
          try { realm.evaluate('({value: 42})'); } catch { objectRejected = true; }
          const callback = realm.evaluate('(callback) => callback(21)');
          const callbackValue = callback(value => value * 2);
          let callbackObjectRejected = false;
          try { callback(() => ({notAllowed: true})); }
          catch { callbackObjectRejected = true; }
          const globals = JSON.parse(realm.evaluate('JSON.stringify(Object.fromEntries(["document","window","fetch","Worker","WebSocket","RTCPeerConnection","parent","opener","location","WebAssembly","structuredClone"].map(name => {try {return [name,typeof globalThis[name]]}catch(error){return [name,error.name]}})))'));
          const wasm = JSON.parse(realm.evaluate('JSON.stringify((()=>{try{const bytes=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,5,3,1,0,1,7,17,2,6,109,101,109,111,114,121,2,0,4,114,101,97,100,0,0,10,9,1,7,0,65,0,45,0,0,11]);const instance=new WebAssembly.Instance(new WebAssembly.Module(bytes));new Uint8Array(instance.exports.memory.buffer)[0]=201;return {worked:true,value:instance.exports.read()}}catch(error){return {worked:false,error:String(error)}}})())'));
          const descriptor = realm.evaluate('JSON.stringify((()=>{let d=Object.getOwnPropertyDescriptor(globalThis,"document");return d?{configurable:d.configurable,accessor:!!d.get}:null})())');
          const setter = realm.evaluate('(value) => {globalThis.__pf_testValue=value;return 1}');
          assertPrimitive(setter('hello'));
          const stored = realm.evaluate('globalThis.__pf_testValue');
          realm.revoke();
          let revoked = false;
          try {realm.evaluate('42')}catch{revoked=true}
          return {backend:realm.backend,separate,objectRejected,callbackValue,callbackObjectRejected,globals,wasm,documentDescriptor:JSON.parse(descriptor),stored,revoked};
        } finally { delete Array.prototype.__hostMarker; realm.revoke(); }
      };
      function assertPrimitive(value){if(typeof value!=='number')throw Error('Unexpected value')}
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const script = bundle.outputFiles[0].text;
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/probe.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(script);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><script src="/probe.js"></script><main>Realm probe</main>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const results = [];
try {
  for (const [engine, backend, args] of [
    [chromium, 'native', ['--js-flags=--harmony-shadow-realm']],
    [chromium, 'membrane', []],
    [firefox, 'membrane', []],
  ] as const) {
    const browser = await launch(engine, { args: [...args] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const result = await page.evaluate(
        (backend) => globalThis.probeRealm(backend),
        backend,
      );
      assert(result.separate);
      assert(result.objectRejected);
      assert(result.callbackObjectRejected);
      assert.equal(result.callbackValue, 42);
      assert.equal(result.stored, 'hello');
      assert(result.revoked);
      results.push({ browser: engine.name(), version: browser.version(), ...result });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await mkdir('results/realms', { recursive: true });
await writeFile(
  'results/realms/adapters.json',
  JSON.stringify({ results }, null, 2) + '\n',
);
