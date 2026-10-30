import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from '../test/browser-profile.ts';
import { servers } from '../test/server.ts';
import { testProvenance } from '../test/provenance.ts';
import { provideResourceList } from '../test/resource-list-input.ts';

const received: string[] = [];
const publisher = http.createServer((request, reply) => {
  const path = request.url || '/';
  received.push(path);
  reply.setHeader('Access-Control-Allow-Origin', '*');
  reply.setHeader('Cache-Control', 'no-store');
  if (path.startsWith('/routed?') || path.startsWith('/unrouted?')) {
    reply.end('observed');
    return;
  }
  if (path === '/native.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `let available=false;self.addEventListener('install',e=>{available=typeof e.addRoutes==='function';if(available)e.addRoutes({condition:{urlPattern:'/routed*'},source:'network'});self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(new Response('intercepted')));self.addEventListener('message',e=>e.ports[0].postMessage(available));`,
    );
    return;
  }
  if (path === '/publisher-lab/' || path === '/publisher-lab/index.html') {
    reply.setHeader('Content-Type', 'text/html');
    reply.end(
      '<!doctype html><title>Publisher lab</title><script src="./main.js"></script>',
    );
    return;
  }
  if (path === '/publisher-lab/main.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `globalThis.startPublisher=async()=>{await navigator.serviceWorker.register('./foreground.js');await navigator.serviceWorker.ready}; globalThis.probePublisher=data=>new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('publisher timeout')),10000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data)};navigator.serviceWorker.controller.postMessage(data,[channel.port2])});globalThis.publisherReady=true;`,
    );
    return;
  }
  if (path === '/publisher-lab/foreground.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `let addRoutes,attempt;self.addEventListener('install',e=>{addRoutes=typeof e.addRoutes;try{e.addRoutes({condition:{urlPattern:'*'},source:'network'});attempt='accepted'}catch(error){attempt=error.name}});self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('message',e=>e.ports[0].postMessage({addRoutes,attempt,shared:self instanceof SharedWorkerGlobalScope,service:typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope}));`,
    );
    return;
  }
  reply.setHeader('Content-Type', 'text/html');
  reply.end('<!doctype html><title>Native control</title>');
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
if (!address || typeof address === 'string') throw new Error('No publisher address');
const origin = `http://127.0.0.1:${address.port}`;
const server = await servers({ receiver: false });
const evidence = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as unknown[],
  completed: false,
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const native = await context.newPage();
      await native.goto(origin + '/native.html');
      const marker = randomUUID();
      const available = await native.evaluate(async () => {
        const reg = await navigator.serviceWorker.register('/native.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener(
              'controllerchange',
              () => resolve(),
              { once: true },
            ),
          );
        return await new Promise<boolean>((resolve, reject) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => reject(new Error('native SW timeout')), 10000);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve(e.data);
          };
          reg.active!.postMessage('status', [channel.port2]);
        });
      });
      let nativeResult: unknown = { available: false };
      if (available) {
        nativeResult = await native.evaluate(
          async (marker: string) => ({
            unrouted: await (await fetch('/unrouted?marker=' + marker)).text(),
            routed: await (await fetch('/routed?marker=' + marker)).text(),
          }),
          marker,
        );
        assert.deepEqual(nativeResult, { unrouted: 'intercepted', routed: 'observed' });
        assert(
          received.includes('/routed?marker=' + marker),
          'Native network route did not reach receiver',
        );
        assert(
          !received.includes('/unrouted?marker=' + marker),
          'Native fetch-handler control reached receiver',
        );
      }
      const receiverControl = await context.newPage();
      await receiverControl.goto('http://127.0.0.1:4211/runtime/report.html');
      const controlPath = '/runtime/collect?control=' + marker;
      await receiverControl.evaluate((path: string) => fetch(path), controlPath);
      assert(
        server.traffic.some((item) => item.port === 4211 && item.path === controlPath),
        'Runtime receiver did not observe same-origin browser control',
      );
      await receiverControl.close();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(origin + '/publisher-lab/');
      await provideResourceList(manager, [origin + '/publisher-lab/foreground.js']);
      await manager.locator('#install button').click();
      await manager.locator('[data-app="publisher-lab"]').waitFor();
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="publisher-lab"]').click();
      const app = await opened;
      await app.waitForFunction(() => Reflect.get(window, 'publisherReady') === true);
      await app.evaluate(() => Reflect.get(window, 'startPublisher')());
      const runtimeTarget = new URL('/runtime/collect?publisher=' + marker, app.url())
        .href;
      const start = server.traffic.length;
      const result = await app.evaluate(
        (target) => Reflect.get(window, 'probePublisher')(target),
        runtimeTarget,
      );
      const fetchResult = await app.evaluate(async (target: string) => {
        try {
          const response = await fetch(target);
          return 'http:' + response.status;
        } catch (error) {
          return (error as Error).name;
        }
      }, runtimeTarget);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const observed = server.traffic
        .slice(start)
        .filter((item) => item.path.includes(marker));
      assert.deepEqual(result, {
        addRoutes: 'undefined',
        attempt: 'TypeError',
        shared: true,
        service: false,
      });
      assert.deepEqual(
        observed,
        [],
        'Publisher cache request reached same-origin receiver',
      );
      evidence.browsers.push({
        name,
        version: browser.version(),
        nativeResult,
        nativeAddRoutesAvailable: available,
        runtimeReceiverControl: true,
        publisher: result,
        runtimeFetchResult: fetchResult,
        publisherReceiverRequests: observed,
        runtimeTarget,
      });
      await context.close();
      console.log(
        name +
          ': native route control (if supported) and virtual publisher install-event check passed',
      );
    } finally {
      await browser.close();
    }
  }
  evidence.completed = true;
} finally {
  await writeFile(
    'formal/evidence/publisher-routes.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await server.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
}
