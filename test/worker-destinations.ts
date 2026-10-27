import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const service = `const observations=[];self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data==='observations')e.ports[0].postMessage(observations)});self.addEventListener('fetch',e=>{observations.push({url:e.request.url,destination:e.request.destination,clientId:e.clientId,resultingClientId:e.resultingClientId});e.respondWith(fetch(e.request))});`;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/javascript');
  if (req.url === '/sw.js') res.end(service);
  else if (req.url === '/parent.js')
    res.end(
      `await import('/entry.js');const child=new Worker('/candidate.js');child.onmessage=e=>{postMessage({done:e.data});child.terminate()};child.postMessage('ping');`,
    );
  else if (req.url === '/entry.js') res.end("import '/candidate.js';");
  else if (req.url === '/candidate.js')
    res.end(`self.onmessage=()=>postMessage('candidate');`);
  else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Worker destinations</title>');
  }
});
await new Promise<void>((resolve) => server.listen(4346, '127.0.0.1', resolve));
const results = [];
const provenance = await testProvenance(import.meta.url);
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:4346/');
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
          new Promise((resolve, reject) => {
            const worker = new Worker('/parent.js', { type: 'module' });
            worker.onmessage = (e) => {
              worker.terminate();
              resolve(e.data);
            };
            worker.onerror = (e) => reject(new Error(e.message));
            setTimeout(() => reject(new Error('Native nested worker timed out')), 8000);
          }),
      );
      assert.deepEqual(value, { done: 'candidate' });
      const observations = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => resolve(e.data);
            navigator.serviceWorker.controller!.postMessage('observations', [
              channel.port2,
            ]);
          }),
      );
      const parent = observations.find((item) => item.url.endsWith('/parent.js'));
      const candidates = observations.filter((item) =>
        item.url.endsWith('/candidate.js'),
      );
      assert.equal(candidates.length, 2);
      const existing = candidates.find((item) => !item.resultingClientId);
      const startup = candidates.find((item) => item.resultingClientId);
      assert(existing);
      assert(startup);
      assert.equal(existing.clientId, parent.resultingClientId);
      assert.equal(startup.clientId, parent.resultingClientId);
      assert.notEqual(startup.resultingClientId, parent.resultingClientId);
      if (name === 'firefox') assert.equal(existing.destination, 'worker');
      assert.equal(startup.destination, 'worker');
      results.push({ provenance, name, version: browser.version(), value, observations });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await mkdir('results/contexts', { recursive: true });
await writeFile(
  'results/contexts/worker-destinations.json',
  JSON.stringify(results, null, 2) + '\n',
);
console.log(
  'Native module imports and new worker startups have distinct client identifiers in both browsers.',
);
