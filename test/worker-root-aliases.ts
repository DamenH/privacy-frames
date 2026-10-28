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
const publisher = http.createServer((request, response) => {
  const path = new URL(request.url || '/', 'http://publisher.test').pathname;
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (path === '/dependency.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end('globalThis.rootDependencyValue=73;');
  } else if (path === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`window.runRootImport=()=>new Promise((resolve,reject)=>{
      const requested=new URL('dependency.js',location.href).href;
      const code='try { importScripts('+JSON.stringify(requested)+'); postMessage({requested:'+JSON.stringify(requested)+',value:globalThis.rootDependencyValue,mode:globalThis.privacyHost?.mode||"native"}); } catch(error) { postMessage({requested:'+JSON.stringify(requested)+',error:String(error)}); }';
      const objectURL=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
      const worker=new Worker(objectURL);
      worker.onmessage=event=>{resolve(event.data);worker.terminate();URL.revokeObjectURL(objectURL)};
      worker.onerror=event=>reject(new Error(event.message));
    });`);
  } else if (path === '/sw.js') response.writeHead(404).end('No publisher worker');
  else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Worker root alias fixture</title><link rel="preload" as="script" href="dependency.js"><script src="app.js"></script>',
    );
  }
  traffic.push(request.url || '/');
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const address = publisher.address();
assert(address && typeof address !== 'string');
const source = `http://127.0.0.1:${address.port}/`;
const evidence = {
  provenance: await testProvenance(import.meta.url),
  results: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const confined of [false, true]) {
        const context = await browser.newContext();
        try {
          let app = await context.newPage();
          if (!confined) await app.goto(source);
          else {
            await app.goto(host);
            await app.getByText('Ready to install.', { exact: true }).waitFor();
            await app.locator('#app-url').fill(source);
            await app.locator('#install button').click();
            await app
              .getByText('Installed Worker root alias fixture.', { exact: true })
              .waitFor({ timeout: 120000 });
            const opened = context.waitForEvent('page');
            await app.getByRole('link', { name: 'Open', exact: true }).click();
            app = await opened;
          }
          await app.waitForFunction(
            () => typeof Reflect.get(window, 'runRootImport') === 'function',
          );
          const before = traffic.length;
          const result = await app.evaluate(() => Reflect.get(window, 'runRootImport')());
          evidence.results.push({
            name,
            version: browser.version(),
            confined,
            result,
            requests: traffic.slice(before),
          });
          assert.equal(result.error, undefined, JSON.stringify(result));
          assert.equal(result.value, 73);
          assert.equal(result.mode, confined ? 'network-isolated' : 'native');
          if (confined) assert.deepEqual(traffic.slice(before), []);
          else assert(traffic.slice(before).includes('/dependency.js'));
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await ownedHost?.close();
  publisher.closeAllConnections();
  await new Promise<void>((resolve) => publisher.close(() => resolve()));
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/worker-root-aliases.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
console.log(
  'Chromium and Firefox: Blob workers import admitted canonical app resources without publisher requests',
);
