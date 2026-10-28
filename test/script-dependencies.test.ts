import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptDependencies } from '../src/installation/script-dependencies.ts';
import { relocateImportMeta } from '../src/shared/module-source.ts';
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

test('proven native audio and paint worklet receivers reveal constant addModule URLs', () => {
  const result = scriptDependencies(
    `
    const context = new AudioContext();
    const audio = context.audioWorklet;
    audio.addModule('./processor.js');
    new globalThis.OfflineAudioContext(1, 128, 44100).audioWorklet.addModule(new URL('./offline.js', import.meta.url));
    const paint = CSS.paintWorklet;
    paint.addModule('/paint.js');
    window.CSS.paintWorklet.addModule('./second-paint.js');
  `,
    context,
  );
  assert.deepEqual(
    result.references.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: 'audio-worklet', url: 'https://publisher.test/documents/processor.js' },
      { kind: 'audio-worklet', url: 'https://publisher.test/scripts/offline.js' },
      { kind: 'paint-worklet', url: 'https://publisher.test/paint.js' },
      { kind: 'paint-worklet', url: 'https://publisher.test/documents/second-paint.js' },
    ],
  );
  assert.equal(result.unresolved.length, 0);
});

test('unrelated addModule methods, shadowed constructors and unknown audio objects do not invent downloads', () => {
  const result = scriptDependencies(
    `
    const unknown = getAudioContext(); unknown.audioWorklet.addModule('./unknown.js');
    const fake = { addModule() {} }; fake.addModule('./fake.js');
    function local(AudioContext, CSS) { new AudioContext().audioWorklet.addModule('./local.js'); CSS.paintWorklet.addModule('./local-paint.js'); }
    const real = new AudioContext(); real.audioWorklet.addModule(configuration.url);
    real.audioWorklet.addModule('blob:https://publisher.test/runtime-module');
  `,
    context,
  );
  assert.deepEqual(result.references, []);
  assert.equal(result.unresolved.length, 2);
  assert(result.unresolved.every((item) => item.kind === 'audio-worklet'));
});

test('capture follows worklet static imports with a module-only execution context', async () => {
  const originalFetch = globalThis.fetch;
  const source = 'https://publisher.test/worklets/index.html';
  const values = new Map<string, [string, string]>([
    [source, ['<script src="main.js"></script>', 'text/html']],
    [
      'https://publisher.test/worklets/main.js',
      [
        'const context=new AudioContext();context.audioWorklet.addModule("./processor.js");',
        'text/javascript',
      ],
    ],
    [
      'https://publisher.test/worklets/processor.js',
      [
        'import "./dependency.js";registerProcessor("fixture",class extends AudioWorkletProcessor{});',
        'text/javascript',
      ],
    ],
    [
      'https://publisher.test/worklets/dependency.js',
      ['export const dependency=1;', 'text/javascript'],
    ],
  ]);
  const discovery: ScriptDiscoveryEvent[] = [];
  globalThis.fetch = async (input) => {
    const item = values.get(String(input));
    return item
      ? new Response(item[0], { headers: { 'Content-Type': item[1] } })
      : new Response('Absent', { status: 404 });
  };
  try {
    const app = await downloadWebsite(source, {
      onDiscovery: (event) => discovery.push(event),
    });
    assert(app.resources.some((resource) => resource.url.endsWith('/processor.js')));
    assert(app.resources.some((resource) => resource.url.endsWith('/dependency.js')));
    for (const filename of ['processor.js', 'dependency.js'])
      assert(
        discovery.some(
          (event) =>
            event.sourceURL.endsWith('/' + filename) &&
            event.execution.realm === 'worklet',
        ),
      );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native service-worker registration receivers are discovered without executing their source', () => {
  const found = scriptDependencies(
    'navigator.serviceWorker.register("./foreground.js"); const sw = window.navigator.serviceWorker;sw.register(new URL("../module-worker.js",import.meta.url),{type:"module"});function local(navigator){navigator.serviceWorker.register("./fake.js")};const unrelated={register(){}};unrelated.register("./not-sw.js");',
    context,
  );
  assert.deepEqual(
    found.references.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: 'service-worker', url: 'https://publisher.test/documents/foreground.js' },
      { kind: 'service-worker', url: 'https://publisher.test/module-worker.js' },
    ],
  );
  const imported = scriptDependencies(
    'importScripts("./library.js");new Worker("./not-a-service-worker-api.js");',
    {
      realm: 'service-worker',
      sourceURL: 'https://publisher.test/app/foreground.js',
      baseURL: 'https://publisher.test/app/foreground.js',
    },
  );
  assert.deepEqual(
    imported.references.map(({ kind, url }) => ({ kind, url })),
    [{ kind: 'worker-import', url: 'https://publisher.test/app/library.js' }],
  );
});

