import {
  DocumentIntentStore,
  type DocumentIntentActor,
  type DocumentIntentContent,
  type DocumentIntentMetadata,
} from '../../../src/runtime/contexts/document-intents.ts';
import type { DocumentContentInput } from '../../../src/runtime/contexts/document-content-types.ts';
import { INTENT_DATABASE, type IntentProbe } from './types.ts';

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks++;
  if (!condition) throw new Error(message);
}
async function rejected(operation: () => unknown | Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a persisted data record');
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(value)) result[name] = Reflect.get(value, name);
  return result;
}
function rawDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INTENT_DATABASE, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rawRecord(id: string): Promise<Record<string, unknown>> {
  const database = await rawDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('intents').objectStore('intents').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return object(value);
  } finally {
    database.close();
  }
}
async function writeRecord(record: Record<string, unknown>): Promise<void> {
  const database = await rawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('intents', 'readwrite');
      transaction.objectStore('intents').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
function uuid(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

const owner: DocumentIntentActor = {
  application: 'application-a',
  installationGeneration: 'generation-a',
  parentClient: 'browser-parent-a',
};
// These extra request claims must never replace controller-authenticated ownership
// or the store's minted identifiers.
const input: DocumentContentInput & {
  id: string;
  nonce: string;
  parentToken: string;
  application: string;
  installationGeneration: string;
  parentClient: string;
} = {
  kind: 'html',
  text: '<p>Private document body</p><script>globalThis.fixture=1</script>',
  sourceURL: 'https://publisher.invalid/document.html',
  aliases: [],
  id: 'caller-selected',
  nonce: 'caller-selected',
  parentToken: 'caller-selected',
  application: 'forged-owner',
  installationGeneration: 'forged-generation',
  parentClient: 'forged-parent',
};

window.runIntentProbe = async (): Promise<IntentProbe> => {
  const first = new DocumentIntentStore();
  const second = new DocumentIntentStore();
  const issued = await first.issue(owner, input);
  check(
    uuid(issued.id) && uuid(issued.nonce) && uuid(issued.parentToken),
    'Identifiers are not host UUIDs',
  );
  check(
    new Set([issued.id, issued.nonce, issued.parentToken]).size === 3,
    'Host identifiers reused',
  );
  check(
    issued.application === owner.application &&
      issued.installationGeneration === owner.installationGeneration &&
      issued.parentClient === owner.parentClient,
    'Request data chose owner',
  );
  check(!Object.hasOwn(issued, 'input'), 'Issue leaked body through metadata');
  const key = { id: issued.id, nonce: issued.nonce };
  check(
    !(await first.read(key, 'child-a', owner.installationGeneration)),
    'Issued body read before binding',
  );
  check(
    !(await first.bind(
      { ...key, nonce: crypto.randomUUID() },
      'wrong',
      owner.installationGeneration,
    )),
    'Wrong nonce bound',
  );
  check(!(await first.bind(key, 'wrong', 'stale-generation')), 'Stale generation bound');

  const bindings = await Promise.all([
    first.bind(key, 'child-a', owner.installationGeneration),
    second.bind(key, 'child-b', owner.installationGeneration),
  ]);
  const winners = bindings.filter(
    (value): value is DocumentIntentMetadata => value !== undefined,
  );
  check(winners.length === 1, 'Concurrent bind had multiple winners');
  const child = winners[0].childClient;
  if (!child) throw new Error('Bound intent has no browser client');
  check(
    !(await first.bind(key, child, owner.installationGeneration)),
    'Bound intent replay accepted',
  );
  check(
    !(await first.read(key, 'other-child', owner.installationGeneration)),
    'Wrong child read body',
  );
  check(
    !(await first.read(key, child, 'other-generation')),
    'Wrong generation read body',
  );
  const body = await second.read(key, child, owner.installationGeneration);
  check(
    body?.input.text === input.text && body.compiled.scripts.length === 1,
    'Compiler content did not survive storage',
  );
  for (const wrong of [
    { ...owner, parentClient: 'wrong-parent' },
    { ...owner, application: 'wrong-app' },
    { ...owner, installationGeneration: 'wrong-generation' },
  ])
    check(
      !(await second.close(issued.id, wrong, issued.parentToken)),
      'Wrong actor closed intent',
    );
  check(
    !(await second.close(issued.id, owner, crypto.randomUUID())),
    'Wrong parent token closed intent',
  );
  await first.disconnect();
  await second.disconnect();

  const replacement = new DocumentIntentStore();
  const concurrent = new DocumentIntentStore();
  check(
    (await replacement.inspect(issued.id))?.childClient === child,
    'Controller replacement lost binding',
  );
  const results = await Promise.all([
    replacement.consume(key, child, owner.installationGeneration),
    concurrent.consume(key, child, owner.installationGeneration),
  ]);
  const consumed = results.filter(
    (value): value is DocumentIntentContent => value !== undefined,
  );
  check(consumed.length === 1, 'Concurrent consume had multiple winners');
  check(consumed[0].metadata.state === 'consumed', 'Consume returned stale lifecycle');
  const purged = await rawRecord(issued.id);
  check(
    purged.state === 'consumed' && !Object.hasOwn(purged, 'input'),
    'Consume retained private body',
  );
  check(
    !(await replacement.read(key, child, owner.installationGeneration)),
    'Consumed body replayed',
  );
  check(
    !(await replacement.consume(key, child, owner.installationGeneration)),
    'Consume replayed',
  );
  check(
    !(await replacement.bind(key, 'late-child', owner.installationGeneration)),
    'Consumed intent rebound',
  );
  check(
    await replacement.close(issued.id, owner, issued.parentToken),
    'Owner could not revoke consumed intent',
  );

  const closeRace = await replacement.issue(owner, input);
  await Promise.all([
    replacement.close(closeRace.id, owner, closeRace.parentToken),
    concurrent.bind(closeRace, 'racing-child', owner.installationGeneration),
  ]);
  check(
    (await replacement.inspect(closeRace.id))?.state === 'closed',
    'Closure lost a concurrent bind race',
  );
  check(
    !(await replacement.bind(
      closeRace,
      'late-racing-child',
      owner.installationGeneration,
    )),
    'Concurrent closure replayed',
  );

  const fresh = await replacement.issue(owner, {
    ...input,
    kind: 'svg',
    text: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
  });
  check(fresh.id !== issued.id, 'Issue reused identifier');
  check(
    await replacement.close(fresh.id, owner, fresh.parentToken),
    'Owner could not revoke issued intent',
  );
  check(
    !Object.hasOwn(await rawRecord(fresh.id), 'input'),
    'Close retained private body',
  );
  await replacement.disconnect();
  const restarted = new DocumentIntentStore();
  check(
    (await restarted.inspect(fresh.id))?.state === 'closed',
    'Revocation lost on controller replacement',
  );
  check(
    !(await restarted.bind(fresh, 'late-child', owner.installationGeneration)),
    'Closed intent rebound',
  );
  const boundClose = await restarted.issue(owner, input);
  await restarted.bind(boundClose, 'close-child', owner.installationGeneration);
  check(
    await restarted.close(boundClose.id, owner, boundClose.parentToken),
    'Bound close failed',
  );
  check(
    !(await restarted.consume(boundClose, 'close-child', owner.installationGeneration)),
    'Closed bound body consumed',
  );

  const malformed = await restarted.issue(owner, input);
  const invalid = await rawRecord(malformed.id);
  invalid.policyVersion = -1;
  await writeRecord(invalid);
  check(
    await rejected(() => restarted.inspect(malformed.id)),
    'Unvalidated persisted policy trusted',
  );
  const malformedBody = await restarted.issue(owner, input);
  const invalidBody = await rawRecord(malformedBody.id);
  const invalidInput = object(invalidBody.input);
  invalidInput.aliases = [['https://publisher.invalid/a', 'javascript:alert(1)']];
  invalidBody.input = invalidInput;
  await writeRecord(invalidBody);
  check(
    await rejected(() => restarted.inspect(malformedBody.id)),
    'Invalid persisted alias trusted',
  );
  const malformedLifecycle = await restarted.issue(owner, input);
  const invalidLifecycle = await rawRecord(malformedLifecycle.id);
  invalidLifecycle.state = 'closed';
  await writeRecord(invalidLifecycle);
  check(
    await rejected(() => restarted.inspect(malformedLifecycle.id)),
    'Closed record retained input unnoticed',
  );
  const tamperedMarkup = await restarted.issue(owner, input);
  const invalidMarkup = await rawRecord(tamperedMarkup.id);
  const markupInput = object(invalidMarkup.input);
  markupInput.text = '<iframe src="javascript:alert(1)"></iframe>';
  invalidMarkup.input = markupInput;
  await writeRecord(invalidMarkup);
  await restarted.bind(tamperedMarkup, 'compiler-child', owner.installationGeneration);
  check(
    await rejected(() =>
      restarted.consume(tamperedMarkup, 'compiler-child', owner.installationGeneration),
    ),
    'Persisted markup bypassed compiler',
  );
  check(
    (await restarted.inspect(tamperedMarkup.id))?.state === 'bound',
    'Failed consume changed lifecycle',
  );

  const frame = document.createElement('iframe');
  frame.src = '/scoped.html';
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('Scoped storage fixture failed'));
    document.body.append(frame);
  });
  const childWindow = frame.contentWindow;
  if (!childWindow) throw new Error('Scoped storage fixture has no window');
  const scoped = await childWindow.runScopedIntentProbe();
  check(scoped.empty, 'App raw name reached private intent store');
  const databases = await indexedDB.databases();
  check(
    databases.some((database) => database.name === INTENT_DATABASE) &&
      databases.some(
        (database) => database.name === 'pf:application-a:' + INTENT_DATABASE,
      ),
    'Scoped and private databases were not separate',
  );
  frame.remove();
  await restarted.disconnect();
  await concurrent.disconnect();
  return {
    checks,
    bindWinners: winners.length,
    consumeWinners: consumed.length,
    privateNamespaced: scoped.empty,
    recordPurged: !Object.hasOwn(purged, 'input'),
  };
};
