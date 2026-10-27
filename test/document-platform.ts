import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const nonce = 'document-platform-bootstrap';
const origin = 'http://127.0.0.1:4332';
const receiverOrigin = 'http://127.0.0.1:4333';
const policy = `default-src 'self' ${receiverOrigin} blob: data:;script-src 'self' blob: 'nonce-${nonce}';connect-src 'self' ${receiverOrigin} blob: data:;img-src 'self' ${receiverOrigin} blob: data:;style-src 'self' blob: 'unsafe-inline';frame-src 'self' blob: data:`;
const headers = { 'Content-Type': 'text/html', 'Content-Security-Policy': policy };
const childHTML =
  '<!doctype html><title>Controlled child</title><script src="/guard-delay.js"></script><script nonce="' +
  nonce +
  '">window.__publisherObservation={ready:!!window.__preparedRealm,arrayRetained:Array===parent.__initialChildArray,policyRetained:!!EventTarget.prototype.__policyMarker,controller:!!navigator.serviceWorker.controller};</script><p>Controlled child</p>';
const service = `
const observations=[];
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>e.waitUntil((async()=>{
  if(e.data.action==='claim')await self.clients.claim();
  const source=e.source&&e.source.id?await self.clients.get(e.source.id):null;
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  e.ports[0].postMessage({sourceId:e.source?.id,sourceURL:source?.url,clients:clients.map(c=>({id:c.id,url:c.url,frameType:c.frameType})),observations});
})()));
self.addEventListener('fetch',e=>e.respondWith((async()=>{
 const c=e.clientId?await self.clients.get(e.clientId):null;
 const url=new URL(e.request.url);
 observations.push({path:url.pathname,clientId:e.clientId,resultingClientId:e.resultingClientId,replacesClientId:e.replacesClientId,clientURL:c?.url,destination:e.request.destination});
 if(url.pathname==='/child-resource')return new Response(JSON.stringify({controlled:true,clientId:e.clientId,clientURL:c?.url}),{headers:{'Content-Type':'application/json'}});
 if(url.pathname==='/controlled-child')return new Response(${JSON.stringify(childHTML)},{headers:${JSON.stringify(headers)}});
 if(url.pathname==='/guard-delay.js'){await new Promise(r=>setTimeout(r,150));return new Response('window.__httpBootstrapExecuted=true;if(!window.__preparedRealm)Object.defineProperty(window,"__preparedRealm",{value:"http-bootstrap"});',{headers:{'Content-Type':'text/javascript'}})}
 return fetch(e.request);
})()));`;
const httpRequests: { port: number; path: string }[] = [];
const server = http.createServer((request, response) => {
  httpRequests.push({ port: 4332, path: request.url || '/' });
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(service);
    return;
  }
  if (request.url?.startsWith('/child-resource')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ controlled: false }));
    return;
  }
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end('<!doctype html><title>Document platform</title><main></main>');
});
const receiver = http.createServer((request, response) => {
  httpRequests.push({ port: 4333, path: request.url || '/' });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Content-Type',
    request.url?.includes('image') ? 'image/svg+xml' : 'text/plain',
  );
  response.end(
    request.url?.includes('image')
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      : 'receiver control',
  );
});
await Promise.all(
  [server, receiver].map(
    (server, index) =>
      new Promise<void>((resolve) => server.listen(4332 + index, '127.0.0.1', resolve)),
  ),
);
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const kind of [
        'blank-claim',
        'open-claim',
        'open-history-claim',
        'first-http-navigation',
        'http-after-open',
        'blob-graph',
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
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
        const trafficStart = httpRequests.length;
        const value = await page.evaluate(
          async ({ kind, nonce, origin, receiverOrigin }) => {
            const frame = document.createElement('iframe');
            document.body.append(frame);
            const child = frame.contentWindow!;
            const initialDocument = child.document;
            const initialArray = child.Array;
            Reflect.set(window, '__initialChildArray', initialArray);
            const script = child.document.createElement('script');
            script.nonce = nonce;
            script.textContent =
              'Object.defineProperty(window,"__preparedRealm",{value:"initial-bootstrap"});Object.defineProperty(EventTarget.prototype,"__policyMarker",{value:true});';
            child.document.head.append(script);
            const initial = {
              href: child.location.href,
              controller: !!child.navigator.serviceWorker.controller,
              ready: !!Reflect.get(child, '__preparedRealm'),
            };
            const snapshot = (action = 'snapshot') =>
              new Promise((resolve) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (e) => {
                  channel.port1.close();
                  resolve(e.data);
                };
                navigator.serviceWorker.controller!.postMessage({ action }, [
                  channel.port2,
                ]);
              });
            const beforeClients = await snapshot();
            let historyError: string | null = null;
            if (
              kind === 'open-claim' ||
              kind === 'open-history-claim' ||
              kind === 'http-after-open'
            ) {
              child.document.open();
              child.document.write('<!doctype html><title>In-place child</title><body>');
              child.document.close();
            }
            if (kind === 'open-history-claim') {
              try {
                child.history.replaceState(null, '', '/app/synthetic-child');
              } catch (error) {
                historyError = String(error);
              }
            }
            const retainedBeforeNavigation = {
              array: child.Array === initialArray,
              document: child.document === initialDocument,
              ready: !!Reflect.get(child, '__preparedRealm'),
              href: child.location.href,
            };
            const probeChild = () =>
              new Promise((resolve) => {
                const token = 'probe-' + Math.random();
                const timeout = setTimeout(() => resolve({ timedOut: true }), 3500);
                const listen = (event: MessageEvent) => {
                  if (
                    event.source === frame.contentWindow &&
                    event.data?.token === token
                  ) {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listen);
                    resolve(event.data.value);
                  }
                };
                window.addEventListener('message', listen);
                const node = child.document.createElement('script');
                node.nonce = nonce;
                node.textContent = `(async()=>{const value={controllerBefore:!!navigator.serviceWorker.controller};try{value.resourceBefore=await(await fetch(${JSON.stringify(origin + '/child-resource')})).json();const r=await navigator.serviceWorker.getRegistration(${JSON.stringify(origin + '/')});if(r?.active){value.claim=await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);r.active.postMessage({action:'claim'},[c.port2])});await new Promise(r=>setTimeout(r,30))}value.controllerAfter=!!navigator.serviceWorker.controller;value.resourceAfter=await(await fetch(${JSON.stringify(origin + '/child-resource')})).json()}catch(error){value.error=String(error)}parent.postMessage({token:${JSON.stringify(token)},value},'*')})()`;
                child.document.head.append(node);
              });
            if (kind === 'first-http-navigation' || kind === 'http-after-open') {
              const observations: {
                ready: boolean;
                arrayRetained: boolean;
                policyRetained: boolean;
              }[] = [];
              const interval = setInterval(() => {
                try {
                  observations.push({
                    ready: !!Reflect.get(frame.contentWindow!, '__preparedRealm'),
                    arrayRetained: frame.contentWindow!.Array === initialArray,
                    policyRetained: !!Reflect.get(
                      frame.contentWindow!.EventTarget.prototype,
                      '__policyMarker',
                    ),
                  });
                } catch {}
              }, 0);
              const loaded = new Promise<void>((resolve) =>
                frame.addEventListener('load', () => resolve(), { once: true }),
              );
              frame.src = '/controlled-child';
              await loaded;
              clearInterval(interval);
              return {
                kind,
                initial,
                beforeClients,
                retainedBeforeNavigation,
                after: {
                  href: frame.contentWindow!.location.href,
                  arrayRetained: frame.contentWindow!.Array === initialArray,
                  documentRetained: frame.contentDocument === initialDocument,
                  policyRetained: !!Reflect.get(
                    frame.contentWindow!.EventTarget.prototype,
                    '__policyMarker',
                  ),
                  publisher: Reflect.get(frame.contentWindow!, '__publisherObservation'),
                },
                observations,
                exposedUnprepared: observations.some(
                  (x) => !x.ready || !x.policyRetained,
                ),
                afterClients: await snapshot(),
              };
            }
            if (kind === 'blob-graph') {
              const control = await new Promise((resolve) => {
                const node = child.document.createElement('script');
                node.nonce = nonce;
                node.textContent = `fetch(${JSON.stringify(receiverOrigin + '/unrestricted-control')}).then(r=>r.text()).then(value=>parent.postMessage({blobControl:value},'*'))`;
                const listen = (event: MessageEvent) => {
                  if (event.source === child && event.data?.blobControl) {
                    window.removeEventListener('message', listen);
                    resolve(event.data.blobControl);
                  }
                };
                window.addEventListener('message', listen);
                child.document.head.append(node);
              });
              const strict = child.document.createElement('meta');
              strict.httpEquiv = 'Content-Security-Policy';
              strict.content = `default-src 'none';script-src blob: 'nonce-${nonce}';connect-src blob: data:;img-src blob: data:;style-src blob: 'unsafe-inline';frame-src 'none';object-src 'none';form-action 'none'`;
              child.document.head.append(strict);
              const dependency = URL.createObjectURL(
                new Blob(['export const value="local module graph"'], {
                  type: 'text/javascript',
                }),
              );
              const main = URL.createObjectURL(
                new Blob(
                  [
                    `import {value} from ${JSON.stringify(dependency)};globalThis.__moduleValue=value;`,
                  ],
                  { type: 'text/javascript' },
                ),
              );
              const css = URL.createObjectURL(
                new Blob(['body{--local-style:ready;color:rgb(19,37,73)}'], {
                  type: 'text/css',
                }),
              );
              const data = URL.createObjectURL(
                new Blob(['local blob fetch'], { type: 'text/plain' }),
              );
              const blobValue = await new Promise((resolve) => {
                const node = child.document.createElement('script');
                node.nonce = nonce;
                const token = 'blob-' + Math.random();
                const listen = (event: MessageEvent) => {
                  if (event.source === child && event.data?.token === token) {
                    window.removeEventListener('message', listen);
                    resolve(event.data.value);
                  }
                };
                window.addEventListener('message', listen);
                node.textContent = `(async()=>{const result={local:await(await fetch(${JSON.stringify(data)})).text()};try{await fetch(${JSON.stringify(receiverOrigin + '/private-fetch')});result.httpRefused=false}catch{result.httpRefused=true}const image=new Image();image.src=${JSON.stringify(receiverOrigin + '/private-image')};document.body.append(image);document.body.style.backgroundImage='url(${receiverOrigin}/private-css)';parent.postMessage({token:${JSON.stringify(token)},value:result},'*')})()`;
                child.document.head.append(node);
              });
              const module = child.document.createElement('script');
              module.type = 'module';
              module.src = main;
              await new Promise<void>((resolve, reject) => {
                module.onload = () => resolve();
                module.onerror = () => reject(new Error('Blob module refused'));
                child.document.head.append(module);
              });
              const style = child.document.createElement('link');
              style.rel = 'stylesheet';
              style.href = css;
              await new Promise<void>((resolve, reject) => {
                style.onload = () => resolve();
                style.onerror = () => reject(new Error('Blob stylesheet refused'));
                child.document.head.append(style);
              });
              const outcome = {
                kind,
                initial,
                control,
                blobValue,
                moduleValue: Reflect.get(child, '__moduleValue'),
                style: child
                  .getComputedStyle(child.document.body)
                  .getPropertyValue('--local-style'),
                sameOriginDOM:
                  child.document.body.ownerDocument === frame.contentDocument,
                policyRetained: !!Reflect.get(
                  child.EventTarget.prototype,
                  '__policyMarker',
                ),
              };
              for (const url of [dependency, main, css, data]) URL.revokeObjectURL(url);
              await new Promise((r) => setTimeout(r, 50));
              return outcome;
            }
            const parentClaim = await snapshot('claim');
            await new Promise((resolve) => setTimeout(resolve, 30));
            const childProbe = await probeChild();
            return {
              kind,
              initial,
              retainedBeforeNavigation,
              historyError,
              beforeClients,
              parentClaim,
              childProbe,
              afterClients: await snapshot(),
            };
          },
          { kind, nonce, origin, receiverOrigin },
        );
        const traffic = httpRequests.slice(trafficStart);
        assert.equal(value.initial.ready, true);
        if (kind === 'blob-graph') {
          assert.equal(value.control, 'receiver control');
          assert.equal(value.moduleValue, 'local module graph');
          assert.equal(value.style, 'ready');
          assert.equal(value.sameOriginDOM, true);
          assert.equal(value.policyRetained, true);
          assert.deepEqual(value.blobValue, {
            local: 'local blob fetch',
            httpRefused: true,
          });
          assert(traffic.some((r) => r.path === '/unrestricted-control'));
          assert(!traffic.some((r) => r.path.startsWith('/private-')));
        }
        results.push({ name, version: browser.version(), ...value, traffic });
        console.log(name, kind, JSON.stringify(value).slice(0, 250));
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await Promise.all(
    [server, receiver].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
}
await mkdir('results/contexts', { recursive: true });
await writeFile(
  'results/contexts/document-platform-transport.json',
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
