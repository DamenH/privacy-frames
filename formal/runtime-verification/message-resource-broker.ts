import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { chromium, firefox, type Page } from 'playwright';
import { launch } from '../../test/browser-profile.ts';

// An independent transport experiment. This does not replace runtime admission,
// context authentication, native guards, or their outstanding proof obligations.
const relaxedPolicy = process.env.PF_BROKER_RELAX_CSP === '1';
const application = `
self.onmessage = async (event) => {
  try {
    const values = await Promise.all([fetch('./data.json'), fetch('./data.json')]);
    const bodies = await Promise.all(values.map((value) => value.json()));
    const binary = Array.from(
      new Uint8Array(await (await fetch('./bytes.bin')).arrayBuffer()),
    );
    const wasm = await WebAssembly.instantiateStreaming(fetch('./empty.wasm'), {});
    let missingRefused = false;
    try {
      await fetch('./missing.json');
    } catch {
      missingRefused = true;
    }
    let foreignRefused = false;
    try {
      await fetch('https://not-admitted.invalid/app/data.json');
    } catch {
      foreignRefused = true;
    }
    const nativeRefused = await new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.open('GET', new URL('/native-attempt', event.data.origin));
      request.onload = () => resolve(false);
      request.onerror = () => resolve(true);
      try {
        request.send();
      } catch {
        resolve(true);
      }
    });
    postMessage({
      value: bodies[0].value + bodies[1].value,
      binary,
      wasm: wasm.module instanceof WebAssembly.Module,
      missingRefused,
      foreignRefused,
      nativeRefused,
      input: event.data.value,
    });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};
postMessage('application-loaded');`;
const resources = {
  '/app/main.js': { body: application, type: 'text/javascript' },
  '/app/data.json': { body: '{"value":21}', type: 'application/json' },
  '/app/bytes.bin': { body: [0, 128, 255], type: 'application/octet-stream' },
  '/app/empty.wasm': { body: [0, 97, 115, 109, 1, 0, 0, 0], type: 'application/wasm' },
};
const serviceWorker = `
const admitted = ${JSON.stringify(resources)};
const cacheName = 'broker-probe';
const instance = crypto.randomUUID();
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      for (const [path, resource] of Object.entries(admitted))
        await cache.put(
          new URL(path, location.origin),
          new Response(
            Array.isArray(resource.body) ? new Uint8Array(resource.body) : resource.body,
            {
              headers: { 'Content-Type': resource.type },
            },
          ),
        );
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(
    (async () => {
      try {
        const data = event.data;
        if (
          !data ||
          data.type !== 'read' ||
          typeof data.path !== 'string' ||
          !Object.hasOwn(admitted, data.path)
        )
          throw new Error('Not admitted');
        const response = await (
          await caches.open(cacheName)
        ).match(new URL(data.path, location.origin));
        if (!response) throw new Error('Resource missing');
        const body = await response.arrayBuffer();
        port.postMessage(
          { ok: true, body, type: response.headers.get('Content-Type'), instance },
          [body],
        );
      } catch (error) {
        port.postMessage({ ok: false, error: String(error) });
      } finally {
        port.close();
      }
    })(),
  );
});`;

