import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

// Independent Wasm fixture: one imported memory, numeric callback, byte IO and grow.
const string = (value: string) => [value.length, ...Buffer.from(value)];
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
const body = (instructions: number[]) => [
  instructions.length + 2,
  0,
  ...instructions,
  11,
];
const bytes = [
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  ...section(1, [3, 96, 1, 127, 1, 127, 96, 2, 127, 127, 1, 127, 96, 0, 1, 127]),
  ...section(2, [
    2,
    ...string('env'),
    ...string('memory'),
    2,
    1,
    1,
    4,
    ...string('env'),
    ...string('observe'),
    0,
    0,
  ]),
  ...section(3, [4, 0, 1, 0, 0]),
  ...section(7, [
    5,
    ...string('memory'),
    2,
    0,
    ...string('read'),
    0,
    1,
    ...string('write'),
    0,
    2,
    ...string('grow'),
    0,
    3,
    ...string('invoke'),
    0,
    4,
  ]),
  ...section(10, [
    4,
    ...body([32, 0, 45, 0, 0]),
    ...body([32, 0, 32, 1, 58, 0, 0, 32, 1]),
    ...body([32, 0, 64, 0]),
    ...body([65, 0, 32, 0, 58, 0, 0, 32, 0, 16, 0, 65, 1, 45, 0, 0, 106]),
  ]),
];
const exercise = `(() => {
  const memory = new WebAssembly.Memory({initial:1,maximum:4});
  const initialBuffer = memory.buffer;
  const initialView = new Uint8Array(initialBuffer);
  let callbackSaw = 0;
  let callbackOldBuffer;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(${JSON.stringify(bytes)})), {
    env: {memory, observe(value) {
      callbackSaw = new Uint8Array(memory.buffer)[0];
      new Uint8Array(memory.buffer)[1] = 31;
      callbackOldBuffer = memory.buffer;
      memory.grow(1);
      new Uint8Array(memory.buffer)[65536] = 77;
      return value - 4;
    }}
  });
  const output = instance.exports;
  initialView[10] = 201;
  const read = output.read(10);
  output.write(11,47);
  const written = new Uint8Array(memory.buffer)[11];
  const callbackResult = output.invoke(9);
  const callbackGrowth = memory.buffer.byteLength;
  const callbackDetached = callbackOldBuffer.byteLength === 0;
  const callbackWritten = output.read(65536);
  const beforeWasmGrow = memory.buffer;
  const growPrevious = output.grow(1);
  const wasmGrowDetached = beforeWasmGrow.byteLength === 0;
  return JSON.stringify({read,written,callbackSaw,callbackResult,callbackGrowth,callbackDetached,
    callbackWritten,growPrevious,wasmGrowDetached,pages:memory.buffer.byteLength/65536,
    originalDetached:initialBuffer.byteLength===0 && initialView.byteLength===0,
    exportIdentity:output.memory===memory,guestBuffer:memory.buffer instanceof ArrayBuffer});
})()`;
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      import {createApplicationRealm} from './src/runtime/realms/index.ts';
      import {createWasmContract,installWasmContract} from './src/runtime/capabilities/wasm-contract.ts';
      globalThis.runWasmProbe = backend => {
        const native = JSON.parse((0,eval)(${JSON.stringify(exercise)}));
        const bridge=createWasmContract();
        const realm=createApplicationRealm(backend);
        try {
          const install=realm.evaluate('('+installWasmContract.toString()+')');
          install(bridge.call);
          const start=performance.now();
          const result=JSON.parse(realm.evaluate(${JSON.stringify(exercise)}));
          const elapsedMs=performance.now()-start;
          let objectRejected=false;
          try {realm.evaluate('(host)=>host("memory",[])')(bridge.call)}catch{objectRejected=true}
          const unsupported=JSON.parse(realm.evaluate('JSON.stringify((()=>{let invalidModule=false,oversizedMemory=false;try{new WebAssembly.Module(new Uint8Array([1,2,3]))}catch{invalidModule=true}try{new WebAssembly.Memory({initial:1,maximum:257})}catch{oversizedMemory=true}return {invalidModule,oversizedMemory}})())'));
          const metrics={...bridge.metrics};
          bridge.revoke();
          let revoked=false;
          try {realm.evaluate('new WebAssembly.Memory({initial:1,maximum:4});void 0')}catch{revoked=true}
          return {native,result,elapsedMs,metrics,unsupported,objectRejected,revoked};
        } finally {bridge.revoke();realm.revoke()}
      };
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  );
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (request.url === '/probe.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script src="/probe.js"></script>');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const rows = [];
let failure = false;
try {
  for (const [engine, backend, args] of [
    [chromium, 'native', ['--js-flags=--harmony-shadow-realm']],
    [chromium, 'membrane', []],
    [firefox, 'membrane', []],
  ] as const) {
    const browser = await launch(engine, { args: [...args] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const result = await page.evaluate(
        (backend) => globalThis.runWasmProbe(backend),
        backend,
      );
      assert.deepEqual(result.result, result.native);
      assert.deepEqual(result.result, {
        read: 201,
        written: 47,
        callbackSaw: 9,
        callbackResult: 36,
        callbackGrowth: 131072,
        callbackDetached: true,
        callbackWritten: 77,
        growPrevious: 2,
        wasmGrowDetached: true,
        pages: 3,
        originalDetached: true,
        exportIdentity: true,
        guestBuffer: true,
      });
      assert(result.unsupported.invalidModule);
      assert(result.unsupported.oversizedMemory);
      assert(result.objectRejected);
      assert(result.revoked);
      rows.push({
        browser: engine.name(),
        version: browser.version(),
        backend,
        passed: true,
        ...result,
      });
    } catch (error) {
      failure = true;
      rows.push({
        browser: engine.name(),
        version: browser.version(),
        backend,
        passed: false,
        error: String(error),
      });
    } finally {
      await browser.close();
    }
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const path = 'src/runtime/capabilities/wasm-contract.ts';
  const source = await readFile(path);
  await mkdir('results/realms', { recursive: true });
  await writeFile(
    'results/realms/wasm-contract.json',
    JSON.stringify(
      {
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        contract: {
          path,
          sha256: createHash('sha256').update(source).digest('hex'),
          bytes: source.length,
          lines: source.toString().split('\n').length,
        },
        scope:
          'Numeric imports/exports and one imported memory; guest owns native mirror, host compiles Wasm bytes only. Not a full WebAssembly facade or production integration.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) process.exitCode = 1;
