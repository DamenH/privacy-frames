import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const clientPath = 'src/runtime/trusted/client.ts';
const contextPath = 'src/runtime/trusted/context.ts';
const client = await readFile(resolve(root, clientPath), 'utf8');
const context = await readFile(resolve(root, contextPath), 'utf8');
function nodes(input: string): ts.Node[] {
  const file = ts.createSourceFile(
    'input.ts',
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result: ts.Node[] = [];
  const walk = (node: ts.Node) => {
    result.push(node);
    ts.forEachChild(node, walk);
  };
  walk(file);
  return result;
}
function identifier(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}
function verify(clientSource: string, contextSource: string) {
  const c = nodes(clientSource),
    x = nodes(contextSource);
  const imports = c
    .filter(ts.isImportDeclaration)
    .filter((n) => n.importClause?.name?.text === 'source');
  assert.equal(imports.length, 1, 'Trusted source import missing or duplicated');
  assert(
    ts.isStringLiteral(imports[0].moduleSpecifier) &&
      imports[0].moduleSpecifier.text === 'trusted:policy-source',
    'Trusted source import changed',
  );
  const calls = c
    .filter(ts.isCallExpression)
    .filter((n) => identifier(n.expression, 'createTrustedContext'));
  assert.equal(calls.length, 1, 'Trusted context call changed');
  assert(
    calls[0].arguments.length === 1 && identifier(calls[0].arguments[0], 'source'),
    'Evaluated source is not the imported source',
  );
  assert.equal(
    c.filter((n) => identifier(n, 'source')).length,
    2,
    'Imported source has other uses or writes',
  );
  const functions = x
    .filter(ts.isFunctionDeclaration)
    .filter((n) => n.name?.text === 'createTrustedContext');
  assert.equal(functions.length, 1);
  const factory = functions[0];
  assert(
    factory.parameters.length === 1 && identifier(factory.parameters[0].name, 'source'),
    'Trusted context source parameter changed',
  );
  assert.equal(
    x.filter((n) => identifier(n, 'source')).length,
    2,
    'Source parameter has other uses or writes',
  );
  const evaluations = x
    .filter(ts.isCallExpression)
    .filter(
      (n) => identifier(n.expression, 'apply') && identifier(n.arguments[0], 'evaluate'),
    );
  assert.equal(evaluations.length, 1, 'Trusted evaluation call changed');
  const call = evaluations[0];
  assert(
    call.arguments.length === 3 && identifier(call.arguments[1], 'frameWindow'),
    'Trusted evaluation receiver changed',
  );
  const args = call.arguments[2];
  assert(
    ts.isArrayLiteralExpression(args) &&
      args.elements.length === 1 &&
      identifier(args.elements[0], 'source'),
    'Trusted evaluation arguments changed',
  );
  const evaluate = x
    .filter(ts.isVariableDeclaration)
    .filter((n) => identifier(n.name, 'evaluate'));
  assert.equal(evaluate.length, 1);
  const initializer = evaluate[0].initializer;
  assert(
    initializer &&
      ts.isCallExpression(initializer) &&
      ts.isPropertyAccessExpression(initializer.expression) &&
      identifier(initializer.expression.expression, 'Reflect') &&
      initializer.expression.name.text === 'get',
    'Evaluator acquisition changed',
  );
  assert(
    initializer.arguments.length === 2 &&
      identifier(initializer.arguments[0], 'frameWindow') &&
      ts.isStringLiteral(initializer.arguments[1]) &&
      initializer.arguments[1].text === 'eval',
    'Evaluator is not the frame eval',
  );
  return {
    importModule: 'trusted:policy-source',
    contextArgument: 'source',
    evaluationArgument: 'source',
    sourceReferencesPerFile: 2,
  };
}
const result = verify(client, context);
assert.throws(
  () => verify(client.replace("'trusted:policy-source'", "'publisher-source'"), context),
  /Trusted source import changed/,
);
assert.throws(
  () =>
    verify(
      client.replace(
        'createTrustedContext(source)',
        'createTrustedContext(applicationURL)',
      ),
      context,
    ),
  /Evaluated source/,
);
assert.throws(
  () => verify(client, context.replace('[source]', '[operation]')),
  /Source parameter has other uses/,
);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
await writeFile(
  resolve(root, 'formal/implementation-navigation/trusted-source-result.json'),
  JSON.stringify(
    {
      scope:
        'Restricted source-origin check for the known private-frame evaluation call. Does not prove build substitution, all helper effects, browser semantics or absence of all other execution paths.',
      sourceHashes: { [clientPath]: hash(client), [contextPath]: hash(context) },
      checkerSHA256: hash(await readFile(import.meta.filename, 'utf8')),
      result,
      faultControls: {
        publisherImport: 'rejected',
        applicationArgument: 'rejected',
        evaluationArgument: 'rejected',
      },
      completed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Private-frame evaluation receives the imported trusted source; altered source origins rejected',
);
