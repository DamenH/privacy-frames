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

async function waitForWrite(
  paused: ReturnType<typeof gate>,
  operation: Promise<unknown>,
) {
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
    // A controller from the previous release can still finish this persisted
    // phase write while a newer controller has already closed the identity.
    const ready = firstStore.put('client', { ...identity(), state: 'ready' });
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

for (const mode of ['identity', 'capability'] as const) {
  test(`a closure from another controller during ${mode} revalidation is rejected without writes`, async () => {
    await sharedCache(async (raw) => {
      const firstStore = controllerContextStorage(base);
      const replacement = new ContextRegistry(controllerContextStorage(base));
      const first = new ContextRegistry(firstStore);
      const value = {
        ...identity(),
        kind: mode === 'identity' ? ('window' as const) : ('dedicated-worker' as const),
      };
      await first.bind('client', value);
      const expected = await first.resourceCapability('context', 'client');
      const paused = gate();
      const get = firstStore.get;
      let pause = true,
        writes = 0;
      firstStore.get = async (client) => {
        const snapshot = await get(client);
        if (pause) {
          pause = false;
          paused.started();
          await paused.blocked;
        }
        return snapshot;
      };
      firstStore.put = async () => {
        writes++;
        throw new Error('Validation performed a write');
      };
      const checking =
        mode === 'identity'
          ? first.isCurrent({ id: 'client', url: value.url }, value)
          : first.isCapabilityCurrent('context', 'client', expected!);
      try {
        await waitForWrite(paused, checking);
        assert.equal(
          await replacement.closeChild('owner', 'application', 'context'),
          true,
        );
      } finally {
        paused.release();
        await Promise.allSettled([checking]);
      }
      assert.equal(await checking, false);
      assert.equal(writes, 0);
      const stored = await raw('client');
      assert(stored && typeof stored === 'object' && 'state' in stored);
      assert.equal(stored.state, 'closed');
    });
  });
}

test('changed authority stamps during asynchronous revalidation are rejected', async () => {
  for (const mode of ['identity', 'capability'] as const) {
    for (const change of [
      { installationGeneration: 'other-generation' },
      { application: 'other-application' },
      { parent: 'other-owner' },
      { id: 'other-context' },
    ]) {
      await sharedCache(async () => {
        const firstStore = controllerContextStorage(base);
        const otherStore = controllerContextStorage(base);
        const first = new ContextRegistry(firstStore);
        await first.bind('client', identity());
        const expected = await first.resourceCapability('context', 'client');
        assert(expected);
        const paused = gate();
        const get = firstStore.get;
        let pause = true;
        firstStore.get = async (client) => {
          const snapshot = await get(client);
          if (pause) {
            pause = false;
            paused.started();
            await paused.blocked;
          }
          return snapshot;
        };
        const checking =
          mode === 'identity'
            ? first.isCurrent({ id: 'client', url: identity().url }, identity())
            : first.isCapabilityCurrent('context', 'client', expected);
        try {
          await waitForWrite(paused, checking);
          await otherStore.put('client', { ...identity(), ...change });
        } finally {
          paused.release();
          await Promise.allSettled([checking]);
        }
        assert.equal(await checking, false, mode + ':' + JSON.stringify(change));
      });
    }
  }
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
