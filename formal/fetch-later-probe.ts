import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { trustedPolicyPlugin } from '../scripts/trusted-policy.ts';
import { response } from '../src/runtime/response-policy.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'ts',
    contents: `
      import { prepareWindowRealm } from './src/runtime/contexts/window-realm.ts';
      const applicationURL = location.origin + location.pathname;
      const realm = prepareWindowRealm({
        application:'fetch-later-probe', applicationURL,
        scriptNonce:'fixture', enableDocumentContexts:true,
      });
      realm.admitContent({installationGeneration:'generation', aliases:[], source:applicationURL});
      globalThis.prepared = true;
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  plugins: [await trustedPolicyPlugin(root)],
});
const sw = `
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  const events = [];
  const setup = new Set(['/app/native', '/app/prepared/', '/app/fixture.js']);
  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    events.push({url:url.href, method:event.request.method});
    if (url.pathname === '/app/events' && !url.search) {
      event.respondWith(new Response(JSON.stringify(events))); return;
    }
    const allowed = setup.has(url.pathname) && !url.search && event.request.method === 'GET';
    event.respondWith(allowed ? fetch(event.request) : new Response('SW blocked',{status:403}));
  });
`;
const traffic = [];
let origin;
const server = http.createServer(async (request, reply) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  traffic.push({
    at: new Date().toISOString(),
    url: request.url,
    method: request.method,
    body,
  });
  reply.setHeader('Cache-Control', 'no-store');
  if (request.url === '/app/sw.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(sw);
    return;
  }
  if (request.url === '/app/fixture.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(fixture.outputFiles[0].text);
    return;
  }
  if (request.url === '/app/prepared/') {
    for (const [name, value] of response('', 'text/html', 200, {
      scriptNonce: 'fixture',
      controllerSource: origin + '/app/sw.js',
      workerSource: origin + '/__contexts/',
      frameSource: origin + '/__contexts/',
    }).headers)
      reply.setHeader(name, value);
    reply.end('<!doctype html><script nonce="fixture" src="/app/fixture.js"></script>');
    return;
  }
  reply.setHeader('Content-Type', 'text/html');
  reply.end('<!doctype html><title>Deferred fetch observer</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;
const receipt = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  testedAt: new Date().toISOString(),
  origin,
  scope:
    'fetchLater native delivery, page-close flush, blocking-worker behavior and actual current prepareWindowRealm. Private markers are created after preparation; each native control requires independent HTTP delivery. Firefox absence is recorded without a containment claim.',
  runnerSHA256: createHash('sha256')
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest('hex'),
  fixtureSHA256: createHash('sha256')
    .update(fixture.outputFiles[0].contents)
    .digest('hex'),
  sourceHashes: Object.fromEntries(
    await Promise.all(
      ['src/runtime/enforcement/effects.ts', 'src/runtime/contexts/window-realm.ts'].map(
        async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(root, path)))
            .digest('hex'),
        ],
      ),
    ),
  ),
  rows: [],
  traffic,
};
const waitForDelivery = async (marker) => {
  const deadline = Date.now() + 12000;
  while (!traffic.some((item) => item.method === 'POST' && item.body === marker)) {
    assert(
      Date.now() < deadline,
      'Native fetchLater receiver control inactive: ' + marker,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const browser = await engine.launch(
      name === 'chromium'
        ? {
            executablePath: chromium.executablePath(),
            args: ['--enable-automation'],
            ignoreDefaultArgs: ['--disable-background-networking'],
          }
        : {},
    );
    try {
      const context = await browser.newContext();
      const observer = await context.newPage();
      await observer.goto(origin + '/native');
      const exposed = await observer.evaluate(() => typeof fetchLater === 'function');
      const row = { name, version: browser.version(), exposed, cases: [] };
      receipt.rows.push(row);
      if (!exposed) continue;
      row.actualArguments = (
        await (
          await context.newCDPSession(observer)
        ).send('Browser.getBrowserCommandLine')
      ).arguments;
      for (const profile of [
        'native-immediate',
        'native-close',
        'native-worker-close',
        'prepared-immediate',
        'prepared-close',
      ]) {
        if (profile === 'native-worker-close') {
          await observer.evaluate(async () => {
            const registration = await navigator.serviceWorker.register('/app/sw.js');
            const worker =
              registration.installing || registration.waiting || registration.active;
            if (worker.state !== 'activated')
              await new Promise((resolve) =>
                worker.addEventListener('statechange', () => {
                  if (worker.state === 'activated') resolve();
                }),
              );
          });
        }
        const page = await context.newPage();
        const prepared = profile.startsWith('prepared');
        const controlled = prepared || profile === 'native-worker-close';
        const navigation = await page.goto(
          origin + (prepared ? '/app/prepared/' : controlled ? '/app/native' : '/native'),
        );
        if (prepared) await page.waitForFunction(() => globalThis.prepared);
        const marker = profile + '-' + randomUUID();
        const start = traffic.length;
        const state = await page.evaluate(
          async ({ marker, close, prepared }) => {
            const state = {
              mode: globalThis.privacyHost?.mode,
              call: null,
              recovery: null,
              ordinaryFetch: null,
            };
            const options = {
              method: 'POST',
              body: marker,
              activateAfter: close ? 60000 : 0,
            };
            try {
              state.call = {
                result: 'scheduled',
                activated: fetchLater('/receiver?' + marker, options).activated,
              };
            } catch (error) {
              state.call = { error: error.name, message: error.message };
            }
            if (prepared) {
              try {
                let target = window;
                while (target && !Object.getOwnPropertyDescriptor(target, 'fetchLater'))
                  target = Object.getPrototypeOf(target);
                const descriptor = Object.getOwnPropertyDescriptor(target, 'fetchLater');
                const fn = descriptor.value || descriptor.get.call(window);
                Reflect.apply(fn, window, ['/receiver?recovered-' + marker, options]);
                state.recovery = 'scheduled';
              } catch (error) {
                state.recovery = error.name;
              }
              state.ordinaryFetch = await (
                await fetch('/receiver?ordinary-' + marker)
              ).text();
            }
            return state;
          },
          { marker, close: profile.endsWith('close'), prepared },
        );
        const headers = await navigation.allHeaders();
        let beforeCloseTraffic;
        if (profile.endsWith('close')) {
          await page.waitForTimeout(200);
          beforeCloseTraffic = traffic
            .slice(start)
            .filter((item) => JSON.stringify(item).includes(marker));
          assert.equal(
            beforeCloseTraffic.length,
            0,
            'Deferred request sent before close',
          );
          await page.close();
        }
        if (!prepared) await waitForDelivery(marker);
        else {
          assert.equal(state.call.error, 'SecurityError');
          assert.equal(state.recovery, 'SecurityError');
          assert.equal(state.ordinaryFetch, 'SW blocked');
          await observer.waitForTimeout(1500);
        }
        const markerTraffic = traffic
          .slice(start)
          .filter((item) => JSON.stringify(item).includes(marker));
        if (prepared) assert.equal(markerTraffic.length, 0);
        row.cases.push({
          profile,
          marker,
          state,
          headers,
          beforeCloseTraffic,
          markerTraffic,
        });
        if (!page.isClosed()) await page.close();
      }
      // A live post-close positive control also calibrates delivery at the end.
      const final = 'native-after-' + randomUUID();
      await observer.evaluate(
        (marker) =>
          fetchLater('/receiver?' + marker, {
            method: 'POST',
            body: marker,
            activateAfter: 0,
          }),
        final,
      );
      await waitForDelivery(final);
      row.finalControl = { marker: final, delivered: true };
      for (const item of row.cases.filter((item) => item.profile.startsWith('prepared')))
        assert(!traffic.some((request) => JSON.stringify(request).includes(item.marker)));
      row.workerEvents = await observer.evaluate(async () => {
        const page = document.createElement('iframe');
        // No app markup involved: observer remains unrestricted and outside scope.
        page.src = '/app/native';
        document.body.append(page);
        await new Promise((resolve) => (page.onload = resolve));
        return (await page.contentWindow.fetch('/app/events')).json();
      });
      const workerControl = row.cases.find(
        (item) => item.profile === 'native-worker-close',
      );
      assert(
        !row.workerEvents.some((event) => event.url.includes(workerControl.marker)),
        'Native deferred control unexpectedly passed through worker',
      );
    } finally {
      await browser.close();
    }
  }
  receipt.completed = true;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    new URL('evidence/fetch-later.json', import.meta.url),
    JSON.stringify(receipt, null, 2) + '\n',
  );
}
