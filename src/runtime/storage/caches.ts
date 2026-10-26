import type { PolicyTools } from '../enforcement/native.ts';

type CacheTools = Pick<PolicyTools, 'method' | 'apply'> & { prefix: string };

export function scopeCaches({ prefix, method, apply }: CacheTools): CacheStorage {
  const factory = caches;
  const native = {
    open: CacheStorage.prototype.open,
    has: CacheStorage.prototype.has,
    delete: CacheStorage.prototype.delete,
    keys: CacheStorage.prototype.keys,
    match: CacheStorage.prototype.match,
  };

  for (const key of ['open', 'has', 'delete'] as const) {
    method(CacheStorage.prototype, key, function (this: CacheStorage, name?: unknown) {
      if (!arguments.length) throw new TypeError('Cache name is required');
      return apply(native[key], this, [prefix + String(name)]);
    });
  }

  method(CacheStorage.prototype, 'keys', async function (this: CacheStorage): Promise<
    string[]
  > {
    const names = await apply(native.keys, this, []);
    return names
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length));
  });

  method(
    CacheStorage.prototype,
    'match',
    async function (
      this: CacheStorage,
      request: RequestInfo | URL,
      options: MultiCacheQueryOptions = {},
    ): Promise<Response | undefined> {
      if (options.cacheName !== undefined) {
        return apply(native.match, this, [
          request,
          { ...options, cacheName: prefix + String(options.cacheName) },
        ]);
      }

      const names = await apply(native.keys, this, []);
      for (const name of names.filter((name) => name.startsWith(prefix))) {
        const response = await apply(native.match, this, [
          request,
          { ...options, cacheName: name },
        ]);
        if (response) return response;
      }
    },
  );
  return factory;
}
