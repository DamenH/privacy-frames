import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { chromium, firefox } from 'playwright';

// Inspect native property descriptors only. The standard navigator reference is
// read explicitly; arbitrary member getters are not invoked.
const collect = `
function names(value) { return Object.getOwnPropertyNames(value).sort(); }
function chain(value) { const out = []; for (let p = value; p; p = Object.getPrototypeOf(p)) out.push(names(p)); return out; }
function tables(value) {
  const prototypes = {}, statics = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    const candidate = descriptor.value;
    if (typeof candidate !== 'function') continue;
    statics[key] = names(candidate);
    const prototype = Object.getOwnPropertyDescriptor(candidate, 'prototype')?.value;
    if (prototype && typeof prototype === 'object') prototypes[key] = names(prototype);
  }
  return {prototypes, statics};
}
function surface() { return {global: chain(self), navigator: chain(self.navigator), ...tables(self)}; }
`;
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(collect + `onmessage = event => event.ports[0].postMessage(surface());`);
  } else if (request.url === '/shared.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(collect + `onconnect = event => event.ports[0].postMessage(surface());`);
  } else if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      collect +
        `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', event => event.waitUntil(self.clients.claim())); self.addEventListener('message', event => event.ports[0].postMessage(surface()));`,
    );
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Native context inventory</title>');
  }
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address !== 'string');
const browsers: object[] = [];
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const surfaces = await page.evaluate(async () => {
        async function read(port: MessagePort): Promise<unknown> {
          return await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Context enumeration timed out')),
              10000,
            );
            port.onmessage = (event) => {
              clearTimeout(timeout);
              resolve(event.data);
            };
            port.start();
          });
        }
        const worker = new Worker('/worker.js');
        const workerChannel = new MessageChannel();
        const dedicated = read(workerChannel.port1);
        worker.postMessage(null, [workerChannel.port2]);
        const shared = new SharedWorker('/shared.js');
        const sharedResult = read(shared.port);
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const active = registration.active;
        if (!active) throw new Error('No active service worker');
        const serviceChannel = new MessageChannel();
        const service = read(serviceChannel.port1);
        active.postMessage(null, [serviceChannel.port2]);
        try {
          return {
            dedicated: await dedicated,
            shared: await sharedResult,
            service: await service,
          };
        } finally {
          worker.terminate();
          shared.port.close();
          workerChannel.port1.close();
          serviceChannel.port1.close();
          await registration.unregister();
        }
      });
      browsers.push({ name: engine.name(), version: browser.version(), surfaces });
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const source = await readFile(new URL(import.meta.url));
const receipt = {
  scope:
    'Unrestricted secure-context loopback dedicated, shared and service worker global and WorkerNavigator property-name observations in the default Playwright profile. Native navigator is accessed; arbitrary getters are not invoked. Not evidence of accessibility in confined contexts, behavior, permission availability or full browser coverage.',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runnerSHA256: createHash('sha256').update(source).digest('hex'),
  browsers,
};
await writeFile(
  'formal/evidence/context-features.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(
  'Native dedicated, shared and service worker property names recorded for Chromium and Firefox',
);
