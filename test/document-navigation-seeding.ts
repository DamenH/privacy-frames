import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

const origin = 'http://127.0.0.1:4332';
const nonce = 'navigation-seeding';
const requests: string[] = [];
const server = http.createServer((request, response) => {
  requests.push(request.url || '/');
  response.setHeader('Content-Type', 'text/html');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'nonce-${nonce}';frame-src 'self' about:`,
  );
  response.end('<!doctype html><title>Navigation seeding</title><body>');
});
await new Promise<void>((resolve) => server.listen(4332, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (const mode of [
        'blank',
        'hash',
        'replace',
        'push',
        'open',
        'open-hash',
        'open-replace',
        'open-push',
      ] as const) {
        for (const route of ['blank', 'location', 'link', 'form'] as const) {
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(origin + '/parent');
          const start = requests.length;
          const value = await page.evaluate(
            async ({ mode, route, origin, nonce }) => {
              const frame = document.createElement('iframe');
              document.body.append(frame);
              const child = frame.contentWindow!;
              const array = child.Array;
              const bootstrap = child.document.createElement('script');
              bootstrap.nonce = nonce;
              bootstrap.textContent =
                'Object.defineProperty(EventTarget.prototype,"__seedPolicy",{value:true})';
              child.document.head.append(bootstrap);
              const state = () => {
                const nav = Reflect.get(child, 'navigation');
                return {
                  currentURL: nav?.currentEntry?.url,
                  currentKey: nav?.currentEntry?.key,
                  count: nav?.entries().length,
                  href: child.location.href,
                  arrayRetained: child.Array === array,
                  policyRetained: !!Reflect.get(
                    child.EventTarget.prototype,
                    '__seedPolicy',
                  ),
                };
              };
              const before = state();
              let seedError: string | null = null;
              try {
                if (mode.startsWith('open')) {
                  child.document.open();
                  child.document.write('<!doctype html><body>');
                  child.document.close();
                }
                if (mode.endsWith('hash')) child.location.hash = 'host-ready';
                if (mode.endsWith('replace'))
                  child.history.replaceState(null, '', origin + '/seed');
                if (mode.endsWith('push'))
                  child.history.pushState(null, '', origin + '/seed');
              } catch (error) {
                seedError = String(error);
              }
              await new Promise((resolve) => setTimeout(resolve, 20));
              const afterSeed = state();
              Reflect.set(window, '__events', []);
              const listener = child.document.createElement('script');
              listener.nonce = nonce;
              listener.textContent =
                "navigation.addEventListener('navigate',event=>{parent.__events.push({cancelable:event.cancelable,canIntercept:event.canIntercept,url:event.destination.url,hashChange:event.hashChange});event.preventDefault()},{capture:true})";
              child.document.head.append(listener);
              const target = origin + '/receiver-' + mode + '-' + route;
              const action = child.document.createElement('script');
              action.nonce = nonce;
              action.textContent =
                route === 'blank'
                  ? "location.href='about:blank'"
                  : route === 'location'
                    ? `location.href=${JSON.stringify(target)}`
                    : route === 'link'
                      ? `const a=document.createElement('a');a.href=${JSON.stringify(target)};document.body.append(a);a.click()`
                      : `const f=document.createElement('form');f.action=${JSON.stringify(target)};f.method='POST';document.body.append(f);f.submit()`;
              child.document.head.append(action);
              await new Promise((resolve) => setTimeout(resolve, 100));
              return {
                mode,
                route,
                before,
                afterSeed,
                seedError,
                events: Reflect.get(window, '__events'),
                after: state(),
              };
            },
            { mode, route, origin, nonce },
          );
          results.push({
            browser: name,
            version: browser.version(),
            ...value,
            requests: requests.slice(start),
          });
          console.log(name, mode, route, JSON.stringify(value));
          await context.close();
        }
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
  'results/contexts/document-navigation-seeding.json',
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
