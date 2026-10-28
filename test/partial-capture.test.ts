import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadWebsite } from '../src/installation/import-website.ts';
import {
  CaptureLimitError,
  ResourceCapture,
  ResourceUnavailableError,
} from '../src/installation/resource-capture.ts';
import { compileDocumentContent } from '../src/runtime/contexts/document-content.ts';
import { LIMITS } from '../src/shared/policy.ts';

const source = 'https://publisher.test/application/';
const address = (path: string) => new URL(path, source).href;

async function withFetch(fetcher: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('partial capture retains the successful dependency graph and records transport failures', async () => {
  const requested: string[] = [];
  await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === source)
        return new Response(
          '<!doctype html><title>Partial app</title><link rel="stylesheet" href="site.css"><script src="working.js"></script><script src="analytics.js" onerror="window.analyticsFailed=true"></script><script type="module" src="missing-module.js"></script><img src="broken.png">',
          { headers: { 'content-type': 'text/html' } },
        );
      if (url === address('working.js'))
        return new Response('window.applicationStarted=true;', {
          headers: { 'content-type': 'text/javascript' },
        });
      if (url === address('site.css'))
        return new Response('body{background:url(missing.png)}', {
          headers: { 'content-type': 'text/css' },
        });
      if (url === address('analytics.js')) throw new TypeError('CORS failure');
      if (url === address('broken.png')) return new Response(null, { status: 204 });
      return new Response('Missing', { status: 404 });
    },
    async () => {
      const app = await downloadWebsite(source);
      assert.deepEqual(
        app.resources.map((item) => item.url).sort(),
        [source, address('working.js'), address('site.css')].sort(),
      );
      const failures = app.preparation.unavailableResources ?? [];
      assert(
        failures.some(
          (item) => item.url === address('analytics.js') && item.reason === 'network',
        ),
      );
      assert(
        failures.some(
          (item) =>
            item.url === address('missing-module.js') &&
            item.reason === 'http' &&
            item.status === 404,
        ),
      );
      assert(
        failures.some(
          (item) => item.url === address('broken.png') && item.reason === 'body',
        ),
      );
      assert.equal(requested.filter((url) => url === address('analytics.js')).length, 1);
      const entry = app.resources.find((item) => item.url === source)!;
      const content = compileDocumentContent({
        kind: 'html',
        text: new TextDecoder().decode(entry.bytes),
        sourceURL: source,
        aliases: app.resources.map((item) => [
          item.url,
          'https://runtime.test/' + item.path,
        ]),
        unavailableURLs: failures.map((item) => item.url),
      });
      assert.equal(
        content.scripts.filter((item) => item.source.kind === 'resource').length,
        1,
      );
      assert.equal(
        content.scripts.filter((item) => item.source.kind === 'unavailable').length,
        2,
      );
      assert(!JSON.stringify(content).includes('CORS failure'));
    },
  );
});

test('the entry document remains mandatory even though dependencies are best effort', async () => {
  for (const failure of ['network', 'http'])
    await withFetch(
      async () => {
        if (failure === 'network') throw new TypeError('Unavailable');
        return new Response('Missing', { status: 404 });
      },
      async () => {
        await assert.rejects(downloadWebsite(source), ResourceUnavailableError);
      },
    );
});

test('partial capture does not swallow unsafe documents or module analysis errors', async () => {
  for (const body of [
    '<a href="javascript:escape()">Unsafe</a>',
    '<script type="unrecognized" src="unsafe.js"></script>',
    '<script type="module">import value from "unmapped-package";</script>',
  ])
    await withFetch(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'text/html' },
        }),
      async () => {
        await assert.rejects(downloadWebsite(source));
      },
    );
});

test('failed downloads retain their budget slots and do not retry during discovery', async () => {
  let requests = 0;
  await withFetch(
    async () => {
      requests++;
      throw new TypeError('Unavailable');
    },
    async () => {
      const capture = new ResourceCapture(new URL(source), new URL(source), () => {});
      const graph = capture.graph();
      try {
        for (let index = 0; index < LIMITS.files; index++)
          await capture.downloadDependency(address('missing-' + index), graph);
        assert.equal(requests, LIMITS.files);
        await capture.discover(graph);
        assert.equal(requests, LIMITS.files);
        await assert.rejects(
          capture.downloadDependency(address('one-too-many'), graph),
          CaptureLimitError,
        );
      } finally {
        await capture.closeAll();
      }
    },
  );
});

test('stream interruption is unavailable while a resource budget violation remains fatal', async () => {
  for (const overBudget of [false, true]) {
    let cancelled = false;
    let chunks = 0;
    const chunk = new Uint8Array(1024 * 1024);
    await withFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!overBudget && chunks++) controller.error(new Error('Connection lost'));
              else controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      async () => {
        const capture = new ResourceCapture(new URL(source), new URL(source), () => {});
        const graph = capture.graph();
        try {
          if (overBudget) {
            await assert.rejects(
              capture.downloadDependency(address('asset.bin'), graph),
              CaptureLimitError,
            );
            assert(cancelled);
            assert(graph.controller.signal.aborted);
          } else {
            await capture.downloadDependency(address('asset.bin'), graph);
            assert.equal((await capture.finalize(graph)).resources.length, 0);
            assert.equal(graph.unavailable.get(address('asset.bin'))?.reason, 'body');
          }
        } finally {
          await capture.closeAll();
        }
      },
    );
  }
});

test('cancellation and invalid resource addresses remain fatal before capture', async () => {
  await withFetch(
    async () => {
      throw new Error('Must not fetch');
    },
    async () => {
      const capture = new ResourceCapture(new URL(source), new URL(source), () => {});
      const graph = capture.graph();
      await assert.rejects(
        capture.downloadDependency('javascript:escape()', graph),
        /HTTPS/,
      );
      graph.controller.abort(new Error('User cancelled'));
      await assert.rejects(
        capture.downloadDependency(address('asset'), graph),
        /User cancelled/,
      );
      await capture.closeAll();
    },
  );
});

test('loader summaries cross script boundaries without leaking into a child worker realm', async () => {
  const requested: string[] = [];
  const bodies = new Map<string, [string, string]>([
    [
      source,
      ['text/html', '<script src="app.js"></script><script src="loader.js"></script>'],
    ],
    [
      address('app.js'),
      [
        'text/javascript',
        'addEventListener("load",()=>loadScript("lazy.js"));new Worker("./worker.js");',
      ],
    ],
    [
      address('loader.js'),
      [
        'text/javascript',
        'function loadScript(url){const element=document.createElement("script");element.src=url;document.head.append(element);}',
      ],
    ],
    [address('lazy.js'), ['text/javascript', 'globalThis.lazyValue=42;']],
    [
      address('worker.js'),
      ['text/javascript', 'addEventListener("message",()=>loadScript("foreign.js"));'],
    ],
  ]);
  await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      const body = bodies.get(url);
      return body
        ? new Response(body[1], { headers: { 'content-type': body[0] } })
        : new Response('Missing', { status: 404 });
    },
    async () => {
      const app = await downloadWebsite(source);
      assert(app.resources.some((item) => item.url === address('lazy.js')));
      assert(!requested.includes(address('foreign.js')));
      assert.equal(requested.filter((url) => url === address('lazy.js')).length, 1);
    },
  );
});
