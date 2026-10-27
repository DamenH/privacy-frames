import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scriptDependencies,
  relocateImportMeta,
} from '../src/installation/script-dependencies.ts';
import { relocateModule } from '../src/installation/modules.ts';
import { downloadWebsite } from '../src/installation/import-website.ts';
import type { ScriptDiscoveryEvent } from '../src/installation/resource-capture.ts';

const context = {
  realm: 'window' as const,
  sourceURL: 'https://publisher.test/scripts/main.js',
  baseURL: 'https://publisher.test/documents/',
  documentURL: 'https://publisher.test/documents/index.html',
};

test('worker URLs use the document base while import.meta URLs use the script source', () => {
  const code =
    'new Worker("./plain.js"); new Worker(new URL("./module.js", import.meta.url), {type:"module"}); new globalThis.SharedWorker("/shared.js");';
  const found = scriptDependencies(code, context);
  assert.deepEqual(
    found.references.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: 'worker', url: 'https://publisher.test/documents/plain.js' },
      { kind: 'worker', url: 'https://publisher.test/scripts/module.js' },
      { kind: 'shared-worker', url: 'https://publisher.test/shared.js' },
    ],
  );
  assert.equal(found.unresolved.length, 0);
  assert.equal(
    code.slice(found.references[0].start, found.references[0].end),
    'new Worker("./plain.js")',
  );
  assert.equal(found.references[0].sourceURL, context.sourceURL);
});

test('constant string expressions and a proven script element reveal script dependencies', () => {
  const found = scriptDependencies(
    'const directory="./chunks/"; const filename="worker.js"; new Worker(`${directory}${filename}`); const script=document.createElement("script"); script.src=directory+"classic.js"; script.setAttribute("src",new URL("./module.js",import.meta.url).href);',
    context,
  );
  assert.deepEqual(
    found.references.map((ref) => ref.url),
    [
      'https://publisher.test/documents/chunks/worker.js',
      'https://publisher.test/documents/chunks/classic.js',
      'https://publisher.test/scripts/module.js',
    ],
  );
});

test('comments, quoted code, unrelated src fields and shadowed browser constructors are ignored', () => {
  const found = scriptDependencies(
    `
    // new Worker("./comment.js");
    const example='new Worker("./quoted.js")';
    function local(Worker, document) { new Worker("./mock.js"); const s=document.createElement("script"); s.src="./fake.js"; }
    { const globalThis={Worker:()=>{}}; new globalThis.Worker("./local-global.js"); }
    const object={}; object.src="./not-a-script.js";
  `,
    context,
  );
  assert.deepEqual(found.references, []);
  assert.deepEqual(found.unresolved, []);
});

test('hoisted parameters, declarations and imports shadow constructors across their lexical scope', () => {
  for (const code of [
    'new Worker("./local.js"); function Worker() {}',
    'function f(){new Worker("./local.js");var Worker;}',
    'import Worker from "./library.js";new Worker("./local.js");',
    'function f(globalThis){new globalThis.Worker("./local.js");}',
  ])
    assert.deepEqual(scriptDependencies(code, context).references, []);
});

test('unknown expressions, mutable URLs and inline worker sources are recorded without guessing', () => {
  const found = scriptDependencies(
    'new Worker(configuration.worker); const address=new URL("./w.js",import.meta.url);new Worker(address);new Worker("data:text/javascript,postMessage(1)");new Worker("worker.js");',
    context,
  );
  assert.deepEqual(
    found.references.map((ref) => ref.url),
    ['https://publisher.test/documents/worker.js'],
  );
  assert.equal(found.unresolved.length, 3);
  assert(found.unresolved.every((ref) => ref.sourceURL === context.sourceURL));
});

test('importScripts uses the worker entry base even in an imported script', () => {
  const found = scriptDependencies(
    'importScripts("./one.js",new URL("./two.js",import.meta.url)); self.importScripts("../three.js");',
    {
      realm: 'worker',
      sourceURL: 'https://publisher.test/libraries/imported.js',
      baseURL: 'https://publisher.test/workers/entry.js',
    },
  );
  assert.deepEqual(
    found.references.map((ref) => ref.url),
    [
      'https://publisher.test/workers/one.js',
      'https://publisher.test/libraries/two.js',
      'https://publisher.test/three.js',
    ],
  );
  assert(found.references.every((ref) => ref.kind === 'worker-import'));
  assert.deepEqual(
    scriptDependencies('importScripts("./not-a-window-api.js")', context).references,
    [],
  );
});

test('inline module metadata uses its original document base rather than the extracted filename', () => {
  const found = scriptDependencies(
    'new Worker(import.meta.url);new Worker(new URL("./worker.js",import.meta.url));',
    {
      ...context,
      sourceURL: 'https://publisher.test/assets/__generated.js',
      moduleURL: 'https://publisher.test/assets/',
    },
  );
  assert.deepEqual(
    found.references.map((ref) => ref.url),
    ['https://publisher.test/assets/', 'https://publisher.test/assets/worker.js'],
  );
});

test('parser diagnostics and dynamic scope do not invent resource references', () => {
  assert.equal(scriptDependencies('function {', context).unresolved[0].kind, 'parse');
  assert.deepEqual(
    scriptDependencies('with (unknown) { new Worker("./unknown.js"); }', context)
      .references,
    [],
  );
  assert.deepEqual(
    scriptDependencies('eval(code);new Worker("./uncertain.js");', context).references,
    [],
  );
});

