import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

function fixture(source: string) {
  const code = buildSync({
    stdin: {
      contents: `import { internalArray, internalRecord, internalData, ownDescriptor, ownDescriptors, strings, math } from './src/shared/primordials.ts';\n${source}`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  }).outputFiles[0].text;
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context;
}

test('explicit internal arrays protect receivers, species outputs and iteration', async () => {
  const context = fixture(`
    const records = internalArray<{secret: number}>();
    globalThis.runHost = async () => {
      records.push({secret: 71});
      const values = records.map(record => record.secret);
      const copy = internalArray([...values]);
      return {json: JSON.stringify(copy), value: (await copy)[0], found: records.find(record => record.secret === 71)!.secret};
    };
  `);
  vm.runInContext(
    `
    globalThis.observed = 0;
    Array.prototype.find = function() { observed++; throw new Error('application find'); };
    Array.prototype.toJSON = function() { observed++; return []; };
    Array.prototype.then = function() { observed++; };
    Object.defineProperty(Array.prototype, '0', {set(value) {observed++;}, configurable:true});
  `,
    context,
  );
  const result = await vm.runInContext('runHost()', context);
  assert.equal(result.json, '[71]');
  assert.equal(result.value, 71);
  assert.equal(result.found, 71);
  assert.equal(vm.runInContext('observed', context), 0);
});

test('captured math protects bounds while application math remains ordinary', () => {
  const context = fixture('globalThis.bound = () => math.min(3, 7);');
  vm.runInContext('Math.min = () => 999;', context);
  assert.equal(vm.runInContext('Math.min(3, 7)', context), 999);
  assert.equal(vm.runInContext('bound()', context), 3);
});

test('explicit string operations survive application polyfills', () => {
  const context = fixture(`
    globalThis.clean = () => strings.toLowerCase(strings.trim('  HELLO '));
    globalThis.splitHost = () => strings.split('a,b', ',').join('-');
    let calls = 0;
    globalThis.optional = (value: string | null) => {
      if (value === null) return undefined;
      calls++;
      return strings.trim(strings.split(value, ',')[0]);
    };
    globalThis.calls = () => calls;
  `);
  vm.runInContext(
    "String.prototype.trim = () => 'wrong'; String.prototype.toLowerCase = () => 'wrong'; String.prototype.split = () => [];",
    context,
  );
  assert.equal(vm.runInContext("' HELLO '.trim()", context), 'wrong');
  assert.equal(vm.runInContext('clean()', context), 'hello');
  assert.equal(vm.runInContext('splitHost()', context), 'a-b');
  assert.equal(vm.runInContext('optional(null)', context), undefined);
  assert.equal(vm.runInContext('calls()', context), 0);
  assert.equal(vm.runInContext("optional(' a,b')", context), 'a');
  assert.equal(vm.runInContext('calls()', context), 1);
});

test('trusted helpers are private to the bundle and preserve match data', () => {
  const context = fixture(`globalThis.matchHost = () => strings.match('ab', /(a)(b)/);`);
  assert.equal(vm.runInContext("Object.hasOwn(globalThis, 'strings')", context), false);
  assert.equal(
    vm.runInContext("Object.hasOwn(globalThis, 'internalArray')", context),
    false,
  );
  const result = vm.runInContext('matchHost()', context);
  assert.equal(result[0], 'ab');
  assert.equal(result[1], 'a');
  assert.equal(result.index, 0);
});

test('private records exclude missing fields, JSON hooks and thenable assimilation', async () => {
  const context = fixture(`
    const secret = internalRecord({secret: 71});
    globalThis.observed = 0;
    globalThis.run = () => {
      const native = {secret: 73};
      const nativeMissing = native.missing;
      const privateMissing = secret.missing;
      const nativeJSON = JSON.stringify(native);
      const privateJSON = JSON.stringify(secret);
      const nativePromise = Promise.resolve(native);
      const privatePromise = Promise.resolve(secret);
      return internalRecord({nativeMissing, privateMissing, nativeJSON, privateJSON,
        nativePromise, privatePromise, secret,
        frozen: Object.isFrozen(Object.getPrototypeOf(secret)),
        nullRoot: Object.getPrototypeOf(Object.getPrototypeOf(secret)) === null});
    };
    Object.defineProperty(Object.prototype, 'missing', internalRecord({
      get() { observed++; return 79; }, configurable: true,
    }));
    Object.defineProperty(Object.prototype, 'toJSON', internalRecord({
      value() { observed++; return 'native JSON control'; }, configurable: true,
    }));
    Object.defineProperty(Object.prototype, 'then', internalRecord({
      value(resolve) { observed++; resolve('native promise control'); }, configurable: true,
    }));
  `);
  const result = vm.runInContext('run()', context);
  assert.equal(result.nativeMissing, 79);
  assert.equal(result.privateMissing, undefined);
  assert.equal(result.nativeJSON, '"native JSON control"');
  assert.equal(result.privateJSON, '{"secret":71}');
  assert.equal(await result.nativePromise, 'native promise control');
  assert.equal(await result.privatePromise, result.secret);
  assert.equal(result.frozen, true);
  assert.equal(result.nullRoot, true);
  assert.equal(vm.runInContext('observed', context), 3);
});

test('private descriptor records and Proxy handlers exclude inherited get/set traps', () => {
  const context = fixture(`
    const nativeDescriptor = Object.getOwnPropertyDescriptor;
    const target = internalRecord({secret: 83});
    const source = internalRecord({field: 89});
    Object.defineProperty(source, 'accessor', internalRecord({get() {return 97;}, configurable: true}));
    globalThis.observed = 0;
    globalThis.run = () => {
      const nativeProxy = new Proxy(target, {});
      const privateProxy = new Proxy(target, internalRecord({}));
      const nativeProxyValue = nativeProxy.secret;
      const privateProxyValue = privateProxy.secret;
      const nativeAccessorValue = nativeDescriptor(source, 'accessor').value;
      const detachedAccessor = ownDescriptor(source, 'accessor');
      const detachedData = ownDescriptor(source, 'field');
      const all = ownDescriptors(source);
      let nativeRejected = false;
      try { Object.defineProperty({}, 'field', {value: 101}); }
      catch { nativeRejected = true; }
      const privateOutput = internalRecord({});
      Object.defineProperty(privateOutput, 'field', internalRecord({value: 103}));
      return internalRecord({nativeProxyValue, privateProxyValue, nativeAccessorValue,
        privateAccessorValue: detachedAccessor.value, privateData: detachedData.value,
        privateMapMissing: all.missing, privateMapAccessorValue: all.accessor.value,
        nativeRejected, privateOutput: privateOutput.field,
        descriptorRoot: Object.getPrototypeOf(Object.getPrototypeOf(detachedAccessor)) === null});
    };
    Object.defineProperty(Object.prototype, 'get', internalRecord({
      value(target, key, receiver) { observed++; return Reflect.get(target, key, receiver); }, configurable: true,
    }));
    Object.defineProperty(Object.prototype, 'set', internalRecord({
      value() { observed++; return true; }, configurable: true,
    }));
    Object.defineProperty(Object.prototype, 'value', internalRecord({
      get() {observed++; return 'native descriptor control';}, configurable: true,
    }));

  `);
  const result = vm.runInContext('run()', context);
  assert.equal(result.nativeProxyValue, 83);
  assert.equal(result.privateProxyValue, 83);
  assert.equal(result.nativeAccessorValue, 'native descriptor control');
  assert.equal(result.privateAccessorValue, undefined);
  assert.equal(result.privateData, 89);
  assert.equal(result.privateMapMissing, undefined);
  assert.equal(result.privateMapAccessorValue, undefined);
  assert.equal(result.nativeRejected, true);
  assert.equal(result.privateOutput, 103);
  assert.equal(result.descriptorRoot, true);
  assert.equal(vm.runInContext('observed', context), 2);
});

test('private records do not inherit the legacy prototype setter during assignment', () => {
  const context = fixture(`
    const source = JSON.parse('{"__proto__":{"inherited":107}}');
    const native = Object.assign({}, source);
    const trusted = Object.assign(internalRecord({}), source);
    globalThis.result = internalRecord({native: native.inherited,
      trusted: trusted.inherited, own: Object.hasOwn(trusted, '__proto__'),
      nullRoot: Object.getPrototypeOf(Object.getPrototypeOf(trusted)) === null});
  `);
  const result = vm.runInContext('result', context);
  assert.equal(result.native, 107);
  assert.equal(result.trusted, undefined);
  assert.equal(result.own, true);
  assert.equal(result.nullRoot, true);
});

test('trusted data normalization preserves cycles, descriptors and native/class instances', () => {
  const context = fixture(`
    let getterCalls = 0;
    class Example { field = 109; }
    const instance = new Example();
    const date = new Date(0);
    const source = JSON.parse('{"nested":{"field":113},"array":[{"field":127}]}');
    source.cycle = source;
    source.instance = instance;
    source.date = date;
    Object.defineProperty(source, 'accessor', {get() {getterCalls++; return 131;}, configurable:true});
    const result = internalData(source);
    globalThis.result = internalRecord({same: result === source, cycle: result.cycle === result,
      field: result.nested.field, array: result.array[0].field,
      recordRoot: Object.getPrototypeOf(Object.getPrototypeOf(result.nested)) === null,
      arrayRoot: Object.getPrototypeOf(Object.getPrototypeOf(result.array)) === null,
      native: Object.getPrototypeOf(date) === Date.prototype,
      custom: Object.getPrototypeOf(instance) === Example.prototype,
      getterCalls, accessorPreserved: typeof ownDescriptor(result, 'accessor').get === 'function'});
  `);
  const result = vm.runInContext('result', context);
  assert.equal(result.same, true);
  assert.equal(result.cycle, true);
  assert.equal(result.field, 113);
  assert.equal(result.array, 127);
  assert.equal(result.recordRoot, true);
  assert.equal(result.arrayRoot, true);
  assert.equal(result.native, true);
  assert.equal(result.custom, true);
  assert.equal(result.getterCalls, 0);
  assert.equal(result.accessorPreserved, true);
});

test('data normalization ignores inherited descriptor fields and missing-value getters', () => {
  const context = fixture(`
    let calls = 0;
    const source = {nested: {field: 137}, array: [{field: 139}]};
    Object.defineProperty(source, 'accessor', {get() {calls++; return 149;}});
    globalThis.run = () => {
      const value = internalData(source);
      return internalRecord({field: value.nested.field, array: value.array[0].field,
        optional: value.nested.missing, calls});
    };
    Object.defineProperty(Object.prototype, 'value', internalRecord({
      get() {calls++; return 'inherited descriptor value';}, configurable:true,
    }));
    Object.defineProperty(Object.prototype, 'missing', internalRecord({
      get() {calls++; return 'inherited missing field';}, configurable:true,
    }));
  `);
  const result = vm.runInContext('run()', context);
  assert.equal(result.field, 137);
  assert.equal(result.array, 139);
  assert.equal(result.optional, undefined);
  assert.equal(result.calls, 0);
});
