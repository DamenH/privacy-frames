import { internalRecord } from '../../shared/primordials.ts';
export interface PublisherOwner {
  application: string;
  generation: string;
}
export interface PublisherRegistration extends PublisherOwner {
  id: string;
  script: string;
  scope: string;
  type: 'classic' | 'module';
  state: 'registered' | 'active' | 'closed';
  lifecycleCompleted: boolean;
}
export interface PublisherExecutor extends PublisherOwner {
  registration: string;
  browserClient: string;
  contextId: string;
  parentClient: string;
}
interface Grant extends PublisherOwner {
  id: string;
  registration: string;
  parentClient: string;
  expires: number;
}
const mint = crypto.randomUUID.bind(crypto);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function publisherId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('Invalid publisher-worker identifier');
  return value;
}
function same(left: PublisherOwner, right: PublisherOwner) {
  return left.application === right.application && left.generation === right.generation;
}
function key(owner: PublisherOwner) {
  return JSON.stringify([owner.application, owner.generation]);
}
function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error || new Error('Publisher-worker transaction aborted'));
    transaction.onerror = () => {};
  });
}
/** Host-private state. Neither publisher caches nor publisher IDs grant this role. */
export class PublisherStore {
  private database: Promise<IDBDatabase> | undefined;
  constructor(private readonly name = 'privacy-frames-publisher-workers-v1') {}
  private open() {
    if (!this.database)
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => {
          const registrations = request.result.createObjectStore(
            'registrations',
            internalRecord({
              keyPath: 'id',
            }),
          );
          registrations.createIndex(
            'owner',
            ['application', 'generation'],
            internalRecord({
              unique: true,
            }),
          );
          request.result.createObjectStore(
            'executors',
            internalRecord({ keyPath: 'registration' }),
          );
          request.result.createObjectStore('grants', internalRecord({ keyPath: 'id' }));
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            this.database = undefined;
          };
          resolve(request.result);
        };
        request.onerror = () => {
          this.database = undefined;
          reject(request.error);
        };
      });
    return this.database;
  }
  async registration(owner: PublisherOwner): Promise<PublisherRegistration | undefined> {
    const database = await this.open();
    const tx = database.transaction('registrations', 'readonly');
    const done = complete(tx);
    const value: PublisherRegistration | undefined = await read(
      tx
        .objectStore('registrations')
        .index('owner')
        .get([owner.application, owner.generation]),
    );
    await done;
    return value?.state === 'closed' ? undefined : value;
  }
  async byId(id: string): Promise<PublisherRegistration | undefined> {
    const database = await this.open();
    const tx = database.transaction('registrations', 'readonly');
    const done = complete(tx);
    const value: PublisherRegistration | undefined = await read(
      tx.objectStore('registrations').get(publisherId(id)),
    );
    await done;
    return value?.state === 'closed' ? undefined : value;
  }
  async register(
    owner: PublisherOwner,
    source: Pick<
      PublisherRegistration,
      'script' | 'scope' | 'type' | 'lifecycleCompleted'
    >,
  ) {
    const database = await this.open();
    const tx = database.transaction('registrations', 'readwrite');
    const done = complete(tx);
    const store = tx.objectStore('registrations');
    const prior: PublisherRegistration | undefined = await read(
      store.index('owner').get([owner.application, owner.generation]),
    );
    if (prior && prior.state !== 'closed') {
      if (
        prior.script !== source.script ||
        prior.scope !== source.scope ||
        prior.type !== source.type
      ) {
        tx.abort();
        await done.catch(() => {});
        throw new Error(
          'The foreground profile supports one active registration per application',
        );
      }
      await done;
      return prior;
    }
    if (prior) store.delete(prior.id);
    const value: PublisherRegistration = internalRecord({
      ...owner,
      ...source,
      id: mint(),
      state: 'registered',
    });
    store.put(value);
    await done;
    return value;
  }
  async activate(id: string, executor: PublisherExecutor) {
    const database = await this.open();
    const tx = database.transaction(['registrations', 'executors'], 'readwrite');
    const done = complete(tx);
    const store = tx.objectStore('registrations');
    const registration: PublisherRegistration | undefined = await read(
      store.get(publisherId(id)),
    );
    const bound: PublisherExecutor | undefined = await read(
      tx.objectStore('executors').get(id),
    );
    if (
      !registration ||
      registration.state === 'closed' ||
      !same(registration, executor) ||
      bound?.browserClient !== executor.browserClient ||
      bound.contextId !== executor.contextId
    ) {
      tx.abort();
      await done.catch(() => {});
      throw new Error('Publisher executor is not the current binding');
    }
    store.put(
      internalRecord({ ...registration, state: 'active', lifecycleCompleted: true }),
    );
    await done;
  }
  async grant(
    registration: PublisherRegistration,
    parentClient: string,
  ): Promise<string> {
    const database = await this.open();
    const tx = database.transaction(['registrations', 'grants'], 'readwrite');
    const done = complete(tx);
    const current: PublisherRegistration | undefined = await read(
      tx.objectStore('registrations').get(registration.id),
    );
    if (!current || current.state === 'closed' || key(current) !== key(registration)) {
      tx.abort();
      await done.catch(() => {});
      throw new Error('Publisher registration is unavailable');
    }
    const value: Grant = internalRecord({
      application: registration.application,
      generation: registration.generation,
      registration: registration.id,
      parentClient,
      id: mint(),
      expires: Date.now() + 15000,
    });
    tx.objectStore('grants').put(value);
    await done;
    return value.id;
  }
  async bind(executor: PublisherExecutor) {
    const database = await this.open();
    const tx = database.transaction(['registrations', 'executors'], 'readwrite');
    const done = complete(tx);
    const registration: PublisherRegistration | undefined = await read(
      tx.objectStore('registrations').get(publisherId(executor.registration)),
    );
    if (
      !registration ||
      registration.state === 'closed' ||
      !same(registration, executor)
    ) {
      tx.abort();
      await done.catch(() => {});
      throw new Error('Publisher binding leaves its application');
    }
    tx.objectStore('executors').put(executor);
    await done;
  }
  async executor(id: string): Promise<PublisherExecutor | undefined> {
    const database = await this.open();
    const tx = database.transaction('executors', 'readonly');
    const done = complete(tx);
    const result: PublisherExecutor | undefined = await read(
      tx.objectStore('executors').get(publisherId(id)),
    );
    await done;
    return result;
  }
  async consume(
    ticket: string,
    executor: PublisherExecutor,
  ): Promise<PublisherRegistration | undefined> {
    const database = await this.open();
    const tx = database.transaction(
      ['registrations', 'executors', 'grants'],
      'readwrite',
    );
    const done = complete(tx);
    const grants = tx.objectStore('grants');
    const grant: Grant | undefined = await read(grants.get(publisherId(ticket)));
    const bound: PublisherExecutor | undefined = await read(
      tx.objectStore('executors').get(executor.registration),
    );
    const registration: PublisherRegistration | undefined = await read(
      tx.objectStore('registrations').get(executor.registration),
    );
    const valid =
      grant &&
      registration &&
      registration.state !== 'closed' &&
      same(grant, executor) &&
      same(registration, executor) &&
      grant.registration === executor.registration &&
      grant.expires > Date.now() &&
      bound?.browserClient === executor.browserClient &&
      bound.contextId === executor.contextId;
    if (valid) grants.delete(ticket);
    await done;
    return valid ? registration : undefined;
  }
  async unregister(owner: PublisherOwner): Promise<boolean> {
    const database = await this.open();
    const tx = database.transaction(['registrations', 'executors'], 'readwrite');
    const done = complete(tx);
    const store = tx.objectStore('registrations');
    const value: PublisherRegistration | undefined = await read(
      store.index('owner').get([owner.application, owner.generation]),
    );
    if (value && value.state !== 'closed') {
      store.put(internalRecord({ ...value, state: 'closed' }));
      tx.objectStore('executors').delete(value.id);
    }
    await done;
    return !!value && value.state !== 'closed';
  }
}
