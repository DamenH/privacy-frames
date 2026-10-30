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
const sourcePath = 'src/runtime/enforcement/navigation.ts';
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
assert.equal(handler.split('||').length, 2, 'Mutation target changed');
assert.equal(handler.split('apply(prevent, event, []);').length, 2);

// Native-operation contracts, not implementations of browser algorithms.
// Every modeled getter can throw; successful predicates return primitive booleans.
const before = `
'use strict';
var sameDocument = symb_bool();
var allowedRoute = symb_bool();
var destinationThrows = symb_bool();
var sameDocumentThrows = symb_bool();
var urlThrows = symb_bool();
var routeThrows = symb_bool();
var event = {}, destination = {};
var cancelled = false, caught = false, urlReads = 0, routeReads = 0;
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
function nativeDestinationURL() {
  var correct = this === destination && arguments.length === 0;
  Assert(correct);
  urlReads = urlReads + 1;
  if (urlThrows) throw 'url';
  return 'https://example.invalid/';
}
function inDocument(url) {
  var correct = url === 'https://example.invalid/';
  Assert(correct);
  routeReads = routeReads + 1;
  if (routeThrows) throw 'route';
  return allowedRoute;
}
function prevent() {
  var correct = this === event && arguments.length === 0;
  Assert(correct);
  cancelled = true;
}
`;
const after = `
try { handler(event); } catch (error) { caught = true; }
var predicatesReached = !destinationThrows && !sameDocumentThrows;
var expectedURLRead = predicatesReached && sameDocument;
var expectedRouteRead = expectedURLRead && !urlThrows;
var expectedThrow = destinationThrows || sameDocumentThrows ||
  (sameDocument && (urlThrows || routeThrows));
var expectedCancel = predicatesReached &&
  (!sameDocument || (!urlThrows && !routeThrows && !allowedRoute));
var outcomeCorrect = caught === expectedThrow && cancelled === expectedCancel;
var readsCorrect = urlReads === (expectedURLRead ? 1 : 0) &&
  routeReads === (expectedRouteRead ? 1 : 0);
Assert(outcomeCorrect);
Assert(readsCorrect);
`;
function harness(callback: string) {
  const compiled = ts.transpileModule(`var handler = ${callback};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      // Gillian-JS accepts ES5; retain this deliberate target with TypeScript 6.
      ignoreDeprecations: '6.0',
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length, 0);
  return before + compiled.outputText + after;
}
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
  {
    name: 'missing-cancellation',
    code: harness(handler.replace('apply(prevent, event, []);', 'void 0;')),
    passes: false,
  },
  {
    name: 'weakened-condition',
    code: harness(handler.replace('||', '&&')),
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
      symbolicBooleans: 6,
      defaultUnrollBound: 100,
      results,
    },
    null,
    2,
  ) + '\n',
);