function workerBootstrap() {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  const apply = Reflect.apply;
  const add = EventTarget.prototype.addEventListener;
  const post = MessagePort.prototype.postMessage;
  const close = MessagePort.prototype.close;
  const NativeChannel = MessageChannel;
  const NativePromise = Promise;
  const NativeResponse = Response;
  const NativeArrayBuffer = ArrayBuffer;
  const NativeURL = URL;
  const NativeBlob = Blob;
  const define = Object.defineProperty;
  const rawImport = scope.importScripts;
  const createURL = URL.createObjectURL;
  const revokeURL = URL.revokeObjectURL;
  apply(add, scope, [
    'message',
    (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        !('code' in data) ||
        typeof data.code !== 'string' ||
        !('base' in data) ||
        typeof data.base !== 'string' ||
        event.ports.length !== 1
      )
        throw new Error('Invalid trusted bootstrap');
      const broker = event.ports[0];
      const base = data.base;
      define(scope, 'fetch', {
        value(input: unknown) {
          return new NativePromise<Response>((resolve, reject) => {
            if (typeof input !== 'string') {
              reject(new TypeError('Probe supports string GET requests only'));
              return;
            }
            const target = new NativeURL(input, base);
            if (
              target.origin !== new NativeURL(base).origin ||
              target.search ||
              target.hash ||
              target.username ||
              target.password
            ) {
              reject(new TypeError('Request is not a canonical local resource'));
              return;
            }
            const path = target.pathname;
            const channel = new NativeChannel();
            const timer = setTimeout(() => {
              apply(close, channel.port1, []);
              reject(new Error('Read timed out'));
            }, 10_000);
            channel.port1.onmessage = (reply: MessageEvent<unknown>) => {
              clearTimeout(timer);
              apply(close, channel.port1, []);
              const packet = reply.data;
              if (
                !packet ||
                typeof packet !== 'object' ||
                !('ok' in packet) ||
                packet.ok !== true ||
                !('body' in packet) ||
                !(packet.body instanceof NativeArrayBuffer) ||
                !('type' in packet) ||
                typeof packet.type !== 'string'
              ) {
                reject(new Error('Resource refused'));
                return;
              }
              resolve(
                new NativeResponse(packet.body, {
                  headers: { 'Content-Type': packet.type },
                }),
              );
            };
            apply(post, broker, [{ path }, [channel.port2]]);
          });
        },
        writable: false,
        configurable: false,
      });
      const entry = apply(createURL, NativeURL, [
        new NativeBlob([data.code], { type: 'text/javascript' }),
      ]);
      try {
        apply(rawImport, scope, [entry]);
      } finally {
        apply(revokeURL, NativeURL, [entry]);
      }
    },
    { once: true },
  ]);
}

const requests: Array<{ path: string; time: number }> = [];
const receiver = http.createServer((request, response) => {
  requests.push({ path: request.url || '/', time: Date.now() });
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(serviceWorker);
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><link rel="icon" href="data:,">Message broker probe');
  } else {
    response.writeHead(404).end('Independent network receiver');
  }
});
const receipt = new URL(
  relaxedPolicy
    ? './message-resource-broker-relaxed.json'
    : './message-resource-broker.json',
  import.meta.url,
);
await rm(receipt, { force: true });
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const address = receiver.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const rows: object[] = [];

async function quiet(page: Page) {
  let count = requests.length;
  let changed = Date.now();
  const deadline = Date.now() + 20_000;
  while (Date.now() - changed < 3000) {
    assert(Date.now() < deadline, 'Setup did not become quiet');
    await page.waitForTimeout(250);
    if (count !== requests.length) {
      count = requests.length;
      changed = Date.now();
    }
  }
}

async function waitForState(page: Page, predicate: () => boolean, description: string) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    assert(Date.now() < deadline, description);
    await page.waitForTimeout(50);
  }
}

async function exercise(page: Page, value: string): Promise<unknown> {
  return await page.evaluate(async (value) => {
    const worker: unknown = Reflect.get(globalThis, '__brokerWorker');
    if (!(worker instanceof Worker)) throw new Error('Application worker missing');
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Application timed out')), 10_000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.postMessage({ value, origin: location.origin });
    });
  }, value);
}

