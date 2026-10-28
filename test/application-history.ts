import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';

const host = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const ownedHost = process.env.HOST_URL ? undefined : await servers({ receiver: false });
const traffic: string[] = [];
let outside = '';
const publisher = http.createServer((request, response) => {
  const path = new URL(request.url || '/', 'http://publisher.test').pathname.replace(
    /^\/publisher(?=\/)/,
    '',
  );
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/collect') {
    traffic.push(request.url || '/');
    response.end('Native receiver control');
  } else if (path === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end('postMessage({mode:globalThis.privacyHost?.mode||"native"});');
  } else if (path === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      `document.querySelector('#ready').textContent=globalThis.privacyHost?.mode||'native';globalThis.fixtureWorker=()=>new Worker('./worker.js');`,
    );
  } else if (path === '/sw.js') response.writeHead(404).end('No publisher worker');
  else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>History fixture</title><p id="ready">starting</p><script src="/app.js"></script>',
    );
  }
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
assert(address && typeof address !== 'string');
outside = `http://127.0.0.1:${address.port}`;
const receipt = {
  provenance: await testProvenance(import.meta.url),
  results: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    const context = await browser.newContext();
    try {
      const native = await context.newPage();
      await native.goto(outside + '/publisher/');
      await native.evaluate(async (origin) => {
        await fetch(origin + '/collect?nonce=' + crypto.randomUUID());
      }, outside);
      assert.equal(traffic.length, name === 'chromium' ? 1 : 2);
      await native.close();
      const manager = await context.newPage();
      await manager.goto(host);
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(outside + '/publisher/');
      await manager.locator('#install button').click();
      await manager
        .getByText('Installed History fixture.', { exact: true })
        .waitFor({ timeout: 120000 });
      const opened = context.waitForEvent('page');
      await manager.getByRole('link', { name: 'Open', exact: true }).click();
      const app = await opened;
      await app.getByText('network-isolated', { exact: true }).waitFor();
      const entry = app.url();
      const before = traffic.length;
      await app.evaluate(() =>
        history.pushState({ view: 'editor' }, '', '/editor?image=1#view'),
      );
      assert.equal(app.url(), entry + 'editor?image=1#view');
      await app.evaluate(() => {
        const target = new URL(location.href);
        target.pathname = '/publisher/editor';
        history.replaceState({ view: 'publisher-alias' }, '', target.href);
      });
      assert.equal(app.url(), entry + 'editor?image=1#view');
      await app.evaluate(() =>
        history.replaceState({ view: 'result' }, '', '?image=2#result'),
      );
      assert.equal(app.url(), entry + 'editor?image=2#result');
      assert.deepEqual(await app.evaluate(() => history.state), { view: 'result' });
      const worker = await app.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const child = new Worker('./worker.js');
            child.onmessage = (event) => {
              resolve(event.data);
              child.terminate();
            };
            child.onerror = () => reject(new Error('Worker failed after history route'));
          }),
      );
      assert.deepEqual(worker, { mode: 'network-isolated' });
      const denied = await app.evaluate(
        ({ origin, entry }) => {
          const attempts = [
            origin + '/collect?nonce=' + crypto.randomUUID(),
            new URL('/runtime/connect.html', entry).href,
            new URL('/runtime/anotherapp1/fixture/', entry).href,
            entry + '__contexts/raw.js',
            entry + '?host-content=1',
            entry + '?h%6fst-content=1',
          ];
          return attempts.map((url) => {
            try {
              history.replaceState({}, '', url);
              return false;
            } catch {
              return true;
            }
          });
        },
        { origin: outside.replace('127.0.0.1', 'localhost'), entry },
      );
      assert(denied.every(Boolean));
      assert.equal(app.url(), entry + 'editor?image=2#result');
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app.getByText('network-isolated', { exact: true }).waitFor();
      assert.equal(app.url(), entry + 'editor?image=2#result');
      assert.deepEqual(traffic.slice(before), []);
      receipt.results.push({
        name,
        version: browser.version(),
        entry,
        routed: app.url(),
        worker,
        denied,
        offlineReload: true,
        receiverRequests: traffic.slice(before),
      });
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await ownedHost?.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/application-history.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
}
console.log(
  'Chromium and Firefox: root application history, worker identity and offline route reload passed',
);
