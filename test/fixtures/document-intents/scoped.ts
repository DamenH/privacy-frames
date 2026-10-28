import { createPolicyTools } from '../../../src/runtime/enforcement/native.ts';
import { scopeIndexedDB } from '../../../src/runtime/storage/indexed-db.ts';
import { INTENT_DATABASE, type ScopedIntentProbe } from './types.ts';

scopeIndexedDB({ prefix: 'pf:application-a:', ...createPolicyTools() });

window.runScopedIntentProbe = (): Promise<ScopedIntentProbe> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(INTENT_DATABASE);
    request.onsuccess = () => {
      const database = request.result;
      const empty = database.objectStoreNames.length === 0;
      database.close();
      resolve({ empty });
    };
    request.onerror = () => reject(request.error);
  });
