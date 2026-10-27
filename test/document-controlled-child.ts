import http from 'node:http';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const origin = 'http://127.0.0.1:4332';
const nonce = 'controlled-child';
const csp = `default-src 'none';script-src 'self' 'nonce-${nonce}';frame-src 'self' about:;connect-src 'self';worker-src 'self'`;
const childHTML = `<!doctype html><script src="/delay.js"></script><script nonce="${nonce}">window.__parserObservation={policy:!!EventTarget.prototype.__controlledPolicy,controller:!!navigator.serviceWorker.controller,entries:navigation.entries().length};</script><body>Child`;
const sw = `self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname==='/child'){e.respondWith(new Response(${JSON.stringify(childHTML)},{headers:{'Content-Type':'text/html','Content-Security-Policy':${JSON.stringify(csp)}}}));return}if(u.pathname==='/resource'){e.respondWith(new Response(JSON.stringify({controlled:true,clientId:e.clientId}),{headers:{'Content-Type':'application/json'}}));return}e.respondWith(fetch(e.request))})`;
const requests: string[] = [];
const server = http.createServer((request, response) => {
  const path = request.url || '/';
  requests.push(path);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', csp);
  if (path === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(sw);
    return;
  }
  if (path === '/delay.js') {
    response.setHeader('Content-Type', 'text/javascript');
    setTimeout(() => response.end('window.__parserDelayEnded=true'), 40);
    return;
  }
  if (path === '/resource') {
    response.setHeader('Content-Type', 'application/json');
    response.end('{"controlled":false}');
    return;
  }
  response.end('<!doctype html><title>Controlled child</title><body>');
});
await new Promise<void>((resolve) => server.listen(4332, '127.0.0.1', resolve));
await mkdir('results/contexts', { recursive: true });
const partial = 'results/contexts/document-controlled-child-trials.jsonl';
await writeFile(partial, '');
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const batch of [false, true])
        for (
          let iteration = 0;
          iteration < (batch ? 1 : name === 'firefox' ? 40 : 8);
          iteration++
        ) {
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(origin + '/parent');
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
          const start = requests.length;
          const value = await page.evaluate(
            async ({ batch, iteration, nonce, origin }) => {
              localStorage.setItem('other-app-private-key', 'private-value');
              Reflect.set(window, '__navEvents', []);
              Reflect.set(window, '__batchObservation', null);
              const frame = document.createElement('iframe');
              frame.src = origin + '/child';
              let preparations = 0;
              const prepare = () => {
                const current = frame.contentWindow;
                if (
                  !current ||
                  Reflect.get(current.EventTarget.prototype, '__controlledPolicy')
                )
                  return;
                const s = current.document.createElement('script');
                s.nonce = nonce;
                s.textContent = `Object.defineProperty(EventTarget.prototype,'__controlledPolicy',{value:true});Object.defineProperty(window,'localStorage',{value:Object.freeze({getItem(){return null}})});navigation.addEventListener('navigate',e=>{parent.__navEvents.push({url:e.destination.url,cancelable:e.cancelable,hashChange:e.hashChange});e.preventDefault()},{capture:true})`;
                current.document.head.append(s);
                preparations++;
              };
              document.addEventListener(
                'load',
                (event) => {
                  if (event.target === frame) prepare();
                },
                true,
              );
              frame.addEventListener('load', prepare, true);
              const loaded = new Promise<void>((resolve) => {
                frame.addEventListener('load', () => resolve(), { once: true });
                setTimeout(resolve, 2000);
              });
              if (batch) {
                const publisher = document.createElement('script');
                publisher.nonce = nonce;
                publisher.textContent =
                  "window.__batchObservation={policy:!!frames[0].EventTarget.prototype.__controlledPolicy,privateStorageReadable:frames[0].localStorage.getItem('other-app-private-key')==='private-value'}";
                const fragment = document.createDocumentFragment();
                fragment.append(frame, publisher);
                document.body.append(fragment);
              } else {
                document.body.append(frame);
              }
              prepare();
              const initialArray = frame.contentWindow!.Array;
              const observations: {
                policy: boolean;
                array: boolean;
                privateStorageReadable: boolean;
              }[] = [];
              const timer = setInterval(() => {
                try {
                  const child = frame.contentWindow!;
                  observations.push({
                    policy: !!Reflect.get(
                      child.EventTarget.prototype,
                      '__controlledPolicy',
                    ),
                    array: child.Array === initialArray,
                    privateStorageReadable:
                      child.localStorage.getItem('other-app-private-key') ===
                      'private-value',
                  });
                } catch {}
              }, 0);
              await loaded;
              clearInterval(timer);
              const child = frame.contentWindow!;
              const beforeAttack = {
                arrayRetained: child.Array === initialArray,
                policy: !!Reflect.get(child.EventTarget.prototype, '__controlledPolicy'),
                parser: Reflect.get(child, '__parserObservation'),
                controller: !!child.navigator.serviceWorker.controller,
                entries: Reflect.get(child, 'navigation').entries().length,
              };
              const resource = await child
                .fetch(origin + '/resource')
                .then((r) => r.json());
              const route = ['blank', 'location', 'link', 'form'][iteration % 4];
              const s = child.document.createElement('script');
              s.nonce = nonce;
              const target = origin + '/receiver-' + route;
              s.textContent =
                route === 'blank'
                  ? "location.href='about:blank'"
                  : route === 'location'
                    ? `location.href=${JSON.stringify(target)}`
                    : route === 'link'
                      ? `const a=document.createElement('a');a.href=${JSON.stringify(target)};document.body.append(a);a.click()`
                      : `const f=document.createElement('form');f.action=${JSON.stringify(target)};document.body.append(f);f.submit()`;
              child.document.head.append(s);
              await new Promise((resolve) => setTimeout(resolve, 40));
              return {
                batch,
                iteration,
                preparations,
                batchObservation: Reflect.get(window, '__batchObservation'),
                observations,
                exposedUnprepared: observations.some(
                  (x) => !x.policy || !x.array || x.privateStorageReadable,
                ),
                beforeAttack,
                resource,
                route,
                events: Reflect.get(window, '__navEvents'),
                afterAttack: {
                  arrayRetained: frame.contentWindow!.Array === initialArray,
                  policy: !!Reflect.get(
                    frame.contentWindow!.EventTarget.prototype,
                    '__controlledPolicy',
                  ),
                  href: frame.contentWindow!.location.href,
                },
              };
            },
            { batch, iteration, nonce, origin },
          );
          const result = {
            browser: name,
            version: browser.version(),
            ...value,
            requests: requests.slice(start),
          };
          results.push(result);
          await appendFile(partial, JSON.stringify(result) + '\n');
          assert.equal(value.resource.controlled, true);
          assert.equal(value.beforeAttack.controller, true);
          assert.equal(value.beforeAttack.arrayRetained, true);
          assert.equal(value.afterAttack.arrayRetained, true);
          assert.equal(value.events.length, 1);
          assert(!result.requests.some((path) => path.startsWith('/receiver')));
          if (batch) {
            assert.deepEqual(value.batchObservation, {
              policy: false,
              privateStorageReadable: true,
            });
          } else {
            assert.equal(value.exposedUnprepared, false);
          }
          console.log(
            name,
            batch,
            iteration,
            JSON.stringify({
              exposed: value.exposedUnprepared,
              batch: value.batchObservation,
              before: value.beforeAttack,
              events: value.events,
              after: value.afterAttack,
              resource: value.resource,
            }),
          );
          await context.close();
        }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await writeFile(
  'results/contexts/document-controlled-child.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      runnerSha256: createHash('sha256')
        .update(await readFile(new URL(import.meta.url)))
        .digest('hex'),
      results,
    },
    null,
    2,
  ) + '\n',
);
