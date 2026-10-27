import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const origin = 'http://127.0.0.1:4332';
const nonce = 'initial-reuse';
const policy = `default-src 'none';script-src 'self' 'nonce-${nonce}';frame-src 'self' about:`;
function headers(response: http.ServerResponse, kind: string) {
  response.setHeader('Content-Security-Policy', policy);
  if (kind === 'origin') response.setHeader('Origin-Agent-Cluster', '?1');
  if (kind === 'site') response.setHeader('Origin-Agent-Cluster', '?0');
  if (kind === 'coop' || kind === 'isolated')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (kind === 'isolated')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', origin);
  const kind = url.searchParams.get('policy') || 'baseline';
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Cache-Control', 'no-store');
  if (!url.searchParams.has('simple')) headers(response, kind);
  if (url.pathname === '/delay.js') {
    response.setHeader('Content-Type', 'text/javascript');
    setTimeout(() => response.end('window.__parserReady=true'), 100);
    return;
  }
  if (url.pathname === '/child') {
    response.end(
      `<!doctype html><script src="/delay.js"></script><script nonce="${nonce}">window.__firstParserObservation={policy:!!EventTarget.prototype.__initialPolicy,getter:window.__initialGetter,array:Array===parent.__initialArray,fn:Function===parent.__initialFunction,wrapper:EventTarget.prototype.addEventListener===parent.__initialListener};</script><body>Child`,
    );
    return;
  }
  response.end('<!doctype html><title>Initial reuse</title><body>');
});
await new Promise<void>((resolve) => server.listen(4332, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const kind of ['baseline', 'origin', 'site', 'coop', 'isolated'])
        for (const simple of [false, true])
          for (const route of ['location-after-preparation', 'src-before-insertion']) {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto(`${origin}/parent?policy=${kind}`);
            const value = await page.evaluate(
              async ({ kind, simple, route, nonce, origin }) => {
                const iframe = document.createElement('iframe');
                const target = `${origin}/child?policy=${kind}${simple ? '&simple=1' : ''}`;
                if (route === 'src-before-insertion') iframe.src = target;
                document.body.append(iframe);
                const child = iframe.contentWindow!;
                const doc = child.document;
                const array = child.Array,
                  fn = child.Function;
                Reflect.set(window, '__initialArray', array);
                Reflect.set(window, '__initialFunction', fn);
                const script = doc.createElement('script');
                script.nonce = nonce;
                script.textContent = `const nativeListener=EventTarget.prototype.addEventListener;Object.defineProperty(EventTarget.prototype,'__initialPolicy',{value:true});Object.defineProperty(window,'__initialGetter',{get(){return 'prepared'}});EventTarget.prototype.addEventListener=function(...args){return Reflect.apply(nativeListener,this,args)};`;
                doc.head.append(script);
                const listener = child.EventTarget.prototype.addEventListener;
                Reflect.set(window, '__initialListener', listener);
                const initial = {
                  href: child.location.href,
                  policy: !!Reflect.get(child.EventTarget.prototype, '__initialPolicy'),
                  getter: Reflect.get(child, '__initialGetter'),
                };
                const observations: {
                  ready: boolean;
                  array: boolean;
                  fn: boolean;
                  wrapper: boolean;
                }[] = [];
                const interval = setInterval(() => {
                  try {
                    const current = iframe.contentWindow!;
                    observations.push({
                      ready: !!Reflect.get(
                        current.EventTarget.prototype,
                        '__initialPolicy',
                      ),
                      array: current.Array === array,
                      fn: current.Function === fn,
                      wrapper:
                        current.EventTarget.prototype.addEventListener === listener,
                    });
                  } catch {}
                }, 0);
                await new Promise<void>((resolve) => {
                  iframe.addEventListener('load', () => resolve(), { once: true });
                  setTimeout(resolve, 1500);
                  if (route === 'location-after-preparation')
                    child.location.href = target;
                });
                clearInterval(interval);
                const current = iframe.contentWindow!;
                return {
                  kind,
                  simple,
                  route,
                  initial,
                  after: (() => {
                    try {
                      const after = {
                        array: current.Array === array,
                        fn: current.Function === fn,
                        document: current.document === doc,
                        policy: !!Reflect.get(
                          current.EventTarget.prototype,
                          '__initialPolicy',
                        ),
                        getter: Reflect.get(current, '__initialGetter'),
                        wrapper:
                          current.EventTarget.prototype.addEventListener === listener,
                        parser: Reflect.get(current, '__firstParserObservation'),
                      };
                      return after;
                    } catch (error) {
                      return { error: String(error) };
                    }
                  })(),
                  observations,
                  exposedUnprepared: observations.some((x) => !x.ready),
                };
              },
              { kind, simple, route, nonce, origin },
            );
            results.push({ browser: name, version: browser.version(), ...value });
            console.log(name, kind, simple, route, JSON.stringify(value.after));
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
  'results/contexts/document-initial-reuse.json',
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
