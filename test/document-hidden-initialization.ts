import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const origin = 'http://127.0.0.1:4332';
const nonce = 'hidden-initialization';
const policy = `sandbox allow-scripts allow-same-origin allow-forms;default-src 'none';script-src 'self' 'nonce-${nonce}' 'unsafe-eval';connect-src 'self';style-src 'unsafe-inline';frame-src 'self';worker-src 'self'`;
const built = await build({
  stdin: {
    contents: `import {prepareWindowRealm} from './src/runtime/contexts/window-realm.ts';prepareWindowRealm({application:'hidden-app',applicationURL:${JSON.stringify(origin + '/child')},scriptNonce:${JSON.stringify(nonce)}});Object.defineProperty(window,'__hiddenPrepared',{value:true});parent.postMessage({kind:'host-ready',token:${JSON.stringify(nonce)},prepared:!!window.__hiddenPrepared},${JSON.stringify(origin)});`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  banner: { js: '"use strict";' },
  target: 'es2022',
});
const preparation = built.outputFiles[0].text;
const publisher = `parent.postMessage({kind:'publisher-ready',token:${JSON.stringify(nonce)},prepared:!!window.__hiddenPrepared},${JSON.stringify(origin)})`;
const html = `<!doctype html><script src="/prepare.js"></script><script nonce="${nonce}">${publisher}</script><body><p id="html">Prepared HTML</p>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><script href="/prepare.js"/><script nonce="${nonce}"><![CDATA[${publisher}]]></script><rect id="shape" width="40" height="30"/></svg>`;
const sw = `self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname==='/child'){e.respondWith(new Promise(resolve=>setTimeout(()=>resolve(new Response(u.searchParams.get('kind')==='svg'?${JSON.stringify(svg)}:${JSON.stringify(html)},{headers:{'Content-Type':u.searchParams.get('kind')==='svg'?'image/svg+xml':'text/html','Content-Security-Policy':${JSON.stringify(policy)},'Origin-Agent-Cluster':'?1','Cross-Origin-Opener-Policy':'same-origin'}})),100)));return}e.respondWith(fetch(e.request))});`;
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('Origin-Agent-Cluster', '?1');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(sw);
    return;
  }
  if (request.url === '/prepare.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(preparation);
    return;
  }
  response.end(
    '<!doctype html><title>Hidden initialization</title><body><main id="public"></main>',
  );
});
await new Promise<void>((resolve) => server.listen(4332, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const kind of ['html', 'svg']) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
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
        const value = await page.evaluate(
          async ({ kind, nonce, origin }) => {
            const frame = document.createElement('iframe');
            frame.name = 'hiddenPlatformChild';
            frame.style.cssText = 'width:100px;height:80px';
            frame.src = origin + '/child?kind=' + kind;
            const host = document.createElement('div');
            document.body.append(host);
            const root = host.attachShadow({ mode: 'closed' });
            const destination = document.querySelector('#public')!;
            const windowGetter = Object.getOwnPropertyDescriptor(
              HTMLIFrameElement.prototype,
              'contentWindow',
            )!.get!;
            const documentGetter = Object.getOwnPropertyDescriptor(
              HTMLIFrameElement.prototype,
              'contentDocument',
            )!.get!;
            const svgGetter = HTMLIFrameElement.prototype.getSVGDocument;
            const move = Element.prototype.moveBefore;
            const moveToRoot = DocumentFragment.prototype.moveBefore;
            const swGetter = Object.getOwnPropertyDescriptor(
              Navigator.prototype,
              'serviceWorker',
            )!.get!;
            let ready = false;
            let round = 0;
            Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
              configurable: true,
              get() {
                return this === frame && !ready
                  ? null
                  : Reflect.apply(windowGetter, this, []);
              },
            });
            Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
              configurable: true,
              get() {
                return this === frame && !ready
                  ? null
                  : Reflect.apply(documentGetter, this, []);
              },
            });
            HTMLIFrameElement.prototype.getSVGDocument = function () {
              return this === frame && !ready ? null : Reflect.apply(svgGetter, this, []);
            };
            const events: unknown[] = [];
            const observations: unknown[] = [];
            let resolveReady: (() => void) | undefined;
            let readyArray: unknown;
            let readyDocument: unknown;
            let previousRoundArray: unknown;
            let previousRoundDocument: unknown;
            const sample = (phase: string) => {
              observations.push({
                phase,
                ready,
                frames: window.frames.length,
                indexedVisible: !!window.frames[0],
                namedVisible: !!Reflect.get(window, 'hiddenPlatformChild'),
                framesNamedVisible: !!Reflect.get(window.frames, 'hiddenPlatformChild'),
                publicWindow: !!frame.contentWindow,
                publicDocument: !!frame.contentDocument,
                publicSVG: !!frame.getSVGDocument(),
                rootKnown: frame.getRootNode() === root,
                parentIsRoot: frame.parentNode === root,
                rootQueryWindow: !!root.querySelector('iframe')?.contentWindow,
                rootHostWindow: root.host.ownerDocument.defaultView === window,
              });
            };
            window.addEventListener(
              'message',
              (event) => {
                if (
                  event.origin !== origin ||
                  event.source !== Reflect.apply(windowGetter, frame, []) ||
                  event.data?.token !== nonce
                )
                  return;
                const source = event.source;
                const prepared = !!Reflect.get(source, '__hiddenPrepared');
                events.push({
                  listener: 'trusted-capture',
                  kind: event.data.kind,
                  round,
                  prepared,
                  readyBefore: ready,
                  framesBefore: window.frames.length,
                });
                if (event.data.kind === 'host-ready') {
                  ready = true;
                  readyArray = Reflect.get(source, 'Array');
                  readyDocument = Reflect.apply(documentGetter, frame, []);
                  Reflect.apply(move, destination, [frame, null]);
                  resolveReady?.();
                }
              },
              true,
            );
            window.addEventListener('message', (event) => {
              if (event.data?.token !== nonce) return;
              events.push({
                listener: 'publisher',
                kind: event.data.kind,
                round,
                prepared: !!Reflect.get(event.source!, '__hiddenPrepared'),
                ready,
                sourceExposed: true,
                frames: window.frames.length,
              });
            });
            frame.addEventListener('load', () =>
              events.push({
                listener: 'frame-load',
                round,
                ready,
                prepared: frame.contentWindow
                  ? !!Reflect.get(frame.contentWindow, '__hiddenPrepared')
                  : null,
              }),
            );
            const states: unknown[] = [];
            const state = (phase: string) => {
              const child = frame.contentWindow!;
              const doc = frame.contentDocument!;
              const shape = doc.querySelector('#shape');
              const rect = shape?.getBoundingClientRect();
              states.push({
                phase,
                round,
                parentIsDestination: frame.parentNode === destination,
                rootIsDocument: frame.getRootNode() === document,
                connected: frame.isConnected,
                frameElementMatches: child.frameElement === frame,
                parentWindowMatches: child.parent === window,
                arrayRecreated: round === 0 ? null : child.Array !== previousRoundArray,
                documentRecreated: round === 0 ? null : doc !== previousRoundDocument,
                ready,
                prepared: !!Reflect.get(child, '__hiddenPrepared'),
                arrayRetained: child.Array === readyArray,
                documentRetained: doc === readyDocument,
                controller: !!Reflect.apply(swGetter, child.navigator, []).controller,
                entries: Reflect.get(child, 'navigation').entries().length,
                frames: window.frames.length,
                namedVisible: Reflect.get(window, 'hiddenPlatformChild') === child,
                contentType: doc.contentType,
                svgDocument: kind === 'svg' ? frame.getSVGDocument() === doc : null,
                svgWidth: rect?.width,
                svgHeight: rect?.height,
              });
            };
            for (round = 0; round < 2; round++) {
              ready = false;
              const promised = new Promise<void>((resolve, reject) => {
                resolveReady = resolve;
                setTimeout(
                  () => reject(new Error('Hidden child did not signal readiness')),
                  4000,
                );
              });
              root.append(frame);
              sample('pending-synchronous-' + round);
              await Promise.resolve();
              sample('pending-microtask-' + round);
              await new Promise((resolve) => setTimeout(resolve, 20));
              sample('pending-task-' + round);
              await promised;
              await new Promise((resolve) => setTimeout(resolve, 80));
              state('public-ready');
              Reflect.apply(moveToRoot, root, [frame, null]);
              state('moved-private');
              Reflect.apply(move, destination, [frame, null]);
              state('moved-public');
              if (round === 0) {
                previousRoundArray = frame.contentWindow!.Array;
                previousRoundDocument = frame.contentDocument;
                ready = false;
                frame.remove();
                sample('removed');
              }
            }
            return { kind, observations, events, states, errors: [] };
          },
          { kind, nonce, origin },
        );
        results.push({ browser: name, version: browser.version(), ...value, errors });
        console.log(name, kind, JSON.stringify(value));
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
await mkdir('results/contexts', { recursive: true });
await writeFile(
  'results/contexts/document-hidden-initialization.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      runnerSha256: createHash('sha256')
        .update(await readFile(new URL(import.meta.url)))
        .digest('hex'),
      preparationSha256: createHash('sha256').update(preparation).digest('hex'),
      results,
    },
    null,
    2,
  ) + '\n',
);
function field(value: unknown, key: string): unknown {
  assert(value !== null && typeof value === 'object');
  return Reflect.get(value, key);
}
for (const result of results) {
  assert.equal(result.errors.length, 0);
  for (const observation of result.observations) {
    assert.equal(field(observation, 'ready'), false);
    for (const key of [
      'indexedVisible',
      'namedVisible',
      'framesNamedVisible',
      'publicWindow',
      'publicDocument',
      'publicSVG',
      'rootQueryWindow',
    ])
      assert.equal(field(observation, key), false);
  }
  for (const state of result.states) {
    for (const key of [
      'prepared',
      'arrayRetained',
      'documentRetained',
      'controller',
      'connected',
      'frameElementMatches',
      'parentWindowMatches',
    ])
      assert.equal(field(state, key), true);
    assert.equal(field(state, 'entries'), 1);
    if (field(state, 'round') === 1) {
      assert.equal(field(state, 'arrayRecreated'), true);
      assert.equal(field(state, 'documentRecreated'), true);
    }
    if (result.kind === 'svg') {
      assert.equal(field(state, 'contentType'), 'image/svg+xml');
      assert.equal(field(state, 'svgDocument'), true);
      assert.equal(field(state, 'svgWidth'), 40);
      assert.equal(field(state, 'svgHeight'), 30);
    }
  }
  for (const event of result.events)
    if (field(event, 'listener') === 'publisher')
      assert.equal(field(event, 'prepared'), true);
}
