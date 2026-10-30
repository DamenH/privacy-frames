import {
  languageGlobals,
  prepareRuntimeIntrinsics,
} from '../../../src/runtime/intrinsics.ts';
import {
  internalArray,
  internalRecord,
  ownDescriptor,
  internalData,
  internalMap,
  internalSet,
} from '../../../src/shared/primordials.ts';

interface IntrinsicsProbe {
  checks: number;
  shadowedMethods: number;
  nativeFunctions: number;
  observedReceivers: number;
  originalTypeErrorFrozen: boolean;
  errorStackTypes: { shim: string; public: string };
  nativeStackHookCalls: number;
  nativeInheritedStackHookCalls: number;
}
declare global {
  interface Window {
    runIntrinsicsProbe(): Promise<IntrinsicsProbe>;
  }
}
const collections = [
  { name: 'Map', prototype: Map.prototype, make: () => new Map() },
  { name: 'Set', prototype: Set.prototype, make: () => new Set() },
  { name: 'WeakMap', prototype: WeakMap.prototype, make: () => new WeakMap() },
  { name: 'WeakSet', prototype: WeakSet.prototype, make: () => new WeakSet() },
];
const originalTypeError = TypeError;
const capturedFunctionToString = Function.prototype.toString;
const outsideLanguageFunctionKeys = Reflect.ownKeys(fetch);
const originalFunctions: Function[] = [];
for (const collection of collections)
  for (const key of Reflect.ownKeys(collection.prototype)) {
    const property = Object.getOwnPropertyDescriptor(collection.prototype, key);
    if (
      key !== 'constructor' &&
      property &&
      'value' in property &&
      typeof property.value === 'function'
    )
      originalFunctions.push(property.value);
  }
const originalMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get;
const originalSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get;
const privateKey = {};
const privateHostMap = new WeakMap<object, number>();
privateHostMap.set(privateKey, 41);
const privateBytes = new Uint8Array([11, 29]);
const privateView = new DataView(privateBytes.buffer);
const privateMap = internalMap<string, number>([['private', 43]]);
const privateSet = internalSet([47]);
const privatePromise = Promise.resolve(privateKey);
const capturedPromiseThen = Promise.prototype.then;
let nativeStackHookCalls = 0;
const previousStackFormatter = Object.getOwnPropertyDescriptor(
  Error,
  'prepareStackTrace',
);
Object.defineProperty(Error, 'prepareStackTrace', {
  value() {
    nativeStackHookCalls++;
    return 'native formatter control';
  },
  configurable: true,
});
void new Error('native stack formatting control').stack;
if (previousStackFormatter)
  Object.defineProperty(Error, 'prepareStackTrace', previousStackFormatter);
else Reflect.deleteProperty(Error, 'prepareStackTrace');
let nativeInheritedStackHookCalls = 0;
Object.defineProperty(Object.prototype, 'prepareStackTrace', {
  value() {
    nativeInheritedStackHookCalls++;
    return 'inherited formatter control';
  },
  configurable: true,
});
void new Error('native inherited stack formatting control').stack;
Reflect.deleteProperty(Object.prototype, 'prepareStackTrace');
prepareRuntimeIntrinsics();

