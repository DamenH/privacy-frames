import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const executor = `const nativeAdd=addEventListener.bind(self);const dispatch=dispatchEvent.bind(self);const send=MessagePort.prototype.postMessage;let requests=0;let leaked=0;
nativeAdd('connect',event=>{if(!event.isTrusted)return;event.stopImmediatePropagation();const port=event.ports[0];port.onmessage=async message=>{const value=message.data;if(value.type==='host-ready'){port.postMessage({type:'prepared',leaked});return;}if(value.type==='fetch'){requests++;port.postMessage({type:'response',job:value.job,value:{requests,headers:value.request.headers,credentials:value.request.credentials,client:value.request.clientId,leaked}});return;}if(value.type==='application-message'){port.postMessage({type:'application-reply',data:{echo:value.data,leaked}});}};port.start();});
nativeAdd('connect',()=>leaked++);`;
const host = `const ports=new Map();const pending=new Map();let serial=0;const observations=[];
addEventListener('install',event=>event.waitUntil(skipWaiting()));addEventListener('activate',event=>event.waitUntil(clients.claim()));
addEventListener('message',event=>{if(event.data.type==='bind'){const owner=event.source.id;const port=event.ports[0];ports.set(owner,port);port.onmessage=message=>{const data=message.data;if(data.type==='prepared'){event.source.postMessage({type:'bound',nativeSharedWorker:typeof SharedWorker,owner,leaked:data.leaked});return;}if(data.type==='response'){const job=pending.get(data.job);if(job){pending.delete(data.job);job(new Response(JSON.stringify(data.value),{headers:{'Content-Type':'application/json'}}));}return;}if(data.type==='application-reply')event.source.postMessage({type:'application-reply',data:data.data});};port.start();port.postMessage({type:'host-ready'});return;}if(event.data.type==='application-message'){ports.get(event.source.id)?.postMessage({type:'application-message',data:event.data.data});return;}if(event.data.type==='observations')event.ports[0].postMessage(observations);});
addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.pathname!=='/data.json'){event.respondWith(fetch(event.request));return;}const port=ports.get(event.clientId);if(!port){event.respondWith(new Response('No foreground executor',{status:503}));return;}const headers=new Headers(event.request.headers);for(const name of['cookie','cookie2','authorization','proxy-authorization'])headers.delete(name);const job=++serial;observations.push({clientId:event.clientId,resultingClientId:event.resultingClientId,destination:event.request.destination});event.respondWith(new Promise(resolve=>{pending.set(job,resolve);port.postMessage({type:'fetch',job,request:{url:event.request.url,method:'GET',headers:[...headers],credentials:'omit',clientId:event.clientId}});}));});`;
const server = http.createServer((request, response) => {
  if (request.url === '/host.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(host);
  } else if (request.url === '/executor.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(executor);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Publisher bridge native control</title>');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Bridge address missing');
const origin = `http://127.0.0.1:${address.port}`;
const evidence = {
  runnerSHA256: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex'),
  hostSHA256: createHash('sha256').update(host).digest('hex'),
  executorSHA256: createHash('sha256').update(executor).digest('hex'),
  scope:
    'Benign native host-ServiceWorker/private-port/SharedWorker bridge feasibility only; no production profile or authority claims',
  browsers: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const pages = [];
      const results = [];
      for (let index = 0; index < 2; index++) {
        const page = await context.newPage();
        pages.push(page);
        await page.goto(origin + '/app/' + index);
        const result = await page.evaluate(async () => {
          await navigator.serviceWorker.register('/host.js', { scope: '/' });
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller)
            await new Promise<void>((resolve) =>
              navigator.serviceWorker.addEventListener(
                'controllerchange',
                () => resolve(),
                { once: true },
              ),
            );
          if (typeof SharedWorker !== 'function') return { available: false };
          const worker = new SharedWorker('/executor.js', {
            name: 'publisher-bridge-native-control',
          });
          Reflect.set(window, 'retainedExecutor', worker);
          const bound = new Promise<Record<string, unknown>>((resolve) => {
            navigator.serviceWorker.addEventListener('message', (event) => {
              if (event.data.type === 'bound') resolve(event.data);
            });
          });
          navigator.serviceWorker.controller!.postMessage({ type: 'bind' }, [
            worker.port,
          ]);
          const ready = await bound;
          const data = await (
            await fetch('/data.json', {
              headers: {
                Authorization: 'dummy-must-be-stripped',
                'X-App-Dummy': 'retained',
              },
            })
          ).json();
          const reply = new Promise((resolve) =>
            navigator.serviceWorker.addEventListener(
              'message',
              (event) => {
                if (event.data.type === 'application-reply') resolve(event.data.data);
              },
              { once: true },
            ),
          );
          navigator.serviceWorker.controller!.postMessage({
            type: 'application-message',
            data: {
              type: 'host-ready',
              claimedClient: 'manager',
              value: 'dummy-app-message',
            },
          });
          return { available: true, ready, data, reply: await reply };
        });
        assert.equal(result.available, true);
        assert.equal(result.ready!.nativeSharedWorker, 'undefined');
        assert.equal(result.ready!.leaked, 0);
        const headers = Object.fromEntries(result.data.headers);
        assert.equal(headers.authorization, undefined);
        assert.equal(headers.cookie, undefined);
        assert.equal(headers['x-app-dummy'], 'retained');
        assert.equal(result.data.credentials, 'omit');
        assert.equal(result.data.leaked, 0);
        assert.deepEqual(result.reply, {
          echo: {
            type: 'host-ready',
            claimedClient: 'manager',
            value: 'dummy-app-message',
          },
          leaked: 0,
        });
        results.push(result);
      }
      assert.equal(results[0].data.requests, 1);
      assert.equal(results[1].data.requests, 2);
      assert.notEqual(results[0].data.client, results[1].data.client);
      evidence.browsers.push({ name, version: browser.version(), results });
      console.log(
        `${name}: native host bridge, shared foreground state, nested messages and header sanitization passed`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/publisher-bridge-platform.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
