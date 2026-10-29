import type { RealmCallable, RealmValue } from '../realms/types.ts';

/** Bounded experimental adapter: numeric FFI and one mirrored memory per instance. */
export function createWasmContract() {
  const modules = new Map<number, WebAssembly.Module>();
  const memories = new Map<number, WebAssembly.Memory>();
  const instances = new Map<number, WebAssembly.Instance>();
  const identities = new WeakMap<WebAssembly.Memory, number>();
  let next = 1;
  let active = true;
  const metrics = { bytesToHost: 0, bytesToGuest: 0, copyCalls: 0, ffiCalls: 0 };
  const chunkSize = 65536;
  function integer(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new TypeError('Expected nonnegative integer');
    return value;
  }
  function memory(id: unknown): WebAssembly.Memory {
    const value = memories.get(integer(id));
    if (!value) throw new TypeError('Unknown memory handle');
    return value;
  }
  function memoryHandle(value: WebAssembly.Memory): number {
    const existing = identities.get(value);
    if (existing !== undefined) return existing;
    const id = next++;
    identities.set(value, id);
    memories.set(id, value);
    return id;
  }
  function decode(value: unknown): Uint8Array<ArrayBuffer> {
    if (typeof value !== 'string' || value.length > 1500000)
      throw new TypeError('Invalid bounded base64 payload');
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  function encode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  const call: RealmCallable = (operation, payload, callback) => {
    try {
      if (!active) throw new Error('Wasm authority was revoked');
      if (typeof payload !== 'string') throw new TypeError('Invalid Wasm request');
      const args: unknown = JSON.parse(payload);
      if (!Array.isArray(args)) throw new TypeError('Expected argument list');
      let value: unknown;
      switch (operation) {
        case 'module': {
          const bytes = decode(args[0]);
          const module = new WebAssembly.Module(bytes);
          const imports = WebAssembly.Module.imports(module);
          if (imports.some((entry) => !['function', 'memory'].includes(entry.kind)))
            throw new TypeError('Only function and memory imports are supported');
          if (imports.filter((entry) => entry.kind === 'memory').length > 1)
            throw new TypeError('Only one memory is supported');
          const id = next++;
          modules.set(id, module);
          value = { id, imports };
          break;
        }
        case 'memory': {
          const initial = integer(args[0]);
          const maximum = integer(args[1]);
          if (initial > maximum || maximum > 256)
            throw new RangeError('Memory prototype is limited to 256 pages');
          value = memoryHandle(new WebAssembly.Memory({ initial, maximum }));
          break;
        }
        case 'size':
          value = memory(args[0]).buffer.byteLength;
          break;
        case 'grow':
          value = memory(args[0]).grow(integer(args[1]));
          break;
        case 'write': {
          const target = new Uint8Array(memory(args[0]).buffer);
          const offset = integer(args[1]);
          const bytes = decode(args[2]);
          if (bytes.length > chunkSize || offset + bytes.length > target.length)
            throw new RangeError('Memory write exceeds batch or buffer bounds');
          target.set(bytes, offset);
          metrics.bytesToHost += bytes.length;
          metrics.copyCalls++;
          break;
        }
        case 'read': {
          const source = new Uint8Array(memory(args[0]).buffer);
          const offset = integer(args[1]);
          const length = integer(args[2]);
          if (length > chunkSize || offset + length > source.length)
            throw new RangeError('Memory read exceeds batch or buffer bounds');
          value = encode(source.subarray(offset, offset + length));
          metrics.bytesToGuest += length;
          metrics.copyCalls++;
          break;
        }
        case 'instance': {
          const module = modules.get(integer(args[0]));
          if (!module || typeof callback !== 'function')
            throw new TypeError('Invalid instance request');
          const supplied: unknown = args[1];
          if (!Array.isArray(supplied)) throw new TypeError('Invalid import handles');
          const imports: WebAssembly.Imports = Object.create(null);
          const descriptors = WebAssembly.Module.imports(module);
          for (let index = 0; index < descriptors.length; index++) {
            const entry = descriptors[index];
            const namespace = (imports[entry.module] ??= Object.create(null));
            const id = integer(supplied[index]);
            namespace[entry.name] =
              entry.kind === 'memory'
                ? memory(id)
                : (...numbers: number[]) => {
                    if (numbers.some((number) => typeof number !== 'number'))
                      throw new TypeError('Only numeric Wasm imports are supported');
                    const result = callback(id, ...numbers);
                    if (result !== undefined && typeof result !== 'number')
                      throw new TypeError('Only numeric import results are supported');
                    return result;
                  };
          }
          const instance = new WebAssembly.Instance(module, imports);
          const id = next++;
          instances.set(id, instance);
          value = {
            id,
            exports: Object.entries(instance.exports).map(([name, item]) => {
              if (item instanceof WebAssembly.Memory)
                return { name, kind: 'memory', id: memoryHandle(item) };
              if (typeof item === 'function') return { name, kind: 'function' };
              throw new TypeError('Only memory and function exports are supported');
            }),
          };
          break;
        }
        case 'function': {
          const instance = instances.get(integer(args[0]));
          if (!instance || typeof args[1] !== 'string')
            throw new TypeError('Unknown exported function');
          const exported = instance.exports[args[1]];
          if (typeof exported !== 'function') throw new TypeError('Not a function');
          // Callable arguments preserve NaN, infinities and negative zero across the wire.
          return (...numbers: RealmValue[]) => {
            if (!active) throw new Error('Wasm authority was revoked');
            if (numbers.some((number) => typeof number !== 'number'))
              throw new TypeError('Only numeric Wasm parameters are supported');
            metrics.ffiCalls++;
            const result: unknown = Reflect.apply(exported, undefined, numbers);
            if (result !== undefined && typeof result !== 'number')
              throw new TypeError('Only numeric Wasm results are supported');
            return result;
          };
        }
        default:
          throw new TypeError('Unknown Wasm operation');
      }
      return JSON.stringify({ ok: true, value });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? { name: error.name, message: error.message } : {},
      });
    }
  };
  return {
    call,
    metrics,
    revoke() {
      active = false;
      modules.clear();
      memories.clear();
      instances.clear();
    },
  };
}

