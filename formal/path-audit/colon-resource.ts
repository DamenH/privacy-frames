import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, firefox } from 'playwright';
import { servers } from '../../test/server.ts';
import { provideResourceList } from '../../test/resource-list-input.ts';
import { resourceURL } from '../../src/shared/runtime-url.ts';

// Real publisher URL, installer, admitted resource graph, runtime and independent
// local receiver. The positive control proves the receiver is reachable; the
// prepared attempt tests one concrete fetch route, not every possible channel.
const temporary = await mkdtemp(join(tmpdir(), 'pf-colon-path-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(temporary, 'key.pem'),
    '-out',
    join(temporary, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);
const key = await readFile(join(temporary, 'key.pem'));
const cert = await readFile(join(temporary, 'cert.pem'));
const observed: string[] = [];
const receiver = https.createServer({ key, cert }, (request, response) => {
  observed.push(request.url ?? '');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end('native receiver');
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverAddress = receiver.address();
assert(receiverAddress && typeof receiverAddress !== 'string');
const receiverURL = `https://127.0.0.1:${receiverAddress.port}/`;
const path = `https:127.0.0.1:${receiverAddress.port}`;
const publisher = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/' + path) {
    response.setHeader('Content-Type', 'text/plain');
    response.end('synthetic admitted bytes');
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Colon fixture</title>
      <button id="send">Send</button><output id="out"></output>
      <script>
        globalThis.pathAuditPublisherRan = true;
        document.getElementById('send').onclick = async () => {
          try { await fetch(${JSON.stringify(receiverURL + '?private-marker=synthetic')}); }
          catch (error) { document.getElementById('out').textContent = error.name; }
        };
      </script>`);
  }
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const publisherAddress = publisher.address();
assert(publisherAddress && typeof publisherAddress !== 'string');
const publisherURL = `http://127.0.0.1:${publisherAddress.port}/`;
const host = await servers({ receiver: false });
const rows: object[] = [];
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const native = await context.newPage();
      await native.goto(publisherURL);
      const marker = 'native-' + engine.name();
      await native.evaluate((url) => fetch(url), receiverURL + '?marker=' + marker);
      assert(
        observed.some((url) => url.includes(marker)),
        'Native receiver control failed',
      );
      await native.close();
      // The same publisher starts normally when the problematic additional path is absent.
      const controlContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const controlManager = await controlContext.newPage();
      await controlManager.goto('http://127.0.0.1:4210/privacy-frames/');
      await controlManager.getByText('Ready to install.', { exact: true }).waitFor();
      await controlManager.locator('#app-url').fill(publisherURL);
      await controlManager.locator('#install button').click();
      await controlManager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')!.textContent!,
          ),
        {},
        { timeout: 120000 },
      );
      assert.match(
        (await controlManager.locator('#status').textContent())!,
        /^Installed /,
      );
      const controlOpened = controlContext.waitForEvent('page');
      await controlManager.locator('.app-card [data-app]').first().click();
      const controlApp = await controlOpened;
      await controlApp.locator('#send').waitFor({ timeout: 15000 });
      assert.equal(
        await controlApp.evaluate(() => Reflect.get(globalThis, 'pathAuditPublisherRan')),
        true,
      );
      await controlContext.close();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(publisherURL);
      await provideResourceList(manager, [publisherURL + path]);
      await manager.locator('#install button').click();
      await manager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')!.textContent!,
          ),
        {},
        { timeout: 120000 },
      );
      const status = await manager.locator('#status').textContent();
      assert.match(status!, /^Installed /);
      const bridge = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(bridge);
      const captured = await bridge.evaluate(async (source) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('privacy-frames-resources');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const request = database
              .transaction('installations')
              .objectStore('installations')
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const app = records.find(
            (value) =>
              value &&
              typeof value === 'object' &&
              'source' in value &&
              value.source === source,
          );
          assertApp(app);
          return {
            id: app.id,
            manifestId: app.manifest.id,
            resources: app.resources.map((r) => ({ path: r.path, url: r.url })),
          };
        } finally {
          database.close();
        }
        function assertApp(value: unknown): asserts value is {
          id: string;
          manifest: { id: string };
          resources: { path: string; url: string }[];
        } {
          if (
            !value ||
            typeof value !== 'object' ||
            !('id' in value) ||
            !('manifest' in value) ||
            !('resources' in value)
          )
            throw new Error('Missing installed metadata');
        }
      }, publisherURL);
      const installed = captured.resources.find(
        (resource) => resource.url === publisherURL + path,
      );
      assert(installed);
      assert.equal(installed.path, path);
      const mapped = resourceURL(
        { id: captured.id, manifest: { id: captured.manifestId } },
        path,
        'http://127.0.0.1:4211/runtime/',
      ).href;
      assert.equal(mapped, receiverURL);
      const events = async () =>
        bridge.evaluate(async () => {
          const channel = new MessageChannel();
          const result = await new Promise<{
            ok: boolean;
            value: { kind: string; url: string }[];
          }>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Event query timed out')),
              10000,
            );
            channel.port1.onmessage = (event) => {
              clearTimeout(timer);
              resolve(event.data);
            };
            navigator.serviceWorker.controller!.postMessage({ operation: 'events' }, [
              channel.port2,
            ]);
          });
          channel.port1.close();
          if (!result.ok) throw new Error('Event query refused');
          return result.value;
        });
      const before = await events();
      const start = observed.length;
      const consoleMessages: string[] = [];
      let csp: string | undefined;
      context.on('page', (page) => {
        page.on('console', (message) => consoleMessages.push(message.text()));
        page.on('pageerror', (error) =>
          consoleMessages.push('pageerror: ' + error.message),
        );
      });
      context.on('response', (response) => {
        if (
          response.request().isNavigationRequest() &&
          response.url().startsWith('http://127.0.0.1:4211/runtime/')
        )
          csp = response.headers()['content-security-policy'];
      });
      const opened = context.waitForEvent('page');
      await manager.locator('.app-card [data-app]').first().click();
      const app = await opened;
      await app.getByText('Application could not start').waitFor({ timeout: 15000 });
      assert(csp?.includes("connect-src 'self'"));
      assert.equal(await app.locator('#send').count(), 0);
      assert.equal(
        await app.evaluate(() => Reflect.get(globalThis, 'pathAuditPublisherRan')),
        undefined,
      );
      const after = await events();
      const matchingEvents = after
        .slice(before.length)
        .filter((item) => item.url.includes('127.0.0.1:' + receiverAddress.port));
      assert.deepEqual(observed.slice(start), []);
      rows.push({
        browser: engine.name(),
        version: browser.version(),
        status,
        installed,
        mapped,
        nativeReceiver: true,
        ordinaryInstallationStarted: true,
        csp,
        consoleMessages,
        errorPage: await app.locator('body').innerText(),
        workerEvents: matchingEvents,
        confinedResult:
          'Document resource leaves its application; publisher script did not execute',
        confinedReceiver: observed.slice(start),
      });
      await app.close();
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await host.close();
  publisher.closeAllConnections();
  receiver.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => publisher.close(() => resolve())),
    new Promise<void>((resolve) => receiver.close(() => resolve())),
  ]);
  await rm(temporary, { recursive: true, force: true });
}
await mkdir('formal/path-audit', { recursive: true });
await writeFile(
  'formal/path-audit/colon-resource.json',
  JSON.stringify(
    {
      scope:
        'A normal installation accepts a foreign-resolving resource alias; document startup rejects it before publisher code. Receiver calibration is native, with a test certificate. This is not an exhaustive egress proof.',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      runnerSHA256: createHash('sha256')
        .update(await readFile(import.meta.filename))
        .digest('hex'),
      artifactSHA256: Object.fromEntries(
        await Promise.all(
          [
            'src/shared/policy.ts',
            'src/shared/runtime-url.ts',
            'src/runtime/admission.ts',
            'src/runtime/document.ts',
            'src/runtime/contexts/document-protocol.ts',
            'src/installation/resource-capture.ts',
            'dist-runtime/guard.js',
            'dist-runtime/sw.js',
            'dist-installation/installation.js',
          ].map(async (file) => [
            file,
            createHash('sha256')
              .update(await readFile(file))
              .digest('hex'),
          ]),
        ),
      ),
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log('Installed colon-path case and native/confined fetch controls completed');
