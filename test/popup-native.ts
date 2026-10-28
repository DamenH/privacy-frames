import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

// Benign platform measurement: no confinement claim or publisher execution.
// A popup must remain private through its initial blank realm and first commit.
const worker = `
const observations = [];
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  event.ports[0].postMessage(observations);
});
self.addEventListener('fetch', event => {
  observations.push({
    path: new URL(event.request.url).pathname,
    destination: event.request.destination,
    clientId: event.clientId,
    resultingClientId: event.resultingClientId,
    replacesClientId: event.replacesClientId,
  });
});
`;
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(worker);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    "sandbox allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox; default-src 'self'; script-src 'self' 'unsafe-inline'",
  );
  if (request.url === '/popup.html') {
    response.end(`<!doctype html><title>Popup measurement</title><script>
      globalThis.popupMeasurement = {
        opener: opener !== null,
        topLevel: top === self && parent === self,
        controlled: !!navigator.serviceWorker.controller,
        href: location.href,
      };
    </script>`);
    return;
  }
  response.end(`<!doctype html><title>Popup parent</title><button>Open</button><script>
    document.querySelector('button').onclick = () => {
      const child = window.open('/popup.html', 'private-native-fixture');
      globalThis.popupInitial = {
        exists: child !== null,
        href: child && child.location.href,
        length: window.length,
        namedProperty: 'private-native-fixture' in window,
      };
      globalThis.popupReference = child;
    };
  </script>`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing server address');
const base = `http://127.0.0.1:${address.port}`;
const evidence = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      context.on('console', (message) =>
        console.log(name, message.type(), message.text()),
      );
      context.on('page', (page) =>
        page.on('pageerror', (error) => console.log(name, 'pageerror', error.message)),
      );
      const page = await context.newPage();
      await page.goto(base);
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
      const opened = context.waitForEvent('page');
      await page.getByRole('button', { name: 'Open' }).click();
      const popup = await opened;
      try {
        await popup.waitForFunction(() => Reflect.has(window, 'popupMeasurement'));
      } catch (error) {
        console.log(name, 'failed popup', popup.url(), await popup.content());
        throw error;
      }
      const initial = await page.evaluate(() => Reflect.get(window, 'popupInitial'));
      const committed = await popup.evaluate(() =>
        Reflect.get(window, 'popupMeasurement'),
      );
      const observations = await page.evaluate(async () => {
        const channel = new MessageChannel();
        const result = new Promise<unknown>(
          (resolve) => (channel.port1.onmessage = (event) => resolve(event.data)),
        );
        navigator.serviceWorker.controller!.postMessage('observations', [channel.port2]);
        return result;
      });
      assert(initial.exists);
      assert.equal(initial.href, 'about:blank');
      assert.equal(initial.length, 0);
      assert.equal(initial.namedProperty, false);
      assert.equal(committed.opener, true);
      assert.equal(committed.topLevel, true);
      assert.equal(committed.controlled, true);
      assert(Array.isArray(observations));
      const navigation = observations.find((value) => value.path === '/popup.html');
      assert(navigation);
      assert.equal(navigation.destination, 'document');
      assert(navigation.resultingClientId);
      evidence.browsers.push({
        name,
        version: browser.version(),
        initial,
        committed,
        observations,
      });
      console.log(name, JSON.stringify({ initial, committed, navigation }));
      await context.close();
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
  'results/contexts/popup-native.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