test('captured module and worker graphs propagate distinct execution bases without preloads', async () => {
  const originalFetch = globalThis.fetch;
  const entry = 'https://publisher.test/documents/index.html';
  const sources = new Map<string, [string, string]>([
    [
      entry,
      [
        'text/html',
        '<base href="https://publisher.test/assets/"><script type="module" src="js/main.js"></script>',
      ],
    ],
    [
      'https://publisher.test/assets/js/main.js',
      [
        'text/javascript',
        'import "./window-import.js"; new Worker("./workers/entry.js"); new Worker(new URL("./url-entry.js",import.meta.url)); const s=document.createElement("script");s.src="./later.js";',
      ],
    ],
    [
      'https://publisher.test/assets/js/window-import.js',
      ['text/javascript', 'new Worker("./second-entry.js");'],
    ],
    [
      'https://publisher.test/assets/js/url-entry.js',
      ['text/javascript', 'self.urlWorker = true;'],
    ],
    [
      'https://publisher.test/assets/workers/entry.js',
      ['text/javascript', 'importScripts("../../libraries/common.js");'],
    ],
    [
      'https://publisher.test/assets/second-entry.js',
      ['text/javascript', 'importScripts("../libraries/common.js");'],
    ],
    [
      'https://publisher.test/libraries/common.js',
      ['text/javascript', 'importScripts("./helper.js");'],
    ],
    [
      'https://publisher.test/assets/workers/helper.js',
      ['text/javascript', 'self.finished=true;'],
    ],
    [
      'https://publisher.test/assets/helper.js',
      ['text/javascript', 'self.finished=true;'],
    ],
    [
      'https://publisher.test/assets/later.js',
      ['text/javascript', 'globalThis.loaded=true;'],
    ],
  ]);
  const events: ScriptDiscoveryEvent[] = [];
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const value = sources.get(url);
    return value
      ? new Response(value[1], { headers: { 'content-type': value[0] } })
      : new Response('Missing', { status: 404 });
  };
  try {
    const app = await downloadWebsite(entry, {
      onDiscovery: (event) => events.push(event),
    });
    assert.equal(app.documentBase, 'https://publisher.test/assets/');
    const main = app.resources.find(
      (resource) => resource.url === 'https://publisher.test/assets/js/main.js',
    )!;
    assert(main.path.startsWith('resources/'));
    assert(
      new TextDecoder()
        .decode(main.bytes)
        .includes('(\"https://publisher.test/assets/js/main.js\")'),
    );
    for (const url of sources.keys())
      assert(
        app.resources.some((resource) => resource.url === url),
        url,
      );
    assert(!requested.includes('https://publisher.test/libraries/helper.js'));
    const imported = events.filter(
      (event) => event.sourceURL === 'https://publisher.test/libraries/common.js',
    );
    assert.deepEqual(imported.map((event) => event.execution.baseURL).sort(), [
      'https://publisher.test/assets/second-entry.js',
      'https://publisher.test/assets/workers/entry.js',
    ]);
    assert(imported.every((event) => event.execution.realm === 'worker'));
    assert.equal(app.preparation.outcome.status, 'absent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dependency analysis never executes publisher expressions or arbitrary loader functions', () => {
  const found = scriptDependencies(
    'throw new Error("Publisher code must not execute"); arbitraryLoader("./not-known.js"); new Worker("./declared.js");',
    context,
  );
  assert.deepEqual(
    found.references.map((ref) => ref.url),
    ['https://publisher.test/documents/declared.js'],
  );
});

test('import.meta relocation changes parsed values without touching comments or bundled worker strings', async () => {
  const original =
    'import x from "./dep.js"; const worker=new URL("./worker.js",import.meta.url); const quoted="import.meta.url"; const bundled=`postMessage(import.meta.url)`; // import.meta.url';
  const rewritten = relocateImportMeta(original, context.sourceURL);
  assert(
    rewritten.includes(
      'new URL("./worker.js",("https://publisher.test/scripts/main.js"))',
    ),
  );
  assert(rewritten.includes('const quoted="import.meta.url"'));
  assert(rewritten.includes('const bundled=`postMessage(import.meta.url)`'));
  assert(rewritten.endsWith('// import.meta.url'));
  const relocated = await relocateModule(
    rewritten,
    context.sourceURL,
    'resources/main.js',
    new Map([['https://publisher.test/scripts/dep.js', 'resources/dep-hash.js']]),
  );
  assert(relocated.startsWith('import x from "./dep-hash.js";'));
});

test('mutable or escaped import.meta objects are not rewritten as immutable values', () => {
  for (const code of [
    'import.meta.url="./override.js";new Worker(import.meta.url);',
    'configure(import.meta);new Worker(import.meta.url);',
    'import.meta[key]="./override.js";new Worker(import.meta.url);',
  ]) {
    assert.equal(relocateImportMeta(code, context.sourceURL), code);
    assert.equal(scriptDependencies(code, context).references.length, 0);
    assert.equal(scriptDependencies(code, context).unresolved.length, 1);
  }
});

test('fresh nested URL bases resolve without evaluating publisher functions', () => {
  const found = scriptDependencies(
    'new Worker(new URL("entry.js",new URL("../workers/",import.meta.url)))',
    context,
  );
  assert.deepEqual(
    found.references.map((reference) => reference.url),
    ['https://publisher.test/workers/entry.js'],
  );
});
