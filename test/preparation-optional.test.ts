import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadWebsite } from '../src/installation/import-website.ts';
import { admitInstallation } from '../src/runtime/admission.ts';
import { digest } from '../src/shared/policy.ts';
import type { PreparedInstallation } from '../src/shared/types.ts';
import type { CapturedResponse } from '../src/installation/protocol.ts';

const source = 'https://publisher.test/application/index.html';
const script = 'https://publisher.test/application/sw.js';
const applicationScript = 'https://publisher.test/application/app.js';
const originalCode = 'globalThis.staticApplication = "independent";';
const bytes = (value: string) => new TextEncoder().encode(value).buffer;
const resource = (url: string, text: string, contentType: string): CapturedResponse => ({
  url,
  bytes: bytes(text),
  contentType,
});

interface Scenario {
  expectedWorkers?: number;
  applicationCode?: string;
  prepare?(message: Record<string, unknown>): void;
  workerFetch?(options?: RequestInit): Promise<Response>;
  start(worker: MockWorker): void;
  reply?(worker: MockWorker, message: Record<string, unknown>): void;
  extraFetch?(url: string, options?: RequestInit): Promise<Response> | undefined;
}
let scenario: Scenario;
const workers: MockWorker[] = [];
class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  messagesAfterTermination = 0;
  constructor() {
    workers.push(this);
  }
  postMessage(value: Record<string, unknown>) {
    if (this.terminated) {
      this.messagesAfterTermination++;
      throw new Error('Message sent to terminated preparation');
    }
    if (value.type === 'prepare') {
      scenario.prepare?.(value);
      queueMicrotask(() => scenario.start(this));
    } else scenario.reply?.(this, value);
  }
  emit(value: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: value }));
  }
  terminate() {
    this.terminated = true;
  }
}

