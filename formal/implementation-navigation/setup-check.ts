import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const guardPath = 'src/runtime/root-guard.ts';
const realmPath = 'src/runtime/contexts/window-realm.ts';
const guard = await readFile(resolve(root, guardPath), 'utf8');
const realm = await readFile(resolve(root, realmPath), 'utf8');
function parse(name: string, source: string) {
  return ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
function callNamed(node: ts.Node, name: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name
  );
}
function calls(node: ts.Node, name: string): ts.CallExpression[] {
  const result: ts.CallExpression[] = [];
  const walk = (current: ts.Node) => {
    if (callNamed(current, name)) result.push(current);
    ts.forEachChild(current, walk);
  };
  walk(node);
  return result;
}
function verify(guardSource: string, realmSource: string) {
  const guardFile = parse(guardPath, guardSource);
  const realmFile = parse(realmPath, realmSource);
  const roots = guardFile.statements
    .filter(ts.isFunctionDeclaration)
    .filter((fn) => fn.name?.text === 'startRootGuard');
  assert.equal(roots.length, 1, 'Root startup function changed');
  assert(roots[0].body);
  assert.equal(roots[0].parameters.length, 1);
  assert(
    ts.isIdentifier(roots[0].parameters[0].name) &&
      roots[0].parameters[0].name.text === 'bootstrapScript',
  );
  const tries = roots[0].body.statements.filter(ts.isTryStatement);
  assert.equal(tries.length, 1, 'Root bootstrap try changed');
  const block = tries[0].tryBlock;
  const preparations = calls(block, 'prepareWindowRealm');
  const starts = calls(block, 'start');
  assert.equal(preparations.length, 1, 'Expected one root preparation');
  assert.equal(starts.length, 1, 'Expected one content start');
  const index = (node: ts.Node) =>
    block.statements.findIndex((s) => s.pos <= node.pos && s.end >= node.end);
  const prepareIndex = index(preparations[0]),
    startIndex = index(starts[0]);
  assert(
    prepareIndex >= 0 && startIndex > prepareIndex,
    'Content starts before preparation',
  );
  const prepareStatement = block.statements[prepareIndex];
  assert(
    ts.isVariableStatement(prepareStatement) &&
      prepareStatement.declarationList.declarations.some(
        (d) => d.initializer === preparations[0],
      ),
    'Preparation is not a direct statement',
  );
  const startCall = starts[0];
  assert(
    ts.isPropertyAccessExpression(startCall.parent) &&
      startCall.parent.name.text === 'catch' &&
      ts.isCallExpression(startCall.parent.parent),
    'Root start invocation shape changed',
  );
  const startDeclaration = block.statements
    .flatMap((s) =>
      ts.isVariableStatement(s) ? Array.from(s.declarationList.declarations) : [],
    )
    .filter((d) => ts.isIdentifier(d.name) && d.name.text === 'start');
  assert.equal(startDeclaration.length, 1);
  const startBody = startDeclaration[0].initializer;
  assert(
    startBody && ts.isArrowFunction(startBody) && ts.isBlock(startBody.body),
    'Start closure changed',
  );
  assert(
    startBody.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
    'Start must remain asynchronous',
  );
  assert(
    startCall.pos > startDeclaration[0].end,
    'Start runs before closure initialization',
  );
  assert(
    !calls(startBody, 'prepareWindowRealm').length,
    'Preparation moved into delayed start',
  );
  const renderCalls: ts.CallExpression[] = [];
  const scan = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'renderer' &&
      n.expression.name.text === 'render'
    )
      renderCalls.push(n);
    ts.forEachChild(n, scan);
  };
  scan(guardFile);
  assert.equal(renderCalls.length, 1, 'Root renderer call changed');
  assert(
    renderCalls[0].pos >= startBody.body.pos && renderCalls[0].end <= startBody.body.end,
    'Rendering escaped start closure',
  );
  const functions = realmFile.statements
    .filter(ts.isFunctionDeclaration)
    .filter((f) => f.name?.text === 'prepareWindowRealm');
  assert.equal(functions.length, 1);
  const prepare = functions[0];
  assert(prepare.body);
  assert(
    !prepare.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
    'Realm preparation became asynchronous',
  );
  const statements = prepare.body.statements;
  const navigationCalls = statements.filter(
    (s) =>
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.length === 1 &&
      !!s.declarationList.declarations[0].initializer &&
      callNamed(s.declarationList.declarations[0].initializer, 'prepareNavigationPolicy'),
  );
  assert.equal(
    navigationCalls.length,
    1,
    'Navigation installation is not a direct statement',
  );
  const navIndex = statements.indexOf(navigationCalls[0]);
  assert.equal(navIndex, 1, 'Unreviewed realm prelude before navigation');
  const prefix = statements[0];
  assert(ts.isVariableStatement(prefix));
  assert.equal(prefix.declarationList.declarations.length, 1);
  const sourceBinding = prefix.declarationList.declarations[0];
  assert(
    ts.isIdentifier(sourceBinding.name) &&
      sourceBinding.name.text === 'sourceURL' &&
      sourceBinding.initializer &&
      ts.isIdentifier(sourceBinding.initializer) &&
      sourceBinding.initializer.text === 'applicationURL',
    'Realm prelude is not the approved metadata binding',
  );
  const navStatement = navigationCalls[0];
  assert(ts.isVariableStatement(navStatement));
  const navCall = navStatement.declarationList.declarations[0].initializer;
  assert(navCall && ts.isCallExpression(navCall));
  assert.equal(
    navCall.arguments.length,
    1,
    'Early navigation received tool dependencies',
  );
  const binding = navStatement.declarationList.declarations[0].name;
  assert(
    ts.isIdentifier(binding) && binding.text === 'finishNavigationPolicy',
    'Navigation finalizer binding changed',
  );
  for (const helper of [
    'prepareRuntimeIntrinsics',
    'createPolicyTools',
    'createTrustedPolicy',
    'resourceAliases',
    'createPublisherContainer',
    'createWorkerFactory',
    'createSharedWorkerFactory',
    'createWorkletFactory',
    'installScriptPolicy',
    'createDocumentFactory',
    'createPopupFactory',
  ]) {
    const invocations = calls(prepare.body, helper);
    assert.equal(invocations.length, 1, 'Preparation helper shape changed: ' + helper);
    const statementIndex = statements.findIndex(
      (s) => s.pos <= invocations[0].pos && s.end >= invocations[0].end,
    );
    assert(
      statementIndex > navIndex,
      'Helper precedes navigation cancellation: ' + helper,
    );
  }
  const finalizers = statements.filter(
    (s) =>
      ts.isExpressionStatement(s) && callNamed(s.expression, 'finishNavigationPolicy'),
  );
  assert.equal(finalizers.length, 1, 'Missing navigation finalization');
  const finalize = finalizers[0];
  assert(ts.isExpressionStatement(finalize) && ts.isCallExpression(finalize.expression));
  assert(
    finalize.expression.arguments.length === 2 &&
      ts.isIdentifier(finalize.expression.arguments[0]) &&
      finalize.expression.arguments[0].text === 'tools' &&
      ts.isIdentifier(finalize.expression.arguments[1]) &&
      finalize.expression.arguments[1].text === 'openPopup',
    'Tool or native popup finalizer argument changed',
  );
  const popup = calls(prepare.body, 'createPopupFactory')[0];
  const popupIndex = statements.findIndex(
    (s) => s.pos <= popup.pos && s.end >= popup.end,
  );
  assert(
    statements.indexOf(finalizers[0]) > popupIndex,
    'Navigation hooks finalized before native popup capture',
  );
  assert(
    statements.indexOf(finalizers[0]) > navIndex,
    'Navigation finalization precedes preparation',
  );
  const returns = statements
    .map((s, i) => (ts.isReturnStatement(s) ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(
    returns,
    [statements.length - 1],
    'Realm has an early or missing direct return',
  );
  assert(navIndex < returns[0], 'Realm returned before navigation installation');
  return {
    rootPreparationStatement: prepareIndex,
    rootContentStartStatement: startIndex,
    realmNavigationStatement: navIndex,
    realmReturnStatement: returns[0],
    rootRenderInsideStart: true,
  };
}
const result = verify(guard, realm);
assert.throws(
  () =>
    verify(
      guard,
      realm.replace(
        'finishNavigationPolicy(tools, openPopup)',
        'finishNavigationPolicy(tools)',
      ),
    ),
  /Tool or native popup finalizer argument changed/,
);
for (const line of [
  '  prepareRuntimeIntrinsics();\n',
  '  const tools = createPolicyTools();\n',
]) {
  assert.equal(realm.split(line).length, 2, 'Early helper anchor changed');
  const early = realm
    .replace(line, '')
    .replace(
      '  const finishNavigationPolicy = prepareNavigationPolicy(',
      line + '  const finishNavigationPolicy = prepareNavigationPolicy(',
    );
  assert.throws(() => verify(guard, early), /Unreviewed realm prelude before navigation/);
}
const parserLine = '  const policy = createTrustedPolicy(applicationURL);\n';
assert.equal(realm.split(parserLine).length, 2);
const parserEarly = realm
  .replace(parserLine, '')
  .replace(
    '  const finishNavigationPolicy = prepareNavigationPolicy(',
    parserLine + '  const finishNavigationPolicy = prepareNavigationPolicy(',
  );
assert.throws(
  () => verify(guard, parserEarly),
  /Unreviewed realm prelude before navigation/,
);
const preparation = 'const realm = prepareWindowRealm(';
assert.equal(guard.split(preparation).length, 2, 'Preparation anchor changed');
assert.throws(
  () =>
    verify(
      guard.replace(preparation, 'start();\n  const realm = prepareWindowRealm('),
      realm,
    ),
  /Expected one content start/,
);
const install = '  const finishNavigationPolicy = prepareNavigationPolicy(';
assert.equal(realm.split(install).length, 2, 'Installation anchor changed');
const finalize = '  finishNavigationPolicy(tools, openPopup);';
assert.equal(realm.split(finalize).length, 2, 'Finalization anchor changed');
assert.throws(
  () => verify(guard, realm.replace(finalize, '  return;\n' + finalize)),
  /early or missing direct return/,
);
assert.throws(
  () => verify(guard, realm.replace(install, '  unreviewedSetup();\n' + install)),
  /Unreviewed realm prelude before navigation/,
);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
await writeFile(
  resolve(root, 'formal/implementation-navigation/setup-result.json'),
  JSON.stringify(
    {
      scope:
        'Source-order and syntactic-shape checks for the root entry path. Does not prove helper semantics, import side effects or browser execution order.',
      sourceHashes: { [guardPath]: hash(guard), [realmPath]: hash(realm) },
      checkerSHA256: hash(await readFile(import.meta.filename, 'utf8')),
      result,
      faultControls: {
        earlyStart: 'rejected',
        earlyReturn: 'rejected',
        parserBeforeCancellation: 'rejected',
        missingPopupArgument: 'rejected',
        intrinsicsBeforeCancellation: 'rejected',
        toolsBeforeCancellation: 'rejected',
        unknownPreludeCall: 'rejected',
      },
      completed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Root preparation precedes deferred content start; navigation installation precedes realm return; ordering faults rejected',
);
