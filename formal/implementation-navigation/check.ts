import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const sourceName = 'src/runtime/enforcement/document-exit.ts';
const text = await readFile(resolve(root, sourceName), 'utf8');
function extract(input: string) {
  const file = ts.createSourceFile(sourceName, input, ts.ScriptTarget.Latest, true);
  const normalize = (node: ts.Node) => {
    const printed = ts
      .createPrinter({ removeComments: true })
      .printNode(ts.EmitHint.Unspecified, node, file);
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      printed,
    );
    let result = '';
    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken)
      result += scanner.getTokenText();
    return result;
  };
  assert.equal(file.statements.length, 2, 'Kernel gained module initialization');
  assert.equal(
    normalize(file.statements[0]),
    'letinstalled=false;',
    'Private state initialization changed',
  );
  const fn = file.statements[1];
  assert(
    ts.isFunctionDeclaration(fn) &&
      fn.name?.text === 'installDocumentExitGuard' &&
      fn.body,
  );
  assert.equal(fn.parameters.length, 0, 'Kernel must not accept application values');
  assert(!fn.asteriskToken, 'Kernel must execute when called');
  assert.deepEqual(
    fn.modifiers?.map((modifier) => modifier.kind),
    [ts.SyntaxKind.ExportKeyword],
    'Kernel function modifiers changed',
  );
  const prefix = [
    'if(installed)return;',
    'constapply=Reflect.apply;',
    'constdescriptor=Object.getOwnPropertyDescriptor;',
    'constprevent=Event.prototype.preventDefault;',
    'constnativeAdd=EventTarget.prototype.addEventListener;',
    'constnav=window.navigation;',
    "if(!nav||typeofNavigateEvent!=='function')thrownewError('Navigation API required');",
    "constnativeDestination=descriptor(NavigateEvent.prototype,'destination')!.get!;",
    "constnativeSameDocument=descriptor(NavigationDestination.prototype,'sameDocument')!.get!;",
  ];
  const statements = fn.body.statements;
  assert.equal(statements.length, prefix.length + 2, 'Kernel statement count changed');
  assert.deepEqual(
    statements.slice(0, prefix.length).map(normalize),
    prefix,
    'Kernel prelude changed',
  );
  assert.equal(
    normalize(statements.at(-1)!),
    'installed=true;',
    'Installation flag changed',
  );
  const registration = statements[prefix.length];
  assert(
    ts.isExpressionStatement(registration) &&
      ts.isCallExpression(registration.expression),
  );
  const call = registration.expression;
  assert.equal(normalize(call.expression), 'apply');
  assert.equal(call.arguments.length, 3);
  assert.equal(normalize(call.arguments[0]), 'nativeAdd');
  assert.equal(normalize(call.arguments[1]), 'nav');
  const args = call.arguments[2];
  assert(ts.isArrayLiteralExpression(args) && args.elements.length === 3);
  assert.equal(normalize(args.elements[0]), "'navigate'", 'Listener event changed');
  assert.equal(normalize(args.elements[2]), '{capture:true}', 'Listener capture changed');
  const callback = args.elements[1];
  assert(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
  assert.equal(callback.parameters.length, 1);
  assert.equal(normalize(callback.parameters[0]), 'event:NavigateEvent');
  assert(
    !callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
  const body = callback.body.statements;
  assert.equal(body.length, 2, 'Handler statement count changed');
  assert.equal(normalize(body[0]), 'constdestination=apply(nativeDestination,event,[]);');
  assert(ts.isIfStatement(body[1]) && !body[1].elseStatement);
  assert.equal(
    normalize(body[1].thenStatement),
    'apply(prevent,event,[]);',
    'Cancellation action changed',
  );
  function expression(node: ts.Expression): string {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression);
    if (normalize(node) === 'apply(nativeSameDocument,destination,[])')
      return 'sameDocument';
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    )
      return `(!${expression(node.operand)})`;
    throw new Error('Unknown decision expression');
  }
  return expression(body[1].expression);
}
const expression = extract(text);
const rejected = (from: string, to: string, pattern: RegExp) => {
  assert.equal(text.split(from).length, 2, 'Fault anchor changed');
  assert.throws(() => extract(text.replace(from, to)), pattern);
};
rejected(
  'const apply = Reflect.apply;',
  'const apply = Reflect.get;',
  /Kernel prelude changed/,
);
rejected(
  'Event.prototype.preventDefault',
  'Event.prototype.stopPropagation',
  /Kernel prelude changed/,
);
rejected("'navigate'", "'navi gate'", /Listener event changed/);
rejected('apply(prevent, event, []);', 'void event;', /Cancellation action changed/);
rejected(
  '  if (installed) return;',
  '  unreviewedSetup();\n  if (installed) return;',
  /Kernel statement count changed/,
);
rejected('  installed = true;', '  installed = false;', /Installation flag changed/);
rejected(
  'export function installDocumentExitGuard()',
  'export function* installDocumentExitGuard()',
  /Kernel must execute when called/,
);
rejected(
  'export function installDocumentExitGuard()',
  'export async function installDocumentExitGuard()',
  /Kernel function modifiers changed/,
);
const semantics = await readFile(resolve(import.meta.dirname, 'Expression.lean'), 'utf8');
const lean =
  semantics +
  `
open NavigationSource
 def actualDecision (sameDocument : Bool) : Bool := ${expression}
 theorem cancellation_exact (sameDocument : Bool) :
  actualDecision sameDocument = !sameDocument := by
  cases sameDocument <;> decide
 theorem crossDocument_requests_cancellation :
  action actualDecision (.ok ()) (.ok false) = .requestCancellation := by rfl
 theorem sameDocument_returns_normally :
  action actualDecision (.ok ()) (.ok true) = .returnNormally := by rfl
 theorem destination_getter_exception (sameDocument : Result Bool) :
  action actualDecision (.error ()) sameDocument = .throwException := by rfl
 theorem sameDocument_getter_exception :
  action actualDecision (.ok ()) (.error ()) = .throwException := by rfl
 #print axioms cancellation_exact
 #print axioms crossDocument_requests_cancellation
 #print axioms sameDocument_returns_normally
 #print axioms destination_getter_exception
 #print axioms sameDocument_getter_exception
`;
const directory = resolve(root, '.tools/implementation-navigation');
await mkdir(directory, { recursive: true });
const executable =
  process.env.PF_LEAN || resolve(root, '.tools/lean-4.35.0-linux/bin/lean');
