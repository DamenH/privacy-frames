import http from 'node:http';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from '../test/browser-profile.ts';
import { servers } from '../test/server.ts';
import { testProvenance } from '../test/provenance.ts';
import { provideResourceList } from '../test/resource-list-input.ts';

const workerCode = `
self.onmessage = async () => {
  const answer = { hasMember: 'serviceWorker' in navigator };
  try {
    const container = navigator.serviceWorker;
    answer.container = container ? 'available' : 'missing';
    if (container) {
      try { answer.registrations = (await container.getRegistrations()).length; }
      catch (error) { answer.registrationError = error.name; }
    }
  } catch (error) { answer.getterError = error.name; }
  const descriptor = Object.getOwnPropertyDescriptor(WorkerNavigator.prototype, 'serviceWorker');
  answer.prototypeGetter = typeof descriptor?.get;
  try {
    const container = descriptor?.get?.call(navigator);
    answer.prototypeResult = container ? 'available' : 'missing';
  } catch (error) { answer.prototypeError = error.name; }
  postMessage(answer);
};`;
const publisher = http.createServer((request, reply) => {
  reply.setHeader('Access-Control-Allow-Origin', '*');
  reply.setHeader('Cache-Control', 'no-store');
  if (request.url === '/native-sw.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`,
    );
  } else if (request.url === '/worker.js' || request.url === '/worker-app/worker.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(workerCode);
  } else if (request.url === '/worker-app/' || request.url === '/worker-app/index.html') {
    reply.setHeader('Content-Type', 'text/html');
    reply.end(`<!doctype html><title>Worker registration probe</title><script>
    globalThis.runWorker = () => new Promise((resolve,reject)=>{const worker=new Worker('./worker.js');const timer=setTimeout(()=>reject(new Error('worker timed out')),10000);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message))};worker.postMessage(null)});
    globalThis.probeReady=true;
    </script>`);
  } else {
    reply.setHeader('Content-Type', 'text/html');
    reply.end('<!doctype html><title>Native worker registration control</title>');
  }
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const server = await servers({ receiver: false });
const evidence = {
  scope:
    'Native worker registration acquisition on a seeded publisher origin and actual installed dedicated-worker acquisition against the host runtime. API absence is not containment. No direct background request, all-context or universal authority claim.',
  provenance: await testProvenance(import.meta.url),
  browsers: [] as object[],
  completed: false,
};
try {
  for (const engine of [chromium, firefox]) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const native = await context.newPage();
      await native.goto(origin + '/native');
      await native.evaluate(async () => {
        await navigator.serviceWorker.register('/native-sw.js');
        await navigator.serviceWorker.ready;
      });
      const nativeResult = await native.evaluate(
        async () =>
          await new Promise((resolve, reject) => {
            const worker = new Worker('/worker.js');
            const timer = setTimeout(
              () => reject(new Error('native worker timed out')),
              10000,
            );
            worker.onmessage = (e) => {
              clearTimeout(timer);
              worker.terminate();
              resolve(e.data);
            };
            worker.onerror = (e) => {
              clearTimeout(timer);
              worker.terminate();
              reject(new Error(e.message));
            };
            worker.postMessage(null);
          }),
      );
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(origin + '/worker-app/');
      await provideResourceList(manager, [origin + '/worker-app/worker.js']);
      await manager.locator('#install button').click();
      await manager.locator('[data-app="worker-app"]').waitFor();
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="worker-app"]').click();
      const app = await opened;
      await app.waitForFunction(() => Reflect.get(window, 'probeReady') === true);
      const actual = await app.evaluate(() => Reflect.get(window, 'runWorker')());
      if (engine.name() === 'firefox') {
        assert.deepEqual(nativeResult, {
          hasMember: true,
          container: 'available',
          registrations: 1,
          prototypeGetter: 'function',
          prototypeResult: 'available',
        });
        assert.deepEqual(actual, {
          hasMember: true,
          getterError: 'SecurityError',
          prototypeGetter: 'function',
          prototypeError: 'SecurityError',
        });
      } else {
        const absent = {
          hasMember: false,
          container: 'missing',
          prototypeGetter: 'undefined',
          prototypeResult: 'missing',
        };
        assert.deepEqual(nativeResult, absent);
        assert.deepEqual(actual, absent);
      }
      console.log(engine.name(), JSON.stringify({ nativeResult, actual }));
      evidence.browsers.push({
        name: engine.name(),
        version: browser.version(),
        nativeResult,
        actual,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  evidence.completed = true;
} finally {
  await writeFile(
    'formal/evidence/worker-registration.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await server.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
}
