import type { Installation, PreparedInstallation } from '../shared/types.ts';

// This schema has no migration path. Metadata queries never load resource bodies.
const DATABASE = 'privacy-frames-installations';
const METADATA = 'installations';
const BODIES = 'resources';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(METADATA, { keyPath: 'id' });
      request.result.createObjectStore(BODIES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(store: string, key?: IDBValidKey): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, 'readonly');
      const request =
        key === undefined
          ? transaction.objectStore(store).getAll()
          : transaction.objectStore(store).get(key);
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export const getApp = (id: string) => read<Installation | undefined>(METADATA, id);
export const listApps = () => read<Installation[]>(METADATA);
export async function getResource(id: string, path: string): Promise<ArrayBuffer> {
  const bytes = await read<ArrayBuffer | undefined>(BODIES, [id, path]);
  if (!bytes) throw new Error('Installed resource missing');
  return bytes;
}

export async function putApp(app: PreparedInstallation): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([METADATA, BODIES], 'readwrite');
      const resources = transaction.objectStore(BODIES);
      resources.delete(IDBKeyRange.bound([app.id, ''], [app.id, '\uffff']));
      for (const resource of app.resources)
        resources.put(resource.bytes, [app.id, resource.path]);
      const metadata: Installation = {
        ...app,
        resources: app.resources.map(({ bytes: _bytes, ...resource }) => resource),
      };
      transaction.objectStore(METADATA).put(metadata);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function deleteApp(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([METADATA, BODIES], 'readwrite');
      transaction.objectStore(METADATA).delete(id);
      transaction.objectStore(BODIES).delete(IDBKeyRange.bound([id, ''], [id, '\uffff']));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
