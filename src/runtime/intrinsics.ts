import { internalSet, internalRecord, ownDescriptor } from '../shared/primordials.ts';

const descriptor = ownDescriptor;
const define = Object.defineProperty;
const ownKeys = Reflect.ownKeys;
const freeze = Object.freeze;
const hasOwn = Object.hasOwn;
const set = Reflect.set;
const NativeTypeError = TypeError;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const stringPrototype = String.prototype;
const stringIteratorPrototype: object = Object.getPrototypeOf(''[Symbol.iterator]());
const functionPrototype = Function.prototype;
const nativeFunctionSource = Function.prototype.toString;
const getPrototype = Object.getPrototypeOf;
const errorPrototype = Error.prototype;
const numberConstructor = Number;
const mathNamespace = globalThis.Math;
const reflectionNamespace = Reflect;
const extensibleCollections = internalSet<unknown>([Map.prototype, Set.prototype]);
const datePrototype = Date.prototype;

function mutableData(value: unknown): PropertyDescriptor {
  return internalRecord({ value, writable: true, configurable: true });
}

function materializeMissing(target: object, source: object, except?: PropertyKey) {
  for (const key of ownKeys(source))
    if (key !== except && !hasOwn(target, key))
      define(
        target,
        key,
        internalRecord({ ...descriptor(source, key)!, configurable: true }),
      );
}

function materializeAncestors(
  target: object,
  except?: PropertyKey,
  ancestors?: Set<object>,
) {
  for (let parent = getPrototype(target); parent; parent = getPrototype(parent)) {
    ancestors?.add(parent);
    materializeMissing(target, parent, except);
  }
}

/** Keep shared operations fixed while allowing ordinary own-instance overrides. */
function shadowableMethod(
  owner: object,
  key: PropertyKey,
  property: PropertyDescriptor,
  profile: 'collection' | 'intrinsic',
): PropertyDescriptor {
  const original = property.value;
  const accessor = internalRecord({
    get method() {
      return original;
    },
    set method(replacement: unknown) {
      const receiver: object = this;
      if (receiver === owner) {
        // Browser tooling temporarily writes an already-undefined toJSON.
        // Collections retain their stricter shared-prototype assignment rule.
        if (profile === 'intrinsic' && replacement === original) return;
        throw new NativeTypeError(
          profile === 'collection'
            ? 'Shared collection prototypes are immutable'
            : 'Existing intrinsic methods are protected',
        );
      }
      if (hasOwn(receiver, key)) {
        if (!set(receiver, key, replacement, receiver))
          throw new NativeTypeError('Instance property is immutable');
      } else
        define(
          receiver,
          key,
          internalRecord({ ...mutableData(replacement), enumerable: true }),
        );
    },
  });
  const pair = descriptor(accessor, 'method')!;
  define(pair.get!, 'originalValue', internalRecord({ value: original }));
  return internalRecord({
    get: pair.get,
    set: pair.set,
    enumerable: property.enumerable,
    configurable: profile === 'collection',
  });
}

export const languageGlobals = [
  'Object',
  'Function',
  'Array',
  'Number',
  'Boolean',
  'String',
  'Symbol',
  'BigInt',
  'RegExp',
  'Date',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'SuppressedError',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'JSON',
  'Math',
  'Reflect',
  'Intl',
  'Atomics',
  'WebAssembly',
  'Iterator',
];

