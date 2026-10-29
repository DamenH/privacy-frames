import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launch } from './browser-profile.ts';

const guestSource = String.raw`(() => {
  let bytes = new Uint8Array(0);
  let moved;
  const moduleBytes = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 17,
    2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 4, 114, 101, 97, 100, 0, 0, 10, 9, 1, 7, 0,
    65, 0, 45, 0, 0, 11,
  ]);
  function encode(view, native = true) {
    if (native && typeof view.toBase64 === 'function') return view.toBase64();
    let binary = '';
    for (let start = 0; start < view.length; start += 8192)
      binary += String.fromCharCode(...view.subarray(start, start + 8192));
    return btoa(binary);
  }
  return function dispatch(operation, argument, offset = 0) {
    switch (operation) {
      case 'inventory':
        return JSON.stringify(
          Object.fromEntries(
            [
              'ArrayBuffer',
              'SharedArrayBuffer',
              'Uint8Array',
              'Uint8ClampedArray',
              'DataView',
              'WebAssembly',
              'structuredClone',
              'Blob',
              'File',
              'Worker',
              'MessageChannel',
              'MessagePort',
              'ReadableStream',
              'TransformStream',
              'OffscreenCanvas',
              'ImageData',
              'fetch',
              'TextEncoder',
              'TextDecoder',
              'atob',
              'btoa',
              'performance',
              'crypto',
              'document',
              'window',
              '__realmHeapSample',
            ].map((name) => [name, typeof globalThis[name]]),
          ),
        );
      case 'create':
        moved = undefined;
        bytes = new Uint8Array(argument);
        for (let index = 0; index < bytes.length; index++)
          bytes[index] = (index * 17 + 13) & 255;
        return bytes.length;
      case 'length':
        return bytes.byteLength;
      case 'codecs':
        return JSON.stringify({
          toBase64: typeof Uint8Array.prototype.toBase64,
          setFromBase64: typeof Uint8Array.prototype.setFromBase64,
        });
      case 'moduleBytes':
        return encode(moduleBytes);
      case 'pixels':
        bytes = new Uint8Array([201, 47, 89, 255]);
        moved = undefined;
        return bytes.length;
      case 'export':
      case 'exportManual': {
        const source = moved ? new Uint8Array(moved) : bytes;
        return encode(
          source.subarray(offset, Math.min(offset + argument, source.length)),
          operation === 'export',
        );
      }
      case 'detach': {
        const original = bytes.buffer;
        moved = original.transfer();
        return JSON.stringify({
          originalBytes: original.byteLength,
          viewBytes: bytes.byteLength,
          movedBytes: moved.byteLength,
        });
      }
      case 'release':
        moved = undefined;
        bytes = new Uint8Array(0);
        return undefined;
      case 'receiveStart':
        moved = undefined;
        bytes = new Uint8Array(argument);
        return bytes.length;
      case 'receive': {
        if (typeof bytes.setFromBase64 === 'function')
          return bytes.subarray(offset).setFromBase64(argument).written;
        const binary = atob(argument);
        for (let index = 0; index < binary.length; index++)
          bytes[offset + index] = binary.charCodeAt(index);
        return binary.length;
      }
      case 'checksum': {
        let checksum = 0;
        for (const value of bytes) checksum = (checksum + value) >>> 0;
        return checksum;
      }
      case 'rawBuffer':
        return bytes.buffer;
      case 'rawView':
        return bytes;
      case 'rawPromise':
        return Promise.resolve(1);
      case 'hostObjectResult':
        try {
          argument();
          return 'unexpected success';
        } catch (error) {
          return error.name;
        }
      case 'constructor': {
        const result = {};
        for (const [name, fn] of [
          ['Function', Function],
          ['structuredClone', structuredClone.constructor],
          ['TextEncoder', TextEncoder.constructor],
          ['WebAssembly.Module', WebAssembly.Module.constructor],
        ]) {
          try {
            result[name] = fn('return typeof document')();
          } catch (error) {
            result[name] = error.name + ': ' + error.message;
          }
        }
        try {
          result.eval = eval('2+2');
        } catch (error) {
          result.eval = error.name + ': ' + error.message;
        }
        return JSON.stringify(result);
      }
      case 'factory': {
        try {
          const capturedEval = eval;
          const privateSentinel = 71;
          const GuestFunction = function (...parts) {
            const body = String(parts.length ? parts.pop() : '');
            return (0, capturedEval)(
              '(function anonymous(' +
                parts.map(String).join(',') +
                ') {\n' +
                body +
                '\n})',
            );
          };
          const generated = new GuestFunction(
            'value',
            'return {value, ambient:typeof document};',
          );
          const value = generated(73);
          const lexical = GuestFunction('return typeof privateSentinel;')();
          const constructed = new (GuestFunction('value', 'this.value=value;'))(79);
          return JSON.stringify({
            worked: true,
            directEval: eval('2+2'),
            nativeGuestFunction: Object.getPrototypeOf(generated) === Function.prototype,
            nativeGuestObject: Object.getPrototypeOf(value) === Object.prototype,
            value: value.value,
            ambient: value.ambient,
            lexical,
            constructed: constructed.value,
            privateSentinel,
          });
        } catch (error) {
          const expression = (0, eval)('(function generated(){return 1})');
          (0, eval)('globalThis.__indirectEvalProbe=71');
          return JSON.stringify({
            worked: false,
            error: error.name + ': ' + error.message,
            directEval: eval('2+2'),
            indirectExpressionType: typeof expression,
            indirectSideEffect: globalThis.__indirectEvalProbe === 71,
          });
        }
      }
      case 'wasmMemory': {
        try {
          const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
          const original = memory.buffer,
            view = new Uint8Array(original);
          view[0] = 71;
          memory.grow(1);
          return JSON.stringify({
            worked: true,
            originalDetached: original.byteLength,
            viewDetached: view.byteLength,
            newBytes: memory.buffer.byteLength,
            value: new Uint8Array(memory.buffer)[0],
            guestBuffer: memory.buffer instanceof ArrayBuffer,
          });
        } catch (error) {
          return JSON.stringify({
            worked: false,
            error: error.name + ': ' + error.message,
          });
        }
      }
      case 'clone': {
        try {
          const original = new ArrayBuffer(16),
            view = new Uint8Array(original);
          view[0] = 71;
          const clone = structuredClone(original, { transfer: [original] });
          return JSON.stringify({
            worked: true,
            originalBytes: original.byteLength,
            viewBytes: view.byteLength,
            cloneBytes: clone.byteLength,
            value: new Uint8Array(clone)[0],
          });
        } catch (error) {
          return JSON.stringify({
            worked: false,
            error: error.name + ': ' + error.message,
          });
        }
      }
      case 'wasm': {
        try {
          const module = new WebAssembly.Module(moduleBytes),
            instance = new WebAssembly.Instance(module);
          const memory = instance.exports.memory,
            original = memory.buffer;
          new Uint8Array(original).set([201, 47, 89, 255]);
          const result = {
            worked: true,
            read: instance.exports.read(),
            guestBuffer: original instanceof ArrayBuffer,
            oldBytes: original.byteLength,
          };
          memory.grow(1);
          result.detachedAfterGrow = original.byteLength;
          result.newBytes = memory.buffer.byteLength;
          bytes = new Uint8Array(memory.buffer, 0, 4);
          moved = undefined;
          return JSON.stringify(result);
        } catch (error) {
          return JSON.stringify({
            worked: false,
            error: error.name + ': ' + error.message,
          });
        }
      }
      case 'asyncWasm':
        WebAssembly.instantiate(moduleBytes).then(
          (result) => argument(result.instance.exports.read()),
          (error) => argument(error.name + ': ' + error.message),
        );
        return undefined;
      case 'asyncCapabilities':
        Promise.resolve().then(async () => {
          const result = {
            entry: 'guest Promise callback',
            document: typeof document,
            window: typeof window,
            hostSampler: typeof globalThis.__realmHeapSample,
            constructors: JSON.parse(dispatch('constructor')),
            factory: JSON.parse(dispatch('factory')),
            wasm: JSON.parse(dispatch('wasm')),
            memory: JSON.parse(dispatch('wasmMemory')),
          };
          try {
            const value = await WebAssembly.instantiate(moduleBytes);
            result.asyncWasm = value.instance.exports.read();
          } catch (error) {
            result.asyncWasm = error.name + ': ' + error.message;
          }
          try {
            result.callbackConstructor = argument.constructor('return typeof document')();
          } catch (error) {
            result.callbackConstructor = error.name + ': ' + error.message;
          }
          argument(JSON.stringify(result));
        });
        return undefined;
      case 'asyncClone':
        Promise.resolve().then(() => argument(dispatch('clone')));
        return undefined;
      default:
        throw new Error('Unknown buffer probe operation');
    }
  };
})();
`;

