import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_POLICY_VERSION,
  ContextRegistry,
  type ContextIdentity,
  type ContextStorage,
} from '../src/runtime/contexts/model.ts';
import { controllerContextStorage } from '../src/runtime/contexts/controller-store.ts';

function memoryStorage(records = new Map<string, ContextIdentity>()): ContextStorage {
  const requests = new Set<string>();
  const closure = (parent: string, application: string, context: string) =>
    JSON.stringify([parent, application, context]);
  return {
    async get(client) {
      const identity = records.get(client);
      if (!identity) return undefined;
      return identity.parent &&
        requests.has(closure(identity.parent, identity.application, identity.id))
        ? { ...identity, state: 'closed' }
        : identity;
    },
    async put(client, identity) {
      records.set(client, identity);
    },
    async lookupByContext(context) {
      return [...records].find(([, identity]) => identity.id === context)?.[0];
    },
    async isClosureRequested(parent, application, context) {
      return requests.has(closure(parent, application, context));
    },
    async requestClosure(parent, application, context) {
      requests.add(closure(parent, application, context));
    },
  };
}
function identity(): ContextIdentity {
  return {
    policyVersion: CONTEXT_POLICY_VERSION,
    installationGeneration: 'host-installation-generation',
    id: 'context',
    application: 'application',
    parent: 'real-parent-client',
    kind: 'dedicated-worker',
    state: 'preparing',
    url: 'https://runtime.test/worker',
  };
}

test('browser context bindings survive controller replacement but reject claimed IDs and changed URLs', async () => {
  const storage = memoryStorage();
  const first = new ContextRegistry(storage);
  const value = identity();
  await first.bind('real-browser-client', value);
  value.application = 'changed-after-bind';
  const replacement = new ContextRegistry(storage);
  assert.equal(
    (await replacement.resolveWorker('real-browser-client'))?.application,
    'application',
  );
  assert.equal(await replacement.resolveWorker('application-provided-claim'), undefined);
  assert.equal(
    await replacement.resolve({
      id: 'real-browser-client',
      url: 'https://runtime.test/other',
    }),
    undefined,
  );
  await assert.rejects(replacement.bind('real-browser-client', value), /already bound/);
});

test('closed contexts cannot regain authority through ready messages', async () => {
  const registry = new ContextRegistry(memoryStorage());
  const client = { id: 'browser-client', url: 'https://runtime.test/worker' };
  await registry.bind(client.id, identity());
  await assert.rejects(registry.transition(client, 'running'), /Invalid/);
  await registry.transition(client, 'ready');
  await registry.transition(client, 'running');
  await registry.transition(client, 'closed');
  assert.equal(await registry.resolveWorker(client.id), undefined);
  await assert.rejects(registry.transition(client, 'ready'), /not bound/);
});

test('an incompatible context policy cannot bind or regain authority from persisted state', async () => {
  const records = new Map<string, ContextIdentity>();
  const registry = new ContextRegistry(memoryStorage(records));
  const value = { ...identity(), policyVersion: CONTEXT_POLICY_VERSION + 1 };
  await assert.rejects(registry.bind('browser-client', value), /Incomplete/);
  records.set('browser-client', value);
  assert.equal(await registry.resolveWorker('browser-client'), undefined);
  assert.equal(
    await registry.resolve({ id: 'browser-client', url: value.url }),
    undefined,
  );
});

test('only the actual owning parent and application can close a bound context', async () => {
  const registry = new ContextRegistry(memoryStorage());
  await registry.bind('browser-client', identity());
  assert.equal(
    await registry.closeChild('unrelated-parent', 'application', 'context'),
    false,
  );
  assert.equal(
    await registry.closeChild('real-parent-client', 'other-application', 'context'),
    false,
  );
  assert((await registry.resolveWorker('browser-client'))?.application === 'application');
  assert.equal(
    await registry.closeChild('real-parent-client', 'application', 'context'),
    true,
  );
  assert.equal(await registry.resolveWorker('browser-client'), undefined);
  assert.equal(
    await registry.closeChild('real-parent-client', 'application', 'context'),
    true,
  );
});

test('parent cancellation before binding survives a registry restart without closing another parent', async () => {
  const storage = memoryStorage();
  const first = new ContextRegistry(storage);
  assert.equal(
    await first.closeChild('real-parent-client', 'application', 'context'),
    true,
  );
  const replacement = new ContextRegistry(storage);
  await assert.rejects(
    replacement.bind('cancelled-client', identity()),
    /closed before startup/,
  );
  await replacement.bind('other-client', { ...identity(), parent: 'another-parent' });
  assert.equal(
    (await replacement.resolveWorker('other-client'))?.parent,
    'another-parent',
  );
  assert.equal(
    await replacement.closeChild('real-parent-client', 'application', 'context'),
    false,
  );
  assert(await replacement.resolveWorker('other-client'));
});

test('a concurrent ready transition cannot restore a parent-closed context', async () => {
  const storage = memoryStorage();
  const write = storage.put;
  let readyStarted!: () => void;
  let releaseReady!: () => void;
  const started = new Promise<void>((resolve) => {
    readyStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  storage.put = async (client, value) => {
    if (value.state === 'ready') {
      readyStarted();
      await released;
    }
    await write(client, value);
  };
  const registry = new ContextRegistry(storage);
  await registry.bind('browser-client', identity());
  const ready = registry.transition(
    { id: 'browser-client', url: identity().url },
    'ready',
  );
  await started;
  const closed = registry.closeChild('real-parent-client', 'application', 'context');
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseReady();
  await ready;
  assert.equal(await closed, true);
  assert.equal(await registry.resolveWorker('browser-client'), undefined);
});

test('controller storage closure markers survive late writes from a replaced controller', async () => {
  const entries = new Map<string, Response>();
  const cache = {
    async match(key: string) {
      return entries.get(key)?.clone();
    },
    async put(key: string, value: Response) {
      entries.set(key, value.clone());
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return cache;
      },
    },
  });
  try {
    const first = controllerContextStorage(new URL('https://runtime.test/'));
    const replacement = controllerContextStorage(new URL('https://runtime.test/'));
    const value = identity();
    await first.put('browser-client', value);
    assert.equal(await replacement.lookupByContext(value.id), 'browser-client');
    await replacement.requestClosure(value.parent!, value.application, value.id);
    await first.put('browser-client', { ...value, state: 'ready' });
    assert.equal((await replacement.get('browser-client'))?.state, 'closed');
    await first.put('closed-client', { ...value, id: 'other-context', state: 'closed' });
    await replacement.put('closed-client', {
      ...value,
      id: 'other-context',
      state: 'running',
    });
    assert.equal((await first.get('closed-client'))?.state, 'closed');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});