window.runIntrinsicsProbe = async () => {
  let checks = 0,
    shadowedMethods = 0;
  const observed = internalArray<unknown>();
  const check = (value: unknown, message: string) => {
    checks++;
    if (!value) throw new Error(message);
  };
  const denied = (operation: () => unknown) => {
    try {
      return operation() === false;
    } catch {
      return true;
    }
  };
  for (const collection of collections) {
    check(
      collection.name === 'Map' || collection.name === 'Set'
        ? Object.isExtensible(collection.prototype)
        : Object.isFrozen(collection.prototype),
      collection.name + ' prototype extension profile changed',
    );
    const instance = collection.make();
    for (const key of Reflect.ownKeys(collection.prototype)) {
      if (key === 'constructor') continue;
      const property = Object.getOwnPropertyDescriptor(collection.prototype, key)!;
      const value = Reflect.get(instance, key);
      if (typeof value !== 'function') continue;
      check(
        typeof property.get === 'function' && typeof property.set === 'function',
        'Method did not become a paired override accessor',
      );
      check(
        !property.configurable && !property.enumerable,
        'Intrinsic method flags changed',
      );
      check(
        Object.isFrozen(property.get) && Object.isFrozen(property.set),
        'Accessor functions are mutable',
      );
      const original = Object.getOwnPropertyDescriptor(property.get!, 'originalValue');
      check(
        original !== undefined &&
          original.value === value &&
          !original.writable &&
          !original.configurable,
        'Original native function is not retained immutably',
      );
      check(Object.isExtensible(value), 'Original native operation metadata unavailable');
      check(Reflect.set(instance, key, value), 'Own instance self-assignment failed');
      const own = Object.getOwnPropertyDescriptor(instance, key)!;
      check(
        own.value === value && own.writable && own.configurable && own.enumerable,
        'Instance shadowing is not ordinary assignment',
      );
      shadowedMethods++;
      const spy = function (this: unknown) {
        observed.push(this);
      };
      check(
        denied(() => Reflect.set(collection.prototype, key, spy)),
        'Shared prototype accepted assignment',
      );
      check(
        !Reflect.defineProperty(collection.prototype, key, { value: spy }),
        'Shared prototype accepted redefinition',
      );
      check(
        denied(() => Reflect.apply(property.set!, collection.prototype, [spy])),
        'Direct setter changed shared prototype',
      );
      check(
        denied(() => Reflect.set(property.get!, 'originalValue', spy)),
        'Original native reference changed',
      );
      check(
        denied(() => Reflect.set(value, 'call', spy)),
        'Original native function accepted own override',
      );
      for (const frozen of [false, true]) {
        const receiver = collection.make();
        if (frozen) Object.freeze(receiver);
        else Object.preventExtensions(receiver);
        check(
          denied(() => Reflect.set(receiver, key, value)),
          'Nonextensible/frozen instance gained own method',
        );
        check(!Object.hasOwn(receiver, key), 'Failed assignment left an own method');
      }
      const readonly = collection.make();
      Object.defineProperty(readonly, key, {
        value,
        writable: false,
        configurable: true,
      });
      check(
        denied(() => Reflect.apply(property.set!, readonly, [spy])),
        'Direct setter clobbered readonly own method',
      );
      check(
        Object.getOwnPropertyDescriptor(readonly, key)!.value === value,
        'Readonly own method changed',
      );
      const readonlyAccessor = collection.make();
      Object.defineProperty(readonlyAccessor, key, {
        get: () => value,
        configurable: true,
      });
      check(
        denied(() => Reflect.apply(property.set!, readonlyAccessor, [spy])),
        'Direct setter clobbered readonly own accessor',
      );
      check(
        typeof Object.getOwnPropertyDescriptor(readonlyAccessor, key)!.get === 'function',
        'Readonly accessor became data',
      );
    }
  }
  // Legacy iterator detection replaces next on an instance, not on the shared
  // iterator prototype. Rejecting that ordinary assignment causes false polyfills.
  const input = [7];
  const iterator = input[Symbol.iterator]();
  let consumed = false;
  iterator.next = () => {
    consumed = true;
    return { done: true, value: undefined };
  };
  input[Symbol.iterator] = () => iterator;
  check(Array.from(input).length === 0 && consumed, 'Array.from iterator probe failed');
  check(Object.hasOwn(iterator, 'next'), 'Iterator next could not be shadowed');
  const iteratorPrototype = Object.getPrototypeOf(iterator);
  check(Object.isFrozen(iteratorPrototype), 'Shared array iterator prototype is mutable');
  check(
    denied(() => Reflect.set(iteratorPrototype, 'next', () => ({ done: true }))),
    'Shared iterator next replacement admitted',
  );
  check(
    denied(() =>
      Object.defineProperty(iteratorPrototype, 'next', { value: () => ({ done: true }) }),
    ),
    'Shared iterator next redefinition admitted',
  );
  const closing = [7][Symbol.iterator]();
  let closed = false;
  Object.defineProperty(closing, 'return', {
    value() {
      closed = true;
      return { done: true };
    },
  });
  try {
    Array.from(closing, () => {
      throw new Error('close iterator');
    });
  } catch {}
  check(closed, 'Array.from failed native iterator closing');
  const map = new Map<string, number>();
  map.get = map.get;
  map.has = map.has;
  map.set = map.set;
  map.set('value', 17);
  check(map.has('value') && map.get('value') === 17, 'Map operations broke');
  const set = new Set<number>();
  set.add = set.add;
  set.has = set.has;
  set.add(19);
  check(set.has(19), 'Set operations broke');
  const key = {};
  const weak = new WeakMap<object, number>();
  weak.get = weak.get;
  weak.has = weak.has;
  weak.set = weak.set;
  weak.set(key, 23);
  check(weak.has(key) && weak.get(key) === 23, 'WeakMap operations broke');
  const weakSet = new WeakSet<object>();
  weakSet.add = weakSet.add;
  weakSet.has = weakSet.has;
  weakSet.add(key);
  check(weakSet.has(key), 'WeakSet operations broke');
  check(
    Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get === originalMapSize,
    'Map size accessor changed',
  );
  check(
    Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get === originalSetSize,
    'Set size accessor changed',
  );
  check(map.size === 1 && set.size === 1, 'Native collection size broke');
  for (const native of [
    ...originalFunctions,
    Array.prototype.values,
    Array.prototype.keys,
    Array.prototype.entries,
  ]) {
    const annotation = Symbol('native operation source annotation');
    Object.defineProperty(native, annotation, {
      value: 'source annotation',
      configurable: true,
    });
    check(
      Reflect.get(native, annotation) === 'source annotation',
      'Public native operation metadata unavailable',
    );
    Reflect.deleteProperty(native, annotation);
    for (const key of [
      'name',
      'length',
      'caller',
      'arguments',
      'call',
      'apply',
      'bind',
      'then',
      'toJSON',
      Symbol.hasInstance,
      Symbol.species,
      Symbol.toPrimitive,
    ])
      check(
        !Reflect.defineProperty(native, key, {
          get() {
            observed.push(this);
          },
        }),
        'Native operation accepted an executable/protocol override',
      );
    check(!Reflect.setPrototypeOf(native, {}), 'Native operation ancestry changed');
  }
  check(
    Object.isExtensible(Object.prototype),
    'Application object extensions unavailable',
  );
  check(Object.isExtensible(Array.prototype), 'Application array extensions unavailable');
  const extension = Symbol('application extension');
  Object.defineProperty(Array.prototype, extension, {
    value: () => 71,
    configurable: true,
  });
  check(
    Reflect.apply(Reflect.get([], extension), [], []) === 71,
    'Array extension failed',
  );
  Reflect.deleteProperty(Array.prototype, extension);
  const textIterator = Object.getPrototypeOf('x'[Symbol.iterator]());
  check(Object.isFrozen(textIterator), 'Shared text iterator prototype is mutable');
  check(
    Object.hasOwn(textIterator, Symbol.iterator),
    'Native text iterator identity was not installed',
  );
  check(
    denied(() =>
      Object.defineProperty(textIterator, Symbol.iterator, {
        value() {
          return this;
        },
      }),
    ),
    'Shared text iterator identity replacement admitted',
  );
  check(
    Object.hasOwn(iteratorPrototype, Symbol.iterator),
    'Native array iterator identity was not installed',
  );
  check(
    Reflect.get(Object.prototype, Symbol.iterator) === undefined,
    'Object.prototype became iterable',
  );
  const asyncIterator = (async function* () {})();
  check(
    Reflect.get(asyncIterator, Symbol.iterator) === undefined,
    'Async-only iterator became synchronously iterable',
  );
  check(
    [...'ab'[Symbol.iterator]()].join('') === 'ab',
    'Native text iterator identity broke text iteration',
  );
  check(
    !Reflect.defineProperty(textIterator, 'next', { value: () => ({ done: true }) }),
    'Native string iterator next was replaced',
  );
  const metadata = Symbol('constructor metadata');
  const element = document.createElement('div');
  const channel = new MessageChannel();
  const elementPrototype = Object.getPrototypeOf(element);
  const portPrototype = Object.getPrototypeOf(channel.port1);
  const nativeRecords = internalData({ element, port: channel.port1 });
  check(
    nativeRecords.element === element &&
      Object.getPrototypeOf(element) === elementPrototype &&
      nativeRecords.port === channel.port1 &&
      Object.getPrototypeOf(channel.port1) === portPrototype,
    'Trusted data normalization changed native DOM/MessagePort instances',
  );
  channel.port1.close();
  channel.port2.close();
  for (const name of languageGlobals) {
    const constructor: unknown = Reflect.get(globalThis, name);
    if (typeof constructor !== 'function' || !Object.hasOwn(constructor, 'prototype'))
      continue;
    if (constructor === Error || constructor.prototype instanceof Error) {
      check(Object.isFrozen(constructor), 'Error constructor became extensible');
      check(
        !Reflect.defineProperty(constructor, 'prepareStackTrace', {
          value(...values: unknown[]) {
            observed.push(...values);
          },
        }),
        'Error constructor accepted a stack formatting callback',
      );
      continue;
    }
    const originalKeys = Reflect.ownKeys(constructor);
    const marker = Symbol('language constructor metadata');
    Object.defineProperty(constructor, marker, { value: 59, configurable: true });
    check(Reflect.get(constructor, marker) === 59, name + ' static metadata unavailable');
    Reflect.deleteProperty(constructor, marker);
    for (const key of originalKeys) {
      if (key === 'toString' || key === 'toLocaleString') continue;
      if (constructor === Number && (key === 'parseInt' || key === 'parseFloat'))
        continue;
      check(
        !Reflect.defineProperty(constructor, key, {
          get() {
            observed.push(this);
          },
        }),
        name + ' existing static member changed',
      );
    }
    for (const key of ['toString', 'toLocaleString', 'toJSON']) {
      const original = Object.getOwnPropertyDescriptor(constructor, key);
      let publicReceiver: unknown;
      Object.defineProperty(constructor, key, {
        value: function (this: unknown) {
          publicReceiver = this;
          return name;
        },
        configurable: true,
        writable: true,
      });
      const value =
        key === 'toJSON'
          ? JSON.stringify(constructor)
          : Reflect.apply(Reflect.get(constructor, key), constructor, []);
      check(
        value === (key === 'toJSON' ? JSON.stringify(name) : name) &&
          publicReceiver === constructor,
        name + ' static diagnostic generic unavailable',
      );
      check(
        Reflect.apply(capturedFunctionToString, constructor, []).includes(
          '[native code]',
        ),
        name + ' diagnostic override affected captured native validation',
      );
      if (original) Object.defineProperty(constructor, key, original);
      else Reflect.deleteProperty(constructor, key);
    }
    check(
      !Reflect.setPrototypeOf(constructor, {}),
      name + ' constructor ancestry changed',
    );
  }
  const privateErrorReceiver = { secret: 61 };
  const privateStack = Reflect.apply(
    function () {
      return new Error('private runtime error').stack;
    },
    privateErrorReceiver,
    [],
  );
  check(typeof privateStack === 'string', 'Private error stack formatting changed');
  for (const constructor of [
    WebAssembly.CompileError,
    WebAssembly.LinkError,
    WebAssembly.RuntimeError,
  ]) {
    check(
      Object.isFrozen(constructor),
      'Nested native Error constructor became extensible',
    );
    check(
      !Reflect.defineProperty(constructor, 'prepareStackTrace', {
        value(...values: unknown[]) {
          observed.push(...values);
        },
      }),
      'Nested native Error constructor accepted stack callbacks',
    );
  }
  check(
    Reflect.ownKeys(fetch).join(',') === outsideLanguageFunctionKeys.join(','),
    'Browser function outside the language graph received metadata policy',
  );
  const promiseOperations = Reflect.ownKeys(Promise);
  Object.defineProperty(Promise, 'finally', {
    value: Function.call.bind(Promise.prototype.finally),
    configurable: true,
  });
  let applicationFinalized = false;
  const genericFinallyResult = Reflect.apply(Reflect.get(Promise, 'finally'), Promise, [
    Promise.resolve(53),
    () => {
      applicationFinalized = true;
    },
  ]);
  check(
    (await genericFinallyResult) === 53 && applicationFinalized,
    'Static promise finally generic failed',
  );
  for (const key of [
    ...promiseOperations.filter((key) => key !== 'toString' && key !== 'toLocaleString'),
    'then',
    'call',
    'apply',
    'bind',
    Symbol.toPrimitive,
    Symbol.hasInstance,
    Symbol.species,
  ])
    check(
      !Reflect.defineProperty(Promise, key, {
        get() {
          observed.push(this);
        },
      }),
      'Promise constructor accepted a native/implicit hook override',
    );
  check(!Reflect.setPrototypeOf(Promise, {}), 'Promise constructor ancestry changed');
  check(Object.isFrozen(Promise.prototype), 'Promise prototype became mutable');
  for (const key of ['then', 'catch', 'finally', 'toJSON'])
    check(
      !Reflect.defineProperty(Promise.prototype, key, {
        value() {
          observed.push(this);
        },
      }),
      'Private promise prototype accepted an application hook',
    );
  check(
    await Reflect.apply(capturedPromiseThen, privatePromise, [
      (value: unknown) => value === privateKey,
    ]),
    'Private promise lifecycle changed',
  );
  for (const constructor of [Map, Set, WeakMap, WeakSet]) {
    for (const key of ['from', 'of', 'toJSON']) {
      const marker = function () {
        return 'application static extension';
      };
      Object.defineProperty(constructor, key, { value: marker, configurable: true });
      check(
        Reflect.get(constructor, key) === marker,
        'Collection static extension unavailable',
      );
    }
    for (const key of [
      'prototype',
      'call',
      'apply',
      'bind',
      'then',
      Symbol.hasInstance,
      Symbol.species,
      Symbol.toPrimitive,
    ])
      check(
        !Reflect.defineProperty(constructor, key, {
          get() {
            observed.push(this);
          },
        }),
        'Collection constructor accepted a protected override',
      );
    check(
      !Reflect.setPrototypeOf(constructor, {}),
      'Collection constructor ancestry changed',
    );
  }
  let publicSerializations = 0;
  for (const prototype of [Map.prototype, Set.prototype]) {
    Object.defineProperty(prototype, 'toJSON', {
      value: function (this: Map<unknown, unknown> | Set<unknown>) {
        publicSerializations++;
        if (this === privateMap || this === privateSet) observed.push(this);
        return Array.from(this.values());
      },
      configurable: true,
      writable: true,
    });
    for (const key of ['then', Symbol.asyncIterator, Symbol.toPrimitive, Symbol.iterator])
      check(
        !Reflect.defineProperty(prototype, key, {
          get() {
            observed.push(this);
          },
        }),
        'Shared collection accepted an implicit/iteration hook',
      );
    check(!Reflect.setPrototypeOf(prototype, {}), 'Shared collection ancestry changed');
  }
  check(
    JSON.stringify(new Map([['public', 5]])) === '[5]' &&
      JSON.stringify(new Set([7])) === '[7]' &&
      publicSerializations === 2,
    'Public collection serialization extension failed',
  );
  check(
    JSON.stringify({ map: privateMap, set: privateSet }) === '{"map":{},"set":{}}' &&
      publicSerializations === 2,
    'Application serialization observed private collection',
  );
  check(
    (await Promise.resolve(privateMap)) === privateMap &&
      (await Promise.resolve(privateSet)) === privateSet,
    'Private collections changed during promise resolution',
  );
  for (const record of [privateMap, privateSet]) {
    check(
      Object.isFrozen(Object.getPrototypeOf(record)),
      'Private collection prototype mutable',
    );
    check(
      Object.getPrototypeOf(Object.getPrototypeOf(record)) === null,
      'Private collection inherits public hooks',
    );
    check(
      Reflect.get(record, 'then') === undefined &&
        Reflect.get(record, 'toJSON') === undefined &&
        Reflect.get(record, Symbol.asyncIterator) === undefined,
      'Private collection acquired an application protocol',
    );
    const iterator = record.values();
    check(
      !Reflect.defineProperty(Object.getPrototypeOf(iterator), 'next', {
        value() {
          observed.push(this);
        },
      }),
      'Private collection iterator next was replaced',
    );
  }
  check(
    privateMap.get('private') === 43 &&
      [...privateMap.values()][0] === 43 &&
      privateSet.has(47) &&
      [...privateSet][0] === 47,
    'Private collection operations changed',
  );
  const reflectionOperations = Reflect.ownKeys(Reflect);
  Object.defineProperty(Reflect, 'enumerate', {
    value: (target: object) => Object.keys(target)[Symbol.iterator](),
    configurable: true,
  });
  check(
    Reflect.apply(Reflect.get(Reflect, 'enumerate'), Reflect, [{ field: 1 }]).next()
      .value === 'field',
    'Reflection namespace extension unavailable',
  );
  for (const key of [
    ...reflectionOperations,
    'then',
    'toJSON',
    'toString',
    'valueOf',
    Symbol.toPrimitive,
    Symbol.iterator,
    Symbol.hasInstance,
  ])
    check(
      !Reflect.defineProperty(Reflect, key, {
        get() {
          observed.push(this);
        },
      }),
      'Reflection namespace accepted a native operation or implicit hook override',
    );
  check(!Reflect.setPrototypeOf(Reflect, {}), 'Reflection namespace ancestry changed');
  const sourceAnnotation = Symbol('polyfill source annotation');
  const arrayStringifier = Array.prototype.toString;
  Object.defineProperty(arrayStringifier, sourceAnnotation, {
    value: 'native stringifier',
    configurable: true,
  });
  check(
    Reflect.get(Uint8Array.prototype.toString, sourceAnnotation) === 'native stringifier',
    'Native array/typed-array stringifier metadata unavailable',
  );
  for (const key of [
    'name',
    'length',
    'call',
    'apply',
    'bind',
    'then',
    'toJSON',
    Symbol.toPrimitive,
    Symbol.hasInstance,
  ])
    check(
      !Reflect.defineProperty(arrayStringifier, key, {
        get() {
          observed.push(this);
        },
      }),
      'Native stringifier accepted a callable/implicit hook override',
    );
  check(
    !Reflect.setPrototypeOf(arrayStringifier, {}),
    'Native stringifier ancestry changed',
  );
  check(
    Reflect.apply(arrayStringifier, privateBytes, []) === '11,29',
    'Native stringifier annotation changed private view operation',
  );
  for (const name of 'pop,reverse,shift,keys,values,entries,indexOf,every,some,forEach,map,filter,find,findIndex,includes,join,slice,concat,push,splice,unshift,sort,lastIndexOf,reduce,reduceRight,copyWithin,fill'.split(
    ',',
  )) {
    const operation: unknown = Reflect.get(Array.prototype, name);
    if (typeof operation !== 'function') continue;
    Object.defineProperty(Array, name, {
      value: Function.call.bind(operation),
      configurable: true,
    });
    check(
      typeof Reflect.get(Array, name) === 'function',
      'Static array generic unavailable',
    );
  }
  check(
    Reflect.apply(Reflect.get(Array, 'slice'), Array, [[1, 2], 1])[0] === 2,
    'Static array slice generic failed',
  );
  Object.defineProperty(ArrayBuffer, 'slice', {
    value: Function.call.bind(ArrayBuffer.prototype.slice),
    configurable: true,
  });
  check(
    Reflect.apply(Reflect.get(ArrayBuffer, 'slice'), ArrayBuffer, [
      privateBytes.buffer,
      1,
    ]).byteLength === 1,
    'Static buffer generic failed',
  );
  for (const constructor of [Array, ArrayBuffer]) {
    check(
      !Reflect.setPrototypeOf(constructor, {}),
      'Static extension constructor ancestry changed',
    );
    for (const key of [
      'then',
      'call',
      'apply',
      'bind',
      Symbol.hasInstance,
      Symbol.species,
      Symbol.toPrimitive,
      Symbol.iterator,
    ])
      check(
        !Reflect.defineProperty(constructor, key, {
          value() {
            observed.push(this);
          },
        }),
        'Static extension constructor accepted a protected override',
      );
  }
  check(
    !Reflect.defineProperty(Array, 'from', {
      value() {
        observed.push(this);
      },
    }) &&
      !Reflect.defineProperty(Array, 'isArray', {
        value() {
          observed.push(this);
        },
      }) &&
      !Reflect.defineProperty(ArrayBuffer, 'isView', {
        value() {
          observed.push(this);
        },
      }),
    'Static native binary/array operations changed',
  );
  // Typed-view polyfills attach per-constructor and per-prototype metadata.
  // That does not grant permission to shadow inherited native buffer operations.
  for (const name of [
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
  ]) {
    const constructor: unknown = Reflect.get(globalThis, name);
    if (typeof constructor !== 'function') continue;
    const prototype: object = constructor.prototype;
    const originalLocaleGeneric = Object.getOwnPropertyDescriptor(
      constructor,
      'toLocaleString',
    );
    Object.defineProperty(constructor, 'toLocaleString', {
      value: Function.call.bind(Reflect.get(prototype, 'toLocaleString')),
      configurable: true,
      writable: true,
    });
    const publicView = Reflect.construct(constructor, [2]);
    check(
      Reflect.apply(Reflect.get(constructor, 'toLocaleString'), constructor, [
        publicView,
      ]) === Reflect.apply(Reflect.get(prototype, 'toLocaleString'), publicView, []),
      'Static typed-array locale generic failed',
    );
    if (originalLocaleGeneric)
      Object.defineProperty(constructor, 'toLocaleString', originalLocaleGeneric);
    for (const target of [constructor, prototype]) {
      const marker = Symbol('binary view metadata');
      Object.defineProperty(target, marker, { value: true, configurable: true });
      check(Reflect.get(target, marker) === true, 'Binary metadata unavailable');
      Reflect.deleteProperty(target, marker);
      check(!Reflect.setPrototypeOf(target, {}), 'Binary intrinsic ancestry changed');
      for (const key of [
        'then',
        ...(target === prototype ? ['toJSON'] : []),
        Symbol.toPrimitive,
        Symbol.isConcatSpreadable,
      ])
        check(
          !Reflect.defineProperty(target, key, {
            value() {
              observed.push(this);
            },
          }),
          'Binary intrinsic accepted an implicit hook',
        );
    }
    check(
      Object.isFrozen(Object.getPrototypeOf(prototype)),
      'Common typed-array prototype is mutable',
    );
    for (const key of [
      'buffer',
      'byteLength',
      'length',
      'set',
      'subarray',
      'values',
      'toString',
      'toLocaleString',
      Symbol.iterator,
    ]) {
      check(Object.hasOwn(prototype, key), 'Inherited binary member was not protected');
      check(
        !Reflect.defineProperty(prototype, key, {
          get() {
            observed.push(this);
          },
        }),
        'Binary prototype accepted a native member shadow',
      );
    }
    for (const key of ['from', 'of', Symbol.species, Symbol.hasInstance])
      check(
        !Reflect.defineProperty(constructor, key, {
          value() {
            observed.push(this);
          },
        }),
        'Binary constructor accepted a native static override',
      );
  }
  const viewMarker = Symbol('view metadata');
  Object.defineProperty(DataView.prototype, viewMarker, {
    value: true,
    configurable: true,
  });
  check(Reflect.get(privateView, viewMarker) === true, 'DataView metadata unavailable');
  Reflect.deleteProperty(DataView.prototype, viewMarker);
  for (const key of [
    'buffer',
    'byteLength',
    'getUint8',
    'then',
    'toJSON',
    Symbol.iterator,
  ])
    check(
      !Reflect.defineProperty(DataView.prototype, key, {
        get() {
          observed.push(this);
        },
      }),
      'DataView prototype accepted a protected override',
    );
  const applicationBytes = new Uint8Array([3]);
  class ApplicationByteSubclass extends Uint8Array {}
  check(
    Uint8Array[Symbol.species] === Uint8Array &&
      new ApplicationByteSubclass([3]).subarray(0) instanceof ApplicationByteSubclass,
    'Inherited native typed-array species behavior changed',
  );
  applicationBytes.set = () => undefined;
  check(
    Object.hasOwn(applicationBytes, 'set'),
    'Typed-array instance method shadow failed',
  );
  check(
    privateBytes.buffer.byteLength === 2 &&
      privateBytes.byteLength === 2 &&
      privateBytes.length === 2 &&
      privateBytes.subarray(1)[0] === 29 &&
      privateView.getUint8(0) === 11 &&
      Uint8Array.from(privateBytes)[1] === 29 &&
      [...privateBytes].join(',') === '11,29',
    'Private binary operations changed',
  );
  Object.defineProperty(Object, metadata, { value: 71, configurable: true });
  check(Reflect.get(Object, metadata) === 71, 'Native constructor metadata unavailable');
  Reflect.deleteProperty(Object, metadata);
  check(
    !Reflect.defineProperty(Object, Symbol.hasInstance, { value: () => true }),
    'Constructor brand hook was replaced',
  );
  check(
    denied(() => Reflect.set(Object, 'then', () => undefined)),
    'Constructor then hook was replaced',
  );
  check(
    privateHostMap.get(privateKey) === 41 && privateHostMap.has(privateKey),
    'Private host WeakMap behavior changed',
  );
  check(
    !Object.hasOwn(privateHostMap, 'get') && !Object.hasOwn(privateHostMap, 'set'),
    'Prototype attempt wrote private host methods',
  );
  check(observed.length === 0, 'Application observed private receiver');
  let shimStack = 'no-error';
  try {
    Reflect.set(Map.prototype, 'get', () => undefined);
  } catch (error) {
    if (error && typeof error === 'object')
      shimStack = typeof Reflect.get(error, 'stack');
  }
  const publicError = new TypeError('public fixture error');
  check(Object.isFrozen(originalTypeError), 'Captured error constructor is mutable');
  const dateMethod = Object.getOwnPropertyDescriptor(Date.prototype, 'toJSON');
  check(
    dateMethod &&
      typeof dateMethod.value === 'function' &&
      !dateMethod.get &&
      !dateMethod.writable &&
      !dateMethod.configurable,
    'Native Date method descriptor changed',
  );
  check(
    JSON.stringify({ date: new Date(0) }) === '{"date":"1970-01-01T00:00:00.000Z"}',
    'Native Date serialization broke',
  );
  const installed = internalArray<PropertyKey>();
  const privateAuthority = internalRecord({ application: 'expected' });
  const publicControl = { application: 'control' };
  const publicArray: unknown[] = [];
  let nativeGetterHits = 0,
    nativeProxyHits = 0,
    nativeIndexHits = 0;
  function install(key: PropertyKey, property: PropertyDescriptor) {
    Object.defineProperty(Object.prototype, key, internalRecord(property));
    installed.push(key);
  }
  try {
    install(
      'authorized',
      internalRecord({
        get() {
          if (this === publicControl) nativeGetterHits++;
          else observed.push(this);
          return true;
        },
        configurable: true,
      }),
    );
    install(
      'applicationUtility',
      internalRecord({
        value: function () {
          return this;
        },
        configurable: true,
      }),
    );
    for (const key of [
      'get',
      'set',
      'apply',
      'construct',
      'defineProperty',
      'getOwnPropertyDescriptor',
      'getPrototypeOf',
      'setPrototypeOf',
      'isExtensible',
      'preventExtensions',
      'has',
      'ownKeys',
      'deleteProperty',
    ])
      install(
        key,
        internalRecord({
          value: function (...args: unknown[]) {
            if (key === 'get' && args[0] === publicControl) {
              nativeProxyHits++;
              return Reflect.get(publicControl, String(args[1]));
            }
            observed.push(...args);
            return undefined;
          },
          configurable: true,
        }),
      );
    for (const key of ['value', 'writable', 'enumerable', 'configurable'])
      install(
        key,
        internalRecord({
          get() {
            observed.push(this);
            return undefined;
          },
          configurable: true,
        }),
      );
    install(
      '0',
      internalRecord({
        set(value: unknown) {
          if (this === publicArray) nativeIndexHits++;
          else observed.push(this, value);
        },
        configurable: true,
      }),
    );
    install(
      'prepareStackTrace',
      internalRecord({
        value: function (...values: unknown[]) {
          observed.push(...values);
          return 'attacker stack';
        },
        configurable: true,
      }),
    );
    check(
      Reflect.get(publicControl, 'authorized') === true && nativeGetterHits === 1,
      'Native object getter positive control failed',
    );
    check(
      Reflect.apply(
        Reflect.get(publicControl, 'applicationUtility'),
        publicControl,
        [],
      ) === publicControl,
      'Application object prototype method failed',
    );
    const controlledProxy = new Proxy(publicControl, internalRecord({}));
    const unsafeProxy = new Proxy(publicControl, {});
    check(
      unsafeProxy.application === 'control' && nativeProxyHits === 1,
      'Native inherited Proxy trap positive control failed',
    );
    check(
      controlledProxy.application === 'control' && nativeProxyHits === 1,
      'Private Proxy handler inherited an application trap',
    );
    publicArray.push('control');
    check(nativeIndexHits === 1, 'Native inherited index setter control failed');
    check(
      Reflect.get(privateAuthority, 'authorized') === undefined,
      'Application getter changed private authorization metadata',
    );
    const protectedProxy = new Proxy(privateAuthority, internalRecord({}));
    check(
      protectedProxy.application === 'expected',
      'Private Proxy target exposed to inherited trap',
    );
    const descriptor = ownDescriptor(privateAuthority, 'application')!;
    check(
      descriptor.value === 'expected' &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
      'Private native descriptor records inherited application fields',
    );
    const shadow = new Map<string, number>();
    shadow.get = () => 173;
    check(
      shadow.get('anything') === 173,
      'Late intrinsic setter descriptor was poisoned',
    );
    const protectedArray = internalArray<number>();
    protectedArray.push(179);
    check(
      protectedArray[0] === 179 && privateMap.get('private') === 43 && privateSet.has(47),
      'Private collection inherited application object fields',
    );
    check(
      typeof new Error('private guarded stack').stack === 'string',
      'Inherited application stack formatter reached private errors',
    );
    for (const key of [
      'then',
      'toJSON',
      Symbol.iterator,
      Symbol.toPrimitive,
      Symbol.toStringTag,
    ])
      check(
        !Reflect.defineProperty(
          Object.prototype,
          key,
          internalRecord({
            value() {
              observed.push(this);
            },
          }),
        ),
        'Object prototype implicit protocol replacement admitted',
      );
    for (const key of ['toString', 'valueOf', 'hasOwnProperty', '__proto__'])
      check(
        !Reflect.defineProperty(
          Object.prototype,
          key,
          internalRecord({
            value() {
              observed.push(this);
            },
          }),
        ),
        'Object prototype native operation replacement admitted',
      );
    check(
      !Reflect.setPrototypeOf(Object.prototype, {}),
      'Object prototype ancestry changed',
    );
    check(
      observed.length === 0,
      'Application object extension observed private receiver',
    );
  } finally {
    for (const key of installed) Reflect.deleteProperty(Object.prototype, key);
  }
  return {
    originalTypeErrorFrozen: Object.isFrozen(originalTypeError),
    errorStackTypes: { shim: shimStack, public: typeof publicError.stack },
    checks,
    shadowedMethods,
    nativeFunctions: originalFunctions.length,
    observedReceivers: observed.length,
    nativeStackHookCalls,
    nativeInheritedStackHookCalls,
  };
};
