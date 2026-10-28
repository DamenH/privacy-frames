import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const requests: { origin: string; path: string }[] = [];
let origin = '',
  receiverOrigin = '';
const nonce = 'inert-platform';
const worker = `const log=[];addEventListener('install',e=>e.waitUntil(skipWaiting()));addEventListener('activate',e=>e.waitUntil(clients.claim()));addEventListener('fetch',e=>{const url=new URL(e.request.url);log.push({url:e.request.url,clientId:e.clientId,destination:e.request.destination});e.respondWith(fetch(e.request))});addEventListener('message',e=>e.ports[0].postMessage({sourceId:e.source?.id,log}));`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', origin || 'http://local');
  requests.push({ origin: 'parent', path: url.pathname + url.search });
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(worker);
    return;
  }
  if (url.pathname.startsWith('/resource-script')) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      url.pathname.includes('control')
        ? 'globalThis.activeControlRan=true'
        : 'globalThis.inertScriptExecuted=true',
    );
    return;
  }
  if (url.pathname.startsWith('/resource')) {
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    return;
  }
  const strict = url.pathname.includes('strict');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'self' 'nonce-${nonce}';img-src 'self'${strict ? '' : ' ' + receiverOrigin};frame-src ${strict ? "'none'" : receiverOrigin + " 'self'"};connect-src 'self' ${strict ? '' : receiverOrigin};style-src 'unsafe-inline' ${strict ? '' : receiverOrigin}`,
  );
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Inert platform</title><body>');
});
const receiver = http.createServer((request, response) => {
  requests.push({ origin: 'receiver', path: request.url || '/' });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url?.includes('script')) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end('globalThis.inertScriptExecuted=true');
    return;
  }
  if (request.url?.includes('css')) {
    response.setHeader('Content-Type', 'text/css');
    response.end('body{color:red}');
    return;
  }
  response.setHeader('Content-Type', 'image/svg+xml');
  response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
});
for (const current of [server, receiver])
  await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', resolve));
const a = server.address(),
  b = receiver.address();
if (!a || typeof a === 'string' || !b || typeof b === 'string')
  throw new Error('Missing probe address');
origin = 'http://127.0.0.1:' + a.port;
receiverOrigin = 'http://127.0.0.1:' + b.port;
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const strict of [false, true])
        for (const kind of [
          'created',
          'created-meta',
          'parser-html',
          'parser-html-meta',
          'parser-svg',
          'template',
        ]) {
          const context = await browser.newContext(),
            page = await context.newPage();
          await page.goto(origin + (strict ? '/strict' : '/permissive'));
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
            async ({ kind, origin, receiverOrigin, nonce }) => {
              const control = new Image();
              control.src = receiverOrigin + '/control-image';
              document.body.append(control);
              const nativeDocument = document;
              const controlScript = document.createElement('script');
              controlScript.src = origin + '/resource-script-control';
              await new Promise<void>((resolve, reject) => {
                controlScript.onload = () => resolve();
                controlScript.onerror = () =>
                  reject(new Error('Active script control failed'));
                document.body.append(controlScript);
              });

              const markup =
                '<img src="' +
                receiverOrigin +
                '/inert-image"><img src="' +
                origin +
                '/resource-inert"><iframe src="' +
                receiverOrigin +
                '/inert-frame"></iframe><script src="' +
                receiverOrigin +
                '/inert-script"></script><link rel="stylesheet" href="' +
                receiverOrigin +
                '/inert-css"><style>body{background:url(' +
                receiverOrigin +
                '/inert-style)}</style>';
              let inert: Document;
              let fragment: DocumentFragment | undefined;
              if (kind === 'parser-svg')
                inert = new DOMParser().parseFromString(
                  '<svg xmlns="http://www.w3.org/2000/svg"><image href="' +
                    receiverOrigin +
                    '/inert-svg-image"/><script href="' +
                    receiverOrigin +
                    '/inert-svg-script"/></svg>',
                  'image/svg+xml',
                );
              else if (kind.startsWith('parser-html'))
                inert = new DOMParser().parseFromString(
                  (kind.endsWith('meta')
                    ? '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;;base-uri *">'
                    : '') + markup,
                  'text/html',
                );
              else if (kind === 'template') {
                const template = document.createElement('template');
                template.innerHTML = markup;
                fragment = template.content;
                inert = fragment.ownerDocument;
                document.body.append(template);
              } else {
                inert = document.implementation.createHTMLDocument('');
                if (kind.endsWith('meta')) {
                  const meta = inert.createElement('meta');
                  meta.httpEquiv = 'Content-Security-Policy';
                  meta.content = "default-src 'none';base-uri *";
                  inert.head.append(meta);
                }
                inert.body.innerHTML = markup;
              }
              const before = {
                url: inert.URL,
                baseURI: inert.baseURI,
                defaultViewNull: inert.defaultView === null,
                ownerDifferent: inert !== document,
                htmlDocument: inert instanceof HTMLDocument,
                namespace: inert.documentElement?.namespaceURI,
              };
              let forms: number | null = null,
                base: string | null = null;
              if (kind.startsWith('created')) {
                const formsDocument = document.implementation.createHTMLDocument('');
                formsDocument.body.innerHTML = '<form></form><form></form>';
                forms = formsDocument.body.childNodes.length;
                const element = inert.createElement('base');
                element.href = origin + '/document-base/';
                inert.head.append(element);
                base = inert.baseURI;
                const image = inert.createElement('img');
                image.src = 'relative-image';
                inert.body.append(image);
              }
              const dynamicScript = inert.createElementNS(
                kind === 'parser-svg'
                  ? 'http://www.w3.org/2000/svg'
                  : 'http://www.w3.org/1999/xhtml',
                'script',
              );
              dynamicScript.setAttribute(
                kind === 'parser-svg' ? 'href' : 'src',
                origin + '/resource-script-inert',
              );
              const target = fragment || inert.body || inert.documentElement;
              target.append(dynamicScript);
              const inertFrame = (fragment || inert).querySelector('iframe');
              const inertWindowUnavailable =
                !inertFrame || inertFrame.contentWindow === null;
              const explicitActions: string[] = [];
              if (kind !== 'parser-svg') {
                const form = inert.createElement('form');
                form.action = receiverOrigin + '/inert-form-action';
                target.append(form);
                try {
                  form.submit();
                  explicitActions.push('form-returned');
                } catch (error) {
                  explicitActions.push('form:' + String(error));
                }
                const link = inert.createElement('a');
                link.href = receiverOrigin + '/inert-link-action';
                link.target = '_blank';
                target.append(link);
                link.click();
                explicitActions.push('link-returned');
              }
              await new Promise((resolve) => setTimeout(resolve, 300));
              const channel = new MessageChannel();
              const workerLog = await new Promise((resolve) => {
                channel.port1.onmessage = (event) => resolve(event.data);
                navigator.serviceWorker.controller!.postMessage('snapshot', [
                  channel.port2,
                ]);
              });
              const executedBefore = !!Reflect.get(globalThis, 'inertScriptExecuted');
              await fetch(origin + '/phase-before-adoption');
              const destination = document.createElement('section');
              document.body.append(destination);
              if (kind === 'parser-svg') destination.append(inert.documentElement);
              else destination.append(...Array.from((fragment || inert.body).childNodes));
              await new Promise((resolve) => setTimeout(resolve, 200));
              const finalChannel = new MessageChannel();
              const afterAdoption = await new Promise((resolve) => {
                finalChannel.port1.onmessage = (event) => resolve(event.data);
                navigator.serviceWorker.controller!.postMessage('snapshot', [
                  finalChannel.port2,
                ]);
              });
              return {
                kind,
                activeControlRan: !!Reflect.get(globalThis, 'activeControlRan'),
                inertWindowUnavailable,
                explicitActions,
                executedBefore,
                afterAdoption,

                before,
                forms,
                base,
                executed: !!Reflect.get(globalThis, 'inertScriptExecuted'),
                templateOwner: fragment
                  ? {
                      url: fragment.ownerDocument.URL,
                      defaultViewNull: fragment.ownerDocument.defaultView === null,
                    }
                  : null,
                mainDocumentUnchanged: document === nativeDocument,
                workerLog,
              };
            },
            { kind, origin, receiverOrigin, nonce },
          );
          assert.equal(
            context.pages().length,
            1,
            'Inert action created a top-level page',
          );
          const traffic = requests.slice(start);
          const boundary = traffic.findIndex(
            (record) => record.path === '/phase-before-adoption',
          );
          const beforeAdoption = traffic.slice(0, boundary);
          const afterAdoption = traffic.slice(boundary + 1);
          assert.equal(value.executedBefore, false);
          assert.equal(value.activeControlRan, true);
          assert(value.inertWindowUnavailable);
          assert(
            !beforeAdoption.some(
              (record) =>
                record.path.includes('inert-') || record.path.includes('relative-image'),
            ),
          );
          if (!strict)
            assert(
              traffic.some((r) => r.path === '/control-image'),
              'Working receiver control missing',
            );
          results.push({
            browser: name,
            version: browser.version(),
            strict,
            ...value,
            traffic,
            beforeAdoption,
            afterAdoptionTraffic: afterAdoption,
          });
          console.log(
            name,
            strict,
            kind,
            JSON.stringify({
              inert: traffic.filter((x) => x.path !== '/control-image'),
              before: value.before,
              forms: value.forms,
              base: value.base,
            }),
          );
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
  'results/contexts/inert-document-platform.json',
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
