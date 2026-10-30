import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';

// Fail closed on source outside this tiny, explicitly recognized language.
const root = resolve(import.meta.dirname, '../..');
const sourcePath = resolve(root, 'src/runtime/enforcement/navigation.ts');
const text = await readFile(sourcePath, 'utf8');
function extract(input: string, mode: 'boolean' | 'semantics' = 'boolean'): string {
  const file = ts.createSourceFile(
    sourcePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const normalized = (node: ts.Node): string => {
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
  const captures = new Map<string, string>([
    ['prevent', 'Event.prototype.preventDefault'],
    ['nativeAdd', 'EventTarget.prototype.addEventListener'],
    ['nav', 'window.navigation'],
    ['nativeDestination', "descriptor(NavigateEvent.prototype,'destination')!.get!"],
    [
      'nativeSameDocument',
      "descriptor(NavigationDestination.prototype,'sameDocument')!.get!",
    ],
    ['nativeDestinationURL', "descriptor(NavigationDestination.prototype,'url')!.get!"],
  ]);
  const seen = new Set<string>();
  const matches: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      captures.has(node.name.text)
    ) {
      assert(!seen.has(node.name.text), 'Duplicate captured binding');
      assert(
        node.initializer &&
          ts.isVariableDeclarationList(node.parent) &&
          node.parent.flags & ts.NodeFlags.Const,
        'Captured binding must be const',
      );
      assert.equal(
        normalized(node.initializer),
        captures.get(node.name.text),
        'Captured binding changed',
      );
      seen.add(node.name.text);
    }
    if (
      ts.isCallExpression(node) &&
      normalized(node.expression) === 'apply' &&
      node.arguments.length === 3 &&
      normalized(node.arguments[0]) === 'nativeAdd' &&
      normalized(node.arguments[1]) === 'nav'
    ) {
      const args = node.arguments[2];
      assert(
        ts.isArrayLiteralExpression(args) && args.elements.length === 3,
        'Listener arguments changed',
      );
      assert(
        ts.isStringLiteral(args.elements[0]) && args.elements[0].text === 'navigate',
        'Listener event changed',
      );
      assert(ts.isArrowFunction(args.elements[1]), 'Listener is not inline');
      assert.equal(normalized(args.elements[2]), 'internalRecord({capture:true})');
      matches.push(args.elements[1]);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(seen.size, captures.size, 'Missing captured bindings');
  assert.equal(matches.length, 1, 'Expected exactly one native navigation listener');
  const callback = matches[0];
  assert.equal(callback.parameters.length, 1);
  assert.equal(normalized(callback.parameters[0].name), 'event');
  assert(
    !callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
    'Async callback forbidden',
  );
  assert(ts.isBlock(callback.body));
  const statements = callback.body.statements;
  assert.equal(statements.length, 2, 'Navigation handler gained unverified statements');
  assert.equal(
    normalized(statements[0]),
    'constdestination=apply(nativeDestination,event,[]);',
  );
  assert(ts.isIfStatement(statements[1]) && !statements[1].elseStatement);
  assert.equal(
    normalized(statements[1].thenStatement),
    'apply(prevent,event,[]);',
    'Cancellation action changed',
  );
  function expression(node: ts.Expression): string {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression);
    const atom = normalized(node);
    if (atom === 'apply(nativeSameDocument,destination,[])')
      return mode === 'boolean' ? 'sameDocument' : 'Expr.sameDocument';
    if (atom === 'inDocument(apply(nativeDestinationURL,destination,[]))')
      return mode === 'boolean' ? 'allowedRoute' : 'Expr.allowedRoute';
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    )
      return `(${mode === 'boolean' ? 'Bool.not' : 'Expr.neg'} ${expression(node.operand)})`;
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      assert(
        op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken,
        'Unsupported boolean operator',
      );
      if (mode === 'semantics')
        return `(Expr.${op === ts.SyntaxKind.BarBarToken ? 'disjunction' : 'conjunction'} ${expression(node.left)} ${expression(node.right)})`;
      return `(${expression(node.left)} ${op === ts.SyntaxKind.BarBarToken ? '||' : '&&'} ${expression(node.right)})`;
    }
    throw new Error('Unsupported condition: ' + atom);
  }
  return expression(statements[1].expression);
}
const expression = extract(text);
assert.throws(
  () =>
    extract(
      text.replace('Event.prototype.preventDefault', 'Event.prototype.stopPropagation'),
    ),
  /Captured binding changed/,
);
assert.throws(
  () => extract(text.replace("'navigate',", "'navi gate',")),
  /Listener event changed/,
);
const lean = `def actualDecision (sameDocument allowedRoute : Bool) : Bool := ${expression}\n\ntheorem cancellation_exact (sameDocument allowedRoute : Bool) :\n actualDecision sameDocument allowedRoute = !(sameDocument && allowedRoute) := by\n cases sameDocument <;> cases allowedRoute <;> decide\n\n#print axioms cancellation_exact\n`;
const directory = resolve(root, '.tools/implementation-navigation');
await mkdir(directory, { recursive: true });
const proof = resolve(directory, 'ActualDecision.lean');
await writeFile(proof, lean);
const executable =
  process.env.PF_LEAN || resolve(root, '.tools/lean-4.35.0-linux/bin/lean');
