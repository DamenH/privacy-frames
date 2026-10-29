import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadWebsite } from '../src/installation/import-website.ts';
import { ResourceCapture } from '../src/installation/resource-capture.ts';
import { prepareDocument } from '../src/installation/document.ts';

const source = 'https://publisher.test/app/';
async function fixture(
  files: Record<string, string | [string, string]>,
  run: (requested: string[]) => Promise<void>,
) {
  const nativeFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push(url);
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    const item = files[url] ?? files[new URL(url).pathname];
    if (!item) return new Response('Missing', { status: 404 });
    const [body, type] = Array.isArray(item)
      ? item
      : [
          item,
          url.endsWith('.css')
            ? 'text/css'
            : url.endsWith('.js')
              ? 'text/javascript'
              : 'text/html',
        ];
    return new Response(body, { headers: { 'Content-Type': type } });
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test('automatic discovery follows explicit HTML, CSS and literal module references only', async () => {
  await fixture(
    {
      '/app/':
        '<title>Simple</title><link rel="stylesheet" href="main.css"><script type="module" src="main.js"></script>',
      '/app/main.css': '@import "theme.css"; body {background:url(icon.svg)}',
      '/app/theme.css': 'body{color:red}',
      '/app/icon.svg': ['<svg/>', 'image/svg+xml'],
      '/app/main.js':
        'import "./dependency.js"; import("./lazy.js"); fetch("./not-declared.json"); navigator.serviceWorker.register("./worker.js"); new Worker("./other.js");',
      '/app/dependency.js': 'export const value=1;',
      '/app/lazy.js': 'export default 2;',
    },
    async (requests) => {
      const app = await downloadWebsite({ url: source });
      assert.equal(app.format, 'offline-resources-v1');
      assert.deepEqual(app.capture.additionalResources, []);
      assert(!('preparation' in app));
      assert.deepEqual(
        requests.map((url) => new URL(url).pathname).sort(),
        [
          '/app/',
          '/app/main.css',
          '/app/theme.css',
          '/app/icon.svg',
          '/app/main.js',
          '/app/dependency.js',
          '/app/lazy.js',
        ].sort(),
      );
    },
  );
});

test('supplemental resources are captured without executing or interpreting their code', async () => {
  await fixture(
    {
      '/app/': '<title>Additional</title><script src="entry.js"></script>',
      '/app/entry.js': 'throw new Error("Must not run"); fetch("./guessed.json");',
      '/app/worker.js': 'importScripts("./not-guessed.js"); postMessage("not executed");',
      '/app/data.bin': ['captured', 'application/octet-stream'],
    },
    async (requests) => {
      const app = await downloadWebsite({
        url: source,
        resourceList: {
          kind: 'text',
          text: source + 'worker.js\n' + source + 'data.bin',
        },
      });
      assert(app.resources.some((item) => item.url === source + 'worker.js'));
      assert(app.resources.some((item) => item.url === source + 'data.bin'));
      assert.equal(requests.length, 4);
      assert.deepEqual(app.capture.additionalResources, [
        source + 'worker.js',
        source + 'data.bin',
      ]);
    },
  );
});

test('a remotely supplied list is data and does not become an application resource', async () => {
  const list = 'https://lists.test/example.uris';
  await fixture(
    {
      [list]: [source + 'extra.js', 'text/uri-list'],
      '/app/': '<p>Entry</p>',
      '/app/extra.js': 'globalThis.neverExecuted=true;',
    },
    async (requests) => {
      const app = await downloadWebsite({
        url: source,
        resourceList: { kind: 'url', url: list },
      });
      assert(!app.resources.some((item) => item.url === list));
      assert.equal(requests.filter((url) => url === list).length, 1);
    },
  );
});

test('missing entry and explicitly listed resources refuse installation', async () => {
  await fixture({ '/app/': '<p>Entry</p>' }, async () => {
    await assert.rejects(
      downloadWebsite({
        url: source,
        resourceList: { kind: 'text', text: source + 'required.js' },
      }),
      /required.js: HTTP 404/,
    );
    await assert.rejects(downloadWebsite({ url: source + 'missing.html' }), /HTTP 404/);
  });
});

test('dynamic imports and data-selected filenames are never guessed', async () => {
  await fixture(
    {
      '/app/': '<script type="module" src="entry.js"></script>',
      '/app/entry.js':
        'const names=["Default","Crypto"]; for(const name of names) import("./modules/"+name+".js"); const code="importScripts(\"hidden.js\")";',
    },
    async (requests) => {
      await downloadWebsite({ url: source });
      assert.deepEqual(requests, [source, source + 'entry.js']);
    },
  );
});

test('each JavaScript resource is lexed once and cycles download once', async () => {
  await fixture(
    {
      '/app/': '<script type="module" src="a.js"></script>',
      '/app/a.js': 'import "./b.js";',
      '/app/b.js': 'import "./a.js";',
    },
    async (requests) => {
      const capture = new ResourceCapture(new URL(source), new URL(source));
      try {
        const entry = await capture.download(source);
        capture.document(
          prepareDocument(new TextDecoder().decode(entry.bytes), source),
          source,
        );
        await capture.discover();
        await capture.finalize();
        assert.equal(capture.metrics.moduleAnalyses, 2);
        assert.equal(capture.metrics.downloadRequests, 3);
        assert.equal(new Set(requests).size, 3);
      } finally {
        capture.close();
      }
    },
  );
});
