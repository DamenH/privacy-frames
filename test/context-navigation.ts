import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const fixture = await build({
  stdin: {
    resolveDir: process.cwd(),
    sourcefile: 'context-navigation-fixture.js',
    contents: `
import { createPolicyTools } from './src/runtime/enforcement/native.ts';
import { prepareNavigationPolicy } from './src/runtime/enforcement/navigation.ts';
globalThis.installTestNavigation = documentURL => {
  prepareNavigationPolicy(createPolicyTools(), { documentURL })();
  globalThis.navigationPrepared = true;
};`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const script = fixture.outputFiles[0].text;
const provenance = await testProvenance(import.meta.url);
const server = http.createServer((_request, target) => {
  target.writeHead(200, { 'Content-Type': 'text/html' });
  target.end(
    '<!doctype html><title>Navigation policy fixture</title><body>Trusted fixture</body>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Navigation fixture server missing');
const origin = `http://127.0.0.1:${address.port}`;
const evidence = {
  provenance,
  fixtureSHA256: createHash('sha256').update(script).digest('hex'),
  scope:
    'Navigation policy in a synchronously prepared initial child realm retained through its first HTTP commit; URL getter mutation controls',
  browsers: [] as {
    name: string;
    version: string;
    nativePathChange: string;
    result: {
      prepared: boolean;
      privateGetterCalls: number;
      publicGetterCalls: number;
      preventedNavigation: boolean;
      rejected: string[];
      finalURL: string;
      cookies: { read: string; prototype: string; enabled: boolean };
    };
  }[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page
        .context()
        .addCookies([{ name: 'host-native', value: 'host-cookie-marker', url: origin }]);
      await page.goto(origin + '/native/?fixed=1');
      assert(
        (await page.evaluate(() => document.cookie)).includes(
          'host-native=host-cookie-marker',
        ),
      );
      const nativePathChange = await page.evaluate(() => {
        history.replaceState({}, '', '/native-other/?changed=1');
        return location.pathname + location.search;
      });
      assert.equal(nativePathChange, '/native-other/?changed=1');
      await page.goto(origin + '/parent/');
      await page.evaluate(
        ({ script, finalURL }) => {
          const frame = document.createElement('iframe');
          frame.src = finalURL;
          document.body.appendChild(frame);
          const child = frame.contentWindow!;
          Reflect.get(child, 'eval')(script);
          Reflect.get(child, 'installTestNavigation')(finalURL);
        },
        { script, finalURL: origin + '/child/?fixed=1' },
      );
      await page.waitForFunction(
        () =>
          document.querySelector('iframe')?.contentWindow?.location.pathname ===
            '/child/' &&
          document.querySelector('iframe')?.contentDocument?.readyState === 'complete',
      );
      const frame = page.frames().find((frame) => frame.url().includes('/child/'));
      assert(frame, 'First trusted HTTP document did not commit');
      const result = await frame.evaluate(() => {
        const prepared = Reflect.get(window, 'navigationPrepared') === true;
        document.cookie = 'app-native=app-cookie-marker; Path=/';
        const cookies = {
          read: document.cookie,
          prototype: Reflect.apply(
            Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!.get!,
            document,
            [],
          ),
          enabled: navigator.cookieEnabled,
        };
        const expected = new URL(location.href);
        const values = {
          origin: expected.origin,
          pathname: expected.pathname,
          search: expected.search,
        };
        let getterCalls = 0;
        for (const key of ['origin', 'pathname', 'search'] as const) {
          Object.defineProperty(URL.prototype, key, {
            configurable: true,
            get() {
              getterCalls++;
              return values[key];
            },
          });
        }
        const publicURL = new URL(location.href);
        void publicURL.origin;
        void publicURL.pathname;
        void publicURL.search;
        const publicGetterCalls = getterCalls;
        getterCalls = 0;
        history.replaceState({ fixture: 'replace' }, '', '#replacement');
        history.pushState({ fixture: 'push' }, '', '#fragment');
        const rejected: string[] = [];
        for (const target of [
          '/another-path/?fixed=1',
          '/child/?changed=1',
          'https://other.invalid/child/?fixed=1',
        ]) {
          try {
            history.pushState({}, '', target);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'SecurityError')
              rejected.push(target);
            else throw error;
          }
        }
        let preventedNavigation = false;
        navigation.addEventListener(
          'navigate',
          (event) => {
            preventedNavigation = event.defaultPrevented;
          },
          { once: true },
        );
        location.assign('/blocked-navigation/');
        return {
          prepared,
          cookies,
          privateGetterCalls: getterCalls,
          publicGetterCalls,
          preventedNavigation,
          rejected,
          finalURL: location.href,
        };
      });
      assert.deepEqual(result.cookies, { read: '', prototype: '', enabled: false });
      assert(
        (await page.evaluate(() => document.cookie)).includes(
          'host-native=host-cookie-marker',
        ),
      );
      assert(
        !(await page.context().cookies()).some((cookie) => cookie.name === 'app-native'),
      );
      assert.equal(
        result.prepared,
        true,
        'Initial realm preparation did not survive first commit',
      );
      assert.equal(
        result.publicGetterCalls,
        3,
        'Native public URL getter control did not run',
      );
      assert.equal(
        result.privateGetterCalls,
        0,
        'Publisher getters observed private policy URL objects',
      );
      assert.equal(
        result.preventedNavigation,
        true,
        'Document navigation was not canceled',
      );
      assert.equal(
        result.rejected.length,
        3,
        'A different origin/path/query escaped fragment-only history',
      );
      assert.equal(result.finalURL, origin + '/child/?fixed=1#fragment');
      evidence.browsers.push({
        name,
        version: browser.version(),
        nativePathChange,
        result,
      });
      console.log(
        `${name}: initial-realm final URL, fragment history and URL getter controls passed`,
      );
    } finally {
      await browser.close();
    }
  }
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/navigation.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
