import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const bundle = await build({
  entryPoints: ['src/installation/prepare-worker.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const workerSource = bundle.outputFiles[0].text;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Type',
    request.url === '/worker.js' ? 'text/javascript' : 'text/html',
  );
  response.end(
    request.url === '/worker.js'
      ? workerSource
      : '<!doctype html><title>Preparation capability fixture</title>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Fixture address missing');
const base = `http://127.0.0.1:${address.port}/`;
const results = [];
const provenance = await testProvenance(import.meta.url);
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto(base);
      const result = await page.evaluate(async () => {
        const worker = new Worker('/worker.js');
        try {
          return await new Promise<{ hash: string; limited: boolean; base64: boolean }>(
            (resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Preparation fixture timed out')),
                10000,
              );
              worker.onerror = (event) => {
                clearTimeout(timer);
                reject(new Error(event.message));
              };
              worker.onmessage = (event: MessageEvent<unknown>) => {
                const message = event.data;
                if (!message || typeof message !== 'object' || !('type' in message))
                  return;
                clearTimeout(timer);
                if (
                  message.type !== 'prepared' ||
                  !('caches' in message) ||
                  !Array.isArray(message.caches)
                ) {
                  reject(new Error(JSON.stringify(message)));
                  return;
                }
                const entry = message.caches[0]?.entries?.[0];
                if (!(entry?.bytes instanceof ArrayBuffer)) {
                  reject(new Error('Preparation fixture response missing'));
                  return;
                }
                resolve(JSON.parse(new TextDecoder().decode(entry.bytes)));
              };
              worker.postMessage({
                type: 'prepare',
                scope: 'https://publisher.test/application/',
                scriptURL: 'https://publisher.test/application/foreground.js',
                code: `self.addEventListener('install', event => event.waitUntil((async () => {
                const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
                const hash = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
                const limited = typeof crypto.getRandomValues === 'undefined' && typeof crypto.subtle.generateKey === 'undefined' && typeof WebSocket === 'undefined' && typeof XMLHttpRequest === 'undefined' && typeof Worker === 'undefined' && typeof indexedDB === 'undefined' && typeof self.postMessage === 'undefined';
                const base64 = btoa('abc') === 'YWJj' && atob('YWJj') === 'abc';
                const clock = Number.isFinite(Date.now());
                const cache = await caches.open('fixture');
                await cache.put('./digest.json', new Response(JSON.stringify({hash, limited, base64, clock}), {headers:{'Content-Type':'application/json'}}));
              })()));`,
              });
            },
          );
        } finally {
          worker.terminate();
        }
      });
      assert.equal(
        result.hash,
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      assert.equal(result.limited, true);
      assert.equal(result.base64, true);
      assert.equal(result.clock, true);
      results.push({ name, version: browser.version(), result });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await writeFile(
    'results/contexts/preparation-capabilities.json',
    JSON.stringify({ provenance, browsers: results }, null, 2) + '\n',
  );
}
console.log(
  results
    .map(
      (result) => `${result.name}: restricted preparation hash/base64 capability passed`,
    )
    .join('\n'),
);