async function install(
  selected: Scenario,
  inspect: (app: PreparedInstallation, requests: string[]) => void | Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const requests: string[] = [];
  scenario = selected;
  workers.length = 0;
  Object.defineProperty(globalThis, 'Worker', { value: MockWorker, configurable: true });
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push(url);
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    if (url === source)
      return new Response(
        '<title>Static application</title><script src="app.js"></script>',
        {
          headers: { 'content-type': 'text/html' },
        },
      );
    if (url === applicationScript)
      return new Response(selected.applicationCode ?? originalCode, {
        headers: { 'content-type': 'text/javascript' },
      });
    if (url === script && selected.workerFetch) return selected.workerFetch(options);
    if (url === script)
      return new Response('// optional precache worker', {
        headers: { 'content-type': 'text/javascript' },
      });
    return (
      selected.extraFetch?.(url, options) ?? new Response('Missing', { status: 404 })
    );
  };
  try {
    await inspect(await downloadWebsite(source), requests);
    assert.equal(workers.length, selected.expectedWorkers ?? 1);
    for (const worker of workers) {
      assert(worker.terminated);
      assert.equal(worker.onmessage, null);
      assert.equal(worker.messagesAfterTermination, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}

function assertIndependent(app: PreparedInstallation) {
  assert.equal(app.preparation.serviceWorker, null);
  assert.deepEqual(app.preparation.caches, []);
  assert.deepEqual(
    app.resources.map((item) => item.url).sort(),
    [applicationScript, source].sort(),
  );
  assert.equal(
    new TextDecoder().decode(
      app.resources.find((item) => item.url === applicationScript)!.bytes,
    ),
    originalCode,
  );
}

test('unsupported optional preparation keeps independently captured resources without a receipt', async () => {
  await install(
    {
      start(worker) {
        worker.emit({
          type: 'failed',
          status: 'unsupported',
          error: 'No explicit install handler',
        });
      },
    },
    (app) => {
      assertIndependent(app);
      assert.deepEqual(app.preparation.outcome, {
        status: 'unsupported',
        scriptURL: script,
        reason: 'No explicit install handler',
      });
    },
  );
});

test('invalid cache overwrite and its broker downloads roll back together', async () => {
  const added = 'https://publisher.test/application/staged-only.json';
  await install(
    {
      start(worker) {
        worker.emit({ type: 'download', id: 1, url: added });
      },
      reply(worker, message) {
        assert.equal(message.ok, true);
        worker.emit({
          type: 'prepared',
          caches: [
            {
              name: 'candidate',
              entries: [
                resource(
                  source,
                  '<a href="javascript:escape()">Unsafe staged document</a>',
                  'text/html',
                ),
                resource(
                  applicationScript,
                  'globalThis.staticApplication="overwritten";',
                  'text/javascript',
                ),
              ],
            },
          ],
        });
      },
      extraFetch(url) {
        return url === added ? Promise.resolve(new Response('{}')) : undefined;
      },
    },
    (app, requests) => {
      assertIndependent(app);
      assert(requests.includes(added));
      assert.equal(app.preparation.outcome.status, 'failed');
    },
  );
});

test('ending failed preparation aborts pending downloads and closes late broker messages', async () => {
  const slow = 'https://publisher.test/application/pending.json';
  const late = 'https://publisher.test/application/late.json';
  let aborted = false;
  await install(
    {
      start(worker) {
        const callback = worker.onmessage;
        worker.emit({ type: 'download', id: 1, url: slow });
        worker.emit({ type: 'failed', status: 'failed', error: 'Preparation rejected' });
        queueMicrotask(() =>
          callback?.(
            new MessageEvent('message', { data: { type: 'download', id: 2, url: late } }),
          ),
        );
      },
      extraFetch(url, options) {
        if (url !== slow) return;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      },
    },
    (app, requests) => {
      assertIndependent(app);
      assert(aborted);
      assert(requests.includes(slow));
      assert(!requests.includes(late));
    },
  );
});

test('successful preparation promotes generated resources and a matching completed receipt', async () => {
  const generated = 'https://publisher.test/application/generated.json';
  await install(
    {
      start(worker) {
        worker.emit({
          type: 'prepared',
          caches: [
            {
              name: 'public-cache',
              entries: [resource(generated, '{"prepared":true}', 'application/json')],
            },
          ],
        });
      },
    },
    (app) => {
      assert.deepEqual(app.preparation.outcome, {
        status: 'completed',
        scriptURL: script,
      });
      assert.equal(app.preparation.serviceWorker?.scriptURL, script);
      assert.deepEqual(app.preparation.caches, [
        { name: 'public-cache', urls: [generated] },
      ]);
      assert.equal(
        new TextDecoder().decode(
          app.resources.find((item) => item.url === generated)!.bytes,
        ),
        '{"prepared":true}',
      );
    },
  );
});

test('optional preparation follows a statically registered script instead of guessing sw.js', async () => {
  const foreground = new URL('foreground.js', source).href;
  await install(
    {
      applicationCode: 'navigator.serviceWorker.register("./foreground.js");',
      prepare(message) {
        assert.equal(message.scriptURL, foreground);
      },
      start(worker) {
        worker.emit({ type: 'prepared', caches: [] });
      },
      extraFetch(url) {
        return url === foreground
          ? Promise.resolve(
              new Response('// foreground worker', {
                headers: { 'content-type': 'text/javascript' },
              }),
            )
          : undefined;
      },
    },
    (app, requests) => {
      assert.equal(app.preparation.serviceWorker?.scriptURL, foreground);
      assert(!requests.includes(script));
    },
  );
});

test('ambiguous captured registrations do not choose an arbitrary worker to execute', async () => {
  await install(
    {
      expectedWorkers: 0,
      applicationCode:
        'navigator.serviceWorker.register("./first.js");navigator.serviceWorker.register("./second.js");',
      start() {
        throw new Error('No worker should run');
      },
      extraFetch(url) {
        return /\/(first|second)\.js$/.test(url)
          ? Promise.resolve(
              new Response('// worker', {
                headers: { 'content-type': 'text/javascript' },
              }),
            )
          : undefined;
      },
    },
    (app) => {
      assert.equal(app.preparation.outcome.status, 'unsupported');
      assert.equal(app.preparation.serviceWorker, null);
    },
  );
});

test('one available registration can prepare while an alternative remains unavailable', async () => {
  const foreground = new URL('foreground.js', source).href;
  await install(
    {
      applicationCode:
        'navigator.serviceWorker.register("./missing.js");navigator.serviceWorker.register("./foreground.js");',
      prepare(message) {
        assert.equal(message.scriptURL, foreground);
      },
      start(worker) {
        worker.emit({ type: 'prepared', caches: [] });
      },
      extraFetch(url) {
        return url === foreground
          ? Promise.resolve(
              new Response('// worker', {
                headers: { 'content-type': 'text/javascript' },
              }),
            )
          : undefined;
      },
    },
    (app) => {
      assert.equal(app.preparation.serviceWorker?.scriptURL, foreground);
      assert(
        app.preparation.unavailableResources?.some((item) =>
          item.url.endsWith('/missing.js'),
        ),
      );
    },
  );
});

test('malformed completion data cannot promote preparation resources', async () => {
  await install(
    {
      start(worker) {
        worker.emit({
          type: 'prepared',
          caches: [
            {
              name: 'bad',
              entries: [
                { url: source, bytes: 'not an ArrayBuffer', contentType: 'text/html' },
              ],
            },
          ],
        });
      },
    },
    (app) => {
      assertIndependent(app);
      assert.equal(app.preparation.outcome.status, 'failed');
    },
  );
});

test('unavailable independent scripts are recorded without becoming installed scripts', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      String(input) === source
        ? new Response('<script src="missing.js"></script>', {
            headers: { 'content-type': 'text/html' },
          })
        : new Response('Missing', { status: 404 });
    const application = await downloadWebsite(source);
    assert.equal(application.resources.length, 1);
    assert(
      application.preparation.unavailableResources?.some(
        (item) =>
          item.url === new URL('missing.js', source).href &&
          item.reason === 'http' &&
          item.status === 404,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function shortPreparationDeadline(run: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')!;
  const original = globalThis.setTimeout;
  Object.defineProperty(globalThis, 'setTimeout', {
    ...descriptor,
    value: (callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) =>
      original(callback, delay === 45000 ? 5 : delay, ...args),
  });
  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, 'setTimeout', descriptor);
  }
}

test('a hung optional worker reaches a bounded failure and leaves the static graph available', async () => {
  await shortPreparationDeadline(() =>
    install({ start() {} }, (app) => {
      assertIndependent(app);
      assert.equal(app.preparation.outcome.status, 'failed');
      if (app.preparation.outcome.status === 'failed')
        assert.match(app.preparation.outcome.reason, /timed out/);
    }),
  );
});

test('completed workers are revoked before trusted dependency discovery outlasts their deadline', async () => {
  const generated = new URL('generated.js', source).href;
  const dependency = new URL('trusted-extra.js', source).href;
  let discovered = false;
  await shortPreparationDeadline(() =>
    install(
      {
        start(worker) {
          worker.emit({
            type: 'prepared',
            caches: [
              {
                name: 'public-cache',
                entries: [
                  resource(generated, 'import "./trusted-extra.js";', 'text/javascript'),
                ],
              },
            ],
          });
        },
        extraFetch(url, options) {
          if (url !== dependency) return;
          discovered = true;
          assert.equal(workers[0]!.terminated, true);
          assert.equal(workers[0]!.onmessage, null);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              options?.signal?.removeEventListener('abort', aborted);
              resolve(
                new Response('export const prepared = true;', {
                  headers: { 'Content-Type': 'text/javascript' },
                }),
              );
            }, 25);
            const aborted = () => {
              clearTimeout(timer);
              reject(options?.signal?.reason);
            };
            options?.signal?.addEventListener('abort', aborted, { once: true });
          });
        },
      },
      (app) => {
        assert(discovered);
        assert.equal(app.preparation.outcome.status, 'completed');
        assert(app.resources.some((item) => item.url === dependency));
        assert.deepEqual(app.preparation.caches, [
          { name: 'public-cache', urls: [generated] },
        ]);
      },
    ),
  );
});

