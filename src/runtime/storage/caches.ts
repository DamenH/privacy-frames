import { strings, internalArray, internalRecord } from '../../shared/primordials.ts';
import type { PolicyTools } from '../enforcement/native.ts';
type CacheTools = Pick<PolicyTools, 'method' | 'apply'> & {
  prefix: string;
};
export function scopeCaches({ prefix, method, apply }: CacheTools): CacheStorage {
  const factory = caches;
  const native = internalRecord({
    open: CacheStorage.prototype.open,
    has: CacheStorage.prototype.has,
    delete: CacheStorage.prototype.delete,
    keys: CacheStorage.prototype.keys,
    match: Cache.prototype.match,
  });
  for (const key of ['open', 'has', 'delete'] as const) {
    method(CacheStorage.prototype, key, function (this: CacheStorage, name?: unknown) {
      if (!arguments.length) throw new TypeError('Cache name is required');
      return apply(native[key], this, [prefix + String(name)]);
    });
  }
  method(CacheStorage.prototype, 'keys', async function (this: CacheStorage): Promise<
    string[]
  > {
    const names = internalArray<string>(await apply(native.keys, this, []));
    return names
      .filter((name) => strings.startsWith(name, prefix))
      .map((name) => strings.slice(name, prefix.length));
  });
  method(
    CacheStorage.prototype,
    'match',
    async function (
      this: CacheStorage,
      request: RequestInfo | URL,
      options: MultiCacheQueryOptions = internalRecord({}),
    ): Promise<Response | undefined> {
      const names = internalArray<string>(await apply(native.keys, this, []));
      const candidates =
        options.cacheName === undefined
          ? names.filter((name) => strings.startsWith(name, prefix))
          : names.filter((name) => name === prefix + String(options.cacheName));
      for (const name of candidates) {
        const cache = await apply(native.open, this, [name]);
        const response = await apply(native.match, cache, [request, options]);
        if (response) return response;
      }
    },
  );
  return factory;
}
