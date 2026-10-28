import { ownDescriptor, internalRecord } from '../../shared/primordials.ts';
import {
  parseSharedWorkerKey,
  type SharedWorkerConnection,
} from '../../shared/shared-worker.ts';

export interface SharedConnectionActor {
  application: string;
  installationGeneration: string;
  client: string;
}
interface Ticket extends SharedConnectionActor {
  ticket: string;
  key: string;
  state: 'issued' | 'consumed' | 'closed';
  expires: number;
  worker?: string;
  connection?: string;
}
interface WorkerBinding extends SharedConnectionActor {
  key: string;
}
const mint = crypto.randomUUID.bind(crypto);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATABASE = 'privacy-frames-shared-connections-v1';
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid shared connection record');
  const property = ownDescriptor(value, key);
  if (!property) return undefined;
  if (!('value' in property)) throw new Error('Shared connection accessors are not data');
  return property.value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 32768)
    throw new Error('Invalid shared connection identity');
  return value;
}
function actor(value: unknown): SharedConnectionActor {
  return internalRecord({
    application: string(field(value, 'application')),
    installationGeneration: string(field(value, 'installationGeneration')),
    client: string(field(value, 'client')),
  });
}
function sameApplication(left: SharedConnectionActor, right: SharedConnectionActor) {
  return (
    left.application === right.application &&
    left.installationGeneration === right.installationGeneration
  );
}
function checkedKey(value: unknown, owner: SharedConnectionActor): string {
  const key = string(value);
  const decoded = parseSharedWorkerKey(key);
  if (
    !decoded ||
    decoded.application !== owner.application ||
    decoded.installationGeneration !== owner.installationGeneration
  )
    throw new Error('Shared connection key leaves its application');
  return key;
}
function ticketRecord(value: unknown): Ticket {
  const owner = actor(value);
  const ticket = field(value, 'ticket'),
    state = field(value, 'state'),
    expires = field(value, 'expires');
  const worker = field(value, 'worker'),
    connection = field(value, 'connection');
  if (
    typeof ticket !== 'string' ||
    !UUID.test(ticket) ||
    (state !== 'issued' && state !== 'consumed' && state !== 'closed') ||
    typeof expires !== 'number' ||
    !Number.isSafeInteger(expires) ||
    expires <= 0
  )
    throw new Error('Invalid shared connection ticket');
  if (
    (worker === undefined) !== (connection === undefined) ||
    (state === 'issued' && (worker !== undefined || connection !== undefined)) ||
    (state === 'consumed' && worker === undefined) ||
    (connection !== undefined &&
      (typeof connection !== 'string' || !UUID.test(connection)))
  )
    throw new Error('Invalid shared connection lifecycle binding');
  return internalRecord({
    ...owner,
    ticket,
    key: checkedKey(field(value, 'key'), owner),
    state,
    expires,
    ...(worker === undefined
      ? internalRecord({})
      : internalRecord({ worker: string(worker) })),
    ...(connection === undefined
      ? internalRecord({})
      : internalRecord({ connection: string(connection) })),
  });
}
function workerRecord(value: unknown): WorkerBinding {
  const owner = actor(value);
  return internalRecord({ ...owner, key: checkedKey(field(value, 'key'), owner) });
}

/** One-use connection grants remain private and survive controller replacement. */
export class SharedConnectionStore {
  private database: Promise<IDBDatabase> | undefined;
  private readonly databaseName: string;
  constructor(databaseName = DATABASE) {
    this.databaseName = databaseName;
  }
  private open() {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(
            'tickets',
            internalRecord({ keyPath: 'ticket' }),
          );
          request.result.createObjectStore(
            'workers',
            internalRecord({ keyPath: 'client' }),
          );
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.database = undefined;
          };
          resolve(database);
        };
      });
      this.database.catch(() => {
        this.database = undefined;
      });
    }
    return this.database;
  }
  private async mutate<T>(
    operation: (
      tickets: IDBObjectStore,
      workers: IDBObjectStore,
      finish: (result: T) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(['tickets', 'workers'], 'readwrite');
      let result: T;
      let finished = false;
      let failure: unknown;
      transaction.oncomplete = () =>
        finished
          ? resolve(result)
          : reject(new Error('Shared connection transaction did not finish'));
      transaction.onabort = () =>
        reject(
          failure ||
            transaction.error ||
            new Error('Shared connection transaction failed'),
        );
      const fail = (error: unknown) => {
        failure = error;
        transaction.abort();
      };
      try {
        operation(
          transaction.objectStore('tickets'),
          transaction.objectStore('workers'),
          (value) => {
            result = value;
            finished = true;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  }
  async issue(authenticated: SharedConnectionActor, key: string): Promise<string> {
    const owner = actor(authenticated);
    const value: Ticket = internalRecord({
      ...owner,
      key: checkedKey(key, owner),
      ticket: mint(),
      state: 'issued',
      expires: Date.now() + 120000,
    });
    return this.mutate((tickets, _workers, finish) => {
      tickets.add(value);
      finish(value.ticket);
    });
  }
  async consume(
    ticket: string,
    key: string,
    authenticated: SharedConnectionActor,
  ): Promise<SharedWorkerConnection | undefined> {
    const owner = actor(authenticated);
    checkedKey(key, owner);
    if (!UUID.test(ticket)) return;
    return this.mutate((tickets, workers, finish, fail) => {
      const request = tickets.get(ticket);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) return finish(undefined);
          const value = ticketRecord(request.result);
          if (value.ticket !== ticket)
            throw new Error('Shared connection ticket key mismatch');
          if (
            value.state !== 'issued' ||
            value.expires <= Date.now() ||
            value.key !== key ||
            !sameApplication(value, owner)
          )
            return finish(undefined);
          const binding = workers.get(owner.client);
          binding.onsuccess = () => {
            try {
              if (binding.result !== undefined) {
                const existing = workerRecord(binding.result);
                if (
                  !sameApplication(existing, owner) ||
                  existing.key !== key ||
                  existing.client !== owner.client
                )
                  return finish(undefined);
              } else workers.add(internalRecord({ ...owner, key }));
              const connection = mint();
              tickets.put(
                internalRecord({
                  ...value,
                  state: 'consumed',
                  worker: owner.client,
                  connection,
                }),
              );
              finish(
                internalRecord({
                  application: owner.application,
                  installationGeneration: owner.installationGeneration,
                  key,
                  connection,
                }),
              );
            } catch (error) {
              fail(error);
            }
          };
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async disconnect(
    ticket: string,
    authenticated: SharedConnectionActor,
  ): Promise<boolean> {
    const owner = actor(authenticated);
    if (!UUID.test(ticket)) return false;
    return this.mutate((tickets, _workers, finish, fail) => {
      const request = tickets.get(ticket);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) return finish(false);
          const value = ticketRecord(request.result);
          if (value.ticket !== ticket)
            throw new Error('Shared connection ticket key mismatch');
          if (!sameApplication(value, owner) || value.client !== owner.client)
            return finish(false);
          tickets.put(internalRecord({ ...value, state: 'closed' }));
          finish(true);
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async close(): Promise<void> {
    const connection = this.database;
    this.database = undefined;
    if (connection) (await connection).close();
  }
}
