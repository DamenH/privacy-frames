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
function extract(input: string): string {
  const file = ts.createSourceFile(
    sourcePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const normalized = (node: ts.Node): string =>
    ts
      .createPrinter({ removeComments: true })
      .printNode(ts.EmitHint.Unspecified, node, file)
      .replace(/\s+/g, '');
  const matches: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
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
    if (atom === 'apply(nativeSameDocument,destination,[])') return 'sameDocument';
    if (atom === 'inDocument(apply(nativeDestinationURL,destination,[]))')
      return 'allowedRoute';
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    )
      return `(Bool.not ${expression(node.operand)})`;
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      assert(
        op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken,
        'Unsupported boolean operator',
      );
      return `(${expression(node.left)} ${op === ts.SyntaxKind.BarBarToken ? '||' : '&&'} ${expression(node.right)})`;
    }
    throw new Error('Unsupported condition: ' + atom);
  }
  return expression(statements[1].expression);
}
const expression = extract(text);
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
  proofOutput: verified.stdout.trim(),
  faultControls: {
    missingAction: 'source-rejected',
    weakenedCondition: 'proof-rejected',
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