/** Protect native operations while allowing new language-level metadata and methods. */
export function prepareRuntimeIntrinsics() {
  const nativeOperations = internalSet<object>();
  const errorConstructors = internalSet<object>();
  const originalGraph = new WeakSet<object>();
  function errorConstructor(value: object) {
    let prototype: unknown = descriptor(value, 'prototype')?.value;
    while (typeof prototype === 'object' && prototype !== null) {
      if (prototype === errorPrototype) return true;
      prototype = getPrototype(prototype);
    }
    return false;
  }
  function captureNativeOperations(value: unknown): void {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
      return;
    if (originalGraph.has(value)) return;
    originalGraph.add(value);
    if (typeof value === 'function' && errorConstructor(value))
      errorConstructors.add(value);
    else if (
      typeof value === 'function' &&
      Object.isExtensible(value) &&
      /\{\s*\[native code\]\s*\}/.test(Reflect.apply(nativeFunctionSource, value, []))
    )
      nativeOperations.add(value);
    for (const key of ownKeys(value)) {
      const property = descriptor(value, key)!;
      if ('value' in property) captureNativeOperations(property.value);
      else {
        captureNativeOperations(property.get);
        captureNativeOperations(property.set);
      }
    }
    captureNativeOperations(getPrototype(value));
  }
  // Capture public language operations before replacing any methods with private
  // shims. Function metadata cannot change a native operation's executable body.
  for (const name of languageGlobals)
    captureNativeOperations(Reflect.get(globalThis, name));
  // V8 reads this hook through the constructor's prototype chain. An own empty
  // value keeps newly added Object.prototype fields out of private stack traces.
  for (const constructor of errorConstructors)
    if (!hasOwn(constructor, 'prepareStackTrace'))
      define(
        constructor,
        'prepareStackTrace',
        internalRecord({ value: undefined, configurable: true }),
      );
  for (const key of ownKeys(Symbol)) {
    const value: unknown = descriptor(Symbol, key)?.value;
    if (typeof value === 'symbol' && !hasOwn(objectPrototype, value))
      define(objectPrototype, value, mutableData(undefined));
  }
  for (const key of ['then', 'toJSON'])
    define(objectPrototype, key, mutableData(undefined));
  // Browser promises can resolve native arrays before a trusted callback can
  // detach them from the application prototype. Reserve implicit hooks while
  // retaining ordinary own-instance shadowing below.
  for (const prototype of [arrayPrototype, stringPrototype, stringIteratorPrototype])
    for (const key of ['then', 'toJSON']) define(prototype, key, mutableData(undefined));
  const languageConstructors = internalSet<object>();
  for (const name of languageGlobals) {
    const constructor: unknown = Reflect.get(globalThis, name);
    if (typeof constructor !== 'function' || !hasOwn(constructor, 'prototype')) continue;
    // Error stack formatting has implementation-specific callback hooks. Keep
    // this family frozen instead of treating those hooks as ordinary metadata.
    if (errorConstructor(constructor)) continue;
    languageConstructors.add(constructor);
  }
  const isLanguageConstructor = (value: unknown) =>
    typeof value === 'function' && languageConstructors.has(value);
  const typedConstructors = internalSet<object>();
  const binaryPrototypes = internalSet<object>();
  for (const name of languageGlobals) {
    if (!/^(?:Int|Uint|Float|BigInt|BigUint)\d+(?:Clamped)?Array$/.test(name)) continue;
    const constructor = Reflect.get(globalThis, name);
    if (typeof constructor === 'function') {
      typedConstructors.add(constructor);
      binaryPrototypes.add(constructor.prototype);
    }
  }
  if (typeof DataView === 'function') binaryPrototypes.add(DataView.prototype);
  const binaryObjects = internalSet<unknown>(binaryPrototypes);
  const metadataFunctions = internalSet<object>([
    ...languageConstructors,
    ...nativeOperations,
  ]);
  for (const constructor of metadataFunctions) {
    for (const key of [
      'then',
      Symbol.species,
      Symbol.toPrimitive,
      Symbol.isConcatSpreadable,
      Symbol.iterator,
      Symbol.asyncIterator,
      ...(languageConstructors.has(constructor) ? [] : ['toJSON']),
    ])
      if (!(key in constructor)) define(constructor, key, mutableData(undefined));
    if (!hasOwn(constructor, Symbol.hasInstance))
      define(
        constructor,
        Symbol.hasInstance,
        mutableData(functionPrototype[Symbol.hasInstance]),
      );
  }
  const objectSetPrototype = Object.setPrototypeOf;
  const reflectSetPrototype = Reflect.setPrototypeOf;
  const protectedPrototype = (value: unknown) =>
    value === objectPrototype ||
    value === arrayPrototype ||
    value === stringPrototype ||
    value === stringIteratorPrototype ||
    value === functionPrototype ||
    value === mathNamespace ||
    value === reflectionNamespace ||
    extensibleCollections.has(value) ||
    isLanguageConstructor(value) ||
    (typeof value === 'function' && nativeOperations.has(value)) ||
    binaryObjects.has(value);
  Object.setPrototypeOf = function (target, prototype) {
    if (protectedPrototype(target) && Object.getPrototypeOf(target) !== prototype)
      throw new NativeTypeError('Intrinsic prototype ancestry is protected');
    return objectSetPrototype(target, prototype);
  };
  Reflect.setPrototypeOf = function (target, prototype) {
    if (protectedPrototype(target) && Object.getPrototypeOf(target) !== prototype)
      return false;
    return reflectSetPrototype(target, prototype);
  };
  const legacy = descriptor(Object.prototype, '__proto__');
  if (legacy?.set) {
    const original = legacy.set;
    define(
      Object.prototype,
      '__proto__',
      internalRecord({
        ...legacy,
        set(value: unknown) {
          if (protectedPrototype(this) && Object.getPrototypeOf(this) !== value)
            throw new NativeTypeError('Intrinsic prototype ancestry is protected');
          return Reflect.apply(original, this, [value]);
        },
      }),
    );
  }
  for (const constructor of [...metadataFunctions, reflectionNamespace])
    materializeAncestors(
      constructor,
      isLanguageConstructor(constructor) ? 'toJSON' : undefined,
    );
  for (const key of [
    'then',
    'toJSON',
    Symbol.toPrimitive,
    Symbol.isConcatSpreadable,
    Symbol.iterator,
    Symbol.asyncIterator,
    Symbol.hasInstance,
  ])
    if (!hasOwn(reflectionNamespace, key))
      define(reflectionNamespace, key, mutableData(undefined));
  for (const prototype of [Map.prototype, Set.prototype]) {
    materializeMissing(prototype, objectPrototype, 'toJSON');
    for (const key of [
      'then',
      Symbol.toPrimitive,
      Symbol.isConcatSpreadable,
      Symbol.asyncIterator,
    ])
      if (!hasOwn(prototype, key)) define(prototype, key, mutableData(undefined));
  }
  // Metadata extensions must not shadow native operations inherited by binary
  // views. Materialize the same descriptors on each concrete prototype first.
  const binaryAncestors = internalSet<object>();
  for (const prototype of binaryPrototypes) {
    materializeAncestors(prototype, undefined, binaryAncestors);
    for (const key of [
      'then',
      'toJSON',
      Symbol.toPrimitive,
      Symbol.isConcatSpreadable,
      Symbol.iterator,
      Symbol.asyncIterator,
    ])
      if (!hasOwn(prototype, key)) define(prototype, key, mutableData(undefined));
  }
  for (const constructor of typedConstructors)
    binaryAncestors.add(Object.getPrototypeOf(constructor));
  for (const prototype of [
    Map.prototype,
    Set.prototype,
    WeakMap.prototype,
    WeakSet.prototype,
  ]) {
    for (const key of ownKeys(prototype)) {
      const property = descriptor(prototype, key)!;
      if (
        key === 'constructor' ||
        !property.configurable ||
        !('value' in property) ||
        typeof property.value !== 'function'
      )
        continue;
      define(prototype, key, shadowableMethod(prototype, key, property, 'collection'));
    }
  }
  const prototypes = internalSet<object>();
  for (const name of languageGlobals) {
    const constructor = Reflect.get(globalThis, name);
    if (typeof constructor === 'function' && constructor.prototype)
      prototypes.add(constructor.prototype);
  }
  // Iterator methods need the same own-instance shadowing as collection methods.
  // Identify every shared iterator prototype before recursive hardening reaches it.
  const iteratorPrototypes = internalSet<object>();
  for (const iterator of [
    [][Symbol.iterator](),
    ''[Symbol.iterator](),
    new Map()[Symbol.iterator](),
    internalSet()[Symbol.iterator](),
    /x/g[Symbol.matchAll]('x'),
    (function* () {})(),
    (async function* () {})(),
  ]) {
    for (
      let prototype = Object.getPrototypeOf(iterator);
      prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      // Older iterator libraries install an own identity when it is merely
      // inherited. Preserve the existing callable identity before freezing;
      // async-only chains and Object.prototype receive no new iteration hook.
      if (!hasOwn(prototype, Symbol.iterator)) {
        const identity: unknown = Reflect.get(prototype, Symbol.iterator);
        if (typeof identity === 'function')
          define(prototype, Symbol.iterator, mutableData(identity));
      }
      prototypes.add(prototype);
      iteratorPrototypes.add(prototype);
    }
  }
  for (const prototype of binaryAncestors) prototypes.add(prototype);
  const seen = new WeakSet<object>();
  function visit(value: unknown): void {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
      return;
    if (seen.has(value)) return;
    seen.add(value);
    const extendable =
      value === objectPrototype ||
      value === arrayPrototype ||
      value === stringPrototype ||
      value === functionPrototype ||
      value === mathNamespace ||
      value === reflectionNamespace ||
      extensibleCollections.has(value) ||
      isLanguageConstructor(value) ||
      (typeof value === 'function' && nativeOperations.has(value)) ||
      binaryObjects.has(value);
    for (const key of ownKeys(value)) {
      const property = descriptor(value, key)!;
      if (value === mathNamespace) {
        if ('value' in property) visit(property.value);
        continue;
      }
      if (
        value === stringPrototype &&
        typeof key === 'string' &&
        key !== 'constructor' &&
        'value' in property &&
        typeof property.value === 'function'
      ) {
        visit(property.value);
        continue;
      }
      // This standard diagnostic hook is replaced by otherwise ordinary
      // polyfills. Enforcement never relies on its result for authorization.
      if (value === functionPrototype && key === 'toString') continue;
      // Static polyfill generics replace inherited diagnostic methods on the
      // public constructor, without changing native instance operations.
      if (
        isLanguageConstructor(value) &&
        (key === 'toString' || key === 'toLocaleString')
      ) {
        if ('value' in property) visit(property.value);
        continue;
      }
      if (value === numberConstructor && (key === 'parseInt' || key === 'parseFloat'))
        continue;
      if ('value' in property) visit(property.value);
      else {
        visit(property.get);
        visit(property.set);
      }
      // Firefox's privileged structured-result serializer depends on native Date
      // method data descriptors. Keep those intact; freezing still protects them.
      if (
        value !== datePrototype &&
        (prototypes.has(value) || extendable) &&
        property.configurable
      ) {
        if ('value' in property) {
          const replacement = shadowableMethod(value, key, property, 'intrinsic');
          visit(replacement.get);
          visit(replacement.set);
          define(value, key, replacement);
        } else define(value, key, internalRecord({ ...property, configurable: false }));
      }
    }
    if (!extendable) freeze(value);
  }
  for (const ancestor of binaryAncestors) visit(ancestor);
  for (const name of languageGlobals) visit(Reflect.get(globalThis, name));
  // Async/generator constructor families are reachable through function objects.
  visit(Object.getPrototypeOf(async function () {}));
  visit(Object.getPrototypeOf(function* () {}));
  visit(Object.getPrototypeOf(async function* () {}));
  for (const prototype of iteratorPrototypes) visit(prototype);
}
