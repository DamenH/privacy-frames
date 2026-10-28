import assert from 'node:assert/strict';
import test from 'node:test';
import { amdDependencies } from '../src/installation/amd-dependencies.ts';
import { downloadWebsite } from '../src/installation/import-website.ts';

const context = {
  realm: 'window' as const,
  sourceURL: 'https://publisher.test/code/entry.js',
  baseURL: 'https://publisher.test/page/',
  documentURL: 'https://publisher.test/page/',
};
const urls = (code: string) =>
  amdDependencies(code, context)
    .references.map((item) => item.url)
    .sort();

test('AMD arrays and factory require arguments become relative script dependencies', () => {
  assert.deepEqual(
    urls(
      'define(["require","exports","module","./common","../shared.js"],function(load,exports,module){const lazy=load("./lazy");load(["./one","./two.js"],()=>{});});',
    ),
    [
      'https://publisher.test/code/common.js',
      'https://publisher.test/code/lazy.js',
      'https://publisher.test/code/one.js',
      'https://publisher.test/code/two.js',
      'https://publisher.test/shared.js',
    ].sort(),
  );
});

test('inlined AMD modules use a static logical address consumed by their loader', () => {
  const found = urls(
    'self.bootstrapAddress=location.origin+"/assets/inlined.js";self.define=(deps,factory)=>{const address=self.bootstrapAddress||document.currentScript.src||location.href;const load=id=>new URL(id+".js",address);};define(["require","exports"],function(importModule,exports){importModule("./lazy");});',
  );
  assert.deepEqual(found, ['https://publisher.test/assets/lazy.js']);
});

test('unrelated metadata does not change AMD resolution and URLs inside comments or strings are inert', () => {
  assert.deepEqual(
    urls(
      'self.unrelated="https://ignored.test/wrong.js";self.define=(deps,factory)=>{const address=document.currentScript.src;};/* define(["./comment"]) */const text="define([\\\"./string\\\"])";define(["./real"],function(){});',
    ),
    ['https://publisher.test/code/real.js'],
  );
});

test('shadowed define and factory require parameters do not create dependencies', () => {
  assert.deepEqual(
    urls(
      'function wrapper(define){define(["./ignored"],function(){});}define(["require"],function(require){function nested(require){require("./ignored-too");}require("./real");});',
    ),
    ['https://publisher.test/code/real.js'],
  );
});

test('plugin and configured bare IDs are not guessed; dynamic calls retain diagnostics', () => {
  const found = amdDependencies(
    'define(["require","text!./template","package"],function(load){load(runtimeValue);});',
    context,
  );
  assert.deepEqual(found.references, []);
  assert.equal(found.unresolved.length, 1);
});

test('AMD module metadata resolves assets and worker entries while exported paths remain resources', () => {
  const found = amdDependencies(
    'define(["module","exports"],function(metadata,output){new URL("./codec.wasm",metadata.uri);new Worker(new URL("./compute.js",metadata.uri));output.styles="./styles.css";function hidden(metadata){new URL("./ignored.wasm",metadata.uri)}});',
    context,
  );
  assert.deepEqual(
    found.references.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: 'resource', url: 'https://publisher.test/code/codec.wasm' },
      { kind: 'worker', url: 'https://publisher.test/code/compute.js' },
      { kind: 'resource', url: 'https://publisher.test/code/styles.css' },
    ],
  );
});

test('installation captures an inline AMD graph and worker imports without running factories', async () => {
  const source = 'https://publisher.test/page/';
  const originalFetch = globalThis.fetch;
  const bodies = new Map<string, [string, string]>([
    [
      source,
      [
        'text/html',
        '<!doctype html><script>self.logicalScript=location.origin+"/modules/boot.js";self.define=(deps,factory)=>{const base=self.logicalScript||document.currentScript.src;};define(["require","module"],function(load,module){load("./lazy");new Worker(new URL("./compute.js",module.uri));new URL("./codec.wasm",module.uri);throw new Error("Do not execute this factory")});self.logicalScript="";</script>',
      ],
    ],
    [
      'https://publisher.test/modules/lazy.js',
      ['text/javascript', 'define(["./common"],function(common){});'],
    ],
    [
      'https://publisher.test/modules/common.js',
      ['text/javascript', 'define(["exports"],function(exports){exports.answer=42});'],
    ],
    [
      'https://publisher.test/modules/compute.js',
      ['text/javascript', 'importScripts("./nested.js");'],
    ],
    ['https://publisher.test/modules/nested.js', ['text/javascript', 'self.answer=42;']],
    [
      'https://publisher.test/modules/codec.wasm',
      ['application/wasm', 'synthetic binary asset'],
    ],
  ]);
  globalThis.fetch = async (input) => {
    const body = bodies.get(String(input));
    return body
      ? new Response(body[1], { headers: { 'content-type': body[0] } })
      : new Response('Missing', { status: 404 });
  };
  try {
    const installed = await downloadWebsite(source);
    for (const url of bodies.keys())
      assert(
        installed.resources.some((item) => item.url === url),
        url,
      );
    assert(installed.resources.some((item) => item.path.endsWith('.wasm')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UMD and CommonJS branches do not invent AMD downloads without a loader in the realm', async () => {
  const source = 'https://publisher.test/page/';
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === source)
      return new Response('<script src="bundle.js"></script>', {
        headers: { 'content-type': 'text/html' },
      });
    if (url.endsWith('/bundle.js'))
      return new Response(
        'if(typeof define==="function"&&define.amd){define(["require","./core"],function(require){require("./format")})}else{const require=id=>({});require("./bundled")}',
        {
          headers: { 'content-type': 'text/javascript' },
        },
      );
    return new Response('Missing', { status: 404 });
  };
  try {
    const app = await downloadWebsite(source);
    assert.equal(app.resources.length, 2);
    for (const path of ['core.js', 'format.js', 'bundled.js'])
      assert(!requested.some((url) => url.endsWith('/' + path)), path);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