try {
  for (const profile of [
    { engine: chromium, stale: false },
    { engine: firefox, stale: false },
    { engine: firefox, stale: true },
  ]) {
    const browser = await launch(
      profile.engine,
      profile.stale
        ? {
            firefoxUserPrefs: { 'dom.serviceWorkers.testUpdateOverOneDay': true },
          }
        : {},
    );
    try {
      for (const unregistered of [false, true]) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(origin);
          const controlStart = requests.length;
          await page.evaluate(async () => {
            const source = `const request = new XMLHttpRequest();
              request.open('GET', ${JSON.stringify(location.origin + '/native-control')});
              request.onload = () => postMessage('received');
              request.onerror = () => postMessage('failed'); request.send();`;
            const url = URL.createObjectURL(
              new Blob([source], { type: 'text/javascript' }),
            );
            const worker = new Worker(url);
            try {
              const result = await new Promise((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error('Native control timed out')),
                  10_000,
                );
                worker.onerror = (event) => {
                  clearTimeout(timer);
                  reject(new Error(event.message));
                };
                worker.onmessage = (event) => {
                  clearTimeout(timer);
                  resolve(event.data);
                };
              });
              if (result !== 'received') throw new Error('Native XHR control failed');
            } finally {
              worker.terminate();
              URL.revokeObjectURL(url);
            }
          });
          const nativeControl = requests.slice(controlStart);
          assert(nativeControl.some((request) => request.path === '/native-control'));
          await page.evaluate(
            async ({ unregistered, relaxedPolicy }) => {
              const registration = await navigator.serviceWorker.register('/sw.js', {
                updateViaCache: 'none',
              });
              await navigator.serviceWorker.ready;
              if (!navigator.serviceWorker.controller)
                await new Promise<void>((resolve) =>
                  navigator.serviceWorker.addEventListener(
                    'controllerchange',
                    () => resolve(),
                    { once: true },
                  ),
                );
              if (unregistered && !(await registration.unregister()))
                throw new Error('Unregister failed');
              const controller = navigator.serviceWorker.controller;
              if (!controller) throw new Error('Controller missing');
              const post = ServiceWorker.prototype.postMessage;
              const apply = Reflect.apply;
              const read = (path: string) =>
                new Promise<unknown>((resolve, reject) => {
                  const reply = new MessageChannel();
                  const timer = setTimeout(
                    () => reject(new Error('Read timed out')),
                    10_000,
                  );
                  reply.port1.onmessage = (event) => {
                    clearTimeout(timer);
                    reply.port1.close();
                    resolve(event.data);
                  };
                  apply(post, controller, [{ type: 'read', path }, [reply.port2]]);
                });
              // Each operation uses a fresh reply port. No persistent SW-side port
              // is required to survive termination of the service-worker global.
              Reflect.set(globalThis, '__brokerRead', read);
              Reflect.set(globalThis, '__brokerController', controller);
              const policy = document.createElement('meta');
              policy.httpEquiv = 'Content-Security-Policy';
              policy.content =
                "default-src 'none'; script-src blob: 'unsafe-eval'; worker-src blob:; connect-src " +
                (relaxedPolicy ? "'self'" : "'none'");
              document.head.append(policy);
            },
            { unregistered, relaxedPolicy },
          );
          await quiet(page);
          const start = requests.length;
          await page.evaluate(async (bootstrap) => {
            const read = Reflect.get(globalThis, '__brokerRead');
            const source: unknown = await read('/app/main.js');
            if (
              !source ||
              typeof source !== 'object' ||
              !('ok' in source) ||
              source.ok !== true ||
              !('body' in source) ||
              !(source.body instanceof ArrayBuffer) ||
              !('instance' in source) ||
              typeof source.instance !== 'string'
            )
              throw new Error('Application source refused');
            const sourceCode = new TextDecoder().decode(source.body);
            const channel = new MessageChannel();
            const controller: ServiceWorker = Reflect.get(
              globalThis,
              '__brokerController',
            );
            channel.port1.onmessage = (event: MessageEvent<unknown>) => {
              const port = event.ports[0];
              const packet = event.data;
              if (
                port &&
                packet &&
                typeof packet === 'object' &&
                'path' in packet &&
                typeof packet.path === 'string'
              )
                controller.postMessage({ type: 'read', path: packet.path }, [port]);
            };
            const url = URL.createObjectURL(
              new Blob([`(${bootstrap})();`], {
                type: 'text/javascript',
              }),
            );
            const worker = new Worker(url);
            Reflect.set(globalThis, '__brokerWorker', worker);
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Worker startup timed out')),
                10_000,
              );
              worker.onerror = (event) => reject(new Error(event.message));
              worker.onmessage = (event) => {
                if (event.data === 'application-loaded') {
                  clearTimeout(timer);
                  resolve();
                }
              };
              worker.postMessage(
                {
                  code: sourceCode,
                  base: location.origin + '/app/main.js',
                },
                [channel.port2],
              );
            });
            URL.revokeObjectURL(url);
          }, workerBootstrap.toString());
          const result = await exercise(page, 'private-input');
          assert.deepEqual(result, {
            value: 42,
            binary: [0, 128, 255],
            wasm: true,
            missingRefused: true,
            foreignRefused: true,
            nativeRefused: !relaxedPolicy,
            input: 'private-input',
          });
          await page.waitForTimeout(3000);
          const firstRequests = requests.slice(start);
          if (relaxedPolicy)
            assert(
              firstRequests.some((request) => request.path === '/native-attempt'),
              'Relaxed policy did not reach the independent receiver',
            );
          else assert.deepEqual(firstRequests, []);
          const lossStart = requests.length;
          await page.evaluate(async () => {
            const removed = await (
              await caches.open('broker-probe')
            ).delete(new URL('/app/data.json', location.origin));
            if (!removed) throw new Error('Admitted entry was not removed');
          });
          const missing = await exercise(page, 'after-storage-loss');
          assert.deepEqual(missing, { error: 'Error: Resource refused' });
          await page.waitForTimeout(3000);
          const lossRequests = requests.slice(lossStart);
          assert.deepEqual(lossRequests, []);
          await page.evaluate(async () => {
            await (
              await caches.open('broker-probe')
            ).put(
              new URL('/app/data.json', location.origin),
              new Response('{"value":21}', {
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          });
          let restart: object = {
            disposition: 'not-run',
            reason: 'No equivalent Firefox termination control established',
          };
          if (profile.engine === chromium) {
            const session = await context.newCDPSession(page);
            const versions = new Map<string, string>();
            const transitions: Array<{ id: string; status: string }> = [];
            session.on('ServiceWorker.workerVersionUpdated', (event) => {
              for (const version of event.versions)
                if (version.scriptURL === origin + '/sw.js') {
                  versions.set(version.versionId, version.runningStatus);
                  transitions.push({
                    id: version.versionId,
                    status: version.runningStatus,
                  });
                }
            });
            await session.send('ServiceWorker.enable');
            await waitForState(
              page,
              () => [...versions.values()].includes('running'),
              'Running SW version missing',
            );
            const version = [...versions].find(([, status]) => status === 'running');
            assert(version);
            const before: unknown = await page.evaluate(async () => {
              const read = Reflect.get(globalThis, '__brokerRead');
              return await read('/app/data.json');
            });
            assert(
              before &&
                typeof before === 'object' &&
                'instance' in before &&
                typeof before.instance === 'string',
            );
            const beforeInstance = before.instance;
            const restartStart = requests.length;
            await session.send('ServiceWorker.stopWorker', { versionId: version[0] });
            await waitForState(
              page,
              () => versions.get(version[0]) === 'stopped',
              'SW did not stop',
            );
            const after = await exercise(page, 'after-restart');
            await waitForState(
              page,
              () => versions.get(version[0]) === 'running',
              'SW did not awaken for message',
            );
            const packet: unknown = await page.evaluate(async () => {
              const read = Reflect.get(globalThis, '__brokerRead');
              return await read('/app/data.json');
            });
            assert(
              packet &&
                typeof packet === 'object' &&
                'instance' in packet &&
                typeof packet.instance === 'string',
            );
            assert.notEqual(
              packet.instance,
              beforeInstance,
              'SW global was not replaced',
            );
            assert.deepEqual(after, {
              value: 42,
              binary: [0, 128, 255],
              wasm: true,
              missingRefused: true,
              foreignRefused: true,
              nativeRefused: !relaxedPolicy,
              input: 'after-restart',
            });
            await page.waitForTimeout(3000);
            const observed = requests.slice(restartStart);
            if (relaxedPolicy)
              assert(observed.some((request) => request.path === '/native-attempt'));
            else assert.deepEqual(observed, []);
            restart = {
              disposition: 'terminated-and-awakened',
              result: after,
              requests: observed,
              beforeInstance,
              afterInstance: packet.instance,
              transitions,
            };
            await session.detach();
          }
          rows.push({
            browser: profile.engine.name(),
            version: browser.version(),
            forcedStaleCheck: profile.stale,
            unregistered,
            relaxedPolicy,
            nativeControl,
            result,
            firstRequests,
            storageLoss: { result: missing, requests: lossRequests },
            restart,
          });
          console.log(profile.engine.name(), unregistered, JSON.stringify(result));
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    receipt,
    JSON.stringify(
      {
        scope:
          'Read-only message resource transport to classic Blob workers with registered and unregistered SW controllers. The strict policy forbids native HTTP; the relaxed-policy control permits same-origin native HTTP and requires receiver delivery. Independent mechanism experiment, not the production admission or context protocol. Chromium worker termination is a test-only lifecycle control.',
        runnerSHA256: createHash('sha256')
          .update(await readFile(import.meta.filename))
          .digest('hex'),
        browserProfileSHA256: createHash('sha256')
          .update(
            await readFile(new URL('../../test/browser-profile.ts', import.meta.url)),
          )
          .digest('hex'),
        packageLockSHA256: createHash('sha256')
          .update(await readFile(new URL('../../package-lock.json', import.meta.url)))
          .digest('hex'),
        bootstrapSHA256: createHash('sha256')
          .update(workerBootstrap.toString())
          .digest('hex'),
        serviceWorkerSHA256: createHash('sha256').update(serviceWorker).digest('hex'),
        observationMilliseconds: 3000,
        rows,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
}
