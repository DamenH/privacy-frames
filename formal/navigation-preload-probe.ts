import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from '../test/browser-profile.ts';
import { servers } from '../test/server.ts';
import { testProvenance } from '../test/provenance.ts';
import { provideResourceList } from '../test/resource-list-input.ts';

const received: { path: string; preload: string | undefined }[] = [];
const publisher = http.createServer((request, reply) => {
  const path = request.url || '/';
  const preloadHeader = request.headers['service-worker-navigation-preload'];
  received.push({
    path,
    preload: typeof preloadHeader === 'string' ? preloadHeader : undefined,
  });
  reply.setHeader('Access-Control-Allow-Origin', '*');
  reply.setHeader('Cache-Control', 'no-store');
  if (path === '/native.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/preload'){e.respondWith((async()=>{await e.preloadResponse;return new Response('handled')})())}});`,
    );
  } else if (path === '/preload') {
    reply.setHeader('Content-Type', 'text/html');
    reply.end('<!doctype html>Preload receiver');
  } else if (path === '/preload-app/' || path === '/preload-app/index.html') {
    reply.setHeader('Content-Type', 'text/html');
    reply.end(
      '<!doctype html><title>Preload probe</title><script src="./main.js"></script>',
    );
  } else if (path === '/preload-app/main.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `globalThis.startPublisher=async()=>{const registration=await navigator.serviceWorker.register('./foreground.js');await navigator.serviceWorker.ready;return registration};globalThis.probeWindow=async marker=>{const registration=await navigator.serviceWorker.getRegistration();const p=registration.navigationPreload;const state=await p.getState();let enable,header;try{await p.enable();enable='accepted'}catch(error){enable=error.name}try{await p.setHeaderValue(marker);header='accepted'}catch(error){header=error.name}return {state,enable,header}};globalThis.probePublisher=marker=>new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('publisher timeout')),10000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data)};navigator.serviceWorker.controller.postMessage(marker,[channel.port2])});globalThis.publisherReady=true;`,
    );
  } else if (path === '/preload-app/foreground.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(
      `self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('message',e=>e.waitUntil((async()=>{const p=registration.navigationPreload;const state=await p.getState();let enable,header;try{await p.enable();enable='accepted'}catch(error){enable=error.name}try{await p.setHeaderValue(e.data);header='accepted'}catch(error){header=error.name}e.ports[0].postMessage({state,enable,header,shared:self instanceof SharedWorkerGlobalScope})})()));`,
    );
  } else {
    reply.setHeader('Content-Type', 'text/html');
    reply.end('<!doctype html><title>Native preload control</title>');
  }
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const server = await servers({ receiver: false });
const evidence = {
  scope:
    'Native preload delivery on a publisher origin and installed-window/publisher attempts after trusted test setup seeds runtime-origin preload state. Includes selected synthetic same-origin navigation attempts, not all navigation or native registration acquisition routes.',
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
      const marker = 'native-' + randomUUID();
      const before = await native.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/native.js');
        await navigator.serviceWorker.ready;
        if (!registration.navigationPreload) return null;
        return await registration.navigationPreload.getState();
      });
      assert(
        before && before.enabled === false,
        `${engine.name()}: preload control unavailable`,
      );
      const page = await context.newPage();
      const start = received.length;
      await page.goto(origin + '/preload');
      await page.waitForTimeout(300);
      assert(
        !received.slice(start).some((item) => item.path === '/preload'),
        'Disabled preload reached receiver',
      );
      const nativeState = await native.evaluate(async (marker) => {
        const registration = await navigator.serviceWorker.ready;
        await registration.navigationPreload.enable();
        await registration.navigationPreload.setHeaderValue(marker);
        return await registration.navigationPreload.getState();
      }, marker);
      assert.equal(nativeState.enabled, true);
      assert.equal(nativeState.headerValue, marker);
      await page.reload();
      await page.waitForTimeout(300);
      assert(
        received
          .slice(start)
          .some((item) => item.path === '/preload' && item.preload === marker),
        `${engine.name()}: native preload header not delivered`,
      );
      await page.close();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(origin + '/preload-app/');
      await provideResourceList(manager, [origin + '/preload-app/foreground.js']);
      await manager.locator('#install button').click();
      await manager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')?.textContent || '',
          ),
        undefined,
        { timeout: 120000 },
      );
      assert.match((await manager.locator('#status').textContent()) ?? '', /^Installed /);
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="preload-app"]').click();
      const app = await opened;
      await app.waitForFunction(() => Reflect.get(window, 'publisherReady') === true);
      await app.evaluate(() => Reflect.get(window, 'startPublisher')());
      const inspector = await context.newPage();
      await inspector.goto('http://127.0.0.1:4211/runtime/report.html');
      const seededHeader = 'trusted-seed-' + randomUUID();
      const seededState = await inspector.evaluate(async (header) => {
        const registration = await navigator.serviceWorker.getRegistration('/runtime/');
        if (!registration) throw new Error('Runtime registration missing');
        await registration.navigationPreload.enable();
        await registration.navigationPreload.setHeaderValue(header);
        return await registration.navigationPreload.getState();
      }, seededHeader);
      assert.deepEqual(seededState, { enabled: true, headerValue: seededHeader });
      const secret = 'private-' + randomUUID();
      const windowResult = await app.evaluate(
        (marker) => Reflect.get(window, 'probeWindow')(marker),
        secret,
      );
      const workerResult = await app.evaluate(
        (marker) => Reflect.get(window, 'probePublisher')(marker),
        secret,
      );
      const expected = {
        state: { enabled: false, headerValue: 'true' },
        enable: 'NotSupportedError',
        header: 'NotSupportedError',
      };
      assert.deepEqual(windowResult, expected);
      assert.deepEqual(workerResult, { ...expected, shared: true });
      const controlMarker = 'receiver-' + randomUUID();
      const controlPath = '/runtime/collect?control=' + controlMarker;
      await context.request.get('http://127.0.0.1:4211' + controlPath);
      assert(
        server.traffic.some((entry) => entry.port === 4211 && entry.path === controlPath),
        'Runtime receiver control failed',
      );
      const trafficStart = server.traffic.length;
      const navigationAttempt = await app.evaluate((marker) => {
        const before = location.href;
        const target = new URL(before);
        target.searchParams.set('private', marker);
        const anchor = document.createElement('a');
        anchor.href = target.href;
        document.body.append(anchor);
        let anchorResult = 'clicked';
        try {
          anchor.click();
        } catch (error) {
          anchorResult = error instanceof Error ? error.name : 'unknown';
        }
        let assignResult = 'called';
        try {
          location.assign(target.href);
        } catch (error) {
          assignResult = error instanceof Error ? error.name : 'unknown';
        }
        return { before, anchorResult, assignResult };
      }, secret);
      await app.waitForTimeout(500);
      const privateRequests = server.traffic
        .slice(trafficStart)
        .filter((entry) => entry.path.includes(secret));
      assert.deepEqual(privateRequests, [], 'App navigation reached runtime server');
      assert.equal(app.url(), navigationAttempt.before, 'App left its original document');
      const retainedState = await inspector.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/runtime/');
        if (!registration) throw new Error('Runtime registration missing');
        const state = await registration.navigationPreload.getState();
        await registration.navigationPreload.disable();
        await registration.navigationPreload.setHeaderValue('true');
        return state;
      });
      assert.deepEqual(retainedState, seededState);
      console.log(
        engine.name(),
        JSON.stringify({ nativeState, windowResult, workerResult }),
      );
      evidence.browsers.push({
        name: engine.name(),
        version: browser.version(),
        before,
        nativeState,
        nativeRequests: received.filter((item) => item.preload === marker),
        seededState,
        retainedState,
        runtimeReceiverControl: controlPath,
        privateMarker: secret,
        navigationAttempt,
        privateRequests,
        windowResult,
        workerResult,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  evidence.completed = true;
} finally {
  await writeFile(
    'formal/evidence/navigation-preload.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await server.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
}