test('the optional deadline also covers fetching the conventional worker script', async () => {
  let aborted = false;
  await shortPreparationDeadline(() =>
    install(
      {
        expectedWorkers: 0,
        start() {
          throw new Error('A stalled script cannot create a worker');
        },
        workerFetch(options) {
          return new Promise((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(options.signal?.reason);
              },
              { once: true },
            ),
          );
        },
      },
      (app) => {
        assertIndependent(app);
        assert(aborted);
        assert.equal(app.preparation.outcome.status, 'failed');
      },
    ),
  );
});

async function admissionCandidate(): Promise<PreparedInstallation> {
  const body = bytes('<p>Independent static application</p>');
  return {
    id: 'app-' + (await digest(new TextEncoder().encode(source))),
    manifest: { id: 'app', name: 'Static', entry: 'index.html' },
    source,
    resources: [
      {
        url: source,
        path: 'index.html',
        bytes: body,
        contentType: 'text/html',
        sha256: await digest(body),
      },
    ],
    installedAt: new Date().toISOString(),
    size: body.byteLength,
    preparation: {
      profile: 'website-v1',
      ended: true,
      caches: [],
      serviceWorker: null,
      outcome: { status: 'absent' },
    },
  };
}

test('runtime admission rejects a completed outcome without its completed worker receipt', async () => {
  const app = await admissionCandidate();
  app.preparation.outcome = { status: 'completed', scriptURL: script };
  await assert.rejects(
    admitInstallation(app, new URL('https://runtime.test/')),
    /requires its receipt/,
  );
});