const workerSource = `self.onmessage = (event) => {
  const buffer = event.data;
  let checksum = 0;
  for (const value of new Uint8Array(buffer)) checksum = (checksum + value) >>> 0;
  const receivedBytes = buffer.byteLength;
  postMessage({ type: 'buffer', buffer, checksum, receivedBytes }, [buffer]);
  postMessage({ type: 'detachment', byteLength: buffer.byteLength });
};
`;
const server = createServer((request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url?.includes('policy=explicit'))
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:",
    );
  if (request.url === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(workerSource);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><link rel="icon" href="data:,"><title>Realm buffer probe</title>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const browser = await launch(chromium, {
  args: ['--js-flags=--harmony-shadow-realm'],
});
const receipt: Record<string, unknown> = {
  provenance: {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    probeSHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    node: process.version,
    scope: 'Isolated milestone probe; no runtime build used',
  },
  browser: browser.version(),
  flag: '--js-flags=--harmony-shadow-realm',
  method:
    'Native ShadowRealm; only primitives/callables cross its boundary. Base64 chunks copy bytes into destination-owned buffers.',
  heapScope:
    'Sampled main-isolate CDP heap/backing storage, not true process peak; worker memory excluded.',
  memory: [],
};
try {
  const policies: Record<string, unknown>[] = [];
  receipt.policies = policies;
  for (const policy of ['none', 'explicit']) {
    const clonePage = await browser.newPage();
    const row: Record<string, unknown> = {
      policy,
      url: 'http://127.0.0.1:' + address.port + '/?policy=' + policy,
      csp:
        policy === 'explicit'
          ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:"
          : null,
    };
    policies.push(row);
    let crashed = false;
    clonePage.on('crash', () => {
      crashed = true;
    });
    try {
      await clonePage.goto(String(row.url));
      row.controls = await clonePage.evaluate(`(() => {
        const api = new ShadowRealm().evaluate(${JSON.stringify(guestSource)});
        const binary = atob(api('moduleBytes'));
        const moduleBytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes));
        const original = instance.exports.memory.buffer;
        new Uint8Array(original)[0] = 201;
        const read = instance.exports.read();
        instance.exports.memory.grow(1);
        const transferred = new ArrayBuffer(16);
        const clone = structuredClone(transferred, {transfer:[transferred]});
        if(read!==201 || original.byteLength!==0 || transferred.byteLength!==0 || clone.byteLength!==16)throw new Error('Native buffer controls failed');
        return {hostFunction:Function('return typeof document')(),hostWasm:{read,originalDetached:original.byteLength,newBytes:instance.exports.memory.buffer.byteLength},hostClone:{originalDetached:transferred.byteLength,cloneBytes:clone.byteLength},guestFunction:JSON.parse(api('constructor')),guestFactory:JSON.parse(api('factory')),guestWasm:JSON.parse(api('wasm')),guestMemory:JSON.parse(api('wasmMemory'))};
      })()`);
      row.guestClone = await clonePage.evaluate(
        `JSON.parse(new ShadowRealm().evaluate(${JSON.stringify(guestSource)})('clone'))`,
      );
    } catch (error) {
      row.guestClone = { worked: false, rendererCrashed: crashed, error: String(error) };
    } finally {
      await clonePage.close().catch(() => {});
    }
  }
  for (const policy of ['none', 'explicit']) {
    const clonePage = await browser.newPage();
    const row: Record<string, unknown> = {
      policy,
      entry: 'guest Promise callback',
      url: 'http://127.0.0.1:' + address.port + '/?policy=' + policy,
    };
    policies.push(row);
    let crashed = false;
    clonePage.on('crash', () => {
      crashed = true;
    });
    try {
      await clonePage.goto(String(row.url));
      row.capabilities = await clonePage.evaluate(`new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Guest async capabilities timed out')),3000);
        const api=new ShadowRealm().evaluate(${JSON.stringify(guestSource)});
        api('asyncCapabilities',value=>{clearTimeout(timer);resolve(JSON.parse(value));});
      })`);
      row.guestClone = await clonePage.evaluate(`new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Guest async clone timed out')),3000);
        const api=new ShadowRealm().evaluate(${JSON.stringify(guestSource)});
        api('asyncClone',value=>{clearTimeout(timer);resolve(JSON.parse(value));});
      })`);
    } catch (error) {
      row.guestClone = { worked: false, rendererCrashed: crashed, error: String(error) };
    } finally {
      await clonePage.close().catch(() => {});
    }
  }
  for (const policy of policies)
    assert(policy.controls || policy.capabilities, 'Policy controls did not complete');
  const page = await browser.newPage();
  const progress: string[] = [];
  receipt.progress = progress;
  page.on('console', (message) => {
    if (message.text().startsWith('buffer-spike:')) {
      progress.push(message.text());
      console.log(message.text());
    }
  });
  const cdp = await page.context().newCDPSession(page);
  const samples: unknown[] = [];
  await page.exposeFunction('__realmHeapSample', async (label: string) => {
    try {
      samples.push({ label, ...(await cdp.send('Runtime.getHeapUsage')) });
    } catch (error) {
      samples.push({ label, unavailable: String(error) });
    }
  });
  await page.goto('http://127.0.0.1:' + address.port + '/?policy=explicit');
  const probe = String.raw`(async () => {
  const realm = new ShadowRealm();
  const api = realm.evaluate(${JSON.stringify(guestSource)});
  const chunkBytes = 65536;
  const inventory = JSON.parse(api('inventory'));
  console.log('buffer-spike: inventory', JSON.stringify(inventory));
  const constructors = JSON.parse(api('constructor'));
  console.log('buffer-spike: constructors', JSON.stringify(constructors));
  const clone = { testedSeparately: true };
  const codecs = {
    guest: JSON.parse(api('codecs')),
    host: {
      toBase64: typeof Uint8Array.prototype.toBase64,
      fromBase64: typeof Uint8Array.fromBase64,
    },
  };
  const factory = JSON.parse(api('factory'));
  const memory = JSON.parse(api('wasmMemory'));
  const asyncCapabilities = await Promise.race([
    new Promise((resolve) => {
      api('asyncCapabilities', (value) => {
        resolve(JSON.parse(value));
      });
    }),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 3000)),
  ]);
  const wasm = JSON.parse(api('wasm'));
  console.log('buffer-spike: wasm', JSON.stringify(wasm));
  const sample = (label) => globalThis.__realmHeapSample(label);
  const encode = (view) => {
    if (typeof view.toBase64 === 'function') return view.toBase64();
    let binary = '';
    for (let start = 0; start < view.length; start += 8192)
      binary += String.fromCharCode(...view.subarray(start, start + 8192));
    return btoa(binary);
  };
  const exportBytes = (length, native = true) => {
    const result = new Uint8Array(length);
    let calls = 0,
      wireCharacters = 0;
    for (let offset = 0; offset < length; offset += chunkBytes) {
      const wire = api(native ? 'export' : 'exportManual', chunkBytes, offset);
      calls++;
      wireCharacters += wire.length;
      if (native && typeof Uint8Array.fromBase64 === 'function') {
        result.set(Uint8Array.fromBase64(wire), offset);
        continue;
      }
      const binary = atob(wire);
      for (let index = 0; index < binary.length; index++)
        result[offset + index] = binary.charCodeAt(index);
    }
    return { result, calls, wireCharacters };
  };
  const importBytes = (view) => {
    api('receiveStart', view.byteLength);
    let calls = 0;
    for (let offset = 0; offset < view.byteLength; offset += chunkBytes) {
      api('receive', encode(view.subarray(offset, offset + chunkBytes)), offset);
      calls++;
    }
    return calls;
  };
  const blocked = {};
  for (const operation of ['rawBuffer', 'rawView', 'rawPromise']) {
    try {
      api(operation);
      blocked[operation] = false;
    } catch (error) {
      blocked[operation] = error.name === 'TypeError';
    }
  }
  try {
    api('receive', new ArrayBuffer(8));
    blocked.hostObjectArgument = false;
  } catch (error) {
    blocked.hostObjectArgument = error.name === 'TypeError';
  }
  blocked.hostObjectResult =
    api('hostObjectResult', () => new ArrayBuffer(8)) === 'TypeError';
  let canvas = null;
  const asyncWasm = await Promise.race([
    new Promise((resolve) => {
      api('asyncWasm', (value) => {
        resolve(value);
      });
    }),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), 3000)),
  ]);
  if (!wasm.worked) api('pixels');
  {
    const view = exportBytes(4).result;
    const element = document.createElement('canvas');
    element.width = 1;
    element.height = 1;
    const context = element.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(view.buffer), 1, 1), 0, 0);
    canvas = {
      pixels: Array.from(context.getImageData(0, 0, 1, 1).data),
      calls: 1,
      bytes: 4,
      source: wasm.worked ? 'guest-wasm-memory' : 'guest-native-typed-array',
    };
  }
  const sizes = [];
  await sample('initial');
  for (const length of [65536, 1048576, 4194304, 16777216]) {
    api('create', length);
    await sample('guest ' + length);
    const began = performance.now();
    const copied = exportBytes(length);
    const milliseconds = performance.now() - began;
    let correct = true;
    for (let index = 0; index < length; index++)
      if (copied.result[index] !== ((index * 17 + 13) & 255)) {
        correct = false;
        break;
      }
    await sample('guest and host copy ' + length);
    sizes.push({
      bytes: length,
      milliseconds,
      calls: copied.calls,
      wireCharacters: copied.wireCharacters,
      correct,
    });
    api('release');
  }
  const length = 1048576;
  api('create', length);
  const guestDetachment = JSON.parse(api('detach'));
  const copyingStarted = performance.now();
  const outgoing = exportBytes(length);
  const copyToHostMs = performance.now() - copyingStarted;
  const worker = new Worker('/worker.js');
  const messages = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Native worker transfer timed out')),
      10000,
    );
    worker.onmessage = (event) => {
      messages.push(event.data);
      if (messages.length === 2) {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(event.message));
    };
  });
  const transferred = outgoing.result.buffer;
  const postStarted = performance.now();
  worker.postMessage(transferred, [transferred]);
  const hostDetachedBytes = transferred.byteLength;
  await completed;
  const workerRoundTripMs = performance.now() - postStarted;
  worker.terminate();
  const returned = messages.find((message) => message.type === 'buffer');
  const workerDetachedBytes = messages.find(
    (message) => message.type === 'detachment',
  ).byteLength;
  const returningStarted = performance.now();
  const returnCalls = importBytes(new Uint8Array(returned.buffer));
  const copyToGuestMs = performance.now() - returningStarted;
  const guestChecksum = api('checksum');
  const expectedChecksum = (length / 256) * 32640;
  await sample('worker round trip copied back');
  const manualSizes = [];
  for (const length of [65536, 1048576, 4194304, 16777216]) {
    api('create', length);
    const began = performance.now();
    const copied = exportBytes(length, false);
    const milliseconds = performance.now() - began;
    let correct = true;
    for (let index = 0; index < length; index++)
      if (copied.result[index] !== ((index * 17 + 13) & 255)) {
        correct = false;
        break;
      }
    manualSizes.push({
      bytes: length,
      milliseconds,
      calls: copied.calls,
      wireCharacters: copied.wireCharacters,
      correct,
    });
    api('release');
  }
  return {
    crossOriginIsolated,
    inventory,
    constructors,
    clone,
    codecs,
    factory,
    memory,
    wasm,
    asyncWasm,
    asyncCapabilities,
    blocked,
    canvas,
    chunkBytes,
    sizes,
    manualSizes,
    worker: {
      bytes: length,
      guestDetachment,
      hostDetachedBytes,
      workerDetachedBytes,
      receivedBytes: returned.receivedBytes,
      workerChecksum: returned.checksum,
      guestChecksum,
      expectedChecksum,
      copyToHostMs,
      workerRoundTripMs,
      copyToGuestMs,
      outgoingCalls: outgoing.calls,
      returnCalls,
    },
  };
})();
`;
  const result = await page.evaluate(probe);
  receipt.result = result;
  receipt.memory = samples;
  for (const value of Object.values(result.blocked)) assert.equal(value, true);
  assert.equal(result.inventory.document, 'undefined');
  assert.equal(result.inventory.fetch, 'undefined');
  assert.equal(result.inventory.Worker, 'undefined');
  assert.equal(result.inventory.__realmHeapSample, 'undefined');
  assert.deepEqual(result.canvas.pixels, [201, 47, 89, 255]);
  assert.equal(result.asyncCapabilities.document, 'undefined');
  assert.equal(result.asyncCapabilities.window, 'undefined');
  assert.equal(result.asyncCapabilities.hostSampler, 'undefined');
  assert.equal(result.asyncCapabilities.callbackConstructor, 'undefined');
  assert.equal(result.asyncCapabilities.factory.nativeGuestFunction, true);
  assert.equal(result.asyncCapabilities.factory.nativeGuestObject, true);
  assert.equal(result.asyncCapabilities.factory.lexical, 'undefined');
  if (result.factory.worked) {
    assert.equal(result.factory.nativeGuestFunction, true);
    assert.equal(result.factory.nativeGuestObject, true);
    assert.equal(result.factory.lexical, 'undefined');
    assert.equal(result.factory.ambient, 'undefined');
  }
  for (const size of [...result.sizes, ...result.manualSizes]) {
    assert(size.correct);
    assert.equal(size.calls, Math.ceil(size.bytes / result.chunkBytes));
  }
  assert.equal(result.worker.guestDetachment.originalBytes, 0);
  assert.equal(result.worker.guestDetachment.viewBytes, 0);
  assert.equal(result.worker.hostDetachedBytes, 0);
  assert.equal(result.worker.workerDetachedBytes, 0);
  assert.equal(result.worker.workerChecksum, result.worker.expectedChecksum);
  assert.equal(result.worker.guestChecksum, result.worker.expectedChecksum);
  if (result.wasm.worked) {
    assert.equal(result.wasm.read, 201);
    assert.equal(result.wasm.detachedAfterGrow, 0);
    assert.equal(result.wasm.guestBuffer, true);
    assert.equal(result.asyncWasm, 0);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  receipt.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await mkdir('results/realms', { recursive: true });
  await writeFile('results/realms/buffers.json', JSON.stringify(receipt, null, 2) + '\n');
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
