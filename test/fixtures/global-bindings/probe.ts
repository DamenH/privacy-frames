const nativeGlobal = globalThis;
const nativeObject = Object;
const nativeReflect = Reflect;
const nativeString = String;
const nativeFunction = Function;
const nativeUnforgeableAccessors = new Set<string>();
for (let owner: object | null = nativeGlobal; owner; owner = Object.getPrototypeOf(owner))
  for (const name of Object.getOwnPropertyNames(owner)) {
    const property = Object.getOwnPropertyDescriptor(owner, name)!;
    if (!property.configurable && !('value' in property))
      nativeUnforgeableAccessors.add(name);
  }

export function bindingProbe() {
  const bindings = [];
  for (const name of [
    'Array',
    'Object',
    'Proxy',
    'Reflect',
    'JSON',
    'Promise',
    'String',
    'Number',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'RegExp',
    'Date',
    'Math',
    'globalThis',
    'self',
    'window',
    'Function',
    'Error',
    'TypeError',
    'EventTarget',
    'Element',
    'Node',
    'navigator',
    'document',
    'location',
    'Worker',
    'SharedWorker',
    'WebSocket',
    'RTCPeerConnection',
    'IDBDatabase',
    'IDBTransaction',
    'IDBCursor',
    'IDBKeyRange',
  ]) {
    let owner: object | null = nativeGlobal;
    while (owner && !nativeObject.hasOwn(owner, name))
      owner = nativeObject.getPrototypeOf(owner);
    if (!owner) continue;
    const original = nativeObject.getOwnPropertyDescriptor(owner, name)!;
    const originalOwn = owner === nativeGlobal;
    if (nativeUnforgeableAccessors.has(name)) {
      bindings.push({ name, protectedAccessor: true, originalOwn });
      continue;
    }
    const replacement = function applicationBinding() {};
    const retained = nativeReflect.get(nativeGlobal, name);
    let identicalAssignment = false;
    try {
      nativeFunction('value', '"use strict";' + name + '=value;')(retained);
      identicalAssignment = nativeReflect.get(nativeGlobal, name) === retained;
    } catch {}
    const restore = () => {
      if (originalOwn) nativeObject.defineProperty(nativeGlobal, name, original);
      else nativeReflect.deleteProperty(nativeGlobal, name);
    };
    let assigned = false,
      defined = false,
      classicAssigned = false;
    try {
      assigned =
        nativeReflect.set(nativeGlobal, name, replacement) &&
        nativeReflect.get(nativeGlobal, name) === replacement;
    } catch {
    } finally {
      restore();
    }
    try {
      nativeObject.defineProperty(nativeGlobal, name, {
        value: replacement,
        writable: true,
        configurable: true,
      });
      defined = nativeReflect.get(nativeGlobal, name) === replacement;
    } catch {
    } finally {
      restore();
    }
    try {
      nativeFunction('value', '"use strict";' + name + '=value;')(replacement);
      classicAssigned = nativeReflect.get(nativeGlobal, name) === replacement;
    } catch {
    } finally {
      restore();
    }
    bindings.push({
      name,
      originalOwn,
      assigned,
      defined,
      classicAssigned,
      identicalAssignment,
      retained: nativeReflect.get(nativeGlobal, name) === retained,
    });
  }
  const ordinary = '__benignApplicationGlobal';
  nativeObject.defineProperty(nativeGlobal, ordinary, {
    value: 1,
    writable: true,
    configurable: true,
  });
  nativeReflect.set(nativeGlobal, ordinary, 2);
  const ordinaryGlobalWorks = nativeReflect.get(nativeGlobal, ordinary) === 2;
  nativeReflect.deleteProperty(nativeGlobal, ordinary);
  let webSocketDenied = false;
  try {
    const socket = new WebSocket('ws://' + location.host + '/binding-socket');
    socket.onerror = (event) => event.preventDefault();
    socket.close();
  } catch {
    webSocketDenied = true;
  }
  return { bindings, ordinaryGlobalWorks, webSocketDenied };
}

export async function cacheCallbackProbe() {
  const original = nativeObject.getOwnPropertyDescriptor(nativeGlobal, 'String')!;
  const calls: string[] = [];
  function applicationString(value: unknown) {
    calls.push(nativeString(value));
    return nativeString(value);
  }
  let replacementRejected = false;
  try {
    try {
      nativeObject.defineProperty(nativeGlobal, 'String', {
        ...original,
        value: applicationString,
      });
    } catch {
      replacementRejected = true;
    }
    const pending = caches.open('benign-fixture');
    nativeObject.defineProperty(nativeGlobal, 'String', original);
    await pending;
  } finally {
    nativeObject.defineProperty(nativeGlobal, 'String', original);
  }
  await caches.delete('benign-fixture');
  return { calls, replacementRejected };
}

export function webStorageCallbackProbe() {
  const original = nativeObject.getOwnPropertyDescriptor(nativeGlobal, 'Object')!;
  const observedKeys: string[][] = [];
  function applicationObject() {}
  nativeObject.defineProperty(applicationObject, 'hasOwn', {
    value: (value: object, key: PropertyKey) => {
      observedKeys.push(nativeObject.getOwnPropertyNames(value));
      return nativeObject.hasOwn(value, key);
    },
  });
  let replacementRejected = false;
  try {
    try {
      nativeObject.defineProperty(nativeGlobal, 'Object', {
        ...original,
        value: applicationObject,
      });
    } catch {
      replacementRejected = true;
    }
    const value = localStorage.getItem('absent-benign-key');
    return { observedKeys, value, replacementRejected };
  } finally {
    nativeObject.defineProperty(nativeGlobal, 'Object', original);
  }
}