test('runtime admission rejects cache contributions from an unsuccessful preparation', async () => {
  const app = await admissionCandidate();
  app.preparation.outcome = {
    status: 'failed',
    scriptURL: script,
    reason: 'Optional failure',
  };
  app.preparation.caches.push({ name: 'injected', urls: [source] });
  await assert.rejects(
    admitInstallation(app, new URL('https://runtime.test/')),
    /cannot publish worker authority or caches/,
  );
});

test('optional outcomes cannot bypass independent resource integrity checks', async () => {
  const app = await admissionCandidate();
  app.resources[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    admitInstallation(app, new URL('https://runtime.test/')),
    /integrity or size/,
  );
});

test('unavailable resource diagnostics are bounded data rather than executable authority', async () => {
  for (const unavailableResources of [
    [{ url: 'javascript:escape()', reason: 'network' }],
    [{ url: source, reason: 'network' }],
    [{ url: 'https://outside.test/script.js', reason: 'http', status: 200 }],
    [{ url: 'https://outside.test/script.js', reason: 'unknown' }],
    [
      { url: 'https://outside.test/script.js', reason: 'network' },
      { url: 'https://outside.test/script.js', reason: 'body' },
    ],
  ]) {
    const app = await admissionCandidate();
    const preparation = { ...app.preparation, unavailableResources };
    await assert.rejects(
      admitInstallation({ ...app, preparation }, new URL('https://runtime.test/')),
    );
  }
});

test('unsupported external script types in cached HTML roll back before runtime admission', async () => {
  await install(
    {
      start(worker) {
        worker.emit({
          type: 'prepared',
          caches: [
            {
              name: 'bad-document',
              entries: [
                resource(
                  source,
                  '<script type="unsupported-code" src="app.js"></script>',
                  'text/html',
                ),
              ],
            },
          ],
        });
      },
    },
    (app) => {
      assertIndependent(app);
      assert.equal(app.preparation.outcome.status, 'failed');
      if (app.preparation.outcome.status === 'failed')
        assert.match(
          app.preparation.outcome.reason,
          /Unsupported executable script type/,
        );
    },
  );
});

test('the runtime document compiler checks staged script ownership before promotion', async () => {
  await install(
    {
      start(worker) {
        worker.emit({
          type: 'prepared',
          caches: [
            {
              name: 'unadmitted-source',
              entries: [
                resource(
                  source,
                  '<script src="#unadmitted-script-fragment"></script>',
                  'text/html',
                ),
              ],
            },
          ],
        });
      },
    },
    (app) => {
      assertIndependent(app);
      assert.equal(app.preparation.outcome.status, 'failed');
      if (app.preparation.outcome.status === 'failed')
        assert.match(
          app.preparation.outcome.reason,
          /Script must be installed JavaScript/,
        );
    },
  );
});
