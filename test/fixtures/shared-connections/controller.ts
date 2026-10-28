import {
  SharedConnectionStore,
  type SharedConnectionActor,
} from '../../../src/runtime/contexts/shared-connections.ts';
import { sharedWorkerKey } from '../../../src/shared/shared-worker.ts';
import { CONNECTION_DATABASE, type SharedConnectionProbe } from './types.ts';

let checks = 0;
function check(value: unknown, message: string): asserts value {
  checks++;
  if (!value) throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected persisted record');
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) copy[key] = Reflect.get(value, key);
  return copy;
}
async function rejected(operation: () => unknown | Promise<unknown>) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONNECTION_DATABASE, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read(table: 'tickets' | 'workers', key: string) {
  const db = await database();
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.transaction(table).objectStore(table).get(key);
      request.onsuccess = () => resolve(object(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function write(table: 'tickets' | 'workers', value: Record<string, unknown>) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(table, 'readwrite');
      transaction.objectStore(table).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
const issuer: SharedConnectionActor = {
  application: 'application-a',
  installationGeneration: 'generation-a',
  client: 'issuer-a',
};
const key = (name: string, owner = issuer) =>
  sharedWorkerKey(owner, {
    source: 'https://publisher.invalid/worker.js',
    type: 'classic',
    name,
  });
const worker = (client: string): SharedConnectionActor => ({ ...issuer, client });

window.runSharedConnectionProbe = async (): Promise<SharedConnectionProbe> => {
  const first = new SharedConnectionStore();
  const second = new SharedConnectionStore();
  const winners: number[] = [];
  for (const sameClient of [true, false]) {
    const identity = key(sameClient ? 'same-client' : 'different-clients');
    const claim = { ...issuer, ticket: 'caller-selected' };
    const ticket = await first.issue(claim, identity);
    check(
      /^[0-9a-f-]{36}$/.test(ticket) && ticket !== claim.ticket,
      'Caller chose ticket',
    );
    const saved = await read('tickets', ticket);
    check(
      saved.client === issuer.client && saved.application === issuer.application,
      'Issue lost authenticated issuer',
    );
    check(
      typeof saved.expires === 'number' && saved.expires > Date.now(),
      'Ticket lacks expiry',
    );
    const outcomes = await Promise.all([
      first.consume(ticket, identity, worker('worker-' + identity)),
      second.consume(
        ticket,
        identity,
        worker(sameClient ? 'worker-' + identity : 'other-worker'),
      ),
    ]);
    winners.push(outcomes.filter(Boolean).length);
    check(
      outcomes.filter(Boolean).length === 1,
      'Concurrent consumers had multiple winners',
    );
    check(
      !(await first.consume(ticket, identity, worker('replay-worker'))),
      'Consumed ticket replayed',
    );
    const binding = await read('tickets', ticket);
    check(
      binding.state === 'consumed' && typeof binding.connection === 'string',
      'Consumption did not persist browser binding',
    );
  }

  const firstKey = key('first-binding');
  const firstTicket = await first.issue(issuer, firstKey);
  check(
    await first.consume(firstTicket, firstKey, worker('bound-worker')),
    'First key did not bind',
  );
  const otherKey = key('other-binding');
  const otherTicket = await first.issue(issuer, otherKey);
  check(
    !(await second.consume(otherTicket, otherKey, worker('bound-worker'))),
    'Existing worker consumed a different key',
  );
  check(
    await second.consume(otherTicket, otherKey, worker('different-worker')),
    'Rejected worker polluted another valid ticket',
  );
  const anotherIssuer = { ...issuer, client: 'issuer-b' };
  const sharedTicket = await first.issue(anotherIssuer, firstKey);
  check(
    await second.consume(sharedTicket, firstKey, worker('bound-worker')),
    'Same worker could not accept another issuer in its app',
  );
  check(
    !(await first.disconnect(sharedTicket, issuer)),
    'Wrong issuer disconnected connection',
  );
  check(
    await first.disconnect(sharedTicket, anotherIssuer),
    'Actual issuer could not disconnect',
  );
  check(
    !(await second.consume(sharedTicket, firstKey, worker('bound-worker'))),
    'Closed connection replayed',
  );

  const ticket = await first.issue(issuer, key('ownership'));
  const foreign = { ...issuer, application: 'application-b', client: 'foreign-worker' };
  const stale = {
    ...issuer,
    installationGeneration: 'generation-b',
    client: 'stale-worker',
  };
  check(
    !(await first.consume(ticket, key('ownership', foreign), foreign)),
    'Cross-app ticket consumed',
  );
  check(
    !(await first.consume(ticket, key('ownership', stale), stale)),
    'Cross-generation ticket consumed',
  );
  check(!(await first.disconnect(ticket, foreign)), 'Cross-app disconnect accepted');
  check(!(await first.disconnect(ticket, stale)), 'Cross-generation disconnect accepted');
  check(
    await rejected(() => first.issue(foreign, key('ownership'))),
    'Issue accepted foreign key',
  );
  check(await first.disconnect(ticket, issuer), 'Issuer could not revoke issued ticket');
  await first.close();
  await second.close();
  const replacement = new SharedConnectionStore();
  check(
    !(await replacement.consume(ticket, key('ownership'), worker('restart-worker'))),
    'Restart lost issued-ticket revocation',
  );
  check(
    !(await replacement.consume(firstTicket, firstKey, worker('restart-worker'))),
    'Restart lost consumption',
  );
  const afterRestart = await replacement.issue(issuer, otherKey);
  check(
    !(await replacement.consume(afterRestart, otherKey, worker('bound-worker'))),
    'Restart lost worker first-key binding',
  );

  const expired = await replacement.issue(issuer, key('expired'));
  const expiredRow = await read('tickets', expired);
  expiredRow.expires = Date.now() - 1;
  await write('tickets', expiredRow);
  check(
    !(await replacement.consume(expired, key('expired'), worker('expiry-worker'))),
    'Expired ticket consumed',
  );
  check(
    await replacement.disconnect(expired, issuer),
    'Expired issuer revocation failed',
  );
  for (const field of ['state', 'expires', 'connection', 'key']) {
    const identity = key('malformed-' + field);
    const invalidTicket = await replacement.issue(issuer, identity);
    const invalid = await read('tickets', invalidTicket);
    if (field === 'state') invalid.state = 'unknown';
    if (field === 'expires') invalid.expires = Number.NaN;
    if (field === 'connection') invalid.connection = crypto.randomUUID();
    if (field === 'key') invalid.key = key('malformed', foreign);
    await write('tickets', invalid);
    check(
      await rejected(() =>
        replacement.consume(invalidTicket, identity, worker('invalid-worker')),
      ),
      'Malformed persisted ' + field + ' was trusted',
    );
  }
  const brokenKey = key('malformed-worker');
  const brokenWorkerTicket = await replacement.issue(issuer, brokenKey);
  await write('workers', { ...worker('malformed-worker'), key: 'invalid-key' });
  check(
    await rejected(() =>
      replacement.consume(brokenWorkerTicket, brokenKey, worker('malformed-worker')),
    ),
    'Malformed worker binding was trusted',
  );
  check(
    (await read('tickets', brokenWorkerTicket)).state === 'issued',
    'Failed worker validation consumed ticket',
  );

  const racing = new SharedConnectionStore();
  const raceKey = key('close-race');
  const raceTicket = await replacement.issue(issuer, raceKey);
  await Promise.all([
    replacement.disconnect(raceTicket, issuer),
    racing.consume(raceTicket, raceKey, worker('race-worker')),
  ]);
  check(
    (await read('tickets', raceTicket)).state === 'closed',
    'Disconnect lost concurrent consume race',
  );
  check(
    !(await racing.consume(raceTicket, raceKey, worker('race-worker'))),
    'Disconnect race replayed',
  );
  const frame = document.createElement('iframe');
  frame.src = '/scoped.html';
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('Scoped fixture failed'));
    document.body.append(frame);
  });
  if (!frame.contentWindow) throw new Error('Scoped fixture missing Window');
  const scoped = await frame.contentWindow.runScopedSharedProbe();
  check(scoped.empty, 'App namespace reached private shared connections');
  const names = await indexedDB.databases();
  check(
    names.some((value) => value.name === CONNECTION_DATABASE) &&
      names.some((value) => value.name === 'pf:application-a:' + CONNECTION_DATABASE),
    'Namespaced and private stores were not distinct',
  );
  frame.remove();
  await replacement.close();
  await racing.close();
  return { checks, conflictingWinners: winners, privateNamespaced: scoped.empty };
};
