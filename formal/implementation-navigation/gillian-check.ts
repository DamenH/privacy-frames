import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, '.tools/gillian-navigation');
const receiptPath = resolve(import.meta.dirname, 'gillian-result.json');
// A failed rerun must not leave the previous success receipt in its place.
await rm(receiptPath, { force: true });
const image =
  'ghcr.io/gillianplatform/gillian@sha256:ce41de968aba0964774e1929416ce60b9c3b770d2e58f96e63990b629cfe2ed6';
const sourcePath = 'src/runtime/enforcement/document-exit.ts';
const source = await readFile(resolve(root, sourcePath), 'utf8');
const checker = await readFile(import.meta.filename, 'utf8');
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const handlers: ts.ArrowFunction[] = [];
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'apply' &&
    node.arguments.length === 3 &&
    ts.isIdentifier(node.arguments[0]) &&
    node.arguments[0].text === 'nativeAdd' &&
    ts.isIdentifier(node.arguments[1]) &&
    node.arguments[1].text === 'nav' &&
    ts.isArrayLiteralExpression(node.arguments[2])
  ) {
    const elements = node.arguments[2].elements;
    assert(ts.isStringLiteral(elements[0]) && elements[0].text === 'navigate');
    assert(ts.isArrowFunction(elements[1]));
    handlers.push(elements[1]);
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(handlers.length, 1);
const handler = handlers[0].getText(file);
const condition = '!apply(nativeSameDocument, destination, [])';
assert.equal(handler.split(condition).length, 2, 'Mutation target changed');
assert.equal(handler.split('apply(prevent, event, []);').length, 2);

// Native-operation contracts, not implementations of browser algorithms.
// Every modeled getter can throw; successful predicates return primitive booleans.
const before = `
'use strict';
var sameDocument = symb_bool();
var destinationThrows = symb_bool();
var sameDocumentThrows = symb_bool();
var event = {}, destination = {};
var cancelled = false, caught = false;
function apply(fn, receiver, args) { return fn.apply(receiver, args); }
function nativeDestination() {
  var correct = this === event && arguments.length === 0;
  Assert(correct);
  if (destinationThrows) throw 'destination';
  return destination;
}
function nativeSameDocument() {
  var correct = this === destination && arguments.length === 0;
  Assert(correct);
  if (sameDocumentThrows) throw 'sameDocument';
  return sameDocument;
}
function prevent() {
  var correct = this === event && arguments.length === 0;
  Assert(correct);
  cancelled = true;
}
`;
const after = `
try { handler(event); } catch (error) { caught = true; }
var expectedThrow = destinationThrows || sameDocumentThrows;
var expectedCancel = !destinationThrows && !sameDocumentThrows && !sameDocument;
var outcomeCorrect = caught === expectedThrow && cancelled === expectedCancel;
Assert(outcomeCorrect);
`;
function compile(code: string) {
  const compiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      // Gillian-JS accepts ES5; retain this deliberate target with TypeScript 6.
      ignoreDeprecations: '6.0',
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length, 0);
  return compiled.outputText;
}
function harness(callback: string) {
  return before + compile(`var handler = ${callback};`) + after;
}
const nativeModel = `
var registrationThrows = symb_bool();
var registered, registrations = 0, installationErrors = 0;
var nav = {}, window = {navigation: nav};
var Reflect = {apply: apply};
function Event() {}
Event.prototype.preventDefault = prevent;
function EventTarget() {}
EventTarget.prototype.addEventListener = function(name, callback, options) {
  var correct = this === nav && name === 'navigate' && options.capture === true;
  Assert(correct);
  if (registrationThrows) throw 'registration';
  registrations = registrations + 1;
  registered = callback;
};
function NavigateEvent() {}
function NavigationDestination() {}
Object.getOwnPropertyDescriptor = function(owner, key) {
  var eventProperty = owner === NavigateEvent.prototype && key === 'destination';
  var destinationProperty = owner === NavigationDestination.prototype && key === 'sameDocument';
  var recognized = eventProperty || destinationProperty;
  Assert(recognized);
  return {get: eventProperty ? nativeDestination : nativeSameDocument};
};
`;
assert.equal(source.split('export function ').length, 2);
const wholeKernel =
  before +
  nativeModel +
  compile(source.replace('export function ', 'function ')) +
  `
try { installDocumentExitGuard(); } catch (error) { installationErrors = installationErrors + 1; }
try { installDocumentExitGuard(); } catch (error) { installationErrors = installationErrors + 1; }
if (registrationThrows) {
  var refused = registrations === 0 && installed === false && installationErrors === 2;
  Assert(refused);
} else {
  var once = registrations === 1 && installed === true && installationErrors === 0;
  Assert(once);
  var handler = registered;
` +
  after +
  '\n}\n';
