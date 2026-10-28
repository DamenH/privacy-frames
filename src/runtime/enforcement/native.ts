import {
  internalArray,
  internalMap,
  ownDescriptor,
  internalRecord,
} from '../../shared/primordials.ts';

const nativeArrayFrom = Array.from;

/** Native patch operations stay private to the trusted bootstrap bundle. */
export function createPolicyTools() {
  const apply = Reflect.apply;
  const descriptor = ownDescriptor;
  const define = Object.defineProperty;
  const getPrototype = Object.getPrototypeOf;
  const hasOwn = Object.hasOwn;
  const NativeError = Error;
  const NativeDOMException = typeof DOMException === 'function' ? DOMException : null;
  const denials = new WeakMap<
    object,
    Map<PropertyKey, Partial<Record<'method' | 'get' | 'set', Function>>>
  >();

  function fail(message: string): never {
    if (NativeDOMException) throw new NativeDOMException(message, 'SecurityError');
    const error = new NativeError(message);
    define(error, 'name', internalRecord({ value: 'SecurityError' }));
    throw error;
  }

  function deny(): never {
    return fail('Operation prohibited by application host');
  }
  function denial(
    owner: object,
    key: PropertyKey,
    kind: 'method' | 'get' | 'set',
  ): Function {
    let properties = denials.get(owner);
    if (!properties) {
      properties = internalMap<
        PropertyKey,
        Partial<Record<'method' | 'get' | 'set', Function>>
      >();
      denials.set(owner, properties);
    }
    let entry = properties.get(key);
    if (!entry) {
      entry = internalRecord({});
      properties.set(key, entry);
    }
    if (!entry[kind]) {
      const message = 'Operation ' + String(key) + ' prohibited by application host';
      entry[kind] = function () {
        return fail(message);
      };
    }
    return entry[kind]!;
  }

  function method(owner: object, key: PropertyKey, replacement: Function) {
    if (replacement === deny) replacement = denial(owner, key, 'method');
    const existing = descriptor(owner, key);
    if (!existing || existing.value === replacement) return;
    if (!existing.configurable && (!('value' in existing) || !existing.writable)) {
      throw new Error(`Cannot protect ${String(key)}`);
    }
    define(
      owner,
      key,
      internalRecord({
        value: replacement,
        writable: false,
        configurable: false,
        enumerable: existing.enumerable,
      }),
    );
  }

  function accessor(owner: object, key: PropertyKey, replacement: PropertyDescriptor) {
    if (replacement.get === deny)
      replacement = internalRecord({
        ...replacement,
        get: denial(owner, key, 'get') as () => never,
      });
    if (replacement.set === deny)
      replacement = internalRecord({
        ...replacement,
        set: denial(owner, key, 'set') as () => never,
      });
    const existing = descriptor(owner, key);
    if (!existing) return;
    if (!existing.configurable) {
      if (
        Object.entries(replacement).every(
          ([name, value]) => Reflect.get(existing, name) === value,
        )
      )
        return;
      throw new NativeError(`Cannot protect ${String(key)}`);
    }
    define(
      owner,
      key,
      internalRecord({ ...existing, ...replacement, configurable: false }),
    );
  }

  function propertyOwner(object: object, key: PropertyKey): object | undefined {
    for (let prototype = object; prototype; prototype = getPrototype(prototype)) {
      if (hasOwn(prototype, key)) return prototype;
    }
  }

  return internalRecord({
    apply,
    descriptor,
    define,
    method,
    accessor,
    propertyOwner,
    fail,
    deny,
    str: String,
    array<T>(input: Iterable<T> | ArrayLike<T>): T[] {
      return internalArray(nativeArrayFrom(input));
    },
    nativeAdd:
      typeof EventTarget === 'function' ? EventTarget.prototype.addEventListener : deny,
  });
}

export type PolicyTools = ReturnType<typeof createPolicyTools>;
