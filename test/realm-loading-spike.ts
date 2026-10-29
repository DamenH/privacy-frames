import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { build } from './build.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launch } from './browser-profile.ts';

const requests: string[] = [];
const moduleSource =
  'export let value=1;export const object={value:1};export function read(){return value}export function increment(){value++;return value}export function identity(){return import.meta.url}export function globals(){return typeof document+":"+typeof fetch}export function probe(){return JSON.stringify({document:typeof document,fetch:typeof fetch,hostSecret:typeof globalThis.__hostSecret,guestMarker:globalThis.__guestMarker,hostArray:typeof Array.prototype.__hostRealmMarker,guestArray:Array.prototype.__guestRealmMarker})}';
const modules: Record<string, string> = {
  '/module.js': moduleSource,
  '/cycle-a.js':
    'import {readB} from "./cycle-b.js";export let value=2;export function readA(){return value}export function cycle(){return value+readB()}',
  '/cycle-b.js':
    'import {readA} from "./cycle-a.js";export function readB(){return readA()+1}',
  '/await.js': 'await Promise.resolve();export function ready(){return 42}',
  '/dynamic.js':
    'export async function load(){return (await import("./module.js")).read()}',
  '/early-a.js':
    'import {early} from "./early-b.js";export function hoisted(){return 42}export const observed=early;',
  '/early-b.js': 'import {hoisted} from "./early-a.js";export const early=hoisted();',
};
const temporary = await mkdtemp(path.join(tmpdir(), 'pf-system-loader-'));
let loaderSource: string;
try {
  execFileSync('npm', [
    'pack',
    'systemjs@6.15.1',
    '--pack-destination',
    temporary,
    '--silent',
  ]);
  loaderSource = execFileSync(
    'tar',
    ['-xOf', path.join(temporary, 'systemjs-6.15.1.tgz'), 'package/dist/s.js'],
    { encoding: 'utf8' },
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const compiledModules = Object.fromEntries(
  Object.entries(modules).map(([url, source]) => [
    url,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.System },
    }).outputText,
  ]),
);
const loaderBundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
import {createApplicationRealm} from './test/realm-research/realms/index.ts';
const backend=location.search.includes('shared-native')?'native':'membrane';
globalThis.__hostSecret='host-secret';Array.prototype.__hostRealmMarker='host-array';
const realm=createApplicationRealm(backend);
realm.evaluate('globalThis.__guestMarker="guest";Array.prototype.__guestRealmMarker="guest-array";void 0');
const sources=${JSON.stringify(compiledModules)};
const origin=location.origin;
const requested=[];
const getSource=url=>{const parsed=new URL(url);requested.push(url);if(parsed.origin!==origin||!Object.hasOwn(sources,parsed.pathname))throw new Error('Unadmitted source');return sources[parsed.pathname]};
const resolve=(id,parent)=>new URL(id,parent||origin+'/').href;
realm.evaluate('(function(document,self,global){'+${JSON.stringify(loaderSource)}+'})(undefined,undefined,globalThis);void 0');
const connect=realm.evaluate('(source,resolve)=>{const guestEval=(0,eval);Object.getPrototypeOf(System).resolve=(id,parent)=>resolve(id,parent);Object.getPrototypeOf(System).instantiate=function(url){guestEval(source(url));return this.getRegister(url)};return (base,report)=>{(async()=>{const m=await System.import(base+"/module.js");const first=m.read();const increment=m.increment();const live=m.read();const again=await System.import(base+"/module.js");const cycle=await System.import(base+"/cycle-a.js");const awaited=await System.import(base+"/await.js");const dynamic=await System.import(base+"/dynamic.js");const early=await System.import(base+"/early-a.js");let denied=false;try{await System.import(base+"/unadmitted.js")}catch{denied=true}report(JSON.stringify({first,increment,live,moduleIdentity:m===again,namespaceObject:typeof m.object,identity:m.identity(),cycle:cycle.cycle(),awaited:awaited.ready(),dynamic:await dynamic.load(),earlyCycle:early.observed,denied,moduleProbe:JSON.parse(m.probe()),guestGlobals:typeof document+":"+typeof fetch}));})().catch(error=>report(JSON.stringify({error:String(error)})));};}');
const run=connect(getSource,resolve);run(origin,value=>console.log('REALM_RESULT '+JSON.stringify({backend,requests:requested,value:JSON.parse(value)})));
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const cases = [
  'shared-native',
  'shared-membrane',
  'native-control',
  'native-classic-control',
  'evaluate',
  'importValue-classic',
  'importValue-module',
  'importValue-data',
  'guest-import-classic',
  'guest-import-module',
];
function bootstrap(kind: string) {
  const prefix = `const report=value=>console.log('REALM_RESULT '+JSON.stringify(value));`;
  if (kind === 'native-classic-control')
    return (
      prefix +
      `report({lexical,constant,variable,strictVariable,lexicalOwn:Object.hasOwn(globalThis,'lexical'),variableOwn:Object.hasOwn(globalThis,'variable'),order:sequence.join(',')});`
    );
  if (kind === 'native-control')
    return (
      prefix +
      `
const m=await import('/module.js');const cycle=await import('/cycle-a.js');const awaited=await import('/await.js');const dynamic=await import('/dynamic.js');const early=await import('/early-a.js');
report({read:m.read(),increment:m.increment(),live:m.read(),identity:m.identity(),cycle:cycle.cycle(),awaited:awaited.ready(),dynamic:await dynamic.load(),earlyCycle:early.observed,namespaceObject:typeof m.object});`
    );
  if (kind === 'evaluate')
    return (
      prefix +
      `
const realm=new ShadowRealm();const rows=[];
for(const source of ${JSON.stringify([
        'let lexical=1;void 0',
        'typeof lexical',
        'const constant=2;void 0',
        'typeof constant',
        'var variable=3;void 0',
        'variable',
        'Object.hasOwn(globalThis,"variable")',
        'Object.hasOwn(globalThis,"lexical")',
        'let lexical=4;lexical',
        '"use strict";var strictVariable=5;void 0',
        'typeof strictVariable',
        'var variable=6;variable',
        'globalThis.sequence=[];void 0',
        'sequence.push("first");Promise.resolve().then(()=>sequence.push("microtask"));void 0',
        'sequence.push("second");sequence.join(",")',
        '[typeof document,typeof fetch,typeof structuredClone,typeof Worker,typeof URL,typeof setTimeout].join(",")',
      ])}){try{rows.push({source,result:realm.evaluate(source)})}catch(error){rows.push({source,error:String(error)})}}
report({evaluations:rows});`
    );
  const target =
    kind === 'importValue-data'
      ? JSON.stringify('data:text/javascript,' + encodeURIComponent(moduleSource))
      : `location.origin+'/module.js'`;
  if (kind.startsWith('importValue'))
    return (
      prefix +
      `
const realm=new ShadowRealm();console.log('REALM_STAGE calling native importValue');
realm.importValue(${target},'read').then(read=>report({value:read()}),error=>report({error:String(error)}));`
    );
  return (
    prefix +
    `
const realm=new ShadowRealm();const load=realm.evaluate('(url,report)=>{import(url).then(m=>report(m.read()),error=>report(String(error)));}');
console.log('REALM_STAGE calling guest import');load(location.origin+'/module.js',value=>report({value}));`
  );
}
const server = http.createServer((request, response) => {
  if (process.env.REALM_COI) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  const url = new URL(request.url || '/', 'http://fixture.test');
  requests.push(url.pathname + url.search);
  if (url.pathname === '/scope-first.js' || url.pathname === '/scope-second.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      url.pathname === '/scope-first.js'
        ? 'let lexical=1;const constant=2;var variable=3;globalThis.sequence=["first"];Promise.resolve().then(()=>sequence.push("microtask"));'
        : '"use strict";var strictVariable=5;sequence.push("second");',
    );
  } else if (modules[url.pathname]) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(modules[url.pathname]);
  } else if (
    url.pathname === '/bootstrap.js' &&
    (url.searchParams.get('case') || '').startsWith('shared-')
  ) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(loaderBundle.outputFiles[0].text);
  } else if (url.pathname === '/bootstrap.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bootstrap(url.searchParams.get('case') || ''));
  } else {
    const kind = url.searchParams.get('case') || '';
    const module = kind === 'native-control' || kind.endsWith('-module');
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Realm loader probe</title>' +
        (kind === 'native-classic-control'
          ? '<script src="/scope-first.js"></script><script src="/scope-second.js"></script>'
          : '') +
        '<script ' +
        (module ? 'type="module" ' : '') +
        'src="/bootstrap.js?case=' +
        kind +
        '"></script>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = 'http://127.0.0.1:' + address.port;
const flags = [
  '--js-flags=--harmony-shadow-realm',
  ...(process.env.REALM_BLINK ? ['--enable-blink-features=ShadowRealm'] : []),
];
const executablePath = process.env.REALM_FULL_CHROME
  ? chromium.executablePath()
  : undefined;
const browser = await launch(chromium, {
  args: flags,
  ...(executablePath ? { executablePath } : {}),
});
const receipt = {
  provenance: {
    capturedAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runnerSHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
    scope:
      'Isolated actual native engine spike; no production artifacts built or loaded.',
  },
  browser: browser.version(),
  flags,
  crossOriginIsolationHeaders: Boolean(process.env.REALM_COI),
  executable: executablePath || 'Playwright default headless shell',
  systemRegisterProof: {
    loaderVersion: 'systemjs@6.15.1',
    emittedHarnessBytes: loaderBundle.outputFiles[0].contents.byteLength,
    emittedHarnessSHA256: createHash('sha256')
      .update(loaderBundle.outputFiles[0].contents)
      .digest('hex'),
    fixtureCompilerOnly: true,
    loaderBytes: Buffer.byteLength(loaderSource),
    loaderLines: loaderSource.split('\n').length,
    loaderSHA256: createHash('sha256').update(loaderSource).digest('hex'),
    compilerVersion: ts.version,
    compilerBytes: (await readFile('node_modules/typescript/lib/typescript.js'))
      .byteLength,
    compilerLocation:
      'Node fixture preparation only; not shipped in browser or proposed as qualified production compiler',
    compiledSourceBytes: Object.values(compiledModules).reduce(
      (n, source) => n + Buffer.byteLength(source),
      0,
    ),
    boundary:
      'Guest module graphs, namespaces, cycles, TLA and promises remain guest-local; host source and resolution hooks accept and return strings only. Both adapters run the same loader source and hooks.',
  },
  invocation:
    'Actual HTTP document parser creates classic/module bootstrap scripts; native loading calls do not originate in page.evaluate or CDP.',
  origin,
  results: [] as {
    case: string;
    crashed: boolean;
    errors: string[];
    stages: string[];
    result?: unknown;
    requestTrace: string[];
  }[],
};
async function save() {
  await mkdir('results/realms', { recursive: true });
  await writeFile(
    process.env.REALM_RESULTS || 'results/realms/loading-spike.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
}
try {
  for (const kind of cases) {
    const page = await browser.newPage();
    const row: (typeof receipt.results)[number] = {
      case: kind,
      crashed: false,
      errors: [],
      stages: [],
      requestTrace: [],
    };
    receipt.results.push(row);
    const start = requests.length;
    let finish: () => void = () => {};
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    page.on('crash', () => {
      row.crashed = true;
      finish();
    });
    page.on('pageerror', (error) => {
      row.errors.push(error.message);
      finish();
    });
    page.on('console', (message) => {
      const text = message.text();
      if (text.startsWith('REALM_RESULT ')) {
        row.result = JSON.parse(text.slice(13));
        finish();
      } else if (text.startsWith('REALM_STAGE ')) row.stages.push(text.slice(12));
    });
    try {
      await page.goto(origin + '/?case=' + kind, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await Promise.race([
        completed,
        new Promise<void>((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch (error) {
      row.errors.push(String(error));
    }
    row.requestTrace = requests.slice(start);
    await save();
    console.log(JSON.stringify(row));
    await page.close().catch(() => {});
  }
  for (const backend of ['native', 'membrane']) {
    const row = receipt.results.find((item) => item.case === 'shared-' + backend);
    assert(row && !row.crashed && row.errors.length === 0);
    assert(row.result && typeof row.result === 'object' && 'value' in row.result);
    assert(row.result.value && typeof row.result.value === 'object');
    const actual = { ...row.result.value };
    Reflect.deleteProperty(actual, 'guestGlobals');
    assert.deepEqual(actual, {
      first: 1,
      increment: 2,
      live: 2,
      moduleIdentity: true,
      namespaceObject: 'object',
      identity: origin + '/module.js',
      cycle: 5,
      awaited: 42,
      dynamic: 2,
      earlyCycle: 42,
      denied: true,
      moduleProbe: {
        document: backend === 'native' ? 'undefined' : 'object',
        fetch: backend === 'native' ? 'undefined' : 'function',
        hostSecret: 'undefined',
        guestMarker: 'guest',
        hostArray: 'undefined',
        guestArray: 'guest-array',
      },
    });
    if (backend === 'native')
      assert.equal(Reflect.get(row.result.value, 'guestGlobals'), 'undefined:undefined');
    assert(
      row.requestTrace.every(
        (url) => url.startsWith('/?') || url.startsWith('/bootstrap.js'),
      ),
    );
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
