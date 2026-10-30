import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { trustedPolicyPlugin } from '../../scripts/trusted-policy.ts';

const root = resolve(import.meta.dirname, '../..');
const roles = [
  {
    entry: 'src/runtime/guard.ts',
    output: 'guard.js',
    module: './root-guard.ts',
    init: 'init_root_guard',
    start: 'startRootGuard',
    script: 'document.currentScript',
  },
  {
    entry: 'src/runtime/contexts/document-guard.ts',
    output: 'document-guard.js',
    module: './document-main.ts',
    init: 'init_document_main',
    start: 'startDocumentGuard',
    script:
      "document.currentScript||document.querySelector('script[data-privacy-context]')",
  },
];
const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
function normalize(node: ts.Node, file: ts.SourceFile) {
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
}
function sourceEntry(source: string, role: (typeof roles)[number]) {
  const file = ts.createSourceFile(role.entry, source, ts.ScriptTarget.Latest, true);
  assert.equal(file.statements.length, 2, 'Entry gained eager module work');
  const imported = file.statements[0];
  assert(
    ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier),
  );
  assert(imported.moduleSpecifier.text.endsWith('/enforcement/document-exit.ts'));
  assert.equal(
    imported.importClause?.namedBindings?.getText(file),
    '{ installDocumentExitGuard }',
  );
  const attempt = file.statements[1];
  assert(ts.isTryStatement(attempt));
  const statements = attempt.tryBlock.statements;
  assert.equal(statements.length, 7, 'Entry prefix changed');
  assert.equal(
    normalize(statements[0], file),
    'installDocumentExitGuard();',
    'Kernel is not first',
  );
  assert.equal(
    normalize(statements[1], file),
    `constbootstrapScript=${role.script};`,
    'Script capture changed',
  );
  const imports: ts.CallExpression[] = [];
  const scan = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      imports.push(node);
    ts.forEachChild(node, scan);
  };
  scan(file);
  assert.equal(imports.length, 1, 'Expected one deferred module import');
  assert.equal(imports[0].arguments.length, 1);
  assert(ts.isStringLiteral(imports[0].arguments[0]));
  assert.equal(imports[0].arguments[0].text, role.module);
  const then = imports[0].parent;
  assert(
    ts.isPropertyAccessExpression(then) &&
      then.name.text === 'then' &&
      ts.isCallExpression(then.parent),
  );
  const callback = then.parent.arguments[0];
  assert(callback && ts.isArrowFunction(callback));
  assert.equal(
    normalize(callback.body, file),
    `${role.start}(bootstrapScript)`,
    'Captured script not passed directly',
  );
}
function compiledPrefix(source: string, role: (typeof roles)[number]) {
  const file = ts.createSourceFile(
    role.output,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const programs = file.statements.filter(
    (s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)),
  );
  assert.equal(programs.length, 1);
  const statement = programs[0];
  assert(
    ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression),
  );
  let fn: ts.Expression = statement.expression.expression;
  while (ts.isParenthesizedExpression(fn)) fn = fn.expression;
  assert(ts.isArrowFunction(fn) && ts.isBlock(fn.body));
  const statements = fn.body.statements;
  const index = statements.findIndex(ts.isTryStatement);
  assert(index > 0, 'Compiled entry boundary missing');
  const aliases = new Map([
    ['__create', 'Object.create'],
    ['__defProp', 'Object.defineProperty'],
    ['__getOwnPropDesc', 'Object.getOwnPropertyDescriptor'],
    ['__getOwnPropNames', 'Object.getOwnPropertyNames'],
    ['__getProtoOf', 'Object.getPrototypeOf'],
    ['__hasOwnProp', 'Object.prototype.hasOwnProperty'],
  ]);
  const factories = new Set<string>();
  let kernelInit = 0,
    exportCalls = 0;
  function methodArgument(call: ts.CallExpression) {
    assert.equal(call.arguments.length, 1);
    const argument = call.arguments[0];
    assert(ts.isObjectLiteralExpression(argument) && argument.properties.length === 1);
    const method = argument.properties[0];
    assert(
      ts.isMethodDeclaration(method) && ts.isStringLiteral(method.name) && method.body,
    );
    assert(method.parameters.every((parameter) => !parameter.initializer));
    return method.body;
  }
  for (const item of statements.slice(0, index)) {
    if (ts.isFunctionDeclaration(item)) continue; // Function bodies are not evaluated here.
    if (ts.isVariableStatement(item)) {
      for (const declaration of item.declarationList.declarations) {
        assert(ts.isIdentifier(declaration.name));
        const name = declaration.name.text,
          value = declaration.initializer;
        if (!value) continue;
        if (aliases.has(name)) {
          assert.equal(normalize(value, file), aliases.get(name));
          aliases.delete(name);
          continue;
        }
        if (ts.isArrowFunction(value)) {
          if (name === '__esm' || name === '__commonJS') {
            assert(value.parameters.every((parameter) => !parameter.initializer));
            assert(ts.isFunctionExpression(value.body), 'Module factory became eager');
            factories.add(name);
          } else if (name === '__export') {
            const normalized = normalize(value, file);
            assert.match(
              normalized,
              /^\(target,all\)=>\{for\(var([a-zA-Z0-9_]+)inall\)__defProp\(target,\1,\{get:all\[\1\],enumerable:true\}\);\}$/,
            );
          } else
            assert(
              ['__copyProps', '__toESM'].includes(name),
              'Unknown eager function initializer',
            );
          continue;
        }
        if (ts.isObjectLiteralExpression(value)) {
          assert.equal(value.properties.length, 0);
          continue;
        }
        assert(
          ts.isCallExpression(value) &&
            ts.isIdentifier(value.expression) &&
            factories.has(value.expression.text),
          'Unknown eager initializer',
        );
        const body = methodArgument(value);
        if (name === 'init_document_exit') {
          assert.deepEqual(
            body.statements.map((node) => normalize(node, file)),
            ['"use strict";', 'installed=false;'],
          );
          kernelInit++;
        }
      }
      continue;
    }
    assert(
      ts.isExpressionStatement(item) &&
        ts.isCallExpression(item.expression) &&
        ts.isIdentifier(item.expression.expression),
      'Unknown eager statement',
    );
    const call = item.expression;
    assert(ts.isIdentifier(call.expression));
    if (call.expression.text === 'init_document_exit') {
      assert.equal(call.arguments.length, 0);
      assert.equal(
        statements.indexOf(item),
        index - 1,
        'Kernel initializer is not immediately before entry',
      );
    } else {
      assert.equal(
        call.expression.text,
        '__export',
        'Heavy module initialized before kernel',
      );
      assert.equal(call.arguments.length, 2);
      assert(ts.isIdentifier(call.arguments[0]));
      const record = call.arguments[1];
      assert(ts.isObjectLiteralExpression(record));
      assert(
        record.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            !ts.isComputedPropertyName(property.name) &&
            ts.isArrowFunction(property.initializer),
        ),
      );
      exportCalls++;
    }
  }
  assert.equal(aliases.size, 0, 'Compiler native aliases changed');
  assert.equal(kernelInit, 1, 'Kernel module initializer missing');
  const attempt = statements[index];
  assert(ts.isTryStatement(attempt));
  assert.equal(
    normalize(attempt.tryBlock.statements[0], file),
    'installDocumentExitGuard();',
  );
  const last = attempt.tryBlock.statements.at(-1)!;
  const text = normalize(last, file);
  assert(
    text.includes(`Promise.resolve().then(()=>(${role.init}(),`),
    'Heavy module is not deferred',
  );
  const checkImports = (node: ts.Node) => {
    assert(
      !ts.isImportDeclaration(node) &&
        !(
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ),
      'Unexpected external module load',
    );
    ts.forEachChild(node, checkImports);
  };
  checkImports(file);
  return {
    eagerModuleInitializers: ['init_document_exit'],
    moduleFactories: [...factories],
    exportCalls,
    entryStatement: index,
    deferredInitializer: role.init,
  };
}
const results = [];
for (const role of roles) {
  const source = await readFile(resolve(root, role.entry), 'utf8');
  sourceEntry(source, role);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, role.entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    banner: { js: '"use strict";' },
    plugins: [await trustedPolicyPlugin(root)],
  });
  assert.equal(result.outputFiles.length, 1, 'Bootstrap must be one script');
  const bytes = result.outputFiles[0].contents;
  assert(
    Buffer.from(bytes).equals(await readFile(resolve(root, 'dist-runtime', role.output))),
    'Built bootstrap differs from production output',
  );
  const compiled = result.outputFiles[0].text;
  const phase = compiledPrefix(compiled, role);
  assert.throws(
    () =>
      compiledPrefix(
        compiled.replace(
          '  init_document_exit();\n  try {',
          `  ${role.init}();\n  init_document_exit();\n  try {`,
        ),
        role,
      ),
    /Heavy module initialized before kernel/,
  );
  assert.throws(
    () =>
      sourceEntry(
        source.replace(
          '  installDocumentExitGuard();',
          '  unreviewedSetup();\n  installDocumentExitGuard();',
        ),
        role,
      ),
    /Entry prefix changed/,
  );
  assert.throws(
    () =>
      compiledPrefix(
        compiled.replace(
          /\}\)\(\);\s*$/,
          '  import("https://example.invalid/module.js");\n})();',
        ),
        role,
      ),
    /Unexpected external module load/,
  );
  results.push({
    entry: role.entry,
    entrySHA256: hash(source),
    output: role.output,
    outputSHA256: hash(bytes),
    phase,
  });
}
await writeFile(
  resolve(import.meta.dirname, 'bootstrap-result.json'),
  JSON.stringify(
    {
      scope:
        'Source and built-prefix gates under trusted TypeScript/esbuild and native/compiler-helper contracts; not a verified JavaScript interpreter or browser proof.',
      checkerSHA256: hash(await readFile(import.meta.filename)),
      results,
      faults: {
        earlyHeavyInitializer: 'rejected',
        unknownEntryPrefix: 'rejected',
        externalModuleImport: 'rejected',
      },
      completed: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Root and child bootstrap defer heavy module initialization until after kernel installation; prefix faults rejected',
);
