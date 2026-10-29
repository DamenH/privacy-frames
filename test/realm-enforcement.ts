import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const source = resolve(import.meta.dirname, '../src/runtime');
async function bundle(worker: boolean) {
  const result = await build({
    stdin: {
      contents: `
import { resourceAliases } from ${JSON.stringify(resolve(source, 'resource-aliases.ts'))};
import { installEffectPolicy } from ${JSON.stringify(resolve(source, 'enforcement/effects.ts'))};
import { createPolicyTools } from ${JSON.stringify(resolve(source, 'enforcement/native.ts'))};
void (async () => {
  const tools = createPolicyTools();
  const NativeWorker = globalThis.Worker;
  const before = {
    storage: 'storage' in navigator,
    locks: 'locks' in navigator,
    serviceWorker: 'serviceWorker' in navigator,
  };
  const aliases = resourceAliases({
    ...tools,
    baseURL: () => location.origin + '/virtual/',
  });
  const destination = location.origin + '/admitted/value.txt?version=1';
  aliases.install([['https://publisher.invalid/value.txt', destination]]);
  const getters = ['href', 'hash'].map(name => [name, Object.getOwnPropertyDescriptor(URL.prototype, name)]);
  let intercepted = 0;
  let mapping;
  try {
    for (const [name, descriptor] of getters) {
      Object.defineProperty(URL.prototype, name, {
        ...descriptor,
        get() { intercepted++; return name === 'href' ? destination : ''; },
        ...(descriptor.set ? { set() { intercepted++; } } : {}),
      });
    }
    const nativeGetterControl = new URL('https://publisher.invalid/control').href === destination && intercepted > 0;
    intercepted = 0;
    mapping = {
      nativeGetterControl,
      original: aliases.isInstalledURL('https://publisher.invalid/value.txt#part'),
      admitted: aliases.isInstalledURL(destination + '#part'),
      unknown: aliases.isInstalledURL('https://publisher.invalid/unknown.txt'),
      query: aliases.isInstalledURL(destination.replace('version=1', 'version=2')),
      mapped: aliases.mapURL('https://publisher.invalid/value.txt#part'),
      intercepted,
    };
  } finally {
    for (const [name, descriptor] of getters) Object.defineProperty(URL.prototype, name, descriptor);
  }
  const text = await (await fetch('https://publisher.invalid/value.txt')).text();
  const factories = ${worker ? '{}' : '{ Worker: function controlledWorker() { return { mediated: true }; } }'};
  installEffectPolicy(tools, () => null, factories);
  const denied = {};
  for (const key of ['storage', 'locks', 'serviceWorker']) {
    if (!before[key]) { denied[key] = 'absent'; continue; }
    try { void navigator[key]; denied[key] = false; }
    catch (error) { denied[key] = error.name === 'SecurityError'; }
  }
  let socketDenied = false;
  try { new WebSocket('ws://127.0.0.1:1/'); }
  catch (error) { socketDenied = error.name === 'SecurityError'; }
  const report = { mapping, text, before, denied, socketDenied };
  ${
    worker
      ? 'postMessage(report);'
      : `
  report.factoryUsed = new Worker('ignored').mediated;
  report.worker = await new Promise((resolve, reject) => {
    const worker = new NativeWorker('/worker.js');
    const timer = setTimeout(() => reject(new Error('Worker module test timed out')), 15000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
  });
  Object.defineProperty(window, '__realmResult', { value: report });
  `
  }
})();
`,
      resolveDir: import.meta.dirname,
      sourcefile: worker ? 'worker-realm.ts' : 'window-realm.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2022',
  });
  return result.outputFiles[0].text;
}
const [windowScript, workerScript] = await Promise.all([bundle(false), bundle(true)]);
const observations: string[] = [];
const server = createServer((request, response) => {
  const route = request.url || '/';
  observations.push(route);
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'",
  );
  if (route === '/window.js' || route === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(route === '/window.js' ? windowScript : workerScript);
  } else if (route === '/admitted/value.txt?version=1') {
    response.setHeader('Content-Type', 'text/plain');
    response.end('installed resource');
  } else if (route === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script src="/window.js"></script>');
  } else {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server missing');
const evidence = {
  provenance: await testProvenance(import.meta.url),
  date: new Date().toISOString(),
  browsers: [],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(() => '__realmResult' in window, {}, { timeout: 20000 });
      const result = await page.evaluate(() => Reflect.get(window, '__realmResult'));
      for (const realm of [result, result.worker]) {
        assert.equal(realm.mapping.nativeGetterControl, true);
        assert.equal(realm.mapping.original, true);
        assert.equal(realm.mapping.admitted, true);
        assert.equal(realm.mapping.unknown, false);
        assert.equal(realm.mapping.query, false);
        assert.equal(realm.mapping.intercepted, 0);
        assert(realm.mapping.mapped.endsWith('/admitted/value.txt?version=1#part'));
        assert.equal(realm.text, 'installed resource');
        assert.equal(realm.socketDenied, true);
        for (const key of ['storage', 'locks', 'serviceWorker']) {
          assert.equal(realm.denied[key], realm.before[key] ? true : 'absent');
        }
      }
      assert.equal(result.factoryUsed, true);
      assert.deepEqual(errors, []);
      evidence.browsers.push({ name, version: browser.version(), result });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir(new URL('../results/contexts/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../results/contexts/realm-enforcement.json', import.meta.url),
    JSON.stringify({ ...evidence, requests: observations }, null, 2) + '\n',
  );
}
console.log('Common resource and effect policies pass in window and worker globals.');
