import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkletModule } from '../src/runtime/contexts/worklet-source.ts';
import {
  WorkletRegistry,
  type StoredWorklet,
  type WorkletStorage,
} from '../src/runtime/contexts/worklet-store.ts';
import { createWorkletController } from '../src/runtime/contexts/worklet-controller.ts';
import { applicationURL, resourceURL } from '../src/shared/runtime-url.ts';
import type { StoredInstallation } from '../src/runtime/storage.ts';
import { createPolicyTools } from '../src/runtime/enforcement/native.ts';

const base = new URL('https://runtime.test/');
const initial: StoredInstallation = {
  id: 'worklets-' + 'a'.repeat(64),
  generation: 'generation-one',
  source: 'https://publisher.test/app/index.html',
  manifest: { id: 'worklets', name: 'Worklets', entry: 'index.html' },
  resources: [
    {
      path: 'entry.js',
      url: 'https://publisher.test/app/entry.js',
      contentType: 'text/javascript',
      sha256: 'fixture',
    },
    {
      path: 'dependency.js',
      url: 'https://publisher.test/app/dependency.js',
      contentType: 'text/javascript',
      sha256: 'fixture',
    },
    {
      path: 'index.html',
      url: 'https://publisher.test/app/index.html',
      contentType: 'text/html',
      sha256: 'fixture',
    },
  ],
  size: 1,
  installedAt: '2026-10-27',
  preparation: {
    profile: 'website-v1',
    outcome: { status: 'absent' },
    serviceWorker: null,
    caches: [],
    ended: true,
  },
};
function memory() {
  const records = new Map<string, StoredWorklet>();
  const storage: WorkletStorage = {
    async get(id) {
      return records.get(id);
    },
    async put(value) {
      records.set(value.id, structuredClone(value));
    },
  };
  return { records, storage };
}
function fixture() {
  let app = initial;
  const { storage, records } = memory();
  let reads = 0;
  const controller = createWorkletController({
    base,
    storage,
    async owner(clientId) {
      return ['native-window', 'other-window'].includes(clientId)
        ? { clientId, app }
        : undefined;
    },
    async readResource(_app, path, generation) {
      assert.equal(generation, app.generation);
      reads++;
      return new TextEncoder().encode(
        path === 'entry.js'
          ? "import './dependency.js';globalThis.entryRan=true;"
          : 'export const dependency=1;',
      ).buffer;
    },
    async guardSource() {
      return 'export function rejectDynamicImport(){throw new Error("fixture")}';
    },
  });
  const request = (
    url: string,
    destination: RequestDestination = '',
    clientId = 'native-window',
    resultingClientId = '',
    method = 'GET',
    body?: unknown,
  ) => {
    const value = new Request(url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    Object.defineProperty(value, 'destination', { value: destination });
    return controller.respond({ request: value, clientId, resultingClientId });
  };
  const issue = (
    source: unknown = { kind: 'resource', url: initial.resources[0].url },
    kind = 'audio',
    id?: string,
  ) =>
    request(
      new URL('__worklet-intents', applicationURL(app, base)).href,
      '',
      'native-window',
      '',
      'POST',
      {
        kind,
        source,
        ...(id ? { id } : {}),
        application: 'ignored-claim',
        generation: 'ignored-claim',
        parentClient: 'ignored-claim',
      },
    );
  return {
    request,
    issue,
    records,
    reads: () => reads,
    replace() {
      app = { ...app, generation: 'generation-two' };
    },
  };
}

test('module rewriting guards every graph node, relocates imports and rejects computed loading', () => {
  const options = {
    baseURL: 'https://runtime.test/app/main.js',
    logicalURL: 'https://publisher.test/main.js',
    guardURL: 'https://runtime.test/context/guard.js',
    aliases: [
      [
        'https://runtime.test/app/dependency.js',
        'https://runtime.test/context/resources/dependency.js',
      ],
    ] as [string, string][],
  };
  const code = prepareWorkletModule(
    '#!module\nimport value from "./dependency.js"; export * from "./dependency.js"; const __privacyWorkletImport0 = 1; import(import("data:text/javascript,bad()")); const identity=import.meta.url;',
    options,
  );
  assert(
    code.startsWith(
      '#!module\nimport { rejectDynamicImport as __privacyWorkletImport1 }',
    ),
  );
  assert.equal(code.match(/context\/resources\/dependency.js/g)?.length, 2);
  assert(
    code.includes(
      '__privacyWorkletImport1(__privacyWorkletImport1("data:text/javascript,bad()"))',
    ),
  );
  assert(!code.includes('import.meta.url'));
  assert(code.includes('https://publisher.test/main.js'));
  assert.throws(
    () => prepareWorkletModule('import "https://outside.test/code.js";', options),
    /not installed/,
  );
  assert.throws(
    () => prepareWorkletModule('import "data:text/javascript,bad()";', options),
    /not installed/,
  );
  assert.throws(
    () => prepareWorkletModule('import "blob:https://runtime.test/unknown";', options),
    /not installed/,
  );
});

test('worklet registry persists actual owner/generation independently of browser worker identities', async () => {
  const { storage } = memory();
  const actor = {
    application: initial.id,
    generation: initial.generation,
    parentClient: 'native-window',
  };
  const first = await new WorkletRegistry(storage).register(actor, 'audio', {
    kind: 'resource',
    url: initial.resources[0].url,
  });
  const replacement = new WorkletRegistry(storage);
  assert.equal((await replacement.resolve(first.identity.id, actor))?.entries.length, 1);
  assert.equal(
    await replacement.resolve(first.identity.id, {
      ...actor,
      parentClient: 'other-window',
    }),
    undefined,
  );
  assert.equal(
    await replacement.resolve(first.identity.id, { ...actor, generation: 'replacement' }),
    undefined,
  );
  await assert.rejects(
    replacement.register(
      { ...actor, application: 'other-app' },
      'audio',
      first.entry.source,
      first.identity.id,
    ),
    /not owned/,
  );
});

test('controller authenticates actual Window and serves only guarded JavaScript graph routes', async () => {
  const f = fixture();
  const issued = await f.issue();
  assert.equal(issued?.status, 200);
  const registration = (await issued!.json()) as { id: string; url: string };
  const entry = await f.request(registration.url, 'audioworklet');
  assert(entry?.ok);
  assert((await entry.text()).startsWith('import "'));
  const directory = new URL('../', registration.url);
  const graphURL = new URL('resources/entry.js', directory).href;
  const graph = await f.request(graphURL, 'audioworklet');
  assert(graph?.ok);
  assert((await graph.text()).startsWith('import { rejectDynamicImport'));
  assert.equal(
    (await f.request(graphURL, 'audioworklet', 'other-window'))?.type,
    'error',
  );
  assert.equal((await f.request(graphURL, 'audioworklet', ''))?.type, 'error');
  assert.equal(
    (await f.request(graphURL, 'audioworklet', 'native-window', 'reserved-child'))?.type,
    'error',
  );
  assert.equal((await f.request(graphURL, 'worker'))?.type, 'error');
  assert.equal((await f.request(graphURL, 'paintworklet'))?.type, 'error');
  assert.equal((await f.request(graphURL + '?query=1', 'audioworklet'))?.type, 'error');
  assert.equal(
    (
      await f.request(
        graphURL.replace('/resources/entry.js', '/resources/index.html'),
        'audioworklet',
      )
    )?.type,
    'error',
  );
  assert.equal(f.reads(), 1);
  f.replace();
  assert.equal((await f.request(graphURL, 'audioworklet'))?.type, 'error');
  assert.equal(f.reads(), 1);
});

test('resource and runtime Blob entries are local sources; unknown HTTP/foreign Blob never enter native loading', async () => {
  const f = fixture();
  assert.equal(
    (await f.issue({ kind: 'resource', url: 'https://outside.test/not-installed.js' }))
      ?.type,
    'error',
  );
  assert.equal((await f.issue({ kind: 'resource', url: initial.source }))?.type, 'error');
  assert.equal(
    (
      await f.issue({
        kind: 'blob',
        url: 'blob:https://outside.test/module',
        text: 'bad()',
        contentType: 'text/javascript',
      })
    )?.type,
    'error',
  );
  assert.equal(
    (
      await f.issue({
        kind: 'blob',
        url: 'blob:https://runtime.test/module',
        text: 'bad()',
        contentType: 'text/html',
      })
    )?.type,
    'error',
  );
  const issued = await f.issue({
    kind: 'blob',
    url: 'blob:https://runtime.test/module',
    text: 'registerProcessor("local", class {});',
    contentType: 'text/javascript',
  });
  assert.equal(issued?.status, 200);
  const registration = (await issued!.json()) as { url: string };
  const module = await f.request(registration.url, 'audioworklet');
  assert(module?.ok);
  assert((await module.text()).startsWith('import { rejectDynamicImport'));
  assert.equal(f.reads(), 0);
  assert.equal(f.records.size, 1);
});

test('policy denials identify methods/properties and remain idempotent', () => {
  const tools = createPolicyTools();
  const target = {
    method() {
      return 'native';
    },
  };
  Object.defineProperty(target, 'property', {
    configurable: true,
    get() {
      return 'native';
    },
  });
  tools.method(target, 'method', tools.deny);
  tools.method(target, 'method', tools.deny);
  tools.accessor(target, 'property', { get: tools.deny });
  tools.accessor(target, 'property', { get: tools.deny });
  assert.throws(() => target.method(), {
    name: 'SecurityError',
    message: 'Operation method prohibited by application host',
  });
  assert.throws(() => Reflect.get(target, 'property'), {
    name: 'SecurityError',
    message: 'Operation property prohibited by application host',
  });
});
