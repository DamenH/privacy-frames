/** Native patch operations stay private to the trusted bootstrap bundle. */
export function createPolicyTools() {
  const apply = Reflect.apply;
  const descriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;

  function fail(message: string): never {
    throw new DOMException(message, 'SecurityError');
  }

  function deny(): never {
    return fail('Operation prohibited by application host');
  }

  function method(owner: object, key: PropertyKey, replacement: Function) {
    const existing = descriptor(owner, key);
    if (!existing || existing.value === replacement) return;
    if (!existing.configurable && (!('value' in existing) || !existing.writable)) {
      throw new Error(`Cannot protect ${String(key)}`);
    }
    define(owner, key, {
      value: replacement,
      writable: false,
      configurable: false,
      enumerable: existing.enumerable,
    });
  }

  function accessor(owner: object, key: PropertyKey, replacement: PropertyDescriptor) {
    const existing = descriptor(owner, key);
    if (!existing) return;
    if (!existing.configurable) throw new Error(`Cannot protect ${String(key)}`);
    define(owner, key, { ...existing, ...replacement, configurable: false });
  }

  function propertyOwner(object: object, key: PropertyKey): object | undefined {
    for (
      let prototype = object;
      prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      if (Object.hasOwn(prototype, key)) return prototype;
    }
  }

  return {
    apply,
    descriptor,
    define,
    method,
    accessor,
    propertyOwner,
    fail,
    deny,
    str: String,
    array: Array.from,
    nativeAdd: EventTarget.prototype.addEventListener,
  };
}

export type PolicyTools = ReturnType<typeof createPolicyTools>;