/** This entire function executes in the guest; only primitives/callables cross. */
export function installWasmContract(host: RealmCallable): void {
  const NativeMemory = WebAssembly.Memory;
  const memoryHandles = new WeakMap<object, number>();
  const moduleHandles = new WeakMap<object, { id: number; imports: Import[] }>();
  const mirrors = new Map<number, InstanceType<typeof NativeMemory>>();
  type Import = { module: string; name: string; kind: string };
  type Packet = {
    ok: boolean;
    value?: unknown;
    error?: { name: string; message: string };
  };
  function invoke(operation: string, args: unknown[], callback?: RealmCallable): unknown {
    const result = host(operation, JSON.stringify(args), callback);
    if (typeof result === 'function') return result;
    if (typeof result !== 'string') throw new TypeError('Invalid Wasm reply');
    const packet: Packet = JSON.parse(result);
    if (!packet.ok) {
      const error = new Error(packet.error?.message || 'Wasm operation refused');
      error.name = packet.error?.name || 'Error';
      throw error;
    }
    return packet.value;
  }
  function encode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function decode(value: unknown): Uint8Array {
    if (typeof value !== 'string') throw new TypeError('Invalid memory bytes');
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  function pull(): void {
    for (const [id, mirror] of mirrors) {
      const size = invoke('size', [id]);
      if (typeof size !== 'number') throw new TypeError('Invalid memory size');
      if (size > mirror.buffer.byteLength)
        mirror.grow((size - mirror.buffer.byteLength) / 65536);
      const bytes = new Uint8Array(mirror.buffer);
      for (let offset = 0; offset < size; offset += 65536)
        bytes.set(
          decode(invoke('read', [id, offset, Math.min(65536, size - offset)])),
          offset,
        );
    }
  }
  function push(): void {
    for (const [id, mirror] of mirrors) {
      const size = invoke('size', [id]);
      if (typeof size !== 'number') throw new TypeError('Invalid memory size');
      if (mirror.buffer.byteLength > size)
        invoke('grow', [id, (mirror.buffer.byteLength - size) / 65536]);
      const bytes = new Uint8Array(mirror.buffer);
      for (let offset = 0; offset < bytes.length; offset += 65536)
        invoke('write', [id, offset, encode(bytes.subarray(offset, offset + 65536))]);
    }
  }
  class MemoryFacade {
    readonly #native: InstanceType<typeof NativeMemory>;
    constructor(descriptor: { initial: number; maximum: number }) {
      const id = invoke('memory', [descriptor.initial, descriptor.maximum]);
      if (typeof id !== 'number') throw new TypeError('Invalid memory identity');
      this.#native = new NativeMemory(descriptor);
      memoryHandles.set(this, id);
      mirrors.set(id, this.#native);
    }
    get buffer() {
      return this.#native.buffer;
    }
    grow(delta: number) {
      // A native guest grow supplies real guest-realm detachment semantics.
      return this.#native.grow(delta);
    }
  }
  class ModuleFacade {
    constructor(bytes: ArrayBuffer | ArrayBufferView) {
      const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      const result = invoke('module', [encode(view)]);
      if (
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        !('imports' in result)
      )
        throw new TypeError('Invalid module metadata');
      if (typeof result.id !== 'number' || !Array.isArray(result.imports))
        throw new TypeError('Invalid module identity');
      moduleHandles.set(this, { id: result.id, imports: result.imports });
    }
  }
  class InstanceFacade {
    readonly exports: Record<string, unknown>;
    constructor(module: ModuleFacade, imports: Record<string, Record<string, unknown>>) {
      const metadata = moduleHandles.get(module);
      if (!metadata) throw new TypeError('Unknown guest module');
      const callbacks = new Map<number, (...numbers: number[]) => unknown>();
      const importedMemories = new Map<number, object>();
      const ids = metadata.imports.map((entry, index) => {
        const item = imports[entry.module]?.[entry.name];
        if (entry.kind === 'memory') {
          if (!item || typeof item !== 'object')
            throw new TypeError('Invalid memory import');
          const id = memoryHandles.get(item);
          if (id === undefined) throw new TypeError('Unknown guest memory');
          importedMemories.set(id, item);
          return id;
        }
        if (typeof item !== 'function') throw new TypeError('Invalid function import');
        callbacks.set(index, (...numbers) => Reflect.apply(item, undefined, numbers));
        return index;
      });
      push();
      const result = invoke('instance', [metadata.id, ids], (id, ...numbers) => {
        if (
          typeof id !== 'number' ||
          numbers.some((number) => typeof number !== 'number')
        )
          throw new TypeError('Invalid callback');
        const callback = callbacks.get(id);
        if (!callback) throw new TypeError('Unknown callback');
        pull();
        try {
          const value = Reflect.apply(callback, undefined, numbers);
          if (value !== undefined && typeof value !== 'number')
            throw new TypeError('Only numeric callback results are supported');
          return value;
        } finally {
          push();
        }
      });
      if (
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        !('exports' in result)
      )
        throw new TypeError('Invalid instance metadata');
      if (typeof result.id !== 'number' || !Array.isArray(result.exports))
        throw new TypeError('Invalid instance identity');
      this.exports = Object.create(null);
      for (const entry of result.exports) {
        if (entry.kind === 'memory') {
          const imported = importedMemories.get(entry.id);
          if (!imported)
            throw new TypeError('Defined memory exports are not yet supported');
          this.exports[entry.name] = imported;
        } else {
          const callable = invoke('function', [result.id, entry.name]);
          if (typeof callable !== 'function')
            throw new TypeError('Invalid exported function');
          this.exports[entry.name] = (...numbers: number[]) => {
            push();
            try {
              return callable(...numbers);
            } finally {
              pull();
            }
          };
        }
      }
      pull();
    }
  }
  Object.defineProperty(globalThis, 'WebAssembly', {
    configurable: true,
    value: Object.freeze({
      Module: ModuleFacade,
      Instance: InstanceFacade,
      Memory: MemoryFacade,
    }),
  });
}
