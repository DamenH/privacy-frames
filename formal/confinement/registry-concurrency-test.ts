import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_POLICY_VERSION,
  ContextRegistry,
  type ContextIdentity,
  type ContextStorage,
} from '../../src/runtime/contexts/model.ts';
import { controllerContextStorage } from '../../src/runtime/contexts/controller-store.ts';

// These tests execute the actual registry and controller-store code with two
// independent mutation queues. The CacheStorage stand-in shares records but does
// not verify browser persistence, service-worker scheduling or client identity.
// In particular, the duplicate-bind schedule is a storage-interface possibility;
// this test does not establish that a browser dispatches those two bindings.
const base = new URL('https://runtime.test/');

function identity(id = 'context'): ContextIdentity {
  return {
    policyVersion: CONTEXT_POLICY_VERSION,
    installationGeneration: 'generation',
    id,
    application: 'application',
    parent: 'owner',
    kind: 'dedicated-worker',
    state: 'preparing',
    url: 'https://runtime.test/worker',
  };
}

function gate() {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  return { release, started, blocked, waiting };
}

async function sharedCache(
  run: (raw: (client: string) => Promise<unknown>) => Promise<void>,
) {
  const entries = new Map<string, Response>();
  const cache = {
    async match(key: string) {
      return entries.get(key)?.clone();
    },
    async put(key: string, value: Response) {
      entries.set(key, value.clone());
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return cache;
      },
    },
  });
  try {
    await run(async (client) => {
      const response = await cache.match(
        new URL('__host-context/' + encodeURIComponent(client), base).href,
      );
      return response?.json();
    });
  } finally {
    if (original) Object.defineProperty(globalThis, 'caches', original);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
}

function pauseWrites(storage: ContextStorage) {
  const paused = gate();
  const put = storage.put;
  storage.put = async (client, value) => {
    paused.started();
    await paused.blocked;
    await put(client, value);
  };
  return paused;
}

async function waitForWrite(paused: ReturnType<typeof gate>, operation: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      paused.waiting,
      operation.then(() => {
        throw new Error('Operation completed without reaching the scheduled write');
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Scheduled write not reached')), 3000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

test('a late ready write from another registry cannot defeat effective closure', async () => {
  await sharedCache(async (raw) => {
    const firstStore = controllerContextStorage(base);
    const replacementStore = controllerContextStorage(base);
    const first = new ContextRegistry(firstStore);
    const replacement = new ContextRegistry(replacementStore);
    await first.bind('client', identity());

    const paused = pauseWrites(firstStore);
    const ready = first.transition({ id: 'client', url: identity().url }, 'ready');
    try {
      await waitForWrite(paused, ready);
      assert.equal(await replacement.closeChild('owner', 'application', 'context'), true);
    } finally {
      paused.release();
      await Promise.allSettled([ready]);
    }
    // The older operation can fulfill after closure. Its acknowledgement is not
    // evidence that the identity remains authorized.
    await ready;
    const stored = await raw('client');
    assert(stored && typeof stored === 'object' && 'state' in stored);
    assert.equal(stored.state, 'ready');
    assert.equal((await firstStore.get('client'))?.state, 'closed');
    assert.equal((await replacementStore.get('client'))?.state, 'closed');
    assert.equal(await first.resolveWorker('client'), undefined);
    assert.equal(await replacement.resolveWorker('client'), undefined);
    assert.equal(await first.resourceCapability('context', 'client'), undefined);

    const restarted = new ContextRegistry(controllerContextStorage(base));
    assert.equal(await restarted.resourceCapability('context', 'client'), undefined);
  });
});

test('independent registry queues do not make binding uniqueness atomic', async () => {
  await sharedCache(async () => {
    const leftStore = controllerContextStorage(base);
    const rightStore = controllerContextStorage(base);
    const left = new ContextRegistry(leftStore);
    const right = new ContextRegistry(rightStore);
    const leftWrite = pauseWrites(leftStore);
    const rightWrite = pauseWrites(rightStore);

    const bindLeft = left.bind('reserved-client', identity('context-left'));
    const bindRight = right.bind('reserved-client', identity('context-right'));
    try {
      await Promise.all([
        waitForWrite(leftWrite, bindLeft),
        waitForWrite(rightWrite, bindRight),
      ]);
      leftWrite.release();
      await bindLeft;
      rightWrite.release();
      await bindRight;
    } finally {
      leftWrite.release();
      rightWrite.release();
      await Promise.allSettled([bindLeft, bindRight]);
    }

    assert.equal((await rightStore.get('reserved-client'))?.id, 'context-right');
    assert.equal(await rightStore.lookupByContext('context-left'), 'reserved-client');
    assert.equal(await rightStore.lookupByContext('context-right'), 'reserved-client');
    // The superseded index must not grant its stale context's resource capability.
    assert.equal(
      await left.resourceCapability('context-left', 'reserved-client'),
      undefined,
    );
    const current = await right.resourceCapability('context-right', 'reserved-client');
    assert.equal(current?.identity.id, 'context-right');
    assert.equal(current?.client, 'reserved-client');
    assert.equal(
      await right.resourceCapability('context-right', 'unrelated-client'),
      undefined,
    );
  });
});
