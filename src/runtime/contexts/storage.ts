import type { PolicyTools } from '../enforcement/native.ts';
import { scopeCaches } from '../storage/caches.ts';
import { scopeIndexedDB } from '../storage/indexed-db.ts';

/** Window and worker realms use the same application storage authority. */
export function scopeContextStorage(
  application: string,
  tools: PolicyTools,
  target: object = globalThis,
) {
  const { method, accessor, descriptor, apply, fail, propertyOwner } = tools;
  const prefix = `pf:${application}:`;
  const caches = scopeCaches({ prefix, method, apply });
  const cacheOwner = propertyOwner(target, 'caches');
  if (!cacheOwner) throw new Error('Cache Storage is required');
  accessor(cacheOwner, 'caches', { get: () => caches });
  const databases = scopeIndexedDB({ prefix, method, accessor, descriptor, apply, fail });
  for (const key of ['indexedDB', 'webkitIndexedDB', 'mozIndexedDB', 'msIndexedDB']) {
    const owner = propertyOwner(target, key);
    if (owner) accessor(owner, key, { get: () => databases });
  }
}
