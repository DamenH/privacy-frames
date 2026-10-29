import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from './build.ts';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
const origin = 'http://127.0.0.1:4332';
const nonce = 'precommit-lifecycle';
const policy = `sandbox allow-scripts allow-same-origin allow-forms;default-src 'none';script-src 'nonce-${nonce}' 'unsafe-eval';connect-src 'none';img-src 'none';style-src 'unsafe-inline';frame-src 'self' about:`;
const result = await build({
  stdin: {
    contents: `import {prepareWindowRealm} from './src/runtime/contexts/window-realm.ts';const add=EventTarget.prototype.addEventListener;const nav=window.navigation;prepareWindowRealm({application:'lifecycle-app',applicationURL:${JSON.stringify(origin + '/child')},scriptNonce:${JSON.stringify(nonce)}});Object.defineProperty(window,'__lifecyclePrepared',{value:true});Reflect.apply(add,nav,['navigate',event=>parent.__lifecycleNavigation.push({url:event.destination.url,defaultPrevented:event.defaultPrevented,sameDocument:event.destination.sameDocument})]);`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  banner: { js: '"use strict";' },
  target: 'es2022',
});
const preparation = result.outputFiles[0].text;
const requests: string[] = [];
const server = http.createServer((request, response) => {
  const path = request.url || '/';
  requests.push(path);
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', policy);
  response.setHeader('Origin-Agent-Cluster', '?1');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
  if (path.startsWith('/child')) {
    setTimeout(
      () =>
        response.end(
          `<!doctype html><title>Committed HTTP child</title><script nonce="${nonce}">window.__httpDocumentCommitted=true;</script><body>Committed child`,
        ),
      350,
    );
    return;
  }
  response.end('<!doctype html><title>Lifecycle parent</title><body>');
});
await new Promise<void>((resolve) => server.listen(4332, '127.0.0.1', resolve));
await mkdir('results/contexts', { recursive: true });
const partial = 'results/contexts/document-precommit-lifecycle-trials.jsonl';
await writeFile(partial, '');
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      for (let iteration = 0; iteration < (name === 'firefox' ? 40 : 8); iteration++) {
        const action = [
          'none',
          'about-blank',
          'hash',
          'stop',
          'stop-then-blank',
          'push-null',
          'replace-null',
          'push-omitted',
        ][iteration % 8];
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + '/parent');
        const requestStart = requests.length;
        const value = await page.evaluate(
          async ({ action, nonce, origin, preparation }) => {
            Reflect.set(window, '__lifecycleNavigation', []);
            const iframe = document.createElement('iframe');
            iframe.src = origin + '/child';
            let preparations = 0;
            const prepare = () => {
              const current = iframe.contentWindow!;
              if (Reflect.get(current, '__lifecyclePrepared')) return;
              const meta = current.document.createElement('meta');
              meta.httpEquiv = 'Content-Security-Policy';
              meta.content = `default-src 'none';script-src 'nonce-${nonce}' 'unsafe-eval';connect-src 'none';img-src 'none';style-src 'unsafe-inline';frame-src 'none'`;
              current.document.head.append(meta);
              const script = current.document.createElement('script');
              script.nonce = nonce;
              script.textContent = preparation;
              current.document.head.append(script);
              preparations++;
            };
            document.addEventListener(
              'load',
              (event) => {
                if (event.target === iframe) prepare();
              },
              true,
            );
            iframe.addEventListener('load', prepare, true);
            document.body.append(iframe);
            prepare();
            const initialArray = iframe.contentWindow!.Array;
            const child = iframe.contentWindow!;
            const observations: {
              stage: string;
              prepared: boolean;
              arrayRetained: boolean;
              indexedPrepared: boolean;
              documentViewPrepared: boolean;
            }[] = [];
            const sample = (stage: string) => {
              const current = iframe.contentWindow!;
              observations.push({
                stage,
                prepared: !!Reflect.get(current, '__lifecyclePrepared'),
                arrayRetained: current.Array === initialArray,
                indexedPrepared: !!Reflect.get(window.frames[0], '__lifecyclePrepared'),
                documentViewPrepared: !!Reflect.get(
                  iframe.contentDocument!.defaultView!,
                  '__lifecyclePrepared',
                ),
              });
            };
            iframe.addEventListener('load', () => sample('publisher-load'));
            const timer = setInterval(() => sample('parent-task'), 0);
            let actionError: string | null = null;
            try {
              if (action === 'about-blank') child.location.href = 'about:blank';
              if (action === 'hash') child.location.hash = 'precommit';
              if (action === 'stop') child.stop();
              if (action === 'stop-then-blank') {
                child.stop();
                child.location.href = 'about:blank';
              }
              if (action === 'push-null') child.history.pushState({}, '', null);
              if (action === 'replace-null') child.history.replaceState({}, '', null);
              if (action === 'push-omitted') child.history.pushState({}, '');
            } catch (error) {
              actionError = String(error);
            }
            sample('synchronous');
            await Promise.resolve();
            sample('microtask');
            await new Promise((resolve) => setTimeout(resolve, 600));
            clearInterval(timer);
            const current = iframe.contentWindow!;
            return {
              action,
              actionError,
              preparations,
              observations,
              exposedUnprepared: observations.some(
                (v) => !v.prepared || !v.indexedPrepared || !v.documentViewPrepared,
              ),
              arrayReplaced: current.Array !== initialArray,
              preparedAfter: !!Reflect.get(current, '__lifecyclePrepared'),
              httpCommitted: !!Reflect.get(current, '__httpDocumentCommitted'),
              finalHref: current.location.href,
              finalTitle: current.document.title,
              navigation: Reflect.get(window, '__lifecycleNavigation'),
            };
          },
          { action, nonce, origin, preparation },
        );
        const entry = {
          browser: name,
          version: browser.version(),
          iteration,
          ...value,
          errors,
          requests: requests.slice(requestStart),
        };
        results.push(entry);
        await appendFile(partial, JSON.stringify(entry) + '\n');
        console.log(
          name,
          iteration,
          action,
          JSON.stringify({
            exposed: value.exposedUnprepared,
            arrayReplaced: value.arrayReplaced,
            httpCommitted: value.httpCommitted,
            preparedAfter: value.preparedAfter,
            error: value.actionError,
            navigation: value.navigation,
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
  'results/contexts/document-precommit-lifecycle.json',
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
for (const entry of results) {
  assert.equal(entry.preparedAfter, true);
  if (entry.action === 'none') {
    assert.equal(entry.httpCommitted, true);
    assert.equal(entry.arrayReplaced, false);
    assert.equal(entry.exposedUnprepared, false);
  }
}