assert(
  execFileSync(executable, ['--version'], { encoding: 'utf8' }).includes(
    'version 4.35.0,',
  ),
);
const verified = spawnSync(executable, ['--trust=0', proof], { encoding: 'utf8' });
assert.equal(verified.status, 0, verified.stdout + verified.stderr);
assert.equal(
  verified.stdout.trim(),
  "'cancellation_exact' does not depend on any axioms",
);
assert.equal(verified.stderr, '');
const semantics = await readFile(
  resolve(root, 'formal/implementation-navigation/Expression.lean'),
  'utf8',
);
const tree = extract(text, 'semantics');
const semanticProof =
  semantics +
  `\nopen NavigationSource\ndef actualTree : Expr := ${tree}\n\ntheorem crossDocument_requests_cancellation (route : Result) :\n action (eval (.ok false) route actualTree) = .requestCancellation := by\n cases route with\n | error e => cases e; rfl\n | ok b => cases b <;> rfl\n\ntheorem sameDocument_route_exception :\n action (eval (.ok true) (.error ()) actualTree) = .throwException := by rfl\n\ntheorem native_getter_exception (route : Result) :\n action (eval (.error ()) route actualTree) = .throwException := by rfl\n\n#print axioms crossDocument_requests_cancellation\n#print axioms sameDocument_route_exception\n#print axioms native_getter_exception\n`;
const semanticPath = resolve(directory, 'ActualSemantics.lean');
await writeFile(semanticPath, semanticProof);
const semanticResult = spawnSync(executable, ['--trust=0', semanticPath], {
  encoding: 'utf8',
});
assert.equal(semanticResult.status, 0, semanticResult.stdout + semanticResult.stderr);
assert.equal(semanticResult.stderr, '');
assert.equal(
  semanticResult.stdout.trim(),
  [
    "'crossDocument_requests_cancellation' does not depend on any axioms",
    "'sameDocument_route_exception' does not depend on any axioms",
    "'native_getter_exception' does not depend on any axioms",
  ].join('\n'),
);
const lazyBranch = 'if ← eval sameDocument allowedRoute left then return true';
assert.equal(semanticProof.split(lazyBranch).length, 2);
const eagerProof = semanticProof.replace(
  lazyBranch,
  'if ← eval sameDocument allowedRoute left then do\n        let _ ← eval sameDocument allowedRoute right\n        return true',
);
const eagerPath = resolve(directory, 'EagerFault.lean');
await writeFile(eagerPath, eagerProof);
const eagerResult = spawnSync(executable, ['--trust=0', eagerPath], { encoding: 'utf8' });
assert.notEqual(eagerResult.status, 0, 'Eager evaluation fault incorrectly proved');
assert(
  eagerResult.stdout.includes('rfl') &&
    eagerResult.stdout.includes('requestCancellation'),
  eagerResult.stdout + eagerResult.stderr,
);
// A missing action must fail source extraction. A weakened condition must fail proof checking.
assert.equal(text.split('apply(prevent, event, []);').length, 3, 'Action anchor changed');
assert.throws(
  () => extract(text.replace('apply(prevent, event, []);', 'void event;')),
  /Cancellation action changed/,
);
const condition = '!apply(nativeSameDocument, destination, []) ||';
assert.equal(text.split(condition).length, 2, 'Condition anchor changed');
const altered = extract(
  text.replace(condition, '!apply(nativeSameDocument, destination, []) &&'),
);
const badProof = resolve(directory, 'WeakenedDecision.lean');
await writeFile(badProof, lean.replace(expression, altered));
const bad = spawnSync(executable, ['--trust=0', badProof], { encoding: 'utf8' });
assert.notEqual(bad.status, 0, 'Weakened condition incorrectly proved');
assert(
  bad.stdout.includes('decide') && bad.stdout.includes('false'),
  'Unexpected proof failure: ' + bad.stdout + bad.stderr,
);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const receipt = {
  scope:
    'Restricted source-derived boolean decision and exact cancellation action, not a JavaScript semantics or browser proof.',
  source: 'src/runtime/enforcement/navigation.ts',
  sourceSHA256: sha(text),
  checkerSHA256: sha(await readFile(import.meta.filename, 'utf8')),
  generatedLean: lean,
  generatedLeanSHA256: sha(lean),
  semanticDefinitionSHA256: sha(semantics),
  generatedSemanticProof: semanticProof,
  semanticProofOutput: semanticResult.stdout.trim(),
  proofOutput: verified.stdout.trim(),
  faultControls: {
    wrongNativeAction: 'source-rejected',
    wrongEventName: 'source-rejected',
    missingAction: 'source-rejected',
    weakenedCondition: 'proof-rejected',
    eagerEvaluation: 'semantic-proof-rejected',
  },
  completed: true,
};
await writeFile(
  resolve(root, 'formal/implementation-navigation/result.json'),
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(
  'Actual navigation condition: all Boolean inputs verified; missing action and weakened-condition controls rejected',
);
