import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const service = `const observations=[];self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data==='observations')e.ports[0].postMessage(observations)});self.addEventListener('fetch',e=>{e.respondWith((async()=>{const c=e.clientId?await self.clients.get(e.clientId):null;observations.push({url:e.request.url,destination:e.request.destination,clientId:e.clientId,resultingClientId:e.resultingClientId,clientURL:c?.url,clientType:c?.type});return fetch(e.request)})())});`;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/sw.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(service);
  } else if (req.url?.startsWith('/context/')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end("fetch('/data').then(r=>r.text()).then(value=>postMessage(value));");
  } else if (req.url === '/data') res.end('worker platform control');
  else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Context platform control</title>');
  }
});
await new Promise<void>((resolve) => server.listen(4330, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:4330/app/');
      await page.evaluate(async () => {
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
      const value = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const worker = new Worker('/context/control.js');
            worker.onmessage = (e) => {
              worker.terminate();
              resolve(e.data);
            };
          }),
      );
      assert.equal(value, 'worker platform control');
      const observations = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const c = new MessageChannel();
            c.port1.onmessage = (e) => resolve(e.data);
            navigator.serviceWorker.controller!.postMessage('observations', [c.port2]);
          }),
      );
      results.push({ name, version: browser.version(), value, observations });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await mkdir('results/contexts', { recursive: true });
await writeFile(
  'results/contexts/platform.json',
  JSON.stringify(results, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));
