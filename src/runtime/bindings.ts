import { internalSet, ownDescriptor, internalRecord } from '../shared/primordials.ts';
import { languageGlobals } from './intrinsics.ts';

const ownNames = Object.getOwnPropertyNames;
const descriptor = ownDescriptor;
const define = Object.defineProperty;
const prototypeOf = Object.getPrototypeOf;
const get = Reflect.get;
const sameValue = Object.is;
const nativeGlobal = globalThis;

// These namespaces and host aliases supplement the protected language globals.
// Their values are read only after the environment's policies are installed.
const ambientNames = [
  'WebAssembly',
  'Intl',
  'Atomics',
  'globalThis',
  'self',
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'crypto',
  'performance',
  'indexedDB',
  'webkitIndexedDB',
  'mozIndexedDB',
  'msIndexedDB',
  'caches',
  'localStorage',
  'sessionStorage',
  'customElements',
];

/** Keep trusted callbacks bound to the prepared environment's current APIs. */
export function sealRuntimeBindings(target: object = nativeGlobal): void {
  const names = internalSet<string>([
    ...languageGlobals,
    'eval',
    'encodeURI',
    'decodeURI',
    'encodeURIComponent',
    'decodeURIComponent',
    'escape',
    'unescape',
    'NaN',
    'Infinity',
    'undefined',
  ]);
  for (const name of ambientNames) names.add(name);
  // Browser constructors differ between Window, Worker and Worklet environments.
  // Include inherited bindings so defining an own shadow cannot replace them.
  for (let owner: object | null = target; owner; owner = prototypeOf(owner)) {
    for (const name of ownNames(owner)) {
      if (!/^[A-Z]/.test(name)) continue;
      const property = descriptor(owner, name);
      if (property && 'value' in property && typeof property.value === 'function')
        names.add(name);
    }
  }
  for (const name of names) {
    if (!(name in target)) continue;
    const own = descriptor(target, name);
    // Preserve unforgeable browser accessors and their native receiver behavior.
    if (own && !own.configurable && !('value' in own)) continue;
    const value: unknown = get(target, name);
    if (own && !own.configurable && !own.writable) continue;
    if (own && !own.configurable) {
      define(target, name, internalRecord({ writable: false }));
      continue;
    }
    define(
      target,
      name,
      internalRecord({
        get() {
          return value;
        },
        set(replacement: unknown) {
          if (!sameValue(replacement, value))
            throw new TypeError('Runtime binding cannot be replaced: ' + name);
        },
        configurable: false,
        enumerable: own?.enumerable ?? false,
      }),
    );
  }
}
