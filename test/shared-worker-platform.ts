import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const service = `const observations=[];addEventListener('install',e=>e.waitUntil(skipWaiting()));addEventListener('activate',e=>e.waitUntil(clients.claim()));addEventListener('fetch',e=>{observations.push({url:e.request.url,destination:e.request.destination,clientId:e.clientId,resultingClientId:e.resultingClientId});e.respondWith(fetch(e.request))});addEventListener('message',e=>{if(e.data==='observations')e.ports[0].postMessage(observations)});`;
const shared = `let count=0;fetch('/shared-request').catch(()=>{});self.onconnect=e=>{const port=e.ports[0];const connection={trusted:e.isTrusted,origin:e.origin,source:e.source===null,sourceIsPort:e.source===port,data:e.data,ports:e.ports.length,name:self.name,worker:typeof Worker,shared:typeof SharedWorker,serviceWorker:typeof navigator.serviceWorker,imported:globalThis.sharedImported||0};port.onmessage=async message=>{if(message.data?.op==='nested'){const child=new Worker('/nested.js');child.onerror=e=>{e.preventDefault();port.postMessage({nestedFailure:e.message})};child.onmessage=e=>{port.postMessage({nested:e.data,connection});child.terminate()};return;}port.postMessage({count:++count,connection,buffer:message.data?.buffer?Array.from(new Uint8Array(message.data.buffer)):[]})};port.start();};`;
let origin = '';
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const path = new URL(req.url || '/', origin).pathname;
  if (path === '/shared-tla.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      'const event=await new Promise(resolve=>self.onconnect=resolve);const port=event.ports[0];port.onmessage=message=>port.postMessage({value:message.data,trusted:event.isTrusted,sourceIsPort:event.source===port});port.start();',
    );
    return;
  }
  if (
    path === '/sw.js' ||
    path === '/shared.js' ||
    path === '/shared-module.js' ||
    path === '/nested.js' ||
    path === '/shared-helper.js'
  ) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(
      path === '/sw.js'
        ? service
        : path === '/nested.js'
          ? `fetch('/nested-request').then(()=>postMessage(73));`
          : path === '/shared-helper.js'
            ? 'globalThis.sharedImported=17;'
            : path === '/shared-module.js'
              ? "import './shared-helper.js';" + shared
              : shared,
    );
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Native shared worker</title>');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Missing native worker port');
origin = 'http://127.0.0.1:' + address.port;
const results = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as object[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const first = await context.newPage();
      await first.goto(origin + '/one/');
      await first.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener(
              'controllerchange',
              () => resolve(),
              { once: true },
            ),
          );
      });
      const second = await context.newPage();
      await second.goto(origin + '/two/');
      async function connect(page: typeof first, module = false, name = 'shared') {
        return page.evaluate(
          async ({ module, name }) => {
            const worker = new SharedWorker(module ? '/shared-module.js' : '/shared.js', {
              name,
              type: module ? 'module' : 'classic',
            });
            Reflect.set(globalThis, 'nativeShared', worker);
            const buffer = new Uint8Array([3, 7, 11]).buffer;
            const response = new Promise((resolve, reject) => {
              worker.port.onmessage = (e) => resolve(e.data);
              worker.onerror = (e) => reject(new Error(e.message));
              setTimeout(() => reject(new Error('Native shared response timeout')), 5000);
            });
            worker.port.postMessage({ buffer }, [buffer]);
            return {
              detached: buffer.byteLength === 0,
              result: await response,
              portIdentity: worker.port === worker.port,
            };
          },
          { module, name },
        );
      }
      const a = await connect(first),
        b = await connect(second),
        separate = await connect(second, false, 'separate');
      assert.equal(a.result.count, 1);
      assert.equal(b.result.count, 2);
      assert.equal(separate.result.count, 1);
      assert(a.detached && b.detached && a.portIdentity);
      const module = await connect(first, true);
      assert.equal(module.result.count, 1);
      const nested =
        module.result.connection.worker === 'undefined'
          ? { supported: false }
          : await first.evaluate(
              () =>
                new Promise((resolve, reject) => {
                  const worker = Reflect.get(globalThis, 'nativeShared');
                  worker.port.onmessage = (e) => resolve(e.data);
                  worker.onerror = (e) => reject(new Error(e.message));
                  worker.port.postMessage({ op: 'nested' });
                  setTimeout(
                    () => reject(new Error('Native nested response timeout')),
                    5000,
                  );
                }),
            );
      if ('nested' in nested) assert.equal(nested.nested, 73);
      const topLevelAwait = await first.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const worker = new SharedWorker('/shared-tla.js', {
              name: 'tla',
              type: 'module',
            });
            worker.port.onmessage = (e) => resolve(e.data);
            worker.onerror = (e) => reject(new Error(e.message));
            worker.port.postMessage(91);
            setTimeout(() => reject(new Error('Native shared TLA timed out')), 5000);
          }),
      );
      assert.deepEqual(topLevelAwait, { value: 91, trusted: true, sourceIsPort: true });
      const observations = await first.evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => resolve(e.data);
            navigator.serviceWorker.controller!.postMessage('observations', [
              channel.port2,
            ]);
          }),
      );
      results.browsers.push({
        name,
        version: browser.version(),
        a,
        b,
        separate,
        module,
        nested,
        observations,
        topLevelAwait,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/shared-worker-platform.json',
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log('Native shared worker platform controls passed both browsers.');
