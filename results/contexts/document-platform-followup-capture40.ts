import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const origin = 'http://127.0.0.1:4332';
const nonce = 'platform-followup';
const traffic: { port: number; path: string }[] = [];
const server = http.createServer((request, response) => {
  const path = request.url || '/';
  traffic.push({ port: 4332, path });
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Cache-Control', 'no-store');
  if (path.startsWith('/parent')) {
    const frame = path.includes('control')
      ? "'self' http://127.0.0.1:4333"
      : path.includes('none')
        ? "'none'"
        : 'about:';
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none';script-src blob: 'nonce-${nonce}';style-src 'unsafe-inline';img-src blob: data:;frame-src ${frame}`,
    );
  }
  response.end(
    '<!doctype html><title>Child platform follow-up</title><body>Local fixture</body>',
  );
});
const receiver = http.createServer((request, response) => {
  traffic.push({ port: 4333, path: request.url || '/' });
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end('Independent receiver');
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
      for (const mode of ['control', 'frame-policy', 'navigation-api'] as const) {
        for (const route of [
          'location',
          'link',
          'form',
          'external-location',
          'external-link',
          'external-form',
        ] as const) {
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(
            `${origin}/parent-${mode === 'frame-policy' ? 'strict' : 'control'}`,
          );
          const start = traffic.length;
          const observation = await page.evaluate(
            async ({ nonce, mode, route, origin }) => {
              const frame = document.createElement('iframe');
              document.body.append(frame);
              const child = frame.contentWindow!;
              Reflect.set(window, '__navigationEvents', []);
              const bootstrap = child.document.createElement('script');
              bootstrap.nonce = nonce;
              bootstrap.textContent = `if ('navigation' in window) navigation.addEventListener('navigate', event => { parent.__navigationEvents.push({cancelable:event.cancelable,canIntercept:event.canIntercept,url:event.destination.url}); ${mode === 'navigation-api' ? 'event.preventDefault();' : ''} });`;
              child.document.head.append(bootstrap);
              const available = 'navigation' in child;
              const node = child.document.createElement('script');
              node.nonce = nonce;
              const destinationOrigin = route.startsWith('external-')
                ? 'http://127.0.0.1:4333'
                : origin;
              const destination = `${destinationOrigin}/receiver-${mode}-${route}`;
              const action = route.endsWith('location')
                ? `location.href=${JSON.stringify(destination)}`
                : route.endsWith('link')
                  ? `const a=document.createElement('a');a.href=${JSON.stringify(destination)};a.textContent='navigate';document.body.append(a);a.click()`
                  : `const f=document.createElement('form');f.action=${JSON.stringify(destination)};f.method='POST';document.body.append(f);f.submit()`;
              node.textContent = action;
              child.document.head.append(node);
              await new Promise((resolve) => setTimeout(resolve, 250));
              let href: string;
              try {
                href = frame.contentWindow!.location.href;
              } catch {
                href = 'inaccessible';
              }
              return {
                available,
                href,
                events: Reflect.get(window, '__navigationEvents'),
              };
            },
            { nonce, mode, route, origin },
          );
          const requests = traffic.slice(start);
          if (mode === 'control')
            assert(
              requests.some((r) => r.path.startsWith('/receiver-')),
              `${name} ${route} unrestricted control did not arrive`,
            );
          if (mode === 'frame-policy')
            assert.equal(
              requests.length,
              0,
              `${name} ${route} escaped parent frame policy`,
            );
          results.push({
            browser: name,
            version: browser.version(),
            mode,
            route,
            ...observation,
            requests,
          });
          await context.close();
        }
      }
      for (const [afterOpen, framePolicy] of [
        [false, 'about'],
        [true, 'about'],
        [false, 'none'],
        [true, 'none'],
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(
          origin + (framePolicy === 'none' ? '/parent-none' : '/parent-strict'),
        );
        const blank = await page.evaluate(
          async ({ nonce, afterOpen }) => {
            const frame = document.createElement('iframe');
            document.body.append(frame);
            const child = frame.contentWindow!;
            const array = child.Array;
            const initialDocument = child.document;
            if (afterOpen) {
              child.document.open();
              child.document.write('<!doctype html><body>');
              child.document.close();
            }
            const bootstrap = child.document.createElement('script');
            bootstrap.nonce = nonce;
            bootstrap.textContent =
              'Object.defineProperty(EventTarget.prototype,"__realmMarker",{value:true})';
            child.document.head.append(bootstrap);
            const node = child.document.createElement('script');
            node.nonce = nonce;
            node.textContent = "location.href='about:blank'";
            child.document.head.append(node);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return {
              afterOpen,
              href: frame.contentWindow!.location.href,
              arrayRetained: frame.contentWindow!.Array === array,
              documentRetained: frame.contentDocument === initialDocument,
              policyRetained: !!Reflect.get(
                frame.contentWindow!.EventTarget.prototype,
                '__realmMarker',
              ),
            };
          },
          { nonce, afterOpen },
        );
        results.push({
          browser: name,
          version: browser.version(),
          mode: 'blank-renavigation',
          framePolicy,
          ...blank,
        });
        await context.close();
      }
      for (const trustedCapture of [false, true]) {
        for (const attempt of Array.from(
          { length: trustedCapture ? 40 : 2 },
          (_, index) => ({ afterOpen: index % 2 === 1, iteration: index }),
        )) {
          const { afterOpen, iteration } = attempt;
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(origin + '/parent-none');
          const guardedBlank = await page.evaluate(
            async ({ nonce, trustedCapture, afterOpen }) => {
              localStorage.setItem('other-app-private-key', 'private-control-value');
              const frame = document.createElement('iframe');
              let preparations = 0;
              const prepare = () => {
                const current = frame.contentWindow;
                if (
                  !current ||
                  Reflect.get(current.EventTarget.prototype, '__capturedPolicy')
                )
                  return;
                const bootstrap = current.document.createElement('script');
                bootstrap.nonce = nonce;
                bootstrap.textContent =
                  'Object.defineProperty(EventTarget.prototype,"__capturedPolicy",{value:true});Object.defineProperty(window,"localStorage",{value:Object.freeze({getItem(){return null}})})';
                current.document.head.append(bootstrap);
                preparations++;
              };
              if (trustedCapture) {
                document.addEventListener(
                  'load',
                  (event) => {
                    if (event.target === frame) prepare();
                  },
                  true,
                );
                frame.addEventListener('load', prepare, true);
              }
              document.body.append(frame);
              prepare();
              if (afterOpen) {
                frame.contentWindow!.document.open();
                frame.contentWindow!.document.write('<!doctype html><body>');
                frame.contentWindow!.document.close();
              }
              const observations: {
                stage: string;
                direct: boolean;
                indexed: boolean;
                documentView: boolean;
                privateStorageReadable: boolean;
              }[] = [];
              const sample = (stage: string) =>
                observations.push({
                  stage,
                  direct: !!Reflect.get(
                    frame.contentWindow!.EventTarget.prototype,
                    '__capturedPolicy',
                  ),
                  indexed: !!Reflect.get(
                    window.frames[0].EventTarget.prototype,
                    '__capturedPolicy',
                  ),
                  privateStorageReadable:
                    frame.contentWindow!.localStorage.getItem('other-app-private-key') ===
                    'private-control-value',
                  documentView: !!Reflect.get(
                    frame.contentDocument!.defaultView!.EventTarget.prototype,
                    '__capturedPolicy',
                  ),
                });
              frame.addEventListener('load', () => sample('publisher-load'));
              const timer = setInterval(() => sample('parent-task'), 0);
              const script = frame.contentDocument!.createElement('script');
              script.nonce = nonce;
              script.textContent = "location.href='about:blank'";
              frame.contentDocument!.head.append(script);
              sample('synchronous');
              await Promise.resolve();
              sample('microtask');
              await new Promise((resolve) => setTimeout(resolve, 100));
              clearInterval(timer);
              return {
                trustedCapture,
                afterOpen,
                preparations,
                observations,
                exposedUnprepared: observations.some(
                  (value) => !value.direct || !value.indexed || !value.documentView,
                ),
              };
            },
            { nonce, trustedCapture, afterOpen },
          );
          console.log(
            'blank-capture',
            name,
            trustedCapture,
            iteration,
            guardedBlank.exposedUnprepared,
            JSON.stringify(guardedBlank.observations.filter((x) => !x.direct)),
          );
          results.push({
            browser: name,
            version: browser.version(),
            mode: 'blank-load-capture',
            iteration,
            ...guardedBlank,
          });
          await context.close();
        }
      }
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(origin + '/parent-strict');
      const start = traffic.length;
      const graph = await page.evaluate(
        async ({ nonce }) => {
          const frame = document.createElement('iframe');
          document.body.append(frame);
          const child = frame.contentWindow!;
          const base = 'https://publisher.invalid/modules/';
          const aURL = URL.createObjectURL(
            new Blob(
              [
                `import {b} from '${base}b.js';export const a='A';export function combined(){return a+b}`,
              ],
              { type: 'text/javascript' },
            ),
          );
          const bURL = URL.createObjectURL(
            new Blob(
              [
                `import {a} from '${base}a.js';export const b='B';export function cycle(){return a+b}`,
              ],
              { type: 'text/javascript' },
            ),
          );
          const map = child.document.createElement('script');
          map.type = 'importmap';
          map.nonce = nonce;
          map.textContent = JSON.stringify({
            imports: { [base + 'a.js']: aURL, [base + 'b.js']: bURL },
          });
          child.document.head.append(map);
          const entryURL = URL.createObjectURL(
            new Blob(
              [
                `const base=${JSON.stringify(base)};const name='a.js';const a=await import(base+name);const b=await import(base+'b.js');window.__graph={combined:a.combined(),cycle:b.cycle()};`,
              ],
              { type: 'text/javascript' },
            ),
          );
          const entry = child.document.createElement('script');
          entry.type = 'module';
          entry.src = entryURL;
          await new Promise<void>((resolve, reject) => {
            entry.onload = () => resolve();
            entry.onerror = () => reject(new Error('importmap Blob graph failed'));
            child.document.head.append(entry);
          });
          for (let i = 0; i < 200 && !Reflect.get(child, '__graph'); i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          child.document.body.innerHTML =
            '<main><p id="html">Native HTML</p><svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg></main>';
          const svg = child.document.querySelector('svg')!;
          const rect = svg.getBoundingClientRect();
          const value = {
            graph: Reflect.get(child, '__graph'),
            html: child.document.querySelector('#html')?.textContent,
            svgNamespace: svg.namespaceURI,
            svgWidth: rect.width,
            svgHeight: rect.height,
            sameOriginDOM: child.document.body.ownerDocument === frame.contentDocument,
          };
          for (const url of [aURL, bURL, entryURL]) URL.revokeObjectURL(url);
          return value;
        },
        { nonce },
      );
      assert.deepEqual(graph.graph, { combined: 'AB', cycle: 'AB' });
      assert.equal(graph.html, 'Native HTML');
      assert.equal(graph.svgNamespace, 'http://www.w3.org/2000/svg');
      assert.equal(graph.svgWidth, 40);
      assert.equal(graph.svgHeight, 30);
      assert.equal(graph.sameOriginDOM, true);
      assert.equal(traffic.slice(start).length, 0);
      results.push({
        browser: name,
        version: browser.version(),
        mode: 'blob-importmap',
        ...graph,
        requests: traffic.slice(start),
      });
      await context.close();
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
  'results/contexts/document-platform-followup.json',
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
for (const result of results.filter((value) => value.mode !== 'blank-load-capture'))
  console.log(JSON.stringify(result));
