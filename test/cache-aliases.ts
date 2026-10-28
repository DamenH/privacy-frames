import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const source = resolve(import.meta.dirname, '../src/runtime');
async function bundle(worker: boolean) {
  const result = await build({
    stdin: {
      contents: `
import { resourceAliases } from ${JSON.stringify(resolve(source, 'resource-aliases.ts'))};
import { createPolicyTools } from ${JSON.stringify(resolve(source, 'enforcement/native.ts'))};
import { scopeContextStorage } from ${JSON.stringify(resolve(source, 'contexts/storage.ts'))};
void (async () => {
 const tools = createPolicyTools();
 const NativeWorker = globalThis.Worker;
 const origin = location.origin;
 const original = 'https://publisher.invalid/directory/value.txt?edition=1';
 const alias = origin + '/${worker ? 'worker' : 'window'}/value.txt?edition=1';
 const nativeCache = await caches.open('native-control');
 const rootURL = new URL('/cached-value?version=1', origin);
 const localRequest = new Request('local.txt?x=1');
 await nativeCache.put(rootURL, new Response('native-root'));
 await nativeCache.put(new Request(localRequest.url+'#ignored'), new Response('native-local'));
 const nativeControl = {
  rootString: await (await nativeCache.match('/cached-value?version=1'))?.text(),
  rootRequest: await (await nativeCache.match(new Request(rootURL)))?.text(),
  local: await (await nativeCache.match('local.txt?x=1'))?.text(),
  localURL: (await nativeCache.keys(localRequest))[0]?.url,
  rootURL: (await nativeCache.keys(rootURL))[0]?.url,
  wrongQuery: (await nativeCache.match('/cached-value?version=2')) === undefined,
  ignoreSearch: await (await nativeCache.match(new Request(new URL('/cached-value?version=2', origin)), {ignoreSearch:true}))?.text(),
 };
 await caches.delete('native-control');
 const aliases = resourceAliases({...tools,baseURL:()=> 'https://publisher.invalid/directory/'});
 aliases.install([[original,alias]]);
 scopeContextStorage('cache-normalization', tools);
 const cache = await caches.open('values');
 ${worker ? '' : 'await cache.add("value.txt?edition=1#first");'}
 const report = {
  nativeControl,
  relative: await (await cache.match('value.txt?edition=1#other'))?.text(),
  canonical: await (await cache.match(alias))?.text(),
  storage: await (await caches.match(alias,{cacheName:'values'}))?.text(),
  all: (await cache.matchAll(alias)).length,
  wrongQuery: (await cache.match('value.txt?edition=2')) === undefined,
  ignoreSearch: await (await cache.match('value.txt?edition=2',{ignoreSearch:true}))?.text(),
  key: (await cache.keys(alias))[0]?.url,
 };
 await cache.put('local.txt?x=1#ignored',new Response('local'));
 report.local = await (await cache.match(localRequest))?.text();
 report.localURL = (await cache.keys(localRequest))[0]?.url;
 await cache.put(rootURL, new Response('root'));
 report.rootString = await (await cache.match('/cached-value?version=1'))?.text();
 report.rootRequest = await (await caches.match(new Request(rootURL), {cacheName:'values'}))?.text();
 report.rootURL = (await cache.keys(rootURL))[0]?.url;
 await cache.put('value.txt?edition=2', new Response('variant'));
 const variantAlias = new URL(alias); variantAlias.search = '?edition=2';
 report.queryURL = await (await cache.match(variantAlias))?.text();
 report.queryRequest = await (await caches.match(new Request(variantAlias), {cacheName:'values'}))?.text();
 report.queryIgnoreSearch = await (await cache.match(new Request(variantAlias), {ignoreSearch:true}))?.text();
 report.queryDeleted = await cache.delete(variantAlias);
 variantAlias.search = '?edition=3';
 await cache.put(variantAlias, new Response('url-variant'));
 report.queryURLPut = await (await cache.match('value.txt?edition=3'))?.text();
 await cache.delete(variantAlias);
 variantAlias.search = '?edition=4';
 await cache.put(new Request(variantAlias), new Response('request-variant'));
 report.queryRequestPut = await (await cache.match('value.txt?edition=4'))?.text();
 await cache.delete(variantAlias);
 try { await cache.add('value.txt?edition=2'); report.queryDownloadRejected=false; }
 catch { report.queryDownloadRejected=true; }
 await cache.put('https://other.invalid/preserved',new Response('absolute'));
 report.absolute = (await cache.keys('https://other.invalid/preserved'))[0]?.url;
 report.deleted = await cache.delete('local.txt?x=1');
 report.deletedMissing = (await cache.match('local.txt?x=1')) === undefined;
 let rejected = false;
 try { await cache.add('unknown.txt'); } catch { rejected = true; }
 report.unknownRejected = rejected;
 report.names = await caches.keys();
 ${
   worker
     ? 'postMessage(report);'
     : `
 report.worker = await new Promise((resolve,reject)=>{
  const worker = new NativeWorker('/worker.js');
  worker.onmessage=event=>{ worker.terminate(); resolve(event.data); };
  worker.onerror=event=>reject(new Error(event.message));
 });
 Object.defineProperty(window,'__result',{value:report});`
 }
})().catch(error => { ${worker ? 'postMessage({error:String(error)});' : "Object.defineProperty(window,'__result',{value:{error:String(error)}});"} });
`,
      resolveDir: import.meta.dirname,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  });
  return result.outputFiles[0].text;
}
const [windowScript, workerScript] = await Promise.all([bundle(false), bundle(true)]);
const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(request.url || '/');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'",
  );
  if (request.url === '/window.js' || request.url === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(request.url === '/window.js' ? windowScript : workerScript);
  } else if (
    request.url === '/window/value.txt?edition=1' ||
    request.url === '/worker/value.txt?edition=1'
  ) {
    response.end('installed');
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script src="/window.js"></script>');
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing test server');
const evidence: object[] = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(() => '__result' in window, {}, { timeout: 20000 });
      const result = await page.evaluate(() => Reflect.get(window, '__result'));
      for (const realm of [result, result.worker]) {
        assert.equal(realm?.error, undefined, JSON.stringify(result));
        for (const key of ['relative', 'canonical', 'storage', 'ignoreSearch'])
          assert.equal(realm[key], 'installed');
        assert.equal(realm.all, 1);
        assert.equal(realm.wrongQuery, true);
        assert.equal(
          realm.key,
          'https://publisher.invalid/directory/value.txt?edition=1#first',
        );
        assert.equal(realm.local, 'local');
        assert.equal(realm.nativeControl.rootString, 'native-root');
        assert.equal(realm.nativeControl.rootRequest, 'native-root');
        assert.equal(realm.nativeControl.local, 'native-local');
        assert.equal(realm.nativeControl.wrongQuery, true);
        assert.equal(realm.nativeControl.ignoreSearch, 'native-root');
        assert.equal(realm.localURL, realm.nativeControl.localURL);
        assert.equal(realm.rootURL, realm.nativeControl.rootURL);
        assert.equal(realm.rootString, 'root');
        assert.equal(realm.rootRequest, 'root');
        assert.equal(realm.queryURL, 'variant');
        assert.equal(realm.queryRequest, 'variant');
        assert.equal(realm.queryIgnoreSearch, 'installed');
        assert.equal(realm.queryDeleted, true);
        assert.equal(realm.queryURLPut, 'url-variant');
        assert.equal(realm.queryRequestPut, 'request-variant');
        assert.equal(realm.queryDownloadRejected, true);
        assert.equal(realm.absolute, 'https://other.invalid/preserved');
        for (const key of ['deleted', 'deletedMissing', 'unknownRejected'])
          assert.equal(realm[key], true);
        assert.deepEqual(realm.names, ['values']);
      }
      evidence.push({ name, version: browser.version(), result });
    } finally {
      await browser.close();
    }
  }
  assert.equal(
    requests.some((value) => value.includes('unknown')),
    false,
  );
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  await mkdir(new URL('../results/contexts/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../results/contexts/cache-aliases.json', import.meta.url),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        bundles: {
          window: createHash('sha256').update(windowScript).digest('hex'),
          worker: createHash('sha256').update(workerScript).digest('hex'),
        },
        browsers: evidence,
        requests,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log('Cache URL keys agree across Window and worker resource aliases.');