const fixtures = [
  {
    name: 'positive-control',
    code: 'var b = symb_bool();\nAssert(b or (not b));\n',
    passes: true,
  },
  {
    name: 'negative-control',
    code: 'var b = symb_bool();\nAssert(b and (not b));\n',
    passes: false,
  },
  { name: 'actual-handler', code: harness(handler), passes: true },
  { name: 'whole-kernel', code: wholeKernel, passes: true },
  {
    name: 'missing-installation-flag',
    code: wholeKernel.replace('installed = true;', 'installed = false;'),
    passes: false,
  },
  {
    name: 'missing-cancellation',
    code: harness(handler.replace('apply(prevent, event, []);', 'void 0;')),
    passes: false,
  },
  {
    name: 'reversed-condition',
    code: harness(
      handler.replace(condition, 'apply(nativeSameDocument, destination, [])'),
    ),
    passes: false,
  },
];
await mkdir(directory, { recursive: true });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const results = [];
for (const fixture of fixtures) {
  await writeFile(resolve(directory, `${fixture.name}.js`), fixture.code);
  const container = `pf-gillian-navigation-${process.pid}-${fixture.name}`;
  const args = [
    'run',
    '--rm',
    '--name',
    container,
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    `${process.getuid?.()}:${process.getgid?.()}`,
    '--mount',
    `type=bind,src=${directory},dst=/work`,
    '--workdir',
    '/work',
    image,
    'gillian-js',
    'wpst',
    `${fixture.name}.js`,
    '--ci',
    '--logging',
    'normal',
    '--no-heap',
    '--result-dir',
    `.gillian-${fixture.name}`,
  ];
  const run = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error) {
    spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    throw run.error;
  }
  const output = run.stdout + run.stderr;
  await writeFile(resolve(directory, `${fixture.name}.log`), output);
  const outputSummary = output.split('\n').slice(0, 8).join('\n');
  console.log(`${fixture.name}: exit ${run.status}\n${outputSummary}`);
  assert.equal(run.status, fixture.passes ? 0 : 1, fixture.name);
  if (fixture.passes) assert.match(output, /Success!/);
  else assert.match(output, /Pure assertion failed:/, 'Expected an assertion failure');
  results.push({
    name: fixture.name,
    expectedSuccess: fixture.passes,
    exitCode: run.status,
    fixtureSHA256: hash(fixture.code),
    outputSHA256: hash(output),
    outputSummary,
  });
}
assert.equal(await readFile(resolve(root, sourcePath), 'utf8'), source);
assert.equal(await readFile(import.meta.filename, 'utf8'), checker);
await writeFile(
  receiptPath,
  JSON.stringify(
    {
      completed: new Date().toISOString(),
      image,
      source: sourcePath,
      sourceSHA256: hash(source),
      checkerSHA256: hash(checker),
      handlerSHA256: hash(handler),
      typescriptVersion: ts.version,
      mode: 'whole-program symbolic testing',
      symbolicBooleans: 3,
      wholeKernelSymbolicBooleans: 4,
      defaultUnrollBound: 100,
      results,
    },
    null,
    2,
  ) + '\n',
);
