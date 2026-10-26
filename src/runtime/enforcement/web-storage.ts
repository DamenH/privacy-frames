import type { PolicyTools } from './native.ts';

/** Scope Web Storage and its event-carried references to this installation. */
export function scopeWebStorage(prefix: string, tools: PolicyTools) {
  const { apply, descriptor, method, accessor, propertyOwner, deny, str, nativeAdd } =
    tools;
  const storageViews = new Map<Storage, Storage>();
  for (const key of ['localStorage', 'sessionStorage']) {
    const owner = propertyOwner(window, key),
      d = descriptor(owner!, key)!,
      native = apply(d!.get!, window, []);
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem,
      remove = Storage.prototype.removeItem,
      keyAt = Storage.prototype.key;
    const length = descriptor(Storage.prototype, 'length')!.get!;
    const keys = () => {
      const result: string[] = [];
      for (let i = 0; i < apply(length, native, []); i++) {
        const k = apply(keyAt, native, [i]);
        if (k?.startsWith(prefix)) result.push(k.slice(prefix.length));
      }
      return result;
    };
    const text = (value: unknown) => {
      if (typeof value === 'symbol')
        throw new TypeError('Storage strings cannot be symbols');
      return str(value);
    };
    const required = (count: number, minimum: number) => {
      if (count < minimum) throw new TypeError('Missing required Storage argument');
    };
    const api = Object.freeze({
      getItem: function (k: unknown) {
        required(arguments.length, 1);
        return apply(get, native, [prefix + text(k)]);
      },
      setItem: function (k: unknown, v: unknown) {
        required(arguments.length, 2);
        return apply(set, native, [prefix + text(k), text(v)]);
      },
      removeItem: function (k: unknown) {
        required(arguments.length, 1);
        return apply(remove, native, [prefix + text(k)]);
      },
      clear: () => keys().forEach((k) => apply(remove, native, [prefix + k])),
      key: function (i: unknown) {
        required(arguments.length, 1);
        return keys()[+(i as number) >>> 0] ?? null;
      },
    });
    const proxy: Storage = new Proxy(Object.create(Storage.prototype), {
      get: (target, k) =>
        k === 'length'
          ? keys().length
          : Object.hasOwn(api, k)
            ? api[k as keyof typeof api]
            : typeof k === 'string' && keys().includes(k as string)
              ? api.getItem(k)
              : Reflect.get(target, k),
      set: (_, k, v) => {
        if (typeof k !== 'string') return false;
        api.setItem(k, v);
        return true;
      },
      deleteProperty: (_, k) => {
        if (typeof k === 'string') api.removeItem(k);
        return true;
      },
      has: (target, k) =>
        (typeof k === 'string' && keys().includes(k)) || Reflect.has(target, k),
      ownKeys: keys,
      getOwnPropertyDescriptor: (_, k) =>
        keys().includes(k as string)
          ? {
              enumerable: true,
              configurable: true,
              writable: true,
              value: api.getItem(k),
            }
          : undefined,
      defineProperty: (_, k, d) => {
        if (
          typeof k !== 'string' ||
          !('value' in d) ||
          d.configurable === false ||
          d.enumerable === false ||
          d.writable === false
        )
          return false;
        api.setItem(k, d.value);
        return true;
      },
      preventExtensions: () => false,
      setPrototypeOf: () => false,
    });
    accessor(owner!, key, { get: () => proxy });
    storageViews.set(native, proxy);
  }
  // Storage events carry a native Storage reference independently of the window
  // getters. Filter before application listeners and mediate every exposed field.
  if (globalThis.StorageEvent) {
    const eventStorage = descriptor(StorageEvent.prototype, 'storageArea')!.get!;
    const eventKey = descriptor(StorageEvent.prototype, 'key')!.get!;
    const stop = Event.prototype.stopImmediatePropagation;
    const belongs = (event: StorageEvent) => {
      const area = apply(eventStorage, event, []),
        key = apply(eventKey, event, []);
      return storageViews.has(area) && typeof key === 'string' && key.startsWith(prefix);
    };
    apply(nativeAdd, window, [
      'storage',
      (event: StorageEvent) => {
        if (!belongs(event)) apply(stop, event, []);
      },
      { capture: true },
    ]);
    accessor(StorageEvent.prototype, 'storageArea', {
      get(this: StorageEvent) {
        return storageViews.get(apply(eventStorage, this, [])) ?? null;
      },
    });
    accessor(StorageEvent.prototype, 'key', {
      get(this: StorageEvent) {
        const key = apply(eventKey, this, []);
        return belongs(this) ? key.slice(prefix.length) : null;
      },
    });
    for (const key of ['oldValue', 'newValue', 'url']) {
      const get = descriptor(StorageEvent.prototype, key)!.get!;
      accessor(StorageEvent.prototype, key, {
        get(this: StorageEvent) {
          return belongs(this) ? apply(get, this, []) : key === 'url' ? '' : null;
        },
      });
    }
  }
  // Storage Access handles can expose native storage through another API.
  for (const key of ['requestStorageAccess', 'requestStorageAccessFor'])
    method(Document.prototype, key, deny);
  for (const key of [
    'requestFileSystem',
    'webkitRequestFileSystem',
    'resolveLocalFileSystemURL',
    'webkitResolveLocalFileSystemURL',
    'openDatabase',
  ])
    method(window, key, deny);
  for (const key of ['getItem', 'setItem', 'removeItem', 'clear', 'key'])
    method(Storage.prototype, key, deny);
}
