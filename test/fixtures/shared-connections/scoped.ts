import { createPolicyTools } from '../../../src/runtime/enforcement/native.ts';
import { scopeIndexedDB } from '../../../src/runtime/storage/indexed-db.ts';
import { CONNECTION_DATABASE } from './types.ts';

scopeIndexedDB({ prefix: 'pf:application-a:', ...createPolicyTools() });
window.runScopedSharedProbe = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(CONNECTION_DATABASE);
    request.onsuccess = () => {
      const database = request.result;
      const empty = database.objectStoreNames.length === 0;
      database.close();
      resolve({ empty });
    };
    request.onerror = () => reject(request.error);
  });