assert(
  execFileSync(executable, ['--version'], { encoding: 'utf8' }).includes(
    'version 4.35.0,',
  ),
);
const proof = resolve(directory, 'ActualHandler.lean');
await writeFile(proof, lean);
const verified = spawnSync(executable, ['--trust=0', proof], { encoding: 'utf8' });
assert.equal(verified.status, 0, verified.stdout + verified.stderr);
assert.equal(verified.stderr, '');
assert.equal(
  verified.stdout.trim(),
  [
    'cancellation_exact',
    'crossDocument_requests_cancellation',
    'sameDocument_returns_normally',
    'destination_getter_exception',
    'sameDocument_getter_exception',
  ]
    .map((name) => `'${name}' does not depend on any axioms`)
    .join('\n'),
);
const condition = '!apply(nativeSameDocument, destination, [])';
assert.equal(text.split(condition).length, 2);
const wrong = extract(
  text.replace(condition, 'apply(nativeSameDocument, destination, [])'),
);
const badProof = resolve(directory, 'ReversedHandler.lean');
await writeFile(badProof, lean.replace(`:= ${expression}`, `:= ${wrong}`));
const bad = spawnSync(executable, ['--trust=0', badProof], { encoding: 'utf8' });
assert.notEqual(bad.status, 0, 'Reversed decision incorrectly proved');
assert(bad.stdout.includes('decide'), bad.stdout + bad.stderr);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
await writeFile(
  resolve(import.meta.dirname, 'result.json'),
  JSON.stringify(
    {
      scope:
        'Restricted source correspondence for an import-free kernel and callback, with kernel-checked primitive-Boolean/exception semantics. Native operations, module privacy, compiler and browser effects remain contracts.',
      source: sourceName,
      sourceSHA256: hash(text),
      checkerSHA256: hash(await readFile(import.meta.filename, 'utf8')),
      generatedLean: lean,
      generatedLeanSHA256: hash(lean),
      semanticDefinitionSHA256: hash(semantics),
      proofOutput: verified.stdout.trim(),
      faultControls: {
        wrongNativeApply: 'source-rejected',
        wrongNativeAction: 'source-rejected',
        wrongEventName: 'source-rejected',
        missingAction: 'source-rejected',
        unknownPreludeCall: 'source-rejected',
        wrongInstallationFlag: 'source-rejected',
        generatorInstaller: 'source-rejected',
        asynchronousInstaller: 'source-rejected',
        reversedCondition: 'proof-rejected',
      },
      completed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Import-free kernel and handler checked; cancellation/exception theorems verified; faults rejected',
);
