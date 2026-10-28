export {};

interface PrototypeHazards {
  descriptorObserved: boolean;
  descriptorRejected: boolean;
  returnedArrayObserved: boolean;
  awaitedPromiseObserved: boolean;
}
declare global {
  interface Window {
    runPrototypeHazards(): Promise<PrototypeHazards>;
  }
}
window.runPrototypeHazards = async () => {
  const define = Object.defineProperty;
  const originalGet = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
  const descriptor = { value: 'benign', configurable: true };
  let descriptorObserved = false;
  let descriptorRejected = false;
  try {
    define(Object.prototype, 'get', {
      configurable: true,
      get() {
        descriptorObserved ||= this === descriptor;
        return undefined;
      },
    });
    try {
      define({}, 'benign', descriptor);
    } catch {
      descriptorRejected = true;
    }
  } finally {
    if (originalGet) define(Object.prototype, 'get', originalGet);
    else Reflect.deleteProperty(Object.prototype, 'get');
  }
  const array = [1, 2];
  let returnedArrayObserved = false;
  const originalThen = Object.getOwnPropertyDescriptor(Array.prototype, 'then');
  try {
    define(Array.prototype, 'then', {
      configurable: true,
      get() {
        returnedArrayObserved ||= this === array;
        return undefined;
      },
    });
    async function trustedArrayReturn() {
      return array;
    }
    const result = trustedArrayReturn();
    // Return-value assimilation occurs synchronously before the async call returns.
    if (originalThen) define(Array.prototype, 'then', originalThen);
    else Reflect.deleteProperty(Array.prototype, 'then');
    await result;
  } finally {
    if (originalThen) define(Array.prototype, 'then', originalThen);
    else Reflect.deleteProperty(Array.prototype, 'then');
  }
  const nativePromise = Promise;
  const privatePromise = nativePromise.resolve('benign');
  const originalConstructor = Object.getOwnPropertyDescriptor(
    nativePromise.prototype,
    'constructor',
  )!;
  let awaitedPromiseObserved = false;
  try {
    define(nativePromise.prototype, 'constructor', {
      configurable: true,
      get() {
        awaitedPromiseObserved ||= this === privatePromise;
        return nativePromise;
      },
    });
    async function trustedAwait() {
      await privatePromise;
      return 1;
    }
    const result = trustedAwait();
    define(nativePromise.prototype, 'constructor', originalConstructor);
    await result;
  } finally {
    define(nativePromise.prototype, 'constructor', originalConstructor);
  }
  return {
    descriptorObserved,
    descriptorRejected,
    returnedArrayObserved,
    awaitedPromiseObserved,
  };
};