test('a declared nonconventional service worker and its classic imports are independent installation resources', async () => {
  const nativeFetch = globalThis.fetch;
  const source = 'https://publisher.test/foreground/index.html';
  const sources = new Map<string, [string, string]>([
    [source, ['<script src="main.js"></script>', 'text/html']],
    [
      'https://publisher.test/foreground/main.js',
      ['navigator.serviceWorker.register("./foreground.js");', 'text/javascript'],
    ],
    [
      'https://publisher.test/foreground/foreground.js',
      [
        'globalThis.__publisherSourceExecuted=true;importScripts("./library.js");self.addEventListener("fetch",event=>event.respondWith(fetch(event.request)));',
        'text/javascript',
      ],
    ],
    [
      'https://publisher.test/foreground/library.js',
      ['globalThis.workerLibrary=true;', 'text/javascript'],
    ],
  ]);
  globalThis.fetch = async (input) => {
    const value = sources.get(String(input));
    return value
      ? new Response(value[0], { headers: { 'Content-Type': value[1] } })
      : new Response('Not found', { status: 404 });
  };
  try {
    const discovery: ScriptDiscoveryEvent[] = [];
    const app = await downloadWebsite(source, {
      onDiscovery: (event) => discovery.push(event),
    });
    assert(app.resources.some((resource) => resource.url.endsWith('/foreground.js')));
    assert(app.resources.some((resource) => resource.url.endsWith('/library.js')));
    assert(
      discovery.some(
        (event) =>
          event.execution.realm === 'service-worker' &&
          event.sourceURL.endsWith('/foreground.js'),
      ),
    );
    assert.equal(Reflect.has(globalThis, '__publisherSourceExecuted'), false);
    // This Node fixture has no browser Worker. Optional preparation fails while
    // the independently discovered registration script and imports remain usable.
    assert.equal(app.preparation.outcome.status, 'failed');
    assert.equal(app.preparation.serviceWorker, null);
    assert.deepEqual(app.preparation.caches, []);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('local script loader functions reveal literal calls through single-assignment var bindings', () => {
  const result = scriptDependencies(
    `
    function loadScript(source) {
      var script = document.createElement('script');
      script.setAttribute('src', source);
      document.head.appendChild(script);
    }
    var directory = './chunks/';
    loadScript(directory + 'editor.js');
    loadScript(new URL('../helpers.js', import.meta.url).href);
    `,
    context,
  );
  assert.deepEqual(
    result.references.map((item) => item.url),
    [
      'https://publisher.test/documents/chunks/editor.js',
      'https://publisher.test/helpers.js',
    ],
  );
});

test('loader argument substitution follows nested wrappers without invoking publisher functions', () => {
  const result = scriptDependencies(
    `
    function append(source) {
      throw new Error('Do not execute me');
      var element = document.createElement('script');
      element.src = source;
    }
    const load = (name) => append('./parts/' + name);
    load('one.js');
    load('two.js');
    `,
    context,
  );
  assert.deepEqual(
    result.references.map((item) => item.url),
    [
      'https://publisher.test/documents/parts/one.js',
      'https://publisher.test/documents/parts/two.js',
    ],
  );
});

test('mutable loader functions, reassigned arguments and shadowed DOM factories stay unresolved', () => {
  for (const code of [
    `function load(source) {const s=document.createElement('script');s.src=source;}load=other;load('./unknown.js');`,
    `function load(source) {source=compute();const s=document.createElement('script');s.src=source;}load('./unknown.js');`,
    `function load(source,document) {const s=document.createElement('script');s.src=source;}load('./unknown.js',fake);`,
    `let path='./unknown.js';path=compute();const s=document.createElement('script');s.src=path;`,
  ])
    assert.deepEqual(scriptDependencies(code, context).references, [], code);
});

test('recursive loader analysis remains bounded and deduplicates repeated references', () => {
  const result = scriptDependencies(
    `function loop(source) {const s=document.createElement('script');s.src=source;loop(source);}loop('./one.js');loop('./one.js');`,
    context,
  );
  assert.deepEqual(
    result.references.map((item) => item.url),
    ['https://publisher.test/documents/one.js'],
  );
});

test('finite conditional service-worker paths are captured without guessing branch conditions', () => {
  const result = scriptDependencies(
    `var worker = stable ? './stable/foreground.js' : './foreground.js';navigator.serviceWorker.register(worker);`,
    context,
  );
  assert.deepEqual(
    result.references.map((item) => item.url),
    [
      'https://publisher.test/documents/stable/foreground.js',
      'https://publisher.test/documents/foreground.js',
    ],
  );
});

test('native fetch and XMLHttpRequest resource sinks capture constant URLs and ignore mocks', () => {
  const result = scriptDependencies(
    `
    fetch('./dictionary.txt');
    const request = new Request('./settings.json');window.fetch(request);
    var xhr = new XMLHttpRequest();xhr.open('GET', './theme.xml');
    function local(fetch, XMLHttpRequest) {fetch('./fake.txt');const xhr=new XMLHttpRequest();xhr.open('GET','./fake.xml');}
    const fake={open(){}};fake.open('GET','./unrelated.xml');
    `,
    context,
  );
  assert.deepEqual(
    result.references.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: 'resource', url: 'https://publisher.test/documents/dictionary.txt' },
      { kind: 'resource', url: 'https://publisher.test/documents/settings.json' },
      { kind: 'resource', url: 'https://publisher.test/documents/theme.xml' },
    ],
  );
});

test('resource fetch wrappers substitute arguments and preserve unresolved dynamic requests', () => {
  const result = scriptDependencies(
    `function get(path){return fetch(path);}get('./data.json');fetch(userInput);`,
    context,
  );
  assert.deepEqual(
    result.references.map((item) => item.url),
    ['https://publisher.test/documents/data.json'],
  );
  assert(result.unresolved.some((item) => item.kind === 'resource'));
});

test('global loader summaries cross scripts and resolve static object properties', () => {
  const bootstrap = scriptDependencies(
    `function inject(address){var script=document.createElement('script');script.src=address;}`,
    context,
  );
  assert.deepEqual(bootstrap.loaders, [
    { name: 'inject', argument: 0, kind: 'script', prefix: '', suffix: '' },
  ]);
  const consumer = scriptDependencies(
    `function Application(){}Application.LIBRARY='./library.js';inject(Application.LIBRARY);window.inject('./other.js');`,
    { ...context, loaders: bootstrap.loaders },
  );
  assert.deepEqual(
    consumer.references.map((reference) => reference.url),
    [
      'https://publisher.test/documents/library.js',
      'https://publisher.test/documents/other.js',
    ],
  );
});

test('loader summaries preserve argument positions and literal URL transformations', () => {
  const bootstrap = scriptDependencies(
    `const inject = (unused,name) => {const script=document.createElement('script');script.src='./chunks/'+name+'.js';};`,
    context,
  );
  assert.deepEqual(bootstrap.loaders, [
    { name: 'inject', argument: 1, kind: 'script', prefix: './chunks/', suffix: '.js' },
  ]);
  const consumer = scriptDependencies(`inject(null,'editor')`, {
    ...context,
    loaders: bootstrap.loaders,
  });
  assert.equal(
    consumer.references[0].url,
    'https://publisher.test/documents/chunks/editor.js',
  );
});

test('shadowed cross-script loaders and mutable member constants do not invent downloads', () => {
  const loaders = [
    { name: 'inject', kind: 'script' as const, argument: 0, prefix: '', suffix: '' },
  ];
  for (const code of [
    `function local(inject){inject('./mock.js')}`,
    `const window={inject(){}};window.inject('./mock.js')`,
    `function Application(){}Application.LIBRARY='./unknown.js';Application.LIBRARY=compute();inject(Application.LIBRARY);`,
    `function Application(){}Application.LIBRARY=Application.LIBRARY;inject(Application.LIBRARY);`,
    `function Application(){}Application.LIBRARY='./unknown.js';Application.LIBRARY+='?changed';inject(Application.LIBRARY);`,
    `function Application(){}Application.LIBRARY='./unknown.js';delete Application.LIBRARY;inject(Application.LIBRARY);`,
  ])
    assert.deepEqual(
      scriptDependencies(code, { ...context, loaders }).references,
      [],
      code,
    );
});
